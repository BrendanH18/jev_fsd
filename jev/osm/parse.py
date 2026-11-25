"""Parse OSM XML into plain dicts: nodes, ways, and the relations that are bus and streetcar routes
(jev/osm/transit.py)
or school and playground areas (jev/osm/zones.py), or parks and water (jev/osm/parks.py)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from gzip import open as gzip_open
from math import isfinite
from pathlib import Path
from typing import Dict, List, Union


TRANSIT_ROUTES = ("bus", "trolleybus", "tram")


def _green_or_water(tags: dict) -> bool:
    """A park, garden, recreation ground, lawn or body of water (jev/osm/parks.py)."""
    return (
        tags.get("leisure") in ("park", "garden", "recreation_ground")
        or tags.get("natural") == "water"
        or tags.get("waterway") == "riverbank"
        or tags.get("landuse") == "grass"
    )


class OsmData:
    """nodes: id -> (lat, lon, tags). ways: list of {id, nodes: [node ids], tags}. relations: list of
    {id, members: [(type, ref, role)], tags}, only bus, trolleybus and tram routes, turn restrictions
    (type=restriction or restriction:on_red), and multipolygons that are schools or playgrounds, or the
    parks and water of jev/osm/parks.py."""

    def __init__(self):
        self.nodes: Dict[int, tuple] = {}
        self.ways: List[dict] = []
        self.relations: List[dict] = []

    def add_node(self, node_id: int, lat: float, lon: float, tags: dict = None) -> None:
        self.nodes[node_id] = (lat, lon, tags or {})

    def add_way(self, way_id: int, node_ids: List[int], tags: dict = None) -> None:
        self.ways.append({"id": way_id, "nodes": list(node_ids), "tags": tags or {}})

    def add_relation(self, relation_id: int, members: List[tuple], tags: dict = None) -> None:
        self.relations.append({"id": relation_id, "members": list(members), "tags": tags or {}})


def parse_xml(source: Union[Path, str, bytes]) -> OsmData:
    try:
        if isinstance(source, bytes) or (isinstance(source, str) and source.lstrip("\ufeff \t\r\n").startswith("<")):
            root = ET.fromstring(source)
        elif Path(source).suffix == ".gz":
            with gzip_open(source, "rb") as stream:
                root = ET.parse(stream).getroot()
        else:
            root = ET.parse(source).getroot()
    except (ET.ParseError, LookupError, ValueError) as err:
        raise ValueError(f"Invalid OSM XML: {err}") from err
    if root.tag != "osm":
        raise ValueError(f"Expected an OSM XML document, got <{root.tag}>")
    for element in ("error", "remark"):
        notice = root.find(element)
        if notice is not None:
            message = " ".join("".join(notice.itertext()).split())[:200]
            raise ValueError(f"OSM reported an error: {message or element}")
    return parse_records(root)


def _attribute(element: ET.Element, name: str) -> str:
    value = element.get(name)
    if value is None:
        raise ValueError(f"<{element.tag}> is missing {name!r}")
    return value


def _number(element: ET.Element, name: str, convert):
    value = _attribute(element, name)
    try:
        return convert(value)
    except ValueError as err:
        raise ValueError(f"<{element.tag}> has invalid {name!r} ({value[:80]!r})") from err


def _relation_members(element: ET.Element) -> list[tuple]:
    members = []
    for member in element.findall("member"):
        kind = _attribute(member, "type")
        if kind not in ("node", "way", "relation"):
            raise ValueError(f"unsupported member type {kind[:80]!r}")
        members.append((kind, _number(member, "ref", int), member.get("role") or ""))
    return members


def parse_records(root: ET.Element) -> OsmData:
    data = OsmData()
    for el in root:
        if el.tag not in ("node", "way", "relation"):
            continue
        try:
            tags = {}
            for tag in el.findall("tag"):
                key, value = _attribute(tag, "k"), _attribute(tag, "v")
                if not key.strip():
                    raise ValueError("tag key must not be empty")
                if key in tags and tags[key] != value:
                    raise ValueError(f"conflicting values for tag {key[:80]!r}")
                tags[key] = value
            if el.tag == "node":
                lat, lon = _number(el, "lat", float), _number(el, "lon", float)
                if not (isfinite(lat) and isfinite(lon)):
                    raise ValueError("node coordinates must be finite")
                if not -90 <= lat <= 90:
                    raise ValueError("latitude must lie within [-90, 90]")
                if not -180 <= lon <= 180:
                    raise ValueError("longitude must lie within [-180, 180]")
                node_id = _number(el, "id", int)
                if node_id in data.nodes and data.nodes[node_id] != (lat, lon, tags):
                    raise ValueError("conflicting records for the same node ID")
                data.add_node(node_id, lat, lon, tags)
            elif el.tag == "way":
                refs = [_number(nd, "ref", int) for nd in el.findall("nd")]
                data.add_way(_number(el, "id", int), refs, tags)
            elif (
                tags.get("type") in ("restriction", "restriction:on_red")
                or (tags.get("type") == "route" and tags.get("route") in TRANSIT_ROUTES)
                or (
                    tags.get("type") == "multipolygon"
                    and (
                        tags.get("amenity") == "school" or tags.get("leisure") == "playground" or _green_or_water(tags)
                    )
                )
            ):
                data.add_relation(_number(el, "id", int), _relation_members(el), tags)
        except ValueError as err:
            record = el.get("id", "?")[:80]
            raise ValueError(f"Invalid OSM records: {el.tag} {record!r}: {err}") from err
    return data
