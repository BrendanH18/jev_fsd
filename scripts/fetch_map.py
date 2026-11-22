#!/usr/bin/env python3
"""Build a prepared street map and its layers from OpenStreetMap data."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev.config import MAPS_DIR, PRESET_BBOXES, Settings, parse_bbox  # noqa: E402
from jev.osm import fetch  # noqa: E402
from jev.osm.bridges import bridges_path, build_bridges
from jev.osm.bus_lanes import build_buslanes, buslanes_path
from jev.osm.calming import build_calming, calming_path
from jev.osm.contraflow import build_contraflow, contraflow_path
from jev.osm.crossings import build_crossings, crossings_path
from jev.osm.driveways import build_driveways, driveways_path
from jev.osm.pack import build_pack, pack_path
from jev.osm.parks import build_parks, parks_path
from jev.osm.rail import build_rail, rail_path
from jev.osm.restrictions import build_restrictions, restrictions_path
from jev.osm.scrambles import build_scrambles, scrambles_path
from jev.osm.transit import build_transit, transit_path
from jev.osm.zones import build_zones, zones_path

LAYERS = {
    "buslanes": (build_buslanes, buslanes_path, (("lanes", "lanes"),)),
    "transit": (build_transit, transit_path, (("routes", "routes"), ("stops", "stops"))),
    "crossings": (build_crossings, crossings_path, (("crossings", "crosswalks"),)),
    "zones": (build_zones, zones_path, (("zones", "school and playground zones"),)),
    "rail": (build_rail, rail_path, (("tracks", "tracks"), ("crossings", "level crossings"))),
    "calming": (build_calming, calming_path, (("devices", "speed humps, tables, cushions and bumps"),)),
    "scrambles": (build_scrambles, scrambles_path, (("scrambles", "scramble crossings"),)),
    "restrictions": (
        build_restrictions,
        restrictions_path,
        (("restrictions", "restrictions"), ("red_turns", "red-turn bans")),
    ),
    "contraflow": (build_contraflow, contraflow_path, (("edges", "one-way edges cyclists may ride both ways"),)),
    "driveways": (build_driveways, driveways_path, (("driveways", "driveways"),)),
    "parks": (build_parks, parks_path, (("areas", "parks and waters"), ("spans", "street spans beside them"))),
    "bridges": (build_bridges, bridges_path, (("spans", "street spans on bridges"),)),
}
LAYER_OPTIONS = {
    "transit": (
        "bus routes, crosswalks, school and playground zones and level crossings",
        ("crossings", "zones", "rail"),
    ),
    "zones": ("school and playground zones", ()),
    "rail": ("level crossings", ()),
    "buslanes": ("bus-only lanes", ()),
    "restrictions": ("turn restrictions", ()),
    "contraflow": ("contraflow cycling", ()),
    "driveways": ("driveways", ()),
    "parks": ("parks and water", ()),
    "bridges": ("bridges", ()),
    "calming": ("traffic calming and scramble crossings", ("scrambles",)),
    "crossings": ("crosswalks", ()),
}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog="Presets: " + ", ".join(PRESET_BBOXES),
        allow_abbrev=False,
    )
    parser.add_argument("area", metavar="AREA", nargs="?", help="preset or W,S,E,N (default: configured area)")
    parser.add_argument("--maps-dir", type=Path, default=MAPS_DIR, help="directory for all map files and raw OSM cache")
    parser.add_argument(
        "--force",
        action="store_true",
        help=(
            "rebuild the requested files; with --bridges, --crossings, --contraflow, "
            "--driveways or --parks, also refresh raw OSM"
        ),
    )
    parser.add_argument("--refresh-osm", action="store_true", help="download fresh raw OSM before rebuilding")
    for option, (description, _) in LAYER_OPTIONS.items():
        help_text = "rebuild only " + description
        if option in ("transit", "restrictions"):
            help_text += " from a fresh download"
        parser.add_argument("--" + option, action="store_true", help=help_text)

    # Treat a west-negative comma-separated coordinate as a positional argument.
    args = parser.parse_args(
        [
            " " + token if token.startswith("-") and not token.startswith("--") and "," in token else token
            for token in argv[1:]
        ]
    )
    bbox = parse_bbox(args.area) if args.area is not None else Settings().bbox
    if bbox is None:
        parser.error("AREA must be W,S,E,N in degrees or a preset name")

    selected = {
        layer
        for option, (_, companions) in LAYER_OPTIONS.items()
        if getattr(args, option)
        for layer in (option, *companions)
    }
    layer_only = bool(selected)
    maps_dir = args.maps_dir
    refresh = args.refresh_osm or args.transit or args.restrictions
    # These single-layer commands have historically used --force to refresh their raw input.
    if args.force and any(getattr(args, name) for name in ("bridges", "crossings", "contraflow", "driveways", "parks")):
        refresh = True

    print("bbox W,S,E,N = %s" % ",".join("%.5f" % v for v in bbox))
    try:
        if refresh:
            fetch.fetch_osm_xml(bbox, maps_dir, force=True, log=print)
        pending = pack_path(maps_dir, bbox).with_suffix(".layers-pending")
        # A failed import leaves this marker so a retry rebuilds the pack and all layers together.
        pack = build_pack(
            bbox,
            maps_dir,
            force=pending.is_file() or ((args.force or refresh) and not layer_only),
            log=print,
            before_publish=pending.touch,
        )
        rebuilt = pending.is_file()
        if layer_only and rebuilt:
            print("map: rebuilding all layers for the replacement pack")
        # A prepared pack can omit rail when it has no level crossings. Crossings can use v1.
        has_raw = fetch.cache_path(maps_dir, bbox).is_file()
        missing_layer = any(
            not path(maps_dir, bbox).is_file()
            and (layer != "rail" or has_raw)
            and (layer != "crossings" or not crossings_path(maps_dir, bbox, version="1").is_file())
            for layer, (_, path, _) in LAYERS.items()
        )
        if not refresh and not rebuilt and (layer_only or missing_layer):
            fetch.fetch_osm_xml(bbox, maps_dir, log=print)
        for layer, (builder, layer_path, counts) in LAYERS.items():
            if rebuilt or not layer_only or layer in selected:
                data = builder(bbox, maps_dir, pack, force=layer_only or rebuilt, log=print)
                if data is None:
                    continue
                path_args = {"version": data["crossings_version"]} if layer == "crossings" else {}
                path = layer_path(maps_dir, bbox, **path_args)
                summary = ", ".join("%d %s" % (len(data.get(key, [])), label) for key, label in counts)
                print("%s: %s (%s)" % (layer, path, summary))
        if rebuilt:
            pending.unlink()
    except (OSError, fetch.FetchError) as err:
        print("FAILED: %s" % err, file=sys.stderr)
        return 1
    if layer_only:
        return 0
    print("pack: %s" % pack_path(maps_dir, bbox))
    print(
        "edges %d, lanes %d, signalled intersections %d, stop signs %d, buildings %d"
        % tuple(len(pack[key]) for key in ("edges", "lanes", "intersections", "stops", "buildings"))
    )
    for key, value in sorted(pack["stats"].items()):
        print("  %-24s %s" % (key, value))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
