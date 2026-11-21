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
