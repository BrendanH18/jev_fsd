// Run the scripts/test_*.mjs checks in parallel on one machine (scripts/boat-check.sh --full).
// A pool of workers takes the files longest first by the seconds in scripts/ci_test_times.json
// (scripts/ci_shard.mjs), so the slow files start at once and the short ones fill the gaps. Each
// file runs in its own Node process, as in CI, with CI's time limit; its output is kept and printed
// only when it fails. Prints a line per file as it ends and a summary, and exits 1 when any file
// failed or timed out.
//
// node scripts/node_checks.mjs                     every check, one worker per CPU
// node scripts/node_checks.mjs --jobs 4 [FILE...]  four workers; only the named files
// Options: --jobs N (default: the CPU count), --timeout S (default NODE_TEST_TIMEOUT or 360).
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { costs, measuredTimes, testFiles } from "./ci_shard.mjs";

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const KEEP_BYTES = 256 * 1024; // the tail of a failing file's output that is printed
const KILL_AFTER_MS = 10_000; // SIGKILL this long after a timed-out file was sent SIGTERM
const running = new Set(); // process group ids of the checks running now

function parseArgs(argv) {
  const opts = {
    jobs: os.availableParallelism(),
    timeout: Number(process.env.NODE_TEST_TIMEOUT || 360),
    files: [],
    nodeArgs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--jobs" || a === "--timeout") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error(`${a} needs a positive whole number`);
      opts[a.slice(2)] = n;
    } else if (a === "--node-arg") opts.nodeArgs.push(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else opts.files.push(a);
  }
  return opts;
}

// Runs one file; resolves { file, ok, code, signal, timedOut, error, seconds, output, cut }.
function runFile(file, timeoutS, nodeArgs = []) {
  return new Promise((resolve) => {
    const started = performance.now();
    // Its own process group, so a timeout also stops anything the check started.
    const child = spawn(process.execPath, ["--experimental-default-type=module", ...nodeArgs, file], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    if (child.pid) running.add(child.pid);
    const chunks = [];
    let kept = 0;
    const keep = (chunk) => {
      chunks.push(chunk);
      kept += chunk.length;
      while (kept - chunks[0].length >= KEEP_BYTES) kept -= chunks.shift().length;
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const signalGroup = (sig) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, sig);
      } catch {
        // already gone
      }
    };
    let timedOut = false;
    let killer;
    const timer = setTimeout(() => {
      timedOut = true;
      signalGroup("SIGTERM");
      killer = setTimeout(() => signalGroup("SIGKILL"), KILL_AFTER_MS);
    }, timeoutS * 1000);
    let done = false;
    const finish = (code, signal, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(killer);
      // Whatever the check left running in its group goes with it, whether it passed or timed out.
      signalGroup("SIGKILL");
      running.delete(child.pid);
      const output = Buffer.concat(chunks);
      resolve({
        file,
        ok: code === 0 && !timedOut && !error,
        code,
        signal,
        timedOut,
        error,
        seconds: (performance.now() - started) / 1000,
        output: kept > KEEP_BYTES ? output.subarray(output.length - KEEP_BYTES) : output,
        cut: kept > KEEP_BYTES,
      });
    };
    child.on("error", (error) => finish(null, null, error));
    child.on("close", (code, signal) => finish(code, signal, null));
  });
}

function verdict(r, timeoutS) {
  if (r.ok) return "ok";
  if (r.error) return `could not start: ${r.error.message}`;
  if (r.timedOut) return `timed out after ${timeoutS} s`;
  if (r.signal === "SIGKILL") return "was killed (out of memory?)";
  if (r.signal) return `ended by ${r.signal}`;
  return `failed with exit code ${r.code}`;
}

export async function runChecks({ jobs, timeout, files, nodeArgs = [] }, log = console.log) {
  // Named files may live anywhere (scripts/test_node_checks.mjs uses its own); each is one check by
  // its full path, and its bare name only looks up its measured time.
  const checks = files.length
    ? [...new Map(files.map((f) => [path.resolve(f), f])).entries()].map(([file, label]) => ({ file, label }))
    : testFiles().map((f) => ({ file: path.join(SCRIPTS, f), label: `scripts/${f}` }));
  const cost = costs(
    checks.map((c) => path.basename(c.file)),
    measuredTimes(),
  );
  const queue = checks.sort(
    (a, b) => cost(path.basename(b.file)) - cost(path.basename(a.file)) || (a.label < b.label ? -1 : 1),
  );
  const total = queue.length;
  const results = [];
  let lowestFree = os.freemem();
  const sampler = setInterval(() => {
    lowestFree = Math.min(lowestFree, os.freemem());
  }, 500);
  const started = performance.now();
  log(`node-checks: ${total} files, ${Math.min(jobs, total)} at a time, ${timeout} s each`);
  const worker = async () => {
    while (queue.length) {
      const { file, label } = queue.shift();
      const r = await runFile(file, timeout, nodeArgs);
      r.label = label;
      results.push(r);
      const line = `${r.ok ? "ok  " : "FAIL"} ${r.seconds.toFixed(1).padStart(6)} s  ${label}`;
      if (r.ok) log(line);
      else {
        log(`${line}: ${verdict(r, timeout)}`);
        log(`---- output of ${label}${r.cut ? ` (its last ${KEEP_BYTES / 1024} KiB)` : ""}`);
        log(r.output.toString("utf8").trimEnd());
        log(`---- end of ${label}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, total) }, worker));
  clearInterval(sampler);
  const wall = (performance.now() - started) / 1000;
  const busy = results.reduce((s, r) => s + r.seconds, 0);
  const failed = results.filter((r) => !r.ok).sort((a, b) => (a.label < b.label ? -1 : 1));
  log(
    `node-checks: ${total - failed.length} of ${total} passed in ${wall.toFixed(0)} s ` +
      `(${busy.toFixed(0)} s of checks, ${jobs} at a time; lowest free memory ${(lowestFree / 2 ** 30).toFixed(1)} GiB)`,
  );
  log("node-checks: slowest:");
  for (const r of [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 8))
    log(`  ${r.seconds.toFixed(1).padStart(6)} s  ${r.label}`);
  if (failed.length) {
    log("node-checks: failed:");
    for (const r of failed) log(`  ${r.label}: ${verdict(r, timeout)}`);
  }
  return { results, failed, wall };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`node-checks: ${e.message}`);
    process.exit(2);
  }
  // Checks run in their own process groups, so pass an interrupt on to them.
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => {
      for (const pid of running) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
      process.exit(130);
    });
  const { failed } = await runChecks(opts);
  // (an exit code rather than process.exit, so a long failure output reaches a pipe in full)
  process.exitCode = failed.length ? 1 : 0;
}
