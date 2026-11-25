import { featureDecisionFields, stopAtLineDrive, firstHookResult, hooks } from "../sim/features/index.js";

const BEFORE_BUS_LANES = hooks("cautious", "beforeBusLanes");
const RESERVED_LANE = hooks("cautious", "reservedLane");
const AFTER_BUS_LANES = hooks("cautious", "afterBusLanes");
const AFTER_PASSING = hooks("cautious", "afterPassing");
const CAUTIOUS = hooks("cautious");
const BEFORE_AMBER = hooks("cautious", "beforeAmber");
const SIGNAL_STOP = hooks("cautious", "signalStop");
const AFTER_AMBER = hooks("cautious", "afterAmber");
const FEATURE_STOP = hooks("cautiousStop");
const FEATURE_DRIVE = hooks("cautiousDrive");

function bestCandidate(eligible, target) {
  let best;
  let lowest = Infinity;
  for (const candidate of eligible) {
    const s = candidate.sim;
    const cost =
      Math.abs(s.end_speed - target) * 2 +
      Math.abs(s.lane_err_end) * 3 +
      Math.max(0, 5 - s.min_gap_m) * 6 -
      s.progress_m * 0.3;
    if (!best || cost < lowest) {
      best = candidate;
      lowest = cost;
    }
  }
  return best;
}

// Copy this module to build your own agent. The harness has already rejected unsafe candidates. On the
// open track (brain/tracks.js) `eligible` also holds manoeuvres that failed a road-rule check, each with
// `flagged` true and the check in `reject`; this agent keeps to the others, as Rules does.
export class CautiousAgent {
  constructor() {
    this.name = "cautious";
  }
  decideSync(snap, offered) {
    // (the autopilot brakes without asking it when nothing unflagged is left: brain/brain.js)
    const eligible = offered.filter((c) => !c.flagged);
    // Shared sensing and candidate safety enforce flashing-red stops and amber caution/yields.
    // A legal left on red uses the shared target: zero until stopped and clear.
    const target = FEATURE_STOP.some((shouldStop) => shouldStop(snap))
      ? 0
      : Math.min(snap.target?.v ?? snap.limit, snap.limit * 0.8);
    // an emergency vehicle is coming: pull over and stop, whatever it costs in lane position
    // parking at the destination, or pulling out of a space, once on offer: carry on with it
    // passing a cyclist through the oncoming lane, once the way is clear: at the pass speed, so as to
    // spend no longer in that lane than the pass was judged clear for
    const candidate =
      eligible.find((c) => c.id === "pull_over") ||
      firstHookResult(BEFORE_BUS_LANES, snap, eligible, target) ||
      firstHookResult(RESERVED_LANE, snap, eligible, target) ||
      firstHookResult(AFTER_BUS_LANES, snap, eligible, target) ||
      eligible.find((c) => c.id === "park" || c.id === "pull_out") ||
      eligible.find((c) => c.id === "pass_cyclist") ||
      firstHookResult(AFTER_PASSING, snap, eligible, target) ||
      firstHookResult(CAUTIOUS, snap, eligible, target) ||
      firstHookResult(BEFORE_AMBER, snap, eligible, target) ||
      firstHookResult(SIGNAL_STOP, snap, eligible, target) ||
      firstHookResult(AFTER_AMBER, snap, eligible, target) ||
      bestCandidate(eligible, target);
    // (pulling over stops on its own, at the side of the road: braking now would stop in the lane; and
    // pulling up to park stops where the car reverses in)
    return {
      ...featureDecisionFields(snap),
      motion:
        !stopAtLineDrive(snap, candidate) &&
        candidate?.sim.end_speed < 0.3 &&
        !["pull_over", "park", "pull_out", "wait_to_park"].includes(candidate.id) &&
        !FEATURE_DRIVE.some((drive) => drive(candidate, snap))
          ? "stop"
          : "drive",
      candidateId: candidate?.id ?? null,
      meta: { source: this.name, model: this.name, latency_ms: 0, input_tokens: 0, cost_usd: 0 },
    };
  }
  async decide(snap, eligible) {
    return this.decideSync(snap, eligible);
  }
}

export default { id: "cautious-example", label: "My cautious agent", create: () => new CautiousAgent() };
