// Compare two captures from bench_node.mjs --trace.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";

const VERSION = 1;
const STATE_TOLERANCE = 1e-9;
const USAGE = [
  "Usage: node --experimental-default-type=module scripts/bench_trace.mjs [options] LEFT.json[.gz] RIGHT.json[.gz]",
  "  --check          exit with status 1 if traces diverge beyond tolerance, decisions, length, or result",
  "  --tolerance <N>  numeric state tolerance (default 1e-9)",
  "  --summary        include aggregate max position, heading, and speed drift across all ticks",
  "  --window <k>     include k context ticks before and after the first divergence",
  "  --help, -h       show this help",
].join("\n");

const pose = ({ x, y, psi, v }) => ({ x, y, heading: psi, speed: v });

function readTraceFile(path) {
  const raw = readFileSync(path);
  return JSON.parse(path.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8"));
}

function traceSettings(config, mapSha) {
  const { engine: _engine, ...settings } = config;
  return { settings, map_sha: mapSha };
}

export function captureTrace(config, mapSha, scenario) {
  const runtime = process.versions.bun
    ? { name: "Bun (JavaScriptCore)", version: process.versions.bun }
    : { name: "Node (V8)", version: process.version, v8: process.versions.v8 };
  const trace = { version: VERSION, runtime, inputs: { ...traceSettings(config, mapSha), scenario }, steps: [] };
  return {
    sample(world, autopilot) {
      const d = autopilot.lastDecision;
      trace.steps.push({
        ego: pose(world.ego),
        traffic: world.npcs.map((car) => ({ id: car.id, ...pose(car) })),
        decision: d
          ? { count: autopilot.totals.decisions, motion: d.motion, choice: d.chosenId, headlights: d.headlights }
          : null,
      });
    },
    write(path, result) {
      const { pass, arrived, time_s } = result;
      const text = JSON.stringify({ ...trace, result: { pass, arrived, time_s } });
      writeFileSync(path, path.endsWith(".gz") ? gzipSync(text, { level: 9 }) : text);
    },
  };
}

function difference(left, right, tolerance, path = "") {
  if (left === right) return null;
  if (typeof left === "number" && typeof right === "number" && Math.abs(left - right) <= tolerance) return null;
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    Array.isArray(left) === Array.isArray(right)
  ) {
    for (const key of Object.keys(left)) {
      const diff = difference(left[key], right[key], tolerance, path ? `${path}.${key}` : key);
      if (diff) return diff;
    }
    for (const key of Object.keys(right)) {
      if (!Object.hasOwn(left, key)) return { path: path ? `${path}.${key}` : key, left: null, right: right[key] };
    }
    return null;
  }
  return { path, left: left ?? null, right: right ?? null };
}

function emptyDriftStats() {
  return {
    maxPositionDrift: 0,
    maxPositionTick: null,
    maxHeadingDrift: 0,
    maxHeadingTick: null,
    maxSpeedDrift: 0,
    maxSpeedTick: null,
  };
}

function recordPoseDrift(stats, a, b, tick) {
  if (!a || !b) return;
  if (Number.isFinite(a.x) && Number.isFinite(b.x)) {
    const dx = a.x - b.x;
    const dy = Number.isFinite(a.y) && Number.isFinite(b.y) ? a.y - b.y : 0;
    const pos = Math.hypot(dx, dy);
    if (pos > stats.maxPositionDrift) {
      stats.maxPositionDrift = pos;
      stats.maxPositionTick = tick;
    }
  }
  if (Number.isFinite(a.heading) && Number.isFinite(b.heading)) {
    const heading = Math.abs(a.heading - b.heading);
    if (heading > stats.maxHeadingDrift) {
      stats.maxHeadingDrift = heading;
      stats.maxHeadingTick = tick;
    }
  }
  if (Number.isFinite(a.speed) && Number.isFinite(b.speed)) {
    const speed = Math.abs(a.speed - b.speed);
    if (speed > stats.maxSpeedDrift) {
      stats.maxSpeedDrift = speed;
      stats.maxSpeedTick = tick;
    }
  }
}

export function readTraceScenario(path, destination, config, mapSha) {
  const sourceFile = statSync(path);
  const destinationFile = statSync(destination, { throwIfNoEntry: false });
  if (destinationFile?.dev === sourceFile.dev && destinationFile.ino === sourceFile.ino)
    throw new Error("--trace-from and --trace need different files.");
  const trace = readTraceFile(path);
  if (trace?.version !== VERSION || typeof trace.inputs?.scenario?.id !== "string")
    throw new Error("Invalid benchmark trace.");
  const { scenario, ...settings } = trace.inputs;
  const mismatch = difference(settings, traceSettings(config, mapSha), 0);
  if (mismatch) throw new Error(`Benchmark trace inputs differ at ${mismatch.path}.`);
  return scenario;
}

export function compareTraces(left, right, { tolerance = STATE_TOLERANCE, summary = false, window = null } = {}) {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("Tolerance must be a finite nonnegative number.");
  if (window !== null && (!Number.isSafeInteger(window) || window < 0))
    throw new Error("Window must be a nonnegative integer.");
  for (const trace of [left, right]) {
    if (
      trace?.version !== VERSION ||
      typeof trace.inputs?.scenario?.id !== "string" ||
      !Array.isArray(trace.steps) ||
      !trace.steps.length ||
      typeof trace.result?.pass !== "boolean" ||
      typeof trace.result.arrived !== "boolean" ||
      !Number.isFinite(trace.result.time_s)
    )
      throw new Error("Invalid benchmark trace.");
  }
  const mismatch = difference(left.inputs, right.inputs, 0);
  if (mismatch) throw new Error(`Benchmark trace inputs differ at ${mismatch.path}.`);

  let exactState = null;
  let stateOverTolerance = null;
  let decision = null;
  const egoDrift = summary ? emptyDriftStats() : null;
  const trafficDrift = summary ? emptyDriftStats() : null;
  let ticksOverTolerance = 0;
  const shared = Math.min(left.steps.length, right.steps.length);
  for (let tick = 0; tick < shared; tick++) {
    const { decision: aDecision, ...aState } = left.steps[tick];
    const { decision: bDecision, ...bState } = right.steps[tick];
    const exact = exactState ? null : difference(aState, bState, 0);
    if (exact) exactState = { tick, ...exact };
    const state = !stateOverTolerance || summary ? difference(aState, bState, tolerance) : null;
    if (state) {
      if (!stateOverTolerance) stateOverTolerance = { tick, ...state };
      if (summary) ticksOverTolerance++;
    }
    const choice = decision ? null : difference(aDecision, bDecision, 0, "decision");
    if (choice) decision = { tick, ...choice };
    if (summary) {
      recordPoseDrift(egoDrift, aState.ego, bState.ego, tick);
      const aTraffic = Array.isArray(aState.traffic) ? aState.traffic : [];
      const bTraffic = Array.isArray(bState.traffic) ? bState.traffic : [];
      const bById = new Map(bTraffic.map((car, index) => [car?.id ?? index, car]));
      for (const [index, aCar] of aTraffic.entries()) {
        recordPoseDrift(trafficDrift, aCar, bById.get(aCar?.id ?? index), tick);
      }
    }
    if (!summary && exactState && stateOverTolerance && decision) break;
  }

  const lengthDifference =
    left.steps.length === right.steps.length
      ? null
      : { tick: shared, ended: left.steps.length === shared ? "left" : "right" };
  const result = {
    scenario: left.inputs.scenario.id,
    runtimes: [left.runtime, right.runtime],
    steps: [left.steps.length - 1, right.steps.length - 1],
    results: [left.result, right.result],
    lengthDifference,
    resultDifference: difference(left.result, right.result, 0, "result"),
    exactState,
    stateTolerance: tolerance,
    stateOverTolerance,
    decision,
  };
  if (summary) {
    result.summary = {
      sharedTicks: shared,
      ticksOverTolerance,
      ego: egoDrift,
      traffic: trafficDrift,
      maxPositionDrift: Math.max(egoDrift.maxPositionDrift, trafficDrift.maxPositionDrift),
      maxHeadingDrift: Math.max(egoDrift.maxHeadingDrift, trafficDrift.maxHeadingDrift),
      maxSpeedDrift: Math.max(egoDrift.maxSpeedDrift, trafficDrift.maxSpeedDrift),
    };
  }
  if (window !== null) {
    const anchor = Math.min(
      stateOverTolerance?.tick ?? Infinity,
      decision?.tick ?? Infinity,
      lengthDifference?.tick ?? Infinity,
    );
    if (!Number.isFinite(anchor)) {
      result.window = null;
    } else {
      const from = Math.max(0, anchor - window);
      const to = Math.min(Math.max(left.steps.length, right.steps.length) - 1, anchor + window);
      const ticks = [];
      for (let tick = from; tick <= to; tick++) {
        const leftStep = left.steps[tick] ?? null;
        const rightStep = right.steps[tick] ?? null;
        let stateDiff = null;
        let decisionDiff = null;
        if (leftStep && rightStep) {
          const { decision: aDecision, ...aState } = leftStep;
          const { decision: bDecision, ...bState } = rightStep;
          stateDiff = difference(aState, bState, tolerance);
          decisionDiff = difference(aDecision, bDecision, 0, "decision");
        }
        ticks.push({ tick, left: leftStep, right: rightStep, stateDiff, decisionDiff });
      }
      result.window = { centerTick: anchor, radius: window, ticks };
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values, positionals } = parseArgs({
      options: {
        check: { type: "boolean" },
        summary: { type: "boolean" },
        tolerance: { type: "string" },
        window: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
    if (values.help) {
      console.log(USAGE);
      process.exit(0);
    }
    if (positionals.length !== 2) throw new Error(USAGE);
    let tolerance = STATE_TOLERANCE;
    if (values.tolerance !== undefined) {
      if (!values.tolerance.trim()) throw new Error("--tolerance must be a finite nonnegative number.");
      tolerance = Number(values.tolerance);
      if (!Number.isFinite(tolerance) || tolerance < 0)
        throw new Error("--tolerance must be a finite nonnegative number.");
    }
    let window = null;
    if (values.window !== undefined) {
      if (!/^\d+$/.test(values.window)) throw new Error("--window must be a nonnegative integer.");
      window = Number(values.window);
    }
    const [left, right] = positionals.map((file) => readTraceFile(file));
    const comparison = compareTraces(left, right, { tolerance, summary: Boolean(values.summary), window });
    console.log(JSON.stringify(comparison, null, 2));
    if (
      values.check &&
      (comparison.stateOverTolerance ||
        comparison.decision ||
        comparison.lengthDifference ||
        comparison.resultDifference)
    )
      process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
