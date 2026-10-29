// Streetcars, and the rule that goes with them. A streetcar runs its route on its tracks, laid in a
// traffic lane (`map.transit`, routes with mode "tram", built by jev/osm/transit.py), and stops at its
// stops in that lane: its riders get on and off across the lane between it and the curb. So a driver
// coming up behind a streetcar that is stopped to take on or let off passengers must not pass it, or
// come nearer than 2 m behind its rear doors on the side they use, until they have got on or reached
// the side of the street (Ontario Highway Traffic Act s. 166(1)). Where a safety island stands
// between the tracks and the traffic lanes (s. 166(2)) traffic may pass; tracks there run in a right of
// way of their own, which the sim does not run streetcars on.
//
// In a free drive a streetcar drives its run of its route at up to 95% of the limit, and only along
// its track: it never changes lanes or pulls over. It stops with its front 1 m past each stop's pole
// (clear of the junctions either side, as a bus does, sim/bus.js busStopFront), opens its doors
// (DOORS_DELAY_S after stopping) and waits DWELL_S[0] to DWELL_S[1] s; meanwhile up to RIDERS_OFF
// riders get off by its doors and walk across to the curb, and up to RIDERS_ON waiting by the pole
// walk out to its doors and get on, each stepping into the street once nothing coming is too close
// to stop. Its doors close once the dwell is over and none of its riders is still in the street (by
// DWELL_MAX_S whatever happens), and it moves off DEPART_S later.
//
// Who must stop: a driver going its way (within 30 deg) whose path runs past the streetcar's right
// side, from its own lane to SIDE_M right of its centreline. The law's line is HOLD_M behind its rear
// doors (DOOR_M ahead of its rear); a driver in the lane beside it aims to stop STOP_M behind them,
// short of that line with room to spare, and one behind it in its lane STOP_M behind its rear. A driver owes the stop when, seeing the doors open (or seeing the streetcar already
// standing with them open), it can stop there braking at no more than OWED_DECEL; one that cannot,
// or is already beside the streetcar, carries on.

import { CAR, STREETCAR } from "./vehicle.js";

export const HOLD_M = 2;
export const STOP_M = 4;
export const DOOR_M = 2.9;           // its rear doors' rear edge, ahead of its rear bumper
export const SIDE_M = 6;
export const IN_LANE_M = 1.5;        // a driver this close to its centreline is in its lane
export const OWED_DECEL = 3.5;
export const DWELL_S = [12, 22];
export const DWELL_MAX_S = 60;
export const DOORS_DELAY_S = 1;
export const DEPART_S = 1.5;
export const RIDERS_OFF = [0, 3];
export const RIDERS_ON = [0, 3];
export const RIDER_EVERY_S = 1.5;
const LOOK_M = 90;
const SAME_WAY = Math.PI / 6;

export const isStreetcar = (v) => !!v && v.kind === "streetcar";
export const doorsOpen = (car) => isStreetcar(car) && !!car.transit?.doors;
// stopping at its stop, its doors not yet open
export const stoppingAt = (car) => isStreetcar(car) && car.transit?.phase === "in";
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Where a driver `right` metres right of a streetcar's centreline stops, as metres ahead of its rear:
// STOP_M behind its rear doors beside it, STOP_M behind its rear in its lane.
export const holdFromRear = (right) => Math.abs(right) < IN_LANE_M ? -STOP_M : DOOR_M - STOP_M;
const holdAhead = (car, right) => holdFromRear(right) - (car.spec || STREETCAR).rearOverhang;

// Where a driver whose path is the polyline `pts`/`cum`, its front `front` metres along, stops for
// streetcar `car` (whatever its doors): { beside (in the lane beside it, not its own), gap_m (front to
// its rear, along the path), stop_m (front to where it stops) }, or null when the next `look` metres
// of the path do not run past its right side going its way, or the driver's front has already reached
// its rear doors (its rear, in its lane). The first stretch of the path ahead that does counts.
export function streetcarHold(pts, cum, front, car, look = LOOK_M) {
  const cs = car.spec || STREETCAR, c = Math.cos(car.psi), s = Math.sin(car.psi);
  const from = front - cs.length;
  for (let i = 0; i < pts.length - 1 && cum[i] <= front + look; i++) {
    const len = cum[i + 1] - cum[i];
    if (cum[i + 1] < from || len <= 0) continue;
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(wrap(car.psi - Math.atan2(dy, dx))) > SAME_WAY) continue;
    // (how far right of the streetcar's centreline this stretch runs, at its rear)
    const rx = car.x - c * cs.rearOverhang, ry = car.y - s * cs.rearOverhang;
    const t = ((rx - a[0]) * dx + (ry - a[1]) * dy) / (len * len);
    if (t < 0 || t > 1) continue;
    const right = ((a[0] + dx * t - rx) * s - (a[1] + dy * t - ry) * c);
    if (right < -IN_LANE_M || right > SIDE_M) continue;
    const at = holdFromRear(right);
    const gap = cum[i] + t * len - front;
    // (`stop_m` goes below 0 just past where it stops: it stays stopped there)
    if (gap + at + STOP_M <= 0 || gap > look) return null;
    return { beside: Math.abs(right) >= IN_LANE_M, gap_m: gap, stop_m: gap + at };
  }
  return null;
}

// The same, for a driver `o` going straight on as it heads (sensing-free: the audit and the HUD):
// { beside, ahead_m (its front to where it stops), right_m (how far right of the streetcar's
// centreline it is) }, or null when it is not going the streetcar's way.
export function streetcarRelation(o, car) {
  if (o === car || Math.abs(wrap(car.psi - o.psi)) > SAME_WAY) return null;
  const cs = car.spec || STREETCAR, os = o.spec || CAR, l = car.toLocal(o.x, o.y);
  const right = l.right, front = l.ahead + os.length - os.rearOverhang;
  return { beside: Math.abs(right) >= IN_LANE_M, ahead_m: holdAhead(car, right) - front, right_m: right, behind_m: -cs.rearOverhang - front };
}

// Whether a driver at speed `v` can stop within `room` metres braking at no more than OWED_DECEL.
export const canStopFor = (v, room) => room >= Math.max(0, v) ** 2 / (2 * OWED_DECEL);

// Where a streetcar's doors are, as points beside it on the curb side (`side` metres right of its
// right flank): its four doors, front to rear.
export function doorPoints(car, side = 0.4) {
  const cs = car.spec || STREETCAR, c = Math.cos(car.psi), s = Math.sin(car.psi), right = cs.width / 2 + side;
  return [cs.length - 3.4, cs.length * 0.62, cs.length * 0.36, DOOR_M + 0.6].map((d) => {
    const ahead = d - cs.rearOverhang;
    return [car.x + c * ahead + s * right, car.y + s * ahead - c * right];
  });
}
