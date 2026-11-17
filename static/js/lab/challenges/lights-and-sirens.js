// Lights and sirens: the car starts SIREN_START_M (110 m) before the junction, and once it is 45 m from
// it an ambulance sets off SIREN_BACK_M (75 m) behind it, on its street, siren on.
//
// An emergency vehicle from behind: a long two-way street with a parking lane on the right, ending
// at a junction without a sign or signal where the car goes straight on, the car in its curb lane.
// Streets the car has the right of way along come first.
import { isJunction } from "../../sim/emergency.js";
import { ONCOMING_TRIGGER_M, laneScenario, pick, reach, stepAuthored, straightOn } from "./shared/kit.js";

export const challenge = {
  id: "lights-and-sirens",
  title: "Lights and sirens",
  map: "edmonton",
  weather: "dry",
  time: "afternoon",
  seed: 12042,
  icon: "✚",
  difficulty: "Awareness",
  hazard: "emergency",
  description:
    "An ambulance comes up behind you with its siren on, just before a junction. Get out of its way, but not into the junction.",
  lesson:
    "When you hear a siren, pull over as close to the right-hand edge of the road as you can, clear of any junction, and stop until it has gone by. Then let it get well ahead before you follow.",
};

const SIREN_EDGE_M = 135,
  SIREN_START_M = 110,
  SIREN_BACK_M = 75;
const sirenSiteCache = new WeakMap();
function sirenSites(map) {
  if (sirenSiteCache.has(map)) return sirenSiteCache.get(map);
  let sites = [];
  for (const edge of map.edges.values()) {
    if (
      edge.control ||
      edge.oneway ||
      edge.ring ||
      edge.length < SIREN_EDGE_M ||
      !(edge.parking?.[1] > 1.5) ||
      !isJunction(map, edge.to)
    )
      continue;
    const straight = map
      .successors(edge.id)
      .find(
        (o) =>
          map.classifyTurn(map.turnAngle(edge.id, o)) === "straight" &&
          map.edges.get(o).length > 60 &&
          !map.edges.get(o).ring,
      );
    if (straight)
      sites.push({
        lane: map.lane(edge.id, edge.lanes - 1),
        straight,
        major: map.priorityOf(edge.id)?.rule === "major",
      });
  }
  if (sites.some((s) => s.major)) sites = sites.filter((s) => s.major);
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  sirenSiteCache.set(map, sites);
  return sites;
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const siren = pick(
      sirenSites(map),
      random,
      "This map has no long two-way street with a parking lane ending at a junction without a sign.",
    );
    return {
      lane: siren.lane,
      startS: siren.lane.length - SIREN_START_M,
      through: [straightOn(map, siren.lane, siren.straight)],
      fields: { emergency: { kind: "ambulance", relation: "behind", distance: SIREN_BACK_M } },
    };
  });

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    trigger: reach(ONCOMING_TRIGGER_M),
    release: (world, fleet, state) => {
      state.emergencyId = fleet.dispatchEmergency(state.emergency)?.id || null;
    },
  });
