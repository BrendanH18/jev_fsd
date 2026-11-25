import csv
import gzip
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import helpers  # noqa: F401 (puts the repository on sys.path)
from scripts.run_insights.comparison import validate_suite
from scripts.run_insights.outcomes import REPORTS


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "scripts" / "inspect_run.py"
SAMPLE = ROOT / "data/runs/20261120-120000-rules.json"
PREVIOUS = ROOT / "data/runs/20261112-190015-rules.json"
OPEN_ARENA = ROOT / "data/results/2026-11-20/claude-haiku-open.json"


class InspectRunTests(unittest.TestCase):
    def test_inventory_and_saved_run(self):
        catalog = subprocess.check_output([sys.executable, CLI, "--list"], text=True)
        names = [line.split()[0] for line in catalog.splitlines()]
        result = json.loads(subprocess.check_output([sys.executable, CLI, SAMPLE]))
        self.assertEqual(
            result["motion-progress"]["routes"], [{"id": "s1-1", "value": 100}, {"id": "s1-2", "value": 100}]
        )
        self.assertEqual(len(names), 100)
        self.assertEqual(list(result), names)
        self.assertEqual(result["suite-verdicts"]["counts"], {"passed": 2})

    def test_incomplete_measurements(self):
        rows = [{"arrived": False, "deadlocks": float("inf")}, {"arrived": False, "events": "missing"}]
        self.assertEqual(REPORTS["suite-final-events"][1](rows), {"measured_routes": 0, "counts": {}})
        self.assertEqual(REPORTS["suite-deadlock-outcomes"][1](rows), {"unknown": {"unknown": 2}})

    def test_compare_saved_runs(self):
        output = subprocess.check_output([sys.executable, CLI, PREVIOUS, "--compare", SAMPLE, "suite-verdicts"])
        comparison = json.loads(output)
        self.assertEqual(comparison["routes"]["matched"], ["s1-1", "s1-2"])
        self.assertEqual(
            comparison["outcome_changes"],
            [
                {
                    "id": "s1-1",
                    "verdict": {"baseline": "failed", "comparison": "passed"},
                    "failures_added": [],
                    "failures_removed": ["failed to yield"],
                }
            ],
        )
        self.assertEqual(
            comparison["reports"],
            {
                "suite-verdicts": {
                    "baseline": {"measured_routes": 2, "counts": {"failed": 1, "passed": 1}},
                    "comparison": {"measured_routes": 2, "counts": {"passed": 2}},
                }
            },
        )

    def test_compare_partial_runs_and_unknown_measurements(self):
        tags = {"length_m": 500, "signals": 0, "stops": 0, "lefts": 0, "rights": 0}
        base_config = {"map": "kitsilano", "bbox": [1, 2, 3, 4], "pack": 6, "seed": 2, "count": 5}
        matched = {"id": "s2-1", "tags": tags, "pass": True}
        base_rows = [matched] + [{"id": f"s2-{n}", "tags": tags} for n in (2, 3, 4)]
        changed = {"id": "s2-3", "tags": {**tags, "signals": 2}}
        other_rows = [changed, {"id": "s2-4"}, {"id": "s2-5", "tags": tags}, {**matched, "ice_overspeed": 0}]
        other_config = {**base_config, "map": "browser-cache-key", "pack": "6", "track": "open"}
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "before.json"
            other = Path(directory) / "after.json"
            base.write_text(json.dumps({"config": base_config, "results": base_rows}))
            other.write_text(json.dumps({"config": other_config, "results": other_rows}))
            output = subprocess.check_output([sys.executable, CLI, base, "safety-winter-surfaces", "--compare", other])
        comparison = json.loads(output)
        self.assertEqual(
            comparison["routes"],
            {
                "matched": ["s2-1"],
                "baseline_only": ["s2-2"],
                "comparison_only": ["s2-5"],
                "missing_tags": ["s2-4"],
                "changed_tags": ["s2-3"],
            },
        )
        self.assertEqual(comparison["baseline"]["config"]["track"], "guarded")
        self.assertEqual(comparison["comparison"]["config"]["track"], "open")
        winter = comparison["reports"]["safety-winter-surfaces"]
        self.assertIsNone(winter["baseline"]["ice_overspeed"]["total"])
        self.assertEqual(winter["comparison"]["ice_overspeed"]["total"], 0)

    def test_compare_rejects_unverifiable_inputs(self):
        baseline = json.loads(SAMPLE.read_text())
        config, rows = baseline["config"], baseline["results"]
        with tempfile.TemporaryDirectory() as directory:
            other = Path(directory) / "other.json"
            cases = [
                ({**config, "bbox": [0, 1, 2, 3]}, rows, "same map"),
                ({**config, "count": 12}, rows, "same count"),
                ({**config, "pack": 5}, rows, "same pack"),
                ({**config, "seed": 2}, rows, "same seed"),
                ({**config, "hour": 7}, rows, "same route restriction"),
                ({**config, "heldout": True}, rows, "held-out"),
                (config, [*rows, rows[0]], "duplicate route ID"),
                (config, [{}], "requires a route ID"),
            ]
            for changed_config, changed_rows, expected in cases:
                with self.subTest(expected=expected):
                    other.write_text(json.dumps({"config": changed_config, "results": changed_rows}))
                    error = subprocess.run([sys.executable, CLI, SAMPLE, "--compare", other], capture_output=True)
                    self.assertEqual(error.returncode, 2)
                    self.assertIn(expected.encode(), error.stderr)

    def test_compare_validates_route_config_types(self):
        config = {"bbox": [0, 1, 2, 3], "seed": 1, "count": 2, "pack": 6}
        with self.assertRaisesRegex(ValueError, "valid route restriction hour"):
            validate_suite(config, {**config, "features": "city", "hour": None})
        with self.assertRaisesRegex(ValueError, "same map"):
            validate_suite(config, {**config, "bbox": [False, True, 2, 3]})

    def test_selection_and_errors(self):
        output = subprocess.check_output([sys.executable, CLI, SAMPLE, "suite-verdicts"])
        self.assertEqual(list(json.loads(output)), ["suite-verdicts"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            for content in (
                "{",
                "[]",
                '{"results":[null]}',
                '{"results":[],"config":{"heldout":true}}',
                '{"results":[],"config":{"seed":101}}',
                '{"results":[],"config":{"seeds":[103]}}',
                '{"results":[{"id":"s102-1"}]}',
                '{"results":[{"time_s":NaN}]}',
            ):
                path.write_text(content)
                error = subprocess.run([sys.executable, CLI, path], capture_output=True)
                self.assertEqual(error.returncode, 2)
                self.assertNotIn(b"Traceback", error.stderr)

    def test_suite_diagnostics(self):
        rows = [
            {
                "id": "A",
                "pass": False,
                "arrived": True,
                "failures": ["a", "b", "b"],
                "tags": {"signals": 2, "stops": 0, "lefts": 1, "rights": 0, "length_m": 500},
                "events": [{"type": "reroute", "t": 8}],
                "parked": False,
                "deadlocks": 0,
                "safety_brakes": 2,
            },
            {"id": "B", "pass": True, "failures": []},
            {"id": "B", "pass": True, "failures": ["c"]},
            {
                "id": "C",
                "pass": False,
                "arrived": False,
                "failures": ["a"],
                "events": [{"type": "safety"}] * 50,
                "simulation_error": "example",
            },
        ]
        outputs = {k.removeprefix("suite-"): f(rows) for k, (_, f) in REPORTS.items()}
        expected = {
            "verdicts": {"measured_routes": 4, "counts": {"failed": 2, "passed": 2}},
            "arrival-verdicts": {"arrived": {"failed": 1}, "unknown": {"passed": 2}, "unfinished": {"failed": 1}},
            "failure-reasons": {"measured_routes": 4, "counts": {"a": 2, "b": 1, "c": 1}},
            "failure-pairs": {"measured_routes": 4, "pairs": [{"reasons": ("a", "b"), "routes": 1}]},
            "sole-failures": {"measured_routes": 4, "counts": {"a": 1}},
            "failure-burden": {"measured_routes": 4, "counts": {"0": 1, "1": 2, "2": 1}},
            "verdict-conflicts": ["B"],
            "simulation-errors": {"measured_routes": 4, "counts": {"example": 1}},
            "parking-outcomes": {"measured_routes": 1, "counts": {"did not park": 1}},
            "length-outcomes": {"500 to under 1000 m": {"failed": 1}, "unknown": {"passed": 2, "failed": 1}},
            "control-outcomes": {"signals only": {"failed": 1}, "unknown": {"passed": 2, "failed": 1}},
            "turn-outcomes": {"mostly left": {"failed": 1}, "unknown": {"passed": 2, "failed": 1}},
            "event-mix": {"measured_routes": 2, "counts": {"reroute": 1, "safety": 50}},
            "final-events": {"measured_routes": 0, "counts": {}},
            "first-reroute": [{"id": "A", "time_s": 8}],
            "reroute-outcomes": {
                "reroute observed": {"failed": 1},
                "none observed": {"failed": 1},
                "unknown": {"passed": 2},
            },
            "event-cap": ["C"],
            "pass-streak": ["B", "B"],
            "duplicate-ids": {"B": 2},
            "missing-tags": {
                "measured_routes": 4,
                "counts": dict.fromkeys(["signals", "stops", "lefts", "rights", "length_m"], 3),
            },
            "failed-distance": {"planned_m": 500, "measured_routes": 1},
            "failed-arrivals": [{"id": "A", "failures": ["a", "b"]}],
            "unfinished-reasons": {"measured_routes": 1, "counts": {"a": 1}},
            "deadlock-outcomes": {"none": {"failed": 1}, "unknown": {"passed": 2, "failed": 1}},
            "safety-brake-outcomes": {"observed": {"failed": 1}, "unknown": {"passed": 2, "failed": 1}},
        }
        self.assertEqual(outputs, expected)

    def test_gzip_and_arena_loading_and_comparison(self):
        with tempfile.TemporaryDirectory() as directory:
            gz_path = Path(directory) / "sample.json.gz"
            gz_path.write_bytes(gzip.compress(SAMPLE.read_bytes()))
            result = json.loads(subprocess.check_output([sys.executable, CLI, gz_path, "suite-verdicts"]))
            self.assertEqual(result["suite-verdicts"]["counts"], {"passed": 2})

            heldout_gz = Path(directory) / "heldout.json.gz"
            heldout_gz.write_bytes(gzip.compress(b'{"config":{"seed":101},"results":[]}'))
            error = subprocess.run([sys.executable, CLI, heldout_gz], capture_output=True)
            self.assertEqual(error.returncode, 2)
            self.assertIn(b"held-out", error.stderr)

            arena_a = Path(directory) / "arena_a.json.gz"
            arena_b = Path(directory) / "arena_b.json"
            a_data = {
                "summary": {"brain": "rules", "set": "challenges", "track": "guarded", "drives": 2},
                "results": [
                    {"challenge": "door-zone", "map": "kitsilano", "pass": True, "arrived": True, "time_s": 50},
                    {"challenge": "fog-junction", "map": "victoria", "pass": False, "arrived": False, "collisions": 1},
                ],
            }
            b_data = {
                "summary": {"brain": "jev", "set": "challenges", "track": "open", "drives": 2},
                "results": [
                    {"challenge": "door-zone", "map": "kitsilano", "pass": True, "arrived": True, "time_s": 40},
                    {"challenge": "fog-junction", "map": "victoria", "pass": True, "arrived": True, "collisions": 0},
                ],
            }
            arena_a.write_bytes(gzip.compress(json.dumps(a_data).encode("utf-8")))
            arena_b.write_text(json.dumps(b_data))
            cmp_out = json.loads(
                subprocess.check_output(
                    [sys.executable, CLI, arena_a, "--compare", arena_b, "scores-ranked", "paired-score-by-arrival"]
                )
            )
            self.assertEqual(cmp_out["routes"]["matched"], ["door-zone", "fog-junction"])
            self.assertEqual(
                cmp_out["condition_differences"],
                {
                    "track": {"baseline": "guarded", "comparison": "open"},
                    "driver": {"baseline": "rules", "comparison": "jev"},
                },
            )
            self.assertEqual(cmp_out["reports"]["scores-ranked"]["baseline"]["routes"][0]["id"], "door-zone")

            a_data["results"][0]["seed"] = 1
            b_data["results"][0]["seed"] = 2
            arena_a.write_bytes(gzip.compress(json.dumps(a_data).encode("utf-8")))
            arena_b.write_text(json.dumps(b_data))
            changed = json.loads(
                subprocess.check_output([sys.executable, CLI, arena_a, "--compare", arena_b, "scores-ranked"])
            )
            self.assertEqual(changed["routes"]["matched"], ["fog-junction"])
            self.assertEqual(changed["routes"]["changed_tags"], ["door-zone"])

            # Existing committed arena file normalizes challenge -> id.
            open_ranked = json.loads(
                subprocess.check_output([sys.executable, CLI, OPEN_ARENA, "scores-ranked", "--top", "3"])
            )
            self.assertEqual(len(open_ranked["scores-ranked"]["routes"]), 3)
            self.assertTrue(all(r["id"] for r in open_ranked["scores-ranked"]["routes"]))

    def test_formats_summary_filters_and_list_modes(self):
        # --list-scores, --list-analytics, --list-paired-metrics, --filter
        score_list = subprocess.check_output([sys.executable, CLI, "--list-scores"], text=True).splitlines()
        self.assertEqual(len(score_list), 12)
        analytics_list = subprocess.check_output([sys.executable, CLI, "--list-analytics"], text=True).splitlines()
        self.assertEqual(len(analytics_list), 20)
        paired_list = subprocess.check_output([sys.executable, CLI, "--list-paired-metrics"], text=True).splitlines()
        self.assertEqual(len(paired_list), 170)
        filtered = subprocess.check_output(
            [sys.executable, CLI, "--list-scores", "--filter", "verdict"], text=True
        ).splitlines()
        self.assertEqual([line.split()[0] for line in filtered], ["scores-by-verdict"])
        empty_filter = subprocess.check_output([sys.executable, CLI, "--list", "--filter", "no-such-report"], text=True)
        self.assertEqual(empty_filter, "")

        # --scores, --analytics, --paired-metrics
        scores_out = json.loads(subprocess.check_output([sys.executable, CLI, SAMPLE, "--scores"]))
        self.assertIn("scores-summary", scores_out)
        analytics_out = json.loads(subprocess.check_output([sys.executable, CLI, SAMPLE, "--analytics"]))
        self.assertIn("safety-overview", analytics_out)
        self.assertIn("safety-exposure", analytics_out)
        self.assertIn("median-call-latency-summary", analytics_out)
        shape = json.loads(
            subprocess.check_output([sys.executable, CLI, SAMPLE, "token-demand", "token-demand-summary"])
        )
        self.assertIsInstance(shape["token-demand"], list)
        self.assertEqual(shape["token-demand-summary"]["routes"], shape["token-demand"])
        paired_out = json.loads(
            subprocess.check_output([sys.executable, CLI, PREVIOUS, "--compare", SAMPLE, "--paired-metrics"])
        )
        self.assertIn("paired-score-by-length", paired_out["reports"])
        self.assertIn("paired-avg-kmh-by-length", paired_out["reports"])

        # --summary (single and compare) + formats (table, markdown, csv)
        summary_json = json.loads(subprocess.check_output([sys.executable, CLI, SAMPLE, "--summary"]))
        self.assertEqual(summary_json["verdicts"]["passed"], 2)
        self.assertIn("scores", summary_json)
        self.assertIn("motion_peaks", summary_json)
        self.assertIn("decisions", summary_json)

        table_out = subprocess.check_output([sys.executable, CLI, SAMPLE, "--summary", "--format", "table"], text=True)
        self.assertIn("verdicts", table_out)
        self.assertIn("scores", table_out)

        md_out = subprocess.check_output(
            [sys.executable, CLI, SAMPLE, "scores-ranked", "--format", "markdown"], text=True
        )
        self.assertIn("## scores-ranked", md_out)
        self.assertIn("| --- |", md_out)

        csv_out = subprocess.check_output(
            [sys.executable, CLI, SAMPLE, "scores-ranked", "suite-verdicts", "--format", "csv"], text=True
        )
        parsed_csv = list(csv.DictReader(io.StringIO(csv_out)))
        self.assertGreaterEqual(len(parsed_csv), 3)
        self.assertEqual(parsed_csv[0]["section"], "scores-ranked")

        empty = subprocess.check_output(
            [sys.executable, CLI, SAMPLE, "suite-verdicts", "scores-ranked", "--format", "table", "--route", "missing"],
            text=True,
        )
        self.assertIn("scores-ranked: summary", empty)

        digest_comparison = subprocess.check_output(
            [sys.executable, CLI, PREVIOUS, "--compare", SAMPLE, "--summary", "--format", "markdown"],
            text=True,
        )
        self.assertIn("## baseline: motion_peaks", digest_comparison)
        self.assertIn("## comparison: decisions", digest_comparison)

        # --top, --only-failures, --route, --cohort
        top_out = json.loads(subprocess.check_output([sys.executable, CLI, SAMPLE, "motion-duration", "--top", "1"]))
        self.assertEqual(len(top_out["motion-duration"]["routes"]), 1)

        route_out = json.loads(
            subprocess.check_output([sys.executable, CLI, SAMPLE, "suite-verdicts", "--route", "s1-2"])
        )
        self.assertEqual(route_out["suite-verdicts"]["measured_routes"], 1)

        fail_out = json.loads(
            subprocess.check_output([sys.executable, CLI, PREVIOUS, "suite-verdicts", "--only-failures"])
        )
        self.assertEqual(fail_out["suite-verdicts"]["counts"], {"failed": 1})

        cohort_out = json.loads(
            subprocess.check_output([sys.executable, CLI, PREVIOUS, "suite-verdicts", "--cohort", "verdict=failed"])
        )
        self.assertEqual(cohort_out["suite-verdicts"]["counts"], {"failed": 1})

    def test_fail_on_regression_and_condition_differences(self):
        # Improvement (PREVIOUS -> SAMPLE): exits 0.
        ok = subprocess.run(
            [sys.executable, CLI, PREVIOUS, "--compare", SAMPLE, "suite-verdicts", "--fail-on-regression"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(ok.returncode, 0)
        self.assertIn("condition_differences", json.loads(ok.stdout))

        # Regression (SAMPLE -> PREVIOUS): exits 2 AND prints valid JSON report.
        reg = subprocess.run(
            [sys.executable, CLI, SAMPLE, "--compare", PREVIOUS, "suite-verdicts", "--fail-on-regression"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(reg.returncode, 2)
        payload = json.loads(reg.stdout)
        self.assertEqual(payload["routes"]["matched"], ["s1-1", "s1-2"])

        # Counted violations can regress with unchanged pass and collision totals.
        tags = {"length_m": 500, "signals": 0, "stops": 0, "lefts": 0, "rights": 0}
        cfg = {"map": "kitsilano", "bbox": [1, 2, 3, 4], "pack": 6, "seed": 1, "count": 1}
        with tempfile.TemporaryDirectory() as directory:
            a = Path(directory) / "a.json"
            b = Path(directory) / "b.json"
            row = {
                "id": "s1-1",
                "tags": tags,
                "pass": False,
                "collisions": 0,
                "red_lights": 1,
                "stop_signs": 3,
                "failed_to_yield": 0,
                "failures": [],
            }
            a.write_text(json.dumps({"config": cfg, "results": [row]}))
            b.write_text(
                json.dumps(
                    {
                        "config": {**cfg, "weather": "snow", "npcs": 50},
                        "results": [{**row, "red_lights": 2, "stop_signs": 1}],
                    }
                )
            )
            vreg = subprocess.run(
                [sys.executable, CLI, a, "--compare", b, "suite-verdicts", "--fail-on-regression"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(vreg.returncode, 2)
            vdata = json.loads(vreg.stdout)
            self.assertEqual(vdata["regression"]["deltas"]["violations"], -1)
            self.assertEqual(
                vdata["regression"]["increased_violations"], [{"id": "s1-1", "field": "red_lights", "increase": 1}]
            )
            self.assertEqual(
                vdata["condition_differences"],
                {
                    "weather": {"baseline": "dry", "comparison": "snow"},
                    "npcs": {"baseline": None, "comparison": 50},
                },
            )

            # Seconds and metres do not count as new individual violations.
            b.write_text(json.dumps({"config": cfg, "results": [{**row, "off_road_s": 3, "bus_lane_driving": 20}]}))
            duration_only = subprocess.run(
                [sys.executable, CLI, a, "--compare", b, "suite-verdicts", "--fail-on-regression"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(duration_only.returncode, 0)

            # A missing route or counter makes the gate inconclusive in both reporting modes.
            b.write_text(json.dumps({"config": cfg, "results": [{**row, "id": "s1-2"}]}))
            for mode in ("--summary", "suite-verdicts"):
                missing = subprocess.run(
                    [sys.executable, CLI, a, "--compare", b, mode, "--fail-on-regression"],
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(missing.returncode, 3)
                coverage = json.loads(missing.stdout)["regression"]["coverage"]
                self.assertEqual(coverage["baseline_only"], ["s1-1"])
                self.assertEqual(coverage["comparison_only"], ["s1-2"])

            b.write_text(json.dumps({"config": cfg, "results": [{**row, "collisions": None}]}))
            missing = subprocess.run(
                [sys.executable, CLI, a, "--compare", b, "--fail-on-regression", "--summary"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(missing.returncode, 3)
            self.assertEqual(json.loads(missing.stdout)["regression"]["coverage"]["collision_count_pairs"], 0)

        # --fail-on-regression without --compare fails cleanly.
        bad = subprocess.run([sys.executable, CLI, SAMPLE, "--fail-on-regression"], capture_output=True)
        self.assertEqual(bad.returncode, 2)

    def test_csv_preserves_formula_like_route_id_as_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            run = json.loads(SAMPLE.read_text())
            run["results"][0]["id"] = " =1+1"
            run["results"][1]["id"] = "line one\rline two"
            path.write_text(json.dumps(run))
            output = subprocess.check_output([sys.executable, CLI, path, "scores-ranked", "--format", "csv"])
            route_ids = [row["id"] for row in csv.DictReader(io.StringIO(output.decode(), newline="")) if row["id"]]
            self.assertCountEqual(route_ids, ["' =1+1", "line one\rline two"])

    def test_safety_top_limits_route_details_without_changing_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            rows = [
                {"id": "most-affected", "red_lights": 2, "off_road_s": 2, "distance_m": 500},
                {"id": "also-affected", "red_lights": 1, "off_road_s": 1, "distance_m": 500},
            ]
            path.write_text(json.dumps({"results": rows}))
            command = [
                sys.executable,
                CLI,
                path,
                "safety-signals",
                "safety-overview",
                "safety-exposure",
                "--top",
                "1",
            ]
            output = json.loads(subprocess.check_output(command))
            for report in ("safety-overview", "safety-exposure"):
                incidents = output[report]["off_road_incidents"]
                self.assertEqual(incidents["triggered_routes"], 2)
                self.assertEqual([r["id"] for r in incidents["affected_routes"]], ["most-affected"])
            csv_text = subprocess.check_output([*command, "--format", "csv"], text=True)
            report_rows = list(csv.DictReader(io.StringIO(csv_text)))
            signals = [r for r in report_rows if r["section"] == "safety-signals: affected routes"]
            self.assertEqual([r["id"] for r in signals], ["most-affected"])
            aggregate = next(r for r in report_rows if r["section"] == "safety-signals" and r["field"] == "red_lights")
            self.assertEqual(aggregate["affected_routes"], "2")

    def test_reports_handle_finite_measurements_at_numeric_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            path.write_text(
                json.dumps(
                    {
                        "results": [
                            {
                                "id": "a",
                                "time_s": 10**308,
                                "distance_m": 5e-324,
                                "red_lights": 1,
                                "latency_p50_ms": 1e-308,
                                "latency_p95_ms": 1e308,
                            },
                            {"id": "b", "time_s": 10**308, "distance_m": 5e-324, "red_lights": 0},
                        ]
                    }
                )
            )
            command = [
                sys.executable,
                CLI,
                path,
                "motion-duration",
                "scores-ranked",
                "safety-overview",
                "latency-tail-inflation",
            ]
            output = json.loads(subprocess.check_output(command))
            self.assertEqual(output["motion-duration"]["summary"]["mean"], 1e308)
            self.assertEqual(output["latency-tail-inflation"], [])
            self.assertIsNone(output["safety-overview"]["hazards"]["red_lights"]["per_km"])

    def test_regression_gate_uses_audit_labels_when_arena_counters_are_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            before = Path(directory) / "before.json"
            after = Path(directory) / "after.json"
            row = {"challenge": "quiet-crossing", "pass": False, "failures": ["timeout"], "collisions": 0}
            summary = {"brain": "rules", "set": "all"}
            new_failure = "left a pedestrian crossover before the far curb"
            changed = {**row, "failures": ["timeout", new_failure]}
            before.write_text(json.dumps({"summary": summary, "results": [row]}))
            after.write_text(json.dumps({"summary": summary, "results": [changed]}))
            result = subprocess.run(
                [sys.executable, CLI, before, "--compare", after, "--fail-on-regression", "--summary"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("coverage is incomplete", result.stderr)
            regression = json.loads(result.stdout)["regression"]
            self.assertTrue(regression["regressed"])
            self.assertEqual(regression["new_audit_failures"], [{"id": "quiet-crossing", "failures": [new_failure]}])
            self.assertEqual(regression["deltas"], {"passed": 0, "collisions": 0, "violations": None})
            self.assertEqual(regression["coverage"]["failure_label_pairs"], 1)
            self.assertEqual(regression["coverage"]["comparable_traffic_counters"], 0)
            self.assertTrue(regression["coverage"]["incomplete"])

    def test_forensic_report_catalog_and_exports(self):
        rows = [
            {
                "id": "a",
                "map": "kitsilano",
                "pass": False,
                "failures": ["timeout", "timeout", "collision"],
                "time_s": 12,
                "events": [
                    {"type": "safety", "t": 4, "detail": "held"},
                    {"type": "reroute", "t": 3},
                    {"type": "warning"},
                    {"type": "invalid", "t": True},
                    {"type": "negative", "t": -1},
                ],
            },
            {"id": "b", "pass": True, "failures": ["ghost"], "events": []},
            {"id": "c", "pass": False, "events": [{"t": 0}]},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            path.write_text(json.dumps({"results": rows}))
            reports = ["event-timeline", "event-time-issues", "failure-examples"]
            result = json.loads(subprocess.check_output([sys.executable, CLI, path, *reports]))
            self.assertEqual(
                [(x["id"], x["event_index"], x["time_s"]) for x in result["event-timeline"]],
                [("a", 0, 4), ("a", 1, 3), ("a", 2, None), ("a", 3, True), ("a", 4, -1)],
            )
            self.assertEqual(result["event-timeline"][0]["event"]["detail"], "held")
            self.assertEqual(
                [x["error"] for x in result["event-time-issues"]],
                ["time moved backwards", "invalid time", "invalid time", "invalid time"],
            )
            self.assertEqual(
                result["failure-examples"],
                [
                    {"reason": why, "routes": 1, "drives": [{"id": "a", "map": "kitsilano", "time_s": 12}]}
                    for why in ("collision", "timeout")
                ],
            )
            table = subprocess.check_output(
                [sys.executable, CLI, path, "suite-failure-reasons", "--format", "table"], text=True
            )
            self.assertIn("suite-failure-reasons: coverage", table)
            self.assertIn("measured_routes", table)
        listed = subprocess.check_output(
            [sys.executable, CLI, "--list-diagnostics", "--filter", "timestamp"], text=True
        )
        self.assertEqual([line.split()[0] for line in listed.splitlines()], ["event-time-issues"])

    def test_targeted_filters_keep_comparable_drives_and_validate_full_input(self):
        rows = [
            {"challenge": "a", "map": "kitsilano", "pass": False, "failures": ["timeout"]},
            {"challenge": "b", "map": "ottawa", "pass": False, "failures": ["collision"]},
            {"challenge": "c", "map": "victoria", "pass": True, "failures": []},
        ]
        modified = [
            {**rows[0], "pass": True, "failures": []},
            rows[1],
            {**rows[2], "pass": False, "failures": ["timeout"]},
        ]
        with tempfile.TemporaryDirectory() as directory:
            before = Path(directory) / "before.json"
            after = Path(directory) / "after.json.gz"
            before.write_text(json.dumps({"results": rows}), encoding="utf-8-sig")
            after.write_bytes(gzip.compress(json.dumps({"results": modified}).encode("utf-8-sig")))
            cli = [sys.executable, CLI, before, "suite-verdicts"]
            selected = json.loads(
                subprocess.check_output([*cli, "--failure-reason", "collision", "--failure-reason", "timeout"])
            )
            self.assertEqual(selected["suite-verdicts"]["counts"], {"failed": 2})
            selected = json.loads(subprocess.check_output([*cli, "--drive-map", "victoria", "--drive-map", "ottawa"]))
            self.assertEqual(selected["suite-verdicts"]["counts"], {"failed": 1, "passed": 1})
            selected = json.loads(subprocess.check_output([*cli, "--compare", after, "--failure-reason", "timeout"]))
            self.assertEqual(selected["routes"]["matched"], ["a", "c"])
            selected = json.loads(subprocess.check_output([*cli, "--compare", after, "--drive-map", "kitsilano"]))
            self.assertEqual(selected["routes"]["matched"], ["a"])
            after.write_bytes(gzip.compress(json.dumps({"results": [*modified, modified[1]]}).encode()))
            duplicate = subprocess.run([*cli, "--compare", after, "--route", "a"], capture_output=True)
            self.assertEqual(duplicate.returncode, 2)
            self.assertIn(b"duplicate route ID 'b'", duplicate.stderr)

    def test_regression_gate_preserves_offsets_and_identifies_changed_arena_conditions(self):
        rows = [
            {"challenge": "a", "pass": True, "failures": [], "collisions": 1},
            {"challenge": "b", "pass": False, "failures": ["timeout"], "collisions": 0},
        ]
        changed = [
            {**rows[0], "pass": False, "failures": ["timeout"], "collisions": 0},
            {**rows[1], "pass": True, "failures": [], "collisions": 1},
        ]
        with tempfile.TemporaryDirectory() as directory:
            before = Path(directory) / "before.json"
            after = Path(directory) / "after.json"
            before.write_text(json.dumps({"results": rows}))
            after.write_text(json.dumps({"results": changed}))
            cli = [sys.executable, CLI, before, "--compare", after, "--summary", "--fail-on-regression"]
            run = subprocess.run(cli, capture_output=True)
            self.assertEqual(run.returncode, 2)
            payload = json.loads(run.stdout)["regression"]
            self.assertEqual(payload["deltas"]["passed"], 0)
            self.assertEqual(payload["deltas"]["collisions"], 0)
            self.assertEqual(payload["lost_passes"], ["a"])
            self.assertEqual(payload["increased_collisions"], [{"id": "b", "increase": 1}])
            table = subprocess.run([*cli, "--format", "table"], capture_output=True)
            self.assertIn(b"lost passes", table.stdout)
            self.assertIn(b"increased collision counts", table.stdout)
            for field, first, second in (("weather", "dry", "snow"), ("time", 8, 12), ("car", "a", "b")):
                with self.subTest(field=field):
                    before.write_text(json.dumps({"results": [{**rows[0], field: first}]}))
                    after.write_text(json.dumps({"results": [{**rows[0], field: second}]}))
                    output = subprocess.run(cli, capture_output=True)
                    self.assertEqual(output.returncode, 3)
                    self.assertEqual(json.loads(output.stdout)["routes"]["changed_tags"], ["a"])
                    strict = subprocess.run([*cli, "--same-conditions"], capture_output=True)
                    self.assertEqual(strict.returncode, 2)
                    self.assertIn(f"recorded drive conditions differ: a ({field})".encode(), strict.stderr)

    def test_misplaced_flags_have_actionable_errors(self):
        for args, message in [
            ([SAMPLE, "--filter", "text"], b"--filter requires"),
            ([SAMPLE, "--cohort", "signals="], b"invalid --cohort"),
            ([SAMPLE, "--list"], b"does not take saved runs"),
        ]:
            with self.subTest(args=args):
                result = subprocess.run([sys.executable, CLI, *args], capture_output=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn(message, result.stderr)

    def test_display_exports_keep_multiline_cells_in_one_row(self):
        identifier = "a|b\r\n<b>c</b>"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            path.write_text(json.dumps({"results": [{"id": identifier, "time_s": 13}]}))
            cli = [sys.executable, CLI, path, "motion-duration", "--format"]
            markdown = subprocess.check_output([*cli, "markdown"], text=True)
            self.assertIn(r"a\|b<br>&lt;b&gt;c&lt;/b&gt;", markdown)
            table = subprocess.check_output([*cli, "table"], text=True)
            self.assertIn(r"a|b\r\n<b>c</b>", table)

    def test_same_conditions_allows_driver_changes_but_checks_simulation_conditions(self):
        config = {"map": "kitsilano", "pack": 6, "seed": 1, "count": 1, "without": ["vans", "geese"]}
        row = {"id": "a", "pass": True, "tags": {"length_m": 10, "signals": 0, "stops": 0, "lefts": 0, "rights": 0}}
        with tempfile.TemporaryDirectory() as directory:
            before = Path(directory) / "before.json"
            after = Path(directory) / "after.json"
            before.write_text(json.dumps({"config": {**config, "brain": "rules"}, "results": [row]}))
            other = {**config, "brain": "cautious", "without": ["geese", "vans", "geese"]}
            after.write_text(json.dumps({"config": other, "results": [row]}))
            cli = [sys.executable, CLI, before, "--compare", after, "suite-verdicts"]
            output = json.loads(subprocess.check_output([*cli, "--same-conditions"]))
            self.assertEqual(set(output["condition_differences"]), {"driver"})
            after.write_text(
                json.dumps({"config": {**other, "weather": "snow", "cover": 2, "mode": "live"}, "results": [row]})
            )
            output = json.loads(subprocess.check_output(cli))
            self.assertEqual(set(output["condition_differences"]), {"driver", "weather", "cover", "mode"})
            blocked = subprocess.run([*cli, "--same-conditions"], capture_output=True)
            self.assertEqual(blocked.returncode, 2)
            self.assertIn(b"recorded driving conditions differ: weather, cover, mode", blocked.stderr)
