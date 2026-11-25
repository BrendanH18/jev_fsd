// Compare two captures from bench_node.mjs --trace.
import { statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { checkFiles, commaList, readJson, wholeNumber, writeArtifact } from "./cli_tools.mjs";

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
  "  --from-tick <N>           begin comparison at this absolute tick",
  "  --to-tick <N>             end comparison at this absolute tick, inclusive",
  "  --actor <id>              compare just this traffic actor's state",
  "  --state <all|ego|traffic> choose which state to compare",
  "  --ignore-traffic-order   match traffic actors by ID instead of array position",
  "  --wrap-heading           measure headings by their shortest angular difference",
  "  --strict-capture         require all pose and decision fields produced by the runner",
  "  --explain <N>             include up to N separate state differences at the first divergent tick",
  "  --ignore <a,b>            exclude named comparison categories: decision, result, length",
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

function angularDistance(a, b) {
  const circle = 2 * Math.PI;
  const delta = Math.abs((a - b) % circle);
  return Math.min(delta, circle - delta);
}

function differences(left, right, tolerance, path = "", { limit = 1, wrapHeading = false } = {}) {
  const found = [];
  function walk(a, b, key) {
    if (a === b || found.length >= limit) return;
    if (typeof a === "number" && typeof b === "number") {
      const threshold = typeof tolerance === "function" ? tolerance(key) : tolerance;
      const drift = wrapHeading && key.endsWith(".heading") ? angularDistance(a, b) : Math.abs(a - b);
      if (drift <= threshold) return;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
      for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (found.length >= limit) break;
        walk(
          Object.hasOwn(a, field) ? a[field] : undefined,
          Object.hasOwn(b, field) ? b[field] : undefined,
          key ? `${key}.${field}` : field,
        );
      }
      return;
    }
    found.push({ path: key, left: a ?? null, right: b ?? null });
  }
  walk(left, right, path);
  return found;
}
const difference = (...args) => differences(...args)[0] ?? null;

const POSE_FIELDS = ["x", "y", "heading", "speed"];
const validPose = (pose, strict) =>
  pose &&
  typeof pose === "object" &&
  !Array.isArray(pose) &&
  POSE_FIELDS.every((field) => Number.isFinite(pose[field]) || (!strict && pose[field] === undefined));
const validId = (id) => Number.isSafeInteger(id) || (typeof id === "string" && id.length > 0);

function validateTrace(trace, side, strict) {
  if (
    trace?.version !== VERSION ||
    typeof trace.inputs?.scenario?.id !== "string" ||
    !trace.inputs.scenario.id.trim() ||
    !Array.isArray(trace.steps) ||
    !trace.steps.length ||
    typeof trace.result?.pass !== "boolean" ||
    typeof trace.result.arrived !== "boolean" ||
    !Number.isFinite(trace.result.time_s) ||
    trace.result.time_s < 0
  )
    throw new Error(`Invalid benchmark trace on the ${side}.`);
  for (const [tick, step] of trace.steps.entries()) {
    const bad = (field) => {
      throw new Error(`Invalid benchmark trace on the ${side} at tick ${tick} (${field}).`);
    };
    if (!validPose(step?.ego, strict)) bad("ego pose");
    if (!Array.isArray(step.traffic)) bad("traffic list");
    const actors = new Set();
    for (const actor of step.traffic) {
      if (!validPose(actor, strict)) bad("traffic pose");
      if (!validId(actor.id)) bad("traffic actor ID");
      if (actors.has(actor.id)) bad(`duplicate traffic actor ${actor.id}`);
      actors.add(actor.id);
    }
    const d = step.decision;
    if (d === null || (!strict && d === undefined)) continue;
    if (!d || typeof d !== "object" || Array.isArray(d)) bad("decision");
    if ((strict || d.count !== undefined) && (!Number.isSafeInteger(d.count) || d.count < 0)) bad("decision count");
    for (const field of ["motion", "choice", "headlights"])
      if (
        (d[field] !== undefined && d[field] !== null && typeof d[field] !== "string") ||
        (strict && field === "motion" && typeof d[field] !== "string") ||
        (strict && field === "choice" && d[field] === undefined)
      )
        bad(`decision ${field}`);
  }
}

function projectStep(step, state, actor, unordered) {
  const { decision, ...poseState } = step;
  const ordered = (cars) =>
    unordered
      ? [...cars].sort((a, b) =>
          a.id === b.id ? 0 : typeof a.id === typeof b.id ? (a.id < b.id ? -1 : 1) : typeof a.id === "number" ? -1 : 1,
        )
      : cars;
  if (actor !== undefined)
    return { decision, state: { traffic: step.traffic.filter((car) => String(car.id) === actor) } };
  if (state === "ego") return { decision, state: { ego: step.ego } };
  if (state === "traffic") return { decision, state: { traffic: ordered(step.traffic) } };
  return { decision, state: { ...poseState, traffic: ordered(step.traffic) } };
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

function recordPoseDrift(stats, a, b, tick, wrapHeading) {
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
    const heading = wrapHeading ? angularDistance(a.heading, b.heading) : Math.abs(a.heading - b.heading);
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
    fromTick = 0,
    toTick,
    state = "all",
    actor,
    ignoreTrafficOrder = false,
    wrapHeading = false,
    strictCapture = false,
    explain = 0,
    ignore = [],
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
  if (
    !Number.isSafeInteger(fromTick) ||
    fromTick < 0 ||
    (toTick !== undefined && (!Number.isSafeInteger(toTick) || toTick < fromTick))
  )
    throw new Error("Tick range must use ordered, nonnegative integers.");
  if (!["all", "ego", "traffic"].includes(state)) throw new Error("State must be all, ego or traffic.");
  if (actor !== undefined && (typeof actor !== "string" || !actor.trim() || state === "ego"))
    throw new Error("Actor selection requires a nonempty ID and traffic state.");
  if (!Number.isSafeInteger(explain) || explain < 0 || explain > 100)
    throw new Error("Explain must be a whole number from 0 to 100.");
  if (!Array.isArray(ignore) || ignore.some((key) => !["decision", "result", "length"].includes(key)))
    throw new Error("Ignore accepts decision, result and length.");
  validateTrace(left, "left", strictCapture);
  validateTrace(right, "right", strictCapture);
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
  const captureEnd = Math.max(left.steps.length, right.steps.length) - 1;
  if (fromTick > captureEnd || (toTick !== undefined && toTick > captureEnd))
    throw new Error(`Tick range exceeds the last captured tick (${captureEnd}).`);
  const end = toTick ?? captureEnd;
  const sharedEnd = Math.min(shared - 1, end);
  const scope = { fromTick, toTick: end, state, ...(actor !== undefined ? { actor } : {}) };
  const projected = (step) => projectStep(step, state, actor, ignoreTrafficOrder);
  if (
    actor !== undefined &&
    ![left, right].some((trace) =>
      trace.steps.slice(fromTick, end + 1).some((step) => step.traffic.some((car) => String(car.id) === actor)),
    )
  )
    throw new Error(`Traffic actor ${actor} is absent from the selected ticks.`);
  const comparisonOptions = { wrapHeading };
  let firstStateDetails;
  for (let tick = fromTick; tick <= sharedEnd; tick++) {
    const { decision: aDecision, state: aState } = projected(left.steps[tick]);
    const { decision: bDecision, state: bState } = projected(right.steps[tick]);
    const exact = exactState ? null : difference(aState, bState, 0);
    if (exact) exactState = { tick, ...exact };
    const drift =
      !stateOverTolerance || summary ? difference(aState, bState, stateTolerance, "", comparisonOptions) : null;
    if (drift) {
      if (!stateOverTolerance) {
        stateOverTolerance = { tick, ...drift };
        if (explain)
          firstStateDetails = differences(aState, bState, stateTolerance, "", { ...comparisonOptions, limit: explain });
      }
      if (summary) ticksOverTolerance++;
    }
    const choice =
      !ignore.includes("decision") && (!decision || summary) ? difference(aDecision, bDecision, 0, "decision") : null;
    if (choice) {
      if (!decision) decision = { tick, ...choice };
      if (summary) divergentDecisionTicks++;
    }
    if (summary) {
      recordPoseDrift(egoDrift, aState.ego, bState.ego, tick, wrapHeading);
      const aTraffic = Array.isArray(aState.traffic) ? aState.traffic : [];
      const bTraffic = Array.isArray(bState.traffic) ? bState.traffic : [];
      const bById = new Map(bTraffic.map((car, index) => [car?.id ?? index, car]));
      if (aTraffic.length !== bTraffic.length || aTraffic.some((car, index) => !bById.has(car?.id ?? index)))
        unmatchedTrafficTicks++;
      for (const [index, aCar] of aTraffic.entries()) {
        recordPoseDrift(trafficDrift, aCar, bById.get(aCar?.id ?? index), tick, wrapHeading);
      }
    }
    if (!summary && exactState && stateOverTolerance && (decision || ignore.includes("decision"))) break;
  }

  const lengthDifference =
    left.steps.length === right.steps.length || end < shared || ignore.includes("length")
      ? null
      : { tick: Math.max(shared, fromTick), ended: left.steps.length === shared ? "left" : "right" };
  const result = {
    scenario: left.inputs.scenario.id,
    runtimes: [left.runtime, right.runtime],
    steps: [left.steps.length - 1, right.steps.length - 1],
    results: [left.result, right.result],
    lengthDifference,
    resultDifference: ignore.includes("result") ? null : difference(left.result, right.result, 0, "result"),
    ...(fromTick || toTick !== undefined || state !== "all" || actor !== undefined ? { scope } : {}),
    ...(ignore.length ? { ignored: [...ignore] } : {}),
    ...(ignoreTrafficOrder ? { trafficMatchedById: true } : {}),
    ...(wrapHeading ? { wrapHeading: true } : {}),
    ...(explain ? { firstStateDetails: firstStateDetails ?? [] } : {}),
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
      sharedTicks: Math.max(0, sharedEnd - fromTick + 1),
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
    const anchor = !Number.isFinite(diverged) && result.resultDifference ? Math.max(fromTick, sharedEnd) : diverged;
    if (!Number.isFinite(anchor)) {
      result.window = null;
    } else {
      const from = Math.max(fromTick, anchor - window);
      const to = Math.min(end, anchor + window);
      const ticks = [];
      for (let tick = from; tick <= to; tick++) {
        const leftStep = left.steps[tick] ?? null;
        const rightStep = right.steps[tick] ?? null;
        let stateDiff = null;
        let decisionDiff = null;
        if (leftStep && rightStep) {
          const { decision: aDecision, state: aState } = projected(leftStep);
          const { decision: bDecision, state: bState } = projected(rightStep);
          stateDiff = difference(aState, bState, stateTolerance, "", comparisonOptions);
          if (!ignore.includes("decision")) decisionDiff = difference(aDecision, bDecision, 0, "decision");
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
        "from-tick": { type: "string" },
        "to-tick": { type: "string" },
        state: { type: "string" },
        actor: { type: "string" },
        "ignore-traffic-order": { type: "boolean" },
        "wrap-heading": { type: "boolean" },
        "strict-capture": { type: "boolean" },
        explain: { type: "string" },
        ignore: { type: "string" },
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
      fromTick: wholeNumber("from-tick", values["from-tick"], 0),
      toTick: values["to-tick"] === undefined ? undefined : wholeNumber("to-tick", values["to-tick"]),
      state: values.state,
      actor: values.actor,
      ignoreTrafficOrder: values["ignore-traffic-order"],
      wrapHeading: values["wrap-heading"],
      strictCapture: values["strict-capture"],
      explain: wholeNumber("explain", values.explain, 0, { max: 100 }),
      ignore: commaList("ignore", values.ignore) ?? [],
    });
    const output = JSON.stringify(comparison, null, values.compact ? 0 : 2);
    if (values.output) writeArtifact(values.output, `${output}\n`, { gzip: values.output.endsWith(".gz") });
    else console.log(output);
    if (
      values.check &&
      ((values.exact ? comparison.exactState : comparison.stateOverTolerance) ||
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
