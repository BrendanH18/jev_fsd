// Run the production bench suite under Node against a running local server: the same suite builder,
// runner and metrics as /bench, without a browser. Results are for V8; compare them only with other
// V8 runs (see docs/rules-baseline.md).
// PORT=8331 uv run server.py, then:
// node --experimental-default-type=module scripts/bench_node.mjs --map calgary --count 2 [--only s1-1] [--weather dry] [--json out.json]
const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => {
  if (a.startsWith("--")) out.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return out;
}, []));
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

const preset = args.map || "kitsilano";
const map = new MapData(await api(`/api/map?bbox=${encodeURIComponent(preset)}`));
const suite = await buildSuite(map, { count: Number(args.count || 12), seed: Number(args.seed || 1) });
const only = args.only ? String(args.only).split(",") : null;
const results = [];
for (const sc of suite) {
  if (only && !only.includes(sc.id)) continue;
  const r = await runScenario(map, sc, { brain: args.brain || "rules", npcs: Number(args.npcs || 40), mode: "lockstep", weather: args.weather || "dry" });
  results.push(r);
  const fail = r.events.filter((e) => e.type === "collision").map((e) => `${e.with}:${e.kind}@${e.t}`).join(" ");
  console.log(`${r.id} ${r.pass ? "PASS" : "FAIL"} arrived=${r.arrived} t=${r.time_s} coll=${r.collisions}/${r.at_fault} off=${r.off_road_s} dl=${r.deadlocks} safety=${r.safety_brakes} lc=${r.lane_changes ?? "-"} ${fail}`);
}
const summary = aggregate(results);
console.log(JSON.stringify({ map: preset, weather: args.weather || "dry", summary }));
if (args.json) (await import("node:fs")).writeFileSync(args.json, JSON.stringify({ map: preset, summary, results }, null, 1));
process.exit(0);  // the runner's MessageChannel would keep Node alive
