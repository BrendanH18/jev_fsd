"""One-way streets that cyclists may ride both ways, beside unchanged packs.

Montréal's Plateau, Toronto's Annex and many other neighbourhoods let bicycles ride against a
one-way street's traffic: with a painted contraflow lane (`cycleway=opposite_lane`,
`cycleway:left=lane` + `cycleway:left:oneway=-1`, ...) or just by sharing the street
(`oneway:bicycle=no`, `cycleway=opposite`). This layer maps those ways onto the pack's one-way
edges. `kind` is "lane" (a painted lane or a track against the traffic) or "shared"; `side` is the
side of the street the contraflow cyclist rides on, seen from a driver going the one-way's way
(the driver's left in Canada, unless the tags put the lane on the right). The sim
(static/js/sim/contraflow.js) puts contraflow cyclists on these edges; nothing else reads it.
"""
from __future__ import annotations

import json
import math

from . import fetch
from .parse import parse_xml

LANE_VALUES = {"lane", "track", "opposite_lane", "opposite_track"}
SHARED_VALUES = {"opposite", "opposite_share_busway", "shared_lane", "share_busway"}
WAY_DIR = {"yes": 1, "1": 1, "true": 1, "-1": -1, "reverse": -1}


def contraflow_path(maps_dir, bbox):
    return maps_dir / (fetch.cache_key(bbox) + ".contraflow.v1.json")


def load_contraflow(bbox, maps_dir):
    path = contraflow_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_contraflow(bbox, maps_dir, pack, force=False, log=lambda m: None):
    path = contraflow_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    raw = fetch.cache_path(maps_dir, bbox)
    if not raw.is_file():
        return None
    layer = contraflow_from_osm(parse_xml(raw), pack)
    path.write_text(json.dumps(layer, separators=(",", ":")))
    log("map: built %s (%d contraflow edges)" % (path.name, len(layer["edges"])))
    return layer


def way_contraflow(tags):
    """How bicycles may ride against a one-way way's traffic: (kind, side of the way, the tag that
    says so), or None. `side` is "left"/"right" of the way's own direction; contraflow is the
    direction against the traffic (the way's direction for `oneway=-1`)."""
    traffic = WAY_DIR.get((tags.get("oneway") or "").strip().lower())
    if traffic is None:
        if tags.get("junction") in ("roundabout", "circular"):
            return None
        traffic = 1  # (a one-way edge from a way with no oneway tag: implied, as on a motorway ramp)
    if (tags.get("bicycle") or "").strip().lower() in ("no", "use_sidepath"):
        return None
    # a lane or track against the traffic, on one side
    for side in ("left", "right", "both"):
        val = (tags.get("cycleway:" + side) or "").strip()
        if val not in LANE_VALUES:
            continue
        lane_dir = WAY_DIR.get((tags.get("cycleway:%s:oneway" % side) or "").strip().lower())
        two_way = (tags.get("cycleway:%s:oneway" % side) or "").strip().lower() == "no"
        if val.startswith("opposite") or two_way or (lane_dir is not None and lane_dir != traffic):
            kind = "track" if "track" in val else "lane"
            where = "left" if side == "both" else side
            # (`both` lanes that run both ways: the contraflow one is on the driver's left)
            if side == "both" and traffic == -1:
                where = "right"
            return kind, where, "cycleway:%s=%s" % (side, val)
    val = (tags.get("cycleway") or "").strip()
    if val in ("opposite_lane", "opposite_track"):
        return ("track" if "track" in val else "lane"), ("left" if traffic == 1 else "right"), "cycleway=" + val
    if val in ("opposite", "opposite_share_busway"):
        return "shared", ("left" if traffic == 1 else "right"), "cycleway=" + val
    if (tags.get("oneway:bicycle") or "").strip().lower() == "no":
        return "shared", ("left" if traffic == 1 else "right"), "oneway:bicycle=no"
    against = "bicycle:backward" if traffic == 1 else "bicycle:forward"
    if (tags.get(against) or "").strip().lower() in ("yes", "designated", "permissive"):
        return "shared", ("left" if traffic == 1 else "right"), "%s=%s" % (against, tags[against])
    return None


def contraflow_from_osm(osm, pack):
    """The pack's one-way edges that cyclists may ride against: [{edge, kind, side, tag, name}],
    `side` relative to the edge's (the traffic's) direction."""
    from .crossings import _snap
    from .project import Projection
    proj = Projection(pack["origin"]["lat"], pack["origin"]["lon"])
    tagged = []
    for w in osm.ways:
        if "highway" not in w["tags"]:
            continue
        found = way_contraflow(w["tags"])
        if not found:
            continue
        pts = [proj.to_xy(*osm.nodes[n][:2]) for n in w["nodes"] if n in osm.nodes]
        if len(pts) > 1:
            tagged.append((w, found, {"pts": pts, "length": sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))}))
    out = []
    for edge in pack["edges"]:
        if not edge.get("oneway") or edge.get("ring"):
            continue
        a, b = edge["from"][1:], edge["to"][1:]
        try:
            a, b = int(a), int(b)
        except ValueError:
            continue
        match = None
        for w, found, geom in tagged:
            nodes = w["nodes"]
            if a in nodes and b in nodes:
                match = (w, found, nodes.index(a) < nodes.index(b))
                break
        if match is None:
            # (an edge merged across ways, or a way split differently today: its centreline)
            for w, found, geom in tagged:
                if w["tags"].get("name", "") != edge.get("name", ""):
                    continue
                hits = [_snap([geom], p, 2) for p in (edge["pts"][0], edge["pts"][-1])]
                if all(hits) and abs(hits[1][1] - hits[0][1]) > edge["length"] * 0.8:
                    match = (w, found, hits[1][1] > hits[0][1])
                    break
        if match is None:
            continue
        w, (kind, side, tag), forward = match
        # (the side is the way's; along an edge drawn against the way, it is the other one)
        if not forward:
            side = "right" if side == "left" else "left"
        out.append({"edge": edge["id"], "kind": kind, "side": side, "tag": tag, "way": w["id"], "name": edge.get("name", "")})
    return {"contraflow_version": "1", "name": pack.get("name", ""), "edges": out}
