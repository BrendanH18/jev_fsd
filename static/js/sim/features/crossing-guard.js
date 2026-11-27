// School crossing guards (sim/crossing-guard.js) as a feature record (sim/features/index.js,
// docs/feature-interface.md).
import { guardNotice } from "../crossing-guard.js";
import { r1 } from "../../common.js";
import { CrossingGuards, LOOK_M, STOP_M, frontToCentre, stopKey } from "../crossing-guard.js";
import { crosswalksAlong } from "../crosswalk.js";

const AUDIT_GUARD_PAST_M = 2;
const AUDIT_GUARD_MOVING_MPS = 1;
const READY_MIN_MPS = 4;

// Driving past a school crossing guard's STOP sign once the stop was owed.
function auditGuards(world) {
  const g = world.crossingGuards,
    ego = world.ego;
  for (const post of g.posts) {
    if (!post.onDuty || Math.abs(post.mid[0] - ego.x) > 60 || Math.abs(post.mid[1] - ego.y) > 60) continue;
    const holding = post.paddleUp || g.inRoad(post).length > 0;
    if (!holding) continue;
    const d = frontToCentre(post.cw, ego);
    if (d === null || d < -2) continue;
    const key = stopKey(post);
    let rec = world.guardCalls.get(key);
    // (the manager remembers whether the car could stop when the sign rose)
    if (!rec && world.sees(ego, post.guard))
      world.guardCalls.set(key, (rec = { owed: g.owes(post, ego, d - STOP_M), counted: false }));
    if (rec?.owed && !rec.counted && d < STOP_M - AUDIT_GUARD_PAST_M && ego.v > AUDIT_GUARD_MOVING_MPS) {
      rec.counted = true;
      world.violations.guard_violations = (world.violations.guard_violations || 0) + 1;
      world.events.push({
        type: "passed_crossing_guard",
        guard: post.id,
        crosswalk: post.cw.id,
        in_road: g.inRoad(post).length,
      });
    }
  }
  if (world.guardCalls.size > 20)
    for (const key of [...world.guardCalls.keys()].slice(0, 10)) world.guardCalls.delete(key);
}

// A school crossing guard at a marked crosswalk on the car's route ahead (sim/crossing-guard.js).
function crossingGuard(world, frontS) {
  const g = world.crossingGuards;
  if (!g?.enabled || !g.posts.length) return null;
  const { ego, route } = world;
  for (const { cw, s } of crosswalksAlong(route, world.crowd)) {
    if (s + 2 < frontS) continue;
    if (s - frontS > LOOK_M) break;
    const post = g.at(cw.id);
    if (!post) continue;
    const guard = post.guard,
      stop = s - STOP_M;
    const inRoad = g.inRoad(post),
      up = post.paddleUp || inRoad.length > 0;
    const visible = world.sees(ego, guard);
    // Once observed, a raised sign remains binding if traffic temporarily hides the guard.
    if (!visible && !(up && post.egoSawStop)) continue;
    if (visible && up) post.egoSawStop = true;
    const owed = up && g.owes(post, ego, stop - frontS);
    const waiting = g.waiting(post).length;
    return {
      id: post.id,
      guard_id: guard.id,
      crosswalk_id: cw.id,
      ...(post.zone?.name ? { school: post.zone.name } : {}),
      paddle: post.paddleUp ? "up" : "down",
      phase: post.phase,
      in_road: inRoad.map((p) => p.id),
      waiting,
      crosswalk_s_route: s,
      bumper_to_crosswalk_m: s - frontS,
      stop_s_route: stop,
      bumper_to_stop_m: stop - frontS,
      wait: up && owed,
      ready: !up && waiting > 0,
    };
  }
  return null;
}

// A school crossing guard at a crosswalk on the route ahead, for models.
function guardClause(g) {
  const at = Math.max(0, Math.round(g.bumper_to_crosswalk_m)),
    w = Math.max(0, Math.round(g.bumper_to_stop_m));
  const lead = `A school crossing guard (\`${g.guard_id}\`) works the marked crosswalk ${at < 2 ? "in front of the car" : `${at} m ahead`}${g.school ? `, by ${g.school}` : ""}.`;
  const who = g.in_road.length
    ? ` ${g.in_road.length === 1 ? "One person is" : `${g.in_road.length} people are`} still in the road (${g.in_road.map((id) => `\`${id}\``).join(", ")}).`
    : "";
  if (g.wait)
    return `${lead} The guard ${g.paddle === "up" ? "is holding up the STOP sign" : "has lowered the STOP sign"}, walking children across.${who} Traffic both ways must stop short of the crosswalk and stay stopped until the guard and every child are off the road, not just out of the car's lane: ${w < 2 ? "hold still where the car is." : `slow down and stop ${w} m ahead (\`stop_for_crossing_guard\`).`}`;
  if (g.paddle === "up" || g.in_road.length)
    return `${lead} The guard is holding up the STOP sign, but the car was too close to stop for it when it went up: go on slowly, giving way to anyone in its path.${who}`;
  if (g.ready)
    return `${lead} ${g.waiting === 1 ? "A child is" : `${g.waiting} children are`} waiting at the curb with the guard, who will step out with the STOP sign once traffic can stop: slow down, ready to stop short of the crosswalk; \`car.target_speed\` already does.`;
  return `${lead} Nobody is crossing now: go on with care.`;
}

export default {
  rulesStop: (snap) => !!(snap.crossing_guard?.wait && snap.crossing_guard.bumper_to_stop_m < 1.5),
  legitimateStop: (snap) => !!(snap?.crossing_guard?.wait && snap.crossing_guard.bumper_to_stop_m < 8),
  rulesCost: { at: "stops", run: (c) => (c.id === "stop_for_crossing_guard" ? -6 : 0) },
  cautious: { at: "afterPassing", run: (_snap, eligible) => eligible.find((c) => c.id === "stop_for_crossing_guard") },
  key: "guards",
  view: () => import("../../render/crossing-guard.js"),
  coach: {
    init: () => ({
      guards: false,
      guardViolations: 0,
    }),
    seen: "guards",
    events: {
      passed_crossing_guard(score, ev) {
        score.guardViolations++;
        score.incident("guard_violation", "Drove past a school crossing guard’s STOP sign", {
          guard: ev.guard,
          in_road: ev.in_road,
        });
      },
    },
    reports: [
      { at: "end", order: 6, read: (score) => (score.guards ? { guard_violations: score.guardViolations } : {}) },
    ],
    deductions: [{ at: "legality", order: 0, counter: "guardViolations", weight: 25 }],
    tips: [
      {
        at: "afterMerge",
        order: 15,
        when: (score) => score.guardViolations,
        text: "When a school crossing guard holds up the STOP sign, stop before the crosswalk and stay stopped until the guard and every child are off the road, not just out of your lane. Slow down whenever children wait at the curb with a guard.",
      },
    ],
    guidance: [
      {
        at: "afterDirection",
        order: 0,
        read: (score, { world, speed }) =>
          score.guards && world.crossingGuards?.notice()?.stop && speed > 1
            ? "Stop for the crossing guard, and wait until everyone is across."
            : "",
      },
    ],
  },
  notice: {
    at: "end",
    order: 0,
    duration: 2500,
    read: (world) => guardNotice(world),
    style: (line) => (line.stop ? "safety" : ""),
  },
  eventBadges: {
    passed_crossing_guard: "DROVE PAST THE CROSSING GUARD'S STOP SIGN",
  },
  perceptionLine(snap) {
    const cg = snap.crossing_guard;
    const text = cg
      ? `Crossing guard ${Math.round(Math.max(0, cg.bumper_to_crosswalk_m))} m ahead: ${cg.wait ? `STOP${cg.in_road.length ? `, ${cg.in_road.length} in the road` : ""}, wait in ${Math.max(0, Math.round(cg.bumper_to_stop_m))} m` : cg.paddle === "up" || cg.in_road.length ? "STOP sign up, too close to stop" : cg.ready ? `${cg.waiting} waiting to cross, ready to stop` : "nobody crossing"}`
      : null;
    return text ? { order: 19, label: "Crossing guard", text } : null;
  },
  perceptionFocus: (snap, o) => o.id === snap.crossing_guard?.guard_id,
  perceptionRejections: {
    passes_crossing_guard: "Crossing guard: STOP",
  },
  property: "crossingGuards",
  seen: "guardsSeen",
  calls: "guardCalls",
  snapshot: { crossing_guard: null },
  build: (world, { enabled, seed }) => new CrossingGuards(world, { enabled, seed }),
  metric: {
    at: "guards",
    name: "guard_violations",
    failure: "drove past a crossing guard's stop sign",
    label: "Drove past a school crossing guard's STOP sign",
    category: "right_of_way",
    eventType: "passed_crossing_guard",
  },
  flagText: {
    passes_crossing_guard: "it goes past a crossing guard's STOP sign",
  },
  motion: (snap) => !!snap.crossing_guard?.wait,

  stepBeforeTraffic(world, _fleet, dt) {
    if (world.crossingGuards?.enabled) world.crossingGuards.step(dt);
  },
  audit: {
    at: "beforeDriveways",
    run(world) {
      if (world.crossingGuards.enabled) auditGuards(world);
    },
  },
  checkpoint(world) {
    if (world.crossingGuards) world.crossingGuards.world = world;
  },

  sense: {
    at: "beforeRunner",
    run(world, snap, { frontS }) {
      snap.crossing_guard = crossingGuard(world, frontS);
    },
  },
  target: {
    at: "afterSchoolBus",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const cg = snap.crossing_guard;
      if (cg && (cg.wait || (cg.ready && cg.bumper_to_stop_m > 0))) {
        const room = cg.bumper_to_stop_m;
        const vg = cg.wait
          ? room < 1.0
            ? 0
            : stopSpeedFor(room - 0.5, decel)
          : Math.max(READY_MIN_MPS, stopSpeedFor(room, decel));
        if (vg < v) {
          v = vg;
          reasons.push(cg.wait ? "crossing guard holding up STOP" : "children waiting to cross with a crossing guard");
        }
      }
      return v;
    },
  },
  hazard: { at: "beforeRunner", run: (snap) => (snap.crossing_guard ? "crossing guard" : null) },
  candidates: {
    at: "afterFlagger",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      const cg = snap.crossing_guard;
      if (cg?.wait && cg.bumper_to_stop_m > 0.3) {
        out.push({
          id: "stop_for_crossing_guard",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(cg.stop_s_route - FRONT - 0.5) }),
          steer: "hold lane",
          speed: "stop short of the crosswalk for the crossing guard's STOP sign",
        });
      }
    },
  },
  sim: {
    at: "parking",
    run(world, snap) {
      if (!snap.crossing_guard?.wait) return null;
      const startS = snap.routeProj ? snap.routeProj.s : 0;
      const frontM = world.ego.spec.length - world.ego.spec.rearOverhang;
      const guardStop = Math.max(snap.crossing_guard.stop_s_route, startS + frontM);
      let passes = false;
      return {
        start() {
          passes = false;
        },
        along(s, front) {
          if (s + front > guardStop + 1.5) passes = true;
        },
        reject: (c) => (passes && c.law.kind !== "hard_brake" ? "passes_crossing_guard" : null),
      };
    },
  },

  state: {
    at: "beforePlow",
    run(snap, state) {
      if (snap.crossing_guard) {
        const g = snap.crossing_guard;
        state.crossing_guard = {
          id: g.guard_id,
          crosswalk: g.crosswalk_id,
          ...(g.school ? { school: g.school } : {}),
          stop_sign: g.paddle === "up" ? "held up" : "down",
          ...(g.in_road.length ? { in_road: g.in_road } : {}),
          ...(g.waiting ? { children_waiting: g.waiting } : {}),
          crosswalk_m: r1(Math.max(0, g.bumper_to_crosswalk_m)),
          ...(g.wait ? { stop: true, wait_in_m: r1(Math.max(0, g.bumper_to_stop_m)) } : {}),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "stop_for_crossing_guard" && snap.crossing_guard)
        return `clear, stops ${Math.max(0, r1(snap.crossing_guard.bumper_to_stop_m - c.sim.progress_m))} m short of where the car waits for the crossing guard, short of the crosswalk`;
      return null;
    },
  },
  clause: { at: "afterJunctionBox", run: (snap) => (snap.crossing_guard ? guardClause(snap.crossing_guard) : null) },
  holdStill: {
    at: "afterFlagger",
    run: (snap) =>
      snap.crossing_guard?.wait
        ? ", when a school crossing guard holds up the STOP sign, or the guard or a child is still in the road, and the car has stopped short of the crosswalk (`crossing_guard.wait_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "beforeSchoolBus",
    text: `- Choose \`stop_for_crossing_guard\` when \`situation\` says a school crossing guard holds up the STOP sign at a crosswalk ahead, or the guard or a child is still in the road there: stop short of the crosswalk, and keep the car stopped until \`crossing_guard.stop\` is gone, when the guard and every child are off the road, even once the car's own lane is clear. With children waiting at the curb, slow down, ready to stop.`,
  },

  trafficStop: {
    at: "afterMerge",
    run(world, _fleet, n, front) {
      const cg = world.crossingGuards;
      if (!cg?.active) return null;
      const hit = cg.holdAhead(n.path.pts, n.path.cum, front - STOP_M, front + LOOK_M);
      if (!hit) {
        n.guardStop = null;
        return null;
      }
      const toStop = hit.s - STOP_M - front;
      if (!cg.owes(hit.post, n, toStop)) return null;
      n.guardStop = hit.key;
      return Math.max(0.05, toStop - 0.5);
    },
  },
};
