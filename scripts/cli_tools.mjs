import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

export function isMain(url, entry = process.argv[1]) {
  if (!entry) return false;
  if (url === pathToFileURL(entry).href) return true;
  try {
    return realpathSync.native(entry) === realpathSync.native(fileURLToPath(url));
  } catch {
    return false;
  }
}

export function parseOptions(argv, names, switches = []) {
  const args = Object.create(null);
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
  let n = value === undefined ? fallback : value;
  if (typeof n === "string") n = n && !/[^0-9]/.test(n) ? Number(n) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `from ${min} to ${max}`;
    throw new Error(`--${name} must be a decimal whole number ${range}.`);
  }
  return n;
}

export function commaList(name, value) {
  if (value === undefined) return null;
  if (typeof value !== "string") throw new Error(`--${name} needs a comma-separated string.`);
  const items = value.split(",").map((item) => item.trim());
  if (items.some((item) => !item)) throw new Error(`--${name} contains an empty item.`);
  if (new Set(items).size !== items.length) throw new Error(`--${name} contains duplicate items.`);
  return items;
}

export function checkMode(value, modes) {
  if (value !== undefined && !modes.includes(value)) throw new Error(`--check must be one of ${modes.join(", ")}.`);
}

// CLI artifacts are UTF-8 JSON, optionally compressed. A BOM from an editor is harmless.
export function readJson(file, { maxBytes, reviver } = {}) {
  try {
    const stats = statSync(file);
    if (!stats.isFile()) throw new Error("expected a regular file");
    if (maxBytes !== undefined && stats.size > maxBytes) throw new Error(`file exceeds ${maxBytes} bytes`);
    const bytes = readFileSync(file);
    const decoded = file.endsWith(".gz") ? gunzipSync(bytes, { maxOutputLength: maxBytes }) : bytes;
    if (maxBytes !== undefined && decoded.length > maxBytes) throw new Error(`JSON exceeds ${maxBytes} bytes`);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded), reviver);
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error });
  }
}

function fileIdentity(file) {
  // Native realpath follows symlinks before interpreting any subsequent "..".
  if (file.endsWith(sep)) throw new Error(`Expected a file path without a trailing separator: ${file}`);
  const stats = statSync(file, { throwIfNoEntry: false });
  if (stats) return { path: realpathSync.native(file), inode: `${stats.dev}:${stats.ino}`, stats };
  const realParent = realpathSync.native(dirname(file));
  if (!statSync(realParent).isDirectory()) throw new Error(`Parent is not a directory: ${dirname(file)}`);
  // A dangling symlink has no inode for its target. Refuse it rather than risk writing through it.
  if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error(`Path is a dangling symbolic link: ${file}`);
  return { path: join(realParent, basename(file)) };
}

function checkOutput(option, file, identity) {
  if (identity.stats && !identity.stats.isFile()) throw new Error(`--${option} must name a file: ${file}`);
}

export function checkFiles(inputs, outputs) {
  const seenPaths = new Map();
  const seenInodes = new Map();
  for (const [group, output] of [
    [inputs, false],
    [outputs, true],
  ]) {
    for (const [option, file] of Object.entries(group)) {
      if (file === undefined || file === null) continue;
      if (!file) throw new Error(`--${option} needs a non-empty path.`);
      const identity = fileIdentity(file);
      const previous = seenPaths.get(identity.path) ?? seenInodes.get(identity.inode);
      if (previous !== undefined) throw new Error(`--${option} and --${previous} need different files.`);
      if (output) checkOutput(option, file, identity);
      seenPaths.set(identity.path, option);
      if (identity.inode) seenInodes.set(identity.inode, option);
    }
  }
}

export function writeArtifact(file, text, { gzip = false } = {}) {
  const identity = fileIdentity(file);
  checkOutput("output", file, identity);
  const destination = identity.path;
  let directory;
  try {
    directory = mkdtempSync(join(dirname(destination), ".jev-artifact-"));
    const temporary = join(directory, "artifact");
    const mode = identity.stats ? identity.stats.mode & 0o777 : 0o666;
    writeFileSync(temporary, gzip ? gzipSync(text, { level: 9 }) : text, { mode, flag: "wx" });
    if (identity.stats) chmodSync(temporary, mode);
    renameSync(temporary, destination);
  } catch (error) {
    throw new Error(`Cannot write ${file}: ${error.message}`, { cause: error });
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}

export function loopbackPort(value) {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const port = Number(text);
  if (!text || /[^0-9]/.test(text) || port < 1 || port > 65_535) {
    throw new Error("The local server port must be a decimal integer from 1 to 65535.");
  }
  return String(port);
}

export async function benchPage(value, { timeoutMs = 10_000, signal } = {}) {
  const port = loopbackPort(value);
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/bench`;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "manual",
    });
    if (!response.ok) {
      await response.body?.cancel();
      const detail = response.status >= 300 && response.status < 400 ? ": redirects are not allowed" : "";
      throw new Error(`HTTP ${response.status}${detail}`);
    }
    const page = await response.text();
    const token = page.match(/name="jev-csrf" content="([^"]+)"/)?.[1];
    if (!token?.trim()) throw new Error("the page has no Jev session token");
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
      const arrays = Array.isArray(left);
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
      if (arrays) {
        keys.sort((a, b) => Number(a) - Number(b));
        if (left.length !== right.length && keys.length < Math.max(left.length, right.length)) keys.push("length");
      } else keys.sort();
      for (const key of keys) {
        if (diffs.length >= limit) break;
        compare(
          Object.hasOwn(left, key) ? left[key] : undefined,
          Object.hasOwn(right, key) ? right[key] : undefined,
          /^[A-Za-z0-9_$-]+$/.test(key) ? (keyPath ? `${keyPath}.${key}` : key) : `${keyPath}[${JSON.stringify(key)}]`,
        );
      }
      return;
    }
    const snippet = (value) => {
      if (value === undefined) return "<missing>";
      const text = canonicalJson(value) ?? String(value);
      return text.length > 120 ? `${text.slice(0, 117)}...` : text;
    };
    diffs.push(`${keyPath || "<root>"}: expected ${snippet(left)}, actual ${snippet(right)}`);
  }
  compare(expected, actual, path);
  return diffs;
}
