import { r1, rng } from "../../common.js";
import { Vehicle, HERITAGE_STREETCAR } from "../vehicle.js";
import { isEmergency } from "../emergency.js";
import {
  AWAY_S,
  HEAR_M,
  HOLD_M as RAIL_HOLD_M,
  canStopFor,
  crossingAheadOf,
  crossingHold,
  crossingNotice,
  crossingsAhead,
  fouling,
  isTrain,
  railIndex,
  roomBlocker,
  stepTrain,
  trainAt,
  trainState,
  waitsAt,
} from "../rail.js";

// Trains at level crossings (sim/rail.js, Alberta AR 304/2002 s. 42). The fleet runs a train on each
// map with a track (`trains`), every driver stops short of a level crossing for a train coming and
// never on the tracks, and the driven car's sensing, candidates, wording and audit do the same. The
// crossings themselves are on the map whether trains run or not: the driven car and traffic still
// wait short of them for room past the tracks.

// Trains in free drives: one at a time on a map with a track, placed somewhere along it at the start,
// and brought back from the edge of the map AWAY_S after it runs off it.
const MAX_TRAINS = 1;
const TRAIN_COLOR = 0x7a1d1d;
// Stopping for a train at a level crossing: once the car, heading across the crossing, first hears the
// train coming (its gong, within 250 m) or sees it, it owes the stop if it could then stop where drivers
// do (7 m back from the nearest rail) braking at up to 3.5 m/s^2. It fails to yield if, owing it, its
// front comes within 5 m of the nearest rail at more than 1 m/s while the train is still approaching
// (coming, or on the crossing), or if any of it stands on the tracks (in the train's envelope) slower
// than 1 m/s while the train is. Counted once per train at each crossing.
const AUDIT_TRAIN_MOVING_MPS = 1;

class Trains {
  constructor(fleet, enabled, seed) {
    this.fleet = fleet;
    this.world = fleet.world;
    this.map = fleet.map;
    // (their own stream, so running them leaves the rest of the traffic as it was)
    this.random = rng(seed * 86028121 + 19);
    this.count = 0;
    this.crossings = railIndex(this.map).crossings.length > 0;
    this.target = enabled ? Math.min(MAX_TRAINS, railIndex(this.map).tracks.size) : 0;
    this.list = [];
    for (let i = 0; i < this.target; i++) this.spawn(true);
    this.next = this.world.t + AWAY_S[0];
    this.list = this.fleet.vehicles.filter(isTrain);
  }

  // Put a train on a track of the map: `anywhere`, somewhere along it going either way, at least 150 m
  // from the car; else coming onto the map from an end where its track leaves it. Returns it, or null.
  spawn(anywhere = false, track = null, front = null, dir = null) {
    const tracks = [...railIndex(this.map).tracks.values()],
      ego = this.world.ego,
      random = this.random;
    for (let attempt = 0; tracks.length && attempt < 12; attempt++) {
      const t = track || tracks[Math.floor(random() * tracks.length)];
      let d = dir,
        f = front;
      if (f === null) {
        if (anywhere) {
          d = random() < 0.5 ? 1 : -1;
          f = 30 + random() * (t.length - 60);
        } else {
          const edges = [0, 1].filter((k) => t.ends[k] === "edge");
          if (!edges.length) return null;
          const k = edges[Math.floor(random() * edges.length)];
          d = k === 0 ? 1 : -1;
          f = k === 0 ? 1 : t.length - 1;
        }
      }
      const n = Object.assign(
        new Vehicle(0, 0, 0, 0, HERITAGE_STREETCAR),
        {
          id: `train_${++this.count}`,
          kind: "train",
          color: TRAIN_COLOR,
          name: t.name || "",
          frozen: 0,
          waiting: 0,
        },
        trainState(t, f, d, anywhere ? 0 : 6),
      );
      stepTrain(n, t, 0, [], () => false, random);
      if (anywhere && Math.hypot(n.x - ego.x, n.y - ego.y) < 150 && front === null) {
        this.count--;
        continue;
      }
      this.fleet.vehicles.push(n);
      this.list = this.fleet.vehicles.filter(isTrain);
      return n;
    }
    return null;
  }

  // Take off one that has run off the map, and send another back after a while.
  manage() {
    const vehicles = this.fleet.vehicles;
    for (const n of vehicles.filter((v) => isTrain(v) && v.rail.gone)) {
      vehicles.splice(vehicles.indexOf(n), 1);
      this.next = Math.max(this.next, this.world.t + AWAY_S[0] + this.random() * (AWAY_S[1] - AWAY_S[0]));
    }
    if (vehicles.filter(isTrain).length < this.target && this.world.t >= this.next) {
      if (!this.spawn()) this.next = this.world.t + 30;
    }
    this.list = vehicles.filter(isTrain);
  }

  // Where a driver's front stops for the level crossings ahead on its path (sim/rail.js crossingHold),
  // or null. It owes the stop for a train when it first hears it coming and can stop then; an emergency
  // vehicle does not wait for room past the tracks.
  hold(n, front, all) {
    n.railOwed ||= new Map();
    const owes = (x, at) => {
      const key = `${x.c.id}:${at.train.id}:${at.train.rail.departures}`;
      if (!n.railOwed.has(key)) {
        if (n.railOwed.size > 8) n.railOwed.delete(n.railOwed.keys().next().value);
        n.railOwed.set(key, canStopFor(n.v, x.stop_m) || n.v < 0.5);
      }
      return n.railOwed.get(key);
    };
    const hold = crossingHold(this.map, n.path.pts, n.path.cum, front, n.spec, n.v, {
      trains: this.list,
      vehicles: isEmergency(n) ? [] : all,
      self: n,
      owes,
    });
    return hold ? hold.stop_m : null;
  }
}

// (see AUDIT_TRAIN_MOVING_MPS)
function auditCrossings(world, dt) {
  const crossings = railIndex(world.map).crossings;
  if (!crossings.length) return;
  const ego = world.ego;
  // (where the car stands on the tracks, for the coaching score: sim/drive-score.js)
  const on = crossings.find((c) => fouling(ego, c, world.map)) || null;
  if (!on) world.onTracks = null;
  else if (world.onTracks?.id !== on.id) world.onTracks = { id: on.id, since: world.t, still: 0 };
  if (world.onTracks) world.onTracks.still = Math.abs(ego.v) < 0.3 ? world.onTracks.still + dt : 0;
  const ahead = crossingAheadOf(ego, world.map);
  for (const c of crossings) {
    const at = trainAt(world.npcs, c);
    if (!at) continue;
    const x = ahead?.c === c ? ahead.x : null,
      foul = on === c;
    if (!x && !foul) continue;
    const train = at.train,
      key = `${c.id}:${train.id}:${train.rail.departures}`;
    let rec = world.trainCalls.get(key);
    // (decided when the car first hears or sees it coming, still short of the law's line)
    if (!rec && x && x.hold_m > 0) {
      const heard = train.rail.gong && Math.hypot(train.x - ego.x, train.y - ego.y) < HEAR_M;
      if (heard || world.visibility.sees(ego, train))
        world.trainCalls.set(key, (rec = { owed: canStopFor(ego.v, x.stop_m), counted: false }));
    }
    if (rec?.counted) continue;
    const crossed = rec?.owed && x && x.hold_m <= 0 && !x.fouling && x.exit_m > 0 && ego.v > AUDIT_TRAIN_MOVING_MPS;
    const stood = foul && Math.abs(ego.v) < AUDIT_TRAIN_MOVING_MPS;
    if (crossed || stood) {
      if (!rec) world.trainCalls.set(key, (rec = { owed: true, counted: false }));
      rec.counted = true;
      world.violations.failed_to_yield++;
      world.events.push({
        type: "failed_to_yield",
        to: "train",
        with: train.id,
        crossing: c.id,
        ...(stood ? { on_tracks: true } : {}),
      });
    }
  }
  if (world.trainCalls.size > 20)
    for (const key of [...world.trainCalls.keys()].slice(0, 10)) world.trainCalls.delete(key);
}

// A level crossing on the car's route ahead: the nearest within 80 m, or the one it is on the tracks of
// (`on_tracks`). The car stops with its front 7 m back from the nearest rail (`stop_s_route`), short of
// the law's 5 m, and waits there while a train it hears (ringing its gong, within 250 m) or sees is
// approaching the crossing (`wait` "train"): owed when the car, first hearing or seeing it, could stop
// there braking at no more than 3.5 m/s^2, decided once a train and remembered in `world.trainYields`.
// And it waits there too while a vehicle it can see past the tracks, stopped or slower than 3 m/s,
// leaves no room for all of the car beyond them (`wait` "room", `blocker`). Once its front is past
// where it would stop it goes on, unless it is barely moving and still short of the train's envelope;
// on the tracks it always goes on. Or null.
function levelCrossing(world, route, frontS, vehicles) {
  if (!railIndex(world.map).crossings.length) return null;
  const ego = world.ego,
    x = crossingsAhead(world.map, route.pts, route.cum, frontS, ego.spec)[0];
  if (!x) return null;
  world.trainYields ||= new Map();
  const track = railIndex(world.map).tracks.get(x.c.track),
    at = trainAt(world.npcs, x.c);
  let train = null,
    wait = null,
    blocker = null;
  if (at) {
    const n = at.train,
      d = Math.hypot(n.x - ego.x, n.y - ego.y),
      seen = world.sees(ego, n),
      heard = !!n.rail.gong && d < HEAR_M;
    if (seen || heard) {
      train = { id: n.id, seen, heard, on: at.on, gap_m: at.gap_m, eta_s: at.eta_s };
      const key = `${x.c.id}:${n.id}:${n.rail.departures}`;
      if (!world.trainYields.has(key)) {
        if (world.trainYields.size > 20) world.trainYields.delete(world.trainYields.keys().next().value);
        world.trainYields.set(key, canStopFor(ego.v, x.stop_m) || ego.v < 0.5);
      }
      if (world.trainYields.get(key) && waitsAt(x, ego.v)) wait = "train";
    }
  }
  if (waitsAt(x, ego.v)) {
    const b = roomBlocker(route.pts, route.cum, frontS, ego.spec, x, vehicles, ego);
    if (b) {
      blocker = { id: b.vehicle.id, past_tracks_m: b.rear_m };
      wait ||= "room";
    }
  }
  return {
    id: x.c.id,
    kind: track?.kind || "rail",
    line: track?.name || "",
    to_rail_m: x.hold_m + RAIL_HOLD_M,
    stop_s_route: frontS + x.stop_m,
    bumper_to_stop_m: x.stop_m,
    on_tracks: x.fouling,
    clear_in_m: x.exit_m,
    train,
    wait,
    blocker,
  };
}

function crossingClause(snap) {
  const x = snap.level_crossing,
    t = x.train,
    w = Math.max(0, Math.round(x.bumper_to_stop_m));
  const where = `Level crossing \`${x.id}\` (a ${x.kind === "tram" ? "streetcar line" : "railway"}, crossbucks only), ${x.on_tracks ? "under the car: it is on the tracks" : `${Math.round(Math.max(0, x.to_rail_m))} m ahead`}.`;
  const train = t
    ? ` A ${x.kind === "tram" ? "streetcar" : "train"} \`${t.id}\` is ${t.on ? "on the crossing" : `coming, due in ${Math.round(t.eta_s)} s`} (${t.seen ? "seen" : "heard, ringing its gong"}).`
    : "";
  if (x.on_tracks) return `${where}${train} Never stop on the tracks: drive on until all of the car is clear of them.`;
  if (x.wait === "train")
    return `${where}${train} The car must stop no closer than 5 m from the nearest rail and wait until it has passed: ${w < 2 ? "hold still where the car is." : `slow down and stop ${w} m ahead (\`stop_before_tracks\`).`}`;
  if (x.wait === "room")
    return `${where}${train} Traffic past the tracks is stopped, and leaves no room for the car beyond them: never stop on the tracks. Wait short of them until there is room: ${w < 2 ? "hold still where the car is." : `stop ${w} m ahead (\`stop_before_tracks\`).`}`;
  return `${where}${train} ${t ? "The car cannot stop short of it in time: keep going and clear the tracks." : "No train is coming and there is room past it: cross without stopping on the tracks."}`;
}

export default {
  key: "trains",
  view: () => import("../../render/rail.js"),
  // a level crossing ahead to wait at, for a train coming or for room past the tracks: say so once
  notice: { at: "afterCrosswalk", order: 2, duration: 2500, style: "safety", read: (world) => crossingNotice(world) },
  // (the gong of the nearest one ringing)
  sound: {
    name: "gong",
    distance(world, fleet) {
      let ringing = Infinity;
      for (const train of fleet.trains?.list || [])
        if (train.rail.gong) ringing = Math.min(ringing, Math.hypot(train.x - world.ego.x, train.y - world.ego.y));
      return ringing;
    },
  },
  // (where the car stands on the tracks: sim/drive-score.js)
  property: "onTracks",
  build: () => null,
  calls: "trainCalls",
  buildFleet: (fleet, { enabled, seed }) => new Trains(fleet, enabled, seed),
  snapshot: { level_crossing: null },
  // (long, so looked for all along its body; it keeps to its track, so it never parks)
  obstacle: { test: isTrain, traffic: true, long: true, noParking: () => true },
  motion: (snap) => !!(snap.level_crossing?.wait || snap.level_crossing?.on_tracks),
  flagText: {
    crosses_in_front_of_train: "it crosses the level crossing with a train coming",
    no_room_past_tracks: "it stops on the level crossing, with no room past the tracks",
  },

  trafficManage: {
    at: "schoolBuses",
    run(_world, fleet) {
      const trains = fleet.trains;
      if (trains.list.length || trains.target) trains.manage();
    },
  },
  // A train on its track, braking for anything in its way that it can see.
  trafficManeuver: {
    at: "beforeSpecial",
    run(world, fleet, n, dt, all) {
      if (!isTrain(n)) return false;
      const trains = fleet.trains;
      stepTrain(
        n,
        railIndex(fleet.map).tracks.get(n.rail.track),
        dt,
        [...all, ...world.crowd.list],
        (cab, o) => world.visibility.sees(cab, o),
        trains.random,
      );
      return true;
    },
  },
  // At a level crossing: short of the tracks for a train coming, or for a queue backed up past them.
  trafficHold: (_world, fleet, n, front, all) => (fleet.trains.crossings ? fleet.trains.hold(n, front, all) : null),
  // (an emergency vehicle only for the train)
  emergencyHold: (_world, fleet, n, front, all) => (fleet.trains.crossings ? fleet.trains.hold(n, front, all) : null),
  checkpoint(world, fleet) {
    if (!fleet.trains) return;
    fleet.trains.world = world;
    fleet.trains.fleet = fleet;
  },

  audit: { at: "buses", run: auditCrossings },
  resetContact(world) {
    world.trainYields?.clear();
    world.onTracks = null;
  },

  sense: {
    at: "afterCrosswalk",
    run(world, snap, { route, frontS, vehicles }) {
      snap.level_crossing = levelCrossing(world, route, frontS, vehicles);
    },
  },
  // A level crossing to wait at, for a train coming or for room past the tracks: stop short of it.
  target: {
    at: "streetcars",
    run(snap, v, reasons, { decel, holdSpeed }) {
      const lx = snap.level_crossing;
      if (lx?.wait) {
        const vl = holdSpeed(lx.bumper_to_stop_m, decel);
        if (vl < v) {
          v = vl;
          reasons.push(lx.wait === "train" ? "train coming at the level crossing" : "no room past the tracks");
        }
      }
      return v;
    },
  },
  hazard: { at: "afterCrosswalk", run: (snap) => (snap.level_crossing ? "level crossing" : null) },

  // A level crossing to wait at (a train coming, or no room past the tracks): stop 7 m back from the
  // nearest rail, and stay stopped there until the train has passed and there is room.
  candidates: {
    at: "afterCrosswalk",
    run({ snap, laneUntil, inLane, approach, stopAt, FRONT }, out) {
      const lx = snap.level_crossing;
      if (lx?.wait && lx.bumper_to_stop_m > 0.3) {
        out.push({
          id: "stop_before_tracks",
          laneUntil,
          law: inLane({ kind: "lane", vTarget: approach, stopAtRoute: stopAt(lx.stop_s_route - FRONT) }),
          steer: "hold lane",
          speed:
            lx.wait === "train"
              ? "stop short of the level crossing for the train"
              : "wait short of the tracks for room past them",
        });
      }
    },
  },
  // (1.5 m past where it waits is still 5.5 m back from the nearest rail)
  sim: {
    at: "afterCrosswalk",
    run(_world, snap) {
      const railStop = snap.level_crossing?.wait ? snap.level_crossing.stop_s_route : null;
      if (railStop === null) return null;
      let passes = false;
      return {
        start() {
          passes = false;
        },
        along(s, front) {
          if (s + front > railStop + 1.5) passes = true;
        },
        reject: (c) =>
          passes && c.law.kind !== "hard_brake"
            ? snap.level_crossing.wait === "train"
              ? "crosses_in_front_of_train"
              : "no_room_past_tracks"
            : null,
      };
    },
  },
  rulesWait: (c) => c.id === "stop_before_tracks",
  legitimateStop: (snap) => !!(snap?.level_crossing?.wait && snap.level_crossing.bumper_to_stop_m < 8),

  state: {
    at: "afterCrosswalk",
    run(snap, state) {
      if (!snap.level_crossing) return;
      const x = snap.level_crossing,
        t = x.train;
      state.level_crossing = {
        id: x.id,
        track: x.kind === "tram" ? "streetcar line" : "railway",
        to_nearest_rail_m: r1(Math.max(0, x.to_rail_m)),
        ...(x.on_tracks ? { on_tracks: true } : {}),
        ...(t
          ? {
              train: {
                id: t.id,
                ...(t.on ? { on_crossing: true } : { arrives_in_s: r1(t.eta_s) }),
                seen: t.seen,
                heard: t.heard,
              },
            }
          : {}),
        ...(x.blocker ? { no_room_past_tracks: true } : {}),
        ...(x.wait
          ? {
              stop: true,
              wait_for: x.wait === "train" ? "train" : "room",
              wait_in_m: r1(Math.max(0, x.bumper_to_stop_m)),
            }
          : {}),
      };
    },
  },
  outcome: {
    at: "ids",
    run: (c, snap) =>
      c.id === "stop_before_tracks" && snap.level_crossing
        ? `clear, stops ${Math.max(0, r1(snap.level_crossing.bumper_to_stop_m - c.sim.progress_m))} m short of the level crossing, 7 m back from the nearest rail`
        : null,
  },
  clause: { at: "afterCrosswalk", run: (snap) => (snap.level_crossing ? crossingClause(snap) : null) },
  holdStill: {
    at: "afterCrosswalk",
    run: (snap) =>
      snap.level_crossing?.wait
        ? ", when the car has stopped short of a level crossing it must wait at (`level_crossing.wait_in_m` under 2)"
        : "",
  },
  prompt: {
    at: "afterCrosswalk",
    text: "- Choose `stop_before_tracks` when `situation` says a train is coming at a level crossing ahead, or that there is no room past the tracks: never stop on them. Keep the car stopped short of them until the train has passed and there is room for all of the car beyond them.",
  },
};
