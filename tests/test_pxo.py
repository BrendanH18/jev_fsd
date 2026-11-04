"""Ontario PXO tags and the versioned layer migration, without network access."""
import json
import tempfile
import unittest
from pathlib import Path
import helpers  # noqa: F401
from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.osm.crossings import is_pxo, load_crossings, crossings_path
from jev.osm.fetch import cache_key


class PxoTests(unittest.TestCase):
    def test_explicit_and_conservative_beacon_tags(self):
        origin = {"lat": 43.665, "lon": -79.403}
        base = {"highway": "crossing", "crossing": "uncontrolled"}
        self.assertTrue(is_pxo(dict(base, crossing_ref="pxo:Type_A"), origin))
        self.assertTrue(is_pxo(dict(base, crossing_ref="pxo"), {"lat": 45.414, "lon": -75.7}))
        self.assertFalse(is_pxo(base, origin))
        beacon = dict(base, **{"crossing:signed": "yes", "crossing:signals": "no", "flashing_lights": "button"})
        self.assertTrue(is_pxo(beacon, origin))
        self.assertFalse(is_pxo(dict(beacon, **{"crossing:signals": "yes"}), origin))
        self.assertFalse(is_pxo(dict(base, crossing_ref="pxo"), {"lat": 49.27, "lon": -123.1}))

    def test_legacy_layers_still_load_and_v2_takes_precedence(self):
        bbox = PRESET_BBOXES["toronto"]
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / (cache_key(bbox) + ".crossings.v1.json")).write_text('{"crossings_version":"1"}')
            self.assertEqual(load_crossings(bbox, root)["crossings_version"], "1")
            crossings_path(root, bbox).write_text('{"crossings_version":"2"}')
            self.assertEqual(load_crossings(bbox, root)["crossings_version"], "2")

    def test_bundled_pxo_additions_preserve_every_legacy_crossing(self):
        ids = []
        for name in ("toronto", "ottawa"):
            bbox = PRESET_BBOXES[name]
            old = json.loads((MAPS_DIR / (cache_key(bbox) + ".crossings.v1.json")).read_text())
            layer = load_crossings(bbox, MAPS_DIR)
            self.assertEqual(layer["crossings_version"], "2")
            self.assertEqual([c for c in layer["crossings"] if not c.get("pxo")], old["crossings"])
            ids.extend(c["id"] for c in layer["crossings"] if c.get("pxo"))
        self.assertEqual(sorted(ids), ["x2317854682", "x5606060531", "x67344971"])
