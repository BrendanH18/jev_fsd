"""Offline coverage for saved snapshots, runs and tapes."""

from __future__ import annotations

import errno
import gzip
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import helpers  # noqa: F401

import server

RUN = {"config": {"brain": "rules"}, "summary": {"passed": 1}, "results": [{"id": "s1-1"}]}
TAPE = {
    "format": server.RECORDING_FORMAT,
    "header": {"driver": "jev"},
    "drives": {"s1-1": {"test": [{"response": {"ok": True}}]}},
    "scenarios": {"s1-1": {"id": "s1-1"}},
    "results": {"s1-1": {"id": "s1-1"}},
}
SNAPSHOT = {
    "state": {},
    "questions": {"motion": {"type": "choice", "criteria": {"drive": None}, "instructions": "Choose the motion"}},
}


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.runs = self.root / "runs"
        self.tapes = self.root / "recordings"
        self.snapshots = self.root / "snapshots"
        self.results = self.root / "results.json"
        self.enterContext(
            patch.multiple(
                server,
                PROJECT_ROOT=self.root,
                RUNS_DIR=self.runs,
                RECORDINGS_DIR=self.tapes,
                SNAPSHOTS_DIR=self.snapshots,
                RESULTS_FILE=self.results,
            )
        )
        server._artifact_metadata.cache_clear()
        self.addCleanup(server._artifact_metadata.cache_clear)

    def write(self, directory, name, payload):
        directory.mkdir(exist_ok=True)
        path = directory / name
        data = json.dumps(payload).encode()
        path.write_bytes(gzip.compress(data) if name.endswith(".gz") else data)
        return path

    def test_snapshot_name_is_text(self):
        with self.assertRaisesRegex(server.BadRequest, "snapshot name"):
            server.api_snapshot_save(dict(SNAPSHOT, name=["test"]), {})
        self.assertFalse(self.snapshots.exists())

    def test_run_brain_label_is_text(self):
        with self.assertRaisesRegex(server.BadRequest, "config.brain"):
            server.api_bench_save(dict(RUN, config={"brain": ["test"]}), {})
        self.assertFalse(self.runs.exists())

    def test_recording_driver_label_is_text(self):
        with self.assertRaisesRegex(server.BadRequest, "driver must be text"):
            server.api_recording_save(dict(TAPE, header={"driver": 17}), {})
        self.assertFalse(self.tapes.exists())

    def test_run_save_uses_read_limit_before_publication(self):
        with (
            patch.object(server, "MAX_RUN_BYTES", 20),
            self.assertRaisesRegex(server.BadRequest, "size limit"),
        ):
            server.api_bench_save(RUN, {})
        self.assertFalse(self.runs.exists())

    def test_recording_save_uses_decoded_read_limit_before_publication(self):
        with (
            patch.object(server, "MAX_ARCHIVE_BYTES", 20),
            self.assertRaisesRegex(server.BadRequest, "size limit"),
        ):
            server.api_recording_save(TAPE, {})
        self.assertFalse(self.tapes.exists())

    def test_save_limit_counts_bytes_and_allows_exact_boundary(self):
        path = self.root / "file.json"
        text = '{"name": "vélo"}'
        limit = len(text.encode("utf-8"))
        with self.assertRaisesRegex(server.BadRequest, "size limit"):
            server._save_artifact(path, lambda _: text, limit - 1)
        self.assertFalse(path.exists())
        self.assertEqual(server._save_artifact(path, lambda _: text, limit), path)

    def test_invalid_numeric_payloads_are_never_saved_by_direct_calls(self):
        for save, template, key, value in (
            (server.api_bench_save, RUN, "summary", {"time": float("nan")}),
            (server.api_snapshot_save, SNAPSHOT, "expect", {"score": float("inf")}),
            (server.api_recording_save, TAPE, "results", {"s1-1": {"cost": float("-inf")}}),
        ):
            with self.subTest(save=save.__name__):
                with self.assertRaisesRegex(server.BadRequest, "valid UTF-8 JSON"):
                    save(dict(template, **{key: value}), {})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_snapshot_preserves_valid_unicode_and_actual_sanitized_name(self):
        saved = server.api_snapshot_save(dict(SNAPSHOT, name="Arrêt / tour", expect={"note": "vélo"}), {})
        path = self.root / saved["saved"]
        data = json.loads(path.read_bytes())
        self.assertEqual((data["name"], data["expect"]), ("Arrêttour", {"note": "vélo"}))

    def test_snapshot_uses_default_name_after_all_punctuation_is_removed(self):
        saved = server.api_snapshot_save(dict(SNAPSHOT, name=" /!? "), {})
        data = json.loads((self.root / saved["saved"]).read_bytes())
        self.assertEqual(data["name"], "snapshot")

    def test_snapshots_and_runs_store_normalized_recorded_fields_only(self):
        saved = server.api_snapshot_save(dict(SNAPSHOT, transient=True), {})
        data = json.loads((self.root / saved["saved"]).read_bytes())
        self.assertEqual(set(data), {"name", "saved_at", "state", "questions", "expect"})
        run = server.api_bench_save(dict(RUN, transient=True), {})
        data = json.loads((self.root / run["saved"]).read_bytes())
        self.assertEqual(set(data), {"name", "saved_at", "config", "summary", "results"})

    def test_run_publication_leaves_an_owner_only_file(self):
        saved = server.api_bench_save(RUN, {})
        self.assertEqual(stat.S_IMODE((self.root / saved["saved"]).stat().st_mode), 0o600)

    def test_run_roundtrip_keeps_original_configuration_and_result_order(self):
        run = dict(RUN, config={"brain": "rules", "options": {"weather": "snow"}}, results=[{"id": 2}, {"id": 1}])
        saved = server.api_bench_save(run, {})
        loaded = server.api_bench_runs({}, {"name": [saved["name"]]})
        self.assertEqual(loaded["config"], run["config"])
        self.assertEqual(loaded["results"], run["results"])

    def test_recording_requires_outcome_objects(self):
        malformed = dict(TAPE, drives={"s1-1": {"k": [None]}})
        with self.assertRaisesRegex(server.BadRequest, "outcome objects"):
            server.api_recording_save(malformed, {})
        self.assertFalse(self.tapes.exists())

    def test_recording_requires_scenario_objects_on_save_and_read(self):
        malformed = dict(TAPE, scenarios={"s1-1": []})
        with self.assertRaisesRegex(server.BadRequest, "scenario must be an object"):
            server.api_recording_save(malformed, {})
        self.write(self.tapes, "bad.json", malformed)
        self.assertEqual(server.api_recordings({}, {}), {"recordings": []})
        with self.assertRaisesRegex(server.BadRequest, "could not be read"):
            server.api_recordings({}, {"name": ["bad"]})

    def test_recording_import_rejects_disagreeing_suite_versions(self):
        malformed = dict(TAPE, header={"driver": "jev", "suite_version": "custom"})
        self.write(self.tapes, "bad.json", malformed)
        self.assertEqual(server.api_recordings({}, {}), {"recordings": []})

    def test_recording_import_rejects_non_object_result_container(self):
        self.write(self.tapes, "bad.json", dict(TAPE, results=[]))
        self.assertEqual(server.api_recordings({}, {}), {"recordings": []})

    def test_recording_import_skips_plain_tape_with_primitives_in_outcomes(self):
        self.write(self.tapes, "trip.json", dict(TAPE, drives={"s1-1": {"k": ["timeout"]}}))
        self.write(self.tapes, "trip.json.gz", TAPE)
        self.assertEqual(server.api_recordings({}, {"name": ["trip"]}), TAPE)
        self.assertEqual(len(server.api_recordings({}, {})["recordings"]), 1)

    def test_recording_import_validates_manifest_even_without_results(self):
        bad = dict(TAPE, results={}, header={"driver": "jev", "manifest": {"format": "jev-run-manifest/2"}})
        self.write(self.tapes, "bad.json", bad)
        with self.assertRaisesRegex(server.BadRequest, "could not be read"):
            server.api_recordings({}, {"name": ["bad"]})

    def test_recording_preserves_layout_and_non_ascii_values(self):
        tape = dict(TAPE, header={"driver": "jev", "note": "route d’essai"})
        saved = server.api_recording_save(tape, {})
        raw = (self.root / saved["saved"]).read_text(encoding="utf-8")
        self.assertIn("route d’essai", raw)
        self.assertIn('\n   "test": [{"response":{"ok":true}}]\n', raw)
        self.assertEqual(json.loads(raw), tape)

    def test_recording_header_rejects_unsupported_declared_suite(self):
        for value in (None, "future", "v0", "v01", 1):
            with self.subTest(value=value), self.assertRaisesRegex(server.BadRequest, "suite_version"):
                server.api_recording_save(dict(TAPE, header={"driver": "jev", "suite_version": value}), {})

    def test_recording_can_omit_optional_scenarios_and_results(self):
        supplied = {key: value for key, value in TAPE.items() if key not in ("results", "scenarios")}
        saved = server.api_recording_save(supplied, {})
        actual = server.api_recordings({}, {"name": [saved["name"]]})
        self.assertEqual(actual, dict(supplied, results={}, scenarios={}))

    def test_versionless_legacy_recording_exposes_only_its_actual_header(self):
        self.write(self.tapes, "legacy.json", TAPE)
        item = server.api_recordings({}, {})["recordings"][0]
        self.assertEqual(item["header"], {"driver": "jev"})

    def test_explicit_legacy_suite_without_manifest_is_supported(self):
        tape = dict(TAPE, header={"driver": "jev", "suite_version": "legacy"}, results={})
        saved = server.api_recording_save(tape, {})
        self.assertEqual(server.api_recordings({}, {"name": [saved["name"]]}), tape)

    def test_recording_header_exactly_at_serialized_limit_is_usable(self):
        limit = len(json.dumps(TAPE["header"]))
        with patch.object(server, "MAX_RECORDING_HEADER_BYTES", limit):
            saved = server.api_recording_save(TAPE, {})
            self.assertEqual(server.api_recordings({}, {"name": [saved["name"]]}), TAPE)

    def test_gzip_members_can_share_one_recording_document(self):
        self.tapes.mkdir()
        data = json.dumps(TAPE).encode()
        first = gzip.compress(data[:24])
        other = gzip.compress(data[24:])
        (self.tapes / "joined.json.gz").write_bytes(first + other)
        self.assertEqual(server.api_recordings({}, {"name": ["joined"]}), TAPE)

    def test_full_recording_at_decoded_archive_limit_can_be_listed(self):
        path = self.write(self.tapes, "limit.json.gz", TAPE)
        size = len(gzip.decompress(path.read_bytes()))
        with patch.object(server, "MAX_ARCHIVE_BYTES", size):
            self.assertEqual(server.api_recordings({}, {})["recordings"][0]["name"], "limit")

    def test_complete_run_at_read_limit_is_accessible(self):
        path = self.write(self.runs, "limit.json", RUN)
        with patch.object(server, "MAX_RUN_BYTES", path.stat().st_size):
            self.assertEqual(server.api_bench_runs({}, {"name": ["limit"]}), RUN)

    def test_saved_json_accepts_a_utf8_signature(self):
        self.results.write_bytes(b"\xef\xbb\xbf" + b'{"format":"jev-results/1"}')
        self.assertEqual(server.api_results({}, {})["format"], "jev-results/1")

    def test_saved_json_non_finite_data_is_reported_as_corrupt(self):
        for value in ("NaN", "-Infinity", "1e500"):
            with self.subTest(value=value):
                self.results.write_text('{"v":' + value + "}", encoding="utf-8")
                with self.assertRaisesRegex(server.BadRequest, "unreadable"):
                    server.api_results({}, {})

    def test_saved_json_refuses_duplicate_keys(self):
        self.results.write_bytes(b'{"format":"one","format":"two"}')
        with self.assertRaisesRegex(server.BadRequest, "unreadable"):
            server.api_results({}, {})

    def test_corrupt_run_skips_invalid_numeric_summary(self):
        self.write(self.runs, "broken.json", dict(RUN, summary={"seconds": float("nan")}))
        self.write(self.runs, "valid.json", RUN)
        self.assertEqual([item["name"] for item in server.api_bench_runs({}, {})["runs"]], ["valid"])

    def test_run_listing_and_lookup_require_valid_replay_containers(self):
        for field, value in (("summary", None), ("results", {}), ("config", ["test"]), ("results", [False])):
            with self.subTest(field=field, value=value):
                path = self.write(self.runs, "bad.json", dict(RUN, **{field: value}))
                with self.assertRaisesRegex(server.BadRequest, "could not be read"):
                    server.api_bench_runs({}, {"name": ["bad"]})
                self.assertEqual(server.api_bench_runs({}, {}), {"runs": []})
                path.unlink()

    def test_invalid_run_names_never_appear_in_catalogue(self):
        self.write(self.runs, "mismatched artifact.json", RUN)
        self.write(self.runs, ".hidden.json", RUN)
        self.write(self.runs, "mappable.json", RUN)
        self.assertEqual([item["name"] for item in server.api_bench_runs({}, {})["runs"]], ["mappable"])

    def test_rejects_names_beyond_filename_limit_in_utf8(self):
        for lookup in (server.api_bench_runs, server.api_recordings):
            with self.subTest(lookup=lookup.__name__), self.assertRaisesRegex(server.BadRequest, "Invalid"):
                lookup({}, {"name": ["é" * 128]})

    def test_decomposed_accents_are_valid_in_existing_artifact_names(self):
        name = "prévision"
        self.write(self.runs, name + ".json", RUN)
        self.write(self.tapes, name + ".json", TAPE)
        for lookup, key, data in ((server.api_bench_runs, "runs", RUN), (server.api_recordings, "recordings", TAPE)):
            with self.subTest(key=key):
                listed = lookup({}, {})[key]
                self.assertEqual(listed[0]["name"], name)
                self.assertEqual(lookup({}, {"name": [name]}), data)

    def test_repeated_artifact_names_are_unambiguous_client_errors(self):
        for lookup in (server.api_bench_runs, server.api_recordings):
            with self.subTest(lookup=lookup.__name__), self.assertRaisesRegex(server.BadRequest, "one artifact name"):
                lookup({}, {"name": ["one", "another"]})

    def test_maximum_length_plain_tape_name_can_be_loaded_with_extension(self):
        name = "t" * (server.MAX_ARTIFACT_FILENAME_BYTES - len(".json"))
        self.write(self.tapes, name + ".json", TAPE)
        self.assertEqual(server.api_recordings({}, {"name": [name + ".json"]}), TAPE)

    def test_listing_limit_counts_valid_runs_and_preserves_order(self):
        self.write(self.runs, "a.json", RUN)
        self.write(self.runs, "b.json", RUN)
        self.write(self.runs, "c.json", {"invalid": True})
        listed = server.api_bench_runs({}, {"limit": ["1"]})
        self.assertEqual([item["name"] for item in listed["runs"]], ["b"])

    def test_listing_limit_counts_unique_tapes(self):
        for name in ("a.json", "b.json", "c.json", "c.json.gz"):
            self.write(self.tapes, name, TAPE)
        listed = server.api_recordings({}, {"limit": ["2"]})
        self.assertEqual([item["name"] for item in listed["recordings"]], ["c", "b"])

    def test_unfiltered_listing_keeps_the_historical_caps(self):
        for index in range(55):
            name = f"drive-{index:02}.json"
            self.write(self.runs, name, RUN)
            self.write(self.tapes, name, TAPE)
        runs = server.api_bench_runs({}, {})["runs"]
        recordings = server.api_recordings({}, {})["recordings"]
        self.assertEqual((len(runs), len(recordings)), (30, 50))
        self.assertEqual(runs[0]["name"], recordings[0]["name"])
        self.assertEqual((runs[-1]["name"], recordings[-1]["name"]), ("drive-25", "drive-05"))

    def test_exact_lookup_preserves_result_payload_when_listing_filters_are_set(self):
        self.write(self.runs, "full.json", RUN)
        self.write(self.tapes, "full.json", TAPE)
        query = {"name": ["full"], "driver": ["mismatch"], "before": ["older"]}
        self.assertEqual(server.api_bench_runs({}, query), RUN)
        self.assertEqual(server.api_recordings({}, query), TAPE)

    def test_before_cursor_returns_run_page_below_last_seen_name(self):
        for name in ("a.json", "b.json", "c.json"):
            self.write(self.runs, name, RUN)
        listed = server.api_bench_runs({}, {"before": ["c"], "limit": ["1"]})
        self.assertEqual([item["name"] for item in listed["runs"]], ["b"])

    def test_before_cursor_uses_recording_name_without_archive_suffix(self):
        for name in ("a.json", "b.json.gz", "c.json.gz"):
            self.write(self.tapes, name, TAPE)
        listed = server.api_recordings({}, {"before": ["c"], "limit": ["1"]})
        self.assertEqual([item["name"] for item in listed["recordings"]], ["b"])

    def test_run_filters_combine_suite_and_driver_without_changing_the_rows(self):
        self.write(self.runs, "legacy.json", RUN)
        for name, driver in (("first", "rules"), ("second", "jev")):
            data = dict(RUN, config={"brain": driver}, suite_version="v2", results=[{"suite_version": "v2"}])
            self.write(self.runs, name + ".json", data)
        unfiltered = server.api_bench_runs({}, {})["runs"]
        listed = server.api_bench_runs({}, {"driver": ["rules"], "suite_version": ["v2"]})
        self.assertEqual(listed["runs"], [item for item in unfiltered if item["name"] == "first"])
        self.assertEqual(server.api_bench_runs({}, {"suite_version": ["legacy"]})["runs"][0]["name"], "legacy")

    def test_tape_filter_respects_preferred_archive_and_tape_suite(self):
        self.write(self.tapes, "combined.json", TAPE)
        self.write(self.tapes, "combined.json.gz", dict(TAPE, header={"driver": "llm:alt"}))
        self.write(
            self.tapes, "custom.json", dict(TAPE, header={"driver": "jev", "suite_version": "custom"}, results={})
        )
        self.assertEqual(server.api_recordings({}, {"driver": ["llm:alt"]})["recordings"], [])
        listed = server.api_recordings({}, {"suite_version": ["legacy"], "driver": ["jev"]})
        self.assertEqual([item["name"] for item in listed["recordings"]], ["combined"])
        listed = server.api_recordings({}, {"suite_version": ["custom"]})
        self.assertEqual([item["name"] for item in listed["recordings"]], ["custom"])

    def test_filters_reject_repeated_and_invalid_values(self):
        for filter_, values in (
            ("before", ["../bad"]),
            ("driver", ["first", "second"]),
            ("driver", ["line\nbreak"]),
            ("suite_version", ["latest"]),
        ):
            with self.subTest(field=filter_, values=values), self.assertRaisesRegex(server.BadRequest, filter_):
                server.api_bench_runs({}, {filter_: values})

    def test_run_lookup_requires_consistent_imported_suite(self):
        self.write(self.runs, "mixed.json", dict(RUN, suite_version="v3", results=[{"suite_version": "v2"}]))
        with self.assertRaisesRegex(server.BadRequest, "could not be read"):
            server.api_bench_runs({}, {"name": ["mixed"]})
        self.assertEqual(server.api_bench_runs({}, {})["runs"], [])

    def test_listing_limit_rejects_invalid_or_ambiguous_values(self):
        for lookup in (server.api_bench_runs, server.api_recordings):
            for limits in (["0"], ["70"], ["1.5"], ["2", "3"], ["２"]):
                with (
                    self.subTest(lookup=lookup.__name__, limits=limits),
                    self.assertRaisesRegex(server.BadRequest, "limit must be an integer"),
                ):
                    lookup({}, {"limit": limits})

    def test_large_listing_metadata_does_not_make_full_run_unreadable(self):
        data = dict(RUN, summary={"x": "a" * 300})
        self.write(self.runs, "run.json", data)
        with patch.object(server, "MAX_LISTING_METADATA_BYTES", 200):
            self.assertEqual(server.api_bench_runs({}, {}), {"runs": []})
            self.assertEqual(server.api_bench_runs({}, {"name": ["run"]}), data)

    def test_oversized_plain_json_does_not_open_file(self):
        path = self.write(self.runs, "run.json", RUN)
        with patch.object(server, "_read_json_file") as read, patch.object(server, "MAX_RUN_BYTES", 10):
            self.assertIsNone(server._load_saved_object(path, 10))
        read.assert_not_called()

    def test_path_aliases_are_never_read_as_artifacts(self):
        self.write(self.root, "external.json", RUN)
        self.runs.mkdir()
        (self.runs / "run.json").symlink_to(self.root / "external.json")
        self.tapes.mkdir()
        (self.tapes / "tape.json").symlink_to(self.root / "external.json")
        self.assertEqual(server.api_bench_runs({}, {}), {"runs": []})
        self.assertEqual(server.api_recordings({}, {}), {"recordings": []})
        for lookup, name in ((server.api_bench_runs, "run"), (server.api_recordings, "tape")):
            with self.subTest(name=name), self.assertRaisesRegex(server.BadRequest, f"No .* named {name}"):
                lookup({}, {"name": [name]})

    def test_fallback_publication_never_replaces_dangling_symlink(self):
        link = self.root / "out.json"
        link.symlink_to(self.root / "missing.json")
        with patch.object(os, "link", side_effect=OSError(errno.EOPNOTSUPP, "Hard links unavailable")):
            new = server._save_artifact(link, lambda _: "{}")
        self.assertTrue(link.is_symlink())
        self.assertNotEqual(new, link)
        self.assertEqual(new.read_bytes(), b"{}")

    def test_repeated_collisions_fail_without_looping_or_leaving_temporary_files(self):
        path = self.root / "snapshot.json"
        path.write_bytes(b"original")
        with (
            patch.object(server, "MAX_SAVE_ATTEMPTS", 2),
            patch.object(server.secrets, "token_hex", return_value="occupied"),
        ):
            duplicate = self.root / "snapshot-occupied.json"
            duplicate.write_bytes(b"duplicate")
            with self.assertRaisesRegex(server.BadRequest, "unique name"):
                server._save_artifact(path, lambda _: "{}")
        self.assertEqual(path.read_bytes(), b"original")
        self.assertEqual(duplicate.read_bytes(), b"duplicate")
        self.assertEqual(set(self.root.iterdir()), {path, duplicate})

    def test_missing_temporary_path_during_cleanup_needs_no_warning(self):
        with (
            patch.object(server.os, "unlink", side_effect=FileNotFoundError),
            patch.object(server, "log") as log,
        ):
            server._atomic_write_text(self.root / "saved.json", "{}")
        log.assert_not_called()
        self.assertEqual((self.root / "saved.json").read_bytes(), b"{}")

    def test_legacy_lookup_keeps_an_unknown_format_available(self):
        old = {"format": "jev-legacy/0", "example": True}
        self.write(self.tapes, "legacy.json", old)
        self.assertEqual(server.api_recordings({}, {"name": ["legacy"]}), old)
        self.assertEqual(server.api_recordings({}, {}), {"recordings": []})

    def test_manifest_and_results_agree_on_a_saved_custom_recording(self):
        tape = dict(
            TAPE,
            header={"driver": "jev", "suite_version": "custom", "manifest": {"suite_version": "custom"}},
            results={"s1-1": {"suite_version": "custom"}},
        )
        saved = server.api_recording_save(tape, {})
        self.assertEqual(server.api_recordings({}, {"name": [saved["name"]]}), tape)
