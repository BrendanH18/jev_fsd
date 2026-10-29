"""Parse OSM XML into plain dicts: nodes, ways, and the relations that are bus and streetcar routes
(jev/osm/transit.py)
or school and playground areas (jev/osm/zones.py)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Union


TRANSIT_ROUTES = ("bus", "trolleybus", "tram")


class OsmData:
    """nodes: id -> (lat, lon, tags). ways: list of {id, nodes: [node ids], tags}. relations: list of
    {id, members: [(type, ref, role)], tags}, only bus, trolleybus and tram routes and multipolygons that
    are schools or playgrounds."""

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
    if isinstance(source, (bytes, str)) and not isinstance(source, Path) and (
            isinstance(source, bytes) or source.lstrip().startswith("<")):
        root = ET.fromstring(source)
    else:
        root = ET.parse(str(source)).getroot()
    data = OsmData()
    for el in root:
        if el.tag == "node":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            data.add_node(int(el.get("id")), float(el.get("lat")), float(el.get("lon")), tags)
        elif el.tag == "way":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            refs = [int(nd.get("ref")) for nd in el.findall("nd")]
            data.add_way(int(el.get("id")), refs, tags)
        elif el.tag == "relation":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if (tags.get("type") == "route" and tags.get("route") in TRANSIT_ROUTES) or (
                    tags.get("type") == "multipolygon" and (tags.get("amenity") == "school" or tags.get("leisure") == "playground")):
                members = [(m.get("type"), int(m.get("ref")), m.get("role") or "") for m in el.findall("member")]
                data.add_relation(int(el.get("id")), members, tags)
    return data
