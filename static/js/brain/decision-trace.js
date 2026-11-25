// Opt-in, local diagnostics for window.__jev.autopilot. Keep provider messages, answers,
// route geometry and live vehicle objects out of this history.
const contexts = new WeakMap();
export const decisionContext = (request) => (request ? contexts.get(request) : undefined);

export function startDecisionTrace(request, trace, driver, simMs, clear, pathHazard) {
  const context = {
    trace,
    driver,
    simMs,
    clear: clear?.map((candidate) => candidate.id),
    pathHazard,
    policy: {},
  };
  contexts.set(request, context);
  return context;
}

const measured = (number) => (Number.isFinite(number) ? number : null);
const count = (table, key) => table.set(key, (table.get(key) ?? 0) + 1);
const addCount = (table, key) => {
  if (key != null) count(table, key);
};

function predictionSummary(c) {
  const { law, sim } = c;
  return {
    id: c.id,
    kind: law.kind,
    eligible: c.eligible === true,
    flagged: c.flagged === true,
    rejectedBy: c.reject ?? null,
    speedCeilingMps: measured(law.vTarget),
    stopAtRouteM: measured(law.stopAtRoute),
    lateralTargetM: measured(law.offset),
    laneChange: c.change ? { offer: c.change.offer, direction: c.change.dir } : null,
    detour: Boolean(law.detour),
    speedRestrictions: law.slowTo?.length ?? 0,
    progressM: measured(sim?.progress_m),
    endSpeedMps: measured(sim?.end_speed),
    minGapM: measured(sim?.min_gap_m),
    clearanceM: measured(sim?.min_clearance_m),
    peakBrakeMps2: measured(sim?.max_decel),
    peakLateralMps2: measured(sim?.max_lateral_accel),
    offRoad: sim ? !sim.stays_on_road : null,
    leftLane: sim ? !sim.stays_in_lane : null,
    crossedStopLine: sim?.crosses_stop_line ?? null,
    collision: sim?.collision ? { id: sim.collision.id, atS: sim.collision.t, kind: sim.collision.kind } : null,
    staticCollision: sim?.static_collision?.id ?? null,
  };
}

// Summarize only scores that were actually used. Offer order is the tie-break.
function scoreStanding(policy, selected) {
  if (!policy || policy.candidateId !== selected) return null;
  const winner = policy.scores.find((score) => score.id === selected);
  if (!winner || !Number.isFinite(winner.cost)) return null;
  let runnerUp = null;
  for (const score of policy.scores)
    if (score !== winner && Number.isFinite(score.cost) && (!runnerUp || score.cost < runnerUp.cost)) runnerUp = score;
  return {
    score: winner.cost,
    runnerUp: runnerUp?.id ?? null,
    margin: runnerUp ? runnerUp.cost - winner.cost : null,
    tied: runnerUp?.cost === winner.cost,
  };
}

export class DecisionTrace {
  #entries = [];
  #sequence = 0;
  #capacity;

  constructor(capacity = 60) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500)
      throw new RangeError("Decision trace capacity must be an integer from 1 to 500");
    this.#capacity = capacity;
  }

  record(decision, context, request, details) {
    const policy = context.policy.driver ? context.policy : null;
    const entry = {
      sequence: ++this.#sequence,
      epoch: request.epoch ?? null,
      simMs: measured(context.simMs),
      driver: context.driver,
      track: request.track ?? "guarded",
      decidedBy: decision.decidedBy,
      source: decision.meta?.source ?? null,
      reason: context.reason ?? null,
      partial: !!details.partial,
      requestedId: typeof details.requestedId === "string" ? details.requestedId : null,
      selectedId: details.selectedId ?? null,
      executedId: decision.chosenId,
      motion: decision.motion,
      route: details.route,
      headlights: details.headlights,
      mustStop: request.mustStop ?? null,
      hazards: [...(request.flags ?? [])],
      pathHazard: context.pathHazard ? { ...context.pathHazard } : null,
      asked: Object.keys(request.questions ?? {}),
      resolvedLocally: Object.keys(request.local ?? {}),
      offered: (request.eligible ?? []).map((candidate) => candidate.id),
      unflagged: context.clear ?? null,
      predictions: decision.candidates.map(predictionSummary),
      policy: policy ? { ...policy, standing: scoreStanding(policy, details.selectedId) } : null,
      spend: {
        inputTokens: measured(decision.meta?.input_tokens),
        outputTokens: measured(decision.meta?.output_tokens),
        costUsd: measured(decision.meta?.cost_usd),
        costKnown: decision.meta?.cost_known === true,
        callCounted: !!context.callCounted,
      },
    };
    this.#entries.push(entry);
    if (this.#entries.length > this.#capacity) this.#entries.shift();
  }

  get latest() {
    return this.#entries.length ? structuredClone(this.#entries.at(-1)) : null;
  }

  clear() {
    this.#entries.length = 0;
  }

  #matching({ driver, decidedBy, reason, candidate, hazard, rejectedBy, question, motion, sinceMs, untilMs } = {}) {
    return this.#entries.filter(
      (entry) =>
        (driver === undefined || entry.driver === driver) &&
        (decidedBy === undefined || entry.decidedBy === decidedBy) &&
        (reason === undefined || entry.reason === reason) &&
        (candidate === undefined || entry.predictions.some((prediction) => prediction.id === candidate)) &&
        (hazard === undefined || entry.hazards.includes(hazard)) &&
        (rejectedBy === undefined || entry.predictions.some((prediction) => prediction.rejectedBy === rejectedBy)) &&
        (question === undefined || entry.asked.includes(question)) &&
        (motion === undefined || entry.motion === motion) &&
        (sinceMs === undefined || (entry.simMs !== null && entry.simMs >= sinceMs)) &&
        (untilMs === undefined || (entry.simMs !== null && entry.simMs <= untilMs)),
    );
  }

  entries(filters) {
    return structuredClone(this.#matching(filters));
  }

  summarize(filters) {
    const entries = this.#matching(filters);
    const drivers = new Map();
    const dispositions = new Map();
    const reasons = new Map();
    const motions = new Map();
    const applied = new Map();
    const rejections = new Map();
    const questionCounts = new Map();
    let partial = 0;
    let calls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let unknownCosts = 0;
    for (const entry of entries) {
      count(drivers, entry.driver);
      count(dispositions, entry.decidedBy);
      addCount(reasons, entry.reason);
      count(motions, entry.motion);
      addCount(applied, entry.executedId);
      for (const prediction of entry.predictions) addCount(rejections, prediction.rejectedBy);
      for (const question of entry.asked) count(questionCounts, question);
      if (entry.partial) partial++;
      if (entry.spend.callCounted) {
        calls++;
        if (!entry.spend.costKnown) unknownCosts++;
      }
      inputTokens += entry.spend.inputTokens ?? 0;
      outputTokens += entry.spend.outputTokens ?? 0;
      costUsd += entry.spend.costUsd ?? 0;
    }
    return {
      decisions: entries.length,
      drivers: Object.fromEntries(drivers),
      dispositions: Object.fromEntries(dispositions),
      reasons: Object.fromEntries(reasons),
      motions: Object.fromEntries(motions),
      applied: Object.fromEntries(applied),
      rejections: Object.fromEntries(rejections),
      questionCounts: Object.fromEntries(questionCounts),
      partial,
      spend: { calls, inputTokens, outputTokens, costUsd, unknownCosts },
    };
  }
}
