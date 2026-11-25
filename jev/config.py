"""Paths and settings. Process environment wins over the project's `.env` file.

Environment variables (the first three are the official TypeSafe SDK names):
  TYPESAFE_API_KEY        the API key
  TYPESAFE_BASE_URL       API root (default https://api.typesafe.ai)
  TYPESAFE_DEFAULT_MODEL  model name or alias (default jev-latest)
  JEV_FSD_BBOX            map bounding box "W,S,E,N" in degrees (default: Kitsilano, Vancouver)
  JEV_FSD_BUDGET_USD      stop making live calls after this much spend in one server run (default 1.00)
  JEV_FSD_RPM             local cap on live calls per minute (default 240)
  JEV_FSD_NPCS            number of traffic cars (default 40)
  JEV_FSD_QUIET           suppress HTTP access logs
  JEV_FSD_LLM_ENDPOINTS   LLM driver config file (default data/llm-endpoints.json; see jev/llm.py)
  JEV_FSD_LLM_BASE_URL    one OpenAI-compatible endpoint without a config file (also _MODEL, _API_KEY, _NAME)
  JEV_FSD_DECISION_ENDPOINTS  decision-model driver config file (default data/decision-endpoints.json; see jev/decision.py)
  PORT                    listen port (default 8322)
"""

from __future__ import annotations

import math
import os
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Mapping, Optional, Tuple
from urllib.parse import urlsplit

from . import envfile

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
MAPS_DIR = DATA_DIR / "maps"
SNAPSHOTS_DIR = DATA_DIR / "snapshots"
RUNS_DIR = DATA_DIR / "runs"
RECORDINGS_DIR = DATA_DIR / "recordings"
LLM_ENDPOINTS_PATH = DATA_DIR / "llm-endpoints.json"
DECISION_ENDPOINTS_PATH = DATA_DIR / "decision-endpoints.json"
ENV_PATH = PROJECT_ROOT / ".env"

KEY_ENV = "TYPESAFE_API_KEY"
BASE_URL_ENV = "TYPESAFE_BASE_URL"
MODEL_ENV = "TYPESAFE_DEFAULT_MODEL"

DEFAULT_BASE_URL = "https://api.typesafe.ai"
DEFAULT_MODEL = "jev-latest"
DEFAULT_PORT = 8322
DEFAULT_BUDGET_USD = 1.00
DEFAULT_RPM = 240
DEFAULT_NPCS = 40
MAX_SAFE_INTEGER = 2**53 - 1

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
        self.file_values: dict[str, str] = {}
        self.file_problem: str | None = None
        self.reload_file()

    def reload_file(self) -> None:
        try:
            self.file_values = envfile.read(self.env_file)
        except OSError as err:
            self.file_values = {}
            self.file_problem = f"Could not read {self.env_file.name}: {err.strerror or err}."
        else:
            self.file_problem = None

    def get(self, name: str, default: Optional[str] = None) -> Optional[str]:
        value = self.environ.get(name) or self.file_values.get(name)
        return value if value else default

    @property
    def api_key(self) -> Optional[str]:
        raw = self.get(KEY_ENV)
        if not raw or not _base_url_valid(self.base_url):
            return None
        key = raw.strip(" \t")
        return key if key and all(33 <= ord(ch) <= 126 for ch in key) else None

    @property
    def key_source(self) -> Optional[str]:
        if self.api_key is None:
            return None
        if self.environ.get(KEY_ENV):
            return "env"
        if self.file_values.get(KEY_ENV):
            return "file"
        return None

    @property
    def base_url(self) -> str:
        raw = self.get(BASE_URL_ENV)
        return raw.strip(" \t").rstrip("/") if raw else DEFAULT_BASE_URL

    @property
    def model(self) -> str:
        raw = self.get(MODEL_ENV)
        if raw is not None and raw.isprintable():
            return raw.strip() or DEFAULT_MODEL
        return DEFAULT_MODEL

    @property
    def bbox(self) -> Tuple[float, float, float, float]:
        return parse_bbox(self.get("JEV_FSD_BBOX")) or DEFAULT_BBOX

    @property
    def budget_usd(self) -> float:
        return _budget(self.get("JEV_FSD_BUDGET_USD"), DEFAULT_BUDGET_USD)

    @property
    def rpm(self) -> int:
        return _integer(self.get("JEV_FSD_RPM"), 0, MAX_SAFE_INTEGER, DEFAULT_RPM)

    @property
    def npcs(self) -> int:
        return _integer(self.get("JEV_FSD_NPCS"), 0, MAX_SAFE_INTEGER, DEFAULT_NPCS)

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
        try:
            path = Path(value).expanduser()
        except RuntimeError:
            path = Path(value)
        return path if path.is_absolute() else PROJECT_ROOT / path

    @property
    def port(self) -> int:
        return _integer(self.get("PORT"), 1, 65535, DEFAULT_PORT)

    @property
    def quiet(self) -> bool:
        return (self.get("JEV_FSD_QUIET", "") or "").strip().lower() not in ("", "0", "false", "off", "no")

    def problems(self) -> list[str]:
        """Configuration diagnostics containing setting names and defaults only."""
        problems = [self.file_problem] if self.file_problem else []
        for name, minimum, maximum, default in (
            ("PORT", 1, 65535, DEFAULT_PORT),
            ("JEV_FSD_NPCS", 0, MAX_SAFE_INTEGER, DEFAULT_NPCS),
            ("JEV_FSD_RPM", 0, MAX_SAFE_INTEGER, DEFAULT_RPM),
        ):
            raw = self.get(name)
            if raw is not None and _integer(raw, minimum, maximum, None) is None:
                problems.append(f"{name} must be an integer from {minimum} to {maximum}. Using {default}.")
        raw_budget = self.get("JEV_FSD_BUDGET_USD")
        if raw_budget is not None and _budget(raw_budget, None) is None:
            problems.append(f"JEV_FSD_BUDGET_USD must be a non-negative number. Using {DEFAULT_BUDGET_USD:.2f}.")
        raw_bbox = self.get("JEV_FSD_BBOX")
        if raw_bbox is not None and parse_bbox(raw_bbox) is None:
            problems.append("JEV_FSD_BBOX must be a map preset or W,S,E,N in degrees. Using Kitsilano.")
        if not _base_url_valid(self.base_url):
            problems.append(f"{BASE_URL_ENV} must be an HTTP(S) API root. Jev is disabled.")
        elif self.get(KEY_ENV) and self.api_key is None:
            problems.append(f"{KEY_ENV} must contain printable ASCII without spaces. Jev is disabled.")
        raw_model = self.get(MODEL_ENV)
        if raw_model is not None and (not raw_model.isprintable() or not raw_model.strip()):
            problems.append(f"{MODEL_ENV} must be a model name. Using {DEFAULT_MODEL}.")
        for name, path in (
            ("JEV_FSD_LLM_ENDPOINTS", self.llm_endpoints_path),
            ("JEV_FSD_DECISION_ENDPOINTS", self.decision_endpoints_path),
        ):
            if self.get(name):
                if "\x00" in str(path):
                    problems.append(f"{name} must be a valid file path.")
                elif path.is_dir():
                    problems.append(f"{name} names a directory. Choose a JSON file.")
        return problems


def _base_url_valid(value: str) -> bool:
    if not value.isascii() or not value.isprintable() or any(ch in value for ch in " ?#\\"):
        return False
    try:
        url = urlsplit(value)
        return (
            url.scheme in ("http", "https")
            and bool(url.hostname)
            and url.username is None
            and not url.netloc.endswith(":")
            and url.port != 0
        )
    except ValueError:
        return False


def _integer(value: str | None, minimum: int, maximum: int, default: int | None):
    if not isinstance(value, str):
        return default
    try:
        number = Decimal(value)
        if number.is_finite() and minimum <= number <= maximum and number == number.to_integral_value():
            return int(number)
    except InvalidOperation:
        pass
    return default


def _budget(value: str | None, default: float | None):
    if not isinstance(value, str):
        return default
    try:
        exact = Decimal(value)
        if exact.is_finite() and exact >= 0:
            number = float(exact)
            # Only an explicit zero should disable the spend guard.
            if math.isfinite(number) and (number != 0 or exact.is_zero()):
                return number
    except (InvalidOperation, OverflowError):
        pass
    return default


def parse_bbox(value: Optional[str]) -> Optional[Tuple[float, float, float, float]]:
    """'W,S,E,N' or a preset name -> tuple, or None when missing/invalid."""
    if not isinstance(value, str) or not value.strip():
        return None
    preset = PRESET_BBOXES.get(value.strip().lower())
    if preset is not None:
        return preset
    try:
        parts = [float(p) for p in value.split(",")]
    except ValueError:
        return None
    if len(parts) != 4 or not all(math.isfinite(p) for p in parts):
        return None
    w, s, e, n = parts
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        return None
    return (w, s, e, n)


def _float(value: Optional[str], default: float) -> float:
    if value in (None, "") or isinstance(value, bool):
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return parsed if math.isfinite(parsed) else default
