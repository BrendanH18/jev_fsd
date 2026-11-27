# Rendering performance

Parked cars and trees now use distance-based detail. Nearby scenery retains its existing meshes;
distant parked cars omit small trim and wheel spokes, and distant trees use fewer leaf cards,
simpler cores and trunks, and one batch per part instead of three variants. Both levels preserve
instance colors, placement and scale. Pull-outs hide the parked car in both levels.

The switch distance is 100 m plus the batch's bounding radius, with 10% hysteresis to avoid
flickering between levels. This conservatively keeps every nearby object detailed. Distant
levels do not cast shadows; the detailed levels retain shadows around the car. Static chunk
transforms are computed once, while parked-instance edits still upload normally.

## Parked wheels and sky refreshes

Parked bodies retain their 360 m batches. Near each batch, detailed wheels appear when a car of
that style is within 12 m of the camera and stay until all are at least 16 m away. The wheel mesh
switches geometry in place, retaining its instance transforms and draw count. Photo mode uses the
original detailed wheels wherever the body uses its near level.

On an Apple M5 in offscreen WebKit, the frozen Kitsilano afternoon chase view (seed 1, High,
1440 × 900) submitted 0.95 million fewer triangles per dry frame and 1.90 million fewer per
rainy frame. Switching between photo and driving wheel detail at the same pose kept the draw
count identical within each comparison. Rain took 22 ms with the original detail and 21 ms with
the driving detail. Dry took 14–15 ms and 14 ms respectively. These are median render times
over 24 frames after eight warm-ups per switch, including a one-pixel GPU readback.

The visible sky and lights follow every clock update. The prefiltered sky used by reflective
materials refreshes when the weather changes or the sun moves one degree since the previous
capture. Captures reuse the sphere and filter generator and dispose the previous render target.
The generator keeps a roughly 6 MiB scratch texture available for the next capture.
In the same dry view, 120 one-second clock increments reused the reflection map. Ten subsequent
time and weather changes left the renderer counts steady at 643 geometries and 91 textures.

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

Windshield trim, the driving instruments, drive coach and incident panel are opaque. Persistent
HUD panels avoid backdrop blur over the moving WebGL canvas; grass and reflected greenery
cannot show through the opaque surfaces. Street signs retain the same 2048² atlas and instance
batches, with proportionate printed rectangles, bold lettering, same-colour gutters, half-texel
UV insets and GPU-capped 8× anisotropy. Both sides show readable text without adding meshes or increasing render resolution.

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

## Graphics artifact fixes (2026-10-14)

Reported as "weird artifacting, particularly for clouds and trees". Causes and fixes:

- **Dotted, crawling shading inside tree crowns and other partial shadows.** Three.js r183's PCF
  filter takes five taps on a disk rotated by per-pixel interleaved-gradient noise, which only
  averages out with temporal accumulation; this renderer has none, so every penumbra (most of each
  crown) wore a fixed screen-space dot pattern. `scene.js` replaces it with a fixed 3×3 tent of
  hardware-filtered taps (`shadow /= 16.0`): similar softness, no noise. Cost: four more shadow
  taps per shaded fragment on every preset.
- **Shadow blotches swimming over leaves.** Leaf cards sway in the vertex shader, but their shadow
  caster did not, so each card was shadowed by its own offset copy. The leaf and conifer depth
  materials now apply the same wind. The cost was not measured.
- **Salt-and-pepper leaf shading.** Leaf cards carry crown-space normals, but the double-sided
  material flipped them on back faces, lighting about half the cards from inside the crown. The
  flip is undone, and inner leaves receive less sky light (a cheap crown-depth term).
- **Dark ball in every crown.** The core that hides the sky through gaps was a smooth, grey-tinted
  sphere large enough to swallow the inner leaf cards. It is now about 20% smaller, coloured like
  the crown's foliage and textured with the leaf clusters (triplanar: three extra texture reads,
  on the core only).
- **Distant trees thinning, sparkling and darkening.** The leaf texture's mip chain averaged alpha
  below the cutoff (for a leaf-like test texture, the share of texels passing it fell from 0.20 at
  full size to 0.06 at 8×8 and to zero below) and averaged black from transparent texels into the
  leaf colour. `cutoutTexture` builds the chain by hand: alpha-weighted colour pushed into
  transparent texels, and each level's alpha rescaled to approximate full-size coverage. The real
  leaf texture holds 0.34–0.36 from 256² down to 16²; smaller levels have too few texels to match it
  (0.39 at 8², 0.31 at 4², 0.25 at 2², none at 1²), which only matters for cards about two pixels wide. Distant crowns use fewer, larger cards set slightly deeper,
  so their leaf cover matches the detailed crowns. Startup cost only.
- **Hard, crawling leaf edges.** High now renders the scene into a 4× multisampled target (no AO
  there, so no depth texture is needed) and leaves use alpha to coverage; Low gets the same from the
  antialiased canvas. Ultra keeps a single-sample target for AO and relies on its 2× pixel ratio,
  so the view switches alpha to coverage off there: on a single-sample target Three keeps the
  partly transparent edge texels as opaque fragments, which sparkled across every crown. The
  wet-road mirror pass draws the same leaves, so its target takes the main target's sample count.
- **Cloud shimmer toward the horizon.** The deck is projected onto a flat ceiling, so cells shrink
  without limit near the horizon and the finest octaves alias (and the sunward lighting term
  amplifies them fivefold). The noise now measures its pixel footprint with screen derivatives and
  fades each octave to its mean before it drops below about two pixels.
- **Blocky wet-road reflections.** The smear's per-tap jitter was quantized to 3 cm road cells,
  several pixels wide near the camera. The reflection target is now mipmapped and each smear tap
  reads the level whose texels match the tap spacing, so taps overlap without jitter.
- **Square snowflakes.** Points were hard-edged squares that grew into tiles in front of the lens;
  they are round, soft-edged sprites capped at about 1.5% of the view height. Three's `scale`
  uniform is half the CSS height, so the cap also multiplies by the pixel ratio.

Renderer assertions cover the noise-free shadow filter, leaf mip coverage and colour, swaying
shadow casters, multisampling with and without AO, alpha to coverage only where multisampled
(including the reflection pass), and the mipmapped reflection. They pass on
Low, High (rain, 4× MSAA) and Ultra (rain) with no GL errors.

Timing after the change, in a headless WKWebView (Metal) at a 1440 × 900 viewport, spawn pose,
afternoon: each render followed by a 1-pixel readback to wait for the GPU, median of 40 after 15
warm-up renders (1 ms timer resolution). Low 13 ms dry / 13 ms rain; High 15 / 24; Ultra 23 / 33.
A matching baseline run could not be completed in that session, so the added cost is not
measured; the main new cost is High's multisampled scene target (resolve plus 4× colour/depth
storage), then four extra shadow taps per lit fragment on every preset.

## HUD design review (2026-09-30)

The redesigned HUD refreshes text and statistics at most once every 100 ms. Unchanged text and
mode classes retain their DOM nodes. The decision card rebuilds only when the decision object
or autopilot state changes. Manual navigation caches route projection and turn lookup for
100 ms and invalidates the cache when the route changes. Indicator blinking still follows the
render loop; physics and decisions keep their existing cadence.

In a paused Kitsilano scene in the T3 Chromium preview, 120 repeated calls with unchanged HUD
state produced 2,040 DOM mutations before the review fixes and zero after warm-up with the
fixes. `MutationObserver` counted child, text and attribute changes across the HUD subtree.
The new HUD regression suite checks zero mutations for an unchanged update and verifies that
speed changes wait for the next 100 ms refresh. This measures avoided DOM work, not GPU time,
compositing cost or delivered FPS; the older GPU measurements above do not include this review.

Persistent panels use a dark background without backdrop filtering; instruments, drive coach
and incidents use a solid background. The low preset also removes HUD panel shadows. Speeding
uses a static highlight instead of an infinite glow animation. Reduced-motion preferences
disable CSS transitions and animations. The temporary toast retains its blur, and modal-dialog
backdrops may blur while the simulation is paused.

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

## Traffic signal batching

Vehicle lenses, turn arrows, walk figures and hands each share one instanced mesh for the map.
Camera-facing glows share one mesh per mast so they sort near the mast's depth alongside weather
and glass. They use the same phase as their lenses. Steady phases leave the instance buffers
alone. The pedestrian face shows the walk figure and hand in turn so the opaque symbols cannot
cover each other.

Matched profiles used Boat's headless Chromium 151 with SwiftShader at 1440 × 900, High, on
Kitsilano at a frozen afternoon chase pose. Set the drive seed to 1, pause at simulation time
zero, and place the ego 28 m back from the first signal approach's far-side mast
(`sig0`, edge `e354`), centered on that approach and facing the signal. Snap the camera and
use `profileRendering` with one warm-up and two sampled frames. The counts cover the full
frame, including shadows, reflections and post-processing.

| Weather | Draw calls before → after | Triangles before → after |
|---|---:|---:|
| Dry | 1,426 → 1,350 (−5.3%) | 2,980,675 → 2,992,841 |
| Rain | 2,646 → 2,494 (−5.7%) | 5,006,699 → 5,031,031 |

Map-wide face batches submit some off-screen lamp geometry, adding less than 0.5% to the frame's
triangle count in each profile. These measurements cover draw submission in a single view with
software WebGL. Use hardware timings to evaluate GPU performance.

## GPU weather and tire spray

Rain and snow keep their seeded positions on the GPU. The vertex shaders wrap them around the
viewing camera and apply wind, fall and snowfall sway. Each frame updates only the precipitation
clock and camera anchor, eliminating the 120,000-byte rain or 72,000-byte snow position upload
on moving frames. Rain now uses soft-edged quads stretched along the fall direction. Snow keeps
its round texture and on-screen size cap.

In rain, forward-moving road vehicles near the camera share one tire-spray batch. The closest
24 vehicles whose spray can reach the view get a slot. The shader spreads
and fades the spray behind the wheels using each vehicle's rendered pose and speed. Spray phase
follows the drive clock, so paused and replayed poses produce a consistent spray pattern.

The matched High-preset profiles reused the frozen Kitsilano chase pose above, at 1440 × 900 on
Boat Chromium 151 (ANGLE, Intel UHD 620). Counts include shadows, reflections and post-processing.

| Weather | Draw calls before → after | Triangles before → after |
|---|---:|---:|
| Dry | 1,350 → 1,350 | 2,992,841 → 2,992,841 |
| Rain | 2,494 → 2,494 | 5,031,031 → 5,051,031 |

The rain quads add 20,000 triangles across the main and reflection passes, about 0.4% of the
matched frame. The frozen pose had no vehicle moving fast enough to spray. With spray active, the
batch adds one draw per scene pass. These profiles measure submitted geometry and calls.

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
(106 assertions when run from the simulator, including city lighting, sign proportions, city skyline
silhouettes, artifact regressions and front/rear WebGL lettering).
The `/tests` suite remains independent of Three.js and also passes (146 assertions: 99 simulation,
27 HUD and 20 explorer), as do the 158 Python tests and offline fixture checks. The subsequent drive-experience changes add
visual interpolation and gentler manual steering; the Rules/Jev controller and decision pipeline
remain shared with the benchmark.
