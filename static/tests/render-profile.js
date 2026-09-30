// Compare CPU render submission and geometry in the current view, without advancing the world.
// Warm-up excludes shader compilation. This does not measure GPU time or delivered frame rate.
export function profileRendering(app = window.__jev, { frames = 60, warmup = 12 } = {}) {
  if (!app) throw new Error("Open the simulator and wait for it to load first");
  if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(warmup) || warmup < 0) {
    throw new Error("frames must be positive and warmup must be nonnegative integers");
  }
  const { world, view } = app, info = view.renderer.info;
  const paused = world.paused, autoReset = info.autoReset;
  world.paused = true;
  info.autoReset = false;
  try {
    for (let i = 0; i < warmup; i++) view.render(0);
    const times = [];
    for (let i = 0; i < frames; i++) {
      info.reset();
      const start = performance.now();
      view.render(0);
      times.push(performance.now() - start);
    }
    const sorted = [...times].sort((a, b) => a - b);
    return { quality: view.quality, weather: world.weather, camera: view.mode, frames,
      viewport: [view.canvas.width, view.canvas.height],
      draw_calls: info.render.calls, triangles: info.render.triangles,
      cpu_ms: { mean: times.reduce((a, b) => a + b, 0) / frames,
        p50: sorted[Math.floor(frames * 0.5)], p95: sorted[Math.floor(frames * 0.95)] } };
  } finally {
    world.paused = paused;
    info.autoReset = autoReset;
  }
}

// Hardware timer queries measure GPU work, including shadows and reflections. They complete
// asynchronously; report unavailable/disjoint samples explicitly instead of inferring FPS from CPU.
export async function profileGPU(app = window.__jev, { frames = 10, warmup = 6 } = {}) {
  if (!app) throw new Error("Open the simulator and wait for it to load first");
  if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(warmup) || warmup < 0) {
    throw new Error("frames must be positive and warmup must be nonnegative integers");
  }
  const { world, view } = app, gl = view.renderer.getContext();
  const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!extension) return { available: false, reason: "GPU timer queries are unavailable" };
  const paused = world.paused, queries = [];
  world.paused = true;
  try {
    for (let i = 0; i < warmup; i++) view.render(0);
    for (let i = 0; i < frames; i++) {
      const query = gl.createQuery();
      queries.push(query);
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      try { view.render(0); } finally { gl.endQuery(extension.TIME_ELAPSED_EXT); }
    }
    const start = performance.now();
    while (!queries.every(query => gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))) {
      if (gl.isContextLost() || performance.now() - start > 5000) {
        return { available: false, reason: "GPU timer queries did not complete" };
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (gl.getParameter(extension.GPU_DISJOINT_EXT)) return { available: false, reason: "GPU clock changed during the sample" };
    const times = queries.map(query => gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b);
    return { available: true, quality: view.quality, weather: world.weather, frames,
      viewport: [view.canvas.width, view.canvas.height], gpu_ms: {
        mean: times.reduce((a, b) => a + b, 0) / frames, p50: times[Math.floor(frames * .5)], p95: times[Math.floor(frames * .95)] } };
  } finally {
    for (const query of queries) gl.deleteQuery(query);
    world.paused = paused;
  }
}
