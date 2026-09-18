#!/usr/bin/env python3
"""Send saved decision snapshots to the live model and check expectations.

    uv run scripts/verify_jev.py                      # every data/snapshots/*.json
    uv run scripts/verify_jev.py data/snapshots/red_light.json

Each snapshot is {name, state, questions, expect?}. `expect` may contain:
    {"motion": "stop", "motion_min_p": 0.7, "vector_in": ["keep_lane_hold", "keep_lane_limit"], "vector_not_in": [...]}
Needs TYPESAFE_API_KEY in .env or the environment. Prints choices, top probabilities, latency, tokens, cost.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev.client import JevClient, JevError, ranked  # noqa: E402
from jev.config import SNAPSHOTS_DIR  # noqa: E402


def check(expect: dict, answers: dict) -> list:
    problems = []
    if "motion" in expect:
        a = answers.get("motion")
        if not a:
            problems.append("motion was not asked")
        else:
            p = a["probabilities"].get(expect["motion"], 0.0)
            if a["choice"] != expect["motion"]:
                problems.append("motion=%s (wanted %s, p=%.2f)" % (a["choice"], expect["motion"], p))
            elif p < expect.get("motion_min_p", 0.0):
                problems.append("motion p=%.2f below %.2f" % (p, expect["motion_min_p"]))
    if "motion_absent" in expect and "motion" in answers:
        problems.append("motion was asked but should have been resolved locally")
    v = answers.get("vector")
    if "vector_in" in expect and (not v or v["choice"] not in expect["vector_in"]):
        problems.append("vector=%s not in %s" % (v and v["choice"], expect["vector_in"]))
    if "vector_not_in" in expect and v and v["choice"] in expect["vector_not_in"]:
        problems.append("vector=%s should not be in %s" % (v["choice"], expect["vector_not_in"]))
    return problems


def main(argv: list) -> int:
    paths = [Path(p) for p in argv[1:]] or sorted(SNAPSHOTS_DIR.glob("*.json"))
    if not paths:
        print("No snapshots. Save some from the app's JSON panel first.")
        return 1
    client = JevClient()
    if not client.configured:
        print("No TYPESAFE_API_KEY configured.")
        return 1
    failures = 0
    total_cost = 0.0
    for path in paths:
        snap = json.loads(path.read_text())
        try:
            result = client.system_one(snap["state"], snap["questions"])
        except JevError as err:
            print("%-28s ERROR %s" % (path.name, err))
            failures += 1
            continue
        meta = result.meta()
        total_cost += meta["cost_usd"]
        parts = []
        for qid, a in result.answers.items():
            top = ", ".join("%s %.0f%%" % (r["value"], r["prob"] * 100) for r in ranked(a, 3))
            parts.append("%s: %s [%s]" % (qid, a.get("choice"), top))
        problems = check(snap.get("expect") or {}, result.answers)
        status = "PASS" if not problems else "FAIL"
        if problems:
            failures += 1
        print("%-28s %s  %4.0f ms  %5d tok  $%.6f" % (path.name, status, meta["latency_ms"], meta["input_tokens"], meta["cost_usd"]))
        for p in parts:
            print("    " + p)
        for p in problems:
            print("    ! " + p)
    print("\n%d snapshot(s), %d failure(s), total cost $%.5f, model %s" % (len(paths), failures, total_cost, result.model if paths else "?"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
