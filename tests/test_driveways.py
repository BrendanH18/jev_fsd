import json
import math
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401
from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm.driveways import build_driveways, driveways_from_osm, driveways_path, is_driveway, load_driveways
from jev.osm.pack import pack_path
from jev.osm.parse import OsmData
from jev.osm.project import Projection

ORIGIN = {"lat": 51.04, "lon": -114.07}
PROJ = Projection(ORIGIN["lat"], ORIGIN["lon"])


def street(eid="e0", frm="n1", to="n2", pts=((0, 0), (100, 0)), oneway=False, **extra):
    length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
    return {"id": eid, "from": frm, "to": to, "pts": [list(p) for p in pts], "length": length, "lanes": 1, "lane_width": 3.3,
            "oneway": oneway, "name": "Test Street", "asphalt": [-5.5, 5.5], "parking": [2.2, 2.2], "lane_offsets": [1.65], **extra}


def osm_with(*ways):
    """OSM data whose driveways are given as metre polylines ([(x, y), ...], tags)."""
    osm, nid = OsmData(), 100
    for wid, (pts, tags) in enumerate(ways, start=1):
        ids = []
        for x, y in pts:
            lat, lon = PROJ.to_latlon(x, y)
            osm.add_node(nid, lat, lon)
            ids.append(nid)
            nid += 1
        osm.add_way(wid, ids, tags)
    return osm


DRIVEWAY = {"highway": "service", "service": "driveway"}


class TagTests(unittest.TestCase):
    def test_only_driveways(self):
        self.assertTrue(is_driveway(DRIVEWAY))
        self.assertFalse(is_driveway({"highway": "service", "service": "parking_aisle"}))
        self.assertFalse(is_driveway({"highway": "service"}))
        self.assertFalse(is_driveway({"highway": "residential", "service": "driveway"}))
        self.assertFalse(is_driveway({**DRIVEWAY, "area": "yes"}))


class MappingTests(unittest.TestCase):
    def build(self, edges, *ways):
        return driveways_from_osm(osm_with(*ways), {"origin": ORIGIN, "edges": edges, "name": "test"})["driveways"]

    def test_driveway_on_the_right_of_travel(self):
        # (y < 0 is right of an edge running east)
        out = self.build([street()], ([(40, 0), (40, -10), (40, -20)], DRIVEWAY))
        self.assertEqual(len(out), 1)
        d = out[0]
        self.assertEqual((d["edge"], d["side"]), ("e0", "right"))
        self.assertAlmostEqual(d["s"], 40, delta=0.3)
        self.assertAlmostEqual(d["heading"], -math.pi / 2, delta=0.02)
        self.assertAlmostEqual(d["length"], 20, delta=0.3)
        self.assertEqual(d["way"], 1)

    def test_two_way_street_keeps_the_edge_whose_right_it_is_on(self):
        e0 = street()
        e1 = street("e1", "n2", "n1", ((100, 0), (0, 0)))
        out = self.build([e0, e1], ([(30, 0), (30, 15)], DRIVEWAY))
        self.assertEqual([(d["edge"], d["side"]) for d in out], [("e1", "right")])
        self.assertAlmostEqual(out[0]["s"], 70, delta=0.3)
        self.assertAlmostEqual(out[0]["heading"], math.pi / 2, delta=0.02)

    def test_one_way_street_keeps_the_left(self):
        out = self.build([street(oneway=True)], ([(50, 0), (50, 12)], DRIVEWAY))
        self.assertEqual([(d["edge"], d["side"]) for d in out], [("e0", "left")])

    def test_mapped_to_the_kerb_still_meets_the_street(self):
        # (asphalt edge at 5.5 m; the driveway's end 1.5 m outside it)
        out = self.build([street()], ([(60, -7), (60, -18)], DRIVEWAY))
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[0]["x"], 60, delta=0.1)
        self.assertAlmostEqual(out[0]["y"], 0, delta=0.1)
        # (reversed node order: the end on the street is found either way)
        self.assertEqual(len(self.build([street()], ([(60, -18), (60, -7)], DRIVEWAY))), 1)

    def test_far_from_the_street_near_junctions_and_shallow_are_left_out(self):
        self.assertEqual(self.build([street()], ([(60, -9), (60, -20)], DRIVEWAY)), [])
        self.assertEqual(self.build([street()], ([(4, 0), (4, -12)], DRIVEWAY)), [])
        self.assertEqual(self.build([street()], ([(30, 0), (50, -4)], DRIVEWAY)), [])
        self.assertEqual(self.build([street()], ([(40, 0), (40, -12)], {"highway": "service"})), [])
        self.assertEqual(self.build([street(ring=True)], ([(40, 0), (40, -12)], DRIVEWAY)), [])

    def test_mapped_twice_is_one(self):
        out = self.build([street()], ([(40, 0), (40, -12)], DRIVEWAY), ([(41, -6.5), (41, -14)], DRIVEWAY))
        self.assertEqual(len(out), 1)


class LayerTests(unittest.TestCase):
    def test_build_uses_the_raw_download_and_caches(self):
        with tempfile.TemporaryDirectory() as tmp:
            maps = Path(tmp)
            bbox = (-114.087, 51.034, -114.063, 51.045)
            self.assertIsNone(build_driveways(bbox, maps, {"edges": []}))
            path = driveways_path(maps, bbox)
            self.assertTrue(path.name.endswith(".driveways.v1.json"))
            path.write_text(json.dumps({"driveways_version": "1", "driveways": [{"id": "d1"}]}))
            self.assertEqual(build_driveways(bbox, maps, {"edges": []})["driveways"], [{"id": "d1"}])
            self.assertEqual(load_driveways(bbox, maps)["driveways"], [{"id": "d1"}])

    def test_bundled_layers_match_their_packs(self):
        for name, bbox in PRESET_BBOXES.items():
            layer = load_driveways(bbox, MAPS_DIR)
            self.assertIsNotNone(layer, name)
            pack = json.loads(pack_path(MAPS_DIR, bbox).read_text())
            edges = {e["id"]: e for e in pack["edges"]}
            for d in layer["driveways"]:
                e = edges[d["edge"]]
                self.assertFalse(e.get("ring", False), (name, d["id"]))
                self.assertIn(d["side"], ("left", "right"))
                self.assertTrue(0 < d["s"] < e["length"], (name, d["id"]))
                if d["side"] == "left":
                    self.assertTrue(e["oneway"], (name, d["id"]))
        for city in ("calgary", "ottawa"):
            self.assertGreater(len(load_driveways(PRESET_BBOXES[city], MAPS_DIR)["driveways"]), 50, city)


if __name__ == "__main__":
    unittest.main()
