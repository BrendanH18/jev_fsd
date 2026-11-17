// Wait for the far curb: the Metcalfe Street pedestrian crossover (map.pxos, from the crossings v2
// layer). The car starts 55 m before it and drives on past it onto the street straight ahead; a person
// is already crossing from the far (left) sidewalk.
import { routeFromLanes } from "../../demo/routing.js";
import { pointAt, headingAt, projectPoint } from "../../map/mapdata.js";
import { Pedestrian } from "../../sim/pedestrians.js";

export const challenge = {
  id: "pxo-far-curb",
  title: "Wait for the far curb",
  map: "ottawa",
  weather: "dry",
  time: "afternoon",
  seed: 35042,
  icon: "⊗",
  difficulty: "Patience",
  hazard: "pxo",
  pxo: true,
  street: "Metcalfe Street",
  description:
    "A person crosses Metcalfe Street at a signed pedestrian crossover. Your lane clears before the whole road does.",
  lesson: "At an Ontario PXO, stay stopped until everyone reaches the far curb across the whole roadway.",
};

export function scenario(map, challenge) {
  const cw = map.pxos.find((c) => c.id === "x2317854682");
  if (!cw) throw new Error("Metcalfe Street PXO is missing from the crossings v2 layer.");
  const e = map.edges.get(cw.edge),
    lane = map.lane(e.id, 0);
  const at = projectPoint(lane.pts, lane.cum, [cw.x, cw.y]).s;
  const startS = Math.max(3, at - 55),
    p = pointAt(lane.pts, lane.cum, startS);
  // (on past it, onto the street straight ahead, so the drive is long enough to score)
  const next = map
    .successors(e.id)
    .map((id) => map.edges.get(id))
    .sort((a, b) => Math.abs(map.turnAngle(e.id, a.id)) - Math.abs(map.turnAngle(e.id, b.id)))[0];
  const route = next
    ? routeFromLanes(map, [lane, map.lane(next.id, 0)], startS, Math.min(next.length - 2, 50))
    : routeFromLanes(map, [lane], startS, Math.min(lane.length - 2, at + 10));
  return {
    id: challenge.id,
    start: { edge: lane.edge, lane: lane.idx, s: startS, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, startS) },
    route,
    goal: route.polyline.at(-1),
    traffic_seed: challenge.seed,
    pxoCrossing: cw.id,
  };
}

export function install(world, fleet, challenge, scenario) {
  const cw = world.crowd.marked.find((c) => c.id === scenario.pxoCrossing);
  const start = world.ego,
    near =
      Math.hypot(start.x - cw.ends[1][0], start.y - cw.ends[1][1]) <
      Math.hypot(start.x - cw.ends[-1][0], start.y - cw.ends[-1][1])
        ? 1
        : -1;
  // The walker starts at the far (left) sidewalk of this one-way street;
  // lane 0 is beside that sidewalk and clears before the rest of the roadway.
  const from = cw.ends[near],
    to = cw.ends[-near];
  const cross = { node: null, marked: cw.id, from, to };
  const ped = new Pedestrian({
    id: "challenge_pxo_walker",
    x: from[0],
    y: from[1],
    psi: Math.atan2(to[1] - from[1], to[0] - from[0]),
    v: 0,
    speed: 0.65,
    home: true,
    path: [{ p: to, cross }],
    crossing: cross,
    waiting: 0,
    phase: 0,
    look: 0,
  });
  world.crowd.list.push(ped);
  Object.assign(world.challenge, { pedestrianId: ped.id, at: from, triggered: true });
}
