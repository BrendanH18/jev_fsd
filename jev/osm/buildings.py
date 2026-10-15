"""Building footprints for scenery: closed ways tagged building=* -> polygons with a height."""

from __future__ import annotations

import random
import re
from typing import List

from .. import geometry as g
from .parse import OsmData
from .project import Projection

LEVEL_HEIGHT_M = 3.2
MIN_AREA_M2 = 15.0
MAX_BUILDINGS = 3000


def _height(tags: dict, rng: random.Random) -> float:
    h = tags.get("height")
    if h:
        m = re.match(r"\s*(\d+(?:\.\d+)?)", h)
        if m:
            return max(2.5, float(m.group(1)))
    levels = tags.get("building:levels")
    if levels:
        m = re.match(r"\s*(\d+(?:\.\d+)?)", levels)
        if m:
            return max(2.5, float(m.group(1)) * LEVEL_HEIGHT_M)
    return rng.uniform(6.0, 12.0)


def _raised(tags: dict) -> bool:
    """Skywalks and other structures that start above street level and span roads."""
    for key in ("building:min_level", "min_height"):
        m = re.match(r"\s*(\d+(?:\.\d+)?)", tags.get(key, ""))
        if m and float(m.group(1)) > 0:
            return True
    return False


def extract_buildings(osm: OsmData, proj: Projection, seed: int = 7) -> List[dict]:
    rng = random.Random(seed)
    out = []
    for w in osm.ways:
        tags = w["tags"]
        if "building" not in tags or tags.get("building") == "no" or _raised(tags):
            continue
        ids = w["nodes"]
        if len(ids) < 4 or ids[0] != ids[-1]:
            continue
        pts = [proj.to_xy(*osm.nodes[n][:2]) for n in ids[:-1] if n in osm.nodes]
        pts = g.dedupe_consecutive(pts, 0.05)
        if len(pts) < 3:
            continue
        area = g.polygon_area(pts)
        if abs(area) < MIN_AREA_M2:
            continue
        if area < 0:  # keep counter-clockwise so extrusion normals face out
            pts.reverse()
        out.append({"pts": [(g.r2(x), g.r2(y)) for x, y in pts], "h": round(_height(tags, rng), 1)})
        if len(out) >= MAX_BUILDINGS:
            break
    return out
