// "Connect a model": set up an LLM endpoint driver without editing files, and the ▾ menu next to the
// Rules / Jev / LLM switch for choosing which model the LLM button drives with.
//
// The dialog picks a provider preset, takes a key and a model, and posts them to /api/llm/save. The
// server writes the key to .env and the endpoint to data/llm-endpoints.json, then reloads (see
// jev/llm_setup.py). The key is sent once and never comes back: the dialog only learns whether a
// provider already has one saved.

import { api, h } from "../common.js";
import { agentDefinitions, agentOptionLabel } from "../brain/registry.js";

const money = v => (v === undefined || v === null || v === "" ? "" : String(Number(v.toFixed ? v.toFixed(4) : v)));

export class LlmSetup {
  // onSaved(result): the server's {llm, id?, saved?, removed?, notes} after a save or removal.
  // onUse(id): drive with a configured model. onPause(on): pause the world while the dialog is open.
  constructor({ onSaved, onUse, onPause }) {
    Object.assign(this, { onSaved, onUse });
    this.providers = [];
    this.models = [];
    this.loadToken = 0;
    this.dialog = h("dialog", { class: "drive-dialog llm-setup", "aria-labelledby": "llm-setup-title" });
    // Escape closes the dialog without close(); the close event can arrive a frame late, so pausing is idempotent.
    this.dialog.addEventListener("close", () => this.setPaused(false));
    this.onPause = onPause;
    this.paused = false;
    document.body.append(this.dialog);
  }

  setProviders(providers) { this.providers = providers || []; }

  open() {
    if (!this.providers.length) return;
    this.provider ||= this.providers[0];
    this.render();
    if (!this.dialog.open) { this.setPaused(true); this.dialog.showModal(); }
    this.selectProvider(this.provider);
  }
  close() { this.dialog.close(); this.setPaused(false); }
  setPaused(on) { if (this.paused !== on) { this.paused = on; this.onPause(on); } }

  render() {
    const radio = p => h("button", { type: "button", role: "radio", class: "llm-provider", "data-provider": p.id,
      "aria-checked": String(p.id === this.provider.id), onclick: () => this.selectProvider(p) }, p.label);
    this.dialog.replaceChildren(
      h("div", { class: "dialog-header" }, h("h2", { id: "llm-setup-title" }, "Connect a model"),
        h("button", { class: "chip-button", "aria-label": "Close", onclick: () => this.close() }, "×")),
      h("p", { class: "muted" }, "Drive with your own LLM. The key is saved in .env on this computer and never reaches the browser again."),
      this.saved = h("section", { class: "llm-saved", "aria-label": "Your models" }),
      h("h3", { class: "label llm-add-heading" }, "Add a model"),
      h("div", { class: "llm-providers", role: "radiogroup", "aria-label": "Provider" }, this.providers.map(radio)),
      this.hint = h("p", { class: "muted llm-hint" }),
      this.urlRow = h("label", { class: "llm-field" }, h("span", { class: "label" }, "Server URL"),
        this.url = h("input", { type: "url", placeholder: "https://my-server.example.com/v1", autocomplete: "off", spellcheck: "false",
          onchange: () => this.loadModels() })),
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
      h("fieldset", { class: "llm-prices" }, h("legend", { class: "label" }, "Price, USD per million tokens (optional)"),
        h("label", {}, "Input ", this.priceIn = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal" })),
        h("label", {}, "Output ", this.priceOut = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal" })),
        h("p", { class: "muted" }, "With prices, spend counts toward JEV_FSD_BUDGET_USD and stops at the cap. Without them, cost shows as unknown.")),
      h("div", { class: "dialog-footer" },
        this.status = h("p", { class: "muted llm-status", role: "status" }),
        this.saveButton = h("button", { type: "button", class: "toggle primary", onclick: () => this.save() }, "Save and drive")));
    this.renderSaved();
  }

  renderSaved() {
    if (!this.saved) return;
    const llms = agentDefinitions().filter(d => d.llm);
    this.saved.hidden = !llms.length;
    this.saved.replaceChildren(...(llms.length ? [h("h3", { class: "label" }, "Your models"), ...llms.map(d => h("div", { class: "llm-saved-row" },
      h("span", {}, h("strong", {}, d.label), h("small", { class: "muted" }, `${d.llm.model} · ${d.note || "configured"}`)),
      h("span", { class: "llm-inline" },
        h("button", { type: "button", class: "chip-button", disabled: d.available === false, onclick: () => { this.close(); this.onUse(d.id); } }, "Drive"),
        h("button", { type: "button", class: "chip-button", "aria-label": `Remove ${d.label}`, onclick: () => this.remove(d) }, "Remove"))))] : []));
  }

  selectProvider(p) {
    this.provider = p;
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
    // OpenRouter lists its models without a key; the others need a saved key or a local server.
    if (p.id === "openrouter" || p.key_set || p.local) this.loadModels();
    else this.modelStatus.textContent = p.needs_key ? "Paste a key to load the model list, or type a model id." : "";
  }

  async loadModels() {
    const p = this.provider, token = ++this.loadToken;
    if (p.id === "custom" && !this.url.value.trim()) { this.modelStatus.textContent = "Enter the server URL first."; return; }
    this.modelStatus.textContent = "Loading models…";
    try {
      const res = await api("/api/llm/models", { provider: p.id, base_url: this.url.value.trim() || undefined, api_key: this.key.value.trim() || undefined });
      if (token !== this.loadToken) return;
      this.models = res.models;
      this.list.replaceChildren(...res.models.map(m => h("option", { value: m.id }, priceText(m) ? `${m.name || m.id} · ${priceText(m)}` : m.name || "")));
      const priced = res.models.some(m => m.price_per_mtok_input !== undefined);
      this.modelStatus.textContent = res.models.length
        ? `${res.models.length} models from ${res.endpoint}${priced ? ", with prices" : ""}. Type to search.`
        : `${res.endpoint} listed no models; type the model id.`;
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

  async save() {
    const p = this.provider;
    this.saveButton.disabled = true; this.status.textContent = "Saving…";
    try {
      const model = this.model.value.trim(), listed = this.models.find(m => m.id === model);
      const res = await api("/api/llm/save", {
        provider: p.id, model, label: listed?.name ? `${listed.name.slice(0, 40)} (${p.label})` : undefined, base_url: p.id === "custom" ? this.url.value.trim() : undefined,
        api_key: this.key.value.trim() || undefined,
        price_per_mtok_input: this.priceIn.value === "" ? undefined : Number(this.priceIn.value),
        price_per_mtok_output: this.priceOut.value === "" ? undefined : Number(this.priceOut.value),
      });
      this.key.value = "";
      this.providers = res.llm.providers || this.providers;
      this.provider = this.providers.find(x => x.id === p.id) || p;
      await this.onSaved(res);
      this.renderSaved();
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
      const res = await api("/api/llm/remove", { name: definition.llm.name });
      this.providers = res.llm.providers || this.providers;
      await this.onSaved(res);
      this.renderSaved();
      this.status.textContent = `Removed ${definition.label}.`;
    } catch (error) {
      this.status.textContent = error.message;
    }
  }
}

function priceText(m) {
  if (m.price_per_mtok_input === undefined) return "";
  return m.price_per_mtok_input === 0 && m.price_per_mtok_output === 0 ? "free" : `$${money(m.price_per_mtok_input)} / $${money(m.price_per_mtok_output)} per M`;
}

// The ▾ menu: pick which configured model the LLM button drives with, or open the setup dialog.
export class LlmMenu {
  // current(): the id the LLM button drives with, marked in the menu.
  constructor(toggle, { onPick, onSetup, current }) {
    Object.assign(this, { toggle, onPick, onSetup, current });
    this.menu = h("div", { class: "llm-menu panel", role: "menu", "aria-label": "LLM drivers", hidden: true });
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
    const current = this.current(), llms = agentDefinitions().filter(d => d.llm);
    const pick = id => () => { this.setOpen(false); this.onPick(id); };
    this.menu.replaceChildren(
      ...llms.map(d => h("button", { type: "button", role: "menuitemradio", "aria-checked": String(d.id === current), disabled: d.available === false,
        title: `${d.llm.model} at ${d.llm.endpoint}`, onclick: pick(d.id) }, agentOptionLabel(d))),
      h("button", { type: "button", role: "menuitem", class: "llm-menu-setup", onclick: () => { this.setOpen(false); this.onSetup(); } },
        llms.length ? "Connect or manage models…" : "Connect a model…"));
  }
}
