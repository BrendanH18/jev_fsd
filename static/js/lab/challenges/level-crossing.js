// Clear the tracks: a level crossing (sim/rail.js) on a street that ends at a junction where traffic
// can turn left, with 12 to 30 m of it between the far side of the train's envelope and where a car
// waits to turn there, and room for the car to come up to the crossing (TRACKS_START_M before where
// it stops, on the street straight before it where this one is too short). A car waits at the
// junction to turn left, and a queue of QUEUE_CARS stands behind it, the last TAIL_ROOM_M past the
// envelope: no room for the car past the tracks. Once the car's front is TRACKS_TRIGGER_M from the
// crossing, a streetcar standing TRAIN_START_M along its track sets off toward it, ringing; once it has
// passed by, QUEUE_CLEAR_S later (or QUEUE_MAX_S after it set off, whatever happens: a car stopped on
// the tracks holds the streetcar up), the car at the junction turns and the queue moves off. On the
// challenge's `street` where it has one.
import { pointAt, headingAt } from "../../map/mapdata.js";
import { Vehicle, CAR } from "../../sim/vehicle.js";
import { NpcPath } from "../../sim/npc.js";
import { StopMemory } from "../../sim/signals.js";
import { approach, crossingsAhead, railIndex, trainSpan } from "../../sim/rail.js";
import { rng } from "../../common.js";
import { QUEUE_GAP_M, frontWithin, laneScenario, pick, stepAuthored } from "./shared/kit.js";

export const challenge = { id: "level-crossing", title: "Clear the tracks", map: "edmonton", weather: "dry", time: "afternoon", seed: 19042, icon: "╫", difficulty: "Judgement", hazard: "level-crossing", street: "106 Street NW",
  description: "106 Street crosses the High Level Bridge Streetcar's tracks on the level, with crossbucks and nothing else: no lights, no gates, no bell. Past them, traffic is backed up from 86 Avenue behind a car waiting to turn left.", lesson: "Never stop on the tracks: don't start across a level crossing unless there is room for all of your car past it. And when a train is coming, stop at least 5 m back from the nearest rail and wait until it has passed (Alberta's Use of Highway and Rules of the Road Regulation, s. 42). A streetcar can't steer round you, and takes far longer to stop than a car." };

const TRACKS_START_M = 95, TRACKS_TRIGGER_M = 30, TRAIN_START_M = 100, TAIL_ROOM_M = 2.5, QUEUE_CLEAR_S = 4, QUEUE_MAX_S = 30;
const trackSiteCache = new WeakMap();
function trackSites(map, street) {
  if (!trackSiteCache.has(map)) {
    const sites = [];
    for (const c of railIndex(map).crossings) for (const on of c.edges) {
      const e = map.edges.get(on.edge), lane = map.lane(on.edge, e.lanes - 1);
      if (!lane || e.ring || e.control) continue;
      const left = map.successors(on.edge).find((id) => map.classifyTurn(map.turnAngle(on.edge, id)) === "left");
      const straight = map.successors(on.edge).find((id) => map.classifyTurn(map.turnAngle(on.edge, id)) === "straight");
      if (!left || !straight) continue;
      const scale = lane.length / Math.max(1, e.length), x = crossingsAhead(map, lane.pts, lane.cum, 0, CAR, lane.length)[0];
      if (!x || x.c !== c) continue;
      const far = x.exit_m - CAR.length, lead = lane.length - map.crossingHalfWidth(on.edge) - 1, room = lead - far;
      if (room < 12 || room > 30) continue;
      // (the car starts on this street, or on the one straight before it)
      let start = lane, startS = x.stop_m - TRACKS_START_M;
      if (startS < 5) {
        const before = (map.inn.get(e.from) || []).map((id) => map.edges.get(id)).find((b) => !b.ring && !b.control && map.classifyTurn(map.turnAngle(b.id, on.edge)) === "straight" && b.length + startS > 8);
        if (!before) continue;
        start = map.lane(before.id, Math.min(lane.idx, before.lanes - 1)); startS += start.length;
      }
      sites.push({ lane: start, startS, ahead: start === lane ? null : lane, crossing: c.id, queue: { edge: on.edge, lane: lane.idx, lead: lead / scale, tail: (far + TAIL_ROOM_M) / scale, left, straight } });
    }
    sites.sort((a, b) => a.crossing.localeCompare(b.crossing) || a.queue.edge.localeCompare(b.queue.edge));
    trackSiteCache.set(map, sites);
  }
  const sites = trackSiteCache.get(map), on = sites.filter((s) => s.queue && map.edges.get(s.queue.edge).name === street);
  return on.length ? on : sites;
}

export const scenario = (map, challenge) => laneScenario(map, challenge, (map, challenge, random) => {
  const track = pick(trackSites(map, challenge.street), random, "This map has no level crossing with room for a short queue between the tracks and a junction past them.");
  return { lane: track.lane, startS: track.startS, through: track.ahead ? [track.ahead] : [],
    fields: { levelCrossing: { crossing: track.crossing, queue: track.queue } } };
});

// The car waiting at the junction to turn left, its indicator on, and the queue behind it, all held
// until the streetcar has passed by; and the streetcar, standing on its track TRAIN_START_M from the
// crossing on the side hidden from the car where one is, held until the car comes up (see trackSites).
function placeLevelCrossing(world, fleet, { crossing, queue }, seed) {
  const map = world.map, e = map.edges.get(queue.edge), lane = map.lane(queue.edge, queue.lane), scale = lane.length / Math.max(1, e.length);
  const random = rng(seed), ids = [], front = CAR.length - CAR.rearOverhang;
  let at = queue.lead * scale;
  const tail = queue.tail * scale, count = Math.max(1, Math.floor((at - tail + QUEUE_GAP_M[0]) / (CAR.length + QUEUE_GAP_M[0])));
  const gap = count > 1 ? Math.min(QUEUE_GAP_M[1], (at - tail - count * CAR.length) / (count - 1)) : 0;
  for (let i = 0; i < count; i++) {
    const s = at - front, p = pointAt(lane.pts, lane.cum, s);
    const car = new Vehicle(p[0], p[1], headingAt(lane.pts, lane.cum, s), 0);
    Object.assign(car, { id: `challenge_queue_${i + 1}`, color: [0x3d5a80, 0xb0b5b9, 0x6b2737, 0x2f4f3a][i % 4], v0: 11, driver: { aMax: 1.4, b: 2, s0: 2, T: 1.3, react: 0.6 + random() * 0.4, lcRate: 0 },
      stopMem: new StopMemory(), path: new NpcPath(map, fleet.random), frozen: 1e6, waiting: 0, ...(i === 0 ? { signal: "left" } : {}) });
    car.path.start(queue.edge, queue.lane, s, [[i === 0 ? queue.left : queue.straight, 0]]);
    fleet.vehicles.push(car); ids.push(car.id);
    at -= CAR.length + gap;
  }
  const c = railIndex(map).crossings.find(x => x.id === crossing), track = c && railIndex(map).tracks.get(c.track);
  if (!track) return { queueIds: ids, crossingId: crossing, trainId: null };
  // (from whichever side the car cannot see the track from, where it starts: else from the far end)
  const ego = world.ego, sides = [1, -1].map(dir => ({ dir, front: c.s - dir * TRAIN_START_M })).filter(o => o.front > 15 && o.front < track.length - 15);
  const hidden = sides.find(o => { const p = pointAt(track.pts, track.cum, o.front); return world.visibility.occluded([ego.x, ego.y], p); }) || sides.at(-1);
  const train = hidden && fleet.spawnTrain(false, track, hidden.front, hidden.dir);
  if (train) { train.v = 0; Object.assign(train.rail, { phase: "dwell", held: true, dwell: Infinity, t: 0 }); }
  return { queueIds: ids, crossingId: crossing, trainId: train?.id || null, at: [c.x, c.y] };
}

export function install(world, fleet, challenge, scenario) {
  Object.assign(world.challenge, placeLevelCrossing(world, fleet, scenario.levelCrossing, challenge.seed));
}

export const step = (world, fleet) => stepAuthored(world, fleet, {
  trigger: frontWithin(TRACKS_TRIGGER_M),
  // (the streetcar sets off toward the crossing, ringing)
  release: (world, fleet, state) => {
    const train = state.trainId && fleet.vehicles.find(v => v.id === state.trainId);
    if (train) Object.assign(train.rail, { held: false, dwell: 0 });
  },
  // (once it has passed by the crossing, QUEUE_CLEAR_S later the car at the junction turns, and the
  // queue behind it moves off)
  follow: (world, fleet, state) => {
    if (!state.queueIds || !state.triggered || state.released) return;
    const train = fleet.vehicles.find(v => v.id === state.trainId), c = railIndex(world.map).crossings.find(x => x.id === state.crossingId);
    const passed = !train || train.rail.gone || (c && !approach(train, c) && train.rail.dir * (trainSpan(train).rear - c.s) > 0);
    if (passed) state.passedAt ??= world.t;
    state.setOff ??= world.t;
    if ((state.passedAt !== undefined && world.t - state.passedAt >= QUEUE_CLEAR_S) || world.t - state.setOff >= QUEUE_MAX_S) {
      state.released = true;
      for (const id of state.queueIds) { const car = fleet.vehicles.find(v => v.id === id); if (car) car.frozen = 0; }
    }
  },
});
