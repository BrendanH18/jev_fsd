"""Offline checks for model configuration, setup, HTTP and accounting."""

import io
import json
import tempfile
import threading
import time
import unittest
import urllib.error
from email.message import Message
from pathlib import Path
from unittest.mock import Mock, patch

from test_5k_models_protocol import BASE_CONFIG, KEY, LLM_REQUEST, completion, endpoint

from jev import client, decision, decision_setup, endpoints, llm, llm_setup
from jev.config import PROJECT_ROOT, Settings


def http_error(code, body=None, **headers):
    hdr = Message()
    for name, value in headers.items():
        hdr[name.replace("_", "-")] = value
    stream = None if body is None else io.BytesIO(json.dumps(body).encode())
    return urllib.error.HTTPError("https://example.invalid", code, "fixture", hdr, stream)


class TransportTests(unittest.TestCase):
    def test_headers(self):
        for key in ("with space", "é", "x" * 513, "line\nbreak"):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "visible ASCII"):
                endpoints.headers_for(key)
        self.assertNotIn("x-api-key", endpoints.headers_for(None, api="anthropic"))

    def test_read_limits_and_truncation(self):
        stream = io.BytesIO(b"12345")
        stream.length = 5
        with self.assertRaisesRegex(ValueError, "larger than"):
            endpoints.read_reply(stream, 4)
        self.assertEqual(stream.tell(), 0)
        for data, length in ((b"12345", None), (b"{}", 4)):
            stream = io.BytesIO(data)
            stream.length = length
            with self.subTest(length=length), self.assertRaises(ValueError):
                endpoints.read_reply(stream, 4)

    def test_configured_http_bad_encoding(self):
        with patch.object(endpoints._OPENER, "open", return_value=io.BytesIO(b'{"text":"\xff"}')):
            with self.assertRaisesRegex(ValueError, "valid UTF-8"):
                endpoints.post_json("https://example.invalid", {}, None, time.monotonic() + 1)

    def test_configured_http_bom(self):
        with patch.object(endpoints._OPENER, "open", return_value=io.BytesIO(b'\xef\xbb\xbf{"answer":"a"}')):
            value, _ = endpoints.post_json("https://example.invalid", {}, None, time.monotonic() + 1)
        self.assertEqual(value, {"answer": "a"})

    def test_configured_http_empty(self):
        with patch.object(endpoints._OPENER, "open", return_value=io.BytesIO()):
            with self.assertRaisesRegex(ValueError, "empty body"):
                endpoints.post_json("https://example.invalid", {}, None, time.monotonic() + 1)

    def test_non_json_excerpt_scrubs_before_limit(self):
        with patch.object(endpoints._OPENER, "open", return_value=io.BytesIO(("key " + KEY).encode())):
            with self.assertRaises(ValueError) as caught:
                endpoints.post_json("https://example.invalid", {}, KEY, time.monotonic() + 1)
        self.assertEqual(str(caught.exception), "reply was not JSON (key ***)")

    def test_post_body_limits(self):
        with patch.object(endpoints._OPENER, "open") as open_:
            with self.assertRaisesRegex(ValueError, "finite JSON"):
                endpoints.post_json("https://example.invalid", {"v": float("inf")}, None, time.monotonic() + 1)
            with self.assertRaisesRegex(ValueError, "larger than"):
                endpoints.post_json("https://example.invalid", {"v": "large"}, None, time.monotonic() + 1, max_bytes=4)
        open_.assert_not_called()

    def test_error_body_normalizes_numbers(self):
        err = http_error(400)
        err.body_text = '{"bad": NaN, "overflow": 1e1000, "ok": 1}'
        self.assertEqual(endpoints.error_body(err), {"bad": None, "overflow": None, "ok": 1})

    def test_no_address_is_connection_error(self):
        with patch.object(endpoints, "_resolve", return_value=[]):
            with self.assertRaisesRegex(OSError, "no usable addresses"):
                endpoints._connect_by(time.monotonic() + 2, ("fixture", 80), 1)

    def test_elapsed_watchdog_is_late_even_if_timer_has_not_fired(self):
        with patch.object(endpoints.threading, "Timer"):
            deadline = time.monotonic() - 1
            watchdog = endpoints._Watchdog(deadline)
            self.assertTrue(watchdog.cancel())
            self.assertTrue(watchdog.cancel())

    def test_status_probe_invalid_key(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, api_key_env="TEST_KEY")
        ep._key = "invalid key"
        with patch.object(endpoints._OPENER, "open") as open_:
            self.assertIn("visible ASCII", ep.check()["detail"])
        open_.assert_not_called()

    def test_check_timeout_and_cache(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, check_timeout_s=0.5, check_ttl_s=0)
        with patch.object(endpoints._OPENER, "open", side_effect=lambda *_args, **_kwargs: io.BytesIO(b"{}")) as open_:
            for _ in range(2):
                self.assertEqual(ep.check()["status"], "ready")
        self.assertEqual(open_.call_count, 2)
        self.assertEqual(open_.call_args.kwargs["timeout"], 0.5)

    def test_probe_invalidation_in_flight(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint)

        def read_and_reload(*_args, **_kwargs):
            ep.invalidate_check()
            return io.BytesIO(b"{}")

        with patch.object(endpoints._OPENER, "open", side_effect=read_and_reload):
            self.assertEqual(ep.check()["status"], "ready")
        self.assertIsNone(ep._check)

    def test_status_throttle_diagnostic(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint)
        with patch.object(endpoints._OPENER, "open", side_effect=http_error(429)):
            status = ep.check()
        self.assertTrue(status["reachable"])
        self.assertIn("rate limited", status["detail"])

    def test_probe_dedup(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint)
        entered = threading.Event()
        release = threading.Event()

        def delayed_open(*_args, **_kwargs):
            entered.set()
            if not release.wait(2):
                raise RuntimeError("test did not release probe")
            return io.BytesIO(b"{}")

        results = []
        jobs = [threading.Thread(target=lambda: results.append(ep.check())) for _ in range(2)]
        with patch.object(endpoints._OPENER, "open", side_effect=delayed_open) as open_:
            jobs[0].start()
            try:
                self.assertTrue(entered.wait(1))
                jobs[1].start()
            finally:
                release.set()
                for job in jobs:
                    if job.ident is not None:
                        job.join(2)
            self.assertEqual(open_.call_count, 1)
        self.assertEqual([result["status"] for result in results], ["ready", "ready"])


class ModelConfigurationTests(unittest.TestCase):
    def invalid(self, cls, fields, detail):
        problems = []
        config = cls(dict(BASE_CONFIG, **fields), "entry", problems)
        self.assertFalse(config.ok)
        self.assertIn(detail, " ".join(problems))

    def test_base_configuration(self):
        for fields, detail in (
            ({"base_url": "https://example.invalid/" + "a" * 500}, "500 characters"),
            ({"base_url": "https://example.invalid/\x00"}, "invalid character"),
            ({"base_url": r"https://example.invalid/v1\model"}, "invalid character"),
            ({"model": "x" * 201}, "200 characters"),
            ({"model": "a\nb"}, "printable"),
            ({"label": 42}, "label must be printable"),
        ):
            with self.subTest(detail=detail):
                self.invalid(llm.EndpointConfig, fields, detail)

    def test_local_host(self):
        self.assertTrue(endpoints.is_local_host("http://localhost."))
        for url in ("http://0.0.0.0", "http://[::]", "http://224.0.0.1", "http://[ff02::1]"):
            with self.subTest(url=url):
                self.assertFalse(endpoints.is_local_host(url))

    def test_api_path(self):
        for raw in ("/v1/./models", "/v1/../models", "/v1//models"):
            with self.subTest(raw=raw):
                self.invalid(decision.DecisionConfig, {"path": raw}, "URL paths")
                self.invalid(llm.EndpointConfig, {"check_path": raw}, "URL path")

    def test_exact_integer(self):
        self.assertEqual(endpoints.number("9007199254740993", integer=True), 2**53 + 1)
        self.assertEqual(endpoints.number(2**53 + 1, integer=True), 2**53 + 1)

    def test_limits_from_both_configs(self):
        for cls in (llm.EndpointConfig, decision.DecisionConfig):
            for field, value in (
                ("rpm", -1),
                ("rpm", 10**12),
                ("max_parallel", 0),
                ("max_request_bytes", 0),
                ("check_timeout_s", 0),
                ("check_ttl_s", -1),
                ("retry_after_max_s", True),
            ):
                with self.subTest(cls=cls, field=field):
                    self.invalid(cls, {field: value}, field)

    def test_price_cap_reported_without_disabling_model(self):
        problems = []
        config = llm.EndpointConfig(dict(BASE_CONFIG, price_per_mtok_input=1e100), "entry", problems)
        self.assertTrue(config.ok)
        self.assertFalse(config.priced)
        self.assertIn("must be at most", problems[0])

    def test_llm_config_rejects_invalid_fields(self):
        for fields, detail in (
            ({"api": False}, "api must"),
            ({"response_format": ""}, "response_format must"),
            ({"temperature": 2.1}, "between 0 and 2"),
            ({"max_tokens": 0}, "max_tokens"),
            ({"max_tokens": llm.MAX_OUTPUT_TOKENS + 1}, "max_tokens"),
            ({"extra_body": {"max_tokens": -1}}, "max_tokens"),
            ({"extra_body": {"max_completion_tokens": 3.5}}, "max_tokens"),
            ({"extra_body": {"max_completion_tokens": 30, "max_tokens": 30}}, "just one output token cap"),
            ({"extra_body": {"custom": float("inf")}}, "finite JSON"),
            ({"extra_body": {"custom": "x" * llm.MAX_EXTRA_BODY_BYTES}}, "extra_body"),
            ({"extra_body": {"custom": [[[[[[[[[[[[[[[[[0]]]]]]]]]]]]]]]]]}}, "16 levels"),
            ({"token_field": "other"}, "token_field"),
            ({"system_role": "user"}, "system_role"),
            ({"cache_ttl": "1h"}, "Anthropic endpoint"),
            ({"api": "anthropic", "cache_ttl": "2h"}, "cache_ttl"),
            ({"api": "anthropic", "token_field": "max_completion_tokens"}, "token_field"),
            ({"api": "anthropic", "system_role": "developer"}, "system_role"),
            ({"api": "anthropic", "extra_body": {"max_completion_tokens": 100}}, "Anthropic"),
            ({"api": "anthropic", "fallback_response_format": "json_object"}, "fallback_response_format"),
            ({"price_per_mtok_cached_input": 0.1}, "needs price_per_mtok_input"),
            ({"api": "anthropic", "price_per_mtok_cached_input": 0.1}, "cache multipliers"),
        ):
            with self.subTest(detail=detail):
                self.invalid(llm.EndpointConfig, fields, detail)

    def test_environment_config_fields(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            values = {
                "BASE_URL": "http://localhost:8000",
                "MODEL": "fixture",
                "ENDPOINTS": str(path / "none"),
                "API": "anthropic",
                "RESPONSE_FORMAT": "none",
                "MAX_TOKENS": "1024",
                "RPM": "17",
                "MAX_PARALLEL": "2",
                "MAX_REQUEST_BYTES": "4096",
                "CACHE_TTL": "1h",
                "TEMPERATURE": "null",
                "CHECK_TIMEOUT_S": "1.5",
                "CHECK_TTL_S": "0",
                "RETRY_AFTER_MAX_S": "10",
                "CHECK_PATH": "/ready",
                "FALLBACK_RESPONSE_FORMAT": "disabled",
            }
            settings = Settings({"JEV_FSD_LLM_" + k: v for k, v in values.items()}, path / ".env")
            configs, problems = llm.load_configs(settings)
            self.assertEqual(problems, [])
            expected = {
                "api": "anthropic",
                "response_format": "none",
                "max_tokens": 1024,
                "rpm": 17,
                "max_parallel": 2,
                "max_request_bytes": 4096,
                "cache_ttl": "1h",
                "temperature": None,
                "check_timeout_s": 1.5,
                "check_ttl_s": 0,
                "retry_after_max_s": 10,
                "check_path": "/ready",
                "fallback_response_format": "disabled",
            }
            self.assertEqual({field: getattr(configs[0], field) for field in expected}, expected)

    def test_environment_nulls_omit_parameters(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            base = {"BASE_URL": "http://localhost:8000", "MODEL": "fixture", "ENDPOINTS": str(path / "none")}
            for extra, expected in (
                ({}, (0, 400, None)),
                ({"TEMPERATURE": "null", "MAX_TOKENS": "null", "RPM": "null"}, (None, None, None)),
            ):
                with self.subTest(extra=extra):
                    values = {**base, **extra}
                    settings = Settings({"JEV_FSD_LLM_" + k: v for k, v in values.items()}, path / ".env")
                    configs, problems = llm.load_configs(settings)
                    self.assertEqual(problems, [])
                    config = configs[0]
                    self.assertEqual((config.temperature, config.max_tokens, config.rpm), expected)

    def test_price_and_format_status(self):
        ep = endpoint(
            llm.EndpointConfig,
            llm.LlmEndpoint,
            price_per_mtok_input=2,
            price_per_mtok_cached_input=0.5,
            fallback_response_format="json_object",
        )
        self.assertEqual(ep.public()["price_per_mtok_cached_input"], 0.5)
        self.assertEqual(ep.public()["fallback_response_format"], "json_object")


class ModelCallPolicyTests(unittest.TestCase):
    def setUp(self):
        self.messages = LLM_REQUEST["messages"]
        self.expect = LLM_REQUEST["expect"]

    def test_concurrency_cap_does_not_consume_rpm(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, max_parallel=1, rpm=2)
        with ep.attempt():
            with self.assertRaisesRegex(client.JevError, "in flight"):
                with ep.attempt():
                    self.fail("cap let a call through")
        with ep.attempt():
            pass
        self.assertEqual(ep._in_flight, 0)
        self.assertEqual(len(ep._rate._times), 2)

    def test_concurrency_cap_releases_after_transport_error(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, max_parallel=1)
        with patch.object(llm, "post_json", side_effect=[TimeoutError(), (completion(), 1)]):
            with self.assertRaises(llm.LlmError):
                ep.chat(self.messages, self.expect)
            self.assertIsNotNone(ep.chat(self.messages, self.expect).content)
        self.assertEqual(ep._in_flight, 0)

    def test_records_usage_before_releasing_parallel_slot(self):
        for config, cls, method, args, module in (
            (llm.EndpointConfig, llm.LlmEndpoint, "chat", (self.messages, self.expect), llm),
            (decision.DecisionConfig, decision.DecisionEndpoint, "decide", ({}, {}), decision),
        ):
            ep = endpoint(config, cls, max_parallel=1)

            def check_slot(result):
                self.assertEqual(ep._in_flight, 1)
                ep.guard.record(result)

            with (
                patch.object(module, "post_json", return_value=(completion(), 1)),
                patch.object(ep, "record", side_effect=check_slot),
            ):
                getattr(ep, method)(*args)
            self.assertEqual(ep.guard.live_calls, 1)
            self.assertEqual(ep._in_flight, 0)

    def test_size_limit_is_applied_before_quota(self):
        for config, cls, method, args, module in (
            (llm.EndpointConfig, llm.LlmEndpoint, "chat", (self.messages, self.expect), llm),
            (decision.DecisionConfig, decision.DecisionEndpoint, "decide", ({}, {}), decision),
        ):
            ep = endpoint(config, cls, max_request_bytes=2, rpm=1)
            with patch.object(module, "post_json") as post:
                with self.assertRaisesRegex(client.JevError, "max_request_bytes"):
                    getattr(ep, method)(*args)
            post.assert_not_called()
            self.assertFalse(ep._rate._times)

    def test_retry_after_blocks_only_that_endpoint(self):
        limited = endpoint(llm.EndpointConfig, llm.LlmEndpoint, retry_after_max_s=2)
        other = endpoint(llm.EndpointConfig, llm.LlmEndpoint)
        overloaded = http_error(529, Retry_After="20")
        with patch.object(llm, "post_json", side_effect=[overloaded, (completion(), 1), (completion(), 1)]) as post:
            with patch.object(endpoints.time, "monotonic", return_value=10):
                with self.assertRaisesRegex(llm.LlmError, "overloaded"):
                    limited.chat(self.messages, self.expect)
                with self.assertRaisesRegex(llm.LlmError, "Try again in 2 s"):
                    limited.chat(self.messages, self.expect)
                other.chat(self.messages, self.expect)
            with patch.object(endpoints.time, "monotonic", return_value=12):
                limited.chat(self.messages, self.expect)
        self.assertEqual(post.call_count, 3)

    def test_local_retry_after_can_be_disabled(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, retry_after_max_s=0)
        ep.defer(http_error(429, Retry_After="100"))
        with ep.attempt():
            self.assertEqual(ep._in_flight, 1)

    def test_http_error_messages(self):
        for code, status, text in ((402, 402, "out of credits"), (404, 502, "check the model id")):
            ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint)
            reply = http_error(code)
            reply.body_text = '{"detail":"provider explanation"}'
            with patch.object(llm, "post_json", side_effect=reply):
                with self.subTest(code=code), self.assertRaisesRegex(llm.LlmError, text) as ctx:
                    ep.chat(self.messages, self.expect)
            self.assertEqual(ctx.exception.status, status)
            self.assertIn("provider explanation", str(ctx.exception))

    def test_json_object_fallback_and_status(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, fallback_response_format="json_object")
        with patch.object(llm, "post_json", side_effect=[http_error(400), (completion(), 1)]) as post:
            result = ep.chat(self.messages, self.expect)
        self.assertEqual(
            [c.args[1]["response_format"]["type"] for c in post.call_args_list], ["json_schema", "json_object"]
        )
        self.assertEqual(result.format_used, "json_object")
        self.assertEqual(ep.public()["configured_response_format"], "json_schema")

    def test_can_disable_structured_retry(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, fallback_response_format="disabled")
        with patch.object(llm, "post_json", side_effect=http_error(422)) as post:
            with self.assertRaises(llm.LlmError):
                ep.chat(self.messages, self.expect)
        post.assert_called_once()
        self.assertEqual(ep.public()["response_format"], "json_schema")

    def test_llm_latency_includes_format_retry(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint)
        ep.guard.rpm = 0
        with (
            patch.object(llm.time, "monotonic", side_effect=[10.0, 10.1, 10.2, 10.3, 10.45]),
            patch.object(llm, "post_json", side_effect=[http_error(400), (completion(), 1)]),
        ):
            result = ep.chat(self.messages, self.expect)
        self.assertEqual(result.meta()["latency_ms"], 450.0)

    def test_openai_wire_options(self):
        ep = endpoint(
            llm.EndpointConfig,
            llm.LlmEndpoint,
            token_field="max_completion_tokens",
            system_role="developer",
            temperature=None,
            max_tokens=200,
        )
        messages = [{"role": "system", "content": "Rules"}, *self.messages]
        data = llm.openai_payload(ep.config, messages, self.expect, "none")
        self.assertEqual(data["messages"][0]["role"], "developer")
        self.assertEqual(data["max_completion_tokens"], 200)
        self.assertNotIn("temperature", data)
        self.assertNotIn("max_tokens", data)
        self.assertEqual(messages[0]["role"], "system")

    def test_token_alias_override_sends_only_selected_cap(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, extra_body={"max_completion_tokens": "30"})
        payload = llm.openai_payload(ep.config, self.messages, self.expect, "none")
        self.assertEqual(payload["max_completion_tokens"], 30)
        self.assertNotIn("max_tokens", payload)

    def test_custom_probe_path(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, check_path="/ready")
        self.assertEqual(ep.check_url(), "http://localhost:8000/v1/ready")

    def test_cost_accounts_for_openai_prompt_cache(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, price_per_mtok_input=2, price_per_mtok_cached_input=0.5)
        reply = completion()
        reply["usage"] = {"prompt_tokens": 100, "prompt_tokens_details": {"cached_tokens": 30}}
        for count, expected in ((30, 155), (120, 50)):
            reply["usage"]["prompt_tokens_details"]["cached_tokens"] = count
            result = llm.LlmResult(ep, {"model": "m"}, reply, 2, "none")
            self.assertAlmostEqual(result.cost_usd, expected / 1e6)
            self.assertEqual(result.meta()["cache_read_tokens"], min(count, 100))

    def test_cost_accounts_for_provider_split_cache_writes(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, api="anthropic", price_per_mtok_input=1)
        reply = {
            "usage": {
                "input_tokens": 10,
                "cache_creation": {"ephemeral_1h_input_tokens": 50, "ephemeral_5m_input_tokens": 20},
            },
            "content": [],
        }
        result = llm.LlmResult(ep, {"model": "m"}, reply, 2, "none")
        self.assertEqual(result.input_tokens, 80)
        self.assertAlmostEqual(result.cost_usd, 135 / 1e6)
        reply["usage"]["cache_creation_input_tokens"] = 40
        result = llm.LlmResult(ep, {"model": "m"}, reply, 2, "none")
        self.assertAlmostEqual(result.cost_usd, 90 / 1e6)

    def test_anthropic_ttl_and_cache_opt_out(self):
        messages = [{"role": "system", "content": "Rules"}, *self.messages]
        for ttl in ("1h", "5m", "off"):
            with self.subTest(ttl=ttl):
                ep = endpoint(
                    llm.EndpointConfig, llm.LlmEndpoint, api="anthropic", price_per_mtok_input=1, cache_ttl=ttl
                )
                data = llm.anthropic_payload(ep.config, messages, self.expect, "none")["system"][0]
                if ttl == "off":
                    self.assertNotIn("cache_control", data)
                else:
                    self.assertEqual(data["cache_control"]["ttl"], ttl)
                reply = {"usage": {"cache_creation_input_tokens": 20}, "content": []}
                result = llm.LlmResult(ep, {"model": "m"}, reply, 2, "none")
                self.assertAlmostEqual(result.cost_usd, (40 if ttl == "1h" else 25) / 1e6)


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.path = self.root / "llm.json"
        self.settings = Settings({"JEV_FSD_LLM_ENDPOINTS": str(self.path)}, self.root / ".env")
        self.registry = llm.LlmRegistry(self.settings, client.SpendGuard())
        self.local = {"provider": "custom", "base_url": "http://localhost:8000/v1", "model": "demo"}

    def write_entries(self, *entries):
        self.path.write_text(json.dumps({"endpoints": entries}), encoding="utf-8")

    def test_catalog_requires_auth_before_network(self):
        with patch.object(llm_setup, "fetch_json") as fetch:
            for provider in ("openai", "gemini", "groq", "mistral", "xai"):
                with self.subTest(provider=provider), self.assertRaises(llm_setup.SetupAuthError):
                    llm_setup.list_models(self.settings, {"provider": provider})
        fetch.assert_not_called()

    def test_catalog_shape(self):
        with self.assertRaisesRegex(llm_setup.SetupError, "no model list"):
            llm_setup.parse_models({"data": {}})
        self.assertEqual(llm_setup.parse_models({"data": None, "models": [{"id": "m"}]}), [{"id": "m"}])

    def test_catalog_text_and_decision_filter(self):
        rows = [
            {"id": "text", "architecture": {"output_modalities": ["text"]}},
            {"id": "decision", "architecture": {"output_modalities": ["decisions"]}},
            {"id": "unknown"},
        ]
        with patch.object(llm_setup, "fetch_json", return_value=rows):
            out = llm_setup.list_models(self.settings, {"provider": "openrouter"})
        self.assertEqual([row["id"] for row in out["models"]], ["text", "unknown"])
        with patch.object(decision_setup, "fetch_json", return_value=rows):
            out = decision_setup.list_models(self.settings, {"provider": "openrouter"})
        self.assertEqual([row["id"] for row in out["models"]], ["decision", "unknown"])

    def test_catalog_usable_ids(self):
        models = llm_setup.parse_models([{"id": "m"}, {"id": " m2"}, {"id": "m\n3"}, {"id": "x" * 201}])
        self.assertEqual(models, [{"id": "m"}])

    def test_catalog_metadata_fallbacks(self):
        models = llm_setup.parse_models(
            [{"id": "m", "context_length": False, "max_input_tokens": 32, "name": "", "display_name": " Display "}]
        )
        self.assertEqual(models, [{"id": "m", "name": "Display", "context_length": 32}])

    def test_catalog_deterministic_case_order(self):
        models = llm_setup.parse_models([{"id": "m"}, {"id": "M"}])
        self.assertEqual([item["id"] for item in models], ["M", "m"])

    def test_catalog_http_diagnostics(self):
        for code, detail in ((429, "Wait and try again"), (405, "Enter the model id manually")):
            with patch.object(endpoints._OPENER, "open", side_effect=http_error(code)):
                with self.subTest(code=code), self.assertRaisesRegex(llm_setup.SetupError, detail):
                    llm_setup.fetch_json("https://example.invalid/models", None, "Fixture", 1)

    def test_config_bom_and_size(self):
        self.path.write_bytes(b'\xef\xbb\xbf{"endpoints":[]}')
        self.assertEqual(llm_setup._read_file(llm_setup.LLM, self.settings), {"endpoints": []})
        self.path.write_bytes(b" " * (endpoints.MAX_CONFIG_BYTES + 1))
        self.registry.reload()
        self.assertIn("larger than", self.registry.problems[0])
        with self.assertRaisesRegex(llm_setup.SetupError, "larger than"):
            llm_setup.save(self.settings, self.registry, self.local)

    def test_save_failure_does_not_write_key(self):
        with (
            patch.object(llm_setup, "_write_file", side_effect=llm_setup.SetupError("fixture error")),
            patch.object(llm_setup, "write_key") as write,
        ):
            with self.assertRaisesRegex(llm_setup.SetupError, "fixture error"):
                llm_setup.save(self.settings, self.registry, dict(self.local, api_key="key"))
        write.assert_not_called()

    def test_failed_key_file_restores_previous_config(self):
        raw = '{ "endpoints" : [], "_comment": "keep formatting" }\n'
        self.path.write_text(raw, encoding="utf-8")
        with patch.object(llm_setup, "write_key", side_effect=llm_setup.SetupError("bad key")):
            with self.assertRaisesRegex(llm_setup.SetupError, "bad key"):
                llm_setup.save(self.settings, self.registry, dict(self.local, api_key="key"))
        self.assertEqual(self.path.read_text(encoding="utf-8"), raw)
        self.assertFalse(self.registry.endpoints)

    def test_update_keeps_tuning_and_prices(self):
        provider = llm_setup.LLM.by_id["groq"]
        self.settings.environ["GROQ_API_KEY"] = "fixture"
        self.write_entries(
            dict(
                BASE_CONFIG,
                base_url=provider["base_url"],
                label="Custom label",
                timeout_s=11,
                rpm=7,
                response_format="none",
                price_per_mtok_input=2,
            )
        )
        body = {"provider": "groq", "name": "fixture", "model": BASE_CONFIG["model"]}
        llm_setup.save(self.settings, self.registry, body)
        active = self.registry.get("fixture")
        self.assertEqual((active.config.label, active.config.timeout_s, active.config.rpm), ("Custom label", 11, 7))
        self.assertEqual(active.config.response_format, "none")
        self.assertEqual(active.config.price_in, 2)
        llm_setup.save(self.settings, self.registry, dict(body, price_per_mtok_input=""))
        self.assertIsNone(self.registry.get("fixture").config.price_in)

    def test_removal_clears_duplicate_definitions(self):
        self.write_entries(BASE_CONFIG, dict(BASE_CONFIG, model="shadowed"))
        llm_setup.remove(self.settings, self.registry, {"name": BASE_CONFIG["name"]})
        self.assertEqual(self.registry.endpoints, {})

    def test_removal_explicitly_names_missing_selection(self):
        with self.assertRaisesRegex(llm_setup.SetupError, "Choose an endpoint"):
            llm_setup.remove(self.settings, self.registry, {})

    def test_presets_choose_compatible_parameters(self):
        rows = [
            ("openai", "gpt-5.4", "OPENAI_API_KEY", "max_completion_tokens", "developer", None, {}),
            ("openai", "gpt-4o-mini", "OPENAI_API_KEY", "max_completion_tokens", "system", 0, {}),
            ("groq", "llama-3.3", "GROQ_API_KEY", "max_completion_tokens", "system", 0, {}),
            ("gemini", "gemini-2.0-flash", "GEMINI_API_KEY", "max_tokens", "system", 0, {}),
            ("xai", "grok-3", "XAI_API_KEY", "max_tokens", "system", 0, {}),
        ]
        for pid, model, key_env, token_field, system_role, temperature, extra in rows:
            self.settings.environ[key_env] = "fixture"
            with self.subTest(provider=pid, model=model):
                out = llm_setup.save(self.settings, self.registry, {"provider": pid, "model": model})
                config = self.registry.get(out["saved"]).config
                self.assertEqual(
                    (config.token_field, config.system_role, config.temperature, config.extra_body),
                    (token_field, system_role, temperature, extra),
                )

    def test_typesafe_catalog_empty_result_and_auth_error(self):
        with patch.object(decision_setup, "fetch_json", return_value={"models": []}):
            out = decision_setup.list_models(self.settings, {"provider": "typesafe", "api_key": "fixture"})
        self.assertIn("empty model list", out["note"])
        self.assertIn("stable alias", out["models"][0]["name"])
        with patch.object(decision_setup, "fetch_json", side_effect=llm_setup.SetupAuthError("unauthorized")):
            with self.assertRaises(llm_setup.SetupAuthError):
                decision_setup.list_models(self.settings, {"provider": "typesafe", "api_key": "fixture"})

    def test_typesafe_model_id_and_selected_url(self):
        models = decision_setup._typesafe_models({"models": [{"id": "m", "display_name": "Model"}]})
        self.assertEqual(models, [{"id": "m", "name": "Model"}])
        self.settings.environ["TYPESAFE_BASE_URL"] = "https://example.invalid"
        driver = client.JevClient(self.settings)
        with patch.object(decision_setup, "write_key") as write:
            with self.assertRaisesRegex(llm_setup.SetupError, "TYPESAFE_BASE_URL"):
                decision_setup.save(
                    self.settings, Mock(), driver, {"provider": "typesafe", "model": driver.model, "api_key": "fixture"}
                )
        write.assert_not_called()

    def test_examples_remain_loadable(self):
        env = {
            "JEV_FSD_LLM_ENDPOINTS": str(PROJECT_ROOT / "data" / "llm-endpoints.example.json"),
            "JEV_FSD_DECISION_ENDPOINTS": str(PROJECT_ROOT / "data" / "decision-endpoints.example.json"),
        }
        settings = Settings(env, self.root / ".env")
        self.assertFalse(llm.LlmRegistry(settings, client.SpendGuard()).problems)
        self.assertFalse(decision.DecisionRegistry(settings, client.SpendGuard()).problems)
