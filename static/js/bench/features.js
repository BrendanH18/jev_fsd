// Discover the free-drive switches rather than maintain a second list of enabled features.
import { freeDriveOptions } from "../sim/free-drive.js";

const queries = new Set();
const defaults = freeDriveOptions({ get(name) { queries.add(name); return null; } });
export const FEATURE_NAMES = [...new Set([...Object.keys(defaults.world).filter(k => k !== "pedestrians"), ...Object.keys(defaults.fleet)])].sort();
const disabled = new Map([...queries].map(query => [query, freeDriveOptions(new URLSearchParams({ [query]: "0" }))]));
const params = new Map(FEATURE_NAMES.map(name => [name, name === "stepOuts" ? null :
  [...queries].find(q => q === name.toLowerCase()) || [...queries].find(q =>
    ["world", "fleet"].some(group => Object.hasOwn(defaults[group], name) && disabled.get(q)[group][name] !== defaults[group][name]))]));

export function featureSubset(without, { hour, park }) {
  const query = new URLSearchParams({ park: park ? "1" : "0" });
  for (const name of without) if (params.get(name)) query.set(params.get(name), "0");
  const options = freeDriveOptions(query, { hour });
  // This dependent feature has no separate URL switch in freeDriveOptions; disabling it is safe,
  // and enabling it still always goes through the parent's free-drive policy.
  if (without.includes("stepOuts")) options.world.stepOuts = 0;
  return options;
}

export const validFeatureSet = on => !on.includes("stepOuts") || on.includes("hazards");
const cache = new Map();
// Seeded greedy binary covering array, version 1. Cover all four settings of every pair that can
// coexist in a free drive (hazards=off, stepOuts=on is impossible). Other features vary each row.
// A targeted candidate guarantees progress even if the random pool misses the last uncovered pair.
export function coveringArray(seed = 1) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("Cover seed must be a nonnegative integer.");
  if (!cache.has(seed)) {
    let state = (seed >>> 0) || 0x9e3779b9;
    const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const names = FEATURE_NAMES, n = names.length, h = names.indexOf("hazards"), s = names.indexOf("stepOuts");
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    const key = (p, a, b) => p * 4 + a * 2 + b;
    const uncovered = new Set();
    for (let p = 0; p < pairs.length; p++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const [i, j] = pairs[p];
      if ((i === h && j === s && !a && b) || (i === s && j === h && a && !b)) continue;
      uncovered.add(key(p, a, b));
    }
    const rows = [];
    while (uncovered.size) {
      let best, bestScore = -1;
      const target = uncovered.values().next().value, [i, j] = pairs[Math.floor(target / 4)];
      for (let attempt = 0; attempt < 256; attempt++) {
        const bits = names.map(() => Number(random() >= 0.5));
        if (!attempt) { bits[i] = (target % 4) >> 1; bits[j] = target % 2; }
        if (bits[s] && !bits[h]) {
          if (!attempt && ((i === s && bits[i]) || (j === s && bits[j]))) bits[h] = 1;
          else bits[s] = 0;
        }
        let score = 0;
        for (let p = 0; p < pairs.length; p++) if (uncovered.has(key(p, bits[pairs[p][0]], bits[pairs[p][1]]))) score++;
        if (score > bestScore) { best = bits; bestScore = score; }
      }
      for (let p = 0; p < pairs.length; p++) uncovered.delete(key(p, best[pairs[p][0]], best[pairs[p][1]]));
      rows.push({ id: `pairwise-v1-${seed}-${rows.length}`, without: names.filter((_, i) => !best[i]), park: !!best[names.indexOf("park")] });
    }
    cache.set(seed, rows);
  }
  return cache.get(seed).map(row => ({ ...row, without: [...row.without] }));
}
