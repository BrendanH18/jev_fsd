"""In-app setup for decision-model drivers: the Decision tab of the "Connect a model" dialog.

The same flow and the same safeguards as LLM setup (jev/llm_setup.py): pick a provider, paste a key,
choose a model, save. Presets fix the URL and the protocol path on the server:

  * TypeSafe: Jev direct. The key is saved as TYPESAFE_API_KEY, the variable the built-in Jev driver
    reads, so saving it is how Jev becomes available without a restart. Choosing the model the
    built-in driver already uses (TYPESAFE_DEFAULT_MODEL, default jev-latest) saves only the key;
    any other Jev version becomes its own driver, e.g. decision:jev-preview.
  * OpenRouter: every model OpenRouter lists with the "decisions" output modality, through its
    Decisions API. The key is OPENROUTER_API_KEY, the same one the LLM preset uses.
  * llama.cpp: a local server (0.6.0 or later) serving /v1/systemone. No key.
  * Other: any server that speaks System One at {base_url}/v1/systemone.

The built-in `jev` driver is never routed through OpenRouter, even when only an OpenRouter key is
saved: replays, fixtures and saved runs that say `jev` mean TypeSafe's API, its price and its latency.
OpenRouter's Jev is one click away as its own driver instead (decision:jev-latest, say).
"""

from __future__ import annotations

from typing import List

from .client import PRICE_PER_INPUT_TOKEN_USD, JevClient
from .config import DEFAULT_BASE_URL, KEY_ENV, Settings
from .decision import DecisionConfig, DecisionRegistry
from .llm_setup import (MODELS_TIMEOUT_S, Pillar, SetupError, _lock, base_url_for, fetch_json, parse_models, probe_url,
                        remove_endpoint, save_endpoint, text, write_key)
from .endpoints import public_url

OPENROUTER_CATALOG = "https://openrouter.ai/api/v1/models?output_modalities=decisions"
JEV_PRICE_PER_MTOK = round(PRICE_PER_INPUT_TOKEN_USD * 1_000_000, 6)
# From https://docs.typesafe.ai/models (2026-10-15). Shown when TypeSafe's own list cannot be loaded.
TYPESAFE_MODELS = (
    {"id": "jev-latest", "name": "Jev latest (stable; jev-1.13.0 today)"},
    {"id": "jev-preview", "name": "Jev preview (newest; jev-1.14.0 today)"},
    {"id": "jev-1.14.0", "name": "Jev 1.14"},
    {"id": "jev-1.13.0", "name": "Jev 1.13"},
)

PROVIDERS = (
    {"id": "typesafe", "label": "TypeSafe", "base_url": DEFAULT_BASE_URL, "path": "/v1/systemone", "check_path": "/v1/models",
     "key_env": KEY_ENV, "key_url": "https://console.typesafe.ai", "timeout_s": 3,
     "hint": "Jev, direct from TypeSafe. Saving the key turns on the built-in Jev driver; another Jev version becomes a driver of its own."},
    {"id": "openrouter", "label": "OpenRouter", "base_url": "https://openrouter.ai", "path": "/api/alpha/decisions",
     "check_path": "/api/v1/key", "key_env": "OPENROUTER_API_KEY", "key_url": "https://openrouter.ai/keys", "timeout_s": 5,
     "hint": "Jev, Perplexity Decider, Liquid d1, Microsoft Decision 1 and other decision models with one key. Prices fill in automatically."},
    {"id": "llamacpp", "label": "llama.cpp", "base_url": "http://localhost:8080", "path": "/v1/systemone", "check_path": "/v1/models",
     "timeout_s": 20, "rpm": 0,
     "hint": "Free, on this computer: llama-server 0.6.0 or later with an open decision model such as Kev 4B (GGUF)."},
    {"id": "custom", "label": "Other", "base_url": None,
     "hint": "Any server that answers POST {URL}/v1/systemone with TypeSafe's request and answer format."},
)

DECISION = Pillar(prefix="decision:", providers=PROVIDERS, path=lambda s: s.decision_endpoints_path, validate=DecisionConfig,
                  key_prefix="JEV_FSD_DECISION_KEY_", preset_fields=("path", "check_path", "timeout_s", "rpm"))


def jev_public(client: JevClient) -> dict:
    """The built-in Jev driver as the setup dialog sees it. Never the key."""
    return {"id": "jev", "configured": client.configured, "key_source": client.key_source, "model": client.model,
            "endpoint": public_url(client.base_url), "price_per_mtok_input": JEV_PRICE_PER_MTOK}


def public(settings: Settings, registry: DecisionRegistry, client: JevClient) -> dict:
    """The /api/status `decision` block: configured endpoints, problems, presets and the built-in Jev."""
    return {**registry.public(), "providers": DECISION.providers_public(settings), "jev": jev_public(client)}


def _typesafe_models(data) -> List[dict]:
    """TypeSafe lists {"models": [{"name", "description", "release_date"}]}: the name is the model id."""
    models = data.get("models") if isinstance(data, dict) else None
    if not isinstance(models, list):
        return parse_models(data)
    return parse_models([{"id": m.get("name"), "name": m.get("description")} for m in models if isinstance(m, dict)])


def list_models(settings: Settings, body: dict) -> dict:
    """The model picker's list. OpenRouter's decision catalog is public, so it is loaded without a key.
    TypeSafe's needs one; without it (or if it cannot be loaded) the documented Jev models are shown."""
    p = DECISION.provider(body.get("provider"))
    key = text(body, "api_key", 512) or (settings.get(p["key_env"]) if p.get("key_env") else None)
    if p["id"] == "openrouter":
        models = parse_models(fetch_json(OPENROUTER_CATALOG, None, p["label"], MODELS_TIMEOUT_S))
        return {"provider": p["id"], "endpoint": public_url(p["base_url"]) + p["path"], "models": models}
    if p["id"] == "typesafe":
        documented = [dict(m, price_per_mtok_input=JEV_PRICE_PER_MTOK, price_per_mtok_output=0) for m in TYPESAFE_MODELS]
        note = None
        if key:
            try:   # a wrong key is worth saying now; an unreachable list is not worth blocking on
                listed = _typesafe_models(fetch_json(p["base_url"] + "/v1/models", key, p["label"], MODELS_TIMEOUT_S))
            except SetupError as err:
                if "rejected the key" in str(err):
                    raise
                listed, note = [], "TypeSafe's model list could not be loaded (%s); showing the documented models." % err
            known = {m["id"] for m in documented}
            documented += [dict(m, price_per_mtok_input=JEV_PRICE_PER_MTOK, price_per_mtok_output=0)
                           for m in listed if m["id"] not in known]
        return {"provider": p["id"], "endpoint": public_url(p["base_url"]) + p["path"], "models": documented, "note": note}
    base_url = probe_url(base_url_for(p, body), keyed=bool(key))
    models = parse_models(fetch_json(base_url + "/v1/models", key, p["label"], MODELS_TIMEOUT_S))
    return {"provider": p["id"], "endpoint": public_url(base_url) + "/v1/systemone", "models": models}


def save(settings: Settings, registry: DecisionRegistry, client: JevClient, body: dict) -> dict:
    """Save a decision model. TypeSafe with the built-in Jev's own model saves only the key."""
    p = DECISION.provider(body.get("provider"))
    if p["id"] == "typesafe" and text(body, "model", 200) == client.model and not text(body, "name", 40):
        key = text(body, "api_key", 512)
        if not key and not settings.get(KEY_ENV):
            raise SetupError("Paste your TypeSafe API key.")
        with _lock:
            notes: List[str] = write_key(settings, KEY_ENV, key) if key else []
            registry.reload()   # re-reads .env, which the built-in Jev driver shares
        result = {"saved": "jev", "id": "jev", "notes": notes}
    else:
        result = save_endpoint(DECISION, settings, registry, body)
    return {**result, "decision": public(settings, registry, client)}


def remove(settings: Settings, registry: DecisionRegistry, client: JevClient, body: dict) -> dict:
    return {**remove_endpoint(DECISION, settings, registry, body), "decision": public(settings, registry, client)}
