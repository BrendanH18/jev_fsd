// Move over: a street with two or more lanes going the car's way and a parking lane on the right,
// whose limit the rule brings down (above 40 km/h, under 80), going straight on into a street with as
// many lanes, with no marked crosswalk on it. A tow truck stands at its right curb, its front
// TOW_CLEAR_M short of the street's end (or its stop line), with the car it is about to tow parked
// OPERATOR_GAP_M behind it and its operator between them, on the traffic side. The car starts in the
// curb lane with its front ROADSIDE_START_M behind the truck's rear. Once its front is
// OPERATOR_TRIGGER_M from the operator they step out, without looking, into the curb lane, to
// OPERATOR_OUT_M right of its centre, stand there for OPERATOR_PAUSE_S and step back. In the lane
// beside it the car is clear of them; in the curb lane at 40 km/h it can stop for them, at 50 it cannot.
import { CAR, TOW_TRUCK } from "../../sim/vehicle.js";
import { Pedestrian } from "../../sim/pedestrians.js";
import { SLOW_FAST_MPS, SLOW_MPS, curbOffset, endsOf } from "../../sim/roadside.js";
import { frontWithin, laneScenario, pick, releasePedestrian, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "move-over",
  title: "Move over",
  map: "winnipeg",
  weather: "dry",
  time: "afternoon",
  seed: 17042,
  icon: "⚠",
  difficulty: "Courtesy",
  hazard: "roadside",
  street: "Princess Street",
  description:
    "A tow operator is working beside a stopped vehicle with amber lights flashing on Princess Street. You're in the lane beside the work.",
  lesson:
    "Reduce speed before you reach the people working at the kerb. In this BC drive, the reduced speed is 40 km/h where the posted limit is under 80. Check the neighbouring lane and move over if it's safe.",
};

const TOW_CLEAR_M = 25,
  ROADSIDE_START_M = 76,
  OPERATOR_GAP_M = 1.6,
  OPERATOR_TRIGGER_M = 16,
  OPERATOR_OUT_M = 0.4,
  OPERATOR_PAUSE_S = 3,
  OPERATOR_MPS = 1.3;
const roadsideSiteCache = new WeakMap();
function roadsideSites(map, street) {
  if (!roadsideSiteCache.has(map)) {
    const sites = [];
    for (const e of map.edges.values()) {
      if (
        e.ring ||
        e.lanes < 2 ||
        !(e.parking?.[1] >= 1.8) ||
        e.limit <= SLOW_MPS + 1 ||
        e.limit >= SLOW_FAST_MPS + 10 / 3.6
      )
        continue;
      if ((map.crosswalks || []).some((c) => c.edge === e.id)) continue;
      const straight = map
        .successors(e.id)
        .find(
          (id) =>
            map.classifyTurn(map.turnAngle(e.id, id)) === "straight" &&
            map.edges.get(id).lanes >= e.lanes &&
            !map.edges.get(id).ring,
        );
      const L = e.cum.at(-1),
        to = Math.min(L, e.control?.s_line ?? L) - TOW_CLEAR_M,
        from = to - (TOW_TRUCK.length + CAR.length + OPERATOR_GAP_M + 0.4);
      const lane = map.lane(e.id, e.lanes - 1),
        scale = lane.length / Math.max(1, L);
      const startS = (to - 0.2 - TOW_TRUCK.length - ROADSIDE_START_M) * scale - (CAR.length - CAR.rearOverhang);
      if (!straight || startS < 4) continue;
      sites.push({ lane, startS, stop: { edge: e.id, from, to } });
    }
    sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
    roadsideSiteCache.set(map, sites);
  }
  const sites = roadsideSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const roadside = pick(
      roadsideSites(map, challenge.street),
      random,
      "This map has no street with two lanes going one way, a parking lane on the right and a limit between 40 and 80 km/h.",
    );
    return { lane: roadside.lane, startS: roadside.startS, fields: { roadside: roadside.stop } };
  });

// The tow truck at the curb, lights flashing, the car it is about to tow parked behind it, and its
// operator between the two, at the traffic side, about to step out into the curb lane (see
// roadsideSites).
function placeTowTruck(world, { edge, from, to }, seed) {
  const e = world.map.edges.get(edge),
    stop = world.roadside.place({ edge, from, to, kind: "tow_truck", gap: OPERATOR_GAP_M, color: 0x6b7f8c });
  const truck = stop.vehicle,
    h = truck.psi,
    { rear } = endsOf(truck);
  const at = (back, right) => [
    rear[0] - Math.cos(h) * back + Math.sin(h) * right,
    rear[1] - Math.sin(h) * back - Math.cos(h) * right,
  ];
  const toLane = e.lane_offsets[e.lanes - 1] - curbOffset(e, TOW_TRUCK);
  const start = at(OPERATOR_GAP_M / 2, -(TOW_TRUCK.width / 2 - 0.4)),
    out = at(OPERATOR_GAP_M / 2, toLane + OPERATOR_OUT_M);
  const ped = new Pedestrian({
    id: "challenge_operator",
    x: start[0],
    y: start[1],
    psi: Math.atan2(out[1] - start[1], out[0] - start[0]),
    v: 0,
    speed: OPERATOR_MPS,
    dart: true,
    worker: true,
    path: [{ p: out, cross: { node: null, from: start, to: out, jaywalk: true } }, { p: start }],
    crossing: null,
    waiting: 0,
    phase: 0,
    look: seed,
    at: null,
  });
  ped.frozen = 1e6;
  world.crowd.list.push(ped);
  return { pedestrianId: ped.id, roadsideId: truck.id, at: start };
}

export function install(world, _fleet, challenge, scenario) {
  Object.assign(world.challenge, placeTowTruck(world, scenario.roadside, challenge.seed));
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: frontWithin(OPERATOR_TRIGGER_M),
    release: (world, _fleet, state) => releasePedestrian(world, state),
    // (the tow truck's operator stands in the lane a moment before stepping back)
    follow: (world, _fleet, state) => {
      const ped = state.pedestrianId && world.crowd.list.find((p) => p.id === state.pedestrianId);
      if (ped && state.triggered && !state.paused && ped.path.length === 1) {
        state.paused = true;
        ped.frozen = OPERATOR_PAUSE_S;
      }
    },
  });
