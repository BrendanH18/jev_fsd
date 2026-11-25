"""Contracts of the original saved-run reports alongside the new analyses."""

import csv
import io
import unittest

import helpers  # noqa: F401
from scripts.inspect_run import format_output
from scripts.run_insights import comparison, decisions, motion, outcomes, profiles, safety, scores


def original(module, name, rows):
    return module.REPORTS[name][1](rows)


class LegacyReportContracts(unittest.TestCase):
    def test_geometry_cohorts_at_untested_boundaries(self):
        cases = (
            (outcomes.length, {"length_m": 499.99}, "under 500 m"),
            (outcomes.length, {"length_m": 1000}, "1000 m or more"),
            (outcomes.controls, {"signals": 0, "stops": 2}, "stops only"),
            (outcomes.controls, {"signals": 0, "stops": 0}, "neither"),
            (outcomes.controls, {"signals": 1, "stops": 1}, "both"),
            (outcomes.turns, {"lefts": 2, "rights": 2}, "balanced"),
            (outcomes.turns, {"lefts": 0, "rights": 0}, "no recorded left or right turns"),
            (outcomes.turns, {"lefts": 1, "rights": 4}, "mostly right"),
        )
        for classify, tags, expected in cases:
            with self.subTest(tags=tags):
                self.assertEqual(classify({"tags": tags}), expected)

    def test_distinct_saved_outcomes(self):
        tied = [{"id": id_, "pass": p} for id_, p in (("first", True), ("unknown", None), ("second", True))]
        self.assertEqual(original(outcomes, "suite-pass-streak", tied), ["first"])
        self.assertEqual(outcomes.parking({"arrived": False, "no_space": True}), ["did not arrive"])
        self.assertEqual(outcomes.parking({"arrived": True, "parked": None, "no_space": True}), ["no space"])
        self.assertIsNone(outcomes.parking({"arrived": True, "parked": "true"}))
        reroutes = {"id": "r", "events": [{"type": "reroute", "t": 2}, {"type": "reroute", "t": 7}]}
        self.assertEqual(original(outcomes, "suite-first-reroute", [reroutes]), [{"id": "r", "time_s": 2}])
        final = original(outcomes, "suite-final-events", [{"arrived": False, "events": []}])
        self.assertEqual(final, {"measured_routes": 1, "counts": {}})
        failure = original(outcomes, "suite-sole-failures", [{"pass": True, "failures": ["collision"]}])
        self.assertEqual(failure["counts"], {})
        burden = original(
            outcomes,
            "suite-failed-distance",
            [
                {"pass": False, "distance_m": 300, "tags": {"length_m": 900}},
                {"pass": True, "tags": {"length_m": 500}},
            ],
        )
        self.assertEqual(burden, {"planned_m": 900, "measured_routes": 1})

    def test_motion_limits_and_ordering(self):
        for name, row in (
            ("moving-time", {"time_s": 10, "stopped_s": 11}),
            ("speeding-share", {"time_s": 10, "speeding_s": 11}),
            ("jerk-crest", {"max_jerk": 3, "rms_jerk": 0}),
            ("lane-error-crest", {"lane_max_m": 0.2, "lane_rms_m": 0}),
            ("simulation-speed", {"time_s": 10, "wall_ms": 0}),
        ):
            with self.subTest(name=name):
                self.assertEqual(original(motion, f"motion-{name}", [row])["unavailable"], 1)
        raw = [{"id": "a", "time_s": 2.00002}, {"id": "z", "time_s": 2.00003}]
        self.assertEqual(
            original(motion, "motion-duration", raw)["routes"], [{"id": "z", "value": 2}, {"id": "a", "value": 2}]
        )
        ranked = original(
            motion, "motion-peak-deceleration", [{"id": "a", "max_decel": -2}, {"id": "b", "max_decel": -3}]
        )
        self.assertEqual([row["id"] for row in ranked["routes"]], ["b", "a"])

    def test_cost_and_decision_measurement_contracts(self):
        self.assertIsNone(original(decisions, "cost-per-pass", [{"cost_usd": 0.5, "pass": False}])["usd_per_pass"])
        self.assertEqual(
            original(decisions, "cost-per-pass", [{"cost_usd": 42}, {"pass": True, "cost_usd": 0.1}])["usd_per_pass"],
            0.1,
        )
        spend = original(decisions, "spend-by-outcome", [{"pass": True, "cost_usd": 0}])
        self.assertEqual(spend["passed"]["cost_usd"], 0)
        self.assertIsNone(spend["failed"]["cost_usd"])
        shares = original(
            decisions, "decision-sources", [{"model_decisions": 0, "local_decisions": 0, "fallback_decisions": 0}]
        )
        self.assertTrue(all(value is None for value in shares["shares"].values()))
        checks = original(decisions, "flagged-check-frequency", [{"flagged_by_check": {"valid": 1, "bad": -2}}])
        self.assertEqual(checks, {"routes_measured": 0, "by_check": {}})
        latency = original(decisions, "latency-coverage", [{"calls": 0, "latency_p50_ms": 2, "latency_p95_ms": 4}])
        self.assertIsNone(latency["coverage"])
        tail = original(decisions, "latency-tail-inflation", [{"latency_p95_ms": 2, "latency_p50_ms": 0}])
        self.assertEqual(tail, [])
        only = original(
            decisions,
            "local-only-routes",
            [{"id": "none", "model_decisions": 0, "local_decisions": 0, "fallback_decisions": 0}],
        )
        self.assertEqual(only, [])

    def test_safety_exposure_and_missing_samples(self):
        rows = [
            {"id": "a", "distance_m": 1000, "collisions": 2, "at_fault": 2},
            {"id": "b", "distance_m": 3000},
            {"id": "c", "collisions": 3},
            {"id": "d", "distance_m": 0, "collisions": 1, "red_lights": 1},
        ]
        result = safety.safety_exposure(rows)
        family = result["by_family"]["collisions"]
        self.assertEqual(result["total_km"], 4)
        self.assertEqual(family["triggered_routes"], 3)
        self.assertEqual(family["fields"]["collisions"]["total"], 6)
        self.assertEqual(family["fields"]["collisions"]["per_km"], 2)
        self.assertEqual(
            [entry["field"] for entry in result["ranked_hazards"]], ["collisions", "at_fault", "red_lights"]
        )
        self.assertIsNone(result["by_family"]["signals"]["fields"]["red_lights"]["measured_km"])
        altered = original(
            safety,
            "safety-stop-signs",
            [
                {"stop_signs": 2, "diagnostics": {"incidents": [None, {"audit": "stop_signs_run", "t": 1.5}]}},
            ],
        )
        self.assertEqual(altered["stop_signs"]["affected_routes"][0]["samples"], [{"t": 1.5}])

    def test_score_edge_contracts(self):
        self.assertEqual(scores.drive_scores({"progress": -0.1})["progress"], 0)
        self.assertEqual(scores.drive_scores({"progress": 2.5})["progress"], 1)
        self.assertEqual(scores.drive_scores({"arrived": True, "time_s": 2, "distance_m": 100})["pace"], 100)
        self.assertEqual(scores.drive_scores({"arrived": True, "time_s": 2, "distance_m": 100})["time_lost_s"], 0)
        self.assertEqual(scores.comfort_score({"distance_m": 1, "hard_brakes": 1}), 70)
        self.assertEqual(
            scores.margin_score({"distance_m": 1000, "min_ttc_s": 1, "min_headway_s": 0.5, "safety_brakes": 5}), 0
        )
        self.assertEqual(scores._round(-2.5, 0), -2)
        distribution = profiles.distribution([-1e308, 1e308], 2)
        self.assertEqual(distribution["median"], 0)

    def test_matching_legacy_metadata_contracts(self):
        base = {"map": "kitsilano", "pack": 6, "seed": 1, "count": 3}
        comparison.validate_suite({**base, "suite_version": "legacy"}, {**base, "suite_version": "custom"})
        comparison.validate_suite(base, {**base, "pack": "6"})
        with self.assertRaisesRegex(ValueError, "same arena set"):
            comparison.validate_suite({"set": "all"}, {"set": "road-tests"})
        with self.assertRaisesRegex(ValueError, "same suite type"):
            comparison.validate_suite({"set": "all"}, base)
        self.assertIsNone(comparison.restrictions_at({"features": "city", "without": ["restrictions"], "hour": 4}))
        self.assertEqual(comparison.restrictions_at({"features": "city", "hour": 4}), 4)
        self.assertEqual(comparison.route_changes({"failures": ["b", "a", "b"]}, {"failures": ["a", "b"]}), {})
        self.assertEqual(comparison.route_changes({"failures": ["a"]}, {"failures": None}), {})

    def test_csv_distinguishes_negative_numbers_from_formula_strings(self):
        content = format_output({"rates": [{"value": -7, "id": "-route"}, {"value": -3, "id": "@route"}]}, "csv")
        rows = list(csv.DictReader(io.StringIO(content)))
        self.assertEqual([row["value"] for row in rows], ["-7", "-3"])
        self.assertEqual([row["id"] for row in rows], ["'-route", "'@route"])
