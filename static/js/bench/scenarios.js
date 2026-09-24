// A reproducible scenario suite: seeded start points and destinations on the loaded map, routed by
// the server. The same map, seed, and count always give the same suite, and each scenario carries
// its own traffic seed so reruns see the same traffic.

import { api, rng } from "../common.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { Route } from "../map/route.js";

const MIN_ROUTE_M = 350, MAX_ROUTE_M = 1400;

export async function buildSuite(map, { count = 12, seed = 1 } = {}) {
  const random = rng(seed * 7919 + 17);
  const lanes = map.laneList.filter((l) => l.length > 40 && !l.edgeRef.control);
  const [x0, y0, x1, y1] = map.extent;
  const inset = (x, y) => x > x0 + 60 && x < x1 - 60 && y > y0 + 60 && y < y1 - 60;
  const suite = [];
  for (let attempt = 0; suite.length < count && attempt < count * 12; attempt++) {
    const lane = lanes[Math.floor(random() * lanes.length)];
    const s = lane.length * (0.3 + random() * 0.4);
    const p = pointAt(lane.pts, lane.cum, s), psi = headingAt(lane.pts, lane.cum, s);
    const angle = random() * Math.PI * 2, reach = 350 + random() * 450;
    const goal = [p[0] + Math.cos(angle) * reach, p[1] + Math.sin(angle) * reach];
    if (!inset(p[0], p[1]) || !inset(goal[0], goal[1])) continue;
    let res;
    try { res = await api("/api/route", { from: { x: p[0], y: p[1], heading: psi }, to: { x: goal[0], y: goal[1] }, k: 1 }); } catch { continue; }
    const data = res.routes && res.routes[0];
    if (!data) continue;
    const route = new Route(data, map);
    if (route.length < MIN_ROUTE_M || route.length > MAX_ROUTE_M) continue;
    const signals = route.controls.filter((c) => c.control.type === "signal").length;
    const stops = route.controls.filter((c) => c.control.type === "stop").length;
    const turns = route.turns.filter((t) => t.dir === "left" || t.dir === "right");
    suite.push({
      id: `s${seed}-${suite.length + 1}`,
      start: { edge: lane.edge, lane: lane.idx, s, x: p[0], y: p[1], psi },
      goal: route.endPoint(),
      route: data,
      traffic_seed: Math.floor(random() * 1e6),
      tags: { length_m: Math.round(route.length), signals, stops, lefts: turns.filter((t) => t.dir === "left").length, rights: turns.filter((t) => t.dir === "right").length },
    });
  }
  return suite;
}
