// Keyboard state and one-shot key actions.

export class Input {
  constructor(actions = {}) {
    this.keys = new Set();
    this.actions = actions;
    this.manualActive = false;
    window.addEventListener("keydown", (ev) => {
      if (document.querySelector("dialog[open]")) return;
      if (ev.target && ["INPUT", "TEXTAREA", "SELECT"].includes(ev.target.tagName)) return;
      const k = ev.key.toLowerCase();
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.target?.closest?.("button") && [" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) return;
      if (["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        ev.preventDefault();
        this.keys.add(k);
        return;
      }
      const map = { j: "autopilot", c: "camera", r: "reset", p: "pause", q: "signalLeft", e: "signalRight", h: "horn", "1": "brain1", "2": "brain2", "?": "help", "/": "help", escape: "escape" };
      if (ev.repeat && map[k]) return;
      if (map[k] && this.actions[map[k]]) { ev.preventDefault(); this.actions[map[k]](); }
    });
    window.addEventListener("keyup", (ev) => this.keys.delete(ev.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }
  get throttle() { return this.keys.has("w") || this.keys.has("arrowup"); }
  get brake() { return this.keys.has("s") || this.keys.has("arrowdown"); }
  get left() { return this.keys.has("a") || this.keys.has("arrowleft"); }
  get right() { return this.keys.has("d") || this.keys.has("arrowright"); }
  get hardBrake() { return this.keys.has(" "); }
  get anyDriving() { return this.throttle || this.brake || this.left || this.right || this.hardBrake; }
}
