// Solid scenery geometry: mapped buildings, rendered trunks and posts, porch decks/steps and
// hedges. Rendering and collision placement share pure manifests. The spatial grid bounds both
// physics and planning queries without adding stationary scenery to moving-object perception.
import { obbPolygonOverlap } from "./collision.js";
import { sceneryFor } from "../map/scenery.js";

const CELL = 25;
const SWEEP_STEP_M = 0.2;
export const poseOf = (car) => ({ x: car.x, y: car.y, psi: car.psi });

function angleDelta(a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }
function atPose(from, to, t) {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t,
    psi: from.psi + angleDelta(from.psi, to.psi) * t };
}
function boxAt(pose, spec) {
  const offset = spec.length / 2 - spec.rearOverhang;
  return { center: [pose.x + Math.cos(pose.psi) * offset, pose.y + Math.sin(pose.psi) * offset],
    heading: pose.psi, halfLength: spec.length / 2, halfWidth: spec.width / 2 };
}

function circleSeparation(box, circle, margin = 0) {
  const c = Math.cos(box.heading), s = Math.sin(box.heading);
  const dx = circle.x - box.center[0], dy = circle.y - box.center[1];
  const x = dx * c + dy * s, y = -dx * s + dy * c;
  const qx = Math.max(0, Math.abs(x) - box.halfLength - margin / 2);
  const qy = Math.max(0, Math.abs(y) - box.halfWidth - margin / 2);
  return Math.hypot(qx, qy) - circle.radius;
}
export const obbCircleOverlap = (box, circle, margin = 0) => circleSeparation(box, circle, margin) <= 0;
const overlaps = (box, o, margin) => o.radius !== undefined ? obbCircleOverlap(box, o, margin) : obbPolygonOverlap(box, o.pts, margin);

// Exact translating rectangle vs trunk/post sweep: a point moving through a rounded
// rectangle, decomposed into two rectangles and four corner circles. Thin corner grazes
// cannot disappear between the ordinary samples when the heading is unchanged.
function translatingCircleHit(from, to, spec, circle, margin) {
  const box = boxAt(from, spec), end = boxAt(to, spec);
  const c = Math.cos(from.psi), s = Math.sin(from.psi);
  const local = (center) => {
    const dx = circle.x - center[0], dy = circle.y - center[1];
    return [dx * c + dy * s, -dx * s + dy * c];
  };
  const a = local(box.center), b = local(end.center), d = [b[0] - a[0], b[1] - a[1]];
  const hl = box.halfLength + margin / 2, hw = box.halfWidth + margin / 2, r = circle.radius;
  let first = Infinity;
  for (const [hx, hy] of [[hl + r, hw], [hl, hw + r]]) {
    let lo = 0, hi = 1;
    for (let axis = 0; axis < 2; axis++) {
      const h = axis === 0 ? hx : hy;
      if (Math.abs(d[axis]) < 1e-12) { if (Math.abs(a[axis]) > h) hi = -1; }
      else {
        const t0 = (-h - a[axis]) / d[axis], t1 = (h - a[axis]) / d[axis];
        lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      }
    }
    if (lo <= hi) first = Math.min(first, lo);
  }
  const A = d[0] * d[0] + d[1] * d[1];
  if (A > 1e-20) for (const x of [-hl, hl]) for (const y of [-hw, hw]) {
    const qx = a[0] - x, qy = a[1] - y;
    const B = 2 * (qx * d[0] + qy * d[1]), C = qx * qx + qy * qy - r * r;
    const disc = B * B - 4 * A * C;
    if (disc < 0) continue;
    const t = (-B - Math.sqrt(disc)) / (2 * A);
    if (t >= 0 && t <= 1) first = Math.min(first, t);
  }
  return first <= 1 ? first : null;
}

function rotatingCircleHit(from, to, spec, circle, margin, travelBound) {
  if (travelBound < 1e-12) return null;
  let fraction = 0;
  for (let i = 0; i < 4096; i++) {
    const clearance = circleSeparation(boxAt(atPose(from, to, fraction), spec), circle, margin);
    if (clearance <= 0) return fraction;
    if (clearance <= 1e-6) {
      // The resolved pose can be nanometres from a post after repeated throttle. A
      // proximity tolerance must not pin the car there while it reverses away. Keep
      // conservative advancement for separating motion; still stop for an approach.
      const probe = Math.min(1, fraction + Math.max(1e-5, clearance / travelBound));
      const nextClearance = circleSeparation(boxAt(atPose(from, to, probe), spec), circle, margin);
      if (nextClearance <= clearance) return fraction;
    }
    // A corner cannot close this distance faster than the translation + rotation bound.
    // Advancing less than that lower bound never steps across even a very brief contact.
    fraction += clearance / travelBound * 0.9;
    if (fraction > 1) return null;
  }
  // An exceptionally close, near-tangent path may converge slowly. Keep the vehicle on
  // the safe side of that unresolved contact rather than advance through a slender pole.
  return fraction;
}

export class StaticObstacles {
  constructor(map) {
    this.grid = new Map();
    this.list = [];
    for (const [i, building] of (map.pack?.buildings || []).entries()) {
      const pts = building.pts;
      if (!Array.isArray(pts) || pts.length < 3 || pts.some((p) => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
      const area = pts.reduce((sum, p, j) => {
        const q = pts[(j + 1) % pts.length]; return sum + p[0] * q[1] - q[0] * p[1];
      }, 0);
      if (Math.abs(area) < 1e-6) continue;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const obstacle = { id: `building:${building.id ?? i}`, kind: "building", pts, bounds };
      this.list.push(obstacle);
      this.forCells(bounds, (key) => {
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(obstacle);
      });
    }
    for (const circle of sceneryFor(map).circles) {
      const r = circle.radius;
      const obstacle = { ...circle, bounds: [circle.x - r, circle.y - r, circle.x + r, circle.y + r] };
      this.list.push(obstacle);
      this.forCells(obstacle.bounds, (key) => {
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(obstacle);
      });
    }
    for (const polygon of sceneryFor(map).polygons) {
      const xs = polygon.pts.map((p) => p[0]), ys = polygon.pts.map((p) => p[1]);
      const obstacle = { ...polygon, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
      this.list.push(obstacle);
      this.forCells(obstacle.bounds, (key) => {
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(obstacle);
      });
    }
  }

  forCells(bounds, visit) {
    for (let x = Math.floor(bounds[0] / CELL); x <= Math.floor(bounds[2] / CELL); x++) {
      for (let y = Math.floor(bounds[1] / CELL); y <= Math.floor(bounds[3] / CELL); y++) visit(`${x},${y}`);
    }
  }

  query(bounds) {
    const seen = new Set(), out = [];
    this.forCells(bounds, (key) => {
      for (const obstacle of this.grid.get(key) || []) {
        if (seen.has(obstacle)) continue;
        seen.add(obstacle);
        const b = obstacle.bounds;
        if (b[0] <= bounds[2] && b[2] >= bounds[0] && b[1] <= bounds[3] && b[3] >= bounds[1]) out.push(obstacle);
      }
    });
    return out;
  }

  overlaps(box, margin = 0) {
    const r = Math.hypot(box.halfLength + margin / 2, box.halfWidth + margin / 2);
    return this.query([box.center[0] - r, box.center[1] - r, box.center[0] + r, box.center[1] + r])
      .filter((o) => overlaps(box, o, margin));
  }

  // Polygon sweeps sample <=20 cm of corner travel and refine the first hit. Trunk/post circle
  // sweeps use analytic translating intersections or conservative clearance advancement when
  // rotating, so thin contacts are not lost between samples. Response is geometric blocking;
  // this is not an impulse/damage solver or an analytic continuous polygon collision detector.
  sweep(from, to, spec, margin = 0) {
    if (!this.list.length) return null;
    const radius = Math.hypot(Math.max(spec.rearOverhang, spec.length - spec.rearOverhang) + margin / 2, spec.width / 2 + margin / 2);
    const obstacles = this.query([Math.min(from.x, to.x) - radius, Math.min(from.y, to.y) - radius,
      Math.max(from.x, to.x) + radius, Math.max(from.y, to.y) + radius]);
    if (!obstacles.length) return null;
    const touching = (pose) => {
      const box = boxAt(pose, spec);
      return obstacles.find((o) => overlaps(box, o, margin));
    };
    const initial = touching(from);
    if (initial) return { obstacle: initial, fraction: 0, safePose: from };
    const travel = Math.hypot(to.x - from.x, to.y - from.y) + radius * Math.abs(angleDelta(from.psi, to.psi));
    let exact = null;
    for (const obstacle of obstacles) {
      if (obstacle.radius === undefined) continue;
      const fraction = Math.abs(angleDelta(from.psi, to.psi)) < 1e-10
        ? translatingCircleHit(from, to, spec, obstacle, margin)
        : rotatingCircleHit(from, to, spec, obstacle, margin, travel);
      if (fraction !== null && (!exact || fraction < exact.fraction)) exact = { obstacle, fraction };
    }
    const count = Math.max(1, Math.ceil(travel / SWEEP_STEP_M));
    for (let i = 1; i <= count; i++) {
      const fraction = Math.min(i / count, exact?.fraction ?? 1);
      const obstacle = touching(atPose(from, to, fraction));
      if (!obstacle) { if (exact && fraction === exact.fraction) break; else continue; }
      let lo = (i - 1) / count, hi = fraction;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (touching(atPose(from, to, mid))) hi = mid; else lo = mid;
      }
      return { obstacle: touching(atPose(from, to, hi)) || obstacle,
        fraction: hi, safePose: atPose(from, to, Math.max(0, lo - 1e-6)) };
    }
    if (exact) return { ...exact, safePose: atPose(from, to, Math.max(0, exact.fraction - 1e-6)) };
    return null;
  }
}
