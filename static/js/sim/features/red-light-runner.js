import { runnerNotice } from "../red-light-runner.js";
import { r1 } from "../../common.js";
import { auditRunner, createRunners, redLightRunner, runnerCap, runnerHold, runsLight } from "../red-light-runner.js";
import { junctionPlan } from "./index.js";

function runnerClause(r) {
  const w = Math.max(0, Math.round(r.bumper_to_stop_m));
  const fresh =
    r.green_for_s !== null && r.green_for_s < 4
      ? "The car's light has just turned green, but "
      : "The car's light is green, but ";
  const what =
    r.relation === "in_junction"
      ? `car \`${r.id}\` from the ${r.from} has entered the junction on its red and is crossing the car's way`
      : `car \`${r.id}\` coming from the ${r.from} at ${r1(r.speed)} m/s cannot stop before its red light's line (${Math.round(r.to_line_m)} m away) and will run the red across the car's way`;
  if (!r.wait)
    return `${fresh}${what}. The car is too close to stop before the line: look both ways and keep clear of it.`;
  return `${fresh}${what}. A green light never makes the way clear: look both ways and let a driver who cannot stop clear the junction first. ${w < 2 ? "Hold still at the line until it has gone through." : `Slow down and stop ${w} m ahead, at the line (\`wait_for_runner\`), until it has gone through.`}`;
}

export default {
  rulesStop: (snap) => snap.red_light_runner?.wait && snap.red_light_runner.bumper_to_stop_m < 1.5,
  legitimateStop: (snap) => snap?.red_light_runner?.wait && snap.red_light_runner.bumper_to_stop_m < 8,
  rulesCost: (c) => (c.id === "wait_for_runner" ? -12 : 0),
  cautious: (snap, eligible) => (snap.red_light_runner?.wait ? eligible.find((c) => c.id === "wait_for_runner") : null),
  key: "redRunners",
  coach: {
    init: () => ({
      redRunnersSeen: false,
      runnerConflicts: 0,
    }),
    seen: "redRunnersSeen",
    events: {
      fresh_green_conflict(score, ev) {
        score.runnerConflicts++;
        score.incident("fresh_green_conflict", "Entered on green ahead of a car running the red", { with: ev.with });
      },
    },
    reports: [
      {
        at: "end",
        order: 7,
        read: (score) => (score.redRunnersSeen ? { fresh_green_conflicts: score.runnerConflicts } : {}),
      },
    ],
    deductions: [{ at: "safety", order: 3, counter: "runnerConflicts", weight: 25 }],
    cap: "runnerConflicts",
    tips: [
      {
        at: "afterMerge",
        order: 1,
        when: (score) => score.runnerConflicts,
        text: "When your light turns green, don't just go: look both ways and check that cross traffic has stopped. A driver trying to beat a stale amber may run the red; let anyone who cannot stop clear the junction first.",
      },
    ],
  },
  notice: {
    at: "beforeLeftOnRed",
    order: 1,
    duration: 2500,
    read: (world, autopilot) => runnerNotice(world, autopilot.snap),
    style: (line) => (line.wait ? "safety" : "alert"),
  },
  eventBadges: {
    fresh_green_conflict: "ENTERED AHEAD OF A CAR RUNNING THE RED",
  },
  perceptionLine(snap) {
    const rr = snap.red_light_runner;
    const text = rr
      ? `Car from the ${rr.from} ${rr.relation === "in_junction" ? "running the red in the junction" : "cannot stop for its red"}: ${rr.wait ? "wait at the line" : "too close to stop, keep clear"}`
      : null;
    return text ? { order: 3, label: "Red runner", text } : null;
  },
  perceptionFocus: (snap, o) => snap.red_light_runner && o.id === snap.red_light_runner.id,
  perceptionRejections: {
    enters_ahead_of_red_light_runner: "Car running the red",
  },
  seen: "redRunnersSeen",
  build(world, options) {
    world.runnerCall = null;
    return createRunners(options);
  },
  resetContact(world) {
    world.runnerCall = null;
  },
  auditSignal(world, control, edge, rc, past, entered) {
    if (!world.redRunners.enabled) return;
    const heading = rc ? world.route.headingAt(rc.sRoute) : world.map.headingIn(edge.id);
    const runner = auditRunner(world, control.id, edge.id, rc?.turn || "straight", heading, past);
    if (!entered || !runner) return;
    world.violations.fresh_green_conflicts = (world.violations.fresh_green_conflicts || 0) + 1;
    world.events.push({ type: "fresh_green_conflict", with: runner.vehicle.id ?? null });
  },
  trafficSpeed: {
    at: "beforeControl",
    run(world, n, front) {
      return n.runner && world.redRunners?.enabled ? runnerCap(world, n, n.path, front) : Infinity;
    },
  },
  trafficSignalProceed(world, fleet, n, e, ctl, signal, bumperToLine, canStop) {
    return world.redRunners?.enabled
      ? runsLight(world, n, e, ctl, signal, bumperToLine, canStop, () => fleet.boxBusy(n, e))
      : null;
  },
  trafficSignalHold(world, n, e, ctl, bumperToLine, traffic) {
    return (
      world.redRunners?.enabled &&
      runnerHold(world, n, e.id, world.map.intersections.get(ctl.id), bumperToLine, traffic)
    );
  },
  sense: {
    at: "beforeRunner",
    run(world, snap) {
      const route = snap.route;
      if (world.redRunners?.enabled && snap.intersection?.control === "signal" && !junctionPlan(snap.intersection)) {
        const runner = redLightRunner(world, snap.intersection, route.headingAt(snap.intersection.s_line_route));
        if (runner) snap.red_light_runner = runner;
      }
    },
  },
  target: {
    at: "beforeRunner",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const rr = snap.red_light_runner;
      if (rr?.wait) {
        const vr = rr.bumper_to_stop_m < 0.5 ? 0 : stopSpeedFor(rr.bumper_to_stop_m, decel);
        if (vr < v) {
          v = vr;
          reasons.push("car running the red: wait");
        }
      }
      return v;
    },
  },
  hazard: { at: "beforeRunner", run: (snap) => (snap.red_light_runner ? "red-light runner" : null) },
  candidates: {
    at: "beforeRunner",
    run({ snap, laneUntil, nudge, approach, v, stopAt, inLane, FRONT }, out) {
      const rr = snap.red_light_runner;
      if (rr?.wait && rr.bumper_to_stop_m > 0.3) {
        out.push({
          id: "wait_for_runner",
          laneUntil,
          law: inLane({
            kind: "lane",
            offset: nudge,
            vTarget: Math.min(approach, Math.max(v, 2)),
            stopAtRoute: stopAt(rr.stop_s_route - FRONT - 0.5),
          }),
          steer: "hold lane",
          speed: "stop at the line and let the car running the red clear the junction",
        });
      }
    },
  },
  sim: {
    at: "beforeRunner",
    run(_world, snap) {
      const runner = snap.red_light_runner;
      if (!runner?.wait || runner.stop_s_route === null) return null;
      let crossed = false;
      return {
        start() {
          crossed = false;
        },
        along(s, front) {
          if (s + front > runner.stop_s_route + 0.2) crossed = true;
        },
        reject(candidate) {
          return crossed && candidate.law.kind !== "hard_brake" ? "enters_ahead_of_red_light_runner" : null;
        },
      };
    },
  },
  flagText: {
    enters_ahead_of_red_light_runner: "it enters on the green in front of a car running its red",
  },
  state: {
    at: "beforeRunner",
    run(snap, state) {
      if (snap.red_light_runner) {
        const r = snap.red_light_runner;
        state.red_light_runner = {
          id: r.id,
          coming_from: r.from,
          speed: r.speed,
          ...(r.relation === "in_junction"
            ? { in_junction: true }
            : { cannot_stop_before_its_line: true, its_line_in_m: r.to_line_m }),
          ...(r.green_for_s !== null ? { car_green_for_s: r.green_for_s } : {}),
          ...(r.wait ? { wait: true, wait_in_m: r1(Math.max(0, r.bumper_to_stop_m)) } : {}),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "wait_for_runner" && snap.red_light_runner)
        return `clear, waits ${Math.max(0, r1(snap.red_light_runner.bumper_to_stop_m - c.sim.progress_m))} m ahead, at the line, for the car running the red`;
      return null;
    },
  },
  greenSignalClause(snap, m) {
    return snap.red_light_runner
      ? `The signal ${m} m ahead is green, but a car crossing the car's way is running the red (below).`
      : null;
  },
  clause: { at: "beforeRunner", run: (snap) => snap.red_light_runner && runnerClause(snap.red_light_runner) },
  motion: (snap) => !!snap.red_light_runner?.wait,
  holdStill: {
    at: "beforeRunner",
    run: (snap) =>
      snap.red_light_runner?.wait
        ? ", when the car's light is green but a car crossing its way is running the red and the car has reached the line it waits at (`red_light_runner.wait_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "beforeRunner",
    text: `- When the car's light turns green, look both ways before going: a driver trying to beat a stale amber may run the red. Choose \`wait_for_runner\` when \`situation\` says a car crossing the car's way cannot stop before its red light's line or has already entered the junction on its red (\`red_light_runner.wait\`): stop at the line, and keep the car there until it has gone through, even though the car's light is green.`,
  },
  metric: {
    at: "beforeRunner",
    name: "fresh_green_conflicts",
    failure: "entered on green ahead of a car running the red",
    label: "Entered on green ahead of a car running the red",
    category: "observation",
    eventType: "fresh_green_conflict",
  },
};
