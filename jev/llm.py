"""Any OpenAI-compatible Chat Completions endpoint, or Anthropic's Messages API, as a driver.

Each configured endpoint becomes an agent named `llm:<name>` in the simulator, the arena and the
bench. The browser builds the prompt (static/js/brain/llm-prompt.js) from the same decision state
Jev sees and posts it to /api/llm/decide with the endpoint's *name*. This module looks the name up
in server-side config, calls `POST {base_url}/chat/completions` (or, for an entry with
`"api": "anthropic"`, `POST {base_url}/messages`), parses the reply leniently and
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
holds a key. Calls share Jev's SpendGuard (JEV_FSD_BUDGET_USD, JEV_FSD_RPM). Cost is the provider's
`usage.cost` when it reports one (OpenRouter does), else tokens at the configured prices. Without
either an endpoint reports tokens and an unknown ($0) cost, so the budget cannot stop it; the RPM cap still does,
unless the endpoint sets `rpm: 0`, which removes that too.

Anthropic entries (the Claude Platform preset) send the key as `x-api-key`, put the system message in
`system` with prompt caching, put the schema in `output_config.format`, and send no temperature, which
that API no longer takes. Cache writes and reads are priced at Anthropic's 1.25x and 0.1x input rates.

Standard library only (urllib), no SDK: every provider shares the redirect-refusing, deadline-bound
transport in jev/endpoints.py.

Optional per-endpoint limits also include max_parallel, max_request_bytes, check_timeout_s,
check_ttl_s, and retry_after_max_s. Chat entries can set check_path and fallback_response_format
("none", "json_object" or "disabled"). Use token_field and system_role for compatible chat APIs,
or cache_ttl ("5m", "1h" or "off") with Anthropic. An OpenAI-compatible endpoint may set
price_per_mtok_cached_input when its response reports cached prompt tokens.
"""

from __future__ import annotations

import http.client
import json
import math
import re
import socket
import time
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .client import token_count, usage_tokens
from .config import Settings
from .decide import request_sequence, utf8_text
from .endpoints import (
    MAX_SCRUB_DEPTH,  # noqa: F401  (tests read it as llm.MAX_SCRUB_DEPTH)
    MAX_TRACE_DEPTH,
    Endpoint,
    EndpointError,
    EndpointRegistry,  # noqa: F401
    api_path,
    billed_cost,
    bounded_integer,
    check_common,
    deeper_than,
    encode_request,
    endpoint_limits,
    error_body,
    load_entries,
    number,
    post_json,
    price,
    public_url,
    scrub,
    tokens,
    unique,
)

ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
MOTIONS = ("drive", "stop", "reverse")
RESPONSE_FORMATS = ("json_schema", "json_object", "none")
RESERVED_BODY_KEYS = {"model", "messages", "stream", "response_format", "n"}
# "openai": Chat Completions, which most servers speak. "anthropic": Anthropic's Messages API (Claude Platform).
APIS = ("openai", "anthropic")
# (version 2026-10-21 of Anthropic's API refuses every sampling parameter)
# Endpoint fields whose null is meaningful (send no such parameter), from JEV_FSD_LLM_* as from llm.json.
NULLABLE_ENV_FIELDS = frozenset({"max_tokens", "temperature", "rpm"})
ANTHROPIC_RESERVED_BODY_KEYS = {"model", "messages", "system", "stream", "temperature", "top_p", "top_k"}
# Anthropic bills prompt-cache writes (5-minute) at 1.25 times its input price and reads at 0.1 times on
# most models. Some read cheaper (Opus and Sonnet 5.5 at 0.05, Fable and Mythos 5.1 and 5.2 at 0.025),
# so for those the count is a conservative estimate: it can only stop the budget early, never late.
CACHE_WRITE_RATE = 1.25
CACHE_READ_RATE = 0.1

MAX_MESSAGES = 6
MAX_PROMPT_CHARS = 64 * 1024
MAX_PROMPT_BYTES = 128 * 1024
MAX_CHOICES = 32
MAX_CONTENT_CHARS = 20_000
MAX_OUTPUT_TOKENS = 256 * 1024
MAX_EXTRA_BODY_BYTES = 16 * 1024


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
        name, where, base_url, model, key_env = (
            common[k] for k in ("name", "where", "base_url", "model", "api_key_env")
        )
        api = raw.get("api") if raw.get("api") is not None else "openai"
        if api not in APIS:
            problems.append("%s: api must be one of %s" % (where, ", ".join(APIS)))
            return
        anthropic = api == "anthropic"
        response_format = raw.get("response_format") if raw.get("response_format") is not None else "json_schema"
        if response_format not in RESPONSE_FORMATS:
            problems.append("%s: response_format must be one of %s" % (where, ", ".join(RESPONSE_FORMATS)))
            return
        if anthropic and response_format == "json_object":
            problems.append("%s: Anthropic's API has no json_object mode; use json_schema or none" % where)
            return
        fallback = raw.get("fallback_response_format", "none")
        if fallback not in ("none", "json_object", "disabled") or (anthropic and fallback == "json_object"):
            problems.append(
                "%s: fallback_response_format must be none or disabled%s"
                % (where, "" if anthropic else " or json_object")
            )
            return
        check_path = api_path(raw.get("check_path"), "/models")
        if check_path is None:
            problems.append("%s: check_path must be a URL path such as /models" % where)
            return
        reserved = ANTHROPIC_RESERVED_BODY_KEYS if anthropic else RESERVED_BODY_KEYS
        extra = raw.get("extra_body")
        if extra is None:
            extra = {}
        if not isinstance(extra, dict) or reserved & set(extra):
            problems.append("%s: extra_body must be an object without %s" % (where, ", ".join(sorted(reserved))))
            return
        try:
            if deeper_than(extra, 16) or len(encode_request(extra)) > MAX_EXTRA_BODY_BYTES:
                raise ValueError("extra_body may contain at most %d bytes and 16 levels" % MAX_EXTRA_BODY_BYTES)
        except ValueError as err:
            problems.append("%s: extra_body: %s" % (where, err))
            return
        token_field = raw.get("token_field", "max_tokens")
        if token_field not in ("max_tokens", "max_completion_tokens") or (anthropic and token_field != "max_tokens"):
            problems.append(
                "%s: token_field must be max_tokens (%s)"
                % (where, "required for Anthropic" if anthropic else "or max_completion_tokens")
            )
            return
        system_role = raw.get("system_role", "system")
        if system_role not in ("system", "developer") or (anthropic and system_role != "system"):
            problems.append("%s: system_role must be system%s" % (where, "" if anthropic else " or developer"))
            return
        cache_ttl = raw.get("cache_ttl")
        if cache_ttl is not None and (not anthropic or cache_ttl not in ("5m", "1h", "off")):
            problems.append("%s: cache_ttl must be 5m, 1h or off on an Anthropic endpoint" % where)
            return
        if anthropic and "output_config" in extra:
            output_config = extra["output_config"]
            if not isinstance(output_config, dict) or "format" in output_config:
                problems.append(
                    "%s: extra_body.output_config must be an object without format (response_format sets it)" % where
                )
                return
        try:
            timeout_s = float(number(raw.get("timeout_s", 10)))  # float(None) raises: timeout_s cannot be null
            max_tokens = bounded_integer({"max_tokens": raw.get("max_tokens", 400)}, "max_tokens", MAX_OUTPUT_TOKENS)
            extra = extra.copy()
            for field in ("max_tokens", "max_completion_tokens"):
                if field in extra:
                    extra[field] = bounded_integer(extra, field, MAX_OUTPUT_TOKENS)
            # (Anthropic's API takes no sampling parameters, so there is no temperature to default to)
            temperature = number(raw.get("temperature", None if anthropic else 0))
            rpm = bounded_integer(raw, "rpm", 1_000_000, minimum=0)
        except (TypeError, ValueError, OverflowError):
            problems.append(
                "%s: timeout_s, max_tokens, temperature and rpm must be finite numbers "
                "(max_tokens, temperature and rpm may be null)" % where
            )
            return
        if anthropic and temperature is not None:
            problems.append("%s: Anthropic's API takes no temperature; remove it" % where)
            return
        if anthropic and max_tokens is None:
            problems.append("%s: Anthropic's API needs max_tokens; it may not be null" % where)
            return
        if anthropic and ("max_completion_tokens" in extra or ("max_tokens" in extra and extra["max_tokens"] is None)):
            problems.append("%s: Anthropic's max_tokens must be a positive number" % where)
            return
        if {"max_tokens", "max_completion_tokens"} <= extra.keys():
            problems.append("%s: extra_body can set just one output token cap" % where)
            return
        if temperature is not None and not 0 <= temperature <= 2:
            problems.append("%s: temperature must be between 0 and 2" % where)
            return
        try:
            self.__dict__.update(endpoint_limits(raw))
        except ValueError as err:
            problems.append("%s: %s" % (where, err))
            return
        self.api = api
        # (where calls go, after base_url)
        self.call_path = "/messages" if anthropic else "/chat/completions"
        self.name = name
        self.label = common["label"]
        self.base_url = base_url
        self.model = model
        self.api_key_env = key_env
        self.price_in = price(raw.get("price_per_mtok_input"), "price_per_mtok_input", problems, where)
        self.price_out = price(raw.get("price_per_mtok_output"), "price_per_mtok_output", problems, where)
        self.price_cached = price(
            raw.get("price_per_mtok_cached_input"), "price_per_mtok_cached_input", problems, where
        )
        if anthropic and self.price_cached is not None:
            problems.append("%s: Anthropic cache pricing uses price_per_mtok_input and its cache multipliers" % where)
            return
        if self.price_cached is not None and self.price_in is None:
            problems.append("%s: cached input pricing needs price_per_mtok_input for the uncached tokens" % where)
            return
        self.priced = self.price_in is not None or self.price_out is not None
        self.timeout_s = min(60.0, max(1.0, timeout_s))
        self.max_tokens = max_tokens
        self.token_field = token_field
        self.system_role = system_role
        self.cache_ttl = cache_ttl
        self.temperature = temperature
        # None: share JEV_FSD_RPM with Jev and the other endpoints. A number: this endpoint's own
        # per-minute cap instead (0 = none, for fast local servers in lockstep benchmarks).
        self.rpm = rpm
        self.response_format = response_format
        self.fallback_response_format = fallback
        self.check_path = check_path
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
        for field in (
            "api",
            "response_format",
            "max_tokens",
            "rpm",
            "max_parallel",
            "max_request_bytes",
            "token_field",
            "system_role",
            "cache_ttl",
            "temperature",
            "check_timeout_s",
            "check_ttl_s",
            "retry_after_max_s",
            "check_path",
            "fallback_response_format",
            "price_per_mtok_cached_input",
        ):
            value = settings.get("JEV_FSD_LLM_" + field.upper())
            if value is not None:
                env_entry[field] = None if value == "null" else value
        # An unset setting is left out; an explicit null for a field that takes one means "send none".
        kept = {k: v for k, v in env_entry.items() if v is not None or k in NULLABLE_ENV_FIELDS}
        entries.append((kept, "JEV_FSD_LLM_* settings"))
    configs = [c for c in (EndpointConfig(raw, where, problems) for raw, where in entries) if c.ok]
    return unique(configs, problems), problems


# Replies


class LlmResult:
    """One chat completion: the reply text plus everything the UI shows about the call.

    Never raises. Usage is read first, so tokens and cost are always recorded; a completion without
    a usable choice or message sets `malformed` and leaves `content` empty. `response` is None for a
    completion nested too deeply to parse at all: its tokens are unknown and count as 0."""

    def __init__(
        self, endpoint: "LlmEndpoint", request: dict, response: Optional[dict], latency_ms: float, format_used: str
    ):
        self.request = request
        unparsed = response is None
        response = {} if response is None else response
        usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
        config = endpoint.config
        self.anthropic = config.api == "anthropic"
        self.input_tokens = usage_tokens(usage, "prompt_tokens", "input_tokens")
        self.output_tokens = usage_tokens(usage, "completion_tokens", "output_tokens")
        # Anthropic's input_tokens leaves out the prompt-cache writes and reads, which are billed apart;
        # input_tokens here is every input token, as for the other APIs.
        cache = usage.get("cache_creation") if self.anthropic else None
        cache = cache if isinstance(cache, dict) else {}
        long_cache = tokens(cache.get("ephemeral_1h_input_tokens"))
        short_cache = tokens(cache.get("ephemeral_5m_input_tokens"))
        total_cache = token_count(usage.get("cache_creation_input_tokens")) if self.anthropic else None
        self.cache_write_tokens = total_cache if total_cache is not None else long_cache + short_cache
        self.cache_read_tokens = tokens(usage.get("cache_read_input_tokens")) if self.anthropic else 0
        uncached = self.input_tokens
        self.input_tokens += self.cache_write_tokens + self.cache_read_tokens
        # (the provider's billed cost when it reports one, as for decision models: OpenRouter's can be
        # several times tokens at list prices, which is what the budget must stop)
        # Provider split takes precedence for known 1-hour writes. With no breakdown, use the
        # configured TTL. If both fields are present, cap the split at the aggregate.
        if not cache and config.cache_ttl == "1h":
            long_cache = self.cache_write_tokens
        long_cache = min(long_cache, self.cache_write_tokens)
        billed_input = (
            uncached
            + CACHE_WRITE_RATE * self.cache_write_tokens
            + 0.75 * long_cache
            + CACHE_READ_RATE * self.cache_read_tokens
        )
        prompt_details = usage.get("prompt_tokens_details")
        self.cached_input_tokens = (
            min(self.input_tokens, tokens(prompt_details.get("cached_tokens")))
            if not self.anthropic and isinstance(prompt_details, dict)
            else 0
        )
        self.cost_usd, self.cost_source = billed_cost(
            usage, config, billed_input, self.output_tokens, self.cached_input_tokens
        )
        # The trace copies the completion, so an absurdly nested one is summarised rather than walked.
        if unparsed:
            self.response = {"note": "completion nested too deeply to parse; not shown"}
        elif deeper_than(response, MAX_TRACE_DEPTH):
            self.response = {
                "note": "completion nested deeper than %d levels; not shown" % MAX_TRACE_DEPTH,
                "usage": {"prompt_tokens": self.input_tokens, "completion_tokens": self.output_tokens},
            }
        else:
            self.response = response
        self.latency_ms = latency_ms
        self.format_used = format_used
        self.endpoint = endpoint
        model = response.get("model")
        self.model = (model.strip() if isinstance(model, str) and model.isprintable() else "")[:200] or request["model"]
        self.malformed: Optional[str] = None
        try:
            if unparsed:
                raise ValueError("nested too deeply to parse")
            self.content, self.refusal = (_anthropic_text if self.anthropic else _message_text)(response)
        except Exception as err:  # ValueError for a missing choice or message; RecursionError for absurd nesting
            self.content, self.refusal = "", ""
            self.malformed = str(err) if isinstance(err, ValueError) else type(err).__name__

    def meta(self) -> dict:
        config = self.endpoint.config
        return {
            "model": self.model,
            "endpoint": config.name,
            "latency_ms": round(self.latency_ms, 1),
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": self.cost_usd,
            "cost_known": self.cost_source is not None,
            "response_format": self.format_used,
            "backend": "anthropic messages (stdlib)" if self.anthropic else "openai-compatible (stdlib)",
            "live_call": True,
            **(
                {"cache_read_tokens": self.cache_read_tokens, "cache_write_tokens": self.cache_write_tokens}
                if self.anthropic
                else ({"cache_read_tokens": self.cached_input_tokens} if self.cached_input_tokens else {})
            ),
        }


def _message_text(response: dict) -> Tuple[str, str]:
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError("no choices")
    choice = choices[0]
    finish = choice.get("finish_reason")
    if finish == "length":
        raise ValueError("completion stopped at its output token limit")
    if finish == "content_filter":
        return "", "the provider filtered the completion"
    if finish in ("tool_calls", "function_call"):
        raise ValueError("the model attempted a tool call instead of answering")
    message = choice.get("message")
    if not isinstance(message, dict):
        raise ValueError("no message")
    content = message.get("content")
    if isinstance(content, list):  # some servers return content parts
        content = _text_parts(content)
    refusal = message.get("refusal")
    if isinstance(refusal, str) and refusal.strip():
        return "", refusal.strip()
    if content is not None and not isinstance(content, str):
        raise ValueError("message content must be text or text parts")
    return _bounded_text(content or ""), ""


def _text_parts(parts: list, *, require_type: bool = False) -> str:
    return "".join(
        part["text"]
        for part in parts
        if isinstance(part, dict)
        and part.get("type", None if require_type else "text") == "text"
        and isinstance(part.get("text"), str)
    )


def _bounded_text(content: str) -> str:
    if len(content) > MAX_CONTENT_CHARS:
        raise ValueError("reply is longer than %d characters" % MAX_CONTENT_CHARS)
    if not utf8_text(content):
        raise ValueError("reply contains invalid Unicode")
    return content


def _anthropic_text(response: dict) -> Tuple[str, str]:
    """A Messages API reply: its text blocks (thinking blocks are left out), or a refusal. A refused
    reply's text may not match the schema, so it counts as no answer."""
    stop = response.get("stop_reason")
    if stop == "refusal":
        details = response.get("stop_details") if isinstance(response.get("stop_details"), dict) else {}
        detail = next(
            (
                details[key]
                for key in ("explanation", "category")
                if isinstance(details.get(key), str) and details[key].strip()
            ),
            "declined",
        )
        return "", detail
    if stop == "max_tokens":  # (cut off, so whatever text came may be incomplete JSON)
        raise ValueError("stopped at max_tokens before it finished answering; raise max_tokens")
    if stop in ("tool_use", "pause_turn"):
        raise ValueError("completion stopped before returning a driving decision (%s)" % stop)
    blocks = response.get("content")
    if not isinstance(blocks, list):
        raise ValueError("no content")
    return _bounded_text(_text_parts(blocks, require_type=True)), ""


_THINK_BLOCK = re.compile(r"^\s*<think>.*?(</think>|$)", re.S | re.I)
_JSON_FENCE = re.compile(r"```(?:json)?[^\S\n]*\n(.*?)```", re.S | re.I)
_CANDIDATE_KEYS = ("candidate", "candidate_id", "manoeuvre", "maneuver", "choice", "id", "vector")
_ROUTE_KEYS = ("route", "route_id")


class _DuplicateField(ValueError):
    pass


def _unique_fields(pairs: list) -> dict:
    obj = dict(pairs)
    if len(obj) != len(pairs):
        raise _DuplicateField()
    return obj


def extract_json(text: str) -> Optional[dict]:
    """The reply as a JSON object: the whole text, a fenced block, or the first object inside prose.
    A reply nested too deeply for the parser counts as no object."""
    if not isinstance(text, str) or len(text) > MAX_CONTENT_CHARS:
        return None
    text = text.strip()
    while text.lower().startswith("<think>"):
        text = _THINK_BLOCK.sub("", text, count=1).strip()
    fence = _JSON_FENCE.search(text)
    if fence:
        text = fence[1].strip()
    if not text:
        return None
    decoder = json.JSONDecoder(object_pairs_hook=_unique_fields)
    try:
        whole = decoder.decode(text)
        return whole if isinstance(whole, dict) and not deeper_than(whole, 16) else None
    except (_DuplicateField, RecursionError):
        return None
    except ValueError:
        pass
    if fence or text.startswith("["):
        return None
    start = text.find("{")
    while start != -1:
        try:
            value, _ = decoder.raw_decode(text, start)
            if isinstance(value, dict):
                return None if deeper_than(value, 16) else value
        except (_DuplicateField, RecursionError):
            return None
        except ValueError:
            if not start or text[start - 1] in '[{":':
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
    if isinstance(value, float) and not math.isfinite(value):
        return None
    text = str(value).strip().strip("`'\"")
    if text in allowed:
        return text
    matches = [option for option in allowed if option.lower() == text.lower()]
    return matches[0] if len(matches) == 1 else None


def _answer_value(fields: dict, keys: tuple):
    values = [fields[key] for key in keys if key in fields]
    if values and any(value != values[0] for value in values[1:]):
        raise ValueError("conflicting aliases for %s" % keys[0])
    return values[0] if values else None


def parse_answer(content: str, expect: dict) -> Tuple[Optional[dict], Optional[str]]:
    """(answer, None) when the reply names valid choices for every asked field, else (None, reason).

    Lenient about form (code fences, prose around the JSON, key spelling, case); strict about content:
    the motion and candidate must be among the offered values. A missing or unknown route is ignored
    because the car is already following the first route option."""
    obj = extract_json(content)
    if obj is None:
        return None, "empty reply" if not (content or "").strip() else "reply was not a JSON object"
    fields = {str(k).strip().lower(): v for k, v in obj.items()}
    if len(fields) != len(obj):
        return None, "reply repeated a field with a different spelling"
    answer: Dict[str, Any] = {}
    if expect.get("motion"):
        value = fields.get("motion")
        motion = _match(value, expect["motion"])
        if motion is None:
            return None, (
                "no motion in the reply"
                if value is None
                else "motion %s is not one of %s" % (_quote(value, 40), "/".join(expect["motion"]))
            )
        answer["motion"] = motion
    if expect.get("candidate"):
        try:
            value = _answer_value(fields, _CANDIDATE_KEYS)
        except ValueError as err:
            return None, str(err)
        candidate = _match(value, expect["candidate"])
        if candidate is None:
            return None, (
                "no candidate in the reply"
                if value is None
                else "candidate %s is not an eligible manoeuvre" % _quote(value, 60)
            )
        answer["candidate"] = candidate
    if expect.get("headlights"):
        # Optional actuation: omitted/invalid beam choices fall back to Rules in the browser.
        beam = _match(fields.get("headlights"), expect["headlights"])
        if beam:
            answer["headlights"] = beam
    if expect.get("route"):
        try:
            route = _match(_answer_value(fields, _ROUTE_KEYS), expect["route"])
        except ValueError:
            route = None
        if route:
            answer["route"] = route
    if isinstance(fields.get("reason"), str):
        answer["reason"] = fields["reason"][:200] if utf8_text(fields["reason"]) else ""
    return answer, None


def _decision_schema(expect: dict) -> dict:
    properties: Dict[str, Any] = {}
    for field in ("motion", "candidate", "route", "headlights"):
        if expect.get(field):
            properties[field] = {"type": "string", "enum": list(expect[field])}
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


def response_format_for(kind: str, expect: dict) -> Optional[dict]:
    if kind == "json_object":
        return {"type": "json_object"}
    if kind != "json_schema":
        return None
    return {
        "type": "json_schema",
        "json_schema": {"name": "driving_decision", "strict": True, "schema": _decision_schema(expect)},
    }


# One schema for every Claude decision. Anthropic renders output_config.format into the prompt, so a
# schema listing each decision's own ids would change the cached prefix on almost every call. The
# user message names the keys and ids to answer with (`answer`), and parse_answer still checks them.
ANTHROPIC_SCHEMA = {
    "type": "object",
    "properties": {
        "motion": {"type": "string", "enum": list(MOTIONS)},
        "candidate": {"type": "string"},
        "route": {"type": "string"},
        "headlights": {"type": "string"},
    },
    "required": [],
    "additionalProperties": False,
}


def anthropic_payload(config: "EndpointConfig", messages: List[dict], expect: dict, fmt: str) -> dict:
    """A Messages API request. The system messages become the system prompt, marked for prompt caching:
    the browser keeps it identical between calls (brain/llm-prompt.js), so after the first call it is
    billed at the cache-read rate. A prompt shorter than the model's cache minimum is simply not cached.
    The fixed ANTHROPIC_SCHEMA goes in output_config.format, beside any output_config (effort, say)
    from extra_body. (`expect` is unused here: parse_answer checks the reply against it.)"""
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    payload: Dict[str, Any] = {
        "model": config.model,
        "max_tokens": config.max_tokens,
        "messages": [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] != "system"],
    }
    if system:
        block: Dict[str, Any] = {"type": "text", "text": system}
        if config.cache_ttl != "off":
            block["cache_control"] = {"type": "ephemeral"}
            if config.cache_ttl:
                block["cache_control"]["ttl"] = config.cache_ttl
        payload["system"] = [block]
    extra = dict(config.extra_body)
    output_config = dict(extra.pop("output_config", None) or {})
    if fmt == "json_schema":
        output_config["format"] = {"type": "json_schema", "schema": ANTHROPIC_SCHEMA}
    payload.update(extra)
    if output_config:
        payload["output_config"] = output_config
    return payload


def openai_payload(config: EndpointConfig, messages: List[dict], expect: dict, fmt: str) -> dict:
    if config.system_role == "developer":
        messages = [dict(message, role="developer") if message["role"] == "system" else message for message in messages]
    payload = {"model": config.model, "messages": messages}
    if config.temperature is not None:
        payload["temperature"] = config.temperature
    if config.max_tokens is not None and not {"max_tokens", "max_completion_tokens"} & config.extra_body.keys():
        payload[config.token_field] = config.max_tokens
    response_format = response_format_for(fmt, expect)
    if response_format:
        payload["response_format"] = response_format
    payload.update(config.extra_body)
    return payload


def without_signatures(response: Any) -> Any:
    """The reply for the trace, with the opaque `signature` of Anthropic's thinking blocks emptied: a kilobyte
    or two of encrypted text per call that nothing reads, and that a model recording (brain/recording.js)
    would otherwise keep for every decision. The reply itself is left as it came."""
    if not isinstance(response, dict) or not isinstance(response.get("content"), list):
        return response
    content = [
        dict(b, signature="") if isinstance(b, dict) and isinstance(b.get("signature"), str) else b
        for b in response["content"]
    ]
    return dict(response, content=content)


def _error_text(body: Any, key: Optional[str]) -> str:
    body = scrub(body, key)
    if isinstance(body, dict):
        err = body.get("error", body.get("detail", body))
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
        self._format_version = 0

    def public(self) -> dict:
        with self._lock:
            fmt = self._format
        c = self.config
        return {
            **super().public(),
            "response_format": fmt,
            **({"configured_response_format": c.response_format} if fmt != c.response_format else {}),
            **(
                {
                    field: getattr(c, field)
                    for field, default in (
                        ("check_path", "/models"),
                        ("fallback_response_format", "none"),
                        ("cache_ttl", None),
                        ("token_field", "max_tokens"),
                        ("system_role", "system"),
                    )
                    if getattr(c, field) != default
                }
            ),
            **({"price_per_mtok_cached_input": c.price_cached} if c.price_cached is not None else {}),
        }

    def check_url(self) -> str:
        return self.config.base_url + self.config.check_path

    def chat(self, messages: List[dict], expect: dict) -> LlmResult:
        """One decision call. `timeout_s` is a single deadline for every attempt, including the plain
        retry after a rejected response_format, and each attempt passes the budget and rate limit."""
        if self.key_state == "missing":
            raise self.no_key()
        started = time.monotonic()
        deadline = started + self.config.timeout_s
        with self._lock:
            fmt = self._format
            version = self._format_version
        downgraded_from: Optional[str] = None
        while True:
            if self.config.api == "anthropic":
                payload = anthropic_payload(self.config, messages, expect, fmt)
            else:
                payload = openai_payload(self.config, messages, expect, fmt)
            attempt_started = time.monotonic()
            try:
                if deadline <= attempt_started:
                    raise TimeoutError("deadline passed")
                self.check_request_size(payload)
                with self.attempt():
                    response, _ = post_json(
                        self.config.base_url + self.config.call_path,
                        payload,
                        self.api_key,
                        deadline,
                        self.config.api,
                    )
                    result = LlmResult(self, payload, response, (time.monotonic() - started) * 1000, fmt)
                    self.record(result)
                # A working plain request confirms any downgrade in effect, even if another
                # concurrent request was responsible for starting it.
                if fmt != self.config.response_format:
                    with self._lock:
                        if self._format == fmt:
                            self._format_version += 1
                break
            except urllib.error.HTTPError as err:
                body = error_body(err)
                detail = _error_text(body, self.api_key)
                # Not every server supports structured output. Remember plain mode at once, and retry
                # this decision only if the rest of the deadline comfortably fits another attempt.
                fallback = self.config.fallback_response_format
                if (
                    err.code in (400, 422)
                    and downgraded_from is None
                    and fmt == self.config.response_format
                    and fmt not in ("none", fallback)
                    and fallback != "disabled"
                ):
                    rejected, fmt = fmt, fallback
                    downgraded_from = rejected
                    with self._lock:
                        if self._format_version == version:
                            self._format = fallback
                            self._format_version += 1
                            version = self._format_version
                        else:
                            version = None
                    now = time.monotonic()
                    if deadline - now > 1.5 * (now - attempt_started):
                        continue
                    raise self.fail(
                        "the endpoint rejected response_format %s (HTTP %d: %s); later calls use %s, "
                        "but too little of timeout_s was left to retry this one"
                        % (rejected, err.code, detail, fallback),
                        502,
                        body,
                    )
                if err.code in (400, 422) and downgraded_from:
                    # The plain retry was refused too, so the request itself is wrong (a bad model name,
                    # say), not its response_format: keep the format this endpoint had.
                    with self._lock:
                        if self._format_version == version:
                            self._format = downgraded_from
                            self._format_version += 1
                if 300 <= err.code < 400:
                    raise self.fail(str(err.reason), 502)
                if err.code in (401, 403):
                    raise self.fail("the endpoint rejected the API key (%d): %s" % (err.code, detail), err.code, body)
                if err.code == 429:
                    self.defer(err)
                    raise self.fail("rate limited by the endpoint (429): %s" % detail, 429, body)
                if err.code == 529:
                    self.defer(err)
                    raise self.fail("the endpoint is overloaded (529): %s" % detail, 429, body)
                if err.code == 402:
                    raise self.fail("the provider says this account is out of credits (402): %s" % detail, 402, body)
                if err.code == 404:
                    raise self.fail("HTTP 404: check the model id and base_url: %s" % detail, 502, body)
                raise self.fail("HTTP %d: %s" % (err.code, detail), 502, body)
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
    if not isinstance(body, dict):
        raise InvalidLlmRequest("LLM request must be a JSON object")
    messages = body.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= MAX_MESSAGES:
        raise InvalidLlmRequest("messages must be a list of 1-%d chat messages" % MAX_MESSAGES)
    total = 0
    wire_bytes = 0
    clean = []
    for m in messages:
        if (
            not isinstance(m, dict)
            or m.get("role") not in ("system", "user", "assistant")
            or not isinstance(m.get("content"), str)
        ):
            raise InvalidLlmRequest("each message needs a role (system, user or assistant) and string content")
        total += len(m["content"])
        if total > MAX_PROMPT_CHARS:
            raise InvalidLlmRequest("prompt is longer than %d characters" % MAX_PROMPT_CHARS)
        try:
            wire_bytes += len(m["content"].encode("utf-8"))
        except UnicodeEncodeError as err:
            raise InvalidLlmRequest("prompt must contain valid Unicode") from err
        clean.append({"role": m["role"], "content": m["content"]})
    if not any(m["role"] == "user" and m["content"].strip() for m in clean):
        raise InvalidLlmRequest("messages must include a non-empty user message")
    if wire_bytes > MAX_PROMPT_BYTES:
        raise InvalidLlmRequest("prompt uses more than %d UTF-8 bytes" % MAX_PROMPT_BYTES)
    expect_in = body.get("expect")
    if not isinstance(expect_in, dict):
        raise InvalidLlmRequest("expect must say which choices the model may make")
    expect: Dict[str, List[str]] = {}
    for field in ("motion", "candidate", "route", "headlights"):
        values = expect_in.get(field)
        if values is None:
            continue
        if (
            not isinstance(values, list)
            or not 1 <= len(values) <= MAX_CHOICES
            or not all(isinstance(v, str) and ID_RE.fullmatch(v) for v in values)
        ):
            raise InvalidLlmRequest("expect.%s must be a list of 1-%d short ids" % (field, MAX_CHOICES))
        if len(set(values)) != len(values):
            raise InvalidLlmRequest("expect.%s must contain unique ids" % field)
        if field == "motion" and not set(values) <= set(MOTIONS):
            raise InvalidLlmRequest("expect.motion may only contain %s" % ", ".join(MOTIONS))
        expect[field] = values
    if not expect:
        raise InvalidLlmRequest("expect needs at least one of motion, candidate, route or headlights")
    tick, epoch = request_sequence(body, InvalidLlmRequest)
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
            answer, invalid = None, "the model refused: %s" % scrub(result.refusal, endpoint.api_key)[:160]
        else:
            answer, invalid = parse_answer(scrub(result.content, endpoint.api_key), req["expect"])
    except Exception as err:  # e.g. RecursionError from an absurdly nested reply
        answer, invalid = None, "could not read the reply (%s)" % type(err).__name__
    meta = dict(result.meta(), source="llm:" + endpoint.config.name)
    if invalid:
        meta["invalid"] = invalid
        endpoint.invalid(invalid)
    request = dict(
        result.request,
        url=public_url(endpoint.config.base_url) + endpoint.config.call_path,
        api_key_env=endpoint.config.api_key_env,
    )
    trace = {"request": request, "response": without_signatures(result.response), "meta": meta}
    # Scrub everything: the answer, reason and invalid excerpt all quote the model's reply.
    return scrub(
        {
            "tick": req["tick"],
            "epoch": req["epoch"],
            "answer": answer,
            "invalid": invalid,
            "content": result.content,
            "meta": meta,
            "trace": trace,
        },
        endpoint.api_key,
    )
