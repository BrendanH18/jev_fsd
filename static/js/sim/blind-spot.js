// The blind spot beside cars parked at the kerb, and the speed to keep to beside it (sim/hidden-hazards.js
// explains both). Kept apart from the step-outs so that coaching (sim/drive-score.js) can use it without
// the DOM.

import { CAR, comfort } from "./vehicle.js";

export const STEP_OUT_M = 15;
export const BLIND_REACT_S = 0.6;
export const BLIND_BRAKE = 0.75;
export const BLIND_MARGIN_M = 2;
export const BLIND_GAP_M = 2;
export const BLIND_LOOK_M = 60;
export const BLIND_APPROACH = 0.6;   // slowing for a blind spot ahead at this share of the comfortable deceleration
export const QUIET = new Set(["residential", "unclassified", "living_street"]);
const PARALLEL = Math.PI / 6;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The blind-spot speed (m/s) on the road as it is now (sim/hidden-hazards.js).
export function blindSpeed() {
  const a = BLIND_BRAKE * comfort().hardDecel, room = STEP_OUT_M - BLIND_MARGIN_M, t = BLIND_REACT_S;
  return a * (Math.sqrt(t * t + 2 * room / a) - t);
}

// The speed to be at with the front `from` metres short of the first vehicle that makes a blind spot:
// `limit` from BLIND_LEAD_M before STEP_OUT_M short of it (the car takes a moment to settle), and short
// of that, the speed from which the car slows to `limit` gently by then.
export const BLIND_LEAD_M = 5;
export function blindApproach(limit, from) {
  const room = from - STEP_OUT_M - BLIND_LEAD_M;
  return room <= 0 ? limit : Math.sqrt(limit * limit + 2 * comfort().decel * BLIND_APPROACH * room);
}

// Standing vehicles at the kerb that may hide someone from an observer looking at `ped`: those near the
// line between them.
export function standingNear(world, observer, ped) {
  const mx = (observer.x + ped.x) / 2, my = (observer.y + ped.y) / 2;
  return world.parked.near(mx, my, Math.hypot(ped.x - observer.x, ped.y - observer.y) / 2 + 5);
}

// The blind spot ahead of `observer` (the driven car), or null (sim/hidden-hazards.js): which side it is
// on, how far its front is short of the first standing vehicle that makes it (`from_m`, negative once
// beside it) and past the last within BLIND_LOOK_M (`to_m`), the narrowest gap between them and the car's
// side, how many there are, the first of them and the street edge it is parked along, why it counts
// (`why`: "quiet street", or the kind of zone), and the blind-spot speed, never above the road's limit
// (`limit_mps`). Only vehicles the car can see count.
export function blindSpot(world, observer = world.ego, road = world._road) {
  if (!world.hazards) return null;
  const spec = observer.spec || CAR, FRONT = spec.length - spec.rearOverhang;
  const zone = road?.zone || null;
  const sides = {};
  for (const c of world.parked.near(observer.x, observer.y, BLIND_LOOK_M + FRONT + 8)) {
    const d = Math.abs(wrap(c.psi - observer.psi));
    if (d > PARALLEL && d < Math.PI - PARALLEL) continue;
    const cs = c.spec || CAR, [cx, cy] = c.center, local = observer.toLocal(cx, cy);
    const near = local.ahead - cs.length / 2 - FRONT, far = local.ahead + cs.length / 2 - FRONT;
    if (far < 0 || near > BLIND_LOOK_M) continue;
    const gap = Math.abs(local.right) - cs.width / 2 - spec.width / 2;
    if (gap < 0 || gap > BLIND_GAP_M) continue;
    const e = world.map.edges.get(c.edge) || road?.edge;
    if (!zone && !QUIET.has(e?.cls)) continue;
    if (!world.visibility.sees(observer, c)) continue;
    const side = local.right > 0 ? "right" : "left";
    const s = sides[side] ||= { side, from_m: Infinity, to_m: -Infinity, gap_m: Infinity, cars: 0, first: null, edge: null };
    if (near < s.from_m) { s.from_m = near; s.first = c.id; s.edge = c.edge ?? null; }
    s.to_m = Math.max(s.to_m, far);
    s.gap_m = Math.min(s.gap_m, gap);
    s.cars++;
  }
  const best = Object.values(sides).sort((a, b) => a.from_m - b.from_m)[0];
  if (!best) return null;
  return { ...best, why: zone ? `${zone.kind} zone` : "quiet street", limit_mps: Math.min(road?.limit ?? Infinity, blindSpeed()) };
}
