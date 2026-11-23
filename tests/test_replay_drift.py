"""Published replay checks count drives independently of their verdicts."""

import json
import subprocess
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import helpers  # noqa: F401 (puts the repository on sys.path)
from scripts.report_replay_drift import OUTPUT, replay_matrix, replay_status, run_replay


class ReplayDriftTest(unittest.TestCase):
    def test_failed_drive_can_replay_exactly(self):
        output = 'flagger FAIL arrived=false\nreplay: all 1 drives played out as recorded\n{"passed":0}\n'
        self.assertEqual(replay_status(output, 0, 1), ("Exact", "1 drive matched"))
        self.assertEqual(replay_status(output, 0, 2)[0], "Error")

    def test_drift_and_runner_errors_are_distinct(self):
        output = "replay: on-your-bumper, flagger did not play out as recorded\n"
        self.assertEqual(replay_status(output, 0, 2), ("Drift", "on-your-bumper, flagger"))
        self.assertEqual(replay_status(output, 0, 1)[0], "Error")
        self.assertEqual(replay_status("replay: flagger, flagger did not play out as recorded", 0, 2)[0], "Error")
        self.assertEqual(replay_status(output, 1, 2)[0], "Error")
        self.assertEqual(replay_status("server startup failed", 0, 2)[0], "Error")

    def test_every_published_recording_has_a_replay_job(self):
        rows = json.loads(OUTPUT.read_text())["rows"]
        matrix = replay_matrix(rows)["include"]
        self.assertEqual({job["tape"] for job in matrix}, {row["recording"] for row in rows if row.get("recording")})
        (deepseek,) = [job for job in matrix if job["tape"].endswith("/deepseek-arena-2026-11-11.json.gz")]
        self.assertEqual(deepseek["tree"], "dcfc663dc72f2bcf709e744288a8a5c789cbc974")

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

    def test_conflicting_rows_cannot_silently_replace_a_replay_job(self):
        row = {
            "recording": "data/recordings/jev-arena-2026-11-11.json.gz",
            "replay_source_commit": "b" * 40,
            "engine": "node v22.23.4",
            "total": 12,
        }
        self.assertEqual(len(replay_matrix([row, row])["include"]), 1)
        with self.assertRaisesRegex(ValueError, "conflicting replay settings"):
            replay_matrix([row, {**row, "total": 13}])
        with self.assertRaisesRegex(ValueError, "positive drive count"):
            replay_matrix([{**row, "total": True}])

    def test_timeout_prints_diagnostics_from_the_replay_runner(self):
        prefix = "scripts.report_replay_drift"
        error = subprocess.TimeoutExpired(["node"], 1200, output=b"last drive\n", stderr="runner warning\n")
        output = StringIO()
        with (
            patch(f"{prefix}.subprocess.Popen") as popen,
            patch(f"{prefix}.subprocess.run", side_effect=error),
            patch(f"{prefix}.urlopen"),
            redirect_stdout(output),
        ):
            server = popen.return_value.__enter__.return_value
            server.poll.return_value = None
            status = run_replay(Path("."), Path("tape.json.gz"), "arena_node.mjs", 2)
        server.terminate.assert_called_once()
        self.assertEqual(status, ("Error", "The replay exceeded 20 minutes"))
        self.assertEqual(output.getvalue(), "last drive\nrunner warning\n")
