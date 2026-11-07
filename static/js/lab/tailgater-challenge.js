// "On your bumper": William Avenue in Winnipeg's Exchange District (e481, eastbound, two lanes each way,
// 50 km/h), a straight half-kilometre up to its signal at Isabel Street (sig16, its plan unchanged). The
// driven car sets off in the left lane at 40 km/h; an ordinary car in a hurry comes up behind it in that
// lane and tailgates it (sim/tailgaters.js), a little over half a second back. The right lane is empty,
// so the car can move over and let it by. Later the light ahead turns amber, with room to stop gently:
// a car still being tailgated must brake early and gently, never hard.
import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";
import { CAR, Vehicle } from "../sim/vehicle.js";
import { NpcPath } from "../sim/npc.js";
import { StopMemory, approachPhase } from "../sim/signals.js";
import { getVehicleModel } from "../sim/vehicle-models.js";
import { commitTailgater } from "../sim/tailgaters.js";

const EDGE = "e481", EXIT = "e343";
// The car starts START_S along the left lane at START_MPS, the tailgater GAP_M behind it at the same
// speed; the car's light turns amber AMBER_IN_S after the start (about 60 m short of its line at the
// limit); the route ends GOAL_S along the street past the junction.
export const START_S = 40, START_MPS = 11, GAP_M = 12, AMBER_IN_S = 28, GOAL_S = 60;

export function tailgaterScenario(map, challenge) {
  const edge = map.edges.get(EDGE), exit = map.edges.get(EXIT);
  if (edge?.name !== challenge.street || exit?.name !== edge.name || edge.lanes !== 2 || exit.lanes !== 2 || edge.control?.type !== "signal")
    throw new Error("The tailgater lesson needs Winnipeg's William Avenue, two lanes each way up to its signal at Isabel Street.");
  const lane = map.lane(edge.id, 0), onward = map.lane(exit.id, 0);
  const route = routeFromLanes(map, [lane, onward], START_S, GOAL_S);
  const p = pointAt(lane.pts, lane.cum, START_S);
  return { id: challenge.id, start: { edge: edge.id, lane: lane.idx, s: START_S, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, START_S) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    tailgater: { edge: edge.id, exit: exit.id, lane: lane.idx, gap: GAP_M, speed: START_MPS, signal: edge.control.id },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 1, stops: 0, lefts: 0, rights: 0 } };
}

export function installTailgater(world, fleet, scenario) {
  const setup = scenario.tailgater, map = world.map, edge = map.edges.get(setup.edge), inter = map.intersections.get(setup.signal);
  // (the clock set AMBER_IN_S before the car's light turns amber)
  const phase = inter.plan[edge.control.group], c = inter.plan.cycle;
  const onset = ((phase.start + phase.green - (inter.offset_s || 0)) % c + c) % c;
  world.t = onset >= AMBER_IN_S ? onset - AMBER_IN_S : onset + c - AMBER_IN_S;
  if (approachPhase(inter, edge.id, world.t + AMBER_IN_S - 0.05) !== "green" || approachPhase(inter, edge.id, world.t + AMBER_IN_S + 0.05) !== "yellow")
    throw new Error("The tailgater lesson's light must turn amber on cue.");
  const lane = map.lane(edge.id, setup.lane), front = CAR.length - CAR.rearOverhang;
  const s = scenario.start.s - getVehicleModel("compact").spec.rearOverhang - setup.gap - front;
  const p = pointAt(lane.pts, lane.cum, s);
  const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), setup.speed, CAR);
  Object.assign(car, { id: "challenge_tailgater", color: 0x1a1c20, v0: edge.limit,
    driver: { aMax: 1.8, b: 2.4, s0: 2, T: 1.1, react: 0.5, lcRate: 1 }, stopMem: new StopMemory(),
    path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
  car.path.start(edge.id, setup.lane, s, [[setup.exit, setup.lane]]);
  fleet.vehicles.push(car);
  commitTailgater(world, car);
  world.ego.v = setup.speed;
  Object.assign(world.challenge, { at: [inter.x, inter.y], tailgater: { carId: car.id, amberAt: world.t + AMBER_IN_S } });
}

// The hazard is the tailgater closing up: it triggers once it is close behind the car.
export function stepTailgater(world) {
  const state = world.challenge;
  if (!state.triggered && world.tailgatersSeen) state.triggered = true;
}
