"""Published replay checks count drives independently of their verdicts."""

import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import helpers  # noqa: F401 (puts the repository on sys.path)
from scripts.report_replay_drift import OUTPUT, replay_matrix, replay_status, run_replay

CLI = OUTPUT.parent.parent / "scripts" / "report_replay_drift.py"


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

    def test_replay_rejects_ambiguous_transcripts_and_bad_provenance(self):
        row = {
            "recording": "arena.json.gz",
            "replay_source_commit": "b" * 40,
            "engine": "node v22.23.4",
            "total": 1,
        }
        for changes, message in [
            ({"manifest": ["bad"]}, "manifest object"),
            ({"replay_source_commit": 1}, "source revision"),
            ({"engine": 22}, "Node version"),
            ({"engine": "node v22"}, "Node version"),
            ({"manifest": {"source_dirty": True}}, "uncommitted changes"),
            ({"manifest": {"source_dirty": 0}}, "uncommitted changes"),
            ({"total": 0}, "positive drive count"),
        ]:
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, message):
                replay_matrix([{**row, **changes}])
        line = "replay: all 1 drives played out as recorded\n"
        self.assertEqual(replay_status(line * 2, 0, 1)[0], "Error")
        self.assertEqual(replay_status("replay: flagger did not play out as recorded", 0, 1), ("Drift", "flagger"))
        self.assertEqual(replay_status(line, -9, 1), ("Error", "Replay runner exited with status -9"))

    def test_matrix_filters_an_alternate_index_and_explains_malformed_files(self):
        row = {"replay_source_commit": "b" * 40, "engine": "node v22.23.4", "total": 1}
        rows = [
            {"recording": "arena.json.gz", **row},
            {"recording": "bench.json.gz", "map": "kitsilano", **row},
            {"driver": "rules"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "index.json"
            path.write_text(json.dumps({"rows": rows}), encoding="utf-8-sig")
            cli = [sys.executable, CLI, "matrix", "--results", path]
            result = json.loads(subprocess.check_output(cli))
            self.assertEqual([job["tape"] for job in result["include"]], ["arena.json.gz", "bench.json.gz"])
            selected = json.loads(subprocess.check_output([*cli, "--runner", "bench_node.mjs"]))
            self.assertEqual([job["tape"] for job in selected["include"]], ["bench.json.gz"])
            selected = json.loads(subprocess.check_output([*cli, "--tape", "arena.json.gz"]))
            self.assertEqual([job["tape"] for job in selected["include"]], ["arena.json.gz"])
            unknown = subprocess.run([*cli, "--tape", "typo"], capture_output=True, text=True)
            self.assertEqual(unknown.returncode, 2)
            self.assertIn("no matching replay jobs for: typo", unknown.stderr)
            path.write_text("{}")
            broken = subprocess.run(cli, capture_output=True, text=True)
            self.assertEqual(broken.returncode, 2)
            self.assertIn(str(path), broken.stderr)
            self.assertNotIn("Traceback", broken.stderr)

    def test_replay_command_keeps_default_report_only_and_supports_a_strict_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            checkout = Path(tmp) / "missing-checkout"
            tape = Path(tmp) / "unavailable %0A\ntape.json.gz"
            summary = Path(tmp) / "summary"
            cli = [sys.executable, CLI, "run", checkout, tape, "arena_node.mjs", "1", "main"]
            with patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(summary)}):
                for flags, status in [([], 0), (["--check"], 1)]:
                    result = subprocess.run([*cli, *flags], capture_output=True, text=True)
                    self.assertEqual(result.returncode, status)
                    self.assertIn("unknown revision", result.stdout)
                    self.assertIn("Replay tape does not exist", result.stdout)
                    self.assertIn("%250A%0A", result.stdout)
                    self.assertEqual(len(result.stdout.splitlines()), 1)
                for value in ("0", "-1"):
                    bad = [*cli]
                    bad[6] = value
                    result = subprocess.run(bad, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("positive integer", result.stderr)
                result = subprocess.run([*cli, "--timeout", "0"], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn("positive integer", result.stderr)
            self.assertEqual(len(summary.read_text().splitlines()), 2)

    def test_custom_timeout_reaches_the_replay_process(self):
        prefix = "scripts.report_replay_drift"
        with (
            patch(f"{prefix}.subprocess.Popen") as popen,
            patch(f"{prefix}.subprocess.run", side_effect=subprocess.TimeoutExpired(["node"], 3)) as runner,
            patch(f"{prefix}.urlopen"),
        ):
            popen.return_value.__enter__.return_value.poll.return_value = None
            status = run_replay(Path("."), Path("tape.json.gz"), "arena_node.mjs", 2, timeout=3)
        self.assertEqual(runner.call_args.kwargs["timeout"], 3)
        self.assertEqual(status, ("Error", "The replay exceeded 3 seconds"))
