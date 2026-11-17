// Blind left: a left turn on a green, as for the unprotected left (shared/kit.js oncomingSites), but
// the approach opposite has two lanes or more, and a left turn of its own (onto a street at least 30 m
// long), on the street the challenge names. A delivery van waits in the junction to turn left from the
// opposite approach's leftmost lane, its front BLIND_VAN_M short of the junction's centre (as traffic
// waits there), its indicator on. With the car 45 m from its own line, a car sets off BLIND_CAR_M
// before the opposite approach's line in the lane beside the van, at BLIND_CAR_MPS, straight on
// through; beyond what the car can see at first, and then hidden behind the van. BLIND_TURN_S after it
// is BLIND_PAST_M past the junction's centre (or BLIND_MAX_S after setting off, whatever happens), the
// van turns.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, DELIVERY_VAN } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";
import { ONCOMING_TRIGGER_M, laneScenario, oncomingSites, pick, reach, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "blind-left",
  title: "Blind left",
  map: "kitsilano",
  weather: "dry",
  time: "afternoon",
  seed: 27042,
  icon: "◐",
  difficulty: "Sight lines",
  hazard: "hidden-left",
  hidden: true,
  street: "West 4th Avenue",
  description:
    "A left turn on a green on West 4th Avenue. A van on the other side of the junction is waiting to turn left too, and the lane beside it is hidden behind it.",
  lesson:
    "A vehicle waiting to turn left opposite you can hide traffic coming straight through in the lane beside it. Don't turn until you can see that lane is clear: wait in the junction, and go once you can see that nothing is coming.",
};

const BLIND_VAN_M = 5;
const BLIND_CAR_M = 75;
const BLIND_CAR_MPS = 12.5;
const BLIND_PAST_M = 10;
const BLIND_TURN_S = 1;
const BLIND_MAX_S = 30;

const blindLeftSites_ = new WeakMap();
function blindLeftSites(map, street) {
  const cache = blindLeftSites_.get(map) || blindLeftSites_.set(map, new Map()).get(map);
  if (cache.has(street)) return cache.get(street);
  const sites = oncomingSites(map).flatMap((site) => {
    const o = map.edges.get(site.opposite);
    const turn = map
      .successors(site.opposite)
      .find((id) => map.classifyTurn(map.turnAngle(site.opposite, id)) === "left" && map.edges.get(id).length > 30);
    return o.lanes >= 2 && turn && site.lane.edgeRef.name === street && o.name === street
      ? [{ ...site, turnLeft: turn }]
      : [];
  });
  cache.set(street, sites);
  return sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const left = pick(
      blindLeftSites(map, challenge.street),
      random,
      "This map has no signalled left turn opposite one with two lanes or more and a left turn of its own.",
    );
    return {
      lane: left.lane,
      startS: left.lane.edgeRef.control.s_line - 70,
      through: [map.lane(left.left, 0)],
      fields: { blindLeft: { edge: left.opposite, turn: left.turnLeft, straight: left.straight } },
    };
  });

function placeBlindLeft(world, fleet, { edge, turn, straight }) {
  const map = world.map,
    lane = map.lane(edge, 0),
    L = lane.cum[lane.cum.length - 1];
  const s = L - BLIND_VAN_M - (DELIVERY_VAN.length - DELIVERY_VAN.rearOverhang),
    p = pointAt(lane.pts, lane.cum, s);
  const van = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0, DELIVERY_VAN);
  Object.assign(van, {
    id: "challenge_van",
    kind: "delivery_van",
    color: 0xeeeeea,
    v0: 9,
    signal: "left",
    driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.6, lcRate: 0 },
    stopMem: new StopMemory(),
    path: new NpcPath(map, fleet.random),
    frozen: 1e6,
    waiting: 0,
  });
  van.path.start(edge, 0, s, [[turn, 0]]);
  fleet.vehicles.push(van);
  return { vanId: van.id, blindLeft: { edge, turn, straight } };
}
function releaseHidden(world, fleet, { edge, straight: then }) {
  const map = world.map,
    e = map.edges.get(edge);
  const lane = map.lane(edge, 1),
    s = Math.max(2, (e.control.s_line * lane.length) / Math.max(1, e.length) - BLIND_CAR_M),
    p = pointAt(lane.pts, lane.cum, s);
  const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), BLIND_CAR_MPS);
  Object.assign(car, {
    id: "challenge_hidden",
    color: 0x9b1e1e,
    v0: BLIND_CAR_MPS,
    driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5, lcRate: 0 },
    stopMem: new StopMemory(),
    path: new NpcPath(map, fleet.random),
    frozen: 0,
    waiting: 0,
  });
  car.path.start(edge, 1, s, [[then, Math.min(1, map.edges.get(then).lanes - 1)]]);
  fleet.vehicles.push(car);
  return car.id;
}

export function install(world, fleet, _challenge, scenario) {
  Object.assign(world.challenge, placeBlindLeft(world, fleet, scenario.blindLeft));
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: reach(ONCOMING_TRIGGER_M),
    release: (world, fleet, state) => {
      state.hiddenCarId = releaseHidden(world, fleet, state.blindLeft);
    },
    // (once the hidden car is through the junction, BLIND_TURN_S later the van turns left)
    follow: (world, fleet, state) => {
      if (!state.blindLeft || !state.triggered || state.released) return;
      const car = fleet.vehicles.find((v) => v.id === state.hiddenCarId),
        van = fleet.vehicles.find((v) => v.id === state.vanId);
      const node = world.map.nodes.get(world.map.edges.get(state.blindLeft.edge).to);
      if (!car || (car.x - node.x) * Math.cos(car.psi) + (car.y - node.y) * Math.sin(car.psi) > BLIND_PAST_M)
        state.passedAt ??= world.t;
      state.setOff ??= world.t;
      if (
        (state.passedAt !== undefined && world.t - state.passedAt >= BLIND_TURN_S) ||
        world.t - state.setOff >= BLIND_MAX_S
      ) {
        state.released = true;
        if (van) van.frozen = 0;
      }
    },
  });
