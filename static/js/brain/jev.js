// JevBrain: sends the state and questions to /api/decide (the server holds the key) and returns
// Jev's choices. Invalid answers fall back to the rules brain for that tick. Other decision models
// (decision.js) get the same state and questions and go through decisionResult too.

import { api } from "../common.js";

export class JevBrain {
  constructor() { this.name = "jev"; this.timeoutMs = 1500; this.questionDriven = true; }

  async decide(snap, eligible, request, signal) {
    const started = performance.now();
    const res = await api("/api/decide", { tick: snap.tick, epoch: request.epoch, state: request.state, questions: request.questions }, { signal });
    return decisionResult(res, request, eligible, { ...res.meta, source: "jev", round_trip_ms: Math.round(performance.now() - started) });
  }
}

// System One answers as an autopilot decision. Questions resolved locally (one eligible candidate,
// no motion question) keep their local answers; a vector outside the eligible set becomes null, which
// the autopilot replaces with the Rules choice and reports as a fallback.
export function decisionResult(res, request, eligible, meta) {
  const answers = { ...request.local, ...res.answers };
  const motion = answers.motion ? answers.motion.choice : "drive";
  let candidateId = answers.vector ? answers.vector.choice : null;
  if (candidateId && !eligible.some((c) => c.id === candidateId)) candidateId = null;
  const routeId = answers.route ? answers.route.choice : null;
  return { motion, candidateId, routeId, answers, meta, trace: res.trace };
}
