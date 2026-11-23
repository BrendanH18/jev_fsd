"""Query a saved Jev benchmark without starting the simulator."""

import argparse
import json
from pathlib import Path

from run_insights import comparison, decisions, motion, outcomes, profiles, safety


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


def load_run(path):
    try:
        run = json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant)
    except (OSError, ValueError) as exc:
        raise ValueError(f"{path}: {exc}") from exc
    rows = run.get("results") if isinstance(run, dict) else None
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValueError(f"{path}: expected a benchmark object with a results array of route objects")
    config = run.get("config", {})
    if not isinstance(config, dict):
        raise ValueError(f"{path}: expected a benchmark config object")
    if heldout(config, rows):
        raise ValueError(f"{path}: held-out suites must be reported separately using the benchmark summary")
    return config, rows


def main():
    catalog = {}
    for module in (decisions, motion, outcomes, safety):
        if catalog.keys() & module.REPORTS.keys():
            raise RuntimeError("Duplicate report ID")
        catalog.update(module.REPORTS)
    available = {**catalog, **profiles.REPORTS, **profiles.PAIRED_RATES}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", nargs="?", type=Path, help="saved benchmark JSON file")
    parser.add_argument("reports", nargs="*", help="report IDs (default: all original reports)")
    parser.add_argument("--compare", type=Path, help="second saved benchmark to compare with the baseline")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--list", action="store_true", help="list original report IDs and descriptions")
    mode.add_argument("--list-profiles", action="store_true", help="list cohort profile IDs and descriptions")
    mode.add_argument("--profiles", action="store_true", help="run all cohort profiles")
    mode.add_argument("--list-paired-rates", action="store_true", help="list matched rate report IDs and descriptions")
    mode.add_argument("--paired-rates", action="store_true", help="run all matched rate reports with --compare")
    args = parser.parse_intermixed_args()
    if args.list or args.list_profiles or args.list_paired_rates:
        listed = catalog if args.list else profiles.PAIRED_RATES if args.list_paired_rates else profiles.REPORTS
        width = 36 if args.list else max(map(len, listed))
        for key, (description, _) in sorted(listed.items()):
            print(f"{key:{width}} {description}")
        return
    if args.run is None:
        parser.error("provide a saved run or use --list, --list-profiles or --list-paired-rates")
    if args.profiles and args.reports:
        parser.error("--profiles runs the whole profile catalog. Use report IDs to select individual reports.")
    if args.paired_rates and args.reports:
        parser.error("--paired-rates runs the whole matched rate catalog. Use report IDs to select individual reports.")
    for key in args.reports:
        if key not in available:
            parser.error(f"unknown report {key!r}. See --list, --list-profiles and --list-paired-rates.")
    default = profiles.PAIRED_RATES if args.paired_rates else profiles.REPORTS if args.profiles else catalog
    keys = args.reports or sorted(default)
    selected = {key: available[key][1] for key in keys if key not in profiles.PAIRED_RATES}
    paired = {key: available[key][1] for key in keys if key in profiles.PAIRED_RATES}
    if paired and args.compare is None:
        parser.error("matched rate reports require --compare")
    try:
        config, rows = load_run(args.run)
        if args.compare is not None:
            other_config, other_rows = load_run(args.compare)
            baseline = args.run.name, config, rows
            other = args.compare.name, other_config, other_rows
            reports = comparison.compare(baseline, other, selected, paired)
        else:
            reports = {key: report(rows) for key, report in selected.items()}
    except ValueError as exc:
        parser.error(str(exc))
    except OverflowError as exc:
        parser.error(f"invalid numeric measurement: {exc}")
    try:
        print(json.dumps(reports, indent=2, allow_nan=False))
    except ValueError as exc:
        parser.error(f"invalid numeric measurement: {exc}")


if __name__ == "__main__":
    main()
