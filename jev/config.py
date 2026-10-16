"""Paths and settings. Process environment wins over the project's `.env` file.

Environment variables (the first three are the official TypeSafe SDK names):
  TYPESAFE_API_KEY        the API key
  TYPESAFE_BASE_URL       API root (default https://api.typesafe.ai)
  TYPESAFE_DEFAULT_MODEL  model name or alias (default jev-latest)
  JEV_FSD_BBOX            map bounding box "W,S,E,N" in degrees (default: Kitsilano, Vancouver)
  JEV_FSD_BUDGET_USD      stop making live calls after this much spend in one server run (default 1.00)
  JEV_FSD_RPM             local cap on live calls per minute (default 240)
  JEV_FSD_NPCS            number of traffic cars (default 40)
  JEV_FSD_LLM_ENDPOINTS   LLM driver config file (default data/llm-endpoints.json; see jev/llm.py)
  JEV_FSD_LLM_BASE_URL    one OpenAI-compatible endpoint without a config file (also _MODEL, _API_KEY, _NAME)
  JEV_FSD_DECISION_ENDPOINTS  decision-model driver config file (default data/decision-endpoints.json; see jev/decision.py)
  PORT                    listen port (default 8322)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping, Optional, Tuple

from . import envfile

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
MAPS_DIR = DATA_DIR / "maps"
SNAPSHOTS_DIR = DATA_DIR / "snapshots"
RUNS_DIR = DATA_DIR / "runs"
LLM_ENDPOINTS_PATH = DATA_DIR / "llm-endpoints.json"
DECISION_ENDPOINTS_PATH = DATA_DIR / "decision-endpoints.json"
ENV_PATH = PROJECT_ROOT / ".env"

KEY_ENV = "TYPESAFE_API_KEY"
BASE_URL_ENV = "TYPESAFE_BASE_URL"
MODEL_ENV = "TYPESAFE_DEFAULT_MODEL"

DEFAULT_BASE_URL = "https://api.typesafe.ai"
DEFAULT_MODEL = "jev-latest"

# Kitsilano, Vancouver BC: W 4th Ave / Broadway between Macdonald and Arbutus. Flat, mostly two-way
# residential grid with signalled arterials. Order is W,S,E,N (what the OSM map API expects).
DEFAULT_BBOX: Tuple[float, float, float, float] = (-123.1700, 49.2600, -123.1500, 49.2700)

PRESET_BBOXES = {
    "kitsilano": DEFAULT_BBOX,
    "mount_pleasant": (-123.1120, 49.2570, -123.0940, 49.2680),
    "victoria": (-123.3740, 48.4190, -123.3570, 48.4320),
    "toronto": (-79.4120, 43.6600, -79.3940, 43.6710),
    "montreal": (-73.5900, 45.5160, -73.5740, 45.5280),
    "calgary": (-114.0870, 51.0340, -114.0630, 51.0450),
    "ottawa": (-75.7080, 45.4070, -75.6870, 45.4210),
    "quebec_city": (-71.2350, 46.8050, -71.2180, 46.8150),
    "halifax": (-63.5900, 44.6400, -63.5700, 44.6520),
    "winnipeg": (-97.1500, 49.8920, -97.1310, 49.9030),
    "edmonton": (-113.5120, 53.5130, -113.4880, 53.5230),
    "saskatoon": (-106.6720, 52.1170, -106.6500, 52.1310),
}


class Settings:
    def __init__(self, environ: Optional[Mapping[str, str]] = None, env_file: Path = ENV_PATH):
        self.environ = dict(os.environ if environ is None else environ)
        self.env_file = env_file
        self.file_values = envfile.read(env_file)

    def reload_file(self) -> None:
        self.file_values = envfile.read(self.env_file)

    def get(self, name: str, default: Optional[str] = None) -> Optional[str]:
        value = self.environ.get(name) or self.file_values.get(name)
        return value if value else default

    @property
    def api_key(self) -> Optional[str]:
        return self.get(KEY_ENV)

    @property
    def key_source(self) -> Optional[str]:
        if self.environ.get(KEY_ENV):
            return "env"
        if self.file_values.get(KEY_ENV):
            return "file"
        return None

    @property
    def base_url(self) -> str:
        return (self.get(BASE_URL_ENV, DEFAULT_BASE_URL) or DEFAULT_BASE_URL).rstrip("/")

    @property
    def model(self) -> str:
        return self.get(MODEL_ENV, DEFAULT_MODEL) or DEFAULT_MODEL

    @property
    def bbox(self) -> Tuple[float, float, float, float]:
        return parse_bbox(self.get("JEV_FSD_BBOX")) or DEFAULT_BBOX

    @property
    def budget_usd(self) -> float:
        return _float(self.get("JEV_FSD_BUDGET_USD"), 1.00)

    @property
    def rpm(self) -> int:
        return int(_float(self.get("JEV_FSD_RPM"), 240))

    @property
    def npcs(self) -> int:
        return int(_float(self.get("JEV_FSD_NPCS"), 40))

    @property
    def llm_endpoints_path(self) -> Path:
        return self._path("JEV_FSD_LLM_ENDPOINTS", LLM_ENDPOINTS_PATH)

    @property
    def decision_endpoints_path(self) -> Path:
        return self._path("JEV_FSD_DECISION_ENDPOINTS", DECISION_ENDPOINTS_PATH)

    def _path(self, name: str, default: Path) -> Path:
        value = self.get(name)
        if not value:
            return default
        path = Path(value).expanduser()
        return path if path.is_absolute() else PROJECT_ROOT / path

    @property
    def port(self) -> int:
        return int(_float(self.get("PORT"), 8322))


def parse_bbox(value: Optional[str]) -> Optional[Tuple[float, float, float, float]]:
    """'W,S,E,N' or a preset name -> tuple, or None when missing/invalid."""
    if not value:
        return None
    if value.strip().lower() in PRESET_BBOXES:
        return PRESET_BBOXES[value.strip().lower()]
    try:
        parts = [float(p) for p in value.split(",")]
    except ValueError:
        return None
    if len(parts) != 4:
        return None
    w, s, e, n = parts
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        return None
    return (w, s, e, n)


def _float(value: Optional[str], default: float) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except ValueError:
        return default
