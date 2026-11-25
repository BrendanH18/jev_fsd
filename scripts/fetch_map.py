#!/usr/bin/env python3
"""Build a prepared street map and its layers from OpenStreetMap data."""

from __future__ import annotations

import argparse
import sys
from functools import cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev.config import MAPS_DIR, PRESET_BBOXES, Settings, parse_bbox  # noqa: E402
from jev.osm import fetch  # noqa: E402
from jev.osm.audit import audit_map, valid_bbox
from jev.osm.audit_report import render
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
    parser.add_argument("--offline", action="store_true", help="use only saved packs, layers and raw OSM")
    parser.add_argument(
        "--osm-file", type=Path, help="rebuild from local OSM XML or .osm.gz without updating the raw download cache"
    )
    audit_options = parser.add_argument_group("read-only audit")
    audit_options.add_argument(
        "--audit", action="store_true", help="check prepared files without reading raw OSM or writing"
    )
    audit_options.add_argument("--all", action="store_true", help="audit every bundled preset")
    audit_options.add_argument("--json", action="store_true", help="write the audit as JSON")
    audit_options.add_argument("--require-rail", action="store_true", help="require a rail sidecar during audit")
    audit_options.add_argument("--against", type=Path, help="also audit and compare bytes with this directory")
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
    bbox = parse_bbox(args.area) if args.area is not None else None
    if not args.all and args.area is None:
        bbox = Settings().bbox
    if not args.all and (bbox is None or not valid_bbox(bbox)):
        parser.error("AREA must be ordered W,S,E,N in degrees or a preset name")
    if args.audit and (args.force or args.refresh_osm or args.osm_file is not None):
        parser.error("--audit cannot be combined with --force, --refresh-osm or --osm-file")
    if not args.audit and (args.all or args.json or args.require_rail or args.against is not None):
        parser.error("--all, --json, --require-rail and --against require --audit")
    if args.all and args.area is not None:
        parser.error("--all cannot be combined with an explicit AREA")
    if args.against is not None and not args.against.is_dir():
        parser.error("--against must name an existing reference directory")
    if args.refresh_osm and (args.offline or args.osm_file is not None):
        parser.error("--refresh-osm cannot be combined with --offline or --osm-file")

    selected = {
        layer
        for option, (_, companions) in LAYER_OPTIONS.items()
        if getattr(args, option)
        for layer in (option, *companions)
    }
    layer_only = bool(selected)
    maps_dir = args.maps_dir
    if args.audit:
        if not maps_dir.is_dir():
            parser.error("--maps-dir must name an existing directory for audit")
        label = args.area.strip().lower() if args.area is not None else "configured"
        areas = PRESET_BBOXES if args.all else {label: bbox}
        if args.require_rail and selected and "rail" not in selected:
            parser.error("--require-rail needs rail in the selected layers")
        options = {"include_layers": selected or None, "require_rail": args.require_rail}
        audits = [audit_map(name, bounds, maps_dir, **options) for name, bounds in areas.items()]
        references = None
        if args.against is not None:
            references = {name: audit_map(name, bounds, args.against, **options) for name, bounds in areas.items()}
        output, ok = render(audits, references, machine=args.json)
        print(output)
        return 0 if ok else 1
    refresh = not (args.offline or args.osm_file is not None) and (
        args.refresh_osm
        or args.transit
        or args.restrictions
        or (
            args.force
            and any(getattr(args, name) for name in ("bridges", "crossings", "contraflow", "driveways", "parks"))
        )
    )

    @cache
    def source():
        if args.osm_file is not None:
            return fetch.read_xml(args.osm_file)
        path = fetch.fetch_osm_xml(bbox, maps_dir, force=refresh, offline=args.offline, log=print)
        return fetch.read_xml(path)

    print("bbox W,S,E,N = %s" % ",".join("%.5f" % v for v in bbox))
    try:
        if refresh:
            source()
        pending = pack_path(maps_dir, bbox).with_suffix(".layers-pending")
        # A failed import leaves this marker so a retry rebuilds the pack and all layers together.
        pack = build_pack(
            bbox,
            maps_dir,
            force=pending.is_file() or ((args.force or refresh or args.osm_file is not None) and not layer_only),
            log=print,
            before_publish=pending.touch,
            load_osm=source,
        )
        rebuilt = pending.is_file()
        if layer_only and rebuilt:
            print("map: rebuilding all layers for the replacement pack")
        deferred_rail = False

        def report(layer, data):
            layer_path, counts = LAYERS[layer][1:]
            path_args = {"version": data["crossings_version"]} if layer == "crossings" else {}
            path = layer_path(maps_dir, bbox, **path_args)
            summary = ", ".join("%d %s" % (len(data.get(key, [])), label) for key, label in counts)
            print("%s: %s (%s)" % (layer, path, summary))

        for layer, (builder, layer_path, counts) in LAYERS.items():
            if rebuilt or not layer_only or layer in selected:
                # Some bundled maps lack a rail layer. An omitted rail layer alone does
                # not warrant fetching raw OSM.
                optional_rail = (
                    layer == "rail"
                    and not (rebuilt or refresh or layer_only or args.osm_file is not None)
                    and not fetch.cache_path(maps_dir, bbox).is_file()
                )
                data = builder(
                    bbox,
                    maps_dir,
                    pack,
                    force=layer_only or rebuilt,
                    log=print,
                    load_osm=None if optional_rail else source,
                )
                if data is None:
                    deferred_rail = deferred_rail or optional_rail
                    continue
                report(layer, data)
        # A later layer may have loaded the raw source that the skipped rail layer needed.
        if deferred_rail and source.cache_info().currsize:
            data = LAYERS["rail"][0](bbox, maps_dir, pack, force=False, log=print, load_osm=source)
            if data is not None:
                report("rail", data)
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
