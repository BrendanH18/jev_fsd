// Transit on its runs (sim/bus.js, sim/streetcar.js): the routes the map's transit layer gives, run by
// buses or, on a streetcar route, by streetcars in the lane their track is laid in. The fleet keeps one
// of these for each mode (sim/features/buses.js, sim/features/streetcars.js), with a random stream of
// its own, so running them leaves the rest of the traffic as it was.
//
// In free drives, up to `max` at a time (4 buses, 2 streetcars) run their routes, placed at least START_M
// from the car to begin with and then, once one has finished its run more than GONE_M from the car
// (a streetcar: or out of its sight, as it has nowhere to drive on to), another EVERY_S later at least
// LATER_M away.
import { rng } from "../common.js";
import { headingAt, pointAt } from "../map/mapdata.js";
import { StopMemory } from "./signals.js";
import { BUS, STREETCAR, Vehicle } from "./vehicle.js";
import { busStopFront, isBus } from "./bus.js";
import { isStreetcar } from "./streetcar.js";

export const START_M = 60;
export const LATER_M = 150;
const GONE_M = 150;
const EVERY_S = [15, 45];
const BUS_COLOR = 0xf4f4f0;
const STREETCAR_COLOR = 0xc8102e;

export class TransitRuns {
  // `tram`: streetcars, else buses. `pathPolicy(world, path)` and `spawnLane(world, edge)` (the lane
  // index a bus starts in, or undefined for the curb lane) apply to buses.
  constructor(
    fleet,
    { tram = false, max, enabled, seed, makePath, pathPolicy = () => {}, spawnLane = () => undefined },
  ) {
    this.fleet = fleet;
    this.world = fleet.world;
    this.map = fleet.map;
    this.tram = tram;
    this.is = tram ? isStreetcar : isBus;
    this.makePath = makePath;
    this.pathPolicy = pathPolicy;
    this.spawnLane = spawnLane;
    this.random = tram ? rng(seed * 49979687 + 13) : rng(seed * 15485863 + 11);
    this.count = 0;
    this.list = [];
    this.target = enabled ? Math.min(max, this.runs().length) : 0;
    for (let i = 0; i < this.target; i++) this.spawn(START_M);
    this.next = this.world.t + EVERY_S[0];
    this.list = this.fleet.vehicles.filter(this.is);
  }

  // Every run of every route of this mode on the map: [{ route, run }].
  runs() {
    if (!this._runs)
      this._runs = (this.map.transit?.routes || [])
        .filter((route) => (route.mode === "tram") === this.tram)
        .flatMap((route) =>
          route.runs.filter((run) => run.edges.every((id) => this.map.edges.has(id))).map((run) => ({ route, run })),
        );
    return this._runs;
  }

  // Place one on a run of its route (`pick`, by default one at random, longer runs more often) at `sRun`
  // metres along it (by default somewhere in its first 80%), at least `away` metres from the car and
  // clear of other traffic. Returns it, or null. (A streetcar: in the lane its track is laid in.)
  spawn(away = LATER_M, pick = null, sRun = null) {
    const runs = this.runs(),
      map = this.map,
      ego = this.world.ego,
      tram = this.tram,
      spec = tram ? STREETCAR : BUS,
      random = this.random,
      vehicles = this.fleet.vehicles;
    if (!runs.length) return null;
    const total = runs.reduce((a, r) => a + r.run.length, 0);
    for (let attempt = 0; attempt < 12; attempt++) {
      let choice = pick;
      if (!choice) {
        let at = random() * total;
        choice = runs.find((r) => (at -= r.run.length) <= 0) || runs.at(-1);
      }
      const { route, run } = choice;
      let along = sRun ?? random() * run.length * 0.8,
        k = 0;
      while (k < run.edges.length - 1 && along > map.edges.get(run.edges[k]).length)
        along -= map.edges.get(run.edges[k++]).length;
      const e = map.edges.get(run.edges[k]),
        lane = map.lane(
          e.id,
          tram ? Math.min(run.lane ?? 0, e.lanes - 1) : (this.spawnLane(this.world, e) ?? e.lanes - 1),
        );
      if (!lane) continue;
      const s = Math.max(1, Math.min(lane.length - 1, (along * lane.length) / Math.max(1, e.length)));
      const p = pointAt(lane.pts, lane.cum, s);
      if (Math.hypot(p[0] - ego.x, p[1] - ego.y) < away) {
        if (pick) return null;
        continue;
      }
      if (vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < spec.length + 4)) {
        if (pick) return null;
        continue;
      }
      const v = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), Math.min(8, e.limit * 0.6), spec);
      Object.assign(v, {
        id: tram ? `streetcar_${++this.count}` : `bus_${++this.count}`,
        kind: spec.kind,
        color: tram ? STREETCAR_COLOR : BUS_COLOR,
        ref: route.ref,
        headsign: route.name,
        v0: 15,
        driver: { aMax: tram ? 1.1 : 1.0, b: 1.8, T: 1.6, s0: 3.0, react: 0.9, lcRate: 0 },
        stopMem: new StopMemory(),
        frozen: 0,
        waiting: 0,
      });
      v.path = this.makePath(map, random, {});
      if (!tram) this.pathPolicy(this.world, v.path);
      this.startRun(v, run.edges, k, lane.idx, s, tram);
      // the route's stops still ahead, as where its front stops along each street (see busStopFront)
      const firstAt =
        run.edges.slice(0, k).reduce((a, id) => a + map.edges.get(id).length, 0) +
        (s * e.length) / Math.max(1, lane.length);
      let at = 0;
      const stops = [];
      run.edges.forEach((id, i) => {
        for (const st of run.stops.filter((x) => x.edge === id)) {
          const front = busStopFront(map, id, st.s, spec.length);
          if (front !== null && at + front > firstAt + spec.length + 20)
            stops.push({ id: st.id, edge: id, k: i, front });
        }
        at += map.edges.get(id).length;
      });
      v.transit = {
        route: route.id,
        ref: route.ref,
        edges: run.edges,
        k,
        stops,
        next: 0,
        phase: "drive",
        shift: 0,
        curb: 0,
        t: 0,
        dwell: 0,
        departures: 0,
        doors: false,
        done: false,
        limit: e.limit,
        laneWidth: e.lane_width,
        ...(tram ? { tram: true, lane: lane.idx, off: 0, on: 0, riderAt: 0 } : {}),
      };
      vehicles.push(v);
      this.list = vehicles.filter(this.is);
      return v;
    }
    return null;
  }

  // Start one's path on edge `edges[k]` (lane `lane`, `s` along it) with the rest of its run planned.
  // (`fixed`: a streetcar's, in that lane all the way, along its track.)
  startRun(n, edges, k, lane, s, fixed = false) {
    let prev = { id: edges[k], lane };
    const planned = edges.slice(k + 1).map((id) => {
      prev = {
        id,
        lane: fixed ? Math.min(lane, this.map.edges.get(id).lanes - 1) : n.path.laneInto(prev.id, prev.lane, id),
      };
      return [id, prev.lane];
    });
    n.path.start(edges[k], lane, s, planned);
  }

  // Back on its path after it was lost: one back on its run keeps to it. True when it did.
  recover(n, near) {
    const k = n.transit && !n.transit.done ? n.transit.edges.indexOf(near.lane.edge, n.transit.k) : -1;
    if (k < 0) return false;
    this.startRun(n, n.transit.edges, k, near.lane.idx, near.s);
    return true;
  }

  // Note where each is along its run, take off those that have finished it well away from the car, and
  // send another when there are too few.
  manage() {
    const ego = this.world.ego,
      vehicles = this.fleet.vehicles;
    for (const n of vehicles.filter(this.is)) {
      const t = n.transit;
      if (!t) continue;
      // (along its run, or off it: then it has finished, and drives on as traffic)
      const id = n.path.currentEdge().id,
        k = t.edges.indexOf(id, t.k);
      if (k >= 0) t.k = k;
      else if (!t.done && t.edges.indexOf(id) < 0) t.done = true;
      if (t.k === t.edges.length - 1 && n.path.currentEdge().sEnd - n.path.s < 15) t.done = true;
      // (a streetcar waits at the end of its run, where its track leaves the map's streets, until the
      // car is well away or cannot see it: it has nowhere to drive on to as traffic)
      if (
        t.done &&
        t.phase === "drive" &&
        (Math.hypot(n.x - ego.x, n.y - ego.y) > GONE_M || (this.tram && !this.world.visibility.sees(ego, n)))
      ) {
        vehicles.splice(vehicles.indexOf(n), 1);
        this.next = Math.max(this.next, this.world.t + EVERY_S[0] + this.random() * (EVERY_S[1] - EVERY_S[0]));
      }
    }
    if (vehicles.filter(this.is).length < this.target && this.world.t >= this.next) {
      if (!this.spawn(LATER_M)) this.next = this.world.t + 5;
      else this.next = this.world.t + EVERY_S[0];
    }
    this.list = vehicles.filter(this.is);
  }

  // Where along one's path its front stops for `stop`, or null when that street is behind it.
  stopOnPath(n, stop, front) {
    const pe = n.path.edges.find((e) => e.id === stop.edge && e.sEnd > front - n.spec.length);
    if (!pe) return null;
    return pe.sStart + (stop.front * (pe.sEnd - pe.sStart)) / Math.max(1, this.map.edges.get(stop.edge).length);
  }
}
