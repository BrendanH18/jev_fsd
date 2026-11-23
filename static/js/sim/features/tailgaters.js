import { r1 } from "../../common.js";
import { laneChangeLength } from "../controller.js";
import { followingPolicy } from "../following.js";
import {
  auditTailgaters,
  createTailgaters,
  manageTailgaters,
  tailgateBrake,
  tailgateLeadSpeed,
  tailgaterSensing,
  TAIL_EASE_MIN_MPS,
  TAIL_EASE_MPS,
  TAIL_GENTLEST_SLACK,
  TAIL_HURRY,
  TAIL_ROOM,
  TAIL_STOP_DECEL,
} from "../tailgaters.js";

// A car tailgating the driven car, close behind it in its lane (sim/tailgaters.js).
function tailgaterClause(t) {
  const lead = `Car \`${t.id}\` is tailgating the car, ${Math.max(0, Math.round(t.gap_m))} m behind (${r1(t.headway_s)} s)${t.flashing ? ", flashing its headlights" : ""}: far too close to stop if the car brakes suddenly.`;
  const brake = `Never brake-check it, and never brake harder than ${r1(t.gentle_mps2)} m/s^2 unless something ahead calls for more${t.need_for ? ` (the ${t.need_for} ahead needs ${r1(t.need_mps2)} m/s^2)` : ""}; never speed up to please it either. Leave twice the usual gap to whatever is ahead (\`car.target_speed\` already does), so the car can brake early and gently.`;
  const by = t.can_move_right
    ? "Another lane goes the car's way on the right and it is clear: choose `let_tailgater_pass` to move over at the car's speed and let it by."
    : "There is no lane to move right into: ease off a little, gently (`ease_off_for_tailgater`, where it is offered), so it can pass when it is safe.";
  return `${lead} ${brake} ${by}`;
}

export default {
  rulesCost(c) {
    if (c.id === "let_tailgater_pass") return -8;
    if (c.id === "ease_off_for_tailgater") return -5;
    return 0;
  },
  cautious: (snap, eligible) =>
    snap.tailgater?.can_move_right ? eligible.find((c) => c.id === "let_tailgater_pass") : null,
  key: "tailgaters",
  seen: "tailgatersSeen",
  calls: "tailgaterCalls",
  build: (_world, options) => createTailgaters(options),
  metric: {
    at: "rearTraffic",
    name: "brake_checks",
    failure: "braked hard with a tailgater close behind",
    label: "Braked hard with a tailgater close behind, with nothing ahead calling for it",
  },
  audit: {
    at: "rearTraffic",
    run(world) {
      if (world.tailgaters?.enabled) auditTailgaters(world);
    },
  },
  trafficManage(world, fleet, dt) {
    if (world.tailgaters?.enabled) manageTailgaters(world, fleet, dt);
  },
  trafficDriver(world, n) {
    if (!n.tailgate) return n.tgPeek ? { offset: n.tgPeek } : null;
    return {
      offset: n.tgPeek,
      speedFactor: TAIL_HURRY,
      skipFollowing: true,
      leadSpeed: (leader, speed) => (leader === world.ego ? tailgateLeadSpeed(world) : speed),
      brake: (leader, gap, accel) =>
        leader === world.ego && gap < Infinity ? Math.min(accel, tailgateBrake(world, n, gap)) : accel,
    };
  },
  sense: {
    at: "following",
    run(world, snap, { visibleNpcs, s }) {
      if (!world.tailgaters?.enabled) return;
      snap.tailgater = tailgaterSensing(world, visibleNpcs, s);
      if (snap.tailgater && snap.following)
        snap.following.policy = followingPolicy(world.ego, snap.following, { scale: TAIL_ROOM });
    },
  },
  laneOffer(snap, side, { dir, turnLane, room, v, inJunction, junctionMargin }) {
    if (
      dir === "right" &&
      snap.tailgater &&
      !snap.lane.shift &&
      !turnLane &&
      side.gap_ok &&
      room >= Math.max(80, 2 * laneChangeLength(v) + 30) &&
      !inJunction(junctionMargin)
    )
      return "let_pass";
    return null;
  },
  finishLanes(snap) {
    if (!snap.tailgater) return;
    const right = snap.lane?.sides.right;
    snap.tailgater.lane_right = !!right;
    snap.tailgater.can_move_right = !!right && (right.offer === "let_pass" || right.offer === "return") && right.gap_ok;
  },
  hazard: { at: "rearTraffic", run: (snap) => (snap.tailgater ? "tailgater" : null) },
  laneChangeCandidate({ snap, side, lane, limit, v, s, share, leaving, minChange, leave, speedLabel }, out) {
    if (side.offer !== "let_pass") return false;
    const vt = Math.round(Math.max(0, Math.min(limit, v, side.target_v)) * 10) / 10;
    if (vt > 0.05)
      out.push({
        id: "let_tailgater_pass",
        change: { dir: side.dir, offer: side.offer, gap_ok: side.gap_ok, too_late: leaving < minChange, leave },
        laneUntil: side.until_s,
        laneTarget: side.target_v,
        law: {
          kind: "lane",
          offset: side.center,
          center: side.center,
          lane: side.delta,
          laneIdx: lane.route_index + side.delta,
          chain: lane.chain,
          fromLane: lane.delta,
          fromIdx: lane.index,
          vTarget: vt,
          shift: { from: snap.routeProj.lateral, start: s, len: share },
        },
        steer: "move over to the right lane and let the tailgater by",
        speed: speedLabel(vt, v, limit),
      });
    return true;
  },
  lineStop: (snap) => (snap.tailgater && !snap.intersection.amber?.stop ? { stopDecel: TAIL_STOP_DECEL } : null),
  candidates: {
    at: "rearTraffic",
    run({ snap, target, limit, laneUntil, inLane }, out) {
      const tg = snap.tailgater;
      if (tg && !tg.can_move_right && target >= TAIL_EASE_MIN_MPS && target >= 0.9 * limit) {
        const vt = Math.round((target - TAIL_EASE_MPS) * 10) / 10;
        out.push({
          id: "ease_off_for_tailgater",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: vt }),
          steer: "hold lane",
          speed: `ease off gently to ${vt.toFixed(1)} and let the tailgater by`,
        });
      }
    },
  },
  predictionIgnore: (snap, o) => o === snap.tailgater?.vehicle,
  flagText: { brakes_hard_with_tailgater: "it brakes harder than needed with a tailgater close behind" },
  candidateSettle(snap, candidates) {
    if (snap.tailgater?.vehicle) {
      const decels = candidates.filter((c) => !c.reject && c.law.kind !== "hard_brake").map((c) => c.sim.max_decel);
      const ceiling = Math.max(
        snap.tailgater.gentle_mps2,
        decels.length ? Math.min(...decels) + TAIL_GENTLEST_SLACK : 0,
      );
      for (const c of candidates)
        if (!c.reject && c.law.kind !== "hard_brake" && c.sim.max_decel > ceiling) {
          c.reject = "brakes_hard_with_tailgater";
          c.eligible = false;
        }
    }
  },
  state: {
    at: "rearTraffic",
    run(snap, state) {
      if (snap.tailgater) {
        const t = snap.tailgater;
        state.tailgater = {
          id: t.id,
          behind_m: r1(t.gap_m),
          headway_s: t.headway_s,
          closing_mps: r1(t.closing_mps),
          ...(t.flashing ? { flashing_headlights: true } : {}),
          brake_no_harder_than_mps2: r1(t.gentle_mps2),
          ...(t.need_for ? { ahead_requires_mps2: r1(t.need_mps2), because_of: t.need_for } : {}),
          gap_ahead: "twice the usual",
          ...(t.can_move_right ? { move_right_to_let_it_pass: true } : { lane_to_the_right: t.lane_right }),
        };
      }
    },
  },
  outcome: {
    at: "ids",
    run(c, snap) {
      if (c.id === "let_tailgater_pass" && snap.tailgater)
        return `clear, moves over into the right lane at the car's speed and lets the tailgater by${c.sim.min_gap_m < 8 ? `, ${r1(c.sim.min_gap_m)} m behind a car` : ""}`;
      if (c.id === "ease_off_for_tailgater" && snap.tailgater)
        return `clear, eases off gently to ${r1(c.sim.end_speed)} m/s so the tailgater can get by, leaving more room ahead`;
      return null;
    },
  },
  clause: { at: "rearTraffic", run: (snap) => (snap.tailgater ? tailgaterClause(snap.tailgater) : null) },
  prompt: {
    at: "rearTraffic",
    text: `- A car tailgating close behind (\`tailgater\`) cannot stop if the car brakes suddenly. Never brake-check it: brake no harder than \`tailgater.brake_no_harder_than_mps2\` unless something ahead calls for more, start braking early and gently, and never speed up to please it. Keep twice the usual gap ahead. When \`tailgater.move_right_to_let_it_pass\` is true, choose \`let_tailgater_pass\`; otherwise prefer \`ease_off_for_tailgater\` where it is offered.`,
  },
};
