// Keep the box clear: a signalled approach in one lane whose light is green from BOX_GREEN_S[0] to
// BOX_GREEN_S[1] s into the drive, going straight on, along streets of one lane without a signal, to a
// junction within BOX_AHEAD_EDGES streets where traffic can turn left, with BOX_ROOM_M of them between
// the far side of the signal's junction (sim/junction-box.js boxEnd) and the line a car waits at to
// turn there (its sign's or give-way line, else just short of the junction). A car waits there to
// turn left, and a queue of cars stands behind it, the last BOX_TAIL_M past the signal's junction: no
// room for the car beyond it. The car starts BOX_START_M before the line (on the street straight
// before it where this one is too short), so it comes up on the green. BOX_RED_S after its light
// turns red (or BOX_MAX_S into the drive, whatever happens), the car at the far junction turns and
// the queue moves off; the car's light turns green again a while later. On the challenge's `street`
// where it has one. Positions along the streets past the signal (`queue`) are lane arc length from
// the junction's node.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, CAR } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { isJunction } from "../../sim/emergency.js";
import { StopMemory, approachPhase, movementSignal } from "../../sim/signals.js";
import { boxEnd } from "../../sim/junction-box.js";
import { rng } from "../../common.js";
import { QUEUE_GAP_M, laneScenario, pick, stepAuthored } from "./shared/kit.js";

export const challenge = {
  id: "junction-box",
  title: "Keep the box clear",
  map: "montreal",
  weather: "dry",
  time: "afternoon",
  seed: 20042,
  icon: "⊠",
  difficulty: "Judgement",
  hazard: "junction-box",
  street: "Avenue du Mont-Royal Est",
  description:
    "The light at Rue Saint-Denis is green, but a queue from Rue Rivard is backed up to the far side of your intersection.",
  lesson:
    "Use the space beyond the junction to decide whether to enter. Wait at the line until the whole car will fit on the far side without blocking cross traffic if the signal changes.",
};

const BOX_START_M = 60,
  BOX_ROUTE_M = 180,
  BOX_GREEN_S = [4, 20],
  BOX_ROOM_M = [15, 70],
  BOX_TAIL_M = 2.5,
  BOX_RED_S = 6,
  BOX_MAX_S = 90,
  BOX_AHEAD_EDGES = 3;
const boxSiteCache = new WeakMap();
function boxSites(map, street) {
  if (!boxSiteCache.has(map)) {
    const sites = [];
    const turn = (from, dir) => map.successors(from).find((id) => map.classifyTurn(map.turnAngle(from, id)) === dir);
    for (const e of map.edges.values()) {
      const c = e.control,
        inter = c?.type === "signal" ? map.intersections.get(c.id) : null;
      if (!inter || e.lanes !== 1 || e.ring) continue;
      let green = true;
      for (let t = BOX_GREEN_S[0]; t <= BOX_GREEN_S[1] && green; t += 0.5)
        green = movementSignal(approachPhase(inter, e.id, t), "straight") === "green";
      if (!green) continue;
      // (straight on past it to a junction where traffic can turn left)
      const ahead = [];
      let cur = e.id,
        length = 0,
        left = null,
        straight = null;
      for (let k = 0; k < BOX_AHEAD_EDGES; k++) {
        const next = turn(cur, "straight"),
          ne = next && map.edges.get(next);
        if (ne?.lanes !== 1 || ne.ring || ne.control?.type === "signal") break;
        ahead.push(next);
        cur = next;
        if (isJunction(map, ne.to)) {
          left = turn(next, "left");
          straight = turn(next, "straight");
          break;
        }
        length += map.lane(next, 0).length;
      }
      if (!left || !straight) continue;
      const last = map.edges.get(cur),
        lane = map.lane(cur, 0),
        scale = lane.length / Math.max(1, last.length);
      const line = last.control?.s_line ?? map.priorityOf(cur)?.s_line ?? last.length - map.crossingHalfWidth(cur) - 1;
      const lead = length + line * scale,
        far = boxEnd(map, e.id, 0),
        room = lead - far;
      if (room < BOX_ROOM_M[0] || room > BOX_ROOM_M[1]) continue;
      // (the car starts on this street, or on the one straight before it)
      let start = map.lane(e.id, 0),
        startS = (c.s_line * start.length) / Math.max(1, e.length) - BOX_START_M;
      const approachLane = start;
      if (startS < 5) {
        const before = (map.inn.get(e.from) || [])
          .map((id) => map.edges.get(id))
          .find(
            (b) =>
              !b.ring &&
              !b.control &&
              map.classifyTurn(map.turnAngle(b.id, e.id)) === "straight" &&
              b.length + startS > 8,
          );
        if (!before) continue;
        start = map.lane(before.id, 0);
        startS += start.length;
      }
      sites.push({
        lane: start,
        startS,
        ahead: start === approachLane ? null : approachLane,
        signal: c.id,
        group: c.group,
        queue: { edges: ahead, lead, tail: far + BOX_TAIL_M, left, straight },
      });
    }
    sites.sort((a, b) => a.signal.localeCompare(b.signal) || a.queue.edges[0].localeCompare(b.queue.edges[0]));
    boxSiteCache.set(map, sites);
  }
  const sites = boxSiteCache.get(map),
    on = sites.filter((s) => (s.ahead || s.lane).edgeRef.name === street);
  return on.length ? on : sites;
}

// (through the signal, along the queue past it; past the box, only as far as the street after the
// queue: the queue moves off ahead of the car)
export const scenario = (map, challenge) =>
  laneScenario(map, challenge, (map, challenge, random) => {
    const box = pick(
      boxSites(map, challenge.street),
      random,
      "This map has no signalled junction on a one-lane street with room past it for a short queue before the next junction.",
    );
    return {
      lane: box.lane,
      startS: box.startS,
      through: [...(box.ahead ? [box.ahead] : []), ...box.queue.edges.map((id) => map.lane(id, 0))],
      extend: BOX_ROUTE_M,
      fields: { junctionBox: { signal: box.signal, group: box.group, queue: box.queue } },
    };
  });

// The car waiting at the far junction to turn left, its indicator on, and the queue behind it back to
// just past the signal's junction, all held until the car's light has been red a while (see boxSites).
function placeBoxQueue(world, fleet, { signal, group, queue }, seed) {
  const map = world.map,
    random = rng(seed),
    ids = [];
  const lanes = queue.edges.map((id) => map.lane(id, 0));
  const count = Math.max(1, Math.floor((queue.lead - queue.tail + QUEUE_GAP_M[0]) / (CAR.length + QUEUE_GAP_M[0])));
  const gap = count > 1 ? Math.min(QUEUE_GAP_M[1], (queue.lead - queue.tail - count * CAR.length) / (count - 1)) : 0;
  // (from the last of the queue, its rear BOX_TAIL_M past the junction, up to the car turning left)
  for (let i = count - 1; i >= 0; i--) {
    let s = queue.tail + i * (CAR.length + gap) + CAR.rearOverhang,
      k = 0;
    while (k < lanes.length - 1 && s > lanes[k].length) {
      s -= lanes[k].length;
      k++;
    }
    const lane = lanes[k],
      p = pointAt(lane.pts, lane.cum, s),
      lead = i === count - 1;
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
    Object.assign(car, {
      id: `challenge_queue_${count - i}`,
      color: [0x3d5a80, 0xb0b5b9, 0x6b2737, 0x2f4f3a][(count - i - 1) % 4],
      v0: 11,
      driver: { aMax: 1.4, b: 2, s0: 2, T: 1.3, react: 0.6 + random() * 0.4, lcRate: 0 },
      stopMem: new StopMemory(),
      path: new NpcPath(map, fleet.random),
      frozen: 1e6,
      waiting: 0,
      ...(lead ? { signal: "left" } : {}),
    });
    car.path.start(lane.edge, 0, s, [
      ...queue.edges.slice(k + 1).map((id) => [id, 0]),
      [lead ? queue.left : queue.straight, 0],
    ]);
    fleet.vehicles.push(car);
    ids.push(car.id);
  }
  const inter = map.intersections.get(signal);
  return { boxQueueIds: ids, signalId: signal, signalGroup: group, ...(inter ? { at: [inter.x, inter.y] } : {}) };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeBoxQueue(world, fleet, scenario.junctionBox, challenge.seed));
}

export const step = (world, fleet) =>
  stepAuthored(world, fleet, {
    // (BOX_RED_S after the car's light turns red, the car at the far junction turns, and the queue
    // behind it moves off)
    follow: (world, fleet, state) => {
      if (!state.boxQueueIds || state.released) return;
      if (world.phase(state.signalId)[state.signalGroup] === "red" && world.t > BOX_GREEN_S[1]) state.redAt ??= world.t;
      if ((state.redAt !== undefined && world.t - state.redAt >= BOX_RED_S) || world.t >= BOX_MAX_S) {
        state.released = true;
        for (const id of state.boxQueueIds) {
          const car = fleet.vehicles.find((v) => v.id === id);
          if (car) car.frozen = 0;
        }
      }
    },
  });
