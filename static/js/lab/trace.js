const round = value => Math.round(value * 1000) / 1000;
const AUDITS = { collisions: "Collision", red_lights_run: "Red light", stop_signs_run: "Missed stop", failed_to_yield: "Failed to yield" };
export class EvaluationTrace {
  constructor() {
    this.decisions = []; this.events = []; this.latest = null; this.truncated = false; this.nextId = 1;
    this.audit = {}; this.hardBrakes = 0; this.offRoadRecorded = false;
  }
  decision(decision, at) {
    // Keep full snapshots for event-linked decisions; the remaining choices form a compact log.
    if (this.latest && !this.latest.context_recorded) { this.latest.state = null; this.latest.candidates = null; }
    const observation = { ...(decision.state || {}) };
    // Candidate predictions are already represented below; duplicating them makes a default suite exceed localStorage.
    delete observation.candidates; delete observation.rejected;
    const d = { id: this.nextId++, at_s: round(at), chosen_id: decision.chosenId, motion: decision.motion,
      source: decision.meta?.source || "unknown", error: decision.meta?.error || decision.meta?.fallback || null, context_recorded: false,
      flags: [...(decision.flags || [])], state: JSON.parse(JSON.stringify(observation)),
      candidates: (decision.candidates || []).map(c => ({ id: c.id, eligible: c.eligible, reject: c.reject || null,
        target_mps: Number.isFinite(c.law?.vTarget) ? c.law.vTarget : null })) };
    if (this.decisions.length < 600) { this.decisions.push(d); this.latest = d; }
    else { this.latest = null; this.truncated = true; }
  }
  event(type, message, at, extra = {}) {
    if (this.events.length >= 1000) { this.truncated = true; return; }
    if (this.latest) this.latest.context_recorded = true;
    this.events.push({ ...extra, type, message: String(message).slice(0, 240), at_s: round(at), decision_id: this.latest?.id ?? null,
      decision_age_s: this.latest ? round(Math.max(0, at - this.latest.at_s)) : null });
  }
  measurements(world, score) {
    // Read counters directly: the coaching report's 100-incident limit must not hide later failures.
    for (const [key, message] of Object.entries(AUDITS)) {
      const count = (world.violations[key] || 0) - (this.audit[key] || 0);
      if (count > 0) this.event(key, message, world.t, { count });
      this.audit[key] = world.violations[key] || 0;
    }
    if (score.hardBrakes > this.hardBrakes) this.event("hard_brake", "Hard braking", world.t, { count: score.hardBrakes - this.hardBrakes });
    this.hardBrakes = score.hardBrakes;
    if (!this.offRoadRecorded && world.violations.off_road_s >= 1) {
      this.event("off_road", "One second off-road: evaluation failed", world.t); this.offRoadRecorded = true;
    }
  }
  export() { return { decisions_trace: this.decisions, events: this.events, trace_truncated: this.truncated }; }
}
