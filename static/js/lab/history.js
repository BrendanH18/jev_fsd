import { failures } from "../bench/metrics.js";

export const EVALUATION_SCHEMA = "jev-agent-evaluation-v2";
export const EVALUATION_HISTORY_KEY = "jev-fsd-evaluations-v2";
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_HISTORY_BYTES = 4 * 1024 * 1024;
const CONDITIONS = { version: "challenge version", map: "map", pack: "map-pack version", seed: "seed",
  weather: "weather", time: "time of day", car: "vehicle", mode: "decision clock", limit_s: "time limit" };
const COUNTERS = ["time_s", "collisions", "red_lights", "stop_signs", "failed_to_yield", "off_road_s", "hard_brakes", "cost_usd"];
const text = value => typeof value === "string" && value.length > 0 && value.length <= 240;
const finite = value => Number.isFinite(value) && value >= 0;

// Imports are data only. Validate before replacing the current view or saved history.
export function validateEvaluation(value) {
  if (!value || ![EVALUATION_SCHEMA, "jev-agent-evaluation-v1"].includes(value.schema)) throw new Error("Choose a Jev agent evaluation JSON export (v1 or v2).");
  if (!Number.isInteger(value.challenge_version) || value.challenge_version < 1 || !Array.isArray(value.results)
    || !value.results.length || value.results.length > 300 || !text(value.created_at) || !Number.isFinite(Date.parse(value.created_at))) throw new Error("The evaluation has invalid dates, versions or results.");
  const results = value.results.map(r => {
    if (!r || !["challenge", "map", "brain", "weather", "time", "car"].every(k => text(r[k]))
      || !["lockstep", "realtime"].includes(r.mode) || !Number.isInteger(r.version) || r.version < 1
      || !Number.isInteger(r.seed) || r.pack == null || !["string", "number"].includes(typeof r.pack)
      || !COUNTERS.every(k => finite(r[k])) || typeof r.arrived !== "boolean" || typeof r.stopped !== "boolean"
      || (r.latency_p50_ms !== null && !finite(r.latency_p50_ms))
      || !r.report || !finite(r.report.score) || r.report.score > 100 || typeof r.report.qualified !== "boolean"
      || r.report.status !== (r.stopped ? "stopped" : r.arrived ? "arrived" : "timeout")
      || !Number.isInteger(r.report.model_version) || !Array.isArray(r.report.incidents) || r.report.incidents.length > 100
      || r.report.incidents.some(e => !e || !finite(e.at_s) || !text(e.type) || !text(e.message))) throw new Error("The export contains an invalid evaluation result.");
    if (value.schema === EVALUATION_SCHEMA && (!finite(r.limit_s) || r.limit_s === 0 || !text(r.engine_version))) throw new Error("The export is missing its evaluation conditions.");
    if (r.decisions_trace !== undefined && (!Array.isArray(r.decisions_trace) || r.decisions_trace.length > 600
      || r.decisions_trace.some(d => !d || !finite(d.at_s) || !Number.isInteger(d.id) || d.id < 1 || !text(d.source)
        || !["drive", "stop", "reverse"].includes(d.motion) || !(d.chosen_id === null || text(d.chosen_id))
        || !Array.isArray(d.flags) || d.flags.length > 20 || d.flags.some(f => !text(f))
        || typeof d.context_recorded !== "boolean"
        || (d.state === null ? d.context_recorded : !d.state || typeof d.state !== "object" || Array.isArray(d.state))
        || (d.candidates === null ? d.context_recorded : !Array.isArray(d.candidates) || d.candidates.length > 100
          || d.candidates.some(c => !c || !text(c.id) || typeof c.eligible !== "boolean" || !(c.reject === null || text(c.reject))
            || !(c.target_mps === null || finite(c.target_mps)))))
      || new Set(r.decisions_trace.map(d => d.id)).size !== r.decisions_trace.length)) throw new Error("The export contains an invalid decision trace.");
    if (r.events !== undefined && (!Array.isArray(r.events) || r.events.length > 1000
      || r.events.some(e => !e || !finite(e.at_s) || !text(e.type) || !text(e.message)
        || !(e.decision_id === null || r.decisions_trace?.some(d => d.id === e.decision_id && d.at_s <= e.at_s && d.context_recorded))
        || !(e.decision_age_s === null || finite(e.decision_age_s))))) throw new Error("The export contains an invalid incident timeline.");
    const f = failures(r);
    return { ...r, failures: f, pass: !r.stopped && f.length === 0 };
  });
  return { schema: value.schema, challenge_version: value.challenge_version, created_at: value.created_at,
    status: ["complete", "stopped", "error", "imported"].includes(value.status) ? value.status : "imported", results };
}

export function readEvaluations(storage) {
  try {
    storage ||= globalThis.localStorage;
    const raw = JSON.parse(storage.getItem(EVALUATION_HISTORY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 10).flatMap(run => { try { return [validateEvaluation(run)]; } catch { return []; } });
  } catch { return []; }
}

export function saveEvaluation(run, storage) {
  const validated = validateEvaluation(run);
  storage ||= globalThis.localStorage;
  const runs = [validated, ...readEvaluations(storage)].slice(0, 10);
  let json = JSON.stringify(runs);
  const bytes = () => Math.max(json.length * 2, new Blob([json]).size); // localStorage can account for UTF-16 strings.
  while (runs.length > 1 && bytes() > MAX_HISTORY_BYTES) { runs.pop(); json = JSON.stringify(runs); }
  if (bytes() > MAX_HISTORY_BYTES) throw new Error("This evaluation is too large for browser history. Export it to keep a copy.");
  for (;;) {
    try { storage.setItem(EVALUATION_HISTORY_KEY, json); break; }
    catch (error) {
      if (error.name !== "QuotaExceededError" || runs.length === 1) throw error;
      runs.pop(); json = JSON.stringify(runs);
    }
  }
  return runs;
}

export function conditionDifferences(a, b) {
  const differences = Object.entries(CONDITIONS).filter(([k]) => a[k] == null || b[k] == null || a[k] !== b[k]).map(([, label]) => label);
  if (!a.engine_version || !b.engine_version || a.engine_version !== b.engine_version) differences.push("simulation version");
  if (a.report?.model_version == null || b.report?.model_version == null || a.report.model_version !== b.report.model_version) differences.push("scoring version");
  return differences;
}

export function compareResult(result, baseline, brain) {
  const candidates = baseline.results.filter(r => r.challenge === result.challenge && r.brain === brain);
  if (!candidates.length) return { reasons: ["challenge absent from baseline"] };
  const matches = candidates.filter(r => !conditionDifferences(result, r).length);
  if (matches.length > 1) return { reasons: ["duplicate baseline results"] };
  if (!matches.length) {
    const nearest = candidates.map(r => conditionDifferences(result, r)).sort((a, b) => a.length - b.length)[0];
    return { reasons: nearest };
  }
  const before = matches[0];
  if (result.stopped || before.stopped) return { reasons: ["stopped attempt"] };
  return { before, reasons: [] };
}

export const incidentCount = r => r.collisions + r.red_lights + r.stop_signs + r.failed_to_yield;
export function summarizeResults(results) {
  const mean = key => { const values = results.map(r => r[key]).filter(Number.isFinite); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };
  return { count: results.length, pass_rate: results.length ? results.filter(r => r.pass && !r.stopped).length / results.length : 0,
    incidents: results.reduce((sum, r) => sum + incidentCount(r), 0), hard_brakes: results.reduce((sum, r) => sum + r.hard_brakes, 0),
    latency_p50_ms: mean("latency_p50_ms"), cost_usd: results.reduce((sum, r) => sum + r.cost_usd, 0) };
}
