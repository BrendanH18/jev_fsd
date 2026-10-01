// Oriented bounding boxes (separating axis theorem) and corridor queries along a route.

function axes(obb) {
  const c = Math.cos(obb.heading), s = Math.sin(obb.heading);
  return [[c, s], [-s, c]];
}

function project(obb, axis) {
  const [ax, ay] = axis;
  const centerDot = obb.center[0] * ax + obb.center[1] * ay;
  const [ux, uy] = axes(obb)[0];
  const [vx, vy] = axes(obb)[1];
  const r = Math.abs((ux * ax + uy * ay) * obb.halfLength) + Math.abs((vx * ax + vy * ay) * obb.halfWidth);
  return [centerDot - r, centerDot + r];
}

export function obbOverlap(a, b, margin = 0) {
  const quick = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]);
  if (quick > a.halfLength + b.halfLength + margin + 0.01) return false;
  const inflatedA = { ...a, halfLength: a.halfLength + margin / 2, halfWidth: a.halfWidth + margin / 2 };
  const inflatedB = { ...b, halfLength: b.halfLength + margin / 2, halfWidth: b.halfWidth + margin / 2 };
  for (const axis of [...axes(inflatedA), ...axes(inflatedB)]) {
    const [a0, a1] = project(inflatedA, axis);
    const [b0, b1] = project(inflatedB, axis);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

// Exact footprint overlap with a simple polygon, including concave buildings. Testing only
// bounding boxes or vertices misses wall crossings and fills in concave recesses.
export function obbPolygonOverlap(box, pts, margin = 0) {
  const c = Math.cos(box.heading), s = Math.sin(box.heading);
  const hl = box.halfLength + margin / 2, hw = box.halfWidth + margin / 2;
  const local = pts.map(([x, y]) => {
    const dx = x - box.center[0], dy = y - box.center[1];
    return [dx * c + dy * s, -dx * s + dy * c];
  });
  if (local.some(([x, y]) => Math.abs(x) <= hl && Math.abs(y) <= hw)) return true;
  // Clip each wall segment against the vehicle rectangle (Liang–Barsky).
  for (let i = 0; i < local.length; i++) {
    const a = local[i], b = local[(i + 1) % local.length];
    let lo = 0, hi = 1;
    for (let axis = 0; axis < 2; axis++) {
      const half = axis === 0 ? hl : hw, d = b[axis] - a[axis];
      if (Math.abs(d) < 1e-12) {
        if (Math.abs(a[axis]) > half) { hi = -1; break; }
      } else {
        const t0 = (-half - a[axis]) / d, t1 = (half - a[axis]) / d;
        lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      }
    }
    if (lo <= hi) return true;
  }
  // If no wall crosses the rectangle, the vehicle may be wholly inside the building.
  let inside = false;
  for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
    const a = local[i], b = local[j];
    if ((a[1] > 0) !== (b[1] > 0) && 0 < (b[0] - a[0]) * -a[1] / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Vehicles whose position projects onto the route between s0 and s1 with |lateral| < halfWidth.
export function corridorQuery(route, s0, s1, halfWidth, vehicles, hint = null) {
  const out = [];
  for (const v of vehicles) {
    const p = route.project(v.x, v.y, hint);
    if (!p || p.distance > halfWidth + 3) continue;
    if (p.s < s0 || p.s > s1) continue;
    if (Math.abs(p.lateral) > halfWidth) continue;
    out.push({ vehicle: v, s: p.s, lateral: p.lateral });
  }
  return out.sort((a, b) => a.s - b.s);
}
