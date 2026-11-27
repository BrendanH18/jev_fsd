// "Rush hour on West 4th": the compound drive (ROADMAP 9.3). One drive of about 830 m east along West
// 4th Avenue in Kitsilano and up Maple Street, through five situations the single challenges teach one at
// a time, in the order the street brings them:
//
//  1. a driver closes up behind in the curb lane (sim/tailgaters.js), with no lane to move right into;
//  2. the light at Vine Street turns amber AMBER_IN_S after the start (sim/amber.js, its plan
//     unchanged), with that driver still behind: where the car is by then, and so whether it has room
//     to stop gently or must go on, depends on how it has driven so far. The tailgater turns off
//     down Vine Street;
//  3. past Yew Street a bus stands at its stop and signals to pull out (sim/bus.js, placed as
//     "Pulling out" places its bus);
//  4. the route turns left at the Maple Street lights across two oncoming cars (shared/kit.js
//     `releaseOncoming`), from the left lane, so the car changes lanes on the block before;
//  5. Maple Street comes to its stop sign at West 3rd Avenue, whose traffic does not stop
//     (`releaseThrough`), and the drive ends on the block beyond.
//
// Only existing world features are switched on (tailgaters, amber lights, following distance), and every
// actor is placed with a part an existing challenge uses; nothing here changes how anything drives.
// A compound drive is authored and plays like a challenge but is listed apart from them
// (lab/challenges.js `COMPOUND_DRIVES`), so the sixty challenges, the road tests and the numbered suites stay as
// they are. What it measures, and why the tailgater leaves before the bus:
// docs/validation/compound-drive-2026-11-26.md.
import { routeFromLanes } from "../../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../../map/mapdata.js";
import { CAR, Vehicle } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory, approachPhase } from "../../sim/signals.js";
import { WEATHER } from "../../sim/weather.js";
import { getVehicleModel } from "../../sim/vehicle-models.js";
import { commitTailgater } from "../../sim/tailgaters.js";
import { ONCOMING_TRIGGER_M, releaseOncoming, releaseThrough } from "./shared/kit.js";
import { busStopFront } from "../../sim/bus.js";
import { placeBus } from "./bus-pulling-out.js";

export const challenge = {
  id: "rush-hour",
  compound: true,
  title: "Rush hour on West 4th",
  map: "kitsilano",
  weather: "dry",
  time: "17:00",
  seed: 63042,
  icon: "⛓",
  difficulty: "Compound drive",
  hazard: "compound",
  tailgaters: true,
  amberLights: true,
  followingDistance: true,
  limit_s: 300,
  street: "West 4th Avenue",
  description:
    "Drive about 830 m east along West 4th Avenue at 5 p.m. and turn left up Maple Street. A driver sits on your bumper as the Vine Street light goes stale, a bus is waiting to pull out past Yew Street, and the left turn at Maple crosses oncoming traffic before a stop sign at West 3rd Avenue.",
  lesson:
    "Each decision sets up the next one. With a driver close behind, hold a steady speed towards the green and decide once at the amber: stop gently if you still have room, otherwise keep going and clear the junction. Braking for a light that is still green leaves you too slow to clear and too close to stop. Ease off for the signalling bus, wait for a real gap before the left turn, and stop fully at the line on Maple Street before crossing.",
};

// The drive: West 4th Avenue eastbound from before Vine Street (e197) through Yew (e199) and Arbutus
// (e201) to the lights at Maple Street (e163), left up Maple (e436) to its stop sign at West 3rd Avenue,
// and on (e434).
const EDGES = ["e197", "e199", "e201", "e163", "e436", "e434"];
const STREETS = [
  "West 4th Avenue",
  "West 4th Avenue",
  "West 4th Avenue",
  "West 4th Avenue",
  "Maple Street",
  "Maple Street",
];
// The car starts START_S along the curb lane at START_MPS (in the weather's share of it), the
// tailgater GAP_M behind it; its light at Vine Street turns amber AMBER_IN_S after the start; the drive
// ends GOAL_S along the last block.
export const START_S = 28,
  START_MPS = 11,
  GAP_M = 7,
  AMBER_IN_S = 7,
  GOAL_S = 70;
// The bus is the one at the stop on the block after Yew Street; the oncoming cars come up West 4th
// Avenue westbound (OPPOSITE) and go straight on (OPPOSITE_ON); West 3rd Avenue's through traffic comes
// from the left (e312, going on along e314) and from the right (e315, going on along e313), `back` metres
// back from the junction when the car is STOP_TRIGGER_M from its stop line.
const BUS_EDGE = "e201",
  OPPOSITE = "e166",
  OPPOSITE_ON = "e164";
const THROUGH = [
  { id: "challenge_through_left", edge: "e312", back: 70, then: "e314" },
  { id: "challenge_through_right", edge: "e315", back: 105, then: "e313" },
];
// The tailgater turns right down Vine Street at the lights.
const TAILGATER_ON = ["e54"];
const STOP_TRIGGER_M = 40;

function chain(map) {
  return EDGES.map((id, i) => {
    const e = map.edges.get(id);
    if (e?.name !== STREETS[i] || (i && !map.successors(EDGES[i - 1]).includes(id)))
      throw new Error("The compound drive needs Kitsilano's West 4th Avenue from Vine Street to Maple Street.");
    const left = i + 1 < EDGES.length && map.classifyTurn(map.turnAngle(id, EDGES[i + 1])) === "left";
    return map.lane(id, e.lanes <= 1 || left ? 0 : e.lanes - 1);
  });
}

// The bus stop on the block: the first run that calls there, as "Pulling out" places its bus.
function busAt(map, edge) {
  for (const route of map.transit?.routes || [])
    if (route.mode !== "tram")
      for (const [run, r] of route.runs.entries()) {
        const stop = r.stops.find((s) => s.edge === edge),
          k = r.edges.indexOf(edge);
        const front =
          stop && k > 0 && r.edges[k - 1] === EDGES[EDGES.indexOf(edge) - 1] ? busStopFront(map, edge, stop.s) : null;
        if (front !== null) return { route: route.id, run, stop: stop.id, edge, front };
      }
  throw new Error("The compound drive needs the bus stop on West 4th Avenue past Yew Street.");
}

export function scenario(map, challenge) {
  const lanes = chain(map),
    first = lanes[0],
    signal = (id) => map.edges.get(id).control;
  if (signal("e197")?.type !== "signal" || signal("e163")?.type !== "signal" || signal("e436")?.type !== "stop")
    throw new Error("The compound drive needs the lights at Vine and Maple Streets and Maple's stop sign.");
  const route = routeFromLanes(map, lanes, START_S, GOAL_S);
  const p = pointAt(first.pts, first.cum, START_S);
  return {
    id: challenge.id,
    start: {
      edge: first.edge,
      lane: first.idx,
      s: START_S,
      x: p[0],
      y: p[1],
      psi: headingAt(first.pts, first.cum, START_S),
    },
    route,
    goal: route.polyline.at(-1),
    traffic_seed: challenge.seed,
    compound: {
      speed: START_MPS * WEATHER[challenge.weather].speed,
      tailgater: { edge: first.edge, lane: first.idx, gap: GAP_M, on: TAILGATER_ON },
      amber: { edge: "e197" },
      bus: busAt(map, BUS_EDGE),
      left: { approach: "e163", edge: OPPOSITE, then: OPPOSITE_ON },
      stop: {
        approach: "e436",
        cars: THROUGH.map((c) => ({ ...c, start: [c.edge, map.edges.get(c.edge).length - c.back, []] })),
      },
    },
    tags: {
      length_m: Math.round(cumulative(route.polyline).at(-1)),
      signals: lanes.filter((l) => l.edgeRef.control?.type === "signal").length,
      stops: lanes.filter((l) => l.edgeRef.control?.type === "stop").length,
      lefts: route.turns.filter((t) => t.dir === "left").length,
      rights: route.turns.filter((t) => t.dir === "right").length,
    },
  };
}

// The stop line of an approach, as a point on its lane `idx`.
function lineOf(map, edge, idx) {
  const e = map.edges.get(edge),
    lane = map.lane(edge, idx);
  return pointAt(lane.pts, lane.cum, (e.control.s_line * lane.length) / e.length);
}

function placeTailgater(world, fleet, scenario) {
  const { edge, lane: idx, gap, on } = scenario.compound.tailgater,
    map = world.map,
    lane = map.lane(edge, idx);
  const s = scenario.start.s - getVehicleModel("compact").spec.rearOverhang - gap - (CAR.length - CAR.rearOverhang);
  const p = pointAt(lane.pts, lane.cum, s);
  const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), scenario.compound.speed, CAR);
  Object.assign(car, {
    id: "challenge_tailgater",
    color: 0x1a1c20,
    v0: map.edges.get(edge).limit,
    driver: { aMax: 1.8, b: 2.4, s0: 2, T: 1.1, react: 0.5, lcRate: 1 },
    stopMem: new StopMemory(),
    path: new NpcPath(map, fleet.random),
    frozen: 0,
    waiting: 0,
    lcCooldown: 1e6,
  });
  car.path.start(
    edge,
    idx,
    s,
    on.map((id) => [id, map.edges.get(id).lanes - 1]),
  );
  fleet.vehicles.push(car);
  commitTailgater(world, car);
  return car.id;
}

export function install(world, fleet, _challenge, scenario) {
  const map = world.map,
    setup = scenario.compound;
  // (the clock set AMBER_IN_S before the car's light at Vine Street turns amber, its plan unchanged)
  const edge = map.edges.get(setup.amber.edge),
    inter = map.intersections.get(edge.control.id);
  const phase = inter.plan[edge.control.group],
    c = inter.plan.cycle;
  const onset = (((phase.start + phase.green - (inter.offset_s || 0)) % c) + c) % c;
  world.t = onset >= AMBER_IN_S ? onset - AMBER_IN_S : onset + c - AMBER_IN_S;
  if (
    approachPhase(inter, edge.id, world.t) !== "green" ||
    approachPhase(inter, edge.id, world.t + AMBER_IN_S + 0.05) !== "yellow"
  )
    throw new Error("The compound drive's light at Vine Street must turn amber on cue.");
  world.ego.v = setup.speed;
  const bus = placeBus(world, fleet, setup.bus);
  const state = world.challenge;
  Object.assign(state, {
    at: [inter.x, inter.y],
    compound: {
      tailgaterId: placeTailgater(world, fleet, scenario),
      amberAt: world.t + AMBER_IN_S,
      busId: bus.busId,
      bus: bus.at,
      left: { at: lineOf(map, setup.left.approach, 0), edge: setup.left.edge, then: setup.left.then },
      stop: { at: lineOf(map, setup.stop.approach, 0), cars: setup.stop.cars },
      stage: {},
    },
  });
}

// The stages, each set off once as the car comes to it: the tailgater closing up is the hazard event.
export function step(world, fleet) {
  const state = world.challenge,
    c = state.compound,
    front = world.ego.spec.length - world.ego.spec.rearOverhang;
  if (!state.triggered && world.tailgatersSeen) state.triggered = true;
  const within = (point, m) => {
    const local = world.ego.toLocal(...point);
    return local.ahead > 0 && local.ahead < m + front && Math.abs(local.right) < 12;
  };
  if (!c.stage.bus && c.bus && within(c.bus, ONCOMING_TRIGGER_M)) {
    c.stage.bus = world.t;
    const bus = c.busId && fleet.vehicles.find((v) => v.id === c.busId);
    if (bus && bus.transit.phase === "dwell") bus.transit.dwell = bus.transit.t;
  }
  if (!c.stage.left && within(c.left.at, ONCOMING_TRIGGER_M)) {
    c.stage.left = world.t;
    c.oncomingIds = releaseOncoming(world, fleet, c.left);
  }
  if (!c.stage.stop && within(c.stop.at, STOP_TRIGGER_M)) {
    c.stage.stop = world.t;
    c.throughIds = releaseThrough(world, fleet, c.stop.cars);
  }
}
