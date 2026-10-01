"""Bundled Canadian neighbourhood catalogue. Road packs retain OpenStreetMap attribution."""
from __future__ import annotations

import json
from pathlib import Path

from .config import PRESET_BBOXES
from .osm.pack import pack_path

MAP_CATALOG = (
    {"id": "kitsilano", "name": "Kitsilano", "city": "Vancouver", "province": "British Columbia",
     "description": "Leafy residential blocks, bike routes and busy avenues.", "character": "Residential", "accent": "#6ec7a1", "utc_offset": -7},
    {"id": "mount_pleasant", "name": "Mount Pleasant", "city": "Vancouver", "province": "British Columbia",
     "description": "Main Street traffic, narrow residential blocks and busy east-west crossings.", "character": "Mixed urban", "accent": "#e0a778", "utc_offset": -7},
    {"id": "victoria", "name": "Old Town", "city": "Victoria", "province": "British Columbia",
     "description": "Compact downtown streets, frequent signals and one-way turns.", "character": "City centre", "accent": "#deb988", "utc_offset": -7},
    {"id": "toronto", "name": "The Annex", "city": "Toronto", "province": "Ontario",
     "description": "A dense street grid with stop-controlled blocks and larger avenues.", "character": "Urban grid", "accent": "#8cadde", "utc_offset": -4},
    {"id": "montreal", "name": "Le Plateau", "city": "Montréal", "province": "Québec",
     "description": "Angled streets, one-way connections and a mix of junctions.", "character": "One-way streets", "accent": "#c29be2", "utc_offset": -4},
    {"id": "calgary", "name": "Beltline", "city": "Calgary", "province": "Alberta",
     "description": "Wide avenues, frequent signals and a downtown mix of one-way streets.", "character": "Downtown avenues", "accent": "#dc927d", "utc_offset": -6},
    {"id": "ottawa", "name": "Centretown", "city": "Ottawa", "province": "Ontario",
     "description": "Bank Street shops, residential side streets and a dense one-way grid.", "character": "Capital streets", "accent": "#8ebbc0", "utc_offset": -4},
    {"id": "quebec_city", "name": "Saint-Roch", "city": "Québec City", "province": "Québec",
     "description": "Short lower-town blocks, irregular junctions and Boulevard Charest traffic.", "character": "Historic grid", "accent": "#c4b27f", "utc_offset": -4},
)


def map_identity(bbox: tuple) -> dict:
    for item in MAP_CATALOG:
        if tuple(bbox) == PRESET_BBOXES[item["id"]]:
            return {"id": item["id"], "label": "%s, %s" % (item["name"], item["city"]), "utc_offset": item["utc_offset"]}
    return {"id": "custom", "label": "Custom neighbourhood"}


def catalog(maps_dir: Path) -> list:
    result = []
    for item in MAP_CATALOG:
        bbox = PRESET_BBOXES[item["id"]]
        path = pack_path(maps_dir, bbox)
        pack = json.loads(path.read_text()) if path.is_file() else None
        preview = []
        if pack:
            seen = set()
            for edge in pack["edges"]:
                key = tuple(sorted((edge["from"], edge["to"])))
                if key in seen:
                    continue
                seen.add(key)
                preview.append({"pts": edge["pts"], "major": edge["cls"] in ("primary", "secondary", "tertiary", "trunk")})
        result.append({**item, "bbox": list(bbox), "cached": pack is not None,
                       "stats": {"roads": len(pack["edges"]), "signals": len(pack["intersections"]),
                                 "stops": len(pack["stops"]), "buildings": len(pack["buildings"])} if pack else {},
                       "extent": pack["extent"] if pack else None, "preview": preview})
    return result
