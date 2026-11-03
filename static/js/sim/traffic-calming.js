// Speed humps, speed tables, speed cushions and speed bumps (jev/osm/calming.py): raised devices laid
// across a street to slow its traffic. Each kind has the shape the Transportation Association of
// Canada's traffic calming guide gives it, and the speed drivers cross it at:
//   - a speed hump: a rounded rise 3.7 m long and about 80 mm high, crossed at 30 km/h;
//   - a speed cushion: a hump with gaps a wide vehicle (a bus or a fire truck) straddles without
//     slowing; a car still rides over it at 30 km/h;
//   - a speed table: a hump with a flat top, 6.7 m in all, crossed at 40 km/h (with a crosswalk on top
//     it is a raised crosswalk);
//   - a speed bump: a short, sharp ridge under a metre long, crossed at a crawl, 15 km/h.
// Taken faster, a device jolts the car and its occupants. In wet or snowy weather the speed to cross
// at is no higher than the weather allows anywhere else.
//
// Opt-in: the World option `calming` (free drives, unless `?calming=0`; challenges with
// `calming: true`). With it off nothing slows for a device and the audit counts nothing, so the seeded
// benchmark and the other challenges play out exactly as before. With it on:
//   - the driven car's sensing reports the next device along its route (`traffic_calming`), and its
//     target speed comes down to the device's by the time its front reaches it, gently, and stays there
//     until its rear is over (brain/sensors.js);
//   - traffic does the same (sim/npc.js); cyclists ride over, and wide vehicles straddle cushions;
//   - the audit counts crossing one with the front axle faster than its speed plus HIT_OVER_MPS
//     as a hard hit (`hump_hits`, sim/world.js), which costs smoothness in the coaching score; it
//     reaches the metrics, and fails a drive, only once the car has crossed a device
//     (World.calmingSeen).

export const DEVICES = {
  hump: { name: "speed hump", length: 3.7, height: 0.08, mps: 30 / 3.6, flat: 0 },
  cushion: { name: "speed cushion", length: 3.7, height: 0.075, mps: 30 / 3.6, flat: 0, straddle: true },
  table: { name: "speed table", length: 6.7, height: 0.08, mps: 40 / 3.6, flat: 3.0 },
  bump: { name: "speed bump", length: 0.9, height: 0.08, mps: 15 / 3.6, flat: 0 },
};
export const HIT_OVER_MPS = 10 / 3.6;
// A vehicle at least this wide straddles a speed cushion (its wheels go either side of the raised pads).
export const STRADDLE_WIDTH_M = 2.3;
// Traffic plans to slow for a device at no more than this, to its speed (a little over it: drivers
// take them a little faster) by CALM_EARLY_NPC_M short of it, so that it is down to it by then.
export const CALM_DECEL = 1.0;
const CALM_EARLY_NPC_M = 6;
const DRIVER_OVER = 1.1;
export const CALM_LOOK_M = 80;
// The driven car's target is down to a device's speed this far short of it, so that it is there by then.
export const CALM_EARLY_M = 8;

export const deviceOf = (d) => DEVICES[d?.kind] || DEVICES.hump;
export const raisedCrosswalk = (d) => d?.kind === "table" && !!d.crossing;
export const nameOf = (d) => raisedCrosswalk(d) ? "raised crosswalk" : deviceOf(d).name;
// Whether a vehicle (by its spec) slows for device `d`: not a cyclist, nor a wide one at a cushion.
export const slowsFor = (spec, d) => spec?.kind !== "bike" && !(deviceOf(d).straddle && (spec?.width || 0) >= STRADDLE_WIDTH_M);

// Each edge's devices, { s, half, device } in metres along its centreline, in order.
export function calmingSpans(devices, edges) {
  const out = new Map();
  for (const device of devices || []) {
    if (!DEVICES[device.kind]) continue;
    for (const a of device.at || []) {
      if (!edges.has(a.edge)) continue;
      if (!out.has(a.edge)) out.set(a.edge, []);
      out.get(a.edge).push({ s: a.s, half: deviceOf(device).length / 2, device });
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.s - b.s);
  return out;
}

// The speed to slow to `ahead` metres short of a device crossed at `mps`, braking at `decel`.
export const approachSpeed = (mps, ahead, decel = CALM_DECEL) => Math.sqrt(mps * mps + 2 * decel * Math.max(0, ahead));

// The speed a driver on an NPC path (sim/npc.js) keeps to for the devices ahead of its front, its
// spec's, within CALM_LOOK_M: down to each one's speed (see CALM_DECEL) from CALM_EARLY_NPC_M short of
// it until its rear is over. `scaleTo`: the
// weather's speed factor.
export function pathCalmLimit(map, path, front, spec, rear, weatherSpeed = 1) {
  let v = Infinity;
  for (const pe of path.edges) {
    if (pe.sEnd < path.s - rear - 8) continue;
    if (pe.sStart > front + CALM_LOOK_M) break;
    const spans = map.calmingSpans?.get(pe.id);
    if (!spans) continue;
    const e = map.edges.get(pe.id), k = (pe.sEnd - pe.sStart) / Math.max(1e-6, e.length);
    for (const span of spans) {
      if (!slowsFor(spec, span.device)) continue;
      const near = pe.sStart + (span.s - span.half) * k, far = pe.sStart + (span.s + span.half) * k;
      if (far < path.s - rear || near > front + CALM_LOOK_M) continue;
      const mps = deviceOf(span.device).mps * DRIVER_OVER * Math.min(1, weatherSpeed);
      v = Math.min(v, front >= near - CALM_EARLY_NPC_M ? mps : approachSpeed(mps, near - CALM_EARLY_NPC_M - front));
    }
  }
  return v;
}

// The next device along the driven car's route whose far side is ahead of its rear: { id, kind, name,
// speed_mps, starts_in_m (from its front to the device's near side; negative once on it), ends_in_m
// (from its rear to the far side), over (some of the car is on it), crossing (a raised crosswalk) },
// or null. `route.calmingMarks` (map/route.js) has them in route arc length.
export function calmingAhead(route, s, FRONT, REAR, weatherSpeed = 1) {
  const marks = route?.calmingMarks;
  if (!marks?.length) return null;
  for (const m of marks) {
    const near = m.at - m.half, far = m.at + m.half;
    if (far < s - REAR) continue;
    if (near > s + FRONT + CALM_LOOK_M) return null;
    const d = m.device;
    return { id: d.id, kind: d.kind, name: nameOf(d), speed_mps: deviceOf(d).mps * Math.min(1, weatherSpeed), starts_in_m: near - (s + FRONT),
      ends_in_m: far - (s - REAR), over: near <= s + FRONT && far >= s - REAR, crossing: raisedCrosswalk(d) };
  }
  return null;
}

// The rise of device `d` `u` metres from its centre along the street (metres; 0 off it): a cosine
// hump, or for a table a ramp up to a flat top.
export function riseAt(d, u) {
  const k = deviceOf(d), half = k.length / 2, a = Math.abs(u);
  if (a >= half) return 0;
  if (k.flat) {
    const ramp = (k.length - k.flat) / 2;
    return a <= k.flat / 2 ? k.height : k.height * (half - a) / ramp;
  }
  return k.height * 0.5 * (1 + Math.cos(Math.PI * a / half));
}

// How high above the road point (x, y) is, on the devices of `map` (render only: cars ride over them).
export function liftAt(map, x, y) {
  const near = map.calmingGrid?.get(`${Math.floor(x / 20)},${Math.floor(y / 20)}`);
  if (!near) return 0;
  let best = 0;
  for (const { device, h, w } of near) {
    const dx = x - device.x, dy = y - device.y, along = dx * Math.cos(h) + dy * Math.sin(h), across = Math.abs(dx * Math.sin(h) - dy * Math.cos(h));
    if (across > w) continue;
    best = Math.max(best, riseAt(device, along));
  }
  return best;
}

// What the HUD tells the driver about the next device on its route: { key, text, slow }, or null.
// Shown from NOTICE_M short of it until its rear is over; `slow` while the car is faster than the
// device's speed.
const NOTICE_M = 50;
export function calmingNotice(world) {
  if (!world.calming || !world.route) return null;
  const ego = world.ego, p = world.route.project(ego.x, ego.y, world.route.hint);
  if (!p || p.distance > 4) return null;
  const c = calmingAhead(world.route, p.s, ego.spec.length - ego.spec.rearOverhang, ego.spec.rearOverhang);
  if (!c || c.starts_in_m > NOTICE_M) return null;
  const kmh = Math.round(c.speed_mps * 3.6), slow = ego.v > c.speed_mps + 0.5;
  return { key: `${c.id}:${c.over ? "over" : slow ? "slow" : "ok"}`, slow,
    text: c.over ? `${c.name.toUpperCase()} · ${kmh} KM/H` : `${c.name.toUpperCase()} AHEAD · ${slow ? "SLOW TO" : "TAKE IT AT"} ${kmh} KM/H` };
}
