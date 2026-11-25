import unittest

import helpers  # noqa: F401
from scripts.run_insights import evidence, outcomes, profiles


def report(name, *rows):
    return evidence.REPORTS[f"evidence-{name}"][1](rows)


class EvidenceTests(unittest.TestCase):
    def test_validators_have_positive_and_negative_examples(self):
        cases = (
            ("missing-verdicts", {"pass": "true"}, {"pass": False}, "value", "true"),
            ("invalid-failure-lists", {"failures": ["stop sign", None]}, {}, "value", ["stop sign", None]),
            (
                "passed-errors",
                {"pass": True, "simulation_error": "oops"},
                {"pass": False, "simulation_error": "oops"},
                "simulation_error",
                "oops",
            ),
            (
                "passed-interruptions",
                {"pass": True, "stopped": True},
                {"pass": True, "stopped": "true"},
                "stopped",
                True,
            ),
            (
                "collision-fault-count",
                {"at_fault": 2, "collisions": 1},
                {"at_fault": 1, "collisions": 1},
                "at_fault",
                2,
            ),
            ("stopped-duration", {"stopped_s": 2, "time_s": 1}, {"stopped_s": 1.1, "time_s": 1}, "stopped_s", 2),
            ("speeding-duration", {"speeding_s": 2, "time_s": 1}, {"speeding_s": 1.1, "time_s": 1}, "speeding_s", 2),
            ("off-road-duration", {"off_road_s": 2, "time_s": 1}, {"off_road_s": 1.1, "time_s": 1}, "off_road_s", 2),
            (
                "latency-order",
                {"latency_p50_ms": 2, "latency_p95_ms": 1},
                {"latency_p50_ms": 1, "latency_p95_ms": 1},
                "latency_p95_ms",
                1,
            ),
            (
                "partial-count",
                {"partial_decisions": 2, "model_decisions": 1},
                {"partial_decisions": 2},
                "partial_decisions",
                2,
            ),
            (
                "decision-attribution-total",
                {"model_decisions": 1, "local_decisions": 1, "fallback_decisions": 0, "decisions": 3},
                {"model_decisions": 1, "local_decisions": 1, "decisions": 3},
                "attributed",
                2,
            ),
            (
                "decision-share-total",
                {"model_share": 0, "local_share": 0, "fallback_share": 0.5},
                {"model_share": 0.333, "local_share": 0.333, "fallback_share": 0.333},
                "share_total",
                0.5,
            ),
            (
                "flag-check-total",
                {"flagged_choices": 2, "flagged_by_check": {"yield": 3}},
                {"flagged_choices": 2, "flagged_by_check": {"yield": True}},
                "by_check_total",
                3,
            ),
            (
                "flags-without-decisions",
                {"flagged_choices": 2, "decisions": 0},
                {"flagged_choices": 0, "decisions": 0},
                "flagged_choices",
                2,
            ),
            ("spend-without-calls", {"cost_usd": 1, "calls": 0}, {"cost_usd": 1}, "cost_usd", 1),
            ("fractional-collisions", {"collisions": 1.5}, {"collisions": True}, "value", 1.5),
            ("fractional-decisions", {"decisions": 1.5}, {"decisions": 2.0}, "value", 1.5),
            (
                "unlabeled-collisions",
                {"collisions": 1, "failures": []},
                {"collisions": 1, "failures": ["collision"]},
                "failures",
                [],
            ),
            (
                "collision-log-gap",
                {"collisions": 1, "events": []},
                {"collisions": 1, "events": [{"type": "fallback"}] * 50},
                "retained",
                0,
            ),
            (
                "events-after-end",
                {"time_s": 1, "events": [{"type": "fallback", "t": 1.2}]},
                {"time_s": 1, "events": [{"type": "fallback", "t": 1.1}]},
                "event_indexes",
                [0],
            ),
            (
                "final-context",
                {"diagnostics": {"final": {"nearby": [{"id": 42}]}}},
                {"diagnostics": {"final": []}},
                "final",
                {"nearby": [{"id": 42}]},
            ),
            (
                "unmeasured-audit-samples",
                {"diagnostics": {"incidents": [{"audit": "red_lights_run"}]}},
                {"red_lights": 0, "diagnostics": {"incidents": [{"audit": "red_lights_run"}]}},
                "fields",
                ["red_lights"],
            ),
        )
        for name, anomalous, valid, key, expected in cases:
            with self.subTest(name=name):
                result = report(name, {"id": "valid", **valid}, {"id": "anomaly", **anomalous})
                self.assertEqual(len(result["rows"]), 1)
                self.assertEqual(result["rows"][0]["row_index"], 1)
                self.assertEqual(result["rows"][0][key], expected)

    def test_event_counts_and_coverage(self):
        log = [{"type": "collision", "fault": "shared", "kind": "car"}] * 2
        result = report("event-frequency", {"events": log}, {"events": []}, {}, {"events": [{}]})
        self.assertEqual(result["rows"], [{"type": "collision", "occurrences": 2, "routes": 1}])
        self.assertEqual(result["coverage"], {"measured_logs": 2, "capped_logs": 0, "selected_routes": 4})
        coverage = report(
            "event-log-coverage", {"events": log * 25}, {"events": [{}]}, {"events": []}, {"events": log}, {}
        )
        self.assertEqual(
            {row["status"]: row["routes"] for row in coverage["rows"]},
            dict.fromkeys(("absent", "capped", "malformed", "empty", "present"), 1),
        )

    def test_event_field_reports_support_legacy_payloads(self):
        row = {
            "events": [
                {"type": "collision", "fault": "shared", "kind": "car"},
                {"type": "collision", "fault": "ego", "kind": "building"},
                {"type": "collision"},
                {"type": "fallback", "status": 429},
                {"type": "fallback"},
            ]
        }
        for name, expected in (
            ("collision-kinds", {"building": 1, "car": 1}),
            ("collision-faults", {"ego": 1, "shared": 1}),
            ("fallback-status", {"429": 1}),
        ):
            with self.subTest(name=name):
                result = report(name, row)
                self.assertEqual(result["coverage"]["unclassified_events"], 1)
                self.assertEqual({entry["label"]: entry["events"] for entry in result["rows"]}, expected)

    def test_audit_samples_and_presence(self):
        valid = {"audit": "red_lights_run", "t": 1, "street": "Oak", "events": [{"type": "red_light"}]}
        result = report("audit-samples", {"id": "a", "diagnostics": {"incidents": [None, valid]}})
        self.assertEqual(
            result["rows"],
            [{"id": "a", "sample_index": 1, "audit": "red_lights_run", "time_s": 1, "street": "Oak", "sample": valid}],
        )
        coverage = report("audit-coverage", {}, {"red_lights": 0}, {"red_lights": False})
        signals = next(entry for entry in coverage["rows"] if entry["field"] == "red_lights")
        self.assertEqual(
            signals, {"field": "red_lights", "unit": "violations", "observed": 1, "absent": 1, "invalid": 1}
        )

    def test_outcome_and_profile_share_capped_reroute_policy(self):
        capped = {"pass": True, "events": [{"type": "fallback"}] * 50}
        output = outcomes.REPORTS["suite-reroute-outcomes"][1]([capped])
        self.assertEqual(output, {"unknown (retention limit)": {"passed": 1}})
        self.assertEqual(profiles.rerouting(capped), "unknown (retention limit)")
        capped["events"][49] = {"type": "reroute"}
        self.assertEqual(profiles.rerouting(capped), "reroute observed")

    def test_existing_malformed_diagnostic_rows_are_unmeasured(self):
        self.assertIsNone(outcomes.events({"events": [{"type": "collision"}, None]}))
        self.assertIsNone(outcomes.reasons({"failures": ["collision", False]}))
        self.assertIsNone(outcomes.tag({"tags": {"signals": 2.5}}, "signals"))
        self.assertIsNone(outcomes.tag({"tags": {"length_m": -2}}, "length_m"))
        self.assertEqual(outcomes.tag({"tags": {"length_m": 2.5}}, "length_m"), 2.5)

    def test_event_labels_do_not_repair_a_decreasing_timeline(self):
        row = {"id": "a", "events": [{"type": "evt", "t": t} for t in (4, 1, 2, 4)]}
        issues = outcomes.invalid_event_times([row])
        self.assertEqual([issue["event_index"] for issue in issues], [1, 2])

    def test_nonpositive_rate_denominators_and_nonfinite_totals(self):
        self.assertIsNone(profiles.ratio(1, -2))
        self.assertIsNone(profiles.ratio(1, float("inf")))
        self.assertIsNone(profiles.ratio(float("inf"), 1))
        self.assertEqual(profiles.ratio(0, 1), 0)
