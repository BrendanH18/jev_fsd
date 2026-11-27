// The sun's position on a date, for the sky (render/atmosphere.js) and for whatever depends on where the
// sun is (low sun glare, sim/sun-glare.js). The NOAA general solar position formulas (fractional year,
// equation of time, declination, true solar time, hour angle), without atmospheric refraction: good to a
// fraction of a degree.
const RAD = Math.PI / 180;

// "MM-DD" -> day of the year (1..365, a common year).
export function dayOfYear(date) {
  const m = String(date).match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const month = +m[1],
    day = +m[2],
    days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  return days.slice(0, month - 1).reduce((a, b) => a + b, 0) + day;
}

// The sun at local clock `hour` on `day` of the year at { latitude, longitude, utcOffset } (NOAA):
// { elevation, H (hour angle), latitude, declination } in radians, as sim/speed-zones.js sunAngles,
// and the equation of time `eot_min`.
export function solarAngles(hour, { latitude, longitude, utcOffset = null, day }) {
  const tz = Number.isFinite(utcOffset) ? utcOffset : longitude / 15;
  const g = ((2 * Math.PI) / 365) * (day - 1 + (hour - tz - 12) / 24);
  const eot =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const trueSolarMin = hour * 60 + eot + 4 * longitude - 60 * tz;
  const H = (trueSolarMin / 4 - 180) * RAD,
    lat = latitude * RAD;
  const elevation = Math.asin(
    Math.max(
      -1,
      Math.min(1, Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(H)),
    ),
  );
  return { elevation, H, latitude: lat, declination, eot_min: eot };
}
