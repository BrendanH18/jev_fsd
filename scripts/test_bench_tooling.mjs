import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { compareTraces } from "./bench_trace.mjs";
import { plan, testFiles } from "./ci_shard.mjs";
import { benchPage, checkFiles, parseOptions, readJson, wholeNumber, writeArtifact } from "./cli_tools.mjs";
import { classifyResults, soakVerdict } from "./soak.mjs";

const exec = promisify(execFile);
const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "jev-bench-tooling-"));
const write = (name, data) => {
  const file = join(dir, name);
  writeFileSync(file, data);
  return file;
};
const run = (name, ...args) => {
  const r = spawnSync(process.execPath, ["--experimental-default-type=module", script(name), ...args], {
    encoding: "utf8",
    timeout: 12_000,
  });
  if (r.error) throw r.error;
  return r;
};
function json(r) {
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
function rejects(r, pattern) {
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, pattern);
}

try {
  assert.throws(() => parseOptions(["--map=one", "--map=two"], ["map"]), /only once/);
  for (const invalid of [" ", "1\n", "1e2", "1.1", "0x10", "-2", "9007199254740992"])
    assert.throws(() => wholeNumber("jobs", invalid), /decimal whole number/);
  const tape = write("tape.json", "{}");
  const alias = join(dir, "alias.json");
  linkSync(tape, alias);
  assert.throws(() => checkFiles({ replay: tape }, { json: alias }), /different files/);
  const symlink = join(dir, "symlink.json");
  symlinkSync(tape, symlink);
  assert.throws(() => checkFiles({ replay: tape }, { json: symlink }), /different files/);
  const directoryAlias = join(dir, "nested");
  symlinkSync(dir, directoryAlias);
  assert.throws(
    () => checkFiles({}, { record: join(dir, "new.gz"), json: join(directoryAlias, "new.gz") }),
    /different files/,
  );
  mkdirSync(join(dir, "a"));
  mkdirSync(join(dir, "b", "sub"), { recursive: true });
  symlinkSync(join(dir, "b", "sub"), join(dir, "a", "link"));
  const tapeThroughLink = `${dir}/a/link/../tape.json`;
  const actualTape = write("b/tape.json", "{}");
  write("a/tape.json", "different tape");
  rejects(run("bench_node.mjs", "--replay", tapeThroughLink, "--json", actualTape), /different files/);
  const outputThroughLink = `${dir}/a/link/../new.json`;
  writeArtifact(outputThroughLink, '{"ok":true}');
  assert.equal(readJson(join(dir, "b", "new.json")).ok, true);
  assert.throws(() => readFileSync(join(dir, "a", "new.json")), { code: "ENOENT" });
  const dangling = join(dir, "dangling.json");
  symlinkSync(join(dir, "nowhere"), dangling);
  assert.throws(() => checkFiles({}, { json: dangling }), /dangling/);
  assert.throws(() => checkFiles({}, { json: dir }), /must name a file/);
  const gz = join(dir, "sample.json.gz");
  writeArtifact(gz, '{"state":1}', { gzip: true });
  writeArtifact(gz, '{"state":2}', { gzip: true });
  assert.equal(readJson(gz).state, 2);
  assert.equal(gunzipSync(readFileSync(gz)).toString(), '{"state":2}');
  const corrupt = write("corrupt.json.gz", "broken");
  assert.throws(() => readJson(corrupt), /corrupt\.json\.gz/);

  for (const name of ["arena_node.mjs", "bench_node.mjs"]) {
    rejects(run(name, "--check=typo", "--port=1"), /--check must be one of/);
    rejects(run(name, "--only=a,,b", "--port=1"), /empty item/);
    rejects(run(name, "--only=a,a", "--port=1"), /duplicate items/);
    rejects(run(name, "--replay", tape, "--json", alias), /different files/);
    rejects(run(name, "--limit=0", "--port=1"), /--limit/);
  }
  rejects(run("bench_node.mjs", "--count=1e2", "--port=1"), /--count/);
  rejects(run("bench_node.mjs", "--list", "--json", join(dir, "out.json")), /only plans/);
  rejects(
    run("bench_node.mjs", "--record", join(dir, "future"), "--json", join(directoryAlias, "future")),
    /different files/,
  );
  rejects(run("arena_node.mjs", "--replay", tape, "--comparison-json", symlink), /different files/);
  rejects(run("arena_node.mjs", "--replay", tape, "--check=submission", "--map=toronto"), /entire recording/);

  const arena = (...args) => json(run("arena_node.mjs", "--list", "--port=1", "--set=all", ...args)).drives;
  const authored = arena();
  assert.ok(authored.length > 60);
  const reference = authored.find((d) => d.map === "toronto" && d.park);
  assert.ok(reference);
  for (const key of ["map", "region", "weather", "hazard", "difficulty"]) {
    const matching = arena(`--${key}=${reference[key]}`);
    assert.ok(matching.length < authored.length);
    assert.ok(matching.every((d) => d[key] === reference[key]));
    assert.ok(matching.some((d) => d.id === reference.id));
  }
  const parking = arena("--parking-only");
  assert.ok(parking.length > 0 && parking.length < authored.length && parking.every((d) => d.park));
  assert.deepEqual(
    arena(`--skip=${authored[0].id}`, "--limit=2").map((d) => d.id),
    authored.slice(1, 3).map((d) => d.id),
  );
  assert.deepEqual(
    arena(`--only= ${authored[1].id} , ${authored[0].id} `).map((d) => d.id),
    authored.slice(0, 2).map((d) => d.id),
  );
  rejects(run("arena_node.mjs", "--list", "--map=imaginary"), /Available:/);

  const trace = {
    version: 1,
    inputs: { scenario: { id: "sample" } },
    result: { pass: true, arrived: true, time_s: 2 },
    steps: [
      { ego: { x: 0, y: 0, heading: 0, speed: 1 }, traffic: [{ id: 1, x: 3 }], decision: null },
      { ego: { x: 1, y: 0, heading: 0, speed: 2 }, traffic: [{ id: 1, x: 4 }], decision: null },
    ],
  };
  const shifted = structuredClone(trace);
  Object.assign(shifted.steps[0].ego, { x: 0.05, heading: 0.04, speed: 1.03 });
  for (const [options, path] of [
    [{}, "ego.x"],
    [{ positionTolerance: 0.1 }, "ego.heading"],
    [{ positionTolerance: 0.1, headingTolerance: 0.1 }, "ego.speed"],
  ])
    assert.equal(compareTraces(trace, shifted, options).stateOverTolerance.path, path);
  const tolerances = { positionTolerance: 0.1, headingTolerance: 0.1, speedTolerance: 0.1 };
  assert.equal(compareTraces(trace, shifted, tolerances).stateOverTolerance, null);
  shifted.steps[0].traffic[0].id++;
  shifted.steps[1].decision = { choice: "lane" };
  const { summary, stateOverTolerance } = compareTraces(trace, shifted, { tolerance: 10, summary: true });
  assert.equal(stateOverTolerance.path, "traffic.0.id");
  assert.equal(summary.unmatchedTrafficTicks, 1);
  assert.equal(summary.divergentDecisionTicks, 1);
  const finalOnly = { ...trace, result: { ...trace.result, pass: false } };
  assert.equal(compareTraces(trace, finalOnly, { window: 0 }).window.centerTick, 1);
  assert.throws(() => compareTraces(trace, { ...trace, steps: [trace.steps[0], null] }), /right at tick 1/);
  const left = write("left.json", JSON.stringify(trace));
  const near = structuredClone(trace);
  near.steps[1].ego.x += 1e-12;
  const right = write("right.json", JSON.stringify(near));
  const traceOutput = join(dir, "trace-report.json.gz");
  assert.equal(run("bench_trace.mjs", "--check", left, right).status, 0);
  assert.equal(run("bench_trace.mjs", "--exact", "--check", left, right).status, 1);
  rejects(run("bench_trace.mjs", "--exact", "--tolerance=1", left, right), /cannot be combined/);
  rejects(run("bench_trace.mjs", "--output", left, left, right), /different files/);
  assert.equal(run("bench_trace.mjs", "--compact", "--output", traceOutput, left, right).status, 0);
  const text = gunzipSync(readFileSync(traceOutput)).toString();
  assert.equal(text.trim().split("\n").length, 1);
  assert.equal(JSON.parse(text).scenario, "sample");

  const task = "city/kitsilano/seed-2";
  const auditRun = { results: [{ id: "s1-1", arrived: true, pass: false, failures: ["red light"] }] };
  const auditCategories = classifyResults(auditRun.results);
  assert.equal(soakVerdict({ count: 2 }, auditRun, auditCategories), true);
  assert.equal(soakVerdict({ count: 2 }, auditRun, auditCategories, { strict: true }), false);
  assert.throws(
    () => soakVerdict({ count: 2 }, auditRun, auditCategories, { requireCount: true }),
    /Expected 2 routes; completed 1/,
  );
  const soakArgs = ["--dry-run", "--mode=city", "--maps=kitsilano", "--seeds=1, 2,3"];
  assert.deepEqual(
    json(run("soak.mjs", ...soakArgs, `--only=${task}`)).tasks.map((t) => t.configuration),
    [task],
  );
  assert.deepEqual(
    json(run("soak.mjs", ...soakArgs, `--skip=${task}`)).tasks.map((t) => t.seed),
    [1, 3],
  );
  rejects(run("soak.mjs", ...soakArgs, "--skip=unknown"), /Unknown configurations/);
  rejects(run("soak.mjs", ...soakArgs, "--weather=mist"), /Unknown weather/);
  rejects(run("soak.mjs", "--dry-run", "--maps=kitsilano,kitsilano"), /duplicate items/);
  rejects(run("soak.mjs", "--dry-run", "--seeds=1,01"), /--seeds contains duplicate seeds/);
  const soakOutput = join(dir, "soak.json.gz");
  const empty = run(
    "soak.mjs",
    "--mode=city",
    "--maps=kitsilano",
    "--seeds=1",
    "--shards=2",
    "--shard=1",
    "--quiet",
    "--port=1",
    "--json",
    soakOutput,
  );
  assert.equal(json(empty).configurations, 0);
  assert.equal(readJson(soakOutput).runs.length, 0);

  const first = write("a.js", "console.log('passing output')");
  const second = write("b.js", "console.error('test failure'); process.exit(9)");
  write("--last.js", "if (!process.execArgv.includes('--no-warnings')) process.exit(5)");
  const checkRunner = (...args) => run("node_checks.mjs", ...args);
  assert.match(checkRunner("--help").stdout, /Usage:/);
  assert.equal(checkRunner("--list", "--match=a", first, second).stdout.trim(), first);
  assert.equal(checkRunner("--list", "--exclude=a", first, second).stdout.trim(), second);
  rejects(checkRunner("--list", "--match=no-match", first), /No Node checks match/);
  rejects(checkRunner("--list", join(dir, "missing.js")), /No such check file/);
  rejects(checkRunner("--timeout=2147484", first), /--timeout/);
  rejects(checkRunner("--node-arg"), /needs a value/);
  assert.match(checkRunner("--show-output", first).stdout, /passing output/);
  const flags = spawnSync(
    process.execPath,
    [script("node_checks.mjs"), "--node-arg=--no-warnings", "--", "--last.js"],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 12_000,
    },
  );
  assert.equal(flags.status, 0, flags.stderr);
  const checkReport = join(dir, "check-report.json.gz");
  const failed = checkRunner("--jobs=1", "--fail-fast", "--json", checkReport, second, second);
  // Repeated paths are still one check. A later file in a separate run demonstrates fail-fast.
  assert.equal(failed.status, 1);
  assert.equal(readJson(checkReport).checks[0].code, 9);
  const later = write("z.js", "process.exit(0)");
  const fast = checkRunner("--jobs=1", "--fail-fast", "--json", checkReport, second, later);
  assert.equal(fast.status, 1);
  assert.deepEqual(readJson(checkReport).skipped, [later]);
  assert.equal(readJson(checkReport).checks[0].output.trim(), "test failure");
  rejects(checkRunner("--json", first, first), /different files/);

  const shard = (...args) => run("ci_shard.mjs", "--shards=6", ...args);
  assert.match(run("ci_shard.mjs", "-h").stdout, /Usage:/);
  const all = json(shard("--plan", "--json"));
  const file = "test_bench_tooling.mjs";
  const assigned = json(shard(`--file=${file}`, "--json")).shard;
  assert.ok(all[assigned].files.includes(file));
  assert.deepEqual(json(shard(`--shard=${assigned}`, "--json")).files, all[assigned].files);
  rejects(shard("--plan", "--shard=0"), /Choose one/);
  rejects(shard("--plan", "--unknown"), /Unknown option/);
  const timings = write("times.json", '{"seconds":{}}');
  assert.equal(json(shard("--plan", "--json", "--times", timings)).length, 6);
  rejects(shard("--plan", "--times", timings, "--require-measured"), /Missing measured times/);
  rejects(shard("--plan", "--times", write("bad-times.json", '{"seconds":{"test_one.mjs":-1}}')), /invalid time/);
  mkdirSync(join(dir, "test_directory.mjs"));
  assert.equal(testFiles(dir).includes("test_directory.mjs"), false);
  assert.deepEqual(
    plan(["a", "b"], { a: 0, b: 0 }, 2).map((s) => s.files.length),
    [1, 1],
  );

  let token = false;
  const server = createServer((req, res) => {
    if (req.url === "/bench") res.end(token ? '<meta name="jev-csrf" content="example">' : "<h1>Other service</h1>");
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = String(server.address().port);
    await assert.rejects(benchPage(port), /no Jev session token/);
    token = true;
    assert.equal((await benchPage(port)).token, "example");
    const soaked = join(dir, "soak-failed.json.gz");
    const soak = [
      "--experimental-default-type=module",
      script("soak.mjs"),
      "--mode=city",
      "--maps=kitsilano",
      "--seeds=1,2",
      "--timeout=1",
      "--fail-fast",
      "--progress",
      "--quiet",
      "--port",
      port,
    ];
    const skipped = ["city/kitsilano/seed-2"];
    const checkFailFast = (error) => {
      assert.equal(JSON.parse(error.stdout).configurations, 1);
      assert.deepEqual(JSON.parse(error.stdout).skipped, skipped);
      assert.match(error.stderr, /\[1\/2\] Starting/);
      return true;
    };
    await assert.rejects(exec(process.execPath, soak), checkFailFast);
    await assert.rejects(exec(process.execPath, [...soak, "--json", soaked]), checkFailFast);
    assert.deepEqual(readJson(soaked).skipped, skipped);
  } finally {
    server.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("Benchmark CLI, trace comparison, soak controls and Node check reports passed.");
