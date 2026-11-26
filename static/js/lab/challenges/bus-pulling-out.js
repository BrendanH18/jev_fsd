// Pulling out: the car starts BUS_START_M (100 m) behind a bus standing at its stop, doors open. Once
// the car is 45 m from the bus's rear the bus shuts its doors and signals to pull out.
//
// A bus at its stop: a stop on a bus route, on a street limited to 60 km/h or less that the route
// comes straight on into, with room on it and the street before for the car to start 100 m behind
// the bus, in its lane (the curb lane). On the challenge's `street` where it has one.
import { BUS } from "../../sim/vehicle.js";
import { BUS_YIELD_LIMIT_MPS, busStopFront, curbShift } from "../../sim/bus.js";
import { ONCOMING_TRIGGER_M, laneScenario, pick, reach, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "bus-pulling-out",
  title: "Pulling out",
  map: "kitsilano",
  weather: "dry",
  time: "afternoon",
  seed: 13042,
  icon: "▤",
  difficulty: "Courtesy",
  hazard: "bus",
  street: "West 4th Avenue",
  description:
    "You're approaching a bus stopped in your lane on West 4th Avenue. Its indicator comes on as it prepares to pull away.",
  lesson:
    "Here in BC, with the limit at 60 km/h or less, give a signalling transit bus room to leave the stop. Ease off as soon as its indicator comes on and be ready to stop behind it.",
};

const BUS_START_M = 100;
const busSiteCache = new WeakMap();
function busSites(map, street) {
  if (!busSiteCache.has(map)) {
    const sites = [],
      seen = new Set();
    (map.transit?.routes || []).forEach(
      (route) =>
        route.mode !== "tram" &&
        route.runs.forEach((run, runIndex) => {
          for (const stop of run.stops) {
            const k = run.edges.indexOf(stop.edge),
              e = map.edges.get(stop.edge),
              prev = map.edges.get(run.edges[k - 1]);
            if (k < 1 || !e || !prev || seen.has(stop.id) || e.ring || prev.ring || e.limit > BUS_YIELD_LIMIT_MPS)
              continue;
            const front = busStopFront(map, e.id, stop.s);
            if (front === null || map.classifyTurn(map.turnAngle(prev.id, e.id)) !== "straight") continue;
            const rear = front - BUS.length;
            if (rear < 3 || prev.length + rear < BUS_START_M + 10) continue;
            seen.add(stop.id);
            sites.push({
              prev: map.lane(prev.id, prev.lanes - 1),
              lane: map.lane(e.id, e.lanes - 1),
              rear,
              bus: { route: route.id, run: runIndex, stop: stop.id, edge: e.id, front },
            });
          }
        }),
    );
    sites.sort((a, b) => a.bus.stop.localeCompare(b.bus.stop));
    busSiteCache.set(map, sites);
  }
  const sites = busSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const bus = pick(
      busSites(map, challenge.street),
      random,
      "This map has no bus stop on a street with a limit of 60 km/h or less.",
    );
    return {
      lane: bus.prev,
      startS: Math.max(5, bus.prev.length - (BUS_START_M - bus.rear)),
      through: [bus.lane],
      fields: { bus: bus.bus },
    };
  });

function placeBus(world, fleet, { route: routeId, run: runIndex, stop: stopId, edge, front }) {
  const map = world.map,
    route = map.transit.routes.find((r) => r.id === routeId),
    run = route.runs[runIndex];
  const k = run.edges.indexOf(edge),
    before = run.edges.slice(0, k).reduce((a, id) => a + map.edges.get(id).length, 0);
  const bus = fleet.buses.spawn(0, { route, run }, before + front - (BUS.length - BUS.rearOverhang));
  if (!bus) return { busId: null };
  // standing at its stop, pulled in to the curb, doors open, until the car comes up behind it
  const e = map.edges.get(edge),
    shift = curbShift(e, e.lanes - 1);
  bus.x += Math.sin(bus.psi) * shift;
  bus.y -= Math.cos(bus.psi) * shift;
  bus.v = 0;
  Object.assign(bus.transit, {
    phase: "dwell",
    stop: { id: stopId, edge, front },
    curb: shift,
    shift,
    t: 0,
    dwell: Infinity,
    doors: true,
  });
  bus.doors = true;
  return {
    busId: bus.id,
    at: [bus.x - Math.cos(bus.psi) * BUS.rearOverhang, bus.y - Math.sin(bus.psi) * BUS.rearOverhang],
  };
}

export function install(world, fleet, _challenge, scenario) {
  Object.assign(world.challenge, placeBus(world, fleet, scenario.bus));
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: reach(ONCOMING_TRIGGER_M),
    // (its doors close and it signals to pull out)
    release: (_world, fleet, state) => {
      const bus = state.busId && fleet.vehicles.find((v) => v.id === state.busId);
      if (bus && bus.transit.phase === "dwell") bus.transit.dwell = bus.transit.t;
    },
  });
