import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from http.client import IncompleteRead
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError

import helpers  # noqa: F401

from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm import fetch
from jev.osm.cache import read_layer, write_bytes, write_json
from jev.osm.crossings import crossings_path, load_crossings
from jev.osm.pack import build_pack, pack_path
from jev.osm.parse import parse_xml
from jev.osm.restrictions import load_restrictions, restrictions_path
from scripts import fetch_map, migrate_packs

BBOX = PRESET_BBOXES["kitsilano"]
OSM = b"""<?xml version="1.0"?>
<osm version="0.6">
  <node id="1" lat="49.264" lon="-123.166"/>
  <node id="2" lat="49.266" lon="-123.164"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
</osm>
"""


class OsmDownloadTests(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.maps = Path(work.name)

    def test_fallback_rejects_partial_and_wrong_documents(self):
        responses = [
            IncompleteRead(b"<osm>"),
            b'<?xml version="1.0"?><html/>',
            b'<?xml version="1.0"?><osm><node/>',
            b'<?xml version="1.0" encoding="cp932"?><osm/>',
            b"<osm><remark>Query timed out</remark></osm>",
            b"<osm><error>API reported an error</error></osm>",
            b'<osm><node id="1"/></osm>',
            b'<osm><node id="1" lat="nan" lon="0"/></osm>',
            OSM,
        ]
        http = Mock(side_effect=responses)
        path = fetch.fetch_osm_xml(BBOX, self.maps, http=http, sleep=lambda _delay: None)
        self.assertEqual(path.read_bytes(), OSM)
        self.assertEqual(http.call_count, len(responses))

    def test_invalid_tags_do_not_replace_an_existing_raw_cache(self):
        path = fetch.cache_path(self.maps, BBOX)
        path.write_bytes(OSM)
        invalid = b'<osm><way id="10"><tag v="x"/></way></osm>'
        http = Mock(return_value=invalid)
        with self.assertRaisesRegex(fetch.FetchError, "Invalid OSM records"):
            fetch.fetch_osm_xml(BBOX, self.maps, force=True, http=http, sleep=lambda _delay: None)
        self.assertEqual(path.read_bytes(), OSM)

    def test_corrupt_raw_cache_is_replaced(self):
        path = fetch.cache_path(self.maps, BBOX)
        path.write_bytes(b"<osm>")
        http = Mock(return_value=OSM)
        self.assertEqual(fetch.fetch_osm_xml(BBOX, self.maps, http=http), path)
        http.assert_called_once()
        self.assertEqual(path.read_bytes(), OSM)

    def test_failed_refresh_leaves_previous_raw_cache(self):
        path = fetch.cache_path(self.maps, BBOX)
        path.write_bytes(OSM)
        with self.assertRaisesRegex(fetch.FetchError, "expected valid OSM"):
            fetch.fetch_osm_xml(
                BBOX,
                self.maps,
                force=True,
                http=Mock(return_value=b"<osm><remark>expected valid OSM</remark></osm>"),
                sleep=lambda _delay: None,
            )
        self.assertEqual(path.read_bytes(), OSM)

    def test_pack_recovers_from_partial_json_using_raw_cache(self):
        fetch.cache_path(self.maps, BBOX).write_bytes(OSM)
        path = pack_path(self.maps, BBOX)
        path.write_text('{"edges":')
        pack = build_pack(BBOX, self.maps)
        self.assertEqual(len(pack["edges"]), 2)
        self.assertEqual(len(json.loads(path.read_text())["edges"]), 2)

    def test_failed_publication_keeps_existing_cache(self):
        path = fetch.cache_path(self.maps, BBOX)
        path.write_bytes(OSM)
        with patch.object(Path, "replace", side_effect=PermissionError("publish failed")):
            with self.assertRaisesRegex(PermissionError, "publish failed"):
                write_bytes(path, b"<osm/>")
        self.assertEqual(path.read_bytes(), OSM)
        self.assertEqual(list(self.maps.iterdir()), [path])

    def test_offline_missing_cache_performs_no_io_or_retries(self):
        http, sleep = Mock(), Mock()
        missing = self.maps / "does-not-exist"
        with self.assertRaisesRegex(fetch.FetchError, "No cached OSM file"):
            fetch.fetch_osm_xml(BBOX, missing, http=http, sleep=sleep, offline=True)
        http.assert_not_called()
        sleep.assert_not_called()
        self.assertFalse(missing.exists())

    def test_offline_invalid_cache_is_reported_without_download(self):
        path = fetch.cache_path(self.maps, BBOX)
        path.write_bytes(b"<html/>")
        http = Mock()
        with self.assertRaisesRegex(fetch.FetchError, path.name + ".*OSM XML"):
            fetch.fetch_osm_xml(BBOX, self.maps, offline=True, http=http)
        http.assert_not_called()
        self.assertEqual(path.read_bytes(), b"<html/>")

    def test_offline_cache_works_outside_download_area_limit(self):
        bbox = (-125.0, 49.0, -123.0, 50.0)
        path = fetch.cache_path(self.maps, bbox)
        path.write_bytes(OSM)
        http = Mock()
        self.assertEqual(fetch.fetch_osm_xml(bbox, self.maps, offline=True, http=http), path)
        http.assert_not_called()

    def test_invalid_download_bounds_are_reported_before_contacting_osm(self):
        http = Mock()
        for bbox in ((-123, 49, -124, 50), (-123, 49, -123, 50), (-123, 49, -122, 91), (0, 0, 1, float("nan"))):
            with self.subTest(bbox=bbox), self.assertRaisesRegex(fetch.FetchError, "positive width and height"):
                fetch.fetch_osm_xml(bbox, self.maps, http=http)
        http.assert_not_called()

    def test_invalid_download_timeouts_are_reported_before_contacting_osm(self):
        http = Mock()
        for timeout in (0, -1, float("inf"), float("nan")):
            with self.subTest(timeout=timeout), self.assertRaisesRegex(fetch.FetchError, "timeout"):
                fetch.fetch_osm_xml(BBOX, self.maps, timeout=timeout, http=http)
        http.assert_not_called()

    def test_permanent_http_error_moves_to_overpass_without_backoff(self):
        http = Mock(side_effect=[HTTPError("http://unused", 400, "bbox too large for main API", {}, None), OSM])
        sleep = Mock()
        fetch.fetch_osm_xml(BBOX, self.maps, http=http, sleep=sleep)
        self.assertIsNone(http.call_args_list[0].args[1])
        self.assertIn(b"data=", http.call_args_list[1].args[1])
        self.assertEqual(http.call_args_list[1].args[0], fetch.OVERPASS_URLS[0])
        sleep.assert_not_called()

    def test_exhausted_sources_report_last_provider(self):
        http = Mock(side_effect=OSError("connection closed"))
        sleep = Mock()
        with self.assertRaisesRegex(fetch.FetchError, "overpass.kumi.systems: connection closed"):
            fetch.fetch_osm_xml(BBOX, self.maps, http=http, sleep=sleep)
        self.assertEqual(http.call_count, 9)
        self.assertEqual(sleep.call_count, 6)
        self.assertFalse(fetch.cache_path(self.maps, BBOX).exists())

    def test_versioned_but_incomplete_pack_recovers_from_raw(self):
        fetch.cache_path(self.maps, BBOX).write_bytes(OSM)
        path = pack_path(self.maps, BBOX)
        path.write_text('{"pack_version":"6"}')
        log = Mock()
        pack = build_pack(BBOX, self.maps, log=log)
        self.assertEqual(len(pack["lanes"]), 2)
        self.assertIn("complete v6 pack", log.call_args_list[0].args[0])

    def test_misplaced_pack_is_rebuilt_for_the_requested_bbox(self):
        raw = fetch.cache_path(self.maps, BBOX)
        raw.write_bytes(OSM)
        pack = build_pack(BBOX, self.maps)
        path = pack_path(self.maps, BBOX)
        write_json(path, {**pack, "bbox": list(PRESET_BBOXES["ottawa"])})
        self.assertEqual(build_pack(BBOX, self.maps)["bbox"], list(BBOX))

    def test_empty_extract_does_not_replace_a_drivable_pack(self):
        raw = fetch.cache_path(self.maps, BBOX)
        raw.write_bytes(OSM)
        build_pack(BBOX, self.maps)
        path = pack_path(self.maps, BBOX)
        original = path.read_bytes()
        raw.write_bytes(b"<osm/>")
        with self.assertRaisesRegex(fetch.FetchError, "no connected drivable streets"):
            build_pack(BBOX, self.maps, force=True)
        self.assertEqual(path.read_bytes(), original)

    def test_write_without_replace_protects_existing_artifact(self):
        target = self.maps / "map.json"
        target.write_text("existing")
        with self.assertRaises(FileExistsError):
            write_json(target, {"replacement": True}, replace=False)
        self.assertEqual(target.read_text(), "existing")
        self.assertEqual(list(self.maps.iterdir()), [target])


class RawOsmParsingTests(unittest.TestCase):
    def test_unicode_xml_string_with_bom_is_parsed_as_xml(self):
        self.assertIn(1, parse_xml("\ufeff" + OSM.decode()).nodes)

    def test_xml_diagnostics_identify_record_and_attribute(self):
        fixtures = (
            ('<node id="8" lat="49.0"/>', "node '8'.*missing 'lon'"),
            ('<way id="8"><nd ref="bad"/></way>', "way '8'.*invalid 'ref'"),
            ('<node id="bad" lon="0" lat="0"/>', "node 'bad'.*invalid 'id'"),
            ('<way id="8"><tag k="highway"/></way>', "way '8'.*missing 'v'"),
            ('<node id="8" lat="91" lon="0"/>', "node '8'.*latitude"),
            ('<node id="8" lat="0" lon="-181"/>', "node '8'.*longitude"),
            (
                '<relation id="8"><tag k="type" v="restriction"/><member type="area" ref="1"/></relation>',
                "relation '8'.*unsupported member type",
            ),
        )
        for element, diagnostic in fixtures:
            with self.subTest(element=element), self.assertRaisesRegex(ValueError, diagnostic):
                parse_xml(f"<osm>{element}</osm>")

    def test_relation_validation_only_processes_consumed_relation_types(self):
        raw = '<osm><relation id="bad"><tag k="type" v="boundary"/><member type="area"/></relation></osm>'
        self.assertEqual(parse_xml(raw).relations, [])

    def test_relation_members_preserve_order_and_empty_roles(self):
        raw = """<osm><relation id="2"><tag k="type" v="restriction"/>
            <member type="way" ref="3" role="from"/><member type="node" ref="7"/>
            <member type="way" ref="1" role="to"/>
        </relation></osm>"""
        self.assertEqual(
            parse_xml(raw).relations[0]["members"], [("way", 3, "from"), ("node", 7, ""), ("way", 1, "to")]
        )

    def test_partial_extract_preserves_external_way_references(self):
        data = parse_xml('<osm><way id="-3"><nd ref="9"/><nd ref="8"/></way></osm>')
        self.assertEqual(data.ways, [{"id": -3, "nodes": [9, 8], "tags": {}}])

    def test_raw_osm_with_error_notice_cannot_be_built_directly(self):
        with self.assertRaisesRegex(ValueError, "OSM reported an error: Too many requests"):
            parse_xml("<osm><remark>Too <b>many</b> requests</remark></osm>")


class LayerCacheTests(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.maps = Path(work.name)

    def test_invalid_layer_json_is_a_diagnostic_cache_miss(self):
        path = self.maps / "sample.v1.json"
        for content, reason in (
            (b"\xff", "decode"),
            (b"{", "property name"),
            (b"[]", "sample object"),
            (b'{"sample_version":"2","records":[]}', "v1 sample"),
            (b'{"sample_version":"1"}', "records must be an array"),
            (b'{"sample_version":"1","records":[1]}', "array of objects"),
        ):
            with self.subTest(content=content):
                path.write_bytes(content)
                messages = []
                self.assertIsNone(read_layer(path, "sample", "1", ("records",), messages.append))
                self.assertIn(path.name, messages[0])
                self.assertIn(reason, messages[0])

    def test_crossings_fall_back_to_v1_if_v2_is_damaged(self):
        current = crossings_path(self.maps, BBOX)
        legacy = crossings_path(self.maps, BBOX, "1")
        valid = {"crossings_version": "1", "crossings": []}
        current.write_text('{"crossings_version":"2","crossings":null}')
        write_json(legacy, valid)
        log = Mock()
        self.assertEqual(load_crossings(BBOX, self.maps, log=log), valid)
        self.assertIn(current.name, log.call_args.args[0])

    def test_legacy_restrictions_keep_optional_red_turns_absent(self):
        path = restrictions_path(self.maps, BBOX)
        legacy = {"restrictions_version": "1", "restrictions": [], "skipped": []}
        write_json(path, legacy)
        self.assertEqual(load_restrictions(BBOX, self.maps), legacy)
        write_json(path, {**legacy, "red_turns": None})
        self.assertIsNone(load_restrictions(BBOX, self.maps))

    def test_damaged_raw_input_skips_optional_layer_with_diagnostic(self):
        path = fetch.cache_path(self.maps, BBOX)
        path.write_bytes(b"<osm><node/></osm>")
        messages = []
        self.assertIsNone(fetch.read_cached_osm(BBOX, self.maps, messages.append))
        self.assertIn(path.name, messages[0])
        self.assertIn("missing 'lat'", messages[0])


class FetchMapCliTests(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.maps = Path(work.name)

    def command(self, *args: str) -> int:
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return fetch_map.main(["fetch_map.py", "--maps-dir", str(self.maps), *args])

    def test_invalid_arguments_exit_before_import(self):
        with patch.object(fetch_map, "build_pack") as pack:
            for args in (("kitsilano", "--zone"), ("ottawa", "edmonton"), ("-123,49,oops,50",)):
                with self.subTest(args=args), self.assertRaises(SystemExit) as err:
                    self.command(*args)
                self.assertEqual(err.exception.code, 2)
            pack.assert_not_called()

    def test_full_import_handles_negative_bbox_and_builds_restrictions(self):
        fetch.cache_path(self.maps, BBOX).write_bytes(OSM)
        self.assertEqual(self.command(",".join(str(coord) for coord in BBOX)), 0)
        self.assertTrue(pack_path(self.maps, BBOX).is_file())
        self.assertEqual(len(list(self.maps.glob("*.json"))), 1 + len(fetch_map.LAYERS))
        self.assertEqual(len(list(self.maps.glob("*.restrictions.*.json"))), 1)

    def test_full_cached_preset_reports_existing_files_offline(self):
        with patch.object(fetch, "fetch_osm_xml", side_effect=AssertionError("unexpected download")):
            with patch("jev.osm.cache.write_bytes", side_effect=AssertionError("unexpected cache write")):
                for name, bbox in PRESET_BBOXES.items():
                    with self.subTest(preset=name), redirect_stdout(io.StringIO()) as output:
                        self.assertEqual(fetch_map.main(["fetch_map.py", name]), 0)
                        self.assertIn("pack: %s" % pack_path(MAPS_DIR, bbox), output.getvalue())
                        self.assertIn("crosswalks)", output.getvalue())
                        self.assertIn("red-turn bans)", output.getvalue())

    def test_layer_flags_are_additive_and_force_is_limited_to_selection(self):
        fetch.cache_path(self.maps, BBOX).write_bytes(OSM)
        original = json.dumps(build_pack(BBOX, self.maps))
        path = pack_path(self.maps, BBOX)
        path.write_text(original)
        self.assertEqual(self.command("kitsilano", "--force", "--calming", "--zones", "--buslanes"), 0)
        self.assertEqual(path.read_text(), original)
        filenames = {entry.name.split(".")[1] for entry in self.maps.glob("*.json")}
        self.assertEqual(filenames, {"v6", "calming", "scrambles", "zones", "buslanes"})

    def test_refresh_downloads_once_and_rebuilds_existing_pack(self):
        path = pack_path(self.maps, BBOX)
        path.write_text("{}")
        raw_path = fetch.cache_path(self.maps, BBOX)

        def load(_bbox, _maps_dir, force=False, **_kwargs):
            if force:
                raw_path.write_bytes(OSM)
            return raw_path

        with patch.object(fetch, "fetch_osm_xml", side_effect=load) as download:
            self.assertEqual(self.command("kitsilano", "--refresh-osm"), 0)
        self.assertEqual(sum(call.kwargs.get("force", False) for call in download.call_args_list), 1)
        self.assertEqual(len(json.loads(path.read_text())["edges"]), 2)

    def test_full_import_repairs_raw_cache_needed_by_missing_layers(self):
        raw_path = fetch.cache_path(self.maps, BBOX)
        raw_path.write_bytes(OSM)
        build_pack(BBOX, self.maps)
        for invalid in (b"<osm>", None):
            with self.subTest(invalid=invalid):
                if invalid is None:
                    raw_path.unlink()
                else:
                    raw_path.write_bytes(invalid)
                for path in self.maps.glob("*.restrictions.*.json"):
                    path.unlink()
                http = Mock(return_value=OSM)
                download = fetch.fetch_osm_xml
                with patch.object(fetch, "fetch_osm_xml", side_effect=lambda *a, **kw: download(*a, **kw, http=http)):
                    self.assertEqual(self.command("kitsilano"), 0)
                http.assert_called_once()
                self.assertEqual(raw_path.read_bytes(), OSM)
                self.assertEqual(len(list(self.maps.glob("*.restrictions.*.json"))), 1)

    def test_recovering_a_pack_rebuilds_existing_layers_even_with_layer_flags(self):
        fetch.cache_path(self.maps, BBOX).write_bytes(OSM)
        self.assertEqual(self.command("kitsilano"), 0)
        restrictions = next(self.maps.glob("*.restrictions.*.json"))
        for options in ((), ("--calming",)):
            with self.subTest(options=options):
                restrictions.write_text('{"restrictions":[{"edge":"obsolete"}]}')
                pack_path(self.maps, BBOX).write_text("{")
                self.assertEqual(self.command("kitsilano", *options), 0)
                self.assertEqual(json.loads(restrictions.read_text())["restrictions"], [])

    def test_import_retries_layers_after_a_failed_write(self):
        fetch.cache_path(self.maps, BBOX).write_bytes(OSM)
        self.assertEqual(self.command("kitsilano"), 0)
        restrictions = next(self.maps.glob("*.restrictions.*.json"))
        restrictions.write_text('{"restrictions_version":"1","restrictions":[{"edge":"obsolete"}]}')
        pack_path(self.maps, BBOX).write_text("{")
        with patch("jev.osm.bus_lanes.write_json", side_effect=OSError("disk full")):
            self.assertEqual(self.command("kitsilano", "--calming"), 1)
        self.assertEqual(json.loads(restrictions.read_text())["restrictions"][0]["edge"], "obsolete")
        self.assertEqual(self.command("kitsilano"), 0)
        self.assertEqual(json.loads(restrictions.read_text())["restrictions"], [])
        self.assertFalse(list(self.maps.glob("*.layers-pending")))

    def test_transit_composes_with_other_layers_and_refreshes_once(self):
        fetch.cache_path(self.maps, BBOX).write_bytes(OSM)
        build_pack(BBOX, self.maps)
        with patch.object(fetch, "fetch_osm_xml", return_value=fetch.cache_path(self.maps, BBOX)) as download:
            self.assertEqual(self.command("kitsilano", "--transit", "--parks"), 0)
        download.assert_called_once_with(BBOX, self.maps, force=True, offline=False, log=print)
        filenames = {entry.name.split(".")[1] for entry in self.maps.glob("*.json")}
        self.assertEqual(filenames, {"v6", "transit", "crossings", "zones", "rail", "parks"})

    def test_local_xml_builds_every_layer_without_replacing_raw_cache(self):
        extract = self.maps / "explicit.osm"
        extract.write_bytes(OSM)
        raw = fetch.cache_path(self.maps, BBOX)
        raw.write_bytes(b"original raw cache")
        with (
            patch.object(fetch, "fetch_osm_xml") as download,
            patch.object(fetch, "read_xml", wraps=fetch.read_xml) as read,
        ):
            self.assertEqual(self.command("kitsilano", "--osm-file", str(extract)), 0)
        download.assert_not_called()
        read.assert_called_once_with(extract)
        self.assertEqual(raw.read_bytes(), b"original raw cache")
        self.assertEqual(len(list(self.maps.glob("*.json"))), 1 + len(fetch_map.LAYERS))

    def test_local_layer_only_import_preserves_prepared_pack(self):
        extract = self.maps / "explicit.osm"
        extract.write_bytes(OSM)
        self.assertEqual(self.command("kitsilano", "--osm-file", str(extract)), 0)
        original = pack_path(self.maps, BBOX).read_bytes()
        layer = crossings_path(self.maps, BBOX)
        layer.unlink()
        self.assertEqual(self.command("kitsilano", "--crossings", "--osm-file", str(extract)), 0)
        self.assertEqual(pack_path(self.maps, BBOX).read_bytes(), original)
        self.assertTrue(layer.is_file())

    def test_offline_transit_and_restrictions_use_raw_cache(self):
        fetch.cache_path(self.maps, BBOX).write_bytes(OSM)
        with patch.object(fetch, "fetch_osm_xml", wraps=fetch.fetch_osm_xml) as download:
            self.assertEqual(self.command("kitsilano", "--offline", "--transit", "--restrictions"), 0)
        download.assert_called_once_with(BBOX, self.maps, force=False, offline=True, log=print)

    def test_offline_forced_refresh_flag_is_rejected_before_io(self):
        with patch.object(fetch, "fetch_osm_xml") as download:
            for args in (("--offline",), ("--osm-file", "not-there.osm")):
                with self.subTest(args=args), self.assertRaises(SystemExit) as err:
                    self.command("kitsilano", "--refresh-osm", *args)
                self.assertEqual(err.exception.code, 2)
        download.assert_not_called()

    def test_invalid_explicit_source_preserves_pack_and_layers(self):
        raw = fetch.cache_path(self.maps, BBOX)
        raw.write_bytes(OSM)
        self.assertEqual(self.command("kitsilano", "--offline"), 0)
        before = {p.name: p.read_bytes() for p in self.maps.iterdir()}
        extract = self.maps / "explicit.osm"
        extract.write_bytes(b"<html/>")
        self.assertEqual(self.command("kitsilano", "--osm-file", str(extract)), 1)
        self.assertEqual({p.name: p.read_bytes() for p in self.maps.iterdir() if p != extract}, before)

    def test_regular_offline_import_repairs_corrupt_non_optional_layer(self):
        raw = fetch.cache_path(self.maps, BBOX)
        raw.write_bytes(OSM)
        self.assertEqual(self.command("kitsilano", "--offline"), 0)
        path = restrictions_path(self.maps, BBOX)
        expected = path.read_bytes()
        path.write_text('{"restrictions_version":"1","restrictions":[7]}')
        self.assertEqual(self.command("kitsilano", "--offline"), 0)
        self.assertEqual(path.read_bytes(), expected)


class PackMigrationTests(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.maps = Path(work.name)
        self.source = self.maps / "a.v5.pack.json"
        self.target = self.maps / "a.v6.pack.json"
        self.source.write_text(json.dumps({"pack_version": "5", "edges": [], "intersections": [], "stops": []}))

    def command(self, *args: str) -> int:
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return migrate_packs.main(["migrate_packs.py", "--maps-dir", str(self.maps), *args])

    def test_preview_and_migration_keep_v6_destination(self):
        self.assertEqual(self.command("--check"), 0)
        self.assertTrue(self.source.exists())
        self.assertFalse(self.target.exists())
        self.assertEqual(self.command(), 0)
        self.assertFalse(self.source.exists())
        self.assertEqual(json.loads(self.target.read_text())["pack_version"], "6")

    def test_conflicting_destination_preserves_every_source(self):
        source = self.maps / "z.v5.pack.json"
        source.write_bytes(self.source.read_bytes())
        target = self.maps / "z.v6.pack.json"
        target.write_text("existing pack")
        self.assertEqual(self.command(), 1)
        self.assertTrue(self.source.exists())
        self.assertTrue(source.exists())
        self.assertFalse(self.target.exists())
        self.assertEqual(target.read_text(), "existing pack")

    def test_wrong_source_version_is_rejected(self):
        self.source.write_text('{"pack_version":"6"}')
        self.assertEqual(self.command(), 1)
        self.assertTrue(self.source.exists())
        self.assertFalse(self.target.exists())

    def test_keep_source_preserves_legacy_input_bytes(self):
        original = self.source.read_bytes()
        self.assertEqual(self.command("--keep-source"), 0)
        self.assertEqual(self.source.read_bytes(), original)
        self.assertTrue(self.target.is_file())

    def test_separate_output_is_created_only_when_publishing(self):
        output = self.maps / "out"
        self.assertEqual(self.command("--check", "--output-dir", str(output)), 0)
        self.assertFalse(output.exists())
        self.assertEqual(self.command("--output-dir", str(output)), 0)
        self.assertTrue((output / self.target.name).is_file())
        self.assertTrue(self.source.is_file())
        self.assertFalse(self.target.exists())

    def test_migration_changes_only_the_final_version_suffix(self):
        source = self.maps / "a.v5.pack.json.archived.v5.pack.json"
        source.write_bytes(self.source.read_bytes())
        self.assertEqual(self.command("--keep-source"), 0)
        self.assertTrue((self.maps / "a.v5.pack.json.archived.v6.pack.json").is_file())

    def test_malformed_source_diagnostic_names_the_file(self):
        self.source.write_text('{"pack_version":"5","edges":[{"to":"only"}]}')
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(migrate_packs.main(["migrate_packs.py", "--maps-dir", str(self.maps)]), 1)
        self.assertIn(self.source.name, errors.getvalue())

    def test_second_publication_failure_preserves_every_original(self):
        source = self.maps / "z.v5.pack.json"
        source.write_bytes(self.source.read_bytes())

        def publish(path, data, **kwargs):
            if path.name.startswith("z."):
                raise OSError("disk full")
            write_json(path, data, **kwargs)

        with patch.object(migrate_packs, "write_json", side_effect=publish):
            self.assertEqual(self.command(), 1)
        self.assertTrue(self.source.is_file())
        self.assertTrue(source.is_file())
        self.assertFalse(self.target.exists())
        self.assertEqual(self.command(), 0)
