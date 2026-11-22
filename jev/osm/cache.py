"""Publish map cache files only once their contents are complete."""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory


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
