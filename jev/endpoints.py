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
from contextlib import contextmanager
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

from . import VERSION
from .client import tokens as tokens
from .client import JevError, SpendGuard, retry_delay
from .config import PROJECT_ROOT, Settings

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
PATH_RE = re.compile(r"^/[A-Za-z0-9._~/-]{0,200}$")
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_CONFIG_BYTES = 2 * 1024 * 1024
MAX_REQUEST_BYTES = 1024 * 1024
MAX_ERROR_BYTES = 4096
MAX_CONFIG_DEPTH = 64
MAX_TRACE_DEPTH = 64  # deeper replies are summarised in the trace instead of copied
MAX_REPORTED_COST_USD = 100.0  # a larger per-call cost is a broken usage block, not a real charge
MAX_PRICE_PER_MTOK = 1_000_000
MAX_SCRUB_DEPTH = 2 * MAX_TRACE_DEPTH  # scrub() summarises anything deeper; traces fit well inside it
CHECK_TTL_S = 15.0
CHECK_TIMEOUT_S = 3.0
USER_AGENT = "jev-fsd/%s" % VERSION
ANTHROPIC_VERSION = "2026-10-21"  # the `anthropic-version` header for Anthropic's API


class EndpointError(JevError):
    """A call that produced no usable reply. The server maps `status` like a JevError."""


# Transport


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib would forward the Authorization header to wherever a redirect points.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(
            req.full_url, code, "endpoint redirected; set base_url to the final URL", headers, fp
        )


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
        with self._lock:  # a timer already waiting for the lock then finds the watchdog finished
            if not self._finished:
                self.expired = self.expired or time.monotonic() >= self.deadline
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
            try:  # the plain socket call: an SSL socket's own shutdown is not safe from another thread
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
        try:  # creating the socket can fail too (no IPv6 here, say): move on to the next address
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
            sock.settimeout(timeout)  # later reads keep the per-operation timeout; the watchdog bounds the total
        return sock
    if time.monotonic() >= deadline or isinstance(error, TimeoutError):
        raise TimeoutError("deadline passed")
    if error is not None:
        raise error
    raise OSError("no usable addresses for %s" % address[0])


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


def headers_for(key: Optional[str], json_body: bool = False, api: str = "openai") -> Dict[str, str]:
    """Request headers. `api` "anthropic" sends the key as `x-api-key` with the API version Anthropic's
    Messages and Models APIs need; every other server takes it as a bearer token."""
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if key and (len(key) > 512 or any(not 33 <= ord(char) <= 126 for char in key)):
        raise ValueError("API key must contain only visible ASCII without spaces")
    if json_body:
        headers["Content-Type"] = "application/json"
    if api == "anthropic":
        headers["anthropic-version"] = ANTHROPIC_VERSION
        if key:
            headers["x-api-key"] = key
    elif key:
        headers["Authorization"] = "Bearer " + key
    return headers


def read_reply(resp, limit: int) -> bytes:
    """Check the wire length even when HTTPResponse.read(n) returns a short read without raising."""
    declared = getattr(resp, "length", None)
    if isinstance(declared, int) and declared > limit:
        raise ValueError("reply larger than %d bytes" % limit)
    raw = resp.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("reply larger than %d bytes" % limit)
    if isinstance(declared, int) and len(raw) != declared:
        raise ValueError("reply ended before its declared length")
    return raw


def read_error(err: urllib.error.HTTPError) -> str:
    try:
        return err.read(MAX_ERROR_BYTES).decode("utf-8", errors="replace") if err.fp else ""
    except (OSError, http.client.HTTPException):
        return ""
    finally:
        err.close()


def encode_request(payload: dict) -> bytes:
    try:
        return json.dumps(payload, allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, RecursionError) as err:
        raise ValueError("provider request must contain finite JSON values") from err


def post_json(
    url: str,
    payload: dict,
    key: Optional[str],
    deadline: float,
    api: str = "openai",
    max_bytes: int = MAX_REQUEST_BYTES,
) -> Tuple[Optional[dict], float]:
    """One POST that must finish by `deadline` (time.monotonic()): TCP connect, proxy tunnel, TLS
    handshake, headers and body. Raises TimeoutError past it; an HTTPError carries its (short)
    body as `body_text`. Returns (reply, latency_ms); the reply is None when it is nested too deeply
    to parse at all. Infinity, NaN and 1e400 become null, since the reply goes on to the browser."""
    data = encode_request(payload)
    if len(data) > max_bytes:
        raise ValueError("provider request is larger than %d bytes" % max_bytes)
    req = urllib.request.Request(url, data=data, method="POST", headers=headers_for(key, True, api))
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("deadline passed")
    req.watchdog = watchdog = _Watchdog(deadline)
    started = time.perf_counter()
    try:
        with _OPENER.open(req, timeout=remaining) as resp:
            raw = read_reply(resp, MAX_RESPONSE_BYTES)
            expired = watchdog.cancel()  # only a watchdog that fired before the read returned counts
    except urllib.error.HTTPError as err:
        err.body_text = read_error(err)  # the watchdog still guards the socket
        if watchdog.cancel():
            raise TimeoutError("deadline passed") from err
        raise
    except (OSError, http.client.HTTPException, ValueError):
        if watchdog.cancel():
            raise TimeoutError("deadline passed")
        raise
    finally:
        watchdog.cancel()
    if expired:  # the socket was shut mid-reply, so what arrived may be cut short
        raise TimeoutError("deadline passed")
    latency_ms = (time.perf_counter() - started) * 1000
    try:
        data = json.loads(
            raw.decode("utf-8-sig"), parse_constant=lambda _: None, parse_float=lambda s: finite(float(s))
        )
    except UnicodeDecodeError as err:
        raise ValueError("reply was not valid UTF-8") from err
    except RecursionError:  # a whole reply too deep for this Python's parser (3.11 stops near 1000 levels)
        return None, latency_ms
    except ValueError as err:
        if not raw.strip():
            raise ValueError("reply was not JSON (empty body)") from err
        excerpt = scrub(raw.decode("utf-8", errors="replace"), key)[:80].strip()
        raise ValueError("reply was not JSON (%s)" % excerpt) from err
    if not isinstance(data, dict):
        raise ValueError("reply was not a JSON object")
    return data, latency_ms


def error_body(err: urllib.error.HTTPError) -> Any:
    """The parsed JSON of an error reply read by post_json, its text, or the reason phrase."""
    body_text = getattr(err, "body_text", "")
    try:
        body: Any = json.loads(body_text, parse_constant=lambda _: None, parse_float=lambda s: finite(float(s)))
    except (ValueError, RecursionError):
        body = body_text or err.reason
    if deeper_than(body, MAX_TRACE_DEPTH):  # quoted as text, so nothing has to walk it
        body = body_text[:300]
    return body


# Configuration


def price(value: Any, field: str, problems: List[str], where: str) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool):
        problems.append("%s: %s must be a number" % (where, field))
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        problems.append("%s: %s must be a number" % (where, field))
        return None
    if not math.isfinite(number) or number < 0:
        problems.append("%s: %s must be a finite number, zero or more" % (where, field))
        return None
    if number > MAX_PRICE_PER_MTOK:
        problems.append("%s: %s must be at most %d USD per million tokens" % (where, field, MAX_PRICE_PER_MTOK))
        return None
    return number


def number(value: Any, integer: bool = False) -> Optional[float]:
    """A finite number from config, or None for null. Raises TypeError, ValueError or OverflowError otherwise."""
    if value is None:
        return None
    if isinstance(value, bool):
        raise TypeError("boolean is not a number")
    if integer and isinstance(value, (int, str)):
        try:
            return int(value)
        except ValueError:
            pass
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("not finite")
    if integer and not result.is_integer():
        raise ValueError("not an integer")
    return int(result) if integer else result


def bounded_integer(raw: dict, field: str, maximum: int, minimum: int = 1) -> Optional[int]:
    value = number(raw.get(field), integer=True)
    if value is not None and not minimum <= value <= maximum:
        raise ValueError("%s must be an integer between %d and %d" % (field, minimum, maximum))
    return value


def endpoint_limits(raw: dict) -> dict:
    limits = {}
    for field, maximum in (("max_parallel", 1024), ("max_request_bytes", MAX_REQUEST_BYTES)):
        try:
            limits[field] = bounded_integer(raw, field, maximum)
        except (ValueError, TypeError, OverflowError) as err:
            raise ValueError("%s must be an integer between 1 and %d, or null" % (field, maximum)) from err
    for field, maximum, default, minimum in (
        ("check_timeout_s", 30, CHECK_TIMEOUT_S, 0.1),
        ("check_ttl_s", 300, CHECK_TTL_S, 0),
        ("retry_after_max_s", 3600, 3600, 0),
    ):
        try:
            value = number(raw.get(field, default))
            if value is None or not minimum <= value <= maximum:
                raise ValueError()
        except (ValueError, TypeError, OverflowError) as err:
            raise ValueError("%s must be a number between %g and %g" % (field, minimum, maximum)) from err
        limits[field] = value
    return limits


def api_path(value: Any, default: str) -> Optional[str]:
    path = default if value is None else value
    if not isinstance(path, str) or not PATH_RE.fullmatch(path) or {".", ".."} & set(path.split("/")) or "//" in path:
        return None
    return path


def public_url(base_url: str) -> str:
    """The base URL without credentials, query or fragment: safe to show in the UI."""
    try:
        parts = urlsplit(base_url)
        port = parts.port
    except ValueError:
        return ""
    host = parts.hostname or ""
    if ":" in host:
        host = "[%s]" % host
    netloc = host + (":%d" % port if port is not None else "")
    return urlunsplit((parts.scheme, netloc, parts.path.rstrip("/"), "", ""))


def is_local_host(base_url: str) -> bool:
    try:
        host = (urlsplit(base_url).hostname or "").lower()
    except ValueError:
        return False
    host = host.rstrip(".")
    if host in ("localhost", "host.docker.internal") or host.endswith(".local"):
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return not (address.is_unspecified or address.is_multicast) and (
        address.is_loopback or address.is_private or address.is_link_local
    )


def check_common(raw: Any, where: str, problems: List[str], example_url: str, example_key: str) -> Optional[dict]:
    """The checks every endpoint entry passes: an object without a literal key, a valid name, an
    http(s) base_url without credentials or a bad port, a model, a variable name for the key, and
    https whenever a key would leave this machine. Returns {name, where, base_url, model, api_key_env}."""
    if not isinstance(raw, dict):
        problems.append("%s must be an object" % where)
        return None
    if "api_key" in raw:
        problems.append(
            "%s: do not put keys in the endpoints file. Put the key in .env and name its variable "
            'with "api_key_env"' % where
        )
        return None
    name = raw.get("name")
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        problems.append(
            "%s: name must be 1-32 lowercase letters, digits, '-' or '_' (got %r)" % (where, str(name)[:40])
        )
        return None
    where = "endpoint %r" % name
    raw_url = raw.get("base_url")
    base_url = raw_url.strip().rstrip("/") if isinstance(raw_url, str) else ""
    if len(base_url) > 500:
        problems.append("%s: base_url must be at most 500 characters" % where)
        return None
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in base_url) or "\\" in base_url:
        problems.append("%s: base_url contains an invalid character" % where)
        return None
    try:
        parts = urlsplit(base_url)
    except ValueError:
        problems.append("%s: base_url has an invalid host" % where)
        return None
    try:
        port = parts.port
    except ValueError:
        problems.append("%s: base_url has an invalid port" % where)
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname or any(ch.isspace() for ch in base_url):
        problems.append("%s: base_url must be an http(s) URL such as %s" % (where, example_url))
        return None
    if parts.username is not None or parts.password is not None:
        problems.append("%s: base_url must not contain credentials; use api_key_env" % where)
        return None
    if "?" in base_url or "#" in base_url:
        problems.append("%s: base_url must not contain a query or fragment" % where)
        return None
    if port == 0 or parts.netloc.endswith(":"):
        problems.append("%s: base_url has an invalid port" % where)
        return None
    raw_model = raw.get("model")
    model = raw_model.strip() if isinstance(raw_model, str) else ""
    if not model:
        problems.append("%s: model is required" % where)
        return None
    if len(model) > 200:
        problems.append("%s: model must be at most 200 characters" % where)
        return None
    if any(not ch.isprintable() for ch in model):
        problems.append("%s: model must contain printable text" % where)
        return None
    key_env = raw.get("api_key_env")
    if key_env is not None and (not isinstance(key_env, str) or not ENV_NAME_RE.fullmatch(key_env)):
        problems.append("%s: api_key_env must be an environment variable name such as %s" % (where, example_key))
        return None
    if key_env and parts.scheme == "http" and not is_local_host(base_url):
        problems.append(
            "%s: base_url must use https:// to send a key to %s; plain http is only for local servers"
            % (where, parts.hostname)
        )
        return None
    label = raw.get("label")
    if label is not None and (not isinstance(label, str) or not all(ch.isprintable() for ch in label)):
        problems.append("%s: label must be printable text" % where)
        return None
    return {
        "name": name,
        "where": where,
        "base_url": base_url,
        "model": model,
        "api_key_env": key_env,
        "label": (label or "").strip()[:60] or name,
    }


def read_config(path):
    with path.open("rb") as handle:
        raw = handle.read(MAX_CONFIG_BYTES + 1)
    if len(raw) > MAX_CONFIG_BYTES:
        raise ValueError("file is larger than %d bytes" % MAX_CONFIG_BYTES)
    data = json.loads(raw.decode("utf-8-sig"))
    if deeper_than(data, MAX_CONFIG_DEPTH):
        raise ValueError("is nested more than %d levels" % MAX_CONFIG_DEPTH)
    return data


def load_entries(path, problems: List[str]) -> List[Tuple[Any, str]]:
    """The raw entries of an endpoints file, each with where it came from. A missing file has none."""
    try:
        data = read_config(path)
    except FileNotFoundError:
        return []
    except (OSError, ValueError, RecursionError) as err:
        problems.append("%s could not be read: %s" % (path.name, err))
        return []
    items = data.get("endpoints") if isinstance(data, dict) else data
    if not isinstance(items, list):
        problems.append('%s must contain {"endpoints": [...]}' % path.name)
        return []
    return [(item, "%s entry %d" % (path.name, i + 1)) for i, item in enumerate(items)]


def unique(configs: list, problems: List[str]) -> list:
    out: list = []
    seen = set()
    for config in configs:
        if config.name in seen:
            problems.append("endpoint %r is defined twice; the first definition is used" % config.name)
            continue
        seen.add(config.name)
        out.append(config)
    return out


# Replies


def finite(value: float) -> Optional[float]:
    return value if math.isfinite(value) else None


def reported_cost(usage: dict) -> Optional[float]:
    """The call's cost as the provider billed it (`usage.cost`, which OpenRouter reports), or None.
    Prompt caching and provider pricing make it differ from tokens at list prices, in both directions."""
    reported = usage.get("cost")
    # (the range first: math.isfinite raises OverflowError on a huge JSON integer, and NaN fails it too)
    if (
        isinstance(reported, (int, float))
        and not isinstance(reported, bool)
        and 0 <= reported <= MAX_REPORTED_COST_USD
        and math.isfinite(reported)
    ):
        return float(reported)
    return None


def billed_cost(
    usage: dict, config, input_tokens: float, output_tokens: int, cached_tokens: int = 0
) -> Tuple[float, Optional[str]]:
    reported = reported_cost(usage)
    if reported is not None:
        return reported, "provider"
    cached_price = getattr(config, "price_cached", None)
    if not config.priced and cached_price is None:
        return 0.0, None
    cached_tokens = min(cached_tokens, input_tokens) if cached_price is not None else 0
    calculated = (
        (input_tokens - cached_tokens) * (config.price_in or 0)
        + cached_tokens * (cached_price or 0)
        + output_tokens * (config.price_out or 0)
    ) / 1_000_000
    if not math.isfinite(calculated):
        return 0.0, None
    return calculated, "price"


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
        self._key = settings.get(config.api_key_env) if config.api_key_env else None  # see api_key
        self.calls = 0
        self.errors = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.spent_usd = 0.0
        self.last_error: Optional[str] = None
        self._check: Optional[Tuple[float, dict]] = None
        self._probe_lock = threading.Lock()
        self._check_generation = 0
        self._in_flight = 0
        self._blocked_until = 0.0
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
            return {
                "calls": self.calls,
                "errors": self.errors,
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "spent_usd": self.spent_usd,
                "last_error": self.last_error,
            }

    def public(self) -> dict:
        """Everything the browser may know about this endpoint. Never the key or a credentialed URL."""
        c = self.config
        return scrub(
            {
                "name": c.name,
                "id": self.prefix + c.name,
                "label": c.label,
                "model": c.model,
                "endpoint": public_url(c.base_url),
                "local": is_local_host(c.base_url),
                "api_key_env": c.api_key_env,
                "key": self.key_state,
                "usable": self.key_state != "missing",
                "status": "no key" if self.key_state == "missing" else "configured",
                "priced": c.priced,
                "price_per_mtok_input": c.price_in,
                "price_per_mtok_output": c.price_out,
                "timeout_s": c.timeout_s,
                "rpm": c.rpm,
                **({"max_parallel": c.max_parallel} if getattr(c, "max_parallel", None) is not None else {}),
                **(
                    {"max_request_bytes": c.max_request_bytes}
                    if getattr(c, "max_request_bytes", None) is not None
                    else {}
                ),
                **(
                    {
                        field: getattr(c, field)
                        for field, default in (
                            ("check_timeout_s", CHECK_TIMEOUT_S),
                            ("check_ttl_s", CHECK_TTL_S),
                            ("retry_after_max_s", 3600),
                        )
                        if getattr(c, field, default) != default
                    }
                ),
                **self.stats(),
            },
            self.api_key,
        )

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

    @contextmanager
    def attempt(self):
        with self._lock:
            remaining = self._blocked_until - time.monotonic() if self._blocked_until else 0
            cap = getattr(self.config, "max_parallel", None)
            if remaining > 0:
                raise self.error_class(
                    "%s %r is rate limited. Try again in %d s." % (self.kind, self.config.name, math.ceil(remaining)),
                    status=429,
                )
            if cap is not None and self._in_flight >= cap:
                raise self.error_class(
                    "%s %r has %d requests in flight (max_parallel)." % (self.kind, self.config.name, cap),
                    status=429,
                )
            self._in_flight += 1
        try:
            self.limit()
            yield
        finally:
            with self._lock:
                self._in_flight -= 1

    def defer(self, err: urllib.error.HTTPError) -> None:
        delay = retry_delay(err.headers.get("Retry-After")) if err.headers else None
        if delay is not None and delay > 0 and self.config.retry_after_max_s:
            with self._lock:
                self._blocked_until = max(
                    self._blocked_until, time.monotonic() + min(delay, self.config.retry_after_max_s)
                )

    def check_request_size(self, payload: dict) -> None:
        cap = self.config.max_request_bytes
        if cap is not None and len(encode_request(payload)) > cap:
            raise ValueError("provider request is larger than max_request_bytes (%d)" % cap)

    def invalid(self, reason: str) -> None:
        self.fail(reason, 502)

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
        with self._probe_lock:
            return self._check_status(force)

    def invalidate_check(self) -> None:
        with self._lock:
            self._check_generation += 1
            self._check = None

    def _check_status(self, force: bool) -> dict:
        with self._lock:
            cached = self._check
            generation = self._check_generation
        if not force and cached and time.monotonic() - cached[0] < self.config.check_ttl_s:
            return cached[1].copy()
        name = self.config.name
        if self.key_state == "missing":
            out = {
                "name": name,
                "status": "no key",
                "reachable": None,
                "detail": "Paste a key in Connect a model, or set %s in .env." % self.config.api_key_env,
            }
        else:
            url = self.check_url()
            path = urlsplit(url).path
            limit = min(self.config.check_timeout_s, self.config.timeout_s)
            watchdog = None
            try:
                req = urllib.request.Request(
                    url, headers=headers_for(self.api_key, api=getattr(self.config, "api", "openai"))
                )
                req.watchdog = watchdog = _Watchdog(time.monotonic() + limit)
                with _OPENER.open(req, timeout=limit) as resp:
                    read_reply(resp, MAX_RESPONSE_BYTES)
                    late = watchdog.cancel()
                if late:
                    raise TimeoutError("no reply within %g s" % limit)
                out = {"name": name, "status": "ready", "reachable": True, "detail": "reachable"}
            except urllib.error.HTTPError as err:
                err.close()
                if err.code in (401, 403):
                    out = {
                        "name": name,
                        "status": "key rejected",
                        "reachable": True,
                        "detail": "HTTP %d from %s" % (err.code, path),
                    }
                elif 300 <= err.code < 400:  # calls refuse redirects too, so this endpoint cannot work
                    out = {"name": name, "status": "unreachable", "reachable": False, "detail": str(err.reason)[:200]}
                elif err.code in (404, 405):  # the server answered; some servers just do not offer this path
                    out = {
                        "name": name,
                        "status": "ready",
                        "reachable": True,
                        "detail": "HTTP %d from %s" % (err.code, path),
                    }
                elif err.code in (429, 529):
                    out = {
                        "name": name,
                        "status": "error",
                        "reachable": True,
                        "detail": "HTTP %d from %s; provider is rate limited or overloaded" % (err.code, path),
                    }
                else:
                    out = {
                        "name": name,
                        "status": "error",
                        "reachable": True,
                        "detail": "HTTP %d from %s" % (err.code, path),
                    }
            except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as err:
                reason = getattr(err, "reason", err)
                out = {
                    "name": name,
                    "status": "unreachable",
                    "reachable": False,
                    "detail": scrub(str(reason), self.api_key)[:200],
                }
            finally:
                if watchdog is not None and watchdog.cancel():
                    out = {
                        "name": name,
                        "status": "unreachable",
                        "reachable": False,
                        "detail": "no reply within %g s" % limit,
                    }
        out = scrub(out, self.api_key)
        with self._lock:
            if generation == self._check_generation:
                self._check = (time.monotonic(), out.copy())
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
        self._registry_lock = threading.Lock()
        configs, self.problems = self.load(settings)
        self.endpoints: Dict[str, Endpoint] = {c.name: self.endpoint_class(c, settings, guard) for c in configs}

    def load(self, settings: Settings):
        raise NotImplementedError

    def path(self, settings: Settings):
        raise NotImplementedError

    def reload(self) -> None:
        """Re-read .env and the endpoints file, e.g. after the setup dialog saved a model. An endpoint
        whose settings did not change keeps its object, so its call counts and spend carry over."""
        with self._registry_lock:
            self._reload()

    def _reload(self) -> None:
        self.settings.reload_file()
        configs, problems = self.load(self.settings)
        endpoints: Dict[str, Endpoint] = {}
        for c in configs:
            old = self.endpoints.get(c.name)
            key = self.settings.get(c.api_key_env) if c.api_key_env else None
            same = old is not None and vars(old.config) == vars(c) and old.api_key == key
            endpoints[c.name] = old if same else self.endpoint_class(c, self.settings, self.guard)
        for e in endpoints.values():
            e.invalidate_check()
        self.endpoints, self.problems = endpoints, problems

    def public(self) -> dict:
        path = self.path(self.settings)
        try:
            shown = str(path.relative_to(PROJECT_ROOT))
        except ValueError:
            shown = path.name
        with self._registry_lock:
            endpoints, problems = self.endpoints, self.problems
        return {
            "endpoints": [e.public() for e in endpoints.values()],
            "problems": list(problems),
            "config_file": shown,
        }

    def get(self, name: Any) -> Endpoint:
        endpoints = self.endpoints
        endpoint = endpoints.get(name) if isinstance(name, str) else None
        if endpoint is None:
            raise self.unknown_error(
                "unknown %s endpoint %r; configured: %s" % (self.kind, str(name)[:40], ", ".join(endpoints) or "none")
            )
        return endpoint

    def check_all(self, force: bool = False) -> List[dict]:
        endpoints = tuple(self.endpoints.values())
        if not endpoints:
            return []
        with ThreadPoolExecutor(max_workers=min(8, len(endpoints))) as pool:
            return list(pool.map(lambda e: e.check(force), endpoints))
