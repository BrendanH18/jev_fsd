import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { driverScores } from "../static/js/bench/scores.js";
import { comparableResult } from "../static/js/brain/recording.js";
import { benchPage, loopbackPort } from "./cli_tools.mjs";
import {
  isCommit, isSha256, parseArtifactJson, readArtifactBytes, readArtifactJson,
  writeNewJson
} from "./recording_artifacts.mjs";
import { tapeCounts } from "./arena_tape.mjs";
import { preflightSubmission, readSubmission, SUBMISSION_FORMAT, verifyPublishedRows, verifySubmissionReport } from "./submission_bundle.mjs";

const PUBLISHED_FORMAT = "jev-published-submission/1";
const DEFAULT_TIMEOUT_MS = 360_000;
const usage = [
  "Usage: node --experimental-default-type=module scripts/driver_submission.mjs",
  "  pack --recording tape.json.gz --report report.json --out submission.json.gz",
  "  inspect --bundle submission.json[.gz] [--json] [--tape-info] [--expect-sha256 HASH]",
  "  verify --bundle submission.json.gz [--checkout path] [--port 8322] [--timeout ms]",
  "  publish --bundle submission.json.gz --submitter handle --out data/submissions/YYYY-MM-DD/name.json [--checkout path] [--port 8322] [--timeout ms]",
].join("\n");
const commandOptions = {
  pack: { required: ["recording", "report", "out"], optional: [] },
  inspect: { required: ["bundle"], optional: ["json", "expect-sha256", "tape-info"] },
  verify: { required: ["bundle"], optional: ["checkout", "port", "timeout"] },
  publish: { required: ["bundle", "submitter", "out"], optional: ["checkout", "port", "timeout"] },
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = readArtifactJson;
const write = writeNewJson;
const validHandle = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,38}$/.test(value);

function parseTimeout(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(value)) throw new Error("--timeout must be a positive number of milliseconds.");
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 2 ** 31 - 1)
    throw new Error("--timeout must be a positive number of milliseconds.");
  return ms;
}

function inspect({ bundle: bundlePath, json, "tape-info": showTape, "expect-sha256": expectedSha }) {
  if (expectedSha !== undefined && !isSha256(expectedSha))
    throw new Error("--expect-sha256 needs 64 hexadecimal characters.");
  const rawBytes = readArtifactBytes(bundlePath);
  const fileSha256 = sha256(rawBytes);
  if (expectedSha !== undefined && fileSha256 !== expectedSha.toLowerCase())
    throw new Error(`File SHA-256 mismatch for ${bundlePath}: expected ${expectedSha}, actual ${fileSha256}.`);
  const parsed = parseArtifactJson(bundlePath, rawBytes);
  let format;
  let report;
  let manifest;
  let bundle;
  let submitter = null;
  let tapeSha256 = null;
  let tapeVerified = null;
  if (parsed?.format === PUBLISHED_FORMAT) {
    format = PUBLISHED_FORMAT;
    submitter = parsed.submitter;
    if (!validHandle(submitter)) throw new Error("Invalid published submission: invalid submitter handle.");
    if (!isSha256(parsed.recording_sha256)) throw new Error("Invalid published submission: expected a recording SHA-256 checksum.");
    report = parsed.report;
    manifest = report?.manifest;
    if (manifest?.format !== "jev-run-manifest/2" || !Array.isArray(report?.results)) {
      throw new Error("Invalid published submission: missing report manifest or results.");
    }
    const tapePath = `${bundlePath}.gz`;
    const tapeStat = statSync(tapePath, { throwIfNoEntry: false });
    if (!tapeStat) throw new Error(`Published submission tape is missing: ${tapePath}`);
    const tapeBytes = readArtifactBytes(tapePath);
    const actualTapeSha = sha256(tapeBytes);
    tapeSha256 = actualTapeSha;
    tapeVerified = actualTapeSha === parsed.recording_sha256.toLowerCase();
    if (!tapeVerified) {
      throw new Error(
        `Recording SHA-256 mismatch for ${tapePath}: expected ${parsed.recording_sha256}, actual ${actualTapeSha}.`,
      );
    }
    const recording = parseArtifactJson(tapePath, tapeBytes);
    bundle = readSubmission({ format: SUBMISSION_FORMAT, recording, report });
    verifyPublishedRows(report, recording, comparableResult);
  } else {
    bundle = readSubmission(parsed);
    format = bundle.format;
    report = bundle.report;
    manifest = report.manifest;
    const recordingText = `${JSON.stringify(bundle.recording)}\n`;
    tapeSha256 = sha256(recordingText);
    // A portable bundle has no independent digest to verify.
  }
  const results = report.results;
  const passed = results.filter((r) => r.pass).length;
  const scores = driverScores(results);
  const passRate = results.length
    ? `${passed}/${results.length} (${((passed / results.length) * 100).toFixed(1)}%)`
    : "0/0";
  const info = {
    path: bundlePath,
    format,
    ...(submitter ? { submitter } : {}),
    file_sha256: fileSha256,
    tape_sha256: tapeSha256,
    tape_sha256_verified: tapeVerified,
    driver: manifest.driver,
    model: manifest.model ?? null,
    track: manifest.track ?? "guarded",
    suite_version: manifest.suite_version ?? report.suite_version ?? null,
    source_commit: manifest.source_commit,
    source_dirty: manifest.source_dirty,
    engine: manifest.engine,
    engine_version: manifest.engine_version,
    passed,
    drives: results.length,
    pass_rate: passRate,
    scores,
    cost_usd: manifest.cost_usd,
    ...(showTape ? { tape: tapeCounts(preflightSubmission(bundle)) } : {}),
    manifest,
  };
  if (json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  const lines = [
    `Format: ${info.format}`,
    ...(info.submitter ? [`Submitter: @${info.submitter}`] : []),
    `Driver: ${info.driver}${info.model ? ` (${info.model})` : ""}`,
    `Track: ${info.track}`,
    `Suite version: ${info.suite_version ?? "unknown"}`,
    `Commit: ${info.source_commit} (dirty=${info.source_dirty})`,
    `Runtime: ${info.engine} (V8 ${info.engine_version})`,
    `Pass rate: ${info.pass_rate}`,
    `Score: ${scores.score ?? "n/a"} (comfort=${scores.comfort ?? "n/a"}, margin=${scores.margin ?? "n/a"}, pace=${scores.pace ?? "n/a"})`,
    `Cost: $${Number(info.cost_usd ?? 0).toFixed(6)}`,
    `File SHA-256: ${info.file_sha256}`,
    `Tape SHA-256: ${info.tape_sha256} (${info.tape_sha256_verified ? "verified" : "no stored checksum"})`,
    ...(info.tape ? [`Tape answers: ${info.tape.answers} across ${info.tape.requests} request keys and ${info.tape.drives} drives`] : []),
    `Manifest: ${manifest.format} (prompt=${manifest.prompt_hash ?? "none"}, maps=${Object.keys(manifest.maps ?? {}).join(",") || "none"})`,
  ];
  console.log(lines.join("\n"));
}

async function verify(bundle, { checkout, port, timeout }) {
  const { recording, report } = bundle;
  const timeoutMs = parseTimeout(timeout);
  const serverPort = loopbackPort(port ?? process.env.PORT ?? "8322");
  const { manifest } = report;
  if (!isCommit(manifest.source_commit) || manifest.source_dirty !== false)
    throw new Error("The recording must name a clean source commit.");
  if (manifest.engine !== `node ${process.version}` || manifest.engine_version !== process.versions.v8)
    throw new Error(`Use ${manifest.engine} (V8 ${manifest.engine_version}) to verify this bundle.`);
  const arena = checkout
    ? resolve(checkout, "scripts/arena_node.mjs")
    : fileURLToPath(new URL("./arena_node.mjs", import.meta.url));
  if (!statSync(arena, { throwIfNoEntry: false })?.isFile())
    throw new Error(`The replay checkout does not contain an Arena runner: ${arena}`);
  preflightSubmission(bundle);
  verifyPublishedRows(report, recording, comparableResult);
  await benchPage(serverPort);
  const dir = mkdtempSync(join(tmpdir(), "jev-submission-"));
  try {
    const tape = join(dir, "recording.json");
    const replay = join(dir, "report.json");
    write(tape, recording);
    execFileSync(
      process.execPath,
      [
        "--experimental-default-type=module",
        arena,
        "--replay",
        tape,
        "--check",
        "submission",
        "--json",
        replay,
        "--port",
        serverPort,
      ],
      { stdio: "inherit", timeout: timeoutMs, killSignal: "SIGKILL" },
    );
    if (!statSync(replay, { throwIfNoEntry: false })?.isFile())
      throw new Error("The Arena verifier returned without writing its report.");
    verifySubmissionReport(report, read(replay));
    console.log(`Verified ${report.results.length} drives from ${recording.header.driver}.`);
  } catch (error) {
    if (error.code === "ETIMEDOUT") throw new Error(`Replay exceeded --timeout ${timeoutMs} ms.`, { cause: error });
    if (error.status != null) throw new Error(`Arena replay exited with status ${error.status}. See its diagnostic above.`, { cause: error });
    if (error.signal) throw new Error(`Arena replay terminated by ${error.signal}.`, { cause: error });
    throw error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function publish({ bundle: bundlePath, submitter, out: requestedPath, checkout, port, timeout }) {
  parseTimeout(timeout);
  if (!validHandle(submitter))
    throw new Error("Use a submitter handle with 1–39 lowercase letters, digits, hyphens or underscores.");
  const out = resolve(requestedPath);
  const dayDir = dirname(out);
  const submissions = join(realpathSync(fileURLToPath(new URL("../", import.meta.url))), "data", "submissions");
  const day = basename(dayDir);
  const date = new Date(`${day}T00:00:00Z`);
  if (
    dirname(dayDir) !== submissions ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    throw new Error("Write the publication under data/submissions/YYYY-MM-DD/ using a valid calendar date.");
  if (!/^[a-z0-9][a-z0-9_-]*\.json$/.test(basename(out)))
    throw new Error("Name the publication report with lowercase letters, digits, hyphens or underscores and .json.");
  // Resolve any existing ancestor before creating a directory, including a symlinked base.
  let existing = dayDir;
  while (!statSync(existing, { throwIfNoEntry: false })) existing = dirname(existing);
  if (realpathSync(existing) !== existing) throw new Error("The submission directory must be inside this checkout.");
  const tape = `${out}.gz`;
  if ([out, tape].some((path) => statSync(path, { throwIfNoEntry: false })))
    throw new Error("The publication report and tape must both be new files.");
  const bundle = readSubmission(read(bundlePath));
  await verify(bundle, { checkout, port, timeout });
  mkdirSync(dayDir, { recursive: true });
  if (realpathSync(dayDir) !== dayDir) throw new Error("The submission directory must be inside this checkout.");
  const staging = mkdtempSync(join(dayDir, ".jev-submission-"));
  const stagedTape = join(staging, "recording.json.gz");
  const stagedReport = join(staging, "report.json");
  try {
    const bytes = write(stagedTape, bundle.recording);
    write(
      stagedReport,
      {
        format: PUBLISHED_FORMAT,
        submitter,
        recording_sha256: sha256(bytes),
        report: bundle.report,
      },
      1,
    );
    linkSync(stagedTape, tape);
    try {
      linkSync(stagedReport, out);
    } catch (error) {
      rmSync(tape);
      throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(`Published source files written to ${out} and ${tape}.`);
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      recording: { type: "string" },
      report: { type: "string" },
      out: { type: "string" },
      bundle: { type: "string" },
      submitter: { type: "string" },
      checkout: { type: "string" },
      port: { type: "string" },
      timeout: { type: "string" },
      "expect-sha256": { type: "string" },
      json: { type: "boolean" },
      "tape-info": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command] = positionals;
  if (values.help) console.log(usage);
  else {
    if (positionals.length !== 1 || !Object.hasOwn(commandOptions, command)) throw new Error(usage);
    const { required, optional } = commandOptions[command];
    for (const key of required) if (!values[key]?.trim()) throw new Error(`${command} needs --${key}.`);
    for (const key of Object.keys(values))
      if (!required.includes(key) && !optional.includes(key)) throw new Error(`${command} does not use --${key}.`);
    if (command === "pack") {
      const bundle = readSubmission({
        format: SUBMISSION_FORMAT,
        recording: read(values.recording),
        report: read(values.report),
      });
      write(values.out, bundle);
      console.log(`Packed ${bundle.report.results.length} drives to ${values.out}.`);
    } else if (command === "inspect") inspect(values);
    else if (command === "verify") await verify(readSubmission(read(values.bundle)), values);
    else await publish(values);
  }
} catch (error) {
  console.error(`Submission could not be processed: ${error.message}`);
  process.exitCode = 1;
}
