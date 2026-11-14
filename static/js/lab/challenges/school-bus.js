// Flashing reds: a school bus coming toward the car, stopped with its reds flashing where a school
// bus may stop (sim/school-bus.js stopRange) on a two-way street with one lane each way, limited to
// 50 km/h or less. The car starts in its lane on the same street, SCHOOL_START_M before where it
// stops for the bus (ONCOMING_M short of its front), so the bus stops as near the end of its own
// street as it may. Once the car is 45 m from the bus's front, a child who has just got off walks
// forward past its front and crosses the street in front of it, into the car's lane. On the
// challenge's `street` where it has one.
import { SCHOOL_BUS } from "../../sim/vehicle.js";
import { ONCOMING_M, firstStop, stopRange } from "../../sim/school-bus.js";
import { rng } from "../../common.js";
import { ONCOMING_TRIGGER_M, laneScenario, pick, reach, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "school-bus", title: "Flashing reds", map: "kitsilano", weather: "dry", time: "afternoon", seed: 15042, icon: "▣", difficulty: "Courtesy", hazard: "school-bus", street: "West 2nd Avenue",
  description: "A school bus coming the other way on West 2nd Avenue has stopped with its red lights flashing. Your side of the road is clear.", lesson: "In BC, traffic going both ways must stop for a school bus stopped with its red lights flashing, and stay stopped until it moves off or the lights go off. Children getting off often cross the street in front of it." };

const SCHOOL_START_M = 100;
const schoolSiteCache = new WeakMap();
function schoolSites(map, street) {
  if (!schoolSiteCache.has(map)) {
    const sites = [];
    for (const e of map.edges.values()) {
      const r = [...map.edges.values()].find(o => o.from === e.to && o.to === e.from && o.lanes === 1);
      if (!r || e.lanes !== 1 || e.ring || !stopRange(map, r)) continue;
      const L = e.cum[e.cum.length - 1], at = firstStop(stopRange(map, r), 0);
      const start = L - at - ONCOMING_M - SCHOOL_START_M;
      if (at === null || start < 3) continue;
      sites.push({ lane: map.lane(e.id, 0), startS: start * map.lane(e.id, 0).length / Math.max(1, L), bus: { edge: r.id, s: at } });
    }
    sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
    schoolSiteCache.set(map, sites);
  }
  const sites = schoolSiteCache.get(map), on = sites.filter((s) => s.lane.edgeRef.name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const school = pick(schoolSites(map, challenge.street), random, "This map has no two-way street with one lane each way and a limit of 50 km/h or less long enough for a school bus to stop on.");
  return { lane: school.lane, startS: school.startS, fields: { schoolBus: school.bus } };
});

// The school bus standing at its stop, coming toward the car, its reds flashing and its stop arm out,
// and a child just off it by its door, about to walk forward past its front and cross in front of it
// to the far sidewalk. Both wait for the car to come up; the reds then stay on until the child is
// across and for SCHOOL_RED_S from when the car came up.
const SCHOOL_RED_S = 6;
function placeSchoolBus(world, fleet, { edge, s }, seed) {
  const map = world.map, e = map.edges.get(edge), lane = map.lane(edge, 0), scale = lane.length / Math.max(1, e.cum[e.cum.length - 1]);
  const bus = fleet.addSchoolBus(lane, s * scale - (SCHOOL_BUS.length - SCHOOL_BUS.rearOverhang), 0);
  Object.assign(bus.school, { phase: "red", lights: "red", arm: true, doors: true, held: true, t: 0, red: Infinity, stops: 1, stop: { edge, s }, every: Infinity });
  bus.doors = true;
  const child = world.crowd.alight(bus, e, true, rng(seed));
  child.id = "challenge_child";
  child.held = true;
  const front = SCHOOL_BUS.length - SCHOOL_BUS.rearOverhang;
  return { schoolBusId: bus.id, childId: child.id, at: [bus.x + Math.cos(bus.psi) * front, bus.y + Math.sin(bus.psi) * front] };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeSchoolBus(world, fleet, scenario.schoolBus, challenge.seed));
}

export const step = (world, fleet) => stepAuthored(world, fleet, {
  trigger: reach(ONCOMING_TRIGGER_M),
  release: (world, fleet, state) => {
    // (the school bus keeps its reds on until the child is across, and a few seconds more)
    const school = state.schoolBusId && fleet.vehicles.find(v => v.id === state.schoolBusId);
    if (school?.school.phase === "red") Object.assign(school.school, { held: false, t: 0, red: SCHOOL_RED_S });
    const child = state.childId && world.crowd.list.find(p => p.id === state.childId);
    if (child) child.held = false;
  },
});
