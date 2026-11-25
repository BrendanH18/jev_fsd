import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { costs, plan } from "./ci_shard.mjs";

const planner = fileURLToPath(new URL("./ci_shard.mjs", import.meta.url));
const root = fs.mkdtempSync(join(tmpdir(), "jev-shards-"));
const times = join(root, "times.json");
const write = (data) => fs.writeFileSync(times, JSON.stringify(data));
const run = (status, ...args) => {
  const r = spawnSync(process.execPath, [planner, "--directory", root, "--times", times, ...args], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(r.status, status, r.error?.message ?? r.stdout + r.stderr);
  return r;
};

try {
  for (const name of ["test_a.mjs", "test_b name.mjs", "test_z.mjs", "test_bad\nname.mjs"])
    fs.writeFileSync(join(root, name), "");
  fs.mkdirSync(join(root, "test_directory.mjs"));
  fs.symlinkSync(join(root, "test_directory.mjs"), join(root, "test_linkdir.mjs"));
  fs.symlinkSync(join(root, "absent"), join(root, "test_dangling.mjs"));
  fs.symlinkSync(join(root, "test_a.mjs"), join(root, "test_alias.mjs"));
  write({ seconds: { "test_a.mjs": 2, "test_z.mjs": 6, "test_old.mjs": 4 } });
  const fixture = ["--shards", "6"];
  const audit = JSON.parse(run(0, ...fixture, "--audit", "--json").stdout);
  assert.equal(audit.files, 4);
  assert.equal(audit.measured, 2);
  assert.equal(audit.missing.join("|"), "test_alias.mjs|test_b name.mjs");
  assert.equal(audit.stale.join("|"), "test_old.mjs");
  assert.equal(audit.empty_shards.join("|"), "4|5");
  assert.equal(audit.fallback_seconds, 6);
  assert.equal(audit.total_seconds, 20);
  assert.equal(audit.mean_seconds, 20 / 6);
  assert.equal(audit.slowest_shard, 0);
  assert.equal(audit.slowest_seconds, 6);
  assert.match(run(0, ...fixture, "--audit").stdout, /Empty shards: 4, 5/);
  assert.match(run(2, ...fixture, "--plan", "--require-current").stderr, /Stale measured times: test_old/);
  assert.match(run(2, ...fixture, "--plan", "--require-nonempty").stderr, /Empty shards: 4, 5/);
  assert.match(run(2, ...fixture, "--plan", "--max-seconds", "5").stderr, /exceeding 5 s/);
  assert.equal(JSON.parse(run(0, ...fixture, "--matrix").stdout).shard.join(","), "0,1,2,3,4,5");
  assert.equal(JSON.parse(run(0, ...fixture, "--file", "scripts/test_z.mjs", "--json").stdout).file, "test_z.mjs");
  assert.equal(run(0, ...fixture, "--shard", "0").stdout.trim(), join(root, "test_alias.mjs"));
  assert.equal(
    JSON.parse(run(0, "--shards", "1", "--plan", "--dispatch-order", "--json").stdout)[0].files.at(-1),
    "test_a.mjs",
  );
  assert.equal(JSON.parse(run(0, ...fixture, "--audit", "--fallback", "0", "--json").stdout).total_seconds, 8);
  assert.match(run(2, ...fixture, "--audit", "--fallback", "-1").stderr, /decimal whole number/);
  write({ seconds: { "sub/test_a.mjs": 2 } });
  assert.match(run(2, ...fixture, "--audit").stderr, /invalid check name/);
  const observed = join(root, "report.json");
  const fromRun = ["--from-run", observed];
  write({ seconds: { "test_a.mjs": 2, "test_z.mjs": 6 } });
  const sample = { file: "scripts/test_a.mjs", ok: true, seconds: 4.25 };
  const samples = (checks) => fs.writeFileSync(observed, JSON.stringify({ checks }));
  samples([
    sample,
    { file: "scripts/test_z.mjs", ok: false, seconds: 17 },
    { file: "scripts/test_unrelated.mjs", ok: true, seconds: 9 },
    { file: "scripts/test_alias.mjs", ok: true, seconds: 0 },
  ]);
  const refreshed = JSON.parse(run(0, ...fixture, ...fromRun, "--timings").stdout).seconds;
  assert.equal(refreshed["test_a.mjs"], 4.25);
  assert.equal(refreshed["test_alias.mjs"], 0);
  assert.equal(refreshed["test_z.mjs"], 6);
  assert.equal(Object.hasOwn(refreshed, "test_unrelated.mjs"), false);
  samples([sample, sample]);
  assert.match(run(2, ...fixture, ...fromRun, "--timings").stderr, /more than one passing result/);
  samples([{ ...sample, seconds: -1 }]);
  assert.match(run(2, ...fixture, ...fromRun, "--timings").stderr, /invalid passed duration/);
  samples([{ file: "broken" }]);
  assert.match(run(2, ...fixture, ...fromRun, "--timings").stderr, /missing its file or pass status/);
  write(null);
  assert.match(run(2, ...fixture, "--audit").stderr, /expected a seconds object/);
  assert.throws(() => plan(["a", "a"], {}, 1), /only once/);
  assert.throws(() => plan([], {}, 0), /whole number/);
  assert.throws(() => plan(["a", "b"], { a: 1e308, b: 1e308 }, 1), /overflowed on shard/);
  assert.equal(costs(["a"], Object.create({ a: 3 }))("a"), 1);
  assert.equal(costs(["a"], { a: -1 })("a"), 1);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
