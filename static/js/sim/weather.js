// Weather: road grip for the car model, and how carefully everyone drives. The renderer reads the
// same preset for the sky, the fog, wet or snowy surfaces, and falling rain or snow.
//
// Grip sets ROAD.mu, which the tire model, the comfort limits (cornering and braking targets), and
// every forward-simulation use. Drivers also slow down below the limit in bad weather, the ego
// through its target speed and the traffic through its desired speed.

import { DRY_ROAD_MU, ROAD } from "./vehicle.js";

// mu is a dimensionless tyre friction coefficient. speed scales target speeds, and visibility is
// an unobstructed sight range in metres.
export const WEATHER = Object.freeze({
  dry: { label: "dry", mu: DRY_ROAD_MU, speed: 1.0, visibility: 80, description: "dry road" },
  rain: { label: "rain", mu: 0.55, speed: 0.88, visibility: 55, description: "rain, wet road" },
  fog: { label: "fog", mu: 0.8, speed: 0.8, visibility: 28, description: "fog, damp road, poor visibility" },
  snow: { label: "snow", mu: 0.25, speed: 0.62, visibility: 40, description: "snow, packed snow on the road" },
});
for (const preset of Object.values(WEATHER)) Object.freeze(preset);

let active = WEATHER.dry;
// Existing consumers retain this reference. Preset changes replace the backing record at once.
export const current = Object.freeze({
  get name() {
    return active.label;
  },
  get label() {
    return active.label;
  },
  get mu() {
    return active.mu;
  },
  get speed() {
    return active.speed;
  },
  get visibility() {
    return active.visibility;
  },
  get description() {
    return active.description;
  },
});

export function setWeather(name) {
  const key = typeof name === "string" ? name.trim().toLowerCase() : "";
  active = Object.hasOwn(WEATHER, key) ? WEATHER[key] : WEATHER.dry;
  ROAD.mu = active.mu;
  return current;
}
