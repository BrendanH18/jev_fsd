import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (puts the project on the path)

from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm import fetch
from jev.osm.crossings import (JUNCTION_M, build_crossings, crossings_from_osm, crossings_path, load_crossings,
                               markings)
from jev.osm.pack import pack_from_osm, pack_path
from jev.osm.parse import OsmData
from jev.osm.project import Projection

LAT0, LON0 = 49.0, -123.0


def avenue(crossings=()):
    """An east-west two-way avenue 600 m long, in two ways meeting at x = 0, crossed there and at
    each end by side streets; `crossings` are (osm id, x, tags) nodes on the avenue."""
    proj = Projection(LAT0, LON0)
    osm = OsmData()

    def node(nid, x, y, tags=None):
        lat, lon = proj.to_latlon(x, y)
        osm.add_node(nid, lat, lon, tags or {})

    for nid, x in ((1, -300), (3, 0), (5, 300)):
        node(nid, x, 0)
        node(100 + nid, x, 100)
        node(200 + nid, x, -100)
    west, east = [1], [5]
    for osm_id, x, tags in sorted(crossings, key=lambda c: c[1]):
        node(osm_id, x, 0, tags)
        (west if x < 0 else east).append(osm_id)
    west = [1] + sorted(west[1:], key=lambda n: osm.nodes[n][1]) + [3]
    east = [5] + sorted(east[1:], key=lambda n: -osm.nodes[n][1]) + [3]
    tags = {"highway": "secondary", "name": "Main Ave", "maxspeed": "50", "lanes": "4"}
    osm.add_way(10, west, tags)
    osm.add_way(11, east, tags)
    for nid in (1, 3, 5):
        osm.add_way(20 + nid, [200 + nid, nid, 100 + nid], {"highway": "residential", "name": "Side %d" % nid})
    s, w = proj.to_latlon(-320, -120)
    n, e = proj.to_latlon(320, 120)
    return osm, (w, s, e, n)


ZEBRA = {"highway": "crossing", "crossing": "uncontrolled", "crossing:markings": "zebra"}


class CrossingTests(unittest.TestCase):
    def test_a_marked_crossing_mid_block_is_placed_along_its_street(self):
        osm, bbox = avenue([(40, -150, ZEBRA)])
        pack = pack_from_osm(osm, bbox)
        out = crossings_from_osm(osm, pack)
        self.assertEqual(len(out["crossings"]), 1)
        c = out["crossings"][0]
        self.assertEqual((c["id"], c["markings"], c["island"]), ("x40", "zebra", False))
        self.assertAlmostEqual(c["x"], -150, delta=0.1)
        self.assertAlmostEqual(c["y"], 0, delta=0.1)
        e = {x["id"]: x for x in pack["edges"]}[c["edge"]]
        self.assertEqual({e["from"], e["to"]}, {"n1", "n3"})
        self.assertAlmostEqual(c["s"], 150, delta=0.5)

    def test_unmarked_signalled_and_junction_crossings_are_left_out(self):
        osm, bbox = avenue([
            (41, -200, {"highway": "crossing", "crossing": "unmarked"}),
            (42, -100, {"highway": "crossing", "crossing": "traffic_signals"}),
            (43, 100, {"highway": "crossing", "crossing": "marked", "crossing:markings": "no"}),
            (44, JUNCTION_M - 4, ZEBRA),
            (45, 200, {"highway": "crossing", "crossing": "uncontrolled", "crossing:island": "yes"}),
        ])
        out = crossings_from_osm(osm, pack_from_osm(osm, bbox))
        self.assertEqual([c["id"] for c in out["crossings"]], ["x45"])
        self.assertTrue(out["crossings"][0]["island"])
        self.assertEqual(out["crossings"][0]["markings"], "zebra")

    def test_markings_are_painted_as_bars_or_lines(self):
        self.assertEqual(markings({"crossing": "zebra"}), "zebra")
        self.assertEqual(markings({"crossing": "uncontrolled", "crossing:markings": "ladder"}), "zebra")
        self.assertEqual(markings({"crossing": "uncontrolled", "crossing:markings": "lines"}), "lines")
        self.assertEqual(markings({"crossing": "uncontrolled", "crossing:markings": "dots"}), "lines")
        self.assertEqual(markings({"crossing:markings": "zebra;dots"}), "zebra")
        self.assertIsNone(markings({"crossing": "uncontrolled", "crossing:signals": "yes"}))
        self.assertIsNone(markings({"highway": "crossing"}))

    def test_a_second_crossing_close_by_on_the_same_street_is_one(self):
        osm, bbox = avenue([(46, -150, ZEBRA), (47, -145, ZEBRA)])
        out = crossings_from_osm(osm, pack_from_osm(osm, bbox))
        self.assertEqual(len(out["crossings"]), 1)

    def test_built_beside_the_pack_from_the_cached_download_only(self):
        osm, bbox = avenue([(40, -150, ZEBRA)])
        pack = pack_from_osm(osm, bbox)
        with tempfile.TemporaryDirectory() as directory:
            maps = Path(directory)
            self.assertIsNone(build_crossings(bbox, maps, pack))
            self.assertFalse(crossings_path(maps, bbox).exists())
            lines = ['<?xml version="1.0"?><osm>']
            for nid, (lat, lon, tags) in osm.nodes.items():
                lines.append('<node id="%d" lat="%.8f" lon="%.8f">%s</node>' % (nid, lat, lon, "".join('<tag k="%s" v="%s"/>' % kv for kv in tags.items())))
            for w in osm.ways:
                lines.append('<way id="%d">%s%s</way>' % (w["id"], "".join('<nd ref="%d"/>' % n for n in w["nodes"]), "".join('<tag k="%s" v="%s"/>' % kv for kv in w["tags"].items())))
            lines.append("</osm>")
            fetch.cache_path(maps, bbox).write_text("".join(lines))
            built = build_crossings(bbox, maps, pack)
            self.assertEqual(len(built["crossings"]), 1)
            self.assertEqual(load_crossings(bbox, maps), built)
            self.assertEqual(json.loads(crossings_path(maps, bbox).read_text())["crossings_version"], "1")

    def test_every_bundled_map_has_its_crossings_on_its_own_edges(self):
        total = 0
        for name, bbox in PRESET_BBOXES.items():
            with self.subTest(name=name):
                crossings = load_crossings(bbox, MAPS_DIR)
                self.assertIsNotNone(crossings)
                pack = json.loads(pack_path(MAPS_DIR, bbox).read_text())
                edges = {e["id"]: e for e in pack["edges"]}
                for c in crossings["crossings"]:
                    self.assertIn(c["edge"], edges)
                    self.assertTrue(0 <= c["s"] <= edges[c["edge"]]["length"])
                    self.assertIn(c["markings"], ("zebra", "lines"))
                total += len(crossings["crossings"])
        self.assertGreater(total, 50)
        kits = load_crossings(PRESET_BBOXES["kitsilano"], MAPS_DIR)
        self.assertTrue(any(c["id"] == "x4842686858" for c in kits["crossings"]), "West Broadway's, for the challenge")

    def test_demo_bundles_crossings_with_each_map(self):
        from scripts import build_demo
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            with contextlib.redirect_stdout(io.StringIO()):
                build_demo.build(output)
            kits = json.loads((output / "demo-data/kitsilano.json").read_text())
            self.assertIn("crossings", kits)
            self.assertGreater(len(kits["crossings"]["crossings"]), 5)


if __name__ == "__main__":
    unittest.main()
