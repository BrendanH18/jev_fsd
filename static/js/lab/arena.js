import { api, $, h, usd } from "../common.js";
import { MapData } from "../map/mapdata.js";
import { CHALLENGES, CHALLENGE_VERSION } from "./challenges.js";
import { evaluateChallenge } from "./evaluation.js";
import { agentDefinitions, registerAgent } from "../brain/registry.js";
import { readHistory } from "../sim/drive-score.js";
import { EVALUATION_SCHEMA, EVALUATION_HISTORY_KEY, MAX_IMPORT_BYTES, validateEvaluation, readEvaluations,
  saveEvaluation, compareResult, incidentCount, summarizeResults } from "./history.js";

let configured = false, running = false, stop = false, results = [], current = null, saved = [];
const agentLabel = id => agentDefinitions().find(a => a.id === id)?.label || id;
const challengeLabel = id => CHALLENGES.find(c => c.id === id)?.title || id;
const percent = n => `${Math.round(n * 100)}%`;
const signed = (n, digits = 0) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
const runLabel = run => `${new Date(run.created_at).toLocaleString()} · ${run.status} · ${run.results.length} attempts · ${[...new Set(run.results.map(r => r.mode))].join(" / ")}`;
const visibleRun = () => $("#arena-history").value === "current" ? current : saved[Number($("#arena-history").value)];
const baselineRun = () => $("#arena-baseline").value === "" ? null : saved[Number($("#arena-baseline").value)];
function agents() {
  const selection = new Set([...$("#agents").querySelectorAll("input:checked")].map(i => i.value));
  $("#agents").replaceChildren(...agentDefinitions().map(a => h("label", {}, h("input", { type: "checkbox", value: a.id,
    checked: selection.size ? selection.has(a.id) : a.id === "rules" || a.id === "cautious", disabled: a.id === "jev" && !configured }), a.label)));
}
function historyControls() {
  const view = $("#arena-history").value, baseline = $("#arena-baseline").value;
  $("#arena-history").replaceChildren(h("option", { value: "current" }, "Current evaluation"), ...saved.map((run, i) => h("option", { value: i }, runLabel(run))));
  $("#arena-baseline").replaceChildren(h("option", { value: "" }, "No baseline"), ...saved.map((run, i) => h("option", { value: i }, runLabel(run))));
  $("#arena-history").value = view === "current" || !saved[Number(view)] ? "current" : view;
  $("#arena-baseline").value = baseline !== "" && saved[Number(baseline)] ? baseline : "";
  baselineAgents();
}
function baselineAgents() {
  const select = $("#arena-baseline-agent"), previous = select.value, baseline = baselineRun();
  const ids = [...new Set(baseline?.results.map(r => r.brain) || [])];
  select.replaceChildren(...ids.map(id => h("option", { value: id }, agentLabel(id))));
  if (ids.includes(previous)) select.value = previous;
  select.disabled = !ids.length || running;
}
function delta(result, before, metric, format = n => signed(n)) {
  if (!before || !Number.isFinite(result[metric]) || !Number.isFinite(before[metric])) return null;
  return h("small", { class: "delta" }, `${format(result[metric] - before[metric])} vs baseline`);
}
function render() {
  const run = visibleRun(), shown = run?.results || [], baseline = baselineRun(), brain = $("#arena-baseline-agent").value;
  const comparisons = shown.map(r => baseline ? compareResult(r, baseline, brain) : {});
  $("#arena-results").replaceChildren(...(shown.length ? shown.map((r, i) => {
    const comparison = comparisons[i], before = comparison.before;
    return h("tr", {},
      h("td", {}, h("button", { class: "result-button", onclick: () => details(r), "aria-label": `Inspect ${agentLabel(r.brain)} on ${challengeLabel(r.challenge)}` }, agentLabel(r.brain)),
        h("small", {}, challengeLabel(r.challenge)), comparison.reasons?.length ? h("small", { class: "comparison-note" }, `Not compared: ${comparison.reasons.join(", ")}`) : null),
      h("td", { class: r.pass ? "pass" : "fail" }, r.stopped ? "STOPPED" : r.pass ? "PASS" : r.failures.join(", "),
        before ? h("small", { class: "delta" }, before.pass === r.pass ? "Same outcome" : before.pass ? "Baseline passed" : "Baseline failed") : null),
      h("td", {}, r.report.qualified ? r.report.score : "Practice"), h("td", {}, `${r.time_s}s`),
      h("td", {}, incidentCount(r), before ? h("small", { class: "delta" }, `${signed(incidentCount(r) - incidentCount(before))} vs baseline`) : null),
      h("td", {}, r.hard_brakes, delta(r, before, "hard_brakes")),
      h("td", {}, r.latency_p50_ms == null ? "—" : `${r.latency_p50_ms} ms`, delta(r, before, "latency_p50_ms", n => `${signed(n)} ms`)),
      h("td", {}, usd(r.cost_usd), delta(r, before, "cost_usd", n => `${n > 0 ? "+" : n < 0 ? "−" : ""}${usd(Math.abs(n))}`)));
  }) : [h("tr", {}, h("td", { colspan: 8 }, "Run an evaluation or import a saved export to see results."))]));
  $("#arena-export").disabled = !shown.length || running;
  $("#arena-delete").disabled = $("#arena-history").value === "current" || running;
  const matched = comparisons.filter(c => c.before).length;
  $("#comparison-status").textContent = baseline
    ? `${matched}/${shown.length} attempts match ${agentLabel(brain)} in the baseline. Deltas use matching conditions only; negative incidents, braking, latency and cost mean less. Imported results are self-reported.`
    : "Choose a saved baseline to compare matching challenge conditions. Imported results are self-reported.";
  $("#arena-summary").replaceChildren(...[...new Set(shown.map(r => r.brain))].map(id => {
    const rows = shown.filter(r => r.brain === id), summary = summarizeResults(rows);
    const pairs = rows.map(r => ({ r, c: baseline ? compareResult(r, baseline, brain) : {} })).filter(p => p.c.before);
    const after = summarizeResults(pairs.map(p => p.r)), before = summarizeResults(pairs.map(p => p.c.before));
    return h("article", { class: "agent-summary" }, h("h3", {}, agentLabel(id)),
      h("p", {}, `${percent(summary.pass_rate)} passes · ${summary.count} attempts · ${summary.incidents} incidents`),
      h("p", {}, `${summary.hard_brakes} hard brakes · ${summary.latency_p50_ms == null ? "—" : `${Math.round(summary.latency_p50_ms)} ms mean of run p50s`} · ${usd(summary.cost_usd)}`),
      pairs.length ? h("p", {}, `Matched ${pairs.length}: ${signed((after.pass_rate - before.pass_rate) * 100)} pp passes · ${signed(after.incidents - before.incidents)} incidents · ${signed(after.hard_brakes - before.hard_brakes)} hard brakes`,
        h("span", { class: "delta" }, `${after.latency_p50_ms == null || before.latency_p50_ms == null ? "— latency" : `${signed(after.latency_p50_ms - before.latency_p50_ms)} ms mean p50`} · ${signed(after.cost_usd - before.cost_usd, 6)} USD`)) : null);
  }));
}
function decisionDetails(decision, age) {
  return h("details", {}, h("summary", {}, `Decision at ${decision.at_s}s · ${decision.source} · ${decision.motion} · ${decision.chosen_id || "no candidate"}${age == null ? "" : ` · ${age}s before event`}`),
    decision.error ? h("p", {}, `Fallback: ${decision.error}`) : null,
    h("p", {}, `Hazard flags: ${(decision.flags || []).join(", ") || "none"}. Selected candidates can still produce a poor outcome; emergency braking is shared.`),
    !decision.context_recorded ? h("p", {}, "Compact choice record. Full candidate and observation snapshots are retained for decisions linked to timeline events.") : null,
    decision.candidates ? h("ul", { class: "candidate-list" }, decision.candidates.map(c => h("li", {},
      `${c.id}${c.id === decision.chosen_id ? " · executed" : ""} · ${c.eligible ? "eligible" : `rejected: ${c.reject || "safety filter"}`}${c.target_mps == null ? "" : ` · ${Math.round(c.target_mps * 3.6)} km/h target`}`))) : null,
    decision.state ? h("details", {}, h("summary", {}, "Observed state (m/s and metres)"), h("pre", {}, JSON.stringify(decision.state, null, 2))) : null);
}
function details(result) {
  const trace = result.decisions_trace || [];
  const events = result.events || result.report.incidents;
  $("#details-heading").textContent = `${agentLabel(result.brain)} · ${challengeLabel(result.challenge)}`;
  $("#details-content").replaceChildren(...[
    h("p", {}, `${result.mode} · challenge v${result.version} · map pack ${result.pack} · seed ${result.seed} · ${result.weather} · ${result.time} · ${result.car}`),
    h("p", {}, result.stopped ? "Stopped attempts cannot pass." : result.pass ? "Arrived with no audited failure. Coaching and comfort are reported separately." : `Failed: ${result.failures.join(", ")}.`),
    h("p", {}, "Each event links to the most recent recorded decision, not proof that the decision caused it. Emergency braking and unseen hazards can intervene."),
    !result.decisions_trace ? h("p", {}, "This older export has scoring incidents but no decision context.") : null,
    result.trace_truncated ? h("p", {}, "Recording reached its size limit; some later events or decisions are unavailable.") : null,
    events.length ? h("ol", { class: "timeline" }, events.map(event => {
      const decision = trace.find(d => d.id === event.decision_id);
      return h("li", {}, h("strong", {}, `${event.at_s}s · ${event.message}${event.count > 1 ? ` ×${event.count}` : ""}`),
        decision ? decisionDetails(decision, event.decision_age_s) : h("p", {}, "No recorded decision context for this event."));
    })) : h("p", {}, "No incidents recorded."),
    trace.length ? h("details", {}, h("summary", {}, `All ${trace.length} recorded decisions`), ...trace.map(d => decisionDetails(d))) : null].filter(Boolean));
  $("#arena-details").hidden = false; $("#details-heading").focus(); $("#arena-details").scrollIntoView({ behavior: "instant", block: "start" });
}
function busy(value) {
  for (const id of ["arena-history", "arena-baseline", "arena-baseline-agent", "arena-import", "arena-load", "arena-mode"]) $("#" + id).disabled = value;
  $("#agents").querySelectorAll("input").forEach(i => { i.disabled = value || i.value === "jev" && !configured; });
  if (!value) baselineAgents();
}
function persist(run) {
  try {
    const previousBaseline = baselineRun();
    saved = saveEvaluation(run); $("#history-status").textContent = "Saved on this browser. Up to 10 recent evaluations are retained within the storage limit; export a permanent copy.";
    historyControls();
    const baselineIndex = previousBaseline ? saved.findIndex(r => JSON.stringify(r) === JSON.stringify(previousBaseline)) : -1;
    $("#arena-baseline").value = baselineIndex >= 0 ? String(baselineIndex) : ""; baselineAgents();
  } catch (error) { $("#history-status").textContent = `Could not save locally: ${error.message}. Export is still available.`; }
}
async function run() {
  if (running) { stop = true; $("#arena-status").textContent = "Stopping after the current decision…"; return; }
  const selected = [...$("#agents").querySelectorAll("input:checked")].map(i => i.value);
  if (!selected.length) { $("#arena-status").textContent = "Select at least one agent."; return; }
  running = true; stop = false; results = [];
  current = { schema: EVALUATION_SCHEMA, challenge_version: CHALLENGE_VERSION, created_at: new Date().toISOString(), status: "complete", results };
  $("#arena-history").value = "current"; $("#arena-details").hidden = true; busy(true); render(); $("#arena-run").textContent = "Stop evaluation";
  const mode = $("#arena-mode").value;
  try {
    for (const challenge of CHALLENGES) {
      if (stop) break;
      const pack = await api(`/api/map?map=${challenge.map}`), map = new MapData(pack);
      for (const brain of selected) {
        if (stop) break;
        $("#arena-status").textContent = `${challenge.title} · ${agentLabel(brain)} · ${results.length + 1}/${CHALLENGES.length * selected.length}`;
        results.push(await evaluateChallenge(map, challenge, { brain, mode, shouldStop: () => stop })); render();
      }
    }
    current.status = stop ? "stopped" : "complete";
    $("#arena-status").textContent = `${stop ? "Stopped" : "Complete"} · ${results.filter(r => r.pass).length}/${results.length} passes · ${mode}`;
  } catch (error) { current.status = "error"; $("#arena-status").textContent = `Evaluation failed: ${error.message}. Completed attempts are retained.`; }
  finally {
    running = false; busy(false); $("#arena-run").textContent = "Run evaluation";
    if (results.length) persist(current); render();
  }
}
async function importRun(file) {
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error("Choose an export smaller than 5 MB.");
    const imported = validateEvaluation(JSON.parse(await file.text()));
    current = imported; results = imported.results; $("#arena-history").value = "current"; $("#arena-details").hidden = true;
    persist(imported); render(); $("#arena-status").textContent = `Imported ${results.length} attempts. No agents were executed.`;
  } catch (error) { $("#history-status").textContent = `Import failed: ${error.message}`; }
  finally { $("#arena-import").value = ""; }
}
async function boot() {
  saved = readEvaluations(); historyControls();
  $("#arena-run").addEventListener("click", run);
  $("#arena-history").addEventListener("change", () => { $("#arena-details").hidden = true; render(); });
  $("#arena-baseline").addEventListener("change", () => { baselineAgents(); render(); });
  $("#arena-baseline-agent").addEventListener("change", render);
  $("#arena-import").addEventListener("change", event => importRun(event.target.files[0]));
  $("#arena-delete").addEventListener("click", () => {
    try {
      const index = Number($("#arena-history").value), remaining = saved.filter((_, i) => i !== index);
      localStorage.setItem(EVALUATION_HISTORY_KEY, JSON.stringify(remaining)); saved = remaining;
      $("#arena-history").value = "current"; $("#arena-baseline").value = ""; $("#arena-details").hidden = true;
      historyControls(); render(); $("#history-status").textContent = "Saved evaluation deleted from this browser.";
    } catch { $("#history-status").textContent = "Could not delete: browser storage is unavailable."; }
  });
  $("#arena-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(visibleRun())], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = h("a", { href: url, download: "jev-agent-evaluation.json" }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("#arena-load").addEventListener("click", async () => {
    try {
      const url = new URL($("#agent-module").value, location.href);
      if (url.origin !== location.origin || !url.pathname.endsWith(".js")) throw new Error("Choose a trusted .js module served by this app.");
      const definition = (await import(url.href)).default; registerAgent(definition); agents();
      $("#agents").querySelector(`input[value="${definition.id}"]`).checked = true;
      $("#arena-status").textContent = "Agent loaded and selected for the next evaluation.";
    } catch (error) { $("#arena-status").textContent = error.message; }
  });
  let attempts = [];
  try { attempts = readHistory().filter(r => r.config?.challenge); } catch { /* Storage can be unavailable in private or embedded browsers. */ }
  $("#manual-attempts").replaceChildren(...(attempts.length ? attempts.map(r => h("p", {}, `${r.title} · ${r.driver} · ${r.status} · ${r.qualified ? `${r.score}/100` : "practice"}${r.branched ? " · replay branch" : ""}${r.modified ? " · modified challenge" : ""}`)) : [h("p", {}, "Complete a challenge in the simulator to see your drive here.")]));
  render();
  const status = await api("/api/status"); configured = status.configured; agents();
  $("#arena-status").textContent = "Ready · no model calls for Rules or the cautious starter. Jev evaluations use your server's API budget.";
}
window.__arena = { run, get results() { return results; } };
boot().catch(error => { $("#arena-status").textContent = `Could not open arena: ${error.message}`; });
