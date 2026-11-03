"""Speed humps, speed tables, speed cushions and speed bumps for a map pack, from OpenStreetMap.

    calming = build_calming(bbox, maps_dir, pack)   # cached beside the pack; None without the raw OSM
    calming = calming_from_osm(osm, pack)

A device is a node on a drivable way tagged `traffic_calming` with one of KINDS (the first of a
`;`-separated list that is one), placed on the pack street whose centreline passes within SNAP_M of
it: on both of a two-way street's edges, at the same point. Devices tagged on a whole way (as the
Kitsilano bikeways' `traffic_calming=yes`) say only that the street is calmed somewhere along it, so
they are left out; so are islands, chokers and chicanes, which narrow the street rather than raise it,
and roundabout rings. A second device within MERGE_M of one already kept on the same street (a hump
mapped once for each lane) is the same one. A table at a crossing is a raised crosswalk (`crossing`).

Each device is kept with its kind and where it is (`x`, `y`), and for each edge it lies across, how
far along that edge's centreline (`at`: [{edge, s}]). How long and high each kind is, and the speed to
cross it at, is the sim's business (static/js/sim/traffic-calming.js).

The file is separate from the pack (`<key>.calming.v1.json`), so adding it leaves the streets as they
were.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from .. import geometry as g
from . import fetch
from .crossings import _snap
from .graph import is_drivable
from .parse import OsmData, parse_xml
from .project import Projection

CALMING_VERSION = "1"
KINDS = ("hump", "table", "cushion", "bump")
SNAP_M = 4.0
MERGE_M = 6.0
END_M = 3.0           # (a device this close to an edge's end belongs to the junction, not the street)

Bbox = Tuple[float, float, float, float]


def calming_path(maps_dir: Path, bbox: Bbox) -> Path:
    return maps_dir / ("%s.calming.v%s.json" % (fetch.cache_key(bbox), CALMING_VERSION))


def load_calming(bbox: Bbox, maps_dir: Path) -> Optional[dict]:
    path = calming_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_calming(bbox: Bbox, maps_dir: Path, pack: dict, force: bool = False,
                  log: Callable[[str], None] = lambda m: None) -> Optional[dict]:
    """The cached devices for a bbox, built from its raw OSM download if that is on disk (it is never
    downloaded here). None when there is neither."""
    path = calming_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    xml_path = fetch.cache_path(maps_dir, bbox)
    if not xml_path.is_file():
        return None
    calming = calming_from_osm(parse_xml(xml_path), pack)
    log("map: built %s (%d speed humps, tables, cushions and bumps)" % (path.name, len(calming["devices"])))
    path.write_text(json.dumps(calming, separators=(",", ":")))
    return calming


def kind_of(tags: dict) -> Optional[str]:
    """The kind of raised device a node's tags make it, or None."""
    for k in (tags.get("traffic_calming") or "").lower().split(";"):
        if k.strip() in KINDS:
            return k.strip()
    return None


def calming_from_osm(osm: OsmData, pack: dict) -> dict:
    origin = pack.get("origin") or {}
    proj = Projection(origin.get("lat", 0.0), origin.get("lon", 0.0))
    on_road = set()
    for w in osm.ways:
        if is_drivable(w["tags"], include_service=False):
            on_road.update(w["nodes"])
    edges = [e for e in pack["edges"] if not e.get("ring")]
    kept: List[dict] = []
    for nid in sorted(on_road):
        if nid not in osm.nodes:
            continue
        lat, lon, tags = osm.nodes[nid]
        kind = kind_of(tags)
        if kind is None:
            continue
        p = proj.to_xy(lat, lon)
        snap = _snap(edges, p, SNAP_M)
        if snap is None:
            continue
        e, s, q = snap
        if s < END_M or s > e["length"] - END_M:
            continue
        twins = [o for o in edges if o["from"] == e["to"] and o["to"] == e["from"] and abs(o["length"] - e["length"]) < 1.0]
        street = {e["id"]} | {o["id"] for o in twins}
        if any(d["street"] & street and math.hypot(d["x"] - q[0], d["y"] - q[1]) < MERGE_M for d in kept):
            continue
        at = [{"edge": e["id"], "s": g.r1(s)}] + [{"edge": o["id"], "s": g.r1(o["length"] - s)} for o in twins]
        device = {"id": "c%d" % nid, "kind": kind, "x": g.r2(q[0]), "y": g.r2(q[1]),
                  "at": sorted(at, key=lambda a: a["edge"]), "street": street}
        if kind == "table" and (tags.get("highway") == "crossing" or "crossing" in tags):
            device["crossing"] = True
        kept.append(device)
    for d in kept:
        d.pop("street")
    return {"calming_version": CALMING_VERSION, "name": pack.get("name", ""),
            "devices": sorted(kept, key=lambda d: d["id"])}
