import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from http.client import IncompleteRead
from pathlib import Path
from unittest.mock import Mock, patch

import helpers  # noqa: F401

from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm import fetch
from jev.osm.cache import write_bytes
from jev.osm.pack import build_pack, pack_path
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

    def test_transit_composes_with_other_layers_and_refreshes_once(self):
        fetch.cache_path(self.maps, BBOX).write_bytes(OSM)
        build_pack(BBOX, self.maps)
        with patch.object(fetch, "fetch_osm_xml") as download:
            self.assertEqual(self.command("kitsilano", "--transit", "--parks"), 0)
        download.assert_called_once_with(BBOX, self.maps, force=True, log=print)
        filenames = {entry.name.split(".")[1] for entry in self.maps.glob("*.json")}
        self.assertEqual(filenames, {"v6", "transit", "crossings", "zones", "rail", "parks"})


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
