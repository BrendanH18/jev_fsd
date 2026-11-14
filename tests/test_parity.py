"""The rules that exist in both Python and JavaScript give the same answers (ROADMAP 3.8).

tests/fixtures/parity_cases.json holds the cases. scripts/parity_js.mjs runs the browser code on
them (under Node); this test runs jev/routing.py on the same cases and compares:

- turns: the turn angle, the turn kind, and the sharp-turn rule (SHARP_TURN_DEG in jev/routing.py,
  SHARP_TURN in static/js/sim/npc.js and the 130 degree limit in static/js/demo/routing.js);
- joins: a route over two single-lane edges (Router.build_route against routeFromLanes), so the
  lane-join geometry (_round_corner / _blend against joinLanes) and the slicing and 1 m resampling
  around it. The two polylines must lie within the fixture's tolerance of each other and be as long.

A case marked "known_difference" must still disagree: fixing one side means updating the fixture.
Skipped when Node is not on PATH, unless JEV_REQUIRE_NODE is set (as in CI).
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import unittest
from pathlib import Path

import helpers  # noqa: F401  (sys.path)

from jev import geometry as g
from jev.routing import Router

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "tests/fixtures/parity_cases.json"


def _length(pts):
    return sum(g.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def pack_of(lines: dict) -> dict:
    """Single-lane one-way edges whose lane is the edge's own line, joined where their ends meet
    (as packOf in scripts/parity_js.mjs)."""
    nodes: dict = {}

    def node(p):
        return nodes.setdefault(tuple(p), f"n{len(nodes)}")

    edges = []
    for eid, pts in lines.items():
        pts = [tuple(p) for p in pts]
        edges.append({"id": eid, "from": node(pts[0]), "to": node(pts[-1]), "pts": pts, "lanes": 1,
                      "lane_offsets": [0], "length": _length(pts), "name": eid, "oneway": True})
    return {"edges": edges, "lanes": [{"edge": e["id"], "idx": 0, "pts": e["pts"]} for e in edges]}


def _to_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / seg2))
    return math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)


def _to_polyline(p, pts):
    return min(_to_segment(p, pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def hausdorff(a, b):
    """Furthest any point of either polyline lies from the other polyline."""
    return max(max(_to_polyline(p, b) for p in a), max(_to_polyline(p, a) for p in b))


def python_turn(case: dict) -> dict:
    end, prev = case["in"][-1], case["in"][-2]
    d = (end[0] - prev[0], end[1] - prev[1])
    n = math.hypot(*d)
    ahead = [end, [end[0] + d[0] / n * 50, end[1] + d[1] / n * 50]]
    router = Router(pack_of({"in": case["in"], "out": case["out"], "ahead": ahead}))
    angle = router.turn_angle("in", "out")
    # with another way on, a U-turn (or a turn sharp enough to count as one) is priced out of reach
    return {"turn_angle": angle, "kind": g.classify_turn(angle),
            "allowed": router.turn_penalty("in", "out") < 1e6}


def python_join(case: dict) -> list:
    router = Router(pack_of({"before": case["before"], "after": case["after"]}))
    goal = router.lanes[("after", 0)]["length"]
    return router.build_route(["before", "after"], {"s": 0.0}, {"s": goal})["polyline"]


def turn_differences(py: dict, js: dict) -> list:
    out = []
    if abs(py["turn_angle"] - js["turn_angle"]) > 1e-9:
        out.append(f"turn angle {py['turn_angle']} (Python) vs {js['turn_angle']} (JavaScript)")
    if py["kind"] != js["kind"]:
        out.append(f"turn kind {py['kind']} (Python) vs {js['kind']} (JavaScript)")
    for side in ("npc_allowed", "browser_allowed"):
        if py["allowed"] != js[side]:
            out.append(f"sharp-turn rule: Python allows it: {py['allowed']}, JavaScript {side}: {js[side]}")
    return out


def join_differences(py: list, js: list, tolerance: float) -> list:
    out = []
    gap = hausdorff(py, js)
    if gap > tolerance:
        out.append(f"polylines up to {gap:.3f} m apart (tolerance {tolerance} m)")
    lp, lj = _length(py), _length(js)
    if abs(lp - lj) > 2 * tolerance:
        out.append(f"lengths {lp:.2f} m (Python) vs {lj:.2f} m (JavaScript)")
    return out


def run_js(cases_path: Path) -> dict:
    proc = subprocess.run(
        ["node", "--experimental-default-type=module", str(ROOT / "scripts/parity_js.mjs"), str(cases_path)],
        cwd=ROOT, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"scripts/parity_js.mjs failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


@unittest.skipUnless(shutil.which("node") or os.environ.get("JEV_REQUIRE_NODE"),
                     "Node is not on PATH (set JEV_REQUIRE_NODE to make this a failure)")
class ParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads(CASES.read_text())
        cls.js = run_js(CASES)

    def check(self, kind, cases, js_results, differences):
        self.assertEqual([c["name"] for c in cases], [r["name"] for r in js_results])
        self.assertEqual(len({c["name"] for c in cases}), len(cases), "case names must be unique")
        for case, js in zip(cases, js_results):
            with self.subTest(kind=kind, case=case["name"]):
                found = differences(case, js)
                if case.get("known_difference"):
                    self.assertTrue(found, f"{case['name']!r} is marked as a known difference but now agrees: "
                                           "remove known_difference from tests/fixtures/parity_cases.json")
                else:
                    self.assertFalse(found, f"{case['name']!r}: " + "; ".join(found))

    def test_turn_angle_kind_and_sharp_turn_rule(self):
        self.check("turn", self.cases["turns"], self.js["turns"],
                   lambda c, js: turn_differences(python_turn(c), js))

    def test_lane_joins_route_the_same_way(self):
        tol = self.cases["tolerance_m"]
        self.check("join", self.cases["joins"], self.js["joins"],
                   lambda c, js: join_differences(python_join(c), js["polyline"], tol))

    def test_the_fixture_covers_both_sides_of_each_threshold(self):
        angles = [abs(c["angle_deg"]) for c in self.cases["turns"]]
        for threshold in (25, 130, 150):  # classify_turn's straight and U-turn limits, SHARP_TURN_DEG
            self.assertTrue(any(threshold - 0.2 < a < threshold for a in angles), threshold)
            self.assertTrue(any(threshold < a < threshold + 0.2 for a in angles), threshold)

    def test_the_comparison_catches_a_disagreement(self):
        # the same case with its outgoing lane moved 0.3 m: the check must notice
        case = next(c for c in self.cases["joins"] if not c.get("known_difference"))
        moved = dict(case, after=[[x, y - 0.3] for x, y in case["after"]])
        self.assertTrue(join_differences(python_join(moved), python_join(case), self.cases["tolerance_m"]))
        turn = next(c for c in self.cases["turns"] if 130 < abs(c["angle_deg"]) < 150)
        py = python_turn(turn)
        self.assertTrue(turn_differences(py, dict(npc_allowed=not py["allowed"], browser_allowed=py["allowed"],
                                                  turn_angle=py["turn_angle"], kind=py["kind"])))


if __name__ == "__main__":
    unittest.main()
