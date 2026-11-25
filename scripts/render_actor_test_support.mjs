import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const three = new URL("../static/vendor/three/", import.meta.url);
    if (specifier === "three") return nextResolve(new URL("build/three.module.js", three).href, context);
    if (specifier.startsWith("three/addons/"))
      return nextResolve(new URL(specifier.replace("three/addons/", "examples/jsm/"), three).href, context);
    return nextResolve(specifier, context);
  },
});

// Canvas drawing is outside these scene-graph checks. Preserve the drawing inputs, including sign text.
const drawing = () => {
  const trace = [];
  return new Proxy(
    {
      trace,
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      measureText: (value) => ({ width: String(value).length * 12 }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    },
    {
      get(target, key) {
        return (
          target[key] ?? ((...args) => trace.push([key, ...args.slice(0, 6).filter((a) => typeof a !== "object")]))
        );
      },
    },
  );
};
globalThis.document = {
  querySelector: () => null,
  createElement() {
    const ctx = drawing();
    return { width: 0, height: 0, trace: ctx.trace, getContext: () => ctx };
  },
};
