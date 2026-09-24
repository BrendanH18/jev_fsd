import math
import unittest

from helpers import grid_pack

from jev import geometry as g
from jev.routing import Router


class RouterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = grid_pack()
        cls.router = Router(cls.pack)

    def edge_named(self, name, forward=True):
        for e in self.pack["edges"]:
            if e["name"] == name:
                pts = e["pts"]
                heading_east_or_north = (pts[-1][0] > pts[0][0]) or (pts[-1][1] > pts[0][1])
                if heading_east_or_north == forward:
                    return e
        raise KeyError(name)

    def test_snap_prefers_matching_heading(self):
        # a point on Row 0 St (y = -180), between the first two vertices, heading east
        snap = self.router.snap(-120.0, -180.0, heading=0.0)
        e = self.router.edges[snap["edge"]]
        self.assertEqual(e["name"], "Row 0 St")
        self.assertGreater(e["pts"][-1][0], e["pts"][0][0])  # eastbound edge chosen
        west = self.router.snap(-120.0, -180.0, heading=math.pi)
        e2 = self.router.edges[west["edge"]]
        self.assertLess(e2["pts"][-1][0], e2["pts"][0][0])

    def test_route_never_backs_up_at_turns(self):
        # Lanes sit right of each street's centerline, so a naive end-to-start join at a right turn
        # makes the path step backwards. Every consecutive 1 m step must keep going forward.
        worst = 0.0
        for start, goal in [((-120.0, -180.0, 0.0), (60.0, 100.0)), ((-120.0, -180.0, 0.0), (-180.0, 100.0)),
                            ((60.0, 150.0, -math.pi / 2), (-150.0, -60.0)), ((-60.0, 60.0, 0.0), (60.0, -150.0))]:
            routes = self.router.routes({"x": start[0], "y": start[1], "heading": start[2]}, {"x": goal[0], "y": goal[1]})
            self.assertTrue(routes)
            pl = routes[0]["polyline"]
            self.assertTrue(any(t["dir"] in ("left", "right") for t in routes[0]["turns"]))
            for i in range(1, len(pl) - 1):
                h1 = math.atan2(pl[i][1] - pl[i - 1][1], pl[i][0] - pl[i - 1][0])
                h2 = math.atan2(pl[i + 1][1] - pl[i][1], pl[i + 1][0] - pl[i][0])
                worst = max(worst, abs(g.wrap_angle(h2 - h1)))
        self.assertLess(math.degrees(worst), 60)

    def test_route_reaches_goal_and_respects_oneway(self):
        # Oneway Ave runs north on the east column (x = 180). Start south-bound on the two-way column
        # next to it and ask for its south end: the only legal way in is from the south, heading north.
        routes = self.router.routes({"x": 60.0, "y": 150.0, "heading": -math.pi / 2}, {"x": 180.0, "y": -150.0})
        self.assertTrue(routes)
        r = routes[0]
        used = [self.router.edges[eid] for eid in r["edges"]]
        oneway = [e for e in used if e["name"] == "Oneway Ave"]
        self.assertTrue(oneway)
        for e in oneway:
            self.assertGreater(e["pts"][-1][1], e["pts"][0][1])  # every one-way edge traversed northbound
        self.assertGreater(r["length_m"], 400)
        self.assertAlmostEqual(r["polyline"][-1][0], 180.0, delta=3.0)
        self.assertAlmostEqual(r["polyline"][-1][1], -150.0, delta=3.0)

    def test_polyline_is_continuous(self):
        routes = self.router.routes({"x": -150.0, "y": -180.0, "heading": 0.0}, {"x": 60.0, "y": 180.0})
        r = routes[0]
        pts = r["polyline"]
        gaps = [g.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        self.assertLessEqual(max(gaps), 1.1)
        self.assertGreater(len(r["turns"]), 0)
        self.assertIn(r["turns"][0]["dir"], ("left", "right"))
        self.assertTrue(r["summary"].startswith("turn ") or r["summary"].startswith("make a U-turn"))

    def test_alternatives_are_distinct(self):
        routes = self.router.routes({"x": -150.0, "y": -180.0, "heading": 0.0}, {"x": 150.0, "y": 180.0}, k=3)
        self.assertGreaterEqual(len(routes), 2)
        self.assertEqual(routes[0]["id"], "current")
        self.assertEqual(routes[1]["id"], "alt_1")
        self.assertNotEqual(routes[0]["edges"], routes[1]["edges"])
        self.assertLessEqual(routes[0]["length_m"], routes[1]["length_m"] * 1.0 + 200)

    def test_same_edge_route(self):
        routes = self.router.routes({"x": -150.0, "y": -180.0, "heading": 0.0}, {"x": -80.0, "y": -180.0})
        self.assertEqual(len(routes[0]["edges"]), 1)
        self.assertAlmostEqual(routes[0]["length_m"], 70.0, delta=2.0)
        self.assertEqual(routes[0]["turns"], [])

    def test_uturn_only_at_dead_end(self):
        e = self.edge_named("Row 0 St")
        for nxt in self.router.successors(e["id"]):
            if self.router.turn(e["id"], nxt) == "uturn":
                self.assertGreaterEqual(self.router.turn_penalty(e["id"], nxt), 1e5)


if __name__ == "__main__":
    unittest.main()
