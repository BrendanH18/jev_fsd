// Provenance shared by the Node benchmark and arena runners.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CUSTOM_SUITE } from "../static/js/bench/suite-version.js";
import { OPEN_SYSTEM_PROMPT, SYSTEM_PROMPT } from "../static/js/brain/llm-prompt.js";
import { canonicalJson, driverKind, hashText, mapFingerprint } from "../static/js/brain/recording.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

function source() {
  try {
    return { source_commit: git("rev-parse", "HEAD").trim(), source_dirty: Boolean(git("status", "--porcelain")) };
  } catch {
    return { source_commit: null, source_dirty: true };
  }
}

function promptHash(kind, track) {
  if (kind === "llm") return hashText(track === "open" ? OPEN_SYSTEM_PROMPT : SYSTEM_PROMPT);
  if (!kind) return null;
  // Decision-model questions are built dynamically. Fingerprint the question builder and the
  // feature modules it calls for situation-specific instructions.
  const features = new URL("../static/js/sim/features/", import.meta.url);
  const files = [
    new URL("../static/js/brain/state.js", import.meta.url),
    ...readdirSync(features)
      .filter((name) => name.endsWith(".js"))
      .sort()
      .map((name) => new URL(name, features)),
  ];
  return hashText(canonicalJson(files.map((file) => readFileSync(file, "utf8"))));
}

export function runManifest({ driver, model, track, suite, maps, fingerprints = {}, local = false }) {
  return {
    format: "jev-run-manifest/2",
    suite_version: CUSTOM_SUITE,
    ...source(),
    engine: `node ${process.version}`,
    engine_version: process.versions.v8,
    driver,
    model: model ?? null,
    prompt_hash: promptHash(local ? "local" : driverKind(driver), track),
    track,
    suite,
    maps: Object.fromEntries(
      Object.entries(maps).map(([id, map]) => [
        id,
        {
          pack_version: map.pack.pack_version ?? null,
          fingerprint: fingerprints[id] ?? mapFingerprint(map),
          components: Object.fromEntries(
            Object.keys(map.pack)
              .sort()
              .map((key) => [key, hashText(canonicalJson(map.pack[key]))]),
          ),
        },
      ]),
    ),
    cost_usd: 0,
  };
}

export function runCost(results) {
  let total = 0;
  for (const result of results) {
    const cost = result.cost_usd ?? 0;
    if (!Number.isFinite(cost) || cost < 0) throw new Error("Drive cost must be a finite nonnegative number.");
    total += cost;
  }
  const microdollars = Math.round(total * 1e6);
  if (!Number.isSafeInteger(microdollars)) throw new Error("Run cost exceeds the supported range.");
  return microdollars / 1e6;
}

export function benchRunName(savedAt, driver) {
  return `${savedAt.slice(0, 19).replaceAll(/[-:]/g, "").replace("T", "-")}-${driver.replaceAll(/[^a-z0-9]/gi, "")}`;
}

export const benchRouteFingerprint = (suite) => hashText(canonicalJson(suite));
