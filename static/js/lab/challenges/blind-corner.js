// The blind corner: the car starts 70 m before a two-way stop's line.
//
// Blind two-way stops: an approach with a stop sign at least 90 m long, its line at least 75 m
// along, going straight on into a street at least 60 m long, where the streets from the right and the
// left (heading within 20 deg of a quarter turn either way, at least 70 m long) are the through road
// and go straight on. From the stop line a building hides the street to the right 45 to 60 m from the
// junction (where the car from the right starts); from 0.3 m short of the crossing road's asphalt,
// where the car stops to look, nothing hides the first 60 m.
import { pointAt, wrapAngle } from "../../map/mapdata.js";
import { Visibility } from "../../sim/visibility.js";
import { laneScenario, pick, releaseThrough, stepAuthored, straightOn } from "./shared/kit.js";

export const challenge = {
  id: "blind-corner",
  title: "The blind corner",
  map: "mount_pleasant",
  weather: "dry",
  time: "afternoon",
  seed: 10042,
  icon: "◩",
  difficulty: "Sight lines",
  hazard: "two-way",
  description:
    "A building in Mount Pleasant blocks your view from the stop line. Drivers on the cross street have no stop sign.",
  lesson:
    "Make your full stop at the line first. Then inch forward only as far as you need to see left and right, and wait where you can see until there is time to cross both directions.",
};

const twoWaySiteCache = new WeakMap();
function twoWaySites(map) {
  if (twoWaySiteCache.has(map)) return twoWaySiteCache.get(map);
  const sites = [],
    visibility = new Visibility(map);
  const exit = (id) =>
    map
      .successors(id)
      .find((o) => map.classifyTurn(map.turnAngle(id, o)) === "straight" && map.edges.get(o).length > 60);
  for (const edge of map.edges.values()) {
    const control = edge.control;
    if (control?.type !== "stop" || control.all_way || edge.length < 90 || control.s_line < 75) continue;
    const at = (turn) =>
      (map.inn.get(edge.to) || []).find(
        (id) =>
          Math.abs(wrapAngle(map.headingIn(id) - map.headingIn(edge.id) - turn)) < 0.35 &&
          map.priorityOf(id)?.rule === "major" &&
          map.edges.get(id).length > 70 &&
          exit(id),
      );
    const straight = exit(edge.id),
      fromRight = at(Math.PI / 2),
      fromLeft = at(-Math.PI / 2);
    if (!straight || !fromRight || !fromLeft) continue;
    const lane = map.lane(edge.id, edge.lanes - 1),
      e = map.edges.get(fromRight),
      L = e.cum.at(-1);
    // where the car's rear axle is with its front bumper at route arc length s along the lane
    const eye = (frontS) => pointAt(lane.pts, lane.cum, frontS - 3.6);
    const back = (m) => pointAt(e.pts, e.cum, L - m),
      peekS = lane.length - map.crossingHalfWidth(edge.id) - 0.3;
    const hidden = [45, 50, 55, 60].find((m) => visibility.occluded(eye(control.s_line), back(m)));
    if (
      hidden &&
      [10, 20, 30, 40, 50, 60].every((m) => !visibility.occluded(eye(peekS), back(m))) &&
      map.edges.get(fromLeft).length > 75
    )
      sites.push({ lane, straight, fromRight, fromLeft, across: [exit(fromRight), exit(fromLeft)], hidden });
  }
  sites.sort((a, b) => String(a.lane.edge).localeCompare(String(b.lane.edge)));
  twoWaySiteCache.set(map, sites);
  return sites;
}

// Once the car has made its stop at the line (or crossed it without): a car on the through road from
// the right, where the building hides it from the line, and one from the left 75 m out, both at up to
// 10 m/s going straight on. The first reaches the junction about when the car has crept forward to
// look; the second close enough after it that the car waits for it too.
function twoWayCars(map, site) {
  return [
    { id: "challenge_through_right", edge: site.fromRight, back: site.hidden, then: site.across[0] },
    { id: "challenge_through_left", edge: site.fromLeft, back: 75, then: site.across[1] },
  ].map((c) => ({ ...c, start: [c.edge, map.edges.get(c.edge).length - c.back, []] }));
}

export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, _challenge, random) => {
    const blind = pick(
      twoWaySites(map),
      random,
      "This map has no two-way stop with a building hiding the through road.",
    );
    return {
      lane: blind.lane,
      startS: blind.lane.edgeRef.control.s_line - 70,
      through: [straightOn(map, blind.lane, blind.straight)],
      fields: { twoWay: twoWayCars(map, blind) },
    };
  });

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    // (once the car has stopped at the line, or its front is past it)
    trigger: (local, world, state) =>
      (world.egoStop.completed && world.egoStop.controlId === state.stopId) ||
      local.ahead < world.ego.spec.length - world.ego.spec.rearOverhang,
    release: (world, fleet, state) => {
      state.twoWayIds = releaseThrough(world, fleet, state.twoWay);
    },
  });
