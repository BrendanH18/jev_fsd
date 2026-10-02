import { World } from "../sim/world.js";
import { NpcFleet } from "../sim/npc.js";
import { Route } from "../map/route.js";
import { Autopilot } from "../brain/brain.js";
import { stepWorld } from "../sim/step.js";
import { DriveScore } from "../sim/drive-score.js";
import { DriveMetrics } from "../bench/metrics.js";
import { getVehicleModel } from "../sim/vehicle-models.js";
import { challengeScenario, installChallenge, CHALLENGE_VERSION } from "./challenges.js";
import { yieldNow } from "../bench/runner.js";

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
  let arrived = false;
  const latencies = [];
  const ctx = setupChallenge(map, challenge, { brain, onEvent: event => { if (event.type === "arrived") arrived = true; },
    onDecision: decision => { if (Number.isFinite(decision.meta?.latency_ms)) latencies.push(decision.meta.latency_ms); } });
  const { world, fleet, autopilot } = ctx, score = new DriveScore(world, { title: challenge.title, map: challenge.map, driver: brain, route: world.route });
  const metrics = new DriveMetrics(world.route.length), start = performance.now();
  metrics.latencies = latencies;
  while (world.t < limit && autopilot.enabled && !shouldStop()) {
    const road = stepWorld({ world, fleet, autopilot }, 1 / 60, world.t * 1000);
    score.record(world, road, 1 / 60); metrics.record(world, autopilot.snap, road, 1 / 60);
    if (mode === "lockstep" && autopilot.firing) await autopilot.firing;
    if (mode === "realtime") {
      const ahead = world.t * 1000 - (performance.now() - start);
      if (ahead > 4) await new Promise(resolve => setTimeout(resolve, ahead));
    }
    if (world.tick % 120 === 0) await yieldNow();
  }
  return { challenge: challenge.id, version: CHALLENGE_VERSION, map: challenge.map, pack: map.pack.pack_version,
    seed: challenge.seed, weather: challenge.weather, time: challenge.time, car: "compact", brain, mode,
    ...metrics.summary(world, autopilot, arrived), report: score.finish(arrived ? "arrived" : shouldStop() ? "stopped" : "timeout"),
    stopped: shouldStop(), wall_ms: Math.round(performance.now() - start) };
}
