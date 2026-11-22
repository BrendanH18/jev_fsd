// Comparisons with manual drives require every driver to be measured from the driven corridor.
export const CHALLENGE_SCORE_METHOD = "driven-corridor-v1";

export function challengeScoreInputs(metrics, hardBrakes) {
  return {
    method: CHALLENGE_SCORE_METHOD,
    arrived: metrics.arrived,
    time_s: metrics.time_s,
    progress: metrics.progress,
    distance_m: metrics.distance_m,
    rms_jerk: metrics.rms_jerk,
    hard_brakes: hardBrakes,
    max_lat_accel: metrics.max_lat_accel,
    collisions: metrics.collisions,
    safety_brakes: metrics.safety_brakes,
    min_ttc_s: metrics.min_ttc_s,
    min_headway_s: metrics.min_headway_s,
  };
}
