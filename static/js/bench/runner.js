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
import { mapClock, sunAngles, nightLevel } from "../sim/speed-zones.js";
import { WEATHER } from "../sim/weather.js";

// Defaults preserve the historical bare and city suites; parking and a clock can also be
// exercised independently in the bare world. Feature subsets still come from freeDriveOptions.
export { FEATURE_PRESETS, CITY_HOUR, CITY_WEEKDAY, presetOptions, benchmarkConfig } from "./options.js";
import { CITY_HOUR, CITY_WEEKDAY, presetOptions, benchmarkConfig } from "./options.js";
export function suiteOptions(features = "bare", options = {}) {
  const config = benchmarkConfig({ ...options, features });
  return presetOptions(features, config).world.restrictions
    ? { restrictions: { hour: config.hour ?? CITY_HOUR, weekday: CITY_WEEKDAY } } : {};
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
export function setupScenario(map, sc, { brain = "rules", npcs = 40, weather = "dry", features = "bare", park = false, hour = undefined, without = [], cover = undefined, style = null, vehicleSpec = undefined, onDecision = null, onEvent = null, tape = null } = {}) {
  const options = benchmarkConfig({ features, park, hour, without, cover });
  const preset = presetOptions(features, options);
  const world = new World(map, { seed: sc.traffic_seed, weather, vehicleSpec, ...preset.world });
  // (a city world keeps the app's clock: school zones, bus lane hours, turn restrictions and the sun go by it)
  if (features === "city" || hour !== undefined) world.setClock({ ...mapClock(options.hour ?? CITY_HOUR, map), weekday: CITY_WEEKDAY, utc_offset: map.utcOffset ?? -7 });
  if (hour !== undefined) {
    // The sky's street-light darkness (render/atmosphere.js) at that hour. Historical presets never
    // set darkness here; only an explicit hour opts into the night simulation.
    const origin = map.pack.origin;
    world.visibility.setNight(nightLevel(sunAngles(hour, { latitude: origin.lat, longitude: origin.lon, utcOffset: map.utcOffset ?? -7 }).elevation));
  }
  const lane = map.lane(sc.start.edge, sc.start.lane);
  world.placeOnLane(lane, sc.start.s);
  const fleet = new NpcFleet(world, { count: npcs, seed: sc.traffic_seed, ...preset.fleet });
  const events = [];
  const autopilot = new Autopilot(world, {
    onDecision: (d) => onDecision && onDecision(d),
    onEvent: (e) => { events.push({ t: Math.round(world.t * 10) / 10, ...e }); if (onEvent) onEvent(e); },
  });
  if (style) autopilot.style = style;
  // (a model recording records or replays the driver's answers: brain/recording.js)
  if (tape) autopilot.brains[brain] = tape.brainFor(autopilot, brain, autopilot.brains[brain]);
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

// A drive that was to park at the destination: parked within the kerb, or (with no space ever planned
// and the planner finding none, sim/parallel-park.js) stopped in its lane as a free drive does.
export function parkingVerdict(arrival, { status = null, planned = false } = {}) {
  const parked = arrival?.parked === true && arrival.within_kerb === true;
  return !parked && status === "none" && !planned ? { parked: null, no_space: true } : { parked };
}

export async function runScenario(map, sc, { brain = "rules", npcs = 40, mode = "lockstep", weather = "dry", features = "bare", park = false, hour = undefined, without = [], cover = undefined, style = null, vehicleSpec = undefined, diagnostics = false, shouldStop = () => false, tape = null } = {}) {
  if (tape && mode !== "lockstep") throw new Error("Model recordings record and replay only on the lockstep clock.");
  const metrics = new DriveMetrics(new Route(sc.route, map).length);
  const ctx = setupScenario(map, sc, { brain, npcs, weather, features, park, hour, without, cover, style, vehicleSpec, tape, onDecision: (d) => { if (d.meta && (d.meta.source === "jev" || d.meta.live_call) && d.meta.latency_ms) metrics.latencies.push(d.meta.latency_ms); } });
  const { world, autopilot, events } = ctx;
  let limit = scenarioTimeLimit(sc, { features, weather });
  const wallStart = performance.now();
  const incidents = [], previous = diagnostics ? { ...world.violations } : null;
  const context = () => {
    const road = world.roadInfo(), car = world.ego;
    return { t: Math.round(world.t * 10) / 10, x: Math.round(car.x), y: Math.round(car.y),
      street: road.name, edge: road.edge?.id, speed: Math.round(car.v * 10) / 10,
      following: autopilot.snap?.following ? { id: autopilot.snap.following.id, gap_m: autopilot.snap.following.gap_m } : null,
      nearby: world.obstaclesNear(car.x, car.y, 20).map(n => ({ id: n.id, kind: n.kind,
        x: Math.round(n.x), y: Math.round(n.y), speed: Math.round((n.v || 0) * 10) / 10 })).slice(0, 12) };
  };
  let arrived = false, steps = 0, simulationError = null, parkStatus = null, parkPlanned = false;
  const closureReplans = watchClosureReplans(autopilot, world, metrics, (length_m) => { limit = Math.max(limit, scenarioTimeLimit({ tags: { length_m } }, { features, weather })); });
  try {
    while (world.t < limit && !shouldStop()) {
      const road = stepWorld(ctx, DT, world.t * 1000);
      closureReplans();
      // (the parking plan's last status before arrival clears it, and whether the car ever had a space
      // to try: "none" with no space ever planned means none was to be had, while "none" after a plan
      // is a space given up, sim/parallel-park.js)
      if (world.park) { parkStatus = world.park.status; if (world.park.mode === "in") parkPlanned = true; }
      for (const e of world.events) if (e.type === "collision") events.push(e);
      metrics.record(world, autopilot.snap, road, DT);
      if (diagnostics) for (const [audit, value] of Object.entries(world.violations)) {
        if (value > (previous[audit] || 0) && incidents.filter(e => e.audit === audit).length < 8)
          incidents.push({ audit, value, ...context(), events: world.events.map(e => ({ ...e })) });
        previous[audit] = value;
      }
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
  // Reuse the challenge verdict: arrival alone is insufficient when parking was requested. With no
  // space to be had near the destination the car stops in its lane, as a free drive does
  // (sim/parallel-park.js), and that arrival is not a parking failure; giving up a space it had is.
  if (world.parkAtGoal) Object.assign(result, parkingVerdict(events.find((e) => e.type === "arrived"), { status: parkStatus, planned: parkPlanned }));
  if (simulationError) result.simulation_error = simulationError;
  // (only with a model recording, which leaves it out when comparing results)
  if (tape) result.model_recording = { mode: tape.mode, ...tape.stats, ...(tape.mode === "replay" ? { exact: tape.exact } : {}) };
  if (world.parkAtGoal || simulationError) {
    result.failures = failures(result);
    result.pass = result.failures.length === 0;
  }
  return { id: sc.id, tags: sc.tags, ...result, ...(diagnostics ? { diagnostics: { incidents, final: context() } } : {}), events: events.slice(0, 50), wall_ms: Math.round(performance.now() - wallStart) };
}
