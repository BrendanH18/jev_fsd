"""OSM ways -> a directed road graph with lane centerlines.

Vertices are OSM nodes shared by two or more drivable ways plus way endpoints. Each drivable way is
cut into segments between vertices; a two-way segment becomes two directed edges (the reverse one
with a reversed polyline). Lanes, width, and speed limit come from tags with per-class defaults.
Only the largest strongly connected component is kept so every pair of edges is mutually reachable.
"""

from __future__ import annotations

import math
import re
from typing import Dict, List, Optional, Tuple

from .. import geometry as g
from .parse import OsmData
from .project import Projection

DRIVABLE = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
    "living_street", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
}
# meters per second
DEFAULT_LIMIT = {
    "motorway": 29.0, "trunk": 25.0, "primary": 18.0, "secondary": 15.6, "tertiary": 13.4,
    "unclassified": 11.2, "residential": 11.2, "living_street": 5.6, "service": 5.6,
}
LANE_WIDTH = {"residential": 3.2, "living_street": 3.0, "service": 3.0}
DEFAULT_LANE_WIDTH = 3.5
MAX_LANES_PER_DIRECTION = 3
SIMPLIFY_EPS_M = 0.3
MIN_EDGE_M = 0.5
PARKING_LANE_M = 2.1
# Classes that have curbside parking on both sides unless tagged otherwise (a Vancouver residential
# street is two travel lanes between two parking lanes).
PARKING_DEFAULT = {"residential", "living_street", "unclassified"}
PARKING_YES = {"lane", "street_side_lane", "on_street", "half_on_kerb", "yes", "parallel"}
BIKE_CYCLEWAY = {"shared_lane", "lane", "shared", "share_busway"}
# Roundabouts (Vancouver's neighborhood traffic circles are tiny): the lane is kept at least this far
# from the center so a car can drive it, and the island inside is at most this big.
RING_MIN_LANE_R = 5.0
RING_MAX_ISLAND_R = 4.5
RING_LANE_TO_ISLAND_M = 2.4
RING_OUTER_M = 2.0              # asphalt beyond the lane centerline


def parse_maxspeed(value: Optional[str], cls: str) -> float:
    """'50', '50 km/h', '25 mph' -> m/s. Falls back to the class default."""
    if value:
        m = re.match(r"\s*(\d+(?:\.\d+)?)\s*(mph|km/h|kmh)?", value)
        if m:
            v = float(m.group(1))
            unit = (m.group(2) or "km/h").lower()
            return v * 0.44704 if unit == "mph" else v / 3.6
    base = cls[:-5] if cls.endswith("_link") else cls
    return DEFAULT_LIMIT.get(base, 11.2)


def _int_tag(tags: dict, key: str) -> Optional[int]:
    v = tags.get(key)
    if v is None:
        return None
    m = re.match(r"\s*(\d+)", v)
    return int(m.group(1)) if m else None


def lanes_per_direction(tags: dict, oneway: bool) -> Tuple[int, int]:
    """(forward, backward) lane counts."""
    fwd, bwd = _int_tag(tags, "lanes:forward"), _int_tag(tags, "lanes:backward")
    total = _int_tag(tags, "lanes")
    if oneway:
        n = fwd or total or 1
        return (min(max(n, 1), MAX_LANES_PER_DIRECTION), 0)
    if fwd is None and bwd is None:
        if total:
            fwd = bwd = max(1, math.ceil(total / 2))
        else:
            fwd = bwd = 1
    elif fwd is None:
        fwd = max(1, (total or 2) - bwd)
    elif bwd is None:
        bwd = max(1, (total or 2) - fwd)
    return (min(max(fwd, 1), MAX_LANES_PER_DIRECTION), min(max(bwd, 1), MAX_LANES_PER_DIRECTION))


def way_direction(tags: dict) -> str:
    """'forward', 'backward', or 'both'."""
    ow = (tags.get("oneway") or "").strip().lower()
    if ow in ("yes", "1", "true") or tags.get("junction") == "roundabout":
        return "forward"
    if ow == "-1":
        return "backward"
    return "both"


def parking_sides(tags: dict, cls: str, oneway: bool) -> Tuple[float, float]:
    """(left, right) curbside parking lane widths in the way's direction. Tags win: parking:both,
    parking:left/right, and the older parking:lane:* scheme. Roundabouts and one-way streets default
    to none, as do arterials, where parking comes and goes with rush hours."""
    def side(name: str) -> Optional[bool]:
        for key in ("parking:%s" % name, "parking:both", "parking:lane:%s" % name, "parking:lane:both"):
            v = tags.get(key)
            if v is None:
                continue
            v = v.lower()
            if v in PARKING_YES:
                orient = tags.get(key + ":orientation") or tags.get("parking:both:orientation") or "parallel"
                return orient == "parallel"
            return False
        return None
    default = cls in PARKING_DEFAULT and not oneway and tags.get("junction") != "roundabout"
    left, right = side("left"), side("right")
    return (PARKING_LANE_M if (default if left is None else left) else 0.0,
            PARKING_LANE_M if (default if right is None else right) else 0.0)


def is_bike_route(tags: dict) -> bool:
    return (tags.get("cycleway") in BIKE_CYCLEWAY or tags.get("cycleway:both") in BIKE_CYCLEWAY
            or tags.get("cycleway:right") in BIKE_CYCLEWAY or tags.get("bicycle") == "designated"
            or tags.get("lcn") == "yes")


def is_drivable(tags: dict, include_service: bool = False) -> bool:
    cls = tags.get("highway")
    if cls not in DRIVABLE and not (include_service and cls == "service"):
        return False
    if tags.get("area") == "yes":
        return False
    if tags.get("access") in ("private", "no") and tags.get("motor_vehicle") not in ("yes", "permissive"):
        return False
    if cls == "service" and tags.get("service") in ("parking_aisle", "driveway"):
        return False
    return True


class RoadGraph:
    def __init__(self):
        self.vertices: Dict[str, dict] = {}
        self.edges: Dict[str, dict] = {}
        self.out_edges: Dict[str, List[str]] = {}
        self.in_edges: Dict[str, List[str]] = {}
        self.stats: dict = {}
        self.roundabouts: List[dict] = []

    def successors(self, edge_id: str) -> List[str]:
        return self.out_edges.get(self.edges[edge_id]["to"], [])

    def predecessors(self, edge_id: str) -> List[str]:
        return self.in_edges.get(self.edges[edge_id]["from"], [])

    def edge_heading_in(self, edge_id: str) -> float:
        pts = self.edges[edge_id]["pts"]
        return g.heading_of(pts[-2], pts[-1])

    def edge_heading_out(self, edge_id: str) -> float:
        pts = self.edges[edge_id]["pts"]
        return g.heading_of(pts[0], pts[1])

    def turn(self, edge_in: str, edge_out: str) -> str:
        return g.classify_turn(g.turn_angle(self.edge_heading_in(edge_in), self.edge_heading_out(edge_out)))

    def turn_angle(self, edge_in: str, edge_out: str) -> float:
        return g.turn_angle(self.edge_heading_in(edge_in), self.edge_heading_out(edge_out))


def build_graph(osm: OsmData, proj: Projection, include_service: bool = False) -> RoadGraph:
    ways = [w for w in osm.ways if is_drivable(w["tags"], include_service) and len(w["nodes"]) >= 2]
    usage: Dict[int, int] = {}
    for w in ways:
        seen = set()
        for nid in w["nodes"]:
            if nid in osm.nodes and nid not in seen:
                usage[nid] = usage.get(nid, 0) + 1
                seen.add(nid)

    graph = RoadGraph()
    raw_edges: List[dict] = []
    for w in ways:
        tags = w["tags"]
        cls = tags["highway"]
        node_ids = [nid for nid in w["nodes"] if nid in osm.nodes]
        if len(node_ids) < 2:
            continue
        direction = way_direction(tags)
        fwd_lanes, bwd_lanes = lanes_per_direction(tags, direction != "both")
        if direction == "backward":
            fwd_lanes, bwd_lanes = 0, (fwd_lanes or 1)
        lane_w = LANE_WIDTH.get(cls, DEFAULT_LANE_WIDTH)
        limit = parse_maxspeed(tags.get("maxspeed"), cls)
        name = tags.get("name") or tags.get("ref") or ""
        width = (fwd_lanes + bwd_lanes) * lane_w
        park_left, park_right = parking_sides(tags, cls, direction != "both")
        bike = is_bike_route(tags)
        ring = w["id"] if tags.get("junction") == "roundabout" else None
        # cut at vertices
        cut_points = [0]
        for i in range(1, len(node_ids) - 1):
            if usage.get(node_ids[i], 0) >= 2:
                cut_points.append(i)
        cut_points.append(len(node_ids) - 1)
        for a, b in zip(cut_points, cut_points[1:]):
            seg_nodes = node_ids[a:b + 1]
            pts = [proj.to_xy(osm.nodes[n][0], osm.nodes[n][1]) for n in seg_nodes]
            pts = g.dedupe_consecutive(pts, 0.05)
            if len(pts) < 2 or g.polyline_length(pts) < MIN_EDGE_M:
                continue
            node_s = _node_positions(seg_nodes, [proj.to_xy(osm.nodes[n][0], osm.nodes[n][1]) for n in seg_nodes])
            base = {"osm_way": w["id"], "cls": cls, "name": name, "limit": limit, "lane_width": lane_w,
                    "width": width, "oneway": direction != "both", "bike": bike, "ring": ring}
            # parking is stored per directed edge as (left, right) of its own direction of travel
            fwd_park = (park_left, park_right) if direction != "backward" else (park_right, park_left)
            if fwd_lanes:
                raw_edges.append(dict(base, src=seg_nodes[0], dst=seg_nodes[-1], pts=pts, lanes=fwd_lanes,
                                      forward=True, node_s=node_s, parking=fwd_park,
                                      offset_base=0.0 if direction != "both" else None))
            if bwd_lanes:
                rev_len = g.polyline_length(pts)
                raw_edges.append(dict(base, src=seg_nodes[-1], dst=seg_nodes[0], pts=list(reversed(pts)),
                                      lanes=bwd_lanes, forward=False, parking=(park_right, park_left),
                                      node_s={n: rev_len - s for n, s in node_s.items()},
                                      offset_base=None))
    graph.stats["ways_drivable"] = len(ways)
    graph.stats["edges_raw"] = len(raw_edges)

    for e in raw_edges:
        for nid in (e["src"], e["dst"]):
            vid = "n%d" % nid
            if vid not in graph.vertices:
                lat, lon, _ = osm.nodes[nid]
                x, y = proj.to_xy(lat, lon)
                graph.vertices[vid] = {"id": vid, "x": x, "y": y, "osm": nid}
    for i, e in enumerate(raw_edges):
        eid = "e%d" % i
        simplified = g.douglas_peucker(e["pts"], SIMPLIFY_EPS_M)
        edge = {
            "id": eid, "from": "n%d" % e["src"], "to": "n%d" % e["dst"], "pts": simplified,
            "lanes": e["lanes"], "lane_width": e["lane_width"], "width": e["width"], "limit": e["limit"],
            "oneway": e["oneway"], "name": e["name"], "cls": e["cls"], "osm_way": e["osm_way"],
            "forward": e["forward"], "length": g.polyline_length(simplified), "node_s": e["node_s"],
            "parking": e["parking"], "bike": e["bike"], "ring": e["ring"],
        }
        graph.edges[eid] = edge
    _prune_to_largest_scc(graph)
    _index(graph)
    _lane_centerlines(graph)
    _roundabouts(graph, osm, proj)
    graph.stats["vertices"] = len(graph.vertices)
    graph.stats["edges"] = len(graph.edges)
    return graph


def _node_positions(node_ids: List[int], pts: List[Tuple[float, float]]) -> Dict[int, float]:
    cum = g.cumulative_s(pts)
    return {nid: cum[i] for i, nid in enumerate(node_ids)}


def _index(graph: RoadGraph) -> None:
    graph.out_edges = {v: [] for v in graph.vertices}
    graph.in_edges = {v: [] for v in graph.vertices}
    for eid, e in graph.edges.items():
        graph.out_edges[e["from"]].append(eid)
        graph.in_edges[e["to"]].append(eid)


def _prune_to_largest_scc(graph: RoadGraph) -> None:
    """Iterative Tarjan over vertices; keep the largest component's vertices and their edges."""
    adj: Dict[str, List[str]] = {v: [] for v in graph.vertices}
    for e in graph.edges.values():
        adj[e["from"]].append(e["to"])
    index = {}
    low = {}
    on_stack = set()
    stack: List[str] = []
    components: List[List[str]] = []
    counter = 0
    for root in graph.vertices:
        if root in index:
            continue
        work = [(root, iter(adj[root]))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        while work:
            v, it = work[-1]
            advanced = False
            for w in it:
                if w not in index:
                    index[w] = low[w] = counter
                    counter += 1
                    stack.append(w)
                    on_stack.add(w)
                    work.append((w, iter(adj[w])))
                    advanced = True
                    break
                if w in on_stack:
                    low[v] = min(low[v], index[w])
            if advanced:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[v])
            if low[v] == index[v]:
                comp = []
                while True:
                    w = stack.pop()
                    on_stack.discard(w)
                    comp.append(w)
                    if w == v:
                        break
                components.append(comp)
    if not components:
        return
    largest = set(max(components, key=len))
    dropped_edges = [eid for eid, e in graph.edges.items() if e["from"] not in largest or e["to"] not in largest]
    for eid in dropped_edges:
        del graph.edges[eid]
    for vid in [v for v in graph.vertices if v not in largest]:
        del graph.vertices[vid]
    graph.stats["components"] = len(components)
    graph.stats["edges_dropped_scc"] = len(dropped_edges)


def _lane_centerlines(graph: RoadGraph) -> None:
    """Lane i (0 = leftmost) centerline is offset to the right of travel by d_i.
    Two-way roads: d_i = (i + 0.5) * w (all lanes right of the way's centerline).
    One-way roads: d_i = (i - (n - 1) / 2) * w (lanes straddle the centerline)."""
    for e in graph.edges.values():
        n, w = e["lanes"], e["lane_width"]
        lanes = []
        for i in range(n):
            d = (i + 0.5) * w if not e["oneway"] else (i - (n - 1) / 2.0) * w
            lanes.append(g.offset_polyline(e["pts"], d))
        e["lane_pts"] = lanes
        e["lane_offsets"] = [((i + 0.5) * w if not e["oneway"] else (i - (n - 1) / 2.0) * w) for i in range(n)]
        # asphalt edges: roads span [-width/2, +width/2] around the way's centerline, so the forward
        # direction sees asphalt from -width/2 (left, oncoming side) to +width/2, widened by the
        # parking lanes along each curb.
        park_left, park_right = e.get("parking", (0.0, 0.0))
        e["asphalt"] = (-e["width"] / 2.0 - park_left, e["width"] / 2.0 + park_right)


def _roundabouts(graph: RoadGraph, osm: OsmData, proj: Projection) -> None:
    """Center and radius of every roundabout ring, and its lane moved out to a drivable radius.

    OSM draws a small traffic circle as a ring of radius 3-6 m around the island, tighter than a
    car can turn. The ring's lane is placed at least RING_MIN_LANE_R from the center (outward is to
    the right of travel on a counter-clockwise ring) and its asphalt runs from the island to
    RING_OUTER_M beyond the lane."""
    rings: Dict[int, List[str]] = {}
    for eid, e in graph.edges.items():
        if e.get("ring"):
            rings.setdefault(e["ring"], []).append(eid)
    graph.roundabouts = []
    ways = {w["id"]: w for w in osm.ways}
    for k, (way_id, eids) in enumerate(sorted(rings.items())):
        way = ways[way_id]
        pts = [proj.to_xy(osm.nodes[n][0], osm.nodes[n][1]) for n in way["nodes"] if n in osm.nodes]
        if len(pts) < 4:
            continue
        ring_pts = pts[:-1] if pts[0] == pts[-1] else pts
        cx = sum(p[0] for p in ring_pts) / len(ring_pts)
        cy = sum(p[1] for p in ring_pts) / len(ring_pts)
        radius = sum(math.hypot(p[0] - cx, p[1] - cy) for p in ring_pts) / len(ring_pts)
        island = max(1.5, min(RING_MAX_ISLAND_R, radius - 1.0))
        lane_r = max(RING_MIN_LANE_R, island + RING_LANE_TO_ISLAND_M)
        rid = "rb%d" % k
        vertices = set()
        ccw = True
        for eid in eids:
            e = graph.edges[eid]
            # counter-clockwise travel has the center on the left, so outward is to the right
            mid = g.point_at(e["pts"], e["length"] / 2)
            h = g.heading_at(e["pts"], e["length"] / 2)
            left_x, left_y = -math.sin(h), math.cos(h)
            outward = 1.0 if (cx - mid[0]) * left_x + (cy - mid[1]) * left_y > 0 else -1.0
            ccw = outward > 0
            e_r = sum(math.hypot(p[0] - cx, p[1] - cy) for p in e["pts"]) / len(e["pts"])
            d = outward * (lane_r - e_r)
            e["lane_offsets"] = [d]
            e["lane_pts"] = [g.offset_polyline(e["pts"], d)]
            inner, outer = -outward * (e_r - island), outward * (lane_r + RING_OUTER_M - e_r)
            e["asphalt"] = (min(inner, outer), max(inner, outer))
            e["ring"] = rid
            vertices.update((e["from"], e["to"]))
        for eid in eids:
            graph.edges[eid]["ring_center"] = (cx, cy)
        graph.roundabouts.append({"id": rid, "x": g.r2(cx), "y": g.r2(cy), "island_r": g.r2(island),
                                  "lane_r": g.r2(lane_r), "outer_r": g.r2(lane_r + RING_OUTER_M), "ccw": ccw,
                                  "edges": sorted(eids), "vertices": sorted(vertices)})
    for e in graph.edges.values():
        if e.get("ring") and not isinstance(e["ring"], str):
            e["ring"] = None  # a ring way too short to measure: treated as an ordinary one-way street
