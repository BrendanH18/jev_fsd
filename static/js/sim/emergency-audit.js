// The audit of giving way to an emergency vehicle (sim/emergency.js), the World's side of the emergency
// record (sim/features/emergency.js): it runs after the cyclists' audit, and counts a failure to yield in
// the shared `failed_to_yield`. Its calls on the car are `world.evCalls`, where the drive-on latch is kept
// (sim/emergency.js emergencyLead); `world.evCounted` holds the vehicles a failure was counted for.

import { headingAt, pointAt } from "../map/mapdata.js";
import { comfort } from "./vehicle.js";
import { AUDIT_ROUTE_CORRIDOR_M, AUDIT_ROUTE_HEADING_RAD, wrap } from "./world.js";
import { FOLLOWING_STANDSTILL_M } from "./following.js";
import { hooks } from "./features/index.js";
import {
  EV_BOX_M,
  emergencyCall,
  emergencyLead,
  holdsUp,
  isEmergency,
  isJunction,
  parkedRoom,
  pullOverOffset,
} from "./emergency.js";

// What registered features tell the audit: the furthest right the car can be asked to pull over (a
// snowbank narrowing, say), and a stopped queue it approaches (a car reversing into a space, say).
const EV_KERB = hooks("evKerb"),
  EV_QUEUE_HOLD = hooks("evQueueHold");

// Giving way to an emergency vehicle (sim/emergency.js), seen or not, once it calls on the car: the
// car fails to yield if, from 2 s after the call came, it is faster than 3 m/s and has not slowed by
// at least 1 m/s^2 since then (unless, pulled over, it was told to drive on ahead of a vehicle stuck
// behind it);
// if its front enters a junction (8 m of its centre) that a vehicle coming from the side is due
// across, 3 s or more after the call came; if, 4 s or more after the call came, the vehicle draws
// level with it along its street (within 8 m to the side) while it is not pulled over and not in a
// junction (unless the call found it constrained by an existing line stop, including one between a
// give-way or stop line and where it looks from, or a close queue);
// or if the vehicle has been stuck behind it for 6 s while
// it is not pulled over (at least 0.2 m right of its lane's centre) and has not been told to drive on
// ahead of it. A second blocker directly ahead can prevent that too. In a snowbank
// narrowing the usable right edge replaces the old lane centre. Counted once a vehicle.
const AUDIT_EV_MOVING_MPS = 3;
const AUDIT_EV_DECEL = 1;
const AUDIT_EV_REACT_S = 2;
const AUDIT_EV_JUNCTION_S = 3;
const AUDIT_EV_BOX_M = EV_BOX_M;
const AUDIT_EV_BLOCK_S = 6;
const AUDIT_EV_PULLED_M = 0.2;
const AUDIT_EV_PULL_AHEAD_M = 5; // beside parked cars, the kerb this far ahead counts as where the car pulls over (stopped short of its stop in a queue, say)
const AUDIT_EV_PULL_S = 4;
const AUDIT_EV_SIDE_M = 8;
const AUDIT_EV_LINE_M = 2;
const AUDIT_EV_OVERSHOOT_M = 1.5; // a short stop at a line can end this far over it, and still be a stop at it
// Away from its line, a stop short of where the car looks from (`sPeek`) counts as a line stop only this close
// to it: a stop sign set well back from its junction leaves the street between them open to pull over in.
const AUDIT_EV_LOOK_M = 8;

export function auditEmergency(world, road) {
  const ego = world.ego,
    evs = world.npcs.filter(isEmergency);
  if (!evs.length) {
    world.evCalls.clear();
    world.evJunction = null;
    return;
  }
  const FRONT = ego.spec.length - ego.spec.rearOverhang;
  const fx = ego.x + Math.cos(ego.psi) * FRONT,
    fy = ego.y + Math.sin(ego.psi) * FRONT;
  let junction = null;
  for (const n of world.map.nodes.values()) {
    if (
      Math.abs(n.x - fx) < AUDIT_EV_BOX_M &&
      Math.abs(n.y - fy) < AUDIT_EV_BOX_M &&
      Math.hypot(n.x - fx, n.y - fy) < AUDIT_EV_BOX_M &&
      isJunction(world.map, n.id)
    ) {
      junction = n.id;
      break;
    }
  }
  const entered = junction !== null && junction !== world.evJunction && ego.v > 1;
  world.evJunction = junction;
  // A registered feature may move the usable right edge into the lane (snowbanks pushing the parked cars
  // out, say). A stopped car must not drive into the cars parked there to satisfy a measurement from the
  // old lane centre.
  let rightmost = Infinity;
  for (const kerb of EV_KERB) rightmost = Math.min(rightmost, kerb(world, road, FRONT));
  // The normal target leaves a settling allowance before this audit's minimum
  // (0.3 m versus 0.2 m for the standard car). Preserve that allowance when banks
  // move the target left; requiring exact equality with keepAt has no feasible
  // range between the audit and the parked-car clearance policy.
  const settling = road.lane
    ? Math.max(0, pullOverOffset(road.edge, road.lane.idx, ego.spec.width, false) - AUDIT_EV_PULLED_M)
    : 0;
  // (beside cars parked close to the lane's line, as far over as they leave room counts: sim/emergency.js)
  const besideParked = road.lane
    ? (() => {
        const mid = ego.spec.length / 2 - ego.spec.rearOverhang,
          s = Math.min(road.lane.length, road.s + mid);
        const [x, y] = pointAt(road.lane.pts, road.lane.cum, s);
        // (with the usual pull-over's settling allowance: its 0.3 m target is met at 0.2 m)
        return (
          parkedRoom(world, x, y, headingAt(road.lane.pts, road.lane.cum, s), ego.spec, AUDIT_EV_PULL_AHEAD_M) -
          (pullOverOffset(road.edge, road.lane.idx, ego.spec.width, false) - AUDIT_EV_PULLED_M)
        );
      })()
    : Infinity;
  // (stopped outside the curb lane with a vehicle alongside on the right, closer than a lane's width: the
  // lane it would pull over into is taken, and it stops where it is)
  const boxedRight =
    road.lane &&
    road.edge &&
    road.lane.idx < road.edge.lanes - 1 &&
    Math.abs(ego.v) < 0.3 &&
    world.npcs.some((n) => {
      if (isEmergency(n) || !n.obb) return false;
      const box = n.obb(),
        p = ego.toLocal(...box.center),
        angle = box.heading - ego.psi;
      const along = Math.abs(Math.cos(angle)) * box.halfLength + Math.abs(Math.sin(angle)) * box.halfWidth;
      const side = Math.abs(Math.sin(angle)) * box.halfLength + Math.abs(Math.cos(angle)) * box.halfWidth;
      const mid = ego.spec.length / 2 - ego.spec.rearOverhang;
      return (
        Math.abs(p.ahead - mid) < ego.spec.length / 2 + along &&
        p.right > 0 &&
        p.right - side - ego.spec.width / 2 < road.edge.lane_width
      );
    });
  const pulled =
    road.lane && (boxedRight || road.lateral + 1e-6 >= Math.min(AUDIT_EV_PULLED_M, rightmost - settling, besideParked));
  const control = road.edge?.control,
    toLine = control ? control.s_line - road.s - FRONT : Infinity;
  // Giving way at a junction without a sign or signal, or at a stop sign, the car stops anywhere from its
  // line to the point it looks from (`sPeek`, map/route.js; sim/priority.js), short of the junction, and
  // has no more room to pull over there than at the line. Measured along the route, as sensing does.
  const rp = world.route ? world.route.project(ego.x, ego.y, world.route.hint) : null;
  const routeFront =
    rp && rp.distance < AUDIT_ROUTE_CORRIDOR_M && Math.abs(wrap(ego.psi - rp.heading)) < AUDIT_ROUTE_HEADING_RAD
      ? rp.s + FRONT
      : null;
  const look =
    routeFront === null
      ? null
      : world.route.controls.find(
          (c) =>
            // (a give-way approach or a stop sign; an uncontrolled junction the car's street has priority at, kept
            // on a route for a left turn's oncoming traffic, is no line to hold)
            ((c.control.type === "uncontrolled" && c.control.rule !== "major") || c.control.type === "stop") &&
            routeFront <= c.sPeek + AUDIT_EV_OVERSHOOT_M,
        ) || null;
  const toLook = look ? look.sRoute - routeFront : Infinity,
    toPeek = look ? look.sPeek - routeFront : -Infinity;
  const inLook =
    toLook <= AUDIT_EV_LINE_M &&
    toPeek >= -AUDIT_EV_OVERSHOOT_M &&
    (toLook >= -AUDIT_EV_OVERSHOOT_M || toPeek <= AUDIT_EV_LOOK_M);
  // An existing queue can leave less steering room than a control line. Measure
  // real bodies here, including a bus standing at an angle, independently of the plan.
  const queued =
    Math.abs(ego.v) < 0.3
      ? world.npcs.find((n) => {
          if (isEmergency(n) || Math.abs(n.v) >= 1 || !n.obb) return false;
          const box = n.obb(),
            p = ego.toLocal(...box.center),
            angle = box.heading - ego.psi;
          const along = Math.abs(Math.cos(angle)) * box.halfLength + Math.abs(Math.sin(angle)) * box.halfWidth;
          const side = Math.abs(Math.sin(angle)) * box.halfLength + Math.abs(Math.cos(angle)) * box.halfWidth;
          return (
            p.ahead > FRONT &&
            p.ahead - along - FRONT <= FOLLOWING_STANDSTILL_M + AUDIT_EV_LINE_M &&
            Math.abs(p.right) < side + ego.spec.width / 2
          );
        }) || heldInQueue(world, FRONT)
      : null;
  for (const ev of evs) {
    const call = emergencyCall(ego, ev);
    let rec = world.evCalls.get(ev.id);
    if (!call) {
      if (rec) world.evCalls.delete(ev.id);
      continue;
    }
    if (!rec) {
      // Already stopped at a control line when the siren reached it: there is no room to steer
      // sideways without entering the junction. Holding that stop as the vehicle passes is
      // yielding too. Capture this at the call, so stopping here later cannot excuse a missed
      // opportunity to pull over. Moving on ends the exception; blocking the vehicle is still
      // judged independently below.
      // (a little over the line, as a short stop overshoots, is stopped at it too: as below, once it stops)
      const atLine =
        (control?.type === "stop" || control?.type === "signal") &&
        Math.abs(ego.v) < 0.3 &&
        toLine >= -AUDIT_EV_OVERSHOOT_M &&
        toLine <= AUDIT_EV_LINE_M;
      // (or between a give-way or stop line and where it looks from)
      const atLook = !atLine && Math.abs(ego.v) < 0.3 && inLook;
      const v = Math.max(0, ego.v);
      // A crawl already running out of steering room before a control can finish
      // that stop. Judge the opportunity at the call, not from its later choice.
      // (and one already a little over its line, still able to stop within that overshoot)
      const stopping = v * ego.spec.accelLag + (v * v) / (2 * AUDIT_EV_DECEL);
      const approachingLine =
        !atLine &&
        (control?.type === "stop" || control?.type === "signal") &&
        v <= AUDIT_EV_MOVING_MPS &&
        toLine + AUDIT_EV_OVERSHOOT_M >= (v * v) / (2 * comfort().hardDecel) &&
        toLine <= stopping + AUDIT_EV_LINE_M;
      // (and a crawl that stops there, short of where it looks from, whether or not it could also have stopped
      // at the line: a crawl just over it stops between the two)
      const approachingLook =
        !atLine &&
        !atLook &&
        look &&
        // (from the line or already near where it looks from: not a crawl mid-block, past a stop sign set back
        // from its junction, with room to pull over)
        (inLook || toLook >= -AUDIT_EV_OVERSHOOT_M) &&
        v <= AUDIT_EV_MOVING_MPS &&
        toPeek + AUDIT_EV_OVERSHOOT_M >= (v * v) / (2 * comfort().hardDecel) &&
        toLook <= stopping + AUDIT_EV_LINE_M;
      // A car crawling up to a queue can finish stopping when the siren arrives.
      const hold = !queued && v <= AUDIT_EV_MOVING_MPS ? queueHold(world, FRONT) : null;
      const approachingQueue =
        hold && hold.distance >= (v * v) / (2 * comfort().hardDecel) && hold.distance <= stopping + AUDIT_EV_LINE_M
          ? hold.vehicle
          : null;
      world.evCalls.set(
        ev.id,
        (rec = {
          since: world.t,
          v0: v,
          lead: false,
          ahead: null,
          ...(atLine ? { stoppedAtLine: [ego.x, ego.y], ...(toLine < 0 ? { lineOvershoot: true } : {}) } : {}),
          ...(atLook ? { stoppedAtLine: [ego.x, ego.y], lookAt: look.control.id } : {}),
          ...(queued ? { stoppedInQueue: { id: queued.id, at: [ego.x, ego.y] } } : {}),
          ...(approachingLine
            ? {
                lineApproach: {
                  edge: road.edge.id,
                  control: control.id,
                  until: world.t + AUDIT_EV_REACT_S + v / AUDIT_EV_DECEL,
                },
              }
            : {}),
          ...(approachingLook
            ? { lookApproach: { control: look.control.id, until: world.t + AUDIT_EV_REACT_S + v / AUDIT_EV_DECEL } }
            : {}),
          ...(approachingQueue
            ? { queueApproach: { id: approachingQueue.id, until: world.t + AUDIT_EV_REACT_S + v / AUDIT_EV_DECEL } }
            : {}),
        }),
      );
    }
    if (rec.queueApproach) {
      if (world.t > rec.queueApproach.until) delete rec.queueApproach;
      else if (queued?.id === rec.queueApproach.id) {
        rec.stoppedInQueue = { id: queued.id, at: [ego.x, ego.y] };
        delete rec.queueApproach;
      }
    }
    if (rec.lineApproach) {
      if (
        world.t > rec.lineApproach.until ||
        road.edge?.id !== rec.lineApproach.edge ||
        control?.id !== rec.lineApproach.control
      )
        delete rec.lineApproach;
      else if (Math.abs(ego.v) < 0.3 && toLine >= -AUDIT_EV_OVERSHOOT_M && toLine <= AUDIT_EV_LINE_M) {
        rec.stoppedAtLine = [ego.x, ego.y];
        rec.lineOvershoot = true;
        delete rec.lineApproach;
      }
    }
    if (rec.lookApproach) {
      if (world.t > rec.lookApproach.until) delete rec.lookApproach;
      else if (Math.abs(ego.v) < 0.3 && inLook && look.control.id === rec.lookApproach.control) {
        rec.stoppedAtLine = [ego.x, ego.y];
        rec.lookAt = look.control.id;
        delete rec.lookApproach;
      }
    }
    if (
      rec.stoppedAtLine &&
      ((rec.lookAt
        ? !inLook || look.control.id !== rec.lookAt
        : toLine < (rec.lineOvershoot ? -AUDIT_EV_OVERSHOOT_M : 0) || toLine > AUDIT_EV_LINE_M) ||
        Math.hypot(ego.x - rec.stoppedAtLine[0], ego.y - rec.stoppedAtLine[1]) > AUDIT_EV_LINE_M)
    ) {
      delete rec.stoppedAtLine;
      delete rec.lookAt;
    }
    // (released from the queue, the car has as long to pull over as it had from the call)
    if (
      rec.stoppedInQueue &&
      (queued?.id !== rec.stoppedInQueue.id ||
        Math.hypot(ego.x - rec.stoppedInQueue.at[0], ego.y - rec.stoppedInQueue.at[1]) > AUDIT_EV_LINE_M)
    ) {
      rec.releasedFrom = rec.stoppedInQueue.at;
      delete rec.stoppedInQueue;
      rec.released = world.t;
    }
    // (but a queue that moves up a car's length or less and stops again within that time leaves it as
    // boxed in as before: stopped in it again, it is queued again)
    else if (
      !rec.stoppedInQueue &&
      queued &&
      rec.releasedFrom &&
      world.t - rec.released < AUDIT_EV_PULL_S &&
      Math.hypot(ego.x - rec.releasedFrom[0], ego.y - rec.releasedFrom[1]) <= ego.spec.length
    )
      rec.stoppedInQueue = { id: queued.id, at: [ego.x, ego.y] };
    // (where its middle is along the car, from the car's middle)
    const [cx, cy] = ev.center,
      local = ego.toLocal(cx, cy),
      ahead = local.ahead - (ego.spec.length / 2 - ego.spec.rearOverhang),
      before = rec.ahead;
    rec.ahead = ahead;
    // The instruction to drive on is latched while the car is as far over as
    // it can get, including a captured line stop or queue that prevents steering farther.
    const blockedInQueue = queued && ev.blockedBy?.includes(queued);
    const holdingLine = rec.stoppedAtLine && Math.abs(ego.v) < 0.3;
    const holdingQueue = rec.stoppedInQueue && queued && Math.abs(ego.v) < 0.3;
    const lead = emergencyLead(world, ev, pulled || blockedInQueue || holdingLine);
    if (world.evCounted.has(ev.id)) continue;
    const after = world.t - rec.since;
    const late =
      !lead &&
      after > AUDIT_EV_REACT_S &&
      ego.v > Math.max(AUDIT_EV_MOVING_MPS, rec.v0 - AUDIT_EV_DECEL * (after - AUDIT_EV_REACT_S));
    const crossing = call.relation === "left" || call.relation === "right";
    const level =
      !crossing && before !== null && Math.sign(before) !== Math.sign(ahead) && Math.abs(local.right) < AUDIT_EV_SIDE_M;
    const unmoved =
      level &&
      after >= AUDIT_EV_PULL_S &&
      !(world.t - rec.released < AUDIT_EV_PULL_S) &&
      !pulled &&
      !lead &&
      !holdingLine &&
      !holdingQueue &&
      junction === null;
    // A second blocker directly in front of the car prevents it from driving on
    // when asked. Holding that safe stop is not the cause of this gridlock.
    // (nor is still standing in the queue it was in at the call, with the queue still in front of it: it
    // can neither pull over nor drive on, whether or not the vehicle has found a way past the queue's
    // front, as one coming the other way did on West 5th Avenue in Kitsilano snow s1-9)
    // Turning changes the relative bearing of a siren behind the car. An authorized lead
    // remains a drive-on instruction, not a new crossing call as the car clears the junction.
    if (
      late ||
      unmoved ||
      (!lead && entered && crossing && after >= AUDIT_EV_JUNCTION_S) ||
      (holdsUp(ev, ego, AUDIT_EV_BLOCK_S) && !pulled && !lead && !blockedInQueue && !holdingQueue)
    ) {
      world.evCounted.add(ev.id);
      world.violations.failed_to_yield++;
      world.events.push({ type: "failed_to_yield", to: "emergency vehicle", with: ev.id });
    }
  }
}

// Within a stopping queue even when the vehicle ahead needs extra room behind it.
export function heldInQueue(world, front) {
  const hold = queueHold(world, front);
  return hold && hold.distance <= AUDIT_EV_LINE_M ? hold.vehicle : null;
}

export function queueHold(world, front) {
  for (const hold of EV_QUEUE_HOLD) {
    const result = hold(world, front);
    if (result) return result;
  }
  return null;
}
