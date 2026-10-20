#!/usr/bin/env python3
"""Upgrade committed v5 map packs to v6 without new OSM data.

v6 fixes the asphalt of two-way streets with more lanes one way than the other: the lanes already
ran right of the centerline (oncoming lanes to its left), but the asphalt was centered on it, so
the outer lane on the wider side ran past the curb and curbside posts stood in it. This recomputes
each two-way edge's asphalt from its width, lanes, lane width and parking (`asphalt_span`, as a
fresh build does), then moves the signal and stop lines whose setback depends on the widest
crossing road's asphalt. Everything else in the pack is unchanged.

    uv run scripts/migrate_packs.py            # every data/maps/*.v5.pack.json
    uv run scripts/migrate_packs.py --check    # report what would change, write nothing
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev import geometry as g  # noqa: E402
from jev.config import MAPS_DIR  # noqa: E402
from jev.osm.controls import CROSSWALK_CLEARANCE_M, CURB_CLEARANCE_M, STOP_LINE_SETBACK_M  # noqa: E402
from jev.osm.graph import asphalt_span  # noqa: E402
from jev.osm.pack import PACK_VERSION  # noqa: E402

FROM_VERSION = "5"
MATCH_M = 0.015   # a stored line within rounding of the setback formula was placed by it


def crossing_half_widths(pack: dict) -> dict:
    """Per edge id: half the asphalt width of the widest other road at its end vertex (as
    `controls._crossing_half_width` computes it during a build)."""
    at = {}
    for e in pack["edges"]:
        at.setdefault(e["to"], []).append(e)
        at.setdefault(e["from"], []).append(e)
    out = {}
    for e in pack["edges"]:
        widest = 0.0
        for other in at.get(e["to"], []):
            if {other["from"], other["to"]} == {e["from"], e["to"]}:
                continue
            widest = max(widest, abs(other["asphalt"][0]), abs(other["asphalt"][1]))
        out[e["id"]] = widest
    return out


def line_s(length: float, half: float, clearance: float) -> float:
    return round(max(1.0, length - max(STOP_LINE_SETBACK_M, half + clearance)), 2)


def migrate(pack: dict) -> dict:
    """Mutates `pack` to the current version and returns counts of what moved."""
    edges = {e["id"]: e for e in pack["edges"]}
    before = crossing_half_widths(pack)
    widened = 0
    for e in pack["edges"]:
        if e["oneway"]:
            continue
        span = [g.r2(v) for v in asphalt_span(e)]
        if span != e["asphalt"]:
            e["asphalt"] = span
            widened += 1
    after = crossing_half_widths(pack)
    moved = {"signal": 0, "stop": 0}

    def move(edge_id: str, s_line: float, clearance: float, kind: str) -> float:
        e = edges[edge_id]
        if abs(s_line - line_s(e["length"], before[edge_id], clearance)) > MATCH_M:
            return s_line   # placed at the stop sign's own node, not by the crossing road
        new = line_s(e["length"], after[edge_id], clearance)
        if new != s_line:
            moved[kind] += 1
        return new

    for inter in pack["intersections"]:
        for a in inter["approaches"]:
            a["s_line"] = move(a["edge"], a["s_line"], CROSSWALK_CLEARANCE_M, "signal")
            control = edges[a["edge"]].get("control")
            if control and control.get("type") == "signal" and control.get("id") == inter["id"]:
                control["s_line"] = a["s_line"]
    for stop in pack["stops"]:
        stop["s_line"] = move(stop["edge"], stop["s_line"], CURB_CLEARANCE_M, "stop")
        control = edges[stop["edge"]].get("control")
        if control and control.get("type") == "stop" and control.get("id") == stop["id"]:
            control["s_line"] = stop["s_line"]
    pack["pack_version"] = PACK_VERSION
    return {"edges_widened": widened, "signal_lines_moved": moved["signal"], "stop_lines_moved": moved["stop"]}


def main(argv: list) -> int:
    check = "--check" in argv
    sources = sorted(MAPS_DIR.glob("*.v%s.pack.json" % FROM_VERSION))
    if not sources:
        print("no v%s packs in %s" % (FROM_VERSION, MAPS_DIR))
        return 0
    for source in sources:
        pack = json.loads(source.read_text())
        counts = migrate(pack)
        target = source.with_name(source.name.replace(".v%s." % FROM_VERSION, ".v%s." % PACK_VERSION))
        print("%s -> %s: %s" % (source.name, target.name, ", ".join("%s %d" % kv for kv in counts.items())))
        if not check:
            target.write_text(json.dumps(pack, separators=(",", ":")))
            source.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
