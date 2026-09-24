// Benchmark page: build the suite, run every scenario headlessly, show and save the results, and
// compare with an earlier run. window.__bench.run(opts) does the same from a script.

import { api, $, h, usd } from "../common.js";
import { MapData } from "../map/mapdata.js";
import { buildSuite } from "./scenarios.js";
import { runScenario, yieldNow } from "./runner.js";
import { aggregate } from "./metrics.js";

// [key, header, format, better: "low" | "high" | null]
const COLUMNS = [
  ["time_s", "time s", 1, "low"], ["avg_kmh", "km/h", 1, "high"],
  ["collisions", "coll", 0, "low"], ["at_fault", "at fault", 0, "low"], ["red_lights", "red", 0, "low"], ["stop_signs", "stop", 0, "low"], ["off_road_s", "off-road s", 1, "low"],
  ["min_gap_m", "min gap m", 1, "high"], ["min_ttc_s", "min TTC s", 1, "high"], ["max_decel", "max decel", 1, "high"],
  ["hard_brakes", "hard brakes", 0, "low"], ["rms_jerk", "rms jerk", 2, "low"], ["max_lat_accel", "max lat m/s²", 1, "low"],
  ["lane_rms_m", "lane rms m", 2, "low"], ["speeding_s", "speeding s", 1, "low"], ["safety_brakes", "safety", 0, "low"],
  ["decisions", "decisions", 0, null], ["fallbacks", "fallbacks", 0, "low"], ["latency_p50_ms", "p50 ms", 0, "low"], ["cost_usd", "cost", "usd", null],
];
const CARDS = [
  ["pass_rate", "pass rate", "pct", "high"], ["violations_per_km", "violations / km", 2, "low"], ["collisions", "collisions", 0, "low"], ["at_fault", "at-fault collisions", 0, "low"],
  ["red_lights", "red lights run", 0, "low"], ["stop_signs", "stop signs rolled", 0, "low"], ["off_road_s", "off-road s", 1, "low"],
  ["min_ttc_s", "worst TTC s", 1, "high"], ["hard_brakes", "hard brakes", 0, "low"], ["rms_jerk", "mean rms jerk", 2, "low"],
  ["lane_rms_m", "mean lane rms m", 2, "low"], ["avg_kmh", "mean km/h", 1, "high"], ["km", "km driven", 2, null],
  ["safety_brakes", "safety brakes", 0, "low"], ["cost_usd", "cost", "usd", null],
];

const fmt = (v, f) => {
  if (v === null || v === undefined) return "–";
  if (f === "usd") return usd(v);
  if (f === "pct") return `${Math.round(v * 100)}%`;
  return Number(v).toFixed(f);
};

let map = null, status = null, stopRequested = false, running = false, lastRun = null;

async function boot() {
  status = await api("/api/status");
  map = new MapData(await api("/api/map"));
  $("#map-note").textContent = `${status.map.synthetic ? "synthetic grid" : "Kitsilano, OpenStreetMap"} · ${map.edges.size} segments · ${status.configured ? "Jev available" : "no API key: Rules only"}`;
  $("#npcs").value = status.npcs;
  if (!status.configured) $("#brain").querySelector('option[value="jev"]').disabled = true;
  $("#run").addEventListener("click", () => (running ? (stopRequested = true) : runFromForm()));
  $("#compare").addEventListener("change", () => lastRun && render(lastRun));
  await loadRuns();
}

async function loadRuns() {
  const { runs } = await api("/api/bench/runs");
  const sel = $("#compare");
  const keep = sel.value;
  sel.replaceChildren(h("option", { value: "" }, "none"), ...runs.map((r) => h("option", { value: r.name },
    `${r.name} · ${r.config?.brain} · ${r.config?.count} × seed ${r.config?.seed} · ${Math.round((r.summary?.pass_rate || 0) * 100)}%`)));
  if (keep) sel.value = keep;
  sel._runs = runs;
}

function runFromForm() {
  return run({
    brain: $("#brain").value, count: +$("#count").value, npcs: +$("#npcs").value,
    seed: +$("#seed").value, mode: $("#mode").value,
  });
}

export async function run({ brain = "rules", count = 12, npcs = 40, seed = 1, mode = "lockstep", save = true } = {}) {
  running = true; stopRequested = false;
  $("#run").textContent = "Stop";
  const config = { brain, count, npcs, seed, mode, map: status.map.name, pack: map.pack.pack_version, started_at: new Date().toISOString() };
  const setStatus = (t) => { $("#status").textContent = t; };
  setStatus("building the scenario suite…");
  const suite = await buildSuite(map, { count, seed });
  const state = { config, suite, results: [], summary: null };
  lastRun = state;
  render(state);
  for (let i = 0; i < suite.length && !stopRequested; i++) {
    state.current = i;
    setStatus(`running ${i + 1} / ${suite.length}: ${suite[i].tags.length_m} m, ${suite[i].tags.signals} signals, ${suite[i].tags.stops} stops`);
    render(state);
    await yieldNow();
    const r = await runScenario(map, suite[i], { brain, npcs, mode, shouldStop: () => stopRequested });
    state.results.push(r);
    state.summary = aggregate(state.results);
    render(state);
  }
  state.current = null;
  state.summary = aggregate(state.results);
  let saved = null;
  if (save && state.results.length) {
    try {
      saved = await api("/api/bench/save", { config: { ...config, completed: state.results.length }, summary: state.summary, results: state.results });
      setStatus(`saved ${saved.saved}`);
      await loadRuns();
    } catch (err) { setStatus(`could not save: ${err.message}`); }
  } else setStatus(stopRequested ? "stopped" : "done");
  render(state);
  running = false;
  $("#run").textContent = "Run";
  return { config, summary: state.summary, results: state.results, saved };
}

function compareSummary() {
  const name = $("#compare").value;
  const runs = $("#compare")._runs || [];
  return name ? (runs.find((r) => r.name === name) || {}).summary : null;
}

function delta(cur, prev, better, f) {
  if (!better || prev === null || prev === undefined || cur === null || cur === undefined) return null;
  const d = cur - prev;
  const cls = Math.abs(d) < 1e-9 ? "same" : (d < 0) === (better === "low") ? "better" : "worse";
  const text = f === "pct" ? `${d >= 0 ? "+" : ""}${Math.round(d * 100)} pts` : `${d >= 0 ? "+" : ""}${fmt(d, f)}`;
  return h("span", { class: `delta ${cls}` }, text);
}

function render(state) {
  const prev = compareSummary();
  const s = state.summary;
  $("#summary").replaceChildren(...(s ? CARDS.map(([k, label, f, better]) => h("div", { class: "card" },
    h("span", { class: "label" }, label),
    h("span", { class: "value" }, fmt(s[k], f)),
    prev ? delta(s[k], prev[k], better, f) : null)) : []));

  const head = h("tr", {}, h("th", { class: "left" }, "#"), h("th", { class: "left" }, "route"), h("th", { class: "left" }, "result"),
    ...COLUMNS.map(([, label]) => h("th", {}, label)), h("th", {}, ""));
  $("#results thead").replaceChildren(head);
  const rows = state.suite.map((sc, i) => {
    const r = state.results[i];
    const t = sc.tags;
    const route = `${t.length_m} m · ${t.signals}sig ${t.stops}stop ${t.lefts}L ${t.rights}R`;
    if (!r) {
      return h("tr", { class: state.current === i ? "running" : "" }, h("td", {}, i + 1), h("td", { class: "left" }, route),
        h("td", { class: "left muted" }, state.current === i ? "running…" : "queued"), ...COLUMNS.map(() => h("td", {}, "")), h("td", {}, ""));
    }
    const cells = COLUMNS.map(([k, , f]) => {
      const v = r[k];
      const warn = (k === "min_ttc_s" && v !== null && v < 2) || (k === "hard_brakes" && v > 0) || (k === "speeding_s" && v > 3) || (k === "safety_brakes" && v > 0);
      const bad = ["collisions", "at_fault", "red_lights", "stop_signs"].includes(k) && v > 0;
      return h("td", { class: bad ? "failed" : warn ? "warn" : "" }, fmt(v, f));
    });
    return h("tr", { class: r.pass ? "" : "fail" },
      h("td", {}, i + 1), h("td", { class: "left" }, route),
      h("td", { class: `left ${r.pass ? "pass" : "failed"}` }, r.pass ? "PASS" : r.failures.join(", ")),
      ...cells,
      h("td", {}, h("button", { class: "toggle watch", title: "Replay this scenario in the 3D sim", onclick: () => watch(sc, state.config) }, "watch")));
  });
  $("#results tbody").replaceChildren(...rows);
  const foot = s ? h("tr", {}, h("td", {}, ""), h("td", { class: "left" }, `${s.km} km`), h("td", { class: "left" }, `${Math.round(s.pass_rate * 100)}% pass`),
    ...COLUMNS.map(([k, , f]) => h("td", {}, s[k] !== undefined ? fmt(s[k], f) : "")), h("td", {}, "")) : null;
  const table = $("#results");
  table.querySelector("tfoot")?.remove();
  if (foot) table.append(h("tfoot", {}, foot));
}

function watch(sc, config) {
  try { localStorage.setItem("jev-fsd-replay", JSON.stringify({ scenario: sc, brain: config.brain, npcs: config.npcs })); } catch { /* storage off */ }
  window.open("/?replay=1", "_blank");
}

window.__bench = { run, get last() { return lastRun; } };
boot().catch((err) => { $("#status").textContent = `Failed to start: ${err.message}`; console.error(err); });
