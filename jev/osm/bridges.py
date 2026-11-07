"""Bridges and overpasses for a map pack, from OpenStreetMap, beside the unchanged pack: where black ice
forms first.

    bridges = build_bridges(bbox, maps_dir, pack)   # cached beside the pack; None without the raw OSM
    bridges = bridges_from_osm(osm, pack)

A bridge is a drivable way (`highway=*`, as the pack's streets: jev/osm/graph.py DRIVABLE) tagged
`bridge=*` (anything but `no`): a bridge over a river, a viaduct, an overpass over another road or a
railway. A deck has cold air under it as well as over it, so it loses heat faster than the road on the
ground and ices over first, while the approaches are still only wet.

The layer keeps the stretches of pack streets that run along one (`spans`): every stretch of a street
(each way the traffic goes, so a two-way bridge has a stretch in each direction) whose centreline lies
within MATCH_M of a bridge way's line, going its way (within MAX_TURN_DEG either way, so a street
passing under the bridge, across it, is not on it). A span is kept with its `edge`, `from` and `to`
(metres along its centreline), the bridge's `name` (its `bridge:name`, else its name) and `kind` (the
`bridge` tag's value: `yes`, `viaduct`, ...). Stretches closer together than JOIN_M are one; those
shorter than MIN_SPAN_M are left out, as are roundabout rings.

The file is separate from the pack (`<key>.bridges.v1.json`), so adding it leaves the streets as they
were. Nothing reads it but black ice (static/js/sim/black-ice.js).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from .. import geometry as g
from . import fetch
from .graph import DRIVABLE
from .parse import OsmData, parse_xml
from .project import Projection
from .zones import _to_segment

BRIDGES_VERSION = "1"
MATCH_M = 4.0          # a street's centreline this near a bridge way's line runs along it
MAX_TURN_DEG = 25.0    # ... going its way, either direction
STEP_M = 2.0           # each street is checked this often along its centreline
JOIN_M = 6.0
MIN_SPAN_M = 8.0

Bbox = Tuple[float, float, float, float]
Point = Tuple[float, float]


def bridges_path(maps_dir: Path, bbox: Bbox) -> Path:
    return maps_dir / ("%s.bridges.v%s.json" % (fetch.cache_key(bbox), BRIDGES_VERSION))


def load_bridges(bbox: Bbox, maps_dir: Path) -> Optional[dict]:
    path = bridges_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_bridges(bbox: Bbox, maps_dir: Path, pack: dict, force: bool = False,
                  log: Callable[[str], None] = lambda m: None) -> Optional[dict]:
    """The cached bridges for a bbox, built from its raw OSM download if that is on disk (it is never
    downloaded here). None when there is neither."""
    path = bridges_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    xml_path = fetch.cache_path(maps_dir, bbox)
    if not xml_path.is_file():
        return None
    layer = bridges_from_osm(parse_xml(xml_path), pack)
    path.write_text(json.dumps(layer, separators=(",", ":")))
    log("map: built %s (%d street spans on bridges)" % (path.name, len(layer["spans"])))
    return layer


def is_bridge(tags: dict) -> bool:
    """A drivable way on a bridge, viaduct or overpass."""
    return tags.get("highway") in DRIVABLE and tags.get("bridge", "no") != "no"


def bridge_ways(osm: OsmData, proj: Projection) -> List[dict]:
    """Every drivable bridge way: {id, name, kind, line (pack metres)}."""
    out = []
    for w in osm.ways:
        tags = w["tags"]
        if not is_bridge(tags):
            continue
        line = [proj.to_xy(*osm.nodes[n][:2]) for n in w["nodes"] if n in osm.nodes]
        if len(line) >= 2:
            out.append({"id": "w%d" % w["id"], "name": tags.get("bridge:name") or tags.get("name", ""), "kind": tags["bridge"], "line": line})
    return out


def _along(way: dict, p: Point, h: float) -> float:
    """How far p lies from the way's line, on a segment within MATCH_M going heading h's way (or back);
    infinity where there is none."""
    best = math.inf
    line = way["line"]
    for i, (a, b) in enumerate(zip(line, line[1:])):
        d = _to_segment(p, a, b)
        if d > MATCH_M or d >= best:
            continue
        # (not beyond either end of the bridge: its abutments are where it ends)
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / max(1e-9, dx * dx + dy * dy)
        if (i == 0 and t < 0) or (i == len(line) - 2 and t > 1):
            continue
        turn = abs(g.wrap_angle(math.atan2(b[1] - a[1], b[0] - a[0]) - h))
        if min(turn, math.pi - turn) <= math.radians(MAX_TURN_DEG):
            best = d
    return best


def bridges_from_osm(osm: OsmData, pack: dict) -> dict:
    origin = pack.get("origin") or {}
    proj = Projection(origin.get("lat", 0.0), origin.get("lon", 0.0))
    ways = bridge_ways(osm, proj)
    boxes = []
    for w in ways:
        xs = [x for x, _ in w["line"]]
        ys = [y for _, y in w["line"]]
        boxes.append((min(xs) - MATCH_M, min(ys) - MATCH_M, max(xs) + MATCH_M, max(ys) + MATCH_M))
    spans = []
    for e in pack["edges"]:
        if e.get("ring"):
            continue
        pts = [tuple(q) for q in e["pts"]]
        cum = g.cumulative_s(pts)
        if cum[-1] <= 0:
            continue
        scale = e["length"] / cum[-1]
        ex = [x for x, _ in pts]
        ey = [y for _, y in pts]
        near = [w for w, b in zip(ways, boxes) if b[0] <= max(ex) and b[2] >= min(ex) and b[1] <= max(ey) and b[3] >= min(ey)]
        if not near:
            continue
        n = max(1, int(math.ceil(cum[-1] / STEP_M)))
        runs: List[list] = []   # [from, to, way]
        for i in range(n + 1):
            s = cum[-1] * i / n
            p = g.point_at(pts, s, cum)
            h = g.heading_at(pts, s, cum)
            # (the nearest bridge way going its way)
            d, way = min(((_along(w, p, h), k) for k, w in enumerate(near)), default=(math.inf, None))
            if way is None or d > MATCH_M:
                continue
            way = near[way]
            at = s * scale
            if runs and at - runs[-1][1] <= JOIN_M:
                runs[-1][1] = at
            else:
                runs.append([at, at, way])
        for a, b, way in runs:
            if b - a < MIN_SPAN_M:
                continue
            spans.append({"edge": e["id"], "from": g.r1(a), "to": g.r1(min(b, e["length"])), "name": way["name"] or e.get("name", ""), "kind": way["kind"]})
    return {"bridges_version": BRIDGES_VERSION, "name": pack.get("name", ""), "spans": spans}
