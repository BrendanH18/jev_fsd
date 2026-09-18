// The "What Jev sees" drawer: live state, questions, answers with probability bars, and meta.

import { $, h, pct, ms, usd, num, copyText, api } from "../common.js";

export class Panel {
  constructor(autopilot, hud) {
    this.autopilot = autopilot;
    this.hud = hud;
    this.el = $("#panel");
    this.body = $("#panel-body");
    this.tab = "state";
    this.last = null;
    this.dirty = true;
    $("#panel-toggle").addEventListener("click", () => this.toggle());
    $("#panel-close").addEventListener("click", () => this.toggle(false));
    for (const b of this.el.querySelectorAll(".tabs button")) {
      b.addEventListener("click", () => {
        this.tab = b.dataset.tab;
        for (const o of this.el.querySelectorAll(".tabs button")) o.classList.toggle("active", o === b);
        this.dirty = true;
        this.render();
      });
    }
    $("#copy-curl").addEventListener("click", () => this.copyCurl());
    $("#save-snapshot").addEventListener("click", () => this.saveSnapshot());
    $("#edit-style").addEventListener("click", () => {
      const next = prompt("driving_style (sent with every request):", this.autopilot.style);
      if (next !== null && next.trim()) { this.autopilot.style = next.trim(); this.hud.badge("driving style updated", "", 900); }
    });
    $("#show-candidates").addEventListener("change", (ev) => { this.onShowCandidates?.(ev.target.checked); });
    this.lastRender = 0;
  }

  toggle(force) {
    const open = force === undefined ? this.el.hidden : force;
    this.el.hidden = !open;
    $("#panel-toggle").classList.toggle("on", open);
    if (open) { this.dirty = true; this.render(); }
  }

  set(decision) { this.last = decision; this.dirty = true; }

  render(now = performance.now()) {
    if (this.el.hidden || !this.dirty || now - this.lastRender < 120) return;
    this.lastRender = now;
    this.dirty = false;
    const d = this.last;
    if (!d) { this.body.replaceChildren(h("pre", {}, "No decision yet. Set a destination and press J.")); return; }
    if (this.tab === "state") this.body.replaceChildren(h("pre", {}, JSON.stringify(d.state, null, 1)));
    else if (this.tab === "questions") this.body.replaceChildren(h("pre", {}, JSON.stringify(d.questions, null, 1)));
    else if (this.tab === "answers") this.body.replaceChildren(...this.renderAnswers(d));
    else this.body.replaceChildren(...this.renderMeta(d));
  }

  renderAnswers(d) {
    const out = [];
    const answers = d.answers || {};
    if (!Object.keys(answers).length) out.push(h("pre", {}, "Resolved locally; nothing was asked."));
    for (const [qid, a] of Object.entries(answers)) {
      const title = a.local ? `${qid} (resolved locally)` : qid;
      out.push(h("div", { class: "label", style: { margin: "8px 0 4px" } }, title));
      const probs = Object.entries(a.probabilities || {}).sort((x, y) => y[1] - x[1]);
      for (const [key, p] of probs) {
        out.push(h("div", { class: `bar ${key === a.choice ? "chosen" : ""}` },
          h("span", { class: "name", title: key }, key),
          h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${Math.max(1, p * 100)}%` } })),
          h("span", {}, pct(p))));
      }
      if (a.confidence !== undefined && a.confidence !== null && !a.local) out.push(h("div", { class: "muted" }, `confidence ${pct(a.confidence)}`));
    }
    out.push(h("div", { class: "label", style: { margin: "10px 0 4px" } }, "executing"));
    out.push(h("pre", {}, `${d.motion} → ${d.chosenId}`));
    return out;
  }

  renderMeta(d) {
    const m = d.meta || {};
    const rows = [
      ["source", m.source], ["model", m.model], ["latency", m.latency_ms !== undefined ? ms(m.latency_ms) : "–"],
      ["round trip", m.round_trip_ms !== undefined ? ms(m.round_trip_ms) : "–"], ["input tokens", num(m.input_tokens)],
      ["cost", usd(m.cost_usd)], ["questions", Object.keys(d.questions || {}).join(", ") || "none (local)"],
      ["hazard flags", (d.flags || []).join(", ") || "none"], ["candidates", `${d.candidates.filter((c) => c.eligible).length} eligible / ${d.candidates.length}`],
      ["fallback", m.fallback || m.error || "–"],
    ];
    const t = this.autopilot.totals;
    rows.push(["totals", `${t.decisions} decisions · ${t.calls} live calls · ${num(t.tokens)} tokens · ${usd(t.cost)}`]);
    const kv = h("div", { class: "kv" });
    for (const [k, v] of rows) kv.append(h("span", { class: "label" }, k), h("span", {}, String(v ?? "–")));
    return [kv];
  }

  async copyCurl() {
    const d = this.last;
    if (!d) return;
    const body = JSON.stringify({ model: "jev-latest", state: d.state, questions: d.questions }, null, 2);
    const curl = `curl -s https://api.typesafe.ai/v1/systemone \\\n  -H "Authorization: Bearer $TYPESAFE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
    this.hud.badge((await copyText(curl)) ? "copied curl" : "copy failed", "", 900);
  }

  async saveSnapshot() {
    const d = this.last;
    if (!d || !Object.keys(d.questions || {}).length) { this.hud.badge("nothing to save (local decision)", "", 1200); return; }
    const name = prompt("Snapshot name (data/snapshots/<name>.json):", `snap-${Date.now() % 100000}`);
    if (!name) return;
    try {
      const res = await api("/api/snapshot/save", { name, state: d.state, questions: d.questions, tick: 0, epoch: 0 });
      this.hud.badge(`saved ${res.saved}`, "", 1500);
    } catch (err) {
      this.hud.badge(`save failed: ${err.message}`, "", 2000);
    }
  }
}
