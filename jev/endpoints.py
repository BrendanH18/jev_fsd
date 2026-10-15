"""What every configured model endpoint shares, whether it is an LLM (jev/llm.py) or a decision model
(jev/decision.py): config checks, one HTTP transport, key handling, and the registry.

The transport is urllib with three guards a server that holds paid keys needs:
  * redirects are refused, because urllib would forward the Authorization header to wherever one points;
  * every request has one total deadline (a watchdog shuts the socket), because a socket timeout only
    bounds each read and a server that trickles its reply could otherwise hold a call indefinitely;
  * the key is scrubbed from everything sent back to the browser (`scrub`).

An endpoint reads its key once, when it is built: a key saved later reaches only the replacement endpoint
that `EndpointRegistry.reload()` builds, never a request still in flight to the old URL.
"""

from __future__ import annotations

import http.client
import ipaddress
import json
import math
import re
import socket
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

from .client import JevError, SpendGuard
from .config import PROJECT_ROOT, Settings

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_USAGE_TOKENS = 10 ** 9      # a larger token count is a broken usage block, not a real call
MAX_TRACE_DEPTH = 64            # deeper replies are summarised in the trace instead of copied
MAX_SCRUB_DEPTH = 2 * MAX_TRACE_DEPTH   # scrub() summarises anything deeper; traces fit well inside it
CHECK_TTL_S = 15.0
CHECK_TIMEOUT_S = 3.0
USER_AGENT = "jev-fsd/0.2.0"


class EndpointError(JevError):
    """A call that produced no usable reply. The server maps `status` like a JevError."""


# Transport


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib would forward the Authorization header to wherever a redirect points.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirected to %s; set base_url to the final URL" % newurl,
                                     headers, fp)


class _Watchdog:
    """Shuts a request's socket at its deadline. A socket timeout only bounds each read, so a server
    or proxy that trickles the tunnel reply, headers or body could otherwise hold a call far past
    `timeout_s`. DNS resolution happens before there is a socket, so only the resolver bounds that."""

    def __init__(self, deadline: float):
        self.deadline = deadline
        self.expired = False
        self._finished = False
        self._sock: Optional[socket.socket] = None
        self._lock = threading.Lock()
        self._timer = threading.Timer(max(0.0, deadline - time.monotonic()), self._expire)
        self._timer.daemon = True
        self._timer.start()

    def attach(self, sock: socket.socket) -> None:
        with self._lock:
            self._sock = sock
            if self.expired:
                self._shutdown()

    def cancel(self) -> bool:
        """Stops the watchdog for good. True if it had already fired."""
        self._timer.cancel()
        with self._lock:   # a timer already waiting for the lock then finds the watchdog finished
            self._finished = True
            return self.expired

    def _expire(self) -> None:
        with self._lock:
            if self._finished:
                return
            self.expired = True
            self._shutdown()

    def _shutdown(self) -> None:
        if self._sock is not None:
            try:   # the plain socket call: an SSL socket's own shutdown is not safe from another thread
                socket.socket.shutdown(self._sock, socket.SHUT_RDWR)
            except OSError:
                pass


class _WatchedContext:
    """An SSL context whose sockets reach the watchdog before the TLS handshake. Wrapping detaches
    the raw socket, so shutting that one down would no longer reach the connection."""

    def __init__(self, context, watchdog: _Watchdog):
        self._context = context
        self._watchdog = watchdog

    def __getattr__(self, name):
        return getattr(self._context, name)

    def wrap_socket(self, sock, **kwargs):
        tls = self._context.wrap_socket(sock, **dict(kwargs, do_handshake_on_connect=False))
        self._watchdog.attach(tls)
        try:
            tls.do_handshake()
        except BaseException:
            tls.close()
            raise
        return tls


def _resolve(host: str, port: int) -> list:
    return socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)


def _open_socket(family: int, kind: int, proto: int) -> socket.socket:
    return socket.socket(family, kind, proto)


def _connect_by(deadline: float, address: Tuple[str, int], timeout: Any, source_address: Any = None) -> socket.socket:
    """socket.create_connection, except that each resolved address gets only what is left of the
    deadline rather than the full timeout, so a host with several unreachable addresses cannot
    stretch the TCP connect past it."""
    error: Optional[OSError] = None
    for family, kind, proto, _, sockaddr in _resolve(*address):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        sock = None
        try:   # creating the socket can fail too (no IPv6 here, say): move on to the next address
            sock = _open_socket(family, kind, proto)
            sock.settimeout(remaining)
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
        except OSError as err:
            if sock is not None:
                sock.close()
            error = err
            continue
        if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
            sock.settimeout(timeout)   # later reads keep the per-operation timeout; the watchdog bounds the total
        return sock
    raise error if error is not None and not isinstance(error, TimeoutError) else TimeoutError("deadline passed")


class _WatchedHandler:
    """Hands each new connection's socket to the request's watchdog, when it has one, as soon as
    the TCP connection exists: before any proxy tunnel or TLS handshake."""

    def do_open(self, http_class, req, **kwargs):
        watchdog = getattr(req, "watchdog", None)
        if watchdog is None:
            return super().do_open(http_class, req, **kwargs)

        def connection(*args, **kw):
            conn = http_class(*args, **kw)
            def watched_create(address, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None):
                sock = _connect_by(watchdog.deadline, address, timeout, source_address)
                watchdog.attach(sock)
                return sock
            conn._create_connection = watched_create
            if getattr(conn, "_context", None) is not None:
                conn._context = _WatchedContext(conn._context, watchdog)
            return conn
        return super().do_open(connection, req, **kwargs)


class _HTTPHandler(_WatchedHandler, urllib.request.HTTPHandler):
    pass


class _HTTPSHandler(_WatchedHandler, urllib.request.HTTPSHandler):
    pass


_OPENER = urllib.request.build_opener(_NoRedirect, _HTTPHandler, _HTTPSHandler)


def headers_for(key: Optional[str], json_body: bool = False) -> Dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if json_body:
        headers["Content-Type"] = "application/json"
    if key:
        headers["Authorization"] = "Bearer " + key
    return headers


def post_json(url: str, payload: dict, key: Optional[str], deadline: float) -> Tuple[Optional[dict], float]:
    """One POST that must finish by `deadline` (time.monotonic()): TCP connect, proxy tunnel, TLS
    handshake, headers and body. Raises TimeoutError past it; an HTTPError carries its (short)
    body as `body_text`. Returns (reply, latency_ms); the reply is None when it is nested too deeply
    to parse at all. Infinity, NaN and 1e400 become null, since the reply goes on to the browser."""
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST", headers=headers_for(key, True))
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("deadline passed")
    req.watchdog = watchdog = _Watchdog(deadline)
    started = time.perf_counter()
    try:
        with _OPENER.open(req, timeout=remaining) as resp:
            raw = resp.read(MAX_RESPONSE_BYTES + 1)
            expired = watchdog.cancel()   # only a watchdog that fired before the read returned counts
    except urllib.error.HTTPError as err:
        try:   # read the error body while the watchdog still guards the socket
            err.body_text = err.read(4096).decode("utf-8", errors="replace") if err.fp else ""
        except (OSError, http.client.HTTPException):
            err.body_text = ""
        finally:
            err.close()
        if watchdog.cancel():
            raise TimeoutError("deadline passed") from err
        raise
    except (OSError, http.client.HTTPException, ValueError):
        if watchdog.cancel():
            raise TimeoutError("deadline passed")
        raise
    finally:
        watchdog.cancel()
    if expired:   # the socket was shut mid-reply, so what arrived may be cut short
        raise TimeoutError("deadline passed")
    latency_ms = (time.perf_counter() - started) * 1000
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("reply larger than %d bytes" % MAX_RESPONSE_BYTES)
    try:
        data = json.loads(raw.decode("utf-8", errors="replace"), parse_constant=lambda _: None,
                          parse_float=lambda s: finite(float(s)))
    except RecursionError:   # a whole reply too deep for this Python's parser (3.11 stops near 1000 levels)
        return None, latency_ms
    except ValueError:
        raise ValueError("reply was not JSON (%s)" % raw[:80].decode("utf-8", errors="replace").strip())
    if not isinstance(data, dict):
        raise ValueError("reply was not a JSON object")
    return data, latency_ms


def error_body(err: urllib.error.HTTPError) -> Any:
    """The parsed JSON of an error reply read by post_json, its text, or the reason phrase."""
    body_text = getattr(err, "body_text", "")
    try:
        body: Any = json.loads(body_text)
    except (ValueError, RecursionError):
        body = body_text or err.reason
    if deeper_than(body, MAX_TRACE_DEPTH):   # quoted as text, so nothing has to walk it
        body = body_text[:300]
    return body


# Configuration


def price(value: Any, field: str, problems: List[str], where: str) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        problems.append("%s: %s must be a number" % (where, field))
        return None
    if not math.isfinite(number) or number < 0:
        problems.append("%s: %s must be a finite number, zero or more" % (where, field))
        return None
    return number


def number(value: Any, integer: bool = False) -> Optional[float]:
    """A finite number from config, or None for null. Raises TypeError, ValueError or OverflowError otherwise."""
    if value is None:
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("not finite")
    return int(result) if integer else result


def public_url(base_url: str) -> str:
    """The base URL without credentials, query or fragment: safe to show in the UI."""
    parts = urlsplit(base_url)
    host = parts.hostname or ""
    if ":" in host:
        host = "[%s]" % host
    netloc = host + (":%d" % parts.port if parts.port else "")
    return urlunsplit((parts.scheme, netloc, parts.path.rstrip("/"), "", ""))


def is_local_host(base_url: str) -> bool:
    host = (urlsplit(base_url).hostname or "").lower()
    if host in ("localhost", "host.docker.internal") or host.endswith(".local"):
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or address.is_private or address.is_link_local


def check_common(raw: Any, where: str, problems: List[str], example_url: str, example_key: str) -> Optional[dict]:
    """The checks every endpoint entry passes: an object without a literal key, a valid name, an
    http(s) base_url without credentials or a bad port, a model, a variable name for the key, and
    https whenever a key would leave this machine. Returns {name, where, base_url, model, api_key_env}."""
    if not isinstance(raw, dict):
        problems.append("%s must be an object" % where)
        return None
    if "api_key" in raw:
        problems.append("%s: do not put keys in the endpoints file. Put the key in .env and name its variable "
                        "with \"api_key_env\"" % where)
        return None
    name = str(raw.get("name") or "")
    if not NAME_RE.match(name):
        problems.append("%s: name must be 1-32 lowercase letters, digits, '-' or '_' (got %r)" % (where, name[:40]))
        return None
    where = "endpoint %r" % name
    base_url = str(raw.get("base_url") or "").strip().rstrip("/")
    parts = urlsplit(base_url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        problems.append("%s: base_url must be an http(s) URL such as %s" % (where, example_url))
        return None
    if parts.username or parts.password:
        problems.append("%s: base_url must not contain credentials; use api_key_env" % where)
        return None
    try:
        parts.port
    except ValueError:
        problems.append("%s: base_url has an invalid port" % where)
        return None
    model = str(raw.get("model") or "").strip()
    if not model or len(model) > 200:
        problems.append("%s: model is required" % where)
        return None
    key_env = raw.get("api_key_env")
    if key_env is not None and (not isinstance(key_env, str) or not ENV_NAME_RE.match(key_env)):
        problems.append("%s: api_key_env must be an environment variable name such as %s" % (where, example_key))
        return None
    if key_env and parts.scheme == "http" and not is_local_host(base_url):
        problems.append("%s: base_url must use https:// to send a key to %s; plain http is only for local servers"
                        % (where, parts.hostname))
        return None
    return {"name": name, "where": where, "base_url": base_url, "model": model, "api_key_env": key_env}


def load_entries(path, problems: List[str]) -> List[Tuple[Any, str]]:
    """The raw entries of an endpoints file, each with where it came from. A missing file has none."""
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        return []
    except (OSError, ValueError) as err:
        problems.append("%s could not be read: %s" % (path.name, err))
        return []
    items = data.get("endpoints") if isinstance(data, dict) else data
    if not isinstance(items, list):
        problems.append("%s must contain {\"endpoints\": [...]}" % path.name)
        return []
    return [(item, "%s entry %d" % (path.name, i + 1)) for i, item in enumerate(items)]


def unique(configs: list, problems: List[str]) -> list:
    out: list = []
    for config in configs:
        if any(c.name == config.name for c in out):
            problems.append("endpoint %r is defined twice; the first definition is used" % config.name)
            continue
        out.append(config)
    return out


# Replies


def tokens(value: Any) -> int:
    """A token count from a usage block: 0 when missing, negative or not finite (JSON Infinity, NaN)."""
    try:
        return min(MAX_USAGE_TOKENS, max(0, int(value or 0)))
    except (TypeError, ValueError, OverflowError):
        return 0


def finite(value: float) -> Optional[float]:
    return value if math.isfinite(value) else None


def deeper_than(value: Any, limit: int) -> bool:
    """Is `value` nested more than `limit` levels? Iterative, so it is safe on any parsed JSON."""
    stack = [(value, 1)]
    while stack:
        item, depth = stack.pop()
        if isinstance(item, (dict, list)):
            if depth > limit:
                return True
            stack.extend((v, depth + 1) for v in (item.values() if isinstance(item, dict) else item))
    return False


def scrub(value: Any, secret: Optional[str], _depth: int = 0) -> Any:
    """A copy of `value` with every occurrence of the key replaced, for anything sent to the browser.
    Containers nested deeper than MAX_SCRUB_DEPTH become a note, so no reply can exhaust the stack."""
    if not secret:
        return value
    if isinstance(value, str):
        return value.replace(secret, "***")
    if isinstance(value, (dict, list)) and _depth >= MAX_SCRUB_DEPTH:
        return "(nested deeper than %d levels; not shown)" % MAX_SCRUB_DEPTH
    if isinstance(value, dict):
        return {scrub(k, secret): scrub(v, secret, _depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v, secret, _depth + 1) for v in value]
    return value


# Endpoints and the registry


class Endpoint:
    """One configured endpoint: its key (read once), call statistics, rate limit and status probe.
    Subclasses set `kind` (shown in messages) and `prefix` (the agent id prefix), and say where the
    free status probe goes (`check_url`)."""

    kind = "endpoint"
    prefix = ""

    def __init__(self, config, settings: Settings, guard: SpendGuard):
        self.config = config
        self.settings = settings
        self.guard = guard
        self._lock = threading.Lock()
        self._key = settings.get(config.api_key_env) if config.api_key_env else None   # see api_key
        self.calls = 0
        self.errors = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.spent_usd = 0.0
        self.last_error: Optional[str] = None
        self._check: Optional[Tuple[float, dict]] = None
        # Budget-free guard used only for this endpoint's own rate limit (see the config's rpm).
        self._rate = SpendGuard(budget_usd=0, rpm=config.rpm) if config.rpm is not None else None

    @property
    def api_key(self) -> Optional[str]:
        # Read once: this object's key belongs to this object's URL. A key saved later reaches only the
        # replacement endpoint that reload() builds, never a request (or retry) still in flight here.
        return self._key

    @property
    def key_state(self) -> str:
        if not self.config.api_key_env:
            return "not needed"
        return "set" if self.api_key else "missing"

    def stats(self) -> dict:
        with self._lock:
            return {"calls": self.calls, "errors": self.errors, "input_tokens": self.input_tokens,
                    "output_tokens": self.output_tokens, "spent_usd": self.spent_usd, "last_error": self.last_error}

    def public(self) -> dict:
        """Everything the browser may know about this endpoint. Never the key or a credentialed URL."""
        c = self.config
        return {
            "name": c.name, "id": self.prefix + c.name, "label": c.label, "model": c.model,
            "endpoint": public_url(c.base_url), "local": is_local_host(c.base_url),
            "api_key_env": c.api_key_env, "key": self.key_state, "usable": self.key_state != "missing",
            "status": "no key" if self.key_state == "missing" else "configured",
            "priced": c.priced, "price_per_mtok_input": c.price_in, "price_per_mtok_output": c.price_out,
            "timeout_s": c.timeout_s, "rpm": c.rpm, **self.stats(),
        }

    def fail(self, message: str, status: int, body: Any = None) -> EndpointError:
        """Count an error, remember it for the UI, and return it (scrubbed) to raise."""
        message = scrub("%s %r: %s" % (self.kind, self.config.name, message), self.api_key)
        with self._lock:
            self.errors += 1
            self.last_error = message
        return self.error_class(message, status=status, body=scrub(body, self.api_key))

    error_class = EndpointError

    def no_key(self) -> EndpointError:
        return self.fail("no API key. Paste one in Connect a model, or set %s in .env." % self.config.api_key_env, 401)

    def limit(self) -> None:
        """Before each attempt: the shared budget always, and the shared or this endpoint's own rate limit."""
        self.guard.check(rate=self._rate is None)
        if self._rate is not None:
            self._rate.check()

    def record(self, result) -> None:
        self.guard.record(result)
        with self._lock:
            self.calls += 1
            self.input_tokens += result.input_tokens
            self.output_tokens += result.output_tokens
            self.spent_usd += result.cost_usd

    def check_url(self) -> str:
        raise NotImplementedError

    def check(self, force: bool = False) -> dict:
        """Is the endpoint reachable, and is its key accepted? One GET that costs nothing. Cached briefly."""
        now = time.monotonic()
        if not force and self._check and now - self._check[0] < CHECK_TTL_S:
            return self._check[1]
        name = self.config.name
        if self.key_state == "missing":
            out = {"name": name, "status": "no key", "reachable": None,
                   "detail": "Paste a key in Connect a model, or set %s in .env." % self.config.api_key_env}
        else:
            url = self.check_url()
            path = urlsplit(url).path
            req = urllib.request.Request(url, headers=headers_for(self.api_key))
            limit = min(CHECK_TIMEOUT_S, self.config.timeout_s)
            req.watchdog = watchdog = _Watchdog(time.monotonic() + limit)   # a trickled reply cannot hold the probe
            try:
                with _OPENER.open(req, timeout=limit) as resp:
                    resp.read(MAX_RESPONSE_BYTES)
                out = {"name": name, "status": "ready", "reachable": True, "detail": "reachable"}
            except urllib.error.HTTPError as err:
                if err.code in (401, 403):
                    out = {"name": name, "status": "key rejected", "reachable": True, "detail": "HTTP %d from %s" % (err.code, path)}
                elif 300 <= err.code < 400:   # calls refuse redirects too, so this endpoint cannot work
                    out = {"name": name, "status": "unreachable", "reachable": False, "detail": str(err.reason)[:200]}
                else:  # the server answered; some servers just do not offer this path
                    out = {"name": name, "status": "ready", "reachable": True, "detail": "HTTP %d from %s" % (err.code, path)}
            except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as err:
                reason = getattr(err, "reason", err)
                out = {"name": name, "status": "unreachable", "reachable": False, "detail": str(reason)[:200]}
            finally:
                if watchdog.cancel():
                    out = {"name": name, "status": "unreachable", "reachable": False, "detail": "no reply within %g s" % limit}
        out = scrub(out, self.api_key)
        self._check = (now, out)
        return out


class InvalidEndpointRequest(ValueError):
    pass


class EndpointRegistry:
    """All configured endpoints of one kind for this server run. Subclasses set `endpoint_class`,
    `kind`, `unknown_error`, and implement `load(settings)` -> (configs, problems) and `path(settings)`."""

    endpoint_class = Endpoint
    kind = "endpoint"
    unknown_error = InvalidEndpointRequest

    def __init__(self, settings: Settings, guard: SpendGuard):
        self.settings = settings
        self.guard = guard
        configs, self.problems = self.load(settings)
        self.endpoints: Dict[str, Endpoint] = {c.name: self.endpoint_class(c, settings, guard) for c in configs}

    def load(self, settings: Settings):
        raise NotImplementedError

    def path(self, settings: Settings):
        raise NotImplementedError

    def reload(self) -> None:
        """Re-read .env and the endpoints file, e.g. after the setup dialog saved a model. An endpoint
        whose settings did not change keeps its object, so its call counts and spend carry over."""
        self.settings.reload_file()
        configs, problems = self.load(self.settings)
        endpoints: Dict[str, Endpoint] = {}
        for c in configs:
            old = self.endpoints.get(c.name)
            key = self.settings.get(c.api_key_env) if c.api_key_env else None
            same = old is not None and vars(old.config) == vars(c) and old.api_key == key
            endpoints[c.name] = old if same else self.endpoint_class(c, self.settings, self.guard)
        for e in endpoints.values():
            e._check = None   # a key may have changed in .env, so check reachability afresh
        self.endpoints, self.problems = endpoints, problems

    def public(self) -> dict:
        path = self.path(self.settings)
        try:
            shown = str(path.relative_to(PROJECT_ROOT))
        except ValueError:
            shown = path.name
        return {"endpoints": [e.public() for e in self.endpoints.values()], "problems": list(self.problems),
                "config_file": shown}

    def get(self, name: Any) -> Endpoint:
        endpoint = self.endpoints.get(name) if isinstance(name, str) else None
        if endpoint is None:
            raise self.unknown_error("unknown %s endpoint %r; configured: %s"
                                     % (self.kind, str(name)[:40], ", ".join(self.endpoints) or "none"))
        return endpoint

    def check_all(self, force: bool = False) -> List[dict]:
        if not self.endpoints:
            return []
        with ThreadPoolExecutor(max_workers=min(8, len(self.endpoints))) as pool:
            return list(pool.map(lambda e: e.check(force), self.endpoints.values()))
