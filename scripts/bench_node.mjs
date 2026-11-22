// Run the production bench suite under Node against a running local server: the same suite builder,
// runner and metrics as /bench, without a browser. Results are for V8; compare them only with other
// V8 runs (see docs/rules-baseline.md).
// PORT=8331 uv run server.py, then:
// node --experimental-default-type=module scripts/bench_node.mjs --map calgary --count 2
// Options: --map (a preset id or W,S,E,N), --count, --seed, --npcs, --brain, --weather, --port,
// --features (bare, the default, with every opt-in feature off; or city, the free drive's: bench/runner.js),
// --track open (the open track: road-rule checks flag manoeuvres instead of removing them, brain/tracks.js),
// --park 1, --hour 23.5 (both presets), --without geese,ice (city), --cover 0 (city pairwise row),
// --diagnostics 1 (incident positions and actors), --only s1-1,s1-2 (run just these scenarios), --json out.json (write the full results) and --check 1
// (exit with status 1 if any route fails, as CI does).
// --prompt-audit out.json with --record or --replay reports request sizes without storing prompts.
// --trace out.json samples one tuned Rules drive; --trace-from reuses a capture's scenario.
// --reserve 0.5 stops a recording between drives when the server's remaining budget is less than $0.50.
// --heldout 1 runs the map's held-out routes (bench/heldout.js; never debug against them,
// docs/rules-baseline.md) instead of --seed/--count, and reports them as a held-out suite.
// Each drive's line ends with its score, and a `scores` line before the summary gives the driver's
// progress, pace, comfort, margin and time lost (bench/scores.js); neither is saved in the results.
// Model recordings (static/js/brain/recording.js, docs/agents.md; a name ending .gz is gzipped): --record out.json keeps every answer a
// model driver (--brain jev, decision:<name> or llm:<name>) gets, keyed by its request, with each drive's
// result; --replay rec.json drives again from those answers with no model call and no key, taking the
// driver, map and suite from the recording, and reports whether each drive played out as recorded
// (--check 1 also checks verdicts; --check replay checks replay fidelity alone).
import { CUSTOM_SUITE, replaySuiteVersion, setRecordingSuiteVersion } from "../static/js/bench/suite-version.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((out, a, i, all) => {
    if (a.startsWith("--")) out.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return out;
  }, []),
);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
// Every option takes a value; one without (parsed as `true`) or a misspelled one would otherwise
// run the defaults.
const OPTIONS = [
  "map",
  "count",
  "seed",
  "npcs",
  "brain",
  "weather",
  "features",
  "port",
  "only",
  "json",
  "check",
  "park",
  "hour",
  "without",
  "cover",
  "diagnostics",
  "prompt-audit",
  "trace",
  "trace-from",
  "reserve",
  "record",
  "replay",
  "heldout",
  "track",
];
for (const [name, value] of Object.entries(args)) {
  if (!OPTIONS.includes(name)) fail(`Unknown option --${name}: use ${OPTIONS.map((o) => `--${o}`).join(", ")}.`);
  if (value === true) fail(`--${name} needs a value.`);
}
if (args.record && args.replay) fail("Use --record or --replay, not both.");
if (args["trace-from"] && !args.trace) fail("--trace-from needs --trace.");
if (
  args.trace &&
  ((args.brain || "rules") !== "rules" || args.heldout === "1" || args.record || args.replay || args.json)
)
  fail("--trace needs a tuned Rules drive and writes its own JSON. Drop --record, --replay and --json.");
const reserve = args.reserve === undefined ? null : Number(args.reserve);
if (reserve !== null && (!args.record || !Number.isFinite(reserve) || reserve <= 0))
  fail("--reserve needs --record and a positive number of dollars.");
const auditPath = args["prompt-audit"];
const audit = auditPath ? await import("./prompt_audit.mjs") : null;
if (audit) {
  if (!args.record && !args.replay) fail("--prompt-audit needs --record or --replay.");
  audit.checkAuditPath(auditPath, [args.record, args.replay, args.json], fail);
}
if (args.check === "replay" && !args.replay) fail("--check replay requires --replay.");
// A replay takes its driver, map and suite from the recording.
const SUITE_OPTIONS = [
  "map",
  "count",
  "seed",
  "npcs",
  "brain",
  "weather",
  "features",
  "park",
  "hour",
  "without",
  "cover",
  "heldout",
  "track",
];
// (read here, checked once the modules load: they need the page's token first)
let replayJson = null;
if (args.replay) {
  // (a recording may be gzipped: name it .json.gz)
  try {
    const raw = (await import("node:fs")).readFileSync(args.replay);
    replayJson = JSON.parse(
      args.replay.endsWith(".gz") ? (await import("node:zlib")).gunzipSync(raw).toString("utf8") : raw.toString("utf8"),
    );
  } catch (error) {
    fail(`Cannot read the recording ${args.replay}: ${error.message}`);
  }
  if (typeof replayJson?.header?.driver !== "string") fail(`${args.replay} is not a model recording.`);
  const given = SUITE_OPTIONS.filter((name) => args[name] !== undefined);
  if (given.length)
    fail(`The recording sets the driver and suite: drop ${given.map((name) => `--${name}`).join(", ")}.`);
  const b = replayJson.header.bench || {};
  Object.assign(args, {
    map: b.map,
    count: String(b.count),
    seed: String(b.seed),
    npcs: String(b.npcs),
    brain: replayJson.header.driver,
    weather: b.weather,
    features: b.features || "bare",
    ...(b.park ? { park: "1" } : {}),
    ...(b.hour !== undefined ? { hour: String(b.hour) } : {}),
    ...(b.without?.length ? { without: b.without.join(",") } : {}),
    ...(b.cover !== undefined ? { cover: String(b.cover) } : {}),
    ...(b.heldout ? { heldout: "1" } : {}),
    ...(b.track ? { track: b.track } : {}),
  });
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
const { driveScores, driverScores } = await import("../static/js/bench/scores.js");
const { HELDOUT_SEEDS, heldoutPlan, buildHeldoutSuite } = await import("../static/js/bench/heldout.js");
const { WEATHER } = await import("../static/js/sim/weather.js");
const { agentDefinitions } = await import("../static/js/brain/registry.js");
const recordingModule = await import("../static/js/brain/recording.js");
const { benchSuiteVersion } = await import("./canonical_suite.mjs");
const manifestModule = await import("./run_manifest.mjs");
let replaying = null;
if (replayJson)
  try {
    replaying = recordingModule.ModelRecording.parse(replayJson);
  } catch (error) {
    fail(`Cannot replay ${args.replay}: ${error.message}`);
  }

// The server falls back to its default map for a name or box it does not recognise, so check
// that the map it returned is the one asked for.
const maps = (await api("/api/maps")).maps;
// (a recording made on /bench names its map by the pack's cache key: replay it by its box)
const replayBbox = replayJson?.header?.bench?.bbox;
const preset = String(
  !maps.some((m) => m.id === args.map) && replayBbox ? replayBbox.join(",") : args.map || "kitsilano",
);
const known = maps.find((m) => m.id === preset);
const wanted = known ? known.bbox : preset.split(",").map(Number);
if (wanted.length !== 4 || wanted.some((v) => !Number.isFinite(v)))
  fail(`Unknown map "${preset}": use a preset id or W,S,E,N.`);
const map = new MapData(await api(`/api/map?bbox=${encodeURIComponent(preset)}`));
if (map.routingBbox.some((v, i) => Math.abs(v - wanted[i]) > 1e-6))
  fail(`The server loaded ${map.routingBbox.join(",")} instead of "${preset}".`);
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
if (!replaying && !brains.includes(String(args.brain || "rules")))
  fail(`Unknown brain "${args.brain}": use one of ${brains.join(", ")}.`);
if (!FEATURE_PRESETS.includes(String(args.features || "bare")))
  fail(`Unknown features "${args.features}": use one of ${FEATURE_PRESETS.join(", ")}.`);
if (!Object.hasOwn(WEATHER, String(args.weather || "dry")))
  fail(`Unknown weather "${args.weather}": use one of ${Object.keys(WEATHER).join(", ")}.`);
const integer = (name, fallback, min) => {
  // Plain digits only: Number() also reads " " as 0 and accepts forms such as 1e2 or 0x10.
  const v = args[name] === undefined ? fallback : /^\d+$/.test(args[name]) ? Number(args[name]) : NaN;
  if (!Number.isSafeInteger(v) || v < min)
    fail(`--${name} must be a whole number of at least ${min}, not "${args[name]}".`);
  return v;
};
for (const name of ["park", "diagnostics", "heldout"])
  if (args[name] !== undefined && !["0", "1"].includes(args[name])) fail(`--${name} must be 0 or 1.`);
if (args.hour !== undefined && !/^\d+(?:\.\d+)?$/.test(args.hour))
  fail("--hour must be a number from 0 inclusive to 24 exclusive.");
let options;
try {
  options = benchmarkConfig({
    features: args.features || "bare",
    park: args.park === "1",
    ...(args.hour !== undefined ? { hour: Number(args.hour) } : {}),
    without: args.without || [],
    ...(args.cover !== undefined ? { cover: integer("cover", 0, 0) } : {}),
    ...(args.track !== undefined ? { track: String(args.track) } : {}),
  });
} catch (error) {
  fail(error.message);
}
const heldout = args.heldout === "1";
if (heldout && !replaying && (args.seed !== undefined || args.count !== undefined))
  fail("--heldout sets the seeds and routes: drop --seed and --count.");
// (a held-out run records its seeds; `seed` and `count` are the first seed and the number of routes)
const plan = heldout ? heldoutPlan(preset) : null;
const config = {
  brain: String(args.brain || "rules"),
  count: plan ? plan.seeds.length * plan.count : integer("count", 12, 1),
  seed: plan ? plan.seeds[0] : integer("seed", 1, 0),
  npcs: integer("npcs", 40, 0),
  mode: "lockstep",
  weather: String(args.weather || "dry"),
  ...options,
  ...(plan ? { heldout: true, seeds: plan.seeds } : {}),
  map: preset,
  bbox: map.routingBbox,
  pack: map.pack.pack_version,
  engine: args.trace && process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`,
};
if (args.trace && HELDOUT_SEEDS.includes(config.seed)) fail("--trace cannot use a held-out seed.");
const features = config.features || "bare";
const driver = config.brain;
if (args.record && !recordingModule.driverKind(driver))
  fail(`--record needs a model driver (jev, decision:<name> or llm:<name>), not "${driver}".`);
let recording = replaying;
if (replaying)
  try {
    recordingModule.checkMap(replaying, map);
  } catch (error) {
    fail(error.message);
  }
// (a replay drives the recorded scenarios, so a router changed since cannot move them)
const mapSha = recordingModule.mapFingerprint(map);
const traceModule = args.trace ? await import("./bench_trace.mjs") : null;
let suite;
if (args["trace-from"]) {
  try {
    suite = [traceModule.readTraceScenario(args["trace-from"], args.trace, config, mapSha)];
  } catch (error) {
    fail(error.message);
  }
} else {
  suite =
    replaying?.suite() ||
    (heldout
      ? await buildHeldoutSuite(map, preset, suiteOptions(features, options))
      : await buildSuite(map, { count: config.count, seed: config.seed, ...suiteOptions(features, options) }));
}
if (!suite.length) fail(`No routable scenarios on "${preset}".`);
const only = args.only ? String(args.only).split(",") : null;
const missing = (only || []).filter((id) => !suite.some((sc) => sc.id === id));
if (missing.length) fail(`No scenario ${missing.join(", ")} in this suite (${suite.map((sc) => sc.id).join(", ")}).`);
const selected = only ? suite.filter((sc) => only.includes(sc.id)) : suite;
if (args.trace && selected.length !== 1) fail("--trace needs exactly one scenario; select it with --only.");
const suiteMetadata = {
  kind: "bench",
  config,
  ids: selected.map((sc) => sc.id),
  generated_ids: suite.map((sc) => sc.id),
  route_sha: manifestModule.benchRouteFingerprint(suite),
  ...(only ? { only: true } : {}),
};
const trace = traceModule?.captureTrace(config, mapSha, selected[0]);
let manifest = null;
if (!replaying && (args.json || args.record)) {
  const definition = agentDefinitions().find((d) => d.id === driver);
  const endpoint = definition?.llm || definition?.decision;
  const model = driver === "jev" ? (status || (await api("/api/status"))).decision?.jev?.model : endpoint?.model;
  manifest = manifestModule.runManifest({
    driver,
    model,
    track: config.track || "guarded",
    suite: suiteMetadata,
    maps: { [preset]: map },
    fingerprints: { [preset]: mapSha },
  });
  if (args.record)
    recording = new recordingModule.ModelRecording({
      header: recordingModule.recordingHeader({
        driver,
        brain: { endpoint },
        model,
        map: preset,
        map_sha: manifest.maps[preset].fingerprint,
        seed: config.seed,
        preset: features,
        weather: config.weather,
        bench: config,
        manifest,
        suite_version: CUSTOM_SUITE,
      }),
    });
}
const results = [],
  drifted = [];
const promptSizes = {};
let budgetStop = null;
const completedVersion = () =>
  !only && !budgetStop && !trace ? benchSuiteVersion({ ...suiteMetadata, map_sha: mapSha }, results) : CUSTOM_SUITE;
// (written beside the destination and renamed over it, so a run killed while saving keeps the last save)
const saveRecording = async () => {
  const fs = await import("node:fs"),
    { dirname, join } = await import("node:path"),
    text = recording.serialize();
  const directory = fs.mkdtempSync(join(dirname(args.record), ".bench-recording-"));
  const tmp = join(directory, "recording");
  try {
    fs.writeFileSync(
      tmp,
      args.record.endsWith(".gz") ? (await import("node:zlib")).gzipSync(text, { level: 9 }) : text,
    );
    fs.renameSync(tmp, args.record);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
for (const sc of selected) {
  if (reserve !== null) {
    const { budget_usd: budget, spent_usd: spent } = (await api("/api/status")).spend || {};
    // A zero budget disables the spend limit. Refuse to start a reserved run without a limit.
    if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(spent))
      fail("--reserve needs a finite server spend limit.");
    const remaining = budget - spent;
    if (remaining < reserve) {
      budgetStop = `stopped before ${sc.id}: $${remaining.toFixed(2)} of the budget left`;
      console.error(budgetStop);
      break;
    }
  }
  const prompt = audit?.promptAudit();
  const tape = recording
    ? recording.tape(sc.id, args.record ? "record" : "replay", { onRequest: prompt?.observe })
    : null;
  const r = await runScenario(map, sc, {
    brain: config.brain,
    npcs: config.npcs,
    mode: config.mode,
    weather: config.weather,
    ...options,
    diagnostics: args.diagnostics === "1",
    tape,
    onStep: trace?.sample,
  });
  if (trace) {
    if (r.simulation_error) fail(`Cannot capture a complete trace: ${r.simulation_error}`);
    trace.write(args.trace, r);
  }
  // (saved after every drive, so a run stopped part way keeps the drives it finished)
  results.push(r);
  if (args.record) {
    recording.keepResult(sc.id, r, sc);
    manifest.cost_usd = manifestModule.runCost(Object.values(recording.results));
    setRecordingSuiteVersion(recording, completedVersion());
    await saveRecording();
  }
  // (a replay matches when every call was answered from the recording and the drive's result is the
  // recorded one, timings aside)
  if (replaying) {
    const recorded = replaying.results[sc.id];
    r.model_recording.same_result = recorded ? recordingModule.sameResult(r, recorded) : null;
    // (a drive the recording has no result for cannot be checked: drift too)
    if (r.model_recording.same_result !== true || !r.model_recording.exact) drifted.push(r.id);
  }
  if (prompt) {
    audit.checkAuditPath(auditPath, [args.record, args.replay, args.json], fail);
    promptSizes[sc.id] = prompt.result();
    (await import("node:fs")).writeFileSync(auditPath, `${JSON.stringify(promptSizes, null, 2)}\n`);
  }
  const hits = r.events
    .filter((e) => e.type === "collision")
    .map((e) => `${e.with}:${e.kind}@${e.t}`)
    .join(" ");
  console.log(
    `${r.id} ${r.pass ? "PASS" : "FAIL"} arrived=${r.arrived} t=${r.time_s} coll=${r.collisions}/${r.at_fault} off=${r.off_road_s} dl=${r.deadlocks} safety=${r.safety_brakes} lc=${r.lane_changes ?? "-"} ${hits}${r.pass ? "" : ` failures=${r.failures.join(",")}`}${r.simulation_error ? ` error=${JSON.stringify(r.simulation_error)}` : ""}${r.model_recording ? ` model=${JSON.stringify(r.model_recording)}` : ""} score=${driveScores(r).score}`,
  );
}
const summary = aggregate(results);
const replayProvenance = replaying?.header.manifest;
const replayDate = replaying?.header.recorded_at;
const replayManifest =
  replaying &&
  !only &&
  !drifted.length &&
  results.length === Object.keys(replaying.results).length &&
  replayProvenance?.source_dirty === false &&
  replayProvenance.engine === config.engine &&
  replayProvenance.engine_version === process.versions.v8 &&
  replayProvenance.cost_usd === summary.cost_usd &&
  replayProvenance.suite?.kind === "bench" &&
  recordingModule.canonicalJson(replayProvenance.suite.config) === recordingModule.canonicalJson(config) &&
  recordingModule.canonicalJson(replayProvenance.suite.ids) === recordingModule.canonicalJson(suiteMetadata.ids) &&
  Number.isFinite(Date.parse(replayDate))
    ? replayProvenance
    : null;
const suite_version = replaying ? replaySuiteVersion(replaying.header, replayManifest !== null) : completedVersion();
for (const result of results) result.suite_version = suite_version;
// (computed for display only: bench/scores.js)
console.log(`${heldout ? "held-out " : ""}scores ${JSON.stringify(driverScores(results))}`);
if (heldout)
  console.log(
    `held-out suite (seeds ${config.seeds.join(", ")}): ${results.filter((r) => r.pass).length}/${results.length} passed; report apart from the tuned suites and never debug against it (docs/rules-baseline.md)`,
  );
if (args.json) {
  audit?.checkAuditPath(auditPath, [args.record, args.replay, args.json], fail);
  const saved = { suite_version, config, summary, results, ...(budgetStop ? { stopped: budgetStop } : {}) };
  if (manifest) {
    manifest.suite_version = suite_version;
    manifest.cost_usd = summary.cost_usd;
  }
  const reportManifest = manifest || replayManifest;
  if (reportManifest) {
    const savedAt = replayManifest ? new Date(replayDate).toISOString() : new Date().toISOString();
    const name = manifestModule.benchRunName(savedAt, driver);
    Object.assign(saved, { name, saved_at: savedAt, manifest: reportManifest });
  }
  (await import("node:fs")).writeFileSync(args.json, JSON.stringify(saved, null, 1));
}
if (args.record && results.length) console.log(`recorded ${results.length} drives to ${args.record}`);
// The runner's MessageChannel would keep Node alive; exit once the summary has been written out.
if (replaying)
  console.log(
    drifted.length
      ? `replay: ${drifted.join(", ")} did not play out as recorded`
      : `replay: all ${results.length} drives played out as recorded`,
  );
const failed =
  args.check && args.check !== "0" && args.check !== "replay"
    ? [...new Set([...results.filter((r) => !r.pass).map((r) => r.id), ...drifted])]
    : [];
if (failed.length)
  console.error(
    `${failed.length} of ${results.length} routes failed${drifted.length ? " or did not replay as recorded" : ""}: ${failed.join(", ")}`,
  );
const failedReplay = args.check === "replay" && drifted.length > 0;
process.stdout.write(`${JSON.stringify({ suite_version, config, summary })}\n`, () =>
  process.exit(failed.length || failedReplay || budgetStop ? 1 : 0),
);
