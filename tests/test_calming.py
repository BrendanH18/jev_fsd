import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (puts the project on the path)

from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm import fetch
from jev.osm.calming import (KINDS, build_calming, calming_from_osm, calming_path, kind_of, load_calming)
from jev.osm.pack import pack_from_osm, pack_path
from test_crossings import avenue

HUMP = {"traffic_calming": "hump"}


def write_osm(osm, path: Path):
    lines = ['<?xml version="1.0"?><osm>']
    for nid, (lat, lon, tags) in osm.nodes.items():
        lines.append('<node id="%d" lat="%.8f" lon="%.8f">%s</node>' % (nid, lat, lon, "".join('<tag k="%s" v="%s"/>' % kv for kv in tags.items())))
    for w in osm.ways:
        lines.append('<way id="%d">%s%s</way>' % (w["id"], "".join('<nd ref="%d"/>' % n for n in w["nodes"]), "".join('<tag k="%s" v="%s"/>' % kv for kv in w["tags"].items())))
    lines.append("</osm>")
    path.write_text("".join(lines))


class CalmingTests(unittest.TestCase):
    def test_a_hump_lies_across_both_edges_of_its_two_way_street(self):
        osm, bbox = avenue([(40, -150, HUMP)])
        pack = pack_from_osm(osm, bbox)
        out = calming_from_osm(osm, pack)
        self.assertEqual(len(out["devices"]), 1)
        d = out["devices"][0]
        self.assertEqual((d["id"], d["kind"]), ("c40", "hump"))
        self.assertAlmostEqual(d["x"], -150, delta=0.1)
        edges = {e["id"]: e for e in pack["edges"]}
        self.assertEqual(len(d["at"]), 2)
        for a in d["at"]:
            e = edges[a["edge"]]
            self.assertEqual({e["from"], e["to"]}, {"n1", "n3"})
            self.assertAlmostEqual(a["s"], 150, delta=0.5)

    def test_kinds_and_what_is_left_out(self):
        self.assertEqual(kind_of({"traffic_calming": "table"}), "table")
        self.assertEqual(kind_of({"traffic_calming": "choker;hump"}), "hump")
        self.assertIsNone(kind_of({"traffic_calming": "island"}))
        self.assertIsNone(kind_of({"traffic_calming": "yes"}))
        self.assertEqual(set(KINDS), {"hump", "table", "cushion", "bump"})
        osm, bbox = avenue([(41, -200, {"traffic_calming": "island"}), (42, -100, {"traffic_calming": "cushion"}),
                            (43, 100, {"traffic_calming": "table", "highway": "crossing"}), (44, 200, {"traffic_calming": "yes"})])
        out = calming_from_osm(osm, pack_from_osm(osm, bbox))
        self.assertEqual([(d["id"], d["kind"]) for d in out["devices"]], [("c42", "cushion"), ("c43", "table")])
        self.assertTrue(out["devices"][1]["crossing"])
        self.assertNotIn("crossing", out["devices"][0])

    def test_a_hump_mapped_once_a_lane_is_one(self):
        osm, bbox = avenue([(45, -150, HUMP), (46, -147, HUMP)])
        self.assertEqual(len(calming_from_osm(osm, pack_from_osm(osm, bbox))["devices"]), 1)

    def test_built_beside_the_pack_from_the_cached_download_only(self):
        osm, bbox = avenue([(40, -150, HUMP)])
        pack = pack_from_osm(osm, bbox)
        with tempfile.TemporaryDirectory() as directory:
            maps = Path(directory)
            self.assertIsNone(build_calming(bbox, maps, pack))
            self.assertFalse(calming_path(maps, bbox).exists())
            write_osm(osm, fetch.cache_path(maps, bbox))
            built = build_calming(bbox, maps, pack)
            self.assertEqual(len(built["devices"]), 1)
            self.assertEqual(load_calming(bbox, maps), built)
            self.assertEqual(json.loads(calming_path(maps, bbox).read_text())["calming_version"], "1")

    def test_every_bundled_map_has_its_devices_on_its_own_edges(self):
        total = 0
        for name, bbox in PRESET_BBOXES.items():
            with self.subTest(name=name):
                calming = load_calming(bbox, MAPS_DIR)
                self.assertIsNotNone(calming)
                pack = json.loads(pack_path(MAPS_DIR, bbox).read_text())
                edges = {e["id"]: e for e in pack["edges"]}
                for d in calming["devices"]:
                    self.assertIn(d["kind"], KINDS)
                    for a in d["at"]:
                        self.assertIn(a["edge"], edges)
                        self.assertTrue(0 <= a["s"] <= edges[a["edge"]]["length"])
                total += len(calming["devices"])
        self.assertGreater(total, 100)
        ottawa = load_calming(PRESET_BBOXES["ottawa"], MAPS_DIR)
        on = {a["edge"] for d in ottawa["devices"] for a in d["at"]}
        self.assertTrue({"e491", "e492"} <= on, "Gloucester Street's, for the challenge")


if __name__ == "__main__":
    unittest.main()
