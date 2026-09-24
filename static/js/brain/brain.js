// The autopilot: executes the current maneuver every physics tick, fires a decision on a
// schedule, and applies the brain's answer. One request in flight at a time; stale answers
// (older epoch) are discarded; timeouts fall back to the rules brain for that tick. `now` is the
// simulation clock in ms, so decision cadence follows sim time (pausing stops decisions and a
// benchmark replays the same schedule).

import { applyLaw } from "../sim/controller.js";
import { buildSnapshot, hazardFlags } from "./sensors.js";
import { sampleCandidates, simulateAll, pathHazard } from "./candidates.js";
import { toJevState, buildQuestions, DEFAULT_STYLE } from "./state.js";
import { RulesBrain } from "./rules.js";
import { JevBrain } from "./jev.js";
import { safetyBrake, DeadlockDetector } from "./safety.js";
import { api } from "../common.js";
import { Route } from "../map/route.js";

const INTERVAL_HAZARD_MS = 250;
const INTERVAL_CLEAR_MS = 650;
const TIMEOUT_MS = 1500;

export class Autopilot {
  constructor(world, { onDecision = () => {}, onEvent = () => {} } = {}) {
    this.world = world;
    this.brains = { rules: new RulesBrain(), jev: new JevBrain() };
    this.brainName = "jev";
    this.enabled = false;
    this.epoch = 0;
    this.executing = null;   // { candidate, law, s0, decidedAt, hazard }
    this.inFlight = null;
    this.lastStart = -Infinity;
    this.lastDecision = null;
    this.style = DEFAULT_STYLE;
    this.onDecision = onDecision;
    this.onEvent = onEvent;
    this.deadlock = new DeadlockDetector();
    this.totals = { tokens: 0, cost: 0, decisions: 0, calls: 0 };
    this.snap = null;
    this.offRouteFor = 0;
    this.rerouting = false;
    this.pendingRoutes = null;
  }

  get brain() { return this.brains[this.brainName]; }
  setBrain(name) { if (this.brains[name]) { this.brainName = name; this.bumpEpoch(); } }
  bumpEpoch() { this.epoch++; if (this.inFlight) { this.inFlight.abort(); this.inFlight = null; } }

  setEnabled(on) {
    this.enabled = on;
    this.world.ego.signal = null;
    this.bumpEpoch();
    this.executing = null;
    this.lastStart = -Infinity;
    if (!on) this.world.stuckFor = 0;
  }

  // Called every physics step, before world.audit.
  step(dt, now) {
    const world = this.world;
    if (!this.enabled || !world.route) return;
    const road = world._road = world.roadInfo();
    const snap = this.snap = buildSnapshot(world, this.executing);
    const nav = snap.nav;
    world.ego.signal = nav && nav.turn_in_m < 40 && (nav.next_turn === "left" || nav.next_turn === "right") ? nav.next_turn : null;
    this.deadlock.update(world, snap, dt);
    if (snap.nav && snap.nav.arrived && world.ego.v < 0.3) {
      this.setEnabled(false);
      world.route = null;
      world.destination = null;
      this.onEvent({ type: "arrived" });
      return;
    }
    // off route for a while: ask the server for fresh routes from here
    if (!snap.onRoute) this.offRouteFor += dt; else this.offRouteFor = 0;
    if (this.offRouteFor > 3 && !this.rerouting) this.reroute();

    // execute the current law (or hold still)
    const s = snap.routeProj ? snap.routeProj.s : 0;
    const brake = safetyBrake(world, snap, this.executing);
    if (brake && brake.hold) {
      world.ego.step(dt, { steer: world.ego.delta, accel: -3 });
      this.safetyActive = false;
    } else if (brake) {
      world.ego.step(dt, { steer: world.ego.delta, accel: -8 });
      if (!this.safetyActive) { world.violations.safety_brakes++; this.onEvent({ type: "safety", brake }); }
      this.safetyActive = true;
    } else {
      this.safetyActive = false;
      if (this.executing && snap.onRoute) {
        applyLaw(world.ego, this.executing.law, world.route, s, dt);
      } else if (this.executing && this.executing.law.kind !== "lane") {
        applyLaw(world.ego, this.executing.law, world.route, s, dt);
      } else {
        world.ego.step(dt, { steer: 0, accel: world.ego.v > 0 ? -3 : 0 });
      }
    }
    if (world.stuckFor > 12 && !this.executing?.override) {
      this.executing = { candidate: { id: "creep", law: { kind: "lane", offset: 0, vTarget: 2 } }, law: { kind: "lane", offset: 0, vTarget: 2, s0: s }, s0: s, override: true };
      world.violations.deadlock_overrides++;
      this.onEvent({ type: "deadlock" });
    }
    // schedule
    const flags = hazardFlags(snap);
    const interval = flags.length ? INTERVAL_HAZARD_MS : INTERVAL_CLEAR_MS;
    if (!this.inFlight && now - this.lastStart >= interval) this.firing = this.fire(snap, now, flags);
  }

  async fire(snap, now, flags) {
    const world = this.world;
    this.lastStart = now;
    const epoch = this.epoch;
    const candidates = sampleCandidates(snap, world);
    const { eligible, rejected, mustStop } = simulateAll(candidates, snap, world);
    if (this.executing && this.executing.candidate) {
      this.executing.hazard = pathHazard(this.executing, snap, world);
      if (this.executing.hazard) snap.current_path_hazard = this.executing.hazard;
    }
    const routeOptions = this.pendingRoutes;
    const state = toJevState(snap, candidates, { rejected, routeOptions }, this.style);
    const { questions, local } = buildQuestions(snap, eligible, { routeOptions });
    const request = { epoch, state, questions, local, candidates, eligible, flags, mustStop };
    if (!eligible.length) {
      this.apply({ motion: "stop", candidateId: "hard_brake", meta: { source: "local", latency_ms: 0, input_tokens: 0, cost_usd: 0, model: "none" }, answers: { ...local } }, snap, candidates, request);
      return;
    }
    if (!Object.keys(questions).length || this.brainName === "rules") {
      const r = this.brains.rules.decideSync(snap, eligible);
      if (this.brainName !== "rules") { r.meta.source = "local"; r.answers = { ...local }; } else r.answers = { ...local, motion: { type: "choice", choice: r.motion, probabilities: { [r.motion]: 1 }, confidence: 1 }, vector: { type: "choice", choice: r.candidateId, probabilities: { [r.candidateId]: 1 }, confidence: 1 } };
      this.apply(r, snap, candidates, request);
      return;
    }
    const controller = new AbortController();
    this.inFlight = controller;
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const result = await this.brain.decide(snap, eligible, request, controller.signal);
      clearTimeout(timer);
      if (epoch !== this.epoch) return;
      if (result.candidateId === null && eligible.length) {
        const r = this.brains.rules.decideSync(snap, eligible);
        result.candidateId = r.candidateId;
        result.meta.fallback = "invalid vector";
        this.world.violations.fallbacks++;
      }
      this.totals.calls++;
      this.apply(result, snap, candidates, request);
    } catch (err) {
      clearTimeout(timer);
      if (epoch !== this.epoch) return;
      const r = this.brains.rules.decideSync(snap, eligible);
      r.meta.source = "rules_fallback";
      r.meta.error = err.name === "AbortError" ? `timeout after ${TIMEOUT_MS} ms` : err.message;
      r.answers = { ...local };
      this.world.violations.fallbacks++;
      this.onEvent({ type: "fallback", error: r.meta.error, status: err.status });
      this.apply(r, snap, candidates, request);
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  apply(result, snap, candidates, request) {
    const world = this.world;
    let chosen = candidates.find((c) => c.id === result.candidateId) || null;
    if (result.motion === "stop") {
      const brakeCand = candidates.find((c) => c.id === "hard_brake");
      chosen = world.ego.v > 0.5 ? brakeCand : { id: "hold", law: { kind: "lane", offset: 0, vTarget: 0 }, sim: null };
    }
    if (chosen) {
      const s0 = snap.routeProj ? snap.routeProj.s : 0;
      const law = { ...chosen.law, s0 };
      if (law.stopAtRoute !== undefined) law.stopAt = law.stopAtRoute - s0;
      this.executing = { candidate: chosen, law, s0, decidedAt: performance.now(), hazard: null };
    }
    if (result.routeId && this.pendingRoutes) {
      const pick = this.pendingRoutes.find((r) => r.id === result.routeId) || this.pendingRoutes[0];
      world.route = new Route(pick, world.map);
      this.pendingRoutes = null;
      this.bumpEpoch();
    }
    this.totals.decisions++;
    this.totals.tokens += result.meta.input_tokens || 0;
    this.totals.cost += result.meta.cost_usd || 0;
    this.lastDecision = {
      state: request.state, questions: request.questions, answers: result.answers, meta: result.meta, trace: result.trace,
      candidates, chosenId: chosen ? chosen.id : null, motion: result.motion, flags: request.flags, at: performance.now(),
    };
    this.onDecision(this.lastDecision);
  }

  async reroute() {
    const world = this.world;
    if (!world.destination) return;
    this.rerouting = true;
    try {
      const res = await api("/api/route", { from: { x: world.ego.x, y: world.ego.y, heading: world.ego.psi }, to: { x: world.destination[0], y: world.destination[1] }, k: 3 });
      if (res.routes.length) {
        if (res.routes.length === 1 || this.brainName === "rules") {
          world.route = new Route(res.routes[0], world.map);
          this.bumpEpoch();
        } else {
          this.pendingRoutes = res.routes;         // the next decision asks Jev which one
          world.route = new Route(res.routes[0], world.map);
        }
        this.offRouteFor = 0;
        this.onEvent({ type: "reroute", count: res.routes.length });
      }
    } catch (err) {
      this.onEvent({ type: "error", error: err.message });
    } finally {
      this.rerouting = false;
    }
  }
}
