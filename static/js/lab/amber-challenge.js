import { routeFromLanes } from "../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../map/mapdata.js";
import { approachPhase } from "../sim/signals.js";
import { WEATHER } from "../sim/weather.js";
import { getVehicleModel } from "../sim/vehicle-models.js";

// West 4th Avenue at Maple Street. Both lessons use the unchanged signal plan,
// starting one second before amber, already moving at a weather-adjusted 36 km/h.
export function amberScenario(map, challenge) {
  const edge = map.edges.get("e163"), exit = map.edges.get("e165");
  if (edge?.name !== "West 4th Avenue" || exit?.name !== edge.name || edge.control?.type !== "signal") throw new Error("The amber lessons need Kitsilano's West 4th Avenue signal.");
  const lane = map.lane(edge.id, edge.lanes - 1), onward = map.lane(exit.id, exit.lanes - 1);
  // Snow's shorter sight range hides the lamp from the dry stop lesson's start.
  // Its test variant starts nearer and slower so the driver can actually observe
  // the amber while a safe stop is still possible.
  const snowStop = challenge.weather === "snow" && challenge.id === "amber-stop";
  const room = challenge.id === "amber-stop" && !snowStop ? 65 : 23;
  // Compact car front overhang from its reference point, shared with setupChallenge.
  const spec = getVehicleModel("compact").spec, front = spec.length - spec.rearOverhang;
  const s = edge.control.s_line * lane.length / edge.length - room - front;
  const route = routeFromLanes(map, [lane, onward], s, 100);
  const p = pointAt(lane.pts, lane.cum, s);
  return { id: challenge.id, start: { edge: edge.id, lane: lane.idx, s, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s) },
    route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    amber: { edge: edge.id, speed: snowStop ? 2 : 10 * WEATHER[challenge.weather].speed },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 1, stops: 0, lefts: 0, rights: 0 } };
}

export function installAmber(world, scenario) {
  const edge = world.map.edges.get(scenario.amber.edge), inter = world.map.intersections.get(edge.control.id);
  const phase = inter.plan[edge.control.group];
  const onset = ((phase.start + phase.green - (inter.offset_s || 0)) % inter.plan.cycle + inter.plan.cycle) % inter.plan.cycle;
  world.t = onset < 1 ? onset + inter.plan.cycle - 1 : onset - 1;
  if (approachPhase(inter, edge.id, world.t) !== "green") throw new Error("The amber lessons must start on green.");
  world.ego.v = scenario.amber.speed;
  world.challenge.triggered = true;
  world.challenge.at = [inter.x, inter.y];
}
