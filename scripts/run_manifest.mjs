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
  let commit = null;
  try {
    commit = git("rev-parse", "--verify", "HEAD").trim();
    return {
      source_commit: commit,
      source_dirty: Boolean(git("status", "--porcelain", "--untracked-files=normal", "--ignore-submodules=none")),
    };
  } catch {
    return { source_commit: commit, source_dirty: true };
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

const text = (value) => typeof value === "string" && Boolean(value.trim());
const object = (value) => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const hash = (value) => typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
const ids = (value) =>
  Array.isArray(value) && value.length > 0 && [...value].every(text) && value.length === new Set(value).size;

function checkSuite(driver, track, suite, maps) {
  if (!object(suite)) throw new Error("Run suite must be an object.");
  if (suite.kind === "arena") {
    if (!text(suite.set)) throw new Error("Arena suite needs a set name.");
    if (!object(suite.drives) || !Object.keys(suite.drives).length)
      throw new Error("Arena suite needs authored drives.");
    for (const [id, drive] of Object.entries(suite.drives)) {
      if (!text(id) || !object(drive)) throw new Error(`Invalid arena drive ${JSON.stringify(id)}.`);
      if (!text(drive.map) || !Object.hasOwn(maps, drive.map)) throw new Error(`Arena drive ${id} has an unknown map.`);
      if (!Number.isSafeInteger(drive.seed) || drive.seed < 0)
        throw new Error(`Arena drive ${id} has an invalid seed.`);
      if (!Number.isSafeInteger(drive.version) || drive.version < 1)
        throw new Error(`Arena drive ${id} has an invalid version.`);
    }
    return;
  }
  if (suite.kind !== "bench") throw new Error("Run suite kind must be arena or bench.");
  const { config, generated_ids: generated } = suite;
  if (!object(config)) throw new Error("Benchmark suite needs a config object.");
  if (config.brain !== driver) throw new Error("Benchmark config driver disagrees with the manifest.");
  if ((config.track ?? "guarded") !== track) throw new Error("Benchmark config track disagrees with the manifest.");
  if (!text(config.map) || Object.keys(maps).length !== 1 || !Object.hasOwn(maps, config.map))
    throw new Error("Benchmark manifest needs exactly the configured map.");
  if (!ids(suite.ids)) throw new Error("Benchmark suite needs unique route IDs.");
  if (!ids(generated)) throw new Error("Benchmark suite needs unique generated route IDs.");
  if (!hash(suite.route_sha)) throw new Error("Benchmark suite needs a route fingerprint.");
  if (suite.only !== undefined && typeof suite.only !== "boolean")
    throw new Error("Benchmark suite only must be a boolean.");
  const selected = new Set(suite.ids);
  const ordered = generated.filter((id) => selected.has(id));
  if (ordered.length !== selected.size || ordered.some((id, index) => id !== suite.ids[index]))
    throw new Error("Selected benchmark routes must follow the generated order.");
  if (!suite.only && selected.size !== generated.length)
    throw new Error("A complete benchmark suite needs every generated route.");
}

export function runManifest(options) {
  if (!object(options)) throw new Error("Run manifest options must be an object.");
  const { driver, model, track, suite, maps, fingerprints = {}, local = false } = options;
  if (!text(driver)) throw new Error("Run manifest needs a driver ID.");
  if (model != null && !text(model)) throw new Error("Run manifest model must be a nonempty ID.");
  if (track !== "guarded" && track !== "open") throw new Error("Run manifest track must be guarded or open.");
  if (typeof local !== "boolean") throw new Error("Run manifest local flag must be a boolean.");
  const kind = driverKind(driver);
  if (local && (kind || model != null)) throw new Error("Local drivers cannot declare model provenance.");
  if (!local && !kind && model != null) throw new Error("Built-in drivers cannot declare a model ID.");
  if (!object(maps) || !Object.keys(maps).length) throw new Error("Run manifest needs map data.");
  if (!object(fingerprints)) throw new Error("Run manifest fingerprints must be an object.");
  for (const [id, fingerprint] of Object.entries(fingerprints)) {
    if (!Object.hasOwn(maps, id)) throw new Error(`Fingerprint supplied for unknown map ${id}.`);
    if (!hash(fingerprint)) throw new Error(`Invalid fingerprint for map ${id}.`);
  }
  checkSuite(driver, track, suite, maps);
  if (local && suite.kind !== "arena") throw new Error("Local recordings support arena suites.");
  const entries = Object.entries(maps).map(([id, map]) => {
    const pack = map?.pack;
    if (!text(id) || !object(pack) || !Object.keys(pack).length) throw new Error(`Map ${id} needs a pack object.`);
    const version = pack.pack_version ?? null;
    if (version !== null && !text(version) && (!Number.isSafeInteger(version) || version < 0))
      throw new Error(`Map ${id} has an invalid pack version.`);
    if (suite.kind === "bench" && (suite.config.pack ?? null) !== version)
      throw new Error(`Benchmark map ${id} pack version disagrees with its config.`);
    return [
      id,
      {
        pack_version: version,
        fingerprint: Object.hasOwn(fingerprints, id) ? fingerprints[id] : mapFingerprint(map),
        components: Object.fromEntries(
          Object.keys(pack)
            .sort()
            .map((key) => [key, hashText(canonicalJson(pack[key]))]),
        ),
      },
    ];
  });
  return {
    format: "jev-run-manifest/2",
    suite_version: CUSTOM_SUITE,
    ...source(),
    engine: `node ${process.version}`,
    engine_version: process.versions.v8,
    driver,
    model: model ?? null,
    prompt_hash: promptHash(local ? "local" : kind, track),
    track,
    suite,
    maps: Object.fromEntries(entries),
    cost_usd: 0,
  };
}

export function runCost(results) {
  if (!Array.isArray(results)) throw new Error("Run costs require a drive results array.");
  let total = 0;
  for (const [index, result] of results.entries()) {
    if (!object(result)) throw new Error(`Drive result ${index + 1} must be an object.`);
    const cost = result.cost_usd ?? 0;
    if (!Number.isFinite(cost) || cost < 0) {
      const id = result.id ?? result.challenge ?? index + 1;
      throw new Error(`Drive ${id} cost must be a finite nonnegative number.`);
    }
    total += cost;
  }
  const microdollars = Math.round(total * 1e6);
  if (!Number.isSafeInteger(microdollars)) throw new Error("Run cost exceeds the supported range.");
  return microdollars / 1e6;
}

export function benchRunName(savedAt, driver) {
  if (
    typeof savedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(savedAt) ||
    !Number.isFinite(Date.parse(savedAt))
  )
    throw new Error("Benchmark run name needs an ISO timestamp.");
  if (typeof driver !== "string" || !/[a-z0-9]/i.test(driver))
    throw new Error("Benchmark run name needs an alphanumeric driver ID.");
  return `${savedAt.slice(0, 19).replaceAll(/[-:]/g, "").replace("T", "-")}-${driver.replaceAll(/[^a-z0-9]/gi, "")}`;
}

export const benchRouteFingerprint = (suite) => hashText(canonicalJson(suite));
