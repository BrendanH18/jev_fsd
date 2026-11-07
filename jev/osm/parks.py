"""Parks and water for a map pack, from OpenStreetMap, beside the unchanged pack: where Canada geese live.

    parks = build_parks(bbox, maps_dir, pack)   # cached beside the pack; None without the raw OSM
    parks = parks_from_osm(osm, pack)

An area is a way or multipolygon tagged as a park (`leisure=park`), a garden (`leisure=garden`), a
recreation ground (`leisure=recreation_ground`), a lawn (`landuse=grass`) or water (`natural=water`,
`waterway=riverbank`), or a river or canal (`waterway=river|canal`, a line). Each is kept with its kind
(`park`, `garden`, `recreation_ground`, `grass`, `water`, `river` or `canal`), name and outlines
(`rings`, in pack metres, simplified to SIMPLIFY_M; a multipolygon's outer ways joined, and closed
where the download has all of it: `closed`), or its line (`lines`, for a river or canal). Areas
smaller than MIN_AREA_M2 for their kind are left out: a parkette, a planter or a boulevard's strip of
grass is no place for a gaggle.

The layer also keeps the stretches of pack streets beside or between them (`spans`): every stretch of
a street (each way the traffic goes, so a two-way street has a stretch in each direction) whose
centreline passes within REACH_M of an area's outline, or a river's or canal's line, or runs inside an
area, on either side. A span is kept with its `edge`, `from` and `to` (metres along its centreline),
the area on each side (`left`, `right`: an area's id or null, by the sim's convention that `right` is
right of travel; a street through a park has the park on both sides) and whether either is water
(`water`). Stretches with the same areas either side closer together than JOIN_M are one; those
shorter than MIN_SPAN_M (a corner clipped) are left out, as are roundabout rings. This is where a
gaggle might cross (static/js/sim/geese.js).

The file is separate from the pack (`<key>.parks.v1.json`), so adding it leaves the streets as they
were. Nothing reads it but the geese.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .. import geometry as g
from . import fetch
from .parse import OsmData, parse_xml
from .project import Projection
from .zones import _inside, _join, _to_segment

PARKS_VERSION = "1"
REACH_M = 25.0        # an area this near a street's centreline is beside it
STEP_M = 2.0          # each street is checked this often along its centreline
JOIN_M = 10.0
MIN_SPAN_M = 20.0
SIMPLIFY_M = 1.0
# The smallest of each kind that geese live by, in square metres (rivers and canals are lines: any).
MIN_AREA_M2 = {"park": 800.0, "garden": 1500.0, "recreation_ground": 1000.0, "grass": 2500.0, "water": 300.0}

Bbox = Tuple[float, float, float, float]
Point = Tuple[float, float]


def parks_path(maps_dir: Path, bbox: Bbox) -> Path:
    return maps_dir / ("%s.parks.v%s.json" % (fetch.cache_key(bbox), PARKS_VERSION))


def load_parks(bbox: Bbox, maps_dir: Path) -> Optional[dict]:
    path = parks_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_parks(bbox: Bbox, maps_dir: Path, pack: dict, force: bool = False,
                log: Callable[[str], None] = lambda m: None) -> Optional[dict]:
    """The cached parks for a bbox, built from its raw OSM download if that is on disk (it is never
    downloaded here). None when there is neither."""
    path = parks_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    xml_path = fetch.cache_path(maps_dir, bbox)
    if not xml_path.is_file():
        return None
    layer = parks_from_osm(parse_xml(xml_path), pack)
    path.write_text(json.dumps(layer, separators=(",", ":")))
    log("map: built %s (%d parks and waters, %d street spans beside them)" % (path.name, len(layer["areas"]), len(layer["spans"])))
    return layer


def kind_of(tags: dict) -> Optional[str]:
    """`park`, `garden`, `recreation_ground`, `grass`, `water`, `river`, `canal`, or None."""
    leisure = tags.get("leisure")
    if leisure in ("park", "garden", "recreation_ground"):
        return leisure
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank":
        return "water"
    if tags.get("waterway") in ("river", "canal"):
        return tags["waterway"]
    if tags.get("landuse") == "grass":
        return "grass"
    return None


def is_water(kind: str) -> bool:
    return kind in ("water", "river", "canal")


def areas(osm: OsmData, proj: Projection) -> List[dict]:
    """Every park and water: {id, kind, name, rings, closed, lines}, simplified, big enough."""
    out = []

    def outline(node_ids: Sequence[int]) -> List[Point]:
        return [proj.to_xy(*osm.nodes[n][:2]) for n in node_ids if n in osm.nodes]

    def keep(kind: str, aid: str, name: str, rings: List[List[Point]]) -> None:
        if kind in ("river", "canal"):
            lines = [g.douglas_peucker(r, SIMPLIFY_M) for r in rings if len(r) >= 2]
            if lines:
                out.append({"id": aid, "kind": kind, "name": name, "rings": [], "closed": False,
                            "lines": [[[g.r1(x), g.r1(y)] for x, y in line] for line in lines]})
            return
        rings = [r for r in rings if len(r) >= 3]
        closed = bool(rings) and all(r[0] == r[-1] for r in rings)
        # (an outline the download cut off has no area to measure: kept if what is there spans enough)
        size = sum(abs(g.polygon_area(r)) for r in rings if r[0] == r[-1])
        if not closed:
            xs = [x for r in rings for x, _ in r]
            ys = [y for r in rings for _, y in r]
            size = max(size, (max(xs) - min(xs)) * (max(ys) - min(ys)) / 2) if xs else 0.0
        if not rings or size < MIN_AREA_M2[kind]:
            return
        simple = []
        for r in rings:
            s = g.douglas_peucker(r, SIMPLIFY_M)
            if r[0] == r[-1] and s[0] != s[-1]:
                s = list(s) + [s[0]]
            simple.append([[g.r1(x), g.r1(y)] for x, y in s])
        out.append({"id": aid, "kind": kind, "name": name, "rings": simple, "closed": closed, "lines": []})

    ways = {w["id"]: w for w in osm.ways}
    for w in osm.ways:
        kind = kind_of(w["tags"])
        if kind and len(w["nodes"]) >= 2:
            keep(kind, "w%d" % w["id"], w["tags"].get("name", ""), [outline(w["nodes"])])
    for r in osm.relations:
        kind = kind_of(r["tags"])
        if not kind or r["tags"].get("type") != "multipolygon":
            continue
        parts = [ways[ref]["nodes"] for t, ref, role in r["members"] if t == "way" and role in ("outer", "") and ref in ways]
        keep(kind, "r%d" % r["id"], r["tags"].get("name", ""), [outline(nodes) for nodes in _join(parts)])
    return sorted(out, key=lambda a: a["id"])


def _distance(area: dict, p: Point) -> Tuple[float, Optional[Point]]:
    """How far p is from an area's outline (or a river's line), and the nearest point on it; (0, None)
    inside it."""
    best, at = math.inf, None
    for ring in area["rings"]:
        ring = [tuple(q) for q in ring]
        if _inside(ring, p):
            return 0.0, None
        for a, b in zip(ring, ring[1:]):
            d = _to_segment(p, a, b)
            if d < best:
                best, at = d, _nearest_on(p, a, b)
    for line in area["lines"]:
        line = [tuple(q) for q in line]
        for a, b in zip(line, line[1:]):
            d = _to_segment(p, a, b)
            if d < best:
                best, at = d, _nearest_on(p, a, b)
    return best, at


def _nearest_on(p: Point, a: Point, b: Point) -> Point:
    dx, dy = b[0] - a[0], b[1] - a[1]
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / seg2))
    return (a[0] + dx * t, a[1] + dy * t)


def _box(area: dict, pad: float) -> Tuple[float, float, float, float]:
    pts = [q for ring in area["rings"] for q in ring] + [q for line in area["lines"] for q in line]
    return (min(x for x, _ in pts) - pad, min(y for _, y in pts) - pad, max(x for x, _ in pts) + pad, max(y for _, y in pts) + pad)


def parks_from_osm(osm: OsmData, pack: dict) -> dict:
    origin = pack.get("origin") or {}
    proj = Projection(origin.get("lat", 0.0), origin.get("lon", 0.0))
    found = areas(osm, proj)
    boxes = {a["id"]: _box(a, REACH_M) for a in found}
    kinds = {a["id"]: a["kind"] for a in found}
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
        near = [a for a in found if boxes[a["id"]][0] <= max(ex) and boxes[a["id"]][2] >= min(ex)
                and boxes[a["id"]][1] <= max(ey) and boxes[a["id"]][3] >= min(ey)]
        if not near:
            continue
        n = max(1, int(math.ceil(cum[-1] / STEP_M)))
        runs: List[list] = []   # [from, to, left, right]
        for i in range(n + 1):
            s = cum[-1] * i / n
            p = g.point_at(pts, s, cum)
            h = g.heading_at(pts, s, cum)
            sides: Dict[str, Tuple[float, str]] = {}
            for a in near:
                d, q = _distance(a, p)
                if d > REACH_M:
                    continue
                # (inside it, or with it straight ahead or behind along the street, it is either side)
                lat = 0.0 if q is None else (q[0] - p[0]) * math.sin(h) - (q[1] - p[1]) * math.cos(h)
                for side in (("left", "right") if q is None or abs(lat) < 0.5 * d else ("right",) if lat > 0 else ("left",)):
                    if side not in sides or d < sides[side][0]:
                        sides[side] = (d, a["id"])
            if not sides:
                continue
            left, right = sides.get("left", (0, None))[1], sides.get("right", (0, None))[1]
            at = s * scale
            if runs and runs[-1][2] == left and runs[-1][3] == right and at - runs[-1][1] <= JOIN_M:
                runs[-1][1] = at
            # (a blip shorter than JOIN_M with other sides, at a corner, between two of the same, is that one)
            elif len(runs) > 1 and runs[-2][2] == left and runs[-2][3] == right and at - runs[-1][0] <= JOIN_M:
                runs.pop()
                runs[-1][1] = at
            else:
                runs.append([at, at, left, right])
        for a, b, left, right in runs:
            if b - a < MIN_SPAN_M:
                continue
            spans.append({"edge": e["id"], "from": g.r1(a), "to": g.r1(min(b, e["length"])), "left": left, "right": right,
                          "water": any(x is not None and is_water(kinds[x]) for x in (left, right)), "name": e.get("name", "")})
    used = {x for sp in spans for x in (sp["left"], sp["right"]) if x}
    return {"parks_version": PARKS_VERSION, "name": pack.get("name", ""),
            "areas": [a for a in found if a["id"] in used], "spans": spans}
