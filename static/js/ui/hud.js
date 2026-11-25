// Heads-up display: trip and nav card, pilot controls, instrument cluster, live decision card,
// incident counters and toast badges.

import { $, h, ms, usd, num, pct, percentile } from "../common.js";
import { SPEED_GRACE_MPS } from "../sim/drive-score.js";
import { pillarOf } from "../brain/registry.js";
import { FEATURES } from "../sim/features/index.js";
import { freeDriveOptions } from "../sim/free-drive.js";
import { getDeadZone, setDeadZone } from "./gamepad.js";
import { displaySource, formatDistance as distance, noticePriority, orderedProbabilities } from "./readouts.js";

const TURN_ARROWS = {
  left: "↰",
  right: "↱",
  "slight left": "↖",
  "slight right": "↗",
  sharp_left: "↰",
  sharp_right: "↱",
  uturn: "↶",
  roundabout: "↻",
  none: "↑",
};
const TURN_ACTIONS = {
  left: "Turn left",
  right: "Turn right",
  "slight left": "Bear left",
  "slight right": "Bear right",
  sharp_left: "Turn sharply left",
  sharp_right: "Turn sharply right",
  uturn: "Make a U-turn",
};

const CORE_FEATURE_SWITCHES = [
  ["hazards", "Hidden hazards"],
  ["buses", "Transit buses"],
  ["roadside", "Roadside flashing lights"],
  ["workzones", "Work zones & flaggers"],
  ["outages", "Signal outages"],
  ["park", "Parallel park at destination"],
  ["closures", "Lane closures (zipper)"],
  ["cyclistpass", "Cyclist passing"],
  ["scramble", "Scramble crossings"],
  ["guards", "School crossing guards"],
  ["nightflash", "Night flashing signals"],
  ["buslanes", "Bus lanes"],
  ["pxo", "Pedestrian crossovers"],
  ["restrictions", "Turn restrictions"],
  ["highbeams", "High-beam dipping"],
  ["leftonred", "Left turn on red"],
  ["redturnsigns", "No-turn-on-red signs"],
  ["amberlights", "Amber-light dilemma"],
  ["followingdistance", "Grip-aware following"],
  ["emergency", "Emergency vehicles"],
  ["streetcars", "Streetcars"],
  ["trains", "Trains & level crossings"],
  ["schoolbuses", "School buses"],
  ["plows", "Snow plows"],
];

function formatSwitchLabel(key) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (ch) => ch.toUpperCase());
}

export function freeDriveSwitchList() {
  const known = new Map(CORE_FEATURE_SWITCHES);
  // Dynamically discover every registered feature option from the feature registry and verify with freeDriveOptions.
  const probe = freeDriveOptions(new URLSearchParams());
  const activeKeys = new Set([...Object.keys(probe.world), ...Object.keys(probe.fleet)]);
  for (const feature of FEATURES) {
    const flag = feature.key.toLowerCase();
    if (!known.has(flag) && activeKeys.has(feature.key)) {
      known.set(flag, formatSwitchLabel(feature.key));
    }
  }
  return [...known.entries()];
}

export class Hud {
  constructor(root = document) {
    const find = (selector) => $(selector, root);
    this.el = {
      cluster: find(".cluster"),
      speedDisplay: find(".speed"),
      mode: find("#drive-mode"),
      speedWarning: find("#speed-warning"),
      root: find("#hud"),
      speed: find("#speed"),
      limit: find("#limit"),
      limitSign: find("#limit-sign"),
      limitLabel: find("#limit-sign small"),
      street: find("#street"),
      nav: find("#nav"),
      navCard: find("#nav-card"),
      navArrow: find("#nav-arrow"),
      navDistance: find("#nav-distance"),
      navRemaining: find("#nav-remaining"),
      brainButtons: [...root.querySelectorAll("[data-brain]")],
      menus: { decision: find("#decision-menu-toggle"), llm: find("#llm-menu-toggle") },
      weather: find("#weather"),
      time: find("#time"),
      quality: find("#quality"),
      worldSeed: find("#world-seed"),
      randomizeSeed: find("#randomize-seed"),
      deadzone: find("#gamepad-deadzone"),
      deadzoneValue: find("#gamepad-deadzone-value"),
      featureSwitchesList: find("#feature-switches-list"),
      featureSwitchesAll: find("#feature-switches-all"),
      featureSwitchesNone: find("#feature-switches-none"),
      featureSwitchesApply: find("#feature-switches-apply"),
      autopilot: find("#autopilot"),
      autopilotLabel: find("#autopilot span"),
      settingsToggle: find("#settings-toggle"),
      settings: find("#settings"),
      keysToggle: find("#keys-toggle"),
      keysHelp: find("#keys-help"),
      keysClose: find("#keys-close"),
      latency: find("#latency"),
      p50: find("#p50"),
      tokens: find("#tokens"),
      cost: find("#cost"),
      rate: find("#rate"),
      source: find("#source"),
      motion: find("#decision-motion"),
      options: find("#decision-options"),
      collisions: find("#collisions"),
      reds: find("#reds"),
      stops: find("#stops"),
      yields: find("#yields"),
      offroad: find("#offroad"),
      safety: find("#safety"),
      fallbacks: find("#fallbacks"),
      badge: find("#badge"),
      mapNote: find("#map-note"),
    };
    this.brain = "rules";
    this.latencies = [];
    this.decisionTimes = [];
    this.badgeTimer = null;
    this.badgePriority = 0;
    this.p50 = null;
    this.customTime = h("option", { value: "custom", disabled: true, hidden: true });
    this.el.time.append(this.customTime);
    this.lastUpdate = -Infinity;
    this.shownDecision = null;
    this.shownAutopilot = null;
    this._keysReturnFocus = null;
    this._settingsKeyboard = false;
    this.el.settingsToggle.addEventListener("click", (event) => {
      this._settingsKeyboard = event.detail === 0;
      this.toggleSettings();
    });
    this.el.settings.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggleSettings(false);
    });
    this.el.keysToggle.addEventListener("click", () => this.toggleKeys());
    this.el.keysClose?.addEventListener("click", () => this.toggleKeys(false));
    this.el.randomizeSeed?.addEventListener("click", () => {
      if (!this.el.worldSeed || this.el.worldSeed.disabled) return;
      const seed = Math.floor(Math.random() * 2147483647) + 1;
      this.el.worldSeed.value = String(seed);
      this.el.worldSeed.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (this.el.deadzone) {
      const initial = Math.round(getDeadZone() * 100);
      this.el.deadzone.value = String(initial);
      if (this.el.deadzoneValue) this.el.deadzoneValue.textContent = `${initial}%`;
      this.el.deadzone.setAttribute("aria-valuetext", `${initial} percent`);
      this.el.deadzone.addEventListener("input", () => {
        const pctVal = Number(this.el.deadzone.value) || 0;
        const applied = setDeadZone(pctVal / 100);
        const shown = Math.round(applied * 100);
        if (this.el.deadzoneValue) this.el.deadzoneValue.textContent = `${shown}%`;
        this.el.deadzone.setAttribute("aria-valuetext", `${shown} percent`);
      });
    }
    if (this.el.featureSwitchesList) {
      this.initFeatureSwitches(new URLSearchParams(globalThis.location?.search || ""));
    }
  }

  initFeatureSwitches(params = new URLSearchParams()) {
    const container = this.el.featureSwitchesList;
    if (!container) return;
    const switches = freeDriveSwitchList();
    container.replaceChildren(
      ...switches.map(([flag, label]) =>
        h(
          "label",
          { class: "check" },
          h("input", { type: "checkbox", "data-feature-flag": flag, checked: params.get(flag) !== "0" }),
          label,
        ),
      ),
    );
    const controls = [this.el.featureSwitchesAll, this.el.featureSwitchesNone, this.el.featureSwitchesApply];
    const boxes = () => [...container.querySelectorAll("[data-feature-flag]")];
    const sync = () => {
      const entries = boxes();
      const enabled = entries.filter((box) => box.checked).length;
      const dirty = entries.some((box) => box.checked !== box.defaultChecked);
      if (controls[0]) controls[0].disabled = enabled === entries.length;
      if (controls[1]) controls[1].disabled = enabled === 0;
      if (controls[2]) controls[2].disabled = !dirty;
      this.featureCount.textContent = `${enabled} of ${entries.length} enabled${dirty ? " · apply to restart" : ""}`;
    };
    if (!this._featureSwitchesBound) {
      this.featureCount = h("p", { class: "muted", role: "status" });
      container.before(this.featureCount);
      container.addEventListener("change", sync);
      this._featureSwitchesBound = true;
      this.el.featureSwitchesAll?.addEventListener("click", () => {
        for (const box of boxes()) box.checked = true;
        sync();
      });
      this.el.featureSwitchesNone?.addEventListener("click", () => {
        for (const box of boxes()) box.checked = false;
        sync();
      });
      this.el.featureSwitchesApply?.addEventListener("click", () => {
        const entries = boxes();
        if (entries.every((box) => box.checked === box.defaultChecked)) return;
        const next = new URL(location.href);
        next.searchParams.delete("replay");
        next.searchParams.delete("challenge");
        next.searchParams.delete("explore");
        for (const box of entries) {
          const flag = box.dataset.featureFlag;
          if (box.checked) next.searchParams.delete(flag);
          else next.searchParams.set(flag, "0");
        }
        location.assign(next);
      });
    }
    sync();
  }

  show() {
    this.el.root.hidden = false;
  }

  toggleSettings(force = this.el.settings.hidden) {
    if (force === !this.el.settings.hidden) return;
    if (!force && this.el.settings.contains(document.activeElement))
      this.el.settingsToggle.focus({ preventScroll: true });
    this.el.settings.hidden = !force;
    this.el.settingsToggle.setAttribute("aria-expanded", String(force));
    if (force && this._settingsKeyboard) this.el.settings.querySelector("select:not([disabled])")?.focus();
  }

  toggleKeys(force) {
    const wasOpen = !this.el.keysHelp.hidden;
    const open = force === undefined ? !wasOpen : !!force;
    this.el.keysHelp.hidden = !open;
    this.el.keysToggle.setAttribute("aria-pressed", String(open));
    if (open && !wasOpen) {
      this._keysReturnFocus = document.activeElement;
      this.el.keysClose?.focus?.({ preventScroll: true });
    } else if (!open && wasOpen) {
      const target = this._keysReturnFocus;
      this._keysReturnFocus = null;
      (target?.isConnected && target.getClientRects().length ? target : this.el.keysToggle).focus({
        preventScroll: true,
      });
    }
  }

  onBrainChange(fn) {
    for (const b of this.el.brainButtons) {
      b.addEventListener("click", () => fn(b.dataset.brain));
      b.addEventListener("keydown", (ev) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(ev.key)) return;
        if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.isComposing) return;
        ev.preventDefault();
        ev.stopPropagation();
        // Arrows skip hidden and unavailable drivers, so an unavailable Decision button does not trap focus on Rules.
        const buttons = this.el.brainButtons.filter(
            (button) => button === b || (!button.hidden && button.getAttribute("aria-disabled") !== "true"),
          ),
          i = buttons.indexOf(b);
        const next =
          ev.key === "Home"
            ? buttons[0]
            : ev.key === "End"
              ? buttons.at(-1)
              : buttons[(i + (["ArrowLeft", "ArrowUp"].includes(ev.key) ? -1 : 1) + buttons.length) % buttons.length];
        if (next !== b) fn(next.dataset.brain);
        buttons.find((button) => button.getAttribute("aria-checked") === "true")?.focus();
      });
    }
  }
  setBrain(name) {
    this.brain = name;
    const group = pillarOf(name); // Jev and every decision:<name> drive under Decision; every llm:<name> under LLM
    const shown = this.el.brainButtons.some((button) => !button.hidden && button.dataset.brain === group);
    for (const b of this.el.brainButtons) {
      const selected = !b.hidden && b.dataset.brain === group;
      b.setAttribute("aria-checked", String(selected));
      b.tabIndex = selected || (!shown && b.dataset.brain === "rules") ? 0 : -1;
    }
  }
  // The Decision and LLM buttons drive with the model named `label`. With no usable model they offer
  // setup instead; `menu: false` hides the ▾ (the public demo has no server to hold keys), and
  // `offered: false` hides the button too. An unavailable Decision button is skipped by arrow keys.
  setPillar(pillar, { label = "", available = false, offered = true, menu = offered } = {}) {
    const b = this.el.brainButtons.find((x) => x.dataset.brain === pillar);
    if (!b) return;
    const toggle = this.el.menus[pillar];
    b.hidden = !offered;
    if (toggle) toggle.hidden = !menu;
    this.setBrain(this.brain);
    b.classList.toggle("unavailable", !!label && !available);
    const key = pillar === "decision" ? "1" : "3";
    if (pillar === "decision") b.setAttribute("aria-disabled", String(!available));
    b.title =
      !menu && !available
        ? `${key} · decision models need the local app (uv run server.py)`
        : label
          ? `${key} · ${label}${available ? "" : pillar === "decision" && label === "Jev" ? " (needs a key)" : " (unavailable)"}${menu ? " · choose another with ▾" : ""}`
          : `${key} · connect your own model`;
  }
  setLlm(options) {
    this.setPillar("llm", options);
  }
  setDecision(options) {
    this.setPillar("decision", options);
  }
  onWeatherChange(fn) {
    this.el.weather.addEventListener("change", () => fn(this.el.weather.value));
  }
  setWeather(name) {
    this.el.weather.value = name;
  }
  onTimeChange(fn) {
    this.el.time.addEventListener("change", () => fn(this.el.time.value));
  }
  setTime(name) {
    const preset = [...this.el.time.options].some((option) => option !== this.customTime && option.value === name);
    this.customTime.hidden = preset;
    if (!preset) setText(this.customTime, name);
    this.el.time.value = preset ? name : "custom";
  }
  onQualityChange(fn) {
    this.el.quality.addEventListener("change", () => fn(this.el.quality.value));
  }
  setQuality(name) {
    this.el.quality.value = name;
    this.el.root.dataset.quality = name;
  }
  onAutopilotClick(fn) {
    this.el.autopilot.addEventListener("click", fn);
  }
  setAutopilot(on) {
    this.el.autopilot.setAttribute("aria-checked", String(on));
    setText(this.el.autopilotLabel, on ? "Autopilot on" : "Autopilot");
  }
  setMapNote(text, warning = "") {
    if (this.mapNoteText === text && this.mapNoteWarning === warning) return;
    this.mapNoteText = text;
    this.mapNoteWarning = warning;
    this.el.mapNote.replaceChildren(text, warning ? h("span", { class: "warn-text" }, ` · ${warning}`) : "");
  }

  recordDecision(meta = {}, now = performance.now()) {
    if (Number.isFinite(meta.latency_ms) && meta.latency_ms >= 0 && meta.source !== "local") {
      this.latencies.push(meta.latency_ms);
      if (this.latencies.length > 40) this.latencies.shift();
      this.p50 = percentile(this.latencies, 0.5);
    }
    this.decisionTimes.push(now);
  }

  update({ ego, road, nav, violations, decision, totals, paused, autopilot, hasRoute }, now = performance.now()) {
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    let expired = 0;
    while (this.decisionTimes[expired] <= now - 60000) expired++;
    if (expired) this.decisionTimes.splice(0, expired);
    const speed = Number.isFinite(ego.v) ? Math.abs(ego.v) : null;
    const limit = Number.isFinite(road?.limit) && road.limit > 0 ? road.limit : null;
    const speeding = speed !== null && limit !== null && speed > limit + SPEED_GRACE_MPS;
    if (this.el.speedWarning.hidden === speeding) this.el.speedWarning.hidden = !speeding;
    this.el.speedDisplay.classList.toggle("speeding", speeding);
    this.el.cluster.classList.toggle("speeding", speeding);
    setText(
      this.el.mode,
      paused
        ? "PAUSED"
        : autopilot
          ? `${this.brain.replace(/^(?:llm|decision):/, "").toUpperCase()} PILOT`
          : ego.v < -0.05
            ? "REVERSE"
            : "MANUAL",
    );
    setClass(this.el.mode, paused ? "paused" : autopilot ? "auto" : "");
    setText(this.el.speed, speed === null ? "–" : Math.round(speed * 3.6));
    setText(this.el.limit, limit === null ? "–" : Math.round(limit * 3.6));
    this.el.limitSign.classList.toggle("none", limit === null);
    // (in a school or playground zone in effect, the sign says which)
    setText(this.el.limitLabel, road?.zone ? (road.zone.kind === "school" ? "SCHOOL" : "PLAYGROUND") : "MAXIMUM");
    this.el.limitSign.classList.toggle("zone", !!road?.zone);
    const title = road?.zone
      ? `${road.zone.kind === "school" ? "School" : "Playground"} zone${road.zone.name ? `: ${road.zone.name}` : ""}`
      : "Speed limit";
    if (this.el.limitSign.title !== title) this.el.limitSign.title = title;
    setText(this.el.street, road?.name || (road?.on_road === false ? "off road" : "unnamed road"));
    this.updateNav(nav, paused, hasRoute);
    this.updateDecision(decision, autopilot);
    setText(this.el.p50, this.p50 === null ? "–" : ms(this.p50));
    setText(this.el.cost, usd(totals.cost));
    setText(this.el.rate, String(this.decisionTimes.length));
    setText(this.el.fallbacks, violations.fallbacks || 0);
    this.counter(this.el.collisions, violations.collisions, "bad");
    this.counter(this.el.reds, violations.red_lights_run, "bad");
    this.counter(this.el.stops, violations.stop_signs_run);
    this.counter(this.el.yields, violations.failed_to_yield || 0);
    this.counter(this.el.offroad, Math.round(violations.off_road_s), "hit", " s");
    this.counter(this.el.safety, violations.safety_brakes);
  }

  counter(el, value, severity = "hit", unit = "") {
    value = Number.isFinite(value) ? value : 0;
    setText(el, `${value}${unit}`);
    el.parentElement.classList.toggle(severity, value > 0);
  }

  updateNav(nav, paused, hasRoute) {
    const { navCard, navArrow, navDistance, navRemaining, nav: detail } = this.el;
    setText(
      navRemaining,
      nav && !nav.arrived && nav.next_turn && nav.next_turn !== "none" ? `${distance(nav.remaining_m)} total` : "",
    );
    if (nav && !nav.arrived) {
      const turning = nav.next_turn && nav.next_turn !== "none";
      setClass(navCard, "nav-card");
      setText(navArrow, TURN_ARROWS[nav.next_turn] || "↑");
      setText(navDistance, distance(turning ? nav.turn_in_m : nav.remaining_m));
      const action = !turning
        ? "Continue to destination"
        : nav.next_turn === "roundabout"
          ? `Roundabout${nav.exit ? `, exit ${nav.exit}` : ""}`
          : TURN_ACTIONS[nav.next_turn] || "Follow the route";
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
      setText(
        detail,
        paused
          ? "Select Resume to continue"
          : hasRoute
            ? "Return to the highlighted route"
            : "Choose a destination on the minimap or in Explore",
      );
    }
  }

  // The card only rebuilds when a new decision arrives or autopilot switches.
  updateDecision(decision, autopilot) {
    if (decision === this.shownDecision && autopilot === this.shownAutopilot) return;
    this.shownDecision = decision;
    this.shownAutopilot = autopilot;
    const { motion, options, source, latency, tokens } = this.el;
    if (!autopilot || !decision) {
      motion.className = "decision-motion off";
      motion.textContent = autopilot ? "Thinking…" : "Autopilot off";
      options.replaceChildren(
        h(
          "p",
          { class: "muted" },
          autopilot
            ? "Waiting for the first decision."
            : "Choose a drive or click the minimap; the pilot's options and their probabilities appear here.",
        ),
      );
      source.textContent = "–";
      source.className = "source-tag";
      source.title = "";
      latency.textContent = "–";
      tokens.textContent = "–";
      return;
    }
    const m = decision.meta || {};
    const candidates = decision.candidates || [];
    const chosen = candidates.find((c) => c.id === decision.chosenId);
    motion.className = `decision-motion ${decision.motion === "stop" ? "stop" : ""}`;
    motion.textContent =
      decision.motion === "stop"
        ? decision.chosenId === "hard_brake"
          ? "Braking to stop"
          : "Holding still"
        : chosen
          ? `Driving · ${describe(chosen)}`
          : decision.motion === "drive"
            ? "Driving"
            : "Waiting for a manoeuvre";
    source.textContent = displaySource(m);
    source.className = `source-tag ${m.source === "rules_fallback" || m.fallback ? "fallback" : m.source === "jev" || m.live_call ? "live" : ""}`;
    source.title = String(m.error || m.fallback || m.endpoint || "");
    latency.textContent =
      m.source === "local" ? "local" : Number.isFinite(m.latency_ms) && m.latency_ms >= 0 ? ms(m.latency_ms) : "–";
    tokens.textContent = Number.isFinite(m.input_tokens) && m.input_tokens >= 0 ? num(m.input_tokens) : "–";

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const fallback = m.source === "rules_fallback" || m.fallback;
    const probs = orderedProbabilities(fallback ? null : decision.answers?.vector?.probabilities).filter(([id]) =>
      byId.has(id),
    );
    let eligible = 0;
    let flagged = 0;
    for (const candidate of candidates) {
      if (candidate.flagged) flagged++;
      else if (candidate.eligible) eligible++;
    }
    const top = probs.slice(0, 5);
    const selected = probs.find(([id]) => id === decision.chosenId);
    if (selected && !top.includes(selected)) top.splice(4, 1, selected);
    const rows = top.map(([id, p]) => {
      const c = byId.get(id);
      const text = `${describe(c)}${c.flagged ? ` · flagged: ${String(c.reject || "road rule").replaceAll("_", " ")}` : ""}`;
      return h(
        "div",
        { class: `option ${id === decision.chosenId ? "chosen" : ""}`, title: `${text} (${id})` },
        h("i", { style: { width: `${p * 100}%` } }),
        h("span", {}, text),
        h("b", {}, pct(p)),
      );
    });
    if (!rows.length)
      rows.push(
        h(
          "p",
          { class: "muted" },
          m.source === "rules_fallback" || m.fallback
            ? `Rules fallback${chosen ? `: ${describe(chosen)}` : ": holding still"}. No model probabilities available.`
            : eligible === 0 && !flagged
              ? "No manoeuvre passed the safety checks."
              : eligible === 1 && !flagged && chosen?.eligible
                ? `Only one safe option: ${describe(chosen)}.`
                : "Resolved locally without model probabilities.",
        ),
      );
    options.replaceChildren(
      ...rows,
      h(
        "div",
        { class: "option-note" },
        `${eligible} of ${candidates.length} manoeuvres passed safety checks${flagged ? `, ${flagged} more offered flagged` : ""}${decision.flags?.length ? ` · ${decision.flags.join(", ")}` : ""}`,
      ),
    );
  }

  badge(text, kind = "", holdMs = 900) {
    const b = this.el.badge;
    const priority = noticePriority(kind);
    if (!b.hidden && priority < this.badgePriority) return;
    this.badgePriority = priority;
    setText(b, text);
    setClass(b, `badge ${kind}`);
    b.hidden = false;
    clearTimeout(this.badgeTimer);
    this.badgeTimer = setTimeout(() => {
      b.hidden = true;
    }, holdMs);
  }

  flash() {
    if (this.flashElement) return;
    const f = h("div", { class: "flash", "aria-hidden": "true" });
    this.flashElement = f;
    document.body.append(f);
    setTimeout(() => {
      f.remove();
      this.flashElement = null;
    }, 700);
  }
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SPEED_VERBS = {
  target: "Target",
  faster: "Speed up to",
  slow: "Slow to",
  hold: "Hold",
  limit: "Limit",
  cautious: "Cautious",
};
// Candidate labels are written for the model in m/s; describe them for people in km/h.
export function describe(c) {
  const law = c.law || {};
  if (c.id === "hard_brake") return "Brake hard";
  if (law.stopAtRoute !== undefined) return c.speed ? capital(c.speed) : "Stop at the line";
  if (law.kind === "reverse") return "Reverse toward the road";
  if (law.kind === "steer") return c.steer ? `Creep ${c.steer}` : "Creep forward";
  if (c.change?.dir) {
    const label = `Change to ${c.change.dir} lane`;
    return Number.isFinite(law.vTarget) ? `${label} · ${Math.round(law.vTarget * 3.6)} km/h` : label;
  }
  if (!Number.isFinite(law.vTarget)) return c.id.replaceAll("_", " ");
  const nudge = Math.round(((law.offset || 0) - (law.center || 0)) * 10) / 10;
  const shift = nudge ? ` · ${Math.abs(nudge)} m ${nudge < 0 ? "left" : "right"}` : "";
  if (law.vTarget <= 0.05) return `Stop${shift}`;
  const kmh = Math.round(law.vTarget * 3.6);
  if (kmh < 2) return `Creep forward${shift}`;
  return `${SPEED_VERBS[c.id.split("_").at(-1)] || "Drive"} ${kmh} km/h${shift}`;
}

function setText(el, value) {
  const text = String(value);
  if (el.textContent !== text) el.textContent = text;
}
function setClass(el, value) {
  if (el.className !== value) el.className = value;
}
