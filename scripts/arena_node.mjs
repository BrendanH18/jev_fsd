// Run the drive lab's challenges and road tests under Node against a running local server, with any
// driver, as the arena does (lab/evaluation.js `evaluateChallenge`), and record or replay a model run.
// PORT=8331 uv run server.py, then:
// node --experimental-default-type=module scripts/arena_node.mjs --brain jev --record data/recordings/jev-challenges.json
// node --experimental-default-type=module scripts/arena_node.mjs --replay data/recordings/jev-challenges.json --check 1
// Options: --brain (rules, cautious, jev, decision:<name>, llm:<name>), --set (challenges, the default;
// road-tests; or all), --only id,id (just these), --port, --json out.json (a summary per drive, no
// decision trace), --check 1 (exit with status 1 if a drive fails or a replay does not play out as
// recorded), --record out.json and --replay rec.json (model drivers only; docs/agents.md; a name
// ending .gz is gzipped), --reserve 0.5 (stop between drives once the server's budget runs low).
//
// A recording here covers several maps, so its header keeps one map fingerprint per map
// (`header.maps`), and each drive's recorded result leaves out the decision trace and timeline,
// which are large, keeping `result_sha`, the hash of the whole comparable result, so a replay is
// still compared field for field (timings aside).
const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => {
  if (a.startsWith("--")) out.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return out;
}, []));
const fail = (message) => { console.error(message); process.exit(1); };
const OPTIONS = ["brain", "set", "only", "port", "json", "check", "record", "replay", "reserve"];
for (const [name, value] of Object.entries(args)) {
  if (!OPTIONS.includes(name)) fail(`Unknown option --${name}: use ${OPTIONS.map((o) => `--${o}`).join(", ")}.`);
  if (value === true) fail(`--${name} needs a value.`);
}
if (args.record && args.replay) fail("Use --record or --replay, not both.");
const fs = await import("node:fs"), zlib = await import("node:zlib");
let replayJson = null;
if (args.replay) {
  try { const raw = fs.readFileSync(args.replay); replayJson = JSON.parse(args.replay.endsWith(".gz") ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8")); } catch (error) { fail(`Cannot read the recording ${args.replay}: ${error.message}`); }
  if (typeof replayJson?.header?.driver !== "string" || !replayJson.header.arena) fail(`${args.replay} is not an arena model recording.`);
  const given = ["brain", "set"].filter((name) => args[name] !== undefined);
  if (given.length) fail(`The recording sets the driver and drives: drop ${given.map((name) => `--${name}`).join(", ")}.`);
  args.brain = replayJson.header.driver;
}

const base = `http://127.0.0.1:${args.port || process.env.PORT || 8331}`;
const page = await (await fetch(`${base}/bench`)).text();
const token = page.match(/name="jev-csrf" content="([^"]+)"/)?.[1] || "";
globalThis.document = { querySelector: (sel) => (sel.includes("jev-csrf") ? { content: token } : null) };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (path, opts) => nativeFetch(String(path).startsWith("/") ? base + path : path, opts);

const { api } = await import("../static/js/common.js");
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");
const { evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { agentDefinitions } = await import("../static/js/brain/registry.js");
const rec = await import("../static/js/brain/recording.js");

const brain = String(args.brain || "rules");
if (/^(?:decision|llm):/.test(brain) && !replayJson) {
  const status = await api("/api/status");
  (await import("../static/js/brain/decision.js")).registerDecisionAgents(status.decision);
  (await import("../static/js/brain/llm.js")).registerLlmAgents(status.llm);
}
if (!replayJson && !agentDefinitions().some((d) => d.id === brain)) fail(`Unknown brain "${brain}": use one of ${agentDefinitions().map((d) => d.id).join(", ")}.`);
if ((args.record || args.replay) && !rec.driverKind(brain)) fail(`--record and --replay need a model driver (jev, decision:<name> or llm:<name>), not "${brain}".`);

const SETS = { challenges: CHALLENGES, "road-tests": ROAD_TESTS, all: [...CHALLENGES, ...ROAD_TESTS] };
const set = replayJson ? replayJson.header.arena.set : String(args.set || "challenges");
if (!SETS[set]) fail(`Unknown set "${set}": use ${Object.keys(SETS).join(", ")}.`);
let drives = SETS[set];
if (replayJson) drives = drives.filter((c) => c.id in replayJson.results);
const only = args.only ? String(args.only).split(",") : null;
const unknown = (only || []).filter((id) => !drives.some((c) => c.id === id));
if (unknown.length) fail(`No drive ${unknown.join(", ")} in ${set}.`);
if (only) drives = drives.filter((c) => only.includes(c.id));

// The challenge maps, with every layer, as the app loads them.
const maps = {};
for (const id of new Set(drives.map((c) => c.map))) maps[id] = new MapData(await api(`/api/map?bbox=${encodeURIComponent(id)}`));
const shas = Object.fromEntries(Object.entries(maps).map(([id, map]) => [id, rec.mapFingerprint(map)]));

let recording = null;
if (replayJson) {
  try { recording = rec.ModelRecording.parse(replayJson); } catch (error) { fail(`Cannot replay ${args.replay}: ${error.message}`); }
  const changed = Object.keys(shas).filter((id) => recording.header.maps?.[id] !== shas[id]);
  if (changed.length) fail(`The map data of ${changed.join(", ")} has changed since this recording was made (a rebuilt pack or layer).`);
} else if (args.record) {
  const definition = agentDefinitions().find((d) => d.id === brain);
  const model = brain === "jev" ? (await api("/api/status")).decision?.jev?.model : null;
  recording = new rec.ModelRecording({ header: rec.recordingHeader({ driver: brain, brain: { endpoint: definition?.llm || definition?.decision }, model,
    arena: { set, ids: drives.map((c) => c.id) }, maps: shas }) });
}

const save = (recording) => { const text = recording.serialize(); fs.writeFileSync(args.record, args.record.endsWith(".gz") ? zlib.gzipSync(text, { level: 9 }) : text); };
const BULKY = ["decisions_trace", "events", "report"];
const trimmed = (result) => Object.fromEntries(Object.entries(rec.comparableResult(result)).filter(([k]) => !BULKY.includes(k)));
const resultSha = (result) => rec.hashText(rec.canonicalJson(rec.comparableResult(result)));
const SUMMARY = ["challenge", "map", "pass", "failures", "arrived", "time_s", "collisions", "at_fault", "hard_brakes", "safety_brakes", "decisions", "fallbacks",
  "model_share", "local_share", "fallback_share", "cost_usd", "input_tokens", "output_tokens", "simulation_error", "stopped"];

// --reserve 0.5: start no further drive once less than this many dollars of the server's budget
// (JEV_FSD_BUDGET_USD) are left, so a run that would outspend it stops between drives instead of
// spoiling the drive under way with budget fallbacks. With --record, the finished drives are kept.
const reserve = args.reserve === undefined ? null : Number(args.reserve);
if (reserve !== null && !(reserve >= 0)) fail("--reserve must be a number of dollars.");
const results = [], drifted = [];
let budgetStop = null;
for (const challenge of drives) {
  if (reserve !== null) {
    const { budget_usd: budget, spent_usd: spent } = (await api("/api/status")).spend || {};
    if (Number.isFinite(budget) && budget - spent < reserve) { budgetStop = `stopped before ${challenge.id}: $${(budget - spent).toFixed(2)} of the budget left`; break; }
  }
  const tape = recording ? recording.tape(challenge.id, args.record ? "record" : "replay") : null;
  const r = await evaluateChallenge(maps[challenge.map], challenge, { brain, tape });
  // (saved after every drive, so a run stopped part way keeps the drives it finished)
  if (args.record) { recording.results[challenge.id] = { ...trimmed(r), result_sha: resultSha(r) }; save(recording); }
  if (replayJson) {
    const recorded = recording.results[challenge.id];
    r.model_recording.same_result = recorded ? recorded.result_sha === resultSha(r) : null;
    if (r.model_recording.same_result !== true || !r.model_recording.exact) drifted.push(challenge.id);
  }
  results.push(r);
  const shares = r.model_share !== undefined ? ` model=${r.model_share} local=${r.local_share} fallback=${r.fallback_share}` : "";
  console.log(`${challenge.id} ${r.pass ? "PASS" : "FAIL"} arrived=${r.arrived} t=${r.time_s} decisions=${r.decisions}${shares} cost=${r.cost_usd ?? 0}`
    + `${r.pass ? "" : ` failures=${(r.failures || []).join(",")}`}${r.simulation_error ? ` error=${JSON.stringify(r.simulation_error)}` : ""}`
    + `${r.model_recording ? ` rec=${JSON.stringify(r.model_recording)}` : ""}`);
}
if (budgetStop) console.log(budgetStop);
const passed = results.filter((r) => r.pass).length;
const cost = results.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
const summary = { brain, set, drives: results.length, passed, cost_usd: Math.round(cost * 1e6) / 1e6, engine: `node ${process.version}` };
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ summary, results: results.map((r) => Object.fromEntries(SUMMARY.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]))) }, null, 1));
if (args.record) console.log(`recorded ${results.length} drives to ${args.record}`);
if (replayJson) console.log(drifted.length ? `replay: ${drifted.join(", ")} did not play out as recorded` : `replay: all ${results.length} drives played out as recorded`);
const failed = args.check && args.check !== "0" ? [...new Set([...results.filter((r) => !r.pass).map((r) => r.challenge), ...drifted])] : [];
if (failed.length) console.error(`${failed.length} of ${results.length} drives failed${drifted.length ? " or did not replay as recorded" : ""}: ${failed.join(", ")}`);
process.stdout.write(`${JSON.stringify(summary)}\n`, () => process.exit(failed.length ? 1 : 0));
