import csv
import gzip
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import helpers  # noqa: F401
from scripts.inspect_run import format_output, load_run


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "scripts" / "inspect_run.py"
BENCH = {"map": "kitsilano", "pack": 6, "seed": 1, "count": 3}
TAGS = {"length_m": 550, "lefts": 0, "rights": 0, "signals": 1, "stops": 2}
ROWS = [
    {"id": "route-1", "pass": True, "time_s": 80, "tags": TAGS},
    {"id": "route-2", "pass": False, "time_s": 10, "tags": TAGS, "failures": ["red light"]},
    {"id": "route-special", "pass": True, "tags": TAGS},
]
SAMPLE = ROOT / "data/runs/20261120-120000-rules.json"


class InspectorCLITests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.dir = Path(directory.name)
        self.before = self.save("before.json", ROWS)

    def save(self, name, rows, config=BENCH, **metadata):
        path = self.dir / name
        path.write_text(json.dumps({"config": config, "results": rows, **metadata}), encoding="utf-8")
        return path

    def cli(self, *args, input_text=None, code=0, error=None):
        result = subprocess.run([sys.executable, CLI, *args], input=input_text, capture_output=True)
        self.assertEqual(result.returncode, code, result.stderr.decode())
        if error:
            self.assertIn(error, result.stderr.decode())
        self.assertNotIn(b"Traceback", result.stderr)
        return result.stdout.decode()

    def test_new_filters_and_inclusive_bounds(self):
        ranked = "motion-duration"
        report = json.loads(self.cli(self.before, ranked, "--route-glob", "route-[12]", "--exclude-route", "route-1"))
        self.assertEqual([r["id"] for r in report[ranked]["routes"]], ["route-2"])
        report = json.loads(
            self.cli(self.before, "suite-verdicts", "--min-metric", "time_s=10", "--max-metric", "time_s=10")
        )
        self.assertEqual(report["suite-verdicts"]["counts"], {"failed": 1})
        report = json.loads(self.cli(self.before, "suite-verdicts", "--route-glob", "*special", "--route-glob", "*-1"))
        self.assertEqual(report["suite-verdicts"]["counts"], {"passed": 2})
        after = self.save("after.json", [{**row, "time_s": 11} for row in ROWS])
        report = json.loads(self.cli(self.before, "--compare", after, "--min-metric", "time_s=70", "changes-time-s"))
        self.assertEqual(report["routes"]["matched"], ["route-1"])
        self.assertEqual(report["reports"]["changes-time-s"]["rows"][0]["after"], 11)

    def test_filter_argument_errors_are_actionable(self):
        for args, error in (
            (("--min-metric", "unknown=1"), "from --list-fields"),
            (("--max-metric", "time_s=NaN"), "finite number"),
            (("--min-metric", "time_s=10", "--max-metric", "time_s=5"), "exceeds --max-metric"),
            (("--min-metric", "time_s=1", "--min-metric", "time_s=1"), "supplied more than once"),
            (("--route", ""), "nonblank"),
            (("--exclude-route", "  "), "nonblank"),
            (("--route-glob", "  "), "nonblank"),
            (("--drive-map", "\t"), "nonblank"),
            (("--failure-reason", ""), "nonblank"),
            (("--comp", "elsewhere"), "unrecognized arguments"),
        ):
            with self.subTest(args=args):
                self.cli(self.before, *args, code=2, error=error)

    def test_catalog_modes_and_export_formats(self):
        self.assertIn("changes-time-s", self.cli("--list-changes", "--filter", "simulated seconds"))
        self.assertIn("repeat-collisions", self.cli("--list-repeats", "--filter", "collisions"))
        self.assertIn("evidence-event-frequency", self.cli("--list-diagnostics", "--filter", "affected routes"))
        self.assertIn("rerouting", self.cli("--list-cohorts"))
        self.assertIn("cost_usd", self.cli("--list-fields"))
        fields = json.loads(self.cli("--list-fields", "--filter", "seconds", "--format", "json"))["catalog"]
        self.assertIn({"id": "time_s", "description": "seconds"}, fields)
        headings = self.cli("--list-cohorts", "--format", "markdown")
        self.assertIn("## catalog", headings)
        csv_text = self.cli("--list-changes", "--filter", "simulated seconds", "--format", "csv")
        self.assertEqual(
            list(csv.DictReader(io.StringIO(csv_text))),
            [
                {
                    "section": "catalog",
                    "id": "changes-time-s",
                    "description": "Rank route contributions to the net change in simulated seconds.",
                }
            ],
        )
        self.cli("--list-changes", "--route", "a", code=2, error="does not take run selection")
        self.cli("--list-repeats", "--repeat", self.before, code=2, error="does not take saved runs")

    def test_repeat_cli_reports_and_selection(self):
        other = self.save(
            "next.json",
            [
                {**ROWS[0], "time_s": 40, "pass": False, "failures": ["timeout"]},
                {**ROWS[1], "time_s": 70, "pass": True, "failures": []},
                ROWS[2],
            ],
        )
        third = self.save("third.json", ROWS)
        cmd = [self.before, "--repeat", other, "--repeat", third, "--expected-repeats", "3"]
        result = json.loads(self.cli(*cmd, "--min-metric", "time_s=75", "repeat-verdicts"))
        self.assertEqual(result["routes"]["matched"], ["route-1"])
        self.assertEqual(result["reports"]["repeat-verdicts"]["rows"][0]["verdicts"], ["passed", "failed", "passed"])
        failure = json.loads(self.cli(*cmd, "--only-failures", "--failure-reason", "timeout"))
        self.assertEqual(failure["routes"]["matched"], ["route-1"])
        self.assertEqual(
            list(failure["reports"]), ["repeat-pass-rate", "repeat-driving-score", "repeat-failures", "repeat-coverage"]
        )
        exported = self.cli(*cmd, "repeat-pass-rate", "--format", "csv")
        rows = list(csv.DictReader(io.StringIO(exported)))
        self.assertEqual([r["attempt"] for r in rows if r["section"] == "repeat-pass-rate: attempts"], ["1", "2", "3"])
        self.assertTrue(any(r["section"] == "repeat-pass-rate: spread" for r in rows))
        self.assertTrue(any(r["section"] == "repeat-pass-rate: measurement" for r in rows))
        self.assertIn("matched routes", self.cli(*cmd, "repeat-pass-rate", "--format", "table"))

    def test_repeat_refuses_different_models_for_the_same_endpoint(self):
        config = {**BENCH, "brain": "llm:shared"}
        one = self.save("one.json", ROWS, config, manifest={"model": "model-a"})
        two = self.save("two.json", ROWS, config, manifest={"model": "model-b"})
        self.assertEqual(load_run(one)[0]["model"], "model-a")
        self.cli(one, "--repeat", two, code=2, error="repeat conditions differ: driver, model")

    def test_repeat_options_check_intent_before_loading_inputs(self):
        other = self.dir / "missing.json"
        for args, message in (
            (("--repeat", other, "--expected-repeats", "3"), "received 2"),
            (("--expected-repeats", "3"), "requires --repeat"),
            (("--repeat", other, "--compare", other), "not allowed with argument"),
            (("--repeat", other, "--summary"), "cannot be combined with --repeat"),
            (("--repeat", other, "scores-ranked"), "See --list-repeats"),
            (("repeat-pass-rate",), "requires --repeat"),
            (("--changes",), "require --compare"),
            (("changes-time-s",), "require --compare"),
            (("--complete-coverage",), "requires --compare or --repeat"),
        ):
            with self.subTest(args=args):
                self.cli(self.before, *args, code=2, error=message)

    def test_selection_and_matching_can_be_required(self):
        after = self.save("partial.json", ROWS[1:])
        malformed = self.save("duplicates.json", [ROWS[0], ROWS[0], ROWS[1]])
        self.cli(self.before, "--route", "unknown", "--require-selection", code=2, error="no drives satisfy")
        self.cli(
            self.before,
            "--compare",
            after,
            "--require-selection",
            "--route",
            "route-1",
            code=2,
            error="no matched drives",
        )
        self.cli(
            self.before, "--repeat", after, "--require-selection", "--route", "route-1", code=2, error="no routes match"
        )
        self.cli(self.before, "--compare", after, "--complete-coverage", code=2, error="incomplete match coverage")
        self.cli(self.before, "--repeat", after, "--complete-coverage", code=2, error="incomplete repeat coverage")
        self.cli(self.before, "--repeat", malformed, "--route", "route-2", code=2, error="duplicate route ID")
        report = self.cli(self.before, "--repeat", after, "--route", "route-2", "--complete-coverage")
        self.assertEqual(json.loads(report)["routes"]["matched"], ["route-2"])

    def test_repeat_aliases_and_hardlinks_are_one_input(self):
        for type_ in ("symlink", "hardlink"):
            alias = self.dir / type_
            if type_ == "symlink":
                alias.symlink_to(self.before)
            else:
                os.link(self.before, alias)
            self.cli(self.before, "--repeat", alias, code=2, error="supplied more than once")

    def test_load_stdin_and_gzip_magic(self):
        raw = self.before.read_bytes()
        for data in (raw, gzip.compress(raw)):
            with self.subTest(bytes=data[:5]):
                self.assertEqual(
                    json.loads(self.cli("-", "suite-verdicts", input_text=data))["suite-verdicts"]["measured_routes"], 3
                )
        backup = self.dir / "backup"
        backup.write_bytes(gzip.compress(raw))
        self.assertEqual(load_run(backup), load_run(self.before))
        self.cli("-", "--compare", "-", code=2, error="only one saved report")

    def test_ingest_errors_name_the_artifact(self):
        malformed = self.dir / "bad.json"
        for content, error in (
            (b'{"results":[],"results":[]}', "duplicate JSON key"),
            (b'{"results":[{"id":"a","id":"b"}]}', "duplicate JSON key 'id'"),
            (b'{"results":[{"time_s":1e999}]}', "invalid JSON number"),
            (b'{"results":[{"id":"\x81"}]}', "utf-8"),
            (b"\x1f\x8b", "end-of-stream"),
        ):
            with self.subTest(error=error):
                malformed.write_bytes(content)
                self.assertIn(str(malformed) + ":", self.bad_input(malformed, error))

        # The decoder's native nesting limit varies by Python version.
        malformed.write_bytes(b'{"results":[]}')
        with patch("scripts.inspect_run.json.loads", side_effect=RecursionError("maximum recursion depth exceeded")):
            with self.assertRaisesRegex(ValueError, f"{malformed.name}: maximum recursion depth"):
                load_run(malformed)

    def bad_input(self, path, error):
        result = subprocess.run([sys.executable, CLI, path], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn(error, result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        return result.stderr

    def test_ingest_stop_metadata_and_heldout_guards(self):
        path = self.save("stopped.json", [], stopped="budget exhausted")
        output = json.loads(self.cli(path, "--summary"))
        self.assertEqual(output["config"]["stopped"], "budget exhausted")
        heldout = self.save("heldout.json", [{"id": "a", "heldout": True}])
        self.cli(heldout, code=2, error="held-out")
        mismatch = self.save("version.json", [], {**BENCH, "suite_version": "v2"}, suite_version="v1")
        self.cli(mismatch, code=2, error="disagree on the suite version")

    def test_change_export_keeps_totals_after_top_filters(self):
        after = self.save("after.json", [{**ROWS[0], "time_s": 100}, {**ROWS[1], "time_s": 11}])
        result = self.cli(self.before, "--compare", after, "changes-time-s", "--top", "1", "--format", "csv")
        rows = list(csv.DictReader(io.StringIO(result)))
        self.assertEqual(len([row for row in rows if row["section"] == "changes-time-s"]), 1)
        self.assertEqual(next(row for row in rows if row["section"] == "changes-time-s: totals")["change"], "21")
        self.assertEqual(next(row for row in rows if row["section"] == "changes-time-s: coverage")["both"], "2")
        self.assertEqual(next(row for row in rows if row["section"] == "excluded routes")["id"], "route-special")
        all_reports = json.loads(self.cli(self.before, "--compare", after, "--changes"))
        self.assertIn("changes-arrival-flow", all_reports["reports"])
        self.assertIn("changes-time-s", all_reports["reports"])

    def test_plain_table_and_markdown_quote_controls_and_inline_formatting(self):
        data = {"display": [{"id": "_a_ [b](c)\t\x1b"}]}
        self.assertIn(r"_a_ [b](c)\x09\x1b", format_output(data, "table"))
        self.assertIn(r"\_a\_ \[b\](c)", format_output(data, "markdown"))
        self.assertNotIn("\x1b", format_output(data, "markdown"))

    def test_summary_and_engine_provenance(self):
        after = self.save("engine.json", ROWS, {**BENCH, "engine": "node 24"})
        output = json.loads(self.cli(self.before, "--compare", after, "--summary"))
        self.assertEqual(output["condition_differences"]["engine"], {"baseline": None, "comparison": "node 24"})
        self.cli(self.before, "--compare", after, "--same-conditions", code=2, error="engine")
        self.assertIn("## config", self.cli(SAMPLE, "--summary", "--format", "markdown"))

    def test_legacy_artifact_is_still_readable_as_module(self):
        output = subprocess.check_output(
            [sys.executable, "-m", "scripts.inspect_run", SAMPLE, "suite-verdicts"], cwd=ROOT
        )
        self.assertEqual(json.loads(output)["suite-verdicts"]["counts"], {"passed": 2})

    def test_malformed_unhashable_id_does_not_break_single_run_selection(self):
        path = self.save("damaged.json", [ROWS[0], {"id": {"unexpected": 1}}])
        result = json.loads(self.cli(path, "--route", "route-1", "suite-verdicts"))
        self.assertEqual(result["suite-verdicts"]["measured_routes"], 1)
