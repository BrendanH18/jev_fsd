// Photo mode: freeze the world, hide the HUD, frame the car with the free or cinematic camera, adjust
// exposure and grade, and save the rendered frame as a PNG. Only the WebGL canvas is captured, so
// the controls never appear in the photo.

import { h } from "../common.js";

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
  const slug = String(place || "drive").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "drive";
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `jev-${slug}-${stamp}.png`;
}

const formatHour = hour => `${String(Math.floor(hour) % 24).padStart(2, "0")}:${String(Math.round((hour % 1) * 60) % 60).padStart(2, "0")}`;

export class PhotoMode {
  constructor({ view, place, getHour, setHour, onEnter, onExit }) {
    Object.assign(this, { view, place, getHour, setHour, onEnter, onExit });
    this.active = false;
    this.inputs = {};
    const sliders = Object.entries(LOOK_RANGES).map(([key, range]) => {
      const output = h("output", { class: "photo-value" }, this.describe(key, 0));
      const input = h("input", { type: "range", min: range.min, max: range.max, step: range.step, value: 0, "aria-label": range.label,
        oninput: ev => { const value = clampLook(key, ev.target.value); this.view.setLook({ [key]: value }); output.textContent = this.describe(key, value); } });
      this.inputs[key] = { input, output };
      return h("label", { class: "photo-slider" }, h("span", { class: "label" }, range.label), input, output);
    });
    this.timeOutput = h("output", { class: "photo-value" }, "");
    this.timeInput = h("input", { type: "range", min: 0, max: 23.75, step: 0.25, value: 12, "aria-label": "Time of day",
      oninput: ev => { this.setHour(String(ev.target.value)); this.timeOutput.textContent = formatHour(Number(ev.target.value)); } });
    this.cameraButtons = ["orbit", "cinematic", "chase", "hood"].map(mode => h("button", { type: "button", class: "chip-button", "data-photo-camera": mode,
      "aria-pressed": "false", onclick: () => this.setCamera(mode) }, { orbit: "Free", cinematic: "Cinematic", chase: "Chase", hood: "Hood" }[mode]));
    this.status = h("p", { class: "photo-status", role: "status", "aria-live": "polite" }, "Drag to orbit · scroll to zoom");
    this.panel = h("section", { id: "photo-panel", class: "photo-panel panel", "aria-label": "Photo mode", hidden: true,
      onkeydown: ev => { if (ev.key === "Escape") { ev.preventDefault(); this.exit(); } } },
    h("div", { class: "card-heading" }, h("span", { class: "label" }, "Photo mode"),
      h("button", { type: "button", class: "chip-button", "aria-label": "Hide photo controls", onclick: () => this.collapse(true) }, "Hide")),
    h("div", { class: "photo-cameras", role: "group", "aria-label": "Photo camera" }, ...this.cameraButtons),
    ...sliders,
    h("label", { class: "photo-slider" }, h("span", { class: "label" }, "Time of day"), this.timeInput, this.timeOutput),
    this.status,
    h("div", { class: "photo-actions" },
      h("button", { type: "button", class: "chip-button", onclick: () => this.resetLook() }, "Reset look"),
      h("button", { type: "button", class: "toggle", onclick: () => this.exit() }, "Done"),
      h("button", { type: "button", class: "toggle photo-capture", onclick: () => this.capture() }, "Save photo")));
    this.reveal = h("button", { type: "button", class: "chip-button photo-reveal", hidden: true, onclick: () => this.collapse(false) }, "Show photo controls");
    document.body.append(this.panel, this.reveal);
  }

  describe(key, value) {
    const range = LOOK_RANGES[key];
    const shown = key === "exposure" ? value.toFixed(1) : Math.round(value * 100);
    return `${value > 0 ? "+" : ""}${shown}${range.unit || ""}`;
  }

  toggle() { return this.active ? this.exit() : this.enter(); }

  enter() {
    if (this.active) return;
    this.active = true;
    this.previousCamera = this.view.mode;
    this.onEnter?.();
    document.body.classList.add("photo-mode");
    this.panel.hidden = false;
    this.collapse(false);
    const hour = this.getHour();
    this.timeInput.value = String(Math.round(hour * 4) / 4);
    this.timeOutput.textContent = formatHour(hour);
    this.setCamera(this.previousCamera === "cinematic" ? "cinematic" : "orbit");
    this.panel.querySelector("button").focus({ preventScroll: true });
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.resetLook();
    this.panel.hidden = true;
    this.reveal.hidden = true;
    document.body.classList.remove("photo-mode");
    this.view.setCamera(this.previousCamera || "chase");
    this.onExit?.();
  }

  collapse(hidden) {
    this.panel.hidden = hidden || !this.active;
    this.reveal.hidden = !hidden || !this.active;
    (hidden ? this.reveal : this.panel.querySelector("button")).focus({ preventScroll: true });
  }

  setCamera(mode) {
    this.view.setCamera(mode);
    for (const button of this.cameraButtons) button.setAttribute("aria-pressed", String(button.dataset.photoCamera === mode));
    const hint = mode === "orbit" ? "Drag to orbit · scroll to zoom" : mode === "cinematic" ? "The director cuts between shots" : "Fixed to the car";
    this.status.textContent = this.view.post ? hint : `${hint}. Contrast, saturation and vignette need High or Ultra graphics.`;
  }

  resetLook() {
    this.view.setLook({ exposure: 0, contrast: 0, saturation: 0, vignette: 0 });
    for (const [key, { input, output }] of Object.entries(this.inputs)) { input.value = "0"; output.textContent = this.describe(key, 0); }
  }

  // Render a fresh frame and read it back in the same task, before the browser clears the buffer.
  capture() {
    const canvas = this.view.renderer.domElement;
    this.view.render(0);
    canvas.toBlob(blob => {
      if (!blob) { this.status.textContent = "This browser could not save the frame."; return; }
      const url = URL.createObjectURL(blob);
      const link = h("a", { href: url, download: photoFilename(this.place) });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.status.textContent = `Saved ${canvas.width} × ${canvas.height} photo`;
    }, "image/png");
  }
}
