import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (puts the project on the path)

from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm import fetch
from jev.osm.pack import pack_from_osm, pack_path
from jev.osm.project import Projection
from jev.osm.scrambles import (build_scrambles, load_scrambles, says_scramble, scrambles_from_osm, scrambles_path)
from test_calming import write_osm
from test_crossings import LAT0, LON0, avenue


def signalled(extra_nodes=(), extra_ways=()):
    """The test avenue with a signal where the middle side street crosses it (x = 0), plus nodes
    (id, x, y, tags) and ways (id, [node ids], tags)."""
    osm, bbox = avenue()
    lat, lon, tags = osm.nodes[3]
    osm.nodes[3] = (lat, lon, {"highway": "traffic_signals"})
    proj = Projection(LAT0, LON0)
    for nid, x, y, tags in extra_nodes:
        la, lo = proj.to_latlon(x, y)
        osm.add_node(nid, la, lo, tags)
    for wid, nodes, tags in extra_ways:
        osm.add_way(wid, nodes, tags)
    return osm, bbox


class ScrambleTests(unittest.TestCase):
    def test_a_crossing_noted_as_a_scramble_makes_its_signal_one(self):
        osm, bbox = signalled([(60, 8, 8, {"highway": "crossing", "crossing": "traffic_signals",
                                            "note": "This is a scramble crossing, where foot traffic can cross in any direction"})])
        pack = pack_from_osm(osm, bbox)
        self.assertEqual(len(pack["intersections"]), 1)
        out = scrambles_from_osm(osm, pack)
        self.assertEqual([(s["signal"], s["source"]) for s in out["scrambles"]], [(pack["intersections"][0]["id"], "tagged")])

    def test_a_diagonal_crossing_footway_makes_it_one_and_a_square_one_does_not(self):
        square = [(70, -9, 9, {}), (71, 9, 9, {})]
        osm, bbox = signalled(square, [(80, [70, 71], {"highway": "footway", "footway": "crossing"})])
        self.assertEqual(scrambles_from_osm(osm, pack_from_osm(osm, bbox))["scrambles"], [])
        diagonal = [(72, -9, -9, {}), (73, 9, 9, {})]
        osm, bbox = signalled(diagonal, [(81, [72, 73], {"highway": "footway", "footway": "crossing"})])
        out = scrambles_from_osm(osm, pack_from_osm(osm, bbox))
        self.assertEqual([s["source"] for s in out["scrambles"]], ["diagonal"])

    def test_tags_that_say_scramble(self):
        self.assertTrue(says_scramble({"crossing:scramble": "yes"}))
        self.assertTrue(says_scramble({"crossing": "scramble"}))
        self.assertTrue(says_scramble({"highway": "crossing", "note": "All-way walk phase"}))
        self.assertFalse(says_scramble({"highway": "crossing", "note": "Watch for cyclists"}))
        self.assertFalse(says_scramble({"amenity": "cafe", "note": "scramble"}))

    def test_built_beside_the_pack_from_the_cached_download_only(self):
        osm, bbox = signalled([(60, 8, 8, {"highway": "crossing", "crossing:scramble": "yes"})])
        pack = pack_from_osm(osm, bbox)
        with tempfile.TemporaryDirectory() as directory:
            maps = Path(directory)
            self.assertIsNone(build_scrambles(bbox, maps, pack))
            self.assertFalse(scrambles_path(maps, bbox).exists())
            write_osm(osm, fetch.cache_path(maps, bbox))
            built = build_scrambles(bbox, maps, pack)
            self.assertEqual(len(built["scrambles"]), 1)
            self.assertEqual(load_scrambles(bbox, maps), built)
            self.assertEqual(json.loads(scrambles_path(maps, bbox).read_text())["scrambles_version"], "1")

    def test_every_bundled_map_has_its_file_and_victoria_its_scramble_by_the_empress(self):
        for name, bbox in PRESET_BBOXES.items():
            with self.subTest(name=name):
                scrambles = load_scrambles(bbox, MAPS_DIR)
                self.assertIsNotNone(scrambles)
                pack = json.loads(pack_path(MAPS_DIR, bbox).read_text())
                ids = {i["id"] for i in pack["intersections"]}
                for s in scrambles["scrambles"]:
                    self.assertIn(s["signal"], ids)
        victoria = load_scrambles(PRESET_BBOXES["victoria"], MAPS_DIR)
        self.assertEqual([s["signal"] for s in victoria["scrambles"]], ["sig32"])


if __name__ == "__main__":
    unittest.main()
