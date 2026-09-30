# Rendering performance

Parked cars and trees now use distance-based detail. Nearby scenery retains its existing meshes;
distant parked cars omit small trim and wheel spokes, and distant trees use fewer leaf cards,
simpler cores and trunks, and one batch per part instead of three variants. Both levels preserve
instance colors, placement and scale. Pull-outs hide the parked car in both levels.

The switch distance is 100 m plus the batch's bounding radius, with 10% hysteresis to avoid
flickering between levels. This conservatively keeps every nearby object detailed. Distant
levels do not cast shadows; the detailed levels retain shadows around the car. Static chunk
transforms are computed once, while parked-instance edits still upload normally.

## Road, shadow and reflection stability

Wet frames previously triggered WebGL feedback-loop errors: a reflective material left the
reflection texture bound as input while that same texture was attached to the render target.
Setting reflection strength to zero did not unbind the sampler. The mirror pass now unbinds
the texture and restores it afterward, including when rendering fails.

Reflection and main views also shared different generations of shadow maps. Wet frames now
update shadows in the reflection pass and reuse those fresh maps in the main pass. Scenery
detail is chosen once from the main camera before both passes, so the mirrored camera cannot
switch geometry independently. The reflection clips geometry below the road and fades at texture
borders, and blur dithering follows road coordinates rather than screen pixels.

The base ground plane now writes depth once. Road paint and surface color layers use depth
testing and a small raster bias without rewriting coplanar depth. This keeps the ground depth
stable for occlusion and avoids interpolated depth seams between overlapping triangles.

The high preset now renders at a maximum 1x pixel ratio with 2048 shadows, quarter-size
reflections, bloom and SMAA. Ambient occlusion, 4096 shadows, higher pixel ratios and half-size
reflections remain in ultra. This intentionally trades distant detail and AO for a lower GPU cost.

Hardware timer queries measured the following GPU render times against the first distance-detail
implementation, at the same 1280 × 800 CSS viewport and frozen spawn poses. Each case warmed up
for 12 renders, then sampled 12 renders. The GPU reported no disjoint clock condition.

| High preset | Mean GPU ms, first pass → current |
|---|---:|
| Dry afternoon | 14.85 → 6.97 |
| Rainy afternoon | 21.28 → 11.83 |
| Rainy night | 21.51 → 11.97 |

The current high preset uses fewer pixels and effects; these are not equal-quality comparisons.
The old wet pipeline also rejected draws due to its feedback loop. Raw GPU measurements are in
[`validation/render-stability-gpu.json`](validation/render-stability-gpu.json). GPU rendering cost
does not include CPU simulation or establish delivered FPS on another machine. Wet frames have
also been checked for zero GL errors across high/ultra/high/low transitions and during an
eight-second Rules drive that moved 50 m.

## First-pass geometry comparison

These earlier measurements describe the distance-detail changes before the stability fixes and
preset changes above; they are retained as the geometry baseline.

Measured on 2026-09-29 against commit `96bbd34`, using T3 Code's Electron 44 / Chromium 152
preview on macOS. Both versions used the included Kitsilano map, world seed 1, NPC seed 7,
40 traffic cars and 60 pedestrians, with the spawn poses frozen at simulation time zero and
the chase camera settled. The CSS viewport was 1280 × 800 (1920 × 1200 render buffer on high).
Each case warmed up for 12 renders, then sampled 60 renders. Counts include shadow,
reflection and post-processing passes. Raw measurements are in
[`validation/render-lod.json`](validation/render-lod.json).

| Case | Triangles before → after | Draw calls before → after | Mean CPU submission, ms before → after |
|---|---:|---:|---:|
| High, dry afternoon | 10,994,280 → 5,415,513 | 1,953 → 1,524 | 5.24 → 3.81 |
| Low, dry afternoon | 10,994,259 → 5,415,492 | 1,932 → 1,503 | 3.13 → 3.60 |
| High, rainy afternoon | 19,563,147 → 9,335,965 | 3,610 → 2,836 | 10.85 → 7.32 |
| High, dry night | 10,620,606 → 5,442,087 | 1,923 → 1,535 | 15.89 → 11.51 |

Submitted geometry falls by about 49–52%, and draw calls by 20–22%. These are single-view
samples, not guaranteed frame-rate gains. CPU timings vary with browser scheduling, garbage
collection and queued GPU work; low quality was slightly slower in this sample. The preview's
frame cadence is throttled, so it cannot establish delivered FPS. The hardware GPU profiler below
measures rendering work independently; check actual FPS in a visible browser while driving.

Smaller parked-car batches were also evaluated. They culled more geometry but increased draw
calls and CPU submission time, so parked cars retain their existing 360 m batches.

## Reproduce and test

Start `uv run server.py`, open `/?quality=high&weather=dry&time=afternoon`, and pause with `P`.
Use identical map, pose, time, weather, quality and viewport on both revisions. From the
simulator's browser console:

```js
const { profileRendering, profileGPU } = await import('/tests/render-profile.js');
profileRendering();
await profileGPU(); // reports unavailable if hardware timing is unsupported or invalid

const { runRenderTests } = await import('/tests/render-tests.js');
runRenderTests(); // each result should have ok: true
```

The profiler restores the pause state and renderer statistics configuration after sampling.
Renderer tests cover world transforms, paint, detail selection, hysteresis, geometry reduction,
nearby shadows, removal of a parked car from both detail levels without removing its neighbor,
reflection clipping, sampler/state restoration, quality changes and actual wet WebGL draws
(34 assertions when run from the simulator, including city lighting and street signs).
The existing `/tests` suite remains independent of Three.js and also passes (97 assertions), as
do the 50 Python tests and offline fixture checks. The subsequent drive-experience changes add
visual interpolation and gentler manual steering; the Rules/Jev controller and decision pipeline
remain shared with the benchmark.
