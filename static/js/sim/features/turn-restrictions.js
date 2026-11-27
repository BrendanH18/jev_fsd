// Turn restrictions (sim/turn-restrictions.js) as a feature record (sim/features/index.js,
// docs/feature-interface.md).
import { projectPoint } from "../../map/mapdata.js";
import { auditRestrictions, turnBanned, turnRestrictionAhead } from "../turn-restrictions.js";

export default {
  routeOptions: (world) =>
    world.restrictions
      ? { restrictions: true, hour: world.clock?.hour ?? 15.5, weekday: world.clock?.weekday ?? 0 }
      : null,
  requestReroute: {
    at: "beforeOffRoute",
    run(pilot, snap) {
      const { t } = pilot.world;
      if (!snap.turn_restriction?.banned || t < (pilot.restrictionReplanAt ?? -Infinity)) return false;
      pilot.restrictionReplanAt = t + 5;
      return true;
    },
  },
  rulesStop: {
    at: "beforeSignal",
    run: (snap) => !!(snap.turn_restriction?.banned && snap.turn_restriction.distance_m < 12),
  },
  rulesCost: { at: "beforeStops", run: (c) => (c.id === "stop_for_turn_restriction" ? -30 : 0) },
  cautious: {
    at: "beforeBusLanes",
    run: (_snap, eligible) => eligible.find((c) => c.id === "stop_for_turn_restriction"),
  },
  cautiousStop: (snap) => !!(snap.turn_restriction?.banned && snap.turn_restriction.distance_m < 12),
  key: "restrictions",
  view: () => import("../../render/turn-restrictions.js"),
  weekday: true,
  coach: {
    init: () => ({
      illegalTurns: 0,
      restricted: false,
    }),
    observe(score, world) {
      if (world.restrictionsSeen) {
        score.restricted = true;
        score.illegalTurns = (world.violations.illegal_turns || 0) - (score.baseline.illegal_turns || 0);
      }
    },
    events: {
      illegal_turn(score, ev) {
        score.incident("illegal_turn", "Made a prohibited turn", { from: ev.from, to: ev.to });
      },
    },
    reports: [
      { at: "end", order: 3, read: (score) => (score.restricted ? { illegal_turns: score.illegalTurns } : {}) },
    ],
    deductions: [{ at: "beforeLegality", order: 0, counter: "illegalTurns", weight: 25 }],
    tips: [
      {
        at: "afterBusLanes",
        order: 0,
        when: (score) => score.illegalTurns,
        text: "Obey turn restriction signs while their posted hours apply; follow a legal route around the block.",
      },
    ],
  },
  seen: "restrictionsSeen",
  build(world, { enabled }) {
    world.restrictionEdge = null;
    return !!enabled;
  },
  resetContact(world) {
    world.restrictionEdge = null;
  },
  metric: {
    at: "turns",
    name: "illegal_turns",
    failure: "made a prohibited turn",
    label: "Made a prohibited turn",
    category: "right_of_way",
    eventType: "illegal_turn",
  },

  audit: {
    at: "afterCalming",
    run(world) {
      if (world.restrictions) auditRestrictions(world);
    },
  },
  sense: {
    at: "beforeTarget",
    run(world, snap) {
      if (world.restrictions && snap.routeProj) snap.turn_restriction = turnRestrictionAhead(world, snap.routeProj.s);
    },
  },
  target: {
    at: "restrictions",
    run(snap, v, reasons, { decel, FRONT }) {
      if (snap.turn_restriction?.banned) {
        v = Math.min(v, Math.sqrt(2 * decel * Math.max(0, snap.turn_restriction.distance_m - FRONT - 8)));
        reasons.push("prohibited turn; replan route");
      }
      return v;
    },
  },
  candidates: {
    at: "restrictions",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      if (snap.turn_restriction?.banned) {
        const at = Math.min(
          snap.routeProj.s + snap.turn_restriction.distance_m - FRONT - 8,
          snap.intersection && !snap.intersection.entered ? snap.intersection.s_line_route - FRONT - 0.5 : Infinity,
        );
        out.push({
          id: "stop_for_turn_restriction",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(at) }),
          steer: "hold lane",
          speed: "stop before the prohibited turn while navigation finds a legal detour",
        });
      }
    },
  },

  state: {
    at: "restrictions",
    run(snap, state) {
      if (snap.turn_restriction) state.turn_restriction = snap.turn_restriction;
    },
  },
  clause: {
    at: "restrictions",
    run: (snap) =>
      snap.turn_restriction?.banned
        ? "The planned turn is prohibited now: stop before the junction and follow a legal detour."
        : null,
  },
  prompt: {
    at: "restrictions",
    text: "When turn_restriction.banned is true, stop before the junction and request a legal route. Conditional signs apply only while in_effect is true.",
  },

  trafficTurnBlocked(world, from, to, bike) {
    return !!(world?.restrictions && !bike && turnBanned(world.map, from, to, world.clock));
  },
  trafficReplan: {
    at: "beforeCorner",
    run(world, n) {
      const path = n.path;
      if (!world.restrictions || path.bike || n.transit) return false;
      path.constraintsWorld = world;
      const cur = path.currentEdge(),
        next = path.edges[path.edges.indexOf(cur) + 1];
      if (next && turnBanned(world.map, cur.id, next.id, world.clock) && cur.sEnd - path.s > 12) {
        const lane = world.map.lane(cur.id, cur.lane),
          at = projectPoint(lane.pts, lane.cum, [n.x, n.y]).s;
        path.start(cur.id, cur.lane, at);
        return true;
      }
      return false;
    },
  },
};
