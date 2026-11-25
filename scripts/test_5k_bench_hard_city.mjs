import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkHardConditions, hardCityMarkdown, hardCityReport, hardCityTasks } from "./hard_city_report.mjs";
import { readJson, writeArtifact } from "./cli_tools.mjs";
import { retrySoakPlan, soakCoverage, soakPlan } from "./soak.mjs";

function evidence(task) {
  return {
    id: task.id,
    config: {
      brain: "rules",
      mode: "lockstep",
      map: task.map,
      count: task.count,
      seed: task.seed,
      npcs: task.npcs,
      features: "city",
      weather: task.weather,
      ...(task.options.hour !== 15.5 ? { hour: task.options.hour } : {}),
      ...(task.options.park ? { park: true } : {}),
    },
    manifest: {
      maps: { [task.map]: { fingerprint: task.map_sha } },
      suite: { kind: "bench", route_sha: task.route_sha, ids: task.only },
    },
    results: task.only.map((id) => ({
      id,
      pass: true,
      arrived: true,
      failures: [],
      time_s: 35,
      min_ttc_s: 4,
      safety_brakes: 2,
      ...(task.options.park ? { parked: null, no_space: true } : {}),
    })),
  };
}
const tasks = hardCityTasks(0, 1);
const shard = (index, total) => ({
  schema: 1,
  slice: "hard-city-v1",
  shard: index,
  shards: total,
  runs: hardCityTasks(index, total).map(evidence),
});
const whole = shard(0, 1);
const complete = hardCityReport([shard(1, 2), shard(0, 2)]);
assert.equal(complete.shards_received.join(), "0,1");
assert.equal(complete.shards_expected, 2);
assert.equal(complete.legs.map((leg) => leg.id).join(), tasks.map((task) => task.id).join());
assert.equal(complete.complete, true);
assert.equal(complete.passed, true);
assert.equal(complete.counts.pass, 5);
assert.equal(complete.legs.at(-1).routes[0].parked, null);
assert.equal(complete.legs.at(-1).routes[0].no_space, true);
assert.equal(complete.legs[0].routes[0].min_ttc_s, 4);
assert.equal(complete.legs[0].routes[0].safety_brakes, 2);
assert.equal(complete.legs[0].routes[0].time_s, 35);
assert.ok(Number.isFinite(complete.legs[0].routes[0].score));
assert.match(hardCityMarkdown(complete), /no parking space/);
assert.match(hardCityMarkdown(complete), /5\/5 legs passed/);
const damaged = shard(0, 1);
const [first, second, third] = damaged.runs.splice(0, 3);
damaged.runs.push({ id: first.id, harness_error: "<failure>|\ncontinued" });
damaged.skipped = [second.id];
Object.assign(third.results[0], { pass: false, failures: ["red light"] });
damaged.runs.push(third);
damaged.runs.pop();
Object.assign(damaged.runs[0].results[0], { pass: false, failures: ["red light"] });
const incomplete = hardCityReport([damaged]);
assert.equal(incomplete.counts.error, 1);
assert.equal(incomplete.counts.skipped, 1);
assert.equal(incomplete.counts.missing, 1);
assert.equal(incomplete.counts.fail, 1);
assert.equal(incomplete.complete, false);
assert.equal(incomplete.passed, false);
assert.match(hardCityMarkdown(incomplete), /&lt;failure&gt;&#124; continued/);
assert.match(hardCityMarkdown(incomplete), /red light/);
assert.equal(hardCityReport([shard(5, 6)]).counts.missing, 5);

for (const [change, error] of [
  [
    (r) => {
      r.schema = 2;
    },
    /not a hard-city-v1/,
  ],
  [
    (r) => {
      r.slice = "other";
    },
    /not a hard-city-v1/,
  ],
  [
    (r) => {
      r.shard = -1;
    },
    /invalid shard/,
  ],
  [
    (r) => {
      r.shards = 0;
    },
    /invalid shard/,
  ],
  [
    (r) => {
      r.runs = {};
    },
    /needs runs/,
  ],
  [
    (r) => {
      r.skipped = "x";
    },
    /skipped array/,
  ],
  [
    (r) => {
      r.runs[0].id = "other";
    },
    /out-of-shard/,
  ],
  [
    (r) => {
      r.runs.push(r.runs[0]);
    },
    /repeats leg/,
  ],
  [
    (r) => {
      r.skipped = [r.runs[0].id];
    },
    /repeats leg/,
  ],
  [
    (r) => {
      r.runs[0].harness_error = "error";
    },
    /invalid harness error/,
  ],
  [
    (r) => {
      delete r.runs[0].results;
    },
    /missing results/,
  ],
  [
    (r) => {
      r.runs[0].results[0].pass = "true";
    },
    /malformed verdict/,
  ],
  [
    (r) => {
      r.runs[0].results[0].failures = [1];
    },
    /malformed verdict/,
  ],
  [
    (r) => {
      r.runs[0].results[0].arrived = false;
    },
    /inconsistent verdict/,
  ],
  [
    (r) => {
      r.runs[0].results[0].id = "s1-99";
    },
    /fixed route IDs/,
  ],
  [
    (r) => {
      r.runs[0].manifest.maps.kitsilano.fingerprint = "wrong";
    },
    /map fingerprint/,
  ],
  [
    (r) => {
      r.runs[0].manifest.suite.route_sha = "wrong";
    },
    /route fingerprint/,
  ],
  [
    (r) => {
      r.runs[0].manifest.suite.kind = "arena";
    },
    /manifest does not identify/,
  ],
  [
    (r) => {
      r.runs[0].manifest.suite.ids = [];
    },
    /manifest does not identify/,
  ],
  [
    (r) => {
      r.runs[0].stopped = true;
    },
    /stopped early/,
  ],
]) {
  const report = shard(0, 1);
  change(report);
  assert.throws(() => hardCityReport([report]), error);
}
assert.throws(() => hardCityReport([shard(0, 2), shard(1, 3)]), /different total/);
assert.throws(() => hardCityReport([shard(0, 2), shard(0, 2)]), /repeats shard/);
for (const [key, value] of [
  ["brain", "cautious"],
  ["mode", "realtime"],
  ["map", "ottawa"],
  ["weather", "rain"],
  ["seed", 2],
  ["count", 8],
  ["npcs", 3],
  ["features", "bare"],
  ["hour", 8],
  ["park", true],
  ["track", "open"],
  ["cover", 0],
  ["heldout", true],
  ["stopped", true],
  ["without", ["ice"]],
]) {
  const run = evidence(tasks[0]);
  run.config[key] = value;
  assert.throws(() => checkHardConditions(tasks[0], run));
}

const plan = soakPlan({ mode: "city", maps: ["kitsilano"], seeds: [1, 2, 3] });
const [a, b, c] = plan;
const policy = { audit_policy: "strict", require_count: true };
const coverage = soakCoverage(plan, [
  { id: a.id, status: "passed" },
  { id: b.id, status: "error" },
]);
const previous = { schema: 1, shard: 0, shards: 1, ...policy, coverage, runs: [{ id: a.id }] };
const retried = retrySoakPlan(plan, previous, 0, 1, policy);
assert.equal(retried.eligible.map(({ id }) => id).join(), [b.id, c.id].join());
assert.equal(retried.passed[0].id, a.id);
assert.equal(coverage.counts.error, 1);
assert.equal(coverage.counts.pending, 1);
assert.throws(() => retrySoakPlan(plan, previous, 0, 2, policy), /different soak shard/);
assert.throws(() => retrySoakPlan(plan, previous, 0, 1, { ...policy, require_count: false }), /route-count policy/);
assert.throws(() => retrySoakPlan(plan, { ...previous, coverage: null }, 0, 1, policy), /full shard plan/);
assert.throws(() => retrySoakPlan(plan, { ...previous, runs: [] }, 0, 1, policy), /one passed run/);
assert.throws(() => retrySoakPlan([{ ...a, count: 7 }, b, c], previous, 0, 1, policy), /conditions differ/);
assert.throws(() => soakPlan({ heldout: "true" }), /heldout must be true/);
assert.throws(() => soakPlan({ maps: ["kitsilano", "kitsilano"] }), /unique/);
assert.throws(() => soakPlan({ seeds: [1, 1] }), /unique/);
assert.throws(() => soakPlan({ seeds: "1" }), /nonnegative integers/);

const dir = mkdtempSync(join(tmpdir(), "jev-hard-city-"));
try {
  const path = join(dir, "soak.json.gz"),
    output = join(dir, "report.json.gz");
  writeArtifact(path, JSON.stringify(whole), { gzip: true });
  const cli = (...args) =>
    spawnSync(process.execPath, [fileURLToPath(new URL("hard_city_report.mjs", import.meta.url)), ...args], {
      encoding: "utf8",
      timeout: 3000,
    });
  const good = cli("--check", "--output", output, path);
  assert.equal(good.status, 0, good.stderr);
  assert.equal(readJson(output).passed, true);
  assert.equal(cli("--format", "invalid", path).status, 1);
  assert.match(cli("--output", path, path).stderr, /different files/);
  writeArtifact(path, JSON.stringify(damaged), { gzip: true });
  const bad = cli("--check", path);
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).passed, false);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("Hard-city coverage, provenance, reporting, and soak retries passed.");
