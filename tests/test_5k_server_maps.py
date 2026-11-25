"""Map API validation, offline cache lifecycle and route suggestion checks."""

from __future__ import annotations

import json
import math
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import helpers  # noqa: F401

import server
from jev import drives, maps
from jev.config import PRESET_BBOXES
from jev.osm import fetch
from jev.osm.pack import synthetic_pack

POSITION = {"x": 4.5, "y": 8.0, "heading": 0.2}
ROUTE = {"from": POSITION, "to": {"x": 20, "y": 45}}


class MapApiTests(unittest.TestCase):
    def test_invalid_query_map_is_rejected_before_loading(self):
        for endpoint in (server.api_map, server.api_status):
            with (
                self.subTest(endpoint=endpoint.__name__),
                patch.object(server, "load_map") as load,
                self.assertRaisesRegex(server.BadRequest, "map preset"),
            ):
                endpoint({}, {"map": ["kitislano"]})
            load.assert_not_called()

    def test_invalid_post_map_is_rejected_before_loading(self):
        for endpoint in (server.api_route, server.api_drives):
            for selector in ([], 0, False, {"name": "kitsilano"}, "2,2,1,1"):
                with (
                    self.subTest(endpoint=endpoint.__name__, selector=selector),
                    patch.object(server, "load_map") as load,
                    self.assertRaisesRegex(server.BadRequest, "map preset"),
                ):
                    endpoint(dict(ROUTE, bbox=selector), {})
                load.assert_not_called()

    def test_omitted_and_explicit_empty_bbox_select_default(self):
        router = Mock()
        for bbox in ({}, {"bbox": ""}, {"bbox": None}):
            with (
                self.subTest(bbox=bbox),
                patch.object(server, "load_map", return_value={"router": router}) as load,
            ):
                server.api_route(dict(ROUTE, **bbox), {})
            load.assert_called_once_with("")

    def test_bbox_query_has_precedence_over_map_alias(self):
        with patch.object(server, "load_map", return_value={"bbox": PRESET_BBOXES["victoria"], "pack": {}}) as load:
            self.assertEqual(
                server.api_map({}, {"bbox": ["victoria"], "map": ["kitsilano"]})["routing_bbox"],
                list(PRESET_BBOXES["victoria"]),
            )
        load.assert_called_once_with("victoria")

    def test_bbox_query_cannot_select_multiple_maps(self):
        with patch.object(server, "load_map") as load, self.assertRaisesRegex(server.BadRequest, "one bbox"):
            server.api_map({}, {"bbox": ["victoria", "ottawa"]})
        load.assert_not_called()

    def test_route_restriction_time_must_be_a_local_hour(self):
        for hour in (-0.1, 24, 1e100):
            with self.subTest(hour=hour), self.assertRaisesRegex(server.BadRequest, "hour must be from"):
                server.api_route(dict(ROUTE, hour=hour), {})

    def test_route_restriction_day_uses_weekday_indices(self):
        for weekday in (-1, 7, 10**30):
            with self.subTest(weekday=weekday), self.assertRaisesRegex(server.BadRequest, "weekday must be from"):
                server.api_route(dict(ROUTE, weekday=weekday), {})

    def test_route_avoid_only_accepts_non_empty_edge_ids(self):
        for name in ("", " ", " edge", "edge ", "edge\nextra"):
            with self.subTest(name=name), self.assertRaisesRegex(server.BadRequest, "avoid"):
                server.api_route(dict(ROUTE, avoid=[name]), {})

    def test_route_wraps_extreme_heading_before_calling_router(self):
        router = Mock(routes=Mock(return_value=[]))
        pose = dict(POSITION, heading=1e300)
        with patch.object(server, "load_map", return_value={"router": router}):
            server.api_route(dict(ROUTE, **{"from": pose}), {})
        start = router.routes.call_args.args[0]
        self.assertEqual(start["heading"], math.remainder(pose["heading"], math.tau))

    def test_drive_search_wraps_extreme_negative_heading(self):
        pose = dict(POSITION, heading=-1e300)
        with (
            patch.object(server, "load_map", return_value={"router": object()}),
            patch.object(server, "suggested_drives", return_value=[]) as search,
        ):
            self.assertEqual(server.api_drives({"from": pose}, {}), {"drives": []})
        self.assertEqual(search.call_args.args[1]["heading"], math.remainder(pose["heading"], math.tau))

    def test_normal_route_heading_is_passed_through_unchanged(self):
        router = Mock(routes=Mock(return_value=[]))
        with patch.object(server, "load_map", return_value={"router": router}):
            server.api_route(ROUTE, {})
        self.assertEqual(router.routes.call_args.args[0], POSITION)

    def test_route_allows_numeric_text_and_absent_start_heading(self):
        router = Mock(routes=Mock(return_value=[]))
        body = {"from": {"x": "4.5", "y": "8"}, "to": {"x": "20", "y": "45"}, "hour": "15.75", "weekday": "2"}
        with patch.object(server, "load_map", return_value={"router": router}):
            answer = server.api_route(body, {})
        self.assertEqual(answer["routes"], [])
        start, goal = router.routes.call_args.args
        self.assertEqual(start, {"x": 4.5, "y": 8, "heading": None})
        self.assertEqual(goal, ROUTE["to"])
        self.assertEqual(
            (router.routes.call_args.kwargs["hour"], router.routes.call_args.kwargs["weekday"]), (15.75, 2)
        )

    def test_route_count_stays_bounded_while_legacy_integer_strings_are_accepted(self):
        router = Mock(routes=Mock(return_value=[]))
        with patch.object(server, "load_map", return_value={"router": router}):
            for value, count in ((None, 1), ("2", 2), (100, 3), (-1, 1), (3.0, 3)):
                with self.subTest(value=value):
                    server.api_route(dict(ROUTE, k=value), {})
                    self.assertEqual(router.routes.call_args.kwargs["k"], count)

    def test_route_hour_and_weekday_defaults_are_passed_to_router(self):
        router = Mock(routes=Mock(return_value=[]))
        with patch.object(server, "load_map", return_value={"router": router}):
            server.api_route(ROUTE, {})
        self.assertEqual(
            router.routes.call_args.kwargs, {"k": 1, "hour": 15.5, "weekday": 0, "restrictions": False, "avoid": []}
        )

    def test_route_time_accepts_midnight_and_sunday(self):
        router = Mock(routes=Mock(return_value=[]))
        with patch.object(server, "load_map", return_value={"router": router}):
            server.api_route(dict(ROUTE, hour=0, weekday=6, restrictions=True), {})
        self.assertEqual((router.routes.call_args.kwargs["hour"], router.routes.call_args.kwargs["weekday"]), (0, 6))

    def test_route_avoid_preserves_valid_edge_order_for_router(self):
        router = Mock(routes=Mock(return_value=[]))
        avoid = ["ed:central", "road-20", "road-10"]
        with patch.object(server, "load_map", return_value={"router": router}):
            server.api_route(dict(ROUTE, avoid=avoid), {})
        self.assertEqual(router.routes.call_args.kwargs["avoid"], avoid)

    def test_drives_retains_exact_start_and_recommendation_order(self):
        router = object()
        recommended = [{"id": "junctions"}, {"id": "tour"}]
        with (
            patch.object(server, "load_map", return_value={"router": router}),
            patch.object(server, "suggested_drives", return_value=recommended) as suggest,
        ):
            self.assertEqual(server.api_drives({"from": POSITION}, {}), {"drives": recommended})
        suggest.assert_called_once_with(router, POSITION)


class MapCacheTests(unittest.TestCase):
    def setUp(self):
        self.entries = {}
        self.locks = {}
        self.enterContext(patch.multiple(server, _maps=self.entries, _map_locks=self.locks))

    def test_completed_map_load_releases_the_per_key_lock(self):
        empty = {"pack": {}, "router": None, "error": None}
        with patch.object(server, "_build_map", return_value=empty) as build:
            self.assertIs(server.load_map("kitsilano"), empty)
            self.assertIs(server.load_map("KITSILANO"), empty)
            build.assert_called_once()
        self.assertEqual(self.locks, {})

    def test_nearby_boxes_do_not_share_request_bbox_metadata(self):
        with patch.object(server, "_build_map", side_effect=lambda bbox: {"bbox": bbox}) as build:
            preset = server.load_map("kitsilano")
            nearby = server.load_map("-123.17000001,49.26,-123.15,49.27")
            self.assertEqual(server.load_map("kitsilano")["bbox"], preset["bbox"])
        self.assertNotEqual(nearby["bbox"], preset["bbox"])
        self.assertEqual(build.call_count, 2)

    def test_failed_map_load_releases_lock_for_a_retry(self):
        empty = {"pack": {}, "router": None, "error": None}
        with patch.object(server, "_build_map", side_effect=[ValueError("corrupt"), empty]):
            with self.assertRaisesRegex(ValueError, "corrupt"):
                server.load_map("kitsilano")
            self.assertEqual(self.entries, {})
            self.assertEqual(self.locks, {})
            self.assertIs(server.load_map("kitsilano"), empty)

    def test_successful_and_recently_used_maps_survive_lru_displacement(self):
        def build(bbox):
            return {"bbox": bbox}

        with patch.object(server, "_build_map", side_effect=build), patch.object(server, "MAX_CACHED_MAPS", 2):
            kit = server.load_map("kitsilano")
            vic = server.load_map("victoria")
            self.assertIs(server.load_map("kitsilano"), kit)
            server.load_map("ottawa")
            self.assertEqual([entry["bbox"] for entry in self.entries.values()], [kit["bbox"], PRESET_BBOXES["ottawa"]])
            self.assertIs(server.load_map("kitsilano"), kit)
            self.assertIsNot(server.load_map("victoria"), vic)

    def test_expiring_synthetic_entry_retries_on_schedule(self):
        results = [{"retry_at": 60, "error": "offline"}, {"error": None}]
        with (
            patch.object(server, "_build_map", side_effect=results) as build,
            patch.object(server.time, "monotonic", return_value=59) as clock,
        ):
            self.assertIs(server.load_map("victoria"), results[0])
            self.assertIs(server.load_map("victoria"), results[0])
            self.assertEqual(build.call_count, 1)
            clock.return_value = 60
            self.assertIs(server.load_map("victoria"), results[1])
            self.assertEqual(build.call_count, 2)

    def test_fetch_error_fallback_retains_bbox_and_retry_time(self):
        with (
            patch.object(server, "build_pack", side_effect=fetch.FetchError("offline")),
            patch.object(server.time, "monotonic", return_value=10),
        ):
            entry = server.load_map("victoria")
        self.assertEqual(entry["bbox"], PRESET_BBOXES["victoria"])
        self.assertTrue(entry["pack"]["synthetic"])
        self.assertEqual(entry["error"], "offline")
        self.assertEqual(entry["retry_at"], 10 + server.MAP_RETRY_SECONDS)

    def test_parallel_cache_hits_return_same_entry(self):
        with patch.object(server, "_build_map", return_value={"pack": {}}) as build:
            with ThreadPoolExecutor(max_workers=8) as pool:
                entries = list(pool.map(server.load_map, ["kitsilano"] * 16))
        self.assertTrue(all(entry is entries[0] for entry in entries))
        build.assert_called_once()
        self.assertEqual(self.locks, {})

    def test_patched_pack_builders_share_layers_without_mutating_base(self):
        original = synthetic_pack()
        base = {"name": original["name"]}
        transit = {"test": "transit"}
        routes = {"test": "crossings"}
        with (
            patch.object(server, "build_pack", return_value=base),
            patch.object(server, "build_transit", return_value=transit),
            patch.object(server, "build_crossings", return_value=routes) as build_crossings,
            patch.object(server, "build_zones", side_effect=fetch.FetchError("mock offline")),
        ):
            entry = server.load_map("victoria")
        self.assertEqual(base, {"name": original["name"]})
        self.assertEqual(build_crossings.call_args.args[2]["transit"], transit)
        self.assertTrue(entry["pack"]["synthetic"])

    def test_ordinary_map_entry_has_no_retry_timestamp(self):
        with (
            patch.object(server, "build_pack", return_value=synthetic_pack()),
            patch.multiple(
                server,
                **{
                    f"build_{module}": Mock(return_value=None)
                    for module in (
                        "transit",
                        "crossings",
                        "zones",
                        "rail",
                        "buslanes",
                        "calming",
                        "scrambles",
                        "restrictions",
                        "contraflow",
                        "driveways",
                        "parks",
                        "bridges",
                    )
                },
            ),
        ):
            entry = server.load_map("victoria")
        self.assertNotIn("retry_at", entry)
        self.assertEqual(entry["pack"]["utc_offset"], maps.map_identity(entry["bbox"])["utc_offset"])


class MapPreviewTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory()))
        self.path = self.root / "preview.json"
        self.preview = synthetic_pack()
        self.enterContext(patch.object(maps, "_META_CACHE", {}))

    def write(self, payload):
        self.path.write_text(json.dumps(payload), encoding="utf-8")

    def test_excessive_pack_size_skips_file_open(self):
        self.write(self.preview)
        with patch.object(maps, "MAX_PREVIEW_PACK_BYTES", 10), patch.object(maps.json, "loads") as load:
            self.assertIsNone(maps._pack_metadata(self.path))
        load.assert_not_called()

    def test_metadata_lru_preserves_the_recently_used_path(self):
        self.write(self.preview)
        other = self.root / "other.json"
        other.write_bytes(self.path.read_bytes())
        latest = self.root / "latest.json"
        latest.write_bytes(self.path.read_bytes())
        with patch.object(maps, "MAX_META_ENTRIES", 2):
            maps._pack_metadata(self.path)
            maps._pack_metadata(other)
            maps._pack_metadata(self.path)
            maps._pack_metadata(latest)
        self.assertEqual(list(maps._META_CACHE), [str(self.path), str(latest)])

    def test_preview_extent_must_be_ordered_and_have_area(self):
        for extent in ([3, 0, 2, 4], [0, 3, 4, 2], [0, 0, 0, 1], [0, 2, 1, 2]):
            with self.subTest(extent=extent):
                self.write(dict(self.preview, extent=extent))
                self.assertIsNone(maps._pack_metadata(self.path))

    def test_preview_rejects_records_that_are_not_roads(self):
        self.write(dict(self.preview, edges=[["road"]]))
        self.assertIsNone(maps._pack_metadata(self.path))

    def test_preview_needs_sortable_endpoint_ids(self):
        edge = self.preview["edges"][0]
        for invalid in ([], False, 42):
            with self.subTest(invalid=invalid):
                self.write(dict(self.preview, edges=[dict(edge, **{"from": invalid})]))
                self.assertIsNone(maps._pack_metadata(self.path))

    def test_preview_requires_text_road_class(self):
        self.write(dict(self.preview, edges=[dict(self.preview["edges"][0], cls=5)]))
        self.assertIsNone(maps._pack_metadata(self.path))

    def test_preview_each_road_contains_a_segment(self):
        self.write(dict(self.preview, edges=[dict(self.preview["edges"][0], pts=[[1, 2]])]))
        self.assertIsNone(maps._pack_metadata(self.path))

    def test_preview_points_must_be_arrays_not_object_keys(self):
        self.write(dict(self.preview, edges=[dict(self.preview["edges"][0], pts=[[1, 2], {"3": 3, "4": 4}])]))
        self.assertIsNone(maps._pack_metadata(self.path))

    def test_map_identity_consumes_a_bbox_iterator_once(self):
        self.assertEqual(maps.map_identity(iter(PRESET_BBOXES["ottawa"]))["id"], "ottawa")

    def test_custom_map_identity_has_no_utc_offset(self):
        self.assertEqual(
            maps.map_identity((-120.01, 50.01, -120, 50.02)), {"id": "custom", "label": "Custom neighbourhood"}
        )

    def test_metadata_handles_existing_empty_map_preview(self):
        self.write(dict(self.preview, edges=[]))
        metadata = maps._pack_metadata(self.path)
        self.assertEqual(metadata["preview"], [])
        self.assertEqual(metadata["stats"]["roads"], 0)

    def test_invalid_pack_recovers_on_in_place_edit(self):
        self.path.write_bytes(b"invalid")
        self.assertIsNone(maps._pack_metadata(self.path))
        self.write(self.preview)
        self.assertIsNotNone(maps._pack_metadata(self.path))

    def test_preview_marks_only_supported_arterial_road_classes(self):
        edges = []
        classes = ("primary", "secondary", "tertiary", "trunk", "residential", "motorway")
        for index, kind in enumerate(classes):
            edges.append({"from": str(index), "to": str(index + 1), "pts": [[index, 1], [index + 1, 2]], "cls": kind})
        self.write(dict(self.preview, edges=edges))
        self.assertEqual(
            [item["major"] for item in maps._pack_metadata(self.path)["preview"]], [True] * 4 + [False] * 2
        )


class DriveSuggestionTests(unittest.TestCase):
    def stub_lanes(self, coordinates, find):
        router = Mock()
        router.pack = {"extent": [-2000, -2000, 2000, 2000]}
        router.lanes = {
            f"edge-{i}": {
                "length": length,
                "pts": [[x, y], [x + length, y]],
                "cum": [0, length],
                "edge": f"edge-{i}",
                "idx": 0,
            }
            for i, (x, y, length) in enumerate(coordinates)
        }
        router.routes.side_effect = find
        return router

    def test_drive_candidates_use_one_destination_per_grid_cell(self):
        router = self.stub_lanes([(400, 400, 45), (414, 415, 45), (650, 650, 45)], lambda *_a, **_kw: [])
        self.assertEqual(drives.suggested_drives(router, POSITION), [])
        self.assertEqual(router.routes.call_count, 2)

    def test_drive_candidates_skip_short_lanes(self):
        router = self.stub_lanes([(400, 400, 34), (650, 650, 35)], lambda *_a, **_kw: [])
        self.assertEqual(drives.suggested_drives(router, POSITION), [])
        router.routes.assert_called_once()

    def test_drive_candidates_keep_fixed_distance_window(self):
        router = self.stub_lanes([(100, 0, 40), (300, 0, 40), (1400, 0, 40)], lambda *_a, **_kw: [])
        drives.suggested_drives(router, {"x": 0, "y": 0, "heading": 0})
        self.assertEqual(router.routes.call_args.args[1], {"x": 322, "y": 0})
        router.routes.assert_called_once()

    def test_drive_candidates_start_at_original_pose_when_one_route_fails(self):
        def try_route(_start, goal, **_kwargs):
            if goal["x"] < 500:
                return []
            return [{"polyline": [[0, 0], [goal["x"], goal["y"]]], "edges": [], "turns": []}]

        router = self.stub_lanes([(250, 0, 40), (600, 0, 40)], try_route)
        start = dict(POSITION)
        listed = drives.suggested_drives(router, start)
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["id"], "neighbourhood")
        for call in router.routes.call_args_list:
            self.assertEqual(call.args[0], start)

    def test_drive_scoring_uses_length_and_maintains_three_ordered_presets(self):
        def route(_start, goal, **_kwargs):
            x = goal["x"]
            return [{"polyline": [[0, 0], [x, 0]], "edges": [], "turns": []}]

        router = self.stub_lanes([(480, 0, 35), (830, 0, 35), (1250, 0, 35)], route)
        listed = drives.suggested_drives(router, {"x": 0, "y": 0, "heading": 0})
        self.assertEqual([item["id"] for item in listed], ["neighbourhood", "junctions", "tour"])
        self.assertEqual([item["length_m"] for item in listed], [499, 849, 1269])

    def test_drive_results_with_nearby_destinations_only_appear_once(self):
        def route(_start, goal, **_kwargs):
            return [{"polyline": [[0, 0], [goal["x"], goal["y"]]], "edges": [], "turns": []}]

        router = self.stub_lanes([(410, 0, 40), (460, 0, 40)], route)
        self.assertEqual(len(drives.suggested_drives(router, POSITION)), 1)

    def test_skips_route_without_a_drivable_segment(self):
        router = Mock()
        router.pack = {"extent": [0, 0, 1000, 1000]}
        router.lanes = {
            "lane": {"length": 100.0, "pts": [[400, 400], [500, 400]], "cum": [0, 100], "edge": "edge", "idx": 0}
        }
        router.routes.return_value = [{"polyline": []}]
        self.assertEqual(drives.suggested_drives(router, POSITION), [])
        router.routes.assert_called_once()

    def test_stops_scanning_lanes_after_filling_route_budget(self):
        router = Mock()
        router.pack = {"extent": [-2000, -2000, 2000, 2000]}
        router.lanes = {}
        for x in range(-750, 751, 150):
            for y in range(-750, 751, 150):
                ident = f"edge-{x:+05d}-{y:+05d}"
                router.lanes[ident] = {
                    "length": 100,
                    "pts": [[x, y], [x + 100, y]],
                    "cum": [0, 100],
                    "edge": ident,
                    "idx": 0,
                }
        router.routes.return_value = []
        with patch.object(drives.g, "point_at", wraps=drives.g.point_at) as sample:
            self.assertEqual(drives.suggested_drives(router, {"x": 0, "y": 0, "heading": 0}), [])
        self.assertEqual(router.routes.call_count, 32)
        self.assertLess(sample.call_count, len(router.lanes))
