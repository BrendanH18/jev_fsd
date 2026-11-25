import { COACH_SLOTS } from "./feature-schema.js";
import { FEATURES, hooks, firstHookResult } from "./features/index.js";

const COACH_CORRIDOR = hooks("coachCorridor");
const COACH_CORRIDOR_FRAME = hooks("coachCorridorFrame");

export const featureCoachCorridor = (world, limit) => firstHookResult(COACH_CORRIDOR, world, limit);
export const featureCoachCorridorFrame = (score, corridor, context) =>
  firstHookResult(COACH_CORRIDOR_FRAME, score, corridor, context);

const COACH = FEATURES.filter((feature) => feature.coach);

function ordered(field, at) {
  return COACH.flatMap(({ coach }) => (coach[field] || []).filter((entry) => entry.at === at)).sort(
    (a, b) => a.order - b.order,
  );
}

const lists = (field) => Object.fromEntries(COACH_SLOTS[field].map((at) => [at, ordered(field, at)]));
const TIPS = lists("tips");
const REPORTS = lists("reports");
const GUIDANCE = lists("guidance");
const DEDUCTIONS = lists("deductions");
const EVENTS = new Map();
for (const { coach } of COACH)
  for (const [type, record] of Object.entries(coach.events || {})) {
    if (!EVENTS.has(type)) EVENTS.set(type, []);
    EVENTS.get(type).push(record);
  }

export function initFeatureCoach(score, world) {
  for (const { coach } of COACH) Object.assign(score, coach.init?.(world));
}

export function observeFeatureCoach(score, world) {
  for (const { coach, seen } of COACH) {
    if (coach.seen && world[seen]) score[coach.seen] = true;
    coach.observe?.(score, world);
  }
}

export function featureCoachDirectionExempt(world) {
  return COACH.some(({ coach }) => coach.directionExempt?.(world));
}

export function featureCoachFrame(score, context) {
  for (const { coach } of COACH) coach.frame?.(score, context);
}

export function featureCoachEvent(score, event) {
  for (const record of EVENTS.get(event.type) || []) record(score, event);
}

export function featureCoachMessage(at, score, context) {
  let message = "";
  for (const { read } of GUIDANCE[at]) {
    const text = read(score, context);
    if (!text) continue;
    if (at !== "beforeSample") return text;
    message = text;
  }
  return message;
}

function coachCounter(score, name, delta = false) {
  const value = delta ? score.counterDelta(name) : score[name];
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function featureCoachDeduct(at, score, start) {
  let result = start;
  for (const { counter, weight, delta } of DEDUCTIONS[at]) result -= coachCounter(score, counter, delta) * weight;
  return result;
}

export function finishFeatureCoachCategories(score, categories) {
  for (const { category, counter, weight, delta } of DEDUCTIONS.post) {
    const value = coachCounter(score, counter, delta);
    if (value) categories[category] = Math.max(0, categories[category] - value * weight);
  }
}

export function featureCoachCap(score) {
  return COACH.some(
    ({ coach }) =>
      (coach.cap && (score[coach.cap] === true || coachCounter(score, coach.cap))) ||
      (coach.capDelta && coachCounter(score, coach.capDelta, true)),
  );
}

export function featureCoachTips(at, score, tips) {
  for (const { when, text } of TIPS[at]) if (when(score)) tips.push(text);
}

export function featureCoachReport(at, score, round) {
  return Object.assign({}, ...REPORTS[at].map(({ read }) => read(score, round)));
}
