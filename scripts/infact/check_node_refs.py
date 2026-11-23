"""For nodes that have a `trl_current` value, inspect their `references` URLs:
what domains they point to, whether they're reachable, and how many
references exist per node on average.

Every reference link, with its node, status, and accessibility, is written to
a CSV file for full inspection (not just the aggregated domain counts).

Usage:
    uv run scripts/infact/check_node_refs.py [db_name]

Defaults to the `merged` database if no db_name is given.
"""

import csv
import os
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

TIMEOUT = 10
MAX_WORKERS = 16
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; project-tt-link-check/1.0)"}
OUTPUT_CSV = Path("outputs/node-refs-check.csv")


def domain_of(url: str) -> str:
    netloc = urlparse(url).netloc
    return netloc[4:] if netloc.startswith("www.") else netloc


def check_url(url: str) -> tuple[bool, str]:
    """Returns (accessible, status) where status is an HTTP status code or an error label."""
    try:
        resp = requests.head(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
        if resp.status_code in (405, 403):
            resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True, stream=True)
        return resp.status_code < 400, str(resp.status_code)
    except requests.RequestException as exc:
        return False, type(exc).__name__


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent.parent
    load_dotenv(repo_root / ".env.local")

    db_name = sys.argv[1] if len(sys.argv) > 1 else "merged"
    client = MongoClient(os.environ["MONGODB_URI"])
    coll = client[db_name]["nodes"]

    docs = list(
        coll.find({"trl_current": {"$exists": True, "$ne": None}}, {"references": 1, "label": 1})
    )

    all_refs: list[str] = []
    node_refs: list[tuple[str, str]] = []  # (node_label, url)
    for doc in docs:
        refs = doc.get("references") or []
        for url in refs:
            node_refs.append((doc.get("label", ""), url))
        all_refs.extend(refs)

    unique_urls = sorted(set(all_refs))

    print(f"database: {db_name}")
    print(f"nodes with trl_current: {len(docs)}")
    print(f"total references: {len(all_refs)} ({len(unique_urls)} unique urls)")
    print(f"avg references per node: {len(all_refs) / len(docs):.2f}")
    print()

    domain_counts = Counter(domain_of(url) for url in all_refs)
    print("reference domains (what kind of source each ref points to):")
    for domain, count in domain_counts.most_common():
        print(f"  {domain:<45} {count}")
    print()

    print(f"checking accessibility of {len(unique_urls)} unique urls...")
    results: dict[str, tuple[bool, str]] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(check_url, url): url for url in unique_urls}
        for future in as_completed(futures):
            url = futures[future]
            results[url] = future.result()

    accessible_urls = {url for url, (ok, _) in results.items() if ok}
    accessible_refs_total = sum(1 for url in all_refs if url in accessible_urls)

    print()
    print(f"accessible unique urls: {len(accessible_urls)} / {len(unique_urls)}")
    print(f"accessible references (counting duplicates): {accessible_refs_total} / {len(all_refs)}")

    broken = sorted(url for url, (ok, _) in results.items() if not ok)
    if broken:
        print()
        print("broken/unreachable urls:")
        for url in broken:
            print(f"  {url}  ({results[url][1]})")

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["node_label", "url", "domain", "accessible", "status"])
        for label, url in node_refs:
            ok, status = results[url]
            writer.writerow([label, url, domain_of(url), ok, status])

    print()
    print(f"full per-node reference listing written to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
