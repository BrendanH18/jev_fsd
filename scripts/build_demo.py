#!/usr/bin/env python3
"""Build a self-contained Rules-only browser demo for GitHub Pages. No secrets or SDK needed."""
from __future__ import annotations
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from jev.config import MAPS_DIR, PRESET_BBOXES
from jev.maps import catalog
from jev.osm.pack import pack_path


def build(output: Path) -> None:
    output = output.resolve()
    if output == ROOT or output == ROOT / "static" or ROOT.is_relative_to(output):
        raise ValueError("Choose a separate generated output directory.")
    output.mkdir(parents=True, exist_ok=True)
    for directory in ("js", "css", "vendor"):
        shutil.copytree(ROOT / "static" / directory, output / directory, dirs_exist_ok=True)
    for page in ("index.html", "bench.html", "arena.html"):
        text = (ROOT / "static" / page).read_text()
        text = text.replace("<head>", '<head>\n  <meta name="jev-demo" content="rules-only">\n  <meta name="description" content="Drive real Canadian streets, challenge an AI driver, and inspect every decision. Free open-source browser simulator.">')
        text = text.replace("</head>", '<meta property="og:title" content="Jev Drive Lab — Can you beat the AI?">\n<meta property="og:description" content="Real Canadian streets. Four driving challenges. Inspect every decision.">\n<meta property="og:image" content="https://brendanh18.github.io/jev_fsd/assets/drive-lab.png">\n<meta name="twitter:card" content="summary_large_image">\n</head>')
        text = re.sub(r'(["\'])/(css|js|vendor)/', r'\1./\2/', text)
        text = text.replace('href="/"', 'href="./"')
        text = text.replace('href="/favicon.svg"', 'href="./favicon.svg"')
        (output / page).write_text(text)
    data = output / "demo-data"
    data.mkdir(exist_ok=True)
    maps = catalog(MAPS_DIR)
    for item in maps:
        source = pack_path(MAPS_DIR, PRESET_BBOXES[item["id"]])
        if not source.is_file():
            raise FileNotFoundError(f"Missing bundled map: {item['id']}")
        pack = json.loads(source.read_text())
        pack["routing_bbox"] = item["bbox"]
        (data / f"{item['id']}.json").write_text(json.dumps(pack, separators=(",", ":")))
    (data / "catalog.json").write_text(json.dumps(maps, separators=(",", ":")))
    (output / ".nojekyll").touch()
    shutil.copyfile(ROOT / "static" / "favicon.svg", output / "favicon.svg")
    (output / "assets").mkdir(exist_ok=True)
    if (ROOT / "docs" / "drive-lab.png").is_file():
        shutil.copyfile(ROOT / "docs" / "drive-lab.png", output / "assets" / "drive-lab.png")
    shutil.copyfile(ROOT / "LICENSE", output / "LICENSE")
    (output / "ATTRIBUTION.txt").write_text("Map data © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright\nThree.js: MIT, see vendor/three/LICENSE. Jev FSD: MIT.\n")
    print(f"Built {len(maps)} bundled neighbourhoods in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".demo-site")
    build(parser.parse_args().output)
