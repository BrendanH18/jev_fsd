// Photo mode: freeze the world, hide the HUD, frame the car with the free or cinematic camera, adjust
// exposure and grade, and save the rendered frame as a PNG. Only the WebGL canvas is captured, so
// the controls never appear in the photo.

import { h } from "../common.js";
import { formatClock } from "../sim/world-clock.js";
import { preference } from "./preferences.js";

export const LOOK_RANGES = {
  exposure: { min: -2, max: 2, step: 0.1, label: "Exposure", unit: " EV" },
  contrast: { min: -0.3, max: 0.3, step: 0.02, label: "Contrast" },
  saturation: { min: -0.6, max: 0.6, step: 0.02, label: "Saturation" },
  vignette: { min: -0.3, max: 0.6, step: 0.02, label: "Vignette" },
};

export function clampLook(key, value) {
  const range = LOOK_RANGES[key];
  const v = Number(value);
  if (!range || !Number.isFinite(v)) return 0;
  return Math.min(range.max, Math.max(range.min, v));
}

// "jev-kitsilano-vancouver-2026-10-07-1930.png": a readable, sortable, filesystem-safe name.
export function photoFilename(place, date = new Date()) {
  const slug =
    String(place || "drive")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "drive";
  if (!Number.isFinite(date.getTime())) return `jev-${slug}.png`;
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `jev-${slug}-${stamp}.png`;
}

export class PhotoMode {
  constructor({ view, place, getHour, setHour, getWeather, setWeather, onEnter, onExit }) {
    Object.assign(this, { view, place, getHour, setHour, getWeather, setWeather, onEnter, onExit });
    this.active = false;
    this.session = 0;
    this.inputs = {};
    const sliders = Object.entries(LOOK_RANGES).map(([key, range]) => {
      const output = h("output", { class: "photo-value" }, this.describe(key, 0));
      const input = h("input", {
        type: "range",
        min: range.min,
        max: range.max,
        step: range.step,
        value: 0,
        "aria-label": range.label,
        oninput: (ev) => {
          const value = clampLook(key, ev.target.value);
          this.view.setLook({ [key]: value });
          this.updateLookLabel(key, value);
        },
      });
      this.inputs[key] = { input, output };
      return h("label", { class: "photo-slider" }, h("span", { class: "label" }, range.label), input, output);
    });
    this.timeOutput = h("output", { class: "photo-value" }, "");
    this.timeInput = h("input", {
      type: "range",
      min: 0,
      max: 23.75,
      step: 0.25,
      value: 12,
      "aria-label": "Time of day",
      oninput: (ev) => {
        this.setHour(String(ev.target.value));
        this.updateTimeLabel(Number(ev.target.value));
      },
    });
    this.weather = setWeather
      ? h(
          "select",
          { onchange: (ev) => this.setWeather(ev.target.value) },
          ["dry", "rain", "fog", "snow"].map((name) => h("option", { value: name }, name)),
        )
      : null;
    this.grid = h("div", { class: "photo-grid", "aria-hidden": "true", hidden: true });
    const gridPreference = preference("photo-grid", false);
    this.gridToggle = h("input", {
      type: "checkbox",
      checked: gridPreference.read(),
      onchange: (ev) => {
        this.grid.hidden = !ev.target.checked;
        gridPreference.write(ev.target.checked);
      },
    });
    this.cameraButtons = ["orbit", "cinematic", "chase", "hood"].map((mode) =>
      h(
        "button",
        {
          type: "button",
          class: "chip-button",
          "data-photo-camera": mode,
          "aria-pressed": "false",
          onclick: () => this.setCamera(mode),
        },
        { orbit: "Free", cinematic: "Cinematic", chase: "Chase", hood: "Hood" }[mode],
      ),
    );
    this.status = h("p", { class: "photo-status", role: "status", "aria-live": "polite" });
    this.panel = h(
      "section",
      {
        id: "photo-panel",
        class: "photo-panel panel",
        tabindex: "-1",
        "aria-label": "Photo mode",
        hidden: true,
        onkeydown: (ev) => {
          if (ev.key === "Escape" && !ev.isComposing) {
            ev.preventDefault();
            ev.stopPropagation();
            this.exit();
          }
        },
      },
      h(
        "div",
        { class: "card-heading" },
        h("span", { class: "label" }, "Photo mode"),
        h(
          "button",
          {
            type: "button",
            class: "chip-button",
            "aria-label": "Hide photo controls",
            onclick: () => this.collapse(true),
          },
          "Hide",
        ),
      ),
      h("div", { class: "photo-cameras", role: "group", "aria-label": "Photo camera" }, ...this.cameraButtons),
      ...sliders,
      h(
        "label",
        { class: "photo-slider" },
        h("span", { class: "label" }, "Time of day"),
        this.timeInput,
        this.timeOutput,
      ),
      this.weather && h("label", { class: "photo-weather" }, "Weather ", this.weather),
      h("label", { class: "check" }, this.gridToggle, "Composition grid"),
      (this.hint = h("p", { class: "photo-status" })),
      this.status,
      h(
        "div",
        { class: "photo-actions" },
        h("button", { type: "button", class: "chip-button", onclick: () => this.resetLook() }, "Reset look"),
        h(
          "button",
          {
            type: "button",
            class: "chip-button",
            onclick: () => this.resetConditions(),
          },
          "Reset conditions",
        ),
        h("button", { type: "button", class: "toggle", onclick: () => this.exit() }, "Done"),
        (this.captureButton = h(
          "button",
          { type: "button", class: "toggle photo-capture", onclick: () => this.capture() },
          "Save photo",
        )),
      ),
    );
    this.reveal = h(
      "button",
      { type: "button", class: "chip-button photo-reveal", hidden: true, onclick: () => this.collapse(false) },
      "Show photo controls",
    );
    document.body.append(this.grid, this.panel, this.reveal);
  }

  describe(key, value) {
    const range = LOOK_RANGES[key];
    const shown = key === "exposure" ? value.toFixed(1) : Math.round(value * 100);
    return `${value > 0 ? "+" : ""}${shown}${range.unit || ""}`;
  }

  toggle() {
    return this.active ? this.exit() : this.enter();
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.session++;
    this.status.textContent = "";
    this.previousLook = { ...this.view.look };
    this.returnFocus = document.activeElement;
    this.previousCamera = this.view.mode;
    this.previousHour = this.getHour();
    this.previousWeather = this.getWeather?.();
    this.onEnter?.();
    document.body.classList.add("photo-mode");
    this.panel.hidden = false;
    this.collapse(false);
    this.grid.hidden = !this.gridToggle.checked;
    this.syncConditions();
    this.syncLook(this.previousLook);
    this.setCamera(this.previousCamera === "cinematic" ? "cinematic" : "orbit");
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.session++;
    this.view.setLook(this.previousLook);
    this.grid.hidden = true;
    this.panel.hidden = true;
    this.reveal.hidden = true;
    document.body.classList.remove("photo-mode");
    this.view.setCamera(this.previousCamera || "chase");
    this.onExit?.();
    const target = this.returnFocus?.getClientRects().length ? this.returnFocus : this.view.renderer.domElement;
    target.focus({ preventScroll: true });
  }

  updateTimeLabel(hour) {
    this.timeOutput.textContent = formatClock(hour);
    this.timeInput.setAttribute("aria-valuetext", this.timeOutput.textContent);
  }

  collapse(hidden) {
    this.panel.hidden = hidden || !this.active;
    this.reveal.hidden = !hidden || !this.active;
    (hidden ? this.reveal : this.panel).focus({ preventScroll: true });
  }

  handleKey(key) {
    if (!this.active) return false;
    if (key === " ") this.capture();
    else if (key === "h") this.collapse(!this.panel.hidden);
    else return false;
    return true;
  }

  setCamera(mode) {
    this.view.setCamera(mode);
    for (const button of this.cameraButtons)
      button.setAttribute("aria-pressed", String(button.dataset.photoCamera === mode));
    const hint =
      mode === "orbit"
        ? "Drag to orbit · scroll to zoom"
        : mode === "cinematic"
          ? "The director cuts between shots"
          : "Fixed to the car";
    this.hint.textContent = this.view.post
      ? hint
      : `${hint}. Contrast, saturation and vignette need High or Ultra graphics.`;
    for (const [key, { input }] of Object.entries(this.inputs)) input.disabled = key !== "exposure" && !this.view.post;
  }

  syncConditions() {
    if (this.weather) this.weather.value = this.previousWeather;
    this.timeInput.value = String(Math.round(this.previousHour * 4) / 4);
    this.updateTimeLabel(this.previousHour);
  }

  resetConditions() {
    this.setHour(String(this.previousHour));
    if (this.previousWeather) this.setWeather?.(this.previousWeather);
    this.syncConditions();
  }

  updateLookLabel(key, value) {
    const { input, output } = this.inputs[key];
    const text = this.describe(key, value);
    output.textContent = text;
    input.setAttribute("aria-valuetext", text);
  }

  syncLook(look) {
    for (const [key, { input }] of Object.entries(this.inputs)) {
      const value = clampLook(key, look[key]);
      input.value = String(value);
      this.updateLookLabel(key, value);
    }
  }

  resetLook() {
    const defaults = this.view.setLook({ exposure: 0, contrast: 0, saturation: 0, vignette: 0 });
    this.syncLook(defaults);
  }

  // Render a fresh frame and read it back in the same task, before the browser clears the buffer.
  capture() {
    const canvas = this.view.renderer.domElement;
    if (!this.active || this.captureButton.disabled) return;
    const session = this.session;
    this.captureButton.disabled = true;
    this.status.textContent = "Saving photo…";
    const failed = () => {
      this.captureButton.disabled = false;
      if (session === this.session) this.status.textContent = "This browser could not save the frame. Try again.";
    };
    try {
      this.view.render(0, true);
      const width = canvas.width;
      const height = canvas.height;
      canvas.toBlob((blob) => {
        if (!blob?.size) return failed();
        this.captureButton.disabled = false;
        if (session !== this.session) return;
        let url;
        let link;
        try {
          url = URL.createObjectURL(blob);
          link = h("a", { href: url, download: photoFilename(this.place) });
          document.body.append(link);
          link.click();
          this.status.textContent = `Saved ${width} × ${height} photo`;
        } catch {
          failed();
        } finally {
          link?.remove();
          if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }, "image/png");
    } catch {
      failed();
    }
  }
}
