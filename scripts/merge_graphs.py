"""Merge two extracted technology graphs into their intersection.

Keeps only nodes that exist in BOTH runs:
  - ReactorDesign: exact ID match (the IAEA ARIS catalogue)
  - Organisation:  exact normalised-name match
  - Technology:   exact normalised-name match PLUS fuzzy matches (ratio >= 0.88)

Edges: union of edges from either graph whose endpoints both survive.
Each merged edge gets ``source_graph`` in {both, <run_a>, <run_b>}; edges found in
only one run are marked ``verified=false``. Provenance/documents are unioned.

Importance scores on shared technologies are averaged.

Usage:
    python scripts/merge_graphs.py data/extracted/smr data/extracted/smr-qwen38-next-flash \
        --out data/extracted/merged

Writes <out>/technologies/graph.json and <out>/merge-report.md.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import statistics
import sys
from difflib import SequenceMatcher
from pathlib import Path

FUZZY_THRESHOLD = 0.88


def norm_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def fuzzy_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def load_graph(run_dir: Path) -> dict:
    p = run_dir / "technologies" / "graph.json"
    if not p.exists():
        sys.exit(f"missing {p}")
    with p.open() as f:
        return json.load(f)


def index_nodes(g: dict) -> dict:
    """id -> node."""
    return {n["id"]: n for n in g["nodes"]}


def by_label(g: dict, label: str) -> dict:
    """normalised name -> node, for a given label."""
    return {norm_name(n["name"]): n for n in g["nodes"] if n["label"] == label}


def avg(a, b):
    if a is None and b is None:
        return None
    if a is None:
        return b
    if b is None:
        return a
    return round((a + b) / 2, 4)


def merge_importance(ia: dict | None, ib: dict | None) -> dict | None:
    if not ia and not ib:
        return None
    if ia and not ib:
        return ia
    if ib and not ia:
        return ib
    out = dict(ia)
    out["score"] = avg(ia.get("score"), ib.get("score"))
    out["reactor_reach"] = avg(ia.get("reactor_reach"), ib.get("reactor_reach"))
    out["direct_reactors"] = avg(ia.get("direct_reactors"), ib.get("direct_reactors"))
    out["enabled_descendants"] = avg(ia.get("enabled_descendants"), ib.get("enabled_descendants"))
    out["edge_quality"] = avg(ia.get("edge_quality"), ib.get("edge_quality"))
    return out


def union_lists(a, b):
    a = a or []
    b = b or []
    out = []
    seen = []
    for item in [*a, *b]:
        try:
            if item not in seen:
                seen.append(item)
                out.append(item)
        except TypeError:
            # unhashable / nested dicts: dedupe by json repr
            key = json.dumps(item, sort_keys=True)
            if key not in seen:
                seen.append(key)
                out.append(item)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("run_a", type=Path)
    ap.add_argument("run_b", type=Path)
    ap.add_argument("--out", type=Path, default=Path("data/extracted/merged"))
    ap.add_argument("--fuzzy", type=float, default=FUZZY_THRESHOLD,
                    help="name similarity threshold for fuzzy tech merge")
    ap.add_argument("--copy-markdown", action="store_true", default=True,
                    help="copy markdown frontmatter files for surviving nodes (default: on)")
    ap.add_argument("--no-copy-markdown", dest="copy_markdown", action="store_false",
                    help="skip copying markdown files")
    args = ap.parse_args()

    name_a, name_b = args.run_a.name, args.run_b.name
    ga, gb = load_graph(args.run_a), load_graph(args.run_b)
    na, nb = index_nodes(ga), index_nodes(gb)

    # ---- build canonical node set & id maps --------------------------------
    # canonical_id -> merged node dict
    merged_nodes: dict[str, dict] = {}
    # (graph_key, original_id) -> canonical_id
    id_map_a: dict[str, str] = {}
    id_map_b: dict[str, str] = {}

    stats = {"reactor": 0, "org_exact": 0, "tech_exact": 0, "tech_fuzzy": 0}

    def add_canonical(node_a: dict, node_b: dict | None, merged_from: list[str]) -> dict:
        cid = node_a["id"]
        m = dict(node_a)
        m["merged_from"] = merged_from
        if node_b is not None:
            m["importance"] = merge_importance(node_a.get("importance"), node_b.get("importance"))
        merged_nodes[cid] = m
        return m

    # 1. ReactorDesign: exact ID match
    ra = {n["id"]: n for n in ga["nodes"] if n["label"] == "ReactorDesign"}
    rb = {n["id"]: n for n in gb["nodes"] if n["label"] == "ReactorDesign"}
    for rid in ra:
        if rid in rb:
            add_canonical(ra[rid], rb[rid], [name_a, name_b])
            id_map_a[rid] = rid
            id_map_b[rid] = rid
            stats["reactor"] += 1

    # 2. Organisation: exact normalised-name match
    oa = by_label(ga, "Organisation")
    ob = by_label(gb, "Organisation")
    for nm, na_node in oa.items():
        if nm in ob:
            nb_node = ob[nm]
            add_canonical(na_node, nb_node, [name_a, name_b])
            id_map_a[na_node["id"]] = na_node["id"]
            id_map_b[nb_node["id"]] = na_node["id"]
            stats["org_exact"] += 1

    # 3. Technology: exact name match first
    ta = by_label(ga, "Technology")
    tb = by_label(gb, "Technology")
    matched_b_names: set[str] = set()
    for nm, na_node in ta.items():
        if nm in tb:
            nb_node = tb[nm]
            add_canonical(na_node, nb_node, [name_a, name_b])
            id_map_a[na_node["id"]] = na_node["id"]
            id_map_b[nb_node["id"]] = na_node["id"]
            matched_b_names.add(nm)
            stats["tech_exact"] += 1

    # 4. Technology: fuzzy match on the leftovers
    only_a = {nm: n for nm, n in ta.items() if nm not in tb}
    only_b = {nm: n for nm, n in tb.items() if nm not in ta and nm not in matched_b_names}
    only_b_names_sorted = sorted(only_b)
    fuzzy_pairs = []
    for nm_a, na_node in sorted(only_a.items()):
        best, best_r = None, 0.0
        for nm_b in only_b_names_sorted:
            r = fuzzy_ratio(nm_a, nm_b)
            if r > best_r:
                best, best_r = nm_b, r
                if best_r == 1.0:
                    break
        if best is not None and best_r >= args.fuzzy:
            nb_node = only_b[best]
            add_canonical(na_node, nb_node, [name_a, name_b])
            id_map_a[na_node["id"]] = na_node["id"]
            id_map_b[nb_node["id"]] = na_node["id"]
            matched_b_names.add(best)
            stats["tech_fuzzy"] += 1
            fuzzy_pairs.append((nm_a, best, round(best_r, 3)))

    # ---- merge edges -------------------------------------------------------
    def translate(graph_key: str, edge: dict, id_map: dict[str, str]) -> dict | None:
        s = id_map.get(edge["source"])
        t = id_map.get(edge["target"])
        if s is None or t is None:
            return None
        return (s, t, edge["type"])

    # key (s,t,type) -> {graph: edge}
    edge_index: dict[tuple, dict] = {}
    for e in ga["edges"]:
        k = translate(name_a, e, id_map_a)
        if k is None:
            continue
        edge_index.setdefault(k, {})[name_a] = e
    for e in gb["edges"]:
        k = translate(name_b, e, id_map_b)
        if k is None:
            continue
        edge_index.setdefault(k, {})[name_b] = e

    merged_edges = []
    edge_stats = {"both": 0, name_a: 0, name_b: 0}
    for (s, t, etype), sources in edge_index.items():
        ea = sources.get(name_a)
        eb = sources.get(name_b)
        base = dict(ea or eb)
        base["source"] = s
        base["target"] = t
        base["type"] = etype
        if ea and eb:
            base["source_graph"] = "both"
            base["verified"] = bool(ea.get("verified") or eb.get("verified"))
            base["provenance"] = union_lists(ea.get("provenance"), eb.get("provenance"))
            base["documents"] = union_lists(ea.get("documents"), eb.get("documents"))
            base["citations"] = union_lists(ea.get("citations"), eb.get("citations"))
            base["roles"] = union_lists(ea.get("roles"), eb.get("roles"))
            # relation_type: prefer A, fall back to B
            base["relation_type"] = ea.get("relation_type") or eb.get("relation_type")
            edge_stats["both"] += 1
        elif ea:
            base["source_graph"] = name_a
            base["verified"] = False
            edge_stats[name_a] += 1
        else:
            base["source_graph"] = name_b
            base["verified"] = False
            edge_stats[name_b] += 1
        merged_edges.append(base)

    # ---- write outputs -----------------------------------------------------
    out_graph = {"nodes": list(merged_nodes.values()), "edges": merged_edges}
    out_dir = args.out
    (out_dir / "technologies").mkdir(parents=True, exist_ok=True)
    with (out_dir / "technologies" / "graph.json").open("w") as f:
        json.dump(out_graph, f, indent=2)

    # ---- copy markdown for surviving nodes ---------------------------------
    md_stats = {"reactors": 0, "orgs": 0, "techs": 0, "images_symlinked": False}
    if args.copy_markdown:
        # Build canonical_id -> original_id_in_a and original_id_in_b
        # so we can find the markdown files in each source folder.
        # The markdown filename is the slug of the node id (minus prefix).
        def slug(node_id: str) -> str:
            return re.sub(r"^[a-z]+:", "", node_id)

        # For fuzzy-merged techs, the canonical id is A's id; B's markdown
        # (if it exists under B's id) is also copied as an alias file so the
        # seeder can still find B's richer frontmatter if A's is thinner.
        for subdir, label in [("reactors", "ReactorDesign"),
                             ("orgs", "Organisation"),
                             ("technologies", "Technology")]:
            dest = out_dir / subdir
            dest.mkdir(parents=True, exist_ok=True)
            for cid, mnode in merged_nodes.items():
                if mnode["label"] != label:
                    continue
                # prefer run A's markdown; fall back to run B
                src_a = args.run_a / subdir / f"{slug(cid)}.md"
                src_b = args.run_b / subdir / f"{slug(cid)}.md"
                src = src_a if src_a.exists() else (src_b if src_b.exists() else None)
                if src is None:
                    # try B's id for fuzzy-merged techs
                    continue
                shutil.copy2(src, dest / src.name)
                if label == "ReactorDesign":
                    md_stats["reactors"] += 1
                elif label == "Organisation":
                    md_stats["orgs"] += 1
                else:
                    md_stats["techs"] += 1

        # iaea-aris/ and nea/ hold source docs + images referenced by relative
        # paths from reactors/*.md. They're identical across runs (same IAEA
        # catalogue), so symlink run A's copies instead of duplicating ~17MB.
        for shared in ("iaea-aris", "nea"):
            link = out_dir / shared
            target = (args.run_a / shared).resolve()
            if target.exists() and not link.exists():
                link.symlink_to(target)
                if shared == "iaea-aris":
                    md_stats["images_symlinked"] = True

        # geocode cache: copy run A's (shared Nominatim cache)
        geo_a = args.run_a / ".geocode-cache.json"
        if geo_a.exists():
            shutil.copy2(geo_a, out_dir / ".geocode-cache.json")

    # report
    rep = []
    rep.append(f"# Merged graph: `{name_a}` + `{name_b}`\n")
    rep.append("## Node counts\n")
    rep.append("| kind | count |")
    rep.append("| --- | --- |")
    rep.append(f"| ReactorDesign (exact ID) | {stats['reactor']} |")
    rep.append(f"| Organisation (exact name) | {stats['org_exact']} |")
    rep.append(f"| Technology (exact name) | {stats['tech_exact']} |")
    rep.append(f"| Technology (fuzzy >= {args.fuzzy}) | {stats['tech_fuzzy']} |")
    rep.append(f"| **Total merged nodes** | **{len(merged_nodes)}** |")
    rep.append("")
    rep.append("## Edge counts\n")
    rep.append("| source_graph | count |")
    rep.append("| --- | --- |")
    rep.append(f"| both | {edge_stats['both']} |")
    rep.append(f"| only {name_a} | {edge_stats[name_a]} |")
    rep.append(f"| only {name_b} | {edge_stats[name_b]} |")
    rep.append(f"| **Total merged edges** | **{len(merged_edges)}** |")
    rep.append("")
    if args.copy_markdown:
        rep.append("## Markdown files copied\n")
        rep.append("| kind | count |")
        rep.append("| --- | --- |")
        rep.append(f"| reactors/*.md | {md_stats['reactors']} |")
        rep.append(f"| orgs/*.md | {md_stats['orgs']} |")
        rep.append(f"| technologies/*.md | {md_stats['techs']} |")
        rep.append(f"| iaea-aris/ (symlinked) | {'yes' if md_stats['images_symlinked'] else 'no'} |")
        rep.append("")
    rep.append(f"## Fuzzy tech matches ({len(fuzzy_pairs)})\n")
    rep.append("| name_a | name_b | ratio |")
    rep.append("| --- | --- | --- |")
    for a, b, r in fuzzy_pairs[:30]:
        rep.append(f"| {a} | {b} | {r} |")
    if len(fuzzy_pairs) > 30:
        rep.append(f"\n... and {len(fuzzy_pairs) - 30} more (see fuzzy matches above).")
    (out_dir / "merge-report.md").write_text("\n".join(rep) + "\n")

    print(f"merged {len(merged_nodes)} nodes, {len(merged_edges)} edges -> {out_dir}/technologies/graph.json")
    if args.copy_markdown:
        print(f"markdown: {md_stats['reactors']} reactors, {md_stats['orgs']} orgs, {md_stats['techs']} techs")
    print(f"report -> {out_dir}/merge-report.md")


if __name__ == "__main__":
    main()
