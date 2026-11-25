// JevBrain: sends the state and questions to /api/decide (the server holds the key) and returns
// Jev's choices. Invalid answers fall back to the rules brain for that tick. Other decision models
// (decision.js) get the same state and questions and go through decisionResult too.

import { api } from "../common.js";

export class JevBrain {
  constructor() {
    this.name = "jev";
    this.timeoutMs = 1500;
    this.questionDriven = true;
    this.transport = api;
  }

  async decide(snap, eligible, request, signal) {
    const started = performance.now();
    const res = await this.transport(
      "/api/decide",
      { tick: snap.tick, epoch: request.epoch, state: request.state, questions: request.questions },
      { signal },
    );
    return decisionResult(res, request, eligible, {
      ...res?.meta,
      source: "jev",
      round_trip_ms: Math.round(performance.now() - started),
    });
  }
}

// System One answers as an autopilot decision. Questions resolved locally (one eligible candidate,
// no motion question) keep their local answers; a vector outside the eligible set becomes null, which
// the autopilot replaces with the Rules choice and reports as a fallback.
export function decisionResult(res, request, eligible, meta) {
  const raw = res?.answers;
  const fail = (message) => {
    throw Object.assign(new Error(`invalid answer: ${message}`), {
      meta: { ...meta, live_call: true },
      trace: res?.trace,
    });
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("missing answers object");
  const { questions = {}, local = {} } = request;
  const answers = { ...local };
  for (const id of ["motion", "vector", "route", "headlights"]) {
    const criteria = questions[id]?.criteria;
    const answer = raw[id];
    if (
      criteria &&
      typeof answer?.choice === "string" &&
      Object.hasOwn(criteria, answer.choice) &&
      !Object.hasOwn(local, id)
    )
      answers[id] = answer;
  }
  if (questions.motion && !answers.motion) fail("missing or invalid motion");
  const motion = answers.motion?.choice ?? "drive";
  const candidateId = eligible.find((c) => c.id === answers.vector?.choice)?.id ?? null;
  return { motion, candidateId, routeId: answers.route?.choice ?? null, answers, meta, trace: res.trace };
}
