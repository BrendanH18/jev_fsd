import unittest

import helpers  # noqa: F401
from scripts.run_insights import repeats, scores


ARENA = {"kind": "arena", "brain": "rules", "set": "all", "engine": "node v22"}
BENCH = {"map": "kitsilano", "pack": 6, "seed": 1, "count": 3}
TAGS = {"length_m": 550, "lefts": 0, "rights": 0, "signals": 1, "stops": 2}
SCORED = {
    "arrived": True,
    "time_s": 58,
    "distance_m": 750,
    "tags": TAGS,
    "rms_jerk": 4,
    "hard_brakes": 2,
    "max_lat_accel": 5,
    "collisions": 0,
    "safety_brakes": 1,
    "min_ttc_s": 3,
    "min_headway_s": 1.2,
}


def report(name, panel, count=2):
    return repeats.REPORTS[f"repeat-{name}"][1](panel, count)


class RepeatReportsTests(unittest.TestCase):
    def test_each_additive_and_extreme_measurement_preserves_its_units(self):
        first = {
            "time_s": 1,
            "distance_m": 2,
            "collisions": 3,
            "at_fault": 4,
            "red_lights": 5,
            "stop_signs": 6,
            "failed_to_yield": 7,
            "off_road_s": 8,
            "fallbacks": 9,
            "safety_brakes": 10,
            "hard_brakes": 11,
            "cost_usd": 12,
            "decisions": 13,
            "max_decel": -14,
            "min_ttc_s": 15,
            "min_headway_s": 16,
            "max_lat_accel": 17,
        }
        last = {field: 3 * value for field, value in first.items()}
        middle = {field: 2 * value for field, value in first.items()}
        panel = {"a": [first, last], "b": [middle, middle]}
        additive = (
            "time",
            "distance",
            "collisions",
            "at-fault-collisions",
            "red-light-violations",
            "stop-sign-violations",
            "yield-violations",
            "off-road-time",
            "fallback-incidents",
            "safety-brakes",
            "hard-brakes",
            "spend",
            "decision-volume",
        )
        for name, unit in zip(additive, range(1, 14), strict=True):
            with self.subTest(name=name):
                values = report(name, panel)
                self.assertEqual([r["value"] for r in values["attempts"]], [3 * unit, 5 * unit])
                self.assertEqual(values["spread"]["range"], 2 * unit)
        for name, expected in (
            ("peak-deceleration", [-28, -42]),
            ("shortest-ttc", [15, 30]),
            ("shortest-headway", [16, 32]),
            ("peak-lateral-load", [34, 51]),
        ):
            with self.subTest(name=name):
                self.assertEqual([r["value"] for r in report(name, panel)["attempts"]], expected)

    def test_each_pooled_rate_uses_its_own_numerator_and_exposure(self):
        a = {
            "decisions": 20,
            "flagged_choices": 3,
            "fallback_decisions": 4,
            "safety_brakes": 5,
            "model_decisions": 10,
            "local_decisions": 6,
            "calls": 2,
            "partial_decisions": 2,
            "cost_usd": 1,
            "tokens": 40,
        }
        b = {
            "decisions": 80,
            "flagged_choices": 4,
            "fallback_decisions": 1,
            "safety_brakes": 0,
            "model_decisions": 20,
            "local_decisions": 59,
            "calls": 8,
            "partial_decisions": 1,
            "cost_usd": 3,
            "tokens": 30,
        }
        cases = (
            ("flagged-decision-rate", 0.07),
            ("fallback-decision-rate", 0.05),
            ("safety-brake-rate", 0.05),
            ("model-decision-rate", 0.30),
            ("local-decision-rate", 0.65),
            ("partial-answer-rate", 0.10),
            ("cost-per-call", 0.40),
            ("tokens-per-call", 7),
        )
        for key, expected in cases:
            with self.subTest(key=key):
                result = report(key, {"a": [a, b], "b": [b, a]})
                self.assertEqual([row["value"] for row in result["attempts"]], [expected, expected])

    def test_scores_follow_existing_formula_but_require_saved_inputs(self):
        panel = {"legacy": [{"pass": True}, {"pass": True}], "scored": [SCORED, {**SCORED, "time_s": 70}]}
        for name, field in (
            ("driving-score", "score"),
            ("pace-score", "pace"),
            ("comfort-score", "comfort"),
            ("margin-score", "margin"),
        ):
            with self.subTest(name=name):
                result = report(name, panel)
                self.assertEqual(result["coverage"], {"matched_routes": 2, "complete_routes": 1})
                self.assertEqual(
                    [r["value"] for r in result["attempts"]], [scores.raw_scores(row)[field] for row in panel["scored"]]
                )

    def test_binary_panels_keep_unknown_values_visible(self):
        panel = {
            "known": [
                {"pass": True, "arrived": False, "parked": False},
                {"pass": False, "arrived": True, "parked": False},
            ],
            "unknown": [{"pass": "true", "arrived": 1, "parked": None}, {"pass": True, "arrived": True}],
            "parking": [{"arrived": True, "parked": False}, {"arrived": True, "parked": True}],
            "no-space": [{"arrived": True, "parked": None, "no_space": True}, {"arrived": True, "parked": True}],
        }
        for name, expected in (
            ("pass-rate", [1, 0]),
            ("arrival-rate", [2 / 3, 1]),
            ("parking-success", [0, 1]),
        ):
            with self.subTest(name=name):
                result = report(name, panel)
                self.assertEqual([row["value"] for row in result["attempts"]], expected)
        self.assertEqual(report("arrival-rate", panel)["rows"][1]["values"], [None, 1])
        self.assertEqual(report("parking-success", panel)["rows"][-1]["values"], [None, 1])

    def test_positive_exposure_is_required_per_attempt(self):
        panel = {
            "zero": [{"flagged_choices": 0, "decisions": 10}, {"flagged_choices": 0, "decisions": 2}],
            "incomplete": [{"flagged_choices": 3, "decisions": 0}, {"flagged_choices": 2, "decisions": 10}],
            "unobserved": [{"decisions": 10}, {"decisions": 10}],
        }
        result = report("flagged-decision-rate", panel)
        self.assertEqual(result["coverage"]["complete_routes"], 1)
        self.assertEqual(result["rows"][1]["values"], [None, 0.2])
        self.assertEqual(result["rows"][1]["unavailable"], 1)
        self.assertIsNone(result["rows"][2]["range"])
        self.assertEqual(result["spread"]["range"], 0)
        self.assertEqual([r["value"] for r in result["attempts"]], [0, 0])
        self.assertIsNone(report("flagged-decision-rate", {"no": panel["unobserved"]})["spread"]["median"])

    def test_reasons_are_deduplicated_with_an_explicit_denominator(self):
        panel = {
            "a": [{"failures": ["a", "a", "b"]}, {"failures": ["a", "b"]}, {"failures": ["b"]}],
            "b": [{"failures": ["c"]}, {"failures": None}, {"failures": ["c"]}],
        }
        rows = report("failures", panel, 3)["rows"]
        self.assertEqual([row["occurrences"] for row in rows], [2, 3, 2])
        self.assertEqual([row["labeled_attempts"] for row in rows], [3, 3, 2])
        self.assertEqual([row["every_attempt"] for row in rows], [False, True, False])
        self.assertTrue(all(row["recurring"] for row in rows))

    def test_attempt_coverage_and_verdict_change(self):
        panel = {
            "changed": [{"pass": True, "failures": []}, {"pass": False, "failures": ["collision"]}],
            "unknown": [{}, {"pass": True}],
        }
        coverage = report("coverage", panel)["rows"]
        self.assertEqual([row["recorded_verdicts"] for row in coverage], [1, 2])
        self.assertEqual([row["recorded_failure_lists"] for row in coverage], [1, 1])
        verdicts = report("verdicts", panel)["rows"]
        self.assertEqual(verdicts[0]["verdicts"], ["passed", "failed"])
        self.assertTrue(verdicts[0]["changed"])
        self.assertFalse(verdicts[1]["changed"])
        self.assertEqual(verdicts[1]["unknown_attempts"], 1)

    def test_panel_explains_every_geometry_and_membership_exclusion(self):
        complete = {"id": "r", "tags": TAGS}
        first = [
            complete,
            {"id": "missing"},
            {"id": "no-tags"},
            {"id": "geometry", "tags": TAGS},
            {"id": "stop", "tags": TAGS},
        ]
        second = [
            {"id": "added"},
            {"id": "geometry", "tags": {**TAGS, "lefts": 1}},
            {"id": "no-tags"},
            {**complete, "pass": True},
            {"id": "stop", "tags": TAGS, "stopped": True},
        ]
        panel, excluded = repeats.panels([("first", BENCH, first), ("second", BENCH, second)])
        self.assertEqual(list(panel), ["r"])
        self.assertEqual([row.get("pass") for row in panel["r"]], [None, True])
        self.assertEqual(
            excluded,
            [
                {"id": "missing", "reason": "missing attempt", "attempts": [2]},
                {"id": "no-tags", "reason": "missing route tags"},
                {"id": "geometry", "reason": "changed route tags"},
                {"id": "stop", "reason": "interrupted drive", "attempts": [2]},
                {"id": "added", "reason": "missing attempt", "attempts": [1]},
            ],
        )

    def test_duplicate_and_conflicting_metadata_is_rejected(self):
        a, b, c = {"id": "r"}, {"id": "r", "version": 1}, {"id": "r", "version": 2}
        with self.assertRaisesRegex(ValueError, "repeat drive conditions differ: version"):
            repeats.validate_inputs([("a", ARENA, [a]), ("b", ARENA, [b]), ("c", ARENA, [c])])
        with self.assertRaisesRegex(ValueError, "duplicate route ID"):
            repeats.validate_inputs([("a", ARENA, [a]), ("b", ARENA, [b, b])])
        for field, value in (("brain", "jev"), ("track", "open"), ("engine", "node v24"), ("suite_version", "custom")):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, field):
                repeats.validate_inputs([("a", ARENA, [a]), ("b", {**ARENA, field: value}, [a])])

    def test_top_truncates_details_without_changing_any_aggregates(self):
        rows = [{"id": "a", "pass": True}, {"id": "b", "pass": False}]
        runs = [("a", ARENA, rows), ("b", ARENA, rows)]
        full = repeats.build(runs, ["repeat-pass-rate"])
        limited = repeats.build(runs, ["repeat-pass-rate"], limit=1)
        self.assertEqual(full["routes"], limited["routes"])
        self.assertEqual(full["attempts"], limited["attempts"])
        all_routes, one_route = (result["reports"]["repeat-pass-rate"] for result in (full, limited))
        self.assertEqual(len(one_route["rows"]), 1)
        self.assertEqual(one_route["spread"], all_routes["spread"])
        self.assertEqual(one_route["attempts"], all_routes["attempts"])
