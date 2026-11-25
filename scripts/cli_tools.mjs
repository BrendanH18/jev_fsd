import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export function parseOptions(argv, names, switches = []) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") return { help: true, args };
    if (token === "--" && i === argv.length - 1) break;
    if (!token.startsWith("--")) throw new Error(`Unexpected argument "${token}". Use --help for usage.`);
    const eq = token.indexOf("=");
    const name = eq < 0 ? token.slice(2) : token.slice(2, eq);
    if (Object.hasOwn(args, name)) throw new Error(`Specify --${name} only once.`);
    if (switches.includes(name)) {
      if (eq >= 0) throw new Error(`--${name} does not take a value.`);
      args[name] = true;
      continue;
    }
    if (!names.includes(name)) throw new Error(`Unknown option --${name}. Use --help for usage.`);
    const value = eq < 0 ? argv[++i] : token.slice(eq + 1);
    if (!value || (eq < 0 && (value.startsWith("--") || value === "-h"))) {
      throw new Error(`--${name} needs a non-empty value.`);
    }
    args[name] = value;
  }
  return { help: false, args };
}

export function wholeNumber(name, value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = value === undefined ? fallback : value && !/[^0-9]/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `from ${min} to ${max}`;
    throw new Error(`--${name} must be a decimal whole number ${range}.`);
  }
  return n;
}

export function commaList(name, value) {
  if (value === undefined) return null;
  const items = value.split(",").map((item) => item.trim());
  if (items.some((item) => !item)) throw new Error(`--${name} contains an empty item.`);
  if (new Set(items).size !== items.length) throw new Error(`--${name} contains duplicate items.`);
  return items;
}

export function checkMode(value, modes) {
  if (value !== undefined && !modes.includes(value)) throw new Error(`--check must be one of ${modes.join(", ")}.`);
}

export function readJson(file) {
  try {
    const bytes = readFileSync(file);
    return JSON.parse((file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error });
  }
}

function fileIdentity(file) {
  const absolute = resolve(file);
  const stats = statSync(absolute, { throwIfNoEntry: false });
  if (stats) return { path: realpathSync(absolute), inode: `${stats.dev}:${stats.ino}` };
  const parent = dirname(absolute);
  const realParent = realpathSync(parent);
  // A dangling symlink has no inode for its target. Refuse it rather than risk writing through it.
  if (lstatSync(absolute, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error(`Path is a dangling symbolic link: ${file}`);
  return { path: join(realParent, basename(absolute)) };
}

export function checkFiles(inputs, outputs) {
  const seen = [];
  for (const [option, file] of [...Object.entries(inputs), ...Object.entries(outputs)]) {
    if (!file) continue;
    const identity = fileIdentity(file);
    const previous = seen.find(
      (entry) => entry.path === identity.path || (identity.inode && entry.inode === identity.inode),
    );
    if (previous) throw new Error(`--${option} and --${previous.option} need different files.`);
    if (Object.hasOwn(outputs, option)) {
      const stats = statSync(file, { throwIfNoEntry: false });
      if (stats && !stats.isFile()) throw new Error(`--${option} must name a file: ${file}`);
    }
    seen.push({ ...identity, option });
  }
}

export function writeArtifact(file, text, { gzip = false } = {}) {
  checkFiles({}, { output: file });
  const destination = statSync(file, { throwIfNoEntry: false }) ? realpathSync(file) : resolve(file);
  const directory = mkdtempSync(join(dirname(destination), ".jev-artifact-"));
  const temporary = join(directory, "artifact");
  try {
    writeFileSync(temporary, gzip ? gzipSync(text, { level: 9 }) : text);
    renameSync(temporary, destination);
  } catch (error) {
    throw new Error(`Cannot write ${file}: ${error.message}`, { cause: error });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function loopbackPort(value) {
  const port = Number(value);
  if (!value || /[^0-9]/.test(value) || port < 1 || port > 65_535) {
    throw new Error("The local server port must be a decimal integer from 1 to 65535.");
  }
  return String(port);
}

export async function benchPage(value) {
  const port = loopbackPort(value);
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/bench`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "manual" });
    if (response.status >= 300 && response.status < 400)
      throw new Error(`HTTP ${response.status}: redirects are not allowed`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const page = await response.text();
    const token = page.match(/name="jev-csrf" content="([^"]+)"/)?.[1];
    if (!token) throw new Error("the page has no Jev session token");
    return { base, port, page, token };
  } catch (error) {
    const detail = error.cause?.code ?? error.message;
    throw new Error(
      `Cannot reach the Jev server at ${url} (${detail}). Start it first with: PORT=${port} uv run server.py`,
      { cause: error },
    );
  }
}

// The canonical serializer ignores absent object members and preserves array order,
// just as the verifiers being diagnosed do.
export function jsonDifferences(expected, actual, canonicalJson, { limit = 12, path = "" } = {}) {
  const diffs = [];
  function compare(left, right, keyPath) {
    if (diffs.length >= limit || left === right) return;
    if (left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right)) return;
    if (
      left &&
      right &&
      typeof left === "object" &&
      typeof right === "object" &&
      Array.isArray(left) === Array.isArray(right)
    ) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (const key of keys) {
        if (diffs.length >= limit) break;
        compare(
          Object.hasOwn(left, key) ? left[key] : undefined,
          Object.hasOwn(right, key) ? right[key] : undefined,
          keyPath ? `${keyPath}.${key}` : key,
        );
      }
      return;
    }
    const snippet = (value) => {
      if (value === undefined) return "<missing>";
      const text = canonicalJson(value);
      return text.length > 120 ? `${text.slice(0, 117)}...` : text;
    };
    diffs.push(`${keyPath || "<root>"}: expected ${snippet(left)}, actual ${snippet(right)}`);
  }
  compare(expected, actual, path);
  return diffs;
}
