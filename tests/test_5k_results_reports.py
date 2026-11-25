"""Replay matrix and weekly report behavior with offline artifacts."""

import gzip
import json
import subprocess
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

import helpers  # noqa: F401

from scripts import report_replay_drift as replay
from scripts import soak_summary as soak

ROW = {
    "recording": "data/recordings/run.json.gz",
    "replay_source_commit": "a" * 40,
    "engine": "node v22.23.5",
    "total": 2,
}
ROUTE = {"id": "a", "pass": True}


class ReplayReportsTest(TestCase):
    def test_matrix_rejects_malformed_row_settings(self):
        for changes, error in [
            ({"recording": ""}, "recording path"),
            ({"recording": 1}, "recording path"),
            ({"recording": "foo.json"}, "recording path"),
            ({"recording": "/tmp/tape.json.gz"}, "repository-relative"),
            ({"recording": "C:/tmp/tape.json.gz"}, "repository-relative"),
            ({"recording": "data/../tape.json.gz"}, "repository-relative"),
            ({"recording": "data/./tape.json.gz"}, "repository-relative"),
            ({"recording": "data\\tape.json.gz"}, "repository-relative"),
            ({"recording": "a\nb.json.gz"}, "repository-relative"),
            ({"manifest": {"engine": "node v20.1.0"}}, "conflicting engines"),
            ({"manifest": {"source_commit": "b" * 40}}, "conflicting source revisions"),
            ({"manifest": {"engine": None}, "engine": None}, "exact Node version"),
            ({"manifest": {"source_commit": None}, "replay_source_commit": None}, "full source revision"),
            ({"suite_version": "v00"}, "invalid suite version"),
            ({"manifest": {"suite_version": "v1"}}, "conflicting suite versions"),
            ({"track": ""}, "invalid replay track"),
            ({"manifest": {"track": "open"}}, "conflicting tracks"),
            ({"map": 2}, "invalid replay map"),
            ({"manifest": {"suite": {"kind": "bench"}}}, "inconsistent with its replay runner"),
            ({"total": 2**53}, "positive drive count"),
            ({"passed": 3}, "passed count outside"),
        ]:
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, error):
                replay.replay_matrix([{**ROW, **changes}])
        with self.assertRaisesRegex(ValueError, "published rows must be an array"):
            replay.replay_matrix({})
        with self.assertRaisesRegex(ValueError, "row 2 must be an object"):
            replay.replay_matrix([ROW, True])

    def test_matrix_filters_use_row_identity_and_compose(self):
        rows = [
            {**ROW, "driver": "jev", "track": "guarded", "suite_version": "v1", "map": "kitsilano"},
            {**ROW, "recording": "alt.json.gz", "driver": "jev", "track": "open", "suite_version": "custom"},
            {**ROW, "recording": "other.json.gz", "driver": "llm:other", "map": "kitsilano"},
        ]
        for filters, expected in [
            ({"driver": "jev"}, [ROW["recording"], "alt.json.gz"]),
            ({"track": "open"}, ["alt.json.gz"]),
            ({"suite": "v1"}, [ROW["recording"]]),
            ({"map_id": "kitsilano"}, [ROW["recording"], "other.json.gz"]),
            ({"track": "open", "suite": "v1"}, []),
        ]:
            with self.subTest(filters=filters):
                matrix = replay.replay_matrix(rows, **filters)
                self.assertEqual([job["tape"] for job in matrix["include"]], expected)
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "results.json"
            path.write_text(json.dumps({"rows": rows}))
            stdout = StringIO()
            with redirect_stdout(stdout):
                self.assertEqual(
                    replay.main(
                        [
                            "matrix",
                            "--results",
                            str(path),
                            "--driver",
                            "jev",
                            "--track",
                            "open",
                            "--suite-version",
                            "custom",
                        ]
                    ),
                    0,
                )
            self.assertEqual(json.loads(stdout.getvalue())["include"][0]["tape"], "alt.json.gz")

    def test_transcript_errors_explain_the_count_or_id_issue(self):
        for line, count, verdict in [
            ("replay: all 1 drive played out as recorded", 1, ("Exact", "1 drive matched")),
            (
                "replay: all 1 drives played out as recorded",
                2,
                ("Error", "Expected 2 drives, but the runner replayed 1"),
            ),
            ("replay: route:one, drive.two did not play out as recorded", 2, ("Drift", "route:one, drive.two")),
            ("replay: a, a did not play out as recorded", 2, ("Error", "Runner repeated a drifted drive ID")),
            ("replay: a, b did not play out as recorded", 1, ("Error", "Runner reported 2 drifted drives out of 1")),
            ("no replay output", 2, ("Error", "Replay runner did not report fidelity")),
            ("replay: first\nreplay: second", 2, ("Error", "Replay runner reported fidelity 2 times")),
        ]:
            with self.subTest(line=line):
                self.assertEqual(replay.replay_status(line, 0, count), verdict)

    def test_replay_checks_runner_and_resolves_tape_before_running_child(self):
        with self.assertRaisesRegex(ValueError, "unknown replay runner"):
            replay.run_replay(Path("."), Path("tape.json.gz"), "test.mjs", 1)
        with (
            patch.object(replay.subprocess, "Popen") as server,
            patch.object(replay, "urlopen"),
            patch.object(
                replay.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout="", stderr="")
            ) as runner,
        ):
            server.return_value.__enter__.return_value.poll.return_value = None
            replay.run_replay(Path("."), Path("tape.json.gz"), "arena_node.mjs", 1)
            command = runner.call_args.args[0]
            self.assertEqual(command[-1], str(Path("tape.json.gz").resolve()))
            self.assertEqual(runner.call_args.kwargs["encoding"], "utf-8")
            self.assertEqual(runner.call_args.kwargs["errors"], "replace")

    def test_server_start_failure_distinguishes_death_and_timeout(self):
        for exited, times, expected in [
            (4, [0], "server exited before replay (status 4)"),
            (None, [0, 61], "server did not become ready within 60 seconds"),
        ]:
            with (
                self.subTest(exited=exited),
                patch.object(replay.subprocess, "Popen") as server,
                patch.object(replay.time, "monotonic", side_effect=times),
                patch.object(replay.subprocess, "run") as runner,
            ):
                server.return_value.__enter__.return_value.poll.return_value = exited
                status, detail = replay.run_replay(Path("."), Path("tape.json.gz"), "arena_node.mjs", 2)
                self.assertEqual(status, "Error")
                self.assertIn(expected, detail)
                runner.assert_not_called()

    def test_json_status_and_summary_survive_a_failed_summary_write(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            tape = root / "test_*.json.gz"
            tape.touch()
            summary = root / "report.md"
            command = ["run", str(root), str(tape), "arena_node.mjs", "2", "main", "--json"]
            for setup, error in [(root / "missing", "checkout does not exist"), (root, "runner is missing")]:
                stdout = StringIO()
                with patch.dict("os.environ", GITHUB_STEP_SUMMARY=str(summary)), redirect_stdout(stdout):
                    self.assertEqual(replay.main([command[0], str(setup), *command[2:]]), 0)
                self.assertIn(error, json.loads(stdout.getvalue())["detail"])
            self.assertIn(r"test\_\*.json.gz", summary.read_text())
            stderr, stdout = StringIO(), StringIO()
            with (
                patch.dict("os.environ", GITHUB_STEP_SUMMARY=str(root)),
                redirect_stdout(stdout),
                redirect_stderr(stderr),
            ):
                self.assertEqual(replay.main([*command, "--check"]), 1)
            verdict = json.loads(stdout.getvalue())
            self.assertEqual(verdict["status"], "Error")
            self.assertEqual(verdict["count"], 2)
            self.assertEqual(verdict["target"], "main")
            self.assertIn("Could not write the replay step summary", stderr.getvalue())

    def test_runner_logs_do_not_pollute_json_verdict(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            tape = root / "tape.json.gz"
            tape.touch()
            runner = root / "scripts" / "arena_node.mjs"
            runner.parent.mkdir()
            runner.touch()

            def replay_drive(*_args, **_kwargs):
                print("runner output")
                return "Exact", "2 drives matched"

            stdout, stderr = StringIO(), StringIO()
            with (
                patch.dict("os.environ", clear=True),
                patch.object(replay, "run_replay", side_effect=replay_drive),
                redirect_stdout(stdout),
                redirect_stderr(stderr),
            ):
                self.assertEqual(
                    replay.main(["run", str(root), str(tape), runner.name, "2", "main", "--json", "--check"]), 0
                )
            self.assertEqual(json.loads(stdout.getvalue())["status"], "Exact")
            self.assertIn("runner output", stderr.getvalue())


class SoakReportsTest(TestCase):
    def test_literal_workflow_matrix_expands_complete_rows(self):
        workflow = """jobs:
  urban:
    strategy:
      matrix:
        city:
          - ottawa
          - toronto
        weather: [dry, "wet,#day"]
        exclude:
          - city: ottawa
            weather: dry
        include:
          - park: off
          - { city: toronto, park: on }
          - { city: calgary, weather: snow, park: "next \\"door\\"" }
    env:
      LEG: '${{ matrix.city }} / ${{ matrix.weather }} / ${{ matrix.park }}''s'
"""
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "soak.yml"
            path.write_text(workflow, encoding="utf-8-sig")
            self.assertEqual(
                soak.expected_legs(path),
                [
                    "ottawa / wet,#day / off's",
                    "toronto / dry / on's",
                    "toronto / wet,#day / on's",
                    'calgary / snow / next "door"\'s',
                ],
            )
            path.write_text(workflow.replace("matrix.city", "matrix.missing"))
            with self.assertRaisesRegex(ValueError, "missing matrix keys: missing"):
                soak.expected_legs(path)
            path.write_text("jobs:\n  urban:\n    env:\n      LEG: ${{ matrix.city }}\n")
            with self.assertRaisesRegex(ValueError, "references a missing matrix"):
                soak.expected_legs(path)

    def test_invalid_harness_metadata_and_route_evidence(self):
        for payload, error in [
            ({"schema": True, "results": [ROUTE]}, "unsupported soak schema"),
            ({"failed": "no", "results": [ROUTE]}, "boolean soak failure"),
            ({"skipped": [2], "results": [ROUTE]}, "skipped configuration ID array"),
            ({"skipped": ["a", "a"], "results": [ROUTE]}, "duplicate skipped configuration"),
            ({"runs": [{"id": "x", "results": [ROUTE]}], "skipped": ["x"]}, "run and skipped configurations overlap"),
            ({"runs": [{"id": "x", "results": [ROUTE]}] * 2}, "duplicate configuration ID"),
            ({"id": 5, "results": [ROUTE]}, "expected a configuration ID"),
            ({"harness_error": True}, "expected a nonblank harness error"),
            ({"stopped": []}, "expected a nonblank stop reason"),
            ({"results": [{**ROUTE, "arrived": "no"}]}, "expected a boolean arrival"),
            ({"results": [{**ROUTE, "deadlocks": -1}]}, "deadlocks must be a nonnegative integer"),
            ({"results": [{**ROUTE, "collisions": False}]}, "collisions must be a nonnegative integer"),
            ({"results": [{**ROUTE, "simulation_error": []}]}, "expected a nonblank simulation error"),
        ]:
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                soak.leg_failures(payload)

    def test_soak_warnings_explain_failfast_harness_and_route_evidence(self):
        for payload, expected in [
            ({"results": [ROUTE], "skipped": ["pairs/0", "pairs/1"]}, "skipped configurations (2): pairs/0, pairs/1"),
            ({"failed": True, "results": [ROUTE]}, "harness marked the leg failed"),
            ({"results": [], "stopped": "budget"}, "stopped: budget"),
            ({"runs": [{"results": [{**ROUTE, "collisions": 1}]}]}, "a: collision"),
            ({"runs": [{"results": [{**ROUTE, "simulation_error": "throw"}]}]}, "a: simulation error"),
            ({"runs": [{"results": [{**ROUTE, "deadlocks": 1}]}]}, "a: stuck"),
        ]:
            with self.subTest(payload=payload):
                _, failures = soak.leg_failures(payload)
                self.assertEqual(len(failures), 1)
                self.assertIn(expected, failures[0])

    def test_passing_benchmark_deadlock_is_evidence_without_a_failed_verdict(self):
        run = {"results": [{**ROUTE, "arrived": True, "deadlocks": 1}]}
        self.assertEqual(soak.leg_failures(run), (1, []))
        self.assertEqual(soak.leg_categories(run)["stuck"], 1)
        self.assertEqual(soak.leg_failures({"runs": [run]}), (1, ["a: stuck"]))

    def test_gzip_artifact_and_output_failures_are_reported(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = {
                "results": [
                    {"id": "a", "pass": False, "failures": ["<hold>", "against | sign"]},
                    {"id": "b", "pass": False, "failures": ["red light"]},
                ]
            }
            report = root / "soak.json.gz"
            report.write_bytes(gzip.compress(json.dumps(payload).encode()))
            stdout = StringIO()
            with (
                patch.dict("os.environ", GITHUB_STEP_SUMMARY=str(root)),
                patch.object(soak, "expected_legs", return_value=[]),
                redirect_stdout(stdout),
            ):
                self.assertEqual(soak.main(root), 0)
            output = stdout.getvalue()
            self.assertIn("a: &lt;hold&gt;, against \\| sign<br>b: red light", output)
            self.assertIn("could not write step summary", output)
            for name, data, reason in [
                ("run.json", b"{}", "multiple report files in one artifact"),
                ("soak.json.gz", report.read_bytes()[:14], "unreadable soak.json.gz"),
            ]:
                path = root / name
                path.write_bytes(data)
                stdout = StringIO()
                with (
                    patch.dict("os.environ", clear=True),
                    patch.object(soak, "expected_legs", return_value=[]),
                    redirect_stdout(stdout),
                ):
                    self.assertEqual(soak.main(root), 0)
                self.assertIn(reason, stdout.getvalue())
                path.unlink()

    def test_missing_workflow_preserves_uploaded_leg_report(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "run.json").write_text(json.dumps({"results": [ROUTE]}))
            stdout = StringIO()
            with patch.dict("os.environ", clear=True), redirect_stdout(stdout):
                self.assertEqual(soak.main(root, workflow=root / "missing.yml"), 0)
            self.assertIn("could not read the expected legs", stdout.getvalue())
            self.assertIn("| 1 | passed |", stdout.getvalue())
