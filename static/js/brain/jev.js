// JevBrain sends the state and questions to the local server, which holds the provider key.
// Other decision models (decision.js) use the same question and answer formats.

import { api } from "../common.js";
import { callModel, checkCoordinates, checkJevRequest, isObject, nonblank, own, replyError } from "./model-contract.js";

export class JevBrain {
  constructor() {
    this.name = "jev";
    this.timeoutMs = 1500;
    this.questionDriven = true;
    this.transport = api;
  }

  async decide(snap, eligible, request, signal) {
    signal?.throwIfAborted();
    const body = { tick: snap.tick, epoch: request.epoch, state: request.state, questions: request.questions };
    checkCoordinates(body);
    checkJevRequest(body);
    const { response, meta } = await callModel(this, "/api/decide", body, signal);
    return decisionResult(response, request, eligible, meta);
  }
}

const probability = (value) => Number.isFinite(value) && value >= 0 && value <= 1;

function choiceAnswer(answer, criteria) {
  if (!isObject(answer)) return null;
  const type = own(answer, "type");
  const choice = own(answer, "choice");
  if ((type !== undefined && type !== "choice") || !nonblank(choice) || !Object.hasOwn(criteria, choice)) return null;

  // Choice controls the car. Confidence and probabilities are optional diagnostics.
  const clean = { ...answer };
  if (Object.hasOwn(clean, "confidence") && !probability(clean.confidence)) clean.confidence = null;
  if (Object.hasOwn(clean, "probabilities")) {
    clean.probabilities = Object.fromEntries(
      isObject(clean.probabilities)
        ? Object.entries(clean.probabilities).filter(([id, value]) => Object.hasOwn(criteria, id) && probability(value))
        : [],
    );
  }
  return clean;
}

// Local decisions take precedence. An unusable vector becomes null so the autopilot can keep a
// valid motion answer and substitute the Rules manoeuvre. Route and headlights can default.
export function decisionResult(res, request, eligible, meta) {
  const raw = own(res, "answers");
  const trace = own(res, "trace");
  const fail = (message) => {
    throw Object.assign(new Error(`invalid answer: ${message}`), { meta: { ...meta, live_call: true }, trace });
  };
  if (!isObject(raw)) fail(replyError(res) ?? "missing answers object");

  const { questions = {}, local = {} } = request;
  const answers = { ...local };
  for (const id of ["motion", "vector", "route", "headlights"]) {
    const criteria = own(own(questions, id), "criteria");
    if (!isObject(criteria) || Object.hasOwn(answers, id)) continue;
    const accepted = choiceAnswer(own(raw, id), criteria);
    if (accepted) answers[id] = accepted;
  }
  if (own(questions, "motion") && !answers.motion) fail("missing or invalid motion");
  const motion = answers.motion?.choice ?? "drive";
  if (motion !== "drive" && motion !== "stop") fail("motion must be drive or stop");
  const candidateId = eligible.find((c) => c.id === answers.vector?.choice)?.id ?? null;
  return { motion, candidateId, routeId: answers.route?.choice ?? null, answers, meta, trace };
}
