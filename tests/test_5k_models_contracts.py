"""Regression contracts for model backends, independent of live providers."""

import http.client
import io
import json
import socket
import threading
import time
import unittest
import urllib.error
import urllib.request
from types import SimpleNamespace
from unittest.mock import Mock, patch

from test_5k_models_endpoints import http_error
from test_5k_models_protocol import KEY, LLM_REQUEST, completion, endpoint

from jev import client, decide, decision, endpoints, llm, llm_setup
from jev.config import Settings


class TypeSafeContracts(unittest.TestCase):
    def setUp(self):
        self.driver = client.JevClient(Settings({}), api_key=KEY, timeout=5)

    def test_connection_snapshot(self):
        def exchange(payload, *, config):
            self.driver.set_api_key("replacement")
            self.driver.settings.environ.update(TYPESAFE_DEFAULT_MODEL="new", TYPESAFE_BASE_URL="https://other.invalid")
            self.assertEqual(payload["model"], "jev-latest")
            self.assertEqual(config, (KEY, "jev-latest", "https://api.typesafe.ai", 5))
            return {"echo": KEY}

        with patch.object(self.driver, "_post_system_one", side_effect=exchange):
            result = self.driver.system_one({}, {})
        self.assertEqual(result.response["echo"], "***")
        self.assertEqual(self.driver.api_key, "replacement")

    def test_fallback_catalog_transport(self):
        with patch.object(endpoints._OPENER, "open", return_value=io.BytesIO(b"{}")) as open_:
            self.driver._stdlib_request("GET", "/v1/models", None)
        req = open_.call_args.args[0]
        self.assertIsInstance(req.watchdog, endpoints._Watchdog)
        self.assertEqual(req.method, "GET")
        self.assertTrue(any(isinstance(handler, endpoints._NoRedirect) for handler in endpoints._OPENER.handlers))

    def test_fallback_connect_backoff(self):
        self.driver.timeout = 0.2
        with (
            patch.object(
                endpoints._OPENER, "open", side_effect=[urllib.error.URLError("unavailable"), io.BytesIO(b"{}")]
            ),
            patch.object(client.time, "sleep") as sleep,
        ):
            self.assertEqual(self.driver._stdlib_request("GET", "/v1/models", None), ({}, 2))
        sleep.assert_called_once_with(0.2)

    def test_fallback_read_failure(self):
        with patch.object(endpoints._OPENER, "open", side_effect=http.client.IncompleteRead(b"{}", 4)):
            with self.assertRaisesRegex(client.JevError, "Could not read the TypeSafe model list"):
                self.driver._stdlib_request("GET", "/v1/models", None)

    def test_missing_key_leaves_quota_untouched(self):
        self.driver.set_api_key(None)
        with patch.object(self.driver, "_post_system_one") as post:
            with self.assertRaises(client.JevError) as failure:
                self.driver.system_one({}, {})
        self.assertEqual(failure.exception.status, 401)
        self.assertFalse(self.driver.guard._times)
        post.assert_not_called()

    def test_key_source_tracks_memory_override(self):
        self.driver.settings.environ["TYPESAFE_API_KEY"] = "process"
        self.assertEqual(self.driver.key_source, "memory")
        self.driver.set_api_key(None)
        self.assertEqual(self.driver.key_source, "env")
        self.assertEqual(self.driver.api_key, "process")

    def test_sdk_identity_unchanged_on_same_key(self):
        with patch.object(client, "TypeSafeClient") as factory:
            self.driver._sdk_client()
            self.driver.set_api_key(KEY)
            self.driver._sdk_client()
        factory.assert_called_once()

    def test_sdk_identity_changes_on_model_and_timeout(self):
        with patch.object(client, "TypeSafeClient") as factory:
            self.driver._sdk_client()
            self.driver.settings.environ["TYPESAFE_DEFAULT_MODEL"] = "different"
            self.driver._sdk_client()
            self.driver.timeout = 1
            self.driver._sdk_client()
        self.assertEqual(
            [call.kwargs["model"] for call in factory.call_args_list], ["jev-latest", "different", "different"]
        )
        self.assertEqual([call.kwargs["timeout"] for call in factory.call_args_list], [5, 5, 1])

    def test_rate_rejection_does_not_append_timestamp(self):
        guard = client.SpendGuard(rpm=1)
        with patch.object(client.time, "monotonic", side_effect=[10, 20]):
            guard.check()
            with self.assertRaises(client.JevError):
                guard.check()
        self.assertEqual(list(guard._times), [10])

    def test_budget_rejection_does_not_consume_rate(self):
        guard = client.SpendGuard(budget_usd=0.5, rpm=1)
        guard.record(SimpleNamespace(input_tokens=0, cost_usd=0.5))
        with self.assertRaises(client.JevError) as error:
            guard.check()
        self.assertEqual(error.exception.status, 402)
        self.assertFalse(guard._times)

    def test_missing_probabilities_fall_back_to_confidence(self):
        self.assertEqual(client.chosen({"choice": "a", "confidence": 0.67}), ("a", 0.67))

    def test_ranked_probabilities_sort_before_limiting(self):
        ranking = client.ranked({"probabilities": {"first": 0.3, "best": 0.5, "tail": 0.2}}, limit=2)
        self.assertEqual([entry["value"] for entry in ranking], ["best", "first"])

    def test_choice_builder_keeps_option_order(self):
        question = client.choice("Choose", {"zed": None, "alpha": "description"})
        self.assertEqual(list(question["criteria"]), ["zed", "alpha"])

    def test_boolean_builder_keeps_single_optional_description(self):
        self.assertEqual(
            client.noul("Clear?", yes="the road is clear")["criteria"], {"true": "the road is clear", "false": None}
        )

    def test_score_builder_keeps_level_order(self):
        self.assertEqual(client.score("Rate", ["low", "high"])["criteria"], ["low", "high"])

    def test_noul_without_labels_omits_criteria(self):
        self.assertEqual(client.noul("Clear?"), {"type": "noul", "instructions": "Clear?"})

    def test_ranked_probability_ties_keep_provider_order(self):
        values = client.ranked({"probabilities": {"z": 0.5, "a": 0.5}})
        self.assertEqual([entry["value"] for entry in values], ["z", "a"])


class TransportContracts(unittest.TestCase):
    def test_redirect_diagnostic(self):
        request = urllib.request.Request("https://example.invalid/v1")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            endpoints._NoRedirect().redirect_request(request, None, 302, "found", {}, "https://other.invalid/details")
        self.assertIn("set base_url", str(caught.exception))
        self.assertNotIn("other.invalid", str(caught.exception))

    def test_error_stream_cleanup(self):
        failure = http_error(400, {"error": "x" * 5000})
        self.assertEqual(len(endpoints.read_error(failure)), endpoints.MAX_ERROR_BYTES)
        self.assertTrue(failure.fp.closed)

    def test_error_stream_absent(self):
        self.assertEqual(endpoints.read_error(http_error(502)), "")

    def test_deadline_before_contact(self):
        with patch.object(endpoints._OPENER, "open") as open_:
            with self.assertRaisesRegex(TimeoutError, "deadline passed"):
                endpoints.post_json("https://example.invalid", {}, None, time.monotonic() - 1)
        open_.assert_not_called()

    def test_read_reply_exact_limit(self):
        self.assertEqual(endpoints.read_reply(io.BytesIO(b"test"), 4), b"test")

    def test_probe_timeout_cannot_exceed_call_timeout(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, check_timeout_s=20, timeout_s=2)
        with patch.object(endpoints._OPENER, "open", return_value=io.BytesIO(b"")) as open_:
            ep.check()
        self.assertEqual(open_.call_args.kwargs["timeout"], 2)

    def test_poll_forces_a_refresh_inside_cache_window(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint)
        with patch.object(endpoints._OPENER, "open", side_effect=[io.BytesIO(b""), http_error(403)]) as open_:
            self.assertEqual(ep.check()["status"], "ready")
            self.assertEqual(ep.check(force=True)["status"], "key rejected")
        self.assertEqual(open_.call_count, 2)

    def test_public_ipv6_retains_brackets_and_port(self):
        self.assertEqual(endpoints.public_url("http://[::1]:8080/v1/"), "http://[::1]:8080/v1")

    def test_ip_local_aliases(self):
        for url in ("http://host.docker.internal", "http://workstation.local", "http://[::1]", "http://127.0.0.1"):
            with self.subTest(url=url):
                self.assertTrue(endpoints.is_local_host(url))

    def test_headers_have_explicit_json_negotiation(self):
        expected = {"Accept": "application/json", "Content-Type": "application/json"}
        actual = endpoints.headers_for(None, json_body=True)
        self.assertEqual({key: actual[key] for key in expected}, expected)
        self.assertNotIn("Content-Type", endpoints.headers_for(None))

    def test_single_address_connect_passes_source_address(self):
        address = ("127.0.0.1", 9000)
        source = ("127.0.0.1", 0)
        sock = Mock()
        with (
            patch.object(endpoints, "_resolve", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 0, "", address)]),
            patch.object(endpoints, "_open_socket", return_value=sock),
        ):
            self.assertIs(endpoints._connect_by(time.monotonic() + 2, address, 1, source), sock)
        sock.bind.assert_called_once_with(source)
        sock.connect.assert_called_once_with(address)

    def test_transport_error_reason_without_body(self):
        self.assertEqual(endpoints.error_body(http_error(503)), "fixture")


class RegistryContracts(unittest.TestCase):
    def test_reload_serializes_loads(self):
        registry = llm.LlmRegistry(Settings({}), client.SpendGuard())
        first = threading.Event()
        release = threading.Event()
        failures = []

        def load(_settings):
            if not first.is_set():
                first.set()
                if not release.wait(2):
                    failures.append("reload was never released")
            return [], []

        with patch.object(registry, "load", side_effect=load):
            worker = threading.Thread(target=registry.reload)
            worker.start()
            try:
                self.assertTrue(first.wait(1))
                self.assertFalse(registry._registry_lock.acquire(blocking=False))
            finally:
                release.set()
                worker.join(2)
        self.assertFalse(failures)

    def test_consistent_status_snapshot(self):
        registry = llm.LlmRegistry(Settings({}), client.SpendGuard())
        registry.problems = ["old problem"]

        def swap_during_status():
            registry.problems = ["new problem"]
            registry.endpoints = {}
            return {"name": "old"}

        registry.endpoints = {"old": Mock(public=swap_during_status)}
        status = registry.public()
        self.assertEqual(status["endpoints"], [{"name": "old"}])
        self.assertEqual(status["problems"], ["old problem"])

    def test_empty_registry_never_starts_executor(self):
        registry = llm.LlmRegistry(Settings({}), client.SpendGuard())
        registry.endpoints = {}
        with patch.object(endpoints, "ThreadPoolExecutor") as executor:
            self.assertEqual(registry.check_all(), [])
        executor.assert_not_called()

    def test_unknown_name_mentions_configured_choices(self):
        registry = decision.DecisionRegistry(Settings({}), client.SpendGuard())
        registry.endpoints = {"first": Mock(), "second": Mock()}
        with self.assertRaisesRegex(decision.InvalidDecisionRequest, "configured: first, second"):
            registry.get("elsewhere")


class ReplyContracts(unittest.TestCase):
    def test_decision_result_metadata(self):
        ep = endpoint(decision.DecisionConfig, decision.DecisionEndpoint)
        result = decision.DecisionResult(ep, {"model": "fixture"}, {"model": "\n", "provider": " lab  "}, 1)
        self.assertEqual(result.model, "fixture")
        self.assertEqual(result.meta()["backend"], "system one (stdlib) via lab")

    def test_shared_cost_estimate(self):
        for registry_type, result_type, args in (
            (decision.DecisionEndpoint, decision.DecisionResult, ()),
            (llm.LlmEndpoint, llm.LlmResult, ("none",)),
        ):
            config_type = decision.DecisionConfig if registry_type is decision.DecisionEndpoint else llm.EndpointConfig
            ep = endpoint(config_type, registry_type, price_per_mtok_input=2, price_per_mtok_output=4)
            request = {"model": "m"}
            usage = {"prompt_tokens": 2, "completion_tokens": 3}
            result = result_type(ep, request, {"usage": usage}, 1, *args)
            self.assertEqual(result.cost_usd, 16 / 1e6)

    def test_decision_http_404(self):
        ep = endpoint(decision.DecisionConfig, decision.DecisionEndpoint)
        with patch.object(decision, "post_json", side_effect=http_error(404)):
            with self.assertRaisesRegex(decision.DecisionError, "check the model id and path"):
                ep.decide({}, {})

    def test_decision_retry_after(self):
        ep = endpoint(decision.DecisionConfig, decision.DecisionEndpoint)
        with patch.object(decision, "post_json", side_effect=http_error(429, Retry_After="10")) as post:
            with self.assertRaises(decision.DecisionError):
                ep.decide({}, {})
            with self.assertRaisesRegex(decision.DecisionError, "Try again"):
                ep.decide({}, {})
        post.assert_called_once()

    def test_decision_missing_type_is_compatible(self):
        questions = {"vector": {"criteria": {"a": None}}}
        answers, invalid = decision.check_answers({"answers": {"vector": {"choice": "a"}}}, questions)
        self.assertIsNone(invalid)
        self.assertEqual(answers["vector"]["type"], "choice")

    def test_decision_drops_unsolicited_answers(self):
        questions = {"motion": {"criteria": {"drive": None}}}
        response = {"answers": {"motion": {"choice": "drive"}, "vector": {"choice": "a"}}}
        self.assertEqual(set(decision.check_answers(response, questions)[0]), {"motion"})

    def test_decision_existing_response_for_valid_optional_fields(self):
        questions = {"headlights": {"criteria": {"low": None}}, "route": {"criteria": {"r1": None}}}
        response = {"answers": {"headlights": {"choice": "low"}, "route": {"choice": "r1"}}}
        answers, invalid = decision.check_answers(response, questions)
        self.assertIsNone(invalid)
        self.assertEqual(
            {key: answer["choice"] for key, answer in answers.items()}, {"headlights": "low", "route": "r1"}
        )

    def test_decision_probabilities_keep_only_offered_ids(self):
        questions = {"motion": {"criteria": {"drive": None}}}
        response = {"answers": {"motion": {"choice": "drive", "probabilities": {"drive": 0.3, "stop": 0.7}}}}
        self.assertEqual(decision.check_answers(response, questions)[0]["motion"]["probabilities"], {"drive": 0.3})

    def test_unpriced_usage_still_counts_by_direction(self):
        ep = endpoint(decision.DecisionConfig, decision.DecisionEndpoint)
        result = decision.DecisionResult(ep, {"model": "m"}, {"usage": {"input_tokens": 2, "output_tokens": 3}}, 1)
        ep.record(result)
        self.assertEqual((ep.stats()["input_tokens"], ep.stats()["output_tokens"]), (2, 3))
        self.assertFalse(result.meta()["cost_known"])

    def test_optional_headlights_need_no_llm_candidate(self):
        answer, invalid = llm.parse_answer('{"headlights":"Low"}', {"headlights": ["low", "high"]})
        self.assertIsNone(invalid)
        self.assertEqual(answer, {"headlights": "low"})

    def test_llm_does_not_copy_unsolicited_motion(self):
        answer, invalid = llm.parse_answer('{"motion":"reverse","candidate":"a"}', {"candidate": ["a"]})
        self.assertIsNone(invalid)
        self.assertEqual(answer, {"candidate": "a"})

    def test_response_format_reason_field_is_not_required(self):
        raw = llm.response_format_for("json_schema", {"motion": ["stop"]})
        self.assertFalse(raw["json_schema"]["schema"]["additionalProperties"])
        self.assertNotIn("reason", raw["json_schema"]["schema"]["required"])

    def test_anthropic_moves_all_system_messages_in_original_order(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, api="anthropic")
        messages = [
            {"role": "system", "content": "First"},
            {"role": "user", "content": "Choose"},
            {"role": "system", "content": "Second"},
        ]
        payload = llm.anthropic_payload(ep.config, messages, {}, "none")
        self.assertEqual(payload["system"][0]["text"], "First\n\nSecond")
        self.assertEqual(payload["messages"], [messages[1]])

    def test_anthropic_thinking_only_has_no_answer(self):
        self.assertEqual(llm._anthropic_text({"content": [{"type": "thinking", "thinking": "private"}]}), ("", ""))

    def test_no_system_message_means_no_anthropic_cache_block(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint, api="anthropic")
        payload = llm.anthropic_payload(ep.config, LLM_REQUEST["messages"], {}, "none")
        self.assertNotIn("system", payload)

    def test_anthropic_trace_keeps_original_response(self):
        response = {"content": [{"type": "thinking", "signature": "opaque"}]}
        self.assertEqual(llm.without_signatures(response)["content"][0]["signature"], "")
        self.assertEqual(response["content"][0]["signature"], "opaque")

    def test_structured_chat_schema_for_route_only(self):
        fmt = llm.response_format_for("json_schema", {"route": ["left", "right"]})
        schema = fmt["json_schema"]["schema"]
        self.assertEqual(schema["required"], ["route"])
        self.assertEqual(schema["properties"]["route"]["enum"], ["left", "right"])

    def test_usage_cost_zero_stays_authoritative(self):
        ep = endpoint(decision.DecisionConfig, decision.DecisionEndpoint, price_per_mtok_input=1.5)
        result = decision.DecisionResult(ep, {"model": "m"}, {"usage": {"input_tokens": 1000, "cost": 0}}, 1)
        self.assertEqual(result.cost_usd, 0)
        self.assertTrue(result.meta()["cost_known"])

    def test_invalid_probability_does_not_discard_valid_decision(self):
        questions = {"vector": {"criteria": {"a": None}}}
        response = {"answers": {"vector": {"choice": "a", "confidence": False, "probabilities": {"a": -1}}}}
        answers, invalid = decision.check_answers(response, questions)
        self.assertIsNone(invalid)
        self.assertEqual(answers["vector"], {"type": "choice", "choice": "a", "confidence": None, "probabilities": {}})

    def test_null_option_descriptions_survive_validation(self):
        body = {
            "state": {},
            "questions": {"vector": {"type": "choice", "instructions": "Choose", "criteria": {"a": None}}},
        }
        self.assertIsNone(decide.validate_request(body)["questions"]["vector"]["criteria"]["a"])

    def test_request_identity_defaults(self):
        self.assertEqual(decide.request_sequence({}), (0, 0))
        out = llm.validate_request(LLM_REQUEST)
        self.assertEqual((out["tick"], out["epoch"]), (0, 0))


class CallContracts(unittest.TestCase):
    def test_confirmed_downgrade_survives_older_error(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint)
        messages, expect = LLM_REQUEST["messages"], LLM_REQUEST["expect"]
        old_retry_started = threading.Event()
        complete_old = threading.Event()
        errors = []
        requests = []

        def post(_url, payload, *_args):
            requests.append("response_format" in payload)
            if len(requests) == 1:
                raise http_error(400)
            if len(requests) == 2:
                old_retry_started.set()
                if not complete_old.wait(2):
                    raise RuntimeError("test did not release retry")
                raise http_error(400)
            return completion(), 1

        def drive():
            try:
                ep.chat(messages, expect)
            except llm.LlmError as err:
                errors.append(err.status)

        with patch.object(llm, "post_json", side_effect=post):
            worker = threading.Thread(target=drive)
            worker.start()
            try:
                self.assertTrue(old_retry_started.wait(1))
                ep.chat(messages, expect)
            finally:
                complete_old.set()
                worker.join(2)
        self.assertEqual(errors, [502])
        self.assertEqual(requests, [True, False, False])
        self.assertEqual(ep.public()["response_format"], "none")

    def test_anthropic_override_merges_without_mutating_config(self):
        ep = endpoint(
            llm.EndpointConfig, llm.LlmEndpoint, api="anthropic", extra_body={"output_config": {"effort": "low"}}
        )
        config = json.dumps(ep.config.extra_body)
        llm.anthropic_payload(ep.config, LLM_REQUEST["messages"], LLM_REQUEST["expect"], "json_schema")
        self.assertEqual(json.dumps(ep.config.extra_body), config)

    def test_no_catalog_key_is_sent_to_unknown_provider(self):
        with patch.object(llm_setup, "fetch_json") as fetch:
            with self.assertRaises(llm_setup.SetupError):
                llm_setup.list_models(Settings({}), {"provider": "unconfigured", "api_key": KEY})
        fetch.assert_not_called()

    def test_unkeyed_catalog_has_explicit_accept_header(self):
        with patch.object(endpoints._OPENER, "open", return_value=io.BytesIO(b"[]")) as open_:
            llm_setup.fetch_json("https://example.invalid/models", None, "Fixture", 1)
        request = open_.call_args.args[0]
        self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertNotIn("Authorization", dict(request.header_items()))
