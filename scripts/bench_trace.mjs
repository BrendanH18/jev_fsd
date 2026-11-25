// Compare two captures from bench_node.mjs --trace.
import { statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { checkFiles, readJson, writeArtifact } from "./cli_tools.mjs";

const VERSION = 1;
const STATE_TOLERANCE = 1e-9;
const USAGE = [
  "Usage: node --experimental-default-type=module scripts/bench_trace.mjs [options] LEFT.json[.gz] RIGHT.json[.gz]",
  "  --check          exit with status 1 if traces diverge beyond tolerance, decisions, length, or result",
  "  --tolerance <N>  numeric state tolerance (default 1e-9)",
  "  --summary        include aggregate max position, heading, and speed drift across all ticks",
  "  --window <k>     include k context ticks before and after the first divergence",
  "  --position-tolerance <N>  tolerance for x and y in metres",
  "  --heading-tolerance <N>   tolerance for heading in radians",
  "  --speed-tolerance <N>     tolerance for speed in metres per second",
  "  --exact                   treat every state difference as a divergence",
  "  --output <path[.gz]>      write the comparison to a file",
  "  --compact                 emit JSON without indentation",
  "  --help, -h       show this help",
].join("\n");

const pose = ({ x, y, psi, v }) => ({ x, y, heading: psi, speed: v });

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
      writeArtifact(path, text, { gzip: path.endsWith(".gz") });
    },
  };
}

function difference(left, right, tolerance, path = "") {
  if (left === right) return null;
  if (typeof left === "number" && typeof right === "number") {
    const threshold = typeof tolerance === "function" ? tolerance(path) : tolerance;
    if (Math.abs(left - right) <= threshold) return null;
  }
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
  const trace = readJson(path);
  if (trace?.version !== VERSION || typeof trace.inputs?.scenario?.id !== "string")
    throw new Error("Invalid benchmark trace.");
  const { scenario, ...settings } = trace.inputs;
  const mismatch = difference(settings, traceSettings(config, mapSha), 0);
  if (mismatch) throw new Error(`Benchmark trace inputs differ at ${mismatch.path}.`);
  return scenario;
}

export function compareTraces(
  left,
  right,
  {
    tolerance = STATE_TOLERANCE,
    positionTolerance,
    headingTolerance,
    speedTolerance,
    summary = false,
    window = null,
  } = {},
) {
  const tolerances = [tolerance, positionTolerance, headingTolerance, speedTolerance];
  if (tolerances.some((v) => v !== undefined && (!Number.isFinite(v) || v < 0)))
    throw new Error("Tolerance must be a finite nonnegative number.");
  const stateTolerance = (path) => {
    const field = path.split(".").at(-1);
    // Numeric actor IDs identify entities, even when the numeric pose tolerance is large.
    if (field === "id") return 0;
    if (field === "x" || field === "y") return positionTolerance ?? tolerance;
    if (field === "heading") return headingTolerance ?? tolerance;
    if (field === "speed") return speedTolerance ?? tolerance;
    return tolerance;
  };
  if (window !== null && (!Number.isSafeInteger(window) || window < 0))
    throw new Error("Window must be a nonnegative integer.");
  for (const [side, trace] of [
    ["left", left],
    ["right", right],
  ]) {
    if (
      trace?.version !== VERSION ||
      typeof trace.inputs?.scenario?.id !== "string" ||
      !Array.isArray(trace.steps) ||
      !trace.steps.length ||
      typeof trace.result?.pass !== "boolean" ||
      typeof trace.result.arrived !== "boolean" ||
      !Number.isFinite(trace.result.time_s)
    )
      throw new Error(`Invalid benchmark trace on the ${side}.`);
    const badStep = trace.steps.findIndex((step) => !step?.ego || !Array.isArray(step.traffic));
    if (badStep !== -1) throw new Error(`Invalid benchmark trace on the ${side} at tick ${badStep}.`);
  }
  const mismatch = difference(left.inputs, right.inputs, 0);
  if (mismatch) throw new Error(`Benchmark trace inputs differ at ${mismatch.path}.`);

  let exactState = null;
  let stateOverTolerance = null;
  let decision = null;
  const egoDrift = summary ? emptyDriftStats() : null;
  const trafficDrift = summary ? emptyDriftStats() : null;
  let ticksOverTolerance = 0;
  let divergentDecisionTicks = 0;
  let unmatchedTrafficTicks = 0;
  const shared = Math.min(left.steps.length, right.steps.length);
  for (let tick = 0; tick < shared; tick++) {
    const { decision: aDecision, ...aState } = left.steps[tick];
    const { decision: bDecision, ...bState } = right.steps[tick];
    const exact = exactState ? null : difference(aState, bState, 0);
    if (exact) exactState = { tick, ...exact };
    const state = !stateOverTolerance || summary ? difference(aState, bState, stateTolerance) : null;
    if (state) {
      if (!stateOverTolerance) stateOverTolerance = { tick, ...state };
      if (summary) ticksOverTolerance++;
    }
    const choice = !decision || summary ? difference(aDecision, bDecision, 0, "decision") : null;
    if (choice) {
      if (!decision) decision = { tick, ...choice };
      if (summary) divergentDecisionTicks++;
    }
    if (summary) {
      recordPoseDrift(egoDrift, aState.ego, bState.ego, tick);
      const aTraffic = Array.isArray(aState.traffic) ? aState.traffic : [];
      const bTraffic = Array.isArray(bState.traffic) ? bState.traffic : [];
      const bById = new Map(bTraffic.map((car, index) => [car?.id ?? index, car]));
      if (aTraffic.length !== bTraffic.length || aTraffic.some((car, index) => !bById.has(car?.id ?? index)))
        unmatchedTrafficTicks++;
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
    ...(positionTolerance !== undefined || headingTolerance !== undefined || speedTolerance !== undefined
      ? {
          poseTolerances: {
            position: positionTolerance ?? tolerance,
            heading: headingTolerance ?? tolerance,
            speed: speedTolerance ?? tolerance,
          },
        }
      : {}),
    stateOverTolerance,
    decision,
  };
  if (summary) {
    result.summary = {
      sharedTicks: shared,
      ticksOverTolerance,
      divergentDecisionTicks,
      unmatchedTrafficTicks,
      ego: egoDrift,
      traffic: trafficDrift,
      maxPositionDrift: Math.max(egoDrift.maxPositionDrift, trafficDrift.maxPositionDrift),
      maxHeadingDrift: Math.max(egoDrift.maxHeadingDrift, trafficDrift.maxHeadingDrift),
      maxSpeedDrift: Math.max(egoDrift.maxSpeedDrift, trafficDrift.maxSpeedDrift),
    };
  }
  if (window !== null) {
    const diverged = Math.min(
      stateOverTolerance?.tick ?? Infinity,
      decision?.tick ?? Infinity,
      lengthDifference?.tick ?? Infinity,
    );
    const anchor = !Number.isFinite(diverged) && result.resultDifference ? shared - 1 : diverged;
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
          stateDiff = difference(aState, bState, stateTolerance);
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
        "position-tolerance": { type: "string" },
        "heading-tolerance": { type: "string" },
        "speed-tolerance": { type: "string" },
        exact: { type: "boolean" },
        output: { type: "string" },
        compact: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
    if (values.help) {
      console.log(USAGE);
      process.exit(0);
    }
    if (positionals.length !== 2) throw new Error(USAGE);
    const numeric = (name) => {
      if (values[name] === undefined) return undefined;
      const n = values[name].trim() ? Number(values[name]) : NaN;
      if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a finite nonnegative number.`);
      return n;
    };
    const names = ["tolerance", "position-tolerance", "heading-tolerance", "speed-tolerance"];
    if (values.exact && names.some((name) => values[name] !== undefined))
      throw new Error("--exact cannot be combined with tolerance options.");
    const [tolerance, positionTolerance, headingTolerance, speedTolerance] = names.map(numeric);
    let window = null;
    if (values.window !== undefined) {
      if (!/^\d+$/.test(values.window)) throw new Error("--window must be a nonnegative integer.");
      window = Number(values.window);
    }
    if (values.output !== undefined) {
      if (!values.output) throw new Error("--output needs a path.");
      for (const file of positionals) checkFiles({ trace: file }, { output: values.output });
    }
    const [left, right] = positionals.map(readJson);
    const comparison = compareTraces(left, right, {
      tolerance: values.exact ? 0 : tolerance,
      positionTolerance,
      headingTolerance,
      speedTolerance,
      summary: Boolean(values.summary),
      window,
    });
    const output = JSON.stringify(comparison, null, values.compact ? 0 : 2);
    if (values.output) writeArtifact(values.output, `${output}\n`, { gzip: values.output.endsWith(".gz") });
    else console.log(output);
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
