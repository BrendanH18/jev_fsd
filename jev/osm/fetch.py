"""Download raw OSM XML for a bounding box and cache it on disk.

The OpenStreetMap main API (`/api/0.6/map`) is the primary source: for a neighbourhood-sized box it
answers in a few seconds and was far more reliable than Overpass while this was built. Overpass
mirrors are the fallback, asked for XML so one parser handles both. This is the only module that
talks to OSM. Nothing here knows about roads; it just returns the path of an XML file.
"""

from __future__ import annotations

import hashlib
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from http.client import HTTPException
from math import isfinite
from pathlib import Path
from typing import Callable, Optional, Tuple

from .cache import write_bytes
from .parse import OsmData, parse_xml

Bbox = Tuple[float, float, float, float]  # W, S, E, N

FETCH_VERSION = "1"
USER_AGENT = "jev-fsd/0.1 (local driving demo; https://docs.typesafe.ai)"
OSM_MAP_URL = "https://api.openstreetmap.org/api/0.6/map?bbox={w},{s},{e},{n}"
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
BACKOFF_S = (2.0, 5.0, 10.0)
MAX_AREA_DEG2 = 0.25  # the main API's hard limit


class FetchError(Exception):
    pass


def cache_key(bbox: Bbox) -> str:
    text = "v%s:%.5f,%.5f,%.5f,%.5f" % ((FETCH_VERSION,) + tuple(bbox))
    return hashlib.sha1(text.encode()).hexdigest()[:12]


def cache_path(cache_dir: Path, bbox: Bbox) -> Path:
    return cache_dir / ("%s.osm.xml" % cache_key(bbox))


def overpass_query(bbox: Bbox) -> str:
    w, s, e, n = bbox
    # (bus and streetcar routes with a member in the box too, as the main API returns them, without
    # their members outside it, and the railway and streetcar tracks, jev/osm/rail.py; and schools and
    # playgrounds, jev/osm/zones.py, and the parks and water geese live by, jev/osm/parks.py, with the
    # ways of their multipolygons; and the stops beside the tracks)
    return (
        "[out:xml][timeout:90][bbox:%f,%f,%f,%f];"
        '(way["highway"];way["building"];way["railway"~"^(rail|light_rail|tram|narrow_gauge)$"];way["amenity"="school"];way["leisure"="playground"];'
        'way["leisure"~"^(park|garden|recreation_ground)$"];way["natural"="water"];way["waterway"~"^(river|canal|riverbank)$"];way["landuse"="grass"];)->.a;'
        '(rel["amenity"="school"];rel["leisure"~"^(playground|park|garden|recreation_ground)$"];rel["natural"="water"];rel["waterway"="riverbank"];rel["landuse"="grass"];)->.z;way(r.z)->.zw;'
        "(.a;.zw;)->.a;"
        ".a out body;.a >;out body qt;"
        '(node["amenity"="school"];node["leisure"="playground"];node["railway"~"^(tram_stop|halt|station)$"];);out body qt;'
        '.z out body;rel["type"~"^restriction(:on_red)?$"];out body;'
        'rel["route"~"^(bus|trolleybus|tram)$"];out body;' % (s, w, n, e)
    )


def _http(url: str, data: Optional[bytes], timeout: float) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def read_xml(source: Path | bytes) -> OsmData:
    try:
        return parse_xml(source)
    except (OSError, ValueError) as err:
        prefix = f"{source.name}: " if isinstance(source, Path) else ""
        raise FetchError(f"{prefix}{err}") from err


def read_cached_osm(bbox: Bbox, maps_dir: Path, log: Callable[[str], None]) -> OsmData | None:
    """Optional raw input for a derived layer. Do not request it from the network."""
    path = cache_path(maps_dir, bbox)
    if path.is_file():
        try:
            return read_xml(path)
        except FetchError as err:
            log(f"map: cannot build layer ({err})")
    return None


def fetch_osm_xml(
    bbox: Bbox,
    cache_dir: Path,
    timeout: float = 90.0,
    force: bool = False,
    log: Callable[[str], None] = lambda _msg: None,
    http: Callable[[str, Optional[bytes], float], bytes] = _http,
    sleep: Callable[[float], None] = time.sleep,
    *,
    offline: bool = False,
) -> Path:
    """Return the path of the cached XML for `bbox`, downloading it first when needed."""
    w, s, e, n = bbox
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise FetchError("Expected W,S,E,N in degrees with positive width and height.")
    if offline and force:
        raise FetchError("Refreshing raw OSM requires network access.")
    path = cache_path(cache_dir, bbox)
    if path.is_file() and not force:
        try:
            read_xml(path)
        except FetchError as err:
            if offline:
                raise
            log("map: replacing invalid cache %s (%s)" % (path.name, err))
        else:
            log("map: using cached %s" % path.name)
            return path
    if offline:
        raise FetchError(f"No cached OSM file at {path}")
    if (e - w) * (n - s) > MAX_AREA_DEG2:
        raise FetchError("Bounding box is larger than 0.25 square degrees; pick a smaller area.")
    if not isfinite(timeout) or timeout <= 0:
        raise FetchError("OSM download timeout must be finite and positive.")
    cache_dir.mkdir(parents=True, exist_ok=True)

    attempts = []
    attempts.append(("osm main api", OSM_MAP_URL.format(w=w, s=s, e=e, n=n), None))
    body = urllib.parse.urlencode({"data": overpass_query(bbox)}).encode()
    for url in OVERPASS_URLS:
        attempts.append(("overpass %s" % urllib.parse.urlparse(url).netloc, url, body))

    errors = []
    for name, url, data in attempts:
        for attempt, delay in enumerate(BACKOFF_S):
            try:
                log("map: fetching %s (attempt %d)" % (name, attempt + 1))
                raw = http(url, data, timeout)
                read_xml(raw)
            except urllib.error.HTTPError as err:
                errors.append("%s: HTTP %s" % (name, err.code))
                if err.code in (400, 404):  # our fault, no point retrying this source
                    break
            except (OSError, HTTPException, FetchError) as err:
                errors.append("%s: %s" % (name, err))
            else:
                try:
                    write_bytes(path, raw)
                except OSError as err:
                    raise FetchError("Could not save %s: %s" % (path.name, err)) from err
                log("map: saved %s (%d KB)" % (path.name, len(raw) // 1024))
                return path
            if attempt < len(BACKOFF_S) - 1:
                sleep(delay + random.random() * 0.5)
    raise FetchError("Could not download map data. " + "; ".join(errors[-4:]))
