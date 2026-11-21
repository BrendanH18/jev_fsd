"""Published replay checks count drives independently of their verdicts."""

import json
import unittest

import helpers  # noqa: F401 (puts the repository on sys.path)
from scripts.report_replay_drift import OUTPUT, replay_matrix, replay_status


class ReplayDriftTest(unittest.TestCase):
    def test_failed_drive_can_replay_exactly(self):
        output = 'flagger FAIL arrived=false\nreplay: all 1 drives played out as recorded\n{"passed":0}\n'
        self.assertEqual(replay_status(output, 0, 1), ("Exact", "1 drive matched"))
        self.assertEqual(replay_status(output, 0, 2)[0], "Error")

    def test_drift_and_runner_errors_are_distinct(self):
        output = "replay: on-your-bumper, flagger did not play out as recorded\n"
        self.assertEqual(replay_status(output, 0, 2), ("Drift", "on-your-bumper, flagger"))
        self.assertEqual(replay_status(output, 1, 2)[0], "Error")
        self.assertEqual(replay_status("server startup failed", 0, 2)[0], "Error")

    def test_every_published_recording_has_a_replay_job(self):
        rows = json.loads(OUTPUT.read_text())["rows"]
        matrix = replay_matrix(rows)["include"]
        self.assertEqual({job["tape"] for job in matrix}, {row["recording"] for row in rows if row.get("recording")})

    def test_a_manifest_selects_the_pinned_tree_and_engine(self):
        row = {
            "recording": "data/recordings/jev-city.json.gz",
            "manifest": {"source_commit": "a" * 40, "engine": "node v22.23.4"},
            "map": "kitsilano",
            "total": 12,
        }
        (job,) = replay_matrix([row])["include"]
        self.assertEqual(job["tree"], "a" * 40)
        self.assertEqual(job["node"], "22.23.4")
        self.assertEqual(job["runner"], "bench_node.mjs")
