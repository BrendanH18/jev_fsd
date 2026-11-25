import { dist, projectPoint } from "../../map/mapdata.js";
import { auditBusLanes, legalBusLane, routeBusLane } from "../bus-lanes.js";
import { busTravelLane } from "../bus.js";

const counter = "bus_lane_driving";
const inEffect = (snap) => snap.bus_lane?.in_effect && !snap.bus_lane.entering_allowed;
const leaving = (snap, c) => c.change && !snap.bus_lane.lanes.includes(c.law.laneIdx);
const inReservedLane = (snap) => inEffect(snap) && snap.bus_lane.lanes.includes(snap.lane?.index);
const busLaneForPath = (path, edge, index) =>
  legalBusLane(path.map, edge, index, path.busLanePolicy.clock, "straight", Infinity, false, path.bike ? "bicycle" : "car");

export default {
  key: "busLanes",
  seen: "busLanesSeen",
  build: (_world, { enabled }) => !!enabled,
  audit: {
    at: "afterPassing",
    run(world, dt) {
      if (world.busLanes) auditBusLanes(world, dt);
    },
  },
  sense: {
    at: "beforeLaneState",
    run(world, snap, { route, p }) {
      if (!world.busLanes) return;
      route.busLanePolicy = { clock: world.clock, curb: !!world.parking || !!world.parkedIn };
      const lane = routeBusLane(route, p.s, world.clock, route.busLanePolicy.curb);
      if (lane)
        snap.bus_lane = {
          edge: lane.edge,
          lanes: lane.lanes.map((l) => l.lane),
          in_effect: lane.active,
          entering_allowed: lane.entering_allowed,
          approach_m: lane.approach_m,
          block_end_in_m: lane.remaining,
        };
    },
  },
  laneOfferBlocked(world, route, s, index) {
    if (!world.busLanes) return false;
    const curb = route.busLanePolicy?.curb;
    const lane = routeBusLane(route, s, world.clock, curb);
    return lane && !legalBusLane(world.map, lane.edge, index, world.clock, lane.turn, lane.remaining, curb);
  },
  candidateLaneReject(snap, c, obliged) {
    return inEffect(snap) &&
      snap.bus_lane.lanes.includes(c.law.laneIdx) &&
      !c.change &&
      c.law.vTarget > 0.1 &&
      !obliged &&
      c.law.kind !== "hard_brake"
      ? counter
      : null;
  },
  rulesCost: {
    at: "beforeSpeedCost",
    run: (c, snap) => (inReservedLane(snap) && leaving(snap, c) ? -20 : 0),
  },
  cautious: {
    at: "reservedLane",
    run: (snap, eligible) => (inReservedLane(snap) ? eligible.find((c) => leaving(snap, c)) : null),
  },
  routeLaneIndex: chooseRouteLane,
  routeLaneMerges: reservedLaneMerges,
  trafficLaneInto(path, edge, turn, lane) {
    const policy = path.busLanePolicy;
    if (!policy) return null;
    if (policy.bus) return { index: busTravelLane(path.map, edge, policy.clock) };
    const desired = turn === "left" ? 0 : turn === "right" ? edge.lanes - 1 : Math.min(lane, edge.lanes - 1);
    if (busLaneForPath(path, edge.id, desired)) return null;
    for (let k = desired - 1; k >= 0; k--) if (busLaneForPath(path, edge.id, k)) return { index: k };
    // A reserved lane on the left can also need a move to the right.
    for (let k = desired + 1; k < edge.lanes; k++) if (busLaneForPath(path, edge.id, k)) return { index: k };
    return null;
  },
  trafficSuccessorPool(path, pool) {
    if (!path.busLanePolicy || path.busLanePolicy.bus) return pool;
    const legal = pool.filter((id) => {
      for (let k = 0; k < path.map.edges.get(id).lanes; k++) if (busLaneForPath(path, id, k)) return true;
      return false;
    });
    return legal.length ? legal : pool;
  },
  trafficSpawnLaneBlocked(world, lane, kind) {
    return world.busLanes && !legalBusLane(world.map, lane.edge, lane.idx, world.clock, "straight", Infinity, false, kind);
  },
  busSpawnLane(world, edge) {
    return world.busLanes ? { index: busTravelLane(world.map, edge, world.clock) } : null;
  },
  trafficPathPolicy(world, path, transit) {
    if (world.busLanes) path.busLanePolicy = { clock: world.clock, ...(transit === "bus" ? { bus: true } : {}) };
  },
  trafficLaneDirection(world, n, pathEdge, edge, turn, remaining, dir) {
    if (!world.busLanes || n.transit || n.school) return dir;
    const allowed = (k) =>
      legalBusLane(world.map, edge.id, k, world.clock, turn, remaining, !!n.pull || !!n.parking, n.kind || "car");
    if (!allowed(pathEdge.lane) && pathEdge.lane > 0) dir = -1;
    return allowed(pathEdge.lane + dir) ? dir : 0;
  },
  state: {
    at: "beforeRoadConstraints",
    run(snap, state) {
      if (snap.bus_lane) state.bus_lane = snap.bus_lane;
    },
  },
  clause: {
    at: "beforeCalming",
    run: (snap) =>
      snap.bus_lane?.in_effect
        ? "Bus-only lane: stay out except within the final 50 m before a right turn or to park/pull out at the curb."
        : null,
  },
  prompt: {
    at: "reservedLane",
    text: "- An in-effect `bus_lane` is reserved: stay out unless `entering_allowed` is true for the last 50 m before a right turn or an actual curb parking/pull-out manoeuvre. Choose a safe lane change out when necessary.",
  },
  flagText: {
    [counter]: "it drives in a reserved bus lane while the lane is in effect",
  },
  metric: {
    at: "afterPassing",
    name: counter,
    label: "Drove in a reserved bus lane",
    failure: "drove in a reserved bus lane",
    threshold: 1,
    category: "steering",
    trace: false,
  },
  coach: {
    init: () => ({ busLanesSeen: false }),
    seen: "busLanesSeen",
    deductions: [{ at: "beforeTrafficLegality", order: 0, counter, weight: 0.5, delta: true }],
    tips: [{
      at: "afterFollowing",
      order: 100,
      when: (score) => score.counterDelta(counter) > 1,
      text: "Keep the bus lane clear while its hours apply. Enter only in the last 50 m before a right turn or to reach the curb to park.",
    }],
    reports: [{
      at: "beforeFeatureSummary",
      order: 0,
      read: (score) => (score.busLanesSeen ? { [counter]: score.counterDelta(counter) } : null),
    }],
  },
};

function chooseRouteLane(route, s, i, info, idx, prepare) {
  if (route.busLanePolicy) {
    const b = routeBusLane(route, s, route.busLanePolicy.clock, route.busLanePolicy.curb);
    if (
      b &&
      !legalBusLane(route.map, b.edge, idx, route.busLanePolicy.clock, b.turn, b.remaining, route.busLanePolicy.curb)
    ) {
      const legal = info.offsets
        .map((_, k) => k)
        .filter((k) =>
          legalBusLane(route.map, b.edge, k, route.busLanePolicy.clock, b.turn, b.remaining, route.busLanePolicy.curb),
        );
      if (legal.length) idx = legal.reduce((a, k) => (Math.abs(k - idx) < Math.abs(a - idx) ? k : a));
    }
    // Prepare in the general lane before a straight continuation becomes reserved.
    const starts = route.laneEdgeStarts();
    for (let j = i + 1; j < route.edges.length && starts[j] - s < prepare && route.sameLanes(j - 1); j++) {
      if (!legalBusLane(route.map, route.edges[j], idx, route.busLanePolicy.clock)) {
        for (let k = idx - 1; k >= 0; k--)
          if (legalBusLane(route.map, route.edges[j], k, route.busLanePolicy.clock)) {
            idx = k;
            break;
          }
      }
    }
  }
  return idx;
}

// Lane laws follow the road when a straight continuation joins a different lane.
function reservedLaneMerges(route, rampLength) {
  const policy = route.busLanePolicy,
    clock = policy?.clock;
  if (!policy) return null;
  const minute = Number.isFinite(clock?.hour) ? Math.floor(clock.hour * 60) : null,
    day = clock?.weekday ?? 0,
    curb = !!policy.curb;
  const memo = route._merges;
  if (memo && memo.minute === minute && memo.day === day && memo.curb === curb) return memo.list;
  const list = [];
  route._merges = { minute, day, curb, list };
  const starts = route.laneEdgeStarts();
  for (let i = 1; i < route.edges.length; i++) {
    const at = starts[i];
    if (
      route.sameLanes(i - 1) ||
      route.laneInfo(i - 1).ring ||
      route.laneInfo(i).ring ||
      route.map.classifyTurn(route.map.turnAngle(route.edges[i - 1], route.edges[i])) !== "straight"
    )
      continue;
    const a = route.laneIndexAt(at - 0.5),
      b = route.laneIndexAt(at + 0.5);
    if (a.i !== i - 1 || b.i !== i || a.idx === a.info.idx) continue;
    const laneA = route.map.lane(route.edges[i - 1], a.idx),
      laneB = route.map.lane(route.edges[i], b.idx);
    if (!laneA || !laneB || dist(laneA.pts[laneA.pts.length - 1], laneB.pts[0]) > 1.0) continue;
    const before = a.info.offsets[a.idx] - a.info.offsets[a.info.idx],
      after = b.info.offsets[b.idx] - b.info.offsets[b.info.idx];
    const by = before - after;
    if (Math.abs(by) < 0.5) continue;
    // the fraction of the move the polyline has made d metres from the join, measured from the lane
    // the car keeps to on either side of it
    const made = (d) => {
      const lane = d < 0 ? laneA : laneB;
      const q = projectPoint(lane.pts, lane.cum, route.pointAt(Math.max(0, Math.min(route.length, at + d))));
      return Math.max(0, Math.min(1, (before + q.lateral) / by));
    };
    const ramp = [made(0)];
    let lo = 0;
    for (let d = -1; d >= Math.max(-rampLength, starts[i - 1] - at) && ramp[0] > 0.001; d--, lo--)
      ramp.unshift(Math.min(ramp[0], made(d)));
    for (let d = 1; d <= Math.min(rampLength, starts[i + 1] - at) && ramp[ramp.length - 1] < 0.999; d++)
      ramp.push(Math.max(ramp[ramp.length - 1], made(d)));
    ramp[0] = 0;
    ramp[ramp.length - 1] = 1;
    list.push({ i, at, by, lo, ramp });
  }
  return list;
}
