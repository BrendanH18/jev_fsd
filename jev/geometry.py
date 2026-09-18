"""Plain 2D geometry on (x, y) tuples in meters. No numpy: the map pipeline is small enough.

Conventions: x east, y north, headings in radians counter-clockwise from +x (0 = east). A
polyline is a list of (x, y) points. "Right of travel" for a direction (dx, dy) is (dy, -dx).
"""

from __future__ import annotations

import math
from typing import List, Optional, Sequence, Tuple

Point = Tuple[float, float]
Polyline = List[Point]


def dist(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def heading_of(a: Point, b: Point) -> float:
    return math.atan2(b[1] - a[1], b[0] - a[0])


def wrap_angle(a: float) -> float:
    """Wrap to (-pi, pi]."""
    while a <= -math.pi:
        a += 2 * math.pi
    while a > math.pi:
        a -= 2 * math.pi
    return a


def turn_angle(h_in: float, h_out: float) -> float:
    """Signed change of heading, positive = left (counter-clockwise)."""
    return wrap_angle(h_out - h_in)


def classify_turn(angle: float) -> str:
    deg = math.degrees(abs(angle))
    if deg < 25:
        return "straight"
    if deg > 150:
        return "uturn"
    return "left" if angle > 0 else "right"


def polyline_length(pts: Sequence[Point]) -> float:
    return sum(dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def cumulative_s(pts: Sequence[Point]) -> List[float]:
    out = [0.0]
    for i in range(len(pts) - 1):
        out.append(out[-1] + dist(pts[i], pts[i + 1]))
    return out


def point_at(pts: Sequence[Point], s: float, cum: Optional[Sequence[float]] = None) -> Point:
    """Point at arc length s, clamped to the ends."""
    cum = cum or cumulative_s(pts)
    if s <= 0:
        return pts[0]
    if s >= cum[-1]:
        return pts[-1]
    i = _segment_index(cum, s)
    seg = cum[i + 1] - cum[i]
    t = (s - cum[i]) / seg if seg > 0 else 0.0
    a, b = pts[i], pts[i + 1]
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def heading_at(pts: Sequence[Point], s: float, cum: Optional[Sequence[float]] = None) -> float:
    cum = cum or cumulative_s(pts)
    i = _segment_index(cum, min(max(s, 0.0), cum[-1]))
    i = min(i, len(pts) - 2)
    return heading_of(pts[i], pts[i + 1])


def _segment_index(cum: Sequence[float], s: float) -> int:
    lo, hi = 0, len(cum) - 2
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if cum[mid] <= s:
            lo = mid
        else:
            hi = mid - 1
    return lo


def project_point(pts: Sequence[Point], p: Point, cum: Optional[Sequence[float]] = None) -> dict:
    """Closest point on the polyline. Returns s, signed lateral (+ = right of travel), segment index,
    the point itself, and the segment heading."""
    cum = cum or cumulative_s(pts)
    best = None
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / seg2))
        q = (a[0] + dx * t, a[1] + dy * t)
        d = dist(p, q)
        if best is None or d < best[0]:
            seg_len = math.sqrt(seg2)
            # right of travel is (dy, -dx); lateral = dot(p - q, right_unit)
            lateral = ((p[0] - q[0]) * dy - (p[1] - q[1]) * dx) / seg_len if seg_len > 0 else 0.0
            best = (d, cum[i] + t * seg_len, lateral, i, q, math.atan2(dy, dx))
    d, s, lateral, i, q, h = best
    return {"distance": d, "s": s, "lateral": lateral, "index": i, "point": q, "heading": h}


def douglas_peucker(pts: Sequence[Point], epsilon: float) -> Polyline:
    """Simplify while keeping every point that deviates more than epsilon. Endpoints always kept."""
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        worst, index = epsilon, -1
        ax, ay = pts[a]
        bx, by = pts[b]
        seg = math.hypot(bx - ax, by - ay)
        for i in range(a + 1, b):
            px, py = pts[i]
            if seg == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / seg
            if d > worst:
                worst, index = d, i
        if index != -1:
            keep[index] = True
            stack.append((a, index))
            stack.append((index, b))
    return [p for p, k in zip(pts, keep) if k]


def offset_polyline(pts: Sequence[Point], d: float) -> Polyline:
    """Parallel polyline offset by d meters to the right of travel (negative = left).
    Vertex normals are mitered and the miter length is clamped to 2|d| so hairpins do not spike."""
    n = len(pts)
    if n == 0:
        return []
    if n == 1 or d == 0:
        return list(pts)
    normals = []
    for i in range(n - 1):
        dx, dy = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
        ln = math.hypot(dx, dy)
        normals.append((dy / ln, -dx / ln) if ln > 0 else (0.0, 0.0))
    out: Polyline = []
    limit = 2.0 * abs(d)
    for i in range(n):
        if i == 0:
            nx, ny = normals[0]
            scale = 1.0
        elif i == n - 1:
            nx, ny = normals[-1]
            scale = 1.0
        else:
            n1, n2 = normals[i - 1], normals[i]
            sx, sy = n1[0] + n2[0], n1[1] + n2[1]
            ln = math.hypot(sx, sy)
            if ln < 1e-9:  # 180 degree reversal: fall back to the incoming normal
                nx, ny = n1
                scale = 1.0
            else:
                nx, ny = sx / ln, sy / ln
                cos_half = (n1[0] * nx + n1[1] * ny)
                scale = 1.0 / max(cos_half, 1e-6)
        length = min(abs(d) * scale, limit)
        sign = 1.0 if d > 0 else -1.0
        out.append((pts[i][0] + nx * length * sign, pts[i][1] + ny * length * sign))
    return out


def fillet(a: Point, corner: Point, b: Point, radius: float, steps: int = 8) -> Polyline:
    """Quadratic Bezier that rounds the corner: starts `radius` before it along (a -> corner) and ends
    `radius` after it along (corner -> b). Radius is clamped to half of each leg."""
    la, lb = dist(a, corner), dist(corner, b)
    ra = min(radius, la / 2)
    rb = min(radius, lb / 2)
    p0 = (corner[0] + (a[0] - corner[0]) * (ra / la), corner[1] + (a[1] - corner[1]) * (ra / la)) if la else corner
    p2 = (corner[0] + (b[0] - corner[0]) * (rb / lb), corner[1] + (b[1] - corner[1]) * (rb / lb)) if lb else corner
    out = []
    for k in range(steps + 1):
        t = k / steps
        u = 1 - t
        out.append((u * u * p0[0] + 2 * u * t * corner[0] + t * t * p2[0],
                    u * u * p0[1] + 2 * u * t * corner[1] + t * t * p2[1]))
    return out


def resample(pts: Sequence[Point], step: float) -> Polyline:
    """Points every `step` meters along the polyline, always including the last point."""
    if len(pts) < 2:
        return list(pts)
    cum = cumulative_s(pts)
    total = cum[-1]
    out = []
    s = 0.0
    while s < total:
        out.append(point_at(pts, s, cum))
        s += step
    out.append(pts[-1])
    return out


def polygon_area(pts: Sequence[Point]) -> float:
    """Signed shoelace area (positive = counter-clockwise)."""
    n = len(pts)
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def dedupe_consecutive(pts: Sequence[Point], eps: float = 1e-6) -> Polyline:
    out: Polyline = []
    for p in pts:
        if not out or dist(out[-1], p) > eps:
            out.append(p)
    return out


def r1(v: float) -> float:
    return round(v, 1)


def r2(v: float) -> float:
    return round(v, 2)
