// Following-distance policy (sim/following.js) as a feature record (sim/features/index.js,
// docs/feature-interface.md).
import { r1 } from "../../common.js";
import { followingPolicy } from "../following.js";
import { comfort } from "../vehicle.js";
import { wrap } from "../world.js";

const FOLLOWING_RECOVERY_S = 5;

function sampleFollowing(score, { ego, leader, nextNearby, dt, round }) {
  let recovering = false;
  score.followingMessage = null;
  if (leader) {
    const policy = followingPolicy(ego, leader);
    const short = leader.gap_m < policy.target_gap_m - 1;
    if (score.followingState?.id !== leader.id) {
      // A new leader may take away space the driver had already left. Give them time to rebuild it.
      const recovery = leader.entered && short && !score.followingMet.has(leader.id) ? FOLLOWING_RECOVERY_S : 0;
      score.followingState = { id: leader.id, until: score.elapsed + recovery };
      score.followingMet.add(leader.id);
      if (score.followingState.until > score.elapsed)
        score.incident("following_recovery", "A vehicle entered the following gap: ease off and rebuild space", {
          gap_m: round(leader.gap_m),
          target_gap_m: round(policy.target_gap_m),
        });
    }
    recovering = short && score.elapsed < score.followingState.until;
    if (recovering) score.followingRecovery += dt;
    else if (short) score.closeFollowing += dt;
    score.followingMessage = `${recovering ? "Rebuild space" : short ? "Ease off" : "Keep space"}: ${Math.round(leader.gap_m)} m gap, ${Math.round(policy.target_gap_m)} m target for speed and grip.`;
  } else score.followingState = null;
  score.followingNearby = nextNearby;
  score.followingPose = { x: ego.x, y: ego.y, psi: ego.psi };
  return recovering;
}

export default {
  key: "followingDistance",
  coach: {
    init: (world) => ({
      followingEnabled: !!world.followingDistance,
      followingState: null,
      followingMessage: null,
      followingMet: new Set(),
      followingNearby: new Map(),
      followingPose: null,
      followingRecovery: 0,
      sampleFollowing,
      followingTip:
        "Leave room for reaction and braking, with more space on slippery roads. If someone merges into your gap, ease off to rebuild it; brake firmly if needed to avoid a collision.",
    }),
    reports: [
      {
        at: "afterBrakes",
        order: 0,
        read: (score, round) =>
          score.followingEnabled
            ? { following_policy: "grip-and-response-v1", following_recovery_s: round(score.followingRecovery) }
            : {},
      },
    ],
  },
  perceptionLine(snap) {
    const f = snap.following;
    const text = f?.policy
      ? `Following gap ${Math.round(f.gap_m)} m; target ${Math.round(f.policy.target_gap_m)} m for speed and grip`
      : null;
    return text ? { order: 4, label: "Following", text } : null;
  },
  perceptionRejections: {
    following_distance: "Leaves too little braking room",
  },
  build: (_world, { enabled }) => !!enabled,
  flagText: {
    following_distance: "it leaves too little room to stop behind the vehicle ahead",
  },

  sense: {
    at: "following",
    run(world, snap) {
      if (world.followingDistance && snap.following) snap.following.policy = followingPolicy(world.ego, snap.following);
    },
  },
  followingPolicy: (world, vehicle, lead) => (world.followingDistance ? followingPolicy(vehicle, lead) : null),
  sim: {
    at: "afterCollision",
    run(_world, snap) {
      const f = snap.following;
      if (!f?.policy) return null;
      let closes = false;
      return {
        start() {
          closes = false;
        },
        near(car, box, o, ob, ahead, side, _meeting, isFinal) {
          if (
            isFinal &&
            ahead > 0 &&
            side < box.halfWidth + ob.halfWidth + 0.3 &&
            o.id === f.id &&
            car.v > 2 &&
            Math.abs(wrap(o.psi - car.psi)) < Math.PI / 4
          ) {
            const gap = ahead - box.halfLength - ob.halfLength;
            const future = followingPolicy(car, { gap_m: gap, speed: f.speed, vehicle: o });
            const deficit = future.target_gap_m - gap;
            closes =
              deficit > Math.max(1, f.policy.target_gap_m - f.gap_m - 0.5) && car.v > f.policy.safe_speed_mps + 0.2;
          }
        },
        reject: (c) => (closes && c.law.kind !== "hard_brake" ? "following_distance" : null),
      };
    },
  },

  state: {
    at: "afterFollowing",
    run(snap, state) {
      const f = snap.following;
      if (f?.policy && state.following)
        Object.assign(state.following, {
          target_gap_m: r1(f.policy.target_gap_m),
          safe_speed_mps: r1(f.policy.safe_speed_mps),
          target_headway_s: r1(f.policy.headway_s),
          gap:
            state.following.gap === "dangerous"
              ? "dangerous"
              : f.gap_m < f.policy.target_gap_m - 1
                ? "short"
                : "comfortable",
        });
    },
  },
  clause: {
    at: "following",
    run: (snap) =>
      snap.following?.policy
        ? `Leave braking room behind the leader: the current gap is ${r1(snap.following.gap_m)} m and the target for this speed and grip is ${r1(snap.following.policy.target_gap_m)} m. Ease off to rebuild a short gap; do not accelerate to close it. Brake harder if needed to avoid a collision.`
        : null,
  },

  trafficSpeed: {
    at: "following",
    run(world, n, _front, ctx) {
      return world.followingDistance && n.lead && n.kind !== "bike" && !ctx?.skipFollowing
        ? followingPolicy(n, { gap_m: n.lead.gap, speed: n.lead.v, vehicle: ctx?.leader }).safe_speed_mps
        : Infinity;
    },
  },
  trafficParkingReach(world, n, reach) {
    return world.followingDistance ? Math.max(0.5, reach + (n.v * n.v) / (2 * comfort().decel)) : null;
  },
};
