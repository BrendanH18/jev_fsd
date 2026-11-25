// Run on /tests or from the simulator: await import('/tests/ui-tests.js').then(m => m.runUiTests())
// Use the real page markup in a detached root so the live HUD and driver remain untouched.
import { downloadCsv, downloadJson } from "../js/ui/export.js";
import { Hud } from "../js/ui/hud.js";
import { TouchControls, STEER_RANGE_PX } from "../js/ui/touch.js";
import { bindMapPicker } from "../js/ui/map-picker.js";
import { clampLook, photoFilename } from "../js/ui/photo-mode.js";
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
    !hud.el.keysHelp.hidden && hud.el.keysToggle.getAttribute("aria-pressed") === "true",
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
    check(
      "Assistive activation of a pedal produces one input pulse",
      touch.poll().throttle === 1 && touch.poll().throttle === 0,
    );
    hard.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 5, button: 2, bubbles: true, cancelable: true }));
    check("Right-clicking a touch control cannot engage hard braking", !touch.state.hardBrake);
    go.click();
    const modal = document.createElement("dialog");
    fixture.append(modal);
    modal.showModal();
    input.poll();
    modal.close();
    check("A modal clears the touch pedal state before driving resumes", !touch.state.throttle);
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
