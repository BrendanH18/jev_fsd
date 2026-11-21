// The parallel runner scripts/boat-check.sh --full uses (scripts/node_checks.mjs): every file runs,
// a failing or timed-out file fails the run and has its output printed, and a passing run exits 0.
// node --experimental-default-type=module scripts/test_node_checks.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("node_checks.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "node-checks-"));
const write = (name, body) => {
  fs.writeFileSync(path.join(dir, name), body);
  return path.join(dir, name);
};
const pass = [1, 2, 3].map((i) => write(`test_pass_${i}.mjs`, `console.log("quiet ${i}");\n`));
const fail = write("test_fail.mjs", 'console.error("the reason it failed");\nprocess.exit(3);\n');
const hang = write("test_hang.mjs", 'setInterval(() => {}, 1000);\nprocess.on("SIGTERM", () => process.exit(1));\n');
const run = (...args) => {
  const r = spawnSync(process.execPath, [runner, ...args], { encoding: "utf8", timeout: 60_000 });
  return { status: r.status, out: r.stdout + r.stderr };
};

try {
  const ok = run("--jobs", "2", ...pass);
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /3 of 3 passed/);
  assert.equal(ok.out.includes("quiet"), false, "a passing file's output is not printed");
  for (const f of pass) assert.match(ok.out, new RegExp(`ok .*${path.basename(f)}`));

  const bad = run("--jobs", "3", "--timeout", "2", ...pass, fail, hang);
  assert.equal(bad.status, 1, bad.out);
  assert.match(bad.out, /3 of 5 passed/);
  assert.match(bad.out, /FAIL .*test_fail\.mjs: failed with exit code 3/);
  assert.match(bad.out, /the reason it failed/, "a failing file's output is printed");
  assert.match(bad.out, /FAIL .*test_hang\.mjs: timed out after 2 s/);
  assert.match(bad.out, /failed:\n {2}\S*test_fail\.mjs: .*\n {2}\S*test_hang\.mjs: /);

  // two files with one name in different folders are two checks
  fs.mkdirSync(path.join(dir, "a"));
  fs.mkdirSync(path.join(dir, "b"));
  const same = [write("a/test_same.mjs", "process.exit(4);\n"), write("b/test_same.mjs", "")];
  const twins = run(...same);
  assert.equal(twins.status, 1, twins.out);
  assert.match(twins.out, /1 of 2 passed/);
  assert.match(twins.out, /FAIL .*a\/test_same\.mjs: failed with exit code 4/);

  assert.equal(run("--jobs", "0").status, 2, "a bad option is refused");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log("node checks runner checks passed");
