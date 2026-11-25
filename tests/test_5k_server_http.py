"""Exercise the local HTTP contract with real sockets and stub routes."""

from __future__ import annotations

import http.client
import io
import json
import socket
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import helpers  # noqa: F401

import server
from jev import security
from test_backend_hardening import _start_test_server


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.httpd = _start_test_server(self)
        self.port = self.httpd.server_port
        self.action = Mock(return_value={"ok": True})
        self.enterContext(patch.dict(server.ROUTES, {("POST", "/api/example"): self.action}))

    def request(self, method, path, body=None, headers=None):
        with closing(http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)) as conn:
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()

    def post(self, body, **headers):
        return self.request(
            "POST",
            "/api/example",
            body=body,
            headers={"X-Jev-Token": server.SESSION_TOKEN, "Content-Type": "application/json", **headers},
        )

    def raw(self, request):
        with socket.create_connection(("127.0.0.1", self.port), timeout=3) as conn:
            with conn.makefile("rb") as response:
                conn.sendall(request)
                return response.read()

    def test_head_api_matches_get_headers_without_body(self):
        status, headers, body = self.request("GET", "/api/health")
        head_status, head_headers, head_body = self.request("HEAD", "/api/health")
        self.assertEqual((status, head_status), (200, 200))
        self.assertEqual(headers["Content-Length"], head_headers["Content-Length"])
        self.assertEqual(headers["Content-Type"], head_headers["Content-Type"])
        self.assertEqual(int(headers["Content-Length"]), len(body))
        self.assertEqual(head_body, b"")

    def test_head_asset_and_page_send_no_entity(self):
        for path in ("/js/common.js", "/"):
            with self.subTest(path=path):
                status, headers, body = self.request("HEAD", path)
                self.assertEqual(status, 200)
                self.assertGreater(int(headers["Content-Length"]), 0)
                self.assertEqual(body, b"")

    def test_head_error_omits_body(self):
        status, headers, body = self.request("HEAD", "/api/unknown")
        self.assertEqual(status, 404)
        self.assertGreater(int(headers["Content-Length"]), 0)
        self.assertEqual(body, b"")

    def test_options_lists_only_available_methods(self):
        for path, allow in (
            ("/api/health", "GET, HEAD, OPTIONS"),
            ("/api/example", "POST, OPTIONS"),
            ("/", "GET, HEAD, OPTIONS"),
        ):
            with self.subTest(path=path):
                status, headers, body = self.request("OPTIONS", path)
                self.assertEqual((status, body), (204, b""))
                self.assertEqual(headers["Allow"], allow)
                self.assertNotIn("Content-Length", headers)
                self.assertNotIn("Content-Type", headers)
                self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.action.assert_not_called()

    def test_known_wrong_method_reports_allow_and_leaves_action_untouched(self):
        status, headers, body = self.request(
            "PUT", "/api/example", headers={security.TOKEN_HEADER: server.SESSION_TOKEN}
        )
        self.assertEqual(status, 405)
        self.assertEqual(headers["Allow"], "POST, OPTIONS")
        self.assertEqual(json.loads(body), {"error": "Method not allowed"})
        self.action.assert_not_called()

    def test_get_and_post_keep_legacy_wrong_method_response(self):
        for method, path in (("GET", "/api/example"), ("POST", "/api/health")):
            with self.subTest(method=method):
                status, _, body = self.request(method, path, headers={security.TOKEN_HEADER: server.SESSION_TOKEN})
                self.assertEqual(status, 404)
                self.assertEqual(json.loads(body), {"error": "Not found"})
        self.action.assert_not_called()

    def test_unsupported_write_methods_require_token(self):
        for method in ("PUT", "PATCH", "DELETE"):
            with self.subTest(method=method):
                self.assertEqual(self.request(method, "/api/health")[0], 403)
                status, headers, _ = self.request(
                    method, "/api/health", headers={security.TOKEN_HEADER: server.SESSION_TOKEN}
                )
                self.assertEqual(status, 405)
                self.assertEqual(headers["Allow"], "GET, HEAD, OPTIONS")

    def test_method_probe_for_unknown_endpoint_stays_not_found(self):
        self.assertEqual(self.request("OPTIONS", "/api/unknown")[0], 404)

    def test_rejects_cross_site_requests_to_read_apis(self):
        for method in ("GET", "HEAD", "OPTIONS"):
            with self.subTest(method=method):
                status, _, body = self.request(method, "/api/health", headers={"Sec-Fetch-Site": "cross-site"})
                self.assertEqual(status, 403)
                if method != "HEAD":
                    self.assertEqual(json.loads(body)["reason"], "sec-fetch-site")

    def test_user_can_navigate_to_the_app_from_another_site(self):
        self.assertEqual(self.request("GET", "/", headers={"Sec-Fetch-Site": "cross-site"})[0], 200)

    def test_read_api_refuses_unrelated_origin(self):
        status, _, body = self.request("GET", "/api/diagnostics", headers={"Origin": "https://example.invalid"})
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["reason"], "origin")

    def test_read_api_accepts_same_origin_without_a_token(self):
        headers = {"Origin": f"http://127.0.0.1:{self.port}", "Sec-Fetch-Site": "same-origin"}
        self.assertEqual(self.request("GET", "/api/health", headers=headers)[0], 200)

    def test_local_client_can_send_host_without_explicit_port(self):
        headers = {"Host": "LOCALHOST"}
        self.assertEqual(self.request("GET", "/api/health", headers=headers)[0], 200)

    def test_cross_site_request_never_negotiates_cors(self):
        status, headers, _ = self.request("OPTIONS", "/api/example", headers={"Origin": "http://example.invalid"})
        self.assertEqual(status, 403)
        self.assertFalse(any(name.lower().startswith("access-control-") for name in headers))

    def test_each_app_page_response_gets_a_fresh_nonce(self):
        _, first, first_body = self.request("GET", "/")
        _, second, second_body = self.request("GET", "/")
        self.assertNotEqual(first["Content-Security-Policy"], second["Content-Security-Policy"])
        self.assertNotEqual(first_body, second_body)

    def test_api_responses_keep_hardening_headers_on_errors(self):
        _, headers, _ = self.request("GET", "/api/missing")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(headers["Referrer-Policy"], "no-referrer")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])

    def test_body_at_the_limit_is_accepted(self):
        payload = b'{"n":1}'
        with patch.object(server, "MAX_BODY_BYTES", len(payload)):
            self.assertEqual(self.post(payload)[0], 200)
        self.action.assert_called_once_with({"n": 1}, {})

    def test_recording_save_has_a_separate_body_limit(self):
        payload = b'{"entry":true}'
        with (
            patch.multiple(server, MAX_BODY_BYTES=len(payload) - 1, MAX_RECORDING_BYTES=len(payload)),
            patch.dict(server.ROUTES, {("POST", "/api/recordings/save"): self.action}),
        ):
            status, _, _ = self.request(
                "POST",
                "/api/recordings/save",
                body=payload,
                headers={"X-Jev-Token": server.SESSION_TOKEN, "Content-Type": "application/json"},
            )
            self.assertEqual(status, 200)
            self.assertEqual(self.post(payload)[0], 400)
        self.action.assert_called_once_with({"entry": True}, {})

    def test_scalar_json_at_the_top_level_is_not_a_request(self):
        for value in (b"null", b"false", b"0", b'"text"'):
            with self.subTest(value=value):
                status, _, body = self.post(value)
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(body), {"error": "Body must be a JSON object"})
        self.action.assert_not_called()

    def test_provider_retry_statuses_keep_upstream_status_in_response(self):
        for upstream, expected in ((429, 429), (504, 504), (503, 502)):
            with self.subTest(upstream=upstream):
                self.action.side_effect = server.JevError("stub provider", status=upstream)
                status, _, body = self.post(b"{}")
                self.assertEqual(status, expected)
                self.assertEqual(json.loads(body), {"error": "stub provider", "jev_status": upstream})

    def test_read_api_refuses_bodies(self):
        status, _, body = self.request("GET", "/api/health", body=b"{}")
        self.assertEqual(status, 400)
        self.assertIn("GET does not accept a request body", json.loads(body)["error"])

    def test_body_with_unsupported_encoding_gets_415(self):
        status, _, body = self.post(b"{}", **{"Content-Encoding": "gzip"})
        self.assertEqual(status, 415)
        self.assertIn("Content-Encoding", json.loads(body)["error"])
        self.action.assert_not_called()

    def test_duplicate_content_encoding_gets_415(self):
        raw = (
            f"POST /api/example HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
            f"X-Jev-Token: {server.SESSION_TOKEN}\r\nContent-Type: application/json\r\n"
            "Content-Encoding: identity\r\nContent-Encoding: gzip\r\nContent-Length: 2\r\n\r\n{}"
        ).encode()
        self.assertIn(b" 415 ", self.raw(raw).splitlines()[0])
        self.action.assert_not_called()

    def test_explicit_identity_encoding_is_supported(self):
        self.assertEqual(self.post(b"{}", **{"Content-Encoding": "Identity"})[0], 200)

    def test_expect_gets_a_final_response_before_body(self):
        raw = (
            f"POST /api/example HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
            f"X-Jev-Token: {server.SESSION_TOKEN}\r\nContent-Type: application/json\r\n"
            "Expect: 100-continue\r\nContent-Length: 2\r\n\r\n"
        ).encode()
        response = self.raw(raw)
        self.assertIn(b" 417 ", response.splitlines()[0])
        self.assertNotIn(b" 100 Continue", response)
        self.action.assert_not_called()

    def test_request_body_timeout_returns_a_final_client_error(self):
        reader = Mock()
        reader.read.side_effect = TimeoutError
        handler = object.__new__(server.Handler)
        handler.path = "/api/example"
        handler.headers = {
            "Host": "localhost:8322",
            "X-Jev-Token": server.SESSION_TOKEN,
            "Content-Type": "application/json",
            "Content-Length": "2",
        }
        handler.rfile = reader
        handler._send = Mock()
        handler._handle("POST")
        handler._send.assert_called_once_with(408, {"error": "Timed out reading the request body"})
        self.action.assert_not_called()

    def test_large_content_length_is_rejected_before_reading(self):
        self.assertEqual(self.post(b"", **{"Content-Length": "9" * 5000})[0], 400)
        self.action.assert_not_called()

    def test_many_leading_zeroes_do_not_invalidate_short_length(self):
        self.assertEqual(self.post(b"{}", **{"Content-Length": ("0" * 5000) + "2"})[0], 200)

    def test_leading_utf8_signature_is_accepted(self):
        self.assertEqual(self.post(b"\xef\xbb\xbf{}")[0], 200)
        self.action.assert_called_once_with({}, {})

    def test_duplicate_properties_are_rejected_even_when_nested_or_escaped(self):
        for data in (b'{"name":1,"name":2}', rb'{"a":{"x":1,"\u0078":2}}'):
            with self.subTest(data=data):
                self.assertEqual(self.post(data)[0], 400)
        self.action.assert_not_called()

    def test_surrogate_values_and_property_names_are_client_errors(self):
        for data in (rb'{"a":["\ud800"]}', rb'{"\udc00":1}'):
            with self.subTest(data=data):
                self.assertEqual(self.post(data)[0], 400)
        self.action.assert_not_called()

    def test_valid_supplementary_codepoint_is_preserved(self):
        self.assertEqual(self.post(rb'{"name":"\ud83d\ude97"}')[0], 200)
        self.action.assert_called_once_with({"name": "🚗"}, {})

    def test_rejects_invalid_percent_and_utf8_query_encoding(self):
        for query in ("name=%", "name=%GG", "name=%FF"):
            with self.subTest(query=query):
                self.assertEqual(self.request("GET", "/api/health?" + query)[0], 400)

    def test_rejects_fragments_and_relative_targets(self):
        for path in ("/api/health#fragment", "api/health"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 400)

    def test_semicolon_is_part_of_a_path(self):
        self.assertEqual(self.request("GET", "/api/health;obsolete")[0], 404)

    def test_reserved_api_paths_cannot_serve_static_assets(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        (root / "api").mkdir()
        (root / "api" / "missing").write_text("static", encoding="utf-8")
        with patch.object(server, "STATIC", root):
            self.assertEqual(self.request("GET", "/api/missing")[0], 404)

    def test_missing_page_has_a_json_error(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        with patch.object(server, "STATIC", root):
            status, _, body = self.request("GET", "/")
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(body), {"error": "Page file is missing"})

    def test_invalid_page_encoding_is_a_generic_server_error(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        (root / "index.html").write_bytes(b"\xff")
        with patch.object(server, "STATIC", root), patch.object(server.traceback, "print_tb") as trace:
            status, _, body = self.request("GET", "/")
        self.assertEqual(status, 500)
        self.assertEqual(json.loads(body), {"error": "Internal server error"})
        trace.assert_called_once()

    def test_parser_failure_uses_json_and_does_not_echo_request_line(self):
        response = self.raw(b"GET /?secret=fixture HTTP/strange\r\n\r\n")
        self.assertIn(b" 400 ", response.splitlines()[0])
        self.assertNotIn(b"secret=fixture", response)
        self.assertIn(b'{"error": "Bad Request"}', response)

    def test_responses_hide_python_version_and_set_isolation_headers(self):
        _, headers, _ = self.request("GET", "/api/health")
        self.assertEqual(headers["Server"], server.Handler.server_version)
        self.assertEqual(headers["Cross-Origin-Resource-Policy"], "same-origin")
        self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_unhandled_error_logs_type_without_its_private_message(self):
        self.action.side_effect = ValueError("sensitive fixture")
        with patch.object(server, "log") as log, patch.object(server.traceback, "print_tb") as trace:
            status, _, body = self.post(b"{}")
        self.assertEqual(status, 500)
        self.assertEqual(json.loads(body), {"error": "Internal server error"})
        self.assertIn("POST /api/example failed (ValueError)", str(log.call_args_list))
        self.assertNotIn("sensitive fixture", str(log.call_args_list))
        trace.assert_called_once()

    def test_actual_listener_port_is_used_for_host_validation(self):
        handler = self.httpd.RequestHandlerClass
        with patch.object(handler, "port", 1):
            self.assertEqual(self.request("GET", "/api/health")[0], 200)

    def test_unprintable_mime_types_fall_back_to_binary(self):
        for ctype in ("text/é", "text/plain\x00"):
            with self.subTest(ctype=ctype), patch.dict(server.mimetypes.types_map, {".js": ctype}):
                status, headers, _ = self.request("GET", "/js/common.js")
            self.assertEqual(status, 200)
            self.assertEqual(headers["Content-Type"], "application/octet-stream")

    def test_application_connections_do_not_reuse_a_stream_after_unknown_body(self):
        raw = (
            f"POST /unknown HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
            f"X-Jev-Token: {server.SESSION_TOKEN}\r\n"
            "Connection: keep-alive\r\nContent-Length: 6\r\nContent-Type: application/json\r\n\r\n123456"
            f"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n\r\n"
        ).encode()
        response = self.raw(raw)
        self.assertEqual(response.count(b"HTTP/1."), 1)
        self.assertIn(b" 404 ", response.splitlines()[0])

    def test_raw_network_path_cannot_be_normalized_into_api_route(self):
        request = f"GET //api/health HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n\r\n".encode()
        self.assertIn(b" 400 ", self.raw(request).splitlines()[0])

    def test_encoded_path_separators_are_refused(self):
        for path in ("/api%2Fhealth", "/js%5ccommon.js", "/js\\common.js"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 400)

    def test_path_decoding_serves_quoted_asset_names(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        (root / "à vélo.txt").write_text("asset", encoding="utf-8")
        with patch.object(server, "STATIC", root):
            status, _, data = self.request("GET", "/%C3%A0%20v%C3%A9lo.txt")
        self.assertEqual((status, data), (200, b"asset"))

    def test_path_decoding_keeps_files_within_static_root(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        (root / "sibling.txt").write_bytes(b"private file")
        static = root / "static"
        static.mkdir()
        with patch.object(server, "STATIC", static):
            status, _, data = self.request("GET", "/%2e%2e/sibling.txt")
        self.assertEqual(status, 404)
        self.assertNotIn(b"private file", data)

    def test_page_destinations_use_same_static_root_boundary(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        (root / "secret.html").write_bytes(b"private file")
        static = root / "static"
        static.mkdir()
        (static / "index.html").symlink_to(root / "secret.html")
        with patch.object(server, "STATIC", static):
            status, _, data = self.request("GET", "/")
        self.assertEqual(status, 404)
        self.assertNotIn(b"private file", data)

    def test_static_symlink_loop_returns_not_found(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        (root / "loop.js").symlink_to(root / "loop.js")
        with patch.object(server, "STATIC", root):
            self.assertEqual(self.request("GET", "/loop.js")[0], 404)

    def test_static_assets_stream_in_chunks_and_report_complete_length(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        (root / "small.bin").write_bytes(b"hello world!")
        with patch.object(server, "STATIC", root), patch.object(server, "ASSET_CHUNK_BYTES", 2):
            status, headers, data = self.request("GET", "/small.bin")
        self.assertEqual((status, int(headers["Content-Length"]), data), (200, 12, b"hello world!"))

    def test_static_cache_policy_is_private_and_session_pages_are_uncached(self):
        status, headers, _ = self.request("GET", "/js/common.js")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "private, no-cache")
        for path in ("/", "/api/health"):
            with self.subTest(path=path):
                _, private, _ = self.request("GET", path, headers={"If-None-Match": "*"})
                self.assertEqual(private["Cache-Control"], "no-store")
                self.assertNotIn("ETag", private)

    def test_etag_revalidation_returns_no_entity(self):
        path = "/js/common.js"
        _, original, _ = self.request("GET", path)
        status, headers, data = self.request("GET", path, headers={"If-None-Match": original["ETag"]})
        self.assertEqual((status, data), (304, b""))
        self.assertEqual(headers["ETag"], original["ETag"])
        self.assertEqual(headers["Last-Modified"], original["Last-Modified"])
        self.assertNotIn("Content-Length", headers)

    def test_etag_list_accepts_strong_form_for_same_representation(self):
        path = "/js/common.js"
        _, original, _ = self.request("GET", path)
        matching = original["ETag"].removeprefix("W/")
        status, _, _ = self.request("HEAD", path, headers={"If-None-Match": f'"different", {matching}'})
        self.assertEqual(status, 304)

    def test_etag_wildcard_revalidates_only_existing_file(self):
        self.assertEqual(self.request("GET", "/js/common.js", headers={"If-None-Match": "*"})[0], 304)
        self.assertEqual(self.request("GET", "/missing.js", headers={"If-None-Match": "*"})[0], 404)

    def test_if_modified_since_is_a_fallback_validator(self):
        path = "/js/common.js"
        _, original, _ = self.request("GET", path)
        self.assertEqual(self.request("GET", path, headers={"If-Modified-Since": original["Last-Modified"]})[0], 304)
        self.assertEqual(self.request("GET", path, headers={"If-Modified-Since": "invalid"})[0], 200)
        self.assertEqual(
            self.request(
                "GET", path, headers={"If-None-Match": '"different"', "If-Modified-Since": original["Last-Modified"]}
            )[0],
            200,
        )

    def test_replaced_asset_gets_new_etag_even_if_content_length_matches(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        path = root / "test.txt"
        path.write_bytes(b"old")
        with patch.object(server, "STATIC", root):
            _, original, _ = self.request("GET", "/test.txt")
            replacement = root / "replacement"
            replacement.write_bytes(b"new")
            replacement.replace(path)
            status, headers, body = self.request("GET", "/test.txt", headers={"If-None-Match": original["ETag"]})
        self.assertEqual((status, body), (200, b"new"))
        self.assertNotEqual(headers["ETag"], original["ETag"])


class PolicyTests(unittest.TestCase):
    def check(self, **headers):
        return security.check_request(
            "POST", {"Host": "localhost:8322", security.TOKEN_HEADER: "test", **headers}, "test", 8322
        )

    def test_present_empty_fetch_site_is_invalid(self):
        self.assertEqual(self.check(**{"Sec-Fetch-Site": ""}), "sec-fetch-site")

    def test_fetch_site_none_accepts_explicit_local_navigation_context(self):
        self.assertIsNone(self.check(**{"Sec-Fetch-Site": "none"}))

    def test_same_site_is_not_enough_when_origin_differs(self):
        self.assertEqual(self.check(**{"Sec-Fetch-Site": "same-site"}), "sec-fetch-site")

    def test_opaque_origin_is_refused(self):
        self.assertEqual(self.check(Origin="null"), "origin")

    def test_host_policy_rejects_other_loopback_ip_aliases(self):
        for name in ("127.0.0.2", "127.1", "localhost.", "[::ffff:127.0.0.1]"):
            with self.subTest(name=name):
                self.assertFalse(security.host_allowed(name, 8322))

    def test_present_empty_origin_is_invalid(self):
        self.assertEqual(self.check(Origin=""), "origin")

    def test_origin_value_is_an_origin_with_no_other_components(self):
        for suffix in ("/", "?query=1", "#fragment"):
            with self.subTest(suffix=suffix):
                self.assertEqual(self.check(Origin="http://localhost:8322" + suffix), "origin")

    def test_default_http_port_allows_implicit_port_in_origin(self):
        headers = {"Host": "localhost", "Origin": "http://localhost", security.TOKEN_HEADER: "test"}
        self.assertIsNone(security.check_request("POST", headers, "test", 80))
        self.assertEqual(security.check_request("POST", headers, "test", 8322), "origin")

    def test_origin_must_match_the_loopback_host_alias(self):
        self.assertEqual(self.check(Origin="http://127.0.0.1:8322"), "origin")
        self.assertIsNone(self.check(Origin="http://localhost:8322"))

    def test_unicode_whitespace_does_not_normalize_a_host(self):
        self.assertFalse(security.host_allowed("\xa0localhost:8322", 8322))

    def test_unbracketed_ipv6_is_an_invalid_authority(self):
        self.assertEqual(security.split_host("::1"), ("", -1))

    def test_peer_must_be_the_bound_loopback_ip(self):
        listener = object.__new__(server.LocalServer)
        self.assertTrue(listener.verify_request(None, ("127.0.0.1", 1)))
        self.assertFalse(listener.verify_request(None, ("192.0.2.1", 1)))

    def test_route_logs_exclude_query_and_suppress_decision_traffic(self):
        handler = object.__new__(server.Handler)
        handler.command = "POST"
        handler.path = "/api/example?debug=sample"
        handler._request_path = "/api/example"
        handler.log_message = Mock()
        handler.log_request(200)
        handler.log_message.assert_called_once_with("%.16s %.160s %s", "POST", "/api/example", 200)
        handler.log_message.reset_mock()
        for path in ("/api/decide", "/api/llm/decide", "/api/decision/decide"):
            handler._request_path = path
            handler.log_request(200)
        handler.log_message.assert_not_called()

    def test_log_escapes_terminal_control_characters(self):
        output = io.StringIO()
        with patch.object(server.sys, "stderr", output):
            server.log("first\nsecond\x1b[2J")
        self.assertTrue(output.getvalue().endswith(r"first\nsecond\x1b[2J" + "\n"))

    def test_access_log_path_length_is_bounded(self):
        handler = object.__new__(server.Handler)
        handler.command = "GET"
        handler._request_path = "/" + ("a" * 400)
        output = io.StringIO()
        with patch.object(server.sys, "stderr", output), patch.object(server.settings, "get", return_value=None):
            handler.log_request(404)
        self.assertIn("a" * 159, output.getvalue())
        self.assertNotIn("a" * 160, output.getvalue())

    def test_disconnect_in_error_response_does_not_log_as_server_failure(self):
        handler = object.__new__(server.Handler)
        handler._dispatch = Mock(side_effect=server.BadRequest("bad shape"))
        handler._send = Mock(side_effect=BrokenPipeError())
        with patch.object(server.traceback, "print_tb") as trace:
            handler._handle("POST")
        trace.assert_not_called()
        handler._send.assert_called_once()

    def test_stream_error_after_headers_does_not_append_a_second_response(self):
        handler = object.__new__(server.Handler)
        handler.command = "GET"
        handler.headers = {}
        handler._send_headers = Mock()
        handler._send = Mock()
        handle = Mock()
        handle.__enter__ = Mock(return_value=handle)
        handle.__exit__ = Mock(return_value=False)
        handle.read.side_effect = OSError("read error")
        info = SimpleNamespace(st_dev=1, st_ino=1, st_size=100, st_mtime_ns=1, st_ctime_ns=1, st_mode=0o100644)
        with patch.object(Path, "open", return_value=handle), patch.object(server.os, "fstat", return_value=info):
            with patch.object(server, "log") as log:
                handler._send_asset(Path("asset.bin"))
        handler._send_headers.assert_called_once()
        handler._send.assert_not_called()
        log.assert_called_once()
