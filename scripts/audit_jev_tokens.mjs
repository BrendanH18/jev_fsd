// Summarise provider-reported input tokens from a saved model tape without replaying the drives.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { driverKind, ModelRecording } from "../static/js/brain/recording.js";

export const DEFAULT_INPUT_TOKEN_TARGET = 5500;
const USAGE = [
  "Usage: node --experimental-default-type=module scripts/audit_jev_tokens.mjs [options] <recording.json[.gz]>",
  `  --target <N>  input token target per call (default ${DEFAULT_INPUT_TOKEN_TARGET})`,
  "  --check       exit with status 1 if any call exceeds the input token target",
  "  --help, -h    show this help",
].join("\n");

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function inputTokens(outcome) {
  const usage = outcome.response?.trace?.response?.usage;
  if (usage && typeof usage === "object") {
    const base = usage.input_tokens ?? usage.prompt_tokens;
    if (Number.isSafeInteger(base) && base >= 0) {
      const cacheWrite =
        Number.isSafeInteger(usage.cache_creation_input_tokens) && usage.cache_creation_input_tokens > 0
          ? usage.cache_creation_input_tokens
          : 0;
      const cacheRead =
        Number.isSafeInteger(usage.cache_read_input_tokens) && usage.cache_read_input_tokens > 0
          ? usage.cache_read_input_tokens
          : 0;
      return base + cacheWrite + cacheRead;
    }
  }
  const metaTokens = outcome.response?.meta?.input_tokens;
  if (Number.isSafeInteger(metaTokens) && metaTokens >= 0) return metaTokens;
  return null;
}

function summarizeSamples(calls, samples, target) {
  const sorted = [...samples].sort((a, b) => a - b);
  let total = 0;
  let over = 0;
  for (const tokens of sorted) {
    total += tokens;
    if (tokens > target) over++;
  }
  return {
    calls,
    with_usage: sorted.length,
    total_input_tokens: total,
    p50_input_tokens: percentile(sorted, 50),
    p95_input_tokens: percentile(sorted, 95),
    max_input_tokens: sorted.length ? sorted[sorted.length - 1] : null,
    over_target: over,
  };
}

function auditDrive(answers, target) {
  let calls = 0;
  const samples = [];
  for (const outcomes of Object.values(answers)) {
    for (const outcome of outcomes) {
      calls++;
      const tokens = inputTokens(outcome);
      if (tokens !== null) samples.push(tokens);
    }
  }
  return { stats: summarizeSamples(calls, samples, target), samples };
}

export function auditRecording(tape, target = DEFAULT_INPUT_TOKEN_TARGET) {
  if (!driverKind(tape?.header?.driver)) {
    throw new Error("This audit needs a model recording (jev, decision:<name> or llm:<name>).");
  }
  if (!Number.isSafeInteger(target) || target <= 0) {
    throw new Error("--target must be a positive integer.");
  }
  let totalCalls = 0;
  const allSamples = [];
  const drives = Object.create(null);
  for (const [id, answers] of Object.entries(tape.drives)) {
    const { stats, samples } = auditDrive(answers, target);
    drives[id] = stats;
    totalCalls += stats.calls;
    for (const tokens of samples) allSamples.push(tokens);
  }
  return {
    driver: tape.header.driver,
    input_token_target: target,
    summary: {
      drives: Object.keys(drives).length,
      ...summarizeSamples(totalCalls, allSamples, target),
    },
    drives,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values, positionals } = parseArgs({
      options: {
        target: { type: "string" },
        check: { type: "boolean", default: false },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
    if (values.help) {
      console.log(USAGE);
      process.exit(0);
    }
    if (positionals.length !== 1) throw new Error(USAGE);
    let target = DEFAULT_INPUT_TOKEN_TARGET;
    if (values.target !== undefined) {
      if (!/^\d+$/.test(values.target)) throw new Error("--target must be a positive integer.");
      target = Number(values.target);
      if (!Number.isSafeInteger(target) || target <= 0) throw new Error("--target must be a positive integer.");
    }
    const [path] = positionals;
    const raw = readFileSync(path);
    const tape = ModelRecording.parse((path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
    const report = auditRecording(tape, target);
    console.log(JSON.stringify(report, null, 2));
    if (values.check && report.summary.over_target > 0) {
      console.error(
        `${report.summary.over_target} call(s) exceeded input token target ${target} (max ${report.summary.max_input_tokens}).`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof SyntaxError ? "Could not parse the recording JSON." : error.message);
    process.exitCode = 1;
  }
}
