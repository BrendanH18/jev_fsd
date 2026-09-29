// Parked cars along the curbs of streets with parking lanes. They are real obstacles: the ego, the
// traffic, and every candidate forward-simulation can hit them. Cars open street-side doors,
// pull out into traffic, and park in vacant bays (see NpcFleet). Placement is seeded, so a
// scenario always has the same cars in the same spots.

import { Vehicle, CAR } from "./vehicle.js";
import { pointAt, headingAt } from "../map/mapdata.js";
import { rng } from "../common.js";

const SLOT_M = 6.4;            // curb length per parked car
const CORNER_CLEAR_M = 5.0;    // no parking this close to the crossing street's curb
const LINE_CLEAR_M = 6.0;      // nor this close before a stop line or yield line
const CELL = 25;
// Real-world paint mix, as for the traffic.
const PALETTE = [0xeeeeea, 0x8d9299, 0x1a1c20, 0xc4c8cc, 0x2b3a55, 0x9b1e1e, 0xf2f2ee, 0x4a4f57, 0x0f1114, 0x6b7f5e, 0xb9b3a5, 0x6e5a44];

export const PARKED_DENSITY = 0.5;

export class ParkedCars {
  constructor(map, { seed = 1, density = PARKED_DENSITY } = {}) {
    this.map = map;
    this.list = [];
    this.grid = new Map();
    this.removed = [];   // pulled out since the renderer last looked
    this.added = [];
    this.slots = [];
    this.activeDoors = [];
    this.random = rng(seed * 65537 + 23);
    this.nextDoor = 8 + this.random() * 10;
    if (density > 0) this.spawn(seed, density);
    this.added.length = 0;
  }

  spawn(seed, density) {
    const map = this.map;
    const random = rng(seed * 104729 + 7);
    const half = new Map();   // node -> half width of the widest street there
    const halfAt = (node) => {
      if (!half.has(node)) {
        let w = 0;
        for (const id of [...(map.inn.get(node) || []), ...(map.out.get(node) || [])]) {
          const o = map.edges.get(id);
          w = Math.max(w, Math.abs(o.asphalt[0]), Math.abs(o.asphalt[1]));
        }
        half.set(node, w);
      }
      return half.get(node);
    };
    const junction = (node) => new Set([...(map.inn.get(node) || []), ...(map.out.get(node) || [])].map((id) => {
      const o = map.edges.get(id); return o.from === node ? o.to : o.from;
    })).size >= 3;
    for (const e of map.edges.values()) {
      if (!e.parking || e.ring) continue;
      const L = e.cum[e.cum.length - 1];
      const from = (junction(e.from) ? halfAt(e.from) : 0) + CORNER_CLEAR_M;
      let to = L - (junction(e.to) ? halfAt(e.to) : 0) - CORNER_CLEAR_M;
      if (e.control) to = Math.min(to, e.control.s_line - LINE_CLEAR_M);
      // the right curb of this direction; on a one-way street the left curb too (a two-way street's
      // left curb is its twin's right curb)
      const sides = [];
      if (e.parking[1] > 0) sides.push(e.asphalt[1] - e.parking[1] / 2 - 0.05);
      if (e.oneway && e.parking[0] > 0) sides.push(e.asphalt[0] + e.parking[0] / 2 + 0.05);
      for (const lat of sides) {
        for (let s = from + SLOT_M / 2; s + SLOT_M / 2 <= to; s += SLOT_M) {
          const pSlot = pointAt(e.pts, e.cum, s), hSlot = headingAt(e.pts, e.cum, s);
          const backSlot = CAR.length / 2 - CAR.rearOverhang;
          const slot = { edge: e.id, curb: lat > 0 ? "right" : "left", occupant: null, reserved: null,
            x: pSlot[0] + Math.sin(hSlot) * lat - Math.cos(hSlot) * backSlot,
            y: pSlot[1] - Math.cos(hSlot) * lat - Math.sin(hSlot) * backSlot, psi: hSlot };
          this.slots.push(slot);
          if (random() > density) continue;
          const jitter = (random() - 0.5) * 1.2;
          const sc = s + jitter;   // car center along the edge
          const p = pointAt(e.pts, e.cum, sc), h = headingAt(e.pts, e.cum, sc);
          const cx = p[0] + Math.sin(h) * (lat + (random() - 0.5) * 0.2);
          const cy = p[1] - Math.cos(h) * (lat + (random() - 0.5) * 0.2);
          const psi = h + (random() - 0.5) * 0.04;
          // Vehicle positions are at the rear axle
          const back = CAR.length / 2 - CAR.rearOverhang;
          const car = new Vehicle(cx - Math.cos(psi) * back, cy - Math.sin(psi) * back, psi, 0);
          car.id = `parked_${this.list.length + 1}`;
          car.parked = true;
          car.color = PALETTE[Math.floor(random() * PALETTE.length)];
          car.style = Math.floor(random() * 5);
          car.edge = e.id;
          car.curb = lat > 0 ? "right" : "left";
          car.slot = slot;
          this.add(car);
        }
      }
    }
  }

  add(car) {
    car.parked = true;
    if (car.slot) { car.slot.occupant = car; car.slot.reserved = null; }
    this.list.push(car);
    this.added.push(car);
    const [cx, cy] = car.center;
    const key = `${Math.floor(cx / CELL)},${Math.floor(cy / CELL)}`;
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push(car);
  }

  // Take a car out of the parking lane (it is pulling out). `removed` tells the renderer.
  remove(car) {
    if (car.door) return false;
    const i = this.list.indexOf(car);
    if (i < 0) return false;
    this.list.splice(i, 1);
    const [cx, cy] = car.center;
    const cell = this.grid.get(`${Math.floor(cx / CELL)},${Math.floor(cy / CELL)}`);
    if (cell) cell.splice(cell.indexOf(car), 1);
    this.removed.push(car);
    if (car.slot) car.slot.occupant = null;
    return true;
  }

  // The street-side front door swings backward from its hinge. Its OBB is the same panel drawn
  // by the renderer, rather than an inflated whole-car box.
  openDoor(car) {
    if (!car.parked || car.door || !this.list.includes(car)) return null;
    const door = { id: `${car.id}_door`, kind: "door", owner: car, t: 0, angle: 0, v: 0,
      spec: { length: 1.1, width: 0.12, rearOverhang: 0.55 },
      get center() { return [this.x, this.y]; },
      obb() { return { center: [this.x, this.y], heading: this.psi, halfLength: 0.55, halfWidth: 0.06 }; } };
    car.door = door;
    this.activeDoors.push(door);
    this.poseDoor(door);
    return door;
  }

  poseDoor(door) {
    const car = door.owner, side = car.curb === "right" ? -1 : 1;
    door.angle = Math.PI / 3 * Math.min(1, door.t / 0.8, Math.max(0, (6 - door.t) / 0.8));
    const hx = car.x + Math.cos(car.psi) * 2.1 + Math.sin(car.psi) * CAR.width / 2 * side;
    const hy = car.y + Math.sin(car.psi) * 2.1 - Math.cos(car.psi) * CAR.width / 2 * side;
    door.psi = car.psi + side * door.angle;
    door.x = hx - Math.cos(door.psi) * 0.55;
    door.y = hy - Math.sin(door.psi) * 0.55;
  }

  step(dt, world) {
    for (const door of [...this.activeDoors]) {
      door.t += dt;
      this.poseDoor(door);
      if (door.t >= 6) { door.owner.door = null; this.activeDoors.splice(this.activeDoors.indexOf(door), 1); }
    }
    this.nextDoor -= dt;
    if (this.nextDoor > 0) return;
    this.nextDoor = 12 + this.random() * 16;
    const nearby = this.near(world.ego.x, world.ego.y, 45).filter((c) => {
      const l = world.ego.toLocal(c.x, c.y);
      const stoppingRoom = world.ego.v * world.ego.v / (2 * 4) + world.ego.v * 1.5 + 5;
      return !c.door && l.ahead > Math.max(15, stoppingRoom) && l.ahead < 40 && Math.abs(l.right) < 7;
    });
    if (nearby.length) this.openDoor(nearby[Math.floor(this.random() * nearby.length)]);
  }

  doorsNear(x, y, r) {
    return this.activeDoors.filter((d) => d.angle > 0.02 && Math.hypot(d.x - x, d.y - y) < r);
  }

  // Parked cars whose center lies within `r` meters of (x, y).
  near(x, y, r) {
    const out = [];
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
    const d0 = Math.floor((y - r) / CELL), d1 = Math.floor((y + r) / CELL);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
      const cell = this.grid.get(`${i},${j}`);
      if (!cell) continue;
      for (const car of cell) {
        const [cx, cy] = car.center;
        if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) out.push(car);
      }
    }
    return out;
  }
}
