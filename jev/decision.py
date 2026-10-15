"""Decision models as drivers: any endpoint that speaks TypeSafe's System One protocol.

A decision model takes a `state` and typed `questions` and returns typed answers with probabilities,
the protocol Jev introduced (https://docs.typesafe.ai/api). Several services speak it with the same
request body, `{model, state, questions}`, and the same answer shapes:

  * TypeSafe:   POST https://api.typesafe.ai/v1/systemone           (Jev; key TYPESAFE_API_KEY)
  * OpenRouter: POST https://openrouter.ai/api/alpha/decisions       (Jev, Perplexity Decider, Liquid d1,
                                                                      Microsoft Decision 1 and others;
                                                                      key OPENROUTER_API_KEY; adds usage.cost)
  * llama.cpp:  POST http://localhost:8080/v1/systemone              (open models such as Kev 4B; no key)

Each configured endpoint becomes an agent named `decision:<name>`. The browser sends it exactly what it
sends the built-in Jev driver (static/js/brain/state.js), so results compare fairly; the server looks
the name up in its own config, so a page can never point it at another URL or read a key. The answers
are checked against the questions before they reach the browser: each choice must be one of the
offered options. A reply that answers badly is an invalid answer (the browser falls back to Rules and
still counts the call); an HTTP error, a timeout or an exhausted budget is an error.

  data/decision-endpoints.json (gitignored; start from data/decision-endpoints.example.json)
      {"endpoints": [
        {"name": "pplx-decider", "base_url": "https://openrouter.ai", "path": "/api/alpha/decisions",
         "model": "perplexity/pplx-decider-v1.1-27b", "api_key_env": "OPENROUTER_API_KEY",
         "price_per_mtok_input": 0.02}]}

The built-in `jev` driver is not configured here: it uses jev/client.py, TYPESAFE_API_KEY and
TYPESAFE_DEFAULT_MODEL, so replays, fixtures and saved benchmark runs keep meaning the same thing.
Calls share Jev's SpendGuard. Cost is the provider's `usage.cost` when it reports one (OpenRouter
does), else input and output tokens at the configured prices, else unknown ($0). There are no retries:
a decision that misses its deadline is already stale. Standard library only, no SDK.
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

from . import decide
from .config import Settings
from .endpoints import (MAX_TRACE_DEPTH, Endpoint, EndpointError, EndpointRegistry, check_common, deeper_than,
                        error_body, load_entries, number, post_json, price, public_url, scrub, tokens, unique)

PATH_RE = re.compile(r"^/[A-Za-z0-9._~/-]{0,200}$")
DEFAULT_PATH = "/v1/systemone"
DEFAULT_CHECK_PATH = "/v1/models"
MAX_REPORTED_COST_USD = 100.0   # a larger per-call cost is a broken usage block, not a real charge


class DecisionError(EndpointError):
    """A decision endpoint call that produced no usable reply."""


class InvalidDecisionRequest(ValueError):
    pass


# Configuration


def _path(value: Any, default: str) -> Optional[str]:
    path = default if value is None else value
    if not isinstance(path, str) or not PATH_RE.match(path) or "/../" in path + "/" or "//" in path:
        return None
    return path


class DecisionConfig:
    """One validated entry from the decision endpoints file."""

    def __init__(self, raw: dict, where: str, problems: List[str]):
        self.ok = False
        common = check_common(raw, where, problems, "https://api.typesafe.ai", "TYPESAFE_API_KEY")
        if common is None:
            return
        where = common["where"]
        path = _path(raw.get("path"), DEFAULT_PATH)
        check_path = _path(raw.get("check_path"), DEFAULT_CHECK_PATH)
        if path is None or check_path is None:
            problems.append("%s: path and check_path must be URL paths such as /v1/systemone" % where)
            return
        try:
            timeout_s = float(number(raw.get("timeout_s", 5)))   # float(None) raises: timeout_s cannot be null
            rpm = number(raw.get("rpm"), integer=True)
            rpm = None if rpm is None else max(0, rpm)
        except (TypeError, ValueError, OverflowError):
            problems.append("%s: timeout_s and rpm must be finite numbers (rpm may be null)" % where)
            return
        self.name = common["name"]
        self.label = str(raw.get("label") or self.name)[:60]
        self.base_url = common["base_url"]
        self.path = path
        self.check_path = check_path
        self.model = common["model"]
        self.api_key_env = common["api_key_env"]
        self.price_in = price(raw.get("price_per_mtok_input"), "price_per_mtok_input", problems, where)
        self.price_out = price(raw.get("price_per_mtok_output"), "price_per_mtok_output", problems, where)
        self.priced = self.price_in is not None or self.price_out is not None
        self.timeout_s = min(60.0, max(1.0, timeout_s))
        # None: share JEV_FSD_RPM with Jev and the other endpoints. A number: this endpoint's own
        # per-minute cap instead (0 = none, for fast local servers in lockstep benchmarks).
        self.rpm = rpm
        self.ok = True


def load_configs(settings: Settings) -> Tuple[List[DecisionConfig], List[str]]:
    problems: List[str] = []
    entries = load_entries(settings.decision_endpoints_path, problems)
    configs = [c for c in (DecisionConfig(raw, where, problems) for raw, where in entries) if c.ok]
    return unique(configs, problems), problems


# Replies


def _probability(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value) if 0 <= value <= 1 else None


def _choice_answer(answer: Any, options: List[str], qid: str) -> Tuple[Optional[dict], Optional[str]]:
    """A clean choice answer, or (None, why it cannot be used)."""
    if not isinstance(answer, dict):
        return None, "no answer for %s" % qid
    if answer.get("type", "choice") != "choice":
        return None, "the answer for %s is a %s, not a choice" % (qid, str(answer.get("type"))[:20])
    choice = answer.get("choice")
    if not isinstance(choice, str) or choice not in options:
        return None, "the answer for %s, %s, is not one of the options" % (qid, json.dumps(choice)[:60] if choice is not None else "nothing")
    probabilities = answer.get("probabilities")
    clean = {k: p for k, p in ((k, _probability(probabilities.get(k))) for k in options) if p is not None} \
        if isinstance(probabilities, dict) else {}
    return {"type": "choice", "choice": choice, "probabilities": clean,
            "confidence": _probability(answer.get("confidence"))}, None


def check_answers(response: Optional[dict], questions: Dict[str, dict]) -> Tuple[Dict[str, dict], Optional[str]]:
    """The reply's answers to the questions asked, each a valid choice, or ({}, why not). A missing
    or unusable route answer is dropped rather than failing the decision: the car already follows
    the first route option, as for LLM drivers."""
    raw = response.get("answers") if isinstance(response, dict) else None
    if not isinstance(raw, dict):
        return {}, "the reply has no answers"
    answers: Dict[str, dict] = {}
    for qid, question in questions.items():
        answer, why = _choice_answer(raw.get(qid), list(question["criteria"]), qid)
        if answer is None:
            if qid == "route":
                continue
            return {}, why
        answers[qid] = answer
    return answers, None


def _error_text(body: Any) -> str:
    """TypeSafe says {"detail": ...}; OpenRouter says {"error": {"code", "message"}}."""
    if isinstance(body, dict):
        detail = body.get("detail", body.get("error", body))
        if isinstance(detail, dict):
            return str(detail.get("message") or json.dumps(detail))[:300]
        if isinstance(detail, list):   # FastAPI-style validation errors
            return json.dumps(detail)[:300]
        return str(detail)[:300]
    return str(body)[:300]


class DecisionResult:
    """One decision call: the reply plus everything the UI shows about it. Never raises; usage is read
    first, so tokens and cost are always recorded. `response` is None for a reply too deep to parse."""

    def __init__(self, endpoint: "DecisionEndpoint", request: dict, response: Optional[dict], latency_ms: float):
        self.endpoint = endpoint
        self.request = request
        self.latency_ms = latency_ms
        self.unparsed = response is None
        response = {} if response is None else response
        usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
        self.input_tokens = tokens(usage.get("input_tokens", usage.get("prompt_tokens")))
        self.output_tokens = tokens(usage.get("output_tokens", usage.get("completion_tokens")))
        config = endpoint.config
        reported = usage.get("cost")
        if isinstance(reported, (int, float)) and not isinstance(reported, bool) and math.isfinite(reported) \
                and 0 <= reported <= MAX_REPORTED_COST_USD:
            self.cost_usd, self.cost_source = float(reported), "provider"
        elif config.priced:
            self.cost_usd = (self.input_tokens * (config.price_in or 0) + self.output_tokens * (config.price_out or 0)) / 1_000_000
            self.cost_source = "price"
        else:
            self.cost_usd, self.cost_source = 0.0, None
        if self.unparsed:
            self.response = {"note": "reply nested too deeply to parse; not shown"}
        elif deeper_than(response, MAX_TRACE_DEPTH):
            self.response = {"note": "reply nested deeper than %d levels; not shown" % MAX_TRACE_DEPTH,
                             "usage": {"input_tokens": self.input_tokens, "output_tokens": self.output_tokens}}
        else:
            self.response = response
        model, provider = response.get("model"), response.get("provider")
        self.model = (model if isinstance(model, str) and model else str(request.get("model") or ""))[:200]
        self.provider = provider[:80] if isinstance(provider, str) else None

    def meta(self) -> dict:
        config = self.endpoint.config
        return {
            "model": self.model, "endpoint": config.name, "latency_ms": round(self.latency_ms, 1),
            "question_count": len(self.request.get("questions", {})),
            "input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
            "cost_usd": self.cost_usd, "cost_known": self.cost_source is not None,
            "backend": "system one (stdlib)" + (" via %s" % self.provider if self.provider else ""), "live_call": True,
        }


# Endpoints


class DecisionEndpoint(Endpoint):
    kind = "Decision endpoint"
    prefix = "decision:"
    error_class = DecisionError

    def public(self) -> dict:
        return {**super().public(), "path": self.config.path}

    def check_url(self) -> str:
        return self.config.base_url + self.config.check_path

    def decide(self, state: dict, questions: Dict[str, dict]) -> DecisionResult:
        if self.key_state == "missing":
            raise self.no_key()
        self.limit()
        payload = {"model": self.config.model, "state": state, "questions": questions}
        deadline = time.monotonic() + self.config.timeout_s
        try:
            response, latency_ms = post_json(self.config.base_url + self.config.path, payload, self.api_key, deadline)
        except urllib.error.HTTPError as err:
            body = error_body(err)
            if 300 <= err.code < 400:
                raise self.fail(str(err.reason), 502)
            if err.code in (401, 403):
                raise self.fail("the endpoint rejected the API key (%d): %s" % (err.code, _error_text(body)), err.code, body)
            if err.code == 402:
                raise self.fail("the provider says this account is out of credits (402): %s" % _error_text(body), 402, body)
            if err.code in (429, 529):
                raise self.fail("rate limited or overloaded (%d): %s" % (err.code, _error_text(body)), 429, body)
            raise self.fail("HTTP %d: %s" % (err.code, _error_text(body)), 502, body)
        except (socket.timeout, TimeoutError):
            raise self.fail("no reply within %g s (timeout_s)" % self.config.timeout_s, 504)
        except urllib.error.URLError as err:
            if isinstance(err.reason, (socket.timeout, TimeoutError)):
                raise self.fail("no reply within %g s (timeout_s)" % self.config.timeout_s, 504)
            raise self.fail("could not reach %s: %s" % (public_url(self.config.base_url), err.reason), 502)
        except (ValueError, OSError, http.client.HTTPException) as err:
            raise self.fail(str(err) or type(err).__name__, 502)
        result = DecisionResult(self, payload, response, latency_ms)
        self.record(result)
        return result

    def invalid(self, reason: str) -> None:
        """A call that happened but whose answers could not be used: counted as an error for the UI."""
        with self._lock:
            self.errors += 1
            self.last_error = scrub("%s %r: %s" % (self.kind, self.config.name, reason), self.api_key)


class DecisionRegistry(EndpointRegistry):
    """All configured decision endpoints for this server run."""

    endpoint_class = DecisionEndpoint
    kind = "decision"
    unknown_error = InvalidDecisionRequest

    def load(self, settings: Settings):
        return load_configs(settings)

    def path(self, settings: Settings) -> Path:
        return settings.decision_endpoints_path


# The /api/decision/decide handler


def decision_decide(registry: DecisionRegistry, body: dict) -> dict:
    try:
        req = decide.validate_request(body)
    except decide.InvalidRequest as err:
        raise InvalidDecisionRequest(str(err))
    endpoint = registry.get(body.get("endpoint"))
    result = endpoint.decide(req["state"], req["questions"])
    if result.unparsed:
        answers, invalid = {}, "reply nested too deeply to parse"
    else:
        try:
            answers, invalid = check_answers(result.response, req["questions"])
        except Exception as err:   # e.g. RecursionError from an absurd reply
            answers, invalid = {}, "could not read the reply (%s)" % type(err).__name__
    meta = dict(result.meta(), source="decision:" + endpoint.config.name)
    if invalid:
        meta["invalid"] = invalid
        endpoint.invalid(invalid)
    request = dict(result.request, url=public_url(endpoint.config.base_url) + endpoint.config.path,
                   api_key_env=endpoint.config.api_key_env)
    trace = {"request": request, "response": result.response, "meta": meta}
    return scrub({"tick": req["tick"], "epoch": req["epoch"], "answers": answers, "invalid": invalid,
                  "meta": meta, "trace": trace}, endpoint.api_key)
