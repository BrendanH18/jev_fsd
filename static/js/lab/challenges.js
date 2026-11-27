// The drive lab's challenges, in the order the lab lists them. Each is a module of its own,
// lab/challenges/<id>.js: its definition (`challenge`), the drive it sets up (`scenario`), what it
// places in the world (`install`) and what it does as the drive goes on (`step`); what they share is in
// lab/challenges/shared/kit.js. Adding one means writing its module and listing it here.
// Road tests (lab/road-tests.js) open and play the same way, but are not listed.
// Compound drives (ROADMAP 9.3) are modules here too, listed apart in `COMPOUND_DRIVES`: longer drives
// that string several situations together. They stay out of `CHALLENGES`, so the arena's challenge set,
// its saved runs and suite v1 are as they were.
import { ROAD_TESTS, roadTestScenario, installRoadTest } from "./road-tests.js";
import { finishInstall, installBase, laneScenario, stepAuthored } from "./challenges/shared/kit.js";
import * as doorZone from "./challenges/door-zone.js";
import * as fogJunction from "./challenges/fog-junction.js";
import * as rainCrossing from "./challenges/rain-crossing.js";
import * as snowStop from "./challenges/snow-stop.js";
import * as curbMerge from "./challenges/curb-merge.js";
import * as blindCrossing from "./challenges/blind-crossing.js";
import * as unprotectedLeft from "./challenges/unprotected-left.js";
import * as rightOnRed from "./challenges/right-on-red.js";
import * as fourWayStop from "./challenges/four-way-stop.js";
import * as blindCorner from "./challenges/blind-corner.js";
import * as rightHook from "./challenges/right-hook.js";
import * as lightsAndSirens from "./challenges/lights-and-sirens.js";
import * as busPullingOut from "./challenges/bus-pulling-out.js";
import * as multipleThreat from "./challenges/multiple-threat.js";
import * as schoolBus from "./challenges/school-bus.js";
import * as schoolZone from "./challenges/school-zone.js";
import * as moveOver from "./challenges/move-over.js";
import * as streetcar from "./challenges/streetcar.js";
import * as levelCrossing from "./challenges/level-crossing.js";
import * as junctionBox from "./challenges/junction-box.js";
import * as leftArrow from "./challenges/left-arrow.js";
import * as flagger from "./challenges/flagger.js";
import * as afterMidnight from "./challenges/after-midnight.js";
import * as lightsOut from "./challenges/lights-out.js";
import * as doubleParked from "./challenges/double-parked.js";
import * as parallelPark from "./challenges/parallel-park.js";
import * as stepOut from "./challenges/step-out.js";
import * as blindLeft from "./challenges/blind-left.js";
import * as snowPlow from "./challenges/snow-plow.js";
import * as zipper from "./challenges/zipper.js";
import * as cyclistPass from "./challenges/cyclist-pass.js";
import * as speedHumps from "./challenges/speed-humps.js";
import * as scramble from "./challenges/scramble.js";
import * as collection from "./challenges/collection.js";
import * as crossingGuard from "./challenges/crossing-guard.js";
import * as pxoFarCurb from "./challenges/pxo-far-curb.js";
import * as busLanes from "./challenges/bus-lanes.js";
import * as noLeftTurn from "./challenges/no-left-turn.js";
import * as contraflow from "./challenges/contraflow.js";
import * as dipYourLights from "./challenges/dip-your-lights.js";
import * as leftOnRed from "./challenges/left-on-red.js";
import * as roundaboutGap from "./challenges/roundabout-gap.js";
import * as waitForGreen from "./challenges/wait-for-green.js";
import * as amberStop from "./challenges/amber-stop.js";
import * as amberClear from "./challenges/amber-clear.js";
import * as brakesAhead from "./challenges/brakes-ahead.js";
import * as makeRoom from "./challenges/make-room.js";
import * as freshGreen from "./challenges/fresh-green.js";
import * as intoTheSun from "./challenges/into-the-sun.js";
import * as reverseLights from "./challenges/reverse-lights.js";
import * as potholeSeason from "./challenges/pothole-season.js";
import * as chasingTheBall from "./challenges/chasing-the-ball.js";
import * as gooseCrossing from "./challenges/goose-crossing.js";
import * as onYourBumper from "./challenges/on-your-bumper.js";
import * as bridgesFreezeFirst from "./challenges/bridges-freeze-first.js";
import * as oneCarAtATime from "./challenges/one-car-at-a-time.js";
import * as dontSplash from "./challenges/dont-splash.js";
import * as roomToPark from "./challenges/room-to-park.js";
import * as roadClosed from "./challenges/road-closed.js";
import * as followTheOfficer from "./challenges/follow-the-officer.js";
import * as rushHour from "./challenges/rush-hour.js";

const MODULES = [
  doorZone,
  fogJunction,
  rainCrossing,
  snowStop,
  curbMerge,
  blindCrossing,
  unprotectedLeft,
  rightOnRed,
  fourWayStop,
  blindCorner,
  rightHook,
  lightsAndSirens,
  busPullingOut,
  multipleThreat,
  schoolBus,
  schoolZone,
  moveOver,
  streetcar,
  levelCrossing,
  junctionBox,
  leftArrow,
  flagger,
  afterMidnight,
  lightsOut,
  doubleParked,
  parallelPark,
  stepOut,
  blindLeft,
  snowPlow,
  zipper,
  cyclistPass,
  speedHumps,
  scramble,
  collection,
  crossingGuard,
  pxoFarCurb,
  busLanes,
  noLeftTurn,
  contraflow,
  dipYourLights,
  leftOnRed,
  roundaboutGap,
  waitForGreen,
  amberStop,
  amberClear,
  brakesAhead,
  makeRoom,
  freshGreen,
  intoTheSun,
  reverseLights,
  potholeSeason,
  chasingTheBall,
  gooseCrossing,
  onYourBumper,
  bridgesFreezeFirst,
  oneCarAtATime,
  dontSplash,
  roomToPark,
  roadClosed,
  followTheOfficer,
];

const COMPOUND_MODULES = [rushHour];

export const CHALLENGE_VERSION = 2;
export const CHALLENGES = MODULES.map((m) => m.challenge);
export const COMPOUND_DRIVES = COMPOUND_MODULES.map((m) => m.challenge);
// (road tests, lab/road-tests.js, and compound drives open and play the same way)
export const challengeById = (id) =>
  CHALLENGES.find((c) => c.id === id) ||
  ROAD_TESTS.find((t) => t.id === id) ||
  COMPOUND_DRIVES.find((c) => c.id === id) ||
  null;

// The module that sets up a challenge (or its `world.challenge` state): its own, by id, unless its
// hazard has been changed, as a test does to drive one without it; then the first with that hazard;
// else none, and the drive starts on a plain lane with nothing placed.
const ALL_MODULES = [...MODULES, ...COMPOUND_MODULES];
const byId = new Map(ALL_MODULES.map((m) => [m.challenge.id, m]));
function moduleFor({ id, hazard }) {
  const own = byId.get(id);
  if (own && own.challenge.hazard === hazard) return own;
  return ALL_MODULES.find((m) => m.challenge.hazard === hazard) || null;
}

export function challengeScenario(map, challenge) {
  if (challenge.roadTest) return roadTestScenario(map, challenge);
  const m = moduleFor(challenge);
  return m ? m.scenario(map, challenge) : laneScenario(map, challenge);
}

export function installChallenge(world, fleet, challenge, scenario) {
  const at = installBase(world, challenge, scenario);
  if (scenario.roadTest) installRoadTest(world, fleet, challenge, scenario);
  moduleFor(challenge)?.install?.(world, fleet, challenge, scenario, at);
  finishInstall(world, fleet);
}

export function stepChallenge(world, fleet) {
  const state = world.challenge;
  if (!state) return;
  const step = moduleFor(state)?.step;
  if (step) step(world, fleet);
  else stepAuthored(world, fleet);
}

export { challengeConfig } from "./challenge-config.js";
