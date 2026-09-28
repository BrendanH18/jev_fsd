"""Parking lanes, bike routes, roundabouts (ring geometry, yield lines, route instructions), and
sharp-turn avoidance in the router."""

import math
import unittest

import helpers  # noqa: F401  (fixes sys.path)

from jev.osm.graph import PARKING_LANE_M, is_bike_route, parking_sides
from jev.osm.pack import pack_from_osm
from jev.osm.parse import OsmData
from jev.osm.project import Projection
from jev.routing import Router


def roundabout_osm(ring_r=3.5, arm=80.0):
    """A small traffic circle (ring radius `ring_r`) with four two-way residential arms."""
    proj = Projection(49.0, -123.0)
    osm = OsmData()
    ring = []
    n = 12
    for k in range(n):
        a = 2 * math.pi * k / n  # counter-clockwise
        lat, lon = proj.to_latlon(ring_r * math.cos(a), ring_r * math.sin(a))
        osm.add_node(100 + k, lat, lon)
        ring.append(100 + k)
    osm.add_way(1, ring + [ring[0]], {"highway": "residential", "junction": "roundabout"})
    for i, k in enumerate((0, 3, 6, 9)):
        a = 2 * math.pi * k / n
        lat, lon = proj.to_latlon(arm * math.cos(a), arm * math.sin(a))
        osm.add_node(200 + i, lat, lon)
        osm.add_way(10 + i, [200 + i, 100 + k], {"highway": "residential", "name": "Arm %d" % i})
    s, w = proj.to_latlon(-arm - 20, -arm - 20)
    nn, e = proj.to_latlon(arm + 20, arm + 20)
    return osm, (w, s, e, nn)


class ParkingTests(unittest.TestCase):
    def test_defaults_and_tags(self):
        self.assertEqual(parking_sides({}, "residential", False), (PARKING_LANE_M, PARKING_LANE_M))
        self.assertEqual(parking_sides({}, "secondary", False), (0.0, 0.0))
        self.assertEqual(parking_sides({}, "residential", True), (0.0, 0.0))  # one-way: none unless tagged
        self.assertEqual(parking_sides({"parking:both": "no"}, "residential", False), (0.0, 0.0))
        self.assertEqual(parking_sides({"parking:right": "lane", "parking:left": "no"}, "tertiary", False), (0.0, PARKING_LANE_M))
        self.assertEqual(parking_sides({"parking:both": "lane", "parking:both:orientation": "perpendicular"}, "residential", False), (0.0, 0.0))

    def test_asphalt_includes_parking(self):
        pack = helpers.grid_pack()
        for e in pack["edges"]:
            left, right = e["parking"]
            self.assertAlmostEqual(e["asphalt"][1], e["width"] / 2 + right, places=1)
            self.assertAlmostEqual(e["asphalt"][0], -e["width"] / 2 - left, places=1)
        residential = [e for e in pack["edges"] if e["cls"] == "residential" and not e["oneway"]]
        self.assertTrue(residential and all(e["parking"] == [PARKING_LANE_M, PARKING_LANE_M] for e in residential))

    def test_bike_routes(self):
        self.assertTrue(is_bike_route({"cycleway": "shared_lane"}))
        self.assertTrue(is_bike_route({"lcn": "yes"}))
        self.assertFalse(is_bike_route({"cycleway:both": "no"}))


class RoundaboutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        osm, bbox = roundabout_osm()
        cls.pack = pack_from_osm(osm, bbox, name="circle")

    def test_ring_lane_is_drivable(self):
        self.assertEqual(len(self.pack["roundabouts"]), 1)
        rb = self.pack["roundabouts"][0]
        self.assertGreaterEqual(rb["lane_r"], 5.0)   # a car (min turning radius 3.9 m) can drive it
        self.assertLess(rb["island_r"], rb["lane_r"])
        self.assertTrue(rb["ccw"])
        lanes = [l for l in self.pack["lanes"] if any(e["id"] == l["edge"] and e.get("ring") for e in self.pack["edges"])]
        self.assertTrue(lanes)
        for lane in lanes:
            for x, y in lane["pts"]:
                self.assertAlmostEqual(math.hypot(x - rb["x"], y - rb["y"]), rb["lane_r"], delta=0.4)

    def test_every_entry_yields(self):
        entries = [e for e in self.pack["edges"] if not e.get("ring") and e["to"] in self.pack["roundabouts"][0]["vertices"]]
        self.assertEqual(len(entries), 4)
        for e in entries:
            self.assertEqual(e["control"]["type"], "yield")
            self.assertEqual(e["control"]["roundabout"], "rb0")
        self.assertEqual(len(self.pack["yields"]), 4)
        self.assertFalse(any(e.get("control") for e in self.pack["edges"] if e.get("ring")))

    def test_route_through_the_circle_is_one_instruction(self):
        router = Router(self.pack)
        # from the east arm to the north arm: counter-clockwise, first exit
        routes = router.routes({"x": 60.0, "y": 1.6, "heading": math.pi}, {"x": 1.6, "y": 60.0})
        self.assertTrue(routes)
        turns = routes[0]["turns"]
        self.assertEqual([t["dir"] for t in turns], ["roundabout"])
        self.assertEqual(turns[0]["exit"], 1)
        self.assertEqual(turns[0]["street"], "Arm 1")
        # to the south arm: three exits round
        routes = router.routes({"x": 60.0, "y": 1.6, "heading": math.pi}, {"x": -1.6, "y": -60.0})
        self.assertEqual(routes[0]["turns"][0]["exit"], 3)


class SharpTurnTests(unittest.TestCase):
    def test_turns_that_double_back_are_avoided(self):
        # e1 runs east into node B; e2 leaves B back to the west-north-west (a 170 degree turn, the tip
        # of a traffic island); e3 carries on east. Only e3 is a real option.
        def edge(eid, a, b, pts):
            return {"id": eid, "from": a, "to": b, "pts": pts, "lanes": 1, "lane_width": 3.2, "width": 3.2,
                    "limit": 11.2, "oneway": True, "name": eid, "cls": "residential", "length": math.dist(pts[0], pts[-1]),
                    "lane_offsets": [0.0], "asphalt": [-1.6, 1.6], "parking": [0, 0]}
        edges = [edge("e1", "A", "B", [(0, 0), (50, 0)]), edge("e2", "B", "C", [(50, 0), (0, 8.8)]),
                 edge("e3", "B", "D", [(50, 0), (100, 0)])]
        pack = {"edges": edges, "lanes": [{"edge": e["id"], "idx": 0, "pts": e["pts"]} for e in edges]}
        router = Router(pack)
        self.assertGreaterEqual(router.turn_penalty("e1", "e2"), 1e5)
        self.assertEqual(router.turn_penalty("e1", "e3"), 0.0)


if __name__ == "__main__":
    unittest.main()
