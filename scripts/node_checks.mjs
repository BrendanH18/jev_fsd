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
import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { costs, measuredTimes, testFiles } from "./ci_shard.mjs";
import { checkFiles, wholeNumber, writeArtifact } from "./cli_tools.mjs";

const USAGE = `Usage: node scripts/node_checks.mjs [options] [FILE...]
  --jobs N         parallel workers (default: CPU count)
  --timeout S      seconds per check (default: NODE_TEST_TIMEOUT or 360)
  --node-arg ARG   repeatable Node flag (also accepts --node-arg=ARG)
  --match TEXT     keep files whose names contain TEXT
  --exclude TEXT   omit files whose names contain TEXT
  --list           print the planned files in dispatch order
  --show-output    include output from passing checks
  --fail-fast      stop starting files after the first failed check
  --json PATH      write a machine-readable run report (supports .gz)
  --               treat following arguments as paths
  -h, --help       show this help`;

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const KEEP_BYTES = 256 * 1024; // the tail of a failing file's output that is printed
const KILL_AFTER_MS = 10_000; // SIGKILL this long after a timed-out file was sent SIGTERM
const running = new Set(); // process group ids of the checks running now

function parseArgs(argv) {
  const opts = {
    jobs: os.availableParallelism(),
    timeout: process.env.NODE_TEST_TIMEOUT || "360",
    files: [],
    nodeArgs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    if (a === "--") {
      opts.files.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("--")) {
      opts.files.push(a);
      continue;
    }
    const [name, ...parts] = a.slice(2).split("=");
    if (["list", "show-output", "fail-fast"].includes(name) && !parts.length) {
      opts[name] = true;
    } else if (["jobs", "timeout", "node-arg", "match", "exclude", "json"].includes(name)) {
      const value = parts.length ? parts.join("=") : argv[++i];
      if (!value || (name !== "node-arg" && value.startsWith("--") && !parts.length))
        throw new Error(`--${name} needs a value`);
      if (name === "node-arg") opts.nodeArgs.push(value);
      else opts[name] = value;
    } else throw new Error(`unknown option ${a}`);
  }
  opts.jobs = wholeNumber("jobs", String(opts.jobs), undefined, { min: 1 });
  opts.timeout = wholeNumber("timeout", opts.timeout, undefined, { min: 1, max: Math.floor((2 ** 31 - 1) / 1000) });
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

function queueChecks({ files, match, exclude }) {
  // Named files may live anywhere (scripts/test_node_checks.mjs uses its own); each is one check by
  // its full path, and its bare name only looks up its measured time.
  const checks = files.length
    ? [...new Map(files.map((f) => [path.resolve(f), f])).entries()].map(([file, label]) => ({ file, label }))
    : testFiles().map((f) => ({ file: path.join(SCRIPTS, f), label: `scripts/${f}` }));
  const selected = checks.filter(({ file }) => {
    const name = path.basename(file);
    return (!match || name.includes(match)) && (!exclude || !name.includes(exclude));
  });
  if (!selected.length) throw new Error("No Node checks match the selection.");
  for (const { file, label } of selected)
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`No such check file: ${label}`);
  const cost = costs(
    selected.map((c) => path.basename(c.file)),
    measuredTimes(),
  );
  return selected.sort(
    (a, b) => cost(path.basename(b.file)) - cost(path.basename(a.file)) || (a.label < b.label ? -1 : 1),
  );
}

export async function runChecks(opts, log = console.log) {
  const { jobs, timeout, nodeArgs = [] } = opts;
  const queue = queueChecks(opts);
  const total = queue.length;
  const results = [];
  let halt = false;
  let lowestFree = os.freemem();
  const sampler = setInterval(() => {
    lowestFree = Math.min(lowestFree, os.freemem());
  }, 500);
  const started = performance.now();
  log(`node-checks: ${total} files, ${Math.min(jobs, total)} at a time, ${timeout} s each`);
  const worker = async () => {
    while (queue.length && !halt) {
      const { file, label } = queue.shift();
      const r = await runFile(file, timeout, nodeArgs);
      r.label = label;
      results.push(r);
      const line = `${r.ok ? "ok  " : "FAIL"} ${r.seconds.toFixed(1).padStart(6)} s  ${label}`;
      log(r.ok ? line : `${line}: ${verdict(r, timeout)}`);
      if (!r.ok && opts["fail-fast"]) halt = true;
      if (!r.ok || opts["show-output"]) {
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
  const skipped = queue.map(({ label }) => label);
  if (skipped.length) log(`node-checks: ${skipped.length} skipped after a failed check`);
  log(
    `node-checks: ${results.length - failed.length} of ${total} passed in ${wall.toFixed(0)} s ` +
      `(${busy.toFixed(0)} s of checks, ${jobs} at a time; lowest free memory ${(lowestFree / 2 ** 30).toFixed(1)} GiB)`,
  );
  log("node-checks: slowest:");
  for (const r of [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 8))
    log(`  ${r.seconds.toFixed(1).padStart(6)} s  ${r.label}`);
  if (failed.length) {
    log("node-checks: failed:");
    for (const r of failed) log(`  ${r.label}: ${verdict(r, timeout)}`);
  }
  return { results, failed, skipped, wall };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(USAGE);
      process.exit(0);
    }
    if (opts.list) {
      if (opts.json) throw new Error("--list cannot be combined with --json.");
      for (const { label } of queueChecks(opts)) console.log(label);
      process.exit(0);
    }
    if (opts.json) {
      const inputs = opts.files.length
        ? [...new Set(opts.files.map((file) => path.resolve(file)))]
        : testFiles().map((file) => path.join(SCRIPTS, file));
      for (const file of inputs) checkFiles({ check: file }, { json: opts.json });
    }
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
  try {
    const { results, failed, skipped, wall } = await runChecks(opts);
    if (opts.json) {
      const checks = results.map((r) => ({
        file: r.label,
        ok: r.ok,
        seconds: r.seconds,
        code: r.code,
        signal: r.signal,
        timed_out: r.timedOut,
        ...(!r.ok ? { reason: verdict(r, opts.timeout), output: r.output.toString("utf8"), truncated: r.cut } : {}),
      }));
      writeArtifact(opts.json, `${JSON.stringify({ wall_s: wall, checks, skipped })}\n`, {
        gzip: opts.json.endsWith(".gz"),
      });
    }
    // Let buffered output reach its consumer even after a long failure log.
    process.exitCode = failed.length ? 1 : 0;
  } catch (error) {
    console.error(`node-checks: ${error.message}`);
    process.exitCode = 2;
  }
}
