// Browser routing for the public demo. Uses the same directed lane graph and turn geometry.
import { joinLanes, pointAt, headingAt, cumulative, projectPoint } from "../map/mapdata.js";

function sliceLane(lane, start, end) {
  return [pointAt(lane.pts, lane.cum, start), ...lane.pts.filter((_, i) => lane.cum[i] > start && lane.cum[i] < end), pointAt(lane.pts, lane.cum, end)];
}

export function routeFromLanes(map, chain, startS = 0, goalS = null) {
  let polyline = [], travelled = 0;
  const turns = [];
  for (let i = 0; i < chain.length; i++) {
    const lane = chain[i], edge = lane.edgeRef;
    const end = i === chain.length - 1 && goalS != null ? goalS : lane.length;
    if (i) {
      const previous = chain[i - 1];
      const dir = map.classifyTurn(map.turnAngle(previous.edge, lane.edge));
      if (dir !== "straight") turns.push({ dir, at_m: travelled, street: edge.name || "", exit: null });
    }
    polyline = joinLanes(polyline, sliceLane(lane, i ? 0 : startS, end));
    travelled = cumulative(polyline).at(-1);
  }
  // Resample to metre spacing, as on the local server.
  const cum = cumulative(polyline), length = cum.at(-1), pts = [];
  for (let s = 0; s < length; s += 1) pts.push(pointAt(polyline, cum, s));
  pts.push(polyline.at(-1));
  return { id: "browser-route", polyline: pts, edges: chain.map(l => l.edge), turns, start_s: startS,
    goal_s: goalS ?? chain.at(-1).length, summary: `${Math.round(length)} m · ${turns.length} turns` };
}

export function browserRoute(map, from, to) {
  const start = map.nearestLane(from.x, from.y, from.heading ?? null, 100);
  const goal = map.nearestLane(to.x, to.y, null, 150);
  if (!start || !goal) return null;
  if (start.lane.edge === goal.lane.edge && goal.s > start.s + 2) return routeFromLanes(map, [start.lane], start.s, goal.s);
  const distances = new Map([[start.lane.edge, 0]]), parents = new Map(), pending = new Set([start.lane.edge]);
  let found = false;
  while (pending.size) {
    let current = null;
    for (const id of pending) if (current === null || distances.get(id) < distances.get(current)) current = id;
    pending.delete(current);
    if (current === goal.lane.edge && current !== start.lane.edge) { found = true; break; }
    for (const next of map.successors(current)) {
      const turn = Math.abs(map.turnAngle(current, next));
      if (turn > 130 * Math.PI / 180) continue;
      const edge = map.edges.get(next);
      const cost = distances.get(current) + edge.length + turn * 8;
      if (cost < (distances.get(next) ?? Infinity)) { distances.set(next, cost); parents.set(next, current); pending.add(next); }
    }
  }
  if (!found) return null;
  const ids = [goal.lane.edge];
  while (ids[0] !== start.lane.edge) { ids.unshift(parents.get(ids[0])); if (ids.length > map.edges.size) return null; }
  const chain = [start.lane];
  for (const id of ids.slice(1)) {
    const dir = map.classifyTurn(map.turnAngle(chain.at(-1).edge, id)), e = map.edges.get(id);
    chain.push(map.lane(id, dir === "left" ? 0 : dir === "right" ? e.lanes - 1 : Math.min(chain.at(-1).idx, e.lanes - 1)));
  }
  const final = projectPoint(chain.at(-1).pts, chain.at(-1).cum, [to.x, to.y]);
  return routeFromLanes(map, chain, start.s, final.s);
}

export function browserDrives(map, from) {
  const candidates = [], cells = new Set();
  for (const lane of map.laneList) {
    if (lane.length < 35) continue;
    const p = pointAt(lane.pts, lane.cum, lane.length * 0.55), distance = Math.hypot(p[0] - from.x, p[1] - from.y);
    const cell = `${Math.floor(p[0] / 150)},${Math.floor(p[1] / 150)}`;
    if (distance < 180 || distance > 1300 || cells.has(cell)) continue;
    cells.add(cell);
    const route = browserRoute(map, from, { x: p[0], y: p[1] });
    if (!route) continue;
    const length = cumulative(route.polyline).at(-1);
    if (length > 250 && length < 1900) {
      const controls = route.edges.map(id => map.edges.get(id).control);
      candidates.push({ route, destination: route.polyline.at(-1), length_m: Math.round(length), turns: route.turns.length,
        signals: controls.filter(c => c?.type === "signal").length, stops: controls.filter(c => c?.type === "stop").length });
    }
    if (cells.size >= 32) break;
  }
  const presets = [["neighbourhood", "Neighbourhood cruise", 500, "Easy"], ["junctions", "City precision", 850, "Focused"], ["tour", "The long way home", 1300, "Extended"]];
  return presets.flatMap(([id, title, target, difficulty]) => {
    candidates.sort((a, b) => Math.abs(a.length_m - target) - Math.abs(b.length_m - target));
    const pick = candidates.shift();
    if (!pick) return [];
    for (let i = candidates.length - 1; i >= 0; i--) if (Math.hypot(...candidates[i].destination.map((n, j) => n - pick.destination[j])) < 100) candidates.splice(i, 1);
    return [{ id, title, difficulty, description: "Real streets. Smooth inputs. Room for everyone.", ...pick }];
  });
}
