import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts import build_demo


class DemoArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(temp.cleanup)
        cls.output = Path(temp.name) / "site"
        with contextlib.redirect_stdout(io.StringIO()):
            build_demo.build(cls.output)

    def rejects_change(self, name, transform, message):
        path = self.output / name
        original = path.read_text(encoding="utf-8")
        try:
            path.write_text(transform(original), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, message):
                build_demo.verify(self.output)
        finally:
            path.write_text(original, encoding="utf-8")

    def test_local_assets_and_navigation(self):
        page = "index.html"
        self.rejects_change(
            page, lambda text: text.replace("./css/app.css", "./css/missing.css"), "missing link target"
        )
        self.rejects_change(page, lambda text: text.replace("./css/app.css", "/css/app.css"), "escapes the demo base")
        self.rejects_change(
            "results.html", lambda text: text.replace("#replay-heading", "#unknown"), "missing link anchor"
        )
        self.rejects_change(page, lambda text: text.replace('name="jev-demo"', 'name="jeV-demo"'), "demo marker")
        self.rejects_change(
            page, lambda text: text.replace("</head>", '<meta name="jev-csrf" content="bad"></head>'), "session token"
        )
        self.rejects_change(
            page, lambda text: text.replace('"three/addons/"', '"different/"'), "missing Three.js aliases"
        )
        self.rejects_change(
            page,
            lambda text: text.replace("./vendor/three/build/", "https://example.invalid/"),
            "remote module",
        )
        self.rejects_change("ATTRIBUTION.txt", lambda _: "", "Missing demo asset")
        unexpected = self.output / ".env.example"
        unexpected.touch()
        try:
            with self.assertRaisesRegex(ValueError, "Unexpected file"):
                build_demo.verify(self.output)
        finally:
            unexpected.unlink()

    def test_catalog_pack_and_leaderboard_validation(self):
        def change(field, value):
            def mutate(text):
                payload = json.loads(text)
                payload[field] = value
                return json.dumps(payload)

            return mutate

        self.rejects_change("demo-data/catalog.json", lambda _: "[]", "catalog differs")
        pack = "demo-data/kitsilano.json"
        self.rejects_change(pack, change("pack_version", "broken"), "pack version")
        self.rejects_change(pack, change("utc_offset", None), "bounds or clock")
        self.rejects_change(pack, change("transit", []), "bundled transit layer")
        self.rejects_change("demo-data/results.json", change("format", "broken"), "unsupported results format")
        self.rejects_change("demo-data/results.json", change("maps", {"new": "Unknown"}), "outside the catalog")
        self.rejects_change("replays/jev-flagger.json", lambda _: "{}", "replay differs from source")

    def test_cli_verification_does_not_rewrite_and_can_list_maps(self):
        cli = [sys.executable, str(build_demo.ROOT / "scripts" / "build_demo.py")]
        listing = subprocess.run([*cli, "--list-maps"], check=True, capture_output=True, text=True)
        self.assertTrue(any(entry["id"] == "kitsilano" for entry in json.loads(listing.stdout)))
        artifact = self.output / "index.html"
        modified = artifact.stat().st_mtime_ns
        subprocess.run([*cli, "--check", "--output", str(self.output)], check=True, capture_output=True)
        self.assertEqual(artifact.stat().st_mtime_ns, modified)

    def test_rejects_project_data_as_a_build_destination(self):
        with self.assertRaisesRegex(ValueError, "separate generated output"):
            build_demo.build(build_demo.ROOT / "data" / "maps")
