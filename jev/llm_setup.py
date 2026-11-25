"""In-app setup for model endpoints: the "Connect a model" dialog, for LLMs and decision models.

Someone picks a provider, pastes a key, chooses a model and saves, without editing files. The
server does the writing:

- the key goes into `.env` under the provider's usual variable (OPENROUTER_API_KEY, ...). envfile
  refuses unless `.env` is gitignored and untracked, writes atomically and keeps it owner-only. The
  key never goes into an endpoints file and is never sent back to the browser;
- the endpoint goes into the pillar's endpoints file (data/llm-endpoints.json or
  data/decision-endpoints.json), replacing an entry of the same name and keeping the others;
- the registry reloads, so the new driver appears without a restart.

For every preset the browser chooses a *provider*, not a URL, so a saved provider key only ever goes
to that provider. A custom endpoint takes a URL, but its key lives in a variable of its own
(JEV_FSD_LLM_KEY_<NAME>_<hash>, or JEV_FSD_DECISION_KEY_... for decision models), and moving a keyed
custom endpoint to another URL needs the key again: a stored key is never re-pointed at a new server.
These requests pass the same session-token and origin checks as every other POST (jev/security.py).

This module holds the LLM presets and the machinery both pillars share; jev/decision_setup.py holds
the decision-model presets.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import math
import re
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import envfile
from .config import Settings
from .endpoints import (
    MAX_CONFIG_BYTES,
    MAX_PRICE_PER_MTOK,
    _OPENER,
    _Watchdog,
    check_common,
    headers_for,
    is_local_host,
    public_url,
    read_config,
    read_error,
    read_reply,
    scrub,
)
from .llm import EndpointConfig, LlmRegistry

MODELS_TIMEOUT_S = 8.0
MAX_MODELS_BYTES = 16 * 1024 * 1024  # OpenRouter lists hundreds of models with descriptions
MAX_MODELS = 5000
CUSTOM_KEY_PREFIX = "JEV_FSD_LLM_KEY_"

# Anthropic's list prices, USD per million (input, output) tokens, as of November 2026, for filling the
# dialog's price fields. Anthropic's Models API lists no prices. A model missing here leaves the fields
# empty to fill in by hand. Update with https://platform.claude.com/docs/en/about-claude/pricing.
CLAUDE_PRICES = {
    "claude-fable-5-2": (8.0, 40.0),
    "claude-mythos-5-2": (8.0, 40.0),
    "claude-fable-5-1": (10.0, 50.0),
    "claude-mythos-5-1": (10.0, 50.0),
    "claude-fable-5": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-opus-4-6": (5.0, 25.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-5-5": (0.1, 0.5),  # (prompts up to 100K tokens; a driving decision is far below)
    "claude-haiku-4-5": (1.0, 5.0),
}
# The Claude models that take output_config.effort: every listed one but Claude Haiku 4.5, which
# rejects it. Other models (older ones, or ones newer than this list) get no effort default.
CLAUDE_EFFORT_MODELS = tuple(m for m in CLAUDE_PRICES if m != "claude-haiku-4-5")

PROVIDERS = (
    {
        "id": "openrouter",
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "key_url": "https://openrouter.ai/keys",
        "response_format": "json_object",
        "hint": "One key for models from OpenAI, Anthropic, Google, Meta and others. Prices fill in automatically.",
    },
    {
        "id": "anthropic",
        "label": "Claude Platform",
        "base_url": "https://api.anthropic.com/v1",
        "api": "anthropic",
        "key_env": "ANTHROPIC_API_KEY",
        "key_url": "https://platform.claude.com/settings/keys",
        "timeout_s": 20,
        # Defaults for a new entry; an entry saved before keeps its own. Thinking tokens count toward
        # max_tokens, and low effort keeps a driving decision quick.
        "max_tokens": 2048,
        "extra_body": {"output_config": {"effort": "low"}},
        "extra_body_models": CLAUDE_EFFORT_MODELS,  # (extra_body only for these models)
        "hint": "Claude models through Anthropic's own API, billed to your Claude Platform credits. "
        "Prices fill in for current models.",
    },
    {
        "id": "openai",
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "key_env": "OPENAI_API_KEY",
        "key_url": "https://platform.openai.com/api-keys",
        "token_field": "max_completion_tokens",
        "system_role": "developer",
        "system_role_models": re.compile(r"^(?:gpt-[5-9](?:[.-]|$)|o[1-9](?:-|$))"),
        "temperature": None,
        "temperature_models": re.compile(r"^(?:gpt-[5-9](?:[.-]|$)|o[1-9](?:-|$))"),
        "hint": "Prices are not listed by OpenAI's API; add them to count spend against the budget.",
    },
    {
        "id": "gemini",
        "label": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "key_env": "GEMINI_API_KEY",
        "key_url": "https://aistudio.google.com/apikey",
        "timeout_s": 20,
        # Gemini 3 and later always think; low effort keeps a decision quick, and the larger max_tokens
        # leaves room in case thinking counts toward it (Google's compatibility docs do not say).
        "max_tokens": 2048,
        "extra_body": {"reasoning_effort": "low"},
        "extra_body_models": re.compile(r"^gemini-(?:2\.5|[3-9])(?:[.-]|$)"),
        "hint": "Gemini through Google's OpenAI-compatible endpoint (in beta). Add prices to count spend "
        "against the budget.",
    },
    {
        "id": "xai",
        "label": "xAI",
        "base_url": "https://api.x.ai/v1",
        "key_env": "XAI_API_KEY",
        "key_url": "https://console.x.ai/team/default/api-keys",
        "timeout_s": 20,
        # Grok's reasoning cannot be turned off and defaults to high; low keeps a decision quick. A model
        # without reasoning may refuse the setting: remove extra_body from its entry.
        "extra_body": {"reasoning_effort": "low"},
        "extra_body_models": re.compile(r"^grok-(?:3-mini|4\.[3-9])(?:-|$)"),
        "hint": "Grok models. Add prices to count spend against the budget.",
    },
    {
        "id": "mistral",
        "label": "Mistral",
        "base_url": "https://api.mistral.ai/v1",
        "key_env": "MISTRAL_API_KEY",
        "key_url": "https://console.mistral.ai/api-keys",
        "timeout_s": 20,
        "hint": "Mistral's models from its own API. Add prices to count spend against the budget.",
    },
    {
        "id": "groq",
        "label": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "key_url": "https://console.groq.com/keys",
        "response_format": "json_object",
        "token_field": "max_completion_tokens",
        "hint": "Fast hosted open models.",
    },
    {
        "id": "ollama",
        "label": "Ollama",
        "base_url": "http://localhost:11434/v1",
        "timeout_s": 20,
        "rpm": 0,
        "hint": "Free, on this computer. Install Ollama, run `ollama pull llama3.2`, and keep it running.",
    },
    {
        "id": "lmstudio",
        "label": "LM Studio",
        "base_url": "http://localhost:1234/v1",
        "timeout_s": 20,
        "rpm": 0,
        "hint": "Free, on this computer. Load a model and start LM Studio's local server.",
    },
    {
        "id": "custom",
        "label": "Other",
        "base_url": None,
        "hint": "Any server that speaks the OpenAI Chat Completions protocol (vLLM, Together, a proxy, ...).",
    },
)
_lock = threading.Lock()


class SetupError(ValueError):
    pass


class SetupAuthError(SetupError):
    pass


class Pillar:
    """What differs between LLM and decision-model setup: the presets, the endpoints file, how an
    entry is validated, where custom keys live, and which preset fields are copied into an entry."""

    def __init__(
        self,
        *,
        prefix: str,
        providers: tuple,
        path: Callable[[Settings], Any],
        validate: Callable[[dict, str, List[str]], Any],
        key_prefix: str,
        preset_fields: Tuple[str, ...],
        reserved: Callable[[Settings, str], Optional[str]] = lambda settings, name: None,
        default_fields: Tuple[str, ...] = (),
    ):
        self.prefix, self.providers, self.path, self.validate = prefix, providers, path, validate
        self.key_prefix, self.preset_fields, self.reserved = key_prefix, preset_fields, reserved
        # (preset_fields always come from the preset; default_fields only where the entry has none)
        self.default_fields = default_fields
        self.by_id = {p["id"]: p for p in providers}

    def provider(self, pid: Any) -> dict:
        p = self.by_id.get(pid) if isinstance(pid, str) else None
        if p is None:
            raise SetupError("Choose a provider: %s." % ", ".join(self.by_id))
        return p

    def providers_public(self, settings: Settings) -> List[dict]:
        """The presets for the dialog. Says whether a key is already saved, never what it is."""
        out = []
        for p in self.providers:
            key_env = p.get("key_env")
            out.append(
                {
                    "id": p["id"],
                    "label": p["label"],
                    "hint": p["hint"],
                    "key_url": p.get("key_url"),
                    "base_url": p["base_url"],
                    "local": bool(p["base_url"] and is_local_host(p["base_url"])),
                    "needs_key": bool(key_env),
                    "key_env": key_env,
                    "key_set": bool(key_env and settings.get(key_env)),
                }
            )
        return out

    def custom_key_env(self, name: str) -> str:
        """<prefix><NAME>_<hash>: one variable per endpoint name. The hash keeps names that differ only
        in '-' versus '_' (lab-1, lab_1) apart, so one endpoint's key never reaches another's URL."""
        return "%s%s_%s" % (
            self.key_prefix,
            name.upper().replace("-", "_"),
            hashlib.sha256(name.encode()).hexdigest()[:8].upper(),
        )


def _reserved_llm_name(settings: Settings, name: str) -> Optional[str]:
    if settings.get("JEV_FSD_LLM_BASE_URL") and name == settings.get("JEV_FSD_LLM_NAME", "default"):
        return "%r is the endpoint set by JEV_FSD_LLM_* in .env; choose another name." % name
    return None


LLM = Pillar(
    prefix="llm:",
    providers=PROVIDERS,
    path=lambda s: s.llm_endpoints_path,
    validate=EndpointConfig,
    key_prefix=CUSTOM_KEY_PREFIX,
    preset_fields=("api", "response_format", "timeout_s", "rpm"),
    reserved=_reserved_llm_name,
    default_fields=("max_tokens", "extra_body", "token_field", "system_role", "temperature"),
)


def providers_public(settings: Settings) -> List[dict]:
    return LLM.providers_public(settings)


def public(settings: Settings, registry: LlmRegistry) -> dict:
    """The /api/status `llm` block: configured endpoints, config problems and the setup presets."""
    return {**registry.public(), "providers": providers_public(settings)}


def slug(model: str) -> str:
    """'openai/gpt-6-luna' -> 'gpt-6-luna': a valid endpoint name derived from the model id."""
    tail = model.rsplit("/", 1)[-1].lower()
    name = re.sub(r"[^a-z0-9_-]+", "-", tail).strip("-_")[:32].strip("-_")
    return name if re.match(r"^[a-z0-9]", name) else ""


def custom_key_env(name: str) -> str:
    return LLM.custom_key_env(name)


def _free_name(entries: list, name: str, model: str, base_url: str) -> str:
    """A name derived from the model id must not take over a different saved model: lab/gpt-4o-mini and
    gpt-4o.mini both slug to gpt-4o-mini. The same model on the same server keeps its name (an update)."""
    taken = {}
    for entry in entries:
        if isinstance(entry, dict) and isinstance(entry.get("name"), str):
            taken.setdefault(entry["name"], entry)
    candidate, n = name, 2
    while candidate in taken and (
        taken[candidate].get("model") != model or not _same_server(taken[candidate], base_url)
    ):
        suffix = "-%d" % n
        candidate, n = name[: 32 - len(suffix)].rstrip("-_") + suffix, n + 1
    return candidate


def text(body: dict, field: str, limit: int = 300) -> str:
    value = body.get(field)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise SetupError("%s must be text" % field)
    if len(value) > limit:
        raise SetupError("%s must be at most %d characters" % (field, limit))
    if not all(ch.isprintable() for ch in value.strip()):
        raise SetupError("%s must contain printable text" % field)
    return value.strip()


def _price(body: dict, field: str) -> Optional[float]:
    value = body.get(field)
    if value in (None, ""):
        return None
    try:
        if isinstance(value, bool):
            raise TypeError()
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        raise SetupError("%s must be a number of USD per million tokens" % field)
    if not math.isfinite(number) or not 0 <= number <= MAX_PRICE_PER_MTOK:
        raise SetupError("%s must be between 0 and %d USD per million tokens" % (field, MAX_PRICE_PER_MTOK))
    return number


def _read_file(pillar: Pillar, settings: Settings) -> dict:
    path = pillar.path(settings)
    try:
        data = read_config(path)
    except FileNotFoundError:
        return {
            "_comment": "Written by the app's Connect a model dialog; edit freely. Keys live in .env, "
            "never here. See docs/agents.md.",
            "endpoints": [],
        }
    except (OSError, ValueError, RecursionError) as err:
        raise SetupError("%s could not be read (%s); fix or delete it first." % (path.name, err))
    if isinstance(data, list):
        data = {"endpoints": data}
    if not isinstance(data, dict) or not isinstance(data.get("endpoints"), list):
        raise SetupError('%s must contain {"endpoints": [...]}; fix or delete it first.' % path.name)
    return data


def _restore_file(path, before: Optional[str]) -> None:
    if before is None:
        path.unlink(missing_ok=True)
    else:
        envfile._atomic_write(path, before)


def _write_file(pillar: Pillar, settings: Settings, data: dict) -> None:
    path = pillar.path(settings)
    try:
        encoded = json.dumps(data, indent=2) + "\n"
        if len(encoded.encode("utf-8")) > MAX_CONFIG_BYTES:
            raise ValueError("endpoints file would exceed %d bytes" % MAX_CONFIG_BYTES)
        path.parent.mkdir(parents=True, exist_ok=True)
        envfile._atomic_write(path, encoded)
    except (OSError, ValueError) as err:
        raise SetupError(
            "Could not save %s: %s" % (path.name, err.strerror if isinstance(err, OSError) else err)
        ) from err


def write_key(settings: Settings, key_env: str, key: str) -> List[str]:
    """Save a typed key to .env. Returns notes for the dialog (a shell variable that wins over .env)."""
    try:
        envfile.write_key(settings.env_file.parent, key, settings.env_file.name, var=key_env)
    except envfile.EnvFileError as err:
        raise SetupError("The key was not saved: %s" % err)
    except (OSError, UnicodeError) as err:
        raise SetupError("The key file could not be read or written.") from err
    if settings.environ.get(key_env):
        return [
            "%s is also set in the shell that started the server, and that value wins over .env. "
            "Unset it and restart to use the key you just saved." % key_env
        ]
    return []


def probe_url(base_url: str, keyed: bool) -> str:
    """Validate a URL with the same rules as a saved endpoint (http(s), no credentials, https for keys)."""
    problems: List[str] = []
    common = check_common(
        {"name": "probe", "base_url": base_url, "model": "probe", "api_key_env": "PROBE_KEY" if keyed else None},
        "endpoint",
        problems,
        "https://example.com/v1",
        "API_KEY",
    )
    if common is None:
        raise SetupError(problems[0].replace("endpoint 'probe': ", ""))
    return common["base_url"]


def base_url_for(p: dict, body: dict) -> str:
    return p["base_url"] or text(body, "base_url", 500).rstrip("/")


def _same_server(entry: dict, base_url: str) -> bool:
    return str(entry.get("base_url") or "").strip().rstrip("/") == base_url


def catalog_key(settings: Settings, provider: dict, body: dict) -> Optional[str]:
    key_env = provider.get("key_env")
    key = text(body, "api_key", 512) or (settings.get(key_env) if key_env else None)
    if key_env and not key and provider["id"] not in ("openrouter", "typesafe"):
        raise SetupAuthError("Paste your %s API key to list its models." % provider["label"])
    return key


def _error_message(body: str) -> str:
    """The message in a JSON error reply: OpenAI-style error.message, Google's, xAI's "error" string,
    Mistral's "detail", or a top-level "message". Empty when there is none."""
    try:
        data = json.loads(body)
    except (ValueError, RecursionError):
        return ""
    if not isinstance(data, dict):
        return ""
    error = data.get("error")
    for value in (error.get("message") if isinstance(error, dict) else error, data.get("detail"), data.get("message")):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def fetch_json(url: str, key: Optional[str], label: str, timeout_s: float, api: str = "openai") -> Any:
    """GET a model list for the dialog, with one total deadline: a socket timeout bounds each read, so
    a server that trickles its reply could otherwise hold this request open indefinitely. Costs nothing."""
    where = public_url(url)
    try:
        req = urllib.request.Request(url, headers=headers_for(key, api=api))
    except ValueError as err:
        raise SetupError(str(err)) from err
    req.watchdog = watchdog = _Watchdog(time.monotonic() + timeout_s)
    late = SetupError("%s did not send its model list within %g s." % (where, timeout_s))
    try:
        with _OPENER.open(req, timeout=timeout_s) as resp:
            raw = read_reply(resp, MAX_MODELS_BYTES)
            expired = watchdog.cancel()  # stop it before closing: a slow close is not a late list
        if expired:  # the socket was shut mid-reply, so the list may be cut short
            raise late
    except urllib.error.HTTPError as err:
        body = read_error(err)
        if watchdog.cancel():
            raise late
        if err.code in (401, 403):
            raise SetupAuthError("%s rejected the key (HTTP %d). Check it and try again." % (label, err.code))
        if err.code == 429:
            raise SetupError("%s limited model list requests (HTTP 429). Wait and try again." % label)
        if err.code in (404, 405):
            raise SetupError(
                "%s does not offer model listing here (HTTP %d). Enter the model id manually." % (where, err.code)
            )
        # (Google and xAI answer a wrong key with 400, so their own words say what went wrong)
        # (scrubbed before it is shortened, so a key cut in two cannot leave its first half behind)
        said = scrub(_error_message(body), key)[:200] or err.reason
        raise SetupError(scrub("%s answered HTTP %d: %s" % (where, err.code, said), key))
    except ValueError as err:
        if watchdog.cancel():
            raise late
        raise SetupError("Could not read the model list from %s: %s" % (where, err)) from err
    except (urllib.error.URLError, OSError, http.client.HTTPException) as err:
        if watchdog.cancel():
            raise late
        reason = getattr(err, "reason", err)
        local = " Is it running?" if is_local_host(url) else ""
        raise SetupError(scrub("Could not reach %s: %s.%s" % (where, reason, local), key))
    finally:
        watchdog.cancel()
    try:
        return json.loads(raw.decode("utf-8-sig"))
    except (ValueError, RecursionError):
        raise SetupError("%s did not return a JSON model list." % where)


def parse_models(
    data: Any, prices_by_id: bool = False, secret: Optional[str] = None, modality: Optional[str] = None
) -> List[dict]:
    """{data: [...]} or a bare list -> [{id, name?, price_per_mtok_input?, price_per_mtok_output?,
    context_length?}], sorted by id. OpenRouter's per-token prices become USD per million tokens.
    Anthropic's list has no prices, so with `prices_by_id` they come from CLAUDE_PRICES."""
    items = data.get("data") if isinstance(data, dict) else data
    if isinstance(data, dict) and not isinstance(items, list):
        items = data.get("models")
    if not isinstance(items, list):
        raise SetupError("Provider reply has no model list. Enter the model id manually.")
    models = []
    seen = set()
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not 0 < len(item["id"]) <= 200:
            continue
        model_id = item["id"]
        if not model_id.strip() or model_id in seen:
            continue
        if not model_id.isprintable() or model_id != model_id.strip():
            continue
        architecture = item.get("architecture")
        outputs = architecture.get("output_modalities") if isinstance(architecture, dict) else None
        if modality is not None and isinstance(outputs, list) and modality not in outputs:
            continue
        seen.add(model_id)
        model: Dict[str, Any] = {"id": scrub(model_id, secret)}
        for field in ("name", "display_name"):
            name = item.get(field)
            if isinstance(name, str) and name.strip() and name.strip().isprintable():
                model["name"] = scrub(name.strip(), secret)[:120]
                break
        pricing = item.get("pricing")
        if isinstance(pricing, dict):  # OpenRouter: USD per token, as strings
            try:
                prompt, completion = pricing["prompt"], pricing["completion"]
                if isinstance(prompt, bool) or isinstance(completion, bool):
                    raise TypeError()
                prices = (float(prompt) * 1e6, float(completion) * 1e6)
                if all(0 <= v < 1e6 for v in prices):
                    model["price_per_mtok_input"], model["price_per_mtok_output"] = (round(v, 6) for v in prices)
            except (KeyError, TypeError, ValueError, OverflowError):
                pass
        listed = CLAUDE_PRICES.get(item["id"]) if prices_by_id else None
        if listed:
            model["price_per_mtok_input"], model["price_per_mtok_output"] = listed
        for field in ("context_length", "max_input_tokens"):
            context = item.get(field)
            if type(context) is int and 0 < context <= 1_000_000_000:
                model["context_length"] = context
                break
        models.append(model)
        if len(models) >= MAX_MODELS:
            break
    models.sort(key=lambda m: (m["id"].lower(), m["id"]))
    return models


def list_models(settings: Settings, body: dict) -> dict:
    """GET {base_url}/models for the dialog's model picker, with OpenRouter's per-token prices.

    Uses the key typed into the dialog, else the provider's saved key. Costs nothing."""
    p = LLM.provider(body.get("provider"))
    key = catalog_key(settings, p, body)
    base_url = probe_url(base_url_for(p, body), keyed=bool(key))
    api = p.get("api", "openai")
    # (Anthropic's list is paged, 20 to a page by default; one page of 1000 holds every model)
    url = base_url + ("/models?limit=1000" if api == "anthropic" else "/models")
    data = fetch_json(url, key, p["label"], MODELS_TIMEOUT_S, api)
    return {
        "provider": p["id"],
        "endpoint": public_url(base_url),
        "models": parse_models(
            data, prices_by_id=api == "anthropic", secret=key, modality="text" if p["id"] == "openrouter" else None
        ),
    }


def save_endpoint(pillar: Pillar, settings: Settings, registry, body: dict) -> dict:
    """Write the key (if one was typed) to .env and the endpoint to the pillar's endpoints file, then reload."""
    p = pillar.provider(body.get("provider"))
    model = text(body, "model", 200)
    if not model:
        raise SetupError("Choose a model.")
    explicit = text(body, "name", 40).lower()
    key = text(body, "api_key", 512)
    base_url = probe_url(base_url_for(p, body), keyed=bool(key or p.get("key_env")))
    with _lock:
        data = _read_file(pillar, settings)
        entries = data["endpoints"]
        name = explicit or _free_name(entries, slug(model) or p["id"], model, base_url)
        existing = next((e for e in entries if isinstance(e, dict) and e.get("name") == name), None)
        reserved = pillar.reserved(settings, name)
        if reserved:
            raise SetupError(reserved)
        if p.get("key_env"):
            key_env = p["key_env"]
            if not key and not settings.get(key_env):
                raise SetupError("Paste your %s API key." % p["label"])
        else:  # local or custom: a key is optional and, for custom, private to this endpoint
            key_env = None
            kept = existing.get("api_key_env") if existing else None
            if key:
                key_env = pillar.custom_key_env(name)
                if any(
                    isinstance(e, dict) and e.get("api_key_env") == key_env and e.get("name") != name for e in entries
                ):
                    raise SetupError("%s is already used by another endpoint; choose another name." % key_env)
            elif isinstance(kept, str) and kept.startswith(pillar.key_prefix) and settings.get(kept):
                if not _same_server(existing, base_url):
                    raise SetupError("This endpoint's saved key is not sent to a new URL. Paste the key again.")
                key_env = kept
        same_server = existing is not None and _same_server(existing, base_url)
        same_model = same_server and existing.get("model") == model
        raw: Dict[str, Any] = {
            "name": name,
            "label": (
                text(body, "label", 60)
                or (existing.get("label") if same_model else None)
                or "%s (%s)" % (model.rsplit("/", 1)[-1], p["label"])
            ),
            "base_url": base_url,
            "model": model,
        }
        if key_env:
            raw["api_key_env"] = key_env
        for field in pillar.preset_fields:
            if field in p:
                if same_server and field in ("timeout_s", "rpm", "response_format") and field in existing:
                    continue
                raw[field] = p[field]
        for field in ("price_per_mtok_input", "price_per_mtok_output"):
            price = _price(body, field)
            if price is not None:
                raw[field] = price
        if same_server:
            # Same server: keep hand-edited options the dialog does not show (extra_body, max_tokens, ...).
            # A different server starts fresh, so one provider's rpm or timeout never carries over.
            raw = {**{k: v for k, v in existing.items() if k not in ("api_key_env",)}, **raw}
            for field in ("price_per_mtok_input", "price_per_mtok_output"):
                if body.get(field) in (None, "") and (field in body or not same_model):
                    raw.pop(field, None)
        for field in pillar.default_fields:
            if field not in p:
                continue
            supported = p.get(field + "_models", (model,))
            fits = bool(supported.match(model)) if isinstance(supported, re.Pattern) else model in supported
            if fits:
                raw.setdefault(field, p[field])
            elif field in raw and raw[field] == p[field]:
                # the preset's default, kept from a model that took it, would break this one
                del raw[field]
        problems: List[str] = []
        if not pillar.validate(raw, "endpoint %r" % name, problems).ok or problems:
            raise SetupError(problems[0])
        if existing:
            # Setup edits the same first definition the registry uses.
            entries[entries.index(existing)] = raw
        else:
            entries.append(raw)
        path = pillar.path(settings)
        try:
            before = path.read_text(encoding="utf-8") if key and path.exists() else None
        except (OSError, UnicodeError) as err:
            raise SetupError("Could not back up %s before saving the key." % path.name) from err
        _write_file(pillar, settings, data)
        try:
            notes = write_key(settings, key_env, key) if key else []
        except SetupError:
            try:
                _restore_file(path, before)
            except OSError as err:
                raise SetupError("The key could not be saved and %s could not be restored." % path.name) from err
            raise
        registry.reload()
    return {"saved": name, "id": pillar.prefix + name, "notes": notes}


def remove_endpoint(pillar: Pillar, settings: Settings, registry, body: dict) -> dict:
    """Delete an endpoint from the endpoints file. A custom endpoint's private key goes too; a
    provider key stays in .env, since other endpoints or tools may use it."""
    name = text(body, "name", 40)
    if not name:
        raise SetupError("Choose an endpoint to remove.")
    with _lock:
        data = _read_file(pillar, settings)
        entries = data["endpoints"]
        existing = next((e for e in entries if isinstance(e, dict) and e.get("name") == name), None)
        if existing is None:
            raise SetupError(
                "%r is not in %s; only models saved there can be removed here." % (name, pillar.path(settings).name)
            )
        # Removing the endpoint should also remove any definitions shadowed by the first entry.
        entries[:] = [entry for entry in entries if not isinstance(entry, dict) or entry.get("name") != name]
        _write_file(pillar, settings, data)
        key_env = str(existing.get("api_key_env") or "")
        if key_env.startswith(pillar.key_prefix) and not any(
            isinstance(e, dict) and e.get("api_key_env") == key_env for e in entries
        ):
            try:
                envfile.forget_key(settings.env_file.parent, settings.env_file.name, var=key_env)
            except (OSError, UnicodeError) as err:
                registry.reload()
                raise SetupError("Endpoint removed, but its private key could not be removed from .env.") from err
        registry.reload()
    return {"removed": name}


def save(settings: Settings, registry: LlmRegistry, body: dict) -> dict:
    return {**save_endpoint(LLM, settings, registry, body), "llm": public(settings, registry)}


def remove(settings: Settings, registry: LlmRegistry, body: dict) -> dict:
    return {**remove_endpoint(LLM, settings, registry, body), "llm": public(settings, registry)}
