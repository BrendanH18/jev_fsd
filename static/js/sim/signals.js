// Traffic-signal phases as a pure function of time, and per-vehicle stop-sign memory.
// Cycle (48 s): A green 20, A yellow 3, all red 1, B green 20, B yellow 3, all red 1.

export function phaseOf(intersection, t) {
  const u = ((t + intersection.offset_s) % intersection.cycle_s + intersection.cycle_s) % intersection.cycle_s;
  const A = u < 20 ? "green" : u < 23 ? "yellow" : "red";
  const B = u >= 24 && u < 44 ? "green" : u >= 44 && u < 47 ? "yellow" : "red";
  return { A, B, u };
}

export function signalFor(map, control, t) {
  if (!control || control.type !== "signal") return null;
  const inter = map.intersections.get(control.id);
  if (!inter) return null;
  return phaseOf(inter, t)[control.group] || "red";
}

// Seconds until the given group next turns green (0 when green now).
export function secondsToGreen(intersection, group, t) {
  const { u } = phaseOf(intersection, t);
  const start = group === "A" ? 0 : 24;
  const end = group === "A" ? 20 : 44;
  if (u >= start && u < end) return 0;
  return ((start - u) + intersection.cycle_s) % intersection.cycle_s;
}

// Stop-sign progress for one vehicle: approaching -> stopped -> completed. Reset when the vehicle
// moves on to another control.
export class StopMemory {
  constructor() { this.controlId = null; this.state = "approaching"; this.stoppedFor = 0; this.stops = 0; }
  update(control, bumperToLine, v, dt) {
    if (!control || control.type !== "stop") { this.reset(); return this.state; }
    if (control.id !== this.controlId) { this.reset(); this.controlId = control.id; }
    if (this.state === "completed") return this.state;
    if (Math.abs(v) < 0.2 && bumperToLine < 3.0 && bumperToLine > -6) {
      this.stoppedFor += dt;
      if (this.state === "approaching") { this.state = "stopped"; this.stops++; }
      if (this.stoppedFor >= 0.7) this.state = "completed";
    } else if (this.state === "stopped") {
      this.stoppedFor = 0;
      this.state = "approaching";
    }
    return this.state;
  }
  reset() { this.controlId = null; this.state = "approaching"; this.stoppedFor = 0; }
  get completed() { return this.state === "completed"; }
}
