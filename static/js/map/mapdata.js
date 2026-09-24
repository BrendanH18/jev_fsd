// The map pack as the browser uses it: edges, lanes, a spatial grid for nearest-lane queries,
// adjacency, and traffic-control lookups. Coordinates: x east, y north, meters. Headings are
// radians counter-clockwise from +x.

const CELL = 50;

export function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
export function wrapAngle(a) {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}
export function headingOf(a, b) { return Math.atan2(b[1] - a[1], b[0] - a[0]); }

export function cumulative(pts) {
  const out = [0];
  for (let i = 0; i < pts.length - 1; i++) out.push(out[i] + dist(pts[i], pts[i + 1]));
  return out;
}

function segIndex(cum, s) {
  let lo = 0, hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function pointAt(pts, cum, s) {
  if (s <= 0) return pts[0];
  if (s >= cum[cum.length - 1]) return pts[pts.length - 1];
  const i = segIndex(cum, s);
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (s - cum[i]) / seg : 0;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
}

export function headingAt(pts, cum, s) {
  const i = Math.min(segIndex(cum, Math.max(0, Math.min(s, cum[cum.length - 1]))), pts.length - 2);
  return headingOf(pts[i], pts[i + 1]);
}

// Closest point on a polyline. lateral > 0 means right of travel.
export function projectPoint(pts, cum, p, hint = null) {
  let best = null;
  const lo = hint === null ? 0 : Math.max(0, hint - 5);
  const hi = hint === null ? pts.length - 1 : Math.min(pts.length - 1, hint + 25);
  for (let pass = 0; pass < 2; pass++) {
    const a0 = pass === 0 ? lo : 0, a1 = pass === 0 ? hi : pts.length - 1;
    for (let i = a0; i < a1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const seg2 = dx * dx + dy * dy;
      const t = seg2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / seg2));
      const qx = a[0] + dx * t, qy = a[1] + dy * t;
      const d = Math.hypot(p[0] - qx, p[1] - qy);
      if (best === null || d < best.distance) {
        const segLen = Math.sqrt(seg2);
        const lateral = segLen > 0 ? ((p[0] - qx) * dy - (p[1] - qy) * dx) / segLen : 0;
        best = { distance: d, s: cum[i] + t * segLen, lateral, index: i, point: [qx, qy], heading: Math.atan2(dy, dx) };
      }
    }
    if (hint === null || (best && best.distance < 6)) break;
  }
  return best;
}

// Join two lane polylines where one street meets the next (mirrors jev/routing.py). Lanes sit
// right of each street's centerline, so at a turn the incoming lane runs past the real corner and
// the outgoing one starts before it; chaining them end to start makes a path that backs up or
// swings across the road. Turns (>= 20 deg): round the corner where the two lane lines meet.
// Near-straight joins whose ends do not meet: spread the shift over a few meters.
export function joinLanes(before, after, { radius = 6, blend = 4 } = {}) {
  if (!before.length) return after.slice();
  if (after.length < 2 || before.length < 2 || cumulative(after).at(-1) < 3) return before.concat(after.slice(dist(before[before.length - 1], after[0]) < 0.05 ? 1 : 0));
  const cb = cumulative(before), ca = cumulative(after);
  const Lb = cb[cb.length - 1], La = ca[ca.length - 1];
  const e = before[before.length - 1], s0 = after[0];
  const unit = (a, b) => { const d = dist(a, b); return d < 1e-6 ? null : [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
  const din = unit(pointAt(before, cb, Math.max(0, Lb - 3)), e), dout = unit(s0, pointAt(after, ca, Math.min(La, 3)));
  const angle = din && dout ? Math.abs(wrapAngle(Math.atan2(dout[1], dout[0]) - Math.atan2(din[1], din[0]))) : 0;
  if (angle >= 20 * Math.PI / 180) {
    const denom = din[0] * dout[1] - din[1] * dout[0];
    const w = [s0[0] - e[0], s0[1] - e[1]];
    const t = (w[0] * dout[1] - w[1] * dout[0]) / denom, u = (w[0] * din[1] - w[1] * din[0]) / denom;
    if (Math.abs(denom) >= 0.15 && Math.abs(t) <= 15 && Math.abs(u) <= 15) {
      const corner = [e[0] + din[0] * t, e[1] + din[1] * t];
      const sb = Lb + t, sa = u;
      const r = Math.min(radius, Math.max(0.5, sb / 2), Math.max(0.5, (La - sa) / 2));
      const keep = Math.max(0, sb - r), skip = Math.max(0, sa + r);
      const head = before.filter((_, i) => cb[i] < keep - 0.05);
      head.push(keep <= Lb ? pointAt(before, cb, keep) : [e[0] + din[0] * (keep - Lb), e[1] + din[1] * (keep - Lb)]);
      const p0 = head[head.length - 1];
      const p2 = skip <= La ? pointAt(after, ca, skip) : [corner[0] + dout[0] * r, corner[1] + dout[1] * r];
      for (let k = 1; k <= 8; k++) {
        const q = k / 8, m = 1 - q;
        head.push([m * m * p0[0] + 2 * m * q * corner[0] + q * q * p2[0], m * m * p0[1] + 2 * m * q * corner[1] + q * q * p2[1]]);
      }
      return head.concat(after.filter((_, i) => ca[i] > skip + 0.05));
    }
  }
  if (dist(e, s0) <= 0.05) return before.concat(after.slice(1));
  const keep = Math.max(0, Lb - Math.min(blend, Lb / 2)), skip = Math.min(blend, La / 2);
  return before.filter((_, i) => cb[i] < keep - 0.05).concat([pointAt(before, cb, keep), pointAt(after, ca, skip)], after.filter((_, i) => ca[i] > skip + 0.05));
}

export class MapData {
  constructor(pack) {
    this.pack = pack;
    this.bbox = pack.bbox;
    this.extent = pack.extent;
    this.edges = new Map(pack.edges.map((e) => [e.id, { ...e, cum: cumulative(e.pts) }]));
    this.lanes = new Map();
    this.out = new Map();
    this.inn = new Map();
    for (const e of pack.edges) {
      if (!this.out.has(e.from)) this.out.set(e.from, []);
      if (!this.inn.has(e.to)) this.inn.set(e.to, []);
      this.out.get(e.from).push(e.id);
      this.inn.get(e.to).push(e.id);
    }
    this.laneList = [];
    for (const l of pack.lanes) {
      const lane = { ...l, cum: cumulative(l.pts), edgeRef: this.edges.get(l.edge) };
      lane.length = lane.cum[lane.cum.length - 1];
      lane.offset = lane.edgeRef.lane_offsets[l.idx];
      this.lanes.set(`${l.edge}:${l.idx}`, lane);
      this.laneList.push(lane);
    }
    this.intersections = new Map(pack.intersections.map((i) => [i.id, i]));
    this.stops = new Map(pack.stops.map((s) => [s.id, s]));
    this.grid = new Map();
    for (const lane of this.laneList) {
      for (const key of cellsOf(lane.pts)) {
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(lane);
      }
    }
    this.nodes = new Map(pack.nodes.map((n) => [n.id, n]));
  }

  lane(edgeId, idx) { return this.lanes.get(`${edgeId}:${idx}`); }
  successors(edgeId) { return this.out.get(this.edges.get(edgeId).to) || []; }
  headingIn(edgeId) { const p = this.edges.get(edgeId).pts; return headingOf(p[p.length - 2], p[p.length - 1]); }
  headingOut(edgeId) { const p = this.edges.get(edgeId).pts; return headingOf(p[0], p[1]); }
  turnAngle(a, b) { return wrapAngle(this.headingOut(b) - this.headingIn(a)); }
  classifyTurn(angle) {
    const deg = Math.abs(angle) * 180 / Math.PI;
    if (deg < 25) return "straight";
    if (deg > 150) return "uturn";
    return angle > 0 ? "left" : "right";
  }

  lanesNear(x, y, radius = 60) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), r = Math.ceil(radius / CELL);
    const seen = new Set();
    const out = [];
    for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
      const cell = this.grid.get(`${i},${j}`);
      if (!cell) continue;
      for (const lane of cell) if (!seen.has(lane)) { seen.add(lane); out.push(lane); }
    }
    return out;
  }

  // Nearest lane point. With a heading, lanes pointing the other way are skipped first.
  nearestLane(x, y, heading = null, radius = 60, tolerance = Math.PI / 3) {
    const lanes = this.lanesNear(x, y, radius);
    let best = null;
    for (let pass = 0; pass < 2; pass++) {
      for (const lane of lanes) {
        const proj = projectPoint(lane.pts, lane.cum, [x, y]);
        if (!proj || proj.distance > radius) continue;
        if (heading !== null && pass === 0 && Math.abs(wrapAngle(proj.heading - heading)) > tolerance) continue;
        if (best === null || proj.distance < best.distance) best = { ...proj, lane };
      }
      if (best || heading === null) break;
    }
    return best;
  }

  // Meters outside the asphalt (0 when on the road) plus the edge it measured against.
  roadDistance(x, y) {
    const near = this.nearestLane(x, y, null, 40);
    if (!near) return { distance: Infinity, edge: null, lateral: 0 };
    const edge = near.lane.edgeRef;
    const lateralFromCenter = near.lateral + near.lane.offset;
    const [lo, hi] = edge.asphalt;
    let d = 0;
    if (lateralFromCenter < lo) d = lo - lateralFromCenter;
    else if (lateralFromCenter > hi) d = lateralFromCenter - hi;
    // beyond the ends of the edge polyline
    const overshoot = Math.max(0, near.distance - Math.abs(near.lateral));
    return { distance: Math.max(d, overshoot > 0.5 ? overshoot : 0), edge, lateral: lateralFromCenter, lane: near.lane, s: near.s };
  }

  controlOf(edgeId) { return this.edges.get(edgeId).control || null; }
}

function cellsOf(pts) {
  const cells = new Set();
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(dist(pts[i], pts[i + 1]) / (CELL / 2)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      cells.add(`${Math.floor((x0 + (x1 - x0) * t) / CELL)},${Math.floor((y0 + (y1 - y0) * t) / CELL)}`);
    }
  }
  return cells;
}
