// JevBrain: sends the state and questions to /api/decide (the server holds the key) and returns
// Jev's choices. Invalid answers fall back to the rules brain for that tick.

import { api } from "../common.js";

export class JevBrain {
  constructor() { this.name = "jev"; this.timeoutMs = 1500; }

  async decide(snap, eligible, request, signal) {
    const started = performance.now();
    const res = await api("/api/decide", { tick: snap.tick, epoch: request.epoch, state: request.state, questions: request.questions }, { signal });
    const answers = { ...request.local, ...res.answers };
    const motion = answers.motion ? answers.motion.choice : "drive";
    let candidateId = answers.vector ? answers.vector.choice : null;
    if (candidateId && !eligible.some((c) => c.id === candidateId)) candidateId = null;
    const routeId = answers.route ? answers.route.choice : null;
    return {
      motion, candidateId, routeId, answers,
      meta: { ...res.meta, source: "jev", round_trip_ms: Math.round(performance.now() - started) },
      trace: res.trace,
    };
  }
}
