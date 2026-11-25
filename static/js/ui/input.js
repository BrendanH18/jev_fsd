// Keyboard and analog sources share the manual-drive path. The keyboard keeps the user's layout.
const DRIVE_KEYS = new Set(["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
const SHORTCUTS = Object.freeze({
  j: "autopilot",
  c: "camera",
  r: "reset",
  p: "pause",
  q: "signalLeft",
  e: "signalRight",
  h: "horn",
  i: "inspector",
  v: "perception",
  t: "telemetry",
  m: "sound",
  x: "explorer",
  l: "lab",
  1: "brain1",
  2: "brain2",
  3: "brain3",
  o: "photo",
  "?": "help",
  "/": "help",
  escape: "escape",
});
const EDITOR = "input, textarea, select, [role='textbox'], [role='combobox'], [role='spinbutton']";
const CONTROL =
  "button, a[href], [role='button'], [role='radio'], [role='switch'], [role='tab'], [role='slider'], summary, [role^='menuitem'], [role='listbox'], [role='tree'], [role='grid'], [data-local-keys], #minimap, #panel-body";

const pathMatches = (event, selector) =>
  (event.composedPath?.() || [event.target]).some((node) => node?.closest?.(selector));
const editing = (event) =>
  pathMatches(event, EDITOR) || (event.composedPath?.() || [event.target]).some((node) => node?.isContentEditable);
const idle = () => ({ steer: 0, throttle: 0, brake: 0, hardBrake: false });

function amount(value, minimum = 0) {
  if (typeof value === "boolean") return Number(value);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(1, value)) : 0;
}

export class Input {
  constructor(actions = {}) {
    this.keys = new Set();
    this.physicalKeys = new Map();
    this.actions = actions;
    this.sources = [];
    this.analog = idle();
    this.blocked = false;
    this.windowFocused = true;
    this.samples = null;
    window.addEventListener("keydown", (event) => this.keyDown(event));
    window.addEventListener("keyup", (event) => this.keyUp(event));
    window.addEventListener("blur", () => {
      this.windowFocused = false;
      this.clear();
    });
    window.addEventListener("focus", () => {
      this.windowFocused = true;
    });
    window.addEventListener("pagehide", () => this.clear());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clear();
    });
    document.addEventListener("focusin", (event) => {
      if (this.isBlocked() || editing(event) || pathMatches(event, CONTROL)) this.clearKeys();
    });
    document.addEventListener("compositionstart", () => this.clearKeys());
  }

  isBlocked() {
    return !this.windowFocused || document.hidden || !!document.querySelector("dialog[open]");
  }

  keyDown(event) {
    if (event.defaultPrevented || typeof event.key !== "string") return;
    if (event.isComposing || editing(event) || this.isBlocked()) {
      this.clearKeys();
      return;
    }
    const key = event.key.toLowerCase();
    // Shift is part of the layout (for example "?"); browser and OS chords keep their keys.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[a-z0-9/?]$/.test(key) && this.actions.shortcutsEnabled?.() === false) return;
    if (DRIVE_KEYS.has(key) && pathMatches(event, CONTROL)) return;
    if (!["escape", "?", "/"].includes(key) && pathMatches(event, "[data-local-keys]")) return;
    if (this.actions.interceptKey?.(key, event.repeat)) {
      event.preventDefault();
      return;
    }
    if (DRIVE_KEYS.has(key)) {
      event.preventDefault();
      const physical = event.code && event.code !== "Unidentified" ? event.code : key;
      // An auto-repeat that survived a blur or a modal is not a fresh request to drive.
      if (event.repeat) return;
      this.physicalKeys.set(physical, key);
      this.keys.add(key);
      return;
    }
    const action = Object.hasOwn(SHORTCUTS, key) && this.actions[SHORTCUTS[key]];
    if (typeof action !== "function") return;
    event.preventDefault();
    if (!event.repeat) action.call(this.actions);
  }

  // Keep exposed shortcut hints in sync with the same setting the dispatcher uses.
  refreshShortcutHints(root = document) {
    const enabled = this.actions.shortcutsEnabled?.() !== false;
    for (const element of root.querySelectorAll("[data-drive-shortcut]")) {
      if (enabled) element.setAttribute("aria-keyshortcuts", element.dataset.driveShortcut);
      else element.removeAttribute("aria-keyshortcuts");
    }
  }

  keyUp(event) {
    if (typeof event.key !== "string") return;
    const physical = event.code && event.code !== "Unidentified" ? event.code : event.key.toLowerCase();
    const key = this.physicalKeys.get(physical) ?? event.key.toLowerCase();
    this.physicalKeys.delete(physical);
    if (![...this.physicalKeys.values()].includes(key)) this.keys.delete(key);
  }

  clearKeys() {
    this.keys.clear();
    this.physicalKeys.clear();
  }

  clear() {
    this.clearKeys();
    this.samples = null;
    this.analog = idle();
    for (const source of this.sources) source.release?.();
  }
  // Analog sources supply a state and optionally poll once per frame.
  addSource(source) {
    if (!this.sources.includes(source)) this.sources.push(source);
    return source;
  }
  poll() {
    this.blocked = this.isBlocked();
    if (this.blocked) this.clearKeys();
    this.samples = this.sources.map((source) => {
      if (this.blocked) source.release?.();
      const state = source.poll ? source.poll() : source.state;
      // A source action (opening an overlay, for instance) can block the rest of this frame.
      this.blocked ||= this.isBlocked();
      return state;
    });
    if (this.blocked) this.clearKeys();
    this.analog = this.combine(this.samples);
    return this.analog;
  }
  combine(states) {
    const sum = idle();
    if (this.blocked) return sum;
    for (const s of states) {
      if (!s) continue;
      sum.steer += amount(s.steer, -1);
      sum.throttle = Math.max(sum.throttle, amount(s.throttle));
      sum.brake = Math.max(sum.brake, amount(s.brake));
      sum.hardBrake ||= s.hardBrake === true || s.hardBrake === 1;
    }
    sum.steer = Math.max(-1, Math.min(1, sum.steer));
    return sum;
  }
  // Only re-read a source whose one-step pulse was consumed. The rest keep their polled sample.
  stepped() {
    let changed = false;
    this.sources.forEach((source, i) => {
      if (!source.stepped?.()) return;
      changed = true;
      if (this.samples) this.samples[i] = source.state;
    });
    if (changed && this.samples) this.analog = this.combine(this.samples);
  }
  get throttle() {
    return Math.max(Number(this.keys.has("w") || this.keys.has("arrowup")), this.analog.throttle);
  }
  get brake() {
    return Math.max(Number(this.keys.has("s") || this.keys.has("arrowdown")), this.analog.brake);
  }
  get left() {
    return Math.max(Number(this.keys.has("a") || this.keys.has("arrowleft")), -this.analog.steer);
  }
  get right() {
    return Math.max(Number(this.keys.has("d") || this.keys.has("arrowright")), this.analog.steer);
  }
  get hardBrake() {
    return this.keys.has(" ") || this.analog.hardBrake;
  }
  get anyDriving() {
    return !!(this.throttle || this.brake || this.left || this.right || this.hardBrake);
  }
}
