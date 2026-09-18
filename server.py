#!/usr/bin/env python3
"""Jev FSD: local server for the driving sim.

    uv run server.py        # or: python3 server.py
    open http://127.0.0.1:8322

Serves the static app, the map pack, routing, and the Jev decision proxy. The TypeSafe API key
stays on this server; every request is checked by jev/security.py so other websites cannot drive
this server or spend your credits.
"""

from __future__ import annotations

import json
import mimetypes
import os
import secrets
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from jev import decide, security
from jev.client import PRICE_PER_INPUT_TOKEN_USD, JevClient, JevError
from jev.config import MAPS_DIR, PROJECT_ROOT, SNAPSHOTS_DIR, Settings, parse_bbox
from jev.osm import fetch
from jev.osm.pack import build_pack, synthetic_pack
from jev.routing import Router

VERSION = "0.1.0"
STATIC = PROJECT_ROOT / "static"
PAGES = {"/": "index.html", "/tests": "tests/run.html"}
MAX_BODY_BYTES = 1024 * 1024

settings = Settings()
client = JevClient(settings)
SESSION_TOKEN = security.new_token()
_maps: dict = {}   # bbox key -> {"pack", "router", "error"}


class BadRequest(Exception):
    pass


def log(msg: str) -> None:
    sys.stderr.write("  %s  %s\n" % (time.strftime("%H:%M:%S"), msg))


# --- maps ------------------------------------------------------------------------------------


def load_map(bbox_text: str = "") -> dict:
    bbox = parse_bbox(bbox_text) or settings.bbox
    key = "%.5f,%.5f,%.5f,%.5f" % bbox
    entry = _maps.get(key)
    if entry:
        return entry
    entry = {"bbox": bbox, "pack": None, "router": None, "error": None}
    try:
        entry["pack"] = build_pack(bbox, MAPS_DIR, log=log)
    except fetch.FetchError as err:
        log("map: %s; using the synthetic grid" % err)
        entry["error"] = str(err)
        entry["pack"] = synthetic_pack()
    entry["router"] = Router(entry["pack"])
    _maps[key] = entry
    return entry


def api_status(_body, _query):
    entry = load_map()
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
        "map": {"bbox": list(entry["bbox"]), "name": pack.get("name"), "synthetic": bool(pack.get("synthetic")),
                "error": entry["error"], "stats": pack.get("stats", {})},
    }


def api_map(_body, query):
    entry = load_map((query.get("bbox") or [""])[0])
    return entry["pack"]


def api_route(body, _query):
    entry = load_map(str(body.get("bbox") or ""))
    start, goal = body.get("from") or {}, body.get("to") or {}
    try:
        start = {"x": float(start["x"]), "y": float(start["y"]),
                 "heading": float(start["heading"]) if start.get("heading") is not None else None}
        goal = {"x": float(goal["x"]), "y": float(goal["y"])}
    except (KeyError, TypeError, ValueError):
        raise BadRequest("from {x, y, heading?} and to {x, y} are required")
    k = max(1, min(int(body.get("k") or 1), 3))
    started = time.perf_counter()
    routes = entry["router"].routes(start, goal, k=k)
    return {"routes": routes, "compute_ms": round((time.perf_counter() - started) * 1000, 1)}


# --- decisions -------------------------------------------------------------------------------


def api_decide(body, _query):
    try:
        return decide.jev_decide(client, body)
    except decide.InvalidRequest as err:
        raise BadRequest(str(err))


def api_snapshot_save(body, _query):
    name = str(body.get("name") or "snapshot")
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "-_")[:60] or "snapshot"
    try:
        req = decide.validate_request(body)
    except decide.InvalidRequest as err:
        raise BadRequest(str(err))
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    path = SNAPSHOTS_DIR / ("%s.json" % safe)
    if path.exists():
        path = SNAPSHOTS_DIR / ("%s-%s.json" % (safe, secrets.token_hex(2)))
    payload = {"name": safe, "state": req["state"], "questions": req["questions"], "expect": body.get("expect") or {},
               "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    path.write_text(json.dumps(payload, indent=2))
    return {"saved": str(path.relative_to(PROJECT_ROOT))}


ROUTES = {
    ("GET", "/api/status"): api_status,
    ("GET", "/api/map"): api_map,
    ("POST", "/api/route"): api_route,
    ("POST", "/api/decide"): api_decide,
    ("POST", "/api/snapshot/save"): api_snapshot_save,
}

CSP = ("default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'nonce-%s'; "
       "connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; "
       "style-src 'self' 'unsafe-inline'; font-src 'self'; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


class Handler(BaseHTTPRequestHandler):
    server_version = "JevFSD/" + VERSION
    port = 8322

    def log_message(self, fmt, *args):
        if os.environ.get("JEV_FSD_QUIET") or "/api/decide" in str(args[0]):
            return
        log(fmt % args)

    def _send(self, status, payload, content_type="application/json", nonce=""):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
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
        length = int(self.headers.get("Content-Length") or 0)
        reason = security.check_request(method, self.headers, SESSION_TOKEN, self.port, has_body=length > 0)
        if reason:
            return self._send(403, {"error": security.REASONS[reason], "reason": reason})
        route = ROUTES.get((method, path))
        if route:
            try:
                if length > MAX_BODY_BYTES:
                    raise BadRequest("Request body too large")
                body = json.loads(self.rfile.read(length).decode() or "{}") if length else {}
                if not isinstance(body, dict):
                    raise BadRequest("Body must be a JSON object")
                self._send(200, route(body, query))
            except BadRequest as err:
                self._send(400, {"error": str(err)})
            except JevError as err:
                status = err.status if err.status in (401, 402, 403, 422, 429) else 502
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
        file = (STATIC / path.lstrip("/")).resolve()
        if not str(file).startswith(str(STATIC)) or not file.is_file():
            return self._send(404, {"error": "Not found"})
        ctype = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, file.read_bytes(), ctype)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def main():
    port = settings.port
    Handler.port = port
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as err:
        print("Could not listen on 127.0.0.1:%d (%s). Set PORT=<other port> and try again." % (port, err))
        return 1
    key_note = ("API key from %s" % client.key_source) if client.configured else "no API key: add TYPESAFE_API_KEY to .env"
    print("\n  Jev FSD %s  ->  http://127.0.0.1:%d" % (VERSION, port))
    print("  model %s via %s . %s" % (client.model, client.backend, key_note))
    print("  spend guard $%.2f per run (JEV_FSD_BUDGET_USD) . map bbox %s" % (client.guard.budget_usd, ",".join(str(v) for v in settings.bbox)))
    entry = load_map()
    print("  map: %d edges, %d signals, %d stops, %d buildings%s\n" % (
        len(entry["pack"]["edges"]), len(entry["pack"]["intersections"]), len(entry["pack"]["stops"]),
        len(entry["pack"]["buildings"]), " (SYNTHETIC fallback: %s)" % entry["error"] if entry["error"] else ""))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  bye")
    return 0


if __name__ == "__main__":
    sys.exit(main())
