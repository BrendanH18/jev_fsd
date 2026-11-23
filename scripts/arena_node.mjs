// Run the drive lab's challenges and road tests under Node against a running local server, with any
// driver, as the arena does (lab/evaluation.js `evaluateChallenge`), and record or replay a model run.
// PORT=8331 uv run server.py, then:
// node --experimental-default-type=module scripts/arena_node.mjs --brain jev --record data/recordings/jev-challenges.json
// node --experimental-default-type=module scripts/arena_node.mjs --replay data/recordings/jev-challenges.json --check 1
// Options: --brain (rules, cautious, jev, decision:<name>, llm:<name>), --set (challenges, the default;
// road-tests; or all), --only id,id (just these), --port, --json out.json (a summary per drive, no
// decision trace), --check 1 (exit with status 1 if a drive fails or a replay differs), --check replay
// (require an exact replay regardless of the verdict), --record out.json and --replay rec.json
// (models and trusted local agents; docs/agents.md; a name
// ending .gz is gzipped), --reserve 0.5 (stop between drives once the server's budget runs low), --track
// open (the open track: road-rule checks flag manoeuvres instead of removing them, brain/tracks.js; a
// recording keeps its track), --agent local-path (load a trusted driver module),
// --browser-replay out.json (export a playable street view of one
// exact replay selected with --only), --comparison-json out.json (export driven-corridor
// measurements for exact guarded replays that do not already have them).
//
// A recording here covers several maps, so its header keeps one map fingerprint per map
// (`header.maps`), and each drive's recorded result leaves out the decision trace and timeline,
// which are large, keeping `result_sha`, the hash of the whole comparable result, so a replay is
// still compared field for field (timings and optional comparison measurements aside).
import { pathToFileURL } from "node:url";
import { CUSTOM_SUITE, replaySuiteVersion, setRecordingSuiteVersion } from "../static/js/bench/suite-version.js";
import { benchPage, jsonDifferences, parseOptions } from "./cli_tools.mjs";

const OPTIONS = [
  "brain",
  "set",
  "only",
  "port",
  "json",
  "check",
  "record",
  "replay",
  "reserve",
  "track",
  "agent",
  "browser-replay",
  "comparison-json",
];

const USAGE = [
  "Usage: node --experimental-default-type=module scripts/arena_node.mjs [options]",
  "  --brain <id>                 driver id: rules, cautious, jev, decision:<name>, llm:<name>",
  "  --agent <path>               load a trusted local driver module",
  "  --set <name>                 challenges (default), road-tests, or all",
  "  --only <id,id>               run only selected drive ids",
  "  --track <guarded|open>       rule enforcement track (default: guarded)",
  "  --port <port>                local server port (default: PORT or 8331)",
  "  --json <path>                write per-drive summary JSON report",
  "  --check <0|1|replay|submission>  exit 1 on failure, replay drift, or submission mismatch",
  "  --record <path[.gz]>         record model or local agent answers",
  "  --replay <path[.gz]>         replay from a recording",
  "  --reserve <usd>              stop recording when remaining budget falls below USD",
  "  --browser-replay <path>      export a playable replay for one drive (--replay + --only)",
  "  --comparison-json <path>     export driven-corridor score inputs for a guarded replay",
  "  --help, -h                   show this help",
].join("\n");

const BULKY = ["decisions_trace", "events", "report"];

function replayResultDiffs(recorded, actual, rec, actualSha = null, maxDiffs = 12) {
  const stripMeta = (entry) => {
    const {
      result_sha: _sha,
      suite_version: _version,
      comparison_score_inputs: _comparison,
      ...rest
    } = rec.comparableResult(entry);
    return Object.fromEntries(Object.entries(rest).filter(([k]) => !BULKY.includes(k)));
  };
  const diffs = jsonDifferences(stripMeta(recorded), stripMeta(actual), rec.canonicalJson, { limit: maxDiffs });
  if (!diffs.length && recorded?.result_sha && actualSha && recorded.result_sha !== actualSha) {
    diffs.push(
      `result_sha: expected ${JSON.stringify(recorded.result_sha)}, actual ${JSON.stringify(actualSha)} (differs in bulky fields: ${BULKY.join(", ")})`,
    );
  }
  return diffs;
}

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
let parsed;
try {
  parsed = parseOptions(process.argv.slice(2), OPTIONS);
} catch (error) {
  fail(error.message);
}
if (parsed.help) {
  console.log(USAGE);
  process.exit(0);
}
const args = parsed.args;

if (args.record && args.replay) fail("Use --record or --replay, not both.");
if (args.agent && (args.brain || args.replay)) fail("--agent selects a local driver. Drop --brain and --replay.");
// --reserve 0.5: start no further drive once less than this many dollars of the server's budget
// (JEV_FSD_BUDGET_USD) are left, so a run that would outspend it stops between drives instead of
// spoiling the drive under way with budget fallbacks. With --record, the finished drives are kept.
const reserve = args.reserve === undefined ? null : Number(args.reserve);
if (reserve !== null && (!args.record || !Number.isFinite(reserve) || reserve <= 0))
  fail("--reserve needs --record and a positive number of dollars.");
const checkSubmission = args.check === "submission";
const checkReplay = args.check === "replay" || checkSubmission;
if (checkReplay && (!args.replay || args.reserve !== undefined))
  fail(`--check ${args.check} requires --replay without a budget reserve.`);
if (checkSubmission && (args.only || args["browser-replay"] || args["comparison-json"]))
  fail("--check submission verifies the entire recording without replay exports.");
if (args["browser-replay"] && (!args.replay || !args.only || String(args.only).includes(",")))
  fail("--browser-replay needs --replay and exactly one drive selected with --only.");
const fs = await import("node:fs"),
  { dirname, join } = await import("node:path"),
  zlib = await import("node:zlib");
const browserOutput = args["browser-replay"];
const comparisonOutput = args["comparison-json"];
if (comparisonOutput && !args.replay) fail("--comparison-json requires --replay.");
if (comparisonOutput && fs.lstatSync(comparisonOutput, { throwIfNoEntry: false }))
  fail("--comparison-json must name a new file.");
if (browserOutput) {
  const source = fs.statSync(args.replay, { throwIfNoEntry: false });
  const destination = fs.statSync(browserOutput, { throwIfNoEntry: false });
  if (source && destination && source.dev === destination.dev && source.ino === destination.ino)
    fail("--browser-replay must write to a different file from --replay.");
}
let replayJson = null;
if (args.replay) {
  try {
    const raw = fs.readFileSync(args.replay);
    replayJson = JSON.parse(args.replay.endsWith(".gz") ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8"));
  } catch (error) {
    fail(`Cannot read the recording ${args.replay}: ${error.message}`);
  }
  if (typeof replayJson?.header?.driver !== "string" || !replayJson.header.arena)
    fail(`${args.replay} is not an arena recording.`);
  const given = ["brain", "set", "track"].filter((name) => args[name] !== undefined);
  if (given.length)
    fail(`The recording sets the driver and drives: drop ${given.map((name) => `--${name}`).join(", ")}.`);
  args.brain = replayJson.header.driver;
  if (replayJson.header.arena.track) args.track = replayJson.header.arena.track;
}
const track = String(args.track || "guarded");
if (!["guarded", "open"].includes(track)) fail(`Unknown track "${track}": use guarded or open.`);

if (comparisonOutput && track !== "guarded") fail("--comparison-json requires a guarded recording.");

const { base, page } = await benchPage(args.port ?? process.env.PORT ?? "8331").catch((error) => fail(error.message));
const token = page.match(/name="jev-csrf" content="([^"]+)"/)?.[1] || "";
globalThis.document = { querySelector: (sel) => (sel.includes("jev-csrf") ? { content: token } : null) };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (path, opts) =>
  nativeFetch(String(path).startsWith("/") ? base + path : path, { ...opts, redirect: "error" });

const { api } = await import("../static/js/common.js");
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");
const { evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { agentDefinitions, registerAgent } = await import("../static/js/brain/registry.js");
const rec = await import("../static/js/brain/recording.js");
const { LOCAL_RECORDING_FORMAT, LocalRecording } = await import("./local_recording.mjs");
const localTape = replayJson?.format === LOCAL_RECORDING_FORMAT || Boolean(args.agent && args.record);
if (localTape && (browserOutput || comparisonOutput)) fail("Replay exports currently require a model recording.");
const { arenaSuiteVersion, authoredDrive } = await import("./canonical_suite.mjs");
const { driverScores } = await import("../static/js/bench/scores.js");
const capture = args["browser-replay"] ? (await import("./browser_replay.mjs")).captureBrowserReplay() : null;

let brain = String(args.brain || "rules");
if (args.agent) {
  try {
    const { default: definition } = await import(pathToFileURL(args.agent).href);
    if (typeof definition?.id !== "string" || definition.id.includes(":"))
      throw new Error("Use a local driver id without a provider prefix.");
    registerAgent(definition);
    brain = definition.id;
  } catch (error) {
    fail(`Cannot load agent ${args.agent}: ${error.message}`);
  }
}
if (/^(?:decision|llm):/.test(brain) && !replayJson) {
  const status = await api("/api/status");
  (await import("../static/js/brain/decision.js")).registerDecisionAgents(status.decision);
  (await import("../static/js/brain/llm.js")).registerLlmAgents(status.llm);
}
if (!replayJson && !agentDefinitions().some((d) => d.id === brain))
  fail(
    `Unknown brain "${brain}": use one of ${agentDefinitions()
      .map((d) => d.id)
      .join(", ")}.`,
  );
if ((args.record || args.replay) && !localTape && !rec.driverKind(brain))
  fail(`--record and --replay need a model or custom driver, not "${brain}".`);

const SETS = { challenges: CHALLENGES, "road-tests": ROAD_TESTS, all: [...CHALLENGES, ...ROAD_TESTS] };
const set = replayJson ? replayJson.header.arena.set : String(args.set || "challenges");
if (!Object.hasOwn(SETS, set)) fail(`Unknown set "${set}": use ${Object.keys(SETS).join(", ")}.`);
let drives = SETS[set];
if (replayJson) {
  // (a recorded drive whose challenge is gone or renamed fails the replay rather than being skipped;
  // the recorded results, not the planned ids, so a recording stopped part way still replays)
  const gone = Object.keys(replayJson.results || {}).filter((id) => !drives.some((c) => c.id === id));
  if (gone.length) fail(`The recording has drives no longer in ${set}: ${gone.join(", ")}.`);
  drives = drives.filter((c) => c.id in replayJson.results);
}
const only = args.only ? String(args.only).split(",") : null;
const unknown = (only || []).filter((id) => !drives.some((c) => c.id === id));
if (unknown.length) fail(`No drive ${unknown.join(", ")} in ${set}.`);
if (only) drives = drives.filter((c) => only.includes(c.id));
if (checkReplay && !drives.length) fail("The recording has no drives to check.");

// The challenge maps, with every layer, as the app loads them.
const maps = {};
for (const id of new Set(drives.map((c) => c.map)))
  maps[id] = new MapData(await api(`/api/map?bbox=${encodeURIComponent(id)}`));
const shas = Object.fromEntries(Object.entries(maps).map(([id, map]) => [id, rec.mapFingerprint(map)]));

let recording = null;
const suite = { kind: "arena", set, drives: Object.fromEntries(drives.map((c) => [c.id, authoredDrive(c)])) };
const manifestModule =
  checkSubmission || (!replayJson && (args.record || (!args.agent && args.json)))
    ? await import("./run_manifest.mjs")
    : null;
let manifest = null;
if (replayJson) {
  try {
    recording = localTape ? new LocalRecording(replayJson) : rec.ModelRecording.parse(replayJson);
  } catch (error) {
    fail(`Cannot replay ${args.replay}: ${error.message}`);
  }
  const changed = Object.keys(shas).filter((id) => recording.header.maps?.[id] !== shas[id]);
  if (changed.length)
    fail(`The map data of ${changed.join(", ")} has changed since this recording was made (a rebuilt pack or layer).`);
  if (checkSubmission) {
    const { verifySubmissionManifest } = await import("./submission_bundle.mjs");
    try {
      verifySubmissionManifest(
        recording,
        manifestModule.runManifest({
          driver: brain,
          model: recording.header.model,
          track,
          suite,
          maps,
          fingerprints: shas,
          local: localTape,
        }),
        drives.map((drive) => drive.id),
      );
    } catch (error) {
      fail(error.message);
    }
  }
} else if (manifestModule) {
  const definition = agentDefinitions().find((d) => d.id === brain);
  const endpoint = definition?.llm || definition?.decision;
  const model = localTape ? null : brain === "jev" ? (await api("/api/status")).decision?.jev?.model : endpoint?.model;
  manifest = manifestModule.runManifest({
    driver: brain,
    model,
    track,
    suite,
    maps,
    fingerprints: shas,
    local: localTape,
  });
  if (args.record) {
    const context = {
      arena: { set, ids: drives.map((c) => c.id), ...(track === "open" ? { track } : {}) },
      maps: shas,
      manifest,
      suite_version: CUSTOM_SUITE,
    };
    recording = localTape
      ? new LocalRecording({ header: { driver: brain, model: null, engine: manifest.engine, ...context } })
      : new rec.ModelRecording({
          header: rec.recordingHeader({ driver: brain, brain: { endpoint }, model, ...context }),
        });
  }
}

// (written beside the destination and renamed over it, so a run killed while saving keeps the last save)
const save = (recordingToSave) => {
  const text = recordingToSave.serialize();
  const directory = fs.mkdtempSync(join(dirname(args.record), ".arena-recording-"));
  const tmp = join(directory, "recording");
  try {
    fs.writeFileSync(tmp, args.record.endsWith(".gz") ? zlib.gzipSync(text, { level: 9 }) : text);
    fs.renameSync(tmp, args.record);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
const trimmed = (result) =>
  Object.fromEntries(Object.entries(rec.comparableResult(result)).filter(([k]) => !BULKY.includes(k)));
// Comparison inputs are display measurements. Their availability does not determine replay fidelity.
const resultSha = ({ comparison_score_inputs: _comparison, ...result }) =>
  rec.hashText(rec.canonicalJson(rec.comparableResult(result)));
const SUMMARY = [
  "challenge",
  "suite_version",
  "seed",
  "version",
  "map",
  "pack",
  "pass",
  "failures",
  "arrived",
  "time_s",
  "progress",
  "distance_m",
  "rms_jerk",
  "max_lat_accel",
  "min_ttc_s",
  "min_headway_s",
  "comparison_score_inputs",
  "collisions",
  "at_fault",
  "hard_brakes",
  "safety_brakes",
  "decisions",
  "fallbacks",
  "model_share",
  "local_share",
  "fallback_share",
  "cost_usd",
  "input_tokens",
  "output_tokens",
  "simulation_error",
  "stopped",
  "track",
  "flagged_choices",
  "flagged_by_check",
];

const results = [],
  drifted = [],
  comparisons = {};
let budgetStop = null;
for (const challenge of drives) {
  if (reserve !== null) {
    const { budget_usd: budget, spent_usd: spent } = (await api("/api/status")).spend || {};
    // A zero budget disables the spend limit. Refuse to start a reserved run without a limit.
    if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(spent) || spent < 0)
      fail("--reserve needs a finite server spend limit.");
    const remaining = budget - spent;
    if (remaining < reserve) {
      budgetStop = `stopped before ${challenge.id}: $${remaining.toFixed(2)} of the budget left`;
      console.error(budgetStop);
      break;
    }
  }
  const tape = recording ? recording.tape(challenge.id, args.record ? "record" : "replay") : null;
  const recorded = replayJson?.results[challenge.id];
  const measureInputs = replayJson
    ? (checkSubmission && recorded.comparison_score_inputs) || (comparisonOutput && !recorded.comparison_score_inputs)
    : args.json || args.record;
  let scoreInputs;
  const r = await evaluateChallenge(maps[challenge.map], challenge, {
    brain,
    tape,
    track,
    onStep: capture?.onStep,
    onScoreInputs: measureInputs
      ? (inputs) => {
          scoreInputs = inputs;
        }
      : null,
  });
  if ((!recorded || checkSubmission) && scoreInputs) r.comparison_score_inputs = scoreInputs;
  // (saved after every drive, so a run stopped part way keeps the drives it finished)
  results.push(r);
  if (args.record) {
    recording.results[challenge.id] = { ...trimmed(r), result_sha: resultSha(r) };
    manifest.cost_usd = manifestModule.runCost(Object.values(recording.results));
    setRecordingSuiteVersion(recording, only ? CUSTOM_SUITE : arenaSuiteVersion({ ...suite, maps: shas }, results));
    save(recording);
  }
  if (replayJson) {
    const actualSha = resultSha(r);
    r.model_recording.same_result = recorded.result_sha === actualSha;
    if (r.model_recording.same_result === false) {
      for (const line of replayResultDiffs(recorded, r, rec, actualSha)) {
        console.error(`  drift ${challenge.id} ${line}`);
      }
    }
    if (
      checkSubmission &&
      rec.canonicalJson(recorded) !==
        rec.canonicalJson({ ...trimmed(r), result_sha: actualSha, suite_version: recording.header.suite_version })
    )
      fail(`The recorded results for ${challenge.id} differ from the replay.`);
    if (!r.model_recording.same_result || !r.model_recording.exact) drifted.push(challenge.id);
    else if (recorded.comparison_score_inputs) r.comparison_score_inputs = recorded.comparison_score_inputs;
    else if (scoreInputs) comparisons[challenge.id] = { result_sha: recorded.result_sha, score_inputs: scoreInputs };
    if (capture) {
      if (drifted.length) fail(`Cannot export ${challenge.id}: the replay differs from the recorded drive.`);
      const text = `${JSON.stringify(capture.finish(challenge, args.replay, recording, r))}\n`;
      const directory = fs.mkdtempSync(join(dirname(browserOutput), ".browser-replay-"));
      const temporary = join(directory, "replay.json");
      try {
        fs.writeFileSync(temporary, text);
        fs.renameSync(temporary, browserOutput);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  }
  const shares =
    r.model_share !== undefined ? ` model=${r.model_share} local=${r.local_share} fallback=${r.fallback_share}` : "";
  console.log(
    `${challenge.id} ${r.pass ? "PASS" : "FAIL"} arrived=${r.arrived} t=${r.time_s} decisions=${r.decisions}${shares}${r.flagged_choices ? ` flagged=${r.flagged_choices}` : ""} cost=${r.cost_usd ?? 0}` +
      `${r.pass ? "" : ` failures=${(r.failures || []).join(",")}`}${r.simulation_error ? ` error=${JSON.stringify(r.simulation_error)}` : ""}` +
      `${r.model_recording ? ` rec=${JSON.stringify(r.model_recording)}` : ""}`,
  );
}
// (progress, pace, comfort, margin and time lost, computed for display only: bench/scores.js)
console.log(`scores ${JSON.stringify(driverScores(results.filter((r) => !r.stopped)))}`);
const passed = results.filter((r) => r.pass).length;
const cost = results.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
const summary = {
  brain,
  set,
  ...(track === "open"
    ? { track, flagged_choices: results.reduce((sum, r) => sum + (r.flagged_choices || 0), 0) }
    : {}),
  drives: results.length,
  passed,
  cost_usd: Math.round(cost * 1e6) / 1e6,
  engine: `node ${process.version}`,
};
if (manifest) manifest.cost_usd = summary.cost_usd;
const replayManifest = replayJson && recording.header.manifest;
const exactReplay =
  !only &&
  !budgetStop &&
  drifted.length === 0 &&
  replayJson &&
  results.length === Object.keys(recording.results).length;
if (checkSubmission) {
  if (replayManifest.cost_usd !== summary.cost_usd) fail("The manifest cost differs from the replay.");
  const version = arenaSuiteVersion({ ...suite, maps: shas }, results);
  if (![CUSTOM_SUITE, version].includes(recording.header.suite_version))
    fail("The recording declares a different suite version.");
}
if (checkReplay && replayManifest?.engine === summary.engine && exactReplay) manifest = replayManifest;
const suite_version = replayJson
  ? replaySuiteVersion(recording.header, exactReplay)
  : (args.agent && !args.record) || only || budgetStop
    ? CUSTOM_SUITE
    : arenaSuiteVersion({ ...suite, maps: shas }, results);
if (manifest && !replayJson) manifest.suite_version = suite_version;
for (const result of results) result.suite_version = suite_version;
if (args.json)
  fs.writeFileSync(
    args.json,
    JSON.stringify(
      {
        suite_version,
        ...(manifest ? { manifest } : {}),
        ...(budgetStop ? { stopped: budgetStop } : {}),
        summary,
        results: results.map((r) =>
          Object.fromEntries(SUMMARY.filter((k) => r[k] !== undefined).map((k) => [k, r[k]])),
        ),
      },
      null,
      1,
    ),
  );
if (comparisonOutput) {
  try {
    fs.writeFileSync(comparisonOutput, `${JSON.stringify(comparisons, null, 1)}\n`, { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") fail("--comparison-json must name a new file.");
    throw error;
  }
}
if (args.record && results.length) console.log(`recorded ${results.length} drives to ${args.record}`);
if (replayJson)
  console.log(
    drifted.length
      ? `replay: ${drifted.join(", ")} did not play out as recorded`
      : `replay: all ${results.length} drives played out as recorded`,
  );
const failed =
  args.check && args.check !== "0" && !checkReplay
    ? [...new Set([...results.filter((r) => !r.pass).map((r) => r.challenge), ...drifted])]
    : [];
if (failed.length)
  console.error(
    `${failed.length} of ${results.length} drives failed${drifted.length ? " or did not replay as recorded" : ""}: ${failed.join(", ")}`,
  );
const failedReplay = checkReplay && drifted.length > 0;
process.stdout.write(`${JSON.stringify({ ...summary, suite_version })}\n`, () =>
  process.exit(failed.length || failedReplay || budgetStop ? 1 : 0),
);
