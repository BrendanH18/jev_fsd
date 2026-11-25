// Summarise provider-reported tokens from saved model tapes without replaying the drives.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { isObject, own } from "../static/js/brain/model-contract.js";
import { driverKind, ModelRecording } from "../static/js/brain/recording.js";

export const DEFAULT_INPUT_TOKEN_TARGET = 5500;
const USAGE = [
  "Usage: node --experimental-default-type=module scripts/audit_jev_tokens.mjs [options] <recording.json[.gz] | ->",
  `  --target <N>          input token target per call (default ${DEFAULT_INPUT_TOKEN_TARGET})`,
  "  --check               fail if any measured call exceeds the target",
  "  --check-usage         fail for empty selections or recorded responses without measured input usage",
  "  --max-total <N>       fail above this many measured input tokens across the selected drives",
  "  --drive <id>          select a drive (repeatable)",
  "  --top <N>             list the N highest input-token calls at tape and drive level (max 100)",
  "  --baseline <path>     add a comparison by matching drive ID",
  "  --help, -h            show this help",
].join("\n");

const tokens = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const maxSafe = (total, value) => {
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new Error("The token total exceeds JavaScript's safe integer range.");
  return next;
};

function providerInput(usage) {
  const total = tokens(own(usage, "prompt_tokens"));
  if (total !== null) {
    const cached = tokens(own(own(usage, "prompt_tokens_details"), "cached_tokens"));
    return { input: total, read: cached !== null && cached <= total ? cached : null, write: null };
  }

  const base = tokens(own(usage, "input_tokens"));
  if (base === null) return null;
  const read = own(usage, "cache_read_input_tokens");
  const write = own(usage, "cache_creation_input_tokens");
  if ([read, write].some((count) => count !== undefined && tokens(count) === null)) return null;
  const input = base + (read ?? 0) + (write ?? 0);
  return tokens(input) === null ? null : { input, read: read ?? null, write: write ?? null };
}

function usageOf(response) {
  const provider = response?.trace?.response?.usage;
  const meta = response?.meta;
  const usage = providerInput(provider);
  const fromMeta = tokens(own(meta, "input_tokens"));
  const input = usage?.input ?? fromMeta;
  const validCache = (count) => (tokens(count) !== null && input !== null && count <= input ? count : null);
  const read = usage?.read ?? validCache(own(meta, "cache_read_tokens"));
  const write = usage?.write ?? validCache(own(meta, "cache_write_tokens"));
  const validSplit = read === null || write === null || read + write <= input;
  return {
    input,
    output: tokens(provider?.completion_tokens) ?? tokens(provider?.output_tokens) ?? tokens(meta?.output_tokens),
    read: validSplit ? read : null,
    write: validSplit ? write : null,
    source: usage ? "provider" : fromMeta !== null ? "metadata" : "missing",
    unusableProviderUsage: provider != null && usage === null,
  };
}

function distribution(values) {
  values.sort((a, b) => a - b);
  const percentile = (p) => values[Math.ceil(values.length * p) - 1] ?? null;
  return {
    count: values.length,
    total: values.reduce(maxSafe, 0),
    min: values[0] ?? null,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: values.at(-1) ?? null,
  };
}

function coverage() {
  return {
    calls: 0,
    responses: 0,
    timeouts: 0,
    cancellations: 0,
    transport_errors: 0,
    invalid_replies: 0,
    provider_usage: 0,
    metadata_usage: 0,
    unusable_provider_usage: 0,
    responses_without_usage: 0,
    exactly_at_target: 0,
    over_target: 0,
    calls_with_cache_hit: 0,
    calls_with_cache_write: 0,
  };
}

function accumulator() {
  return { counts: coverage(), input: [], output: [], read: [], write: [], top: [] };
}

function noteCall(aggregate, outcome, location, target, n) {
  const { counts } = aggregate;
  counts.calls++;
  if (outcome.timeout) counts.timeouts++;
  else if (outcome.cancelled) counts.cancellations++;
  else if (Object.hasOwn(outcome, "error")) counts.transport_errors++;
  else if (Object.hasOwn(outcome, "response")) {
    counts.responses++;
    const response = outcome.response;
    if (!isObject(response) || response.invalid || response.meta?.invalid) counts.invalid_replies++;
    const { input, output, read, write, source, unusableProviderUsage } = usageOf(response);
    if (unusableProviderUsage) counts.unusable_provider_usage++;
    if (output !== null) aggregate.output.push(output);
    if (read !== null) aggregate.read.push(read);
    if (write !== null) aggregate.write.push(write);
    if (read > 0) counts.calls_with_cache_hit++;
    if (write > 0) counts.calls_with_cache_write++;
    if (source === "provider") counts.provider_usage++;
    else if (source === "metadata") counts.metadata_usage++;
    else counts.responses_without_usage++;
    if (input === null) return;
    aggregate.input.push(input);
    if (input === target) counts.exactly_at_target++;
    if (input > target) counts.over_target++;
    if (n && (aggregate.top.length < n || input > aggregate.top.at(-1).input_tokens)) {
      aggregate.top.push({ ...location, input_tokens: input, source });
      aggregate.top.sort((a, b) => b.input_tokens - a.input_tokens);
      if (aggregate.top.length > n) aggregate.top.pop();
    }
  }
}

function summarize(aggregate, top) {
  const { counts } = aggregate;
  const input = distribution(aggregate.input);
  const output = distribution(aggregate.output);
  return {
    ...counts,
    without_usage: counts.calls - input.count,
    with_usage: input.count,
    total_input_tokens: input.total,
    min_input_tokens: input.min,
    p50_input_tokens: input.p50,
    p95_input_tokens: input.p95,
    p99_input_tokens: input.p99,
    max_input_tokens: input.max,
    output_tokens: output,
    cache_read_tokens: distribution(aggregate.read),
    cache_write_tokens: distribution(aggregate.write),
    ...(top ? { largest: aggregate.top } : {}),
  };
}

export function auditRecording(tape, target = DEFAULT_INPUT_TOKEN_TARGET, { driveIds = [], top = 0 } = {}) {
  if (typeof tape?.header?.driver !== "string" || !driverKind(tape.header.driver))
    throw new Error("This audit needs a model recording (jev, decision:<name> or llm:<name>).");
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error("--target must be a positive integer.");
  if (!Number.isInteger(top) || top < 0 || top > 100) throw new Error("--top must be a whole number from 0 to 100.");
  if (!isObject(tape.drives)) throw new Error("This audit needs the recording's drive table.");
  for (const id of driveIds) if (!Object.hasOwn(tape.drives, id)) throw new Error(`No recorded drive named ${id}.`);
  const selected = new Set(driveIds);
  const overall = accumulator();
  const drives = Object.create(null);
  for (const [id, answers] of Object.entries(tape.drives)) {
    if (selected.size && !selected.has(id)) continue;
    const local = accumulator();
    for (const [key, outcomes] of Object.entries(answers)) {
      for (const [index, outcome] of outcomes.entries()) {
        // Tape order is request-key order, then occurrence order for repeated requests.
        const location = { drive: id, request_key: key, occurrence: index + 1 };
        noteCall(local, outcome, location, target, top);
        noteCall(overall, outcome, location, target, top);
      }
    }
    drives[id] = summarize(local, top);
  }
  return {
    driver: tape.header.driver,
    input_token_target: target,
    summary: { drives: Object.keys(drives).length, ...summarize(overall, top) },
    drives,
  };
}

export function compareUsage(baseline, report) {
  const matched = Object.create(null);
  const onlyCurrent = [];
  for (const [id, result] of Object.entries(report.drives)) {
    const previous = own(baseline.drives, id);
    if (!previous) {
      onlyCurrent.push(id);
      continue;
    }
    const delta = (key) => (previous[key] == null || result[key] == null ? null : result[key] - previous[key]);
    matched[id] = {
      calls_change: delta("calls"),
      measured_calls_change: delta("with_usage"),
      unmeasured_responses_change: delta("responses_without_usage"),
      total_input_tokens_change: previous.with_usage && result.with_usage ? delta("total_input_tokens") : null,
      p95_input_tokens_change: delta("p95_input_tokens"),
      max_input_tokens_change: delta("max_input_tokens"),
      over_target_change: delta("over_target"),
    };
  }
  return {
    baseline_driver: baseline.driver,
    drives: matched,
    only_baseline: Object.keys(baseline.drives).filter((id) => !Object.hasOwn(report.drives, id)),
    only_current: onlyCurrent,
  };
}

function integerOption(value, flag, min, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) {
    const range =
      max !== Number.MAX_SAFE_INTEGER
        ? `a whole number from ${min} to ${max}`
        : min === 0
          ? "a nonnegative integer"
          : "a positive integer";
    throw new Error(`--${flag} must be ${range}.`);
  }
  return n;
}

function readTape(path) {
  try {
    const raw = readFileSync(path === "-" ? 0 : path);
    const gzip = (raw[0] === 0x1f && raw[1] === 0x8b) || path.endsWith(".gz");
    const json = (gzip ? gunzipSync(raw) : raw).toString("utf8").replace(/^\uFEFF/u, "");
    return ModelRecording.parse(json);
  } catch (error) {
    const reason = error instanceof SyntaxError ? "Could not parse the recording JSON." : error.message;
    throw new Error(`${path}: ${reason}`, { cause: error });
  }
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      target: { type: "string" },
      check: { type: "boolean" },
      "check-usage": { type: "boolean" },
      "max-total": { type: "string" },
      drive: { type: "string", multiple: true },
      top: { type: "string" },
      baseline: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (positionals.length !== 1) throw new Error(USAGE);
  const [path] = positionals;
  if (path === "-" && values.baseline === "-") throw new Error("Read at most one recording from standard input.");
  const target = values.target === undefined ? DEFAULT_INPUT_TOKEN_TARGET : integerOption(values.target, "target", 1);
  const top = values.top === undefined ? 0 : integerOption(values.top, "top", 0, 100);
  const limit = values["max-total"] === undefined ? null : integerOption(values["max-total"], "max-total", 0);
  const report = auditRecording(readTape(path), target, { driveIds: values.drive, top });
  if (values.baseline !== undefined) {
    const tape = readTape(values.baseline);
    const sharedSelection = values.drive?.filter((id) => Object.hasOwn(tape.drives, id));
    const baseline =
      sharedSelection && sharedSelection.length === 0
        ? { driver: tape.header.driver, drives: {} }
        : auditRecording(tape, target, { driveIds: sharedSelection });
    report.comparison = compareUsage(baseline, report);
  }
  console.log(JSON.stringify(report, null, 2));
  const s = report.summary;
  if (values.check && s.over_target > 0) {
    console.error(`${s.over_target} call(s) exceeded input token target ${target} (max ${s.max_input_tokens}).`);
    process.exitCode = 1;
  }
  if (values["check-usage"] && (!s.responses || s.responses_without_usage)) {
    console.error(`Need measured input usage (${s.responses} responses, ${s.responses_without_usage} without usage).`);
    process.exitCode = 1;
  }
  if (limit !== null && s.total_input_tokens > limit) {
    console.error(`Measured input tokens ${s.total_input_tokens} exceed the total budget ${limit}.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
