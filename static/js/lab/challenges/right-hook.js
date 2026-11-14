// The right hook: the car starts HOOK_START_M (95 m) before the corner, and a cyclist HOOK_LEAD_M
// (15 m) ahead of it rides the empty parking lane at 5.5 m/s, straight on past the corner. The car
// catches it up on the way, so it is beside or just behind the car as the car slows for the turn.
//
// Right hooks: an approach at least 110 m long with an empty parking lane, the right of way at its
// far end (no sign or signal, on the larger road or with nobody to give way to), whose route turns
// right onto a street at least 60 m long, and which goes straight on into a street at least 40 m
// long with a parking lane too, so a cyclist riding in it carries straight on past the corner. Bike
// routes come first.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, BIKE } from "../../sim/vehicle.js";
import { NpcPath, stripOffset } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";
import { ONCOMING_TRIGGER_M, laneScenario, pick, reach, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "right-hook", title: "The right hook", map: "kitsilano", weather: "dry", time: "afternoon", seed: 11042, icon: "↳", difficulty: "Anticipation", hazard: "right-hook",
  description: "A right turn off a Kitsilano bikeway, with a cyclist riding the empty parking lane. Catch them up, and they're on your right at the corner.", lesson: "Before a right turn, check your mirror and over your shoulder. A cyclist going straight on your right has the right of way: slow down, let them by, then turn behind them." };

const HOOK_START_M = 95, HOOK_LEAD_M = 15;
const hookSiteCache = new WeakMap();
function hookSites(map) {
  if (hookSiteCache.has(map)) return hookSiteCache.get(map);
  let sites = [];
  const exit = (id, dir, min) => map.successors(id).find(o => map.classifyTurn(map.turnAngle(id, o)) === dir && map.edges.get(o).length > min
    && (dir !== "straight" || stripOffset(map.edges.get(o), map.edges.get(o).lanes - 1) !== null));
  for (const edge of map.edges.values()) {
    if (edge.control || edge.length < 110 || stripOffset(edge, edge.lanes - 1) === null || map.priorityOf(edge.id)?.rule !== "major") continue;
    const right = exit(edge.id, "right", 60), straight = exit(edge.id, "straight", 40);
    if (right && straight) sites.push({ lane: map.lane(edge.id, edge.lanes - 1), right, straight, bike: !!edge.bike });
  }
  if (sites.some(s => s.bike)) sites = sites.filter(s => s.bike);
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  hookSiteCache.set(map, sites); return sites;
}

export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const hook = pick(hookSites(map), random, "This map has no right turn with a parking lane a cyclist rides straight on past.");
  const startS = hook.lane.length - HOOK_START_M, turn = map.lane(hook.right, map.edges.get(hook.right).lanes - 1);
  return { lane: hook.lane, startS, through: [turn], fields: { cyclist: { edge: hook.lane.edge, s: startS + HOOK_LEAD_M, then: hook.straight } } };
});

function placeCyclist(world, fleet, { edge, s, then }) {
  const map = world.map, e = map.edges.get(edge), lane = map.lane(edge, e.lanes - 1), side = stripOffset(e, lane.idx);
  const p = pointAt(lane.pts, lane.cum, s), psi = headingAt(lane.pts, lane.cum, s);
  const bike = new Vehicle(p[0] + Math.sin(psi) * side, p[1] - Math.cos(psi) * side, psi, 5.5, BIKE);
  Object.assign(bike, { id: "challenge_cyclist", kind: "bike", color: 0x2f855a, v0: 5.5, side, strip: true, driver: { aMax: 0.9, b: 2, s0: 2, T: 1.5, react: 0.6, lcRate: 0 },
    stopMem: new StopMemory(), path: new NpcPath(map, fleet.random, { bike: true }), frozen: 0, waiting: 0 });
  bike.path.start(edge, lane.idx, s, [[then, map.edges.get(then).lanes - 1]]); fleet.vehicles.push(bike);
  return bike.id;
}

export function install(world, fleet, challenge, scenario) {
  world.challenge.cyclistId = placeCyclist(world, fleet, scenario.cyclist);
}

export const step = (world, fleet) => stepAuthored(world, fleet, { trigger: reach(ONCOMING_TRIGGER_M) });
