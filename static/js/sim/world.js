// The simulation world: map, ego car, traffic, signals, time, and honest counters.

import { Vehicle, CAR } from "./vehicle.js";
import { headingAt } from "../map/mapdata.js";
import { surfaceDistance } from "../map/junctions.js";
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
import { canStopShort, frontTo, hiddenByTraffic, looked, noteStop, stoppedAt } from "./crosswalk.js";
import { zoneLimit } from "./speed-zones.js";
import { boxBlocker, routeBoxAhead } from "./junction-box.js";
import { leftSpace, reversing, tyres } from "./parallel-park.js";
import { StepOuts, standingNear } from "./hidden-hazards.js";
import { hideable, hiddenVehicle } from "./hidden-traffic.js";

import {
  FEATURES,
  FEATURE_INITIAL_COUNTERS,
  controlDirection,
  controlAt,
  alternateSignal,
  specialSignalPhase,
  featureNeedsDay,
  featureNeedsUtcOffset,
  featureObstacle,
  firstHookResult,
  phaseBansRedTurns,
  hooks,
  buildFeatures,
} from "./features/index.js";

// The registered features' hooks (sim/features/index.js), each run where that feature's code used to be.
const OBSTACLES_NEAR = hooks("obstacles");
const AUDIT_BEFORE_COLLISIONS = hooks("audit", "beforeCollisions");
const AUDIT_BEFORE_DRIVEWAYS = hooks("audit", "beforeDriveways");
const AUDIT_AFTER_DRIVEWAYS = hooks("audit", "driveways");
const AUDIT_STREET_HAZARDS = hooks("audit", "streetHazards");
const AUDIT_REAR_TRAFFIC = hooks("audit", "rearTraffic");
const HIDES = hooks("hides"),
  PLACE_EGO = hooks("placeEgo");
const AUDIT_LATE = hooks("audit", "late");
const AUDIT_BUSES = hooks("audit", "buses");
const PARKING_ZONES = hooks("parkingZones");
const AUDIT_BEFORE_MERGE = hooks("audit", "beforeMerge");
const AUDIT_PASSING = hooks("audit", "beforeReservedLane");
const AUDIT_AFTER_ROADSIDE_VEHICLES = hooks("audit", "afterRoadsideVehicles");
const AUDIT_AFTER_FLAGGER = hooks("audit", "afterFlagger");
const AUDIT_AFTER_PASSING = hooks("audit", "afterPassing");
const AUDIT_AFTER_CALMING = hooks("audit", "afterCalming");
const AUDIT_AFTER_CYCLISTS = hooks("audit", "afterCyclists");
const VISION_RANGE = hooks("visionRange");
const SIGNED_EXITS = hooks("redEntryBans");
const CONTROL_AUDIT = hooks("controlAudit");
const CONTROL_EVENT = hooks("controlEvent");
const RED_LIGHT_EVENT = hooks("redLightEvent");
const AUDIT_SIGNAL = hooks("auditSignal");
const OBSERVE_CONTROL = hooks("observeControl");
const OBSERVE_SIGNAL = hooks("observeSignal");
const ARROW_EXIT_AUDIT = hooks("arrowExitAudit");
const RED_TURN_MEMORY = hooks("redTurnMemory");
const RED_TURN_EXIT = hooks("redTurnExit");
const RESET_CONTACT = hooks("resetContact");

export const AUDIT_ROUTE_CORRIDOR_M = 4;
export const AUDIT_ROUTE_HEADING_RAD = Math.PI / 3;
// Past a signal's line, the car fails to yield when its front bumper enters the path of an
// oncoming vehicle (seen or not) due at the junction's centre within this many seconds. The path
// is the one the vehicle is actually following, so only a left turn or a U-turn takes the car into
// it and the check needs no route: a free drive is audited too. It runs until the front is this
// far from the junction's centre.
const AUDIT_ONCOMING_S = 2.0;
const AUDIT_JUNCTION_M = 30;
const AUDIT_PATH_M = 50;
const AUDIT_CORNER_M = 8; // a turn's rounded corner starts about this far before the node it turns at   // how far along an oncoming vehicle's path the car's front is looked for
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
// Passing a vehicle stopped at a marked crosswalk (sim/crosswalk.js, BC MVA s. 179(3)): once the car,
// behind it in another lane going its way, first sees it stopped there, it owes it if it could stop
// with its front 3.5 m short of the crosswalk's centre braking at up to 3.5 m/s^2 then. It fails to
// yield if, owing it, its front crosses the crosswalk's centre at more than 1 m/s while the vehicle is
// still stopped there, without having stood still at the crosswalk for 2 s first. Counted once a
// vehicle and crosswalk.
const AUDIT_CROSSWALK_MOVING_MPS = 1;
// Keeping the junction clear (sim/junction-box.js, Québec's Highway Safety Code): the car, following
// its route, fails to yield if it entered a signal's junction (its front past the near side of the
// street across) while traffic past it left no room for it beyond, and is then standing in it (slower than 1 m/s) while its light is
// red, blocking the cross street's green. Counted once a visit.
const AUDIT_BOX_MOVING_MPS = 1;
export class World {
  // `park`: the autopilot parks at the
  // destination (sim/parallel-park.js). `hazards`: vehicles standing at the kerb hide people, and the
  // driven car keeps to a speed it can stop from beside them; `stepOuts`: with that, how many people at
  // a time wait hidden between parked cars ahead of it to step out (sim/hidden-hazards.js). With
  // `hazards`, road vehicles also hide other vehicles and cyclists, and the car turns left, gives way
  // and turns right on red only once it can see the lanes it must give way to (sim/hidden-traffic.js).
  // And the option of each registered feature (sim/features/index.js).
  constructor(
    map,
    {
      seed = 1,
      parked = PARKED_DENSITY,
      pedestrians = PEDESTRIANS,
      weather = "dry",
      vehicleSpec = CAR,
      park = false,
      hazards = false,
      stepOuts = 0,
      ...features
    } = {},
  ) {
    this.map = map;
    buildFeatures(this, features, seed, map, "early");
    this.seed = seed;
    this.visibility = new Visibility(map);
    this.staticObstacles = new StaticObstacles(map);
    this.staticContacts = new Map();
    this.weather = setWeather(weather).name;
    // (nobody parks where a registered feature keeps the kerb clear: the bus zones while buses run, say)
    this.parked = new ParkedCars(map, { seed, density: parked, zones: firstHookResult(PARKING_ZONES, this, map) });
    this.t = 0;
    this.tick = 0;
    this.ego = new Vehicle(0, 0, 0, 0, vehicleSpec);
    this.npcs = [];
    this.route = null;
    this.destination = null;
    this.paused = false;
    this.egoStop = new StopMemory();
    this.allWay = new AllWayStops(map);
    this.allWayCounted = null; // the all-way stop it went out of turn at (counted once a visit)
    this.giveWay = null; // the junction it last crossed a line into, giving way there
    this.egoPeek = null; // the control it has stopped at to look past a building, giving way
    this.egoPeekAt = 0; // (since when)
    this.turnaround = null; // the three-point turn the car is making (sim/turnaround.js)
    this.besideRight = new Map(); // cyclist id -> when it last rode on the car's right, going its way
    this.hookCounted = new Map(); // cyclist id -> when cutting across it was last counted
    this.crosswalkCalls = new Map(); // "<crosswalk id>:<vehicle id>" -> { owed, counted }: one stopped at it
    this.crosswalkStop = null; // the marked crosswalk the car has stood still at (sim/crosswalk.js)
    this.inBox = null; // the signal's junction the car is in, whether it had room past it, and since when
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
    // the time of day school and playground zones go by (sim/speed-zones.js): { hour, sun_deg }, or
    // null, when no zone is in effect (the seeded benchmark)
    this.clock = null;
    this.violations = {
      collisions: 0,
      collisions_at_fault: 0,
      red_lights_run: 0,
      stop_signs_run: 0,
      failed_to_yield: 0,
      off_road_s: 0,
      safety_brakes: 0,
      fallbacks: 0,
      deadlock_overrides: 0,
      ...FEATURE_INITIAL_COUNTERS,
    };
    this.events = []; // transient per-step events for the UI
    this.lastRoad = null;
    this.lastSignal = null;
    this.arrowCheck = null; // the left arrow the car crossed the line on: which way did it go?
    this.spawnEgo();
    buildFeatures(this, features, seed, map, "afterSpawn");
    this.crowd = new Crowd(this, { seed, count: pedestrians });
    this.stepOuts = new StepOuts(this, { count: this.hazards ? stepOuts : 0, seed });
    buildFeatures(this, features, seed, map);
  }

  // Dynamic/roadside objects near (x, y). Buildings use a separate footprint index so traffic
  // controllers do not mistake a large building's center for a vehicle in their lane.
  obstaclesNear(x, y, r) {
    // (a vehicle by its reference point, its rear axle: a long one's front is up to its length away)
    const out = this.npcs.filter((n) => {
      const m = r + Math.max(5, n.spec?.length || 0);
      return Math.abs(n.x - x) < m && Math.abs(n.y - y) < m;
    });
    let obstacles = out.concat(this.parked.near(x, y, r), this.parked.doorsNear(x, y, r), this.crowd.near(x, y, r));
    for (const near of OBSTACLES_NEAR) {
      const more = near(this, x, y, r);
      if (more) obstacles = obstacles.concat(more);
    }
    return obstacles;
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
    const enhanced = VISION_RANGE.some((extend) => extend(this, observer));
    if (!(enhanced ? this.visibility.sees(observer, o, reach, true) : this.visibility.sees(observer, o, reach)))
      return false;
    // (what a registered feature hides from the car: a high snowbank at a corner, say, hides people,
    // cyclists and cars behind it)
    for (const hides of HIDES) if (hides(this, observer, o)) return false;
    const visible = featureObstacle(o)?.visible;
    if (visible) return visible(this, observer, o);
    if (o.kind === "pedestrian")
      return !hiddenByTraffic(observer, o, this.npcs, this.hazards ? standingNear(this, observer, o) : []);
    return !(this.hazards && hideable(o) && hiddenVehicle(this, observer, o, reach));
  }

  // Middle of a long residential edge near the map center, facing along it.
  spawnEgo() {
    const [x0, y0, x1, y1] = this.map.extent;
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2,
      span = Math.min(x1 - x0, y1 - y0) / 2;
    let best = null;
    for (const e of this.map.edges.values()) {
      const mid = e.pts[Math.floor(e.pts.length / 2)];
      const inside = mid[0] > x0 && mid[0] < x1 && mid[1] > y0 && mid[1] < y1;
      if (!inside) continue;
      const centrality = 1 - Math.min(1, Math.hypot(mid[0] - cx, mid[1] - cy) / span);
      const score =
        Math.min(e.length, 200) * (e.cls === "residential" ? 1.2 : 1) * (e.control ? 0.8 : 1) * (0.4 + centrality);
      if (!best || score > best.score) best = { e, score };
    }
    const lane = this.map.lane(best.e.id, best.e.lanes - 1);
    this.placeOnLane(lane, lane.length / 2);
  }

  placeOnLane(lane, s) {
    const { pointAt, headingAt } = lanePoint(lane, s);
    this.ego.x = pointAt[0];
    this.ego.y = pointAt[1];
    this.ego.psi = headingAt;
    this.ego.v = 0;
    this.ego.delta = 0;
    this.ego.a = 0;
    for (const place of PLACE_EGO) place(this, lane);
    this.egoStop.reset();
    this.allWay.forget(this.ego);
    this.resetContactHistory();
  }

  resetToLane() {
    const near = this.map.nearestLane(this.ego.x, this.ego.y, this.ego.psi, 80);
    if (near) {
      this.ego.x = near.point[0];
      this.ego.y = near.point[1];
      this.ego.psi = near.heading;
      this.ego.v = 0;
      this.ego.delta = 0;
      this.ego.a = 0;
      for (const place of PLACE_EGO) place(this, near.lane);
      this.resetContactHistory();
    }
    this.events.push({ type: "reset" });
  }

  phase(intersectionId) {
    return phaseOf(this.map.intersections.get(intersectionId), this.t);
  }
  // The light for one movement through a signal: from the approach `edgeId`, turning `turn`
  // including a movement-specific signal or a temporary signal state supplied by a feature.
  light(intersectionId, edgeId, turn = "straight") {
    const direction = controlDirection(this, this.ego, edgeId);
    if (direction) return direction === "go" ? "green" : "red";
    const override = alternateSignal(this, intersectionId);
    if (override) return override;
    const inter = this.map.intersections.get(intersectionId);
    const special = specialSignalPhase(inter, this)?.[this.map.edges.get(edgeId)?.control?.group];
    if (special) return special;
    if (!inter?.plan?.advance) return this.phase(intersectionId)[this.map.edges.get(edgeId)?.control?.group];
    return movementSignal(approachPhase(inter, edgeId, this.t), turn);
  }

  resetContactHistory() {
    this.ego.vy = 0;
    this.ego.r = 0;
    this.ego.ax = 0;
    this.ego.latAccel = 0;
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
    this.inBox = null;
    for (const reset of RESET_CONTACT) reset(this);
    for (const f of FEATURES) if (f.calls) this[f.calls]?.clear();
    // (moved by hand: whatever space it was going for, or parked in, is let go)
    for (const p of [this.park, this.parkedIn])
      for (const slot of p?.slots || []) if (slot.reserved?.owner === this.ego) slot.reserved = null;
    this.park = null;
    this.parking = null;
    this.parkHold = 0;
    this.parkedIn = null;
    this.kerbContact = false;
    this.crosswalkCalls.clear();
    this.crosswalkYields?.clear();
    this.crosswalkStop = null;
    this._cwFront = null;
  }

  auditStatic(dt) {
    const hit = this.staticObstacles.sweep(
      this._previousStaticPose || poseOf(this.ego),
      poseOf(this.ego),
      this.ego.spec,
    );
    if (hit) {
      const { obstacle, safePose } = hit;
      if (!this.staticContacts.has(obstacle.id)) {
        this.violations.collisions++;
        this.violations.collisions_at_fault++;
        this.events.push({
          type: "collision",
          with: obstacle.id,
          kind: obstacle.kind,
          fault: "ego",
          at_fault: true,
          t: Math.round(this.t * 10) / 10,
          ego_v: Math.round(this.ego.v * 10) / 10,
          other_v: 0,
        });
      }
      this.staticContacts.set(obstacle.id, 0);
      Object.assign(this.ego, safePose, { v: 0, a: 0, vy: 0, r: 0, ax: 0, latAccel: 0 });
    }
    // Keep a small contact skin after resolving the wall; throttle against it remains one
    // incident. A full second physically clear of that footprint permits another incident.
    const near = new Set(
      this.staticContacts.size ? this.staticObstacles.overlaps(this.ego.obb(), 0.1).map((o) => o.id) : [],
    );
    for (const [id, clearFor] of this.staticContacts) {
      if (near.has(id) || hit?.obstacle.id === id) this.staticContacts.set(id, 0);
      else if (clearFor + dt > 1) this.staticContacts.delete(id);
      else this.staticContacts.set(id, clearFor + dt);
    }
    this._previousStaticPose = poseOf(this.ego);
    return !!hit;
  }

  // Keep extra clock fields only while a registered feature uses them.
  setClock(clock) {
    this.clock = clock
      ? {
          hour: clock.hour,
          sun_deg: clock.sun_deg,
          ...(clock.weekday !== undefined ? { weekday: clock.weekday } : {}),
          ...(featureNeedsDay(this) && clock.day !== undefined ? { day: clock.day } : {}),
          ...(featureNeedsUtcOffset(this) && clock.utc_offset !== undefined ? { utc_offset: clock.utc_offset } : {}),
        }
      : null;
  }

  // Where the ego is relative to the road network (cached per tick). `limit` is the street's, or a
  // school or playground zone's while it is in effect there (`zone`).
  roadInfo() {
    const rd = surfaceDistance(this.map, this.ego.x, this.ego.y);
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
    // A key gives all or nothing (true, or 1); a gamepad's stick and triggers or the touch controls
    // (ui/gamepad.js, ui/touch.js) give any amount from 0 to 1, which scales the same demand.
    const amount = (v) => Math.min(1, Math.max(0, Number(v) || 0));
    const throttle = amount(input.throttle),
      brake = amount(input.brake);
    let accel = 0;
    if (throttle) accel = this.ego.spec.maxAccel * throttle;
    if (brake) accel = this.ego.v > 0.2 ? -6 * brake : -1.5 * brake; // brake, then gently reverse
    if (input.hardBrake) accel = -this.ego.spec.maxBrake;
    // Keys are binary, unlike a steering wheel. Limit their angle at speed to a comfortable
    // cornering demand, then ramp it so a tap does not ask for full lock in a fast bend.
    const maxAngle = Math.min(
      this.ego.spec.maxSteer,
      Math.atan((3.2 * this.ego.spec.wheelbase) / Math.max(1, this.ego.v ** 2)),
    );
    const desired = (amount(input.left) - amount(input.right)) * maxAngle;
    const steer = this.ego.delta + Math.max(-0.8 * dt, Math.min(0.8 * dt, desired - this.ego.delta));
    if (brake && this.ego.v <= 0.2 && !input.hardBrake) {
      this.ego.step(dt, { steer, accel: -1.5 * brake, reverse: true });
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
    for (const audit of AUDIT_BEFORE_COLLISIONS) audit(this, dt);
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
        // (or what a registered feature counts as one, a goose: the car is at fault for one it drives into)
        const fault = backedInto
          ? "ego"
          : n.kind === "pedestrian" || featureObstacle(n)?.likePedestrian
            ? this.ego.v < 0.5
              ? "other"
              : "ego"
            : this.ego.v < 0.5 || egoCenterAhead < -1
              ? "other"
              : egoCenterAhead > 0 && (relHeading < Math.PI / 4 || n.v < 0.5)
                ? "ego"
                : "shared";
        const atFault = fault === "ego";
        this.violations.collisions++;
        if (atFault) this.violations.collisions_at_fault++;
        this.events.push({
          type: "collision",
          with: n.id,
          kind: n.kind || "car",
          fault,
          at_fault: atFault,
          t: Math.round(this.t * 10) / 10,
          ego_v: Math.round(this.ego.v * 10) / 10,
          other_v: Math.round(n.v * 10) / 10,
          other_ahead: Math.round(egoCenterAhead * 10) / 10,
          other_right: Math.round(rel.right * 10) / 10,
          relative_heading_deg: Math.round((wrap(n.psi - this.ego.psi) * 180) / Math.PI),
        });
        this.ego.v = 0;
        this.ego.a = 0;
        n.v = 0;
        n.a = 0;
        n.frozen = 3;
      }
      if (touching) {
        n.contact = true;
        n.clearFor = 0;
      } else if (n.contact && (n.clearFor = (n.clearFor || 0) + dt) > 1) n.contact = false;
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
    const followsRoute =
      routeProjection &&
      routeProjection.distance < AUDIT_ROUTE_CORRIDOR_M &&
      Math.abs(wrap(this.ego.psi - routeProjection.heading)) < AUDIT_ROUTE_HEADING_RAD;
    const frontS = routeProjection ? routeProjection.s + FRONT : null;
    // (a junction without a sign has nothing more to check once the car has crossed its line, so
    // it does not hide a signal or a stop just beyond it)
    const rc = followsRoute
      ? this.route.controls.find(
          (c) =>
            c.sRoute + 12 >= frontS &&
            c.sRoute - frontS <= 80 &&
            !(c.control.type === "uncontrolled" && frontS > c.sRoute + PASSED_M),
        )
      : null;
    // stopped where it looks from to give way (see brain/sensors.js), remembered until the car is
    // well past that junction
    const looked =
      followsRoute && Math.abs(this.ego.v) < 0.2
        ? this.route.controls.find(
            (c) => Number.isFinite(c.sPeek) && frontS >= c.sPeek - PEEK_AT_M && frontS <= c.sPeek + 1,
          )
        : null;
    if (looked) {
      if (this.egoPeek !== looked.control.id) this.egoPeekAt = this.t;
      this.egoPeek = looked.control.id;
    } else if (
      !followsRoute ||
      !this.route.controls.some((c) => c.control.id === this.egoPeek && frontS <= c.sPeek + 12)
    )
      this.egoPeek = null;
    const edge = rc ? this.map.edges.get(rc.edge) : road.edge;
    const control = controlAt(
      this,
      rc ? rc.control : edge?.control || (edge ? this.map.priorityOf(edge.id) : null),
      rc ? rc.edge : edge?.id,
    );
    if (control && (rc || road.lane)) {
      // how far the front bumper is past the line: along the route when there is one, exactly as the
      // sensors measure it (a lane polyline's length differs from the centerline's on a bend), else
      // along the lane
      const past = rc ? frontS - rc.sRoute : road.s + FRONT - control.s_line;
      for (const observe of OBSERVE_CONTROL) observe(this, control, past);
      const key = rc ? `${rc.edge}:${control.id}` : `${edge.id}`;
      const crossed = past >= 0;
      const entered = this.lastRoad?.edgeId === key && !this.lastRoad.crossed && crossed;
      const handled =
        control.type === "signal" && firstHookResult(CONTROL_AUDIT, this, control, edge, rc, past, entered);
      const signalAudit =
        control.type === "signal" && !handled
          ? firstHookResult(OBSERVE_SIGNAL, this, control, edge, rc, past, crossed)
          : null;
      if (control.type === "signal" && !handled)
        for (const audit of AUDIT_SIGNAL) audit(this, control, edge, rc, past, entered);
      if (entered && handled) this.giveWay = null;
      if (entered && !handled) {
        if (control.type === "signal") {
          const arrowAudit = signalAudit?.();
          const inter = this.map.intersections.get(control.id);
          const shows = inter?.plan?.advance
            ? approachPhase(inter, rc ? rc.edge : edge.id, this.t)
            : this.phase(control.id)[control.group];
          // under a left arrow (green or turning yellow), which way it turns decides: judged once
          // it is through the junction (auditArrow)
          const arrow = shows === "arrow" || shows === "arrow_yellow";
          const state = arrow ? "green" : movementSignal(shows, "straight");
          // after a full stop, where turning right on red is allowed, which way it turns decides

          // Preserve the signs in effect at entry if their schedule changes mid-turn.
          const bannedExits = firstHookResult(SIGNED_EXITS, this, edge.id);
          const extraTurn = firstHookResult(RED_TURN_MEMORY, this, edge, bannedExits);
          const pending =
            state === "red" &&
            (this.map.rightOnRed || extraTurn) &&
            !phaseBansRedTurns(inter) &&
            inter &&
            this.egoStop.controlId === control.id &&
            this.egoStop.completed;
          const signed = bannedExits ? { bannedExits } : {};
          if (state === "red" && !pending) {
            this.violations.red_lights_run++;
            const event = { type: "red_light" };
            for (const add of RED_LIGHT_EVENT) add(event, inter);
            this.events.push(event);
          }
          this.arrowCheck =
            arrow && inter
              ? {
                  id: control.id,
                  centre: [inter.x, inter.y],
                  approach: rc ? this.route.headingAt(rc.sRoute) : this.map.headingIn(edge.id),
                  ...arrowAudit,
                  ...signed,
                  stopped: this.map.rightOnRed && this.egoStop.controlId === control.id && this.egoStop.completed,
                }
              : null;
          // the approach's heading and, on a route, the street it turns into (without one, the
          // street the car is heading into is the way it faces)
          if (inter) {
            const exit =
              rc && rc.sJunction !== null ? this.route.headingAt(Math.min(this.route.length, rc.sJunction + 15)) : null;
            const approach = rc ? this.route.headingAt(rc.sRoute) : this.map.headingIn(edge.id);
            this.lastSignal = {
              centre: [inter.x, inter.y],
              nodes: this.map.junctionNodes(inter),
              approaches: new Set(inter.approaches.map((a) => a.edge)),
              facing: approach + Math.PI,
              exit,
              counted: false,
              ...(pending
                ? {
                    rightOnRed: {
                      ...signed,
                      ...extraTurn,
                      edge: edge.id,
                      approach,
                      exit: exit ?? approach - Math.PI / 2,
                      turned: false,
                    },
                  }
                : {}),
            };
          }
        } else if (control.type === "stop" && !this.egoStop.completed) {
          this.violations.stop_signs_run++;
          this.events.push({
            type: "stop_sign",
            ...Object.assign({}, ...CONTROL_EVENT.map((fields) => fields(control))),
          });
        } else if (
          control.type === "yield" &&
          ringBusy(this.map.roundabouts.get(control.roundabout), this.map.nodes.get(edge.to), this.npcs)
        ) {
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
          const exit = Number.isFinite(rc?.sJunction)
            ? this.route.headingAt(Math.min(this.route.length, rc.sJunction + 15))
            : null;
          const approach = rc ? this.route.headingAt(rc.sRoute) : this.map.headingIn(edge.id);
          this.lastSignal = {
            centre: [node.x, node.y],
            nodes: new Set([edge.to]),
            approaches: new Set(this.map.inn.get(edge.to) || []),
            facing: approach + Math.PI,
            exit,
            counted: false,
            manualStop: !turn,
          };
        }
        // giving way: at a two-way stop, or where its street has no sign and is not the major road
        const junction = control.night_flash
          ? this.map.intersections.get(control.junction)
          : this.map.nodes.get(edge.to);
        this.giveWay =
          junction &&
          ((control.type === "stop" && !control.all_way) ||
            (control.type === "uncontrolled" && control.rule !== "major"))
            ? {
                node: junction.id ?? edge.to,
                centre: [junction.x, junction.y],
                edge: edge.id,
                to: control.type === "stop" || control.rule === "minor" ? "through traffic" : "traffic from the right",
                counted: false,
                // the traffic on its way when the car crossed its line (not a car that pulls out from
                // the curb, or turns into the street, after that: it must give way itself)
                coming: new Set(
                  this.npcs.filter(
                    (n) =>
                      n.path?.pts &&
                      !n.pull &&
                      (approachTo(this.map, n, junction.id ?? edge.to) ||
                        Math.hypot(n.x - junction.x, n.y - junction.y) < AUDIT_BOX_M),
                  ),
                ),
              }
            : null;
      }
      // (keyed on the stop itself: with or without a route, it is the same line)
      if (this.allWayCounted !== control.id) this.allWayCounted = null;
      this.lastRoad = { edgeId: key, crossed };
      const bumperToLine = -past;
      this.egoStop.update(control, bumperToLine, this.ego.v, dt);
      // Crossing an all-way stop's line, or leaving its queue past the line, without its turn is going
      // out of turn (whether or not the car could see who stopped first), wherever along the line it
      // made its stop; counted once per visit to the line.
      const missed =
        control.type === "stop" && control.all_way
          ? this.allWay.note(
              this.ego,
              control,
              edge.id,
              rc?.turn || this.ego.signal || "straight",
              bumperToLine,
              this.ego.v,
              this,
            )
          : null;
      if (missed && !this.allWayCounted) {
        this.allWayCounted = control.id;
        this.violations.failed_to_yield++;
        this.events.push({
          type: "failed_to_yield",
          to: "all-way stop",
          with: missed.id,
          ...Object.assign({}, ...CONTROL_EVENT.map((fields) => fields(control))),
        });
      }
    } else {
      this.lastRoad = edge ? { edgeId: edge.id, crossed: false } : null;
      this.allWayCounted = null;
      this.egoStop.update(null, 0, 0, dt);
    }
    this.auditOncoming();
    this.auditGiveWay();
    this.auditCyclists();
    for (const audit of AUDIT_AFTER_CYCLISTS) audit(this, road);
    for (const audit of AUDIT_BUSES) audit(this, dt);
    this.auditBox(dt, followsRoute ? frontS : null);
    this.auditArrow();
    for (const audit of AUDIT_BEFORE_MERGE) audit(this);
    for (const audit of AUDIT_AFTER_FLAGGER) audit(this);
    for (const audit of AUDIT_AFTER_ROADSIDE_VEHICLES) audit(this);
    for (const audit of AUDIT_PASSING) audit(this, road);
    for (const audit of AUDIT_AFTER_PASSING) audit(this, dt);
    for (const audit of AUDIT_AFTER_CALMING) audit(this);
    for (const audit of AUDIT_BEFORE_DRIVEWAYS) audit(this);
    for (const audit of AUDIT_AFTER_DRIVEWAYS) audit(this, frontOnPath);
    for (const audit of AUDIT_STREET_HAZARDS) audit(this);
    for (const audit of AUDIT_REAR_TRAFFIC) audit(this);
    for (const audit of AUDIT_LATE) audit(this);
    this.auditKerb();
    leftSpace(this);
  }

  // Parking or pulling out (sim/parallel-park.js), a tyre on the kerb is a kerb strike: counted once a
  // contact (a bumper reaching over it is not).
  auditKerb() {
    const law = this.parking;
    if (!law || law.phase === "done") {
      this.kerbContact = false;
      return;
    }
    const on = tyres(this.ego, this.ego.spec).some((p) => this.map.roadDistance(p[0], p[1]).distance > 0.02);
    if (on && !this.kerbContact) this.events.push({ type: "kerb_strike", reversing: reversing(law) });
    this.kerbContact = on;
  }

  // Through a junction on a left arrow: anything but a left turn (heading more than 45 deg left of
  // the approach once AUDIT_ARROW_OUT_M from its centre) went on a red, unless it was a right turn on
  // red after a full stop where that is allowed.
  auditArrow() {
    const a = this.arrowCheck,
      ego = this.ego;
    if (!a) return;
    // (on its way out: in the junction first, then that far from its centre)
    const d = Math.hypot(ego.x - a.centre[0], ego.y - a.centre[1]);
    a.inside ||= d < AUDIT_ARROW_OUT_M;
    if (!a.inside || d < AUDIT_ARROW_OUT_M) return;
    this.arrowCheck = null;
    const turned = wrap(ego.psi - a.approach);
    const exit = a.bannedExits?.length ? this.map.nearestLane(ego.x, ego.y, ego.psi, 8)?.lane.edge : null;
    if (turned > Math.PI / 4) {
      for (const audit of ARROW_EXIT_AUDIT) audit(this, a);
      return;
    }
    if (a.stopped && turned < -Math.PI / 4 && !a.bannedExits?.includes(exit)) return;
    this.violations.red_lights_run++;
    this.events.push({ type: "red_light", arrow: true });
  }

  // (see AUDIT_BOX_MOVING_MPS) `frontS`: the car's front along its route, or null off it.
  auditBox(dt, frontS) {
    const ego = this.ego,
      route = this.route;
    if (frontS === null || !route) {
      this.inBox = null;
      return;
    }
    const ahead = routeBoxAhead(this.map, route, frontS, ego.v);
    const key = ahead ? `${ahead.c.control.id}:${Math.round(ahead.line)}` : null;
    // (entering the junction, its front past the near side of the street across: was there room
    // past it?)
    if (ahead && ahead.toNear <= 0 && this.inBox?.key !== key) {
      this.inBox = {
        key,
        id: ahead.c.control.id,
        edge: ahead.c.edge,
        turn: ahead.c.turn || "straight",
        line: ahead.line,
        near: ahead.near,
        far: ahead.far,
        since: this.t,
        still: 0,
        counted: false,
        noRoom: !!boxBlocker(route.pts, route.cum, ahead.line, ahead.far, ego.spec, this.npcs, ego),
      };
    }
    const box = this.inBox;
    if (!box) return;
    // (out of it: all of the car past its far side, or backed out of it)
    if (frontS - ego.spec.length > box.far || frontS < box.near - 2) {
      this.inBox = null;
      return;
    }
    box.still = Math.abs(ego.v) < 0.3 ? box.still + dt : 0;
    box.blocked = !!boxBlocker(route.pts, route.cum, box.line, box.far, ego.spec, this.npcs, ego);
    if (
      box.noRoom &&
      !box.counted &&
      Math.abs(ego.v) < AUDIT_BOX_MOVING_MPS &&
      this.light(box.id, box.edge, box.turn) === "red"
    ) {
      box.counted = true;
      this.violations.failed_to_yield++;
      this.events.push({ type: "failed_to_yield", to: "cross traffic", junction: box.id, blocking: true });
    }
  }

  auditCrosswalkPass() {
    const ego = this.ego,
      f = ego.front,
      prev = this._cwFront;
    this._cwFront = f;
    for (const cw of this.crowd.marked) {
      if (Math.abs(cw.ends[1][0] - ego.x) > 70 || Math.abs(cw.ends[1][1] - ego.y) > 70) continue;
      const d = frontTo(cw, ego);
      if (d === null || d < -3 || d > 60) continue;
      // (decided when the car first sees the vehicle stopped there, while it is still behind it)
      for (const n of stoppedAt(this, cw, ego)) {
        const key = `${cw.id}:${n.id}`;
        if (!this.crosswalkCalls.has(key) && this.visibility.sees(ego, n))
          this.crosswalkCalls.set(key, { owed: canStopShort(ego.v, d), counted: false });
      }
      if (
        !prev ||
        d > 0 ||
        ego.v <= AUDIT_CROSSWALK_MOVING_MPS ||
        looked(this, cw) ||
        !segIntersect(prev, f, cw.ends[1], cw.ends[-1])
      )
        continue;
      // (the vehicle is beside the car now, so no longer ahead of it)
      for (const n of stoppedAt(this, cw, ego, this.npcs, false)) {
        const rec = this.crosswalkCalls.get(`${cw.id}:${n.id}`);
        if (!rec?.owed || rec.counted) continue;
        rec.counted = true;
        this.violations.failed_to_yield++;
        this.events.push({ type: "failed_to_yield", to: "vehicle stopped at a crosswalk", with: n.id });
      }
    }
    if (this.crosswalkCalls.size > 40)
      for (const key of [...this.crosswalkCalls.keys()].slice(0, 20)) this.crosswalkCalls.delete(key);
  }

  auditCyclists() {
    const ego = this.ego,
      FRONT = ego.spec.length - ego.spec.rearOverhang;
    const fx = ego.x + Math.cos(ego.psi) * FRONT,
      fy = ego.y + Math.sin(ego.psi) * FRONT;
    for (const n of this.npcs) {
      if (n.kind !== "bike" || !n.path?.pts || Math.abs(n.x - ego.x) > 40 || Math.abs(n.y - ego.y) > 40) continue;
      const local = ego.toLocal(n.x, n.y),
        spec = n.spec || CAR;
      if (
        Math.abs(wrap(n.psi - ego.psi)) < Math.PI / 6 &&
        local.right > (ego.spec.width + spec.width) / 2 + 0.1 &&
        local.ahead > -30 &&
        local.ahead < ego.spec.length + 5
      )
        this.besideRight.set(n.id, this.t);
      const seen = this.besideRight.get(n.id),
        counted = this.hookCounted.get(n.id);
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
    const fx = this.ego.x + Math.cos(this.ego.psi) * FRONT,
      fy = this.ego.y + Math.sin(this.ego.psi) * FRONT;
    const [jx, jy] = g.centre;
    if (Math.hypot(fx - jx, fy - jy) > AUDIT_JUNCTION_M) {
      this.giveWay = null;
      return;
    }
    if (g.counted) return;
    const due = this.npcs.find((n) => {
      if (n.v < 1 || !n.path?.pts || !g.coming.has(n)) return false;
      // the street it comes in on, from its plan: on its way to the junction, or in it
      const a = approachTo(this.map, n, g.node);
      const inside =
        !a && Math.hypot(n.x - jx, n.y - jy) < AUDIT_BOX_M
          ? n.path.edges.find(
              (e) =>
                (e.to === g.node || this.map.intersections.get(g.node)?.approaches.some((a) => a.edge === e.id)) &&
                e.sEnd > n.path.s - AUDIT_BOX_M,
            )
          : null;
      const from = a ? a.edge : inside?.id;
      if (!from || !outranks(this.map, from, g.edge, this)) return false;
      if (a && a.to_node_m / n.v >= AUDIT_ONCOMING_S) return false;
      const p = frontOnPath(this.ego, n, fx, fy);
      // (wholly short of its street's asphalt, in and out of the junction, waiting where it stops to look
      // say, the car has given way, even as traffic keeping to the kerb, round a pothole say, passes within
      // half the two widths of its front)
      const next = n.path.edges[n.path.edges.findIndex((e) => e.id === from) + 1];
      const clear =
        !!next &&
        clearOf(this.ego, this.map.edges.get(from), false) &&
        clearOf(this.ego, this.map.edges.get(next.id), true);
      return !!p && !(p.along && p.ahead_m / n.v >= AUDIT_ONCOMING_S) && !clear;
    });
    if (due) {
      g.counted = true;
      this.violations.failed_to_yield++;
      // (with hidden traffic, sim/hidden-traffic.js: whether another vehicle hid it from the car as it pulled out)
      this.events.push({
        type: "failed_to_yield",
        to: g.to,
        with: due.id,
        ...(this.hiddenByVehicle(due) ? { unseen: true } : {}),
      });
    }
  }

  auditOncoming() {
    const j = this.lastSignal;
    if (!j) return;
    // Turning round in a dead end off this junction, the car has finished its turn here: it comes
    // back out as a new approach.
    if (this.turnaround && this.turnaround.phase !== "stuck") {
      this.lastSignal = null;
      return;
    }
    const FRONT = this.ego.spec.length - this.ego.spec.rearOverhang;
    const fx = this.ego.x + Math.cos(this.ego.psi) * FRONT,
      fy = this.ego.y + Math.sin(this.ego.psi) * FRONT;
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
      const at = this.map.nearestLane(fx, fy, this.ego.psi, 8),
        on = at?.lane.edgeRef;
      if (
        on &&
        on.id !== rtor.edge &&
        on.id !== rtor.via?.id &&
        Math.abs(wrap(at.heading - this.ego.psi)) <= Math.PI / 3
      ) {
        const extraTurn = firstHookResult(RED_TURN_EXIT, this, rtor, on);
        const legalRight =
          this.map.rightOnRed &&
          !rtor.bannedExits?.includes(on.id) &&
          this.map.classifyTurn(this.map.turnAngle(rtor.edge, on.id)) === "right";
        if ((legalRight || extraTurn) && (j.nodes.has(on.from) || on.from === this.map.edges.get(rtor.edge)?.to)) {
          rtor.via = on;
          if (extraTurn) extraTurn();
        } else rtor.via = rtor.via && on.from === rtor.via.to ? on : null;
      }
      if ((out > AUDIT_RTOR_OUT_M && past > 0) || out > AUDIT_JUNCTION_M) {
        if (on && on.id === rtor.via?.id) {
          if (out > AUDIT_JUNCTION_M) rtor.turned = true;
        } else {
          this.violations.red_lights_run++;
          this.events.push({ type: "red_light" });
          j.rightOnRed = null;
        }
      }
    }
    if (Math.hypot(fx - jx, fy - jy) > AUDIT_JUNCTION_M) {
      this.lastSignal = null;
      return;
    }
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
    const facing = j.rightOnRed ? j.rightOnRed.exit : j.facing,
      down = j.rightOnRed ? null : (j.exit ?? this.ego.psi) + Math.PI;
    const due = this.npcs.find((n) => {
      const rel = Math.abs(wrap(n.psi - facing)),
        path = n.path?.pts ? n.path : null;
      if (n.v < 1 || (down !== null && Math.abs(wrap(n.psi - down)) < rel)) return false;
      // without a route, a vehicle signalling a left turn is taken to be turning (see below)
      if (!path && n.signal === "left" && !j.rightOnRed) return false;
      // turning right on red, one that came the same way as the car is following it, not crossing
      if (j.rightOnRed && path?.edges.some((e) => e.id === j.rightOnRed.edge)) return false;
      const ux = Math.cos(n.psi),
        uy = Math.sin(n.psi),
        dx = jx - n.x,
        dy = jy - n.y,
        d = Math.hypot(dx, dy);
      const closing = (dx * ux + dy * uy) / Math.max(d, 1e-6),
        inBox = d < AUDIT_BOX_M;
      // turning right on red, traffic from the left already through the junction, still within
      // 15 m of its centre down the street the car turns into, can still be cut off (the check
      // along its path below)
      const through = j.rightOnRed && path && rel < Math.PI / 6 && closing <= 0 && d < AUDIT_RTOR_OUT_M;
      if (!through && !(rel < Math.PI / 3 && closing > 0) && !(inBox && rel < (Math.PI * 7) / 12 && closing > -0.5))
        return false;
      if (!inBox && !through && d / n.v >= AUDIT_ONCOMING_S) return false;
      // braking to stop short of the junction (for its own light, say)
      if (!inBox && !through && n.a < -0.5 && (n.v * n.v) / (-2 * n.a) < d - 6) return false;
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
      const ax = fx - n.x,
        ay = fy - n.y;
      return ax * ux + ay * uy > 0 && Math.abs(ax * uy - ay * ux) < reach;
    });
    if (due) {
      j.counted = true;
      this.violations.failed_to_yield++;
      this.events.push({
        type: "failed_to_yield",
        to: j.rightOnRed ? "cross traffic" : "oncoming traffic",
        with: due.id,
        ...(this.hiddenByVehicle(due) ? { unseen: true } : {}),
      });
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
  const r = [q[0] - p[0], q[1] - p[1]],
    s = [b[0] - a[0], b[1] - a[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const w = [a[0] - p[0], a[1] - p[1]];
  const t = (w[0] * s[1] - w[1] * s[0]) / den,
    u = (w[0] * r[1] - w[1] * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

export function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

function lanePoint(lane, s) {
  const cum = lane.cum,
    pts = lane.pts;
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
  const path = n.path,
    reach = (ego.spec.width + (n.spec || CAR).width) / 2;
  const own = nearestOnPath(path, n.x, n.y, path.s - 2, path.s + 2),
    p = nearestOnPath(path, fx, fy, path.s, path.s + AUDIT_PATH_M);
  const beside = own ? own.lateral : 0;
  if (!p || !(p.s > path.s) || Math.abs(p.lateral - beside) >= reach || p.distance >= reach + Math.abs(beside))
    return null;
  return {
    s: p.s,
    ahead_m: p.s - path.s,
    along: Math.abs(wrap(ego.psi - headingAt(path.pts, path.cum, p.s))) < Math.PI / 6,
  };
}

// Whether every corner of a vehicle's body is beyond the same edge of a street's asphalt, taking the
// street as the line of its first stretch (out of a junction) or its last (into one).
function clearOf(v, edge, first) {
  const pts = edge?.pts;
  if (!pts || pts.length < 2 || !edge.asphalt) return false;
  const [[ax, ay], [bx, by]] = first ? pts : pts.slice(-2),
    dx = bx - ax,
    dy = by - ay,
    len = Math.hypot(dx, dy);
  if (len < 1e-6) return false;
  const c = Math.cos(v.psi),
    s = Math.sin(v.psi),
    half = v.spec.width / 2;
  const lat = [v.spec.length - v.spec.rearOverhang, -v.spec.rearOverhang].flatMap((f) =>
    [half, -half].map((w) => ((v.x + c * f + s * w - ax) * dy - (v.y + s * f - c * w - ay) * dx) / len),
  );
  return lat.every((l) => l < edge.asphalt[0]) || lat.every((l) => l > edge.asphalt[1]);
}

// The closest point to (x, y) on the stretch of a path between arc lengths s0 and s1 (searching
// only there, so a path that loops back past the same spot later is not mistaken for it): its arc
// length, distance and signed lateral offset (right of travel positive).
function nearestOnPath(path, x, y, s0, s1) {
  const { pts, cum } = path;
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    if (cum[i + 1] < s0 || cum[i] > s1) continue;
    const [ax, ay] = pts[i],
      dx = pts[i + 1][0] - ax,
      dy = pts[i + 1][1] - ay,
      len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const t = Math.max(
      (s0 - cum[i]) / len,
      0,
      Math.min(1, (s1 - cum[i]) / len, ((x - ax) * dx + (y - ay) * dy) / (len * len)),
    );
    const qx = ax + dx * t,
      qy = ay + dy * t,
      d = Math.hypot(x - qx, y - qy);
    if (!best || d < best.distance)
      best = { s: cum[i] + t * len, distance: d, lateral: ((x - qx) * dy - (y - qy) * dx) / len };
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
  const { turn, at } = map.turnThrough(
    path.edges.map((e) => e.id),
    k,
    nodes,
  );
  return turn === "left" || turn === "uturn" ? path.edges[at].sStart : null;
}
