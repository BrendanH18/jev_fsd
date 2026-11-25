// Weekly interaction probe. Small two-route suites keep each shard bounded; all 13 covering rows
// run on the first map/seed, and city runs the map × seed product. Examples:
// node --experimental-default-type=module scripts/soak.mjs --port 8381 --mode pairs --maps kitsilano --seeds 1
// node --experimental-default-type=module scripts/soak.mjs --port 8381 --maps kitsilano,toronto,calgary,victoria --seeds 1,2,3 --shard 0 --shards 8 --json soak.json
// --heldout 1 runs each map's held-out routes instead (bench/heldout.js, city only, one configuration
// per map, labelled heldout/<map>); report them apart and never debug against them (docs/rules-baseline.md).
// --mode hard runs the fixed hard city slice without sampling or changing its conditions.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import hardCity from "../data/suites/hard-city-v1.json" with { type: "json" };
import { checkHardConditions, checkHardProvenance, hardCityTasks } from "./hard_city_report.mjs";
import {
  benchPage,
  checkFiles,
  commaList,
  loopbackPort,
  parseOptions,
  readJson,
  wholeNumber,
  writeArtifact,
} from "./cli_tools.mjs";

// freeDriveOptions' imports use common.js, which reads the token at module load.
globalThis.document = { querySelector: () => null };
const { coveringArray, FEATURE_NAMES } = await import("../static/js/bench/features.js");
const { benchmarkConfig } = await import("../static/js/bench/options.js");
const { WEATHER } = await import("../static/js/sim/weather.js");
const { heldoutPlan } = await import("../static/js/bench/heldout.js");

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const STDERR_TAIL_CHARS = 2000;
const VALUE_OPTIONS = [
  "port",
  "mode",
  "maps",
  "seeds",
  "count",
  "shard",
  "shards",
  "weather",
  "json",
  "heldout",
  "timeout",
  "only",
  "skip",
  "retry-from",
];
const FLAG_OPTIONS = [
  "dry-run",
  "list",
  "fail-on-audit",
  "fail-fast",
  "quiet",
  "progress",
  "require-count",
  "coverage",
];
const USAGE = [
  "Usage: node --experimental-default-type=module scripts/soak.mjs [options]",
  "  --mode <all|city|pairs|hard>  task mode (default: all, or city with --heldout 1)",
  "  --maps <m1,m2,...>            map presets (default: kitsilano,toronto,calgary,victoria)",
  "  --seeds <s1,s2,...>           suite seeds (default: 1,2,3)",
  "  --count <N>                   routes per seed (default: 2)",
  "  --shard <i:0..shards-1>       zero-based shard index (default: 0)",
  "  --shards <N>                  total shard count (default: 1)",
  "  --weather <name>              weather condition (default: dry)",
  "  --heldout <0|1>               run held-out routes instead of tuned seeds",
  "  --port <port>                 local server port (default: PORT or 8331)",
  "  --timeout <ms>                per-configuration timeout in ms (default: 1200000)",
  "  --json <path[.gz]>            write soak JSON, compressed with a .gz suffix",
  "  --only <id,id>                keep the named configurations in this shard",
  "  --skip <id,id>                omit the named configurations from this shard",
  "  --retry-from <path[.gz]>     retry failed and unattempted legs from a matching coverage report",
  "  --coverage                   include per-configuration verdicts and the full shard plan",
  "  --fail-on-audit               fail when any drive fails its full verdict",
  "  --fail-fast                   stop after the first failing configuration",
  "  --require-count               fail if the suite produces fewer routes than requested",
  "  --quiet                      emit only the final JSON to stdout",
  "  --progress                   report configuration starts to stderr",
  "  --dry-run, --list             print shard assignments without running benchmarks",
  "  --help, -h                    show this help",
].join("\n");

export function soakPlan({
  mode = "all",
  maps = ["kitsilano", "toronto", "calgary", "victoria"],
  seeds = [1, 2, 3],
  count = 2,
  shard = 0,
  shards = 1,
  heldout = false,
} = {}) {
  if (typeof heldout !== "boolean") throw new Error("heldout must be true or false.");
  if (!["all", "city", "pairs", "hard"].includes(mode)) throw new Error("mode must be all, city, pairs or hard.");
  if (!Number.isSafeInteger(shards) || shards < 1 || !Number.isSafeInteger(shard) || shard < 0 || shard >= shards)
    throw new Error("shard must be a zero-based index below shards.");
  if (mode === "hard") {
    if (heldout) throw new Error("The hard city slice uses tuned routes.");
    return hardCityTasks(shard, shards);
  }
  // (held-out routes are the city suite on seeds no fix was tuned against; the covering rows keep their tuned seed)
  if (!Array.isArray(maps) || !maps.length || maps.some((m) => typeof m !== "string" || !m.trim()))
    throw new Error("maps must contain map preset ids.");
  if (new Set(maps).size !== maps.length) throw new Error("maps must be unique.");
  if (heldout) {
    if (mode === "pairs") throw new Error("held-out runs cover the city suite, not the covering rows.");
    return maps
      .map((map) => ({ id: `heldout/${map}`, map, ...heldoutPlan(map), heldout: true, options: { features: "city" } }))
      .filter((_, i) => i % shards === shard);
  }
  if (!Array.isArray(seeds) || !seeds.length || seeds.some((s) => !Number.isSafeInteger(s) || s < 0))
    throw new Error("seeds must be nonnegative integers.");
  if (new Set(seeds).size !== seeds.length) throw new Error("seeds must be unique.");
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("count must be a positive integer.");
  const tasks = [];
  if (mode !== "pairs")
    for (const map of maps)
      for (const seed of seeds)
        tasks.push({ id: `city/${map}/seed-${seed}`, map, seed, count, options: { features: "city" } });
  if (mode !== "city")
    for (const [cover, row] of coveringArray().entries())
      tasks.push({
        id: `${row.id}/${maps[0]}/seed-${seeds[0]}`,
        map: maps[0],
        seed: seeds[0],
        count,
        options: { features: "city", cover, without: row.without, ...(row.park ? { park: true } : {}) },
      });
  return tasks.filter((_, i) => i % shards === shard);
}

const NON_AUDITS = new Set(["simulation error", "stuck", "timeout", "collision"]);
export function classifyResults(results) {
  return {
    throws: results.filter((r) => r.simulation_error).map((r) => r.id),
    stuck: results.filter((r) => r.deadlocks > 0 || (!r.arrived && !r.simulation_error)).map((r) => r.id),
    collisions: results.filter((r) => r.collisions > 0).map((r) => r.id),
    audits: results.flatMap((r) => {
      const failures = r.failures.filter((f) => !NON_AUDITS.has(f));
      return failures.length ? [{ id: r.id, failures }] : [];
    }),
  };
}
export const soakFailed = (r) => !!(r.throws.length || r.stuck.length || r.collisions.length);

export function soakVerdict(task, run, categories, { hard, strict, requireCount } = {}) {
  const expected = task.only?.length ?? (task.heldout ? task.seeds.length * task.count : task.count);
  if (requireCount && run.results.length !== expected)
    throw new Error(`Expected ${expected} routes; completed ${run.results.length}.`);
  return hard
    ? checkHardRun(task, run)
    : !soakFailed(categories) && (!strict || run.results.every((r) => r.pass === true));
}

export function checkHardRun(task, run) {
  checkHardProvenance(task, run);
  if (run.config) checkHardConditions(task, run);
  return run.results.every((r) => r.pass === true);
}

export function soakCoverage(plan, outcomes) {
  const completed = new Map(outcomes.map(({ id, status }) => [id, status]));
  const legs = plan.map((task) => ({ ...task, status: completed.get(task.id) ?? "pending" }));
  const counts = Object.fromEntries(
    ["passed", "failed", "error", "pending"].map((status) => [
      status,
      legs.filter((task) => task.status === status).length,
    ]),
  );
  return { counts, legs };
}

function validateReusedRun(task, run, policy) {
  const invalid = (reason) => new Error(`Retry report cannot reuse ${task.id}: ${reason}`);
  if (
    run.harness_error ||
    run.stopped ||
    !run.config ||
    !Array.isArray(run.results) ||
    !run.results.length ||
    run.results.some(
      (r) =>
        typeof r?.id !== "string" ||
        !r.id.trim() ||
        typeof r.pass !== "boolean" ||
        typeof r.arrived !== "boolean" ||
        !Array.isArray(r.failures) ||
        r.pass !== (r.failures.length === 0) ||
        r.stopped,
    ) ||
    new Set(run.results.map(({ id }) => id)).size !== run.results.length
  )
    throw invalid("expected distinct, finished route results and their benchmark config.");

  for (const [key, value] of Object.entries(task))
    if (JSON.stringify(run[key]) !== JSON.stringify(value)) throw invalid(`saved task differs for ${key}.`);

  const hard = task.only !== undefined;
  if (!hard) {
    const expected = {
      brain: "rules",
      mode: "lockstep",
      map: task.map,
      weather: task.weather ?? "dry",
      seed: task.heldout ? task.seeds[0] : task.seed,
      count: task.heldout ? task.seeds.length * task.count : task.count,
      npcs: 40,
      heldout: task.heldout,
      seeds: task.seeds,
      cover: undefined,
      without: undefined,
      park: undefined,
      hour: undefined,
      track: undefined,
      stopped: undefined,
      ...benchmarkConfig({ features: "city", cover: task.options.cover }),
    };
    for (const [key, value] of Object.entries(expected))
      if (JSON.stringify(run.config[key]) !== JSON.stringify(value))
        throw invalid(`benchmark config differs for ${key}.`);
  }
  const passed = soakVerdict(task, run, classifyResults(run.results), {
    hard,
    strict: policy.audit_policy === "all drive verdicts count",
    requireCount: policy.require_count,
  });
  if (!passed) throw invalid("the saved results fail the soak verdict.");
}

export function retrySoakPlan(plan, prior, shard, shards, policy) {
  if (prior?.schema !== 1 || prior.shard !== shard || prior.shards !== shards)
    throw new Error("Retry report uses a different soak shard.");
  if (prior.audit_policy !== policy.audit_policy || prior.require_count !== policy.require_count)
    throw new Error("Retry report uses a different soak audit or route-count policy.");
  const history = prior.coverage?.legs;
  if (!Array.isArray(history) || history.length !== plan.length)
    throw new Error("Retry report needs a matching full shard plan from --coverage.");
  const byId = new Map();
  for (const leg of history) {
    if (!leg || byId.has(leg.id) || !["passed", "failed", "error", "pending"].includes(leg.status))
      throw new Error("Retry report contains an invalid or repeated leg.");
    byId.set(leg.id, leg);
  }
  for (const task of plan) {
    const previous = byId.get(task.id);
    if (!previous) throw new Error(`Retry report is missing ${task.id}.`);
    const { status: _status, ...conditions } = previous;
    if (JSON.stringify(conditions) !== JSON.stringify(task))
      throw new Error(`Retry report conditions differ for ${task.id}.`);
  }
  if (!Array.isArray(prior.runs)) throw new Error("Retry report is missing its run evidence.");
  const passed = [];
  const eligible = plan.filter((task) => {
    if (byId.get(task.id).status !== "passed") return true;
    const matches = prior.runs.filter((run) => run?.id === task.id);
    if (matches.length !== 1) throw new Error(`Retry report needs one passed run for ${task.id}.`);
    validateReusedRun(task, matches[0], policy);
    passed.push(matches[0]);
    return false;
  });
  return { eligible, passed };
}

async function main() {
  const parsed = parseOptions(process.argv.slice(2), VALUE_OPTIONS, FLAG_OPTIONS);
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  const args = parsed.args;
  const port = loopbackPort(args.port ?? process.env.PORT ?? "8331");
  if (args.heldout !== undefined && !["0", "1"].includes(args.heldout)) throw new Error("--heldout must be 0 or 1.");
  const timeoutMs = wholeNumber("timeout", args.timeout, DEFAULT_TIMEOUT_MS, { min: 1, max: 2 ** 31 - 1 });
  if (args.weather && !Object.hasOwn(WEATHER, args.weather))
    throw new Error(`Unknown weather "${args.weather}": use ${Object.keys(WEATHER).join(", ")}.`);
  if (args.json || args["retry-from"]) checkFiles({ "retry-from": args["retry-from"] }, { json: args.json });
  const heldout = args.heldout === "1";
  const hard = args.mode === "hard";
  if (heldout && (args.seeds !== undefined || args.count !== undefined))
    throw new Error("--heldout sets the seeds and routes: drop --seeds and --count.");
  if (hard && ["maps", "seeds", "count", "weather"].some((key) => args[key] !== undefined))
    throw new Error("--mode hard sets the conditions: drop --maps, --seeds, --count and --weather.");
  const shard = wholeNumber("shard", args.shard, 0);
  const shards = wholeNumber("shards", args.shards, 1, { min: 1 });
  const seeds = commaList("seeds", args.seeds)?.map((s) => wholeNumber("seeds", s));
  if (seeds && new Set(seeds).size !== seeds.length) throw new Error("--seeds contains duplicate seeds.");
  const planned = soakPlan({
    mode: args.mode ?? (heldout ? "city" : undefined),
    maps: commaList("maps", args.maps) ?? undefined,
    seeds,
    count: wholeNumber("count", args.count, 2, { min: 1 }),
    shard,
    shards,
    heldout,
  });
  const only = commaList("only", args.only);
  const skip = commaList("skip", args.skip);
  const unknown = [...(only || []), ...(skip || [])].filter((id) => !planned.some((task) => task.id === id));
  if (unknown.length) throw new Error(`Unknown configurations in shard ${shard}: ${unknown.join(", ")}.`);
  if (only && skip && only.some((id) => skip.includes(id))) throw new Error("--only and --skip overlap.");
  const auditPolicy =
    hard || args["fail-on-audit"]
      ? "all drive verdicts count"
      : "report-only; throws, deadlocks/timeouts and collisions fail";
  const policy = { audit_policy: auditPolicy, require_count: Boolean(args["require-count"]) };
  const plan = planned.map((task) => ({ ...task, weather: task.weather || args.weather || "dry" }));
  const { eligible, passed } = args["retry-from"]
    ? retrySoakPlan(plan, readJson(args["retry-from"]), shard, shards, policy)
    : { eligible: plan, passed: [] };
  const tasks = eligible.filter(({ id }) => (!only || only.includes(id)) && !skip?.includes(id));
  if (args["dry-run"] || args.list) {
    const listed = tasks.map((task) => ({
      configuration: task.id,
      map: task.map,
      weather: task.weather || args.weather || "dry",
      ...(task.heldout
        ? { heldout: true, seeds: task.seeds, count: task.count }
        : { seed: task.seed, count: task.count }),
      ...(task.only ? { only: task.only, route_sha: task.route_sha, map_sha: task.map_sha, npcs: task.npcs } : {}),
      options: task.options,
    }));
    console.log(JSON.stringify({ shard, shards, configurations: listed.length, tasks: listed }, null, 2));
    return 0;
  }

  if (tasks.length) await benchPage(port);
  const say = args.quiet ? () => {} : console.log;

  const directory = tasks.length ? await mkdtemp(join(tmpdir(), "jev-soak-")) : null;
  const runs = [];
  const outcomes = passed.map(({ id }) => ({ id, status: "passed" }));
  const killGraceMs = Math.min(5000, Math.max(200, timeoutMs));
  let failed = false;
  try {
    for (const [index, task] of tasks.entries()) {
      const path = join(directory, `${index}.json`),
        options = task.options,
        weather = task.weather || args.weather || "dry";
      const command = [
        "--experimental-default-type=module",
        fileURLToPath(new URL("bench_node.mjs", import.meta.url)),
        "--port",
        String(port),
        "--map",
        task.map,
        ...(task.heldout ? ["--heldout", "1"] : ["--seed", String(task.seed), "--count", String(task.count)]),
        "--features",
        "city",
        "--weather",
        weather,
        "--diagnostics",
        "1",
        ...(args.quiet ? ["--quiet"] : []),
        "--json",
        path,
        ...(options.cover !== undefined ? ["--cover", String(options.cover)] : []),
        ...(hard
          ? [
              "--hour",
              String(options.hour),
              "--park",
              options.park ? "1" : "0",
              "--npcs",
              String(task.npcs),
              "--only",
              task.only.join(","),
            ]
          : []),
      ];
      if (args.progress) console.error(`[${index + 1}/${tasks.length}] Starting ${task.id}`);
      say(
        JSON.stringify({
          configuration: task.id,
          ...task,
          weather,
          on: FEATURE_NAMES.filter((n) => (n !== "park" ? !options.without?.includes(n) : !!options.park)),
        }),
      );
      try {
        const outcome = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, command, { stdio: ["ignore", "pipe", "pipe"] });
          if (args.quiet) child.stdout.resume();
          else child.stdout.pipe(process.stdout, { end: false });
          let stderrTail = "";
          child.stderr.on("data", (chunk) => {
            process.stderr.write(chunk);
            stderrTail += chunk.toString("utf8");
            if (stderrTail.length > STDERR_TAIL_CHARS) stderrTail = stderrTail.slice(-STDERR_TAIL_CHARS);
          });
          let timedOut = false;
          let killTimer = null;
          const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => {
              child.kill("SIGKILL");
            }, killGraceMs);
          }, timeoutMs);
          const clearTimers = () => {
            clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
          };
          child.on("error", (error) => {
            clearTimers();
            reject(error);
          });
          child.on("close", (status, signal) => {
            clearTimers();
            resolve({ code: signal ? `signal ${signal}` : status, timedOut, stderrTail: stderrTail.trim() });
          });
        });
        if (outcome.timedOut || outcome.code !== 0) {
          const reason = outcome.timedOut
            ? `Benchmark process timed out after ${timeoutMs}ms (exited ${outcome.code}).`
            : `Benchmark process exited ${outcome.code}.`;
          throw new Error(outcome.stderrTail ? `${reason} stderr: ${outcome.stderrTail}` : reason);
        }
        let run;
        try {
          run = JSON.parse(await readFile(path, "utf8"));
        } catch (error) {
          throw new Error(`Benchmark finished without a readable report: ${error.message}`, { cause: error });
        }
        if (!Array.isArray(run?.results) || !run.results.length)
          throw new Error("Benchmark finished without any route results.");
        const categories = classifyResults(run.results);
        const passed = soakVerdict(task, run, categories, {
          hard,
          strict: args["fail-on-audit"],
          requireCount: args["require-count"],
        });
        failed ||= !passed;
        outcomes.push({ id: task.id, status: passed ? "passed" : "failed" });
        const record = {
          ...task,
          suite_version: run.suite_version,
          ...(hard ? { manifest: run.manifest } : {}),
          config: run.config,
          ...categories,
          results: run.results,
        };
        runs.push(record);
        say(JSON.stringify({ configuration: task.id, ...categories }));
        for (const r of run.results.filter((r) => !r.pass || r.deadlocks))
          say(
            JSON.stringify({ configuration: task.id, route: r.id, failures: r.failures, diagnostics: r.diagnostics }),
          );
      } catch (error) {
        failed = true;
        outcomes.push({ id: task.id, status: "error" });
        runs.push({ ...task, harness_error: error.message });
        console.error(JSON.stringify({ configuration: task.id, harness_error: error.message }));
      }
      if (failed && args["fail-fast"]) break;
    }
    const coverage = args.coverage || args["retry-from"] ? soakCoverage(plan, outcomes) : null;
    const byId = new Map([...passed, ...runs].map((run) => [run.id, run]));
    const report = {
      schema: 1,
      suite_version: "custom",
      ...(hard ? { slice: hardCity.id } : { weather: args.weather || "dry" }),
      shard,
      shards,
      ...(heldout ? { heldout: true } : {}),
      audit_policy: auditPolicy,
      ...(coverage ? { coverage, require_count: policy.require_count } : {}),
      failed,
      ...(runs.length < tasks.length ? { skipped: tasks.slice(runs.length).map(({ id }) => id) } : {}),
      runs: plan.flatMap(({ id }) => (byId.has(id) ? [byId.get(id)] : [])),
    };
    if (args.json) writeArtifact(args.json, JSON.stringify(report, null, 1), { gzip: args.json.endsWith(".gz") });
    console.log(
      JSON.stringify({
        configurations: runs.length,
        ...(passed.length ? { reused: passed.length } : {}),
        failed,
        audit_policy: auditPolicy,
        ...(coverage ? { coverage: coverage.counts } : {}),
        ...(report.skipped ? { skipped: report.skipped } : {}),
      }),
    );
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  return failed ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.stdout.write("", () => process.exit(code)))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
