"""data/results.json and the README's results table must match the committed records (ROADMAP 2.7)."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (puts the repository on sys.path)
from jev.config import PRESET_BBOXES

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("build_results", ROOT / "scripts" / "build_results.py")
build_results = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_results)


class ResultsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = build_results.build()

    def test_committed_results_are_up_to_date(self):
        self.assertEqual(build_results.main(["--check"]), 0,
                         "data/results.json or README.md is stale: run uv run scripts/build_results.py")

    def test_check_fails_when_the_file_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            stale = Path(tmp) / "results.json"
            data = json.loads(build_results.render(self.data))
            data["rows"][0]["passed"] -= 1
            stale.write_text(json.dumps(data))
            original = build_results.OUTPUT
            build_results.OUTPUT = stale
            try:
                self.assertEqual(build_results.main(["--check"]), 1)
            finally:
                build_results.OUTPUT = original

    def test_uncommitted_and_variant_runs_are_not_published(self):
        # data/runs/ is gitignored, so any saved benchmark lands there; held-out and other variant
        # runs are reported apart. Neither may change the published rows.
        newest = max(build_results.committed_runs(), key=lambda p: json.loads(p.read_text())["name"])
        run = json.loads(newest.read_text())
        run["name"] = "99991231-235959-" + run["name"]
        for r in run["results"]:
            r["pass"] = False
        local = build_results.RUNS / "99991231-235959-uncommitted-test.json"
        local.write_text(json.dumps(run))
        try:
            self.assertNotIn(local.resolve(), [p.resolve() for p in build_results.committed_runs()])
            self.assertEqual(build_results.build()["rows"], self.data["rows"])
        finally:
            local.unlink()
        with tempfile.TemporaryDirectory() as tmp:
            heldout = Path(tmp) / "heldout.json"
            original = build_results.committed_runs
            build_results.committed_runs = lambda: original() + [heldout]
            try:
                # (hour 0 and cover row 0 are variants too, though 0 == False in Python)
                for variant in ({"heldout": True}, {"hour": 0}, {"cover": 0}, {"park": True}, {"without": ["geese"]}):
                    heldout.write_text(json.dumps(dict(run, config=dict(run["config"], **variant))))
                    self.assertEqual(build_results.build()["rows"], self.data["rows"], variant)
            finally:
                build_results.committed_runs = original

    def test_a_newer_challenge_run_leads(self):
        # a second published full run for a driver: its summary and the README take the newest
        newer = [dict(r, date="2099-01-01", passed=0) for r in self.data["rows"] if r["driver"] == "rules" and r["suite"] == "challenges"]
        original = build_results.challenge_rows
        build_results.challenge_rows = lambda drivers: original(drivers) + newer
        try:
            rows = build_results.build()["rows"]
        finally:
            build_results.challenge_rows = original
        first = next(r for r in rows if r["driver"] == "rules" and r["suite"] == "challenges")
        self.assertEqual((first["date"], first["passed"]), ("2099-01-01", 0))

    def test_every_bundled_map_has_a_name(self):
        self.assertEqual(set(build_results.MAP_NAMES), set(PRESET_BBOXES))

    def test_rows_name_committed_sources(self):
        for row in self.data["rows"]:
            self.assertLessEqual(row["passed"], row["total"])
            self.assertEqual(row["passed"] == row["total"], not row["failed"], row["sources"])
            for source in row["sources"] + ([row["recording"]] if row["recording"] else []):
                self.assertTrue((ROOT / source).is_file(), source)
            self.assertIn(row["driver"], self.data["drivers"])

    def test_published_challenge_results(self):
        rows = {(r["driver"], r["suite"]): r for r in self.data["rows"]}
        # docs/model-results.md: the 60 challenges and the 2 road tests, 11 November 2026.
        for driver, passed in (("rules", 62), ("cautious", 62), ("jev", 62), ("llm:deepseek", 61)):
            row = rows[(driver, "challenges")]
            self.assertEqual((row["passed"], row["total"]), (passed, 62), driver)
        self.assertEqual([f["id"] for f in rows[("llm:deepseek", "challenges")]["failed"]], ["double-parked"])
        self.assertEqual(rows[("jev", "challenges")]["model"], "jev-1.14.0")
        self.assertEqual(rows[("jev", "challenges")]["model_decisions"], 12096)
        self.assertEqual(round(rows[("llm:deepseek", "challenges")]["cost_usd"], 2), 2.55)
        self.assertIsNotNone(rows[("jev", "challenges")]["recording"])
        self.assertIsNone(rows[("rules", "challenges")]["recording"])

    def test_city_rows_are_the_newest_runs(self):
        city = [r for r in self.data["rows"] if r["suite"] == "city" and r["driver"] == "rules"]
        self.assertEqual(len(city), 4 + 11)
        snow = next(r for r in city if r["map"] == "kitsilano" and r["weather"] == "snow")
        self.assertEqual(snow["sources"], ["data/runs/20261114-210004-rules.json"])


if __name__ == "__main__":
    unittest.main()
