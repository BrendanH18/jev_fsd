// Signal phases as f(t), plus per-vehicle stop-sign memory.
// Timing: yellow = 1 s PRT + ITE stop distance at 3.05 m/s² (3–5 s); all-red clears the box;
// cycle 60 s arterial / 50 s else; green split by lane×speed with walk + 1.2 m/s crossing floor.
// Parallel pedestrians get a 7 s walk, then flashing don't-walk ending as yellow begins.

// A full stop anywhere within this many meters before the line counts as stopping at the sign.
export const STOP_ZONE_M = 6.0;
export const WALK_S = 7;
const PED_SPEED = 1.2;
const ARTERIAL = new Set(["primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link"]);

// Build the plan from the approaches' streets. `map` is the MapData (edges with limits and widths).
export function timingPlan(inter, map) {
  const groups = { A: { speed: 0, weight: 0, width: 0, arterial: false }, B: { speed: 0, weight: 0, width: 0, arterial: false } };
  for (const a of inter.approaches) {
    const e = map.edges.get(a.edge);
    const g = groups[a.group];
    if (!e || !g) continue;
    g.speed = Math.max(g.speed, e.limit || 13.9);
    g.weight += (e.lanes || 1) * (e.limit || 13.9);
    g.width = Math.max(g.width, (e.asphalt ? e.asphalt[1] - e.asphalt[0] : 7));
    g.arterial = g.arterial || ARTERIAL.has(e.cls);
  }
  for (const g of Object.values(groups)) { if (!g.speed) g.speed = 13.9; if (!g.weight) g.weight = 13.9; if (!g.width) g.width = 8; }
  const round = (x) => Math.round(x * 10) / 10;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const phase = (me, other) => ({
    yellow: round(clamp(1 + me.speed / (2 * 3.05), 3, 5)),
    allRed: round(clamp((other.width + 5.5) / me.speed, 1, 3)),
    // traffic on this phase runs alongside the pedestrians who cross the other group's street
    minGreen: WALK_S + other.width / PED_SPEED,
  });
  const pA = phase(groups.A, groups.B), pB = phase(groups.B, groups.A);
  const cycle = groups.A.arterial || groups.B.arterial ? 60 : 50;
  const green = cycle - pA.yellow - pA.allRed - pB.yellow - pB.allRed;
  let gA = round(green * groups.A.weight / (groups.A.weight + groups.B.weight));
  gA = round(clamp(gA, pA.minGreen, green - pB.minGreen));
  const gB = round(green - gA);
  const A = { start: 0, green: gA, yellow: pA.yellow, allRed: pA.allRed };
  const B = { start: round(gA + pA.yellow + pA.allRed), green: gB, yellow: pB.yellow, allRed: pB.allRed };
  return { cycle, A, B };
}

function planOf(intersection) {
  // maps loaded without a plan fall back to the old fixed 48 s cycle
  return intersection.plan || {
    cycle: intersection.cycle_s || 48,
    A: { start: 0, green: 20, yellow: 3, allRed: 1 },
    B: { start: 24, green: 20, yellow: 3, allRed: 1 },
  };
}

function stateIn(p, u) {
  const d = u - p.start;
  return d >= 0 && d < p.green ? "green" : d >= p.green && d < p.green + p.yellow ? "yellow" : "red";
}

export function phaseOf(intersection, t) {
  const plan = planOf(intersection);
  const c = plan.cycle;
  const u = ((t + (intersection.offset_s || 0)) % c + c) % c;
  return { A: stateIn(plan.A, u), B: stateIn(plan.B, u), u };
}

// The pedestrian signal for people walking alongside `group`'s traffic: "walk", "flash" (the
// flashing hand: finish crossing, do not start), or "dont".
export function pedPhase(intersection, group, t) {
  const plan = planOf(intersection);
  const p = plan[group];
  if (!p) return "dont";
  const c = plan.cycle;
  const u = ((t + (intersection.offset_s || 0)) % c + c) % c;
  const d = ((u - p.start) % c + c) % c;
  if (d < Math.min(WALK_S, p.green)) return "walk";
  if (d < p.green) return "flash";
  return "dont";
}

export function signalFor(map, control, t) {
  if (!control || control.type !== "signal") return null;
  const inter = map.intersections.get(control.id);
  if (!inter) return null;
  return phaseOf(inter, t)[control.group] || "red";
}

// Seconds until the given group next turns green (0 when green now).
export function secondsToGreen(intersection, group, t) {
  const plan = planOf(intersection);
  const p = plan[group];
  const c = plan.cycle;
  const u = ((t + (intersection.offset_s || 0)) % c + c) % c;
  if (stateIn(p, u) === "green") return 0;
  return ((p.start - u) % c + c) % c;
}

// Stop-sign progress for one vehicle: approaching -> stopped -> completed. Reset when the vehicle
// moves on to another control.
export class StopMemory {
  constructor() { this.controlId = null; this.state = "approaching"; this.stoppedFor = 0; this.stops = 0; }
  update(control, bumperToLine, v, dt) {
    if (!control || control.type !== "stop") { this.reset(); return this.state; }
    if (control.id !== this.controlId) { this.reset(); this.controlId = control.id; }
    if (this.state === "completed") return this.state;
    if (Math.abs(v) < 0.2 && bumperToLine < STOP_ZONE_M && bumperToLine > -6) {
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
