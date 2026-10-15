// "Connect a model": set up a decision-model or LLM driver without editing files, and the ▾ menus
// next to the Decision and LLM buttons for choosing which model each button drives with.
//
// One dialog with a tab per pillar. It picks a provider preset, takes a key and a model, and posts
// them to /api/decision/save or /api/llm/save. The server writes the key to .env and the endpoint to
// its endpoints file, then reloads (jev/llm_setup.py, jev/decision_setup.py). The key is sent once and
// never comes back: the dialog only learns whether a provider already has one saved. On the Decision
// tab, TypeSafe with the built-in Jev's model saves only TYPESAFE_API_KEY, which turns Jev on.

import { api, h } from "../common.js";
import { agentDefinitions, agentOptionLabel } from "../brain/registry.js";
import { decisionIds } from "../brain/decision.js";

const money = v => (v === undefined || v === null || v === "" ? "" : String(Number(v.toFixed ? v.toFixed(4) : v)));

export const KINDS = {
  decision: {
    tab: "Decision models", api: "/api/decision", heading: "Add a decision model", listsWithoutKey: ["openrouter", "typesafe"],
    intro: "Decision models answer the driving questions with probabilities, from exactly the state Jev sees. The key is saved in .env on this computer and never reaches the browser again.",
    prices: "Price, USD per million input tokens (optional; output is free)",
    priceNote: "When the provider reports each call's cost (OpenRouter does), that is counted instead. Spend counts toward JEV_FSD_BUDGET_USD.",
    agents: () => decisionIds().map(id => agentDefinitions().find(d => d.id === id)).filter(Boolean),
  },
  llm: {
    tab: "LLMs", api: "/api/llm", heading: "Add a model", listsWithoutKey: ["openrouter"],
    intro: "Drive with your own LLM. The key is saved in .env on this computer and never reaches the browser again.",
    prices: "Price, USD per million tokens (optional)",
    priceNote: "With prices, spend counts toward JEV_FSD_BUDGET_USD and stops at the cap. Without them, cost shows as unknown.",
    agents: () => agentDefinitions().filter(d => d.llm),
  },
};
const endpointOf = d => d.decision || d.llm;

export class ModelSetup {
  // onSaved(result): the server's {llm, decision, id?, saved?, removed?, notes} after a save or removal.
  // onUse(id): drive with a configured model. onPause(on): pause the world while the dialog is open.
  constructor({ onSaved, onUse, onPause }) {
    Object.assign(this, { onSaved, onUse, onPause });
    this.kind = "decision";
    this.providers = { decision: [], llm: [] };
    this.chosen = {};   // kind -> provider id last selected
    this.models = [];
    this.loadToken = 0;
    this.dialog = h("dialog", { class: "drive-dialog llm-setup", "aria-labelledby": "llm-setup-title" });
    // Escape closes the dialog without close(); the close event can arrive a frame late, so pausing is idempotent.
    this.dialog.addEventListener("close", () => this.setPaused(false));
    this.paused = false;
    document.body.append(this.dialog);
  }

  // `block` is /api/status's `decision` or `llm` block, or the same block from a save reply.
  setStatus(kind, block) {
    if (block?.providers) this.providers[kind] = block.providers;
    if (kind === "decision" && block?.jev) this.jevModel = block.jev.model;
  }

  open(kind = this.kind, providerId = null) {
    if (!this.providers[kind]?.length) return;
    this.kind = kind;
    if (providerId) this.chosen[kind] = providerId;
    const providers = this.providers[kind];
    this.provider = providers.find(p => p.id === this.chosen[kind]) || providers[0];
    this.render();
    if (!this.dialog.open) { this.setPaused(true); this.dialog.showModal(); }
    this.selectProvider(this.provider);
  }
  close() { this.dialog.close(); this.setPaused(false); }
  setPaused(on) { if (this.paused !== on) { this.paused = on; this.onPause(on); } }

  render() {
    const kind = KINDS[this.kind];
    const tab = k => h("button", { type: "button", role: "tab", class: "llm-provider", "data-kind": k, "aria-selected": String(k === this.kind),
      onclick: () => { if (k !== this.kind) this.open(k); } }, KINDS[k].tab);
    const radio = p => h("button", { type: "button", role: "radio", class: "llm-provider", "data-provider": p.id,
      "aria-checked": String(p.id === this.provider.id), onclick: () => this.selectProvider(p) }, p.label);
    this.dialog.replaceChildren(
      h("div", { class: "dialog-header" }, h("h2", { id: "llm-setup-title" }, "Connect a model"),
        h("button", { class: "chip-button", "aria-label": "Close", onclick: () => this.close() }, "×")),
      h("div", { class: "model-tabs", role: "tablist", "aria-label": "Kind of model" }, Object.keys(KINDS).map(tab)),
      h("p", { class: "muted" }, kind.intro),
      this.saved = h("section", { class: "llm-saved", "aria-label": "Your models" }),
      h("h3", { class: "label llm-add-heading" }, kind.heading),
      h("div", { class: "llm-providers", role: "radiogroup", "aria-label": "Provider" }, this.providers[this.kind].map(radio)),
      this.hint = h("p", { class: "muted llm-hint" }),
      this.urlRow = h("label", { class: "llm-field" }, h("span", { class: "label" }, "Server URL"),
        this.url = h("input", { type: "url", placeholder: this.kind === "decision" ? "https://my-server.example.com" : "https://my-server.example.com/v1",
          autocomplete: "off", spellcheck: "false", onchange: () => this.loadModels() })),
      this.keyRow = h("label", { class: "llm-field" }, h("span", { class: "label" }, "API key"),
        h("span", { class: "llm-inline" },
          this.key = h("input", { type: "password", autocomplete: "off", spellcheck: "false", onchange: () => this.loadModels() }),
          this.keyLink = h("a", { target: "_blank", rel: "noopener noreferrer" }, "Get a key ↗"))),
      h("label", { class: "llm-field" }, h("span", { class: "label" }, "Model"),
        h("span", { class: "llm-inline" },
          this.model = h("input", { type: "text", list: "llm-model-list", placeholder: "Start typing to search", autocomplete: "off", spellcheck: "false",
            oninput: () => this.fillPrices() }),
          h("button", { type: "button", class: "chip-button", onclick: () => this.loadModels() }, "Load models")),
        this.list = h("datalist", { id: "llm-model-list" })),
      this.modelStatus = h("p", { class: "muted llm-status", role: "status" }),
      h("fieldset", { class: "llm-prices" }, h("legend", { class: "label" }, kind.prices),
        h("label", {}, "Input ", this.priceIn = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal" })),
        this.priceOutLabel = h("label", { hidden: this.kind === "decision" }, "Output ", this.priceOut = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal" })),
        h("p", { class: "muted" }, kind.priceNote)),
      h("div", { class: "dialog-footer" },
        this.status = h("p", { class: "muted llm-status", role: "status" }),
        this.saveButton = h("button", { type: "button", class: "toggle primary", onclick: () => this.save() }, "Save and drive")));
    this.renderSaved();
  }

  renderSaved() {
    if (!this.saved) return;
    const agents = KINDS[this.kind].agents();
    this.saved.hidden = !agents.length;
    const detail = d => (d.id === "jev" ? `TypeSafe · ${d.available === false ? "no key yet: choose TypeSafe below" : "key set"}`
      : `${endpointOf(d).model} · ${d.note || "configured"}`);
    this.saved.replaceChildren(...(agents.length ? [h("h3", { class: "label" }, "Your models"), ...agents.map(d => h("div", { class: "llm-saved-row" },
      h("span", {}, h("strong", {}, d.label), h("small", { class: "muted" }, detail(d))),
      h("span", { class: "llm-inline" },
        h("button", { type: "button", class: "chip-button", disabled: d.available === false, onclick: () => { this.close(); this.onUse(d.id); } }, "Drive"),
        d.builtin ? null : h("button", { type: "button", class: "chip-button", "aria-label": `Remove ${d.label}`, onclick: () => this.remove(d) }, "Remove"))))] : []));
  }

  selectProvider(p) {
    this.provider = p;
    this.chosen[this.kind] = p.id;
    this.loadToken++;   // a list still loading for the previous provider must not land here
    for (const b of this.dialog.querySelectorAll("[data-provider]")) b.setAttribute("aria-checked", String(b.dataset.provider === p.id));
    this.hint.textContent = p.hint;
    this.urlRow.hidden = p.id !== "custom";
    this.keyRow.hidden = p.local;
    this.key.value = "";
    this.key.placeholder = p.key_set ? `Saved (${p.key_env}). Paste a new key to replace it.` : p.needs_key ? `Paste your ${p.label} key` : "Only if your server needs one";
    this.keyLink.hidden = !p.key_url;
    if (p.key_url) this.keyLink.href = p.key_url;
    this.models = []; this.list.replaceChildren(); this.model.value = ""; this.priceIn.value = ""; this.priceOut.value = ""; this.autoPrices = null;
    this.modelStatus.textContent = ""; this.status.textContent = "";
    // Some lists load without a key (OpenRouter's catalogs, TypeSafe's documented models); others need a saved key or a local server.
    if (KINDS[this.kind].listsWithoutKey.includes(p.id) || p.key_set || p.local) this.loadModels();
    else this.modelStatus.textContent = p.needs_key ? "Paste a key to load the model list, or type a model id." : "";
  }

  async loadModels() {
    const p = this.provider, token = ++this.loadToken;
    if (p.id === "custom" && !this.url.value.trim()) { this.modelStatus.textContent = "Enter the server URL first."; return; }
    this.modelStatus.textContent = "Loading models…";
    try {
      const res = await api(`${KINDS[this.kind].api}/models`, { provider: p.id, base_url: this.url.value.trim() || undefined, api_key: this.key.value.trim() || undefined });
      if (token !== this.loadToken) return;
      this.models = res.models;
      this.list.replaceChildren(...res.models.map(m => h("option", { value: m.id }, priceText(m) ? `${m.name || m.id} · ${priceText(m)}` : m.name || "")));
      const priced = res.models.some(m => m.price_per_mtok_input !== undefined);
      this.modelStatus.textContent = (res.models.length
        ? `${res.models.length} models from ${res.endpoint}${priced ? ", with prices" : ""}. Type to search.`
        : `${res.endpoint} listed no models; type the model id.`) + (res.note ? ` ${res.note}` : "");
      // TypeSafe: start on the built-in Jev's model, so pasting a key and saving turns Jev on.
      if (this.kind === "decision" && p.id === "typesafe" && !this.model.value) this.model.value = this.jevModel || res.models[0]?.id || "";
      this.fillPrices();
    } catch (error) {
      if (token === this.loadToken) this.modelStatus.textContent = error.message;
    }
  }

  // Listed prices fill in; once the id no longer matches a priced model they clear again, so one
  // model's prices (or a free model's $0) never stick to another. Prices typed by hand are kept.
  fillPrices() {
    const m = this.models.find(x => x.id === this.model.value.trim());
    if (m?.price_per_mtok_input !== undefined) {
      this.priceIn.value = money(m.price_per_mtok_input); this.priceOut.value = money(m.price_per_mtok_output);
      this.autoPrices = [this.priceIn.value, this.priceOut.value];
    } else if (this.autoPrices) {   // field by field: a hand-edited input price must not keep the old output price
      [this.priceIn, this.priceOut].forEach((field, i) => { if (field.value === this.autoPrices[i]) field.value = ""; });
      this.autoPrices = null;
    }
  }

  label(model, listed) {
    const p = this.provider;
    if (this.kind === "decision" && p.id === "typesafe") return `Jev ${model.replace(/^jev-/, "")} (TypeSafe)`;
    return listed?.name ? `${listed.name.slice(0, 40)} (${p.label})` : undefined;
  }

  async save() {
    const p = this.provider, kind = this.kind;
    this.saveButton.disabled = true; this.status.textContent = "Saving…";
    try {
      const model = this.model.value.trim(), listed = this.models.find(m => m.id === model);
      const res = await api(`${KINDS[kind].api}/save`, {
        provider: p.id, model, label: this.label(model, listed), base_url: p.id === "custom" ? this.url.value.trim() : undefined,
        api_key: this.key.value.trim() || undefined,
        price_per_mtok_input: this.priceIn.value === "" ? undefined : Number(this.priceIn.value),
        price_per_mtok_output: kind === "decision" || this.priceOut.value === "" ? undefined : Number(this.priceOut.value),
      });
      this.key.value = "";
      await this.applied(res);
      this.provider = this.providers[kind].find(x => x.id === p.id) || p;
      this.status.textContent = res.notes?.length ? res.notes.join(" ") : "Saved.";
      if (!res.notes?.length) { this.close(); this.onUse(res.id); }
    } catch (error) {
      this.status.textContent = error.message;
    } finally {
      this.saveButton.disabled = false;
    }
  }

  async remove(definition) {
    try {
      const res = await api(`${KINDS[this.kind].api}/remove`, { name: endpointOf(definition).name });
      await this.applied(res);
      this.status.textContent = `Removed ${definition.label}.`;
    } catch (error) {
      this.status.textContent = error.message;
    }
  }

  // Both pillars come back after any save: a provider key (OpenRouter's) can serve both.
  async applied(res) {
    for (const kind of Object.keys(KINDS)) this.setStatus(kind, res[kind]);
    await this.onSaved(res);
    this.renderSaved();
  }
}

function priceText(m) {
  if (m.price_per_mtok_input === undefined) return "";
  if (m.price_per_mtok_input === 0 && !m.price_per_mtok_output) return "free";
  return m.price_per_mtok_output ? `$${money(m.price_per_mtok_input)} / $${money(m.price_per_mtok_output)} per M` : `$${money(m.price_per_mtok_input)} per M input`;
}

// A ▾ menu: pick which model a pillar button drives with, or open the setup dialog.
export class ModelMenu {
  // agents(): the definitions to list. current(): the id the button drives with, marked in the menu.
  constructor(toggle, { agents, onPick, onSetup, current, label = "models" }) {
    Object.assign(this, { toggle, agents, onPick, onSetup, current, label });
    this.menu = h("div", { class: "llm-menu panel", role: "menu", "aria-label": toggle.getAttribute("aria-label") || label, hidden: true });
    toggle.after(this.menu);
    toggle.addEventListener("click", () => this.setOpen(this.menu.hidden));
    this.menu.addEventListener("keydown", ev => {
      const items = [...this.menu.querySelectorAll("[role^=menuitem]:not([disabled])")], i = items.indexOf(document.activeElement);
      if (ev.key === "Escape" || ev.key === "ArrowDown" || ev.key === "ArrowUp") ev.stopPropagation();   // not a drive shortcut
      if (ev.key === "Escape") { ev.preventDefault(); this.setOpen(false); toggle.focus(); }
      else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
    });
    document.addEventListener("pointerdown", ev => { if (!this.menu.hidden && !this.menu.contains(ev.target) && ev.target !== toggle) this.setOpen(false); });
  }
  setOpen(open) {
    if (open) this.render();
    this.menu.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    if (open) this.menu.querySelector("[role^=menuitem]:not([disabled])")?.focus();
  }
  render() {
    const current = this.current(), agents = this.agents();
    const pick = id => () => { this.setOpen(false); this.onPick(id); };
    const connected = agents.some(d => !d.builtin);
    this.menu.replaceChildren(
      ...agents.map(d => h("button", { type: "button", role: "menuitemradio", "aria-checked": String(d.id === current), disabled: d.available === false,
        title: endpointOf(d) ? `${endpointOf(d).model} at ${endpointOf(d).endpoint}` : d.description || d.label, onclick: pick(d.id) }, agentOptionLabel(d))),
      h("button", { type: "button", role: "menuitem", class: "llm-menu-setup", onclick: () => { this.setOpen(false); this.onSetup(); } },
        connected ? `Connect or manage ${this.label}…` : `Connect ${this.label === "models" ? "a model" : `a ${this.label.replace(/s$/, "")}`}…`));
  }
}
