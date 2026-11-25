import { api, $, h, usd, appUrl } from "../common.js";
import { downloadCsv, downloadJson } from "../ui/export.js";
import { MapData } from "../map/mapdata.js";
import { CHALLENGES, CHALLENGE_VERSION } from "./challenges.js";
import { evaluateChallenge } from "./evaluation.js";
import { agentDefinitions, registerAgent, agentOptionLabel } from "../brain/registry.js";
import { registerLlmAgents, checkLlmEndpoints, llmSummary } from "../brain/llm.js";
import { registerDecisionAgents, checkDecisionEndpoints, decisionSummary } from "../brain/decision.js";
import { readHistory } from "../sim/drive-score.js";
import {
  EVALUATION_SCHEMA,
  MAX_IMPORT_BYTES,
  validateEvaluation,
  openEvaluationHistory,
  compareResult,
  incidentCount,
  summarizeResults,
} from "./history.js";
import { ROAD_TESTS } from "./road-tests.js";
import { decidedByText } from "../bench/metrics.js";
import { driveScores, rankDrivers, scoresText } from "../bench/scores.js";
import { CUSTOM_SUITE, suiteVersion } from "../bench/suite-version.js";
import { examine } from "./examiner.js";
import { arenaDrives, arenaOutcome, filterArenaResults, filterTimeline, timelineTypes } from "./arena-view.js";

let running = false,
  editingHistory = false,
  stop = false,
  results = [],
  current = null,
  saved = [],
  history = null,
  detailsTrigger = null;
const agentLabel = (id) => agentDefinitions().find((a) => a.id === id)?.label || id;
const challengeLabel = (id) =>
  CHALLENGES.find((c) => c.id === id)?.title || ROAD_TESTS.find((t) => t.id === id)?.title || id;
// (a road test is also marked on the examiner's sheet, from its report: lab/examiner.js)
const roadTestVerdict = (r) => {
  const test = ROAD_TESTS.find((t) => t.id === r.challenge),
    sheet = test && !r.stopped ? examine(test, r.report) : null;
  return sheet?.available
    ? h(
        "small",
        { class: "delta" },
        `${sheet.pass ? "Licensed" : "Not licensed"} · ${sheet.demerits} demerit${sheet.demerits === 1 ? "" : "s"}${sheet.fails.length ? ` · ${sheet.fails.map((f) => f.remark).join("; ")}` : ""}`,
      )
    : null;
};
const percent = (n) => `${Math.round(n * 100)}%`;
const signed = (n, digits = 0) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
const runLabel = (run) =>
  `${new Date(run.created_at).toLocaleString()} · ${suiteVersion(run)} · ${run.status} · ${run.results.length} attempts · ${[...new Set(run.results.map((r) => r.mode))].join(" / ")}${run.results.some((r) => r.track === "open") ? " · open track" : ""}`;
const visibleRun = () => ($("#arena-history").value === "current" ? current : saved[Number($("#arena-history").value)]);
const baselineRun = () => ($("#arena-baseline").value === "" ? null : saved[Number($("#arena-baseline").value)]);

const COLUMNS = [
  ["Agent / challenge", (r) => `${agentLabel(r.brain)} · ${challengeLabel(r.challenge)}`],
  ["Outcome", arenaOutcome],
  ["Score", (r) => (r.report.qualified ? r.report.score : null)],
  ["Ranking score", (r) => driveScores(r).score],
  ["Time", (r) => r.time_s],
  ["Track", (r) => r.track ?? "guarded"],
  ["Flagged choices", (r) => r.flagged_choices ?? null],
  ["Incidents", incidentCount],
  ["Hard brakes", (r) => r.hard_brakes],
  ["p50", (r) => r.latency_p50_ms],
  ["Cost", (r) => r.cost_usd],
];
let tableSort = null;
let sortDirection = 1;

const ARENA_FILTERS = ["#arena-search", "#arena-filter-agent", "#arena-filter-outcome", "#arena-filter-track"];

function filteredResults(shown) {
  const list = filterArenaResults(
    shown,
    {
      query: $("#arena-search").value,
      agent: $("#arena-filter-agent").value,
      verdict: $("#arena-filter-outcome").value,
      track: $("#arena-filter-track").value,
    },
    { agent: agentLabel, challenge: challengeLabel },
  );
  if (tableSort === null) return list;
  const [, value] = COLUMNS[tableSort];
  return list
    .map((r) => [r, value(r)])
    .sort(([, a], [, b]) => {
      if (a == null || b == null) return Number(a == null) - Number(b == null);
      return sortDirection * (typeof a === "number" ? a - b : a.localeCompare(b));
    })
    .map(([r]) => r);
}

function exportName(run, suffix) {
  return `jev-agent-evaluation-${run.created_at.replace(/[^0-9]+/g, "-").replace(/-$/, "")}.${suffix}`;
}
function agents() {
  const selection = new Set([...$("#agents").querySelectorAll("input:checked")].map((i) => i.value));
  $("#agents").replaceChildren(
    ...agentDefinitions().map((a) =>
      h(
        "label",
        {
          title:
            a.decision || a.llm
              ? `${(a.decision || a.llm).model} at ${(a.decision || a.llm).endpoint}`
              : a.description || null,
        },
        h("input", {
          type: "checkbox",
          value: a.id,
          checked:
            (selection.size ? selection.has(a.id) : a.id === "rules" || a.id === "cautious") && a.available !== false,
          disabled: a.available === false || running || editingHistory,
        }),
        agentOptionLabel(a),
      ),
    ),
  );
}
function historyControls(baseline = null) {
  const view = $("#arena-history").value;
  $("#arena-history").replaceChildren(
    h("option", { value: "current" }, "Current evaluation"),
    ...saved.map((run, i) => h("option", { value: i }, runLabel(run))),
  );
  $("#arena-baseline").replaceChildren(
    h("option", { value: "" }, "No baseline"),
    ...saved.map((run, i) => h("option", { value: i }, runLabel(run))),
  );
  $("#arena-history").value = view === "current" || !saved[Number(view)] ? "current" : view;
  // IndexedDB keeps the saved run objects. The localStorage fallback reads fresh copies.
  let baselineIndex = baseline ? saved.indexOf(baseline) : -1;
  if (baseline && baselineIndex < 0) {
    const json = JSON.stringify(baseline);
    baselineIndex = saved.findIndex((r) => JSON.stringify(r) === json);
  }
  $("#arena-baseline").value = baselineIndex >= 0 ? String(baselineIndex) : "";
  baselineAgents();
}
function baselineAgents() {
  const select = $("#arena-baseline-agent"),
    previous = select.value,
    baseline = baselineRun();
  const ids = [...new Set(baseline?.results.map((r) => r.brain) || [])];
  select.replaceChildren(...ids.map((id) => h("option", { value: id }, agentLabel(id))));
  if (ids.includes(previous)) select.value = previous;
  select.disabled = !ids.length || running || editingHistory;
}
function delta(result, before, metric, format = (n) => signed(n)) {
  if (!before || !Number.isFinite(result[metric]) || !Number.isFinite(before[metric])) return null;
  return h("small", { class: "delta" }, `${format(result[metric] - before[metric])} vs baseline`);
}
function render() {
  const run = visibleRun(),
    shown = run?.results || [],
    baseline = baselineRun(),
    brain = $("#arena-baseline-agent").value;
  const comparisons = shown.map((r) => (baseline ? compareResult(r, baseline, brain) : {}));
  const byResult = new Map(shown.map((r, i) => [r, comparisons[i]]));
  const agentFilter = $("#arena-filter-agent");
  const agentValue = agentFilter.value;
  agentFilter.replaceChildren(
    h("option", { value: "" }, "All agents"),
    ...[...new Set(shown.map((r) => r.brain))].map((id) => h("option", { value: id }, agentLabel(id))),
  );
  if ([...agentFilter.options].some((option) => option.value === agentValue)) agentFilter.value = agentValue;
  const focus = document.activeElement?.dataset.arenaSort;
  $("#arena-columns").replaceChildren(
    h(
      "tr",
      {},
      COLUMNS.map(([label], index) =>
        h(
          "th",
          { "aria-sort": tableSort === index ? (sortDirection === 1 ? "ascending" : "descending") : null },
          h(
            "button",
            {
              type: "button",
              class: "table-sort",
              "data-arena-sort": index,
              onclick: () => {
                sortDirection = tableSort === index ? -sortDirection : 1;
                tableSort = index;
                render();
              },
            },
            label,
          ),
        ),
      ),
    ),
  );
  if (focus !== undefined) $(`[data-arena-sort="${focus}"]`)?.focus();
  const filtered = filteredResults(shown);
  $("#arena-results").replaceChildren(
    ...(filtered.length
      ? filtered.map((r) => {
          const comparison = byResult.get(r),
            before = comparison.before;
          return h(
            "tr",
            {},
            h(
              "td",
              {},
              h(
                "button",
                {
                  class: "result-button",
                  onclick: (event) => details(r, event.currentTarget),
                  "aria-label": `Inspect ${agentLabel(r.brain)} on ${challengeLabel(r.challenge)}`,
                },
                agentLabel(r.brain),
              ),
              h("small", {}, challengeLabel(r.challenge)),
              comparison.reasons?.length
                ? h("small", { class: "comparison-note" }, `Not compared: ${comparison.reasons.join(", ")}`)
                : null,
            ),
            h(
              "td",
              { class: r.pass ? "pass" : "fail" },
              r.stopped
                ? "STOPPED"
                : r.simulation_error
                  ? `ERROR · ${r.simulation_error}`
                  : r.pass
                    ? "PASS"
                    : r.failures.join(", "),
              roadTestVerdict(r),
              decidedByText(r) ? h("small", { class: "delta" }, `Decisions: ${decidedByText(r)}`) : null,
              before
                ? h(
                    "small",
                    { class: "delta" },
                    before.pass === r.pass ? "Same outcome" : before.pass ? "Baseline passed" : "Baseline failed",
                  )
                : null,
            ),
            h("td", {}, r.report.qualified ? r.report.score : "Practice"),
            // (computed from the result when shown, never saved: bench/scores.js)
            ((s) =>
              h(
                "td",
                {},
                s.score,
                h(
                  "small",
                  { class: "delta" },
                  `comfort ${s.comfort} · margin ${s.margin} · lost ${s.time_lost_s_per_km ?? "–"} s/km`,
                ),
                before
                  ? h("small", { class: "delta" }, `${signed(s.score - driveScores(before).score, 1)} vs baseline`)
                  : null,
              ))(driveScores(r)),
            h(
              "td",
              {},
              `${r.time_s}s`,
              delta(r, before, "time_s", (n) => `${signed(n, 1)} s`),
            ),
            h("td", {}, r.track ?? "guarded"),
            h("td", {}, r.flagged_choices ?? "—", delta(r, before, "flagged_choices")),
            h(
              "td",
              {},
              incidentCount(r),
              before
                ? h("small", { class: "delta" }, `${signed(incidentCount(r) - incidentCount(before))} vs baseline`)
                : null,
            ),
            h("td", {}, r.hard_brakes, delta(r, before, "hard_brakes")),
            h(
              "td",
              {},
              r.latency_p50_ms == null ? "—" : `${r.latency_p50_ms} ms`,
              delta(r, before, "latency_p50_ms", (n) => `${signed(n)} ms`),
            ),
            h(
              "td",
              {},
              usd(r.cost_usd),
              delta(r, before, "cost_usd", (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${usd(Math.abs(n))}`),
            ),
          );
        })
      : [
          h(
            "tr",
            {},
            h(
              "td",
              { colspan: COLUMNS.length },
              shown.length ? "No matching drives." : "Run an evaluation or import a saved export to see results.",
            ),
          ),
        ]),
  );
  $("#arena-match-count").textContent = `${filtered.length} of ${shown.length} attempts`;
  $("#arena-clear-filters").disabled = !ARENA_FILTERS.some((id) => $(id).value);
  $("#arena-csv").disabled = !filtered.length;
  $("#arena-export").disabled = !shown.length || running || editingHistory;
  $("#arena-delete").disabled = $("#arena-history").value === "current" || running || editingHistory;
  const matched = comparisons.filter((c) => c.before).length;
  $("#comparison-status").textContent = baseline
    ? `${matched}/${shown.length} attempts match ${agentLabel(brain)} in the baseline. Deltas use matching conditions only; negative incidents, braking, latency and cost mean less. Imported results are self-reported.`
    : "Choose a saved baseline to compare matching challenge conditions. Imported results are self-reported.";
  // (drivers ranked on the challenges they all finished: more passes first, then the mean score)
  const ids = [...new Set(shown.map((r) => r.brain))];
  const ranked = rankDrivers(
    ids.map((id) => ({ driver: id, results: shown.filter((r) => r.brain === id && !r.stopped) })),
  );
  $("#arena-summary").replaceChildren(
    ...ids.map((id) => {
      const rows = shown.filter((r) => r.brain === id),
        summary = summarizeResults(rows),
        place = ranked.ranking.find((e) => e.driver === id);
      const pairs = rows.map((r) => ({ r, c: byResult.get(r) })).filter((p) => p.c.before);
      const after = summarizeResults(pairs.map((p) => p.r)),
        before = summarizeResults(pairs.map((p) => p.c.before));
      return h(
        "article",
        { class: "agent-summary" },
        h("h3", {}, agentLabel(id)),
        h("p", {}, `${percent(summary.pass_rate)} passes · ${summary.count} attempts · ${summary.incidents} incidents`),
        h(
          "p",
          {},
          `${summary.hard_brakes} hard brakes · ${summary.latency_p50_ms == null ? "—" : `${Math.round(summary.latency_p50_ms)} ms mean of run p50s`} · ${usd(summary.cost_usd)}`,
        ),
        decidedByText(summary) ? h("p", {}, `Decisions: ${decidedByText(summary)}`) : null,
        place?.drives
          ? h(
              "p",
              {},
              `${ids.length > 1 ? `Ranked ${place.rank} of ${ids.length} on the ${place.drives} challenge${place.drives === 1 ? "" : "s"} every driver finished · ` : ""}${scoresText(place)}`,
            )
          : null,
        pairs.length
          ? h(
              "p",
              {},
              `Matched ${pairs.length}: ${signed((after.pass_rate - before.pass_rate) * 100)} pp passes · ${signed(after.incidents - before.incidents)} incidents · ${signed(after.hard_brakes - before.hard_brakes)} hard brakes`,
              h(
                "span",
                { class: "delta" },
                `${after.latency_p50_ms == null || before.latency_p50_ms == null ? "— latency" : `${signed(after.latency_p50_ms - before.latency_p50_ms)} ms mean p50`} · ${signed(after.cost_usd - before.cost_usd, 6)} USD`,
              ),
            )
          : null,
      );
    }),
  );
}
function decisionDetails(decision, age) {
  const repeats = decision.repeats > 1 ? ` · ×${decision.repeats} until ${decision.until_s}s` : "";
  return h(
    "details",
    {},
    h(
      "summary",
      {},
      `Decision at ${decision.at_s}s · ${decision.source} · ${decision.motion} · ${decision.chosen_id || "no candidate"}${repeats}${age == null ? "" : ` · ${age}s before event`}`,
    ),
    decision.error ? h("p", {}, `Fallback: ${decision.error}`) : null,
    h(
      "p",
      {},
      `Hazard flags: ${(decision.flags || []).join(", ") || "none"}. Selected candidates can still produce a poor outcome; emergency braking is shared.`,
    ),
    !decision.context_recorded
      ? h(
          "p",
          {},
          `Compact choice record${decision.repeats > 1 ? `, standing for ${decision.repeats} decisions in a row with the same choice` : ""}. Full candidate and observation snapshots are retained for decisions linked to timeline events.`,
        )
      : null,
    decision.candidates
      ? h(
          "ul",
          { class: "candidate-list" },
          decision.candidates.map((c) =>
            h(
              "li",
              {},
              `${c.id}${c.id === decision.chosen_id ? " · executed" : ""} · ${c.eligible ? (c.reject ? `flagged: ${c.reject}` : "eligible") : `rejected: ${c.reject || "safety filter"}`}${c.target_mps == null ? "" : ` · ${Math.round(c.target_mps * 3.6)} km/h target`}`,
            ),
          ),
        )
      : null,
    decision.state
      ? h(
          "details",
          {},
          h("summary", {}, "Observed state (m/s and metres)"),
          h("pre", {}, JSON.stringify(decision.state, null, 2)),
        )
      : null,
  );
}
function details(result, trigger) {
  detailsTrigger = trigger;
  const trace = result.decisions_trace || [];
  const events = result.events || result.report.incidents;
  const decisions = new Map(trace.map((decision) => [decision.id, decision]));
  const timeline = h("ol", { class: "timeline" });
  const eventCount = h("span", { role: "status" });
  const renderTimeline = (type) => {
    const shown = filterTimeline(events, type);
    eventCount.textContent = ` ${shown.length} of ${events.length} events`;
    timeline.replaceChildren(
      ...shown.map((event) => {
        const decision = decisions.get(event.decision_id);
        return h(
          "li",
          {},
          h("strong", {}, `${event.at_s}s · ${event.message}${event.count > 1 ? ` ×${event.count}` : ""}`),
          decision
            ? decisionDetails(decision, event.decision_age_s)
            : h("p", {}, "No recorded decision context for this event."),
        );
      }),
    );
  };
  renderTimeline("");
  const eventType = h(
    "select",
    { onchange: () => renderTimeline(eventType.value) },
    h("option", { value: "" }, "All events"),
    timelineTypes(events).map((type) => h("option", { value: type }, type.replaceAll("_", " "))),
  );
  $("#details-heading").textContent = `${agentLabel(result.brain)} · ${challengeLabel(result.challenge)}`;
  $("#details-content").replaceChildren(
    ...[
      h(
        "p",
        {},
        `${result.mode} · challenge v${result.version} · map pack ${result.pack} · seed ${result.seed} · ${result.weather} · ${result.time} · ${result.car}`,
      ),
      decidedByText(result)
        ? h(
            "p",
            {},
            `Decisions: ${decidedByText(result)}. Only the model's share is the driver's own; local answers and Rules fallbacks are not.`,
          )
        : null,
      h(
        "p",
        {},
        result.stopped
          ? "Stopped attempts cannot pass."
          : result.pass
            ? "Arrived with no audited failure. Coaching and comfort are reported separately."
            : `Failed: ${result.failures.join(", ")}.`,
      ),
      h(
        "p",
        {},
        "Each event links to the most recent recorded decision, not proof that the decision caused it. Emergency braking and unseen hazards can intervene.",
      ),
      !result.decisions_trace ? h("p", {}, "This older export has scoring incidents but no decision context.") : null,
      result.trace_truncated
        ? h("p", {}, "Recording reached its size limit; some later events or decisions are unavailable.")
        : null,
      events.length > 1 ? h("label", {}, "Event type ", eventType, eventCount) : null,
      events.length ? timeline : h("p", {}, "No incidents recorded."),
      trace.length
        ? h(
            "details",
            {},
            h("summary", {}, `All ${trace.reduce((n, d) => n + (d.repeats || 1), 0)} recorded decisions`),
            ...trace.map((d) => decisionDetails(d)),
          )
        : null,
    ].filter(Boolean),
  );
  $("#arena-details").hidden = false;
  $("#details-heading").focus();
  $("#arena-details").scrollIntoView({ behavior: "instant", block: "start" });
}
function busy(value) {
  $("#arena-run").disabled = editingHistory;
  $("#arena-export").disabled = value || !visibleRun()?.results.length;
  $("#arena-delete").disabled = value || $("#arena-history").value === "current";
  for (const id of [
    "arena-history",
    "arena-baseline",
    "arena-baseline-agent",
    "arena-import",
    "arena-load",
    "arena-mode",
    "arena-track",
    "arena-road-tests",
    "arena-subset",
    "arena-custom",
  ])
    if ($(`#${id}`)) $(`#${id}`).disabled = value;
  $("#agents")
    .querySelectorAll("input")
    .forEach((i) => {
      i.disabled = value || agentDefinitions().find((a) => a.id === i.value)?.available === false;
    });
  if (!value) baselineAgents();
}
async function persist(run) {
  try {
    const previousBaseline = baselineRun();
    saved = await history.save(run, previousBaseline);
    $("#history-status").textContent =
      `Saved on this browser. Up to ${history.limit} recent evaluations are retained within the storage limit; export a permanent copy.`;
    historyControls(previousBaseline);
  } catch (error) {
    $("#history-status").textContent = `Could not save locally: ${error.message}. Export is still available.`;
  }
}
async function run() {
  if (editingHistory) return;
  if (running) {
    stop = true;
    $("#arena-status").textContent = "Stopping after the current decision…";
    return;
  }
  const selected = [...$("#agents").querySelectorAll("input:checked")].map((i) => i.value);
  if (!selected.length) {
    $("#arena-status").textContent = "Select at least one agent.";
    return;
  }
  const subset = $("#arena-subset").value;
  const custom = new Set([...$("#arena-custom").selectedOptions].map((option) => option.value));
  const pool = arenaDrives(CHALLENGES, ROAD_TESTS, {
    subset,
    includeRoadTests: $("#arena-road-tests").checked,
    selected: custom,
  });
  if (!pool.length) {
    $("#arena-status").textContent = "Choose at least one drive.";
    return;
  }
  running = true;
  stop = false;
  results = [];
  current = {
    schema: EVALUATION_SCHEMA,
    suite_version: CUSTOM_SUITE,
    challenge_version: CHALLENGE_VERSION,
    created_at: new Date().toISOString(),
    status: "complete",
    results,
  };
  $("#arena-history").value = "current";
  $("#arena-details").hidden = true;
  busy(true);
  render();
  $("#arena-run").textContent = "Stop evaluation";
  const progress = $("#arena-progress");
  progress.max = pool.length * selected.length;
  progress.value = 0;
  progress.hidden = false;
  const mode = $("#arena-mode").value,
    track = $("#arena-track")?.value === "open" ? "open" : "guarded";
  const packs = new Map();
  try {
    for (const challenge of pool) {
      if (stop) break;
      if (!packs.has(challenge.map)) packs.set(challenge.map, await api(`/api/map?map=${challenge.map}`));
      const map = new MapData(packs.get(challenge.map));
      for (const brain of selected) {
        if (stop) break;
        $("#arena-status").textContent =
          `${challenge.title} · ${agentLabel(brain)} · ${results.length + 1}/${pool.length * selected.length}`;
        const result = await evaluateChallenge(map, challenge, { brain, mode, track, shouldStop: () => stop });
        results.push({ ...result, suite_version: current.suite_version });
        progress.value = results.length;
        render();
      }
    }
    current.status = stop ? "stopped" : "complete";
    $("#arena-status").textContent =
      `${stop ? "Stopped" : "Complete"} · ${results.filter((r) => r.pass).length}/${results.length} passes · ${mode}${track === "open" ? " · open track" : ""}`;
  } catch (error) {
    current.status = "error";
    $("#arena-status").textContent = `Evaluation failed: ${error.message}. Completed attempts are retained.`;
  } finally {
    if (results.length) {
      editingHistory = true;
      busy(true);
      $("#arena-run").textContent = "Saving evaluation…";
      await persist(current);
      editingHistory = false;
    }
    running = false;
    busy(false);
    $("#arena-run").textContent = "Run evaluation";
    render();
  }
}
async function importRun(file) {
  if (!file || running || editingHistory) return;
  editingHistory = true;
  busy(true);
  try {
    if (file.size > MAX_IMPORT_BYTES)
      throw new Error(`Choose an export no larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MiB.`);
    const imported = validateEvaluation(JSON.parse(await file.text()));
    current = imported;
    results = imported.results;
    $("#arena-history").value = "current";
    $("#arena-details").hidden = true;
    await persist(imported);
    $("#arena-status").textContent = `Imported ${results.length} attempts. No agents were executed.`;
  } catch (error) {
    $("#history-status").textContent = `Import failed: ${error.message}`;
  } finally {
    $("#arena-import").value = "";
    editingHistory = false;
    busy(false);
    render();
  }
}
async function boot() {
  history = await openEvaluationHistory();
  saved = await history.list();
  historyControls();
  $("#arena-run").addEventListener("click", run);
  const subset = $("#arena-subset");
  for (const map of new Set(CHALLENGES.map((challenge) => challenge.map)))
    subset.append(h("option", { value: map }, map.replaceAll("-", " ")));
  $("#arena-custom").replaceChildren(
    ...[...CHALLENGES, ...ROAD_TESTS].map((challenge) => h("option", { value: challenge.id }, challenge.title)),
  );
  subset.addEventListener("change", () => {
    $("#arena-custom-wrap").hidden = subset.value !== "custom";
  });
  for (const filter of ARENA_FILTERS)
    $(filter).addEventListener(filter === "#arena-search" ? "input" : "change", render);
  $("#arena-clear-filters").addEventListener("click", () => {
    for (const filter of ARENA_FILTERS) $(filter).value = "";
    render();
    $("#arena-search").focus();
  });
  $("#arena-close-details").addEventListener("click", () => {
    $("#arena-details").hidden = true;
    (detailsTrigger?.isConnected ? detailsTrigger : $("#arena-search")).focus();
    detailsTrigger = null;
  });
  $("#arena-csv").addEventListener("click", () => {
    const run = visibleRun();
    downloadCsv(
      exportName(run, "csv"),
      COLUMNS.map(([label]) => label),
      filteredResults(run.results).map((r) => COLUMNS.map(([, value]) => value(r))),
    );
  });
  $("#arena-history").addEventListener("change", () => {
    $("#arena-details").hidden = true;
    render();
  });
  $("#arena-baseline").addEventListener("change", () => {
    baselineAgents();
    render();
  });
  $("#arena-baseline-agent").addEventListener("change", render);
  $("#arena-import").addEventListener("change", (event) => importRun(event.target.files[0]));
  $("#arena-delete").addEventListener("click", async () => {
    const doomed = saved[Number($("#arena-history").value)];
    if (!doomed || running || editingHistory) return;
    const baseline = baselineRun();
    editingHistory = true;
    busy(true);
    try {
      saved = await history.remove(doomed);
      $("#arena-history").value = "current";
      $("#arena-details").hidden = true;
      historyControls(baseline === doomed ? null : baseline);
      $("#history-status").textContent = "Saved evaluation deleted from this browser.";
    } catch {
      $("#history-status").textContent = "Could not delete: browser storage is unavailable.";
    } finally {
      editingHistory = false;
      busy(false);
      render();
    }
  });
  $("#arena-export").addEventListener("click", () => {
    const run = visibleRun();
    const suite_version = suiteVersion(run);
    downloadJson(exportName(run, "json"), {
      ...run,
      suite_version,
      results: run.results.map((r) => ({ ...r, suite_version })),
    });
  });
  $("#arena-load").addEventListener("click", async () => {
    try {
      const url = new URL($("#agent-module").value, location.href);
      if (url.origin !== location.origin || !url.pathname.endsWith(".js"))
        throw new Error("Choose a trusted .js module served by this app.");
      const definition = (await import(url.href)).default;
      registerAgent(definition);
      agents();
      $("#agents").querySelector(`input[value="${definition.id}"]`).checked = true;
      $("#arena-status").textContent = "Agent loaded and selected for the next evaluation.";
    } catch (error) {
      $("#arena-status").textContent = error.message;
    }
  });
  let attempts = [];
  try {
    attempts = readHistory().filter((r) => r.config?.challenge);
  } catch {
    /* Storage can be unavailable in private or embedded browsers. */
  }
  $("#manual-attempts").replaceChildren(
    ...(attempts.length
      ? attempts.map((r) =>
          h(
            "p",
            {},
            h("a", { href: appUrl("", { challenge: r.config.challenge, drive: "manual" }) }, r.title),
            ` · ${r.driver} · ${r.status} · ${r.qualified ? `${r.score}/100` : "practice"}${r.branched ? " · replay branch" : ""}${r.modified ? " · modified challenge" : ""}`,
          ),
        )
      : [h("p", {}, "Complete a challenge in the simulator to see your drive here.")]),
  );
  render();
  const status = await api("/api/status");
  registerDecisionAgents(status.decision, { demo: !!status.demo });
  registerLlmAgents(status.llm);
  agents();
  const summary = () => {
    $("#llm-status").textContent = `${decisionSummary(status)} ${llmSummary(status)}`;
  };
  summary();
  $("#arena-status").textContent =
    "Ready · no model calls for Rules or the cautious starter. Decision-model and LLM evaluations use your server's API budget.";
  const refresh = () => {
    if (!running) agents();
    summary();
  };
  if (status.decision?.endpoints?.length)
    checkDecisionEndpoints()
      .then(refresh)
      .catch(() => {
        /* keep "configured" */
      });
  if (status.llm?.endpoints?.length)
    checkLlmEndpoints()
      .then(refresh)
      .catch(() => {
        /* keep "configured" */
      });
}
window.__arena = {
  run,
  get results() {
    return results;
  },
};
boot().catch((error) => {
  $("#arena-status").textContent = `Could not open arena: ${error.message}`;
});
