// Copy this module to build your own agent. The harness has already rejected unsafe candidates.
export class CautiousAgent {
  constructor() { this.name = "cautious"; }
  decideSync(snap, eligible) {
    const target = Math.min(snap.target?.v ?? snap.limit, snap.limit * 0.8);
    const ranked = eligible.map(candidate => ({ candidate, cost:
      Math.abs(candidate.sim.end_speed - target) * 2 + Math.abs(candidate.sim.lane_err_end) * 3
      + Math.max(0, 5 - candidate.sim.min_gap_m) * 6 - candidate.sim.progress_m * 0.3 }));
    ranked.sort((a, b) => a.cost - b.cost);
    // an emergency vehicle is coming: pull over and stop, whatever it costs in lane position
    // parking at the destination, or pulling out of a space, once on offer: carry on with it
    const candidate = eligible.find(c => c.id === "pull_over") || eligible.find(c => c.id === "park" || c.id === "pull_out") || ranked[0]?.candidate;
    // (pulling over stops on its own, at the side of the road: braking now would stop in the lane; and
    // pulling up to park stops where the car reverses in)
    return { motion: candidate?.sim.end_speed < 0.3 && !["pull_over", "park", "pull_out", "wait_to_park"].includes(candidate.id) ? "stop" : "drive", candidateId: candidate?.id ?? null,
      meta: { source: this.name, model: this.name, latency_ms: 0, input_tokens: 0, cost_usd: 0 } };
  }
  async decide(snap, eligible) { return this.decideSync(snap, eligible); }
}

export default { id: "cautious-example", label: "My cautious agent", create: () => new CautiousAgent() };
