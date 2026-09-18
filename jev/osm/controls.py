"""Traffic signals and stop signs from OSM node tags, attached to graph edges.

OSM marks a signalled intersection with `highway=traffic_signals` on the junction node, or on each
approach node just before it. Both are mapped to the nearest junction vertex and clustered (25 m)
so a dual carriageway becomes one intersection. Every incoming edge from outside the cluster is an
approach with a stop line a few meters before the vertex. Phases are invented in code: OSM has no
timing data. Stop signs (`highway=stop`) apply to the direction the node's `direction` tag says, to
every incoming edge when the node is the junction itself, or otherwise to the direction whose
junction lies ahead of the node.
"""

from __future__ import annotations

import math
import random
from typing import Dict, List, Optional

from .. import geometry as g
from .graph import RoadGraph
from .parse import OsmData
from .project import Projection

SIGNAL_SNAP_M = 30.0
CLUSTER_M = 25.0
STOP_LINE_SETBACK_M = 4.0
STOP_AHEAD_M = 30.0
MIN_APPROACHES = 3
CYCLE = {"green": 20.0, "yellow": 3.0, "all_red": 1.0}
CYCLE_S = 2 * (CYCLE["green"] + CYCLE["yellow"] + CYCLE["all_red"])


def _nearest_vertex(graph: RoadGraph, x: float, y: float, max_m: float) -> Optional[str]:
    best, best_d = None, max_m
    for vid, v in graph.vertices.items():
        d = math.hypot(v["x"] - x, v["y"] - y)
        if d < best_d and len(graph.in_edges.get(vid, [])) >= MIN_APPROACHES:
            best, best_d = vid, d
    return best


def _stop_line_s(edge: dict) -> float:
    return max(1.0, edge["length"] - STOP_LINE_SETBACK_M)


def attach_controls(osm: OsmData, graph: RoadGraph, proj: Projection, seed: int = 11) -> dict:
    """Mutates graph edges (adds `control`) and returns {intersections, stops, stats}."""
    rng = random.Random(seed)
    signal_vertices: Dict[str, List[int]] = {}
    dropped_signals = 0
    for nid, (lat, lon, tags) in osm.nodes.items():
        if tags.get("highway") != "traffic_signals":
            continue
        x, y = proj.to_xy(lat, lon)
        vid = "n%d" % nid if "n%d" % nid in graph.vertices else None
        if vid is None or len(graph.in_edges.get(vid, [])) < MIN_APPROACHES:
            vid = _nearest_vertex(graph, x, y, SIGNAL_SNAP_M)
        if vid is None:
            dropped_signals += 1
            continue
        signal_vertices.setdefault(vid, []).append(nid)

    # union-find clustering of signal vertices within CLUSTER_M
    vids = list(signal_vertices)
    parent = {v: v for v in vids}

    def find(v):
        while parent[v] != v:
            parent[v] = parent[parent[v]]
            v = parent[v]
        return v

    for i, a in enumerate(vids):
        va = graph.vertices[a]
        for b in vids[i + 1:]:
            vb = graph.vertices[b]
            if math.hypot(va["x"] - vb["x"], va["y"] - vb["y"]) <= CLUSTER_M:
                parent[find(a)] = find(b)
    clusters: Dict[str, List[str]] = {}
    for v in vids:
        clusters.setdefault(find(v), []).append(v)

    intersections = []
    for k, members in enumerate(sorted(clusters.values(), key=lambda m: sorted(m)[0])):
        member_set = set(members)
        cx = sum(graph.vertices[v]["x"] for v in members) / len(members)
        cy = sum(graph.vertices[v]["y"] for v in members) / len(members)
        approaches = []
        for v in members:
            for eid in graph.in_edges.get(v, []):
                e = graph.edges[eid]
                if e["from"] in member_set:
                    continue  # internal link of a dual carriageway
                approaches.append({"edge": eid, "heading_deg": round(math.degrees(graph.edge_heading_in(eid)), 1),
                                   "s_line": round(_stop_line_s(e), 2)})
        if len(approaches) < 2:
            continue
        iid = "sig%d" % k
        base = math.radians(approaches[0]["heading_deg"])
        for a in approaches:
            diff = abs(g.wrap_angle(math.radians(a["heading_deg"]) - base))
            a["group"] = "A" if (diff <= math.pi / 4 or diff >= 3 * math.pi / 4) else "B"
        inter = {"id": iid, "x": g.r2(cx), "y": g.r2(cy), "approaches": approaches,
                 "cycle_s": CYCLE_S, "offset_s": round(rng.uniform(0, CYCLE_S), 1),
                 "vertices": sorted(members)}
        intersections.append(inter)
        for a in approaches:
            graph.edges[a["edge"]]["control"] = {"type": "signal", "id": iid, "s_line": a["s_line"],
                                                 "group": a["group"]}

    stops = []
    stop_k = 0
    for nid, (lat, lon, tags) in osm.nodes.items():
        if tags.get("highway") != "stop":
            continue
        direction = (tags.get("direction") or "").lower()
        all_way = tags.get("stop") == "all"
        x, y = proj.to_xy(lat, lon)
        vid = "n%d" % nid
        targets: List[tuple] = []  # (edge_id, s_line)
        if vid in graph.vertices:
            for eid in graph.in_edges.get(vid, []):
                e = graph.edges[eid]
                if direction in ("forward", "backward") and e["forward"] != (direction == "forward"):
                    continue
                targets.append((eid, _stop_line_s(e)))
            if not direction and len(graph.in_edges.get(vid, [])) >= MIN_APPROACHES:
                all_way = True
        else:
            for eid, e in graph.edges.items():
                s = e["node_s"].get(nid)
                if s is None:
                    continue
                if direction in ("forward", "backward"):
                    if e["forward"] != (direction == "forward"):
                        continue
                elif e["length"] - s > STOP_AHEAD_M:
                    continue  # junction is not ahead in this direction
                targets.append((eid, max(1.0, min(s, e["length"] - 1.0))))
        for eid, s_line in targets:
            e = graph.edges[eid]
            if e.get("control"):  # signals win; one control per edge
                continue
            sid = "stop%d" % stop_k
            stop_k += 1
            stops.append({"id": sid, "edge": eid, "s_line": round(s_line, 2), "all_way": all_way,
                          "x": g.r2(x), "y": g.r2(y), "junction": e["to"]})
            e["control"] = {"type": "stop", "id": sid, "s_line": round(s_line, 2), "all_way": all_way}

    return {"intersections": intersections, "stops": stops,
            "stats": {"signal_nodes_dropped": dropped_signals, "intersections": len(intersections),
                      "stops": len(stops)}}
