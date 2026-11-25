"""Configuration and key-file changes use disposable project directories."""

from __future__ import annotations

import errno
import io
import os
import stat
import subprocess
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

import helpers  # noqa: F401

import server
from jev import envfile
from jev.config import DEFAULT_BUDGET_USD, DEFAULT_NPCS, DEFAULT_PORT, DEFAULT_RPM, PROJECT_ROOT, Settings


class EnvFileTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory()))
        self.path = self.root / ".env"
        self.ignore = self.root / ".gitignore"
        self.ignore.write_text(".env\n", encoding="utf-8")

    def git(self, *args, env=None):
        return subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True, text=True, env=env)

    def test_env_signature_does_not_hide_the_first_setting(self):
        self.path.write_bytes(b"\xef\xbb\xbfMODEL=demo\n")
        self.assertEqual(envfile.read(self.path), {"MODEL": "demo"})

    def test_empty_value_with_comment_is_not_a_credential(self):
        self.assertEqual(envfile.parse("KEY= # comment\nexport KEY2=\t# comment"), {"KEY": "", "KEY2": ""})
        self.assertEqual(envfile.parse('KEY=#literal\nTEXT="# quoted"'), {"KEY": "#literal", "TEXT": "# quoted"})

    def test_env_reader_rejects_nonregular_paths(self):
        self.path.mkdir()
        with self.assertRaisesRegex(OSError, "regular file"):
            envfile.read(self.path)

    def test_env_reader_rejects_oversized_file(self):
        self.path.write_bytes(b"MODEL=example")
        with patch.object(envfile, "MAX_ENV_BYTES", 4), self.assertRaisesRegex(OSError, "exceeds"):
            envfile.read(self.path)

    def test_env_reader_rejects_invalid_encoding_without_echoing_value(self):
        self.path.write_bytes(b"MODEL=sensitive-value\xff")
        with self.assertRaisesRegex(OSError, "UTF-8") as error:
            envfile.read(self.path)
        self.assertNotIn("sensitive-value", str(error.exception))

    def test_shell_metacharacters_round_trip_as_literal_values(self):
        key = "demo$EXPAND;kept&safe"
        envfile.write_key(self.root, key)
        self.assertEqual(envfile.read(self.path), {envfile.KEY_NAME: key})
        self.assertIn(f"{envfile.KEY_NAME}='{key}'", self.path.read_text(encoding="utf-8"))

    def test_write_keeps_unrelated_line_endings_and_comments(self):
        self.path.write_bytes(b"# heading\r\nTYPESAFE_API_KEY=old\r\nMODEL=next\n\n")
        envfile.write_key(self.root, "sample")
        self.assertEqual(self.path.read_bytes(), b"# heading\r\nTYPESAFE_API_KEY=sample\r\nMODEL=next\n\n")

    def test_append_uses_existing_newline_and_adds_a_missing_separator(self):
        self.path.write_bytes(b"# title\r\nMODEL=demo")
        envfile.write_key(self.root, "sample")
        self.assertEqual(self.path.read_bytes(), b"# title\r\nMODEL=demo\r\nTYPESAFE_API_KEY=sample\r\n")

    def test_replacement_keeps_export_prefix_and_comment(self):
        self.path.write_bytes(b'export TYPESAFE_API_KEY="previous # literal" # note\n')
        envfile.write_key(self.root, "sample")
        self.assertEqual(self.path.read_bytes(), b"export TYPESAFE_API_KEY=sample # note\n")

    def test_append_preserves_carriage_return_line_endings(self):
        self.path.write_bytes(b"# title\rMODEL=demo")
        envfile.write_key(self.root, "sample")
        self.assertEqual(self.path.read_bytes(), b"# title\rMODEL=demo\rTYPESAFE_API_KEY=sample\r")

    def test_directory_is_rejected_by_write_preflight(self):
        self.path.mkdir()
        with self.assertRaisesRegex(envfile.EnvFileError, "regular file"):
            envfile.write_key(self.root, "sample")

    def test_replacing_duplicate_assignments_removes_the_extra_copy(self):
        self.path.write_text("TYPESAFE_API_KEY=one\nMODEL=demo\nexport TYPESAFE_API_KEY=two", encoding="utf-8")
        envfile.write_key(self.root, "sample")
        self.assertEqual(self.path.read_bytes(), b"TYPESAFE_API_KEY=sample\nMODEL=demo\n")
        self.assertEqual(envfile.read(self.path)[envfile.KEY_NAME], "sample")

    def test_edit_preserves_bom_without_retaining_old_first_assignment(self):
        self.path.write_bytes(b"\xef\xbb\xbfTYPESAFE_API_KEY=old\r\nMODEL=demo")
        envfile.write_key(self.root, "sample")
        self.assertEqual(self.path.read_bytes(), b"\xef\xbb\xbfTYPESAFE_API_KEY=sample\r\nMODEL=demo")
        self.assertTrue(envfile.forget_key(self.root))
        self.assertEqual(self.path.read_bytes(), b"\xef\xbb\xbfMODEL=demo")

    def test_forget_removes_only_the_target_assignment_and_its_line_ending(self):
        self.path.write_bytes(b"TYPESAFE_API_KEY=old\r\n\r\n# retained\nMODEL=demo")
        self.assertTrue(envfile.forget_key(self.root))
        self.assertEqual(self.path.read_bytes(), b"\r\n# retained\nMODEL=demo")

    def test_forget_single_key_removes_file_even_if_it_has_bom(self):
        self.path.write_bytes(b"\xef\xbb\xbfTYPESAFE_API_KEY=old\r\n\r\n")
        self.assertTrue(envfile.forget_key(self.root))
        self.assertFalse(self.path.exists())

    def test_forget_checks_environment_variable_name(self):
        self.path.write_text("MODEL=kept\n", encoding="utf-8")
        with self.assertRaisesRegex(envfile.EnvFileError, "variable name"):
            envfile.forget_key(self.root, var="MODEL\n")
        self.assertEqual(self.path.read_bytes(), b"MODEL=kept\n")

    def test_write_checks_key_types_before_using_git(self):
        with patch.object(envfile, "_git") as git_call:
            with self.assertRaisesRegex(envfile.EnvFileError, "API key"):
                envfile.write_key(self.root, 123)
        git_call.assert_not_called()

    def test_write_and_forget_accept_only_a_single_safe_path_component(self):
        for name in ("../.env", "/", ".", "C:.env", "*.env", ".env\x00"):
            with self.subTest(name=name):
                with self.assertRaisesRegex(envfile.EnvFileError, "single file name"):
                    envfile.write_key(self.root, "sample", name=name)
                with self.assertRaisesRegex(envfile.EnvFileError, "single file name"):
                    envfile.forget_key(self.root, name=name)

    def test_key_edits_leave_symlink_and_target_untouched(self):
        real = self.root / "elsewhere"
        real.write_text("TYPESAFE_API_KEY=original\n", encoding="utf-8")
        self.path.symlink_to(real)
        with self.assertRaisesRegex(envfile.EnvFileError, "symbolic link"):
            envfile.write_key(self.root, "sample")
        with self.assertRaisesRegex(OSError, "symbolic link"):
            envfile.forget_key(self.root)
        self.assertTrue(self.path.is_symlink())
        self.assertEqual(real.read_bytes(), b"TYPESAFE_API_KEY=original\n")
        self.assertFalse(envfile.permissions_ok(self.path))

    def test_key_file_ends_up_owner_only_after_replacement(self):
        self.path.write_bytes(b"TYPESAFE_API_KEY=old\n")
        self.path.chmod(0o644)
        envfile.write_key(self.root, "sample")
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertTrue(envfile.permissions_ok(self.path))

    def test_permissions_diagnostic_distinguishes_missing_file(self):
        self.assertIsNone(envfile.permissions_ok(self.path))

    def test_permissions_diagnostic_rejects_group_execute_bit(self):
        self.path.touch(mode=0o600)
        self.path.chmod(0o610)
        self.assertFalse(envfile.permissions_ok(self.path))

    def test_forgetting_missing_variable_preserves_exact_file(self):
        content = b"# comments only\r\nMODEL=known"
        self.path.write_bytes(content)
        self.assertFalse(envfile.forget_key(self.root, var="UNSET"))
        self.assertEqual(self.path.read_bytes(), content)

    def test_nonrepo_gitignore_negation_overrides_earlier_pattern(self):
        self.ignore.write_text("*.env\n!.env\n", encoding="utf-8")
        with self.assertRaisesRegex(envfile.EnvFileError, "not listed in .gitignore"):
            envfile.write_key(self.root, "sample")
        self.assertFalse(self.path.exists())

    def test_nonrepo_gitignore_later_pattern_restores_ignore(self):
        self.ignore.write_text("*.env\n!.env\n/.env\n", encoding="utf-8")
        envfile.write_key(self.root, "sample")
        self.assertTrue(self.path.exists())

    def test_nonrepo_gitignore_does_not_apply_unsuitable_globs(self):
        self.ignore.write_text("*.env\n", encoding="utf-8")
        self.assertFalse(envfile.gitignore_covers(self.root, "private-secrets.json"))

    def test_unavailable_git_cannot_use_ignore_file_fallback_in_repo(self):
        (self.root / ".git").mkdir()
        with patch.object(envfile.shutil, "which", return_value=None):
            with self.assertRaisesRegex(envfile.EnvFileError, "not listed in .gitignore"):
                envfile.write_key(self.root, "sample")

    def test_starter_clone_can_save_using_actual_gitignore_policy(self):
        self.git("init", "-q")
        envfile.write_key(self.root, "sample")
        self.assertEqual(envfile.read(self.path), {envfile.KEY_NAME: "sample"})

    def test_unversioned_credential_file_can_use_anchored_ignore_rule(self):
        self.git("init", "-q")
        self.ignore.write_text("/local.env\n", encoding="utf-8")
        path = envfile.write_key(self.root, "sample", name="local.env")
        self.assertEqual(path, self.root / "local.env")
        self.assertEqual(envfile.read(path), {envfile.KEY_NAME: "sample"})

    def test_inherited_git_index_cannot_hide_a_tracked_key_file(self):
        self.git("init", "-q")
        self.path.write_bytes(b"MODEL=demo\n")
        empty_index = self.root / "unused-index"
        self.git("add", "-f", ".env")
        with patch.dict(os.environ, {"GIT_INDEX_FILE": str(empty_index)}):
            with self.assertRaisesRegex(envfile.EnvFileError, "tracked by git"):
                envfile.write_key(self.root, "sample")
        self.assertEqual(self.path.read_bytes(), b"MODEL=demo\n")

    def test_concurrent_edits_preserve_different_vars(self):
        def write(index):
            envfile.write_key(self.root, f"test-{index}", var=f"KEY_{index}")

        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(write, range(12)))
        self.assertEqual(envfile.read(self.path), {f"KEY_{index}": f"test-{index}" for index in range(12)})


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory()))
        self.path = self.root / ".env"

    def settings(self, **env):
        return Settings(env, self.path)

    def test_invalid_file_does_not_block_process_environment(self):
        self.path.write_bytes(b"\xff")
        settings = self.settings(PORT="9001")
        self.assertEqual(settings.port, 9001)
        self.assertIn("UTF-8", settings.problems()[0])

    def test_unreadable_reload_clears_stale_file_credentials_and_can_recover(self):
        self.path.write_text("TYPESAFE_API_KEY=demo\n", encoding="utf-8")
        settings = self.settings()
        self.assertEqual(settings.key_source, "file")
        self.path.write_bytes(b"\xff")
        settings.reload_file()
        self.assertIsNone(settings.api_key)
        self.assertIsNone(settings.key_source)
        self.assertIn("UTF-8", settings.problems()[0])
        self.path.write_text("TYPESAFE_API_KEY=recovered\n", encoding="utf-8")
        settings.reload_file()
        self.assertEqual(settings.api_key, "recovered")
        self.assertEqual(settings.problems(), [])

    def test_missing_env_file_after_reload_clears_the_previous_values_without_warning(self):
        self.path.write_text("PORT=9009", encoding="utf-8")
        settings = self.settings()
        self.path.unlink()
        settings.reload_file()
        self.assertEqual(settings.port, DEFAULT_PORT)
        self.assertEqual(settings.problems(), [])

    def test_diagnostics_name_only_invalid_settings_and_accepted_defaults(self):
        settings = self.settings(
            PORT="secret-port",
            JEV_FSD_RPM="2.5",
            JEV_FSD_NPCS="-1",
            JEV_FSD_BBOX="secret-bbox",
            JEV_FSD_BUDGET_USD="secret-budget",
            TYPESAFE_DEFAULT_MODEL="line\nbreak",
        )
        warnings = "\n".join(settings.problems())
        for name in (
            "PORT",
            "JEV_FSD_RPM",
            "JEV_FSD_NPCS",
            "JEV_FSD_BBOX",
            "JEV_FSD_BUDGET_USD",
            "TYPESAFE_DEFAULT_MODEL",
        ):
            self.assertIn(name, warnings)
        self.assertNotIn("secret-", warnings)
        self.assertEqual((settings.port, settings.rpm, settings.npcs), (DEFAULT_PORT, DEFAULT_RPM, DEFAULT_NPCS))
        self.assertEqual(settings.budget_usd, DEFAULT_BUDGET_USD)

    def test_whole_number_parsing_preserves_exact_values(self):
        settings = self.settings(JEV_FSD_RPM="9.007199254740991e15", PORT="9e3", JEV_FSD_NPCS="0.0")
        self.assertEqual((settings.rpm, settings.port, settings.npcs), (9007199254740991, 9000, 0))
        self.assertEqual(settings.problems(), [])

    def test_fractional_tail_cannot_round_to_valid_port(self):
        settings = self.settings(PORT="9000.00000000000000001")
        self.assertEqual(settings.port, DEFAULT_PORT)
        self.assertIn("PORT", settings.problems()[0])

    def test_spend_limit_cannot_underflow_to_unlimited(self):
        for value in ("1e-1000", "-1e-1000"):
            with self.subTest(value=value):
                settings = self.settings(JEV_FSD_BUDGET_USD=value)
                self.assertEqual(settings.budget_usd, DEFAULT_BUDGET_USD)
                self.assertIn("JEV_FSD_BUDGET_USD", settings.problems()[0])
        self.assertEqual(self.settings(JEV_FSD_BUDGET_USD="0e-1000").budget_usd, 0)

    def test_json_unsafe_integer_and_excess_exponent_fall_back(self):
        settings = self.settings(JEV_FSD_NPCS="9007199254740992", JEV_FSD_RPM="1e999999999999999999999999")
        self.assertEqual(settings.npcs, DEFAULT_NPCS)
        self.assertEqual(settings.rpm, DEFAULT_RPM)

    def test_models_and_base_urls_trim_outer_whitespace(self):
        settings = self.settings(TYPESAFE_DEFAULT_MODEL="  demo  ", TYPESAFE_BASE_URL=" HTTP://localhost:9090/v1/ \t")
        self.assertEqual(settings.model, "demo")
        self.assertEqual(settings.base_url, "HTTP://localhost:9090/v1")
        self.assertEqual(settings.problems(), [])

    def test_malformed_explicit_url_disables_jev_without_falling_back_to_paid_api(self):
        for url in (
            "ftp://localhost",
            "https://",
            "https://[broken",
            "http://localhost:0",
            "http://localhost:",
            "http://secret@localhost",
            "http://localhost?k=secret",
            "http://localhost#secret",
            "http://localhost/some path",
            "http://localhost\\example",
        ):
            with self.subTest(url=url):
                settings = self.settings(TYPESAFE_BASE_URL=url, TYPESAFE_API_KEY="sample")
                self.assertIsNone(settings.api_key)
                self.assertIsNone(settings.key_source)
                self.assertNotIn("secret", "\n".join(settings.problems()))
                self.assertIn("TYPESAFE_BASE_URL", settings.problems()[0])

    def test_invalid_process_key_never_falls_through_to_on_disk_key(self):
        self.path.write_text("TYPESAFE_API_KEY=valid-test-key\n", encoding="utf-8")
        for invalid in ("secret\nvalue", "secret value", "clé", " "):
            with self.subTest(invalid=invalid):
                settings = self.settings(TYPESAFE_API_KEY=invalid)
                self.assertIsNone(settings.api_key)
                self.assertIsNone(settings.key_source)
                self.assertIn("TYPESAFE_API_KEY", settings.problems()[0])
                self.assertNotIn(invalid.strip() or "secret", settings.problems()[0])

    def test_surrounding_key_whitespace_is_ignored(self):
        settings = self.settings(TYPESAFE_API_KEY=" \tsample\t ")
        self.assertEqual(settings.api_key, "sample")
        self.assertEqual(settings.key_source, "env")

    def test_unresolved_tilde_in_endpoint_path_cannot_abort_startup(self):
        path = "~unlikely-jev-env-user/decisions.json"
        with patch.object(Path, "expanduser", side_effect=RuntimeError):
            settings = self.settings(JEV_FSD_DECISION_ENDPOINTS=path)
            self.assertEqual(settings.decision_endpoints_path, PROJECT_ROOT / path)

    def test_endpoint_directory_and_invalid_path_have_specific_diagnostics(self):
        settings = self.settings(
            JEV_FSD_LLM_ENDPOINTS=str(self.root), JEV_FSD_DECISION_ENDPOINTS="bad\x00filename.json"
        )
        self.assertEqual(
            settings.problems(),
            [
                "JEV_FSD_LLM_ENDPOINTS names a directory. Choose a JSON file.",
                "JEV_FSD_DECISION_ENDPOINTS must be a valid file path.",
            ],
        )

    def test_quiet_setting_supports_file_values_and_explicit_false_overrides(self):
        self.path.write_bytes(b"JEV_FSD_QUIET=1\n")
        self.assertTrue(self.settings().quiet)
        for value in ("0", "false", "OFF", "no"):
            with self.subTest(value=value):
                self.assertFalse(self.settings(JEV_FSD_QUIET=value).quiet)

    def test_empty_shell_credential_defers_to_file(self):
        self.path.write_bytes(b"TYPESAFE_API_KEY=kept\n")
        settings = self.settings(TYPESAFE_API_KEY="")
        self.assertEqual((settings.api_key, settings.key_source), ("kept", "file"))

    def test_no_type_safe_setting_uses_default_model_and_base(self):
        settings = self.settings()
        self.assertEqual(settings.base_url, "https://api.typesafe.ai")
        self.assertEqual(settings.model, "jev-latest")

    def test_credential_read_does_not_expand_shell_variables(self):
        self.path.write_bytes(b"TYPESAFE_API_KEY=${NEVER_EXPAND}\n")
        self.assertEqual(self.settings(NEVER_EXPAND="sample").api_key, "${NEVER_EXPAND}")

    def test_key_is_visible_when_custom_url_has_path_prefix(self):
        settings = self.settings(TYPESAFE_API_KEY="sample", TYPESAFE_BASE_URL="https://local.example/test/inner")
        self.assertEqual((settings.api_key, settings.base_url), ("sample", "https://local.example/test/inner"))

    def test_process_mapping_is_snapshotted_at_initialization(self):
        initial = {"PORT": "9001"}
        settings = Settings(initial, self.path)
        initial["PORT"] = "9002"
        self.assertEqual(settings.port, 9001)

    def test_valid_bounds_are_accepted_as_port_numbers(self):
        self.assertEqual(self.settings(PORT="1").port, 1)
        self.assertEqual(self.settings(PORT="65535").port, 65535)

    def test_refresh_uses_current_process_overrides_and_keeps_other_file_values(self):
        self.path.write_bytes(b"PORT=9007\nJEV_FSD_RPM=10\n")
        settings = self.settings(PORT="9008")
        self.path.write_bytes(b"PORT=9009\nJEV_FSD_RPM=11\n")
        settings.reload_file()
        self.assertEqual((settings.port, settings.rpm), (9008, 11))


class SetupTransactionTests(unittest.TestCase):
    def test_setup_edits_hold_lock_through_combined_reply(self):
        result = {"saved": "sample"}

        def update(_body):
            self.assertTrue(server._setup_write_lock.locked())
            return result

        def reply(saved):
            self.assertTrue(server._setup_write_lock.locked())
            self.assertIs(saved, result)
            return {"llm": {}, "decision": {}}

        with patch.object(server, "_saved", side_effect=reply), patch.object(server, "log"):
            self.assertEqual(server._mutate_setup(update, {}, "saved %s", "saved"), {"llm": {}, "decision": {}})
        self.assertFalse(server._setup_write_lock.locked())

    def test_setup_error_does_not_attempt_reply_reload(self):
        error = server.llm_setup.SetupError("Choose a provider")
        with (
            patch.object(server.llm_setup, "save", side_effect=error),
            patch.object(server, "_saved") as reload,
            self.assertRaisesRegex(server.BadRequest, "Choose a provider"),
        ):
            server.api_llm_save({}, {})
        reload.assert_not_called()
        self.assertFalse(server._setup_write_lock.locked())

    def test_failed_registry_reload_releases_mutation_lock(self):
        with (
            patch.object(server, "_saved", side_effect=OSError("could not reload")),
            patch.object(server, "log"),
            self.assertRaises(OSError),
        ):
            server._mutate_setup(lambda _: {"saved": "picked"}, {}, "saved %s", "saved")
        self.assertFalse(server._setup_write_lock.locked())


class StartupTests(unittest.TestCase):
    def test_port_conflict_suggests_an_unused_port_on_standard_error(self):
        stderr = io.StringIO()
        with (
            patch.object(server, "LocalServer", side_effect=OSError(errno.EADDRINUSE, "Address in use")),
            patch.object(server.sys, "stderr", stderr),
        ):
            self.assertEqual(server.main(), 1)
        self.assertIn("set PORT to an unused port", stderr.getvalue())

    def test_port_permission_error_mentions_account_permissions(self):
        stderr = io.StringIO()
        with (
            patch.object(server, "LocalServer", side_effect=PermissionError(errno.EACCES, "Permission denied")),
            patch.object(server.sys, "stderr", stderr),
        ):
            self.assertEqual(server.main(), 1)
        self.assertIn("this account can bind", stderr.getvalue())

    def test_failed_startup_map_closes_listener_and_explains_problem(self):
        httpd = MagicMock(server_port=8322)
        with (
            patch.object(server, "LocalServer", return_value=httpd),
            patch.object(server, "load_map", side_effect=ValueError("corrupt")),
            patch.object(server, "log") as log,
        ):
            self.assertEqual(server.main(), 1)
        httpd.serve_forever.assert_not_called()
        httpd.__exit__.assert_called_once()
        self.assertIn("Could not load the startup map", log.call_args.args[0])

    def test_unexpected_serve_failure_returns_nonzero(self):
        listener = MagicMock(server_port=8322)
        listener.serve_forever.side_effect = OSError("listener closed")
        categories = ("edges", "intersections", "stops", "buildings")
        entry = {"pack": {name: [] for name in categories}, "error": None}
        with (
            patch.object(server, "load_map", return_value=entry),
            patch.object(server, "print", create=True),
            patch.object(server, "log") as log,
        ):
            self.assertEqual(server._serve(listener), 1)
        self.assertIn("listener stopped", log.call_args.args[0])
