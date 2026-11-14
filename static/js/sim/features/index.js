// The feature registry (docs/feature-interface.md). Each opt-in feature that has moved here is one record,
// in a file of its own beside this one, and one line in FEATURES. The core (sim/world.js, sim/step.js,
// sim/npc.js, brain/sensors.js, brain/candidates.js, brain/state.js, brain/llm-prompt.js, bench/metrics.js)
// loops over the records' hooks and never names these features.
//
// A record:
//   key       the World option, and the World property holding what `build` returns (its `enabled` says
//             whether the feature is on)
//   seen      the World flag that says the feature has met the driven car this drive (its audit's metric
//             reaches the results, and fails a drive, only once it is set)
//   calls     the World map of the audit's calls, cleared when the car is moved by hand
//   build(world, { enabled, seed, map })   the feature's World state
//   metric    { at, name, failure }: the violation counted, and the failure text (at "driveways",
//             "balls" or "parkers" among the metrics and failures)
//   obstacle  { test(o), likePedestrian?, fixed? }: what of `world.obstaclesNear` is the feature's (never
//             followed or passed as traffic; `likePedestrian`: the car is at fault for driving into one;
//             `fixed`: stands where it is, like scenery, in the forward sims)
//   priority  candidate ids kept ahead of lateral alternatives when the list is cut
//   motion    (snap) => whether the model must be asked to stop or drive
//   and the hooks below.
//
// A hook is a function, or { at, run } to run it at a slot. The core runs each hook where the feature's
// own code used to be, so every result stays exactly as it was. While other features are still written
// into the core, a slot names the one (or the core step) the hook runs right after in that pipeline;
// hooks without `at` run at the slot "end". Once every feature is a record (ROADMAP 3.2), registration
// order alone can place them and the slots can go.
//
// Hooks (and their slots in the core):
//   obstacles(world, x, y, r)          World.obstaclesNear, after the others ("end")
//   stepBeforeTraffic(world, fleet, dt) sim/step.js, just before the traffic moves ("end")
//   stepAfterTraffic(world, fleet, dt)  sim/step.js, just before the people on foot move ("end")
//   audit(world)                        World.audit: "driveways", "balls", "parkers"
//   sense(world, snap, ctx)             the sensing pass: "driveways", "balls", "parkers"
//   limit(snap)                         the speed ceiling `snap.limit`: "driveways", "balls"
//   target(snap, v, reasons, ctx)       `desiredSpeed`, returns the new speed: "restrictions", "driveways", "balls"
//   hazard(snap)                        a hazard flag, or null: "driveways", "balls", "parkers"
//   candidates(ctx, out)                lane candidates: "restrictions", "driveways", "balls"
//   adjust(ctx, list)                   every lane candidate once the list is cut: "balls"
//   brakeDetour(ctx)                    the move `hard_brake` keeps to, or null ("end")
//   sim(world, snap)                    the forward sims: null, or a checker { wheels, start(), afterLaw(car,
//                                       wheelsBefore), along(s, front, car), reject(c) } whose rejection
//                                       comes at its slot: "first", "driveways", "balls"
//   state(snap, state)                  the decision state: "restrictions", "driveways", "balls"
//   outcome(c, snap)                    a candidate's outcome label by its id, or null: "ids"
//   slowOutcome(c, snap)                the outcome of a lane candidate slowed for it, or null: "lane"
//   clause(snap)                        the situation's wording, or null: "restrictions", "driveways", "ice"
//   holdStill(snap)                     when holding still is right, or "": "driveways", "parkers"
//   prompt                              { at, text }: a line of the LLM system prompt: "restrictions",
//                                       "driveways", "snowbanks"
//   trafficStart(world, n)              each traffic vehicle, each step, first ("end")
//   trafficReplan(world, n)             before its path is extended; true when re-planned ("end")
//   trafficLane(world, n, front, busy, dt)  { result, shift }: a move inside the lane ("contraflow")
//   trafficYield(world, n, front)       { hold, limit, canStop }: where it stops, and its ceiling ("end")

import potholes from "./potholes.js";
import geese from "./geese.js";
import roadClosures from "./road-closures.js";

export const FEATURES = [
  potholes,
  geese,
  roadClosures,
];

// The slots the core runs each hook and placed field at. A record's hook at any other slot would never
// run, so `hooks` refuses to load one (and scripts/test_feature_registry.mjs checks every record).
export const SLOTS = {
  obstacles: ["end"], stepBeforeTraffic: ["end"], stepAfterTraffic: ["end"],
  audit: ["driveways", "balls", "parkers"],
  sense: ["driveways", "balls", "parkers"], limit: ["driveways", "balls"], target: ["restrictions", "driveways", "balls"], hazard: ["driveways", "balls", "parkers"],
  candidates: ["restrictions", "driveways", "balls"], adjust: ["balls"], brakeDetour: ["end"], sim: ["first", "driveways", "balls"],
  state: ["restrictions", "driveways", "balls"], outcome: ["ids"], slowOutcome: ["lane"], clause: ["restrictions", "driveways", "ice"],
  holdStill: ["driveways", "parkers"], prompt: ["restrictions", "driveways", "snowbanks"], metric: ["driveways", "balls", "parkers"],
  trafficStart: ["end"], trafficReplan: ["end"], trafficLane: ["contraflow"], trafficYield: ["end"],
};
// The fields of a record that are not hooks.
const FIELDS = ["key", "seen", "calls", "build", "obstacle", "priority", "motion"];

// What is wrong with record `f`, or null: a missing field, an unknown hook, or a hook at a slot the core
// never runs.
export function recordProblem(f) {
  for (const k of ["key", "seen", "calls"]) if (typeof f[k] !== "string" || !f[k]) return `${f.key || "a record"} has no ${k}`;
  if (typeof f.build !== "function") return `${f.key} has no build`;
  for (const [name, h] of Object.entries(f)) {
    if (FIELDS.includes(name)) continue;
    if (!SLOTS[name]) return `${f.key} has an unknown hook or field ${name}`;
    const at = typeof h === "function" ? "end" : h?.at || "end";
    if (!SLOTS[name].includes(at)) return `${f.key}'s ${name} is at "${at}", which the core never runs: use ${SLOTS[name].join(", ")}`;
  }
  return null;
}
for (const f of FEATURES) { const problem = recordProblem(f); if (problem) throw new Error(`Feature registry: ${problem}.`); }

// The functions of hook `name` at `slot`, in registration order (bound to their record as `this`).
export function hooks(name, slot = "end") {
  if (!SLOTS[name]?.includes(slot)) throw new Error(`Feature registry: no slot "${slot}" for ${name}.`);
  const out = [];
  for (const f of FEATURES) {
    const h = f[name];
    if (!h) continue;
    const at = typeof h === "function" ? "end" : h.at || "end";
    if (at === slot) out.push((typeof h === "function" ? h : h.run).bind(f));
  }
  return out;
}

// The same, with the key of the record each belongs to: { key, run }.
export const hookEntries = (name, slot = "end") => {
  const fns = hooks(name, slot), keys = FEATURES.filter((f) => f[name] && (typeof f[name] === "function" ? "end" : f[name].at || "end") === slot).map((f) => f.key);
  return fns.map((run, i) => ({ key: keys[i], run }));
};

// The records with field `name` at `slot` (for data fields such as `metric` and `prompt`).
export const recordsAt = (name, slot) => FEATURES.filter((f) => f[name] && (f[name].at || "end") === slot);

// The obstacle descriptor of the feature `o` belongs to, or null.
const OBSTACLES = FEATURES.filter((f) => f.obstacle).map((f) => f.obstacle);
export function featureObstacle(o) {
  for (const d of OBSTACLES) if (d.test(o)) return d;
  return null;
}

// Candidate ids kept ahead of lateral alternatives when the list is cut.
export const PRIORITY_IDS = new Set(FEATURES.flatMap((f) => f.priority || []));

// Whether a registered feature needs the motion question asked.
const MOTION = FEATURES.filter((f) => f.motion).map((f) => f.motion);
export const featureMotion = (snap) => MOTION.some((m) => m(snap));

// The metrics of the features at `slot` that have met the car this drive.
export function featureMetrics(world, violations, slot) {
  const out = {};
  for (const f of recordsAt("metric", slot)) if (world[f.seen]) out[f.metric.name] = violations[f.metric.name] || 0;
  return out;
}

// The failure texts of the features at `slot`, for a drive's metrics `m`.
export const featureFailures = (m, slot) => recordsAt("metric", slot).filter((f) => m[f.metric.name]).map((f) => f.metric.failure);

// The LLM system prompt's lines at `slot`, each with its newline.
export const promptLines = (slot) => recordsAt("prompt", slot).map((f) => `${f.prompt.text}\n`).join("");

// Every World option a registered feature takes.
export const FEATURE_OPTIONS = FEATURES.map((f) => f.key);
