import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_demo


class BrowserDemoBuildTests(unittest.TestCase):
    def test_rejects_source_and_ancestor_outputs_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = (Path(directory) / "project").resolve()
            root.mkdir()
            outputs = [root, root.parent, root / "static", root / "static/js", root / "static/css/generated"]
            with patch.object(build_demo, "ROOT", root):
                for output in outputs:
                    with self.subTest(output=output):
                        with self.assertRaises(ValueError):
                            build_demo.build(output)
                        self.assertEqual(list(root.rglob("*")), [])

    def test_builds_a_standalone_site_with_bundled_maps(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            with contextlib.redirect_stdout(io.StringIO()):
                build_demo.build(output)
            self.assertIn('name="jev-demo"', (output / "index.html").read_text())
            maps = json.loads((output / "demo-data/catalog.json").read_text())
            self.assertEqual(len(maps), 8)
            for item in maps:
                self.assertTrue((output / f"demo-data/{item['id']}.json").is_file())
            self.assertTrue((output / "arena.html").is_file())
            self.assertTrue((output / "LICENSE").is_file())
            self.assertEqual(list(output.rglob(".env*")), [])
            self.assertEqual(list(output.rglob("*.py")), [])
