// The "What Jev sees" drawer: live state, questions, answers with probability bars, and meta.

import { $, h, pct, ms, usd, num, copyText, api } from "../common.js";
import { decidedBy, decidedByText } from "../bench/metrics.js";

const llmRequest = (d) => (Array.isArray(d?.trace?.request?.messages) ? d.trace.request : null);

export class Panel {
  constructor(autopilot, hud) {
    this.autopilot = autopilot;
    this.hud = hud;
    this.el = $("#panel");
    this.body = $("#panel-body");
    this.tab = "state";
    this.last = null;
    this.latest = null;
    this.displayed = null;
    this.pinned = false;
    this.dirty = true;
    this.inlineMode = null;
    this.snapshotDecision = null;
    this.toggles = [...document.querySelectorAll("[data-inspect]")];
    for (const button of this.toggles) button.addEventListener("click", () => this.toggle());
    $("#panel-close").addEventListener("click", () => this.toggle(false));
    this.tabButtons = [...this.el.querySelectorAll(".tabs [role='tab'], .tabs button")];
    for (const b of this.tabButtons) {
      b.addEventListener("click", () => this.selectTab(b.dataset.tab));
      b.addEventListener("keydown", (ev) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
        ev.preventDefault();
        const i = this.tabButtons.indexOf(b);
        const next =
          ev.key === "Home"
            ? this.tabButtons[0]
            : ev.key === "End"
              ? this.tabButtons.at(-1)
              : this.tabButtons[
                  (i + (ev.key === "ArrowLeft" ? -1 : 1) + this.tabButtons.length) % this.tabButtons.length
                ];
        this.selectTab(next.dataset.tab, true);
      });
    }
    this.pinButton = $("#pin-decision");
    this.pinButton?.addEventListener("click", () => this.togglePin());
    $("#copy-json")?.addEventListener("click", () => this.copyJson());
    $("#copy-curl").addEventListener("click", () => this.copyCurl());
    $("#save-snapshot").addEventListener("click", () => this.openInline("snapshot"));
    $("#edit-style").addEventListener("click", () => this.openInline("style"));
    this.inlineForm = $("#panel-inline");
    this.inlineLabel = $("#panel-inline-label");
    this.inlineInput = $("#panel-inline-input");
    this.inlineSubmit = $("#panel-inline-submit");
    $("#panel-inline-cancel")?.addEventListener("click", () => this.closeInline());
    this.inlineForm?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.submitInline();
    });
    this.inlineInput?.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        this.closeInline();
      }
    });
    $("#show-candidates").addEventListener("change", (ev) => {
      this.onShowCandidates?.(ev.target.checked);
    });
    this.lastRender = 0;
  }

  selectTab(name, focus = false) {
    this.tab = name;
    for (const o of this.tabButtons) {
      const selected = o.dataset.tab === name;
      o.classList.toggle("active", selected);
      o.setAttribute("aria-selected", String(selected));
      o.tabIndex = selected ? 0 : -1;
      if (selected && focus) o.focus();
    }
    this.dirty = true;
    this.render();
  }

  togglePin(force) {
    this.pinned = force === undefined ? !this.pinned : !!force;
    if (this.pinned && this.displayed) this.last = this.displayed;
    if (this.pinButton) {
      this.pinButton.classList.toggle("on", this.pinned);
      this.pinButton.setAttribute("aria-pressed", String(this.pinned));
      this.pinButton.textContent = this.pinned ? "Pinned" : "Pin";
    }
    if (!this.pinned && this.latest !== this.last) {
      this.last = this.latest;
      this.dirty = true;
      this.render();
    }
  }

  openInline(mode) {
    if (!this.inlineForm || !this.inlineInput) return;
    if (mode === "snapshot") {
      const d = this.displayed;
      if (!d || !Object.keys(d.questions || {}).length) {
        this.hud.badge("nothing to save (local decision)", "", 1200);
        return;
      }
      this.snapshotDecision = d;
      this.inlineMode = "snapshot";
      this.inlineLabel.textContent = "Snapshot name (data/snapshots/<name>.json)";
      this.inlineInput.value = `snap-${Date.now() % 100000}`;
      this.inlineInput.placeholder = "snapshot-name";
      this.inlineSubmit.textContent = "Save";
    } else {
      this.snapshotDecision = null;
      this.inlineMode = "style";
      this.inlineLabel.textContent = "driving_style (sent with every request)";
      this.inlineInput.value = this.autopilot.style || "";
      this.inlineInput.placeholder = "calm, smooth, cautious";
      this.inlineSubmit.textContent = "Apply";
    }
    this.inlineForm.hidden = false;
    this.inlineInput.focus();
    this.inlineInput.select();
  }

  closeInline() {
    this.inlineMode = null;
    this.snapshotDecision = null;
    if (this.inlineForm) this.inlineForm.hidden = true;
  }

  async submitInline() {
    const mode = this.inlineMode;
    const value = this.inlineInput?.value.trim();
    if (!mode) return;
    if (mode === "style") {
      if (value) {
        this.autopilot.style = value;
        this.hud.badge("driving style updated", "", 900);
      }
      this.closeInline();
      return;
    }
    if (mode === "snapshot") {
      const d = this.snapshotDecision;
      if (!value || !d || !Object.keys(d.questions || {}).length) {
        this.closeInline();
        return;
      }
      this.inlineSubmit.disabled = true;
      try {
        const res = await api("/api/snapshot/save", {
          name: value,
          state: d.state,
          questions: d.questions,
          tick: 0,
          epoch: 0,
        });
        this.hud.badge(`saved ${res.saved}`, "", 1500);
        this.closeInline();
      } catch (err) {
        this.hud.badge(`save failed: ${err.message}`, "", 2000);
      } finally {
        this.inlineSubmit.disabled = false;
      }
    }
  }

  toggle(force) {
    const open = force === undefined ? this.el.hidden : force;
    this.el.hidden = !open;
    if (!open) this.closeInline();
    for (const button of this.toggles) {
      button.classList.toggle("on", open);
      button.setAttribute("aria-expanded", String(open));
    }
    if (open) {
      this.dirty = true;
      this.render();
    }
  }

  set(decision) {
    this.latest = decision;
    if (this.pinned && this.last) return;
    this.last = decision;
    this.dirty = true;
  }

  render(now = performance.now()) {
    if (this.el.hidden || !this.dirty || now - this.lastRender < 120) return;
    this.lastRender = now;
    this.dirty = false;
    const d = this.last;
    this.displayed = d;
    this.displayedTab = this.tab;
    if (!d) {
      this.body.replaceChildren(h("pre", {}, "No decision yet. Set a destination and press J."));
      return;
    }
    if (this.tab === "state") this.body.replaceChildren(h("pre", {}, JSON.stringify(d.state, null, 1)));
    else if (this.tab === "questions")
      this.body.replaceChildren(
        ...(llmRequest(d) ? this.renderPrompt(llmRequest(d)) : [h("pre", {}, JSON.stringify(d.questions, null, 1))]),
      );
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
        out.push(
          h(
            "div",
            { class: `bar ${key === a.choice ? "chosen" : ""}` },
            h("span", { class: "name", title: key }, key),
            h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${Math.max(1, p * 100)}%` } })),
            h("span", {}, pct(p)),
          ),
        );
      }
      if (a.confidence !== undefined && a.confidence !== null && !a.local)
        out.push(h("div", { class: "muted" }, `confidence ${pct(a.confidence)}`));
    }
    const reply = llmRequest(d) && d.trace.response?.choices?.[0]?.message?.content;
    if (typeof reply === "string") {
      out.push(
        h(
          "div",
          { class: "label", style: { margin: "10px 0 4px" } },
          d.meta?.error ? "model reply (not used)" : "model reply",
        ),
      );
      out.push(h("pre", {}, reply || "(empty)"));
    }
    out.push(h("div", { class: "label", style: { margin: "10px 0 4px" } }, "executing"));
    out.push(h("pre", {}, `${d.motion} → ${d.chosenId}`));
    return out;
  }

  // LLM endpoint drivers: the chat messages exactly as sent (the key never reaches the browser).
  renderPrompt(request) {
    const out = [h("div", { class: "muted" }, `${request.model} · POST ${request.url}`)];
    for (const m of request.messages || []) {
      let text = m.content;
      try {
        text = JSON.stringify(JSON.parse(m.content), null, 1);
      } catch {
        /* plain text */
      }
      out.push(h("div", { class: "label", style: { margin: "8px 0 4px" } }, m.role), h("pre", {}, text));
    }
    return out;
  }

  renderMeta(d) {
    const m = d.meta || {};
    const rows = [
      ["source", m.source],
      ["model", m.model],
      ["latency", m.latency_ms !== undefined ? ms(m.latency_ms) : "–"],
      ["round trip", m.round_trip_ms !== undefined ? ms(m.round_trip_ms) : "–"],
      ["input tokens", num(m.input_tokens)],
      ...(m.output_tokens !== undefined ? [["output tokens", num(m.output_tokens)]] : []),
      ["cost", m.cost_known === false ? "unknown (no price set for this endpoint)" : usd(m.cost_usd)],
      ["questions", Object.keys(d.questions || {}).join(", ") || "none (local)"],
      ...(m.endpoint ? [["endpoint", `${m.endpoint}${m.response_format ? ` · ${m.response_format}` : ""}`]] : []),
      ...(m.reason ? [["model's reason", m.reason]] : []),
      ["hazard flags", (d.flags || []).join(", ") || "none"],
      [
        "candidates",
        `${d.candidates.filter((c) => c.eligible && !c.flagged).length} eligible${
          d.candidates.some((c) => c.flagged) ? `, ${d.candidates.filter((c) => c.flagged).length} flagged` : ""
        } / ${d.candidates.length}`,
      ],
      ["fallback", m.fallback || m.error || "–"],
    ];
    const t = this.autopilot.totals;
    rows.push([
      "totals",
      `${t.decisions} decisions · ${t.calls} live calls · ${num(t.tokens)} tokens · ${usd(t.cost)}`,
    ]);
    // (who made them, for every driver but Rules: bench/metrics.js)
    const decided = decidedByText(decidedBy(this.autopilot));
    if (decided) rows.push(["decided by", decided]);
    const kv = h("div", { class: "kv" });
    for (const [k, v] of rows) kv.append(h("span", { class: "label" }, k), h("span", {}, String(v ?? "–")));
    return [kv];
  }

  async copyJson() {
    const d = this.displayed;
    if (!d) return;
    const tab = this.displayedTab;
    const payload =
      tab === "state"
        ? d.state
        : tab === "questions"
          ? llmRequest(d) || d.questions
          : tab === "answers"
            ? { motion: d.motion, chosenId: d.chosenId, answers: d.answers }
            : { meta: d.meta, flags: d.flags, totals: this.autopilot.totals };
    this.hud.badge((await copyText(JSON.stringify(payload, null, 2))) ? `copied ${tab} JSON` : "copy failed", "", 900);
  }

  async copyCurl() {
    const d = this.displayed;
    if (!d) return;
    // LLM and decision endpoints record their (credential-free) URL and key variable in the trace.
    const request = d.trace?.request?.url ? d.trace.request : null;
    let curl;
    if (request) {
      const { url, api_key_env: keyEnv, ...payload } = request;
      const body = JSON.stringify(payload, null, 2);
      curl = `curl -s ${url} \\\n${keyEnv ? `  -H "Authorization: Bearer $${keyEnv}" \\\n` : ""}  -H "Content-Type: application/json" \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
    } else {
      const body = JSON.stringify({ model: "jev-latest", state: d.state, questions: d.questions }, null, 2);
      curl = `curl -s https://api.typesafe.ai/v1/systemone \\\n  -H "Authorization: Bearer $TYPESAFE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
    }
    this.hud.badge((await copyText(curl)) ? "copied curl" : "copy failed", "", 900);
  }
}
