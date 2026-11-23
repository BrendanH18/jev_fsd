import json
from pathlib import Path
import re
import subprocess
import sys
import unittest

import helpers  # noqa: F401 (puts the repository on sys.path)
from scripts.run_insights import decisions, motion, outcomes, profiles, safety


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "scripts" / "inspect_run.py"
SAMPLE = ROOT / "data/runs/20261120-120000-rules.json"
PREVIOUS = ROOT / "data/runs/20261112-190015-rules.json"
OPEN_ARENA = ROOT / "data/results/2026-11-20/claude-haiku-open.json"


class ProfilesTests(unittest.TestCase):
    def test_new_catalog_inventory(self):
        original = {name for module in (decisions, motion, outcomes, safety) for name in module.REPORTS}
        self.assertEqual(len(profiles.REPORTS), 1073)
        self.assertEqual(len(profiles.RATE_REPORTS), 100)
        self.assertFalse(original.intersection(profiles.REPORTS))
        for name, (description, report) in profiles.REPORTS.items():
            self.assertTrue(re.fullmatch(r"profile-[a-z0-9-]+-by-[a-z-]+", name), name)
            self.assertTrue(description, name)
            self.assertEqual(report([])["groups"], {}, name)
        for name in (
            "profile-red-lights-by-verdict",
            "profile-progress-by-arrival",
            "profile-safety-brakes-by-brake-assist",
            "profile-fallback-share-by-fallback",
            "profile-flagged-choices-by-flags",
        ):
            self.assertNotIn(name, profiles.REPORTS)
        self.assertIn("profile-off-road-s-by-verdict", profiles.REPORTS)
        self.assertIn("profile-bus-lane-driving-by-verdict", profiles.REPORTS)

    def test_cohort_distribution_and_missing_values(self):
        _, report = profiles.REPORTS["profile-off-road-s-by-signals"]
        rows = [
            {"tags": {"signals": 1}, "off_road_s": 0},
            {"tags": {"signals": 1.0}, "off_road_s": 4},
            {"tags": {"signals": 1}, "off_road_s": 8},
            {"tags": {"signals": 1}, "off_road_s": 12},
            {"tags": {"signals": 1}},
            {"tags": {"signals": 3}, "off_road_s": None},
            {"tags": {"signals": 4}, "off_road_s": False},
            {"tags": {"signals": 1.5}, "off_road_s": 1},
            {"off_road_s": -1},
        ]
        result = report(rows)
        self.assertEqual(result["field"], "off_road_s")
        self.assertEqual(result["unit"], "seconds")
        self.assertEqual(
            result["groups"]["1"],
            {
                "routes": 5,
                "measured": 4,
                "unavailable": 1,
                "zero": 1,
                "min": 0,
                "p25": 3,
                "median": 6,
                "p75": 9,
                "max": 12,
            },
        )
        self.assertEqual(
            result["groups"]["3 or more"],
            {
                "routes": 2,
                "measured": 0,
                "unavailable": 2,
                "zero": 0,
                "min": None,
                "p25": None,
                "median": None,
                "p75": None,
                "max": None,
            },
        )
        self.assertEqual(result["groups"]["unknown"]["median"], 1)
        self.assertEqual(result["groups"]["unknown"]["unavailable"], 1)

    def test_runtime_cohorts_distinguish_missing_from_absent(self):
        _, reroutes = profiles.REPORTS["profile-speeding-s-by-rerouting"]
        rows = [
            {},
            {"events": []},
            {"events": [{"type": "reroute"}]},
            {"events": [{"type": "collision"}] * 50},
        ]
        self.assertEqual(
            set(reroutes(rows)["groups"]),
            {"unknown", "none observed", "reroute observed", "unknown (retention limit)"},
        )
        _, flags = profiles.REPORTS["profile-progress-by-flags"]
        flag_rows = [
            {"progress": 0.5},
            {"flagged_choices": 0, "progress": 1.1},
            {"flagged_choices": 1, "progress": 0},
        ]
        groups = flags(flag_rows)["groups"]
        self.assertEqual(groups["unknown"]["median"], 0.5)
        self.assertEqual(groups["zero"]["unavailable"], 1)
        self.assertEqual(groups["one or more"]["median"], 0)

    def test_signed_deceleration_and_invalid_numbers(self):
        _, report = profiles.REPORTS["profile-max-decel-by-arrival"]
        rows = [{"arrived": True, "max_decel": x} for x in (-1e308, -9, 0, 1, float("inf"), 10**1000)]
        result = report(rows)["groups"]["arrived"]
        self.assertEqual(result["measured"], 3)
        self.assertEqual(result["median"], -9)
        self.assertEqual(result["max"], 0)
        json.dumps(result, allow_nan=False)

    def test_derived_measurements_use_the_right_exposure(self):
        rows = [
            {
                "tags": {"length_m": 500},
                "arrived": True,
                "distance_m": 750,
                "safety_brakes": 3,
                "tokens": 1500,
                "events": [{"type": "reroute"}],
            },
            {
                "tags": {"length_m": 500},
                "arrived": False,
                "distance_m": 0,
                "safety_brakes": 3,
                "tokens": 1500,
                "events": [{"type": "reroute"}],
            },
        ]
        _, detour = profiles.REPORTS["profile-distance-ratio-by-rerouting"]
        _, brakes = profiles.REPORTS["profile-safety-brakes-per-km-by-length"]
        _, tokens = profiles.REPORTS["profile-tokens-per-km-by-length"]
        for report, group, expected in (
            (detour, "reroute observed", 1.5),
            (brakes, "500 to under 1000 m", 4),
            (tokens, "500 to under 1000 m", 2000),
        ):
            result = report(rows)["groups"][group]
            self.assertEqual(result["measured"], 1)
            self.assertEqual(result["unavailable"], 1)
            self.assertEqual(result["median"], expected)

    def test_real_run_and_comparison(self):
        report = "profile-time-s-by-verdict"
        catalog = subprocess.check_output([sys.executable, CLI, "--list-profiles"], text=True)
        names = [line.split()[0] for line in catalog.splitlines()]
        self.assertEqual(names, sorted(profiles.REPORTS))
        result = json.loads(subprocess.check_output([sys.executable, CLI, SAMPLE, "--profiles"]))
        self.assertEqual(list(result), names)
        self.assertEqual(result[report]["groups"]["passed"]["measured"], 2)
        output = subprocess.check_output([sys.executable, CLI, PREVIOUS, report, "--compare", SAMPLE])
        comparison = json.loads(output)["reports"][report]
        self.assertEqual(comparison["baseline"]["groups"]["failed"]["measured"], 1)
        self.assertEqual(comparison["comparison"], result[report])
        flagged = "profile-collisions-by-flags"
        open_report = json.loads(subprocess.check_output([sys.executable, CLI, OPEN_ARENA, flagged]))[flagged]
        self.assertEqual(sum(group["routes"] for group in open_report["groups"].values()), 62)
        self.assertGreater(open_report["groups"]["one or more"]["measured"], 0)
        self.assertGreater(open_report["groups"]["zero"]["measured"], 0)
        rate = "profile-flags-per-100-decisions-by-arrival"
        rate_report = json.loads(subprocess.check_output([sys.executable, CLI, OPEN_ARENA, rate]))[rate]
        unfinished = rate_report["groups"]["unfinished"]
        self.assertEqual(unfinished["measured"], 1)
        self.assertAlmostEqual(unfinished["median"], 8 / 691 * 100)
        error = subprocess.run([sys.executable, CLI, SAMPLE, report, "--profiles"], capture_output=True)
        self.assertEqual(error.returncode, 2)
        self.assertIn(b"Use report IDs", error.stderr)

    def test_rate_profiles_preserve_missing_exposure_and_real_zeros(self):
        rows = [
            {"arrived": True, "distance_m": 500, "collisions": 2},
            {"arrived": False, "distance_m": 25, "collisions": 0},
            {"arrived": False, "distance_m": 0, "collisions": 0},
            {"arrived": False, "collisions": 0},
            {"arrived": False, "distance_m": 10},
        ]
        _, report = profiles.REPORTS["profile-collisions-per-km-by-arrival"]
        result = report(rows)
        self.assertEqual(result["unit"], "collisions/km")
        self.assertEqual(result["groups"]["arrived"]["median"], 4)
        unfinished = result["groups"]["unfinished"]
        self.assertEqual((unfinished["zero"], unfinished["measured"], unfinished["unavailable"]), (1, 1, 3))

    def test_rate_profiles_use_distinct_denominators(self):
        rows = [{"distance_m": 500, "time_s": 25, "speeding_s": 5, "decisions": 40, "flagged_choices": 1}]
        for report_id, value in (
            ("profile-speeding-pct-by-controls", 20),
            ("profile-flags-per-100-decisions-by-controls", 2.5),
        ):
            _, report = profiles.REPORTS[report_id]
            self.assertEqual(report(rows)["groups"]["unknown"]["median"], value)

    def test_paired_rates_hold_cohorts_and_measurements_constant(self):
        _, report = profiles.PAIRED_RATES["paired-collisions-per-km-by-arrival"]
        baseline = [
            {"arrived": False, "distance_m": 500, "collisions": 2},
            {"arrived": False, "distance_m": 500, "collisions": 0},
            {"arrived": False, "distance_m": 0, "collisions": 0},
            {"arrived": False, "distance_m": 500, "collisions": 1},
            {"arrived": False, "distance_m": 0, "collisions": 0},
        ]
        comparison = [
            {"arrived": True, "distance_m": 1000, "collisions": 1},
            {"arrived": True, "distance_m": 500, "collisions": 0},
            {"arrived": True, "distance_m": 250, "collisions": 1},
            {"arrived": True, "distance_m": 750},
            {"arrived": False, "distance_m": 0, "collisions": 0},
        ]
        result = report(baseline, comparison)
        self.assertEqual(result["cohort_side"], "baseline")
        self.assertEqual(list(result["groups"]), ["unfinished"])
        group = result["groups"]["unfinished"]
        self.assertEqual((group["pairs"], group["baseline_only"], group["comparison_only"]), (5, 1, 1))
        self.assertEqual((group["baseline"]["median"], group["comparison"]["median"]), (2, 0.5))
        self.assertEqual(
            {key: group["difference"][key] for key in ("measured", "unavailable", "min", "median", "max", "zero")},
            {"measured": 2, "unavailable": 3, "min": -3, "median": -1.5, "max": 0, "zero": 1},
        )

    def test_paired_rate_catalog_and_comparison(self):
        catalog = subprocess.check_output([sys.executable, CLI, "--list-paired-rates"], text=True)
        names = [line.split()[0] for line in catalog.splitlines()]
        self.assertEqual(len(names), 100)
        self.assertEqual(names, sorted(profiles.PAIRED_RATES))
        result = json.loads(
            subprocess.check_output([sys.executable, CLI, PREVIOUS, "--compare", SAMPLE, "--paired-rates"])
        )
        self.assertEqual(list(result["reports"]), names)
        self.assertEqual(len(result["routes"]["matched"]), 2)
        for report in result["reports"].values():
            self.assertEqual(sum(group["pairs"] for group in report["groups"].values()), 2)
        self.assertEqual(result["reports"]["paired-speeding-pct-by-length"]["difference_unit"], "percentage points")
        name = "paired-collisions-per-km-by-arrival"
        error = subprocess.run([sys.executable, CLI, SAMPLE, name], capture_output=True)
        self.assertEqual(error.returncode, 2)
        self.assertIn(b"require --compare", error.stderr)
