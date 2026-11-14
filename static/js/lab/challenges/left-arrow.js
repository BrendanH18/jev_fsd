// Not your arrow: an approach whose advance green shows as a left arrow (sim/signals.js), at least 90 m
// long with its line at least ARROW_START_M + 5 m along, with two lanes or more, a street straight
// on at least 60 m long and one to the left; where the light is red from 3 s and the arrow comes on
// between ARROW_AT_S, so the car is stopped at the line on the red before it does. The car starts
// ARROW_START_M before the line in the right lane, going straight; two cars wait at the line in the
// left lane to turn left, and a third comes up beside the car (ARROW_TURNERS). The route ends
// ARROW_ROUTE_M from the start, on the street straight on.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, CAR } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory, approachPhase } from "../../sim/signals.js";
import { rng } from "../../common.js";
import { laneScenario, pick, stepAuthored, straightOn } from "./shared/kit.js";

export const challenge = { id: "left-arrow", title: "Not your arrow", map: "winnipeg", weather: "dry", time: "afternoon", seed: 21042, icon: "⇠", difficulty: "Judgement", hazard: "left-arrow", street: "Isabel Street",
  description: "You're going straight on Isabel Street at William Avenue, first at a red light in the right lane. Beside you, cars wait in the left lane to turn left. Then a green arrow comes on, and they go.", lesson: "A green arrow is for the way it points, and no other: going straight, your light is still red. Wait for your own green, even while the lane beside you moves." };

const ARROW_START_M = 95, ARROW_ROUTE_M = 220, ARROW_AT_S = [16, 32], ARROW_TURNERS = [{ back: 1, v: 0 }, { back: 8.5, v: 0 }, { back: 50, v: 9 }];
const arrowSiteCache = new WeakMap();
function arrowSites(map, street) {
  if (!arrowSiteCache.has(map)) {
    const sites = [];
    for (const inter of map.intersections.values()) {
      const adv = inter.plan?.advance, e = adv?.style === "arrow" ? map.edges.get(adv.edge) : null;
      if (!e || e.length < 90 || e.control?.s_line < ARROW_START_M + 5 || e.lanes < 2) continue;
      const turn = (dir, min) => map.successors(e.id).find((id) => map.classifyTurn(map.turnAngle(e.id, id)) === dir && map.edges.get(id).length > min);
      const straight = turn("straight", 60), left = turn("left", 40);
      if (!straight || !left) continue;
      let at = null;
      for (let t = 3; t <= ARROW_AT_S[1] && at === null; t += 0.5) {
        const shows = approachPhase(inter, e.id, t);
        if (shows === "arrow") at = t;
        else if (shows !== "red") break;
      }
      if (at === null || at < ARROW_AT_S[0]) continue;
      sites.push({ lane: map.lane(e.id, e.lanes - 1), signal: inter.id, straight, left, arrowAt: at });
    }
    sites.sort((a, b) => a.signal.localeCompare(b.signal));
    arrowSiteCache.set(map, sites);
  }
  const sites = arrowSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

// (past the arrow, ARROW_ROUTE_M in all, the destination on the last street short of its end)
export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const arrow = pick(arrowSites(map, challenge.street), random, "This map has no signal with a left arrow on a street with two lanes or more, where the car can wait at a red before the arrow comes on.");
  return { lane: arrow.lane, startS: arrow.lane.edgeRef.control.s_line - ARROW_START_M, through: [straightOn(map, arrow.lane, arrow.straight)], extend: ARROW_ROUTE_M,
    goalS: (last, length) => Math.min(last.length - 10, Math.max(10, last.length - (length - ARROW_ROUTE_M))),
    fields: { leftArrow: { signal: arrow.signal, edge: arrow.lane.edge, left: arrow.left } } };
});

// The cars turning left on the arrow, in the left lane: held at their red like any driver.
function placeTurners(world, fleet, { edge, left }, seed) {
  const map = world.map, random = rng(seed), lane = map.lane(edge, 0), line = map.edges.get(edge).control.s_line * lane.length / Math.max(1, map.edges.get(edge).length);
  return ARROW_TURNERS.map(({ back, v }, i) => {
    const s = line - back - (CAR.length - CAR.rearOverhang), p = pointAt(lane.pts, lane.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v);
    Object.assign(car, { id: `challenge_turner_${i + 1}`, color: [0x6b2737, 0xb0b5b9, 0x3d5a80][i], v0: 11, driver: { aMax: 1.5, b: 2, s0: 2, T: 1.2, react: 0.5 + random() * 0.3, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0 });
    car.path.start(edge, 0, s, [[left, 0]]); fleet.vehicles.push(car);
    return car.id;
  });
}

export function install(world, fleet, challenge, scenario) {
  const inter = world.map.intersections.get(scenario.leftArrow.signal);
  Object.assign(world.challenge, { turnerIds: placeTurners(world, fleet, scenario.leftArrow, challenge.seed), signalId: scenario.leftArrow.signal, arrowEdge: scenario.leftArrow.edge, ...(inter ? { at: [inter.x, inter.y] } : {}) });
}

// (the arrow comes on, and the cars beside the car turn)
export const step = (world, fleet) => stepAuthored(world, fleet, {
  trigger: (local, world, state) => approachPhase(world.map.intersections.get(state.signalId), state.arrowEdge, world.t) === "arrow",
});
