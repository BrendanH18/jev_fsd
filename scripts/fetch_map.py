#!/usr/bin/env python3
"""Download and build the map pack for a bounding box ahead of time, with its bus routes and stops
(jev/osm/transit.py), marked crosswalks (jev/osm/crossings.py), school and playground zones
(jev/osm/zones.py), railway level crossings (jev/osm/rail.py), speed humps and the like
(jev/osm/calming.py), scramble crossings (jev/osm/scrambles.py), the one-way streets cyclists may
ride both ways (jev/osm/contraflow.py) and driveways (jev/osm/driveways.py), and print its statistics.

    uv run scripts/fetch_map.py                                   # the configured/default bbox
    uv run scripts/fetch_map.py -123.1120,49.2570,-123.0940,49.2680   # W,S,E,N
    uv run scripts/fetch_map.py mount_pleasant                   # a preset name
    uv run scripts/fetch_map.py ... --force                       # rebuild even when cached
    uv run scripts/fetch_map.py ... --transit                     # rebuild only the bus routes, crosswalks,
                                                                  # zones and level crossings, from a fresh
                                                                  # download of the raw OSM
    uv run scripts/fetch_map.py ... --zones                       # rebuild only the zones, from the raw OSM
                                                                  # (downloaded if it is not cached)
    uv run scripts/fetch_map.py ... --rail                        # rebuild only the level crossings, likewise
    uv run scripts/fetch_map.py ... --buslanes                    # rebuild only the bus-lane layer
    uv run scripts/fetch_map.py ... --restrictions                # refetch OSM and rebuild only turn restrictions
    uv run scripts/fetch_map.py ... --contraflow                  # rebuild only the contraflow cycling layer, from
                                                                  # the raw OSM (downloaded if it is not cached)
    uv run scripts/fetch_map.py ... --driveways                   # rebuild only the driveways layer, from the raw
                                                                  # OSM (downloaded if it is not cached)
    uv run scripts/fetch_map.py ... --calming                     # rebuild only the speed humps and the
                                                                  # scramble crossings, likewise
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev.config import MAPS_DIR, Settings, parse_bbox  # noqa: E402
from jev.osm.restrictions import build_restrictions
from jev.osm import fetch  # noqa: E402
from jev.osm.pack import build_pack, pack_path  # noqa: E402
from jev.osm.bus_lanes import build_buslanes, buslanes_path
from jev.osm.calming import build_calming, calming_path  # noqa: E402
from jev.osm.contraflow import build_contraflow, contraflow_path  # noqa: E402
from jev.osm.crossings import build_crossings, crossings_path  # noqa: E402
from jev.osm.driveways import build_driveways, driveways_path  # noqa: E402
from jev.osm.rail import build_rail, rail_path  # noqa: E402
from jev.osm.scrambles import build_scrambles, scrambles_path  # noqa: E402
from jev.osm.transit import build_transit, transit_path  # noqa: E402
from jev.osm.zones import build_zones, zones_path  # noqa: E402


def main(argv: list) -> int:
    force = "--force" in argv
    args = [a for a in argv[1:] if not a.startswith("--")]
    bbox = parse_bbox(args[0]) if args else Settings().bbox
    if bbox is None:
        print("Bounding box must be W,S,E,N in degrees or a preset name.")
        return 2
    print("bbox W,S,E,N = %s" % ",".join("%.5f" % v for v in bbox))
    try:
        if "--restrictions" in argv:
            pack = build_pack(bbox, MAPS_DIR, log=print)
            fetch.fetch_osm_xml(bbox, MAPS_DIR, force=True, log=print)
            build_restrictions(bbox, MAPS_DIR, pack, force=True, log=print)
            return 0
        if "--contraflow" in argv:
            # Rebuild only the sidecar; never rebuild the street pack or other layers.
            pack = build_pack(bbox, MAPS_DIR, log=print)
            fetch.fetch_osm_xml(bbox, MAPS_DIR, force=force, log=print)
            contraflow = build_contraflow(bbox, MAPS_DIR, pack, force=True, log=print)
            print("contraflow: %s (%d one-way edges cyclists may ride both ways)" % (contraflow_path(MAPS_DIR, bbox), len(contraflow["edges"])))
            return 0
        if "--driveways" in argv:
            # Rebuild only the sidecar; never rebuild the street pack or other layers.
            pack = build_pack(bbox, MAPS_DIR, log=print)
            fetch.fetch_osm_xml(bbox, MAPS_DIR, force=force, log=print)
            driveways = build_driveways(bbox, MAPS_DIR, pack, force=True, log=print)
            print("driveways: %s (%d driveways)" % (driveways_path(MAPS_DIR, bbox), len(driveways["driveways"])))
            return 0
        if "--crossings" in argv:
            # Rebuild only the sidecar; never rebuild the street pack or other layers.
            pack = build_pack(bbox, MAPS_DIR, log=print)
            fetch.fetch_osm_xml(bbox, MAPS_DIR, force=force, log=print)
            crossings = build_crossings(bbox, MAPS_DIR, pack, force=True, log=print)
            print("crossings: %s (%d crosswalks)" % (crossings_path(MAPS_DIR, bbox), len(crossings["crossings"])))
            return 0
        calm = "--calming" in argv
        busonly = "--buslanes" in argv
        only = "--transit" in argv or "--zones" in argv or "--rail" in argv or calm or busonly
        pack = build_pack(bbox, MAPS_DIR, force=force and not only, log=print)
        if "--transit" in argv:
            # (the pack stays as it is: only its bus routes, crosswalks, zones and level crossings are rebuilt,
            # from today's OSM)
            fetch.fetch_osm_xml(bbox, MAPS_DIR, force=True, log=print)
        elif "--zones" in argv or "--rail" in argv or calm or busonly:
            fetch.fetch_osm_xml(bbox, MAPS_DIR, log=print)
        buslanes = build_buslanes(bbox, MAPS_DIR, pack, force=force or busonly, log=print)
        transit = build_transit(bbox, MAPS_DIR, pack, force=force or "--transit" in argv, log=print)
        crossings = build_crossings(bbox, MAPS_DIR, pack, force=force or "--transit" in argv, log=print)
        zones = build_zones(bbox, MAPS_DIR, pack, force=force or (only and "--rail" not in argv and not calm and not busonly), log=print)
        rail = build_rail(bbox, MAPS_DIR, pack, force=force or (only and "--zones" not in argv and not calm and not busonly), log=print)
        calming = build_calming(bbox, MAPS_DIR, pack, force=force or calm, log=print)
        scrambles = build_scrambles(bbox, MAPS_DIR, pack, force=force or calm, log=print)
        contraflow = build_contraflow(bbox, MAPS_DIR, pack, force=force, log=print)
        driveways = build_driveways(bbox, MAPS_DIR, pack, force=force, log=print)
    except fetch.FetchError as err:
        print("FAILED: %s" % err)
        return 1
    if buslanes:
        print("buslanes: %s (%d lanes)" % (buslanes_path(MAPS_DIR, bbox), len(buslanes["lanes"])))
    if transit:
        print("transit: %s (%d routes, %d stops)" % (transit_path(MAPS_DIR, bbox), len(transit["routes"]), len(transit["stops"])))
    if crossings:
        print("crossings: %s (%d crosswalks)" % (crossings_path(MAPS_DIR, bbox), len(crossings["crossings"])))
    if zones:
        print("zones: %s (%d school and playground zones)" % (zones_path(MAPS_DIR, bbox), len(zones["zones"])))
    if rail:
        print("rail: %s (%d tracks, %d level crossings)" % (rail_path(MAPS_DIR, bbox), len(rail["tracks"]), len(rail["crossings"])))
    if calming:
        print("calming: %s (%d speed humps, tables, cushions and bumps)" % (calming_path(MAPS_DIR, bbox), len(calming["devices"])))
    if scrambles:
        print("scrambles: %s (%d scramble crossings)" % (scrambles_path(MAPS_DIR, bbox), len(scrambles["scrambles"])))
    if contraflow:
        print("contraflow: %s (%d one-way edges cyclists may ride both ways)" % (contraflow_path(MAPS_DIR, bbox), len(contraflow["edges"])))
    if driveways:
        print("driveways: %s (%d driveways)" % (driveways_path(MAPS_DIR, bbox), len(driveways["driveways"])))
    print("pack: %s" % pack_path(MAPS_DIR, bbox))
    print("edges %d, lanes %d, signalled intersections %d, stop signs %d, buildings %d" % (
        len(pack["edges"]), len(pack["lanes"]), len(pack["intersections"]), len(pack["stops"]), len(pack["buildings"])))
    for k, v in sorted(pack["stats"].items()):
        print("  %-24s %s" % (k, v))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
