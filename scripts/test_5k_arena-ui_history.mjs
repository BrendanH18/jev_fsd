import assert from "node:assert/strict";
import {
  compareResult,
  EVALUATION_HISTORY_KEY,
  EVALUATION_SCHEMA,
  openEvaluationHistory,
  readEvaluations,
  saveEvaluation,
  validateEvaluation,
} from "../static/js/lab/history.js";

const drive = {
  challenge: "turn",
  version: 1,
  map: "kitsilano",
  pack: 6,
  seed: 42,
  weather: "dry",
  time: "afternoon",
  car: "compact",
  brain: "rules",
  mode: "lockstep",
  engine_version: "drive-lab-3",
  limit_s: 180,
  arrived: true,
  stopped: false,
  collisions: 0,
  red_lights: 0,
  stop_signs: 0,
  failed_to_yield: 0,
  off_road_s: 0.2,
  hard_brakes: 1,
  time_s: 30,
  latency_p50_ms: null,
  cost_usd: 0.05,
  report: { model_version: 1, status: "arrived", score: 90, qualified: true, incidents: [] },
};
const run = {
  schema: EVALUATION_SCHEMA,
  challenge_version: 1,
  created_at: "2026-11-25T18:00:00Z",
  status: "complete",
  results: [drive],
};
const imported = (change, options) => validateEvaluation({ ...run, ...options, results: [{ ...drive, ...change }] });
const bad = (change, error = /invalid evaluation result/) => assert.throws(() => imported(change), error);
const choice = { id: 1, at_s: 0, source: "rules", motion: "drive", chosen_id: "hold" };
const context = { ...choice, context_recorded: true, flags: [], error: null, state: {}, candidates: [] };
const event = { at_s: 1, type: "brake", message: "Braked", decision_id: 1, decision_age_s: 1 };

assert.equal(imported({}).results[0].off_road_s, 0.2);
assert.equal(imported({ seed: -42 }).results[0].seed, -42);
assert.equal(
  imported({ arrived: false, deadlocks: 2, report: { ...drive.report, status: "timeout" } }).results[0].failures[0],
  "stuck",
);
assert.throws(
  () => imported({}, { challenge_version: Number.MAX_SAFE_INTEGER + 1 }),
  /invalid dates, versions or results/,
);
bad({ version: Number.MAX_SAFE_INTEGER + 1 });
bad({ seed: Number.MAX_SAFE_INTEGER + 1 });
bad({ car: " " });
bad({ collisions: Infinity });
bad({ red_lights: 1.5 });
bad({ stop_signs: -1 });
bad({ failed_to_yield: "1" });
bad({ hard_brakes: 0.1 });
bad({ deadlocks: [] });
bad({ amber_lights_run: "0" });
bad({ plow_right_passes: -1 });
bad({ merge_cut_ins: {} });
bad({ close_passes: true });
bad({ bus_lane_driving: Infinity });
bad({ glare_seconds: -1 });
bad({ parked: "true" });
bad({ trace_truncated: 0 });
bad({ fallback_decisions: 1 });
bad({
  model_decisions: 1,
  partial_decisions: 2,
  local_decisions: 0,
  fallback_decisions: 0,
  model_share: 1,
  local_share: 0,
  fallback_share: 0,
});
bad({ track: "open", flagged_choices: 0.5, flagged_by_check: { warning: 0.5 } });
bad({ track: "open", flagged_choices: 1, flagged_by_check: { "": 1 } });
bad({ track: "open", flagged_choices: 2, flagged_by_check: { warning: 1 } });
bad({ report: Object.assign([], drive.report) });
bad({ report: { ...drive.report, incidents: [{ type: "near", message: " ", at_s: 0 }] } });
bad({ decisions_trace: [{ ...choice, id: Number.MAX_SAFE_INTEGER + 1 }] }, /decision trace/);
bad({ decisions_trace: [{ ...choice, headlights: true }] }, /decision trace/);
bad(
  {
    decisions_trace: [
      { ...choice, at_s: 1 },
      { ...choice, id: 2 },
    ],
  },
  /decision trace/,
);
bad({ decisions_trace: [{ ...choice, id: 2 }, choice] }, /decision trace/);
bad(
  {
    decisions_trace: [
      { ...choice, repeats: 2, until_s: 1 },
      { ...choice, id: 3, at_s: 0.9 },
    ],
  },
  /decision trace/,
);
bad({ decisions_trace: [context], events: [{ ...event, decision_age_s: null }] }, /incident timeline/);
bad({ decisions_trace: [context], events: [{ ...event, decision_id: null }] }, /incident timeline/);
bad({ decisions_trace: [context], events: [event, { ...event, at_s: 0.8 }] }, /incident timeline/);
bad({ decisions_trace: [context], events: [{ ...event, count: 0 }] }, /incident timeline/);
assert.equal(
  imported({ decisions_trace: [context], events: [{ ...event, count: 2 }, event] }).results[0].events.length,
  2,
);
assert.equal(
  imported({ decisions_trace: [], events: [{ ...event, decision_id: null, decision_age_s: null }] }).results[0].events
    .length,
  1,
);
assert.equal(compareResult(drive, undefined, "rules").reasons[0], "no baseline results");

function local(initial) {
  let raw = JSON.stringify(initial);
  let writes = 0;
  let removals = 0;
  return {
    getItem: (key) => (key === EVALUATION_HISTORY_KEY ? raw : null),
    setItem: (_key, json) => {
      raw = json;
      writes++;
    },
    removeItem: () => {
      raw = null;
      removals++;
    },
    writes: () => writes,
    removals: () => removals,
  };
}
const recovered = local([...Array(14).fill({ schema: "broken" }), run]);
assert.equal(readEvaluations(recovered).length, 1);
assert.equal(readEvaluations(local([run, ...Array(15).fill(run)])).length, 10);
assert.equal(readEvaluations({ getItem: () => "null" }).length, 0);
const blocked = {
  ...local([run]),
  getItem: () => {
    throw new Error("Temporary read failure");
  },
};
assert.throws(() => saveEvaluation(run, blocked), /Temporary read failure/);
assert.equal(blocked.writes(), 0);
const blockedHistory = await openEvaluationHistory({ storage: blocked });
await assert.rejects(blockedHistory.remove(run), /Temporary read failure/);
assert.equal(blocked.writes(), 0);
const storage = local([run]);
const store = await openEvaluationHistory({ storage });
assert.equal((await store.remove({})).length, 1);
assert.equal(storage.writes(), 0);
assert.equal((await store.remove(run)).length, 0);
assert.equal(storage.removals(), 1);
assert.equal(readEvaluations(storage).length, 0);

const small = local([run]);
const write = small.setItem;
small.setItem = (key, json) => {
  if (JSON.parse(json).length > 1) throw Object.assign(new Error("No space"), { name: "NS_ERROR_DOM_QUOTA_REACHED" });
  write(key, json);
};
const newer = { ...run, created_at: "2026-11-26T18:00:00Z" };
assert.equal(saveEvaluation(newer, small)[0].created_at, newer.created_at);
assert.equal(readEvaluations(small).length, 1);
assert.equal(imported({ report: { ...drive.report, qualified: false } }).results[0].pass, true);
assert.equal(imported({ report: { ...drive.report, score: 0 } }).results[0].pass, true);
assert.equal(imported({ parked: false }).results[0].failures[0], "not parked");
assert.equal(imported({ parked: true }).results[0].pass, true);
assert.equal(imported({ off_road_s: 1 }).results[0].failures[0], "off road");
assert.equal(imported({ off_road_s: 0.999 }).results[0].pass, true);
const counts = {
  model_decisions: 3,
  partial_decisions: 1,
  local_decisions: 1,
  fallback_decisions: 2,
  model_share: 0,
  local_share: 0,
  fallback_share: 0,
};
assert.equal(imported(counts).results[0].model_share, 0.5);
assert.equal(imported(counts).results[0].local_share, 0.167);
assert.equal(imported(counts).results[0].fallback_share, 0.333);
assert.equal(imported(counts).results[0].partial_decisions, 1);
assert.equal(imported({ track: "open", flagged_choices: 0, flagged_by_check: {} }).results[0].pass, true);
const authored = local([run]);
const authoredSnapshot = authored.getItem(EVALUATION_HISTORY_KEY);
assert.equal(readEvaluations(authored)[0].created_at, run.created_at);
assert.equal(authored.getItem(EVALUATION_HISTORY_KEY), authoredSnapshot);
const old = imported(
  { decisions_trace: [context], events: [{ ...event, decision_age_s: null }] },
  { schema: "jev-agent-evaluation-v2" },
);
assert.equal(old.results[0].events[0].decision_id, 1);
assert.equal(imported({ trace_truncated: true }).results[0].trace_truncated, true);
console.log("Arena import validation and fallback history checks passed");
