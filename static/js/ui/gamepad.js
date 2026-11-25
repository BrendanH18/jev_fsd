// Driving with a gamepad (the browser Gamepad API). Input only: the pad feeds the same manual-drive
// path as the keyboard (World.stepManual, through ui/input.js), with analog magnitudes from 0 to 1.
//
// Standard layout (Xbox names; a PlayStation pad's buttons sit in the same places):
//   left stick ←→, D-pad ←→   steer             RT, D-pad ↑   accelerate
//   LT, D-pad ↓               brake, then reverse when stopped
//   A  brake hard (held)      B  horn           X  camera      Y  autopilot on/off
//   LB / RB  left / right indicator             View  reset to lane      Menu  pause
// A pad without analog triggers (no buttons 6 and 7) accelerates with the left stick pushed up and
// brakes with it pulled down.

export const STICK_DEAD_ZONE = 0.15;
const DEAD_ZONE_KEY = "jev-gamepad-dead-zone";
let stickDeadZone = STICK_DEAD_ZONE;
try {
  const saved = globalThis.localStorage?.getItem(DEAD_ZONE_KEY);
  if (saved != null && Number.isFinite(Number(saved))) stickDeadZone = Math.max(0, Math.min(0.5, Number(saved)));
} catch {
  // Storage can be unavailable in private browsing.
}

export function getDeadZone() {
  return stickDeadZone;
}

export function setDeadZone(value) {
  if (!Number.isFinite(value)) return stickDeadZone;
  stickDeadZone = Math.max(0, Math.min(0.5, value));
  try {
    globalThis.localStorage?.setItem(DEAD_ZONE_KEY, String(stickDeadZone));
  } catch {
    // Retain the setting for this session.
  }
  return stickDeadZone;
}
export const TRIGGER_DEAD_ZONE = 0.06;
// (a button counts as held past this much travel, so an analog trigger has a clean press edge)
export const PRESS_THRESHOLD = 0.5;
export const BUTTON = Object.freeze({
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
});
// One-shot actions on a button's press edge, named as in ui/input.js's keyboard map.
export const BUTTON_ACTIONS = Object.freeze({
  [BUTTON.Y]: "autopilot",
  [BUTTON.X]: "camera",
  [BUTTON.B]: "horn",
  [BUTTON.LB]: "signalLeft",
  [BUTTON.RB]: "signalRight",
  [BUTTON.VIEW]: "reset",
  [BUTTON.MENU]: "pause",
});
export const IDLE = Object.freeze({ steer: 0, throttle: 0, brake: 0, hardBrake: false });

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// A centred axis value with its dead zone removed and the rest rescaled to reach ±1, so a small
// drift reads 0 and full deflection still reads 1.
export function deadZone(v, zone = STICK_DEAD_ZONE) {
  const value = Number(v);
  if (!Number.isFinite(value)) return 0;
  const a = Math.abs(value);
  if (a <= zone) return 0;
  return Math.sign(value) * Math.min(1, (a - zone) / (1 - zone));
}

// How far a button is pressed, 0 to 1: its analog value, or 1 when a digital button reports only
// `pressed`. (Very old browsers expose buttons as plain numbers.)
export function buttonValue(button) {
  if (button == null) return 0;
  if (typeof button === "number") return Number.isFinite(button) ? clamp01(button) : 0;
  const value = Number(button.value);
  if (Number.isFinite(value) && value > 0) return clamp01(value);
  return button.pressed ? 1 : 0;
}

export const buttonHeld = (button) => buttonValue(button) >= PRESS_THRESHOLD || !!button?.pressed;

// A trigger's travel past its rest dead zone, or null when the pad has no such button.
export function triggerValue(pad, index) {
  const button = pad?.buttons?.[index];
  if (button == null) return null;
  return Math.max(0, deadZone(buttonValue(button), TRIGGER_DEAD_ZONE));
}

// The driving controls one pad gives now: steer -1 (full left) to 1 (full right), throttle and
// brake 0 to 1, and the held hard brake.
export function readPad(pad) {
  if (!pad || pad.connected === false) return { ...IDLE };
  const axes = pad.axes || [],
    buttons = pad.buttons || [];
  const held = (i) => buttonHeld(buttons[i]);
  const stickX = deadZone(axes[0], stickDeadZone),
    stickY = deadZone(axes[1], stickDeadZone);
  const dpad = Number(held(BUTTON.RIGHT)) - Number(held(BUTTON.LEFT));
  const steer = Math.abs(stickX) >= Math.abs(dpad) ? stickX : dpad;
  let throttle = triggerValue(pad, BUTTON.RT),
    brake = triggerValue(pad, BUTTON.LT);
  // (no analog triggers: the stick's vertical axis, up to accelerate, down to brake)
  if (throttle == null) throttle = Math.max(0, -stickY);
  if (brake == null) brake = Math.max(0, stickY);
  if (held(BUTTON.UP)) throttle = 1;
  if (held(BUTTON.DOWN)) brake = 1;
  return { steer, throttle, brake, hardBrake: held(BUTTON.A) };
}

// The buttons pressed now that were not held before (the press edges), and the held state to keep
// for the next poll.
export function pressedEdges(previous, buttons) {
  const now = Array.from(buttons || [], (b) => buttonHeld(b));
  const edges = [];
  now.forEach((on, i) => {
    if (on && !previous?.[i]) edges.push(i);
  });
  return { edges, held: now };
}

// The pad to drive with: the first connected one, preferring the standard layout.
export function pickPad(pads) {
  const live = Array.from(pads || []).filter((p) => p && p.connected !== false);
  return live.find((p) => p.mapping === "standard") || live[0] || null;
}

// Polls the browser's gamepads once a frame (ui/input.js calls poll), keeps the driving state and
// fires the button actions on their press edges. `onConnect(pad)` / `onDisconnect(pad)` fire as a
// pad appears or goes; a pad appears in the poll once the browser exposes it (usually after its
// first button press).
export class GamepadInput {
  constructor({ actions = {}, onConnect = null, onDisconnect = null, getPads = null, blocked = () => false } = {}) {
    this.actions = actions;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
    this.getPads =
      getPads || (() => (typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : []));
    this.blocked = blocked;
    this.state = { ...IDLE };
    this.pad = null; // the id of the pad in use
    this.held = [];
    this.waitForNeutral = false;
  }
  poll() {
    let pad = null;
    try {
      pad = pickPad(this.getPads());
    } catch {
      pad = null;
    }
    const id = pad ? `${pad.index ?? 0}:${pad.id ?? ""}` : null;
    if (id !== this.pad) {
      const before = this.pad;
      this.pad = id;
      this.waitForNeutral = this.blocked();
      this.held = pad ? pressedEdges([], pad.buttons).held : [];
      if (before && this.onDisconnect) this.onDisconnect(before);
      if (pad && this.onConnect) this.onConnect(pad);
      this.state = { ...IDLE };
      return this.state; // (the buttons already held as it appears fire nothing)
    }
    if (!pad) {
      this.state = { ...IDLE };
      return this.state;
    }
    const { edges, held } = pressedEdges(this.held, pad.buttons);
    this.held = held;
    if (this.blocked()) {
      this.waitForNeutral = true;
      this.state = { ...IDLE };
      return this.state;
    }
    const state = readPad(pad);
    if (this.waitForNeutral) {
      this.waitForNeutral = !!(state.steer || state.throttle || state.brake || state.hardBrake);
      if (this.waitForNeutral) return this.state;
    }
    this.state = state;
    for (const i of edges) {
      const name = BUTTON_ACTIONS[i];
      if (name && this.actions[name]) this.actions[name]();
    }
    return this.state;
  }
}
