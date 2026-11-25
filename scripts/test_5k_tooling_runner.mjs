import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./cli_tools.mjs";

const runner = fileURLToPath(new URL("./node_checks.mjs", import.meta.url));
const root = fs.mkdtempSync(join(tmpdir(), "jev-runner-"));
const make = (name, text) => {
  const file = join(root, name);
  fs.writeFileSync(file, text);
  return file;
};
const run = (...args) => spawnSync(process.execPath, [runner, ...args], { encoding: "utf8", timeout: 5000 });
const expect = (status, ...args) => {
  const result = run(...args);
  assert.equal(result.status, status, result.error?.message ?? result.stdout + result.stderr);
  return result;
};
const pass = make("test_pass.mjs", 'console.log("ordinary output");');
const fail = make("test_fail.mjs", 'console.log("::notice::raw child command"); process.exitCode = 4;');
const wait = make("test_wait.mjs", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);');
const linger = make(
  "test_linger.mjs",
  'import { spawn } from "node:child_process"; spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" }).unref();',
);
const spam = make(
  "test_spam.mjs",
  'process.stdout.write("X".repeat(128 * 1024)); setTimeout(() => { process.stdout.write("tail"); process.exitCode = 3; }, 50);',
);

try {
  assert.match(expect(0, "--help").stdout, /--kill-grace/);
  assert.match(expect(2, "--jobs", "1", "--jobs", "2").stderr, /only once/);
  assert.match(expect(2, "-x").stderr, /unknown option/);
  assert.match(expect(2, "--node-arg", pass).stderr, /must be a Node flag/);
  assert.match(expect(2, "--node-arg=--eval=process.exit()").stderr, /changes how Node runs/);
  assert.match(expect(2, "--include-skipped").stderr, /requires --rerun/);
  assert.match(expect(2, "--rerun", "unused", pass).stderr, /explicit check files/);
  assert.match(expect(2, "--json", "-", "--github").stderr, /JSON on stdout/);
  assert.match(expect(2, "--output-kib", "16385").stderr, /16384/);
  assert.match(expect(2, "--order", "random").stderr, /measured, name or input/);
  assert.match(expect(2, "--list", "--summary", "unused").stderr, /cannot be combined/);

  const timing = make("timing.json", JSON.stringify({ seconds: { [basename(pass)]: 1, [basename(fail)]: 3 } }));
  assert.equal(expect(0, "--list", "--times", timing, pass, fail).stdout.trim().split("\n")[0], fail);
  assert.equal(expect(0, "--list", "--order", "input", pass, fail).stdout.trim().split("\n")[0], pass);
  assert.equal(expect(0, "--list", "--order", "name", pass, fail).stdout.trim().split("\n")[0], fail);

  const gzip = join(root, "report.json.gz");
  const markdown = join(root, "summary.md");
  const first = expect(
    1,
    "--order",
    "input",
    "--jobs",
    "1",
    "--fail-fast",
    "--github",
    "--summary",
    markdown,
    "--json",
    gzip,
    fail,
    pass,
  );
  assert.match(first.stdout, /::error file=.*test_fail\.mjs::/);
  assert.match(first.stdout, /: :notice: :raw child command/);
  assert.doesNotMatch(first.stdout, /::notice::/);
  assert.match(fs.readFileSync(markdown, "utf8"), /0 passed, 1 failed, 1 skipped/);
  const report = readJson(gzip);
  assert.equal(report.checks[0].output.trim(), "::notice::raw child command");
  assert.equal(report.checks[0].path, fail);
  assert.equal(report.skipped_paths[0], pass);
  assert.equal(report.workers, 1);
  assert.equal(report.timeout_s, 360);
  assert.equal(report.busy_s > 0 && report.wall_s >= report.busy_s, true);
  assert.equal(report.lowest_free_bytes > 0, true);
  assert.equal(expect(0, "--list", "--rerun", gzip).stdout.trim(), fail);
  assert.equal(expect(0, "--list", "--rerun", gzip, "--include-skipped").stdout.trim().split("\n").length, 2);
  assert.match(expect(2, "--rerun", gzip, "--json", gzip).stderr, /different files/);
  assert.match(expect(2, "--json", markdown, "--summary", markdown, pass).stderr, /different files/);
  assert.match(
    expect(2, "--rerun", make("invalid.json", '{"checks":[{"file":"a","path":3,"ok":false}]}')).stderr,
    /expected a Node check report/,
  );
  assert.match(expect(2, "--rerun", make("empty.json", '{"checks":[],"skipped":[]}')).stderr, /no checks to rerun/);

  const refused = spawnSync(process.execPath, [runner, pass], {
    env: { ...process.env, NODE_TEST_TIMEOUT: "invalid" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /timeout must be a decimal whole number/);
  const flagged = make(
    "test_flag.mjs",
    'process.exitCode = process.execArgv.includes("--no-warnings") && process.execArgv.includes("--trace-warnings") ? 0 : 2;',
  );
  expect(0, "--node-arg=--no-warnings", "--node-arg", "--trace-warnings", flagged);
  const selfKilled = make("test_signalled.mjs", 'process.kill(process.pid, "SIGTERM");');
  assert.match(expect(1, selfKilled).stdout, /ended by SIGTERM/);
  assert.equal(expect(0, "--json=-", "--jobs", "999", pass).stdout.includes('"workers":1'), true);
  assert.match(expect(2, "--list", root).stderr, /No such check file/);
  assert.equal(expect(0, "--list", "--match", "pass", "--exclude", "fail", fail, pass).stdout.trim(), pass);
  const old = make("old.json", JSON.stringify({ checks: [{ file: fail, ok: false }], skipped: [pass] }));
  assert.equal(expect(0, "--list", "--rerun", old).stdout.trim(), fail);
  assert.match(expect(2, "--match", "pass", "--json", fail, pass, fail).stderr, /different files/);
  assert.match(expect(2, "--times", timing, "--json", timing, pass).stderr, /different files/);
  const multi = JSON.parse(expect(1, "--json=-", "--jobs=1", "--order=input", pass, fail).stdout);
  assert.equal(multi.checks.map(({ file }) => file).join("|"), `${fail}|${pass}`);
  const quiet = expect(0, "--json=-", "--quiet", "--slowest=0", "--show-output", pass);
  assert.equal(JSON.parse(quiet.stdout).checks[0].output.trim(), "ordinary output");
  assert.doesNotMatch(quiet.stderr, /slowest|^ok {2}/m);
  const clipped = JSON.parse(expect(1, "--json=-", "--output-kib", "1", spam).stdout).checks[0];
  assert.equal(Buffer.byteLength(clipped.output), 1024);
  assert.equal(clipped.output.endsWith("tail"), true);
  assert.equal(clipped.truncated, true);
  const discarded = JSON.parse(expect(1, "--json=-", "--output-kib", "0", fail).stdout).checks[0];
  assert.equal(discarded.output, "");
  assert.equal(discarded.truncated, true);
  const hang = JSON.parse(expect(1, "--timeout", "1", "--kill-grace", "0", "--json=-", wait).stdout).checks[0];
  assert.equal(hang.timed_out, true);
  assert.equal(hang.signal, "SIGKILL");
  assert.equal(JSON.parse(expect(0, "--timeout", "1", "--json=-", linger).stdout).checks[0].timed_out, false);

  const alias = join(root, "runner.mjs");
  fs.symlinkSync(runner, alias);
  assert.match(spawnSync(process.execPath, [alias, "--help"], { encoding: "utf8", timeout: 5000 }).stdout, /Usage:/);
  if (process.platform !== "win32") {
    const marker = join(root, "started");
    const cancellable = make(
      "test_cancel.mjs",
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "ready"); setInterval(() => {}, 1000);`,
    );
    let output = "";
    const child = spawn(process.execPath, [runner, "--jobs=1", "--order=input", "--json=-", cancellable, pass], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    const finished = new Promise((resolve) => child.once("close", resolve));
    try {
      for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(fs.existsSync(marker), true);
      child.kill("SIGTERM");
      assert.equal(await finished, 143);
      const interrupted = JSON.parse(output);
      assert.equal(interrupted.checks[0].interrupted, true);
      assert.equal(interrupted.skipped[0], pass);
    } finally {
      child.kill("SIGKILL");
    }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
