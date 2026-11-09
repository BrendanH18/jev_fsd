// "Follow the officer": Spadina Avenue northbound up to Bloor Street West, in Toronto's Annex (sig7, its
// plan unchanged), where a police officer is directing traffic in the middle of the junction
// (sim/traffic-officer.js), a cruiser with its lights on beside it. The driven car sets off up Spadina
// Avenue about 80 m short of the line, at the 30 km/h of the school zone it starts in, on a green, and the
// officer is waving Bloor through, against Bloor's red: the car must stop at the line on its green and wait. The officer keeps Bloor moving
// until the car's light has turned red, then holds everyone, and waves Spadina through: the car must go on
// its red, straight on up Spadina Road. Cars on Bloor go through on their red while it is held, and one
// arriving once Spadina is waved stops on its green.
import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";
import { CAR, Vehicle } from "../sim/vehicle.js";
import { NpcPath } from "../sim/npc.js";
import { StopMemory, approachPhase } from "../sim/signals.js";
import { placeOfficer } from "../sim/traffic-officer.js";

// Spadina Avenue northbound (one-way carriageway, then its approach to Bloor), and Spadina Road beyond.
const APPROACH = ["e177", "e344"], EXIT = ["e221", "e218", "e262"], SIGNAL = "sig7";
// Bloor Street West, eastbound and westbound, up to and past the junction.
const EAST = ["e182", "e336", "e388", "e184", "e390", "e264"], WEST = ["e369", "e265", "e391", "e185", "e389", "e337"];
// The car starts START_S along the first street at START_MPS, GREEN_S after its light turned green; the
// officer waves Bloor until HOLD_S after the start (the car's light red by then, Bloor's green); the route
// ends GOAL_S along Spadina Road's third stretch. Cars come along Bloor at TRAFFIC (seconds after the start, which way,
// how far along its first street, at what speed).
export const START_S = 4, START_MPS = 8, GOAL_S = 30, HOLD_S = 29, GREEN_S = 6;
export const TRAFFIC = [[2, "east", 5, 10], [6, "west", 5, 10], [26, "east", 5, 10]];

export function officerScenario(map, challenge) {
  const edges = APPROACH.map((id) => map.edges.get(id)), exits = EXIT.map((id) => map.edges.get(id)), approach = edges.at(-1);
  if (edges.some((e) => e?.name !== "Spadina Avenue") || exits.some((e) => e?.name !== "Spadina Road") || approach.control?.type !== "signal" || approach.control.id !== SIGNAL
    || ![...EAST, ...WEST].every((id) => map.edges.get(id)?.name === "Bloor Street West"))
    throw new Error("The officer lesson needs Toronto's Spadina Avenue up to its signal at Bloor Street West.");
  // (the one-way carriageway's right lane runs on into the approach's left lane, the lanes beside it added on
  // its right, and on into Spadina Road's left lane)
  const lanes = [...APPROACH.slice(0, -1).map((id) => map.lane(id, map.edges.get(id).lanes - 1)), map.lane(approach.id, 0), ...EXIT.map((id) => map.lane(id, 0))];
  const route = routeFromLanes(map, lanes, START_S, GOAL_S);
  const first = lanes[0], p = pointAt(first.pts, first.cum, START_S);
  return { id: challenge.id, start: { edge: first.edge, lane: first.idx, s: START_S, x: p[0], y: p[1], psi: headingAt(first.pts, first.cum, START_S) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    officer: { signal: SIGNAL, approach: approach.id, cross: EAST[3] },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 1, stops: 0, lefts: 0, rights: 0 } };
}

// The first time from `t` (within a cycle) that `edge`'s light turns from red to green.
function greenOnset(inter, edge, t) {
  for (let k = 1; k <= inter.plan.cycle * 10; k++) {
    const at = t + k / 10;
    if (approachPhase(inter, edge, at - 0.1) !== "green" && approachPhase(inter, edge, at) === "green") return at;
  }
  return null;
}

export function installOfficer(world, fleet, scenario) {
  const setup = scenario.officer, map = world.map, inter = map.intersections.get(setup.signal);
  // (the clock GREEN_S into the car's green)
  world.t = greenOnset(inter, setup.approach, 0) + GREEN_S;
  const holdUntil = world.t + HOLD_S;
  if (approachPhase(inter, setup.approach, world.t + 15) !== "green" || approachPhase(inter, setup.approach, holdUntil) !== "red" || approachPhase(inter, setup.cross, holdUntil) !== "green"
    || approachPhase(inter, setup.cross, world.t + 15) !== "red")
    throw new Error("The officer lesson's lights must cycle on cue.");
  // (no other officer turns up: this is the one)
  world.officers.next = Infinity;
  placeOfficer(world, setup.signal, { phase: map.edges.get(setup.cross).control.group, holdUntil });
  world.ego.v = START_MPS;
  Object.assign(world.challenge, { at: [inter.x, inter.y], officer: { start: world.t, traffic: TRAFFIC.map((t) => [...t]), placed: 0 } });
}

// A car on Bloor, `way` "east" or "west", `s` along its first street at `v`.
function bloorCar(world, fleet, way, s, v, n) {
  const map = world.map, ids = way === "east" ? EAST : WEST, lane = map.lane(ids[0], map.edges.get(ids[0]).lanes - 1), p = pointAt(lane.pts, lane.cum, s);
  const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v, CAR);
  Object.assign(car, { id: `challenge_bloor_${n}`, color: [0x8d9299, 0x2b3a55, 0x9b1e1e][n % 3], v0: map.edges.get(ids[0]).limit,
    driver: { aMax: 1.6, b: 2.2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(),
    path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
  car.path.start(ids[0], lane.idx, s, ids.slice(1).map((id) => [id, map.edges.get(id).lanes - 1]));
  fleet.vehicles.push(car);
  return car;
}

// The traffic on Bloor, on cue; the hazard triggers once the car has come up to the officer.
export function stepOfficerChallenge(world, fleet) {
  const state = world.challenge, o = state.officer;
  while (o.placed < o.traffic.length && world.t - o.start >= o.traffic[o.placed][0]) {
    const [, way, s, v] = o.traffic[o.placed];
    bloorCar(world, fleet, way, s, v, ++o.placed);
  }
  if (!state.triggered && world.officersSeen) state.triggered = true;
}
