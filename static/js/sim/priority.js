// Right of way at a junction without a signal: a two-way stop, or streets meeting with no sign at
// all (MapData.priorityOf). Each street leading into the junction holds the right of way at a level:
// a stop sign is the lowest; a street without one ranks by its class (primary and secondary, then
// tertiary, then the rest). Between two streets that cross, the higher level goes first; at the
// same level, the one on the right (as at an uncontrolled junction in Canada).
// Traffic from the same direction queues, and from the opposite direction meets only a left turn,
// which yields to oncoming traffic separately.
//
// Traffic, the driven car's sensing and the audit all use these rules.

import { CAR } from "./vehicle.js";
import { roadRank } from "../map/mapdata.js";
import { wrap } from "./world.js";

// Where a car giving way looks from when a building hides the street it gives way to: its front
// bumper this far short of the crossing road's asphalt. Stopped within PEEK_AT_M of that point, it
// has looked (World.egoPeek remembers it until the car leaves for the next junction).
export const PEEK_SHORT_M = 0.3;
export const PEEK_AT_M = 1.0;
const LOOK_AHEAD_M = 120;   // a vehicle's path is searched this far ahead for the junction

// The level of the street `edgeId` leads in on, or null where it has a signal, a roundabout's
// yield line or no junction at its end.
export function levelOf(map, edgeId) {
  const e = map.edges.get(edgeId);
  if (!e) return null;
  if (e.control) return e.control.type === "stop" ? 0 : null;
  return map.priorityOf(edgeId) ? roadRank(e) : null;
}

// Whether traffic coming in on edge `b` has the right of way over traffic on edge `a`, both leading
// into the same junction from directions that cross.
export function outranks(map, b, a) {
  if (a === b) return false;
  const rel = wrap(map.headingIn(b) - map.headingIn(a));
  if (Math.abs(rel) < Math.PI / 6 || Math.abs(rel) > Math.PI * 5 / 6) return false;
  const la = levelOf(map, a), lb = levelOf(map, b);
  if (la === null || lb === null) return false;
  return lb > la || (lb === la && rel > 0);
}

// The edge a vehicle comes into junction node `node` on, and how far its front bumper is from the
// junction's node along it: from its planned path (a traffic car's, unless `usePath` is false: the
// driven car sees only where a vehicle is), else from the lane it is in. Null when it is not heading
// there (it may already be inside the junction).
export function approachTo(map, v, node, usePath = true) {
  const spec = v.spec || CAR, front = spec.length - spec.rearOverhang;
  const path = usePath && v.path?.edges ? v.path : null;
  if (path) {
    for (const e of path.edges) {
      if (e.sEnd < path.s + front) continue;
      if (e.sStart > path.s + LOOK_AHEAD_M) break;
      if (e.to === node) return { edge: e.id, to_node_m: e.sEnd - path.s - front };
    }
    return null;
  }
  const near = map.nearestLane(v.x, v.y, v.psi, 6);
  if (!near || near.lane.edgeRef.to !== node) return null;
  return { edge: near.lane.edge, to_node_m: near.lane.length - near.s - front };
}
