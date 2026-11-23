"""Exercise the stateless /analyze API using the reference links of a tech-tree
node as evidence, without creating server-side nodes.

Downloads each reachable reference URL for the node, then feeds them through
/analyze one by one, chaining `current_posterior` and `existing_data_points`
across calls the way the stateless API expects.

Usage:
    uv run scripts/infact/analyze_node.py ["Node Label"] [db_name]

Defaults to "Aero-derivative turbomachinery" in the "merged" database.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import httpx
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

NODE_LABEL = sys.argv[1] if len(sys.argv) > 1 else "Gas circulator"
DB_NAME = sys.argv[2] if len(sys.argv) > 2 else "merged"

DOCS_DIR = Path(__file__).parent / "docs" / NODE_LABEL.lower().replace(" ", "-")
API_URL = "http://127.0.0.1:8007"
API_KEY = os.getenv("INFACT_API_KEY")
PRIOR_LOG_ODDS = 0.0
LLM_PROVIDER: str | None = None
LLM_MODEL: str | None = None
TIMEOUT_SECONDS = 600.0

DOWNLOAD_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; project-tt-link-check/1.0)"}
EXTENSION_BY_CONTENT_TYPE = {
    "application/pdf": ".pdf",
    "text/html": ".html",
    "text/plain": ".txt",
}


def fetch_node(label: str, db_name: str) -> dict:
    repo_root = Path(__file__).resolve().parent.parent.parent
    load_dotenv(repo_root / ".env.local")
    client = MongoClient(os.environ["MONGODB_URI"])
    doc = client[db_name]["nodes"].find_one({"label": label})
    if not doc:
        raise SystemExit(f"No node found with label {label!r} in db {db_name!r}")
    return doc


def download_references(references: list[str], dest_dir: Path) -> list[Path]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, url in enumerate(references):
        content_type_guess = EXTENSION_BY_CONTENT_TYPE.get(
            "application/pdf" if url.lower().endswith(".pdf") else "text/html"
        )
        try:
            resp = requests.get(url, headers=DOWNLOAD_HEADERS, timeout=30, allow_redirects=True)
            resp.raise_for_status()
        except requests.RequestException as exc:
            print(f"  skipping {url}: {exc}")
            continue

        content_type = resp.headers.get("content-type", "").split(";")[0].strip()
        ext = EXTENSION_BY_CONTENT_TYPE.get(content_type, content_type_guess)
        name = f"{i:02d}-{urlparse(url).netloc}{ext}"
        path = dest_dir / name
        path.write_bytes(resp.content)
        paths.append(path)
        print(f"  downloaded {url} -> {path.name} ({content_type or 'unknown type'})")
    return paths


def mime_for(path: Path) -> str:
    return {
        ".pdf": "application/pdf",
        ".html": "text/html",
        ".txt": "text/plain",
    }.get(path.suffix, "application/octet-stream")


def main() -> None:
    node = fetch_node(NODE_LABEL, DB_NAME)
    trl = node.get("trl_current")
    references = node.get("references") or []
    hypothesis = f"The current TRL level is {trl}"

    print(f"Node: {NODE_LABEL} (trl_current={trl!r})")
    print(f"References: {len(references)}")
    print(f"Downloading into {DOCS_DIR} ...")
    files = download_references(references, DOCS_DIR)

    if not files:
        raise SystemExit("No reference files could be downloaded.")

    headers = {"X-API-Key": API_KEY} if API_KEY else {}
    current_posterior = PRIOR_LOG_ODDS
    existing_data_points: list[dict] = []

    with httpx.Client(
        base_url=API_URL,
        headers=headers,
        timeout=httpx.Timeout(TIMEOUT_SECONDS),
    ) as client:
        try:
            client.get("/health").raise_for_status()
        except httpx.HTTPError as exc:
            raise SystemExit(
                f"Cannot reach API at {API_URL}: {exc}\n"
                "Start it with: uv run infact-api"
            ) from exc

        print(f"\nHypothesis: {hypothesis}")
        prior_probability = 1 / (1 + pow(2.718281828, -current_posterior))
        print(f"Prior: log-odds={current_posterior:.2f}  P={prior_probability:.6f}")

        for path in files:
            print(f"\nProcessing {path.name} ...")
            data = {
                "hypothesis": hypothesis,
                "prior_log_odds": str(PRIOR_LOG_ODDS),
                "current_posterior": str(current_posterior),
                "existing_data_points": json.dumps(existing_data_points),
            }
            if LLM_PROVIDER:
                data["llm_provider"] = LLM_PROVIDER
            if LLM_MODEL:
                data["llm_model"] = LLM_MODEL

            with path.open("rb") as stream:
                response = client.post(
                    "/analyze",
                    data=data,
                    files={"file": (path.name, stream, mime_for(path))},
                )

            response.raise_for_status()
            result = response.json()

            if result["redundant"]:
                print("  skipped: redundant with existing evidence")
            else:
                existing_data_points.append(
                    {
                        "raw_data": result["raw_data"],
                        "l_plus": result["l_plus"],
                        "l_minus": result["l_minus"],
                        "posterior": result["posterior"],
                    }
                )

                print("  raw_data keys and value lengths:")
                for key, value in result["raw_data"].items():
                    length = len(value) if isinstance(value, (str, list, dict)) else "n/a"
                    print(f"    {key}: {length}")
                print(f"  L+={result['l_plus']:.3f}  L-={result['l_minus']:.3f}")

            print(f"  analysis_rationale returned: {bool(result.get('analysis_rationale'))}")
            print(result.get("analysis_rationale"))
            current_posterior = result["current_posterior"]
            low, high = result["interval"]
            print(
                f"  Posterior: log-odds={current_posterior:.2f}  "
                f"P={result['probability']:.6f}  "
                f"95% interval=({low:.6f}, {high:.6f})"
            )

        print("\nNo server-side node was created or retained.")


if __name__ == "__main__":
    main()
