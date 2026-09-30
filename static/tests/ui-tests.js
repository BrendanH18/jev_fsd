// Run on /tests or from the simulator: await import('/tests/ui-tests.js').then(m => m.runUiTests())
// Use the real page markup in a detached root so the live HUD and driver remain untouched.
import { Hud } from '../js/ui/hud.js';

export async function runUiTests() {
  const html = await fetch('/').then(r => r.text());
  const page = new DOMParser().parseFromString(html, 'text/html');
  const root = document.createElement('div');
  root.append(page.querySelector('#hud'));
  const hud = new Hud(root), results = [];
  const check = (name, ok) => results.push({ name, ok: !!ok });
  const candidate = (id, speed = 10) => ({ id, eligible: true, law: { kind: 'lane', vTarget: speed, offset: 0 } });
  const candidates = [candidate('keep_lane_target'), candidate('keep_lane_slow', 5)];
  const decision = (source, extra = {}) => ({ candidates, chosenId: candidates[0].id, motion: 'drive',
    meta: { source, latency_ms: 32, input_tokens: 120 }, answers: {}, ...extra });

  hud.updateDecision(decision('rules_fallback'), true);
  check('Rules fallbacks never appear as a successful model response', hud.el.source.classList.contains('fallback') && !hud.el.source.classList.contains('live'));
  check('Fallbacks do not claim that one option passed safety checks', hud.el.options.textContent.includes('Rules fallback') && !hud.el.options.textContent.includes('Only one'));
  hud.updateDecision(decision('local'), true);
  check('Multiple local options do not claim a single safe choice', !hud.el.options.textContent.includes('Only one'));
  hud.updateDecision(decision('local', { candidates: [candidates[0]] }), true);
  check('A single eligible local option is described accurately', hud.el.options.textContent.includes('Only one safe option'));
  hud.updateDecision(decision('jev', { meta: { source: 'jev', fallback: 'invalid vector' },
    answers: { vector: { probabilities: { nonsense: 1 } } } }), true);
  check('Invalid model vectors show fallback status and suppress invalid probabilities', hud.el.source.classList.contains('fallback') && !hud.el.options.textContent.includes('nonsense'));
  hud.updateDecision(decision('jev', { answers: { vector: { probabilities: { keep_lane_target: 0.8, keep_lane_slow: 0.2 } } } }), true);
  check('Model candidate speeds use km/h', hud.el.options.textContent.includes('36 km/h') && hud.el.options.textContent.includes('80%'));
  const options = hud.el.options.firstChild;
  hud.updateDecision(hud.shownDecision, true);
  check('Unchanged decisions reuse the existing option nodes', options === hud.el.options.firstChild);
  const many = Array.from({ length: 6 }, (_, i) => candidate(`option_${i}`));
  hud.updateDecision(decision('jev', { candidates: many, chosenId: 'option_5', answers: { vector: { probabilities: Object.fromEntries(many.map((c, i) => [c.id, (6 - i) / 21])) } } }), true);
  check('The executed option stays visible even outside the five largest probabilities', hud.el.options.querySelector('.chosen')?.title.includes('option_5'));
  hud.updateDecision(decision('local', { motion: 'stop', chosenId: 'hard_brake' }), true);
  check('An emergency braking decision is not described as holding still', hud.el.motion.textContent === 'Braking to stop');
  hud.updateDecision(decision('local', { motion: 'stop', chosenId: 'hold' }), true);
  check('A stationary stop is described as holding still', hud.el.motion.textContent === 'Holding still');
  hud.updateDecision(null, false);
  check('Disabling autopilot clears current decision telemetry', hud.el.latency.textContent === '–' && hud.el.tokens.textContent === '–' && hud.el.source.title === '');

  hud.setBrain('rules');
  hud.onBrainChange(name => hud.setBrain(name));
  const [rules, jev] = hud.el.brainButtons;
  rules.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  check('Brain radio buttons support arrow-key selection and one tab stop', jev.getAttribute('aria-checked') === 'true' && jev.tabIndex === 0 && rules.tabIndex === -1);
  hud.setJevAvailable(false);
  check('Unavailable Jev is exposed to assistive technology', jev.getAttribute('aria-disabled') === 'true');
  hud.toggleKeys(true);
  check('Shortcut help synchronizes its button state', !hud.el.keysHelp.hidden && hud.el.keysToggle.getAttribute('aria-pressed') === 'true');

  const state = { ego: { v: 10 }, road: { limit: 13.9, name: 'Test Road' }, nav: null,
    violations: { collisions: 0, red_lights_run: 0, stop_signs_run: 0, off_road_s: 0, safety_brakes: 0, fallbacks: 0 },
    decision: null, totals: { cost: 0 }, paused: false, autopilot: false, hasRoute: false };
  hud.update(state, 0);
  const observer = new MutationObserver(() => {});
  observer.observe(hud.el.root, { subtree: true, childList: true, characterData: true, attributes: true });
  hud.update(state, 100);
  check('An unchanged HUD performs no DOM writes', observer.takeRecords().length === 0);
  state.ego.v = 20;
  hud.update(state, 150);
  check('HUD updates are bounded to 10 Hz', hud.el.speed.textContent === '36');
  hud.update(state, 200);
  check('Speed warnings use the same grace as scoring', !hud.el.speedWarning.hidden && hud.el.cluster.classList.contains('speeding'));
  hud.decisionTimes = [0];
  hud.update(state, 61000);
  check('The rolling decision rate expires while driving is stopped', hud.el.rate.textContent === '0');
  observer.disconnect();
  return results;
}
