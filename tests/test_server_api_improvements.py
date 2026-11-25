"""Offline regression coverage for the server and provider APIs."""

import gzip
import io
import json
import os
import tempfile
import unittest
import urllib.error
from email.message import Message
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import helpers  # noqa: F401

import server
from jev import client, decide, decision, decision_setup, endpoints, envfile, llm, llm_setup, maps, security
from jev.config import DEFAULT_BBOX, Settings, parse_bbox

QUESTION = {"type": "choice", "criteria": {"drive": None}, "instructions": "Choose the motion"}
JEV_REQUEST = {"state": {}, "questions": {"motion": QUESTION}}
LLM_REQUEST = {"messages": [{"role": "user", "content": "Choose the motion"}], "expect": {"motion": ["drive"]}}
RUN = {"config": {}, "summary": {}, "results": []}


class HttpTests(unittest.TestCase):
    def dispatch(self, body=b"{}", *, method="POST", path="/api/proof", headers=None, error=None):
        handler = object.__new__(server.Handler)
        handler.path = path
        handler.headers = Message()
        for name, value in (
            headers
            if headers is not None
            else (
                ("Host", "localhost:8322"),
                (security.TOKEN_HEADER, server.SESSION_TOKEN),
                ("Content-Type", "application/json"),
                ("Content-Length", str(len(body))),
            )
        ):
            handler.headers[name] = value
        handler.rfile = io.BytesIO(body)
        handler._send = Mock()
        route = Mock(return_value={"ok": True}, side_effect=error)
        with patch.dict(server.ROUTES, {(method, "/api/proof"): route}):
            handler._handle(method)
        return handler._send.call_args.args, route

    def refused_body(self, body, message):
        (status, payload), route = self.dispatch(body)
        self.assertEqual(status, 400)
        self.assertIn(message, payload["error"])
        route.assert_not_called()

    def test_transfer_encoding(self):
        """Reject unsupported HTTP transfer encodings before reading a body."""
        response, route = self.dispatch(headers=[("Transfer-Encoding", "chunked")])
        self.assertEqual(response[0], 400)
        self.assertIn("Transfer-Encoding", response[1]["error"])
        route.assert_not_called()

    def test_query_field_limit(self):
        """Limit the number of query parameters before allocating their parsed values."""
        query = "&".join("p" + str(i) + "=v" for i in range(server.MAX_QUERY_FIELDS + 1))
        response, route = self.dispatch(path="/api/proof?" + query)
        self.assertEqual(response[0], 400)
        route.assert_not_called()

    def test_absolute_target(self):
        """Require a local path in an HTTP request target."""
        response, route = self.dispatch(path="http://localhost:8322/api/proof")
        self.assertEqual(response[0], 400)
        route.assert_not_called()

    def test_truncated_body(self):
        """Return a client error when a request body ends before its declared length."""
        headers = [
            ("Host", "localhost:8322"),
            (security.TOKEN_HEADER, server.SESSION_TOKEN),
            ("Content-Type", "application/json"),
            ("Content-Length", "3"),
        ]
        response, route = self.dispatch(headers=headers)
        self.assertEqual(response, (400, {"error": "Request body is incomplete"}))
        route.assert_not_called()

    def test_json_error(self):
        """Return a dedicated JSON decoding error for invalid request bodies."""
        for body in (b"{", b'{"a":"\xff"}'):
            with self.subTest(body=body[:12]):
                self.refused_body(body, "valid UTF-8 JSON")
        with patch.object(server.json, "loads", side_effect=RecursionError()):
            self.refused_body(b"{}", "valid UTF-8 JSON")

    def test_non_finite_json(self):
        """Reject non-finite JSON numbers, including exponents that overflow."""
        for value in (b"NaN", b"Infinity", b"-Infinity", b"1e999"):
            with self.subTest(value=value):
                self.refused_body(b'{"value":' + value + b"}", "valid UTF-8 JSON")

    def test_private_error(self):
        """Keep internal exception details out of API error responses."""
        for error in (OSError("private filesystem path"), KeyError("missing internal field")):
            with self.subTest(error=type(error)), patch.object(server.traceback, "print_exc") as log:
                response, _ = self.dispatch(error=error)
                self.assertEqual(response, (500, {"error": "Internal server error"}))
                log.assert_called_once()

    def test_disconnected_client(self):
        """Stop request handling quietly when a client has disconnected."""
        with patch.object(server.traceback, "print_exc") as log:
            with patch.dict(server.ROUTES, {("POST", "/api/proof"): Mock(side_effect=BrokenPipeError())}):
                handler = object.__new__(server.Handler)
                handler.path = "/api/proof"
                handler.headers = {"Host": "localhost:8322", security.TOKEN_HEADER: server.SESSION_TOKEN}
                handler._send = Mock()
                handler._handle("POST")
                handler._send.assert_not_called()
        log.assert_not_called()

    def test_query_values(self):
        """Cover repeated query values and percent decoding at the handler boundary."""
        response, route = self.dispatch(path="/api/proof/?key=one&key=two%20words")
        self.assertEqual(response[0], 200)
        route.assert_called_once_with({}, {"key": ["one", "two words"]})

    def test_acknowledged_api_error(self):
        """Cover the JSON response contract for explicit API validation errors."""
        response, _ = self.dispatch(error=server.BadRequest("Choose a map"))
        self.assertEqual(response, (400, {"error": "Choose a map"}))

    def test_non_page_csp(self):
        """Omit script nonces on responses that have no inline script."""
        handler = object.__new__(server.Handler)
        handler.wfile = io.BytesIO()
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        handler._send(200, {"ok": True})
        csp = next(
            value for (name, value), _ in handler.send_header.call_args_list if name == "Content-Security-Policy"
        )
        self.assertIn("script-src 'self';", csp)
        self.assertNotIn("nonce-", csp)

    def test_response_json_finiteness(self):
        """Prevent the server from emitting JSON numbers browsers cannot parse."""
        handler = object.__new__(server.Handler)
        handler.send_response = Mock()
        with self.assertRaises(ValueError):
            handler._send(200, {"value": float("nan")})
        handler.send_response.assert_not_called()


class RequestPolicyTests(unittest.TestCase):
    def setUp(self):
        self.headers = Message()
        self.headers["Host"] = "localhost:8322"
        self.headers[security.TOKEN_HEADER] = "test-token"
        self.headers["Content-Type"] = "application/json"

    def reason(self, method="POST"):
        return security.check_request(method, self.headers, "test-token", 8322, has_body=True)

    def test_ambiguous_security_headers(self):
        """Reject ambiguous security and content headers before dispatch."""
        for name, value, method, reason in (
            ("Host", "localhost:8322", "GET", "host"),
            ("Origin", "http://localhost:8322", "POST", "origin"),
            ("Sec-Fetch-Site", "same-origin", "POST", "sec-fetch-site"),
            (security.TOKEN_HEADER, "test-token", "POST", "token"),
            ("Content-Type", "application/json", "POST", "content-type"),
        ):
            with self.subTest(header=name):
                if not self.headers.get_all(name):
                    self.headers[name] = value
                self.headers[name] = value
                self.assertEqual(self.reason(method), reason)
                del self.headers[name]
                self.headers[name] = value

    def test_unicode_token(self):
        """Handle non-ASCII session tokens as authentication failures."""
        self.headers.replace_header(security.TOKEN_HEADER, "café")
        self.assertEqual(self.reason(), "token")

    def test_media_type(self):
        """Validate JSON media types exactly while accepting charset parameters."""
        self.headers.replace_header("Content-Type", "application/json-dummy")
        self.assertEqual(self.reason(), "content-type")
        self.headers.replace_header("Content-Type", "Application/JSON; charset=UTF-8")
        self.assertIsNone(self.reason())

    def test_bodyless_probe(self):
        """Cover authorized bodyless model probes without a content-type header."""
        del self.headers["Content-Type"]
        self.assertIsNone(security.check_request("POST", self.headers, "test-token", 8322))


class RequestValidationTests(unittest.TestCase):
    def test_drive_validation_before_loading(self):
        """Reject malformed drive origins before loading their map."""
        with patch.object(server, "load_map") as load:
            with self.assertRaisesRegex(server.BadRequest, "from"):
                server.api_drives({"bbox": "toronto", "from": []}, {})
        load.assert_not_called()

    def test_drive_boolean(self):
        """Reject boolean drive coordinates instead of treating them as meters or radians."""
        with self.assertRaisesRegex(server.BadRequest, "finite coordinates"):
            server.api_drives({"from": {"x": 0, "y": 1, "heading": True}}, {})

    def test_drive_overflow(self):
        """Return a validation error for drive coordinates outside floating-point range."""
        with self.assertRaisesRegex(server.BadRequest, "finite coordinates"):
            server.api_drives({"from": {"x": 10**500, "y": 1, "heading": 0}}, {})

    def test_route_avoid_type(self):
        """Reject wrongly typed empty route-avoidance lists."""
        with self.assertRaisesRegex(server.BadRequest, "avoid"):
            server.api_route({"from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 1}, "avoid": ""}, {})

    def test_route_restrictions_type(self):
        """Require route restriction switches to be booleans."""
        with self.assertRaisesRegex(server.BadRequest, "restrictions"):
            server.api_route({"from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 1}, "restrictions": "false"}, {})

    def test_force_probe_type(self):
        """Validate the force-refresh switch before probing model endpoints."""
        for probe in (server.api_llm_check, server.api_decision_check):
            with self.subTest(probe=probe.__name__), self.assertRaisesRegex(server.BadRequest, "force"):
                probe({"force": "false"}, {})

    def test_finite_jev_state(self):
        """Refuse a Jev state that cannot be serialized as finite JSON."""
        with self.assertRaisesRegex(decide.InvalidRequest, "finite JSON"):
            decide.validate_request({**JEV_REQUEST, "state": {"speed": float("nan")}})

    def test_blank_jev_criteria(self):
        """Require non-empty choice IDs in Jev questions."""
        request = {**JEV_REQUEST, "questions": {"motion": {**QUESTION, "criteria": {" ": None}}}}
        with self.assertRaisesRegex(decide.InvalidRequest, "non-empty ids"):
            decide.validate_request(request)

    def test_max_jev_state(self):
        """Cover the exact upper boundary of the serialized Jev state budget."""
        state = {"data": "x" * (decide.MAX_STATE_BYTES - len(json.dumps({"data": ""})))}
        decide.validate_request({**JEV_REQUEST, "state": state})
        state["data"] += "x"
        with self.assertRaisesRegex(decide.InvalidRequest, "larger"):
            decide.validate_request({**JEV_REQUEST, "state": state})

    def test_max_jev_instructions(self):
        """Cover the exact instruction limit accepted by Jev request validation."""
        for length in (decide.MAX_INSTRUCTIONS_CHARS, decide.MAX_INSTRUCTIONS_CHARS + 1):
            with self.subTest(length=length):
                question = {**QUESTION, "instructions": "x" * length}
                request = {**JEV_REQUEST, "questions": {"motion": question}}
                if length > decide.MAX_INSTRUCTIONS_CHARS:
                    with self.assertRaisesRegex(decide.InvalidRequest, "too long"):
                        decide.validate_request(request)
                else:
                    self.assertEqual(decide.validate_request(request)["questions"]["motion"], question)

    def test_llm_user_message(self):
        """Require a non-empty user message before calling a language model."""
        for messages in ([{"role": "system", "content": "Instructions"}], [{"role": "user", "content": "  "}]):
            with self.subTest(messages=messages), self.assertRaisesRegex(llm.InvalidLlmRequest, "user message"):
                llm.validate_request({**LLM_REQUEST, "messages": messages})

    def test_llm_duplicate_ids(self):
        """Reject duplicate option IDs before building a language model schema."""
        with self.assertRaisesRegex(llm.InvalidLlmRequest, "unique ids"):
            llm.validate_request({**LLM_REQUEST, "expect": {"candidate": ["keep", "keep"]}})

    def test_llm_id_newline(self):
        """Validate the whole offered language model option ID."""
        with self.assertRaisesRegex(llm.InvalidLlmRequest, "short ids"):
            llm.validate_request({**LLM_REQUEST, "expect": {"candidate": ["keep\n"]}})

    def test_llm_message_metadata(self):
        """Cover the prompt allowlist that drops extra message properties."""
        message = dict(LLM_REQUEST["messages"][0], metadata={"internal": True})
        self.assertEqual(
            llm.validate_request({**LLM_REQUEST, "messages": [message]})["messages"], LLM_REQUEST["messages"]
        )


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.runs = self.root / "runs"
        self.recordings = self.root / "recordings"
        self.results = self.root / "results.json"
        self.enterContext(
            patch.multiple(
                server,
                PROJECT_ROOT=self.root,
                RUNS_DIR=self.runs,
                RECORDINGS_DIR=self.recordings,
                SNAPSHOTS_DIR=self.root / "snapshots",
                RESULTS_FILE=self.results,
            )
        )
        server._artifact_metadata.cache_clear()
        self.addCleanup(server._artifact_metadata.cache_clear)

    def write_run(self, name, payload=RUN):
        self.runs.mkdir(exist_ok=True)
        path = self.runs / (name + ".json")
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def write_recording(self, name, *, driver="test", drives=None, zipped=False):
        self.recordings.mkdir(exist_ok=True)
        path = self.recordings / (name + (".json.gz" if zipped else ".json"))
        body = {"format": server.RECORDING_FORMAT, "header": {"driver": driver}, "drives": drives or {}}
        raw = json.dumps(body).encode()
        path.write_bytes(gzip.compress(raw) if zipped else raw)
        return path

    def test_listing_is_read_only(self):
        """Leave an absent artifact directory untouched when listing it."""
        self.assertEqual(server.api_bench_runs({}, {}), {"runs": []})
        self.assertFalse(self.runs.exists())

    def test_exact_run_lookup(self):
        """Reject mistyped run names instead of loading a different sanitized name."""
        self.write_run("training")
        with self.assertRaisesRegex(server.BadRequest, "Invalid run name"):
            server.api_bench_runs({}, {"name": ["train ing"]})

    def test_run_config_object(self):
        """Require a benchmark run configuration object when saving."""
        with self.assertRaisesRegex(server.BadRequest, "config must be an object"):
            server.api_bench_save({**RUN, "config": []}, {})
        self.assertFalse(self.runs.exists())

    def test_run_read_limit(self):
        """Bound memory used to load a saved benchmark run."""
        self.write_run("run")
        with patch.object(server, "MAX_RUN_BYTES", 10):
            with self.assertRaisesRegex(server.BadRequest, "could not be read"):
                server.api_bench_runs({}, {"name": ["run"]})
            self.assertEqual(server.api_bench_runs({}, {}), {"runs": []})

    def test_run_catalog_cache(self):
        """Reuse benchmark metadata across repeated listing requests."""
        self.write_run("run")
        with patch.object(server, "_read_json_file", wraps=server._read_json_file) as read:
            first = server.api_bench_runs({}, {})
            self.assertEqual(server.api_bench_runs({}, {}), first)
            read.assert_called_once()

    def test_cache_replaced_file(self):
        """Refresh listing metadata when a file is replaced with the same size and timestamp."""
        path = self.write_run("run", {**RUN, "summary": {"total": 1}})
        self.assertEqual(server.api_bench_runs({}, {})["runs"][0]["summary"], {"total": 1})
        original = path.stat()
        replacement = self.write_run("replacement", {**RUN, "summary": {"total": 2}})
        os.utime(replacement, ns=(original.st_atime_ns, original.st_mtime_ns))
        replacement.replace(path)
        self.assertEqual(server.api_bench_runs({}, {})["runs"][0]["summary"], {"total": 2})

    def test_recording_metadata_cache(self):
        """Avoid reopening compressed recording tapes to repeat a catalog listing."""
        self.write_recording("drive", zipped=True, drives={"s1-2": {}, "s1-1": {}})
        with patch.object(server, "_read_json_file", wraps=server._read_json_file) as read:
            first = server.api_recordings({}, {})
            self.assertEqual(first["recordings"][0]["drives"], ["s1-1", "s1-2"])
            self.assertEqual(server.api_recordings({}, {}), first)
            read.assert_called_once()

    def test_incomplete_recording_metadata(self):
        """Keep recordings without a usable header or drive map out of the catalog."""
        path = self.write_recording("drive")
        path.write_text(json.dumps({"format": server.RECORDING_FORMAT, "header": {}, "drives": []}))
        self.assertEqual(server.api_recordings({}, {}), {"recordings": []})

    def test_plain_recording_limit(self):
        """Apply the recording read limit to uncompressed artifacts too."""
        self.write_recording("drive")
        with patch.object(server, "MAX_ARCHIVE_BYTES", 10):
            self.assertEqual(server.api_recordings({}, {}), {"recordings": []})
            with self.assertRaisesRegex(server.BadRequest, "could not be read"):
                server.api_recordings({}, {"name": ["drive"]})

    def test_recording_catalog_precedence(self):
        """Cover the preference for a readable plain tape when both archive formats exist."""
        self.write_recording("drive", driver="compressed", zipped=True)
        self.write_recording("drive", driver="plain")
        slots = server.api_recordings({}, {})["recordings"]
        self.assertEqual([slot["header"]["driver"] for slot in slots], ["plain"])

    def test_snapshot_expect(self):
        """Require snapshot expected answers to be stored as an object."""
        with self.assertRaisesRegex(server.BadRequest, "expect must be an object"):
            server.api_snapshot_save({**JEV_REQUEST, "expect": []}, {})

    def test_snapshot_filename_collision(self):
        """Record a snapshot's actual saved name when an earlier save used the same name."""
        first = server.api_snapshot_save(JEV_REQUEST, {})
        second = server.api_snapshot_save(JEV_REQUEST, {})
        first_path, second_path = (self.root / item["saved"] for item in (first, second))
        self.assertNotEqual(first_path, second_path)
        self.assertEqual(json.loads(second_path.read_text())["name"], second_path.stem)

    def test_suite_version_digits(self):
        """Require ASCII digits in numbered recording suite versions."""
        self.assertTrue(server.valid_suite_version("v12"))
        self.assertFalse(server.valid_suite_version("v1²"))

    def test_corrupt_results_diagnostic(self):
        """Give leaderboard users the regeneration command for an unreadable results file."""
        self.results.write_text("{")
        with self.assertRaisesRegex(server.BadRequest, "scripts/build_results.py"):
            server.api_results({}, {})


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.path = self.root / ".env"

    def test_bbox_type(self):
        """Handle non-text bounding-box inputs in the settings parser."""
        self.assertIsNone(parse_bbox([1, 2, 3, 4]))

    def test_bbox_preset_whitespace(self):
        """Cover case-insensitive bounding box preset names with surrounding whitespace."""
        self.assertEqual(parse_bbox("  KITSILANO \t"), DEFAULT_BBOX)

    def test_fractional_rpm(self):
        """Fall back to the default rate cap for fractional process settings."""
        self.assertEqual(Settings({"JEV_FSD_RPM": "0.5"}, self.path).rpm, 240)

    def test_fractional_npcs(self):
        """Fall back to the default traffic count for a fractional vehicle setting."""
        self.assertEqual(Settings({"JEV_FSD_NPCS": "39.5"}, self.path).npcs, 40)

    def test_shell_and_file(self):
        """Cover process environment precedence across file reloads."""
        self.path.write_text("TYPESAFE_DEFAULT_MODEL=file-model\n")
        settings = Settings({"TYPESAFE_DEFAULT_MODEL": "shell-model"}, self.path)
        self.path.write_text("TYPESAFE_DEFAULT_MODEL=new-file-model\n")
        settings.reload_file()
        self.assertEqual(settings.file_values["TYPESAFE_DEFAULT_MODEL"], "new-file-model")
        self.assertEqual(settings.model, "shell-model")

    def test_relative_endpoint_config(self):
        """Cover repository-relative endpoint config paths when launched from another directory."""
        settings = Settings({"JEV_FSD_DECISION_ENDPOINTS": "config/decisions.json"}, self.path)
        self.assertEqual(settings.decision_endpoints_path, server.PROJECT_ROOT / "config/decisions.json")

    def test_quoted_env_comments(self):
        """Parse quoted environment values with trailing comments while keeping hashes inside quotes."""
        self.assertEqual(envfile.parse('LABEL="left # right" # note'), {"LABEL": "left # right"})

    def test_env_comment_tab(self):
        """Recognize tab-separated comments in unquoted environment values."""
        self.assertEqual(envfile.parse("MODEL=demo\t# comment"), {"MODEL": "demo"})

    def test_export_env_repeated_variables(self):
        """Cover export assignments and last-definition precedence in environment files."""
        self.assertEqual(envfile.parse("export LABEL=first\n# note\nLABEL=last\n"), {"LABEL": "last"})

    def test_env_variable_name(self):
        """Validate the entire environment variable name when saving a key."""
        with self.assertRaisesRegex(envfile.EnvFileError, "variable name"):
            envfile.write_key(self.root, "sample-key", var="SAMPLE_KEY\n")

    def test_env_transport_key(self):
        """Reject API keys that cannot be represented as printable HTTP header text."""
        with patch.object(envfile, "preflight", return_value=[]):
            with self.assertRaisesRegex(envfile.EnvFileError, "API key"):
                envfile.write_key(self.root, "tést")
        self.assertFalse(self.path.exists())

    def test_env_flush_failure(self):
        """Keep the previous key file when a replacement cannot be flushed to disk."""
        self.path.write_text("MODEL=original\n")
        with patch.object(envfile.os, "fsync", side_effect=OSError("flush failed")):
            with self.assertRaisesRegex(OSError, "flush failed"):
                envfile._atomic_write(self.path, "MODEL=next\n")
        self.assertEqual(self.path.read_text(), "MODEL=original\n")
        self.assertEqual(list(self.root.iterdir()), [self.path])

    def test_env_private_regular_file(self):
        """Report private key-file permissions only for regular files."""
        self.path.mkdir(mode=0o700)
        self.assertFalse(envfile.permissions_ok(self.path))

    def test_forget_key(self):
        """Cover removing all assignments for a key while retaining neighboring settings."""
        self.path.write_text("export MY_KEY=first\nMY_KEY=second\nMODEL=test\n")
        self.assertTrue(envfile.forget_key(self.root, var="MY_KEY"))
        self.assertEqual(self.path.read_text(), "MODEL=test\n")
        self.assertFalse(envfile.forget_key(self.root, var="MY_KEY"))


class ProviderConfigTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.raw = {"name": "test", "base_url": "https://example.invalid/v1", "model": "local-model"}
        self.settings = Settings({}, self.root / ".env")

    def require_problem(self, field, value, text, config=llm.EndpointConfig):
        problems = []
        parsed = config({**self.raw, field: value}, "test fixture", problems)
        self.assertFalse(parsed.ok)
        self.assertIn(text, problems[0])

    def test_malformed_url(self):
        """Report malformed URLs as endpoint configuration problems."""
        self.require_problem("base_url", "https://[localhost/v1", "invalid host")

    def test_url_query_or_fragment(self):
        """Reject URL suffixes that would invalidate appended provider API paths."""
        for suffix in ("?option=yes", "#fragment"):
            with self.subTest(suffix=suffix):
                self.require_problem("base_url", self.raw["base_url"] + suffix, "query or fragment")

    def test_url_whitespace(self):
        """Validate that stored endpoint URLs contain no embedded whitespace."""
        self.require_problem("base_url", "https://example.invalid/my path", "http(s) URL")

    def test_url_zero_port(self):
        """Reject port zero and empty explicit ports in provider configuration."""
        for address in ("http://localhost:0/v1", "http://localhost:/v1"):
            with self.subTest(address=address):
                self.require_problem("base_url", address, "invalid port")

    def test_url_empty_userinfo(self):
        """Reject URL userinfo even when its username is empty."""
        self.require_problem("base_url", "https://@example.invalid/v1", "must not contain credentials")

    def test_config_name_type(self):
        """Require endpoint names to be text in hand-edited configuration."""
        self.require_problem("name", 42, "name must be")

    def test_config_model_type(self):
        """Require a provider model ID to be text."""
        self.require_problem("model", {"id": "local-model"}, "model is required")

    def test_key_env_line_break(self):
        """Validate the entire key variable name in endpoint configuration."""
        self.require_problem("api_key_env", "MODEL_KEY\n", "environment variable name")

    def test_decision_path_line_break(self):
        """Validate the entire decision API path without accepting trailing line breaks."""
        self.require_problem("path", "/v1/systemone\n", "URL paths", config=decision.DecisionConfig)

    def test_fractional_tokens(self):
        """Detect a fractional model token limit instead of truncating it."""
        self.require_problem("max_tokens", 100.5, "max_tokens")

    def test_fractional_endpoint_rate(self):
        """Detect fractional per-endpoint call rates instead of truncating them."""
        self.require_problem("rpm", 0.5, "rpm", config=decision.DecisionConfig)

    def test_extra_body_type(self):
        """Reject non-object extra request configuration even when it is empty."""
        self.require_problem("extra_body", [], "extra_body must be an object")

    def test_bad_configured_public_url(self):
        """Keep endpoint status readable when a configured URL is malformed."""
        settings = Settings({"TYPESAFE_BASE_URL": "https://[localhost"}, self.root / ".env")
        self.assertEqual(decision_setup.jev_public(client.JevClient(settings))["endpoint"], "")

    def test_deep_endpoint_file(self):
        """Report a deeply nested endpoint configuration file instead of aborting registry startup."""
        path = self.root / "llm.json"
        depth = endpoints.MAX_CONFIG_DEPTH + 1
        path.write_text("[" * depth + "]" * depth)
        settings = Settings({"JEV_FSD_LLM_ENDPOINTS": str(path)}, self.root / ".env")
        registry = llm.LlmRegistry(settings, client.SpendGuard())
        self.assertFalse(registry.endpoints)
        self.assertIn("is nested more than", registry.problems[0])

    def test_duplicate_config(self):
        """Cover first-definition precedence when endpoint names are duplicated."""
        path = self.root / "llm.json"
        path.write_text(json.dumps([self.raw, {**self.raw, "model": "second-model"}]))
        settings = Settings({"JEV_FSD_LLM_ENDPOINTS": str(path)}, self.root / ".env")
        registry = llm.LlmRegistry(settings, client.SpendGuard())
        self.assertEqual(registry.get("test").config.model, "local-model")
        self.assertIn("defined twice", registry.problems[0])

    def test_probe_cache_isolation(self):
        """Keep caller edits out of a cached endpoint status probe."""
        config = llm.EndpointConfig({**self.raw, "api_key_env": "MISSING_KEY"}, "test fixture", [])
        endpoint = llm.LlmEndpoint(config, self.settings, client.SpendGuard())
        first = endpoint.check()
        first["status"] = "changed"
        second = endpoint.check()
        self.assertEqual(second["status"], "no key")
        second["status"] = "changed again"
        self.assertEqual(endpoint.check()["status"], "no key")

    def test_probe_registry_snapshot(self):
        """Finish a batch of endpoint probes against the registry snapshot that started it."""
        registry = llm.LlmRegistry(self.settings, client.SpendGuard())
        old = Mock()
        old.check.return_value = {"name": "previous"}
        registry.endpoints = {"previous": old}
        pool = Mock()
        pool.map.side_effect = map

        def reload_during_launch():
            registry.endpoints = {"new": Mock()}
            return pool

        executor = MagicMock()
        executor.__enter__ = Mock(side_effect=reload_during_launch)
        executor.__exit__ = Mock(return_value=False)
        with patch.object(endpoints, "ThreadPoolExecutor", return_value=executor):
            self.assertEqual(registry.check_all(force=True), [{"name": "previous"}])
        old.check.assert_called_once_with(True)

    def test_large_decision_probabilities(self):
        """Discard a decision probability outside floating-point range without losing the valid choice."""
        answer = {"choice": "drive", "probabilities": {"drive": 10**500}, "confidence": 1}
        answers, invalid = decision.check_answers({"answers": {"motion": answer}}, JEV_REQUEST["questions"])
        self.assertIsNone(invalid)
        self.assertEqual(answers["motion"]["probabilities"], {})
        self.assertEqual(answers["motion"]["confidence"], 1)


class ModelSetupTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.path = self.root / "llm.json"
        self.settings = Settings({"JEV_FSD_LLM_ENDPOINTS": str(self.path)}, self.root / ".env")
        self.registry = llm.LlmRegistry(self.settings, client.SpendGuard())
        self.body = {"provider": "custom", "base_url": "http://localhost:8080/v1", "model": "local-model"}

    def test_invalid_setup_prices(self):
        """Reject numeric impostors and overflowing prices before writing model setup."""
        for value in (True, 10**500):
            with self.subTest(value=type(value)), self.assertRaisesRegex(llm_setup.SetupError, "number of USD"):
                llm_setup.save(self.settings, self.registry, {**self.body, "price_per_mtok_input": value})
        self.assertFalse(self.path.exists())

    def test_saved_entry_without_valid_name(self):
        """Allow setup to add a model alongside an ill-typed entry without discarding that entry."""
        malformed = {"name": ["previous"]}
        self.path.write_text(json.dumps({"endpoints": [malformed]}))
        saved = llm_setup.save(self.settings, self.registry, self.body)
        self.assertEqual(saved["id"], "llm:local-model")
        self.assertEqual(json.loads(self.path.read_text())["endpoints"][0], malformed)

    def test_setup_file_write_error(self):
        """Name the endpoint configuration file when its save fails."""
        with patch.object(envfile, "_atomic_write", side_effect=PermissionError(13, "Permission denied")):
            with self.assertRaisesRegex(llm_setup.SetupError, "Could not save llm.json"):
                llm_setup.save(self.settings, self.registry, self.body)
        self.assertFalse(self.registry.endpoints)

    def test_key_file_write_error(self):
        """Surface key-file write failures directly in setup without exposing the key."""
        with patch.object(envfile, "write_key", side_effect=OSError("private path")):
            with self.assertRaisesRegex(llm_setup.SetupError, "^The key file could not be read or written\\.$"):
                llm_setup.write_key(self.settings, "TEST_KEY", "example-key")

    def test_invalid_model_list_encoding(self):
        """Explain invalid model list encoding without inserting replacement characters into IDs."""
        stream = io.BytesIO(b'{"data":[{"id":"demo\xff"}]}')
        with patch.object(llm_setup._OPENER, "open", return_value=stream):
            with self.assertRaisesRegex(llm_setup.SetupError, "did not return a JSON model list"):
                llm_setup.fetch_json("https://example.invalid/models", None, "Test", 1)

    def test_duplicate_listed_models(self):
        """Show one setup option per provider model ID."""
        self.assertEqual(
            llm_setup.parse_models([{"id": "z", "name": "first"}, {"id": "A"}, {"id": "z", "name": "second"}]),
            [{"id": "A"}, {"id": "z", "name": "first"}],
        )

    def test_blank_listed_model(self):
        """Skip blank provider model IDs in setup choices."""
        self.assertEqual(llm_setup.parse_models([{"id": " "}, {"id": "model"}]), [{"id": "model"}])

    def test_invalid_listed_model_prices(self):
        """Keep models selectable when provider prices are booleans or exceed numeric range."""
        for value in (False, 10**500):
            with self.subTest(value=type(value)):
                row = {"id": "m", "pricing": {"prompt": value, "completion": "0.0"}}
                self.assertEqual(llm_setup.parse_models([row]), [{"id": "m"}])

    def test_model_catalog_credentials(self):
        """Redact a typed key from text echoed by model catalogs."""
        key = "private-fixture-key-" + "x" * 120
        payload = {"data": [{"id": "m", "name": "echo " + key}]}
        with patch.object(llm_setup, "fetch_json", return_value=payload):
            result = llm_setup.list_models(
                self.settings, {**self.body, "api_key": key, "base_url": "https://example.invalid/v1"}
            )
        self.assertEqual(result["models"], [{"id": "m", "name": "echo ***"}])

    def test_model_catalog_context_alias(self):
        """Cover the alternative provider metadata fields for display name and context window."""
        self.assertEqual(
            llm_setup.parse_models({"models": [{"id": "m", "display_name": "Example", "max_input_tokens": 12000}]}),
            [{"id": "m", "name": "Example", "context_length": 12000}],
        )


class JevClientTests(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.settings = Settings({}, root / ".env")
        self.client = client.JevClient(self.settings, api_key="fake-test-key")

    def test_unlimited_rate_tracking(self):
        """Avoid accumulating call timestamps when the server has no rate cap."""
        guard = client.SpendGuard(rpm=0)
        for _ in range(100):
            guard.check()
        self.assertFalse(guard._times)

    def test_rate_window_exact_expiry(self):
        """Release rate-limit capacity exactly one minute after a call."""
        guard = client.SpendGuard(rpm=1)
        with patch.object(client.time, "monotonic", side_effect=[0.0, 59.99, 60.0]):
            guard.check()
            with self.assertRaises(client.JevError):
                guard.check()
            guard.check()

    def test_spend_accounting_atomic(self):
        """Keep the process totals intact if result cost accounting raises."""

        class Result:
            input_tokens = 50
            output_tokens = 10

            @property
            def cost_usd(self):
                raise ValueError("bad cost")

        result = Result()
        guard = client.SpendGuard()
        before = guard.snapshot()
        with self.assertRaises(ValueError):
            guard.record(result)
        self.assertEqual(guard.snapshot(), before)

    def test_malformed_usage_object(self):
        """Treat a malformed Jev usage block as unavailable accounting metadata."""
        result = client.JevResult({}, {"usage": [1, 2]}, 1)
        self.assertEqual(result.meta()["input_tokens"], 0)
        self.assertEqual(result.meta()["output_tokens"], 0)

    def test_jev_spend_output_tokens(self):
        """Include Jev output tokens in process diagnostics."""
        with patch.object(
            self.client, "_post_system_one", return_value={"usage": {"input_tokens": 3, "output_tokens": 7}}
        ):
            self.client.system_one({}, {})
        self.assertEqual(self.client.guard.snapshot()["output_tokens"], 7)

    def test_invalid_jev_token_values(self):
        """Keep malformed Jev token counts from reducing or corrupting the spend total."""
        for invalid in (-100, True, "unknown", float("inf")):
            with self.subTest(invalid=invalid):
                result = client.JevResult({}, {"usage": {"input_tokens": invalid}}, 1)
                self.assertEqual(result.cost_usd, 0)

    def test_jev_answer_container(self):
        """Return an empty answer object for an unusable Jev answers container."""
        result = client.JevResult({}, {"answers": ["invalid"]}, 1)
        self.assertEqual(result.answers, {})

    def test_non_object_jev_reply(self):
        """Report a provider error when Jev returns JSON with the wrong top-level shape."""
        with patch.object(self.client, "_post_system_one", return_value=[]):
            with self.assertRaisesRegex(client.JevError, "JSON object"):
                self.client.system_one({}, {})

    def test_sdk_configuration_reload(self):
        """Refresh the Jev SDK client when its base URL changes with the same API key."""
        with patch.object(client, "TypeSafeClient", side_effect=lambda **kw: SimpleNamespace(**kw)) as factory:
            first = self.client._sdk_client()
            self.assertIs(self.client._sdk_client(), first)
            self.settings.environ["TYPESAFE_BASE_URL"] = "https://example.invalid"
            refreshed = self.client._sdk_client()
        self.assertEqual(refreshed.base_url, "https://example.invalid")
        self.assertIsNot(refreshed, first)
        self.assertEqual(factory.call_count, 2)

    def test_stdlib_bad_json(self):
        """Report malformed TypeSafe response JSON from the fallback transport as a provider error."""
        with patch.object(client.urllib.request, "urlopen", return_value=io.BytesIO(b"{")):
            with self.assertRaisesRegex(client.JevError, "readable JSON"):
                self.client._stdlib_request("GET", "/v1/models", None)

    def test_bounded_stdlib_retry_delay(self):
        """Bound the fallback transport's server-requested retry wait by the configured timeout."""
        retry = urllib.error.HTTPError(
            "https://example.invalid", 429, "rate limited", {"retry-after": "3600"}, io.BytesIO(b"{}")
        )
        with (
            patch.object(client.urllib.request, "urlopen", side_effect=[retry, io.BytesIO(b"{}")]),
            patch.object(client.time, "sleep") as sleep,
        ):
            _, attempts = self.client._stdlib_request("GET", "/v1/models", None)
        self.assertEqual(attempts, 2)
        sleep.assert_called_once_with(self.client.timeout)

    def test_provider_error_size(self):
        """Keep TypeSafe's nested provider error messages short enough for the UI."""
        detail = {"detail": {"message": "x" * 800}}
        message = client._error_message(422, detail)
        self.assertTrue(message.startswith("TypeSafe could not validate"))
        self.assertEqual(message.count("x"), 400)


class MapCatalogTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.path = maps.pack_path(self.root, DEFAULT_BBOX)

    def test_missing_pack_metadata(self):
        """Keep the map picker available when one cached pack is unreadable."""
        for contents in ("{", "{}", "[]"):
            with self.subTest(contents=contents):
                self.path.write_text(contents)
                catalog = maps.catalog(self.root)
                self.assertEqual(len(catalog), len(maps.MAP_CATALOG))
                self.assertFalse(catalog[0]["cached"])

    def test_replaced_map_metadata(self):
        """Refresh a map preview after atomic replacement preserves its size and timestamp."""
        pack = {
            "pack_version": maps.PACK_VERSION,
            "edges": [],
            "intersections": [],
            "stops": [],
            "buildings": [],
            "extent": [0, 0, 1, 1],
        }
        self.path.write_text(json.dumps(pack))
        self.assertEqual(maps.catalog(self.root)[0]["extent"], [0, 0, 1, 1])
        original = self.path.stat()
        replacement = self.root / "replacement"
        replacement.write_text(json.dumps({**pack, "extent": [1, 1, 2, 2]}))
        os.utime(replacement, ns=(original.st_atime_ns, original.st_mtime_ns))
        replacement.replace(self.path)
        self.assertEqual(maps.catalog(self.root)[0]["extent"], [1, 1, 2, 2])
