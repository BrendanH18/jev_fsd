// A brain made of plain code. It proves the harness works without any model and is the fallback
// when a model call fails or times out. Zero latency, zero cost.

import { desiredSpeed } from "./sensors.js";

export class RulesBrain {
  constructor() { this.name = "rules"; }

  decideSync(snap, eligible) {
    const i = snap.intersection;
    const v = snap.ego.v;
    let stop = false;
    if (i) {
      const brakeDist = v * v / (2 * 3) + 1.0;
      if (i.control === "signal" && (i.signal === "red" || i.signal === "yellow") && !i.entered && i.bumper_to_line_m < brakeDist + 6 && i.bumper_to_line_m > -1) stop = i.bumper_to_line_m < 1.5;
      if (i.control === "stop" && !i.stop_completed && i.bumper_to_line_m < 1.5 && i.bumper_to_line_m > -3) stop = true;
      if (i.control === "stop" && i.stop_completed && i.cross_traffic_moving && !i.entered) stop = true;
    }
    if (snap.following && snap.following.gap_m < 3 && snap.following.speed < 0.5) stop = true;
    if (snap.nav && snap.nav.arrived) stop = true;
    const motion = stop ? "stop" : "drive";

    // desired speed: limit, curve, gap, stop-line and destination aware (shared with the state)
    const vDesired = snap.target ? snap.target.v : desiredSpeed(snap).v;

    let best = null;
    for (const c of eligible) {
      const s = c.sim;
      let cost = -1.0 * s.progress_m + 2.0 * Math.abs(s.lane_err_end) + 0.05 * Math.abs(s.heading_err_deg) + 0.8 * Math.abs(s.end_speed - Math.min(vDesired, snap.limit));
      if (c.id === "stop_at_line" && i && !i.entered && (i.signal === "red" || i.signal === "yellow" || (i.control === "stop" && !i.stop_completed))) cost -= 6;
      if (c.id === "stop_at_destination" && snap.nav && snap.nav.remaining_m < 40) cost -= 6;
      if (c.law.kind === "hard_brake") cost += 3;
      if (c.law.kind === "reverse") cost += 2;
      if (!s.stays_in_lane) cost += 2;
      if (s.min_gap_m < 3) cost += (3 - s.min_gap_m) * 3;
      if (best === null || cost < best.cost) best = { c, cost };
    }
    return { motion, candidateId: best ? best.c.id : null, meta: { source: "rules", latency_ms: 0, input_tokens: 0, cost_usd: 0, model: "rules" }, answers: null };
  }

  async decide(snap, eligible) { return this.decideSync(snap, eligible); }
}
