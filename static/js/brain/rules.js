// A brain made of plain code. It proves the harness works without any model and is the fallback
// when a model call fails or times out. Zero latency, zero cost.

import { desiredSpeed, waitsItsTurn } from "./sensors.js";
import { comfort } from "../sim/vehicle.js";
import {
  featureDecisionFields,
  signalDecision,
  stopAtLineDrive,
  redTurnAllowed,
  hooks,
  junctionPlan,
} from "../sim/features/index.js";

const BEFORE_SPEED_COST = hooks("rulesCost", "beforeSpeedCost");
const BEFORE_SIGNAL_STOP_COST = hooks("rulesCost", "beforeSignalStop");

const STOP_BEFORE_SIGNAL = hooks("rulesStop", "beforeSignal");
const FEATURE_STOP = hooks("rulesStop");
const BEFORE_STOPS_COST = hooks("rulesCost", "beforeStops");
const STOPS_COST = hooks("rulesCost", "stops");
const BEFORE_PASSING_COST = hooks("rulesCost", "beforePassing");
const AFTER_SPECIAL_COST = hooks("rulesCost", "afterSpecial");
const FEATURE_COST = hooks("rulesCost");
const SPECIAL_COST = hooks("rulesCost", "special");
const LANE_GOAL = hooks("rulesLaneGoal");

function explainCost(terms, name, amount) {
  if (terms) terms[name] = amount;
  return amount;
}

export class RulesBrain {
  constructor() {
    this.name = "rules";
  }

  explain(snap, eligible) {
    const policy = {};
    const result = this.decideSync(snap, eligible, policy);
    return { ...policy, candidateId: result.candidateId, motion: result.motion };
  }

  decideSync(snap, eligible, policy) {
    // Flashing red arrives as a two-way stop; amber supplies the shared caution speed and give-way hold.
    const i = snap.intersection;
    const directive = junctionPlan(i);
    const decision = signalDecision(i);
    const v = snap.ego.v;
    let stop = STOP_BEFORE_SIGNAL.some((shouldStop) => shouldStop(snap, eligible));
    const holds = policy ? [] : null;
    if (stop) holds?.push("feature_before_signal");
    if (i) {
      const brakeDist = (v * v) / (2 * Math.min(3, comfort().hardDecel)) + 1.0;
      if (
        i.control === "signal" &&
        !directive &&
        (i.signal === "red" || (i.signal === "yellow" && decision?.stop !== false) || i.signal === "unknown") &&
        !redTurnAllowed(i) &&
        !i.entered &&
        i.bumper_to_line_m < brakeDist + 6 &&
        i.bumper_to_line_m > -1
      ) {
        stop = i.bumper_to_line_m < 1.5;
        if (holds) {
          holds.length = 0;
          if (stop) holds.push(i.signal);
        }
      }
      if (i.control === "stop" && !i.stop_completed && i.bumper_to_line_m < 1.5 && i.bumper_to_line_m > -3) {
        stop = true;
        holds?.push("stop_line");
      }
      if (i.control === "stop" && i.stop_completed && i.cross_traffic_moving && !i.entered) {
        stop = true;
        holds?.push("stop_cross_traffic");
      }
      if (waitsItsTurn(i) && i.bumper_to_line_m < 1.5) {
        stop = true;
        holds?.push("all_way_priority");
      }
      if (i.control === "yield" && i.cross_traffic_moving && !i.entered && i.bumper_to_line_m < 1.5) {
        stop = true;
        holds?.push("roundabout_traffic");
      }
      if (i.oncoming && i.oncoming.bumper_to_yield_m < 2) {
        stop = true;
        holds?.push("oncoming_turn_traffic");
      }
      if (i.give_way?.wait_for && i.give_way.bumper_to_hold_m < 1.5) {
        stop = true;
        holds?.push("junction_give_way");
      }
    }
    if (snap.following && snap.following.gap_m < 3 && snap.following.speed < 0.5) {
      stop = true;
      holds?.push("stopped_leader");
    }
    if (snap.pedestrian && snap.pedestrian.bumper_to_crosswalk_m < 3.5) {
      stop = true;
      holds?.push("crossing_pedestrian");
    }
    if (snap.right_hook && snap.right_hook.bumper_to_yield_m < 2) {
      stop = true;
      holds?.push("cyclist_on_right");
    }
    if (FEATURE_STOP.some((shouldStop) => shouldStop(snap, eligible))) {
      stop = true;
      holds?.push("feature_stop");
    }
    // (parking, the space is the destination: sim/parallel-park.js)
    if (snap.nav?.arrived && snap.parking?.mode !== "in") {
      stop = true;
      holds?.push("destination");
    }

    const vDesired = snap.target ? snap.target.v : desiredSpeed(snap).v;
    // A manoeuvre that leaves the car outside the lane its route takes for a turn ahead gains
    // nothing by driving faster than that lane's traffic, since the car has to move into it anyway:
    // it joins a queue there from behind instead of driving past it.
    const l = snap.lane;
    const toward = l?.delta ? Object.values(l.sides).find((side) => Math.abs(side.delta) < Math.abs(l.delta)) : null;
    const vTurnLane = !l?.route_ahead ? Infinity : l.delta === 0 ? vDesired : toward ? toward.target_v : Infinity;

    const scores = policy ? [] : null;
    let best = null;
    for (const c of eligible) {
      const s = c.sim;
      // a lane change is judged against the speed the car could keep in the new lane
      const vWant = Math.min(c.laneTarget ?? vDesired, snap.limit, c.law.lane ? vTurnLane : Infinity);
      // (a manoeuvre a registered feature has end off its lane's centre, a pull-over to the kerb, say, is judged
      // by how near it ends to where it is going)
      let laneErr = s.lane_err_end;
      for (const goal of LANE_GOAL) {
        const lateral = goal(c, snap);
        if (lateral !== null) {
          laneErr = s.lane_err_end - lateral;
          break;
        }
      }
      const progress = -1.0 * s.progress_m;
      const lateralError = 2.0 * Math.abs(laneErr);
      const headingError = 0.05 * Math.abs(s.heading_err_deg);
      const speedError = 0.8 * Math.abs(s.end_speed - vWant);
      let cost = progress + lateralError + headingError + speedError;
      const terms = scores
        ? {
            progress,
            lateral_error: lateralError,
            heading_error: headingError,
            speed_error: speedError,
          }
        : null;
      for (let index = 0; index < BEFORE_SPEED_COST.length; index++) {
        const adjust = BEFORE_SPEED_COST[index];
        const adjustment = adjust(c, snap);
        cost += adjustment;
        if (terms && adjustment) terms[`feature_before_speed_cost_${index}`] = adjustment;
      }
      // ending above the target is worse than below it: the target already accounts for what is ahead
      if (s.end_speed > vWant + 0.5) cost += explainCost(terms, "overspeed", 2.0 * (s.end_speed - vWant - 0.5));
      for (let index = 0; index < BEFORE_SIGNAL_STOP_COST.length; index++) {
        const adjust = BEFORE_SIGNAL_STOP_COST[index];
        const adjustment = adjust(c, snap);
        cost += adjustment;
        if (terms && adjustment) terms[`feature_before_signal_stop_${index}`] = adjustment;
      }
      if (
        c.id === "stop_at_line" &&
        i &&
        !i.entered &&
        !directive &&
        ((i.signal === "red" && !redTurnAllowed(i)) ||
          (i.signal === "yellow" && decision?.stop !== false) ||
          i.signal === "unknown" ||
          (i.control === "stop" && !i.stop_completed) ||
          waitsItsTurn(i) ||
          (i.control === "yield" && i.cross_traffic_moving) ||
          (i.give_way?.wait_for && i.give_way.hold_s_route === i.s_line_route))
      )
        cost += explainCost(terms, "control_line_stop", -6);
      if (c.id === "stop_at_destination" && snap.nav && snap.nav.remaining_m < 40)
        cost += explainCost(terms, "destination_stop", -6);
      if (c.id === "stop_for_pedestrian") cost += explainCost(terms, "pedestrian_stop", -6);
      for (let index = 0; index < BEFORE_STOPS_COST.length; index++) {
        const adjust = BEFORE_STOPS_COST[index];
        const adjustment = adjust(c, snap);
        cost += adjustment;
        if (terms && adjustment) terms[`feature_before_stops_${index}`] = adjustment;
      }
      if (
        c.id === "stop_for_oncoming" ||
        c.id === "stop_for_cyclist" ||
        c.id === "stop_to_turn_round" ||
        c.id === "yield_to_bus" ||
        c.id === "stop_at_crosswalk" ||
        c.id === "stop_for_school_bus" ||
        c.id === "stop_for_streetcar" ||
        c.id === "stop_before_tracks" ||
        c.id === "wait_short_of_junction"
      )
        cost += explainCost(terms, "required_wait", -6);
      for (let index = 0; index < STOPS_COST.length; index++) {
        const adjust = STOPS_COST[index];
        const adjustment = adjust(c, snap);
        cost += adjustment;
        if (terms && adjustment) terms[`feature_stops_${index}`] = adjustment;
      }
      if (c.id === "creep_to_look" || c.id === "wait_to_give_way") cost += explainCost(terms, "creep_or_give_way", -6);
      for (let index = 0; index < FEATURE_COST.length; index++) {
        const adjust = FEATURE_COST[index];
        const adjustment = adjust(c, snap);
        cost += adjustment;
        if (terms && adjustment) terms[`feature_${index}`] = adjustment;
      }
      // (what a registered feature's own manoeuvre is worth beside turning round and parking: pulling over for
      // an emergency vehicle, say)
      for (let index = 0; index < SPECIAL_COST.length; index++) {
        const adjust = SPECIAL_COST[index];
        const adjustment = adjust(c, snap);
        cost += adjustment;
        if (terms && adjustment) terms[`feature_special_${index}`] = adjustment;
      }
      // Turning round where the route makes a U-turn is the only way on, and once begun it carries
      // on whenever its prediction is clear.
      if (c.law.kind === "turnaround") cost += explainCost(terms, "turnaround", -50);
      // Likewise parking at the destination, and pulling out of the space at the start of a drive; and
      // pulling up where the car reverses into the space comes before driving on past it.
      if (c.law.kind === "park") cost += explainCost(terms, "parking", -50);
      if (c.id === "wait_to_park") cost += explainCost(terms, "parking_approach", -12);
      for (let index = 0; index < AFTER_SPECIAL_COST.length; index++) {
        const adjust = AFTER_SPECIAL_COST[index];
        const adjustment = adjust(c, snap);
        cost += adjustment;
        if (terms && adjustment) terms[`feature_after_special_${index}`] = adjustment;
      }
      if (c.law.kind === "hard_brake") cost += explainCost(terms, "hard_brake", 3);
      if (c.law.kind === "reverse") cost += explainCost(terms, "reverse", 2);
      if (!s.stays_in_lane) cost += explainCost(terms, "leave_lane", 2);
      // Changing lanes costs a little and so does staying outside the route's lane, so the car
      // passes only for a clear gain and goes back once there is room. A change under way is
      // finished unless finishing it is no longer safe.
      if (c.change) cost += explainCost(terms, "lane_change", c.change.offer === "abort" ? 5.0 : 1.0);
      for (let index = 0; index < BEFORE_PASSING_COST.length; index++) {
        const adjust = BEFORE_PASSING_COST[index];
        const adjustment = adjust(c, snap);
        cost += adjustment;
        if (terms && adjustment) terms[`feature_before_passing_${index}`] = adjustment;
      }
      if (c.law.lane) cost += explainCost(terms, "outside_route_lane", 2.0 * Math.abs(c.law.lane));
      if (s.min_gap_m < 3) cost += explainCost(terms, "close_gap", (3 - s.min_gap_m) * 3);
      scores?.push({ id: c.id, targetSpeed: vWant, cost, terms });
      if (best === null || cost < best.cost) best = { c, cost };
    }
    // (the reasons to stop above are for driving ahead; a turnaround, or parking, that is clear goes on)
    const motion =
      stop && !stopAtLineDrive(snap, best?.c) && best?.c.law.kind !== "turnaround" && best?.c.law.kind !== "park"
        ? "stop"
        : "drive";
    if (policy)
      Object.assign(policy, {
        driver: this.name,
        desiredSpeed: vDesired,
        turnLaneSpeed: Number.isFinite(vTurnLane) ? vTurnLane : null,
        holds,
        scores,
        holdOverride:
          !stop || motion === "stop" ? null : stopAtLineDrive(snap, best?.c) ? "approach_signal" : best?.c.law.kind,
      });
    return {
      ...featureDecisionFields(snap),
      motion,
      candidateId: best ? best.c.id : null,
      meta: { source: "rules", latency_ms: 0, input_tokens: 0, cost_usd: 0, model: "rules" },
      answers: null,
    };
  }

  async decide(snap, eligible) {
    return this.decideSync(snap, eligible);
  }
}
