#!/usr/bin/env python3
"""Jev FSD: local server for the driving sim.

    uv run server.py        # or: python3 server.py
    open http://127.0.0.1:8322

Serves the static app, the map pack, routing, and the three kinds of driver that need a server: Jev
(jev/client.py), other decision models (jev/decision.py) and LLM endpoints (jev/llm.py). API keys and
the choice of endpoint stay on this server (the browser sees only a credential-stripped base URL);
every request is checked by
jev/security.py so other websites cannot drive this server or spend your credits.
"""

from __future__ import annotations

import errno
import gzip
import json
import math
import mimetypes
import os
import secrets
import sys
import tempfile
import threading
import time
import traceback
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from jev import VERSION, decide, decision, decision_setup, llm, llm_setup, security
from jev.client import PRICE_PER_INPUT_TOKEN_USD, JevClient, JevError
from jev.config import MAPS_DIR, PROJECT_ROOT, RECORDINGS_DIR, RUNS_DIR, SNAPSHOTS_DIR, Settings, parse_bbox
from jev.osm import fetch
from jev.osm.pack import build_pack, synthetic_pack
from jev.osm.bus_lanes import build_buslanes
from jev.osm.calming import build_calming
from jev.osm.contraflow import build_contraflow
from jev.osm.crossings import build_crossings
from jev.osm.driveways import build_driveways
from jev.osm.parks import build_parks
from jev.osm.bridges import build_bridges
from jev.osm.rail import build_rail
from jev.osm.scrambles import build_scrambles
from jev.osm.transit import build_transit
from jev.osm.zones import build_zones
from jev.osm.restrictions import build_restrictions
from jev.routing import Router
from jev.maps import catalog, map_identity
from jev.drives import suggested_drives

STATIC = PROJECT_ROOT / "static"
PAGES = {
    "/": "index.html",
    "/tests": "tests/run.html",
    "/bench": "bench.html",
    "/arena": "arena.html",
    "/results": "results.html",
}
# Every committed result (ROADMAP 2.7), built by scripts/build_results.py; /results shows it.
RESULTS_FILE = PROJECT_ROOT / "data" / "results.json"
MAX_BODY_BYTES = 1024 * 1024
# A model recording keeps every answer of a benchmark run (static/js/brain/recording.js).
MAX_RECORDING_BYTES = 32 * 1024 * 1024
# The largest bundled legacy recording expands to about 448 MiB.
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
_save_lock = threading.Lock()
RECORDING_FORMAT = "jev-model-recording/1"

settings = Settings()
client = JevClient(settings)
llm_registry = llm.LlmRegistry(settings, client.guard)  # shares Jev's budget and rate limit
decision_registry = decision.DecisionRegistry(settings, client.guard)
SESSION_TOKEN = security.new_token()
_maps: dict = {}  # bbox key -> {"pack", "router", "error"}
_maps_lock = threading.Lock()
_map_locks: dict = {}  # bbox key -> threading.Lock
_STARTED_AT = time.monotonic()


class BadRequest(Exception):
    pass


def log(msg: str) -> None:
    sys.stderr.write("  %s  %s\n" % (time.strftime("%H:%M:%S"), msg))


def _atomic_write_text(path: Path, text: str) -> None:
    """Publish a complete file under a new name without overwriting another save."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix=".save-",
            suffix=".tmp",
            dir=str(path.parent),
            delete=False,
        ) as fh:
            tmp_path = fh.name
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        try:
            os.link(tmp_path, path)
        except OSError as error:
            if error.errno not in (
                errno.EPERM,
                errno.EINVAL,
                errno.ENOSYS,
                errno.ENOTSUP,
                errno.EOPNOTSUPP,
                errno.EXDEV,
            ):
                raise
            # A server still serializes publication on filesystems without hard links.
            with _save_lock:
                if path.exists():
                    raise FileExistsError(path) from error
                os.replace(tmp_path, path)
                tmp_path = None
    finally:
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError as error:
                log(f"Could not clean up temporary artifact {tmp_path}: {error}")


def _save_artifact(path, encode):
    destination = path
    while True:
        try:
            _atomic_write_text(destination, encode(destination))
        except FileExistsError:
            destination = path.with_name(f"{path.stem}-{secrets.token_hex(4)}{path.suffix}")
        else:
            return destination


def _read_json_file(path: Path):
    if path.name.endswith(".json.gz"):
        with gzip.open(path, "rb") as fh:
            data = fh.read(MAX_ARCHIVE_BYTES + 1)
        if len(data) > MAX_ARCHIVE_BYTES:
            raise ValueError("Recording exceeds the decoded size limit")
        return json.loads(data)
    return json.loads(path.read_text(encoding="utf-8"))


def _recording_name(path: Path) -> str:
    if path.name.endswith(".json.gz"):
        return path.name[: -len(".json.gz")]
    if path.name.endswith(".json"):
        return path.name[: -len(".json")]
    return path.stem


# Maps


def load_map(bbox_text: str = "") -> dict:
    bbox = parse_bbox(bbox_text) or settings.bbox
    key = "%.5f,%.5f,%.5f,%.5f" % bbox
    entry = _maps.get(key)
    if entry:
        return entry
    with _maps_lock:
        entry = _maps.get(key)
        if entry:
            return entry
        lock = _map_locks.setdefault(key, threading.Lock())
    with lock:
        entry = _maps.get(key)
        if entry:
            return entry
        entry = {"bbox": bbox, "pack": None, "router": None, "error": None}
        try:
            entry["pack"] = build_pack(bbox, MAPS_DIR, log=log)
            # bus routes and stops, kept beside the pack (from the raw OSM download when there is one)
            transit = build_transit(bbox, MAPS_DIR, entry["pack"], log=log)
            if transit:
                entry["pack"] = {**entry["pack"], "transit": transit}
            # marked crosswalks between junctions, kept beside the pack in the same way
            crossings = build_crossings(bbox, MAPS_DIR, entry["pack"], log=log)
            if crossings:
                entry["pack"] = {**entry["pack"], "crossings": crossings}
            # school and playground zones, likewise
            zones = build_zones(bbox, MAPS_DIR, entry["pack"], log=log)
            if zones:
                entry["pack"] = {**entry["pack"], "zones": zones}
            # railway tracks and their level crossings with the streets, likewise
            rail = build_rail(bbox, MAPS_DIR, entry["pack"], log=log)
            if rail:
                entry["pack"] = {**entry["pack"], "rail": rail}
            # speed humps, tables, cushions and bumps, likewise
            buslanes = build_buslanes(bbox, MAPS_DIR, entry["pack"], log=log)
            if buslanes:
                entry["pack"] = {**entry["pack"], "buslanes": buslanes}
            calming = build_calming(bbox, MAPS_DIR, entry["pack"], log=log)
            if calming:
                entry["pack"] = {**entry["pack"], "calming": calming}
            # and the signals with an all-walk scramble phase, likewise
            scrambles = build_scrambles(bbox, MAPS_DIR, entry["pack"], log=log)
            if scrambles:
                entry["pack"] = {**entry["pack"], "scrambles": scrambles}
            restriction_layer = build_restrictions(bbox, MAPS_DIR, entry["pack"], log=log)
            if restriction_layer:
                entry["pack"] = {**entry["pack"], "restrictions": restriction_layer}
            # and the one-way streets cyclists may ride both ways, likewise
            contraflow = build_contraflow(bbox, MAPS_DIR, entry["pack"], log=log)
            if contraflow:
                entry["pack"] = {**entry["pack"], "contraflow": contraflow}
            # and the driveways cars back out of, likewise
            driveways = build_driveways(bbox, MAPS_DIR, entry["pack"], log=log)
            if driveways:
                entry["pack"] = {**entry["pack"], "driveways": driveways}
            # and the parks and water geese cross the street beside, likewise
            parks = build_parks(bbox, MAPS_DIR, entry["pack"], log=log)
            if parks:
                entry["pack"] = {**entry["pack"], "parks": parks}
            # and the bridges black ice forms on first, likewise
            bridges = build_bridges(bbox, MAPS_DIR, entry["pack"], log=log)
            if bridges:
                entry["pack"] = {**entry["pack"], "bridges": bridges}
            # (and the city's clock, for when the sun is up: playground zones are in effect dawn to dusk)
            offset = map_identity(bbox).get("utc_offset")
            if offset is not None:
                entry["pack"] = {**entry["pack"], "utc_offset": offset}
        except fetch.FetchError as err:
            log("map: %s; using the synthetic grid" % err)
            entry["error"] = str(err)
            entry["pack"] = synthetic_pack()
        entry["router"] = Router(entry["pack"])
        with _maps_lock:
            _maps[key] = entry
        return entry


def api_health(_body, _query):
    """Lightweight liveness check without triggering a cold map load."""
    return {"ok": True, "version": VERSION}


def api_diagnostics(_body, _query):
    """Read-only server health and runtime snapshot without exposing secrets or triggering cold map loads."""
    with _maps_lock:
        cached_maps = sorted(_maps.keys())
    return {
        "ok": True,
        "version": VERSION,
        "uptime_s": round(max(0.0, time.monotonic() - _STARTED_AT), 1),
        "cached_maps": cached_maps,
        "map_count": len(cached_maps),
        "endpoints": {
            "jev": {
                "configured": client.configured,
                "key_source": client.key_source,
                "model": client.model,
                "backend": client.backend,
            },
            "llm": llm_registry.public(),
            "decision": decision_registry.public(),
        },
        "spend": client.guard.snapshot(),
    }


def api_status(_body, query):
    entry = load_map((query.get("bbox") or query.get("map") or [""])[0])
    pack = entry["pack"]
    return {
        "version": VERSION,
        "configured": client.configured,
        "key_source": client.key_source,
        "model": client.model,
        "backend": client.backend,
        "price_per_mtok_input": PRICE_PER_INPUT_TOKEN_USD * 1_000_000,
        "spend": client.guard.snapshot(),
        "npcs": settings.npcs,
        "llm": llm_setup.public(settings, llm_registry),
        "decision": decision_setup.public(settings, decision_registry, client),
        "map": {
            **map_identity(entry["bbox"]),
            "bbox": list(entry["bbox"]),
            "name": pack.get("name"),
            "synthetic": bool(pack.get("synthetic")),
            "error": entry["error"],
            "stats": pack.get("stats", {}),
        },
    }


def api_map(_body, query):
    entry = load_map((query.get("bbox") or query.get("map") or [""])[0])
    return {**entry["pack"], "routing_bbox": list(entry["bbox"])}


def api_maps(_body, _query):
    return {"maps": catalog(MAPS_DIR)}


def api_drives(body, _query):
    entry = load_map(str(body.get("bbox") or ""))
    start = body.get("from") or {}
    try:
        start = {"x": float(start["x"]), "y": float(start["y"]), "heading": float(start["heading"])}
        if not all(math.isfinite(v) for v in start.values()):
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise BadRequest("from {x, y, heading} with finite coordinates is required")
    return {"drives": suggested_drives(entry["router"], start)}


def api_route(body, _query):
    raw_start, raw_goal = body.get("from"), body.get("to")
    if not isinstance(raw_start, dict) or not isinstance(raw_goal, dict):
        raise BadRequest("from {x, y, heading?} and to {x, y} with finite coordinates are required")
    try:
        sx, sy = raw_start["x"], raw_start["y"]
        sh = raw_start.get("heading")
        gx, gy = raw_goal["x"], raw_goal["y"]
        if any(isinstance(v, bool) for v in (sx, sy, sh, gx, gy)):
            raise TypeError("boolean is not a coordinate")
        start = {
            "x": float(sx),
            "y": float(sy),
            "heading": float(sh) if sh is not None else None,
        }
        goal = {"x": float(gx), "y": float(gy)}
        coords = [start["x"], start["y"], goal["x"], goal["y"]]
        if start["heading"] is not None:
            coords.append(start["heading"])
        if not all(math.isfinite(v) for v in coords):
            raise ValueError("coordinates must be finite")
    except (KeyError, TypeError, ValueError, OverflowError):
        raise BadRequest("from {x, y, heading?} and to {x, y} with finite coordinates are required")
    raw_k = body.get("k")
    try:
        if isinstance(raw_k, bool) or (isinstance(raw_k, float) and not raw_k.is_integer()):
            raise TypeError("k is not an integer")
        k = max(1, min(int(1 if raw_k is None else raw_k), 3))
    except (TypeError, ValueError, OverflowError):
        raise BadRequest("k must be an integer")
    raw_hour = body.get("hour", 15.5)
    try:
        if isinstance(raw_hour, bool):
            raise TypeError("boolean is not hour")
        hour = float(raw_hour)
        if not math.isfinite(hour):
            raise ValueError("hour must be finite")
    except (TypeError, ValueError, OverflowError):
        raise BadRequest("hour must be a finite number")
    raw_weekday = body.get("weekday", 0)
    try:
        if isinstance(raw_weekday, bool) or (isinstance(raw_weekday, float) and not raw_weekday.is_integer()):
            raise TypeError("weekday is not an integer")
        weekday = int(raw_weekday)
    except (TypeError, ValueError, OverflowError):
        raise BadRequest("weekday must be an integer")
    # (edges no route may enter: a block closed for an event, static/js/sim/road-closures.js)
    avoid = body.get("avoid") or []
    if not isinstance(avoid, list) or len(avoid) > 200 or not all(isinstance(a, str) and len(a) <= 64 for a in avoid):
        raise BadRequest("avoid must be a list of edge ids")
    entry = load_map(str(body.get("bbox") or ""))
    started = time.perf_counter()
    routes = entry["router"].routes(
        start,
        goal,
        k=k,
        restrictions=bool(body.get("restrictions")),
        hour=hour,
        weekday=weekday,
        avoid=avoid,
    )
    return {"routes": routes, "compute_ms": round((time.perf_counter() - started) * 1000, 1)}


# Decisions


def api_decide(body, _query):
    try:
        return decide.jev_decide(client, body)
    except decide.InvalidRequest as err:
        raise BadRequest(str(err))


def api_llm_decide(body, _query):
    try:
        return llm.llm_decide(llm_registry, body)
    except llm.InvalidLlmRequest as err:
        raise BadRequest(str(err))


def api_llm_check(body, _query):
    """Probe every configured endpoint (GET {base_url}/models, no spend). POST so it needs the token."""
    return {"endpoints": llm_registry.check_all(force=bool(body.get("force")))}


def _setup(action, body):
    try:
        return action(body)
    except llm_setup.SetupError as err:
        raise BadRequest(str(err))


def _saved(result):
    """After a save or removal in either pillar: both registries re-read .env, since a provider key
    (OPENROUTER_API_KEY) can serve both, and the reply carries both blocks and Jev's state. The setup
    lock keeps a reload from pairing one save's endpoint file with another save's key."""
    with llm_setup._lock:
        llm_registry.reload()
        decision_registry.reload()
        return {
            **result,
            "llm": llm_setup.public(settings, llm_registry),
            "decision": decision_setup.public(settings, decision_registry, client),
        }


def api_llm_models(body, _query):
    """The Connect a model dialog's model list: GET {base_url}/models for a provider (no spend)."""
    return _setup(lambda b: llm_setup.list_models(settings, b), body)


def api_llm_save(body, _query):
    """Save a model from the dialog: key to .env, endpoint to the endpoints file, then reload."""
    result = _setup(lambda b: llm_setup.save(settings, llm_registry, b), body)
    log("llm setup: saved llm:%s" % result["saved"])
    return _saved(result)


def api_llm_remove(body, _query):
    result = _setup(lambda b: llm_setup.remove(settings, llm_registry, b), body)
    log("llm setup: removed llm:%s" % result["removed"])
    return _saved(result)


def api_decision_decide(body, _query):
    try:
        return decision.decision_decide(decision_registry, body)
    except decision.InvalidDecisionRequest as err:
        raise BadRequest(str(err))


def api_decision_check(body, _query):
    """Probe every decision endpoint (one free GET each). POST so it needs the token."""
    return {"endpoints": decision_registry.check_all(force=bool(body.get("force")))}


def api_decision_models(body, _query):
    return _setup(lambda b: decision_setup.list_models(settings, b), body)


def api_decision_save(body, _query):
    """Save a decision model, or just the TypeSafe key for the built-in Jev driver."""
    result = _setup(lambda b: decision_setup.save(settings, decision_registry, client, b), body)
    log("decision setup: saved %s" % result["id"])
    return _saved(result)


def api_decision_remove(body, _query):
    result = _setup(lambda b: decision_setup.remove(settings, decision_registry, client, b), body)
    log("decision setup: removed decision:%s" % result["removed"])
    return _saved(result)


def api_snapshot_save(body, _query):
    name = str(body.get("name") or "snapshot")
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "-_")[:60] or "snapshot"
    try:
        req = decide.validate_request(body)
    except decide.InvalidRequest as err:
        raise BadRequest(str(err))
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    path = SNAPSHOTS_DIR / ("%s.json" % safe)
    payload = {
        "name": safe,
        "state": req["state"],
        "questions": req["questions"],
        "expect": body.get("expect") or {},
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    path = _save_artifact(path, lambda _: json.dumps(payload, indent=2))
    return {"saved": str(path.relative_to(PROJECT_ROOT))}


# Benchmark runs


def api_bench_save(body, _query):
    """Store a finished benchmark run (config, per-scenario results, summary) under data/runs/."""
    for key in ("config", "summary", "results"):
        if key not in body:
            raise BadRequest("%s is required" % key)
    if not isinstance(body["results"], list) or not isinstance(body["summary"], dict):
        raise BadRequest("results must be a list and summary an object")
    declared = body.get("suite_version")
    if "suite_version" in body and declared != "custom":
        raise BadRequest("browser benchmark runs must use the custom suite")
    if any(not isinstance(result, dict) or result.get("suite_version") != declared for result in body["results"]):
        raise BadRequest("run and results must agree on suite_version")
    config = body["config"] if isinstance(body["config"], dict) else {}
    brain = "".join(ch for ch in str(config.get("brain") or "run") if ch.isalnum())[:20] or "run"
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = RUNS_DIR / ("%s-%s.json" % (stamp, brain))
    payload = {
        **({"suite_version": declared} if declared is not None else {}),
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "config": config,
        "summary": body["summary"],
        "results": body["results"],
    }
    path = _save_artifact(path, lambda dest: json.dumps({**payload, "name": dest.stem}, indent=1))
    return {"saved": str(path.relative_to(PROJECT_ROOT)), "name": path.stem}


def api_bench_runs(_body, query):
    """Recent runs, newest first: name, config, and summary (?name=<run> returns one in full)."""
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    name = (query.get("name") or [""])[0]
    if name:
        safe = "".join(ch for ch in name if ch.isalnum() or ch in "-_")
        path = RUNS_DIR / ("%s.json" % safe)
        if not safe or not path.is_file():
            raise BadRequest("No run named %s" % safe)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, RecursionError):
            raise BadRequest("Run %s could not be read" % safe)
    runs = []
    for path in sorted(RUNS_DIR.glob("*.json"), reverse=True):
        if len(runs) >= 30:
            break
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, RecursionError):
            continue
        if not isinstance(data, dict):
            continue
        runs.append(
            {
                "name": path.stem,
                "saved_at": data.get("saved_at"),
                "suite_version": data.get("suite_version", "legacy"),
                "config": data.get("config"),
                "summary": data.get("summary"),
            }
        )
    return {"runs": runs}


# Model recordings (ROADMAP 2.6): every answer a model driver got, keyed by its request, so a run
# replays with no key. Saved like runs, but under data/recordings/, which is committed.


def valid_suite_version(version):
    return isinstance(version, str) and (
        version in ("legacy", "custom")
        or (version.startswith("v") and version[1:2] in "123456789" and version[1:].isdigit())
    )


def api_recording_save(body, _query):
    """Store a model recording (static/js/brain/recording.js) under data/recordings/."""
    if body.get("format") != RECORDING_FORMAT:
        raise BadRequest("format must be %s" % RECORDING_FORMAT)
    header, drives = body.get("header"), body.get("drives")
    results, scenarios = body.get("results", {}), body.get("scenarios", {})
    if not all(isinstance(v, dict) for v in (header, drives, results, scenarios)):
        raise BadRequest("a recording needs header, drives, results and scenarios objects")
    if not all(
        isinstance(answers, dict) and all(isinstance(v, list) for v in answers.values()) for answers in drives.values()
    ):
        raise BadRequest("each drive maps request keys to lists of outcomes")
    declared, manifest = header.get("suite_version"), header.get("manifest")
    if (
        ("suite_version" in header and not valid_suite_version(declared))
        or any(not isinstance(result, dict) or result.get("suite_version") != declared for result in results.values())
        or (
            manifest is not None
            and (
                not isinstance(manifest, dict)
                or manifest.get("suite_version") != declared
                or (manifest.get("format") == "jev-run-manifest/1" and declared is not None)
                or (manifest.get("format") == "jev-run-manifest/2" and declared is None)
            )
        )
    ):
        raise BadRequest("recording and results must agree on suite_version")
    driver = (
        "".join(ch if ch.isalnum() else "-" for ch in str(header.get("driver") or "model"))[:40].strip("-") or "model"
    )
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = RECORDINGS_DIR / ("%s-%s.json" % (stamp, driver))
    text = _recording_text(header, results, scenarios, drives)
    path = _save_artifact(path, lambda _: text)
    return {"saved": str(path.relative_to(PROJECT_ROOT)), "name": path.stem}


def _recording_text(header, results, scenarios, drives):
    """The layout ModelRecording.serialize() writes: a line for the header, each result, each scenario
    and each request."""

    def dumps(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    def lines(obj, indent, each):
        return ",\n".join("%s%s: %s" % (indent, json.dumps(k, ensure_ascii=False), each(v)) for k, v in obj.items())

    text = lines(drives, "  ", lambda answers: "{\n%s\n  }" % lines(answers, "   ", dumps))
    return (
        '{\n "format": %s,\n "header": %s,\n "results": {\n%s\n },\n "scenarios": {\n%s\n },\n "drives": {\n%s\n }\n}\n'
        % (
            json.dumps(RECORDING_FORMAT),
            dumps(header),
            lines(results, "  ", dumps),
            lines(scenarios, "  ", dumps),
            text,
        )
    )


def _recording_candidates(name):
    yield RECORDINGS_DIR / f"{name}.json"
    yield RECORDINGS_DIR / f"{name}.json.gz"
    if name.endswith((".json", ".json.gz")):
        yield RECORDINGS_DIR / name
    if name.endswith(".json"):
        yield RECORDINGS_DIR / f"{name}.gz"


def _recording_basename(name):
    return bool(name) and not name.startswith(".") and all(ch.isalnum() or ch in "-_." for ch in name)


def _load_recording_data(path):
    try:
        data = _read_json_file(path)
    except (OSError, ValueError, EOFError, RecursionError, zlib.error):
        return None
    return data if isinstance(data, dict) else None


def api_recordings(_body, query):
    """Recordings, newest first, with their headers (?name=<recording> returns one in full)."""
    name = (query.get("name") or [""])[0]
    if name:
        if not _recording_basename(name):
            raise BadRequest("Invalid recording name")
        found = False
        fallback = None
        for path in _recording_candidates(name):
            if not path.is_file():
                continue
            found = True
            data = _load_recording_data(path)
            if data is not None and data.get("format") == RECORDING_FORMAT:
                return data
            if fallback is None:
                fallback = data
        if fallback is not None:
            return fallback
        if found:
            raise BadRequest("Recording %s could not be read" % name)
        raise BadRequest("No recording named %s" % name)
    recordings = []
    if RECORDINGS_DIR.is_dir():
        paths = sorted(
            list(RECORDINGS_DIR.glob("*.json")) + list(RECORDINGS_DIR.glob("*.json.gz")),
            key=lambda p: (_recording_name(p), p.name.endswith(".json")),
            reverse=True,
        )
    else:
        paths = []
    seen = set()
    for path in paths:
        if len(recordings) >= 50:
            break
        rec_name = _recording_name(path)
        if rec_name in seen or not _recording_basename(rec_name):
            continue
        data = _load_recording_data(path)
        if data is not None and data.get("format") == RECORDING_FORMAT:
            seen.add(rec_name)
            drives = data.get("drives")
            recordings.append(
                {
                    "name": rec_name,
                    "header": data.get("header"),
                    "drives": sorted(drives) if isinstance(drives, dict) else [],
                }
            )
    return {"recordings": recordings}


def api_results(_body, _query):
    """The committed results (data/results.json), as the leaderboard page and the demo show them."""
    if not RESULTS_FILE.is_file():
        raise BadRequest("No results file: run uv run scripts/build_results.py")
    return json.loads(RESULTS_FILE.read_text())


ROUTES = {
    ("GET", "/api/health"): api_health,
    ("GET", "/api/diagnostics"): api_diagnostics,
    ("GET", "/api/status"): api_status,
    ("GET", "/api/map"): api_map,
    ("GET", "/api/maps"): api_maps,
    ("POST", "/api/drives"): api_drives,
    ("POST", "/api/route"): api_route,
    ("POST", "/api/decide"): api_decide,
    ("POST", "/api/llm/decide"): api_llm_decide,
    ("POST", "/api/llm/check"): api_llm_check,
    ("POST", "/api/llm/models"): api_llm_models,
    ("POST", "/api/llm/save"): api_llm_save,
    ("POST", "/api/llm/remove"): api_llm_remove,
    ("POST", "/api/decision/decide"): api_decision_decide,
    ("POST", "/api/decision/check"): api_decision_check,
    ("POST", "/api/decision/models"): api_decision_models,
    ("POST", "/api/decision/save"): api_decision_save,
    ("POST", "/api/decision/remove"): api_decision_remove,
    ("POST", "/api/snapshot/save"): api_snapshot_save,
    ("POST", "/api/bench/save"): api_bench_save,
    ("GET", "/api/bench/runs"): api_bench_runs,
    ("POST", "/api/recordings/save"): api_recording_save,
    ("GET", "/api/recordings"): api_recordings,
    ("GET", "/api/results"): api_results,
}

CSP = (
    "default-src 'self'; script-src 'self' 'nonce-%s'; "
    "connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; "
    "style-src 'self' 'unsafe-inline'; font-src 'self'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)


class LocalServer(ThreadingHTTPServer):
    # Module graphs and map previews arrive in bursts. The default five-connection
    # backlog can reset parallel asset downloads on a cold browser load.
    request_queue_size = 128


class Handler(BaseHTTPRequestHandler):
    server_version = "JevFSD/" + VERSION
    port = 8322

    def log_message(self, fmt, *args):
        if os.environ.get("JEV_FSD_QUIET") or any(
            p in str(args[0]) for p in ("/api/decide", "/api/llm/decide", "/api/decision/decide")
        ):
            return
        log(fmt % args)

    def _send(self, status, payload, content_type="application/json", nonce=""):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        # Header values must stay on one line, including types from the MIME registry.
        safe_content_type = content_type.replace("\r", "").replace("\n", "")
        if safe_content_type != content_type:
            safe_content_type = "application/octet-stream"
        self.send_response(status)
        self.send_header("Content-Type", safe_content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP % (nonce or "none"))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self, method):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)
        raw_lengths = self.headers.get_all("Content-Length") if hasattr(self.headers, "get_all") else None
        if raw_lengths and len(raw_lengths) > 1:
            return self._send(400, {"error": "Invalid Content-Length"})
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            length = 0
        else:
            value = raw_length.strip()
            if not value.isascii() or not value.isdecimal():
                return self._send(400, {"error": "Invalid Content-Length"})
            try:
                length = int(value)
            except ValueError:
                return self._send(400, {"error": "Invalid Content-Length"})
        reason = security.check_request(method, self.headers, SESSION_TOKEN, self.port, has_body=length > 0)
        if reason:
            return self._send(403, {"error": security.REASONS[reason], "reason": reason})
        route = ROUTES.get((method, path))
        if route:
            try:
                if length > (MAX_RECORDING_BYTES if path == "/api/recordings/save" else MAX_BODY_BYTES):
                    raise BadRequest("Request body too large")
                body = json.loads(self.rfile.read(length).decode() or "{}") if length else {}
                if not isinstance(body, dict):
                    raise BadRequest("Body must be a JSON object")
                self._send(200, route(body, query))
            except BadRequest as err:
                self._send(400, {"error": str(err)})
            except JevError as err:
                status = err.status if err.status in (401, 402, 403, 422, 429, 504) else 502
                self._send(status, {"error": str(err), "jev_status": err.status})
            except (KeyError, ValueError, TypeError) as err:
                traceback.print_exc()
                self._send(400, {"error": "Bad request: %s" % err})
            except Exception as err:  # noqa: BLE001
                traceback.print_exc()
                self._send(500, {"error": "Server error: %s" % err})
            return
        if method != "GET":
            return self._send(404, {"error": "Not found"})
        if path in PAGES:
            nonce = secrets.token_urlsafe(16)
            html = (STATIC / PAGES[path]).read_text()
            html = html.replace("</head>", '<meta name="jev-csrf" content="%s">\n</head>' % SESSION_TOKEN, 1)
            html = html.replace('<script type="importmap">', '<script type="importmap" nonce="%s">' % nonce)
            return self._send(200, html.encode(), "text/html; charset=utf-8", nonce=nonce)
        root = os.path.realpath(STATIC)
        file = os.path.realpath(os.path.join(root, path.lstrip("/")))
        # Include the separator so sibling directories such as static-private cannot pass.
        if not file.startswith(root + os.sep) or not os.path.isfile(file):
            return self._send(404, {"error": "Not found"})
        ctype = mimetypes.guess_type(file)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, Path(file).read_bytes(), ctype)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def main():
    port = settings.port
    Handler.port = port
    try:
        httpd = LocalServer(("127.0.0.1", port), Handler)
    except OSError as err:
        print("Could not listen on 127.0.0.1:%d (%s). Set PORT=<other port> and try again." % (port, err))
        return 1
    key_note = (
        ("API key from %s" % client.key_source)
        if client.configured
        else "no API key: Connect a model in the app, or add TYPESAFE_API_KEY to .env"
    )
    print("\n  Jev FSD %s  ->  http://127.0.0.1:%d" % (VERSION, port))
    print("  model %s via %s . %s" % (client.model, client.backend, key_note))
    print(
        "  spend guard $%.2f per run (JEV_FSD_BUDGET_USD) . map bbox %s"
        % (client.guard.budget_usd, ",".join(str(v) for v in settings.bbox))
    )
    for e in llm_registry.public()["endpoints"]:
        print(
            "  llm:%s  %s at %s . key %s%s"
            % (e["name"], e["model"], e["endpoint"], e["key"], "" if e["priced"] else " . no price set")
        )
    for problem in llm_registry.problems:
        print("  llm config: %s" % problem)
    for e in decision_registry.public()["endpoints"]:
        print("  decision:%s  %s at %s%s . key %s" % (e["name"], e["model"], e["endpoint"], e["path"], e["key"]))
    for problem in decision_registry.problems:
        print("  decision config: %s" % problem)
    entry = load_map()
    print(
        "  map: %d edges, %d signals, %d stops, %d buildings%s\n"
        % (
            len(entry["pack"]["edges"]),
            len(entry["pack"]["intersections"]),
            len(entry["pack"]["stops"]),
            len(entry["pack"]["buildings"]),
            " (SYNTHETIC fallback: %s)" % entry["error"] if entry["error"] else "",
        )
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  bye")
    return 0


if __name__ == "__main__":
    sys.exit(main())
