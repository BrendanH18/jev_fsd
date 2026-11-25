// Shared file handling for recorded answers and their offline reports.
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { writeArtifact } from "./cli_tools.mjs";

export const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
// Some published model tapes predate prompt compaction and expand to more than 128 MiB.
export const MAX_RECORDING_BYTES = 512 * 1024 * 1024;

export const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const isId = (value) => typeof value === "string" && value.trim().length > 0 && value === value.trim();
export const isCommit = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
export const isSha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
export const isFingerprint = (value) => typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
export const isTrack = (value) => value === "guarded" || value === "open";
export const isArenaSet = (value) => ["all", "challenges", "road-tests"].includes(value);
export const isDateTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function readArtifactBytes(path, max = MAX_ARTIFACT_BYTES) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("expected a regular file");
    if (stat.size > max) throw new Error(`file exceeds ${max} bytes`);
    const chunks = [];
    let remaining = max + 1;
    while (remaining > 0) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const n = readSync(fd, chunk);
      if (n === 0) return Buffer.concat(chunks);
      chunks.push(chunk.subarray(0, n));
      remaining -= n;
    }
    throw new Error(`file exceeds ${max} bytes`);
  } catch (error) {
    throw new Error(`${path}: ${error.message}`, { cause: error });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function parseArtifactJson(path, bytes, max = MAX_ARTIFACT_BYTES) {
  try {
    const raw = path.endsWith(".gz") ? gunzipSync(bytes, { maxOutputLength: max }) : bytes;
    if (raw.length > max) throw new Error(`JSON exceeds ${max} bytes`);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`, { cause: error });
  }
}

export const readArtifactJson = (path, max = MAX_ARTIFACT_BYTES) =>
  parseArtifactJson(path, readArtifactBytes(path, max), max);
export const readRecordingJson = (path) => readArtifactJson(path, MAX_RECORDING_BYTES);

export function artifactBytes(path, text, max = MAX_ARTIFACT_BYTES) {
  if (Buffer.byteLength(text) > max) throw new Error(`${path} exceeds ${max / (1024 * 1024)} MiB before compression.`);
  const bytes = path.endsWith(".gz") ? gzipSync(text, { level: 9 }) : Buffer.from(text);
  if (bytes.length > max) throw new Error(`${path} exceeds ${max / (1024 * 1024)} MiB after compression.`);
  return bytes;
}

export function writeNewJson(path, value, indent) {
  const bytes = artifactBytes(path, `${JSON.stringify(value, null, indent)}\n`);
  const directory = mkdtempSync(join(dirname(path), ".jev-new-"));
  const temporary = join(directory, "artifact");
  try {
    writeFileSync(temporary, bytes);
    linkSync(temporary, path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return bytes;
}

export const writeJsonArtifact = (path, text, max) => writeArtifact(path, artifactBytes(path, text, max));
