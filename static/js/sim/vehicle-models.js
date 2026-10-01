// Generic vehicles: dimensions and usable wheel power are simulation parameters, not brand claims.
import { CAR } from "./vehicle.js";

const model = (id, name, style, height, description, drive, changes) => Object.freeze({
  id, name, style, height, description, drive,
  spec: Object.freeze({ ...CAR, ...changes }),
});

export const VEHICLE_MODELS = Object.freeze([
  model("compact", "City hatch", "hatch", 1.48, "Light, nimble city car", "FWD", {
    length: 4.08, width: 1.78, wheelbase: 2.55, rearOverhang: 0.72,
    mass: 1230, yawInertia: 1900, cgToFront: 1.12, cgHeight: 0.5, track: 1.5,
    power: 65000, cdA: 0.61, maxAccel: 3.2,
  }),
  model("sedan", "Touring sedan", "sedan", 1.45, "Balanced everyday driving", "FWD", {}),
  model("sport", "Sport coupe", "sport", 1.29, "Low stance, rear-wheel drive", "RWD", {
    length: 4.42, width: 1.86, wheelbase: 2.62, rearOverhang: 0.82,
    mass: 1390, yawInertia: 2200, cgToFront: 1.29, cgHeight: 0.43, track: 1.61,
    power: 145000, cdA: 0.59, maxAccel: 5.2, driveFront: 0, maxSpeed: 55,
  }),
  model("wagon", "Estate wagon", "wagon", 1.53, "Long roof, steady touring", "AWD", {
    length: 4.78, width: 1.89, wheelbase: 2.82, rearOverhang: 1,
    mass: 1690, yawInertia: 3100, cgToFront: 1.3, cgHeight: 0.55, track: 1.61,
    power: 105000, cdA: 0.73, maxAccel: 3.5, driveFront: 0.55,
  }),
  model("suv", "Trail SUV", "suv", 1.79, "Raised cabin, greater body roll", "AWD", {
    length: 4.7, width: 1.98, wheelbase: 2.79, rearOverhang: 0.94,
    mass: 2020, yawInertia: 3550, cgToFront: 1.3, cgHeight: 0.74, track: 1.7,
    power: 120000, cdA: 0.94, maxAccel: 3.3, driveFront: 0.5,
  }),
  model("pickup", "Utility pickup", "pickup", 1.87, "Full-size cab and open load bed", "RWD", {
    length: 5.35, width: 2.04, wheelbase: 3.24, rearOverhang: 1.06,
    mass: 2280, yawInertia: 4650, cgToFront: 1.42, cgHeight: 0.8, track: 1.73,
    power: 135000, cdA: 1.13, maxAccel: 2.9, driveFront: 0,
    maxSteer: 32 * Math.PI / 180,
  }),
]);

export function getVehicleModel(id) {
  return VEHICLE_MODELS.find((m) => m.id === id) || VEHICLE_MODELS[1];
}

export const PAINT_COLORS = Object.freeze(["1f5fd6", "f2f4f5", "292d34", "a32932", "315b4d", "c4c8ce"]);
export function vehicleOptions(params) {
  const vehicle = getVehicleModel(params.get("car"));
  const requestedPaint = params.get("paint")?.toLowerCase();
  return { vehicle, paint: PAINT_COLORS.includes(requestedPaint) ? requestedPaint : PAINT_COLORS[0] };
}
