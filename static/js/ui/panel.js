// The "What Jev sees" drawer: live state, questions, answers with probability bars, and meta.

import { $, h, pct, ms, usd, num, copyText, api } from "../common.js";
import { decidedBy, decidedByText } from "../bench/metrics.js";
import { describe } from "./hud.js";
import { displaySource, orderedProbabilities } from "./readouts.js";
import { preference } from "./preferences.js";

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function formatLatency(value) {
  return Number.isFinite(value) && value >= 0 ? ms(value) : "–";
}

const tokenCount = (value) => (Number.isFinite(value) && value >= 0 ? num(value) : "–");

const llmRequest = (d) => (Array.isArray(d?.trace?.request?.messages) ? d.trace.request : null);

export class Panel {
  constructor(autopilot, hud) {
    this.autopilot = autopilot;
    this.hud = hud;
    this.el = $("#panel");
    this.body = $("#panel-body");
    this.tabPreference = preference("inspector-tab", "state", undefined, {
      valid: (value) => ["state", "questions", "answers", "meta"].includes(value),
    });
    this.tab = this.tabPreference.read();
    this.latest = null;
    this.displayed = null;
    this.pinned = false;
    this.dirty = true;
    this.inlineMode = null;
    this.snapshotDecision = null;
    this.toggles = [...document.querySelectorAll("[data-inspect]")];
    for (const button of this.toggles) button.addEventListener("click", () => this.toggle(undefined, button));
    $("#panel-close").addEventListener("click", () => this.toggle(false));
    this.tabButtons = [...this.el.querySelectorAll(".tabs [role='tab'], .tabs button")];
    for (const b of this.tabButtons) {
      b.addEventListener("click", () => this.selectTab(b.dataset.tab));
      b.addEventListener("keydown", (ev) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
        if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.isComposing) return;
        ev.preventDefault();
        ev.stopPropagation();
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
    this.candidateToggle = $("#show-candidates");
    const candidatePreference = preference("candidate-overlay", this.candidateToggle.checked);
    this.candidateToggle.checked = candidatePreference.read();
    this.candidateToggle.addEventListener("change", () => {
      candidatePreference.write(this.candidateToggle.checked);
      this.onShowCandidates?.(this.candidateToggle.checked);
    });
    this.inlineError = h("p", { class: "muted", role: "status", hidden: true });
    this.inlineForm?.append(this.inlineError);
    this.lastRender = 0;
  }

  selectTab(name, focus = false) {
    if (!this.tabButtons.some((button) => button.dataset.tab === name)) return;
    this.tab = name;
    this.tabPreference.write(name);
    this.body.setAttribute("aria-labelledby", `inspector-${name}`);
    for (const o of this.tabButtons) {
      const selected = o.dataset.tab === name;
      o.classList.toggle("active", selected);
      o.setAttribute("aria-selected", String(selected));
      o.tabIndex = selected ? 0 : -1;
      if (selected && focus) o.focus();
    }
    // Keep the selected tab and its content in sync when live decisions are throttled.
    this.lastRender = -Infinity;
    if (this.displayedTab !== name) {
      this.body.scrollTop = 0;
      this.body.scrollLeft = 0;
      this.dirty = true;
    }
    this.render();
  }

  togglePin(force) {
    this.pinned = force === undefined ? !this.pinned : !!force;
    if (this.pinned) this.pinnedDecision = this.displayed;
    else this.pinnedDecision = null;
    if (this.pinButton) {
      this.pinButton.classList.toggle("on", this.pinned);
      this.pinButton.setAttribute("aria-pressed", String(this.pinned));
      this.pinButton.textContent = this.pinned ? "Pinned" : "Pin";
    }
    if (!this.pinned && this.latest !== this.displayed) {
      this.lastRender = -Infinity;
      this.dirty = true;
      this.render();
    }
  }

  openInline(mode) {
    if (!this.inlineForm || !this.inlineInput || this.inlineSubmit.disabled) return;
    this.inlineError.hidden = true;
    this.inlineTrigger = mode === "snapshot" ? $("#save-snapshot") : $("#edit-style");
    if (mode === "snapshot") {
      const d = this.displayed;
      if (!d || !Object.keys(d.questions || {}).length) {
        this.hud.badge("No model questions to save for this decision", "", 1200);
        return;
      }
      this.snapshotDecision = d;
      this.inlineMode = "snapshot";
      this.inlineLabel.textContent = "Snapshot name";
      this.inlineInput.value = `snap-${Date.now() % 100000}`;
      this.inlineInput.placeholder = "snapshot-name";
      this.inlineInput.required = true;
      this.inlineSubmit.textContent = "Save";
    } else {
      this.snapshotDecision = null;
      this.inlineMode = "style";
      this.inlineLabel.textContent = "Driving style sent with model requests";
      this.inlineInput.value = this.autopilot.style || "";
      this.inlineInput.placeholder = "calm, smooth, cautious";
      this.inlineInput.required = false;
      this.inlineSubmit.textContent = "Apply";
    }
    this.inlineForm.hidden = false;
    this.inlineInput.focus();
    this.inlineInput.select();
  }

  closeInline(restoreFocus = true) {
    if (restoreFocus && this.inlineForm?.contains(document.activeElement)) this.inlineTrigger?.focus();
    this.inlineMode = null;
    this.snapshotDecision = null;
    if (this.inlineForm) this.inlineForm.hidden = true;
    this.inlineError.hidden = true;
  }

  async submitInline() {
    const mode = this.inlineMode;
    const value = this.inlineInput?.value.trim();
    if (!mode || this.inlineSubmit.disabled) return;
    if (mode === "style") {
      this.autopilot.style = value;
      this.hud.badge(value ? "Driving style updated" : "Custom driving style cleared", "", 900);
      this.closeInline();
      return;
    }
    if (mode === "snapshot") {
      const d = this.snapshotDecision;
      if (!d || !Object.keys(d.questions || {}).length) return;
      if (!value) {
        this.inlineError.textContent = "Enter a snapshot name.";
        this.inlineError.hidden = false;
        this.inlineInput.focus();
        return;
      }
      this.inlineError.hidden = true;
      this.inlineForm.setAttribute("aria-busy", "true");
      this.inlineSubmit.disabled = true;
      this.inlineInput.readOnly = true;
      try {
        const res = await api("/api/snapshot/save", {
          name: value,
          state: d.state,
          questions: d.questions,
          tick: 0,
          epoch: 0,
        });
        this.hud.badge(res.saved ? `Saved ${res.saved}` : "Snapshot saved", "", 1500);
        this.closeInline();
      } catch (err) {
        if (!this.inlineForm.hidden) {
          this.inlineError.textContent = `Could not save snapshot. ${err.message}`;
          this.inlineError.hidden = false;
        } else this.hud.badge(`Could not save snapshot. ${err.message}`, "", 2000);
      } finally {
        this.inlineSubmit.disabled = false;
        this.inlineInput.readOnly = false;
        this.inlineForm.setAttribute("aria-busy", "false");
      }
    }
  }

  toggle(force, trigger = document.activeElement) {
    const open = force === undefined ? this.el.hidden : force;
    if (open === !this.el.hidden) return;
    if (open) this.returnFocus = trigger;
    const restoreFocus = !open && this.el.contains(document.activeElement);
    this.el.hidden = !open;
    if (!open) this.closeInline(false);
    for (const button of this.toggles) {
      button.classList.toggle("on", open);
      button.setAttribute("aria-expanded", String(open));
    }
    if (open) {
      this.selectTab(this.tab, true);
    } else if (restoreFocus) {
      const target = this.returnFocus?.getClientRects().length ? this.returnFocus : $("#view");
      target?.focus({ preventScroll: true });
    }
  }

  set(decision) {
    if (decision === this.latest) return;
    this.latest = decision;
    if (this.pinned) return;
    this.dirty = true;
  }

  render(now = performance.now()) {
    if (this.el.hidden || !this.dirty || now - this.lastRender < 120) return;
    this.lastRender = now;
    this.dirty = false;
    const d = this.pinned ? this.pinnedDecision : this.latest;
    this.displayed = d;
    this.displayedTab = this.tab;
    if (!d) {
      this.body.replaceChildren(h("pre", {}, "No decision yet. Set a destination and enable autopilot."));
      return;
    }
    if (this.tab === "state") {
      this.body.replaceChildren(h("pre", {}, d.state ? JSON.stringify(d.state, null, 1) : "No state was recorded."));
    } else if (this.tab === "questions") {
      const request = llmRequest(d);
      const questions = Object.keys(d.questions || {}).length
        ? JSON.stringify(d.questions, null, 1)
        : "No model questions.";
      this.body.replaceChildren(...(request ? this.renderPrompt(request) : [h("pre", {}, questions)]));
    } else if (this.tab === "answers") this.body.replaceChildren(...this.renderAnswers(d));
    else {
      this.displayedTotals = { ...this.autopilot.totals };
      this.body.replaceChildren(...this.renderMeta(d));
    }
  }

  renderAnswers(d) {
    const out = [];
    const answers = d.answers || {};
    if (!Object.keys(answers).length) out.push(h("pre", {}, "Resolved locally; nothing was asked."));
    for (const [qid, a] of Object.entries(answers)) {
      if (!a) continue;
      const title = a.local ? `${qid} (resolved locally)` : qid;
      out.push(h("div", { class: "label", style: { margin: "8px 0 4px" } }, title));
      const probs = orderedProbabilities(a.probabilities);
      if (!probs.length && a.choice) out.push(h("pre", {}, `Selected ${a.choice}`));
      for (const [key, p] of probs) {
        out.push(
          h(
            "div",
            { class: `bar ${key === a.choice ? "chosen" : ""}` },
            h("span", { class: "name", title: key }, key),
            h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${p * 100}%` } })),
            h("span", {}, pct(p)),
          ),
        );
      }
      if (Number.isFinite(a.confidence) && a.confidence >= 0 && a.confidence <= 1 && !a.local)
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
    const choice = d.candidates?.find((candidate) => candidate.id === d.chosenId);
    out.push(h("pre", {}, choice ? `${describe(choice)} (${d.chosenId})` : d.chosenId || "No manoeuvre recorded"));
    return out;
  }

  // LLM endpoint drivers: the chat messages exactly as sent (the key never reaches the browser).
  renderPrompt(request) {
    const out = [h("div", { class: "muted" }, `${request.model} · POST ${request.url}`)];
    for (const m of request.messages) {
      out.push(
        h("div", { class: "label", style: { margin: "8px 0 4px" } }, m.role),
        h("pre", {}, typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 1)),
      );
    }
    return out;
  }

  renderMeta(d) {
    const m = d.meta || {};
    const candidates = d.candidates || [];
    const flagged = candidates.filter((c) => c.flagged).length;
    const rows = [
      ["source", displaySource(m)],
      ["model", m.model],
      ["latency", formatLatency(m.latency_ms)],
      ["round trip", formatLatency(m.round_trip_ms)],
      ["input tokens", tokenCount(m.input_tokens)],
      ...(m.output_tokens !== undefined ? [["output tokens", tokenCount(m.output_tokens)]] : []),
      ["cost", m.cost_known === false ? "unknown (no price set for this endpoint)" : usd(m.cost_usd)],
      ["questions", Object.keys(d.questions || {}).join(", ") || "none (local)"],
      ...(m.endpoint ? [["endpoint", `${m.endpoint}${m.response_format ? ` · ${m.response_format}` : ""}`]] : []),
      ...(m.reason ? [["model's reason", m.reason]] : []),
      ["hazard flags", (d.flags || []).join(", ") || "none"],
      [
        "candidates",
        `${candidates.filter((c) => c.eligible && !c.flagged).length} eligible${flagged ? `, ${flagged} flagged` : ""} / ${candidates.length}`,
      ],
      ["fallback", m.fallback || m.error || "–"],
    ];
    const t = this.displayedTotals;
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
    if (!d) {
      this.hud.badge("No decision to copy yet", "", 1200);
      return;
    }
    const tab = this.displayedTab;
    const payload =
      tab === "state"
        ? d.state
        : tab === "questions"
          ? llmRequest(d) || d.questions
          : tab === "answers"
            ? { motion: d.motion, chosenId: d.chosenId, answers: d.answers }
            : { meta: d.meta, flags: d.flags, totals: this.displayedTotals };
    if (payload === undefined) {
      this.hud.badge("This decision has no data in the selected tab", "", 1200);
      return;
    }
    this.hud.badge(
      (await copyText(JSON.stringify(payload, null, 2))) ? `Copied ${tab} JSON` : "Clipboard is unavailable",
      "",
      1200,
    );
  }

  async copyCurl() {
    const d = this.displayed;
    if (!d || (!d.trace?.request?.url && !Object.keys(d.questions || {}).length)) {
      this.hud.badge("No model request to copy", "", 1200);
      return;
    }
    // LLM and decision endpoints record their (credential-free) URL and key variable in the trace.
    const request = d.trace?.request?.url ? d.trace.request : null;
    let curl;
    if (request) {
      const { url, api_key_env: keyEnv, ...payload } = request;
      const body = JSON.stringify(payload, null, 2);
      curl = `curl -s --url ${shellQuote(url)} \\\n${/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(keyEnv || "") ? `  -H "Authorization: Bearer $${keyEnv}" \\\n` : ""}  -H "Content-Type: application/json" \\\n  -d ${shellQuote(body)}`;
    } else {
      const body = JSON.stringify({ model: "jev-latest", state: d.state, questions: d.questions }, null, 2);
      curl = `curl -s https://api.typesafe.ai/v1/systemone \\\n  -H "Authorization: Bearer $TYPESAFE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d ${shellQuote(body)}`;
    }
    this.hud.badge((await copyText(curl)) ? "Copied curl command" : "Clipboard is unavailable", "", 900);
  }
}
