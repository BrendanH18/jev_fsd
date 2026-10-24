// The autopilot: executes the current maneuver every physics tick, fires a decision on a
// schedule, and applies the brain's answer. One request in flight at a time; stale answers
// (older epoch) are discarded; timeouts fall back to the rules brain for that tick. A brain may set
// `timeoutMs` (endpoints use their configured timeout) and `questionDriven` (decision models and LLM
// endpoints: when nothing needs asking, decide locally without a call). Decision models answer the
// questions with probabilities and go through the same checks as Jev. `now` is the
// simulation clock in ms, so decision cadence follows sim time (pausing stops decisions and a
// benchmark replays the same schedule).

import { applyLaw, lateralAt, lookahead, purePursuit } from "../sim/controller.js";
import { buildSnapshot, hazardFlags } from "./sensors.js";
import { sampleCandidates, simulateAll, pathHazard } from "./candidates.js";
import { toJevState, buildQuestions, DEFAULT_STYLE } from "./state.js";
import { safetyBrake, DeadlockDetector, DESTINATION_ZONE_M } from "./safety.js";
import { api } from "../common.js";
import { Route } from "../map/route.js";
import { createAgents, validAgentChoice, isDecisionAgent } from "./registry.js";

const INTERVAL_HAZARD_MS = 250;
const INTERVAL_CLEAR_MS = 650;
const TIMEOUT_MS = 1500;
const GOAL_LATERAL_M = 1.5;   // a blocked destination counts only this close to the route lane's centre
const SPEND_KEYS = ["model", "endpoint", "latency_ms", "input_tokens", "output_tokens", "cost_usd", "cost_known", "live_call"];

export class Autopilot {
  constructor(world, { onDecision = () => {}, onEvent = () => {} } = {}) {
    this.world = world;
    this.brains = createAgents();
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
    this.creepBlockedAt = -Infinity;
    this.creepCheckedAt = -Infinity;
    this.totals = { tokens: 0, cost: 0, decisions: 0, calls: 0 };
    this.snap = null;
    this.offRouteFor = 0;
    this.rerouting = false;
    this.pendingRoutes = null;
    this.goalBlockedBy = null;
  }

  get brain() { return this.brains[this.brainName]; }
  setBrain(name) { if (this.brains[name]) { this.brainName = name; this.bumpEpoch(); } }
  bumpEpoch() {
    this.epoch++;
    if (this.inFlight) { this.inFlight.abort(); this.inFlight = null; }
    // A stale route response cannot finish the new epoch's rerouting lifecycle.
    this.rerouting = false;
    this.goalBlockedBy = null;
  }

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
    // A lane change signals toward the new lane until the car is across.
    const shift = snap.lane && snap.lane.shift && this.executing?.law;
    if (shift) world.ego.signal = lateralAt(shift, snap.routeProj.s, world.route) > lateralAt({ ...shift, shift: null }, snap.routeProj.s, world.route) ? "left" : "right";
    this.deadlock.update(world, snap, dt);
    let blockedBy = atGoal(snap) && world.ego.v < 0.3 && !snap.nav.arrived ? this.goalBlockedBy : null;
    if (blockedBy) {
      // Found at the last decision: check it is still in the way (a parked car can pull out) before
      // ending the drive.
      const candidates = sampleCandidates(snap, world);
      simulateAll(candidates, snap, world);
      blockedBy = this.goalBlockedBy = goalBlocker(candidates, world);
    }
    if (snap.nav && (snap.nav.arrived || blockedBy) && world.ego.v < 0.3) {
      this.setEnabled(false);
      world.route = null;
      world.destination = null;
      this.onEvent(blockedBy ? { type: "arrived", blocked_by: blockedBy } : { type: "arrived" });
      return;
    }
    // off route for a while: ask the server for fresh routes from here
    if (!snap.onRoute) this.offRouteFor += dt; else this.offRouteFor = 0;
    if (this.offRouteFor > 3 && !this.rerouting) this.reroute();

    const s = snap.routeProj ? snap.routeProj.s : 0;
    const brake = safetyBrake(world, snap, this.executing);
    if (brake && brake.hold) {
      world.ego.step(dt, { steer: world.ego.delta, accel: -3 });
      this.safetyActive = false;
    } else if (brake) {
      // Brake hard, still steering along the manoeuvre's path, as `hard_brake` does: holding the
      // wheel where it is would carry the car on round a bend, or a lane's jog, toward what it is
      // braking for.
      const law = this.executing?.law;
      const steer = law && law.kind === "lane" && snap.onRoute ? purePursuit(world.ego, world.route, s, lateralAt(law, s + lookahead(world.ego.v), world.route)) : world.ego.delta;
      world.ego.step(dt, { steer, accel: -8 });
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
    if (world.stuckFor > 12 && !this.executing?.override && now - this.creepBlockedAt >= 1000) {
      // Creep along the route's lane, easing back to it from another lane. Never into static
      // scenery: a creep cannot push a post or a wall aside, so it would only add a collision.
      const l = snap.lane, center = l ? l.route_center : 0;
      const back = l && l.delta !== 0 ? { shift: { from: snap.routeProj.lateral, start: s, len: 18 } } : {};
      const law = { kind: "lane", offset: center, center, lane: 0, ...(l ? { laneIdx: l.route_index, chain: l.chain } : {}), vTarget: 2, ...back };
      const creep = { id: "creep", law };
      simulateAll([creep], snap, world);
      if (creep.sim.static_collision) this.creepBlockedAt = now;   // look again in a second
      else {
        this.creepCheckedAt = now;
        this.executing = { candidate: creep, law: { ...law, s0: s }, s0: s, override: true };
        world.violations.deadlock_overrides++;
        this.onEvent({ type: "deadlock" });
      }
    }
    if (this.executing?.override && now - this.creepCheckedAt >= 1000) {
      // A creep runs until the next decision, which a slow model answer can delay past the 3 s it
      // was checked for: look ahead again each second, and stop short of static scenery. The stop
      // keeps steering along the creep's path, which may be curving around something nearer.
      this.creepCheckedAt = now;
      const creep = { id: "creep", law: this.executing.law };
      simulateAll([creep], snap, world);
      if (creep.sim.static_collision) {
        const law = { ...this.executing.law, kind: "hard_brake" };
        this.executing = { ...this.executing, candidate: { id: "creep_stop", law }, law };
        this.creepBlockedAt = now;
      }
    }
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
    this.goalBlockedBy = atGoal(snap) ? goalBlocker(candidates, world) : null;
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
    if ((!Object.keys(questions).length && this.brain?.questionDriven) || this.brainName === "rules") {
      const r = this.brains.rules.decideSync(snap, eligible);
      if (this.brainName !== "rules") { r.meta.source = "local"; r.answers = { ...local }; } else r.answers = { ...local, motion: { type: "choice", choice: r.motion, probabilities: { [r.motion]: 1 }, confidence: 1 }, vector: { type: "choice", choice: r.candidateId, probabilities: { [r.candidateId]: 1 }, confidence: 1 } };
      this.apply(r, snap, candidates, request);
      return;
    }
    const controller = new AbortController();
    this.inFlight = controller;
    const timeoutMs = this.brain.timeoutMs > 0 ? this.brain.timeoutMs : TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await Promise.race([
        this.brain.decide(snap, eligible, request, controller.signal),
        new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(new DOMException("Decision timed out", "AbortError")), { once: true })),
      ]);
      clearTimeout(timer);
      if (epoch !== this.epoch) return;
      if (!isDecisionAgent(this.brainName) && !validAgentChoice(result, eligible)) throw Object.assign(new Error("Agent returned a manoeuvre outside the eligible candidate set"), { meta: result?.meta, trace: result?.trace });
      result.meta ||= {};
      result.meta.source ||= this.brainName;
      for (const key of ["latency_ms", "input_tokens", "cost_usd"]) if (!Number.isFinite(result.meta[key]) || result.meta[key] < 0) result.meta[key] = 0;
      if (result.candidateId === null && eligible.length) {
        const r = this.brains.rules.decideSync(snap, eligible);
        result.candidateId = r.candidateId;
        result.meta.fallback = "invalid vector";
        this.world.violations.fallbacks++;
      }
      if (isDecisionAgent(this.brainName) || result.meta.live_call) this.totals.calls++;
      this.apply(result, snap, candidates, request);
    } catch (err) {
      clearTimeout(timer);
      if (epoch !== this.epoch) return;
      const r = this.brains.rules.decideSync(snap, eligible);
      // A call that happened but returned an unusable answer still counts its tokens, cost and latency.
      if (err.meta?.live_call) {
        for (const key of SPEND_KEYS) if (err.meta[key] !== undefined) r.meta[key] = err.meta[key];
        r.trace = err.trace;
        this.totals.calls++;
      }
      r.meta.source = "rules_fallback";
      r.meta.error = err.name === "AbortError" ? `timeout after ${timeoutMs} ms` : err.message;
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
      chosen = world.ego.v > 0.5 ? brakeCand : { id: "hold", law: { ...(brakeCand?.law || { offset: 0 }), kind: "lane", vTarget: 0 }, sim: null };
    }
    if (chosen) {
      const s0 = snap.routeProj ? snap.routeProj.s : 0;
      const law = { ...chosen.law, s0 };
      if (law.stopAtRoute !== undefined) law.stopAt = law.stopAtRoute - s0;
      this.executing = { candidate: chosen, law, s0, decidedAt: performance.now(), hazard: null };
    }
    if (result.routeId && this.pendingRoutes) {
      const pick = this.pendingRoutes.find((r) => r.id === result.routeId) || this.pendingRoutes[0];
      world.route = new Route(pick, world.map, world.ego.spec);
      this.pendingRoutes = null;
      this.bumpEpoch();
    } else if (this.pendingRoutes && request.questions?.route && !["rules_fallback", "local"].includes(result.meta?.source)) {
      // The model answered without a usable route: keep the first option, which the car already
      // follows, rather than paying to ask the same route question on every later decision. A
      // fallback or a local decision (an emergency stop) never asked the model, so it asks again.
      this.pendingRoutes = null;
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
    const epoch = this.epoch;
    this.rerouting = true;
    try {
      const res = await api("/api/route", { bbox: world.map.routingBbox.join(","), from: { x: world.ego.x, y: world.ego.y, heading: world.ego.psi }, to: { x: world.destination[0], y: world.destination[1] }, k: 3 });
      if (epoch !== this.epoch) return;
      if (res.routes.length) {
        if (res.routes.length === 1 || this.brainName === "rules") {
          world.route = new Route(res.routes[0], world.map, world.ego.spec);
          this.rerouting = false;
          this.bumpEpoch();
        } else {
          this.pendingRoutes = res.routes;         // the next decision asks the model which one
          world.route = new Route(res.routes[0], world.map, world.ego.spec);
        }
        this.offRouteFor = 0;
        this.onEvent({ type: "reroute", count: res.routes.length });
      }
    } catch (err) {
      if (epoch === this.epoch) this.onEvent({ type: "error", error: err.message });
    } finally {
      if (epoch === this.epoch) this.rerouting = false;
    }
  }
}

// Within the last few metres of the route, on it and in its lane: only there can something parked
// in the way mean the car has arrived. The route's projection alone does not say how far the car is
// from the destination, or which way it faces.
function atGoal(snap) {
  const l = snap.lane;
  return !!(snap.nav && snap.onRoute && snap.nav.remaining_m < DESTINATION_ZONE_M && (!l || l.delta === 0)
    && Math.abs(l ? l.lateral : snap.routeProj.lateral) < GOAL_LATERAL_M);
}

// Something parked across the last few metres to the destination: every manoeuvre along the
// route's lane that would get the car more than a metre closer hits a parked car or static
// scenery. Edging out around it or changing lanes does not reach a destination it stands on, and
// the car must be in the route's lane. Returns the obstacle's id, or null when there is a way on
// (even one ruled out for now, by a red light, say) or when traffic that will move on is in the way.
export function goalBlocker(candidates, world) {
  let by = null;
  for (const c of candidates) {
    if (c.law.kind !== "lane" && c.law.kind !== "hard_brake") continue;
    if (c.change || c.law.lane || c.law.shift || (c.law.offset ?? 0) !== (c.law.center ?? 0)) continue;
    if (!c.sim || !(c.sim.progress_m > 1)) continue;
    const hit = c.sim.collision;
    if (!hit || (!hit.static && !world.parked.list.some((p) => p.id === hit.id))) return null;
    by ||= hit.id;
  }
  return by;
}
