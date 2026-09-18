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
from pathlib import Path
from typing import Callable, Optional, Sequence, Tuple

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
    return (
        "[out:xml][timeout:90][bbox:%f,%f,%f,%f];"
        "(way[\"highway\"];way[\"building\"];);"
        "out body;>;out body qt;" % (s, w, n, e)
    )


def _http(url: str, data: Optional[bytes], timeout: float) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_osm_xml(bbox: Bbox, cache_dir: Path, timeout: float = 90.0, force: bool = False,
                  log: Callable[[str], None] = lambda _msg: None,
                  http: Callable[[str, Optional[bytes], float], bytes] = _http,
                  sleep: Callable[[float], None] = time.sleep) -> Path:
    """Return the path of the cached XML for `bbox`, downloading it first when needed."""
    w, s, e, n = bbox
    if (e - w) * (n - s) > MAX_AREA_DEG2:
        raise FetchError("Bounding box is larger than 0.25 square degrees; pick a smaller area.")
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_path(cache_dir, bbox)
    if path.exists() and not force:
        log("map: using cached %s" % path.name)
        return path

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
                if not raw.lstrip().startswith(b"<?xml") and b"<osm" not in raw[:400]:
                    raise FetchError("%s returned something that is not OSM XML" % name)
                tmp = path.with_suffix(".tmp")
                tmp.write_bytes(raw)
                tmp.replace(path)
                log("map: saved %s (%d KB)" % (path.name, len(raw) // 1024))
                return path
            except urllib.error.HTTPError as err:
                errors.append("%s: HTTP %s" % (name, err.code))
                if err.code in (400, 404):  # our fault, no point retrying this source
                    break
            except (urllib.error.URLError, OSError, FetchError) as err:
                errors.append("%s: %s" % (name, err))
            if attempt < len(BACKOFF_S) - 1:
                sleep(delay + random.random() * 0.5)
    raise FetchError("Could not download map data. " + "; ".join(errors[-4:]))
