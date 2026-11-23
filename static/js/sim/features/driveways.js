import { r1 } from "../../common.js";
import {
  DrivewayReversers,
  auditReversers,
  boxGap,
  reverserBoxAt,
  reverserHidden,
  reverserYield,
  reversingVehicle,
} from "../driveway-reversers.js";

const REVERSING_PHASE = {
  backing_out: "backing out toward the lane, across the sidewalk",
  backing_into_lane: "backing into the car's lane",
  stopped_in_lane: "stopped in the car's lane, about to drive off",
};

// A car backing out of a driveway ahead (sim/driveway-reversers.js).
function reversingClause(r) {
  const w = Math.max(0, Math.round(r.bumper_to_stop_m ?? 0));
  const lead = `Car \`${r.id}\` ahead, ${Math.round(r.gap_m)} m from where its way meets the car's, is ${REVERSING_PHASE[r.phase]} from a driveway on the ${r.side}${r.reverse_lights ? ", its reverse lights on" : ""}.`;
  if (r.wait)
    return `${lead} It is coming into the car's lane: give it room to finish. ${w < 2 ? "Hold still until it has driven off." : `Slow down and stop ${w} m ahead (\`yield_to_reversing\`), and stay stopped until it has driven off.`} Never squeeze past behind it.`;
  return `${lead} It may back out into the car's lane at any moment: slow to ${r1(r.limit_mps)} m/s, ready to stop (\`car.target_speed\` already does), and pass it no closer than ${r.min_pass_m} m.`;
}

export default {
  rulesStop: (snap) => snap.reversing_vehicle?.wait && snap.reversing_vehicle.bumper_to_stop_m < 1.5,
  legitimateStop: (snap) => snap?.reversing_vehicle?.wait && snap.reversing_vehicle.bumper_to_stop_m < 8,
  rulesCost: (c, snap) => (c.id === "yield_to_reversing" && snap.reversing_vehicle?.wait ? -6 : 0),
  cautious: (snap, eligible) =>
    snap.reversing_vehicle?.wait ? eligible.find((c) => c.id === "yield_to_reversing") : null,
  key: "driveways",
  seen: "drivewaysSeen",
  calls: "drivewayCalls",
  build: (world, options) => new DrivewayReversers(world, options),
  obstacles: (world, x, y, r) => (world.driveways?.cars.length ? world.driveways.near(x, y, r) : null),
  obstacle: {
    test: (o) => !!o.reverser,
    traffic: true,
    predict: reverserBoxAt,
    visible: (world, observer, o) => !(world.hazards && reverserHidden(world, observer, o)),
  },
  stepAfterTraffic(world, fleet, dt) {
    if (world.driveways?.enabled) world.driveways.step(dt, fleet);
  },
  audit: {
    at: "driveways",
    run(world) {
      if (world.driveways.enabled) auditReversers(world);
    },
  },
  metric: {
    at: "driveways",
    name: "reversing_conflicts",
    failure: "squeezed past or failed to stop for a car backing out",
    label: "Squeezed past or failed to stop for a car backing out of a driveway",
    category: "observation",
  },
  sense: {
    at: "driveways",
    run(world, snap, { p, frontS, lane }) {
      if (world.driveways?.enabled)
        snap.reversing_vehicle = world.driveways.cars.length ? reversingVehicle(world, p, frontS, lane) : null;
    },
  },
  limit: {
    at: "driveways",
    run(snap) {
      if (snap.reversing_vehicle?.limit_mps != null)
        snap.limit = Math.min(snap.limit, snap.reversing_vehicle.limit_mps);
    },
  },
  target: {
    at: "driveways",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const rv = snap.reversing_vehicle;
      if (rv?.wait) {
        const vr = rv.bumper_to_stop_m < 1.0 ? 0 : stopSpeedFor(rv.bumper_to_stop_m - 0.5, decel);
        if (vr < v) {
          v = vr;
          reasons.push("car backing out of a driveway");
        }
      } else if (rv?.limit_mps != null && rv.limit_mps <= v + 0.05) reasons.push("car backing out ahead");
      return v;
    },
  },
  hazard: { at: "driveways", run: (snap) => (snap.reversing_vehicle ? "reversing vehicle" : null) },
  candidates: {
    at: "driveways",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      const rv = snap.reversing_vehicle;
      if (rv && (!rv.wait || rv.bumper_to_stop_m > 0.3)) {
        out.push({
          id: "yield_to_reversing",
          laneUntil,
          law: inLane({
            kind: "lane",
            vTarget: Math.min(approach, rv.limit_mps ?? approach),
            ...(rv.wait ? { stopAtRoute: stopAt(rv.stop_s_route - FRONT - 0.5) } : {}),
          }),
          steer: "hold lane",
          speed: rv.wait
            ? "stop and give the car backing out room to finish"
            : "slow down, ready to stop for the car backing out",
        });
      }
    },
  },
  sim: {
    at: "driveways",
    run(_world, snap) {
      const rv = snap.reversing_vehicle;
      if (!rv) return null;
      const stop = rv.wait ? rv.stop_s_route : null;
      const clearance = rv.min_pass_m ?? null;
      let close = false;
      return {
        start() {
          close = false;
        },
        along(s, front) {
          if (stop !== null && s + front > stop + 1) close = true;
        },
        near(car, box, obstacle, predicted) {
          if (clearance !== null && obstacle.reverseLamps && car.v > 1 && boxGap(box, predicted) < clearance)
            close = true;
        },
        reject(c) {
          return close && c.law.kind !== "hard_brake" ? "passes_reversing_vehicle_too_close" : null;
        },
      };
    },
  },
  state: {
    at: "driveways",
    run(snap, state) {
      if (snap.reversing_vehicle) {
        const r = snap.reversing_vehicle;
        state.reversing_vehicle = {
          id: r.id,
          backing_out_of: `a driveway on the ${r.side}`,
          reverse_lights: r.reverse_lights,
          now: REVERSING_PHASE[r.phase],
          gap_m: r1(r.gap_m),
          ...(r.wait ? { yield: true, wait_in_m: r1(Math.max(0, r.bumper_to_stop_m)) } : { slow_to: r1(r.limit_mps) }),
          min_passing_distance_m: r.min_pass_m,
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "yield_to_reversing" && snap.reversing_vehicle)
        return snap.reversing_vehicle.wait
          ? `clear, stops ${Math.max(0, r1(snap.reversing_vehicle.bumper_to_stop_m - c.sim.progress_m))} m short of where it waits for the car backing out`
          : "clear, slows for the car backing out";
      return null;
    },
  },
  clause: { at: "driveways", run: (snap) => (snap.reversing_vehicle ? reversingClause(snap.reversing_vehicle) : null) },
  motion: (snap) => snap.reversing_vehicle?.wait,
  holdStill: {
    at: "driveways",
    run: (snap) =>
      snap.reversing_vehicle?.wait
        ? ", when a car backing out of a driveway is coming into the car's lane and the car has reached the point where it stops for it (`reversing_vehicle.wait_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "driveways",
    text: `- Watch driveways for reversing lights (\`reversing_vehicle\`). While a car backs out toward the car's lane, slow to \`reversing_vehicle.slow_to\`, ready to stop, and pass it no closer than \`reversing_vehicle.min_passing_distance_m\`. Choose \`yield_to_reversing\` when \`situation\` says it is coming into the car's lane: stop short of it and keep the car stopped until it has driven off. Never squeeze past behind it.`,
  },
  trafficYield(world, n, front) {
    const rv = world.driveways?.cars.length && !n.transit?.tram ? reverserYield(world, n, front) : null;
    return rv ? { hold: rv.hold, limit: rv.limit, canStop: true } : null;
  },
};
