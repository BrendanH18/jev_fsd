"""Driveways for a map pack, from OpenStreetMap, beside the unchanged pack.

    driveways = build_driveways(bbox, maps_dir, pack)   # cached beside the pack; None without the raw OSM
    driveways = driveways_from_osm(osm, pack)

A driveway is a way tagged `highway=service` + `service=driveway` whose end node lies on a pack
street: on its centreline, or no more than NEAR_M outside its asphalt (a driveway mapped up to the
kerb). For each such end, the layer keeps where the driveway meets the street (`x`, `y`, the point on
the street's centreline, and `s`, how far along the edge), the edge, the side of the street the
driveway is on, seen along the edge's direction of travel (`side`: "right" or "left", by the sim's
`lateral > 0` = right convention), and the driveway's heading (`heading`, radians counter-clockwise
from +x, pointing from the street into the driveway: the way a car parked nose-in faces). On a
two-way street the edge kept is the one whose right side the driveway is on, so the near lane is
that edge's kerb lane. `length` is how far the driveway runs from the street (as mapped).

Driveways meeting a street within END_M of a junction, crossing it at a shallow angle (less than
MIN_ANGLE_DEG from it), or on a roundabout ring are left out. A second driveway within MERGE_M of one
already kept on the same side of the same street (one mapped twice) is the same one.

The file is separate from the pack (`<key>.driveways.v1.json`), so adding it leaves the streets as
they were. The sim (static/js/sim/driveway-reversers.js) has cars back out of these now and then;
nothing else reads it.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from .. import geometry as g
from . import fetch
from .parse import OsmData, parse_xml
from .project import Projection

DRIVEWAYS_VERSION = "1"
NEAR_M = 2.0          # an end node this far outside a street's asphalt still meets it
END_M = 8.0           # (a driveway this close to an edge's end belongs to the junction)
MIN_ANGLE_DEG = 35.0
MERGE_M = 3.0
LOOK_M = 6.0          # the driveway's heading: from where it meets the street to this far along it

Bbox = Tuple[float, float, float, float]


def driveways_path(maps_dir: Path, bbox: Bbox) -> Path:
    return maps_dir / ("%s.driveways.v%s.json" % (fetch.cache_key(bbox), DRIVEWAYS_VERSION))


def load_driveways(bbox: Bbox, maps_dir: Path) -> Optional[dict]:
    path = driveways_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_driveways(bbox: Bbox, maps_dir: Path, pack: dict, force: bool = False,
                    log: Callable[[str], None] = lambda m: None) -> Optional[dict]:
    """The cached driveways for a bbox, built from its raw OSM download if that is on disk (it is never
    downloaded here). None when there is neither."""
    path = driveways_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    xml_path = fetch.cache_path(maps_dir, bbox)
    if not xml_path.is_file():
        return None
    layer = driveways_from_osm(parse_xml(xml_path), pack)
    path.write_text(json.dumps(layer, separators=(",", ":")))
    log("map: built %s (%d driveways)" % (path.name, len(layer["driveways"])))
    return layer


def is_driveway(tags: dict) -> bool:
    return tags.get("highway") == "service" and tags.get("service") == "driveway" and tags.get("area") != "yes"


def _wrap(a: float) -> float:
    while a > math.pi:
        a -= 2 * math.pi
    while a <= -math.pi:
        a += 2 * math.pi
    return a


def _nearest(edges: List[dict], p: Tuple[float, float]):
    """The edge whose asphalt passes nearest p, within NEAR_M outside it: (edge, s along it, the point on
    its centreline, lateral offset of p right of travel, the edge's heading there)."""
    best = None
    for e in edges:
        pts = e["pts"]
        cum = g.cumulative_s([tuple(q) for q in pts])
        scale = e["length"] / cum[-1] if cum[-1] > 0 else 1.0
        left, right = e.get("asphalt") or [-e.get("width", 6) / 2, e.get("width", 6) / 2]
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            dx, dy = b[0] - a[0], b[1] - a[1]
            seg2 = dx * dx + dy * dy
            if seg2 == 0:
                continue
            t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / seg2))
            q = (a[0] + dx * t, a[1] + dy * t)
            h = math.atan2(dy, dx)
            lat = (p[0] - q[0]) * math.sin(h) - (p[1] - q[1]) * math.cos(h)
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            outside = max(0.0, lat - right) if lat >= 0 else max(0.0, left - lat)
            if outside > NEAR_M:
                continue
            if best is None or d < best[0]:
                best = (d, e, (cum[i] + t * (cum[i + 1] - cum[i])) * scale, q, lat, h)
    return None if best is None else best[1:]


def _point_along(pts: List[Tuple[float, float]], dist: float) -> Tuple[float, float]:
    """The point `dist` metres along a polyline (its end, if it is shorter)."""
    run = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = math.dist(a, b)
        if seg > 0 and run + seg >= dist:
            t = (dist - run) / seg
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        run += seg
    return pts[-1]


def driveways_from_osm(osm: OsmData, pack: dict) -> dict:
    origin = pack.get("origin") or {}
    proj = Projection(origin.get("lat", 0.0), origin.get("lon", 0.0))
    edges = [e for e in pack["edges"] if not e.get("ring")]
    by_id = {e["id"]: e for e in edges}
    kept: List[dict] = []
    for w in osm.ways:
        if not is_driveway(w["tags"]):
            continue
        pts = [proj.to_xy(*osm.nodes[n][:2]) for n in w["nodes"] if n in osm.nodes]
        if len(pts) < 2:
            continue
        for end, line in ((0, pts), (-1, pts[::-1])):
            hit = _nearest(edges, line[0])
            if hit is None:
                continue
            e, s, q, lat, h = hit
            if s < END_M or s > e["length"] - END_M:
                continue
            # (the driveway's way away from the street: from the centreline point to LOOK_M along it)
            far = _point_along(line, LOOK_M)
            heading = math.atan2(far[1] - q[1], far[0] - q[0])
            across = abs(_wrap(heading - h))
            if min(across, math.pi - across) < math.radians(MIN_ANGLE_DEG):
                continue
            side_lat = (far[0] - q[0]) * math.sin(h) - (far[1] - q[1]) * math.cos(h)
            side = "right" if side_lat > 0 else "left"
            # (on a two-way street, the edge whose right side it is on)
            if side == "left" and not e.get("oneway"):
                twin = next((o for o in edges if o["from"] == e["to"] and o["to"] == e["from"] and abs(o["length"] - e["length"]) < 1.0), None)
                if twin is not None:
                    e, s, side = twin, twin["length"] - s, "right"
                    if s < END_M or s > e["length"] - END_M:
                        continue
            if any(d["edge"] == e["id"] and d["side"] == side and abs(d["s"] - s) < MERGE_M for d in kept):
                continue
            length = sum(math.dist(a, b) for a, b in zip(line, line[1:]))
            kept.append({"id": "d%d%s" % (w["id"], "" if end == 0 else "b"), "way": w["id"], "edge": e["id"],
                         "s": g.r1(s), "side": side, "x": g.r2(q[0]), "y": g.r2(q[1]),
                         "heading": round(heading, 3), "length": g.r1(length), "name": by_id[e["id"]].get("name", "")})
    return {"driveways_version": DRIVEWAYS_VERSION, "name": pack.get("name", ""),
            "driveways": sorted(kept, key=lambda d: (d["edge"], d["s"]))}
