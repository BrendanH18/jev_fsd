// The frozen input definition used by the Node writers and the publication builder.
import canonical from "../data/suites/v1.json" with { type: "json" };
import { CUSTOM_SUITE } from "../static/js/bench/suite-version.js";
import { canonicalJson } from "../static/js/brain/recording.js";

export const authoredDrive = (challenge) => ({
  map: challenge.map,
  seed: challenge.seed,
  version: challenge.version || 1,
});

export function arenaSuiteVersion({ set, drives, maps }, results) {
  if (set !== "all" || canonicalJson(drives) !== canonicalJson(canonical.arena.drives)) return CUSTOM_SUITE;
  if (canonicalJson(maps) !== canonicalJson(canonical.maps)) return CUSTOM_SUITE;
  const finished = Object.fromEntries(
    results.filter((result) => !result.stopped).map((result) => [result.challenge, authoredDrive(result)]),
  );
  return results.length === Object.keys(drives).length && canonicalJson(finished) === canonicalJson(drives)
    ? canonical.version
    : CUSTOM_SUITE;
}

export function benchSuiteVersion({ config, ids, route_sha, map_sha }, results) {
  const { bench, maps } = canonical;
  if (
    !Object.entries(bench.config).every(
      ([k, v]) => config[k] === v || (config.heldout && ["count", "seed"].includes(k)),
    ) ||
    !bench.weathers.includes(config.weather) ||
    map_sha !== maps[config.map] ||
    config.park ||
    config.hour !== undefined ||
    config.cover !== undefined ||
    config.without?.length ||
    (config.track && config.track !== "guarded")
  )
    return CUSTOM_SUITE;

  const { seeds, count } = bench.heldout;
  const expected = config.heldout
    ? seeds.flatMap((seed) => Array.from({ length: count }, (_, i) => `s${seed}-${i + 1}`))
    : bench.ids;
  if (
    config.heldout
      ? config.seed !== seeds[0] ||
        config.count !== expected.length ||
        canonicalJson(config.seeds) !== canonicalJson(seeds) ||
        route_sha !== bench.heldout.route_sha
      : route_sha !== bench.route_sha
  )
    return CUSTOM_SUITE;
  return canonicalJson(ids) === canonicalJson(expected) &&
    canonicalJson(results.filter((result) => !result.stopped).map((result) => result.id)) === canonicalJson(expected)
    ? canonical.version
    : CUSTOM_SUITE;
}
