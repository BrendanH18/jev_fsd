"""Query a saved Jev benchmark without starting the simulator."""

import argparse
import json
from pathlib import Path

from run_insights import decisions, motion, outcomes, safety


# Reserved by static/js/bench/heldout.js. Explicit single-seed runs may omit the heldout flag.
HELDOUT_SEEDS = (101, 102, 103)


def heldout(config, rows):
    seeds = config.get("seeds")
    if config.get("heldout") or config.get("seed") in HELDOUT_SEEDS:
        return True
    if isinstance(seeds, list) and any(seed in HELDOUT_SEEDS for seed in seeds):
        return True
    prefixes = tuple(f"s{seed}-" for seed in HELDOUT_SEEDS)
    return any(isinstance(row.get("id"), str) and row["id"].startswith(prefixes) for row in rows)


def reject_constant(value):
    raise ValueError(f"invalid JSON number: {value}")


def main():
    catalog = {}
    for module in (decisions, motion, outcomes, safety):
        if catalog.keys() & module.REPORTS.keys():
            raise RuntimeError("Duplicate report ID")
        catalog.update(module.REPORTS)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", nargs="?", type=Path, help="saved benchmark JSON file")
    parser.add_argument("reports", nargs="*", help="report IDs (default: all)")
    parser.add_argument("--list", action="store_true", help="list report IDs and descriptions")
    args = parser.parse_args()
    if args.list:
        for key, (description, _) in sorted(catalog.items()):
            print(f"{key:36} {description}")
        return
    if args.run is None:
        parser.error("provide a saved run or use --list")
    for key in args.reports:
        if key not in catalog:
            parser.error(f"unknown report {key!r}; see --list")
    try:
        run = json.loads(args.run.read_text(encoding="utf-8"), parse_constant=reject_constant)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    rows = run.get("results") if isinstance(run, dict) else None
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        parser.error("expected a benchmark object with a results array of route objects")
    config = run.get("config", {})
    if not isinstance(config, dict):
        parser.error("expected a benchmark config object")
    if heldout(config, rows):
        parser.error("held-out suites must be reported separately using the benchmark summary")
    try:
        reports = {key: catalog[key][1](rows) for key in args.reports or sorted(catalog)}
        print(json.dumps(reports, indent=2, allow_nan=False))
    except (ValueError, OverflowError) as exc:
        parser.error(f"invalid numeric measurement: {exc}")


if __name__ == "__main__":
    main()
