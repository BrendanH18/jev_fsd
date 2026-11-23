import { r1 } from "../../common.js";
import { BallChase, auditBalls, ballInRoad, ballYield, coverAfter } from "../ball-chase.js";

// Who models are told has come after a ball that rolled into the street (sim/ball-chase.js).
const BALL_CHILD = {
  not_seen: "not seen yet: may be hidden behind the parked cars",
  in_road: "in the road after the ball",
  clear: "back at the kerb",
};

// A ball rolled into the street ahead from between parked cars (sim/ball-chase.js).
function ballClause(b) {
  const lead = `A ball has rolled into the street from between the parked cars on the ${b.side}, ${Math.max(0, Math.round(b.gap_m))} m ahead.`;
  if (b.limit_mps == null)
    return b.child === "clear"
      ? `${lead} The child who ran out after it is back at the kerb; drive on with care.`
      : `${lead} The car is past where it came out.`;
  if (b.child === "in_road")
    return `${lead} A child has run out after it and is in the road: stop for them (\`pedestrian\`), and keep to ${r1(b.limit_mps)} m/s or less (\`car.target_speed\` already does) until they are back at the kerb.`;
  return `${lead} A child may run out after it at any moment, hidden by the parked cars until they are in the road. Choose \`slow_for_ball\` while this warning stands: slow to ${r1(b.limit_mps)} m/s or less (\`car.target_speed\` already does), the speed from which the car can stop short of where the ball came out, and keep to it until the child has come and gone back to the kerb${b.cover_left_s != null ? `, or ${Math.round(b.cover_left_s)} s more pass with no child` : ""}.`;
}

export default {
  rulesCost: (c, snap) => (c.id === "slow_for_ball" && !snap.pedestrian ? -4 : 0),
  cautious: (snap, eligible) =>
    snap.ball_in_road?.limit_mps != null && !snap.pedestrian ? eligible.find((c) => c.id === "slow_for_ball") : null,
  key: "balls",
  seen: "ballsSeen",
  calls: "ballCalls",
  build: (world, options) => new BallChase(world, options),
  stepAfterTraffic(world, _fleet, dt) {
    if (world.balls?.enabled) world.balls.step(dt);
  },
  audit: {
    at: "streetHazards",
    run(world) {
      if (world.balls?.enabled) auditBalls(world);
    },
  },
  metric: {
    at: "streetHazards",
    name: "ball_warnings_ignored",
    failure: "ignored a ball rolling into the street",
    label: "Drove on past where a ball rolled out, too fast to stop for a child after it",
    category: "observation",
  },
  sense: {
    at: "streetHazards",
    run(world, snap, { p, frontS }) {
      // (a ball rolled into the street ahead, a child maybe after it, with that option on: sim/ball-chase.js)
      if (world.balls?.enabled) snap.ball_in_road = world.balls.balls.length ? ballInRoad(world, p, frontS) : null;
    },
  },
  limit: {
    at: "streetHazards",
    run(snap) {
      // (and, having seen a ball roll into the street, no faster than it can stop from short of the gap it
      // came from until the child after it has come and gone: sim/ball-chase.js)
      if (snap.ball_in_road?.limit_mps != null) snap.limit = Math.min(snap.limit, snap.ball_in_road.limit_mps);
    },
  },
  target: {
    at: "streetHazards",
    run(snap, v, reasons) {
      // a ball rolled into the street (sim/ball-chase.js): `limit` is already down to the cover speed
      if (snap.ball_in_road?.limit_mps != null && snap.ball_in_road.limit_mps <= v + 0.05)
        reasons.push("ball in the road: a child may follow");
      return v;
    },
  },
  hazard: { at: "streetHazards", run: (snap) => (snap.ball_in_road ? "ball in the road" : null) },
  candidates: {
    at: "streetHazards",
    run({ snap, laneUntil, inLane, approach, v, horizon }, out) {
      // A ball rolled into the street ahead (sim/ball-chase.js): slow to the speed from which the car can
      // stop short of the gap it came from, where it will be by the end of the prediction, ready for a
      // child running out after it.
      const ball = snap.ball_in_road;
      if (ball?.limit_mps != null && ball.gap_m > 0.3) {
        out.push({
          id: "slow_for_ball",
          laneUntil,
          law: inLane({
            kind: "lane",
            vTarget: Math.min(approach, ball.limit_mps, coverAfter(ball.gap_m, v, horizon)),
          }),
          steer: "hold lane",
          speed: "slow down, ready to stop for a child running out after the ball",
        });
      }
    },
  },
  adjust: {
    at: "streetHazards",
    run({ snap, v, horizon }, list) {
      // A competing stop (for the child, a sign, or a closure) must still anticipate the
      // ball's falling cover speed, rather than chasing its instantaneous ceiling late.
      const ball = snap.ball_in_road;
      if (ball?.limit_mps != null && ball.gap_m > 0) {
        const cap = coverAfter(ball.gap_m, v, horizon);
        for (const c of list) if (c.law.kind === "lane") c.law.vTarget = Math.min(c.law.vTarget, cap);
      }
    },
  },
  sim: {
    at: "streetHazards",
    run(_world, snap) {
      const ball = snap.ball_in_road;
      if (ball?.limit_mps == null || ball.stop_s_route === null) return null;
      const line = ball.stop_s_route;
      const creep = ball.creep_mps ?? 0;
      let fast = false;
      return {
        start() {
          fast = false;
        },
        along(s, front, car) {
          if (s + front > line && car.v > creep + 1) fast = true;
        },
        reject(c) {
          return fast && c.law.kind !== "hard_brake" ? "passes_ball_gap_too_fast" : null;
        },
      };
    },
  },
  state: {
    at: "streetHazards",
    run(snap, state) {
      if (snap.ball_in_road) {
        const b = snap.ball_in_road;
        state.ball_in_road = {
          rolled_out_from: `between the parked cars on the ${b.side}`,
          gap_m: r1(b.gap_m),
          ball: b.ball,
          child: BALL_CHILD[b.child],
          ...(b.limit_mps != null
            ? {
                warning: true,
                slow_to: r1(b.limit_mps),
                ...(b.cover_left_s != null ? { warning_lifts_in_s: r1(b.cover_left_s) } : {}),
              }
            : { warning: false }),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "slow_for_ball" && snap.ball_in_road)
        return `clear, slows to ${r1(c.sim.end_speed)} m/s, able to stop short of where the ball came out`;
      return null;
    },
  },
  clause: { at: "streetHazards", run: (snap) => (snap.ball_in_road ? ballClause(snap.ball_in_road) : null) },
  prompt: {
    at: "streetHazards",
    text: `- A ball rolling into the street (\`ball_in_road\`) is a warning that a child may run out after it, hidden by the parked cars until they are in the road. While \`ball_in_road.warning\` is true, choose \`slow_for_ball\` (or another candidate whose \`end_speed\` is at or below \`ball_in_road.slow_to\`): the speed from which the car can stop short of where the ball came out. Keep to it until \`ball_in_road.child\` says the child is back at the kerb, or the warning lifts. Once the child is in the road, stop for them as for anyone crossing.`,
  },
  trafficSpeed(world, n, front) {
    return world.balls?.balls.length && !n.transit?.tram ? (ballYield(world, n, front)?.limit ?? Infinity) : Infinity;
  },
};
