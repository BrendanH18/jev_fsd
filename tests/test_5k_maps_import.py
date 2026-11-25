import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError

import helpers  # noqa: F401

from jev.osm import fetch
from jev.osm.buildings import _height
from jev.osm.cache import decode_json, read_layer, write_json
from jev.osm.graph import lanes_per_direction, parse_maxspeed
from jev.osm.pack import build_pack, pack_path
from jev.osm.parse import parse_xml
from scripts import migrate_packs
from test_map_tools import BBOX, OSM


class ImportIntegrityTest(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.maps = Path(work.name)

    def test_compressed_osm_and_truncation(self):
        source = self.maps / "extract.osm.gz"
        raw = gzip.compress(OSM)
        source.write_bytes(raw)
        self.assertEqual(fetch.read_xml(source).ways, parse_xml(OSM).ways)
        source.write_bytes(raw[:-4])
        with self.assertRaisesRegex(fetch.FetchError, "extract.osm.gz"):
            fetch.read_xml(source)

    def test_raw_tag_keys_and_conflicts(self):
        start = '<osm><way id="1">'
        end = "</way></osm>"
        valid = '<tag k="highway" v="residential"/>'
        same = parse_xml(start + valid + valid + end)
        self.assertEqual(same.ways[0]["tags"], {"highway": "residential"})
        for tag, reason in (
            ('<tag k="highway" v="primary"/>', "conflicting values for tag 'highway'"),
            ('<tag k=" " v="abc"/>', "tag key must not be empty"),
        ):
            with self.subTest(tag=tag), self.assertRaisesRegex(ValueError, reason):
                parse_xml(start + valid + tag + end)

    def test_duplicate_nodes_may_repeat_but_cannot_conflict(self):
        node = '<node id="1" lat="12" lon="23"/>'
        data = parse_xml(f"<osm>{node}{node}</osm>")
        self.assertEqual(len(data.nodes), 1)
        with self.assertRaisesRegex(ValueError, "same node ID"):
            parse_xml(f'<osm>{node}<node id="1" lat="13" lon="23"/></osm>')

    def test_unrepresentable_osm_numeric_tags(self):
        huge = "9" * 5000
        rng = Mock()
        self.assertEqual(_height({"height": huge, "building:levels": "3"}, rng), 3 * 3.2)
        self.assertEqual(_height({"height": "1", "building:levels": huge}, rng), 2.5)
        rng.uniform.assert_not_called()
        self.assertEqual(_height({"building:levels": huge}, rng), rng.uniform.return_value)
        self.assertEqual(parse_maxspeed(huge, "residential"), 11.2)
        self.assertEqual(parse_maxspeed("0", "residential"), 11.2)
        self.assertEqual(lanes_per_direction({"lanes": huge}, False), (1, 1))
        self.assertEqual(lanes_per_direction({"lanes": "9" * 500}, False), (3, 3))

    def test_artifact_decoder_rejects_ambiguous_object_and_nonfinite_numbers(self):
        for raw in (b'{"nested":{"k":1,"k":2}}', b'{"a":NaN}', b'{"a":Infinity}', b'{"a":1e999}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                decode_json(raw)
        self.assertEqual(decode_json(b'{"x":1.2e2,"p":[1,2]}'), {"x": 120.0, "p": [1, 2]})

    def test_writer_leaves_existing_file_when_serialization_fails(self):
        path = self.maps / "example.json"
        path.write_bytes(b"original")
        with self.assertRaises(ValueError):
            write_json(path, {"bad": float("inf")})
        self.assertEqual(path.read_bytes(), b"original")

    def test_cache_layer_rejects_copy_from_another_extract(self):
        path = self.maps / "expected.example.v1.json"
        write_json(path, {"example_version": "1", "name": "other", "records": []})
        log = Mock()
        self.assertIsNone(read_layer(path, "example", "1", ("records",), log))
        self.assertIn("different extract", log.call_args.args[0])

    def test_pack_cache_rebuilds_damaged_coordinates_and_records(self):
        source = parse_xml(OSM)
        original = build_pack(BBOX, self.maps, load_osm=lambda: source)
        for overrides in (
            {"edges": [4]},
            {"roundabouts": None},
            {"yields": [None]},
            {"extent": []},
            {"extent": [0, 0, -1, -1]},
            {"origin": {"lat": "49", "lon": -123}},
            {"bbox": [-123.2, 95, -123.1, 96]},
        ):
            with self.subTest(overrides=overrides):
                write_json(pack_path(self.maps, BBOX), {**original, **overrides})
                loader = Mock(return_value=source)
                rebuilt = build_pack(BBOX, self.maps, load_osm=loader)
                loader.assert_called_once()
                self.assertEqual(rebuilt["edges"], original["edges"])

    def test_download_retries_only_mirrors_for_permanent_http_failure(self):
        http = Mock(side_effect=[HTTPError("example", 413, "too large", None, None), OSM])
        sleep = Mock()
        path = fetch.fetch_osm_xml(BBOX, self.maps, http=http, sleep=sleep)
        self.assertEqual(path.read_bytes(), OSM)
        self.assertEqual(http.call_count, 2)
        sleep.assert_not_called()

    def test_download_reports_each_source_and_deduplicates_errors(self):
        failure = HTTPError("example", 503, "unavailable", None, None)
        with self.assertRaises(fetch.FetchError) as err:
            fetch.fetch_osm_xml(BBOX, self.maps, http=Mock(side_effect=failure), sleep=Mock())
        message = str(err.exception)
        for source in ("osm main api", "overpass overpass-api.de", "overpass overpass.kumi.systems"):
            self.assertEqual(message.count(f"{source}: HTTP 503"), 1)

    def test_download_reports_unusable_cache_directory(self):
        path = self.maps / "not-a-directory"
        path.write_text("file")
        with self.assertRaisesRegex(fetch.FetchError, "OSM cache directory"):
            fetch.fetch_osm_xml(BBOX, path, http=Mock())

    def test_migration_rejects_duplicate_edge_ids_before_mutating(self):
        pack = {"pack_version": "5", "edges": [{"id": "e1"}, {"id": "e1"}]}
        before = json.dumps(pack)
        with self.assertRaisesRegex(ValueError, "duplicate source edge"):
            migrate_packs.migrate(pack)
        self.assertEqual(json.dumps(pack), before)

    def test_migration_reports_nonregular_sources_without_writing(self):
        source = self.maps / "a.v5.pack.json"
        source.mkdir()
        with patch("builtins.print") as output:
            code = migrate_packs.main(["migrate_packs.py", "--maps-dir", str(self.maps)])
        self.assertEqual(code, 1)
        self.assertIn("expected a regular source pack", output.call_args.args[0])
        self.assertFalse((self.maps / "a.v6.pack.json").exists())

    def test_migration_rejects_empty_stem(self):
        source = self.maps / ".v5.pack.json"
        source.write_text("{}")
        with patch("builtins.print") as output:
            code = migrate_packs.main(["migrate_packs.py", "--maps-dir", str(self.maps)])
        self.assertEqual(code, 1)
        self.assertIn("source has no map identifier", output.call_args.args[0])
        self.assertFalse((self.maps / ".v6.pack.json").exists())

    def test_migration_rolls_back_output_on_serialization_failure(self):
        payload = '{"pack_version":"5","edges":[],"intersections":[],"stops":[]}'
        for name in ("a.v5.pack.json", "b.v5.pack.json"):
            (self.maps / name).write_text(payload)

        def publish(path, data, **kwargs):
            if path.name.startswith("b."):
                raise ValueError("invalid JSON number")
            write_json(path, data, **kwargs)

        with patch.object(migrate_packs, "write_json", side_effect=publish), patch("builtins.print"):
            self.assertEqual(migrate_packs.main(["migrate_packs.py", "--maps-dir", str(self.maps)]), 1)
        self.assertEqual(sorted(p.name for p in self.maps.iterdir()), ["a.v5.pack.json", "b.v5.pack.json"])
