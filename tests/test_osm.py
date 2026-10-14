import json
import math
import unittest
from urllib.parse import urlparse

from helpers import grid_pack, synthetic_osm

from jev import geometry as g
from jev.osm import fetch
from jev.osm.buildings import extract_buildings
from jev.osm.graph import build_graph, is_drivable, lanes_per_direction, parse_maxspeed, way_direction
from jev.osm.parse import OsmData, parse_xml
from jev.osm.project import Projection


class ProjectionTests(unittest.TestCase):
    def test_round_trip_and_scale(self):
        proj = Projection(49.26, -123.16)
        x, y = proj.to_xy(49.2609, -123.1585)
        lat, lon = proj.to_latlon(x, y)
        self.assertAlmostEqual(lat, 49.2609, places=7)
        self.assertAlmostEqual(lon, -123.1585, places=7)
        # 0.001 degree of latitude is about 110.6 m
        self.assertAlmostEqual(proj.to_xy(49.261, -123.16)[1], 110.574, places=2)


class TagTests(unittest.TestCase):
    def test_maxspeed(self):
        self.assertAlmostEqual(parse_maxspeed("50", "residential"), 50 / 3.6)
        self.assertAlmostEqual(parse_maxspeed("25 mph", "residential"), 25 * 0.44704)
        self.assertAlmostEqual(parse_maxspeed(None, "primary_link"), 18.0)
        self.assertAlmostEqual(parse_maxspeed("garbage", "residential"), 11.2)

    def test_lanes(self):
        self.assertEqual(lanes_per_direction({}, False), (1, 1))
        self.assertEqual(lanes_per_direction({"lanes": "4"}, False), (2, 2))
        self.assertEqual(lanes_per_direction({"lanes": "3"}, False), (2, 2))
        self.assertEqual(lanes_per_direction({"lanes": "3"}, True), (3, 0))
        self.assertEqual(lanes_per_direction({"lanes": "3", "lanes:forward": "2"}, False), (2, 1))
        self.assertEqual(lanes_per_direction({"lanes": "9"}, True), (3, 0))

    def test_direction(self):
        self.assertEqual(way_direction({"oneway": "yes"}), "forward")
        self.assertEqual(way_direction({"oneway": "-1"}), "backward")
        self.assertEqual(way_direction({"junction": "roundabout"}), "forward")
        self.assertEqual(way_direction({}), "both")

    def test_streets_through_buildings_are_not_drivable(self):
        self.assertTrue(is_drivable({"highway": "living_street"}))
        self.assertTrue(is_drivable({"highway": "residential", "tunnel": "yes"}))
        self.assertFalse(is_drivable({"highway": "living_street", "covered": "yes"}))
        self.assertFalse(is_drivable({"highway": "tertiary", "tunnel": "building_passage"}))

    def test_roundabout_split_over_ways_is_one_ring_on_its_carriageway(self):
        osm = OsmData()
        lat0, lon0, radius = 44.6450, -63.5800, 20.0
        for k in range(16):
            a = 2 * math.pi * k / 16
            osm.add_node(k + 1, lat0 + radius * math.sin(a) / 110574, lon0 + radius * math.cos(a) / (111320 * math.cos(math.radians(lat0))))
        ring = {"highway": "primary", "junction": "roundabout", "lanes": "2"}
        osm.add_way(10, [1, 2, 3, 4, 5, 6, 7], ring)          # counter-clockwise, in three pieces
        osm.add_way(11, [7, 8, 9, 10, 11, 12], ring)
        osm.add_way(12, [12, 13, 14, 15, 16, 1], ring)
        proj = Projection.for_bbox((-63.5810, 44.6440, -63.5790, 44.6460))
        graph = build_graph(osm, proj)
        self.assertEqual(len(graph.roundabouts), 1)
        rb = graph.roundabouts[0]
        cx, cy = proj.to_xy(lat0, lon0)
        self.assertLess(math.hypot(rb["x"] - cx, rb["y"] - cy), 0.5)
        self.assertAlmostEqual(rb["lane_r"], radius, delta=0.5)
        ring_edges = [e for e in graph.edges.values() if e.get("ring")]
        self.assertTrue(ring_edges)
        self.assertTrue(all(e["lanes"] == 1 and len(e["lane_offsets"]) == 1 for e in ring_edges))

    def test_closed_roundabouts_sharing_a_node_stay_separate(self):
        osm = OsmData()
        lat0, lon0, radius = 44.6450, -63.5800, 20.0
        m_lat, m_lon = 1 / 110574, 1 / (111320 * math.cos(math.radians(lat0)))
        centres = [(-radius, 0.0), (radius, 0.0)]   # east point of the first is the west point of the second
        ids = [[], []]
        for r, (ox, oy) in enumerate(centres):
            for k in range(16):
                a = 2 * math.pi * k / 16 + (math.pi if r else 0.0)
                node = 1 if k == 0 else 100 * (r + 1) + k
                if node not in osm.nodes:
                    osm.add_node(node, lat0 + (oy + radius * math.sin(a)) * m_lat, lon0 + (ox + radius * math.cos(a)) * m_lon)
                ids[r].append(node)
        ring = {"highway": "tertiary", "junction": "roundabout"}
        osm.add_way(20, ids[0] + ids[0][:1], ring)
        osm.add_way(21, ids[1] + ids[1][:1], ring)
        proj = Projection.for_bbox((-63.5810, 44.6440, -63.5790, 44.6460))
        graph = build_graph(osm, proj)
        self.assertEqual(len(graph.roundabouts), 2)
        for (ox, oy), rb in zip(sorted(centres), sorted(graph.roundabouts, key=lambda rb: rb["x"])):
            cx, cy = proj.to_xy(lat0 + oy * m_lat, lon0 + ox * m_lon)
            self.assertLess(math.hypot(rb["x"] - cx, rb["y"] - cy), 0.5)
            self.assertAlmostEqual(rb["lane_r"], radius, delta=0.5)

    def test_raised_skywalks_are_not_ground_footprints(self):
        osm = OsmData()
        square = [(44.6450, -63.5800), (44.6450, -63.5795), (44.6455, -63.5795), (44.6455, -63.5800)]
        for way_id, tags in enumerate(({"building": "yes"}, {"building": "yes", "building:min_level": "2", "layer": "2"},
                                       {"building": "bridge", "min_height": "6.5"}, {"building": "yes", "min_height": "0"})):
            ids = []
            for k, (lat, lon) in enumerate(square):
                osm.add_node(way_id * 10 + k, lat, lon)
                ids.append(way_id * 10 + k)
            osm.add_way(way_id, ids + ids[:1], tags)
        proj = Projection.for_bbox((-63.5810, 44.6440, -63.5790, 44.6460))
        self.assertEqual(len(extract_buildings(osm, proj)), 2)


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.osm, self.bbox = synthetic_osm()
        self.proj = Projection.for_bbox(self.bbox)
        self.graph = build_graph(self.osm, self.proj)

    def test_grid_counts(self):
        # 4x4 grid: 16 vertices; 24 segments; 21 two-way + 3 one-way -> 45 directed edges.
        # The dangling one-way stub is pruned by the SCC step.
        self.assertEqual(len(self.graph.vertices), 16)
        self.assertEqual(len(self.graph.edges), 45)
        self.assertEqual(self.graph.stats["edges_dropped_scc"], 1)

    def test_oneway_has_single_direction(self):
        oneway = [e for e in self.graph.edges.values() if e["name"] == "Oneway Ave"]
        self.assertEqual(len(oneway), 3)
        self.assertTrue(all(e["oneway"] and e["forward"] for e in oneway))
        # travelling north (increasing y)
        for e in oneway:
            self.assertGreater(e["pts"][-1][1], e["pts"][0][1])

    def test_two_way_edges_reverse_each_other(self):
        main = [e for e in self.graph.edges.values() if e["name"] == "Main Ave"]
        self.assertEqual(len(main), 6)
        fwd = [e for e in main if e["forward"]]
        bwd = [e for e in main if not e["forward"]]
        self.assertEqual(len(fwd), 3)
        pair = next(b for b in bwd if b["from"] == fwd[0]["to"] and b["to"] == fwd[0]["from"])
        self.assertEqual(pair["pts"], list(reversed(fwd[0]["pts"])))
        self.assertEqual(fwd[0]["lanes"], 1)
        self.assertAlmostEqual(fwd[0]["limit"], 50 / 3.6, places=3)

    def test_lane_centerline_is_right_of_travel(self):
        for e in self.graph.edges.values():
            if e["oneway"]:
                continue
            h = g.heading_of(e["pts"][0], e["pts"][1])
            mid_c = g.point_at(e["pts"], e["length"] / 2)
            mid_l = g.point_at(e["lane_pts"][0], e["length"] / 2)
            # cross product of heading and (lane - center) must be negative (to the right)
            import math
            cross = math.cos(h) * (mid_l[1] - mid_c[1]) - math.sin(h) * (mid_l[0] - mid_c[0])
            self.assertLess(cross, 0, e["name"])
            self.assertAlmostEqual(g.dist(mid_c, mid_l), e["lane_width"] / 2, places=3)

    def test_successors_and_turns(self):
        e = next(e for e in self.graph.edges.values() if e["name"] == "Row 0 St" and e["forward"])
        succ = self.graph.successors(e["id"])
        self.assertGreaterEqual(len(succ), 2)
        turns = {self.graph.turn(e["id"], s) for s in succ}
        self.assertIn("left", turns)  # row 0 (south edge) heading east: can turn left (north)


class ControlsTests(unittest.TestCase):
    def test_signals_and_stops_attached(self):
        pack = grid_pack()
        self.assertEqual(len(pack["intersections"]), 4)  # the 2x2 central vertices
        for inter in pack["intersections"]:
            self.assertEqual(len(inter["approaches"]), 4)
            groups = {a["group"] for a in inter["approaches"]}
            self.assertEqual(groups, {"A", "B"})
            self.assertEqual(inter["cycle_s"], 48.0)
        # all-way stops on the top and bottom rows' interior vertices: 2 rows x 2 vertices x 3 approaches
        self.assertEqual(len(pack["stops"]), 12)
        self.assertTrue(all(s["all_way"] for s in pack["stops"]))
        controlled = [e for e in pack["edges"] if e.get("control")]
        self.assertEqual(len(controlled), 16 + 12)
        for e in controlled:
            self.assertLess(e["control"]["s_line"], e["length"])
            self.assertGreater(e["control"]["s_line"], 0)

    def test_directional_stop_from_xml(self):
        # a T: horizontal way through nodes 1-2-3, vertical 2-4; stop node 5 sits 8 m west of 2 on the
        # horizontal way with direction=forward, so only the eastbound edge gets it
        xml = """<?xml version="1.0"?><osm>
        <node id="1" lat="49.0" lon="-123.001"/>
        <node id="5" lat="49.0" lon="-123.00011"><tag k="highway" v="stop"/><tag k="direction" v="forward"/></node>
        <node id="2" lat="49.0" lon="-123.0"/>
        <node id="3" lat="49.0" lon="-122.999"/>
        <node id="4" lat="49.001" lon="-123.0"/>
        <node id="6" lat="48.999" lon="-123.0"/>
        <way id="10"><nd ref="1"/><nd ref="5"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/></way>
        <way id="11"><nd ref="4"/><nd ref="2"/><nd ref="6"/><tag k="highway" v="residential"/></way>
        </osm>"""
        from jev.osm.pack import pack_from_osm
        pack = pack_from_osm(parse_xml(xml), (-123.002, 48.998, -122.998, 49.002))
        self.assertEqual(len(pack["stops"]), 1)
        stop = pack["stops"][0]
        edge = next(e for e in pack["edges"] if e["id"] == stop["edge"])
        self.assertFalse(stop["all_way"])
        self.assertEqual(edge["to"], "n2")
        self.assertGreater(edge["pts"][-1][0], edge["pts"][0][0])  # eastbound
        self.assertAlmostEqual(edge["length"] - stop["s_line"], 8.0, delta=0.5)


class PackTests(unittest.TestCase):
    def test_pack_serializes_and_is_small(self):
        pack = grid_pack()
        text = json.dumps(pack)
        self.assertLess(len(text), 1_000_000)
        self.assertEqual(pack["pack_version"], "5")
        self.assertTrue(pack["synthetic"])
        self.assertGreater(len(pack["buildings"]), 10)
        self.assertEqual(len(pack["lanes"]), sum(e["lanes"] for e in pack["edges"]))
        for e in pack["edges"]:
            for x, y in e["pts"]:
                self.assertEqual(round(x, 2), x)

    def test_fetch_uses_cache_and_falls_back(self):
        import tempfile
        from pathlib import Path
        calls = []

        def http(url, data, timeout):
            calls.append(url)
            if urlparse(url).hostname == "api.openstreetmap.org":
                raise OSError("down")
            return b'<?xml version="1.0"?><osm></osm>'

        small = (-0.01, -0.01, 0.01, 0.01)
        with tempfile.TemporaryDirectory() as tmp:
            path = fetch.fetch_osm_xml(small, Path(tmp), http=http, sleep=lambda s: None)
            self.assertTrue(path.exists())
            self.assertEqual(sum(urlparse(u).hostname == "api.openstreetmap.org" for u in calls), 3)
            self.assertEqual(calls[-1], fetch.OVERPASS_URLS[0])
            n = len(calls)
            fetch.fetch_osm_xml(small, Path(tmp), http=http, sleep=lambda s: None)
            self.assertEqual(len(calls), n)  # cached
            with self.assertRaises(fetch.FetchError):
                fetch.fetch_osm_xml((-10, -10, 10, 10), Path(tmp), http=http, sleep=lambda s: None)


if __name__ == "__main__":
    unittest.main()
