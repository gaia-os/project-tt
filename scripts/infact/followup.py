"""Gap-driven follow-up search for InFact v2 (Tavily).

After the first scoring pass, claims that are flagged (insufficient evidence,
disputed) get one bounded search round:

* 2 fixed, neutral template queries per flagged claim (one looking for
  achieved maturity, one for stated limitations), and
* 1 model-proposed query targeting the most important open question, built
  from the gaps and limitations found so far.

Queries never contain the claimed TRL or the word "TRL", so the search cannot
be steered towards confirming the claim. Results already used by deep research
are skipped; new pages are judged exactly like the original sources.

Tavily is also used to recover the text of sources whose direct download
failed (`/extract`). The API key is read from $TAVILY_API_KEY or from the
dotenv file in $INFACT_TAVILY_ENV (default ~/Documents/smr-info-extraction/.env_local);
it is never written anywhere. Every Tavily response is cached on disk.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
from evidence import STOPWORDS, normalise

TAVILY_URL = "https://api.tavily.com"
DEFAULT_KEY_FILE = Path.home() / "Documents" / "smr-info-extraction" / ".env_local"
MAX_RESULTS = 5
MAX_RAW_CHARS = 60000
FOLLOWUP_FLAGS = {"insufficient_evidence", "claim_disputed"}
MAX_QUERIES_PER_CLAIM = 3
MAX_NEW_SOURCES_PER_NODE = 12
FORBIDDEN_QUERY = re.compile(r"\btrl\b|readiness level|\b[1-9]\s*-\s*[1-9]\b", re.IGNORECASE)


def load_tavily_key() -> str | None:
    if os.environ.get("TAVILY_API_KEY"):
        return os.environ["TAVILY_API_KEY"]
    path = Path(os.environ.get("INFACT_TAVILY_ENV", DEFAULT_KEY_FILE)).expanduser()
    if not path.exists():
        return None
    for line in path.read_text().splitlines():
        key, _, value = line.strip().partition("=")
        if key.removeprefix("export ").strip() == "TAVILY_API_KEY":
            return value.strip().strip("'\"") or None
    return None


class Tavily:
    """Minimal cached Tavily client (search + extract)."""

    def __init__(self, api_key: str, cache_dir: Path, timeout: float = 60.0) -> None:
        self.api_key = api_key
        self.cache_dir = cache_dir
        self.client = httpx.Client(base_url=TAVILY_URL, timeout=timeout)
        self.calls = 0
        self.failures = 0

    def _cached_post(self, endpoint: str, params: dict) -> dict | None:
        key = hashlib.sha256(json.dumps({"endpoint": endpoint, **params}, sort_keys=True).encode()).hexdigest()
        cache_file = self.cache_dir / f"{key}.json"
        if cache_file.exists():
            return json.loads(cache_file.read_text())
        try:
            response = self.client.post(f"/{endpoint}", json={**params, "api_key": self.api_key})
            response.raise_for_status()
        except httpx.HTTPError as exc:
            self.failures += 1
            print(f"    ! Tavily {endpoint} failed ({type(exc).__name__}); continuing without it")
            return None  # not cached: transient failures are retried next run
        self.calls += 1
        data = response.json()
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps({"params": params, "response": data}, ensure_ascii=False))
        time.sleep(0.15)
        return {"params": params, "response": data}

    def search(self, query: str) -> list[dict]:
        params = {"query": query, "max_results": MAX_RESULTS, "include_raw_content": True, "topic": "general"}
        cached = self._cached_post("search", params)
        if not cached:
            return []
        return [
            {
                "url": r.get("url", ""),
                "title": r.get("title") or r.get("url", ""),
                "content": r.get("content") or "",
                "raw_content": (r.get("raw_content") or "")[:MAX_RAW_CHARS],
            }
            for r in cached["response"].get("results", [])
            if r.get("url")
        ]

    def extract(self, url: str) -> str | None:
        cached = self._cached_post("extract", {"urls": [url]})
        if not cached:
            return None
        for r in cached["response"].get("results", []):
            if r.get("raw_content"):
                return r["raw_content"][:MAX_RAW_CHARS]
        return None

    def close(self) -> None:
        self.client.close()


def url_key(url: str) -> str:
    """Normalise a URL for de-duplication (scheme, www, trailing slash, fragment)."""
    p = urlparse(url.strip())
    host = p.netloc.lower().removeprefix("www.")
    path = p.path.rstrip("/")
    return f"{host}{path}" + (f"?{p.query}" if p.query else "")


def title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()


def mentions_technology(text: str, phrases: list[str]) -> bool:
    """Cheap pre-filter for search hits: the page must name the technology —
    the full name or an alias, or most significant words of one of them."""
    norm = normalise(text)
    tokens = set(norm.split())

    def present(word: str) -> bool:
        # stem match covers refuelling / refueling / refuelled, motor / motors, ...
        stem = word[:6] if len(word) > 6 else word
        return any(t.startswith(stem) for t in tokens)

    for phrase in phrases:
        if phrase and phrase in norm:
            return True
        words = [w for w in phrase.split() if len(w) > 3 and w not in STOPWORDS]
        if len(words) >= 2 and sum(present(w) for w in words) >= math.ceil(0.75 * len(words)):
            return True
    return False


def flagged_claims(results: dict[str, dict]) -> list[str]:
    return [dim for dim, r in results.items() if FOLLOWUP_FLAGS & set(r.get("flags", []))]


def template_queries(name: str, designs: list[str], dim: str) -> list[str]:
    """Two neutral queries per claim: achieved maturity + stated limitations."""
    if dim == "technology":
        # many names are ambiguous on the open web ("shore refuelling", "industrial valves")
        context = "" if "nuclear" in name.lower() or "reactor" in name.lower() else " nuclear reactor"
        return [
            f"{name}{context} operating experience in service demonstrated",
            f"{name}{context} development challenges limitations not yet demonstrated",
        ]
    scope = " ".join(designs[:2]) or "small modular reactor"
    return [
        f"{scope} {name} testing prototype qualification",
        f"{scope} {name} development status open issues",
    ]


def clean_query(query: str) -> str | None:
    """Reject queries that would steer the search towards a TRL value."""
    query = re.sub(r"\s+", " ", (query or "").replace('"', " ")).strip()
    if not query or len(query) > 200 or FORBIDDEN_QUERY.search(query):
        return None
    return query


PROPOSE_SYSTEM = """\
You plan ONE web search to fill the most important gap in an evidence base
about the current maturity of a technology. The query must be neutral: it must
not contain any TRL number, the word "TRL" or a guessed maturity level, and it
must not presuppose the answer. Prefer queries that can find primary sources
(test reports, operating experience, regulator documents) or check whether a
stated limitation has since been resolved. Answer with JSON only."""

PROPOSE_SCHEMA = {
    "type": "object",
    "properties": {"question": {"type": "string"}, "query": {"type": "string"}},
    "required": ["question", "query"],
}


def proposal_prompt(name: str, designs: list[str], dim: str, result: dict, entries: list[dict]) -> str:
    what = (
        "maturity of the technology anywhere (other reactors, industries, test facilities)"
        if dim == "technology"
        else f"maturity of the technology in these SMR designs: {', '.join(designs) or 'not specified'}"
    )
    facts, limitations = [], []
    for e in entries:
        j = e.get("judgement")
        if not j or not j.get("relevant"):
            continue
        facts += [f["statement"] for f in j.get("maturity_facts", [])][:2]
        limitations += j.get("limitations", [])[:2]
    low, high = result["trl_credible_range_80"]
    lines = [
        f"Technology: {name}",
        f"Question: {what}",
        (
            f"Current evidence is weak: {result['num_relevant']} constraining items, plausible range still spans "
            f"{high - low + 1} maturity levels."
        ),
        "Facts found so far:",
        *([f"- {f}" for f in facts[:8]] or ["- none"]),
        "Limitations / open points mentioned:",
        *([f"- {x}" for x in limitations[:8]] or ["- none"]),
        "",
        "Return the open question you want to answer and one web search query (max 15 words).",
    ]
    return "\n".join(lines)
