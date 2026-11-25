import { routeFromLanes } from "../../demo/routing.js";
import { pointAt, headingAt, cumulative } from "../../map/mapdata.js";
import { approachPhase, movementSignal } from "../../sim/signals.js";

export const challenge = {
  id: "wait-for-green",
  title: "Wait for green",
  map: "toronto",
  weather: "dry",
  time: "afternoon",
  seed: 43042,
  icon: "⊘",
  difficulty: "Judgement",
  hazard: "red-turn-sign",
  redTurnSigns: true,
  street: "Harbord Street",
  description:
    "Your Harbord Street approach faces an empty Spadina Avenue. A sign beside the light prohibits the right turn on red.",
  lesson:
    "Treat the sign as the deciding cue even after a full stop on a quiet approach. Wait at the line for green and check the crosswalk before turning.",
};

// OSM relation 3726713: Harbord Street eastbound -> Spadina Avenue southbound.
// No authored map/sign mutations: other challenges share the unchanged Toronto pack.
export function redTurnScenario(map, challenge) {
  const sign = map.redTurns.find((r) => r.osm_relation === 3726713 && r.from === "e355" && r.to.includes("e179"));
  if (!sign) throw new Error("Wait for green needs Toronto's mapped Harbord/Spadina red-turn sign.");
  const edge = map.edges.get(sign.from),
    start = map.lane(edge.id, edge.lanes - 1);
  const exit = map.edges.get("e179"),
    end = map.lane(exit.id, exit.lanes - 1);
  const s = Math.max(5, edge.control.s_line - 65),
    p = pointAt(start.pts, start.cum, s);
  const route = routeFromLanes(map, [start, end], s, Math.min(65, end.length - 12));
  return {
    id: challenge.id,
    start: { edge: edge.id, lane: start.idx, s, x: p[0], y: p[1], psi: headingAt(start.pts, start.cum, s) },
    route,
    goal: route.polyline.at(-1),
    traffic_seed: challenge.seed,
    redTurnSign: { from: edge.id, to: exit.id },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 1, stops: 0, lefts: 0, rights: 1 },
  };
}
export function installRedTurn(world, scenario) {
  const edge = world.map.edges.get(scenario.redTurnSign.from),
    inter = world.map.intersections.get(edge.control.id);
  // Start at the beginning of the longest red interval, so the empty cross street tempts a turn.
  const period = inter.plan.cycle;
  let best = 0,
    bestWait = -1;
  for (let t = 0; t < period; t++) {
    let wait = 0;
    while (wait < period && movementSignal(approachPhase(inter, edge.id, t + wait), "right") === "red") wait++;
    if (wait > bestWait) {
      best = t;
      bestWait = wait;
    }
  }
  world.t = best;
  world.challenge.triggered = true;
}

export const scenario = redTurnScenario;

export function install(world, _fleet, _challenge, scenario) {
  installRedTurn(world, scenario);
}
