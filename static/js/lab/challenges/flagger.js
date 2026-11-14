// Follow the flagger: a work zone (sim/work-zone.js) where the car's lane is closed, on a block of the
// challenge's `street` (where it has one) with a limit above the zone's, with room for the car to
// start from a standstill WZ_START_M short of its stop line and for WZ_CARS cars, WZ_CAR_GAP_M apart,
// to wait short of the stop line at the other end. The flaggers show STOP to the car and hold it
// there (`held`); once the car's front is WZ_TRIGGER_M from its line those cars set off through the
// one lane, and once the last of them is past its own line (or after WZ_HOLD_MAX_S) the flaggers go
// on as usual: STOP both ways until the one lane is clear, then SLOW for the car.
import { pointAt, headingAt, projectPoint } from "../../map/mapdata.js";
import { Vehicle, CAR } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";
import { SPAN_M as WZ_SPAN_M, WZ_LIMIT_MPS, workZoneSites } from "../../sim/work-zone.js";
import { rng } from "../../common.js";
import { frontWithin, laneScenario, pick, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "flagger", title: "Follow the flagger", map: "ottawa", weather: "dry", time: "afternoon", seed: 22042, icon: "⚑", difficulty: "Patience", hazard: "work-zone", street: "Queen Street",
  description: "A road crew has closed your lane on Queen Street, leaving one lane for both directions. The flagger at your end holds up a STOP paddle while cars come the other way through it.", lesson: "A flagger's paddle is a traffic sign: on STOP, stop before reaching them and stay stopped; on SLOW, go on with care, at the work zone's speed. Where your lane is closed you go round the work in the other lane, so wait until you're waved through: oncoming traffic has that lane until then. That is Ontario's Highway Traffic Act, and every province has a rule like it." };

const WZ_START_M = 65, WZ_TRIGGER_M = 45, WZ_CARS = 3, WZ_CAR_GAP_M = 12, WZ_HOLD_MAX_S = 40;
const workZoneSiteCache = new WeakMap();
function flaggerSites(map, street) {
  if (!workZoneSiteCache.has(map)) {
    const sites = [], front = CAR.length - CAR.rearOverhang;
    for (const site of workZoneSites(map)) {
      const e = map.edges.get(site.closed);
      if (e.limit <= WZ_LIMIT_MPS + 1) continue;
      const a = Math.min(site.hi, Math.max(site.lo, WZ_START_M + front + 4)), lane = map.lane(site.closed, 0);
      const startS = (a - WZ_START_M - front) * lane.length / e.length;
      if (startS < 2 || e.length - a - WZ_SPAN_M < WZ_CARS * WZ_CAR_GAP_M + 6) continue;
      sites.push({ lane, startS, zone: { closed: site.closed, open: site.open, a } });
    }
    workZoneSiteCache.set(map, sites);
  }
  const sites = workZoneSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const flagger = pick(flaggerSites(map, challenge.street), random, "This map has no straight block of a two-way street with one lane each way, a limit above 30 km/h and room for a work zone.");
  return { lane: flagger.lane, startS: flagger.startS, fields: { workZone: flagger.zone } };
});

// The work zone (see flaggerSites), its flaggers holding STOP for the car, and the cars waiting at its
// far end, short of their stop line, until the car comes up.
function placeWorkZone(world, fleet, { closed, open, a }, seed) {
  const map = world.map, random = rng(seed), z = world.workZones.place({ closed, open, a, phase: "open" }), ids = [];
  z.held = true;
  const e = map.edges.get(open), lane = map.lane(open, 0), line = e.length - z.b;
  for (let i = 0; i < WZ_CARS; i++) {
    // (rear axles: the first one's front 4 m short of its line)
    const s = (line - 4 - (CAR.length - CAR.rearOverhang) - i * WZ_CAR_GAP_M) * lane.length / e.length;
    const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
    Object.assign(car, { id: `challenge_zone_${i + 1}`, color: [0x2b3a55, 0xb0b5b9, 0x9b1e1e][i % 3], v0: 11, driver: { aMax: 1.4, b: 2, s0: 2, T: 1.3, react: 0.5 + random() * 0.3, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 1e6, waiting: 0 });
    car.path.start(open, 0, s);
    fleet.vehicles.push(car); ids.push(car.id);
  }
  return { workZoneId: z.id, zoneCarIds: ids, at: z.flaggers.closed };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeWorkZone(world, fleet, scenario.workZone, challenge.seed));
}

export const step = (world, fleet) => stepAuthored(world, fleet, {
  trigger: frontWithin(WZ_TRIGGER_M),
  // (the cars at the far end of the work zone set off through its one lane)
  release: (world, fleet, state) => {
    for (const id of state.zoneCarIds || []) { const car = fleet.vehicles.find(v => v.id === id); if (car) car.frozen = 0; }
  },
  // (once the last of them is past its stop line, the flaggers go on as usual)
  follow: (world, fleet, state) => {
    if (!state.workZoneId || !state.triggered || state.released) return;
    const z = world.workZones.zones.find(w => w.id === state.workZoneId), e = z && world.map.edges.get(z.open);
    state.setOff ??= world.t;
    const past = (car) => !car || projectPoint(e.pts, e.cum, [car.x, car.y], null).s + car.spec.length - car.spec.rearOverhang > e.length - z.b + 1;
    if (!z || state.zoneCarIds.every(id => past(fleet.vehicles.find(v => v.id === id))) || world.t - state.setOff >= WZ_HOLD_MAX_S) {
      state.released = true;
      if (z) z.held = false;
    }
  },
});
