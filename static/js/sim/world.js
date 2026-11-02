// The simulation world: map, ego car, traffic, signals, time, and honest counters.

import { Vehicle, CAR } from "./vehicle.js";
import { headingAt, projectPoint } from "../map/mapdata.js";
import { approachPhase, movementSignal, phaseOf, StopMemory } from "./signals.js";
import { obbOverlap } from "./collision.js";
import { ringBusy } from "./roundabout.js";
import { ParkedCars, PARKED_DENSITY } from "./parking.js";
import { Crowd, PEDESTRIANS } from "./pedestrians.js";
import { Visibility } from "./visibility.js";
import { setWeather } from "./weather.js";
import { StaticObstacles, poseOf } from "./static-obstacles.js";
import { AllWayStops } from "./all-way.js";
import { approachTo, outranks, PEEK_AT_M } from "./priority.js";
import { emergencyCall, holdsUp, isEmergency, isJunction, leadsEmergency } from "./emergency.js";
import { BUS_YIELD_GAP_M, busHasRightOfWay, busRelation, busZones, isBus } from "./bus.js";
import { canStopShort, frontTo, hiddenByTraffic, looked, noteStop, stoppedAt } from "./crosswalk.js";
import { BEHIND_M, ONCOMING_M, SIDE_M, canStopFor as canStopForSchool, redsOn, schoolBusRelation } from "./school-bus.js";
import { zoneLimit } from "./speed-zones.js";
import { HOLD_M as STREETCAR_HOLD_M, STOP_M as STREETCAR_STOP_M, IN_LANE_M, SIDE_M as STREETCAR_SIDE_M, canStopFor as canStopForStreetcar, doorsOpen, streetcarRelation } from "./streetcar.js";
import { RoadsideStops } from "./roadside.js";
import { HEAR_M, canStopFor as canStopForTrain, crossingAheadOf, fouling, railIndex, trainAt } from "./rail.js";
import { boxBlocker, routeBoxAhead } from "./junction-box.js";
import { SPAN_M as WZ_SPAN_M, WorkZones, canStopFor as canStopForFlagger, marksOn, paddle, stopKey } from "./work-zone.js";
import { DoubleParked } from "./double-parked.js";
import { NEXT_LANE_M, SAME_LANE_M, isPlow, plowRelation, stayBack, turningLeft } from "./snow-plow.js";
import { EGO_ID, LET_IN_DECEL, OWED_DECEL as LC_OWED_DECEL, LaneClosures, THROUGH_M, canStop as canStopForMerge } from "./lane-closure.js";
import { Outages, controlAt } from "./outage.js";
import { leftSpace, reversing, tyres } from "./parallel-park.js";
import { StepOuts, standingNear } from "./hidden-hazards.js";
import { hideable, hiddenVehicle } from "./hidden-traffic.js";
import { egoPassing, minPassM } from "./cyclist-pass.js";

const AUDIT_ROUTE_CORRIDOR_M = 4;
const AUDIT_ROUTE_HEADING_RAD = Math.PI / 3;
// Past a signal's line, the car fails to yield when its front bumper enters the path of an
// oncoming vehicle (seen or not) due at the junction's centre within this many seconds. The path
// is the one the vehicle is actually following, so only a left turn or a U-turn takes the car into
// it and the check needs no route: a free drive is audited too. It runs until the front is this
// far from the junction's centre.
const AUDIT_ONCOMING_S = 2.0;
const AUDIT_JUNCTION_M = 30;
const AUDIT_PATH_M = 50;
const AUDIT_CORNER_M = 8;   // a turn's rounded corner starts about this far before the node it turns at   // how far along an oncoming vehicle's path the car's front is looked for
// As in sensing (brain/sensors.js): an oncoming vehicle heads within 60 deg of straight at the car's
// approach and comes toward the junction, or is within 12 m of its centre turning (up to 105 deg),
// in which case it is already there.
const AUDIT_BOX_M = 12;
// Crossing a red light's line after a full stop on a map that allows right turns on red is legal
// if the car turns right, judged from the street it is on, as routes judge their turns
// (MapData.classifyTurn from the approach): once its front is this far past the junction's centre
// on another street, or on leaving the junction. A lane change or a swerve on the way straight
// through does not count. A right turn on
// red fails to yield, as above, when the car's front enters the path of a vehicle coming from its
// left (heading within 60 deg of the way the car turns) due at the junction within 2 s, or that
// would reach the car within 2 s along the street both are in.
const AUDIT_RTOR_OUT_M = 15;
// Which way a car that crossed the line on a left arrow went is judged on its way out of the junction,
// this far from its centre.
const AUDIT_ARROW_OUT_M = 15;
// A junction without a sign stops being the control the audit follows this far past its line
// (after the tick that sees the car cross it).
const PASSED_M = 1;
// Giving way at a two-way stop or a junction without a sign or signal (sim/priority.js): past its
// line, the car fails to yield when its front bumper enters the path of a vehicle with the right of
// way over its street (seen or not) that is due at the junction's centre within 2 s or already in
// the junction, having come in on such a street, and was on its way there (or in it) when the car
// crossed the line. As above, a vehicle heading the same way along
// its path counts only if it would reach the car within those 2 s. It runs until the front is 30 m
// from the junction's centre.
// Turning across a cyclist on the car's right (a right hook) fails to yield too: the car's front
// bumper enters the path of a cyclist (seen or not) due there within 2 s, heading at least 20 deg to
// the right of it there, where within the last 3 s the cyclist rode the car's way on its right,
// clear of its line (beside it, or up to 30 m behind). A cyclist counts again only after 10 s.
const AUDIT_HOOK_MEMORY_S = 3;
const AUDIT_HOOK_TURN = Math.PI / 9;
const AUDIT_HOOK_AGAIN_S = 10;
// Giving way to an emergency vehicle (sim/emergency.js), seen or not, once it calls on the car: the
// car fails to yield if, from 2 s after the call came, it is faster than 3 m/s and has not slowed by
// at least 1 m/s^2 since then (unless, pulled over, it was told to drive on ahead of a vehicle stuck
// behind it);
// if its front enters a junction (8 m of its centre) that a vehicle coming from the side is due
// across, 3 s or more after the call came; if, 4 s or more after the call came, the vehicle draws
// level with it along its street (within 8 m to the side) while it is not pulled over and not in a
// junction; or if the vehicle has been stuck behind it for 6 s while
// it is not pulled over (at least 0.2 m right of its lane's centre) and has not been told to drive on
// ahead of it. Counted once a vehicle.
const AUDIT_EV_MOVING_MPS = 3;
const AUDIT_EV_DECEL = 1;
const AUDIT_EV_REACT_S = 2;
const AUDIT_EV_JUNCTION_S = 3;
const AUDIT_EV_BOX_M = 8;
const AUDIT_EV_BLOCK_S = 6;
const AUDIT_EV_PULLED_M = 0.2;
const AUDIT_EV_PULL_S = 4;
const AUDIT_EV_SIDE_M = 8;
// Yielding to a bus pulling out from its stop (sim/bus.js, BC MVA s. 169.1): once the car, in the
// lane the bus pulls out into and behind it, first sees it signalling to (where the limit is 60 km/h
// or less), it owes it the right of way if it could stop 2 m behind it braking at up to 3.5 m/s^2 then.
// The car fails to yield if, owing it, it draws level with the bus (its front past the bus's rear) at
// more than 1 m/s before the bus has pulled out. Counted once each time a bus pulls out.
const AUDIT_BUS_DECEL = 3.5;
const AUDIT_BUS_MOVING_MPS = 1;
// Passing a vehicle stopped at a marked crosswalk (sim/crosswalk.js, BC MVA s. 179(3)): once the car,
// behind it in another lane going its way, first sees it stopped there, it owes it if it could stop
// with its front 3.5 m short of the crosswalk's centre braking at up to 3.5 m/s^2 then. It fails to
// yield if, owing it, its front crosses the crosswalk's centre at more than 1 m/s while the vehicle is
// still stopped there, without having stood still at the crosswalk for 2 s first. Counted once a
// vehicle and crosswalk.
const AUDIT_CROSSWALK_MOVING_MPS = 1;
// Stopping for a school bus with its reds flashing (sim/school-bus.js, BC MVA s. 149): once the car,
// coming up behind it or toward it along its street (its near end, the rear or the front, within 9 m
// of the line the car heads along), first sees the reds on, it owes the stop if it could then stop
// short of it (5 m behind its rear, or 10 m short of its front coming toward it) braking at up to
// 3.5 m/s^2. It fails to yield if, owing it, its front draws level with that end of the bus at more
// than 1 m/s while the reds are still on. Counted once a stop.
const AUDIT_SCHOOL_MOVING_MPS = 1;
// Not passing a streetcar with its doors open (sim/streetcar.js, Ontario HTA s. 166): once the car,
// going its way behind it in its lane or in the lane beside it on the side its riders use, first sees
// its doors open, it owes the stop if it could then stop where drivers do (4 m behind its rear doors,
// or 4 m behind it in its lane) braking at up to 3.5 m/s^2. It fails to yield if, owing it, its front
// comes within 2 m of the rear doors (of the streetcar, in its lane) at more than 1 m/s while they are
// still open. Counted once a stop.
const AUDIT_STREETCAR_MOVING_MPS = 1;
// Stopping for a train at a level crossing (sim/rail.js, Alberta AR 304/2002 s. 42): once the car,
// heading across the crossing, first hears the train coming (its gong, within 250 m) or sees it, it
// owes the stop if it could then stop where drivers do (7 m back from the nearest rail) braking at up
// to 3.5 m/s^2. It fails to yield if, owing it, its front comes within 5 m of the nearest rail at more
// than 1 m/s while the train is still approaching (coming, or on the crossing), or if any of it stands
// on the tracks (in the train's envelope) slower than 1 m/s while the train is. Counted once per
// train at each crossing.
const AUDIT_TRAIN_MOVING_MPS = 1;
// Keeping the junction clear (sim/junction-box.js, Québec's Highway Safety Code): the car, following
// its route, fails to yield if it entered a signal's junction (its front past the near side of the
// street across) while traffic past it left no room for it beyond, and is then standing in it (slower than 1 m/s) while its light is
// red, blocking the cross street's green. Counted once a visit.
const AUDIT_BOX_MOVING_MPS = 1;
// Stopping for a flagger's STOP paddle (sim/work-zone.js, Ontario HTA s. 146.1): once the car, heading
// into a work zone along its street, first sees its flagger showing STOP while still short of the
// one-lane section, it owes the stop if it could then stop at the line braking at up to 3.5 m/s^2
// (standing still, it can). It misses the stop if, owing it, its front goes more than 2 m past the
// line at more than 1 m/s while the paddle still shows STOP. Counted once each time that paddle turns
// to STOP.
const AUDIT_FLAGGER_PAST_M = 2;
const AUDIT_FLAGGER_MOVING_MPS = 1;
// Going round a double-parked van (sim/double-parked.js): the car, going its street's way alongside
// the way round (its front between where that starts and ends) and across the centre line (its
// centre left of it), fails to yield if it meets a vehicle coming the other way on the street ahead
// of it, on its side of the street or within AUDIT_MEET_SIDE_M of the centre line, closer than
// AUDIT_MEET_M front to front or AUDIT_MEET_S at the speed they close at. Counted once a pass.
const AUDIT_MEET_M = 8;
const AUDIT_MEET_S = 2;
const AUDIT_MEET_SIDE_M = 1;
// Snow plows (sim/snow-plow.js): the car passes one when its centre draws level with the plow's,
// going its way in the lane beside it. On its right (the plow not turning left), that is passing it on
// the right, counted once a pass. Having passed one on the left, moving back into its lane with its
// rear less than the stay-back distance, less AUDIT_CUT_SLACK_M, ahead of the plow's front is cutting
// in front of it (an event for coaching, once a pass).
const AUDIT_PLOW_M = 40;
const AUDIT_CUT_SLACK_M = 3;
// Lane closures (sim/lane-closure.js). In the closed lane, the car owes its wait at the merge point once,
// at the merge (the nearest in its lane to it), it could stop there braking at up to 3.5 m/s^2 and has not
// been let in; going through the merge point owing it is merging out of turn, forcing in (counted once a
// visit, with the vehicle in the open lane nearest it). Moving across from the closed lane into the open
// one more than AUDIT_EARLY_M short of the merge point is merging early; and in the open lane, going
// AUDIT_LET_IN_PAST_M past where it would let someone in, at more than 1 m/s, once it owed that (it could
// stop there braking at 2.5 m/s^2), is taking another's turn. Both are events for coaching, once a visit.
const AUDIT_EARLY_M = 5;
const AUDIT_LET_IN_PAST_M = 2;
const AUDIT_MERGE_MOVING_MPS = 1;
// Passing cyclists (sim/cyclist-pass.js), with `passCyclists` on. A pass is the car's body going from
// wholly behind a cyclist going its way (within 30 m) to wholly ahead of it; it is a close pass when,
// beside it, the gap between their bodies was ever less than the minimum passing distance on the
// street (1 m up to 50 km/h, 1.5 m above) less AUDIT_PASS_SLACK_M. And, passing one with its centre left
// of the centre line, the car fails to yield as round a double-parked van (AUDIT_MEET_M): once a pass.
const AUDIT_PASS_SLACK_M = 0.1;
const AUDIT_PASS_NEAR_M = 30;

export class World {
  // `buses`: buses run (sim/bus.js), so nobody parks in their bus zones. `roadside`: how many
  // vehicles stand at the roadside with their lights flashing at a time (sim/roadside.js).
  // `workZones`: how many work zones with a flagger stand at a time (sim/work-zone.js). `outages`: how
  // many signals at a time have their lights out (sim/outage.js). `vans`: how many delivery vans
  // stand double-parked at a time (sim/double-parked.js). `park`: the autopilot parks at the
  // destination (sim/parallel-park.js). `hazards`: vehicles standing at the kerb hide people, and the
  // driven car keeps to a speed it can stop from beside them; `stepOuts`: with that, how many people at
  // a time wait hidden between parked cars ahead of it to step out (sim/hidden-hazards.js). With
  // `hazards`, road vehicles also hide other vehicles and cyclists, and the car turns left, gives way
  // and turns right on red only once it can see the lanes it must give way to (sim/hidden-traffic.js).
  // `closures`: how many lane closures with a zipper merge stand at a time (sim/lane-closure.js).
  // `passCyclists`: on two-way streets with one lane each way, traffic and the driven car pass a cyclist
  // riding in the lane through the oncoming lane, with the minimum passing distance (sim/cyclist-pass.js).
  constructor(map, { seed = 1, parked = PARKED_DENSITY, pedestrians = PEDESTRIANS, weather = "dry", vehicleSpec = CAR, buses = false, roadside = 0, workZones = 0, outages = 0, vans = 0, park = false, hazards = false, stepOuts = 0, closures = 0, passCyclists = false } = {}) {
    this.map = map;
    this.seed = seed;
    this.visibility = new Visibility(map);
    this.staticObstacles = new StaticObstacles(map);
    this.staticContacts = new Map();
    this.weather = setWeather(weather).name;
    this.parked = new ParkedCars(map, { seed, density: parked, zones: buses ? busZones(map) : null });
    this.t = 0;
    this.tick = 0;
    this.ego = new Vehicle(0, 0, 0, 0, vehicleSpec);
    this.npcs = [];
    this.route = null;
    this.destination = null;
    this.paused = false;
    this.egoStop = new StopMemory();
    this.allWay = new AllWayStops(map);
    this.allWayCounted = null;   // the all-way stop it went out of turn at (counted once a visit)
    this.giveWay = null;         // the junction it last crossed a line into, giving way there
    this.egoPeek = null;         // the control it has stopped at to look past a building, giving way
    this.egoPeekAt = 0;          // (since when)
    this.turnaround = null;      // the three-point turn the car is making (sim/turnaround.js)
    this.besideRight = new Map(); // cyclist id -> when it last rode on the car's right, going its way
    this.hookCounted = new Map(); // cyclist id -> when cutting across it was last counted
    this.evCalls = new Map();     // emergency vehicle id -> { since, v0, lead }: since it called on the car
    this.evCounted = new Set();   // emergency vehicles a failure to yield was counted for
    this.evJunction = null;       // the junction the car's front is in, while one is about
    this.busCalls = new Map();    // "<bus id>:<departure>" -> { owed, counted }: a bus pulling out ahead
    this.crosswalkCalls = new Map(); // "<crosswalk id>:<vehicle id>" -> { owed, counted }: one stopped at it
    this.crosswalkStop = null;    // the marked crosswalk the car has stood still at (sim/crosswalk.js)
    this.schoolCalls = new Map(); // "<school bus id>:<stop>" -> { owed, counted }: one with its reds on
    this.streetcarCalls = new Map(); // "<streetcar id>:<departure>" -> { owed, counted }: one with its doors open
    this.trainCalls = new Map();  // "<crossing id>:<train id>:<departure>" -> { owed, counted }: one approaching it
    this.onTracks = null;         // the level crossing the car is standing on the tracks of, and since when
    this.inBox = null;            // the signal's junction the car is in, whether it had room past it, and since when
    this.flaggerCalls = new Map(); // "<work zone id>:<paddle change>" -> { owed, counted }: a flagger showing STOP
    this.vanPass = null;          // the double-parked van the car is going round, and whether it failed to yield then
    // parking at the destination (sim/parallel-park.js): whether the autopilot does, the space it is
    // going for (`park`), the manoeuvre (`parking`), how far traffic behind keeps back (`parkHold`), the
    // spaces it gave up, the space it is parked in, and the kerb strikes the audit counted
    this.parkAtGoal = !!park;
    this.park = null;
    this.parking = null;
    this.parkHold = 0;
    this.parkTried = [];
    this.parkedIn = null;
    this.kerbContact = false;
    this.hazards = !!hazards;
    // passing cyclists through the oncoming lane (sim/cyclist-pass.js): whether anyone does; the
    // cyclists the car has come up behind, and how close it has been beside each since; and the one it
    // is passing now, and whether it failed to yield to oncoming traffic then
    this.passCyclists = !!passCyclists;
    this.bikePasses = new Map();
    this.cyclistPass = null;
    // the time of day school and playground zones go by (sim/speed-zones.js): { hour, sun_deg }, or
    // null, when no zone is in effect (the seeded benchmark)
    this.clock = null;
    this.violations = { collisions: 0, collisions_at_fault: 0, red_lights_run: 0, stop_signs_run: 0, failed_to_yield: 0, off_road_s: 0, safety_brakes: 0, fallbacks: 0, deadlock_overrides: 0, plow_right_passes: 0 };
    this.plowPass = new Map();     // snow plow id -> where the car was beside it last tick, and what it has counted this pass
    this.plowsSeen = false;        // whether a snow plow has worked the streets this drive (sim/snow-plow.js)
    this.mergeCall = null;         // the lane closure the car is at, and what it owes and has counted there
    this.closuresSeen = false;     // whether a lane closure has stood this drive (sim/lane-closure.js)
    this.events = [];  // transient per-step events for the UI
    this.lastRoad = null;
    this.lastSignal = null;
    this.arrowCheck = null;       // the left arrow the car crossed the line on: which way did it go?
    this.spawnEgo();
    this.roadside = new RoadsideStops(this, { count: roadside, seed });
    this.workZones = new WorkZones(this, { count: workZones, seed });
    this.laneClosures = new LaneClosures(this, { count: closures, seed });
    this.outages = new Outages(this, { count: outages, seed });
    this.doubleParked = new DoubleParked(this, { count: vans, seed });
    this.crowd = new Crowd(this, { seed, count: pedestrians });
    this.stepOuts = new StepOuts(this, { count: this.hazards ? stepOuts : 0, seed });
  }

  // Dynamic/roadside objects near (x, y). Buildings use a separate footprint index so traffic
  // controllers do not mistake a large building's center for a vehicle in their lane.
  obstaclesNear(x, y, r) {
    // (a vehicle by its reference point, its rear axle: a long one's front is up to its length away)
    const out = this.npcs.filter((n) => { const m = r + Math.max(5, n.spec?.length || 0); return Math.abs(n.x - x) < m && Math.abs(n.y - y) < m; });
    return out.concat(this.parked.near(x, y, r), this.parked.doorsNear(x, y, r), this.crowd.near(x, y, r));
  }

  visibleObstaclesNear(x, y, r, observer = this.ego) {
    return this.obstaclesNear(x, y, r).filter((o) => this.sees(observer, o));
  }

  // Line of sight: buildings, weather and darkness hide anything, and a vehicle in traffic hides a
  // pedestrian behind it (sim/crosswalk.js); with hidden hazards on, so does one standing at the kerb
  // (sim/hidden-hazards.js), and road vehicles hide other vehicles and cyclists (sim/hidden-traffic.js).
  // (with hidden traffic: a vehicle or cyclist the car would see but for another vehicle's body)
  hiddenByVehicle(o, observer = this.ego) {
    return this.hazards && hideable(o) && this.visibility.sees(observer, o) && hiddenVehicle(this, observer, o);
  }

  // (`reach`: looking further along a street by clear daylight, see sim/visibility.js PASS_SIGHT_M)
  sees(observer, o, reach = 0) {
    if (!this.visibility.sees(observer, o, reach)) return false;
    if (o.kind === "pedestrian") return !hiddenByTraffic(observer, o, this.npcs, this.hazards ? standingNear(this, observer, o) : []);
    return !(this.hazards && hideable(o) && hiddenVehicle(this, observer, o, reach));
  }

  // Middle of a long residential edge near the map center, facing along it.
  spawnEgo() {
    const [x0, y0, x1, y1] = this.map.extent;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, span = Math.min(x1 - x0, y1 - y0) / 2;
    let best = null;
    for (const e of this.map.edges.values()) {
      const mid = e.pts[Math.floor(e.pts.length / 2)];
      const inside = mid[0] > x0 && mid[0] < x1 && mid[1] > y0 && mid[1] < y1;
      if (!inside) continue;
      const centrality = 1 - Math.min(1, Math.hypot(mid[0] - cx, mid[1] - cy) / span);
      const score = Math.min(e.length, 200) * (e.cls === "residential" ? 1.2 : 1) * (e.control ? 0.8 : 1) * (0.4 + centrality);
      if (!best || score > best.score) best = { e, score };
    }
    const lane = this.map.lane(best.e.id, best.e.lanes - 1);
    this.placeOnLane(lane, lane.length / 2);
  }

  placeOnLane(lane, s) {
    const { pointAt, headingAt } = lanePoint(lane, s);
    this.ego.x = pointAt[0]; this.ego.y = pointAt[1]; this.ego.psi = headingAt; this.ego.v = 0; this.ego.delta = 0; this.ego.a = 0;
    this.egoStop.reset();
    this.allWay.forget(this.ego);
    this.resetContactHistory();
  }

  resetToLane() {
    const near = this.map.nearestLane(this.ego.x, this.ego.y, this.ego.psi, 80);
    if (near) {
      this.ego.x = near.point[0]; this.ego.y = near.point[1]; this.ego.psi = near.heading; this.ego.v = 0; this.ego.delta = 0; this.ego.a = 0;
      this.resetContactHistory();
    }
    this.events.push({ type: "reset" });
  }

  phase(intersectionId) { return phaseOf(this.map.intersections.get(intersectionId), this.t); }
  // The light for one movement through a signal: from the approach `edgeId`, turning `turn`
  // (sim/signals.js: under a left arrow only a left turn has a green), or "dark" while its lights are
  // out (sim/outage.js).
  light(intersectionId, edgeId, turn = "straight") {
    if (this.outages?.isDark(intersectionId)) return "dark";
    const inter = this.map.intersections.get(intersectionId);
    if (!inter?.plan?.advance) return this.phase(intersectionId)[this.map.edges.get(edgeId)?.control?.group];
    return movementSignal(approachPhase(inter, edgeId, this.t), turn);
  }

  resetContactHistory() {
    this.ego.vy = 0; this.ego.r = 0; this.ego.ax = 0; this.ego.latAccel = 0;
    this._previousStaticPose = poseOf(this.ego);
    this.staticContacts.clear();
    this._lastFront = null;
    this.lastRoad = null;
    this.lastSignal = null;
    this.arrowCheck = null;
    this.giveWay = null;
    this.egoPeek = null;
    this.turnaround = null;
    this.allWayCounted = null;
    this.besideRight.clear();
    this.hookCounted.clear();
    this.evCalls.clear();
    this.evJunction = null;
    this.busCalls.clear();
    this.schoolCalls.clear();
    this.streetcarCalls.clear();
    this.streetcarYields?.clear();
    this.trainCalls.clear();
    this.trainYields?.clear();
    this.onTracks = null;
    this.inBox = null;
    this.flaggerCalls.clear();
    this.flaggerYields?.clear();
    this.vanPass = null;
    this.plowPass.clear();
    this.mergeCall = null; this.mergeWait = null; this.mergeLetIn = null;
    this.bikePasses?.clear(); this.cyclistPass = null;
    // (moved by hand: whatever space it was going for, or parked in, is let go)
    for (const p of [this.park, this.parkedIn]) for (const slot of p?.slots || []) if (slot.reserved === this.ego) slot.reserved = null;
    this.park = null; this.parking = null; this.parkHold = 0; this.parkedIn = null; this.kerbContact = false;
    this.schoolYields?.clear();
    this.crosswalkCalls.clear();
    this.crosswalkYields?.clear();
    this.crosswalkStop = null;
    this._cwFront = null;
  }

  auditStatic(dt) {
    const hit = this.staticObstacles.sweep(this._previousStaticPose || poseOf(this.ego), poseOf(this.ego), this.ego.spec);
    if (hit) {
      const { obstacle, safePose } = hit;
      if (!this.staticContacts.has(obstacle.id)) {
        this.violations.collisions++;
        this.violations.collisions_at_fault++;
        this.events.push({ type: "collision", with: obstacle.id, kind: obstacle.kind, fault: "ego", at_fault: true,
          t: Math.round(this.t * 10) / 10, ego_v: Math.round(this.ego.v * 10) / 10, other_v: 0 });
      }
      this.staticContacts.set(obstacle.id, 0);
      Object.assign(this.ego, safePose, { v: 0, a: 0, vy: 0, r: 0, ax: 0, latAccel: 0 });
    }
    // Keep a small contact skin after resolving the wall; throttle against it remains one
    // incident. A full second physically clear of that footprint permits another incident.
    const near = new Set(this.staticContacts.size ? this.staticObstacles.overlaps(this.ego.obb(), 0.1).map((o) => o.id) : []);
    for (const [id, clearFor] of this.staticContacts) {
      if (near.has(id) || hit?.obstacle.id === id) this.staticContacts.set(id, 0);
      else if (clearFor + dt > 1) this.staticContacts.delete(id);
      else this.staticContacts.set(id, clearFor + dt);
    }
    this._previousStaticPose = poseOf(this.ego);
    return !!hit;
  }

  setClock(clock) { this.clock = clock ? { hour: clock.hour, sun_deg: clock.sun_deg } : null; }

  // Where the ego is relative to the road network (cached per tick). `limit` is the street's, or a
  // school or playground zone's while it is in effect there (`zone`).
  roadInfo() {
    const rd = this.map.roadDistance(this.ego.x, this.ego.y);
    const near = this.map.nearestLane(this.ego.x, this.ego.y, this.ego.psi, 40);
    const span = near ? this.map.zoneOnLane(near.lane, near.s, this.clock) : null;
    return {
      on_road: rd.distance < 1.0,
      distance_to_road: rd.distance,
      edge: near ? near.lane.edgeRef : rd.edge,
      lane: near ? near.lane : null,
      s: near ? near.s : 0,
      lateral: near ? near.lateral : 0,
      heading_error: near ? wrap(this.ego.psi - near.heading) : 0,
      name: (near ? near.lane.edgeRef : rd.edge)?.name || "",
      limit: zoneLimit((near ? near.lane.edgeRef : rd.edge)?.limit || 11.2, span),
      zone: span ? { id: span.zone.id, kind: span.zone.kind, name: span.zone.name } : null,
    };
  }

  stepManual(dt, input) {
    let accel = 0;
    if (input.throttle) accel = this.ego.spec.maxAccel;
    if (input.brake) accel = this.ego.v > 0.2 ? -6 : -1.5;  // brake, then gently reverse
    if (input.hardBrake) accel = -this.ego.spec.maxBrake;
    // Keys are binary, unlike a steering wheel. Limit their angle at speed to a comfortable
    // cornering demand, then ramp it so a tap does not ask for full lock in a fast bend.
    const maxAngle = Math.min(this.ego.spec.maxSteer, Math.atan(3.2 * this.ego.spec.wheelbase / Math.max(1, this.ego.v ** 2)));
    const desired = (Number(!!input.left) - Number(!!input.right)) * maxAngle;
    const steer = this.ego.delta + Math.max(-0.8 * dt, Math.min(0.8 * dt, desired - this.ego.delta));
    if (input.brake && this.ego.v <= 0.2 && !input.hardBrake) {
      this.ego.step(dt, { steer, accel: -1.5, reverse: true });
      return;
    }
    this.ego.step(dt, { steer, accel });
  }

  // Called every physics tick after the ego (and NPCs) moved. Collisions and violations.
  // A collision counts once per contact: the pair must separate for a second before the next
  // one counts. Fault: "ego" when the moving ego ran into a car ahead going its way or standing
  // still, or backed into something; "other" when the ego was stopped or hit from behind; "shared" for crossing and oncoming
  // contacts, where right of way decides and the sim does not judge it.
  audit(dt, road) {
    this.events.length = 0;
    if (this.auditStatic(dt)) Object.assign(road, this.roadInfo());
    const egoBox = this.ego.obb();
    for (const n of this.obstaclesNear(this.ego.x, this.ego.y, 12)) {
      const touching = obbOverlap(egoBox, n.obb());
      if (touching && !n.contact) {
        const [cx, cy] = n.center;
        const rel = this.ego.toLocal(cx, cy);
        const egoCenterAhead = rel.ahead - (this.ego.spec.length / 2 - this.ego.spec.rearOverhang);
        const relHeading = Math.abs(wrap(n.psi - this.ego.psi));
        // (reversing, the car is at fault for what it backs into)
        const backedInto = this.ego.v < -0.3 && egoCenterAhead < 0;
        const fault = backedInto ? "ego" : n.kind === "pedestrian" ? (this.ego.v < 0.5 ? "other" : "ego")
          : this.ego.v < 0.5 || egoCenterAhead < -1 ? "other"
          : egoCenterAhead > 0 && (relHeading < Math.PI / 4 || n.v < 0.5) ? "ego" : "shared";
        const atFault = fault === "ego";
        this.violations.collisions++;
        if (atFault) this.violations.collisions_at_fault++;
        this.events.push({
          type: "collision", with: n.id, kind: n.kind || "car", fault, at_fault: atFault, t: Math.round(this.t * 10) / 10,
          ego_v: Math.round(this.ego.v * 10) / 10, other_v: Math.round(n.v * 10) / 10,
          other_ahead: Math.round(egoCenterAhead * 10) / 10, other_right: Math.round(rel.right * 10) / 10,
          relative_heading_deg: Math.round(wrap(n.psi - this.ego.psi) * 180 / Math.PI),
        });
        this.ego.v = 0; this.ego.a = 0;
        n.v = 0; n.a = 0;
        n.frozen = 3;
      }
      if (touching) { n.contact = true; n.clearFor = 0; }
      else if (n.contact && (n.clearFor = (n.clearFor || 0) + dt) > 1) n.contact = false;
    }
    this.auditCrosswalks();
    noteStop(this);
    this.auditCrosswalkPass();
    if (!road.on_road) this.violations.off_road_s += dt;
    // The front bumper can reach a route's stop line while the rear axle is still on an
    // adjacent segment. Use the same upcoming route control as sensing instead of losing
    // stop memory when the closest physical lane belongs to that adjacent edge.
    const FRONT = this.ego.spec.length - this.ego.spec.rearOverhang;
    const routeProjection = this.route ? this.route.project(this.ego.x, this.ego.y) : null;
    const followsRoute = routeProjection && routeProjection.distance < AUDIT_ROUTE_CORRIDOR_M
      && Math.abs(wrap(this.ego.psi - routeProjection.heading)) < AUDIT_ROUTE_HEADING_RAD;
    const frontS = routeProjection ? routeProjection.s + FRONT : null;
    // (a junction without a sign has nothing more to check once the car has crossed its line, so
    // it does not hide a signal or a stop just beyond it)
    const rc = followsRoute ? this.route.controls.find((c) => c.sRoute + 12 >= frontS && c.sRoute - frontS <= 80
      && !(c.control.type === "uncontrolled" && frontS > c.sRoute + PASSED_M)) : null;
    // stopped where it looks from to give way (see brain/sensors.js), remembered until the car is
    // well past that junction
    const looked = followsRoute && Math.abs(this.ego.v) < 0.2 ? this.route.controls.find((c) => Number.isFinite(c.sPeek) && frontS >= c.sPeek - PEEK_AT_M && frontS <= c.sPeek + 1) : null;
    if (looked) { if (this.egoPeek !== looked.control.id) this.egoPeekAt = this.t; this.egoPeek = looked.control.id; }
    else if (!followsRoute || !this.route.controls.some((c) => c.control.id === this.egoPeek && frontS <= c.sPeek + 12)) this.egoPeek = null;
    const edge = rc ? this.map.edges.get(rc.edge) : road.edge;
    // (a signal whose lights are out is an all-way stop: sim/outage.js)
    const control = controlAt(this, rc ? rc.control : edge?.control || (edge ? this.map.priorityOf(edge.id) : null), rc ? rc.edge : edge?.id);
    if (control && (rc || road.lane)) {
      // how far the front bumper is past the line: along the route when there is one, exactly as the
      // sensors measure it (a lane polyline's length differs from the centerline's on a bend), else
      // along the lane
      const past = rc ? frontS - rc.sRoute : road.s + FRONT - control.s_line;
      const key = rc ? `${rc.edge}:${control.id}` : `${edge.id}`;
      const crossed = past >= 0;
      if (this.lastRoad && this.lastRoad.edgeId === key && !this.lastRoad.crossed && crossed) {
        if (control.type === "signal") {
          const inter = this.map.intersections.get(control.id);
          const shows = inter?.plan?.advance ? approachPhase(inter, rc ? rc.edge : edge.id, this.t) : this.phase(control.id)[control.group];
          // under a left arrow (green or turning yellow), which way it turns decides: judged once
          // it is through the junction (auditArrow)
          const arrow = shows === "arrow" || shows === "arrow_yellow";
          const state = arrow ? "green" : movementSignal(shows, "straight");
          // after a full stop, where turning right on red is allowed, which way it turns decides
          const pending = state === "red" && this.map.rightOnRed && inter && this.egoStop.controlId === control.id && this.egoStop.completed;
          if (state === "red" && !pending) { this.violations.red_lights_run++; this.events.push({ type: "red_light" }); }
          this.arrowCheck = arrow && inter ? { id: control.id, centre: [inter.x, inter.y], approach: rc ? this.route.headingAt(rc.sRoute) : this.map.headingIn(edge.id),
            stopped: this.map.rightOnRed && this.egoStop.controlId === control.id && this.egoStop.completed } : null;
          // the approach's heading and, on a route, the street it turns into (without one, the
          // street the car is heading into is the way it faces)
          if (inter) {
            const exit = rc && rc.sJunction !== null ? this.route.headingAt(Math.min(this.route.length, rc.sJunction + 15)) : null;
            const approach = rc ? this.route.headingAt(rc.sRoute) : this.map.headingIn(edge.id);
            this.lastSignal = { centre: [inter.x, inter.y], nodes: this.map.junctionNodes(inter), approaches: new Set(inter.approaches.map((a) => a.edge)), facing: approach + Math.PI, exit, counted: false,
              ...(pending ? { rightOnRed: { edge: edge.id, approach, exit: exit ?? approach - Math.PI / 2, turned: false } } : {}) };
          }
        } else if (control.type === "stop" && !this.egoStop.completed) {
          this.violations.stop_signs_run++;
          this.events.push({ type: "stop_sign", ...(control.dark ? { dark: true } : {}) });
        } else if (control.type === "yield" && ringBusy(this.map.roundabouts.get(control.roundabout), this.map.nodes.get(edge.to), this.npcs)) {
          this.violations.failed_to_yield++;
          this.events.push({ type: "failed_to_yield", to: "roundabout traffic" });
        }
        // A left turn at a stop sign, or at a junction without a sign or signal, yields to oncoming
        // traffic as at a signal, and is checked the same way.
        const turn = rc?.turn;
        const unsigned = control.type === "stop" || control.type === "uncontrolled";
        const node = unsigned && (!turn || turn === "left" || turn === "uturn") ? this.map.nodes.get(edge.to) : null;
        if (unsigned) this.lastSignal = null;
        if (node) {
          const exit = Number.isFinite(rc?.sJunction) ? this.route.headingAt(Math.min(this.route.length, rc.sJunction + 15)) : null;
          const approach = rc ? this.route.headingAt(rc.sRoute) : this.map.headingIn(edge.id);
          this.lastSignal = { centre: [node.x, node.y], nodes: new Set([edge.to]), approaches: new Set(this.map.inn.get(edge.to) || []), facing: approach + Math.PI, exit, counted: false, manualStop: !turn };
        }
        // giving way: at a two-way stop, or where its street has no sign and is not the major road
        const junction = this.map.nodes.get(edge.to);
        this.giveWay = junction && ((control.type === "stop" && !control.all_way) || (control.type === "uncontrolled" && control.rule !== "major"))
          ? { node: edge.to, centre: [junction.x, junction.y], edge: edge.id, to: control.type === "stop" || control.rule === "minor" ? "through traffic" : "traffic from the right", counted: false,
            // the traffic on its way when the car crossed its line (not a car that pulls out from
            // the curb, or turns into the street, after that: it must give way itself)
            coming: new Set(this.npcs.filter((n) => n.path?.pts && !n.pull && (approachTo(this.map, n, edge.to) || Math.hypot(n.x - junction.x, n.y - junction.y) < AUDIT_BOX_M))) } : null;
      }
      // (keyed on the stop itself: with or without a route, it is the same line)
      if (this.allWayCounted !== control.id) this.allWayCounted = null;
      this.lastRoad = { edgeId: key, crossed };
      const bumperToLine = -past;
      this.egoStop.update(control, bumperToLine, this.ego.v, dt);
      // Crossing an all-way stop's line, or leaving its queue past the line, without its turn is going
      // out of turn (whether or not the car could see who stopped first), wherever along the line it
      // made its stop; counted once per visit to the line.
      const missed = control.type === "stop" && control.all_way ? this.allWay.note(this.ego, control, edge.id, rc?.turn || this.ego.signal || "straight", bumperToLine, this.ego.v, this) : null;
      if (missed && !this.allWayCounted) {
        this.allWayCounted = control.id;
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "all-way stop", with: missed.id, ...(control.dark ? { dark: true } : {}) });
      }
    } else {
      this.lastRoad = edge ? { edgeId: edge.id, crossed: false } : null;
      this.allWayCounted = null;
      this.egoStop.update(null, 0, 0, dt);
    }
    this.auditOncoming();
    this.auditGiveWay();
    this.auditCyclists();
    this.auditEmergency(road);
    this.auditBuses();
    this.auditSchoolBuses();
    this.auditStreetcars();
    this.auditCrossings(dt);
    this.auditBox(dt, followsRoute ? frontS : null);
    this.auditArrow();
    this.auditFlaggers();
    this.auditVans();
    this.auditPlows();
    this.auditClosures();
    if (this.passCyclists) this.auditCyclistPasses(road);
    this.auditKerb();
    leftSpace(this);
  }

  // Parking or pulling out (sim/parallel-park.js), a tyre on the kerb is a kerb strike: counted once a
  // contact (a bumper reaching over it is not).
  auditKerb() {
    const law = this.parking;
    if (!law || law.phase === "done") { this.kerbContact = false; return; }
    const on = tyres(this.ego, this.ego.spec).some((p) => this.map.roadDistance(p[0], p[1]).distance > 0.02);
    if (on && !this.kerbContact) this.events.push({ type: "kerb_strike", reversing: reversing(law) });
    this.kerbContact = on;
  }

  // Going round a double-parked van into the way of oncoming traffic (see AUDIT_MEET_M).
  auditVans() {
    const vans = this.doubleParked.vans;
    if (!vans.length) { this.vanPass = null; return; }
    const ego = this.ego, FRONT = ego.spec.length - ego.spec.rearOverhang;
    // (one pass lasts while the car's front is alongside the way round, across the centre line or not)
    let passing = null;
    for (const d of vans) {
      if (Math.abs(ego.x - d.x) > 60 || Math.abs(ego.y - d.y) > 60) continue;
      const e = this.map.edges.get(d.edge), p = projectPoint(e.pts, e.cum, [ego.x, ego.y], null);
      if (!p || Math.abs(wrap(ego.psi - p.heading)) > Math.PI / 3 || p.lateral < e.asphalt[0] - 1 || p.lateral > e.asphalt[1] + 1) continue;
      const front = p.s + FRONT;
      if (front < d.detour.from || front > d.detour.to) continue;
      passing = { d, e, front, across: p.lateral < 0 };
      break;
    }
    if (!passing) { this.vanPass = null; return; }
    const { d, e, front, across } = passing;
    if (this.vanPass?.id !== d.id) this.vanPass = { id: d.id, counted: false };
    if (this.vanPass.counted || !across) return;
    for (const n of this.npcs) {
      if (n.rail || Math.abs(n.x - ego.x) > 60 || Math.abs(n.y - ego.y) > 60) continue;
      const q = projectPoint(e.pts, e.cum, [n.x, n.y], null);
      if (!q || q.s < 0.5 || q.s > e.length - 0.5 || q.lateral > AUDIT_MEET_SIDE_M || q.lateral < e.asphalt[0] - 1 || Math.abs(wrap(n.psi - q.heading)) < Math.PI * 3 / 4) continue;
      const gap = q.s - ((n.spec || CAR).length - (n.spec || CAR).rearOverhang) - front;
      if (gap < -1) continue;
      const closing = Math.max(0, ego.v) + Math.max(0, n.v);
      if (gap < AUDIT_MEET_M || (closing > 0.5 && gap / closing < AUDIT_MEET_S)) {
        this.vanPass.counted = true;
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "oncoming traffic", with: n.id, double_parked: true, van: d.id });
        return;
      }
    }
  }

  // Passing a snow plow on the right, and cutting back in front of one passed on the left (see
  // AUDIT_PLOW_M).
  auditPlows() {
    const npcs = this.npcs || [];
    if (!npcs.some(isPlow)) { this.plowPass.clear(); return; }
    this.plowsSeen = true;
    const ego = this.ego, keep = stayBack(this._road?.limit ?? 11.2);
    for (const n of npcs) {
      if (!isPlow(n)) continue;
      const rel = Math.abs(n.x - ego.x) < AUDIT_PLOW_M && Math.abs(n.y - ego.y) < AUDIT_PLOW_M ? plowRelation(ego, n) : null;
      if (!rel) { this.plowPass.delete(n.id); continue; }
      const prev = this.plowPass.get(n.id), pass = prev ? { ...prev } : { right: false, left: false, cut: false };
      // (the car's centre drawing level with the plow's, from behind; and the plow getting ahead again
      // starts a new pass)
      if (prev && prev.ahead > 0 && rel.ahead_m <= 0) {
        const beside = Math.abs(rel.right_m) > SAME_LANE_M && Math.abs(rel.right_m) < NEXT_LANE_M;
        if (beside && rel.right_m < 0 && !turningLeft(n) && !pass.right) {
          pass.right = true;
          this.violations.plow_right_passes++;
          this.events.push({ type: "passed_plow_on_right", plow: n.id });
        }
        if (beside && rel.right_m > 0) pass.left = true;
      } else if (prev && prev.ahead <= 0 && rel.ahead_m > 0) Object.assign(pass, { right: false, left: false, cut: false });
      if (pass.left && !pass.cut && Math.abs(rel.right_m) < SAME_LANE_M && rel.clear_m > -1 && rel.clear_m < keep - AUDIT_CUT_SLACK_M) {
        pass.cut = true;
        this.events.push({ type: "cut_in_front_of_plow", plow: n.id, ahead_m: Math.round(rel.clear_m * 10) / 10 });
      }
      pass.ahead = rel.ahead_m;
      this.plowPass.set(n.id, pass);
    }
  }

  // At a lane closure: merging out of turn, merging early, and not letting someone in (see AUDIT_EARLY_M).
  auditClosures() {
    const lc = this.laneClosures;
    if (!lc.zones.length) { this.mergeCall = null; return; }
    this.closuresSeen = true;
    const here = lc.egoAt();
    if (!here) { this.mergeCall = null; return; }
    const z = here.zone, ego = this.ego, me = EGO_ID;
    if (this.mergeCall?.zone !== z.id) this.mergeCall = { zone: z.id, owed: false, crossed: false, lane: here.lane, early: false, letIn: false, took: false };
    const rec = this.mergeCall;
    if (here.side === "closed" && here.front < z.m + THROUGH_M) {
      rec.owed = z.grant !== me && (rec.owed || (z.head === me && canStopForMerge(ego.v, z.m - 0.5 - here.front, LC_OWED_DECEL)));
    } else if (here.side === "closed" && !rec.crossed) {
      rec.crossed = true;
      if (rec.owed) {
        const e = this.map.edges.get(z.edge), oo = e.lane_offsets[z.open];
        const cut = lc.movers(z).filter((x) => x.id !== me && Math.abs(x.body.lateral - oo) < 2.2 && x.body.front < here.front + 5 && x.body.front > z.m - 25).sort((a, b) => b.body.front - a.body.front)[0];
        this.violations.merge_cut_ins = (this.violations.merge_cut_ins || 0) + 1;
        this.events.push({ type: "merged_out_of_turn", zone: z.id, cut: cut?.id ?? null });
      }
    }
    if (rec.lane === "closed" && here.lane === "open" && here.front < z.m - AUDIT_EARLY_M && !rec.early) {
      rec.early = true;
      this.events.push({ type: "merged_early", zone: z.id });
    }
    if (here.side === "open") {
      const line = lc.letInLine(z, -Infinity), owing = z.turn === "closed" && !!z.head && z.head !== me;
      if (!owing) rec.letIn = false;
      else if (!rec.letIn && here.front < line + 0.5 && lc.firstInOpen(z, me)) rec.letIn = canStopForMerge(ego.v, line - here.front, LET_IN_DECEL);
      if (rec.letIn && owing && !rec.took && here.front > line + AUDIT_LET_IN_PAST_M && ego.v > AUDIT_MERGE_MOVING_MPS) {
        rec.took = true;
        this.events.push({ type: "took_merge_turn", zone: z.id, from: z.head });
      }
    }
    rec.lane = here.lane;
  }

  // The cyclist the car is passing now, through the oncoming lane (sim/cyclist-pass.js egoPassing), or null.
  passingCyclist() { return egoPassing(this); }

  // Passing a cyclist closer than the minimum passing distance, and crossing into the way of oncoming
  // traffic while passing one (see AUDIT_PASS_SLACK_M).
  auditCyclistPasses(road) {
    const ego = this.ego, eb = ego.obb(), min = minPassM(road?.limit ?? 11.2);
    for (const n of this.npcs) {
      if (n.kind !== "bike") continue;
      if (Math.abs(n.x - ego.x) > AUDIT_PASS_NEAR_M || Math.abs(n.y - ego.y) > AUDIT_PASS_NEAR_M || Math.abs(wrap(n.psi - ego.psi)) > Math.PI / 4) { this.bikePasses.delete(n.id); continue; }
      const b = n.obb(), c = Math.cos(b.heading), s = Math.sin(b.heading), dx = eb.center[0] - b.center[0], dy = eb.center[1] - b.center[1];
      const ahead = dx * c + dy * s, gap = Math.abs(dx * s - dy * c) - eb.halfWidth - b.halfWidth, reach = eb.halfLength + b.halfLength;
      if (ahead < -reach) { this.bikePasses.set(n.id, { min: Infinity }); continue; }
      const rec = this.bikePasses.get(n.id);
      if (!rec) continue;
      if (ahead <= reach) { rec.min = Math.min(rec.min, gap); continue; }
      this.bikePasses.delete(n.id);
      if (rec.min < min - AUDIT_PASS_SLACK_M) {
        this.violations.close_passes = (this.violations.close_passes || 0) + 1;
        this.events.push({ type: "close_pass", with: n.id, clearance_m: Math.round(Math.max(0, rec.min) * 100) / 100, min_m: min });
      }
    }
    const passing = egoPassing(this);
    if (!passing) { this.cyclistPass = null; return; }
    const { bike, e, front, across } = passing;
    if (this.cyclistPass?.id !== bike.id) this.cyclistPass = { id: bike.id, counted: false };
    if (this.cyclistPass.counted || !across) return;
    for (const n of this.npcs) {
      if (n.rail || n === bike || Math.abs(n.x - ego.x) > 60 || Math.abs(n.y - ego.y) > 60) continue;
      const q = projectPoint(e.pts, e.cum, [n.x, n.y], null);
      if (!q || q.s < 0.5 || q.s > e.length - 0.5 || q.lateral > AUDIT_MEET_SIDE_M || q.lateral < e.asphalt[0] - 1 || Math.abs(wrap(n.psi - q.heading)) < Math.PI * 3 / 4) continue;
      const gap = q.s - ((n.spec || CAR).length - (n.spec || CAR).rearOverhang) - front;
      if (gap < -1) continue;
      const closing = Math.max(0, ego.v) + Math.max(0, n.v);
      if (gap < AUDIT_MEET_M || (closing > 0.5 && gap / closing < AUDIT_MEET_S)) {
        this.cyclistPass.counted = true;
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "oncoming traffic", with: n.id, cyclist_pass: true, cyclist: bike.id });
        return;
      }
    }
  }

  // Going past a flagger's STOP paddle once the stop was owed (see AUDIT_FLAGGER_PAST_M).
  auditFlaggers() {
    const zones = this.workZones.zones;
    if (!zones.length) return;
    const ego = this.ego, FRONT = ego.spec.length - ego.spec.rearOverhang;
    for (const z of zones) {
      if (Math.abs(ego.x - z.x) > WZ_SPAN_M + 80 || Math.abs(ego.y - z.y) > WZ_SPAN_M + 80) continue;
      for (const side of ["closed", "open"]) {
        if (paddle(z, side) !== "stop") continue;
        const e = this.map.edges.get(z[side]), p = projectPoint(e.pts, e.cum, [ego.x, ego.y], null);
        if (!p || p.lateral < e.asphalt[0] - 1 || p.lateral > e.asphalt[1] + 1 || Math.abs(wrap(ego.psi - p.heading)) > Math.PI / 3) continue;
        const m = marksOn(z, side), front = p.s + FRONT, key = stopKey(z, side);
        if (front > m.to) continue;
        let rec = this.flaggerCalls.get(key);
        // (decided when the car first sees the flagger showing STOP, still short of the one-lane section)
        if (!rec && front < m.from && this.visibility.canSee(ego, ...z.flaggers[side])) this.flaggerCalls.set(key, rec = { owed: canStopForFlagger(ego.v, Math.max(0, m.line - front)), counted: false });
        if (rec?.owed && !rec.counted && front > m.line + AUDIT_FLAGGER_PAST_M && ego.v > AUDIT_FLAGGER_MOVING_MPS) {
          rec.counted = true;
          this.violations.stop_signs_run++;
          this.events.push({ type: "stop_sign", flagger: true, zone: z.id });
        }
      }
    }
    if (this.flaggerCalls.size > 20) for (const key of [...this.flaggerCalls.keys()].slice(0, 10)) this.flaggerCalls.delete(key);
  }

  // Through a junction on a left arrow: anything but a left turn (heading more than 45 deg left of
  // the approach once AUDIT_ARROW_OUT_M from its centre) went on a red, unless it was a right turn on
  // red after a full stop where that is allowed.
  auditArrow() {
    const a = this.arrowCheck, ego = this.ego;
    if (!a) return;
    // (on its way out: in the junction first, then that far from its centre)
    const d = Math.hypot(ego.x - a.centre[0], ego.y - a.centre[1]);
    a.inside ||= d < AUDIT_ARROW_OUT_M;
    if (!a.inside || d < AUDIT_ARROW_OUT_M) return;
    this.arrowCheck = null;
    const turned = wrap(ego.psi - a.approach);
    if (turned > Math.PI / 4 || (a.stopped && turned < -Math.PI / 4)) return;
    this.violations.red_lights_run++;
    this.events.push({ type: "red_light", arrow: true });
  }

  // (see AUDIT_BOX_MOVING_MPS) `frontS`: the car's front along its route, or null off it.
  auditBox(dt, frontS) {
    const ego = this.ego, route = this.route;
    if (frontS === null || !route) { this.inBox = null; return; }
    const ahead = routeBoxAhead(this.map, route, frontS, ego.v);
    const key = ahead ? `${ahead.c.control.id}:${Math.round(ahead.line)}` : null;
    // (entering the junction, its front past the near side of the street across: was there room
    // past it?)
    if (ahead && ahead.toNear <= 0 && this.inBox?.key !== key) {
      this.inBox = { key, id: ahead.c.control.id, edge: ahead.c.edge, turn: ahead.c.turn || "straight", line: ahead.line, near: ahead.near, far: ahead.far, since: this.t, still: 0, counted: false,
        noRoom: !!boxBlocker(route.pts, route.cum, ahead.line, ahead.far, ego.spec, this.npcs, ego) };
    }
    const box = this.inBox;
    if (!box) return;
    // (out of it: all of the car past its far side, or backed out of it)
    if (frontS - ego.spec.length > box.far || frontS < box.near - 2) { this.inBox = null; return; }
    box.still = Math.abs(ego.v) < 0.3 ? box.still + dt : 0;
    box.blocked = !!boxBlocker(route.pts, route.cum, box.line, box.far, ego.spec, this.npcs, ego);
    if (box.noRoom && !box.counted && Math.abs(ego.v) < AUDIT_BOX_MOVING_MPS && this.light(box.id, box.edge, box.turn) === "red") {
      box.counted = true;
      this.violations.failed_to_yield++;
      this.events.push({ type: "failed_to_yield", to: "cross traffic", junction: box.id, blocking: true });
    }
  }

  auditCrossings(dt) {
    const crossings = railIndex(this.map).crossings;
    if (!crossings.length) return;
    const ego = this.ego;
    // (where the car stands on the tracks, for the coaching score: sim/drive-score.js)
    const on = crossings.find((c) => fouling(ego, c, this.map)) || null;
    if (!on) this.onTracks = null;
    else if (this.onTracks?.id !== on.id) this.onTracks = { id: on.id, since: this.t, still: 0 };
    if (this.onTracks) this.onTracks.still = Math.abs(ego.v) < 0.3 ? this.onTracks.still + dt : 0;
    const ahead = crossingAheadOf(ego, this.map);
    for (const c of crossings) {
      const at = trainAt(this.npcs, c);
      if (!at) continue;
      const x = ahead?.c === c ? ahead.x : null, foul = on === c;
      if (!x && !foul) continue;
      const train = at.train, key = `${c.id}:${train.id}:${train.rail.departures}`;
      let rec = this.trainCalls.get(key);
      // (decided when the car first hears or sees it coming, still short of the law's line)
      if (!rec && x && x.hold_m > 0) {
        const heard = train.rail.gong && Math.hypot(train.x - ego.x, train.y - ego.y) < HEAR_M;
        if (heard || this.visibility.sees(ego, train)) this.trainCalls.set(key, rec = { owed: canStopForTrain(ego.v, x.stop_m), counted: false });
      }
      if (rec?.counted) continue;
      const crossed = rec?.owed && x && x.hold_m <= 0 && !x.fouling && x.exit_m > 0 && ego.v > AUDIT_TRAIN_MOVING_MPS;
      const stood = foul && Math.abs(ego.v) < AUDIT_TRAIN_MOVING_MPS;
      if (crossed || stood) {
        if (!rec) this.trainCalls.set(key, rec = { owed: true, counted: false });
        rec.counted = true;
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "train", with: train.id, crossing: c.id, ...(stood ? { on_tracks: true } : {}) });
      }
    }
    if (this.trainCalls.size > 20) for (const key of [...this.trainCalls.keys()].slice(0, 10)) this.trainCalls.delete(key);
  }

  auditStreetcars() {
    const ego = this.ego;
    for (const car of this.npcs) {
      if (!doorsOpen(car)) continue;
      const key = `${car.id}:${car.transit.departures}`, r = streetcarRelation(ego, car);
      if (!r || r.right_m < -IN_LANE_M || r.right_m > STREETCAR_SIDE_M) continue;
      let rec = this.streetcarCalls.get(key);
      // (decided when the car first sees the doors open, still short of where it must stop)
      if (!rec) {
        if (r.ahead_m <= 0 || !this.visibility.sees(ego, car)) continue;
        this.streetcarCalls.set(key, rec = { owed: canStopForStreetcar(ego.v, r.ahead_m), counted: false });
      }
      if (rec.owed && !rec.counted && r.ahead_m <= STREETCAR_HOLD_M - STREETCAR_STOP_M && ego.v > AUDIT_STREETCAR_MOVING_MPS) {
        rec.counted = true;
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "streetcar", with: car.id });
      }
    }
    if (this.streetcarCalls.size > 20) for (const key of [...this.streetcarCalls.keys()].slice(0, 10)) this.streetcarCalls.delete(key);
  }

  auditSchoolBuses() {
    const ego = this.ego;
    for (const bus of this.npcs) {
      if (!redsOn(bus)) continue;
      const key = `${bus.id}:${bus.school.stops}`, r = schoolBusRelation(ego, bus);
      if (!r || Math.abs(r.right_m) > SIDE_M) continue;
      let rec = this.schoolCalls.get(key);
      // (decided when the car first sees the reds, still short of the bus)
      if (!rec) {
        if (r.ahead_m <= 0 || !this.visibility.sees(ego, bus)) continue;
        this.schoolCalls.set(key, rec = { owed: canStopForSchool(ego.v, r.ahead_m - (r.relation === "behind" ? BEHIND_M : ONCOMING_M)), counted: false });
      }
      if (rec.owed && !rec.counted && r.ahead_m <= 0 && ego.v > AUDIT_SCHOOL_MOVING_MPS) {
        rec.counted = true;
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "school bus", with: bus.id });
      }
    }
    if (this.schoolCalls.size > 20) for (const key of [...this.schoolCalls.keys()].slice(0, 10)) this.schoolCalls.delete(key);
  }

  auditCrosswalkPass() {
    const ego = this.ego, f = ego.front, prev = this._cwFront;
    this._cwFront = f;
    for (const cw of this.crowd.marked) {
      if (Math.abs(cw.ends[1][0] - ego.x) > 70 || Math.abs(cw.ends[1][1] - ego.y) > 70) continue;
      const d = frontTo(cw, ego);
      if (d === null || d < -3 || d > 60) continue;
      // (decided when the car first sees the vehicle stopped there, while it is still behind it)
      for (const n of stoppedAt(this, cw, ego)) {
        const key = `${cw.id}:${n.id}`;
        if (!this.crosswalkCalls.has(key) && this.visibility.sees(ego, n)) this.crosswalkCalls.set(key, { owed: canStopShort(ego.v, d), counted: false });
      }
      if (!prev || d > 0 || ego.v <= AUDIT_CROSSWALK_MOVING_MPS || looked(this, cw) || !segIntersect(prev, f, cw.ends[1], cw.ends[-1])) continue;
      // (the vehicle is beside the car now, so no longer ahead of it)
      for (const n of stoppedAt(this, cw, ego, this.npcs, false)) {
        const rec = this.crosswalkCalls.get(`${cw.id}:${n.id}`);
        if (!rec || !rec.owed || rec.counted) continue;
        rec.counted = true;
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "vehicle stopped at a crosswalk", with: n.id });
      }
    }
    if (this.crosswalkCalls.size > 40) for (const key of [...this.crosswalkCalls.keys()].slice(0, 20)) this.crosswalkCalls.delete(key);
  }

  auditBuses() {
    const ego = this.ego;
    for (const bus of this.npcs) {
      if (!isBus(bus) || !busHasRightOfWay(bus)) continue;
      const key = `${bus.id}:${bus.transit.departures}`, r = busRelation(ego, bus);
      let rec = this.busCalls.get(key);
      if (!r || !r.inLane) continue;
      // (it owes the bus the right of way if it was behind it when it first saw it signal, and could
      // stop then; until it sees it, nothing is decided)
      if (!rec) {
        if (!this.visibility.sees(ego, bus)) continue;
        this.busCalls.set(key, rec = { owed: r.behind_m > 0 && r.behind_m - BUS_YIELD_GAP_M >= Math.max(0, ego.v) ** 2 / (2 * AUDIT_BUS_DECEL), counted: false });
      }
      if (rec.owed && !rec.counted && r.behind_m < 0 && ego.v > AUDIT_BUS_MOVING_MPS) {
        rec.counted = true;
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "bus", with: bus.id });
      }
    }
    // (forget buses that have pulled out)
    if (this.busCalls.size > 20) for (const key of [...this.busCalls.keys()].slice(0, 10)) this.busCalls.delete(key);
  }

  auditEmergency(road) {
    const ego = this.ego, evs = this.npcs.filter(isEmergency);
    if (!evs.length) { this.evCalls.clear(); this.evJunction = null; return; }
    const FRONT = ego.spec.length - ego.spec.rearOverhang;
    const fx = ego.x + Math.cos(ego.psi) * FRONT, fy = ego.y + Math.sin(ego.psi) * FRONT;
    let junction = null;
    for (const n of this.map.nodes.values()) {
      if (Math.abs(n.x - fx) < AUDIT_EV_BOX_M && Math.abs(n.y - fy) < AUDIT_EV_BOX_M && Math.hypot(n.x - fx, n.y - fy) < AUDIT_EV_BOX_M && isJunction(this.map, n.id)) { junction = n.id; break; }
    }
    const entered = junction !== null && junction !== this.evJunction && ego.v > 1;
    this.evJunction = junction;
    const pulled = road.lane && road.lateral >= AUDIT_EV_PULLED_M;
    for (const ev of evs) {
      const call = emergencyCall(ego, ev);
      let rec = this.evCalls.get(ev.id);
      if (!call) { if (rec) this.evCalls.delete(ev.id); continue; }
      if (!rec) this.evCalls.set(ev.id, rec = { since: this.t, v0: Math.max(0, ego.v), lead: false, ahead: null });
      // (where its middle is along the car, from the car's middle)
      const [cx, cy] = ev.center, local = ego.toLocal(cx, cy), ahead = local.ahead - (ego.spec.length / 2 - ego.spec.rearOverhang), before = rec.ahead;
      rec.ahead = ahead;
      // (told to drive on ahead of it, having pulled over as far as it could)
      rec.lead ||= pulled && leadsEmergency(ev, ego);
      if (this.evCounted.has(ev.id)) continue;
      const after = this.t - rec.since;
      const late = !rec.lead && after > AUDIT_EV_REACT_S && ego.v > Math.max(AUDIT_EV_MOVING_MPS, rec.v0 - AUDIT_EV_DECEL * (after - AUDIT_EV_REACT_S));
      const crossing = call.relation === "left" || call.relation === "right";
      const level = !crossing && before !== null && Math.sign(before) !== Math.sign(ahead) && Math.abs(local.right) < AUDIT_EV_SIDE_M;
      const unmoved = level && after >= AUDIT_EV_PULL_S && !pulled && !rec.lead && junction === null;
      if (late || unmoved || (entered && crossing && after >= AUDIT_EV_JUNCTION_S) || (holdsUp(ev, ego, AUDIT_EV_BLOCK_S) && !pulled && !rec.lead)) {
        this.evCounted.add(ev.id);
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "emergency vehicle", with: ev.id });
      }
    }
  }

  auditCyclists() {
    const ego = this.ego, FRONT = ego.spec.length - ego.spec.rearOverhang;
    const fx = ego.x + Math.cos(ego.psi) * FRONT, fy = ego.y + Math.sin(ego.psi) * FRONT;
    for (const n of this.npcs) {
      if (n.kind !== "bike" || !n.path?.pts || Math.abs(n.x - ego.x) > 40 || Math.abs(n.y - ego.y) > 40) continue;
      const local = ego.toLocal(n.x, n.y), spec = n.spec || CAR;
      if (Math.abs(wrap(n.psi - ego.psi)) < Math.PI / 6 && local.right > (ego.spec.width + spec.width) / 2 + 0.1
        && local.ahead > -30 && local.ahead < ego.spec.length + 5) this.besideRight.set(n.id, this.t);
      const seen = this.besideRight.get(n.id), counted = this.hookCounted.get(n.id);
      if (seen === undefined || this.t - seen > AUDIT_HOOK_MEMORY_S || n.v < 1 || ego.v < 0.5) continue;
      if (counted !== undefined && this.t - counted < AUDIT_HOOK_AGAIN_S) continue;
      const p = frontOnPath(ego, n, fx, fy);
      if (!p || p.along || p.ahead_m / n.v >= AUDIT_ONCOMING_S) continue;
      if (wrap(ego.psi - headingAt(n.path.pts, n.path.cum, p.s)) > -AUDIT_HOOK_TURN) continue;
      this.hookCounted.set(n.id, this.t);
      this.violations.failed_to_yield++;
      this.events.push({ type: "failed_to_yield", to: "cyclist", with: n.id });
    }
  }

  auditGiveWay() {
    const g = this.giveWay;
    if (!g) return;
    const FRONT = this.ego.spec.length - this.ego.spec.rearOverhang;
    const fx = this.ego.x + Math.cos(this.ego.psi) * FRONT, fy = this.ego.y + Math.sin(this.ego.psi) * FRONT;
    const [jx, jy] = g.centre;
    if (Math.hypot(fx - jx, fy - jy) > AUDIT_JUNCTION_M) { this.giveWay = null; return; }
    if (g.counted) return;
    const due = this.npcs.find((n) => {
      if (n.v < 1 || !n.path?.pts || !g.coming.has(n)) return false;
      // the street it comes in on, from its plan: on its way to the junction, or in it
      const a = approachTo(this.map, n, g.node);
      const inside = !a && Math.hypot(n.x - jx, n.y - jy) < AUDIT_BOX_M ? n.path.edges.find((e) => e.to === g.node && e.sEnd > n.path.s - AUDIT_BOX_M) : null;
      const from = a ? a.edge : inside?.id;
      if (!from || !outranks(this.map, from, g.edge)) return false;
      if (a && a.to_node_m / n.v >= AUDIT_ONCOMING_S) return false;
      const p = frontOnPath(this.ego, n, fx, fy);
      return !!p && !(p.along && p.ahead_m / n.v >= AUDIT_ONCOMING_S);
    });
    if (due) {
      g.counted = true;
      this.violations.failed_to_yield++;
      // (with hidden traffic, sim/hidden-traffic.js: whether another vehicle hid it from the car as it pulled out)
      this.events.push({ type: "failed_to_yield", to: g.to, with: due.id, ...(this.hiddenByVehicle(due) ? { unseen: true } : {}) });
    }
  }

  auditOncoming() {
    const j = this.lastSignal;
    if (!j) return;
    // Turning round in a dead end off this junction, the car has finished its turn here: it comes
    // back out as a new approach.
    if (this.turnaround && this.turnaround.phase !== "stuck") { this.lastSignal = null; return; }
    const FRONT = this.ego.spec.length - this.ego.spec.rearOverhang;
    const fx = this.ego.x + Math.cos(this.ego.psi) * FRONT, fy = this.ego.y + Math.sin(this.ego.psi) * FRONT;
    const [jx, jy] = j.centre;
    const rtor = j.rightOnRed;
    if (rtor && !rtor.turned) {
      // crossed on red after a full stop: legal if it has turned right, else it ran the red, judged
      // from the street the car is on. In a lane of a street the way the car faces, one leaving the
      // junction to the right starts a right turn (`via`), which carries on along the streets it
      // leads to; any other street ends it (so does a right turn further on, off a street the car
      // went straight on into). Going on past the centre other than by that right turn runs
      // the red there and then; a right turn (which stays short of the centre) holds only once the
      // car leaves the junction on it, as do a sharp left and a U-turn (which head back behind the
      // centre), so a swerve toward a shallow right-hand exit and back does not count.
      const out = Math.hypot(fx - jx, fy - jy);
      const past = (fx - jx) * Math.cos(rtor.approach) + (fy - jy) * Math.sin(rtor.approach);
      const at = this.map.nearestLane(fx, fy, this.ego.psi, 8), on = at?.lane.edgeRef;
      if (on && on.id !== rtor.edge && on.id !== rtor.via?.id && Math.abs(wrap(at.heading - this.ego.psi)) <= Math.PI / 3) {
        if (this.map.classifyTurn(this.map.turnAngle(rtor.edge, on.id)) === "right" && (j.nodes.has(on.from) || on.from === this.map.edges.get(rtor.edge)?.to)) rtor.via = on;
        else rtor.via = rtor.via && on.from === rtor.via.to ? on : null;
      }
      if ((out > AUDIT_RTOR_OUT_M && past > 0) || out > AUDIT_JUNCTION_M) {
        if (on && on.id === rtor.via?.id) { if (out > AUDIT_JUNCTION_M) rtor.turned = true; }
        else {
          this.violations.red_lights_run++;
          this.events.push({ type: "red_light" });
          j.rightOnRed = null;
        }
      }
    }
    if (Math.hypot(fx - jx, fy - jy) > AUDIT_JUNCTION_M) { this.lastSignal = null; return; }
    if (j.counted) return;
    // Without a planned turn, audit the manoeuvre the car actually makes, independently of its
    // indicator. Through traffic at a two-way stop is not oncoming left-turn traffic.
    if (j.manualStop) {
      const turn = this.map.classifyTurn(wrap(this.ego.psi - j.facing + Math.PI));
      if (turn !== "left" && turn !== "uturn") return;
    }
    // as in sensing: traffic better aligned with coming down the street the car turns into is in
    // that street's other lane. Turning right on red, the traffic that counts comes from the left,
    // heading the way the car turns.
    const facing = j.rightOnRed ? j.rightOnRed.exit : j.facing, down = j.rightOnRed ? null : (j.exit ?? this.ego.psi) + Math.PI;
    const due = this.npcs.find((n) => {
      const rel = Math.abs(wrap(n.psi - facing)), path = n.path?.pts ? n.path : null;
      if (n.v < 1 || (down !== null && Math.abs(wrap(n.psi - down)) < rel)) return false;
      // without a route, a vehicle signalling a left turn is taken to be turning (see below)
      if (!path && n.signal === "left" && !j.rightOnRed) return false;
      // turning right on red, one that came the same way as the car is following it, not crossing
      if (j.rightOnRed && path?.edges.some((e) => e.id === j.rightOnRed.edge)) return false;
      const ux = Math.cos(n.psi), uy = Math.sin(n.psi), dx = jx - n.x, dy = jy - n.y, d = Math.hypot(dx, dy);
      const closing = (dx * ux + dy * uy) / Math.max(d, 1e-6), inBox = d < AUDIT_BOX_M;
      // turning right on red, traffic from the left already through the junction, still within
      // 15 m of its centre down the street the car turns into, can still be cut off (the check
      // along its path below)
      const through = j.rightOnRed && path && rel < Math.PI / 6 && closing <= 0 && d < AUDIT_RTOR_OUT_M;
      if (!through && !(rel < Math.PI / 3 && closing > 0) && !(inBox && rel < Math.PI * 7 / 12 && closing > -0.5)) return false;
      if (!inBox && !through && d / n.v >= AUDIT_ONCOMING_S) return false;
      // braking to stop short of the junction (for its own light, say)
      if (!inBox && !through && n.a < -0.5 && n.v * n.v / (-2 * n.a) < d - 6) return false;
      // the car's front is in its path, ahead of it: along the lanes it is following, else straight
      // on along its heading
      const reach = (this.ego.spec.width + (n.spec || CAR).width) / 2;
      if (path) {
        const p = frontOnPath(this.ego, n, fx, fy);
        if (!p) return false;
        // Heading the same way along its path (down the street both turned into, say), the car is
        // ahead of it: that is a cut-off only if it would reach the car within the same 2 s.
        if ((p.along || through) && p.ahead_m / n.v >= AUDIT_ONCOMING_S) return false;
        // A vehicle turning its own left at this junction must itself yield, where the car meets it
        // on its turn (known from its route: its indicator goes off mid-turn, and shows a lane change
        // too). Met before it turns, on the way through, it has the right of way.
        if (j.rightOnRed) return true;
        const left = leftTurnAt(this.map, path, j);
        return left === null || p.s < left - AUDIT_CORNER_M;
      }
      const ax = fx - n.x, ay = fy - n.y;
      return ax * ux + ay * uy > 0 && Math.abs(ax * uy - ay * ux) < reach;
    });
    if (due) {
      j.counted = true;
      this.violations.failed_to_yield++;
      this.events.push({ type: "failed_to_yield", to: j.rightOnRed ? "cross traffic" : "oncoming traffic", with: due.id, ...(this.hiddenByVehicle(due) ? { unseen: true } : {}) });
    }
  }

}

// The ego's front bumper swept across a crosswalk this tick while a pedestrian on it was within a
// lane's width of the car's line: a failure to yield (counted once per pedestrian and crossing).
World.prototype.auditCrosswalks = function () {
  const f = this.ego.front;
  const prev = this._lastFront;
  this._lastFront = f;
  if (!prev || this.ego.v < 0.3) return;
  for (const ped of this.crowd.list) {
    const c = ped.crossing;
    // someone crossing mid-block must yield to traffic: hitting them is a collision, not this
    if (!c || c.jaywalk || ped.yieldCounted === c) continue;
    const hit = segIntersect(prev, f, c.from, c.to);
    if (!hit) continue;
    const len = Math.hypot(c.to[0] - c.from[0], c.to[1] - c.from[1]);
    const along = ((ped.x - c.from[0]) * (c.to[0] - c.from[0]) + (ped.y - c.from[1]) * (c.to[1] - c.from[1])) / len;
    if (Math.abs(hit.u * len - along) < 3.0) {
      ped.yieldCounted = c;
      this.violations.failed_to_yield++;
      this.events.push({ type: "failed_to_yield", to: "pedestrian", with: ped.id });
    }
  }
};

function segIntersect(p, q, a, b) {
  const r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const w = [a[0] - p[0], a[1] - p[1]];
  const t = (w[0] * s[1] - w[1] * s[0]) / den, u = (w[0] * r[1] - w[1] * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

export function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

function lanePoint(lane, s) {
  const cum = lane.cum, pts = lane.pts;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] <= s) i++;
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (s - cum[i]) / seg : 0;
  return {
    pointAt: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t],
    headingAt: Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]),
  };
}

// Where the car's front bumper (fx, fy) is in a traffic vehicle's path, ahead of it: along the lanes
// it is following (a street that jogs or bends keeps it in its own lane), measured from where it
// actually is beside them (changing lanes, pulling out, a cyclist keeping right), within half the
// two widths. Its arc length along the path (`s`), how far ahead of the vehicle (`ahead_m`), and
// whether the car heads the same way there (`along`); else null.
function frontOnPath(ego, n, fx, fy) {
  const path = n.path, reach = (ego.spec.width + (n.spec || CAR).width) / 2;
  const own = nearestOnPath(path, n.x, n.y, path.s - 2, path.s + 2), p = nearestOnPath(path, fx, fy, path.s, path.s + AUDIT_PATH_M);
  const beside = own ? own.lateral : 0;
  if (!p || !(p.s > path.s) || Math.abs(p.lateral - beside) >= reach || p.distance >= reach + Math.abs(beside)) return null;
  return { s: p.s, ahead_m: p.s - path.s, along: Math.abs(wrap(ego.psi - headingAt(path.pts, path.cum, p.s))) < Math.PI / 6 };
}

// The closest point to (x, y) on the stretch of a path between arc lengths s0 and s1 (searching
// only there, so a path that loops back past the same spot later is not mistaken for it): its arc
// length, distance and signed lateral offset (right of travel positive).
function nearestOnPath(path, x, y, s0, s1) {
  const { pts, cum } = path;
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    if (cum[i + 1] < s0 || cum[i] > s1) continue;
    const [ax, ay] = pts[i], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const t = Math.max((s0 - cum[i]) / len, 0, Math.min(1, (s1 - cum[i]) / len, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
    const qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(x - qx, y - qy);
    if (!best || d < best.distance) best = { s: cum[i] + t * len, distance: d, lateral: ((x - qx) * dy - (y - qy) * dx) / len };
  }
  return best;
}

// Where an NPC's planned path turns left (or around) at a signal's junction, as arc length along
// it (the start of the edge it turns onto), or null when it does not. Read from the edge of its path
// that is one of the junction's approaches (it may already be past it, turning; not a street that
// led onto the approach), across the junction's short links, never on to the next junction.
function leftTurnAt(map, path, { approaches, nodes }) {
  const k = path.edges.findIndex((e) => e.sEnd > path.s - 30 && approaches.has(e.id));
  if (k < 0) return null;
  const { turn, at } = map.turnThrough(path.edges.map((e) => e.id), k, nodes);
  return turn === "left" || turn === "uturn" ? path.edges[at].sStart : null;
}
