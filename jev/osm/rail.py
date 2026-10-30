"""Railway tracks and their level crossings with the streets of a map pack, from OpenStreetMap.

    rail = build_rail(bbox, maps_dir, pack)   # cached beside the pack; None without the raw OSM
    rail = rail_from_osm(osm, pack)

A track is a chain of railway ways (`railway` is rail, light_rail, tram or narrow_gauge, of one kind,
and not disused) joined end to end where exactly two of them meet, clipped to the pack's extent (the
longest stretch inside it with a crossing). A level crossing is a node of a track tagged
`railway=level_crossing` (or `tram_level_crossing`, a road over tram tracks) that is also a node of a
drivable street (service roads aside, as the pack leaves them out), placed on each pack edge whose
centreline passes within SNAP_M of it: both ways of a two-way street. Only tracks with a crossing on
the pack's streets are kept: a train runs on those (static/js/sim/rail.js).

Each track is kept as its points (`pts`, metres in the pack's frame), its length, its stops (nodes
tagged `railway` tram_stop, halt or station on it, or within STOP_NEAR_M of it, as metres along it)
and how each of its ends finishes (`ends`): `terminus` where the track ends inside the map (a
buffer stop or a dead end), `edge` where it leaves the map. Each crossing is kept as where it is
along its track (`s`) and on the map (`x`, `y`), the track's heading there, what warns of a train
(`lights`, `gates`, `bell`: OSM's crossing:light, crossing:barrier and crossing:bell), and for each
pack edge it crosses, how far along the edge (`s`) and the angle between the street and the track
(`angle_deg`, 90 square across).

The file is separate from the pack (`<key>.rail.v1.json`), so adding it leaves the streets as they
were.
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

RAIL_VERSION = "1"
KINDS = ("rail", "light_rail", "tram", "narrow_gauge")
CROSSING_TAGS = ("level_crossing", "tram_level_crossing")
STOP_TAGS = ("tram_stop", "halt", "station")
SNAP_M = 3.0
STOP_NEAR_M = 12.0
MIN_ANGLE_DEG = 20.0   # (a track this nearly along a street runs in it: not a crossing of it)

Bbox = Tuple[float, float, float, float]
Point = Tuple[float, float]


def rail_path(maps_dir: Path, bbox: Bbox) -> Path:
    return maps_dir / ("%s.rail.v%s.json" % (fetch.cache_key(bbox), RAIL_VERSION))


def load_rail(bbox: Bbox, maps_dir: Path) -> Optional[dict]:
    path = rail_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_rail(bbox: Bbox, maps_dir: Path, pack: dict, force: bool = False,
               log: Callable[[str], None] = lambda m: None) -> Optional[dict]:
    """The cached tracks and level crossings for a bbox, built from its raw OSM download if that is
    on disk (it is never downloaded here). None when there is neither."""
    path = rail_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    xml_path = fetch.cache_path(maps_dir, bbox)
    if not xml_path.is_file():
        return None
    rail = rail_from_osm(parse_xml(xml_path), pack)
    log("map: built %s (%d tracks, %d level crossings)" % (path.name, len(rail["tracks"]), len(rail["crossings"])))
    path.write_text(json.dumps(rail, separators=(",", ":")))
    return rail


def is_track(tags: dict) -> bool:
    return tags.get("railway") in KINDS and tags.get("disused") != "yes" and tags.get("abandoned") != "yes"


def rail_from_osm(osm: OsmData, pack: dict) -> dict:
    origin = pack.get("origin") or {}
    proj = Projection(origin.get("lat", 0.0), origin.get("lon", 0.0))
    extent = pack.get("extent") or [-1e9, -1e9, 1e9, 1e9]
    on_road = set()
    for w in osm.ways:
        if is_drivable(w["tags"], include_service=False):
            on_road.update(w["nodes"])
    edges = [e for e in pack["edges"] if not e.get("ring")]
    tracks, crossings = [], []
    for chain, kind, tags in _chains([w for w in osm.ways if is_track(w["tags"])]):
        ids = [n for n in chain if n in osm.nodes]
        if len(ids) < 2:
            continue
        pts = [proj.to_xy(*osm.nodes[n][:2]) for n in ids]
        level = [i for i, n in enumerate(ids) if n in on_road and osm.nodes[n][2].get("railway") in CROSSING_TAGS]
        if not level:
            continue
        piece = _clip(pts, extent, [pts[i] for i in level])
        if piece is None:
            continue
        kept, (a_in, b_in) = piece
        cum = g.cumulative_s(kept)
        tid = "t%d" % tags["_first"]
        found = []
        for i in level:
            nid = ids[i]
            p = pts[i]
            q = g.project_point(kept, p, cum)
            if q["distance"] > 0.5:
                continue
            on = []
            for e in edges:
                hit = _snap(e, p)
                if hit is None:
                    continue
                s, street = hit
                angle = abs(g.wrap_angle(street - q["heading"]))
                angle = math.degrees(min(angle, math.pi - angle))
                if angle >= MIN_ANGLE_DEG:
                    on.append({"edge": e["id"], "s": g.r1(s), "angle_deg": g.r1(angle)})
            if not on:
                continue
            ntags = osm.nodes[nid][2]
            found.append({"id": "lx%d" % nid, "track": tid, "s": g.r1(q["s"]), "x": g.r2(p[0]), "y": g.r2(p[1]),
                          "heading_deg": g.r1(math.degrees(q["heading"])),
                          "lights": ntags.get("crossing:light") not in (None, "no"), "gates": ntags.get("crossing:barrier") not in (None, "no"),
                          "bell": ntags.get("crossing:bell") not in (None, "no"), "edges": sorted(on, key=lambda o: o["edge"])})
        if not found:
            continue
        stops = []
        for n, (lat, lon, ntags) in osm.nodes.items():
            if ntags.get("railway") not in STOP_TAGS:
                continue
            q = g.project_point(kept, proj.to_xy(lat, lon), cum)
            if q["distance"] <= STOP_NEAR_M and 0 < q["s"] < cum[-1]:
                stops.append({"id": "rs%d" % n, "name": ntags.get("name") or "", "s": g.r1(q["s"])})
        # (an end inside the map is a terminus: the track stops there; one cut by the map's edge goes on)
        ends = ["terminus" if a_in else "edge", "terminus" if b_in else "edge"]
        tracks.append({"id": tid, "kind": kind, "name": tags.get("name") or "", "operator": tags.get("operator") or "",
                       "usage": tags.get("usage") or "", "length": g.r1(cum[-1]), "ends": ends,
                       "pts": [[g.r2(x), g.r2(y)] for x, y in kept], "stops": sorted(stops, key=lambda st: st["s"])})
        crossings.extend(found)
    return {"rail_version": RAIL_VERSION, "name": pack.get("name", ""),
            "tracks": sorted(tracks, key=lambda t: t["id"]), "crossings": sorted(crossings, key=lambda c: c["id"])}


def _chains(ways: List[dict]):
    """The track ways joined into chains end to end, where exactly two ways of one kind meet:
    [(node ids, kind, tags of its first way with `_first` its id)], in a stable order."""
    ends: Dict[Tuple[int, str], List[dict]] = {}
    for w in ways:
        if len(w["nodes"]) < 2:
            continue
        for n in (w["nodes"][0], w["nodes"][-1]):
            ends.setdefault((n, w["tags"]["railway"]), []).append(w)
    used, out = set(), []
    for w in sorted(ways, key=lambda w: w["id"]):
        if w["id"] in used or len(w["nodes"]) < 2:
            continue
        kind = w["tags"]["railway"]
        used.add(w["id"])
        chain = list(w["nodes"])
        for forward in (True, False):
            while True:
                tip = chain[-1] if forward else chain[0]
                meet = ends.get((tip, kind), [])
                if len(meet) != 2:
                    break
                nxt = next((o for o in meet if o["id"] not in used), None)
                if nxt is None:
                    break
                used.add(nxt["id"])
                nodes = nxt["nodes"] if nxt["nodes"][0] == tip else list(reversed(nxt["nodes"]))
                if not forward:
                    nodes = list(reversed(nodes))
                    chain = nodes[:-1] + chain
                else:
                    chain = chain + nodes[1:]
        # (a chain runs from its lower end node to its higher, so either way round it is the same)
        if chain[0] > chain[-1]:
            chain.reverse()
        out.append((chain, kind, {**w["tags"], "_first": w["id"]}))
    return out


def _inside(p: Point, extent) -> bool:
    return extent[0] <= p[0] <= extent[2] and extent[1] <= p[1] <= extent[3]


def _clip(pts: List[Point], extent, must: List[Point]):
    """The longest stretch of the polyline inside the extent that passes through a point of `must`,
    cut where it crosses the extent's edge: (points, (its start is the polyline's, its end is)), or
    None."""
    pieces, cur, start_in = [], [], False
    for i, p in enumerate(pts):
        if _inside(p, extent):
            if not cur:
                start_in = i == 0
                if i > 0:
                    cur.append(_cut(p, pts[i - 1], extent))
            cur.append(p)
        elif cur:
            cur.append(_cut(cur[-1], p, extent))
            pieces.append((cur, start_in, False))
            cur = []
    if cur:
        pieces.append((cur, start_in, True))
    best = None
    for piece, a_in, b_in in pieces:
        piece = g.dedupe_consecutive(piece)
        if len(piece) < 2 or not any(q in piece for q in must):
            continue
        if best is None or g.polyline_length(piece) > g.polyline_length(best[0]):
            best = (piece, (a_in, b_in))
    return best


def _cut(a: Point, b: Point, extent) -> Point:
    """Where the segment from `a` (inside the extent) to `b` (outside) crosses the extent's edge."""
    t = 1.0
    for k, lo, hi in ((0, extent[0], extent[2]), (1, extent[1], extent[3])):
        d = b[k] - a[k]
        if d > 0 and b[k] > hi:
            t = min(t, (hi - a[k]) / d)
        elif d < 0 and b[k] < lo:
            t = min(t, (lo - a[k]) / d)
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _snap(e: dict, p: Point) -> Optional[Tuple[float, float]]:
    """Where edge `e`'s centreline passes within SNAP_M of p, beside it and not off either end: (s
    along it, the street's heading there), or None."""
    pts = [tuple(q) for q in e["pts"]]
    cum = g.cumulative_s(pts)
    q = g.project_point(pts, p, cum)
    if q["distance"] > SNAP_M or q["s"] <= 0 or q["s"] >= cum[-1]:
        return None
    scale = e["length"] / cum[-1] if cum[-1] > 0 else 1.0
    return q["s"] * scale, q["heading"]
