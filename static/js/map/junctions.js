// The paved fill of each junction: the hull of the cross-section of every street leaving it a little
// way out from the node (beyond the widest street's half width). The renderer draws it (render/roads.js),
// and the driving checks count it as road (`surfaceDistance`): where a wide street starts at a node, the
// corner between it and a narrower one is paved there but lies outside both streets' strips, and a turn
// through it is no off-road excursion. No browser dependency.
import { pointAt, headingAt } from "./mapdata.js";
import { analyzeStreets, surfaceHalf } from "./scenery.js";

const CELL = 50;
const cache = new WeakMap();

// Leg of a street leaving a node: a point `d` metres out and the heading away from the node.
function legFrame(e, out, d) {
  const L = e.cum[e.cum.length - 1];
  const s = out ? Math.min(d, L * 0.5) : Math.max(L - d, L * 0.5);
  const p = pointAt(e.pts, e.cum, s);
  let h = headingAt(e.pts, e.cum, s);
  if (!out) h += Math.PI;
  return { p, h };
}

export function hull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// [{ node, poly }] for every junction that has a fill: two or more legs, not a roundabout's (its disc is
// drawn instead), and not a straight run through a two-leg node (the ribbons already meet there).
export function junctionFills(map) {
  let entry = cache.get(map);
  if (entry) return entry.list;
  const { legs, nodeR } = analyzeStreets(map);
  const ringNodes = new Set();
  for (const rb of (map.roundabouts || new Map()).values()) for (const v of rb.vertices) ringNodes.add(v);
  const list = [], grid = new Map();
  for (const [id, legList] of legs) {
    const node = map.nodes.get(id);
    if (!node || legList.length < 2 || ringNodes.has(id)) continue;
    if (legList.length === 2) {
      const [a, b] = legList.map((l) => legFrame(l.st.edge, l.out, 1).h);
      const bend = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
      if (bend > Math.PI - 0.12) continue;  // straight through: ribbons already meet
    }
    const r = nodeR.get(id);
    const pts = [[node.x, node.y]];
    for (const l of legList) {
      const half = surfaceHalf(l.st.edge);
      const { p, h } = legFrame(l.st.edge, l.out, r + 0.5);
      const nx = Math.sin(h), ny = -Math.cos(h);
      pts.push([p[0] + nx * half, p[1] + ny * half], [p[0] - nx * half, p[1] - ny * half]);
    }
    const fill = { node: id, poly: hull(pts) };
    list.push(fill);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of fill.poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
      const key = `${gx},${gy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(fill);
    }
  }
  cache.set(map, { list, grid });
  return list;
}

// Whether (x, y) lies on a junction's fill.
export function onJunctionFill(map, x, y) {
  junctionFills(map);
  const cell = cache.get(map).grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`);
  if (!cell) return false;
  for (const { poly } of cell) {
    let inside = poly.length >= 3;
    // (the hull runs counter-clockwise: inside is left of every side)
    for (let i = 0; i < poly.length && inside; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) inside = false;
    }
    if (inside) return true;
  }
  return false;
}

// The map's roadDistance, with a junction's fill counted as road: for the driving checks (the
// candidates' forward simulations and the off-road audit). Scenery keeps to roadDistance.
export function surfaceDistance(map, x, y) {
  const rd = map.roadDistance(x, y);
  return rd.distance > 0 && onJunctionFill(map, x, y) ? { ...rd, distance: 0 } : rd;
}
