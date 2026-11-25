export function challengeConfig(challenge) {
  return {
    version: challenge.version || 1,
    challenge: challenge.id,
    map: challenge.map,
    seed: challenge.seed,
    weather: challenge.weather,
    time: challenge.time,
    traffic: 0,
    car: "compact",
    clock: 0,
  };
}
