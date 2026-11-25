"""Bundled Canadian neighbourhood catalogue. Road packs retain OpenStreetMap attribution."""

from __future__ import annotations

import json
import math
import stat
import threading
from copy import deepcopy
from pathlib import Path
from typing import Optional

from .config import PRESET_BBOXES
from .osm.pack import PACK_VERSION, pack_path

_META_CACHE: dict = {}  # str(path) -> (file stamp, metadata or None)
_META_LOCK = threading.Lock()
MAX_META_ENTRIES = 64
MAX_PREVIEW_PACK_BYTES = 16 * 1024 * 1024

MAP_CATALOG = (
    {
        "id": "kitsilano",
        "name": "Kitsilano",
        "city": "Vancouver",
        "province": "British Columbia",
        "description": "Leafy residential blocks, bike routes and busy avenues.",
        "character": "Residential",
        "accent": "#6ec7a1",
        "utc_offset": -7,
    },
    {
        "id": "mount_pleasant",
        "name": "Mount Pleasant",
        "city": "Vancouver",
        "province": "British Columbia",
        "description": "Main Street traffic, narrow residential blocks and busy east-west crossings.",
        "character": "Mixed urban",
        "accent": "#e0a778",
        "utc_offset": -7,
    },
    {
        "id": "victoria",
        "name": "Old Town",
        "city": "Victoria",
        "province": "British Columbia",
        "description": "Compact downtown streets, frequent signals and one-way turns.",
        "character": "City centre",
        "accent": "#deb988",
        "utc_offset": -7,
    },
    {
        "id": "toronto",
        "name": "The Annex",
        "city": "Toronto",
        "province": "Ontario",
        "description": "A dense street grid with stop-controlled blocks and larger avenues.",
        "character": "Urban grid",
        "accent": "#8cadde",
        "utc_offset": -4,
    },
    {
        "id": "montreal",
        "name": "Le Plateau",
        "city": "Montréal",
        "province": "Québec",
        "description": "Angled streets, one-way connections and a mix of junctions.",
        "character": "One-way streets",
        "accent": "#c29be2",
        "utc_offset": -4,
    },
    {
        "id": "calgary",
        "name": "Beltline",
        "city": "Calgary",
        "province": "Alberta",
        "description": "Wide avenues, frequent signals and a downtown mix of one-way streets.",
        "character": "Downtown avenues",
        "accent": "#dc927d",
        "utc_offset": -6,
    },
    {
        "id": "ottawa",
        "name": "Centretown",
        "city": "Ottawa",
        "province": "Ontario",
        "description": "Bank Street shops, residential side streets and a dense one-way grid.",
        "character": "Capital streets",
        "accent": "#8ebbc0",
        "utc_offset": -4,
    },
    {
        "id": "quebec_city",
        "name": "Saint-Roch",
        "city": "Québec City",
        "province": "Québec",
        "description": "Short lower-town blocks, irregular junctions and Boulevard Charest traffic.",
        "character": "Historic grid",
        "accent": "#c4b27f",
        "utc_offset": -4,
    },
    {
        "id": "halifax",
        "name": "Downtown",
        "city": "Halifax",
        "province": "Nova Scotia",
        "description": "Harbourfront blocks below Citadel Hill, one-way pairs and Spring Garden Road shops.",
        "character": "Harbour town",
        "accent": "#e3928a",
        "utc_offset": -3,
    },
    {
        "id": "winnipeg",
        "name": "Exchange District",
        "city": "Winnipeg",
        "province": "Manitoba",
        "description": "Warehouse-district one-ways, Main Street and the wide avenues around Portage and Main.",
        "character": "Warehouse district",
        "accent": "#d6c26f",
        "utc_offset": -5,
    },
    {
        "id": "edmonton",
        "name": "Old Strathcona",
        "city": "Edmonton",
        "province": "Alberta",
        "description": "Whyte Avenue's signalled main street and quiet residential crossings with few signs.",
        "character": "Main street",
        "accent": "#9cc77c",
        "utc_offset": -6,
    },
    {
        "id": "saskatoon",
        "name": "Downtown & Nutana",
        "city": "Saskatoon",
        "province": "Saskatchewan",
        "description": "Downtown one-way avenues, Broadway Avenue and bridges over the South Saskatchewan River.",
        "character": "River crossings",
        "accent": "#9b93dc",
        "utc_offset": -6,
    },
)


def map_identity(bbox: tuple) -> dict:
    bbox = tuple(bbox)
    for item in MAP_CATALOG:
        if bbox == PRESET_BBOXES[item["id"]]:
            return {
                "id": item["id"],
                "label": "%s, %s" % (item["name"], item["city"]),
                "utc_offset": item["utc_offset"],
            }
    return {"id": "custom", "label": "Custom neighbourhood"}


def _pack_metadata(path: Path) -> Optional[dict]:
    """Cached stats, extent and road preview for a pack file, invalidated on changes."""
    key = str(path)
    try:
        st = path.stat()
    except OSError:
        st = None
    if st is None or not stat.S_ISREG(st.st_mode) or st.st_size > MAX_PREVIEW_PACK_BYTES:
        with _META_LOCK:
            _META_CACHE.pop(key, None)
        return None
    stamp = (st.st_dev, st.st_ino, st.st_ctime_ns, st.st_mtime_ns, st.st_size)
    with _META_LOCK:
        cached = _META_CACHE.pop(key, None)
        if cached is not None and cached[0] == stamp:
            _META_CACHE[key] = cached
            return cached[1]
    try:
        with path.open("rb") as handle:
            data = handle.read(MAX_PREVIEW_PACK_BYTES + 1)
        if len(data) > MAX_PREVIEW_PACK_BYTES:
            raise ValueError("pack exceeds the preview size limit")
        meta = _preview_metadata(json.loads(data.decode("utf-8")))
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        meta = None
    with _META_LOCK:
        _META_CACHE[key] = (stamp, meta)
        if len(_META_CACHE) > MAX_META_ENTRIES:
            del _META_CACHE[next(iter(_META_CACHE))]
    return meta


def _finite(value) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _preview_metadata(pack: dict) -> dict:
    if not isinstance(pack, dict) or pack.get("pack_version") != PACK_VERSION:
        raise ValueError("unexpected pack version")
    for field in ("edges", "intersections", "stops", "buildings", "extent"):
        if not isinstance(pack[field], list):
            raise ValueError(f"{field} must be an array")
    if len(pack["extent"]) != 4 or not all(_finite(v) for v in pack["extent"]):
        raise ValueError("extent must have four finite coordinates")
    x0, y0, x1, y1 = pack["extent"]
    if x0 >= x1 or y0 >= y1:
        raise ValueError("extent must have positive width and height")
    preview = []
    seen = set()
    for edge in pack["edges"]:
        if not isinstance(edge, dict):
            raise ValueError("each road must be an object")
        start, end = edge["from"], edge["to"]
        if type(start) not in (str, int) or type(start) is not type(end):
            raise ValueError("road endpoint IDs must use the same type")
        pts, kind = edge["pts"], edge["cls"]
        if not isinstance(kind, str):
            raise ValueError("road class must be text")
        if not isinstance(pts, list) or len(pts) < 2:
            raise ValueError("each road must have at least two points")
        if not all(isinstance(pt, list) and len(pt) == 2 and all(_finite(v) for v in pt) for pt in pts):
            raise ValueError("road points must be finite coordinate pairs")
        points = tuple(map(tuple, pts))
        reverse = (end, start, points[::-1])
        edge_key = min((start, end, points), reverse)
        if edge_key in seen:
            continue
        seen.add(edge_key)
        preview.append({"pts": pts, "major": kind in ("primary", "secondary", "tertiary", "trunk")})
    return {
        "stats": {
            "roads": len(pack["edges"]),
            "signals": len(pack["intersections"]),
            "stops": len(pack["stops"]),
            "buildings": len(pack["buildings"]),
        },
        "extent": pack["extent"],
        "preview": preview,
    }


def catalog(maps_dir: Path) -> list:
    result = []
    for item in MAP_CATALOG:
        bbox = PRESET_BBOXES[item["id"]]
        meta = _pack_metadata(pack_path(maps_dir, bbox))
        result.append(
            {
                **item,
                "bbox": list(bbox),
                "cached": meta is not None,
                "stats": dict(meta["stats"]) if meta else {},
                "extent": deepcopy(meta["extent"]) if meta else None,
                "preview": deepcopy(meta["preview"]) if meta else [],
            }
        )
    return result
