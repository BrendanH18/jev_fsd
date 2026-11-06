// Low sun glare. In a Canadian autumn and winter the sun sits low at commute times; driving
// straight into it washes out signals and hides people ahead. Drivers slow to what they can see.
//
// Opt-in: the World option `sunGlare` (free drives, unless `?sunglare=0`; challenges with
// `sunGlare: true`). With it off nothing here runs: no sun is computed, visibility, sensing,
// traffic and the audit are exactly as before, and nothing draws from a random stream (nothing here
// is random). With it on:
//   - the sun's position comes from `world.clock` (its `hour`, and `day` of the year and
//     `utc_offset` where it has them) and the map's origin (`pack.origin` lat/lon): `sunOf`;
//   - glare applies to a vehicle while the sun is up but low (0 to GLARE_MAX_ELEVATION_DEG), the
//     weather is clear (`dry`: rain, fog and snow come with an overcast sky, render/atmosphere.js),
//     it is not night, and the vehicle heads within GLARE_HALF_ANGLE_DEG of the sun's azimuth.
//     Severity (0..1) grows the more directly into the sun and the lower it is: `glareFor`;
//   - the driven car's forward sight towards the sun (within GLARE_VIEW_DEG of its bearing) drops
//     from the weather's range to `sight_m` (World installs `visibility.glare`, sim/visibility.js),
//     so signals and people ahead are seen later; and the car keeps to `ceiling_mps`, the speed it
//     can stop from within that sight after a second to react, braking at `comfort().decel` (the
//     same rule as sensing's visibility speed). Sensing reports `sun_glare` and caps `snap.limit`;
//   - traffic heading into the sun keeps to the same ceiling (sim/npc.js; a speed cap only);
//   - the audit counts the seconds the car is more than GLARE_TOLERANCE_MPS above the ceiling, after
//     time to react and slow (`glare_speeding_seconds`), which reaches the metrics, and fails a drive
//     above GLARE_SPEEDING_THRESHOLD_S, only once glare has applied to the car (World.sunGlareSeen).
//
// The sun. With a `day` on the clock, the NOAA general solar position formulas (fractional year,
// equation of time, declination, true solar time, hour angle), without atmospheric refraction: good
// to a fraction of a degree, plenty for glare. The clock's hour is local time at `utc_offset`; a
// clock with no `utc_offset` keeps local mean solar time at the map's longitude (offset = lon / 15),
// an approximation of up to an hour against a real time zone. A clock with no `day` (free drives)
// keeps the sun the sky has always drawn (sim/speed-zones.js `sunAngles`: late September, around
// 24 September, declination -1.5 degrees, no equation of time), so the sky, darkness and the glare
// agree; the "Into the sun" challenge sets its own date (8 October) and offset.
import { sunAngles } from "./speed-zones.js";
import { comfort } from "./vehicle.js";
import { current as weather } from "./weather.js";

export const GLARE_MAX_ELEVATION_DEG = 20;  // higher, the visor and roof shade the driver's eyes
export const GLARE_FULL_ELEVATION_DEG = 10; // at or below this (and above the horizon), full glare
export const GLARE_HALF_ANGLE_DEG = 30;     // the sun this far off the heading no longer dazzles
export const GLARE_FULL_ANGLE_DEG = 10;     // within this of the heading, full glare
export const GLARE_VIEW_DEG = 35;           // what lies within this of the sun's bearing is washed out
export const GLARE_SIGHT_LOSS = 0.65;       // at full severity, forward sight drops by this share
export const GLARE_MIN_SIGHT_M = 20;
export const GLARE_REACTION_S = 1;          // (as sensing's visibility speed: a second to react,
export const GLARE_MARGIN_M = 5;            //  and stopped this far short of what comes into view)
export const GLARE_TOLERANCE_MPS = 1;       // the audit allows this much over the ceiling
export const GLARE_SPEEDING_THRESHOLD_S = 1; // more than this over the ceiling fails a drive
export const DEFAULT_SUN_DATE = "late September (as the sky draws it)";

const RAD = Math.PI / 180;
const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const wrapDeg = (d) => ((d % 360) + 540) % 360 - 180;

// "MM-DD" -> day of the year (1..365, a common year).
export function dayOfYear(date) {
  const m = String(date).match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const month = +m[1], day = +m[2], days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  return days.slice(0, month - 1).reduce((a, b) => a + b, 0) + day;
}

// The sun at local clock `hour` on `day` of the year at { latitude, longitude, utcOffset } (NOAA):
// { elevation, H (hour angle), latitude, declination } in radians, as sim/speed-zones.js sunAngles,
// and the equation of time `eot_min`.
export function solarAngles(hour, { latitude, longitude, utcOffset = null, day }) {
  const tz = Number.isFinite(utcOffset) ? utcOffset : longitude / 15;
  const g = 2 * Math.PI / 365 * (day - 1 + (hour - tz - 12) / 24);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const declination = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMin = hour * 60 + eot + 4 * longitude - 60 * tz;
  const H = (trueSolarMin / 4 - 180) * RAD, lat = latitude * RAD;
  const elevation = Math.asin(Math.max(-1, Math.min(1, Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(H))));
  return { elevation, H, latitude: lat, declination, eot_min: eot };
}

// Azimuth (rad, clockwise from north) of a sun at elevation `el` and hour angle `H` (+ afternoon):
// the same formula the sky uses (render/atmosphere.js sunPosition).
export function azimuthOf({ elevation: el, H, latitude, declination }) {
  const cosAz = (Math.sin(declination) - Math.sin(el) * Math.sin(latitude)) / (Math.cos(el) * Math.cos(latitude));
  const az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  return H > 0 ? 2 * Math.PI - az : az;
}

// The place the sun is seen from and its date: { latitude, longitude, utcOffset, day? }.
export function sunLocation(map, clock) {
  const origin = map?.pack?.origin;
  if (!origin || !clock) return null;
  return { latitude: origin.lat, longitude: origin.lon, utcOffset: Number.isFinite(clock.utc_offset) ? clock.utc_offset : origin.lon / 15,
    ...(Number.isFinite(clock.day) ? { day: clock.day } : {}) };
}

// The sun over a world: { elevation_deg, azimuth_deg (compass) }, or null without a clock or origin.
const sunMemo = new WeakMap();
export function sunOf(world) {
  const clock = world.clock, loc = sunLocation(world.map, clock);
  if (!loc) return null;
  const key = `${clock.hour}|${loc.day}|${loc.utcOffset}`, memo = sunMemo.get(world);
  if (memo?.key === key) return memo.sun;
  const a = Number.isFinite(loc.day) ? solarAngles(clock.hour, loc) : sunAngles(clock.hour, loc);
  const sun = { elevation_deg: a.elevation / RAD, azimuth_deg: azimuthOf(a) / RAD };
  sunMemo.set(world, { key, sun });
  return sun;
}

// Compass bearing (deg) of sim heading `psi` (rad, counter-clockwise from east).
export const bearingOf = (psi) => ((90 - psi / RAD) % 360 + 360) % 360;

// The speed a vehicle can stop from within `sight` metres: a second to react, then braking at
// comfort().decel, GLARE_MARGIN_M short (the rule sensing's visibility speed uses).
export function glareCeiling(sight, front) {
  const decel = comfort().decel, room = Math.max(0, sight - front - GLARE_MARGIN_M), br = decel * GLARE_REACTION_S;
  return Math.sqrt(br * br + 2 * decel * room) - br;
}

// Glare on vehicle `car` (heading `car.psi`): { severity, sight_m, ceiling_mps, off_deg,
// sun_azimuth_deg, sun_elevation_deg }, or null when the sun does not dazzle it.
export function glareFor(world, car = world.ego) {
  if (!world.sunGlare || weather.name !== "dry" || world.visibility.night > 0.5) return null;
  const sun = sunOf(world);
  if (!sun || sun.elevation_deg <= 0 || sun.elevation_deg >= GLARE_MAX_ELEVATION_DEG) return null;
  const off = Math.abs(wrapDeg(bearingOf(car.psi) - sun.azimuth_deg));
  if (off >= GLARE_HALF_ANGLE_DEG) return null;
  const align = 1 - smooth((off - GLARE_FULL_ANGLE_DEG) / (GLARE_HALF_ANGLE_DEG - GLARE_FULL_ANGLE_DEG));
  const low = 1 - smooth((sun.elevation_deg - GLARE_FULL_ELEVATION_DEG) / (GLARE_MAX_ELEVATION_DEG - GLARE_FULL_ELEVATION_DEG));
  const severity = align * low;
  if (severity < 0.05) return null;
  const range = world.visibility.range;
  const sight = Math.min(range, Math.max(GLARE_MIN_SIGHT_M, range * (1 - GLARE_SIGHT_LOSS * severity)));
  const spec = car.spec;
  return { severity, sight_m: sight, ceiling_mps: glareCeiling(sight, spec.length - spec.rearOverhang), off_deg: off,
    sun_azimuth_deg: sun.azimuth_deg, sun_elevation_deg: sun.elevation_deg };
}

// The driven car's glare, memoised on what it depends on (visibility asks for it per object seen).
const egoMemo = new WeakMap();
export function egoGlare(world) {
  const ego = world.ego, c = world.clock;
  const key = `${ego.psi}|${c?.hour}|${c?.day}|${c?.utc_offset}|${weather.name}|${world.visibility.night}|${world.sunGlare}`;
  const memo = egoMemo.get(world);
  if (memo?.key === key) return memo.glare;
  const glare = glareFor(world, ego);
  egoMemo.set(world, { key, glare });
  return glare;
}

// sim/visibility.js hook: how far the driven car sees towards (x, y) under glare (Infinity where the
// sun does not wash it out: away from the sun's bearing, or for anyone else looking).
export function glareRange(world, observer, x, y) {
  if (observer !== world.ego) return Infinity;
  const g = egoGlare(world);
  if (!g) return Infinity;
  const bearing = bearingOf(Math.atan2(y - observer.y, x - observer.x));
  return Math.abs(wrapDeg(bearing - g.sun_azimuth_deg)) <= GLARE_VIEW_DEG ? g.sight_m : Infinity;
}

// Traffic heading into the sun keeps to the same ceiling (sim/npc.js).
export function npcGlareCeiling(world, car) {
  return glareFor(world, car)?.ceiling_mps ?? Infinity;
}

// Sensing (`sun_glare`): the car's glare now, rounded for the observation, or null.
export function sunGlareSensing(world) {
  const g = egoGlare(world);
  if (!g) return null;
  return { severity: Math.round(g.severity * 100) / 100, sight_m: Math.round(g.sight_m), ceiling_mps: g.ceiling_mps,
    sun_azimuth_deg: Math.round(g.sun_azimuth_deg), sun_elevation_deg: Math.round(g.sun_elevation_deg * 10) / 10, off_heading_deg: Math.round(g.off_deg) };
}

// The audit (World.audit, every tick): time more than GLARE_TOLERANCE_MPS over the ceiling, once the
// car has had a second to react and time to slow at comfort().decel from when the glare (or a lower
// ceiling) came on. `world.sunGlareCall` keeps that allowance.
export function auditSunGlare(world, dt) {
  const g = egoGlare(world), ego = world.ego;
  if (!g) { world.sunGlareCall = null; return; }
  world.sunGlareSeen = true;
  const allow = () => world.t + GLARE_REACTION_S + Math.max(0, ego.v - g.ceiling_mps) / comfort().decel;
  let call = world.sunGlareCall;
  if (!call) call = world.sunGlareCall = { ceiling: g.ceiling_mps, grace: allow() };
  else if (g.ceiling_mps < call.ceiling - 0.25) Object.assign(call, { ceiling: g.ceiling_mps, grace: Math.max(call.grace, allow()) });
  else if (g.ceiling_mps > call.ceiling) call.ceiling = g.ceiling_mps;
  if (world.t < call.grace || ego.v <= g.ceiling_mps + GLARE_TOLERANCE_MPS) return;
  const before = world.violations.glare_speeding_seconds || 0;
  world.violations.glare_speeding_seconds = before + dt;
  if (before <= GLARE_SPEEDING_THRESHOLD_S && world.violations.glare_speeding_seconds > GLARE_SPEEDING_THRESHOLD_S) world.events.push({ type: "sun_glare" });
}

// What the HUD tells the driver: { key, text, slow }, or null.
export function sunGlareNotice(world) {
  if (!world.sunGlare) return null;
  const g = egoGlare(world);
  if (!g) return null;
  const kmh = Math.round(g.ceiling_mps * 3.6), slow = world.ego.v > g.ceiling_mps + 0.5;
  return { key: slow ? "slow" : "ok", slow, text: slow ? `SUN GLARE: SLOWING · ${kmh} KM/H` : `SUN GLARE · SIGHT ${Math.round(g.sight_m)} M` };
}
