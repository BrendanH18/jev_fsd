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
import re
import secrets
import stat
import sys
import tempfile
import threading
import time
import traceback
import unicodedata
import zlib
from email.utils import formatdate, parsedate_to_datetime
from functools import lru_cache
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from jev import VERSION, decide, decision, decision_setup, llm, llm_setup, security
from jev.client import PRICE_PER_INPUT_TOKEN_USD, JevClient, JevError
from jev.config import (
    DEFAULT_PORT,
    MAPS_DIR,
    PROJECT_ROOT,
    RECORDINGS_DIR,
    RUNS_DIR,
    SNAPSHOTS_DIR,
    Settings,
    parse_bbox,
)
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
mimetypes.init()  # the system table too, as guess_type would load it (_send_asset)
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
MAX_RECORDING_HEADER_BYTES = 64 * 1024  # bounds what each cached recording listing holds
MAX_RUN_BYTES = 16 * 1024 * 1024
MAX_LISTING_METADATA_BYTES = 256 * 1024
MAX_ARTIFACT_FILENAME_BYTES = 255
MAX_SAVE_ATTEMPTS = 16
MAX_QUERY_FIELDS = 64
REQUEST_TIMEOUT_SECONDS = 15
ASSET_CHUNK_BYTES = 64 * 1024
MAX_CACHED_MAPS = 24
MAP_RETRY_SECONDS = 60
_save_lock = threading.Lock()
_setup_write_lock = threading.Lock()
RECORDING_FORMAT = "jev-model-recording/1"

settings = Settings()
client = JevClient(settings)
llm_registry = llm.LlmRegistry(settings, client.guard)  # shares Jev's budget and rate limit
decision_registry = decision.DecisionRegistry(settings, client.guard)
SESSION_TOKEN = security.new_token()
_maps: dict = {}  # bbox key -> {"pack", "router", "error"}
_maps_lock = threading.Lock()
_map_locks: dict = {}  # bbox key -> (threading.Lock, callers currently sharing it)
_STARTED_AT = time.monotonic()


class BadRequest(Exception):
    pass


def log(msg: str) -> None:
    safe = "".join(ch if ch.isprintable() else repr(ch)[1:-1] for ch in msg)
    sys.stderr.write("  %s  %s\n" % (time.strftime("%H:%M:%S"), safe))


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
                if os.path.lexists(path):
                    raise FileExistsError(path) from error
                os.replace(tmp_path, path)
                tmp_path = None
    finally:
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except FileNotFoundError:
                pass
            except OSError as error:
                log(f"Could not clean up temporary artifact {tmp_path}: {error}")


def _save_artifact(path, encode, limit=MAX_RUN_BYTES):
    destination = path
    for _ in range(MAX_SAVE_ATTEMPTS):
        try:
            content = encode(destination)
            size = len(content.encode("utf-8"))
        except (ValueError, TypeError, RecursionError):
            raise BadRequest("Artifact must contain valid UTF-8 JSON") from None
        if size > limit:
            raise BadRequest("Saved artifact would exceed its size limit")
        try:
            _atomic_write_text(destination, content)
        except FileExistsError:
            destination = path.with_name(f"{path.stem}-{secrets.token_hex(4)}{path.suffix}")
        else:
            return destination
    raise BadRequest("Could not choose a unique name for the saved artifact. Try again.")


def _read_json_file(path: Path, limit: int):
    with path.open("rb") as fh:
        if path.name.endswith(".json.gz"):
            with gzip.GzipFile(fileobj=fh) as archive:
                data = archive.read(limit + 1)
        else:
            data = fh.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Saved file exceeds the decoded size limit")
    return json.loads(
        data.decode("utf-8-sig"),
        parse_constant=_reject_json_constant,
        parse_float=_json_float,
        object_pairs_hook=_json_object,
    )


def _artifact_stat(path: Path):
    try:
        info = path.lstat()
    except OSError:
        return None
    return info if stat.S_ISREG(info.st_mode) else None


def _load_saved_object(path: Path, limit: int):
    try:
        info = _artifact_stat(path)
        if info is None or (not path.name.endswith(".json.gz") and info.st_size > limit):
            return None
        data = _read_json_file(path, limit)
    except (OSError, ValueError, EOFError, RecursionError, zlib.error):
        return None
    return data if isinstance(data, dict) else None


def _header_fits(header) -> bool:
    """A recording header small enough to list and cache (real headers are a few kilobytes)."""
    try:
        return len(json.dumps(header, allow_nan=False)) <= MAX_RECORDING_HEADER_BYTES
    except (TypeError, ValueError, RecursionError):
        return False


def _usable_recording(data) -> bool:
    """The shape accepted for the current model recording format."""
    if not (
        isinstance(data, dict)
        and data.get("format") == RECORDING_FORMAT
        and isinstance(data.get("header"), dict)
        and _header_fits(data["header"])
        and isinstance(data.get("drives"), dict)
        and _drive_answers_shaped(data["drives"])
    ):
        return False
    results, scenarios = data.get("results", {}), data.get("scenarios", {})
    return (
        isinstance(results, dict) and _scenario_objects(scenarios) and _recording_suite_matches(data["header"], results)
    )


def _drive_answers_shaped(drives: dict) -> bool:
    """Each drive maps request keys to lists of outcomes, as the browser's tape player expects."""
    return all(
        isinstance(answers, dict)
        and all(isinstance(v, list) and all(isinstance(item, dict) for item in v) for v in answers.values())
        for answers in drives.values()
    )


def _scenario_objects(scenarios):
    return isinstance(scenarios, dict) and all(isinstance(value, dict) for value in scenarios.values())


@lru_cache(maxsize=256)
def _artifact_metadata(path: Path, signature: tuple, recording: bool, limit: int):
    """Only hold listing metadata in memory, including for large legacy tapes."""
    data = _load_saved_object(path, limit)
    if data is None:
        return None
    if recording:
        if not _usable_recording(data):
            return None
        item = {"name": _recording_name(path), "header": data["header"], "drives": sorted(data["drives"])}
    else:
        if not _usable_run(data):
            return None
        item = {
            "name": path.stem,
            "saved_at": data.get("saved_at"),
            "suite_version": data.get("suite_version", "legacy"),
            "config": data.get("config"),
            "summary": data.get("summary"),
        }
    # An oversized repaired/imported file is still directly addressable by name.
    return item if len(json.dumps(item)) <= MAX_LISTING_METADATA_BYTES else None


def _listed_artifact(path: Path, recording: bool = False):
    info = _artifact_stat(path)
    if info is None:
        return None
    signature = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    return _artifact_metadata(path, signature, recording, MAX_ARCHIVE_BYTES if recording else MAX_RUN_BYTES)


def _recording_name(path: Path) -> str:
    if path.name.endswith(".json.gz"):
        return path.name[: -len(".json.gz")]
    if path.name.endswith(".json"):
        return path.name[: -len(".json")]
    return path.stem


# Maps


def load_map(bbox_text: str = "", *, refresh: bool = False) -> dict:
    bbox = parse_bbox(bbox_text) or settings.bbox
    key = "%.5f,%.5f,%.5f,%.5f" % bbox
    if tuple(map(float, key.split(","))) != bbox:
        key = ",".join(format(value, ".17g") for value in bbox)
    with _maps_lock:
        if (entry := _cached_map(key, refresh)) is not None:
            return entry
        lock, callers = _map_locks[key] if key in _map_locks else (threading.Lock(), 0)
        _map_locks[key] = (lock, callers + 1)
    try:
        with lock:
            with _maps_lock:
                if (entry := _cached_map(key, refresh)) is not None:
                    return entry
            entry = _build_map(bbox)
            with _maps_lock:
                _maps.pop(key, None)
                _maps[key] = entry
                if len(_maps) > MAX_CACHED_MAPS:
                    del _maps[next(iter(_maps))]
            return entry
    finally:
        with _maps_lock:
            _, callers = _map_locks[key]
            if callers == 1:
                del _map_locks[key]
            else:
                _map_locks[key] = (lock, callers - 1)


def _cached_map(key: str, refresh: bool):
    """Look up and promote a map with _maps_lock held."""
    entry = _maps.get(key)
    if entry is None or (refresh and "retry_at" in entry and time.monotonic() >= entry["retry_at"]):
        return None
    _maps[key] = _maps.pop(key)
    return entry


def _build_map(bbox: tuple) -> dict:
    error = None
    try:
        pack = dict(build_pack(bbox, MAPS_DIR, log=log))
        for name, build_layer in (
            ("transit", build_transit),
            ("crossings", build_crossings),
            ("zones", build_zones),
            ("rail", build_rail),
            ("buslanes", build_buslanes),
            ("calming", build_calming),
            ("scrambles", build_scrambles),
            ("restrictions", build_restrictions),
            ("contraflow", build_contraflow),
            ("driveways", build_driveways),
            ("parks", build_parks),
            ("bridges", build_bridges),
        ):
            layer = build_layer(bbox, MAPS_DIR, pack, log=log)
            if layer:
                pack[name] = layer
        offset = map_identity(bbox).get("utc_offset")
        if offset is not None:
            pack["utc_offset"] = offset
    except fetch.FetchError as err:
        log(f"map: {err}, using the synthetic grid")
        error = str(err)
        pack = synthetic_pack()
    entry = {"bbox": bbox, "pack": pack, "router": Router(pack), "error": error}
    if error is not None:
        entry["retry_at"] = time.monotonic() + MAP_RETRY_SECONDS
    return entry


def _map_selector(value: str | None) -> str:
    if value is None or value == "":
        return ""
    bbox = parse_bbox(value)
    if bbox is None:
        raise BadRequest("bbox must be a map preset or W,S,E,N in degrees")
    return value


def _map_query(query: dict) -> str:
    values = query.get("bbox") or query.get("map") or [""]
    if len(values) != 1:
        raise BadRequest("Specify one bbox or map preset")
    return _map_selector(values[0])


def _heading(value: float) -> float:
    # Router angle wrapping iterates over full turns. Preserve normal input exactly.
    return math.remainder(value, math.tau) if abs(value) > 32 * math.tau else value


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
    entry = load_map(_map_query(query))
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
    entry = load_map(_map_query(query), refresh=True)
    return {**entry["pack"], "routing_bbox": list(entry["bbox"])}


def api_maps(_body, _query):
    return {"maps": catalog(MAPS_DIR)}


@lru_cache(maxsize=1)
def _synthetic_router():
    return Router(synthetic_pack())


def _routing_router(body):
    selector = _map_selector(body.get("bbox"))
    # The same synthetic grid serves every fallback bbox, even after its streets become available.
    if body.get("synthetic") is True:
        return _synthetic_router()
    return load_map(selector)["router"]


def api_drives(body, _query):
    raw = body.get("from")
    try:
        if not isinstance(raw, dict) or any(isinstance(raw[k], bool) for k in ("x", "y", "heading")):
            raise TypeError()
        start = {k: float(raw[k]) for k in ("x", "y", "heading")}
        if not all(math.isfinite(v) for v in start.values()):
            raise ValueError()
    except (KeyError, TypeError, ValueError, OverflowError):
        raise BadRequest("from {x, y, heading} with finite coordinates is required")
    start["heading"] = _heading(start["heading"])
    return {"drives": suggested_drives(_routing_router(body), start)}


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
    if not 0 <= hour < 24:
        raise BadRequest("hour must be from 0 up to 24")
    raw_weekday = body.get("weekday", 0)
    try:
        if isinstance(raw_weekday, bool) or (isinstance(raw_weekday, float) and not raw_weekday.is_integer()):
            raise TypeError("weekday is not an integer")
        weekday = int(raw_weekday)
    except (TypeError, ValueError, OverflowError):
        raise BadRequest("weekday must be an integer")
    if not 0 <= weekday <= 6:
        raise BadRequest("weekday must be from 0 (Monday) to 6 (Sunday)")
    # (edges no route may enter: a block closed for an event, static/js/sim/road-closures.js)
    avoid = body.get("avoid")
    if avoid is None:
        avoid = []
    if (
        not isinstance(avoid, list)
        or len(avoid) > 200
        or not all(isinstance(a, str) and 0 < len(a) <= 64 and a.isprintable() and a.strip() == a for a in avoid)
    ):
        raise BadRequest("avoid must be a list of edge ids")
    restrictions = body.get("restrictions", False)
    if not isinstance(restrictions, bool):
        raise BadRequest("restrictions must be a boolean")
    if start["heading"] is not None:
        start["heading"] = _heading(start["heading"])
    router = _routing_router(body)
    started = time.perf_counter()
    routes = router.routes(
        start,
        goal,
        k=k,
        restrictions=restrictions,
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


def _probe_force(body):
    force = body.get("force", False)
    if not isinstance(force, bool):
        raise BadRequest("force must be a boolean")
    return force


def api_llm_check(body, _query):
    """Probe every configured endpoint (GET {base_url}/models, no spend). POST so it needs the token."""
    return {"endpoints": llm_registry.check_all(force=_probe_force(body))}


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


def _mutate_setup(action, body, message, result_key):
    # Include both reloads in the same transaction as the HTTP configuration edit.
    with _setup_write_lock:
        result = _setup(action, body)
        log(message % result[result_key])
        return _saved(result)


def api_llm_models(body, _query):
    """The Connect a model dialog's model list: GET {base_url}/models for a provider (no spend)."""
    return _setup(lambda b: llm_setup.list_models(settings, b), body)


def api_llm_save(body, _query):
    """Save a model from the dialog: key to .env, endpoint to the endpoints file, then reload."""
    return _mutate_setup(lambda b: llm_setup.save(settings, llm_registry, b), body, "llm setup: saved llm:%s", "saved")


def api_llm_remove(body, _query):
    return _mutate_setup(
        lambda b: llm_setup.remove(settings, llm_registry, b), body, "llm setup: removed llm:%s", "removed"
    )


def api_decision_decide(body, _query):
    try:
        return decision.decision_decide(decision_registry, body)
    except decision.InvalidDecisionRequest as err:
        raise BadRequest(str(err))


def api_decision_check(body, _query):
    """Probe every decision endpoint (one free GET each). POST so it needs the token."""
    return {"endpoints": decision_registry.check_all(force=_probe_force(body))}


def api_decision_models(body, _query):
    return _setup(lambda b: decision_setup.list_models(settings, b), body)


def api_decision_save(body, _query):
    """Save a decision model, or just the TypeSafe key for the built-in Jev driver."""
    return _mutate_setup(
        lambda b: decision_setup.save(settings, decision_registry, client, b), body, "decision setup: saved %s", "id"
    )


def api_decision_remove(body, _query):
    return _mutate_setup(
        lambda b: decision_setup.remove(settings, decision_registry, client, b),
        body,
        "decision setup: removed decision:%s",
        "removed",
    )


def api_snapshot_save(body, _query):
    name = body.get("name")
    if name is not None and not isinstance(name, str):
        raise BadRequest("snapshot name must be text")
    name = name or "snapshot"
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "-_")[:60] or "snapshot"
    try:
        req = decide.validate_request(body)
    except decide.InvalidRequest as err:
        raise BadRequest(str(err))
    expect = body.get("expect")
    if expect is not None and not isinstance(expect, dict):
        raise BadRequest("expect must be an object")
    path = SNAPSHOTS_DIR / ("%s.json" % safe)
    payload = {
        "name": safe,
        "state": req["state"],
        "questions": req["questions"],
        "expect": expect or {},
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    path = _save_artifact(path, lambda dest: json.dumps({**payload, "name": dest.stem}, indent=2, allow_nan=False))
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
    config = body["config"]
    if not isinstance(config, dict):
        raise BadRequest("config must be an object")
    label = config.get("brain")
    if label is not None and not isinstance(label, str):
        raise BadRequest("config.brain must be text")
    brain = "".join(ch for ch in label or "run" if ch.isalnum())[:20] or "run"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = RUNS_DIR / ("%s-%s.json" % (stamp, brain))
    payload = {
        **({"suite_version": declared} if declared is not None else {}),
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "config": config,
        "summary": body["summary"],
        "results": body["results"],
    }
    path = _save_artifact(
        path, lambda dest: json.dumps({**payload, "name": dest.stem}, indent=1, allow_nan=False), MAX_RUN_BYTES
    )
    return {"saved": str(path.relative_to(PROJECT_ROOT)), "name": path.stem}


def _usable_run(data):
    if (
        not isinstance(data, dict)
        or not isinstance(data.get("config"), dict)
        or not isinstance(data.get("summary"), dict)
    ):
        return False
    results = data.get("results", [])
    declared = data.get("suite_version")
    return (
        isinstance(results, list)
        and ("suite_version" not in data or valid_suite_version(declared))
        and all(isinstance(result, dict) and result.get("suite_version") == declared for result in results)
    )


def _run_name(name: str) -> bool:
    return (
        bool(name)
        and all(ch.isalnum() or ch in "-_" for ch in unicodedata.normalize("NFC", name))
        and len(name.encode("utf-8")) + len(".json") <= MAX_ARTIFACT_FILENAME_BYTES
    )


def _list_limit(query, default):
    limits = query.get("limit", [])
    if not limits:
        return default
    if len(limits) == 1:
        value = limits[0]
        if 0 < len(value) <= len(str(default)) and value.isascii() and value.isdecimal():
            limit = int(value)
            if 1 <= limit <= default:
                return limit
    raise BadRequest(f"limit must be an integer from 1 to {default}")


def _artifact_query_name(query):
    names = query.get("name") or [""]
    if len(names) != 1:
        raise BadRequest("Specify one artifact name")
    return names[0]


def _artifact_filters(query, name_is_valid):
    def one(field):
        values = query.get(field, [])
        if len(values) > 1:
            raise BadRequest(f"Specify one {field} filter")
        return values[0] if values else None

    before, suite, driver = one("before"), one("suite_version"), one("driver")
    if before is not None and not name_is_valid(before):
        raise BadRequest("before must be a valid artifact name")
    if suite is not None and not valid_suite_version(suite):
        raise BadRequest("suite_version must be legacy, custom, or a numbered version")
    if driver is not None and (not driver or len(driver) > 128 or not driver.isprintable()):
        raise BadRequest("driver must be a printable driver ID up to 128 characters")
    return before, suite, driver


def api_bench_runs(_body, query):
    """Recent runs, newest first: name, config, and summary (?name=<run> returns one in full)."""
    name = _artifact_query_name(query)
    if name:
        if not _run_name(name):
            raise BadRequest("Invalid run name")
        path = RUNS_DIR / ("%s.json" % name)
        if _artifact_stat(path) is None:
            raise BadRequest("No run named %s" % name)
        data = _load_saved_object(path, MAX_RUN_BYTES)
        if not _usable_run(data):
            raise BadRequest("Run %s could not be read" % name)
        return data
    limit = _list_limit(query, 30)
    before, suite, driver = _artifact_filters(query, _run_name)
    runs = []
    for path in sorted(RUNS_DIR.glob("*.json"), reverse=True):
        if len(runs) >= limit:
            break
        if not _run_name(path.stem) or (before is not None and path.stem >= before):
            continue
        item = _listed_artifact(path)
        if (
            item is not None
            and (suite is None or item["suite_version"] == suite)
            and (driver is None or item["config"].get("brain") == driver)
        ):
            runs.append(item)
    return {"runs": runs}


# Model recordings (ROADMAP 2.6): every answer a model driver got, keyed by its request, so a run
# replays with no key. Saved like runs, but under data/recordings/, which is committed.


def valid_suite_version(version):
    return isinstance(version, str) and (
        version in ("legacy", "custom")
        or (
            version.startswith("v")
            and version[1:2] in "123456789"
            and (version[1:].isascii() and version[1:].isdigit())
        )
    )


def _recording_suite_matches(header, results):
    declared, manifest = header.get("suite_version"), header.get("manifest")
    return (
        ("suite_version" not in header or valid_suite_version(declared))
        and all(isinstance(result, dict) and result.get("suite_version") == declared for result in results.values())
        and (
            manifest is None
            or (
                isinstance(manifest, dict)
                and manifest.get("suite_version") == declared
                and (manifest.get("format") != "jev-run-manifest/1" or declared is None)
                and (manifest.get("format") != "jev-run-manifest/2" or declared is not None)
            )
        )
    )


def api_recording_save(body, _query):
    """Store a model recording (static/js/brain/recording.js) under data/recordings/."""
    if body.get("format") != RECORDING_FORMAT:
        raise BadRequest("format must be %s" % RECORDING_FORMAT)
    header, drives = body.get("header"), body.get("drives")
    results, scenarios = body.get("results", {}), body.get("scenarios", {})
    if not all(isinstance(v, dict) for v in (header, drives, results, scenarios)):
        raise BadRequest("a recording needs header, drives, results and scenarios objects")
    if not _header_fits(header):
        raise BadRequest("a recording header must be under %d KiB" % (MAX_RECORDING_HEADER_BYTES // 1024))
    if not _drive_answers_shaped(drives):
        raise BadRequest("each drive maps request keys to lists of outcome objects")
    if not _scenario_objects(scenarios):
        raise BadRequest("each recording scenario must be an object")
    if not _recording_suite_matches(header, results):
        raise BadRequest("recording and results must agree on suite_version")
    label = header.get("driver")
    if label is not None and not isinstance(label, str):
        raise BadRequest("recording header driver must be text")
    driver = "".join(ch if ch.isalnum() else "-" for ch in label or "model")[:40].strip("-") or "model"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = RECORDINGS_DIR / ("%s-%s.json" % (stamp, driver))
    path = _save_artifact(path, lambda _: _recording_text(header, results, scenarios, drives), MAX_ARCHIVE_BYTES)
    return {"saved": str(path.relative_to(PROJECT_ROOT)), "name": path.stem}


def _recording_text(header, results, scenarios, drives):
    """The layout ModelRecording.serialize() writes: a line for the header, each result, each scenario
    and each request."""

    def dumps(value):
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))

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
    for suffix in (".json", ".json.gz"):
        if len(name.encode("utf-8")) + len(suffix) <= MAX_ARTIFACT_FILENAME_BYTES:
            yield RECORDINGS_DIR / f"{name}{suffix}"
    if name.endswith((".json", ".json.gz")):
        yield RECORDINGS_DIR / name
    if name.endswith(".json"):
        if len(name.encode("utf-8")) + len(".gz") <= MAX_ARTIFACT_FILENAME_BYTES:
            yield RECORDINGS_DIR / f"{name}.gz"


def _recording_basename(name):
    return (
        bool(name)
        and not name.startswith(".")
        and all(ch.isalnum() or ch in "-_." for ch in unicodedata.normalize("NFC", name))
        and len(name.encode("utf-8")) <= MAX_ARTIFACT_FILENAME_BYTES
    )


def api_recordings(_body, query):
    """Recordings, newest first, with their headers (?name=<recording> returns one in full)."""
    name = _artifact_query_name(query)
    if name:
        if not _recording_basename(name):
            raise BadRequest("Invalid recording name")
        found = False
        fallback = None
        for path in _recording_candidates(name):
            if _artifact_stat(path) is None:
                continue
            found = True
            data = _load_saved_object(path, MAX_ARCHIVE_BYTES)
            if _usable_recording(data):
                return data
            if fallback is None and data is not None and data.get("format") != RECORDING_FORMAT:
                fallback = data
        if fallback is not None:
            return fallback
        if found:
            raise BadRequest("Recording %s could not be read" % name)
        raise BadRequest("No recording named %s" % name)
    recordings = []
    limit = _list_limit(query, 50)
    before, suite, driver = _artifact_filters(query, _recording_basename)
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
        if len(recordings) >= limit:
            break
        rec_name = _recording_name(path)
        if rec_name in seen or not _recording_basename(rec_name) or (before is not None and rec_name >= before):
            continue
        item = _listed_artifact(path, recording=True)
        if item is None:
            continue
        seen.add(rec_name)
        header = item["header"]
        if (suite is None or header.get("suite_version", "legacy") == suite) and (
            driver is None or header.get("driver") == driver
        ):
            recordings.append(item)
    return {"recordings": recordings}


def api_results(_body, _query):
    """The committed results (data/results.json), as the leaderboard page and the demo show them."""
    if _artifact_stat(RESULTS_FILE) is None:
        raise BadRequest("No results file: run uv run scripts/build_results.py")
    data = _load_saved_object(RESULTS_FILE, MAX_RUN_BYTES)
    if data is None:
        raise BadRequest("The results file is unreadable: run uv run scripts/build_results.py")
    return data


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


def _reject_json_constant(value):
    raise ValueError("Invalid JSON constant %s" % value)


def _json_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("JSON number is out of range")
    return number


def _json_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError("Duplicate JSON property")
        obj[key] = value
    return obj


def _valid_unicode(value):
    # JSON escape sequences can create lone surrogates even after UTF-8 decoding.
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str):
            item.encode("utf-8")
        elif isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)


class LocalServer(ThreadingHTTPServer):
    # Module graphs and map previews arrive in bursts. The default five-connection
    # backlog can reset parallel asset downloads on a cold browser load.
    request_queue_size = 128

    def verify_request(self, request, address):
        return address[0] == "127.0.0.1"


class Handler(BaseHTTPRequestHandler):
    server_version = "JevFSD/" + VERSION
    sys_version = ""
    port = DEFAULT_PORT
    timeout = REQUEST_TIMEOUT_SECONDS

    def version_string(self):
        return self.server_version

    def log_message(self, fmt, *args):
        if settings.quiet:
            return
        log(fmt % args)

    def log_request(self, code="-", size="-"):
        # URL queries may contain user data. Log only a path and the response status.
        path = getattr(self, "_request_path", None)
        if path in ("/api/decide", "/api/llm/decide", "/api/decision/decide"):
            return
        self.log_message("%.16s %.160s %s", self.command or "", path or "<invalid request>", code)

    def send_error(self, code, message=None, explain=None):
        # Parser errors may interpolate the raw request line. Keep it out of the
        # response and access log, and issue the same envelope as application errors.
        self.close_connection = True
        if self.request_version == "HTTP/0.9":
            self.request_version = "HTTP/1.0"
        return self._send(code, {"error": HTTPStatus(code).phrase})

    def _send_headers(self, status, length, content_type, nonce="", *, allow=(), asset=None):
        if not content_type.isascii() or not content_type.isprintable():
            content_type = "application/octet-stream"
        self.send_response(status)
        if status not in (204, 304):
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
        if allow:
            self.send_header("Allow", ", ".join(allow))
        if asset is None:
            self.send_header("Cache-Control", "no-store")
        else:
            etag, modified = asset
            self.send_header("Cache-Control", "private, no-cache")
            self.send_header("ETag", etag)
            self.send_header("Last-Modified", formatdate(modified, usegmt=True))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", CSP % nonce if nonce else CSP.replace(" 'nonce-%s'", ""))
        self.end_headers()

    def _send(self, status, payload, content_type="application/json", nonce="", *, allow=()):
        data = payload if isinstance(payload, bytes) else json.dumps(payload, allow_nan=False).encode()
        self._send_headers(status, len(data), content_type, nonce, allow=allow)
        if status not in (204, 304) and getattr(self, "command", "") != "HEAD":
            self.wfile.write(data)

    def _handle(self, method):
        self.close_connection = True
        try:
            try:
                return self._dispatch(method)
            except (BadRequest, JevError) as err:
                if isinstance(err, BadRequest):
                    return self._send(400, {"error": str(err)})
                status = err.status if err.status in (401, 402, 403, 422, 429, 504) else 502
                return self._send(status, {"error": str(err), "jev_status": err.status})
            except (ConnectionError, TimeoutError):
                raise
            except Exception as err:  # noqa: BLE001
                path = getattr(self, "_request_path", "<invalid request>")
                log(f"{method} {path[:160]} failed ({type(err).__name__})")
                traceback.print_tb(err.__traceback__)
                return self._send(500, {"error": "Internal server error"})
        except (ConnectionError, TimeoutError):
            return

    def _target(self):
        target = self.path
        # BaseHTTPRequestHandler collapses leading slashes before dispatch. Check
        # the original target as well so it cannot become a different local URL.
        fields = getattr(self, "raw_requestline", b"").split(None, 2)
        if not target.startswith("/") or target.startswith("//") or (len(fields) > 1 and fields[1].startswith(b"//")):
            raise BadRequest("Expected a local request path")
        if "#" in target or any(ord(ch) < 32 or ord(ch) == 127 for ch in target):
            raise BadRequest("Invalid request URL")
        parsed = urlsplit(target)
        if re.search(r"%(?![a-fA-F0-9]{2})", parsed.path + "?" + parsed.query):
            raise BadRequest("Invalid URL encoding")
        if re.search(r"%2f|%5c", parsed.path, re.IGNORECASE):
            raise BadRequest("Invalid encoded path separator")
        try:
            path = unquote(parsed.path, errors="strict")
            query = parse_qs(parsed.query, errors="strict", max_num_fields=MAX_QUERY_FIELDS)
        except ValueError:
            raise BadRequest("Invalid request URL") from None
        if not path.isprintable() or "\\" in path or path.startswith("//"):
            raise BadRequest("Invalid request path")
        return path.rstrip("/") or "/", query

    def _body_length(self):
        if self._header_values("Transfer-Encoding"):
            raise BadRequest("Transfer-Encoding is not supported")
        raw_lengths = self._header_values("Content-Length")
        if len(raw_lengths) > 1:
            raise BadRequest("Invalid Content-Length")
        if not raw_lengths:
            return 0
        value = raw_lengths[0].strip(" \t")
        if not value.isascii() or not value.isdecimal():
            raise BadRequest("Invalid Content-Length")
        digits = value.lstrip("0")
        maximum = max(MAX_BODY_BYTES, MAX_RECORDING_BYTES)
        # Anything wider is larger than either request limit.
        return int(digits or "0") if len(digits) <= len(str(maximum)) else maximum + 1

    def _dispatch(self, method):
        path, query = self._target()
        self._request_path = path
        length = self._body_length()
        reason = security.check_request(
            method,
            self.headers,
            SESSION_TOKEN,
            getattr(getattr(self, "server", None), "server_port", self.port),
            has_body=length > 0,
            private_read=path.startswith("/api/"),
        )
        if reason:
            return self._send(403, {"error": security.REASONS[reason], "reason": reason})
        if self.headers.get("Expect") is not None:
            return self._send(417, {"error": "Expect is not supported"})
        if length and method in security.SAFE_METHODS:
            raise BadRequest(f"{method} does not accept a request body")
        if length:
            encodings = self._header_values("Content-Encoding")
            if len(encodings) > 1 or (encodings and encodings[0].strip(" \t").lower() != "identity"):
                return self._send(415, {"error": "Content-Encoding is not supported"})
        route = ROUTES.get(("GET" if method == "HEAD" else method, path))
        if route is not None:
            if length > (MAX_RECORDING_BYTES if path == "/api/recordings/save" else MAX_BODY_BYTES):
                raise BadRequest("Request body too large")
            try:
                body = self._read_body(length)
            except TimeoutError:
                return self._send(408, {"error": "Timed out reading the request body"})
            return self._send(200, route(body, query))
        methods = [verb for verb, target in ROUTES if target == path]
        if path in PAGES:
            methods.append("GET")
        if "GET" in methods:
            methods.append("HEAD")
        if methods:
            methods.append("OPTIONS")
            if method == "OPTIONS":
                return self._send(204, b"", allow=methods)
            if method not in ("GET", "HEAD", "POST"):
                return self._send(405, {"error": "Method not allowed"}, allow=methods)
        if method not in ("GET", "HEAD") or path.startswith("/api/"):
            return self._send(404, {"error": "Not found"})
        if path in PAGES:
            nonce = secrets.token_urlsafe(16)
            page = self._static_file(PAGES[path])
            if page is None:
                return self._send(404, {"error": "Page file is missing"})
            try:
                html = page.read_text(encoding="utf-8")
            except FileNotFoundError:
                return self._send(404, {"error": "Page file is missing"})
            html = html.replace("</head>", '<meta name="jev-csrf" content="%s">\n</head>' % SESSION_TOKEN, 1)
            html = html.replace('<script type="importmap">', '<script type="importmap" nonce="%s">' % nonce)
            return self._send(200, html.encode(), "text/html; charset=utf-8", nonce=nonce)
        file = self._static_file(path.lstrip("/"))
        if file is None:
            return self._send(404, {"error": "Not found"})
        return self._send_asset(file)

    @staticmethod
    def _static_file(relative):
        root = os.path.realpath(STATIC)
        file = os.path.realpath(os.path.join(root, relative))
        # Include the separator so sibling directories such as static-private cannot pass.
        if not file.startswith(root + os.sep) or not os.path.isfile(file):
            return None
        return Path(file)

    def _send_asset(self, file):
        # Look the type up by suffix in the fixed table, so no part of the request reaches the header.
        ctype = mimetypes.types_map.get(file.suffix.lower()) or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        try:
            handle = file.open("rb")
        except FileNotFoundError:
            return self._send(404, {"error": "Not found"})
        with handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode):
                return self._send(404, {"error": "Not found"})
            etag = 'W/"%x-%x-%x-%x-%x"' % (
                info.st_dev,
                info.st_ino,
                info.st_size,
                info.st_mtime_ns,
                info.st_ctime_ns,
            )
            modified = info.st_mtime_ns // 10**9
            asset = etag, modified
            status = 304 if self._asset_is_fresh(etag, modified) else 200
            self._send_headers(status, info.st_size, ctype, asset=asset)
            if status == 200 and self.command != "HEAD":
                remaining = info.st_size
                while remaining:
                    try:
                        data = handle.read(min(remaining, ASSET_CHUNK_BYTES))
                    except OSError:
                        # Headers are already sent. Close the incomplete response
                        # rather than appending an error body to a static asset.
                        log(f"Could not finish reading static asset {file.name}")
                        break
                    if not data:
                        break
                    self.wfile.write(data)
                    remaining -= len(data)

    def _asset_is_fresh(self, etag, modified):
        tags = self._header_values("If-None-Match")
        if tags:
            return any(tag.strip().removeprefix("W/") in ("*", etag[2:]) for value in tags for tag in value.split(","))
        dates = self._header_values("If-Modified-Since")
        if len(dates) != 1:
            return False
        try:
            since = parsedate_to_datetime(dates[0])
            return since.tzinfo is not None and modified <= since.timestamp()
        except (TypeError, ValueError, OverflowError, OSError):
            return False

    def _read_body(self, length):
        if not length:
            return {}
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise BadRequest("Request body is incomplete")
        try:
            body = json.loads(
                raw.decode("utf-8-sig"),
                parse_constant=_reject_json_constant,
                parse_float=_json_float,
                object_pairs_hook=_json_object,
            )
            _valid_unicode(body)
        except (ValueError, RecursionError):
            raise BadRequest("Body must be valid UTF-8 JSON") from None
        if not isinstance(body, dict):
            raise BadRequest("Body must be a JSON object")
        return body

    def _header_values(self, name):
        if hasattr(self.headers, "get_all"):
            return self.headers.get_all(name, [])
        value = self.headers.get(name)
        return [] if value is None else [value]

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_HEAD(self):
        self._handle("HEAD")

    def do_OPTIONS(self):
        self._handle("OPTIONS")

    def do_PUT(self):
        self._handle("PUT")

    def do_PATCH(self):
        self._handle("PATCH")

    def do_DELETE(self):
        self._handle("DELETE")


def main():
    port = settings.port
    for problem in settings.problems():
        log(f"settings: {problem}")
    try:
        httpd = LocalServer(("127.0.0.1", port), Handler)
    except OSError as err:
        message = f"Could not listen on 127.0.0.1:{port} ({err})."
        if err.errno == errno.EADDRINUSE:
            message += " Close the other server or set PORT to an unused port."
        elif err.errno == errno.EACCES:
            message += " Set PORT to a port this account can bind."
        print(message, file=sys.stderr)
        return 1
    with httpd:
        return _serve(httpd)


def _serve(httpd):
    port = httpd.server_port
    try:
        entry = load_map()
    except (OSError, ValueError, KeyError, TypeError, IndexError) as err:
        log(f"Could not load the startup map. Check data/maps or choose another JEV_FSD_BBOX ({type(err).__name__}).")
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
    except OSError as err:
        log(f"The listener stopped ({err.strerror or err}).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
