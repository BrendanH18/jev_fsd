// Benchmark page: build the suite, run every scenario headlessly, show and save the results, and
// compare with an earlier run. window.__bench.run(opts) does the same from a script, and with
// { record: true } or { replay: "<recording name>" } records or replays a model driver's answers
// (brain/recording.js).

import { api, $, h, usd, appUrl } from "../common.js";
import { downloadCsv, downloadJson } from "../ui/export.js";
import { MapData } from "../map/mapdata.js";
import { buildSuite } from "./scenarios.js";
import { runScenario, yieldNow, suiteOptions, benchmarkConfig } from "./runner.js";
import { aggregate } from "./metrics.js";
import { driveScores, driverScores } from "./scores.js";
import { buildHeldoutSuite, heldoutPlan } from "./heldout.js";
import { CUSTOM_SUITE, suiteVersion } from "./suite-version.js";
import { coveringArray } from "./features.js";
import { WEATHER } from "../sim/weather.js";
import { benchmarkDownloadName, comparisonIssue, routeMatches, validateRunInputs } from "./view-options.js";
import { agentDefinitions, agentOptionLabel, agentAvailable } from "../brain/registry.js";
import { registerLlmAgents, checkLlmEndpoints } from "../brain/llm.js";
import { registerDecisionAgents, checkDecisionEndpoints } from "../brain/decision.js";
import {
  ModelRecording,
  recordingHeader,
  loadRecording,
  saveRecording,
  sameResult,
  mapFingerprint,
  checkMap,
  driverKind,
} from "../brain/recording.js";

// [key, header, format, better: "low" | "high" | null]
// (score, progress, comfort, margin and time lost are computed for display, never saved: bench/scores.js)
const COLUMNS = [
  ["score", "score", 1, "high"],
  ["comfort", "comfort", 1, "high"],
  ["margin", "margin", 1, "high"],
  ["time_lost_s_per_km", "lost s/km", 1, "low"],
  ["time_s", "time s", 1, "low"],
  ["avg_kmh", "km/h", 1, "high"],
  ["collisions", "coll", 0, "low"],
  ["at_fault", "at fault", 0, "low"],
  ["red_lights", "red", 0, "low"],
  ["stop_signs", "stop", 0, "low"],
  ["failed_to_yield", "yield", 0, "low"],
  ["off_road_s", "off-road s", 1, "low"],
  ["min_gap_m", "min gap m", 1, "high"],
  ["min_ttc_s", "min TTC s", 1, "high"],
  ["max_decel", "max decel", 1, "high"],
  ["hard_brakes", "hard brakes", 0, "low"],
  ["rms_jerk", "rms jerk", 2, "low"],
  ["max_lat_accel", "max lat m/s²", 1, "low"],
  ["lane_rms_m", "lane rms m", 2, "low"],
  ["speeding_s", "speeding s", 1, "low"],
  ["safety_brakes", "safety", 0, "low"],
  ["decisions", "decisions", 0, null],
  ["model_share", "model", "pct", "high"],
  ["local_share", "local", "pct", null],
  ["fallbacks", "fallbacks", 0, "low"],
  ["flagged_choices", "flagged choices", 0, "low"],
  ["latency_p50_ms", "p50 ms", 0, "low"],
  ["cost_usd", "cost", "usd", null],
];
const CARDS = [
  ["pass_rate", "pass rate", "pct", "high"],
  ["score", "mean score", 1, "high"],
  ["progress", "mean progress", "pct", "high"],
  ["comfort", "mean comfort", 1, "high"],
  ["margin", "mean margin kept", 1, "high"],
  ["time_lost_s_per_km", "time lost s/km", 1, "low"],
  ["violations_per_km", "violations / km", 2, "low"],
  ["collisions", "collisions", 0, "low"],
  ["at_fault", "at-fault collisions", 0, "low"],
  ["red_lights", "red lights run", 0, "low"],
  ["stop_signs", "stop signs rolled", 0, "low"],
  ["failed_to_yield", "failures to yield", 0, "low"],
  ["off_road_s", "off-road s", 1, "low"],
  ["min_ttc_s", "worst TTC s", 1, "high"],
  ["hard_brakes", "hard brakes", 0, "low"],
  ["rms_jerk", "mean rms jerk", 2, "low"],
  ["lane_rms_m", "mean lane rms m", 2, "low"],
  ["avg_kmh", "mean km/h", 1, "high"],
  ["km", "km driven", 2, null],
  ["safety_brakes", "safety brakes", 0, "low"],
  ["cost_usd", "cost", "usd", null],
  // (who made the decisions: only drivers other than Rules report it, bench/metrics.js)
  ["model_share", "decided by the model", "pct", "high"],
  ["local_share", "answered locally", "pct", null],
  ["fallback_share", "fell back to Rules", "pct", "low"],
  ["flagged_choices", "flagged choices", 0, "low"],
];

const fmt = (v, f) => {
  if (v === null || v === undefined) return "–";
  if (f === "usd") return usd(v);
  if (f === "pct") return `${Math.round(v * 100)}%`;
  return Number(v).toFixed(f);
};

let map = null,
  status = null,
  stopRequested = false,
  running = false,
  lastRun = null;
// The suite's scores beside its saved summary (bench/scores.js), and the compared runs' scores by name.
const SCORE_KEYS = ["score", "progress", "comfort", "margin", "time_lost_s_per_km"];
const pickScores = (results) => {
  const s = driverScores(results);
  return Object.fromEntries(SCORE_KEYS.map((k) => [k, s[k]]));
};
const compareScores = new Map();
const compareRequests = new Map();
let tableSort = { key: "index", direction: 1 };
let savedRunRequest = 0;
let runController = null;
let compareError = null;

async function boot() {
  const params = new URLSearchParams(location.search),
    selection = params.get("bbox") || params.get("map");
  const query = selection ? `?bbox=${encodeURIComponent(selection)}` : "";
  status = await api(`/api/status${query}`);
  map = new MapData(await api(`/api/map${query}`));
  const mapSelect = $("#bench-map");
  const { maps } = await api("/api/maps").catch(() => ({ maps: [] }));
  mapSelect.replaceChildren(
    ...(!maps.some((entry) => entry.id === status.map.id)
      ? [h("option", { value: status.map.id }, status.map.label)]
      : []),
    ...maps.map((entry) => h("option", { value: entry.id }, `${entry.name} · ${entry.city}`)),
  );
  mapSelect.value = status.map.id;
  mapSelect.addEventListener("change", () => {
    const next = new URL(location.href);
    next.searchParams.delete("bbox");
    next.searchParams.set("map", mapSelect.value);
    location.assign(next);
  });
  const syncHeldout = () => {
    $("#count").disabled = $("#seed").disabled = $("#heldout").checked;
  };
  syncHeldout();
  $("#heldout").addEventListener("change", syncHeldout);
  const syncCity = () => {
    $("#without").disabled = $("#cover").disabled = $("#features").value !== "city";
  };
  syncCity();
  $("#features").addEventListener("change", syncCity);
  $("#cover").max = String(coveringArray().length - 1);
  $("#bench-search").addEventListener("input", () => lastRun && render(lastRun));
  $("#bench-failures").addEventListener("change", () => lastRun && render(lastRun));
  $("#bench-csv").addEventListener("click", () => {
    const rows = tableRows(lastRun).filter(({ result }) => result);
    downloadCsv(
      benchmarkDownloadName(lastRun.config, "csv"),
      ["id", "pass", "failures", "simulation_error", ...COLUMNS.map(([key]) => key)],
      rows.map(({ result, scored }) => [
        result.id,
        result.pass,
        result.failures?.join(", "),
        result.simulation_error,
        ...COLUMNS.map(([key]) => scored[key]),
      ]),
    );
  });
  $("#bench-json").addEventListener("click", () => {
    const { config, summary, results, suite_version } = lastRun;
    const stopped = lastRun.stopped || config.stopped;
    downloadJson(benchmarkDownloadName(config, "json"), {
      config,
      summary,
      results,
      suite_version,
      ...(stopped ? { stopped } : {}),
      ...(lastRun.complete === false ? { stopped: "exported while running" } : {}),
      ...(lastRun.manifest ? { manifest: lastRun.manifest } : {}),
    });
  });
  $("#saved-run").addEventListener("change", async (ev) => {
    const name = ev.target.value;
    const request = ++savedRunRequest;
    if (!name || running) return;
    try {
      const data = await api(`/api/bench/runs?name=${encodeURIComponent(name)}`);
      if (request !== savedRunRequest || running) return;
      validateSavedRun(data);
      lastRun = { ...data, suite: data.results.map((r) => ({ id: r.id, tags: r.tags || {} })) };
      render(lastRun);
      $("#status").textContent = `Viewing saved run ${name}`;
    } catch (error) {
      if (request === savedRunRequest && !running) $("#status").textContent = error.message;
    }
  });
  const decisions = registerDecisionAgents(status.decision, { demo: !!status.demo }),
    endpoints = registerLlmAgents(status.llm);
  const count = (n, what) => (n ? ` · ${n} ${what}${n > 1 ? "s" : ""}` : "");
  $("#map-note").textContent =
    `${status.map.synthetic ? "synthetic grid" : `${status.map.label}, OpenStreetMap`} · ${map.edges.size} segments · ${agentAvailable("jev") ? "Jev available" : "no TypeSafe key: no Jev"}${count(decisions.length, "decision model")}${count(endpoints.length, "LLM endpoint")}`;
  $("#npcs").value = status.npcs;
  $("#brain").querySelector('option[value="jev"]').disabled = !agentAvailable("jev");
  endpointOptions();
  if (decisions.length)
    checkDecisionEndpoints()
      .then(endpointOptions)
      .catch(() => {
        /* keep "configured" */
      });
  if (endpoints.length)
    checkLlmEndpoints()
      .then(endpointOptions)
      .catch(() => {
        /* keep "configured" */
      });
  $("#run").addEventListener("click", () => {
    if (running) {
      stop();
      return;
    }
    runFromForm().catch((err) => {
      $("#status").textContent = `Failed to run: ${err.message}`;
    });
  });
  $("#compare").addEventListener("change", () => {
    compareError = null;
    const name = $("#compare").value;
    loadCompareScores(name).catch((error) => {
      if ($("#compare").value !== name) return;
      compareError = `Could not load comparison ${name}: ${error.message}`;
      if (lastRun) render(lastRun);
    });
    if (lastRun) render(lastRun);
  });
  $("#run").disabled = false;
  try {
    await loadRuns();
  } catch (error) {
    if (!running && !lastRun) $("#status").textContent = `Could not list saved runs: ${error.message}`;
  }
}

// Configured decision models and LLM endpoints (agents decision:<name>, llm:<name>) join the brain
// list, labelled with their status. Decision models sit with Jev, LLMs at the end.
function endpointOptions() {
  const select = $("#brain");
  for (const d of agentDefinitions().filter((a) => a.decision || a.llm)) {
    let option = select.querySelector(`option[value="${d.id}"]`);
    if (!option) {
      option = h("option", { value: d.id });
      const anchor =
        [...select.querySelectorAll('option[value^="decision:"]')].at(-1) ||
        select.querySelector('option[value="jev"]');
      if (d.decision) anchor.after(option);
      else select.appendChild(option);
    }
    option.textContent = `${agentOptionLabel(d)} (${(d.decision || d.llm).model})`;
    option.disabled = d.available === false;
  }
}

async function loadRuns() {
  const { runs } = await api("/api/bench/runs?summary=1");
  const sel = $("#compare");
  const keep = sel.value;
  sel.replaceChildren(
    h("option", { value: "" }, "none"),
    ...runs.map((r) =>
      h(
        "option",
        { value: r.name },
        `${r.name} · ${suiteVersion(r)} · ${r.config?.brain} · ${r.config?.heldout ? `held-out ${r.config.count} routes` : `${r.config?.count} × seed ${r.config?.seed}`}${r.config?.features ? ` · ${r.config.features}` : ""}${r.config?.park ? " · park" : ""}${r.config?.hour !== undefined ? ` · hour ${r.config.hour}` : ""}${r.config?.cover !== undefined ? ` · cover ${r.config.cover}` : ""}${r.config?.without?.length ? ` · without ${r.config.without.join(",")}` : ""}${r.config?.track ? ` · ${r.config.track} track` : ""}${r.config?.weather && r.config.weather !== "dry" ? ` · ${r.config.weather}` : ""} · ${Math.round((r.summary?.pass_rate || 0) * 100)}%`,
      ),
    ),
  );
  if (keep) sel.value = keep;
  sel._runs = runs;
  const saved = $("#saved-run");
  const previous = saved.value;
  saved.replaceChildren(
    h("option", { value: "" }, "choose a run"),
    ...[...sel.options].slice(1).map((o) => o.cloneNode(true)),
  );
  if (runs.some((run) => run.name === previous)) saved.value = previous;
}

async function runFromForm() {
  const options = {
    brain: $("#brain").value,
    count: $("#count").valueAsNumber,
    npcs: $("#npcs").valueAsNumber,
    seed: $("#seed").valueAsNumber,
    mode: $("#mode").value,
    weather: $("#weather").value,
    features: $("#features").value,
    park: $("#park").checked,
    hour: $("#hour").value === "" ? undefined : +$("#hour").value,
    without: $("#without").disabled ? [] : $("#without").value,
    cover: $("#cover").disabled || $("#cover").value === "" ? undefined : $("#cover").valueAsNumber,
    diagnostics: $("#bench-diagnostics").checked,
    save: $("#bench-save").checked,
    heldout: $("#heldout").checked,
    track: $("#track").value,
  };
  validateRunInputs(options, Object.keys(WEATHER), { form: true });
  return run(options);
}

// heldout: the map's held-out routes (bench/heldout.js) instead of count and seed; never debug against
// them (docs/rules-baseline.md).
function stop() {
  if (!running) return false;
  stopRequested = true;
  runController?.abort();
  $("#run").textContent = "Stopping…";
  $("#run").disabled = true;
  return true;
}

export async function run(options) {
  if (!map) throw new Error("Wait for the benchmark map to load.");
  if (running) throw new Error("A benchmark is already running.");
  running = true;
  savedRunRequest++;
  stopRequested = false;
  runController = new AbortController();
  const controls = [$("#bench-map"), $("#saved-run")];
  for (const control of controls) control.disabled = true;
  $("#run").textContent = "Stop";
  try {
    return await runBenchmark(options);
  } finally {
    running = false;
    runController = null;
    for (const control of controls) control.disabled = false;
    $("#run").textContent = "Run";
    $("#run").disabled = false;
  }
}

async function runBenchmark({
  brain = "rules",
  count = 12,
  npcs = 40,
  seed = 1,
  mode = "lockstep",
  weather = "dry",
  features = "bare",
  park = false,
  hour = undefined,
  without = [],
  cover = undefined,
  heldout = false,
  track = "guarded",
  diagnostics = false,
  save = true,
  record = false,
  replay = null,
} = {}) {
  for (const [name, value] of Object.entries({ heldout, diagnostics, save, record }))
    if (typeof value !== "boolean") throw new Error(`${name} must be true or false.`);
  if (record && replay) throw new Error("Choose recording or replay for this benchmark.");
  // A replay takes its driver and suite from the recording (a saved name, its JSON, or a ModelRecording).
  const replaying = replay ? await loadRecording(replay) : null;
  if (replaying) {
    const b = replaying.header.bench;
    if (!b) throw new Error("Choose a benchmark recording for replay.");
    if (b.bbox && b.bbox.join(",") !== map.routingBbox.join(","))
      throw new Error(
        `The recording was made on ${b.map || b.bbox.join(",")}; open /bench?map=${b.map || b.bbox.join(",")} to replay it.`,
      );
    checkMap(replaying, map);
    ({ count, npcs, seed, weather } = b);
    ({ features = "bare", park = false, hour, without = [], cover, heldout = false, track = "guarded" } = b);
    brain = replaying.header.driver;
  }
  validateRunInputs({ count, npcs, seed, mode, weather, heldout }, Object.keys(WEATHER));
  if (!replaying && !agentAvailable(brain)) throw new Error(`Benchmark driver "${brain}" is unavailable.`);
  if ((record || replaying) && mode !== "lockstep")
    throw new Error("Model recordings record and replay only on the lockstep clock.");
  if (record && !replaying && !driverKind(brain))
    throw new Error(`Only model drivers (jev, decision:<name>, llm:<name>) can be recorded, not "${brain}".`);
  const options = benchmarkConfig({ features, park, hour, without, cover, track });
  const plan = heldout ? heldoutPlan(status.map.id) : null;
  if (plan) {
    count = plan.seeds.length * plan.count;
    seed = plan.seeds[0];
  }
  const definition = agentDefinitions().find((a) => a.id === brain),
    endpoint = definition?.decision || definition?.llm;
  const config = {
    brain,
    ...(endpoint ? { model: endpoint.model, endpoint: endpoint.endpoint } : {}),
    count,
    npcs,
    seed,
    mode,
    weather,
    ...options,
    ...(plan ? { heldout: true, seeds: plan.seeds } : {}),
    map: status.map.name,
    map_label: status.map.label,
    bbox: map.routingBbox,
    pack: map.pack.pack_version,
    started_at: new Date().toISOString(),
  };
  const setStatus = (t) => {
    $("#status").textContent = t;
  };
  const recording =
    replaying ||
    (record
      ? new ModelRecording({
          header: recordingHeader({
            driver: brain,
            brain: { endpoint },
            model: brain === "jev" ? status.decision?.jev?.model : null,
            map: status.map.name,
            map_sha: mapFingerprint(map),
            seed,
            preset: features,
            weather,
            bench: config,
            suite_version: CUSTOM_SUITE,
          }),
        })
      : null);
  setStatus("Building the scenario suite…");
  const signal = runController.signal;
  const routing = {
    ...suiteOptions(features, options),
    signal,
    onRoute: ({ id, ready, count: total, attempt }) =>
      setStatus(`Planning suite · ${ready}/${total} · ${id} found after ${attempt} attempts`),
  };
  const suite =
    replaying?.suite() ||
    (plan ? await buildHeldoutSuite(map, status.map.id, routing) : await buildSuite(map, { count, seed, ...routing }));
  if (!suite.length && !stopRequested) throw new Error("No routable scenarios were found on this map.");
  const state = {
    suite_version: CUSTOM_SUITE,
    config,
    suite,
    results: [],
    summary: null,
    complete: false,
  };
  lastRun = state;
  $("#saved-run").value = "";
  render(state);
  for (let i = 0; i < suite.length && !stopRequested; i++) {
    state.current = i;
    setStatus(
      `running ${i + 1} / ${suite.length}: ${suite[i].tags.length_m} m, ${suite[i].tags.signals} signals, ${suite[i].tags.stops} stops`,
    );
    render(state);
    await yieldNow();
    if (stopRequested) break;
    const tape = recording ? recording.tape(suite[i].id, replaying ? "replay" : "record") : null;
    const r = await runScenario(map, suite[i], {
      brain,
      npcs,
      mode,
      weather,
      ...options,
      signal,
      diagnostics,
      tape,
    });
    if (r.stopped) break;
    if (record && !replaying) recording.keepResult(suite[i].id, r, suite[i]);
    if (replaying)
      r.model_recording.same_result = replaying.results[suite[i].id]
        ? sameResult(r, replaying.results[suite[i].id])
        : null;
    state.results.push(r);
    state.summary = aggregate(state.results);
    render(state);
  }
  state.current = null;
  state.summary = aggregate(state.results);
  state.stopped = stopRequested && (!suite.length || state.results.length !== suite.length);
  state.complete = true;
  const replayed = replaying
    ? state.results.length === suite.length &&
      state.results.every((r) => r.model_recording.exact && r.model_recording.same_result === true)
    : null;
  for (const result of state.results) result.suite_version = state.suite_version;
  const counts = `${state.results.length}/${suite.length} planned · ${state.results.filter((r) => r.pass).length} passed`;
  const planningNote = !state.stopped && suite.length < config.count ? ` · ${config.count} requested` : "";
  let saved = null,
    savedRecording = null,
    recordingError = null;
  if (record && !replaying && save && state.results.length) {
    try {
      savedRecording = await saveRecording(recording);
    } catch (err) {
      recordingError = err.message;
      setStatus(`could not save the recording: ${err.message}`);
    }
  }
  if (save && state.results.length) {
    try {
      saved = await api("/api/bench/save", {
        suite_version: state.suite_version,
        config: { ...config, completed: state.results.length, ...(state.stopped ? { stopped: true } : {}) },
        summary: state.summary,
        results: state.results,
      });
      setStatus(
        `${state.stopped ? "Stopped. " : ""}Saved ${saved.saved}${savedRecording ? ` and ${savedRecording.saved}` : ""}${recordingError ? `. Could not save the recording: ${recordingError}` : ""}`,
      );
    } catch (err) {
      setStatus(
        `Could not save benchmark: ${err.message}${savedRecording ? `. Saved recording ${savedRecording.saved}` : ""}${recordingError ? `. Could not save recording: ${recordingError}` : ""}. Results are available to download.`,
      );
    }
    if (saved) {
      try {
        await loadRuns();
      } catch (error) {
        setStatus(`Saved ${saved.saved}. Could not refresh saved runs: ${error.message}`);
      }
    }
  } else setStatus(`${state.stopped ? "Stopped" : "Done"} · ${counts}${planningNote}`);
  render(state);
  return {
    suite_version: state.suite_version,
    config,
    summary: state.summary,
    results: state.results,
    saved,
    ...(state.stopped ? { stopped: true } : {}),
    ...(recording
      ? {
          recording:
            savedRecording ||
            (record && state.results.length
              ? {
                  ...(recordingError ? { error: recordingError } : {}),
                  data: recording.toJSON(),
                }
              : null),
          replayed,
        }
      : {}),
  };
}

// The run list carries summaries only, so a compared run's scores come from its results, once.
function validateSavedRun(saved) {
  if (!saved?.config || !Array.isArray(saved.results)) throw new Error("Saved run needs a config and drive results.");
  const ids = new Set();
  for (const result of saved.results) {
    if (typeof result?.id !== "string" || !result.id || ids.has(result.id))
      throw new Error("Saved run contains a missing or repeated route ID.");
    ids.add(result.id);
  }
}

async function loadCompareScores(name) {
  if (!name || compareScores.has(name)) return;
  if (compareRequests.has(name)) return compareRequests.get(name);
  const request = (async () => {
    const saved = await api(`/api/bench/runs?name=${encodeURIComponent(name)}`);
    validateSavedRun(saved);
    const { config, suite_version, manifest, results, stopped } = saved;
    compareScores.set(name, {
      config,
      suite_version,
      manifest,
      stopped,
      results: results.map(({ id, tags }) => ({ id, tags })),
      scores: pickScores(results),
    });
    if (lastRun && $("#compare").value === name) render(lastRun);
  })();
  compareRequests.set(name, request);
  try {
    await request;
  } finally {
    compareRequests.delete(name);
  }
}

function delta(cur, prev, better, f) {
  if (!better || prev === null || prev === undefined || cur === null || cur === undefined) return null;
  const d = cur - prev;
  const cls = Math.abs(d) < 1e-9 ? "same" : d < 0 === (better === "low") ? "better" : "worse";
  const text = f === "pct" ? `${d >= 0 ? "+" : ""}${Math.round(d * 100)} pts` : `${d >= 0 ? "+" : ""}${fmt(d, f)}`;
  return h("span", { class: `delta ${cls}` }, text);
}

function tableRows(state) {
  const byId = new Map(state.results.map((result) => [result.id, result]));
  const rows = state.suite.map((scenario, index) => {
    const result = byId.get(scenario.id);
    return { scenario, index, result, scored: result && { ...result, ...driveScores(result) } };
  });
  const { key, direction } = tableSort;
  const value = ({ index, scenario, result, scored }) => {
    if (key === "index") return index;
    if (key === "route") return scenario.tags?.length_m;
    if (key === "pass") return result ? Number(result.pass) : null;
    return scored?.[key];
  };
  const query = $("#bench-search").value;
  const failuresOnly = $("#bench-failures").checked;
  return rows
    .filter(
      ({ scenario, result }) => (!failuresOnly || result?.pass === false) && routeMatches(query, scenario, result),
    )
    .sort((a, b) => {
      const x = value(a),
        y = value(b);
      if (x == null || y == null) return Number(x == null) - Number(y == null);
      return direction * (x - y) || a.index - b.index;
    });
}

function render(state) {
  const compare = $("#compare");
  const before = compare._runs?.find((run) => run.name === compare.value);
  const note = $("#comparison-note");
  const baseline = compareScores.get(before?.name);
  const issue = compareError || (baseline && state.complete !== false && comparisonIssue(state, baseline));
  note.hidden = !issue;
  note.textContent = issue || "";
  const prev = baseline && !issue && state.complete !== false ? { ...before.summary, ...baseline.scores } : null;
  const s = state.summary && { ...state.summary, ...pickScores(state.results) };
  $("#summary").replaceChildren(
    ...(s
      ? CARDS.filter(([k]) => s[k] !== undefined).map(([k, label, f, better]) =>
          h(
            "div",
            { class: "card" },
            h("span", { class: "label" }, label),
            h("span", { class: "value" }, fmt(s[k], f)),
            prev ? delta(s[k], prev[k], better, f) : null,
          ),
        )
      : []),
  );

  const sortHeader = (key, label, cls = "") =>
    h(
      "th",
      {
        class: cls,
        "aria-sort": tableSort.key === key ? (tableSort.direction === 1 ? "ascending" : "descending") : null,
      },
      h(
        "button",
        {
          type: "button",
          class: "table-sort",
          onclick: () => {
            tableSort = { key, direction: tableSort.key === key ? -tableSort.direction : 1 };
            render(state);
            $(`#results button[data-sort="${key}"]`).focus();
          },
          "data-sort": key,
        },
        label,
      ),
    );
  const head = h(
    "tr",
    {},
    sortHeader("index", "#", "left"),
    sortHeader("route", "route", "left"),
    sortHeader("pass", "result", "left"),
    ...COLUMNS.map(([key, label]) => sortHeader(key, label)),
    h("th", {}, ""),
  );
  $("#results thead").replaceChildren(head);
  const visible = tableRows(state);
  const rows = visible.map(({ scenario: sc, index: i, result: r, scored }) => {
    const t = sc.tags;
    const route =
      t.length_m == null
        ? sc.id
        : `${sc.id} · ${t.length_m} m · ${t.signals}sig ${t.stops}stop ${t.lefts}L ${t.rights}R`;
    if (!r) {
      return h(
        "tr",
        { class: state.current === i ? "running" : "" },
        h("td", {}, i + 1),
        h("td", { class: "left" }, route),
        h("td", { class: "left muted" }, state.current === i ? "running…" : state.stopped ? "skipped" : "queued"),
        ...COLUMNS.map(() => h("td", {}, "")),
        h("td", {}, ""),
      );
    }
    const cells = COLUMNS.map(([k, , f]) => {
      const v = scored[k];
      const warn =
        (k === "min_ttc_s" && v !== null && v < 2) ||
        (k === "hard_brakes" && v > 0) ||
        (k === "speeding_s" && v > 3) ||
        (k === "safety_brakes" && v > 0);
      const bad = ["collisions", "at_fault", "red_lights", "stop_signs"].includes(k) && v > 0;
      return h("td", { class: bad ? "failed" : warn ? "warn" : "" }, fmt(v, f));
    });
    return h(
      "tr",
      { class: r.pass ? "" : "fail" },
      h("td", {}, i + 1),
      h("td", { class: "left" }, route),
      h(
        "td",
        {
          class: `left ${r.pass ? "pass" : "failed"}`,
          title: [r.failures?.join(", "), r.simulation_error].filter(Boolean).join(" · "),
        },
        r.pass ? "PASS" : r.failures?.join(", ") || "FAIL",
      ),
      ...cells,
      h(
        "td",
        {},
        sc.route &&
          h(
            "button",
            {
              class: "toggle watch",
              title: "Replay this scenario in the 3D sim",
              onclick: () => watch(sc, state.config),
            },
            "watch",
          ),
      ),
    );
  });
  $("#results tbody").replaceChildren(
    ...(rows.length ? rows : [h("tr", {}, h("td", { colspan: COLUMNS.length + 4 }, "No matching drives."))]),
  );
  $("#bench-csv").disabled = !visible.some(({ result }) => result);
  $("#bench-json").disabled = !state.results.length;
  const foot = s
    ? h(
        "tr",
        {},
        h("td", {}, ""),
        h("td", { class: "left" }, `${s.km} km`),
        h("td", { class: "left" }, `${Math.round(s.pass_rate * 100)}% pass`),
        ...COLUMNS.map(([k, , f]) => h("td", {}, s[k] !== undefined ? fmt(s[k], f) : "")),
        h("td", {}, ""),
      )
    : null;
  const table = $("#results");
  table.querySelector("tfoot")?.remove();
  if (foot) table.append(h("tfoot", {}, foot));
}

function watch(sc, config) {
  try {
    localStorage.setItem(
      "jev-fsd-replay",
      JSON.stringify({
        scenario: sc,
        brain: config.brain,
        npcs: config.npcs,
        weather: config.weather,
        ...benchmarkConfig(config),
        bbox: config.bbox || map.routingBbox,
      }),
    );
  } catch (error) {
    $("#status").textContent = `Could not prepare the scenario to watch: ${error.message}`;
    return;
  }
  window.open(appUrl("", { replay: 1, bbox: (config.bbox || map.routingBbox).join(",") }), "_blank", "noopener");
}

window.__bench = {
  run,
  stop,
  get last() {
    return lastRun;
  },
};
boot().catch((err) => {
  $("#status").textContent = `Failed to start: ${err.message}`;
  console.error(err);
});
