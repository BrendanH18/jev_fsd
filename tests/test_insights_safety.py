"""Safety reports distinguish measured zeroes, incident samples and absent audits."""

import unittest

import helpers  # noqa: F401 (puts the repository on sys.path)
from scripts.run_insights.safety import REPORTS


class SafetyInsightsTest(unittest.TestCase):
    def test_all_audits_measure_only_observed_routes(self):
        self.assertEqual(len(REPORTS), 25)
        metrics = set()
        for report_id, (_, run) in REPORTS.items():
            for field in run([]):
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
