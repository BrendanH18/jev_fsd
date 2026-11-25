#!/usr/bin/env python3
"""Build a self-contained Rules-only browser demo for GitHub Pages using the standard library."""

from __future__ import annotations
import argparse
import hashlib
import json
import math
import re
import shutil
import sys
import stat
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from jev import VERSION
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
from scripts.demo_doc_links import check_paths, emit_findings


DEMO_URL = "https://brendanh18.github.io/jev_fsd/"

PAGES = {
    "index.html": ("js/start.js", "css/app.css", "css/lab.css"),
    "bench.html": ("js/bench/main.js", "css/app.css", "css/bench.css"),
    "arena.html": ("js/lab/arena.js", "css/app.css", "css/arena.css"),
    "results.html": ("js/ui/results.js", "css/app.css", "css/arena.css", "css/results.css"),
}
ROUTE_PATHS = {"/": "./", **{f"/{page[:-5]}": f"./{page}" for page in PAGES if page != "index.html"}}
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
COPY_SUFFIXES = {"js": ".js", "css": ".css", "vendor": ".js", "replays": ".json"}
VENDOR_TEXT_FILES = {"LICENSE", "README.md"}
EXTRA_ASSETS = {
    "favicon.svg": "static/favicon.svg",
    "assets/social.jpg": "docs/readme/social.jpg",
    "LICENSE": "LICENSE",
}
ATTRIBUTION = (
    "Map data © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright\n"
    "Three.js: MIT, see vendor/three/LICENSE. Jev FSD: MIT.\n"
)
REQUIRED_ASSETS = (".nojekyll", *EXTRA_ASSETS, "ATTRIBUTION.txt", "vendor/three/LICENSE")
ALIASES = {"three": "./vendor/three/build/three.module.js", "three/addons/": "./vendor/three/examples/jsm/"}
# The project uses static import/export declarations and literal lazy imports.
STATIC_IMPORT = re.compile(r"""^(?:import\s*|(?:import|export)\s+[^;]*?\sfrom\s*)['"]([^'"\n]+)['"]""", re.MULTILINE)
LAZY_IMPORT = re.compile(r"""\bimport\(\s*['"]([^'"\n]+)['"]\s*\)""")
ASSET_URL = re.compile(r"""url\(\s*(?:'([^']*)'|"([^"]*)"|([^\s)]+))\s*\)""", re.I)
CSS_IMPORT = re.compile(r"""@import\s*['"]([^'"\n]+)['"]""", re.I)
URL_ATTR = re.compile(r"""(\b(?:src|href|action|poster)\s*=\s*)(["'])(.*?)\2""", re.I)
IMPORT_BLOCK = re.compile(r"""(<script\b[^>]*\btype=["']importmap["'][^>]*>)(.*?)(</script\s*>)""", re.I | re.S)
HEAD = re.compile(r"<head(?:\s[^>]*)?>", re.I)
HEAD_END = re.compile(r"</head\s*>", re.I)


class DemoPage(HTMLParser):
    def __init__(self, text: str) -> None:
        super().__init__()
        self.urls: list[tuple[str, str, int]] = []
        self.ids: set[str] = set()
        self.duplicate_ids: set[str] = set()
        self.demo_markers: list[str | None] = []
        self.session_tokens = 0
        self.importmaps: list[tuple[str, int]] = []
        self.modules: list[tuple[str, int]] = []
        self.styles: list[str] = []
        self.forbidden: list[str] = []
        self.social_images: list[str | None] = []
        self.versions: list[str | None] = []
        self._in_importmap = False
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if tag == "base":
            self.forbidden.append("<base> overrides the project path")
        if tag in {"object", "embed", "iframe"}:
            self.forbidden.append(f"<{tag}> embeds another document")
        if id_ := attrs.get("id"):
            if id_ in self.ids:
                self.duplicate_ids.add(id_)
            self.ids.add(id_)
        if tag == "a" and attrs.get("name"):
            self.ids.add(attrs["name"])
        line = self.getpos()[0]
        for name, value in attrs.items():
            if value and name in ("href", "src", "action", "poster", "formaction", "xlink:href"):
                kind = "navigation" if name == "href" and tag in ("a", "area") else "resource"
                self.urls.append((kind, value, line))
        if attrs.get("srcset"):
            self.urls.extend(
                ("resource", value.strip().split()[0], line) for value in attrs["srcset"].split(",") if value.strip()
            )
        if tag == "link" and "stylesheet" in (attrs.get("rel") or "").lower().split() and attrs.get("href"):
            self.styles.append(attrs["href"])
        if tag == "meta":
            name = attrs.get("name") or ""
            if name == "jev-demo":
                self.demo_markers.append(attrs.get("content"))
            if name == "jev-version":
                self.versions.append(attrs.get("content"))
            if name.lower() == "jev-csrf":
                self.session_tokens += 1
            if (attrs.get("http-equiv") or "").lower() == "refresh":
                self.forbidden.append("meta refresh redirects before the demo can load")
            if attrs.get("property") == "og:image":
                self.social_images.append(attrs.get("content"))
        if tag == "script":
            script_type = (attrs.get("type") or "").lower()
            if script_type == "module":
                self.modules.append((attrs.get("src") or "", line))
            if script_type == "importmap":
                if attrs.get("src"):
                    self.forbidden.append("import maps must be inline")
                self._in_importmap = True
                self.importmaps.append(("", line))

    def handle_endtag(self, tag):
        if tag == "script":
            self._in_importmap = False

    def handle_data(self, data):
        if self._in_importmap:
            source, line = self.importmaps[-1]
            self.importmaps[-1] = (source + data, line)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError(f"{path}: {error}") from error


def unique_json_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def non_json_number(token):
    raise ValueError(f"{token} is not a JSON number")


def finite_json_float(token):
    value = float(token)
    if not math.isfinite(value):
        raise ValueError(f"{token} overflows a JSON number")
    return value


def decode(source: str, label: str):
    try:
        return json.loads(
            source, object_pairs_hook=unique_json_keys, parse_constant=non_json_number, parse_float=finite_json_float
        )
    except (ValueError, RecursionError) as error:
        raise ValueError(f"{label}: {error}") from error


def artifact_json(path: Path, expected_type=None):
    data = decode(read_text(path), str(path))
    if expected_type and not isinstance(data, expected_type):
        raise ValueError(f"{path}: expected a JSON {expected_type.__name__}")
    return data


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False), encoding="utf-8")


def local_target(output: Path, source: Path, url: str, *, kind: str) -> Path | None:
    label = source.relative_to(output).as_posix()
    if any(ord(character) < 32 for character in url) or "\\" in unquote(url):
        raise ValueError(f"{label}: invalid URL ({url!r})")
    try:
        parts = urlsplit(url)
    except ValueError as error:
        raise ValueError(f"{label}: invalid URL ({url!r})") from error
    if parts.scheme or parts.netloc:
        if kind == "navigation" and parts.scheme in {"http", "https", "mailto", "tel"}:
            return None
        if kind in {"resource", "style resource"} and parts.scheme == "data" and url.lower().startswith("data:image/"):
            return None
        if kind == "import map":
            raise ValueError(f"{label}: import map depends on a remote module ({url})")
        raise ValueError(f"{label}: unexpected external {kind} ({url})")
    path = unquote(parts.path)
    if any(ord(character) < 32 for character in path):
        raise ValueError(f"{label}: invalid encoded URL ({url!r})")
    target = (source.parent / path).resolve() if path else source
    if path.startswith("/") or not target.is_relative_to(output):
        raise ValueError(f"{label}: link escapes the demo base ({url})")
    if target.is_dir():
        if kind == "import map" and path.endswith("/"):
            return target
        if kind != "navigation":
            raise ValueError(f"{label}: {kind} points to a directory ({url})")
        target /= "index.html"
    if not target.is_file():
        raise ValueError(f"{label}: missing link target ({url})")
    if not target.stat().st_size:
        raise ValueError(f"{label}: empty {kind} target ({url})")
    return target


def verify_importmap(output: Path, page: Path, doc: DemoPage) -> None:
    is_index = page.name == "index.html"
    if len(doc.importmaps) != int(is_index):
        raise ValueError(f"{page.name}: expected {'one import map for Three.js' if is_index else 'no import map'}")
    if not is_index:
        return
    source, line = doc.importmaps[0]
    if any(module_line < line for _, module_line in doc.modules):
        raise ValueError(f"{page.name}: import map must precede module scripts")
    config = decode(source, f"{page.name}:{line}: import map")
    imports = config.get("imports") if isinstance(config, dict) else None
    if not isinstance(imports, dict) or not all(isinstance(target, str) and target for target in imports.values()):
        raise ValueError(f"{page.name}: invalid import map")
    if "scopes" in config:
        raise ValueError(f"{page.name}: scoped import maps are unsupported by the demo verifier")
    if not ALIASES.keys() <= imports.keys():
        raise ValueError(f"{page.name}: import map is missing Three.js aliases")
    for specifier, target in imports.items():
        if specifier.endswith("/") and not target.endswith("/"):
            raise ValueError(f"{page.name}: import map package aliases must end in a slash ({specifier})")
        resolved = local_target(output, page, target, kind="import map")
        if specifier.endswith("/") and not resolved.is_dir():
            raise ValueError(f"{page.name}: import map package alias must target a directory ({specifier})")
        if specifier in ALIASES and resolved != (output / ALIASES[specifier]).resolve():
            raise ValueError(f"{page.name}: unexpected Three.js alias target ({specifier})")


def verify_pages(output: Path) -> None:
    pages = {output / page: DemoPage(read_text(output / page)) for page in PAGES}
    for page, doc in pages.items():
        if doc.demo_markers != ["rules-only"]:
            raise ValueError(f"{page.name}: expected one rules-only demo marker")
        if doc.session_tokens:
            raise ValueError(f"{page.name}: contains a local Jev session token")
        if doc.versions != [VERSION]:
            raise ValueError(f"{page.name}: demo version must match {VERSION}")
        if doc.forbidden:
            raise ValueError(f"{page.name}: {doc.forbidden[0]}")
        if doc.duplicate_ids:
            raise ValueError(f"{page.name}: duplicate HTML IDs: {', '.join(sorted(doc.duplicate_ids))}")
        verify_importmap(output, page, doc)
        for kind, url, line in doc.urls:
            target = local_target(output, page, url, kind=kind)
            fragment = unquote(urlsplit(url).fragment)
            linked = pages.get(target)
            if fragment and linked and fragment not in linked.ids:
                raise ValueError(f"{page.name}:{line}: missing link anchor ({url})")
        expected_module, *expected_styles = PAGES[page.name]
        modules = [local_target(output, page, url, kind="module") if url else None for url, _ in doc.modules]
        if modules != [output / expected_module]:
            raise ValueError(f"{page.name}: expected one entry module, {expected_module}")
        styles = [local_target(output, page, url, kind="stylesheet") for url in doc.styles]
        if len(styles) != len(set(styles)):
            raise ValueError(f"{page.name}: duplicate stylesheets")
        if not {output / stylesheet for stylesheet in expected_styles} <= set(styles):
            raise ValueError(f"{page.name}: missing a required stylesheet")
        expected_image_url = f"{DEMO_URL}assets/social.jpg"
        if doc.social_images != [expected_image_url]:
            raise ValueError(f"{page.name}: expected the published social image URL")


def verify_code_assets(output: Path, files: set[str]) -> None:
    for name in sorted(files):
        path = output / name
        if path.suffix == ".css":
            source = re.sub(r"/\*.*?\*/", "", read_text(path), flags=re.S)
            for match in ASSET_URL.finditer(source):
                local_target(
                    output, path, next(group for group in match.groups() if group is not None), kind="style resource"
                )
            for target in CSS_IMPORT.findall(source):
                local_target(output, path, target, kind="stylesheet")
        if path.suffix != ".js":
            continue
        source = read_text(path)
        for specifier in (*STATIC_IMPORT.findall(source), *LAZY_IMPORT.findall(source)):
            if specifier in ALIASES:
                continue
            if specifier.startswith("three/addons/"):
                local_target(
                    output,
                    output / "index.html",
                    ALIASES["three/addons/"] + specifier.removeprefix("three/addons/"),
                    kind="module",
                )
            elif specifier.startswith(("./", "../")):
                local_target(output, path, specifier, kind="module")
            else:
                raise ValueError(f"{name}: unsupported demo module specifier ({specifier})")


def paths_in(directory: Path):
    """Visit children without following links or reading file contents."""
    return sorted(directory.rglob("*"))


def check_regular(path: Path, root: Path, *, source: bool = False) -> None:
    mode = path.lstat().st_mode
    if source and any(parent.is_symlink() for parent in path.parents if parent.is_relative_to(root)):
        raise ValueError(f"Unexpected symbolic link in demo source: {path.relative_to(root)}")
    if (
        not (stat.S_ISREG(mode) or stat.S_ISDIR(mode))
        or (path.name.startswith(".") and (source or path.name != ".nojekyll"))
        or path.suffix in {".py", ".pyc", ".pem", ".key"}
        or path.name in {".git", ".gitignore", ".DS_Store"}
        or (not source and stat.S_ISREG(mode) and path.stat().st_nlink > 1)
    ):
        where = "demo source" if source else "the demo"
        raise ValueError(f"Unexpected file in {where}: {path.relative_to(root)}")


def asset_sources() -> dict[str, Path]:
    assets = {name: ROOT / path for name, path in EXTRA_ASSETS.items()}
    static = ROOT / "static"
    for directory, suffix in COPY_SUFFIXES.items():
        base = static / directory
        check_regular(base, ROOT, source=True)
        if not base.is_dir():
            raise ValueError(f"Demo source directory is not a directory: {directory}")
        for path in paths_in(base):
            check_regular(path, ROOT, source=True)
            if path.is_file():
                if path.suffix != suffix and not (directory == "vendor" and path.name in VENDOR_TEXT_FILES):
                    raise ValueError(f"Unsupported demo asset type: {path.relative_to(static)}")
                assets[path.relative_to(static).as_posix()] = path
    for path in (*assets.values(), *(static / page for page in PAGES)):
        check_regular(path, ROOT, source=True)
    return assets


def bundled_maps() -> list:
    maps = catalog(MAPS_DIR)
    if not maps or not any(item["id"] == "kitsilano" for item in maps):
        raise ValueError("The demo catalog requires its default Kitsilano map")
    return maps


def load_map_source(item: dict) -> dict:
    key = item["id"]
    source = pack_path(MAPS_DIR, PRESET_BBOXES[key])
    if not source.is_file():
        raise FileNotFoundError(f"Missing bundled map: {key} ({source.name})")
    check_regular(source, ROOT, source=True)
    pack = artifact_json(source, dict)
    if not item["cached"]:
        raise ValueError(f"{key}: source map pack did not pass catalog validation")
    return pack


def expected_pack(item: dict, source: dict) -> dict:
    box = PRESET_BBOXES[item["id"]]
    pack = source.copy()
    pack["routing_bbox"] = item["bbox"]
    for layer, load in LAYERS.items():
        issues = []
        try:
            loaded = load(box, MAPS_DIR, log=issues.append)
        except (OSError, ValueError) as error:
            raise ValueError(f"{item['id']}: could not load source {layer} layer: {error}") from error
        if issues:
            raise ValueError(f"{item['id']}: invalid {layer} source layer: {issues[0]}")
        if loaded:
            pack[layer] = loaded
    pack["utc_offset"] = item["utc_offset"]
    return pack


def drift(expected, actual, path="") -> str | None:
    if type(expected) is not type(actual):
        return path or "root"
    if isinstance(expected, dict):
        if missing := expected.keys() ^ actual.keys():
            return f"{path}.{min(missing)}"
        for key in expected:
            difference = drift(expected[key], actual[key], f"{path}.{key}")
            if difference:
                return difference
    elif isinstance(expected, list):
        if len(expected) != len(actual):
            return f"{path}.length"
        for i, (wanted, got) in enumerate(zip(expected, actual)):
            difference = drift(wanted, got, f"{path}[{i}]")
            if difference:
                return difference
    elif actual != expected:
        return path or "root"
    return None


def verify_data(output: Path, maps: list) -> None:
    data = output / "demo-data"
    actual_maps = artifact_json(data / "catalog.json", list)
    if difference := drift(maps, actual_maps):
        raise ValueError(f"Bundled map catalog differs from the current local catalog at {difference}")
    for item in maps:
        key = item["id"]
        pack = artifact_json(data / f"{key}.json", dict)
        source = load_map_source(item)
        if pack.get("pack_version") != source.get("pack_version"):
            raise ValueError(f"{key}: bundled pack version differs from the source")
        if pack.get("routing_bbox") != item["bbox"] or pack.get("utc_offset") != item["utc_offset"]:
            raise ValueError(f"{key}: bundled bounds or clock differ from the catalog")
        expected = expected_pack(item, source)
        if difference := drift(expected, pack):
            field = difference.lstrip(".").split(".", 1)[0].split("[", 1)[0]
            description = f"{field} layer" if field in LAYERS else f"pack field {field}"
            raise ValueError(f"{key}: bundled {description} differs from the source at {difference}")
    results_path = data / "results.json"
    results = artifact_json(results_path, dict)
    if results.get("format") != "jev-results/1":
        raise ValueError("Bundled leaderboard uses an unsupported results format")
    map_names = results.get("maps")
    if not isinstance(map_names, (list, dict)):
        raise ValueError("Bundled leaderboard has no map list")
    if not all(isinstance(key, str) for key in map_names):
        raise ValueError("Bundled leaderboard has an invalid map ID")
    if not set(map_names).issubset({item["id"] for item in maps}):
        raise ValueError("Bundled leaderboard names maps outside the catalog")
    if not isinstance(results.get("drivers"), dict):
        raise ValueError("Bundled leaderboard has no drivers object")
    if not isinstance(results.get("rows"), list) or not all(isinstance(row, dict) for row in results["rows"]):
        raise ValueError("Bundled leaderboard has invalid rows")
    if results_path.read_bytes() != (ROOT / "data" / "results.json").read_bytes():
        raise ValueError("Bundled leaderboard differs from the committed data/results.json")


def verify(output: Path) -> None:
    if output.is_symlink():
        raise ValueError("The output directory must not be a symbolic link.")
    output = output.resolve()
    if not output.is_dir():
        raise ValueError(f"Demo output directory does not exist: {output}")
    files = set()
    for path in paths_in(output):
        check_regular(path, output)
        if path.is_file():
            files.add(path.relative_to(output).as_posix())
    for asset in REQUIRED_ASSETS:
        path = output / asset
        if not path.is_file() or (asset != ".nojekyll" and path.stat().st_size == 0):
            raise ValueError(f"Missing demo asset: {asset}")
    if (output / ".nojekyll").stat().st_size:
        raise ValueError(".nojekyll must be empty")
    if (output / "ATTRIBUTION.txt").read_bytes() != ATTRIBUTION.encode("utf-8"):
        raise ValueError("Bundled attribution differs from the demo's attribution text")
    verify_pages(output)
    assets = asset_sources()
    maps = bundled_maps()
    for name, source in assets.items():
        destination = output / name
        if not destination.is_file() or source.read_bytes() != destination.read_bytes():
            if name.startswith("replays/"):
                raise ValueError(f"Bundled replay differs from source: {destination.name}")
            raise ValueError(f"Bundled asset differs from source: {name}")
    generated = {*PAGES, ".nojekyll", "ATTRIBUTION.txt", "demo-data/catalog.json", "demo-data/results.json"}
    generated.update(f"demo-data/{item['id']}.json" for item in maps)
    for name in sorted(files - assets.keys() - generated):
        if name.startswith("replays/"):
            raise ValueError(f"Bundled replay has no source: {name.removeprefix('replays/')}")
        raise ValueError(f"Unexpected file in the demo: {name}")
    verify_code_assets(output, files)
    verify_data(output, maps)


def rebase_url(url: str) -> str:
    if not url.startswith("/") or url.startswith("//"):
        return url
    parts = urlsplit(url)
    if parts.path in ROUTE_PATHS:
        path = ROUTE_PATHS[parts.path]
    elif parts.path.startswith(("/css/", "/js/", "/vendor/", "/replays/", "/assets/")) or parts.path == "/favicon.svg":
        path = f".{parts.path}"
    else:
        return url
    return urlunsplit(("", "", path, parts.query, parts.fragment))


def render_page(source: str, page: str, count: int) -> str:
    if len(HEAD.findall(source)) != 1 or len(HEAD_END.findall(source)) != 1:
        raise ValueError(f"{page}: expected one HTML head")
    content = HEAD.sub(
        lambda match: (
            match[0] + '\n  <meta name="jev-demo" content="rules-only">\n'
            f'  <meta name="jev-version" content="{VERSION}">\n'
            '  <meta name="description" content="A driving test for AI models, on real Canadian streets, that you can also take yourself. Free, open source, in your browser.">'
        ),
        source,
    )
    content = HEAD_END.sub(
        '<meta property="og:title" content="Jev Drive Lab: a driving test for AI, on real Canadian streets">\n'
        f'<meta property="og:description" content="{count} real Canadian neighbourhoods, 60 challenges and 2 road tests. Take the wheel, or hand it to an AI and see every decision it makes.">\n'
        f'<meta property="og:image" content="{DEMO_URL}assets/social.jpg">\n'
        '<meta name="twitter:card" content="summary_large_image">\n</head>',
        content,
    )
    content = URL_ATTR.sub(lambda m: f"{m[1]}{m[2]}{rebase_url(m[3])}{m[2]}", content)

    def rewrite_importmap(match):
        config = decode(match[2], f"{page}: import map")
        if not isinstance(config, dict) or not isinstance(config.get("imports"), dict):
            raise ValueError(f"{page}: invalid import map")
        config["imports"] = {
            key: rebase_url(value) if isinstance(value, str) else value for key, value in config["imports"].items()
        }
        return f"{match[1]}\n{json.dumps(config, indent=2)}\n{match[3]}"

    return IMPORT_BLOCK.sub(rewrite_importmap, content)


def check_destination(output: Path) -> None:
    protected = [
        ROOT / name
        for name in ("static", "data", "docs", "jev", "scripts", "tests", ".git", ".github", ".venv", "node_modules")
    ]
    if ROOT.is_relative_to(output) or any(output.is_relative_to(path) for path in protected):
        raise ValueError("Choose a separate generated output directory.")
    if output.is_symlink():
        raise ValueError("The output directory must not be a symbolic link.")
    if not output.exists():
        return
    if not output.is_dir():
        raise ValueError("The output path must be a directory.")
    if any(path.is_symlink() for path in paths_in(output)):
        raise ValueError("Generated output directory contains a symbolic link")
    if any(output.iterdir()):
        catalog_file = output / "demo-data" / "catalog.json"
        index = output / "index.html"
        if (
            not catalog_file.is_file()
            or not index.is_file()
            or DemoPage(read_text(index)).demo_markers != ["rules-only"]
        ):
            raise ValueError("Choose an empty directory or a previous demo build as the output.")


def assemble(stage: Path, maps: list, assets: dict[str, Path]) -> None:
    for name, source in assets.items():
        target = stage / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    for page in PAGES:
        source = read_text(ROOT / "static" / page)
        (stage / page).write_text(render_page(source, page, len(maps)), encoding="utf-8")
    data = stage / "demo-data"
    data.mkdir()
    for item in maps:
        write_json(data / f"{item['id']}.json", expected_pack(item, load_map_source(item)))
    write_json(data / "catalog.json", maps)
    results = ROOT / "data" / "results.json"
    check_regular(results, ROOT, source=True)
    shutil.copyfile(results, data / "results.json")
    (stage / ".nojekyll").touch()
    (stage / "ATTRIBUTION.txt").write_text(ATTRIBUTION, encoding="utf-8")


def build(output: Path) -> None:
    if output.is_symlink():
        raise ValueError("The output directory must not be a symbolic link.")
    output = output.resolve()
    check_destination(output)
    maps = bundled_maps()
    assets = asset_sources()
    output.parent.mkdir(parents=True, exist_ok=True)
    working = Path(tempfile.mkdtemp(prefix=".jev-demo-", dir=output.parent))
    backup = working / "previous"
    keep_backup = False
    try:
        stage = working / "stage"
        stage.mkdir(mode=0o755)
        assemble(stage, maps, assets)
        verify(stage)
        check_destination(output)
        if not output.exists():
            stage.rename(output)
        else:
            try:
                output.rename(backup)
                stage.rename(output)
            except BaseException:
                if backup.exists():
                    try:
                        backup.rename(output)
                    except OSError as error:
                        keep_backup = True
                        raise OSError(
                            f"Could not restore the demo; the previous output is at {backup}: {error}"
                        ) from error
                raise
    finally:
        if not keep_backup:
            shutil.rmtree(working)
    print(f"Built {len(maps)} bundled neighbourhoods in {output}")


def report(output: Path) -> dict:
    verify(output)
    output = output.resolve()
    files = [path for path in paths_in(output) if path.is_file()]
    maps = artifact_json(output / "demo-data/catalog.json", list)
    return {
        "format": "jev-demo-report/1",
        "version": VERSION,
        "leaderboard_sha256": hashlib.sha256((output / "demo-data/results.json").read_bytes()).hexdigest(),
        "files": len(files),
        "total_bytes": sum(path.stat().st_size for path in files),
        "pages": list(PAGES),
        "maps": [
            {"id": item["id"], "bytes": (output / "demo-data" / f"{item['id']}.json").stat().st_size} for item in maps
        ],
        "replays": [path.stem for path in files if path.parent == output / "replays"],
        "largest_files": [
            {"path": path.relative_to(output).as_posix(), "bytes": path.stat().st_size}
            for path in sorted(files, key=lambda path: (-path.stat().st_size, path))[:10]
        ],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".demo-site")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="verify an existing demo without rewriting it")
    mode.add_argument("--list-maps", action="store_true", help="print the bundled map catalog as JSON")
    mode.add_argument("--report", action="store_true", help="verify and print a JSON artifact size and contents report")
    mode.add_argument(
        "--check-docs",
        nargs="*",
        type=Path,
        metavar="PATH",
        help="check repository Markdown links (all docs by default)",
    )
    parser.add_argument("--format", choices=("text", "json", "github"), help="output format for --check-docs")
    args = parser.parse_args(argv)
    if args.check_docs is not None:
        try:
            findings = check_paths(ROOT, args.check_docs)
        except ValueError as error:
            parser.error(str(error))
        return emit_findings(findings, args.format or "text")
    if args.format:
        parser.error("--format requires --check-docs")
    try:
        if args.list_maps:
            print(json.dumps(catalog(MAPS_DIR)))
        elif args.check:
            verify(args.output)
            print(f"Verified demo in {args.output}")
        elif args.report:
            print(json.dumps(report(args.output), indent=2))
        else:
            build(args.output)
    except (OSError, ValueError) as error:
        parser.exit(1, f"build_demo: {error}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
