// Snowbanks (sim/snowbanks.js) as a feature record (sim/features/index.js, docs/feature-interface.md).
import { r1 } from "../../common.js";
import {
  NARROW_FULL_M,
  Snowbanks,
  WAIT_M,
  auditSnowbanks,
  bankHidden,
  keepAt,
  snowbankAhead,
  snowbankYield,
} from "../snowbanks.js";

const SB_SHIFT_MPS = 0.6; // traffic moving over toward the middle between snowbanks

// Snowbanks ahead, for models: a stretch they narrow to one car at a time, and a corner they hide.
function snowbankClauses({ narrowing: n, corner: k }) {
  const out = [];
  if (n) {
    const where = n.inside
      ? "The car is in a stretch"
      : `${Math.round(Math.max(0, n.gap_m))} m ahead is a ${n.length_m} m stretch`;
    const lead = `${where} of ${n.street || "the street"} where snowbanks have pushed the parked cars out from both kerbs, leaving room for only one moving car at a time. Drivers take turns: whoever is already in the stretch, or too close to stop short of it, goes first, then whoever got to their end of it first.`;
    if (n.wait)
      out.push(
        `${lead} It is the turn of the car coming the other way${n.oncoming?.inside ? ", which is already in the stretch" : n.reason === "turn" ? ", which got to its end first" : ", which is too close to stop"}: stop short of the stretch and wait there until it is through (\`wait_for_oncoming_narrowing\`${Math.round(n.bumper_to_stop_m) < 2 ? ", holding still" : `, stopping ${Math.max(0, Math.round(n.bumper_to_stop_m))} m ahead`}). Never enter while it is their turn.`,
      );
    else if (n.squeeze)
      out.push(
        `${lead} A car coming the other way is in the stretch too: squeeze past each other at walking pace, ${r1(n.limit_mps)} m/s or less (\`car.target_speed\` already does), keeping to the middle.`,
      );
    else
      out.push(
        `${lead} ${n.inside ? "It is the car's turn: carry on through" : "It is the car's turn: nobody coming the other way has the way, so go on in"}, over toward the middle and clear of the parked cars, at ${r1(n.limit_mps)} m/s or less (\`car.target_speed\` already does).`,
      );
  }
  if (k)
    out.push(
      `A high snowbank at the ${k.side === "both" ? "corners" : `${k.side} corner`} of the junction ${Math.round(k.gap_m)} m ahead hides anyone waiting there to cross, and anything small coming out of the side street: creep up to ${r1(k.limit_mps)} m/s or less (\`car.target_speed\` already does), ready to stop for someone stepping out from behind it.`,
    );
  return out;
}

export default {
  key: "snowbanks",
  seen: "snowbanksSeen",
  calls: "snowbankCalls",
  // the banks, piles and narrowings; a car placed in a narrowing keeps over toward the middle
  build(world, { enabled, seed, map }) {
    const sb = new Snowbanks(world, { enabled, seed });
    if (sb.narrowings.length) {
      const near = map.nearestLane(world.ego.x, world.ego.y, world.ego.psi);
      if (near) sb.place(world.ego, near.lane);
      world.resetContactHistory();
    }
    return sb;
  },
  metric: {
    at: "tailgaters",
    name: "snowbank_conflicts",
    failure: "entered a stretch narrowed by snowbanks out of turn",
  },
  motion: (snap) => !!snap.snowbank?.narrowing?.wait,

  // Who has come up to each narrowed stretch, and who has gone in, before the traffic takes its turns.
  stepBeforeTraffic(world, _fleet, dt) {
    if (world.snowbanks?.enabled) world.snowbanks.step(dt);
  },
  audit: {
    at: "tailgaters",
    run(world) {
      if (world.snowbanks?.enabled) auditSnowbanks(world);
    },
  },
  // A high snowbank at a corner hides people, cyclists and cars behind it from the car.
  hides: (world, observer, o) =>
    !!(world.snowbanks?.piles.length && observer === world.ego && bankHidden(world, observer, o)),
  // ...and the view along a street from the corner.
  blocksView: (world, from, to) => !!(world.snowbanks?.piles.length && world.snowbanks.blocksView(from, to)),
  // The car put down on a lane by hand, in a narrowing, keeps over toward the middle.
  placeEgo(world, lane) {
    if (world.snowbanks?.narrowings.length) world.snowbanks.place(world.ego, lane);
  },
  // The emergency audit: in a narrowing the usable right edge (where the pushed-out parked cars leave
  // room) replaces the old lane centre, so a stopped car must not drive into them to satisfy it.
  evKerb(world, road, front) {
    const ego = world.ego;
    const narrowed = world.snowbanks?.enabled && road.lane && road.edge && world.snowbanks.on(road.edge.id);
    const entry = narrowed && (narrowed.dir > 0 ? narrowed.nw.a : narrowed.nw.L - narrowed.nw.b);
    const exit = narrowed && (narrowed.dir > 0 ? narrowed.nw.b : narrowed.nw.L - narrowed.nw.a);
    return narrowed && road.s + front >= entry - NARROW_FULL_M && road.s - ego.spec.rearOverhang <= exit + NARROW_FULL_M
      ? keepAt(road.edge, ego.spec) - road.lane.offset
      : Infinity;
  },
  // Pulling over for an emergency vehicle after a corner: short of a one-car corridor, whose approach
  // detour is not a place to stop while pulling right.
  evStop(world, route, frontS, v, stop, decel) {
    for (const nw of world.snowbanks?.narrowings || []) {
      const ends = world.snowbanks.alongRoute(route, nw);
      if (ends && ends.en - WAIT_M - frontS >= (v * v) / (2 * decel) && stop >= ends.en - WAIT_M)
        stop = Math.min(stop, ends.en - WAIT_M);
    }
    return stop;
  },

  // The car's sensing: a narrowed stretch to take turns through, and corners they hide.
  sense: {
    at: "balls",
    run(world, snap, { p, frontS }) {
      if (world.snowbanks?.enabled) snap.snowbank = snowbankAhead(world, p, frontS);
    },
  },
  // (over toward the middle between snowbanks)
  detour: { at: "contraflow", run: (snap) => snap.snowbank?.narrowing?.detour },
  // (through a narrowed stretch, and up to a corner a snowbank hides)
  limit: {
    at: "balls",
    run(snap) {
      if (snap.snowbank?.narrowing?.limit_mps != null)
        snap.limit = Math.min(snap.limit, snap.snowbank.narrowing.limit_mps);
      if (snap.snowbank?.corner) snap.limit = Math.min(snap.limit, snap.snowbank.corner.limit_mps);
    },
  },
  // Wait short of the one-car stretch while it is the oncoming car's turn; `limit` is already down to the
  // speed through it, and to the creep up to a hidden corner.
  target: {
    at: "balls",
    run(snap, v, reasons, { decel, stopSpeedFor }) {
      const nb = snap.snowbank?.narrowing;
      if (nb?.wait) {
        const vn = nb.bumper_to_stop_m < 1.0 ? 0 : stopSpeedFor(nb.bumper_to_stop_m - 0.5, decel);
        if (vn < v) {
          v = vn;
          reasons.push("oncoming car's turn between the snowbanks");
        }
      } else if (nb?.limit_mps != null && nb.limit_mps <= v + 0.05)
        reasons.push(nb.squeeze ? "squeezing past an oncoming car between the snowbanks" : "narrowed by snowbanks");
      if (snap.snowbank?.corner && snap.snowbank.corner.limit_mps <= v + 0.05)
        reasons.push("snowbank hides the corner");
      return v;
    },
  },
  hazard: {
    at: "officers",
    run(snap) {
      const f = [];
      if (snap.snowbank?.narrowing) f.push("snowbank narrowing");
      if (snap.snowbank?.corner) f.push("snowbank corner");
      return f;
    },
  },

  // While it is the turn of a car coming the other way through the one-car stretch ahead, stop short of
  // it and wait.
  candidates: {
    at: "tailgaters",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      const nb = snap.snowbank?.narrowing;
      if (nb?.wait && nb.bumper_to_stop_m > 0.3) {
        out.push({
          id: "wait_for_oncoming_narrowing",
          laneUntil,
          law: inLane({
            kind: "lane",
            vTarget: Math.min(approach, nb.limit_mps ?? approach),
            stopAtRoute: stopAt(nb.stop_s_route - FRONT - 0.5),
          }),
          steer: "hold lane",
          speed: "stop short of the stretch narrowed by snowbanks and let the oncoming car through",
        });
      }
    },
  },
  // Stopping for an emergency vehicle before the narrowed stretch: pull right there, rather than pursuing
  // the stretch's upcoming move left into the shared corridor while trying to pull over.
  pullOverDetour: (snap, detour, stopS) =>
    !!(detour?.id?.startsWith("sb:") && stopS < snap.snowbank.narrowing.entry_s_route),
  // No manoeuvre may go a metre past where the car waits its turn (but never into the stretch itself).
  sim: {
    at: "balls",
    run(_world, snap) {
      const narrowStop = snap.snowbank?.narrowing?.wait
        ? Math.min(snap.snowbank.narrowing.stop_s_route + 1, snap.snowbank.narrowing.entry_s_route ?? Infinity)
        : null;
      if (narrowStop === null) return null;
      let intoNarrowing = false;
      return {
        start() {
          intoNarrowing = false;
        },
        along(s, front) {
          if (s + front > narrowStop) intoNarrowing = true;
        },
        reject: (c) => (intoNarrowing && c.law.kind !== "hard_brake" ? "enters_narrowing_out_of_turn" : null),
      };
    },
  },

  state: {
    at: "tailgaters",
    run(snap, state) {
      if (snap.snowbank) {
        const n = snap.snowbank.narrowing,
          k = snap.snowbank.corner;
        state.snowbank = {
          ...(n
            ? {
                narrowing: {
                  one_car_at_a_time: true,
                  length_m: n.length_m,
                  ...(n.inside ? { car_in_it: true } : { starts_in_m: r1(Math.max(0, n.gap_m)) }),
                  turn: n.priority === "car" ? "car" : "oncoming",
                  ...(n.oncoming
                    ? {
                        oncoming: {
                          id: n.oncoming.id,
                          in_it: n.oncoming.inside,
                          ...(n.oncoming.inside ? {} : { from_its_end_m: n.oncoming.gap_m }),
                        },
                      }
                    : {}),
                  ...(n.wait ? { wait: true, wait_in_m: r1(Math.max(0, n.bumper_to_stop_m)) } : {}),
                  ...(n.squeeze ? { squeeze_past: true } : {}),
                  slow_to: r1(n.limit_mps),
                },
              }
            : {}),
          ...(k ? { corner_hidden: { side: k.side, crosswalk_in_m: r1(k.gap_m), creep_to: r1(k.limit_mps) } } : {}),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "wait_for_oncoming_narrowing" && snap.snowbank?.narrowing?.wait)
        return `clear, waits ${Math.max(0, r1(snap.snowbank.narrowing.bumper_to_stop_m - c.sim.progress_m))} m ahead, short of the stretch narrowed by snowbanks, for the oncoming car's turn`;
      return null;
    },
  },
  clause: { at: "tailgaters", run: (snap) => (snap.snowbank ? snowbankClauses(snap.snowbank) : null) },
  holdStill: {
    at: "driveways",
    run: (snap) =>
      snap.snowbank?.narrowing?.wait
        ? ", when it is an oncoming car's turn through the stretch narrowed by snowbanks ahead (`snowbank.narrowing.wait` true) and the car has reached the point where it waits for it (`snowbank.narrowing.wait_in_m` under 2), until that car is through"
        : "",
  },
  prompt: {
    at: "driveways",
    text: `- Snowbanks (\`snowbank\`): where they push the parked cars out and leave room for one car at a time (\`snowbank.narrowing\`), drivers take turns, whoever is already in the stretch or got to their end first going first. Choose \`wait_for_oncoming_narrowing\` when \`snowbank.narrowing.wait\` is true, and keep the car stopped there until the oncoming car is through; never enter while it is their turn. A high snowbank at a corner (\`snowbank.corner_hidden\`) hides people waiting to cross: creep up, ready to stop.`,
  },

  // Traffic between snowbanks that push the parked cars out from the kerb: over toward the middle, clear
  // of them, as far as it has come into the stretch at its pursuit point; short of the one-car stretch until
  // it is its turn (`hold`, once it could stop there: otherwise it has the way); and, finding what is in its
  // way, the line it will keep to where that is (`lineAt`, `kept`).
  trafficLane: {
    at: "parkers",
    run(world, n, front, _busy, dt, { offset, pursuit }) {
      const sb = world.snowbanks?.narrowings.length && !n.transit?.tram ? snowbankYield(world, n, front) : null;
      const sbBase = offset,
        sbAt = (s) => (sb ? Math.min(0, sb.keep - sbBase) * sb.at(s) : 0);
      let shift;
      if (sb || n.sbShift) {
        const to = sbAt(pursuit());
        n.sbShift = (n.sbShift || 0) + Math.max(-SB_SHIFT_MPS * dt, Math.min(SB_SHIFT_MPS * dt, to - (n.sbShift || 0)));
        shift = n.sbShift;
      }
      return {
        result: sb,
        shift,
        now: n.sbShift || 0,
        hold: sb?.hold,
        // (another move, round a pothole say, may already keep left of the corridor, leaving this one at
        // zero: the line it keeps to includes that move too)
        lineAt: sb ? (at) => sbAt(at) - (n.sbShift || 0) : null,
        kept: sb ? (lat) => Math.abs(lat - sbBase - (n.sbShift || 0)) : null,
      };
    },
  },
  // A parked car waits to pull out while traffic in the stretch has the way.
  trafficPullOut: (world, n) => !(world.snowbanks?.narrowings.length && !world.snowbanks.canPullOut(n)),
};
