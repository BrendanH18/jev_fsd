// "Bridges freeze first": Saskatoon's Traffic Bridge over the South Saskatchewan River, northbound from
// Nutana toward downtown, at dawn after a clear night just below freezing. The approach is dry, but the
// deck (edge e572, 226 m, one lane each way, 50 km/h, on the map's bridges layer) has iced over: a
// patch of black ice (sim/black-ice.js) covers its northern half, ending a few metres short of the deck's
// end. Just past the bridge, traffic queues for the roundabout at 3rd Avenue South and Spadina
// Crescent: a car waits at the yield line, and the car ahead of the driven one, a local who knows the
// bridge, eases off for the ice and then stops behind it. A driver who comes onto the ice at the limit
// has to brake on it; one who slowed before the bridge, and again before the ice, stops on the dry
// road past it. The car starts moving, on the bridge's south approach, and its drive ends on 3rd Avenue
// South, short of the roundabout.
import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";
import { Vehicle } from "../sim/vehicle.js";
import { NpcPath } from "../sim/npc.js";
import { StopMemory } from "../sim/signals.js";
import { getVehicleModel } from "../sim/vehicle-models.js";
import { patchOn } from "../sim/black-ice.js";

// The route, lane by lane: the south approach, the deck, and 3rd Avenue South to the roundabout.
const CHAIN = ["e577", "e579", "e572", "e475"], DECK = "e572", START_S = 3, START_MPS = 11, GOAL_S = 9;
// The patch on the deck, in metres along it, and its grip.
export const ICE_PATCH = { from: 125, to: 212, mu: 0.11 };
// The car ahead, this far (bumper to bumper) ahead of the driven car at the start, at its speed; and
// the car waiting at the roundabout's yield line (on e473, the roundabout's approach), until the driven
// car has stood still behind the queue for QUEUE_HOLD_S, or QUEUE_MAX_S have passed.
const LEAD_GAP_M = 30, QUEUE_EDGE = "e473", QUEUE_S = 9, QUEUE_HOLD_S = 2, QUEUE_MAX_S = 45;

export function iceScenario(map, challenge) {
  const deck = map.edges.get(DECK);
  if (deck?.name !== challenge.street || deck.lanes !== 1 || deck.oneway || !CHAIN.every((id) => map.edges.has(id)) || !map.edges.has(QUEUE_EDGE)) throw new Error("Bridges freeze first needs Saskatoon's Traffic Bridge.");
  if (!(map.bridges || []).some((sp) => sp.edge === DECK)) throw new Error("Bridges freeze first needs Saskatoon's bridges layer.");
  const lanes = CHAIN.map((id) => map.lane(id, 0)), route = routeFromLanes(map, lanes, START_S, GOAL_S);
  const l = lanes[0], p = pointAt(l.pts, l.cum, START_S);
  return { id: challenge.id, start: { edge: CHAIN[0], lane: 0, s: START_S, x: p[0], y: p[1], psi: headingAt(l.pts, l.cum, START_S) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed, blackIce: { edge: DECK, ...ICE_PATCH },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 0, stops: 0, lefts: 0, rights: 0 } };
}

// A car on lane 0 of `edge`, `s` along it, at `v`, planned on along `planned` ([edge, lane] pairs).
function trafficCar(world, fleet, id, edge, s, v, planned, color) {
  const spec = getVehicleModel("compact").spec, lane = world.map.lane(edge, 0), p = pointAt(lane.pts, lane.cum, s);
  const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v, spec);
  Object.assign(car, { id, color, v0: 13.9, driver: { aMax: 1.3, b: 2, s0: 2.5, T: 1.6, react: 0.6, lcRate: 0 }, stopMem: new StopMemory(),
    path: new NpcPath(world.map, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
  car.path.start(edge, 0, s, planned);
  fleet.vehicles.push(car);
  return car;
}

// The ice on the deck, in place of the world's own; the car ahead; and the car waiting at the roundabout.
export function installIce(world, fleet, scenario) {
  const { edge, from, to, mu } = scenario.blackIce;
  const patch = patchOn(world.map, edge, from, to, { id: "challenge_ice", kind: "bridge", name: world.map.edges.get(edge).name, mu, shape: 55042 });
  world.ice.setList([patch]);
  // (the car ahead: LEAD_GAP_M ahead of the driven car's front, along the approach)
  const ego = world.ego.spec, leadSpec = getVehicleModel("compact").spec;
  let s = scenario.start.s + ego.length - ego.rearOverhang + LEAD_GAP_M + leadSpec.rearOverhang, k = 0;
  while (k < CHAIN.length - 1 && s > world.map.lane(CHAIN[k], 0).length) s -= world.map.lane(CHAIN[k++], 0).length;
  const lead = trafficCar(world, fleet, "challenge_ice_lead", CHAIN[k], s, START_MPS, [...CHAIN.slice(k + 1).map((id) => [id, 0]), [QUEUE_EDGE, 0]], 0x8a4f3d);
  const queue = trafficCar(world, fleet, "challenge_ice_queue", QUEUE_EDGE, QUEUE_S, 0, [], 0x52606e);
  queue.frozen = 1e9;
  world.ego.v = START_MPS;
  const mid = pointAt(patch.pts, patch.cum, patch.len / 2);
  Object.assign(world.challenge, { at: mid, blackIce: { patch: patch.id, leadId: lead.id, queueId: queue.id, stoppedAt: null, released: false } });
}

// The car waiting at the roundabout sets off once the driven car has stopped behind the queue, or in
// QUEUE_MAX_S at the latest.
export function stepIce(world, fleet) {
  const state = world.challenge.blackIce;
  // (the hazard: the car has come up to the ice)
  if (!world.challenge.triggered && world.iceSeen) world.challenge.triggered = true;
  if (state.released) return;
  state.stoppedAt = Math.abs(world.ego.v) < 0.1 ? state.stoppedAt ?? world.t : null;
  if ((state.stoppedAt != null && world.t - state.stoppedAt >= QUEUE_HOLD_S) || world.t >= QUEUE_MAX_S) {
    const queue = fleet.vehicles.find((v) => v.id === state.queueId);
    if (queue) queue.frozen = 0;
    state.released = true;
  }
}
