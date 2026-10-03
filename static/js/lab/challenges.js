import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { Vehicle, BIKE } from "../sim/vehicle.js";
import { NpcPath } from "../sim/npc.js";
import { Pedestrian } from "../sim/pedestrians.js";
import { StopMemory } from "../sim/signals.js";
import { rng } from "../common.js";
import { Visibility } from "../sim/visibility.js";

export const CHALLENGE_VERSION = 2;
export const CHALLENGES = [
  { id: "door-zone", title: "The door zone", map: "kitsilano", weather: "dry", time: "afternoon", seed: 1042, icon: "↔", difficulty: "Anticipation", hazard: "door",
    description: "A cyclist. A parked car. One opening door. Leave room before you need it.", lesson: "Look for curb activity and give the cyclist room." },
  { id: "fog-junction", title: "Into the unknown", map: "victoria", weather: "fog", time: "morning", seed: 2042, icon: "◌", difficulty: "Visibility", hazard: "signal",
    description: "A Victoria junction with only 28 metres of sight. Can you stop within what you can see?", lesson: "An unseen signal is unknown. Slow early, then observe." },
  { id: "rain-crossing", version: 2, title: "Rain check", map: "montreal", weather: "rain", time: "night", seed: 3042, icon: "☂", difficulty: "Patience", hazard: "pedestrian",
    description: "A person crosses a wet Montréal street after dark. Smooth braking matters.", lesson: "Leave extra braking room on wet roads." },
  { id: "snow-stop", title: "Winter composure", map: "toronto", weather: "snow", time: "afternoon", seed: 4042, icon: "❄", difficulty: "Control", hazard: "stop",
    description: "A snowy Toronto block and a full stop. Stay composed when grip is limited.", lesson: "Lift off early. A complete stop beats a late hard brake." },
  { id: "curb-merge", title: "Joining the flow", map: "kitsilano", weather: "dry", time: "afternoon", seed: 5042, icon: "↗", difficulty: "Anticipation", hazard: "pull",
    description: "A parked car signals and joins your lane. Notice the indicator and leave a gap.", lesson: "Ease off for a merging car rather than closing the gap." },
  { id: "blind-crossing", title: "Around the corner", map: "kitsilano", weather: "dry", time: "afternoon", seed: 6042, icon: "◧", difficulty: "Sight lines", hazard: "occluded-pedestrian",
    description: "A person emerges from behind a mapped building. Your view opens as you approach.", lesson: "Leave stopping room when a building blocks your view of the sidewalk." },
];
export const challengeById = id => CHALLENGES.find(c => c.id === id) || null;

const blindSites = new WeakMap();
function occludedCrossings(map, lanes) {
  if (blindSites.has(map)) return blindSites.get(map);
  const visibility = new Visibility(map), sites = [];
  for (const lane of lanes) {
    for (let s = 85; s < lane.length - 25; s += 5) {
      const p = pointAt(lane.pts, lane.cum, s), psi = headingAt(lane.pts, lane.cum, s);
      const offset = right => [p[0] + Math.sin(psi) * right, p[1] - Math.cos(psi) * right];
      const far = pointAt(lane.pts, lane.cum, s - 43), near = pointAt(lane.pts, lane.cum, s - 20);
      for (const right of [6, -6, 8, -8, 10, -10]) {
        const from = offset(right), to = offset(-Math.sign(right) * 6);
        // The entire person starts hidden, becomes visible on approach, and has a clear crossing path.
        if (![right - 0.25, right, right + 0.25].every(r => visibility.occluded(far, offset(r)))
          || visibility.occluded(near, from) || visibility.occluded(from, to)) continue;
        sites.push({ lane, hazardS: s, from, to });
        break;
      }
    }
  }
  blindSites.set(map, sites); return sites;
}

export function challengeScenario(map, challenge) {
  let lanes = map.laneList.filter(l => l.length > 110 && l.idx === l.edgeRef.lanes - 1 && !l.edgeRef.ring);
  const matching = lanes.filter(l => ["door", "pull"].includes(challenge.hazard) ? l.edgeRef.parking?.[1] > 0
    : challenge.hazard === "signal" ? l.edgeRef.control?.type === "signal"
    : challenge.hazard === "stop" ? l.edgeRef.control?.type === "stop" : !l.edgeRef.control);
  if (matching.length) lanes = matching;
  if (!lanes.length) lanes = map.laneList.filter(l => l.length > 65 && !l.edgeRef.ring);
  if (!lanes.length) throw new Error("This map has no suitable challenge lane.");
  lanes.sort((a, b) => String(a.edge).localeCompare(String(b.edge)) || a.idx - b.idx);
  const random = rng(challenge.seed);
  const sites = challenge.hazard === "occluded-pedestrian" ? occludedCrossings(map, lanes) : null;
  if (sites && !sites.length) throw new Error("This map has no clear crossing with a building-obstructed approach.");
  const site = sites ? sites[Math.floor(random() * sites.length)] : null;
  const start = site?.lane || lanes[Math.floor(random() * lanes.length)];
  const startS = site ? site.hazardS - 65 : Math.max(8, Math.min(20, start.length * 0.15));
  const chain = [start], seen = new Set([start.edge]);
  let length = start.length - startS;
  for (let i = 0; i < 12 && length < 260; i++) {
    const previous = chain.at(-1);
    const successors = map.successors(previous.edge).filter(id => !seen.has(id) && Math.abs(map.turnAngle(previous.edge, id)) < 130 * Math.PI / 180);
    successors.sort((a, b) => Math.abs(map.turnAngle(previous.edge, a)) - Math.abs(map.turnAngle(previous.edge, b)) || String(a).localeCompare(String(b)));
    if (!successors.length) break;
    const id = successors[0], edge = map.edges.get(id), turn = map.classifyTurn(map.turnAngle(previous.edge, id));
    const lane = map.lane(id, turn === "left" ? 0 : edge.lanes - 1);
    chain.push(lane); seen.add(id); length += lane.length;
  }
  const route = routeFromLanes(map, chain, startS, Math.max(10, chain.at(-1).length - 10));
  const p = pointAt(start.pts, start.cum, startS);
  return { id: challenge.id, start: { edge: start.edge, lane: start.idx, s: startS, x: p[0], y: p[1], psi: headingAt(start.pts, start.cum, startS) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    ...(site ? { crossing: { hazardS: site.hazardS, from: site.from, to: site.to } } : {}),
    tags: { length_m: Math.round(length), signals: chain.filter(l => l.edgeRef.control?.type === "signal").length,
      stops: chain.filter(l => l.edgeRef.control?.type === "stop").length, lefts: route.turns.filter(t => t.dir === "left").length, rights: route.turns.filter(t => t.dir === "right").length } };
}

export function installChallenge(world, fleet, challenge, scenario) {
  const lane = world.map.lane(scenario.start.edge, scenario.start.lane);
  const hazardS = scenario.crossing?.hazardS ?? Math.min(lane.length - 15, scenario.start.s + 65);
  const p = pointAt(lane.pts, lane.cum, hazardS), psi = headingAt(lane.pts, lane.cum, hazardS);
  const offset = right => [p[0] + Math.sin(psi) * right, p[1] - Math.cos(psi) * right];
  world.challenge = { id: challenge.id, hazard: challenge.hazard, triggered: false, at: p, carId: null, pedestrianId: null };
  if (["door", "pull"].includes(challenge.hazard)) {
    const ep = pointAt(lane.edgeRef.pts, lane.edgeRef.cum, hazardS);
    const laneOffset = (p[0] - ep[0]) * Math.sin(psi) - (p[1] - ep[1]) * Math.cos(psi);
    const curb = Math.max(2.4, lane.edgeRef.asphalt[1] - (lane.edgeRef.parking?.[1] || 2.4) / 2 - laneOffset);
    const cp = offset(curb), car = new Vehicle(cp[0], cp[1], psi, 0);
    Object.assign(car, { id: "challenge_parked", color: 0xd9b685, curb: "right", edge: lane.edge });
    world.parked.add(car); world.challenge.carId = car.id;
  }
  if (challenge.hazard === "door") {
    const bp = pointAt(lane.pts, lane.cum, scenario.start.s + 30);
    const bike = new Vehicle(bp[0], bp[1], headingAt(lane.pts, lane.cum, scenario.start.s + 30), 3, BIKE);
    Object.assign(bike, { id: "challenge_bike", kind: "bike", color: 0x4cc2ff, v0: 3.5, driver: { aMax: 0.8, b: 2, s0: 2, T: 1.5, react: 0.6, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(world.map, fleet.random, { bike: true }), frozen: 0, waiting: 0 });
    bike.path.start(lane.edge, lane.idx, scenario.start.s + 30); fleet.vehicles.push(bike);
  }
  if (["pedestrian", "occluded-pedestrian"].includes(challenge.hazard)) {
    const from = scenario.crossing?.from || offset(5.5), to = scenario.crossing?.to || offset(-5.5);
    const crossing = { node: null, from, to, jaywalk: true };
    const ped = new Pedestrian({ id: "challenge_pedestrian", x: from[0], y: from[1], psi: psi + Math.PI / 2,
      v: 0, speed: 1.35, path: [{ p: to, cross: crossing }], crossing: null, waiting: 0, phase: 0, look: challenge.seed,
      at: null });
    ped.frozen = 1e6;
    world.crowd.list.push(ped); world.challenge.pedestrianId = ped.id;
  }
  // Background curb events are disabled to isolate the authored hazard.
  world.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
}

export function stepChallenge(world, fleet) {
  const state = world.challenge;
  if (!state) return;
  const local = world.ego.toLocal(...state.at);
  if (!state.triggered && local.ahead < (state.hazard === "pull" ? 65 : 43) && local.ahead > 0) {
    state.triggered = true;
    if (state.carId) {
      const car = world.parked.list.find(c => c.id === state.carId);
      if (state.hazard === "pull") { const merging = fleet.startPullOut(car); state.mergingId = merging?.id || null; }
      else world.parked.openDoor(car);
    }
    if (state.pedestrianId) {
      const ped = world.crowd.list.find(p => p.id === state.pedestrianId);
      ped.frozen = 0; ped.crossing = ped.path[0].cross;
    }
  }
  const ped = state.pedestrianId && world.crowd.list.find(p => p.id === state.pedestrianId);
  if (ped && !ped.path.length) { ped.frozen = 1e6; ped.v = 0; }
}

export function challengeConfig(challenge) {
  return { version: challenge.version || 1, challenge: challenge.id, map: challenge.map, seed: challenge.seed,
    weather: challenge.weather, time: challenge.time, traffic: 0, car: "compact", clock: 0 };
}
