"""Any OpenAI-compatible Chat Completions endpoint as a driver.

Each configured endpoint becomes an agent named `llm:<name>` in the simulator, the arena and the
bench. The browser builds the prompt (static/js/brain/llm-prompt.js) from the same decision state
Jev sees and posts it to /api/llm/decide with the endpoint's *name*. This module looks the name up
in server-side config, calls `POST {base_url}/chat/completions`, parses the reply leniently and
checks the chosen manoeuvre against the ids the browser offered. Only already-safe candidates are
offered, and the browser re-checks the answer with validAgentChoice before anything executes.

Configuration lives only on the server, so a page can never point the server at another URL or read
a key:

  data/llm-endpoints.json (gitignored; start from data/llm-endpoints.example.json)
      {"endpoints": [
        {"name": "gpt-4o-mini", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini",
         "api_key_env": "OPENAI_API_KEY", "price_per_mtok_input": 0.15, "price_per_mtok_output": 0.60},
        {"name": "ollama", "base_url": "http://localhost:11434/v1", "model": "llama3.2"}]}

  or one endpoint from the environment / .env:
      JEV_FSD_LLM_BASE_URL, JEV_FSD_LLM_MODEL, JEV_FSD_LLM_API_KEY (optional), JEV_FSD_LLM_NAME
      (default "default"), JEV_FSD_LLM_PRICE_INPUT_PER_MTOK, JEV_FSD_LLM_PRICE_OUTPUT_PER_MTOK

Keys are read from the environment or `.env` by variable name (`api_key_env`); the JSON file never
holds a key. Calls share Jev's SpendGuard (JEV_FSD_BUDGET_USD, JEV_FSD_RPM). Without prices an
endpoint reports tokens and an unknown ($0) cost, so the budget cannot stop it; the RPM cap still does,
unless the endpoint sets `rpm: 0`, which removes that too.

Standard library only (urllib), no SDK.
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
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

from .client import JevError, SpendGuard
from .config import PROJECT_ROOT, Settings

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
MOTIONS = ("drive", "stop", "reverse")
RESPONSE_FORMATS = ("json_schema", "json_object", "none")
RESERVED_BODY_KEYS = {"model", "messages", "stream", "response_format", "n"}

MAX_MESSAGES = 6
MAX_PROMPT_CHARS = 64 * 1024
MAX_CHOICES = 32
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_CONTENT_CHARS = 20_000
MAX_USAGE_TOKENS = 10 ** 9      # a larger token count is a broken usage block, not a real call
MAX_TRACE_DEPTH = 64            # deeper completions are summarised in the trace instead of copied
MAX_SCRUB_DEPTH = 2 * MAX_TRACE_DEPTH   # scrub() summarises anything deeper; traces fit well inside it
CHECK_TTL_S = 15.0
CHECK_TIMEOUT_S = 3.0
USER_AGENT = "jev-fsd/0.2.0 (llm)"


class LlmError(JevError):
    """An endpoint call that produced no usable reply. The server maps `status` like a JevError."""


class InvalidLlmRequest(ValueError):
    pass


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
        sock = _open_socket(family, kind, proto)
        try:
            sock.settimeout(remaining)
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
        except OSError as err:
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


# Configuration


def _price(value: Any, field: str, problems: List[str], where: str) -> Optional[float]:
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


def _number(value: Any, integer: bool = False) -> Optional[float]:
    """A finite number from config, or None for null. Raises TypeError, ValueError or OverflowError otherwise."""
    if value is None:
        return None
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("not finite")
    return int(number) if integer else number


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


class EndpointConfig:
    """One validated entry from the config file or the environment."""

    def __init__(self, raw: dict, where: str, problems: List[str]):
        self.ok = False
        if not isinstance(raw, dict):
            problems.append("%s must be an object" % where)
            return
        if "api_key" in raw:
            problems.append("%s: do not put keys in the endpoints file. Put the key in .env and name its variable "
                            "with \"api_key_env\"" % where)
            return
        name = str(raw.get("name") or "")
        if not NAME_RE.match(name):
            problems.append("%s: name must be 1-32 lowercase letters, digits, '-' or '_' (got %r)" % (where, name[:40]))
            return
        where = "endpoint %r" % name
        base_url = str(raw.get("base_url") or "").strip().rstrip("/")
        parts = urlsplit(base_url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            problems.append("%s: base_url must be an http(s) URL such as https://api.openai.com/v1" % where)
            return
        if parts.username or parts.password:
            problems.append("%s: base_url must not contain credentials; use api_key_env" % where)
            return
        try:
            parts.port
        except ValueError:
            problems.append("%s: base_url has an invalid port" % where)
            return
        model = str(raw.get("model") or "").strip()
        if not model or len(model) > 200:
            problems.append("%s: model is required" % where)
            return
        key_env = raw.get("api_key_env")
        if key_env is not None and (not isinstance(key_env, str) or not ENV_NAME_RE.match(key_env)):
            problems.append("%s: api_key_env must be an environment variable name such as OPENAI_API_KEY" % where)
            return
        if key_env and parts.scheme == "http" and not is_local_host(base_url):
            problems.append("%s: base_url must use https:// to send a key to %s; plain http is only for local servers"
                            % (where, parts.hostname))
            return
        response_format = str(raw.get("response_format") or "json_schema")
        if response_format not in RESPONSE_FORMATS:
            problems.append("%s: response_format must be one of %s" % (where, ", ".join(RESPONSE_FORMATS)))
            return
        extra = raw.get("extra_body") or {}
        if not isinstance(extra, dict) or RESERVED_BODY_KEYS & set(extra):
            problems.append("%s: extra_body must be an object without %s" % (where, ", ".join(sorted(RESERVED_BODY_KEYS))))
            return
        try:
            timeout_s = float(_number(raw.get("timeout_s", 10)))   # float(None) raises: timeout_s cannot be null
            max_tokens = _number(raw.get("max_tokens", 400), integer=True)
            temperature = _number(raw.get("temperature", 0))
            rpm = _number(raw.get("rpm"), integer=True)
            rpm = None if rpm is None else max(0, rpm)
        except (TypeError, ValueError, OverflowError):
            problems.append("%s: timeout_s, max_tokens, temperature and rpm must be finite numbers "
                            "(max_tokens, temperature and rpm may be null)" % where)
            return
        self.name = name
        self.label = str(raw.get("label") or name)[:60]
        self.base_url = base_url
        self.model = model
        self.api_key_env = key_env
        self.price_in = _price(raw.get("price_per_mtok_input"), "price_per_mtok_input", problems, where)
        self.price_out = _price(raw.get("price_per_mtok_output"), "price_per_mtok_output", problems, where)
        self.priced = self.price_in is not None or self.price_out is not None
        self.timeout_s = min(60.0, max(1.0, timeout_s))
        self.max_tokens = max_tokens if max_tokens is None else max(1, max_tokens)
        self.temperature = temperature
        # None: share JEV_FSD_RPM with Jev and the other endpoints. A number: this endpoint's own
        # per-minute cap instead (0 = none, for fast local servers in lockstep benchmarks).
        self.rpm = rpm
        self.response_format = response_format
        self.extra_body = extra
        self.ok = True


def load_configs(settings: Settings) -> Tuple[List[EndpointConfig], List[str]]:
    """Endpoints from the JSON file, then the single environment endpoint. Returns (configs, problems)."""
    problems: List[str] = []
    entries: List[Tuple[dict, str]] = []
    path: Path = settings.llm_endpoints_path
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        data = None
    except (OSError, ValueError) as err:
        problems.append("%s could not be read: %s" % (path.name, err))
        data = None
    if data is not None:
        items = data.get("endpoints") if isinstance(data, dict) else data
        if not isinstance(items, list):
            problems.append("%s must contain {\"endpoints\": [...]}" % path.name)
        else:
            entries += [(item, "%s entry %d" % (path.name, i + 1)) for i, item in enumerate(items)]
    if settings.get("JEV_FSD_LLM_BASE_URL"):
        env_entry: Dict[str, Any] = {
            "name": settings.get("JEV_FSD_LLM_NAME", "default"),
            "label": settings.get("JEV_FSD_LLM_LABEL"),
            "base_url": settings.get("JEV_FSD_LLM_BASE_URL"),
            "model": settings.get("JEV_FSD_LLM_MODEL"),
            "price_per_mtok_input": settings.get("JEV_FSD_LLM_PRICE_INPUT_PER_MTOK"),
            "price_per_mtok_output": settings.get("JEV_FSD_LLM_PRICE_OUTPUT_PER_MTOK"),
        }
        if settings.get("JEV_FSD_LLM_TIMEOUT_S"):
            env_entry["timeout_s"] = settings.get("JEV_FSD_LLM_TIMEOUT_S")
        if settings.get("JEV_FSD_LLM_API_KEY"):
            env_entry["api_key_env"] = "JEV_FSD_LLM_API_KEY"
        entries.append(({k: v for k, v in env_entry.items() if v is not None}, "JEV_FSD_LLM_* settings"))
    configs: List[EndpointConfig] = []
    for raw, where in entries:
        config = EndpointConfig(raw, where, problems)
        if not config.ok:
            continue
        if any(c.name == config.name for c in configs):
            problems.append("endpoint %r is defined twice; the first definition is used" % config.name)
            continue
        configs.append(config)
    return configs, problems


# Replies


class LlmResult:
    """One chat completion: the reply text plus everything the UI shows about the call.

    Never raises. Usage is read first, so tokens and cost are always recorded; a completion without
    a usable choice or message sets `malformed` and leaves `content` empty. `response` is None for a
    completion nested too deeply to parse at all: its tokens are unknown and count as 0."""

    def __init__(self, endpoint: "LlmEndpoint", request: dict, response: Optional[dict], latency_ms: float,
                 format_used: str):
        self.request = request
        unparsed = response is None
        response = {} if response is None else response
        usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
        self.input_tokens = _int(usage.get("prompt_tokens", usage.get("input_tokens")))
        self.output_tokens = _int(usage.get("completion_tokens", usage.get("output_tokens")))
        config = endpoint.config
        self.cost_usd = ((self.input_tokens * (config.price_in or 0) + self.output_tokens * (config.price_out or 0)) / 1_000_000
                         if config.priced else 0.0)
        # The trace copies the completion, so an absurdly nested one is summarised rather than walked.
        if unparsed:
            self.response = {"note": "completion nested too deeply to parse; not shown"}
        elif _deeper_than(response, MAX_TRACE_DEPTH):
            self.response = {"note": "completion nested deeper than %d levels; not shown" % MAX_TRACE_DEPTH,
                             "usage": {"prompt_tokens": self.input_tokens, "completion_tokens": self.output_tokens}}
        else:
            self.response = response
        self.latency_ms = latency_ms
        self.format_used = format_used
        self.endpoint = endpoint
        model = response.get("model")
        self.model = (model if isinstance(model, str) and model else str(request.get("model") or ""))[:200]
        self.malformed: Optional[str] = None
        try:
            if unparsed:
                raise ValueError("nested too deeply to parse")
            self.content, self.refusal = _message_text(response)
        except Exception as err:   # ValueError for a missing choice or message; RecursionError for absurd nesting
            self.content, self.refusal = "", ""
            self.malformed = str(err) if isinstance(err, ValueError) else type(err).__name__

    def meta(self) -> dict:
        config = self.endpoint.config
        return {
            "model": self.model, "endpoint": config.name, "latency_ms": round(self.latency_ms, 1),
            "input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
            "cost_usd": self.cost_usd, "cost_known": config.priced, "response_format": self.format_used,
            "backend": "openai-compatible (stdlib)", "live_call": True,
        }


def _int(value: Any) -> int:
    """A token count from a usage block: 0 when missing, negative or not finite (JSON Infinity, NaN)."""
    try:
        return min(MAX_USAGE_TOKENS, max(0, int(value or 0)))
    except (TypeError, ValueError, OverflowError):
        return 0


def _finite(number: float) -> Optional[float]:
    return number if math.isfinite(number) else None


def _deeper_than(value: Any, limit: int) -> bool:
    """Is `value` nested more than `limit` levels? Iterative, so it is safe on any parsed JSON."""
    stack = [(value, 1)]
    while stack:
        item, depth = stack.pop()
        if isinstance(item, (dict, list)):
            if depth > limit:
                return True
            stack.extend((v, depth + 1) for v in (item.values() if isinstance(item, dict) else item))
    return False


def _message_text(response: dict) -> Tuple[str, str]:
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError("no choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("no message")
    content = message.get("content")
    if isinstance(content, list):  # some servers return content parts
        content = "".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
    refusal = message.get("refusal")
    return (str(content) if content is not None else "")[:MAX_CONTENT_CHARS], (str(refusal) if refusal else "")


_THINK_BLOCK = re.compile(r"<think>.*?(</think>|$)", re.S | re.I)
_CANDIDATE_KEYS = ("candidate", "candidate_id", "manoeuvre", "maneuver", "choice", "id", "vector")
_ROUTE_KEYS = ("route", "route_id")


def extract_json(text: str) -> Optional[dict]:
    """The reply as a JSON object: the whole text, a fenced block, or the first object inside prose.
    A reply nested too deeply for the parser counts as no object."""
    text = _THINK_BLOCK.sub("", text or "").strip()
    if not text:
        return None
    try:
        whole = json.loads(text)
        if isinstance(whole, dict):
            return whole
    except ValueError:
        pass
    except RecursionError:
        return None
    decoder = json.JSONDecoder()
    start = text.find("{")
    while start != -1:
        try:
            value, _ = decoder.raw_decode(text, start)
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
        except RecursionError:
            return None
        start = text.find("{", start + 1)
    return None


def _quote(value: Any, limit: int) -> str:
    try:
        return json.dumps(value)[:limit]
    except (ValueError, RecursionError):
        return type(value).__name__


def _match(value: Any, allowed: List[str]) -> Optional[str]:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    text = str(value).strip().strip("`'\"")
    if text in allowed:
        return text
    lowered = {a.lower(): a for a in allowed}
    return lowered.get(text.lower())


def parse_answer(content: str, expect: dict) -> Tuple[Optional[dict], Optional[str]]:
    """(answer, None) when the reply names valid choices for every asked field, else (None, reason).

    Lenient about form (code fences, prose around the JSON, key spelling, case); strict about content:
    the motion and candidate must be among the offered values. A missing or unknown route is ignored
    because the car is already following the first route option."""
    obj = extract_json(content)
    if obj is None:
        return None, "empty reply" if not (content or "").strip() else "reply was not a JSON object"
    fields = {str(k).strip().lower(): v for k, v in obj.items()}
    answer: Dict[str, Any] = {}
    if expect.get("motion"):
        value = fields.get("motion")
        motion = _match(value, expect["motion"])
        if motion is None:
            return None, ("no motion in the reply" if value is None else
                          "motion %s is not one of %s" % (_quote(value, 40), "/".join(expect["motion"])))
        answer["motion"] = motion
    if expect.get("candidate"):
        value = next((fields[k] for k in _CANDIDATE_KEYS if k in fields), None)
        candidate = _match(value, expect["candidate"])
        if candidate is None:
            return None, ("no candidate in the reply" if value is None else
                          "candidate %s is not an eligible manoeuvre" % _quote(value, 60))
        answer["candidate"] = candidate
    if expect.get("route"):
        route = _match(next((fields[k] for k in _ROUTE_KEYS if k in fields), None), expect["route"])
        if route:
            answer["route"] = route
    if isinstance(fields.get("reason"), str):
        answer["reason"] = fields["reason"][:200]
    return answer, None


def response_format_for(kind: str, expect: dict) -> Optional[dict]:
    if kind == "json_object":
        return {"type": "json_object"}
    if kind != "json_schema":
        return None
    properties: Dict[str, Any] = {}
    for field in ("motion", "candidate", "route"):
        if expect.get(field):
            properties[field] = {"type": "string", "enum": list(expect[field])}
    return {"type": "json_schema", "json_schema": {"name": "driving_decision", "strict": True, "schema": {
        "type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}}}


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


def _error_text(body: Any) -> str:
    if isinstance(body, dict):
        err = body.get("error", body)
        if isinstance(err, dict):
            return str(err.get("message") or json.dumps(err))[:300]
        return str(err)[:300]
    return str(body)[:300]


# Endpoints


class LlmEndpoint:
    def __init__(self, config: EndpointConfig, settings: Settings, guard: SpendGuard):
        self.config = config
        self.settings = settings
        self.guard = guard
        self._lock = threading.Lock()
        self._format = config.response_format
        self.calls = 0
        self.errors = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.spent_usd = 0.0
        self.last_error: Optional[str] = None
        self._check: Optional[Tuple[float, dict]] = None
        # Budget-free guard used only for this endpoint's own rate limit (see EndpointConfig.rpm).
        self._rate = SpendGuard(budget_usd=0, rpm=config.rpm) if config.rpm is not None else None

    @property
    def api_key(self) -> Optional[str]:
        return self.settings.get(self.config.api_key_env) if self.config.api_key_env else None

    @property
    def key_state(self) -> str:
        if not self.config.api_key_env:
            return "not needed"
        return "set" if self.api_key else "missing"

    def public(self) -> dict:
        """Everything the browser may know about this endpoint. Never the key or a credentialed URL."""
        c = self.config
        with self._lock:
            stats = {"calls": self.calls, "errors": self.errors, "input_tokens": self.input_tokens,
                     "output_tokens": self.output_tokens, "spent_usd": self.spent_usd, "last_error": self.last_error}
        return {
            "name": c.name, "id": "llm:" + c.name, "label": c.label, "model": c.model,
            "endpoint": public_url(c.base_url), "local": is_local_host(c.base_url),
            "api_key_env": c.api_key_env, "key": self.key_state, "usable": self.key_state != "missing",
            "status": "no key" if self.key_state == "missing" else "configured",
            "priced": c.priced, "price_per_mtok_input": c.price_in, "price_per_mtok_output": c.price_out,
            "timeout_s": c.timeout_s, "rpm": c.rpm, "response_format": self._format, **stats,
        }

    def _fail(self, message: str, status: int, body: Any = None) -> LlmError:
        message = scrub("LLM endpoint %r: %s" % (self.config.name, message), self.api_key)
        with self._lock:
            self.errors += 1
            self.last_error = message
        return LlmError(message, status=status, body=scrub(body, self.api_key))

    def _post(self, payload: dict, deadline: float) -> Tuple[Optional[dict], float]:
        """One POST that must finish by `deadline` (time.monotonic()): TCP connect, proxy tunnel, TLS
        handshake, headers and body. Raises TimeoutError past it; an HTTPError carries its (short)
        body as `body_text`. Returns None for a whole reply nested too deeply to parse."""
        headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": USER_AGENT}
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        req = urllib.request.Request(self.config.base_url + "/chat/completions", data=json.dumps(payload).encode(),
                                     method="POST", headers=headers)
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
        try:   # Infinity, NaN and 1e400 become null: the trace goes to the browser, whose JSON has no such values
            data = json.loads(raw.decode("utf-8", errors="replace"), parse_constant=lambda _: None,
                              parse_float=lambda s: _finite(float(s)))
        except RecursionError:   # a whole reply too deep for this Python's parser (3.11 stops near 1000 levels)
            return None, latency_ms
        except ValueError:
            raise ValueError("reply was not JSON (%s)" % raw[:80].decode("utf-8", errors="replace").strip())
        if not isinstance(data, dict):
            raise ValueError("reply was not a JSON object")
        return data, latency_ms

    def chat(self, messages: List[dict], expect: dict) -> LlmResult:
        """One decision call. `timeout_s` is a single deadline for every attempt, including the plain
        retry after a rejected response_format, and each attempt passes the budget and rate limit."""
        if self.key_state == "missing":
            raise self._fail("no API key. Set %s in .env (or the environment) and restart the server."
                             % self.config.api_key_env, 401)
        deadline = time.monotonic() + self.config.timeout_s
        fmt = self._format
        downgraded_from: Optional[str] = None
        while True:
            self.guard.check(rate=self._rate is None)   # the budget is always shared
            if self._rate is not None:
                self._rate.check()
            payload: Dict[str, Any] = {"model": self.config.model, "messages": messages}
            if self.config.temperature is not None:
                payload["temperature"] = self.config.temperature
            if self.config.max_tokens is not None:
                payload["max_tokens"] = self.config.max_tokens
            response_format = response_format_for(fmt, expect)
            if response_format:
                payload["response_format"] = response_format
            payload.update(self.config.extra_body)
            attempt_started = time.monotonic()
            try:
                response, latency_ms = self._post(payload, deadline)
                break
            except urllib.error.HTTPError as err:
                body_text = getattr(err, "body_text", "")
                try:
                    body: Any = json.loads(body_text)
                except (ValueError, RecursionError):
                    body = body_text or err.reason
                if _deeper_than(body, MAX_TRACE_DEPTH):   # quoted as text, so nothing has to walk it
                    body = body_text[:300]
                # Not every server supports structured output. Remember plain mode at once, and retry
                # this decision only if the rest of the deadline comfortably fits another attempt.
                if err.code in (400, 422) and fmt != "none":
                    rejected, fmt = fmt, "none"
                    downgraded_from = rejected
                    with self._lock:
                        self._format = "none"
                    now = time.monotonic()
                    if deadline - now > 1.5 * (now - attempt_started):
                        continue
                    raise self._fail("the endpoint rejected response_format %s (HTTP %d: %s); later calls use plain "
                                     "mode, but too little of timeout_s was left to retry this one"
                                     % (rejected, err.code, _error_text(body)), 502, body)
                if err.code in (400, 422) and downgraded_from:
                    # The plain retry was refused too, so the request itself is wrong (a bad model name,
                    # say), not its response_format: keep the format this endpoint had.
                    with self._lock:
                        self._format = downgraded_from
                if 300 <= err.code < 400:
                    raise self._fail(str(err.reason), 502)
                if err.code in (401, 403):
                    raise self._fail("the endpoint rejected the API key (%d): %s" % (err.code, _error_text(body)), err.code, body)
                if err.code == 429:
                    raise self._fail("rate limited by the endpoint (429): %s" % _error_text(body), 429, body)
                raise self._fail("HTTP %d: %s" % (err.code, _error_text(body)), 502, body)
            except (socket.timeout, TimeoutError):
                raise self._fail("no reply within %g s (timeout_s)" % self.config.timeout_s, 504)
            except urllib.error.URLError as err:
                if isinstance(err.reason, (socket.timeout, TimeoutError)):
                    raise self._fail("no reply within %g s (timeout_s)" % self.config.timeout_s, 504)
                raise self._fail("could not reach %s: %s" % (public_url(self.config.base_url), err.reason), 502)
            except (ValueError, OSError, http.client.HTTPException) as err:
                raise self._fail(str(err) or type(err).__name__, 502)
        # The call happened, so its usage is recorded whatever the reply holds. A completion without a
        # usable message, or one too deep to parse, comes back as `malformed`: an invalid answer, not an error.
        result = LlmResult(self, payload, response, latency_ms, fmt)
        self.guard.record(result)
        with self._lock:
            self.calls += 1
            self.input_tokens += result.input_tokens
            self.output_tokens += result.output_tokens
            self.spent_usd += result.cost_usd
            if result.malformed:
                self.errors += 1
                self.last_error = scrub("LLM endpoint %r: malformed completion (%s)" % (self.config.name, result.malformed),
                                       self.api_key)
        return result

    def check(self, force: bool = False) -> dict:
        """Is the endpoint reachable? GET {base_url}/models, which costs nothing. Cached briefly."""
        now = time.monotonic()
        if not force and self._check and now - self._check[0] < CHECK_TTL_S:
            return self._check[1]
        name = self.config.name
        if self.key_state == "missing":
            out = {"name": name, "status": "no key", "reachable": None,
                   "detail": "Set %s in .env and restart the server." % self.config.api_key_env}
        else:
            headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
            if self.api_key:
                headers["Authorization"] = "Bearer " + self.api_key
            req = urllib.request.Request(self.config.base_url + "/models", headers=headers)
            try:
                with _OPENER.open(req, timeout=min(CHECK_TIMEOUT_S, self.config.timeout_s)) as resp:
                    resp.read(MAX_RESPONSE_BYTES)
                out = {"name": name, "status": "ready", "reachable": True, "detail": "reachable"}
            except urllib.error.HTTPError as err:
                if err.code in (401, 403):
                    out = {"name": name, "status": "key rejected", "reachable": True, "detail": "HTTP %d from /models" % err.code}
                elif 300 <= err.code < 400:   # chat calls refuse redirects too, so this endpoint cannot work
                    out = {"name": name, "status": "unreachable", "reachable": False, "detail": str(err.reason)[:200]}
                else:  # the server answered; some servers just do not list models
                    out = {"name": name, "status": "ready", "reachable": True, "detail": "HTTP %d from /models" % err.code}
            except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as err:
                reason = getattr(err, "reason", err)
                out = {"name": name, "status": "unreachable", "reachable": False, "detail": str(reason)[:200]}
        out = scrub(out, self.api_key)
        self._check = (now, out)
        return out


class LlmRegistry:
    """All configured endpoints for this server run."""

    def __init__(self, settings: Settings, guard: SpendGuard):
        self.settings = settings
        self.guard = guard
        configs, self.problems = load_configs(settings)
        self.endpoints: Dict[str, LlmEndpoint] = {c.name: LlmEndpoint(c, settings, guard) for c in configs}

    def public(self) -> dict:
        path = self.settings.llm_endpoints_path
        try:
            shown = str(path.relative_to(PROJECT_ROOT))
        except ValueError:
            shown = path.name
        return {"endpoints": [e.public() for e in self.endpoints.values()], "problems": list(self.problems),
                "config_file": shown}

    def get(self, name: Any) -> LlmEndpoint:
        endpoint = self.endpoints.get(name) if isinstance(name, str) else None
        if endpoint is None:
            raise InvalidLlmRequest("unknown LLM endpoint %r; configured: %s"
                                    % (str(name)[:40], ", ".join(self.endpoints) or "none"))
        return endpoint

    def check_all(self, force: bool = False) -> List[dict]:
        if not self.endpoints:
            return []
        with ThreadPoolExecutor(max_workers=min(8, len(self.endpoints))) as pool:
            return list(pool.map(lambda e: e.check(force), self.endpoints.values()))


# The /api/llm/decide handler


def validate_request(body: dict) -> dict:
    messages = body.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= MAX_MESSAGES:
        raise InvalidLlmRequest("messages must be a list of 1-%d chat messages" % MAX_MESSAGES)
    total = 0
    clean = []
    for m in messages:
        if not isinstance(m, dict) or m.get("role") not in ("system", "user", "assistant") or not isinstance(m.get("content"), str):
            raise InvalidLlmRequest("each message needs a role (system, user or assistant) and string content")
        total += len(m["content"])
        clean.append({"role": m["role"], "content": m["content"]})
    if total > MAX_PROMPT_CHARS:
        raise InvalidLlmRequest("prompt is longer than %d characters" % MAX_PROMPT_CHARS)
    expect_in = body.get("expect")
    if not isinstance(expect_in, dict):
        raise InvalidLlmRequest("expect must say which choices the model may make")
    expect: Dict[str, List[str]] = {}
    for field in ("motion", "candidate", "route"):
        values = expect_in.get(field)
        if values is None:
            continue
        if (not isinstance(values, list) or not 1 <= len(values) <= MAX_CHOICES
                or not all(isinstance(v, str) and ID_RE.match(v) for v in values)):
            raise InvalidLlmRequest("expect.%s must be a list of 1-%d short ids" % (field, MAX_CHOICES))
        if field == "motion" and not set(values) <= set(MOTIONS):
            raise InvalidLlmRequest("expect.motion may only contain %s" % ", ".join(MOTIONS))
        expect[field] = values
    if not expect:
        raise InvalidLlmRequest("expect needs at least one of motion, candidate or route")
    tick, epoch = body.get("tick", 0), body.get("epoch", 0)
    if not isinstance(tick, int) or not isinstance(epoch, int):
        raise InvalidLlmRequest("tick and epoch must be integers")
    return {"endpoint": body.get("endpoint"), "messages": clean, "expect": expect, "tick": tick, "epoch": epoch}


def llm_decide(registry: LlmRegistry, body: dict) -> dict:
    req = validate_request(body)
    endpoint = registry.get(req["endpoint"])
    result = endpoint.chat(req["messages"], req["expect"])
    # Any reply the server cannot interpret is an invalid answer with the call's meta, so the browser
    # falls back to Rules and still counts the call, its tokens and its cost.
    try:
        if result.malformed:
            answer, invalid = None, "malformed completion (%s)" % result.malformed
        elif result.refusal and not result.content:
            answer, invalid = None, "the model refused: %s" % result.refusal[:160]
        else:
            answer, invalid = parse_answer(result.content, req["expect"])
    except Exception as err:   # e.g. RecursionError from an absurdly nested reply
        answer, invalid = None, "could not read the reply (%s)" % type(err).__name__
    meta = dict(result.meta(), source="llm:" + endpoint.config.name)
    if invalid:
        meta["invalid"] = invalid
    request = dict(result.request, url=public_url(endpoint.config.base_url) + "/chat/completions",
                   api_key_env=endpoint.config.api_key_env)
    trace = {"request": request, "response": result.response, "meta": meta}
    # Scrub everything: the answer, reason and invalid excerpt all quote the model's reply.
    return scrub({"tick": req["tick"], "epoch": req["epoch"], "answer": answer, "invalid": invalid,
                  "content": result.content, "meta": meta, "trace": trace}, endpoint.api_key)
