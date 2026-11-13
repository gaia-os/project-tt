#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
save_deterministic_analysis.py
-------------------------------
Runs the deterministic simulation (option=None, years_per_trl = 2.5) for one
or more tech tree JSON files and writes a consolidated analysis file to
public/outputs/<tree_name>/deterministic_analysis.json

The output file has the shape:
{
  "<node_label>": {
    "downstream_count": <int>,          # transitive count of all nodes reachable downstream
    "yearly": {
      "<year>": {
        "status":       "Active" | "Pending" | "Completed",
        "delta_twh":    <float>,         # accelerated_mwh - baseline_mwh, in TWh
        "baseline_twh": <float>,         # raw baseline pathway MWh converted to TWh
        "accelerated_twh": <float>       # raw accelerated pathway MWh converted to TWh
      },
      ...
    }
  },
  ...
}

Only years where the node is Active and has a non-zero delta are included in
"yearly" for delta_twh/baseline_twh/accelerated_twh. Status entries for
Pending and Completed years are always included so the frontend can render
the full timeline.

Usage:
    # Single tree
    python simulations/save_baseline_simulation.py data/<tech_tree>.json

    # Multiple trees
    python simulations/save_baseline_simulation.py data/tree_a.json data/tree_b.json

    # All trees via glob
    python simulations/save_baseline_simulation.py data/*.json

Options:
    --years        Years to simulate (default: 30)
    --output-dir   Root output directory (default: ./public/outputs)
    --sim-path     Directory containing simulation.py (default: ./simulations)
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate deterministic_analysis.json for tech tree JSON files."
    )
    parser.add_argument(
        "tech_tree_paths",
        nargs="+",
        help="Path(s) to tech tree JSON file(s).",
    )
    parser.add_argument(
        "--years",
        type=int,
        default=30,
        help="Years to simulate (default: 30).",
    )
    parser.add_argument(
        "--output-dir",
        default="./public/outputs",
        help="Root output directory. Results go into <output-dir>/<tree_name>/.",
    )
    parser.add_argument(
        "--sim-path",
        default="./simulations",
        help="Path to directory containing baseline_simulation.py.",
    )
    return parser.parse_args()


def load_tech_tree(path: Path) -> dict:
    """Load and return a tech tree JSON, handling Python-dict format if needed."""
    raw = path.read_text(encoding="utf-8")

    # Attempt plain JSON first
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Fall back: convert Python dict literal syntax (single quotes, True/False/None)
    converted = (
        raw.replace("'", '"')
           .replace(": True", ": true")
           .replace(": False", ": false")
           .replace(": None", ": null")
    )
    return json.loads(converted)


def build_analysis(scheduler, impact_table, status_table, baseline_mwh_table, accelerated_mwh_table) -> dict:
    """
    Consolidate simulation outputs and downstream counts into a single dict
    keyed by node label.
    """
    analysis = {}

    for node_id, node in scheduler.nodes.items():
        if node.get("type") not in ("Milestone", "EnablingTechnology"):
            continue

        label = node["label"]
        downstream_count = scheduler.get_transitive_downstream_count(node_id)

        # Merge yearly data from all four tables
        # Collect the union of all years that appear in any table for this node
        all_years = set()
        all_years.update(status_table.get(label, {}).keys())
        all_years.update(impact_table.get(label, {}).keys())
        all_years.update(baseline_mwh_table.get(label, {}).keys())
        all_years.update(accelerated_mwh_table.get(label, {}).keys())

        yearly = {}
        for year in sorted(all_years, key=lambda y: int(y)):
            entry = {}

            status = status_table.get(label, {}).get(year)
            if status:
                entry["status"] = status

            delta = impact_table.get(label, {}).get(year)
            if delta is not None:
                entry["delta_twh"] = round(delta, 6)

            baseline = baseline_mwh_table.get(label, {}).get(year)
            if baseline is not None:
                entry["baseline_twh"] = round(baseline, 6)

            accelerated = accelerated_mwh_table.get(label, {}).get(year)
            if accelerated is not None:
                entry["accelerated_twh"] = round(accelerated, 6)

            if entry:
                yearly[str(year)] = entry

        analysis[label] = {
            "downstream_count": downstream_count,
            "yearly": yearly,
        }

    return analysis


def process_tree(tech_tree_path: Path, years: int, output_dir: Path, sim_path: Path) -> None:
    print(f"\n{'='*60}")
    print(f"Processing: {tech_tree_path}")

    # Add simulation directory to path so we can import NuclearScheduler
    sys.path.insert(0, str(sim_path.resolve()))
    from baseline_simulation import NuclearScheduler  # noqa: E402

    # Load tech tree
    print(f"  Loading tech tree...")
    tech_tree = load_tech_tree(tech_tree_path)
    node_count = len(tech_tree["graph"]["nodes"])
    edge_count = len(tech_tree["graph"]["edges"])
    print(f"  Loaded {node_count} nodes, {edge_count} edges.")

    # Run deterministic simulation (option=None → uses (9 - trl) * 2.5 per node)
    print(f"  Running deterministic simulation ({years} years)...")
    scheduler = NuclearScheduler(tech_tree)
    impact_table, status_table, _rng_table, _lhc_seed, baseline_mwh_table, accelerated_mwh_table = (
        scheduler.run_simulation(years_to_simulate=years, option=None)
    )

    milestone_count = sum(
        1 for n in tech_tree["graph"]["nodes"]
        if n.get("type") in ("Milestone", "EnablingTechnology")
    )
    print(f"  Simulation complete. {milestone_count} Milestone/EnablingTechnology nodes tracked.")

    # Build consolidated analysis dict
    print(f"  Building consolidated analysis...")
    analysis = build_analysis(
        scheduler, impact_table, status_table, baseline_mwh_table, accelerated_mwh_table
    )

    # Add metadata block
    metadata = {
        "__meta__": {
            "tree_name": tech_tree_path.stem,
            "source_file": str(tech_tree_path),
            "years_simulated": years,
            "simulation_option": "deterministic",
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "node_count": node_count,
            "edge_count": edge_count,
            "tracked_nodes": milestone_count,
        }
    }
    output = {**metadata, **analysis}

    # Write output
    tree_name = tech_tree_path.stem
    dest_dir = output_dir / tree_name
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_file = dest_dir / "deterministic_analysis.json"

    print(f"  Writing → {dest_file}")
    with open(dest_file, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)

    size_kb = dest_file.stat().st_size / 1024
    print(f"  Done. File size: {size_kb:.1f} KB")


def main():
    args = parse_args()
    sim_path = Path(args.sim_path)
    output_dir = Path(args.output_dir)

    if not sim_path.exists():
        print(f"ERROR: simulation directory not found: {sim_path}", file=sys.stderr)
        sys.exit(1)

    errors = []
    for raw_path in args.tech_tree_paths:
        path = Path(raw_path)
        if not path.exists():
            print(f"WARNING: file not found, skipping: {path}", file=sys.stderr)
            errors.append(raw_path)
            continue
        try:
            process_tree(path, args.years, output_dir, sim_path)
        except Exception as exc:
            print(f"ERROR processing {path}: {exc}", file=sys.stderr)
            errors.append(raw_path)

    print(f"\n{'='*60}")
    if errors:
        print(f"Completed with {len(errors)} error(s): {errors}")
        sys.exit(1)
    else:
        print(f"All trees processed successfully.")


if __name__ == "__main__":
    main()