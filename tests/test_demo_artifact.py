import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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
        self.rejects_change("demo-data/results.json", lambda _: json.dumps({"format": "jev-results/1"}), "no map list")
        stale = self.output / "replays" / "deleted-from-source.json"
        stale.write_text("{}", encoding="utf-8")
        try:
            with self.assertRaisesRegex(ValueError, "no source: deleted-from-source.json"):
                build_demo.verify(self.output)
        finally:
            stale.unlink()

    def test_cli_verification_does_not_rewrite_and_can_list_maps(self):
        cli = [sys.executable, str(build_demo.ROOT / "scripts" / "build_demo.py")]
        listing = subprocess.run([*cli, "--list-maps"], check=True, capture_output=True, text=True)
        self.assertTrue(any(entry["id"] == "kitsilano" for entry in json.loads(listing.stdout)))
        artifact = self.output / "index.html"
        modified = artifact.stat().st_mtime_ns
        subprocess.run([*cli, "--check", "--output", str(self.output)], check=True, capture_output=True)
        self.assertEqual(artifact.stat().st_mtime_ns, modified)

    def test_rebuild_clears_a_previous_build_and_refuses_other_directories(self):
        with tempfile.TemporaryDirectory() as temp:
            other = Path(temp) / "notes"
            other.mkdir()
            (other / "keep.txt").write_text("mine", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "empty directory or a previous demo build"):
                build_demo.build(other)
            self.assertTrue((other / "keep.txt").is_file())
            site = Path(temp) / "site"
            with contextlib.redirect_stdout(io.StringIO()):
                build_demo.build(site)
                (site / "replays" / "old.json").write_text("{}", encoding="utf-8")
                build_demo.build(site)
            self.assertFalse((site / "replays" / "old.json").exists())
            build_demo.verify(site)
            (site / "notes.txt").write_text("mine", encoding="utf-8")
            link = Path(temp) / "link"
            link.symlink_to(site, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "must not be a symbolic link"):
                build_demo.build(link)
            self.assertTrue((site / "notes.txt").is_file())

    def test_rejects_project_data_as_a_build_destination(self):
        with self.assertRaisesRegex(ValueError, "separate generated output"):
            build_demo.build(build_demo.ROOT / "data" / "maps")


class DemoURLTests(unittest.TestCase):
    def test_rebase_keeps_query_and_fragment_for_navigation(self):
        self.assertEqual(
            build_demo.rebase_url("/results?suite=v1#summary-heading"), "./results.html?suite=v1#summary-heading"
        )
        self.assertEqual(build_demo.rebase_url("/?drive=manual"), "./?drive=manual")
        self.assertEqual(
            build_demo.rebase_url("/replays/jev-flagger.json?version=2"), "./replays/jev-flagger.json?version=2"
        )
        self.assertEqual(build_demo.rebase_url("/assets/social.jpg"), "./assets/social.jpg")
        self.assertEqual(build_demo.rebase_url("//example.invalid/image.png"), "//example.invalid/image.png")

    def test_render_handles_attributed_uppercase_head_and_single_quote_links(self):
        page = build_demo.render_page(
            "<HEAD lang='en'><link href='/css/app.css'></HEAD><a href='/bench#run'>Bench</a>", "index.html", 7
        )
        self.assertIn("<HEAD lang='en'>\n  <meta", page)
        self.assertIn("7 real Canadian neighbourhoods", page)
        self.assertIn("href='./css/app.css'", page)
        self.assertIn("href='./bench.html#run'", page)
        with self.assertRaisesRegex(ValueError, "expected one HTML head"):
            build_demo.render_page("<main>Missing head</main>", "index.html", 7)

    def test_parse_json_errors_include_the_file(self):
        for text, message in (
            ('{"key": 1, "key": 2}', "duplicate JSON key"),
            ('{"key": NaN}', "is not a JSON number"),
            ('{"key": 1e321}', "overflows a JSON number"),
            ("[", "Expecting value"),
        ):
            with self.subTest(text=text[:32]):
                with self.assertRaisesRegex(ValueError, f"pack.json: .*{message}"):
                    build_demo.decode(text, "pack.json")

    def test_asset_url_bounds_and_external_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "index.html"
            page.write_text("ok", encoding="utf-8")
            for url, message in (
                ("./%2e%2e/outside.json", "escapes the demo base"),
                ("./%5Coutside.json", "invalid URL"),
                ("./%00outside.json", "invalid encoded URL"),
                ("https://example.invalid/style.css", "unexpected external"),
                ("//example.invalid/style.css", "unexpected external"),
                ("./subdir/", "points to a directory"),
            ):
                (root / "subdir").mkdir(exist_ok=True)
                with self.subTest(url=url):
                    with self.assertRaisesRegex(ValueError, message):
                        build_demo.local_target(root, page, url, kind="resource")
            self.assertIsNone(build_demo.local_target(root, page, "mailto:test@example.invalid", kind="navigation"))
            self.assertIsNone(build_demo.local_target(root, page, "data:image/png;base64,AA", kind="resource"))
            (root / "empty.css").touch()
            with self.assertRaisesRegex(ValueError, "empty resource target"):
                build_demo.local_target(root, page, "./empty.css", kind="resource")

    def test_module_and_style_dependency_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            js = root / "entry.js"
            css = root / "entry.css"
            for content, error in (
                ("import './missing.js';", "missing link target"),
                ("export { x } from './other.js';", "missing link target"),
                ("import('./lazy.js');", "missing link target"),
                ("import 'three/addons/missing.js';", "missing link target"),
                ("import 'made-up';", "unsupported demo module specifier"),
            ):
                with self.subTest(content=content):
                    js.write_text(content, encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, error):
                        build_demo.verify_code_assets(root, {js.name})
            for content, error in (
                ('@import "missing.css";', "missing link target"),
                ('a { background-image: url("./missing.svg"); }', "missing link target"),
                ('a { background-image: url("https://example.invalid/image.svg"); }', "unexpected external"),
            ):
                with self.subTest(content=content):
                    css.write_text(content, encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, error):
                        build_demo.verify_code_assets(root, {css.name})


class DemoArtifactRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(temporary.cleanup)
        cls.output = Path(temporary.name) / "site"
        with contextlib.redirect_stdout(io.StringIO()):
            build_demo.build(cls.output)

    def mutate(self, name, transform, reason, verify=None):
        path = self.output / name
        before = path.read_bytes()
        try:
            path.write_text(transform(before.decode()), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, reason):
                (verify or build_demo.verify)(self.output)
        finally:
            path.write_bytes(before)

    def test_page_checks(self):
        page = "index.html"

        def insert(markup):
            return lambda text: text.replace("</head>", f"{markup}</head>")

        for transform, reason in (
            (insert('<base href="/">'), "overrides the project path"),
            (insert('<iframe src="./arena.html"></iframe>'), "embeds another document"),
            (insert('<meta http-equiv="refresh" content="0; url=./">'), "redirects"),
            (insert('<meta name="Jev-Csrf" content="local">'), "contains a local Jev session token"),
            (insert('<span id="view"></span>'), "duplicate HTML IDs"),
            (
                insert('<script type="module" src="./js/start.js"></script>'),
                "import map must precede|expected one entry module",
            ),
            (insert('<script type="importmap" src="./js/start.js"></script>'), "import maps must be inline"),
            (insert('<img srcset="./missing.jpg 2x">'), "missing link target"),
            (insert('<video poster="./missing.jpg"></video>'), "missing link target"),
            (insert('<form action="../elsewhere"><button>Go</button></form>'), "escapes the demo base"),
            (insert('<link rel="stylesheet" href="./css/app.css">'), "duplicate stylesheets"),
            (lambda text: text.replace("./js/start.js", "./js/common.js"), "expected one entry module"),
            (lambda text: text.replace('<link rel="stylesheet" href="./css/lab.css">', ""), "required stylesheet"),
            (lambda text: text.replace("jev-version", "other-version"), "demo version must match"),
            (lambda text: text.replace("/assets/social.jpg", "/assets/wrong.jpg"), "published social image URL"),
            (lambda text: text.replace('"imports": {', '"scopes": {}, "imports": {'), "scoped import maps"),
            (lambda text: text.replace("examples/jsm/", "examples/jsm"), "aliases must end in a slash"),
            (
                lambda text: text.replace("build/three.module.js", "build/three.core.js"),
                "unexpected Three.js alias target",
            ),
        ):
            with self.subTest(reason=reason):
                self.mutate(page, transform, reason, build_demo.verify_pages)
        self.mutate(
            "results.html",
            insert('<script type="importmap">{}</script>'),
            "expected no import map",
            build_demo.verify_pages,
        )

    def test_named_navigation_and_import_map_order(self):
        path = self.output / "index.html"
        previous = path.read_text(encoding="utf-8")
        try:
            path.write_text(
                previous.replace("</body>", '<a href="#old">Go</a><a name="old"></a></body>'),
                encoding="utf-8",
            )
            build_demo.verify_pages(self.output)
        finally:
            path.write_text(previous, encoding="utf-8")
        self.mutate(
            "index.html",
            lambda text: text.replace("<head>", '<head>\n<script type="module" src="./js/start.js"></script>'),
            "import map must precede",
            build_demo.verify_pages,
        )

    def test_destination_refuses_files_dependency_roots_and_unexpected_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            regular = root / "file"
            regular.touch()
            with self.assertRaisesRegex(ValueError, "output path must be a directory"):
                build_demo.build(regular)
            with self.assertRaisesRegex(ValueError, "separate generated output"):
                build_demo.build(build_demo.ROOT / ".venv/demo")
            broken = root / "broken"
            broken.mkdir()
            (broken / "index.html").symlink_to(regular)
            with self.assertRaisesRegex(ValueError, "Unexpected file in the demo: index.html"):
                build_demo.verify(broken)
            extra = broken / "extra.js"
            (broken / "index.html").unlink()
            os.link(regular, extra)
            with self.assertRaisesRegex(ValueError, "Unexpected file in the demo: extra.js"):
                build_demo.verify(broken)
            if hasattr(os, "mkfifo"):
                extra.unlink()
                os.mkfifo(extra)
                with self.assertRaisesRegex(ValueError, "Unexpected file in the demo: extra.js"):
                    build_demo.verify(broken)

    def test_existing_corrupt_layer_is_a_packaging_error(self):
        item = {"id": "kitsilano", "bbox": [], "utc_offset": -7}

        def corrupt(_bbox, _directory, *, log):
            log("map: ignoring invalid fixture.json")

        with patch.object(build_demo, "LAYERS", {"zones": corrupt}):
            with self.assertRaisesRegex(ValueError, r"kitsilano: invalid zones source layer: .*fixture.json"):
                build_demo.expected_pack(item, {})

    def test_source_asset_types_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in build_demo.COPY_SUFFIXES:
                (root / "static" / name).mkdir(parents=True, exist_ok=True)
            extra = root / "static/js/unrelated.txt"
            extra.write_text("notes", encoding="utf-8")
            with patch.object(build_demo, "ROOT", root):
                with self.assertRaisesRegex(ValueError, "Unsupported demo asset type"):
                    build_demo.asset_sources()
                extra.rename(extra.with_suffix(".js"))
                extra.symlink_to(extra.with_suffix(".js"))
                with self.assertRaisesRegex(ValueError, "Unexpected file in demo source"):
                    build_demo.asset_sources()

    def test_unexpected_payload_and_modified_asset(self):
        self.mutate("LICENSE", lambda text: text + "\nDifferent", "asset differs from source")
        self.mutate("ATTRIBUTION.txt", lambda text: text + "\nDifferent", "attribution differs")
        self.mutate(".nojekyll", lambda _: "unexpected", "must be empty")
        for name in ("notes.txt", "demo-data/extra.json", "signing.key", "js/module.pyc"):
            extra = self.output / name
            extra.touch()
            try:
                with self.assertRaisesRegex(ValueError, "Unexpected file in the demo"):
                    build_demo.verify(self.output)
            finally:
                extra.unlink()

    def test_pack_diff_precisely_locates_the_changed_field(self):
        def transform(text):
            pack = json.loads(text)
            pack["edges"][0]["length"] *= 2
            return json.dumps(pack)

        self.mutate("demo-data/kitsilano.json", transform, r"pack field edges .*\.edges\[0\]\.length")

    def test_committed_results_must_match_even_when_shape_is_valid(self):
        def transform(text):
            table = json.loads(text)
            table["rows"].pop()
            return json.dumps(table)

        self.mutate("demo-data/results.json", transform, "leaderboard differs from the committed")

    def test_wrong_leaderboard_containers_have_field_specific_errors(self):
        def mutate(fields):
            return lambda text: json.dumps({**json.loads(text), **fields})

        self.mutate("demo-data/results.json", lambda _: "[]", "expected a JSON dict")
        self.mutate("demo-data/results.json", mutate({"drivers": []}), "no drivers object")
        self.mutate("demo-data/results.json", mutate({"rows": [1]}), "invalid rows")

    def test_failed_rebuild_preserves_the_previous_artifact(self):
        previous = (self.output / "index.html").read_bytes()
        with patch.object(build_demo, "verify", side_effect=ValueError("stage broken")):
            with self.assertRaisesRegex(ValueError, "stage broken"):
                build_demo.build(self.output)
        self.assertEqual((self.output / "index.html").read_bytes(), previous)
        self.assertEqual(list(self.output.parent.glob(".jev-demo-*")), [])

    def test_publish_renaming_failure_rolls_back(self):
        original_rename = Path.rename

        def deny_stage(path, target):
            if path.name == "stage":
                raise OSError("staged publish refused")
            return original_rename(path, target)

        previous = (self.output / "index.html").read_bytes()
        with patch.object(Path, "rename", deny_stage):
            with self.assertRaisesRegex(OSError, "staged publish refused"):
                build_demo.build(self.output)
        self.assertEqual((self.output / "index.html").read_bytes(), previous)

    def test_failed_rollback_leaves_a_recoverable_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary) / "site"
            site.mkdir()
            original_rename = Path.rename

            def deny_publish(path, target):
                if path.name in {"stage", "previous"}:
                    raise OSError("publish refused")
                return original_rename(path, target)

            with patch.object(build_demo, "assemble"), patch.object(build_demo, "verify"):
                with patch.object(Path, "rename", deny_publish):
                    with self.assertRaisesRegex(OSError, "previous output is at"):
                        build_demo.build(site)
            self.assertEqual(len(list(site.parent.glob(".jev-demo-*/previous"))), 1)

    def test_catalog_marker_alone_does_not_authorize_replacing_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            (site / "demo-data").mkdir()
            (site / "demo-data/catalog.json").write_text("[]", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "previous demo build"):
                build_demo.build(site)
            self.assertTrue((site / "demo-data/catalog.json").is_file())

    def test_report_counts_files_without_modifying_output(self):
        version = self.output / "index.html"
        before = version.stat().st_mtime_ns
        report = build_demo.report(self.output)
        files = [path for path in self.output.rglob("*") if path.is_file()]
        self.assertEqual(report["format"], "jev-demo-report/1")
        self.assertEqual(report["version"], build_demo.VERSION)
        self.assertEqual(report["files"], len(files))
        self.assertEqual(report["total_bytes"], sum(path.stat().st_size for path in files))
        self.assertEqual(
            report["leaderboard_sha256"],
            hashlib.sha256((self.output / "demo-data/results.json").read_bytes()).hexdigest(),
        )
        self.assertIn("jev-right-on-red", report["replays"])
        self.assertEqual(len(report["maps"]), 12)
        self.assertEqual(report["largest_files"][0]["bytes"], max(path.stat().st_size for path in files))
        self.assertEqual(version.stat().st_mtime_ns, before)


if __name__ == "__main__":
    unittest.main()
