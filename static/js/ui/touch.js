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
  if (!Number.isFinite(dx)) return 0;
  const travel = Number.isFinite(range) && range > 0 ? range : STEER_RANGE_PX;
  const value = dx / Math.max(1, travel);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

// The toggles under the thumbs, named as in ui/input.js's keyboard map.
export const TOUCH_BUTTONS = Object.freeze([
  {
    action: "autopilot",
    label: "Auto",
    title: "Autopilot on or off (J)",
    name: "Auto, autopilot",
    key: "J",
    toggle: true,
  },
  { action: "signalLeft", label: "◀", title: "Left indicator (Q)", name: "Left indicator", key: "Q", toggle: true },
  { action: "signalRight", label: "▶", title: "Right indicator (E)", name: "Right indicator", key: "E", toggle: true },
  { action: "camera", label: "View", title: "Next camera (C)", name: "View, next camera", key: "C" },
  { action: "pause", label: "Pause", title: "Pause (P)", name: "Pause", key: "P", toggle: true },
  { action: "reset", label: "Reset", title: "Reset to lane (R)", name: "Reset to lane", key: "R" },
  { action: "horn", label: "Horn", title: "Horn (H)", name: "Horn", key: "H" },
]);

let controlCount = 0;
const pointerEnds = ["pointerup", "pointercancel", "lostpointercapture"];
const modified = (event) => event.altKey || event.ctrlKey || event.metaKey || event.isComposing;

function releaseCapture(el, id) {
  if (typeof id === "number" && el.hasPointerCapture(id)) el.releasePointerCapture(id);
}

export class TouchControls {
  constructor({ root = document.body, actions = {} } = {}) {
    this.actions = actions;
    this.steerPointer = null;
    this.steerStart = 0;
    this.steer = 0;
    this.pedals = { throttle: new Set(), brake: new Set(), hardBrake: new Set() };
    const helpId = `touch-help-${++controlCount}`;
    const steerHelp = h(
      "span",
      { id: `${helpId}-steer`, hidden: true },
      "Drag sideways or hold a left or right arrow. Hold Shift with an arrow for full steering. Release to centre.",
    );
    const pedalHelp = h(
      "span",
      { id: `${helpId}-pedal`, hidden: true },
      "Hold Space or Enter while focused, or press and hold with a pointer.",
    );
    this.knob = h("span", { class: "touch-steer-knob", "aria-hidden": "true" }, "◀ ▶");
    this.wheel = h(
      "div",
      {
        class: "touch-steer",
        role: "slider",
        tabindex: "0",
        "aria-label": "Steering",
        "aria-describedby": steerHelp.id,
        "aria-keyshortcuts": "ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight",
        "aria-valuetext": "Centred",
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
        "button",
        {
          class: "touch-pedal touch-brake",
          type: "button",
          "aria-label": "Brake and reverse",
          "aria-description": "Continues into reverse when held at a stop.",
          "aria-pressed": "false",
        },
        "Brake",
      ),
      throttle: h(
        "button",
        {
          class: "touch-pedal touch-throttle",
          type: "button",
          "aria-label": "Go, accelerator",
          "aria-pressed": "false",
        },
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
          "aria-label": b.name,
          "data-drive-shortcut": b.key,
          "aria-pressed": b.toggle ? "false" : null,
          onclick: () => {
            if (!this.el.hidden) this.actions[b.action]?.();
          },
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
      steerHelp,
      pedalHelp,
      this.wheel,
      h(
        "div",
        { class: "touch-buttons", role: "group", "aria-label": "Touch driving actions" },
        this.buttons,
        this.pedalEls.hardBrake,
      ),
      h(
        "div",
        { class: "touch-pedals", role: "group", "aria-label": "Driving pedals" },
        this.pedalEls.brake,
        this.pedalEls.throttle,
      ),
    );
    this.el.addEventListener("contextmenu", (ev) => ev.preventDefault());
    this.bindSteering();
    for (const [name, el] of Object.entries(this.pedalEls)) {
      el.setAttribute("aria-describedby", pedalHelp.id);
      el.setAttribute("aria-keyshortcuts", "Space Enter");
      this.bindPedal(name, el);
      this.bindPedalKeys(name, el);
    }
    root.append(this.el);
  }

  bindSteering() {
    const end = (ev) => {
      if (ev.pointerId !== this.steerPointer) return;
      this.steerPointer = null;
      this.setSteer(0);
    };
    this.wheel.addEventListener("pointerdown", (ev) => {
      if (this.el.hidden || ev.button !== 0 || this.steerPointer != null) return;
      ev.preventDefault();
      this.steerPointer = ev.pointerId;
      this.steerKeys.clear();
      this.setSteer(0);
      this.steerStart = ev.clientX;
      try {
        this.wheel.setPointerCapture(ev.pointerId);
      } catch {
        /* synthetic pointers have no capture */
      }
    });
    const keys = new Map();
    const syncKeys = () => this.setSteer((keys.get("ArrowRight") || 0) - (keys.get("ArrowLeft") || 0));
    for (const type of ["keydown", "keyup"]) {
      this.wheel.addEventListener(type, (ev) => {
        if (!["ArrowLeft", "ArrowRight"].includes(ev.key)) return;
        // A modified press is the browser's; a release always clears the held key.
        if (type === "keydown" && (this.el.hidden || modified(ev))) return;
        ev.preventDefault();
        if (this.steerPointer != null) return;
        if (type === "keydown" && ev.repeat && !keys.has(ev.key)) return;
        if (type === "keydown") keys.set(ev.key, ev.shiftKey ? 1 : 0.5);
        else keys.delete(ev.key);
        syncKeys();
      });
    }
    this.wheel.addEventListener("blur", () => {
      keys.clear();
      if (this.steerPointer == null) this.setSteer(0);
    });
    this.steerKeys = keys;
    this.wheel.addEventListener("pointermove", (ev) => {
      if (ev.pointerId !== this.steerPointer) return;
      if (ev.pointerType === "mouse" && !(ev.buttons & 1)) {
        end(ev);
        return;
      }
      this.setSteer(steerFromDrag(ev.clientX - this.steerStart));
    });
    for (const type of pointerEnds) this.wheel.addEventListener(type, end);
    this.wheel.addEventListener("pointerleave", (ev) => {
      if (!this.wheel.hasPointerCapture(ev.pointerId)) end(ev);
    });
  }

  bindPedal(name, el) {
    const held = this.pedals[name];
    const release = (ev) => {
      if (held.delete(ev.pointerId)) this.showPedal(name);
    };
    el.addEventListener("pointerdown", (ev) => {
      if (this.el.hidden || ev.button !== 0) return;
      ev.preventDefault();
      held.add(ev.pointerId);
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        /* synthetic pointers have no capture */
      }
      this.showPedal(name);
    });
    for (const type of pointerEnds) el.addEventListener(type, release);
    el.addEventListener("pointerleave", (ev) => {
      if (!el.hasPointerCapture(ev.pointerId)) release(ev);
    });
  }

  bindPedalKeys(name, el) {
    const held = this.pedals[name];
    for (const type of ["keydown", "keyup"]) {
      el.addEventListener(type, (ev) => {
        if (ev.key !== " " && ev.key !== "Enter") return;
        if (type === "keydown" && (this.el.hidden || modified(ev))) return;
        ev.preventDefault();
        if (type === "keydown" && ev.repeat) return;
        if (type === "keydown") held.add(ev.key);
        else held.delete(ev.key);
        this.showPedal(name);
      });
    }
    el.addEventListener("click", (ev) => {
      if (this.el.hidden || ev.detail !== 0 || modified(ev)) return;
      held.add("activate");
      this.showPedal(name);
    });
    el.addEventListener("blur", () => {
      for (const key of [" ", "Enter", "activate"]) held.delete(key);
      this.showPedal(name);
    });
  }

  setSteer(value) {
    this.steer = value;
    this.wheel.style.setProperty("--steer", value.toFixed(3));
    const percent = Math.round(value * 100);
    this.wheel.setAttribute("aria-valuenow", String(percent));
    this.wheel.setAttribute(
      "aria-valuetext",
      percent === 0 ? "Centred" : `${Math.abs(percent)}% ${percent < 0 ? "left" : "right"}`,
    );
    this.wheel.classList.toggle("active", value !== 0 || this.steerPointer != null);
  }
  showPedal(name) {
    const on = this.pedals[name].size > 0;
    this.pedalEls[name].classList.toggle("active", on);
    this.pedalEls[name].setAttribute("aria-pressed", String(on));
  }
  // Let go of everything (the page lost focus, or a dialog opened over the controls).
  release() {
    if (this.steerPointer != null || this.steerKeys.size || this.steer) {
      const pointer = this.steerPointer;
      this.steerPointer = null;
      releaseCapture(this.wheel, pointer);
      this.steerKeys.clear();
      this.setSteer(0);
    }
    for (const [name, held] of Object.entries(this.pedals)) {
      if (!held.size) continue;
      for (const id of held) releaseCapture(this.pedalEls[name], id);
      held.clear();
      this.showPedal(name);
    }
  }
  setAutopilot(on) {
    if (this.autopilotOn === !!on) return;
    this.autopilotOn = !!on;
    this.setPressed("autopilot", on);
    this.el.classList.toggle("autopilot", !!on);
  }
  setPressed(action, on) {
    const button = this.buttons.find((b) => b.dataset.action === action);
    const pressed = String(Boolean(on));
    if (button && button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
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
  // An assistive activation stays pressed until a physics step has read it (Input.stepped).
  stepped() {
    let consumed = false;
    for (const [name, held] of Object.entries(this.pedals)) {
      if (!held.delete("activate")) continue;
      consumed = true;
      this.showPedal(name);
    }
    return consumed;
  }
}
