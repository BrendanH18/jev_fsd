// The car giving way to an emergency vehicle (sim/emergency.js), as it senses it: the sensing side of the
// emergency record (sim/features/emergency.js), `snap.emergency` and `snap.emergency_ahead`.

import { wrap } from "./world.js";
import { hooks } from "./features/index.js";
import {
  EMERGENCY_NAMES,
  EV_BOX_M,
  FOLLOW_M,
  IN_WAY_M,
  emergencyLead,
  kerbCars,
  parkedRoom,
  isEmergency,
  isJunction,
  nearestCall,
  pullOverOffset,
} from "./emergency.js";

// (where a registered feature has the car stop short of, pulling over: a one-car corridor between
// snowbanks, say)
const EV_STOP = hooks("evStop");

// Giving way to an emergency vehicle (sim/emergency.js) calling on the car: it hears the siren
// within 100 m whether or not it can see the vehicle. When the call comes it picks where to stop:
// its stopping distance braking at 1.5 m/s^2 (at least 8 m on, leaving room to steer over even from
// rest, and 12 m more for each lane it crosses into the curb lane; chosen again from where it is if it
// could no longer stop there even braking at 6 m/s^2), or short of the next junction (2.5 m short
// of the crossing street, or of the stop line) if it can stop there braking at up to 3.5 m/s^2,
// else past it, leaving 8 m to finish steering once its rear clears the junction. It pulls over
// to the right as it stops (across into the curb lane where there are several, as far as the stop
// leaves room to change lanes, then into an empty parking lane beside it, see pullOverOffset)
// and waits there until the vehicle has gone by. If the vehicle is stuck behind the car for 3 s,
// going its way, the car drives on ahead of it instead. Once one has gone by, the car stays 150 m behind it.
export const EV_STOP_DECEL = 1.5;
const EV_FIRM_DECEL = 3.5;
const EV_SHORT_M = 2.5;
const ALONGSIDE_M = 4; // an emergency vehicle this close beside the car, going round it
const EV_STEER_M = 8;
const EV_LATE_S = 1; // a pull-over not begun this long after it was planned has started late
// More room to stop in for each lane it crosses into the curb lane to pull over: the sharpest lane change
// offered (MIN_CHANGE_M, brain/candidates.js). With 8 m in all, a car crossing from the inner lane of
// West Broadway reached its stop at an angle, short of the curb lane's middle, and one standing in the
// left lane of three on 11 Avenue SW (Calgary) stood across the middle one, in a fire truck's way.
const EV_CROSS_M = 12;
const EV_CLEAR_MPS = 10 / 3.6; // keep moving slowly enough to yield while finishing the lateral move
const EV_HARD_DECEL = 6;
const EV_OVERSHOOT_M = 1.5; // how far a short stop overshoots

// An emergency vehicle calling on the car to give way (see EV_STOP_DECEL), or null: which one
// (`kind`), where it comes from relative to the car, how far away it is and when it gets to the
// car, whether the car can see it, and where the car stops (`stop_s_route`, front bumper) and how
// far right of its lane's centre it pulls over (`offset_m`); `clearing` when that is past a
// junction, and `lead` (no stop) when the vehicle is stuck behind the car. The stop is chosen once
// per call and remembered in `world.evYield`.
export function emergencyYield(world, p, frontS, lane, visible, intersection = null, executing = null) {
  const { ego, route, map } = world;
  const evs = world.npcs.filter(isEmergency);
  if (!evs.length) {
    world.evYield = null;
    return null;
  }
  // where the car is and will be over the next 20 m, along its route
  const mid = ego.spec.length / 2 - ego.spec.rearOverhang;
  const pts = [0, 10, 20].map((d) => route.offsetPointAt(Math.min(route.length, p.s + mid + d), lane.center));
  pts[0] = [ego.x + Math.cos(ego.psi) * mid, ego.y + Math.sin(ego.psi) * mid];
  // Keep the obligation while the physical approach still leads into the siren's path.
  // A rounded route corner can already turn away while the car has not begun turning.
  for (const d of [10, 20]) pts.push([pts[0][0] + Math.cos(ego.psi) * d, pts[0][1] + Math.sin(ego.psi) * d]);
  const call = nearestCall(ego, evs, pts);
  if (!call) {
    world.evYield = null;
    return null;
  }
  const ev = call.ev;
  let plan = world.evYield;
  const v = Math.max(0, ego.v);
  // (and again if the car could no longer stop there, or within the 1.5 m a short stop overshoots,
  // even braking hard, having been slow to start)
  // (well past it is handled below)
  if (
    !plan ||
    plan.id !== ev.id ||
    plan.route !== route ||
    (frontS <= plan.stop + EV_OVERSHOOT_M && (plan.stop + EV_OVERSHOOT_M - frontS) * 2 * EV_HARD_DECEL < v * v)
  ) {
    const crossing = lane.shift ? 0 : Math.max(0, lane.lanes - 1 - lane.index) * EV_CROSS_M;
    let stop = frontS + Math.max(EV_STEER_M + crossing, (v * v) / (2 * EV_STOP_DECEL)),
      clearing = false;
    // junctions along the route from here to there: stop short of the first, or clear it
    // (from the street before this one: the car may still be in the junction it has just come through)
    // (where each node is along the polyline, not the summed edge lengths, which run metres ahead of it
    // past rounded corners: Route.laneEdgeStarts)
    const starts = route.laneEdgeStarts();
    for (let i = Math.max(0, route.laneEdgeAt(p.s) - 1); i < route.edges.length - 1; i++) {
      const e = map.edges.get(route.edges[i]),
        sNode = starts[i + 1];
      if (sNode - frontS > stop - frontS + 40) break;
      if (!isJunction(map, e.to)) continue;
      const half = map.crossingHalfWidth(e.id),
        line = route.controls.find((c) => c.edge === e.id);
      // (out of the box round its node, as the audit measures entering it)
      const short = Math.min(sNode - half - EV_SHORT_M, sNode - EV_BOX_M - 0.5, line ? line.sRoute - 0.5 : Infinity);
      const clear = sNode + half + ego.spec.length + 1 + EV_STEER_M;
      // At or past that stop but still out of the junction (the crossing street and the box), slow enough
      // to stop within the 1.5 m a short stop overshoots: stopped at its line or a little over it, or crept
      // past a stop sign's line to look. It is short of the junction, not in it, and stops there: not on
      // over its line (the audit takes holding a line stop as yielding, and moving on over the line as
      // giving that up), over a signal's line where it is, and over a stop sign's line using what room
      // there is up to the junction, and up to where it would wait to look, to pull over. Moving off
      // through a light that is not red, it is on its way through: it clears the junction, as below.
      const inside = Math.min(sNode - half, sNode - EV_BOX_M - 0.5),
        halt = (v * v) / (2 * EV_FIRM_DECEL);
      const through =
        line?.control?.type === "signal" &&
        v > 0.5 &&
        intersection?.id === line.control.id &&
        intersection.signal !== "red";
      if (frontS > short && frontS + halt <= inside && halt <= EV_OVERSHOOT_M && !through) {
        const over = !!line && frontS > line.sRoute;
        const room =
          over && line.control?.type === "signal"
            ? frontS
            : Math.min(stop, inside, line ? line.sPeek : Infinity, line && !over ? line.sRoute - 0.5 : Infinity);
        stop = Math.max(frontS + halt, room);
        break;
      }
      if (frontS > short && frontS < clear) {
        stop = Math.max(stop, clear);
        clearing = true;
        continue;
      }
      if (short >= stop || short < frontS) continue;
      if (short - frontS >= (v * v) / (2 * EV_FIRM_DECEL)) stop = Math.max(frontS + 0.3, short);
      else {
        stop = Math.max(stop, clear);
        clearing = true;
      }
      break;
    }
    // Finish steering after a corner, while remaining short of where a registered feature has the car keep
    // out (a one-car corridor between snowbanks, say, whose approach detour is no place to stop while
    // pulling right).
    for (const keepShort of EV_STOP) stop = keepShort(world, route, frontS, v, stop, EV_FIRM_DECEL);
    stop = Math.min(stop, route.length - 1);
    // (the furthest lane right the stop leaves room to change into: the curb lane, or short of a junction
    // perhaps only the one it is in)
    const reach = lane.index + Math.floor(Math.max(0, stop - frontS - EV_STEER_M) / EV_CROSS_M);
    plan = world.evYield = {
      id: ev.id,
      route,
      stop,
      speed: v,
      since: world.t,
      tight: stop - frontS < EV_STEER_M - 1e-6,
      clearing,
      reach,
    };
  }
  // A pull-over still not begun a second after it was planned (its forward simulations kept rejecting it,
  // say), with less than half the steering distance left, finishes its move within the stop, as one
  // planned short does. With more room the ordinary pursuit still gets over (Kitsilano city rain s1-9,
  // begun 6.2 m short), and the shorter one can swing the car's nose into the parked cars' margin; with
  // less it stops short (06:30 s1-4 on Vine Street, begun 3.6 m short: 0.17 m over). One begun keeps its
  // ordinary pursuit, even if dropped for a moment.
  if (executing?.candidate?.id === "pull_over") plan.begun = true;
  if (!plan.tight && !plan.begun && world.t - plan.since >= EV_LATE_S && plan.stop - frontS < EV_STEER_M / 2)
    plan.tight = true;
  // well past the stop (overshot it, beyond what a short stop overshoots): stop where the car can,
  // braking firmly
  if (frontS > plan.stop + EV_OVERSHOOT_M)
    plan.stop = Math.min(route.length - 1, frontS + (v > 0.3 ? (v * v) / (2 * EV_FIRM_DECEL) : 0));
  // The physical call owns drive-on authorization, including whether the car yielded first.
  // (but one drawing alongside to go round after all can turn across the car's nose: until it is past, the
  // car keeps still where it is)
  const at0 = ego.toLocal(ev.x, ev.y),
    evSpec = ev.spec || ego.spec;
  const alongside =
    at0.ahead + evSpec.length - evSpec.rearOverhang > -ego.spec.rearOverhang &&
    at0.ahead - evSpec.rearOverhang < ego.spec.length - ego.spec.rearOverhang &&
    Math.abs(at0.right) < ALONGSIDE_M;
  if (emergencyLead(world, ev) && alongside) {
    return {
      id: ev.id,
      kind: EMERGENCY_NAMES[ev.kind] || ev.kind,
      from: call.relation,
      distance_m: call.distance_m,
      eta_s: call.eta_s,
      seen: visible.includes(ev),
      stop_s_route: frontS,
      bumper_to_stop_m: 0,
      offset_m: 0,
      steer_at_stop: false,
      max_speed_mps: EV_CLEAR_MPS,
      clearing: false,
      lead: false,
      alongside: true,
    };
  }
  const lead = emergencyLead(world, ev);
  // pulled over: into the parking lane where nothing is parked (nor waiting to pull out) from 10 m
  // behind the stop to 5 m on
  const i = route.edgeIndexAt(plan.stop - ego.spec.length / 2),
    e = map.edges.get(route.edges[i]);
  const at = route.pointAt(plan.stop),
    h = route.headingAt(plan.stop);
  const free = !kerbCars(world, at[0], at[1], 20).some((c) => {
    const ahead = (c.x - at[0]) * Math.cos(h) + (c.y - at[1]) * Math.sin(h),
      right = (c.x - at[0]) * Math.sin(h) - (c.y - at[1]) * Math.cos(h);
    return (
      ahead > -10 - ego.spec.length &&
      ahead < 5 &&
      right - lane.center - (lane.shift ? 0 : Math.max(0, lane.lanes - 1 - lane.index) * e.lane_width) > 1
    );
  });
  // (from a lane further out, across into the curb lane and over in it, as far as the stop leaves room for
  // the lane changes; else over in the furthest lane it can reach)
  const cross = lane.shift ? 0 : Math.max(0, Math.min(lane.lanes - 1, plan.reach ?? Infinity) - lane.index);
  const across = cross * e.lane_width,
    curb = lane.shift || lane.index + cross >= lane.lanes - 1;
  let offset = across + pullOverOffset(e, e.lanes - 1, ego.spec.width, curb && !lane.shift && free);
  // (beside cars parked close to a narrow lane's line, only as far over as they leave room: sim/emergency.js)
  if (!free && !across) {
    const mid = route.offsetPointAt(
      Math.max(0, plan.stop - (ego.spec.length - ego.spec.rearOverhang) + ego.spec.length / 2),
      lane.center,
    );
    offset = Math.max(0, Math.min(offset, parkedRoom(world, mid[0], mid[1], h, ego.spec)));
  }
  return {
    id: ev.id,
    kind: EMERGENCY_NAMES[ev.kind] || ev.kind,
    from: call.relation,
    distance_m: call.distance_m,
    eta_s: call.eta_s,
    seen: visible.includes(ev),
    stop_s_route: lead ? null : plan.stop,
    bumper_to_stop_m: lead ? null : plan.stop - frontS,
    offset_m: lead ? 0 : offset,
    steer_at_stop: !!plan.tight,
    // A car already slow or stopped only crawls forward to steer over; the extra steering room
    // must not make it hold its observation speed indefinitely. Slow at the stopping
    // deceleration to a crawl while steering over, even if clearing leaves a longer run.
    max_speed_mps: Math.min(
      Math.max(2, plan.speed ?? v),
      Math.max(EV_CLEAR_MPS, (plan.speed ?? v) - EV_STOP_DECEL * Math.max(0, world.t - (plan.since ?? world.t))),
    ),
    clearing: plan.clearing,
    lead,
  };
}

// An emergency vehicle with its siren on ahead of the car, going its way along its route, within
// FOLLOW_M (one it has let go by): the car drops back that far.
export function emergencyAhead(world, p, frontS) {
  const { route } = world;
  let best = null;
  for (const ev of world.npcs) {
    if (!isEmergency(ev) || Math.hypot(ev.x - world.ego.x, ev.y - world.ego.y) > FOLLOW_M + 20) continue;
    const q = route.project(ev.x, ev.y, p.index);
    // (anywhere across the street: it drives along its middle)
    if (!q || q.distance > IN_WAY_M || Math.abs(wrap(ev.psi - q.heading)) > Math.PI / 4) continue;
    const gap = q.s - ev.spec.rearOverhang - frontS;
    if (gap < -1 || gap > FOLLOW_M) continue;
    if (!best || gap < best.gap_m)
      best = {
        id: ev.id,
        kind: EMERGENCY_NAMES[ev.kind] || ev.kind,
        gap_m: Math.max(0, gap),
        speed: Math.max(0, ev.v),
      };
  }
  return best;
}
