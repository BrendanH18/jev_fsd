import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (puts the project on the path)

from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm import fetch
from jev.osm.pack import pack_from_osm, pack_path
from jev.osm.parse import OsmData, parse_xml
from jev.osm.project import Projection
from jev.osm.transit import MIN_RUN_M, build_transit, load_transit, transit_from_osm, transit_path

LAT0, LON0 = 49.0, -123.0


def avenue(stops=(), extra_relations=()):
    """An east-west two-way avenue 600 m long, in two ways meeting at x = 0, crossed there and at
    each end by side streets. A bus route runs east along it; `stops` are (osm id, x, y, role)."""
    proj = Projection(LAT0, LON0)
    osm = OsmData()

    def node(nid, x, y, tags=None):
        lat, lon = proj.to_latlon(x, y)
        osm.add_node(nid, lat, lon, tags or {})

    for nid, x in ((1, -300), (2, -150), (3, 0), (4, 150), (5, 300)):
        node(nid, x, 0)
        node(100 + nid, x, 100)
        node(200 + nid, x, -100)
    avenue_tags = {"highway": "secondary", "name": "Main Ave", "maxspeed": "50"}
    osm.add_way(10, [1, 2, 3], avenue_tags)
    # (the second way drawn east to west: the route joins it end to end all the same)
    osm.add_way(11, [5, 4, 3], avenue_tags)
    for nid in (1, 2, 3, 4, 5):
        osm.add_way(20 + nid, [200 + nid, nid, 100 + nid], {"highway": "residential", "name": "Side %d" % nid})
    for osm_id, x, y, role in stops:
        node(osm_id, x, y, {"highway": "bus_stop", "name": "Stop %d" % osm_id})
    members = [("way", 10, ""), ("way", 11, "")] + [("node", osm_id, role) for osm_id, _x, _y, role in stops]
    osm.add_relation(900, members, {"type": "route", "route": "bus", "ref": "9", "name": "Boundary"})
    for rel in extra_relations:
        osm.add_relation(*rel)
    s, w = proj.to_latlon(-320, -120)
    n, e = proj.to_latlon(320, 120)
    bbox = (w, s, e, n)
    return osm, bbox


class TransitTests(unittest.TestCase):
    def test_route_becomes_a_run_of_directed_edges_eastward(self):
        osm, bbox = avenue()
        pack = pack_from_osm(osm, bbox)
        transit = transit_from_osm(osm, pack)
        self.assertEqual(len(transit["routes"]), 1)
        route = transit["routes"][0]
        self.assertEqual((route["ref"], route["name"], route["mode"]), ("9", "Boundary", "bus"))
        self.assertEqual(len(route["runs"]), 1)
        edges = {e["id"]: e for e in pack["edges"]}
        run = route["runs"][0]
        chain = [edges[i] for i in run["edges"]]
        self.assertEqual([e["from"] for e in chain] + [chain[-1]["to"]], ["n1", "n2", "n3", "n4", "n5"])
        self.assertAlmostEqual(run["length"], 600, delta=1)

    def test_stops_on_the_right_hand_side_are_placed_along_the_run_in_order(self):
        # eastbound stops are south of the avenue (right of travel); a westbound one north of it is not
        # this route's, and a stop on the road and its sign 8 m on are one stop
        stops = [(31, 60, -8, "platform"), (32, -200, -9, "platform 1"), (33, -100, 9, "platform"), (34, 68, -1, "stop"),
                 (35, 290, -8, "platform")]
        osm, bbox = avenue(stops)
        pack = pack_from_osm(osm, bbox)
        transit = transit_from_osm(osm, pack)
        run = transit["routes"][0]["runs"][0]
        self.assertEqual([s["id"] for s in run["stops"]], ["s32", "s31"])
        edges = {e["id"]: e for e in pack["edges"]}
        first = run["stops"][0]
        self.assertEqual((edges[first["edge"]]["from"], edges[first["edge"]]["to"]), ("n1", "n2"))
        self.assertAlmostEqual(first["s"], 100, delta=0.5)
        by_id = {s["id"]: s for s in transit["stops"]}
        self.assertEqual(set(by_id), {"s31", "s32"})
        self.assertEqual(by_id["s31"]["name"], "Stop 31")
        self.assertAlmostEqual(by_id["s31"]["y"], -8, delta=0.05)

    def test_a_lone_two_way_way_gives_no_direction_and_short_runs_are_dropped(self):
        lone = (901, [("way", 10, "")], {"type": "route", "route": "bus", "ref": "1"})
        backward = (902, [("way", 10, "backward")], {"type": "route", "route": "trolleybus", "ref": "2"})
        osm, bbox = avenue(extra_relations=(lone, backward))
        pack = pack_from_osm(osm, bbox)
        transit = transit_from_osm(osm, pack)
        refs = {r["ref"]: r for r in transit["routes"]}
        self.assertNotIn("1", refs)
        self.assertIn("2", refs)
        edges = {e["id"]: e for e in pack["edges"]}
        chain = [edges[i] for i in refs["2"]["runs"][0]["edges"]]
        self.assertEqual([e["from"] for e in chain], ["n3", "n2"])
        self.assertGreaterEqual(MIN_RUN_M, 150)

    def test_streetcar_tracks_laid_in_a_lane_become_a_run_in_that_lane(self):
        # tracks 1.6 m right of the avenue's centreline each way (in its lanes, mixed traffic), drawn
        # as ways of their own (two each, joined end to end, which gives the way they go), and a third
        # 9 m out, in a right of way of its own
        proj = Projection(LAT0, LON0)

        def track(osm, first, way_id, y, xs):
            for i, x in enumerate(xs):
                lat, lon = proj.to_latlon(x, y)
                osm.add_node(first + i, lat, lon, {})
            ids = list(range(first, first + len(xs)))
            osm.add_way(way_id, ids[:2], {"railway": "tram"})
            osm.add_way(way_id + 100, ids[1:], {"railway": "tram"})
            return [("way", way_id, ""), ("way", way_id + 100, "")]

        osm, bbox = avenue()
        east = track(osm, 1000, 60, -1.6, [-290, -100, 120, 290])
        west = track(osm, 1100, 61, 1.6, [290, 150, -60, -290])
        median = track(osm, 1200, 62, -9, [-290, 0, 290])
        lat, lon = proj.to_latlon(60, -1.6)
        osm.add_node(1300, lat, lon, {"railway": "tram_stop", "name": "Tram 1"})
        osm.add_relation(950, east + [("node", 1300, "stop")], {"type": "route", "route": "tram", "ref": "5", "name": "5 East"})
        osm.add_relation(951, west, {"type": "route", "route": "tram", "ref": "5", "name": "5 West"})
        osm.add_relation(952, median, {"type": "route", "route": "tram", "ref": "6", "name": "6 Median"})
        pack = pack_from_osm(osm, bbox)
        transit = transit_from_osm(osm, pack)
        trams = {r["name"]: r for r in transit["routes"] if r["mode"] == "tram"}
        self.assertEqual(set(trams), {"5 East", "5 West"})
        edges = {e["id"]: e for e in pack["edges"]}
        for name, nodes in (("5 East", ["n1", "n2", "n3", "n4", "n5"]), ("5 West", ["n5", "n4", "n3", "n2", "n1"])):
            runs = trams[name]["runs"]
            self.assertEqual(len(runs), 1, name)
            chain = [edges[i] for i in runs[0]["edges"]]
            self.assertEqual([e["from"] for e in chain] + [chain[-1]["to"]], nodes, name)
            self.assertEqual(runs[0]["lane"], 0)
        stops = trams["5 East"]["runs"][0]["stops"]
        self.assertEqual([s["id"] for s in stops], ["s1300"])
        self.assertAlmostEqual(stops[0]["s"], 60, delta=0.5)
        # (the bus route is as it was)
        self.assertNotIn("lane", next(r for r in transit["routes"] if r["mode"] == "bus")["runs"][0])

    def test_parsing_keeps_only_bus_and_streetcar_routes(self):
        xml = b"""<?xml version="1.0"?><osm>
          <node id="1" lat="49" lon="-123"/><node id="2" lat="49.001" lon="-123"/>
          <way id="5"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
          <relation id="7"><member type="way" ref="5" role=""/><member type="node" ref="1" role="stop 1"/>
            <tag k="type" v="route"/><tag k="route" v="bus"/><tag k="ref" v="4"/></relation>
          <relation id="8"><member type="way" ref="5" role=""/><tag k="type" v="route"/><tag k="route" v="bicycle"/></relation>
          <relation id="9"><member type="way" ref="5" role=""/><tag k="type" v="route"/><tag k="route" v="tram"/></relation>
        </osm>"""
        osm = parse_xml(xml)
        self.assertEqual([r["id"] for r in osm.relations], [7, 9])
        self.assertEqual(osm.relations[0]["members"], [("way", 5, ""), ("node", 1, "stop 1")])

    def test_built_beside_the_pack_from_the_cached_download_only(self):
        osm, bbox = avenue([(31, 60, -8, "platform")])
        pack = pack_from_osm(osm, bbox)
        with tempfile.TemporaryDirectory() as directory:
            maps = Path(directory)
            self.assertIsNone(build_transit(bbox, maps, pack))
            self.assertFalse(transit_path(maps, bbox).exists())
            # (written as OSM XML, the way a download is cached)
            lines = ['<?xml version="1.0"?><osm>']
            for nid, (lat, lon, tags) in osm.nodes.items():
                lines.append('<node id="%d" lat="%.8f" lon="%.8f">%s</node>' % (nid, lat, lon, "".join('<tag k="%s" v="%s"/>' % kv for kv in tags.items())))
            for w in osm.ways:
                lines.append('<way id="%d">%s%s</way>' % (w["id"], "".join('<nd ref="%d"/>' % n for n in w["nodes"]), "".join('<tag k="%s" v="%s"/>' % kv for kv in w["tags"].items())))
            for r in osm.relations:
                lines.append('<relation id="%d">%s%s</relation>' % (r["id"], "".join('<member type="%s" ref="%d" role="%s"/>' % m for m in r["members"]), "".join('<tag k="%s" v="%s"/>' % kv for kv in r["tags"].items())))
            lines.append("</osm>")
            fetch.cache_path(maps, bbox).write_text("".join(lines))
            built = build_transit(bbox, maps, pack)
            self.assertEqual(len(built["routes"]), 1)
            self.assertEqual(load_transit(bbox, maps), built)
            self.assertEqual(json.loads(transit_path(maps, bbox).read_text())["transit_version"], "1")

    def test_every_bundled_map_has_its_transit(self):
        for name, bbox in PRESET_BBOXES.items():
            with self.subTest(name=name):
                transit = load_transit(bbox, MAPS_DIR)
                self.assertIsNotNone(transit)
                self.assertGreater(len(transit["routes"]), 0)
                pack = json.loads(pack_path(MAPS_DIR, bbox).read_text())
                ids = {e["id"] for e in pack["edges"]}
                self.assertTrue(all(e in ids for r in transit["routes"] for run in r["runs"] for e in run["edges"]))

    def test_demo_bundles_transit_with_each_map(self):
        from scripts import build_demo
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            with contextlib.redirect_stdout(io.StringIO()):
                build_demo.build(output)
            kits = json.loads((output / "demo-data/kitsilano.json").read_text())
            self.assertIn("transit", kits)
            self.assertGreater(len(kits["transit"]["stops"]), 10)


if __name__ == "__main__":
    unittest.main()
