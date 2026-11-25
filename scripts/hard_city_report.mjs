// Consolidate the fixed slice's soak artifacts without running or replaying any drives.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import hardCity from "../data/suites/hard-city-v1.json" with { type: "json" };
import { driveScores } from "../static/js/bench/scores.js";
import { checkFiles, readJson, writeArtifact } from "./cli_tools.mjs";

const equalList = (left, right) =>
  Array.isArray(left) && left.length === right.length && right.every((value, index) => left[index] === value);

export function hardCityTasks(shard, shards) {
  return hardCity.legs
    .filter((_, index) => index % shards === shard)
    .map(({ id, weather, hour, park, only }) => ({
      id,
      weather,
      only: [...only],
      route_sha: hardCity.route_sha,
      map_sha: hardCity.map_sha,
      map: hardCity.map,
      seed: hardCity.seed,
      count: hardCity.count,
      npcs: hardCity.npcs,
      options: { features: "city", hour, park },
    }));
}

export function checkHardProvenance(task, run) {
  if (run.manifest?.maps?.[task.map]?.fingerprint !== task.map_sha)
    throw new Error(`${task.id}: map fingerprint changed from the slice definition.`);
  if (run.manifest?.suite?.route_sha !== task.route_sha)
    throw new Error(`${task.id}: route fingerprint changed from the slice definition.`);
  if (
    !equalList(
      run.results?.map((r) => r?.id),
      task.only,
    )
  )
    throw new Error(`${task.id}: results do not cover the fixed route IDs.`);
}

export function checkHardConditions(task, run) {
  const config = run.config || {};
  const expected = {
    brain: "rules",
    mode: "lockstep",
    map: task.map,
    seed: task.seed,
    count: task.count,
    npcs: task.npcs,
    features: "city",
    weather: task.weather,
    hour: task.options.hour,
    park: task.options.park,
    track: "guarded",
  };
  // Default hour, parking and track are omitted in a normal saved config.
  const actual = { hour: 15.5, park: false, track: "guarded", ...config };
  for (const [key, value] of Object.entries(expected))
    if (actual[key] !== value) throw new Error(`${task.id}: expected ${key}=${value}, got ${actual[key]}.`);
  for (const key of ["cover", "heldout", "stopped"])
    if (actual[key] !== undefined) throw new Error(`${task.id}: unexpected ${key} option.`);
  if (actual.without !== undefined && !equalList(actual.without, []))
    throw new Error(`${task.id}: fixed drives require all city features.`);
  if (run.stopped) throw new Error(`${task.id}: the run stopped early.`);
  if (run.manifest.suite.kind !== "bench" || !equalList(run.manifest.suite.ids, task.only))
    throw new Error(`${task.id}: manifest does not identify the fixed benchmark routes.`);
}

function routeEvidence(result) {
  return {
    id: result.id,
    pass: result.pass,
    arrived: result.arrived,
    failures: [...result.failures],
    ...(result.simulation_error ? { simulation_error: result.simulation_error } : {}),
    ...(result.parked !== undefined ? { parked: result.parked } : {}),
    ...(result.no_space === true ? { no_space: true } : {}),
    ...(Number.isFinite(result.time_s) ? { time_s: result.time_s } : {}),
    ...(Number.isFinite(result.min_ttc_s) ? { min_ttc_s: result.min_ttc_s } : {}),
    ...(Number.isFinite(result.safety_brakes) ? { safety_brakes: result.safety_brakes } : {}),
    score: driveScores(result).score,
  };
}

export function hardCityReport(reports) {
  const expected = hardCityTasks(0, 1);
  const found = new Map();
  const shards = new Set();
  let shardCount;
  for (const [index, report] of reports.entries()) {
    const source = `Report ${index + 1}`;
    if (report?.schema !== 1 || report.slice !== hardCity.id)
      throw new Error(`${source} is not a ${hardCity.id} soak artifact.`);
    if (
      !Number.isSafeInteger(report.shards) ||
      report.shards < 1 ||
      !Number.isSafeInteger(report.shard) ||
      report.shard < 0 ||
      report.shard >= report.shards
    )
      throw new Error(`${source} has an invalid shard assignment.`);
    if (shardCount !== undefined && report.shards !== shardCount)
      throw new Error(`${source} declares a different total number of shards.`);
    shardCount = report.shards;
    if (shards.has(report.shard)) throw new Error(`${source} repeats shard ${report.shard}.`);
    shards.add(report.shard);
    if (!Array.isArray(report.runs) || (report.skipped !== undefined && !Array.isArray(report.skipped)))
      throw new Error(`${source} needs runs and an optional skipped array.`);
    const assigned = new Map(hardCityTasks(report.shard, report.shards).map((task) => [task.id, task]));
    const claim = (id) => {
      if (!assigned.has(id)) throw new Error(`${source} includes unknown or out-of-shard leg ${id}.`);
      if (found.has(id)) throw new Error(`${source} repeats leg ${id}.`);
      return assigned.get(id);
    };
    for (const run of report.runs) {
      const task = claim(run?.id);
      if (run.harness_error !== undefined) {
        if (typeof run.harness_error !== "string" || !run.harness_error.trim() || run.results !== undefined)
          throw new Error(`${run.id}: invalid harness error record.`);
        found.set(run.id, { status: "error", error: run.harness_error });
        continue;
      }
      if (!Array.isArray(run.results)) throw new Error(`${run.id}: missing results.`);
      checkHardProvenance(task, run);
      checkHardConditions(task, run);
      for (const result of run.results) {
        if (
          typeof result.pass !== "boolean" ||
          typeof result.arrived !== "boolean" ||
          !Array.isArray(result.failures) ||
          result.failures.some((reason) => typeof reason !== "string")
        )
          throw new Error(`${run.id}: malformed verdict for ${result.id}.`);
        if (result.pass !== (result.arrived && !result.failures.length && !result.simulation_error))
          throw new Error(`${run.id}: inconsistent verdict for ${result.id}.`);
      }
      const status = run.results.every((r) => r.pass) ? "pass" : "fail";
      found.set(run.id, { status, routes: run.results.map(routeEvidence) });
    }
    for (const id of report.skipped || []) {
      claim(id);
      found.set(id, { status: "skipped" });
    }
  }
  const legs = expected.map(({ id, weather, options, only }) => ({
    id,
    weather,
    hour: options.hour,
    park: options.park,
    expected_routes: only,
    ...(found.get(id) || { status: "missing" }),
  }));
  const counts = Object.fromEntries(
    ["pass", "fail", "error", "skipped", "missing"].map((status) => [
      status,
      legs.filter((leg) => leg.status === status).length,
    ]),
  );
  return {
    slice: hardCity.id,
    map: hardCity.map,
    seed: hardCity.seed,
    map_sha: hardCity.map_sha,
    route_sha: hardCity.route_sha,
    shards_received: [...shards].sort((a, b) => a - b),
    shards_expected: shardCount ?? null,
    complete: counts.skipped === 0 && counts.missing === 0,
    passed: counts.pass === legs.length,
    counts,
    legs,
  };
}

function markdownCell(value) {
  return String(value)
    .replace(/[\r\n]+/g, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;");
}

export function hardCityMarkdown(report) {
  return [
    `# ${report.slice}`,
    "",
    `${report.map} · seed ${report.seed} · ${report.counts.pass}/${report.legs.length} legs passed`,
    "",
    "| Leg | Weather | Hour | Parking | Routes | Status | Evidence |",
    "|---|---|---:|---|---|---|---|",
    ...report.legs.map((leg) => {
      const evidence =
        leg.error ??
        leg.routes
          ?.map((route) => {
            const parking = route.no_space ? " · no parking space" : route.parked === true ? " · parked" : "";
            return `${route.id} ${route.pass ? "passed" : route.failures.join(", ") || "failed"}${parking}${route.time_s === undefined ? "" : ` · ${route.time_s} s`}${route.simulation_error ? ` · ${route.simulation_error}` : ""}`;
          })
          .join("; ") ??
        "";
      return `| ${[leg.id, leg.weather, leg.hour, leg.park ? "yes" : "no", leg.expected_routes.join(", "), leg.status, evidence].map(markdownCell).join(" | ")} |`;
    }),
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values, positionals } = parseArgs({
      options: {
        help: { type: "boolean", short: "h" },
        format: { type: "string", default: "json" },
        output: { type: "string" },
        check: { type: "boolean" },
      },
      allowPositionals: true,
    });
    const usage =
      "Usage: node scripts/hard_city_report.mjs [--format json|markdown] [--output path[.gz]] [--check] SOAK.json[.gz] ...";
    if (values.help) console.log(usage);
    else {
      if (!positionals.length) throw new Error(usage);
      if (!["json", "markdown"].includes(values.format)) throw new Error("--format must be json or markdown.");
      if (values.output === "") throw new Error("--output needs a path.");
      checkFiles(Object.fromEntries(positionals.map((file, index) => [`input-${index + 1}`, file])), {
        output: values.output,
      });
      const report = hardCityReport(positionals.map(readJson));
      const content = values.format === "markdown" ? hardCityMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`;
      if (values.output) writeArtifact(values.output, content, { gzip: values.output.endsWith(".gz") });
      else process.stdout.write(content);
      if (values.check && !report.passed) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
