// "Fresh green": 106 Street NW at Whyte Avenue NW in Edmonton (sig3, its signal plan unchanged). The
// driven car waits at the red on 106 Street NW, heading south. Its light turns green while a car on
// Whyte Avenue NW, coming from its left in the near lanes, runs its fresh red across the junction
// (sim/red-light-runner.js). The runner is ordinary traffic committed to running the light: it holds
// its speed, and still stops for anything already in its path.
import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";
import { CAR, Vehicle } from "../sim/vehicle.js";
import { NpcPath } from "../sim/npc.js";
import { StopMemory, approachPhase } from "../sim/signals.js";
import { getVehicleModel } from "../sim/vehicle-models.js";
import { commitRunner } from "../sim/red-light-runner.js";

const SIGNAL = "sig3", EGO_EDGE = "e220", EGO_EXIT = "e367", RUNNER_EDGE = "e309", RUNNER_EXIT = "e316";
// The car's light turns green this long after the start, and the runner's front crosses its line this
// long after that, at about Whyte Avenue's 40 km/h limit.
export const GREEN_IN_S = 3;
export const RUN_AFTER_S = 1;
export const RUNNER_MPS = 11;

export function freshGreenScenario(map, challenge) {
  const edge = map.edges.get(EGO_EDGE), exit = map.edges.get(EGO_EXIT), cross = map.edges.get(RUNNER_EDGE);
  if (edge?.name !== challenge.street || exit?.name !== edge.name || cross?.name !== "Whyte Avenue NW" || edge.control?.id !== SIGNAL || cross.control?.id !== SIGNAL
    || edge.control.group === cross.control.group) throw new Error("The fresh-green lesson needs Edmonton's 106 Street NW signal at Whyte Avenue NW.");
  const lane = map.lane(edge.id, edge.lanes - 1), onward = map.lane(exit.id, exit.lanes - 1);
  // (stopped with its front bumper 1.5 m short of the line: compact car, as setupChallenge drives)
  const spec = getVehicleModel("compact").spec, front = spec.length - spec.rearOverhang;
  const s = edge.control.s_line * lane.length / edge.length - 1.5 - front;
  const route = routeFromLanes(map, [lane, onward], s, 100);
  const p = pointAt(lane.pts, lane.cum, s);
  return { id: challenge.id, start: { edge: edge.id, lane: lane.idx, s, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    freshGreen: { signal: SIGNAL, edge: edge.id, runner: { edge: cross.id, exit: RUNNER_EXIT, lane: cross.lanes - 1, speed: RUNNER_MPS } },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 1, stops: 0, lefts: 0, rights: 0 } };
}

export function installFreshGreen(world, fleet, scenario) {
  const setup = scenario.freshGreen, map = world.map, inter = map.intersections.get(setup.signal);
  const edge = map.edges.get(setup.edge), plan = inter.plan, c = plan.cycle;
  // (the clock set GREEN_IN_S before the car's group turns green)
  const onset = ((plan[edge.control.group].start - (inter.offset_s || 0)) % c + c) % c;
  world.t = onset >= GREEN_IN_S ? onset - GREEN_IN_S : onset + c - GREEN_IN_S;
  if (approachPhase(inter, edge.id, world.t) !== "red" || approachPhase(inter, edge.id, world.t + GREEN_IN_S + 0.05) !== "green") throw new Error("The fresh-green lesson must start on red, just before green.");
  const r = setup.runner, cross = map.edges.get(r.edge), lane = map.lane(r.edge, r.lane);
  const spec = CAR, front = spec.length - spec.rearOverhang;
  const s = cross.control.s_line * lane.length / cross.length - front - r.speed * (GREEN_IN_S + RUN_AFTER_S);
  const p = pointAt(lane.pts, lane.cum, s);
  const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), r.speed, spec);
  Object.assign(car, { id: "challenge_runner", color: 0xb91c1c, v0: r.speed,
    driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(),
    path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
  car.path.start(r.edge, r.lane, s, [[r.exit, Math.min(r.lane, map.edges.get(r.exit).lanes - 1)]]);
  fleet.vehicles.push(car);
  commitRunner(world, car, r.edge, setup.signal);
  world.ego.v = 0;
  Object.assign(world.challenge, { at: [inter.x, inter.y], freshGreen: { greenAt: world.t + GREEN_IN_S, runnerId: car.id } });
}

// The hazard is the green itself: it triggers when the car's light changes.
export function stepFreshGreen(world) {
  const state = world.challenge;
  if (!state.triggered && world.t >= state.freshGreen.greenAt) state.triggered = true;
}
