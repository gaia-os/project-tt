"""Collect, download and prepare the deep-research evidence of one technology.

Sources come from the `deployment` block of the technology's `node_details`
document (evidence, suppliers, milestones, sources, learnings, per-reactor TRL
links), grouped by URL so every URL is judged once with all deep-research
notes that cite it.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import unicodedata
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

import requests
from pypdf import PdfReader

# Several publishers (ANL, phys.org) reject non-browser user agents.
DOWNLOAD_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
DOWNLOAD_TIMEOUT = 30
MIN_TEXT_CHARS = 300
CHUNK_CHARS = 900
EXCERPT_CHARS = 12000
HEAD_CHARS = 600
MATURITY_TERMS = (
    "prototype", "demonstrat", "tested", "test ", "testing", "qualif", "certif", "licens",
    "commercial", "operat", "deploy", "pilot", "laboratory", "lab-scale", "design", "concept",
    "trl", "readiness", "in service", "first-of-a-kind", "foak", "construction",
)
STOPWORDS = {"and", "the", "for", "with", "from", "system", "systems", "technology"}


@dataclass
class SourceNote:
    kind: str  # evidence | learning | milestone | supplier | per_reactor_trl | source
    text: str
    quote: str | None = None
    verified: str | None = None
    quote_found: str | None = None  # exact | approximate | missing | None (no text / no quote)


@dataclass
class Source:
    url: str
    title: str | None = None
    notes: list[SourceNote] = field(default_factory=list)


def collect_sources(deployment: dict) -> list[Source]:
    """Group every URL-bearing deep-research item by URL, in first-seen order."""
    by_url: dict[str, Source] = {}

    def add(url: str | None, note: SourceNote | None = None, title: str | None = None) -> None:
        if not url:
            return
        source = by_url.setdefault(url, Source(url=url))
        if title and not source.title:
            source.title = title
        if note:
            source.notes.append(note)

    for e in deployment.get("evidence") or []:
        add(e.get("url"), SourceNote("evidence", f"claim: {e.get('claim')}", e.get("quote"), e.get("verified")))
    for learning in (deployment.get("deep_research") or {}).get("learnings") or []:
        add(learning.get("url"), SourceNote("learning", learning.get("fact") or "", learning.get("quote"), learning.get("verified")))
    for m in deployment.get("milestones") or []:
        add(m.get("url"), SourceNote("milestone", f"{m.get('date')}: {m.get('event')}"))
    for s in deployment.get("suppliers") or []:
        add(s.get("url"), SourceNote("supplier", f"{s.get('name')} ({s.get('role') or 'role not stated'})"))
    for r in deployment.get("trl_per_reactor") or []:
        add(r.get("url"), SourceNote("per_reactor_trl", f"cited for reactor {r.get('name')}"))
    for s in deployment.get("sources") or []:
        add(s.get("url"), title=s.get("title"))
    return list(by_url.values())


class _TextExtractor(HTMLParser):
    SKIP = frozenset({"script", "style", "noscript", "svg", "nav", "footer", "header", "form"})
    BLOCK = frozenset({"p", "div", "li", "br", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "td"})

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self.SKIP:
            self.skip_depth += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self.skip_depth:
            self.skip_depth -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    text = "".join(parser.parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def pdf_to_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages).strip()


def fetch_text(url: str, cache_dir: Path, refresh: bool = False) -> tuple[str | None, str]:
    """Download `url` and return (text, status); results are cached on disk."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    text_path, meta_path = cache_dir / f"{key}.txt", cache_dir / f"{key}.json"
    if meta_path.exists() and not refresh:
        meta = json.loads(meta_path.read_text())
        if not meta["status"].startswith("download_failed"):
            return (text_path.read_text() if text_path.exists() else None), meta["status"]

    text, status = None, "ok"
    try:
        resp = requests.get(url, headers=DOWNLOAD_HEADERS, timeout=DOWNLOAD_TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "").split(";")[0].strip().lower()
        if content_type == "application/pdf" or resp.content[:5] == b"%PDF-":
            text = pdf_to_text(resp.content)
        else:
            text = html_to_text(resp.text)
        if len(text) < MIN_TEXT_CHARS:
            text, status = None, "too_little_text"
    except requests.RequestException as exc:
        status = f"download_failed: {type(exc).__name__}"
    except Exception as exc:  # noqa: BLE001 - broken PDFs raise many different errors
        status = f"extract_failed: {type(exc).__name__}"

    if text:
        text_path.write_text(text)
    meta_path.write_text(json.dumps({"url": url, "status": status}))
    return text, status


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"[\u2010-\u2015\u2212]", "-", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _ngrams(words: list[str], n: int = 4) -> set[tuple[str, ...]]:
    return {tuple(words[i : i + n]) for i in range(max(len(words) - n + 1, 1))}


def quote_match(quote: str, normalised_text: str) -> str:
    q = normalise(quote)
    if not q:
        return "missing"
    if q in normalised_text:
        return "exact"
    text_grams = _ngrams(normalised_text.split())
    quote_grams = _ngrams(q.split())
    overlap = len(quote_grams & text_grams) / len(quote_grams)
    return "approximate" if overlap >= 0.6 else "missing"


def check_quotes(source: Source, text: str | None) -> None:
    if not text:
        return
    normalised_text = normalise(text)
    for note in source.notes:
        if note.quote:
            note.quote_found = quote_match(note.quote, normalised_text)


def name_terms(name: str, aliases: list[str]) -> tuple[list[str], list[str]]:
    phrases = [normalise(n) for n in [name, *aliases] if n]
    words = sorted({w for p in phrases for w in p.split() if len(w) > 3 and w not in STOPWORDS})
    return phrases, words


def build_excerpt(text: str, source: Source, phrases: list[str], words: list[str]) -> str:
    """Pick the chunks most likely to speak about this technology's maturity."""
    if len(text) <= EXCERPT_CHARS:
        return text
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    for p in paragraphs:
        for i in range(0, len(p), CHUNK_CHARS):
            chunks.append(p[i : i + CHUNK_CHARS])

    quote_grams = [_ngrams(normalise(n.quote).split()) for n in source.notes if n.quote]
    scored = []
    for idx, chunk in enumerate(chunks):
        norm = normalise(chunk)
        grams = _ngrams(norm.split())
        score = 0.0
        score += sum(8 for qg in quote_grams if qg and len(qg & grams) / len(qg) > 0.3)
        score += sum(4 for p in phrases if p and p in norm)
        score += sum(1 for w in words if w in norm)
        score += 0.5 * sum(1 for t in MATURITY_TERMS if t in norm)
        scored.append((score, idx))

    picked, total = set(), 0
    for score, idx in sorted(scored, key=lambda s: (-s[0], s[1])):
        if score <= 0 or total + len(chunks[idx]) > EXCERPT_CHARS - HEAD_CHARS:
            continue
        picked.add(idx)
        total += len(chunks[idx])
    body = "\n[...]\n".join(chunks[i] for i in sorted(picked))
    return f"{text[:HEAD_CHARS]}\n[...]\n{body}"
