import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ModelRecording } from "../static/js/brain/recording.js";
import { benchRouteFingerprint } from "./run_manifest.mjs";
import { readArtifactJson } from "./recording_artifacts.mjs";

const dir = mkdtempSync(join(tmpdir(), "jev-tape-merge-"));
const run = (script, ...args) =>
  spawnSync(
    process.execPath,
    ["--experimental-default-type=module", fileURLToPath(new URL(script, import.meta.url)), ...args],
    { encoding: "utf8", timeout: 5000 },
  );
const save = (name, value) => {
  const path = join(dir, name);
  const text = JSON.stringify(value);
  writeFileSync(path, name.endsWith(".gz") ? gzipSync(text) : text);
  return path;
};
const expect = (result, pattern) => {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, pattern);
};
const output = join(dir, "arena.json.gz");
const merge = (...parts) => run("merge_recordings.mjs", "--out", output, ...parts);

const commit = "a".repeat(40);
const manifest = { source_commit: commit, source_dirty: false, suite: { kind: "arena", set: "all" } };
const makeArena = (id, { track, date, model = "test" } = {}) =>
  new ModelRecording({
    header: {
      driver: "jev",
      kind: "jev",
      model,
      engine: "node v22",
      recorded_at: date ?? "2026-11-21T10:00:00Z",
      maps: { kitsilano: "map" },
      arena: { ids: [id], set: "all", ...(track ? { track } : {}) },
      manifest: {
        ...manifest,
        suite: { ...manifest.suite, drives: { [id]: { map: "kitsilano", seed: 1, weather: "dry", time: "day" } } },
        maps: { kitsilano: { fingerprint: "map" } },
        cost_usd: 0.01,
      },
    },
    results: {
      [id]: {
        challenge: id,
        map: "kitsilano",
        seed: 1,
        weather: "dry",
        time: "day",
        pass: true,
        failures: [],
        cost_usd: 0.01,
      },
    },
    drives: { [id]: { key: [{ response: { meta: { model } } }] } },
  }).toJSON();

const scenarios = [
  { id: "s1-1", traffic_seed: 1 },
  { id: "s1-2", traffic_seed: 2 },
];
const config = { map: "kitsilano", seed: 1, count: 2, brain: "jev" };
const benchOutput = join(dir, "bench.json");
const benchTape = `${benchOutput}.gz`;
const common = (part, saved_at) => ({
  config,
  results: [{ id: part.id, pass: true, cost_usd: 0.01 }],
  saved_at,
  manifest: {
    source_commit: commit,
    source_dirty: false,
    cost_usd: 0.01,
    maps: { kitsilano: { fingerprint: "map" } },
    suite: {
      kind: "bench",
      config,
      only: true,
      route_sha: benchRouteFingerprint(scenarios),
      ids: [part.id],
      generated_ids: scenarios.map(({ id }) => id),
    },
  },
});
function saveBench(partIndex, name, mutate = () => {}) {
  const part = scenarios[partIndex];
  const report = structuredClone(common(part, partIndex ? "2026-11-21T09:00:00-02:00" : "2026-11-21T10:00:00Z"));
  const tape = new ModelRecording({
    header: {
      driver: "jev",
      bench: report.config,
      manifest: report.manifest,
      map_sha: "map",
      recorded_at: report.saved_at,
    },
    drives: { [part.id]: {} },
    results: { [part.id]: structuredClone(report.results[0]) },
    scenarios: { [part.id]: part },
  }).toJSON();
  mutate(report, tape);
  save(`${name}.json.gz`, tape);
  return save(`${name}.json`, report);
}
const mergeBench = (...args) =>
  run("merge_bench_recordings.mjs", "--json", benchOutput, "--record", benchTape, ...args);

try {
  const a = save("a.json.gz", makeArena("a", { track: "guarded" }));
  const b = save("b.json", makeArena("b", { date: "2026-11-21T11:00:00+02:00" }));
  const dry = merge("--dry-run", a, b);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).ids.join(","), "a,b");
  assert.equal(JSON.parse(dry.stdout).cost_usd, 0.02);
  assert.equal(existsSync(output), false);
  const result = merge(a, b);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readArtifactJson(output).header.recorded_at, "2026-11-21T11:00:00+02:00");
  assert.equal(readArtifactJson(output).header.maps.kitsilano, "map");
  assert.equal(readArtifactJson(output).drives.b.key[0].response.meta.model, "test");

  const other = join(dir, "hard-link.json");
  linkSync(a, other);
  expect(merge(a, other), /List each input recording once/);
  const symlink = join(dir, "output-link.json");
  symlinkSync(join(dir, "unused"), symlink);
  expect(run("merge_recordings.mjs", `--out=${symlink}`, a, b), /symbolic link/);
  expect(merge("--out", benchOutput, a, b), /only once/);
  expect(merge(a), /at least two/);
  expect(run("merge_recordings.mjs", "--out", join(dir, "bad.ext"), a, b), /must end in/);
  assert.match(run("merge_recordings.mjs", "--help").stdout, /Usage:/);

  for (const [mutate, pattern] of [
    [
      (r) => {
        r.header.arena.set = "bad";
      },
      /unknown Arena set/,
    ],
    [
      (r) => {
        r.header.arena.track = "bad";
      },
      /unknown Arena track/,
    ],
    [
      (r) => {
        r.header.arena.ids.push("c");
      },
      /distinct Arena drive IDs/,
    ],
    [
      (r) => {
        r.header.maps.kitsilano = [];
      },
      /valid Arena map fingerprints/,
    ],
    [
      (r) => {
        r.header.recorded_at = "yesterday";
      },
      /valid recorded_at/,
    ],
    [
      (r) => {
        r.scenarios.c = {};
      },
      /seeded scenarios/,
    ],
    [
      (r) => {
        r.header.manifest.suite.kind = "bench";
      },
      /invalid Arena manifest suite/,
    ],
    [
      (r) => {
        r.header.manifest.cost_usd = 99;
      },
      /manifest cost/,
    ],
    [
      (r) => {
        r.results.c.pass = "true";
      },
      /boolean verdict/,
    ],
    [
      (r) => {
        r.results.c.simulation_error = "failure";
      },
      /simulation error on c/,
    ],
    [
      (r) => {
        r.results.c.map = "unrecorded";
      },
      /no map fingerprint/,
    ],
    [
      (r) => {
        r.results.c.track = "open";
      },
      /different track/,
    ],
    [
      (r) => {
        r.results.c.weather = "snow";
      },
      /authored drive/,
    ],
    [
      (r) => {
        r.results.c.time = "night";
      },
      /authored drive/,
    ],
  ]) {
    const altered = makeArena("c");
    mutate(altered);
    expect(merge(a, save("altered.json", altered)), pattern);
  }

  const one = saveBench(0, "part-one");
  const two = saveBench(1, "part-two");
  const benchPlan = mergeBench("--dry-run", two, one);
  assert.equal(benchPlan.status, 0, benchPlan.stderr);
  assert.equal(JSON.parse(benchPlan.stdout).ids.join(","), "s1-1,s1-2");
  assert.equal(existsSync(benchOutput), false);
  assert.equal(existsSync(benchTape), false);
  expect(mergeBench(one, one), /need different files/);
  expect(mergeBench(one, two, "--json", benchOutput), /only once/);
  assert.match(run("merge_bench_recordings.mjs", "-h").stdout, /Usage:/);
  const badSuite = save("bad-suite.json", [null]);
  expect(mergeBench(one, two, "--suite", badSuite), /scenario array with drive IDs/);
  const duplicateScenario = save("repeat-scenarios.json", [scenarios[0], scenarios[0]]);
  expect(mergeBench(one, two, "--suite", duplicateScenario), /generated drive list/);
  for (const [mutate, pattern] of [
    [
      (r) => {
        r.saved_at = "";
      },
      /invalid saved_at/,
    ],
    [
      (r) => {
        r.config.seed = 1.5;
      },
      /finished seeded --only/,
    ],
    [
      (r) => {
        r.results[0].simulation_error = "error";
      },
      /finished seeded --only/,
    ],
    [
      (r) => {
        r.results[0].pass = 1;
      },
      /boolean verdict/,
    ],
    [
      (_r, t) => {
        t.header.arena = { set: "all" };
      },
      /Arena recording cannot be merged/,
    ],
    [
      (_r, t) => {
        t.header.driver = "llm:changed";
      },
      /driver differs from the report/,
    ],
    [
      (_r, t) => {
        t.header.recorded_at = false;
      },
      /invalid recorded_at/,
    ],
    [
      (r) => {
        r.results[0].cost_usd = -1;
      },
      /finite nonnegative/,
    ],
    [
      (r) => {
        r.manifest.suite.route_sha = "different";
      },
      /part-bad\.json: a part generated/,
    ],
  ]) {
    const bad = saveBench(1, "part-bad", mutate);
    expect(mergeBench(one, bad), pattern);
  }
  const combined = mergeBench(one, two);
  assert.equal(combined.status, 0, combined.stderr);
  assert.equal(readArtifactJson(benchOutput).saved_at, "2026-11-21T09:00:00-02:00");
  assert.equal(readArtifactJson(benchTape).header.recorded_at, "2026-11-21T10:00:00Z");
  assert.equal(readArtifactJson(benchOutput).results[0].id, "s1-1");
  expect(mergeBench(one, two), /must be new/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("Arena and benchmark merge preflight, ordering and preservation passed.");
