"""The soak summary reads each job's own matrix and keeps Markdown rows intact."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

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
                {"simulation_error": "boom", "failures": ["simulation error"]},
                {"arrived": False, "failures": ["timeout"]},
                {"arrived": True, "collisions": 1, "failures": ["collision", "red light"]},
            ],
        }
        counts = soak_summary.leg_categories(
            {"runs": [bench, {"throws": ["a", "b"], "stuck": ["b"], "collisions": [], "audits": []}]}
        )
        self.assertEqual(counts, {"throws": 3, "stuck": 2, "collisions": 1, "audits": 1})

    def test_cells_escape_pipe_and_line_breaks(self):
        self.assertEqual(soak_summary.escape("a|b\r\nc\nd\re"), "a\\|b<br>c<br>d<br>e")
