// After midnight: a side-street approach to a signal flashing overnight (sim/night-flash.js): red for
// the car, amber on the main street. The car starts 70 m before its line; once it is 45 m from it,
// main-street cars set off 70 m from their own lines, going straight through (shared/kit.js
// releaseThrough).
import { flashMain } from "../../sim/night-flash.js";
import {
  ONCOMING_TRIGGER_M,
  laneScenario,
  pick,
  reach,
  releaseThrough,
  stepAuthored,
  straightOn,
} from "./shared/kit.js";

export const challenge = {
  id: "after-midnight",
  title: "After midnight",
  map: "halifax",
  weather: "dry",
  time: "01:00",
  seed: 39042,
  icon: "☾",
  difficulty: "Judgement",
  hazard: "night-flash",
  nightFlash: true,
  description: "Your side-street light is flashing red, but the cross street has flashing amber and moving traffic.",
  lesson:
    "Stop fully at the line, then wait for a gap in both directions. Traffic on the flashing-amber street may keep moving, so use an actual gap instead of counting which car arrived first.",
};

// Overnight side-street approaches with a straight crossing and main-street traffic.
function nightSites(map) {
  const sites = [];
  const straight = (id) =>
    map
      .successors(id)
      .find((o) => map.classifyTurn(map.turnAngle(id, o)) === "straight" && map.edges.get(o).length > 60);
  for (const inter of map.intersections.values()) {
    const main = flashMain(inter, map);
    if (!main || inter.vertices.length !== 1) continue;
    for (const a of inter.approaches.filter((a) => a.group !== main)) {
      const edge = map.edges.get(a.edge),
        then = straight(a.edge);
      const through = inter.approaches.filter(
        (b) => b.group === main && straight(b.edge) && map.edges.get(b.edge).length > 80,
      );
      if (edge.control.s_line < 80 || !then || !through.length) continue;
      sites.push({
        lane: map.lane(a.edge, edge.lanes - 1),
        straight: then,
        cars: through.map((b, i) => ({
          id: `challenge_night_${i}`,
          start: [b.edge, map.edges.get(b.edge).length - 70, []],
          then: straight(b.edge),
        })),
      });
    }
  }
  return sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, _challenge, random) => {
    const night = pick(nightSites(map), random, "No overnight flashing side-street approach.");
    return {
      lane: night.lane,
      startS: night.lane.edgeRef.control.s_line - 70,
      through: [straightOn(map, night.lane, night.straight)],
      fields: { twoWay: night.cars },
    };
  });

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: reach(ONCOMING_TRIGGER_M),
    release: (world, fleet, state) => {
      state.twoWayIds = releaseThrough(world, fleet, state.twoWay);
    },
  });
