import { FEATURE_METRICS, hooks } from "../sim/features/index.js";

const CHECKPOINT = hooks("checkpoint");
const CHECKPOINT_SHARE = hooks("checkpointShare");

// In-memory checkpoints preserve prototypes, object identity, and seeded random streams.
// Immutable map/render resources are shared; mutable driving state is copied.
export function cloneState(value, shared = new Set(), seen = new Map()) {
  if (value === null || !["object", "function"].includes(typeof value) || shared.has(value)) return value;
  if (seen.has(value)) return seen.get(value);
  if (typeof value === "function") {
    const copy = value.clone ? value.clone() : value;
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, entry] of value) copy.set(cloneState(key, shared, seen), cloneState(entry, shared, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const entry of value) copy.add(cloneState(entry, shared, seen));
    return copy;
  }
  const copy = Array.isArray(value) ? new Array(value.length) : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor.get || descriptor.set) {
      Object.defineProperty(copy, key, descriptor);
      continue;
    }
    // Three.js instance handles belong to the renderer, not the simulation checkpoint.
    if (key === "instances") {
      copy[key] = value[key];
      continue;
    }
    copy[key] = cloneState(value[key], shared, seen);
  }
  return copy;
}

export class DriveRecorder {
  constructor({ seconds = 120, interval = 0.5 } = {}) {
    this.capacity = Math.ceil(seconds / interval) + 1;
    this.interval = interval;
    this.frames = [];
    this.at = -Infinity;
    this.markers = [];
    this.branched = false;
    this.spend = { cost: 0, tokens: 0, calls: 0 };
    this.recordingId = crypto.randomUUID();
  }
  reset() {
    this.frames = [];
    this.markers = [];
    this.at = -Infinity;
    this.branched = false;
    this.baseShared = null;
    this.indexedMap = null;
    this.recordingId = crypto.randomUUID();
  }
  sharedFor({ world, autopilot }) {
    const shared = (this.baseShared ||= new Set([
      world.map,
      world.staticObstacles,
      world.visibility,
      world.crowd.streets,
      world.crowd.legsAt,
      world.crowd.streetIndex,
      world.crowd.ringNodes,
      autopilot.brains,
      autopilot.onDecision,
      autopilot.onEvent,
    ]));
    if (!this.indexedMap) {
      for (const collection of [world.map.lanes, world.map.edges, world.map.nodes])
        for (const value of collection.values()) shared.add(value);
      this.indexedMap = world.map;
    }
    for (const street of world.crowd.streets) shared.add(street);
    shared.add(world.crowd.marked);
    for (const cw of world.crowd.marked) shared.add(cw);
    for (const info of world.crowd.legsAt.values()) {
      shared.add(info);
      for (const leg of info.list) shared.add(leg);
    }
    for (const share of CHECKPOINT_SHARE) share(world, shared);
    for (const route of [world.route, autopilot.snap?.route])
      if (route) {
        for (const key of [
          "pts",
          "cum",
          "edges",
          "turns",
          "controls",
          "edgeStarts",
          "limitMarks",
          "zoneMarks",
          "calmingMarks",
        ])
          shared.add(route[key]);
      }
    return shared;
  }
  record(context, force = false) {
    const t = context.world.t;
    if (!force && t - this.at < this.interval - 1e-9) return;
    const shared = this.sharedFor(context);
    // Pending API operations must never be resurrected by a checkpoint.
    const pilot = {
      ...context.autopilot,
      inFlight: null,
      firing: null,
      rerouting: false,
      ...(context.autopilot.detourRouting !== undefined ? { detourRouting: null } : {}),
    };
    const state = cloneState(
      { world: context.world, fleet: context.fleet, drive: context.drive, clock: context.clock, pilot },
      shared,
    );
    // The clone's fleet/crowd point at its world. The pilot uses a shallow shell to exclude promises.
    state.pilot.world = state.world;
    const frame = {
      t,
      state,
      shared,
      night: context.world.visibility.night,
      events: context.world.events.map((e) => ({ ...e })),
    };
    this.frames.push(frame);
    this.at = t;
    if (this.frames.length > this.capacity) this.frames.shift();
    this.markers = this.markers.filter((m) => m.t >= this.frames[0].t);
  }
  mark(t, type) {
    if (
      [
        "collision",
        "red_light",
        "amber_light",
        "stop_sign",
        "failed_to_yield",
        "merged_out_of_turn",
        "close_pass",
        "contraflow_conflict",
        "reversing_conflict",
        "pothole_hit",
        "ball_warning_ignored",
        "wildlife_conflict",
        "ice_overspeed",
        "snowbank_conflict",
        "pedestrian_splashed",
        "safety",
        "brake_check",
        "parking_conflict",
        "closure_entry",
        "officer_violation",
      ].includes(type) ||
      FEATURE_METRICS.some(({ eventType, traceType }) =>
        eventType ? eventType === type : traceType && traceType === type,
      )
    )
      this.markers.push({ t, type });
  }
  restore(index, target) {
    const frame = this.frames[Math.max(0, Math.min(this.frames.length - 1, Math.round(index)))];
    if (!frame) return null;
    for (const key of Object.keys(this.spend))
      this.spend[key] = Math.max(this.spend[key], target.autopilot.totals[key] || 0);
    target.autopilot.bumpEpoch();
    const state = cloneState(frame.state, frame.shared);
    const epoch = target.autopilot.epoch;
    const callbacks = {
      onDecision: target.autopilot.onDecision,
      onEvent: target.autopilot.onEvent,
      brains: target.autopilot.brains,
    };
    // Preserve root identities used by UI handlers and the render loop.
    for (const [key, object] of [
      ["world", target.world],
      ["fleet", target.fleet],
      ["pilot", target.autopilot],
    ]) {
      for (const field of Object.keys(object)) if (!(field in state[key])) delete object[field];
      Object.assign(object, state[key]);
    }
    target.fleet.world = target.world;
    target.world.crowd.world = target.world;
    target.world.laneClosures.world = target.world;
    target.world.stepOuts.world = target.world;
    for (const restore of CHECKPOINT) restore(target.world, target.fleet);
    target.world.npcs = target.fleet.vehicles;
    for (const n of target.fleet.vehicles) if (n.path?.constraintsWorld) n.path.constraintsWorld = target.world;
    Object.assign(target.autopilot, callbacks, {
      world: target.world,
      inFlight: null,
      firing: null,
      rerouting: false,
      epoch: epoch + 1,
    });
    // (a route round a closed road still to come is asked for again: sim/road-closures.js)
    if (target.autopilot.detourRouting) target.autopilot.detourRouting = null;
    target.world.paused = true;
    target.world.visibility.setNight(frame.night);
    target.setDrive(state.drive);
    Object.assign(target.clock, state.clock);
    // (black ice is shared between frames: lay the patches the restored weather and time call for,
    // now, so that a paused frame shows them: sim/black-ice.js)
    if (target.world.ice?.enabled) target.world.ice.refresh(target.world);
    return frame;
  }
  branch(index) {
    if (!this.frames.length || !Number.isFinite(index)) return;
    index = Math.max(0, Math.min(this.frames.length - 1, Math.round(index)));
    this.frames.splice(index + 1);
    this.at = this.frames.at(-1)?.t ?? -Infinity;
    this.markers = this.markers.filter((m) => m.t <= this.at);
    this.branched = true;
    this.recordingId = crypto.randomUUID();
  }
  restoreSpend(pilot) {
    for (const key of Object.keys(this.spend)) pilot.totals[key] = Math.max(pilot.totals[key] || 0, this.spend[key]);
  }
}
