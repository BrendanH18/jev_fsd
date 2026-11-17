#!/usr/bin/env python3
"""Summarise the weekly city soak (.github/workflows/soak.yml) from its downloaded artifacts.

    python3 scripts/soak_summary.py ARTIFACTS_DIR

ARTIFACTS_DIR holds one directory per leg, each with the leg's soak.json (scripts/soak.mjs) or
run.json (scripts/bench_node.mjs). The soak is report-only (ROADMAP.md 1.6/1.7), so this never
fails: it writes a table of every leg to $GITHUB_STEP_SUMMARY (stdout when unset) and prints a
`::warning` annotation for each failed route and each leg that left no result.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def leg_failures(data: dict) -> tuple[int, list[str]]:
    """The number of routes a leg drove, and one line per failed route."""
    # soak.json has a run per map and seed; run.json is a single run.
    runs = data["runs"] if "runs" in data else [data]
    total, failed = 0, []
    for run in runs:
        prefix = f"{run['id']} " if "id" in run else ""
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


def escape(text: str) -> str:
    return text.replace("|", "\\|")


def main(root: Path) -> int:
    rows, warnings = [], []
    for leg in sorted(p for p in root.iterdir() if p.is_dir()):
        files = [leg / "soak.json", leg / "run.json"]
        result = next((f for f in files if f.exists()), None)
        if result is None:
            rows.append((leg.name, "-", "no result (setup failed, timed out or was cancelled)"))
            warnings.append(f"{leg.name}: no result (setup failed, timed out or was cancelled)")
            continue
        try:
            total, failed = leg_failures(json.loads(result.read_text()))
        except (ValueError, KeyError, TypeError) as err:
            rows.append((leg.name, "-", f"unreadable {result.name}: {err}"))
            warnings.append(f"{leg.name}: unreadable {result.name}: {err}")
            continue
        rows.append((leg.name, str(total), "<br>".join(failed) if failed else "passed"))
        warnings += [f"{leg.name}: {line}" for line in failed]

    out = ["## City soak", ""]
    if not rows:
        out.append("No leg uploaded a result.")
        warnings.append("No leg uploaded a result.")
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
    sys.exit(main(Path(sys.argv[1])))
