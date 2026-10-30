// A brain made of plain code. It proves the harness works without any model and is the fallback
// when a model call fails or times out. Zero latency, zero cost.

import { desiredSpeed, waitsItsTurn } from "./sensors.js";
import { comfort } from "../sim/vehicle.js";

export class RulesBrain {
  constructor() { this.name = "rules"; }

  decideSync(snap, eligible) {
    const i = snap.intersection;
    const v = snap.ego.v;
    let stop = false;
    if (i) {
      const brakeDist = v * v / (2 * Math.min(3, comfort().hardDecel)) + 1.0;
      if (i.control === "signal" && (i.signal === "red" || i.signal === "yellow" || i.signal === "unknown") && !i.right_on_red?.go && !i.entered && i.bumper_to_line_m < brakeDist + 6 && i.bumper_to_line_m > -1) stop = i.bumper_to_line_m < 1.5;
      if (i.control === "stop" && !i.stop_completed && i.bumper_to_line_m < 1.5 && i.bumper_to_line_m > -3) stop = true;
      if (i.control === "stop" && i.stop_completed && i.cross_traffic_moving && !i.entered) stop = true;
      if (waitsItsTurn(i) && i.bumper_to_line_m < 1.5) stop = true;
      if (i.control === "yield" && i.cross_traffic_moving && !i.entered && i.bumper_to_line_m < 1.5) stop = true;
      if (i.oncoming && i.oncoming.bumper_to_yield_m < 2) stop = true;
      if (i.give_way?.wait_for && i.give_way.bumper_to_hold_m < 1.5) stop = true;
    }
    if (snap.following && snap.following.gap_m < 3 && snap.following.speed < 0.5) stop = true;
    if (snap.pedestrian && snap.pedestrian.bumper_to_crosswalk_m < 3.5) stop = true;
    if (snap.right_hook && snap.right_hook.bumper_to_yield_m < 2) stop = true;
    if (snap.nav && snap.nav.arrived) stop = true;

    const vDesired = snap.target ? snap.target.v : desiredSpeed(snap).v;
    // A manoeuvre that leaves the car outside the lane its route takes for a turn ahead gains
    // nothing by driving faster than that lane's traffic, since the car has to move into it anyway:
    // it joins a queue there from behind instead of driving past it.
    const l = snap.lane;
    const toward = l && l.delta ? Object.values(l.sides).find((side) => Math.abs(side.delta) < Math.abs(l.delta)) : null;
    const vTurnLane = !l || !l.route_ahead ? Infinity : l.delta === 0 ? vDesired : toward ? toward.target_v : Infinity;

    const rs = snap.roadside_stop;
    let best = null;
    for (const c of eligible) {
      const s = c.sim;
      // a lane change is judged against the speed the car could keep in the new lane
      const vWant = Math.min(c.laneTarget ?? vDesired, snap.limit, c.law.lane ? vTurnLane : Infinity);
      let cost = -1.0 * s.progress_m + 2.0 * Math.abs(s.lane_err_end) + 0.05 * Math.abs(s.heading_err_deg) + 0.8 * Math.abs(s.end_speed - vWant);
      // ending above the target is worse than below it: the target already accounts for what is ahead
      if (s.end_speed > vWant + 0.5) cost += 2.0 * (s.end_speed - vWant - 0.5);
      if (c.id === "stop_at_line" && i && !i.entered && ((i.signal === "red" && !i.right_on_red?.go) || i.signal === "yellow" || i.signal === "unknown" || (i.control === "stop" && !i.stop_completed) || waitsItsTurn(i) || (i.control === "yield" && i.cross_traffic_moving) || (i.give_way?.wait_for && i.give_way.hold_s_route === i.s_line_route))) cost -= 6;
      if (c.id === "stop_at_destination" && snap.nav && snap.nav.remaining_m < 40) cost -= 6;
      if (c.id === "stop_for_pedestrian") cost -= 6;
      if (c.id === "stop_for_oncoming" || c.id === "stop_for_cyclist" || c.id === "stop_to_turn_round" || c.id === "yield_to_bus" || c.id === "stop_at_crosswalk" || c.id === "stop_for_school_bus" || c.id === "stop_for_streetcar" || c.id === "stop_before_tracks") cost -= 6;
      if (c.id === "creep_to_look" || c.id === "wait_to_give_way") cost -= 6;
      // giving way to an emergency vehicle: pull over and stop at once, rather than stop in the lane
      // (outweighing the cost of ending up out of the lane's centre)
      if (c.id === "pull_over") cost -= 15;
      // Turning round where the route makes a U-turn is the only way on, and once begun it carries
      // on whenever its prediction is clear.
      if (c.law.kind === "turnaround") cost -= 50;
      if (c.law.kind === "hard_brake") cost += 3;
      if (c.law.kind === "reverse") cost += 2;
      if (!s.stays_in_lane) cost += 2;
      // Changing lanes costs a little and so does staying outside the route's lane, so the car
      // passes only for a clear gain and goes back once there is room. A change under way is
      // finished unless finishing it is no longer safe.
      if (c.change) cost += c.change.offer === "abort" ? 5.0 : 1.0;
      // Passing a vehicle stopped at the roadside with its lights flashing, the car keeps out of the
      // lane next to it where there is another going its way, if it can (as a manoeuvre left in that
      // lane, or into it, costs more than any other).
      if (rs?.other_lane && c.law.lane === rs.adjacent_delta) cost += 6;
      if (c.law.lane) cost += 2.0 * Math.abs(c.law.lane);
      if (s.min_gap_m < 3) cost += (3 - s.min_gap_m) * 3;
      if (best === null || cost < best.cost) best = { c, cost };
    }
    // (the reasons to stop above are for driving ahead; a turnaround that is clear goes on)
    const motion = stop && best?.c.law.kind !== "turnaround" ? "stop" : "drive";
    return { motion, candidateId: best ? best.c.id : null, meta: { source: "rules", latency_ms: 0, input_tokens: 0, cost_usd: 0, model: "rules" }, answers: null };
  }

  async decide(snap, eligible) { return this.decideSync(snap, eligible); }
}
