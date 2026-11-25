#!/usr/bin/env python3
"""Summarise the weekly city soak (.github/workflows/soak.yml) from its downloaded artifacts.

    python3 scripts/soak_summary.py ARTIFACTS_DIR

ARTIFACTS_DIR holds one directory per leg, each with the leg's leg.txt (its name), and its soak.json
(scripts/soak.mjs) or run.json (scripts/bench_node.mjs); a lone artifact sits directly in ARTIFACTS_DIR,
and with none it may not exist. The legs expected are read from soak.yml's `LEG` lines and matrices.
The soak is report-only (ROADMAP.md 1.6/1.7), so this never fails: it writes a table of every leg to
$GITHUB_STEP_SUMMARY (stdout when unset) and prints a `::warning` annotation for each failed route,
each harness error and each leg that left no result.
"""

from __future__ import annotations

import argparse
import gzip
import html
import json
import os
import re
import sys
from collections import Counter
from itertools import product
from pathlib import Path
from zlib import error as DeflateError

WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "soak.yml"
REPORT_FILES = ("soak.json", "soak.json.gz", "run.json", "run.json.gz")
NO_RESULT = "no result (setup failed, timed out or was cancelled)"
NON_AUDITS = {"simulation error", "stuck", "timeout", "collision"}
CATEGORIES = {"throws": "simulation error", "stuck": "stuck", "collisions": "collision", "audits": "audit failure"}


# This reads the workflow's literal matrix and LEG, without evaluating workflow expressions.
YAML_QUOTED = re.compile(r"'(?:[^']|'')*|" r'"(?:[^"\\]|\\.)*"')
MATRIX_REF = re.compile(r"\$\{\{\s*matrix\.(\w+)\s*\}\}")


def _split_unquoted(line: str, delimiter: str, *, comment=False) -> list[str]:
    parts = []
    start = 0
    quoted = iter(YAML_QUOTED.finditer(line))
    quote = next(quoted, None)
    for pos, char in enumerate(line):
        while quote and pos >= quote.end():
            quote = next(quoted, None)
        if quote and pos >= quote.start():
            continue
        if char != delimiter:
            continue
        if comment:
            if pos == 0 or line[pos - 1].isspace():
                return [line[:pos]]
        else:
            parts.append(line[start:pos])
            start = pos + 1
    return [*parts, line[start:]]


def _strip_yaml_comment(line: str) -> str:
    return _split_unquoted(line, "#", comment=True)[0].rstrip()


def _unquote(value: str) -> str:
    value = value.strip()
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    if value.startswith('"') and value.endswith('"'):
        try:
            return json.loads(value)
        except ValueError as err:
            raise ValueError(f"unsupported quoted matrix value {value!r}") from err
    return value


def _job_blocks(text: str) -> list[list[str]]:
    lines = text.splitlines()
    in_jobs = False
    jobs_indent = 0
    job_indent: int | None = None
    blocks: list[list[str]] = []
    current: list[str] | None = None
    for raw in lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            if current is not None:
                current.append(raw)
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if not in_jobs:
            if re.match(r"^jobs\s*:", raw):
                in_jobs = True
                jobs_indent = indent
            continue
        if indent <= jobs_indent:
            break
        if job_indent is None:
            job_indent = indent
        if indent == job_indent and re.match(r"^[A-Za-z0-9_-]+\s*:", stripped):
            current = [raw]
            blocks.append(current)
        elif current is not None:
            current.append(raw)
    return blocks


def _extract_subblock(lines: list[str], key: str, parent_indent: int | None = None) -> list[str]:
    result: list[str] = []
    collecting = False
    key_indent = -1
    pattern = re.compile(rf"^{re.escape(key)}\s*:\s*$")
    for raw in lines:
        cleaned = _strip_yaml_comment(raw)
        stripped = cleaned.strip()
        if not stripped:
            if collecting:
                result.append(raw)
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if collecting:
            if indent <= key_indent:
                break
            result.append(raw)
        elif pattern.match(stripped) and (parent_indent is None or indent == parent_indent):
            collecting = True
            key_indent = indent
    return result


def _matrix_values(matrix_lines: list[str]) -> list[dict[str, str]]:
    lines = [cleaned for raw in matrix_lines if (cleaned := _strip_yaml_comment(raw)).strip()]
    if not lines:
        return []
    matrix_indent = min(len(line) - len(line.lstrip()) for line in lines)
    axes = {}
    special = {"include": [], "exclude": []}
    axis, row = None, None
    for line in lines:
        item = line.strip()
        indent = len(line) - len(line.lstrip())
        if indent == matrix_indent and not item.startswith("-"):
            axis, sep, value = item.partition(":")
            if not sep or not re.fullmatch(r"\w+", axis):
                raise ValueError(f"unsupported matrix entry {item!r}")
            row = None
            value = value.strip()
            if axis in special:
                if value not in ("", "[]"):
                    raise ValueError(f"matrix {axis} needs a block sequence")
            elif value.startswith("[") and value.endswith("]"):
                axes[axis] = [_unquote(part) for part in _split_unquoted(value[1:-1], ",") if part.strip()]
            elif not value:
                axes[axis] = []
            else:
                raise ValueError(f"matrix axis {axis!r} needs a literal list")
            continue
        if axis in special:
            if item.startswith("-"):
                row = {}
                special[axis].append(row)
                item = item[1:].strip()
            if row is None:
                raise ValueError(f"matrix {axis} needs an object")
            if item.startswith("{") and item.endswith("}"):
                pairs = _split_unquoted(item[1:-1], ",")
            else:
                pairs = [item] if item else []
            for pair in pairs:
                key, sep, value = pair.partition(":")
                if not sep or not value.strip():
                    raise ValueError(f"invalid matrix {axis} pair {pair!r}")
                row[key.strip()] = _unquote(value)
        elif axis in axes and item.startswith("-"):
            axes[axis].append(_unquote(item[1:]))
        else:
            raise ValueError(f"unsupported matrix entry {item!r}")

    def matches(row, constraints):
        return all(row.get(key) == value for key, value in constraints.items())

    base = []
    if axes:
        for values in product(*axes.values()):
            row = dict(zip(axes, values))
            if not any(matches(row, excluded) for excluded in special["exclude"]):
                base.append(row)
    expanded = [dict(row) for row in base]
    for additions in special["include"]:
        targets = [
            index
            for index, row in enumerate(base)
            if all(key not in row or row[key] == value for key, value in additions.items())
        ]
        if not targets:
            expanded.append(additions)
        for index in targets:
            expanded[index].update(additions)
    return expanded


def _job_leg_template(job_lines: list[str], child_indent: int) -> str | None:
    env_lines = _extract_subblock(job_lines[1:], "env", parent_indent=child_indent)
    for raw in env_lines:
        cleaned = _strip_yaml_comment(raw).strip()
        match = re.match(r"^LEG\s*:\s*(.+)$", cleaned)
        if match:
            return _unquote(match.group(1))
    return None


def expected_legs(workflow: Path = WORKFLOW) -> list[str]:
    """Every leg's artifact name: each `LEG:` template expanded over its job's matrix."""
    text = workflow.read_text(encoding="utf-8-sig")
    legs: list[str] = []
    for block in _job_blocks(text):
        child_indent = None
        for raw in block[1:]:
            stripped = _strip_yaml_comment(raw).strip()
            if stripped:
                child_indent = len(raw) - len(raw.lstrip(" "))
                break
        if child_indent is None:
            continue
        template = _job_leg_template(block, child_indent)
        if not template:
            continue
        strategy_lines = _extract_subblock(block[1:], "strategy", parent_indent=child_indent)
        matrix_lines = _extract_subblock(strategy_lines, "matrix")
        refs = set(MATRIX_REF.findall(template))
        if not refs:
            legs.append(template)
            continue
        if not matrix_lines:
            raise ValueError(f"LEG {template!r} references a missing matrix")
        for row in _matrix_values(matrix_lines):
            missing = refs - row.keys()
            if missing:
                raise ValueError(f"LEG {template!r} references missing matrix keys: {', '.join(sorted(missing))}")
            legs.append(MATRIX_REF.sub(lambda match: row[match[1]], template))
    return list(dict.fromkeys(legs))


def artifact_runs(data: dict) -> list[dict]:
    if not isinstance(data, dict):
        raise ValueError("expected a report object")
    runs = data.get("runs", [data])
    if not isinstance(runs, list) or not runs:
        raise ValueError("expected a nonempty runs array")
    if "schema" in data and (type(data["schema"]) is not int or data["schema"] != 1):
        raise ValueError(f"unsupported soak schema {data['schema']!r}")
    if "failed" in data and type(data["failed"]) is not bool:
        raise ValueError("expected a boolean soak failure status")
    skipped = data.get("skipped", [])
    if not isinstance(skipped, list) or any(not isinstance(key, str) or not key.strip() for key in skipped):
        raise ValueError("expected a skipped configuration ID array")
    if len(skipped) != len(set(skipped)):
        raise ValueError("duplicate skipped configuration ID")
    configurations = set()
    for run in runs:
        if not isinstance(run, dict):
            raise ValueError("expected run objects")
        if "id" in run:
            name = run["id"]
            if not isinstance(name, str) or not name.strip():
                raise ValueError("expected a configuration ID")
            if name in configurations:
                raise ValueError(f"duplicate configuration ID {name!r}")
            configurations.add(name)
        if "harness_error" in run and (not isinstance(run["harness_error"], str) or not run["harness_error"].strip()):
            raise ValueError("expected a nonblank harness error")
        if (
            "stopped" in run
            and run["stopped"] is not None
            and (not isinstance(run["stopped"], str) or not run["stopped"].strip())
        ):
            raise ValueError("expected a nonblank stop reason")
        if (
            "results" not in run
            and not (run.get("harness_error") or run.get("stopped"))
            and not CATEGORIES.keys() & run.keys()
        ):
            raise ValueError("expected route results, failure lists or a harness error")
        results = run.get("results", [])
        if not isinstance(results, list):
            raise ValueError("expected a route results array")
        if (
            not results
            and not (run.get("harness_error") or run.get("stopped"))
            and not any(run.get(key) for key in CATEGORIES)
        ):
            raise ValueError("expected at least one route, classified failure or harness error")
        ids = set()
        for route in results:
            if not isinstance(route, dict) or not isinstance(route.get("id"), str) or not route["id"].strip():
                raise ValueError("expected a route result with an ID")
            if route["id"] in ids:
                raise ValueError(f"duplicate route ID {route['id']!r}")
            ids.add(route["id"])
            if "pass" in route and type(route["pass"]) is not bool:
                raise ValueError(f"{route['id']}: expected a boolean verdict")
            failure_labels(route)
            if "arrived" in route and type(route["arrived"]) is not bool:
                raise ValueError(f"{route['id']}: expected a boolean arrival")
            for field in ("deadlocks", "collisions"):
                count = route.get(field)
                if count is not None and (type(count) is not int or count < 0):
                    raise ValueError(f"{route['id']}: {field} must be a nonnegative integer")
            error = route.get("simulation_error")
            if error is not None and (not isinstance(error, str) or not error.strip()):
                raise ValueError(f"{route['id']}: expected a nonblank simulation error")
    overlap = configurations.intersection(skipped)
    if overlap:
        raise ValueError(f"run and skipped configurations overlap: {', '.join(sorted(overlap))}")
    return runs


def failure_labels(route: dict) -> list[str]:
    labels = route.get("failures", [])
    if not isinstance(labels, list) or any(not isinstance(label, str) or not label.strip() for label in labels):
        raise ValueError("expected an array of failure labels")
    return list(dict.fromkeys(labels))


def classified_routes(run: dict, key: str) -> dict[str, list[str]]:
    routes = run.get(key, [])
    if routes is None:
        return {}
    if not isinstance(routes, list):
        raise ValueError(f"expected an array for {key}")
    result = {}
    for route in routes:
        rid = route.get("id") if isinstance(route, dict) else route
        if not isinstance(rid, str) or not rid.strip():
            raise ValueError(f"{key}: expected a route ID")
        reasons = failure_labels(route) if isinstance(route, dict) else []
        result.setdefault(rid, []).extend(reasons or [CATEGORIES[key]])
    return result


def leg_failures(data: dict) -> tuple[int, list[str]]:
    """The number of routes a leg drove, and one line per failed route or harness error."""
    # soak.json has a run per map and seed (or a harness error); run.json is a single run.
    total, failed = 0, []
    runs = artifact_runs(data)
    for run in runs:
        is_soak = "runs" in data or "schema" in data or bool(CATEGORIES.keys() & run.keys())
        prefix = f"{run['id']} " if "id" in run else ""
        if run.get("harness_error"):
            failed.append(f"{prefix}harness error: {run['harness_error']}")
        if run.get("stopped"):
            failed.append(f"{prefix}stopped: {run['stopped']}")
        failing = {}
        for r in run.get("results", []):
            total += 1
            labels = failure_labels(r)
            labels.extend(label for label in inferred_labels(r) if label not in labels)
            if not r.get("pass", False) or (is_soak and labels):
                failing[r["id"]] = labels
        for key in CATEGORIES:
            for rid, labels in classified_routes(run, key).items():
                existing = failing.setdefault(rid, [])
                if key == "stuck" and "timeout" in existing:
                    continue
                existing.extend(label for label in labels if label not in existing)
        failed += [f"{prefix}{rid}: {', '.join(dict.fromkeys(why)) or 'failed'}" for rid, why in failing.items()]
    if skipped := data.get("skipped"):
        failed.append(f"skipped configurations ({len(skipped)}): {', '.join(skipped)}")
    if data.get("failed") and not failed:
        failed.append("harness marked the leg failed without route details")
    return total, failed


def inferred_labels(route: dict) -> list[str]:
    labels = failure_labels(route)
    inferred = []
    if route.get("simulation_error"):
        inferred.append("simulation error")
    if route.get("collisions"):
        inferred.append("collision")
    if (
        route.get("deadlocks") or (route.get("arrived") is False and "simulation error" not in labels + inferred)
    ) and "timeout" not in labels:
        inferred.append("stuck")
    return inferred


def leg_categories(data: dict) -> dict[str, int]:
    """Count throws, stuck routes, collisions, and audit failures for a leg."""
    counts = dict.fromkeys(CATEGORIES, 0)
    for run in artifact_runs(data):
        affected = {key: set(classified_routes(run, key)) for key in CATEGORIES}
        for r in run.get("results", []):
            labels = set(failure_labels(r))
            if r.get("simulation_error") or "simulation error" in labels:
                affected["throws"].add(r["id"])
            if (r.get("deadlocks") or 0) > 0 or (
                ("stuck" in labels or "timeout" in labels or r.get("arrived") is False)
                and r["id"] not in affected["throws"]
            ):
                affected["stuck"].add(r["id"])
            if (r.get("collisions") or 0) > 0 or "collision" in labels:
                affected["collisions"].add(r["id"])
            if labels - NON_AUDITS:
                affected["audits"].add(r["id"])
        for key, ids in affected.items():
            counts[key] += len(ids)
    return counts


def leg_dirs(root: Path) -> dict[str, list[Path]]:
    """Each downloaded leg's directory by name (its leg.txt, else the directory's name)."""
    if not root.is_dir():
        return {}
    dirs = sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith("."))
    if any((root / name).is_file() for name in ("leg.txt", *REPORT_FILES)):
        dirs.insert(0, root)
    named = {}
    for d in dirs:
        label = d / "leg.txt"
        try:
            name = label.read_text(encoding="utf-8-sig").strip() if label.is_file() else d.name
        except (OSError, UnicodeError) as err:
            print(f"::warning title=City soak::{_single_line(f'{d.name}: unreadable leg.txt: {err}')}")
            name = d.name
        named.setdefault(name or d.name, []).append(d)
    return named


def escape(text: str) -> str:
    return (
        html.escape(text, quote=False)
        .replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\r\n", "<br>")
        .replace("\n", "<br>")
        .replace("\r", "<br>")
    )


def _single_line(text: str) -> str:
    return text.replace("%", "%25").replace("\r\n", " ").replace("\n", " ").replace("\r", " ")


def main(root: Path, *, workflow=None) -> int:
    try:
        found = leg_dirs(root)
    except OSError as err:
        found = {}
        print(f"::warning title=City soak::{_single_line(f'could not list artifacts: {err}')}")
    try:
        expected = expected_legs() if workflow is None else expected_legs(workflow)
    except (OSError, ValueError) as err:
        expected = []
        print(f"::warning title=City soak::{_single_line(f'could not read the expected legs: {err}')}")
    rows, warnings = [], []
    totals = {"throws": 0, "stuck": 0, "collisions": 0, "audits": 0}
    coverage = Counter()
    for name in expected + sorted(set(found) - set(expected)):
        candidates = found.get(name, [])
        if len(candidates) > 1:
            detail = f"multiple artifacts claim this leg ({', '.join(p.name for p in candidates)})"
            warnings.append(f"{name}: {detail}")
            rows.append((name, "-", escape(detail)))
            coverage["unreadable"] += 1
            continue
        leg = candidates[0] if candidates else None
        reports = [f for f in REPORT_FILES if leg and (leg / f).is_file()]
        if len(reports) > 1:
            detail = f"multiple report files in one artifact ({', '.join(reports)})"
            warnings.append(f"{name}: {detail}")
            rows.append((name, "-", escape(detail)))
            coverage["unreadable"] += 1
            continue
        if not reports:
            coverage["missing"] += 1
            rows.append((name, "-", NO_RESULT))
            warnings.append(f"{name}: {NO_RESULT}")
            continue
        result = reports[0]
        try:
            opener = gzip.open if result.endswith(".gz") else open
            with opener(leg / result, "rt", encoding="utf-8-sig") as stream:
                payload = json.load(stream)
            total, failed = leg_failures(payload)
            counts = leg_categories(payload)
        except (OSError, ValueError, EOFError, DeflateError) as err:
            coverage["unreadable"] += 1
            rows.append((name, "-", escape(f"unreadable {result}: {err}")))
            warnings.append(f"{name}: unreadable {result}: {err}")
            continue
        for key in totals:
            totals[key] += counts[key]
        coverage["readable"] += 1
        coverage["routes"] += total
        rows.append((name, str(total), "<br>".join(map(escape, failed)) if failed else "passed"))
        warnings += [f"{name}: {line}" for line in failed]

    out = ["## City soak", ""]
    if not rows:
        out.append("No legs expected and none uploaded a result.")
        warnings.append("No legs expected and none uploaded a result.")
    else:
        bad = sum(1 for _, _, status in rows if status != "passed")
        out += [
            f"{bad} of {len(rows)} legs had failures (report-only: the run stays green).",
            f"Artifact coverage: {coverage['readable']} readable, {coverage['missing']} missing, "
            f"{coverage['unreadable']} unreadable, {coverage['routes']} routes.",
            f"Failure categories: throws={totals['throws']}, stuck={totals['stuck']}, "
            f"collisions={totals['collisions']}, audit failures={totals['audits']}.",
            "",
            "| Leg | Routes | Failures |",
            "|---|---|---|",
        ]
        out += [f"| {escape(name)} | {total} | {status} |" for name, total, status in rows]
    text = "\n".join(out) + "\n"

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        try:
            with open(summary, "a", encoding="utf-8") as fh:
                fh.write(text)
        except OSError as err:
            sys.stdout.write(text)
            warnings.append(f"could not write step summary: {err}")
    else:
        sys.stdout.write(text)
    for line in warnings:
        print(f"::warning title=City soak::{_single_line(line)}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifacts", type=Path, help="directory of downloaded soak artifacts")
    parser.add_argument("--workflow", type=Path, help="derive expected legs from another workflow file")
    args = parser.parse_args()
    try:
        main(args.artifacts, workflow=args.workflow)
    except Exception as err:  # report-only: a broken summary must not turn the soak red
        print(f"::warning title=City soak::{_single_line(f'the summary failed: {err!r}')}")
