"""Decision-model drivers (jev/decision.py) and their setup (jev/decision_setup.py) against a mock
System One server. No network, no real key, and never the project's own .env."""

import http.client
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import helpers  # noqa: F401  (puts the project root on sys.path)

import server
from jev import decision, decision_setup, llm, llm_setup, security
from jev.client import JevClient, JevError, SpendGuard
from jev.config import PROJECT_ROOT, Settings
from test_llm import SLACK, MockLLM

SECRET = "sk-or-test-DECISION-secret-1357"
STATE = {"ego": {"speed_mps": 9.5}, "nav": {"next_turn": "left"}}
QUESTIONS = {
    "motion": {"type": "choice", "instructions": "Drive or stop?", "criteria": {"drive": "keep going", "stop": None}},
    "vector": {"type": "choice", "instructions": "Which manoeuvre?",
               "criteria": {"keep_lane_target": "hold the lane", "stop_at_line": None, "hard_brake": None}},
}
ROUTE = {"type": "choice", "instructions": "Which route?", "criteria": {"r0": None, "r1": None}}


def reply(answers=None, **extra):
    answers = answers if answers is not None else {
        "motion": {"type": "choice", "choice": "drive", "probabilities": {"drive": 0.9, "stop": 0.1}, "confidence": 0.8},
        "vector": {"type": "choice", "choice": "keep_lane_target",
                   "probabilities": {"keep_lane_target": 0.7, "stop_at_line": 0.2, "hard_brake": 0.1}, "confidence": 0.6}}
    return {"model": "jev-1.13.0", "answers": answers, "usage": {"input_tokens": 2000, "output_tokens": 40}, **extra}


def base(mock):
    return "http://127.0.0.1:%d" % mock.httpd.server_port


class DecisionTestCase(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (self.root / ".gitignore").write_text(".env\n")

    def mock(self, answer=None):
        m = MockLLM(answer or (lambda h, body: (200, reply(), {})))
        self.addCleanup(m.close)
        return m

    def settings(self, endpoints=None, environ=None):
        path = self.root / "decision.json"
        if endpoints is not None:
            path.write_text(json.dumps({"endpoints": endpoints}))
        return Settings(environ={"JEV_FSD_DECISION_ENDPOINTS": str(path), "JEV_FSD_LLM_ENDPOINTS": str(self.root / "llm.json"),
                                 **(environ or {})}, env_file=self.root / ".env")

    def registry(self, endpoints, environ=None, budget=10.0, rpm=100):
        return decision.DecisionRegistry(self.settings(endpoints, environ), SpendGuard(budget, rpm))

    def decide(self, registry, name, questions=QUESTIONS, **extra):
        return decision.decision_decide(registry, {"endpoint": name, "tick": 4, "epoch": 2, "state": STATE,
                                                   "questions": questions, **extra})


class ConfigTests(DecisionTestCase):
    def test_entries_are_validated_with_paths_and_https_for_keys(self):
        reg = self.registry([
            {"name": "or", "base_url": "https://openrouter.ai/", "path": "/api/alpha/decisions", "check_path": "/api/v1/key",
             "model": "liquid/d1", "api_key_env": "OPENROUTER_API_KEY", "price_per_mtok_input": 0.02},
            {"name": "local", "base_url": "http://localhost:8080", "model": "kev-4b", "rpm": 0},
            {"name": "plain", "base_url": "http://decide.example.com", "model": "m", "api_key_env": "K"},
            {"name": "leaky", "base_url": "https://x.example", "model": "m", "api_key": SECRET},
            {"name": "badpath", "base_url": "https://x.example", "model": "m", "path": "/v1/../admin"},
            {"name": "query", "base_url": "https://x.example", "model": "m", "path": "/v1/systemone?x=1"},
            {"name": "or", "base_url": "https://dup.example", "model": "m"},
        ])
        self.assertEqual(sorted(reg.endpoints), ["local", "or"])
        local = reg.get("local").config
        self.assertEqual((local.path, local.check_path, local.timeout_s, local.rpm), ("/v1/systemone", "/v1/models", 5.0, 0))
        joined = " | ".join(reg.problems)
        for fragment in ("https://", "do not put keys", "path and check_path", "defined twice"):
            self.assertIn(fragment, joined)
        self.assertEqual(len(reg.problems), 5)
        self.assertNotIn(SECRET, joined)
        public = reg.get("or").public()
        self.assertEqual((public["id"], public["endpoint"], public["path"], public["key"], public["usable"]),
                         ("decision:or", "https://openrouter.ai", "/api/alpha/decisions", "missing", False))

    def test_the_committed_example_loads_without_problems(self):
        settings = Settings(environ={"JEV_FSD_DECISION_ENDPOINTS": str(PROJECT_ROOT / "data" / "decision-endpoints.example.json")},
                            env_file=self.root / ".env")
        reg = decision.DecisionRegistry(settings, SpendGuard())
        self.assertEqual(reg.problems, [])
        self.assertGreaterEqual(len(reg.endpoints), 3)


class DecideTests(DecisionTestCase):
    def test_the_jev_request_goes_to_the_configured_path_with_the_key_and_answers_come_back_clean(self):
        mock = self.mock()
        reg = self.registry([{"name": "ts", "base_url": base(mock), "model": "jev-latest", "api_key_env": "K",
                              "price_per_mtok_input": 0.042}], environ={"K": SECRET})
        out = self.decide(reg, "ts", model="other", base_url="http://169.254.169.254")
        sent = mock.requests[0]
        self.assertEqual(sent["path"], "/v1/systemone")
        self.assertEqual(sent["body"], {"model": "jev-latest", "state": STATE, "questions": QUESTIONS})   # the browser chooses neither
        self.assertEqual(sent["headers"]["Authorization"], "Bearer " + SECRET)
        self.assertIsNone(out["invalid"])
        self.assertEqual((out["tick"], out["epoch"]), (4, 2))
        self.assertEqual(out["answers"]["vector"]["choice"], "keep_lane_target")
        self.assertAlmostEqual(out["answers"]["motion"]["probabilities"]["drive"], 0.9)
        meta = out["meta"]
        self.assertEqual((meta["source"], meta["model"], meta["input_tokens"], meta["output_tokens"], meta["question_count"]),
                         ("decision:ts", "jev-1.13.0", 2000, 40, 2))
        self.assertTrue(meta["live_call"] and meta["cost_known"])
        self.assertAlmostEqual(meta["cost_usd"], 2000 * 0.042 / 1e6)
        self.assertEqual(out["trace"]["request"]["url"], base(mock) + "/v1/systemone")
        self.assertEqual(out["trace"]["request"]["api_key_env"], "K")
        self.assertNotIn(SECRET, json.dumps(out))
        self.assertEqual(reg.guard.snapshot()["live_calls"], 1)
        self.assertEqual(reg.get("ts").public()["calls"], 1)

    def test_a_provider_reported_cost_wins_and_openrouter_errors_are_read(self):
        mock = self.mock(lambda h, body: (200, reply(id="gen-1", provider="Liquid", usage={"input_tokens": 1000, "cost": 0.0005}), {}))
        reg = self.registry([{"name": "or", "base_url": base(mock), "path": "/api/alpha/decisions", "model": "liquid/d1",
                              "price_per_mtok_input": 99}])
        meta = self.decide(reg, "or")["meta"]
        self.assertEqual(mock.requests[0]["path"], "/api/alpha/decisions")
        self.assertAlmostEqual(meta["cost_usd"], 0.0005)
        self.assertIn("via Liquid", meta["backend"])
        self.assertAlmostEqual(reg.guard.snapshot()["spent_usd"], 0.0005)
        unpriced = self.registry([{"name": "free", "base_url": base(self.mock()), "model": "kev"}])
        meta = self.decide(unpriced, "free")["meta"]
        self.assertEqual((meta["cost_usd"], meta["cost_known"]), (0.0, False))

    def test_answers_outside_the_options_are_invalid_but_the_call_still_counts(self):
        good = reply()["answers"]
        cases = {
            "unknown choice": {**good, "vector": {"type": "choice", "choice": "fly", "probabilities": {"fly": 1}}},
            "noul answer": {**good, "motion": {"type": "noul", "noul": 0.9}},
            "missing question": {"motion": good["motion"]},
            "no answers": None,
        }
        for name, answers in cases.items():
            with self.subTest(name=name):
                body = reply(answers) if answers is not None else {"model": "m", "usage": {"input_tokens": 500}}
                reg = self.registry([{"name": "d", "base_url": base(self.mock(lambda h, b, body=body: (200, body, {}))), "model": "m"}])
                out = self.decide(reg, "d")
                self.assertEqual(out["answers"], {})
                self.assertTrue(out["invalid"])
                self.assertEqual(out["meta"]["invalid"], out["invalid"])
                self.assertTrue(out["meta"]["live_call"])
                self.assertEqual(reg.guard.snapshot()["live_calls"], 1)
                self.assertEqual(reg.get("d").public()["errors"], 1)

    def test_probabilities_are_cleaned_and_an_unusable_route_answer_is_dropped(self):
        answers = {**reply()["answers"], "route": {"type": "choice", "choice": "r9"}}
        answers["vector"] = dict(answers["vector"], probabilities={"keep_lane_target": 0.7, "hard_brake": 2, "stop_at_line": True,
                                                                   "injected": 0.5}, confidence=float("nan"))
        mock = self.mock(lambda h, body: (200, json.dumps(reply(answers)).encode(), {}))   # NaN arrives as a JSON constant
        reg = self.registry([{"name": "d", "base_url": base(mock), "model": "m"}])
        out = self.decide(reg, "d", questions={**QUESTIONS, "route": ROUTE})
        self.assertIsNone(out["invalid"])
        self.assertNotIn("route", out["answers"])
        self.assertEqual(out["answers"]["vector"]["probabilities"], {"keep_lane_target": 0.7})
        self.assertIsNone(out["answers"]["vector"]["confidence"])

    def test_a_route_only_question_survives_a_reply_without_answers(self):
        reg = self.registry([{"name": "d", "base_url": base(self.mock(lambda h, b: (200, {"model": "m", "usage": {"input_tokens": 500}}, {}))),
                              "model": "m"}])
        out = self.decide(reg, "d", questions={"route": ROUTE})
        self.assertIsNone(out["invalid"])
        self.assertEqual(out["answers"], {})
        self.assertEqual(reg.get("d").public()["errors"], 0)

    def test_http_errors_map_to_statuses_without_leaking_the_key(self):
        cases = [(401, {"detail": {"message": "bad key %s" % SECRET}}, 401, "rejected the API key"),
                 (402, {"error": {"code": 402, "message": "Insufficient credits"}}, 402, "out of credits"),
                 (429, {"error": {"message": "slow down"}}, 429, "rate limited"),
                 (529, {"detail": "overloaded"}, 429, "overloaded"),
                 (422, {"detail": [{"loc": ["questions"], "msg": "noul criteria must be strings"}]}, 502, "noul criteria"),
                 (500, b"<html>oops</html>", 502, "HTTP 500")]
        for code, body, status, fragment in cases:
            with self.subTest(code=code):
                reg = self.registry([{"name": "d", "base_url": base(self.mock(lambda h, b, code=code, body=body: (code, body, {}))),
                                      "model": "m", "api_key_env": "K"}], environ={"K": SECRET})
                with self.assertRaises(decision.DecisionError) as ctx:
                    self.decide(reg, "d")
                self.assertEqual(ctx.exception.status, status)
                self.assertIn(fragment, str(ctx.exception))
                self.assertNotIn(SECRET, str(ctx.exception) + json.dumps(ctx.exception.body))
                self.assertEqual(reg.guard.snapshot()["live_calls"], 0)
                self.assertIn(fragment, reg.get("d").public()["last_error"])

    def test_no_key_budget_and_rate_limits_stop_calls_before_they_are_made(self):
        mock = self.mock()
        reg = self.registry([{"name": "keyed", "base_url": base(mock), "model": "m", "api_key_env": "MISSING"}])
        with self.assertRaises(decision.DecisionError) as ctx:
            self.decide(reg, "keyed")
        self.assertEqual(ctx.exception.status, 401)
        self.assertIn("Connect a model", str(ctx.exception))
        spent = self.registry([{"name": "d", "base_url": base(mock), "model": "m"}], budget=0.01)
        spent.guard.spent_usd = 0.02
        with self.assertRaises(JevError) as ctx:
            self.decide(spent, "d")
        self.assertEqual(ctx.exception.status, 402)
        limited = self.registry([{"name": "d", "base_url": base(mock), "model": "m", "rpm": 1}])
        self.decide(limited, "d")
        with self.assertRaises(JevError) as ctx:
            self.decide(limited, "d")
        self.assertEqual(ctx.exception.status, 429)
        self.assertEqual(len(mock.requests), 1)

    def test_the_deadline_bounds_a_trickled_reply_and_redirects_are_refused(self):
        def trickle(h, body):
            data = json.dumps(reply()).encode()
            try:
                h.send_response(200)
                h.send_header("Content-Length", str(len(data)))
                h.end_headers()
                for i in range(0, len(data), 8):
                    h.wfile.write(data[i:i + 8])
                    h.wfile.flush()
                    time.sleep(0.1)
            except OSError:
                pass
        reg = self.registry([{"name": "slow", "base_url": base(self.mock(trickle)), "model": "m", "timeout_s": 1}])
        started = time.monotonic()
        with self.assertRaises(decision.DecisionError) as ctx:
            self.decide(reg, "slow")
        self.assertEqual(ctx.exception.status, 504)
        self.assertLess(time.monotonic() - started, 1 + SLACK)
        target = self.mock()
        source = self.mock(lambda h, body: (307, b"", {"Location": base(target) + "/v1/systemone"}))
        reg = self.registry([{"name": "r", "base_url": base(source), "model": "m", "api_key_env": "K"}], environ={"K": SECRET})
        with self.assertRaises(decision.DecisionError) as ctx:
            self.decide(reg, "r")
        self.assertIn("redirected", str(ctx.exception))
        self.assertEqual(target.requests, [])

    def test_bad_requests_and_unknown_endpoints_are_refused(self):
        reg = self.registry([{"name": "d", "base_url": base(self.mock()), "model": "m"}])
        for body in ({"endpoint": "d", "state": "x", "questions": QUESTIONS},
                     {"endpoint": "d", "state": STATE, "questions": {"motion": {"type": "noul", "instructions": "x"}}},
                     {"endpoint": "nope", "state": STATE, "questions": QUESTIONS},
                     {"endpoint": "http://169.254.169.254", "state": STATE, "questions": QUESTIONS}):
            with self.subTest(body=str(body)[:60]), self.assertRaises(decision.InvalidDecisionRequest):
                decision.decision_decide(reg, body)


class CheckTests(DecisionTestCase):
    def test_status_probe_uses_the_check_path(self):
        ok = self.mock(lambda h, body: (200, {"data": []}, {}))
        rejected = self.mock(lambda h, body: (401, {"error": {"message": "No auth"}}, {}))
        closed = self.mock()
        url = base(closed)
        closed.close()
        reg = self.registry([
            {"name": "ok", "base_url": base(ok), "model": "m", "check_path": "/api/v1/key", "api_key_env": "K"},
            {"name": "rejected", "base_url": base(rejected), "model": "m", "api_key_env": "K"},
            {"name": "down", "base_url": url, "model": "m"},
            {"name": "nokey", "base_url": base(ok), "model": "m", "api_key_env": "MISSING"},
        ], environ={"K": SECRET})
        statuses = {s["name"]: s["status"] for s in reg.check_all(force=True)}
        self.assertEqual(statuses, {"ok": "ready", "rejected": "key rejected", "down": "unreachable", "nokey": "no key"})
        self.assertEqual(ok.requests[0]["path"], "/api/v1/key")
        self.assertEqual(ok.requests[0]["headers"]["Authorization"], "Bearer " + SECRET)

    def test_a_trickled_status_reply_cannot_outlast_the_probe_deadline(self):
        def trickle(h, body):
            try:
                h.send_response(200)
                h.send_header("Content-Length", "400")
                h.end_headers()
                for _ in range(40):   # each byte arrives well inside the socket timeout
                    h.wfile.write(b" ")
                    h.wfile.flush()
                    time.sleep(0.1)
            except OSError:
                pass
        reg = self.registry([{"name": "slow", "base_url": base(self.mock(trickle)), "model": "m", "timeout_s": 1}])
        started = time.monotonic()
        status = reg.get("slow").check(force=True)
        self.assertLess(time.monotonic() - started, 1 + SLACK)
        self.assertEqual((status["status"], status["detail"]), ("unreachable", "no reply within 1 s"))


class SetupTests(DecisionTestCase):
    def setUp(self):
        super().setUp()
        self.s = self.settings()
        self.client = JevClient(self.s)
        self.reg = decision.DecisionRegistry(self.s, self.client.guard)

    def save(self, **body):
        return decision_setup.save(self.s, self.reg, self.client, body)

    def file(self):
        return json.loads((self.root / "decision.json").read_text())

    def test_the_typesafe_key_turns_on_the_built_in_jev_without_a_restart(self):
        self.assertFalse(self.client.configured)
        with self.assertRaises(llm_setup.SetupError):
            self.save(provider="typesafe", model="jev-latest")
        res = self.save(provider="typesafe", model="jev-latest", api_key=SECRET)
        self.assertEqual(res["id"], "jev")
        self.assertTrue(self.client.configured)
        self.assertEqual(self.client.api_key, SECRET)
        self.assertTrue(res["decision"]["jev"]["configured"])
        self.assertIn("TYPESAFE_API_KEY=%s" % SECRET, (self.root / ".env").read_text())
        self.assertFalse((self.root / "decision.json").exists())   # the built-in driver needs no entry
        self.assertNotIn(SECRET, json.dumps(res))

    def test_another_jev_version_becomes_its_own_driver_on_the_typesafe_key(self):
        self.save(provider="typesafe", model="jev-latest", api_key=SECRET)
        res = self.save(provider="typesafe", model="jev-preview", price_per_mtok_input=0.042)
        self.assertEqual(res["id"], "decision:jev-preview")
        entry = self.file()["endpoints"][0]
        self.assertEqual((entry["base_url"], entry["path"], entry["api_key_env"], entry["timeout_s"]),
                         ("https://api.typesafe.ai", "/v1/systemone", "TYPESAFE_API_KEY", 3))
        self.assertEqual(self.reg.get("jev-preview").api_key, SECRET)

    def test_openrouter_models_use_the_decisions_api_and_the_shared_key(self):
        res = self.save(provider="openrouter", model="perplexity/pplx-decider-v1.1-27b", api_key=SECRET, price_per_mtok_input=0.02)
        self.assertEqual(res["id"], "decision:pplx-decider-v1-1-27b")
        entry = self.file()["endpoints"][0]
        self.assertEqual((entry["base_url"], entry["path"], entry["check_path"], entry["api_key_env"]),
                         ("https://openrouter.ai", "/api/alpha/decisions", "/api/v1/key", "OPENROUTER_API_KEY"))
        self.assertNotIn(SECRET, (self.root / "decision.json").read_text())
        provider = next(p for p in res["decision"]["providers"] if p["id"] == "openrouter")
        self.assertTrue(provider["key_set"])
        llm_provider = next(p for p in llm_setup.providers_public(self.s) if p["id"] == "openrouter")
        self.assertTrue(llm_provider["key_set"])   # one key serves both pillars

    def test_a_custom_key_is_private_and_never_follows_a_new_url(self):
        self.save(provider="custom", name="lab", model="m", base_url="https://one.example.com", api_key=SECRET)
        var = self.file()["endpoints"][0]["api_key_env"]
        self.assertRegex(var, r"^JEV_FSD_DECISION_KEY_LAB_[0-9A-F]{8}$")
        self.assertEqual(self.file()["endpoints"][0].get("path", "/v1/systemone"), "/v1/systemone")
        with self.assertRaises(llm_setup.SetupError) as ctx:
            self.save(provider="custom", name="lab", model="m", base_url="https://two.example.com")
        self.assertIn("Paste the key again", str(ctx.exception))
        decision_setup.remove(self.s, self.reg, self.client, {"name": "lab"})
        self.assertFalse((self.root / ".env").exists())
        with self.assertRaises(llm_setup.SetupError):
            decision_setup.remove(self.s, self.reg, self.client, {"name": "jev"})   # the built-in driver stays

    def test_llama_cpp_needs_no_key_and_skips_the_rate_limit(self):
        self.save(provider="llamacpp", model="kev-4b-q4_k_m.gguf")
        entry = self.file()["endpoints"][0]
        self.assertEqual((entry["base_url"], entry["rpm"], entry["timeout_s"]), ("http://localhost:8080", 0, 20))
        self.assertNotIn("api_key_env", entry)


class ModelListTests(DecisionTestCase):
    def setUp(self):
        super().setUp()
        self.s = self.settings()

    def test_openrouters_decision_catalog_is_loaded_without_a_key(self):
        catalog = {"data": [{"id": "liquid/d1", "name": "LiquidAI: d1", "pricing": {"prompt": "0.00000002", "completion": "0"},
                             "context_length": 65536},
                            {"id": "typesafe/jev-1.14", "name": "TypeSafe: Jev 1.14", "pricing": {"prompt": "0.000000042", "completion": "0"}}]}
        mock = self.mock(lambda h, body: (200, catalog, {}))
        self.s.environ["OPENROUTER_API_KEY"] = SECRET
        with patch.object(decision_setup, "OPENROUTER_CATALOG", base(mock) + "/api/v1/models?output_modalities=decisions"):
            res = decision_setup.list_models(self.s, {"provider": "openrouter"})
        self.assertEqual(mock.requests[0]["path"], "/api/v1/models?output_modalities=decisions")
        self.assertNotIn("Authorization", mock.requests[0]["headers"])
        d1 = res["models"][0]
        self.assertEqual((d1["id"], d1["context_length"], d1["price_per_mtok_output"]), ("liquid/d1", 65536, 0))
        self.assertAlmostEqual(d1["price_per_mtok_input"], 0.02)
        self.assertEqual(res["endpoint"], "https://openrouter.ai/api/alpha/decisions")

    def test_typesafe_lists_the_documented_models_and_checks_a_typed_key(self):
        res = decision_setup.list_models(self.s, {"provider": "typesafe"})
        self.assertEqual([m["id"] for m in res["models"]][:2], ["jev-latest", "jev-preview"])
        self.assertTrue(all(m["price_per_mtok_input"] == 0.042 for m in res["models"]))
        live = self.mock(lambda h, body: (200, {"models": [   # TypeSafe's ModelMetadataList (api.typesafe.ai/openapi.json)
            {"name": "jev-1.15.0", "description": "Jev 1.15", "release_date": "2026-11-01"},
            {"name": "jev-latest", "description": "General-purpose system one model.", "release_date": "2026-09-15"}]}, {}))
        typesafe = dict(decision_setup.DECISION.by_id["typesafe"], base_url=base(live))
        with patch.dict(decision_setup.DECISION.by_id, {"typesafe": typesafe}):
            res = decision_setup.list_models(self.s, {"provider": "typesafe", "api_key": SECRET})
            self.assertEqual([m["id"] for m in res["models"]].count("jev-latest"), 1)
            self.assertIn("jev-1.15.0", [m["id"] for m in res["models"]])
            self.assertEqual(live.requests[0]["headers"]["Authorization"], "Bearer " + SECRET)
            rejecting = self.mock(lambda h, body: (403, {"detail": {"message": "Must supply an API key!"}}, {}))
            typesafe["base_url"] = base(rejecting)
            with self.assertRaises(llm_setup.SetupError) as ctx:
                decision_setup.list_models(self.s, {"provider": "typesafe", "api_key": "wrong"})
            self.assertIn("rejected the key", str(ctx.exception))
            closed = self.mock()
            typesafe["base_url"] = base(closed)
            closed.close()
            res = decision_setup.list_models(self.s, {"provider": "typesafe", "api_key": SECRET})
            self.assertIn("could not be loaded", res["note"])
            self.assertEqual(res["models"][0]["id"], "jev-latest")

    def test_a_local_server_lists_its_models(self):
        mock = self.mock(lambda h, body: (200, {"data": [{"id": "kev-4b.gguf"}]}, {}))
        res = decision_setup.list_models(self.s, {"provider": "custom", "base_url": base(mock)})
        self.assertEqual(mock.requests[0]["path"], "/v1/models")
        self.assertEqual([m["id"] for m in res["models"]], ["kev-4b.gguf"])


class ServerTests(DecisionTestCase):
    """The browser-facing routes: the session token, both pillars reloading together, no key in replies."""

    def setUp(self):
        super().setUp()
        self.upstream = self.mock(lambda h, body: (200, reply(note=SECRET) if body is not None else {"data": []}, {}))
        self.s = self.settings([{"name": "mock", "base_url": base(self.upstream), "model": "m", "api_key_env": "K"}],
                               environ={"K": SECRET})
        self.client = JevClient(self.s)
        for name, value in (("settings", self.s), ("client", self.client),
                            ("decision_registry", decision.DecisionRegistry(self.s, self.client.guard)),
                            ("llm_registry", llm.LlmRegistry(self.s, self.client.guard))):
            self.enterContext(patch.object(server, name, value))

        class QuietHandler(server.Handler):
            def log_message(self, _fmt, *_args):
                pass
        self.enterContext(patch.object(server, "log", lambda msg: None))
        self.httpd = server.LocalServer(("127.0.0.1", 0), QuietHandler)
        QuietHandler.port = self.httpd.server_port
        thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)

    def request(self, method, path, body=None, token=True):
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=5)
        headers = {"Host": "127.0.0.1:%d" % self.httpd.server_port, "Content-Type": "application/json"}
        if token:
            headers[security.TOKEN_HEADER] = server.SESSION_TOKEN
        try:
            conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
            resp = conn.getresponse()
            return resp.status, resp.read()
        finally:
            conn.close()

    def test_routes_are_post_only_and_need_the_session_token(self):
        for path in ("/api/decision/decide", "/api/decision/check", "/api/decision/models", "/api/decision/save", "/api/decision/remove"):
            self.assertIn(("POST", path), server.ROUTES)
            self.assertNotIn(("GET", path), server.ROUTES)
            self.assertEqual(self.request("POST", path, {}, token=False)[0], 403)
        self.assertEqual(self.upstream.requests, [])

    def test_decide_check_and_status_never_send_the_key_to_the_browser(self):
        body = {"endpoint": "mock", "tick": 1, "epoch": 0, "state": STATE, "questions": QUESTIONS}
        status, raw = self.request("POST", "/api/decision/decide", body)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["answers"]["motion"]["choice"], "drive")
        replies = [raw, self.request("POST", "/api/decision/check", {})[1]]
        with patch.object(server, "load_map", return_value={"pack": {"edges": [], "stats": {}}, "bbox": (-123.17, 49.26, -123.15, 49.27), "error": None}):
            status, raw = self.request("GET", "/api/status")
        out = json.loads(raw)
        self.assertEqual(out["decision"]["endpoints"][0]["id"], "decision:mock")
        self.assertEqual(out["decision"]["jev"]["configured"], False)
        replies.append(raw)
        for raw in replies:
            self.assertNotIn(SECRET.encode(), raw)

    def test_reloading_after_a_save_holds_the_setup_lock(self):
        # Without it, a reload could read one save's endpoint file and another save's key.
        held = []
        for registry in (server.llm_registry, server.decision_registry):
            reload = registry.reload
            self.enterContext(patch.object(registry, "reload", lambda reload=reload: (held.append(llm_setup._lock.locked()), reload())))
        server._saved({"saved": "x", "id": "decision:x"})
        self.assertEqual(held, [True, True])

    def test_a_key_saved_for_one_pillar_reaches_the_other_at_once(self):
        (self.root / "llm.json").write_text(json.dumps({"endpoints": [
            {"name": "luna", "base_url": "https://openrouter.ai/api/v1", "model": "openai/gpt-6-luna", "api_key_env": "OPENROUTER_API_KEY"}]}))
        server.llm_registry.reload()
        self.assertFalse(server.llm_registry.get("luna").public()["usable"])
        status, raw = self.request("POST", "/api/decision/save", {"provider": "openrouter", "model": "liquid/d1", "api_key": SECRET})
        self.assertEqual(status, 200)
        out = json.loads(raw)
        self.assertEqual(out["id"], "decision:d1")
        self.assertTrue(next(e for e in out["llm"]["endpoints"] if e["name"] == "luna")["usable"])
        self.assertNotIn(SECRET.encode(), raw)
        status, raw = self.request("POST", "/api/decision/save", {"provider": "typesafe", "model": "jev-latest", "api_key": SECRET + "-ts"})
        self.assertTrue(json.loads(raw)["decision"]["jev"]["configured"])
        self.assertTrue(server.client.configured)


if __name__ == "__main__":
    unittest.main()
