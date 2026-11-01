const round = value => Math.round(value * 1000) / 1000;
const AUDITS = { collisions: "Collision", red_lights_run: "Red light", stop_signs_run: "Missed stop", failed_to_yield: "Failed to yield", plow_right_passes: "Passed a snow plow on the right" };
export const MAX_TRACE_DECISIONS = 600;
// A decision no event links to is kept as a compact choice record: its id, time, choice, motion and
// source, and its fallback error and hazard flags when it has any. A run of such records with the same
// choice, motion, source, error and flags, one after another, is kept as the first of them, with how
// many it stands for (`repeats`) and when the last was made (`until_s`). Most of a drive is the same
// choice made again every few hundred milliseconds, so this keeps a run of every challenge small enough
// for saved history (lab/history.js).
const same = (a, b) => a.chosen_id === b.chosen_id && a.motion === b.motion && a.source === b.source
  && (a.error || null) === (b.error || null) && (a.flags || []).join("\n") === (b.flags || []).join("\n");
export function compactDecision(d) {
  const out = { id: d.id, at_s: d.at_s, chosen_id: d.chosen_id, motion: d.motion, source: d.source };
  if (d.error) out.error = d.error;
  if (d.flags?.length) out.flags = d.flags;
  if (d.repeats > 1) { out.repeats = d.repeats; out.until_s = d.until_s; }
  return out;
}
export class EvaluationTrace {
  constructor() {
    this.decisions = []; this.events = []; this.latest = null; this.truncated = false; this.nextId = 1;
    this.audit = {}; this.hardBrakes = 0; this.offRoadRecorded = false;
  }
  // The latest decision, once a newer one replaces it: compact unless an event links to it, and folded
  // into the record before it when it repeats it.
  settle() {
    const d = this.latest;
    if (!d || d.context_recorded) return;
    const i = this.decisions.indexOf(d), before = this.decisions[i - 1];
    if (before && !before.context_recorded && same(before, d)) {
      before.repeats = (before.repeats || 1) + 1; before.until_s = d.at_s;
      this.decisions.splice(i, 1);
    } else this.decisions[i] = compactDecision(d);
  }
  decision(decision, at) {
    // Keep full snapshots for event-linked decisions; the remaining choices form a compact log.
    this.settle();
    const observation = { ...(decision.state || {}) };
    // Candidate predictions are already represented below; duplicating them makes a default suite exceed localStorage.
    delete observation.candidates; delete observation.rejected;
    const d = { id: this.nextId++, at_s: round(at), chosen_id: decision.chosenId, motion: decision.motion,
      source: decision.meta?.source || "unknown", error: decision.meta?.error || decision.meta?.fallback || null, context_recorded: false,
      flags: [...(decision.flags || [])], state: JSON.parse(JSON.stringify(observation)),
      candidates: (decision.candidates || []).map(c => ({ id: c.id, eligible: c.eligible, reject: c.reject || null,
        target_mps: Number.isFinite(c.law?.vTarget) ? c.law.vTarget : null })) };
    if (this.decisions.length < MAX_TRACE_DECISIONS) { this.decisions.push(d); this.latest = d; }
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
  export() {
    // (the latest decision too, unless an event links to it, leaving the trace as it is)
    const decisions = [...this.decisions], last = this.latest;
    if (last && !last.context_recorded) {
      const before = decisions.at(-2);
      decisions.pop();
      if (before && !before.context_recorded && same(before, last)) decisions[decisions.length - 1] = { ...before, repeats: (before.repeats || 1) + 1, until_s: last.at_s };
      else decisions.push(compactDecision(last));
    }
    return { decisions_trace: decisions, events: this.events, trace_truncated: this.truncated };
  }
}
