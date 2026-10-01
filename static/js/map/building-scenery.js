// Pure building wall and exterior geometry shared by visual meshes and collisions.
import { sceneryHash as hash01 } from "./scenery-hash.js";
import { sidewalkOffset, streetOf } from "./streets.js";
const cache = new WeakMap();
function centroid(pts) {
  let x = 0,
    y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

export function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [],
    up = [];
  for (const p of pts) {
    while (
      lo.length >= 2 &&
      cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0
    )
      lo.pop();
    lo.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      up.length >= 2 &&
      cross(up[up.length - 2], up[up.length - 1], p) <= 0
    )
      up.pop();
    up.push(p);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}

// Minimum-area bounding rectangle: center, long axis (ux, uy), half length hl >= half width hw.
export function minRect(pts) {
  const hull = convexHull(pts);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i],
      q = hull[(i + 1) % hull.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l < 1e-6) continue;
    const ux = (q[0] - p[0]) / l,
      uy = (q[1] - p[1]) / l;
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy,
        v = -x * uy + y * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const a = (u1 - u0) * (v1 - v0);
    if (!best || a < best.area) best = { area: a, ux, uy, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { ux, uy, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2,
    cv = (v0 + v1) / 2;
  let r = {
    cx: cu * ux - cv * uy,
    cy: cu * uy + cv * ux,
    ux,
    uy,
    hl: (u1 - u0) / 2,
    hw: (v1 - v0) / 2,
    area: best.area,
  };
  if (r.hw > r.hl) r = { ...r, ux: -uy, uy: ux, hl: r.hw, hw: r.hl };
  return r;
}

export function boxPolygon(box) {
  const { cx, cy, ux, uy, hl, hw } = box;
  return [
    [-hl, -hw],
    [hl, -hw],
    [hl, hw],
    [-hl, hw],
  ].map(([a, b]) => [cx + ux * a - uy * b, cy + uy * a + ux * b]);
}
export function houseExterior(map, r, key) {
  const boxes = [];
  const add = (part, cx, cy, ux, uy, hl, hw, z0, z1) =>
    boxes.push({
      part,
      cx,
      cy,
      ux,
      uy,
      hl,
      hw,
      z0,
      z1,
      id: `${part}:${key}:${boxes.length}`,
    });
  const near =
    typeof map.nearestLane === "function"
      ? map.nearestLane(r.cx, r.cy, null, 45)
      : null;
  if (!near) return boxes;
  const e = near.lane.edgeRef,
    side = near.lateral > 0 ? 1 : -1;
  const walkBack =
    Math.abs(sidewalkOffset(e, side) - near.lane.offset) + streetOf(e)[1] / 2;
  const dx = near.point[0] - r.cx,
    dy = near.point[1] - r.cy,
    d = Math.hypot(dx, dy) || 1,
    fx = dx / d,
    fy = dy / d;
  const alongU = fx * r.ux + fy * r.uy,
    alongV = fx * -r.uy + fy * r.ux,
    useU = Math.abs(alongU) > Math.abs(alongV),
    sgn = Math.sign(useU ? alongU : alongV) || 1;
  const nx = useU ? r.ux * sgn : -r.uy * sgn,
    ny = useU ? r.uy * sgn : r.ux * sgn,
    half = useU ? r.hl : r.hw,
    across = useU ? r.hw : r.hl,
    yard = d - half - walkBack;
  if (yard < 3) return boxes;
  const wx = r.cx + nx * half,
    wy = r.cy + ny * half,
    tx = -ny,
    ty = nx;
  if (hash01(key, 44) < 0.75) {
    const depth = Math.min(2.2, yard - 1.2),
      width = Math.min(4.6, across * 1.2),
      shift = (hash01(key, 45) - 0.5) * Math.max(0, across * 2 - width) * 0.6;
    const px = wx + (nx * depth) / 2 + tx * shift,
      py = wy + (ny * depth) / 2 + ty * shift;
    add("porch", px, py, nx, ny, depth / 2, width / 2, 0, 0.62);
    for (let k = 0; k < 3; k++) {
      const sd = depth / 2 + 0.16 + k * 0.3;
      add(
        "porch_step",
        px + nx * sd,
        py + ny * sd,
        nx,
        ny,
        0.16,
        0.7,
        0,
        0.62 - (k + 1) * 0.18,
      );
    }
    for (const s of [-1, 1])
      add(
        "porch_post",
        px + nx * (depth / 2 - 0.12) + tx * s * (width / 2 - 0.12),
        py + ny * (depth / 2 - 0.12) + ty * s * (width / 2 - 0.12),
        nx,
        ny,
        0.08,
        0.08,
        0.62,
        2.85,
      );
    add(
      "porch_roof",
      px + nx * 0.15,
      py + ny * 0.15,
      nx,
      ny,
      depth / 2 + 0.3,
      width / 2 + 0.25,
      2.85,
      3,
    );
    add(
      "door",
      wx + nx * 0.03 + tx * shift,
      wy + ny * 0.03 + ty * shift,
      nx,
      ny,
      0.03,
      0.5,
      0.62,
      2.7,
    );
  }
  if (hash01(key, 47) < 0.35 && yard > 4)
    add(
      "hedge",
      r.cx + nx * (d - walkBack - 0.9),
      r.cy + ny * (d - walkBack - 0.9),
      tx,
      ty,
      across + 1.2,
      0.45,
      0,
      1 + hash01(key, 49) * 0.5,
    );
  return boxes;
}
export function buildingShapes(map) {
  if (cache.has(map)) return cache.get(map);
  const out = [];
  cache.set(map, out);
  for (const [i, bld] of (map.pack?.buildings || []).entries()) {
    if (
      !Array.isArray(bld.pts) ||
      bld.pts.length < 3 ||
      bld.pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
    )
      continue;
    let pts = bld.pts;
    if (Math.abs(area(pts)) < 1) continue;
    if (area(pts) < 0) pts = [...pts].reverse();
    const [cx, cy] = centroid(pts);
    pts = pts.map(([x, y]) => {
      const dx = x - cx,
        dy = y - cy,
        k = Math.max(0.5, 1 - 0.06 / (Math.hypot(dx, dy) || 1));
      return [cx + dx * k, cy + dy * k];
    });
    const h = bld.h + (i % 7) * 0.04,
      a = Math.abs(area(pts)),
      kind = h > 13 || a > 450 ? "block" : "house",
      r = kind === "house" ? minRect(pts) : null;
    const pitched = !!(
      r &&
      a / r.area > 0.7 &&
      r.hw <= 8.5 &&
      r.hw >= 1.5 &&
      hash01(i, 3) < 0.92
    );
    out.push({
      pts,
      i,
      h,
      a,
      kind,
      r,
      pitched,
      cx,
      cy,
      boxes: pitched ? houseExterior(map, r, i) : [],
    });
  }
  return out;
}
