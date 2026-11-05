// "Find your gap": the Cunard Street approach to Halifax's North Park roundabout.
// Three cars already in the ring pass the entry before the driven car takes the third exit.
// Authored traffic uses ordinary NPC paths and physics; all mutable state lives in the fleet.
import { routeFromLanes } from "../demo/routing.js";
import { cumulative, headingAt, pointAt, projectPoint } from "../map/mapdata.js";
import { Vehicle, CAR } from "../sim/vehicle.js";
import { NpcPath } from "../sim/npc.js";
import { StopMemory } from "../sim/signals.js";

const START_M = 16, GOAL_M = 36, TRAFFIC_MPS = 4.5;
const TRAFFIC_BACK_M = [8, 23, 38];

export function roundaboutScenario(map, challenge) {
  const approach = map.edges.get("e300"), ring = map.roundabouts.get("rb0");
  if (!ring || approach?.control?.roundabout !== ring.id || approach.name !== "Cunard Street") throw new Error("Find your gap needs Halifax's Cunard Street roundabout approach.");
  const lane = map.lane(approach.id, 0), ids = ["e410", "e405", "e406", "e411", "e257"], exit = map.lane("e358", 1);
  if (ids.some(id => map.edges.get(id)?.ring !== ring.id) || exit?.edgeRef.name !== "North Park Street") throw new Error("Find your gap's third exit is missing from the map.");
  const s = approach.control.s_line * lane.length / approach.length - START_M - (CAR.length - CAR.rearOverhang);
  const route = routeFromLanes(map, [lane, ...ids.map(id => map.lane(id, 0)), exit], s, GOAL_M);
  const cum = cumulative(route.polyline), entry = map.nodes.get(approach.to);
  route.turns = [{ at_m: projectPoint(route.polyline, cum, [entry.x, entry.y]).s, dir: "roundabout", exit: 3, street: exit.edgeRef.name }];
  route.summary = `${Math.round(cum.at(-1))} m · third exit at the roundabout`;
  const p = pointAt(lane.pts, lane.cum, s);
  return { id: challenge.id, start: { edge: lane.edge, lane: lane.idx, s, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    roundabout: { id: ring.id, entry: approach.to, onward: [...ids.map(id => [id, 0]), [exit.edge, exit.idx]] },
    tags: { length_m: Math.round(cum.at(-1)), signals: 0, stops: 0, lefts: 0, rights: 0 } };
}

export function placeRoundaboutTraffic(world, fleet, spec) {
  const map = world.map, ring = map.roundabouts.get(spec.id), entry = map.nodes.get(spec.entry);
  const carIds = TRAFFIC_BACK_M.map((back, k) => {
    let node = spec.entry, remaining = back, edge, lane;
    const before = [];
    do {
      edge = ring.edges.map(id => map.edges.get(id)).find(e => e.to === node);
      lane = map.lane(edge.id, 0); before.unshift(edge.id); node = edge.from;
      if (remaining <= lane.length) break;
      remaining -= lane.length;
    } while (before.length <= ring.edges.length);
    const s = lane.length - remaining, p = pointAt(lane.pts, lane.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), TRAFFIC_MPS);
    Object.assign(car, { id: `challenge_ring_${k + 1}`, color: [0x6b2737, 0x3d5a80, 0xb0b5b9][k], v0: TRAFFIC_MPS,
      driver: { aMax: 1.2, b: 2, s0: 2, T: 1.3, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(),
      path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(edge.id, 0, s, [...before.slice(1).map(id => [id, 0]), ...spec.onward]);
    fleet.vehicles.push(car); return car.id;
  });
  return { ringCarIds: carIds, at: [entry.x, entry.y], triggered: true };
}
