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
        self.assertEqual(
            build_results.main(["--check"]),
            0,
            "data/results.json or README.md is stale: run uv run scripts/build_results.py",
        )

    def test_score_inputs_require_saved_measurements(self):
        tape = build_results.read_recording(next(build_results.RECORDINGS.glob("jev-arena-*.json.gz")))
        result = next(iter(tape["results"].values()))
        inputs = build_results.published_drive(result)["score_inputs"]
        fields = (
            "arrived",
            "progress",
            "distance_m",
            "rms_jerk",
            "hard_brakes",
            "max_lat_accel",
            "collisions",
            "safety_brakes",
            "min_ttc_s",
            "min_headway_s",
        )
        self.assertEqual(inputs, {key: result[key] for key in fields})
        for key in (*fields, "time_s"):
            with self.subTest(key=key):
                partial = result.copy()
                del partial[key]
                self.assertNotIn("score_inputs", build_results.published_drive(partial))
        clear_road = dict(result, min_ttc_s=None, min_headway_s=None)
        self.assertIn("score_inputs", build_results.published_drive(clear_road))
        invalid = build_results.published_drive(dict(result, time_s=float("inf"), hard_brakes=float("nan")))
        self.assertIsNone(invalid["time_s"])
        self.assertNotIn("hard_brakes", invalid["incident_counts"])
        self.assertNotIn("score_inputs", invalid)
        with self.assertRaises(ValueError):
            build_results.render({"driving_s": float("inf")})

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
                # (hour 0 and cover row 0 are variants too, though 0 == False in Python; an open-track run
                # never takes a guarded run's place)
                for variant in (
                    {"heldout": True},
                    {"hour": 0},
                    {"cover": 0},
                    {"park": True},
                    {"without": ["geese"]},
                    {"track": "open"},
                ):
                    heldout.write_text(json.dumps(dict(run, config=dict(run["config"], **variant))))
                    self.assertEqual(build_results.build()["rows"], self.data["rows"], variant)
                partial = dict(run, manifest={"suite": {"only": True}})
                heldout.write_text(json.dumps(partial))
                self.assertEqual(build_results.build()["rows"], self.data["rows"])
            finally:
                build_results.committed_runs = original

    def test_a_partial_run_of_the_whole_set_is_a_pilot(self):
        # `--set all --only door-zone`, or a run stopped part way, keeps set "all": it never takes the full
        # set's row, on either track (inside the repository, as published results are)
        with tempfile.TemporaryDirectory(dir=ROOT / "data") as tmp:
            day = Path(tmp) / "2026-11-20"
            day.mkdir()
            for track in ("guarded", "open"):
                summary = {"brain": "llm:partial", "set": "all", "drives": 1, "passed": 1, "cost_usd": 0.1}
                if track == "open":
                    summary["track"] = "open"
                result = {"challenge": "door-zone", "map": "kitsilano", "pass": True, "failures": [], "time_s": 60}
                (day / f"partial-{track}.json").write_text(json.dumps({"summary": summary, "results": [result]}))
            original = build_results.RESULTS
            build_results.RESULTS = Path(tmp)
            try:
                rows = build_results.challenge_rows({})
            finally:
                build_results.RESULTS = original
        self.assertEqual(sorted(r["suite"] for r in rows), ["pilot", "pilot"])
        self.assertEqual(len(build_results.full_set_ids()), 62)

    def test_new_run_requires_provenance_matching_the_tape(self):
        path = ROOT / "data/results/2099-01-01/jev.json"
        sha = "1" * 16
        results = [{"challenge": "door-zone", "map": "kitsilano", "cost_usd": 0.01}]
        run = {"summary": {"brain": "jev", "set": "all", "engine": "node v22", "cost_usd": 0.01}, "results": results}
        with self.assertRaisesRegex(ValueError, "run manifest is required"):
            build_results.checked_manifest(path, run, "2099-01-01")
        manifest = {
            "format": "jev-run-manifest/1",
            "source_commit": "a" * 40,
            "source_dirty": False,
            "engine": "node v22",
            "engine_version": "12",
            "driver": "jev",
            "model": "jev-test",
            "prompt_hash": sha,
            "track": "guarded",
            "suite": {"kind": "arena", "set": "all", "drives": {"door-zone": {"map": "kitsilano", "seed": 1042}}},
            "maps": {"kitsilano": {"pack_version": "6", "fingerprint": sha, "components": {"roads": sha}}},
            "cost_usd": 0.01,
        }
        run["manifest"] = manifest
        recording = {
            "header": {
                "manifest": dict(manifest),
                "model": "jev-test",
                "engine": "node v22",
                "maps": {"kitsilano": sha},
                "arena": {"set": "all", "ids": ["door-zone"]},
            },
            "results": {"door-zone": dict(results[0], seed=1042)},
        }
        self.assertEqual(build_results.checked_manifest(path, run, "2099-01-01", recording), manifest)
        results.append({"challenge": "undeclared", "map": None})
        with self.assertRaisesRegex(ValueError, "arena drives disagree"):
            build_results.checked_manifest(path, run, "2099-01-01", recording)
        results.pop()
        recording["header"]["arena"]["set"] = "road-tests"
        with self.assertRaisesRegex(ValueError, "arena recording set or drive list"):
            build_results.checked_manifest(path, run, "2099-01-01", recording)
        recording["header"]["arena"]["set"] = "all"
        run["results"][0]["time_s"] = 75
        recording["results"]["door-zone"]["time_s"] = 60
        with self.assertRaisesRegex(ValueError, "arena report and recording disagree on per-drive data"):
            build_results.checked_manifest(path, run, "2099-01-01", recording)
        recording["results"]["door-zone"]["time_s"] = 75
        with self.assertRaisesRegex(ValueError, "model runs need a corresponding recording"):
            build_results.checked_manifest(path, run, "2099-01-01")
        recording["header"]["manifest"]["source_commit"] = "b" * 40
        with self.assertRaisesRegex(ValueError, "recording and results disagree"):
            build_results.checked_manifest(path, run, "2099-01-01", recording)

    def test_suite_version_checks_benchmark_membership(self):
        path = ROOT / "data/runs/20990101-000000-rules.json"
        definition = build_results.CANONICAL["v1"]
        bench = definition["bench"]
        config = dict(bench["config"], brain="rules", weather="snow", pack=10, engine="node v22")
        suite = {
            "kind": "bench",
            "config": config,
            "ids": bench["ids"],
            "generated_ids": bench["ids"],
            "route_sha": bench["route_sha"],
        }
        manifest = {
            "format": build_results.MANIFEST_FORMAT,
            "suite_version": "v1",
            "source_commit": "a" * 40,
            "source_dirty": False,
            "engine": config["engine"],
            "engine_version": "12",
            "driver": "rules",
            "track": "guarded",
            "cost_usd": 0,
            "suite": suite,
            "maps": {
                "kitsilano": {
                    "pack_version": config["pack"],
                    "fingerprint": definition["maps"]["kitsilano"],
                    "components": {"roads": "1" * 16},
                },
            },
        }
        run = {
            "suite_version": "v1",
            "config": config,
            "summary": {"cost_usd": 0},
            "results": [{"id": drive, "suite_version": "v1", "pass": False} for drive in bench["ids"]],
            "manifest": manifest,
        }
        self.assertEqual(build_results.checked_manifest(path, run, "2099-01-01"), manifest)
        with self.assertRaisesRegex(ValueError, "report and manifest disagree"):
            build_results.checked_manifest(
                path, dict(run, manifest=dict(manifest, suite_version="custom")), "2099-01-01"
            )
        with self.assertRaisesRegex(ValueError, "run and results disagree"):
            build_results.checked_manifest(path, dict(run, suite_version="custom"), "2099-01-01")
        for key, value in (("npcs", 10), ("park", True), ("hour", 0), ("weather", "ice")):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "outside the canonical v1 suite"):
                config[key] = value
                try:
                    build_results.checked_manifest(path, run, "2099-01-01")
                finally:
                    config.clear()
                    config.update(bench["config"], brain="rules", weather="snow", pack=10, engine="node v22")
        with self.assertRaisesRegex(ValueError, "outside the canonical v1 suite"):
            build_results.checked_manifest(path, dict(run, stopped="reserve"), "2099-01-01")
        with self.assertRaisesRegex(ValueError, "outside the canonical v1 suite"):
            suite["only"] = True
            build_results.checked_manifest(path, run, "2099-01-01")

    def test_a_newer_challenge_run_leads(self):
        # a second published full run for a driver: its summary and the README take the newest
        newer = [
            dict(r, date="2099-01-01", passed=0)
            for r in self.data["rows"]
            if r["driver"] == "rules" and r["suite"] == "challenges"
        ]
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
