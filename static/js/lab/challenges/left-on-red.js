// Left on red: a real Beltline one-way pair, 14 Avenue SW onto 5 Street SW (sim/left-on-red.js). The
// car starts 65 m before its line and arrives on its red; once it is 43 m from the line, two cars set
// off from the right on their green (shared/kit.js releaseOncoming).
import { routeFromLanes } from "../../demo/routing.js";
import { cumulative } from "../../map/mapdata.js";
import { releaseOncoming, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "left-on-red", title: "Left on red", map: "calgary", weather: "dry", time: "afternoon", seed: 38042, icon: "↰", difficulty: "Judgement", hazard: "left-on-red", leftOnRed: true, street: "14 Avenue SW", description: "Turn left from one-way 14 Avenue SW onto one-way 5 Street SW. Your light is red; two cars come from the right on their green.", lesson: "Stop fully at the line, then yield to pedestrians and traffic from the right. When clear, turn left from the leftmost lane onto the one-way street. Never do this in Québec, at a scramble, or where a sign forbids it." };

export function scenario(map, challenge) {
  // Real Beltline one-way pair. install starts it in the red phase.
  const lane = map.lane("e594", 0), exit = map.lane("e593", 0);
  const startS = lane.edgeRef.control.s_line - 65;
  const route = routeFromLanes(map, [lane, exit], startS, exit.length - 12);
  return { id: challenge.id, start: { edge: lane.edge, lane: 0, s: startS }, route, goal: route.polyline.at(-1), traffic_seed: challenge.seed, oncoming: { edge: "e140", then: "e593" },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 1, stops: 0, lefts: 1, rights: 0 } };
}

export function install(world) {
  world.t = 23; // sig13: B red, A green; no shared signal plan mutation
}

export const step = (world, fleet) => stepAuthored(world, fleet, {
  release: (world, fleet, state) => { state.oncomingIds = releaseOncoming(world, fleet, state.oncoming); },
});
