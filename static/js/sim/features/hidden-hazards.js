// Hidden hazards (sim/hidden-hazards.js, sim/hidden-traffic.js, sim/blind-spot.js): with the World option
// `hazards`, vehicles standing at the kerb hide people, road vehicles hide other vehicles and cyclists,
// the driven car keeps to a speed it can stop from beside cars parked at the kerb that hide the sidewalk,
// and with `stepOuts` someone now and then steps out from between them. The core keeps the general sight
// line (World.sees: buildings, weather, darkness, moving traffic hiding a pedestrian); this record adds
// what the feature hides and the blind spot's sensing, speed, decision state and wording.
import { r1 } from "../../common.js";
import { STEP_OUT_COUNT, STEP_OUT_M, StepOuts, blindApproach, blindSpot, standingNear } from "../hidden-hazards.js";
import { hiddenVehicle, hideable, laneSight } from "../hidden-traffic.js";

// What the core's give-way, oncoming and turn-on-red checks use to see along a lane past vehicles.
const TRAFFIC_SIGHT = Object.freeze({ laneSight });

// Cars parked at the kerb that hide the sidewalk beside the car's way.
function blindClause(b) {
  const kmh = Math.round(b.limit_mps * 3.6),
    where = b.from_m > 0 ? `from ${Math.round(b.from_m)} m ahead` : "beside the car";
  return `Cars parked along the ${b.side} ${where}, ${r1(b.gap_m)} m from the car's side, hide the sidewalk${b.why === "quiet street" ? " on this quiet street" : ` in this ${b.why}`}: someone could step out from between them, unseen until they do. Keep to ${kmh} km/h beside them, a speed from which the car can stop for someone who steps out ${STEP_OUT_M} m ahead (\`car.target_speed\` already does).`;
}

export default {
  key: "hazards",
  // (set before the rest of the World is built, as the World's own option was; the step-outs draw from
  // their own random stream, so building them here changes no other draw)
  buildAt: "early",
  build(world, { enabled, seed, options }) {
    const { stepOuts = 0 } = options;
    world.stepOuts = new StepOuts(world, { count: enabled ? stepOuts : 0, seed });
    return !!enabled;
  },
  // A free drive with hidden hazards has STEP_OUT_COUNT people at a time waiting to step out.
  freeDriveExtra: (enabled) => ({ stepOuts: enabled ? STEP_OUT_COUNT : 0 }),
  checkpoint(world) {
    world.stepOuts.world = world;
  },
  snapshot: { blind_spot: null },
  stepBeforeTraffic: { at: "stepOuts", run: (world, _fleet, dt) => world.stepOuts.step(dt) },

  // World.sees: a vehicle standing at the kerb hides a pedestrian, as moving traffic does, and road vehicles
  // hide other vehicles and cyclists (World.hiddenByVehicle: one the car would see but for another's body).
  standingHides: (world, observer, ped) => (world.hazards ? standingNear(world, observer, ped) : null),
  vehicleHides: (world, observer, o, reach) => world.hazards && hideable(o) && hiddenVehicle(world, observer, o, reach),
  hiddenByVehicle: (world, observer, o) =>
    world.hazards && hideable(o) && world.visibility.sees(observer, o) && hiddenVehicle(world, observer, o),
  trafficSight: (world) => (world.hazards ? TRAFFIC_SIGHT : null),

  // Coming up beside cars parked at the kerb that hide the sidewalk.
  sense: {
    at: "blindSpots",
    run(world, snap) {
      snap.blind_spot = blindSpot(world, world.ego, snap.road);
      if (snap.blind_spot)
        snap.limit = Math.min(snap.limit, blindApproach(snap.blind_spot.limit_mps, snap.blind_spot.from_m));
    },
  },
  // Down to the speed the car can stop from for someone stepping out from between them, gently, by the
  // first of them.
  target: {
    at: "blindSpots",
    run(snap, v, reasons) {
      const bs = snap.blind_spot;
      if (!bs) return v;
      const vb = blindApproach(bs.limit_mps, bs.from_m);
      if (vb <= v + 0.05) {
        v = Math.min(v, vb);
        reasons.push(bs.from_m <= STEP_OUT_M ? "parked cars hide the sidewalk" : "parked cars ahead hide the sidewalk");
      }
      return v;
    },
  },
  hazard: {
    at: "blindSpots",
    run: (snap) => (snap.blind_spot && snap.blind_spot.from_m < STEP_OUT_M + 10 ? "blind spot" : null),
  },
  state: {
    at: "blindSpots",
    run(snap, state) {
      if (!snap.blind_spot) return;
      const b = snap.blind_spot;
      state.blind_spot = {
        side: b.side,
        ...(b.from_m > 0 ? { parked_cars_from_m: r1(b.from_m) } : { beside_car: true }),
        parked_cars_to_m: r1(Math.max(0, b.to_m)),
        clearance_m: r1(b.gap_m),
        street: b.why,
        hides: "the sidewalk: someone may step out from between the parked cars",
        stop_within_m: STEP_OUT_M,
        pass_at: r1(b.limit_mps),
      };
    },
  },
  clause: { at: "blindSpots", run: (snap) => (snap.blind_spot ? blindClause(snap.blind_spot) : null) },
  prompt: {
    at: "hiddenHazards",
    text: "- A vehicle can hide another behind it. Turning left, when `intersection.oncoming.lane_hidden_by` names a vehicle (one waiting to turn left from the other side, say), the car cannot see whether anything is coming through in the lane it hides: choose `stop_for_oncoming` and wait until it can see that the lane is clear, even when no oncoming vehicle is listed.\n- Beside cars parked at the kerb that hide the sidewalk (`blind_spot`), keep to `car.target_speed`: someone could step out from between them unseen, and the car must be able to stop for them. Prefer a candidate whose `end_speed` is at or below it.",
  },
  examinerMinors: {
    blind_spot_speeding: {
      category: "observation",
      remark: "Passed parked cars too fast to stop for someone stepping out",
    },
  },
};
