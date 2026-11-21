"""Decision reports use compatible route cohorts and respect optional telemetry."""

import json
import unittest

import helpers  # noqa: F401 (puts the repository on sys.path)
from scripts.run_insights.decisions import REPORTS


class DecisionReportsTest(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {
                "id": "short",
                "pass": True,
                "decisions": 3,
                "calls": 2,
                "tokens": 400,
                "cost_usd": 0.2,
                "time_s": 60,
                "distance_m": 500,
                "model_decisions": 2,
                "local_decisions": 1,
                "fallback_decisions": 0,
                "partial_decisions": 1,
                "fallbacks": 0,
                "latency_p50_ms": 100,
                "latency_p95_ms": 150,
                "flagged_choices": 1,
                "flagged_by_check": {"a": 1},
            },
            {
                "id": "long",
                "pass": False,
                "decisions": 7,
                "calls": 1,
                "tokens": 200,
                "cost_usd": 0.4,
                "time_s": 180,
                "distance_m": 1500,
                "model_decisions": 0,
                "local_decisions": 6,
                "fallback_decisions": 1,
                "partial_decisions": 0,
                "fallbacks": 1,
                "latency_p50_ms": 80,
                "latency_p95_ms": 200,
                "flagged_choices": 0,
                "flagged_by_check": {},
            },
            {"id": "local", "model_decisions": 0, "local_decisions": 1, "fallback_decisions": 0},
            {"id": "old", "fallbacks": 1},
            {},
        ]

    def report(self, key):
        return REPORTS[key][1](self.rows)

    def test_weighted_rates_use_only_paired_measurements(self):
        expected = {
            "partial-answer-rate": (2, 0.5),
            "decision-cadence": (2, 2.5),
            "calls-per-decision": (2, 0.3),
            "calls-per-km": (2, 1.5),
            "tokens-per-call": (2, 200),
            "cost-per-call": (2, 0.2),
            "cost-per-km": (2, 0.3),
            "cost-per-drive-hour": (2, 9),
            "flagged-decision-rate": (2, 0.1),
        }
        for key, (n, rate) in expected.items():
            with self.subTest(key=key):
                self.assertEqual(self.report(key)["routes_measured"], n)
                self.assertAlmostEqual(self.report(key)["rate"], rate)

    def test_source_counts_and_routes(self):
        self.assertEqual(self.report("attribution-coverage")["coverage"], 3 / 5)
        mix = self.report("decision-sources")
        self.assertEqual(mix["counts"], {"model_decisions": 2, "local_decisions": 8, "fallback_decisions": 1})
        self.assertAlmostEqual(mix["shares"]["local_decisions"], 8 / 11)
        self.assertEqual(self.report("fallback-free-passes")["without_fallback"], ["short"])
        self.assertEqual(self.report("local-only-routes"), ["local"])
        self.assertEqual(self.report("fallback-decision-ranking")[0]["id"], "long")
        self.assertAlmostEqual(self.report("fallback-exposure")["affected_share"], 2 / 3)

    def test_resources_and_latency(self):
        self.assertAlmostEqual(self.report("cost-per-pass")["usd_per_pass"], 0.6)
        self.assertEqual(self.report("spend-by-outcome")["failed"], {"routes": 1, "cost_usd": 0.4})
        self.assertAlmostEqual(self.report("spend-concentration")[0]["share_of_spend"], 2 / 3)
        self.assertEqual(self.report("token-demand")[0]["id"], "short")
        self.assertEqual(self.report("median-call-latency")[0]["id"], "short")
        self.assertEqual(self.report("tail-call-latency")[0]["id"], "long")
        self.assertEqual(self.report("latency-tail-inflation")[0], {"id": "long", "p95_over_p50": 2.5})
        self.rows.append({"id": "missing-timings", "calls": 1, "latency_p50_ms": None})
        self.assertAlmostEqual(self.report("latency-coverage")["coverage"], 2 / 3)

    def test_open_track_reporting(self):
        self.assertEqual(self.report("flagged-check-frequency"), {"routes_measured": 2, "by_check": {"a": 1}})
        outcomes = self.report("flagged-route-outcomes")
        self.assertEqual(outcomes["with_flags"], {"routes": 1, "passed": 1, "pass_rate": 1})
        self.assertEqual(outcomes["without_flags"], {"routes": 1, "passed": 0, "pass_rate": 0})

    def test_missing_and_zero_are_distinct_and_all_reports_are_json(self):
        self.assertEqual(len(REPORTS), 25)
        self.rows = [{"calls": None, "tokens": 50}, {"calls": 0, "tokens": 0}, {"calls": True, "tokens": 5}]
        result = self.report("tokens-per-call")
        self.assertEqual(result, {"routes_measured": 1, "numerator_total": 0, "denominator_total": 0, "rate": None})
        self.rows = []
        self.assertIsNone(self.report("tokens-per-call")["numerator_total"])
        for key in REPORTS:
            with self.subTest(key=key):
                json.dumps(self.report(key), allow_nan=False)
