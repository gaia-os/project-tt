"""Compare two extracted technology graphs (graph.json) by structure, sets, and per-reactor coverage.

Usage:
    python scripts/compare_graphs.py data/extracted/smr data/extracted/smr-qwen38-next-flash
    python scripts/compare_graphs.py A B --out outputs/graph-comparison

Each directory must contain ``technologies/graph.json``. Outputs a markdown report
and CSV sidecar files (shared/unique technologies, per-reactor coverage, edge diffs).
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

EDGE_TYPES = ("ENABLES", "BROADER", "SUPPLIES", "DEVELOPS")
NODE_LABELS = ("Technology", "Organisation", "ReactorDesign")


def load_graph(run_dir: Path) -> dict:
    graph_path = run_dir / "technologies" / "graph.json"
    if not graph_path.exists():
        sys.exit(f"missing {graph_path}")
    with graph_path.open() as f:
        return json.load(f)


def norm_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def fuzzy_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def node_key(n: dict) -> str:
    # Normalised name is the most stable cross-run key; IDs diverge (slug differences).
    return norm_name(n.get("name", ""))


def importance(n: dict) -> dict | None:
    imp = n.get("importance")
    return imp if isinstance(imp, dict) else None


def fmt_pct(x: float) -> str:
    return f"{x * 100:.1f}%"


# --------------------------------------------------------------------------- #
# Metric blocks
# --------------------------------------------------------------------------- #
def structural_metrics(g: dict) -> dict:
    nodes, edges = g["nodes"], g["edges"]
    n_imp = [importance(n) for n in nodes if importance(n)]
    scores = [imp["score"] for imp in n_imp if "score" in imp]
    return {
        "nodes": len(nodes),
        "edges": len(edges),
        "by_label": Counter(n["label"] for n in nodes),
        "by_origin": Counter(n.get("origin") for n in nodes),
        "by_category": Counter(n.get("category") for n in nodes),
        "by_tree_level": Counter(n.get("tree_level") for n in nodes),
        "max_level_observed": max(
            (n.get("max_level", 0) or 0) for n in nodes
        ),
        "edge_types": Counter(e["type"] for e in edges),
        "edge_relation_types": Counter(e.get("relation_type") for e in edges),
        "verified_edges": sum(1 for e in edges if e.get("verified")),
        "confidence_values": Counter(e.get("confidence") for e in edges),
        "importance_scores": scores,
        "importance_mean": statistics.mean(scores) if scores else 0.0,
        "importance_max": max(scores) if scores else 0.0,
    }


def tech_sets(g: dict) -> tuple[dict[str, dict], dict[str, dict]]:
    """Return (id->node, normname->node) for Technology nodes only."""
    by_id = {n["id"]: n for n in g["nodes"] if n["label"] == "Technology"}
    by_name = {node_key(n): n for n in by_id.values()}
    return by_id, by_name


def reactor_coverage(g: dict) -> dict[str, dict]:
    """Per-reactor: # ENABLES edges, # unique enabling techs, # source-doc edges."""
    reactors = {n["id"]: n for n in g["nodes"] if n["label"] == "ReactorDesign"}
    out: dict[str, dict] = {}
    for rid, rnode in reactors.items():
        enables = [e for e in g["edges"] if e["type"] == "ENABLES" and e["target"] == rid]
        techs = {e["source"] for e in enables}
        source_edges = sum(
            1
            for e in enables
            if any(p == "source" for p in (e.get("provenance") or []))
        )
        out[rid] = {
            "name": rnode.get("name", rid),
            "enables_edges": len(enables),
            "unique_techs": len(techs),
            "source_doc_edges": source_edges,
        }
    return out


def edge_pairs(g: dict) -> set[tuple[str, str, str]]:
    return {(e["source"], e["target"], e["type"]) for e in g["edges"]}


# --------------------------------------------------------------------------- #
# Report rendering
# --------------------------------------------------------------------------- #
def md_table(headers: list[str], rows: list[list]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for r in rows:
        lines.append("| " + " | ".join(str(c) for c in r) + " |")
    return "\n".join(lines)


def write_csv(path: Path, headers: list[str], rows: list[list]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)


def build_report(
    name_a: str,
    name_b: str,
    ga: dict,
    gb: dict,
    out_dir: Path,
) -> str:
    ma = structural_metrics(ga)
    mb = structural_metrics(gb)

    # --- set overlap --------------------------------------------------------
    ida, namea = tech_sets(ga)
    idb, nameb = tech_sets(gb)
    shared_ids = set(ida) & set(idb)
    shared_names = set(namea) & set(nameb)

    # fuzzy match for names only in one side (cheap, ratio>=0.88)
    only_a_names = set(namea) - shared_names
    only_b_names = set(nameb) - shared_names
    fuzzy_pairs: list[tuple[str, str, float]] = []
    sb_sorted = sorted(only_b_names)
    for a in sorted(only_a_names):
        best, best_r = None, 0.0
        for b in sb_sorted:
            r = fuzzy_ratio(a, b)
            if r > best_r:
                best, best_r = b, r
                if best_r == 1.0:
                    break
        if best is not None and best_r >= 0.88:
            fuzzy_pairs.append((a, best, round(best_r, 3)))

    jaccard_id = len(shared_ids) / len(set(ida) | set(idb)) if (ida or idb) else 0
    jaccard_name = len(shared_names) / len(set(namea) | set(nameb)) if (namea or nameb) else 0

    # --- per-reactor coverage ----------------------------------------------
    cov_a = reactor_coverage(ga)
    cov_b = reactor_coverage(gb)
    shared_reactors = sorted(set(cov_a) & set(cov_b))
    cov_rows = []
    for rid in shared_reactors:
        a, b = cov_a[rid], cov_b[rid]
        ratio = (a["enables_edges"] / b["enables_edges"]) if b["enables_edges"] else float("inf")
        cov_rows.append(
            [
                rid,
                a["name"],
                a["enables_edges"],
                b["enables_edges"],
                a["unique_techs"],
                b["unique_techs"],
                a["source_doc_edges"],
                b["source_doc_edges"],
                f"{ratio:.2f}",
            ]
        )
    cov_rows.sort(key=lambda r: abs(1.0 - float(r[-1])), reverse=True)

    # --- edge agreement -----------------------------------------------------
    epa, epb = edge_pairs(ga), edge_pairs(gb)
    shared_edges = epa & epb
    edge_agreement = len(shared_edges) / len(epa | epb) if (epa or epb) else 0

    # --- importance on shared techs ---------------------------------------
    imp_rows = []
    for name in sorted(shared_names):
        ia = importance(namea[name])
        ib = importance(nameb[name])
        if not ia or not ib:
            continue
        imp_rows.append(
            [
                name,
                ia.get("score", 0),
                ib.get("score", 0),
                round((ia.get("score", 0) or 0) - (ib.get("score", 0) or 0), 3),
                ia.get("reactor_reach", 0),
                ib.get("reactor_reach", 0),
            ]
        )
    imp_rows.sort(key=lambda r: abs(r[3]), reverse=True)

    # --- write CSVs ---------------------------------------------------------
    write_csv(
        out_dir / "shared_techs.csv",
        ["name", "id_a", "id_b", "score_a", "score_b"],
        [
            [n, namea[n]["id"], nameb[n]["id"],
             (importance(namea[n]) or {}).get("score", ""),
             (importance(nameb[n]) or {}).get("score", "")]
            for n in sorted(shared_names)
        ],
    )
    write_csv(
        out_dir / "only_in_a.csv",
        ["name", "id", "category", "origin"],
        [[n, namea[n]["id"], namea[n].get("category"), namea[n].get("origin")]
         for n in sorted(only_a_names)],
    )
    write_csv(
        out_dir / "only_in_b.csv",
        ["name", "id", "category", "origin"],
        [[n, nameb[n]["id"], nameb[n].get("category"), nameb[n].get("origin")]
         for n in sorted(only_b_names)],
    )
    write_csv(
        out_dir / "fuzzy_matches.csv",
        ["name_a", "name_b", "ratio"],
        fuzzy_pairs,
    )
    write_csv(
        out_dir / "reactor_coverage.csv",
        ["reactor_id", "name", "enables_a", "enables_b",
         "techs_a", "techs_b", "source_a", "source_b", "ratio_a_over_b"],
        cov_rows,
    )
    write_csv(
        out_dir / "shared_tech_importance.csv",
        ["name", "score_a", "score_b", "delta", "reach_a", "reach_b"],
        imp_rows,
    )

    # --- markdown ----------------------------------------------------------
    def counter_row(label: str, ca: Counter, cb: Counter, keys: list) -> list:
        k = keys[0]
        return [label, ca.get(k, 0), cb.get(k, 0)]

    lines: list[str] = []
    lines.append(f"# Graph comparison: `{name_a}` vs `{name_b}`\n")
    lines.append("## 1. Structural overview\n")
    lines.append(md_table(
        ["metric", name_a, name_b],
        [
            ["nodes", ma["nodes"], mb["nodes"]],
            ["edges", ma["edges"], mb["edges"]],
            ["max_level observed", ma["max_level_observed"], mb["max_level_observed"]],
            ["verified edges", ma["verified_edges"], mb["verified_edges"]],
            ["verified edge %", fmt_pct(ma["verified_edges"] / ma["edges"]),
             fmt_pct(mb["verified_edges"] / mb["edges"])],
            ["importance mean", round(ma["importance_mean"], 3), round(mb["importance_mean"], 3)],
            ["importance max", round(ma["importance_max"], 3), round(mb["importance_max"], 3)],
        ],
    ))
    lines.append("\n### Nodes by label\n")
    lines.append(md_table(
        ["label", name_a, name_b],
        [counter_row(lbl, ma["by_label"], mb["by_label"], [lbl]) for lbl in NODE_LABELS]
        + [["(other)",
            sum(v for k, v in ma["by_label"].items() if k not in NODE_LABELS),
            sum(v for k, v in mb["by_label"].items() if k not in NODE_LABELS)]],
    ))
    lines.append("\n### Nodes by origin\n")
    lines.append(md_table(
        ["origin", name_a, name_b],
        [[k or "(none)", ma["by_origin"].get(k, 0), mb["by_origin"].get(k, 0)]
         for k in sorted(set(ma["by_origin"]) | set(mb["by_origin"]), key=lambda x: (x or ""))],
    ))
    lines.append("\n### Nodes by category (top 12)\n")
    cats = sorted(set(ma["by_category"]) | set(mb["by_category"]),
                  key=lambda x: (-(ma["by_category"].get(x, 0) + mb["by_category"].get(x, 0)), x or ""))
    lines.append(md_table(
        ["category", name_a, name_b],
        [[k or "(none)", ma["by_category"].get(k, 0), mb["by_category"].get(k, 0)]
         for k in cats[:12]],
    ))
    lines.append("\n### Edges by type\n")
    lines.append(md_table(
        ["type", name_a, name_b],
        [counter_row(t, ma["edge_types"], mb["edge_types"], [t]) for t in EDGE_TYPES]
        + [["(other)",
            sum(v for k, v in ma["edge_types"].items() if k not in EDGE_TYPES),
            sum(v for k, v in mb["edge_types"].items() if k not in EDGE_TYPES)]],
    ))
    lines.append("\n### Edges by relation_type (sub-type)\n")
    rts = sorted(set(ma["edge_relation_types"]) | set(mb["edge_relation_types"]),
                 key=lambda x: (-(ma["edge_relation_types"].get(x, 0)), x or ""))
    lines.append(md_table(
        ["relation_type", name_a, name_b],
        [[k or "(none)", ma["edge_relation_types"].get(k, 0), mb["edge_relation_types"].get(k, 0)]
         for k in rts[:12]],
    ))
    lines.append("\n### Tree level distribution\n")
    levels = sorted(set(ma["by_tree_level"]) | set(mb["by_tree_level"]),
                    key=lambda x: (x is None, x or -1))
    lines.append(md_table(
        ["tree_level", name_a, name_b],
        [[k if k is not None else "(none)", ma["by_tree_level"].get(k, 0), mb["by_tree_level"].get(k, 0)]
         for k in levels],
    ))

    # 2. set overlap
    lines.append("\n## 2. Technology set overlap\n")
    lines.append(md_table(
        ["metric", "value"],
        [
            ["Technologies in A", len(ida)],
            ["Technologies in B", len(idb)],
            ["Shared by exact ID", len(shared_ids)],
            ["Shared by normalised name", len(shared_names)],
            ["Only in A (by name)", len(only_a_names)],
            ["Only in B (by name)", len(only_b_names)],
            ["Jaccard (IDs)", round(jaccard_id, 3)],
            ["Jaccard (names)", round(jaccard_name, 3)],
            ["Fuzzy name matches (>=0.88)", len(fuzzy_pairs)],
        ],
    ))
    lines.append(
        "\nSidecar files: `shared_techs.csv`, `only_in_a.csv`, `only_in_b.csv`, "
        "`fuzzy_matches.csv`.\n"
    )

    # 3. per-reactor coverage
    lines.append("\n## 3. Per-reactor coverage (top 15 most divergent)\n")
    lines.append(md_table(
        ["reactor", "enables A", "enables B", "techs A", "techs B", "src A", "src B", "A/B"],
        [r[1:9] for r in cov_rows[:15]],
    ))
    lines.append("\nFull table: `reactor_coverage.csv` (sorted by |A/B - 1|).\n")

    # 4. edge agreement
    lines.append("\n## 4. Edge agreement\n")
    lines.append(md_table(
        ["metric", "value"],
        [
            ["Edges in A", len(epa)],
            ["Edges in B", len(epb)],
            ["Shared (s,t,type) triples", len(shared_edges)],
            ["Jaccard over edges", round(edge_agreement, 3)],
        ],
    ))

    # 5. importance deltas
    lines.append("\n## 5. Importance-score deltas on shared technologies (top 15)\n")
    lines.append(md_table(
        ["technology", "score A", "score B", "delta", "reach A", "reach B"],
        imp_rows[:15],
    ))
    lines.append("\nFull table: `shared_tech_importance.csv`.\n")

    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("run_a", type=Path)
    ap.add_argument("run_b", type=Path)
    ap.add_argument("--out", type=Path, default=Path("outputs/graph-comparison"))
    args = ap.parse_args()

    ga = load_graph(args.run_a)
    gb = load_graph(args.run_b)
    args.out.mkdir(parents=True, exist_ok=True)
    report = build_report(args.run_a.name, args.run_b.name, ga, gb, args.out)
    report_path = args.out / "comparison.md"
    report_path.write_text(report)
    print(f"wrote {report_path}")
    print(f"csvs in {args.out}/")


if __name__ == "__main__":
    main()
