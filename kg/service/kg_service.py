"""KG service — authenticated HTTP API colocated with Neo4j + Ollama.

Endpoints:
  GET  /health            - liveness + backend reachability (open)
  POST /chat              - agentic Q&A over the fusion knowledge graph
  POST /resolve           - entity resolution for a name/phrase
  POST /expand            - papers/devices/findings around a concept
  GET  /paper/{paper_id}  - paper dossier

Auth: every request except /health needs `X-API-Key: <KG_API_KEY>`.

Run locally:  uv run uvicorn service.kg_service:app --port 8080
Docker:       see Dockerfile.kg-service
"""

from __future__ import annotations

import json
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Any

import ollama
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from neo4j import GraphDatabase, Session
from pydantic import BaseModel, Field

import config
from service.expansion import expand, paper_dossier, resolve_entity

_settings = config.Settings()
_driver = None
_ollama: ollama.Client | None = None

MAX_TOOL_ROUNDS = 8
MAX_ROWS = 60
MAX_STR = 600
MAX_TOOL_RESULT_CHARS = 12000
MAX_HISTORY = 12
RATE_LIMIT_PER_MIN = 30


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _driver, _ollama
    _driver = GraphDatabase.driver(
        _settings.neo4j_uri,
        auth=(_settings.neo4j_user, _settings.neo4j_password),
    )
    _driver.verify_connectivity()
    _ollama = ollama.Client(host=_settings.ollama_url)
    yield
    _driver.close()


app = FastAPI(title="Fusion KG Service", lifespan=lifespan)


# ---------------------------------------------------------------- auth + rate limit

_hits: dict[str, list[float]] = {}


def guard(request: Request):
    expected = os.environ.get("KG_API_KEY")
    if not expected:
        return JSONResponse({"error": "KG_API_KEY not configured"}, status_code=500)
    if request.headers.get("x-api-key") != expected:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    hits = [t for t in _hits.get(ip, []) if now - t < 60]
    if len(hits) >= RATE_LIMIT_PER_MIN:
        return JSONResponse({"error": "Too many requests"}, status_code=429)
    hits.append(now)
    _hits[ip] = hits
    return None


# ---------------------------------------------------------------- tool helpers

def _trim(value: Any, depth: int = 0) -> Any:
    if isinstance(value, str):
        return value[:MAX_STR]
    if isinstance(value, list):
        return [_trim(v, depth + 1) for v in value[:25]]
    if isinstance(value, dict):
        return {k: _trim(v, depth + 1) for k, v in value.items()}
    return value


def _tool_result(payload: Any) -> str:
    return json.dumps(_trim(payload), default=str)[:MAX_TOOL_RESULT_CHARS]


def _session() -> Session:
    return _driver.session(database=_settings.neo4j_database)


def t_find_entities(query: str) -> Any:
    with _session() as s:
        return resolve_entity(s, query)[:5]


def t_expand(name: str, max_papers: int = 8) -> Any:
    with _session() as s:
        best = resolve_entity(s, name, limit=1)
        if not best:
            return {"error": f"No KG entity matches '{name}'. Try find_entities first."}
        e = best[0]
        out = expand(s, e["name"], e["labels"], max_papers=max_papers, max_devices=5, max_findings=8)
        return {"resolvedAs": e["name"], "labels": e["labels"], **out}


def t_paper_details(paper_id: str) -> Any:
    with _session() as s:
        d = paper_dossier(s, paper_id)
        if not d:
            return {"error": f"No paper with id '{paper_id}'"}
        d.pop("excerpts", None)  # too long for the LLM context
        return d


def t_search_chunks(query: str, limit: int = 5) -> Any:
    emb = _ollama.embed(model=_settings.embed_model, input=query)["embeddings"][0]
    with _session() as s:
        rows = s.run(
            """
            CALL db.index.vector.queryNodes($idx, $k, $emb)
            YIELD node, score
            MATCH (node)-[:FROM_DOCUMENT]->(doc:Document)
            OPTIONAL MATCH (p:Paper {paperId: doc.paper_id})
            RETURN node.text AS text, score,
                   doc.paper_id AS paperId,
                   coalesce(p.title, doc.title) AS title
            ORDER BY score DESC
            """,
            idx=_settings.vector_index_name,
            k=limit,
            emb=emb,
        ).data()
    return rows


_FORBIDDEN = re.compile(
    r"\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|CALL|FOREACH|LOAD|GRANT|"
    r"REVOKE|DENY|ALTER|USE|PERIODIC|APOC|DBMS|SHUTDOWN)\b",
    re.IGNORECASE,
)
_START_RE = re.compile(r"^\s*(MATCH|OPTIONAL\s+MATCH|UNWIND|WITH|RETURN)\b", re.IGNORECASE)


def t_run_cypher(query: str) -> Any:
    q = re.sub(r"//[^\n]*|/\*.*?\*/", "", query, flags=re.S).strip()
    if not _START_RE.match(q) or _FORBIDDEN.search(q) or "CALL" in q.upper():
        return {"error": "Only read-only MATCH/OPTIONAL MATCH/UNWIND/WITH/RETURN queries are allowed."}
    with _session() as s:
        rows = s.run(q).data()
        truncated = len(rows) > MAX_ROWS
        return {"rows": rows[:MAX_ROWS], "truncated": truncated}


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "find_entities",
            "description": "Look up knowledge-graph entities (fusion devices, magnetic "
            "configurations, phenomena, papers, experiments) matching a name or concept.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "name or concept"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "expand_concept",
            "description": "Get the papers, fusion devices and experimental findings the KG "
            "associates with a concept, e.g. 'stellarator' or 'plasma heating'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "max_papers": {"type": "integer", "default": 8},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "paper_details",
            "description": "Get the full dossier (authors, conference, experiments, findings) "
            "of one paper by its id, e.g. 'IAEA-CN-28-H-10'.",
            "parameters": {
                "type": "object",
                "properties": {"paperId": {"type": "string"}},
                "required": ["paperId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_chunks",
            "description": "Semantic (vector) search over the text of the conference papers. "
            "Best for open questions where the relevant entity name is unknown.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_cypher",
            "description": "Run a READ-ONLY Cypher query (MATCH/OPTIONAL MATCH/UNWIND/WITH/RETURN "
            "only — no writes, no CALL). Graph: (p:Paper)-[:AUTHORED_BY]->(:Person), "
            "(:Person)-[:AFFILIATED_WITH]->(:ResearchInstitute), "
            "(e:Experiment)-[:PERFORMED_ON]->(:FusionDevice), "
            "(e)-[:HAS_CONFIGURATION]->(:MagneticConfiguration), "
            "(e)-[:USES_HEATING_METHOD]->(:HeatingMethod), "
            "(e)-[:REPORTS_FINDING]->(f:ExperimentalFinding), (f)-[:MEASURES_PARAMETER]->(:PlasmaParameter), "
            "(p:Paper)-[:REPORTS_ON]->(entities). Entities carry extra type labels like "
            "FusionDevice, MagneticConfiguration, OscillationOrInstability. "
            "Use for counts, comparisons or structured lookups the other tools can't express.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "read-only Cypher"}},
                "required": ["query"],
            },
        },
    },
]

_TOOL_FUNCS = {
    "find_entities": lambda a: t_find_entities(a.get("query", "")),
    "expand_concept": lambda a: t_expand(a.get("name", ""), int(a.get("max_papers", 8))),
    "paper_details": lambda a: t_paper_details(a.get("paperId", "")),
    "search_chunks": lambda a: t_search_chunks(a.get("query", ""), int(a.get("limit", 5))),
    "run_cypher": lambda a: t_run_cypher(a.get("query", "")),
}

_SYSTEM = """You are the research assistant for a fusion-energy technology tree.
You answer questions using the project's knowledge graph: IAEA fusion conference
proceedings (1960s–1970s) extracted into entities (devices, configurations,
experiments, findings, parameters) linked to their source papers.

Use the tools to ground every factual claim in the graph. Call them before
answering whenever the question touches the literature. Cite evidence by paper
id in brackets like [IAEA-CN-28-H-10]. If the graph has no relevant data, say so
plainly instead of inventing references — coverage is limited to the ingested
conference volumes, mostly historical.

Format answers as clean HTML only (no markdown): use <p>, <ul><li>, <h3>,
<strong>. Keep it readable in a chat panel."""

_MODE_SUFFIX = {
    "instant": "\n\nBe concise and direct — short focused answers unless asked to elaborate.",
    "thinking": "\n\nDeep-analysis mode: reason step by step, use multiple tool calls, "
    "consider nuances and tensions between sources, then give a thorough structured answer.",
}


def _run_tool(name: str, args: dict) -> str:
    try:
        fn = _TOOL_FUNCS.get(name)
        if not fn:
            return json.dumps({"error": f"unknown tool {name}"})
        return _tool_result(fn(args))
    except Exception as exc:  # feed errors back to the model instead of dying
        return json.dumps({"error": f"{type(exc).__name__}: {exc}"})


def _chat_events(
    message: str, history: list[dict], context_text: str, mode: str
):
    """Yields NDJSON event dicts: tool calls as they run, then answer deltas."""
    system = _SYSTEM + _MODE_SUFFIX.get(mode, _MODE_SUFFIX["instant"])
    if context_text:
        system += f"\n\nCURRENT TECH-TREE CONTEXT (for orientation — the KG is the evidence source):\n{context_text}"

    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for h in history[-MAX_HISTORY:]:
        role = "user" if h.get("type") == "user" else "assistant"
        messages.append({"role": role, "content": h.get("content", "")})
    messages.append({"role": "user", "content": message})

    tools_used: list[str] = []
    # Deep-analysis mode gets a larger retrieval budget.
    max_rounds = 12 if mode == "thinking" else MAX_TOOL_ROUNDS
    for _ in range(max_rounds):
        # stream=True so the final answer streams token-by-token; tool calls
        # arrive in the last chunk instead of content.
        stream = _ollama.chat(
            model=_settings.llm_model,
            messages=messages,
            tools=TOOLS,
            options={"num_ctx": _settings.num_ctx, "temperature": 0.3},
            stream=True,
        )
        content_parts: list[str] = []
        tool_calls: list[Any] = []
        for chunk in stream:
            m = chunk.message
            if m.content:
                content_parts.append(m.content)
                yield {"type": "delta", "text": m.content}
            if getattr(m, "tool_calls", None):
                tool_calls = m.tool_calls

        if not tool_calls:
            break

        messages.append(
            {
                "role": "assistant",
                "content": "".join(content_parts),
                "tool_calls": [
                    {
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": dict(tc.function.arguments or {}),
                        },
                    }
                    for tc in tool_calls
                ],
            }
        )
        for tc in tool_calls:
            name = tc.function.name
            args = dict(tc.function.arguments or {})
            label = f"{name}({json.dumps(args)[:120]})"
            tools_used.append(label)
            yield {"type": "tool", "name": label}
            messages.append(
                {"role": "tool", "name": name, "content": _run_tool(name, args)}
            )
    else:
        yield {
            "type": "delta",
            "text": "I ran out of retrieval steps before reaching a conclusion — please try narrowing the question.",
        }

    yield {"type": "done", "toolsUsed": tools_used}


def _ndjson(events) -> Any:
    for ev in events:
        yield (json.dumps(ev, default=str) + "\n").encode()


def agentic_chat(message: str, history: list[dict], context_text: str, mode: str) -> dict:
    text = ""
    tools: list[str] = []
    for ev in _chat_events(message, history, context_text, mode):
        if ev["type"] == "delta":
            text += ev["text"]
        elif ev["type"] == "done":
            tools = ev["toolsUsed"]
    return {"response": text, "toolsUsed": tools}


# ---------------------------------------------------------------- document verification

import base64
import io

from pypdf import PdfReader

MAX_PDF_PAGES = 8
MAX_PDF_CHARS = 12000
MAX_CLAIMS = 12

_EXTRACT_PROMPT = """\
You extract checkable claims from a research document excerpt.
Output ONLY JSON: {{"claims": [{{"claim": "...", "topic": "2-4 word tag"}}]}}
Rules:
- Emit ONE claim PER ASSERTION. If a sentence packs several assertions into it
  (e.g. "device X is stable, uses heating Y, reaches temperature Z"), split it
  into separate claims for each.
- Include QUALITATIVE assertions too: stability, mechanism/method names
  (heating type, confinement scheme), causality, superlatives — not just
  numbers. Mislabeled mechanisms and wrong qualitative claims matter.
- No boilerplate, no opinions, no section headings. Atomic and self-contained —
  each claim must be checkable against external literature on its own.
At most {max_claims} claims, the most significant ones."""

_VERIFY_PROMPT = """\
You verify claims from a research document against a knowledge graph of
1960s-70s fusion conference literature. For each claim, retrieved evidence
chunks are given (with their source paperIds).

Decide per claim:
- "supported": the evidence directly supports the claim
- "contradicted": the evidence conflicts with the claim
- "unverifiable": the KG lacks evidence to judge it (very common — coverage is
  limited to the ingested conference volumes; do NOT guess)

Output ONLY JSON:
{{"verdicts": [{{"id": <claim number>, "verdict": "supported|contradicted|unverifiable",
"evidence": "<paperId or null>", "note": "<one short sentence>"}}]}}

CLAIMS + EVIDENCE:
{evidence_block}"""


def _pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    parts: list[str] = []
    for page in reader.pages[:MAX_PDF_PAGES]:
        parts.append(page.extract_text() or "")
        if sum(len(p) for p in parts) >= MAX_PDF_CHARS:
            break
    return "\n".join(parts)[:MAX_PDF_CHARS]


def _llm_json(prompt: str, num_ctx: int = 14000) -> dict:
    resp = _ollama.chat(
        model=_settings.llm_model,
        messages=[{"role": "user", "content": prompt}],
        format="json",
        options={"num_ctx": num_ctx, "temperature": 0.1},
    )
    try:
        return json.loads(resp.message.content or "{}")
    except json.JSONDecodeError:
        return {}


def _verify_events(file_b64: str, file_name: str, question: str):
    """Yields progress events, then a final 'done' carrying the report payload."""
    yield {"type": "progress", "text": "Extracting text from PDF…"}
    try:
        text = _pdf_text(base64.b64decode(file_b64))
    except Exception as exc:
        yield {"type": "error", "error": f"Could not read PDF: {exc}"}
        return
    if len(text.strip()) < 200:
        yield {"type": "error", "error": "No extractable text found (scanned PDF?)"}
        return

    tools_used = ["pdf_extract()"]
    yield {"type": "progress", "text": "Extracting checkable claims…"}
    claims = (
        _llm_json(
            _EXTRACT_PROMPT.format(max_claims=MAX_CLAIMS)
            + f"\n\nDOCUMENT ({file_name}):\n{text}"
        ).get("claims")
        or []
    )[:MAX_CLAIMS]
    tools_used.append(f"extract_claims(n={len(claims)})")
    if not claims:
        yield {"type": "error", "error": "No checkable claims could be extracted from the document."}
        return
    yield {"type": "progress", "text": f"{len(claims)} claims extracted — gathering evidence…"}

    # Evidence: vector search per claim (embed-only, no LLM round).
    evidence: list[list[dict]] = []
    search_error: str | None = None
    for ci, c in enumerate(claims):
        yield {
            "type": "progress",
            "text": f"Searching evidence for claim {ci + 1}/{len(claims)}…",
        }
        try:
            hits = t_search_chunks(c.get("claim", ""), limit=2)
            # A second vector pass on the short topic tag catches evidence the
            # full claim sentence's embedding would miss (e.g. instability
            # literature for a "device X is stable" claim).
            if c.get("topic"):
                hits += [r for r in t_search_chunks(c["topic"], limit=2) if r not in hits]
            evidence.append(hits[:3])
            tools_used.append(
                f"search_chunks({c.get('topic') or c.get('claim', '')[:60]})"
            )
        except Exception as exc:
            search_error = f"{type(exc).__name__}: {exc}"
            evidence.append([])
            tools_used.append(f"search_chunks(FAILED: {search_error[:80]})")

    evidence_block = "\n\n".join(
        f"CLAIM {i}: {c.get('claim')}\nEVIDENCE: "
        + (
            "; ".join(
                f"[{r['paperId']}] {r['text'][:300]}" for r in evidence[i]
            )
            or "(none found)"
        )
        for i, c in enumerate(claims)
    )
    verdicts = {
        v.get("id"): v
        for v in _llm_json(_VERIFY_PROMPT.format(evidence_block=evidence_block)).get(
            "verdicts", []
        )
        if isinstance(v, dict)
    }
    tools_used.append("verify_claims()")
    yield {"type": "progress", "text": "Verifying claims against the KG…"}

    def row(i: int, c: dict) -> str:
        v = verdicts.get(i) or {}
        verdict = v.get("verdict", "unverifiable")
        color = {"supported": "#15803d", "contradicted": "#b91c1c"}.get(verdict, "#6b7280")
        ev = f" [{v['evidence']}]" if v.get("evidence") else ""
        note = f" — {v['note']}" if v.get("note") else ""
        return (
            f'<li class="mb-2"><strong style="color:{color}">'
            f"{verdict.upper()}</strong> {c.get('claim','')}{ev}{note}</li>"
        )

    counts = {"supported": 0, "contradicted": 0, "unverifiable": 0}
    for i in range(len(claims)):
        counts[verdicts.get(i, {}).get("verdict", "unverifiable")] = (
            counts.get(verdicts.get(i, {}).get("verdict", "unverifiable"), 0) + 1
        )

    html = (
        f"<h3>Document verification — {file_name}</h3>"
        f"<p>{len(claims)} claims extracted (first {MAX_PDF_PAGES} pages): "
        f"<strong style=\"color:#15803d\">{counts['supported']} supported</strong>, "
        f"<strong style=\"color:#b91c1c\">{counts['contradicted']} contradicted</strong>, "
        f"{counts['unverifiable']} unverifiable against the KG."
        + (f" Question context: {question[:200]}" if question else "")
        + (
            f' <strong style="color:#b91c1c">Note: evidence search failed — '
            f"{search_error}. Check that the embed model "
            f"({_settings.embed_model}) is available on Ollama.</strong>"
            if search_error
            else ""
        )
        + "</p><ul>"
        + "".join(row(i, claims[i]) for i in range(len(claims)))
        + "</ul>"
    )
    yield {
        "type": "done",
        "response": html,
        "claims": claims,
        "verdicts": verdicts,
        "toolsUsed": tools_used,
    }


def verify_document(file_b64: str, file_name: str, question: str) -> dict:
    result: dict = {}
    for ev in _verify_events(file_b64, file_name, question):
        if ev["type"] == "error":
            result = {"error": ev["error"]}
        elif ev["type"] == "done":
            result = {k: v for k, v in ev.items() if k != "type"}
    return result


# ---------------------------------------------------------------- API models

class ChatRequest(BaseModel):
    message: str
    history: list[dict] = Field(default_factory=list)
    contextText: str = ""
    mode: str = "instant"


class ResolveRequest(BaseModel):
    query: str


class ExpandRequest(BaseModel):
    name: str
    max_papers: int = 10


class VerifyDocRequest(BaseModel):
    fileBase64: str
    fileName: str = "document.pdf"
    question: str = ""


# ---------------------------------------------------------------- routes

@app.get("/health")
def health():
    try:
        with _session() as s:
            papers = s.run("MATCH (p:Paper) RETURN count(p) AS c").single()["c"]
        model_ok = _ollama is not None
        return {"ok": True, "papers": papers, "model": _settings.llm_model, "ollama": model_ok}
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=503)


@app.post("/chat")
def chat(req: ChatRequest, denied=Depends(guard)):
    if denied:
        return denied
    if not req.message.strip():
        return JSONResponse({"error": "message is required"}, status_code=400)
    result = agentic_chat(req.message, req.history, req.contextText, req.mode)
    return result


@app.post("/chat/stream")
def chat_stream(req: ChatRequest, denied=Depends(guard)):
    if denied:
        return denied
    if not req.message.strip():
        return JSONResponse({"error": "message is required"}, status_code=400)
    return StreamingResponse(
        _ndjson(_chat_events(req.message, req.history, req.contextText, req.mode)),
        media_type="application/x-ndjson",
    )


@app.post("/resolve")
def resolve(req: ResolveRequest, denied=Depends(guard)):
    if denied:
        return denied
    with _session() as s:
        return {"entities": resolve_entity(s, req.query)}


@app.post("/expand")
def expand_ep(req: ExpandRequest, denied=Depends(guard)):
    if denied:
        return denied
    return t_expand(req.name, req.max_papers)


@app.post("/verify-document")
def verify_doc(req: VerifyDocRequest, denied=Depends(guard)):
    if denied:
        return denied
    result = verify_document(req.fileBase64, req.fileName, req.question)
    status = 400 if result.get("error") else 200
    return JSONResponse(result, status_code=status)


@app.post("/verify-document/stream")
def verify_doc_stream(req: VerifyDocRequest, denied=Depends(guard)):
    if denied:
        return denied
    return StreamingResponse(
        _ndjson(_verify_events(req.fileBase64, req.fileName, req.question)),
        media_type="application/x-ndjson",
    )


@app.get("/paper/{paper_id}")
def paper(paper_id: str, denied=Depends(guard)):
    if denied:
        return denied
    with _session() as s:
        d = paper_dossier(s, paper_id)
    if not d:
        return JSONResponse({"error": "not found"}, status_code=404)
    return d
