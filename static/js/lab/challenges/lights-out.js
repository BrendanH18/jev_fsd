// Lights out: a signal with four approaches at one node, where the approach (on the challenge's
// `street`, where it has one) and the approaches from the right and opposite meet the four-way stop's
// terms for an all-way stop. Its lights are out (sim/outage.js) for the whole drive, so it is one. The
// car starts 70 m before its line; once it is 45 m from it, cars set off from the right and opposite
// (shared/kit.js allWayCars).
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
  id: "lights-out",
  title: "Lights out",
  map: "halifax",
  weather: "dry",
  time: "afternoon",
  seed: 23042,
  icon: "☇",
  difficulty: "Judgement",
  hazard: "outage",
  street: "Barrington Street",
  description:
    "The signal heads at Barrington and Morris are dark. A car from the right arrives first and another is waiting behind it.",
  lesson:
    "Stop at the line and use all-way-stop order. Give priority to the driver who stopped first, or to the driver on your right when you stop together.",
};

const darkSiteCache = new WeakMap();
function darkSites(map, street) {
  if (!darkSiteCache.has(map)) {
    const sites = [];
    const exit = (id, dir, min = 0) =>
      map.successors(id).find((o) => map.classifyTurn(map.turnAngle(id, o)) === dir && map.edges.get(o).length > min);
    for (const inter of map.intersections.values()) {
      if ((inter.vertices || []).length !== 1 || inter.approaches.length !== 4) continue;
      for (const { edge: id } of inter.approaches) {
        const edge = map.edges.get(id);
        if (edge.length < 90 || edge.control.s_line < 75) continue;
        const at = (turn, min) =>
          inter.approaches
            .map((a) => a.edge)
            .find(
              (o) =>
                o !== id &&
                Math.abs(wrapAngle(map.headingIn(o) - map.headingIn(id) - turn)) < 0.35 &&
                map.edges.get(o).control.s_line >= min,
            );
        const straight = exit(id, "straight", 60),
          fromRight = at(Math.PI / 2, 40),
          opposite = at(Math.PI, 60);
        const across = fromRight && exit(fromRight, "straight"),
          left = opposite && exit(opposite, "left");
        if (straight && across && left)
          sites.push({
            lane: map.lane(id, edge.lanes - 1),
            signal: inter.id,
            straight,
            fromRight,
            across,
            opposite,
            left,
          });
      }
    }
    sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
    darkSiteCache.set(map, sites);
  }
  const sites = darkSiteCache.get(map),
    on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const stop = pick(
      darkSites(map, challenge.street),
      random,
      "This map has no signal with four approaches, traffic from the right and ahead, and room to queue on each.",
    );
    return {
      lane: stop.lane,
      startS: stop.lane.edgeRef.control.s_line - 70,
      through: [straightOn(map, stop.lane, stop.straight)],
      fields: { allWay: allWayCars(map, stop), outage: { signal: stop.signal } },
    };
  });

// (the signal's lights are out for the whole drive)
export function install(world, _fleet, _challenge, scenario) {
  world.outages.cut(scenario.outage.signal);
  world.challenge.signalId = scenario.outage.signal;
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: reach(ONCOMING_TRIGGER_M),
    release: (world, fleet, state) => {
      state.allWayIds = releaseAllWay(world, fleet, state.allWay);
    },
  });
