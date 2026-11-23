"""Merge two extracted datasets into the part both runs agree on.

A dataset is a folder with ``technologies/graph.json`` plus the markdown the
seeder reads (``reactors/``, ``orgs/``, ``technologies/``). The output is a
complete dataset folder that ``scripts/seed-dataset.ts`` can seed as-is.

Nodes (one-to-one, run A's id becomes the canonical id):
  - ReactorDesign: same id.
  - Organisation / Technology, strongest evidence first:
      1. same normalised name
      2. pairs listed in ``<out>/approved-matches.csv`` (columns id_a,id_b)
      3. both runs list the other run's name as an alias (markdown frontmatter)
      4. same name after light normalisation (plurals, spacing, trailing acronym)
      5. organisations only: one run lists the other's name as an alias
    Weaker evidence is NOT merged: technologies that share an id but not a name,
    or where only one run lists the other as an alias (both often pair a term
    with a narrower or broader one), and similar-looking names. Those are
    written to ``<out>/review-candidates.csv``.
    Copy the rows you accept into ``approved-matches.csv`` and re-run.

Edges: only (source, target, type) triples present in BOTH runs. An edge is
source/literature-backed only if both runs back it; otherwise it is tagged
``llm_inferred`` (each run's own tags are kept in ``provenance_by_run``). Run A's
ENABLES graph is acyclic, so the result is too (checked, the script aborts
otherwise).

Technologies that no longer lead to any reactor through the shared ENABLES
edges (directly or via other technologies) are dead ends in the tree and are
dropped together with their edges; ``--keep-dead-ends`` keeps them.

Technology markdown is regenerated from run A's file so that every relation
list in it (used in reactors, enabled by, enables, broader, narrower) contains
exactly the merged edges. Reactor and organisation markdown is copied from A.
Deployment research already in the output folder (frontmatter ``deployment``
and the ``## Deployment`` body section, e.g. added by deep research after a
merge) is carried over and wins over run A's; ``--discard-deployment`` drops it.

Usage:
    python scripts/merge_graphs.py data/extracted/smr data/extracted/smr-qwen38-next-flash \
        --out data/extracted/merged --label "SMRs (merged: smr + qwen38)"

Requires PyYAML. ``<out>/dataset.json`` and ``approved-matches.csv`` are never
overwritten; ``reactors/``, ``orgs/`` and ``technologies/`` are rebuilt.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("merge_graphs.py needs PyYAML to rewrite markdown frontmatter (pip install pyyaml)")

FUZZY_THRESHOLD = 0.88
GENERATED_DIRS = ("reactors", "orgs", "technologies")
FM_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.S)
MERGED_NOTE = (
    "\n\nThis tech tree is the intersection of two independent extractions of the same sources: "
    "it only contains the technologies, organisations, reactor designs and relations that both "
    "extractions agree on."
)

_SafeLoader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
_SafeDumper = getattr(yaml, "CSafeDumper", yaml.SafeDumper)


class FrontmatterLoader(_SafeLoader):
    """Safe loader that keeps dates as strings, so files round-trip unchanged."""


FrontmatterLoader.yaml_implicit_resolvers = {
    first: [(tag, rx) for tag, rx in resolvers if tag != "tag:yaml.org,2002:timestamp"]
    for first, resolvers in _SafeLoader.yaml_implicit_resolvers.items()
}


# --------------------------------------------------------------------------- #
# IO
# --------------------------------------------------------------------------- #
def load_graph(run_dir: Path) -> dict:
    p = run_dir / "technologies" / "graph.json"
    if not p.exists():
        sys.exit(f"missing {p}")
    return json.loads(p.read_text())


def read_md(path: Path) -> tuple[dict, str] | None:
    m = FM_RE.match(path.read_text())
    if not m:
        return None
    fm = yaml.load(m.group(1), Loader=FrontmatterLoader)
    return (fm, m.group(2)) if isinstance(fm, dict) else None


def write_md(path: Path, fm: dict, body: str) -> None:
    text = yaml.dump(fm, Dumper=_SafeDumper, allow_unicode=True, sort_keys=False, width=10**9)
    path.write_text(f"---\n{text}---\n{body}")


def load_entities(run_dir: Path, sub: str, type_name: str) -> dict[str, tuple[dict, str, Path]]:
    """frontmatter id -> (frontmatter, body, path) for every markdown file of that type."""
    out: dict[str, tuple[dict, str, Path]] = {}
    for path in sorted((run_dir / sub).glob("*.md")):
        parsed = read_md(path)
        if parsed and parsed[0].get("type") == type_name and parsed[0].get("id"):
            out[parsed[0]["id"]] = (*parsed, path)
    return out


# --------------------------------------------------------------------------- #
# Name matching
# --------------------------------------------------------------------------- #
def norm_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _singular(token: str) -> str:
    if len(token) > 4 and token.endswith("ies"):
        return token[:-3] + "y"
    if len(token) > 3 and token.endswith("s") and not token.endswith(("ss", "us", "is")):
        return token[:-1]
    return token


def canonical_key(name: str) -> str:
    """Normalised name without plural endings, spacing or a trailing acronym of itself."""
    tokens = norm_name(name).split()
    if len(tokens) >= 3:
        acronym = tokens[-1]
        for start in range(len(tokens) - 2):
            initials = "".join(t[0] for t in tokens[start:-1])
            if acronym in (initials, initials + "s"):
                tokens = tokens[:-1]
                break
    return "".join(_singular(t) for t in tokens)


def match_nodes(
    nodes_a: list[dict],
    nodes_b: list[dict],
    aliases_a: dict[str, set[str]],
    aliases_b: dict[str, set[str]],
    approved: dict[str, set[str]],
    one_way_alias: bool,
) -> tuple[list[tuple[str, str, str]], int, list[tuple[str, str, str]]]:
    """One-to-one matches as (id_a, id_b, method), the number of rejected rival
    candidates, and the weak pairs (id_a, id_b, reason) that were not merged."""
    name_a = {n["id"]: norm_name(n["name"]) for n in nodes_a}
    name_b = {n["id"]: norm_name(n["name"]) for n in nodes_b}
    by_name_b, by_canon_b, by_alias_b = defaultdict(list), defaultdict(list), defaultdict(list)
    for n in nodes_b:
        by_name_b[name_b[n["id"]]].append(n["id"])
        by_canon_b[canonical_key(n["name"])].append(n["id"])
        for alias in aliases_b.get(n["id"], ()):
            by_alias_b[alias].append(n["id"])

    candidates: set[tuple[int, str, str, str]] = set()
    weak: list[tuple[str, str, str]] = []
    for n in nodes_a:
        ia, na = n["id"], name_a[n["id"]]
        for ib in by_name_b.get(na, ()):
            candidates.add((0, ia, ib, "name"))
        if ia in name_b and name_b[ia] != na:
            if one_way_alias:
                candidates.add((4, ia, ia, "id"))
            else:
                weak.append((ia, ia, "same id, different name"))
        for ib in approved.get(ia, ()):
            if ib in name_b:
                candidates.add((1, ia, ib, "approved"))
        a_lists_b = {ib for alias in aliases_a.get(ia, ()) for ib in by_name_b.get(alias, ())}
        b_lists_a = set(by_alias_b.get(na, ()))
        for ib in a_lists_b | b_lists_a:
            if ib in a_lists_b and ib in b_lists_a:
                candidates.add((2, ia, ib, "alias_mutual"))
            elif one_way_alias:
                candidates.add((4, ia, ib, "alias"))
            else:
                weak.append((ia, ib, "one run lists the other as alias"))
        for ib in by_canon_b.get(canonical_key(n["name"]), ()):
            candidates.add((3, ia, ib, "normalised"))

    matches, used_a, used_b, rejected = [], set(), set(), 0
    for _, ia, ib, method in sorted(candidates):
        if ia in used_a or ib in used_b:
            rejected += (ia in used_a) != (ib in used_b)  # a real rival, not a duplicate route
            continue
        used_a.add(ia)
        used_b.add(ib)
        matches.append((ia, ib, method))
    return matches, rejected, [w for w in weak if w[0] not in used_a and w[1] not in used_b]


def fuzzy_candidates(
    left_a: list[dict], left_b: list[dict], threshold: float
) -> list[tuple[str, str, str, str, float]]:
    """Best look-alike in B for each unmatched A node. For review only, never merged."""
    names_b = [(n["id"], n["name"], norm_name(n["name"])) for n in left_b]
    out = []
    for n in left_a:
        sm = SequenceMatcher(None, "", norm_name(n["name"]))  # seq2 is cached by difflib
        best: tuple[str, str] | None = None
        best_ratio = 0.0
        for ib, raw_b, nb in names_b:
            sm.set_seq1(nb)
            if sm.real_quick_ratio() < threshold or sm.quick_ratio() < threshold:
                continue
            ratio = sm.ratio()
            if ratio > best_ratio:
                best, best_ratio = (ib, raw_b), ratio
        if best and best_ratio >= threshold:
            out.append((n["id"], n["name"], best[0], best[1], round(best_ratio, 3)))
    return sorted(out, key=lambda r: -r[4])


# --------------------------------------------------------------------------- #
# Merge helpers
# --------------------------------------------------------------------------- #
def union_lists(a: list | None, b: list | None) -> list:
    out, seen = [], set()
    for item in [*(a or []), *(b or [])]:
        key = json.dumps(item, sort_keys=True, default=str)
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


BACKING_PROVENANCE = ("source", "literature")


def merged_provenance(a: list | None, b: list | None) -> list:
    """Union of both runs' provenance, but an edge only stays source/literature-backed
    when BOTH runs back it; otherwise the backing tags are dropped and it counts as
    LLM-inferred (the seeder derives ``source_backed`` from these tags)."""
    def backed(p: list | None) -> bool:
        return any(tag in BACKING_PROVENANCE for tag in p or [])

    merged = union_lists(a, b)
    if backed(a) and backed(b):
        return merged
    return union_lists([tag for tag in merged if tag not in BACKING_PROVENANCE], ["llm_inferred"])


def mean(a, b):
    values = [v for v in (a, b) if isinstance(v, (int, float))]
    return round(sum(values) / len(values), 4) if values else None


def assert_acyclic(edges: list[dict]) -> None:
    adj, indeg = defaultdict(list), Counter()
    nodes = set()
    for e in edges:
        if e["type"] == "ENABLES":
            adj[e["source"]].append(e["target"])
            indeg[e["target"]] += 1
            nodes.update((e["source"], e["target"]))
    queue = [n for n in nodes if indeg[n] == 0]
    seen = 0
    while queue:
        u = queue.pop()
        seen += 1
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                queue.append(v)
    if seen != len(nodes):
        sys.exit(f"merged ENABLES graph has a cycle ({len(nodes) - seen} nodes involved), aborting")


def reach_stats(edges: list[dict], reactor_ids: set[str]) -> dict[str, dict]:
    """Per technology: direct reactors, reachable reactors and reachable technologies."""
    adj = defaultdict(set)
    for e in edges:
        if e["type"] == "ENABLES":
            adj[e["source"]].add(e["target"])
    stats = {}
    for start in adj:
        seen, stack = set(), list(adj[start])
        while stack:
            u = stack.pop()
            if u not in seen:
                seen.add(u)
                stack.extend(adj.get(u, ()))
        stats[start] = {
            "direct_reactors": len(adj[start] & reactor_ids),
            "reactor_reach": len(seen & reactor_ids),
            "enabled_descendants": len(seen - reactor_ids),
        }
    return stats


DEPLOYMENT_SECTION_RE = re.compile(r"^## Deployment\n.*?(?=^## |\Z)", re.M | re.S)


def existing_deployments(out: Path) -> dict[str, tuple[dict, str | None]]:
    """Deployment research already in the output's technology files, by node id:
    (frontmatter ``deployment`` block, ``## Deployment`` body section or None).
    Read before the folder is rebuilt so research added after a merge survives."""
    found = {}
    for path in (out / "technologies").glob("*.md"):
        parsed = read_md(path)
        if not parsed or not parsed[0].get("id") or not parsed[0].get("deployment"):
            continue
        fm, body = parsed
        section = DEPLOYMENT_SECTION_RE.search(body)
        found[fm["id"]] = (fm["deployment"], section.group(0) if section else None)
    return found


def with_deployment_section(body: str, section: str) -> str:
    """Replace the body's ``## Deployment`` section, or insert it before ``## Taxonomy``
    (where the generator puts it), or append it."""
    if DEPLOYMENT_SECTION_RE.search(body):
        return DEPLOYMENT_SECTION_RE.sub(lambda _: section, body, count=1)
    taxonomy = re.search(r"^## Taxonomy\n", body, re.M)
    if taxonomy:
        return body[:taxonomy.start()] + section + body[taxonomy.start():]
    return body.rstrip("\n") + "\n\n" + section.rstrip("\n") + "\n"


def rebuild_out_dir(out: Path, sources: tuple[Path, Path]) -> None:
    if out.resolve() in {s.resolve() for s in sources}:
        sys.exit("--out must not be one of the input folders")
    out.mkdir(parents=True, exist_ok=True)
    for sub in GENERATED_DIRS:
        path = out / sub
        if path.is_symlink() or path.is_file():
            sys.exit(f"{path} is not a plain directory, refusing to replace it")
        if path.exists():
            shutil.rmtree(path)
        path.mkdir()


def link(target: Path, link_path: Path) -> None:
    if target.exists() and not link_path.exists() and not link_path.is_symlink():
        link_path.symlink_to(os.path.relpath(target.resolve(), link_path.parent.resolve()))


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("run_a", type=Path)
    ap.add_argument("run_b", type=Path)
    ap.add_argument("--out", type=Path, default=Path("data/extracted/merged"))
    ap.add_argument("--label", help="display label for a newly created dataset.json")
    ap.add_argument("--fuzzy", type=float, default=FUZZY_THRESHOLD,
                    help="name similarity above which unmatched pairs are listed for review")
    ap.add_argument("--keep-dead-ends", action="store_true",
                    help="keep shared technologies that do not lead to any reactor")
    ap.add_argument("--discard-deployment", action="store_true",
                    help="do not carry over deployment research already in the output folder")
    args = ap.parse_args()

    name_a, name_b = args.run_a.name, args.run_b.name
    ga, gb = load_graph(args.run_a), load_graph(args.run_b)
    md_a = {sub: load_entities(args.run_a, sub, kind) for sub, kind in
            (("technologies", "Technology"), ("orgs", "Organisation"), ("reactors", "SMRDesign"))}
    md_b = {sub: load_entities(args.run_b, sub, kind) for sub, kind in
            (("technologies", "Technology"), ("orgs", "Organisation"))}

    approved: dict[str, set[str]] = defaultdict(set)
    approved_path = args.out / "approved-matches.csv"
    if approved_path.exists():
        with approved_path.open(newline="") as f:
            for row in csv.DictReader(f):
                if row.get("id_a") and row.get("id_b"):
                    approved[row["id_a"].strip()].add(row["id_b"].strip())

    # ---- match nodes -------------------------------------------------------
    def aliases(md: dict[str, tuple[dict, str, Path]]) -> dict[str, set[str]]:
        return {i: {norm_name(a) for a in (fm.get("aliases") or []) if a} for i, (fm, _, _) in md.items()}

    by_label_a = defaultdict(list)
    by_label_b = defaultdict(list)
    for n in ga["nodes"]:
        by_label_a[n["label"]].append(n)
    for n in gb["nodes"]:
        by_label_b[n["label"]].append(n)
    node_a = {n["id"]: n for n in ga["nodes"]}
    node_b = {n["id"]: n for n in gb["nodes"]}

    matches: dict[str, list[tuple[str, str, str]]] = {}
    rivals: dict[str, int] = {}
    weak_pairs: list[tuple[str, str, str]] = []
    reactor_ids_b = {n["id"] for n in by_label_b["ReactorDesign"]}
    matches["ReactorDesign"] = [(n["id"], n["id"], "id") for n in by_label_a["ReactorDesign"]
                                if n["id"] in reactor_ids_b]
    for label, sub in (("Organisation", "orgs"), ("Technology", "technologies")):
        matches[label], rivals[label], weak = match_nodes(
            by_label_a[label], by_label_b[label], aliases(md_a[sub]), aliases(md_b[sub]), approved,
            one_way_alias=label == "Organisation")
        weak_pairs += weak

    b_to_a = {ib: ia for pairs in matches.values() for ia, ib, _ in pairs}
    kept = set(b_to_a.values())

    # ---- edges both runs agree on ------------------------------------------
    edges_a = {(e["source"], e["target"], e["type"]): e for e in ga["edges"]
               if e["source"] in kept and e["target"] in kept}
    edges_b = {}
    for e in gb["edges"]:
        s, t = b_to_a.get(e["source"]), b_to_a.get(e["target"])
        if s and t:
            edges_b[(s, t, e["type"])] = e
    merged_edges = []
    for key in sorted(edges_a.keys() & edges_b.keys()):
        ea, eb = edges_a[key], edges_b[key]
        edge = dict(ea)
        edge["verified"] = bool(ea.get("verified") or eb.get("verified"))
        for field in ("documents", "citations", "roles"):
            if ea.get(field) is not None or eb.get(field) is not None:
                edge[field] = union_lists(ea.get(field), eb.get(field))
        if ea.get("provenance") is not None or eb.get("provenance") is not None:
            edge["provenance"] = merged_provenance(ea.get("provenance"), eb.get("provenance"))
            edge["provenance_by_run"] = {name_a: ea.get("provenance") or [],
                                         name_b: eb.get("provenance") or []}
        edge["relation_type"] = ea.get("relation_type") or eb.get("relation_type")
        merged_edges.append(edge)

    assert_acyclic(merged_edges)
    reactor_ids = {ia for ia, _, _ in matches["ReactorDesign"]}
    stats = reach_stats(merged_edges, reactor_ids)
    dead_ends = sorted(ia for ia, _, _ in matches["Technology"]
                       if not stats.get(ia, {}).get("reactor_reach"))
    if not args.keep_dead_ends:
        gone = set(dead_ends)
        matches["Technology"] = [m for m in matches["Technology"] if m[0] not in gone]
        merged_edges = [e for e in merged_edges if e["source"] not in gone and e["target"] not in gone]
        stats = reach_stats(merged_edges, reactor_ids)

    # ---- merged nodes ------------------------------------------------------
    merged_nodes = []
    for label in ("ReactorDesign", "Organisation", "Technology"):
        for ia, ib, method in sorted(matches[label]):
            node = dict(node_a[ia])
            node["merged_from"] = {name_a: ia, name_b: ib}
            node["matched_by"] = method
            if label == "Technology":
                imp_a = node_a[ia].get("importance") or {}
                imp_b = node_b[ib].get("importance") or {}
                node["importance"] = {
                    **imp_a,
                    "score": mean(imp_a.get("score"), imp_b.get("score")),
                    "edge_quality": mean(imp_a.get("edge_quality"), imp_b.get("edge_quality")),
                    **stats.get(ia, {"direct_reactors": 0, "reactor_reach": 0, "enabled_descendants": 0}),
                }
            merged_nodes.append(node)
    names = {n["id"]: n["name"] for n in merged_nodes}

    # ---- write dataset folder ----------------------------------------------
    out = args.out
    preserved = {} if args.discard_deployment else existing_deployments(out)
    carried_deployments = 0
    rebuild_out_dir(out, (args.run_a, args.run_b))
    (out / "technologies" / "graph.json").write_text(
        json.dumps({"nodes": merged_nodes, "edges": merged_edges}, indent=2))

    edge_set = {(e["source"], e["target"], e["type"]): e for e in merged_edges}
    missing_md = Counter()
    dropped_refs = Counter()
    merged_importance = {n["id"]: n.get("importance") for n in merged_nodes}

    def keep(entries, key_of, make_missing, wanted):
        """Entries of a frontmatter relation list that are merged edges, plus any edge it lacks.
        Kept entries take the merged edge's provenance, so details match the tree filter."""
        entries = [
            {**x, "provenance": edge_set[key_of(x["id"])].get("provenance") or []}
            if "provenance" in x else x
            for x in (entries or []) if key_of(x.get("id")) in edge_set
        ]
        have = {x["id"] for x in entries}
        return entries + [make_missing(i, edge_set[key_of(i)]) for i in sorted(wanted - have)]

    for ia, ib, _ in matches["Technology"]:
        if ia not in md_a["technologies"]:
            missing_md["technologies"] += 1
            continue
        fm, body, path = md_a["technologies"][ia]
        fm = dict(fm)
        outgoing = {(t, typ) for (s, t, typ) in edge_set if s == ia}
        incoming = {(s, typ) for (s, t, typ) in edge_set if t == ia}
        enables = dict(fm.get("enables") or {})
        enables["reactors"] = keep(
            enables.get("reactors"), lambda i: (ia, i, "ENABLES"),
            lambda i, e: {"id": i, "name": names[i], "verified": e.get("verified", False), "evidence": []},
            {t for t, typ in outgoing if typ == "ENABLES" and t in reactor_ids})
        enables["technologies"] = keep(
            enables.get("technologies"), lambda i: (ia, i, "ENABLES"),
            lambda i, e: {"id": i, "name": names[i], "provenance": e.get("provenance") or []},
            {t for t, typ in outgoing if typ == "ENABLES" and t not in reactor_ids})
        fm["enables"] = enables
        fm["enabled_by"] = keep(
            fm.get("enabled_by"), lambda i: (i, ia, "ENABLES"),
            lambda i, e: {"id": i, "name": names[i], "provenance": e.get("provenance") or [],
                          "relation_type": e.get("relation_type"), "rationale": None,
                          "citations": e.get("citations") or []},
            {s for s, typ in incoming if typ == "ENABLES"})
        fm["broader"] = keep(
            fm.get("broader"), lambda i: (ia, i, "BROADER"),
            lambda i, e: {"id": i, "name": names[i], "provenance": e.get("provenance") or []},
            {t for t, typ in outgoing if typ == "BROADER"})
        fm["narrower"] = keep(
            fm.get("narrower"), lambda i: (i, ia, "BROADER"),
            lambda i, e: {"id": i, "name": names[i]},
            {s for s, typ in incoming if typ == "BROADER"})
        fm["importance"] = merged_importance[ia]
        if ia in preserved:
            fm["deployment"], section = preserved[ia]
            if section:
                body = with_deployment_section(body, section)
            carried_deployments += 1
        dep = fm.get("deployment")
        if isinstance(dep, dict):
            for s in dep.get("suppliers") or []:
                if isinstance(s, dict) and s.get("org_id") and s["org_id"] not in names:
                    del s["org_id"]
                    dropped_refs["technologies.deployment.suppliers.org_id"] += 1
            tpr = dep.get("trl_per_reactor")
            if isinstance(tpr, list):
                kept_tpr = [e for e in tpr
                            if not isinstance(e, dict) or not e.get("id") or e["id"] in names]
                dropped_refs["technologies.deployment.trl_per_reactor.id"] += len(tpr) - len(kept_tpr)
                dep["trl_per_reactor"] = kept_tpr
        other_name = node_b[ib]["name"]
        if norm_name(other_name) != norm_name(fm["name"]):
            fm["aliases"] = union_lists(fm.get("aliases"), [other_name])
        write_md(out / "technologies" / path.name, fm, body)

    def drop_dangling_refs(fm: dict, sub: str) -> tuple[dict, int]:
        """Remove references to entities without a merged file; returns (fm, #removed).

        Pure reference lists (orgs' supplies/develops, reactors' related) lose the whole
        entry; entries that also carry display data (reactors' developers) only lose
        their id. The nea/iaea source subtrees, entities mention lists and bodies stay
        verbatim: they record what each source stated, not graph membership."""
        fm = dict(fm)
        removed = 0
        if sub == "orgs":
            for key, field in (("supplies", "tech"),):
                if key in fm:
                    kept_entries = [s for s in fm[key] or [] if s.get(field) in names]
                    removed += len(fm[key] or []) - len(kept_entries)
                    fm[key] = kept_entries
            if "develops" in fm:
                kept_dev = [d for d in fm["develops"] or [] if d in names]
                removed += len(fm["develops"] or []) - len(kept_dev)
                fm["develops"] = kept_dev
        elif sub == "reactors":
            if "developers" in fm:
                devs = []
                for d in fm["developers"] or []:
                    if d.get("id") and d["id"] not in names:
                        d = {k: v for k, v in d.items() if k != "id"}
                        removed += 1
                    devs.append(d)
                fm["developers"] = devs
            if "related" in fm:
                kept_rel = [r for r in fm["related"] or [] if r.get("reactor_id") in names]
                removed += len(fm["related"] or []) - len(kept_rel)
                fm["related"] = kept_rel
        return fm, removed

    for label, sub in (("ReactorDesign", "reactors"), ("Organisation", "orgs")):
        for ia, _, _ in matches[label]:
            if ia in md_a[sub]:
                fm, body, src = md_a[sub][ia]
                fm, removed = drop_dangling_refs(fm, sub)
                dropped_refs[f"{sub}.{label}"] += removed
                if removed:
                    write_md(out / sub / src.name, fm, body)
                else:
                    shutil.copy2(src, out / sub / src.name)
            else:
                missing_md[sub] += 1

    # Source documents, figures and logos are referenced by relative path from the
    # markdown and are the same in both runs: link run A's instead of copying them.
    for shared in ("iaea-aris", "nea"):
        link(args.run_a / shared, out / shared)
    link(args.run_a / "orgs" / "logos", out / "orgs" / "logos")
    geocode = args.run_a / ".geocode-cache.json"
    if geocode.exists() and not (out / ".geocode-cache.json").exists():
        shutil.copy2(geocode, out / ".geocode-cache.json")

    dataset = out / "dataset.json"
    if not dataset.exists():
        base_path = args.run_a / "dataset.json"
        base = json.loads(base_path.read_text()) if base_path.exists() else {}
        meta = {"label": args.label or f"{base.get('label', name_a)} (merged: {name_a} + {name_b})"}
        if base.get("systemPrompt"):
            marker = "\n\nIMPORTANT INSTRUCTIONS"
            prompt = base["systemPrompt"]
            meta["systemPrompt"] = (prompt.replace(marker, MERGED_NOTE + marker, 1)
                                    if marker in prompt else prompt + MERGED_NOTE)
        dataset.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")

    # ---- audit files -------------------------------------------------------
    with (out / "matches.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["kind", "method", "id_a", "name_a", "id_b", "name_b"])
        for label in ("Organisation", "Technology"):
            for ia, ib, method in sorted(matches[label], key=lambda m: (m[2], m[0])):
                w.writerow([label, method, ia, node_a[ia]["name"], ib, node_b[ib]["name"]])

    matched_a = {ia for pairs in matches.values() for ia, _, _ in pairs} | set(dead_ends)
    left_a = [n for n in by_label_a["Technology"] if n["id"] not in matched_a]
    left_b = [n for n in by_label_b["Technology"] if n["id"] not in b_to_a]
    review = [(ia, node_a[ia]["name"], ib, node_b[ib]["name"], reason, "")
              for ia, ib, reason in sorted(set(weak_pairs), key=lambda w: (w[2], w[0], w[1]))]
    listed = {(r[0], r[2]) for r in review}
    review += [(ia, na, ib, nb, "similar name", ratio)
               for ia, na, ib, nb, ratio in fuzzy_candidates(left_a, left_b, args.fuzzy)
               if (ia, ib) not in listed]
    with (out / "review-candidates.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id_a", "name_a", "id_b", "name_b", "reason", "ratio"])
        w.writerows(review)

    methods = {label: Counter(m for _, _, m in matches[label]) for label in matches}
    types = Counter(e["type"] for e in merged_edges)
    rows = [
        f"# Merged dataset: `{name_a}` + `{name_b}`", "",
        "Only nodes and edges that both runs agree on.", "",
        "## Nodes", "", "| kind | matched | how |", "| --- | --- | --- |",
    ]
    for label in ("ReactorDesign", "Organisation", "Technology"):
        how = ", ".join(f"{m}: {c}" for m, c in sorted(methods[label].items()))
        rows.append(f"| {label} | {len(matches[label])} | {how} |")
    rows += [
        "", f"Shared technologies that do not lead to any reactor: {len(dead_ends)} "
            f"({'kept' if args.keep_dead_ends else 'dropped'}).",
        f"Rival candidates rejected by one-to-one matching: "
        f"{rivals['Technology']} technologies, {rivals['Organisation']} organisations.",
        f"Possible matches left unmerged for review: {len(review)} (`review-candidates.csv`).",
        f"Approved pairs applied: {methods['Technology'].get('approved', 0)}.",
        "", "## Edges", "", "| type | in both runs |", "| --- | --- |",
        *[f"| {t} | {c} |" for t, c in sorted(types.items())],
        f"| **total** | **{len(merged_edges)}** |", "",
        f"Run A has {len(ga['edges'])} edges, run B has {len(gb['edges'])}.", "",
        "Frontmatter references to entities without a merged file removed: "
            f"{sum(dropped_refs.values())} "
            f"({', '.join(f'{k}: {v}' for k, v in sorted(dropped_refs.items())) or 'none'}).",
        "",
    ]
    if missing_md:
        rows += ["## Missing markdown", "", *[f"- {k}: {v}" for k, v in missing_md.items()], ""]
    (out / "merge-report.md").write_text("\n".join(rows))

    print(f"nodes: {len(merged_nodes)} "
          f"({', '.join(f'{len(matches[k])} {k}' for k in matches)})")
    print(f"edges: {len(merged_edges)} ({', '.join(f'{c} {t}' for t, c in sorted(types.items()))})")
    print(f"technologies not leading to any reactor: {len(dead_ends)}"
          f"{' (kept)' if args.keep_dead_ends else ' (dropped)'}")
    print(f"for review: {len(review)} possible matches -> {out}/review-candidates.csv")
    print(f"deployment research carried over from the previous output: {carried_deployments}"
          f"{' (discarded on request)' if args.discard_deployment else ''}")
    if dropped_refs:
        print(f"dangling references removed: {dict(dropped_refs)}")
    if missing_md:
        print(f"WARNING missing markdown: {dict(missing_md)}")
    print(f"report -> {out}/merge-report.md")


if __name__ == "__main__":
    main()
