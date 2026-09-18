"""The one place Jev FSD talks to TypeSafe.

Uses the official `typesafe-sdk` when it is installed (Python 3.10+). On an older Python the same
requests go through a small stdlib fallback so the demo still runs; the request and response JSON
are identical either way (https://docs.typesafe.ai/api).

Around the call sit two things a demo that spends real money should have:
  * a spend guard (per-run budget and a local rate limit),
  * request/response capture for the "Inspect JSON" drawer, without ever capturing the key.
"""

from __future__ import annotations

import json
import random
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from typing import Any, Dict, Optional

from .config import Settings

try:  # the official SDK needs Python >= 3.10
    import typesafe_sdk
    from typesafe_sdk import (RetryPolicy, TypeSafeAPIConnectionError, TypeSafeAPIError, TypeSafeClient,
                              TypeSafeError)
    SDK_VERSION: Optional[str] = getattr(typesafe_sdk, "__version__", None)
    if SDK_VERSION is None:
        try:
            from importlib.metadata import version as _pkg_version
            SDK_VERSION = _pkg_version("typesafe-sdk")
        except Exception:  # noqa: BLE001
            SDK_VERSION = "unknown"
except ImportError:  # pragma: no cover - exercised on Python 3.9
    TypeSafeClient = None
    SDK_VERSION = None

# jev-1.13 pricing from https://docs.typesafe.ai/models: input tokens only, output is free.
PRICE_PER_INPUT_TOKEN_USD = 0.042 / 1_000_000
RETRYABLE_STATUSES = {408, 429, 500, 502, 503, 504, 529}


class JevError(Exception):
    def __init__(self, message: str, status: Optional[int] = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


class JevResult:
    """One System One call: typed answers plus everything the UI shows about the call."""

    def __init__(self, request: dict, response: dict, latency_ms: float, backend: str = ""):
        self.request = request
        self.response = response
        self.latency_ms = latency_ms
        self.backend = backend
        self.answers: Dict[str, dict] = response.get("answers", {})
        self.model: str = response.get("model", request.get("model", ""))
        self.usage: dict = response.get("usage") or {}

    @property
    def input_tokens(self) -> int:
        return int(self.usage.get("input_tokens") or 0)

    @property
    def cost_usd(self) -> float:
        return self.input_tokens * PRICE_PER_INPUT_TOKEN_USD

    def meta(self) -> dict:
        return {
            "model": self.model,
            "latency_ms": round(self.latency_ms, 1),
            "question_count": len(self.request.get("questions", {})),
            "input_tokens": self.input_tokens,
            "output_tokens": int(self.usage.get("output_tokens") or 0),
            "cost_usd": self.cost_usd,
            "backend": self.backend,
        }

    def trace(self) -> dict:
        return {"request": self.request, "response": self.response, "meta": self.meta()}


class SpendGuard:
    """Per-process budget and rate limit for live calls."""

    def __init__(self, budget_usd: float = 2.0, rpm: int = 120):
        self.budget_usd = budget_usd
        self.rpm = rpm
        self.spent_usd = 0.0
        self.live_calls = 0
        self.input_tokens = 0
        self._times: deque = deque()
        self._lock = threading.Lock()

    def check(self) -> None:
        with self._lock:
            if self.budget_usd > 0 and self.spent_usd >= self.budget_usd:
                raise JevError(
                    "This server run has spent its $%.2f budget (%d live calls). Restart it with "
                    "JEV_FSD_BUDGET_USD=<amount> to allow more." % (self.budget_usd, self.live_calls),
                    status=402)
            now = time.monotonic()
            while self._times and self._times[0] < now - 60:
                self._times.popleft()
            if self.rpm > 0 and len(self._times) >= self.rpm:
                raise JevError("Local rate limit: more than %d live calls in the last minute. Wait a moment."
                               % self.rpm, status=429)
            self._times.append(now)

    def record(self, result: JevResult) -> None:
        with self._lock:
            self.live_calls += 1
            self.input_tokens += result.input_tokens
            self.spent_usd += result.cost_usd

    def snapshot(self) -> dict:
        with self._lock:
            return {"budget_usd": self.budget_usd, "spent_usd": self.spent_usd, "live_calls": self.live_calls,
                    "input_tokens": self.input_tokens, "rpm": self.rpm}


class JevClient:
    def __init__(self, settings: Optional[Settings] = None, guard: Optional[SpendGuard] = None,
                 api_key: Optional[str] = None, timeout: float = 30.0):
        self.settings = settings or Settings()
        self.timeout = timeout
        self._memory_key = api_key
        self.guard = guard or SpendGuard(self.settings.budget_usd, self.settings.rpm)
        self._sdk = None
        self._sdk_key: Optional[str] = None
        self._lock = threading.Lock()

    # --- key management ---------------------------------------------------------------------

    @property
    def model(self) -> str:
        return self.settings.model

    @property
    def base_url(self) -> str:
        return self.settings.base_url

    @property
    def api_key(self) -> Optional[str]:
        return self._memory_key or self.settings.api_key

    @property
    def key_source(self) -> Optional[str]:
        if self._memory_key:
            return "memory"
        return self.settings.key_source

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    @property
    def backend(self) -> str:
        return "typesafe-sdk %s" % SDK_VERSION if TypeSafeClient is not None else "stdlib fallback"

    def set_api_key(self, key: Optional[str]) -> None:
        self._memory_key = (key or "").strip() or None

    def reload_settings(self) -> None:
        self.settings.reload_file()

    # --- calls ------------------------------------------------------------------------------

    def system_one(self, state: Any, questions: Dict[str, dict]) -> JevResult:
        payload = {"state": state, "model": self.model, "questions": questions}
        if not self.api_key:
            raise JevError("No TypeSafe API key yet. Add "
                           "TYPESAFE_API_KEY to .env and restart the server.", status=401)
        self.guard.check()
        started = time.perf_counter()
        response = self._post_system_one(payload)
        latency_ms = (time.perf_counter() - started) * 1000
        result = JevResult(payload, response, latency_ms, backend=self.backend)
        self.guard.record(result)
        return result

    def models(self) -> dict:
        if not self.api_key:
            raise JevError("No TypeSafe API key configured.", status=401)
        if TypeSafeClient is not None:
            try:
                return self._sdk_client().models.list().raw_http_response.json()
            except TypeSafeAPIError as err:
                raise JevError(_error_message(err.status, err.body), status=err.status, body=err.body) from err
            except TypeSafeAPIConnectionError as err:
                raise JevError("Could not reach TypeSafe: %s" % err) from err
            except TypeSafeError as err:
                raise JevError(str(err)) from err
        response, _ = self._stdlib_request("GET", "/v1/models", None, max_attempts=2)
        return response

    # --- transports -------------------------------------------------------------------------

    def _sdk_client(self):
        with self._lock:
            key = self.api_key
            if self._sdk is None or self._sdk_key != key:
                self._sdk = TypeSafeClient(api_key=key, model=self.model, base_url=self.base_url,
                                           timeout=self.timeout,
                                           retry=RetryPolicy(max_retries=3, timeout=self.timeout))
                self._sdk_key = key
            return self._sdk

    def _post_system_one(self, payload: dict) -> dict:
        if TypeSafeClient is not None:
            try:
                response = self._sdk_client().system_one(payload["state"], payload["questions"], model=payload["model"])
                return response.raw_http_response.json()
            except TypeSafeAPIError as err:
                raise JevError(_error_message(err.status, err.body), status=err.status, body=err.body) from err
            except TypeSafeAPIConnectionError as err:
                raise JevError("Could not reach TypeSafe: %s" % err) from err
            except TypeSafeError as err:
                raise JevError(str(err)) from err
        response, _ = self._stdlib_request("POST", "/v1/systemone", payload)
        return response

    def _stdlib_request(self, method: str, path: str, body: Optional[dict], max_attempts: int = 4):
        data = json.dumps(body).encode() if body is not None else None
        attempt = 0
        while True:
            attempt += 1
            req = urllib.request.Request(
                self.base_url + path, data=data, method=method,
                headers={"Authorization": "Bearer " + (self.api_key or ""), "Content-Type": "application/json",
                         "User-Agent": "jev-fsd/0.1 (stdlib)"})
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode()), attempt
            except urllib.error.HTTPError as err:
                raw = err.read().decode(errors="replace")
                try:
                    parsed = json.loads(raw)
                except ValueError:
                    parsed = raw
                if err.code in RETRYABLE_STATUSES and attempt < max_attempts:
                    retry_after = err.headers.get("retry-after")
                    delay = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else None
                    time.sleep(delay if delay is not None else (0.4 * 2 ** (attempt - 1)) + random.random() * 0.2)
                    continue
                raise JevError(_error_message(err.code, parsed), status=err.code, body=parsed) from err
            except urllib.error.URLError as err:
                if attempt < max_attempts:
                    time.sleep(0.4 * 2 ** (attempt - 1))
                    continue
                raise JevError("Could not reach TypeSafe: %s" % err.reason) from err


def _error_message(status: int, body: Any) -> str:
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, dict) and detail.get("message"):
        text = detail["message"]
    elif detail:
        text = json.dumps(detail)[:400]
    else:
        text = str(body)[:400]
    if status in (401, 403):
        return "TypeSafe rejected the API key (%s): %s" % (status, text)
    if status == 422:
        return "TypeSafe could not validate the request (422): %s" % text
    if status == 429:
        return "TypeSafe rate limit (429): %s" % text
    return "TypeSafe error %s: %s" % (status, text)


# --- small helpers for building questions ----------------------------------------------


def noul(instructions: Any, yes: Any = None, no: Any = None) -> dict:
    q: dict = {"type": "noul", "instructions": instructions}
    if yes is not None or no is not None:
        q["criteria"] = {"true": yes, "false": no}
    return q


def choice(instructions: Any, criteria: Dict[str, Any]) -> dict:
    return {"type": "choice", "instructions": instructions, "criteria": criteria}


def score(instructions: Any, levels: list) -> dict:
    return {"type": "score", "instructions": instructions, "criteria": levels}


def chosen(answer: dict) -> tuple:
    """(value, probability of that value) for a Choice answer."""
    value = answer["choice"]
    return value, float(answer.get("probabilities", {}).get(value, answer.get("confidence", 0.0)))


def ranked(answer: dict, limit: int = 3) -> list:
    probs = answer.get("probabilities", {})
    return [
        {"value": k, "prob": float(v)}
        for k, v in sorted(probs.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    ]
