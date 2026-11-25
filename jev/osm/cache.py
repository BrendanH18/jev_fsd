"""Publish map cache files only once their contents are complete."""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Callable


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
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get(f"{layer}_version") != version:
            raise ValueError(f"expected a v{version} {layer} object")
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
    write_bytes(path, json.dumps(data, separators=(",", ":")).encode("utf-8"), replace=replace)
