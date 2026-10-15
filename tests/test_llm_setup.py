"""The Connect a model dialog's server side (jev/llm_setup.py). Temporary files and a mock server only."""

import json
import stat
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (puts the project root on sys.path)

import server
from jev import llm, llm_setup
from jev.client import SpendGuard
from jev.config import Settings
from test_llm import MockLLM

KEY = "sk-or-test-SETUP-key-9876"


class SetupTestCase(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (self.root / ".gitignore").write_text(".env\n")
        self.settings = Settings(environ={"JEV_FSD_LLM_ENDPOINTS": str(self.root / "llm.json")}, env_file=self.root / ".env")
        self.registry = llm.LlmRegistry(self.settings, SpendGuard(10.0, 100))

    def save(self, **body):
        return llm_setup.save(self.settings, self.registry, body)

    def file(self):
        return json.loads((self.root / "llm.json").read_text())

    def env(self):
        return (self.root / ".env").read_text()

    def mock(self, reply=None):
        m = MockLLM(reply)
        self.addCleanup(m.close)
        return m


class SaveTests(SetupTestCase):
    def test_a_provider_key_goes_to_env_and_never_into_the_file_or_the_reply(self):
        res = self.save(provider="openrouter", model="openai/gpt-6-luna", api_key=KEY,
                        price_per_mtok_input=0.1, price_per_mtok_output=0.5)
        self.assertEqual(res["id"], "llm:gpt-6-luna")
        self.assertIn("OPENROUTER_API_KEY=%s" % KEY, self.env())
        self.assertEqual(stat.S_IMODE((self.root / ".env").stat().st_mode), 0o600)
        entry = self.file()["endpoints"][0]
        self.assertEqual(entry["api_key_env"], "OPENROUTER_API_KEY")
        self.assertEqual(entry["base_url"], "https://openrouter.ai/api/v1")
        self.assertEqual(entry["response_format"], "json_object")
        self.assertNotIn(KEY, (self.root / "llm.json").read_text())
        self.assertNotIn(KEY, json.dumps(res))
        endpoint = self.registry.get("gpt-6-luna")
        self.assertEqual(endpoint.api_key, KEY)   # reloaded without a restart
        self.assertEqual((endpoint.config.price_in, endpoint.config.price_out), (0.1, 0.5))
        provider = next(p for p in res["llm"]["providers"] if p["id"] == "openrouter")
        self.assertTrue(provider["key_set"])
        self.assertNotIn(KEY, json.dumps(llm_setup.providers_public(self.settings)))

    def test_a_saved_provider_key_is_reused_and_a_missing_one_is_asked_for(self):
        with self.assertRaises(llm_setup.SetupError) as ctx:
            self.save(provider="openai", model="gpt-4o-mini")
        self.assertIn("Paste your OpenAI API key", str(ctx.exception))
        self.assertFalse((self.root / "llm.json").exists())
        self.save(provider="openai", model="gpt-4o-mini", api_key=KEY)
        self.save(provider="openai", model="gpt-4.1-mini")   # second model, same key
        self.assertEqual([e["name"] for e in self.file()["endpoints"]], ["gpt-4o-mini", "gpt-4-1-mini"])
        self.assertEqual(self.env().count("OPENAI_API_KEY="), 1)

    def test_nothing_is_written_when_env_could_be_committed(self):
        (self.root / ".gitignore").write_text("")
        with self.assertRaises(llm_setup.SetupError) as ctx:
            self.save(provider="openrouter", model="openai/gpt-6-luna", api_key=KEY)
        self.assertIn("not listed in .gitignore", str(ctx.exception))
        self.assertFalse((self.root / ".env").exists())
        self.assertFalse((self.root / "llm.json").exists())

    def test_saving_again_updates_in_place_and_keeps_other_entries_and_options(self):
        (self.root / "llm.json").write_text(json.dumps({"_comment": "mine", "endpoints": [
            {"name": "ollama", "base_url": "http://localhost:11434/v1", "model": "llama3.2"},
            {"name": "luna", "base_url": "https://openrouter.ai/api/v1", "model": "openai/gpt-6-luna",
             "api_key_env": "OPENROUTER_API_KEY", "extra_body": {"reasoning": {"effort": "low"}},
             "price_per_mtok_input": 0.1, "price_per_mtok_output": 0.5}]}))
        self.save(provider="openrouter", name="luna", model="openai/gpt-6-luna-20260922", api_key=KEY)
        data = self.file()
        self.assertEqual(data["_comment"], "mine")
        self.assertEqual([e["name"] for e in data["endpoints"]], ["ollama", "luna"])
        luna = data["endpoints"][1]
        self.assertEqual(luna["model"], "openai/gpt-6-luna-20260922")
        self.assertEqual(luna["extra_body"], {"reasoning": {"effort": "low"}})   # hand-edited option kept
        self.assertNotIn("price_per_mtok_input", luna)   # prices belong to the old model unless sent again

    def test_moving_a_name_to_another_provider_drops_the_old_providers_settings(self):
        self.save(provider="ollama", name="main", model="llama3.2")
        self.save(provider="openrouter", name="main", model="openai/gpt-6-luna", api_key=KEY)
        entry = self.file()["endpoints"][0]
        self.assertNotIn("rpm", entry)   # Ollama's rpm 0 would have switched off the rate limit
        self.assertNotIn("timeout_s", entry)
        self.assertEqual(self.registry.get("main").config.rpm, None)

    def test_bad_input_is_refused_before_anything_is_written(self):
        cases = [({"provider": "nope", "model": "x"}, "Choose a provider"),
                 ({"provider": "openrouter", "model": "", "api_key": KEY}, "Choose a model"),
                 ({"provider": "openrouter", "model": "x", "name": "Bad Name!", "api_key": KEY}, "name must be"),
                 ({"provider": "custom", "model": "x", "base_url": "ftp://example.com"}, "http(s) URL"),
                 ({"provider": "custom", "model": "x", "base_url": "http://example.com/v1", "api_key": KEY}, "https://"),
                 ({"provider": "openrouter", "model": "x", "api_key": "has space"}, "does not look like an API key"),
                 ({"provider": "openrouter", "model": "x", "api_key": KEY, "price_per_mtok_input": "cheap"}, "number")]
        for body, text in cases:
            with self.subTest(body=body):
                with self.assertRaises(llm_setup.SetupError) as ctx:
                    self.save(**body)
                self.assertIn(text, str(ctx.exception))
                self.assertFalse((self.root / "llm.json").exists())
                self.assertFalse((self.root / ".env").exists())

    def test_a_custom_key_is_private_to_its_endpoint_and_never_follows_a_new_url(self):
        self.save(provider="custom", name="lab", model="m", base_url="https://one.example.com/v1", api_key=KEY)
        var = llm_setup.custom_key_env("lab")
        self.assertRegex(var, r"^JEV_FSD_LLM_KEY_LAB_[0-9A-F]{8}$")
        self.assertIn("%s=%s" % (var, KEY), self.env())
        self.assertEqual(self.file()["endpoints"][0]["api_key_env"], var)
        self.save(provider="custom", name="lab", model="m2", base_url="https://one.example.com/v1")   # same URL keeps it
        self.assertEqual(self.registry.get("lab").api_key, KEY)
        with self.assertRaises(llm_setup.SetupError) as ctx:
            self.save(provider="custom", name="lab", model="m2", base_url="https://two.example.com/v1")
        self.assertIn("Paste the key again", str(ctx.exception))
        self.assertEqual(self.registry.get("lab").config.base_url, "https://one.example.com/v1")
        llm_setup.remove(self.settings, self.registry, {"name": "lab"})
        self.assertEqual(self.file()["endpoints"], [])
        self.assertFalse((self.root / ".env").exists())   # its only line was the private key
        self.assertNotIn("lab", self.registry.endpoints)

    def test_names_differing_only_in_dash_or_underscore_keep_separate_keys(self):
        self.save(provider="custom", name="lab-1", model="m", base_url="https://lab.example.com/v1", api_key="key-for-lab")
        self.save(provider="custom", name="lab_1", model="m", base_url="https://other.example.com/v1", api_key="key-for-other")
        self.assertEqual(self.registry.get("lab-1").api_key, "key-for-lab")
        self.assertEqual(self.registry.get("lab_1").api_key, "key-for-other")
        self.assertNotEqual(*(e["api_key_env"] for e in self.file()["endpoints"]))

    def test_a_derived_name_never_replaces_a_different_model(self):
        self.save(provider="openrouter", model="openai/gpt-4o-mini", api_key=KEY)
        self.save(provider="openrouter", model="community/gpt-4o.mini")   # slugs to the same name
        self.save(provider="ollama", model="gpt-4o-mini")                   # same id, another server
        self.save(provider="openrouter", model="openai/gpt-4o-mini", price_per_mtok_input=1)   # same model: an update
        entries = self.file()["endpoints"]
        self.assertEqual([(e["name"], e["model"]) for e in entries],
                         [("gpt-4o-mini", "openai/gpt-4o-mini"), ("gpt-4o-mini-2", "community/gpt-4o.mini"), ("gpt-4o-mini-3", "gpt-4o-mini")])
        self.assertEqual(entries[0]["price_per_mtok_input"], 1)

    def test_removing_keeps_a_provider_key_and_refuses_unknown_names(self):
        self.save(provider="groq", model="llama-3.3-70b-versatile", api_key=KEY)
        res = llm_setup.remove(self.settings, self.registry, {"name": "llama-3-3-70b-versatile"})
        self.assertEqual(res["llm"]["endpoints"], [])
        self.assertIn("GROQ_API_KEY=", self.env())
        with self.assertRaises(llm_setup.SetupError):
            llm_setup.remove(self.settings, self.registry, {"name": "missing"})

    def test_local_servers_need_no_key_and_skip_the_rate_limit(self):
        self.save(provider="ollama", model="llama3.2")
        entry = self.file()["endpoints"][0]
        self.assertEqual((entry["base_url"], entry["rpm"], entry["timeout_s"]), ("http://localhost:11434/v1", 0, 20))
        self.assertNotIn("api_key_env", entry)
        self.assertFalse((self.root / ".env").exists())

    def test_a_shell_variable_that_overrides_env_is_reported(self):
        self.settings.environ["OPENROUTER_API_KEY"] = "sk-or-from-shell"
        res = self.save(provider="openrouter", model="openai/gpt-6-luna", api_key=KEY)
        self.assertIn("also set in the shell", res["notes"][0])
        self.assertNotIn(KEY, json.dumps(res))

    def test_the_env_endpoint_name_is_not_taken_over(self):
        self.settings.environ.update({"JEV_FSD_LLM_BASE_URL": "http://localhost:1234/v1", "JEV_FSD_LLM_MODEL": "m"})
        with self.assertRaises(llm_setup.SetupError) as ctx:
            self.save(provider="ollama", name="default", model="llama3.2")
        self.assertIn("JEV_FSD_LLM_*", str(ctx.exception))

    def test_an_unreadable_endpoints_file_is_not_overwritten(self):
        (self.root / "llm.json").write_text("{not json")
        with self.assertRaises(llm_setup.SetupError) as ctx:
            self.save(provider="ollama", model="llama3.2")
        self.assertIn("fix or delete it", str(ctx.exception))
        self.assertEqual((self.root / "llm.json").read_text(), "{not json")


class ReloadTests(SetupTestCase):
    def test_reload_keeps_the_stats_of_unchanged_endpoints(self):
        self.save(provider="ollama", model="llama3.2")
        before = self.registry.get("llama3-2")
        before.calls = 7
        self.save(provider="lmstudio", model="qwen2.5-7b-instruct")
        self.assertIs(self.registry.get("llama3-2"), before)
        self.assertEqual(self.registry.get("llama3-2").public()["calls"], 7)
        self.save(provider="ollama", name="llama3-2", model="llama3.3")
        self.assertIsNot(self.registry.get("llama3-2"), before)

    def test_a_request_in_flight_keeps_its_own_key_when_the_endpoint_moves(self):
        self.save(provider="custom", name="lab", model="m", base_url="https://one.example.com/v1", api_key="key-one")
        in_flight = self.registry.get("lab")   # e.g. waiting on a reply before its plain retry
        self.save(provider="custom", name="lab", model="m", base_url="https://two.example.com/v1", api_key="key-two")
        self.assertEqual(in_flight.api_key, "key-one")
        self.assertEqual(in_flight.config.base_url, "https://one.example.com/v1")
        self.assertEqual(self.registry.get("lab").api_key, "key-two")
        self.save(provider="custom", name="lab", model="m", base_url="https://two.example.com/v1", api_key="key-three")
        self.assertEqual(self.registry.get("lab").api_key, "key-three")   # a new key on the same URL is a new endpoint


class ModelListTests(SetupTestCase):
    def test_models_are_listed_sorted_with_openrouter_prices_and_the_typed_key(self):
        listing = {"data": [{"id": "z/model", "name": "Zed"},
                            {"id": "openai/gpt-6-luna", "name": "GPT-6 Luna", "pricing": {"prompt": "0.0000001", "completion": "0.0000005"}},
                            {"id": "free/model", "pricing": {"prompt": "0", "completion": "0"}},
                            {"id": 7}, "junk", {"id": "bad/pricing", "pricing": {"prompt": "x"}}]}
        mock = self.mock(lambda h, body: (200, listing, {}))
        res = llm_setup.list_models(self.settings, {"provider": "custom", "base_url": mock.url})
        self.assertEqual([m["id"] for m in res["models"]], ["bad/pricing", "free/model", "openai/gpt-6-luna", "z/model"])
        luna = res["models"][2]
        self.assertAlmostEqual(luna["price_per_mtok_input"], 0.1)
        self.assertAlmostEqual(luna["price_per_mtok_output"], 0.5)
        self.assertEqual(res["models"][1]["price_per_mtok_input"], 0)
        self.assertNotIn("price_per_mtok_input", res["models"][0])
        self.assertEqual(mock.requests[0]["path"], "/v1/models")
        self.assertNotIn("Authorization", mock.requests[0]["headers"])
        llm_setup.list_models(self.settings, {"provider": "custom", "base_url": mock.url, "api_key": KEY})
        self.assertEqual(mock.requests[1]["headers"]["Authorization"], "Bearer " + KEY)

    def test_a_rejected_key_and_an_unreachable_server_explain_themselves_without_the_key(self):
        mock = self.mock(lambda h, body: (401, {"error": {"message": "bad key %s" % KEY}}, {}))
        with self.assertRaises(llm_setup.SetupError) as ctx:
            llm_setup.list_models(self.settings, {"provider": "custom", "base_url": mock.url, "api_key": KEY})
        self.assertIn("rejected the key", str(ctx.exception))
        self.assertNotIn(KEY, str(ctx.exception))
        closed = self.mock()
        url = closed.url
        closed.close()
        with self.assertRaises(llm_setup.SetupError) as ctx:
            llm_setup.list_models(self.settings, {"provider": "custom", "base_url": url})
        self.assertIn("Could not reach", str(ctx.exception))
        self.assertIn("Is it running?", str(ctx.exception))

    def test_a_redirect_is_not_followed(self):
        target = self.mock()
        mock = self.mock(lambda h, body: (302, b"", {"Location": target.url + "/models"}))
        with self.assertRaises(llm_setup.SetupError):
            llm_setup.list_models(self.settings, {"provider": "custom", "base_url": mock.url, "api_key": KEY})
        self.assertEqual(target.requests, [])


class ServerTests(unittest.TestCase):
    def test_setup_routes_are_post_only_so_they_need_the_session_token(self):
        for path in ("/api/llm/models", "/api/llm/save", "/api/llm/remove"):
            self.assertIn(("POST", path), server.ROUTES)
            self.assertNotIn(("GET", path), server.ROUTES)

    def test_status_lists_the_presets(self):
        providers = llm_setup.public(server.settings, server.llm_registry)["providers"]
        self.assertEqual([p["id"] for p in providers], ["openrouter", "openai", "groq", "ollama", "lmstudio", "custom"])
        self.assertTrue(all(p["local"] for p in providers if p["id"] in ("ollama", "lmstudio")))


if __name__ == "__main__":
    unittest.main()
