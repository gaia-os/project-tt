"""Summarize `outputs/node-refs-check.csv` (produced by check_node_refs.py) into
a per-node ranking of how many reachable ("accessible") evidence links each
node has.

Usage:
    uv run scripts/infact/rank_nodes_by_reachable_refs.py [min_accessible]

Defaults to min_accessible=2 if not given. Requires outputs/node-refs-check.csv
to already exist (run check_node_refs.py first).
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path

INPUT_CSV = Path("outputs/node-refs-check.csv")
OUTPUT_CSV = Path("outputs/node-refs-summary.csv")


def main() -> None:
    min_accessible = int(sys.argv[1]) if len(sys.argv) > 1 else 2

    if not INPUT_CSV.exists():
        raise SystemExit(f"{INPUT_CSV} not found. Run check_node_refs.py first.")

    total_refs: dict[str, int] = defaultdict(int)
    accessible_refs: dict[str, int] = defaultdict(int)
    with INPUT_CSV.open() as f:
        for row in csv.DictReader(f):
            label = row["node_label"]
            total_refs[label] += 1
            if row["accessible"] == "True":
                accessible_refs[label] += 1

    rows = sorted(
        ((label, total_refs[label], accessible_refs[label]) for label in total_refs),
        key=lambda r: r[2],
        reverse=True,
    )

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["node_label", "total_refs", "accessible_refs"])
        writer.writerows(rows)

    qualifying = [r for r in rows if r[2] >= min_accessible]
    print(f"nodes with >= {min_accessible} reachable refs: {len(qualifying)} / {len(rows)}")
    print()
    print("top nodes by reachable refs:")
    for label, total, accessible in rows[:15]:
        print(f"  {label:<45} {accessible}/{total}")
    print()
    print(f"full ranking written to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
