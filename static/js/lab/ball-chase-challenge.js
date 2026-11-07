// "Chasing the ball": a ball rolls out from between the cars parked along a residential street in
// Kitsilano (sim/ball-chase.js), and a child runs out after it from behind them (hidden hazards on: the
// parked cars hide the child, sim/hidden-hazards.js). The site: the first block, in the map's edge order,
// of the challenge's `street` (or any, where it has none) that is a straight, two-way residential street
// with one lane each way, a parking lane on the right, a limit of 40 km/h or more, no marked crosswalk,
// school or playground zone or speed hump, and room to park all along BALL_ROW_M either side of the
// gap's line (ballSites). Its right kerb is lined with cars BALL_GAP_M apart, the gap the ball comes out
// of in the middle, wider (BALL_OPEN_M); cars line the far kerb too. The car starts from a standstill in
// its lane, its front BALL_START_M short of the gap's line; the ball rolls out in plain view once the
// car's front is BALL_TRIGGER_M short of it, and the child follows CHILD_AFTER_S later, too late for a
// car still at the street's 50 km/h to stop, in time for one that slowed when it saw the ball. The route
// ends BALL_PAST_M past it.
import { routeFromLanes } from "../demo/routing.js";
import { cumulative, headingAt, pointAt } from "../map/mapdata.js";
import { Vehicle, CAR } from "../sim/vehicle.js";
import { curbOffset } from "../sim/roadside.js";
import { legalStretches, straight as straightKerb } from "../sim/parallel-park.js";
import { rng } from "../common.js";

export const BALL_START_M = 120, BALL_TRIGGER_M = 28, BALL_PAST_M = 40, CHILD_AFTER_S = 1.2;
export const BALL_ROW_M = [55, 30], BALL_GAP_M = 1.4, BALL_OPEN_M = 2.2;
const HIDE_IN_M = 0.6, FAR_ROW_M = [45, 35];

const siteCache = new WeakMap();
export function ballSites(map, street = null) {
  if (!siteCache.has(map)) {
    const sites = [], front = CAR.length - CAR.rearOverhang, crossed = new Set((map.crosswalks || []).map((c) => c.edge));
    for (const e of map.edges.values()) {
      if (e.cls !== "residential" || !e.parking?.[1] || e.ring || e.oneway || e.lanes !== 1 || (e.limit || 0) < 40 / 3.6 - 0.1 || crossed.has(e.id) || map.zoneSpans.get(e.id)?.length || map.calmingSpans?.get?.(e.id)?.length) continue;
      const at = BALL_START_M + front + 4, lo = at - BALL_ROW_M[0], hi = at + BALL_ROW_M[1];
      if (at + BALL_PAST_M > (e.control?.s_line ?? e.length) - 4) continue;
      if (!legalStretches(map, e).some(([a, b]) => a <= lo && b >= hi) || !straightKerb(e, lo - 2, hi + 2)) continue;
      sites.push({ edge: e.id, at, name: e.name });
    }
    siteCache.set(map, sites);
  }
  const sites = siteCache.get(map), on = sites.filter((s) => s.name === street);
  return on.length ? on : sites;
}

export function ballScenario(map, challenge) {
  const site = ballSites(map, challenge.street)[0];
  if (!site) throw new Error(`No residential street with room for the "Chasing the ball" challenge.`);
  const e = map.edges.get(site.edge), lane = map.lane(e.id, e.lanes - 1), k = lane.length / e.length;
  const front = CAR.length - CAR.rearOverhang;
  const s = (site.at - BALL_START_M - front) * k;
  const route = routeFromLanes(map, [lane], s, (site.at + BALL_PAST_M) * k);
  const p = pointAt(lane.pts, lane.cum, s);
  return { id: challenge.id, start: { edge: e.id, lane: lane.idx, s, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s) }, route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    ball: { edge: e.id, at: site.at },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 0, stops: 0, lefts: 0, rights: 0 } };
}

// The cars along both kerbs, staying put, and the ball waiting in the gap on the right (the world's own
// balls off).
export function placeBall(world, { edge, at }, seed) {
  const map = world.map, e = map.edges.get(edge), random = rng(seed), lat = curbOffset(e, CAR);
  const colors = [0x8d9299, 0x2b3a55, 0xeeeeea, 0x1a1c20, 0x6b7f5e, 0x9b1e1e, 0xc4c8cc];
  let n = 0;
  const park = (side, s, l) => {
    const p = pointAt(side.pts, side.cum, s), h = headingAt(side.pts, side.cum, s);
    const car = new Vehicle(p[0] + Math.sin(h) * l, p[1] - Math.cos(h) * l, h, 0);
    Object.assign(car, { id: `challenge_parked_${++n}`, color: colors[Math.floor(random() * colors.length)], style: n % 6, curb: "right", edge: side.id, stay: true });
    world.parked.add(car);
  };
  // (the right kerb: bumper to bumper either side of the gap the ball comes out of)
  const rears = [];
  for (let rear = at + BALL_OPEN_M / 2; rear + CAR.length <= at + BALL_ROW_M[1]; rear += CAR.length + BALL_GAP_M) rears.push(rear);
  for (let rear = at - BALL_OPEN_M / 2 - CAR.length; rear >= at - BALL_ROW_M[0]; rear -= CAR.length + BALL_GAP_M) rears.push(rear);
  for (const rear of rears.sort((x, y) => x - y)) park(e, rear + CAR.rearOverhang, lat);
  // (and the far kerb, its twin edge's right, where one may park)
  const twin = [...map.edges.values()].find((o) => o.from === e.to && o.to === e.from && Math.abs(o.length - e.length) < 1);
  if (twin?.parking?.[1] > 0) {
    const tl = curbOffset(twin, CAR), L = twin.cum[twin.cum.length - 1], mid = L - at;
    for (let r = mid - FAR_ROW_M[1]; r + CAR.length <= mid + FAR_ROW_M[0]; r += CAR.length + 1.2 + random() * 1.8) park(twin, r + CAR.rearOverhang, tl);
  }
  const balls = world.balls;
  balls.target = 0;
  const ball = balls.place({ edge, s: at, lat: lat - CAR.width / 2 + HIDE_IN_M, side: 1 },
    { trigger: BALL_TRIGGER_M, speed: 3.6, drift: 0.25, delay: CHILD_AFTER_S, childSpeed: 2.5, color: 0xe8322b, id: "challenge_ball", keep: true });
  return { ballId: ball.id, at: [ball.gap.x, ball.gap.y] };
}
