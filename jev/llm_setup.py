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
import re
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import envfile
from .config import Settings
from .endpoints import _OPENER, _Watchdog, check_common, headers_for, is_local_host, public_url, scrub
from .llm import EndpointConfig, LlmRegistry

MODELS_TIMEOUT_S = 8.0
MAX_MODELS_BYTES = 16 * 1024 * 1024   # OpenRouter lists hundreds of models with descriptions
MAX_MODELS = 5000
CUSTOM_KEY_PREFIX = "JEV_FSD_LLM_KEY_"

PROVIDERS = (
    {"id": "openrouter", "label": "OpenRouter", "base_url": "https://openrouter.ai/api/v1",
     "key_env": "OPENROUTER_API_KEY", "key_url": "https://openrouter.ai/keys", "response_format": "json_object",
     "hint": "One key for models from OpenAI, Anthropic, Google, Meta and others. Prices fill in automatically."},
    {"id": "openai", "label": "OpenAI", "base_url": "https://api.openai.com/v1",
     "key_env": "OPENAI_API_KEY", "key_url": "https://platform.openai.com/api-keys",
     "hint": "Prices are not listed by OpenAI's API; add them to count spend against the budget."},
    {"id": "groq", "label": "Groq", "base_url": "https://api.groq.com/openai/v1",
     "key_env": "GROQ_API_KEY", "key_url": "https://console.groq.com/keys", "response_format": "json_object",
     "hint": "Fast hosted open models."},
    {"id": "ollama", "label": "Ollama", "base_url": "http://localhost:11434/v1", "timeout_s": 20, "rpm": 0,
     "hint": "Free, on this computer. Install Ollama, run `ollama pull llama3.2`, and keep it running."},
    {"id": "lmstudio", "label": "LM Studio", "base_url": "http://localhost:1234/v1", "timeout_s": 20, "rpm": 0,
     "hint": "Free, on this computer. Load a model and start LM Studio's local server."},
    {"id": "custom", "label": "Other", "base_url": None,
     "hint": "Any server that speaks the OpenAI Chat Completions protocol (vLLM, Together, a proxy, ...)."},
)
_lock = threading.Lock()


class SetupError(ValueError):
    pass


class Pillar:
    """What differs between LLM and decision-model setup: the presets, the endpoints file, how an
    entry is validated, where custom keys live, and which preset fields are copied into an entry."""

    def __init__(self, *, prefix: str, providers: tuple, path: Callable[[Settings], Any],
                 validate: Callable[[dict, str, List[str]], Any], key_prefix: str, preset_fields: Tuple[str, ...],
                 reserved: Callable[[Settings, str], Optional[str]] = lambda settings, name: None):
        self.prefix, self.providers, self.path, self.validate = prefix, providers, path, validate
        self.key_prefix, self.preset_fields, self.reserved = key_prefix, preset_fields, reserved
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
            out.append({
                "id": p["id"], "label": p["label"], "hint": p["hint"], "key_url": p.get("key_url"),
                "base_url": p["base_url"], "local": bool(p["base_url"] and is_local_host(p["base_url"])),
                "needs_key": bool(key_env), "key_env": key_env, "key_set": bool(key_env and settings.get(key_env)),
            })
        return out

    def custom_key_env(self, name: str) -> str:
        """<prefix><NAME>_<hash>: one variable per endpoint name. The hash keeps names that differ only
        in '-' versus '_' (lab-1, lab_1) apart, so one endpoint's key never reaches another's URL."""
        return "%s%s_%s" % (self.key_prefix, name.upper().replace("-", "_"), hashlib.sha256(name.encode()).hexdigest()[:8].upper())


def _reserved_llm_name(settings: Settings, name: str) -> Optional[str]:
    if settings.get("JEV_FSD_LLM_BASE_URL") and name == settings.get("JEV_FSD_LLM_NAME", "default"):
        return "%r is the endpoint set by JEV_FSD_LLM_* in .env; choose another name." % name
    return None


LLM = Pillar(prefix="llm:", providers=PROVIDERS, path=lambda s: s.llm_endpoints_path, validate=EndpointConfig,
             key_prefix=CUSTOM_KEY_PREFIX, preset_fields=("response_format", "timeout_s", "rpm"), reserved=_reserved_llm_name)


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
    taken = {e.get("name"): e for e in entries if isinstance(e, dict)}
    candidate, n = name, 2
    while candidate in taken and (taken[candidate].get("model") != model
                                  or str(taken[candidate].get("base_url") or "").rstrip("/") != base_url):
        suffix = "-%d" % n
        candidate, n = name[:32 - len(suffix)].rstrip("-_") + suffix, n + 1
    return candidate


def text(body: dict, field: str, limit: int = 300) -> str:
    value = body.get(field)
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > limit:
        raise SetupError("%s must be text" % field)
    return value.strip()


def _price(body: dict, field: str) -> Optional[float]:
    value = body.get(field)
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise SetupError("%s must be a number of USD per million tokens" % field)
    return number


def _read_file(pillar: Pillar, settings: Settings) -> dict:
    path = pillar.path(settings)
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        return {"_comment": "Written by the app's Connect a model dialog; edit freely. Keys live in .env, "
                            "never here. See docs/agents.md.", "endpoints": []}
    except (OSError, ValueError) as err:
        raise SetupError("%s could not be read (%s); fix or delete it first." % (path.name, err))
    if isinstance(data, list):
        data = {"endpoints": data}
    if not isinstance(data, dict) or not isinstance(data.get("endpoints"), list):
        raise SetupError("%s must contain {\"endpoints\": [...]}; fix or delete it first." % path.name)
    return data


def _write_file(pillar: Pillar, settings: Settings, data: dict) -> None:
    path = pillar.path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    envfile._atomic_write(path, json.dumps(data, indent=2) + "\n")


def write_key(settings: Settings, key_env: str, key: str) -> List[str]:
    """Save a typed key to .env. Returns notes for the dialog (a shell variable that wins over .env)."""
    try:
        envfile.write_key(settings.env_file.parent, key, settings.env_file.name, var=key_env)
    except envfile.EnvFileError as err:
        raise SetupError("The key was not saved: %s" % err)
    if settings.environ.get(key_env):
        return ["%s is also set in the shell that started the server, and that value wins over .env. "
                "Unset it and restart to use the key you just saved." % key_env]
    return []


def probe_url(base_url: str, keyed: bool) -> str:
    """Validate a URL with the same rules as a saved endpoint (http(s), no credentials, https for keys)."""
    problems: List[str] = []
    common = check_common({"name": "probe", "base_url": base_url, "model": "probe", "api_key_env": "PROBE_KEY" if keyed else None},
                          "endpoint", problems, "https://example.com/v1", "API_KEY")
    if common is None:
        raise SetupError(problems[0].replace("endpoint 'probe': ", ""))
    return common["base_url"]


def base_url_for(p: dict, body: dict) -> str:
    return p["base_url"] or text(body, "base_url", 500).rstrip("/")


def fetch_json(url: str, key: Optional[str], label: str, timeout_s: float) -> Any:
    """GET a model list for the dialog, with one total deadline: a socket timeout bounds each read, so
    a server that trickles its reply could otherwise hold this request open indefinitely. Costs nothing."""
    where = public_url(url)
    req = urllib.request.Request(url, headers=headers_for(key))
    req.watchdog = watchdog = _Watchdog(time.monotonic() + timeout_s)
    late = SetupError("%s did not send its model list within %g s." % (where, timeout_s))
    try:
        with _OPENER.open(req, timeout=timeout_s) as resp:
            raw = resp.read(MAX_MODELS_BYTES + 1)
            expired = watchdog.cancel()   # stop it before closing: a slow close is not a late list
        if expired:   # the socket was shut mid-reply, so the list may be cut short
            raise late
    except urllib.error.HTTPError as err:
        err.close()
        if watchdog.cancel():
            raise late
        if err.code in (401, 403):
            raise SetupError("%s rejected the key (HTTP %d). Check it and try again." % (label, err.code))
        raise SetupError(scrub("%s answered HTTP %d: %s" % (where, err.code, err.reason), key))
    except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as err:
        if watchdog.cancel():
            raise late
        reason = getattr(err, "reason", err)
        local = " Is it running?" if is_local_host(url) else ""
        raise SetupError(scrub("Could not reach %s: %s.%s" % (where, reason, local), key))
    finally:
        watchdog.cancel()
    if len(raw) > MAX_MODELS_BYTES:
        raise SetupError("The model list from %s is too large." % where)
    try:
        return json.loads(raw.decode("utf-8", errors="replace"))
    except (ValueError, RecursionError):
        raise SetupError("%s did not return a JSON model list." % where)


def parse_models(data: Any) -> List[dict]:
    """{data: [...]} or a bare list -> [{id, name?, price_per_mtok_input?, price_per_mtok_output?,
    context_length?}], sorted by id. OpenRouter's per-token prices become USD per million tokens."""
    items = data.get("data", data.get("models")) if isinstance(data, dict) else data
    models = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not 0 < len(item["id"]) <= 200:
            continue
        model: Dict[str, Any] = {"id": item["id"]}
        if isinstance(item.get("name"), str):
            model["name"] = item["name"][:120]
        pricing = item.get("pricing")
        if isinstance(pricing, dict):   # OpenRouter: USD per token, as strings
            try:
                prices = (float(pricing["prompt"]) * 1e6, float(pricing["completion"]) * 1e6)
                if all(0 <= v < 1e6 for v in prices):
                    model["price_per_mtok_input"], model["price_per_mtok_output"] = (round(v, 6) for v in prices)
            except (KeyError, TypeError, ValueError):
                pass
        context = item.get("context_length")
        if isinstance(context, int) and not isinstance(context, bool) and context > 0:
            model["context_length"] = context
        models.append(model)
        if len(models) >= MAX_MODELS:
            break
    models.sort(key=lambda m: m["id"].lower())
    return models


def list_models(settings: Settings, body: dict) -> dict:
    """GET {base_url}/models for the dialog's model picker, with OpenRouter's per-token prices.

    Uses the key typed into the dialog, else the provider's saved key. Costs nothing."""
    p = LLM.provider(body.get("provider"))
    key = text(body, "api_key", 512) or (settings.get(p["key_env"]) if p.get("key_env") else None)
    base_url = probe_url(base_url_for(p, body), keyed=bool(key))
    data = fetch_json(base_url + "/models", key, p["label"], MODELS_TIMEOUT_S)
    return {"provider": p["id"], "endpoint": public_url(base_url), "models": parse_models(data)}


def save_endpoint(pillar: Pillar, settings: Settings, registry, body: dict) -> dict:
    """Write the key (if one was typed) to .env and the endpoint to the pillar's endpoints file, then reload."""
    p = pillar.provider(body.get("provider"))
    model = text(body, "model", 200)
    if not model:
        raise SetupError("Choose a model.")
    explicit = text(body, "name", 40).lower()
    base_url = base_url_for(p, body)
    key = text(body, "api_key", 512)
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
        else:   # local or custom: a key is optional and, for custom, private to this endpoint
            key_env = None
            kept = existing.get("api_key_env") if existing else None
            if key:
                key_env = pillar.custom_key_env(name)
                if any(isinstance(e, dict) and e.get("api_key_env") == key_env and e.get("name") != name for e in entries):
                    raise SetupError("%s is already used by another endpoint; choose another name." % key_env)
            elif kept and str(kept).startswith(pillar.key_prefix) and settings.get(kept):
                if str(existing.get("base_url") or "").rstrip("/") != base_url:
                    raise SetupError("This endpoint's saved key is not sent to a new URL. Paste the key again.")
                key_env = kept
        raw: Dict[str, Any] = {"name": name, "label": text(body, "label", 60) or "%s (%s)" % (model.rsplit("/", 1)[-1], p["label"]),
                               "base_url": base_url, "model": model}
        if key_env:
            raw["api_key_env"] = key_env
        for field in pillar.preset_fields:
            if field in p:
                raw[field] = p[field]
        for field in ("price_per_mtok_input", "price_per_mtok_output"):
            price = _price(body, field)
            if price is not None:
                raw[field] = price
        if existing and str(existing.get("base_url") or "").rstrip("/") == base_url:
            # Same server: keep hand-edited options the dialog does not show (extra_body, max_tokens, ...).
            # A different server starts fresh, so one provider's rpm or timeout never carries over.
            raw = {**{k: v for k, v in existing.items() if k not in ("api_key_env",)}, **raw}
            for field in ("price_per_mtok_input", "price_per_mtok_output"):
                if body.get(field) in (None, ""):
                    raw.pop(field, None)
        problems: List[str] = []
        if not pillar.validate(raw, "endpoint %r" % name, problems).ok or problems:
            raise SetupError(problems[0])
        notes = write_key(settings, key_env, key) if key else []
        if existing:
            entries[entries.index(existing)] = raw
        else:
            entries.append(raw)
        _write_file(pillar, settings, data)
        registry.reload()
    return {"saved": name, "id": pillar.prefix + name, "notes": notes}


def remove_endpoint(pillar: Pillar, settings: Settings, registry, body: dict) -> dict:
    """Delete an endpoint from the endpoints file. A custom endpoint's private key goes too; a
    provider key stays in .env, since other endpoints or tools may use it."""
    name = text(body, "name", 40)
    with _lock:
        data = _read_file(pillar, settings)
        entries = data["endpoints"]
        existing = next((e for e in entries if isinstance(e, dict) and e.get("name") == name), None)
        if existing is None:
            raise SetupError("%r is not in %s; only models saved there can be removed here."
                             % (name, pillar.path(settings).name))
        entries.remove(existing)
        _write_file(pillar, settings, data)
        key_env = str(existing.get("api_key_env") or "")
        if key_env.startswith(pillar.key_prefix) and not any(isinstance(e, dict) and e.get("api_key_env") == key_env for e in entries):
            envfile.forget_key(settings.env_file.parent, settings.env_file.name, var=key_env)
        registry.reload()
    return {"removed": name}


def save(settings: Settings, registry: LlmRegistry, body: dict) -> dict:
    return {**save_endpoint(LLM, settings, registry, body), "llm": public(settings, registry)}


def remove(settings: Settings, registry: LlmRegistry, body: dict) -> dict:
    return {**remove_endpoint(LLM, settings, registry, body), "llm": public(settings, registry)}
