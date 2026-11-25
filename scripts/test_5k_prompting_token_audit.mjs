import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { auditRecording, compareUsage } from "./audit_jev_tokens.mjs";
import { RECORDING_FORMAT } from "../static/js/brain/recording.js";

const usage = (fields, meta = {}, extra = {}) => ({
  response: { trace: { response: { usage: fields } }, meta, ...extra },
});
const tape = {
  format: RECORDING_FORMAT,
  header: { driver: "llm:stub" },
  drives: {
    first: {
      x: [
        usage({ input_tokens: 4, cache_read_input_tokens: 7, cache_creation_input_tokens: 3, output_tokens: 2 }),
        usage({
          prompt_tokens: 12,
          input_tokens: 1,
          cache_read_input_tokens: 6,
          prompt_tokens_details: { cached_tokens: 5 },
          completion_tokens: 3,
        }),
        usage({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 11 } }, {}, { invalid: "refused" }),
        usage(
          { input_tokens: 2, cache_read_input_tokens: "3" },
          { input_tokens: 8, output_tokens: 6, cache_read_tokens: 2 },
        ),
        usage({ prompt_tokens: "8", input_tokens: 6 }, { input_tokens: 3 }),
        { timeout: true },
        { cancelled: true },
        { error: { message: "private error" } },
        { response: null },
      ],
      y: [usage(undefined, { input_tokens: 0, cache_read_tokens: 0 }), usage({ prompt_tokens: 14 })],
    },
    follow: { z: [usage({ prompt_tokens: 5 }), usage({ completion_tokens: 4 })] },
    empty: {},
    ["__proto__"]: { key: [usage({ prompt_tokens: 3 })] },
  },
};
const report = auditRecording(tape, 10, { top: 2 });
const s = report.summary;
assert.equal(s.drives, 4);
assert.equal(s.calls, 14);
assert.equal(s.with_usage, 9);
assert.equal(s.without_usage, 5);
assert.equal(s.responses, 11);
assert.equal(s.responses_without_usage, 2);
assert.equal(s.timeouts, 1);
assert.equal(s.cancellations, 1);
assert.equal(s.transport_errors, 1);
assert.equal(s.invalid_replies, 2);
assert.equal(s.provider_usage, 7);
assert.equal(s.metadata_usage, 2);
assert.equal(s.unusable_provider_usage, 2);
assert.equal(s.total_input_tokens, 72);
assert.equal(s.exactly_at_target, 1);
assert.equal(s.over_target, 3);
assert.equal(s.min_input_tokens, 0);
assert.equal(s.p50_input_tokens, 8);
assert.equal(s.p95_input_tokens, 14);
assert.equal(s.p99_input_tokens, 14);
assert.equal(s.max_input_tokens, 14);
assert.equal(s.output_tokens.count, 4);
assert.equal(s.output_tokens.total, 15);
assert.equal(s.cache_read_tokens.count, 4);
assert.equal(s.cache_read_tokens.total, 14);
assert.equal(s.cache_write_tokens.total, 3);
assert.equal(s.calls_with_cache_hit, 3);
assert.equal(s.calls_with_cache_write, 1);
assert.equal(s.largest.length, 2);
assert.equal(s.largest[0].request_key, "x");
assert.equal(s.largest[0].occurrence, 1);
assert.equal(s.largest[1].request_key, "y");
assert.equal(s.largest[0].source, "provider");
assert.equal(s.largest[0].drive, "first");
assert.equal(report.drives.first.responses_without_usage, 1);
assert.equal(report.drives.follow.output_tokens.total, 4);
assert.equal(report.drives.empty.p95_input_tokens, null);
assert.equal(report.drives.empty.calls, 0);
assert.equal(Object.getOwnPropertyDescriptor(report.drives, "__proto__").value.total_input_tokens, 3);
assert.equal(Object.getPrototypeOf(report.drives), null);
assert.equal(JSON.stringify(report).includes("private error"), false);
assert.equal(JSON.stringify(report).includes("refused"), false);

const selected = auditRecording(tape, 10, { driveIds: ["follow", "follow"] });
assert.equal(selected.summary.drives, 1);
assert.equal(selected.summary.calls, 2);
assert.equal(Object.keys(selected.drives).join(), "follow");
assert.equal("largest" in selected.summary, false);
assert.throws(() => auditRecording(tape, 10, { driveIds: ["missing"] }), /No recorded drive named missing/);
assert.throws(() => auditRecording({ header: { driver: "rules" }, drives: {} }), /needs a model recording/);
assert.throws(() => auditRecording({ header: { driver: "jev" }, drives: [] }), /drive table/);
assert.throws(() => auditRecording(tape, 0), /positive integer/);
assert.throws(() => auditRecording(tape, 10, { top: 101 }), /0 to 100/);

const sample = (...outcomes) =>
  auditRecording({ header: { driver: "jev" }, drives: { d: { key: outcomes } } }, 5, { top: 3 }).summary;
assert.equal(
  sample(usage({ input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1 }, { input_tokens: 5 })).largest[0]
    .source,
  "metadata",
);
assert.equal(
  sample(usage({ prompt_tokens: 5 }, { cache_read_tokens: 4, cache_write_tokens: 3 })).cache_read_tokens.count,
  0,
);
assert.equal(sample(usage({ prompt_tokens: 5, prompt_tokens_details: { cached_tokens: 5 } })).cache_read_tokens.max, 5);
assert.equal(
  sample(usage({ prompt_tokens: 5 }, { cache_write_tokens: "3", cache_read_tokens: -1 })).cache_write_tokens.count,
  0,
);
assert.equal(sample(usage({}, { input_tokens: true, output_tokens: 1.5 })).with_usage, 0);
assert.equal(sample(usage({ completion_tokens: -1, output_tokens: 2 })).output_tokens.min, 2);
assert.equal(sample(usage({ input_tokens: 1, cache_creation_input_tokens: null })).responses_without_usage, 1);
assert.equal(sample(usage({ input_tokens: 1, cache_creation_input_tokens: 0 })).cache_write_tokens.count, 1);
assert.throws(
  () => sample(usage({ input_tokens: Number.MAX_SAFE_INTEGER }), usage({ input_tokens: 1 })),
  /safe integer range/,
);

const previous = auditRecording(
  { header: { driver: "jev" }, drives: { first: { x: [usage({ prompt_tokens: 8 })] }, follow: {}, gone: {} } },
  10,
);
const matching = compareUsage(previous, report);
assert.equal(matching.baseline_driver, "jev");
assert.equal(matching.only_baseline.join(), "gone");
assert.equal(matching.only_current.join(), "empty,__proto__");
assert.equal(matching.drives.first.calls_change, 10);
assert.equal(matching.drives.first.measured_calls_change, 6);
assert.equal(matching.drives.first.unmeasured_responses_change, 1);
assert.equal(matching.drives.first.total_input_tokens_change, 56);
assert.equal(matching.drives.first.p95_input_tokens_change, 6);
assert.equal(matching.drives.first.max_input_tokens_change, 6);
assert.equal(matching.drives.first.over_target_change, 3);
assert.equal(matching.drives.follow.p95_input_tokens_change, null);
assert.equal(matching.drives.follow.max_input_tokens_change, null);
assert.equal(matching.drives.follow.total_input_tokens_change, null);

const script = ["--experimental-default-type=module", "scripts/audit_jev_tokens.mjs"];
const run = (...args) => spawnSync(process.execPath, [...script, ...args], { encoding: "utf8" });
const stdin = (input, ...args) => spawnSync(process.execPath, [...script, ...args, "-"], { input, encoding: "utf8" });
const dir = mkdtempSync(join(tmpdir(), "jev-token-audit-"));
try {
  const file = join(dir, "recording.json");
  const gz = join(dir, "archive");
  const older = join(dir, "older.json");
  const chars = JSON.stringify(tape);
  writeFileSync(file, chars);
  writeFileSync(gz, gzipSync(chars));
  writeFileSync(older, JSON.stringify({ ...tape, drives: { gone: {}, first: tape.drives.first } }));
  assert.equal(run("--help").stdout.includes("--check-usage"), true);
  assert.equal(run().status, 1);
  assert.equal(JSON.parse(run(file).stdout).summary.total_input_tokens, 72);
  assert.equal(JSON.parse(run(gz).stdout).summary.total_input_tokens, 72);
  assert.equal(JSON.parse(stdin(Buffer.from(`\uFEFF${chars}`)).stdout).summary.total_input_tokens, 72);
  assert.equal(JSON.parse(stdin(gzipSync(chars)).stdout).summary.total_input_tokens, 72);
  assert.equal(run("--target", "10", "--check", file).status, 1);
  assert.match(run("--target", "10", "--check", file).stderr, /3 call\(s\).*max 14/);
  assert.equal(run("--target", "14", "--check", file).status, 0);
  assert.equal(run("--max-total", "72", file).status, 0);
  assert.match(run("--max-total", "71", file).stderr, /exceed the total budget 71/);
  assert.equal(run("--drive", "__proto__", "--max-total", "3", "--check-usage", file).status, 0);
  assert.match(run("--check-usage", file).stderr, /11 responses, 2 without usage/);
  assert.equal(run("--drive", "empty", "--check-usage", file).status, 1);
  assert.equal(run("--drive", "empty", "--max-total", "0", file).status, 0);
  assert.match(run("--drive", "absent", file).stderr, /absent/);
  assert.equal(JSON.parse(run("--drive", "first", "--drive", "follow", "--top", "1", file).stdout).summary.calls, 13);
  assert.equal(JSON.parse(run("--baseline", older, file).stdout).comparison.only_baseline.join(), "gone");
  assert.equal(
    JSON.parse(run("--baseline", older, "--drive", "empty", file).stdout).comparison.only_current.join(),
    "empty",
  );
  assert.match(stdin(chars, "--baseline", "-").stderr, /at most one recording/);
  assert.match(stdin("no json").stderr, /Could not parse the recording JSON/);
  assert.match(run("--target", "2.5", file).stderr, /positive integer/);
  assert.match(run("--max-total", "-1", file).stderr, /--max-total/);
  assert.match(run("--top", "101", file).stderr, /--top/);
  const missing = join(dir, "missing.json");
  assert.equal(run("--baseline", missing, file).stderr.includes(missing), true);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("Token usage audit checks passed.");
