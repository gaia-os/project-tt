"""Run the stateless /analyze API over every tech-tree node that has a
`trl_current` value and at least `--min-accessible` reachable reference
links, and save a tidy summary CSV of the results.

Requires outputs/node-refs-check.csv to exist first:
    uv run scripts/infact/check_node_refs.py

Usage:
    uv run scripts/infact/analyze_all_nodes.py [--min-accessible 2] [--limit 20] [--refresh] [--db merged]

Resumes automatically: nodes already present in the output CSV are skipped
unless --refresh is passed.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

import httpx
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REFS_CSV = REPO_ROOT / "outputs" / "node-refs-check.csv"
DOCS_ROOT = Path(__file__).parent / "docs"
DETAILS_DIR = REPO_ROOT / "outputs" / "node-infact-details"
API_URL = "http://127.0.0.1:8007"
API_KEY = os.getenv("INFACT_API_KEY")
PRIOR_LOG_ODDS = 0.0
TIMEOUT_SECONDS = 600.0

DOWNLOAD_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; project-tt-link-check/1.0)"}
EXTENSION_BY_CONTENT_TYPE = {
    "application/pdf": ".pdf",
    "text/html": ".html",
    "text/plain": ".txt",
}
OUTPUT_FIELDS = [
    "node_label",
    "trl_current",
    "num_references",
    "num_accessible",
    "num_evidence_used",
    "final_log_odds",
    "final_probability",
    "interval_low",
    "interval_high",
    "status",
    "detail_path",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--min-accessible", type=int, default=1)
    parser.add_argument("--limit", type=int, default=None, help="only process the first N qualifying nodes")
    parser.add_argument("--refresh", action="store_true", help="re-process nodes already in the output csv")
    parser.add_argument("--db", default="merged")
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "outputs" / "node-infact-results.csv")
    return parser.parse_args()


def load_accessible_refs_by_node() -> dict[str, list[str]]:
    if not REFS_CSV.exists():
        raise SystemExit(f"{REFS_CSV} not found. Run check_node_refs.py first.")
    refs: dict[str, list[str]] = defaultdict(list)
    with REFS_CSV.open() as f:
        for row in csv.DictReader(f):
            if row["accessible"] == "True":
                refs[row["node_label"]].append(row["url"])
    return refs


def load_trl_by_node(db_name: str) -> tuple[dict[str, str], int]:
    load_dotenv(REPO_ROOT / ".env.local")
    client = MongoClient(os.environ["MONGODB_URI"])
    coll = client[db_name]["nodes"]
    total_nodes = coll.count_documents({})
    trl_by_label = {}
    for doc in coll.find({"trl_current": {"$exists": True, "$ne": None}}, {"label": 1, "trl_current": 1}):
        trl_by_label[doc["label"]] = doc["trl_current"]
    return trl_by_label, total_nodes


def mime_for(path: Path) -> str:
    return {
        ".pdf": "application/pdf",
        ".html": "text/html",
        ".txt": "text/plain",
    }.get(path.suffix, "application/octet-stream")


def download_references(urls: list[str], dest_dir: Path, refresh: bool) -> list[tuple[str, Path]]:
    manifest_path = dest_dir / "_manifest.json"
    if dest_dir.exists() and not refresh and manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        existing = sorted(dest_dir.glob("*"))
        pairs = [(manifest[p.name], p) for p in existing if p.name in manifest]
        if pairs:
            return pairs

    dest_dir.mkdir(parents=True, exist_ok=True)
    pairs = []
    manifest = {}
    for i, url in enumerate(urls):
        ext_guess = ".pdf" if url.lower().endswith(".pdf") else ".html"
        try:
            resp = requests.get(url, headers=DOWNLOAD_HEADERS, timeout=30, allow_redirects=True)
            resp.raise_for_status()
        except requests.RequestException:
            continue
        content_type = resp.headers.get("content-type", "").split(";")[0].strip()
        ext = EXTENSION_BY_CONTENT_TYPE.get(content_type, ext_guess)
        path = dest_dir / f"{i:02d}-{urlparse(url).netloc}{ext}"
        path.write_bytes(resp.content)
        pairs.append((url, path))
        manifest[path.name] = url
    manifest_path.write_text(json.dumps(manifest))
    return pairs


def analyze_node(
    client: httpx.Client,
    hypothesis: str,
    files: list[tuple[str, Path]],
    on_progress: callable | None = None,
) -> dict:
    current_posterior = PRIOR_LOG_ODDS
    existing_data_points: list[dict] = []
    evidence_used = 0
    result = None

    for url, path in files:
        data = {
            "hypothesis": hypothesis,
            "prior_log_odds": str(PRIOR_LOG_ODDS),
            "current_posterior": str(current_posterior),
            "existing_data_points": json.dumps(existing_data_points),
        }
        with path.open("rb") as stream:
            response = client.post(
                "/analyze",
                data=data,
                files={"file": (path.name, stream, mime_for(path))},
            )
        response.raise_for_status()
        result = response.json()

        if not result["redundant"]:
            evidence_used += 1
            existing_data_points.append(
                {
                    "raw_data": result["raw_data"],
                    "l_plus": result["l_plus"],
                    "l_minus": result["l_minus"],
                    "posterior": result["posterior"],
                }
            )
        current_posterior = result["current_posterior"]

        if on_progress is not None:
            low, high = result["interval"]
            on_progress(
                url,
                path,
                result,
                {
                    "num_evidence_used": evidence_used,
                    "final_log_odds": current_posterior,
                    "final_probability": result["probability"],
                    "interval_low": low,
                    "interval_high": high,
                },
            )

    if result is None:
        raise RuntimeError("no files were analyzed")

    low, high = result["interval"]
    return {
        "num_evidence_used": evidence_used,
        "final_log_odds": current_posterior,
        "final_probability": result["probability"],
        "interval_low": low,
        "interval_high": high,
    }


def save_detail_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def load_existing_rows(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with path.open() as f:
        return {row["node_label"]: row for row in csv.DictReader(f)}


def save_rows(path: Path, rows: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        for row in rows.values():
            writer.writerow(row)

TRL_DEFINITIONS = {
    1: "TRL 1: Basic principles observed (initial scientific research).",
    2: "TRL 2: Technology concept formulated (practical applications invented, still speculative).",
    3: "TRL 3: Experimental proof of concept (analytical and laboratory validation of individual components).",
    4: "TRL 4: Technology validated in lab (basic components integrated and tested in a low-fidelity lab setting).",
    5: "TRL 5: Technology validated in relevant environment (components integrated with realistic supporting elements in a simulated environment).",
    6: "TRL 6: Technology demonstrated in relevant environment (representative prototype tested in a high-fidelity simulated environment).",
    7: "TRL 7: System prototype demonstration in operational environment (prototype near planned operational system tested in real-world conditions).",
    8: "TRL 8: System complete and qualified (proven to work in its final form under expected conditions).",
    9: "TRL 9: Actual system proven in operational environment (fully deployed and proven in real mission/commercial operations)."
}
TRL_DEFINITIONS_TEXT = "\n".join(TRL_DEFINITIONS[i] for i in sorted(TRL_DEFINITIONS))


def build_hypothesis(label: str, trl: str) -> str:
    return (
        f"TRL definitions:\n{TRL_DEFINITIONS_TEXT}\n\n"
        f"Given the TRL definitions above, the current TRL level for {label} is {trl}."
    )


def main() -> None:
    args = parse_args()

    accessible_by_node = load_accessible_refs_by_node()
    trl_by_node, total_nodes = load_trl_by_node(args.db)

    nodes_with_evidence = [
        label for label in trl_by_node if len(accessible_by_node.get(label, [])) >= 1
    ]
    print(f"{len(trl_by_node)}/{total_nodes} nodes have a TRL level")
    print(f"{len(nodes_with_evidence)}/{len(trl_by_node)} of those have at least one attached evidence file")
    print()

    qualifying = sorted(
        label
        for label, urls in accessible_by_node.items()
        if label in trl_by_node and len(urls) >= args.min_accessible
    )
    if args.limit:
        qualifying = qualifying[: args.limit]

    rows: dict[str, dict] = {} if args.refresh else load_existing_rows(args.output)

    headers = {"X-API-Key": API_KEY} if API_KEY else {}
    with httpx.Client(base_url=API_URL, headers=headers, timeout=httpx.Timeout(TIMEOUT_SECONDS)) as client:
        try:
            client.get("/health").raise_for_status()
        except httpx.HTTPError as exc:
            raise SystemExit(f"Cannot reach API at {API_URL}: {exc}") from exc

        total = len(qualifying)
        for i, label in enumerate(qualifying, 1):
            existing = rows.get(label)
            if existing is not None and existing.get("status") != "in_progress":
                print(f"[{i}/{total}] {label}: skipping (already done)")
                continue

            trl = trl_by_node[label]
            urls = accessible_by_node[label]

            hypothesis = build_hypothesis(label, trl)
            slug = label.lower().replace(" ", "-").replace("/", "-")
            dest_dir = DOCS_ROOT / slug
            detail_path = DETAILS_DIR / f"{slug}.json"

            row = {
                "node_label": label,
                "trl_current": trl,
                "num_references": len(urls),
                "num_accessible": len(urls),
                "num_evidence_used": 0,
                "final_log_odds": "",
                "final_probability": "",
                "interval_low": "",
                "interval_high": "",
                "status": "in_progress",
                "detail_path": str(detail_path.relative_to(REPO_ROOT)),
            }
            rows[label] = row
            save_rows(args.output, rows)

            print(f"[{i}/{total}] {label}: downloading {len(urls)} reference(s)...")
            files = download_references(urls, dest_dir, args.refresh)

            if not files:
                row["status"] = "no_files_downloaded"
                save_rows(args.output, rows)
                continue

            detail = {"node_label": label, "trl_current": trl, "hypothesis": hypothesis, "evidence": []}

            def on_progress(
                url: str,
                path: Path,
                result: dict,
                partial: dict,
                row: dict = row,
                detail: dict = detail,
                detail_path: Path = detail_path,
            ) -> None:
                detail["evidence"].append(
                    {
                        "file": path.name,
                        "url": url,
                        "redundant": result["redundant"],
                        "l_plus": result["l_plus"],
                        "l_minus": result["l_minus"],
                        "posterior": result["posterior"],
                        "current_posterior": result["current_posterior"],
                        "probability": result["probability"],
                        "interval": result["interval"],
                        "raw_data": result["raw_data"],
                        "analysis_rationale": result.get("analysis_rationale"),
                    }
                )
                save_detail_json(detail_path, detail)
                row.update(**partial)
                save_rows(args.output, rows)
                print(
                    f"    P={partial['final_probability']:.4f} "
                    f"(evidence used: {partial['num_evidence_used']})"
                )

            try:
                result = analyze_node(client, hypothesis, files, on_progress=on_progress)
                row.update(**result, status="ok")
            except (httpx.HTTPError, KeyError, RuntimeError) as exc:
                row["status"] = f"error: {exc}"
                print(f"    error: {exc}")

            save_rows(args.output, rows)

    print(f"\nresults written to {args.output}")


if __name__ == "__main__":
    main()
