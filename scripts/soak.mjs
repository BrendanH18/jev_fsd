// Weekly interaction probe. Small two-route suites keep each shard bounded; all 13 covering rows
// run on the first map/seed, and city runs the map × seed product. Examples:
// node --experimental-default-type=module scripts/soak.mjs --port 8381 --mode pairs --maps kitsilano --seeds 1
// node --experimental-default-type=module scripts/soak.mjs --port 8381 --maps kitsilano,toronto,calgary,victoria --seeds 1,2,3 --shard 0 --shards 8 --json soak.json
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// freeDriveOptions' imports use common.js, which reads the token at module load.
globalThis.document = { querySelector: () => null };
const { coveringArray, FEATURE_NAMES } = await import("../static/js/bench/features.js");
export function soakPlan({ mode = "all", maps = ["kitsilano", "toronto", "calgary", "victoria"], seeds = [1, 2, 3], count = 2, shard = 0, shards = 1 } = {}) {
  if (!["all", "city", "pairs"].includes(mode)) throw new Error("mode must be all, city or pairs.");
  if (!maps.length || maps.some(m => typeof m !== "string" || !m.trim())) throw new Error("maps must contain map preset ids.");
  if (!seeds.length || seeds.some(s => !Number.isSafeInteger(s) || s < 0)) throw new Error("seeds must be nonnegative integers.");
  if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer.");
  if (!Number.isInteger(shards) || shards < 1 || !Number.isInteger(shard) || shard < 0 || shard >= shards) throw new Error("shard must be a zero-based index below shards.");
  const tasks = [];
  if (mode !== "pairs") for (const map of maps) for (const seed of seeds) tasks.push({ id: `city/${map}/seed-${seed}`, map, seed, count, options: { features: "city" } });
  if (mode !== "city") for (const [cover, row] of coveringArray().entries()) tasks.push({
    id: `${row.id}/${maps[0]}/seed-${seeds[0]}`, map: maps[0], seed: seeds[0], count,
    options: { features: "city", cover, without: row.without, ...(row.park ? { park: true } : {}) },
  });
  return tasks.filter((_, i) => i % shards === shard);
}

const NON_AUDITS = new Set(["simulation error", "stuck", "timeout", "collision"]);
export function classifyResults(results) {
  return {
    throws: results.filter(r => r.simulation_error).map(r => r.id),
    stuck: results.filter(r => r.deadlocks > 0 || (!r.arrived && !r.simulation_error)).map(r => r.id),
    collisions: results.filter(r => r.collisions > 0).map(r => r.id),
    audits: results.flatMap(r => { const failures = r.failures.filter(f => !NON_AUDITS.has(f)); return failures.length ? [{ id: r.id, failures }] : []; }),
  };
}
export const soakFailed = r => !!(r.throws.length || r.stuck.length || r.collisions.length);

async function main() {
  const args = {}, allowed = ["port", "mode", "maps", "seeds", "count", "shard", "shards", "weather", "json"];
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i].slice(2), value = process.argv[i + 1];
    if (!process.argv[i].startsWith("--") || !allowed.includes(name) || value === undefined || value.startsWith("--")) throw new Error(`Invalid soak option ${process.argv[i]} (expected --${allowed.join(", --")} and a value).`);
    args[name] = value;
  }
  const integer = (s, fallback) => s === undefined ? fallback : /^\d+$/.test(s) ? Number(s) : NaN;
  const tasks = soakPlan({ mode: args.mode, maps: args.maps?.split(","), seeds: args.seeds?.split(",").map(s => integer(s)),
    count: integer(args.count, 2), shard: integer(args.shard, 0), shards: integer(args.shards, 1) });
  const directory = await mkdtemp(join(tmpdir(), "jev-soak-")), runs = [];
  let failed = false;
  try {
    for (const [index, task] of tasks.entries()) {
      const path = join(directory, `${index}.json`), options = task.options;
      const command = ["--experimental-default-type=module", fileURLToPath(new URL("bench_node.mjs", import.meta.url)),
        "--port", args.port || process.env.PORT || "8331", "--map", task.map, "--seed", String(task.seed), "--count", String(task.count),
        "--features", "city", "--weather", args.weather || "dry", "--diagnostics", "1", "--json", path,
        ...(options.cover !== undefined ? ["--cover", String(options.cover)] : [])];
      console.log(JSON.stringify({ configuration: task.id, ...task, weather: args.weather || "dry",
        on: FEATURE_NAMES.filter(n => n !== "park" ? !options.without?.includes(n) : !!options.park) }));
      let code;
      try {
        code = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, command, { stdio: ["ignore", "pipe", "pipe"] });
          child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
          const timer = setTimeout(() => { child.kill("SIGTERM"); }, 20 * 60 * 1000);
          child.on("error", error => { clearTimeout(timer); reject(error); });
          child.on("close", (status, signal) => { clearTimeout(timer); resolve(signal ? `signal ${signal}` : status); });
        });
        if (code !== 0) throw new Error(`Benchmark process exited ${code}.`);
        const run = JSON.parse(await readFile(path, "utf8"));
        const categories = classifyResults(run.results);
        failed ||= soakFailed(categories);
        const record = { ...task, config: run.config, ...categories, results: run.results };
        runs.push(record);
        console.log(JSON.stringify({ configuration: task.id, ...categories }));
        for (const r of run.results.filter(r => !r.pass || r.deadlocks)) console.log(JSON.stringify({ configuration: task.id, route: r.id,
          failures: r.failures, diagnostics: r.diagnostics }));
      } catch (error) {
        failed = true;
        runs.push({ ...task, harness_error: error.message });
        console.error(JSON.stringify({ configuration: task.id, harness_error: error.message }));
      }
    }
    const report = { schema: 1, weather: args.weather || "dry", shard: integer(args.shard, 0), shards: integer(args.shards, 1),
      audit_policy: "report-only; throws, deadlocks/timeouts and collisions fail", failed, runs };
    if (args.json) await writeFile(args.json, JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ configurations: runs.length, failed, audit_policy: report.audit_policy }));
  } finally { await rm(directory, { recursive: true, force: true }); }
  return failed ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => process.stdout.write("", () => process.exit(code))).catch(error => { console.error(error.message); process.exit(1); });
}
