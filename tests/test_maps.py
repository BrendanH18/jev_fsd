import json
import math
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server
from jev import geometry as g
from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.drives import suggested_drives
from jev.maps import MAP_CATALOG, catalog, map_identity
from jev.osm.pack import build_pack, pack_path, synthetic_pack
from jev.routing import Router


class CanadianMapsTests(unittest.TestCase):
    def test_all_catalog_maps_are_bundled_and_identifiable(self):
        entries = catalog(MAPS_DIR)
        self.assertEqual(len(entries), len(MAP_CATALOG))
        self.assertEqual({m["id"] for m in entries}, set(PRESET_BBOXES))
        self.assertGreaterEqual(len({m["province"] for m in entries}), 4)
        for item in entries:
            with self.subTest(map=item["id"]):
                self.assertTrue(item["cached"])
                self.assertGreater(item["stats"]["roads"], 100)
                self.assertGreater(item["stats"]["signals"], 0)
                self.assertGreater(item["stats"]["buildings"], 100)
                self.assertTrue(item["preview"])
                self.assertEqual(map_identity(tuple(item["bbox"]))["id"], item["id"])
                pack = build_pack(tuple(item["bbox"]), MAPS_DIR)
                self.assertFalse(pack.get("synthetic", False))
                self.assertEqual(pack["bbox"], item["bbox"])

    def test_each_city_offers_three_distinct_drivable_routes(self):
        for item in MAP_CATALOG:
            with self.subTest(map=item["id"]):
                bbox = PRESET_BBOXES[item["id"]]
                self.assertTrue(pack_path(MAPS_DIR, bbox).is_file())
                pack = build_pack(bbox, MAPS_DIR)
                router = Router(pack)
                lane = next(l for l in router.lanes.values() if l["length"] > 70)
                point = g.point_at(lane["pts"], lane["length"] / 2, lane["cum"])
                start = dict(x=point[0], y=point[1], heading=g.heading_of(lane["pts"][0], lane["pts"][1]))
                drives = suggested_drives(router, start)
                self.assertEqual(len(drives), 3)
                self.assertEqual(len({tuple(d["destination"]) for d in drives}), 3)
                for d in drives:
                    self.assertGreater(d["length_m"], 250)
                    self.assertLess(d["length_m"], 1900)
                    self.assertLess(g.dist(point, d["route"]["polyline"][0]), 10)
                    for a, b in zip(d["route"]["edges"], d["route"]["edges"][1:]):
                        self.assertEqual(router.edges[a]["to"], router.edges[b]["from"])

    def test_suggested_routes_are_reachable_across_each_neighbourhood(self):
        for item in MAP_CATALOG:
            pack = build_pack(PRESET_BBOXES[item["id"]], MAPS_DIR)
            router = Router(pack)
            x0, y0, x1, y1 = pack["extent"]
            lanes = []
            for lane in router.lanes.values():
                if lane["length"] < 70:
                    continue
                x, y = g.point_at(lane["pts"], lane["length"] / 2, lane["cum"])
                if x0 + 100 < x < x1 - 100 and y0 + 100 < y < y1 - 100:
                    lanes.append(lane)
            self.assertGreater(len(lanes), 10, item["id"])
            for index in (0, len(lanes) // 2, len(lanes) - 1):
                with self.subTest(map=item["id"], start=index):
                    lane = lanes[index]
                    point = g.point_at(lane["pts"], lane["length"] / 2, lane["cum"])
                    start = dict(x=point[0], y=point[1], heading=g.heading_of(lane["pts"][0], lane["pts"][1]))
                    drives = suggested_drives(router, start)
                    self.assertEqual(len(drives), 3)
                    for drive in drives:
                        self.assertLess(g.dist(point, drive["route"]["polyline"][0]), 10)
                        self.assertGreater(drive["length_m"], 250)
                        self.assertLess(drive["length_m"], 1900)
                        for a, b in zip(drive["route"]["edges"], drive["route"]["edges"][1:]):
                            self.assertEqual(router.edges[a]["to"], router.edges[b]["from"])

    def test_selected_city_status_and_map_use_the_same_bbox(self):
        for name in (item["id"] for item in MAP_CATALOG):
            with self.subTest(map=name):
                status = server.api_status(None, {"map": [name]})
                pack = server.api_map(None, {"map": [name]})
                self.assertEqual(status["map"]["id"], name)
                self.assertFalse(status["map"]["synthetic"])
                self.assertEqual(pack["bbox"], list(PRESET_BBOXES[name]))
                self.assertEqual(pack["routing_bbox"], status["map"]["bbox"])

    def test_route_api_uses_selected_city_graph(self):
        entry = server.load_map("victoria")
        router = entry["router"]
        lane = next(l for l in router.lanes.values() if l["length"] > 70)
        p = g.point_at(lane["pts"], lane["length"] / 3, lane["cum"])
        q = g.point_at(lane["pts"], lane["length"] * 0.8, lane["cum"])
        result = server.api_route(
            {
                "bbox": "victoria",
                "from": {"x": p[0], "y": p[1], "heading": g.heading_of(lane["pts"][0], lane["pts"][1])},
                "to": {"x": q[0], "y": q[1]},
            },
            {},
        )
        self.assertTrue(result["routes"])
        self.assertTrue(all(e in router.edges for e in result["routes"][0]["edges"]))

    def test_route_api_avoids_listed_edges(self):
        # (static/js/sim/road-closures.js: a re-plan round a block closed for an event)
        entry = server.load_map("victoria")
        router = entry["router"]
        lane = next(l for l in router.lanes.values() if l["length"] > 70)
        p = g.point_at(lane["pts"], lane["length"] / 3, lane["cum"])
        start = {"x": p[0], "y": p[1], "heading": g.heading_of(lane["pts"][0], lane["pts"][1])}
        far = next(
            l
            for l in router.lanes.values()
            if l["edge"] != lane["edge"] and g.dist(l["pts"][0], p) > 300 and l["length"] > 50
        )
        q = g.point_at(far["pts"], far["length"] / 2, far["cum"])
        plain = server.api_route({"bbox": "victoria", "from": start, "to": {"x": q[0], "y": q[1]}}, {})["routes"][0]
        self.assertEqual(
            server.api_route({"bbox": "victoria", "from": start, "to": {"x": q[0], "y": q[1]}, "avoid": []}, {})[
                "routes"
            ][0],
            plain,
        )
        closed = plain["edges"][1]
        result = server.api_route(
            {"bbox": "victoria", "from": start, "to": {"x": q[0], "y": q[1]}, "avoid": [closed]}, {}
        )
        self.assertTrue(result["routes"])
        self.assertNotIn(closed, result["routes"][0]["edges"])
        for bad in ("e1", [1, 2], ["x" * 65]):
            with self.assertRaises(server.BadRequest):
                server.api_route({"bbox": "victoria", "from": start, "to": {"x": q[0], "y": q[1]}, "avoid": bad}, {})

    def test_failed_map_retains_requested_routing_key(self):
        pack = synthetic_pack()
        entry = {"pack": pack, "bbox": PRESET_BBOXES["victoria"], "error": "offline"}
        with patch.object(server, "load_map", return_value=entry):
            result = server.api_map(None, {"map": ["victoria"]})
        self.assertTrue(result["synthetic"])
        self.assertEqual(result["routing_bbox"], list(PRESET_BBOXES["victoria"]))
        self.assertNotIn("routing_bbox", pack)

    def test_invalid_drive_coordinates_are_rejected(self):
        for value in (math.inf, math.nan, "invalid"):
            with self.subTest(value=value), self.assertRaises(server.BadRequest):
                server.api_drives({"bbox": "victoria", "from": {"x": value, "y": 0, "heading": 0}}, {})

    def test_no_reachable_start_returns_no_fake_missions(self):
        router = Router(synthetic_pack())
        self.assertEqual(suggested_drives(router, {"x": 1e6, "y": 1e6, "heading": 0}), [])


class CatalogPreviewTests(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.maps = Path(work.name)
        self.path = pack_path(self.maps, PRESET_BBOXES["kitsilano"])

    def entry(self):
        return next(item for item in catalog(self.maps) if item["id"] == "kitsilano")

    def test_broken_pack_does_not_hide_other_catalog_entries(self):
        self.path.write_text("{")
        other = pack_path(self.maps, PRESET_BBOXES["victoria"])
        other.write_text(json.dumps(synthetic_pack()))
        entries = {item["id"]: item for item in catalog(self.maps)}
        self.assertFalse(entries["kitsilano"]["cached"])
        self.assertEqual(entries["kitsilano"]["preview"], [])
        self.assertTrue(entries["victoria"]["cached"])

    def test_wrong_pack_version_is_uncached(self):
        self.path.write_text(json.dumps({**synthetic_pack(), "pack_version": "5"}))
        self.assertFalse(self.entry()["cached"])

    def test_atomic_replacement_updates_cached_preview_with_old_size_and_mtime(self):
        pack = synthetic_pack()
        pack["edges"][0]["pts"] = [[1, 2], [3, 4]]
        self.path.write_text(json.dumps(pack))
        original = self.path.stat()
        previous = self.entry()["preview"][0]["pts"]
        replacement = self.maps / "replacement"
        pack["edges"][0]["pts"][0][0] = 8
        replacement.write_text(json.dumps(pack))
        self.assertEqual(replacement.stat().st_size, original.st_size)
        os.utime(replacement, ns=(original.st_atime_ns, original.st_mtime_ns))
        replacement.replace(self.path)
        self.assertEqual(self.path.stat().st_mtime_ns, original.st_mtime_ns)
        self.assertNotEqual(self.entry()["preview"][0]["pts"], previous)

    def test_preview_keeps_parallel_roads_but_draws_reverse_twins_once(self):
        first = {"from": "a", "to": "b", "pts": [[0, 0], [5, 0], [10, 0]], "cls": "residential"}
        reverse = {**first, "from": "b", "to": "a", "pts": first["pts"][::-1]}
        parallel = {**first, "pts": [[0, 0], [5, 4], [10, 0]], "cls": "primary"}
        pack = {**synthetic_pack(), "edges": [first, reverse, parallel]}
        self.path.write_text(json.dumps(pack))
        self.assertEqual(
            self.entry()["preview"],
            [{"pts": first["pts"], "major": False}, {"pts": parallel["pts"], "major": True}],
        )

    def test_non_regular_path_cannot_be_used_as_metadata(self):
        self.path.mkdir()
        self.assertFalse(self.entry()["cached"])

    def test_catalog_stats_are_safe_to_edit_in_the_caller(self):
        self.path.write_text(json.dumps(synthetic_pack()))
        stats = self.entry()["stats"]
        stats["roads"] = -1
        self.assertGreater(self.entry()["stats"]["roads"], 0)


if __name__ == "__main__":
    unittest.main()
