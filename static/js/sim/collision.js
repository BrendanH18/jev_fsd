// Oriented bounding boxes (separating axis theorem) and corridor queries along a route.

function projectedRadius(x, y, c, s, length, width) {
  return Math.abs((c * x + s * y) * length) + Math.abs((-s * x + c * y) * width);
}

export function obbOverlap(a, b, margin = 0) {
  const quick = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]);
  if (quick > a.halfLength + b.halfLength + margin + 0.01) return false;
  const ah = a.heading,
    bh = b.heading;
  if (!Number.isFinite(quick) || !Number.isFinite(ah) || !Number.isFinite(bh))
    throw new RangeError("Invalid collision box pose");
  const al = a.halfLength + margin / 2,
    aw = a.halfWidth + margin / 2,
    bl = b.halfLength + margin / 2,
    bw = b.halfWidth + margin / 2;
  const ac = Math.cos(ah),
    as = Math.sin(ah),
    bc = Math.cos(bh),
    bs = Math.sin(bh);
  for (let i = 0; i < 4; i++) {
    const x = i === 0 ? ac : i === 1 ? -as : i === 2 ? bc : -bs;
    const y = i === 0 ? as : i === 1 ? ac : i === 2 ? bs : bc;
    const ca = a.center[0] * x + a.center[1] * y;
    const cb = b.center[0] * x + b.center[1] * y;
    const ar = projectedRadius(x, y, ac, as, al, aw);
    const br = projectedRadius(x, y, bc, bs, bl, bw);
    if (ca + ar < cb - br || cb + br < ca - ar) return false;
  }
  return true;
}

export function polygonBounds(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of points) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  return [minX, minY, maxX, maxY];
}

// Distance from point p to box b (0 inside).
export function pointBoxDist(p, b) {
  const c = Math.cos(b.heading),
    s = Math.sin(b.heading),
    dx = p[0] - b.center[0],
    dy = p[1] - b.center[1];
  const lx = Math.abs(dx * c + dy * s) - b.halfLength,
    ly = Math.abs(-dx * s + dy * c) - b.halfWidth;
  return Math.hypot(Math.max(0, lx), Math.max(0, ly));
}
export const boxCorners = (b) => {
  const c = Math.cos(b.heading),
    s = Math.sin(b.heading);
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([u, v]) => [
    b.center[0] + u * b.halfLength * c - v * b.halfWidth * s,
    b.center[1] + u * b.halfLength * s + v * b.halfWidth * c,
  ]);
};
// The gap between two boxes' bodies (0 when they touch or overlap).
export function boxGap(a, b) {
  if (obbOverlap(a, b)) return 0;
  return Math.min(...boxCorners(a).map((p) => pointBoxDist(p, b)), ...boxCorners(b).map((p) => pointBoxDist(p, a)));
}

// Exact footprint overlap with a simple polygon, including concave buildings. Testing only
// bounding boxes or vertices misses wall crossings and fills in concave recesses.
export function obbPolygonOverlap(box, pts, margin = 0) {
  const c = Math.cos(box.heading),
    s = Math.sin(box.heading);
  const hl = box.halfLength + margin / 2,
    hw = box.halfWidth + margin / 2;
  const local = pts.map(([x, y]) => {
    const dx = x - box.center[0],
      dy = y - box.center[1];
    return [dx * c + dy * s, -dx * s + dy * c];
  });
  if (local.some(([x, y]) => Math.abs(x) <= hl && Math.abs(y) <= hw)) return true;
  // Clip each wall segment against the vehicle rectangle (Liang–Barsky).
  for (let i = 0; i < local.length; i++) {
    const a = local[i],
      b = local[(i + 1) % local.length];
    let lo = 0,
      hi = 1;
    for (let axis = 0; axis < 2; axis++) {
      const half = axis === 0 ? hl : hw,
        d = b[axis] - a[axis];
      if (Math.abs(d) < 1e-12) {
        if (Math.abs(a[axis]) > half) {
          hi = -1;
          break;
        }
      } else {
        const t0 = (-half - a[axis]) / d,
          t1 = (half - a[axis]) / d;
        lo = Math.max(lo, Math.min(t0, t1));
        hi = Math.min(hi, Math.max(t0, t1));
      }
    }
    if (lo <= hi) return true;
  }
  // If no wall crosses the rectangle, the vehicle may be wholly inside the building.
  let inside = false;
  for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
    const a = local[i],
      b = local[j];
    if (a[1] > 0 !== b[1] > 0 && 0 < ((b[0] - a[0]) * -a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Vehicles whose position projects onto the route between s0 and s1 within halfWidth of `center`
// (metres right of the route, so a corridor can follow another lane).
export function corridorQuery(route, s0, s1, halfWidth, vehicles, hint = null, center = 0, frame = null) {
  const out = [];
  const projectionHint = hint ?? route.hint ?? 0;
  for (const v of vehicles) {
    const p = route.project(v.x, v.y, projectionHint);
    if (!p || p.s < s0 || p.s > s1) continue;
    // `frame(s)` re-measures a lateral from where the route was at the query's start, when the
    // route has moved to another lane in between
    const lateral = frame ? p.lateral + frame(p.s) : p.lateral;
    if (
      p.distance > halfWidth + Math.abs(center) + Math.abs(lateral - p.lateral) + 3 ||
      Math.abs(lateral - center) > halfWidth
    )
      continue;
    out.push({ vehicle: v, s: p.s, lateral });
  }
  return out.sort((a, b) => a.s - b.s);
}
