// Heads-up display: trip and nav card, pilot controls, instrument cluster, live decision card,
// incident counters and toast badges.

import { $, h, ms, usd, num, pct, percentile } from "../common.js";
import { SPEED_GRACE_MPS } from "../sim/drive-score.js";

const TURN_ARROWS = { left: "↰", right: "↱", "slight left": "↖", "slight right": "↗", sharp_left: "↰", sharp_right: "↱", uturn: "↶", roundabout: "↻", none: "↑" };
const MOTIONS = { drive: "Driving", stop: "Holding still" };

export class Hud {
  constructor(root = document) {
    const find = (selector) => $(selector, root);
    this.el = {
      cluster: find(".cluster"), speedDisplay: find(".speed"), mode: find("#drive-mode"), speedWarning: find("#speed-warning"),
      root: find("#hud"), speed: find("#speed"), limit: find("#limit"), limitSign: find("#limit-sign"), street: find("#street"),
      nav: find("#nav"), navCard: find("#nav-card"), navArrow: find("#nav-arrow"), navDistance: find("#nav-distance"), navRemaining: find("#nav-remaining"),
      brainButtons: [...root.querySelectorAll("[data-brain]")],
      weather: find("#weather"), time: find("#time"), quality: find("#quality"), autopilot: find("#autopilot"),
      settingsToggle: find("#settings-toggle"), settings: find("#settings"), keysToggle: find("#keys-toggle"), keysHelp: find("#keys-help"),
      latency: find("#latency"), p50: find("#p50"), tokens: find("#tokens"), cost: find("#cost"), rate: find("#rate"), source: find("#source"),
      motion: find("#decision-motion"), options: find("#decision-options"),
      collisions: find("#collisions"), reds: find("#reds"), stops: find("#stops"), yields: find("#yields"), offroad: find("#offroad"),
      safety: find("#safety"), fallbacks: find("#fallbacks"), badge: find("#badge"), mapNote: find("#map-note"),
    };
    this.brain = "rules";
    this.latencies = [];
    this.decisionTimes = [];
    this.badgeTimer = null;
    this.lastUpdate = -Infinity;
    this.shownDecision = null;
    this.shownAutopilot = null;
    this.el.settingsToggle.addEventListener("click", () => {
      const open = this.el.settings.hidden;
      this.el.settings.hidden = !open;
      this.el.settingsToggle.setAttribute("aria-expanded", String(open));
    });
    this.el.keysToggle.addEventListener("click", () => this.toggleKeys());
    find("#keys-close").addEventListener("click", () => this.toggleKeys(false));
  }

  show() { this.el.root.hidden = false; }

  toggleKeys(force) {
    const open = force === undefined ? this.el.keysHelp.hidden : force;
    this.el.keysHelp.hidden = !open;
    this.el.keysToggle.setAttribute("aria-pressed", String(open));
  }

  onBrainChange(fn) {
    for (const b of this.el.brainButtons) {
      b.addEventListener("click", () => fn(b.dataset.brain));
      b.addEventListener("keydown", (ev) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(ev.key)) return;
        ev.preventDefault();
        const buttons = this.el.brainButtons, i = buttons.indexOf(b);
        const next = ev.key === "Home" ? buttons[0] : ev.key === "End" ? buttons.at(-1)
          : buttons[(i + (["ArrowLeft", "ArrowUp"].includes(ev.key) ? -1 : 1) + buttons.length) % buttons.length];
        fn(next.dataset.brain);
        buttons.find((button) => button.getAttribute("aria-checked") === "true")?.focus();
      });
    }
  }
  setBrain(name) {
    this.brain = name;
    for (const b of this.el.brainButtons) {
      const selected = b.dataset.brain === name;
      b.setAttribute("aria-checked", String(selected));
      b.tabIndex = selected ? 0 : -1;
    }
  }
  // Jev needs a server-side key; keep the option visible so people know it exists.
  setJevAvailable(ok) {
    const b = this.el.brainButtons.find((x) => x.dataset.brain === "jev");
    b.classList.toggle("unavailable", !ok);
    b.setAttribute("aria-disabled", String(!ok));
    if (ok) b.title = "1 · TypeSafe Jev model";
    else b.title = "Set TYPESAFE_API_KEY in .env and restart the server to enable Jev";
  }
  onWeatherChange(fn) { this.el.weather.addEventListener("change", () => fn(this.el.weather.value)); }
  setWeather(name) { this.el.weather.value = name; }
  onTimeChange(fn) { this.el.time.addEventListener("change", () => fn(this.el.time.value)); }
  // a time that is not one of the presets shows as the nearest one
  setTime(name) { this.el.time.value = name; }
  onQualityChange(fn) { this.el.quality.addEventListener("change", () => fn(this.el.quality.value)); }
  setQuality(name) { this.el.quality.value = name; this.el.root.dataset.quality = name; }
  onAutopilotClick(fn) { this.el.autopilot.addEventListener("click", fn); }
  setAutopilot(on) {
    this.el.autopilot.setAttribute("aria-checked", String(on));
    this.el.autopilot.querySelector("span").textContent = on ? "Autopilot on" : "Autopilot";
  }
  setMapNote(text, warning = "") {
    this.el.mapNote.replaceChildren(text, warning ? h("span", { class: "warn-text" }, ` · ${warning}`) : "");
  }

  recordDecision(meta) {
    if (meta.latency_ms !== undefined && meta.source !== "local") {
      this.latencies.push(meta.latency_ms);
      if (this.latencies.length > 40) this.latencies.shift();
    }
    this.decisionTimes.push(performance.now());
    this.decisionTimes = this.decisionTimes.filter((t) => t > performance.now() - 60000);
  }

  update({ ego, road, nav, violations, decision, totals, paused, autopilot, hasRoute }, now = performance.now()) {
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    this.decisionTimes = this.decisionTimes.filter((t) => t > now - 60000);
    const speeding = Math.abs(ego.v) > (road?.limit || 13.9) + SPEED_GRACE_MPS;
    if (this.el.speedWarning.hidden === speeding) this.el.speedWarning.hidden = !speeding;
    this.el.speedDisplay.classList.toggle("speeding", speeding);
    this.el.cluster.classList.toggle("speeding", speeding);
    setText(this.el.mode, paused ? "PAUSED" : autopilot ? `${this.brain.toUpperCase()} PILOT` : "MANUAL");
    setClass(this.el.mode, paused ? "paused" : autopilot ? "auto" : "");
    setText(this.el.speed, Math.round(Math.abs(ego.v) * 3.6));
    setText(this.el.limit, road?.limit ? Math.round(road.limit * 3.6) : "–");
    this.el.limitSign.classList.toggle("none", !road?.limit);
    setText(this.el.street, road?.name || (road?.on_road === false ? "off road" : "unnamed road"));
    this.updateNav(nav, paused, hasRoute);
    this.updateDecision(decision, autopilot);
    const p50 = percentile(this.latencies, 0.5);
    setText(this.el.p50, p50 === null ? "–" : ms(p50));
    setText(this.el.cost, usd(totals.cost));
    setText(this.el.rate, String(this.decisionTimes.length));
    setText(this.el.fallbacks, violations.fallbacks);
    this.counter(this.el.collisions, violations.collisions, "bad");
    this.counter(this.el.reds, violations.red_lights_run, "bad");
    this.counter(this.el.stops, violations.stop_signs_run);
    this.counter(this.el.yields, violations.failed_to_yield || 0);
    this.counter(this.el.offroad, Math.round(violations.off_road_s), "hit", " s");
    this.counter(this.el.safety, violations.safety_brakes);
  }

  counter(el, value, severity = "hit", unit = "") {
    setText(el, `${value}${unit}`);
    el.parentElement.classList.toggle(severity, value > 0);
  }

  updateNav(nav, paused, hasRoute) {
    const { navCard, navArrow, navDistance, navRemaining, nav: detail } = this.el;
    setText(navRemaining, nav && !nav.arrived && nav.next_turn && nav.next_turn !== "none" ? `${distance(nav.remaining_m)} total` : "");
    if (nav && !nav.arrived) {
      const turning = nav.next_turn && nav.next_turn !== "none";
      setClass(navCard, "nav-card");
      setText(navArrow, TURN_ARROWS[nav.next_turn] || "↑");
      setText(navDistance, distance(turning ? nav.turn_in_m : nav.remaining_m));
      const action = !turning ? "Continue to destination"
        : nav.next_turn === "roundabout" ? `Roundabout${nav.exit ? `, exit ${nav.exit}` : ""}`
        : nav.next_turn === "uturn" ? "Make a U-turn" : `Turn ${nav.next_turn}`;
      const onto = turning && nav.turn_street ? ` onto ${nav.turn_street}` : "";
      setText(detail, `${action}${onto}`);
    } else if (nav?.arrived) {
      setClass(navCard, "nav-card arrived");
      setText(navArrow, "✓");
      setText(navDistance, "Arrived");
      setText(detail, "Explore drives for another route");
    } else {
      setClass(navCard, "nav-card idle");
      setText(navArrow, paused ? "Ⅱ" : "◎");
      setText(navDistance, paused ? "Paused" : hasRoute ? "Route set" : "No destination");
      setText(detail, paused ? "Press P to resume" : "Click the minimap or explore drives");
    }
  }

  // The card only rebuilds when a new decision arrives or autopilot switches.
  updateDecision(decision, autopilot) {
    if (decision === this.shownDecision && autopilot === this.shownAutopilot) return;
    this.shownDecision = decision; this.shownAutopilot = autopilot;
    const { motion, options, source, latency, tokens } = this.el;
    if (!autopilot || !decision) {
      motion.className = "decision-motion off";
      motion.textContent = autopilot ? "Thinking…" : "Autopilot off";
      options.replaceChildren(h("p", { class: "muted" }, autopilot ? "Waiting for the first decision." : "Choose a drive or click the minimap; the pilot's options and their probabilities appear here."));
      source.textContent = "–"; source.className = "source-tag"; source.title = "";
      latency.textContent = "–"; tokens.textContent = "–";
      return;
    }
    const m = decision.meta || {};
    const chosen = decision.candidates.find((c) => c.id === decision.chosenId);
    motion.className = `decision-motion ${decision.motion === "stop" ? "stop" : ""}`;
    motion.textContent = decision.motion === "stop" ? (decision.chosenId === "hard_brake" ? "Braking to stop" : "Holding still")
      : chosen ? `Driving · ${describe(chosen)}` : MOTIONS[decision.motion] || decision.motion;
    source.textContent = m.fallback ? `${m.source} · fallback` : m.source || "–";
    source.className = `source-tag ${m.source === "rules_fallback" || m.fallback ? "fallback" : m.source === "jev" ? "live" : ""}`;
    source.title = m.error || m.fallback || "";
    latency.textContent = m.source === "local" ? "local" : ms(m.latency_ms || 0);
    tokens.textContent = m.input_tokens ? num(m.input_tokens) : "–";

    const byId = new Map(decision.candidates.map((c) => [c.id, c]));
    const probs = Object.entries(m.fallback ? {} : decision.answers?.vector?.probabilities || {}).sort((a, b) => b[1] - a[1]);
    const eligible = decision.candidates.filter((c) => c.eligible).length;
    const top = probs.slice(0, 5);
    const selected = probs.find(([id]) => id === decision.chosenId);
    if (selected && !top.includes(selected)) top.splice(4, 1, selected);
    const rows = top.map(([id, p]) => {
      const text = byId.has(id) ? describe(byId.get(id)) : id;
      return h("div", { class: `option ${id === decision.chosenId ? "chosen" : ""}`, title: `${text} (${id})` },
        h("i", { style: { width: `${Math.max(2, p * 100)}%` } }), h("span", {}, text), h("b", {}, pct(p)));
    });
    if (!rows.length) rows.push(h("p", { class: "muted" },
      m.source === "rules_fallback" || m.fallback ? `Rules fallback${chosen ? `: ${describe(chosen)}` : ": holding still"}. No model probabilities available.`
        : eligible === 1 && chosen?.eligible ? `Only one safe option: ${describe(chosen)}.`
        : "Resolved locally without model probabilities."));
    options.replaceChildren(...rows, h("div", { class: "option-note" }, `${eligible} of ${decision.candidates.length} manoeuvres passed safety checks${decision.flags?.length ? ` · ${decision.flags.join(", ")}` : ""}`));
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

const distance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(m / 10) * 10)} m`);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SPEED_VERBS = { target: "Target", faster: "Speed up to", slow: "Slow to", hold: "Hold", limit: "Limit", cautious: "Cautious" };
// Candidate labels are written for the model in m/s; describe them for people in km/h.
function describe(c) {
  const law = c.law || {};
  if (c.id === "hard_brake") return "Brake hard";
  if (law.stopAtRoute !== undefined) return capital(c.speed);
  if (law.kind === "reverse") return "Reverse toward the road";
  if (law.kind === "steer") return `Creep ${c.steer}`;
  const shift = law.offset ? ` · ${Math.abs(law.offset)} m ${law.offset < 0 ? "left" : "right"}` : "";
  if (law.vTarget <= 0.05) return `Stop${shift}`;
  const kmh = Math.round(law.vTarget * 3.6);
  if (kmh < 2) return `Creep forward${shift}`;
  return `${SPEED_VERBS[c.id.split("_").at(-1)] || "Drive"} ${kmh} km/h${shift}`;
}

function setText(el, value) {
  const text = String(value);
  if (el.textContent !== text) el.textContent = text;
}
function setClass(el, value) { if (el.className !== value) el.className = value; }
