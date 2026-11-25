// Parked cars along the curbs of streets with parking lanes. They are real obstacles: the ego, the
// traffic, and every candidate forward-simulation can hit them. Cars open street-side doors,
// pull out into traffic, and park in vacant bays (see NpcFleet). Placement is seeded, so a
// scenario always has the same cars in the same spots. With buses running, nobody parks in a bus
// zone (`zones`, see sim/bus.js busZones): its bays are left out. A car that `stay`s (at a roadside
// stop, sim/roadside.js) neither opens a door nor pulls out.

import { Vehicle, CAR } from "./vehicle.js";
import { pointAt, headingAt, projectPoint } from "../map/mapdata.js";
import { rng } from "../common.js";

const SLOT_M = 6.4; // curb length per parked car
const CORNER_CLEAR_M = 5.0; // no parking this close to the crossing street's curb
const LINE_CLEAR_M = 6.0; // nor this close before a stop line or yield line
const CELL = 25;
const OPEN_DOOR_S = 6;
const RESERVATION_GAP_M = 0.5;
const PARKED_REAR_AXLE_OFFSET = CAR.length / 2 - CAR.rearOverhang;
// On the inside of a bend a straight car body leaves the curve: its ends reach out of the parking lane
// into the travel lane. A bay whose car would reach further in than this is not a bay.
const BEND_INTRUSION_M = 0.3;
// Real-world paint mix, as for the traffic.
const PALETTE = [
  0xeeeeea, 0x8d9299, 0x1a1c20, 0xc4c8cc, 0x2b3a55, 0x9b1e1e, 0xf2f2ee, 0x4a4f57, 0x0f1114, 0x6b7f5e, 0xb9b3a5,
  0x6e5a44,
];

export const PARKED_DENSITY = 0.5;

// Every reserved bay has one shape: who holds it and the stretch of its own edge's kerb it takes.
// Vehicle reservations keep the same half-metre bumper room as parking's free-space check. A driveway
// has no vehicle of its own, so it keeps an ordinary car's footprint clear in each bay it crosses.
export function reserveSlot(map, slot, owner, { spec = owner?.spec || CAR, sFrom, sTo } = {}) {
  if (!owner || (typeof owner !== "object" && typeof owner !== "function"))
    throw new TypeError("Parking reservation requires an owner");
  if (!slot) throw new TypeError("Parking reservation requires a bay");
  let s;
  if (sFrom == null || sTo == null) {
    const e = map?.edges?.get(slot.edge);
    if (!e) throw new RangeError(`Unknown parking bay edge: ${slot.edge}`);
    if (!Number.isFinite(slot.x) || !Number.isFinite(slot.y))
      throw new RangeError("Parking bay coordinates must be finite");
    if (!Number.isFinite(spec?.rearOverhang) || spec.rearOverhang < 0)
      throw new RangeError("Parking reservation requires a nonnegative rear overhang");
    if (sTo == null && (!Number.isFinite(spec.length) || spec.length <= spec.rearOverhang))
      throw new RangeError("Parking reservation requires a length greater than the rear overhang");
    s = projectPoint(e.pts, e.cum, [slot.x, slot.y])?.s;
    if (!Number.isFinite(s)) throw new RangeError("Parking bay edge has no projectable kerb");
  }
  const from = sFrom ?? s - spec.rearOverhang - RESERVATION_GAP_M;
  const to = sTo ?? s - spec.rearOverhang + spec.length + RESERVATION_GAP_M;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
    throw new RangeError("Parking reservation requires an increasing finite span");
  slot.reserved = { owner, sFrom: from, sTo: to };
  return slot.reserved;
}

// A delayed release must leave a reservation that has since changed hands intact.
export function releaseSlot(slot, owner) {
  if (!owner || slot?.reserved?.owner !== owner) return false;
  slot.reserved = null;
  return true;
}

// A parking plan claims the empty, unreserved bays it covers. If one has invalid geometry, keep
// the plan from claiming only the bays it happened to visit before the error.
export function reserveAvailableSlots(map, slots, owner) {
  const claimed = [];
  try {
    for (const slot of slots) {
      if (slot.reserved || slot.occupant) continue;
      reserveSlot(map, slot, owner);
      claimed.push(slot);
    }
  } catch (error) {
    for (const slot of claimed) releaseSlot(slot, owner);
    throw error;
  }
}

function nearbyCenter(car, x, y, radius2) {
  const [cx, cy] = car.center;
  return (cx - x) ** 2 + (cy - y) ** 2 <= radius2;
}

// How far (metres) a car parked square in the bay centred at `s`, `lat` metres right of edge e's
// centreline, reaches past the parking lane into the travel lanes: positive on the inside of a bend.
export function bayIntrusion(e, s, lat, spec = CAR) {
  const [px, py] = pointAt(e.pts, e.cum, s),
    h = headingAt(e.pts, e.cum, s);
  return footprintIntrusion(e, px + Math.sin(h) * lat, py - Math.cos(h) * lat, h, lat > 0, spec);
}

// The same for a car body centred at (cx, cy), heading h, parked at the right kerb (`right`) or the
// left one of edge e: the car as actually placed, with its jitter, not only its bay.
export function footprintIntrusion(e, cx, cy, h, right, spec = CAR) {
  const inner = right ? e.asphalt[1] - e.parking[1] : e.asphalt[0] + e.parking[0];
  const cosine = Math.cos(h),
    sine = Math.sin(h);
  let worst = -Infinity;
  for (const [a, b] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const x = cx + (cosine * a * spec.length) / 2 + (sine * b * spec.width) / 2;
    const y = cy + (sine * a * spec.length) / 2 - (cosine * b * spec.width) / 2;
    const q = projectPoint(e.pts, e.cum, [x, y]);
    worst = Math.max(worst, right ? inner - q.lateral : q.lateral - inner);
  }
  return worst;
}

function parkedCell(car) {
  const [cx, cy] = car.center;
  return `${Math.floor(cx / CELL)},${Math.floor(cy / CELL)}`;
}

export class ParkedCars {
  constructor(map, { seed = 1, density = PARKED_DENSITY, zones = null } = {}) {
    this.map = map;
    this.list = [];
    this.grid = new Map();
    this.removed = []; // pulled out since the renderer last looked
    this.added = [];
    this.slots = [];
    this.activeDoors = [];
    this.random = rng(seed * 65537 + 23);
    this.nextDoor = 8 + this.random() * 10;
    this.zones = zones;
    if (density > 0) this.spawn(seed, density);
    this.added.length = 0;
  }

  spawn(seed, density) {
    const map = this.map;
    const random = rng(seed * 104729 + 7);
    const half = new Map(); // node -> half width of the widest street there
    const halfAt = (node) => {
      if (!half.has(node)) {
        let w = 0;
        for (const id of [...(map.inn.get(node) || []), ...(map.out.get(node) || [])]) {
          const o = map.edges.get(id);
          if (!o) continue;
          w = Math.max(w, Math.abs(o.asphalt[0]), Math.abs(o.asphalt[1]));
        }
        half.set(node, w);
      }
      return half.get(node);
    };
    const junction = (node) => {
      const neighbors = new Set();
      for (const id of [...(map.inn.get(node) || []), ...(map.out.get(node) || [])]) {
        const o = map.edges.get(id);
        if (o) neighbors.add(o.from === node ? o.to : o.from);
      }
      return neighbors.size >= 3;
    };
    let serial = this.list.length;
    for (const e of map.edges.values()) {
      if (!e.parking || e.ring) continue;
      const L = e.cum[e.cum.length - 1];
      if (!Number.isFinite(L) || L < SLOT_M) continue;
      const from = (junction(e.from) ? halfAt(e.from) : 0) + CORNER_CLEAR_M;
      let to = L - (junction(e.to) ? halfAt(e.to) : 0) - CORNER_CLEAR_M;
      if (e.control) to = Math.min(to, e.control.s_line - LINE_CLEAR_M);
      // the right curb of this direction; on a one-way street the left curb too (a two-way street's
      // left curb is its twin's right curb)
      const sides = [];
      if (e.parking[1] > 0) sides.push(e.asphalt[1] - e.parking[1] / 2 - 0.05);
      if (e.oneway && e.parking[0] > 0) sides.push(e.asphalt[0] + e.parking[0] / 2 + 0.05);
      for (const lat of sides) {
        const zones = lat > 0 ? this.zones?.get(e.id) : null;
        for (let s = from + SLOT_M / 2; s + SLOT_M / 2 <= to; s += SLOT_M) {
          if (zones?.some(([a, b]) => s + SLOT_M / 2 > a && s - SLOT_M / 2 < b)) continue;
          // (a bay on the inside of a tight bend is left out; its draws are still made, and its car's
          // number used, so every other bay keeps the car it had)
          if (bayIntrusion(e, s, lat) > BEND_INTRUSION_M) {
            if (random() <= density) {
              for (let k = 0; k < 6; k++) random();
              serial++;
            }
            continue;
          }
          const pSlot = pointAt(e.pts, e.cum, s),
            hSlot = headingAt(e.pts, e.cum, s);
          const slot = {
            edge: e.id,
            curb: lat > 0 ? "right" : "left",
            occupant: null,
            reserved: null,
            x: pSlot[0] + Math.sin(hSlot) * lat - Math.cos(hSlot) * PARKED_REAR_AXLE_OFFSET,
            y: pSlot[1] - Math.cos(hSlot) * lat - Math.sin(hSlot) * PARKED_REAR_AXLE_OFFSET,
            psi: hSlot,
          };
          this.slots.push(slot);
          if (random() > density) continue;
          const jitter = (random() - 0.5) * 1.2;
          const sc = s + jitter; // car center along the edge
          const p = pointAt(e.pts, e.cum, sc),
            h = headingAt(e.pts, e.cum, sc);
          const cx = p[0] + Math.sin(h) * (lat + (random() - 0.5) * 0.2);
          const cy = p[1] - Math.cos(h) * (lat + (random() - 0.5) * 0.2);
          const psi = h + (random() - 0.5) * 0.04;
          // (nor is a car whose jittered body would reach that far in: the bay stays empty, and the car
          // still makes its draws and uses its number)
          if (footprintIntrusion(e, cx, cy, psi, lat > 0) > BEND_INTRUSION_M) {
            random();
            random();
            serial++;
            continue;
          }
          // Vehicle positions are at the rear axle
          const car = new Vehicle(
            cx - Math.cos(psi) * PARKED_REAR_AXLE_OFFSET,
            cy - Math.sin(psi) * PARKED_REAR_AXLE_OFFSET,
            psi,
            0,
          );
          car.id = `parked_${++serial}`;
          car.parked = true;
          car.color = PALETTE[Math.floor(random() * PALETTE.length)];
          car.style = Math.floor(random() * 8);
          car.edge = e.id;
          car.curb = lat > 0 ? "right" : "left";
          car.slot = slot;
          this.add(car);
        }
      }
    }
  }

  add(car) {
    if (this.list.includes(car)) return;
    const [x, y] = car?.center ?? [];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError("Parked car requires a finite center");
    const key = parkedCell(car);
    const cell = this.grid.get(key);
    car.parked = true;
    if (car.slot) {
      car.slot.occupant = car;
      car.slot.reserved = null;
    }
    this.list.push(car);
    this.added.push(car);
    if (cell) cell.push(car);
    else this.grid.set(key, [car]);
  }

  // Take a car out of the parking lane (it is pulling out). `removed` tells the renderer.
  remove(car) {
    if (!car || car.door) return false;
    const i = this.list.indexOf(car);
    if (i < 0) return false;
    this.list.splice(i, 1);
    const key = parkedCell(car);
    if (!this.removeFromCell(car, key)) {
      // Recover if an authored scenario moved the parked axle without updating the index.
      for (const other of this.grid.keys()) if (this.removeFromCell(car, other)) break;
    }
    this.removed.push(car);
    if (car.slot?.occupant === car) car.slot.occupant = null;
    return true;
  }

  removeFromCell(car, key) {
    const cell = this.grid.get(key);
    const index = cell?.indexOf(car) ?? -1;
    if (index < 0) return false;
    if (cell.length === 1) this.grid.delete(key);
    else cell.splice(index, 1);
    return true;
  }

  // The street-side front door swings backward from its hinge. Its OBB is the same panel drawn
  // by the renderer, rather than an inflated whole-car box.
  openDoor(car, { duration = OPEN_DOOR_S } = {}) {
    if (!car?.parked || car.door || !this.list.includes(car)) return null;
    if (!Number.isFinite(duration) || duration <= 0) throw new RangeError("Invalid door event duration");
    const door = {
      id: `${car.id}_door`,
      kind: "door",
      owner: car,
      t: 0,
      angle: 0,
      ...(duration !== OPEN_DOOR_S ? { duration } : {}),
      v: 0,
      spec: { length: 1.1, width: 0.12, rearOverhang: 0.55 },
      get center() {
        return [this.x, this.y];
      },
      obb() {
        return { center: [this.x, this.y], heading: this.psi, halfLength: 0.55, halfWidth: 0.06 };
      },
    };
    car.door = door;
    this.activeDoors.push(door);
    this.poseDoor(door);
    return door;
  }

  poseDoor(door) {
    const car = door.owner,
      side = car.curb === "right" ? -1 : 1;
    door.angle =
      (Math.PI / 3) * Math.min(1, door.t / 0.8, Math.max(0, ((door.duration ?? OPEN_DOOR_S) - door.t) / 0.8));
    const c = Math.cos(car.psi),
      s = Math.sin(car.psi);
    const hx = car.x + c * 2.1 + ((s * car.spec.width) / 2) * side;
    const hy = car.y + s * 2.1 - ((c * car.spec.width) / 2) * side;
    door.psi = car.psi + side * door.angle;
    door.x = hx - Math.cos(door.psi) * 0.55;
    door.y = hy - Math.sin(door.psi) * 0.55;
  }

  step(dt, world) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Invalid parked car step duration");
    if (dt === 0) return;
    // Compact in place, retaining the order in which visible doors were opened.
    let keep = 0;
    for (const door of this.activeDoors) {
      door.t += dt;
      this.poseDoor(door);
      if (door.t >= (door.duration ?? OPEN_DOOR_S)) {
        if (door.owner.door === door) door.owner.door = null;
      } else this.activeDoors[keep++] = door;
    }
    this.activeDoors.length = keep;
    this.nextDoor -= dt;
    if (this.nextDoor > 0) return;
    this.nextDoor = 12 + this.random() * 16;
    const ego = world.ego;
    const stoppingRoom = (ego.v * ego.v) / (2 * 4) + ego.v * 1.5 + 5;
    const minimumAhead = Math.max(15, stoppingRoom);
    if (minimumAhead >= 40) return;
    const nearby = this.near(ego.x, ego.y, 45).filter((c) => {
      if (c.door || c.stay) return false;
      const l = ego.toLocal(c.x, c.y);
      return l.ahead > minimumAhead && l.ahead < 40 && Math.abs(l.right) < 7;
    });
    if (nearby.length) this.openDoor(nearby[Math.floor(this.random() * nearby.length)]);
  }

  doorsNear(x, y, r) {
    return this.activeDoors.filter((d) => d.angle > 0.02 && Math.hypot(d.x - x, d.y - y) < r);
  }

  // Move parked car `car` (its rear axle) to (x, y), keeping the grid in step (snowbanks push the cars
  // parked in a narrowing out from the kerb: sim/snowbanks.js).
  move(car, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError("Parked car requires a finite destination");
    const before = parkedCell(car);
    if (!this.grid.get(before)?.includes(car)) return;
    car.x = x;
    car.y = y;
    if (car.door) this.poseDoor(car.door);
    const after = parkedCell(car);
    if (after === before) return;
    this.removeFromCell(car, before);
    if (!this.grid.has(after)) this.grid.set(after, []);
    this.grid.get(after).push(car);
  }

  // Parked cars whose center lies within `r` meters of (x, y).
  near(x, y, r) {
    const out = [];
    if (!Number.isFinite(r) || r < 0) return out;
    const c0 = Math.floor((x - r) / CELL),
      c1 = Math.floor((x + r) / CELL);
    const d0 = Math.floor((y - r) / CELL),
      d1 = Math.floor((y + r) / CELL);
    if (
      !Number.isSafeInteger(c0) ||
      !Number.isSafeInteger(c1) ||
      !Number.isSafeInteger(d0) ||
      !Number.isSafeInteger(d1)
    )
      return out;
    const radius2 = r * r;
    // A map-wide query should scale with populated cells and preserve the normal scan order.
    if ((c1 - c0 + 1) * (d1 - d0 + 1) > this.grid.size + 64) {
      const cells = [];
      for (const [key, cell] of this.grid) {
        const [i, j] = key.split(",").map(Number);
        if (i >= c0 && i <= c1 && j >= d0 && j <= d1) cells.push({ i, j, cell });
      }
      cells.sort((a, b) => a.i - b.i || a.j - b.j);
      for (const { cell } of cells) for (const car of cell) if (nearbyCenter(car, x, y, radius2)) out.push(car);
      return out;
    }
    for (let i = c0; i <= c1; i++)
      for (let j = d0; j <= d1; j++) {
        const cell = this.grid.get(`${i},${j}`);
        if (!cell) continue;
        for (const car of cell) if (nearbyCenter(car, x, y, radius2)) out.push(car);
      }
    return out;
  }
}
