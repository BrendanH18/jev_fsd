// Hidden hazards: cars parked at the kerb hide the people behind them, and now and then someone steps
// out from between two of them into the street, unseen until they come out.
//
// Driver's handbooks across Canada say the same: on residential streets and in school and playground
// zones, watch for children and others stepping out from between parked cars, and drive at a speed you
// can stop from. Here, with the World option `hazards`, a standing vehicle at the kerb (a parked car, a
// van double-parked or stopped at the roadside) hides a pedestrian from the driven car as moving
// traffic already does (sim/crosswalk.js hiddenByTraffic): sensing is in plan view, so a body hides
// whatever is behind it, whatever its height.
//
// A blind spot (`blindSpot`) is a vehicle standing at the kerb ahead of the car, parallel to it, whose
// traffic side is within BLIND_GAP_M of the car's side, on a quiet street (residential, unclassified or
// a living street) or in a school or playground zone in effect: someone stepping out from behind it
// would be in the car's path straight away. Beside one the car keeps to the blind-spot speed
// (`blindSpeed`): the speed from which, after BLIND_REACT_S, braking at BLIND_BRAKE of the hardest the
// road allows (sim/vehicle.js comfort().hardDecel, so it follows the weather), it stops BLIND_MARGIN_M
// short of where someone who steps out STEP_OUT_M ahead of its front would cross. About 32 km/h on a
// dry road, 27 in rain, 19 in snow. Nobody steps out further ahead than that, so it slows to it gently
// by the time its front is STEP_OUT_M short of the first such vehicle, and keeps to it until none is
// left within that distance (through a gap between parked cars shorter than that, too).
//
// Step-outs (`StepOuts`): in a free drive, now and then, someone (a child more often than not) stands
// hidden between two cars parked along the car's side of a quiet street, PLACE_M ahead of it. Once the
// car's front is STEP_OUT_M from their line they step out and walk across the street without looking (`dart`),
// unless something else is on the street ahead of the car or coming the other way, in which case they
// stay put and go home unseen. Across the street they walk on along the far sidewalk with the crowd.
// The driven car only sees them once they come out from behind the cars: at the blind-spot speed it
// stops short of them, at 50 km/h it cannot. `?hazards=0` turns all of this off; the seeded benchmark
// and the challenges other than "Between the cars" never have it.

import { CAR } from "./vehicle.js";
import { projectPoint, pointAt, headingAt } from "../map/mapdata.js";
import { sidewalkOffset } from "../map/streets.js";
import { rng } from "../common.js";
import { Pedestrian } from "./pedestrians.js";

export { STEP_OUT_M, BLIND_REACT_S, BLIND_BRAKE, BLIND_MARGIN_M, BLIND_GAP_M, BLIND_LOOK_M, BLIND_APPROACH, BLIND_LEAD_M, QUIET, blindSpeed, blindApproach, standingNear, blindSpot } from "./blind-spot.js";
import { STEP_OUT_M, BLIND_GAP_M, QUIET, blindSpot } from "./blind-spot.js";
const PARALLEL = Math.PI / 6;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Free drive: how many step-outs wait at a time, when the first comes and how often the next, where
// someone stands, how long they wait, how fast they go, and how far ahead of the line the street must be
// clear for them to go.
export const STEP_OUT_COUNT = 1;
const FIRST_S = [20, 60];
const EVERY_S = [60, 150];
const RETRY_S = 3;
const PLACE_M = [35, 70];
const GAP_M = [0.9, 3.5];
const HIDE_IN_M = 0.6;               // they stand this far in from the parked cars' traffic side
const GIVE_UP_S = 40;
const CLEAR_PAST_M = 45;             // nobody else on the street ahead of the car up to this far past their line
const STREET_M = 9;
const LATE_M = 6;                    // the car's front already this much nearer than STEP_OUT_M: too late, they wait

export class StepOuts {
  constructor(world, { count = 0, seed = 1 } = {}) {
    this.world = world;
    this.count = count;
    this.people = [];
    this.made = 0;
    this.random = count > 0 ? rng(seed * 6007 + 71) : null;
    this.wait = count > 0 ? FIRST_S[0] + this.random() * (FIRST_S[1] - FIRST_S[0]) : Infinity;
  }

  step(dt) {
    if (!this.count) return;
    const { world } = this, ego = world.ego, FRONT = ego.spec.length - ego.spec.rearOverhang;
    for (const p of [...this.people]) {
      const ped = p.ped;
      if (p.state === "waiting") {
        const local = ego.toLocal(ped.x, ped.y), toLine = local.ahead - FRONT;
        const toward = Math.abs(wrap(ego.psi - p.psi)) < PARALLEL && Math.abs(local.right) < STREET_M;
        if (toward && toLine <= STEP_OUT_M && toLine > STEP_OUT_M - LATE_M) {
          if (this.clear(ped, toLine)) this.release(p);
          else p.state = "gone";
        } else if (!toward || toLine <= STEP_OUT_M - LATE_M || world.t - p.since > GIVE_UP_S) p.state = "gone";
      }
      // (once across, they are one of the crowd; one who stayed put goes home once out of sight)
      if (p.state === "out" && !ped.crossing) this.people.splice(this.people.indexOf(p), 1);
      else if (p.state === "gone" && !world.sees(ego, ped)) {
        this.people.splice(this.people.indexOf(p), 1);
        const i = world.crowd.list.indexOf(ped);
        if (i >= 0) world.crowd.list.splice(i, 1);
      }
    }
    this.wait -= dt;
    if (this.wait > 0 || this.people.length >= this.count) return;
    this.wait = this.place() ? EVERY_S[0] + this.random() * (EVERY_S[1] - EVERY_S[0]) : RETRY_S;
  }

  // Nothing else is on the street ahead of the car up to CLEAR_PAST_M past their line: no vehicle in
  // traffic (or cyclist) going either way that could meet them.
  clear(ped, toLine) {
    const ego = this.world.ego, FRONT = ego.spec.length - ego.spec.rearOverhang;
    return !this.world.npcs.some((n) => {
      const l = ego.toLocal(n.x, n.y);
      return Math.abs(l.right) < STREET_M && l.ahead > 0 && l.ahead < FRONT + toLine + CLEAR_PAST_M;
    });
  }

  release(p) {
    const ped = p.ped;
    ped.held = false;
    ped.crossing = ped.path[0].cross;
    p.state = "out";
  }

  // Someone hidden between two cars parked along the car's side of the quiet street it is on, PLACE_M
  // ahead of its front. True if placed.
  place() {
    const { world } = this, ego = world.ego, map = world.map, random = this.random;
    const FRONT = ego.spec.length - ego.spec.rearOverhang;
    const near = map.nearestLane(ego.x, ego.y, ego.psi, 6);
    const e = near?.lane.edgeRef;
    if (!e || e.ring || (!QUIET.has(e.cls) && !world._road?.zone)) return false;
    // the parked cars along the car's side, in order along its way
    const rows = { 1: [], [-1]: [] }, twin = twinOf(map, e)?.id;
    for (const c of world.parked.near(ego.x, ego.y, PLACE_M[1] + FRONT + 12)) {
      if (c.roadside || c.workzone || c.doubleParked || (c.edge !== e.id && c.edge !== twin)) continue;
      const d = Math.abs(wrap(c.psi - ego.psi));
      if (d > PARALLEL && d < Math.PI - PARALLEL) continue;
      const [cx, cy] = c.center, l = ego.toLocal(cx, cy), cs = c.spec || CAR;
      const gap = Math.abs(l.right) - cs.width / 2 - ego.spec.width / 2;
      if (gap < 0 || gap > BLIND_GAP_M) continue;
      rows[Math.sign(l.right) || 1].push({ c, ahead: l.ahead, right: l.right, half: cs.length / 2, width: cs.width });
    }
    const gaps = [];
    for (const side of [1, -1]) {
      const row = rows[side].sort((a, b) => a.ahead - b.ahead);
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i], b = row[i + 1], g = (b.ahead - b.half) - (a.ahead + a.half);
        if (g < GAP_M[0] || g > GAP_M[1] || Math.abs(a.right - b.right) > 0.6) continue;
        const ahead = (a.ahead + a.half + b.ahead - b.half) / 2;
        if (ahead - FRONT < PLACE_M[0] || ahead - FRONT > PLACE_M[1]) continue;
        const outer = Math.min(Math.abs(a.right) - a.width / 2, Math.abs(b.right) - b.width / 2);
        gaps.push({ side, ahead, right: side * (outer + HIDE_IN_M) });
      }
    }
    if (!gaps.length) return false;
    const pick = gaps[Math.floor(random() * gaps.length)];
    const c = Math.cos(ego.psi), s = Math.sin(ego.psi);
    const x = ego.x + c * pick.ahead + s * pick.right, y = ego.y + s * pick.ahead - c * pick.right;
    // across the street, to just past the far kerb, then onto the sidewalk there
    const pr = projectPoint(e.pts, e.cum, [x, y]);
    const lat = pr.lateral, farSide = lat > 0 ? -1 : 1;
    const to = offset(e, pr.s, farSide < 0 ? e.asphalt[0] - 0.4 : e.asphalt[1] + 0.4);
    const walk = offset(e, pr.s, sidewalkOffset(e, farSide));
    const child = random() < 0.6;
    const ped = new Pedestrian({ id: `stepout_${++this.made}`, x, y, psi: Math.atan2(to[1] - y, to[0] - x), v: 0,
      speed: child ? 1.4 + random() * 0.5 : 1.3 + random() * 0.5, child, dart: true, stepOut: true, held: true,
      path: [{ p: to, cross: { node: null, from: [x, y], to, jaywalk: true, stepOut: true } }, { p: walk }],
      crossing: null, waiting: 0, phase: 0, look: Math.floor(random() * 1e6), at: null });
    if (world.sees(ego, ped)) return false;
    // then on along the far sidewalk with the crowd (or, where it does not know the street, home)
    const st = world.crowd.streetOf?.(e);
    if (st) {
      const flip = st.edge !== e, sAlong = flip ? st.edge.cum.at(-1) - pr.s : pr.s;
      ped.then = { st, side: flip ? -farSide : farSide, s: sAlong, dir: random() < 0.5 ? 1 : -1 };
    } else ped.home = true;
    world.crowd.list.push(ped);
    this.people.push({ ped, psi: ego.psi, since: world.t, state: "waiting" });
    return true;
  }

}

function twinOf(map, e) {
  return (map.out.get(e.to) || []).map((id) => map.edges.get(id)).find((x) => x.to === e.from && Math.abs(x.length - e.length) < 1);
}

function offset(e, s, lat) {
  const p = pointAt(e.pts, e.cum, s), h = headingAt(e.pts, e.cum, s);
  return [p[0] + Math.sin(h) * lat, p[1] - Math.cos(h) * lat];
}

// What the HUD says (once each): someone stepping out from between parked cars (`stepOut`) in sight, or a
// blind spot coming up and the speed to keep to beside it. { key, text, wait } or null.
export function hazardNotice(world) {
  if (!world.hazards) return null;
  const out = world.crowd.list.find((p) => p.stepOut && p.crossing && world.sees(world.ego, p));
  if (out) return { key: `out:${out.id}`, text: `${out.child ? "CHILD" : "PERSON"} STEPPING OUT FROM THE PARKED CARS · STOP`, wait: true };
  const bs = blindSpot(world);
  if (bs && bs.from_m < STEP_OUT_M + 15) return { key: `blind:${bs.edge}:${bs.side}`, text: `PARKED CARS HIDE THE SIDEWALK · ${Math.round(bs.limit_mps * 3.6)} KM/H`, wait: false };
  return null;
}
