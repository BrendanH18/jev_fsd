import { api, $, h, usd } from "../common.js";
import { MapData } from "../map/mapdata.js";
import { CHALLENGES, CHALLENGE_VERSION } from "./challenges.js";
import { evaluateChallenge } from "./evaluation.js";
import { agentDefinitions, registerAgent } from "../brain/registry.js";
import { readHistory } from "../sim/drive-score.js";

let configured = false, running = false, stop = false, results = [];
function agents() {
  $("#agents").replaceChildren(...agentDefinitions().map(a => h("label", {}, h("input", { type: "checkbox", value: a.id,
    checked: a.id === "rules" || a.id === "cautious", disabled: a.id === "jev" && !configured }), a.label)));
}
function render() {
  $("#arena-results").replaceChildren(...results.map(r => h("tr", {},
    h("td", {}, agentDefinitions().find(a => a.id === r.brain)?.label || r.brain, h("small", {}, CHALLENGES.find(c => c.id === r.challenge)?.title)),
    h("td", { class: r.pass ? "pass" : "fail" }, r.stopped ? "STOPPED" : r.pass ? "PASS" : r.failures.join(", ")),
    h("td", {}, r.report.qualified ? r.report.score : "Practice"), h("td", {}, `${r.time_s}s`),
    h("td", {}, r.collisions + r.red_lights + r.stop_signs + r.failed_to_yield), h("td", {}, r.hard_brakes),
    h("td", {}, r.latency_p50_ms == null ? "—" : `${r.latency_p50_ms} ms`), h("td", {}, usd(r.cost_usd)))));
  $("#arena-export").disabled = !results.length;
}
async function run() {
  if (running) { stop = true; $("#arena-status").textContent = "Stopping after the current decision…"; return; }
  const selected = [...$("#agents").querySelectorAll("input:checked")].map(i => i.value);
  if (!selected.length) { $("#arena-status").textContent = "Select at least one agent."; return; }
  running = true; stop = false; results = []; render(); $("#arena-run").textContent = "Stop evaluation";
  const mode = $("#arena-mode").value;
  try {
    for (const challenge of CHALLENGES) {
      if (stop) break;
      const pack = await api(`/api/map?map=${challenge.map}`), map = new MapData(pack);
      for (const brain of selected) {
        if (stop) break;
        $("#arena-status").textContent = `${challenge.title} · ${brain} · ${results.length + 1}/${CHALLENGES.length * selected.length}`;
        results.push(await evaluateChallenge(map, challenge, { brain, mode, shouldStop: () => stop })); render();
      }
    }
    $("#arena-status").textContent = `${stop ? "Stopped" : "Complete"} · ${results.filter(r => r.pass).length}/${results.length} passes · ${mode}`;
  } catch (error) { $("#arena-status").textContent = `Evaluation failed: ${error.message}`; }
  finally { running = false; $("#arena-run").textContent = "Run evaluation"; }
}
async function boot() {
  const status = await api("/api/status"); configured = status.configured; agents();
  $("#arena-status").textContent = "Ready · no model calls for Rules or the cautious starter. Jev evaluations use your server's API budget.";
  $("#arena-run").addEventListener("click", run);
  $("#arena-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ schema: "jev-agent-evaluation-v1", challenge_version: CHALLENGE_VERSION, created_at: new Date().toISOString(), results }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = h("a", { href: url, download: "jev-agent-evaluation.json" }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("#arena-load").addEventListener("click", async () => {
    try {
      const url = new URL($("#agent-module").value, location.href);
      if (url.origin !== location.origin || !url.pathname.endsWith(".js")) throw new Error("Choose a trusted .js module served by this app.");
      registerAgent((await import(url.href)).default); agents(); $("#arena-status").textContent = "Agent loaded. Select it for the next evaluation.";
    } catch (error) { $("#arena-status").textContent = error.message; }
  });
  const attempts = readHistory().filter(r => r.config?.challenge);
  $("#manual-attempts").replaceChildren(...(attempts.length ? attempts.map(r => h("p", {}, `${r.title} · ${r.driver} · ${r.status} · ${r.qualified ? `${r.score}/100` : "practice"}${r.branched ? " · replay branch" : ""}${r.modified ? " · modified challenge" : ""}`)) : [h("p", {}, "Complete a challenge in the simulator to see your drive here.")]));
}
window.__arena = { run, get results() { return results; } };
boot().catch(error => { $("#arena-status").textContent = `Could not open arena: ${error.message}`; });
