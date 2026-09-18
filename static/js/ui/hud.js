// Heads-up display: speed, nav, brain selector, decision meters, violation counters, badges.

import { $, ms, usd, num, percentile } from "../common.js";

export class Hud {
  constructor() {
    this.el = {
      root: $("#hud"), speed: $("#speed"), limit: $("#limit"), street: $("#street"), nav: $("#nav"),
      brain: $("#brain"), autopilot: $("#autopilot"), latency: $("#latency"), p50: $("#p50"), tokens: $("#tokens"),
      cost: $("#cost"), rate: $("#rate"), source: $("#source"), collisions: $("#collisions"), reds: $("#reds"),
      stops: $("#stops"), offroad: $("#offroad"), safety: $("#safety"), fallbacks: $("#fallbacks"), badge: $("#badge"),
      mapNote: $("#map-note"),
    };
    this.latencies = [];
    this.decisionTimes = [];
    this.badgeTimer = null;
  }

  show() { this.el.root.hidden = false; }

  onBrainChange(fn) { this.el.brain.addEventListener("change", () => fn(this.el.brain.value)); }
  onAutopilotClick(fn) { this.el.autopilot.addEventListener("click", fn); }
  setBrain(name) { this.el.brain.value = name; }
  setAutopilot(on) {
    this.el.autopilot.textContent = `autopilot: ${on ? "on" : "off"}`;
    this.el.autopilot.classList.toggle("on", on);
  }
  setMapNote(text) { this.el.mapNote.textContent = text; }

  recordDecision(meta) {
    if (meta.latency_ms !== undefined && meta.source !== "local") {
      this.latencies.push(meta.latency_ms);
      if (this.latencies.length > 40) this.latencies.shift();
    }
    this.decisionTimes.push(performance.now());
    this.decisionTimes = this.decisionTimes.filter((t) => t > performance.now() - 60000);
  }

  update({ ego, road, nav, violations, decision, totals, paused }) {
    this.el.speed.textContent = Math.round(Math.abs(ego.v) * 3.6);
    this.el.limit.textContent = road?.limit ? `${Math.round(road.limit * 3.6)} km/h` : "–";
    this.el.street.textContent = road?.name || (road?.on_road === false ? "off road" : "–");
    if (nav) {
      const turn = nav.next_turn && nav.next_turn !== "none" ? `${nav.next_turn} in ${Math.round(nav.turn_in_m)} m · ` : "";
      this.el.nav.textContent = `${turn}${Math.round(nav.remaining_m)} m to go`;
    } else {
      this.el.nav.textContent = paused ? "paused" : "click the minimap to set a destination";
    }
    if (decision?.meta) {
      const m = decision.meta;
      this.el.latency.textContent = m.source === "local" ? "local" : ms(m.latency_ms || 0);
      this.el.tokens.textContent = m.input_tokens ? `${num(m.input_tokens)} / ${num(totals.tokens)}` : `– / ${num(totals.tokens)}`;
      this.el.source.textContent = m.source || "–";
    }
    const p50 = percentile(this.latencies, 0.5);
    this.el.p50.textContent = p50 === null ? "–" : ms(p50);
    this.el.cost.textContent = usd(totals.cost);
    this.el.rate.textContent = String(this.decisionTimes.length);
    this.el.collisions.textContent = violations.collisions;
    this.el.reds.textContent = violations.red_lights_run;
    this.el.stops.textContent = violations.stop_signs_run;
    this.el.offroad.textContent = `${Math.round(violations.off_road_s)} s`;
    this.el.safety.textContent = violations.safety_brakes;
    this.el.fallbacks.textContent = violations.fallbacks;
    this.el.collisions.parentElement.classList.toggle("bad", violations.collisions > 0);
  }

  badge(text, kind = "", holdMs = 900) {
    const b = this.el.badge;
    b.textContent = text;
    b.className = `badge ${kind}`;
    b.hidden = false;
    clearTimeout(this.badgeTimer);
    this.badgeTimer = setTimeout(() => { b.hidden = true; }, holdMs);
  }

  flash() {
    const f = document.createElement("div");
    f.className = "flash";
    document.body.append(f);
    setTimeout(() => f.remove(), 700);
  }
}
