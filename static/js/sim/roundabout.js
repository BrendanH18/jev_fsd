// Roundabouts: who has the right of way at an entry. Traffic already in the ring goes first, so a
// driver at the yield line waits while a circulating vehicle would reach the entry within a few
// seconds, or is passing it now.

const YIELD_HORIZON_S = 3.5;   // a gap shorter than this is not taken
const PASSING_M = 3.5;         // a vehicle this close to the entry along the ring blocks it

// True when a vehicle circulating in roundabout `rb` blocks entering at the ring vertex `node`.
// `extra` seconds widen the window for a driver still approaching the line, who will get there
// later and must know now whether to slow down.
export function ringBusy(rb, node, vehicles, self = null, extra = 0) {
  if (!rb || !node) return false;
  const dir = rb.ccw === false ? -1 : 1;
  const entry = Math.atan2(node.y - rb.y, node.x - rb.x);
  for (const o of vehicles) {
    if (o === self) continue;
    const d = Math.hypot(o.x - rb.x, o.y - rb.y);
    if (d > rb.outer_r + 1 || d < rb.island_r - 0.5) continue;
    // arc length along the ring from the vehicle forward to the entry
    const theta = Math.atan2(o.y - rb.y, o.x - rb.x);
    let ahead = dir * (entry - theta);
    ahead = ((ahead % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const arc = ahead * rb.lane_r;
    const behind = (2 * Math.PI - ahead) * rb.lane_r;
    if (arc < PASSING_M || behind < PASSING_M) return true;
    if (arc / Math.max(1, Math.abs(o.v)) < YIELD_HORIZON_S + extra) return true;
  }
  return false;
}

// A vehicle on its way into the ring at another entry, which will be in it before the car is: not yet
// in the ring, moving, heading for it (within 60 deg of its centre: entries meet a large ring at an
// angle) within JOIN_LOOK_M of its edge, not braking to stop short of it, and due at the entry at
// `node` (into the ring, then round it) within the same window as `ringBusy`. Two vehicles that reach the ring together meet in it, so the car still short of its line
// gives way to such a vehicle as to one already circulating. The driven car's sensing only: traffic and
// the audit go by `ringBusy` alone.
const JOIN_LOOK_M = 15;
export function ringJoining(rb, node, vehicles, extra = 0) {
  if (!rb || !node) return false;
  const dir = rb.ccw === false ? -1 : 1;
  const entry = Math.atan2(node.y - rb.y, node.x - rb.x);
  for (const o of vehicles) {
    if (o.v < 0.5) continue;
    const dx = rb.x - o.x, dy = rb.y - o.y, d = Math.hypot(dx, dy), out = d - rb.outer_r;
    if (out <= 1 || out > JOIN_LOOK_M) continue;
    if ((dx * Math.cos(o.psi) + dy * Math.sin(o.psi)) / d < 0.5) continue;
    // (brake lights: stopping at its own line)
    if (o.a < -0.5 && o.v * o.v / (-2 * o.a) < out) continue;
    // the arc from its entry round to this one (one coming in at this entry is queueing, not joining)
    let ahead = dir * (entry - Math.atan2(-dy, -dx));
    ahead = ((ahead % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const arc = ahead * rb.lane_r;
    if (arc < PASSING_M || (2 * Math.PI - ahead) * rb.lane_r < PASSING_M) continue;
    if ((out + arc) / o.v < YIELD_HORIZON_S + extra) return true;
  }
  return false;
}
