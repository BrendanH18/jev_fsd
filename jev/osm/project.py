"""Equirectangular projection around the bounding-box center. Good to well under a meter over a
few kilometers, which is all a one-neighbourhood map needs. x east, y north, meters."""

from __future__ import annotations

import math
from typing import Tuple

M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON_EQUATOR = 111320.0


class Projection:
    def __init__(self, lat0: float, lon0: float):
        self.lat0 = lat0
        self.lon0 = lon0
        self.kx = M_PER_DEG_LON_EQUATOR * math.cos(math.radians(lat0))
        self.ky = M_PER_DEG_LAT

    @classmethod
    def for_bbox(cls, bbox: Tuple[float, float, float, float]) -> "Projection":
        w, s, e, n = bbox
        return cls((s + n) / 2.0, (w + e) / 2.0)

    def to_xy(self, lat: float, lon: float) -> Tuple[float, float]:
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def to_latlon(self, x: float, y: float) -> Tuple[float, float]:
        return (self.lat0 + y / self.ky, self.lon0 + x / self.kx)

    def bbox_xy(self, bbox: Tuple[float, float, float, float]) -> Tuple[float, float, float, float]:
        """(min_x, min_y, max_x, max_y) of the bbox in meters."""
        w, s, e, n = bbox
        x0, y0 = self.to_xy(s, w)
        x1, y1 = self.to_xy(n, e)
        return (x0, y0, x1, y1)

    def as_dict(self) -> dict:
        return {"lat": self.lat0, "lon": self.lon0}
