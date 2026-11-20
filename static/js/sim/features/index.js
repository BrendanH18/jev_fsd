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
//             "balls", "tailgaters" or "parkers" among the metrics and failures)
//   obstacle  { test(o), likePedestrian?, fixed? }: what of `world.obstaclesNear` is the feature's (never
//             followed or passed as traffic; `likePedestrian`: the car is at fault for driving into one;
//             `fixed`: stands where it is, like scenery, in the forward sims)
//   priority  candidate ids kept ahead of lateral alternatives when the list is cut
//   motion    (snap) => whether the model must be asked to stop or drive
//   day       true: while it is on, the World's clock keeps the `day` of the year (World.setClock)
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
//   stepBeforeTraffic(world, fleet, dt) sim/step.js: before anything else ("first"), or just before the
//                                       traffic moves ("end")
//   stepAfterTraffic(world, fleet, dt)  sim/step.js, just before the people on foot move ("end")
//   audit(world)                        World.audit: "driveways", "balls", "tailgaters", "parkers"
//   hides(world, observer, o)           true: it hides `o` from `observer` (World.sees) ("end")
//   placeEgo(world, lane)               the driven car has just been put down on `lane` by hand ("end")
//   evKerb(world, road, front)          the emergency audit's furthest right the car can be asked to pull
//                                       over, metres right of its lane's centre, or Infinity ("end")
//   sense(world, snap, ctx)             the sensing pass: "driveways", "balls", "parkers"
//   limit(snap)                         the speed ceiling `snap.limit`: "driveways", "balls", "parking" (once
//                                       the turnaround and the parking are known)
//   target(snap, v, reasons, ctx)       `desiredSpeed`, returns the new speed: "restrictions", "driveways", "balls"
//   hazard(snap)                        a hazard flag, a list of them, or null: "driveways", "balls",
//                                       "officers", "parkers"
//   detour(snap)                        the move inside the lane it has the car make, or null: after a
//                                       contraflow cyclist's ("contraflow")
//   evStop(world, route, frontS, v, stop, decel)  where the car stops for an emergency vehicle, kept short
//                                       of where the feature has it keep out ("end")
//   blocksView(world, from, to)         true: it blocks the car's view along a street from a junction ("end")
//   turnPace(world, frontS, distance)   { mps, accel } the car crosses a junction at, over what the feature
//                                       makes slippery, or null ("end")
//   candidates(ctx, out)                lane candidates: "restrictions", "driveways", "balls", "tailgaters"
//   adjust(ctx, list)                   every lane candidate once the list is cut: "balls", "end"
//   pullOverDetour(snap, detour, stopS) true: pulling over for an emergency vehicle to stop at `stopS`
//                                       drops the lane's `detour` ("end")
//   brakeDetour(ctx)                    the move `hard_brake` keeps to, or null ("end")
//   sim(world, snap)                    the forward sims: null, or a checker { wheels, start(), afterLaw(car,
//                                       wheelsBefore, t), along(s, front, car), reject(c), settle(candidates) }
//                                       whose rejection comes at its slot: "first", "driveways", "balls", "end";
//                                       `settle` runs once every candidate is judged (after the tailgater's
//                                       ceiling), and may let a rejection stand down
//   state(snap, state)                  the decision state: "restrictions", "driveways", "balls", "tailgaters"
//   outcome(c, snap)                    a candidate's outcome label by its id, or null: "ids"
//   slowOutcome(c, snap)                the outcome of a lane candidate slowed for it, or null: "lane", "end"
//   clause(snap)                        the situation's wording (a sentence or a list), or null: "restrictions",
//                                       "driveways", "balls", "ice" (after black ice's), "tailgaters"
//   holdStill(snap)                     when holding still is right, or "": "driveways", "parkers"
//   prompt                              { at, text }: a line of the LLM system prompt: "restrictions",
//                                       "driveways", "snowbanks", "tailgaters"
//   trafficStart(world, n)              each traffic vehicle, each step, first ("end")
//   trafficReplan(world, n)             before its path is extended; true when re-planned ("end")
//   trafficLane(world, n, front, busy, dt, { offset, moves, pursuit })  { result, shift, aim, now, easing }:
//                                       a move inside the lane ("contraflow", or "parkers" for a line it keeps
//                                       to), handed where the vehicle keeps in its lane so far (`offset`) and
//                                       what the earlier hooks at that slot returned (`moves`): `shift` is
//                                       added to its offset now, `result.limit` caps its speed, `aim` is where
//                                       the move is heading and `now` where it has got to (metres right of the
//                                       lane's centre), `easing` that it is moving off the middle. At
//                                       "parkers" it is also handed `pursuit()`, the arc length its steering
//                                       aims at, and returns `hold` (where it stops), `lineAt(s)` (how much further
//                                       the line moves by arc length s) and `kept(lat)` (how far `lat` is from
//                                       the line it keeps to), for what is in its way
//   trafficYield(world, n, front)       { hold, limit, canStop, controls }: where it stops, its ceiling, and
//                                       how the driver handles the car (`controls(vehicle, steer, accel, dt)`,
//                                       while not braking harder than comfortable) ("end")
//   trafficPullOut(world, n)            false: a car parked at the kerb must not pull out yet ("end")

import potholes from "./potholes.js";
import geese from "./geese.js";
import ice from "./black-ice.js";
import snowbanks from "./snowbanks.js";
import puddles from "./puddles.js";
import roadClosures from "./road-closures.js";

export const FEATURES = [potholes, geese, ice, snowbanks, puddles, roadClosures];

// The slots the core runs each hook and placed field at. A record's hook at any other slot would never
// run, so `hooks` refuses to load one (and scripts/test_feature_registry.mjs checks every record).
export const SLOTS = {
  obstacles: ["end"],
  stepBeforeTraffic: ["first", "end"],
  stepAfterTraffic: ["end"],
  audit: ["driveways", "balls", "tailgaters", "parkers"],
  sense: ["driveways", "balls", "parkers"],
  limit: ["driveways", "balls", "parking"],
  target: ["restrictions", "driveways", "balls"],
  hazard: ["driveways", "balls", "officers", "parkers"],
  turnPace: ["end"],
  candidates: ["restrictions", "driveways", "balls", "tailgaters"],
  adjust: ["balls", "end"],
  brakeDetour: ["end"],
  sim: ["first", "driveways", "balls", "end"],
  state: ["restrictions", "driveways", "balls", "tailgaters"],
  outcome: ["ids"],
  slowOutcome: ["lane", "end"],
  clause: ["restrictions", "driveways", "balls", "ice", "tailgaters"],
  holdStill: ["driveways", "parkers"],
  prompt: ["restrictions", "driveways", "snowbanks", "tailgaters"],
  metric: ["driveways", "balls", "tailgaters", "parkers"],
  trafficStart: ["end"],
  trafficReplan: ["end"],
  trafficLane: ["contraflow", "parkers"],
  trafficYield: ["end"],
  trafficPullOut: ["end"],
  hides: ["end"],
  blocksView: ["end"],
  placeEgo: ["end"],
  evKerb: ["end"],
  evStop: ["end"],
  detour: ["contraflow"],
  pullOverDetour: ["end"],
};
// The fields of a record that are not hooks.
const FIELDS = ["key", "seen", "calls", "build", "obstacle", "priority", "motion", "day"];

// What is wrong with record `f`, or null: a missing field, an unknown hook, or a hook at a slot the core
// never runs.
export function recordProblem(f) {
  for (const k of ["key", "seen", "calls"])
    if (typeof f[k] !== "string" || !f[k]) return `${f.key || "a record"} has no ${k}`;
  if (typeof f.build !== "function") return `${f.key} has no build`;
  for (const [name, h] of Object.entries(f)) {
    if (FIELDS.includes(name)) continue;
    if (!SLOTS[name]) return `${f.key} has an unknown hook or field ${name}`;
    const at = typeof h === "function" ? "end" : h?.at || "end";
    if (!SLOTS[name].includes(at))
      return `${f.key}'s ${name} is at "${at}", which the core never runs: use ${SLOTS[name].join(", ")}`;
  }
  return null;
}
for (const f of FEATURES) {
  const problem = recordProblem(f);
  if (problem) throw new Error(`Feature registry: ${problem}.`);
}

// The functions of hook `name` at `slot`, in registration order (bound to their record as `this`).
// A core module asks for its hooks when it loads, and that may be while the records are still loading,
// through an import cycle (the snowbanks record's simulation reaches sim/npc.js, say): the list it is
// handed is then filled once they have all loaded, before any of it can run.
export function hooks(name, slot = "end") {
  const out = [];
  if (hooks.ready) fillHooks(out, name, slot);
  else (hooks.pending ||= []).push([out, name, slot]);
  return out;
}
function fillHooks(out, name, slot) {
  if (!SLOTS[name]?.includes(slot)) throw new Error(`Feature registry: no slot "${slot}" for ${name}.`);
  for (const f of FEATURES) {
    const h = f[name];
    if (!h) continue;
    const at = typeof h === "function" ? "end" : h.at || "end";
    if (at === slot) out.push((typeof h === "function" ? h : h.run).bind(f));
  }
}

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
export const featureFailures = (m, slot) =>
  recordsAt("metric", slot)
    .filter((f) => m[f.metric.name])
    .map((f) => f.metric.failure);

// The LLM system prompt's lines at `slot`, each with its newline.
export const promptLines = (slot) =>
  recordsAt("prompt", slot)
    .map((f) => `${f.prompt.text}\n`)
    .join("");

// Whether a registered feature that is on reads the day of the year from the World's clock.
const DAY = FEATURES.filter((f) => f.day);
export const featureNeedsDay = (world) => DAY.some((f) => !!world[f.key]?.enabled);

// Every World option a registered feature takes.
export const FEATURE_OPTIONS = FEATURES.map((f) => f.key);

// (the records have loaded: fill the lists handed out before)
hooks.ready = true;
for (const [out, name, slot] of hooks.pending || []) fillHooks(out, name, slot);
hooks.pending = null;
