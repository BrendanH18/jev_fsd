// Run the production bench suite under Node against a running local server: the same suite builder,
// runner and metrics as /bench, without a browser. Results are for V8; compare them only with other
// V8 runs (see docs/rules-baseline.md).
// PORT=8331 uv run server.py, then:
// node --experimental-default-type=module scripts/bench_node.mjs --map calgary --count 2
// Options: --map (a preset id or W,S,E,N), --count, --seed, --npcs, --brain, --weather, --port,
// --only s1-1,s1-2 (run just these scenarios) and --json out.json (write the full results).
const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => {
  if (a.startsWith("--")) out.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return out;
}, []));
const fail = (message) => { console.error(message); process.exit(1); };
// Every option takes a value; one without (parsed as `true`) or a misspelled one would otherwise
// run the defaults.
const OPTIONS = ["map", "count", "seed", "npcs", "brain", "weather", "port", "only", "json"];
for (const [name, value] of Object.entries(args)) {
  if (!OPTIONS.includes(name)) fail(`Unknown option --${name}: use ${OPTIONS.map((o) => `--${o}`).join(", ")}.`);
  if (value === true) fail(`--${name} needs a value.`);
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
const { runScenario } = await import("../static/js/bench/runner.js");
const { aggregate } = await import("../static/js/bench/metrics.js");
const { WEATHER } = await import("../static/js/sim/weather.js");
const { agentDefinitions } = await import("../static/js/brain/registry.js");

// The server falls back to its default map for a name or box it does not recognise, so check
// that the map it returned is the one asked for.
const preset = String(args.map || "kitsilano");
const known = (await api("/api/maps")).maps.find((m) => m.id === preset);
const wanted = known ? known.bbox : preset.split(",").map(Number);
if (wanted.length !== 4 || wanted.some((v) => !Number.isFinite(v))) fail(`Unknown map "${preset}": use a preset id or W,S,E,N.`);
const map = new MapData(await api(`/api/map?bbox=${encodeURIComponent(preset)}`));
if (map.routingBbox.some((v, i) => Math.abs(v - wanted[i]) > 1e-6)) fail(`The server loaded ${map.routingBbox.join(",")} instead of "${preset}".`);
// The world and autopilot also fall back silently (to dry weather, to the previous driver), so an
// unknown weather or driver would run something else under the name asked for.
const brains = agentDefinitions().map((d) => d.id);
if (!brains.includes(String(args.brain || "rules"))) fail(`Unknown brain "${args.brain}": use one of ${brains.join(", ")}.`);
if (!Object.hasOwn(WEATHER, String(args.weather || "dry"))) fail(`Unknown weather "${args.weather}": use one of ${Object.keys(WEATHER).join(", ")}.`);
const integer = (name, fallback, min) => {
  const v = args[name] === undefined ? fallback : Number(args[name]);
  if (!Number.isSafeInteger(v) || v < min) fail(`--${name} must be a whole number of at least ${min}, not "${args[name]}".`);
  return v;
};
const config = { brain: String(args.brain || "rules"), count: integer("count", 12, 1), seed: integer("seed", 1, 0), npcs: integer("npcs", 40, 0),
  mode: "lockstep", weather: String(args.weather || "dry"), map: preset, bbox: map.routingBbox, pack: map.pack.pack_version, engine: `node ${process.version}` };
const suite = await buildSuite(map, { count: config.count, seed: config.seed });
if (!suite.length) fail(`No routable scenarios on "${preset}".`);
const only = args.only ? String(args.only).split(",") : null;
const missing = (only || []).filter((id) => !suite.some((sc) => sc.id === id));
if (missing.length) fail(`No scenario ${missing.join(", ")} in this suite (${suite.map((sc) => sc.id).join(", ")}).`);
const results = [];
for (const sc of suite) {
  if (only && !only.includes(sc.id)) continue;
  const r = await runScenario(map, sc, { brain: config.brain, npcs: config.npcs, mode: config.mode, weather: config.weather });
  results.push(r);
  const hits = r.events.filter((e) => e.type === "collision").map((e) => `${e.with}:${e.kind}@${e.t}`).join(" ");
  console.log(`${r.id} ${r.pass ? "PASS" : "FAIL"} arrived=${r.arrived} t=${r.time_s} coll=${r.collisions}/${r.at_fault} off=${r.off_road_s} dl=${r.deadlocks} safety=${r.safety_brakes} lc=${r.lane_changes ?? "-"} ${hits}`);
}
const summary = aggregate(results);
if (args.json) (await import("node:fs")).writeFileSync(args.json, JSON.stringify({ config, summary, results }, null, 1));
// The runner's MessageChannel would keep Node alive; exit once the summary has been written out.
process.stdout.write(`${JSON.stringify({ config, summary })}\n`, () => process.exit(0));
