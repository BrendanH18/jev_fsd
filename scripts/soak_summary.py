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

import json
from collections import Counter
import os
import re
import sys
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "soak.yml"
NO_RESULT = "no result (setup failed, timed out or was cancelled)"
NON_AUDITS = {"simulation error", "stuck", "timeout", "collision"}
CATEGORIES = {"throws": "simulation error", "stuck": "stuck", "collisions": "collision", "audits": "audit failure"}


def _strip_yaml_comment(line: str) -> str:
    in_single = False
    in_double = False
    for idx, ch in enumerate(line):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double and (idx == 0 or line[idx - 1].isspace()):
            return line[:idx].rstrip()
    return line.rstrip()


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
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


def _matrix_values(matrix_lines: list[str]) -> dict[str, list[str]]:
    values: dict[str, list[str]] = {}
    in_include = False
    include_indent = -1
    for raw in matrix_lines:
        line = _strip_yaml_comment(raw)
        stripped = line.strip()
        if not stripped:
            continue
        indent = len(line) - len(line.lstrip(" "))
        if in_include and indent <= include_indent and not stripped.startswith("-"):
            in_include = False
        if stripped == "include:":
            in_include = True
            include_indent = indent
            continue
        if in_include:
            inline_map = re.match(r"^-\s*\{(.+)\}\s*$", stripped)
            if inline_map:
                for pair in inline_map.group(1).split(","):
                    if ":" in pair:
                        key, val = pair.split(":", 1)
                        values.setdefault(key.strip(), []).append(_unquote(val))
                continue
            kv = re.match(r"^(?:-\s+)?([A-Za-z_]\w*)\s*:\s*(.+)$", stripped)
            if kv:
                values.setdefault(kv.group(1), []).append(_unquote(kv.group(2)))
            continue
        inline_list = re.match(r"^([A-Za-z_]\w*)\s*:\s*\[([^\]]*)\]\s*$", stripped)
        if inline_list:
            values[inline_list.group(1)] = [_unquote(item) for item in inline_list.group(2).split(",") if item.strip()]
    return values


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
    text = workflow.read_text()
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
        values = _matrix_values(matrix_lines)
        key = re.search(r"\$\{\{\s*matrix\.(\w+)\s*\}\}", template)
        if key:
            legs += [template.replace(key.group(0), v) for v in values.get(key.group(1), [])]
        else:
            legs.append(template)
    return list(dict.fromkeys(legs))


def artifact_runs(data: dict) -> list[dict]:
    if not isinstance(data, dict):
        raise ValueError("expected a report object")
    runs = data.get("runs", [data])
    if not isinstance(runs, list) or not runs:
        raise ValueError("expected a nonempty runs array")
    for run in runs:
        if not isinstance(run, dict):
            raise ValueError("expected run objects")
        if "results" not in run and not run.get("harness_error") and not CATEGORIES.keys() & run.keys():
            raise ValueError("expected route results, failure lists or a harness error")
        results = run.get("results", [])
        if not isinstance(results, list):
            raise ValueError("expected a route results array")
        if not results and not run.get("harness_error") and not any(run.get(key) for key in CATEGORIES):
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
    for run in artifact_runs(data):
        prefix = f"{run['id']} " if "id" in run else ""
        if run.get("harness_error"):
            failed.append(f"{prefix}harness error: {run['harness_error']}")
        failing = {}
        for r in run.get("results", []):
            total += 1
            labels = failure_labels(r)
            if not r.get("pass", False) or labels:
                failing[r["id"]] = labels
        for key in CATEGORIES:
            for rid, labels in classified_routes(run, key).items():
                existing = failing.setdefault(rid, [])
                if key == "stuck" and "timeout" in existing:
                    continue
                existing.extend(label for label in labels if label not in existing)
        failed += [f"{prefix}{rid}: {', '.join(dict.fromkeys(why)) or 'failed'}" for rid, why in failing.items()]
    return total, failed


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
    dirs = sorted(p for p in root.iterdir() if p.is_dir())
    if any((root / name).is_file() for name in ("leg.txt", "soak.json", "run.json")):
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
    return text.replace("|", "\\|").replace("\r\n", "<br>").replace("\n", "<br>").replace("\r", "<br>")


def _single_line(text: str) -> str:
    return text.replace("%", "%25").replace("\r\n", " ").replace("\n", " ").replace("\r", " ")


def main(root: Path) -> int:
    found = leg_dirs(root)
    try:
        expected = expected_legs()
    except OSError as err:
        expected = []
        print(f"::warning title=City soak::could not read the expected legs: {err}")
    rows, warnings = [], []
    totals = {"throws": 0, "stuck": 0, "collisions": 0, "audits": 0}
    coverage = Counter()
    for name in expected + sorted(set(found) - set(expected)):
        candidates = found.get(name, [])
        if len(candidates) > 1:
            detail = f"multiple artifacts claim this leg ({', '.join(p.name for p in candidates)})"
            warnings.append(f"{name}: {detail}")
            rows.append((name, "-", detail))
            coverage["unreadable"] += 1
            continue
        leg = candidates[0] if candidates else None
        result = next((f for f in ("soak.json", "run.json") if leg and (leg / f).is_file()), None)
        if result is None:
            coverage["missing"] += 1
            rows.append((name, "-", NO_RESULT))
            warnings.append(f"{name}: {NO_RESULT}")
            continue
        try:
            payload = json.loads((leg / result).read_text(encoding="utf-8-sig"))
            total, failed = leg_failures(payload)
            counts = leg_categories(payload)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as err:
            coverage["unreadable"] += 1
            rows.append((name, "-", f"unreadable {result}: {err}"))
            warnings.append(f"{name}: unreadable {result}: {err}")
            continue
        for key in totals:
            totals[key] += counts[key]
        coverage["readable"] += 1
        coverage["routes"] += total
        rows.append((name, str(total), "<br>".join(failed) if failed else "passed"))
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
        out += [f"| {escape(name)} | {total} | {escape(status)} |" for name, total, status in rows]
    text = "\n".join(out) + "\n"

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)
    for line in warnings:
        print(f"::warning title=City soak::{_single_line(line)}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    try:
        main(Path(sys.argv[1]))
    except Exception as err:  # report-only: a broken summary must not turn the soak red
        print(f"::warning title=City soak::the summary failed: {err!r}")
