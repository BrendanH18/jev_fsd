"""Publish map cache files only once their contents are complete."""

from __future__ import annotations

import json
from math import isfinite
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Callable


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key {key[:80]!r}")
        result[key] = value
    return result


def _finite_float(token):
    value = float(token)
    if not isfinite(value):
        raise ValueError("non-finite JSON number")
    return value


def decode_json(raw: bytes) -> dict:
    """Decode the UTF-8 format used by current and legacy map artifacts."""
    return json.loads(
        raw.decode("utf-8"),
        object_pairs_hook=_unique_object,
        parse_float=_finite_float,
        parse_constant=_finite_float,
    )


def read_layer(
    path: Path,
    layer: str,
    version: str,
    fields: tuple[str, ...],
    log: Callable[[str], None],
    *,
    optional: tuple[str, ...] = (),
) -> dict | None:
    """Read a derived layer, treating corrupt data as a cache miss."""
    try:
        if not path.is_file():
            return None
        data = decode_json(path.read_bytes())
        extract = path.name.split(".", 1)[0]
        if not isinstance(data, dict) or data.get(f"{layer}_version") != version:
            raise ValueError(f"expected a v{version} {layer} object")
        if "name" in data and data["name"] not in ("", extract):
            raise ValueError("layer belongs to a different extract")
        for field in (*fields, *(name for name in optional if name in data)):
            records = data.get(field)
            if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
                raise ValueError(f"{field} must be an array of objects")
        return data
    except (OSError, ValueError, RecursionError) as err:
        log(f"map: ignoring invalid layer {path.name} ({err})")
        return None


def write_bytes(path: Path, data: bytes, *, replace: bool = True) -> None:
    with TemporaryDirectory(prefix=".map-write-", dir=path.parent) as work:
        temporary = Path(work) / path.name
        temporary.write_bytes(data)
        if replace:
            temporary.replace(path)
        else:
            path.hardlink_to(temporary)


def write_json(path: Path, data: dict, *, replace: bool = True) -> None:
    write_bytes(path, json.dumps(data, separators=(",", ":"), allow_nan=False).encode("utf-8"), replace=replace)
