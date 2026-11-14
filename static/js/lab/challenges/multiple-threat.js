// The multiple threat: a marked crosswalk between junctions (map.crosswalks) on a street with two or
// more lanes going the car's way, limited to 60 km/h or less, the crosswalk at least 115 m along its
// edge with no other crosswalk or control in the 115 m before it. The car starts 110 m before the
// crosswalk in the lane beside the curb lane. A car stands in the curb lane, its front 3.5 m short of
// the crosswalk's centre, and a person stands just in front of it on the crosswalk, hidden from the
// car by it; once the car is 45 m from the crosswalk, they walk on across the street, out into the
// car's lane. On the challenge's `street` where it has one.
import { pointAt, headingAt, projectPoint } from "../../map/mapdata.js";
import { Vehicle, CAR } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { BUS_YIELD_LIMIT_MPS } from "../../sim/bus.js";
import { HOLD_M } from "../../sim/crosswalk.js";
import { Pedestrian } from "../../sim/pedestrians.js";
import { StopMemory } from "../../sim/signals.js";
import { ONCOMING_TRIGGER_M, laneScenario, pick, reach, releasePedestrian, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "multiple-threat", title: "The multiple threat", map: "kitsilano", weather: "dry", time: "afternoon", seed: 14042, icon: "⋕", difficulty: "Sight lines", hazard: "crosswalk", street: "West Broadway",
  description: "A car in the curb lane has stopped at a marked crosswalk on West Broadway. The lane beside it is open. Why did it stop?", lesson: "Never pass a vehicle stopped at a crosswalk: it may be hiding the person it stopped for. In BC it is the law. Stop beside it, look, and go on only once nobody is crossing in your path." };

const THREAT_START_M = 110, THREAT_MIN_M = 115;
const threatSiteCache = new WeakMap();
function threatSites(map, street) {
  if (!threatSiteCache.has(map)) {
    const sites = [];
    for (const c of map.crosswalks || []) {
      const base = map.edges.get(c.edge);
      for (const e of [base, ...[...map.edges.values()].filter(o => o.from === base.to && o.to === base.from)]) {
        if (e.lanes < 2 || e.ring || e.limit > BUS_YIELD_LIMIT_MPS) continue;
        const curb = map.lane(e.id, e.lanes - 1), inner = map.lane(e.id, e.lanes - 2);
        const s = projectPoint(inner.pts, inner.cum, [c.x, c.y]).s;
        if (s < THREAT_MIN_M || inner.length - s < 10) continue;
        const along = (o) => projectPoint(e.pts, e.cum, [o.x, o.y]);
        const before = (map.crosswalks || []).some(o => o !== c && (o.edge === e.id || o.edge === base.id) && (() => { const q = along(o); return q.distance < 3 && q.s < s && q.s > s - THREAT_MIN_M; })());
        if (before || (e.control && e.control.s_line < s && e.control.s_line > s - THREAT_MIN_M)) continue;
        sites.push({ crosswalk: c.id, lane: inner, curb, s, sCurb: projectPoint(curb.pts, curb.cum, [c.x, c.y]).s });
      }
    }
    sites.sort((a, b) => a.crosswalk.localeCompare(b.crosswalk) || String(a.lane.edge).localeCompare(String(b.lane.edge)));
    threatSiteCache.set(map, sites);
  }
  const sites = threatSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const threat = pick(threatSites(map, challenge.street), random, "This map has no marked crosswalk on a street with two lanes each way and a limit of 60 km/h or less.");
  return { lane: threat.lane, startS: threat.s - THREAT_START_M,
    fields: { multiThreat: { crosswalk: threat.crosswalk, s: threat.s, curb: { edge: threat.curb.edge, lane: threat.curb.idx, s: threat.sCurb } } } };
});

// The car stopped at the crosswalk in the curb lane, and the person on the crosswalk just in front of
// it, 0.6 m right of its middle, about to walk on across to the far sidewalk. Both wait for the car to
// come up.
function placeThreat(world, fleet, { crosswalk, curb }, seed) {
  const map = world.map, cw = world.crowd.marked.find(c => c.id === crosswalk);
  const lane = map.lane(curb.edge, curb.lane), front = CAR.length - CAR.rearOverhang;
  const at = (s) => pointAt(lane.pts, lane.cum, s), psi = headingAt(lane.pts, lane.cum, curb.s);
  const p = at(curb.s - HOLD_M - front);
  const car = new Vehicle(p[0], p[1], psi, 0);
  Object.assign(car, { id: "challenge_stopped", color: 0x5a6b7a, v0: 11, driver: { aMax: 1.2, b: 2, s0: 2, T: 1.4, react: 0.8, lcRate: 0 },
    stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 1e6, waiting: 0 });
  car.path.start(curb.edge, curb.lane, curb.s - HOLD_M - front); fleet.vehicles.push(car);
  if (!cw) return { stopperId: car.id, pedestrianId: null };
  // the far side of the street from the curb lane
  const c = at(curb.s), right = (q) => (q[0] - c[0]) * Math.sin(psi) - (q[1] - c[1]) * Math.cos(psi);
  const near = right(cw.ends[1]) > 0 ? 1 : -1, from = cw.ends[near], to = cw.ends[-near];
  const start = [c[0] + Math.sin(psi) * 0.6, c[1] - Math.cos(psi) * 0.6];
  const ped = new Pedestrian({ id: "challenge_pedestrian", x: start[0], y: start[1], psi: Math.atan2(to[1] - start[1], to[0] - start[0]),
    v: 0, speed: 1.35, path: [{ p: to, cross: { node: null, marked: cw.id, from, to } }], crossing: null, waiting: 0, phase: 0, look: seed, at: null });
  ped.frozen = 1e6;
  world.crowd.list.push(ped);
  return { stopperId: car.id, pedestrianId: ped.id };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeThreat(world, fleet, scenario.multiThreat, challenge.seed));
}

export const step = (world, fleet) => stepAuthored(world, fleet, {
  trigger: reach(ONCOMING_TRIGGER_M),
  release: (world, fleet, state) => {
    if (state.pedestrianId) releasePedestrian(world, state);
    // (the stopped car waits for them as any driver would)
    const stopper = state.stopperId && fleet.vehicles.find(v => v.id === state.stopperId);
    if (stopper) stopper.frozen = 0;
  },
});
