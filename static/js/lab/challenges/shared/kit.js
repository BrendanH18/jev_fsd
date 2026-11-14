// What the challenges share (lab/challenges/<id>.js; the registry is lab/challenges.js).
//
// A challenge module exports its definition, `challenge`, and its scripted parts:
// - `scenario(map, challenge)`: the drive (start, route, destination and whatever it places), most
//   built by `laneScenario` from the site the challenge picks;
// - `install(world, fleet, challenge, scenario, at)` (optional): what it places in the world, after
//   `installBase` has set `world.challenge` (`at` is its lane, hazard point and heading);
// - `step(world, fleet)` (optional): run every step; by default `stepAuthored`, which sets the hazard
//   off (`release`) once the car comes within `trigger` of `world.challenge.at`.
import { routeFromLanes } from "../../../demo/routing.js";
import { pointAt, headingAt, wrapAngle } from "../../../map/mapdata.js";
import { Vehicle } from "../../../sim/vehicle.js";
import { NpcPath } from "../../../sim/npc.js";
import { StopMemory, approachPhase } from "../../../sim/signals.js";
import { Pedestrian } from "../../../sim/pedestrians.js";
import { rng } from "../../../common.js";

// The car's distance from the hazard when oncoming and crossing traffic, and most hazards at a
// junction, are set off.
export const ONCOMING_TRIGGER_M = 45;
// The gaps between cars standing in a queue (Clear the tracks, Keep the box clear).
export const QUEUE_GAP_M = [1.8, 4.5];

// --- Scenarios ---------------------------------------------------------------------------------

// The curb lanes a challenge may start in: of the kind its hazard needs (a parking lane for a door or
// a car pulling out, a signal, a stop sign, else no control at all) where the map has them.
export function plainLanes(map, hazard) {
  let lanes = map.laneList.filter(l => l.length > 110 && l.idx === l.edgeRef.lanes - 1 && !l.edgeRef.ring);
  const matching = lanes.filter(l => ["door", "pull"].includes(hazard) ? l.edgeRef.parking?.[1] > 0
    : hazard === "signal" ? l.edgeRef.control?.type === "signal"
    : hazard === "stop" ? l.edgeRef.control?.type === "stop" : !l.edgeRef.control);
  if (matching.length) lanes = matching;
  if (!lanes.length) lanes = map.laneList.filter(l => l.length > 65 && !l.edgeRef.ring);
  if (!lanes.length) throw new Error("This map has no suitable challenge lane.");
  lanes.sort((a, b) => String(a.edge).localeCompare(String(b.edge)) || a.idx - b.idx);
  return lanes;
}

// One of the sites, drawn from the challenge's seed; `message` when there is none.
export function pick(sites, random, message) {
  if (!sites.length) throw new Error(message);
  return sites[Math.floor(random() * sites.length)];
}

// The lane straight on into `edge` from `start`, as far right as `start` is.
export const straightOn = (map, start, edge) => map.lane(edge, Math.min(start.idx, map.edges.get(edge).lanes - 1));

// A drive along a chain of lanes. `find(map, challenge, random, lanes)` picks the site (`random` is
// seeded from the challenge, `lanes` are its plainLanes) and returns the plan:
// { lane, startS, through: [lanes after it], extend: route length to carry on to (0: none; default
// 260 m, along the straightest successors), goalS: on the last lane (or (last, length) => s; default
// 10 m short of its end), fields: what the scenario carries for install }.
// Without one (or with no `find`), it starts on one of the plain lanes, 8 to 20 m along.
export function laneScenario(map, challenge, find = null) {
  const lanes = plainLanes(map, challenge.hazard);
  const random = rng(challenge.seed);
  const plan = find ? find(map, challenge, random, lanes) : null;
  const start = plan ? plan.lane : lanes[Math.floor(random() * lanes.length)];
  const startS = plan ? plan.startS : Math.max(8, Math.min(20, start.length * 0.15));
  const chain = [start], seen = new Set([start.edge]);
  let length = start.length - startS;
  for (const lane of plan?.through || []) { chain.push(lane); seen.add(lane.edge); length += lane.length; }
  const extend = plan?.extend ?? 260;
  for (let i = 0; i < 12 && extend && length < extend; i++) {
    const previous = chain.at(-1);
    const successors = map.successors(previous.edge).filter(id => !seen.has(id) && Math.abs(map.turnAngle(previous.edge, id)) < 130 * Math.PI / 180);
    successors.sort((a, b) => Math.abs(map.turnAngle(previous.edge, a)) - Math.abs(map.turnAngle(previous.edge, b)) || String(a).localeCompare(String(b)));
    if (!successors.length) break;
    const id = successors[0], edge = map.edges.get(id), turn = map.classifyTurn(map.turnAngle(previous.edge, id));
    const lane = map.lane(id, turn === "left" ? 0 : edge.lanes - 1);
    chain.push(lane); seen.add(id); length += lane.length;
  }
  const last = chain.at(-1), goal = plan?.goalS;
  const goalS = goal === undefined ? last.length - 10 : typeof goal === "function" ? goal(last, length) : goal;
  const route = routeFromLanes(map, chain, startS, Math.max(10, goalS));
  const p = pointAt(start.pts, start.cum, startS);
  return { id: challenge.id, start: { edge: start.edge, lane: start.idx, s: startS, x: p[0], y: p[1], psi: headingAt(start.pts, start.cum, startS) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    ...(plan?.fields || {}),
    tags: { length_m: Math.round(length), signals: chain.filter(l => l.edgeRef.control?.type === "signal").length,
      stops: chain.filter(l => l.edgeRef.control?.type === "stop").length, lefts: route.turns.filter(t => t.dir === "left").length, rights: route.turns.filter(t => t.dir === "right").length } };
}

// --- Installing ----------------------------------------------------------------------------------

// `world.challenge`, the state every challenge starts from, and where its hazard is (`at`): an
// oncoming hazard at the stop line, a cyclist or emergency vehicle at the end of the lane, else 65 m on.
export function installBase(world, challenge, scenario) {
  const lane = world.map.lane(scenario.start.edge, scenario.start.lane);
  const hazardS = scenario.crossing?.hazardS ?? scenario.multiThreat?.s ?? scenario.child?.s ?? (scenario.oncoming || scenario.blindLeft || scenario.allWay || scenario.twoWay ? lane.edgeRef.control.s_line : scenario.cyclist || scenario.emergency ? lane.length : Math.min(lane.length - 15, scenario.start.s + 65));
  const p = pointAt(lane.pts, lane.cum, hazardS), psi = headingAt(lane.pts, lane.cum, hazardS);
  const offset = right => [p[0] + Math.sin(psi) * right, p[1] - Math.cos(psi) * right];
  world.challenge = { id: challenge.id, hazard: challenge.hazard, triggered: false, at: p, carId: null, pedestrianId: null, ...(scenario.oncoming ? { oncoming: scenario.oncoming } : {}), ...(scenario.allWay ? { allWay: scenario.allWay } : {}), ...(scenario.twoWay ? { twoWay: scenario.twoWay, stopId: lane.edgeRef.control.id } : {}), ...(scenario.emergency ? { emergency: scenario.emergency } : {}) };
  return { lane, hazardS, p, psi, offset };
}

// Background curb events are disabled to isolate the authored hazard.
export function finishInstall(world, fleet) {
  world.parked.nextDoor = 1e9; fleet.nextPark = 1e9; fleet.nextPull = 1e9;
}

// A car parked at the curb beside the hazard point (The door zone, Joining the flow).
export function placeCurbCar(world, { lane, hazardS, p, psi, offset }) {
  const ep = pointAt(lane.edgeRef.pts, lane.edgeRef.cum, hazardS);
  const laneOffset = (p[0] - ep[0]) * Math.sin(psi) - (p[1] - ep[1]) * Math.cos(psi);
  const curb = Math.max(2.4, lane.edgeRef.asphalt[1] - (lane.edgeRef.parking?.[1] || 2.4) / 2 - laneOffset);
  const cp = offset(curb), car = new Vehicle(cp[0], cp[1], psi, 0);
  Object.assign(car, { id: "challenge_parked", color: 0xd9b685, curb: "right", edge: lane.edge });
  world.parked.add(car); world.challenge.carId = car.id;
}

// A person waiting to walk across the street at the hazard point, from the scenario's `crossing`
// where it has one (Rain check, Around the corner).
export function placeCrossingPedestrian(world, challenge, scenario, { psi, offset }) {
  const from = scenario.crossing?.from || offset(5.5), to = scenario.crossing?.to || offset(-5.5);
  const crossing = { node: null, from, to, jaywalk: true };
  const ped = new Pedestrian({ id: "challenge_pedestrian", x: from[0], y: from[1], psi: psi + Math.PI / 2,
    v: 0, speed: 1.35, path: [{ p: to, cross: crossing }], crossing: null, waiting: 0, phase: 0, look: challenge.seed,
    at: null });
  ped.frozen = 1e6;
  world.crowd.list.push(ped); world.challenge.pedestrianId = ped.id;
}

// --- Stepping ------------------------------------------------------------------------------------

// Triggers: the hazard's point less than `m` ahead of the car's rear axle, or of its front.
export const reach = (m) => (local) => local.ahead < m;
export const frontWithin = (m) => (local, world) => local.ahead < m + world.ego.spec.length - world.ego.spec.rearOverhang;

// Once (with the hazard still ahead) `trigger(local, world, state)` holds, `release` sets it off;
// `follow` runs every step after that check. A pedestrian who has reached the end of their path stops
// there.
export function stepAuthored(world, fleet, { trigger = reach(43), release = null, follow = null } = {}) {
  const state = world.challenge;
  const local = world.ego.toLocal(...state.at);
  if (!state.triggered && trigger(local, world, state) && local.ahead > 0) {
    state.triggered = true;
    if (release) release(world, fleet, state);
  }
  if (follow) follow(world, fleet, state);
  const ped = state.pedestrianId && world.crowd.list.find(p => p.id === state.pedestrianId);
  if (ped && !ped.path.length) { ped.frozen = 1e6; ped.v = 0; }
}

// The challenge's pedestrian sets off along their path.
export function releasePedestrian(world, state) {
  const ped = world.crowd.list.find(p => p.id === state.pedestrianId);
  ped.frozen = 0; ped.crossing = ped.path[0].cross;
}

// --- Traffic set off at the trigger --------------------------------------------------------------

// With the car 45 m from its stop line, two cars 20 m apart (1.8 s at 11 m/s, too short a gap to
// turn in) set off on the opposite approach, the first 60 m before its own line, both going straight
// through. They start out of sight, beyond the 80 m a driver can see in clear daylight. For a right
// turn on red the same two cars come from the left, in its curb lane.
// Where each oncoming car starts: [edge, s, edges before the approach's own], or null when there is
// no room. A start before the approach begins is on the street leading straight into it.
export function oncomingStarts(map, edge) {
  const approach = map.edges.get(edge), line = approach.control.s_line;
  return [line - 60, line - 80].map(s => {
    if (s >= 2) return [edge, s, []];
    const before = (map.inn.get(approach.from) || []).find(p => map.classifyTurn(map.turnAngle(p, edge)) === "straight" && map.edges.get(p).length + s > 2);
    return before ? [before, s + map.edges.get(before).length, [[edge, 0]]] : null;
  });
}
export function releaseOncoming(world, fleet, { edge, then, lane: which }) {
  const map = world.map, v = Math.min(11, map.edges.get(edge).limit || 11);
  const laneOf = (id) => which === "curb" ? map.edges.get(id).lanes - 1 : 0;
  return oncomingStarts(map, edge).map(([id, s, through], i) => {
    const plan = [...through.map(([e]) => [e, laneOf(e)]), [then, laneOf(then)]];
    const lane = map.lane(id, laneOf(id)), p = pointAt(lane.pts, lane.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
    Object.assign(car, { id: `challenge_${which === "curb" ? "cross" : "oncoming"}_${i + 1}`, color: i ? 0x2b3a55 : 0x9b1e1e, v0: v, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(id, laneOf(id), s, plan); fleet.vehicles.push(car);
    return car.id;
  });
}

// Unprotected left turns: a signalled approach at least 90 m long whose route turns left onto a
// street at least 60 m long, opposite an approach of the same signal (heading within 20 deg of
// straight at it, its line at least 70 m along) that continues straight through. The approach's
// light is green from 3 s to 26 s, so the car arrives on a green with time to wait for the gap.
// (The unprotected left, and the blind left.)
const LEFT_GREEN_S = [3, 26];
const leftSites = new WeakMap();
export function oncomingSites(map) {
  if (leftSites.has(map)) return leftSites.get(map);
  const sites = [];
  for (const edge of map.edges.values()) {
    const control = edge.control;
    if (control?.type !== "signal" || edge.length < 90 || control.s_line < 75) continue;
    const left = map.successors(edge.id).find(id => map.classifyTurn(map.turnAngle(edge.id, id)) === "left" && map.edges.get(id).length > 60);
    const opposite = (map.inn.get(edge.to) || []).find(id => {
      const other = map.edges.get(id);
      return id !== edge.id && other.control?.type === "signal" && other.control.id === control.id && other.control.s_line > 70
        && Math.abs(Math.abs(wrapAngle(map.headingIn(id) - map.headingIn(edge.id))) - Math.PI) < 0.35;
    });
    const straight = opposite && map.successors(opposite).find(id => map.classifyTurn(map.turnAngle(opposite, id)) === "straight");
    const inter = map.intersections.get(control.id);
    if (!left || !straight || !inter || !oncomingStarts(map, opposite).every(Boolean)) continue;
    let green = true;
    // (a plain green: not an advance green, under which the turn would be protected)
    for (let t = LEFT_GREEN_S[0]; t <= LEFT_GREEN_S[1] && green; t += 0.5) green = approachPhase(inter, edge.id, t) === "green" && approachPhase(inter, opposite, t) === "green";
    if (green) sites.push({ lane: map.lane(edge.id, 0), left, opposite, straight });
  }
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  leftSites.set(map, sites); return sites;
}

// At an all-way stop, with the car 45 m from its line: from the right, a hesitant driver 22 m from
// its line (it waits 3 s once it may go, so it is still there when the car stops) and a second car
// 10 m behind it, which reaches the line only after the first has gone, and so after the car; and
// an oncoming car 55 m out that turns left, also arriving after the car. They come at 7 to 9 m/s.
// (Four-way stop, and Lights out.)
export function allWayCars(map, site) {
  return [
    { id: "challenge_right_1", edge: site.fromRight, back: 22, then: site.across, v: 7, react: 3 },
    { id: "challenge_right_2", edge: site.fromRight, back: 32, then: site.across, v: 7, react: 0.6 },
    { id: "challenge_oncoming_left", edge: site.opposite, back: 55, then: site.left, v: 9, react: 0.6 },
  ].filter(c => map.edges.get(c.edge).control.s_line - c.back >= 2);
}
export function releaseAllWay(world, fleet, cars) {
  const map = world.map;
  return cars.map(({ id, edge, back, then, v, react }, i) => {
    const e = map.edges.get(edge), lane = map.lane(edge, e.lanes - 1), s = e.control.s_line - back;
    const turn = map.classifyTurn(map.turnAngle(edge, then)), next = map.edges.get(then);
    const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
    Object.assign(car, { id, color: [0x9b1e1e, 0x2b3a55, 0xeeeeea][i % 3], v0: Math.min(11, e.limit || 11), driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(edge, lane.idx, s, [[then, turn === "left" ? 0 : Math.min(lane.idx, next.lanes - 1)]]); fleet.vehicles.push(car);
    return car.id;
  });
}

// Cars on the through road, each from its `start` ([edge, s, edges before the approach's own]) going
// straight on at up to 10 m/s. (The blind corner, and After midnight.)
export function releaseThrough(world, fleet, cars) {
  const map = world.map;
  return cars.map(({ id, start: [edge, s, through], then }, i) => {
    const e = map.edges.get(edge), lane = map.lane(edge, e.lanes - 1), v = Math.min(10, e.limit || 10);
    const plan = [...through, then].map(id => [id, map.edges.get(id).lanes - 1]);
    const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
    Object.assign(car, { id, color: [0x9b1e1e, 0x2b3a55][i % 2], v0: v, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.6, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(edge, lane.idx, s, plan); fleet.vehicles.push(car);
    return car.id;
  });
}
