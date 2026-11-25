import { r1, rng } from "../../common.js";
import { pointAt, headingAt, projectPoint } from "../../map/mapdata.js";
import { Vehicle, SNOW_PLOW } from "../vehicle.js";
import { StopMemory } from "../signals.js";
import { current as weather } from "../weather.js";
import { wrap } from "../world.js";
import {
  NEXT_LANE_M,
  SAME_LANE_M,
  PASS_SIGHT_M,
  PLOW_LOOK_M,
  PLOW_NAME,
  PLOW_CLASSES,
  PLOW_COLOR,
  PLOW_COUNT,
  PLOW_EVERY_S,
  PLOW_GONE_M,
  PLOW_MPS,
  PLOW_SPAWN_M,
  egoPlow,
  isPlow,
  plowLanes,
  plowNotice,
  plowRelation,
  stayBack,
  turningLeft,
} from "../snow-plow.js";

// Passing a snow plow, the car's route ahead must be in view as far as it looks for that (the 60 m of
// `clear_path_m`).
const PASS_CLEAR_M = 60;
// Inside the stay-back distance behind a snow plow, a manoeuvre may not end up closer to it than now,
// give or take this.
const PLOW_CLOSING_M = 0.05;
// Snow plows (sim/snow-plow.js): the car passes one when its centre draws level with the plow's,
// going its way in the lane beside it. On its right (the plow not turning left), that is passing it on
// the right, counted once a pass. Having passed one on the left, moving back into its lane with its
// rear less than the stay-back distance, less AUDIT_CUT_SLACK_M, ahead of the plow's front is cutting
// in front of it (an event for coaching, once a pass).
const AUDIT_PLOW_M = 40;
const AUDIT_CUT_SLACK_M = 3;
// Closer than the stay-back distance less this, moving, behind a snow plow the car must stay back of,
// is following it too closely (sim/snow-plow.js).
const PLOW_CLOSE_SLACK_M = 10;

class Plows {
  constructor(fleet, count, seed, makePath) {
    this.fleet = fleet;
    this.world = fleet.world;
    this.map = fleet.map;
    this.makePath = makePath;
    this.plowStream = rng(seed * 179424673 + 29);
    this.plowCount = 0;
    this.plowTarget = count;
    this.nextPlow = this.world.t;
    this.plows = [];
  }

  // Snow plows (sim/snow-plow.js): one out of the car's sight PLOW_GONE_M away is taken off, and while
  // it snows another is put down when there are too few.
  managePlows() {
    const world = this.world,
      ego = world.ego;
    for (const n of this.fleet.vehicles.filter(isPlow)) {
      if (Math.hypot(n.x - ego.x, n.y - ego.y) <= PLOW_GONE_M || world.visibility.canSee(ego, n.x, n.y)) continue;
      this.fleet.vehicles.splice(this.fleet.vehicles.indexOf(n), 1);
      this.nextPlow = Math.max(
        this.nextPlow,
        world.t + PLOW_EVERY_S[0] + this.plowStream() * (PLOW_EVERY_S[1] - PLOW_EVERY_S[0]),
      );
    }
    this.plows = this.fleet.vehicles.filter(isPlow);
    if (this.plows.length < this.plowTarget && world.t >= this.nextPlow && weather.name === "snow") {
      if (!this.spawnPlow()) this.nextPlow = world.t + 5;
      else this.nextPlow = world.t + PLOW_EVERY_S[0];
    }
  }

  // Put a snow plow down on a lane of a main street PLOW_SPAWN_M from the car, out of its sight and
  // clear of other traffic, driving on at its clearing speed. Returns it, or null.
  spawnPlow() {
    const world = this.world,
      ego = world.ego,
      lanes = plowLanes(this.map),
      random = this.plowStream;
    const total = lanes.reduce((a, l) => a + l.length, 0);
    for (let attempt = 0; lanes.length && attempt < 40; attempt++) {
      let pick = random() * total,
        lane = lanes[0];
      for (const l of lanes) {
        pick -= l.length;
        if (pick <= 0) {
          lane = l;
          break;
        }
      }
      const s = 5 + random() * (lane.length - 20),
        p = pointAt(lane.pts, lane.cum, s),
        d = Math.hypot(p[0] - ego.x, p[1] - ego.y);
      if (d < PLOW_SPAWN_M[0] || d > PLOW_SPAWN_M[1] || world.visibility.canSee(ego, p[0], p[1])) continue;
      if (
        this.fleet.vehicles.some((v) => Math.hypot(v.x - p[0], v.y - p[1]) < SNOW_PLOW.length + 8) ||
        this.fleet.spawnBlocked(p[0], p[1])
      )
        continue;
      return this.addPlow(lane, s, Math.min(PLOW_MPS, lane.edgeRef.limit));
    }
    return null;
  }

  // A snow plow on `lane`, its rear axle `s` along it, at `v`, driving on as traffic (`planned`: the
  // edges it takes next, before it picks its own turns).
  addPlow(lane, s, v = 0, planned = []) {
    const p = pointAt(lane.pts, lane.cum, s),
      plow = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), v, SNOW_PLOW);
    Object.assign(plow, {
      id: `plow_${++this.plowCount}`,
      kind: "snow_plow",
      color: PLOW_COLOR,
      v0: PLOW_MPS,
      beacons: true,
      driver: { aMax: 1.0, b: 1.8, T: 1.8, s0: 3.0, react: 0.8, lcRate: 0 },
      stopMem: new StopMemory(),
      frozen: 0,
      waiting: 0,
    });
    plow.path = this.makePath(this.map, this.plowStream, { classes: PLOW_CLASSES });
    plow.path.start(lane.edge, lane.idx, s, planned);
    this.fleet.vehicles.push(plow);
    this.plows = this.fleet.vehicles.filter(isPlow);
    return plow;
  }

  // A snow plow ahead of driver `n` going its way, out to the stay-back distance (further than it looks
  // for a leader where the limit is over 80 km/h): in the lane it keeps to (`offset`, right of its
  // path); in the lane to its left, not turning left, as the driver stays behind it rather than pass it
  // on the right; and in poor sight in the lane to its right too: no passing it at all.
  // { plow, gap (front to its rear) }, or null.
  plowHold(n, path, front, offset, limit, lookDistance) {
    if (isPlow(n) || n.kind === "bike" || n.transit?.tram || n.pull) return null;
    const sight = this.world.visibility.range >= PASS_SIGHT_M,
      look = Math.max(lookDistance, stayBack(limit) + 10);
    let best = null;
    for (const o of this.plows) {
      if (
        Math.abs(o.x - n.x) > look + 5 ||
        Math.abs(o.y - n.y) > look + 5 ||
        Math.abs(wrap(o.psi - n.psi)) > Math.PI / 4
      )
        continue;
      const p = projectPoint(path.pts, path.cum, [o.x, o.y], null);
      if (!p || p.s <= path.s + 0.5 || p.s > path.s + look) continue;
      const lat = p.lateral - offset;
      if (
        !(Math.abs(lat) < SAME_LANE_M) &&
        !(lat < -SAME_LANE_M && lat > -NEXT_LANE_M && !turningLeft(o)) &&
        !(!sight && lat > SAME_LANE_M && lat < NEXT_LANE_M)
      )
        continue;
      const gap = p.s - front - o.spec.rearOverhang;
      if (gap > -1 && (!best || gap < best.gap)) best = { plow: o, gap: Math.max(0.05, gap) };
    }
    return best;
  }
}

// Passing a snow plow on the right, and cutting back in front of one passed on the left (see
// AUDIT_PLOW_M).
function auditPlows(world) {
  const npcs = world.npcs || [];
  if (!npcs.some(isPlow)) {
    world.plowPass.clear();
    return;
  }
  world.plowsSeen = true;
  const ego = world.ego,
    keep = stayBack(world._road?.limit ?? 11.2);
  for (const n of npcs) {
    if (!isPlow(n)) continue;
    const rel =
      Math.abs(n.x - ego.x) < AUDIT_PLOW_M && Math.abs(n.y - ego.y) < AUDIT_PLOW_M ? plowRelation(ego, n) : null;
    if (!rel) {
      world.plowPass.delete(n.id);
      continue;
    }
    const prev = world.plowPass.get(n.id),
      pass = prev ? { ...prev } : { right: false, left: false, cut: false };
    // (the car's centre drawing level with the plow's, from behind; and the plow getting ahead again
    // starts a new pass)
    if (prev && prev.ahead > 0 && rel.ahead_m <= 0) {
      const beside = Math.abs(rel.right_m) > SAME_LANE_M && Math.abs(rel.right_m) < NEXT_LANE_M;
      if (beside && rel.right_m < 0 && !turningLeft(n) && !pass.right) {
        pass.right = true;
        world.violations.plow_right_passes++;
        world.events.push({ type: "passed_plow_on_right", plow: n.id });
      }
      if (beside && rel.right_m > 0) pass.left = true;
    } else if (prev && prev.ahead <= 0 && rel.ahead_m > 0)
      Object.assign(pass, { right: false, left: false, cut: false });
    if (
      pass.left &&
      !pass.cut &&
      Math.abs(rel.right_m) < SAME_LANE_M &&
      rel.clear_m > -1 &&
      rel.clear_m < keep - AUDIT_CUT_SLACK_M
    ) {
      pass.cut = true;
      world.events.push({ type: "cut_in_front_of_plow", plow: n.id, ahead_m: Math.round(rel.clear_m * 10) / 10 });
    }
    pass.ahead = rel.ahead_m;
    world.plowPass.set(n.id, pass);
  }
}

// A snow plow the car can see going its way (sim/snow-plow.js), in its lane or a lane beside it, from
// PLOW_LOOK_M (or the stay-back distance, where that is further) ahead of it until the car's rear is
// the stay-back distance past its front: the nearest.
// `lane` is where it is from the car: "same", "left" (a lane to the car's left, up to two over) or "right";
// `gap_m` from the car's front to its rear (negative once beside it), `clear_m` from its front to the
// car's rear (positive once the car is wholly past it), `s_rear_route` and `lateral_route` where it is
// along and across the route (right of the route's line, in the frame at the car); `keep_back_m` the
// distance to stay back from it. `holds`: the car must stay back of it, in its lane or in the lane to
// the car's left (never passing it on the right), unless it is turning left, or, short of it, in the lane
// to its right when the car cannot see as far as it ever does (no passing it at all); `may_pass`: the car may
// pass it on the left now: in the car's lane, with a lane to the car's left going its way, the car
// seeing as far as it ever does, and nothing hiding its route ahead as far as it looks (PASS_CLEAR_M, or
// to the end of the route); `passing`: the car is beside it
// or past it on its left. Or null.
function snowPlow(world, p, frontS, lane, limit, clearPath) {
  const { route, ego } = world,
    keep = stayBack(limit),
    look = Math.max(PLOW_LOOK_M, keep),
    sight = world.visibility.range >= PASS_SIGHT_M;
  const inView = clearPath >= Math.min(PASS_CLEAR_M, route.length - p.s);
  let best = null;
  for (const n of world.npcs) {
    if (!isPlow(n) || Math.hypot(n.x - ego.x, n.y - ego.y) > look + 20 || !world.sees(ego, n)) continue;
    const q = route.project(n.x, n.y, p.index);
    if (!q || q.distance > NEXT_LANE_M + 4 || Math.abs(wrap(n.psi - q.heading)) > Math.PI / 4) continue;
    const across = q.lateral + route.frameMove(p.s, q.s),
      side = across - lane.center;
    const where =
      Math.abs(side) < SAME_LANE_M
        ? "same"
        : side < 0 && side > -NEXT_LANE_M
          ? "left"
          : side > 0 && side < NEXT_LANE_M
            ? "right"
            : null;
    const rear = q.s - n.spec.rearOverhang,
      gap = rear - frontS,
      clear = p.s - ego.spec.rearOverhang - (rear + n.spec.length);
    if (!where || gap > look || clear > keep) continue;
    if (best && Math.abs(gap) >= Math.abs(best.gap_m)) continue;
    const turning = turningLeft(n);
    best = {
      id: n.id,
      kind: PLOW_NAME,
      lane: where,
      gap_m: gap,
      clear_m: clear,
      speed: Math.max(0, n.v),
      s_rear_route: rear,
      lateral_route: across,
      keep_back_m: keep,
      turning_left: turning,
      holds:
        (where === "same" || (where === "left" && !turning) || (where === "right" && !sight && gap >= 0)) && clear < 0,
      may_pass: where === "same" && !!route.laneSpan(p.s, lane.delta - 1) && sight && inView,
      passing: where === "right" && gap < 0,
    };
  }
  return best;
}

// A snow plow ahead of the car, or beside it (sim/snow-plow.js).
function plowClause(p) {
  const where = p.lane === "same" ? "in the car's lane" : `in a lane to the car's ${p.lane}`,
    kmh = Math.round(p.speed * 3.6);
  const lead = `A snow plow (\`${p.id}\`), its blue and amber lamps flashing, is clearing the road ${p.gap_m > 0 ? `${Math.round(p.gap_m)} m ahead` : "beside the car"} ${where}, going the car's way at ${kmh} km/h, throwing snow to its right.`;
  const keep = `Stay at least ${p.keep_back_m} m behind it: \`car.target_speed\` already keeps the car back.`;
  if (p.passing)
    return `${lead} The car is passing it on the left: carry on past, and move back into its lane only once the car is ${p.keep_back_m} m ahead of it (the candidates offer that only then).`;
  if (p.lane === "right")
    return p.holds
      ? `${lead} The road ahead cannot be seen clearly enough to pass it: stay behind it, even in this lane. ${keep}`
      : `${lead} The car may pass it on the left, in the lane it is in.`;
  if (p.turning_left) return `${lead} It is signalling a left turn: let it turn.`;
  if (p.lane === "left")
    return `${lead} Never pass a snow plow on the right, the side its blade throws snow and debris: stay behind it in this lane. ${keep}`;
  return `${lead} ${keep} ${p.may_pass ? "Pass it only on the left, through the lane to the car's left (a `change_left_*` candidate, when one is offered), never on the right." : "Do not pass it: the road ahead cannot be seen clearly enough, or there is no lane going the car's way to its left."}`;
}

export default {
  key: "plows",
  property: "plowPass",
  defaultCount: PLOW_COUNT,
  seen: "plowsSeen",
  build: () => new Map(),
  buildFleet: (fleet, { enabled, seed, makePath }) => new Plows(fleet, enabled, seed, makePath),
  snapshot: { snow_plow: null },
  audit: { at: "afterFlagger", run: auditPlows },
  resetContact: (world) => world.plowPass?.clear(),
  metric: {
    at: "vehiclePassing",
    name: "plow_right_passes",
    initial: 0,
    failure: "passed plow on the right",
    label: "Passed a snow plow on the right",
    category: "space",
  },
  obstacle: {
    test: isPlow,
    traffic: true,
    long: true,
    fixedCruise: true,
    noCyclistPass: true,
    noParking: () => true,
    get label() {
      return PLOW_NAME;
    },
  },
  trafficManage: {
    at: "dispatch",
    run(_world, fleet) {
      const { plows } = fleet;
      if (plows.plows.length || plows.plowTarget) plows.managePlows();
    },
  },
  trafficFollowingLeader(fleet, n, path, front, offset, limit, look) {
    if (!fleet.plows.plows.length) return null;
    const hold = fleet.plows.plowHold(n, path, front, offset, limit, look);
    return hold ? { vehicle: hold.plow, gap: hold.gap } : null;
  },
  trafficLeadPolicy(n, leader, limit, standstillGap) {
    if (!isPlow(leader)) return null;
    return { fields: { plow: true }, extraGap: isPlow(n) ? undefined : stayBack(limit) - standstillGap };
  },
  trafficPassingLaneBlocked: (world, n, dir) => n.lead.plow && (dir > 0 || world.visibility.range < PASS_SIGHT_M),
  trafficMergeGap: (vehicle, distance, limit) => (distance < 0 && isPlow(vehicle) ? stayBack(limit) : 0),
  checkpoint(world, fleet) {
    fleet.plows.world = world;
    fleet.plows.fleet = fleet;
  },
  sense: {
    at: "afterParking",
    run(world, snap, { p, frontS, lane, road }) {
      snap.snow_plow = snowPlow(world, p, frontS, lane, road.limit || 11.2, snap.visibility.clear_path_m);
    },
  },
  laneGapBlocked: ({ snow_plow: sp }, side) => sp && side.rear?.id === sp.id && side.rear.gap_m < sp.keep_back_m,
  laneTargetFields(snap, offset) {
    if (snap.snow_plow && snap.snow_plow.lateral_route - offset > SAME_LANE_M) snap.snow_plow = null;
  },
  lanePassBlocked: ({ snow_plow: sp }, side, following) =>
    following.id === sp?.id && (side.dir === "right" || !sp.may_pass),
  hazard: { at: "afterParking", run: (snap) => snap.snow_plow && PLOW_NAME },
  target: {
    at: "beforeCrosswalk",
    run(snap, v, reasons) {
      // a snow plow it must stay back of (sim/snow-plow.js): no closer than the stay-back distance, standing
      // still within a third of it; beside one on its right, drop back behind it
      const sp = snap.snow_plow;
      if (sp?.holds && sp.gap_m < sp.keep_back_m) {
        const stand = sp.keep_back_m / 3;
        const vp =
          sp.gap_m < -1
            ? Math.max(0, sp.speed - 1.5)
            : sp.speed * Math.max(0, Math.min(1, (sp.gap_m - stand) / (sp.keep_back_m - stand)));
        if (vp < v) {
          v = vp;
          reasons.push(
            sp.gap_m < -1 ? `dropping back behind the ${sp.kind}` : `staying ${sp.keep_back_m} m behind the ${sp.kind}`,
          );
        }
      }
      return v;
    },
  },
  sim: {
    at: "afterMerge",
    run({ route }, snap, _predictions, { startS, horizon }) {
      // a snow plow the car must stay back of, still ahead of it (sim/snow-plow.js): no candidate takes the
      // car's front past its rear while the car is in a lane to its right (or, with the plow on its right
      // in poor sight, at all)
      const plow = snap.snow_plow?.holds && snap.snow_plow.gap_m >= 0 ? snap.snow_plow : null;
      const anySide = plow?.lane === "right";
      if (!plow) return null;
      let passesPlow;
      return {
        start() {
          passesPlow = false;
        },
        along(s, FRONT, _car, lateral, t) {
          // (its rear where it will be by then, going on at its speed)
          if (
            plow &&
            s + FRONT > plow.s_rear_route + plow.speed * t + 0.5 &&
            (anySide || lateral + route.frameMove(startS, s) - plow.lateral_route > SAME_LANE_M)
          )
            passesPlow = true;
        },
        reject(c, s, FRONT, lateral) {
          if (c.law.kind === "hard_brake") return null;
          if (passesPlow) return "passes_plow_on_right";
          if (
            (anySide || lateral + route.frameMove(startS, s) - plow.lateral_route > -SAME_LANE_M) &&
            plow.s_rear_route + plow.speed * horizon - (s + FRONT) <
              Math.min(plow.keep_back_m, plow.gap_m - PLOW_CLOSING_M)
          )
            return "follows_plow_too_close";
          return null;
        },
      };
    },
  },
  flagText: {
    passes_plow_on_right: "it passes a snow plow on the right",
    follows_plow_too_close: "it closes in behind a snow plow inside its stay-back distance",
  },
  state: {
    at: "nearbySpecial",
    run(snap, state) {
      if (snap.snow_plow) {
        const p = snap.snow_plow;
        state.snow_plow = {
          id: p.id,
          kind: p.kind,
          lights: "blue and amber, flashing",
          lane: p.lane === "same" ? "the car's lane" : `a lane to the car's ${p.lane}`,
          ...(p.gap_m > 0
            ? { gap_m: r1(p.gap_m) }
            : p.clear_m > 0
              ? { behind_car_m: r1(p.clear_m) }
              : { beside_car: true }),
          speed: r1(p.speed),
          keep_back_m: p.keep_back_m,
          ...(p.turning_left ? { turning_left: true } : {}),
          pass: p.passing
            ? `car is passing it on the left: back in only ${p.keep_back_m} m ahead of it`
            : p.holds && !p.may_pass
              ? "do not pass"
              : "on the left only",
        };
      }
    },
  },
  clause: { at: "afterParking", run: (snap) => snap.snow_plow && plowClause(snap.snow_plow) },
  returnClause: ({ snow_plow: plow }) => (plow?.passing ? `once ${plow.keep_back_m} m ahead of the snow plow, ` : null),
  prompt: {
    at: "nearbySpecial",
    text: `- Behind a snow plow (\`snow_plow\`), keep to \`car.target_speed\`, which keeps the car \`snow_plow.keep_back_m\` back. Never pass one on the right, nor draw level with one on its right: prefer a candidate whose \`end_speed\` is at or below \`car.target_speed\`. Pass one only with a \`change_left_*\` candidate when \`situation\` says the car may, and move back in front of it only when \`situation\` says to.`,
  },
  notice: {
    at: "beforePlow",
    order: 100,
    duration: 2500,
    read: plowNotice,
    style: (line) => (line.wait ? "safety" : ""),
  },
  coach: {
    init: () => ({ plows: false, plowClose: 0, plowCounted: null, plowRightPasses: 0, plowCutIns: 0 }),
    guidance: [
      {
        at: "afterBlindSpeed",
        order: 0,
        read(score, { world, road, speed, dt }) {
          // a snow plow (sim/snow-plow.js): stay back of it
          if (world.plowsSeen) score.plows = true;
          const plow = score.plows ? egoPlow(world, road?.limit ?? 11.2) : null;
          const plowClose =
            !!plow?.holds && speed > 1 && plow.rel.gap_m > -1 && plow.rel.gap_m < plow.keep - PLOW_CLOSE_SLACK_M;
          if (plowClose) {
            score.plowClose += dt;
            if (score.plowCounted !== plow.plow.id) {
              score.plowCounted = plow.plow.id;
              score.incident("plow_close", "Followed a snow plow too closely", { plow: plow.plow.id });
            }
          }
          return plowClose ? `Drop back. Stay ${plow.keep} m behind the snow plow.` : "";
        },
      },
    ],
    events: {
      passed_plow_on_right(score, ev) {
        score.plowRightPasses++;
        score.incident("plow_right_pass", "Passed a snow plow on the right", { plow: ev.plow });
      },
      cut_in_front_of_plow(score, ev) {
        score.plowCutIns++;
        score.incident("plow_cut_in", "Moved back in too close in front of a snow plow", { plow: ev.plow });
      },
    },
    deductions: [
      { at: "safety", order: -1, counter: "plowClose", weight: 0.6 },
      { at: "followingRules", order: 0, counter: "plowRightPasses", weight: 20 },
      { at: "followingRules", order: 1, counter: "plowCutIns", weight: 10 },
    ],
    tips: [
      {
        at: "beforeMerge",
        order: 0,
        when: (score) => score.plowRightPasses,
        text: "Never pass a snow plow on the right. Its blade throws snow and debris that way, and a wing blade can reach well into the next lane.",
      },
      {
        at: "beforeMerge",
        order: 1,
        when: (score) => score.plowClose > 1 || score.plowCutIns,
        text: "Stay at least 30 m behind a snow plow with its lights flashing (100 m where the limit is over 80 km/h). Pass one only on the left, where you can see the road ahead is clear, and move back in well ahead of it.",
      },
    ],
    reports: [
      {
        at: "beforeMerge",
        order: 0,
        read: (score, round) =>
          score.plows
            ? {
                plow_close_s: round(score.plowClose),
                plow_right_passes: score.plowRightPasses,
                plow_cut_ins: score.plowCutIns,
              }
            : {},
      },
    ],
  },
};
