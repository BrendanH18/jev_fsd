// School and playground zones (jev/osm/zones.py): the stretches of street beside a school or a
// playground, where the limit is 30 km/h while the zone is in effect (BC Motor Vehicle Act s. 147).
// A school zone is in effect on school days from 8:00 to 17:00 (the sim has no calendar, so every
// day is a school day), a playground zone every day from dawn to dusk: while the sun is above
// DUSK_DEG, the end of civil twilight. A zone's limit never raises a street's own.
//
// The world keeps a clock ({ hour, sun_deg }, set by the app from the time of day; null in the
// seeded benchmark, which drives no zones) and asks the map for the zone at a point along an edge.

export const ZONE_LIMIT_MPS = 30 / 3.6;
export const SCHOOL_HOURS = [8, 17];
export const DUSK_DEG = -6;
export const ZONE_NAMES = { school: "school zone", playground: "playground zone" };
export const ZONE_HOURS = { school: "8:00 to 17:00 on school days", playground: "dawn to dusk" };

// The sun in late September, as the sky draws it (render/atmosphere.js), by default in Vancouver
// (~49.27 N, solar noon at 13:10 daylight time).
const DECLINATION = -1.5 * Math.PI / 180;
const LAT = 49.27 * Math.PI / 180;
const SOLAR_NOON_H = 13.17;

// The sun's elevation (rad) at a local clock hour, and its hour angle (rad, + in the afternoon).
export function sunAngles(hour, location = null) {
  const latitude = location ? location.latitude * Math.PI / 180 : LAT;
  const solarNoon = location ? 12 + location.utcOffset - location.longitude / 15 : SOLAR_NOON_H;
  const H = (hour - solarNoon) * 15 * Math.PI / 180;
  const sinEl = Math.sin(latitude) * Math.sin(DECLINATION) + Math.cos(latitude) * Math.cos(DECLINATION) * Math.cos(H);
  return { elevation: Math.asin(sinEl), H, latitude, declination: DECLINATION };
}

// The world's clock at a local hour in a place ({ latitude, longitude, utcOffset }).
export function zoneClock(hour, location = null) {
  return { hour, sun_deg: Math.round(sunAngles(hour, location).elevation * 1800 / Math.PI) / 10 };
}

// The world's clock at a local hour on a map (MapData), the sun placed by its origin and UTC offset
// (Pacific daylight time when the map does not say).
export function mapClock(hour, map) {
  const origin = map?.pack?.origin;
  return zoneClock(hour, origin ? { latitude: origin.lat, longitude: origin.lon, utcOffset: map.utcOffset ?? -7 } : null);
}

export function inEffect(kind, clock) {
  if (!clock) return false;
  if (kind === "school") return clock.hour >= SCHOOL_HOURS[0] && clock.hour < SCHOOL_HOURS[1];
  return kind === "playground" && clock.sun_deg > DUSK_DEG;
}

// Each edge's zone stretches, { from, to, zone } in metres along its centreline, in order.
export function zoneSpans(zones, edges) {
  const out = new Map();
  for (const zone of zones) {
    for (const span of zone.spans || []) {
      if (!edges.has(span.edge)) continue;
      if (!out.has(span.edge)) out.set(span.edge, []);
      out.get(span.edge).push({ from: span.from, to: span.to, zone });
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.from - b.from);
  return out;
}

// The zone in effect at `s` metres along edge `edgeId`, or null: a school zone before a playground
// one where they overlap.
export function zoneAt(spans, edgeId, s, clock) {
  if (!clock) return null;
  let best = null;
  for (const span of spans.get(edgeId) || []) {
    if (s < span.from || s > span.to || !inEffect(span.zone.kind, clock)) continue;
    if (!best || (span.zone.kind === "school" && best.zone.kind !== "school")) best = span;
  }
  return best;
}

// A street's limit with the zone in effect, if any.
export const zoneLimit = (limit, span) => span ? Math.min(limit || ZONE_LIMIT_MPS, ZONE_LIMIT_MPS) : limit;
