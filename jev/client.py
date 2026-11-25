"""The one place Jev FSD talks to TypeSafe.

Uses the official `typesafe-sdk` when it is installed (Python 3.10+). On an older Python the same
requests go through a small stdlib fallback so the demo still runs; the request and response JSON
are identical either way (https://docs.typesafe.ai/api).

Around the call sit two things a demo that spends real money should have:
  * a spend guard (per-run budget and a local rate limit),
  * request/response capture for the "Inspect JSON" drawer, without ever capturing the key.
"""

from __future__ import annotations

import http.client
import json
import math
import random
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from datetime import timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Optional

from . import VERSION
from .config import Settings

try:  # the official SDK needs Python >= 3.10
    import typesafe_sdk
    from typesafe_sdk import RetryPolicy, TypeSafeAPIConnectionError, TypeSafeAPIError, TypeSafeClient, TypeSafeError

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


MAX_USAGE_TOKENS = 10**9
MAX_MODEL_BYTES = 2 * 1024 * 1024
MAX_REPLY_DEPTH = 64


def tokens(value: Any) -> int:
    """A token count from a provider usage block, or zero for invalid counts."""
    return token_count(value) or 0


def token_count(value: Any) -> Optional[int]:
    """Distinguish zero from absent or malformed counts for providers with usage aliases."""
    if isinstance(value, bool) or not isinstance(value, (int, str, float)):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    try:
        count = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return min(MAX_USAGE_TOKENS, count) if count >= 0 else None


def usage_tokens(usage: dict, *fields: str) -> int:
    for field in fields:
        count = token_count(usage.get(field))
        if count is not None:
            return count
    return 0


class JevResult:
    """One System One call: typed answers plus everything the UI shows about the call."""

    def __init__(self, request: dict, response: dict, latency_ms: float, backend: str = ""):
        self.request = request
        # Overflowing provider numbers become null so answers, meta and traces always serialize.
        response = _json_safe(response)
        self.response = response
        self.latency_ms = latency_ms
        self.backend = backend
        answers = response.get("answers")
        self.answers: Dict[str, dict] = answers if isinstance(answers, dict) else {}
        model = response.get("model")
        self.model = (model if isinstance(model, str) and model.strip() else request.get("model", ""))[:200]
        usage = response.get("usage")
        self.usage: dict = usage if isinstance(usage, dict) else {}

    @property
    def input_tokens(self) -> int:
        return usage_tokens(self.usage, "input_tokens", "prompt_tokens")

    @property
    def output_tokens(self) -> int:
        return usage_tokens(self.usage, "output_tokens", "completion_tokens")

    @property
    def cost_usd(self) -> float:
        return self.input_tokens * PRICE_PER_INPUT_TOKEN_USD

    def meta(self) -> dict:
        return {
            "model": self.model,
            "latency_ms": round(self.latency_ms, 1),
            "question_count": len(self.request.get("questions", {})),
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": self.cost_usd,
            "backend": self.backend,
        }

    def trace(self) -> dict:
        return {"request": self.request, "response": self.response, "meta": self.meta()}


def _json_safe(value, depth=0):
    """Copy a provider payload with non-finite numbers replaced by null, so traces always serialize."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if depth >= MAX_REPLY_DEPTH and isinstance(value, (dict, list)):
        return "(nested provider data omitted)"
    if isinstance(value, dict):
        return {key: _json_safe(item, depth + 1) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item, depth + 1) for item in value]
    return value


class SpendGuard:
    """Per-process budget and rate limit for live calls. One guard is shared by Jev and every
    configured LLM endpoint (jev/llm.py), so JEV_FSD_BUDGET_USD and JEV_FSD_RPM cap them together.
    `record` takes any result with `input_tokens` and `cost_usd` (and optionally `output_tokens`)."""

    def __init__(self, budget_usd: float = 2.0, rpm: int = 120):
        self.budget_usd = budget_usd
        self.rpm = rpm
        self.spent_usd = 0.0
        self.live_calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self._times: deque = deque()
        self._lock = threading.Lock()

    def check(self, rate: bool = True) -> None:
        """Raise when the budget is spent or (with `rate`) the per-minute cap is reached."""
        with self._lock:
            if self.budget_usd > 0 and self.spent_usd >= self.budget_usd:
                raise JevError(
                    "This server run has spent its $%.2f budget (%d live calls). Restart it with "
                    "JEV_FSD_BUDGET_USD=<amount> to allow more." % (self.budget_usd, self.live_calls),
                    status=402,
                )
            if not rate or self.rpm <= 0:
                return
            now = time.monotonic()
            while self._times and self._times[0] <= now - 60:
                self._times.popleft()
            if len(self._times) >= self.rpm:
                wait = max(1, math.ceil(self._times[0] + 60 - now))
                raise JevError(
                    "Local rate limit: %d live calls in the last minute. Try again in %d s." % (self.rpm, wait),
                    status=429,
                )
            self._times.append(now)

    def record(self, result) -> None:
        input_tokens = tokens(result.input_tokens)
        output_tokens = tokens(getattr(result, "output_tokens", 0))
        cost_usd = result.cost_usd
        if type(cost_usd) not in (int, float) or not 0 <= cost_usd <= 1e100:
            raise ValueError("result cost must be finite and non-negative")
        with self._lock:
            self.live_calls += 1
            self.input_tokens += input_tokens
            self.output_tokens += output_tokens
            self.spent_usd += cost_usd

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "budget_usd": self.budget_usd,
                "spent_usd": self.spent_usd,
                "live_calls": self.live_calls,
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "rpm": self.rpm,
            }


class JevClient:
    def __init__(
        self,
        settings: Optional[Settings] = None,
        guard: Optional[SpendGuard] = None,
        api_key: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self.settings = settings or Settings()
        if isinstance(timeout, bool) or not 0 < timeout < float("inf"):
            raise ValueError("TypeSafe timeout must be a positive finite number")
        self.timeout = timeout
        self._memory_key = (api_key or "").strip() or None
        self.guard = guard or SpendGuard(self.settings.budget_usd, self.settings.rpm)
        self._sdk = None
        self._sdk_config: Optional[tuple] = None
        self._lock = threading.Lock()

    # Key management

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
        with self._lock:
            self._memory_key = (key or "").strip() or None

    def reload_settings(self) -> None:
        with self._lock:
            self.settings.reload_file()

    def _connection_config(self) -> tuple:
        with self._lock:
            return self.api_key, self.model, self.base_url, self.timeout

    # Calls

    def system_one(self, state: Any, questions: Dict[str, dict]) -> JevResult:
        from .endpoints import headers_for, scrub

        config = self._connection_config()
        key, model, _, _ = config
        payload = {"state": state, "model": model, "questions": questions}
        if not key:
            raise JevError(
                "No TypeSafe API key yet. Paste one in the app (Decision ▾ > Connect a decision "
                "model > TypeSafe), or add TYPESAFE_API_KEY to .env.",
                status=401,
            )
        try:
            headers_for(key)
        except ValueError as err:
            raise JevError(str(err), status=401) from err
        self.guard.check()
        started = time.perf_counter()
        try:
            response = self._post_system_one(payload, config=config)
        except JevError as err:
            raise JevError(scrub(str(err), key), status=err.status, body=scrub(err.body, key)) from None
        if not isinstance(response, dict):
            raise JevError("TypeSafe did not return a JSON object")
        latency_ms = (time.perf_counter() - started) * 1000
        result = JevResult(scrub(payload, key), scrub(response, key), latency_ms, backend=self.backend)
        self.guard.record(result)
        return result

    def models(self) -> dict:
        from .endpoints import headers_for, scrub

        config = self._connection_config()
        key = config[0]
        if not key:
            raise JevError("No TypeSafe API key configured.", status=401)
        try:
            headers_for(key)
            response = self._models(config)
        except ValueError as err:
            raise JevError(str(err), status=401) from err
        except JevError as err:
            raise JevError(scrub(str(err), key), status=err.status, body=scrub(err.body, key)) from None
        if not isinstance(response, dict):
            raise JevError("TypeSafe model list was not a JSON object")
        return scrub(_json_safe(response), key)

    def _models(self, config: tuple) -> dict:
        if TypeSafeClient is not None:
            try:
                return self._sdk_client(config).models.list().raw_http_response.json()
            except TypeSafeAPIError as err:
                raise JevError(
                    _error_message(err.status, err.body, config[0]), status=err.status, body=err.body
                ) from err
            except TypeSafeAPIConnectionError as err:
                raise JevError("Could not reach TypeSafe: %s" % err) from err
            except TypeSafeError as err:
                raise JevError(str(err)) from err
            except (ValueError, RecursionError) as err:
                raise JevError("TypeSafe did not return readable JSON") from err
        response, _ = self._stdlib_request("GET", "/v1/models", None, max_attempts=2, config=config)
        return response

    # Transports

    def _sdk_client(self, config=None):
        config = self._connection_config() if config is None else config
        with self._lock:
            key, model, base_url, timeout = config
            if self._sdk is None or self._sdk_config != config:
                self._sdk = TypeSafeClient(
                    api_key=key,
                    model=model,
                    base_url=base_url,
                    timeout=timeout,
                    retry=RetryPolicy(max_retries=0, timeout=timeout),
                )
                self._sdk_config = config
            return self._sdk

    def _post_system_one(self, payload: dict, *, config: tuple) -> dict:
        key, _, base_url, timeout = config
        if TypeSafeClient is not None:
            try:
                response = self._sdk_client(config).system_one(
                    payload["state"], payload["questions"], model=payload["model"]
                )
                return response.raw_http_response.json()
            except TypeSafeAPIError as err:
                raise JevError(_error_message(err.status, err.body, key), status=err.status, body=err.body) from err
            except TypeSafeAPIConnectionError as err:
                raise JevError("Could not reach TypeSafe: %s" % err) from err
            except TypeSafeError as err:
                raise JevError(str(err)) from err
            except (ValueError, RecursionError) as err:
                raise JevError("TypeSafe did not return readable JSON") from err
        from .endpoints import error_body, post_json

        try:
            reply, _ = post_json(base_url + "/v1/systemone", payload, key, time.monotonic() + timeout)
            return reply if reply is not None else {"note": "TypeSafe reply nested too deeply to parse"}
        except urllib.error.HTTPError as err:
            body = error_body(err)
            raise JevError(_error_message(err.code, body, key), status=err.code, body=body) from err
        except TimeoutError as err:
            raise JevError("TypeSafe did not reply within %g s" % timeout, status=504) from err
        except urllib.error.URLError as err:
            if isinstance(err.reason, TimeoutError):
                raise JevError("TypeSafe did not reply within %g s" % timeout, status=504) from err
            raise JevError("Could not reach TypeSafe: %s" % err.reason) from err
        except (ValueError, OSError, http.client.HTTPException) as err:
            raise JevError("Could not read the TypeSafe reply: %s" % err) from err

    def _stdlib_request(self, method: str, path: str, body: Optional[dict], max_attempts: int = 4, *, config=None):
        from .endpoints import _OPENER, _Watchdog, read_error, read_reply

        data = json.dumps(body, allow_nan=False).encode() if body is not None else None
        key, _, base_url, timeout = self._connection_config() if config is None else config
        attempt = 0
        while True:
            attempt += 1
            req = urllib.request.Request(
                base_url + path,
                data=data,
                method=method,
                headers={
                    "Authorization": "Bearer " + (key or ""),
                    "Content-Type": "application/json",
                    "User-Agent": "jev-fsd/%s (stdlib)" % VERSION,
                },
            )
            try:
                req.watchdog = watchdog = _Watchdog(time.monotonic() + timeout)
                try:
                    with _OPENER.open(req, timeout=timeout) as resp:
                        raw = read_reply(resp, MAX_MODEL_BYTES)
                        late = watchdog.cancel()
                    if late:
                        raise TimeoutError()
                except urllib.error.HTTPError as err:
                    err.body_text = read_error(err)
                    if watchdog.cancel():
                        raise TimeoutError() from err
                    raise
                finally:
                    watchdog.cancel()
                return json.loads(raw.decode("utf-8-sig")), attempt
            except urllib.error.HTTPError as err:
                raw = err.body_text
                try:
                    parsed = json.loads(raw)
                except (ValueError, RecursionError):
                    parsed = raw
                if err.code in RETRYABLE_STATUSES and attempt < max_attempts:
                    delay = retry_delay(err.headers.get("retry-after") if err.headers else None)
                    if delay is None:
                        delay = (0.4 * 2 ** (attempt - 1)) + random.random() * 0.2
                    time.sleep(min(delay, timeout))
                    continue
                raise JevError(_error_message(err.code, parsed, key), status=err.code, body=parsed) from err
            except urllib.error.URLError as err:
                if attempt < max_attempts:
                    time.sleep(min(timeout, 0.4 * 2 ** (attempt - 1)))
                    continue
                raise JevError("Could not reach TypeSafe: %s" % err.reason) from err
            except (ValueError, RecursionError) as err:
                if isinstance(err, ValueError) and str(err).startswith("reply larger"):
                    raise JevError("TypeSafe model list is too large") from err
                raise JevError("TypeSafe did not return readable JSON") from err
            except TimeoutError as err:
                raise JevError("TypeSafe did not list its models within %g s" % timeout, status=504) from err
            except (OSError, http.client.HTTPException) as err:
                raise JevError("Could not read the TypeSafe model list: %s" % err) from err


def retry_delay(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        seconds = float(value)
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            seconds = max(0, parsed.timestamp() - time.time())
        except (TypeError, ValueError, OverflowError, OSError):
            return None
    return seconds if math.isfinite(seconds) and seconds >= 0 else None


def _error_message(status: int, body: Any, key: Optional[str] = None) -> str:
    from .endpoints import scrub

    body = scrub(_json_safe(body), key)
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, dict) and detail.get("message"):
        text = str(detail["message"])[:400]
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
    if status == 402:
        return "TypeSafe account is out of credits (402): %s" % text
    if status == 529:
        return "TypeSafe is overloaded (529): %s" % text
    return "TypeSafe error %s: %s" % (status, text)


# Helpers for building questions


def noul(instructions: Any, yes: Any = None, no: Any = None) -> dict:
    q: dict = {"type": "noul", "instructions": instructions}
    if yes is not None or no is not None:
        q["criteria"] = {"true": yes, "false": no}
    return q


def choice(instructions: Any, criteria: Dict[str, Any]) -> dict:
    return {"type": "choice", "instructions": instructions, "criteria": criteria}


def score(instructions: Any, levels: list) -> dict:
    return {"type": "score", "instructions": instructions, "criteria": levels}


def _probability(value):
    """A probability as a float, or None when the provider sent none or an unusable number."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if 0 <= value <= 1 else None


def chosen(answer: dict) -> tuple:
    """(value, probability of that value) for a Choice answer."""
    value = answer["choice"]
    probabilities = answer.get("probabilities")
    p = _probability(probabilities.get(value)) if isinstance(probabilities, dict) and isinstance(value, str) else None
    if p is None:
        p = _probability(answer.get("confidence"))
    return value, 0.0 if p is None else p


def ranked(answer: dict, limit: int = 3) -> list:
    probabilities = answer.get("probabilities")
    if not isinstance(probabilities, dict) or limit <= 0:
        return []
    probs = [(k, _probability(v)) for k, v in probabilities.items()]
    probs = [(k, p) for k, p in probs if p is not None]
    return [{"value": k, "prob": p} for k, p in sorted(probs, key=lambda kv: kv[1], reverse=True)[:limit]]
