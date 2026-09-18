"""Parse OSM XML into plain dicts. Only nodes and ways; relations are not needed."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Union


class OsmData:
    """nodes: id -> (lat, lon, tags). ways: list of {id, nodes: [node ids], tags}."""

    def __init__(self):
        self.nodes: Dict[int, tuple] = {}
        self.ways: List[dict] = []

    def add_node(self, node_id: int, lat: float, lon: float, tags: dict = None) -> None:
        self.nodes[node_id] = (lat, lon, tags or {})

    def add_way(self, way_id: int, node_ids: List[int], tags: dict = None) -> None:
        self.ways.append({"id": way_id, "nodes": list(node_ids), "tags": tags or {}})


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
    return data
