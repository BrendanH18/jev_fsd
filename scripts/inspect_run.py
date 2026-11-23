"""Query a saved Jev benchmark without starting the simulator."""

import argparse
import csv
import gzip
import io
import json
from math import isfinite
from pathlib import Path
import sys
from zlib import error as GzipError

from run_insights import comparison, decisions, motion, outcomes, profiles, safety, scores


# Reserved by static/js/bench/heldout.js. Explicit single-seed runs may omit the heldout flag.
HELDOUT_SEEDS = (101, 102, 103)

ARENA_CONFIG_KEYS = (
    "brain",
    "driver",
    "model",
    "mode",
    "set",
    "track",
    "engine",
    "drives",
    "weather",
    "features",
    "npcs",
    "park",
    "hour",
    "without",
    "map",
    "bbox",
    "pack",
    "seed",
    "seeds",
    "count",
    "heldout",
)


def heldout(config, rows):
    seeds = config.get("seeds")
    if config.get("heldout") or config.get("seed") in HELDOUT_SEEDS:
        return True
    if isinstance(seeds, list) and any(seed in HELDOUT_SEEDS for seed in seeds):
        return True
    prefixes = tuple(f"s{seed}-" for seed in HELDOUT_SEEDS)
    for row in rows:
        for field in ("id", "challenge"):
            value = row.get(field)
            if isinstance(value, str) and value.startswith(prefixes):
                return True
    return False


def reject_constant(value):
    raise ValueError(f"invalid JSON number: {value}")


def finite_float(value):
    number = float(value)
    if not isfinite(number):
        reject_constant(value)
    return number


def _read_text(path):
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return handle.read()
    return path.read_text(encoding="utf-8")


def _normalize_row(row):
    route_id = row.get("id")
    if isinstance(route_id, str) and route_id.strip():
        return row
    challenge = row.get("challenge")
    if isinstance(challenge, str) and challenge.strip():
        return {**row, "id": challenge}
    return row


def load_run(path):
    path = Path(path)
    try:
        run = json.loads(_read_text(path), parse_float=finite_float, parse_constant=reject_constant)
    except (OSError, ValueError, EOFError, GzipError) as exc:
        raise ValueError(f"{path}: {exc}") from exc
    raw_rows = run.get("results") if isinstance(run, dict) else None
    if not isinstance(raw_rows, list) or not all(isinstance(row, dict) for row in raw_rows):
        raise ValueError(f"{path}: expected a benchmark object with a results array of route objects")
    rows = [_normalize_row(row) for row in raw_rows]
    has_challenges = any(isinstance(row.get("challenge"), str) and row["challenge"].strip() for row in raw_rows)
    if "config" in run:
        raw_config = run["config"]
        if not isinstance(raw_config, dict):
            raise ValueError(f"{path}: expected a benchmark config object")
        config = dict(raw_config)
    elif isinstance(run.get("summary"), dict):
        summary = run["summary"]
        config = {key: summary[key] for key in ARENA_CONFIG_KEYS if key in summary}
    else:
        config = {}
    if "set" in config or has_challenges:
        config["kind"] = "arena"
    if isinstance(run.get("suite_version"), str):
        config["suite_version"] = run["suite_version"]
    if heldout(config, rows):
        raise ValueError(f"{path}: held-out suites must be reported separately using the benchmark summary")
    return config, rows


def _parse_cohorts(specs, parser):
    parsed = []
    for spec in specs or ():
        key, sep, value = spec.partition("=")
        if not sep or key not in profiles.COHORTS:
            valid = ", ".join(sorted(profiles.COHORTS))
            parser.error(f"invalid --cohort {spec!r}; expected <key>=<value> with key in: {valid}")
        parsed.append((key, value))
    return parsed


def _matches_cohorts(row, cohort_filters):
    return all((profiles.COHORTS[key][1](row) or "unknown") == expected for key, expected in cohort_filters)


def _filter_rows(rows, *, route_ids=None, cohort_filters=(), only_failures=False):
    filtered = rows
    if route_ids is not None:
        filtered = [row for row in filtered if row.get("id") in route_ids]
    if cohort_filters:
        filtered = [row for row in filtered if _matches_cohorts(row, cohort_filters)]
    if only_failures:
        filtered = [row for row in filtered if outcomes.verdict(row) == "failed"]
    return filtered


def _filter_pair(left_rows, right_rows, *, route_ids=None, cohort_filters=(), only_failures=False):
    if route_ids is not None:
        left_rows = [row for row in left_rows if row.get("id") in route_ids]
        right_rows = [row for row in right_rows if row.get("id") in route_ids]
    if cohort_filters:
        left_rows = [row for row in left_rows if _matches_cohorts(row, cohort_filters)]
        keep_ids = {row.get("id") for row in left_rows}
        right_rows = [row for row in right_rows if row.get("id") in keep_ids]
    if only_failures:
        failed_ids = {row.get("id") for row in left_rows if outcomes.verdict(row) == "failed"} | {
            row.get("id") for row in right_rows if outcomes.verdict(row) == "failed"
        }
        left_rows = [row for row in left_rows if row.get("id") in failed_ids]
        right_rows = [row for row in right_rows if row.get("id") in failed_ids]
    return left_rows, right_rows


def _truncate_report(payload, limit):
    if isinstance(payload, list):
        return payload[:limit]
    if not isinstance(payload, dict):
        return payload
    if isinstance(payload.get("routes"), list) and (not payload["routes"] or isinstance(payload["routes"][0], dict)):
        return {**payload, "routes": payload["routes"][:limit]}
    if isinstance(payload.get("pairs"), list):
        return {**payload, "pairs": payload["pairs"][:limit]}
    if isinstance(payload.get("ranked_hazards"), list):
        return {**payload, "ranked_hazards": payload["ranked_hazards"][:limit]}
    if isinstance(payload.get("affected_routes"), list):
        return {**payload, "affected_routes": payload["affected_routes"][:limit]}
    if payload and all(isinstance(v, dict) and "affected_routes" in v for v in payload.values()):
        return {k: _truncate_report(v, limit) for k, v in payload.items()}
    return payload


def _apply_top(output, limit, *, is_compare=False):
    if limit is None:
        return output
    if is_compare:
        updated = {}
        for name, value in output["reports"].items():
            if isinstance(value, dict) and "baseline" in value and "comparison" in value and "groups" not in value:
                updated[name] = {
                    "baseline": _truncate_report(value["baseline"], limit),
                    "comparison": _truncate_report(value["comparison"], limit),
                }
            else:
                updated[name] = _truncate_report(value, limit)
        return {**output, "reports": updated}
    return {name: _truncate_report(value, limit) for name, value in output.items()}


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, separators=(",", ":"), allow_nan=False)
    return str(value)


def _csv_cell(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return _cell(value)


def _dict_rows_section(title, items):
    if not items:
        return (title, ["status"], [{"status": "none"}])
    headers = []
    for item in items:
        for key in item:
            if key not in headers:
                headers.append(key)
    return (title, headers, items)


def _report_sections(title, payload):
    if isinstance(payload, list):
        if payload and all(isinstance(item, dict) for item in payload):
            return [_dict_rows_section(title, payload)]
        return [(title, ["value"], [{"value": item} for item in payload] or [{"value": "none"}])]
    if not isinstance(payload, dict):
        return [(title, ["value"], [{"value": payload}])]
    if isinstance(payload.get("routes"), list) and (not payload["routes"] or isinstance(payload["routes"][0], dict)):
        sections = [_dict_rows_section(title, payload["routes"])]
        if "summary" in payload:
            stats = {**payload["summary"], "unavailable": payload["unavailable"]}
            sections.append(_dict_rows_section(f"{title}: summary", [stats]))
        return sections
    if "groups" in payload and isinstance(payload["groups"], dict):
        rows = []
        for group, stats in payload["groups"].items():
            if isinstance(stats, dict) and "baseline" in stats and "difference" in stats:
                rows.append(
                    {
                        "group": group,
                        "pairs": stats.get("pairs"),
                        "measured": stats["difference"].get("measured"),
                        "baseline_median": stats["baseline"].get("median"),
                        "comparison_median": stats["comparison"].get("median"),
                        "diff_median": stats["difference"].get("median"),
                        "diff_mean": stats["difference"].get("mean"),
                        "diff_min": stats["difference"].get("min"),
                        "diff_max": stats["difference"].get("max"),
                    }
                )
            elif isinstance(stats, dict) and "aggregate" in stats:
                rows.append({"group": group, **stats["aggregate"]})
            elif isinstance(stats, dict):
                rows.append({"group": group, **stats})
            else:
                rows.append({"group": group, "value": stats})
        sections = [_dict_rows_section(title, rows)]
        for group, stats in payload["groups"].items():
            if isinstance(stats, dict) and "distributions" in stats:
                distributions = [{"metric": name, **dist} for name, dist in stats["distributions"].items()]
                sections.append(_dict_rows_section(f"{title}: {group}", distributions))
        return sections
    if "aggregate" in payload and "distributions" in payload:
        sections = [(f"{title}: aggregate", list(payload["aggregate"]), [payload["aggregate"]])]
        dist_rows = [{"metric": name, **dist} for name, dist in payload["distributions"].items()]
        sections.append(_dict_rows_section(f"{title}: distributions", dist_rows))
        return sections
    if "hazards" in payload and isinstance(payload["hazards"], dict):
        rows = [{"field": field, **entry} for field, entry in payload["hazards"].items()]
        sections = [_dict_rows_section(title, rows)]
        if payload["off_road_incidents"]["affected_routes"]:
            sections.append(
                _dict_rows_section(f"{title}: off-road incidents", payload["off_road_incidents"]["affected_routes"])
            )
        return sections
    if "ranked_hazards" in payload and isinstance(payload["ranked_hazards"], list):
        families = [
            {"family": family, "measured_routes": info["measured_routes"], "triggered_routes": info["triggered_routes"]}
            for family, info in payload["by_family"].items()
        ]
        return [
            _dict_rows_section(f"{title}: ranked hazards", payload["ranked_hazards"]),
            _dict_rows_section(f"{title}: families", families),
        ]
    if payload and all(isinstance(v, dict) and "affected_routes" in v for v in payload.values()):
        rows = [
            {
                "field": field,
                "unit": info.get("unit"),
                "measured_routes": info.get("measured_routes"),
                "unmeasured_routes": info.get("unmeasured_routes"),
                "total": info.get("total"),
                "affected_routes": len(info.get("affected_routes", [])),
            }
            for field, info in payload.items()
        ]
        return [_dict_rows_section(title, rows)]
    if "counts" in payload and isinstance(payload["counts"], dict):
        rows = [{"label": label, "count": count} for label, count in payload["counts"].items()]
        return [_dict_rows_section(title, rows)]
    return [(title, ["key", "value"], [{"key": k, "value": v} for k, v in payload.items()])]


def _build_sections(data, *, is_summary=False, is_compare=False):
    sections = []
    if is_compare:
        if data["condition_differences"]:
            diff_rows = [{"field": field, **values} for field, values in data["condition_differences"].items()]
            sections.append(_dict_rows_section("condition_differences", diff_rows))
        sections.append(_dict_rows_section("routes", [{key: len(ids) for key, ids in data["routes"].items()}]))
        if data["outcome_changes"]:
            sections.append(_dict_rows_section("outcome_changes", data["outcome_changes"]))
        if regression := data.get("regression"):
            stats = {"regressed": regression["regressed"], **regression["deltas"], **regression["coverage"]}
            sections.append(_dict_rows_section("regression", [stats]))
            if regression["new_audit_failures"]:
                sections.append(_dict_rows_section("new audit failures", regression["new_audit_failures"]))
            if regression["increased_violations"]:
                sections.append(_dict_rows_section("increased violation counts", regression["increased_violations"]))
        if is_summary:
            sections.append(_dict_rows_section("deltas", [data["deltas"]]))
            for side in ("baseline", "comparison"):
                for title, headers, rows in _build_sections(data[side]["summary"], is_summary=True):
                    sections.append((f"{side}: {title}", headers, rows))
        else:
            for name, value in data["reports"].items():
                if isinstance(value, dict) and "baseline" in value and "comparison" in value and "groups" not in value:
                    for side in ("baseline", "comparison"):
                        sections.extend(_report_sections(f"{name} ({side})", value[side]))
                else:
                    sections.extend(_report_sections(name, value))
        return sections
    if is_summary:
        verdict_row = {k: v for k, v in data["verdicts"].items() if k != "top_failure_reasons"}
        sections.append(("verdicts", list(verdict_row), [verdict_row]))
        if data["verdicts"]["top_failure_reasons"]:
            sections.append(_dict_rows_section("top_failure_reasons", data["verdicts"]["top_failure_reasons"]))
        agg = data["scores"]["aggregate"]
        sections.append(("scores", list(agg), [agg]))
        if data["scores"]["lowest_routes"]:
            sections.append(_dict_rows_section("lowest_routes", data["scores"]["lowest_routes"]))
        if data["safety"]["triggered_hazards"]:
            sections.append(_dict_rows_section("safety_triggers", data["safety"]["triggered_hazards"]))
        motion_rows = [{"metric": name, **vals} for name, vals in data["motion_peaks"].items()]
        sections.append(_dict_rows_section("motion_peaks", motion_rows))
        dec = data["decisions"]
        dec_row = {
            "cost_usd": dec["cost_usd"],
            "usd_per_pass": dec["usd_per_pass"],
            "tokens": dec["tokens"],
            "calls": dec["calls"],
            "latency_p50_median": dec["latency_p50_ms"]["median"],
            "latency_p95_median": dec["latency_p95_ms"]["median"],
            "model_share": dec["model_share"],
            "fallback_share": dec["fallback_share"],
            "fallback_routes_affected": dec["fallback_routes_affected"],
        }
        sections.append(("decisions", list(dec_row), [dec_row]))
        return sections
    for name, value in data.items():
        sections.extend(_report_sections(name, value))
    return sections


def format_output(data, fmt, *, is_summary=False, is_compare=False):
    # Validate finite numbers for all formats just as JSON mode does.
    serialized = json.dumps(data, indent=2, allow_nan=False)
    if fmt == "json":
        return serialized
    sections = _build_sections(data, is_summary=is_summary, is_compare=is_compare)
    if fmt == "table":
        blocks = []
        for title, headers, rows in sections:
            str_rows = [[_cell(row.get(h)) for h in headers] for row in rows]
            widths = [max((len(h), *(len(r[i]) for r in str_rows))) for i, h in enumerate(headers)]
            lines = [title]
            lines.append("  ".join(f"{h:{widths[i]}}" for i, h in enumerate(headers)))
            lines.append("  ".join("-" * widths[i] for i in range(len(headers))))
            for row in str_rows:
                lines.append("  ".join(f"{row[i]:{widths[i]}}" for i in range(len(headers))))
            blocks.append("\n".join(lines))
        return "\n\n".join(blocks)
    if fmt == "markdown":
        blocks = []
        for title, headers, rows in sections:
            lines = [f"## {title}", ""]
            lines.append("| " + " | ".join(headers) + " |")
            lines.append("| " + " | ".join("---" for _ in headers) + " |")
            for row in rows:
                cells = [_cell(row.get(h)).replace("|", "\\|").replace("\n", "<br>") for h in headers]
                lines.append("| " + " | ".join(cells) + " |")
            blocks.append("\n".join(lines))
        return "\n\n".join(blocks)
    if fmt == "csv":
        all_headers = ["section"]
        flat_rows = []
        for title, headers, rows in sections:
            for header in headers:
                if header not in all_headers:
                    all_headers.append(header)
            for row in rows:
                flat_rows.append({"section": _csv_cell(title), **{h: _csv_cell(row.get(h)) for h in headers}})
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=all_headers, lineterminator="\n", quoting=csv.QUOTE_ALL)
        writer.writerow({header: _csv_cell(header) for header in all_headers})
        writer.writerows(flat_rows)
        return buffer.getvalue().rstrip("\n")
    raise ValueError(f"unsupported format: {fmt}")


def main():
    catalog = {}
    for module in (decisions, motion, outcomes, safety):
        if catalog.keys() & module.REPORTS.keys():
            raise RuntimeError("Duplicate report ID")
        catalog.update(module.REPORTS)
    analytics = {**scores.REPORTS, **safety.EXTENDED_REPORTS, **decisions.EXTENDED_REPORTS}
    all_paired = {**profiles.PAIRED_RATES, **scores.PAIRED_METRICS}
    available = {**catalog, **profiles.REPORTS, **analytics, **all_paired}

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", nargs="?", type=Path, help="saved benchmark or arena JSON/.json.gz file")
    parser.add_argument("reports", nargs="*", help="report IDs (default: all original reports)")
    parser.add_argument("--compare", type=Path, help="second saved run to compare with the baseline")
    parser.add_argument(
        "--format",
        choices=("json", "table", "markdown", "csv"),
        default="json",
        help="output format (default: json)",
    )
    parser.add_argument("--top", type=int, help="limit ranked route lists and digest entries to top N")
    parser.add_argument("--only-failures", action="store_true", help="include only failed routes")
    parser.add_argument("--route", action="append", help="filter to a specific route ID (repeatable)")
    parser.add_argument(
        "--cohort",
        action="append",
        help="filter to routes matching <cohort>=<value> (repeatable; e.g. signals=0)",
    )
    parser.add_argument("--filter", help="case-insensitive substring filter for --list* commands")
    parser.add_argument(
        "--fail-on-regression",
        action="store_true",
        help="with --compare, exit 2 for a regression or 3 when coverage is incomplete",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--list", action="store_true", help="list original report IDs and descriptions")
    mode.add_argument("--list-profiles", action="store_true", help="list cohort profile IDs and descriptions")
    mode.add_argument("--profiles", action="store_true", help="run all cohort profiles")
    mode.add_argument("--list-paired-rates", action="store_true", help="list matched rate report IDs and descriptions")
    mode.add_argument("--paired-rates", action="store_true", help="run all matched rate reports with --compare")
    mode.add_argument("--list-scores", action="store_true", help="list composite score report IDs and descriptions")
    mode.add_argument("--scores", action="store_true", help="run all composite score reports")
    mode.add_argument(
        "--list-analytics",
        action="store_true",
        help="list composite score, aggregate safety and decision summary report IDs and descriptions",
    )
    mode.add_argument(
        "--analytics",
        action="store_true",
        help="run composite score, aggregate safety and decision summary reports",
    )
    mode.add_argument(
        "--list-paired-metrics",
        action="store_true",
        help="list matched score and continuous metric delta report IDs and descriptions",
    )
    mode.add_argument(
        "--paired-metrics",
        action="store_true",
        help="run all matched score and continuous metric delta reports with --compare",
    )
    mode.add_argument("--summary", action="store_true", help="print a concise executive digest of the run")
    args = parser.parse_intermixed_args()

    list_catalogs = (
        (args.list, catalog, 36),
        (args.list_profiles, profiles.REPORTS, None),
        (args.list_paired_rates, profiles.PAIRED_RATES, None),
        (args.list_scores, scores.REPORTS, None),
        (args.list_analytics, analytics, None),
        (args.list_paired_metrics, scores.PAIRED_METRICS, None),
    )
    for active, listed, fixed_width in list_catalogs:
        if not active:
            continue
        if args.filter is not None:
            needle = args.filter.lower()
            listed = {
                key: entry for key, entry in listed.items() if needle in key.lower() or needle in entry[0].lower()
            }
        width = fixed_width if fixed_width is not None else max((len(k) for k in listed), default=0)
        for key, (description, _) in sorted(listed.items()):
            print(f"{key:{width}} {description}")
        return

    if args.top is not None and args.top < 1:
        parser.error("--top must be at least 1")
    if args.fail_on_regression and args.compare is None:
        parser.error("--fail-on-regression requires --compare")
    if args.run is None:
        parser.error(
            "provide a saved run or use --list, --list-profiles, --list-paired-rates, "
            "--list-scores, --list-analytics or --list-paired-metrics"
        )
    cohort_filters = _parse_cohorts(args.cohort, parser)
    route_ids = set(args.route) if args.route else None

    for flag, label in (
        (args.profiles, "--profiles"),
        (args.paired_rates, "--paired-rates"),
        (args.scores, "--scores"),
        (args.analytics, "--analytics"),
        (args.paired_metrics, "--paired-metrics"),
        (args.summary, "--summary"),
    ):
        if flag and args.reports:
            parser.error(f"{label} cannot be combined with individual report IDs. Use report IDs to select reports.")

    for key in args.reports:
        if key not in available:
            parser.error(
                f"unknown report {key!r}. See --list, --list-profiles, --list-paired-rates, "
                "--list-scores, --list-analytics and --list-paired-metrics."
            )

    regression = None
    try:
        config, rows = load_run(args.run)
        if args.summary:
            top = args.top if args.top is not None else 5
            if args.compare is not None:
                other_config, other_rows = load_run(args.compare)
                rows, other_rows = _filter_pair(
                    rows,
                    other_rows,
                    route_ids=route_ids,
                    cohort_filters=cohort_filters,
                    only_failures=args.only_failures,
                )
                if args.fail_on_regression:
                    routes, _, left_matched, right_matched = comparison.match_routes(
                        args.run.name, config, rows, args.compare.name, other_config, other_rows
                    )
                    regression = comparison.assess_regression(left_matched, right_matched, routes)
                output = scores.build_comparison_summary(
                    (args.run.name, config, rows),
                    (args.compare.name, other_config, other_rows),
                    top=top,
                )
            else:
                rows = _filter_rows(
                    rows,
                    route_ids=route_ids,
                    cohort_filters=cohort_filters,
                    only_failures=args.only_failures,
                )
                output = scores.build_summary(config, rows, top=top)
        else:
            if args.paired_rates:
                default = profiles.PAIRED_RATES
            elif args.paired_metrics:
                default = scores.PAIRED_METRICS
            elif args.profiles:
                default = profiles.REPORTS
            elif args.scores:
                default = scores.REPORTS
            elif args.analytics:
                default = analytics
            else:
                default = catalog
            keys = args.reports or sorted(default)
            selected = {key: available[key][1] for key in keys if key not in all_paired}
            paired = {key: available[key][1] for key in keys if key in all_paired}
            if paired and args.compare is None:
                parser.error("matched rate and metric reports require --compare")
            if args.compare is not None:
                other_config, other_rows = load_run(args.compare)
                rows, other_rows = _filter_pair(
                    rows,
                    other_rows,
                    route_ids=route_ids,
                    cohort_filters=cohort_filters,
                    only_failures=args.only_failures,
                )
                if args.fail_on_regression:
                    routes, _, left_matched, right_matched = comparison.match_routes(
                        args.run.name, config, rows, args.compare.name, other_config, other_rows
                    )
                    regression = comparison.assess_regression(left_matched, right_matched, routes)
                baseline = args.run.name, config, rows
                other = args.compare.name, other_config, other_rows
                output = comparison.compare(baseline, other, selected, paired)
                output = _apply_top(output, args.top, is_compare=True)
            else:
                rows = _filter_rows(
                    rows,
                    route_ids=route_ids,
                    cohort_filters=cohort_filters,
                    only_failures=args.only_failures,
                )
                output = {key: report(rows) for key, report in selected.items()}
                output = _apply_top(output, args.top, is_compare=False)
    except ValueError as exc:
        parser.error(str(exc))
    except OverflowError as exc:
        parser.error(f"invalid numeric measurement: {exc}")

    if regression is not None:
        output["regression"] = regression
        if regression["coverage"]["incomplete"]:
            print("Regression coverage is incomplete. See coverage details in the report.", file=sys.stderr)
    try:
        print(format_output(output, args.format, is_summary=args.summary, is_compare=args.compare is not None))
    except ValueError as exc:
        parser.error(f"invalid numeric measurement: {exc}")
    if regression and regression["regressed"]:
        sys.exit(2)
    if regression and regression["coverage"]["incomplete"]:
        sys.exit(3)


if __name__ == "__main__":
    main()
