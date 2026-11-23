// Weekly interaction probe. Small two-route suites keep each shard bounded; all 13 covering rows
// run on the first map/seed, and city runs the map × seed product. Examples:
// node --experimental-default-type=module scripts/soak.mjs --port 8381 --mode pairs --maps kitsilano --seeds 1
// node --experimental-default-type=module scripts/soak.mjs --port 8381 --maps kitsilano,toronto,calgary,victoria --seeds 1,2,3 --shard 0 --shards 8 --json soak.json
// --heldout 1 runs each map's held-out routes instead (bench/heldout.js, city only, one configuration
// per map, labelled heldout/<map>); report them apart and never debug against them (docs/rules-baseline.md).
// --mode hard runs the fixed hard city slice without sampling or changing its conditions.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { benchPage, loopbackPort, parseOptions } from "./cli_tools.mjs";

// freeDriveOptions' imports use common.js, which reads the token at module load.
globalThis.document = { querySelector: () => null };
const { coveringArray, FEATURE_NAMES } = await import("../static/js/bench/features.js");
const { heldoutPlan } = await import("../static/js/bench/heldout.js");
const hardCity = JSON.parse(await readFile(new URL("../data/suites/hard-city-v1.json", import.meta.url), "utf8"));

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
];
const FLAG_OPTIONS = ["dry-run", "list"];
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
  "  --json <path>                 write soak report JSON",
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
  if (!["all", "city", "pairs", "hard"].includes(mode)) throw new Error("mode must be all, city, pairs or hard.");
  if (!Number.isInteger(shards) || shards < 1 || !Number.isInteger(shard) || shard < 0 || shard >= shards)
    throw new Error("shard must be a zero-based index below shards.");
  if (mode === "hard") {
    if (heldout) throw new Error("The hard city slice uses tuned routes.");
    return hardCity.legs
      .map(({ id, weather, hour, park, only }) => ({
        id,
        weather,
        only,
        route_sha: hardCity.route_sha,
        map_sha: hardCity.map_sha,
        map: hardCity.map,
        seed: hardCity.seed,
        count: hardCity.count,
        npcs: hardCity.npcs,
        options: { features: "city", hour, park },
      }))
      .filter((_, i) => i % shards === shard);
  }
  // (held-out routes are the city suite on seeds no fix was tuned against; the covering rows keep their tuned seed)
  if (heldout) {
    if (mode === "pairs") throw new Error("held-out runs cover the city suite, not the covering rows.");
    if (!maps.length || maps.some((m) => typeof m !== "string" || !m.trim()))
      throw new Error("maps must contain map preset ids.");
    return maps
      .map((map) => ({ id: `heldout/${map}`, map, ...heldoutPlan(map), heldout: true, options: { features: "city" } }))
      .filter((_, i) => i % shards === shard);
  }
  if (!maps.length || maps.some((m) => typeof m !== "string" || !m.trim()))
    throw new Error("maps must contain map preset ids.");
  if (!seeds.length || seeds.some((s) => !Number.isSafeInteger(s) || s < 0))
    throw new Error("seeds must be nonnegative integers.");
  if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer.");
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

export function checkHardRun(task, run) {
  if (run.manifest?.maps?.[task.map]?.fingerprint !== task.map_sha)
    throw new Error(`${task.id}: map fingerprint changed from the slice definition.`);
  if (run.manifest?.suite?.route_sha !== task.route_sha)
    throw new Error(`${task.id}: route fingerprint changed from the slice definition.`);
  if (run.results.map((r) => r.id).join(",") !== task.only.join(","))
    throw new Error(`${task.id}: results do not cover the fixed route IDs.`);
  return run.results.every((r) => r.pass === true);
}

async function main() {
  const parsed = parseOptions(process.argv.slice(2), VALUE_OPTIONS, FLAG_OPTIONS);
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  const args = parsed.args;
  const port = loopbackPort(args.port ?? process.env.PORT ?? "8331");
  const integer = (s, fallback) => (s === undefined ? fallback : /^\d+$/.test(s) ? Number(s) : NaN);
  if (args.heldout !== undefined && !["0", "1"].includes(args.heldout)) throw new Error("--heldout must be 0 or 1.");
  const timeoutMs = integer(args.timeout, DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2 ** 31 - 1)
    throw new Error("--timeout must be a positive number of milliseconds.");
  const heldout = args.heldout === "1";
  const hard = args.mode === "hard";
  if (heldout && (args.seeds !== undefined || args.count !== undefined))
    throw new Error("--heldout sets the seeds and routes: drop --seeds and --count.");
  if (hard && ["maps", "seeds", "count", "weather"].some((key) => args[key] !== undefined))
    throw new Error("--mode hard sets the conditions: drop --maps, --seeds, --count and --weather.");
  const shard = integer(args.shard, 0);
  const shards = integer(args.shards, 1);
  const tasks = soakPlan({
    mode: args.mode ?? (heldout ? "city" : undefined),
    maps: args.maps?.split(","),
    seeds: args.seeds?.split(",").map((s) => integer(s)),
    count: integer(args.count, 2),
    shard,
    shards,
    heldout,
  });
  if (args["dry-run"] || args.list) {
    const listed = tasks.map((task) => ({
      configuration: task.id,
      map: task.map,
      weather: task.weather || args.weather || "dry",
      ...(task.heldout
        ? { heldout: true, seeds: task.seeds, count: task.count }
        : { seed: task.seed, count: task.count }),
      ...(task.only ? { only: task.only } : {}),
      options: task.options,
    }));
    console.log(JSON.stringify({ shard, shards, configurations: listed.length, tasks: listed }, null, 2));
    return 0;
  }

  await benchPage(port);

  const directory = await mkdtemp(join(tmpdir(), "jev-soak-")),
    runs = [];
  const auditPolicy = hard ? "all drive verdicts count" : "report-only; throws, deadlocks/timeouts and collisions fail";
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
      console.log(
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
          child.stdout.pipe(process.stdout);
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
        const run = JSON.parse(await readFile(path, "utf8"));
        const categories = classifyResults(run.results);
        const passed = hard ? checkHardRun(task, run) : !soakFailed(categories);
        failed ||= !passed;
        const record = {
          ...task,
          suite_version: run.suite_version,
          ...(hard ? { manifest: run.manifest } : {}),
          config: run.config,
          ...categories,
          results: run.results,
        };
        runs.push(record);
        console.log(JSON.stringify({ configuration: task.id, ...categories }));
        for (const r of run.results.filter((r) => !r.pass || r.deadlocks))
          console.log(
            JSON.stringify({ configuration: task.id, route: r.id, failures: r.failures, diagnostics: r.diagnostics }),
          );
      } catch (error) {
        failed = true;
        runs.push({ ...task, harness_error: error.message });
        console.error(JSON.stringify({ configuration: task.id, harness_error: error.message }));
      }
    }
    const report = {
      schema: 1,
      suite_version: "custom",
      ...(hard ? { slice: hardCity.id } : { weather: args.weather || "dry" }),
      shard,
      shards,
      ...(heldout ? { heldout: true } : {}),
      audit_policy: auditPolicy,
      failed,
      runs,
    };
    if (args.json) await writeFile(args.json, JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ configurations: runs.length, failed, audit_policy: auditPolicy }));
  } finally {
    await rm(directory, { recursive: true, force: true });
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
