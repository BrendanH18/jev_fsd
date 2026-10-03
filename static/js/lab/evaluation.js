import { World } from "../sim/world.js";
import { NpcFleet } from "../sim/npc.js";
import { Route } from "../map/route.js";
import { Autopilot } from "../brain/brain.js";
import { stepWorld } from "../sim/step.js";
import { DriveScore } from "../sim/drive-score.js";
import { DriveMetrics } from "../bench/metrics.js";
import { getVehicleModel } from "../sim/vehicle-models.js";
import { challengeScenario, installChallenge } from "./challenges.js";
import { yieldNow } from "../bench/runner.js";
import { EvaluationTrace } from "./trace.js";

export const EVALUATION_ENGINE_VERSION = "drive-lab-2";

export function setupChallenge(map, challenge, { brain = "rules", onDecision = () => {}, onEvent = () => {} } = {}) {
  const world = new World(map, { seed: challenge.seed, weather: challenge.weather, parked: 0, pedestrians: 0, vehicleSpec: getVehicleModel("compact").spec });
  world.visibility.setNight(challenge.time === "night" ? 1 : 0);
  const scenario = challengeScenario(map, challenge);
  world.placeOnLane(map.lane(scenario.start.edge, scenario.start.lane), scenario.start.s);
  const fleet = new NpcFleet(world, { count: 0, bikes: 0, seed: challenge.seed });
  const autopilot = new Autopilot(world, { onDecision, onEvent }); autopilot.setBrain(brain);
  world.route = new Route(scenario.route, map, world.ego.spec); world.destination = scenario.goal;
  installChallenge(world, fleet, challenge, scenario); autopilot.setEnabled(true);
  return { world, fleet, autopilot, scenario };
}

export async function evaluateChallenge(map, challenge, { brain = "rules", mode = "lockstep", shouldStop = () => false, limit = 180 } = {}) {
  if (!["lockstep", "realtime"].includes(mode) || !Number.isFinite(limit) || limit <= 0) throw new Error("Choose a valid evaluation clock and time limit.");
  let arrived = false;
  const latencies = [], trace = new EvaluationTrace();
  const ctx = setupChallenge(map, challenge, { brain, onEvent: event => {
    if (event.type === "arrived") arrived = true;
    if (event.type === "fallback") return; // Record the fallback when its replacement decision executes below.
    const messages = { arrived: "Reached the destination", safety: "Shared emergency brake intervened", deadlock: "Deadlock recovery started", reroute: "Route recalculated" };
    trace.event(event.type, messages[event.type] || event.error || event.type, ctx.world.t);
  }, onDecision: decision => {
    if (Number.isFinite(decision.meta?.latency_ms)) latencies.push(decision.meta.latency_ms);
    trace.decision(decision, ctx.world.t);
    if (decision.meta?.source === "rules_fallback") trace.event("fallback", `Rules fallback executed: ${decision.meta.error || decision.meta.fallback || "invalid agent response"}`, ctx.world.t);
  } });
  const { world, fleet, autopilot } = ctx, score = new DriveScore(world, { title: challenge.title, map: challenge.map, driver: brain, route: world.route });
  const metrics = new DriveMetrics(world.route.length), start = performance.now();
  metrics.latencies = latencies;
  let hazardRecorded = false;
  while (world.t < limit && autopilot.enabled && !shouldStop()) {
    const road = stepWorld({ world, fleet, autopilot }, 1 / 60, world.t * 1000);
    score.record(world, road, 1 / 60); metrics.record(world, autopilot.snap, road, 1 / 60);
    if (!hazardRecorded && world.challenge.triggered) { trace.event("hazard", "Authored hazard triggered", world.t); hazardRecorded = true; }
    trace.measurements(world, score);
    if (mode === "lockstep" && autopilot.firing) await autopilot.firing;
    if (mode === "realtime") {
      const ahead = world.t * 1000 - (performance.now() - start);
      if (ahead > 4) await new Promise(resolve => setTimeout(resolve, ahead));
    }
    if (world.tick % 120 === 0) await yieldNow();
  }
  const stopped = !arrived && shouldStop();
  const status = arrived ? "arrived" : stopped ? "stopped" : "timeout";
  if (!arrived) trace.event(status, stopped ? "Evaluation stopped before arrival" : "Time limit reached before arrival", world.t);
  autopilot.setEnabled(false); // Abort outstanding decisions before saving this completed attempt.
  const summary = metrics.summary(world, autopilot, arrived);
  const report = score.finish(status);
  return { challenge: challenge.id, version: challenge.version || 1, map: challenge.map, pack: map.pack.pack_version,
    seed: challenge.seed, weather: challenge.weather, time: challenge.time, car: "compact", brain, mode,
    engine_version: EVALUATION_ENGINE_VERSION, limit_s: limit,
    ...summary, hard_brakes: report.hard_brakes, pass: !stopped && summary.pass, report, ...trace.export(),
    stopped, wall_ms: Math.round(performance.now() - start) };
}
