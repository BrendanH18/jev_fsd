// The CI shards (scripts/ci_shard.mjs, .github/workflows/demo.yml): every scripts/test_*.mjs runs in
// exactly one shard, the workflow's matrix lists every shard the plan has, and the run time is spread
// evenly.
// node --experimental-default-type=module scripts/test_ci_shard.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measuredTimes, plan, testFiles } from "./ci_shard.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflow = readFileSync(`${root}.github/workflows/demo.yml`, "utf8");

// the workflow: one matrix of shards 0..N-1, and the step that runs them asks for N shards
const counts = [...workflow.matchAll(/scripts\/ci_shard\.mjs --shards (\d+) --shard \$\{\{ matrix\.shard \}\}/g)].map(
  (m) => Number(m[1]),
);
assert.equal(counts.length, 1, "demo.yml runs scripts/ci_shard.mjs --shards N --shard <the matrix shard> once");
const count = counts[0];
const matrices = [...workflow.matchAll(/^\s+shard: \[([\d, ]+)\]\s*$/gm)].map((m) => m[1].split(",").map(Number));
assert.equal(matrices.length, 1, "demo.yml has one shard matrix");
assert.deepEqual(
  matrices[0],
  Array.from({ length: count }, (_, i) => i),
  `the shard matrix lists 0 to ${count - 1}`,
);

// every file in exactly one shard, for the workflow's count and for others
const files = testFiles(),
  times = measuredTimes();
assert.ok(files.includes("test_ci_shard.mjs") && files.length > 100, "found the Node checks");
for (const n of [1, 2, count, count + 1, 9]) {
  const shards = plan(files, times, n);
  const all = shards.flatMap((s) => s.files);
  assert.equal(all.length, files.length, `${n} shards: each file once`);
  assert.deepEqual([...all].sort(), files, `${n} shards: every file`);
  if (n <= files.length)
    assert.ok(
      shards.every((s) => s.files.length > 0),
      `${n} shards: none empty`,
    );
  // the same answer every time
  assert.deepEqual(
    plan([...files].reverse(), times, n).map((s) => s.files),
    shards.map((s) => s.files),
    `${n} shards: deterministic`,
  );
}

// a file with no measured time still lands in exactly one shard
const extra = plan([...files, "test_zz_new.mjs"], times, count).flatMap((s) => s.files);
assert.equal(extra.filter((f) => f === "test_zz_new.mjs").length, 1, "an unmeasured file is placed once");

// balanced: no shard runs much longer than an even share, unless one file alone takes longer
const shards = plan(files, times, count);
const est = (f) => times[f] ?? 0,
  longest = Math.max(...files.map(est));
const mean = shards.reduce((s, x) => s + x.seconds, 0) / count,
  worst = Math.max(...shards.map((s) => s.seconds));
assert.ok(
  worst <= Math.max(longest, 1.25 * mean),
  `the longest shard (${Math.round(worst)} s) is within 25% of the mean (${Math.round(mean)} s)`,
);

// the command line gives each job the same files
const fromCli = [];
for (let i = 0; i < count; i++) {
  const out = spawnSync(
    process.execPath,
    [`${root}scripts/ci_shard.mjs`, "--shards", String(count), "--shard", String(i)],
    { encoding: "utf8" },
  );
  assert.equal(out.status, 0, out.stderr);
  const listed = out.stdout.trim().split("\n");
  assert.deepEqual(
    listed,
    shards[i].files.map((f) => `scripts/${f}`),
    `shard ${i} from the command line`,
  );
  fromCli.push(...listed);
}
assert.equal(new Set(fromCli).size, files.length, "the command line covers every file once");
const bad = spawnSync(
  process.execPath,
  [`${root}scripts/ci_shard.mjs`, "--shards", String(count), "--shard", String(count)],
  { encoding: "utf8" },
);
assert.notEqual(bad.status, 0, "a shard out of range is an error");

// the measured table: notes only, so a new or removed check never breaks CI
const missing = files.filter((f) => !Number.isFinite(times[f])),
  stale = Object.keys(times).filter((f) => !files.includes(f));
if (missing.length)
  console.log(`note: no measured time in scripts/ci_test_times.json for ${missing.join(", ")} (counted as the median)`);
if (stale.length) console.log(`note: scripts/ci_test_times.json lists files that no longer exist: ${stale.join(", ")}`);

console.log(
  `ci shards: ${files.length} Node checks in ${count} shards, about ${shards.map((s) => Math.round(s.seconds)).join(" / ")} s`,
);
