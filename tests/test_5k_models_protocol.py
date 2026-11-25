"""Offline cases for the built-in and configured driving-model protocols."""

import io
import json
import unittest
import urllib.error
from unittest.mock import Mock, patch

from helpers import FakeClient
from test_decide import GOOD

from jev import client, decide, decision, endpoints, llm
from jev.config import Settings

LLM_REQUEST = {
    "endpoint": "fixture",
    "messages": [{"role": "user", "content": "Pick a candidate."}],
    "expect": {"motion": ["drive", "stop"], "candidate": ["a", "b"]},
}
BASE_CONFIG = {"name": "fixture", "base_url": "http://localhost:8000/v1", "model": "fixture-model"}
KEY = "fixture-key-" + "x" * 400


def endpoint(config_class, endpoint_class, **fields):
    problems = []
    config = config_class({**BASE_CONFIG, **fields}, "fixture entry", problems)
    if not config.ok or problems:
        raise AssertionError(problems)
    return endpoint_class(config, Settings({}), client.SpendGuard())


def completion(content='{"motion":"drive","candidate":"a"}', **fields):
    return {"choices": [{"message": {"content": content, **fields}}], "usage": {"prompt_tokens": 4}}


class DecisionRequests(unittest.TestCase):
    def test_non_object(self):
        with self.assertRaisesRegex(decide.InvalidRequest, "request must be a JSON object"):
            decide.validate_request(None)

    def test_safe_sequence(self):
        for body in (GOOD, LLM_REQUEST):
            validate = decide.validate_request if body is GOOD else llm.validate_request
            for field, value in (("tick", -1), ("epoch", 2**53), ("epoch", True)):
                with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError, "tick and epoch"):
                    validate(dict(body, **{field: value}))
            self.assertEqual(validate(dict(body, tick=2**53 - 1))["tick"], 2**53 - 1)

    def test_state(self):
        deep = []
        for _ in range(decide.MAX_STATE_DEPTH):
            deep = [deep]
        for state, detail in (
            ({"x": deep}, "nested"),
            ({1: "a"}, "keys must be strings"),
            ({"x": (1, 2)}, "JSON values"),
            ({"\ud800": "a"}, "keys must contain valid Unicode"),
            ({"x": ["\ud800"]}, "strings must contain valid Unicode"),
        ):
            with self.subTest(detail=detail), self.assertRaisesRegex(decide.InvalidRequest, detail):
                decide.validate_request(dict(GOOD, state=state))

    def test_choice_fields(self):
        question = GOOD["questions"]["vector"]
        for fields, detail in (
            ({"instructions": "\ud800"}, "instructions contain invalid Unicode"),
            ({"criteria": {"x" * 65: None}}, "criteria ids"),
            ({"criteria": {"\ud800": None}}, "criteria ids"),
            ({"criteria": {"x": "x" * 6001}}, "criterion text"),
            ({"criteria": {"x": "\ud800"}}, "criterion text"),
            ({"criteria": {str(i): "x" * 5500 for i in range(6)}}, "questions are larger"),
        ):
            body = dict(GOOD, questions={"vector": dict(question, **fields)})
            with self.subTest(detail=detail), self.assertRaisesRegex(decide.InvalidRequest, detail):
                decide.validate_request(body)

    def test_question_allowlist(self):
        question = GOOD["questions"]["vector"]
        body = dict(GOOD, questions={"vector": dict(question, extra="metadata")})
        clean = decide.validate_request(body)["questions"]["vector"]
        self.assertEqual(clean, question)
        clean["criteria"].clear()
        self.assertTrue(question["criteria"])

    def test_builtin_answers(self):
        picked = FakeClient(picker=lambda _s, _q: {"motion": "reverse", "vector": "hard_brake", "extra": "a"})
        result = decide.jev_decide(picked, GOOD)
        self.assertEqual(set(result["answers"]), {"vector"})
        self.assertIn("motion", result["trace"]["response"]["answers"])

    def test_builtin_wrong_answer_type(self):
        driver = Mock()
        driver.system_one.return_value = client.JevResult(
            GOOD, {"answers": {"motion": {"type": "score", "choice": "stop"}, "vector": 0}}, 1
        )
        self.assertEqual(decide.jev_decide(driver, GOOD)["answers"], {})

    def test_decision_trace_depth_does_not_change_answers(self):
        ep = endpoint(decision.DecisionConfig, decision.DecisionEndpoint)
        deep = []
        for _ in range(endpoints.MAX_TRACE_DEPTH):
            deep = [deep]
        answer = {"answers": {"motion": {"choice": "drive"}, "vector": {"choice": "hard_brake"}}}
        with patch.object(decision, "post_json", return_value=({**answer, "extra": deep}, 3)):
            out = decision.decision_decide(Mock(get=Mock(return_value=ep)), GOOD)
        self.assertIsNone(out["invalid"])
        self.assertEqual(out["answers"]["motion"]["choice"], "drive")
        self.assertIn("note", out["trace"]["response"])

    def test_non_string_choice_is_not_echoed(self):
        _, invalid = decision.check_answers(
            {"answers": {"motion": {"choice": {"text": "malformed"}}}}, GOOD["questions"]
        )
        self.assertIn("no choice id", invalid)
        self.assertNotIn("malformed", invalid)


class LanguageModelReplies(unittest.TestCase):
    def test_request_bytes_and_unicode(self):
        for content, detail in (("🚙" * 33_000, "UTF-8 bytes"), ("\ud800", "valid Unicode")):
            body = dict(LLM_REQUEST, messages=[{"role": "user", "content": content}])
            with self.subTest(detail=detail), self.assertRaisesRegex(llm.InvalidLlmRequest, detail):
                llm.validate_request(body)

    def test_request_object(self):
        with self.assertRaisesRegex(llm.InvalidLlmRequest, "request must be a JSON object"):
            llm.validate_request([])

    def test_reply_content_parts(self):
        content = [
            {"type": "text", "text": '{"motion":'},
            {"type": "image", "text": "ignored"},
            {"text": None},
            {"text": '"drive"}'},
        ]
        self.assertEqual(llm._message_text(completion(content)), ('{"motion":"drive"}', ""))

    def test_reply_wrong_content_type(self):
        with self.assertRaisesRegex(ValueError, "content must be text"):
            llm._message_text(completion({"motion": "drive"}))

    def test_openai_finish_reasons(self):
        for finish, detail in (("length", "output token limit"), ("tool_calls", "attempted a tool call")):
            response = completion()
            response["choices"][0]["finish_reason"] = finish
            with self.subTest(finish=finish), self.assertRaisesRegex(ValueError, detail):
                llm._message_text(response)
        response["choices"][0]["finish_reason"] = "content_filter"
        self.assertEqual(llm._message_text(response), ("", "the provider filtered the completion"))

    def test_explicit_refusal_wins_over_text(self):
        self.assertEqual(llm._message_text(completion(refusal="Declined.")), ("", "Declined."))

    def test_anthropic_empty_refusal(self):
        self.assertEqual(
            llm._anthropic_text({"stop_reason": "refusal", "stop_details": {"explanation": []}}), ("", "declined")
        )

    def test_anthropic_requires_finished_decision(self):
        for reason in ("tool_use", "pause_turn"):
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, "before returning"):
                llm._anthropic_text({"stop_reason": reason})

    def test_oversize_completion(self):
        with self.assertRaisesRegex(ValueError, "reply is longer"):
            llm._message_text(completion('{"motion":"drive"}' + " " * llm.MAX_CONTENT_CHARS))

    def test_invalid_unicode_completion(self):
        with self.assertRaisesRegex(ValueError, "invalid Unicode"):
            llm._message_text(completion("\ud800"))

    def test_json_no_array_or_duplicate(self):
        for content in ('[{"motion":"drive"}]', '{"motion":"stop","motion":"drive"}', '{"outer": {"inner": {}}'):
            with self.subTest(content=content):
                self.assertIsNone(llm.extract_json(content))

    def test_fence_precedes_prose(self):
        content = 'Example {"motion":"stop"}.\n```json\n{"motion":"drive"}\n```'
        self.assertEqual(llm.extract_json(content), {"motion": "drive"})
        self.assertIsNone(llm.extract_json('```json\n[{"motion":"drive"}]\n```'))

    def test_literal_think_markup(self):
        content = '{"reason":"Start at the <think> sign", "candidate":"a"}'
        self.assertEqual(llm.extract_json(content)["reason"], "Start at the <think> sign")
        wrapped = "<think>one</think><THINK>two</THINK>" + content
        self.assertEqual(llm.extract_json(wrapped), llm.extract_json(content))

    def test_nested_decision_limit(self):
        content = '{"candidate":"a","reason":' + "[" * 17 + "0" + "]" * 17 + "}"
        self.assertIsNone(llm.extract_json(content))

    def test_normalized_duplicate_field(self):
        self.assertIn("repeated", llm.parse_answer('{"Motion":"stop","motion":"drive"}', {"motion": ["drive"]})[1])

    def test_alias_conflicts(self):
        self.assertIn(
            "conflicting aliases for candidate",
            llm.parse_answer('{"candidate":"a","choice":"b"}', {"candidate": ["a", "b"]})[1],
        )
        self.assertEqual(llm.parse_answer('{"route":"a","route_id":"b"}', {"route": ["a", "b"]}), ({}, None))

    def test_case_collision_and_nonfinite_id(self):
        self.assertIsNone(llm._match("aB", ["ab", "AB"]))
        self.assertEqual(llm._match("AB", ["ab", "AB"]), "AB")
        self.assertIsNone(llm._match(float("inf"), ["inf"]))

    def test_reason_unicode(self):
        self.assertEqual(
            llm.parse_answer(r'{"candidate":"a","reason":"\ud800"}', {"candidate": ["a"]})[0]["reason"], ""
        )

    def test_interpreted_invalid_answer_is_counted(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint)
        with patch.object(llm, "post_json", return_value=(completion('{"motion":"drive","candidate":"elsewhere"}'), 3)):
            out = llm.llm_decide(Mock(get=Mock(return_value=ep)), LLM_REQUEST)
        self.assertEqual(ep.stats()["errors"], 1)
        self.assertEqual(ep.stats()["calls"], 1)
        self.assertEqual(ep.stats()["input_tokens"], 4)
        self.assertIn("eligible manoeuvre", out["invalid"])

    def test_refusal_and_reason_excerpt_hide_long_key(self):
        ep = endpoint(llm.EndpointConfig, llm.LlmEndpoint)
        ep._key = KEY
        registry = Mock(get=Mock(return_value=ep))
        content = json.dumps({"motion": "drive", "candidate": "a", "reason": "secret " + KEY})
        for response in (completion(content), completion(refusal="key " + KEY)):
            with patch.object(llm, "post_json", return_value=(response, 3)):
                out = llm.llm_decide(registry, LLM_REQUEST)
            self.assertNotIn(KEY[:120], json.dumps(out))


class UsageAndTypeSafe(unittest.TestCase):
    def test_fractional_usage(self):
        self.assertEqual(client.tokens(3.5), 0)
        self.assertEqual(client.tokens(3.0), 3)

    def test_aliases_and_zero(self):
        usage = {"input_tokens": None, "prompt_tokens": "10", "output_tokens": 0, "completion_tokens": 45}
        result = client.JevResult({"model": "m"}, {"usage": usage}, 1)
        self.assertEqual((result.input_tokens, result.output_tokens), (10, 0))

    def test_metadata_model_fallback(self):
        for model in (False, " ", None):
            result = client.JevResult({"model": "m"}, {"model": model}, 1)
            self.assertEqual(result.model, "m")

    def test_deep_provider_metadata(self):
        response = {}
        current = response
        for _ in range(1000):
            child = {}
            current["nested"] = child
            current = child
        result = client.JevResult({}, response, 1)
        self.assertIn("nested provider data omitted", json.dumps(result.response))

    def test_invalid_cost_does_not_reduce_budget(self):
        guard = client.SpendGuard()
        for cost in (-1, float("nan"), True, "1", float("inf")):
            with self.subTest(cost=cost), self.assertRaisesRegex(ValueError, "cost must be finite"):
                guard.record(Mock(input_tokens=1, output_tokens=1, cost_usd=cost))
        self.assertEqual(guard.live_calls, 0)

    def test_rate_limit_reports_next_slot(self):
        guard = client.SpendGuard(rpm=1)
        with patch.object(client.time, "monotonic", side_effect=[20, 25.4]):
            guard.check()
            with self.assertRaisesRegex(client.JevError, "55 s"):
                guard.check()

    def test_constructor_normalizes_key_and_checks_timeout(self):
        settings = Settings({})
        self.assertEqual(client.JevClient(settings, api_key=" k ").api_key, "k")
        for value in (0, -1, float("inf"), True):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "timeout"):
                client.JevClient(settings, timeout=value)

    def test_builtin_keeps_key_out_of_replies_and_failures(self):
        driver = client.JevClient(Settings({}), api_key=KEY)
        with patch.object(driver, "_post_system_one", return_value={"message": KEY, "usage": {"input_tokens": 5}}):
            out = driver.system_one({"key": KEY}, {})
        self.assertNotIn(KEY, json.dumps(out.trace()))
        self.assertEqual(out.input_tokens, 5)
        with patch.object(driver, "_post_system_one", side_effect=client.JevError(KEY, status=429, body={KEY: KEY})):
            with self.assertRaises(client.JevError) as caught:
                driver.system_one({}, {})
        self.assertEqual(caught.exception.status, 429)
        self.assertNotIn(KEY, str(caught.exception) + json.dumps(caught.exception.body))

    def test_builtin_stdlib_deadline_and_no_post_retry(self):
        driver = client.JevClient(Settings({}), api_key=KEY, timeout=6)
        failure = urllib.error.HTTPError("https://example.invalid", 402, "credit limit", {}, None)
        with (
            patch.object(client, "TypeSafeClient", None),
            patch.object(endpoints, "post_json", side_effect=failure) as post,
        ):
            with self.assertRaisesRegex(client.JevError, "out of credits"):
                driver.system_one({}, {})
        post.assert_called_once()
        self.assertEqual(driver.guard.live_calls, 0)

    def test_sdk_no_post_retries(self):
        driver = client.JevClient(Settings({}), api_key=KEY)
        with patch.object(client, "TypeSafeClient") as factory, patch.object(client, "RetryPolicy") as retry:
            driver._sdk_client()
        retry.assert_called_once_with(max_retries=0, timeout=30)
        factory.assert_called_once()

    def test_builtin_model_list_requires_object(self):
        driver = client.JevClient(Settings({}), api_key=KEY)
        with patch.object(driver, "_models", return_value=[]), self.assertRaisesRegex(client.JevError, "model list"):
            driver.models()

    def test_builtin_model_list_redacts_payload(self):
        driver = client.JevClient(Settings({}), api_key=KEY)
        with patch.object(driver, "_models", return_value={"data": [{KEY: float("inf")}]}):
            self.assertEqual(driver.models(), {"data": [{"***": None}]})

    def test_fallback_model_list_size(self):
        driver = client.JevClient(Settings({}), api_key=KEY)
        with patch.object(endpoints._OPENER, "open", return_value=io.BytesIO(b" " * (client.MAX_MODEL_BYTES + 1))):
            with self.assertRaisesRegex(client.JevError, "model list is too large"):
                driver._stdlib_request("GET", "/v1/models", None)

    def test_retry_date_and_invalid_values(self):
        with patch.object(client.time, "time", return_value=1_000_000):
            self.assertEqual(client.retry_delay("Mon, 12 Jan 1970 13:47:00 GMT"), 20)
        for value in (None, "", "invalid", "-2", "nan", "inf"):
            with self.subTest(value=value):
                self.assertIsNone(client.retry_delay(value))

    def test_provider_error_scrubs_before_excerpt(self):
        message = client._error_message(529, {"detail": {"message": "prefix " + KEY}}, KEY)
        self.assertIn("overloaded", message)
        self.assertNotIn(KEY[:30], message)

    def test_probability_helpers(self):
        self.assertEqual(client.chosen({"choice": "a", "probabilities": [1], "confidence": 0.25}), ("a", 0.25))
        self.assertEqual(
            client.ranked({"probabilities": {"a": 0.5, "b": float("nan"), "c": 2, "d": 10**500}}),
            [{"value": "a", "prob": 0.5}],
        )
        self.assertEqual(client.ranked({"probabilities": {"a": 0.5}}, limit=-1), [])
