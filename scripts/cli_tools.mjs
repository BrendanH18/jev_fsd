export function parseOptions(argv, names, switches = []) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") return { help: true, args };
    if (token === "--" && i === argv.length - 1) break;
    if (!token.startsWith("--")) throw new Error(`Unexpected argument "${token}". Use --help for usage.`);
    const eq = token.indexOf("=");
    const name = eq < 0 ? token.slice(2) : token.slice(2, eq);
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
    return { base, port, page: await response.text() };
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
