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
