// Collection day: a garbage truck (a rear-loader) working its way along a residential street, stopping
// every few houses in its lane while its crew empties the bins at the kerb, now and then a worker
// crossing behind it to the bins on the far side and back. The truck stands in the only lane going
// its way, so the only way past it is round it through the oncoming lane, as round a double-parked
// van (sim/double-parked.js): while it stands at a stop it is one, a record in `world.doubleParked`
// (`truck: true`), and everyone waits TRUCK_WAIT_M behind its rear, clear of the crew working there,
// and goes round only once the oncoming lane is clear for the whole way round and no worker is out in
// the street beside it (a worker the driven car cannot see does not count for it; it passes slowly,
// at the van's PASS_MPS). Between stops it drives on at TRUCK_MPS, and traffic follows it: on a street
// with one lane each way there is no passing it on the move, and it is about to stop again.
//
// Opt-in: the NpcFleet option `collection` (free drives, unless `?collection=0`) puts TRUCK_COUNT to
// work at a time, by day and out of fog, from their own random stream; the "Collection day" challenge
// places one itself. With it off nothing is computed and no random stream is drawn from. The audit
// counts the driven car passing a worker in the street closer than CREW_CLEAR_M at more than
// CREW_PASS_MPS (`crew_close_passes`, sim/world.js), and that reaches the metrics, and fails a drive,
// only once a truck has stopped to collect in it (World.collectionSeen); going round it into the way
// of oncoming traffic is a failure to yield, as for a van.
//
// It stops only on a collection street: a quiet two-way street with one lane each way where a van
// could double-park (vanSites), straight, without a crosswalk, a bus or streetcar route or a level
// crossing, and clear of the junctions at each end; never by a work zone, a lane closure, a van or a
// vehicle stopped at the roadside.

import { Vehicle, CAR, COLLECTION_TRUCK, DELIVERY_VAN } from "./vehicle.js";
import { StopMemory } from "./signals.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { sidewalkOffset } from "../map/streets.js";
import { Pedestrian } from "./pedestrians.js";
import { QUIET } from "./hidden-hazards.js";
import { DAYLIGHT_RANGE_M } from "./visibility.js";
import { current as weather } from "./weather.js";
import { vanSites } from "./double-parked.js";

export const TRUCK_NAME = "garbage truck";
export const TRUCK_COUNT = 1;
export const TRUCK_MPS = 15 / 3.6;
export const DRIVE_MPS = 30 / 3.6;
export const TRUCK_WAIT_M = 10;
export const STOP_EVERY_M = [24, 42];
export const DWELL_S = [8, 14];
export const CROSS_P = 0.45;
export const CREW_MPS = 1.5;
export const BIN_S = [3, 5];
export const CREW_CLEAR_M = 1.5;
export const CREW_PASS_MPS = 2;
const STOP_DECEL = 1.2;
const BOARD_S = 1.0;                  // (a worker back at the step climbs on)
const STEP_M = 1.2;                   // (a worker less than this behind the truck's rear is at its step)
// Free drive: where trucks start (out of the car's sight), how long one works the area, and how far
// from the car it must be, out of its sight, before it goes.
const SPAWN_M = [150, 450];
const SHIFT_S = [240, 480];
const GONE_M = 450;
const RETRY_S = 5;
export const TRUCK_COLORS = [0x2f6b3a, 0xe9e9e4, 0x245a9c];

export const isTruck = (o) => o?.kind === "collection_truck";
export const isCrew = (o) => o?.kind === "pedestrian" && !!o.crew;

// The streets a truck stops on: where a van could double-park, on a quiet street, the range its rear can
// take shortened for its length. Each { edge, opposite, lo, hi }.
const siteCache = new WeakMap();
export function truckSites(map) {
  if (siteCache.has(map)) return siteCache.get(map);
  const extra = COLLECTION_TRUCK.length - DELIVERY_VAN.length;
  const sites = vanSites(map).filter((s) => QUIET.has(map.edges.get(s.edge).cls)).map((s) => ({ ...s, hi: s.hi - extra })).filter((s) => s.hi > s.lo);
  const byEdge = new Map(sites.map((s) => [s.edge, s]));
  siteCache.set(map, { sites, byEdge });
  return siteCache.get(map);
}

// A point `lat` metres right of edge `e`'s centre line, `s` along it.
function at(e, s, lat) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  return [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat];
}

// A worker of truck record `d` out in the street where the way round goes: alongside it, left of the
// truck's left side (in the oncoming lane, or the gap beside the truck); behind the truck in its lane,
// off its riding step; or across the street, still to cross back (from the far kerb to the truck).
// For the driven car (`observer`) only one it can see. Or null. (One at the bins on the truck's right,
// or on its step, is out of the way.)
export function crewInRoad(world, d, observer = null) {
  if (!d.truck) return null;
  const e = world.map.edges.get(d.edge), laneC = e.lane_offsets?.[0] ?? e.lane_width / 2, half = d.van.spec.width / 2;
  for (const p of world.crowd?.list || []) {
    if (p.crew !== d.id) continue;
    const q = projectPoint(e.pts, e.cum, [p.x, p.y], null), across = !!p.crossing || p.path.some((w) => w.cross?.worker);
    if (!q || q.s < d.detour.from - 4 || q.s > d.detour.to + 4) continue;
    const left = q.lateral < laneC - half - 0.1 && q.lateral > e.asphalt[0] - 0.3, behind = q.s < d.rear - STEP_M && q.lateral < laneC + half + 0.3;
    if (!left && !behind && !across) continue;
    if (observer && !world.sees(observer, p)) continue;
    return p;
  }
  return null;
}

// Garbage crew within `r` of (x, y): for the audit.
export function crewNear(world, x, y, r) {
  return (world.crowd?.list || []).filter((p) => p.crew && Math.abs(p.x - x) < r && Math.abs(p.y - y) < r);
}

export class CollectionTrucks {
  // `makePath`: a new NpcPath for a truck (sim/npc.js), from the trucks' own stream.
  constructor(fleet, { count = 0, random = null, makePath } = {}) {
    this.fleet = fleet;
    this.makePath = makePath;
    this.world = fleet.world;
    this.target = count;
    this.random = random;
    this.trucks = [];
    this.made = 0;
    this.crewMade = 0;
    this.next = 0;
  }

  // A truck on `lane`, its rear axle `s` along it, at `v`, driving on as traffic (`planned`: the edges
  // it takes next, before it picks its own turns). `held`: a challenge's truck stands where it is put.
  add(lane, s, v = 0, planned = [], { color = null, path = null } = {}) {
    const p = pointAt(lane.pts, lane.cum, s), n = ++this.made;
    const truck = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v, COLLECTION_TRUCK);
    Object.assign(truck, { id: `truck_${n}`, kind: "collection_truck", color: color ?? TRUCK_COLORS[(n - 1) % TRUCK_COLORS.length], v0: TRUCK_MPS, beacons: true,
      driver: { aMax: 1.0, b: 1.8, T: 1.6, s0: 3.0, react: 0.8, lcRate: 0 }, stopMem: new StopMemory(), frozen: 0, waiting: 0,
      collect: { phase: "drive", odo: 0, every: this.every(), stop: null, t: 0, dwell: 0, record: null, crew: [], shift: SHIFT_S[0] + (this.random ? this.random() : 0) * (SHIFT_S[1] - SHIFT_S[0]), worked: 0 } });
    truck.path = path || this.makePath();
    truck.path.start(lane.edge, lane.idx, s, planned);
    this.fleet.vehicles.push(truck);
    this.trucks.push(truck);
    return truck;
  }

  every() { return STOP_EVERY_M[0] + (this.random ? this.random() : 0.5) * (STOP_EVERY_M[1] - STOP_EVERY_M[0]); }

  // Trucks in a free drive: one put down here that has done its shift, or is far from the car, out of
  // its sight and driving, goes; and by day, out of fog, another is put down when there are too few.
  manage(dt) {
    const world = this.world, ego = world.ego;
    for (const n of [...this.trucks]) {
      const c = n.collect;
      // (one a challenge put down stays)
      if (!c.free || c.held || c.phase !== "drive") continue;
      const far = Math.hypot(n.x - ego.x, n.y - ego.y) > GONE_M;
      if ((far || c.worked > c.shift) && !world.visibility.canSee(ego, n.x, n.y) && (far || Math.hypot(n.x - ego.x, n.y - ego.y) > SPAWN_M[0])) this.remove(n);
    }
    if (this.target && this.trucks.length < this.target && (this.next -= dt) <= 0) {
      this.next = RETRY_S;
      if (world.visibility.night < 0.5 && weather.visibility >= DAYLIGHT_RANGE_M) this.spawn();
    }
  }

  remove(n) {
    this.release(n);
    for (const p of n.collect.crew) p.gone = true;
    this.world.crowd.list = this.world.crowd.list.filter((p) => !n.collect.crew.includes(p));
    const i = this.fleet.vehicles.indexOf(n);
    if (i >= 0) this.fleet.vehicles.splice(i, 1);
    this.trucks.splice(this.trucks.indexOf(n), 1);
  }

  // A truck on a collection street SPAWN_M from the car, out of its sight and clear of other traffic.
  spawn() {
    const world = this.world, ego = world.ego, { sites } = truckSites(world.map), random = this.random;
    for (let attempt = 0; sites.length && attempt < 20; attempt++) {
      const site = sites[Math.floor(random() * sites.length)], lane = world.map.lane(site.edge, 0), e = world.map.edges.get(site.edge);
      const rear = site.lo + random() * (site.hi - site.lo), s = (rear + COLLECTION_TRUCK.rearOverhang) * lane.length / e.length, p = pointAt(lane.pts, lane.cum, s);
      const dist = Math.hypot(p[0] - ego.x, p[1] - ego.y);
      if (dist < SPAWN_M[0] || dist > SPAWN_M[1] || world.visibility.canSee(ego, p[0], p[1])) continue;
      if (this.fleet.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < COLLECTION_TRUCK.length + 8) || world.workZones?.covers(p[0], p[1]) || world.laneClosures?.covers(p[0], p[1]) || world.doubleParked?.covers(p[0], p[1])) continue;
      const truck = this.add(lane, s, 0);
      truck.collect.free = true;
      return truck;
    }
    return null;
  }

  // One step of truck `n`'s collection (see the top of this file): where it stops, as metres from its
  // front (null when it is not stopping), or "work" while it stands at a stop.
  plan(n, front, dt) {
    const c = n.collect, world = this.world, map = world.map;
    if (c.phase === "drive") {
      c.odo += Math.max(0, n.v) * dt;
      c.worked += dt;
      // (at its collecting pace on a collection street, and no faster than DRIVE_MPS elsewhere)
      const pe = n.path.edges.find((x) => x.sEnd > front), site = pe && truckSites(map).byEdge.get(pe.id);
      n.v0 = site ? TRUCK_MPS : DRIVE_MPS;
      if (c.odo >= c.every) {
        // (on a collection street, a little way on, where it can slow to a stop gently)
        if (site) {
          const e = map.edges.get(pe.id), k = (pe.sEnd - pe.sStart) / Math.max(1, e.length);
          const rear = (front - pe.sStart) / k - COLLECTION_TRUCK.length + n.v * n.v / (2 * STOP_DECEL) + 2;
          if (rear >= site.lo && rear <= site.hi && this.clearToStop(e, rear)) c.stop = { edge: pe.id, rear }, c.phase = "approach";
        }
      }
    }
    if (c.phase === "approach") {
      const pe = n.path.edges.find((x) => x.id === c.stop.edge && x.sEnd > n.path.s - 5);
      if (!pe) { Object.assign(c, { phase: "drive", stop: null }); return null; }
      const e = map.edges.get(pe.id), k = (pe.sEnd - pe.sStart) / Math.max(1, e.length);
      const to = pe.sStart + (c.stop.rear + COLLECTION_TRUCK.length) * k - front;
      if (to < -3) { Object.assign(c, { phase: "drive", stop: null }); return null; }
      if (n.v < 0.2 && to < 2.5) { this.arrive(n); return "work"; }
      return to + (n.driver.s0 || 0) - 0.5;
    }
    return null;
  }

  // Whether a truck can stop with its rear `rear` along edge `e`: not where a van stands, or a work zone,
  // a lane closure or a vehicle at the roadside, and nobody alongside it there.
  clearToStop(e, rear) {
    const world = this.world, mid = at(e, rear + COLLECTION_TRUCK.length / 2, 0);
    if (world.doubleParked?.vans.some((d) => (d.edge === e.id || d.opposite === e.id) && Math.hypot(d.x - mid[0], d.y - mid[1]) < 60)) return false;
    if (world.workZones?.covers(mid[0], mid[1]) || world.laneClosures?.covers(mid[0], mid[1])) return false;
    if ((world.roadside?.vehicles || []).some((v) => Math.hypot(v.x - mid[0], v.y - mid[1]) < 40)) return false;
    return true;
  }

  // Stopped at a stop: it becomes a double-parked record (sim/double-parked.js) while it stands there,
  // and its crew gets down.
  // (`cross`: a challenge has a worker cross the street, whatever the stream says)
  arrive(n, { cross = null } = {}) {
    const c = n.collect, world = this.world, e = world.map.edges.get(c.stop.edge);
    const q = projectPoint(e.pts, e.cum, [n.x, n.y], null), rear = (q ? q.s : c.stop.rear + COLLECTION_TRUCK.rearOverhang) - COLLECTION_TRUCK.rearOverhang;
    n.v = 0; n.a = 0;
    n.doubleParked = true; n.hazards = true;
    c.record = world.doubleParked.placeTruck(n, { edge: e.id, rear, wait: TRUCK_WAIT_M, name: TRUCK_NAME });
    Object.assign(c, { phase: "work", t: 0, dwell: DWELL_S[0] + this.random() * (DWELL_S[1] - DWELL_S[0]) });
    world.collectionSeen = true;
    this.crewOut(n, e, c.record, cross ?? this.random() < CROSS_P);
  }

  // At a stop: the crew empties the bins, and once they are back on and nobody is beside it or going
  // round it, it drives on. Returns whether it still stands there.
  work(n, dt) {
    const c = n.collect;
    n.v = 0;
    if (c.held) return true;
    c.t += dt;
    c.crew = c.crew.filter((p) => !p.gone);
    if (c.t < c.dwell || c.crew.length || this.world.doubleParked.busy(c.record)) return true;
    this.release(n);
    Object.assign(c, { phase: "drive", odo: 0, every: this.every(), stop: null });
    return false;
  }

  release(n) {
    const c = n.collect;
    if (c.record) this.world.doubleParked.release(c.record);
    c.record = null;
    n.doubleParked = false; n.hazards = false;
  }

  // The crew at a stop with its rear `rear` along `e`: a worker from the rear step to the bins at the
  // kerb beside it and back; with `cross`, another across the street behind it, from its left rear
  // corner to the far kerb's bins and back. Each climbs back on at the step, and is gone.
  crewOut(n, e, d, cross) {
    const world = this.world, random = this.random, L = e.cum[e.cum.length - 1], scale = L / Math.max(1, e.length);
    const back = d.rear - 0.8, lane = e.lane_offsets?.[0] ?? e.lane_width / 2;
    const kerb = (side) => at(e, back * scale, side > 0 ? e.asphalt[1] + 0.4 : e.asphalt[0] - 0.4);
    const step = (side) => at(e, back * scale, lane + side * (COLLECTION_TRUCK.width / 2 - 0.3));
    const make = (side, crossing) => {
      const from = step(side), to = kerb(side), wait = BIN_S[0] + random() * (BIN_S[1] - BIN_S[0]);
      const go = crossing ? { node: null, from, to, jaywalk: true, worker: n.id } : null, home = crossing ? { node: null, from: to, to: from, jaywalk: true, worker: n.id } : null;
      const p = new Pedestrian({ id: `crew_${++this.crewMade}`, x: from[0], y: from[1], psi: headingAt(e.pts, e.cum, back * scale) + (side > 0 ? -Math.PI / 2 : Math.PI / 2), v: 0,
        speed: CREW_MPS, worker: true, crew: d.id, truck: n.id, home: true, pause: side > 0 ? 0.6 : 1.4, look: Math.floor(random() * 1e6), waiting: 0, phase: 0, crossing: null,
        path: [{ p: to, ...(go ? { cross: go } : {}), wait }, { p: from, ...(home ? { cross: home } : {}), wait: BOARD_S }] });
      world.crowd.list.push(p);
      n.collect.crew.push(p);
      return p;
    };
    make(1, false);
    if (cross) make(-1, true);
  }
}
