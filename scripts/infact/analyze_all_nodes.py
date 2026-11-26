"""InFact v2: re-judge the deep-research TRL claims of every technology node.

Two claims are re-judged per technology:

* technology TRL - maturity of the technology anywhere (deep research's
  `trl_family`). This is the primary result.
* application TRL - maturity in the listed SMR designs (`trl_band`). It can
  never exceed the technology TRL.

Pipeline per technology in `node_details` with a `deployment.trl_band`:

1. Collect every deep-research source URL (evidence, learnings, milestones,
   suppliers, per-reactor TRL links, source list) with the notes citing it.
2. Download each URL, extract its text and check whether the deep-research
   quotes are actually present.
3. Ask a local LLM (Ollama) to classify each source on its own: which
   technology TRL range and which application TRL range it supports, how
   strongly, and what kind of source it is. The LLM is NOT shown the claimed
   TRLs, so it cannot anchor on them, and it is told to ignore the design
   status of the reactors.
4. Add the design status of the SMR designs from the reactor dataset once,
   as a single constraint on the application TRL.
5. Combine everything with the fixed rules in `trl_scoring.py`.

Usage:
    uv run scripts/infact/analyze_all_nodes.py [--node "Shore refuelling"] [--limit 20] [--refresh]

Outputs (default outputs/infact-v2/): node-infact-results.csv and
node-infact-details/<slug>.json, which `render_reports.py` turns into HTML and
which the dataset seeder ingests from data/extracted/<db>/infact-smr-analysis/.
Nodes already in the CSV are skipped unless --refresh is passed; per-source
judgements are reused when model, prompt version and think flag are unchanged.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

import httpx
from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).parent))
from evidence import (
    MIN_TEXT_CHARS,
    Source,
    SourceNote,
    build_excerpt,
    check_quotes,
    collect_sources,
    fetch_text,
    name_terms,
)
from followup import (
    MAX_NEW_SOURCES_PER_NODE,
    MAX_QUERIES_PER_CLAIM,
    PROPOSE_SCHEMA,
    PROPOSE_SYSTEM,
    Tavily,
    clean_query,
    flagged_claims,
    load_tavily_key,
    mentions_technology,
    proposal_prompt,
    template_queries,
    title_key,
    url_key,
)
from trl_scoring import (
    DIMENSIONS,
    Constraint,
    SourceJudgement,
    design_status,
    domain_of,
    parse_band,
    score,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_OUTPUT_DIR = REPO_ROOT / "outputs" / "infact-v2"
DEFAULT_OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
# DEFAULT_MODEL = os.getenv("INFACT_MODEL", "qwen3.8:27b")
DEFAULT_MODEL = os.getenv("INFACT_MODEL", "qwen3.8-flash-next:125b-a6b-q4_K_M")
PROMPT_VERSION = "trl-judge-v6"
LLM_TIMEOUT_SECONDS = 900.0
NUM_CTX = 16384

OUTPUT_FIELDS = [
    "node_label",
    "primary",
    "num_sources",
    "num_with_text",
    *(
        f"{dim}_{field}"
        for dim in DIMENSIONS
        for field in ("claim", "probability", "interval_low", "interval_high", "estimate", "range_80", "num_relevant", "flags")
    ),
    "design_status",
    "followup_queries",
    "followup_sources",
    "status",
    "detail_path",
]

TRL_DEFINITIONS = """\
TRL 1: Basic principles observed (initial scientific research).
TRL 2: Technology concept formulated (practical applications invented, still speculative).
TRL 3: Experimental proof of concept (analytical and laboratory validation of individual components).
TRL 4: Technology validated in lab (basic components integrated and tested in a low-fidelity lab setting).
TRL 5: Technology validated in relevant environment (components integrated with realistic supporting elements in a simulated environment).
TRL 6: Technology demonstrated in relevant environment (representative prototype tested in a high-fidelity simulated environment).
TRL 7: System prototype demonstration in operational environment (prototype near planned operational system tested in real-world conditions).
TRL 8: System complete and qualified (proven to work in its final form under expected conditions).
TRL 9: Actual system proven in operational environment (fully deployed and proven in real mission/commercial operations)."""

EVIDENCE_GUIDE = """\
Typical evidence -> TRL:
- concept or paper study only -> 2
- analytical work or lab proof of concept of the key principle -> 3
- components built and tested in a lab -> 4
- components/subsystem tested under realistic conditions (temperature, pressure, coolant, radiation) -> 5
- representative prototype tested in a high-fidelity relevant environment -> 6
- system prototype operated in a real plant / reactor / vehicle -> 7
- final system qualified or licensed, first units built -> 8
- in routine commercial or operational use -> 9"""

SYSTEM_PROMPT = """\
You are a technology-readiness analyst. You judge ONE source at a time and only
report what this source shows about the current maturity of one technology.
Base the judgement on the document excerpt and the deep-research notes
extracted from it; do not fill gaps with outside knowledge.

Judge two things separately:

1. technology: maturity of the technology or process itself, anywhere - in
   other reactors, ships, plants, test facilities or other industries.
   E.g. a motor proven in aviation, or shore refuelling done routinely for
   other floating reactors, supports a high technology TRL.
2. application: maturity of the technology specifically for/in the listed SMR
   designs - tests, prototypes, qualification or operation done for those
   designs. It can never be higher than the technology TRL.
   IGNORE the construction, licensing or certification status of the SMR
   designs themselves ("not built", "basic design stage", "not certified"):
   that is added separately from a reactor database. Only use statements
   about the technology in these designs.

For each give two bounds:
- at_least: the highest TRL this source shows has ALREADY been achieved
  (e.g. a prototype tested in a relevant environment -> 6). 1 if it shows nothing.
  A report of one test only proves "at least"; it does not say the technology
  is not more mature elsewhere.
- at_most: lower than 9 ONLY if the source explicitly states a limit on the
  technology itself (e.g. "not yet demonstrated outside the lab", "no
  commercial use yet", "issues must be solved before deployment"). Otherwise 9.
  Absence of a mention is NOT evidence of low maturity.
constrains=false if the source gives neither bound (at_least=1, at_most=9).
application.done_for_listed_design: true ONLY if the test, prototype,
qualification or operation was carried out with or for one of the listed SMR
designs. Generic tests by other parties, and vendor statements that a design
"meets TRL X" because it uses commercial / off-the-shelf parts, are false (they
are technology evidence).
Evidence about a related but different technology (e.g. uranium metal fuel
when judging thorium metal fuel, or turbines when judging motors) does not
count for either judgement. Answer with JSON only."""

_CONSTRAINT_SCHEMA = {
    "type": "object",
    "properties": {
        "constrains": {"type": "boolean"},
        "at_least": {"type": "integer", "minimum": 1, "maximum": 9},
        "at_most": {"type": "integer", "minimum": 1, "maximum": 9},
        "strength": {"type": "string", "enum": ["strong", "moderate", "weak"]},
    },
    "required": ["constrains", "at_least", "at_most", "strength"],
}

_APPLICATION_SCHEMA = {
    **_CONSTRAINT_SCHEMA,
    "properties": {**_CONSTRAINT_SCHEMA["properties"], "done_for_listed_design": {"type": "boolean"}},
    "required": [*_CONSTRAINT_SCHEMA["required"], "done_for_listed_design"],
}

JUDGEMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "technology": _CONSTRAINT_SCHEMA,
        "application": _APPLICATION_SCHEMA,
        "source_type": {
            "type": "string",
            "enum": [
                "peer_reviewed_or_government",
                "technical_report_or_conference",
                "company_or_vendor",
                "news_or_press",
                "other",
            ],
        },
        "maturity_facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"statement": {"type": "string"}, "quote": {"type": "string"}},
                "required": ["statement", "quote"],
            },
        },
        "limitations": {"type": "array", "items": {"type": "string"}},
        "rationale": {"type": "string"},
    },
    "required": ["technology", "application", "source_type", "maturity_facts", "limitations", "rationale"],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--node", action="append", help="only analyse this node label (repeatable)")
    parser.add_argument("--limit", type=int, default=None, help="only process the first N qualifying nodes")
    parser.add_argument("--refresh", action="store_true", help="re-run nodes, downloads and LLM judgements")
    parser.add_argument("--db", default="merged")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--think", action="store_true", help="let the model reason before answering (slower)")
    parser.add_argument(
        "--no-followup", action="store_true",
        help="skip the Tavily follow-up search for flagged claims and Tavily download recovery",
    )
    return parser.parse_args()


def slug_for(label: str) -> str:
    return label.lower().replace(" ", "-").replace("/", "-")


def load_data(db_name: str, labels: list[str] | None) -> tuple[list[dict], dict[str, dict]]:
    """Technologies to analyse, plus reactors by id and lower-cased name (for status lookup)."""
    load_dotenv(REPO_ROOT / ".env.local")
    db = MongoClient(os.environ["MONGODB_URI"])[db_name]
    query: dict = {"kind": "technology", "deployment.trl_band": {"$nin": [None, ""]}}
    if labels:
        query["name"] = {"$in": labels}
    docs = list(db["node_details"].find(query, {"_id": 0}).sort("name", 1))
    if labels:
        missing = set(labels) - {d["name"] for d in docs}
        if missing:
            raise SystemExit(f"No technology with a TRL band for: {', '.join(sorted(missing))}")
    reactors: dict[str, dict] = {}
    for r in db["nodes"].find({"type": "ReactorConcept"}, {"_id": 0, "id": 1, "label": 1, "smr.status": 1}):
        entry = {"id": r["id"], "name": r["label"], "status": (r.get("smr") or {}).get("status")}
        reactors[r["id"]] = entry
        reactors[r["label"].lower()] = entry
    return docs, reactors


def reactor_context(details: dict, reactors: dict[str, dict]) -> list[dict]:
    """SMR designs using the technology, with their dataset status (None if unknown)."""
    refs = list((details.get("enables") or {}).get("reactors") or [])
    refs += list((details.get("deployment") or {}).get("trl_per_reactor") or [])
    out: dict[str, dict] = {}
    for ref in refs:
        match = reactors.get(ref.get("id") or "") or reactors.get((ref.get("name") or "").lower())
        entry = match or {"id": ref.get("id"), "name": ref.get("name"), "status": None}
        if entry["name"]:
            out.setdefault((entry["id"] or entry["name"]).lower(), entry)
    return list(out.values())


def build_prompt(details: dict, reactor_names: list[str], source: Source, status: str, excerpt: str | None) -> str:
    aliases = ", ".join(details.get("aliases") or []) or "none"
    lines = [
        f"Technology: {details['name']} (aliases: {aliases}; category: {details.get('category')})",
        f"SMR designs using it: {', '.join(reactor_names) or 'not specified'}",
        "",
        TRL_DEFINITIONS,
        "",
        EVIDENCE_GUIDE,
        "",
        f"Source URL: {source.url}",
        f"Source title: {source.title or 'unknown'}",
        f"Download status: {status}",
        "",
        "Deep-research notes citing this source:",
    ]
    for note in source.notes or []:
        line = f"- [{note.kind}] {note.text}"
        if note.quote:
            found = note.quote_found or "not checked (no document text)"
            line += f'\n  quote: "{note.quote}" (found in document: {found})'
        lines.append(line)
    if not source.notes:
        lines.append("- none (listed as a consulted source only)")
    lines += [
        "",
        "Document excerpt:" if excerpt else "Document text: unavailable. Judge from the notes only, conservatively.",
    ]
    if excerpt:
        lines += ['"""', excerpt, '"""']
    lines += [
        "",
        "Fields: technology {constrains, at_least, at_most, strength},",
        "application {constrains, at_least, at_most, strength, done_for_listed_design}, source_type,",
        "maturity_facts (short statement + verbatim quote from the excerpt), limitations,",
        "rationale (2-4 sentences covering both judgements).",
    ]
    return "\n".join(lines)


def _clean_constraint(raw: dict) -> dict:
    low, high = sorted((min(max(int(raw["at_least"]), 1), 9), min(max(int(raw["at_most"]), 1), 9)))
    constrains = bool(raw["constrains"]) and (low, high) != (1, 9)
    if not constrains:
        low, high = 1, 9
    return {
        **{k: v for k, v in raw.items() if k == "done_for_listed_design"},
        "constrains": constrains,
        "at_least": low,
        "at_most": high,
        "trl_low": low,
        "trl_high": high,
        "strength": raw["strength"],
    }


def chat_json(client: httpx.Client, model: str, system: str, prompt: str, schema: dict, think: bool) -> dict:
    response = client.post(
        "/api/chat",
        json={
            "model": model,
            "stream": False,
            "think": think,
            "format": schema,
            "options": {"temperature": 0, "seed": 0, "num_ctx": NUM_CTX},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        },
    )
    response.raise_for_status()
    return json.loads(response.json()["message"]["content"])


def judge_source(client: httpx.Client, model: str, prompt: str, think: bool) -> dict:
    judgement = chat_json(client, model, SYSTEM_PROMPT, prompt, JUDGEMENT_SCHEMA, think)
    # only work done with/for the listed designs can raise the application TRL;
    # explicit limits (at_most) still count
    if not judgement["application"].get("done_for_listed_design"):
        judgement["application"]["at_least"] = 1
    for dim in DIMENSIONS:
        judgement[dim] = _clean_constraint(judgement[dim])
    # the application TRL cannot exceed the technology TRL
    tech, app = judgement["technology"], judgement["application"]
    if tech["constrains"] and app["constrains"]:
        app["trl_high"] = app["at_most"] = min(app["trl_high"], tech["trl_high"])
        app["trl_low"] = app["at_least"] = min(app["trl_low"], app["trl_high"])
    judgement["relevant"] = tech["constrains"] or app["constrains"]
    return judgement


def load_cache(detail_path: Path, model: str, think: bool) -> tuple[dict[str, dict], dict[str, dict]]:
    """Per-source judgements and model-proposed follow-up queries of a previous run."""
    if not detail_path.exists():
        return {}, {}
    detail = json.loads(detail_path.read_text())
    if (detail.get("model"), detail.get("prompt_version"), detail.get("think", False)) != (model, PROMPT_VERSION, think):
        return {}, {}
    judgements = {e["url"]: e["judgement"] for e in detail.get("evidence", []) if e.get("url") and e.get("judgement")}
    proposals = {
        q["claim"]: {"query": q["query"], "question": q.get("question")}
        for q in (detail.get("followup") or {}).get("queries", [])
        if q.get("origin") == "model"
    }
    return judgements, proposals


def to_constraint(raw: dict) -> Constraint:
    return Constraint(raw["constrains"], raw["trl_low"], raw["trl_high"], raw["strength"])


class NodeRun:
    """Shared state for judging the sources of one technology."""

    def __init__(self, details: dict, designs: list[dict], args: argparse.Namespace, client: httpx.Client,
                 tavily: Tavily | None, cached: dict[str, dict]) -> None:
        self.details, self.designs, self.args, self.client = details, designs, args, client
        self.tavily, self.cached = tavily, cached
        self.phrases, self.words = name_terms(details["name"], details.get("aliases") or [])
        self.cache_dir = args.output_dir / "docs" / slug_for(details["name"])
        self.entries: list[dict] = []
        self.judgements: list[SourceJudgement] = []

    def text_for(self, source: Source, raw_content: str | None = None) -> tuple[str | None, str]:
        if raw_content and len(raw_content) >= MIN_TEXT_CHARS:
            return raw_content, "ok (tavily)"
        text, status = fetch_text(source.url, self.cache_dir, self.args.refresh)
        if text is None and self.tavily is not None:
            recovered = self.tavily.extract(source.url)
            if recovered and len(recovered) >= MIN_TEXT_CHARS:
                return recovered, f"ok (tavily extract; direct: {status})"
        return text, status

    def judge(self, source: Source, origin: str, raw_content: str | None = None, query: str | None = None) -> None:
        text, dl_status = self.text_for(source, raw_content)
        check_quotes(source, text)
        excerpt = build_excerpt(text, source, self.phrases, self.words) if text else None
        judgement = self.cached.get(source.url)
        if judgement is None:
            prompt = build_prompt(self.details, [d["name"] for d in self.designs], source, dl_status, excerpt)
            judgement = judge_source(self.client, self.args.model, prompt, self.args.think)
        t, a = judgement["technology"], judgement["application"]
        print(
            f"    [{len(self.entries) + 1}{'*' if origin != 'deep_research' else ''}] {domain_of(source.url)}: {dl_status}; "
            f"tech {t['trl_low']}-{t['trl_high']} {t['strength'] if t['constrains'] else '-'}; "
            f"app {a['trl_low']}-{a['trl_high']} {a['strength'] if a['constrains'] else '-'}"
        )
        self.judgements.append(
            SourceJudgement(
                url=source.url,
                technology=to_constraint(t),
                application=to_constraint(a),
                source_type=judgement["source_type"],
                text_available=text is not None,
            )
        )
        self.entries.append(
            {
                "kind": "source",
                "origin": origin,
                "query": query,
                "file": source.title or domain_of(source.url),
                "url": source.url,
                "title": source.title,
                "download_status": dl_status,
                "text_chars": len(text) if text else 0,
                "excerpt_chars": len(excerpt) if excerpt else 0,
                "notes": [asdict(n) for n in source.notes],
                "judgement": judgement,
                "relevant": judgement["relevant"],
                "redundant": False,
            }
        )


def plan_followup(run: NodeRun, results: dict[str, dict], proposals: dict[str, dict]) -> list[dict]:
    """Template + model-proposed queries for every flagged claim (bounded)."""
    queries: list[dict] = []
    names = [d["name"] for d in run.designs]
    for dim in flagged_claims(results):
        planned = [{"claim": dim, "origin": "template", "query": q} for q in template_queries(run.details["name"], names, dim)]
        proposal = proposals.get(dim)
        if proposal is None:
            raw = chat_json(
                run.client, run.args.model, PROPOSE_SYSTEM,
                proposal_prompt(run.details["name"], names, dim, results[dim], run.entries),
                PROPOSE_SCHEMA, run.args.think,
            )
            proposal = {"query": raw.get("query", ""), "question": raw.get("question")}
        query = clean_query(proposal["query"])
        if query:
            planned.append({"claim": dim, "origin": "model", "query": query, "question": proposal.get("question")})
        else:
            print(f"    model-proposed query rejected (not neutral): {proposal['query']!r}")
        queries += planned[:MAX_QUERIES_PER_CLAIM]
    return queries


def run_followup(run: NodeRun, queries: list[dict]) -> int:
    """Search, de-duplicate against everything already judged, judge new pages."""
    seen_urls = {url_key(e["url"]) for e in run.entries if e.get("url")}
    # syndicated copies (same press release on several finance sites) share the title
    seen_titles = {title_key(e["title"]) for e in run.entries if len(title_key(e.get("title") or "")) >= 20}
    added = 0
    for q in queries:
        results = run.tavily.search(q["query"])
        q.update(results=len(results), new_sources=0, duplicates=0, off_topic=0)
        for r in results:
            if added >= MAX_NEW_SOURCES_PER_NODE:
                break
            key, tkey = url_key(r["url"]), title_key(r["title"])
            if key in seen_urls or (len(tkey) >= 20 and tkey in seen_titles):
                q["duplicates"] += 1
                continue
            seen_urls.add(key)
            seen_titles.add(tkey)
            if not mentions_technology(f"{r['title']}\n{r['content']}\n{r['raw_content']}", run.phrases):
                q["off_topic"] += 1
                continue
            source = Source(url=r["url"], title=r["title"], notes=[SourceNote("followup", f"found by search: {q['query']}")])
            run.judge(source, origin="infact_followup", raw_content=r["raw_content"], query=q["query"])
            q["new_sources"] += 1
            added += 1
    return added


def analyse_node(
    details: dict, reactors: dict[str, dict], args: argparse.Namespace, client: httpx.Client,
    tavily: Tavily | None, detail_path: Path,
) -> dict:
    deployment = details["deployment"]
    claims = {"technology": deployment.get("trl_family"), "application": deployment["trl_band"]}
    bands = {dim: parse_band(claim) for dim, claim in claims.items()}
    if not bands["application"]:
        raise RuntimeError(f"unparseable TRL band {claims['application']!r}")
    primary = "technology" if bands["technology"] else "application"

    designs = reactor_context(details, reactors)
    status = design_status([d["status"] for d in designs])
    cached, proposals = ({}, {}) if args.refresh else load_cache(detail_path, args.model, args.think)
    run = NodeRun(details, designs, args, client, tavily, cached)

    print(
        f"    design status: {status.category or 'unknown'}"
        f"{f' ({status.unknown_designs} design(s) unknown)' if status.unknown_designs else ''}"
        f" <- {', '.join(f'{d['name']}: {d['status'] or '?'}' for d in designs) or 'no designs'}"
    )
    for source in collect_sources(deployment):
        run.judge(source, origin="deep_research")
    scored = score(run.judgements, status, bands)

    followup = None
    if tavily is not None:
        queries = plan_followup(run, scored["results"], proposals)
        if queries:
            print(f"    follow-up: {len(queries)} queries for {', '.join(flagged_claims(scored['results']))}")
            added = run_followup(run, queries)
            followup = {
                "flagged": flagged_claims(scored["results"]),
                "queries": queries,
                "new_sources": added,
                "results_before": {
                    dim: {k: v for k, v in r.items() if k != "distribution"} for dim, r in scored["results"].items()
                },
            }
            if added:
                scored = score(run.judgements, status, bands)

    status_entry = {
        "kind": "design_status",
        "origin": "reactor_dataset",
        "file": "Design status of the SMR designs (reactor dataset)",
        "url": None,
        "designs": designs,
        "category": status.category,
        "unknown_designs": status.unknown_designs,
        "relevant": status.weight > 0,
        "redundant": False,
    }
    entries = [status_entry, *run.entries]
    for entry, step, judgement in zip(entries, scored["steps"], [None, *run.judgements]):
        entry["weights"] = (
            {"technology": 0.0, "application": status.weight} if judgement is None else judgement.weights
        )
        entry["steps"] = step
        # flat fields of the primary claim, read by the app's InFact ingestion
        entry.update(step[primary], posterior=step[primary]["probability"])

    return {
        "method": "infact-v2",
        "prompt_version": PROMPT_VERSION,
        "model": args.model,
        "think": args.think,
        "node_id": details["id"],
        "node_label": details["name"],
        "primary": primary,
        "trl_current": claims[primary],
        "claims": claims,
        "hypothesis": (
            f"Deep research claims {details['name']} is at technology TRL {claims['technology'] or 'n/a'} "
            f"and at TRL {claims['application']} in {', '.join(d['name'] for d in designs) or 'its SMR designs'}."
        ),
        "claim": {
            key: deployment.get(key)
            for key in ("trl_band", "trl_family", "availability", "trl_basis", "confidence", "trl_rationale")
        },
        "results": scored["results"],
        "followup": followup,
        "evidence": entries,
    }


def load_existing_rows(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with path.open() as f:
        return {row["node_label"]: row for row in csv.DictReader(f)}


def save_rows(path: Path, rows: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows.values())


def summary_row(detail: dict) -> dict:
    row = {
        "primary": detail["primary"],
        "num_sources": sum(1 for e in detail["evidence"] if e.get("origin") == "deep_research"),
        "followup_queries": len((detail.get("followup") or {}).get("queries", [])),
        "followup_sources": (detail.get("followup") or {}).get("new_sources", 0),
        "num_with_text": sum(1 for e in detail["evidence"] if e.get("text_chars")),
        "design_status": detail["evidence"][0]["category"] or "unknown",
        "status": "ok",
    }
    for dim in DIMENSIONS:
        r = detail["results"][dim]
        row.update(
            {
                f"{dim}_claim": detail["claims"][dim] or "",
                f"{dim}_probability": round(r["probability"], 4) if "probability" in r else "",
                f"{dim}_interval_low": round(r["interval"][0], 4) if "interval" in r else "",
                f"{dim}_interval_high": round(r["interval"][1], 4) if "interval" in r else "",
                f"{dim}_estimate": r["trl_estimate"],
                f"{dim}_range_80": "-".join(map(str, r["trl_credible_range_80"])),
                f"{dim}_num_relevant": r["num_relevant"],
                f"{dim}_flags": ";".join(r["flags"]),
            }
        )
    return row


def describe(dim: str, claim: str | None, r: dict) -> str:
    p = f"P(TRL {claim})={r['probability']:.3f} [{r['interval'][0]:.3f}, {r['interval'][1]:.3f}]  " if claim else ""
    low, high = r["trl_credible_range_80"]
    return f"    {dim:<11} {p}median TRL {r['trl_estimate']} (80%: {low}-{high})  flags={r['flags'] or '-'}"


def main() -> None:
    args = parse_args()
    technologies, reactors = load_data(args.db, args.node)
    if args.limit:
        technologies = technologies[: args.limit]

    csv_path = args.output_dir / "node-infact-results.csv"
    details_dir = args.output_dir / "node-infact-details"
    rows = {} if args.refresh else load_existing_rows(csv_path)

    with httpx.Client(base_url=args.ollama_url, timeout=httpx.Timeout(LLM_TIMEOUT_SECONDS)) as client:
        try:
            models = [m["name"] for m in client.get("/api/tags").raise_for_status().json()["models"]]
        except httpx.HTTPError as exc:
            raise SystemExit(f"Cannot reach Ollama at {args.ollama_url}: {exc}") from exc
        if args.model not in models:
            raise SystemExit(f"Model {args.model!r} not available on {args.ollama_url}: {models}")

        tavily = None
        if not args.no_followup:
            key = load_tavily_key()
            if key:
                tavily = Tavily(key, args.output_dir / "tavily-cache")
            else:
                print("! no TAVILY_API_KEY found: follow-up search and download recovery disabled")

        for i, details in enumerate(technologies, 1):
            label = details["name"]
            if not args.node and rows.get(label, {}).get("status") == "ok":
                print(f"[{i}/{len(technologies)}] {label}: skipping (already done)")
                continue
            dep = details["deployment"]
            print(f"[{i}/{len(technologies)}] {label} (claimed technology TRL {dep.get('trl_family')}, application TRL {dep['trl_band']})")
            detail_path = details_dir / f"{slug_for(label)}.json"
            rel_path = detail_path.relative_to(REPO_ROOT) if detail_path.is_relative_to(REPO_ROOT) else detail_path
            row = {"node_label": label, "detail_path": str(rel_path)}
            try:
                detail = analyse_node(details, reactors, args, client, tavily, detail_path)
            except (httpx.HTTPError, RuntimeError, KeyError, ValueError) as exc:
                row["status"] = f"error: {exc}"
                print(f"    error: {exc}")
            else:
                detail_path.parent.mkdir(parents=True, exist_ok=True)
                detail_path.write_text(json.dumps(detail, indent=2, ensure_ascii=False))
                row.update(summary_row(detail))
                for dim in DIMENSIONS:
                    print(describe(dim, detail["claims"][dim], detail["results"][dim]))
            rows[label] = row
            save_rows(csv_path, rows)

        if tavily is not None:
            print(f"\nTavily: {tavily.calls} new API calls (rest cached), {tavily.failures} failed")
            tavily.close()

    print(f"\nresults written to {csv_path}")


if __name__ == "__main__":
    main()
