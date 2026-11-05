// Two ordinary traffic movements that make following room matter. NPCs still use
// the common car physics: the script changes a speed goal or starts a lane change.
import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";
import { Vehicle } from "../sim/vehicle.js";
import { NpcPath } from "../sim/npc.js";
import { StopMemory } from "../sim/signals.js";
import { WEATHER } from "../sim/weather.js";
import { getVehicleModel } from "../sim/vehicle-models.js";

export function followingScenario(map, challenge) {
  const braking = challenge.id === "brakes-ahead";
  const edge = map.edges.get(braking ? "e233" : "e165");
  const street = braking ? "West 6th Avenue" : "West 4th Avenue";
  if (edge?.name !== street || edge.lanes !== (braking ? 1 : 2)) throw new Error(`The following lessons need Kitsilano's ${street}.`);
  const lane = map.lane(edge.id, edge.lanes - 1), s = braking ? 30 : 20;
  const route = routeFromLanes(map, [lane], s, 230);
  const p = pointAt(lane.pts, lane.cum, s);
  return { id: challenge.id, start: { edge: edge.id, lane: lane.idx, s, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    following: { kind: braking ? "brake" : "merge", speed: braking ? 8.5 : 10, gap: braking ? 35 : 28 },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 0, stops: 0, lefts: 0, rights: 0 } };
}

export function installFollowing(world, fleet, scenario) {
  const spec = getVehicleModel("compact").spec, setup = scenario.following;
  const edge = world.map.edges.get(scenario.start.edge), lane = world.map.lane(edge.id, setup.kind === "merge" ? 0 : scenario.start.lane);
  const s = scenario.start.s + setup.gap + world.ego.spec.length - world.ego.spec.rearOverhang + spec.rearOverhang;
  const p = pointAt(lane.pts, lane.cum, s), car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), setup.speed, spec);
  const cruise = setup.speed / WEATHER[world.weather].speed;
  Object.assign(car, { id: "challenge_following_leader", color: 0x497b9b, v0: cruise,
    driver: { aMax: 1.5, b: 2, s0: 2, T: 1.5, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(),
    path: new NpcPath(world.map, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
  car.path.start(edge.id, lane.idx, s); fleet.vehicles.push(car);
  // Traffic beside the driven car makes this a lesson in rebuilding room in its
  // own lane. The other car is ordinary traffic, with no scripted speed changes.
  if (setup.kind === "merge") {
    const besideS = scenario.start.s - 2, besideP = pointAt(lane.pts, lane.cum, besideS);
    const beside = new Vehicle(besideP[0], besideP[1], headingAt(lane.pts, lane.cum, besideS), setup.speed, spec);
    Object.assign(beside, { id: "challenge_following_beside", color: 0x956247, v0: cruise,
      driver: { aMax: 1.5, b: 2, s0: 2, T: 1.5, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(),
      path: new NpcPath(world.map, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
    beside.path.start(edge.id, lane.idx, besideS); fleet.vehicles.push(beside);
  }
  world.ego.v = setup.speed;
  Object.assign(world.challenge, { at: p,
    following: { kind: setup.kind, carId: car.id, cruise, startsAt: world.t + (setup.kind === "brake" ? 3 : 1), released: false } });
}

export function stepFollowing(world, fleet) {
  const state = world.challenge, following = state.following;
  const car = fleet.vehicles.find(v => v.id === following.carId);
  if (!car) return;
  if (!state.triggered && world.t >= following.startsAt) {
    state.triggered = true; following.triggeredAt = world.t;
    if (following.kind === "brake") car.v0 = 0;
    else {
      const edge = world.map.edges.get(car.path.currentEdge().id);
      car.lc = { dir: 1, to: 1, edge: edge.id, width: Math.abs(edge.lane_offsets[1] - edge.lane_offsets[0]), t: 0, T: 3.5 };
    }
  }
  if (following.kind === "brake" && state.triggered && !following.released) {
    if (car.v < 0.05) following.stoppedAt ??= world.t;
    if (following.stoppedAt !== undefined && world.t - following.stoppedAt >= 4) {
      car.v0 = following.cruise; following.released = true;
    }
  }
  if (following.kind === "merge" && state.triggered && !following.released && !car.lc && car.path.currentEdge().lane === 1) {
    // Having joined the lane, the merger accelerates with the flow. It creates
    // one temporary loss of room, rather than a slow vehicle to overtake forever.
    car.v0 = world.map.edges.get(car.path.currentEdge().id).limit;
    following.released = true;
  }
}
