import json
import math
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401
from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm import fetch
from jev.osm.pack import pack_path
from jev.osm.parks import MIN_AREA_M2, build_parks, kind_of, load_parks, parks_from_osm, parks_path
from jev.osm.parse import OsmData, parse_xml
from jev.osm.project import Projection

ORIGIN = {"lat": 45.414, "lon": -75.6975}
PROJ = Projection(ORIGIN["lat"], ORIGIN["lon"])


def street(eid="e0", frm="n1", to="n2", pts=((0, 0), (200, 0)), **extra):
    length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
    return {"id": eid, "from": frm, "to": to, "pts": [list(p) for p in pts], "length": length, "lanes": 1, "lane_width": 3.3,
            "oneway": False, "name": "Test Street", "asphalt": [-5.5, 5.5], **extra}


def box(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]


def osm_with(*ways):
    """OSM data whose ways are given as metre polylines ([(x, y), ...], tags); a closed one shares its
    first node with its last."""
    osm, nid = OsmData(), 100
    for wid, (pts, tags) in enumerate(ways, start=1):
        ids = []
        for x, y in (pts[:-1] if pts[0] == pts[-1] else pts):
            lat, lon = PROJ.to_latlon(x, y)
            osm.add_node(nid, lat, lon)
            ids.append(nid)
            nid += 1
        osm.add_way(wid, ids + ([ids[0]] if pts[0] == pts[-1] else []), tags)
    return osm


PARK = {"leisure": "park", "name": "Test Park"}


class TagTests(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(kind_of({"leisure": "park"}), "park")
        self.assertEqual(kind_of({"leisure": "garden"}), "garden")
        self.assertEqual(kind_of({"leisure": "recreation_ground"}), "recreation_ground")
        self.assertEqual(kind_of({"landuse": "grass"}), "grass")
        self.assertEqual(kind_of({"natural": "water"}), "water")
        self.assertEqual(kind_of({"waterway": "riverbank"}), "water")
        self.assertEqual(kind_of({"waterway": "canal"}), "canal")
        self.assertEqual(kind_of({"waterway": "river"}), "river")
        self.assertIsNone(kind_of({"leisure": "playground"}))
        self.assertIsNone(kind_of({"waterway": "stream"}))
        self.assertIsNone(kind_of({"highway": "residential"}))

    def test_the_parser_keeps_park_and_water_multipolygons(self):
        xml = b"""<?xml version="1.0"?><osm>
          <relation id="1"><member type="way" ref="5" role="outer"/><tag k="type" v="multipolygon"/><tag k="leisure" v="park"/></relation>
          <relation id="2"><member type="way" ref="6" role="outer"/><tag k="type" v="multipolygon"/><tag k="natural" v="water"/></relation>
          <relation id="3"><member type="way" ref="7" role="outer"/><tag k="type" v="multipolygon"/><tag k="landuse" v="retail"/></relation>
        </osm>"""
        self.assertEqual(sorted(r["id"] for r in parse_xml(xml).relations), [1, 2])

    def test_the_overpass_query_asks_for_parks_and_water(self):
        q = fetch.overpass_query((-75.71, 45.40, -75.68, 45.42))
        self.assertIn('way["leisure"~"^(park|garden|recreation_ground)$"]', q)
        self.assertIn('way["natural"="water"]', q)
        self.assertIn('way["waterway"~"^(river|canal|riverbank)$"]', q)
        self.assertIn('rel["natural"="water"]', q)


class SpanTests(unittest.TestCase):
    def build(self, edges, *ways):
        return parks_from_osm(osm_with(*ways), {"origin": ORIGIN, "edges": edges, "name": "test"})

    def test_a_park_beside_the_street_on_its_right_and_left(self):
        # (y < 0 is right of an edge running east; its twin running west has it on its left)
        e0 = street()
        e1 = street("e1", "n2", "n1", ((200, 0), (0, 0)))
        out = self.build([e0, e1], (box(40, -60, 160, -12), PARK))
        self.assertEqual([a["id"] for a in out["areas"]], ["w1"])
        self.assertEqual(out["areas"][0]["kind"], "park")
        self.assertTrue(out["areas"][0]["closed"])
        by_edge = {s["edge"]: s for s in out["spans"]}
        self.assertEqual((by_edge["e0"]["left"], by_edge["e0"]["right"]), (None, "w1"))
        self.assertEqual((by_edge["e1"]["left"], by_edge["e1"]["right"]), ("w1", None))
        # (the span runs as far as the park is within reach of the centreline)
        self.assertLess(abs(by_edge["e0"]["from"] - 40 + math.sqrt(25 ** 2 - 12 ** 2)), 3)
        self.assertLess(abs(by_edge["e0"]["to"] - 160 - math.sqrt(25 ** 2 - 12 ** 2)), 3)
        self.assertFalse(by_edge["e0"]["water"])

    def test_between_a_park_and_water(self):
        out = self.build([street()], (box(30, -50, 170, -10), PARK), (box(30, 10, 170, 40), {"natural": "water"}))
        span = out["spans"][0]
        self.assertEqual((span["left"], span["right"]), ("w2", "w1"))
        self.assertTrue(span["water"])

    def test_a_street_through_a_park_has_it_both_sides(self):
        out = self.build([street()], (box(50, -40, 150, 40), PARK))
        self.assertEqual([(s["left"], s["right"]) for s in out["spans"]], [("w1", "w1")])

    def test_a_canal_is_a_line(self):
        out = self.build([street()], ([(0, 18), (200, 18)], {"waterway": "canal", "name": "Test Canal"}))
        self.assertEqual(out["areas"][0]["kind"], "canal")
        self.assertEqual(len(out["areas"][0]["lines"]), 1)
        self.assertEqual((out["spans"][0]["left"], out["spans"][0]["right"]), ("w1", None))
        self.assertTrue(out["spans"][0]["water"])

    def test_too_small_too_far_and_rings_are_left_out(self):
        # (a planter of a park, and a lawn too small to count)
        tiny = math.sqrt(MIN_AREA_M2["park"]) - 5
        self.assertEqual(self.build([street()], (box(90, -12, 90 + tiny, -12 - tiny), PARK))["spans"], [])
        self.assertEqual(self.build([street()], (box(60, -60, 100, -12), {"landuse": "grass"}))["spans"], [])
        # (30 m from the centreline: beyond reach)
        self.assertEqual(self.build([street()], (box(40, -90, 160, -30), PARK))["spans"], [])
        # (a playground is not a park, and a roundabout ring is never a crossing place)
        self.assertEqual(self.build([street()], (box(40, -60, 160, -12), {"leisure": "playground"}))["spans"], [])
        self.assertEqual(self.build([street(ring=True)], (box(40, -60, 160, -12), PARK))["spans"], [])
        # (an area beside no street is not kept)
        self.assertEqual(self.build([street()], (box(400, 400, 600, 600), PARK))["areas"], [])

    def test_a_clipped_corner_is_too_short(self):
        out = self.build([street()], (box(205, -60, 260, -12), PARK))
        self.assertEqual(out["spans"], [])


class LayerTests(unittest.TestCase):
    def test_build_uses_the_raw_download_and_caches(self):
        with tempfile.TemporaryDirectory() as tmp:
            maps = Path(tmp)
            bbox = (-75.708, 45.407, -75.687, 45.421)
            self.assertIsNone(build_parks(bbox, maps, {"edges": []}))
            path = parks_path(maps, bbox)
            self.assertTrue(path.name.endswith(".parks.v1.json"))
            path.write_text(json.dumps({"parks_version": "1", "areas": [], "spans": [{"edge": "e1"}]}))
            self.assertEqual(build_parks(bbox, maps, {"edges": []})["spans"], [{"edge": "e1"}])
            self.assertEqual(load_parks(bbox, maps)["spans"], [{"edge": "e1"}])

    def test_bundled_layers_match_their_packs(self):
        for name, bbox in PRESET_BBOXES.items():
            layer = load_parks(bbox, MAPS_DIR)
            self.assertIsNotNone(layer, name)
            pack = json.loads(pack_path(MAPS_DIR, bbox).read_text())
            edges = {e["id"]: e for e in pack["edges"]}
            areas = {a["id"]: a for a in layer["areas"]}
            self.assertGreater(len(layer["spans"]), 20, name)
            for s in layer["spans"]:
                e = edges[s["edge"]]
                self.assertFalse(e.get("ring", False), (name, s["edge"]))
                self.assertTrue(0 <= s["from"] < s["to"] <= e["length"] + 0.05, (name, s))
                self.assertTrue(s["left"] or s["right"], (name, s))
                for side in (s["left"], s["right"]):
                    if side:
                        self.assertIn(side, areas, (name, s))
        # (Ottawa: Clemow Avenue between Central Park and Patterson's Creek Park, the "Goose crossing"
        # challenge's street; Saskatoon has the South Saskatchewan River)
        ottawa = load_parks(PRESET_BBOXES["ottawa"], MAPS_DIR)
        names = {a["id"]: a["name"] for a in ottawa["areas"]}
        clemow = [s for s in ottawa["spans"] if s["name"] == "Clemow Avenue" and s["left"] and s["right"]]
        self.assertTrue(any({names[s["left"]], names[s["right"]]} == {"Central Park", "Patterson's Creek Park"} for s in clemow))
        self.assertTrue(any(s["water"] for s in load_parks(PRESET_BBOXES["saskatoon"], MAPS_DIR)["spans"]))


if __name__ == "__main__":
    unittest.main()
