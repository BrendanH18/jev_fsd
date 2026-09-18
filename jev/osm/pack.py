"""Build the "map pack": one JSON document the browser (and the router) consume.

    pack = build_pack(bbox, maps_dir)          # fetches (cached) and processes
    pack = synthetic_pack()                     # procedural grid, no network, used by tests

All coordinates are meters in the projection's frame (x east, y north), rounded to 0.01.
"""

from __future__ import annotations

import hashlib
import json
import random
import time
from pathlib import Path
from typing import Callable, Optional, Tuple

from .. import geometry as g
from . import fetch
from .buildings import extract_buildings
from .controls import attach_controls
from .graph import RoadGraph, build_graph
from .parse import OsmData, parse_xml
from .project import Projection

PACK_VERSION = "3"
Bbox = Tuple[float, float, float, float]


def pack_path(maps_dir: Path, bbox: Bbox) -> Path:
    return maps_dir / ("%s.v%s.pack.json" % (fetch.cache_key(bbox), PACK_VERSION))


def build_pack(bbox: Bbox, maps_dir: Path, force: bool = False, log: Callable[[str], None] = lambda m: None,
               include_service: bool = False) -> dict:
    """Cached pack for a bbox. Raises fetch.FetchError when the map cannot be downloaded."""
    path = pack_path(maps_dir, bbox)
    if path.exists() and not force:
        return json.loads(path.read_text())
    xml_path = fetch.fetch_osm_xml(bbox, maps_dir, log=log)
    started = time.perf_counter()
    osm = parse_xml(xml_path)
    pack = pack_from_osm(osm, bbox, include_service=include_service, name=fetch.cache_key(bbox))
    pack["stats"]["build_ms"] = round((time.perf_counter() - started) * 1000)
    log("map: built pack %s in %d ms (%d edges, %d intersections, %d stops, %d buildings)" % (
        path.name, pack["stats"]["build_ms"], len(pack["edges"]), len(pack["intersections"]),
        len(pack["stops"]), len(pack["buildings"])))
    maps_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(pack, separators=(",", ":")))
    return pack


def pack_from_osm(osm: OsmData, bbox: Bbox, include_service: bool = False, name: str = "") -> dict:
    proj = Projection.for_bbox(bbox)
    graph = build_graph(osm, proj, include_service=include_service)
    controls = attach_controls(osm, graph, proj)
    buildings = extract_buildings(osm, proj)
    return serialize(graph, controls, buildings, bbox, proj, name)


def serialize(graph: RoadGraph, controls: dict, buildings: list, bbox: Bbox, proj: Projection, name: str) -> dict:
    nodes = [{"id": v["id"], "x": g.r2(v["x"]), "y": g.r2(v["y"])} for v in graph.vertices.values()]
    edges = []
    lanes = []
    for e in graph.edges.values():
        item = {
            "id": e["id"], "from": e["from"], "to": e["to"],
            "pts": [(g.r2(x), g.r2(y)) for x, y in e["pts"]],
            "lanes": e["lanes"], "lane_width": e["lane_width"], "width": g.r2(e["width"]),
            "limit": g.r1(e["limit"]), "oneway": e["oneway"], "name": e["name"], "cls": e["cls"],
            "length": g.r2(e["length"]), "lane_offsets": [g.r2(d) for d in e["lane_offsets"]],
            "asphalt": [g.r2(e["asphalt"][0]), g.r2(e["asphalt"][1])],
        }
        if e.get("control"):
            item["control"] = e["control"]
        edges.append(item)
        for i, pts in enumerate(e["lane_pts"]):
            lanes.append({"edge": e["id"], "idx": i, "pts": [(g.r2(x), g.r2(y)) for x, y in pts]})
    stats = dict(graph.stats)
    stats.update(controls.get("stats", {}))
    stats["buildings"] = len(buildings)
    x0, y0, x1, y1 = proj.bbox_xy(bbox)
    return {
        "pack_version": PACK_VERSION, "name": name, "bbox": list(bbox),
        "extent": [g.r2(x0), g.r2(y0), g.r2(x1), g.r2(y1)],
        "origin": proj.as_dict(), "stats": stats,
        "nodes": nodes, "edges": edges, "lanes": lanes,
        "intersections": controls["intersections"], "stops": controls["stops"],
        "buildings": buildings,
    }


# --- procedural fallback ----------------------------------------------------------------------


def synthetic_osm(cols: int = 4, rows: int = 4, spacing: float = 120.0, seed: int = 3) -> Tuple[OsmData, Bbox]:
    """A grid of two-way residential streets with signals in the middle, stop signs elsewhere, one
    one-way avenue, and blocky buildings. Built as fake OSM so the real pipeline processes it."""
    rng = random.Random(seed)
    lat0, lon0 = 49.0, -123.0
    proj = Projection(lat0, lon0)
    osm = OsmData()
    nid = 1
    grid = {}
    for r in range(rows):
        for c in range(cols):
            x = (c - (cols - 1) / 2.0) * spacing
            y = (r - (rows - 1) / 2.0) * spacing
            lat, lon = proj.to_latlon(x, y)
            tags = {}
            central = 0 < r < rows - 1 and 0 < c < cols - 1
            if central:
                tags = {"highway": "traffic_signals"}
            elif r in (0, rows - 1) and 0 < c < cols - 1:
                tags = {"highway": "stop", "stop": "all"}
            osm.add_node(nid, lat, lon, tags)
            grid[(r, c)] = nid
            nid += 1
    wid = 1
    for r in range(rows):
        tags = {"highway": "residential", "name": "Row %d St" % r, "maxspeed": "30"}
        if r == 1:
            tags = {"highway": "secondary", "name": "Main Ave", "maxspeed": "50", "lanes": "2"}
        osm.add_way(wid, [grid[(r, c)] for c in range(cols)], tags)
        wid += 1
    for c in range(cols):
        tags = {"highway": "residential", "name": "Col %d Ave" % c, "maxspeed": "30"}
        if c == cols - 1:
            tags = {"highway": "residential", "name": "Oneway Ave", "oneway": "yes", "maxspeed": "30"}
        osm.add_way(wid, [grid[(r, c)] for r in range(rows)], tags)
        wid += 1
    # a dangling stub that the SCC pruning should remove
    stub_lat, stub_lon = proj.to_latlon(-(cols - 1) / 2.0 * spacing - 60, 0.0)
    osm.add_node(nid, stub_lat, stub_lon)
    osm.add_way(wid, [grid[(rows // 2, 0)], nid], {"highway": "residential", "oneway": "yes", "name": "Stub"})
    nid += 1
    wid += 1
    # buildings inside each block
    for r in range(rows - 1):
        for c in range(cols - 1):
            for _ in range(2):
                bx = (c - (cols - 1) / 2.0) * spacing + rng.uniform(20, spacing - 40)
                by = (r - (rows - 1) / 2.0) * spacing + rng.uniform(20, spacing - 40)
                w, d = rng.uniform(10, 20), rng.uniform(10, 20)
                corners = [(bx, by), (bx + w, by), (bx + w, by + d), (bx, by + d)]
                ids = []
                for x, y in corners:
                    lat, lon = proj.to_latlon(x, y)
                    osm.add_node(nid, lat, lon)
                    ids.append(nid)
                    nid += 1
                osm.add_way(wid, ids + [ids[0]], {"building": "yes", "building:levels": str(rng.randint(1, 4))})
                wid += 1
    half_x = (cols - 1) / 2.0 * spacing + 100
    half_y = (rows - 1) / 2.0 * spacing + 100
    s, w = proj.to_latlon(-half_x, -half_y)
    n, e = proj.to_latlon(half_x, half_y)
    return osm, (w, s, e, n)


def synthetic_pack(**kwargs) -> dict:
    osm, bbox = synthetic_osm(**kwargs)
    pack = pack_from_osm(osm, bbox, name="synthetic")
    pack["synthetic"] = True
    return pack
