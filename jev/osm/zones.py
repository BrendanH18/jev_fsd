"""School and playground zones for a map pack, from OpenStreetMap schools and playgrounds.

    zones = build_zones(bbox, maps_dir, pack)   # cached beside the pack; None without the raw OSM
    zones = zones_from_osm(osm, pack)

In BC a school zone or a playground zone is the stretch of street beside a school's grounds or a
playground, signed with a 30 km/h limit (Motor Vehicle Act s. 147): a school zone's on school days
from 8:00 to 17:00, a playground zone's every day from dawn to dusk. The sim applies the limit and
the hours (static/js/sim/speed-zones.js); this module finds the stretches.

A school is a way or multipolygon tagged `amenity=school` (its grounds, or the building when that is
all there is) or a node tagged so (a circle NODE_R_M in radius) that gives its grades, and not a
post-secondary one (kind_of); a playground is one tagged `leisure=playground`. A zone is every stretch of a pack street (each way the traffic goes, so a
two-way street has a stretch in each direction) whose centreline passes within SCHOOL_REACH_M of a
school's outline, or PLAYGROUND_REACH_M of a playground's (one usually stands a little way into its
park), or inside it. Stretches on one street closer together than JOIN_M are one; those shorter
than MIN_SPAN_M (a corner clipped) are left out, as are roundabout rings.

Each zone is kept with its kind (`school` or `playground`), name and stretches: `edge`, and `from`
and `to` in metres along its centreline. The file is separate from the pack
(`<key>.zones.v1.json`), so adding it leaves the streets as they were.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .. import geometry as g
from . import fetch
from .parse import OsmData, parse_xml
from .project import Projection

ZONES_VERSION = "1"
SCHOOL_REACH_M = 22.0
PLAYGROUND_REACH_M = 35.0
NODE_R_M = 15.0       # a school or playground mapped as a point is taken as a circle this wide
MIN_SPAN_M = 15.0
JOIN_M = 12.0
STEP_M = 2.0          # each street is checked this often along its centreline

Bbox = Tuple[float, float, float, float]
Point = Tuple[float, float]


def zones_path(maps_dir: Path, bbox: Bbox) -> Path:
    return maps_dir / ("%s.zones.v%s.json" % (fetch.cache_key(bbox), ZONES_VERSION))


def load_zones(bbox: Bbox, maps_dir: Path) -> Optional[dict]:
    path = zones_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_zones(bbox: Bbox, maps_dir: Path, pack: dict, force: bool = False,
                log: Callable[[str], None] = lambda m: None) -> Optional[dict]:
    """The cached zones for a bbox, built from its raw OSM download if that is on disk (it is never
    downloaded here). None when there is neither."""
    path = zones_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    xml_path = fetch.cache_path(maps_dir, bbox)
    if not xml_path.is_file():
        return None
    zones = zones_from_osm(parse_xml(xml_path), pack)
    log("map: built %s (%d school and playground zones)" % (path.name, len(zones["zones"])))
    path.write_text(json.dumps(zones, separators=(",", ":")))
    return zones


def kind_of(tags: dict, point: bool = False) -> Optional[str]:
    """`school`, `playground`, or None. A school is one children go to: none whose ISCED levels are
    all 4 or more (post-secondary), and one mapped only as a point needs `grades` or `isced:level`
    to say so (points tagged as schools are as often language, dance or driving schools)."""
    if tags.get("leisure") == "playground":
        return "playground"
    if tags.get("amenity") != "school":
        return None
    levels = [int(v) for v in re.findall(r"\d+", tags.get("isced:level") or "")]
    if levels and min(levels) >= 4:
        return None
    if point and not levels and not tags.get("grades"):
        return None
    return "school"


def places(osm: OsmData, proj: Projection) -> List[dict]:
    """Every school and playground: {id, kind, name, rings: [outlines], points: [centres]}."""
    out = []

    def outline(node_ids: Sequence[int]) -> List[Point]:
        return [proj.to_xy(*osm.nodes[n][:2]) for n in node_ids if n in osm.nodes]

    for nid, (lat, lon, tags) in osm.nodes.items():
        kind = kind_of(tags, point=True)
        if kind:
            out.append({"id": "%sn%d" % (kind[0], nid), "kind": kind, "name": tags.get("name", ""),
                        "rings": [], "points": [proj.to_xy(lat, lon)]})
    ways = {w["id"]: w for w in osm.ways}
    for w in osm.ways:
        kind = kind_of(w["tags"])
        ring = outline(w["nodes"])
        if kind and len(ring) >= 2:
            out.append({"id": "%sw%d" % (kind[0], w["id"]), "kind": kind, "name": w["tags"].get("name", ""),
                        "rings": [ring], "points": []})
    for r in osm.relations:
        kind = kind_of(r["tags"])
        if not kind:
            continue
        rings = [outline(ways[ref]["nodes"]) for t, ref, role in r["members"]
                 if t == "way" and role in ("outer", "") and ref in ways]
        rings = [ring for ring in rings if len(ring) >= 2]
        if rings:
            out.append({"id": "%sr%d" % (kind[0], r["id"]), "kind": kind, "name": r["tags"].get("name", ""),
                        "rings": rings, "points": []})
    return sorted(out, key=lambda p: p["id"])


def distance_to(place: dict, p: Point) -> float:
    """How far p is from a place's outline, 0 inside it."""
    best = math.inf
    for c in place["points"]:
        best = min(best, max(0.0, math.hypot(p[0] - c[0], p[1] - c[1]) - NODE_R_M))
    for ring in place["rings"]:
        if _inside(ring, p):
            return 0.0
        for a, b in zip(ring, ring[1:]):
            best = min(best, _to_segment(p, a, b))
    return best


def zones_from_osm(osm: OsmData, pack: dict) -> dict:
    origin = pack.get("origin") or {}
    proj = Projection(origin.get("lat", 0.0), origin.get("lon", 0.0))
    edges = [e for e in pack["edges"] if not e.get("ring")]
    samples = {e["id"]: _samples(e) for e in edges}
    zones = []
    for place in places(osm, proj):
        reach = SCHOOL_REACH_M if place["kind"] == "school" else PLAYGROUND_REACH_M
        box = _box(place, reach)
        spans = []
        for e in edges:
            pts = samples[e["id"]]
            if not any(box[0] <= x <= box[2] and box[1] <= y <= box[3] for _, x, y in pts):
                continue
            near = [s for s, x, y in pts if distance_to(place, (x, y)) <= reach]
            for a, b in _runs(near):
                if b - a >= MIN_SPAN_M:
                    spans.append({"edge": e["id"], "from": g.r1(a), "to": g.r1(min(b, e["length"]))})
        if spans:
            zones.append({"id": place["id"], "kind": place["kind"], "name": place["name"], "spans": spans})
    return {"zones_version": ZONES_VERSION, "name": pack.get("name", ""), "zones": zones}


def _samples(e: dict) -> List[Tuple[float, float, float]]:
    """Points every STEP_M along an edge's centreline: (s, x, y), s in the pack's metres."""
    pts = [tuple(q) for q in e["pts"]]
    cum = g.cumulative_s(pts)
    scale = e["length"] / cum[-1] if cum[-1] > 0 else 1.0
    n = max(1, int(math.ceil(cum[-1] / STEP_M)))
    out = []
    for i in range(n + 1):
        s = cum[-1] * i / n
        x, y = g.point_at(pts, s, cum)
        out.append((s * scale, x, y))
    return out


def _runs(near: List[float]) -> List[Tuple[float, float]]:
    """Sorted sample positions joined into stretches, a gap wider than JOIN_M ending one."""
    runs: List[List[float]] = []
    for s in near:
        if runs and s - runs[-1][1] <= JOIN_M:
            runs[-1][1] = s
        else:
            runs.append([s, s])
    return [(a, b) for a, b in runs]


def _box(place: dict, reach: float) -> Tuple[float, float, float, float]:
    pts = [q for ring in place["rings"] for q in ring] + list(place["points"])
    pad = reach + (NODE_R_M if place["points"] else 0.0)
    return (min(x for x, _ in pts) - pad, min(y for _, y in pts) - pad,
            max(x for x, _ in pts) + pad, max(y for _, y in pts) + pad)


def _inside(ring: List[Point], p: Point) -> bool:
    if len(ring) < 3 or ring[0] != ring[-1]:
        return False
    inside = False
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        if (ay > p[1]) != (by > p[1]) and p[0] < ax + (p[1] - ay) * (bx - ax) / (by - ay):
            inside = not inside
    return inside


def _to_segment(p: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / seg2))
    return math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)
