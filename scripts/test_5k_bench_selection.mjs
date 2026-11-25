import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { routeCoverage, routeRanges, selectBenchRoutes } from "./bench_selection.mjs";

const routes = [
  { id: "a", tags: { length_m: 350, signals: 0, stops: 4, lefts: 1, rights: 2 } },
  { id: "b", tags: { length_m: 800, signals: 1, stops: 2, lefts: 3, rights: 1 } },
  { id: "c", tags: { length_m: 1400, signals: 2, stops: 0, lefts: 0, rights: 0 } },
];
const ids = (rows) => rows.map(({ id }) => id).join(",");
const filter = (options) => ids(selectBenchRoutes(routes, { ranges: routeRanges(options) }));
for (const [tag, min, max, high, low] of [
  ["length", 800, 800, "b,c", "a,b"],
  ["signals", 1, 1, "b,c", "a,b"],
  ["stops", 2, 2, "a,b", "b,c"],
  ["lefts", 1, 1, "a,b", "a,c"],
  ["rights", 1, 1, "a,b", "b,c"],
]) {
  assert.equal(filter({ [`min-${tag}`]: String(min) }), high, tag);
  assert.equal(filter({ [`max-${tag}`]: String(max) }), low, tag);
}
assert.equal(filter({ "min-length": "800", "max-signals": "1", "min-lefts": "3" }), "b");
assert.equal(filter({ "max-rights": "0" }), "c");
assert.throws(() => routeRanges({ "min-signals": "2", "max-signals": "1" }), /cannot exceed/);
assert.throws(() => routeRanges({ "min-length": "1.5" }), /decimal/);
assert.throws(() => routeRanges({ "max-stops": "-1" }), /decimal/);
assert.throws(
  () => selectBenchRoutes([{ id: "a" }, routes[1]], { ranges: routeRanges({ "min-length": "1" }) }),
  /length_m tag/,
);
assert.throws(() => selectBenchRoutes([routes[0], routes[0]]), /duplicate scenario/);
assert.throws(() => selectBenchRoutes(routes, { only: ["a"], skip: ["a"] }), /both --only and --skip/);
assert.throws(() => selectBenchRoutes(routes, { startAt: "unavailable" }), /unavailable.*a, b, c/);
assert.throws(() => selectBenchRoutes(routes, { only: ["a"], startAt: "b" }), /no scenarios/);
assert.equal(ids(selectBenchRoutes(routes, { only: ["c", "a"], skip: ["b"], startAt: "b", limit: 1 })), "c");
assert.equal(
  ids(selectBenchRoutes(routes, { startAt: "a", limit: 1, ranges: routeRanges({ "min-signals": "1" }) })),
  "b",
);
const status = routeCoverage(
  routes,
  [routes[0], routes[1]],
  [{ id: "a", pass: false, failures: ["stuck", "collision", "stuck"] }],
);
assert.equal(status.generated, 3);
assert.equal(status.selected, 2);
assert.equal(status.completed, 1);
assert.equal(status.passed, 0);
assert.equal(status.failed.join(), "a");
assert.equal(status.pending.join(), "b");
assert.equal(status.excluded.join(), "c");
assert.equal(Object.keys(status.failures).join(), "collision,stuck");
assert.equal(status.failures.stuck, 1);
assert.equal(routeCoverage([], [], []).completed, 0);
assert.equal(routeCoverage(routes, routes, [{ id: "a", pass: true }]).passed, 1);

const dir = mkdtempSync(join(tmpdir(), "jev-bench-cli-"));
try {
  const path = join(dir, "sample.json");
  writeFileSync(path, JSON.stringify({ header: { driver: "jev", arena: {} } }));
  const cli = (...args) =>
    spawnSync(
      process.execPath,
      [
        "--experimental-default-type=module",
        fileURLToPath(new URL("bench_node.mjs", import.meta.url)),
        "--port=1",
        ...args,
      ],
      { encoding: "utf8", timeout: 3000 },
    );
  const reject = (match, ...args) => {
    const out = cli(...args);
    assert.equal(out.status, 1, out.stderr);
    assert.match(out.stderr, match);
  };
  reject(/start-at needs/, "--start-at= ");
  reject(/only and --skip overlap/, "--only=a", "--skip=a");
  reject(/heldout sets the seeds/, "--heldout=1", "--seed=1");
  reject(/brain needs/, "--brain= ");
  reject(/--hour must/, "--hour=24");
  reject(/--without contains duplicate/, "--without=geese,geese");
  reject(/positive decimal/, "--reserve=0xFF");
  reject(/not a benchmark recording/, "--replay", path);
  reject(/requires suite generation/, "--require-count", "--trace-from", path, "--trace", join(dir, "trace.json"));
  reject(/unavailable with --trace/, "--checkpoint", join(dir, "checkpoint.json"), "--trace", join(dir, "trace.json"));
  reject(/only plans/, "--list", "--checkpoint", join(dir, "checkpoint.json"));
  reject(/different files/, "--checkpoint", path, "--json", path);
  const help = spawnSync(process.execPath, [fileURLToPath(new URL("bench_node.mjs", import.meta.url)), "--help"], {
    encoding: "utf8",
  });
  assert.match(help.stdout, /--coverage/);
  assert.match(help.stdout, /--require-count/);
  assert.match(help.stdout, /--progress-finish/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("Benchmark route selection, coverage and CLI preflight passed.");
