// How much is left to the driver (ROADMAP 4.1): for each challenge, count the decisions at which the
// safety filter leaves the driver a manoeuvre that leads to a failure. A failure the filter leaves no way
// to reach is tested by the filter, not by the driver.
//
// Method (Rules drives; nothing in the simulation changes):
//  1. Drive the challenge with Rules, keeping a checkpoint (lab/recorder.js, the replay branches' own
//     checkpoints) every --every seconds and logging every decision's surviving (eligible) candidates.
//  2. From each checkpoint, for each candidate that survived the next decision but that Rules did not
//     choose, restore the checkpoint into a second world and drive on with a driver that picks that
//     candidate at every decision for --force seconds whenever it survives (Rules otherwise), then
//     Rules alone up to --horizon seconds after the checkpoint.
//  3. The decision "leaves room to fail" when one of those branches adds a failure (bench/metrics.js
//     `failures`, on the audit counters; arrival and parking are not judged in so short a branch).
// A branch from the first checkpoint with no forced choice must repeat the original drive exactly; the
// report says whether it did.
//
// PORT=8404 uv run server.py, then:
// node --experimental-default-type=module scripts/driver_latitude.mjs --port 8404 [--only door-zone,four-way-stop]
//   [--every 1] [--force 3] [--horizon 6] [--json out.json]
import { benchPage, checkFiles, commaList, parseOptions, wholeNumber } from "./cli_tools.mjs";
import { writeJsonArtifact } from "./recording_artifacts.mjs";

const usage =
  "Usage: driver_latitude.mjs [--only ID,ID] [--every SECONDS] [--force SECONDS] [--horizon SECONDS] [--port PORT] [--limit N] [--json FILE.json[.gz]] [--quiet] [--check]";
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const options = ["port", "only", "every", "force", "horizon", "json", "limit"];
let parsed, only, limit;
try {
  parsed = parseOptions(process.argv.slice(2), options, ["quiet", "check"]);
  if (parsed.help) {
    console.log(usage);
    process.exit(0);
  }
  only = commaList("only", parsed.args.only);
  if (parsed.args.limit !== undefined) limit = wholeNumber("limit", parsed.args.limit, undefined, { min: 1 });
  if (parsed.args.json) {
    if (!/\.json(?:\.gz)?$/.test(parsed.args.json)) throw new Error("--json must end in .json or .json.gz.");
    checkFiles({}, { json: parsed.args.json });
  }
} catch (error) {
  fail(error.message);
}
const { args } = parsed;
const seconds = (name, fallback) => {
  const value = args[name] === undefined ? fallback : Number(args[name]);
  if (!Number.isFinite(value) || value <= 0) fail(`--${name} must be a finite positive number of seconds.`);
  return value;
};
const EVERY = seconds("every", 1);
const FORCE = seconds("force", 3);
const HORIZON = seconds("horizon", 6);
if (FORCE > HORIZON) fail("--force must not exceed --horizon.");

const { base, token } = await benchPage(args.port ?? process.env.PORT ?? "8331").catch((error) => fail(error.message));
globalThis.document = { querySelector: (sel) => (sel.includes("jev-csrf") ? { content: token } : null) };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (path, opts) =>
  nativeFetch(String(path).startsWith("/") ? base + path : path, { ...opts, redirect: "error" });

const { api } = await import("../static/js/common.js");
const { MapData } = await import("../static/js/map/mapdata.js");
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { setupChallenge } = await import("../static/js/lab/evaluation.js");
const { DriveRecorder } = await import("../static/js/lab/recorder.js");
const { stepWorld } = await import("../static/js/sim/step.js");
const { failures } = await import("../static/js/bench/metrics.js");

const selected = only ? CHALLENGES.filter((c) => only.includes(c.id)) : CHALLENGES;
if (only && selected.length !== only.length)
  fail(`Unknown challenge in --only: ${only.filter((id) => !CHALLENGES.some((c) => c.id === id)).join(", ")}.`);
const drives = selected.slice(0, limit);
const maps = {};
for (const id of new Set(drives.map((c) => c.map))) {
  try {
    maps[id] = new MapData(await api(`/api/map?bbox=${encodeURIComponent(id)}`));
  } catch (error) {
    fail(`Cannot load latitude map ${id}: ${error.message}`);
  }
}

const DT = 1 / 60;
// The audit counters as a drive result names them, judged as failures() judges a finished drive.
function auditFailures(v) {
  const { red_lights_run, stop_signs_run, ...rest } = v;
  return failures({ ...rest, arrived: true, red_lights: red_lights_run, stop_signs: stop_signs_run }).filter(
    (f) => f !== "not parked",
  );
}
// The Rules brain of an autopilot, wrapped to log or force choices. `choose(eligibleIds, rulesChoice)`
// returns the id to drive, or null for Rules' own choice.
function wrapRules(autopilot, choose) {
  const rules = autopilot.brains.rules,
    original = rules.decideSync.bind(rules);
  rules.decideSync = (snap, eligible) => {
    const r = original(snap, eligible);
    const id = choose(
      eligible.map((c) => c.id),
      r,
    );
    if (id && id !== r.candidateId)
      Object.assign(r, { motion: id === "hard_brake" ? "stop" : "drive", candidateId: id });
    return r;
  };
}
async function stepOnce(ctx) {
  stepWorld(ctx, DT, ctx.world.t * 1000);
  if (ctx.autopilot.firing) await ctx.autopilot.firing;
  if (ctx.autopilot.detourRouting) await ctx.autopilot.detourRouting;
}

async function latitude(challenge) {
  const map = maps[challenge.map],
    limit = challenge.limit_s || 180,
    started = performance.now();
  // 1. the Rules drive, with checkpoints and the decisions' surviving candidates
  const ctx = setupChallenge(map, challenge, { brain: "rules" });
  const decisions = [],
    recorder = new DriveRecorder({ seconds: limit + 10, interval: EVERY });
  wrapRules(ctx.autopilot, (ids, r) => {
    decisions.push({ t: ctx.world.t, ids, chosen: r.motion === "stop" ? "hard_brake" : r.candidateId });
    return null;
  });
  const positions = new Map();
  let arrived = false;
  ctx.autopilot.onEvent = (e) => {
    if (e.type === "arrived") arrived = true;
  };
  const context = { world: ctx.world, fleet: ctx.fleet, autopilot: ctx.autopilot, drive: null, clock: {} };
  while (ctx.world.t < limit && ctx.autopilot.enabled) {
    recorder.record(context);
    await stepOnce(ctx);
    positions.set(ctx.world.tick, { t: ctx.world.t, x: ctx.world.ego.x, y: ctx.world.ego.y });
  }
  const baseFailures = auditFailures(ctx.world.violations);
  // 2. branches into a second world of the same challenge
  const branchCtx = setupChallenge(map, challenge, { brain: "rules" });
  let forced = null,
    forceUntil = -Infinity;
  wrapRules(branchCtx.autopilot, (ids) =>
    forced && branchCtx.world.t < forceUntil && ids.includes(forced) ? forced : null,
  );
  const target = {
    world: branchCtx.world,
    fleet: branchCtx.fleet,
    autopilot: branchCtx.autopilot,
    setDrive() {},
    clock: {},
  };
  async function branch(index, candidate) {
    const frame = recorder.restore(index, target);
    branchCtx.world.paused = false;
    forced = candidate;
    forceUntil = frame.t + FORCE;
    const before = auditFailures(branchCtx.world.violations);
    let error = null;
    try {
      while (branchCtx.world.t < frame.t + HORIZON - 1e-9 && branchCtx.autopilot.enabled) await stepOnce(branchCtx);
    } catch (e) {
      error = String(e?.message || e).slice(0, 160);
    }
    const after = auditFailures(branchCtx.world.violations);
    return {
      t: branchCtx.world.t,
      tick: branchCtx.world.tick,
      x: branchCtx.world.ego.x,
      y: branchCtx.world.ego.y,
      added: after.filter((f) => !before.includes(f)),
      error,
    };
  }
  // the null branch repeats the drive
  let exact = null;
  if (recorder.frames.length > 1) {
    const b = await branch(0, null);
    const p = positions.get(b.tick);
    exact =
      !!p && !b.error && Math.abs(p.t - b.t) < DT / 2 && Math.hypot(p.x - b.x, p.y - b.y) < 1e-6 && !b.added.length;
  }
  const points = [];
  let decisionIndex = 0;
  for (let i = 0; i < recorder.frames.length; i++) {
    const t = recorder.frames[i].t;
    while (decisionIndex < decisions.length && decisions[decisionIndex].t <= t + 1e-9) decisionIndex++;
    const next = decisions[decisionIndex];
    if (!next || next.t > t + EVERY) continue;
    const alternatives = next.ids.filter((id) => id !== next.chosen);
    const failing = [];
    let diverged = 0;
    for (const id of alternatives) {
      const b = await branch(i, id);
      if (b.added.length || b.error) failing.push({ id, failures: b.added, ...(b.error ? { error: b.error } : {}) });
      // (a forced choice that left the car more than half a metre from where Rules had it: the branch drove differently)
      const p = positions.get(b.tick);
      if (!p || Math.abs(p.t - b.t) >= DT / 2 || Math.hypot(p.x - b.x, p.y - b.y) > 0.5) diverged++;
    }
    points.push({
      t: Math.round(t * 10) / 10,
      surviving: next.ids.length,
      alternatives: alternatives.length,
      diverged,
      failing,
    });
  }
  return {
    challenge: challenge.id,
    arrived,
    pass: arrived && !baseFailures.length,
    decisions: decisions.length,
    points: points.length,
    with_alternatives: points.filter((p) => p.alternatives > 0).length,
    room_to_fail: points.filter((p) => p.failing.length).length,
    branches: points.reduce((a, p) => a + p.alternatives, 0),
    failing_branches: points.reduce((a, p) => a + p.failing.length, 0),
    diverged_branches: points.reduce((a, p) => a + p.diverged, 0),
    failure_kinds: [
      ...new Set(
        points.flatMap((p) => p.failing.flatMap((f) => (f.failures.length ? f.failures : ["simulation error"]))),
      ),
    ],
    exact_replay: exact,
    wall_s: Math.round((performance.now() - started) / 100) / 10,
    // (every decision point that left room to fail, with the candidates that failed)
    room: points.filter((p) => p.failing.length).map((p) => ({ t: p.t, failing: p.failing })),
  };
}

const out = [];
for (const challenge of drives) {
  const r = await latitude(challenge);
  out.push(r);
  if (!args.quiet)
    console.log(
      `${r.challenge} pass=${r.pass} points=${r.points} with_alternatives=${r.with_alternatives} room_to_fail=${r.room_to_fail} branches=${r.branches} diverged=${r.diverged_branches} failing=${r.failing_branches} kinds=${r.failure_kinds.join("|") || "-"} exact=${r.exact_replay} wall=${r.wall_s}s`,
    );
  if (args.json) {
    try {
      writeJsonArtifact(
        args.json,
        JSON.stringify(
          { every_s: EVERY, force_s: FORCE, horizon_s: HORIZON, engine: `node ${process.version}`, results: out },
          null,
          1,
        ),
      );
    } catch (error) {
      fail(error.message);
    }
  }
}
const total = (k) => out.reduce((a, r) => a + r[k], 0);
const replayFailures = out.filter((r) => r.exact_replay !== true).map((r) => r.challenge);
if (args.check && replayFailures.length)
  console.error(`Latitude baseline replay could not be verified for ${replayFailures.join(", ")}.`);
process.stdout.write(
  `${JSON.stringify({ challenges: out.length, points: total("points"), room_to_fail: total("room_to_fail"), none_left_to_driver: out.filter((r) => !r.room_to_fail).map((r) => r.challenge) })}\n`,
  () => process.exit(args.check && replayFailures.length ? 1 : 0),
);
