"""LLM relevance verification for enrichment links.

Runs inside enrich.py (offline, at build time — never per-click). For each
tech-tree node, one chat call judges every candidate entity's relevance;
rejected items are moved to meta.rejected for audit.
"""

from __future__ import annotations

import json
import re
from typing import Any

import ollama

_PROMPT = """\
You are filtering candidate literature links for a fusion-energy technology tree.

Tech tree node: "{label}" (category: {category}){description}

Candidate items extracted from a knowledge graph of 1960s-70s fusion research
conference papers:

{items}

For EACH item decide whether it is genuinely relevant evidence or historical
context for THIS node. Keep items about the node's concept, physics, or
technology (including historical work that established its foundations).
Drop items that are unrelated technologies, unrelated domains, or only share
a coincidental word with the node label.

Answer ONLY with JSON:
{{"verdicts": [{{"id": <item number>, "keep": true|false, "reason": "short"}}]}}"""


def _item_line(i: int, e: dict[str, Any]) -> str:
    if e["kind"] == "paper":
        p = e.get("paper") or {}
        year = f" ({p['year']})" if p.get("year") else ""
        return f"{i}. [paper] \"{p.get('title') or e['name']}\"{year}"
    if e["kind"] == "device":
        d = e.get("device") or {}
        ct = f" ({d['configurationType']})" if d.get("configurationType") else ""
        return f"{i}. [device] {e['name']}{ct}"
    return f"{i}. [finding] \"{e.get('summary') or e['name']}\""


def verify_entities(
    client: ollama.Client,
    model: str,
    node_label: str,
    node_category: str | None,
    node_description: str | None,
    entities: list[dict[str, Any]],
    num_ctx: int = 8192,
) -> dict[str, dict[str, Any]] | None:
    """Ask the LLM which entities are relevant. Returns {entity.id: verdict}
    or None if the model output could not be parsed."""
    if not entities:
        return {}

    items = "\n".join(_item_line(i + 1, e) for i, e in enumerate(entities))
    desc = f'\nNode description: "{node_description[:400]}"' if node_description else ""
    prompt = _PROMPT.format(
        label=node_label,
        category=node_category or "unknown",
        description=desc,
        items=items,
    )

    try:
        resp = client.chat(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            format="json",
            options={"temperature": 0, "num_ctx": num_ctx},
        )
        data = json.loads(resp.message.content)
    except (json.JSONDecodeError, KeyError, TypeError, ollama.ResponseError):
        return None

    verdicts = data.get("verdicts") if isinstance(data, dict) else None
    if not isinstance(verdicts, list):
        return None

    out: dict[str, dict[str, Any]] = {}
    for v in verdicts:
        try:
            idx = int(v["id"]) - 1
            if 0 <= idx < len(entities):
                out[entities[idx]["id"]] = {
                    "keep": bool(v.get("keep")),
                    "reason": str(v.get("reason", ""))[:200],
                }
        except (KeyError, TypeError, ValueError):
            continue
    return out


_REASON_STRIP_RE = re.compile(r"^\s*(concept|milestone|enabling\s+tech[nology]*)\s*:\s*", re.I)


def split_by_verdict(
    entities: list[dict[str, Any]],
    verdicts: dict[str, dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split entities into (kept, rejected). Unverifiable/unknown -> kept."""
    kept, rejected = [], []
    for e in entities:
        v = (verdicts or {}).get(e["id"])
        if v is None:
            e2 = dict(e)
            e2["verification"] = None
            kept.append(e2)
        elif v["keep"]:
            e2 = dict(e)
            e2["verification"] = {"keep": True, "reason": v["reason"]}
            kept.append(e2)
        else:
            rejected.append({**e, "verification": {"keep": False, "reason": v["reason"]}})
    return kept, rejected
