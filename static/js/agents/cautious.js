import { beamChoice } from "../sim/high-beams.js";
// Copy this module to build your own agent. The harness has already rejected unsafe candidates.
export class CautiousAgent {
  constructor() { this.name = "cautious"; }
  decideSync(snap, eligible) {
    const i = snap.intersection;
    const amberStop = i?.amber?.stop && !(i.right_on_red?.go || i.left_on_red?.go);
    // Shared sensing and candidate safety enforce flashing-red stops and amber caution/yields.
    // A legal left on red uses the shared target: zero until stopped and clear.
    const target = snap.turn_restriction?.banned && snap.turn_restriction.distance_m < 12 ? 0 : Math.min(snap.target?.v ?? snap.limit, snap.limit * 0.8);
    const ranked = eligible.map(candidate => ({ candidate, cost:
      Math.abs(candidate.sim.end_speed - target) * 2 + Math.abs(candidate.sim.lane_err_end) * 3
      + Math.max(0, 5 - candidate.sim.min_gap_m) * 6 - candidate.sim.progress_m * 0.3 }));
    ranked.sort((a, b) => a.cost - b.cost);
    // an emergency vehicle is coming: pull over and stop, whatever it costs in lane position
    // parking at the destination, or pulling out of a space, once on offer: carry on with it
    // passing a cyclist through the oncoming lane, once the way is clear: at the pass speed, so as to
    // spend no longer in that lane than the pass was judged clear for
    // a school crossing guard holding up the STOP sign: stop short of the crosswalk, however far off
    // a cyclist riding against a one-way street to wait for (sim/contraflow.js): stop where the car waits
    // a car running the red across the car's way on a green (sim/red-light-runner.js): wait at the line
    // a car backing out of a driveway into the lane (sim/driveway-reversers.js): stop to give it room
    // a pothole ahead in the lane with room to ease round it inside the lane (sim/potholes.js): round it,
    // at the target speed (nothing else ahead calling for less)
    // a ball rolled into the street (sim/ball-chase.js): slow, ready to stop for a child running out after it
    // in a bus lane while it is in effect, short of the right-turn approach: out of it, after making way for an emergency vehicle
    const inBusLane = snap.bus_lane?.in_effect && !snap.bus_lane.entering_allowed && snap.bus_lane.lanes.includes(snap.lane?.index);
    const exitBusLane = inBusLane ? eligible.find(c => c.change && !snap.bus_lane.lanes.includes(c.law.laneIdx)) : null;
    const pxoStop = snap.pxo?.bumper_to_crosswalk_m < 3.5;
    const candidate = eligible.find(c => c.id === "pull_over") || eligible.find(c => c.id === "stop_for_turn_restriction") || exitBusLane || (pxoStop && eligible.find(c => c.id === "stop_for_pedestrian")) || eligible.find(c => c.id === "park" || c.id === "pull_out") || eligible.find(c => c.id === "pass_cyclist") || eligible.find(c => c.id === "stop_for_crossing_guard") || (snap.contraflow_cyclist?.wait && eligible.find(c => c.id === "yield_to_contraflow_cyclist")) || (snap.red_light_runner?.wait && eligible.find(c => c.id === "wait_for_runner")) || (snap.reversing_vehicle?.wait && eligible.find(c => c.id === "yield_to_reversing")) || (snap.ball_in_road?.limit_mps != null && !snap.pedestrian && eligible.find(c => c.id === "slow_for_ball")) || (amberStop && eligible.find(c => c.id === "stop_at_line")) || (snap.pothole?.room && eligible.find(c => c.id === "ease_round_pothole" && Math.abs(c.sim.end_speed - target) < 1.5)) || ranked[0]?.candidate;
    // (pulling over stops on its own, at the side of the road: braking now would stop in the lane; and
    // pulling up to park stops where the car reverses in)
    return { ...(snap.headlights ? { headlights: beamChoice(snap) } : {}), motion: !(amberStop && candidate?.id === "stop_at_line") && candidate?.sim.end_speed < 0.3 && !["pull_over", "park", "pull_out", "wait_to_park"].includes(candidate.id) ? "stop" : "drive", candidateId: candidate?.id ?? null,
      meta: { source: this.name, model: this.name, latency_ms: 0, input_tokens: 0, cost_usd: 0 } };
  }
  async decide(snap, eligible) { return this.decideSync(snap, eligible); }
}

export default { id: "cautious-example", label: "My cautious agent", create: () => new CautiousAgent() };
