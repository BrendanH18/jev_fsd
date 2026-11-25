import hashlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

import helpers  # noqa: F401

from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm.audit import Artifact, References, audit_map, check_layer, check_pack
from jev.osm.audit_schema import Array, LAYER_SCHEMAS, NullableArray, Object, PACK_SCHEMA
from jev.osm.cache import decode_json, write_json
from jev.osm.fetch import cache_key
from jev.osm.pack import pack_path
from scripts import fetch_map

BBOX = PRESET_BBOXES["kitsilano"]
KEY = cache_key(BBOX)


class MapSchemasTest(unittest.TestCase):
    def test_every_shipped_schema_accepts_bundled_records_and_rejects_bad_shapes(self):
        covered = set()
        for filename in sorted(MAPS_DIR.glob("*.json")):
            kind = "pack" if filename.name.endswith(".pack.json") else filename.name.split(".")[1]
            schema = PACK_SCHEMA if kind == "pack" else LAYER_SCHEMAS.get(kind)
            if schema is None:
                continue
            self.exercise_schema(schema, decode_json(filename.read_bytes()), kind, covered)
        # These branches are produced by explicitly tagged or less common imports.
        optional_examples = (
            ("calming", "devices", {"crossing": True}),
            ("transit", "routes", {"colour": "#d50000"}),
            ("restrictions", "restrictions", {"suppressed_conditions": [{"days": [0], "start": 420, "end": 540}]}),
            ("restrictions", "skipped", {"value": "PH"}),
        )
        for kind, field, values in optional_examples:
            rule = (LAYER_SCHEMAS[kind].required | LAYER_SCHEMAS[kind].optional)[field].item
            for key, value in values.items():
                self.exercise_schema(rule.optional[key], value, f"{kind}.{field}[].{key}", covered)

    def exercise_schema(self, rule, value, path, covered):
        if path not in covered:
            with self.subTest(path=path):
                self.assertEqual(list(rule.check(value, path)), [])
                # Unsupported object values must always have a field-specific diagnostic.
                self.assertEqual(
                    [issue.path for issue in rule.check(False if not isinstance(value, bool) else {}, path)], [path]
                )
            covered.add(path)
        if isinstance(rule, Object):
            for name, child in (rule.required | rule.optional).items():
                if name in value:
                    self.exercise_schema(child, value[name], f"{path}.{name}", covered)
        elif isinstance(rule, Array):
            for item in value:
                self.exercise_schema(rule.item, item, f"{path}[]", covered)
        elif isinstance(rule, NullableArray) and value is not None:
            self.exercise_schema(rule.array, value, path, covered)


class AuditTest(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.maps = Path(work.name)
        self.pack = decode_json(pack_path(MAPS_DIR, BBOX).read_bytes())

    def layer(self, name, version, data):
        path = self.maps / f"{KEY}.{name}.v{version}.json"
        write_json(path, {f"{name}_version": version, "name": KEY, **data})
        return path

    def command(self, *args, maps_dir=None):
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()) as err:
            try:
                code = fetch_map.main(["fetch_map.py", "--maps-dir", str(maps_dir or self.maps), *args])
            except SystemExit as exit_error:
                code = exit_error.code
        return code, out.getvalue(), err.getvalue()

    def test_bundled_audit_is_read_only_and_passes(self):
        with (
            patch("jev.osm.fetch.fetch_osm_xml", side_effect=AssertionError("network")),
            patch("jev.osm.fetch.read_xml", side_effect=AssertionError("raw OSM")),
            patch("jev.osm.cache.write_bytes", side_effect=AssertionError("write")),
        ):
            code, output, errors = self.command("--audit", "--all", "--json", maps_dir=MAPS_DIR)
        self.assertEqual(errors, "")
        self.assertEqual(code, 0, output[:4000])
        data = json.loads(output)
        self.assertTrue(data["ok"])
        self.assertEqual({m["area"] for m in data["maps"]}, set(PRESET_BBOXES))
        item = next(m for m in data["maps"] if m["area"] == "kitsilano")["artifacts"][0]
        raw = pack_path(MAPS_DIR, BBOX).read_bytes()
        self.assertEqual(item["bytes"], len(raw))
        self.assertEqual(item["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(item["counts"]["edges"], len(self.pack["edges"]))

    def test_missing_rail_and_explicit_rail_requirement(self):
        write_json(pack_path(self.maps, BBOX), self.pack)
        options = {"include_layers": {"rail"}}
        audit = audit_map("sample", BBOX, self.maps, **options)
        self.assertTrue(audit.ok)
        self.assertEqual(audit.artifacts[-1].status, "omitted")
        audit = audit_map("sample", BBOX, self.maps, require_rail=True, **options)
        self.assertFalse(audit.ok)
        self.assertEqual(audit.artifacts[-1].status, "missing")

    def test_bad_preferred_crossing_still_reports_usable_fallback(self):
        write_json(pack_path(self.maps, BBOX), self.pack)
        bad = self.layer("crossings", "2", {"crossings": [{}]})
        good = self.layer("crossings", "1", {"crossings": []})
        audit = audit_map("sample", BBOX, self.maps, include_layers={"crossings"})
        self.assertFalse(audit.ok)
        preferred, fallback = audit.artifacts[1:]
        self.assertEqual(preferred.file, bad.name)
        self.assertFalse(preferred.selected)
        self.assertEqual(fallback.file, good.name)
        self.assertTrue(fallback.selected)
        self.assertIn("$.crossings[0].edge", {issue.path for issue in preferred.issues})

    def test_shadowed_crossing_file_is_still_audited(self):
        write_json(pack_path(self.maps, BBOX), self.pack)
        self.layer("crossings", "2", {"crossings": []})
        self.layer("crossings", "1", {"crossings": None})
        audit = audit_map("sample", BBOX, self.maps, include_layers={"crossings"})
        self.assertTrue(audit.artifacts[1].selected)
        self.assertEqual(audit.artifacts[2].status, "invalid")

    def test_missing_pack_does_not_prevent_diagnosing_broken_layer(self):
        self.layer("crossings", "1", {"crossings": False})
        audit = audit_map("sample", BBOX, self.maps, include_layers={"crossings"})
        self.assertEqual([a.status for a in audit.artifacts], ["missing", "invalid"])

    def test_pending_marker_is_flagged_and_preserved(self):
        path = pack_path(self.maps, BBOX)
        write_json(path, self.pack)
        pending = path.with_suffix(".layers-pending")
        pending.touch()
        audit = audit_map("sample", BBOX, self.maps, include_layers=set())
        self.assertFalse(audit.ok)
        self.assertEqual(audit.artifacts[-1].file, pending.name)
        self.assertTrue(pending.exists())

    def test_compare_detects_changed_bytes_even_with_same_json(self):
        reference = self.maps / "reference"
        reference.mkdir()
        path = pack_path(self.maps, BBOX)
        write_json(path, self.pack)
        layer = self.layer("crossings", "1", {"crossings": []})
        (reference / layer.name).write_bytes(layer.read_bytes())
        pack_path(reference, BBOX).write_bytes(path.read_bytes())
        args = ("kitsilano", "--audit", "--json", "--crossings", "--against", str(reference))
        self.assertEqual(self.command(*args)[0], 0)
        path.write_bytes(path.read_bytes() + b"\n")
        code, output, _ = self.command(*args)
        self.assertEqual(code, 1)
        self.assertEqual(
            json.loads(output)["maps"][0]["differences"],
            [{"path": path.name, "message": "bytes differ from reference"}],
        )
        self.layer("crossings", "2", {"crossings": []})
        layer.unlink()
        _, output, _ = self.command(*args)
        self.assertEqual(
            {r["message"] for r in json.loads(output)["maps"][0]["differences"]},
            {"bytes differ from reference", "only in map directory", "only in reference directory"},
        )

    def test_audit_flags_reject_ambiguous_requests(self):
        for args in (
            ("--all",),
            ("--json",),
            ("--audit", "--force"),
            ("--audit", "--refresh-osm"),
            ("--audit", "--osm-file", "source.osm"),
            ("--audit", "kitsilano", "--all"),
            ("--audit", "--require-rail", "--crossings"),
            ("--audit", "--against", str(self.maps / "missing")),
        ):
            with self.subTest(args=args):
                self.assertEqual(self.command(*args)[0], 2)

    def test_human_report_names_missing_file(self):
        code, output, _ = self.command("kitsilano", "--audit", "--crossings")
        self.assertEqual(code, 1)
        self.assertIn("kitsilano FAIL", output)
        self.assertIn(pack_path(self.maps, BBOX).name, output)
        self.assertIn(f"{KEY}.crossings.v2.json", output)

    def test_pack_and_layer_reference_errors_name_the_record(self):
        edge = self.pack["edges"][0]
        edge["from"] = "absent-node"
        edge["asphalt"].reverse()
        edge["lane_offsets"].append(0)
        self.pack["lanes"][0]["idx"] = 100
        self.pack["intersections"][0]["offset_s"] = 10000
        self.pack["roundabouts"][0]["outer_r"] = 0
        pack_artifact = Artifact("pack", "pack", "ok")
        refs = References(self.pack)
        check_pack(pack_artifact, self.pack, BBOX, refs)
        paths = {issue.path for issue in pack_artifact.issues}
        self.assertTrue(
            {
                "$.edges[0].from",
                "$.edges[0].asphalt",
                "$.edges[0].lane_offsets",
                "$.lanes[0].idx",
                "$.intersections[0].offset_s",
                "$.roundabouts[0]",
            }.issubset(paths),
            paths,
        )
        layer_artifact = Artifact("bridges", "bridges", "ok")
        check_layer(layer_artifact, {"spans": [{"edge": edge["id"], "from": 10001, "to": 10000}]}, refs)
        self.assertEqual({issue.path for issue in layer_artifact.issues}, {"$.spans[0]", "$.spans[0].to"})

    def test_sidecar_checks_reject_valid_shapes_with_broken_links(self):
        edge = self.pack["edges"][0]
        edge_id = edge["id"]
        refs = References(self.pack)
        cases = (
            (
                "buslanes",
                {"lanes": [{"edge": edge_id, "lane": 100, "allowed": ["bicycle"], "hours": None}]},
                "$.lanes[0].lane",
            ),
            (
                "calming",
                {"devices": [{"id": "c1", "kind": "hump", "crossing": True, "at": []}]},
                "$.devices[0].crossing",
            ),
            ("contraflow", {"edges": [{"edge": "absent"}]}, "$.edges[0].edge"),
            (
                "crossings",
                {"crossings_version": "1", "crossings": [{"id": "x1", "pxo": True, "edge": edge_id, "s": 0}]},
                "$.crossings[0].beacons",
            ),
            ("driveways", {"driveways": [{"id": "d1", "edge": edge_id, "s": 10000}]}, "$.driveways[0].s"),
            (
                "parks",
                {"areas": [], "spans": [{"edge": edge_id, "from": 0, "to": 1, "left": "absent", "right": None}]},
                "$.spans[0].left",
            ),
            (
                "rail",
                {"tracks": [], "crossings": [{"id": "lx1", "track": "absent", "edges": []}]},
                "$.crossings[0].track",
            ),
            (
                "restrictions",
                {"restrictions": [{"id": "r1", "from": edge_id, "to": ["absent"]}]},
                "$.restrictions[0].to[0]",
            ),
            ("scrambles", {"scrambles": [{"signal": "absent"}]}, "$.scrambles[0].signal"),
            (
                "transit",
                {
                    "stops": [],
                    "routes": [
                        {
                            "id": "r1",
                            "runs": [
                                {
                                    "edges": [edge_id],
                                    "length": 10,
                                    "stops": [{"id": "s1", "edge": edge_id, "s": 0, "s_run": 0}],
                                }
                            ],
                        }
                    ],
                },
                "$.routes[0].runs[0].stops[0].id",
            ),
            (
                "zones",
                {"zones": [{"id": "z1", "spans": [{"edge": "absent", "from": 0, "to": 1}]}]},
                "$.zones[0].spans[0].edge",
            ),
        )
        for kind, layer, expected in cases:
            with self.subTest(layer=kind):
                artifact = Artifact(kind, kind, "ok")
                check_layer(artifact, layer, refs)
                self.assertEqual(artifact.status, "invalid")
                self.assertIn(expected, {issue.path for issue in artifact.issues})

    def test_dangling_layer_file_is_invalid_even_when_optional(self):
        write_json(pack_path(self.maps, BBOX), self.pack)
        (self.maps / f"{KEY}.rail.v1.json").symlink_to(self.maps / "missing")
        audit = audit_map("sample", BBOX, self.maps, include_layers={"rail"})
        self.assertFalse(audit.ok)
        self.assertEqual(audit.artifacts[-1].status, "invalid")
        self.assertEqual(audit.artifacts[-1].issues[0].path, "$")
