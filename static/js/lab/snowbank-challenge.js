// "One car at a time": snowbanks (sim/snowbanks.js) on Avenue Laval in the Plateau, Montréal, a two-way
// residential street with one lane each way and parking at both kerbs, in falling snow. The site: the
// first block of the challenge's `street` that a narrowing can form on (sim/snowbanks.js narrowingSites),
// driven the way whose far end has no stop sign, where SB_LEN_M of it, SB_START_M + the car's front
// from its start, is narrowed: the banks have pushed the parked cars at both kerbs out, leaving room for
// one moving car. The car starts from a standstill SB_START_M short of the narrowed stretch. A car coming
// the other way is already in it, SB_ONCOMING_IN_M in, at SB_ONCOMING_MPS: its turn, so the car must wait
// at its end until it is through. Past the stretch the street runs on to a corner where the plows have
// piled the snow high, and someone waiting there behind the pile to cross Avenue Laval steps off, without
// seeing the car either, once the car's front is SB_TRIGGER_M short of the crosswalk: the car must creep
// up to the corner, ready to stop. The route turns left there onto Rue Marie-Anne Est (Laval runs one way
// toward the corner beyond it) and ends SB_GOAL_M along it.
import { routeFromLanes } from "../demo/routing.js";
import { cumulative, headingAt, pointAt } from "../map/mapdata.js";
import { Vehicle, CAR } from "../sim/vehicle.js";
import { NpcPath } from "../sim/npc.js";
import { StopMemory } from "../sim/signals.js";
import { Pedestrian } from "../sim/pedestrians.js";
import { keepAt, narrowingSites, pushedLat } from "../sim/snowbanks.js";
import { sidewalkOffset } from "../map/streets.js";
import { rng } from "../common.js";

export const SB_START_M = 42, SB_LEN_M = 60, SB_ONCOMING_IN_M = 8, SB_ONCOMING_MPS = 3.5, SB_TRIGGER_M = 26, SB_GOAL_M = 25;
const PED_MPS = 1.3, PARKED_GAP_M = [0.9, 2.6];
const CROSS_BEYOND_CURB_M = 1.6;   // (as sim/pedestrians.js: where a corner's crosswalk is)
const FRONT = CAR.length - CAR.rearOverhang;
const lengthOf = (e) => e.cum[e.cum.length - 1];
const offsetPoint = (e, s, lat) => { const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s); return [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat]; };

// The street the car goes on to beyond the end of edge `e`: the straightest way on that is not a U-turn
// (on Avenue Laval, left onto Rue Marie-Anne Est: Laval runs one way toward the corner beyond it), or null.
function wayOn(map, e) {
  const out = (map.out.get(e.to) || []).map((id) => map.edges.get(id)).filter((o) => o.to !== e.from);
  const turn = (o) => Math.abs(map.turnAngle(e.id, o.id));
  return out.filter((o) => turn(o) < Math.PI * 3 / 4).sort((x, y) => turn(x) - turn(y))[0] || null;
}

// The blocks of `street` a narrowing can form on, the way the car drives: { edge, a, b, next }.
export function snowbankSites(map, street = null) {
  const out = [];
  for (const site of narrowingSites(map)) {
    if (street && site.name !== street) continue;
    for (const [id, lo, hi] of [[site.edge, site.lo, site.hi], [site.opposite, null, null]]) {
      const e = map.edges.get(id), L = lengthOf(e);
      if (e.control) continue;
      const [l, h] = lo === null ? [L - site.hi, L - site.lo] : [lo, hi];
      const a = Math.max(l, SB_START_M + FRONT + 3), b = a + SB_LEN_M;
      const next = wayOn(map, e);
      // (and a corner at its far end: a junction)
      const ends = new Set([...(map.out.get(e.to) || []), ...(map.inn.get(e.to) || [])].map((x) => { const y = map.edges.get(x); return y.from === e.to ? y.to : y.from; }));
      if (b > h || !next || next.length < SB_GOAL_M + 5 || ends.size < 3) continue;
      out.push({ edge: id, a, b, next: next.id });
    }
  }
  return out;
}

export function snowbankScenario(map, challenge) {
  const site = snowbankSites(map, challenge.street)[0];
  if (!site) throw new Error(`No block of ${challenge.street} for the "One car at a time" challenge.`);
  const e = map.edges.get(site.edge), lane = map.lane(e.id, 0), next = map.lane(site.next, map.edges.get(site.next).lanes - 1);
  const k = lane.length / lengthOf(e), s = (site.a - SB_START_M - FRONT) * k;
  const route = routeFromLanes(map, [lane, next], s, SB_GOAL_M * next.length / lengthOf(next.edgeRef));
  const p = pointAt(lane.pts, lane.cum, s);
  return { id: challenge.id, start: { edge: e.id, lane: 0, s, x: p[0], y: p[1], psi: headingAt(lane.pts, lane.cum, s) }, route, goal: route.polyline.at(-1), traffic_seed: challenge.seed,
    snowbank: { edge: e.id, a: site.a, b: site.b },
    tags: { length_m: Math.round(cumulative(route.polyline).at(-1)), signals: 0, stops: 0, lefts: 0, rights: 0 } };
}

// The narrowed stretch (the world's own narrowings replaced by it), the cars parked along both kerbs there,
// pushed out by the banks, the car coming the other way already in it, and the person waiting behind the
// pile at the corner beyond.
export function placeSnowbank(world, fleet, { edge, a, b }, seed) {
  const map = world.map, sb = world.snowbanks, random = rng(seed);
  sb.build({ narrowings: [{ edge, a, b }] });
  const nw = sb.narrowings[0], e = map.edges.get(edge), o = map.edges.get(nw.opposite), L = lengthOf(e);
  const colors = [0x8d9299, 0x2b3a55, 0xeeeeea, 0x1a1c20, 0x6b7f5e, 0x9b1e1e, 0xc4c8cc, 0x4a4f57];
  let n = 0;
  for (const [side, from, to] of [[e, a, b], [o, L - b, L - a]]) {
    const lat = pushedLat(side);
    for (let r = from + 0.5 + random() * 2; r + CAR.length <= to - 0.5; r += CAR.length + PARKED_GAP_M[0] + random() * (PARKED_GAP_M[1] - PARKED_GAP_M[0])) {
      const s = r + CAR.rearOverhang, p = pointAt(side.pts, side.cum, s), h = headingAt(side.pts, side.cum, s);
      const car = new Vehicle(p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat, h, 0);
      Object.assign(car, { id: `challenge_parked_${++n}`, color: colors[Math.floor(random() * colors.length)], style: n % 6, curb: "right", edge: side.id, stay: true });
      world.parked.add(car);
    }
  }
  // (the car coming the other way: its front SB_ONCOMING_IN_M into the stretch from its end, at its pace)
  const lane = map.lane(o.id, 0), k = lane.length / lengthOf(o), rs = (L - b + SB_ONCOMING_IN_M - FRONT) * k;
  // (already over toward the middle, clear of the parked cars)
  const h = headingAt(lane.pts, lane.cum, rs), shift = Math.min(0, keepAt(o, CAR) - (o.lane_offsets?.[0] ?? 1.6)), q0 = pointAt(lane.pts, lane.cum, rs);
  const q = [q0[0] + Math.sin(h) * shift, q0[1] - Math.cos(h) * shift];
  const car = new Vehicle(q[0], q[1], h, SB_ONCOMING_MPS);
  Object.assign(car, { id: "challenge_oncoming", color: 0x9b1e1e, v0: SB_ONCOMING_MPS / 0.62, driver: { aMax: 1.0, b: 1.5, s0: 2, T: 1.5, react: 0.8, lcRate: 0 },
    stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 0, waiting: 0, sbShift: shift });
  car.path.start(o.id, 0, rs);
  fleet.vehicles.push(car);
  // (the person behind the pile at the right-hand corner ahead, at the crosswalk across Avenue Laval)
  let half = 0;
  for (const id of [...(map.inn.get(e.to) || []), ...(map.out.get(e.to) || [])]) { const x = map.edges.get(id); half = Math.max(half, Math.abs(x.asphalt[0]), Math.abs(x.asphalt[1])); }
  const legS = L - Math.min(L / 2, half + CROSS_BEYOND_CURB_M);
  const from = offsetPoint(e, legS, sidewalkOffset(e, 1) - 0.8), to = offsetPoint(e, legS, sidewalkOffset(e, -1));
  const ped = new Pedestrian({ id: "challenge_pedestrian", x: from[0], y: from[1], psi: Math.atan2(to[1] - from[1], to[0] - from[0]), v: 0, speed: PED_MPS, dart: true, held: true, home: true,
    path: [{ p: to, cross: { node: e.to, from, to } }], crossing: null, waiting: 0, phase: 0, look: seed, at: null });
  world.crowd.list.push(ped);
  const cw = offsetPoint(e, legS, e.lane_offsets?.[0] ?? 1.6);
  const crosswalkS = world.route.project(cw[0], cw[1], 0).s;
  return { snowbank: true, narrowingId: nw.id, oncomingId: car.id, pedestrianId: ped.id, crosswalkS, at: cw };
}

// Once the car's front is SB_TRIGGER_M short of the crosswalk, the person steps off.
export function stepSnowbank(world) {
  const state = world.challenge, route = world.route;
  if (state.triggered || !route) return;
  const p = route.project(world.ego.x, world.ego.y, route.hint ?? 0);
  if (!p || p.s + world.ego.spec.length - world.ego.spec.rearOverhang < state.crosswalkS - SB_TRIGGER_M) return;
  state.triggered = true;
  const ped = world.crowd.list.find((x) => x.id === state.pedestrianId);
  if (ped) { ped.held = false; ped.crossing = ped.path[0].cross; }
}
