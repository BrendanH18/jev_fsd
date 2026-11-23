import { FEATURES } from "./features/index.js";

const COACH = FEATURES.filter((feature) => feature.coach);

function ordered(field, at) {
  return COACH.flatMap(({ coach }) => (coach[field] || []).filter((entry) => entry.at === at)).sort(
    (a, b) => a.order - b.order,
  );
}

const TIPS = Object.fromEntries(
  ["afterSpeed", "afterMerge", "afterCyclists", "afterFollowing", "afterBusLanes"].map((at) => [
    at,
    ordered("tips", at),
  ]),
);
const REPORTS = Object.fromEntries(
  ["afterSpeed", "afterFlagger", "afterBrakes", "end"].map((at) => [at, ordered("reports", at)]),
);
const GUIDANCE = Object.fromEntries(
  ["afterDirection", "afterBlind", "beforeSample", "afterSample"].map((at) => [at, ordered("guidance", at)]),
);
const DEDUCTIONS = Object.fromEntries(
  ["safety", "beforeLegality", "afterSpeed", "legality", "comfort", "post"].map((at) => [
    at,
    ordered("deductions", at),
  ]),
);
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

export function featureCoachDeduct(at, score, start) {
  let result = start;
  for (const { counter, weight } of DEDUCTIONS[at]) result -= score[counter] * weight;
  return result;
}

export function finishFeatureCoachCategories(score, categories) {
  for (const { category, counter, weight } of DEDUCTIONS.post)
    if (score[counter]) categories[category] = Math.max(0, categories[category] - score[counter] * weight);
}

export function featureCoachCap(score) {
  return COACH.some(({ coach }) => coach.cap && score[coach.cap]);
}

export function featureCoachTips(at, score, tips) {
  for (const { when, text } of TIPS[at]) if (when(score)) tips.push(text);
}

export function featureCoachReport(at, score, round) {
  return Object.assign({}, ...REPORTS[at].map(({ read }) => read(score, round)));
}
