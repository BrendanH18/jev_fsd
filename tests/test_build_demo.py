import contextlib
import gzip
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
            self.assertEqual(len(maps), 12)
            for item in maps:
                self.assertTrue((output / f"demo-data/{item['id']}.json").is_file())
            self.assertTrue((output / "arena.html").is_file())
            # The leaderboard ships with the committed results, and its links stay inside the site.
            results = (output / "results.html").read_text()
            self.assertIn('name="jev-demo"', results)
            self.assertIn('href="./arena.html"', results)
            self.assertIn('href="./results.html"', (output / "arena.html").read_text())
            self.assertNotIn('href="/', results)
            self.assertEqual(json.loads((output / "demo-data/results.json").read_text())["format"], "jev-results/1")
            replay_path = output / "replays/jev-right-on-red.json"
            self.assertEqual(
                replay_path.read_bytes(), (build_demo.ROOT / "static/replays" / replay_path.name).read_bytes()
            )
            self.assertTrue((output / "LICENSE").is_file())
            self.assertEqual(list(output.rglob(".env*")), [])
            self.assertEqual(list(output.rglob("*.py")), [])

    def test_browser_replay_matches_the_committed_challenge_result(self):
        root = build_demo.ROOT
        replay = json.loads((root / "static/replays/jev-right-on-red.json").read_text())
        self.assertEqual(replay["format"], "jev-browser-replay/1")
        with gzip.open(root / replay["source"], "rt") as source:
            recording = json.load(source)
        result = recording["results"][replay["challenge"]]
        frames = replay["frames"]
        self.assertEqual(replay["result_sha"], result["result_sha"])
        self.assertEqual(replay["pass"], result["pass"])
        self.assertEqual(frames[0]["t"], 0)
        self.assertAlmostEqual(frames[-1]["t"], result["time_s"], places=1)
        crossing = next(frame for frame in frames if frame["t"] == 15)
        self.assertEqual(crossing["ego"], {"x": -112.863, "y": 237.441, "psi": 1.52, "speed": 10.058})
        self.assertEqual(crossing["traffic"]["challenge_cross_1"], {"x": -68.933, "y": 247.465, "psi": -0.036})
        self.assertEqual(crossing["lights"], ["red", "green"])
        self.assertEqual(replay["events"][-1]["message"], "Reached the destination")
        self.assertTrue(all(a["t"] < b["t"] for a, b in zip(frames, frames[1:])))
