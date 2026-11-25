import unittest

import helpers  # noqa: F401
from scripts.run_insights import changes, comparison


def report(name, left, right):
    return changes.REPORTS[f"changes-{name}"][1](left, right)


class ChangeReportsTests(unittest.TestCase):
    def test_each_contribution_report_uses_its_own_saved_field(self):
        columns = (
            "time_s",
            "distance_m",
            "stopped_s",
            "speeding_s",
            "off_road_s",
            "collisions",
            "at_fault",
            "red_lights",
            "stop_signs",
            "failed_to_yield",
            "safety_brakes",
            "hard_brakes",
            "lane_changes",
            "deadlocks",
            "fallbacks",
            "calls",
            "tokens",
            "decisions",
            "cost_usd",
            "flagged_choices",
            "model_decisions",
            "local_decisions",
            "fallback_decisions",
            "partial_decisions",
        )
        values = dict(zip(columns, range(1, 25), strict=True))
        for field, value in values.items():
            with self.subTest(field=field):
                result = report(
                    field.replace("_", "-"), [{"id": "r", **dict.fromkeys(columns, 0)}], [{"id": "r", **values}]
                )
                self.assertEqual(result["totals"]["change"], value)
                self.assertEqual(result["rows"], [{"id": "r", "before": 0, "after": value, "change": value}])

    def test_counterbalance_and_coverage(self):
        left = [{"id": id_, "time_s": x} for id_, x in zip("abcdefg", (5, 6, 1, None, 2, None, 3), strict=True)]
        right = [{"id": id_, "time_s": x} for id_, x in zip("abcdefg", (2, 9, 1, 3, None, None, 5), strict=True)]
        result = report("time-s", left, right)
        self.assertEqual([row["id"] for row in result["rows"]], ["a", "b", "g"])
        self.assertEqual(result["totals"], {"change": 2, "increase": 5, "decrease": -3, "unchanged_pairs": 1})
        self.assertEqual(
            result["coverage"],
            {"pairs": 7, "both": 4, "baseline_only": 1, "comparison_only": 1, "neither": 1},
        )

    def test_no_measurements_and_zero_changes_are_distinguishable(self):
        missing = report("calls", [{"id": "a"}], [{"id": "a"}])
        same = report("calls", [{"id": "a", "calls": 0}], [{"id": "a", "calls": 0}])
        self.assertIsNone(missing["totals"]["change"])
        self.assertEqual(same["totals"]["change"], 0)
        self.assertEqual(same["totals"]["unchanged_pairs"], 1)

    def test_transition_reports(self):
        left = [
            {"id": "a", "pass": False, "arrived": False, "time_s": 30, "failures": ["timeout"]},
            {"id": "b", "pass": True, "arrived": True, "parked": True, "time_s": 20},
            {"id": "c", "pass": "true", "arrived": False},
        ]
        right = [
            {"id": "a", "pass": True, "arrived": True, "parked": True, "time_s": 20, "failures": []},
            {"id": "b", "pass": False, "arrived": False, "parked": False, "time_s": 40},
            {"id": "c", "pass": True},
        ]
        for name, before, after in (
            ("verdict-flow", "unknown", "passed"),
            ("arrival-flow", "unfinished", "unknown"),
            ("parking-flow", "parked", "did not arrive"),
        ):
            with self.subTest(name=name):
                rows = report(name, left, right)["rows"]
                self.assertIn({"before": before, "after": after, "routes": 1}, rows)
                self.assertEqual(sum(row["routes"] for row in rows), 3)
        for name, ids in (
            ("new-passes", ["a"]),
            ("lost-arrivals", ["b"]),
            ("recovered-arrivals", ["a"]),
        ):
            self.assertEqual([row["id"] for row in report(name, left, right)["rows"]], ids)
        tradeoffs = report("time-by-verdict", left, right)
        self.assertEqual(tradeoffs["coverage"], {"pairs": 3, "pairs_with_time": 2})
        self.assertEqual({row["before"]: row["median"] for row in tradeoffs["rows"]}, {"failed": -10, "passed": 20})

    def test_reason_flow_requires_labels_on_both_sides(self):
        left = [{"failures": ["a", "a", "b"]}, {"failures": None}, {"failures": []}]
        right = [{"failures": ["b", "c"]}, {"failures": ["a"]}, {"failures": ["a"]}]
        result = report("failure-reasons", left, right)
        self.assertEqual(result["coverage"], {"pairs": 3, "labeled_pairs": 2})
        self.assertEqual(
            result["rows"],
            [
                {"reason": "a", "added": 1, "removed": 1, "retained": 0},
                {"reason": "b", "added": 0, "removed": 0, "retained": 1},
                {"reason": "c", "added": 1, "removed": 0, "retained": 0},
            ],
        )

    def test_flag_flow_requires_check_maps_on_both_sides(self):
        left = [{"flagged_by_check": {"yield": 2}}, {"flagged_by_check": {}}, {"flagged_by_check": {"yield": True}}]
        right = [
            {"flagged_by_check": {"yield": 1}},
            {"flagged_by_check": {"yield": 1}},
            {"flagged_by_check": {"yield": 5}},
        ]
        result = report("flag-checks", left, right)
        self.assertEqual(result["coverage"]["pairs_with_check_maps"], 2)
        self.assertEqual(
            result["rows"],
            [{"check": "yield", "before": 2, "after": 2, "increased_on": 1, "decreased_on": 1, "change": 0}],
        )

    def test_new_exception_regresses_an_already_failed_drive(self):
        before = {"id": "a", "pass": False, "failures": ["timeout"]}
        after = {"id": "a", "pass": False, "failures": ["simulation error"], "simulation_error": "step failed"}
        regressions = comparison.assess_regression([before], [after])
        self.assertTrue(regressions["regressed"])
        self.assertEqual(regressions["new_simulation_errors"], [{"id": "a", "error": "step failed"}])
        self.assertEqual(regressions["new_audit_failures"], [])
        self.assertFalse(comparison.assess_regression([after], [after])["regressed"])

    def test_missing_legacy_arena_conditions_do_not_block_matching(self):
        before = [{"id": "a", "map": "kitsilano", "version": 1}]
        after = [{"id": "a", "map": "kitsilano"}]
        config = {"kind": "arena"}
        routes, _, _, _ = comparison.match_routes("first", config, before, "second", config, after)
        self.assertEqual(routes["matched"], ["a"])

    def test_reordered_results_match_by_id_in_baseline_order(self):
        baseline = [{"id": "b", "time_s": 80}, {"id": "a", "time_s": 10}]
        after = [{"id": "a", "time_s": 13}, {"id": "b", "time_s": 70}]
        config = {"kind": "arena"}
        output = comparison.compare(
            ("first", config, baseline), ("second", config, after), {}, {"time": lambda a, b: report("time-s", a, b)}
        )
        self.assertEqual(output["routes"]["matched"], ["b", "a"])
        self.assertEqual([item["change"] for item in output["reports"]["time"]["rows"]], [-10, 3])

    def test_core_fields_are_required_but_untouched_optional_audits_are_not(self):
        row = {"id": "r", "pass": True, "failures": [], "collisions": 0, "red_lights": 0, "failed_to_yield": 0}
        before = [row]
        coverage = comparison.assess_regression(before, before)["coverage"]
        self.assertEqual(coverage["missing_traffic_counts"], {"stop_signs": 1})
        before = [{**row, "stop_signs": 0}]
        self.assertFalse(comparison.assess_regression(before, before)["coverage"]["incomplete"])

    def test_default_city_hour_matches_an_explicit_clock(self):
        self.assertEqual(comparison.condition_differences({"features": "city"}, {"features": "city", "hour": 15.5}), {})
        self.assertEqual(
            comparison.condition_differences({}, {"hour": 15.5}), {"hour": {"baseline": None, "comparison": 15.5}}
        )
