"""Offline tests for backend hardening, concurrency, caching, resilience, and health/diagnostics APIs."""

from __future__ import annotations

import errno
import gzip
import http.client
import json
import math
import os
import socket
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import helpers  # noqa: F401  (puts the project root on sys.path)

import jev
import server
from jev import client as jev_client
from jev import endpoints as jev_endpoints
from jev import decide, decision, endpoints, llm, maps, security
from jev.client import SpendGuard
from jev.config import PRESET_BBOXES, Settings, _float, parse_bbox
from jev.drives import suggested_drives
from jev.osm.pack import pack_path, synthetic_pack
from jev.osm.restrictions import banned as restrictions_banned
from jev.routing import Router
from jev.routing import banned as routing_banned
from test_llm import EXPECT, MESSAGES, MockLLM, completion

SECRET = "sk-hardening-test-SECRET-98765"


class _QuietHandler(server.Handler):
    def log_message(self, _fmt, *_args):
        pass


def _start_test_server(test_case: unittest.TestCase):
    class QuietHandler(_QuietHandler):
        pass

    httpd = server.LocalServer(("127.0.0.1", 0), QuietHandler)
    QuietHandler.port = httpd.server_port
    thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.01})
    thread.start()
    test_case.addCleanup(thread.join)
    test_case.addCleanup(httpd.server_close)
    test_case.addCleanup(httpd.shutdown)
    return httpd


def _enter_context(test_case, context):
    stack = ExitStack()
    test_case.addCleanup(stack.close)
    return stack.enter_context(context)


class ContentLengthTests(unittest.TestCase):
    """#19: Malformed and negative Content-Length headers return 400 without crashing the handler."""

    def setUp(self):
        self.httpd = _start_test_server(self)
        self.port = self.httpd.server_port

    def _raw_http(self, raw: bytes) -> tuple[int, bytes]:
        with socket.create_connection(("127.0.0.1", self.port), timeout=3) as sock:
            sock.sendall(raw)
            chunks = []
            while True:
                data = sock.recv(4096)
                if not data:
                    break
                chunks.append(data)
        response = b"".join(chunks)
        head, _, body = response.partition(b"\r\n\r\n")
        status_line = head.split(b"\r\n", 1)[0]
        status = int(status_line.split(b" ")[1])
        return status, body

    def test_malformed_and_negative_content_length_return_400(self):
        bad_headers = [
            "Content-Length: -1\r\n",
            "Content-Length: -999\r\n",
            "Content-Length: abc\r\n",
            "Content-Length: 1.5\r\n",
            "Content-Length: \r\n",
            "Content-Length: +0\r\n",
            "Content-Length: 0_0\r\n",
            "Content-Length: 5\r\nContent-Length: 10\r\n",
        ]
        for header in bad_headers:
            with self.subTest(header=header.strip()):
                raw = (
                    "POST /api/route HTTP/1.1\r\n"
                    "Host: 127.0.0.1:%d\r\n"
                    "Content-Type: application/json\r\n"
                    "%s: %s\r\n"
                    "%s"
                    "Connection: close\r\n"
                    "\r\n" % (self.port, security.TOKEN_HEADER, server.SESSION_TOKEN, header)
                ).encode()
                status, body = self._raw_http(raw)
                self.assertEqual(status, 400)
                self.assertIn("Content-Length", json.loads(body)["error"])
        # Server stays healthy after malformed requests.
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            conn.request("GET", "/api/health")
            resp = conn.getresponse()
            self.assertEqual(resp.status, 200)
            self.assertEqual(json.loads(resp.read()), {"ok": True, "version": jev.VERSION})
        finally:
            conn.close()


class SecurityHostPortTests(unittest.TestCase):
    """#20: Malformed Host ports are rejected in split_host() / host_allowed()."""

    def test_valid_hosts_are_allowed(self):
        for header, expected in (
            ("localhost:8322", ("localhost", 8322)),
            ("localhost", ("localhost", None)),
            ("127.0.0.1:8322", ("127.0.0.1", 8322)),
            ("127.0.0.1", ("127.0.0.1", None)),
            ("[::1]:8322", ("[::1]", 8322)),
            ("[::1]", ("[::1]", None)),
        ):
            with self.subTest(header=header):
                self.assertEqual(security.split_host(header), expected)
                self.assertTrue(security.host_allowed(header, 8322))

    def test_malformed_or_out_of_range_ports_are_rejected(self):
        bad = [
            "localhost:abc",
            "localhost:",
            "localhost:0",
            "localhost:65536",
            "localhost:99999",
            "localhost:" + "9" * 5000,
            "localhost:-1",
            "localhost:8322/path",
            "localhost:\u00b2",
            "127.0.0.1:8323",
            "[::1]:abc",
            "[::1]:",
            "[::1]:0",
            "[::1]:70000",
            "[::1]junk",
            "[::1",
            "evil.example:8322",
        ]
        for header in bad:
            with self.subTest(header=header):
                self.assertFalse(security.host_allowed(header, 8322))
        for malformed in ("localhost:abc", "localhost:", "localhost:0", "localhost:70000", "[::1]junk", "[::1"):
            with self.subTest(malformed=malformed):
                _name, port = security.split_host(malformed)
                self.assertIsNotNone(port)
                self.assertEqual(port, -1)


class ConfigGuardTests(unittest.TestCase):
    """#21: Non-finite values and invalid ranges fall back safely in jev/config.py."""

    def test_float_rejects_non_finite_and_booleans(self):
        for bad in ("nan", "NaN", "inf", "-inf", "Infinity", "1e500", "-1e500", "not-a-number", True, False):
            with self.subTest(bad=bad):
                self.assertEqual(_float(bad, 42.0), 42.0)
        self.assertEqual(_float("3.25", 1.0), 3.25)

    def test_settings_properties_guard_ranges_and_non_finite_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing_env = Path(tmp) / ".env"
            for bad_port in ("nan", "inf", "-inf", "0", "-1", "65536", "8322.5", "abc"):
                s = Settings(environ={"PORT": bad_port}, env_file=missing_env)
                self.assertEqual(s.port, 8322)
            self.assertEqual(Settings(environ={"PORT": "9001"}, env_file=missing_env).port, 9001)

            for bad_budget in ("nan", "inf", "-inf", "-0.01", "-5", "1e500"):
                s = Settings(environ={"JEV_FSD_BUDGET_USD": bad_budget}, env_file=missing_env)
                self.assertEqual(s.budget_usd, 1.00)
            self.assertEqual(Settings(environ={"JEV_FSD_BUDGET_USD": "0"}, env_file=missing_env).budget_usd, 0.0)
            self.assertEqual(Settings(environ={"JEV_FSD_BUDGET_USD": "2.5"}, env_file=missing_env).budget_usd, 2.5)

            for bad_rpm in ("nan", "inf", "-inf", "-10"):
                s = Settings(environ={"JEV_FSD_RPM": bad_rpm}, env_file=missing_env)
                self.assertEqual(s.rpm, 240)
            self.assertEqual(Settings(environ={"JEV_FSD_RPM": "0"}, env_file=missing_env).rpm, 0)
            self.assertEqual(Settings(environ={"JEV_FSD_RPM": "60"}, env_file=missing_env).rpm, 60)

            for bad_npcs in ("nan", "inf", "-3"):
                s = Settings(environ={"JEV_FSD_NPCS": bad_npcs}, env_file=missing_env)
                self.assertEqual(s.npcs, 40)
            self.assertEqual(Settings(environ={"JEV_FSD_NPCS": "0"}, env_file=missing_env).npcs, 0)
            self.assertEqual(Settings(environ={"JEV_FSD_NPCS": "15"}, env_file=missing_env).npcs, 15)

    def test_parse_bbox_rejects_non_finite(self):
        self.assertIsNone(parse_bbox("nan,0,1,1"))
        self.assertIsNone(parse_bbox("-inf,0,1,1"))
        self.assertIsNone(parse_bbox("0,0,inf,1"))


class BooleanNumberRejectionTests(unittest.TestCase):
    """#22: Booleans are rejected anywhere numeric values are expected."""

    def test_endpoints_numeric_helpers_reject_booleans(self):
        for flag in (True, False):
            problems = []
            self.assertIsNone(endpoints.price(flag, "price_per_mtok_input", problems, "ep"))
            self.assertTrue(problems)
            with self.assertRaises(TypeError):
                endpoints.number(flag)
            with self.assertRaises(TypeError):
                endpoints.number(flag, integer=True)
            self.assertEqual(endpoints.tokens(flag), 0)

    def test_llm_and_decide_reject_boolean_tick_and_epoch(self):
        llm_base = {"endpoint": "a", "messages": MESSAGES, "expect": EXPECT}
        decide_base = {
            "state": {"car": {"speed": 5.0}},
            "questions": {"motion": {"type": "choice", "instructions": "Go?", "criteria": {"drive": "go"}}},
        }
        for field in ("tick", "epoch"):
            for flag in (True, False):
                with self.subTest(field=field, flag=flag):
                    with self.assertRaises(llm.InvalidLlmRequest):
                        llm.validate_request({**llm_base, field: flag})
                    with self.assertRaises(decide.InvalidRequest):
                        decide.validate_request({**decide_base, field: flag})


class ApiRouteValidationTests(unittest.TestCase):
    """#23: api_route() validates finiteness and types cleanly, raising BadRequest (400)."""

    def setUp(self):
        pack = synthetic_pack()
        self.entry = {"pack": pack, "router": Router(pack), "bbox": PRESET_BBOXES["kitsilano"], "error": None}
        _enter_context(self, patch.object(server, "load_map", return_value=self.entry))

    def test_invalid_coordinates_and_parameters_raise_bad_request(self):
        good_from = {"x": -120.0, "y": -180.0, "heading": 0.0}
        good_to = {"x": -80.0, "y": -180.0}
        bad_bodies = [
            {"from": "not-a-dict", "to": good_to},
            {"from": good_from, "to": [1, 2]},
            {"from": {"x": math.nan, "y": 0}, "to": good_to},
            {"from": {"x": math.inf, "y": 0}, "to": good_to},
            {"from": {"x": 0, "y": -math.inf}, "to": good_to},
            {"from": {"x": 0, "y": 0, "heading": math.nan}, "to": good_to},
            {"from": {"x": True, "y": 0}, "to": good_to},
            {"from": good_from, "to": {"x": math.inf, "y": 0}},
            {"from": good_from, "to": {"x": 0, "y": False}},
            {"from": good_from, "to": good_to, "k": "many"},
            {"from": good_from, "to": good_to, "k": True},
            {"from": good_from, "to": good_to, "k": 2.5},
            {"from": good_from, "to": good_to, "hour": "noon"},
            {"from": good_from, "to": good_to, "hour": math.nan},
            {"from": good_from, "to": good_to, "hour": math.inf},
            {"from": good_from, "to": good_to, "hour": True},
            {"from": good_from, "to": good_to, "weekday": "monday"},
            {"from": good_from, "to": good_to, "weekday": False},
            {"from": good_from, "to": good_to, "weekday": 1.9},
        ]
        for body in bad_bodies:
            with self.subTest(body=body):
                with self.assertRaises(server.BadRequest):
                    server.api_route(body, {})

    def test_http_route_returns_400_json_not_500(self):
        httpd = _start_test_server(self)
        conn = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=3)
        headers = {
            "Host": "127.0.0.1:%d" % httpd.server_port,
            "Content-Type": "application/json",
            security.TOKEN_HEADER: server.SESSION_TOKEN,
        }
        try:
            payload = json.dumps({"from": {"x": 0, "y": 0}, "to": {"x": 10, "y": 0}, "hour": "bad", "weekday": "x"})
            conn.request("POST", "/api/route", body=payload, headers=headers)
            resp = conn.getresponse()
            self.assertEqual(resp.status, 400)
            self.assertIn("error", json.loads(resp.read()))
        finally:
            conn.close()


class DecisionHeadlightsTests(unittest.TestCase):
    """#24: decision.check_answers() treats headlights as optional like route and LLM drivers."""

    QUESTIONS = {
        "motion": {"type": "choice", "instructions": "Drive?", "criteria": {"drive": "go", "stop": "halt"}},
        "vector": {"type": "choice", "instructions": "Pick", "criteria": {"keep": None, "brake": None}},
        "headlights": {"type": "choice", "instructions": "Beam", "criteria": {"high": "bright", "low": "dip"}},
    }
    BASE_ANSWERS = {
        "motion": {"type": "choice", "choice": "drive", "probabilities": {"drive": 0.9}},
        "vector": {"type": "choice", "choice": "keep", "probabilities": {"keep": 0.8}},
    }

    def test_valid_missing_and_invalid_headlights(self):
        valid_reply = {"answers": {**self.BASE_ANSWERS, "headlights": {"type": "choice", "choice": "high"}}}
        answers, invalid = decision.check_answers(valid_reply, self.QUESTIONS)
        self.assertIsNone(invalid)
        self.assertEqual(answers["headlights"]["choice"], "high")

        missing_reply = {"answers": dict(self.BASE_ANSWERS)}
        answers, invalid = decision.check_answers(missing_reply, self.QUESTIONS)
        self.assertIsNone(invalid)
        self.assertNotIn("headlights", answers)
        self.assertEqual(answers["vector"]["choice"], "keep")

        invalid_reply = {"answers": {**self.BASE_ANSWERS, "headlights": {"type": "choice", "choice": "lasers"}}}
        answers, invalid = decision.check_answers(invalid_reply, self.QUESTIONS)
        self.assertIsNone(invalid)
        self.assertNotIn("headlights", answers)

        only_headlights = {"headlights": self.QUESTIONS["headlights"]}
        answers, invalid = decision.check_answers({"answers": {}}, only_headlights)
        self.assertIsNone(invalid)
        self.assertEqual(answers, {})

    def test_missing_required_motion_still_fails(self):
        answers, invalid = decision.check_answers({"answers": {"vector": self.BASE_ANSWERS["vector"]}}, self.QUESTIONS)
        self.assertEqual(answers, {})
        self.assertTrue(invalid)


class EndpointCheckTests(unittest.TestCase):
    """#25: Endpoint.check() reports 5xx as error, allows 404/405 as ready, locks _check, timestamps after HTTP."""

    def _endpoint(self, reply):
        mock = MockLLM(reply)
        self.addCleanup(mock.close)
        tmp = Path(_enter_context(self, tempfile.TemporaryDirectory()))
        (tmp / "llm.json").write_text(json.dumps({"endpoints": [{"name": "ep", "base_url": mock.url, "model": "x"}]}))
        settings = Settings(environ={"JEV_FSD_LLM_ENDPOINTS": str(tmp / "llm.json")}, env_file=tmp / ".env")
        return llm.LlmRegistry(settings, SpendGuard(10.0, 100)).get("ep")

    def test_http_status_mapping(self):
        cases = [
            (200, "ready", True),
            (404, "ready", True),
            (405, "ready", True),
            (401, "key rejected", True),
            (403, "key rejected", True),
            (500, "error", True),
            (502, "error", True),
            (503, "error", True),
            (400, "error", True),
            (429, "error", True),
        ]
        for code, expected_status, expected_reachable in cases:
            with self.subTest(code=code):
                ep = self._endpoint(lambda _h, _b, c=code: (c, {"detail": "status %d" % c}, {}))
                result = ep.check(force=True)
                self.assertEqual(result["status"], expected_status)
                self.assertEqual(result["reachable"], expected_reachable)

    def test_timestamp_recorded_after_request_and_thread_safe(self):
        finished_at = []

        def slow_ok(_h, _b):
            time.sleep(0.12)
            finished_at.append(time.monotonic())
            return 200, {"data": []}, {}

        ep = self._endpoint(slow_ok)
        ep.check(force=True)
        self.assertTrue(finished_at)
        self.assertGreaterEqual(ep._check[0], finished_at[0])

        fast_ep = self._endpoint(lambda _h, _b: (200, {"data": []}, {}))
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda i: fast_ep.check(force=(i % 2 == 0)), range(16)))
        self.assertTrue(all(r["status"] == "ready" for r in results))


class LlmFormatLockTests(unittest.TestCase):
    """#26: LlmEndpoint._format reads in public() and chat() are synchronized with self._lock."""

    def test_concurrent_downgrade_and_public_reads_do_not_deadlock(self):
        def picky(_h, body):
            if "response_format" in body:
                return 400, {"error": {"message": "unsupported"}}, {}
            return 200, completion('{"motion": "drive", "candidate": "keep_lane_target"}'), {}

        mock = MockLLM(picky)
        self.addCleanup(mock.close)
        tmp = Path(_enter_context(self, tempfile.TemporaryDirectory()))
        (tmp / "llm.json").write_text(
            json.dumps({"endpoints": [{"name": "ep", "base_url": mock.url, "model": "x", "rpm": 0}]})
        )
        settings = Settings(environ={"JEV_FSD_LLM_ENDPOINTS": str(tmp / "llm.json")}, env_file=tmp / ".env")
        ep = llm.LlmRegistry(settings, SpendGuard(10.0, 100)).get("ep")

        def worker(i):
            if i % 2 == 0:
                return ep.chat(MESSAGES, EXPECT).format_used
            return ep.public()["response_format"]

        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(worker, range(12)))
        self.assertEqual(results[::2], ["none"] * 6)
        self.assertTrue(all(fmt in ("json_schema", "none") for fmt in results[1::2]))
        self.assertEqual(ep.public()["response_format"], "none")


class LoadMapConcurrencyTests(unittest.TestCase):
    """#27: Concurrent cold load_map() calls for the same bbox only build the pack once."""

    def test_concurrent_cold_load_builds_once(self):
        calls = 0
        calls_lock = threading.Lock()
        pack = synthetic_pack()

        def slow_build_pack(_bbox, _maps_dir, log=None):
            nonlocal calls
            with calls_lock:
                calls += 1
            time.sleep(0.06)
            return pack

        layer_builders = (
            "build_transit",
            "build_crossings",
            "build_zones",
            "build_rail",
            "build_buslanes",
            "build_calming",
            "build_scrambles",
            "build_restrictions",
            "build_contraflow",
            "build_driveways",
            "build_parks",
            "build_bridges",
        )
        with (
            patch.object(server, "_maps", {}),
            patch.object(server, "_map_locks", {}),
            patch.object(server, "build_pack", side_effect=slow_build_pack),
        ):
            for name in layer_builders:
                _enter_context(self, patch.object(server, name, return_value=None))
            with ThreadPoolExecutor(max_workers=8) as pool:
                entries = list(pool.map(lambda _: server.load_map("kitsilano"), range(8)))
        self.assertEqual(calls, 1)
        self.assertEqual(len({id(e) for e in entries}), 1)


class MapCatalogCacheTests(unittest.TestCase):
    """#28: jev/maps.py caches pack metadata by (path, mtime_ns, size) and invalidates on change."""

    def test_catalog_caches_and_invalidates_on_file_change_or_delete(self):
        with tempfile.TemporaryDirectory() as tmp:
            maps_dir = Path(tmp)
            target = pack_path(maps_dir, PRESET_BBOXES["kitsilano"])
            pack = synthetic_pack()
            target.write_text(json.dumps(pack))
            with maps._META_LOCK:
                maps._META_CACHE.pop(str(target), None)

            real_loads = json.loads
            parse_count = 0

            def counting_loads(text, *args, **kwargs):
                nonlocal parse_count
                parse_count += 1
                return real_loads(text, *args, **kwargs)

            with patch.object(maps.json, "loads", side_effect=counting_loads):
                first = maps.catalog(maps_dir)
                kits_1 = next(m for m in first if m["id"] == "kitsilano")
                kits_1["preview"][0]["pts"][0].clear()
                kits_1["extent"].clear()
                second = maps.catalog(maps_dir)
                self.assertEqual(parse_count, 1)
                kits_2 = next(m for m in second if m["id"] == "kitsilano")
                self.assertTrue(kits_1["cached"])
                self.assertEqual(kits_1["stats"], kits_2["stats"])
                self.assertTrue(kits_2["preview"][0]["pts"][0])
                self.assertEqual(kits_2["extent"], pack["extent"])

                # Modify pack file (different size & mtime_ns) -> cache must invalidate.
                updated = {**pack, "buildings": pack["buildings"] + [{"footprint": [[0, 0], [1, 0], [1, 1]], "h": 8}]}
                target.write_text(json.dumps(updated))
                st = target.stat()
                os.utime(target, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))
                third = maps.catalog(maps_dir)
                self.assertEqual(parse_count, 2)
                kits_3 = next(m for m in third if m["id"] == "kitsilano")
                self.assertEqual(kits_3["stats"]["buildings"], kits_1["stats"]["buildings"] + 1)

                # Deleting file -> cache evicted and reported uncached.
                target.unlink()
                fourth = maps.catalog(maps_dir)
                kits_4 = next(m for m in fourth if m["id"] == "kitsilano")
                self.assertFalse(kits_4["cached"])
                self.assertEqual(kits_4["stats"], {})


class RecordingsAndRunsResilienceTests(unittest.TestCase):
    """#29: api_recordings() supports .json.gz and both listing endpoints skip corrupt files."""

    def _recording_payload(self, driver="jev"):
        return {
            "format": server.RECORDING_FORMAT,
            "header": {"driver": driver, "model": "m"},
            "results": {"s1-1": {"pass": True}},
            "scenarios": {},
            "drives": {"s1-1": {"k1": [{"ok": True}]}},
        }

    def test_recordings_list_and_load_json_and_json_gz_resiliently(self):
        with tempfile.TemporaryDirectory() as tmp:
            rec_dir = Path(tmp) / "recordings"
            rec_dir.mkdir()
            (rec_dir / "20261120-plain.json").write_text(json.dumps(self._recording_payload("plain")))
            (rec_dir / "20261120-plain.json.json").write_text(json.dumps(self._recording_payload("legacy")))
            with gzip.open(rec_dir / "20261121-compressed.json.gz", "wt", encoding="utf-8") as fh:
                json.dump(self._recording_payload("compressed"), fh)
            (rec_dir / "20261121-compressed.json").write_text("[" * 2500 + "0" + "]" * 2500)
            (rec_dir / "20261122-bad.json").write_text("{broken json")
            (rec_dir / "20261123-bad.json.gz").write_bytes(b"not a gzip file")
            # Truncated gzip header/body triggers EOFError/zlib.error
            good_gz = gzip.compress(json.dumps(self._recording_payload("trunc")).encode())
            (rec_dir / "20261124-trunc.json.gz").write_bytes(good_gz[: len(good_gz) // 2])

            with patch.object(server, "RECORDINGS_DIR", rec_dir):
                listed = server.api_recordings({}, {})["recordings"]
                self.assertEqual(
                    [r["name"] for r in listed], ["20261121-compressed", "20261120-plain.json", "20261120-plain"]
                )
                self.assertEqual(listed[0]["drives"], ["s1-1"])

                loaded = server.api_recordings({}, {"name": ["20261121-compressed"]})
                self.assertEqual(loaded["header"]["driver"], "compressed")
                with patch.object(server, "MAX_ARCHIVE_BYTES", 10):
                    self.assertNotIn(
                        "20261121-compressed", [r["name"] for r in server.api_recordings({}, {})["recordings"]]
                    )
                    with self.assertRaises(server.BadRequest):
                        server.api_recordings({}, {"name": ["20261121-compressed"]})
                loaded_ext = server.api_recordings({}, {"name": ["20261121-compressed.json.gz"]})
                self.assertEqual(loaded_ext["header"]["driver"], "compressed")
                legacy = server.api_recordings({}, {"name": ["20261120-plain.json"]})
                self.assertEqual(legacy["header"]["driver"], "legacy")

                with self.assertRaises(server.BadRequest):
                    server.api_recordings({}, {"name": ["20261123-bad"]})
                with self.assertRaises(server.BadRequest):
                    server.api_recordings({}, {"name": ["..bad"]})
                (rec_dir / "trip..v2.json").write_text(json.dumps(self._recording_payload()))
                self.assertIn("trip..v2", [r["name"] for r in server.api_recordings({}, {})["recordings"]])
                self.assertEqual(server.api_recordings({}, {"name": ["trip..v2"]})["format"], server.RECORDING_FORMAT)

    def test_bench_runs_listing_skips_corrupt_and_non_object_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs_dir = Path(tmp) / "runs"
            runs_dir.mkdir()
            (runs_dir / "20261120-good.json").write_text(
                json.dumps({"saved_at": "2026-11-20", "config": {"brain": "rules"}, "summary": {"ok": 1}})
            )
            (runs_dir / "20261121-corrupt.json").write_text("{not json")
            (runs_dir / "20261122-array.json").write_text("[1, 2, 3]")
            (runs_dir / "20261123-nested.json").write_text("[" * 2500 + "0" + "]" * 2500)

            with patch.object(server, "RUNS_DIR", runs_dir):
                listed = server.api_bench_runs({}, {})["runs"]
                self.assertEqual([r["name"] for r in listed], ["20261120-good"])
                good = server.api_bench_runs({}, {"name": ["20261120-good"]})
                self.assertEqual(good["summary"], {"ok": 1})
                for name in ("20261121-corrupt", "20261122-array", "20261123-nested"):
                    with self.subTest(name=name), self.assertRaises(server.BadRequest):
                        server.api_bench_runs({}, {"name": [name]})


class RouterRestrictionIndexTests(unittest.TestCase):
    """#30: Router indexes turn restrictions by (from, to) for O(1) lookup with identical routes."""

    def test_indexed_restrictions_match_banned_for_no_and_only_rules(self):
        pack = synthetic_pack()
        base_router = Router(pack)
        # Pick an edge with at least two non-U-turn successors.
        src = next(
            e["id"]
            for e in pack["edges"]
            if len([n for n in base_router.successors(e["id"]) if base_router.turn(e["id"], n) != "uturn"]) >= 2
        )
        succs = [n for n in base_router.successors(src) if base_router.turn(src, n) != "uturn"]
        target_a, target_b = succs[0], succs[1]

        no_rule = {
            "id": "r1",
            "from": src,
            "to": [target_a],
            "kind": "no_left_turn",
            "condition": {"days": [0], "start": 420, "end": 540},  # Mon 07:00-09:00
        }
        only_rule = {
            "id": "r2",
            "from": src,
            "to": [target_b],
            "kind": "only_straight_on",
            "condition": {"days": [1], "start": 600, "end": 720},  # Tue 10:00-12:00
        }
        pack_with_rules = {**pack, "restrictions": {"restrictions": [no_rule, only_rule]}}
        router = Router(pack_with_rules)

        # Verify index built at __init__.
        self.assertIn((src, target_a), router._restriction_index)
        self.assertNotIn(only_rule, router._restriction_index.get((src, target_b), []))
        for nxt in base_router.successors(src):
            if nxt != target_b:
                self.assertIn(only_rule, router._restriction_index.get((src, nxt), []))

        # Verify routing results agree with public banned() helper across time windows.
        self.assertIs(routing_banned, restrictions_banned)
        a_edge = router.edges[src]
        # During Monday 08:00 (no_rule active), direct src -> target_a is banned.
        route_mon = router.astar(src, a_edge["length"] - 5, target_a, 5, restrictions=True, hour=8.0, weekday=0)
        if route_mon is not None:
            self.assertFalse(
                any(
                    restrictions_banned([no_rule, only_rule], x, y, 8.0, 0)
                    for x, y in zip(route_mon[0], route_mon[0][1:])
                )
            )
        # During Monday 12:00 (neither rule active), direct turn is allowed.
        route_off = router.astar(src, a_edge["length"] - 5, target_a, 5, restrictions=True, hour=12.0, weekday=0)
        self.assertEqual(route_off[0][:2], [src, target_a])
        # During Tuesday 11:00 (only_rule active), only target_b is allowed out of src.
        route_tue = router.astar(src, a_edge["length"] - 5, target_a, 5, restrictions=True, hour=11.0, weekday=1)
        if route_tue is not None:
            self.assertEqual(route_tue[0][1], target_b)

    def test_post_init_pack_restrictions_mutation_refreshes_index(self):
        pack = synthetic_pack()
        router = Router(pack)
        src = next(
            e["id"]
            for e in pack["edges"]
            if len([n for n in router.successors(e["id"]) if router.turn(e["id"], n) != "uturn"]) >= 2
        )
        nxt = next(n for n in router.successors(src) if router.turn(src, n) != "uturn")
        a_edge = router.edges[src]
        before = router.astar(src, a_edge["length"] - 5, nxt, 5, restrictions=True)
        self.assertEqual(before[0][:2], [src, nxt])
        pack["restrictions"] = {"restrictions": [{"id": "r1", "from": src, "to": [nxt], "kind": "no_left_turn"}]}
        after = router.astar(src, a_edge["length"] - 5, nxt, 5, restrictions=True)
        self.assertTrue(after is None or after[0][:2] != [src, nxt])


class DrivesSeenCellsTests(unittest.TestCase):
    """#31: suggested_drives() uses O(1) seen_cells set with deterministic output."""

    def test_suggested_drives_deterministic_and_distinct(self):
        path = server.MAPS_DIR / "623b012bc8b5.v6.pack.json"
        router = Router(json.loads(path.read_text()))
        lane = next(ln for ln in router.lanes.values() if ln["length"] > 70)
        pts = lane["pts"]
        mid = pts[len(pts) // 2]
        start = {"x": mid[0], "y": mid[1], "heading": math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])}
        first = suggested_drives(router, start)
        second = suggested_drives(router, start)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 3)
        self.assertEqual(len({tuple(d["destination"]) for d in first}), 3)


class AtomicWritesTests(unittest.TestCase):
    """Saved artifacts publish atomically without overwriting one another."""

    def test_saves_leave_no_temp_files_and_clean_up_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snaps = root / "snapshots"
            runs = root / "runs"
            recs = root / "recordings"
            with patch.multiple(server, PROJECT_ROOT=root, SNAPSHOTS_DIR=snaps, RUNS_DIR=runs, RECORDINGS_DIR=recs):
                server.api_snapshot_save(
                    {
                        "name": "snap1",
                        "state": {"car": {}},
                        "questions": {"motion": {"type": "choice", "instructions": "Go?", "criteria": {"drive": "y"}}},
                    },
                    {},
                )
                server.api_bench_save({"config": {"brain": "rules"}, "summary": {}, "results": []}, {})
                server.api_recording_save(
                    {
                        "format": server.RECORDING_FORMAT,
                        "header": {"driver": "stub"},
                        "drives": {"d1": {"k1": [{}]}},
                        "results": {"d1": {}},
                        "scenarios": {},
                    },
                    {},
                )
                for folder in (snaps, runs, recs):
                    self.assertEqual(list(folder.glob("*.tmp")), [])
                    self.assertEqual(len(list(folder.glob("*.json"))), 1)

                # A failed publish leaves no partial target or temporary file.
                target = root / "fail" / "out.json"
                with patch.object(os, "link", side_effect=OSError("disk full")):
                    with self.assertRaises(OSError):
                        server._atomic_write_text(target, '{"ok": true}')
                self.assertFalse(target.exists())
                self.assertEqual(list(target.parent.glob("*.tmp")), [])

                # A long Unicode name fits the target, and cleanup can't undo publication.
                target = root / f"{'𐐀' * 60}.json"
                with (
                    patch.object(os, "unlink", side_effect=PermissionError("cleanup")),
                    patch.object(server, "log") as log,
                ):
                    server._atomic_write_text(target, '{"ok": true}')
                self.assertEqual(json.loads(target.read_text()), {"ok": True})
                log.assert_called_once()

    def test_concurrent_benchmark_saves_keep_distinct_payloads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            barrier = threading.Barrier(6)

            def save(index):
                barrier.wait(timeout=5)
                payload = {"config": {"brain": "rules"}, "summary": {"index": index}, "results": []}
                return server.api_bench_save(payload, {})

            with (
                patch.multiple(server, PROJECT_ROOT=root, RUNS_DIR=root / "runs"),
                patch.object(server.time, "strftime", return_value="same-start-time"),
                patch.object(os, "link", side_effect=OSError(errno.EOPNOTSUPP, "Hard links unavailable")),
                ThreadPoolExecutor(max_workers=6) as pool,
            ):
                responses = list(pool.map(save, range(6)))
                self.assertEqual(len({response["name"] for response in responses}), 6)
                for index, response in enumerate(responses):
                    stored = json.loads((root / response["saved"]).read_text())
                    self.assertEqual(stored["name"], response["name"])
                    self.assertEqual(stored["summary"]["index"], index)
            self.assertEqual(len(list((root / "runs").iterdir())), 6)


class HealthDiagnosticsVersionTests(unittest.TestCase):
    """#33, #34, #35: Centralized VERSION, GET /api/health, and GET /api/diagnostics."""

    def test_centralized_version(self):
        self.assertEqual(jev.VERSION, "0.3.0")
        self.assertEqual(server.VERSION, jev.VERSION)
        self.assertEqual(endpoints.USER_AGENT, "jev-fsd/%s" % jev.VERSION)
        self.assertEqual(server.Handler.server_version, "JevFSD/%s" % jev.VERSION)

        captured_headers = {}

        class _FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"ok": true}'

        def fake_urlopen(req, timeout=None):
            captured_headers.update(req.header_items())
            return _FakeResp()

        with tempfile.TemporaryDirectory() as tmp:
            s = Settings(environ={}, env_file=Path(tmp) / ".env")
            c = jev_client.JevClient(s, api_key="k-test")
            with patch.object(jev_endpoints._OPENER, "open", side_effect=fake_urlopen):
                c._stdlib_request("GET", "/v1/models", None, max_attempts=1)
        lowered = {k.lower(): v for k, v in captured_headers.items()}
        self.assertEqual(lowered.get("user-agent"), "jev-fsd/%s (stdlib)" % jev.VERSION)

    def test_health_and_diagnostics_avoid_map_load_and_secrets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "llm.json").write_text(
                json.dumps(
                    {
                        "endpoints": [
                            {
                                "name": "demo",
                                "base_url": "https://api.example.com/v1",
                                "model": "m1",
                                "api_key_env": "DEMO_KEY",
                            }
                        ]
                    }
                )
            )
            s = Settings(
                environ={
                    "DEMO_KEY": SECRET,
                    "TYPESAFE_API_KEY": SECRET + "-ts",
                    "JEV_FSD_LLM_ENDPOINTS": str(root / "llm.json"),
                    "JEV_FSD_DECISION_ENDPOINTS": str(root / "decision.json"),
                },
                env_file=root / ".env",
            )
            c = jev_client.JevClient(s)
            llm_reg = llm.LlmRegistry(s, c.guard)
            dec_reg = decision.DecisionRegistry(s, c.guard)
            fake_maps = {"-123.17000,49.26000,-123.15000,49.27000": {"pack": {}, "router": None, "error": None}}

            with (
                patch.object(server, "load_map", side_effect=AssertionError("must not cold-load maps")),
                patch.object(server, "_maps", fake_maps),
                patch.object(server, "client", c),
                patch.object(server, "llm_registry", llm_reg),
                patch.object(server, "decision_registry", dec_reg),
            ):
                httpd = _start_test_server(self)
                conn = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=3)
                try:
                    conn.request("GET", "/api/health")
                    resp = conn.getresponse()
                    self.assertEqual(resp.status, 200)
                    self.assertEqual(json.loads(resp.read()), {"ok": True, "version": jev.VERSION})

                    conn.request("GET", "/api/diagnostics")
                    resp = conn.getresponse()
                    raw = resp.read()
                    self.assertEqual(resp.status, 200)
                    diag = json.loads(raw)
                    self.assertTrue(diag["ok"])
                    self.assertEqual(diag["version"], jev.VERSION)
                    self.assertIsInstance(diag["uptime_s"], (int, float))
                    self.assertGreaterEqual(diag["uptime_s"], 0.0)
                    self.assertEqual(diag["cached_maps"], list(fake_maps))
                    self.assertEqual(diag["map_count"], 1)
                    self.assertIn("jev", diag["endpoints"])
                    self.assertIn("llm", diag["endpoints"])
                    self.assertIn("decision", diag["endpoints"])
                    self.assertTrue(diag["endpoints"]["jev"]["configured"])
                    self.assertNotIn(SECRET.encode(), raw)
                finally:
                    conn.close()


if __name__ == "__main__":
    unittest.main()
