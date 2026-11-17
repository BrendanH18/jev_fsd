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
import os
import re
import sys
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "soak.yml"
NO_RESULT = "no result (setup failed, timed out or was cancelled)"


def expected_legs(workflow: Path = WORKFLOW) -> list[str]:
    """Every leg's artifact name: each `LEG:` template expanded over its job's matrix."""
    text = workflow.read_text()
    shards = re.search(r"^\s+shard: \[([\d, ]+)\]", text, re.M)
    values = {
        "shard": [s.strip() for s in shards.group(1).split(",")] if shards else [],
        "label": [m.strip() for m in re.findall(r"\{ *label: *([^,}]+),", text)],
    }
    legs = []
    for template in re.findall(r"^\s+LEG: (.+?)\s*$", text, re.M):
        key = re.search(r"\$\{\{ *matrix\.(\w+) *\}\}", template)
        if key:
            legs += [template.replace(key.group(0), v) for v in values.get(key.group(1), [])]
    return legs


def leg_failures(data: dict) -> tuple[int, list[str]]:
    """The number of routes a leg drove, and one line per failed route or harness error."""
    # soak.json has a run per map and seed (or a harness error); run.json is a single run.
    runs = data["runs"] if "runs" in data else [data]
    total, failed = 0, []
    for run in runs:
        prefix = f"{run['id']} " if "id" in run else ""
        if run.get("harness_error"):
            failed.append(f"{prefix}harness error: {run['harness_error']}")
        failing = {}
        for r in run.get("results", []):
            total += 1
            if not r.get("pass", False):
                failing[r["id"]] = list(r.get("failures") or ["failed"])
        for key in ("throws", "stuck"):
            for rid in run.get(key) or []:
                rid = rid if isinstance(rid, str) else rid.get("id", "?")
                failing.setdefault(rid, [])
                if key.rstrip("s") not in failing[rid]:
                    failing[rid].append(key.rstrip("s"))
        failed += [f"{prefix}{rid}: {', '.join(why) or 'failed'}" for rid, why in failing.items()]
    return total, failed


def leg_dirs(root: Path) -> dict[str, Path]:
    """Each downloaded leg's directory by name (its leg.txt, else the directory's name)."""
    if not root.is_dir():
        return {}
    dirs = [p for p in root.iterdir() if p.is_dir()]
    if (root / "leg.txt").exists() or not dirs and any(root.iterdir()):
        dirs = [root]  # a lone artifact is extracted into root itself
    named = {}
    for d in dirs:
        label = d / "leg.txt"
        named[label.read_text().strip() if label.exists() else d.name] = d
    return named


def escape(text: str) -> str:
    return text.replace("|", "\\|")


def main(root: Path) -> int:
    found = leg_dirs(root)
    try:
        expected = expected_legs()
    except OSError as err:
        expected = []
        print(f"::warning title=City soak::could not read the expected legs: {err}")
    rows, warnings = [], []
    for name in expected + sorted(set(found) - set(expected)):
        leg = found.get(name)
        result = next((f for f in ("soak.json", "run.json") if leg and (leg / f).exists()), None)
        if result is None:
            rows.append((name, "-", NO_RESULT))
            warnings.append(f"{name}: {NO_RESULT}")
            continue
        try:
            total, failed = leg_failures(json.loads((leg / result).read_text()))
        except (ValueError, KeyError, TypeError, AttributeError) as err:
            rows.append((name, "-", f"unreadable {result}: {err}"))
            warnings.append(f"{name}: unreadable {result}: {err}")
            continue
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
        print(f"::warning title=City soak::{line}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    try:
        main(Path(sys.argv[1]))
    except Exception as err:  # report-only: a broken summary must not turn the soak red
        print(f"::warning title=City soak::the summary failed: {err!r}")
