import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { benchPage, jsonDifferences, loopbackPort } from "./cli_tools.mjs";

const cli = (script) => fileURLToPath(new URL(script, import.meta.url));
const run = (script, ...args) =>
  spawnSync(process.execPath, ["--experimental-default-type=module", cli(script), ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
const directory = mkdtempSync(join(tmpdir(), "jev-cli-test-"));
const write = (name, data) => {
  const path = join(directory, name);
  const text = JSON.stringify(data);
  writeFileSync(path, name.endsWith(".gz") ? gzipSync(text) : text);
  return path;
};

try {
  for (const script of ["bench_node.mjs", "arena_node.mjs", "soak.mjs", "bench_trace.mjs", "audit_jev_tokens.mjs"]) {
    const help = run(script, "--help");
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage:/);
  }
  for (const script of ["bench_node.mjs", "arena_node.mjs"]) {
    const missingRecord = run(script, "--reserve", "1");
    assert.equal(missingRecord.status, 1);
    assert.match(missingRecord.stderr, /--reserve needs --record/);
    const invalidReserve = run(script, "--record", "tape.json", "--reserve", "Infinity");
    assert.equal(invalidReserve.status, 1);
    assert.match(invalidReserve.stderr, /positive number/);
  }
  for (const script of ["bench_node.mjs", "arena_node.mjs", "soak.mjs"]) {
    const missingServer = run(script, "--port=1");
    assert.equal(missingServer.status, 1);
    assert.match(missingServer.stderr, /http:\/\/127\.0\.0\.1:1\/bench.*uv run server\.py/);
    assert.match(run(script, "--port=65536").stderr, /port must be a decimal integer/);
  }
  for (const value of ["", "0", "65536", "8331\n", "8e3", "8.5", "8331/path"])
    assert.throws(() => loopbackPort(value), /port must be a decimal integer/);
  assert.equal(loopbackPort("065535"), "65535");

  let redirectPreflight = true;
  let redirectHits = 0;
  let apiCalls = 0;
  const localServer = createServer((request, response) => {
    if (request.url === "/target") {
      redirectHits++;
      response.end("redirect followed");
    } else if (request.url === "/bench" && !redirectPreflight) {
      response.end('<meta name="jev-csrf" content="local-token">');
    } else {
      if (request.url.startsWith("/api/")) apiCalls++;
      response.writeHead(302, { Location: "/target" }).end();
    }
  });
  await new Promise((resolve) => localServer.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = localServer.address();
    await assert.rejects(benchPage(String(port)), /redirects are not allowed/);
    redirectPreflight = false;
    for (const script of ["bench_node.mjs", "arena_node.mjs"]) {
      await assert.rejects(
        promisify(execFile)(
          process.execPath,
          ["--experimental-default-type=module", cli(script), "--port", String(port)],
          {
            timeout: 10_000,
          },
        ),
        /fetch failed/,
      );
    }
    assert.equal(apiCalls, 2);
    assert.equal(redirectHits, 0);
  } finally {
    await new Promise((resolve, reject) => localServer.close((error) => (error ? reject(error) : resolve())));
  }
  const listed = run("soak.mjs", "--dry-run", "--mode=hard", "--shards=2", "--shard=1");
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).configurations, 2);
  assert.equal(run("soak.mjs", "--dry-run", "--timeout=2147483648").status, 1);

  const checkDriverHelp = run("check_driver.mjs", "--help");
  assert.equal(checkDriverHelp.status, 0, checkDriverHelp.stderr);
  assert.match(checkDriverHelp.stdout, /--track/);
  assert.match(checkDriverHelp.stdout, /--no-baselines/);
  assert.equal(run("check_driver.mjs", "--agent", "unused.js", "--track", "bogus").status, 1);
  assert.match(run("check_driver.mjs", "--agent", "unused.js", "--port=0").stderr, /port must be a decimal integer/);

  globalThis.document = { querySelector: () => null };
  const { canonicalJson, comparableResult } = await import("../static/js/brain/recording.js");
  const expected = { wall_ms: 12, arrived: true, violations: { collision: null } };
  const actual = { wall_ms: 2, arrived: false, violations: {} };
  assert.deepEqual(jsonDifferences(comparableResult(expected), comparableResult(actual), canonicalJson), [
    "arrived: expected true, actual false",
    "violations.collision: expected null, actual <missing>",
  ]);

  const trace = {
    version: 1,
    inputs: { scenario: { id: "tuned-route" } },
    result: { pass: true, arrived: true, time_s: 0.5 },
    steps: [
      { ego: { x: 0, y: 0, heading: 0, speed: 0 }, traffic: [], decision: null },
      { ego: { x: 1, y: 2, heading: 0.1, speed: 1 }, traffic: [], decision: null },
    ],
  };
  const changed = structuredClone(trace);
  changed.steps[0].decision = { choice: "hold" };
  changed.steps[1].ego.x += 0.5;
  const traceDiff = run(
    "bench_trace.mjs",
    "--check",
    "--tolerance=0.1",
    "--summary",
    "--window=1",
    write("left.json.gz", trace),
    write("right.json", changed),
  );
  assert.equal(traceDiff.status, 1, traceDiff.stderr);
  const traceReport = JSON.parse(traceDiff.stdout);
  assert.equal(traceReport.stateOverTolerance.tick, 1);
  assert.equal(traceReport.summary.maxPositionDrift, 0.5);
  assert.equal(traceReport.window.centerTick, 0);

  for (const driver of ["jev", "decision:fixture", "llm:fixture"]) {
    const tapePath = write("audit.json.gz", {
      format: "jev-model-recording/1",
      header: { driver },
      drives: {
        example: {
          request: [
            { response: { trace: { response: { usage: { input_tokens: 4, cache_read_input_tokens: 8 } } } } },
            { response: { trace: { response: { usage: { prompt_tokens: 10 } } } } },
            { response: { meta: { input_tokens: 2 } } },
            { timeout: true },
          ],
        },
      },
    });
    const audit = run("audit_jev_tokens.mjs", "--target=10", "--check", tapePath);
    assert.equal(audit.status, 1, audit.stderr);
    const { summary } = JSON.parse(audit.stdout);
    assert.equal(summary.calls, 4);
    assert.equal(summary.with_usage, 3);
    assert.equal(summary.total_input_tokens, 24);
    assert.equal(summary.p50_input_tokens, 10);
    assert.equal(summary.p95_input_tokens, 12);
    assert.equal(summary.max_input_tokens, 12);
    assert.equal(summary.over_target, 1);
  }

  const manifest = { format: "jev-run-manifest/2", driver: "outside-driver", cost_usd: 0.1 };
  const report = { manifest, results: [{ challenge: "example", pass: true, arrived: true, time_s: 10 }] };
  const recording = { format: "jev-local-recording/1", header: { arena: {}, manifest } };
  const bundle = write("submission.json.gz", { format: "jev-submission/1", recording, report });
  const inspected = run("driver_submission.mjs", "inspect", "--bundle", bundle, "--json");
  assert.equal(inspected.status, 0, inspected.stderr);
  const unpacked = JSON.parse(inspected.stdout);
  assert.equal(unpacked.passed, 1);
  assert.equal(unpacked.driver, "outside-driver");
  assert.equal(unpacked.cost_usd, 0.1);
  assert.match(unpacked.file_sha256, /^[a-f0-9]{64}$/);
  assert.equal(unpacked.tape_sha256_verified, null);
  assert.equal(run("driver_submission.mjs", "verify", "--bundle", bundle, "--timeout=0").status, 1);
  assert.match(
    run("driver_submission.mjs", "verify", "--bundle", bundle, "--port=1.5").stderr,
    /port must be a decimal integer/,
  );
  assert.match(
    run("driver_submission.mjs", "verify", "--bundle", bundle, "--port=1").stderr,
    /http:\/\/127\.0\.0\.1:1\/bench.*uv run server\.py/,
  );
  const bytes = gzipSync(JSON.stringify(recording));
  const published = write("published.json", {
    format: "jev-published-submission/1",
    submitter: "example",
    recording_sha256: createHash("sha256").update(bytes).digest("hex"),
    report,
  });
  writeFileSync(`${published}.gz`, bytes);
  const publishedInfo = run("driver_submission.mjs", "inspect", "--bundle", published, "--json");
  assert.equal(publishedInfo.status, 0, publishedInfo.stderr);
  assert.equal(JSON.parse(publishedInfo.stdout).tape_sha256_verified, true);
  writeFileSync(`${published}.gz`, "corrupted");
  assert.match(run("driver_submission.mjs", "inspect", "--bundle", published).stderr, /Recording SHA-256 mismatch/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("CLI help, validation, replay differences, soak planning, gzipped traces and offline inspection passed.");
