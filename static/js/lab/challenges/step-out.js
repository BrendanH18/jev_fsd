// Between the cars: hidden hazards on (sim/hidden-hazards.js). A straight block of a quiet two-way street
// with one lane each way, a parking lane on the right, a limit of 40 km/h or more and no school or
// playground zone, its right kerb lined with cars STEP_GAP_M apart (bumper to bumper) from STEP_ROW_M[0]
// before the child's line to STEP_ROW_M[1] past it, wherever one may park; the child stands hidden
// between two of them, STEP_HIDE_M in from their traffic side. The car starts from a standstill in its
// lane, its front STEP_START_M short of the child's line; the route ends STEP_PAST_M past it, on its
// street. Once the car's front is STEP_OUT_M from their line, they step out and walk across the street
// at STEP_MPS without looking: at the blind-spot speed the car stops short of them, at the street's 50 it
// cannot.
// (On the challenge's `street`, where it has a block long enough.)
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, CAR } from "../../sim/vehicle.js";
import { Pedestrian } from "../../sim/pedestrians.js";
import { curbOffset } from "../../sim/roadside.js";
import { legalStretches, straight as straightKerb } from "../../sim/parallel-park.js";
import { QUIET, STEP_OUT_M } from "../../sim/hidden-hazards.js";
import { rng } from "../../common.js";
import { frontWithin, laneScenario, pick, releasePedestrian, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "step-out",
  title: "Between the cars",
  map: "kitsilano",
  weather: "dry",
  time: "afternoon",
  seed: 26042,
  icon: "⁞",
  difficulty: "Sight lines",
  hazard: "step-out",
  hidden: true,
  street: "Stephens Street",
  description:
    "A quiet street in Kitsilano, lined with parked cars on your side. The limit is 50 km/h, and you can't see the sidewalk behind them.",
  lesson:
    "Cars parked at the kerb hide whoever is behind them, and a child can step out from between two of them before you can see them. Beside parked cars on a quiet street, drive at a speed you can stop from in the distance you can see: about 30 km/h on a dry road, slower in rain or snow. Driver's handbooks across Canada say the same.",
};

const STEP_START_M = 110,
  STEP_ROW_M = [55, 25],
  STEP_GAP_M = 1.6,
  STEP_HIDE_M = 0.6,
  STEP_PAST_M = 30,
  STEP_MPS = 1.5;
const stepSiteCache = new WeakMap();
function stepOutSites(map, street) {
  if (!stepSiteCache.has(map)) {
    const sites = [],
      front = CAR.length - CAR.rearOverhang,
      crossed = new Set((map.crosswalks || []).map((c) => c.edge));
    for (const e of map.edges.values()) {
      if (
        !e.parking?.[1] ||
        e.ring ||
        e.oneway ||
        e.lanes !== 1 ||
        !QUIET.has(e.cls) ||
        (e.limit || 0) < 40 / 3.6 - 0.1 ||
        crossed.has(e.id) ||
        map.zoneSpans.get(e.id)?.length
      )
        continue;
      const at = STEP_START_M + front + 4,
        lo = at - STEP_ROW_M[0],
        hi = at + STEP_ROW_M[1];
      if (at + STEP_PAST_M > (e.control?.s_line ?? e.length) - 4) continue;
      if (!legalStretches(map, e).some(([a, b]) => a <= lo && b >= hi) || !straightKerb(e, lo - 2, hi + 2)) continue;
      const lane = map.lane(e.id, e.lanes - 1),
        k = lane.length / e.length;
      sites.push({
        lane,
        startS: (at - STEP_START_M - front) * k,
        goalS: (at + STEP_PAST_M) * k,
        stepOut: { edge: e.id, at },
      });
    }
    sites.sort((x, y) => String(x.stepOut.edge).localeCompare(String(y.stepOut.edge)));
    stepSiteCache.set(map, sites);
  }
  const sites = stepSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const step = pick(
      stepOutSites(map, challenge.street),
      random,
      "This map has no straight block of a quiet two-way street with one lane each way and a parking lane, long enough and outside any school or playground zone.",
    );
    return { lane: step.lane, startS: step.startS, extend: 0, goalS: step.goalS, fields: { stepOut: step.stepOut } };
  });

// The cars lining the kerb (see stepOutSites), staying put, and the child hidden between the two either
// side of their line, who will walk straight across the street to just past the far kerb without
// looking (`dart`).
function placeStepOut(world, { edge, at }, seed) {
  const map = world.map,
    random = rng(seed),
    e = map.edges.get(edge),
    lat = curbOffset(e, CAR);
  const colors = [0x8d9299, 0x2b3a55, 0xeeeeea, 0x1a1c20, 0x6b7f5e, 0x9b1e1e];
  const step = CAR.length + STEP_GAP_M,
    rears = [];
  for (let rear = at + STEP_GAP_M / 2; rear + CAR.length <= at + STEP_ROW_M[1]; rear += step) rears.push(rear);
  for (let rear = at - STEP_GAP_M / 2 - CAR.length; rear >= at - STEP_ROW_M[0]; rear -= step) rears.push(rear);
  for (const [i, rear] of rears.sort((x, y) => x - y).entries()) {
    const s = rear + CAR.rearOverhang,
      p = pointAt(e.pts, e.cum, s),
      h = headingAt(e.pts, e.cum, s);
    const car = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
    Object.assign(car, {
      id: `challenge_parked_${i + 1}`,
      color: colors[i % colors.length],
      style: [2, 0, 4, 1, 5, 3][i % 6],
      curb: "right",
      edge,
      stay: true,
    });
    world.parked.add(car);
  }
  const p = pointAt(e.pts, e.cum, at),
    h = headingAt(e.pts, e.cum, at);
  const off = (right) => [p[0] + Math.sin(h) * right, p[1] - Math.cos(h) * right];
  const from = off(lat - CAR.width / 2 + STEP_HIDE_M),
    to = off(e.asphalt[0] - 0.4);
  const ped = new Pedestrian({
    id: "challenge_child",
    x: from[0],
    y: from[1],
    psi: h + Math.PI / 2,
    v: 0,
    speed: STEP_MPS,
    child: true,
    dart: true,
    stepOut: true,
    path: [{ p: to, cross: { node: null, from, to, jaywalk: true } }],
    crossing: null,
    waiting: 0,
    phase: 0,
    look: Math.floor(random() * 1e6),
    at: null,
  });
  ped.frozen = 1e6;
  world.crowd.list.push(ped);
  return { pedestrianId: ped.id, at: from };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeStepOut(world, scenario.stepOut, challenge.seed));
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: frontWithin(STEP_OUT_M),
    release: (world, fleet, state) => releasePedestrian(world, state),
  });
