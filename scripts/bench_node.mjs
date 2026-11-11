// Run the production bench suite under Node against a running local server: the same suite builder,
// runner and metrics as /bench, without a browser. Results are for V8; compare them only with other
// V8 runs (see docs/rules-baseline.md).
// PORT=8331 uv run server.py, then:
// node --experimental-default-type=module scripts/bench_node.mjs --map calgary --count 2
// Options: --map (a preset id or W,S,E,N), --count, --seed, --npcs, --brain, --weather, --port,
// --features (bare, the default, with every opt-in feature off; or city, the free drive's: bench/runner.js),
// --park 1, --hour 23.5 (both presets), --without geese,ice (city), --cover 0 (city pairwise row),
// --diagnostics 1 (incident positions and actors), --only s1-1,s1-2 (run just these scenarios), --json out.json (write the full results) and --check 1
// (exit with status 1 if any route fails, as CI does).
// Model recordings (static/js/brain/recording.js, docs/agents.md): --record out.json keeps every answer a
// model driver (--brain jev, decision:<name> or llm:<name>) gets, keyed by its request, with each drive's
// result; --replay rec.json drives again from those answers with no model call and no key, taking the
// driver, map and suite from the recording, and reports whether each drive played out as recorded
// (with --check 1, a drive that did not fails the run).
const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => {
  if (a.startsWith("--")) out.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return out;
}, []));
const fail = (message) => { console.error(message); process.exit(1); };
// Every option takes a value; one without (parsed as `true`) or a misspelled one would otherwise
// run the defaults.
const OPTIONS = ["map", "count", "seed", "npcs", "brain", "weather", "features", "port", "only", "json", "check", "park", "hour", "without", "cover", "diagnostics", "record", "replay"];
for (const [name, value] of Object.entries(args)) {
  if (!OPTIONS.includes(name)) fail(`Unknown option --${name}: use ${OPTIONS.map((o) => `--${o}`).join(", ")}.`);
  if (value === true) fail(`--${name} needs a value.`);
}
if (args.record && args.replay) fail("Use --record or --replay, not both.");
// A replay takes its driver, map and suite from the recording.
const SUITE_OPTIONS = ["map", "count", "seed", "npcs", "brain", "weather", "features", "park", "hour", "without", "cover"];
// (read here, checked once the modules load: they need the page's token first)
let replayJson = null;
if (args.replay) {
  try { replayJson = JSON.parse((await import("node:fs")).readFileSync(args.replay, "utf8")); } catch (error) { fail(`Cannot read the recording ${args.replay}: ${error.message}`); }
  if (typeof replayJson?.header?.driver !== "string") fail(`${args.replay} is not a model recording.`);
  const given = SUITE_OPTIONS.filter((name) => args[name] !== undefined);
  if (given.length) fail(`The recording sets the driver and suite: drop ${given.map((name) => `--${name}`).join(", ")}.`);
  const b = replayJson.header.bench || {};
  Object.assign(args, { map: b.map, count: String(b.count), seed: String(b.seed), npcs: String(b.npcs), brain: replayJson.header.driver, weather: b.weather,
    features: b.features || "bare", ...(b.park ? { park: "1" } : {}), ...(b.hour !== undefined ? { hour: String(b.hour) } : {}),
    ...(b.without?.length ? { without: b.without.join(",") } : {}), ...(b.cover !== undefined ? { cover: String(b.cover) } : {}) });
}
const base = `http://127.0.0.1:${args.port || process.env.PORT || 8331}`;
const page = await (await fetch(`${base}/bench`)).text();
const token = page.match(/name="jev-csrf" content="([^"]+)"/)?.[1] || "";
globalThis.document = { querySelector: (sel) => (sel.includes("jev-csrf") ? { content: token } : null) };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (path, opts) => nativeFetch(String(path).startsWith("/") ? base + path : path, opts);

const { api } = await import("../static/js/common.js");
const { MapData } = await import("../static/js/map/mapdata.js");
const { buildSuite } = await import("../static/js/bench/scenarios.js");
const { runScenario, suiteOptions, FEATURE_PRESETS, benchmarkConfig } = await import("../static/js/bench/runner.js");
const { aggregate } = await import("../static/js/bench/metrics.js");
const { WEATHER } = await import("../static/js/sim/weather.js");
const { agentDefinitions } = await import("../static/js/brain/registry.js");
const recordingModule = args.record || args.replay ? await import("../static/js/brain/recording.js") : null;
let replaying = null;
if (replayJson) try { replaying = recordingModule.ModelRecording.parse(replayJson); } catch (error) { fail(`Cannot replay ${args.replay}: ${error.message}`); }

// The server falls back to its default map for a name or box it does not recognise, so check
// that the map it returned is the one asked for.
const maps = (await api("/api/maps")).maps;
// (a recording made on /bench names its map by the pack's cache key: replay it by its box)
const replayBbox = replayJson?.header?.bench?.bbox;
const preset = String(!maps.some((m) => m.id === args.map) && replayBbox ? replayBbox.join(",") : args.map || "kitsilano");
const known = maps.find((m) => m.id === preset);
const wanted = known ? known.bbox : preset.split(",").map(Number);
if (wanted.length !== 4 || wanted.some((v) => !Number.isFinite(v))) fail(`Unknown map "${preset}": use a preset id or W,S,E,N.`);
const map = new MapData(await api(`/api/map?bbox=${encodeURIComponent(preset)}`));
if (map.routingBbox.some((v, i) => Math.abs(v - wanted[i]) > 1e-6)) fail(`The server loaded ${map.routingBbox.join(",")} instead of "${preset}".`);
// The world and autopilot also fall back silently (to dry weather, to the previous driver), so an
// unknown weather or driver would run something else under the name asked for.
// (model endpoints configured on the server join the drivers, as on /bench)
let status = null;
if (/^(?:decision|llm):/.test(String(args.brain)) && !replaying) {
  status = await api("/api/status");
  (await import("../static/js/brain/decision.js")).registerDecisionAgents(status.decision);
  (await import("../static/js/brain/llm.js")).registerLlmAgents(status.llm);
}
const brains = agentDefinitions().map((d) => d.id);
if (!replaying && !brains.includes(String(args.brain || "rules"))) fail(`Unknown brain "${args.brain}": use one of ${brains.join(", ")}.`);
if (!FEATURE_PRESETS.includes(String(args.features || "bare"))) fail(`Unknown features "${args.features}": use one of ${FEATURE_PRESETS.join(", ")}.`);
if (!Object.hasOwn(WEATHER, String(args.weather || "dry"))) fail(`Unknown weather "${args.weather}": use one of ${Object.keys(WEATHER).join(", ")}.`);
const integer = (name, fallback, min) => {
  // Plain digits only: Number() also reads " " as 0 and accepts forms such as 1e2 or 0x10.
  const v = args[name] === undefined ? fallback : /^\d+$/.test(args[name]) ? Number(args[name]) : NaN;
  if (!Number.isSafeInteger(v) || v < min) fail(`--${name} must be a whole number of at least ${min}, not "${args[name]}".`);
  return v;
};
for (const name of ["park", "diagnostics"]) if (args[name] !== undefined && !["0", "1"].includes(args[name])) fail(`--${name} must be 0 or 1.`);
if (args.hour !== undefined && !/^\d+(?:\.\d+)?$/.test(args.hour)) fail("--hour must be a number from 0 inclusive to 24 exclusive.");
let options;
try {
  options = benchmarkConfig({ features: args.features || "bare", park: args.park === "1",
    ...(args.hour !== undefined ? { hour: Number(args.hour) } : {}), without: args.without || [],
    ...(args.cover !== undefined ? { cover: integer("cover", 0, 0) } : {}) });
} catch (error) { fail(error.message); }
const config = { brain: String(args.brain || "rules"), count: integer("count", 12, 1), seed: integer("seed", 1, 0), npcs: integer("npcs", 40, 0),
  mode: "lockstep", weather: String(args.weather || "dry"), ...options, map: preset, bbox: map.routingBbox, pack: map.pack.pack_version, engine: `node ${process.version}` };
const features = config.features || "bare";
let recording = replaying;
if (args.record) {
  const driver = config.brain;
  if (!recordingModule.driverKind(driver)) fail(`--record needs a model driver (jev, decision:<name> or llm:<name>), not "${driver}".`);
  const definition = agentDefinitions().find((d) => d.id === driver);
  const jevModel = driver === "jev" ? (status || await api("/api/status")).decision?.jev?.model : null;
  recording = new recordingModule.ModelRecording({ header: recordingModule.recordingHeader({ driver, brain: { endpoint: definition?.llm || definition?.decision }, model: jevModel,
    map: preset, map_sha: recordingModule.mapFingerprint(map), seed: config.seed, preset: features, weather: config.weather, bench: config }) });
}
if (replaying) try { recordingModule.checkMap(replaying, map); } catch (error) { fail(error.message); }
// (a replay drives the recorded scenarios, so a router changed since cannot move them)
const suite = replaying?.suite() || await buildSuite(map, { count: config.count, seed: config.seed, ...suiteOptions(features, options) });
if (!suite.length) fail(`No routable scenarios on "${preset}".`);
const only = args.only ? String(args.only).split(",") : null;
const missing = (only || []).filter((id) => !suite.some((sc) => sc.id === id));
if (missing.length) fail(`No scenario ${missing.join(", ")} in this suite (${suite.map((sc) => sc.id).join(", ")}).`);
const results = [], drifted = [];
for (const sc of suite) {
  if (only && !only.includes(sc.id)) continue;
  const tape = recording ? recording.tape(sc.id, args.record ? "record" : "replay") : null;
  const r = await runScenario(map, sc, { brain: config.brain, npcs: config.npcs, mode: config.mode, weather: config.weather, ...options, diagnostics: args.diagnostics === "1", tape });
  if (args.record) recording.keepResult(sc.id, r, sc);
  // (a replay matches when every call was answered from the recording and the drive's result is the
  // recorded one, timings aside)
  if (replaying) {
    const recorded = replaying.results[sc.id];
    r.model_recording.same_result = recorded ? recordingModule.sameResult(r, recorded) : null;
    // (a drive the recording has no result for cannot be checked: drift too)
    if (r.model_recording.same_result !== true || !r.model_recording.exact) drifted.push(r.id);
  }
  results.push(r);
  const hits = r.events.filter((e) => e.type === "collision").map((e) => `${e.with}:${e.kind}@${e.t}`).join(" ");
  console.log(`${r.id} ${r.pass ? "PASS" : "FAIL"} arrived=${r.arrived} t=${r.time_s} coll=${r.collisions}/${r.at_fault} off=${r.off_road_s} dl=${r.deadlocks} safety=${r.safety_brakes} lc=${r.lane_changes ?? "-"} ${hits}${r.pass ? "" : ` failures=${r.failures.join(",")}`}${r.simulation_error ? ` error=${JSON.stringify(r.simulation_error)}` : ""}${r.model_recording ? ` model=${JSON.stringify(r.model_recording)}` : ""}`);
}
const summary = aggregate(results);
if (args.json) (await import("node:fs")).writeFileSync(args.json, JSON.stringify({ config, summary, results }, null, 1));
if (args.record) { (await import("node:fs")).writeFileSync(args.record, recording.serialize()); console.log(`recorded ${results.length} drives to ${args.record}`); }
// The runner's MessageChannel would keep Node alive; exit once the summary has been written out.
if (replaying) console.log(drifted.length ? `replay: ${drifted.join(", ")} did not play out as recorded` : `replay: all ${results.length} drives played out as recorded`);
const failed = args.check && args.check !== "0" ? [...new Set([...results.filter((r) => !r.pass).map((r) => r.id), ...drifted])] : [];
if (failed.length) console.error(`${failed.length} of ${results.length} routes failed${drifted.length ? " or did not replay as recorded" : ""}: ${failed.join(", ")}`);
process.stdout.write(`${JSON.stringify({ config, summary })}\n`, () => process.exit(failed.length ? 1 : 0));
