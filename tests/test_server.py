import http.client
from concurrent.futures import ThreadPoolExecutor
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class StaticServerTests(unittest.TestCase):
    def setUp(self):
        tmp = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(tmp).resolve()
        self.static = self.root / "static"
        self.static.mkdir()
        (self.static / "nested").mkdir()
        (self.static / "nested" / "app.js").write_text("export const ready = true;")
        (self.static / "asset.unknown-type").write_bytes(b"asset")
        for page in server.PAGES.values():
            file = self.static / page
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(
                '<html><head><script type="importmap">{}</script></head><body>Home</body></html>'
            )
        private = self.root / "static-private"
        private.mkdir()
        (private / "secret.txt").write_text("private fixture")
        (self.root / ".env").write_text("private fixture")
        (self.static / "outside.txt").symlink_to(private / "secret.txt")
        (self.static / "outside-dir").symlink_to(private, target_is_directory=True)
        (self.static / "inside.js").symlink_to(self.static / "nested" / "app.js")
        self.enterContext(patch.object(server, "STATIC", self.static))

        class QuietHandler(server.Handler):
            def log_message(self, _fmt, *_args):
                pass

        self.httpd = server.LocalServer(("127.0.0.1", 0), QuietHandler)
        self.addCleanup(self.httpd.server_close)
        QuietHandler.port = self.httpd.server_port
        thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.httpd.shutdown)

    def get(self, path):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=2)
        try:
            connection.request("GET", path)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_static_assets_and_internal_symlinks_are_served(self):
        for path in ("/nested/app.js", "/inside.js", "/nested/../nested/app.js"):
            with self.subTest(path=path):
                status, headers, body = self.get(path)
                self.assertEqual(status, 200)
                self.assertEqual(body, b"export const ready = true;")
                self.assertIn("javascript", headers["Content-Type"])
                self.assertTrue(headers["Content-Type"].endswith("; charset=utf-8"))
                self.assertEqual(int(headers["Content-Length"]), len(body))

    def test_cold_module_download_burst_serves_every_asset(self):
        with ThreadPoolExecutor(max_workers=32) as pool:
            responses = list(pool.map(self.get, ["/nested/app.js"] * 64))
        for status, headers, body in responses:
            self.assertEqual(status, 200)
            self.assertEqual(body, b"export const ready = true;")
            self.assertEqual(int(headers["Content-Length"]), len(body))

    def test_traversal_and_external_symlinks_are_not_served(self):
        for path in (
            "/../static-private/secret.txt",
            "/nested/../../static-private/secret.txt",
            "/../.env",
            "/outside.txt",
            "/outside-dir/secret.txt",
            "/missing.txt",
            "/nested",
        ):
            with self.subTest(path=path):
                status, _headers, body = self.get(path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"private fixture", body)

    def test_static_root_can_be_a_symlink(self):
        alias = self.root / "public"
        alias.symlink_to(self.static, target_is_directory=True)
        with patch.object(server, "STATIC", alias):
            status, _headers, body = self.get("/nested/app.js")
            self.assertEqual(status, 200)
            self.assertEqual(body, b"export const ready = true;")
            self.assertEqual(self.get("/../static-private/secret.txt")[0], 404)

    def test_page_keeps_session_token_and_csp_nonce(self):
        for path in server.PAGES:
            with self.subTest(path=path):
                status, headers, body = self.get(path)
                self.assertEqual(status, 200)
                self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")
                self.assertIn(('content="%s"' % server.SESSION_TOKEN).encode(), body)
                csp = headers["Content-Security-Policy"]
                nonce = csp.split("'nonce-", 1)[1].split("'", 1)[0]
                script_src = csp.split("script-src ", 1)[1].split(";", 1)[0]
                self.assertEqual(script_src.split(), ["'self'", "'nonce-%s'" % nonce])
                self.assertIn(('nonce="%s"' % nonce).encode(), body)

    def test_unknown_mime_type_uses_binary_fallback(self):
        status, headers, body = self.get("/asset.unknown-type")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/octet-stream")
        self.assertEqual(body, b"asset")

    def test_mime_type_cannot_inject_response_headers(self):
        for line_break in ("\r", "\n", "\r\n"):
            with self.subTest(line_break=repr(line_break)):
                mime_type = "text/plain" + line_break + "X-Injected: yes"
                with patch.object(server.mimetypes, "guess_type", return_value=(mime_type, None)):
                    status, headers, body = self.get("/nested/app.js")
                self.assertEqual(status, 200)
                self.assertEqual(headers["Content-Type"], "application/octet-stream")
                self.assertNotIn("X-Injected", headers)
                self.assertEqual(body, b"export const ready = true;")


if __name__ == "__main__":
    unittest.main()


class RecordingStoreTests(unittest.TestCase):
    """Model recordings (static/js/brain/recording.js) are saved and read back like benchmark runs."""

    def setUp(self):
        tmp = self.enterContext(tempfile.TemporaryDirectory())
        self.dir = Path(tmp) / "recordings"
        self.enterContext(patch.object(server, "RECORDINGS_DIR", self.dir))
        self.enterContext(patch.object(server, "PROJECT_ROOT", Path(tmp)))

    def recording(self, driver="llm:stub"):
        return {"format": server.RECORDING_FORMAT, "header": {"driver": driver, "model": "stub-1"},
                "drives": {"s1-1": {"0123456789abcdef": [{"timeout": True}]}}, "results": {"s1-1": {"pass": True}}}

    def test_save_list_and_load(self):
        saved = server.api_recording_save(self.recording(), {})
        self.assertTrue(saved["name"].endswith("-llm-stub"))
        self.assertTrue(saved["saved"].startswith("recordings/"))
        listed = server.api_recordings({}, {})["recordings"]
        self.assertEqual([r["name"] for r in listed], [saved["name"]])
        self.assertEqual(listed[0]["drives"], ["s1-1"])
        full = server.api_recordings({}, {"name": [saved["name"]]})
        self.assertEqual(full["drives"]["s1-1"]["0123456789abcdef"], [{"timeout": True}])
        self.assertEqual(full["results"], {"s1-1": {"pass": True}})
        text = (self.dir / ("%s.json" % saved["name"])).read_text()
        self.assertIn('\n   "0123456789abcdef": [{"timeout":true}]\n', text)

    def test_rejects_other_shapes_and_unknown_names(self):
        with self.assertRaises(server.BadRequest):
            server.api_recording_save({**self.recording(), "format": "other"}, {})
        for drives in ([], {"s1-1": []}, {"s1-1": {"key": {"timeout": True}}}):
            with self.assertRaises(server.BadRequest):
                server.api_recording_save({**self.recording(), "drives": drives}, {})
        for name in ["missing", "../secret", ""]:
            if name:
                with self.assertRaises(server.BadRequest):
                    server.api_recordings({}, {"name": [name]})
        self.assertEqual(server.api_recordings({}, {}), {"recordings": []})
