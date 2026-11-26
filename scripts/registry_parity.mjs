// Registry migration checks. Run captures in each source tree with the same loopback server.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  benchPage,
  checkFiles,
  commaList,
  isMain,
  jsonDifferences,
  loopbackPort,
  parseOptions,
  readJson,
  wholeNumber,
  writeArtifact,
} from "./cli_tools.mjs";

const TIMINGS = new Set(["wall_ms", "latency_ms", "latency_p50_ms", "latency_p95_ms", "started_at"]);
const REQUIRED = ["bare-dry.json", "city-dry.json", "arena-rules.json", "arena-cautious.json", "system-prompt.json"];
const USAGE = `Usage: registry_parity.mjs bench DIR PRESET [MAP [WEATHER]] [--hour H] [--park 1] [--port PORT] [--timeout S]
       registry_parity.mjs arena DIR DRIVER [--port PORT]
       registry_parity.mjs prompt DIR
       registry_parity.mjs compare BEFORE AFTER [--expect FILE,...] [--only FILE,...] [--strict] [--limit N] [--json FILE]

--expect requires additional capture files; --only compares a named subset.
--strict includes timings and provenance in the comparison.
Captures use the current source tree. Benchmarks call the loopback server (PORT or 8331).`;

function read(file, strict) {
  const result = readJson(file, {
    reviver: strict ? undefined : (key, value) => (TIMINGS.has(key) ? undefined : value),
  });
  if (!result || typeof result !== "object") throw new Error(`${file}: expected a capture object or array`);
  if (!strict && result.manifest?.suite?.kind === "bench") {
    delete result.name;
    delete result.saved_at;
    delete result.manifest.source_commit;
    delete result.manifest.source_dirty;
  }
  return result;
}

function save(file, data) {
  writeArtifact(file, JSON.stringify(data));
}

function bench(dir, [features, map = "kitsilano", conditions = "dry"], args) {
  if (!["bare", "city"].includes(features)) throw new Error("Choose bare or city for the benchmark.");
  if (![map, conditions].every((value) => /^[a-z_]+$/.test(value))) throw new Error("Choose a named map and weather.");
  const name = map === "kitsilano" ? features : `${map}-${features}`;
  const hour = args.hour === undefined ? undefined : Number(args.hour);
  if (hour !== undefined && (!/^\d+(?:\.\d+)?$/.test(args.hour) || hour < 0 || hour >= 24))
    throw new Error("--hour must be a decimal number from 0 up to 24.");
  if (args.park !== undefined && !["0", "1"].includes(args.park)) throw new Error("--park must be 0 or 1.");
  const park = args.park === "1";
  const port = loopbackPort(args.port ?? process.env.PORT ?? "8331");
  const timeout = wholeNumber("timeout", args.timeout, 0, { min: args.timeout === undefined ? 0 : 1, max: 86_400 });
  const file = join(
    dir,
    `${name}-${conditions}${hour === undefined ? "" : `-hour-${hour}`}${park ? "-park" : ""}.json`,
  );
  // A failing child must never leave its partial capture at the destination.
  const temp = mkdtempSync(join(dir, ".registry-parity-"));
  const capture = join(temp, "capture.json");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-default-type=module",
        "scripts/bench_node.mjs",
        "--brain",
        "rules",
        "--map",
        map,
        "--seed",
        "1",
        "--features",
        features,
        "--weather",
        conditions,
        "--port",
        port,
        ...(hour === undefined ? [] : ["--hour", String(hour)]),
        ...(park ? ["--park", "1"] : []),
        "--json",
        capture,
      ],
      { stdio: "inherit", ...(timeout ? { timeout: timeout * 1000, killSignal: "SIGKILL" } : {}) },
    );
    if (result.error?.code === "ETIMEDOUT") throw new Error(`bench_node.mjs timed out after ${timeout} s`);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`bench_node.mjs failed (${result.signal ?? result.status})`);
    read(capture, true);
    writeArtifact(file, readFileSync(capture));
    console.log(`Captured ${file}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function arena(dir, brain, args) {
  if (!["rules", "cautious"].includes(brain)) throw new Error("Choose rules or cautious for the arena.");
  const { base, token } = await benchPage(args.port ?? process.env.PORT ?? "8331");
  globalThis.document = { querySelector: (selector) => (selector.includes("jev-csrf") ? { content: token } : null) };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (path, opts) => {
    const url = new URL(path, base);
    if (url.origin !== base) throw new Error(`Arena fetch must stay on ${base}`);
    return nativeFetch(url, { ...opts, redirect: "error" });
  };
  const { CHALLENGES } = await import("../static/js/lab/challenges.js");
  const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");
  const { evaluateChallenge } = await import("../static/js/lab/evaluation.js");
  const { load } = await import("./drive_lab_maps.mjs");
  const drives = [];
  for (const challenge of [...CHALLENGES, ...ROAD_TESTS]) {
    try {
      const result = await evaluateChallenge(load(challenge.map), challenge, { brain });
      if (result.simulation_error) throw new Error(result.simulation_error);
      drives.push(result);
    } catch (error) {
      throw new Error(`${brain}/${challenge.id}: ${error.message}`, { cause: error });
    }
  }
  save(join(dir, `arena-${brain}.json`), drives);
  console.log(`Arena (${brain}): ${drives.filter((r) => r.pass).length}/${drives.length} pass`);
}

async function prompt(dir) {
  globalThis.document = { querySelector: () => null };
  const { SYSTEM_PROMPT, OPEN_SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
  save(join(dir, "system-prompt.json"), { guarded: SYSTEM_PROMPT, open: OPEN_SYSTEM_PROMPT });
}

function captureNames(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function namedCaptures(name, value) {
  const names = commaList(name, value);
  for (const file of names ?? [])
    if (basename(file) !== file || file.includes("\\") || !file.endsWith(".json"))
      throw new Error(`--${name} requires bare .json capture names: ${file}`);
  return names;
}

function compare(before, after, args) {
  const only = namedCaptures("only", args.only);
  const extra = namedCaptures("expect", args.expect);
  const limit = wholeNumber("limit", args.limit, 12, { min: 1, max: 1000 });
  if (only && extra) throw new Error("Choose --only or --expect.");
  const left = captureNames(before);
  const right = captureNames(after);
  const missing = [...new Set(only ?? [...REQUIRED, ...(extra ?? [])])].filter((file) => !left.includes(file));
  if (missing.length) throw new Error(`Missing a required baseline capture in ${before}: ${missing.join(", ")}`);
  const files = only ? [...only].sort() : left;
  const absent = files.filter((file) => !right.includes(file));
  const additional = only ? [] : right.filter((file) => !left.includes(file));
  if (absent.length || additional.length)
    throw new Error(
      `Run sets differ. Missing after: ${absent.join(", ") || "(none)"}. Added after: ${additional.join(", ") || "(none)"}.`,
    );
  if (args.json) {
    checkFiles({}, { json: args.json });
    for (const dir of [before, after])
      for (const file of captureNames(dir)) checkFiles({ capture: join(dir, file) }, { json: args.json });
  }
  const comparisons = [];
  for (const name of files) {
    const baseline = read(join(before, name), args.strict);
    const result = read(join(after, name), args.strict);
    const identical = isDeepStrictEqual(baseline, result);
    const differences = identical ? [] : jsonDifferences(baseline, result, JSON.stringify, { limit });
    comparisons.push({ file: name, identical, differences });
    if (identical) console.log(`${name}: identical`);
    else console.error(`${name}: ${differences.join("\n") || "values differ"}`);
  }
  if (args.json)
    writeArtifact(args.json, `${JSON.stringify({ strict: !!args.strict, comparisons })}\n`, {
      gzip: args.json.endsWith(".gz"),
    });
  return comparisons.some(({ identical }) => !identical) ? 1 : 0;
}

async function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === "--help" || mode === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (!["compare", "bench", "arena", "prompt"].includes(mode)) throw new Error(USAGE);
  const positionals = [];
  while (rest[0] && !rest[0].startsWith("-")) positionals.push(rest.shift());
  const [dir, ...targets] = positionals;
  const names = {
    compare: ["expect", "only", "limit", "json"],
    bench: ["hour", "park", "port", "timeout"],
    arena: ["port"],
    prompt: [],
  };
  const { help, args } = parseOptions(rest, names[mode], mode === "compare" ? ["strict"] : []);
  if (help) {
    console.log(USAGE);
    return 0;
  }
  const min = mode === "prompt" ? 0 : 1;
  const max = mode === "bench" ? 3 : min;
  if (!dir || targets.length < min || targets.length > max) throw new Error(USAGE);
  if (mode === "compare") return compare(dir, targets[0], args);
  mkdirSync(dir, { recursive: true });
  if (mode === "bench") bench(dir, targets, args);
  else if (mode === "arena") await arena(dir, targets[0], args);
  else await prompt(dir);
  return 0;
}

if (isMain(import.meta.url)) {
  let code;
  try {
    code = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`registry-parity: ${error.message}`);
    code = 1;
  }
  // Arena's simulation uses a MessageChannel that outlives the last drive.
  if (process.argv[2] === "arena") process.exit(code);
  process.exitCode = code;
}
