import { turnBanned } from "../sim/turn-restrictions.js";
// Browser routing for the public demo. Uses the same directed lane graph and turn geometry.
import { joinLanes, pointAt, cumulative, projectPoint } from "../map/mapdata.js";

const SHARP_TURN = (130 * Math.PI) / 180;

function requirePose(pose, field) {
  if (!pose || typeof pose !== "object" || Array.isArray(pose)) throw new TypeError(`${field} must be a pose object`);
  for (const axis of ["x", "y"]) {
    if (!Number.isFinite(pose[axis])) throw new TypeError(`${field}.${axis} must be a finite number`);
  }
  if (field === "from" && pose.heading != null && !Number.isFinite(pose.heading))
    throw new TypeError("from.heading must be a finite number");
}

function routeOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("Route options must be an object");
  const { restrictions = false, hour = 15.5, weekday = 0, avoid = null } = options;
  if (typeof restrictions !== "boolean") throw new TypeError("restrictions must be a boolean");
  if (!Number.isFinite(hour)) throw new TypeError("hour must be a finite number");
  if (!Number.isInteger(weekday)) throw new TypeError("weekday must be an integer");
  if (avoid != null && (!Array.isArray(avoid) || !Array.from(avoid).every((id) => typeof id === "string")))
    throw new TypeError("avoid must be a list of edge ids");
  return { restrictions, hour, weekday, closed: avoid?.length ? new Set(avoid) : null };
}

function sliceLane(lane, start, end) {
  return [
    pointAt(lane.pts, lane.cum, start),
    ...lane.pts.filter((_, i) => lane.cum[i] > start && lane.cum[i] < end),
    pointAt(lane.pts, lane.cum, end),
  ];
}

export function routeFromLanes(map, chain, startS = 0, goalS = null) {
  if (!Array.isArray(chain) || !chain.length) throw new RangeError("A route requires at least one lane");
  if (!Number.isFinite(startS)) throw new TypeError("Route start distance must be a finite number");
  if (goalS != null && !Number.isFinite(goalS)) throw new TypeError("Route goal distance must be a finite number");
  let polyline = [];
  const turns = [];
  for (let i = 0; i < chain.length; i++) {
    const lane = chain[i];
    if (!lane) throw new TypeError(`Route lane ${i} is missing`);
    if (!lane.pts?.length) throw new TypeError(`Route lane ${i} requires geometry`);
    if (lane.cum?.length !== lane.pts.length) throw new TypeError(`Route lane ${i} requires matching arc lengths`);
    if (!Number.isFinite(lane.length)) throw new TypeError(`Route lane ${i} requires a finite length`);
    const edge = lane.edgeRef;
    if (!edge) throw new TypeError(`Route lane ${i} requires an edge`);
    const end = i === chain.length - 1 && goalS != null ? goalS : lane.length;
    if (i) {
      const previous = chain[i - 1];
      const dir = map.classifyTurn(map.turnAngle(previous.edge, lane.edge));
      if (dir !== "straight")
        turns.push({ dir, at_m: cumulative(polyline).at(-1), street: edge.name || "", exit: null });
    }
    polyline = joinLanes(polyline, sliceLane(lane, i ? 0 : startS, end));
  }
  // Resample to metre spacing, as on the local server.
  const cum = cumulative(polyline),
    length = cum.at(-1),
    pts = [];
  if (!Number.isFinite(length) || length > Number.MAX_SAFE_INTEGER)
    throw new RangeError("Route geometry is too long to resample");
  for (let s = 0; s < length; s += 1) pts.push(pointAt(polyline, cum, s));
  pts.push(polyline.at(-1));
  return {
    id: "browser-route",
    polyline: pts,
    edges: chain.map((l) => l.edge),
    lanes: chain.map((l) => l.idx),
    turns,
    start_s: startS,
    goal_s: goalS ?? chain.at(-1).length,
    summary: `${Math.round(length)} m · ${turns.length} turns`,
  };
}

// `avoid`: edge ids no route may enter (a block closed for an event, sim/road-closures.js), as on the
// local server (jev/routing.py); empty or absent, the route is exactly as without it.
export function browserRoute(map, from, to, options = {}) {
  requirePose(from, "from");
  requirePose(to, "to");
  const { restrictions, hour, weekday, closed } = routeOptions(options);
  const start = map.nearestLane(from.x, from.y, from.heading ?? null, 100);
  if (!start) return null;
  const goal = map.nearestLane(to.x, to.y, null, 150);
  if (!goal) return null;
  if (closed?.has(goal.lane.edge)) return null;
  if (start.lane.edge === goal.lane.edge && goal.s > start.s + 2)
    return routeFromLanes(map, [start.lane], start.s, goal.s);
  const distances = new Map([[start.lane.edge, 0]]),
    parents = new Map(),
    pending = new Set([start.lane.edge]);
  let found = false;
  while (pending.size) {
    let current = null;
    for (const id of pending) if (current === null || distances.get(id) < distances.get(current)) current = id;
    pending.delete(current);
    if (current === goal.lane.edge && current !== start.lane.edge) {
      found = true;
      break;
    }
    for (const next of map.successors(current)) {
      if (restrictions && turnBanned(map, current, next, { hour, weekday })) continue;
      if (closed?.has(next)) continue;
      const turn = Math.abs(map.turnAngle(current, next));
      if (turn > SHARP_TURN) continue;
      const edge = map.edges.get(next);
      const cost = distances.get(current) + edge.length + turn * 8;
      if (cost < (distances.get(next) ?? Infinity)) {
        distances.set(next, cost);
        parents.set(next, current);
        pending.add(next);
      }
    }
  }
  if (!found) return null;
  const ids = [goal.lane.edge];
  while (ids.at(-1) !== start.lane.edge) {
    const parent = parents.get(ids.at(-1));
    if (parent == null || ids.length >= map.edges.size) return null;
    ids.push(parent);
  }
  ids.reverse();
  // Each edge's lane as the server router picks it (jev/routing.py `_lane_index`): the leftmost
  // before a left turn, otherwise the rightmost. The car then gets into a turn lane ahead of time.
  const chain = ids.map((id, i) => {
    const lanes = map.edges.get(id).lanes;
    const left = i + 1 < ids.length && map.classifyTurn(map.turnAngle(id, ids[i + 1])) === "left";
    return map.lane(id, lanes <= 1 || left ? 0 : lanes - 1);
  });
  if (chain.some((lane) => !lane)) return null;
  // the start is measured along the lane the route takes, which on a curve differs in length from
  // the one the car snapped to
  const first = chain[0] === start.lane ? start.s : projectPoint(chain[0].pts, chain[0].cum, [from.x, from.y]).s;
  const final = projectPoint(chain.at(-1).pts, chain.at(-1).cum, [to.x, to.y]);
  return routeFromLanes(map, chain, first, final.s);
}

export function browserDrives(map, from) {
  requirePose(from, "from");
  const candidates = [],
    cells = new Set();
  for (const lane of map.laneList) {
    if (lane.length < 35) continue;
    const p = pointAt(lane.pts, lane.cum, lane.length * 0.55),
      distance = Math.hypot(p[0] - from.x, p[1] - from.y);
    const cell = `${Math.floor(p[0] / 150)},${Math.floor(p[1] / 150)}`;
    if (distance < 180 || distance > 1300 || cells.has(cell)) continue;
    cells.add(cell);
    const route = browserRoute(map, from, { x: p[0], y: p[1] });
    if (!route) continue;
    const length = cumulative(route.polyline).at(-1);
    if (length > 250 && length < 1900) {
      const controls = route.edges.map((id) => map.edges.get(id).control);
      candidates.push({
        route,
        destination: route.polyline.at(-1),
        length_m: Math.round(length),
        turns: route.turns.length,
        signals: controls.filter((c) => c?.type === "signal").length,
        stops: controls.filter((c) => c?.type === "stop").length,
      });
    }
    if (cells.size >= 32) break;
  }
  const presets = [
    ["neighbourhood", "Neighbourhood cruise", 500, "Easy"],
    ["junctions", "City precision", 850, "Focused"],
    ["tour", "The long way home", 1300, "Extended"],
  ];
  return presets.flatMap(([id, title, target, difficulty]) => {
    candidates.sort((a, b) => Math.abs(a.length_m - target) - Math.abs(b.length_m - target));
    const pick = candidates.shift();
    if (!pick) return [];
    for (let i = candidates.length - 1; i >= 0; i--)
      if (Math.hypot(...candidates[i].destination.map((n, j) => n - pick.destination[j])) < 100)
        candidates.splice(i, 1);
    return [{ id, title, difficulty, description: "Real streets. Smooth inputs. Room for everyone.", ...pick }];
  });
}
