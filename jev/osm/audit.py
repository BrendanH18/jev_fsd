"""Read-only inspection of prepared maps and their sidecars."""

from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .audit_schema import LAYER_SCHEMAS, PACK_SCHEMA, Issue
from .cache import decode_json
from .fetch import cache_key
from .pack import PACK_VERSION, pack_path
from .parks import is_water


LAYER_VERSIONS = {name: ("2", "1") if name == "crossings" else ("1",) for name in LAYER_SCHEMAS}
OPTIONAL_LAYERS = {"rail"}
EDGE_LENGTH_TOLERANCE = 0.051  # layer stations use decimetres and pack lengths use centimetres


def valid_bbox(value):
    if len(value) != 4:
        return False
    west, south, east, north = value
    return -180 <= west < east <= 180 and -90 <= south < north <= 90


@dataclass
class Artifact:
    file: str
    kind: str
    status: str
    selected: bool = True
    bytes: int | None = None
    sha256: str | None = None
    counts: dict = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)


@dataclass
class MapAudit:
    area: str
    bbox: tuple
    artifacts: list[Artifact]

    @property
    def ok(self):
        return all(item.status not in {"invalid", "missing"} for item in self.artifacts)


def _read(path: Path, kind: str, version: str, selected=True):
    artifact = Artifact(path.name, kind, "ok", selected)
    try:
        raw = path.read_bytes()
    except FileNotFoundError as err:
        # A dangling symlink is a broken artifact, not an omitted optional file.
        if not path.is_symlink():
            artifact.status = "missing"
            return artifact, None
        artifact.issues.append(Issue("$", str(err)))
    except OSError as err:
        artifact.issues.append(Issue("$", str(err)))
    else:
        artifact.bytes = len(raw)
        artifact.sha256 = hashlib.sha256(raw).hexdigest()
        try:
            data = decode_json(raw)
        except (ValueError, RecursionError) as err:
            artifact.issues.append(Issue("$", str(err)))
        else:
            actual_version = data.get(f"{kind}_version") if isinstance(data, dict) else None
            if actual_version != version:
                artifact.issues.append(Issue(f"$.{kind}_version", f"expected version {version!r}"))
            schema = PACK_SCHEMA if kind == "pack" else LAYER_SCHEMAS[kind]
            artifact.issues.extend(schema.check(data, "$"))
            if isinstance(data, dict):
                artifact.counts = {
                    key: len(value)
                    for key, value in data.items()
                    if isinstance(value, list) and key not in {"bbox", "extent"}
                }
            if not artifact.issues:
                return artifact, data
    artifact.status = "invalid"
    return artifact, None


class References:
    """Index a structurally usable pack once for all sidecar checks."""

    def __init__(self, pack):
        self.edges = {e["id"]: e for e in pack["edges"]}
        self.nodes = {n["id"] for n in pack["nodes"]}
        self.signals = {s["id"]: s for s in pack["intersections"]}
        self.rings = {r["id"]: r for r in pack.get("roundabouts", [])}


class Checks:
    def __init__(self, artifact):
        self.artifact = artifact

    def require(self, condition, path, message):
        if not condition:
            self.artifact.status = "invalid"
            self.artifact.issues.append(Issue(path, message))

    def reference(self, target, key, path, label):
        self.require(key in target, path, f"unknown {label} {key!r}")
        if isinstance(target, dict):
            return target.get(key)
        return None

    def unique(self, values, path):
        seen = set()
        for i, value in enumerate(values):
            self.require(value not in seen, f"{path}[{i}]", f"duplicate key {value!r}")
            seen.add(value)

    def station(self, refs, item, path, key="s", edge_key="edge"):
        edge = self.reference(refs.edges, item[edge_key], f"{path}.{edge_key}", "edge")
        if edge is not None:
            self.require(
                item[key] <= edge["length"] + EDGE_LENGTH_TOLERANCE,
                f"{path}.{key}",
                f"station is beyond edge {item[edge_key]!r} ({edge['length']} m)",
            )
        return edge

    def span(self, refs, item, path):
        self.station(refs, item, path, "to")
        self.require(item["from"] < item["to"], path, "span must end after it starts")


def check_pack(artifact, pack, bbox, refs):
    checks = Checks(artifact)
    checks.require(valid_bbox(pack["bbox"]), "$.bbox", "expected ordered W,S,E,N within geographic bounds")
    checks.require(cache_key(pack["bbox"]) == cache_key(bbox), "$.bbox", "bounds belong to a different cache key")
    checks.require(pack["name"] == cache_key(bbox), "$.name", "pack name does not match the cache key")
    x1, y1, x2, y2 = pack["extent"]
    checks.require(x1 < x2 and y1 < y2, "$.extent", "projected extent must have positive width and height")

    for stat, record_key in (
        ("vertices", "nodes"),
        ("edges", "edges"),
        ("intersections", "intersections"),
        ("stops", "stops"),
        ("yields", "yields"),
        ("buildings", "buildings"),
    ):
        checks.require(
            pack["stats"][stat] == len(pack.get(record_key, [])),
            f"$.stats.{stat}",
            f"count disagrees with {record_key}",
        )

    controls = {}
    for kind, records_key in (("signal", "intersections"), ("stop", "stops"), ("yield", "yields")):
        records = pack.get(records_key, [])
        for i, item in enumerate(records):
            path = f"$.{records_key}[{i}]"
            controls[(kind, item["id"])] = item
            if kind == "signal":
                checks.require(item["offset_s"] <= item["cycle_s"], f"{path}.offset_s", "offset exceeds signal cycle")
                for j, approach in enumerate(item["approaches"]):
                    checks.station(refs, approach, f"{path}.approaches[{j}]", "s_line")
                for j, vertex in enumerate(item["vertices"]):
                    checks.reference(refs.nodes, vertex, f"{path}.vertices[{j}]", "signal vertex")
            else:
                edge = checks.station(refs, item, path, "s_line")
                if edge is not None:
                    checks.require(
                        item["junction"] == edge["to"], f"{path}.junction", "junction must match the edge destination"
                    )
                if kind == "yield":
                    checks.reference(refs.rings, item["roundabout"], f"{path}.roundabout", "roundabout")
    for key in ("nodes", "edges", "intersections", "stops", "yields", "roundabouts"):
        checks.unique((record["id"] for record in pack.get(key, [])), f"$.{key}")
    lane_counts = Counter(lane["edge"] for lane in pack["lanes"])
    for i, edge in enumerate(pack["edges"]):
        path = f"$.edges[{i}]"
        for key in ("from", "to"):
            checks.reference(refs.nodes, edge[key], f"{path}.{key}", "node")
        checks.require(edge["asphalt"][0] < edge["asphalt"][1], f"{path}.asphalt", "asphalt offsets must be ordered")
        checks.require(
            len(edge["lane_offsets"]) == edge["lanes"], f"{path}.lane_offsets", "lane offsets must match the lane count"
        )
        checks.require(
            lane_counts[edge["id"]] == edge["lanes"], f"{path}.lanes", "lane count disagrees with lane records"
        )
        if "ring" in edge:
            checks.reference(refs.rings, edge["ring"], f"{path}.ring", "roundabout")
            checks.require(
                edge["oneway"] and edge["lanes"] == 1, f"{path}.ring", "circulating edge must have one one-way lane"
            )
        if "control" in edge:
            control = edge["control"]
            checks.reference(controls, (control["type"], control["id"]), f"{path}.control.id", "control")
            checks.require(
                control["s_line"] <= edge["length"] + EDGE_LENGTH_TOLERANCE,
                f"{path}.control.s_line",
                "control is beyond the edge",
            )
            extra = {"signal": "group", "stop": "all_way", "yield": "roundabout"}[control["type"]]
            checks.require(extra in control, f"{path}.control.{extra}", f"required for {control['type']} controls")
    checks.unique(((lane["edge"], lane["idx"]) for lane in pack["lanes"]), "$.lanes")
    for i, lane in enumerate(pack["lanes"]):
        path = f"$.lanes[{i}]"
        edge = checks.reference(refs.edges, lane["edge"], f"{path}.edge", "edge")
        if edge is not None:
            checks.require(lane["idx"] < edge["lanes"], f"{path}.idx", "lane index is beyond the edge's lane count")
    for i, ring in enumerate(pack.get("roundabouts", [])):
        path = f"$.roundabouts[{i}]"
        checks.require(
            ring["island_r"] < ring["lane_r"] < ring["outer_r"],
            path,
            "expected island, lane and outer radii in increasing order",
        )
        for j, edge_id in enumerate(ring["edges"]):
            checks.reference(refs.edges, edge_id, f"{path}.edges[{j}]", "roundabout edge")
        for j, vertex in enumerate(ring["vertices"]):
            checks.reference(refs.nodes, vertex, f"{path}.vertices[{j}]", "roundabout vertex")


def check_layer(artifact, layer, refs):
    checks = Checks(artifact)
    kind = artifact.kind
    # Common registries have distinct identities. Traffic sites with multiple directions or
    # spans use their own compound keys below.
    for key, records in layer.items():
        if (
            key in {"skipped", "spans", "lanes", "edges", "scrambles"}
            or key not in LAYER_SCHEMAS[kind].required | LAYER_SCHEMAS[kind].optional
        ):
            continue
        checks.unique((item["id"] for item in records), f"$.{key}")

    if kind == "crossings":
        for i, item in enumerate(layer["crossings"]):
            path = f"$.crossings[{i}]"
            if item.get("pxo"):
                checks.require(layer["crossings_version"] == "2", path, "pedestrian crossovers require v2")
                checks.require("beacons" in item, f"{path}.beacons", "required for pedestrian crossovers")
            elif "beacons" in item:
                checks.require(False, f"{path}.beacons", "beacon flag requires a pedestrian crossover")
            if refs is not None:
                checks.station(refs, item, path)
    elif refs is not None:
        LAYER_LINKS[kind](checks, layer, refs)


def check_bridges(checks, layer, refs):
    for i, item in enumerate(layer["spans"]):
        checks.span(refs, item, f"$.spans[{i}]")


def check_buslanes(checks, layer, refs):
    checks.unique(((lane["edge"], lane["lane"]) for lane in layer["lanes"]), "$.lanes")
    for i, item in enumerate(layer["lanes"]):
        path = f"$.lanes[{i}]"
        edge = checks.reference(refs.edges, item["edge"], f"{path}.edge", "edge")
        if edge is not None:
            checks.require(
                item["lane"] < edge["lanes"], f"{path}.lane", "reserved lane index is beyond the edge's lane count"
            )
        checks.require("bus" in item["allowed"], f"{path}.allowed", "reserved lane must admit buses")
        checks.unique(item["allowed"], f"{path}.allowed")
        for j, window in enumerate(item["hours"] or []):
            checks.unique(window["days"], f"{path}.hours[{j}].days")


def check_calming(checks, layer, refs):
    for i, item in enumerate(layer["devices"]):
        path = f"$.devices[{i}]"
        checks.require(
            not item.get("crossing") or item["kind"] == "table",
            f"{path}.crossing",
            "only a table can double as a crossing",
        )
        checks.unique((location["edge"] for location in item["at"]), f"{path}.at")
        for j, location in enumerate(item["at"]):
            checks.station(refs, location, f"{path}.at[{j}]")


def check_contraflow(checks, layer, refs):
    checks.unique((item["edge"] for item in layer["edges"]), "$.edges")
    for i, item in enumerate(layer["edges"]):
        path = f"$.edges[{i}].edge"
        edge = checks.reference(refs.edges, item["edge"], path, "edge")
        if edge is not None:
            checks.require(edge["oneway"], path, "contraflow requires a one-way edge")


def check_driveways(checks, layer, refs):
    for i, item in enumerate(layer["driveways"]):
        checks.station(refs, item, f"$.driveways[{i}]")


def check_parks(checks, layer, refs):
    areas = {area["id"]: area for area in layer["areas"]}
    for i, area in enumerate(layer["areas"]):
        path = f"$.areas[{i}]"
        linear = area["kind"] in {"river", "canal"}
        checks.require(
            bool(area["lines"] if linear else area["rings"]), path, "the area is missing its mapped geometry"
        )
        checks.require(not (area["rings"] if linear else area["lines"]), path, "geometry does not match the area kind")
        if area["closed"]:
            for j, ring in enumerate(area["rings"]):
                checks.require(ring[0] == ring[-1], f"{path}.rings[{j}]", "closed ring must repeat its first point")
    for i, item in enumerate(layer["spans"]):
        path = f"$.spans[{i}]"
        checks.span(refs, item, path)
        neighbours = [
            checks.reference(areas, item[side], f"{path}.{side}", "area")
            for side in ("left", "right")
            if item[side] is not None
        ]
        checks.require(bool(neighbours), path, "span needs at least one adjacent area")
        if neighbours and all(neighbours):
            checks.require(
                item["water"] == any(is_water(a["kind"]) for a in neighbours),
                f"{path}.water",
                "water flag disagrees with adjacent areas",
            )


def check_rail(checks, layer, refs):
    tracks = {track["id"]: track for track in layer["tracks"]}
    for i, track in enumerate(layer["tracks"]):
        path = f"$.tracks[{i}].stops"
        checks.unique((stop["id"] for stop in track["stops"]), path)
        for j, stop in enumerate(track["stops"]):
            checks.require(stop["s"] <= track["length"], f"{path}[{j}].s", "stop is beyond the track length")
            if j:
                checks.require(
                    track["stops"][j - 1]["s"] <= stop["s"], f"{path}[{j}].s", "stops must be in track order"
                )
    for i, item in enumerate(layer["crossings"]):
        path = f"$.crossings[{i}]"
        track = checks.reference(tracks, item["track"], f"{path}.track", "track")
        if track is not None:
            checks.require(item["s"] <= track["length"], f"{path}.s", "crossing is beyond the track length")
        checks.unique((hit["edge"] for hit in item["edges"]), f"{path}.edges")
        for j, hit in enumerate(item["edges"]):
            checks.station(refs, hit, f"{path}.edges[{j}]")


def check_restrictions(checks, layer, refs):
    for key in ("restrictions", "red_turns"):
        for i, item in enumerate(layer.get(key, [])):
            path = f"$.{key}[{i}]"
            start = checks.reference(refs.edges, item["from"], f"{path}.from", "approach edge")
            checks.unique(item["to"], f"{path}.to")
            for j, target in enumerate(item["to"]):
                location = f"{path}.to[{j}]"
                end = checks.reference(refs.edges, target, location, "departure edge")
                if start is not None and end is not None:
                    checks.require(start["to"] == end["from"], location, "restriction edges do not meet")
            checks.require(
                not ("condition" in item and "suppressed_conditions" in item),
                path,
                "a conditional override cannot also carry baseline suppressions",
            )
            if "condition" in item:
                checks.unique(item["condition"]["days"], f"{path}.condition.days")
            for j, condition in enumerate(item.get("suppressed_conditions", [])):
                checks.unique(condition["days"], f"{path}.suppressed_conditions[{j}].days")


def check_scrambles(checks, layer, refs):
    checks.unique((item["signal"] for item in layer["scrambles"]), "$.scrambles")
    for i, item in enumerate(layer["scrambles"]):
        path = f"$.scrambles[{i}]"
        signal = checks.reference(refs.signals, item["signal"], f"{path}.signal", "signal")
        if signal is not None:
            checks.require(
                (item["x"], item["y"]) == (signal["x"], signal["y"]), path, "scramble location must match its signal"
            )


def check_transit(checks, layer, refs):
    stops = {stop["id"] for stop in layer["stops"]}
    for i, route in enumerate(layer["routes"]):
        for j, run in enumerate(route["runs"]):
            path = f"$.routes[{i}].runs[{j}]"
            previous = None
            for k, edge_id in enumerate(run["edges"]):
                location = f"{path}.edges[{k}]"
                edge = checks.reference(refs.edges, edge_id, location, "edge")
                if edge is not None and previous is not None:
                    checks.require(previous["to"] == edge["from"], location, "transit run edges do not connect")
                if edge is not None and "lane" in run:
                    checks.require(
                        run["lane"] < edge["lanes"], f"{path}.lane", f"transit lane is absent on {edge_id!r}"
                    )
                previous = edge
            run_edges = set(run["edges"])
            edge_cursor = 0
            last_station = -1
            for k, stop in enumerate(run["stops"]):
                location = f"{path}.stops[{k}]"
                checks.reference(stops, stop["id"], f"{location}.id", "transit stop")
                checks.station(refs, stop, location)
                if stop["edge"] not in run_edges:
                    checks.require(False, f"{location}.edge", "stop is on an edge outside its run")
                    continue
                while edge_cursor < len(run["edges"]) and (
                    run["edges"][edge_cursor] != stop["edge"] or stop["s"] < last_station
                ):
                    edge_cursor += 1
                    last_station = -1
                checks.require(edge_cursor < len(run["edges"]), location, "stops must be in route order")
                last_station = stop["s"]


def check_zones(checks, layer, refs):
    for i, item in enumerate(layer["zones"]):
        for j, span in enumerate(item["spans"]):
            checks.span(refs, span, f"$.zones[{i}].spans[{j}]")


LAYER_LINKS = {
    "bridges": check_bridges,
    "buslanes": check_buslanes,
    "calming": check_calming,
    "contraflow": check_contraflow,
    "driveways": check_driveways,
    "parks": check_parks,
    "rail": check_rail,
    "restrictions": check_restrictions,
    "scrambles": check_scrambles,
    "transit": check_transit,
    "zones": check_zones,
}


def audit_map(area, bbox, maps_dir, *, include_layers=None, require_rail=False):
    path = pack_path(maps_dir, bbox)
    pack_artifact, pack = _read(path, "pack", PACK_VERSION)
    artifacts = [pack_artifact]
    refs = None
    if pack is not None:
        refs = References(pack)
        check_pack(pack_artifact, pack, bbox, refs)
    pending = path.with_suffix(".layers-pending")
    if pending.exists() or pending.is_symlink():
        artifacts.append(
            Artifact(pending.name, "import", "invalid", issues=[Issue("$", "unfinished import; retry the map import")])
        )
    for name, versions in LAYER_VERSIONS.items():
        if include_layers is not None and name not in include_layers:
            continue
        found = False
        present = False
        for version in versions:
            layer_path = maps_dir / f"{cache_key(bbox)}.{name}.v{version}.json"
            artifact, layer = _read(layer_path, name, version, selected=not found)
            if artifact.status == "missing":
                continue
            present = True
            # A corrupt preferred file remains an error, but a readable fallback is still
            # identified as the selected format. Valid shadowed files are also checked.
            if layer is not None and name != "restrictions":
                Checks(artifact).require(
                    layer.get("name") == cache_key(bbox), "$.name", "layer belongs to a different extract"
                )
            artifact.selected = artifact.status == "ok" and not found
            found = found or artifact.selected
            if layer is not None:
                check_layer(artifact, layer, refs)
            artifacts.append(artifact)
        if not present:
            status = "omitted" if name in OPTIONAL_LAYERS and not require_rail else "missing"
            filename = f"{cache_key(bbox)}.{name}.v{versions[0]}.json"
            artifacts.append(Artifact(filename, name, status, selected=False))
    return MapAudit(area, bbox, artifacts)
