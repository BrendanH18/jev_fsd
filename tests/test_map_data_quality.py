"""Cross-check shipped map geometry and layers without fetching OSM."""

import json
import math
import re
import unittest
from collections import defaultdict
from itertools import pairwise
from pathlib import Path

import helpers  # noqa: F401

from jev import geometry as g
from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm import fetch
from jev.osm.bridges import load_bridges
from jev.osm.bus_lanes import load_buslanes
from jev.osm.calming import load_calming
from jev.osm.contraflow import load_contraflow
from jev.osm.crossings import load_crossings
from jev.osm.driveways import load_driveways
from jev.osm.pack import pack_path
from jev.osm.parks import is_water, load_parks
from jev.osm.project import Projection
from jev.osm.rail import MIN_ANGLE_DEG, load_rail
from jev.osm.restrictions import load_restrictions
from jev.osm.scrambles import load_scrambles
from jev.osm.transit import load_transit
from jev.osm.zones import load_zones

LOADERS = (
    load_bridges,
    load_buslanes,
    load_calming,
    load_contraflow,
    load_crossings,
    load_driveways,
    load_parks,
    load_rail,
    load_scrambles,
    load_transit,
    load_zones,
)


def read_pack(bbox):
    return json.loads(pack_path(MAPS_DIR, bbox).read_text(encoding="utf-8"))


class BundledPackQualityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.packs = {name: read_pack(bbox) for name, bbox in PRESET_BBOXES.items()}

    def test_map_keys_match_their_coordinates(self):
        seen = set()
        for name, pack in self.packs.items():
            with self.subTest(map=name):
                key = fetch.cache_key(PRESET_BBOXES[name])
                self.assertEqual(pack["name"], key)
                self.assertNotIn(key, seen)
                seen.add(key)

    def test_coordinate_frames_match_the_preset_geometry(self):
        for name, pack in self.packs.items():
            with self.subTest(map=name):
                bbox = PRESET_BBOXES[name]
                proj = Projection.for_bbox(bbox)
                self.assertEqual(pack["origin"], proj.as_dict())
                self.assertEqual(pack["extent"], [g.r2(axis) for axis in proj.bbox_xy(bbox)])

    def test_pack_counts_match_stored_records(self):
        for name, pack in self.packs.items():
            with self.subTest(map=name):
                for stats_key, records_key in (
                    ("vertices", "nodes"),
                    ("edges", "edges"),
                    ("buildings", "buildings"),
                    ("intersections", "intersections"),
                    ("stops", "stops"),
                    ("yields", "yields"),
                ):
                    self.assertEqual(pack["stats"][stats_key], len(pack[records_key]))

    def test_graph_references_and_identifiers_are_consistent(self):
        for name, pack in self.packs.items():
            with self.subTest(map=name):
                vertices = {n["id"] for n in pack["nodes"]}
                self.assertEqual(len(vertices), len(pack["nodes"]))
                self.assertEqual(len({e["id"] for e in pack["edges"]}), len(pack["edges"]))
                for edge in pack["edges"]:
                    self.assertIn(edge["from"], vertices)
                    self.assertIn(edge["to"], vertices)

    def test_the_directed_graph_is_strongly_connected(self):
        for name, pack in self.packs.items():
            for from_key, to_key in (("from", "to"), ("to", "from")):
                with self.subTest(map=name, direction=from_key):
                    links = defaultdict(list)
                    for edge in pack["edges"]:
                        links[edge[from_key]].append(edge[to_key])
                    start = pack["nodes"][0]["id"]
                    reached = {start}
                    pending = [start]
                    while pending:
                        for dest in links[pending.pop()]:
                            if dest not in reached:
                                reached.add(dest)
                                pending.append(dest)
                    self.assertEqual(len(reached), len(pack["nodes"]))

    def test_edge_distances_match_their_polylines(self):
        for name, pack in self.packs.items():
            for edge in pack["edges"]:
                pts = edge["pts"]
                self.assertGreater(len(pts), 1, (name, edge["id"]))
                # Accounting for both point and length quantization.
                error_bound = 0.015 * (len(pts) - 1) + 0.005
                distance = sum(math.dist(a, b) for a, b in pairwise(pts))
                self.assertAlmostEqual(edge["length"], distance, delta=error_bound, msg=(name, edge["id"]))
                self.assertGreater(edge["limit"], 0, (name, edge["id"]))

    def test_lane_records_cover_each_edge_in_index_order(self):
        for name, pack in self.packs.items():
            with self.subTest(map=name):
                by_edge = defaultdict(list)
                for lane in pack["lanes"]:
                    self.assertGreater(len(lane["pts"]), 1, (name, lane["edge"]))
                    by_edge[lane["edge"]].append(lane["idx"])
                self.assertEqual(set(by_edge), {e["id"] for e in pack["edges"]})
                for edge in pack["edges"]:
                    self.assertEqual(by_edge[edge["id"]], list(range(edge["lanes"])))
                    self.assertEqual(len(edge["lane_offsets"]), edge["lanes"])
                    self.assertEqual(edge["lane_offsets"], sorted(set(edge["lane_offsets"])))

    def test_lane_centers_and_parking_fit_the_road_cross_section(self):
        for name, pack in self.packs.items():
            for edge in pack["edges"]:
                left, right = edge["asphalt"]
                for offset in edge["lane_offsets"]:
                    self.assertLess(left, offset, (name, edge["id"]))
                    self.assertLess(offset, right, (name, edge["id"]))
                self.assertTrue(all(width >= 0 for width in edge["parking"]), (name, edge["id"]))

    def test_signals_cross_reference_their_external_approaches(self):
        for name, pack in self.packs.items():
            edges = {e["id"]: e for e in pack["edges"]}
            self.assertEqual(len({i["id"] for i in pack["intersections"]}), len(pack["intersections"]))
            for signal in pack["intersections"]:
                vertices = signal["vertices"]
                approaches = signal["approaches"]
                self.assertEqual(len({a["edge"] for a in approaches}), len(approaches))
                for approach in approaches:
                    edge = edges[approach["edge"]]
                    self.assertIn(edge["to"], vertices, (name, signal["id"]))
                    self.assertNotIn(edge["from"], vertices, (name, signal["id"]))
                    self.assertIn(approach["group"], ("A", "B"))
                    self.assertEqual(edge["control"]["id"], signal["id"])
                    self.assertEqual(edge["control"]["s_line"], approach["s_line"])

    def test_stop_and_yield_controls_agree_with_their_edges(self):
        for name, pack in self.packs.items():
            edges = {e["id"]: e for e in pack["edges"]}
            for kind in ("stop", "yield"):
                for sign in pack[kind + "s"]:
                    edge = edges[sign["edge"]]
                    self.assertEqual(edge["control"]["type"], kind)
                    self.assertEqual(edge["control"]["id"], sign["id"])
                    self.assertEqual(edge["control"]["s_line"], sign["s_line"])
                    self.assertLessEqual(sign["s_line"], edge["length"], (name, sign["id"]))

    def test_roundabout_references_stay_inside_their_ring(self):
        for name, pack in self.packs.items():
            rings = {ring["id"]: set(ring["vertices"]) for ring in pack["roundabouts"]}
            for edge in pack["edges"]:
                if edge.get("ring"):
                    self.assertTrue(edge["oneway"], (name, edge["id"]))
                    self.assertIn(edge["from"], rings[edge["ring"]])
                    self.assertIn(edge["to"], rings[edge["ring"]])

    def test_building_footprints_are_finite_and_counter_clockwise(self):
        for name, pack in self.packs.items():
            with self.subTest(map=name):
                for building in pack["buildings"]:
                    self.assertGreaterEqual(building["h"], 2.5)
                    self.assertGreaterEqual(len(building["pts"]), 3)
                    self.assertTrue(all(math.isfinite(axis) for pt in building["pts"] for axis in pt))
                    self.assertGreater(g.polygon_area(building["pts"]), 0)

    def test_published_map_counts_match_the_pack_inventory(self):
        docs = MAPS_DIR.parent.parent / "docs/maps.md"
        rows = re.findall(
            r"^\| `\?map=(\w+)` \| [^|]+ \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \|$",
            docs.read_text(encoding="utf-8"),
            re.M,
        )
        self.assertEqual(sorted(name for name, *_ in rows), sorted(self.packs))
        for name, *counts in rows:
            keys = ("edges", "intersections", "stops", "buildings")
            self.assertEqual([int(n.replace(",", "")) for n in counts], [len(self.packs[name][k]) for k in keys])

    def test_documented_pack_paths_describe_the_correct_bounds(self):
        docs = MAPS_DIR.parent.parent / "docs/maps.md"
        rows = re.findall(
            r"^\| [^|]+ \| `([-.,\d]+)` \| `(data/maps/[^\s`]+)` \|$", docs.read_text(encoding="utf-8"), re.M
        )
        documented = {tuple(map(float, box.split(","))): Path(path).name for box, path in rows}
        self.assertEqual(documented, {bbox: pack_path(MAPS_DIR, bbox).name for bbox in PRESET_BBOXES.values()})


class BundledLayerQualityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.edges = {}
        cls.maps = {}
        for name, bbox in PRESET_BBOXES.items():
            cls.maps[name] = read_pack(bbox)
            cls.edges[name] = {e["id"]: e for e in cls.maps[name]["edges"]}

    def test_named_layers_belong_to_the_pack_with_the_same_cache_key(self):
        for name, bbox in PRESET_BBOXES.items():
            for load in LOADERS:
                with self.subTest(map=name, layer=load.__name__):
                    data = load(bbox, MAPS_DIR)
                    if data is None and load is load_rail:
                        continue  # prepared maps may omit rail altogether
                    self.assertIsNotNone(data)
                    self.assertEqual(data["name"], self.maps[name]["name"])

    def test_bus_lanes_refer_to_real_lane_indices_and_permitted_modes(self):
        for name, bbox in PRESET_BBOXES.items():
            seen = set()
            for lane in load_buslanes(bbox, MAPS_DIR)["lanes"]:
                edge = self.edges[name][lane["edge"]]
                self.assertTrue(0 <= lane["lane"] < edge["lanes"], (name, lane))
                key = (lane["edge"], lane["lane"])
                self.assertNotIn(key, seen)
                seen.add(key)
                self.assertIn("bus", lane["allowed"])
                self.assertTrue(set(lane["allowed"]) <= {"bus", "taxi", "bicycle"})

    def test_contraflow_lane_records_are_unique(self):
        for name, bbox in PRESET_BBOXES.items():
            records = load_contraflow(bbox, MAPS_DIR)["edges"]
            self.assertEqual(len({r["edge"] for r in records}), len(records), name)

    def test_crosswalk_coordinates_and_island_flags_have_renderable_types(self):
        for name, bbox in PRESET_BBOXES.items():
            records = load_crossings(bbox, MAPS_DIR)["crossings"]
            for record in records:
                self.assertTrue(math.isfinite(record["x"]) and math.isfinite(record["y"]), (name, record["id"]))
                self.assertIsInstance(record["island"], bool, (name, record["id"]))

    def test_driveway_paths_have_positive_length_and_radian_heading(self):
        for name, bbox in PRESET_BBOXES.items():
            for d in load_driveways(bbox, MAPS_DIR)["driveways"]:
                self.assertGreater(d["length"], 0, (name, d["id"]))
                self.assertLessEqual(abs(d["heading"]), math.pi + 0.001, (name, d["id"]))

    def test_closed_park_areas_have_closed_rings(self):
        for name, bbox in PRESET_BBOXES.items():
            for area in load_parks(bbox, MAPS_DIR)["areas"]:
                if area["closed"]:
                    self.assertTrue(area["rings"], (name, area["id"]))
                    for ring in area["rings"]:
                        self.assertGreaterEqual(len(ring), 4)
                        self.assertEqual(ring[0], ring[-1], (name, area["id"]))

    def test_park_spans_report_water_from_either_side(self):
        for name, bbox in PRESET_BBOXES.items():
            layer = load_parks(bbox, MAPS_DIR)
            water_areas = {a["id"] for a in layer["areas"] if is_water(a["kind"])}
            for span in layer["spans"]:
                self.assertEqual(span["water"], bool(water_areas & {span["left"], span["right"]}), (name, span))

    def test_rail_track_end_states_and_stops_match_their_geometry(self):
        for name, bbox in PRESET_BBOXES.items():
            layer = load_rail(bbox, MAPS_DIR)
            if layer is None:
                continue
            for track in layer["tracks"]:
                self.assertEqual(len(track["ends"]), 2)
                self.assertTrue(set(track["ends"]) <= {"edge", "terminus"})
                self.assertGreater(track["length"], 0)
                positions = [s["s"] for s in track["stops"]]
                self.assertEqual(positions, sorted(positions))
                self.assertTrue(all(0 <= pos <= track["length"] for pos in positions), (name, track["id"]))

    def test_rail_crossing_references_have_valid_track_and_road_positions(self):
        for name, bbox in PRESET_BBOXES.items():
            layer = load_rail(bbox, MAPS_DIR)
            if layer is None:
                continue
            tracks = {t["id"]: t for t in layer["tracks"]}
            for crossing in layer["crossings"]:
                self.assertTrue(0 <= crossing["s"] <= tracks[crossing["track"]]["length"])
                self.assertTrue(crossing["edges"])
                for ref in crossing["edges"]:
                    edge = self.edges[name][ref["edge"]]
                    self.assertTrue(0 <= ref["s"] <= edge["length"] + 0.05)
                    self.assertTrue(MIN_ANGLE_DEG <= ref["angle_deg"] <= 90)

    def test_scrambles_use_signal_coordinates_and_distinguish_sources(self):
        for name, bbox in PRESET_BBOXES.items():
            signals = {i["id"]: i for i in self.maps[name]["intersections"]}
            for scramble in load_scrambles(bbox, MAPS_DIR)["scrambles"]:
                signal = signals[scramble["signal"]]
                self.assertEqual((scramble["x"], scramble["y"]), (signal["x"], signal["y"]))
                self.assertIn(scramble["source"], ("tagged", "diagonal"))

    def test_turn_rules_refer_to_connected_movements(self):
        for name, bbox in PRESET_BBOXES.items():
            data = load_restrictions(bbox, MAPS_DIR)
            edges = self.edges[name]
            for rule in data["restrictions"]:
                start = edges[rule["from"]]["to"]
                self.assertTrue(rule["to"], (name, rule["id"]))
                for target in rule["to"]:
                    self.assertEqual(start, edges[target]["from"], (name, rule["id"]))

    def test_red_only_rules_cannot_leak_into_the_routing_layer(self):
        from jev.osm.restrictions import RED_KINDS

        red_count = 0
        for name, bbox in PRESET_BBOXES.items():
            data = load_restrictions(bbox, MAPS_DIR)
            for rule in data["restrictions"]:
                self.assertNotIn(rule["kind"], RED_KINDS, (name, rule["id"]))
            for rule in data.get("red_turns", []):
                self.assertIn(rule["kind"], RED_KINDS, (name, rule["id"]))
                red_count += 1
        self.assertGreater(red_count, 0)

    def test_turn_rules_schedule_days_and_times_stay_in_clock_bounds(self):
        for name, bbox in PRESET_BBOXES.items():
            data = load_restrictions(bbox, MAPS_DIR)
            for rule in data["restrictions"] + data.get("red_turns", []):
                conditions = rule.get("suppressed_conditions", [])
                if rule.get("condition"):
                    conditions = [*conditions, rule["condition"]]
                for cond in conditions:
                    self.assertTrue(cond["days"], (name, rule["id"]))
                    self.assertTrue(set(cond["days"]) <= set(range(7)))
                    self.assertTrue(0 <= cond["start"] < 1440)
                    self.assertTrue(0 <= cond["end"] <= 1440)

    def test_transit_runs_have_connected_edges_and_correct_length(self):
        for name, bbox in PRESET_BBOXES.items():
            edges = self.edges[name]
            for route in load_transit(bbox, MAPS_DIR)["routes"]:
                self.assertIn(route["mode"], ("bus", "trolleybus", "tram"))
                for run in route["runs"]:
                    sequence = [edges[e] for e in run["edges"]]
                    self.assertTrue(sequence)
                    for a, b in pairwise(sequence):
                        self.assertEqual(a["to"], b["from"], (name, route["id"]))
                    self.assertAlmostEqual(run["length"], sum(e["length"] for e in sequence), delta=0.051)

    def test_transit_stop_references_belong_to_a_run_and_its_stop_catalog(self):
        for name, bbox in PRESET_BBOXES.items():
            data = load_transit(bbox, MAPS_DIR)
            stops = {s["id"] for s in data["stops"]}
            self.assertEqual(len(stops), len(data["stops"]), name)
            for route in data["routes"]:
                for run in route["runs"]:
                    order = defaultdict(list)
                    for i, edge in enumerate(run["edges"]):
                        order[edge].append(i)
                    latest = (-1, 0)
                    for stop in run["stops"]:
                        self.assertIn(stop["id"], stops)
                        edge = self.edges[name][stop["edge"]]
                        self.assertTrue(0 <= stop["s"] <= edge["length"] + 0.05)
                        positions = [(i, stop["s"]) for i in order[stop["edge"]]]
                        next_position = next((p for p in positions if p >= latest), None)
                        self.assertIsNotNone(next_position, (name, route["id"], stop["id"]))
                        latest = next_position

    def test_zones_have_unique_ids_and_nonempty_spans(self):
        for name, bbox in PRESET_BBOXES.items():
            zones = load_zones(bbox, MAPS_DIR)["zones"]
            self.assertEqual(len({z["id"] for z in zones}), len(zones), name)
            self.assertTrue(all(z["spans"] for z in zones), name)
