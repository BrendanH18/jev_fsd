#!/usr/bin/env python3
"""Download and build the map pack for a bounding box ahead of time, and print its statistics.

    uv run scripts/fetch_map.py                                   # the configured/default bbox
    uv run scripts/fetch_map.py -123.1120,49.2570,-123.0940,49.2680   # W,S,E,N
    uv run scripts/fetch_map.py mount_pleasant                   # a preset name
    uv run scripts/fetch_map.py ... --force                       # rebuild even when cached
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jev.config import MAPS_DIR, Settings, parse_bbox  # noqa: E402
from jev.osm import fetch  # noqa: E402
from jev.osm.pack import build_pack, pack_path  # noqa: E402


def main(argv: list) -> int:
    force = "--force" in argv
    args = [a for a in argv[1:] if not a.startswith("--")]
    bbox = parse_bbox(args[0]) if args else Settings().bbox
    if bbox is None:
        print("Bounding box must be W,S,E,N in degrees or a preset name.")
        return 2
    print("bbox W,S,E,N = %s" % ",".join("%.5f" % v for v in bbox))
    try:
        pack = build_pack(bbox, MAPS_DIR, force=force, log=print)
    except fetch.FetchError as err:
        print("FAILED: %s" % err)
        return 1
    print("pack: %s" % pack_path(MAPS_DIR, bbox))
    print("edges %d, lanes %d, signalled intersections %d, stop signs %d, buildings %d" % (
        len(pack["edges"]), len(pack["lanes"]), len(pack["intersections"]), len(pack["stops"]), len(pack["buildings"])))
    for k, v in sorted(pack["stats"].items()):
        print("  %-24s %s" % (k, v))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
