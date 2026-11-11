// Plays one scenario headlessly with the same world, traffic, autopilot, and step function as the
// app. Two clocks:
//   lockstep  the sim waits for each decision, so results measure decision quality alone and are
//             reproducible for the Rules brain
//   realtime  the sim advances with the wall clock while requests are in flight, as in the app, so
//             model latency counts

import { World } from "../sim/world.js";
import { NpcFleet } from "../sim/npc.js";
import { stepWorld } from "../sim/step.js";
import { Autopilot } from "../brain/brain.js";
import { Route } from "../map/route.js";
import { DriveMetrics, failures } from "./metrics.js";
import { freeDriveOptions } from "../sim/free-drive.js";
import { mapClock } from "../sim/speed-zones.js";
import { WEATHER } from "../sim/weather.js";

// Which world a scenario plays in:
//   bare  every opt-in feature off, as the seeded benchmark always was, so earlier records compare
//   city  the free drive's features (sim/free-drive.js), on the app's default afternoon clock, without
//         parking at the destination (the benchmark scores arrival, not parking)
export const FEATURE_PRESETS = ["bare", "city"];
export const CITY_HOUR = 15.5, CITY_WEEKDAY = 0;
// What buildSuite needs for a preset: a city suite routes as the app does, keeping to turn restrictions.
export const suiteOptions = (features = "bare") => (presetOptions(features).world.restrictions ? { restrictions: { hour: CITY_HOUR, weekday: CITY_WEEKDAY } } : {});
export function presetOptions(features = "bare") {
  if (!FEATURE_PRESETS.includes(features)) throw new Error(`Unknown feature preset "${features}": use ${FEATURE_PRESETS.join(" or ")}.`);
  if (features === "bare") return { world: {}, fleet: {} };
  return freeDriveOptions(new URLSearchParams({ park: "0" }), { hour: CITY_HOUR });
}

const DT = 1 / 60;

// Yield to the event loop without the 1 s timer clamp browsers apply to hidden tabs.
const channel = new MessageChannel();
const waiting = [];
channel.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };
export const yieldNow = () => new Promise((r) => { waiting.push(r); channel.port2.postMessage(0); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function scenarioTimeLimit(sc, { features = "bare", weather = "dry" } = {}) {
  const limit = Math.max(120, sc.tags.length_m / 2.5);
  // The city adds single-file snowbank stretches and blind-corner creeps to the slower winter
  // cruise. Allow that weather's speed factor in its deadline too; keep historical bare limits.
  return features === "city" && weather === "snow" ? limit / WEATHER.snow.speed : limit;
}

// A world set up for a scenario, ready to step. The app uses this to replay a scenario in 3D.
export function setupScenario(map, sc, { brain = "rules", npcs = 40, weather = "dry", features = "bare", style = null, vehicleSpec = undefined, onDecision = null, onEvent = null } = {}) {
  const preset = presetOptions(features);
  const world = new World(map, { seed: sc.traffic_seed, weather, vehicleSpec, ...preset.world });
  // (a city world keeps the app's clock: school zones, bus lane hours, turn restrictions and the sun go by it)
  if (features === "city") world.setClock({ ...mapClock(CITY_HOUR, map), weekday: CITY_WEEKDAY, utc_offset: map.utcOffset ?? -7 });
  const lane = map.lane(sc.start.edge, sc.start.lane);
  world.placeOnLane(lane, sc.start.s);
  const fleet = new NpcFleet(world, { count: npcs, seed: sc.traffic_seed, ...preset.fleet });
  const events = [];
  const autopilot = new Autopilot(world, {
    onDecision: (d) => onDecision && onDecision(d),
    onEvent: (e) => { events.push({ t: Math.round(world.t * 10) / 10, ...e }); if (onEvent) onEvent(e); },
  });
  if (style) autopilot.style = style;
  autopilot.setBrain(brain);
  world.route = new Route(sc.route, map, world.ego.spec);
  world.destination = sc.goal;
  autopilot.setEnabled(true);
  return { world, fleet, autopilot, events };
}

// A road closed ahead (sim/road-closures.js) sends the car round it, further than the route its
// deadline was set for. Call the returned function after each step: when a closure re-plan settles
// having replaced the route, `onDetour` gets the distance driven plus the new route's length. A
// re-plan that fails or finds nothing, and every other re-plan, leaves the deadline alone.
export function watchClosureReplans(autopilot, world, metrics, onDetour) {
  let seen = null;
  return () => {
    const pending = autopilot.closureRouting;
    if (!pending || pending === seen) return;
    seen = pending;
    const before = world.route;
    pending.then(() => { if (world.route && world.route !== before) onDetour(metrics.distance + world.route.length); }, () => {});
  };
}

export async function runScenario(map, sc, { brain = "rules", npcs = 40, mode = "lockstep", weather = "dry", features = "bare", style = null, vehicleSpec = undefined, shouldStop = () => false } = {}) {
  const metrics = new DriveMetrics(new Route(sc.route, map).length);
  const ctx = setupScenario(map, sc, { brain, npcs, weather, features, style, vehicleSpec, onDecision: (d) => { if (d.meta && (d.meta.source === "jev" || d.meta.live_call) && d.meta.latency_ms) metrics.latencies.push(d.meta.latency_ms); } });
  const { world, autopilot, events } = ctx;
  let limit = scenarioTimeLimit(sc, { features, weather });
  const wallStart = performance.now();
  let arrived = false, steps = 0, simulationError = null;
  const closureReplans = watchClosureReplans(autopilot, world, metrics, (length_m) => { limit = Math.max(limit, scenarioTimeLimit({ tags: { length_m } }, { features, weather })); });
  try {
    while (world.t < limit && !shouldStop()) {
      const road = stepWorld(ctx, DT, world.t * 1000);
      closureReplans();
      for (const e of world.events) if (e.type === "collision") events.push(e);
      metrics.record(world, autopilot.snap, road, DT);
      steps++;
      if (!autopilot.enabled) { arrived = events.some((e) => e.type === "arrived"); break; }
      if (mode === "lockstep") {
        if (autopilot.inFlight && autopilot.firing) await autopilot.firing;
        while (autopilot.rerouting) await sleep(5);
        // (and a route round a closed road, so the detour comes at the same step every run: sim/road-closures.js)
        if (autopilot.closureRouting) await autopilot.closureRouting;
        if (steps % 240 === 0) await yieldNow();
      } else {
        // keep sim time from running ahead of the wall clock
        const ahead = world.t * 1000 - (performance.now() - wallStart);
        if (ahead > 4) await sleep(ahead);
        else if (steps % 60 === 0) await yieldNow();
      }
    }
  } catch (error) {
    simulationError = String(error?.message || error || "Unknown simulation error").slice(0, 240);
    autopilot.setEnabled(false);
    events.push({ type: "simulation_error", t: Math.round(world.t * 10) / 10, message: simulationError });
  }
  const result = metrics.summary(world, autopilot, arrived);
  if (simulationError) {
    result.simulation_error = simulationError;
    result.failures = failures(result);
    result.pass = false;
  }
  return { id: sc.id, tags: sc.tags, ...result, events: events.slice(0, 50), wall_ms: Math.round(performance.now() - wallStart) };
}
