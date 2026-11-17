// Four-way stop: the car starts 70 m before its line; once it is 45 m from it, cars set off from the
// right and opposite (shared/kit.js allWayCars).
//
// All-way stops: an approach at least 90 m long, its line at least 75 m along, going straight on
// into a street at least 60 m long, at a junction where the approach from the right (heading within
// 20 deg of a quarter turn left of it, its line at least 40 m along) goes straight on and the
// opposite approach (its line at least 60 m along) can turn left, both with all-way stops too.
import { wrapAngle } from "../../map/mapdata.js";
import {
  ONCOMING_TRIGGER_M,
  allWayCars,
  laneScenario,
  pick,
  reach,
  releaseAllWay,
  stepAuthored,
  straightOn,
} from "./shared/kit.js";

export const challenge = {
  id: "four-way-stop",
  title: "Four-way stop",
  map: "toronto",
  weather: "dry",
  time: "afternoon",
  seed: 9042,
  icon: "✣",
  difficulty: "Judgement",
  hazard: "all-way",
  description:
    "An all-way stop in The Annex. A car from your right gets there first, another queues behind it, and an oncoming car wants to turn left. Who goes when?",
  lesson:
    "At an all-way stop, whoever stops first goes first. Stop together and the car on the right goes first. A car that pulls up after you waits for you, even if it was queued before you arrived.",
};

const allWaySiteCache = new WeakMap();
function allWaySites(map) {
  if (allWaySiteCache.has(map)) return allWaySiteCache.get(map);
  const sites = [],
    allWay = (id) => map.edges.get(id).control?.type === "stop" && map.edges.get(id).control.all_way;
  const exit = (id, dir, min = 0) =>
    map.successors(id).find((o) => map.classifyTurn(map.turnAngle(id, o)) === dir && map.edges.get(o).length > min);
  for (const edge of map.edges.values()) {
    if (!allWay(edge.id) || edge.length < 90 || edge.control.s_line < 75) continue;
    const straight = exit(edge.id, "straight", 60),
      others = (map.inn.get(edge.to) || []).filter((id) => id !== edge.id && allWay(id));
    const at = (turn, min) =>
      others.find(
        (id) =>
          Math.abs(wrapAngle(map.headingIn(id) - map.headingIn(edge.id) - turn)) < 0.35 &&
          map.edges.get(id).control.s_line >= min,
      );
    const fromRight = at(Math.PI / 2, 40),
      opposite = at(Math.PI, 60);
    const across = fromRight && exit(fromRight, "straight"),
      left = opposite && exit(opposite, "left");
    if (straight && across && left)
      sites.push({ lane: map.lane(edge.id, edge.lanes - 1), straight, fromRight, across, opposite, left });
  }
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  allWaySiteCache.set(map, sites);
  return sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, _challenge, random) => {
    const stop = pick(allWaySites(map), random, "This map has no all-way stop with traffic from the right and ahead.");
    return {
      lane: stop.lane,
      startS: stop.lane.edgeRef.control.s_line - 70,
      through: [straightOn(map, stop.lane, stop.straight)],
      fields: { allWay: allWayCars(map, stop) },
    };
  });

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: reach(ONCOMING_TRIGGER_M),
    release: (world, fleet, state) => {
      state.allWayIds = releaseAllWay(world, fleet, state.allWay);
    },
  });
