// Scores beyond pass or fail (ROADMAP 4.3): progress, comfort, margin kept and time lost, per drive and
// per driver, so two drivers that both pass can still be ranked.
//
// Pure functions of the fields a drive result already carries (bench/metrics.js `DriveMetrics.summary`,
// plus the bench scenario's `tags.length_m` when there is one). Nothing here is written into a saved
// result: scores are computed when a result is displayed or aggregated, so saved runs, arena exports and
// model recordings keep their shapes, and every earlier record can be scored the same way.
//
// Per drive (`driveScores`):
//   progress    fraction of the route covered, 0 to 1: 1 when the car arrived, else the result's
//               `progress` (the furthest point reached along the route, measured on the route the car
//               was following at the end; a road-closure detour therefore under-reports it).
//   length_m    the route's planned length in metres: the bench scenario's `tags.length_m`, else (arena
//               results, which do not record it) `distance_m`, the distance actually driven.
//   time_lost_s seconds beyond the time to cover the progress made at REFERENCE_KMH (50 km/h, the
//               Canadian urban default limit): max(0, time_s - progress * length_m / 13.89). It counts
//               every stop, red lights included; it is a measure for comparing drivers on the same routes,
//               not a judgement that the time was avoidable.
//   time_lost_s_per_km  time_lost_s over the route's kilometres.
//   pace        0 to 100: 100 * min(1, (progress * length_m / 13.89) / time_s), the share of the drive's
//               time it would have needed at the reference speed.
//   comfort     0 to 100: 100 * (0.4 * J + 0.3 * B + 0.3 * Y), where each part runs linearly from 1 at a
//               comfortable value to 0 at an uncomfortable one:
//                 J  RMS jerk (m/s^3, sampled at 10 Hz):          1.0 -> 6.0
//                 B  hard brakes (below -3.5 m/s^2 for 0.2 s) per km driven: 0 -> 10
//                 Y  peak lateral acceleration (m/s^2):          2.0 -> 7.0
//   margin      0 to 100, 0 after any collision, else 100 * (0.4 * T + 0.3 * H + 0.3 * S):
//                 T  smallest time to collision with the car ahead (s): 1 -> 4 (none closing: 1)
//                 H  smallest time headway at over 2 m/s (s):          0.5 -> 2 (no leader: 1)
//                 S  safety-filter emergency brakes per km driven:      0 -> 5
//   score       0 to 100: progress * (pace + comfort + margin) / 3.
//
// Per driver (`driverScores`): the mean of each drive's progress, pace, comfort, margin and score (every
// drive weighs the same), the total time lost and the time lost per km over all the routes' kilometres
// (longer routes weigh more), and how many drives passed.
//
// Ranking (`rankDrivers`): only on the drives every driver completed (matched by scenario or challenge
// id), more passes first, then the higher mean score, then the driver's name, so the order is stable.
// The thresholds are a choice: they are documented here and in docs/rules-baseline.md, and versioned
// (SCORES_VERSION) so a later change of formula is visible.

export const SCORES_VERSION = 1;
export const REFERENCE_KMH = 50;
const REFERENCE_MPS = REFERENCE_KMH / 3.6;

// 1 at `good`, 0 at `bad`, linear between (either direction).
export const ramp = (x, good, bad) => Math.max(0, Math.min(1, (bad - x) / (bad - good)));
const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const num = (x) => (Number.isFinite(x) ? x : null);

export function comfortScore(r) {
  const km = Math.max(0.1, (r.distance_m || 0) / 1000);
  const j = ramp(num(r.rms_jerk) ?? 0, 1, 6);
  const b = ramp((r.hard_brakes || 0) / km, 0, 10);
  const y = ramp(num(r.max_lat_accel) ?? 0, 2, 7);
  return 100 * (0.4 * j + 0.3 * b + 0.3 * y);
}

export function marginScore(r) {
  if (r.collisions > 0) return 0;
  const km = Math.max(0.1, (r.distance_m || 0) / 1000);
  const t = num(r.min_ttc_s) === null ? 1 : ramp(r.min_ttc_s, 4, 1);
  const h = num(r.min_headway_s) === null ? 1 : ramp(r.min_headway_s, 2, 0.5);
  const s = ramp((r.safety_brakes || 0) / km, 0, 5);
  return 100 * (0.4 * t + 0.3 * h + 0.3 * s);
}

// A drive's raw (unrounded) numbers; driveScores rounds them for display.
function rawScores(r) {
  const progress = r.arrived ? 1 : Math.max(0, Math.min(1, num(r.progress) ?? 0));
  const length = num(r.tags?.length_m) ?? num(r.distance_m) ?? 0;
  const ideal = (progress * length) / REFERENCE_MPS;
  const time = num(r.time_s) ?? 0;
  const lost = Math.max(0, time - ideal);
  const pace = time > 0 ? 100 * Math.min(1, ideal / time) : 0;
  const comfort = comfortScore(r), margin = marginScore(r);
  return { progress, length_m: length, time_lost_s: lost, pace, comfort, margin, score: (progress * (pace + comfort + margin)) / 3 };
}

export function driveScores(r) {
  const s = rawScores(r);
  return { progress: round(s.progress, 3), pace: round(s.pace), comfort: round(s.comfort), margin: round(s.margin), score: round(s.score),
    time_lost_s: round(s.time_lost_s), time_lost_s_per_km: s.length_m > 0 ? round(s.time_lost_s / (s.length_m / 1000)) : null };
}

export function driverScores(results) {
  const raw = results.map(rawScores);
  const mean = (k, d = 1) => (raw.length ? round(raw.reduce((a, s) => a + s[k], 0) / raw.length, d) : null);
  const lost = raw.reduce((a, s) => a + s.time_lost_s, 0), km = raw.reduce((a, s) => a + s.length_m, 0) / 1000;
  return { drives: results.length, passed: results.filter((r) => r.pass).length,
    progress: mean("progress", 3), pace: mean("pace"), comfort: mean("comfort"), margin: mean("margin"), score: mean("score"),
    time_lost_s: round(lost), time_lost_s_per_km: km > 0 ? round(lost / km) : null, km: round(km, 2) };
}

const driveId = (r) => r.id ?? r.challenge;

// entries: [{ driver, results }]. Ranks the drivers on the drives they all have (by `id`, or
// `challenge` for arena results); returns those ids and, best first, each driver's scores and rank.
export function rankDrivers(entries, { key = driveId } = {}) {
  const ids = entries.length ? entries.map((e) => new Set(e.results.map(key))).reduce((a, b) => new Set([...a].filter((id) => b.has(id)))) : new Set();
  const matched = [...ids].sort();
  const ranking = entries.map((e) => ({ driver: e.driver, ...driverScores(matched.map((id) => e.results.find((r) => key(r) === id))) }))
    .sort((a, b) => b.passed - a.passed || b.score - a.score || String(a.driver).localeCompare(String(b.driver)));
  ranking.forEach((r, i) => { r.rank = i > 0 && ranking[i - 1].passed === r.passed && ranking[i - 1].score === r.score ? ranking[i - 1].rank : i + 1; });
  return { matched, ranking };
}

// "score 63.2 · progress 100% · pace 41.5 · comfort 58.0 · margin 71.3 · lost 48.2 s/km"
export function scoresText(s) {
  if (!s) return "";
  return `score ${s.score} · progress ${Math.round(s.progress * 100)}% · pace ${s.pace} · comfort ${s.comfort} · margin ${s.margin} · lost ${s.time_lost_s_per_km ?? "–"} s/km`;
}
