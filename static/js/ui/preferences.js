// Display and input preferences are independent of the saved world and its URL.
export function preference(name, fallback, storage = undefined) {
  const key = `jev-fsd-ui-${name}`;
  return {
    read() {
      try {
        const raw = (storage ?? globalThis.localStorage)?.getItem(key);
        if (raw == null) return fallback;
        const value = JSON.parse(raw);
        return typeof value === typeof fallback ? value : fallback;
      } catch {
        return fallback;
      }
    },
    write(value) {
      try {
        (storage ?? globalThis.localStorage)?.setItem(key, JSON.stringify(value));
      } catch {
        // The control still works for the current page.
      }
    },
  };
}
