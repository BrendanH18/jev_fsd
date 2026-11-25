#!/usr/bin/env python3
"""Build a self-contained Rules-only browser demo for GitHub Pages. No secrets or SDK needed."""

from __future__ import annotations
import argparse
import json
import re
import shutil
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.maps import catalog
from jev.osm.pack import pack_path
from jev.osm.bus_lanes import load_buslanes
from jev.osm.restrictions import load_restrictions
from jev.osm.calming import load_calming
from jev.osm.contraflow import load_contraflow
from jev.osm.crossings import load_crossings
from jev.osm.driveways import load_driveways
from jev.osm.parks import load_parks
from jev.osm.bridges import load_bridges
from jev.osm.rail import load_rail
from jev.osm.scrambles import load_scrambles
from jev.osm.transit import load_transit
from jev.osm.zones import load_zones


PAGES = ("index.html", "bench.html", "arena.html", "results.html")
LAYERS = {
    "transit": load_transit,
    "crossings": load_crossings,
    "zones": load_zones,
    "rail": load_rail,
    "buslanes": load_buslanes,
    "restrictions": load_restrictions,
    "calming": load_calming,
    "scrambles": load_scrambles,
    "contraflow": load_contraflow,
    "driveways": load_driveways,
    "parks": load_parks,
    "bridges": load_bridges,
}
REQUIRED_ASSETS = (
    ".nojekyll",
    "favicon.svg",
    "assets/social.jpg",
    "LICENSE",
    "ATTRIBUTION.txt",
    "vendor/three/LICENSE",
)


class DemoPage(HTMLParser):
    def __init__(self, text: str) -> None:
        super().__init__()
        self.urls = []
        self.ids = set()
        self.demo_markers = []
        self.session_tokens = 0
        self.importmaps = []
        self._in_importmap = False
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.add(attrs["id"])
        self.urls.extend(value for name, value in attrs.items() if name in ("href", "src") and value)
        if tag == "meta" and attrs.get("name") == "jev-demo":
            self.demo_markers.append(attrs.get("content"))
        if tag == "meta" and attrs.get("name") == "jev-csrf":
            self.session_tokens += 1
        if tag == "script" and attrs.get("type") == "importmap":
            self._in_importmap = True
            self.importmaps.append("")

    def handle_endtag(self, tag):
        if tag == "script":
            self._in_importmap = False

    def handle_data(self, data):
        if self._in_importmap:
            self.importmaps[-1] += data


def artifact_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError(f"{path}: {error}") from error


def verify(output: Path) -> None:
    output = output.resolve()
    pages = {page: DemoPage((output / page).read_text(encoding="utf-8")) for page in PAGES}
    for page, doc in pages.items():
        if doc.demo_markers != ["rules-only"]:
            raise ValueError(f"{page}: expected one rules-only demo marker")
        if doc.session_tokens:
            raise ValueError(f"{page}: contains a local Jev session token")
        if page == "index.html" and len(doc.importmaps) != 1:
            raise ValueError(f"{page}: expected one import map for Three.js")
        import_urls = []
        for source in doc.importmaps:
            imports = json.loads(source).get("imports")
            if not isinstance(imports, dict) or not all(isinstance(target, str) for target in imports.values()):
                raise ValueError(f"{page}: invalid import map")
            if page == "index.html" and not {"three", "three/addons/"} <= imports.keys():
                raise ValueError(f"{page}: import map is missing Three.js aliases")
            import_urls.extend(imports.values())
        for url in [*doc.urls, *import_urls]:
            parts = urlsplit(url)
            if parts.scheme or parts.netloc:
                if url in import_urls:
                    raise ValueError(f"{page}: import map depends on a remote module ({url})")
                continue
            path = unquote(parts.path)
            target = (output / (path or page)).resolve()
            if path.startswith("/") or not target.is_relative_to(output):
                raise ValueError(f"{page}: link escapes the demo base ({url})")
            if target.is_dir():
                if url in import_urls and path.endswith("/"):
                    continue
                target /= "index.html"
            if not target.is_file():
                raise ValueError(f"{page}: missing link target ({url})")
            linked = pages.get(target.relative_to(output).as_posix())
            if parts.fragment and linked and unquote(parts.fragment) not in linked.ids:
                raise ValueError(f"{page}: missing link anchor ({url})")
    for asset in REQUIRED_ASSETS:
        path = output / asset
        if not path.is_file() or (asset != ".nojekyll" and path.stat().st_size == 0):
            raise ValueError(f"Missing demo asset: {asset}")
    for path in output.rglob("*"):
        if path.is_symlink() or path.name.startswith(".env") or path.suffix == ".py":
            raise ValueError(f"Unexpected file in the demo: {path.relative_to(output)}")

    data = output / "demo-data"
    maps = artifact_json(data / "catalog.json")
    expected_maps = catalog(MAPS_DIR)
    if maps != expected_maps:
        raise ValueError("Bundled map catalog differs from the current local catalog")
    for item in maps:
        key = item["id"]
        pack = artifact_json(data / f"{key}.json")
        source = artifact_json(pack_path(MAPS_DIR, PRESET_BBOXES[key]))
        if pack.get("pack_version") != source.get("pack_version"):
            raise ValueError(f"{key}: bundled pack version differs from the source")
        if pack.get("routing_bbox") != item["bbox"] or pack.get("utc_offset") != item["utc_offset"]:
            raise ValueError(f"{key}: bundled bounds or clock differ from the catalog")
        for layer, load in LAYERS.items():
            expected = load(PRESET_BBOXES[key], MAPS_DIR)
            if expected and pack.get(layer) != expected:
                raise ValueError(f"{key}: bundled {layer} layer differs from the source")
    results = artifact_json(data / "results.json")
    if results.get("format") != "jev-results/1":
        raise ValueError("Bundled leaderboard uses an unsupported results format")
    if not isinstance(results.get("maps"), (list, dict)):
        raise ValueError("Bundled leaderboard has no map list")
    if not set(results["maps"]).issubset({item["id"] for item in maps}):
        raise ValueError("Bundled leaderboard names maps outside the catalog")
    for source in sorted((ROOT / "static" / "replays").glob("*.json")):
        destination = output / "replays" / source.name
        if not destination.is_file() or source.read_bytes() != destination.read_bytes():
            raise ValueError(f"Bundled replay differs from source: {source.name}")
    sources = {path.name for path in (ROOT / "static" / "replays").glob("*.json")}
    for stale in sorted((output / "replays").glob("*")):
        if stale.name not in sources:
            raise ValueError(f"Bundled replay has no source: {stale.name}")


def build(output: Path) -> None:
    output = output.resolve()
    protected = [ROOT / name for name in ("static", "data", "docs", "jev", "scripts", "tests", ".git", ".github")]
    if ROOT.is_relative_to(output) or any(output.is_relative_to(path) for path in protected):
        raise ValueError("Choose a separate generated output directory.")
    if output.exists() and any(path.is_symlink() for path in output.rglob("*")):
        raise ValueError("Generated output directory contains a symbolic link")
    # Rebuild from empty, so files deleted from the source don't survive in a reused output directory.
    if output.exists() and any(output.iterdir()):
        if not (output / "demo-data" / "catalog.json").is_file():
            raise ValueError("Choose an empty directory or a previous demo build as the output.")
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)
    for directory in ("js", "css", "vendor", "replays"):
        shutil.copytree(ROOT / "static" / directory, output / directory, dirs_exist_ok=True)
    for page in PAGES:
        text = (ROOT / "static" / page).read_text(encoding="utf-8")
        text = text.replace(
            "<head>",
            '<head>\n  <meta name="jev-demo" content="rules-only">\n  <meta name="description" content="A driving test for AI models, on real Canadian streets, that you can also take yourself. Free, open source, in your browser.">',
        )
        text = text.replace(
            "</head>",
            '<meta property="og:title" content="Jev Drive Lab: a driving test for AI, on real Canadian streets">\n<meta property="og:description" content="Twelve real Canadian neighbourhoods, 60 challenges and 2 road tests. Take the wheel, or hand it to an AI and see every decision it makes.">\n<meta property="og:image" content="https://brendanh18.github.io/jev_fsd/assets/social.jpg">\n<meta name="twitter:card" content="summary_large_image">\n</head>',
        )
        text = re.sub(r'(["\'])/(css|js|vendor)/', r"\1./\2/", text)
        text = text.replace('href="/"', 'href="./"')
        text = re.sub(r'href="/(arena|bench|results)"', r'href="./\1.html"', text)
        text = text.replace('href="/favicon.svg"', 'href="./favicon.svg"')
        (output / page).write_text(text, encoding="utf-8")
    data = output / "demo-data"
    data.mkdir(exist_ok=True)
    maps = catalog(MAPS_DIR)
    for item in maps:
        source = pack_path(MAPS_DIR, PRESET_BBOXES[item["id"]])
        if not source.is_file():
            raise FileNotFoundError(f"Missing bundled map: {item['id']}")
        pack = json.loads(source.read_text())
        pack["routing_bbox"] = item["bbox"]
        for layer, load in LAYERS.items():
            loaded = load(PRESET_BBOXES[item["id"]], MAPS_DIR)
            if loaded:
                pack[layer] = loaded
        pack["utc_offset"] = item["utc_offset"]
        (data / f"{item['id']}.json").write_text(json.dumps(pack, separators=(",", ":")))
    (data / "catalog.json").write_text(json.dumps(maps, separators=(",", ":")))
    # The committed results (scripts/build_results.py) for the leaderboard page.
    shutil.copyfile(ROOT / "data" / "results.json", data / "results.json")
    (output / ".nojekyll").touch()
    shutil.copyfile(ROOT / "static" / "favicon.svg", output / "favicon.svg")
    (output / "assets").mkdir(exist_ok=True)
    shutil.copyfile(ROOT / "docs" / "readme" / "social.jpg", output / "assets" / "social.jpg")
    shutil.copyfile(ROOT / "LICENSE", output / "LICENSE")
    (output / "ATTRIBUTION.txt").write_text(
        "Map data © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright\nThree.js: MIT, see vendor/three/LICENSE. Jev FSD: MIT.\n"
    )
    verify(output)
    print(f"Built {len(maps)} bundled neighbourhoods in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".demo-site")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="verify an existing demo without rewriting it")
    mode.add_argument("--list-maps", action="store_true", help="print the bundled map catalog as JSON")
    args = parser.parse_args()
    try:
        if args.list_maps:
            print(json.dumps(catalog(MAPS_DIR)))
        elif args.check:
            verify(args.output)
            print(f"Verified demo in {args.output}")
        else:
            build(args.output)
    except (OSError, ValueError) as error:
        parser.exit(1, f"build_demo: {error}\n")
