// On-screen driving controls for touch screens. Input only: like the gamepad (ui/gamepad.js) they
// feed the keyboard's manual-drive path through ui/input.js, steering from -1 (full left) to 1.
//
// Left: a steering pad. Put a finger down anywhere on it and slide sideways; the wheel turns with the
// slide, up to full lock at STEER_RANGE_PX, and centres when the finger lifts. Right: the brake and
// accelerator pedals, held while pressed (the brake reverses once the car is stopped, as S does). In
// between, a row of the essential toggles. Every control tracks its own pointer, so steering and a
// pedal work together. Shown on coarse-pointer (touch) screens, or with ?touch=1 (?touch=0 hides
// them); photo mode hides them with the rest of the HUD.

import { h } from "../common.js";

export const STEER_RANGE_PX = 90;
const IDLE = Object.freeze({ steer: 0, throttle: 0, brake: 0, hardBrake: false });

// Whether to show the controls: the ?touch= override, else whether the main pointer is coarse.
export function touchWanted(search = "", coarse = false) {
  const value = new URLSearchParams(search).get("touch");
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return !!coarse;
}

// The steering amount for a slide of dx pixels from where the finger came down.
export function steerFromDrag(dx, range = STEER_RANGE_PX) {
  const value = Number(dx) / Math.max(1, range);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

// The toggles under the thumbs, named as in ui/input.js's keyboard map.
export const TOUCH_BUTTONS = Object.freeze([
  { action: "autopilot", label: "Auto", title: "Autopilot on or off (J)" },
  { action: "signalLeft", label: "◀", title: "Left indicator (Q)" },
  { action: "signalRight", label: "▶", title: "Right indicator (E)" },
  { action: "camera", label: "View", title: "Next camera (C)" },
  { action: "pause", label: "Pause", title: "Pause (P)" },
  { action: "reset", label: "Reset", title: "Reset to lane (R)" },
  { action: "horn", label: "Horn", title: "Horn (H)" },
]);

export class TouchControls {
  constructor({ root = document.body, actions = {} } = {}) {
    this.actions = actions;
    this.steerPointer = null;
    this.steerStart = 0;
    this.steer = 0;
    this.pedals = { throttle: new Set(), brake: new Set(), hardBrake: new Set() };
    this.knob = h("span", { class: "touch-steer-knob", "aria-hidden": "true" }, "◀ ▶");
    this.wheel = h(
      "div",
      {
        class: "touch-steer",
        role: "slider",
        "aria-label": "Steering: slide left or right",
        "aria-valuemin": "-100",
        "aria-valuemax": "100",
        "aria-valuenow": "0",
      },
      h("span", { class: "touch-steer-track", "aria-hidden": "true" }),
      this.knob,
      h("span", { class: "touch-caption" }, "steer"),
    );
    this.pedalEls = {
      brake: h(
        "div",
        {
          class: "touch-pedal touch-brake",
          role: "button",
          "aria-label": "Brake (reverses when stopped)",
          "aria-pressed": "false",
        },
        "Brake",
      ),
      throttle: h(
        "div",
        { class: "touch-pedal touch-throttle", role: "button", "aria-label": "Accelerator", "aria-pressed": "false" },
        "Go",
      ),
    };
    this.buttons = TOUCH_BUTTONS.map((b) =>
      h(
        "button",
        {
          type: "button",
          class: "touch-button",
          "data-action": b.action,
          title: b.title,
          "aria-label": b.title,
          onclick: () => this.actions[b.action]?.(),
        },
        b.label,
      ),
    );
    this.pedalEls.hardBrake = h(
      "button",
      { type: "button", class: "touch-button", "aria-label": "Hold hard brake", "aria-pressed": "false" },
      "Hard brake",
    );
    this.el = h(
      "div",
      { id: "touch-controls", class: "touch-controls", role: "group", "aria-label": "Touch driving controls" },
      this.wheel,
      h("div", { class: "touch-buttons" }, this.buttons, this.pedalEls.hardBrake),
      h("div", { class: "touch-pedals" }, this.pedalEls.brake, this.pedalEls.throttle),
    );
    this.el.addEventListener("contextmenu", (ev) => ev.preventDefault());
    this.bindSteering();
    for (const [name, el] of Object.entries(this.pedalEls)) this.bindPedal(name, el);
    root.append(this.el);
    globalThis.addEventListener?.("blur", () => this.release());
  }

  bindSteering() {
    const end = (ev) => {
      if (ev.pointerId !== this.steerPointer) return;
      this.steerPointer = null;
      this.setSteer(0);
    };
    this.wheel.addEventListener("pointerdown", (ev) => {
      if (this.steerPointer != null) return;
      ev.preventDefault();
      this.steerPointer = ev.pointerId;
      this.steerStart = ev.clientX;
      try {
        this.wheel.setPointerCapture(ev.pointerId);
      } catch {
        /* synthetic pointers have no capture */
      }
      this.wheel.classList.add("active");
    });
    this.wheel.addEventListener("pointermove", (ev) => {
      if (ev.pointerId === this.steerPointer) this.setSteer(steerFromDrag(ev.clientX - this.steerStart));
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) this.wheel.addEventListener(type, end);
  }

  bindPedal(name, el) {
    const held = this.pedals[name];
    const release = (ev) => {
      if (held.delete(ev.pointerId)) this.showPedal(name);
    };
    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      held.add(ev.pointerId);
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        /* synthetic pointers have no capture */
      }
      this.showPedal(name);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(type, release);
  }

  setSteer(value) {
    this.steer = value;
    this.wheel.style.setProperty("--steer", value.toFixed(3));
    this.wheel.setAttribute("aria-valuenow", String(Math.round(value * 100)));
    if (!value && this.steerPointer == null) this.wheel.classList.remove("active");
  }
  showPedal(name) {
    const on = this.pedals[name].size > 0;
    this.pedalEls[name].classList.toggle("active", on);
    this.pedalEls[name].setAttribute("aria-pressed", String(on));
  }
  // Let go of everything (the page lost focus, or a dialog opened over the controls).
  release() {
    this.steerPointer = null;
    this.setSteer(0);
    for (const name of Object.keys(this.pedals)) {
      this.pedals[name].clear();
      this.showPedal(name);
    }
  }
  setAutopilot(on) {
    if (this.autopilotOn === !!on) return;
    this.autopilotOn = !!on;
    const button = this.buttons.find((b) => b.dataset.action === "autopilot");
    button.setAttribute("aria-pressed", String(!!on));
    button.textContent = on ? "Auto on" : "Auto";
    this.el.classList.toggle("autopilot", !!on);
  }
  // The controls' driving state, the same shape as a gamepad's (ui/gamepad.js readPad).
  get state() {
    if (this.el.hidden) return { ...IDLE };
    return {
      steer: this.steer,
      throttle: this.pedals.throttle.size ? 1 : 0,
      brake: this.pedals.brake.size ? 1 : 0,
      hardBrake: this.pedals.hardBrake.size > 0,
    };
  }
}
