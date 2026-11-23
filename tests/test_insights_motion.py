import unittest

import helpers  # noqa: F401 (puts the repository on sys.path)
from scripts.run_insights.motion import REPORTS


def report(name, rows):
    return REPORTS[f"motion-{name}"][1](rows)


class MotionInsightsTests(unittest.TestCase):
    def test_rankings_on_measured_drive(self):
        drive = {
            "id": "s1-1",
            "time_s": 40,
            "wall_ms": 2500,
            "stopped_s": 10,
            "distance_m": 500,
            "progress": 0.625,
            "avg_kmh": 45,
            "max_accel": 3.5,
            "max_decel": -4.2,
            "rms_jerk": 2,
            "max_jerk": 7,
            "max_lat_accel": 4.1,
            "hard_brakes": 3,
            "lane_rms_m": 0.2,
            "lane_max_m": 0.8,
            "lane_changes": 1,
            "min_gap_m": 3,
            "min_ttc_s": 1.5,
            "min_headway_s": 0.45,
            "speeding_s": 0.8,
            "off_road_s": 1.2,
        }
        expected = {
            "duration": 40,
            "distance": 500,
            "progress": 62.5,
            "trip-speed": 45,
            "moving-speed": 60,
            "moving-time": 30,
            "stopped-time": 10,
            "stopped-share": 25,
            "simulation-speed": 16,
            "peak-acceleration": 3.5,
            "peak-deceleration": -4.2,
            "rms-jerk": 2,
            "peak-jerk": 7,
            "jerk-crest": 3.5,
            "cornering-load": 4.1,
            "hard-brake-density": 6,
            "lane-tracking": 0.2,
            "peak-lane-error": 0.8,
            "lane-error-crest": 4,
            "lane-change-density": 2,
            "following-gap": 3,
            "closing-time": 1.5,
            "following-headway": 0.45,
            "off-road-time": 1.2,
            "speeding-share": 2,
        }
        self.assertEqual(set(REPORTS), {f"motion-{name}" for name in expected})
        for name, value in expected.items():
            with self.subTest(name=name):
                ranking = report(name, [drive, {}])
                self.assertEqual(ranking["routes"], [{"id": "s1-1", "value": value}])
                self.assertEqual(ranking["unavailable"], 1)

    def test_near_misses_and_roughness_have_opposite_rank_orders(self):
        rows = [
            {"id": "a", "min_ttc_s": 1, "rms_jerk": 2},
            {"id": "b", "min_ttc_s": 1, "rms_jerk": 4},
            {"id": "c", "min_ttc_s": 0.5, "rms_jerk": 3},
        ]
        self.assertEqual([r["id"] for r in report("closing-time", rows)["routes"]], ["c", "a", "b"])
        self.assertEqual([r["id"] for r in report("rms-jerk", rows)["routes"]], ["b", "c", "a"])

    def test_missing_measurement_and_undefined_rates(self):
        rows = [{"min_gap_m": value} for value in [False, "0", None, float("nan"), float("inf"), 0]]
        self.assertEqual(report("following-gap", rows)["unavailable"], 5)
        self.assertEqual(report("following-gap", rows)["routes"][0]["value"], 0)
        parked = {"time_s": 5, "stopped_s": 5, "distance_m": 0, "hard_brakes": 0}
        for name in ("moving-speed", "hard-brake-density"):
            self.assertEqual(report(name, [parked])["unavailable"], 1)
        self.assertEqual(report("moving-time", [parked])["routes"][0]["value"], 0)
        self.assertEqual(report("stopped-share", [parked])["routes"][0]["value"], 100)

    def test_summary_and_deterministic_tie_breaking(self):
        rows = [
            {"id": "z", "rms_jerk": 2, "min_ttc_s": 1},
            {"id": "a", "rms_jerk": 2, "min_ttc_s": 1},
            {"id": "m", "rms_jerk": 6, "min_ttc_s": 3},
            {"id": "missing"},
        ]
        jerk = report("rms-jerk", rows)
        self.assertEqual([r["id"] for r in jerk["routes"]], ["m", "a", "z"])
        self.assertEqual(jerk["unavailable"], 1)
        self.assertEqual(
            jerk["summary"],
            {"min": 2, "median": 2, "p95": 5.6, "max": 6, "mean": 3.3333},
        )
        ttc = report("closing-time", rows)
        self.assertEqual([r["id"] for r in ttc["routes"]], ["a", "z", "m"])
        self.assertEqual(
            report("rms-jerk", [])["summary"],
            {"min": None, "median": None, "p95": None, "max": None, "mean": None},
        )
