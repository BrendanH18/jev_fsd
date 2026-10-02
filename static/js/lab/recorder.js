// In-memory checkpoints preserve prototypes, object identity, and seeded random streams.
// Immutable map/render resources are shared; mutable driving state is copied.
export function cloneState(value, shared = new Set(), seen = new Map()) {
  if (value === null || !["object", "function"].includes(typeof value) || shared.has(value)) return value;
  if (seen.has(value)) return seen.get(value);
  if (typeof value === "function") {
    const copy = value.clone ? value.clone() : value;
    seen.set(value, copy); return copy;
  }
  if (value instanceof Map) {
    const copy = new Map(); seen.set(value, copy);
    for (const [key, entry] of value) copy.set(cloneState(key, shared, seen), cloneState(entry, shared, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set(); seen.set(value, copy);
    for (const entry of value) copy.add(cloneState(entry, shared, seen));
    return copy;
  }
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor.get || descriptor.set) { Object.defineProperty(copy, key, descriptor); continue; }
    // Three.js instance handles belong to the renderer, not the simulation checkpoint.
    if (key === "instances") { copy[key] = value[key]; continue; }
    copy[key] = cloneState(value[key], shared, seen);
  }
  return copy;
}

export class DriveRecorder {
  constructor({ seconds = 120, interval = 0.5 } = {}) {
    this.capacity = Math.ceil(seconds / interval) + 1; this.interval = interval;
    this.frames = []; this.at = -Infinity; this.markers = []; this.branched = false;
    this.spend = { cost: 0, tokens: 0, calls: 0 };
  }
  reset() { this.frames = []; this.markers = []; this.at = -Infinity; this.branched = false; this.baseShared = null; this.indexedMap = null; }
  sharedFor({ world, fleet, autopilot }) {
    const shared = this.baseShared ||= new Set([world.map, world.staticObstacles, world.visibility, world.crowd.streets,
      world.crowd.legsAt, world.crowd.ringNodes, autopilot.brains, autopilot.onDecision, autopilot.onEvent]);
    if (!this.indexedMap) {
      for (const collection of [world.map.lanes, world.map.edges, world.map.nodes]) for (const value of collection.values()) shared.add(value);
      this.indexedMap = world.map;
    }
    for (const street of world.crowd.streets) shared.add(street);
    for (const info of world.crowd.legsAt.values()) { shared.add(info); for (const leg of info.list) shared.add(leg); }
    for (const route of [world.route, autopilot.snap?.route]) if (route) {
      for (const key of ["pts", "cum", "edges", "turns", "controls", "edgeStarts", "limitMarks"]) shared.add(route[key]);
    }
    return shared;
  }
  record(context, force = false) {
    const t = context.world.t;
    if (!force && t - this.at < this.interval - 1e-9) return;
    const shared = this.sharedFor(context);
    // Pending API operations must never be resurrected by a checkpoint.
    const pilot = { ...context.autopilot, inFlight: null, firing: null, rerouting: false };
    const state = cloneState({ world: context.world, fleet: context.fleet, drive: context.drive, clock: context.clock, pilot }, shared);
    // The clone's fleet/crowd point at its world. The pilot uses a shallow shell to exclude promises.
    state.pilot.world = state.world;
    const frame = { t, state, shared, night: context.world.visibility.night, events: context.world.events.map(e => ({ ...e })) };
    this.frames.push(frame); this.at = t;
    if (this.frames.length > this.capacity) this.frames.shift();
    this.markers = this.markers.filter(m => m.t >= this.frames[0].t);
  }
  mark(t, type) {
    if (["collision", "red_light", "stop_sign", "failed_to_yield", "safety"].includes(type)) this.markers.push({ t, type });
  }
  restore(index, target) {
    const frame = this.frames[Math.max(0, Math.min(this.frames.length - 1, Math.round(index)))];
    if (!frame) return null;
    for (const key of Object.keys(this.spend)) this.spend[key] = Math.max(this.spend[key], target.autopilot.totals[key] || 0);
    target.autopilot.bumpEpoch();
    const state = cloneState(frame.state, frame.shared);
    const epoch = target.autopilot.epoch;
    const callbacks = { onDecision: target.autopilot.onDecision, onEvent: target.autopilot.onEvent, brains: target.autopilot.brains };
    // Preserve root identities used by UI handlers and the render loop.
    for (const [key, object] of [["world", target.world], ["fleet", target.fleet], ["pilot", target.autopilot]]) {
      for (const field of Object.keys(object)) if (!(field in state[key])) delete object[field];
      Object.assign(object, state[key]);
    }
    target.fleet.world = target.world; target.world.crowd.world = target.world;
    target.world.npcs = target.fleet.vehicles;
    Object.assign(target.autopilot, callbacks, { world: target.world, inFlight: null, firing: null, rerouting: false, epoch: epoch + 1 });
    target.world.paused = true;
    target.world.visibility.setNight(frame.night);
    target.setDrive(state.drive); Object.assign(target.clock, state.clock);
    return frame;
  }
  branch(index) {
    this.frames.splice(index + 1); this.at = this.frames.at(-1)?.t ?? -Infinity;
    this.markers = this.markers.filter(m => m.t <= this.at); this.branched = true;
  }
  restoreSpend(pilot) { for (const key of Object.keys(this.spend)) pilot.totals[key] = Math.max(pilot.totals[key] || 0, this.spend[key]); }
}
