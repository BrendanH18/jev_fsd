"""Scramble crossings for a map pack: signals with an all-walk phase, from OpenStreetMap.

    scrambles = build_scrambles(bbox, maps_dir, pack)   # cached beside the pack; None without the raw OSM
    scrambles = scrambles_from_osm(osm, pack)

At a scramble crossing (a "pedestrian scramble", or "scramble corner") every vehicle approach shows
red at once while pedestrians cross every way, diagonally too; then traffic has its greens with no
pedestrians walking alongside. OSM has no single tag for it. A signal is one when a crossing node or
footway within NEAR_M of its centre says so: `crossing:scramble=yes`, `crossing=scramble`, or a
`note` or `description` naming a scramble or an all-way walk (as Victoria's at Government Street
and Wharf Street, by the Empress, does); or when a footway tagged `footway=crossing` runs diagonally
across the junction, from one corner to the one opposite (it passes within DIAGONAL_M of the
centre, at least DIAGONAL_DEG off every approach's heading).

Each one is kept with its signal's id, where it is, and why (`source`). The timing is the sim's
business (static/js/sim/signals.js).

The file is separate from the pack (`<key>.scrambles.v1.json`), so adding it leaves the streets as
they were.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Callable, Optional, Tuple

from . import fetch
from .parse import OsmData, parse_xml
from .project import Projection

SCRAMBLES_VERSION = "1"
NEAR_M = 30.0
DIAGONAL_M = 6.0
DIAGONAL_DEG = 25.0
WORDS = re.compile(r"\bscramble\b|\ball[- ]way walk\b|\bbarnes dance\b|\ball[- ]walk\b", re.I)

Bbox = Tuple[float, float, float, float]


def scrambles_path(maps_dir: Path, bbox: Bbox) -> Path:
    return maps_dir / ("%s.scrambles.v%s.json" % (fetch.cache_key(bbox), SCRAMBLES_VERSION))


def load_scrambles(bbox: Bbox, maps_dir: Path) -> Optional[dict]:
    path = scrambles_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_scrambles(bbox: Bbox, maps_dir: Path, pack: dict, force: bool = False,
                    log: Callable[[str], None] = lambda m: None) -> Optional[dict]:
    """The cached scramble crossings for a bbox, built from its raw OSM download if that is on disk
    (it is never downloaded here). None when there is neither."""
    path = scrambles_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    xml_path = fetch.cache_path(maps_dir, bbox)
    if not xml_path.is_file():
        return None
    scrambles = scrambles_from_osm(parse_xml(xml_path), pack)
    log("map: built %s (%d scramble crossings)" % (path.name, len(scrambles["scrambles"])))
    path.write_text(json.dumps(scrambles, separators=(",", ":")))
    return scrambles


def says_scramble(tags: dict) -> bool:
    """Whether a crossing's tags say it is part of a scramble."""
    if (tags.get("crossing:scramble") or "").lower() == "yes" or (tags.get("crossing") or "").lower() == "scramble":
        return True
    if tags.get("highway") != "crossing" and tags.get("footway") != "crossing" and "crossing" not in tags:
        return False
    return any(WORDS.search(tags.get(k) or "") for k in ("note", "description", "crossing:note"))


def _seg_dist(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)


def scrambles_from_osm(osm: OsmData, pack: dict) -> dict:
    origin = pack.get("origin") or {}
    proj = Projection(origin.get("lat", 0.0), origin.get("lon", 0.0))
    xy = {}

    def at(nid):
        if nid not in xy and nid in osm.nodes:
            lat, lon, _ = osm.nodes[nid]
            xy[nid] = proj.to_xy(lat, lon)
        return xy.get(nid)

    tagged = [at(nid) for nid, (_, _, tags) in osm.nodes.items() if says_scramble(tags)]
    ways = []
    for w in osm.ways:
        if w["tags"].get("footway") == "crossing" or says_scramble(w["tags"]):
            pts = [p for p in (at(n) for n in w["nodes"]) if p]
            ways.append((pts, says_scramble(w["tags"])))
    found = {}
    for inter in pack.get("intersections") or []:
        c = (inter["x"], inter["y"])
        if any(p and math.hypot(p[0] - c[0], p[1] - c[1]) < NEAR_M for p in tagged):
            found[inter["id"]] = "tagged"
            continue
        headings = [math.radians(a["heading_deg"]) for a in inter["approaches"]]
        for pts, named in ways:
            for a, b in zip(pts, pts[1:]):
                if _seg_dist(c, a, b) > (NEAR_M if named else DIAGONAL_M) or math.hypot(b[0] - a[0], b[1] - a[1]) < 4:
                    continue
                h = math.atan2(b[1] - a[1], b[0] - a[0])
                # (how far the crossing runs off the nearest approach's line, either way along it)
                off = min(abs(math.degrees(math.atan2(math.sin(2 * (h - k)), math.cos(2 * (h - k))))) / 2 for k in headings)
                if named:
                    found.setdefault(inter["id"], "tagged")
                elif off >= DIAGONAL_DEG:
                    found.setdefault(inter["id"], "diagonal")
    by_id = {i["id"]: i for i in pack.get("intersections") or []}
    out = [{"signal": sid, "x": by_id[sid]["x"], "y": by_id[sid]["y"], "source": src} for sid, src in found.items()]
    return {"scrambles_version": SCRAMBLES_VERSION, "name": pack.get("name", ""),
            "scrambles": sorted(out, key=lambda s: s["signal"])}
