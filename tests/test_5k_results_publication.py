"""Publication input validation and byte-preserving generation."""

from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

import helpers  # noqa: F401

from scripts import build_results as pub

BENCH = pub.RUNS / "20261121-075044-rules.json"
REPLAY = pub.RUNS / "20261121-075524-jev.json"
ARENA = pub.RESULTS / "2026-11-21/rules-arena.json"


def replace(data, path, value):
    node = data
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value


class InputFilesTest(TestCase):
    def test_json_input_diagnostics(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "input.json"
            path.write_text('{"label":"é"}', encoding="utf-8-sig")
            self.assertEqual(pub.read_json(path)["label"], "é")
            for data, error in [
                ('{"inner":{"seed":3,"seed":4}}', "duplicate JSON key 'seed'"),
                ('{"time_s":NaN}', "invalid JSON number NaN"),
                ('{"time_s":Infinity}', "invalid JSON number Infinity"),
                ('{"time_s":-Infinity}', "invalid JSON number -Infinity"),
            ]:
                path.write_text(data)
                with self.subTest(data=data), self.assertRaisesRegex(ValueError, f"input.json: {error}"):
                    pub.read_json(path)
            path.write_bytes(b"\xff")
            with self.assertRaisesRegex(ValueError, "input.json: .*decode"):
                pub.read_json(path)

    def test_suite_definition_rejects_corrupt_frozen_settings(self):
        v1 = pub.CANONICAL["v1"]
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "v1.json"
            for keys, value, error in [
                (("version",), "v2", "version disagrees"),
                (("defined_from",), "bad", "invalid defined_from"),
                (("maps",), {}, "missing suite map"),
                (("maps", "kitsilano"), "bad", "invalid suite map fingerprint"),
                (("arena", "drives"), [], "missing suite arena drives"),
                (("arena", "drives", "door-zone"), [], "invalid suite arena drive"),
                (("arena", "drives", "door-zone", "map"), "wrong", "unknown suite map"),
                (("arena", "drives", "door-zone", "seed"), True, "invalid suite arena seed"),
                (("arena", "drives", "door-zone", "version"), 0, "invalid suite arena version"),
                (("bench", "config"), [], "missing suite benchmark config"),
                (("bench", "config", "map"), "other", "unknown suite benchmark map"),
                (("bench", "config", "features"), "other", "invalid suite benchmark preset"),
                (("bench", "config", "mode"), "realtime", "must be lockstep"),
                (("bench", "config", "seed"), -1, "invalid suite benchmark seed"),
                (("bench", "config", "npcs"), -1, "invalid suite benchmark traffic count"),
                (("bench", "config", "count"), 0, "invalid suite benchmark route count"),
                (("bench", "weathers"), ["dry", "dry"], "invalid suite weather list"),
                (("bench", "weathers"), ["ice"], "invalid suite weather list"),
                (("bench", "ids"), ["s1-1"], "invalid suite benchmark route IDs"),
                (("bench", "route_sha"), "wrong", "invalid suite benchmark route fingerprint"),
                (("bench", "heldout"), [], "missing suite held-out plan"),
                (("bench", "heldout", "seeds"), [101, 101], "invalid suite held-out seed list"),
                (("bench", "heldout", "seeds"), [1, 101], "invalid suite held-out seed list"),
                (("bench", "heldout", "count"), 0, "invalid suite held-out route count"),
                (("bench", "heldout", "route_sha"), "", "invalid suite held-out route fingerprint"),
            ]:
                definition = deepcopy(v1)
                replace(definition, keys, value)
                path.write_text(pub.render(definition))
                with self.subTest(keys=keys, value=value), self.assertRaisesRegex(ValueError, error):
                    pub.load_suite_definitions(root)
            path.unlink()
            with self.assertRaisesRegex(ValueError, "suite v1 is required"):
                pub.load_suite_definitions(root)
            (root / "v01.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "numbered suite filename"):
                pub.load_suite_definitions(root)

    def test_submission_identifies_invalid_metadata(self):
        base = {"format": "jev-published-submission/1", "submitter": "team", "recording_sha256": "a" * 64, "report": {}}
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            for day, name, changes, error in [
                ("2026-02-30", "run", {}, "submission date"),
                ("2026-02-28", "Run", {}, "invalid submission filename"),
                ("2026-02-28", "run", {"format": "jev-published-submission/9"}, "unsupported format"),
                ("2026-02-28", "run", {"submitter": "Other Team"}, "invalid submitter ID"),
                ("2026-02-28", "run", {"recording_sha256": "a" * 16}, "invalid recording SHA-256"),
                ("2026-02-28", "run", {"report": None}, "missing report object"),
                ("2026-02-28", "run", {}, "recording is missing"),
            ]:
                path = root / day / f"{name}.json"
                path.parent.mkdir(exist_ok=True)
                path.write_text(pub.render({**base, **changes}))
                with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                    pub._read_submission_source(path)
            path.write_text("[]")
            with self.assertRaisesRegex(ValueError, "expected an object"):
                pub._read_submission_source(path)


class ManifestTest(TestCase):
    def test_bench_manifest_fields_have_specific_diagnostics(self):
        base = pub.read_json(BENCH)
        prefix = ("manifest",)
        for keys, value, error in [
            (("source_commit",), "xyz", "invalid source_commit"),
            (("source_dirty",), 0, "source_dirty must be false"),
            (("driver",), "cautious", "driver disagrees"),
            (("engine",), "other", "engine disagrees"),
            (("track",), "open", "track disagrees"),
            (("engine_version",), "  ", "missing V8 version"),
            (("cost_usd",), False, "cost disagrees with the manifest"),
            (("maps",), {}, "missing map provenance"),
            (("suite",), [], "missing suite provenance"),
            (("maps", "kitsilano"), [], "invalid map provenance"),
            (("maps", "kitsilano", "fingerprint"), "", "invalid map fingerprint"),
            (("maps", "kitsilano", "pack_version"), False, "invalid pack version"),
            (("maps", "kitsilano", "pack_version"), "other", "pack version disagrees"),
            (("maps", "kitsilano", "components"), {}, "missing map component fingerprints"),
            (("maps", "kitsilano", "components"), {"roads": "no"}, "invalid map component fingerprint"),
            (("suite", "kind"), "arena", "expected a benchmark manifest suite"),
            (("suite", "config"), {}, "benchmark settings disagree"),
            (("suite", "ids"), list(reversed(base["manifest"]["suite"]["ids"])), "benchmark routes disagree"),
            (("suite", "generated_ids"), ["same", "same"], "invalid generated benchmark route IDs"),
            (("suite", "generated_ids"), ["different"], "selection differs"),
            (("suite", "only"), "yes", "only must be a boolean"),
            (("suite", "route_sha"), "bad", "invalid benchmark route fingerprint"),
        ]:
            run = deepcopy(base)
            replace(run, prefix + keys, value)
            with self.subTest(keys=keys), self.assertRaisesRegex(ValueError, error):
                pub.checked_manifest(BENCH, run, "2026-11-21")
        for keys, value, error in [
            (("results", 0, "cost_usd"), -1, "invalid cost_usd for drive"),
            (("results", 0, "cost_usd"), 2**53, "run cost is out of range"),
            (("summary", "cost_usd"), False, "summary cost disagrees"),
        ]:
            run = deepcopy(base)
            replace(run, keys, value)
            with self.subTest(keys=keys), self.assertRaisesRegex(ValueError, error):
                pub.checked_manifest(BENCH, run, "2026-11-21")

    def test_stopped_benchmark_must_complete_an_ordered_prefix_of_planned_routes(self):
        run = pub.read_json(BENCH)
        first, *rest = run["results"]
        run["results"] = [first]
        run["stopped"] = "budget reserve"
        self.assertIs(pub.checked_manifest(BENCH, run, "2026-11-21"), run["manifest"])

        run["results"] = rest
        with self.assertRaisesRegex(ValueError, "benchmark routes disagree"):
            pub.checked_manifest(BENCH, run, "2026-11-21")
        run["results"] = [first]
        del run["stopped"]
        with self.assertRaisesRegex(ValueError, "benchmark routes disagree"):
            pub.checked_manifest(BENCH, run, "2026-11-21")

    def test_cost_rounding_matches_node_for_half_microdollar(self):
        run = pub.read_json(BENCH)
        run["results"][0]["cost_usd"] = 0.0000005
        run["results"][1]["cost_usd"] = None
        run["manifest"]["cost_usd"] = run["summary"]["cost_usd"] = 0.000001
        self.assertIs(pub.checked_manifest(BENCH, run, "2026-11-21"), run["manifest"])

    def test_canonical_configuration_and_route_diagnostics(self):
        run = pub.read_json(BENCH)
        manifest, definition = run["manifest"], pub.CANONICAL["v1"]
        suite, config = manifest["suite"], run["config"]
        suite.update(generated_ids=suite["ids"], route_sha=definition["bench"]["route_sha"])
        manifest["maps"]["kitsilano"]["fingerprint"] = definition["maps"]["kitsilano"]
        self.assertIsNone(pub.canonical_mismatch(run, manifest, definition))
        for target, key, value, message in [
            (run, "stopped", "budget", "report stopped early"),
            (suite, "only", True, "route selection is partial"),
            (run["results"][0], "stopped", True, "a drive stopped early"),
            (config, "seed", True, "config seed differs"),
            (config, "npcs", 0, "config npcs differs"),
            (config, "weather", "ice", "weather is outside"),
            (manifest["maps"]["kitsilano"], "fingerprint", "a" * 16, "map fingerprint differs"),
            (config, "park", True, "destination parking"),
            (config, "hour", 0, "custom hour"),
            (config, "cover", 0, "covering row"),
            (config, "without", ["geese"], "omitting features"),
            (manifest, "track", "open", "track must be guarded"),
            (suite, "route_sha", "a" * 16, "route fingerprint differs"),
            (suite, "ids", list(reversed(suite["ids"])), "reported routes differ"),
            (suite, "generated_ids", [], "generated routes differ"),
        ]:
            with self.subTest(key=key), patch.dict(target, {key: value}):
                self.assertIn(message, pub.canonical_mismatch(run, manifest, definition))
        heldout = definition["bench"]["heldout"]
        seeds, count = heldout["seeds"], heldout["count"]
        ids = [f"s{seed}-{index + 1}" for seed in seeds for index in range(count)]
        with (
            patch.dict(config, heldout=True, seeds=seeds, seed=seeds[0], count=len(ids)),
            patch.dict(suite, ids=ids, generated_ids=ids, route_sha=heldout["route_sha"]),
        ):
            self.assertIsNone(pub.canonical_mismatch(run, manifest, definition))
            for target, key, value, error in [
                (config, "seeds", list(reversed(seeds)), "held-out seed list differs"),
                (config, "seed", seeds[-1], "first held-out seed differs"),
                (config, "count", count, "held-out route count differs"),
                (suite, "route_sha", "a" * 16, "held-out route fingerprint differs"),
            ]:
                with self.subTest(key=key), patch.dict(target, {key: value}):
                    self.assertEqual(pub.canonical_mismatch(run, manifest, definition), error)

    def test_canonical_arena_diagnostics(self):
        run = pub.read_json(ARENA)
        manifest, definition = run["manifest"], pub.CANONICAL["v1"]
        manifest["suite"]["drives"] = deepcopy(definition["arena"]["drives"])
        for key, sha in definition["maps"].items():
            manifest["maps"][key]["fingerprint"] = sha
        self.assertIsNone(pub.canonical_mismatch(run, manifest, definition))
        suite = manifest["suite"]
        for target, key, value, error in [
            (suite, "set", "challenges", "arena set must be all"),
            (suite, "drives", {}, "authored drive definitions differ"),
            (run, "results", run["results"][:-1], "complete drive set"),
            (manifest["maps"]["kitsilano"], "fingerprint", "a" * 16, "map fingerprints differ"),
        ]:
            with self.subTest(key=key), patch.dict(target, {key: value}):
                self.assertIn(error, pub.canonical_mismatch(run, manifest, definition))

    def test_arena_pack_and_version_are_checked_against_manifest(self):
        run = pub.read_json(ARENA)
        first = run["results"][0]
        with patch.dict(first, pack="wrong"), self.assertRaisesRegex(ValueError, "arena pack version disagrees"):
            pub.checked_manifest(ARENA, run, "2026-11-21")
        drive = run["manifest"]["suite"]["drives"][first["challenge"]]
        run["manifest"]["format"] = pub.MANIFEST_FORMAT
        run["suite_version"] = run["manifest"]["suite_version"] = "custom"
        for row in run["results"]:
            row["suite_version"] = "custom"
        with patch.dict(drive, version=0), self.assertRaisesRegex(ValueError, "invalid challenge version"):
            pub.checked_manifest(ARENA, run, "2026-11-21")
        run["suite_version"] = "legacy"
        for row in run["results"]:
            row["suite_version"] = "legacy"
        with self.assertRaisesRegex(ValueError, "manifest version 2 requires"):
            pub.checked_manifest(ARENA, run, "2026-11-21")

    def test_engine_fingerprint_errors_distinguish_timeout_failure_and_bad_output(self):
        from subprocess import CalledProcessError, CompletedProcess, TimeoutExpired

        for result, error in [
            (FileNotFoundError(), "Node 22 is required"),
            (TimeoutExpired("node", 30), "Node timed out"),
            (CalledProcessError(1, "node", stderr="TypeError: invalid input"), "TypeError: invalid input"),
            (CompletedProcess("node", 0, stdout="bad\n"), "Node returned an invalid benchmark route fingerprint"),
        ]:
            run = (
                patch.object(pub.subprocess, "run", side_effect=result)
                if isinstance(result, Exception)
                else patch.object(pub.subprocess, "run", return_value=result)
            )
            with self.subTest(error=error), run, self.assertRaisesRegex(ValueError, error):
                pub.bench_route_fingerprint([])


class ResultRowsTest(TestCase):
    def test_invalid_metrics_name_the_drive(self):
        base = {"id": "route", "pass": True}
        for key, value in [
            ("time_s", -1),
            ("cost_usd", False),
            ("collisions", 1.5),
            ("fallbacks", -1),
            ("hard_brakes", 2**53),
            ("safety_brakes", False),
            ("flagged_choices", -1),
            ("decisions", False),
            ("model_decisions", -1),
            ("local_decisions", "2"),
            ("fallback_decisions", -1),
            ("model_share", 2),
            ("local_share", -0.1),
            ("fallback_share", "0"),
            ("failures", [""]),
            ("failures", "timeout"),
        ]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, f"route: {key}"):
                pub.check_result_rows([{**base, key: value}], "id")
        with self.assertRaisesRegex(ValueError, "simulation error cannot pass"):
            pub.check_result_rows([{**base, "simulation_error": "throw"}], "id")

    def test_arena_summary_and_drive_diagnostics(self):
        row = {"challenge": "a", "map": "kitsilano", "pass": True}
        summary = {"brain": "rules", "drives": 1, "passed": 1, "cost_usd": 0}
        for report, error in [
            ([], "summary object"),
            ({"summary": {**summary, "brain": " "}, "results": [row]}, "needs a driver ID"),
            ({"summary": {**summary, "track": "wrong"}, "results": [row]}, "invalid track"),
            ({"summary": summary, "results": {}}, "results array"),
            ({"summary": {**summary, "drives": 0}, "results": [row]}, "summary drives"),
            ({"summary": {**summary, "passed": True}, "results": [row]}, "summary passed"),
            ({"summary": {**summary, "cost_usd": -1}, "results": [row]}, "summary cost_usd"),
            ({"summary": summary, "results": [row, row]}, "repeats challenge ID"),
            ({"summary": summary, "results": [{**row, "map": None}]}, "missing arena map"),
            ({"summary": summary, "results": [{**row, "pass": False}]}, "failures must be an array"),
        ]:
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                pub.check_arena_shape(report)

    def test_bench_bad_config_names_the_field(self):
        base = pub.read_json(BENCH)
        for keys, value, error in [
            (("name",), "", "needs a name"),
            (("saved_at",), "", "needs a saved_at"),
            (("config", "brain"), "", "needs a driver"),
            (("config", "map"), "", "needs a map"),
            (("saved_at",), "2026-11-21broken", "must be an ISO date or timestamp"),
            (("stopped",), True, "stopped must be a nonblank stop reason"),
            (("summary", "km"), -1, "summary km must be"),
            (("config", "seed"), True, "config seed must be"),
            (("config", "count"), 0, "config count must be"),
            (("config", "npcs"), -1, "config npcs must be"),
            (("config", "track"), "wrong", "config has an invalid track"),
        ]:
            run = deepcopy(base)
            replace(run, keys, value)
            with self.subTest(keys=keys), self.assertRaisesRegex(ValueError, error):
                pub._check_run_shape(run)

    def test_comparison_inputs_require_objects(self):
        row = {"challenge": "a", "map": "kitsilano", "pass": True, "result_sha": "a" * 16}
        with self.assertRaisesRegex(ValueError, "missing comparison score inputs"):
            pub.published_drive(row, comparison={"result_sha": row["result_sha"], "score_inputs": []})
        with self.assertRaisesRegex(ValueError, "invalid driven-corridor score measurements"):
            pub.published_drive({**row, "comparison_score_inputs": "wrong"})

    def test_verdict_totals_ignore_missing_decision_counts(self):
        shares = pub.shares([{"decisions": 2, "model_share": 0.5, "model_decisions": 1}, {"model_decisions": None}])
        self.assertEqual(shares["model_decisions"], 1)
        self.assertEqual(shares["model_share"], 0.5)


class TapeTest(TestCase):
    def test_reading_bad_tape_names_its_path_and_field(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "tape.json"
            for data, error in [
                ([], "recording must be an object"),
                ({"header": []}, "needs a header object"),
                ({"header": {}, "results": []}, "needs a results object"),
                ({"header": {}, "results": {}, "drives": []}, "needs a drives object"),
                ({"header": {}, "results": {"a": []}, "drives": {}}, "results need drive IDs"),
            ]:
                with self.subTest(data=data), self.assertRaisesRegex(ValueError, f"tape.json: .*{error}"):
                    path.write_text(pub.render(data))
                    pub.recording_facts(path)

    def test_recording_cache_allows_bom_and_invalidates_same_size_replacement(self):
        with TemporaryDirectory() as tmp, patch.dict(pub._FACTS, clear=True):
            path = Path(tmp) / "tape.json"
            path.write_text('{"header":{"driver":"a"},"results":{},"drives":{}}', encoding="utf-8-sig")
            first = pub.recording_facts(path)
            self.assertIs(pub.recording_facts(path), first)
            other = path.with_name("new.json")
            other.write_bytes(path.read_bytes().replace(b'"a"', b'"b"'))
            other.replace(path)
            self.assertEqual(pub.recording_facts(path)["header"]["driver"], "b")
            self.assertEqual(len(pub._FACTS), 1)

    def test_response_diagnostics_point_to_the_call(self):
        for response, error in [
            ([], "response object"),
            ({"meta": []}, "response metadata"),
            ({"meta": {"model": 4}}, "model ID"),
            ({"trace": []}, "trace object"),
            ({"trace": {"response": []}}, "provider response"),
            ({"trace": {"response": {"usage": []}}}, "provider usage object"),
            ({"trace": {"response": {"usage": {"cost": -1}}}}, "usage cost"),
        ]:
            tape = {"drives": {"demo": {"decide": [{"response": response}]}}}
            with (
                self.subTest(response=response),
                self.assertRaisesRegex(ValueError, f"demo.*, decide call 1: .*{error}"),
            ):
                pub.answered_by(tape)
        for drive, error in [
            (3, "invalid recording drive"),
            ({"decide": 3}, "expected a call array"),
            ({"decide": [3]}, "expected an object"),
        ]:
            with self.subTest(drive=drive), self.assertRaisesRegex(ValueError, error):
                pub.answered_by({"drives": {"demo": drive}})

    def test_provider_cost_is_used_only_with_complete_usage(self):
        first = {"meta": {"model": "one"}, "trace": {"response": {"usage": {"cost": 1.25}}}}
        second = {"meta": {"model": "two"}}
        calls = [{"response": first}, {"response": second}, {"response": first}, {"response": None}]
        tape = {"drives": {"drive": {"questions": calls}}}
        self.assertEqual(pub.answered_by(tape), (["one", "two"], None, 3))
        calls.pop(1)
        self.assertEqual(pub.answered_by(tape), (["one"], 2.5, 2))

    def test_benchmark_tape_reports_the_changed_field(self):
        run = pub.read_json(REPLAY)
        recording = pub.recording_facts(pub.RECORDINGS / f"{REPLAY.stem}.json.gz")
        drive = run["results"][0]
        with patch.dict(drive, time_s=0), self.assertRaisesRegex(ValueError, f"{drive['id']}: time_s"):
            pub.checked_manifest(REPLAY, run, "2026-11-21", recording)

    def test_bench_result_comparison_ignores_only_volatile_metadata(self):
        result = {
            "wall_ms": 2,
            "model_recording": "a",
            "diagnostics": {},
            "suite_version": "v1",
            "report": {"started_at": "earlier", "time_s": 3},
            "pass": False,
        }
        self.assertEqual(pub.comparable_bench_result(result), {"report": {"time_s": 3}, "pass": False})
        self.assertEqual(result["report"]["started_at"], "earlier")


class OutputFilesTest(TestCase):
    def test_both_outputs_are_staged_before_replacing_either(self):
        with TemporaryDirectory() as tmp:
            first = Path(tmp) / "results.json"
            first.write_text("old")
            missing = Path(tmp) / "missing" / "README.md"
            with self.assertRaises(OSError):
                pub.write_publication(((first, "new"), (missing, "new")))
            self.assertEqual(first.read_text(), "old")
            self.assertEqual(list(Path(tmp).iterdir()), [first])

    def test_write_has_explicit_utf8_and_keeps_file_mode(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "results.json"
            path.touch(mode=0o640)
            pub.write_publication(((path, "é\n"),))
            self.assertEqual(path.read_bytes(), "é\n".encode())
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_readme_replace_preserves_crlf_and_literal_replacement_text(self):
        start, end = pub.START, pub.END
        original = f"top\r\n{start}\r\nold\r\n{end}\r\nend\r\n"
        self.assertEqual(pub.readme_with(original, "a\\1\nb"), f"top\r\n{start}\r\na\\1\r\nb\r\n{end}\r\nend\r\n")
