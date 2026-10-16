"""LLM endpoint drivers (jev/llm.py) against a mock OpenAI-compatible server. No network, no real key."""

import http.client
import json
import socket
import tempfile
import threading
import time
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import helpers  # noqa: F401  (puts the project root on sys.path)

import server
from jev import endpoints, llm, security
from jev.client import JevError, SpendGuard
from jev.config import Settings

SECRET = "sk-test-SECRET-do-not-leak-4242"
EXPECT = {"motion": ["drive", "stop"], "candidate": ["keep_lane_target", "stop_at_line", "hard_brake"]}
MESSAGES = [{"role": "system", "content": "You drive."}, {"role": "user", "content": "{\"answer\": {}}"}]


# Scheduling allowance for wall-clock deadline checks on a loaded runner. Without the deadline,
# those cases take at least 2 s with a 1 s timeout, or return an answer instead of raising.
SLACK = 0.5


def completion(content, model="mock-model", prompt_tokens=1200, completion_tokens=12):
    return {"id": "chatcmpl-1", "object": "chat.completion", "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens}}


class MockLLM:
    """A tiny OpenAI-compatible server. `reply(handler, body)` returns (status, payload, headers), or
    None when it wrote the response itself."""

    def __init__(self, reply=None):
        self.requests = []
        self.reply = reply or (lambda h, body: (200, completion('{"motion": "drive", "candidate": "keep_lane_target"}'), {}))
        mock = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def _answer(self, body):
                mock.requests.append({"method": self.command, "path": self.path, "headers": dict(self.headers), "body": body})
                out = mock.reply(self, body)
                if out is None:
                    return
                status, payload, headers = out
                data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                try:
                    self.end_headers()
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass   # the client gave up (the timeout test)

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                self._answer(json.loads(self.rfile.read(length) or b"{}"))

            def do_GET(self):
                self._answer(None)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()

    @property
    def url(self):
        return "http://127.0.0.1:%d/v1" % self.httpd.server_port

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class LlmTestCase(unittest.TestCase):
    def mock(self, reply=None):
        m = MockLLM(reply)
        self.addCleanup(m.close)
        return m

    def registry(self, endpoints, environ=None, budget=10.0, rpm=100):
        tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (tmp / "llm.json").write_text(json.dumps({"endpoints": endpoints}))
        env = {"JEV_FSD_LLM_ENDPOINTS": str(tmp / "llm.json"), **(environ or {})}
        settings = Settings(environ=env, env_file=tmp / ".env")
        return llm.LlmRegistry(settings, SpendGuard(budget, rpm))

    def decide(self, registry, name, expect=EXPECT, **extra):
        return llm.llm_decide(registry, {"endpoint": name, "tick": 3, "epoch": 1, "messages": MESSAGES, "expect": expect, **extra})


class ParseTests(unittest.TestCase):
    def test_lenient_forms(self):
        cases = [
            '{"motion": "drive", "candidate": "keep_lane_target"}',
            'Sure!\n```json\n{"Motion": "Drive", "candidate_id": "KEEP_LANE_TARGET"}\n```',
            '<think>{"candidate": "hard_brake"} hmm</think>{"motion":"drive","manoeuvre":"keep_lane_target"}',
            'I choose {"motion": "drive", "choice": "keep_lane_target", "reason": "green light"} because it is clear.',
        ]
        for text in cases:
            with self.subTest(text=text):
                answer, invalid = llm.parse_answer(text, EXPECT)
                self.assertIsNone(invalid)
                self.assertEqual((answer["motion"], answer["candidate"]), ("drive", "keep_lane_target"))

    def test_invalid_replies_name_the_reason(self):
        cases = {
            "": "empty reply",
            "drive, keep_lane_target": "not a JSON object",
            '{"motion": "drive", "candidate": "teleport"}': "not an eligible manoeuvre",
            '{"motion": "fly", "candidate": "keep_lane_target"}': "motion",
            '{"candidate": "keep_lane_target"}': "no motion",
            '{"motion": "stop"}': "no candidate",
            '{"motion": "drive", "candidate": ["keep_lane_target"]}': "not an eligible manoeuvre",
        }
        for text, reason in cases.items():
            with self.subTest(text=text):
                answer, invalid = llm.parse_answer(text, EXPECT)
                self.assertIsNone(answer)
                self.assertIn(reason, invalid)

    def test_only_asked_fields_are_required_and_bad_routes_are_ignored(self):
        answer, invalid = llm.parse_answer('{"motion": "stop", "route": "nowhere"}', {"motion": ["drive", "stop"], "route": ["r1", "r2"]})
        self.assertIsNone(invalid)
        self.assertEqual(answer, {"motion": "stop"})
        answer, _ = llm.parse_answer('{"candidate": "a", "route": "R2"}', {"candidate": ["a"], "route": ["r1", "R2"]})
        self.assertEqual(answer, {"candidate": "a", "route": "R2"})

    def test_deeply_nested_replies_are_invalid_not_errors(self):
        for text in ("[" * 10_000, '{"a": ' * 5_000, 'ok {"motion": ' + "[" * 10_000):
            with self.subTest(text=text[:20]):
                self.assertIsNone(llm.extract_json(text))
                answer, invalid = llm.parse_answer(text, EXPECT)
                self.assertIsNone(answer)
                self.assertIn("not a JSON object", invalid)

    def test_scrub_summarises_what_it_cannot_walk(self):
        deep = "x"
        for _ in range(5_000):
            deep = [deep]
        out = llm.scrub({"a": ["key %s" % SECRET], "deep": deep}, SECRET)
        self.assertEqual(out["a"], ["key ***"])
        inner = out["deep"]
        for _ in range(llm.MAX_SCRUB_DEPTH - 1):
            inner = inner[0]
        self.assertIn("not shown", inner)

    def test_structured_output_schema_lists_the_offered_ids(self):
        fmt = llm.response_format_for("json_schema", EXPECT)
        schema = fmt["json_schema"]["schema"]
        self.assertEqual(schema["properties"]["candidate"]["enum"], EXPECT["candidate"])
        self.assertEqual(schema["required"], ["motion", "candidate"])
        self.assertEqual(llm.response_format_for("json_object", EXPECT), {"type": "json_object"})
        self.assertIsNone(llm.response_format_for("none", EXPECT))


class ConfigTests(LlmTestCase):
    def test_file_and_environment_endpoints(self):
        reg = self.registry([
            {"name": "cloud", "base_url": "https://api.example.com/v1/", "model": "m1", "api_key_env": "CLOUD_KEY",
             "price_per_mtok_input": 1, "price_per_mtok_output": 2},
            {"name": "nokey", "base_url": "https://api.example.com/v1", "model": "m2", "api_key_env": "MISSING_KEY"},
            {"name": "local", "base_url": "http://localhost:11434/v1", "model": "llama3.2"},
            {"name": "Bad Name", "base_url": "https://x.example/v1", "model": "m"},
            {"name": "ftp", "base_url": "ftp://x.example", "model": "m"},
            {"name": "badport", "base_url": "https://x.example:notaport/v1", "model": "m"},
            {"name": "cloud", "base_url": "https://dup.example/v1", "model": "m"},
        ], environ={"CLOUD_KEY": SECRET, "JEV_FSD_LLM_BASE_URL": "http://127.0.0.1:1234/v1", "JEV_FSD_LLM_MODEL": "qwen"})
        public = reg.public()
        by_name = {e["name"]: e for e in public["endpoints"]}
        self.assertEqual(list(by_name), ["cloud", "nokey", "local", "default"])
        self.assertEqual(by_name["cloud"]["id"], "llm:cloud")
        self.assertEqual(by_name["cloud"]["key"], "set")
        self.assertEqual(by_name["cloud"]["endpoint"], "https://api.example.com/v1")
        self.assertTrue(by_name["cloud"]["priced"])
        self.assertEqual((by_name["nokey"]["key"], by_name["nokey"]["usable"], by_name["nokey"]["status"]), ("missing", False, "no key"))
        self.assertEqual(by_name["local"]["key"], "not needed")
        self.assertTrue(by_name["local"]["local"])
        self.assertFalse(by_name["local"]["priced"])
        self.assertEqual(by_name["default"]["model"], "qwen")
        problems = " ".join(public["problems"])
        for fragment in ("name must be", "http(s)", "invalid port", "defined twice"):
            self.assertIn(fragment, problems)
        self.assertNotIn(SECRET, json.dumps(public))

    def test_keys_in_the_endpoint_entry_are_rejected_without_echoing_them(self):
        # Checked on the entry directly so the test never writes a key-shaped value to disk.
        for raw, fragment in (({"name": "leaky", "base_url": "https://x.example/v1", "model": "m", "api_key": SECRET}, "do not put keys"),
                              ({"name": "creds", "base_url": "https://user:%s@x.example/v1" % SECRET, "model": "m"}, "credentials")):
            problems = []
            self.assertFalse(llm.EndpointConfig(raw, "endpoint 1", problems).ok)
            self.assertIn(fragment, " ".join(problems))
            self.assertNotIn(SECRET, " ".join(problems))

    def test_keys_are_only_sent_over_https_or_to_local_servers(self):
        for url, ok in (("http://api.example.com/v1", False), ("https://api.example.com/v1", True),
                        ("http://127.0.0.1:8000/v1", True), ("http://192.168.1.20:1234/v1", True)):
            problems = []
            cfg = llm.EndpointConfig({"name": "e", "base_url": url, "model": "m", "api_key_env": "K"}, "endpoint 1", problems)
            self.assertEqual(cfg.ok, ok, (url, problems))
            if not ok:
                self.assertIn("https://", " ".join(problems))
        self.assertTrue(llm.EndpointConfig({"name": "e", "base_url": "http://api.example.com/v1", "model": "m"}, "endpoint 1", []).ok)

    def test_non_finite_numbers_are_config_problems(self):
        fields = ("timeout_s", "max_tokens", "temperature", "rpm", "price_per_mtok_input", "price_per_mtok_output")
        for field in fields:
            for value in (float("inf"), float("-inf"), float("nan"), 10 ** 400):
                with self.subTest(field=field, value=str(value)[:8]):
                    problems = []
                    raw = {"name": "e", "base_url": "http://localhost:1234/v1", "model": "m", field: value}
                    cfg = llm.EndpointConfig(raw, "endpoint 1", problems)
                    self.assertIn(field, " ".join(problems))
                    self.assertTrue("finite" in " ".join(problems) or "must be a number" in " ".join(problems))
                    if cfg.ok:   # a bad price is dropped with a problem; the endpoint stays usable, unpriced
                        self.assertIsNone(getattr(cfg, field.replace("price_per_mtok_input", "price_in").replace("price_per_mtok_output", "price_out")))
        # JSON's Infinity and NaN in the file: the registry still builds and its status is valid JSON.
        reg = self.registry([{"name": "a", "base_url": "http://localhost:1234/v1", "model": "m", "rpm": float("inf")},
                             {"name": "b", "base_url": "http://localhost:1234/v1", "model": "m", "price_per_mtok_input": float("inf")}])
        public = reg.public()
        json.dumps(public, allow_nan=False)
        self.assertEqual([e["name"] for e in public["endpoints"]], ["b"])
        self.assertEqual(len(public["problems"]), 2)

    def test_missing_or_broken_file_is_not_fatal(self):
        settings = Settings(environ={"JEV_FSD_LLM_ENDPOINTS": "/nonexistent/llm.json"}, env_file=Path("/nonexistent/.env"))
        reg = llm.LlmRegistry(settings, SpendGuard())
        self.assertEqual((reg.public()["endpoints"], reg.problems), ([], []))
        tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (tmp / "llm.json").write_text("{not json")
        settings = Settings(environ={"JEV_FSD_LLM_ENDPOINTS": str(tmp / "llm.json")}, env_file=tmp / ".env")
        self.assertIn("could not be read", llm.LlmRegistry(settings, SpendGuard()).problems[0])


class EndpointTests(LlmTestCase):
    def test_success_sends_schema_and_reports_tokens_and_cost(self):
        mock = self.mock()
        reg = self.registry([{"name": "a", "base_url": mock.url, "model": "mock-model", "api_key_env": "A_KEY",
                              "price_per_mtok_input": 2.0, "price_per_mtok_output": 8.0}], environ={"A_KEY": SECRET})
        out = self.decide(reg, "a")
        self.assertEqual(out["answer"], {"motion": "drive", "candidate": "keep_lane_target"})
        self.assertIsNone(out["invalid"])
        meta = out["meta"]
        self.assertEqual((meta["source"], meta["input_tokens"], meta["output_tokens"]), ("llm:a", 1200, 12))
        self.assertAlmostEqual(meta["cost_usd"], (1200 * 2.0 + 12 * 8.0) / 1e6)
        self.assertTrue(meta["cost_known"] and meta["live_call"])
        sent = mock.requests[0]
        self.assertEqual(sent["path"], "/v1/chat/completions")
        self.assertEqual(sent["headers"]["Authorization"], "Bearer " + SECRET)
        self.assertEqual(sent["body"]["model"], "mock-model")
        self.assertEqual(sent["body"]["messages"], MESSAGES)
        self.assertEqual(sent["body"]["response_format"]["json_schema"]["schema"]["properties"]["candidate"]["enum"], EXPECT["candidate"])
        self.assertEqual(reg.guard.snapshot()["live_calls"], 1)
        self.assertEqual(reg.guard.snapshot()["output_tokens"], 12)
        self.assertNotIn(SECRET, json.dumps(out))

    def test_local_endpoint_sends_no_authorization_and_unpriced_cost_is_unknown(self):
        mock = self.mock()
        reg = self.registry([{"name": "local", "base_url": mock.url, "model": "llama3.2", "response_format": "json_object"}])
        out = self.decide(reg, "local")
        self.assertNotIn("Authorization", mock.requests[0]["headers"])
        self.assertEqual(mock.requests[0]["body"]["response_format"], {"type": "json_object"})
        self.assertEqual(out["meta"]["cost_usd"], 0)
        self.assertFalse(out["meta"]["cost_known"])

    def test_malformed_model_output_is_an_invalid_answer_with_spend_recorded(self):
        for content, reason in (("I would keep driving.", "not a JSON object"), ('{"motion": "drive", "candidate": "teleport"}', "teleport")):
            with self.subTest(content=content):
                mock = self.mock(lambda h, body, c=content: (200, completion(c), {}))
                reg = self.registry([{"name": "m", "base_url": mock.url, "model": "x"}])
                out = self.decide(reg, "m")
                self.assertIsNone(out["answer"])
                self.assertIn(reason, out["invalid"])
                self.assertEqual(out["meta"]["invalid"], out["invalid"])
                self.assertEqual(out["meta"]["input_tokens"], 1200)
                self.assertEqual(out["content"], content)
                self.assertEqual(out["trace"]["response"]["choices"][0]["message"]["content"], content)

    def test_non_json_reply_is_an_error(self):
        reply = lambda h, body: (200, b"<html>gateway</html>", {"Content-Type": "text/html"})  # noqa: E731
        reg = self.registry([{"name": "m", "base_url": self.mock(reply).url, "model": "x"}])
        with self.assertRaises(llm.LlmError) as ctx:
            self.decide(reg, "m")
        self.assertEqual(ctx.exception.status, 502)
        self.assertIn("not JSON", str(ctx.exception))

    def test_completion_without_a_message_is_invalid_and_its_usage_still_counts(self):
        envelopes = {
            "no choices": {"object": "chat.completion", "choices": [], "usage": {"prompt_tokens": 900, "completion_tokens": 4}},
            "no message": {"choices": [{"index": 0}], "usage": {"prompt_tokens": 900, "completion_tokens": 4}},
        }
        for reason, envelope in envelopes.items():
            with self.subTest(reason=reason):
                mock = self.mock(lambda h, body, e=envelope: (200, e, {}))
                reg = self.registry([{"name": "m", "base_url": mock.url, "model": "x", "price_per_mtok_input": 10}])
                out = self.decide(reg, "m")
                self.assertIsNone(out["answer"])
                self.assertEqual(out["invalid"], "malformed completion (%s)" % reason)
                meta = out["meta"]
                self.assertEqual((meta["input_tokens"], meta["output_tokens"], meta["live_call"]), (900, 4, True))
                self.assertAlmostEqual(meta["cost_usd"], 900 * 10 / 1e6)
                snap = reg.guard.snapshot()
                self.assertEqual((snap["live_calls"], snap["input_tokens"], snap["output_tokens"]), (1, 900, 4))
                stats = reg.public()["endpoints"][0]
                self.assertEqual((stats["calls"], stats["errors"], stats["input_tokens"]), (1, 1, 900))
                self.assertIn("malformed completion", stats["last_error"])

    def test_non_finite_usage_counts_as_zero_and_keeps_the_rest(self):
        content = json.dumps('{"motion": "drive", "candidate": "keep_lane_target"}')
        for usage in ('{"prompt_tokens": Infinity, "completion_tokens": 7}', '{"prompt_tokens": NaN, "completion_tokens": 7}',
                      '{"prompt_tokens": 1e400, "completion_tokens": 7}', '{"prompt_tokens": -Infinity, "completion_tokens": 7}'):
            with self.subTest(usage=usage):
                raw = ('{"model": "x", "choices": [{"message": {"role": "assistant", "content": %s}}], "usage": %s}'
                       % (content, usage)).encode()
                reg = self.registry([{"name": "m", "base_url": self.mock(lambda h, body, r=raw: (200, r, {})).url,
                                      "model": "x", "price_per_mtok_input": 1, "price_per_mtok_output": 1}])
                out = self.decide(reg, "m")
                self.assertEqual(out["answer"]["candidate"], "keep_lane_target")
                self.assertEqual((out["meta"]["input_tokens"], out["meta"]["output_tokens"]), (0, 7))
                self.assertAlmostEqual(out["meta"]["cost_usd"], 7 / 1e6)
                json.dumps(out, allow_nan=False)
                snap = reg.guard.snapshot()
                self.assertEqual((snap["live_calls"], snap["output_tokens"]), (1, 7))

    def test_deeply_nested_replies_are_invalid_answers_with_meta(self):
        # 600 levels parse on every supported Python; see the next test for replies too deep to parse.
        usage = '"usage": {"prompt_tokens": 1200, "completion_tokens": 12}'
        good = json.dumps('{"motion": "drive", "candidate": "keep_lane_target"}')
        replies = {
            "nested list text": json.dumps(completion("[" * 10_000)),
            "nested object text": json.dumps(completion('{"a": ' * 3_900)),
            "nested content value": '{"choices": [{"message": {"content": %s1%s}}], %s}' % ('{"a": ' * 600, "}" * 600, usage),
            "nested envelope": '{"choices": [{"message": {"content": %s}}], "extra": %s0%s, %s}' % (good, "[" * 600, "]" * 600, usage),
        }
        for name, data in replies.items():
            with self.subTest(name=name):
                mock = self.mock(lambda h, body, d=data.encode(): (200, d, {}))
                reg = self.registry([{"name": "m", "base_url": mock.url, "model": "x", "api_key_env": "K"}], environ={"K": SECRET})
                out = self.decide(reg, "m")
                json.dumps(out)
                self.assertEqual((out["meta"]["input_tokens"], out["meta"]["output_tokens"]), (1200, 12))
                self.assertEqual(reg.guard.snapshot()["live_calls"], 1)
                if name == "nested envelope":   # usable answer; the trace summarises the absurd envelope
                    self.assertEqual(out["answer"]["candidate"], "keep_lane_target")
                    self.assertIn("not shown", out["trace"]["response"]["note"])
                else:
                    self.assertIsNone(out["answer"])
                    self.assertTrue(out["invalid"])

    def test_a_reply_too_deep_to_parse_is_a_counted_malformed_completion(self):
        # Every supported Python's parser gives up long before 100,000 levels (3.11 near 1,000).
        good = json.dumps('{"motion": "drive", "candidate": "keep_lane_target"}')
        replies = {
            "content value": '{"choices": [{"message": {"content": %s1%s}}]}' % ('{"a": ' * 100_000, "}" * 100_000),
            "envelope": '{"choices": [{"message": {"content": %s}}], "extra": %s0%s}' % (good, "[" * 100_000, "]" * 100_000),
        }
        for name, data in replies.items():
            with self.subTest(name=name):
                mock = self.mock(lambda h, body, d=data.encode(): (200, d, {}))
                reg = self.registry([{"name": "m", "base_url": mock.url, "model": "x", "api_key_env": "K",
                                      "price_per_mtok_input": 1}], environ={"K": SECRET})
                out = self.decide(reg, "m")
                json.dumps(out)
                self.assertIsNone(out["answer"])
                self.assertEqual(out["invalid"], "malformed completion (nested too deeply to parse)")
                meta = out["meta"]
                self.assertEqual((meta["input_tokens"], meta["output_tokens"], meta["cost_usd"], meta["live_call"]), (0, 0, 0, True))
                self.assertIn("not shown", out["trace"]["response"]["note"])
                self.assertEqual(reg.guard.snapshot()["live_calls"], 1)
                stats = reg.public()["endpoints"][0]
                self.assertEqual((stats["calls"], stats["errors"]), (1, 1))
                self.assertIn("malformed completion", stats["last_error"])

    def test_deeply_nested_error_bodies_are_quoted_as_text(self):
        bodies = ("[" * 900 + json.dumps("key %s" % SECRET) + "]" * 900,
                  '{"error": ' * 300 + json.dumps("key %s" % SECRET) + "}" * 300)
        for data in bodies:
            with self.subTest(data=data[:12]):
                mock = self.mock(lambda h, body, d=data.encode(): (500, d, {}))
                reg = self.registry([{"name": "m", "base_url": mock.url, "model": "x", "api_key_env": "K",
                                      "response_format": "none"}], environ={"K": SECRET})
                with self.assertRaises(llm.LlmError) as ctx:
                    self.decide(reg, "m")
                self.assertEqual(ctx.exception.status, 502)
                self.assertIn("HTTP 500", str(ctx.exception))
                self.assertIsInstance(ctx.exception.body, str)
                self.assertNotIn(SECRET, str(ctx.exception) + ctx.exception.body + json.dumps(reg.public()))

    def test_http_errors_map_to_statuses(self):
        cases = [(429, 429, "rate limited"), (500, 502, "HTTP 500"), (503, 502, "HTTP 503"), (401, 401, "rejected the API key")]
        for upstream, expected, text in cases:
            with self.subTest(upstream=upstream):
                mock = self.mock(lambda h, body, s=upstream: (s, {"error": {"message": "Incorrect API key provided: %s" % SECRET}}, {}))
                reg = self.registry([{"name": "m", "base_url": mock.url, "model": "x", "api_key_env": "K", "response_format": "none"}],
                                    environ={"K": SECRET})
                with self.assertRaises(llm.LlmError) as ctx:
                    self.decide(reg, "m")
                self.assertEqual(ctx.exception.status, expected)
                self.assertIn(text, str(ctx.exception))
                self.assertNotIn(SECRET, str(ctx.exception))
                self.assertNotIn(SECRET, json.dumps(ctx.exception.body))
                self.assertEqual(len(mock.requests), 1)   # no retries inside a decision deadline
                self.assertNotIn(SECRET, json.dumps(reg.public()))
                self.assertTrue(ctx.exception.__context__.fp.closed)   # the error response is not left open

    def test_timeout(self):
        def slow(h, body):
            time.sleep(1.6)
            return 200, completion('{"motion": "drive", "candidate": "keep_lane_target"}'), {}
        reg = self.registry([{"name": "slow", "base_url": self.mock(slow).url, "model": "x", "timeout_s": 1}])
        started = time.monotonic()
        with self.assertRaises(llm.LlmError) as ctx:
            self.decide(reg, "slow")
        self.assertEqual(ctx.exception.status, 504)
        self.assertIn("timeout", str(ctx.exception))
        self.assertLess(time.monotonic() - started, 1.5)

    def test_missing_key_makes_no_call(self):
        mock = self.mock()
        reg = self.registry([{"name": "k", "base_url": mock.url, "model": "x", "api_key_env": "NOT_SET_KEY"}])
        with self.assertRaises(llm.LlmError) as ctx:
            self.decide(reg, "k")
        self.assertEqual(ctx.exception.status, 401)
        self.assertIn("NOT_SET_KEY", str(ctx.exception))
        self.assertEqual(mock.requests, [])
        self.assertEqual(reg.endpoints["k"].check()["status"], "no key")

    def test_budget_cap_and_rate_limit_are_shared(self):
        mock = self.mock()
        # 1200 input tokens at $1000 per million: $1.20 per call against a $1 budget.
        reg = self.registry([{"name": "a", "base_url": mock.url, "model": "x", "price_per_mtok_input": 1000},
                             {"name": "b", "base_url": mock.url, "model": "y"}], budget=1.0)
        self.decide(reg, "a")
        for name in ("a", "b"):
            with self.assertRaises(JevError) as ctx:
                self.decide(reg, name)
            self.assertEqual(ctx.exception.status, 402)
        self.assertEqual(len(mock.requests), 1)
        reg = self.registry([{"name": "a", "base_url": mock.url, "model": "x"}], rpm=2)
        self.decide(reg, "a")
        self.decide(reg, "a")
        with self.assertRaises(JevError) as ctx:
            self.decide(reg, "a")
        self.assertEqual(ctx.exception.status, 429)

    def test_endpoint_rpm_replaces_the_shared_rate_limit_but_not_the_budget(self):
        mock = self.mock()
        reg = self.registry([{"name": "fast", "base_url": mock.url, "model": "x", "rpm": 0, "price_per_mtok_input": 100},
                             {"name": "own", "base_url": mock.url, "model": "y", "rpm": 1}], budget=1.0, rpm=1)
        for _ in range(5):   # 5 x 1200 tokens x $100/M = $0.60, under the $1 budget, over the shared rpm of 1
            self.decide(reg, "fast")
        self.decide(reg, "own")
        with self.assertRaises(JevError) as ctx:
            self.decide(reg, "own")
        self.assertEqual(ctx.exception.status, 429)
        self.assertEqual(reg.public()["endpoints"][0]["rpm"], 0)
        for _ in range(4):   # $0.72, $0.84, $0.96, then $1.08: the next call is refused by the shared budget
            self.decide(reg, "fast")
        with self.assertRaises(JevError) as ctx:
            self.decide(reg, "fast")
        self.assertEqual(ctx.exception.status, 402)

    def test_multiple_endpoints_reach_their_own_servers(self):
        one = self.mock(lambda h, body: (200, completion('{"motion":"drive","candidate":"keep_lane_target"}', model=body["model"]), {}))
        two = self.mock(lambda h, body: (200, completion('{"motion":"stop","candidate":"stop_at_line"}', model=body["model"]), {}))
        reg = self.registry([{"name": "one", "base_url": one.url, "model": "model-one", "api_key_env": "ONE"},
                             {"name": "two", "base_url": two.url, "model": "model-two", "api_key_env": "TWO"}],
                            environ={"ONE": "key-one", "TWO": "key-two"})
        a, b = self.decide(reg, "one"), self.decide(reg, "two")
        self.assertEqual((a["answer"]["candidate"], a["meta"]["model"]), ("keep_lane_target", "model-one"))
        self.assertEqual((b["answer"]["motion"], b["meta"]["model"]), ("stop", "model-two"))
        self.assertEqual(one.requests[0]["headers"]["Authorization"], "Bearer key-one")
        self.assertEqual(two.requests[0]["headers"]["Authorization"], "Bearer key-two")
        self.assertEqual((len(one.requests), len(two.requests)), (1, 1))
        with self.assertRaises(llm.InvalidLlmRequest):
            self.decide(reg, "three")

    def test_structured_output_downgrades_once_when_unsupported(self):
        def picky(h, body):
            if "response_format" in body:
                return 400, {"error": {"message": "response_format is not supported"}}, {}
            return 200, completion('{"motion": "drive", "candidate": "keep_lane_target"}'), {}
        mock = self.mock(picky)
        reg = self.registry([{"name": "p", "base_url": mock.url, "model": "x"}])
        out = self.decide(reg, "p")
        self.assertEqual(out["meta"]["response_format"], "none")
        self.assertEqual(out["answer"]["candidate"], "keep_lane_target")
        self.decide(reg, "p")
        self.assertEqual(["response_format" in r["body"] for r in mock.requests], [True, False, False])

    def test_a_request_refused_in_both_modes_keeps_its_response_format(self):
        for code in (400, 422):
            with self.subTest(code=code):
                mock = self.mock(lambda h, body, c=code: (c, {"error": {"message": "model 'nope' does not exist"}}, {}))
                reg = self.registry([{"name": "p", "base_url": mock.url, "model": "nope"}])
                with self.assertRaises(llm.LlmError) as ctx:
                    self.decide(reg, "p")
                self.assertEqual(ctx.exception.status, 502)
                self.assertIn("does not exist", str(ctx.exception))
                self.assertEqual(["response_format" in r["body"] for r in mock.requests], [True, False])
                self.assertEqual(reg.public()["endpoints"][0]["response_format"], "json_schema")

    def test_the_plain_retry_shares_one_deadline(self):
        def slow_picky(h, body):
            if "response_format" in body:
                time.sleep(0.3)
                return 400, {"error": {"message": "response_format is not supported"}}, {}
            time.sleep(1.0)
            return 200, completion('{"motion": "drive", "candidate": "keep_lane_target"}'), {}
        mock = self.mock(slow_picky)
        reg = self.registry([{"name": "p", "base_url": mock.url, "model": "x", "timeout_s": 1.2}])
        started = time.monotonic()
        with self.assertRaises(llm.LlmError) as ctx:
            self.decide(reg, "p")
        self.assertLess(time.monotonic() - started, 1.2 + SLACK)   # 1.3 s of replies, cut at 1.2 s
        self.assertEqual(ctx.exception.status, 504)
        self.assertIn("no reply within 1.2 s", str(ctx.exception))
        self.assertEqual(len(mock.requests), 2)

    def test_no_retry_without_time_for_it_but_plain_mode_is_remembered(self):
        def slow_picky(h, body):
            if "response_format" in body:
                time.sleep(0.6)
                return 400, {"error": {"message": "response_format is not supported"}}, {}
            return 200, completion('{"motion": "drive", "candidate": "keep_lane_target"}'), {}
        mock = self.mock(slow_picky)
        reg = self.registry([{"name": "p", "base_url": mock.url, "model": "x", "timeout_s": 1}])
        with self.assertRaises(llm.LlmError) as ctx:   # 0.4 s left is less than 1.5 x 0.6 s
            self.decide(reg, "p")
        self.assertEqual(ctx.exception.status, 502)
        self.assertIn("rejected response_format json_schema", str(ctx.exception))
        self.assertEqual(len(mock.requests), 1)
        self.assertEqual(reg.public()["endpoints"][0]["response_format"], "none")
        self.assertEqual(self.decide(reg, "p")["answer"]["candidate"], "keep_lane_target")
        self.assertEqual(["response_format" in r["body"] for r in mock.requests], [True, False])

    def test_every_attempt_passes_the_rate_limit(self):
        def picky(h, body):
            if "response_format" in body:
                return 400, {"error": {"message": "response_format is not supported"}}, {}
            return 200, completion('{"motion": "drive", "candidate": "keep_lane_target"}'), {}
        mock = self.mock(picky)
        reg = self.registry([{"name": "p", "base_url": mock.url, "model": "x", "rpm": 1}])
        with self.assertRaises(JevError) as ctx:
            self.decide(reg, "p")
        self.assertEqual(ctx.exception.status, 429)
        self.assertEqual(len(mock.requests), 1)
        self.assertEqual(reg.public()["endpoints"][0]["response_format"], "none")

    def test_a_trickled_reply_cannot_outlast_the_deadline(self):
        def trickle(h, body):
            data = json.dumps(completion('{"motion": "drive", "candidate": "keep_lane_target"}')).encode()
            try:
                h.send_response(200)
                h.send_header("Content-Length", str(len(data)))
                h.end_headers()
                for i in range(0, len(data), 8):   # each read arrives well inside the socket timeout
                    h.wfile.write(data[i:i + 8])
                    h.wfile.flush()
                    time.sleep(0.1)
            except OSError:
                pass   # the client gave up
        reg = self.registry([{"name": "t", "base_url": self.mock(trickle).url, "model": "x", "timeout_s": 1}])
        started = time.monotonic()
        with self.assertRaises(llm.LlmError) as ctx:
            self.decide(reg, "t")
        self.assertEqual(ctx.exception.status, 504)
        self.assertLess(time.monotonic() - started, 1 + SLACK)
        self.assertEqual(reg.guard.snapshot()["live_calls"], 0)

    def stalling_proxy(self, tunnel_after=None):
        """A local HTTPS proxy that trickles its CONNECT reply a header line at a time. With
        `tunnel_after` it opens the tunnel after that many seconds and then never answers the TLS
        handshake. Either way it gives up after 3 s, so a regression fails rather than hangs."""
        listener = socket.create_server(("127.0.0.1", 0))
        listener.settimeout(5)

        def serve():
            try:
                conn, _ = listener.accept()
            except OSError:
                return
            with conn:
                try:
                    conn.recv(4096)   # the CONNECT request
                    conn.sendall(b"HTTP/1.1 200 Connection established\r\n")
                    started = time.monotonic()
                    while time.monotonic() - started < 3:
                        if tunnel_after is not None and time.monotonic() - started >= tunnel_after:
                            conn.sendall(b"\r\n")
                            time.sleep(3)   # the client's TLS hello goes unanswered
                            return
                        conn.sendall(b"X-Wait: 1\r\n")
                        time.sleep(0.1)
                except OSError:
                    pass   # the client gave up
        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        self.addCleanup(listener.close)
        return "http://127.0.0.1:%d" % listener.getsockname()[1]

    def test_the_deadline_covers_the_proxy_tunnel_and_tls_handshake(self):
        for name, tunnel_after in (("trickled CONNECT reply", None), ("stalled TLS handshake", 0.5)):
            with self.subTest(name=name):
                proxy = urllib.request.ProxyHandler({"https": self.stalling_proxy(tunnel_after)})
                self.enterContext(patch.object(endpoints, "_OPENER", urllib.request.build_opener(
                    proxy, endpoints._NoRedirect, endpoints._HTTPHandler, endpoints._HTTPSHandler)))
                reg = self.registry([{"name": "t", "base_url": "https://llm.example.com/v1", "model": "x", "timeout_s": 1}])
                started = time.monotonic()
                with self.assertRaises(llm.LlmError) as ctx:
                    self.decide(reg, "t")
                self.assertEqual(ctx.exception.status, 504)
                self.assertLess(time.monotonic() - started, 1 + SLACK)

    def test_each_address_gets_only_the_rest_of_the_deadline(self):
        # socket.create_connection gives every resolved address the full timeout, so two unreachable
        # addresses took twice timeout_s. Each attempt now gets only what is left.
        attempts = []

        class Unreachable:
            def __init__(self, *args):
                self.timeout = None

            def settimeout(self, value):
                self.timeout = value

            def connect(self, address):
                attempts.append(self.timeout)
                time.sleep(self.timeout)
                raise socket.timeout("timed out")

            def close(self):
                pass
        addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.%d" % i, 443)) for i in (1, 2)]
        self.enterContext(patch.object(endpoints, "_resolve", lambda host, port: addresses))
        self.enterContext(patch.object(endpoints, "_open_socket", Unreachable))
        reg = self.registry([{"name": "t", "base_url": "https://llm.example.com/v1", "model": "x", "timeout_s": 1}])
        started = time.monotonic()
        with self.assertRaises(llm.LlmError) as ctx:
            self.decide(reg, "t")
        self.assertEqual(ctx.exception.status, 504)
        self.assertLess(time.monotonic() - started, 1 + SLACK)
        self.assertLessEqual(len(attempts), 2)
        self.assertLess(sum(attempts), 1.05)

    def test_an_unsupported_address_family_falls_through_to_the_next(self):
        # As socket.create_connection does: an IPv6 address this machine cannot open is skipped.
        mock = self.mock()
        port = int(mock.url.rsplit(":", 1)[1].split("/")[0])
        addresses = [(socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::1", port, 0, 0)),
                     (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))]

        def open_socket(family, kind, proto):
            if family == socket.AF_INET6:
                raise OSError(97, "Address family not supported by protocol")
            return socket.socket(family, kind, proto)
        self.enterContext(patch.object(endpoints, "_resolve", lambda host, port: addresses))
        self.enterContext(patch.object(endpoints, "_open_socket", open_socket))
        reg = self.registry([{"name": "m", "base_url": mock.url, "model": "x", "response_format": "none"}])
        self.assertEqual(self.decide(reg, "m")["answer"]["candidate"], "keep_lane_target")

    def test_a_cancelled_watchdog_never_fires(self):
        # The timer callback can already be waiting for the lock when cancel() runs; it must then do nothing.
        a, b = socket.socketpair()
        self.addCleanup(a.close)
        self.addCleanup(b.close)
        watchdog = endpoints._Watchdog(time.monotonic() + 60)
        watchdog.attach(a)
        self.assertFalse(watchdog.cancel())
        watchdog._expire()
        self.assertFalse(watchdog.expired)
        b.sendall(b"still open")
        self.assertEqual(a.recv(16), b"still open")
        fired = endpoints._Watchdog(time.monotonic())
        time.sleep(0.05)
        self.assertTrue(fired.cancel())

    def test_redirects_are_not_followed_with_the_key(self):
        target = self.mock()
        source = self.mock(lambda h, body: (307, b"", {"Location": target.url + "/chat/completions"}))
        reg = self.registry([{"name": "r", "base_url": source.url, "model": "x", "api_key_env": "K", "response_format": "none"}],
                            environ={"K": SECRET})
        with self.assertRaises(llm.LlmError) as ctx:
            self.decide(reg, "r")
        self.assertIn("redirected", str(ctx.exception))
        self.assertEqual(target.requests, [])

    def test_check_reports_a_redirect_as_unreachable(self):
        target = self.mock(lambda h, body: (200, {"data": []}, {}))
        source = self.mock(lambda h, body: (301, b"", {"Location": target.url + "/models"}))
        reg = self.registry([{"name": "r", "base_url": source.url, "model": "x"}])
        out = reg.endpoints["r"].check()
        self.assertEqual((out["status"], out["reachable"]), ("unreachable", False))
        self.assertIn("redirected", out["detail"])
        self.assertEqual(target.requests, [])

    def test_quoted_reply_fields_are_scrubbed(self):
        for reply in ('{"motion": "drive", "candidate": "%s"}' % SECRET,
                      '{"motion": "drive", "candidate": "keep_lane_target", "reason": "key is %s"}' % SECRET):
            mock = self.mock(lambda h, body, reply=reply: (200, completion(reply), {}))
            reg = self.registry([{"name": "m", "base_url": mock.url, "model": "x", "api_key_env": "K", "response_format": "none"}],
                                environ={"K": SECRET})
            self.assertNotIn(SECRET, json.dumps(self.decide(reg, "m")))

    def test_check_reports_reachability_without_spend(self):
        up = self.mock(lambda h, body: (200, {"data": [{"id": "x"}]}, {}))
        down = MockLLM()
        down_url = down.url
        down.close()
        reg = self.registry([{"name": "up", "base_url": up.url, "model": "x"}, {"name": "down", "base_url": down_url, "model": "x"}])
        statuses = {s["name"]: s["status"] for s in reg.check_all()}
        self.assertEqual(statuses, {"up": "ready", "down": "unreachable"})
        self.assertEqual(up.requests[0]["path"], "/v1/models")
        self.assertEqual(reg.guard.snapshot()["live_calls"], 0)

    def test_request_validation(self):
        reg = self.registry([{"name": "a", "base_url": "http://127.0.0.1:9/v1", "model": "x"}])
        bad = [
            {"messages": "hi", "expect": EXPECT},
            {"messages": [{"role": "tool", "content": "x"}], "expect": EXPECT},
            {"messages": [{"role": "user", "content": "x" * (llm.MAX_PROMPT_CHARS + 1)}], "expect": EXPECT},
            {"messages": MESSAGES, "expect": {}},
            {"messages": MESSAGES, "expect": {"motion": ["teleport"]}},
            {"messages": MESSAGES, "expect": {"candidate": ["bad id with spaces"]}},
            {"messages": MESSAGES, "expect": EXPECT, "tick": "3"},
        ]
        for body in bad:
            with self.subTest(body=str(body)[:80]), self.assertRaises(llm.InvalidLlmRequest):
                llm.llm_decide(reg, {"endpoint": "a", **body})


class ServerRouteTests(LlmTestCase):
    """The browser-facing routes: same security checks as Jev, and the key never leaves the server."""

    def setUp(self):
        self.upstream = self.mock(lambda h, body: (
            (200, {"data": []}, {}) if body is None else
            (200, completion('{"motion": "drive", "candidate": "keep_lane_target", "note": "%s"}' % SECRET), {})))
        registry = self.registry([
            {"name": "mock", "base_url": self.upstream.url, "model": "mock-model", "api_key_env": "MOCK_KEY"},
            {"name": "broken", "base_url": self.mock(lambda h, body: (401, {"error": {"message": "bad key %s" % SECRET}}, {})).url,
             "model": "m", "api_key_env": "MOCK_KEY", "response_format": "none"},
        ], environ={"MOCK_KEY": SECRET})
        self.enterContext(patch.object(server, "llm_registry", registry))

        class QuietHandler(server.Handler):
            def log_message(self, _fmt, *_args):
                pass

        self.httpd = server.LocalServer(("127.0.0.1", 0), QuietHandler)
        QuietHandler.port = self.httpd.server_port
        thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)

    def request(self, method, path, body=None, token=True, extra=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=5)
        headers = {"Host": "127.0.0.1:%d" % self.httpd.server_port, "Content-Type": "application/json"}
        if token:
            headers[security.TOKEN_HEADER] = server.SESSION_TOKEN
        headers.update(extra or {})
        try:
            conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
            resp = conn.getresponse()
            return resp.status, resp.read()
        finally:
            conn.close()

    def decide_body(self, name="mock", **extra):
        return {"endpoint": name, "tick": 1, "epoch": 0, "messages": MESSAGES, "expect": EXPECT, **extra}

    def test_decide_route_and_the_key_never_reaches_the_browser(self):
        responses = []
        status, raw = self.request("POST", "/api/llm/decide", self.decide_body())
        self.assertEqual(status, 200)
        responses.append(raw)
        self.assertEqual(json.loads(raw)["answer"]["candidate"], "keep_lane_target")
        status, raw = self.request("POST", "/api/llm/decide", self.decide_body("broken"))
        self.assertEqual(status, 401)
        responses.append(raw)
        status, raw = self.request("POST", "/api/llm/check", {})
        self.assertEqual(status, 200)
        responses.append(raw)
        with patch.object(server, "load_map", return_value={"pack": {"edges": [], "stats": {}}, "bbox": (-123.17, 49.26, -123.15, 49.27), "error": None}):
            status, raw = self.request("GET", "/api/status")
        self.assertEqual(status, 200)
        responses.append(raw)
        self.assertEqual(json.loads(raw)["llm"]["endpoints"][0]["id"], "llm:mock")
        for raw in responses:
            self.assertNotIn(SECRET.encode(), raw)
        self.assertEqual(self.upstream.requests[0]["headers"]["Authorization"], "Bearer " + SECRET)

    def test_routes_need_the_session_token_and_same_origin(self):
        self.assertEqual(self.request("POST", "/api/llm/decide", self.decide_body(), token=False)[0], 403)
        self.assertEqual(self.request("POST", "/api/llm/check", {}, token=False)[0], 403)
        self.assertEqual(self.request("POST", "/api/llm/decide", self.decide_body(), extra={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("POST", "/api/llm/decide", self.decide_body(), extra={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.request("GET", "/api/llm/decide")[0], 404)
        self.assertEqual(self.upstream.requests, [])

    def test_unreadable_completions_are_answers_the_browser_can_count(self):
        usage = '"usage": {"prompt_tokens": 1200, "completion_tokens": 12}'
        # name: (completion, output tokens the browser is told about). Each answer is invalid for its content:
        # "{}" names no manoeuvre. Non-finite usage alone only counts as 0 tokens (see EndpointTests).
        replies = {
            "nested": (json.dumps(completion("[" * 10_000)), 12),
            "infinite": ('{"choices": [{"message": {"content": "{}"}}], "usage": {"prompt_tokens": Infinity, "completion_tokens": 12}}', 12),
            "empty": ('{"choices": [], %s}' % usage, 12),
            "unparseable": ('{"choices": [], %s, "extra": %s%s}' % (usage, "[" * 100_000, "]" * 100_000), 0),
        }
        registry = self.registry([{"name": name, "base_url": self.mock(lambda h, body, d=data.encode(): (200, d, {})).url,
                                   "model": "m", "api_key_env": "MOCK_KEY"} for name, (data, _) in replies.items()],
                                 environ={"MOCK_KEY": SECRET})
        with patch.object(server, "llm_registry", registry):
            for name, (_, output_tokens) in replies.items():
                with self.subTest(name=name):
                    status, raw = self.request("POST", "/api/llm/decide", self.decide_body(name))
                    self.assertEqual(status, 200)
                    out = json.loads(raw, parse_constant=lambda c: self.fail("non-JSON constant %s" % c))
                    self.assertIsNone(out["answer"])
                    self.assertTrue(out["invalid"])
                    self.assertTrue(out["meta"]["live_call"])
                    self.assertEqual(out["meta"]["output_tokens"], output_tokens)
        self.assertEqual(registry.guard.snapshot()["live_calls"], 4)

    def test_browser_cannot_choose_the_url_or_model(self):
        status, raw = self.request("POST", "/api/llm/decide", self.decide_body(base_url="http://169.254.169.254/latest", model="other"))
        self.assertEqual(status, 200)
        self.assertEqual(len(self.upstream.requests), 1)
        self.assertEqual(self.upstream.requests[0]["body"]["model"], "mock-model")
        status, raw = self.request("POST", "/api/llm/decide", self.decide_body("http://169.254.169.254"))
        self.assertEqual(status, 400)
        self.assertIn(b"unknown LLM endpoint", raw)


if __name__ == "__main__":
    unittest.main()
