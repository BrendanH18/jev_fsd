"""Any OpenAI-compatible Chat Completions endpoint as a driver.

Each configured endpoint becomes an agent named `llm:<name>` in the simulator, the arena and the
bench. The browser builds the prompt (static/js/brain/llm-prompt.js) from the same decision state
Jev sees and posts it to /api/llm/decide with the endpoint's *name*. This module looks the name up
in server-side config, calls `POST {base_url}/chat/completions`, parses the reply leniently and
checks the chosen manoeuvre against the ids the browser offered. Only already-safe candidates are
offered, and the browser re-checks the answer with validAgentChoice before anything executes.

Configuration lives only on the server, so a page can never read a key, and decisions name an endpoint,
never a URL. Endpoints change only by editing these files or through the token-protected setup API
(jev/llm_setup.py), which never sends a saved key to a URL other than the one it was saved for:

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
import json
import re
import socket
import time
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .config import Settings
from .endpoints import (MAX_SCRUB_DEPTH, MAX_TRACE_DEPTH, Endpoint, EndpointError, EndpointRegistry,  # noqa: F401
                        check_common, deeper_than, error_body, load_entries, number, post_json, price, public_url,
                        scrub, tokens, unique)

ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
MOTIONS = ("drive", "stop", "reverse")
RESPONSE_FORMATS = ("json_schema", "json_object", "none")
RESERVED_BODY_KEYS = {"model", "messages", "stream", "response_format", "n"}

MAX_MESSAGES = 6
MAX_PROMPT_CHARS = 64 * 1024
MAX_CHOICES = 32
MAX_CONTENT_CHARS = 20_000


class LlmError(EndpointError):
    """An endpoint call that produced no usable reply. The server maps `status` like a JevError."""


class InvalidLlmRequest(ValueError):
    pass


# Configuration


class EndpointConfig:
    """One validated entry from the config file or the environment."""

    def __init__(self, raw: dict, where: str, problems: List[str]):
        self.ok = False
        common = check_common(raw, where, problems, "https://api.openai.com/v1", "OPENAI_API_KEY")
        if common is None:
            return
        name, where, base_url, model, key_env = (common[k] for k in ("name", "where", "base_url", "model", "api_key_env"))
        response_format = str(raw.get("response_format") or "json_schema")
        if response_format not in RESPONSE_FORMATS:
            problems.append("%s: response_format must be one of %s" % (where, ", ".join(RESPONSE_FORMATS)))
            return
        extra = raw.get("extra_body") or {}
        if not isinstance(extra, dict) or RESERVED_BODY_KEYS & set(extra):
            problems.append("%s: extra_body must be an object without %s" % (where, ", ".join(sorted(RESERVED_BODY_KEYS))))
            return
        try:
            timeout_s = float(number(raw.get("timeout_s", 10)))   # float(None) raises: timeout_s cannot be null
            max_tokens = number(raw.get("max_tokens", 400), integer=True)
            temperature = number(raw.get("temperature", 0))
            rpm = number(raw.get("rpm"), integer=True)
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
        self.price_in = price(raw.get("price_per_mtok_input"), "price_per_mtok_input", problems, where)
        self.price_out = price(raw.get("price_per_mtok_output"), "price_per_mtok_output", problems, where)
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
    entries = load_entries(settings.llm_endpoints_path, problems)
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
    configs = [c for c in (EndpointConfig(raw, where, problems) for raw, where in entries) if c.ok]
    return unique(configs, problems), problems


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
        self.input_tokens = tokens(usage.get("prompt_tokens", usage.get("input_tokens")))
        self.output_tokens = tokens(usage.get("completion_tokens", usage.get("output_tokens")))
        config = endpoint.config
        self.cost_usd = ((self.input_tokens * (config.price_in or 0) + self.output_tokens * (config.price_out or 0)) / 1_000_000
                         if config.priced else 0.0)
        # The trace copies the completion, so an absurdly nested one is summarised rather than walked.
        if unparsed:
            self.response = {"note": "completion nested too deeply to parse; not shown"}
        elif deeper_than(response, MAX_TRACE_DEPTH):
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


def _error_text(body: Any) -> str:
    if isinstance(body, dict):
        err = body.get("error", body)
        if isinstance(err, dict):
            return str(err.get("message") or json.dumps(err))[:300]
        return str(err)[:300]
    return str(body)[:300]


# Endpoints


class LlmEndpoint(Endpoint):
    kind = "LLM endpoint"
    prefix = "llm:"
    error_class = LlmError

    def __init__(self, config: EndpointConfig, settings: Settings, guard):
        super().__init__(config, settings, guard)
        self._format = config.response_format

    def public(self) -> dict:
        return {**super().public(), "response_format": self._format}

    def check_url(self) -> str:
        return self.config.base_url + "/models"

    def chat(self, messages: List[dict], expect: dict) -> LlmResult:
        """One decision call. `timeout_s` is a single deadline for every attempt, including the plain
        retry after a rejected response_format, and each attempt passes the budget and rate limit."""
        if self.key_state == "missing":
            raise self.no_key()
        deadline = time.monotonic() + self.config.timeout_s
        fmt = self._format
        downgraded_from: Optional[str] = None
        while True:
            self.limit()
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
                response, latency_ms = post_json(self.config.base_url + "/chat/completions", payload, self.api_key, deadline)
                break
            except urllib.error.HTTPError as err:
                body = error_body(err)
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
                    raise self.fail("the endpoint rejected response_format %s (HTTP %d: %s); later calls use plain "
                                    "mode, but too little of timeout_s was left to retry this one"
                                    % (rejected, err.code, _error_text(body)), 502, body)
                if err.code in (400, 422) and downgraded_from:
                    # The plain retry was refused too, so the request itself is wrong (a bad model name,
                    # say), not its response_format: keep the format this endpoint had.
                    with self._lock:
                        self._format = downgraded_from
                if 300 <= err.code < 400:
                    raise self.fail(str(err.reason), 502)
                if err.code in (401, 403):
                    raise self.fail("the endpoint rejected the API key (%d): %s" % (err.code, _error_text(body)), err.code, body)
                if err.code == 429:
                    raise self.fail("rate limited by the endpoint (429): %s" % _error_text(body), 429, body)
                raise self.fail("HTTP %d: %s" % (err.code, _error_text(body)), 502, body)
            except (socket.timeout, TimeoutError):
                raise self.fail("no reply within %g s (timeout_s)" % self.config.timeout_s, 504)
            except urllib.error.URLError as err:
                if isinstance(err.reason, (socket.timeout, TimeoutError)):
                    raise self.fail("no reply within %g s (timeout_s)" % self.config.timeout_s, 504)
                raise self.fail("could not reach %s: %s" % (public_url(self.config.base_url), err.reason), 502)
            except (ValueError, OSError, http.client.HTTPException) as err:
                raise self.fail(str(err) or type(err).__name__, 502)
        # The call happened, so its usage is recorded whatever the reply holds. A completion without a
        # usable message, or one too deep to parse, comes back as `malformed`: an invalid answer, not an error.
        result = LlmResult(self, payload, response, latency_ms, fmt)
        self.record(result)
        with self._lock:
            if result.malformed:
                self.errors += 1
                self.last_error = scrub("LLM endpoint %r: malformed completion (%s)" % (self.config.name, result.malformed),
                                        self.api_key)
        return result


class LlmRegistry(EndpointRegistry):
    """All configured LLM endpoints for this server run."""

    endpoint_class = LlmEndpoint
    kind = "LLM"
    unknown_error = InvalidLlmRequest

    def load(self, settings: Settings):
        return load_configs(settings)

    def path(self, settings: Settings) -> Path:
        return settings.llm_endpoints_path


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
