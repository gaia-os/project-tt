"""Check how many `nodes` documents have a `trl_current` field and show the
distribution of its values.

Usage:
    uv run scripts/infact/check_nodes_trl.py [db_name]

Defaults to the `merged` database if no db_name is given.
"""

import os
import re
import sys
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient


def sort_key(trl: str) -> tuple[float, str]:
    match = re.match(r"\d+", trl)
    return (float(match.group()) if match else float("inf"), trl)


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent.parent
    load_dotenv(repo_root / ".env.local")

    db_name = sys.argv[1] if len(sys.argv) > 1 else "merged"
    client = MongoClient(os.environ["MONGODB_URI"])
    coll = client[db_name]["nodes"]

    total = coll.count_documents({})
    with_trl = coll.count_documents({"trl_current": {"$exists": True, "$ne": None}})

    distribution = Counter(
        doc["trl_current"]
        for doc in coll.find({"trl_current": {"$exists": True, "$ne": None}}, {"trl_current": 1})
    )

    print(f"database: {db_name}")
    print(f"total nodes: {total}")
    print(f"nodes with trl_current: {with_trl} ({with_trl / total:.1%})")
    print(f"nodes without trl_current: {total - with_trl}")
    print()
    print("trl_current distribution:")
    for trl, count in sorted(distribution.items(), key=lambda kv: sort_key(kv[0])):
        print(f"  {trl:<10} {count}")


if __name__ == "__main__":
    main()
