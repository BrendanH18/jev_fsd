// School buses, and the rule that goes with them. A driver meeting or overtaking a school bus that
// is stopped with its red lights flashing must stop before reaching it, and stay stopped until it
// moves off or the lights go off (BC Motor Vehicle Act s. 149): traffic coming toward it as well as
// behind it, in every lane. Children getting off often cross the street in front of the bus, where
// it hides them from traffic on either side.
//
// In a free drive a school bus drives the streets like other traffic (sim/npc.js) and every 150 to
// 400 m stops to let children off: in its lane (a school bus does not pull in to the curb), mid-block
// on a two-way street with one lane each way and a limit of 50 km/h or less, at least 15 m clear of
// a junction behind it, 20 m clear of one ahead and 15 m clear of a marked crosswalk. Its amber lights
// flash from AMBER_M before the stop ("prepare to stop"); stopped, its red lights flash and its stop
// arm swings out from the driver's side. One to three children get off, one by one: some walk to the
// sidewalk beside the bus, the others walk forward past its front and cross in front of it to the far
// sidewalk (CROSS_AHEAD_M ahead of its front), stepping off only while its reds flash and nothing
// coming is too close to stop. The reds stay on for RED_S, and for as long as any of its children is
// still to cross (up to RED_MAX_S) or in the street; then the arm folds and the bus moves off LEAVE_S
// later.
//
// Who must stop: a driver whose path runs past the bus (the bus's near end, its rear seen from
// behind or its front coming toward it, within SIDE_M of the path) heading its way or toward it.
// One behind it stops BEHIND_M behind its rear; one coming toward it stops ONCOMING_M short of its
// front, clear of the children crossing there. A driver owes the stop when, seeing the reds come on
// (or seeing the bus already standing with them on), it can stop there braking at no more than
// OWED_DECEL; one that cannot, or is already beside the bus, carries on.

import { CAR, SCHOOL_BUS } from "./vehicle.js";
import { projectPoint } from "../map/mapdata.js";

export const SCHOOL_STOP_LIMIT_MPS = 50 / 3.6 + 0.05;
export const AMBER_M = 60;
export const BEHIND_M = 5;
export const ONCOMING_M = 10;
export const OWED_DECEL = 3.5;
export const SIDE_M = 9;
export const RED_S = [8, 14];
export const LEAVE_S = 1.5;
export const CROSS_AHEAD_M = 3;
export const STOP_EVERY_M = [150, 400];
export const KIDS = [1, 3];
export const KID_CROSS_P = 0.5;
export const KID_EVERY_S = 1.2;
export const RED_MAX_S = 45;          // (a child who cannot cross by then crosses on a gap instead)
export const CLEAR_BEHIND_M = 15;     // a stop's rear is this far clear of the junction behind it
export const CLEAR_AHEAD_M = 20;      // and its front this far clear of the junction ahead
export const CLEAR_CROSSWALK_M = 15;
const LOOK_M = 90;
const SAME_WAY = Math.PI / 6;

export const isSchoolBus = (v) => !!v && v.kind === "school_bus";
export const redsOn = (bus) => isSchoolBus(bus) && bus.school?.lights === "red";
export const ambersOn = (bus) => isSchoolBus(bus) && bus.school?.lights === "amber";
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const frontOf = (v) => (v.spec || CAR).length - (v.spec || CAR).rearOverhang;

// The end of the bus nearest a driver going `relation` to it: its rear seen from behind, its front
// seen coming toward it.
function nearEnd(bus, relation) {
  const bs = bus.spec || SCHOOL_BUS, d = relation === "behind" ? -bs.rearOverhang : bs.length - bs.rearOverhang;
  return [bus.x + Math.cos(bus.psi) * d, bus.y + Math.sin(bus.psi) * d];
}

// Where a driver whose path is the polyline `pts`/`cum`, its front `front` metres along, stops for
// school bus `bus` (whatever its lights): { relation ("behind" or "oncoming"), gap_m (front to the
// bus's near end, along the path), stop_m (front to where it stops) }, or null when the next `look`
// metres of the path do not run past the bus, or the driver's front is already level with its near
// end. The first stretch of the path ahead that does counts (further on, the path may turn back
// along the bus's street).
export function schoolBusHold(pts, cum, front, bus, look = LOOK_M) {
  const ends = { behind: nearEnd(bus, "behind"), oncoming: nearEnd(bus, "oncoming") };
  const from = front - (bus.spec || SCHOOL_BUS).length;
  for (let i = 0; i < pts.length - 1 && cum[i] <= front + look; i++) {
    const len = cum[i + 1] - cum[i];
    if (cum[i + 1] < from || len <= 0) continue;
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], rel = Math.abs(wrap(bus.psi - Math.atan2(dy, dx)));
    const relation = rel < SAME_WAY ? "behind" : rel > Math.PI - SAME_WAY ? "oncoming" : null;
    if (!relation) continue;
    const p = ends[relation], t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len);
    if (t < 0 || t > 1 || Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len > SIDE_M) continue;
    const gap = cum[i] + t * len - front;
    if (gap <= 0 || gap > look) return null;
    return { relation, gap_m: gap, stop_m: gap - (relation === "behind" ? BEHIND_M : ONCOMING_M) };
  }
  return null;
}

// The same, for a driver `o` going straight on as it heads (sensing-free: the audit and the HUD):
// { relation, ahead_m (its front to the bus's near end), right_m (how far right of its heading that
// end is) }, or null.
export function schoolBusRelation(o, bus) {
  const rel = Math.abs(wrap(bus.psi - o.psi));
  const relation = rel < SAME_WAY ? "behind" : rel > Math.PI - SAME_WAY ? "oncoming" : null;
  if (!relation || o === bus) return null;
  const [x, y] = nearEnd(bus, relation), l = o.toLocal(x, y);
  return { relation, ahead_m: l.ahead - frontOf(o), right_m: l.right };
}

// Whether a driver at speed `v` can stop within `room` metres braking at no more than OWED_DECEL.
export const canStopFor = (v, room) => room >= Math.max(0, v) ** 2 / (2 * OWED_DECEL);

// Where along a street a school bus may stop (see the top of this file): the range of its front's
// position along edge `e` ([lo, hi], metres along its centreline), or null.
export function stopRange(map, e, crosswalks = map.crosswalks || []) {
  if (!e || e.ring || e.lanes !== 1 || e.limit > SCHOOL_STOP_LIMIT_MPS || e.oneway) return null;
  if (![...(map.out.get(e.to) || [])].some((id) => map.edges.get(id)?.to === e.from)) return null;
  const L = e.cum ? e.cum[e.cum.length - 1] : e.length;
  let lo = SCHOOL_BUS.length + CLEAR_BEHIND_M, hi = L - CLEAR_AHEAD_M;
  if (e.control) hi = Math.min(hi, e.control.s_line - CLEAR_AHEAD_M);
  if (hi <= lo) return null;
  const blocked = [];
  for (const c of crosswalks) {
    const q = projectPoint(e.pts, e.cum, [c.x, c.y], null);
    if (q && q.distance < 12) blocked.push([q.s - CLEAR_CROSSWALK_M, q.s + SCHOOL_BUS.length + CLEAR_CROSSWALK_M]);
  }
  return { lo, hi, blocked };
}

// The first place in `range` (see stopRange) at or after `from`, or null.
export function firstStop(range, from) {
  if (!range) return null;
  let at = Math.max(range.lo, from);
  for (let moved = true; moved;) {
    moved = false;
    for (const [a, b] of range.blocked) if (at >= a && at < b) { at = b; moved = true; }
  }
  return at <= range.hi ? at : null;
}
