// Dip your lights: 13th Street East with its streetlights out (sim/high-beams.js). A slower car is
// 370 m along the car's lane, and another comes the other way, 430 m short of the end of its own.
import { routeFromLanes } from "../../demo/routing.js";
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";

export const challenge = {
  id: "dip-your-lights",
  title: "Dip your lights",
  map: "saskatoon",
  weather: "dry",
  time: "night",
  seed: 41042,
  icon: "☼",
  difficulty: "Courtesy",
  hazard: "high-beams",
  highBeams: true,
  description:
    "The streetlights are out on 13th Street East. Use high beams on the empty stretch, dip for an approaching car and the slower car ahead.",
  lesson: "High beams help you see; dip within 150 m oncoming and 60 m following, and in fog or snow.",
};

export function scenario(map, challenge) {
  const lane = map.lane("e549", 0),
    startS = 80,
    goalS = 650;
  const p = pointAt(lane.pts, lane.cum, startS),
    route = routeFromLanes(map, [lane], startS, goalS);
  const reverse = [...map.edges.values()].find((e) => e.from === lane.edgeRef.to && e.to === lane.edgeRef.from);
  return {
    id: challenge.id,
    start: { edge: lane.edge, lane: 0, s: startS, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, startS) },
    route,
    goal: route.polyline.at(-1),
    traffic_seed: challenge.seed,
    beamTraffic: { reverse: reverse.id },
    tags: { length_m: Math.round(route.length), signals: 0, stops: 0, lefts: 0, rights: 0 },
  };
}

export function install(world, fleet, _challenge, scenario, { lane }) {
  world.streetLightsOut = true;
  for (const [edge, s, v, id] of [
    [lane.edge, 370, 4, "beam_leader"],
    [scenario.beamTraffic.reverse, lane.length - 430, 9, "beam_oncoming"],
  ]) {
    const l = world.map.lane(edge, 0),
      p = pointAt(l.pts, l.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(l.pts, l.cum, s), v);
    Object.assign(car, {
      id,
      color: 0x6b8199,
      v0: v,
      driver: { aMax: 1, b: 2, s0: 2, T: 1.5, react: 0.5, lcRate: 0 },
      stopMem: new StopMemory(),
      path: new NpcPath(world.map, fleet.random),
      frozen: 0,
      waiting: 0,
    });
    car.path.start(edge, 0, s);
    fleet.vehicles.push(car);
  }
  world.challenge.triggered = true;
}
