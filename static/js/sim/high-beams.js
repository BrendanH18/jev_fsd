// Beam policy and audit share geometry, independent of the chosen driving policy.
import { sceneryFor } from '../map/scenery.js';
export const ONCOMING_DIP_M = 150, FOLLOW_DIP_M = 60, GLARE_THRESHOLD_S = 0.8;
export function wellLit(world, car = world.ego) {
  if (world.streetLightsOut) return false;
  return sceneryFor(world.map).lamps.some(l => Math.hypot(l.lx - car.x, l.ly - car.y) < 24);
}
export function beamRelation(car, other) {
  const dx = other.x - car.x, dy = other.y - car.y;
  const ahead = dx * Math.cos(car.psi) + dy * Math.sin(car.psi);
  const side = Math.abs(dx * Math.sin(car.psi) - dy * Math.cos(car.psi));
  const alignment = Math.cos(other.psi - car.psi);
  if (ahead <= 0 || side > 12 || side > ahead * 0.35 + 3) return null;
  const kind = alignment < -0.5 ? 'oncoming' : alignment > 0.5 ? 'leading' : null;
  if (!kind) return null;
  // Vehicle positions are rear axles. Dip distances are between the facing bumpers,
  // not between axles (which would permit several extra metres of glare).
  const front = car.spec.length - car.spec.rearOverhang;
  const end = kind === 'oncoming' ? other.spec.length - other.spec.rearOverhang : -other.spec.rearOverhang;
  const distance = Math.hypot(dx + Math.cos(other.psi) * end - Math.cos(car.psi) * front,
    dy + Math.sin(other.psi) * end - Math.sin(car.psi) * front);
  return { kind, distance };
}
export function headlights(world, car = world.ego, others = world.npcs, margin = 0) {
  let oncoming = Infinity, leading = Infinity;
  // Vehicle lamps remain visible beyond the unlit-object range. Buildings still block them.
  for (const n of others) {
    if (n === car || n.kind === 'pedestrian') continue;
    const r = beamRelation(car, n);
    if (!r || r.distance > 220 || world.visibility.occluded([car.x, car.y], [n.x, n.y])) continue;
    if (r.kind === 'oncoming') oncoming = Math.min(oncoming, r.distance);
    else leading = Math.min(leading, r.distance);
  }
  const dark = world.visibility.night > 0.5, lit = dark && wellLit(world, car);
  const badWeather = world.weather === 'fog' || world.weather === 'snow';
  const glare = badWeather || oncoming <= ONCOMING_DIP_M + margin + 1e-6 || leading <= FOLLOW_DIP_M + margin + 1e-6;
  return { dark, well_lit: !!lit, high_allowed: dark && !lit && !glare,
    oncoming_m: Number.isFinite(oncoming) ? oncoming : null, leading_m: Number.isFinite(leading) ? leading : null,
    bad_weather: badWeather, glare };
}
export const beamChoice = snap => snap.headlights?.high_allowed ? 'high' : 'low';
export function auditHighBeams(world, dt) {
  if (!world.highBeams) return;
  const h = headlights(world);
  if (!h.dark) return;
  world.highBeamsSeen = true;
  if (world.ego.highBeam && h.glare) {
    const before = world.violations.glare_seconds || 0;
    world.violations.glare_seconds = before + dt;
    if (before <= GLARE_THRESHOLD_S && world.violations.glare_seconds > GLARE_THRESHOLD_S) world.events.push({ type: "glare" });
  }
}
// Render-only NPC policy. Flash at most briefly in each two-second period; never touch sim state.
export function npcHighBeam(world, car) {
  const h = headlights(world, car, [world.ego]);
  const r = beamRelation(world.ego, car);
  const glared = world.ego.highBeam && r && r.distance <= (r.kind === 'oncoming' ? ONCOMING_DIP_M : FOLLOW_DIP_M);
  return h.dark && !h.bad_weather && (glared ? world.t % 2 < 0.25 : h.high_allowed);
}
