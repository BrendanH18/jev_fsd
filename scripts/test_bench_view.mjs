import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  benchmarkDownloadName,
  comparisonIssue,
  routeMatches,
  validateRunInputs,
} from "../static/js/bench/view-options.js";
import { heldoutPlan, HELDOUT_DEFAULT } from "../static/js/bench/heldout.js";

const config = {
  map: "kitsilano",
  brain: "rules",
  bbox: [1, 2, 3, 4],
  pack: "6",
  weather: "dry",
  count: 12,
  npcs: 40,
  seed: 1,
  mode: "lockstep",
};
const tags = { length_m: 900, signals: 2, stops: 1, lefts: 1, rights: 0 };
const run = {
  config,
  suite_version: "custom",
  results: [
    { id: "s1-1", tags },
    { id: "s1-2", tags: { ...tags, length_m: 800 } },
  ],
};
assert.equal(comparisonIssue(run, { ...run, config: { ...config, brain: "cautious" } }), null);
for (const [change, expected] of [
  [{ bbox: [0, 2, 3, 4] }, "map"],
  [{ pack: "7" }, "map pack"],
  [{ npcs: 0 }, "traffic"],
  [{ mode: "realtime" }, "clock mode"],
  [{ weather: "rain" }, "weather"],
  [{ features: "city" }, "world"],
  [{ track: "open" }, "track"],
  [{ park: true }, "parking"],
  [{ heldout: true }, "held-out policy"],
  [{ seed: 2 }, "suite seed"],
  [{ count: 2 }, "route count"],
  [{ hour: 9 }, "hour"],
  [{ without: ["ice"] }, "feature exclusions"],
])
  assert.ok(comparisonIssue(run, { ...run, config: { ...config, ...change } }).includes(expected));
assert.match(comparisonIssue(run, { ...run, results: [{ id: "s1-1" }] }), /completed routes/);
assert.equal(comparisonIssue(run, { ...run, results: run.results.toReversed() }), null);
const changedRoute = { id: "s1-1", tags: { ...tags, lefts: 2 } };
assert.match(comparisonIssue(run, { ...run, results: [changedRoute, run.results[1]] }), /route tags/);
const missingTags = { ...run, results: [{ id: "s1-1" }, run.results[1]] };
assert.match(comparisonIssue(run, missingTags), /route identity unavailable/);
const fingerprinted = { ...missingTags, manifest: { suite: { route_sha: "abcdef" } } };
assert.equal(comparisonIssue(fingerprinted, fingerprinted), null);
assert.match(
  comparisonIssue(fingerprinted, { ...run, manifest: { suite: { route_sha: "123456" } } }),
  /route fingerprints/,
);
const subset = (sha, results = run.results) => ({
  ...run,
  results,
  manifest: { suite: { route_sha: sha, only: true } },
});
assert.equal(comparisonIssue(subset("abcdef"), subset("123456")), null);
assert.match(comparisonIssue(subset("abcdef"), subset("123456", [changedRoute, run.results[1]])), /route tags/);
assert.match(comparisonIssue({ ...run, stopped: true }, { ...run, stopped: true }), /stopped before its suite/);
assert.match(
  comparisonIssue(run, { ...run, config: { ...config, completed: run.results.length, count: run.results.length + 1 } }),
  /stopped before its suite/,
);
assert.equal(comparisonIssue(run, { ...run, config: { ...config, completed: config.count } }), null);
assert.match(comparisonIssue(run, { ...run, suite_version: "v1" }), /suite v1/);
assert.equal(heldoutPlan("constructor"), HELDOUT_DEFAULT);
assert.doesNotThrow(() => validateRunInputs(config, ["dry"]));
for (const [change, expected] of [
  [{ count: 0 }, /Scenarios/],
  [{ npcs: NaN }, /Traffic/],
  [{ seed: -1 }, /Suite seed/],
  [{ mode: "typo" }, /clock/],
  [{ weather: "typo" }, /weather/],
])
  assert.throws(() => validateRunInputs({ ...config, ...change }, ["dry"]), expected);
assert.doesNotThrow(() => validateRunInputs({ ...config, heldout: true, count: NaN, seed: NaN }, ["dry"]));
assert.doesNotThrow(() => validateRunInputs({ ...config, count: 61, npcs: 121 }, ["dry"]));
assert.ok(routeMatches(" S1-2 red ", { id: "s1-2" }, { failures: ["red light"] }));
assert.ok(routeMatches("overlap", { id: "s1-2" }, { simulation_error: "overlap failure" }));
assert.ok(!routeMatches("s1-1", { id: "s1-2" }, {}));
assert.equal(
  benchmarkDownloadName({ ...config, brain: "llm:one", heldout: true }, "csv"),
  "jev-benchmark-kitsilano-llm-one-bare-dry-heldout.csv",
);

const storage = new Map();
let capacity = Infinity;
globalThis.localStorage = {
  getItem: (key) => storage.get(key),
  setItem(key, value) {
    if (JSON.parse(value).length > capacity) throw new DOMException("Storage full", "QuotaExceededError");
    storage.set(key, value);
  },
};
const originalDate = Date.now;
const savedRun = { config, summary: { pass_rate: 1 }, results: [{ id: "s1-2" }] };
const { demoApi } = await import("../static/js/demo/api.js");
try {
  Date.now = () => 1234;
  await assert.rejects(demoApi("/api/bench/save", { ...savedRun, config: [] }), /requires a config/);
  await assert.rejects(demoApi("/api/bench/save", { ...savedRun, results: [null] }), /agree on suite_version/);
  const first = await demoApi("/api/bench/save", savedRun);
  const second = await demoApi("/api/bench/save", savedRun);
  assert.notEqual(first.name, second.name);
  assert.equal(first.saved, first.name);
  const { runs } = await demoApi("/api/bench/runs?summary=1");
  assert.equal(runs[0].saved_at, new Date(1234).toISOString());
  assert.equal(runs[0].results, undefined);
  assert.equal((await demoApi(`/api/bench/runs?name=${second.name}`)).results.length, 1);
  const key = "jev-demo-runs";
  const recorded = JSON.parse(storage.get(key));
  storage.set(key, JSON.stringify([null, { name: "broken" }, ...recorded, ...recorded]));
  assert.equal((await demoApi("/api/bench/runs")).runs.length, 2);
  storage.set(key, "{}");
  assert.equal((await demoApi("/api/bench/runs")).runs.length, 0);
  storage.set(key, JSON.stringify(recorded));
  capacity = 2;
  const third = await demoApi("/api/bench/save", savedRun);
  assert.deepEqual(
    (await demoApi("/api/bench/runs")).runs.map((r) => r.name),
    [third.name, second.name],
  );
  capacity = 0;
  const snapshot = storage.get(key);
  await assert.rejects(demoApi("/api/bench/save", savedRun), /exceeds available demo storage/);
  assert.equal(storage.get(key), snapshot);
} finally {
  Date.now = originalDate;
}

let requests = 0;
globalThis.fetch = async () => {
  requests++;
  if (requests === 1) return new Response("unavailable", { status: 503 });
  if (requests === 2) return new Response("malformed");
  return Response.json([{ id: "kitsilano", bbox: config.bbox }]);
};
await assert.rejects(demoApi("/api/not-shipped"), /needs the local app/);
assert.equal(requests, 0);
await assert.rejects(demoApi("/api/maps"), /catalog\.json.*503/);
await assert.rejects(demoApi("/api/maps"), /read.*catalog\.json/);
assert.equal((await demoApi("/api/maps")).maps.length, 1);

const page = readFileSync(new URL("../static/bench.html", import.meta.url), "utf8");
const source = readFileSync(new URL("../static/js/bench/main.js", import.meta.url), "utf8");
for (const id of ["bench-search", "bench-save", "bench-diagnostics", "cover"])
  assert.ok(page.includes(`id="${id}"`) && source.includes(`$("#${id}")`));
assert.match(page, /value="cautious"/);
assert.match(page, /id="status"[^>]*role="status"/);
assert.match(page, /id="run"[^>]*disabled/);
assert.match(source, /A benchmark is already running/);
assert.match(source, /results\.length === suite\.length/);
assert.match(source, /state\.stopped \? "skipped"/);
assert.match(source, /Could not prepare the scenario to watch/);
assert.match(source, /const r = await runScenario[\s\S]*?if \(stopRequested\) break;[\s\S]*?state\.results\.push/);
assert.match(source, /save: \$\("#bench-save"\)\.checked/);
assert.match(source, /diagnostics: \$\("#bench-diagnostics"\)\.checked/);
assert.match(source, /cover:.*valueAsNumber/);
assert.match(source, /"id", "pass", "failures", "simulation_error"/);
assert.match(source, /\["flagged_choices", "flagged choices"/);
assert.match(source, /loadRuns.*[\s\S]*?bench\/runs\?summary=1/);
console.log("Benchmark view options and demo run history passed.");

// Exercise the page controller with real scenario planning and a small DOM substitute.
class Element {
  children = [];
  attrs = {};
  handlers = {};
  value = "";
  textContent = "";
  disabled = false;

  get options() {
    return this.children;
  }
  setAttribute(name, value) {
    this.attrs[name] = value;
  }
  addEventListener(name, handler) {
    this.handlers[name] = handler;
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  cloneNode() {
    return Object.assign(new Element(), { ...this });
  }
  querySelector() {
    return null;
  }
}

const controls = new Map();
const element = (selector) => {
  if (!controls.has(selector)) controls.set(selector, new Element());
  return controls.get(selector);
};
globalThis.Node = Element;
globalThis.document = {
  querySelector: (selector) => (selector.startsWith("meta") ? null : element(selector)),
  createElement: () => new Element(),
  createTextNode: (textContent) => Object.assign(new Element(), { textContent }),
};
element("#brain").querySelector = () => new Element();
element("#features").value = "bare";
globalThis.window = {};
globalThis.location = { search: "" };
const mapDir = new URL("../data/maps/", import.meta.url);
const mapHash = "623b012bc8b5";
const pack = JSON.parse(readFileSync(new URL(`${mapHash}.v6.pack.json`, mapDir), "utf8"));
for (const file of readdirSync(mapDir).sort()) {
  const [, layer] = file.split(".");
  if (file.startsWith(`${mapHash}.`) && file.endsWith(".json") && layer !== "pack")
    pack[layer] = JSON.parse(readFileSync(new URL(file, mapDir), "utf8"));
}
pack.utc_offset = -7;
pack.routing_bbox = [-123.17, 49.26, -123.15, 49.27];
const { MapData } = await import("../static/js/map/mapdata.js");
const { browserRoute } = await import("../static/js/demo/routing.js");
const map = new MapData(pack);
let saves = 0;
let released;
globalThis.fetch = async (path, options) => {
  if (path === "/api/status")
    return Response.json({ npcs: 40, map: { id: "kitsilano", name: "kitsilano", label: "Kitsilano" } });
  if (path === "/api/map") return Response.json(pack);
  if (path === "/api/maps") return Response.json({ maps: [{ id: "kitsilano", name: "Kitsilano", city: "Vancouver" }] });
  if (path === "/api/bench/runs?summary=1") return Response.json({ runs: [] });
  if (path === "/api/bench/save") {
    saves++;
    return Response.json({ saved: "test" });
  }
  if (path === "/api/route") {
    if (released) await released;
    const body = JSON.parse(options.body);
    const route = browserRoute(map, body.from, body.to, body);
    return Response.json({ routes: route ? [route] : [] });
  }
  throw new Error(`Unexpected request ${path}`);
};
element("#run").disabled = true;
await import("../static/js/bench/main.js");
for (let frame = 0; element("#run").disabled && frame < 50; frame++) await new Promise(setImmediate);
assert.equal(element("#run").disabled, false);
element("#count").valueAsNumber = 61;
element("#npcs").valueAsNumber = 121;
element("#seed").valueAsNumber = 1;
element("#mode").value = "lockstep";
element("#weather").value = "dry";
element("#run").handlers.click();
await new Promise(setImmediate);
assert.match(element("#status").textContent, /Scenarios must be a whole number from 1 to 60/);
element("#count").valueAsNumber = 1;
element("#run").handlers.click();
await new Promise(setImmediate);
assert.match(element("#status").textContent, /Traffic must be a whole number from 0 to 120/);

const replay = {
  format: "jev-model-recording/1",
  header: { driver: "jev", bench: { count: 61, npcs: 121, seed: 1, weather: "dry" } },
  scenarios: { "s1-1": run.results[0] },
};
const replayPending = window.__bench.run({ replay, save: false });
assert.equal(window.__bench.stop(), true);
const replayed = await replayPending;
assert.equal(replayed.config.count, 61);
assert.equal(replayed.config.npcs, 121);
assert.equal(replayed.stopped, true);

await assert.rejects(window.__bench.run({ brain: "not-installed" }), /unavailable/);
assert.equal(element("#run").textContent, "Run");
let release;
released = new Promise((resolve) => {
  release = resolve;
});
const pending = window.__bench.run({ count: 1, npcs: 0 });
assert.equal(element("#bench-map").disabled, true);
await assert.rejects(window.__bench.run(), /already running/);
assert.equal(window.__bench.stop(), true);
release();
const stopped = await pending;
assert.equal(stopped.stopped, true);
assert.equal(stopped.results.length, 0);
assert.equal(element("#bench-map").disabled, false);
assert.equal(element("#run").disabled, false);
assert.equal(saves, 0);
const completed = await window.__bench.run({
  brain: "cautious",
  count: 1,
  npcs: 0,
  track: "open",
  diagnostics: true,
  save: false,
});
assert.equal(completed.results.length, 1);
assert.ok(completed.results[0].diagnostics.final);
assert.ok(Number.isFinite(completed.results[0].flagged_choices));
assert.equal(saves, 0);
const filter = element("#bench-search");
filter.value = "no-such-route";
filter.handlers.input();
assert.equal(element("#bench-csv").disabled, true);
filter.value = completed.results[0].id;
filter.handlers.input();
assert.equal(element("#bench-csv").disabled, false);
console.log("Benchmark page controller completed, stopped and filtered a fixture route.");
process.exit(0);
