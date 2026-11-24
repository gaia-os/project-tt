"""KG service — authenticated HTTP API colocated with Neo4j + Ollama.

Endpoints:
  GET  /health            - liveness + backend reachability (open)
  POST /chat              - agentic Q&A over the SMR knowledge graph
  POST /resolve           - entity resolution for a name/phrase
  POST /expand            - profile of a design / organisation / technology
  GET  /entity/{name}     - entity dossier (provenance + evidence)
  GET  /llm/models        - selectable LLMs + currently active one
  POST /llm/model         - switch the active LLM (offloads the old one first)

Auth: every request except /health needs `X-API-Key: <KG_API_KEY>`.

Run locally:  uv run uvicorn service.kg_service:app --port 8080
Docker:       see Dockerfile.kg-service
"""

from __future__ import annotations

import copy
import html
import json
import os
import re
import threading
import time
from contextlib import asynccontextmanager
from typing import Any

import ollama
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from neo4j import GraphDatabase, Session
from pydantic import BaseModel, Field

import config
from service.expansion import (
    entity_evidence,
    entity_profile,
    expand,
    normalize_label,
    resolve_entity,
)

_settings = config.Settings()
_driver = None
_ollama: ollama.Client | None = None

# The LLM in use — starts on the first OLLAMA_LLM_MODELS entry and may be
# switched at runtime via POST /llm/model.
_active_model = _settings.llm_model
_model_lock = threading.Lock()

MAX_TOOL_ROUNDS = 10           # instant mode
MAX_TOOL_ROUNDS_THINKING = 25  # deep-analysis mode
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


app = FastAPI(title="SMR KG Service", lifespan=lifespan)


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


def t_expand(name: str) -> Any:
    with _session() as s:
        best = resolve_entity(s, name, limit=1)
        if not best:
            return {"error": f"No KG entity matches '{name}'. Try find_entities first."}
        e = best[0]
        out = entity_profile(s, e["name"])
        return {"resolvedAs": e["name"], "kind": e["kind"], **out}


def t_entity_evidence(name: str) -> Any:
    with _session() as s:
        best = resolve_entity(s, name, limit=1)
        if not best:
            return {"error": f"No KG entity matches '{name}'. Try find_entities first."}
        d = entity_evidence(s, best[0]["name"])
        if not d:
            return {"error": f"No entity named '{best[0]['name']}'"}
        return d


def t_search_chunks(query: str, limit: int = 5) -> Any:
    emb = _ollama.embed(model=_settings.embed_model, input=query)["embeddings"][0]
    with _session() as s:
        rows = s.run(
            """
            CALL db.index.vector.queryNodes($idx, $k, $emb)
            YIELD node, score
            MATCH (node)-[:FROM_DOCUMENT]->(doc:Document)
            OPTIONAL MATCH (e:DocumentedEntity)-[:FROM_CHUNK]->(node)
            RETURN node.text AS text, score,
                   doc.fileName AS source, doc.entityType AS sourceKind,
                   collect(DISTINCT e.name)[..3] AS entities
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
            "description": "Look up knowledge-graph entities (SMR designs, organisations, "
            "technologies, programmes, sites) matching a name, alias or concept.",
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
            "description": "Get the profile the KG associates with an entity: for a design "
            "its developer, technology line, reported parameters, readiness assessment, "
            "milestones, applications and technologies; for a technology the designs using "
            "it, suppliers and dependencies; for an organisation its designs and role. "
            "e.g. 'NUWARD SMR' or 'molten salt'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "entity_evidence",
            "description": "Get the provenance and quote-level evidence for one entity: "
            "source record, upstream document (IAEA catalogue / NEA dashboard), evidence "
            "items with verification status, cited web sources and literature references.",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_chunks",
            "description": "Semantic (vector) search over the text of the registered source "
            "documents. Best for open questions where the relevant entity name is unknown.",
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
            "only — no writes, no CALL). Graph: domain entities are (:SMRDesign), "
            "(:Organisation) (regulators also :Regulator) and (:Technology), all also "
            "labelled :DocumentedEntity. Edges: (:Organisation)-[:DEVELOPS]->(:SMRDesign), "
            "(d:SMRDesign)-[:BELONGS_TO_TECHNOLOGY_LINE]->(:TechnologyLine), "
            "(d)-[:USES_TECHNOLOGY]->(t:Technology), (t)-[:DEPENDS_ON_TECHNOLOGY|HAS_BROADER_TECHNOLOGY]->(t2:Technology), "
            "(o:Organisation)-[:SUPPLIES_TECHNOLOGY]->(t), (o)-[:HEADQUARTERED_IN]->(:Country), "
            "(d)-[:TARGETS_APPLICATION]->(:TargetApplication), "
            "(d)-[:HAS_READINESS_ASSESSMENT]->(:ReadinessAssessment {dimension, level, levelMax, stage}), "
            "(d)-[:HAS_REPORTED_PARAMETER]->(:ReportedParameterValue {parameter, rawValue, unit})-[:REPORTED_IN]->(:UpstreamDocument), "
            "(e:DocumentedEntity)-[:HAS_MILESTONE]->(:Milestone {event,status,dateText}), "
            "(e)-[:SUPPORTED_BY_EVIDENCE]->(:EvidenceItem {claimLabel,quote,verificationStatus}), "
            "(e)-[:DOCUMENTED_IN]->(:SourceRecord)-[:EXTRACTED_FROM]->(:UpstreamDocument). "
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
    "expand_concept": lambda a: t_expand(a.get("name", "")),
    "entity_evidence": lambda a: t_entity_evidence(a.get("name", "")),
    "search_chunks": lambda a: t_search_chunks(a.get("query", ""), int(a.get("limit", 5))),
    "run_cypher": lambda a: t_run_cypher(a.get("query", "")),
}

_REASON_PARAM = {
    "type": "string",
    "description": "One short sentence: why you are making this lookup — "
    "what you hope to find.",
}


def _tools_schema(with_reason: bool) -> list[dict[str, Any]]:
    """Tool definitions; in reasoning mode every call must carry a `reason`."""
    if not with_reason:
        return TOOLS
    tools = copy.deepcopy(TOOLS)
    for t in tools:
        params = t["function"]["parameters"]
        params["properties"]["reason"] = dict(_REASON_PARAM)
        params.setdefault("required", []).append("reason")
    return tools

_SYSTEM = """You are the research assistant for a small modular reactor (SMR) technology tree.
You answer questions using the project's knowledge graph: the SMR landscape —
reactor designs from the IAEA SMR Technology Catalogue (2026 edition) and the
NEA SMR Dashboard (3rd edition, 2025), the organisations that develop and
supply them, and the technologies they rely on — extracted into entities
(designs, organisations, technologies, readiness assessments, milestones,
reported parameters, evidence items) linked to registered source documents.

Use the tools to ground every factual claim in the graph. Call them before
answering whenever the question touches SMR designs, vendors, technologies,
readiness, economics or deployment. Cite sources in brackets — the upstream
document ([IAEA Catalogue 2026], [NEA Dashboard 3rd ed.]) or the source file /
web source a tool returns. If the graph has no relevant data, say so plainly
instead of inventing references — coverage is limited to the registered
corpus.

Format answers as clean HTML only — never markdown (**, -, ## render as
literal characters in the chat panel). Use <p>, <ul><li>, <h3>, <strong>.
Keep it readable in a chat panel.

Tag every named entity you mention — reactor designs, organisations,
technologies, programmes, sites — as <strong data-entity="NAME">…</strong>
where NAME is the entity's exact name as the tools returned it (resolvedAs /
name fields). Tag nothing else: no categories, technology lines, readiness
levels, numbers or emphasis. Example:
<strong data-entity="BWRX-300">BWRX-300</strong>."""

_MODE_SUFFIX = {
    "instant": "\n\nBe concise and direct — short focused answers unless asked to elaborate.",
    "thinking": "\n\nDeep-analysis mode: reason step by step, use multiple tool calls, "
    "consider nuances and tensions between sources, then give a thorough structured answer.",
}


def _run_tool_payload(name: str, args: dict) -> Any:
    """Structured tool result — _tool_result truncates, so harvest from this."""
    try:
        fn = _TOOL_FUNCS.get(name)
        if not fn:
            return {"error": f"unknown tool {name}"}
        return fn(args)
    except Exception as exc:  # feed errors back to the model instead of dying
        return {"error": f"{type(exc).__name__}: {exc}"}


def _run_tool(name: str, args: dict) -> str:
    return _tool_result(_run_tool_payload(name, args))


# ---------------------------------------------------------------- tool-result harvest
#
# The entity names a lookup already resolved (`resolvedAs`, `name` fields,
# entity lists in profiles) are canonical KG names — a second, more reliable
# mention source than the model's bolding. Harvested generously, then kept
# only when the name actually appears in the answer.

_NAME_VALUE_KEYS = {"name", "resolvedas"}
_ENTITY_LIST_KEYS = {
    "developers",
    "suppliers",
    "vendors",
    "technologies",
    "designs",
    "organisations",
    "organizations",
    "countries",
    "applications",
    "technologylines",
    "relateddesigns",
    "entities",
}


def _harvest_names(value: Any, out: set[str]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            lk = str(key).lower()
            if lk in _NAME_VALUE_KEYS and isinstance(item, str):
                out.add(item)
            elif lk in _ENTITY_LIST_KEYS and isinstance(item, list):
                out.update(x for x in item if isinstance(x, str))
            _harvest_names(item, out)
    elif isinstance(value, list):
        for item in value:
            _harvest_names(item, out)


# ---------------------------------------------------------------- answer mentions
#
# The system prompt tells the model to tag named entities as
# <strong data-entity="canonical name">. Those spans are harvested from the
# final answer and linked to KG entities with the same resolver the tools
# use, so the app can show which tree nodes an answer talks about. Spans
# without the attribute fall back to resolving the span text; spans that
# resolve to nothing still go out — the app can match them against the
# on-screen tree itself.

_BOLD_SPAN = re.compile(r"<(?:strong|b)\b([^>]*)>(.*?)</(?:strong|b)\s*>", re.I | re.S)
_DATA_ENTITY = re.compile(r'data-entity\s*=\s*["\']([^"\']+)["\']', re.I)
_MD_BOLD_SPAN = re.compile(r"\*\*(.+?)\*\*")
_ANY_TAG = re.compile(r"<[^>]+>")
# Bolded numbers/punctuation ("TRL 9", "+12%") are not entity candidates.
_NON_ENTITY = re.compile(r"[\d\s.,%:;()+\-–—/'’&]+")
_MAX_MENTIONS = 20


def _clean_mention(raw: str) -> str:
    text = normalize_label(html.unescape(_ANY_TAG.sub(" ", raw)))
    return re.sub(r"\s+", " ", text).strip()


def _norm_for_search(text: str) -> str:
    text = re.sub(r"[®™©]", "", text.lower())
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _in_answer(name: str, answer_norm: str) -> bool:
    """Is `name` (canonical) actually written in the answer? Tolerates the
    short forms prose uses: word-boundary first token ("NuScale" of "NuScale
    Power Module") or a two-token prefix ("ritm 200m" of "ritm 200m n s")."""
    n = _norm_for_search(name)
    if len(n) < 3:
        return False
    if n in answer_norm:
        return True
    words = n.split()
    if len(words) >= 2 and " ".join(words[:2]) in answer_norm:
        return True
    return bool(
        words
        and len(words[0]) >= 4
        and re.search(r"\b" + re.escape(words[0]) + r"\b", answer_norm)
    )


def _answer_mentions(
    answer_html: str, consulted: set[str] | None = None
) -> list[dict[str, Any]]:
    # (visible span text, canonical-name hint from data-entity)
    spans: list[tuple[str, str | None]] = []
    seen: set[str] = set()

    def _add(raw_attrs: str, raw_text: str) -> None:
        text = _clean_mention(raw_text)
        hint_match = _DATA_ENTITY.search(raw_attrs or "")
        hint = _clean_mention(hint_match.group(1)) if hint_match else ""
        if not hint and not (3 <= len(text) <= 80 and not _NON_ENTITY.fullmatch(text)):
            return
        key = (hint or text).lower()
        if key not in seen:
            seen.add(key)
            spans.append((text, hint or None))

    for match in _BOLD_SPAN.finditer(answer_html):
        _add(match.group(1), match.group(2))
    if not spans:
        # Markdown bold slipped through despite the HTML-only instruction.
        for match in _MD_BOLD_SPAN.finditer(answer_html):
            _add("", match.group(1))

    spans = spans[:_MAX_MENTIONS]
    answer_norm = _norm_for_search(answer_html)
    try:
        with _session() as s:
            out: list[dict[str, Any]] = []
            emitted: set[str] = set()
            for text, hint in spans:
                # A data-entity hint should already be the canonical name —
                # fuzzy tolerates near-misses; bare spans keep it cheap.
                best = resolve_entity(s, hint or text, limit=1, fuzzy=hint is not None)
                entity = best[0] if best else {}
                if entity.get("name"):
                    emitted.add(entity["name"].lower())
                emitted.add(text.lower())
                out.append({"text": text, **entity})

            # Entities the lookups resolved and the answer actually names.
            extras: list[tuple[int, dict[str, Any]]] = []
            for name in consulted or ():
                if name.lower() in emitted or not _in_answer(name, answer_norm):
                    continue
                best = resolve_entity(s, name, limit=1, fuzzy=False)
                entity = best[0] if best else {}
                if entity.get("name"):
                    emitted.add(entity["name"].lower())
                pos = answer_norm.find(_norm_for_search(name).split()[0] or name)
                extras.append((pos, {"text": name, "via": "tool", **entity}))
            extras.sort(key=lambda e: e[0])
            out.extend(item for _pos, item in extras[:_MAX_MENTIONS])
            return out
    except Exception:
        # Mention linking decorates the answer — never break the stream over
        # it. Harvested names still help: the app can label-match them.
        fallback = [{"text": text} for text, _hint in spans]
        seen_texts = {text.lower() for text, _hint in spans}
        for name in consulted or ():
            if name.lower() not in seen_texts and _in_answer(name, answer_norm):
                fallback.append({"text": name, "via": "tool"})
        return fallback


def _rounds_limit(override: int | None, default: int) -> int:
    return default if override is None else max(1, min(100, int(override)))


def _chat_events(
    message: str,
    history: list[dict],
    context_text: str,
    mode: str,
    reasoning: bool = False,
    tools_enabled: bool = True,
    max_instant: int | None = None,
    max_thinking: int | None = None,
    want_suggestions: bool = True,
):
    """Yields NDJSON event dicts: tool calls as they run, then answer deltas."""
    system = _SYSTEM + _MODE_SUFFIX.get(mode, _MODE_SUFFIX["instant"])
    if reasoning:
        system += (
            "\n\nFill the `reason` argument of every tool call with one short "
            "sentence stating what you expect this lookup to find."
        )
    if not tools_enabled:
        system += (
            "\n\nKG lookups are disabled for this request — answer directly "
            "without tools; if a fact needs the graph and you lack it, say so."
        )
    if context_text:
        system += f"\n\nCURRENT TECH-TREE CONTEXT (for orientation — the KG is the evidence source):\n{context_text}"

    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for h in history[-MAX_HISTORY:]:
        role = "user" if h.get("type") == "user" else "assistant"
        messages.append({"role": role, "content": h.get("content", "")})
    messages.append({"role": "user", "content": message})

    if not tools_enabled:
        # One straight answer pass — no tools offered, nothing to look up.
        stream = _ollama.chat(
            model=_active_model,
            messages=messages,
            options={"num_ctx": _settings.num_ctx, "temperature": 0.3},
            stream=True,
        )
        answer = ""
        for chunk in stream:
            if chunk.message.content:
                answer += chunk.message.content
                yield {"type": "delta", "text": chunk.message.content}
        yield {
            "type": "done",
            "toolsUsed": [],
            "suggestions": _followups(message, answer, history)
            if want_suggestions
            else [],
        }
        # After `done`: mention resolution is decoration and may be slow over
        # a remote Neo4j — it must never delay or endanger the answer itself.
        yield {"type": "entities", "items": _answer_mentions(answer)}
        return

    tools_used: list[Any] = []
    answer_parts: list[str] = []
    consulted: set[str] = set()
    tools_schema = _tools_schema(reasoning)
    # Deep-analysis mode gets a larger retrieval budget; per-request overrides
    # (from the app's KG settings dialog) are clamped to a sane range.
    max_rounds = (
        _rounds_limit(max_thinking, MAX_TOOL_ROUNDS_THINKING)
        if mode == "thinking"
        else _rounds_limit(max_instant, MAX_TOOL_ROUNDS)
    )
    for _ in range(max_rounds):
        # stream=True so the final answer streams token-by-token; tool calls
        # arrive in the last chunk instead of content.
        stream = _ollama.chat(
            model=_active_model,
            messages=messages,
            tools=tools_schema,
            options={"num_ctx": _settings.num_ctx, "temperature": 0.3},
            stream=True,
        )
        content_parts: list[str] = []
        tool_calls: list[Any] = []
        for chunk in stream:
            m = chunk.message
            if m.content:
                content_parts.append(m.content)
                answer_parts.append(m.content)
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
            # `reason` is display metadata, not a tool input — keep it out of
            # the call label and the tool invocation.
            reason = args.pop("reason", None)
            label = f"{name}({json.dumps(args)[:120]})"
            if reasoning:
                tools_used.append({"call": label, "reason": reason})
                yield {"type": "tool", "name": label, "reason": reason}
            else:
                tools_used.append(label)
                yield {"type": "tool", "name": label}
            payload = _run_tool_payload(name, args)
            _harvest_names(payload, consulted)
            messages.append(
                {"role": "tool", "name": name, "content": _tool_result(payload)}
            )
    else:
        # Retrieval budget exhausted — force a final no-tools pass so the
        # model synthesises whatever evidence it already gathered.
        messages.append(
            {
                "role": "user",
                "content": "You have reached the retrieval limit. Answer now "
                "using the evidence already gathered above; if something is "
                "still missing, say so briefly at the end.",
            }
        )
        stream = _ollama.chat(
            model=_active_model,
            messages=messages,
            options={"num_ctx": _settings.num_ctx, "temperature": 0.3},
            stream=True,
        )
        for chunk in stream:
            if chunk.message.content:
                answer_parts.append(chunk.message.content)
                yield {"type": "delta", "text": chunk.message.content}

    yield {
        "type": "done",
        "toolsUsed": tools_used,
        "suggestions": _followups(message, "".join(answer_parts), history)
        if want_suggestions
        else [],
    }
    yield {
        "type": "entities",
        "items": _answer_mentions("".join(answer_parts), consulted),
    }


def _ndjson(events) -> Any:
    for ev in events:
        yield (json.dumps(ev, default=str) + "\n").encode()


def agentic_chat(
    message: str,
    history: list[dict],
    context_text: str,
    mode: str,
    reasoning: bool = False,
    tools_enabled: bool = True,
    max_instant: int | None = None,
    max_thinking: int | None = None,
    want_suggestions: bool = True,
) -> dict:
    text = ""
    tools: list[Any] = []
    suggestions: list[str] = []
    entities: list[dict[str, Any]] = []
    for ev in _chat_events(
        message, history, context_text, mode, reasoning,
        tools_enabled, max_instant, max_thinking, want_suggestions,
    ):
        if ev["type"] == "delta":
            text += ev["text"]
        elif ev["type"] == "entities":
            entities = ev.get("items", [])
        elif ev["type"] == "done":
            tools = ev["toolsUsed"]
            suggestions = ev.get("suggestions", [])
    return {
        "response": text,
        "toolsUsed": tools,
        "suggestions": suggestions,
        "entities": entities,
    }


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
You verify claims from a research document against a knowledge graph of the
SMR landscape — SMR designs, developing organisations and enabling
technologies documented in the IAEA SMR Technology Catalogue, the NEA SMR
Dashboard and curated source files. For each claim, retrieved evidence chunks
are given (with their source files).

Decide per claim:
- "supported": the evidence directly supports the claim
- "contradicted": the evidence conflicts with the claim
- "unverifiable": the KG lacks evidence to judge it (very common — coverage is
  limited to the registered corpus; do NOT guess)

Output ONLY JSON:
{{"verdicts": [{{"id": <claim number>, "verdict": "supported|contradicted|unverifiable",
"evidence": "<source file or null>", "note": "<one short sentence>"}}]}}

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


def _llm_json(prompt: str, num_ctx: int | None = None) -> dict:
    # Keep num_ctx identical to the chat calls — Ollama restarts the model
    # runner when num_ctx differs between requests, which shows up as an
    # unload/reload between the answer and the follow-up generation.
    resp = _ollama.chat(
        model=_active_model,
        messages=[{"role": "user", "content": prompt}],
        format="json",
        options={"num_ctx": num_ctx or _settings.num_ctx, "temperature": 0.1},
    )
    try:
        return json.loads(resp.message.content or "{}")
    except json.JSONDecodeError:
        return {}


_FOLLOWUP_PROMPT = """\
Suggest {n} short follow-up questions the user could ask next, based on this
exchange about the SMR technology tree. They must be answerable from a
knowledge graph of SMR designs, organisations and technologies — concrete,
under 12 words each, no explanations, don't repeat what was already asked.
Output ONLY JSON: {{"suggestions": ["...", "..."]}}
{history}
USER ASKED: {question}
ASSISTANT ANSWERED: {answer}"""


def _followups(
    question: str, answer: str, history: list[dict] | None = None, n: int = 3
) -> list[str]:
    """Follow-up question chips shown under each answer; [] on any failure."""
    if not answer.strip():
        return []
    lines = [
        f"{'User' if h.get('type') == 'user' else 'Assistant'}: "
        f"{str(h.get('content', ''))[:200]}"
        for h in (history or [])[-6:]
    ]
    history_text = (
        "\nEARLIER IN THE CONVERSATION (don't re-suggest these topics):\n"
        + "\n".join(lines)
        if lines
        else ""
    )
    try:
        d = _llm_json(
            _FOLLOWUP_PROMPT.format(
                n=n,
                history=history_text,
                question=question[:500],
                answer=answer[:2000],
            )
        )
        out = d.get("suggestions")
        if not isinstance(out, list):
            return []
        return [s.strip() for s in out if isinstance(s, str) and s.strip()][:n]
    except Exception:
        return []


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
                f"[{r.get('source') or 'unknown source'}] {r['text'][:300]}" for r in evidence[i]
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
    # When true, every tool call must carry a `reason` (displayed next to the
    # lookup in the app) and done.toolsUsed becomes [{call, reason}].
    reasoning: bool = False
    # When false, no tools are offered — one direct answer pass.
    toolsEnabled: bool = True
    # When false, no follow-up questions are generated after the answer.
    suggestions: bool = True
    # Optional per-request overrides for the lookup budgets (clamped 1..100).
    maxToolRoundsInstant: int | None = None
    maxToolRoundsThinking: int | None = None


class ModelSwitchRequest(BaseModel):
    model: str


class ResolveRequest(BaseModel):
    query: str


class ExpandRequest(BaseModel):
    name: str


class VerifyDocRequest(BaseModel):
    fileBase64: str
    fileName: str = "document.pdf"
    question: str = ""


# ---------------------------------------------------------------- routes

@app.get("/health")
def health():
    try:
        with _session() as s:
            counts = s.run(
                """
                MATCH (d:SMRDesign) WITH count(d) AS designs
                MATCH (o:Organisation) WITH designs, count(o) AS organisations
                MATCH (t:Technology) RETURN designs, organisations, count(t) AS technologies
                """
            ).single()
        model_ok = _ollama is not None
        return {"ok": True, **counts, "model": _active_model, "ollama": model_ok}
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=503)


@app.post("/chat")
def chat(req: ChatRequest, denied=Depends(guard)):
    if denied:
        return denied
    if not req.message.strip():
        return JSONResponse({"error": "message is required"}, status_code=400)
    result = agentic_chat(
        req.message,
        req.history,
        req.contextText,
        req.mode,
        req.reasoning,
        req.toolsEnabled,
        req.maxToolRoundsInstant,
        req.maxToolRoundsThinking,
        req.suggestions,
    )
    return result


@app.post("/chat/stream")
def chat_stream(req: ChatRequest, denied=Depends(guard)):
    if denied:
        return denied
    if not req.message.strip():
        return JSONResponse({"error": "message is required"}, status_code=400)
    return StreamingResponse(
        _ndjson(
            _chat_events(
                req.message,
                req.history,
                req.contextText,
                req.mode,
                req.reasoning,
                req.toolsEnabled,
                req.maxToolRoundsInstant,
                req.maxToolRoundsThinking,
                req.suggestions,
            )
        ),
        media_type="application/x-ndjson",
    )


@app.get("/llm/models")
def llm_models(denied=Depends(guard)):
    if denied:
        return denied
    return {"models": _settings.llm_models, "current": _active_model}


@app.post("/llm/model")
def switch_llm_model(req: ModelSwitchRequest, denied=Depends(guard)):
    global _active_model
    if denied:
        return denied
    target = req.model.strip()
    if target not in _settings.llm_models:
        return JSONResponse(
            {"error": f"Unknown model '{target}'", "models": _settings.llm_models},
            status_code=400,
        )
    with _model_lock:
        previous = _active_model
        if target == previous:
            return {"current": _active_model, "previous": previous, "switched": False}
        try:
            # keep_alive=0 offloads the old model before loading the new one.
            _ollama.generate(model=previous, keep_alive=0)
            # keep_alive=-1 keeps the new model resident.
            _ollama.generate(
                model=target,
                keep_alive=-1,
                options={"num_ctx": _settings.num_ctx},
            )
        except Exception as exc:
            return JSONResponse({"error": f"Model switch failed: {exc}"}, status_code=502)
        _active_model = target
        return {"current": _active_model, "previous": previous, "switched": True}


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
    return t_expand(req.name)


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


@app.get("/entity/{name}")
def entity(name: str, denied=Depends(guard)):
    if denied:
        return denied
    with _session() as s:
        d = entity_evidence(s, name)
    if not d:
        return JSONResponse({"error": "not found"}, status_code=404)
    return d
