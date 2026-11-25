"""Router input errors and geometry cases outside the seeded suites."""

import math
import unittest
from copy import deepcopy
from unittest.mock import patch

from test_parity import pack_of

from jev import geometry as g
from jev.routing import Router, _blend, _cells_of_polyline, _round_corner, _slice


def sample_pack():
    pack = pack_of({"first": [(0, 0), (30, 0)], "next": [(30, 0), (60, 0)]})
    for edge in pack["edges"]:
        edge["limit"] = 10
    return pack


class GeometryInputs(unittest.TestCase):
    def test_invalid_geometry(self):
        for label, fn, args in [
            ("angle", g.wrap_angle, (math.inf,)),
            ("turn angle", g.classify_turn, (math.nan,)),
            ("point interpolation requires", g.point_at, ([], 0)),
            ("point interpolation distance", g.point_at, ([(0, 0), (1, 0)], math.nan)),
            ("heading interpolation requires", g.heading_at, ([], 1)),
            ("heading interpolation distance", g.heading_at, ([(0, 0), (1, 0)], math.nan)),
            ("projection requires", g.project_point, ([], (0, 0))),
            ("projection coordinates", g.project_point, ([(0, 0), (1, 0)], (math.inf, 0))),
            ("simplification tolerance", g.douglas_peucker, ([(0, 0), (1, 0)], -1)),
            ("polyline offset", g.offset_polyline, ([(0, 0), (1, 0)], math.nan)),
            ("fillet radius", g.fillet, ((0, 0), (1, 0), (1, 1), -1)),
            ("fillet steps", g.fillet, ((0, 0), (1, 0), (1, 1), 1, 0)),
            ("resampling step must", g.resample, ([(0, 0), (1, 0)], 0)),
            ("finite polyline length", g.resample, ([(0, 0), (math.inf, 0)], 1)),
            ("step is too small", g.resample, ([(0, 0), (1, 0)], 1e-25)),
            ("deduplication tolerance", g.dedupe_consecutive, ([(0, 0), (1, 0)], math.nan)),
            ("arc lengths must match", g.point_at, ([(0, 0), (1, 0)], 0.5, [0, 1, 2])),
            ("arc lengths must match", g.heading_at, ([(0, 0), (1, 0)], 0.5, [0, 1, 2])),
            ("arc lengths must match", g.project_point, ([(0, 0), (1, 0)], (0, 0), [0, 1, 2])),
            ("too long to index", _cells_of_polyline, ([(0, 0), (1e20, 1e20)],)),
        ]:
            with self.subTest(helper=fn.__name__, args=args), self.assertRaisesRegex(ValueError, label):
                fn(*args)

    def test_wrapping_large_finite_angles(self):
        big = 1e18
        for angle in (-big, big):
            with self.subTest(angle=angle):
                wrapped = g.wrap_angle(angle)
                self.assertGreater(wrapped, -math.pi)
                self.assertLessEqual(wrapped, math.pi)
                self.assertAlmostEqual(wrapped, math.remainder(angle, math.tau))
        self.assertEqual(g.wrap_angle(-math.pi), math.pi)

    def test_singleton_heading_and_projection(self):
        point = (5, 8)
        self.assertEqual(g.heading_at([point], 40), 0)
        self.assertEqual(
            g.project_point([point], (2, 4)),
            {
                "distance": 5,
                "s": 0,
                "lateral": 0,
                "index": 0,
                "point": point,
                "heading": 0,
            },
        )

    def test_polyline_geometry_contracts(self):
        self.assertEqual(g.heading_at([(0, 0), (1, 0), (1, 2)], 1), math.pi / 2)
        self.assertEqual(g.heading_at([(0, 0), (0, 2), (1, 2)], -2), math.pi / 2)
        self.assertEqual(g.point_at([(0, 0), (0, 0), (2, 0)], 1), (1, 0))
        self.assertEqual(g.point_at([(7, 3), (7, 3)], math.inf), (7, 3))
        self.assertEqual(g.resample([(0, 0), (3, 0)], 1), [(0, 0), (1, 0), (2, 0), (3, 0)])
        self.assertEqual(g.resample([(2, 2), (2, 2)], 1), [(2, 2)])
        self.assertEqual(g.resample([(0, 0), (1, 0), (1, 1)], 1.5), [(0, 0), (1, 0.5), (1, 1)])
        self.assertEqual(g.resample([(0, 0), (1, 0)], 2), [(0, 0), (1, 0)])
        self.assertEqual(g.dedupe_consecutive([(0, 0), (1, 0), (0, 0)]), [(0, 0), (1, 0), (0, 0)])
        self.assertEqual(g.dedupe_consecutive([(0, 0), (0.25, 0), (0.5, 0)], 0.25), [(0, 0), (0.5, 0)])
        self.assertAlmostEqual(g.polygon_area([(0, 0), (4, 0), (4, 2), (0, 2), (0, 0)]), 8)
        self.assertAlmostEqual(g.polygon_area([(0, 2), (4, 2), (4, 0), (0, 0)]), -8)
        self.assertEqual(g.offset_polyline([(0, 0), (4, 0)], -2), [(0, 2), (4, 2)])
        self.assertEqual(g.offset_polyline([(0, 0), (4, 0), (0, 0)], 1)[1], (4, -1))
        self.assertLessEqual(g.dist((4, 0), g.offset_polyline([(0, 0), (4, 0), (0, 0.001)], 1)[1]), 2.001)
        self.assertEqual(g.douglas_peucker([(0, 0), (1, 1), (2, 0)], 1), [(0, 0), (2, 0)])
        self.assertEqual(g.douglas_peucker([(0, 0), (1, 0), (0, 0)], 0.5), [(0, 0), (1, 0), (0, 0)])
        curve = g.fillet((0, 0), (2, 0), (2, 6), 7, steps=2)
        self.assertEqual(curve, [(1, 0), (1.75, 0.75), (2, 3)])
        self.assertEqual(g.fillet((2, 0), (2, 0), (2, 6), 2, steps=1), [(2, 0), (2, 2)])
        self.assertEqual(g.fillet((0, 0), (2, 0), (2, 0), 2, steps=1), [(1, 0), (2, 0)])

    def test_projection_sign_and_ties(self):
        self.assertEqual(g.project_point([(0, 0), (10, 0)], (2, -3))["lateral"], 3)
        self.assertEqual(g.project_point([(0, 0), (10, 0)], (2, 3))["lateral"], -3)
        ahead = g.project_point([(0, 0), (10, 0)], (12, 3))
        self.assertEqual((ahead["point"], ahead["s"], ahead["distance"]), ((10, 0), 10, math.sqrt(13)))
        corner = g.project_point([(0, 0), (2, 0), (2, 2)], (2, 0))
        self.assertEqual((corner["index"], corner["heading"]), (0, 0))

    def test_join_and_slice_boundaries(self):
        pts = [(0, 0), (2, 0), (2, 0), (4, 0), (6, 0)]
        cum = g.cumulative_s(pts)
        self.assertEqual(_slice(pts, cum, 2, 4), [(2, 0), (4, 0)])
        self.assertEqual(_slice(pts, cum, 3, 2), [(3, 0)])
        self.assertEqual(_slice(pts, cum, 5, 10), [(5, 0), (6, 0)])
        self.assertEqual(_slice(pts, cum, -9, 1), [(0, 0), (1, 0)])
        self.assertIsNone(_round_corner([(0, 0), (0, 0)], [(0, 0), (0, 20)], 6))
        self.assertIsNone(_round_corner([(0, 0), (20, 0)], [(40, 0), (40, 10)], 6))
        blended = _blend([(0, 0), (2, 0)], [(2, 1), (4, 1)], 10)
        self.assertEqual(blended, [(0, 0), (1, 0), (3, 1), (4, 1)])


class RouterInputs(unittest.TestCase):
    def setUp(self):
        self.pack = sample_pack()
        self.router = Router(self.pack)
        self.start = {"x": 0, "y": 0}
        self.goal = {"x": 55, "y": 0}

    def test_bad_pack(self):
        for value, message in [(None, "pack must be an object"), ({}, "edges must be a list")]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, message):
                Router(value)
        for key, index, field, value, message in [
            ("edges", 0, "id", None, "id must be a nonempty id"),
            ("edges", 1, "id", "first", "duplicate edge id"),
            ("edges", 0, "from", [], "source must be a nonempty id"),
            ("edges", 0, "to", {}, "target must be a nonempty id"),
            ("edges", 0, "pts", [(0, 0)], "geometry must contain at least two"),
            ("edges", 0, "pts", [(0, 0), (1, 2, 3)], "points must be x, y pairs"),
            ("edges", 0, "pts", [(0, 0), (math.nan, 0)], "coordinate must be a finite number"),
            ("edges", 0, "pts", [(-1e308, 0), (1e308, 0)], "geometry length must be finite"),
            ("edges", 0, "length", -1, "length must be nonnegative"),
            ("edges", 0, "limit", math.inf, "speed limit must be a finite number"),
            ("edges", 0, "lanes", 0, "lane count must be a positive integer"),
            ("edges", 0, "name", 5, "name must be text"),
            ("lanes", 0, "edge", None, "edge must be a nonempty id"),
            ("lanes", 0, "edge", "gone", "references unknown edge"),
            ("lanes", 0, "idx", -1, "idx must be a nonnegative integer"),
            ("lanes", 0, "idx", 1, "is outside edge"),
            ("lanes", 0, "pts", [], "lane 0 geometry must contain at least two"),
            ("lanes", 0, "pts", [(0, 0), (math.inf, 0)], "lane 0 geometry coordinate must be a finite number"),
        ]:
            with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError, message):
                bad = deepcopy(self.pack)
                bad[key][index][field] = value
                Router(bad)
        for bad, message in [
            (dict(self.pack, edges=[None]), "must be a record"),
            (dict(self.pack, lanes=None), "lanes must be a list"),
            (dict(self.pack, lanes=[None]), "must be a record"),
            (dict(self.pack, lanes=self.pack["lanes"] * 2), "duplicate lane"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                Router(bad)

    def test_bad_restriction(self):
        rule = {"from": "first", "to": ["next"], "kind": "no_straight_on"}
        for value, message in [
            ({}, "restrictions must be a list"),
            ([None], "must be a record"),
            ([dict(rule, **{"from": []})], "from must be a nonempty id"),
            ([dict(rule, to="next")], "must contain edge ids"),
            ([dict(rule, kind="unexpected")], "kind must be an only_ or no_ restriction"),
        ]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, message):
                Router(dict(self.pack, restrictions={"restrictions": value}))

    def test_bad_route_request(self):
        for start, goal, kwargs, message in [
            ([], self.goal, {}, "from must be an object"),
            (self.start, None, {}, "to must be an object"),
            ({"y": 0}, self.goal, {}, r"from\.x"),
            ({"x": 0, "y": True}, self.goal, {}, r"from\.y"),
            (self.start, {"x": math.inf, "y": 0}, {}, r"to\.x"),
            (self.start, {"x": 55, "y": 10**350}, {}, r"to\.y"),
            (dict(self.start, heading=math.inf), self.goal, {}, "snap heading"),
            (self.start, self.goal, {"k": True}, "route count"),
            (self.start, self.goal, {"restrictions": 1}, "restrictions must be a boolean"),
            (self.start, self.goal, {"hour": math.inf}, "hour must be a finite number"),
            (self.start, self.goal, {"weekday": 1.25}, "weekday must be an integer"),
            (self.start, self.goal, {"avoid": "first"}, "avoid must contain edge ids"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.router.routes(start, goal, **kwargs)

    def test_zero_count_and_absent_start_skip_searches(self):
        with patch.object(self.router, "snap", side_effect=AssertionError("unnecessary snap")):
            self.assertEqual(self.router.routes(self.start, self.goal, k=0), [])
        with patch.object(self.router, "snap_all", side_effect=AssertionError("unnecessary goal snap")):
            self.assertEqual(self.router.routes({"x": 1000, "y": 1000}, self.goal), [])

    def test_bad_snap(self):
        for fn, args, kwargs, message in [
            (self.router.snap, (math.nan, 0), {}, "snap x"),
            (self.router.snap, (0, "bad"), {}, "snap y"),
            (self.router.snap, (0, 0), {"max_m": -1}, "snap radius"),
            (self.router.snap, (0, 0), {"heading_tolerance": -1}, "heading tolerance"),
            (self.router.snap_all, (math.nan, 0), {}, "destination x"),
            (self.router.snap_all, (0, math.inf), {}, "destination y"),
            (self.router.snap_all, (0, 0), {"max_m": math.inf}, "destination snap radius"),
            (self.router.snap_all, (0, 0), {"slack_m": -0.5}, "destination snap slack"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                fn(*args, **kwargs)

    def test_bad_search(self):
        for args, kwargs, message in [
            (("gone", 0, "next", 25), {}, "unknown start edge"),
            (("first", 0, [], 25), {}, "unknown goal edge"),
            (("first", math.nan, "next", 25), {}, "start distance"),
            (("first", 0, "next", math.inf), {}, "goal distance"),
            (("first", 0, "next", 25), {"extra_cost": [1]}, "extra costs must map edge ids"),
            (("first", 0, "next", 25), {"extra_cost": {1: 2}}, "extra cost edge"),
            (("first", 0, "next", 25), {"extra_cost": {"next": -2}}, "extra cost for edge"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.router.astar(*args, **kwargs)

    def test_bad_route_geometry(self):
        for path, start, goal, message in [
            ([], {"s": 0}, {"s": 1}, "route path"),
            (["gone"], {"s": 0}, {"s": 1}, "unknown edge"),
            (["first"], None, {"s": 1}, "start snap must be an object"),
            (["first"], {}, {"s": 1}, "start snap distance"),
            (["first"], {"s": 0}, None, "goal snap must be an object"),
            (["first"], {"s": 0}, {"s": math.nan}, "goal snap distance"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.router.build_route(path, start, goal)
        self.router.lanes.clear()
        with self.assertRaisesRegex(ValueError, "is missing lane 0"):
            self.router.build_route(["first"], {"s": 0}, {"s": 1})

    def test_graph_lookup_contracts(self):
        self.assertEqual(self.router.successors("gone"), [])
        self.assertEqual(self.router.snap(0, 0, max_m=1e100)["edge"], "first")
        self.assertEqual(self.router.snap_all(0, 0, max_m=1e100, slack_m=100)[1]["edge"], "next")
        self.assertIsNone(self.router.snap(-1e100, 0, max_m=60))
        self.assertEqual(self.router.snap(30, 0, max_m=0)["distance"], 0)
        self.assertEqual(self.router.snap_all(29, 0, slack_m=1)[1]["edge"], "next")
        self.assertEqual(len(self.router.snap_all(29, 0, slack_m=0.9)), 1)
        self.assertIsNone(self.router.astar("first", 20, "first", 10))
        self.assertEqual(self.router.astar("first", 20, "first", 20), (["first"], 0))
        self.assertEqual(self.router.astar("first", 20, "next", 15), (["first", "next"], 2.5))
        self.assertEqual(self.router.astar("first", 20, "next", 15, avoid={"first"}), (["first", "next"], 2.5))
        self.assertIsNone(self.router.astar("first", 20, "next", 15, avoid={"next"}))
        self.assertNotIn("cum", self.pack["lanes"][0])
        self.assertNotIn("length", self.pack["lanes"][0])

    def test_distance_only_fallback_projects_each_lane_once(self):
        with patch("jev.routing.g.project_point", wraps=g.project_point) as projected:
            self.assertEqual(self.router.snap(0, 0, heading=math.pi)["edge"], "first")
            self.assertEqual(projected.call_count, 2)

    def test_absent_restriction_layer_does_not_rebuild(self):
        with patch.object(self.router, "_build_restriction_index") as rebuild:
            self.router.astar("first", 0, "next", 25, restrictions=True)
            rebuild.assert_not_called()


if __name__ == "__main__":
    unittest.main()
