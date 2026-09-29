// Parked cars along the curbs of streets with parking lanes. They are real obstacles: the ego, the
// traffic, and every candidate forward-simulation can hit them. Now and then one pulls out into
// traffic (see NpcFleet.maybePullOut), leaving the parking lane for good. Placement is seeded, so a
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
    if (density > 0) this.spawn(seed, density);
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
          this.add(car);
        }
      }
    }
  }

  add(car) {
    this.list.push(car);
    const [cx, cy] = car.center;
    const key = `${Math.floor(cx / CELL)},${Math.floor(cy / CELL)}`;
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push(car);
  }

  // Take a car out of the parking lane (it is pulling out). `removed` tells the renderer.
  remove(car) {
    const i = this.list.indexOf(car);
    if (i < 0) return false;
    this.list.splice(i, 1);
    const [cx, cy] = car.center;
    const cell = this.grid.get(`${Math.floor(cx / CELL)},${Math.floor(cy / CELL)}`);
    if (cell) cell.splice(cell.indexOf(car), 1);
    this.removed.push(car);
    return true;
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
