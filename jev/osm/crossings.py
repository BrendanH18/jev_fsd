"""Marked crosswalks between junctions for a map pack, from OpenStreetMap crossing nodes.

    crossings = build_crossings(bbox, maps_dir, pack)   # cached beside the pack; None without the raw OSM
    crossings = crossings_from_osm(osm, pack)

A crossing is a node on a drivable way tagged as a marked crossing without a signal (`crossing` is
`uncontrolled`, `marked` or `zebra`, or `crossing:markings` names a marking), placed on the pack
street whose centreline passes within SNAP_M of it. Crossings within JUNCTION_M of a junction (a
node where three or more streets meet, or a roundabout) are left out: the crowd already crosses at
every junction's legs. So are unmarked crossings (in BC a crosswalk away from a junction exists
only where it is marked), those with a signal, and a second crossing within MERGE_M of one already
kept on the same street.

Each crossing is kept as a point along an edge (`edge`, `s` metres along its centreline) and where
that is (`x`, `y`), with how it is painted (`zebra`: bars along the traffic, as zebra, ladder and
unspecified markings are; `lines`: two lines across it, as lines, dots and dashes are) and whether it
has a refuge island.

The file is separate from the pack (`<key>.crossings.v1.json`), so adding it leaves the streets as
they were.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from .. import geometry as g
from . import fetch
from .graph import is_drivable
from .parse import OsmData, parse_xml
from .project import Projection

CROSSINGS_VERSION = "1"
SNAP_M = 3.0
JUNCTION_M = 16.0
MERGE_M = 8.0
END_M = 12.0          # (nor this close to a dead end or the edge of the map, where people turn back)
MARKED = ("uncontrolled", "marked", "zebra")
NOT_MARKED = ("unmarked", "no", "informal", "traffic_signals", "impossible")
# how each marking is painted: bars along the traffic (`zebra`), or two lines across it (`lines`)
LINES = ("lines", "dots", "dashes", "surface")

Bbox = Tuple[float, float, float, float]


def crossings_path(maps_dir: Path, bbox: Bbox) -> Path:
    return maps_dir / ("%s.crossings.v%s.json" % (fetch.cache_key(bbox), CROSSINGS_VERSION))


def load_crossings(bbox: Bbox, maps_dir: Path) -> Optional[dict]:
    path = crossings_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_crossings(bbox: Bbox, maps_dir: Path, pack: dict, force: bool = False,
                    log: Callable[[str], None] = lambda m: None) -> Optional[dict]:
    """The cached crossings for a bbox, built from its raw OSM download if that is on disk (it is
    never downloaded here). None when there is neither."""
    path = crossings_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    xml_path = fetch.cache_path(maps_dir, bbox)
    if not xml_path.is_file():
        return None
    crossings = crossings_from_osm(parse_xml(xml_path), pack)
    log("map: built %s (%d crosswalks)" % (path.name, len(crossings["crossings"])))
    path.write_text(json.dumps(crossings, separators=(",", ":")))
    return crossings


def markings(tags: dict) -> Optional[str]:
    """How a crossing node is painted (`zebra` or `lines`), or None when it is not a marked crossing
    without a signal."""
    kind = (tags.get("crossing") or "").lower()
    marks = [m.strip() for m in (tags.get("crossing:markings") or "").lower().split(";") if m.strip()]
    if kind in NOT_MARKED or marks == ["no"] or tags.get("crossing:signals") == "yes":
        return None
    if tags.get("highway") == "traffic_signals":
        return None
    marks = [m for m in marks if m != "no"]
    if marks:
        return "lines" if marks[0] in LINES else "zebra"
    return "zebra" if kind in MARKED else None


def crossings_from_osm(osm: OsmData, pack: dict) -> dict:
    origin = pack.get("origin") or {}
    proj = Projection(origin.get("lat", 0.0), origin.get("lon", 0.0))
    on_road = set()
    for w in osm.ways:
        if is_drivable(w["tags"], include_service=False):
            on_road.update(w["nodes"])
    nodes = {n["id"]: (n["x"], n["y"]) for n in pack["nodes"]}
    # streets meeting at each node (a two-way street is two edges), and the ring's nodes
    streets: Dict[str, set] = {}
    for e in pack["edges"]:
        for a, b in ((e["from"], e["to"]), (e["to"], e["from"])):
            streets.setdefault(a, set()).add(b)
    ring = {v for rb in pack.get("roundabouts") or [] for v in rb.get("vertices") or []}
    junctions = [nodes[n] for n, near in streets.items() if n in nodes and (len(near) >= 3 or n in ring)]
    ends = [nodes[n] for n, near in streets.items() if n in nodes and len(near) == 1]
    edges = [e for e in pack["edges"] if not e.get("ring")]
    kept: List[dict] = []
    for nid in sorted(on_road):
        if nid not in osm.nodes:
            continue
        lat, lon, tags = osm.nodes[nid]
        if tags.get("highway") != "crossing" and "crossing" not in tags:
            continue
        mark = markings(tags)
        if mark is None:
            continue
        p = proj.to_xy(lat, lon)
        if any(math.hypot(p[0] - q[0], p[1] - q[1]) < JUNCTION_M for q in junctions):
            continue
        if any(math.hypot(p[0] - q[0], p[1] - q[1]) < END_M for q in ends):
            continue
        snap = _snap(edges, p)
        if snap is None:
            continue
        e, s, q = snap
        if s < END_M or s > e["length"] - END_M:
            continue
        twin = {e["id"]} | {o["id"] for o in edges if o["from"] == e["to"] and o["to"] == e["from"]}
        if any(c["street"] & twin and math.hypot(c["x"] - q[0], c["y"] - q[1]) < MERGE_M for c in kept):
            continue
        kept.append({"id": "x%d" % nid, "edge": e["id"], "s": g.r1(s), "x": g.r2(q[0]), "y": g.r2(q[1]),
                     "markings": mark, "island": tags.get("crossing:island") == "yes", "street": twin})
    for c in kept:
        c.pop("street")
    return {"crossings_version": CROSSINGS_VERSION, "name": pack.get("name", ""),
            "crossings": sorted(kept, key=lambda c: c["id"])}


def _snap(edges: List[dict], p: Tuple[float, float]):
    """The edge whose centreline passes nearest p, within SNAP_M: (edge, s along it, the point)."""
    best = None
    for e in edges:
        pts = e["pts"]
        cum = g.cumulative_s([tuple(q) for q in pts])
        scale = e["length"] / cum[-1] if cum[-1] > 0 else 1.0
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            dx, dy = b[0] - a[0], b[1] - a[1]
            seg2 = dx * dx + dy * dy
            if seg2 == 0:
                continue
            t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / seg2))
            q = (a[0] + dx * t, a[1] + dy * t)
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            if d <= SNAP_M and (best is None or d < best[0]):
                best = (d, e, (cum[i] + t * (cum[i + 1] - cum[i])) * scale, q)
    return None if best is None else best[1:]
