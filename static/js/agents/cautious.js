import { decisionContext } from "../brain/decision-trace.js";
import { featureDecisionFields, stopAtLineDrive, firstHookResult, hooks } from "../sim/features/index.js";

const FIRST = hooks("cautious", "first");
const BEFORE_BUS_LANES = hooks("cautious", "beforeBusLanes");
const RESERVED_LANE = hooks("cautious", "reservedLane");
const AFTER_BUS_LANES = hooks("cautious", "afterBusLanes");
const PASSING = hooks("cautious", "passing");
const AFTER_PASSING = hooks("cautious", "afterPassing");
const CAUTIOUS = hooks("cautious");
const BEFORE_AMBER = hooks("cautious", "beforeAmber");
const SIGNAL_STOP = hooks("cautious", "signalStop");
const AFTER_AMBER = hooks("cautious", "afterAmber");
const FEATURE_STOP = hooks("cautiousStop");
const FEATURE_DRIVE = hooks("cautiousDrive");

function bestCandidate(eligible, target, scores) {
  let best;
  let lowest = Infinity;
  for (const candidate of eligible) {
    const s = candidate.sim;
    const speedError = Math.abs(s.end_speed - target) * 2;
    const lateralError = Math.abs(s.lane_err_end) * 3;
    const clearance = Math.max(0, 5 - s.min_gap_m) * 6;
    const progress = s.progress_m * 0.3;
    const cost = speedError + lateralError + clearance - progress;
    scores?.push({
      id: candidate.id,
      targetSpeed: target,
      cost,
      terms: { speed_error: speedError, lateral_error: lateralError, clearance, progress: -progress },
    });
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
  explain(snap, offered) {
    const policy = {};
    const result = this.decideSync(snap, offered, policy);
    return { ...policy, candidateId: result.candidateId, motion: result.motion };
  }

  decideSync(snap, offered, policy) {
    // (the autopilot brakes without asking it when nothing unflagged is left: brain/brain.js)
    const eligible = offered.filter((c) => !c.flagged);
    // Shared sensing and candidate safety enforce flashing-red stops and amber caution/yields.
    // A legal left on red uses the shared target: zero until stopped and clear.
    const featureStop = FEATURE_STOP.some((shouldStop) => shouldStop(snap));
    const target = featureStop ? 0 : Math.min(snap.target?.v ?? snap.limit, snap.limit * 0.8);
    // what a registered feature has it do first (an emergency vehicle is coming: pull over and stop, whatever
    // it costs in lane position, say)
    // parking at the destination, or pulling out of a space, once on offer: carry on with it
    // passing a cyclist through the oncoming lane, once the way is clear: at the pass speed, so as to
    // spend no longer in that lane than the pass was judged clear for
    const scores = policy ? [] : null;
    let selection = null;
    const picked = (candidate, reason) => {
      if (candidate) selection = reason;
      return candidate;
    };
    const candidate =
      picked(firstHookResult(FIRST, snap, eligible, target), "feature_first") ||
      picked(firstHookResult(BEFORE_BUS_LANES, snap, eligible, target), "feature_before_bus_lanes") ||
      picked(firstHookResult(RESERVED_LANE, snap, eligible, target), "feature_reserved_lane") ||
      picked(firstHookResult(AFTER_BUS_LANES, snap, eligible, target), "feature_after_bus_lanes") ||
      picked(
        eligible.find((c) => c.id === "park" || c.id === "pull_out"),
        "parking",
      ) ||
      picked(firstHookResult(PASSING, snap, eligible, target), "feature_passing") ||
      picked(firstHookResult(AFTER_PASSING, snap, eligible, target), "feature_after_passing") ||
      picked(firstHookResult(CAUTIOUS, snap, eligible, target), "feature") ||
      picked(firstHookResult(BEFORE_AMBER, snap, eligible, target), "feature_before_amber") ||
      picked(firstHookResult(SIGNAL_STOP, snap, eligible, target), "approach_signal") ||
      picked(firstHookResult(AFTER_AMBER, snap, eligible, target), "feature_after_amber") ||
      picked(bestCandidate(eligible, target, scores), "score");

    const fields = featureDecisionFields(snap);
    // A parking manoeuvre, or a feature's own (a pull-over, say), brings the car to a stop at the planned location.
    let motionReason = "moving_prediction";
    if (!candidate) motionReason = "no_candidate";
    else if (stopAtLineDrive(snap, candidate)) motionReason = "approach_signal";
    else if (candidate.sim.end_speed < 0.3) {
      if (["park", "pull_out", "wait_to_park"].includes(candidate.id)) motionReason = "planned_stop";
      else if (FEATURE_DRIVE.some((drive) => drive(candidate, snap))) motionReason = "feature_planned_stop";
      else motionReason = "stationary_prediction";
    }
    const motion = motionReason === "stationary_prediction" ? "stop" : "drive";
    if (policy)
      Object.assign(policy, {
        driver: this.name,
        desiredSpeed: target,
        targetReason: featureStop
          ? "feature_stop"
          : (snap.target?.v ?? snap.limit) <= snap.limit * 0.8
            ? "sensing_target"
            : "cautious_speed_cap",
        flagged: offered.filter((c) => c.flagged).map((c) => c.id),
        selection,
        motionReason,
        scores,
      });
    return {
      ...fields,
      motion,
      candidateId: candidate?.id ?? null,
      meta: { source: this.name, model: this.name, latency_ms: 0, input_tokens: 0, cost_usd: 0 },
    };
  }
  async decide(snap, eligible, request) {
    const policy = decisionContext(request)?.policy;
    const result = this.decideSync(snap, eligible, policy);
    if (policy) Object.assign(policy, { candidateId: result.candidateId, motion: result.motion });
    return result;
  }
}

export default { id: "cautious-example", label: "My cautious agent", create: () => new CautiousAgent() };
