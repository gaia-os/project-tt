"""Print the number of documents in the `nodes` collection for each tech-tree
dataset database in MongoDB.

Usage:
    uv run scripts/check_tt.py
"""

from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient
import os

SKIP_DATABASES = {"admin", "local", "config"}


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(repo_root / ".env.local")

    uri = os.environ["MONGODB_URI"]
    client = MongoClient(uri)

    for name in sorted(client.list_database_names()):
        if name in SKIP_DATABASES:
            continue
        count = client[name]["nodes"].count_documents({})
        print(f"{name:<24} nodes {count}")


if __name__ == "__main__":
    main()
