// Display and input preferences are independent of the saved world and its URL.
export function preference(name, fallback, storage = undefined, { valid, legacy = false } = {}) {
  const key = `jev-fsd-${legacy ? "" : "ui-"}${name}`;
  const accepts = (value) =>
    typeof value === typeof fallback &&
    (typeof value !== "number" || Number.isFinite(value)) &&
    (valid?.(value) ?? true);

  return {
    read() {
      try {
        const raw = (storage ?? globalThis.localStorage)?.getItem(key);
        if (raw == null) return fallback;
        const value = legacy ? raw : JSON.parse(raw);
        return accepts(value) ? value : fallback;
      } catch {
        return fallback;
      }
    },
    write(value) {
      try {
        if ((valid || legacy) && !accepts(value)) return false;
        const store = storage ?? globalThis.localStorage;
        if (!store) return false;
        store.setItem(key, legacy ? value : JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    reset() {
      try {
        const store = storage ?? globalThis.localStorage;
        if (!store) return false;
        store.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
