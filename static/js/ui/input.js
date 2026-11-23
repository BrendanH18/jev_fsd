// Keyboard state and one-shot key actions, plus the analog sources that drive the same way: a
// gamepad (ui/gamepad.js) and the touch controls (ui/touch.js). The keys give 1 or 0; a source gives
// any amount between, and World.stepManual takes either.

const editing = (target) => target?.isContentEditable || target?.closest?.("input, textarea, select, [role='textbox']");
const control = (target) => target?.closest?.("button, a, [role='button'], [role='radio'], [role='switch']");

export class Input {
  constructor(actions = {}) {
    this.keys = new Set();
    this.actions = actions;
    this.manualActive = false;
    this.sources = []; // analog sources, each with a `state` (see poll)
    this.analog = { steer: 0, throttle: 0, brake: 0, hardBrake: false };
    window.addEventListener("keydown", (ev) => {
      if (ev.defaultPrevented || document.querySelector("dialog[open]") || editing(ev.target)) {
        this.keys.clear();
        return;
      }
      const k = ev.key.toLowerCase();
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
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
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.keys.clear();
    });
    document.addEventListener("focusin", (ev) => {
      if (document.querySelector("dialog[open]") || editing(ev.target) || control(ev.target)) this.keys.clear();
    });
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
    const sum = { steer: 0, throttle: 0, brake: 0, hardBrake: false };
    const blocked = typeof document !== "undefined" && document.querySelector?.("dialog[open]");
    for (const source of this.sources) {
      const s = source.poll ? source.poll() : source.state;
      if (!s || blocked) continue;
      sum.steer += Number(s.steer) || 0;
      sum.throttle = Math.max(sum.throttle, Number(s.throttle) || 0);
      sum.brake = Math.max(sum.brake, Number(s.brake) || 0);
      sum.hardBrake ||= !!s.hardBrake;
    }
    sum.steer = Math.max(-1, Math.min(1, sum.steer));
    this.analog = sum;
    return sum;
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
