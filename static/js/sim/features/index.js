// The feature registry (docs/feature-interface.md). Each opt-in feature that has moved here is one record,
// in a file of its own beside this one, and one line in FEATURES. The core (sim/world.js, sim/step.js,
// sim/npc.js, brain/sensors.js, brain/candidates.js, brain/state.js, brain/llm-prompt.js, brain/tracks.js,
// brain/rules.js, brain/safety.js, agents/cautious.js, sim/free-drive.js, bench/metrics.js,
// lab/trace.js, lab/examiner.js)
// loops over the records' hooks and never names these features.
//
// A record:
//   key       the World option (fleet option when `buildFleet` is present) and the default World property
//   flag      optional URL parameter including when it differs from the lowercase option key
//   property  the World property when it differs from `key`
//   defaultCount  the free-drive default for a feature whose option is a count
//   buildAt   optional earlier construction: "early" before the crowd, or "afterSpawn" before other bay reservations
//   snapshot  default sensing fields kept in the snapshot even when the feature is inactive
//   seen      the World flag that gates the metric after the feature has met the driven car
//             (required unless metric.reportWhenEnabled uses a boolean World option)
//   calls     an optional World map of the audit's calls, cleared when the car is moved by hand
//   build(world, { enabled, seed, map })   the feature's World state
//   buildFleet(fleet, { enabled, seed, makePath })   fleet state, stored under the option key
//   metric    { at, name, failure, label, category?, decimals?, threshold?, traceType? }: the violation,
//             failure text, trace label and examiner category. `eventType` supplies a world event's replay marker.
//             `initial` supplies an existing counter at World creation. A duration can round to `decimals` and
//             fail above `threshold`. With `traceType` it emits a single named event at the threshold
//             instead of logging every increase.
//   obstacle  { test(o), traffic?, likePedestrian?, fixed?, predict(o, t)?, visible(world, observer, o)?, label? }:
//             an obstacle supplied by the feature. `traffic` allows it in the traffic sensing pass.
//             `likePedestrian` assigns fault to the ego car on impact. `fixed` treats it as scenery.
//             `predict` and `visible` override its position in predictions and its local visibility.
//             `oncoming(o, vehicle)` identifies an opposing rider instead of a leader or cyclist to pass.
//             `long` uses the long-vehicle leader check. `parkedClearance(o)` eases by cars at the kerb.
//             `noParking(o)` skips the fleet's parking scheduler. `fixedCruise` keeps the actor's
//             own free speed in all weathers. `noCyclistPass` keeps it behind cyclists.
//   priority  candidate ids kept ahead of lateral alternatives when the list is cut
//   flagText  the model's wording for each road-rule rejection id this feature owns
//   motion    (snap) => whether the model must be asked to stop or drive
//   parkingTraffic(n)  whether this traffic is entering a parking bay
//   day       true: while it is on, the World's clock keeps the `day` of the year (World.setClock)
//   utcOffset true: while it is on, the World's clock keeps `utc_offset`
//   and the hooks below.
//
//   rulesStop(snap, eligible)          true when Rules should stop ("beforeSignal" or "end")
//   rulesCost(candidate, snap)        a signed change to Rules' cost for the candidate ("end")
//   cautious(snap, eligible, target)   a candidate the cautious agent should choose, or null
//                                       ("beforeBusLanes", "end", "beforeAmber", "afterAmber")
//   cautiousStop(snap)                true when the cautious agent sets a target of zero ("end")
//   cautiousDrive(candidate, snap)    true when the candidate's own law brings it to a stop ("end")
//   legitimateStop(snap, clearing)    true when waiting here is legitimate and should not count as deadlock ("end")
//
// A hook is a function, or { at, run } to run it at a slot. The core runs each hook where the feature's
// own code used to be, so every result stays exactly as it was. While other features are still written
// into the core, a slot names the one (or the core step) the hook runs right after in that pipeline;
// hooks without `at` run at the slot "end". Once every feature is a record (ROADMAP 3.2), registration
// order alone can place them and the slots can go.
//
// Hooks (and their slots in the core): "beforeRunner" keeps sensing, candidate checks, wording and
// metrics before the red-light runner's corresponding code. SLOTS lists every supported position.
//   obstacles(world, x, y, r)          World.obstaclesNear, after the others ("end")
//   stepBeforeTraffic(world, fleet, dt) sim/step.js: before anything else ("first"), or just before the
//                                       traffic moves ("end"), with "afterOutages" between them
//   stepAfterTraffic(world, fleet, dt)  sim/step.js, after traffic and before the people on foot move ("end")
//   audit(world, frontOnPath?)           World.audit: "beforeCollisions" (with dt), "afterFlagger", "afterCalming", "driveways",
//                                       "streetHazards", "rearTraffic", "late"
//   hides(world, observer, o)           true: it hides `o` from `observer` (World.sees) ("end")
//   placeEgo(world, lane)               the driven car has just been put down on `lane` by hand ("end")
//   evKerb(world, road, front)          the emergency audit's furthest right the car can be asked to pull
//                                       over, metres right of its lane's centre, or Infinity ("end")
//   sense(world, snap, ctx)             the sensing pass: "parking", "driveways", "streetHazards", "late", "junctions",
//                                       or "following" once the vehicles ahead and behind are known
//   laneOffer(snap, side, ctx)          a lane-change offer for a side without one, before bus-lane checks ("end")
//   finishLanes(snap)                   read the final lane-change offers and update sensing ("end")
//   limit(snap)                         the speed ceiling `snap.limit`: "passing", "driveways", "streetHazards", "parking" (once
//                                       the turnaround and the parking are known)
//   target(snap, v, reasons, ctx)       `desiredSpeed`, returns the new speed at that point in the planner
//   hazard(snap)                        a hazard flag, a list of them, or null: "parking", "driveways", "streetHazards",
//                                       "rearTraffic", "late"
//   followingExclusion(snap)           id of a vehicle treated as a stop instead of a follow target ("end")
//   detour(snap)                        a move round an obstruction ("parking") or inside the lane
//                                       in registration order ("end"), or null
//   evStop(world, route, frontS, v, stop, decel)  where the car stops for an emergency vehicle, kept short
//                                       of where the feature has it keep out ("end")
//   blocksView(world, from, to)         true: it blocks the car's view along a street from a junction ("end")
//   turnPace(world, frontS, distance)   { mps, accel } the car crosses a junction at, over what the feature
//                                       makes slippery, or null ("end")
//   candidates(ctx, out)                lane candidates: "restrictions", "driveways", "streetHazards", "junctions", "rearTraffic", "parking"
//   laneChangeCandidate(ctx, out)       handle a lane-change offer and return true to consume it ("end")
//   lineStop(snap)                      extra law fields for the candidate that stops at the line ("end")
//   adjust(ctx, list)                   every lane candidate once the list is cut: "streetHazards", "end"
//   pullOverDetour(snap, detour, stopS) true: pulling over for an emergency vehicle to stop at `stopS`
//                                       drops the lane's `detour` ("end")
//   brakeDetour(ctx)                    the move `hard_brake` keeps to, or null ("end")
//   sim(world, snap, predictions)       the forward sims: null, or a checker { wheels, start(), afterLaw(car,
//                                       wheelsBefore, t), along(s, front, car), near(car, box, obstacle,
//                                       predictedBox, ahead, side, meeting), reject(c), settle(candidates) }
//                                       whose rejection comes at its slot: "first", "beforeRunner", "driveways",
//                                       "streetHazards", "beforeEmergency", "parking" or "end";
//                                       `settle` runs after `candidateSettle` and may let a rejection stand down
//   predictionIgnore(snap, obstacle)   true to skip an obstacle in the forward simulations ("end")
//   candidateSettle(snap, candidates)  apply checks that compare candidates after all are judged ("end")
//   state(snap, state)                  the decision state: "restrictions", "driveways", "streetHazards", "junctions", "rearTraffic", "parking"
//   greenSignalClause(snap, metres)     wording replacing the normal green-light instruction, or null ("end")
//   outcome(c, snap)                    a candidate's outcome label by its id, or null: "ids"
//   slowOutcome(c, snap)                the outcome of a lane candidate slowed for it, or null: "lane", "end"
//   clause(snap)                        the situation's wording (a sentence or a list), or null: "restrictions",
//                                       "driveways", "streetHazards", "ice" (after black ice's), "rearTraffic", "parking"
//   holdStill(snap)                     when holding still is right, or "": "driveways", "late", "parking"
//   prompt                              { at, text }: a section of the LLM system prompt: "restrictions",
//                                       "streetHazards", "driveways", "snowbanks", "junctions", "rearTraffic", "parking", "afterParking"
//   phaseBansRedTurns(intersection)    true when the current signal plan forbids all turns on red
//   redLightEvent(event, intersection) attach phase-specific fields to a red-light event
//   intersectionFields(world, inter, context) snapshot fields next to the turn-on-red offers
//   intersectionModelFields(intersection) decision fields before cross-traffic data
//   controlReplace(world, control, edgeId) replacement control, or the original to prevent later overrides
//   alternateSignal(world, id)         temporary signal state or null
//   diagonalCrossing(intersection)     true if pedestrians may choose the opposite corner
//   senseSignalControl(world, routeControl, signal) { control, fields } for a visible replacement
//   controlEvent(control)             extra fields on an audited stop or all-way yield event
//   trafficReleaseControl(world, n, edge, control, memory, distance) true when traffic clears a replaced stop
//   controlDirection(world, vehicle, edgeId) direction overriding the normal signal ("end")
//   controlAudit(world, control, edge, rc, past, entered) true if the feature audits that signal itself ("end")
//   auditSignal(world, control, edge, rc, past, entered) observe a signal approach under the ordinary signal audit ("end")
//   resetContact(world)                clear per-approach state when the car is moved by hand ("end")
//   controlSense(world, routeControl, frontS) { direction, fields(signal) } for a visible override ("end")
//   junctionPlan(intersection)          what the sensed override means for speed, rejection and models ("end")
//   trafficControl(world, vehicle, edgeId) direction overriding traffic's signal, with per-car state ("end")
//   trafficSignalProceed(world, fleet, n, edge, control, signal, distance, canStop) truthy to skip an ordinary signal stop ("end")
//   trafficSignalHold(world, n, edge, control, distance, traffic) truthy to hold ordinary traffic at a green ("end")
//   evQueueHold(world, front)         { distance, vehicle } of a stopped queue the ego approaches ("end")
//   trafficManage(world, fleet, dt)     update fleet-wide state before and after plow dispatch ("beforePlows", "afterPlows") or before the vehicle loop ("end")
//   trafficDriver(world, n)             first override of a traffic driver's offset, speedFactor,
//                                       skipFollowing, leadSpeed(leader, speed) or brake(leader, gap, accel) ("end")
//   trafficManeuver(world, fleet, n, dt) true when a feature drives the whole vehicle step ("beforeSpecial" or "end")
//   trafficStop(world, fleet, n, front, dt)  plan a stop and return the following controller's gap, or null ("end")
//   trafficCorridor(world, n, path, front) first corridor { shift, lineAt(s), ignore, limit, stop() }, or null
//   trafficLaneControl(world, n, path, front) a separate lane restriction with the corridor fields above
//                                       and a deferred stop returning { gap, v } or null
//   trafficOvertaking(world, n, edge, all, dt, held, driver) { vehicle, shift, clearance } of a current pass
//   activeManeuver(snap, passing)       { keep(candidate), brake } or null, for a passing law under way
//   activeOutcome(candidate, snap)    how a passing candidate finishes, checked after the road edge
//   passClearance(world, snap)          { metres, rejection } for bicycle clearance, or null for the default
//   driveCriterion(snap)               wording appended to the motion question's drive criterion
//   followingOmitted(snap, vehicle)     true if this vehicle is left out of ordinary leader sensing
//   laneGapBlocked(snap, side)          true if the destination lane's rear gap is too short
//   laneTargetFields(sideSnap, offset) adjust constraints for the destination lane's speed calculation
//   lanePassBlocked(snap, side, leader) true if a pass of this leader in the destination lane is prohibited
//   trafficFollowingLeader(fleet, n, path, front, offset, limit, look) { vehicle, gap }, or null
//   trafficLeadPolicy(n, leader, limit, standstillGap) { fields, extraGap } for a special leader
//   trafficPassingLaneBlocked(world, n, dir) true if traffic cannot pass in the proposed direction
//   trafficMergeGap(vehicle, distance, limit) minimum extra gap from a vehicle across a lane change
//   coachCorridor(world, limit)        temporary passage through a restricted area for the coach
//   coachCorridorFrame(score, corridor, context) record a passage incident and return immediate guidance
//   examinerFail(report)              an examiner failure item or null ("beforeTracks")
//   checkpoint(world, fleet)            restore references after the recorder reinstates state ("end")
//   trafficLeaderHold(world, n, path, front) { gap, vehicle } of a virtual traffic leader ("end")
//   trafficParkingPlan(n, standstillGap) { shift, stop, signal } for a car preparing to park ("end")
//   trafficStart(world, n)              each vehicle step, first ("end") or before scanning signals ("beforeControl")
//   trafficReplan(world, n)             before its path is extended; true when re-planned ("end")
//   trafficSpawnBlocked(world, x, y)   true when a traffic spawn is too close to an obstruction ("end")
//   trafficBypass(world, n, front, all, defaultDriver) first bypass or wait for an obstruction: { shift,
//                                       lineAt(s), ignore, waitGap, limit } at the pursuit point ("end")
//   trafficActors(world)               road users outside the fleet, also considered by traffic
//   trafficLane(world, n, front, busy, dt, { offset, moves, pursuit })  { result, shift, aim, now, easing }:
//                                       a move inside the lane ("beforeLaneMoves", "laneMoves", or "late" for a line it keeps
//                                       to), handed where the vehicle keeps in its lane so far (`offset`) and
//                                       what the earlier hooks at that slot returned (`moves`): `shift` is
//                                       added to its offset now, `result.limit` caps its speed, `aim` is where
//                                       the move is heading and `now` where it has got to (metres right of the
//                                       lane's centre), `easing` that it is moving off the middle.
//                                       "beforeLaneMoves" offsets apply first and may return a `hold`. At
//                                       "late" it is also handed `pursuit()`, the arc length its steering
//                                       aims at, and returns `hold` (where it stops), `lineAt(s)` (how much further
//                                       the line moves by arc length s) and `kept(lat)` (how far `lat` is from
//                                       the line it keeps to), for what is in its way
//   trafficYield(world, n, front)       { hold, limit, canStop, controls }: where it stops, its ceiling, and
//                                       how the driver handles the car (`controls(vehicle, steer, accel, dt)`,
//                                       while not braking harder than comfortable) ("end")
//   trafficSpeed(world, n, front)       a speed ceiling for ordinary traffic before reading the signals
//                                       ("beforeControl") or later ("ordinary"), or both ordinary
//                                       and emergency traffic ("end")
//   trafficPullOut(world, n)            false: a car parked at the kerb must not pull out yet ("end")

// Import a record through this registry (or a core module), never on its own: the snowbanks record's simulation
// reaches sim/npc.js, which loads this registry while that record is still loading
// (scripts/test_feature_registry.mjs checks each record loads after it).
import { featureRecordProblem, featureRegistryProblem, slotOf } from "../feature-schema.js";
import { setSignalPhaseResolver } from "../signals.js";
import balls from "./balls.js";
import contraflow from "./contraflow.js";
import collection from "./collection-truck.js";
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
import doubleParked from "./double-parked.js";
import sunGlare from "./sun-glare.js";
import calming from "./traffic-calming.js";
import guards from "./crossing-guard.js";
import pxo from "./pxo.js";
import roadside from "./roadside.js";
import following from "./following.js";
import restrictions from "./turn-restrictions.js";
import highBeams from "./high-beams.js";
import redTurnSigns from "./red-turn-signs.js";
import workZones from "./work-zones.js";
import outages from "./outages.js";
import nightFlash from "./night-flash.js";
import leftOnRed from "./left-on-red.js";
import amber from "./amber.js";
import busLanes from "./bus-lanes.js";
import scrambles from "./scrambles.js";
import cyclistPassing from "./cyclist-pass.js";
import closures from "./lane-closure.js";
import plows from "./snow-plow.js";
import runners from "./red-light-runner.js";

export const FEATURES = [
  highBeams,
  guards,
  pxo,
  restrictions,
  calming,
  sunGlare,
  contraflow,
  runners,
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
  collection, // A stopped truck also matches the double-parked obstacle.
  doubleParked,
  roadside,
  following,
  redTurnSigns,
  scrambles,
  workZones,
  outages,
  plows,
  closures,
  cyclistPassing,
  nightFlash,
  leftOnRed,
  amber,
  busLanes,
];

// The slots the core runs each hook and placed field at. A record's hook at any other slot would never
// run, so `hooks` refuses to load one (and scripts/test_feature_registry.mjs checks every record).
export const SLOTS = {
  routeOptions: ["end"],
  requestReroute: ["beforeOffRoute", "afterOffRoute"],
  checkpointShare: ["end"],
  rulesStop: ["beforeSignal", "end"],
  notice: ["beforeMerge", "beforePlow", "afterTraffic", "beforeLeftOnRed", "afterTurnNotice", "end", "beforeZone"],
  perceptionLine: ["end"],
  perceptionFocus: ["end"],
  rulesCost: ["beforeSpeedCost", "beforeSignalStop", "beforeStops", "stops", "afterSpecial", "beforePassing", "end"],
  cautious: [
    "beforeBusLanes",
    "reservedLane",
    "afterBusLanes",
    "passing",
    "afterPassing",
    "end",
    "beforeAmber",
    "signalStop",
    "afterAmber",
  ],
  cautiousStop: ["end"],
  cautiousDrive: ["end"],
  legitimateStop: ["end"],
  obstacles: ["end"],
  stepBeforeTraffic: ["first", "afterParked", "afterMerge", "afterOutages", "end"],
  stepAfterTraffic: ["end"],
  audit: [
    "afterPassing",
    "beforeCollisions",
    "beforeMerge",
    "afterFlagger",
    "afterCalming",
    "beforeReservedLane",
    "afterRoadsideVehicles",
    "beforeDriveways",
    "driveways",
    "streetHazards",
    "rearTraffic",
    "late",
  ],
  sense: [
    "beforeLaneState",
    "afterPedestrians",
    "beforeWorkZone",
    "afterCalming",
    "beforeRunner",
    "afterParking",
    "beforeParking",
    "parking",
    "driveways",
    "streetHazards",
    "late",
    "junctions",
    "following",
    "beforeTarget",
    "end",
  ],
  finishLanes: ["end"],
  laneOfferBlocked: ["end"],
  candidateLaneReject: ["end"],
  routeLaneIndex: ["end"],
  routeLaneMerges: ["end"],
  trafficLaneInto: ["end"],
  trafficSuccessorPool: ["end"],
  trafficSpawnLaneBlocked: ["end"],
  busSpawnLane: ["end"],
  trafficPathPolicy: ["end"],
  trafficLaneDirection: ["end"],
  limit: [
    "beforeWorkZone",
    "beforeRunner",
    "passing",
    "driveways",
    "streetHazards",
    "beforeBlindSpots",
    "beforeParking",
    "parking",
  ],
  target: [
    "beforeMerge",
    "beforeRunner",
    "restrictions",
    "beforeCurve",
    "beforeRoadside",
    "beforeParked",
    "afterLeader",
    "beforeCrosswalk",
    "afterSchoolBus",
    "driveways",
    "streetHazards",
    "beforeEmergency",
    "beforeParking",
    "parking",
  ],
  hazard: [
    "beforeWorkZone",
    "beforeRunner",
    "afterParking",
    "parkingApproach",
    "parking",
    "driveways",
    "streetHazards",
    "rearTraffic",
    "late",
  ],
  laneOffer: ["afterPassing", "end"],
  laneChangeCandidate: ["end"],
  laneChangeStyle: ["end"],
  lineStop: ["beforeFollower", "end"],
  predictionIgnore: ["end"],
  candidateSettle: ["end"],
  controlDirection: ["end"],
  controlAudit: ["end"],
  auditSignal: ["end"],
  observeControl: ["end"],
  observeSignal: ["end"],
  arrowExitAudit: ["end"],
  routeControlSense: ["end"],
  signalDecision: ["end"],
  clearingLimit: ["end"],
  yellowSignalClause: ["end"],
  stopAtLineDrive: ["end"],
  trafficSignalDecision: ["end"],
  specialSignalPhase: ["end"],
  priorityLevel: ["end"],
  priorityJunction: ["end"],
  priorityTrafficOutside: ["end"],
  trafficSignalPolicy: ["end"],
  visibleSignalPolicy: ["end"],
  signalClause: ["end"],
  resetContact: ["end"],
  controlSense: ["end"],
  junctionPlan: ["end"],
  trafficControl: ["end"],
  trafficSignalProceed: ["end"],
  trafficSignalHold: ["end"],
  turnPace: ["end"],
  candidates: [
    "beforeMerge",
    "afterFlagger",
    "beforeRunner",
    "restrictions",
    "driveways",
    "streetHazards",
    "junctions",
    "rearTraffic",
    "beforeParking",
    "afterParking",
    "parking",
  ],
  adjust: ["streetHazards", "end", "finish"],
  brakeDetour: ["end"],
  sim: [
    "beforeRunner",
    "first",
    "beforeOffRoad",
    "afterCollision",
    "beforeMerge",
    "driveways",
    "streetHazards",
    "beforeEmergency",
    "parking",
    "merge",
    "afterMerge",
    "end",
  ],
  state: [
    "beforeRoadConstraints",
    "beforeMerge",
    "signal",
    "afterFollowing",
    "afterParking",
    "beforePlow",
    "nearbySpecial",
    "afterPlow",
    "beforeRunner",
    "restrictions",
    "afterCalming",
    "driveways",
    "streetHazards",
    "junctions",
    "rearTraffic",
    "beforeParking",
    "parking",
  ],
  greenSignalClause: ["end"],
  outcome: ["ids", "laneChange"],
  slowOutcome: ["lane", "end"],
  clause: [
    "beforeCalming",
    "stopStart",
    "signal",
    "afterJunctionBox",
    "afterClosure",
    "afterParking",
    "afterPassing",
    "following",
    "beforeRunner",
    "restrictions",
    "afterCalming",
    "driveways",
    "streetHazards",
    "ice",
    "rearTraffic",
    "beforeParking",
    "parking",
  ],
  holdStill: ["beforeMerge", "afterFlagger", "beforeRunner", "driveways", "late", "beforeParking", "parking"],
  prompt: [
    "introduction",
    "headlights",
    "pedestrian",
    "beforeSchoolBus",
    "beforeMerge",
    "nearbySpecial",
    "afterPlow",
    "afterAllWay",
    "beforeBusLanes",
    "reservedLane",
    "afterBusLanes",
    "beforeRightOnRed",
    "amberDecision",
    "afterGlare",
    "beforeRunner",
    "restrictions",
    "streetHazards",
    "driveways",
    "snowbanks",
    "junctions",
    "rearTraffic",
    "beforeParking",
    "afterParkingAdvice",
    "parking",
    "afterParking",
  ],
  metric: [
    "afterRedLights",
    "vehiclePassing",
    "afterPassing",
    "headlights",
    "afterHeadlights",
    "pxo",
    "turns",
    "afterRestrictions",
    "afterCalming",
    "guards",
    "beforeRunner",
    "driveways",
    "streetHazards",
    "rearTraffic",
    "late",
    "junctions",
  ],
  evQueueHold: ["end"],
  trafficManage: ["beforePlows", "dispatch", "afterPlows", "end"],
  trafficFollowingLeader: ["end"],
  trafficLeadPolicy: ["end"],
  trafficPassingLaneBlocked: ["end"],
  trafficMergeGap: ["end"],
  laneGapBlocked: ["end"],
  laneTargetFields: ["end"],
  lanePassBlocked: ["end"],
  trafficDriver: ["end"],
  trafficManeuver: ["beforeSpecial", "end"],
  trafficStop: ["afterMerge", "end"],
  checkpoint: ["end"],
  trafficLeaderHold: ["end"],
  trafficParkingPlan: ["end"],
  trafficStart: ["end", "beforeControl"],
  trafficReplan: ["beforeCorner", "end"],
  trafficActors: ["end"],
  trafficLane: ["beforeLaneMoves", "laneMoves", "late"],
  trafficYield: ["end"],
  trafficSpeed: ["beforeControl", "clearing", "limit", "following", "ordinary", "end"],
  trafficParkingReach: ["end"],
  trafficTurnBlocked: ["end"],
  visionRange: ["end"],
  redEntryBans: ["end"],
  turnOnRedBlocked: ["end"],
  extraRedTurn: ["end"],
  senseRedTurn: ["end"],
  redTurnMemory: ["end"],
  redTurnExit: ["end"],
  trafficRedTurnLane: ["end"],
  routeTurnOnRedBlocked: ["end"],
  phaseBansRedTurns: ["end"],
  controlReplace: ["end"],
  alternateSignal: ["end"],
  diagonalCrossing: ["end"],
  senseSignalControl: ["end"],
  controlEvent: ["end"],
  trafficReleaseControl: ["end"],
  intersectionModelFields: ["beforeCrossTraffic", "afterCrossTraffic"],
  redLightEvent: ["end"],
  intersectionFields: ["beforeLine", "afterRightTurn"],
  signalEntryFields: ["end"],
  followingPolicy: ["end"],
  handlesPedestrian: ["end"],
  returnClause: ["end"],
  standingVehicleLabel: ["end"],
  questions: ["end"],
  decisionFields: ["end"],
  trafficPullOut: ["end"],
  hides: ["end"],
  blocksView: ["end"],
  placeEgo: ["end"],
  evKerb: ["end"],
  evStop: ["end"],
  followingExclusion: ["end"],
  trafficBypass: ["end"],
  trafficOvertaking: ["end"],
  activeManeuver: ["end"],
  activeOutcome: ["end"],
  passClearance: ["end"],
  suppressFollowingClause: ["end"],
  driveCriterion: ["end"],
  followingOmitted: ["end"],
  trafficLaneControl: ["end"],
  trafficCorridor: ["end"],
  coachCorridor: ["end"],
  coachCorridorFrame: ["end"],
  examinerFail: ["beforeTracks"],
  passBlockReason: ["end"],
  trafficSpawnBlocked: ["end"],
  detour: ["beforeMerge", "laneControl", "parking", "optional", "end"],
  pullOverDetour: ["end"],
};
export const recordProblem = (record) => featureRecordProblem(record, SLOTS);
export const registryProblem = (records) => featureRegistryProblem(records, SLOTS);
const problem = registryProblem(FEATURES);
if (problem) throw new Error(`Feature registry: ${problem}.`);
freezeDeclarations(FEATURES);
freezeDeclarations(SLOTS);

function freezeDeclarations(object) {
  if (!object || typeof object !== "object" || Object.isFrozen(object)) return;
  Object.freeze(object);
  for (const { value } of Object.values(Object.getOwnPropertyDescriptors(object))) freezeDeclarations(value);
}

// A core module can ask before the registry finishes loading through an import cycle.
// Keep its list identity and fill the list in registration order once all records are ready.
function hookLists() {
  return (hookLists.state ??= { byName: new Map(), pending: [], ready: false });
}

export function hooks(name, slot = "end") {
  const state = hookLists();
  if (!state.byName.has(name)) state.byName.set(name, new Map());
  const slots = state.byName.get(name);
  if (slots.has(slot)) return slots.get(slot);
  const out = [];
  if (state.ready) fillHooks(out, name, slot);
  else state.pending.push([out, name, slot]);
  slots.set(slot, out);
  return out;
}

function fillHooks(out, name, slot) {
  if (name === "metric" || name === "prompt" || name === "notice")
    throw new Error(`Feature registry: ${name} is data. use recordsAt().`);
  if (!Object.hasOwn(SLOTS, name) || !SLOTS[name].includes(slot))
    throw new Error(`Feature registry: no slot "${slot}" for ${name}.`);
  for (const record of FEATURES) {
    const hook = record[name];
    if (hook && slotOf(hook) === slot) out.push((typeof hook === "function" ? hook : hook.run).bind(record));
  }
  Object.freeze(out);
}

// Return the first result when a feature takes over a core decision.
export function firstHookResult(list, ...args) {
  for (const run of list) {
    const result = run(...args);
    if (result) return result;
  }
  return null;
}

const ROUTE_OPTIONS = hooks("routeOptions");
export function featureRouteOptions(world, rerouting = false) {
  const result = {};
  for (const options of ROUTE_OPTIONS) Object.assign(result, options(world, rerouting));
  return result;
}

const CONTROL_DIRECTION = hooks("controlDirection");
const JUNCTION_PLAN = hooks("junctionPlan");
export const controlDirection = (world, vehicle, edgeId) => firstHookResult(CONTROL_DIRECTION, world, vehicle, edgeId);
export const junctionPlan = (intersection) => firstHookResult(JUNCTION_PLAN, intersection);

const SIGNAL_DECISIONS = hooks("signalDecision");
export const signalDecision = (intersection) => firstHookResult(SIGNAL_DECISIONS, intersection);
const STOP_AT_LINE_DRIVE = hooks("stopAtLineDrive");
const CLEARING_LIMITS = hooks("clearingLimit");
export const clearingLimits = (snap) => CLEARING_LIMITS.map((limit) => limit(snap)).filter(Boolean);
export const stopAtLineDrive = (snap, candidate) =>
  STOP_AT_LINE_DRIVE.some((keepDriving) => keepDriving(snap, candidate));

const PHASE_BANS_RED_TURNS = hooks("phaseBansRedTurns");
export const phaseBansRedTurns = (inter) => PHASE_BANS_RED_TURNS.some((blocked) => blocked(inter));

const EXTRA_RED_TURNS = hooks("extraRedTurn");
export const extraRedTurn = (intersection) => firstHookResult(EXTRA_RED_TURNS, intersection);
export const redTurnAllowed = (intersection) => intersection?.right_on_red?.go || extraRedTurn(intersection)?.move.go;

const TRAFFIC_PATH_POLICY = hooks("trafficPathPolicy");
export function applyTrafficPathPolicy(world, path, transit = null) {
  for (const apply of TRAFFIC_PATH_POLICY) apply(world, path, transit);
}
const PRIMARY_DETOURS = hooks("detour", "beforeMerge");
export const primaryDetour = (snap) => firstHookResult(PRIMARY_DETOURS, snap);

const LANE_CONTROL_DETOURS = hooks("detour", "laneControl");
export const laneControlDetour = (snap) => firstHookResult(LANE_CONTROL_DETOURS, snap);

const OPTIONAL_DETOURS = hooks("detour", "optional");
export const featureOptionalDetour = (snap) => firstHookResult(OPTIONAL_DETOURS, snap);

const CONTROL_REPLACEMENTS = hooks("controlReplace");
const SIGNAL_OVERRIDES = hooks("alternateSignal");
const SPECIAL_SIGNAL_PHASE = hooks("specialSignalPhase");
export const specialSignalPhase = (inter, world) => firstHookResult(SPECIAL_SIGNAL_PHASE, inter, world);
export const controlAt = (world, control, edge) =>
  firstHookResult(CONTROL_REPLACEMENTS, world, control, edge) ?? control;
export const alternateSignal = (world, id) => firstHookResult(SIGNAL_OVERRIDES, world, id);

// The records with field `name` at `slot` (for data fields such as `metric` and `prompt`).
export function recordsAt(name, slot) {
  if (!Object.hasOwn(SLOTS, name) || !SLOTS[name].includes(slot))
    throw new Error(`Feature registry: no slot "${String(slot)}" for ${String(name)}.`);
  return FEATURES.filter((f) => f[name] && slotOf(f[name]) === slot);
}

const NOTICES = Object.fromEntries(
  SLOTS.notice.map((slot) => [slot, recordsAt("notice", slot).sort((a, b) => a.notice.order - b.notice.order)]),
);
const EVENT_BADGES = Object.assign(Object.create(null), ...FEATURES.map((f) => f.eventBadges));
const PERCEPTION_REJECTIONS = Object.assign(Object.create(null), ...FEATURES.map((f) => f.perceptionRejections));

export function announceFeatureNotices(slot, world, autopilot, views, announced, hud) {
  if (!Object.hasOwn(NOTICES, slot)) throw new Error(`Feature registry: no notice slot "${slot}".`);
  for (const { key, notice } of NOTICES[slot]) {
    const previous = announced.get(key);
    const line = notice.read(world, autopilot, views, previous);
    if (line && line.key !== previous) {
      if (line.key == null || typeof line.text !== "string" || !line.text.trim())
        throw new Error(`Feature registry: ${key} returned a notice without a key or text.`);
      const style = typeof notice.style === "function" ? notice.style(line) : notice.style;
      hud.badge(line.text, style ?? "", notice.duration);
      announced.set(key, line.key);
    } else if (!line && !notice.hold) announced.delete(key);
  }
}

export function featureEventBadge(event) {
  const badge = EVENT_BADGES[event?.type];
  return typeof badge === "function" ? badge(event) : badge;
}

export const featurePerceptionRejection = (id) => PERCEPTION_REJECTIONS[id];

// Metrics in slot order, with registration order within each slot.
const METRIC_RECORDS = new Map(SLOTS.metric.map((slot) => [slot, recordsAt("metric", slot)]));
export const FEATURE_METRICS = Object.freeze(
  [...METRIC_RECORDS.values()].flatMap((records) => records.map((f) => f.metric)),
);

export const FEATURE_INITIAL_COUNTERS = Object.freeze(
  Object.fromEntries(
    FEATURE_METRICS.filter(({ initial }) => initial !== undefined).map(({ name, initial }) => [name, initial]),
  ),
);

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

// Most metrics start when a feature meets the car. A boolean World option can report for the whole drive.
export function featureMetricEnabled(world, { key, property, seen, metric }) {
  return metric.reportWhenEnabled ? world[property ?? key] === true : !!world[seen];
}

export function featureMetrics(world, violations, slot) {
  const out = {};
  for (const feature of METRIC_RECORDS.get(slot) || []) {
    if (!featureMetricEnabled(world, feature)) continue;
    const { name, decimals } = feature.metric;
    const value = Object.hasOwn(violations, name) ? (violations[name] ?? 0) : 0;
    if (!Number.isFinite(value) || value < 0) out[name] = null;
    else if (decimals === undefined) out[name] = value;
    else {
      const scale = 10 ** decimals;
      const scaled = value * scale;
      out[name] = Number.isFinite(scaled) ? Math.round(scaled) / scale : value;
    }
  }
  return out;
}

// The failure texts of the features at `slot`, for a drive's metrics `m`.
export const featureFailures = (m, slot) =>
  (METRIC_RECORDS.get(slot) || [])
    .filter(
      ({ metric: { name, threshold = 0 } }) =>
        Object.hasOwn(m, name) && Number.isFinite(m[name]) && m[name] > threshold,
    )
    .map((f) => f.metric.failure);

// The LLM system prompt's lines at `slot`, each with its newline.
export const promptLines = (slot) =>
  recordsAt("prompt", slot)
    .map((f) => (f.prompt.inline ? f.prompt.text : `${f.prompt.text}\n`))
    .join("");

// Whether a registered feature that is on reads the day of the year from the World's clock.
const DAY = FEATURES.filter((f) => f.day);
const UTC_OFFSET = FEATURES.filter((f) => f.utcOffset);
const WEEKDAY = FEATURES.filter((f) => f.weekday);
function enabled(world, f) {
  const state = world[f.property ?? f.key];
  return state === true || (state?.enabled ?? state?.count > 0);
}
export const featureNeedsWeekday = (world) => WEEKDAY.some((f) => enabled(world, f));
export const featureNeedsDay = (world) => DAY.some((f) => enabled(world, f));
export const featureNeedsUtcOffset = (world) => UTC_OFFSET.some((f) => enabled(world, f));

// Supply default decision fields to built-in drivers.
const DECISION_FIELDS = hooks("decisionFields");
export function featureDecisionFields(snap) {
  const fields = {};
  for (const decide of DECISION_FIELDS) Object.assign(fields, decide(snap));
  return fields;
}

// Every World option a registered feature takes.
export const FEATURE_OPTIONS = Object.freeze(FEATURES.filter((f) => !f.buildFleet).map((f) => f.key));
export const FLEET_FEATURES = Object.freeze(FEATURES.filter((f) => f.buildFleet));
const FEATURES_BY_POSITION = new Map(
  [undefined, "early", "afterSpawn"].map((position) => [position, FEATURES.filter((f) => f.buildAt === position)]),
);

export function buildFeatures(world, options, seed, map, position) {
  const records = FEATURES_BY_POSITION.get(position);
  if (!records) throw new Error(`Feature registry: unknown build position "${position}".`);
  for (const f of records) {
    const value = Object.hasOwn(options, f.key) ? options[f.key] : undefined;
    const enabled = value ?? (f.defaultCount === undefined ? false : 0);
    world[f.property ?? f.key] = f.build(world, { enabled, seed, map });
    if (f.seen) world[f.seen] = false;
    if (f.calls) world[f.calls] = new Map();
  }
}

// Default snapshot fields that older readers expect even when the feature is inactive.
export const FEATURE_SNAPSHOT_FIELDS = Object.freeze(Object.assign({}, ...FEATURES.map((f) => f.snapshot)));

// (the records have loaded: fill the lists handed out before)
const hookState = hookLists();
for (const [out, name, slot] of hookState.pending) fillHooks(out, name, slot);
hookState.pending.length = 0;
hookState.ready = true;
setSignalPhaseResolver(specialSignalPhase);
