// The feature registry (docs/feature-interface.md). Each opt-in feature that has moved here is one record,
// in a file of its own beside this one, and one line in FEATURES. The core (sim/world.js, sim/step.js,
// sim/npc.js, brain/sensors.js, brain/candidates.js, brain/state.js, brain/llm-prompt.js, brain/tracks.js,
// bench/metrics.js)
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
//             "streetHazards", "rearTraffic", "late" or "junctions" among the metrics and failures)
//   obstacle  { test(o), traffic?, likePedestrian?, fixed?, predict(o, t)?, visible(world, observer, o)? }:
//             an obstacle supplied by the feature. `traffic` allows it in the traffic sensing pass.
//             `likePedestrian` assigns fault to the ego car on impact. `fixed` treats it as scenery.
//             `predict` and `visible` override its position in predictions and its local visibility.
//   priority  candidate ids kept ahead of lateral alternatives when the list is cut
//   flagText  the model's wording for each road-rule rejection id this feature owns
//   motion    (snap) => whether the model must be asked to stop or drive
//   parkingTraffic(n)  whether this traffic is entering a parking bay
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
//   stepAfterTraffic(world, fleet, dt)  sim/step.js, after contraflow and before the people on foot move ("end")
//   audit(world)                        World.audit: "driveways", "streetHazards", "rearTraffic", "late"
//   hides(world, observer, o)           true: it hides `o` from `observer` (World.sees) ("end")
//   placeEgo(world, lane)               the driven car has just been put down on `lane` by hand ("end")
//   evKerb(world, road, front)          the emergency audit's furthest right the car can be asked to pull
//                                       over, metres right of its lane's centre, or Infinity ("end")
//   sense(world, snap, ctx)             the sensing pass: "driveways", "streetHazards", "late", "junctions",
//                                       or "following" once the vehicles ahead and behind are known
//   laneOffer(snap, side, ctx)          a lane-change offer for a side without one, before bus-lane checks ("end")
//   finishLanes(snap)                   read the final lane-change offers and update sensing ("end")
//   limit(snap)                         the speed ceiling `snap.limit`: "driveways", "streetHazards", "parking" (once
//                                       the turnaround and the parking are known)
//   target(snap, v, reasons, ctx)       `desiredSpeed`, returns the new speed: "restrictions", "driveways", "streetHazards", "beforeEmergency"
//   hazard(snap)                        a hazard flag, a list of them, or null: "driveways", "streetHazards",
//                                       "rearTraffic", "late"
//   detour(snap)                        the move inside the lane it has the car make, or null: after a
//                                       contraflow cyclist's ("contraflow")
//   evStop(world, route, frontS, v, stop, decel)  where the car stops for an emergency vehicle, kept short
//                                       of where the feature has it keep out ("end")
//   blocksView(world, from, to)         true: it blocks the car's view along a street from a junction ("end")
//   turnPace(world, frontS, distance)   { mps, accel } the car crosses a junction at, over what the feature
//                                       makes slippery, or null ("end")
//   candidates(ctx, out)                lane candidates: "restrictions", "driveways", "streetHazards", "junctions", "rearTraffic"
//   laneChangeCandidate(ctx, out)       handle a lane-change offer and return true to consume it ("end")
//   lineStop(snap)                      extra law fields for the candidate that stops at the line ("end")
//   adjust(ctx, list)                   every lane candidate once the list is cut: "streetHazards", "end"
//   pullOverDetour(snap, detour, stopS) true: pulling over for an emergency vehicle to stop at `stopS`
//                                       drops the lane's `detour` ("end")
//   brakeDetour(ctx)                    the move `hard_brake` keeps to, or null ("end")
//   sim(world, snap)                    the forward sims: null, or a checker { wheels, start(), afterLaw(car,
//                                       wheelsBefore, t), along(s, front, car), near(car, box, obstacle,
//                                       predictedBox), reject(c), settle(candidates) }
//                                       whose rejection comes at its slot: "first", "driveways", "streetHazards", "beforeEmergency", "end";
//                                       `settle` runs after `candidateSettle` and may let a rejection stand down
//   predictionIgnore(snap, obstacle)   true to skip an obstacle in the forward simulations ("end")
//   candidateSettle(snap, candidates)  apply checks that compare candidates after all are judged ("end")
//   state(snap, state)                  the decision state: "restrictions", "driveways", "streetHazards", "junctions", "rearTraffic"
//   outcome(c, snap)                    a candidate's outcome label by its id, or null: "ids"
//   slowOutcome(c, snap)                the outcome of a lane candidate slowed for it, or null: "lane", "end"
//   clause(snap)                        the situation's wording (a sentence or a list), or null: "restrictions",
//                                       "driveways", "streetHazards", "ice" (after black ice's), "rearTraffic"
//   holdStill(snap)                     when holding still is right, or "": "driveways", "late"
//   prompt                              { at, text }: a line of the LLM system prompt: "restrictions",
//                                       "streetHazards", "driveways", "snowbanks", "junctions", "rearTraffic"
//   controlDirection(world, vehicle, edgeId) direction overriding the normal signal ("end")
//   controlAudit(world, control, edge, rc, past, entered) true if the feature audits that signal itself ("end")
//   controlSense(world, routeControl, frontS) { direction, fields(signal) } for a visible override ("end")
//   junctionPlan(intersection)          what the sensed override means for speed, rejection and models ("end")
//   trafficControl(world, vehicle, edgeId) direction overriding traffic's signal, with per-car state ("end")
//   evQueueHold(world, front)         { distance, vehicle } of a stopped queue the ego approaches ("end")
//   trafficManage(world, fleet, dt)     update fleet-wide feature state before the vehicle loop ("end")
//   trafficDriver(world, n)             first override of a traffic driver's offset, speedFactor,
//                                       skipFollowing, leadSpeed(leader, speed) or brake(leader, gap, accel) ("end")
//   trafficManeuver(world, fleet, n, dt) true when a feature drives the whole vehicle step ("end")
//   trafficLeaderHold(world, n, path, front) { gap, vehicle } of a virtual traffic leader ("end")
//   trafficParkingPlan(n, standstillGap) { shift, stop, signal } for a car preparing to park ("end")
//   trafficStart(world, n)              each vehicle step, first ("end") or before scanning signals ("beforeControl")
//   trafficReplan(world, n)             before its path is extended; true when re-planned ("end")
//   trafficLane(world, n, front, busy, dt, { offset, moves, pursuit })  { result, shift, aim, now, easing }:
//                                       a move inside the lane ("contraflow", or "late" for a line it keeps
//                                       to), handed where the vehicle keeps in its lane so far (`offset`) and
//                                       what the earlier hooks at that slot returned (`moves`): `shift` is
//                                       added to its offset now, `result.limit` caps its speed, `aim` is where
//                                       the move is heading and `now` where it has got to (metres right of the
//                                       lane's centre), `easing` that it is moving off the middle. At
//                                       "late" it is also handed `pursuit()`, the arc length its steering
//                                       aims at, and returns `hold` (where it stops), `lineAt(s)` (how much further
//                                       the line moves by arc length s) and `kept(lat)` (how far `lat` is from
//                                       the line it keeps to), for what is in its way
//   trafficYield(world, n, front)       { hold, limit, canStop, controls }: where it stops, its ceiling, and
//                                       how the driver handles the car (`controls(vehicle, steer, accel, dt)`,
//                                       while not braking harder than comfortable) ("end")
//   trafficSpeed(world, n, front)       a speed ceiling for both ordinary and emergency traffic ("end")
//   trafficPullOut(world, n)            false: a car parked at the kerb must not pull out yet ("end")

// Import a record through this registry (or a core module), never on its own: the snowbanks record's simulation
// reaches sim/npc.js, which loads this registry while that record is still loading
// (scripts/test_feature_registry.mjs checks each record loads after it).
import balls from "./balls.js";
import driveways from "./driveways.js";
import potholes from "./potholes.js";
import geese from "./geese.js";
import officers from "./officers.js";
import tailgaters from "./tailgaters.js";
import ice from "./black-ice.js";
import snowbanks from "./snowbanks.js";
import puddles from "./puddles.js";
import parkers from "./parkers.js";
import roadClosures from "./road-closures.js";

export const FEATURES = [
  driveways,
  balls,
  potholes,
  geese,
  officers,
  tailgaters,
  ice,
  snowbanks,
  puddles,
  parkers,
  roadClosures,
];

// The slots the core runs each hook and placed field at. A record's hook at any other slot would never
// run, so `hooks` refuses to load one (and scripts/test_feature_registry.mjs checks every record).
export const SLOTS = {
  obstacles: ["end"],
  stepBeforeTraffic: ["first", "end"],
  stepAfterTraffic: ["end"],
  audit: ["driveways", "streetHazards", "rearTraffic", "late"],
  sense: ["driveways", "streetHazards", "late", "junctions", "following"],
  finishLanes: ["end"],
  limit: ["driveways", "streetHazards", "parking"],
  target: ["restrictions", "driveways", "streetHazards", "beforeEmergency"],
  hazard: ["driveways", "streetHazards", "rearTraffic", "late"],
  laneOffer: ["end"],
  laneChangeCandidate: ["end"],
  lineStop: ["end"],
  predictionIgnore: ["end"],
  candidateSettle: ["end"],
  controlDirection: ["end"],
  controlAudit: ["end"],
  controlSense: ["end"],
  junctionPlan: ["end"],
  trafficControl: ["end"],
  turnPace: ["end"],
  candidates: ["restrictions", "driveways", "streetHazards", "junctions", "rearTraffic"],
  adjust: ["streetHazards", "end"],
  brakeDetour: ["end"],
  sim: ["first", "driveways", "streetHazards", "beforeEmergency", "end"],
  state: ["restrictions", "driveways", "streetHazards", "junctions", "rearTraffic"],
  outcome: ["ids"],
  slowOutcome: ["lane", "end"],
  clause: ["restrictions", "driveways", "streetHazards", "ice", "rearTraffic"],
  holdStill: ["driveways", "late"],
  prompt: ["restrictions", "streetHazards", "driveways", "snowbanks", "junctions", "rearTraffic"],
  metric: ["driveways", "streetHazards", "rearTraffic", "late", "junctions"],
  evQueueHold: ["end"],
  trafficManage: ["end"],
  trafficDriver: ["end"],
  trafficManeuver: ["end"],
  trafficLeaderHold: ["end"],
  trafficParkingPlan: ["end"],
  trafficStart: ["end", "beforeControl"],
  trafficReplan: ["end"],
  trafficLane: ["contraflow", "late"],
  trafficYield: ["end"],
  trafficSpeed: ["end"],
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
const FIELDS = ["key", "seen", "calls", "build", "obstacle", "priority", "flagText", "motion", "parkingTraffic", "day"];

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

// Return the first result when a feature takes over a junction control.
export function firstHookResult(list, ...args) {
  for (const run of list) {
    const result = run(...args);
    if (result) return result;
  }
  return null;
}

const CONTROL_DIRECTION = hooks("controlDirection");
const JUNCTION_PLAN = hooks("junctionPlan");
export const controlDirection = (world, vehicle, edgeId) => firstHookResult(CONTROL_DIRECTION, world, vehicle, edgeId);
export const junctionPlan = (intersection) => firstHookResult(JUNCTION_PLAN, intersection);

// The records with field `name` at `slot` (for data fields such as `metric` and `prompt`).
export const recordsAt = (name, slot) => FEATURES.filter((f) => f[name] && (f[name].at || "end") === slot);

// The obstacle descriptor of the feature `o` belongs to, or null.
const OBSTACLES = FEATURES.filter((f) => f.obstacle).map((f) => f.obstacle);
export function featureObstacle(o) {
  for (const d of OBSTACLES) if (d.test(o)) return d;
  return null;
}

// Whether an obstacle can be followed or passed as traffic.
export function isTrafficObstacle(o) {
  const feature = featureObstacle(o);
  return !feature || feature.traffic;
}

// Candidate ids kept ahead of lateral alternatives when the list is cut.
export const PRIORITY_IDS = new Set(FEATURES.flatMap((f) => f.priority || []));
export const FEATURE_FLAG_TEXT = Object.assign({}, ...FEATURES.map((f) => f.flagText));

// Whether a traffic vehicle is manoeuvring into a parking space.
const PARKING_TRAFFIC = FEATURES.filter((f) => f.parkingTraffic).map((f) => f.parkingTraffic);
export const isParkingTraffic = (vehicle) => !!vehicle.parking || PARKING_TRAFFIC.some((test) => test(vehicle));

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
