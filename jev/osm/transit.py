"""Bus routes and their stops for a map pack, from OpenStreetMap route relations.

    transit = build_transit(bbox, maps_dir, pack)   # cached beside the pack; None without the raw OSM
    transit = transit_from_osm(osm, pack)

Each bus or trolleybus route's ways are joined end to end in the order the relation lists them, and
the stretches the pack's street graph has become runs: chains of its directed edges, the way a bus
drives them. A run ends where the route leaves the map or the graph, or goes between two of its
junctions where the graph has no edge, and is kept if it is at least MIN_RUN_M long. A chain of a
single two-way way is dropped: nothing says which way along it the bus goes.

The route's stops (its platform and stop members: the bus stop sign by the curb, or the stop on the
road) are placed along each run, on the right-hand side of the street within STOP_REACH_M of its
centreline, and not within STOP_END_M of either end of the run. A stop is kept as a point along an
edge (`edge`, `s` metres along its centreline) and where its sign stands (`x`, `y`).

The file is separate from the pack (`<key>.transit.v1.json`), so adding it leaves the streets as
they were.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from .. import geometry as g
from . import fetch
from .parse import OsmData, parse_xml
from .project import Projection

TRANSIT_VERSION = "1"
MIN_RUN_M = 150.0
STOP_REACH_M = 25.0
STOP_LEFT_M = 3.0     # (a stop on the road can be a little left of the street's centreline)
STOP_END_M = 15.0
STOP_MERGE_M = 30.0   # a route's sign and its stop on the road, this close along the run, are one stop
SIGN_BACK_M = 1.2     # a stop on the road has its sign this far beyond the edge of the asphalt
STOP_ROLES = ("stop", "stop_entry_only", "stop_exit_only", "platform", "platform_entry_only", "platform_exit_only")

Bbox = Tuple[float, float, float, float]


def transit_path(maps_dir: Path, bbox: Bbox) -> Path:
    return maps_dir / ("%s.transit.v%s.json" % (fetch.cache_key(bbox), TRANSIT_VERSION))


def load_transit(bbox: Bbox, maps_dir: Path) -> Optional[dict]:
    path = transit_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_transit(bbox: Bbox, maps_dir: Path, pack: dict, force: bool = False,
                  log: Callable[[str], None] = lambda m: None) -> Optional[dict]:
    """The cached transit for a bbox, built from its raw OSM download if that is on disk (it is never
    downloaded here). None when there is neither."""
    path = transit_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    xml_path = fetch.cache_path(maps_dir, bbox)
    if not xml_path.is_file():
        return None
    transit = transit_from_osm(parse_xml(xml_path), pack)
    log("map: built %s (%d routes, %d stops)" % (path.name, len(transit["routes"]), len(transit["stops"])))
    path.write_text(json.dumps(transit, separators=(",", ":")))
    return transit


def transit_from_osm(osm: OsmData, pack: dict) -> dict:
    origin = pack.get("origin") or {}
    proj = Projection(origin.get("lat", 0.0), origin.get("lon", 0.0))
    nodes = {n["id"] for n in pack["nodes"]}
    between: Dict[Tuple[str, str], List[dict]] = {}
    for e in pack["edges"]:
        between.setdefault((e["from"], e["to"]), []).append(e)
    ways = {w["id"]: w for w in osm.ways}
    routes, stops, seen = [], {}, set()
    for rel in sorted(osm.relations, key=lambda r: r["id"]):
        tags = rel["tags"]
        if tags.get("type") != "route":
            continue
        ref = tags.get("ref") or tags.get("name") or str(rel["id"])
        members = [(ref_id, role) for kind, ref_id, role in rel["members"] if kind == "way" and role in ("", "forward", "backward")]
        signs = []
        for kind, ref_id, role in rel["members"]:
            # (older routes number their stops: "stop 1", "platform 1"; some say which way: "forward:stop")
            role = role.split(" ")[0].split(":")[-1]
            if kind == "node" and role in STOP_ROLES and ref_id in osm.nodes:
                lat, lon, ntags = osm.nodes[ref_id]
                signs.append({"osm": ref_id, "xy": proj.to_xy(lat, lon), "name": ntags.get("name") or "",
                              "road": role.startswith("stop")})
        runs = []
        for chain in _chains(members, ways):
            for run in _runs(chain, nodes, between):
                key = (ref, tuple(e["id"] for e in run))
                if key in seen:
                    continue
                seen.add(key)
                placed = _place_stops(run, signs, stops)
                runs.append({"edges": [e["id"] for e in run], "length": g.r1(sum(e["length"] for e in run)), "stops": placed})
        if runs:
            routes.append({"id": "r%d" % rel["id"], "ref": ref, "name": tags.get("name") or ref,
                           "mode": tags.get("route"), **({"colour": tags["colour"]} if tags.get("colour") else {}), "runs": runs})
    # (a stop is kept once, where a run first placed it)
    for stop in stops.values():
        stop.pop("road", None)
    return {"transit_version": TRANSIT_VERSION, "name": pack.get("name", ""), "routes": routes,
            "stops": sorted(stops.values(), key=lambda s: s["id"])}


def _chains(members: List[Tuple[int, str]], ways: Dict[int, dict]) -> List[List[int]]:
    """The route's ways joined end to end into node sequences, in the order it drives them."""
    chains, cur, known = [], [], False

    def begin(w, role):
        # one way alone gives the direction only if it is one-way, or the route says which way it
        # takes it ("forward", "backward")
        nodes = list(w["nodes"])
        direction = role or _oneway(w["tags"])
        if direction == "backward":
            nodes.reverse()
        return nodes, direction != "both"

    for way_id, role in members:
        w = ways.get(way_id)
        nodes = w["nodes"] if w else []
        if len(nodes) < 2 or nodes[0] == nodes[-1]:
            # (outside the map, or a closed way such as a roundabout: where the route joins and
            # leaves it is not known from its ends)
            if known and len(cur) >= 2:
                chains.append(cur)
            cur, known = [], False
            continue
        if not cur:
            cur, known = begin(w, role)
            continue
        if cur[-1] not in (nodes[0], nodes[-1]) and not known and cur[0] in (nodes[0], nodes[-1]):
            # (the first way, two-way, was taken the wrong way round)
            cur.reverse()
        if cur[-1] == nodes[0]:
            cur += nodes[1:]
        elif cur[-1] == nodes[-1]:
            cur += nodes[-2::-1]
        else:
            if known and len(cur) >= 2:
                chains.append(cur)
            cur, known = begin(w, role)
            continue
        known = True
    if known and len(cur) >= 2:
        chains.append(cur)
    return chains


def _oneway(tags: dict) -> str:
    v = (tags.get("oneway") or "").lower()
    if v in ("-1", "reverse"):
        return "backward"
    if v in ("yes", "true", "1") or tags.get("junction") == "roundabout":
        return "forward"
    return "both"


def _runs(chain: List[int], nodes: set, between: Dict[Tuple[str, str], List[dict]]) -> List[List[dict]]:
    """The stretches of a node sequence along the graph's directed edges, MIN_RUN_M or longer."""
    verts = []
    for n in chain:
        vid = "n%d" % n
        if vid in nodes and (not verts or verts[-1] != vid):
            verts.append(vid)
    runs, cur = [], []
    for a, b in zip(verts, verts[1:]):
        options = between.get((a, b))
        if not options:
            if cur:
                runs.append(cur)
            cur = []
            continue
        cur.append(min(options, key=lambda e: e["length"]))
    if cur:
        runs.append(cur)
    return [r for r in runs if sum(e["length"] for e in r) >= MIN_RUN_M]


def _place_stops(run: List[dict], signs: List[dict], stops: Dict[str, dict]) -> List[dict]:
    """The route's stops along a run, in order: [{id, edge, s}]. New ones are added to `stops`."""
    pts, owner, cum = [], [], [0.0]
    for e in run:
        epts = [tuple(p) for p in e["pts"]]
        start = cum[-1] if pts else 0.0
        ecum = g.cumulative_s(epts)
        scale = e["length"] / ecum[-1] if ecum[-1] > 0 else 1.0
        for i in range(len(epts) - 1):
            pts.append((epts[i], epts[i + 1]))
            owner.append((e, start + ecum[i] * scale, ecum[i] * scale, (ecum[i + 1] - ecum[i]) * scale))
        cum.append(start + e["length"])
    total = cum[-1]
    placed = []
    for sign in signs:
        best = None
        for (a, b), (e, s_run, s_edge, seg_len) in zip(pts, owner):
            dx, dy = b[0] - a[0], b[1] - a[1]
            seg2 = dx * dx + dy * dy
            if seg2 == 0:
                continue
            p = sign["xy"]
            t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / seg2))
            q = (a[0] + dx * t, a[1] + dy * t)
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            lateral = ((p[0] - q[0]) * dy - (p[1] - q[1]) * dx) / math.sqrt(seg2)
            if d > STOP_REACH_M or lateral < -STOP_LEFT_M:
                continue
            if best is None or d < best[0]:
                best = (d, s_run + t * seg_len, e, s_edge + t * seg_len, q, math.atan2(dy, dx), lateral)
        if best is None:
            continue
        _d, s_run, e, s_edge, q, heading, lateral = best
        if s_run < STOP_END_M or s_run > total - STOP_END_M:
            continue
        # (one stop: a sign and its stop on the road, or a route listing both sides' stops)
        near = next((p for p in placed if abs(p["s_run"] - s_run) < STOP_MERGE_M), None)
        sid = "s%d" % sign["osm"]
        if near:
            # (the sign by the curb, rather than the stop on the road, says where the sign stands)
            if not sign["road"] and stops[near["id"]].get("road"):
                stops[near["id"]].update(x=g.r2(sign["xy"][0]), y=g.r2(sign["xy"][1]), road=False)
            continue
        if sid not in stops:
            x, y = sign["xy"]
            if sign["road"] or lateral < e["asphalt"][1] + 0.3:
                # (on the road: its sign stands just beyond the edge of the asphalt)
                back = e["asphalt"][1] + SIGN_BACK_M
                x, y = q[0] + math.sin(heading) * back, q[1] - math.cos(heading) * back
            stops[sid] = {"id": sid, "name": sign["name"], "x": g.r2(x), "y": g.r2(y), "road": sign["road"]}
        placed.append({"id": sid, "edge": e["id"], "s": g.r1(s_edge), "s_run": s_run})
    placed.sort(key=lambda p: p["s_run"])
    return [{"id": p["id"], "edge": p["edge"], "s": p["s"]} for p in placed]
