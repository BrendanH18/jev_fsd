import json
import math
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401
from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm.bridges import MIN_SPAN_M, bridges_from_osm, bridges_path, build_bridges, is_bridge, load_bridges
from jev.osm.pack import pack_path
from jev.osm.parse import OsmData
from jev.osm.project import Projection

ORIGIN = {"lat": 52.124, "lon": -106.661}
PROJ = Projection(ORIGIN["lat"], ORIGIN["lon"])


def street(eid="e0", frm="n1", to="n2", pts=((0, 0), (200, 0)), **extra):
    length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
    return {"id": eid, "from": frm, "to": to, "pts": [list(p) for p in pts], "length": length, "lanes": 1, "lane_width": 3.5,
            "oneway": False, "name": "Test Street", "asphalt": [-3.5, 3.5], **extra}


def osm_with(*ways):
    """OSM data whose ways are given as metre polylines ([(x, y), ...], tags)."""
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


BRIDGE = {"highway": "tertiary", "bridge": "yes", "name": "Test Bridge"}


class TagTests(unittest.TestCase):
    def test_drivable_bridges_only(self):
        self.assertTrue(is_bridge({"highway": "tertiary", "bridge": "yes"}))
        self.assertTrue(is_bridge({"highway": "secondary", "bridge": "viaduct"}))
        self.assertTrue(is_bridge({"highway": "residential", "bridge": "movable"}))
        self.assertFalse(is_bridge({"highway": "tertiary", "bridge": "no"}))
        self.assertFalse(is_bridge({"highway": "tertiary"}))
        self.assertFalse(is_bridge({"highway": "footway", "bridge": "yes"}))
        self.assertFalse(is_bridge({"railway": "rail", "bridge": "yes"}))


class SpanTests(unittest.TestCase):
    def build(self, edges, *ways):
        return bridges_from_osm(osm_with(*ways), {"origin": ORIGIN, "edges": edges, "name": "test"})

    def test_the_stretch_on_the_bridge_each_way(self):
        e0 = street()
        e1 = street("e1", "n2", "n1", ((200, 0), (0, 0)))
        out = self.build([e0, e1], ([(60, 0.5), (150, 0.5)], {**BRIDGE, "bridge:name": "Named Bridge"}))
        by_edge = {s["edge"]: s for s in out["spans"]}
        self.assertEqual(sorted(by_edge), ["e0", "e1"])
        self.assertLess(abs(by_edge["e0"]["from"] - 60), 3)
        self.assertLess(abs(by_edge["e0"]["to"] - 150), 3)
        self.assertLess(abs(by_edge["e1"]["from"] - 50), 3)
        self.assertEqual(by_edge["e0"]["name"], "Named Bridge")
        self.assertEqual(by_edge["e0"]["kind"], "yes")

    def test_a_street_under_the_bridge_is_not_on_it(self):
        # (an overpass crossing the street at right angles, and a footbridge along it)
        out = self.build([street()], ([(100, -80), (100, 80)], BRIDGE), ([(20, 0), (180, 0)], {"highway": "footway", "bridge": "yes"}))
        self.assertEqual(out["spans"], [])

    def test_too_short_and_rings_are_left_out(self):
        self.assertEqual(self.build([street()], ([(100, 0), (100 + MIN_SPAN_M - 3, 0)], BRIDGE))["spans"], [])
        self.assertEqual(self.build([street(ring=True)], ([(20, 0), (180, 0)], BRIDGE))["spans"], [])


class LayerTests(unittest.TestCase):
    def test_build_uses_the_raw_download_and_caches(self):
        with tempfile.TemporaryDirectory() as tmp:
            maps = Path(tmp)
            bbox = PRESET_BBOXES["saskatoon"]
            self.assertIsNone(build_bridges(bbox, maps, {"edges": []}))
            path = bridges_path(maps, bbox)
            self.assertTrue(path.name.endswith(".bridges.v1.json"))
            path.write_text(json.dumps({"bridges_version": "1", "spans": [{"edge": "e1"}]}))
            self.assertEqual(build_bridges(bbox, maps, {"edges": []})["spans"], [{"edge": "e1"}])
            self.assertEqual(load_bridges(bbox, maps)["spans"], [{"edge": "e1"}])

    def test_every_preset_has_a_committed_layer_on_its_pack(self):
        for name, bbox in PRESET_BBOXES.items():
            layer = load_bridges(bbox, MAPS_DIR)
            self.assertIsNotNone(layer, name)
            edges = {e["id"]: e for e in json.loads(pack_path(MAPS_DIR, bbox).read_text())["edges"]}
            for sp in layer["spans"]:
                self.assertIn(sp["edge"], edges, name)
                self.assertTrue(0 <= sp["from"] < sp["to"] <= edges[sp["edge"]]["length"] + 0.1, (name, sp))
        # (Saskatoon's Traffic Bridge, both ways, which the "Bridges freeze first" challenge crosses)
        sask = load_bridges(PRESET_BBOXES["saskatoon"], MAPS_DIR)
        self.assertEqual({s["edge"] for s in sask["spans"]} >= {"e572", "e573"}, True)


if __name__ == "__main__":
    unittest.main()
