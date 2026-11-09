// "Room to park": Larch Street in Kitsilano (a residential street, one lane each way, 50 km/h, parking at
// both kerbs), a straight block with its right kerb lined with parked cars but for one gap. The driven
// car comes along it at 30 km/h behind an ordinary traffic car; that car is a parker from the start
// (sim/parkers.js): it signals right, slows, stops alongside the car parked in front of the gap and
// reverses in, on the same geometry and car model as the driven car's own parking. The driven car must
// stop well back, short of the hold line, and wait, neither creeping into the room it needs nor going
// round it, until it is in. The site: the first block of the challenge's `street` (rooms.sites) that is a
// straight, two-way residential street with one lane each way, a parking lane on the right and room to
// park all along it from RP_ROW_M[0] behind the gap to RP_ROW_M[1] past it. The parker starts RP_LEAD_M
// ahead of the car (front to rear bumper), its stop RP_STOP_M ahead of it; the route ends RP_PAST_M past
// the gap.
import { routeFromLanes } from "../demo/routing.js";
import { cumulative, headingAt, pointAt } from "../map/mapdata.js";
import { Vehicle, CAR } from "../sim/vehicle.js";
import { NpcPath } from "../sim/npc.js";
import { StopMemory } from "../sim/signals.js";
import { curbOffset } from "../sim/roadside.js";
import { legalStretches, straight as straightKerb } from "../sim/parallel-park.js";
import { commitParker, parkerPlan } from "../sim/parkers.js";
import { rng } from "../common.js";

// The gap (from the rear bumper of the car in front of it to the front bumper of the car behind), the
// rows either side of it, the parker's lead on the car and its stop ahead of it, both cars' speed, the
// route's end past the gap, and the cars' spacing along the kerb.
export const RP_GAP_M = 8, RP_ROW_M = [70, 30], RP_LEAD_M = 18, RP_STOP_M = 55, RP_MPS = 8.3, RP_PAST_M = 60, RP_SPACING_M = 1.3;

const siteCache = new WeakMap();
// Where the gap's back (its own `s` along the street) can be, on blocks of `street` (or any, where it has
// none) that fit: the parker's start and the car's behind it on the block, the rows and route on it too.
export function parkerSites(map, street = null) {
  if (!siteCache.has(map)) {
    const sites = [], front = CAR.length - CAR.rearOverhang;
    for (const e of map.edges.values()) {
      if (e.cls !== "residential" || !e.parking?.[1] || e.ring || e.oneway || e.lanes !== 1 || map.zoneSpans.get(e.id)?.length || map.calmingSpans?.get?.(e.id)?.length) continue;
      const back = RP_ROW_M[0] + 12, end = (e.control?.s_line ?? e.length) - 4;
      const gap = Math.max(back, RP_STOP_M + RP_LEAD_M + front + CAR.length + 12);
      const lo = gap - RP_ROW_M[0], hi = gap + RP_GAP_M + RP_ROW_M[1];
      if (gap + RP_GAP_M + RP_PAST_M > end) continue;
      if (!legalStretches(map, e).some(([a, b]) => a <= lo && b >= hi) || !straightKerb(e, lo - 2, hi + 2)) continue;
      sites.push({ edge: e.id, gap, name: e.name });
    }
    siteCache.set(map, sites);
  }
  const sites = siteCache.get(map), on = sites.filter((s) => s.name === street);
  return on.length ? on : sites;
}

export function parkerScenario(map, challenge) {
  const site = parkerSites(map, challenge.street)[0];
  if (!site) throw new Error(`No residential street with room for the "Room to park" challenge.`);
  const e = map.edges.get(site.edge), lane = map.lane(e.id, e.lanes - 1), k = lane.length / e.length;
  const front = CAR.length - CAR.rearOverhang;
  // (the parker's rear axle RP_STOP_M short of where it stops, about level with the gap's front; the
  // car's front RP_LEAD_M behind its rear bumper)
  const parkerS = site.gap + RP_GAP_M - RP_STOP_M;
  const s = (parkerS - CAR.rearOverhang - RP_LEAD_M - front) * k;
  const route = routeFromLanes(map, [lane], s, (site.gap + RP_GAP_M + RP_PAST_M) * k);
  const p = pointAt(lane.pts, lane.cum, s);
  return { id: challenge.id, start: { edge: e.id, lane: lane.idx, s, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s) }, route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    parker: { edge: e.id, gap: site.gap, s: parkerS * k },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 0, stops: 0, lefts: 0, rights: 0 } };
}

// The cars along both kerbs, staying put but for the one gap, and the parker ahead of the car, both at
// RP_MPS (the world's own parkers picked none: it is the only one).
export function placeParker(world, fleet, spec, seed) {
  const map = world.map, e = map.edges.get(spec.edge), random = rng(seed), lat = curbOffset(e, CAR);
  const colors = [0x8d9299, 0x2b3a55, 0xeeeeea, 0x1a1c20, 0x6b7f5e, 0x9b1e1e, 0xc4c8cc];
  let made = 0;
  const park = (side, s, l) => {
    const p = pointAt(side.pts, side.cum, s), h = headingAt(side.pts, side.cum, s);
    const car = new Vehicle(p[0] + Math.sin(h) * l, p[1] - Math.cos(h) * l, h, 0);
    Object.assign(car, { id: `challenge_parked_${++made}`, color: colors[Math.floor(random() * colors.length)], style: made % 6, curb: "right", edge: side.id, stay: true });
    world.parked.add(car);
  };
  // (the right kerb: bumper to bumper either side of the gap, from RP_ROW_M[0] behind it to RP_ROW_M[1] past)
  const rears = [];
  for (let rear = spec.gap + RP_GAP_M; rear + CAR.length <= spec.gap + RP_GAP_M + RP_ROW_M[1]; rear += CAR.length + RP_SPACING_M) rears.push(rear);
  for (let rear = spec.gap - CAR.length; rear >= spec.gap - RP_ROW_M[0]; rear -= CAR.length + RP_SPACING_M) rears.push(rear);
  for (const rear of rears.sort((x, y) => x - y)) park(e, rear + CAR.rearOverhang, lat);
  // (and the far kerb, its twin edge's right, where one may park)
  const twin = [...map.edges.values()].find((o) => o.from === e.to && o.to === e.from && Math.abs(o.length - e.length) < 1);
  if (twin?.parking?.[1] > 0) {
    const tl = curbOffset(twin, CAR), L = twin.cum[twin.cum.length - 1], mid = L - spec.gap;
    for (let r = mid - RP_ROW_M[1] - 20; r + CAR.length <= mid + RP_ROW_M[0]; r += CAR.length + 1.4 + random() * 2.2) park(twin, r + CAR.rearOverhang, tl);
  }
  // the parker, in the car's lane ahead of it, already signalling for the gap
  const lane = map.lane(e.id, e.lanes - 1), p = pointAt(lane.pts, lane.cum, spec.s);
  const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, spec.s), RP_MPS, CAR);
  Object.assign(car, { id: "challenge_parker", color: 0x9b1e1e, style: 2, v0: RP_MPS, driver: { aMax: 1.4, b: 2.0, s0: 2, T: 1.3, react: 0.5, lcRate: 0 }, stopMem: new StopMemory(),
    path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0, lcCooldown: 1e6 });
  car.path.start(e.id, lane.idx, spec.s);
  fleet.vehicles.push(car);
  world.parkers.next = Infinity;
  const found = parkerPlan(world, car);
  if (!found || Math.abs(found.plan.sTo - (spec.gap + RP_GAP_M)) > 1.5) throw new Error("The parker could not plan its way into the gap.");
  commitParker(world, car, found.plan, { stay: true });
  world.ego.v = RP_MPS;
  return { parker: { carId: car.id }, at: [p[0], p[1]] };
}

// The hazard is the parker stopping to reverse in: it triggers once it has.
export function stepParkerChallenge(world) {
  const state = world.challenge;
  if (state.triggered) return;
  const n = world.npcs.find((o) => o.id === state.parker.carId);
  if (!n || (n.parker && n.parker.phase !== "approach")) state.triggered = true;
}
