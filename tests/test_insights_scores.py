"""Tests for composite drive scores (JS parity), score reports, paired metrics and executive digests."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

import helpers  # noqa: F401 (puts the repository on sys.path)
from scripts.run_insights import decisions, motion, outcomes, profiles, safety, scores


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "data/runs/20261120-120000-rules.json"


class ScoresFormulaParityTests(unittest.TestCase):
    def test_perfect_drive_and_collision_margin_zero(self):
        clean = {
            "id": "clean",
            "pass": True,
            "arrived": True,
            "progress": 0.4,  # arrived overrides progress to 1
            "tags": {"length_m": 1000},
            "distance_m": 1000,
            "time_s": 72,  # 50 km/h exact -> ideal = 72s
            "rms_jerk": 1.0,
            "hard_brakes": 0,
            "max_lat_accel": 2.0,
            "collisions": 0,
            "min_ttc_s": 4.0,
            "min_headway_s": 2.0,
            "safety_brakes": 0,
        }
        result = scores.drive_scores(clean)
        self.assertEqual(
            result,
            {
                "progress": 1.0,
                "pace": 100.0,
                "comfort": 100.0,
                "margin": 100.0,
                "score": 100.0,
                "time_lost_s": 0.0,
                "time_lost_s_per_km": 0.0,
            },
        )
        crashed = {**clean, "collisions": 1}
        crashed_scores = scores.drive_scores(crashed)
        self.assertEqual(crashed_scores["margin"], 0.0)
        self.assertEqual(crashed_scores["score"], 66.7)

    def test_js_edge_cases_and_half_up_rounding(self):
        # Verify ECMA-262 Math.round (half towards +infinity) differs from Python banker's rounding:
        # 2.5 -> 3 (not 2), 0.25 at d=1 -> 0.3 (not 0.2).
        self.assertEqual(scores._round(0.25, 1), 0.3)
        self.assertEqual(scores._round(0.05, 1), 0.1)
        self.assertEqual(scores._round(2.5, 0), 3.0)
        self.assertEqual(scores._round(0.49999999999999994, 0), 0.0)

        # Arena row without tags.length_m falls back to distance_m; missing TTC/headway default to 1.
        arena_row = {
            "id": "door-zone",
            "pass": True,
            "arrived": True,
            "distance_m": 500,
            "time_s": 72,  # ideal at 50 km/h is 36s -> pace = 50.0, lost = 36.0, lost/km = 72.0
            "rms_jerk": 3.5,  # ramp(3.5, 1, 6) = 0.5
            "hard_brakes": 5,  # 5 / 0.5km = 10 -> ramp(10, 0, 10) = 0.0
            "max_lat_accel": 4.5,  # ramp(4.5, 2, 7) = 0.5 -> comfort = 100 * (0.2 + 0 + 0.15) = 35.0
            "collisions": 0,
            "safety_brakes": 0,  # t=1, h=1, s=1 -> margin = 100.0
        }
        self.assertEqual(
            scores.drive_scores(arena_row),
            {
                "progress": 1.0,
                "pace": 50.0,
                "comfort": 35.0,
                "margin": 100.0,
                "score": 61.7,
                "time_lost_s": 36.0,
                "time_lost_s_per_km": 72.0,
            },
        )

        # Explicit tags.length_m = 0 must NOT fall back to distance_m (matches JS `??`).
        zero_tag = {"arrived": False, "progress": 0.5, "tags": {"length_m": 0}, "distance_m": 500, "time_s": 10}
        self.assertIsNone(scores.drive_scores(zero_tag)["time_lost_s_per_km"])
        self.assertEqual(scores.drive_scores(zero_tag)["pace"], 0.0)

        # Zero time_s produces pace 0 and no division by zero; empty driver_scores returns nulls.
        zero_time = {"arrived": True, "distance_m": 100, "time_s": 0}
        self.assertEqual(scores.drive_scores(zero_time)["pace"], 0.0)
        self.assertEqual(
            scores.driver_scores([]),
            {
                "drives": 0,
                "passed": 0,
                "progress": None,
                "pace": None,
                "comfort": None,
                "margin": None,
                "score": None,
                "time_lost_s": 0.0,
                "time_lost_s_per_km": None,
                "km": 0.0,
            },
        )

    def test_driver_scores_on_saved_sample(self):
        run = json.loads(SAMPLE.read_text(encoding="utf-8"))
        rows = run["results"]
        agg = scores.driver_scores(rows)
        self.assertEqual(agg["drives"], 2)
        self.assertEqual(agg["passed"], 2)
        self.assertEqual(agg["progress"], 1.0)
        # Verify s1-1 and s1-2 exact values match JS formula
        s1 = scores.drive_scores(rows[0])
        self.assertEqual(s1["progress"], 1.0)
        self.assertGreater(s1["score"], 0)
        self.assertLessEqual(s1["score"], 100)
        self.assertEqual(agg["km"], round((1245 + 1138) / 1000, 2))

    @unittest.skipUnless(shutil.which("node") or os.environ.get("JEV_REQUIRE_NODE"), "Node is not on PATH")
    def test_composite_scores_match_browser(self):
        paths = [SAMPLE, ROOT / "data/results/2026-11-20/claude-haiku-open.json"]
        suites = [
            [],
            [{"arrived": False, "time_s": 1.25, "progress": 0.0245, "tags": {"length_m": 0}}],
            *[json.loads(path.read_text(encoding="utf-8"))["results"] for path in paths],
        ]
        node = """
import fs from "node:fs";
import { driveScores, driverScores } from "./static/js/bench/scores.js";
const suites = JSON.parse(fs.readFileSync(0, "utf8"));
console.log(JSON.stringify(suites.map((rows) => [rows.map(driveScores), driverScores(rows)])));
"""
        expected = json.loads(
            subprocess.check_output(
                ["node", "--experimental-default-type=module", "--input-type=module", "-e", node],
                input=json.dumps(suites),
                text=True,
                cwd=ROOT,
            )
        )
        self.assertEqual(
            [[[scores.drive_scores(row) for row in rows], scores.driver_scores(rows)] for rows in suites],
            expected,
        )


class ScoresReportsTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {
                "id": "r2",
                "pass": True,
                "arrived": True,
                "tags": {"length_m": 400, "signals": 0, "stops": 1, "lefts": 1, "rights": 0},
                "distance_m": 400,
                "time_s": 40,
                "avg_kmh": 36,
                "rms_jerk": 1.5,
                "hard_brakes": 0,
                "max_lat_accel": 2.5,
                "lane_rms_m": 0.15,
                "collisions": 0,
                "min_ttc_s": 4.0,
                "min_headway_s": 2.0,
                "min_gap_m": 12.0,
                "safety_brakes": 0,
                "latency_p50_ms": 100,
                "latency_p95_ms": 200,
                "model_share": 0.9,
                "fallback_share": 0.0,
            },
            {
                "id": "r1",
                "pass": True,
                "arrived": True,
                "tags": {"length_m": 400, "signals": 0, "stops": 1, "lefts": 1, "rights": 0},
                "distance_m": 400,
                "time_s": 40,
                "avg_kmh": 36,
                "rms_jerk": 1.5,
                "hard_brakes": 0,
                "max_lat_accel": 2.5,
                "lane_rms_m": 0.15,
                "collisions": 0,
                "min_ttc_s": 4.0,
                "min_headway_s": 2.0,
                "min_gap_m": 12.0,
                "safety_brakes": 0,
                "latency_p50_ms": 120,
                "latency_p95_ms": 240,
                "model_share": 0.8,
                "fallback_share": 0.1,
            },
            {
                "id": "r3",
                "pass": False,
                "arrived": False,
                "progress": 0.5,
                "tags": {"length_m": 1200, "signals": 2, "stops": 0, "lefts": 0, "rights": 2},
                "distance_m": 600,
                "time_s": 100,
                "avg_kmh": 21.6,
                "rms_jerk": 5.0,
                "hard_brakes": 4,
                "max_lat_accel": 6.0,
                "lane_rms_m": 0.5,
                "collisions": 1,
                "min_ttc_s": 1.2,
                "min_headway_s": 0.6,
                "min_gap_m": 2.0,
                "safety_brakes": 2,
                "failures": ["collision"],
                "latency_p50_ms": 150,
                "latency_p95_ms": 300,
                "model_share": 0.5,
                "fallback_share": 0.2,
            },
        ]

    def test_scores_catalog_and_reports(self):
        original = {name for mod in (decisions, motion, outcomes, safety) for name in mod.REPORTS}
        self.assertEqual(len(scores.REPORTS), 12)
        self.assertFalse(original.intersection(scores.REPORTS))
        self.assertFalse(set(profiles.REPORTS).intersection(scores.REPORTS))
        for name, (desc, fn) in scores.REPORTS.items():
            with self.subTest(name=name):
                self.assertTrue(desc)
                json.dumps(fn(self.rows), allow_nan=False)
                json.dumps(fn([]), allow_nan=False)

        ranked = scores.REPORTS["scores-ranked"][1](self.rows)
        # r1 and r2 tie on score -> deterministic sort puts r1 before r2.
        self.assertEqual([r["id"] for r in ranked["routes"]], ["r1", "r2", "r3"])
        lowest = scores.REPORTS["scores-lowest"][1](self.rows)
        self.assertEqual([r["id"] for r in lowest["routes"]], ["r3", "r1", "r2"])
        self.assertFalse(lowest["routes"][0]["pass"])

        by_verdict = scores.REPORTS["scores-by-verdict"][1](self.rows)
        self.assertEqual(set(by_verdict["groups"]), {"passed", "failed"})
        self.assertGreater(
            by_verdict["groups"]["passed"]["aggregate"]["score"],
            by_verdict["groups"]["failed"]["aggregate"]["score"],
        )

    def test_paired_metrics_catalog_and_deltas(self):
        self.assertEqual(len(scores.PAIRED_METRICS), 170)
        self.assertFalse(set(profiles.PAIRED_RATES).intersection(scores.PAIRED_METRICS))
        after = [
            {**self.rows[0], "time_s": 30, "avg_kmh": 48, "rms_jerk": 1.0},
            {**self.rows[1], "time_s": 30, "avg_kmh": 48, "rms_jerk": 1.0},
            {**self.rows[2], "collisions": 0, "arrived": True, "pass": True, "time_s": 80, "avg_kmh": 30},
        ]
        score_delta = scores.PAIRED_METRICS["paired-score-by-length"][1](self.rows, after)
        self.assertEqual(score_delta["cohort_side"], "baseline")
        self.assertGreater(score_delta["groups"]["under 500 m"]["difference"]["median"], 0)
        self.assertGreater(score_delta["groups"]["1000 m or more"]["difference"]["median"], 0)

        speed_delta = scores.PAIRED_METRICS["paired-avg-kmh-by-signals"][1](self.rows, after)
        self.assertEqual(speed_delta["groups"]["0"]["difference"]["median"], 12)
        self.assertAlmostEqual(speed_delta["groups"]["2"]["difference"]["median"], 8.4)

    def test_executive_summary_and_comparison_summary(self):
        config = {"brain": "rules", "map": "kitsilano", "bbox": [0, 1, 2, 3], "seed": 1, "count": 3, "pack": 6}
        digest = scores.build_summary(config, self.rows, top=2)
        self.assertEqual(digest["verdicts"]["passed"], 2)
        self.assertEqual(digest["verdicts"]["failed"], 1)
        self.assertEqual(len(digest["scores"]["lowest_routes"]), 2)
        self.assertEqual(digest["scores"]["lowest_routes"][0]["id"], "r3")
        self.assertEqual(digest["safety"]["families_triggered"], 1)
        json.dumps(digest, allow_nan=False)

        improved = [{**row, "pass": True, "arrived": True, "collisions": 0, "failures": []} for row in self.rows]
        cmp_digest = scores.build_comparison_summary(
            ("before.json", config, self.rows),
            ("after.json", {**config, "weather": "rain"}, improved),
            top=2,
        )
        self.assertEqual(cmp_digest["deltas"]["passed"], 1)
        self.assertEqual(cmp_digest["deltas"]["collisions"], -1)
        self.assertEqual(
            cmp_digest["condition_differences"],
            {"weather": {"baseline": "dry", "comparison": "rain"}},
        )
        json.dumps(cmp_digest, allow_nan=False)
