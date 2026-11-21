// Summarise repeated arena recordings without calling a model.
// node --experimental-default-type=module scripts/compare_repeats.mjs tape1.json.gz tape2.json.gz [...]
import { readFileSync, realpathSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { driverScores, SCORES_VERSION } from "../static/js/bench/scores.js";
import { canonicalJson, ModelRecording } from "../static/js/brain/recording.js";

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

function readRepeat(path) {
  const raw = readFileSync(path);
  const recording = ModelRecording.parse((path.endsWith(".gz") ? gunzipSync(raw) : raw).toString());
  const { header, results } = recording;
  const track = header.arena?.track || "guarded";
  if (!header.arena) throw new Error(`${path} is a benchmark recording. Use arena recordings for this report.`);
  const drives = Object.values(results).sort((a, b) => a.challenge.localeCompare(b.challenge));
  const planned = new Set(header.arena?.ids);
  if (
    !drives.length ||
    planned.size !== drives.length ||
    drives.some((drive) => !planned.delete(drive.challenge) || drive.stopped)
  )
    throw new Error(`${path} needs a complete arena recording.`);
  const sum = (field) => drives.reduce((total, drive) => total + (drive[field] || 0), 0);
  const decisions = sum("decisions");
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
    signature: canonicalJson({
      track,
      engine: header.engine,
      set: header.arena.set,
      maps: header.maps,
      drives: drives.map(({ challenge, version, map, seed, weather, time, car }) => [
        challenge,
        version,
        map,
        seed,
        weather,
        time,
        car,
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
    flags_per_decision: track === "open" && decisions ? sum("flagged_choices") / decisions : null,
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
    drives: drives.length,
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

function compare(paths) {
  if (new Set(paths.map((path) => realpathSync(path))).size !== paths.length)
    throw new Error("List each recording once.");
  const runs = paths.map(readRepeat);
  const first = runs[0];
  if (
    !first.source ||
    runs.some((run) => run.signature !== first.signature || run.dirty || run.source !== first.source)
  )
    throw new Error("Record each repeat on the same clean source, engine, track, maps and authored drives.");
  const groups = Map.groupBy(runs, (run) => run.driver);
  return {
    scores_version: SCORES_VERSION,
    source_commit: first.source,
    engine: first.engine,
    track: first.track,
    drives_per_repeat: first.drives,
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
      const fields = ["score", "passed", "flags_per_decision", "safety_brakes", "fallbacks"];
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
        files: repeats.map((run) => run.path),
      };
    }),
  };
}

try {
  const paths = process.argv.slice(2);
  if (paths.length < 2) throw new Error("Usage: node scripts/compare_repeats.mjs RECORDING RECORDING [...]");
  console.log(JSON.stringify(compare(paths), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
