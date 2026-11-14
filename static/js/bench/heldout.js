// Held-out seeds (ROADMAP 4.4): suite seeds no fix was tuned against, reported apart from the tuned
// suites. Kitsilano holds out twelve routes from three seeds, as many as its tuned suite; every other map
// holds out two routes from one seed, as many as its tuned smoke suite. The policy is in
// docs/rules-baseline.md: never debug against a held-out result; when a held-out route fails, record it
// and reproduce the failure on a fresh tuned seed instead.
//
// The routes come from the same seeded `buildSuite` as every other suite (ids `s101-1` and so on, so
// they never collide with the tuned seeds' `s1-*`). Changing these seeds or counts starts a new
// held-out set; do it only when the old one has been looked at too closely to count as held out.

import { buildSuite } from "./scenarios.js";

export const HELDOUT = { kitsilano: { seeds: [101, 102, 103], count: 4 } };
export const HELDOUT_DEFAULT = { seeds: [101], count: 2 };

// The held-out seeds and routes per seed for a map preset id (a box or an unknown name gets the default).
export const heldoutPlan = (mapId) => HELDOUT[mapId] || HELDOUT_DEFAULT;

// Seeds that must never be used to tune: every held-out seed of every map.
export const HELDOUT_SEEDS = [...new Set([...Object.values(HELDOUT), HELDOUT_DEFAULT].flatMap((p) => p.seeds))].sort((a, b) => a - b);

// The held-out suite for a map: each held-out seed's routes, in seed order.
export async function buildHeldoutSuite(map, mapId, options = {}) {
  const plan = heldoutPlan(mapId), suite = [];
  for (const seed of plan.seeds) suite.push(...await buildSuite(map, { ...options, count: plan.count, seed }));
  return suite;
}
