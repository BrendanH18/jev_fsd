"""Safety reports distinguish measured zeroes, incident samples and absent audits."""

import unittest

import helpers  # noqa: F401 (puts the repository on sys.path)
from scripts.run_insights.safety import EXTENDED_REPORTS, QUESTIONS, REPORTS


class SafetyInsightsTest(unittest.TestCase):
    def test_all_audits_measure_only_observed_routes(self):
        expected = {
            "collisions": "collisions at_fault",
            "signals": "red_lights amber_lights_run",
            "stop-signs": "stop_signs",
            "yields": "failed_to_yield",
            "plows": "plow_right_passes",
            "merges": "merge_cut_ins",
            "cyclists": "close_passes contraflow_conflicts",
            "bus-lanes": "bus_lane_driving",
            "high-beams": "glare_seconds",
            "sun-glare": "glare_speeding_seconds",
            "prohibited-turns": "illegal_turns",
            "speed-humps": "hump_hits",
            "crossovers": "pxo_early_goes",
            "collection-crews": "crew_close_passes",
            "directed-stops": "guard_violations officer_violations",
            "fresh-greens": "fresh_green_conflicts",
            "driveways": "reversing_conflicts",
            "potholes": "pothole_hits",
            "ball-warnings": "ball_warnings_ignored",
            "geese": "wildlife_conflicts",
            "tailgaters": "brake_checks",
            "winter-surfaces": "ice_overspeed snowbank_conflicts",
            "puddles": "pedestrians_splashed",
            "parking-conflicts": "parking_conflicts",
            "road-closures": "closure_entries",
        }
        self.assertEqual(set(REPORTS), {f"safety-{name}" for name in expected})
        metrics = set()
        for report_id, (_, run) in REPORTS.items():
            fields = expected[report_id.removeprefix("safety-")].split()
            self.assertEqual(set(run([])), set(fields))
            for field in fields:
                with self.subTest(report=report_id, field=field):
                    self.assertNotIn(field, metrics)
                    metrics.add(field)
                    self.assertIsNone(run([{}])[field]["total"])
                    summary = run([{field: 0}, {field: 2, "id": "B"}, {}, {field: 4, "id": "A"}])[field]
                    self.assertEqual(summary["measured_routes"], 3)
                    self.assertEqual(summary["unmeasured_routes"], 1)
                    self.assertEqual(summary["total"], 6)
                    self.assertEqual([route["id"] for route in summary["affected_routes"]], ["A", "B"])

    def test_collisions_use_fault_audit_and_retained_location(self):
        _, collisions = REPORTS["safety-collisions"]
        rows = [
            {
                "id": "crossing",
                "collisions": 2,
                "at_fault": 1,
                "diagnostics": {
                    "incidents": [
                        {"audit": "collisions_at_fault", "value": 1, "t": 3, "street": "Main"},
                        {"audit": "collisions", "t": 7},
                    ]
                },
            },
            {"collisions": 0},
        ]
        result = collisions(rows)
        fault = result["at_fault"]
        self.assertEqual(fault["measured_routes"], 1)
        self.assertEqual(fault["affected_routes"][0]["samples"], [{"value": 1, "t": 3, "street": "Main"}])
        self.assertEqual(result["collisions"]["affected_routes"][0]["samples"], [{"t": 7}])

    def test_bus_lane_distance_preserves_subthreshold_measurements(self):
        _, lanes = REPORTS["safety-bus-lanes"]
        rows = [{"bus_lane_driving": value} for value in [False, None, -1, "3", float("nan"), 0.4, 0.2]]
        summary = lanes(rows)["bus_lane_driving"]
        self.assertEqual((summary["measured_routes"], summary["total"], summary["unit"]), (2, 0.6, "metres"))

    def test_diagnostic_samples_preserve_extra_keys_and_extended_reports(self):
        rows = [
            {
                "id": "r2",
                "distance_m": 1000,
                "collisions": 1,
                "red_lights": 2,
                "off_road_s": 1.5,
                "diagnostics": {
                    "incidents": [
                        {
                            "audit": "collisions",
                            "t": 12.5,
                            "street": "Broadway",
                            "x": 10,
                            "y": -20,
                            "with": "npc-4",
                            "kind": "sedan",
                            "ignored": "drop",
                        },
                        {
                            "audit": "off_road_s",
                            "t": 22.0,
                            "x": 30,
                            "y": 40,
                            "value": 1.5,
                            "kind": "curb",
                        },
                    ]
                },
            },
            {"id": "r1", "distance_m": 1000, "collisions": 1, "red_lights": 0, "off_road_s": 0},
        ]
        col = REPORTS["safety-collisions"][1](rows)["collisions"]
        self.assertEqual([entry["id"] for entry in col["affected_routes"]], ["r1", "r2"])
        self.assertEqual(
            col["affected_routes"][1]["samples"],
            [{"t": 12.5, "street": "Broadway", "x": 10, "y": -20, "with": "npc-4", "kind": "sedan"}],
        )

        overview = EXTENDED_REPORTS["safety-overview"][1](rows)
        self.assertEqual(len(overview["hazards"]), sum(len(f) for _, f in QUESTIONS.values()) + 1)
        self.assertEqual(overview["total_km"], 2.0)
        self.assertEqual(overview["families_triggered"], 3)
        self.assertEqual(overview["hazards"]["collisions"]["per_km"], 1.0)
        self.assertEqual(overview["hazards"]["off_road_s"]["per_km"], 0.75)
        self.assertEqual(
            overview["off_road_incidents"]["affected_routes"][0]["samples"],
            [{"t": 22.0, "x": 30, "y": 40, "value": 1.5, "kind": "curb"}],
        )

        exposure = EXTENDED_REPORTS["safety-exposure"][1](rows)
        self.assertEqual(len(exposure["by_family"]), len(QUESTIONS) + 1)
        self.assertEqual(exposure["ranked_hazards"][0]["field"], "collisions")
        self.assertEqual(exposure["by_family"]["off-road"]["triggered_routes"], 1)
