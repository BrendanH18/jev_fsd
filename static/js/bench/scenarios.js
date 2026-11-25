// A reproducible scenario suite: seeded start points and destinations on the loaded map, routed by
// the server. The same map, seed, and count always give the same suite, and each scenario carries
// its own traffic seed so reruns see the same traffic. With `restrictions` (the `city` world: bench/runner.js)
// routes keep to the map's turn restrictions at the city clock's time, as the app plans them.

import { api, rng } from "../common.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { Route } from "../map/route.js";

const MIN_ROUTE_M = 350,
  MAX_ROUTE_M = 1400;

export async function buildSuite(map, { count = 12, seed = 1, restrictions = null, signal, onRoute } = {}) {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(count * 60))
    throw new Error("Suite count must be a positive integer with a safe search limit.");
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("Suite seed must be a nonnegative integer.");
  if (
    restrictions &&
    (!Number.isFinite(restrictions.hour) ||
      restrictions.hour < 0 ||
      restrictions.hour >= 24 ||
      !Number.isInteger(restrictions.weekday) ||
      restrictions.weekday < 0 ||
      restrictions.weekday > 6)
  )
    throw new Error("Route restrictions require an hour from 0 to under 24 and a weekday from 0 to 6.");
  const random = rng(seed * 7919 + 17);
  const lanes = map.laneList.filter((l) => l.length > 40 && !l.edgeRef.control);
  const allLanes = map.laneList.filter((l) => l.length > 40);
  const [x0, y0, x1, y1] = map.extent;
  const inset = (x, y) => x > x0 + 60 && x < x1 - 60 && y > y0 + 60 && y < y1 - 60;
  const suite = [];
  const attempts = Math.max(120, count * 60);
  for (let attempt = 0; suite.length < count && attempt < attempts && !signal?.aborted; attempt++) {
    // Keep the original seeded attempts first. Signal-heavy city centres may have almost no
    // uncontrolled interior streets, so use all drivable lanes when those attempts fall short.
    const pool = attempt < count * 12 && lanes.length ? lanes : allLanes;
    if (!pool.length) break;
    const lane = pool[Math.floor(random() * pool.length)];
    const s = lane.length * (0.3 + random() * 0.4);
    const p = pointAt(lane.pts, lane.cum, s),
      psi = headingAt(lane.pts, lane.cum, s);
    const angle = random() * Math.PI * 2,
      reach = 350 + random() * 450;
    const goal = [p[0] + Math.cos(angle) * reach, p[1] + Math.sin(angle) * reach];
    if (!inset(p[0], p[1]) || !inset(goal[0], goal[1])) continue;
    let res;
    try {
      res = await api(
        "/api/route",
        {
          bbox: map.routingBbox.join(","),
          from: { x: p[0], y: p[1], heading: psi },
          to: { x: goal[0], y: goal[1] },
          k: 1,
          ...(restrictions ? { restrictions: true, hour: restrictions.hour, weekday: restrictions.weekday } : {}),
        },
        { signal },
      );
    } catch (error) {
      if (signal?.aborted) break;
      throw new Error(`Could not build suite seed ${seed} (attempt ${attempt + 1}): ${error.message}`, {
        cause: error,
      });
    }
    if (signal?.aborted) break;
    if (!Array.isArray(res?.routes))
      throw new Error(`Invalid route response for suite seed ${seed} (attempt ${attempt + 1}): expected routes.`);
    const data = res.routes[0];
    if (!data) continue;
    const route = new Route(data, map);
    if (!Number.isFinite(route.length)) throw new Error(`Invalid route length for suite seed ${seed}.`);
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
      tags: {
        length_m: Math.round(route.length),
        signals,
        stops,
        lefts: turns.filter((t) => t.dir === "left").length,
        rights: turns.filter((t) => t.dir === "right").length,
      },
    });
    onRoute?.({ id: suite.at(-1).id, ready: suite.length, count, attempt: attempt + 1, attempts });
  }
  return suite;
}
