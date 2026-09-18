"""Routing over the map pack: snap a pose to a lane, A* over directed edges with turn penalties,
alternatives, and a drivable polyline with rounded corners and a turn list.

The router works on the serialized pack (plain dicts), so the same code serves the HTTP API and
the tests, and nothing here depends on the OSM modules.
"""

from __future__ import annotations

import heapq
import math
from typing import Dict, List, Optional, Sequence, Tuple

from . import geometry as g

TURN_PENALTY_S = {"straight": 0.0, "right": 2.0, "left": 4.0, "uturn": 20.0}
MAX_LIMIT_MPS = 29.0
FILLET_RADIUS_M = 6.0
FILLET_MIN_DEG = 20.0
RESAMPLE_M = 1.0
ALT_COST_FACTOR = 1.6
ALT_MIN_DIFFERENT = 0.25
GRID_CELL_M = 50.0


class Router:
    def __init__(self, pack: dict):
        self.pack = pack
        self.edges: Dict[str, dict] = {e["id"]: e for e in pack["edges"]}
        self.lanes: Dict[Tuple[str, int], dict] = {}
        self.out_edges: Dict[str, List[str]] = {}
        for e in pack["edges"]:
            self.out_edges.setdefault(e["from"], []).append(e["id"])
        for lane in pack["lanes"]:
            lane = dict(lane)
            lane["cum"] = g.cumulative_s(lane["pts"])
            lane["length"] = lane["cum"][-1]
            self.lanes[(lane["edge"], lane["idx"])] = lane
        self._cum: Dict[str, List[float]] = {e["id"]: g.cumulative_s(e["pts"]) for e in pack["edges"]}
        self._grid: Dict[Tuple[int, int], List[Tuple[str, int]]] = {}
        for key, lane in self.lanes.items():
            for cell in _cells_of_polyline(lane["pts"]):
                self._grid.setdefault(cell, []).append(key)

    # --- edge helpers ---------------------------------------------------------------------

    def successors(self, edge_id: str) -> List[str]:
        return self.out_edges.get(self.edges[edge_id]["to"], [])

    def heading_in(self, edge_id: str) -> float:
        pts = self.edges[edge_id]["pts"]
        return g.heading_of(pts[-2], pts[-1])

    def heading_out(self, edge_id: str) -> float:
        pts = self.edges[edge_id]["pts"]
        return g.heading_of(pts[0], pts[1])

    def turn(self, edge_in: str, edge_out: str) -> str:
        return g.classify_turn(g.turn_angle(self.heading_in(edge_in), self.heading_out(edge_out)))

    def turn_penalty(self, edge_in: str, edge_out: str) -> float:
        kind = self.turn(edge_in, edge_out)
        if kind == "uturn" and len(self.successors(edge_in)) > 1:
            return 1e6  # only at dead ends
        return TURN_PENALTY_S[kind]

    # --- snapping -------------------------------------------------------------------------

    def snap(self, x: float, y: float, heading: Optional[float] = None, max_m: float = 60.0,
             heading_tolerance: float = math.radians(60)) -> Optional[dict]:
        """Nearest lane point. With a heading, lanes pointing the other way are ignored (within
        the tolerance) unless nothing else is nearby."""
        cx, cy = int(math.floor(x / GRID_CELL_M)), int(math.floor(y / GRID_CELL_M))
        radius = int(math.ceil(max_m / GRID_CELL_M))
        candidates = set()
        for i in range(cx - radius, cx + radius + 1):
            for j in range(cy - radius, cy + radius + 1):
                candidates.update(self._grid.get((i, j), ()))
        best = None
        for pass_no in (0, 1):
            for key in candidates:
                lane = self.lanes[key]
                proj = g.project_point(lane["pts"], (x, y), lane["cum"])
                if proj["distance"] > max_m:
                    continue
                if heading is not None and pass_no == 0:
                    if abs(g.wrap_angle(proj["heading"] - heading)) > heading_tolerance:
                        continue
                if best is None or proj["distance"] < best["distance"]:
                    best = dict(proj, edge=key[0], lane=key[1])
            if best is not None or heading is None:
                break
        return best

    def snap_all(self, x: float, y: float, max_m: float = 60.0, slack_m: float = 2.5) -> List[dict]:
        """Nearest lane point per edge, keeping every edge within `slack_m` of the closest one. A click
        on a two-way street's centerline is equidistant from both directions; the caller routes to each
        and keeps the cheaper."""
        cx, cy = int(math.floor(x / GRID_CELL_M)), int(math.floor(y / GRID_CELL_M))
        radius = int(math.ceil(max_m / GRID_CELL_M))
        candidates = set()
        for i in range(cx - radius, cx + radius + 1):
            for j in range(cy - radius, cy + radius + 1):
                candidates.update(self._grid.get((i, j), ()))
        per_edge: Dict[str, dict] = {}
        for key in candidates:
            lane = self.lanes[key]
            proj = g.project_point(lane["pts"], (x, y), lane["cum"])
            if proj["distance"] > max_m:
                continue
            cur = per_edge.get(key[0])
            if cur is None or proj["distance"] < cur["distance"]:
                per_edge[key[0]] = dict(proj, edge=key[0], lane=key[1])
        ordered = sorted(per_edge.values(), key=lambda p: p["distance"])
        if not ordered:
            return []
        return [p for p in ordered if p["distance"] <= ordered[0]["distance"] + slack_m]

    # --- search ---------------------------------------------------------------------------

    def astar(self, start_edge: str, start_s: float, goal_edge: str, goal_s: float,
              extra_cost: Optional[Dict[str, float]] = None) -> Optional[Tuple[List[str], float]]:
        """(edge sequence, cost) from start to goal, or None. Cost is travel time plus turn penalties."""
        extra_cost = extra_cost or {}
        goal_pt = g.point_at(self.edges[goal_edge]["pts"], goal_s, self._cum[goal_edge])

        def h(edge_id: str) -> float:
            end = self.edges[edge_id]["pts"][-1]
            return g.dist(end, goal_pt) / MAX_LIMIT_MPS

        def edge_time(edge_id: str) -> float:
            e = self.edges[edge_id]
            return e["length"] / max(e["limit"], 1.0) * (1.0 + extra_cost.get(edge_id, 0.0))

        start = self.edges[start_edge]
        if start_edge == goal_edge and goal_s >= start_s:
            return [start_edge], (goal_s - start_s) / max(start["limit"], 1.0)
        g0 = (start["length"] - start_s) / max(start["limit"], 1.0)
        best_g = {start_edge: g0}
        parent: Dict[str, Optional[str]] = {start_edge: None}
        heap = [(g0 + h(start_edge), 0, start_edge)]
        counter = 1
        closed = set()
        while heap:
            _, _, cur = heapq.heappop(heap)
            if cur in closed:
                continue
            closed.add(cur)
            if cur == goal_edge and cur != start_edge:
                path = []
                node: Optional[str] = cur
                while node is not None:
                    path.append(node)
                    node = parent[node]
                return list(reversed(path)), best_g[cur]
            for nxt in self.successors(cur):
                if nxt in closed:
                    continue
                cost = best_g[cur] + self.turn_penalty(cur, nxt)
                cost += (goal_s / max(self.edges[nxt]["limit"], 1.0)) if nxt == goal_edge else edge_time(nxt)
                if cost >= 1e5:
                    continue
                if cost < best_g.get(nxt, float("inf")):
                    best_g[nxt] = cost
                    parent[nxt] = cur
                    heapq.heappush(heap, (cost + h(nxt), counter, nxt))
                    counter += 1
        return None

    def routes(self, start: dict, goal: dict, k: int = 1) -> List[dict]:
        """`start` = {x, y, heading?}, `goal` = {x, y}. Up to k distinct routes, best first."""
        s = self.snap(start["x"], start["y"], start.get("heading"))
        goals = self.snap_all(goal["x"], goal["y"])
        if s is None or not goals:
            return []
        # pick the goal lane (direction) that is cheapest to reach
        t, first = None, None
        for cand in goals:
            res = self.astar(s["edge"], s["s"], cand["edge"], cand["s"])
            if res and (first is None or res[1] < first[1]):
                t, first = cand, res
        if t is None:
            return []
        found: List[List[str]] = []
        extra: Dict[str, float] = {}
        for i in range(k):
            res = first if i == 0 else self.astar(s["edge"], s["s"], t["edge"], t["s"], extra_cost=extra)
            if res is None:
                break
            path = res[0]
            if any(_overlap(path, p) > 1 - ALT_MIN_DIFFERENT for p in found):
                if i == 0:
                    found.append(path)
                break
            found.append(path)
            for eid in path[1:-1]:
                extra[eid] = extra.get(eid, 0.0) + (ALT_COST_FACTOR - 1.0)
        out = []
        for i, path in enumerate(found):
            route = self.build_route(path, s, t)
            route["id"] = "current" if i == 0 else "alt_%d" % i
            out.append(route)
        return out

    # --- geometry ------------------------------------------------------------------------

    def _lane_index(self, path: Sequence[str], i: int) -> int:
        e = self.edges[path[i]]
        n = e["lanes"]
        if n <= 1:
            return 0
        if i + 1 < len(path) and self.turn(path[i], path[i + 1]) == "left":
            return 0  # leftmost before a left turn
        return n - 1  # rightmost

    def build_route(self, path: Sequence[str], start_snap: dict, goal_snap: dict) -> dict:
        """Polyline along lane centerlines from the snapped start to the snapped goal, with fillets
        at turns, resampled at 1 m. Also the turn list and total length."""
        pieces: List[List[Tuple[float, float]]] = []
        for i, eid in enumerate(path):
            lane = self.lanes[(eid, self._lane_index(path, i))]
            pts = list(lane["pts"])
            cum = lane["cum"]
            s0 = start_snap["s"] if i == 0 else 0.0
            s1 = goal_snap["s"] if i == len(path) - 1 else lane["length"]
            if s1 <= s0 + 0.5 and len(path) > 1:
                if i == 0:  # start is at the very end of the edge: keep a stub so headings work
                    s0 = max(0.0, lane["length"] - 1.0)
                    s1 = lane["length"]
                elif i == len(path) - 1:
                    s0 = 0.0
                    s1 = max(1.0, s1)
            pieces.append(_slice(pts, cum, s0, s1))
        polyline: List[Tuple[float, float]] = []
        for i, piece in enumerate(pieces):
            if not polyline:
                polyline.extend(piece)
                continue
            angle = g.turn_angle(self.heading_in(path[i - 1]), self.heading_out(path[i]))
            corner = polyline[-1]
            # join: the lane polylines of consecutive edges may be offset differently; bridge the gap
            if abs(math.degrees(angle)) >= FILLET_MIN_DEG and len(polyline) >= 2 and len(piece) >= 2:
                a = polyline[-2]
                b = piece[1] if g.dist(piece[0], corner) < 0.5 else piece[0]
                mid = ((corner[0] + piece[0][0]) / 2, (corner[1] + piece[0][1]) / 2)
                curve = g.fillet(a, mid, b, FILLET_RADIUS_M)
                polyline.pop()
                polyline.extend(curve)
                polyline.extend(piece[1:] if g.dist(piece[0], corner) < 0.5 else piece)
            else:
                polyline.extend(piece if g.dist(piece[0], corner) > 0.05 else piece[1:])
        polyline = g.dedupe_consecutive(polyline, 0.05)
        polyline = g.resample(polyline, RESAMPLE_M) if len(polyline) >= 2 else polyline
        cum = g.cumulative_s(polyline)
        turns = []
        at = 0.0
        for i in range(len(path) - 1):
            e = self.edges[path[i]]
            at += (e["length"] - (start_snap["s"] if i == 0 else 0.0))
            kind = self.turn(path[i], path[i + 1])
            if kind != "straight":
                turns.append({"at_m": round(at, 1), "dir": kind, "street": self.edges[path[i + 1]]["name"]})
        length = cum[-1] if cum else 0.0
        return {
            "edges": list(path),
            "polyline": [(g.r2(x), g.r2(y)) for x, y in polyline],
            "length_m": g.r1(length),
            "turns": turns,
            "summary": _summary(turns, length, self.edges[path[-1]]["name"]),
        }


def _slice(pts: List[Tuple[float, float]], cum: List[float], s0: float, s1: float) -> List[Tuple[float, float]]:
    s0 = max(0.0, min(s0, cum[-1]))
    s1 = max(s0, min(s1, cum[-1]))
    out = [g.point_at(pts, s0, cum)]
    for i, s in enumerate(cum):
        if s0 < s < s1:
            out.append(pts[i])
    out.append(g.point_at(pts, s1, cum))
    return g.dedupe_consecutive(out, 0.01)


def _overlap(a: Sequence[str], b: Sequence[str]) -> float:
    sa, sb = set(a), set(b)
    return len(sa & sb) / max(1, len(sa | sb))


def _summary(turns: List[dict], length: float, dest_street: str) -> str:
    if not turns:
        head = "straight ahead"
    else:
        t = turns[0]
        verb = "make a U-turn" if t["dir"] == "uturn" else "turn %s" % t["dir"]
        head = "%s%s in %d m" % (verb, (" onto " + t["street"]) if t["street"] else "", round(t["at_m"]))
        if len(turns) > 1:
            head += ", then %d more turn%s" % (len(turns) - 1, "" if len(turns) == 2 else "s")
    return "%s, %d m total%s" % (head, round(length), (" to " + dest_street) if dest_street else "")


def _cells_of_polyline(pts: Sequence[Tuple[float, float]]) -> set:
    cells = set()
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        n = max(1, int(g.dist(pts[i], pts[i + 1]) / (GRID_CELL_M / 2)))
        for k in range(n + 1):
            t = k / n
            cells.add((int(math.floor((x0 + (x1 - x0) * t) / GRID_CELL_M)),
                       int(math.floor((y0 + (y1 - y0) * t) / GRID_CELL_M))))
    return cells
