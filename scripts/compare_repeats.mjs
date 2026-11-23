// Summarise repeated arena recordings without calling a model.
// node --experimental-default-type=module scripts/compare_repeats.mjs [--plan FILE] tape1.json.gz tape2.json.gz [...]
import { hash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { decidedByTotals } from "../static/js/bench/metrics.js";
import { driverScores, driveScores, SCORES_VERSION } from "../static/js/bench/scores.js";
import { suiteVersion } from "../static/js/bench/suite-version.js";
import { canonicalJson, driverKind, ModelRecording } from "../static/js/brain/recording.js";
import { authoredDrive } from "./canonical_suite.mjs";
import { runCost } from "./run_manifest.mjs";

// Audit counters and sampled durations from DriveMetrics.summary. Keep each metric in its saved unit.
const AUDIT_FIELDS = [
  "collisions",
  "at_fault",
  "red_lights",
  "amber_lights_run",
  "stop_signs",
  "failed_to_yield",
  "off_road_s",
  "plow_right_passes",
  "merge_cut_ins",
  "close_passes",
  "bus_lane_driving",
  "glare_seconds",
  "glare_speeding_seconds",
  "pxo_early_goes",
  "illegal_turns",
  "hump_hits",
  "crew_close_passes",
  "guard_violations",
  "contraflow_conflicts",
  "fresh_green_conflicts",
  "reversing_conflicts",
  "pothole_hits",
  "ball_warnings_ignored",
  "wildlife_conflicts",
  "brake_checks",
  "ice_overspeed",
  "snowbank_conflicts",
  "pedestrians_splashed",
  "parking_conflicts",
  "closure_entries",
  "officer_violations",
];

function providerOptions(request) {
  const { messages: _messages, system: _system, ...settings } = request;
  const format = settings.response_format;
  if (format?.type === "json_schema" && format.json_schema?.name === "driving_decision") {
    // Jev FSD generates new option enums for every request. Compare the format settings only.
    const { schema: _schema, ...fixedSchema } = format.json_schema;
    settings.response_format = { ...format, json_schema: fixedSchema };
  }
  return canonicalJson(settings);
}

function readPlan(path) {
  try {
    const plan = JSON.parse(readFileSync(path, "utf8"));
    if (
      plan?.format !== "jev-arena-repeat-plan/1" ||
      !/^v[1-9]\d*$/.test(plan.suite_version) ||
      !["guarded", "open"].includes(plan.track) ||
      !Number.isSafeInteger(plan.repeats_per_driver) ||
      plan.repeats_per_driver < 2 ||
      (plan.source_commit !== undefined && !/^[a-f0-9]{40}$/.test(plan.source_commit)) ||
      (plan.engine !== undefined && (typeof plan.engine !== "string" || !plan.engine)) ||
      !plan.drivers ||
      typeof plan.drivers !== "object" ||
      Array.isArray(plan.drivers) ||
      !Object.keys(plan.drivers).length
    )
      throw new Error("invalid arena repeat plan");
    for (const [driver, settings] of Object.entries(plan.drivers))
      if (
        !driverKind(driver) ||
        !settings ||
        typeof settings !== "object" ||
        Array.isArray(settings) ||
        Object.values(settings).some((value) => typeof value !== "string" || !value) ||
        Object.keys(settings).some((key) => !["model", "provider_url", "effort"].includes(key))
      )
        throw new Error(`invalid settings for ${driver}`);
    const suite = JSON.parse(
      readFileSync(new URL(`../data/suites/${plan.suite_version}.json`, import.meta.url), "utf8"),
    );
    return { ...plan, suite };
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

function requirePlan(runs, groups, plan) {
  const { suite, drivers, repeats_per_driver: count } = plan;
  if (groups.size !== Object.keys(drivers).length || Object.keys(drivers).some((id) => !groups.has(id)))
    throw new Error(`The repeat plan requires exactly these drivers: ${Object.keys(drivers).join(", ")}.`);
  const wantMaps = canonicalJson(suite.maps);
  const wantDrives = canonicalJson(suite.arena.drives);
  for (const run of runs) {
    if (
      run.suite_version !== suite.version ||
      run.track !== plan.track ||
      run.set !== "all" ||
      run.manifest?.track !== run.track ||
      run.manifest?.driver !== run.driver ||
      run.manifest?.engine !== run.engine ||
      !run.lockstep ||
      canonicalJson(run.maps) !== wantMaps ||
      canonicalJson(run.authored_drives) !== wantDrives
    )
      throw new Error(`${run.path} must cover the complete ${suite.version} arena on the ${plan.track} track.`);
    if ((plan.source_commit && run.source !== plan.source_commit) || (plan.engine && run.engine !== plan.engine))
      throw new Error(`${run.path} needs the source and engine declared by the repeat plan.`);
  }
  for (const [driver, repeats] of groups) {
    if (repeats.length !== count) throw new Error(`The repeat plan requires ${count} recordings for ${driver}.`);
    const { model, provider_url, effort } = drivers[driver];
    for (const run of repeats) {
      const settings = JSON.parse(run.provider_settings);
      if (
        (model && run.model !== model) ||
        (provider_url && settings?.url !== provider_url) ||
        (effort && settings?.output_config?.effort !== effort)
      )
        throw new Error(`${run.path} needs the model and provider settings declared for ${driver}.`);
    }
  }
}

function readRepeat(path) {
  let recording;
  try {
    const raw = readFileSync(path);
    const text = path.endsWith(".gz") ? gunzipSync(raw) : raw;
    recording = ModelRecording.parse(text.toString("utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
  const { header, results } = recording;
  const track = header.arena?.track || "guarded";
  if (!header.arena) throw new Error(`${path} is a benchmark recording. Use arena recordings for this report.`);
  const drives = Object.values(results).sort((a, b) => a.challenge.localeCompare(b.challenge));
  const plan = header.arena.ids;
  const planned = new Set(Array.isArray(plan) ? plan : []);
  if (
    !drives.length ||
    planned.size !== plan?.length ||
    planned.size !== drives.length ||
    Object.keys(recording.drives).length !== drives.length ||
    drives.some(
      (drive) =>
        !planned.delete(drive.challenge) ||
        drive.stopped ||
        results[drive.challenge] !== drive ||
        !Object.hasOwn(recording.drives, drive.challenge),
    )
  )
    throw new Error(`${path} needs a complete arena recording.`);
  const sum = (field) => drives.reduce((total, drive) => total + (drive[field] || 0), 0);
  const decisions = sum("decisions");
  const flaggedChoices = track === "open" ? sum("flagged_choices") : null;
  const { model_share, fallback_share } = decidedByTotals(drives);
  const failures = new Map();
  for (const drive of drives)
    for (const reason of new Set(drive.failures)) failures.set(reason, (failures.get(reason) || 0) + 1);
  const models = new Set();
  const providerSettings = new Set();
  for (const tape of Object.values(recording.drives))
    for (const outcomes of Object.values(tape))
      for (const outcome of outcomes) {
        const model = outcome.response?.meta?.model;
        if (model) models.add(model);
        const request = outcome.response?.trace?.request;
        if (header.kind === "llm" && request) providerSettings.add(providerOptions(request));
      }
  if (models.size !== 1) throw new Error(`${path} needs answers from exactly one model version.`);
  if (header.kind === "llm" && providerSettings.size !== 1)
    throw new Error(`${path} needs matching provider settings in its request traces.`);
  return {
    content_sha: hash("sha256", canonicalJson(recording)),
    suite_version: suiteVersion(header),
    set: header.arena.set,
    maps: header.maps,
    authored_drives: Object.fromEntries(drives.map((drive) => [drive.challenge, authoredDrive(drive)])),
    manifest: header.manifest,
    lockstep: drives.every((drive) => drive.mode === "lockstep" && (drive.track ?? "guarded") === track),
    signature: canonicalJson({
      suite_version: suiteVersion(header),
      track,
      engine: header.engine,
      engine_version: header.manifest?.engine_version,
      set: header.arena.set,
      maps: header.maps,
      drives: drives.map(({ challenge, version, map, seed, weather, time, car, mode }) => [
        challenge,
        version,
        map,
        seed,
        weather,
        time,
        car,
        mode,
      ]),
    }),
    driver: header.driver,
    model: [...models][0],
    provider_settings: [...providerSettings][0] ?? null,
    source: header.manifest?.source_commit ?? null,
    dirty: header.manifest?.source_dirty,
    prompt: header.manifest?.prompt_hash ?? header.versions?.llm_prompt ?? null,
    engine: header.engine,
    track,
    score: driverScores(drives).score,
    passed: drives.filter((drive) => drive.pass).length,
    decisions,
    flagged_choices: flaggedChoices,
    flags_per_decision: flaggedChoices !== null && decisions ? flaggedChoices / decisions : null,
    model_share: model_share ?? null,
    fallback_share: fallback_share ?? null,
    audited_failures: Object.fromEntries(failures),
    audits: Object.fromEntries(
      AUDIT_FIELDS.filter((field) => drives.some((drive) => Number.isFinite(drive[field]))).map((field) => [
        field,
        sum(field),
      ]),
    ),
    failed_drives: drives.filter((drive) => !drive.pass).map((drive) => drive.challenge),
    safety_brakes: sum("safety_brakes"),
    fallbacks: sum("fallbacks"),
    cost_usd: runCost(drives),
    drives: drives.map((drive) => ({
      id: drive.challenge,
      score: driveScores(drive).score,
      failures: [...new Set(drive.failures)],
    })),
    path,
  };
}

function spread(values) {
  const xs = values.filter((value) => value !== null);
  if (!xs.length) return null;
  return {
    min: Math.min(...xs),
    mean: Number((xs.reduce((sum, value) => sum + value, 0) / xs.length).toFixed(6)),
    max: Math.max(...xs),
  };
}

function compare(paths, planPath) {
  if (new Set(paths.map((path) => realpathSync(path))).size !== paths.length)
    throw new Error("List each recording once.");
  const runs = paths.map(readRepeat);
  if (new Set(runs.map((run) => run.content_sha)).size !== runs.length)
    throw new Error("List each recording once, including copies of the same recording.");
  const first = runs[0];
  if (
    !/^[a-f0-9]{40}$/.test(first.source) ||
    runs.some((run) => run.signature !== first.signature || run.dirty !== false || run.source !== first.source)
  )
    throw new Error(
      "Record each repeat on the same clean source, suite version, engine, track, maps and authored drives.",
    );
  const groups = Map.groupBy(runs, (run) => run.driver);
  if (planPath) requirePlan(runs, groups, readPlan(planPath));
  return {
    scores_version: SCORES_VERSION,
    suite_version: first.suite_version,
    source_commit: first.source,
    engine: first.engine,
    track: first.track,
    drives_per_repeat: first.drives.length,
    drivers: [...groups].map(([driver, repeats]) => {
      const { model, prompt, provider_settings } = repeats[0];
      if (
        repeats.some(
          (run) => run.model !== model || run.prompt !== prompt || run.provider_settings !== provider_settings,
        )
      )
        throw new Error(`Repeats for ${driver} need the same model, prompt and provider settings.`);
      const reasons = new Set(repeats.flatMap((run) => Object.keys(run.audited_failures)));
      const failedDrives = new Set(repeats.flatMap((run) => run.failed_drives));
      const fields = [
        "score",
        "passed",
        "decisions",
        "model_share",
        "fallback_share",
        "flagged_choices",
        "flags_per_decision",
        "safety_brakes",
        "fallbacks",
        "cost_usd",
      ];
      return {
        driver,
        model,
        repeats: repeats.length,
        ...Object.fromEntries(fields.map((field) => [field, spread(repeats.map((run) => run[field]))])),
        audited_failures: Object.fromEntries(
          [...reasons]
            .sort()
            .map((reason) => [reason, spread(repeats.map((run) => run.audited_failures[reason] || 0))]),
        ),
        audit_totals: Object.fromEntries(
          AUDIT_FIELDS.filter((field) => repeats.some((run) => Object.hasOwn(run.audits, field))).map((field) => [
            field,
            spread(repeats.map((run) => run.audits[field] ?? 0)),
          ]),
        ),
        failures_by_drive: Object.fromEntries(
          [...failedDrives].sort().map((id) => [id, repeats.filter((run) => run.failed_drives.includes(id)).length]),
        ),
        by_drive: Object.fromEntries(
          repeats[0].drives.map(({ id }, index) => {
            const matched = repeats.map((run) => run.drives[index]);
            const failureCounts = new Map();
            for (const drive of matched)
              for (const reason of drive.failures) failureCounts.set(reason, (failureCounts.get(reason) ?? 0) + 1);
            return [
              id,
              {
                score: spread(matched.map((drive) => drive.score)),
                failure_reasons: Object.fromEntries([...failureCounts].sort(([a], [b]) => a.localeCompare(b))),
              },
            ];
          }),
        ),
        files: repeats.map((run) => run.path),
        runs: repeats.map((run) => ({
          file: run.path,
          ...Object.fromEntries(fields.map((field) => [field, run[field]])),
          failed_drives: run.failed_drives,
          audited_failures: run.audited_failures,
          audit_totals: run.audits,
        })),
      };
    }),
  };
}

try {
  const { positionals: paths, values } = parseArgs({ options: { plan: { type: "string" } }, allowPositionals: true });
  if (paths.length < 2)
    throw new Error("Usage: node scripts/compare_repeats.mjs [--plan FILE] RECORDING RECORDING [...]");
  console.log(JSON.stringify(compare(paths, values.plan), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
