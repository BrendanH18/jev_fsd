// Signal phases as f(t), plus per-vehicle stop-sign memory.
// Timing: yellow = 1 s reaction time + speed / (2 × 3.05 m/s²), clamped to 3–5 s; all-red clears the box;
// cycle 60 s arterial / 50 s else; green split by lane×speed with walk + 1.2 m/s crossing floor.
// Parallel pedestrians get a 7 s walk, then flashing don't-walk ending as yellow begins.
//
// Advance greens: where two multi-lane major streets cross, one approach on one of them may lead its
// group with a protected left turn (advanceFor). The cycle grows to fit it: for the first ADVANCE_S
// of its group's green it alone goes, and the approach opposite it (and any other in its group)
// waits on red; then ADVANCE_CLEAR_S of clearance (3 s of yellow arrow and 1 s of red for the turn),
// and the whole group has its usual green, left turns yielding to oncoming traffic as ever. How it
// shows depends on the province (advanceStyle): in Ontario and Québec a flashing green ball, under
// which the approach may go left, straight or right (the MTO Driver's Handbook, "Traffic lights";
// the SAAQ's "feu vert clignotant"); elsewhere a green left arrow beside a red ball, under which only
// the left turn goes (as BC's Motor Vehicle Act s. 130 has it). The pedestrians walking alongside
// that group start their walk once the clearance is over: the turn would cut across them.

// A full stop anywhere within this many meters before the line counts as stopping at the sign.
export const STOP_ZONE_M = 6.0;
export const WALK_S = 7;
const PED_SPEED = 1.2;
const ARTERIAL = new Set(["primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link"]);
const MAJOR = new Set(["primary", "secondary"]);
export const ADVANCE_S = 8;
export const ADVANCE_CLEAR_S = 4;
const ARROW_YELLOW_S = 3;
// An approach and the one opposite it: headings within this of a half turn apart.
const OPPOSITE_RAD = Math.PI / 6;
// Ontario and Québec, where an advance green is a flashing green ball (lon, lat): a coarse outline,
// from the Manitoba border east to the Gulf of St. Lawrence, without New Brunswick and Nova Scotia
// south of the Gaspé. Elsewhere it is a green left arrow (in BC a flashing green means a
// pedestrian-controlled signal, so it must never be one there).
const FLASHING_GREEN = [[-95.15, 41.6], [-95.15, 62.6], [-57.1, 62.6], [-57.1, 51.4], [-64.0, 48.9], [-66.3, 48.1], [-69.06, 48.07],
  [-69.06, 47.4], [-70.0, 46.7], [-71.5, 45.0], [-74.7, 45.0], [-76.4, 44.2], [-79.0, 43.2], [-82.5, 41.6]];

// "flash" or "arrow", for a map whose bounding box is [W, S, E, N] (judged at its centre).
export function advanceStyle(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return "arrow";
  const x = (bbox[0] + bbox[2]) / 2, y = (bbox[1] + bbox[3]) / 2;
  let inside = false;
  for (let i = 0, j = FLASHING_GREEN.length - 1; i < FLASHING_GREEN.length; j = i++) {
    const [ax, ay] = FLASHING_GREEN[i], [bx, by] = FLASHING_GREEN[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? "flash" : "arrow";
}

// The approach that leads its group with a protected left, or null: on a major street, two lanes or
// more, with a left turn out of it and an approach opposite it in its group, at a junction where
// such a street crosses (the other group has one too). Of several, the busiest (lanes x limit),
// then the first by edge id.
function advanceFor(inter, map) {
  if (typeof map.successors !== "function") return null;
  const major = (a) => MAJOR.has(map.edges.get(a.edge)?.cls) && (map.edges.get(a.edge).lanes || 1) >= 2;
  if (!["A", "B"].every((g) => inter.approaches.some((a) => a.group === g && major(a)))) return null;
  let best = null;
  for (const a of inter.approaches) {
    const e = map.edges.get(a.edge);
    if (!e || !major(a)) continue;
    const opposite = inter.approaches.some((o) => o !== a && o.group === a.group
      && Math.PI - Math.abs(((o.heading_deg - a.heading_deg) * Math.PI / 180 + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < OPPOSITE_RAD);
    if (!opposite || !map.successors(a.edge).some((id) => map.classifyTurn(map.turnAngle(a.edge, id)) === "left")) continue;
    const busy = (e.lanes || 1) * (e.limit || 13.9);
    if (!best || busy > best.busy || (busy === best.busy && String(a.edge) < String(best.edge))) best = { edge: a.edge, group: a.group, busy };
  }
  return best && { edge: best.edge, group: best.group, length: ADVANCE_S, clear: ADVANCE_CLEAR_S, style: map.advanceStyle || "arrow" };
}

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
  // (an advance green adds itself and its clearance to its group's green, and so to the cycle)
  const advance = advanceFor(inter, map);
  const extra = advance ? advance.length + advance.clear : 0;
  const gA2 = round(gA + (advance?.group === "A" ? extra : 0)), gB2 = round(gB + (advance?.group === "B" ? extra : 0));
  const A = { start: 0, green: gA2, yellow: pA.yellow, allRed: pA.allRed };
  const B = { start: round(gA2 + pA.yellow + pA.allRed), green: gB2, yellow: pB.yellow, allRed: pB.allRed };
  return { cycle: cycle + extra, A, B, ...(advance ? { advance } : {}) };
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
  // (alongside a group led by an advance green, the walk waits for it and its clearance)
  const adv = plan.advance?.group === group ? plan.advance.length + plan.advance.clear : 0;
  const d = ((u - p.start) % c + c) % c;
  if (d < adv) return "dont";
  if (d < Math.min(adv + WALK_S, p.green)) return "walk";
  if (d < p.green) return "flash";
  return "dont";
}

// What one approach (by its edge) shows: its group's "green", "yellow" or "red", or, while an advance
// green leads its group, "advance" (a flashing green ball: go any way, the turn left protected),
// "arrow" (a green left arrow beside a red ball) or "arrow_yellow" (the arrow turning yellow, for
// ARROW_YELLOW_S, then red to the end of the clearance) for the approach that has it, "green" for it
// through the clearance under a flashing green, and "red" for the rest of its group until the
// clearance is over.
export function approachPhase(intersection, edgeId, t) {
  const plan = planOf(intersection);
  const a = intersection.approaches?.find((x) => x.edge === edgeId);
  const group = a?.group;
  const ph = phaseOf(intersection, t), base = ph[group] || "red";
  const adv = plan.advance;
  if (!adv || adv.group !== group) return base;
  const c = plan.cycle, d = ((ph.u - plan[group].start) % c + c) % c;
  if (d >= adv.length + adv.clear) return base;
  if (edgeId !== adv.edge) return "red";
  if (d < adv.length) return adv.style === "flash" ? "advance" : "arrow";
  return adv.style === "flash" ? "green" : d < adv.length + ARROW_YELLOW_S ? "arrow_yellow" : "red";
}

// Whether an advance green (or its clearance) held by another approach is under way while `edgeId`
// waits on its red: then a right turn on red from it would cut across the protected left turns
// coming into the same street, and waits.
export function advanceHolds(intersection, edgeId, t) {
  const plan = planOf(intersection), adv = plan.advance;
  if (!adv || edgeId === adv.edge || intersection.approaches?.find((x) => x.edge === edgeId)?.group !== adv.group) return false;
  const c = plan.cycle, u = ((t + (intersection.offset_s || 0)) % c + c) % c;
  return ((u - plan[adv.group].start) % c + c) % c < adv.length + adv.clear;
}

const isLeft = (turn) => turn === "left" || turn === "uturn";
// The light for a movement (`turn`: "left", "uturn", "straight" or "right") on an approach showing
// `state`: "green", "yellow" or "red".
export function movementSignal(state, turn) {
  if (state === "advance") return "green";
  if (state === "arrow") return isLeft(turn) ? "green" : "red";
  if (state === "arrow_yellow") return isLeft(turn) ? "yellow" : "red";
  return state;
}
// Whether the movement goes protected: a left turn under an advance green, oncoming traffic held.
export const protectedLeft = (state, turn) => (state === "advance" || state === "arrow") && isLeft(turn);

// Seconds until the given group next turns green (0 when green now). With an approach (`edgeId`) and
// a movement, until that movement does: behind an advance green held by another approach, or going
// any way but left under an arrow, that is once the advance and its clearance are over.
export function secondsToGreen(intersection, group, t, edgeId = null, turn = "straight") {
  const plan = planOf(intersection);
  const p = plan[group];
  const c = plan.cycle;
  const u = ((t + (intersection.offset_s || 0)) % c + c) % c;
  if (edgeId === null) {
    if (stateIn(p, u) === "green") return 0;
    return ((p.start - u) % c + c) % c;
  }
  if (movementSignal(approachPhase(intersection, edgeId, t), turn) === "green") return 0;
  // (the approach with the advance turning left has two greens a cycle, the arrow and the group's
  // green after its clearance: the nearer one)
  const adv = plan.advance;
  if (!adv || adv.group !== group) return ((p.start - u) % c + c) % c;
  const starts = [p.start + adv.length + adv.clear];
  if (edgeId === adv.edge && (adv.style === "flash" || isLeft(turn))) starts.push(p.start);
  return Math.min(...starts.map((s) => ((s - u) % c + c) % c));
}

// Stop-sign progress for one vehicle: approaching -> stopped -> completed. Reset when the vehicle
// moves on to another control. A signal's line is tracked the same way: a right turn on red needs
// a full stop at it first.
export class StopMemory {
  constructor() { this.controlId = null; this.state = "approaching"; this.stoppedFor = 0; this.stops = 0; }
  update(control, bumperToLine, v, dt) {
    if (!control || (control.type !== "stop" && control.type !== "signal")) { this.reset(); return this.state; }
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

// What the HUD tells the driver about the signal its route takes it through next, within
// NOTICE_M and in sight, while an advance green shows on its approach: { key, text, protected }
// (whether the car's turn is protected), or null.
const NOTICE_M = 60;
const NOTICES = {
  advance: ["ADVANCE GREEN · LEFT TURN PROTECTED", "ADVANCE GREEN · ONCOMING TRAFFIC HELD"],
  arrow: ["LEFT ARROW · TURN PROTECTED", "LEFT ARROW · NOT YOUR LIGHT · WAIT FOR GREEN"],
  arrow_yellow: ["YELLOW ARROW · TURN ENDING · STOP IF YOU CAN", null],
};
export function advanceNotice(world) {
  const { route, ego, map } = world;
  if (!route) return null;
  const p = route.project(ego.x, ego.y, route.hint);
  if (!p || p.distance > 4) return null;
  const front = p.s + ego.spec.length - ego.spec.rearOverhang;
  const c = route.controls.find((k) => k.control.type === "signal" && k.sRoute > front - 1);
  const inter = c && c.sRoute - front <= NOTICE_M ? map.intersections.get(c.control.id) : null;
  if (!inter?.plan?.advance || !world.visibility.canSee(ego, inter.x, inter.y)) return null;
  const shows = approachPhase(inter, c.edge, world.t), text = NOTICES[shows]?.[isLeft(c.turn) ? 0 : 1];
  return text ? { key: `${inter.id}:${shows}`, text, protected: protectedLeft(shows, c.turn) } : null;
}
