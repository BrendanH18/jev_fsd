// Behind the doors: a streetcar stopped at a stop of its route's run (sim/streetcar.js), with its
// doors open, on a street with another lane going its way on the curb side of its track, with no
// junction and no school or playground zone between it and the car. The car starts in that lane,
// TRAM_START_M behind the streetcar's rear. A rider waits at the curb abreast of
// its rear doors; once the car's front is RIDER_TRIGGER_M from them, they walk out across the car's
// lane to the doors without looking, and get on. The streetcar closes its doors RIDER_ABOARD_S
// later and moves off.
// On the challenge's `street` where it has one.
import { headingAt, projectPoint } from "../../map/mapdata.js";
import { CAR, STREETCAR } from "../../sim/vehicle.js";
import { busStopFront } from "../../sim/bus.js";
import { Pedestrian } from "../../sim/pedestrians.js";
import { doorPoints } from "../../sim/streetcar.js";
import { frontWithin, laneScenario, pick, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "streetcar",
  title: "Behind the doors",
  map: "toronto",
  weather: "dry",
  time: "afternoon",
  seed: 18042,
  icon: "▥",
  difficulty: "Courtesy",
  hazard: "streetcar",
  street: "Bathurst Street",
  description:
    "A 511 streetcar has stopped at its stop on Bathurst Street, in the lane beside yours, with its doors open. Your lane is clear.",
  lesson:
    "In Ontario, traffic behind a streetcar that has stopped to let people on or off must stop at least 2 m behind its rear doors and wait until they have got on, or reached the curb. Its riders cross your lane to get to it.",
};

const TRAM_START_M = 75,
  RIDER_TRIGGER_M = 10,
  RIDER_MPS = 1.4,
  RIDER_ABOARD_S = 4;
const tramSiteCache = new WeakMap();
function tramSites(map, street) {
  if (!tramSiteCache.has(map)) {
    const sites = [];
    (map.transit?.routes || []).forEach(
      (route) =>
        route.mode === "tram" &&
        route.runs.forEach((run, runIndex) => {
          for (const stop of run.stops) {
            const k = run.edges.indexOf(stop.edge),
              e = map.edges.get(stop.edge),
              front = busStopFront(map, stop.edge, stop.s, STREETCAR.length);
            if (k < 0 || !e || front === null || e.lanes < 2 || (run.lane ?? 0) >= e.lanes - 1) continue;
            const lengths = run.edges.map((id) => map.edges.get(id).length);
            let at =
                lengths.slice(0, k).reduce((a, l) => a + l, 0) +
                front -
                STREETCAR.length -
                TRAM_START_M -
                (CAR.length - CAR.rearOverhang),
              j = 0;
            if (at < 3) continue;
            while (j < k && at > lengths[j]) at -= lengths[j++];
            if (j < k || map.zoneSpans.has(stop.edge)) continue;
            const lane = map.lane(run.edges[j], map.edges.get(run.edges[j]).lanes - 1);
            if (!lane || lane.idx <= (run.lane ?? 0)) continue;
            sites.push({
              lane,
              startS: (at * lane.length) / Math.max(1, lengths[j]),
              streetcar: { route: route.id, run: runIndex, stop: stop.id, edge: stop.edge, front },
            });
          }
        }),
    );
    sites.sort(
      (a, b) => a.streetcar.stop.localeCompare(b.streetcar.stop) || a.streetcar.route.localeCompare(b.streetcar.route),
    );
    tramSiteCache.set(map, sites);
  }
  const sites = tramSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const tram = pick(
      tramSites(map, challenge.street),
      random,
      "This map has no streetcar stop on a street with another lane going its way beside the track.",
    );
    return { lane: tram.lane, startS: tram.startS, fields: { streetcar: tram.streetcar } };
  });

// The streetcar standing at its stop, doors open, held there until its rider is aboard; and the rider
// at the curb abreast of its rear doors, who will walk out to them across the lane beside it without
// looking (`dart`), and get on (see tramSites).
function placeStreetcar(world, fleet, { route: routeId, run: runIndex, stop: stopId, edge, front }, seed) {
  const map = world.map,
    route = map.transit.routes.find((r) => r.id === routeId),
    run = route.runs[runIndex];
  const k = run.edges.indexOf(edge),
    before = run.edges.slice(0, k).reduce((a, id) => a + map.edges.get(id).length, 0);
  const car = fleet.spawnBus(0, { route, run }, before + front - (STREETCAR.length - STREETCAR.rearOverhang), true);
  if (!car) return { streetcarId: null };
  car.v = 0;
  Object.assign(car.transit, {
    phase: "dwell",
    stop: { id: stopId, edge, front },
    t: 5,
    dwell: Infinity,
    doors: true,
    held: true,
  });
  car.doors = true;
  const e = map.edges.get(edge),
    door = doorPoints(car)[3],
    q = projectPoint(e.pts, e.cum, door, null);
  const h = headingAt(e.pts, e.cum, q.s),
    curb = [q.point[0] + Math.sin(h) * (e.asphalt[1] + 0.3), q.point[1] - Math.cos(h) * (e.asphalt[1] + 0.3)];
  const rider = new Pedestrian({
    id: "challenge_rider",
    x: curb[0],
    y: curb[1],
    psi: Math.atan2(door[1] - curb[1], door[0] - curb[0]),
    v: 0,
    speed: RIDER_MPS,
    dart: true,
    path: [{ p: door, cross: { node: null, from: curb, to: door, jaywalk: true, streetcar: car.id, boarding: true } }],
    crossing: null,
    waiting: 0,
    phase: 0,
    look: seed,
    at: null,
    streetcar: car.id,
    boarding: true,
    home: true,
    held: true,
  });
  world.crowd.list.push(rider);
  return { streetcarId: car.id, riderId: rider.id, at: curb };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeStreetcar(world, fleet, scenario.streetcar, challenge.seed));
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: frontWithin(RIDER_TRIGGER_M),
    // (the rider walks out to the streetcar's doors)
    release: (world, fleet, state) => {
      const rider = state.riderId && world.crowd.list.find((p) => p.id === state.riderId);
      if (rider) {
        rider.held = false;
        rider.crossing = rider.path[0].cross;
      }
    },
    // (once the rider is aboard, the streetcar closes its doors RIDER_ABOARD_S later and moves off)
    follow: (world, fleet, state) => {
      const tram = state.streetcarId && state.triggered ? fleet.vehicles.find((v) => v.id === state.streetcarId) : null;
      if (tram?.transit.held && !world.crowd.list.some((p) => p.id === state.riderId))
        Object.assign(tram.transit, { held: false, dwell: tram.transit.t + RIDER_ABOARD_S });
    },
  });
