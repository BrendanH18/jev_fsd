// No left turn: the first signed, unconditional no-left-turn restriction on the map (sim/turn-
// restrictions.js) whose direct route takes the banned turn; the route is the legal detour.
import { browserRoute } from "../../demo/routing.js";
import { cumulative, pointAt, headingAt } from "../../map/mapdata.js";

export const challenge = {
  id: "no-left-turn",
  title: "No left turn",
  map: "toronto",
  weather: "dry",
  time: "morning",
  seed: 37042,
  icon: "↰",
  difficulty: "Navigation",
  hazard: "turn-restriction",
  restrictions: true,
  street: "Bathurst Street",
  description: "A signed left turn is prohibited. Take a legal route around the block.",
  lesson:
    "Follow the signed turn restriction while it applies. Take the legal detour even when the prohibited turn would be shorter; never turn across the sign just to follow a destination.",
};

export function scenario(map, challenge) {
  for (const r of map.restrictions.filter((r) => r.kind === "no_left_turn" && !r.condition)) {
    const e = map.edges.get(r.from),
      out = map.edges.get(r.to[0]);
    const lane = map.lane(e.id, 0),
      goalLane = map.lane(out.id, 0);
    if (lane.length < 50 || goalLane.length < 25) continue;
    const s = Math.max(5, lane.length - 65),
      p = pointAt(lane.pts, lane.cum, s),
      goal = pointAt(goalLane.pts, goalLane.cum, Math.min(40, goalLane.length - 5));
    const from = { x: p[0], y: p[1], heading: headingAt(lane.pts, lane.cum, s) },
      to = { x: goal[0], y: goal[1] };
    const direct = browserRoute(map, from, to),
      route = browserRoute(map, from, to, { restrictions: true, hour: 9 });
    if (!route || !direct?.edges.some((id, i) => id === r.from && direct.edges[i + 1] === r.to[0])) continue;
    return {
      id: challenge.id,
      start: { edge: lane.edge, lane: lane.idx, s },
      route,
      goal,
      traffic_seed: challenge.seed,
      tags: {
        length_m: Math.round(cumulative(route.polyline).at(-1)),
        signals: route.edges.filter((id) => map.edges.get(id).control?.type === "signal").length,
        stops: route.edges.filter((id) => map.edges.get(id).control?.type === "stop").length,
        lefts: route.turns.filter((t) => t.dir === "left").length,
        rights: route.turns.filter((t) => t.dir === "right").length,
      },
      restriction: r.id,
      street: e.name,
    };
  }
  throw new Error("No real prohibited left turn with a legal detour on this map");
}
