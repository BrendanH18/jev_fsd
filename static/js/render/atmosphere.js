// Sun/moon lighting and sky colors for the renderer. Ephemeris is Vancouver (~49.27 N) in late
// September local daylight time; weather overlays cloud/fog. `lighting` is shared shader uniforms.

import * as THREE from "three";

const LAT = 49.27 * Math.PI / 180;
const DECLINATION = -1.5 * Math.PI / 180;    // late September
const SOLAR_NOON_H = 13.17;                   // local daylight time

export const lighting = {
  night: { value: 0 },      // 0 in daylight, 1 once it is dark enough that street lights are on
  wet: { value: 0 },        // 0 dry, 1 soaked: puddles, shine
  time: { value: 0 },       // seconds, for anything animated in a shader (wind in the trees)
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
};

// Materials that glow after dark (lamp heads, light pools): their emissive intensity (or opacity)
// follows `lighting.night` between a day and a night value.
const nightMaterials = [];
export function glowsAtNight(material, day, night, prop = "emissiveIntensity") {
  nightMaterials.push({ material, day, night, prop });
  material[prop] = day + (night - day) * lighting.night.value;
  return material;
}
export function updateNightMaterials() {
  const k = lighting.night.value;
  for (const { material, day, night, prop } of nightMaterials) material[prop] = day + (night - day) * k;
}

// Sun direction in Three.js coordinates (x east, y up, z south) and its elevation (rad).
export function sunPosition(hour, location = null) {
  const latitude = location ? location.latitude * Math.PI / 180 : LAT;
  const solarNoon = location ? 12 + location.utcOffset - location.longitude / 15 : SOLAR_NOON_H;
  const H = (hour - solarNoon) * 15 * Math.PI / 180;   // hour angle, + in the afternoon
  const sinEl = Math.sin(latitude) * Math.sin(DECLINATION) + Math.cos(latitude) * Math.cos(DECLINATION) * Math.cos(H);
  const el = Math.asin(sinEl);
  // azimuth from north, clockwise
  const cosAz = (Math.sin(DECLINATION) - Math.sin(el) * Math.sin(latitude)) / (Math.cos(el) * Math.cos(latitude));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (H > 0) az = 2 * Math.PI - az;
  const east = Math.sin(az) * Math.cos(el), north = Math.cos(az) * Math.cos(el);
  return { dir: new THREE.Vector3(east, Math.sin(el), -north).normalize(), elevation: el, azimuth: az };
}

// Sky keyframes by sun elevation (degrees). glow is the warm band on the horizon toward the sun.
const KEYS = [
  { el: -14, zenith: 0x03050b, horizon: 0x0a0f1b, ground: 0x040507, glow: 0x000000, sun: 0x000000 },
  { el: -6, zenith: 0x0d1630, horizon: 0x2c3150, ground: 0x0d0f14, glow: 0x6b3b3a, sun: 0x000000 },
  { el: -1.5, zenith: 0x243c6c, horizon: 0x9f7f7e, ground: 0x2e2d2c, glow: 0xff7a3c, sun: 0xff5a1e },
  { el: 3, zenith: 0x35599a, horizon: 0xe8b089, ground: 0x5d5a4e, glow: 0xff9a4d, sun: 0xff9a55 },
  { el: 10, zenith: 0x3c6fb6, horizon: 0xe3cfb4, ground: 0x7c826f, glow: 0x7a4a24, sun: 0xffd29a },
  { el: 25, zenith: 0x3f79c4, horizon: 0xc9dbea, ground: 0x8d9a86, glow: 0x000000, sun: 0xfff0dc },
  { el: 90, zenith: 0x3a76c6, horizon: 0xc4d8ea, ground: 0x8d9a86, glow: 0x000000, sun: 0xfff4e6 },
];

// How the weather changes the sky: cloud cover hides the sun and greys the sky; fog closes in.
const WEATHER = {
  dry: { cloud: 0, fog: 0.0009, overcast: null, wet: 0 },
  rain: { cloud: 1, fog: 0.0065, overcast: { zenith: 0x5f6a76, horizon: 0x98a2ab, ground: 0x5d655c }, wet: 1 },
  fog: { cloud: 1, fog: 0.022, overcast: { zenith: 0xaab2b9, horizon: 0xc4c9cd, ground: 0x9aa09a }, wet: 0.4 },
  snow: { cloud: 0.9, fog: 0.007, overcast: { zenith: 0x8f9cab, horizon: 0xd3dae1, ground: 0xc9cfd6 }, wet: 0 },
};

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const col = (hex) => new THREE.Color(hex);

function keyed(elDeg) {
  let i = 0;
  while (i < KEYS.length - 2 && elDeg > KEYS[i + 1].el) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (elDeg - a.el) / (b.el - a.el)));
  const out = {};
  for (const k of ["zenith", "horizon", "ground", "glow", "sun"]) out[k] = col(a[k]).lerp(col(b[k]), t);
  return out;
}

// Everything the renderer needs for one time of day and weather.
export function atmosphereFor(hour, weather = "dry", location = null) {
  const W = WEATHER[weather] || WEATHER.dry;
  const sun = sunPosition(hour, location);
  const elDeg = sun.elevation * 180 / Math.PI;
  const sky = keyed(elDeg);
  const day = smooth(-6, 12, elDeg);                // 0 at night, 1 in full daylight
  const night = 1 - smooth(-3, 5, elDeg);           // street lights on
  const sunUp = smooth(-1, 6, elDeg);
  if (W.overcast) {
    // an overcast sky is as bright as the daylight behind it; at night it reflects the city's
    // sodium-orange glow back down, as low cloud over Vancouver does
    const k = W.cloud;
    const lum = 0.08 + 0.92 * day;
    const cityGlow = col(0x3a2a22).multiplyScalar(night * 0.9);
    for (const key of ["zenith", "horizon", "ground"]) {
      const grey = col(W.overcast[key]).multiplyScalar(lum).add(key === "zenith" ? cityGlow.clone().multiplyScalar(0.5) : cityGlow);
      sky[key].lerp(grey, k);
    }
    sky.glow.multiplyScalar(1 - k);
  }
  const cloud = W.cloud;
  // the light the sun gives, reddened and weakened near the horizon and behind cloud
  const sunIntensity = 3.2 * sunUp * (1 - 0.82 * cloud) * (0.55 + 0.45 * smooth(2, 20, elDeg));
  // moonlight: a cool, faint key light from high in the south-east when the sun is down
  const moonUp = 1 - sunUp;
  const moonDir = new THREE.Vector3(0.35, 0.72, 0.6).normalize();
  const key = sunUp > 0.02 ? { dir: sun.dir, color: sky.sun.clone(), intensity: sunIntensity }
    : { dir: moonDir, color: col(0x9db4ff), intensity: 0.35 * moonUp * (1 - 0.85 * cloud) };
  return {
    hour, weather, sun, elevationDeg: elDeg, day, night, cloud,
    sky, fogDensity: W.fog * (weather === "dry" ? 1 + night * 0.4 : 1), fogColor: sky.horizon.clone(),
    key,
    sunGlow: sunUp * (1 - cloud),
    stars: (1 - smooth(-10, -3, elDeg)) * (1 - cloud),
    hemi: { sky: sky.zenith.clone().lerp(col(0xcfe0f2), 0.6 * day).lerp(col(0x4a5a80), 0.5 * night), ground: col(0x6c7358).multiplyScalar(0.2 + 0.8 * day).lerp(col(0x3a3028), 0.6 * night), intensity: 0.12 + 0.43 * day + 0.45 * cloud * day + 0.35 * night },
    env: 0.2 + 0.35 * day + 0.25 * cloud * day,
    exposure: 1.0 + 0.3 * night - 0.05 * cloud * day,
    wet: W.wet,
    bloom: { strength: 0.22 + 0.2 * night, threshold: 1.0 },
  };
}

// Parse "17:30", "17.5", or a named preset into hours.
export const TIME_PRESETS = { dawn: 7.1, morning: 9.0, noon: 13.2, afternoon: 15.5, golden: 18.3, dusk: 19.2, night: 22.5 };
export function parseHour(value, fallback = TIME_PRESETS.afternoon) {
  if (value === null || value === undefined || value === "") return fallback;
  if (TIME_PRESETS[value] !== undefined) return TIME_PRESETS[value];
  const m = String(value).match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (m) return (+m[1] % 24) + (m[2] ? +m[2] / 60 : 0);
  const f = parseFloat(value);
  return Number.isFinite(f) ? ((f % 24) + 24) % 24 : fallback;
}
