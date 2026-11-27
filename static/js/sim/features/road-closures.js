// Road closures (sim/road-closures.js) as a feature record (sim/features/index.js,
// docs/feature-interface.md).
import { roadClosedNotice } from "../road-closures.js";
import { r1 } from "../../common.js";
import {
  RoadClosures,
  STOP_DECEL,
  auditRoadClosures,
  avoidClosure,
  closureHold,
  isBarricade,
  knownAhead,
  roadClosedSensing,
} from "../road-closures.js";

// A block closed for an event, seen at its barricades, for models.
function roadClosedClause(c) {
  const where = `${c.street ? `${c.street} is` : "The street ahead is"} closed to traffic for an event: ROAD CLOSED barricades stand across it ${Math.max(0, Math.round(c.distance_m))} m ahead.`;
  return c.detour_planned
    ? `${where} The route already takes a detour round it: follow the route, and never drive past the barricades.`
    : `${where} The route still goes through it and navigation is finding a detour: choose \`stop_for_closure\` to stop short of it (${Math.max(0, Math.round(c.bumper_to_stop_m))} m ahead) until the detour comes, and never drive past the barricades.`;
}

const CLOSURE_COACH = "Road closed ahead. Follow the detour; never drive past the barricades.";

export default {
  routeOptions(world, rerouting) {
    const avoid = rerouting && world.roadClosures?.known.size ? world.roadClosures.avoid() : null;
    return avoid?.length ? { avoid } : null;
  },
  requestReroute: {
    at: "afterOffRoute",
    run(pilot, snap) {
      const { t } = pilot.world;
      if (!snap.road_closed?.on_route || t < (pilot.closureReplanAt ?? -Infinity)) return false;
      pilot.closureReplanAt = t + 3;
      return true;
    },
  },
  rulesStop: {
    at: "beforeSignal",
    run: (snap) => snap.road_closed?.on_route && snap.road_closed.bumper_to_stop_m < 1.5,
  },
  rulesCost: (c) => (c.id === "stop_for_closure" ? -30 : 0),
  cautious: { at: "beforeBusLanes", run: (_snap, eligible) => eligible.find((c) => c.id === "stop_for_closure") },
  cautiousStop: (snap) => snap.road_closed?.on_route && snap.road_closed.bumper_to_stop_m < 12,
  key: "roadClosures",
  view: () => import("../../render/road-closures.js"),
  coach: {
    init: () => ({
      roadClosures: false,
      closureEntries: 0,
    }),
    seen: "roadClosures",
    events: {
      closure_entry(score, ev) {
        score.closureEntries++;
        score.incident("closure_entry", `Drove past a ROAD CLOSED barricade onto ${ev.street || "a closed street"}`, {
          closure: ev.closure,
        });
      },
    },
    reports: [
      { at: "end", order: 18, read: (score) => (score.roadClosures ? { closure_entries: score.closureEntries } : {}) },
    ],
    deductions: [
      { at: "post", order: 2, counter: "closureEntries", weight: 20, category: "safety" },
      { at: "post", order: 3, counter: "closureEntries", weight: 25, category: "legality" },
    ],
    tips: [
      {
        at: "afterMerge",
        order: 9,
        when: (score) => score.closureEntries,
        text: "A ROAD CLOSED barricade closes the whole street to traffic, however empty it looks. Turn off at the junction before it and follow the detour; if you only see it late, stop short of it and find another way.",
      },
    ],
    guidance: [
      {
        at: "beforeSample",
        order: 3,
        read: (score, { world, normal }) =>
          world.roadClosures?.known.size && normal && score.lastTtc >= 1.5 && knownAhead(world) ? CLOSURE_COACH : "",
      },
    ],
  },
  notice: {
    at: "beforeLeftOnRed",
    order: 7,
    duration: 3000,
    read: (world, autopilot, views) =>
      views.roadClosures ? roadClosedNotice(autopilot.enabled ? autopilot.snap : null, world) : null,
    style: (line) => (line.stop ? "safety" : ""),
  },
  perceptionLine(snap) {
    const rc = snap.road_closed;
    const text = rc
      ? `Road closed ${Math.max(0, Math.round(rc.distance_m))} m ahead${rc.street ? ` (${rc.street})` : ""}: ${rc.detour_planned ? "following the detour" : "stopping, finding a detour"}`
      : null;
    return text ? { order: 0, label: "Road closed", text } : null;
  },
  perceptionRejections: {
    enters_closed_road: "Road closed",
  },
  seen: "roadClosuresSeen",
  calls: "roadClosureCalls",
  build: (_world, { enabled, seed }) => new RoadClosures({ enabled, seed }),
  metric: {
    at: "late",
    name: "closure_entries",
    failure: "drove onto a closed road",
    label: "Drove past a ROAD CLOSED barricade onto a closed block",
    category: "observation",
  },
  // (a barricade is stopped short of, or gone round by the detour, never followed; in the forward sims it
  // stands where it is, like scenery)
  obstacle: { test: isBarricade, fixed: true },
  motion: (snap) => !!snap.road_closed?.on_route,

  obstacles(world, x, y, r) {
    return world.roadClosures?.list.length ? world.roadClosures.near(x, y, r) : null;
  },
  // (before the traffic chooses its way)
  stepBeforeTraffic(world, fleet) {
    if (world.roadClosures?.enabled) world.roadClosures.step(world, fleet);
  },
  audit: {
    at: "late",
    run(world) {
      if (world.roadClosures?.enabled) auditRoadClosures(world);
    },
  },

  // On the route, with no detour yet, or beside the detour.
  sense: {
    at: "late",
    run(world, snap, { route, frontS }) {
      if (world.roadClosures?.enabled) snap.road_closed = roadClosedSensing(world, route, frontS);
    },
  },
  // On the route, with no detour yet: be able to stop short of it.
  target: {
    at: "restrictions",
    run(snap, v, reasons, { decel }) {
      if (snap.road_closed?.on_route) {
        v = Math.min(v, Math.sqrt(2 * Math.min(decel, STOP_DECEL) * Math.max(0, snap.road_closed.bumper_to_stop_m)));
        reasons.push("road closed ahead; replan route");
      }
      return v;
    },
  },
  hazard: { at: "late", run: (snap) => (snap.road_closed ? "road closed" : null) },

  // On the route, seen at its barricades, with no detour yet: stop short of the junction before it (or,
  // past that, of the barricade) while navigation finds a way round.
  candidates: {
    at: "restrictions",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      if (snap.road_closed?.on_route) {
        out.push({
          id: "stop_for_closure",
          laneUntil,
          law: inLane({
            kind: "lane",
            vTarget: approach,
            stopAtRoute: stopAt(snap.road_closed.stop_s_route - FRONT),
            stopDecel: STOP_DECEL,
          }),
          steer: "hold lane",
          speed: "stop short of the closed road while navigation finds a detour",
        });
      }
    },
  },
  // The barricade's line, which no manoeuvre's front may reach (half a metre short of it); going on into it
  // is, first of all, onto a closed road.
  sim: {
    at: "first",
    run(_world, snap) {
      const closedLine = snap.road_closed?.on_route ? snap.road_closed.line_s_route : null;
      if (closedLine === null) return null;
      let into = false;
      return {
        start() {
          into = false;
        },
        along(s, front) {
          if (s + front > closedLine - 0.5) into = true;
        },
        reject: (c) => (into && c.law.kind !== "hard_brake" ? "enters_closed_road" : null),
      };
    },
  },

  state: {
    at: "restrictions",
    run(snap, state) {
      if (snap.road_closed) {
        const c = snap.road_closed;
        state.road_closed = {
          ...(c.street ? { street: c.street } : {}),
          barricade_in_m: r1(Math.max(0, c.distance_m)),
          on_route: c.on_route,
          detour_planned: c.detour_planned,
          ...(c.on_route ? { stop_in_m: r1(Math.max(0, c.bumper_to_stop_m)) } : {}),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "stop_for_closure" && snap.road_closed?.on_route)
        return `clear, stops ${Math.max(0, r1(snap.road_closed.bumper_to_stop_m - c.sim.progress_m))} m short of where the car waits for a detour round the closed road`;
      return null;
    },
  },
  clause: { at: "restrictions", run: (snap) => (snap.road_closed ? roadClosedClause(snap.road_closed) : null) },
  // Waiting short of a road closed for an event until a detour comes.
  holdStill: {
    at: "late",
    run: (snap) =>
      snap.road_closed?.on_route
        ? ", when the route runs onto a road closed ahead with no detour yet (`road_closed.on_route` true) and the car has reached the point where it waits (`road_closed.stop_in_m` under 2), until the detour comes"
        : "",
  },
  prompt: {
    at: "restrictions",
    text: "When road_closed.on_route is true, the route still runs onto a block closed for an event: choose stop_for_closure and wait short of it until a detour comes. Never drive past ROAD CLOSED barricades.",
  },

  // Traffic: every driver's way keeps out of a closed block (sim/npc.js NpcPath.extend).
  trafficStart(world, n) {
    if (world.roadClosures?.enabled && n.path) n.path.closures = world.roadClosures;
  },
  // A way through a closed block is re-planned while there is room.
  trafficReplan(world, n) {
    return !!(world.roadClosures?.list.length && avoidClosure(world, n));
  },
  // Short of the barricade, on a way that could not be changed in time.
  trafficYield(world, n, front) {
    const rch = world.roadClosures?.list.length ? closureHold(world, n, front) : null;
    return rch ? { hold: rch.hold, limit: null, canStop: false } : null;
  },
};
