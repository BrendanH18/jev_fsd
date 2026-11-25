// Registry migration checks. Run captures in each source tree with the same loopback server.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { benchPage, jsonDifferences } from "./cli_tools.mjs";

const TIMINGS = new Set(["wall_ms", "latency_ms", "latency_p50_ms", "latency_p95_ms", "started_at"]);
const REQUIRED = ["bare-dry.json", "city-dry.json", "arena-rules.json", "arena-cautious.json", "system-prompt.json"];
const read = (path) => JSON.parse(readFileSync(path, "utf8"), (key, value) => (TIMINGS.has(key) ? undefined : value));

function bench(dir, features, map = "kitsilano", conditions = "dry") {
  if (!["bare", "city"].includes(features)) throw new Error("Choose bare or city for the benchmark.");
  if (![map, conditions].every((value) => /^[a-z_]+$/.test(value))) throw new Error("Choose a named map and weather.");
  const name = map === "kitsilano" ? features : `${map}-${features}`;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-default-type=module",
      "scripts/bench_node.mjs",
      "--brain",
      "rules",
      "--map",
      map,
      "--seed",
      "1",
      "--features",
      features,
      "--weather",
      conditions,
      "--json",
      join(dir, `${name}-${conditions}.json`),
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`bench_node.mjs failed (${result.signal ?? result.status})`);
}

async function arena(dir, brain) {
  if (!["rules", "cautious"].includes(brain)) throw new Error("Choose rules or cautious for the arena.");
  const { base, page } = await benchPage(process.env.PORT ?? "8331");
  const token = page.match(/name="jev-csrf" content="([^"]+)"/)?.[1] || "";
  globalThis.document = { querySelector: (selector) => (selector.includes("jev-csrf") ? { content: token } : null) };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (path, opts) => nativeFetch(new URL(path, base), { ...opts, redirect: "error" });
  const { CHALLENGES } = await import("../static/js/lab/challenges.js");
  const { ROAD_TESTS } = await import("../static/js/lab/road-tests.js");
  const { evaluateChallenge } = await import("../static/js/lab/evaluation.js");
  const { load } = await import("./drive_lab_maps.mjs");
  const drives = [];
  for (const challenge of [...CHALLENGES, ...ROAD_TESTS]) {
    const result = await evaluateChallenge(load(challenge.map), challenge, { brain });
    if (result.simulation_error) throw new Error(`${brain}/${challenge.id}: ${result.simulation_error}`);
    drives.push(result);
  }
  writeFileSync(join(dir, `arena-${brain}.json`), JSON.stringify(drives));
  console.log(`Arena (${brain}): ${drives.filter((r) => r.pass).length}/${drives.length} pass`);
}

async function prompt(dir) {
  globalThis.document = { querySelector: () => null };
  const { SYSTEM_PROMPT, OPEN_SYSTEM_PROMPT } = await import("../static/js/brain/llm-prompt.js");
  writeFileSync(join(dir, "system-prompt.json"), JSON.stringify({ guarded: SYSTEM_PROMPT, open: OPEN_SYSTEM_PROMPT }));
}

function compare(before, after) {
  const filenames = (dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();
  const files = filenames(before);
  if (!REQUIRED.every((file) => files.includes(file))) throw new Error("Missing a required baseline capture.");
  if (!isDeepStrictEqual(files, filenames(after))) throw new Error("Run sets differ.");
  let drift = false;
  for (const name of files) {
    const baseline = read(join(before, name));
    const result = read(join(after, name));
    if (isDeepStrictEqual(baseline, result)) {
      console.log(`${name}: identical`);
    } else {
      drift = true;
      console.error(`${name}: ${jsonDifferences(baseline, result, JSON.stringify, { limit: 12 }).join("\n")}`);
    }
  }
  if (drift) process.exitCode = 1;
}

const [mode, path, ...args] = process.argv.slice(2);
try {
  if (mode === "compare" && path && args.length === 1) compare(path, args[0]);
  else if (path && (mode === "bench" || mode === "arena" || mode === "prompt")) {
    mkdirSync(path, { recursive: true });
    if (mode === "bench") bench(path, ...args);
    else if (mode === "arena") await arena(path, ...args);
    else await prompt(path);
  } else
    throw new Error(
      "Usage: registry_parity.mjs bench DIR PRESET [MAP [WEATHER]] | arena DIR DRIVER | prompt DIR | compare BEFORE AFTER",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
// The simulation's MessageChannel keeps Node alive after the last drive.
process.exit(process.exitCode ?? 0);
