// Keyboard state and one-shot key actions, plus the analog sources that drive the same way: a
// gamepad (ui/gamepad.js) and the touch controls (ui/touch.js). The keys give 1 or 0; a source gives
// any amount between, and World.stepManual takes either.

const editing = (target) => target?.isContentEditable || target?.closest?.("input, textarea, select, [role='textbox']");
const control = (target) =>
  target?.closest?.(
    "button, a, [role='button'], [role='radio'], [role='switch'], [role='tab'], [role='slider'], summary, [role='menuitem'], [role='menuitemradio'], #minimap, #panel-body",
  );

function amount(value, minimum = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(1, number)) : 0;
}

export class Input {
  constructor(actions = {}) {
    this.keys = new Set();
    this.actions = actions;
    this.manualActive = false;
    this.sources = []; // analog sources, each with a `state` (see poll)
    this.analog = { steer: 0, throttle: 0, brake: 0, hardBrake: false };
    this.blocked = false;
    this.samples = null; // this frame's sample from each source (poll)
    window.addEventListener("keydown", (ev) => {
      if (ev.defaultPrevented) return;
      if (ev.isComposing || editing(ev.target) || document.querySelector("dialog[open]")) {
        this.keys.clear();
        return;
      }
      const k = ev.key.toLowerCase();
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (/^[a-z0-9/?]$/.test(k) && this.actions.shortcutsEnabled?.() === false) return;
      if (
        control(ev.target) &&
        ["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)
      )
        return;
      if (this.actions.interceptKey?.(k, ev.repeat)) {
        ev.preventDefault();
        return;
      }
      if (["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        ev.preventDefault();
        this.keys.add(k);
        return;
      }
      const map = {
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
      };
      if (ev.repeat && map[k]) return;
      if (map[k] && this.actions[map[k]]) {
        ev.preventDefault();
        this.actions[map[k]]();
      }
    });
    window.addEventListener("keyup", (ev) => this.keys.delete(ev.key.toLowerCase()));
    window.addEventListener("blur", () => this.clear());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clear();
    });
    document.addEventListener("focusin", (ev) => {
      if (document.querySelector("dialog[open]") || editing(ev.target) || control(ev.target)) this.keys.clear();
    });
  }
  clear() {
    this.keys.clear();
    this.analog = { steer: 0, throttle: 0, brake: 0, hardBrake: false };
  }
  // Adds an analog source: anything with a `state` of { steer -1..1 (right positive), throttle and
  // brake 0..1, hardBrake }, and an optional poll() run once a frame.
  addSource(source) {
    this.sources.push(source);
    return source;
  }
  // Reads the analog sources once a frame (main.js, before the physics steps). Nothing drives while
  // a dialog is open, as with the keys.
  poll() {
    const blocked = typeof document !== "undefined" && (document.hidden || document.querySelector?.("dialog[open]"));
    if (blocked) this.keys.clear();
    this.samples = this.sources.map((source) => {
      if (blocked) source.release?.();
      return source.poll ? source.poll() : source.state;
    });
    this.blocked = !!blocked;
    this.analog = this.combine(this.samples);
    return this.analog;
  }
  combine(states) {
    const sum = { steer: 0, throttle: 0, brake: 0, hardBrake: false };
    for (const s of states) {
      if (!s || this.blocked) continue;
      sum.steer += amount(s.steer, -1);
      sum.throttle = Math.max(sum.throttle, amount(s.throttle));
      sum.brake = Math.max(sum.brake, amount(s.brake));
      sum.hardBrake ||= !!s.hardBrake;
    }
    sum.steer = Math.max(-1, Math.min(1, sum.steer));
    return sum;
  }
  // Called after each physics step (and while live driving is suspended), so a one-step pulse from a
  // source drives exactly one step. Only a source whose stepped() consumed something is re-read
  // (from its `state`); every other source keeps this frame's polled sample.
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
