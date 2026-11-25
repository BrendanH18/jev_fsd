"""The soak summary reads each job's own matrix and keeps Markdown rows intact."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "soak_summary", Path(__file__).resolve().parents[1] / "scripts" / "soak_summary.py"
)
soak_summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(soak_summary)


class SoakSummaryTest(unittest.TestCase):
    def test_workflow_leg_names(self):
        self.assertEqual(
            soak_summary.expected_legs(),
            [
                *(f"soak-{i}" for i in range(8)),
                "city dry parking",
                "city dry 23h30",
                "city dry 06h30",
                "city fog 23h30",
            ],
        )

    def test_matrix_values_belong_to_the_job_not_the_workflow(self):
        workflow = """jobs:
  unrelated:
    strategy:
      matrix:
        shard: [99]
        include:
          - { label: unrelated, option: "unused" }
  soak:
    strategy:
      matrix:
        shard: [0, 1]
    env:
      LEG: soak-${{ matrix.shard }}
    steps:
      - env:
          LEG: unrelated
  park-night:
    strategy:
      matrix:
        include:
          - { weather: fog, label: 'fog overnight' }
    env:
      LEG: "city ${{ matrix.label }}"
"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "soak.yml"
            path.write_text(workflow)
            self.assertEqual(soak_summary.expected_legs(path), ["soak-0", "soak-1", "city fog overnight"])

    def test_tally_works_with_bench_reports_and_soak_legs(self):
        bench = {
            "results": [
                {"id": "a", "simulation_error": "boom", "failures": ["simulation error"]},
                {"id": "b", "arrived": False, "failures": ["timeout"]},
                {"id": "c", "arrived": True, "collisions": 1, "failures": ["collision", "red light"]},
            ],
        }
        counts = soak_summary.leg_categories(
            {"runs": [bench, {"throws": ["a", "b"], "stuck": ["b"], "collisions": [], "audits": []}]}
        )
        self.assertEqual(counts, {"throws": 3, "stuck": 2, "collisions": 1, "audits": 1})

    def test_cells_escape_pipe_and_line_breaks(self):
        self.assertEqual(soak_summary.escape("a|b\r\nc\nd\re"), "a\\|b<br>c<br>d<br>e")

    def test_compact_and_complete_failure_evidence_are_merged_by_route(self):
        data = {
            "id": "city/a",
            "results": [
                {"id": "a", "pass": False, "failures": ["timeout", "timeout"]},
                {"id": "b", "pass": True, "failures": ["red light"]},
                {"id": "c", "pass": True},
                {"id": "d", "pass": False, "failures": ["simulation error"]},
                {"id": "e", "pass": False, "failures": ["collision"]},
            ],
            "stuck": ["a", "a"],
            "audits": [{"id": "b", "failures": ["red light"]}, {"id": "f", "failures": ["yield"]}],
            "collisions": ["g"],
            "throws": ["h"],
        }
        total, failed = soak_summary.leg_failures(data)
        self.assertEqual(total, 5)
        self.assertCountEqual(
            failed,
            [
                "city/a a: timeout",
                "city/a b: red light",
                "city/a d: simulation error",
                "city/a e: collision",
                "city/a f: yield",
                "city/a g: collision",
                "city/a h: simulation error",
            ],
        )
        self.assertEqual(soak_summary.leg_categories(data), {"throws": 2, "stuck": 1, "collisions": 2, "audits": 2})
        self.assertEqual(soak_summary.leg_categories({"results": [{"id": "a", "pass": True}]})["stuck"], 0)

    def test_malformed_artifact_shapes_never_count_as_passes(self):
        route = {"id": "a", "pass": True}
        for data, message in [
            ([], "report object"),
            ({"runs": []}, "nonempty runs array"),
            ({"runs": ["broken"]}, "run objects"),
            ({}, "route results"),
            ({"results": {}}, "route results array"),
            ({"results": []}, "at least one route"),
            ({"throws": []}, "at least one route"),
            ({"results": [{"pass": False}]}, "route result with an ID"),
            ({"results": [route, route]}, "duplicate route ID"),
            ({"results": [{**route, "pass": "false"}]}, "boolean verdict"),
            ({"results": [{**route, "failures": "timeout"}]}, "array of failure labels"),
            ({"throws": "a"}, "array for throws"),
            ({"audits": [{"failures": ["red light"]}]}, "expected a route ID"),
        ]:
            with self.subTest(data=data), self.assertRaisesRegex(ValueError, message):
                soak_summary.leg_failures(data)

    def test_incomplete_artifacts_are_reported_without_suppressing_good_legs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "leg.txt").write_text("root", encoding="utf-8-sig")
            (root / "run.json").write_text(json.dumps({"results": [{"id": "ok", "pass": True}]}), encoding="utf-8-sig")
            for name in ("a", "b", "broken", "blank", "unlabelled"):
                (root / name).mkdir()
            for name in ("a", "b"):
                (root / name / "leg.txt").write_text("duplicate")
            (root / "broken" / "run.json").write_text("{")
            (root / "blank" / "leg.txt").write_text(" ")
            (root / "unlabelled" / "leg.txt").write_bytes(b"\xff")
            (root / "unlabelled" / "run.json").write_text(json.dumps({"harness_error": "reached 100%\nstopped"}))
            summary = root / "summary.md"
            stdout = StringIO()
            with (
                patch.object(soak_summary, "expected_legs", return_value=["root", "missing"]),
                patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(summary)}),
                redirect_stdout(stdout),
            ):
                self.assertEqual(soak_summary.main(root), 0)
            markdown = summary.read_text()
            for expected in (
                "2 readable, 2 missing, 2 unreadable, 1 routes",
                "| root | 1 | passed |",
                "| blank | - | no result",
                "| broken | - | unreadable run.json",
                "| duplicate | - | multiple artifacts claim this leg (a, b)",
                "| missing | - | no result",
                "| unlabelled | 0 | harness error: reached 100%<br>stopped",
            ):
                self.assertIn(expected, markdown)
            self.assertIn("unreadable leg.txt", stdout.getvalue())
            self.assertIn("reached 100%25 stopped", stdout.getvalue())
