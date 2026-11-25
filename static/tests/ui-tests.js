// Run on /tests or from the simulator: await import('/tests/ui-tests.js').then(m => m.runUiTests())
// Use the real page markup in a detached root so the live HUD and driver remain untouched.
import { downloadCsv, downloadJson } from "../js/ui/export.js";
import { Cockpit } from "../js/ui/cockpit.js";
import { ModelSetup } from "../js/ui/model-setup.js";
import { DriveLab } from "../js/ui/lab.js";
import { Hud } from "../js/ui/hud.js";
import { TouchControls, STEER_RANGE_PX } from "../js/ui/touch.js";
import { bindMapPicker } from "../js/ui/map-picker.js";
import { clampLook, photoFilename, PhotoMode } from "../js/ui/photo-mode.js";
import { Input } from "../js/ui/input.js";

export async function runUiTests() {
  const html = await fetch("/").then((r) => r.text());
  const page = new DOMParser().parseFromString(html, "text/html");
  const root = document.createElement("div");
  root.append(page.querySelector("#hud"));
  const hud = new Hud(root),
    results = [];
  const check = (name, ok) => results.push({ name, ok: !!ok });
  const candidate = (id, speed = 10) => ({ id, eligible: true, law: { kind: "lane", vTarget: speed, offset: 0 } });
  const candidates = [candidate("keep_lane_target"), candidate("keep_lane_slow", 5)];
  const decision = (source, extra = {}) => ({
    candidates,
    chosenId: candidates[0].id,
    motion: "drive",
    meta: { source, latency_ms: 32, input_tokens: 120 },
    answers: {},
    ...extra,
  });

  hud.updateDecision(decision("rules_fallback"), true);
  check(
    "Rules fallbacks never appear as a successful model response",
    hud.el.source.classList.contains("fallback") && !hud.el.source.classList.contains("live"),
  );
  check(
    "Fallbacks do not claim that one option passed safety checks",
    hud.el.options.textContent.includes("Rules fallback") && !hud.el.options.textContent.includes("Only one"),
  );
  hud.updateDecision(decision("local"), true);
  check("Multiple local options do not claim a single safe choice", !hud.el.options.textContent.includes("Only one"));
  hud.updateDecision(decision("local", { candidates: [candidates[0]] }), true);
  check(
    "A single eligible local option is described accurately",
    hud.el.options.textContent.includes("Only one safe option"),
  );
  hud.updateDecision(
    decision("jev", {
      meta: { source: "jev", fallback: "invalid vector" },
      answers: { vector: { probabilities: { nonsense: 1 } } },
    }),
    true,
  );
  check(
    "Invalid model vectors show fallback status and suppress invalid probabilities",
    hud.el.source.classList.contains("fallback") && !hud.el.options.textContent.includes("nonsense"),
  );
  hud.updateDecision(
    decision("jev", { answers: { vector: { probabilities: { keep_lane_target: 0.8, keep_lane_slow: 0.2 } } } }),
    true,
  );
  check(
    "Model candidate speeds use km/h",
    hud.el.options.textContent.includes("36 km/h") && hud.el.options.textContent.includes("80%"),
  );
  const options = hud.el.options.firstChild;
  hud.updateDecision(hud.shownDecision, true);
  check("Unchanged decisions reuse the existing option nodes", options === hud.el.options.firstChild);
  const many = Array.from({ length: 6 }, (_, i) => candidate(`option_${i}`));
  hud.updateDecision(
    decision("jev", {
      candidates: many,
      chosenId: "option_5",
      answers: { vector: { probabilities: Object.fromEntries(many.map((c, i) => [c.id, (6 - i) / 21])) } },
    }),
    true,
  );
  check(
    "The executed option stays visible even outside the five largest probabilities",
    hud.el.options.querySelector(".chosen")?.title.includes("option_5"),
  );
  hud.updateDecision(decision("local", { motion: "stop", chosenId: "hard_brake" }), true);
  check(
    "An emergency braking decision is not described as holding still",
    hud.el.motion.textContent === "Braking to stop",
  );
  hud.updateDecision(decision("local", { motion: "stop", chosenId: "hold" }), true);
  check("A stationary stop is described as holding still", hud.el.motion.textContent === "Holding still");
  hud.updateDecision(null, false);
  check(
    "Disabling autopilot clears current decision telemetry",
    hud.el.latency.textContent === "–" && hud.el.tokens.textContent === "–" && hud.el.source.title === "",
  );

  hud.setBrain("rules");
  hud.onBrainChange((name) => hud.setBrain(name));
  const [rules, pillar] = hud.el.brainButtons;
  check(
    "The pilot row offers the three pillars in order: Rules, Decision, LLM",
    hud.el.brainButtons.map((b) => b.dataset.brain).join() === "rules,decision,llm" &&
      pillar.textContent === "Decision" &&
      hud.el.menus.decision?.getAttribute("aria-haspopup") === "menu",
  );
  hud.setDecision({ label: "Jev", available: true });
  rules.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  check(
    "Brain radio buttons support arrow-key selection and one tab stop",
    pillar.getAttribute("aria-checked") === "true" && pillar.tabIndex === 0 && rules.tabIndex === -1,
  );
  hud.setBrain("rules");
  hud.setDecision({ label: "LiquidAI: d1 (OpenRouter)", available: true });
  hud.setBrain("decision:d1");
  check(
    "Jev and every decision:<name> driver select the Decision button, which names the model",
    pillar.getAttribute("aria-checked") === "true" &&
      pillar.title.includes("LiquidAI: d1") &&
      pillar.title.startsWith("1 ·"),
  );
  hud.setBrain("jev");
  check("The built-in Jev drives under the Decision button too", pillar.getAttribute("aria-checked") === "true");
  const llm = hud.el.brainButtons.find((b) => b.dataset.brain === "llm");
  hud.setLlm({ label: "GPT-6 Luna (OpenRouter)", available: true });
  hud.setBrain("llm:luna");
  check(
    "Every LLM driver selects the LLM button, which names the model and keeps one tab stop",
    llm.getAttribute("aria-checked") === "true" &&
      llm.tabIndex === 0 &&
      rules.tabIndex === -1 &&
      pillar.tabIndex === -1 &&
      llm.title.includes("GPT-6 Luna") &&
      !llm.hidden,
  );
  hud.setLlm({ offered: false });
  check("The LLM button and its menu are hidden without a server to hold keys", llm.hidden && hud.el.menus.llm.hidden);
  hud.setDecision({ label: "Jev", available: false, menu: false });
  check(
    "Without a server the Decision button stays, unavailable, without its menu",
    !pillar.hidden &&
      hud.el.menus.decision.hidden &&
      pillar.getAttribute("aria-disabled") === "true" &&
      pillar.title.includes("local app"),
  );
  hud.setBrain("jev");
  hud.setDecision({ label: "Jev", available: false });
  check(
    "An unavailable decision model is exposed to assistive technology and offers a key",
    pillar.getAttribute("aria-disabled") === "true" &&
      pillar.classList.contains("unavailable") &&
      pillar.title.includes("needs a key") &&
      !hud.el.menus.decision.hidden,
  );
  hud.setLlm({ label: "GPT-6 Luna (OpenRouter)", available: true });
  hud.setBrain("rules");
  rules.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  check(
    "Arrow keys skip an unavailable Decision button and reach the LLM button",
    llm.getAttribute("aria-checked") === "true",
  );
  hud.setDecision({ label: "Jev", available: true });
  check(
    "A usable decision model clears the unavailable state",
    pillar.getAttribute("aria-disabled") === "false" && !pillar.classList.contains("unavailable"),
  );
  hud.brain = "decision:d1";
  hud.update(
    {
      ego: { v: 0 },
      road: null,
      nav: null,
      violations: {
        collisions: 0,
        red_lights_run: 0,
        stop_signs_run: 0,
        off_road_s: 0,
        safety_brakes: 0,
        fallbacks: 0,
      },
      decision: null,
      totals: { cost: 0 },
      paused: false,
      autopilot: true,
      hasRoute: true,
    },
    -1000,
  );
  check("The drive mode names a decision driver without its prefix", hud.el.mode.textContent === "D1 PILOT");
  hud.brain = "rules";
  hud.lastUpdate = -Infinity;
  hud.toggleKeys(true);
  check(
    "Shortcut help synchronizes its button state",
    !hud.el.keysHelp.hidden && hud.el.keysToggle.getAttribute("aria-expanded") === "true",
  );

  const state = {
    ego: { v: 10 },
    road: { limit: 13.9, name: "Test Road" },
    nav: null,
    violations: { collisions: 0, red_lights_run: 0, stop_signs_run: 0, off_road_s: 0, safety_brakes: 0, fallbacks: 0 },
    decision: null,
    totals: { cost: 0 },
    paused: false,
    autopilot: false,
    hasRoute: false,
  };
  hud.update(state, 0);
  const observer = new MutationObserver(() => {});
  observer.observe(hud.el.root, { subtree: true, childList: true, characterData: true, attributes: true });
  hud.update(state, 100);
  check("An unchanged HUD performs no DOM writes", observer.takeRecords().length === 0);
  state.ego.v = 20;
  hud.update(state, 150);
  check("HUD updates are bounded to 10 Hz", hud.el.speed.textContent === "36");
  hud.update(state, 200);
  check(
    "Speed warnings use the same grace as scoring",
    !hud.el.speedWarning.hidden && hud.el.cluster.classList.contains("speeding"),
  );
  hud.decisionTimes = [0];
  hud.update(state, 61000);
  check("The rolling decision rate expires while driving is stopped", hud.el.rate.textContent === "0");
  observer.disconnect();

  hud.updateNav({ next_turn: "sharp_left", turn_in_m: 8, remaining_m: 999 }, false, true);
  check(
    "Sharp turns use human wording and metres close to the junction",
    hud.el.nav.textContent === "Turn sharply left" && hud.el.navDistance.textContent === "8 m",
  );
  check(
    "The total distance uses kilometre units across the rounding boundary",
    hud.el.navRemaining.textContent === "1.0 km total",
  );
  hud.updateNav({ next_turn: "future", remaining_m: 200 }, false, true);
  check(
    "Unknown turns show a usable instruction without inventing a distance",
    hud.el.nav.textContent === "Follow the route" && hud.el.navDistance.textContent === "–",
  );
  hud.updateNav(null, true, false);
  check("The pause readout works without letter shortcuts", hud.el.nav.textContent === "Select Resume to continue");

  hud.setTime("11:12");
  check("A custom time appears in the current selection", hud.el.time.selectedOptions[0]?.textContent === "11:12");
  hud.setTime("noon");
  check("Picking a preset hides the previous custom time", hud.customTime.hidden && hud.el.time.value === "noon");
  hud.initFeatureSwitches(new URLSearchParams("buses=0"));
  check(
    "The feature switch count reflects disabled URL options",
    hud.featureCount.textContent.startsWith(
      `${hud.el.featureSwitchesList.querySelectorAll("input:checked").length} of`,
    ),
  );
  const busSwitch = hud.el.featureSwitchesList.querySelector('[data-feature-flag="buses"]');
  busSwitch.checked = true;
  busSwitch.dispatchEvent(new Event("change", { bubbles: true }));
  check(
    "Changing feature switches enables apply and marks a pending restart",
    !hud.el.featureSwitchesApply.disabled && hud.featureCount.textContent.includes("apply to restart"),
  );
  check("Enable all is disabled when every switch is enabled", hud.el.featureSwitchesAll.disabled);
  busSwitch.checked = false;
  busSwitch.dispatchEvent(new Event("change", { bubbles: true }));
  check("Undoing a feature switch edit prevents an unnecessary restart", hud.el.featureSwitchesApply.disabled);

  state.ego.v = -20;
  state.road = null;
  hud.update(state, 62000);
  check("Reverse driving has its own manual readout", hud.el.mode.textContent === "REVERSE");
  check("Unknown road speed limits do not raise a speeding notice", hud.el.speedWarning.hidden);
  state.ego.v = NaN;
  hud.update(state, 62100);
  check("Unavailable speed measurements display a dash", hud.el.speed.textContent === "–");
  hud.updateDecision(
    decision("jev", {
      meta: { source: "jev", input_tokens: 0 },
      candidates: [{ ...candidates[0], flagged: true, reject: "red_light" }],
      answers: { vector: { probabilities: { keep_lane_target: 0, invented: 1 } } },
    }),
    true,
  );
  check(
    "Zero input tokens remain distinguishable from missing latency",
    hud.el.tokens.textContent === "0" && hud.el.latency.textContent === "–",
  );
  check(
    "HUD zero-probability bars are empty and unknown IDs are skipped",
    hud.el.options.querySelectorAll(".option").length === 1 &&
      hud.el.options.querySelector(".option i").style.width === "0%",
  );
  check("HUD displays a human-readable rule flag", hud.el.options.textContent.includes("red light"));
  hud.updateDecision(decision("local", { candidates: [] }), true);
  check("HUD explains an empty safety filter result", hud.el.options.textContent.includes("No manoeuvre passed"));
  hud.badge("Collision", "alert");
  hud.badge("Weather changed");
  check("A lower-priority notice cannot immediately overwrite an alert", hud.el.badge.textContent === "Collision");
  clearTimeout(hud.badgeTimer);

  const cockpit = new Cockpit();
  try {
    cockpit.update("hood", "rain", 0.6);
    observer.observe(cockpit.root, { attributes: true, subtree: true });
    cockpit.update("hood", "rain", 0.6);
    check("An unchanged windshield emits no attribute mutations", observer.takeRecords().length === 0);
    cockpit.update("hood", "dry", 0.6);
    check(
      "Dry weather hides the rain droplets and parks the wipers",
      cockpit.drops.style.display === "none" && cockpit.blades[0].g.getAttribute("transform").startsWith("rotate(-20"),
    );
  } finally {
    observer.disconnect();
    cockpit.root.remove();
  }

  const eyes = Object.create(DriveLab.prototype);
  eyes.perception = document.createElement("section");
  eyes.sight = document.createElement("div");
  eyes.rejections = document.createElement("div");
  eyes.eyes = document.createElement("button");
  eyes.perception.append(eyes.sight, eyes.rejections);
  document.body.append(eyes.eyes, eyes.perception);
  try {
    const rejected = Array.from({ length: 6 }, (_, i) => ({ id: `option_${i}`, reason: "Collision" }));
    const data = {
      seen: 3,
      hidden: 1,
      range: 27,
      rejected,
      featureLines: [{ order: 4, label: "Road", text: "Closed" }],
    };
    eyes.showPerception(data);
    const detail = eyes.sight.firstChild;
    const more = eyes.rejections.querySelector("button");
    check(
      "AI Eyes omits unavailable fields without showing NaN",
      !eyes.sight.textContent.includes("NaN") && eyes.sight.textContent.includes("27 m sight"),
    );
    eyes.showPerception({ ...data, rejected: [...rejected] });
    check(
      "AI Eyes keeps unchanged measurement and rejection elements in place",
      eyes.sight.firstChild === detail && eyes.rejections.querySelector("button") === more,
    );
    more.focus();
    more.click();
    check(
      "Expanding AI Eyes rejections keeps focus and updates the disclosure",
      document.activeElement === eyes.rejections.querySelector("button") &&
        document.activeElement.getAttribute("aria-expanded") === "true",
    );
    eyes.toggleEyes(false);
    check(
      "Closing AI Eyes clears its stale readout and moves focus back",
      document.activeElement === eyes.eyes && eyes.sight.textContent === "Observing the street…",
    );
  } finally {
    eyes.perception.remove();
    eyes.eyes.remove();
  }

  await checkModelSetup(check);
  checkPhotoControls(check);

  // Touch driving controls (ui/touch.js): two fingers at once, one steering and one on a pedal, each
  // tracked by its own pointer, reach the shared input; lifting them lets go; the toggles fire actions.
  {
    const touchRoot = document.createElement("div");
    document.body.append(touchRoot);
    let toggled = 0;
    const touch = new TouchControls({ root: touchRoot, actions: { autopilot: () => toggled++ } });
    const input = new Input({});
    input.addSource(touch);
    const pointer = (el, type, id, x = 0) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          clientX: x,
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          isPrimary: id === 1,
        }),
      );
    pointer(touch.wheel, "pointerdown", 1, 200);
    pointer(touch.pedalEls.throttle, "pointerdown", 2);
    pointer(touch.wheel, "pointermove", 1, 200 - STEER_RANGE_PX / 2);
    input.poll();
    check(
      "Touch steering and the accelerator work together",
      Math.abs(input.left - 0.5) < 1e-9 && input.right === 0 && input.throttle === 1 && input.anyDriving,
    );
    pointer(touch.wheel, "pointerdown", 3, 0);
    pointer(touch.wheel, "pointermove", 3, 999);
    input.poll();
    check("A second finger cannot take over the steering pad", Math.abs(input.left - 0.5) < 1e-9);
    check("The pressed pedal shows its state", touch.pedalEls.throttle.getAttribute("aria-pressed") === "true");
    pointer(touch.wheel, "pointerup", 1);
    pointer(touch.pedalEls.throttle, "pointerup", 2);
    pointer(touch.pedalEls.brake, "pointerdown", 4);
    input.poll();
    check(
      "Lifting the fingers centres the wheel and lets the pedal go",
      input.left === 0 && input.right === 0 && input.throttle === 0 && input.brake === 1,
    );
    touch.release();
    input.poll();
    check("Releasing the controls stops all driving", !input.anyDriving);
    touch.buttons.find((b) => b.dataset.action === "autopilot").click();
    touch.setAutopilot(true);
    check(
      "Touch toggles fire their action and show the autopilot state",
      toggled === 1 && touch.el.classList.contains("autopilot"),
    );
    touch.el.hidden = true;
    pointer(touch.pedalEls.throttle, "pointerdown", 5);
    input.poll();
    check("Hidden touch controls do not drive", !input.anyDriving);
    touchRoot.remove();
  }
  {
    const map = document.createElement("canvas");
    map.width = 100;
    map.height = 80;
    map.tabIndex = 0;
    const cursor = document.createElement("span");
    cursor.hidden = true;
    const picks = [];
    bindMapPicker(map, cursor, { fromCar: () => [20, 30], onSelect: (...p) => picks.push(p) });
    document.body.append(map, cursor);
    map.focus();
    const press = (key, options = {}) => {
      const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
      map.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    check(
      "The map uses modified shortcuts only when they belong to the picker",
      !press("ArrowUp", { ctrlKey: true }) && cursor.hidden,
    );
    press("ArrowRight");
    check(
      "The map marker starts from the car and moves in canvas coordinates",
      cursor.style.left === "26%" && !cursor.hidden,
    );
    press("ArrowUp", { shiftKey: true });
    check("Shift moves the minimap marker by one canvas pixel", cursor.style.top === "36.25%");
    press("Enter");
    check("Enter sends the keyboard marker to the same destination callback", picks[0]?.join(",") === "26,29");
    press("Enter", { repeat: true });
    check("Holding Enter sends only one route request", picks.length === 1);
    for (let i = 0; i < 24; i++) press("ArrowLeft");
    check("The marker cannot move beyond the west edge of the map", cursor.style.left === "0%");
    for (let i = 0; i < 24; i++) press("ArrowDown");
    check("The marker cannot move beyond the south edge of the map", cursor.style.top === "100%");
    press("Home");
    check(
      "Home recentres the destination marker on the current car",
      cursor.style.left === "20%" && cursor.style.top === "37.5%",
    );
    map.blur();
    check("Leaving the map hides its keyboard marker", cursor.hidden);
    map.remove();
    cursor.remove();
  }
  {
    const map = document.createElement("canvas");
    map.width = 100;
    map.height = 80;
    map.tabIndex = 0;
    const cursor = document.createElement("span");
    cursor.hidden = true;
    bindMapPicker(map, cursor, { fromCar: () => [50, 40], bounds: () => [10, 20, 90, 60], onSelect: () => {} });
    document.body.append(map, cursor);
    map.focus();
    const press = (key) => map.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    for (let i = 0; i < 24; i++) press("ArrowLeft");
    for (let i = 0; i < 24; i++) press("ArrowUp");
    check("The keyboard marker stays on a letterboxed map", cursor.style.left === "10%" && cursor.style.top === "25%");
    map.remove();
    cursor.remove();
  }
  {
    const fixture = document.createElement("div");
    document.body.append(fixture);
    const touch = new TouchControls({ root: fixture });
    const input = new Input();
    input.addSource(touch);
    const key = (element, type, k, extra = {}) =>
      element.dispatchEvent(
        new KeyboardEvent(type, {
          key: k,
          bubbles: true,
          cancelable: true,
          ...extra,
        }),
      );
    const brake = touch.pedalEls.brake,
      go = touch.pedalEls.throttle,
      hard = touch.pedalEls.hardBrake;
    touch.wheel.focus();
    key(touch.wheel, "keydown", "ArrowLeft");
    check("Keyboard touch steering uses half travel by default", touch.state.steer === -0.5);
    key(touch.wheel, "keydown", "ArrowRight", { shiftKey: true });
    check("Keyboard touch steering combines simultaneous directions", touch.state.steer === 0.5);
    key(touch.wheel, "keyup", "ArrowLeft");
    check("Keyboard touch steering can reach full lock", touch.state.steer === 1);
    key(touch.wheel, "keyup", "ArrowRight", { ctrlKey: true });
    check("Releasing a steering key with a modifier held still lets go", touch.state.steer === 0);
    go.focus();
    check("Blurring the touch steering pad centres it", touch.state.steer === 0);
    key(go, "keydown", " ");
    check("The touch accelerator is a keyboard hold control", touch.state.throttle === 1);
    key(go, "keyup", " ");
    check("Releasing the keyboard accelerator lets go immediately", touch.state.throttle === 0);
    key(brake, "keydown", "Enter");
    check("Enter holds the touch brake", touch.state.brake === 1);
    key(brake, "keyup", "Enter");
    go.click();
    const framesWithoutStep = touch.state.throttle === 1 && touch.state.throttle === 1;
    touch.stepped();
    check(
      "Assistive activation of a pedal lasts until a physics step reads it",
      framesWithoutStep && touch.state.throttle === 0,
    );
    go.click();
    input.poll();
    const pulseFirst = input.throttle === 1;
    input.stepped();
    check("An assistive pedal pulse drives exactly one physics step", pulseFirst && input.throttle === 0);
    hard.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 5, button: 2, bubbles: true, cancelable: true }));
    check("Right-clicking a touch control cannot engage hard braking", !touch.state.hardBrake);
    go.click();
    const modal = document.createElement("dialog");
    fixture.append(modal);
    modal.showModal();
    input.poll();
    modal.close();
    check("A modal clears the touch pedal state before driving resumes", !touch.state.throttle);
    const point = (element, type, init = {}) =>
      element.dispatchEvent(
        new PointerEvent(type, { pointerId: 19, pointerType: "mouse", button: 0, clientX: 100, ...init }),
      );
    point(touch.wheel, "pointerdown");
    point(touch.wheel, "pointermove", { clientX: 145, buttons: 1 });
    check(
      "Touch steering announces its direction and percentage",
      touch.wheel.getAttribute("aria-valuetext") === "50% right",
    );
    point(touch.wheel, "pointermove", { clientX: 170 });
    check("A mouse move with no held button ends a steering drag", touch.state.steer === 0);
    check(
      "The steering pad announces when it recovers to centre",
      touch.wheel.getAttribute("aria-valuetext") === "Centred",
    );
    point(touch.wheel, "pointerdown");
    point(touch.wheel, "pointermove", { clientX: 55, buttons: 1 });
    point(touch.wheel, "pointerleave");
    check("Leaving the steering pad after capture fails releases the drag", touch.state.steer === 0);
    point(go, "pointerdown");
    point(go, "pointerleave");
    check("Leaving a pedal after capture fails releases it", touch.state.throttle === 0);
    point(brake, "pointerdown");
    point(brake, "pointercancel");
    check("Cancelling a pointer releases the touch brake", touch.state.brake === 0);
    point(hard, "pointerdown");
    point(hard, "lostpointercapture");
    check("Losing capture releases the hard brake", !touch.state.hardBrake);
    key(hard, "keydown", " ", { ctrlKey: true });
    check("A browser chord cannot engage the touch hard brake", !touch.state.hardBrake);
    key(go, "keydown", " ", { isComposing: true });
    check("A composition key cannot engage the touch accelerator", touch.state.throttle === 0);
    key(brake, "keydown", "Enter", { repeat: true });
    check("A stale key repeat cannot re-engage a released touch pedal", touch.state.brake === 0);
    key(touch.wheel, "keydown", "ArrowLeft", { repeat: true });
    check("A stale steering key repeat cannot re-engage the steering pad", touch.state.steer === 0);
    key(touch.wheel, "keydown", "ArrowLeft");
    check("Keyboard steering shows an active steering control", touch.wheel.classList.contains("active"));
    check("Keyboard steering announces leftward input", touch.wheel.getAttribute("aria-valuetext") === "50% left");
    touch.release();
    let captured = 0;
    const capture = (element) => {
      element.setPointerCapture = () => captured++;
      element.hasPointerCapture = () => true;
      element.releasePointerCapture = () => captured--;
    };
    capture(touch.wheel);
    capture(go);
    point(touch.wheel, "pointerdown", { pointerId: 20 });
    point(go, "pointerdown", { pointerId: 21 });
    touch.release();
    check("Suspending touch driving relinquishes both pointer captures", captured === 0);
    const auto = touch.buttons.find((b) => b.dataset.action === "autopilot");
    check("The touch autopilot has an initial off state", auto.getAttribute("aria-pressed") === "false");
    const initialCaption = auto.textContent;
    touch.setAutopilot(true);
    check(
      "The touch autopilot caption stays stable as its pressed state changes",
      auto.textContent === initialCaption && auto.getAttribute("aria-pressed") === "true",
    );
    const steeringHelp = touch.wheel.getAttribute("aria-describedby");
    check(
      "The steering pad is described by its own keyboard and pointer instructions",
      fixture.querySelector(`#${steeringHelp}`)?.textContent.includes("Hold Shift"),
    );
    const brakeHelp = brake.getAttribute("aria-describedby");
    check(
      "The brake points to instructions for holding a pedal",
      fixture.querySelector(`#${brakeHelp}`)?.textContent.includes("Space"),
    );

    check(
      "The brake exposes that holding it at a stop reverses",
      brake.getAttribute("aria-description")?.includes("reverse"),
    );
    touch.el.hidden = true;
    go.click();
    point(go, "pointerdown");
    touch.el.hidden = false;
    check("Hidden pedals cannot queue input to drive later", touch.state.throttle === 0);
    fixture.remove();
  }
  check("Exposure rejects a nonnumeric edit", clampLook("exposure", "oops") === 0);
  check("Exposure is bounded at two stops", clampLook("exposure", 100) === 2);
  check("Vignette has its own asymmetric lower limit", clampLook("vignette", -100) === -0.3);
  check("Unknown grading controls do not modify the look", clampLook("unknown", 0.2) === 0);
  check(
    "Photo filenames normalize accents and include seconds",
    photoFilename("Île — Montréal", new Date(2026, 0, 2, 3, 4, 5)) === "jev-ile-montreal-2026-01-02-030405.png",
  );
  check(
    "Photo filenames have a readable fallback for an empty slug",
    photoFilename("…", new Date(2026, 0, 2, 3, 4, 5)).startsWith("jev-drive-"),
  );
  {
    const createURL = URL.createObjectURL;
    const files = [],
      clicks = [];
    const observe = (event) => {
      if (event.target.closest?.("a[download]")) {
        event.preventDefault();
        clicks.push(event.target);
      }
    };
    document.addEventListener("click", observe, true);
    URL.createObjectURL = (blob) => {
      files.push(blob);
      return createURL.call(URL, blob);
    };
    try {
      downloadCsv(
        "fixture.csv",
        ["City", "Distance", "Note"],
        [
          ["Montréal, QC", -2, "=SUM(1,2)"],
          ['He said "hello"', null, "Two\nlines"],
        ],
      );
      downloadJson("fixture.json", { city: "Montréal", incidents: [] });
    } finally {
      URL.createObjectURL = createURL;
      document.removeEventListener("click", observe, true);
    }
    const bytes = new Uint8Array(await files[0].arrayBuffer());
    check("CSV carries a UTF-8 marker for spreadsheet imports", bytes.slice(0, 3).join(",") === "239,187,191");
    const csv = await files[0].text();
    check("CSV uses portable CRLF record separators", csv.startsWith("City,Distance,Note\r\n") && csv.endsWith("\r\n"));
    check("CSV quotes city names containing commas", csv.includes('"Montréal, QC"'));
    check("CSV leaves negative numeric measurements numeric", csv.includes(",-2,"));
    check("CSV neutralizes formula-like text without losing punctuation", csv.includes(`"'=SUM(1,2)"`));
    check("CSV doubles literal quotes in labels", csv.includes('"He said ""hello"""'));
    check("CSV keeps embedded newlines inside a field", csv.includes('"Two\nlines"'));
    check("CSV writes missing measurements as empty cells", csv.includes('",,"Two'));
    check(
      "Exports click attached download links and clean them up",
      clicks.length === 2 && clicks.every((link) => !link.isConnected),
    );
    const restored = JSON.parse(await files[1].text());
    check(
      "JSON exports preserve readable Unicode and empty collections",
      restored.city === "Montréal" && restored.incidents.length === 0,
    );
  }
  return results;
}

async function checkModelSetup(check) {
  const requests = [];
  const used = [];
  const saved = [];
  const setup = new ModelSetup({
    onSaved: (result) => saved.push(result.id),
    onUse: (id) => used.push(id),
    onPause: () => {},
    request: (path, body, { signal } = {}) => new Promise((resolve) => requests.push({ path, body, signal, resolve })),
  });
  const provider = (id) => ({ id, label: id, key_set: true });
  setup.setStatus("decision", { providers: [provider("openrouter"), provider("custom")] });
  setup.setStatus("llm", { providers: [provider("groq")] });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    setup.open();
    check(
      "Model setup shows a busy state while a catalog is loading",
      setup.modelStatus.getAttribute("aria-busy") === "true" && setup.testButton.disabled,
    );
    setup.open("llm");
    check("Changing model tabs aborts the previous catalog", requests[0].signal.aborted);
    requests[0].resolve({ models: [{ id: "stale" }] });
    requests[1].resolve({
      models: [null, { id: "" }, { id: "valid", price_per_mtok_output: 0.000001 }, { id: "valid" }],
    });
    await flush();
    check(
      "The catalog drops malformed, duplicate and stale model IDs",
      setup.list.options.length === 1 && setup.list.options[0].value === "valid",
    );
    setup.model.value = "valid";
    setup.fillPrices();
    check(
      "Output-only catalog prices retain small values",
      Number(setup.priceOut.value) === 0.000001 && setup.priceIn.value === "",
    );
    setup.priceOut.value = "0.075";
    setup.priceOut.dispatchEvent(new Event("input"));
    setup.key.value = "mock";
    setup.key.dispatchEvent(new Event("input"));
    check("Credential edits invalidate old suggestions immediately", setup.list.options.length === 0);
    const refreshed = setup.loadModels();
    requests[2].resolve({ models: [{ id: "valid", price_per_mtok_output: 2 }] });
    await refreshed;
    check("A price edited by hand survives refreshing the same model", Number(setup.priceOut.value) === 0.075);
    setup.model.value = "";
    await setup.save();
    check(
      "An empty model is rejected by the editing form",
      requests.length === 3 && setup.status.textContent.includes("Enter a model ID"),
    );
    setup.model.value = "valid";
    const pending = setup.save();
    await setup.save();
    check(
      "A pending model save locks mutations and exposes busy state",
      requests.length === 4 && setup.dialog.getAttribute("aria-busy") === "true",
    );
    setup.close();
    requests[3].resolve({ id: "llm:valid" });
    await pending;
    check(
      "A closed setup still records a completed save without silently switching drivers",
      saved.join() === "llm:valid" && used.length === 0,
    );
    setup.open("decision", "custom");
    await setup.loadModels(true);
    check(
      "A custom endpoint needs a URL before a model test can start",
      requests.length === 4 && setup.modelStatus.textContent.includes("valid server URL"),
    );
  } finally {
    setup.close();
    setup.dialog.remove();
  }
}

function checkPhotoControls(check) {
  const canvas = document.createElement("canvas");
  let finish;
  canvas.toBlob = (callback) => {
    finish = callback;
  };
  let hour = 17.1;
  let weather = "dry";
  const view = {
    mode: "chase",
    look: { exposure: 0.3 },
    post: null,
    setCamera(mode) {
      this.mode = mode;
    },
    setLook(change) {
      Object.assign(this.look, change);
      return { ...this.look };
    },
    renderer: { domElement: canvas },
    render() {},
  };
  const photo = new PhotoMode({
    view,
    place: "Test",
    getHour: () => hour,
    setHour: (value) => {
      hour = Number(value);
    },
    getWeather: () => weather,
    setWeather: (value) => {
      weather = value;
    },
  });
  try {
    photo.enter();
    check("Photo Mode initially announces the actual time", photo.timeInput.getAttribute("aria-valuetext") === "17:06");
    check(
      "Low graphics keeps exposure available and disables the other grades",
      !photo.inputs.exposure.input.disabled &&
        photo.inputs.contrast.input.disabled &&
        photo.inputs.saturation.input.disabled &&
        photo.inputs.vignette.input.disabled,
    );
    check(
      "Photo grading sliders label the active value",
      photo.inputs.exposure.input.getAttribute("aria-valuetext") === "+0.3 EV",
    );
    photo.timeInput.value = "18";
    photo.timeInput.dispatchEvent(new Event("input"));
    photo.weather.value = "rain";
    photo.weather.dispatchEvent(new Event("change"));
    photo.resetConditions();
    check("Reset conditions restores the time and weather at entry", hour === 17.1 && weather === "dry");
    photo.collapse(true);
    check("Hidden photo controls put focus on their reveal button", document.activeElement === photo.reveal);
    photo.resetLook();
    photo.capture();
    photo.exit();
    check("Exiting Photo Mode restores the original scene exposure", view.look.exposure === 0.3);
    photo.enter();
    finish(new Blob(["image"], { type: "image/png" }));
    check(
      "A capture from a closed session does not overwrite the reopened status",
      photo.status.textContent === "" && !photo.captureButton.disabled,
    );
  } finally {
    photo.exit();
    photo.panel.remove();
    photo.grid.remove();
    photo.reveal.remove();
  }
}

export async function checkPhotoRoutes(app) {
  const originalFetch = window.fetch;
  const originalRoute = app.world.route;
  const recording = app.recorder.recordingId;
  const { x, y } = app.world.ego;
  const point = [x + 20, y];
  const response = {
    ok: true,
    json: async () => ({ routes: [{ polyline: [[x, y], point], edges: [], summary: "Fixture" }] }),
  };
  let signal, finish;
  let requests = 0;
  window.fetch = (url, options) => {
    if (url !== "/api/route") return originalFetch(url, options);
    if (++requests > 1) return Promise.resolve(response);
    signal = options.signal;
    return new Promise((resolve) => {
      finish = () => resolve(response);
    });
  };
  try {
    const pending = app.setDestination(point);
    app.photo.enter();
    const during = app.setDestination(point);
    finish();
    return {
      name: "Entering Photo Mode cancels pending routes and keeps the route and recording intact",
      ok:
        !(await pending) &&
        !(await during) &&
        signal.aborted &&
        requests === 1 &&
        app.world.route === originalRoute &&
        app.recorder.recordingId === recording,
    };
  } finally {
    app.photo.exit();
    window.fetch = originalFetch;
  }
}

export function checkQualityFallback(app) {
  const originalWrite = Storage.prototype.setItem;
  const select = document.getElementById("quality");
  const originalQuality = app.view.quality;
  const originalUrl = location.href;
  const url = new URL(originalUrl);
  url.searchParams.delete("quality");
  history.replaceState(history.state, "", url);
  Storage.prototype.setItem = () => {
    throw new DOMException("Storage is blocked", "SecurityError");
  };
  try {
    select.value = originalQuality === "low" ? "high" : "low";
    select.dispatchEvent(new Event("change"));
    return {
      name: "With storage blocked, a graphics selection adds a URL override for reload",
      ok:
        app.view.quality !== originalQuality && new URL(location.href).searchParams.get("quality") === app.view.quality,
    };
  } finally {
    Storage.prototype.setItem = originalWrite;
    app.view.setQuality(originalQuality);
    select.value = originalQuality;
    history.replaceState(history.state, "", originalUrl);
  }
}
