"""Query a saved Jev benchmark without starting the simulator."""

import argparse
import csv
from fnmatch import fnmatchcase
import gzip
import io
import json
from html import escape as escape_html
from math import isfinite
from pathlib import Path
import sys
from zlib import error as GzipError

if __package__:
    from .run_insights import (
        changes,
        comparison,
        decisions,
        evidence,
        motion,
        outcomes,
        profiles,
        repeats,
        safety,
        scores,
    )
else:
    from run_insights import (
        changes,
        comparison,
        decisions,
        evidence,
        motion,
        outcomes,
        profiles,
        repeats,
        safety,
        scores,
    )


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
    "cover",
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
    data = sys.stdin.buffer.read() if path == Path("-") else path.read_bytes()
    if path.suffix.lower() == ".gz" or data.startswith(b"\x1f\x8b"):
        data = gzip.decompress(data)
    return data.decode("utf-8-sig")


def _unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


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
        run = json.loads(
            _read_text(path),
            parse_float=finite_float,
            parse_constant=reject_constant,
            object_pairs_hook=_unique_keys,
        )
    except (OSError, ValueError, EOFError, GzipError, RecursionError) as exc:
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
    manifest = run.get("manifest")
    if isinstance(manifest, dict) and manifest.get("model") is not None:
        config["model"] = manifest["model"]
    if "set" in config or has_challenges:
        config["kind"] = "arena"
    if isinstance(run.get("suite_version"), str):
        if "suite_version" in config and config["suite_version"] != run["suite_version"]:
            raise ValueError(f"{path}: config and report disagree on the suite version")
        config["suite_version"] = run["suite_version"]
    if run.get("stopped"):
        config["stopped"] = run["stopped"]
    if any(row.get("heldout") is True for row in rows):
        config["heldout"] = True
    if heldout(config, rows):
        raise ValueError(f"{path}: held-out suites must be reported separately using the benchmark summary")
    return config, rows


def _parse_cohorts(specs, parser):
    parsed = []
    for spec in specs or ():
        key, sep, value = spec.partition("=")
        if not sep or not value.strip() or key not in profiles.COHORTS:
            valid = ", ".join(sorted(profiles.COHORTS))
            parser.error(f"invalid --cohort {spec!r}; expected <key>=<value> with key in: {valid}")
        parsed.append((key, value))
    return parsed


def _matches_cohorts(row, cohort_filters):
    return all((profiles.COHORTS[key][1](row) or "unknown") == expected for key, expected in cohort_filters)


def _matches_failure(row, selected):
    return bool(selected.intersection(outcomes.reasons(row) or ()))


def _parse_bounds(specs, flag, parser):
    limits = {}
    for spec in specs or ():
        key, sep, raw = spec.partition("=")
        if not sep or key not in profiles.METRICS:
            parser.error(f"invalid {flag} {spec!r}; use FIELD=NUMBER with a field from --list-fields")
        try:
            value = finite_float(raw)
        except ValueError:
            parser.error(f"invalid {flag} {spec!r}; the limit must be a finite number")
        if key in limits:
            parser.error(f"{flag} {key} was supplied more than once")
        limits[key] = value
    return limits


def _matches_bounds(row, bounds):
    for field, (minimum, maximum) in bounds.items():
        value = profiles.measurement(row, field)
        if value is None or (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
            return False
    return True


def _filter_rows(
    rows,
    *,
    route_ids=None,
    route_globs=(),
    exclude=(),
    cohort_filters=(),
    only_failures=False,
    failure_reasons=(),
    maps=(),
    bounds=None,
):
    filtered = rows
    if route_ids is not None:
        filtered = [row for row in filtered if isinstance(row.get("id"), str) and row["id"] in route_ids]
    if route_globs:
        filtered = [
            row
            for row in filtered
            if isinstance(row.get("id"), str) and any(fnmatchcase(row["id"], glob) for glob in route_globs)
        ]
    if exclude:
        filtered = [row for row in filtered if row.get("id") not in exclude]
    if cohort_filters:
        filtered = [row for row in filtered if _matches_cohorts(row, cohort_filters)]
    if only_failures:
        filtered = [row for row in filtered if outcomes.verdict(row) == "failed"]
    if failure_reasons:
        filtered = [row for row in filtered if _matches_failure(row, failure_reasons)]
    if maps:
        filtered = [row for row in filtered if row.get("map") in maps]
    if bounds:
        filtered = [row for row in filtered if _matches_bounds(row, bounds)]
    return filtered


def _filter_pair(left_rows, right_rows, *, only_failures=False, failure_reasons=(), **filters):
    left_rows = _filter_rows(left_rows, **filters)
    right_rows = _filter_rows(right_rows, **{key: filters[key] for key in ("route_ids", "route_globs", "exclude")})
    if any(filters[key] for key in ("cohort_filters", "maps", "bounds")):
        keep_ids = {row.get("id") for row in left_rows}
        right_rows = [row for row in right_rows if row.get("id") in keep_ids]
    if only_failures:
        failed_ids = {row.get("id") for row in left_rows if outcomes.verdict(row) == "failed"} | {
            row.get("id") for row in right_rows if outcomes.verdict(row) == "failed"
        }
        left_rows = [row for row in left_rows if row.get("id") in failed_ids]
        right_rows = [row for row in right_rows if row.get("id") in failed_ids]
    if failure_reasons:
        matching_ids = {
            row.get("id") for rows in (left_rows, right_rows) for row in rows if _matches_failure(row, failure_reasons)
        }
        left_rows = [row for row in left_rows if row.get("id") in matching_ids]
        right_rows = [row for row in right_rows if row.get("id") in matching_ids]
    return left_rows, right_rows


def _truncate_report(payload, limit):
    if isinstance(payload, list):
        return payload[:limit]
    if not isinstance(payload, dict):
        return payload
    if isinstance(payload.get("rows"), list):
        return {**payload, "rows": payload["rows"][:limit]}
    if isinstance(payload.get("routes"), list) and (not payload["routes"] or isinstance(payload["routes"][0], dict)):
        return {**payload, "routes": payload["routes"][:limit]}
    if isinstance(payload.get("pairs"), list):
        return {**payload, "pairs": payload["pairs"][:limit]}
    if "off_road_incidents" in payload:
        truncated = {**payload, "off_road_incidents": _truncate_report(payload["off_road_incidents"], limit)}
        if "ranked_hazards" in payload:
            truncated["ranked_hazards"] = payload["ranked_hazards"][:limit]
        return truncated
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


def _visible_text(value, *, multiline=False):
    text = _cell(value)
    if not multiline:
        text = text.replace("\r", "\\r").replace("\n", "\\n")
    return "".join(
        f"\\x{ord(char):02x}" if (ord(char) < 32 or 127 <= ord(char) <= 159) and char not in "\r\n" else char
        for char in text
    )


def _markdown_cell(value):
    text = escape_html(_visible_text(value, multiline=True)).replace("\\", "\\\\")
    for char in "|[]*_`~":
        text = text.replace(char, "\\" + char)
    return text.replace("\r\n", "<br>").replace("\r", "<br>").replace("\n", "<br>")


def _dict_rows_section(title, items):
    if not items:
        return (title, ["status"], [{"status": "none"}])
    return (title, list(dict.fromkeys(key for item in items for key in item)), items)


def _report_sections(title, payload):
    if isinstance(payload, list):
        if payload and all(isinstance(item, dict) for item in payload):
            return [_dict_rows_section(title, payload)]
        return [(title, ["value"], [{"value": item} for item in payload] or [{"value": "none"}])]
    if not isinstance(payload, dict):
        return [(title, ["value"], [{"value": payload}])]
    if isinstance(payload.get("rows"), list):
        sections = [_dict_rows_section(title, payload["rows"])]
        for key in ("coverage", "totals", "spread"):
            if key in payload:
                sections.append(_dict_rows_section(f"{title}: {key}", [payload[key]]))
        if "attempts" in payload:
            sections.append(_dict_rows_section(f"{title}: attempts", payload["attempts"]))
        metadata = {key: payload[key] for key in ("unit", "aggregation") if key in payload}
        if metadata:
            sections.append(_dict_rows_section(f"{title}: measurement", [metadata]))
        return sections
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
        sections = [
            _dict_rows_section(f"{title}: ranked hazards", payload["ranked_hazards"]),
            _dict_rows_section(f"{title}: families", families),
        ]
        if payload["off_road_incidents"]["affected_routes"]:
            sections.append(
                _dict_rows_section(f"{title}: off-road incidents", payload["off_road_incidents"]["affected_routes"])
            )
        return sections
    if payload and all(isinstance(v, dict) and "affected_routes" in v for v in payload.values()):
        rows = [
            {
                "field": field,
                "unit": info.get("unit"),
                "measured_routes": info.get("measured_routes"),
                "unmeasured_routes": info.get("unmeasured_routes"),
                "total": info.get("total"),
                "affected_routes": info["triggered_routes"],
            }
            for field, info in payload.items()
        ]
        affected = [{"field": field, **entry} for field, info in payload.items() for entry in info["affected_routes"]]
        sections = [_dict_rows_section(title, rows)]
        if affected:
            sections.append(_dict_rows_section(f"{title}: affected routes", affected))
        return sections
    if "counts" in payload and isinstance(payload["counts"], dict):
        rows = [{"label": label, "count": count} for label, count in payload["counts"].items()]
        if "measured_routes" in payload:
            return [
                _dict_rows_section(title, rows),
                _dict_rows_section(f"{title}: coverage", [{"measured_routes": payload["measured_routes"]}]),
            ]
        return [_dict_rows_section(title, rows)]
    return [(title, ["key", "value"], [{"key": k, "value": v} for k, v in payload.items()])]


def _build_sections(data, *, is_summary=False, is_compare=False, is_repeat=False):
    sections = []
    if is_repeat:
        sections.append(_dict_rows_section("attempts", data["attempts"]))
        sections.append(_dict_rows_section("matched routes", [{"id": id_} for id_ in data["routes"]["matched"]]))
        sections.append(_dict_rows_section("excluded routes", data["routes"]["excluded"]))
        for name, payload in data["reports"].items():
            sections.extend(_report_sections(name, payload))
        return sections
    if is_compare:
        if data["condition_differences"]:
            diff_rows = [{"field": field, **values} for field, values in data["condition_differences"].items()]
            sections.append(_dict_rows_section("condition_differences", diff_rows))
        sections.append(_dict_rows_section("routes", [{key: len(ids) for key, ids in data["routes"].items()}]))
        excluded = [
            {"status": status, "id": route_id}
            for status, ids in data["routes"].items()
            if status != "matched"
            for route_id in ids
        ]
        if excluded:
            sections.append(_dict_rows_section("excluded routes", excluded))
        if data["outcome_changes"]:
            sections.append(_dict_rows_section("outcome_changes", data["outcome_changes"]))
        if regression := data.get("regression"):
            stats = {"regressed": regression["regressed"], **regression["deltas"], **regression["coverage"]}
            sections.append(_dict_rows_section("regression", [stats]))
            if regression["new_audit_failures"]:
                sections.append(_dict_rows_section("new audit failures", regression["new_audit_failures"]))
            if regression["increased_violations"]:
                sections.append(_dict_rows_section("increased violation counts", regression["increased_violations"]))
            if regression["lost_passes"]:
                sections.append(_dict_rows_section("lost passes", [{"id": id_} for id_ in regression["lost_passes"]]))
            if regression["increased_collisions"]:
                sections.append(_dict_rows_section("increased collision counts", regression["increased_collisions"]))
            if regression["new_simulation_errors"]:
                sections.append(_dict_rows_section("new simulation errors", regression["new_simulation_errors"]))
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
        sections.append(_dict_rows_section("config", [data["config"]]))
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


def format_output(data, fmt, *, is_summary=False, is_compare=False, is_repeat=False, is_catalog=False):
    # Validate finite numbers for all formats just as JSON mode does.
    serialized = json.dumps(data, indent=2, allow_nan=False)
    if fmt == "json":
        return serialized
    sections = (
        [_dict_rows_section("catalog", data["catalog"])]
        if is_catalog
        else _build_sections(data, is_summary=is_summary, is_compare=is_compare, is_repeat=is_repeat)
    )
    if fmt == "table":
        blocks = []
        for title, headers, rows in sections:
            str_rows = [[_visible_text(row.get(h)) for h in headers] for row in rows]
            labels = [_visible_text(h) for h in headers]
            widths = [max((len(h), *(len(r[i]) for r in str_rows))) for i, h in enumerate(labels)]
            lines = [_visible_text(title)]
            lines.append("  ".join(f"{h:{widths[i]}}" for i, h in enumerate(labels)))
            lines.append("  ".join("-" * widths[i] for i in range(len(headers))))
            for row in str_rows:
                lines.append("  ".join(f"{row[i]:{widths[i]}}" for i in range(len(headers))))
            blocks.append("\n".join(lines))
        return "\n\n".join(blocks)
    if fmt == "markdown":
        blocks = []
        for title, headers, rows in sections:
            lines = [f"## {escape_html(_visible_text(title))}", ""]
            lines.append("| " + " | ".join(map(_markdown_cell, headers)) + " |")
            lines.append("| " + " | ".join("---" for _ in headers) + " |")
            for row in rows:
                cells = [_markdown_cell(row.get(h)) for h in headers]
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


def main(argv=None):
    catalog = {}
    for module in (decisions, motion, outcomes, safety):
        if catalog.keys() & module.REPORTS.keys():
            raise RuntimeError("Duplicate report ID")
        catalog.update(module.REPORTS)
    analytics = {**scores.REPORTS, **safety.EXTENDED_REPORTS, **decisions.EXTENDED_REPORTS}
    all_paired = {**profiles.PAIRED_RATES, **scores.PAIRED_METRICS, **changes.REPORTS}
    diagnostics = {**outcomes.DIAGNOSTICS, **evidence.REPORTS}
    available = {**catalog, **profiles.REPORTS, **analytics, **all_paired, **diagnostics}

    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("run", nargs="?", type=Path, help="saved benchmark or arena JSON/.json.gz file, or - for stdin")
    parser.add_argument("reports", nargs="*", help="report IDs (default: all original reports)")
    comparisons = parser.add_mutually_exclusive_group()
    comparisons.add_argument("--compare", type=Path, help="second saved run to compare with the baseline")
    comparisons.add_argument(
        "--repeat", type=Path, action="append", help="another saved attempt by the same driver (repeatable)"
    )
    parser.add_argument(
        "--expected-repeats", type=int, help="check total attempts, including the positional run, against a plan"
    )
    parser.add_argument(
        "--same-conditions",
        action="store_true",
        help="require the same recorded driving conditions and JavaScript engine; allow a different driver",
    )
    parser.add_argument(
        "--format",
        choices=("json", "table", "markdown", "csv"),
        help="output format (default: JSON for reports and table for catalogs)",
    )
    parser.add_argument("--top", type=int, help="limit ranked route lists and digest entries to top N")
    parser.add_argument("--only-failures", action="store_true", help="include only failed routes")
    parser.add_argument("--failure-reason", action="append", help="match a recorded failure reason (repeatable)")
    parser.add_argument("--drive-map", action="append", help="filter by the recorded per-drive map (repeatable)")
    parser.add_argument("--route", action="append", help="filter to a specific route ID (repeatable)")
    parser.add_argument("--route-glob", action="append", help="include route IDs matching a shell pattern (repeatable)")
    parser.add_argument("--exclude-route", action="append", help="omit an exact route ID (repeatable)")
    parser.add_argument(
        "--min-metric",
        action="append",
        help="require a measured FIELD to be at least NUMBER (FIELD=NUMBER; baseline side)",
    )
    parser.add_argument(
        "--max-metric",
        action="append",
        help="require a measured FIELD to be at most NUMBER (FIELD=NUMBER; baseline side)",
    )
    parser.add_argument(
        "--require-selection",
        action="store_true",
        help="fail when no drives satisfy selection, or none match across inputs",
    )
    parser.add_argument(
        "--complete-coverage", action="store_true", help="fail when selected drives cannot all be matched across inputs"
    )
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
    mode.add_argument("--list-diagnostics", action="store_true", help="list forensic report IDs and descriptions")
    mode.add_argument("--list-changes", action="store_true", help="list matched change reports")
    mode.add_argument("--changes", action="store_true", help="run all matched change reports with --compare")
    mode.add_argument("--list-repeats", action="store_true", help="list repeat spread and coverage reports")
    mode.add_argument("--list-cohorts", action="store_true", help="list recognized --cohort keys")
    mode.add_argument("--list-fields", action="store_true", help="list measured fields eligible for numeric filters")
    args = parser.parse_intermixed_args(argv)

    list_catalogs = (
        (args.list, catalog, 36),
        (args.list_profiles, profiles.REPORTS, None),
        (args.list_paired_rates, profiles.PAIRED_RATES, None),
        (args.list_scores, scores.REPORTS, None),
        (args.list_analytics, analytics, None),
        (args.list_paired_metrics, scores.PAIRED_METRICS, None),
        (args.list_diagnostics, diagnostics, None),
        (args.list_changes, changes.REPORTS, None),
        (args.list_repeats, repeats.REPORTS, None),
        (args.list_cohorts, profiles.COHORTS, None),
        (args.list_fields, {key: (unit, None) for key, unit in profiles.METRICS.items()}, None),
    )
    for active, listed, fixed_width in list_catalogs:
        if not active:
            continue
        if args.run or args.compare or args.repeat or args.reports:
            parser.error("catalog listing does not take saved runs or report IDs")
        if any(
            getattr(args, flag) not in (None, False)
            for flag in (
                "top",
                "route",
                "route_glob",
                "exclude_route",
                "drive_map",
                "failure_reason",
                "cohort",
                "min_metric",
                "max_metric",
                "only_failures",
                "fail_on_regression",
                "same_conditions",
                "expected_repeats",
                "complete_coverage",
                "require_selection",
            )
        ):
            parser.error("catalog listing does not take run selection or validation options")
        if args.filter is not None:
            needle = args.filter.lower()
            listed = {
                key: entry for key, entry in listed.items() if needle in key.lower() or needle in entry[0].lower()
            }
        if args.format and args.format != "table":
            output = {"catalog": [{"id": key, "description": entry[0]} for key, entry in sorted(listed.items())]}
            print(format_output(output, args.format, is_catalog=True))
            return 0
        width = fixed_width if fixed_width is not None else max((len(k) for k in listed), default=0)
        for key, (description, _) in sorted(listed.items()):
            print(f"{key:{width}} {description}")
        return 0

    if args.filter is not None:
        parser.error("--filter requires a catalog listing mode")
    if args.top is not None and args.top < 1:
        parser.error("--top must be at least 1")
    if args.fail_on_regression and args.compare is None:
        parser.error("--fail-on-regression requires --compare")
    if args.same_conditions and args.compare is None:
        parser.error("--same-conditions requires --compare")
    if args.complete_coverage and not (args.compare or args.repeat):
        parser.error("--complete-coverage requires --compare or --repeat")
    if args.expected_repeats is not None and not args.repeat:
        parser.error("--expected-repeats requires --repeat")
    if args.expected_repeats is not None and args.expected_repeats != len(args.repeat) + 1:
        parser.error(f"expected {args.expected_repeats} attempts; received {len(args.repeat) + 1}")
    if args.run is None:
        parser.error(
            "provide a saved run or use --list, --list-profiles, --list-paired-rates, "
            "--list-scores, --list-analytics, --list-paired-metrics, --list-diagnostics, "
            "--list-changes or --list-repeats"
        )
    input_paths = [args.run, *([args.compare] if args.compare else args.repeat or ())]
    if input_paths.count(Path("-")) > 1:
        parser.error("standard input can supply only one saved report")
    for field, flag in (
        ("route", "--route"),
        ("exclude_route", "--exclude-route"),
        ("route_glob", "--route-glob"),
        ("drive_map", "--drive-map"),
        ("failure_reason", "--failure-reason"),
    ):
        if any(not entry.strip() for entry in getattr(args, field) or ()):
            parser.error(f"{flag} requires a nonblank value")
    cohort_filters = _parse_cohorts(args.cohort, parser)
    route_ids = set(args.route) if args.route else None
    minima = _parse_bounds(args.min_metric, "--min-metric", parser)
    maxima = _parse_bounds(args.max_metric, "--max-metric", parser)
    for field in minima.keys() & maxima.keys():
        if minima[field] > maxima[field]:
            parser.error(f"{field}: --min-metric exceeds --max-metric")
    filters = {
        "route_ids": route_ids,
        "route_globs": tuple(args.route_glob or ()),
        "exclude": tuple(args.exclude_route or ()),
        "cohort_filters": cohort_filters,
        "only_failures": args.only_failures,
        "failure_reasons": set(args.failure_reason or ()),
        "maps": tuple(args.drive_map or ()),
        "bounds": {key: (minima.get(key), maxima.get(key)) for key in minima.keys() | maxima.keys()},
    }

    for flag, label in (
        (args.profiles, "--profiles"),
        (args.paired_rates, "--paired-rates"),
        (args.scores, "--scores"),
        (args.analytics, "--analytics"),
        (args.paired_metrics, "--paired-metrics"),
        (args.changes, "--changes"),
        (args.summary, "--summary"),
    ):
        if flag and args.reports:
            parser.error(f"{label} cannot be combined with individual report IDs. Use report IDs to select reports.")
        if flag and args.repeat:
            parser.error(f"{label} cannot be combined with --repeat. See --list-repeats.")

    report_ids = repeats.REPORTS if args.repeat else available
    for key in args.reports:
        if key in repeats.REPORTS and not args.repeat:
            parser.error(f"{key} requires --repeat")
        if key not in report_ids:
            if args.repeat:
                parser.error(f"unknown repeat report {key!r}. See --list-repeats.")
            parser.error(
                f"unknown report {key!r}. See --list, --list-profiles, --list-paired-rates, "
                "--list-scores, --list-analytics, --list-paired-metrics, --list-diagnostics and --list-changes."
            )

    paired_keys = set(args.reports) & all_paired.keys()
    if args.compare is None and (args.changes or args.paired_rates or args.paired_metrics or paired_keys):
        parser.error("matched reports require --compare")

    regression = None
    try:
        if args.repeat:
            return _repeat_output(input_paths, args, filters)
        config, rows = load_run(args.run)
        if args.compare is not None:
            other_config, other_rows = load_run(args.compare)
            if args.same_conditions:
                differences = comparison.condition_differences(config, other_config)
                differences.pop("driver", None)
                if differences:
                    raise ValueError(f"recorded driving conditions differ: {', '.join(differences)}")
            # Validate identities before filters can hide malformed or duplicate rows.
            comparison.index_routes(args.run.name, rows)
            comparison.index_routes(args.compare.name, other_rows)
            if args.same_conditions:
                conflicts = comparison.drive_condition_conflicts(config, rows, other_config, other_rows)
                if conflicts:
                    raise ValueError(f"recorded drive conditions differ: {'; '.join(conflicts)}")
            rows, other_rows = _filter_pair(rows, other_rows, **filters)
            if args.fail_on_regression:
                routes, _, left_matched, right_matched = comparison.match_routes(
                    args.run.name, config, rows, args.compare.name, other_config, other_rows
                )
                regression = comparison.assess_regression(left_matched, right_matched, routes)
        else:
            rows = _filter_rows(rows, **filters)
        if args.require_selection and not rows and args.compare is None:
            raise ValueError("no drives satisfy the requested selection")
        if args.summary:
            top = args.top if args.top is not None else 5
            if args.compare is not None:
                output = scores.build_comparison_summary(
                    (args.run.name, config, rows),
                    (args.compare.name, other_config, other_rows),
                    top=top,
                )
            else:
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
            elif args.changes:
                default = changes.REPORTS
            else:
                default = catalog
            keys = args.reports or sorted(default)
            selected = {key: available[key][1] for key in keys if key not in all_paired}
            paired = {key: available[key][1] for key in keys if key in all_paired}
            if args.compare is not None:
                baseline = args.run.name, config, rows
                other = args.compare.name, other_config, other_rows
                output = comparison.compare(baseline, other, selected, paired)
                output = _apply_top(output, args.top, is_compare=True)
            else:
                output = {key: report(rows) for key, report in selected.items()}
                output = _apply_top(output, args.top, is_compare=False)
        if args.compare is not None:
            selected_routes = output["routes"]
            if args.require_selection and not selected_routes["matched"]:
                raise ValueError("no matched drives satisfy the requested selection")
            if args.complete_coverage and (
                not selected_routes["matched"] or any(ids for key, ids in selected_routes.items() if key != "matched")
            ):
                raise ValueError("incomplete match coverage; omit --complete-coverage to inspect excluded routes")
    except ValueError as exc:
        parser.error(str(exc))
    except OverflowError as exc:
        parser.error(f"invalid numeric measurement: {exc}")

    if regression is not None:
        output["regression"] = regression
        if regression["coverage"]["incomplete"]:
            print("Regression coverage is incomplete. See coverage details in the report.", file=sys.stderr)
    try:
        print(
            format_output(output, args.format or "json", is_summary=args.summary, is_compare=args.compare is not None)
        )
    except ValueError as exc:
        parser.error(f"invalid numeric measurement: {exc}")
    if regression and regression["regressed"]:
        return 2
    if regression and regression["coverage"]["incomplete"]:
        return 3
    return 0


def _repeat_output(paths, args, filters):
    repeats.distinct_paths(path for path in paths if path != Path("-"))
    runs = [(str(path), *load_run(path)) for path in paths]
    repeats.validate_inputs(runs)
    membership = {key: filters[key] for key in ("route_ids", "route_globs", "exclude")}
    selected = [_filter_rows(rows, **membership) for _, _, rows in runs]
    if any(filters[key] for key in ("cohort_filters", "maps", "bounds")):
        baseline = _filter_rows(selected[0], **{key: filters[key] for key in ("cohort_filters", "maps", "bounds")})
        keep = {row["id"] for row in baseline}
        selected = [[row for row in rows if row["id"] in keep] for rows in selected]
    if filters["only_failures"] or filters["failure_reasons"]:
        keep = {
            row["id"]
            for rows in selected
            for row in rows
            if (not filters["only_failures"] or outcomes.verdict(row) == "failed")
            and (not filters["failure_reasons"] or _matches_failure(row, filters["failure_reasons"]))
        }
        selected = [[row for row in rows if row["id"] in keep] for rows in selected]
    output = repeats.build(
        [(name, config, rows) for (name, config, _), rows in zip(runs, selected, strict=True)],
        args.reports or repeats.DEFAULT_REPORTS,
        limit=args.top,
    )
    if args.require_selection and not output["routes"]["matched"]:
        raise ValueError("no routes match across the saved attempts")
    if args.complete_coverage and (not output["routes"]["matched"] or output["routes"]["excluded"]):
        raise ValueError("incomplete repeat coverage; omit --complete-coverage to inspect excluded routes")
    print(format_output(output, args.format or "json", is_repeat=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
