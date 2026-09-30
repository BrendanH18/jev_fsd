"""Suggest three distinct, reachable routes from the car's actual position."""
from __future__ import annotations

import math

from . import geometry as g


def suggested_drives(router, start: dict) -> list:
    x0, y0, x1, y1 = router.pack["extent"]
    candidates = []
    # Spread endpoints across the neighbourhood, then route through the directed street graph.
    lanes = sorted(router.lanes.values(), key=lambda lane: (str(lane["edge"]), lane["idx"]))
    for lane in lanes:
        if lane["length"] < 35:
            continue
        p = g.point_at(lane["pts"], lane["length"] * 0.55, lane["cum"])
        distance = math.hypot(p[0] - start["x"], p[1] - start["y"])
        if not (180 < distance < 1300 and x0 + 30 < p[0] < x1 - 30 and y0 + 30 < p[1] < y1 - 30):
            continue
        # One candidate in each 150 m neighbourhood keeps routing cost bounded.
        cell = (int(p[0] // 150), int(p[1] // 150))
        if any(c[0] == cell for c in candidates):
            continue
        candidates.append((cell, p))
    routes = []
    for _, goal in candidates[:32]:
        found = router.routes(start, {"x": goal[0], "y": goal[1]}, k=1)
        if not found:
            continue
        route = found[0]
        length = g.cumulative_s(route["polyline"])[-1]
        if not 250 < length < 1900:
            continue
        controls = [router.edges[e].get("control", {}) for e in route["edges"]]
        turns = sum(t["dir"] in ("left", "right") for t in route["turns"])
        routes.append({"route": route, "destination": route["polyline"][-1], "length_m": round(length),
                       "signals": sum(c.get("type") == "signal" for c in controls),
                       "stops": sum(c.get("type") == "stop" for c in controls), "turns": turns})
    presets = (
        ("neighbourhood", "Neighbourhood cruise", "Find your rhythm. Smooth braking and a generous following gap.", "Easy",
         lambda r: abs(r["length_m"] - 500) + r["signals"] * 40 + r["turns"] * 15),
        ("junctions", "City precision", "Read the junctions. Full stops, clean turns and patient yielding.", "Focused",
         lambda r: abs(r["length_m"] - 850) - r["signals"] * 65 - r["stops"] * 35 - r["turns"] * 20),
        ("tour", "The long way home", "Put it all together across a longer stretch of the neighbourhood.", "Extended",
         lambda r: abs(r["length_m"] - 1300)),
    )
    picked = []
    for ident, title, description, difficulty, rank in presets:
        if not routes:
            break
        choice = min(routes, key=rank)
        picked.append({"id": ident, "title": title, "description": description, "difficulty": difficulty, **choice})
        routes = [r for r in routes if g.dist(r["destination"], choice["destination"]) > 100]
    return picked
