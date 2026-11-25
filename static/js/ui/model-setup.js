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

const money = (value) => (Number.isFinite(value) && value >= 0 ? String(value) : "");
const hasPrice = (model) => money(model?.price_per_mtok_input) !== "" || money(model?.price_per_mtok_output) !== "";

export const KINDS = {
  decision: {
    tab: "Decision models",
    api: "/api/decision",
    heading: "Add a decision model",
    listsWithoutKey: ["openrouter", "typesafe"],
    intro:
      "Decision models answer the driving questions with probabilities, from exactly the state Jev sees. The key is saved in .env on this computer and never reaches the browser again.",
    prices: "Price, USD per million input tokens (optional; output is free)",
    priceNote:
      "When the provider reports each call's cost (OpenRouter does), that is counted instead. Spend counts toward JEV_FSD_BUDGET_USD.",
    agents: () =>
      decisionIds()
        .map((id) => agentDefinitions().find((d) => d.id === id))
        .filter(Boolean),
  },
  llm: {
    tab: "LLMs",
    api: "/api/llm",
    heading: "Add a model",
    listsWithoutKey: ["openrouter"],
    intro: "Drive with your own LLM. The key is saved in .env on this computer and never reaches the browser again.",
    prices: "Price, USD per million tokens (optional)",
    priceNote:
      "With prices, spend counts toward JEV_FSD_BUDGET_USD and stops at the cap. Without them, cost shows as unknown.",
    agents: () => agentDefinitions().filter((d) => d.llm),
  },
};
const endpointOf = (d) => d.decision || d.llm;

export class ModelSetup {
  // onSaved(result): the server's {llm, decision, id?, saved?, removed?, notes} after a save or removal.
  // onUse(id): drive with a configured model. onPause(on): pause the world while the dialog is open.
  constructor({ onSaved, onUse, onPause, request = api }) {
    Object.assign(this, { onSaved, onUse, onPause, request });
    this.kind = "decision";
    this.providers = { decision: [], llm: [] };
    this.chosen = {}; // kind -> provider id last selected
    this.models = [];
    this.session = 0;
    this.mutation = null;
    this.dialog = h("dialog", { class: "drive-dialog llm-setup", "aria-labelledby": "llm-setup-title" });
    this.dialog.addEventListener("close", () => {
      if (!this.dialog.open) this.endSession();
    });
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
    this.dialog.addEventListener("click", (ev) => {
      if (ev.target !== this.dialog) return;
      const rect = this.dialog.getBoundingClientRect();
      if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom)
        this.close();
    });
    this.paused = false;
    document.body.append(this.dialog);
  }

  // `block` is /api/status's `decision` or `llm` block, or the same block from a save reply.
  setStatus(kind, block) {
    if (Array.isArray(block?.providers)) this.providers[kind] = block.providers;
    if (kind === "decision" && block?.jev) this.jevModel = block.jev.model;
  }

  open(kind = this.kind, providerId = null) {
    if (this.mutation || !this.providers[kind]?.length) return;
    if (this.dialog.open && kind === this.kind && (!providerId || providerId === this.provider.id)) return;
    this.modelRequest?.abort();
    this.session++;
    this.kind = kind;
    if (providerId) this.chosen[kind] = providerId;
    const providers = this.providers[kind];
    this.provider = providers.find((p) => p.id === this.chosen[kind]) || providers[0];
    this.selectedProvider = null;
    this.render();
    if (!this.dialog.open) {
      this.setPaused(true);
      this.dialog.showModal();
    }
    this.selectProvider(this.provider);
  }
  close() {
    this.dialog.close();
    this.endSession();
  }
  endSession() {
    if (!this.paused) return;
    this.session++;
    this.modelRequest?.abort();
    this.modelRequest = null;
    this.key.value = "";
    this.key.type = "password";
    this.setPaused(false);
  }
  setPaused(on) {
    if (this.paused !== on) {
      this.paused = on;
      this.onPause(on);
    }
  }

  render() {
    const kind = KINDS[this.kind];
    const move = (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || this.mutation) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(ev.key)) return;
      const buttons = [...ev.currentTarget.querySelectorAll("button:not([disabled])")];
      const index = buttons.indexOf(ev.target);
      if (index < 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const direction = ["ArrowLeft", "ArrowUp"].includes(ev.key) ? -1 : 1;
      const next =
        ev.key === "Home"
          ? 0
          : ev.key === "End"
            ? buttons.length - 1
            : (index + direction + buttons.length) % buttons.length;
      buttons[next].click();
      const selected =
        ev.currentTarget.getAttribute("role") === "tablist"
          ? this.dialog.querySelector('[role="tab"][aria-selected="true"]')
          : buttons[next];
      selected?.focus();
    };
    const tab = (k) =>
      h(
        "button",
        {
          type: "button",
          role: "tab",
          class: "llm-provider",
          "data-kind": k,
          "aria-selected": String(k === this.kind),
          disabled: !this.providers[k].length,
          tabindex: k === this.kind ? 0 : -1,
          onclick: () => {
            if (k !== this.kind) this.open(k);
          },
        },
        KINDS[k].tab,
      );
    const radio = (p) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          class: "llm-provider",
          "data-provider": p.id,
          "aria-checked": String(p.id === this.provider.id),
          tabindex: p.id === this.provider.id ? 0 : -1,
          onclick: () => this.selectProvider(p),
        },
        p.label,
      );
    this.dialog.replaceChildren(
      h(
        "div",
        { class: "dialog-header" },
        h("h2", { id: "llm-setup-title" }, "Connect a model"),
        h("button", { class: "chip-button", "aria-label": "Close", onclick: () => this.close() }, "×"),
      ),
      h(
        "div",
        { class: "model-tabs", role: "tablist", "aria-label": "Kind of model", onkeydown: move },
        Object.keys(KINDS).map(tab),
      ),
      h("p", { class: "muted" }, kind.intro),
      (this.saved = h("section", { class: "llm-saved", "aria-label": "Your models" })),
      h("h3", { class: "label llm-add-heading" }, kind.heading),
      h(
        "div",
        { class: "llm-providers", role: "radiogroup", "aria-label": "Provider", onkeydown: move },
        this.providers[this.kind].map(radio),
      ),
      (this.hint = h("p", { class: "muted llm-hint" })),
      (this.urlRow = h(
        "label",
        { class: "llm-field" },
        h("span", { class: "label" }, "Server URL"),
        (this.url = h("input", {
          type: "url",
          placeholder: this.kind === "decision" ? "https://my-server.example.com" : "https://my-server.example.com/v1",
          autocomplete: "off",
          spellcheck: "false",
          oninput: () => this.invalidateModelList(),
          onchange: () => this.loadModels(),
        })),
      )),
      (this.keyRow = h(
        "label",
        { class: "llm-field" },
        h("span", { class: "label" }, "API key"),
        h(
          "span",
          { class: "llm-inline" },
          (this.key = h("input", {
            type: "password",
            autocomplete: "off",
            spellcheck: "false",
            oninput: () => this.invalidateModelList(),
            onchange: () => this.loadModels(),
          })),
          (this.showKey = h(
            "button",
            {
              type: "button",
              class: "chip-button",
              "aria-pressed": "false",
              onclick: () => {
                const show = this.key.type === "password";
                this.key.type = show ? "text" : "password";
                this.showKey.textContent = show ? "Hide key" : "Show key";
                this.showKey.setAttribute("aria-pressed", String(show));
              },
            },
            "Show key",
          )),
          (this.keyLink = h("a", { target: "_blank", rel: "noopener noreferrer" }, "Get a key ↗")),
        ),
      )),
      h(
        "label",
        { class: "llm-field" },
        h("span", { class: "label" }, "Model"),
        h(
          "span",
          { class: "llm-inline" },
          (this.model = h("input", {
            type: "text",
            list: "llm-model-list",
            placeholder: "Start typing to search",
            autocomplete: "off",
            spellcheck: "false",
            oninput: () => this.fillPrices(),
          })),
          (this.testButton = h(
            "button",
            { type: "button", class: "chip-button", onclick: () => this.loadModels(true) },
            "Test connection",
          )),
        ),
        (this.list = h("datalist", { id: "llm-model-list" })),
      ),
      (this.modelStatus = h("p", { class: "muted llm-status", role: "status" })),
      h(
        "fieldset",
        { class: "llm-prices" },
        h("legend", { class: "label" }, kind.prices),
        h(
          "label",
          {},
          "Input ",
          (this.priceIn = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal" })),
        ),
        (this.priceOutLabel = h(
          "label",
          { hidden: this.kind === "decision" },
          "Output ",
          (this.priceOut = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal" })),
        )),
        h("p", { class: "muted" }, kind.priceNote),
      ),
      h(
        "div",
        { class: "dialog-footer" },
        (this.status = h("p", { class: "muted llm-status", role: "status" })),
        (this.saveButton = h(
          "button",
          { type: "button", class: "toggle primary", onclick: () => this.save() },
          "Save and drive",
        )),
      ),
    );
    this.priceEdited = [false, false];
    [this.priceIn, this.priceOut].forEach((field, i) => {
      field.addEventListener("input", () => {
        this.priceEdited[i] = true;
      });
    });
    this.renderSaved();
  }

  renderSaved() {
    if (!this.saved) return;
    const agents = KINDS[this.kind].agents();
    this.saved.hidden = !agents.length;
    const detail = (d) =>
      d.id === "jev"
        ? `TypeSafe · ${d.available === false ? "no key yet: choose TypeSafe below" : "key set"}`
        : `${endpointOf(d).model} · ${d.note || "configured"}`;
    this.saved.replaceChildren(
      ...(agents.length
        ? [
            h("h3", { class: "label" }, "Your models"),
            ...agents.map((d) =>
              h(
                "div",
                { class: "llm-saved-row" },
                h("span", {}, h("strong", {}, d.label), h("small", { class: "muted" }, detail(d))),
                h(
                  "span",
                  { class: "llm-inline" },
                  h(
                    "button",
                    {
                      type: "button",
                      class: "chip-button",
                      disabled: d.available === false || !!this.mutation,
                      onclick: () => {
                        this.close();
                        this.onUse(d.id);
                      },
                    },
                    "Drive",
                  ),
                  d.builtin
                    ? null
                    : h(
                        "button",
                        {
                          type: "button",
                          class: "chip-button",
                          "aria-label": `Remove ${d.label}`,
                          disabled: !!this.mutation,
                          onclick: () => this.remove(d),
                        },
                        "Remove",
                      ),
                ),
              ),
            ),
          ]
        : []),
    );
  }

  selectProvider(p) {
    if (this.mutation || this.selectedProvider === p) return;
    this.selectedProvider = p;
    this.provider = p;
    this.chosen[this.kind] = p.id;
    this.invalidateModelList();
    for (const b of this.dialog.querySelectorAll("[data-provider]")) {
      b.setAttribute("aria-checked", String(b.dataset.provider === p.id));
      b.tabIndex = b.dataset.provider === p.id ? 0 : -1;
    }
    this.hint.textContent = p.hint;
    this.urlRow.hidden = p.id !== "custom";
    this.url.value = "";
    this.keyRow.hidden = p.local;
    this.key.value = "";
    this.key.type = "password";
    this.showKey.textContent = "Show key";
    this.showKey.setAttribute("aria-pressed", "false");
    this.key.placeholder = p.key_set
      ? `Saved (${p.key_env}). Paste a new key to replace it.`
      : p.needs_key
        ? `Paste your ${p.label} key`
        : "Only if your server needs one";
    this.keyLink.hidden = !p.key_url;
    if (p.key_url) this.keyLink.href = p.key_url;
    else this.keyLink.removeAttribute("href");
    this.models = [];
    this.list.replaceChildren();
    this.model.value = "";
    this.priceIn.value = "";
    this.priceOut.value = "";
    this.autoPrices = null;
    this.modelStatus.textContent = "";
    this.status.textContent = "";
    // Some lists load without a key (OpenRouter's catalogs, TypeSafe's documented models); others need a saved key or a local server.
    if (KINDS[this.kind].listsWithoutKey.includes(p.id) || p.key_set || p.local) this.loadModels();
    else this.modelStatus.textContent = p.needs_key ? "Paste a key to load the model list, or type a model id." : "";
  }

  invalidateModelList() {
    this.modelRequest?.abort();
    this.modelRequest = null;
    this.models = [];
    this.list.replaceChildren();
    this.testButton.disabled = !!this.mutation;
    this.modelStatus.textContent = "";
    this.modelStatus.removeAttribute("aria-busy");
    this.fillPrices();
  }

  async loadModels(test = false) {
    if (this.mutation || !this.dialog.open) return;
    const p = this.provider;
    this.invalidateModelList();
    if (p.id === "custom" && (!this.url.value.trim() || !this.url.reportValidity())) {
      this.modelStatus.textContent = "Enter a valid server URL first.";
      if (test) this.url.focus();
      return;
    }
    const request = (this.modelRequest = new AbortController());
    this.modelStatus.textContent = test ? "Testing connection…" : "Loading models…";
    this.modelStatus.setAttribute("aria-busy", "true");
    this.testButton.disabled = true;
    try {
      const res = await this.request(
        `${KINDS[this.kind].api}/models`,
        {
          provider: p.id,
          base_url: p.id === "custom" ? this.url.value.trim() : undefined,
          api_key: this.key.value.trim() || undefined,
        },
        { signal: request.signal },
      );
      if (this.modelRequest !== request) return;
      if (!Array.isArray(res?.models)) throw new Error("The provider returned an invalid model list.");
      const models = new Map();
      for (const model of res.models) {
        if (typeof model?.id === "string" && model.id.trim() && !models.has(model.id)) models.set(model.id, model);
      }
      this.models = [...models.values()];
      this.list.replaceChildren(
        ...this.models.map((m) =>
          h("option", { value: m.id }, [m.name || m.id, priceText(m)].filter(Boolean).join(" · ")),
        ),
      );
      const count = this.models.length;
      const endpoint = res.endpoint || p.label;
      this.modelStatus.textContent =
        (count
          ? `${count} ${count === 1 ? "model" : "models"} from ${endpoint}${this.models.some(hasPrice) ? ", with prices" : ""}. Type to search.`
          : `${endpoint} listed no models. Enter a model ID to continue.`) + (res.note ? ` ${res.note}` : "");
      if (this.kind === "decision" && p.id === "typesafe" && !this.model.value)
        this.model.value = this.jevModel || this.models[0]?.id || "";
      this.fillPrices();
    } catch (error) {
      if (this.modelRequest === request) this.modelStatus.textContent = `Could not list models. ${error.message}`;
    } finally {
      if (this.modelRequest === request) {
        this.modelRequest = null;
        this.modelStatus.removeAttribute("aria-busy");
        this.testButton.disabled = !!this.mutation;
      }
    }
  }

  // Prices edited by hand take precedence while the selected model stays the same.
  fillPrices() {
    const id = this.model.value.trim();
    const model = this.models.find((entry) => entry.id === id);
    if (this.priceModel !== id) {
      this.priceModel = id;
      this.priceEdited = [false, false];
    }
    const prices = [model?.price_per_mtok_input, model?.price_per_mtok_output];
    const fields = [this.priceIn, this.priceOut];
    this.autoPrices ??= ["", ""];
    fields.forEach((field, i) => {
      if (this.priceEdited[i]) return;
      const value = money(prices[i]);
      if (!field.value || field.value === this.autoPrices[i]) field.value = value;
      this.autoPrices[i] = value;
    });
  }

  label(model, listed) {
    const p = this.provider;
    if (this.kind === "decision" && p.id === "typesafe") return `Jev ${model.replace(/^jev-/, "")} (TypeSafe)`;
    return listed?.name ? `${listed.name.slice(0, 40)} (${p.label})` : undefined;
  }

  lock(action) {
    this.mutation = action;
    this.status.textContent = action;
    this.dialog.setAttribute("aria-busy", "true");
    this.locked = [...this.dialog.querySelectorAll("button:not(:disabled), input:not(:disabled)")].filter(
      (control) => !control.closest(".dialog-header"),
    );
    for (const control of this.locked) control.disabled = true;
  }

  unlock() {
    this.mutation = null;
    this.dialog.removeAttribute("aria-busy");
    for (const control of this.locked) control.disabled = false;
    this.testButton.disabled = !!this.modelRequest;
    this.renderSaved();
  }

  async save() {
    if (this.mutation) return;
    const p = this.provider;
    const kind = this.kind;
    const model = this.model.value.trim();
    const listed = this.models.find((m) => m.id === model);
    if (!model) {
      this.status.textContent = "Enter a model ID before saving.";
      this.model.focus();
      return;
    }
    if (p.id === "custom" && (!this.url.value.trim() || !this.url.reportValidity())) {
      this.status.textContent = "Enter a valid server URL before saving.";
      this.url.focus();
      return;
    }
    if (!this.priceIn.reportValidity() || (kind === "llm" && !this.priceOut.reportValidity())) return;
    const payload = {
      provider: p.id,
      model,
      label: this.label(model, listed),
      base_url: p.id === "custom" ? this.url.value.trim() : undefined,
      api_key: this.key.value.trim() || undefined,
      price_per_mtok_input: this.priceIn.value === "" ? undefined : Number(this.priceIn.value),
      price_per_mtok_output:
        kind === "decision" || this.priceOut.value === "" ? undefined : Number(this.priceOut.value),
    };
    const session = this.session;
    this.lock("Saving…");
    this.modelRequest?.abort();
    this.modelRequest = null;
    this.modelStatus.removeAttribute("aria-busy");
    this.modelStatus.textContent = "";
    try {
      const res = await this.request(`${KINDS[kind].api}/save`, payload);
      if (session === this.session) {
        this.key.value = "";
        this.key.type = "password";
        this.showKey.textContent = "Show key";
        this.showKey.setAttribute("aria-pressed", "false");
      }
      await this.applied(res);
      if (session !== this.session) return;
      this.provider = this.providers[kind].find((x) => x.id === p.id) || p;
      this.status.textContent = res.notes?.length ? res.notes.join(" ") : "Saved.";
      if (!res.notes?.length && res.id) {
        this.close();
        this.onUse(res.id);
      }
    } catch (error) {
      if (session === this.session) this.status.textContent = `Could not save the model. ${error.message}`;
    } finally {
      this.unlock();
    }
  }

  async remove(definition) {
    if (this.mutation) return;
    this.lock(`Removing ${definition.label}…`);
    try {
      const res = await this.request(`${KINDS[this.kind].api}/remove`, { name: endpointOf(definition).name });
      await this.applied(res);
      this.status.textContent = `Removed ${definition.label}.`;
    } catch (error) {
      this.status.textContent = `Could not remove ${definition.label}. ${error.message}`;
    } finally {
      this.unlock();
    }
  }

  // Both pillars come back after any save: a provider key (OpenRouter's) can serve both.
  async applied(res) {
    for (const kind of Object.keys(KINDS)) this.setStatus(kind, res[kind]);
    await this.onSaved(res);
  }
}

function priceText(m) {
  const input = money(m.price_per_mtok_input);
  const output = money(m.price_per_mtok_output);
  if (input === "0" && output === "0") return "free";
  return [input && `$${input} per M input`, output && `$${output} per M output`].filter(Boolean).join(" / ");
}

// A ▾ menu: pick which model a pillar button drives with, or open the setup dialog.
export class ModelMenu {
  // agents(): the definitions to list. current(): the id the button drives with, marked in the menu.
  constructor(toggle, { agents, onPick, onSetup, current, label = "models" }) {
    Object.assign(this, { toggle, agents, onPick, onSetup, current, label });
    this.menu = h("div", {
      class: "llm-menu panel",
      role: "menu",
      "aria-label": toggle.getAttribute("aria-label") || label,
      hidden: true,
    });
    this.menu.id = `${toggle.id}-menu`;
    toggle.setAttribute("aria-controls", this.menu.id);
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.after(this.menu);
    toggle.addEventListener("keydown", (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey || !["ArrowDown", "ArrowUp"].includes(ev.key)) return;
      ev.preventDefault();
      this.setOpen(true, ev.key === "ArrowUp");
    });
    // Keep the focused item until click, so focusout cannot close and reopen the same menu.
    toggle.addEventListener("pointerdown", (ev) => {
      if (!this.menu.hidden && ev.button === 0) ev.preventDefault();
    });
    toggle.addEventListener("click", () => {
      this.setOpen(this.menu.hidden);
      if (this.menu.hidden) toggle.focus();
    });
    this.menu.addEventListener("keydown", (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.isComposing) return;
      const items = [...this.menu.querySelectorAll("[role^=menuitem]:not([disabled])")],
        i = items.indexOf(document.activeElement);
      if (ev.key === "Escape" || ev.key === "ArrowDown" || ev.key === "ArrowUp") ev.stopPropagation(); // not a drive shortcut
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.setOpen(false);
        toggle.focus();
      } else if (ev.key === "Home" || ev.key === "End") {
        ev.preventDefault();
        (ev.key === "Home" ? items[0] : items.at(-1))?.focus();
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    });
    this.menu.addEventListener("focusout", (ev) => {
      if (!this.menu.contains(ev.relatedTarget)) this.setOpen(false);
    });
    document.addEventListener("pointerdown", (ev) => {
      if (!this.menu.hidden && !this.menu.contains(ev.target) && ev.target !== toggle) this.setOpen(false);
    });
  }
  setOpen(open, last = false) {
    if (open) this.render();
    this.menu.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      const items = [...this.menu.querySelectorAll("[role^=menuitem]:not([disabled])")];
      (last ? items.at(-1) : items[0])?.focus();
    }
  }
  render() {
    const current = this.current(),
      agents = this.agents();
    const pick = (id) => () => {
      this.setOpen(false);
      this.toggle.focus();
      this.onPick(id);
    };
    const connected = agents.some((d) => !d.builtin);
    this.menu.replaceChildren(
      ...agents.map((d) =>
        h(
          "button",
          {
            type: "button",
            role: "menuitemradio",
            tabindex: "-1",
            "aria-checked": String(d.id === current),
            disabled: d.available === false,
            title: endpointOf(d) ? `${endpointOf(d).model} at ${endpointOf(d).endpoint}` : d.description || d.label,
            onclick: pick(d.id),
          },
          agentOptionLabel(d),
        ),
      ),
      h(
        "button",
        {
          type: "button",
          role: "menuitem",
          tabindex: "-1",
          class: "llm-menu-setup",
          onclick: () => {
            this.setOpen(false);
            this.toggle.focus();
            this.onSetup();
          },
        },
        connected
          ? `Connect or manage ${this.label}…`
          : `Connect ${this.label === "models" ? "a model" : `a ${this.label.replace(/s$/, "")}`}…`,
      ),
    );
  }
}
