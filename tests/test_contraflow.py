import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401
from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm.contraflow import build_contraflow, contraflow_from_osm, contraflow_path, load_contraflow, way_contraflow
from jev.osm.parse import OsmData
from jev.osm.pack import pack_path


class WayTagTests(unittest.TestCase):
    def test_shared_street(self):
        self.assertEqual(way_contraflow({"highway": "residential", "oneway": "yes", "oneway:bicycle": "no"})[:2], ("shared", "left"))
        self.assertEqual(way_contraflow({"oneway": "yes", "cycleway": "opposite"})[:2], ("shared", "left"))
        self.assertEqual(way_contraflow({"oneway": "yes", "bicycle:backward": "yes"})[:2], ("shared", "left"))

    def test_painted_lane_against_the_traffic(self):
        self.assertEqual(way_contraflow({"oneway": "yes", "cycleway:left": "lane", "cycleway:left:oneway": "-1"})[:2], ("lane", "left"))
        self.assertEqual(way_contraflow({"oneway": "yes", "cycleway:left": "opposite_lane"})[:2], ("lane", "left"))
        self.assertEqual(way_contraflow({"oneway": "yes", "cycleway": "opposite_lane"})[:2], ("lane", "left"))
        self.assertEqual(way_contraflow({"oneway": "yes", "cycleway:left": "track", "cycleway:left:oneway": "no"})[:2], ("track", "left"))
        # (a lane on a oneway=-1 way runs against the traffic when it runs the way's own way)
        self.assertEqual(way_contraflow({"oneway": "-1", "cycleway:right": "lane", "cycleway:right:oneway": "yes"})[:2], ("lane", "right"))

    def test_lanes_with_the_traffic_are_not_contraflow(self):
        self.assertIsNone(way_contraflow({"oneway": "yes", "cycleway:right": "lane"}))
        self.assertIsNone(way_contraflow({"oneway": "yes", "cycleway:left": "lane", "cycleway:left:oneway": "yes"}))
        self.assertIsNone(way_contraflow({"oneway": "yes"}))
        self.assertIsNone(way_contraflow({"oneway": "yes", "oneway:bicycle": "no", "bicycle": "no"}))
        self.assertIsNone(way_contraflow({"junction": "roundabout", "oneway:bicycle": "no"}))


class MappingTests(unittest.TestCase):
    def build(self, tags, forward=True, oneway=True, ring=False):
        osm = OsmData()
        osm.add_node(1, 45.52, -73.58)
        osm.add_node(2, 45.52, -73.579)
        osm.add_way(10, [1, 2], {"highway": "residential", "name": "Rue X", **tags})
        edge = {"id": "e0", "from": "n1" if forward else "n2", "to": "n2" if forward else "n1", "pts": [[0, 0], [78, 0]] if forward else [[78, 0], [0, 0]],
                "length": 78, "lanes": 1, "oneway": oneway, "name": "Rue X", **({"ring": True} if ring else {})}
        return contraflow_from_osm(osm, {"origin": {"lat": 45.52, "lon": -73.58}, "edges": [edge], "name": "test"})["edges"]

    def test_one_way_edge(self):
        out = self.build({"oneway": "yes", "cycleway:left": "lane", "cycleway:left:oneway": "-1"})
        self.assertEqual([(e["edge"], e["kind"], e["side"], e["way"]) for e in out], [("e0", "lane", "left", 10)])

    def test_reverse_one_way_keeps_the_drivers_left(self):
        out = self.build({"oneway": "-1", "oneway:bicycle": "no"}, forward=False)
        self.assertEqual([(e["kind"], e["side"]) for e in out], [("shared", "left")])

    def test_two_way_edges_and_rings_are_left_alone(self):
        self.assertEqual(self.build({"oneway:bicycle": "no"}, oneway=False), [])
        self.assertEqual(self.build({"oneway": "yes", "oneway:bicycle": "no"}, ring=True), [])

    def test_split_way_matched_by_its_centreline(self):
        osm = OsmData()
        osm.add_node(1, 45.52, -73.58)
        osm.add_node(3, 45.52, -73.578)
        osm.add_way(11, [1, 3], {"highway": "residential", "name": "Rue X", "oneway": "yes", "oneway:bicycle": "no"})
        edge = {"id": "e7", "from": "n5", "to": "n6", "pts": [[1, 0], [77, 0]], "length": 76, "lanes": 1, "oneway": True, "name": "Rue X"}
        out = contraflow_from_osm(osm, {"origin": {"lat": 45.52, "lon": -73.58}, "edges": [edge]})["edges"]
        self.assertEqual([e["edge"] for e in out], ["e7"])


class LayerTests(unittest.TestCase):
    def test_build_uses_the_raw_download_and_caches(self):
        with tempfile.TemporaryDirectory() as tmp:
            maps = Path(tmp)
            bbox = (-73.59, 45.516, -73.574, 45.528)
            self.assertIsNone(build_contraflow(bbox, maps, {"edges": []}))
            path = contraflow_path(maps, bbox)
            path.write_text(json.dumps({"contraflow_version": "1", "edges": [{"edge": "e1"}]}))
            self.assertEqual(build_contraflow(bbox, maps, {"edges": []})["edges"], [{"edge": "e1"}])
            self.assertEqual(load_contraflow(bbox, maps)["edges"], [{"edge": "e1"}])

    def test_bundled_layers_match_their_packs(self):
        for name, bbox in PRESET_BBOXES.items():
            layer = load_contraflow(bbox, MAPS_DIR)
            self.assertIsNotNone(layer, name)
            pack = json.loads(pack_path(MAPS_DIR, bbox).read_text())
            edges = {e["id"]: e for e in pack["edges"]}
            for c in layer["edges"]:
                self.assertTrue(edges[c["edge"]]["oneway"], (name, c["edge"]))
                self.assertIn(c["kind"], ("lane", "track", "shared"))
                self.assertIn(c["side"], ("left", "right"))
        montreal = load_contraflow(PRESET_BBOXES["montreal"], MAPS_DIR)
        self.assertGreater(len(montreal["edges"]), 20)


if __name__ == "__main__":
    unittest.main()
