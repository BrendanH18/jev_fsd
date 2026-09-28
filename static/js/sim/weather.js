// Weather: road grip for the car model, and how carefully everyone drives. The renderer reads the
// same preset for the sky, the fog, wet or snowy surfaces, and falling rain or snow.
//
// Grip sets ROAD.mu, which the tire model, the comfort limits (cornering and braking targets), and
// every forward-simulation use. Drivers also slow down below the limit in bad weather, the ego
// through its target speed and the traffic through its desired speed.

import { ROAD } from "./vehicle.js";

export const WEATHER = {
  dry: { label: "dry", mu: 0.9, speed: 1.0, description: "dry road" },
  rain: { label: "rain", mu: 0.55, speed: 0.88, description: "rain, wet road" },
  fog: { label: "fog", mu: 0.8, speed: 0.8, description: "fog, damp road, poor visibility" },
  snow: { label: "snow", mu: 0.25, speed: 0.62, description: "snow, packed snow on the road" },
};

export const current = { name: "dry", ...WEATHER.dry };

export function setWeather(name) {
  const w = WEATHER[name] || WEATHER.dry;
  Object.assign(current, { name: WEATHER[name] ? name : "dry" }, w);
  ROAD.mu = w.mu;
  return current;
}
