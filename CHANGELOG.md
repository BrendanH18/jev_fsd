# Changelog

## Unreleased

- Bring your own LLM: an endpoint driver that speaks the OpenAI Chat Completions protocol, so it
  should work with OpenAI, OpenRouter, Groq, vLLM, LM Studio, Ollama and others; it has been
  tested only against a local mock server, not a real provider. Configure several in the gitignored
  `data/llm-endpoints.json` (template: `data/llm-endpoints.example.json`) or one with
  `JEV_FSD_LLM_*` in `.env`; each becomes a selectable driver `llm:<name>` in Settings, challenges,
  replay branches, the arena and `/bench`, labelled ready, unreachable, key rejected or no key.
  Keys and the choice of destination stay on the server (the browser sees only a
  credential-stripped base URL), and the configured key value is scrubbed from responses, traces
  and errors. The model picks among safety-checked candidates only and falls back to Rules (with
  the reason in the HUD and arena timelines) on invalid output, timeouts, HTTP errors or an
  exhausted budget; unusable replies still count their calls, tokens and cost. `timeout_s` is one
  real deadline per decision, covering the TCP connect, any proxy tunnel, the TLS handshake, the
  whole reply and a plain retry when an endpoint rejects structured output; only DNS resolution is
  left to the system resolver.
  Calls share `JEV_FSD_BUDGET_USD` and `JEV_FSD_RPM`; optional per-endpoint prices give costs,
  otherwise tokens are reported with an unknown ($0) cost that the budget cannot stop, and
  `rpm: 0` removes the rate limit too. The prompt lives in `static/js/brain/llm-prompt.js`;
  Inspect JSON shows the messages, raw reply and a curl. No new dependencies.

- Graphics artifact fixes. Sun shadows filter without screen-space noise, removing the crawling dot
  pattern inside tree crowns and other partial shadows. Leaf shadows sway with the leaves, leaf
  cards keep their crown shading on both faces, and crown interiors read as shaded foliage instead
  of a dark ball. Leaf textures keep their colour and roughly their coverage at a distance, so far
  trees no longer thin out or darken. Clouds fade detail that is too fine to draw near the horizon, wet-road
  reflections smear smoothly instead of in blocks, and snowflakes are round and size-capped.
- The High preset renders the scene and wet-road reflection with 4x multisampling and
  alpha-to-coverage foliage edges. Frame-time cost has not been measured against a baseline.

- Four new bundled neighbourhoods: Downtown Halifax, Winnipeg's Exchange District, Old Strathcona
  in Edmonton and Downtown & Nutana in Saskatoon. Twelve neighbourhoods across eleven Canadian
  cities, each with its own facade palette and a stylized silhouette (Citadel Hill, a prairie
  glass spire, a river-valley truss bridge, a riverside château and arched bridge).
- Map processing skips roofed streets and raised skywalk footprints, joins roundabouts split
  across several OSM ways, and keeps large roundabout lanes on their mapped carriageway.

- Re-baselined the seeded Rules benchmark on the current code. Kitsilano ran in dry, fog,
  rain and snow, and seven other cities ran smoke suites. The new committed run is
  `data/runs/20261014-091959-rules.json`. In the eight seeded dry suites tested in WebKit,
  `bbc9012` and `62fe050` produced identical summaries and per-route results, excluding wall
  time. On `62fe050`, Kitsilano dry scored 11/12 in WebKit and 10/12 in Node 22.23.2 (V8); the
  numerical cause was not traced. See [docs/rules-baseline.md](docs/rules-baseline.md).

- CI runs every check on each pull request: Python tests, all Node checks, Jev fixture drift,
  offline Jev requests, and the `/tests`, renderer and arena suites in headless Chromium
  (`scripts/test_browser_pages.py`). The Pages demo builds only after they pass.
- Fixed the renderer assertions, which crashed after the cloud deck was added because the
  render-loop test double had no sky.

- Procedural, drifting cloud deck in the sky, lit from the sun's side with a silver rim near the
  sun. Coverage follows the weather (scattered when dry, overcast in rain and snow, hidden in fog);
  clouds take the sun's colour at dusk and the city's glow at night, and appear in reflections.
- Colour-grade pass on High and Ultra: contrast, saturation, a time-of-day tint, soft vignette and
  dithering that removes sky banding.
- Cinematic camera (`C`): automatic cuts between roadside, bumper, aerial, lead and side-profile shots.
- Photo mode (`O` or **Photo mode**): pause the world, hide the HUD, choose a camera, adjust exposure,
  contrast, saturation, vignette and time of day, and save the frame as a PNG.
- README rewritten as a friendlier introduction and quick-start guide.

- Replay playback follows recorded timestamps, preserves its position when paused,
  catches up after slow frames and restarts from the beginning after reaching the end.
- Held driving keys clear when focus enters forms or dialogs, or the tab becomes hidden;
  editable fields and focused controls retain their keyboard behaviour.
- Drive reports and history remain usable when the browser blocks access to local storage.

- Comment cleanup across simulation, brain and render modules: shorter headers, removed
  redundant labels, fixed a stale snow grip note, dropped a dead candidate stub and unused
  NPC stop-line local. Normalized Python section banners and aligned the stdlib User-Agent
  with 0.2.0. Tightened CSP after vendoring Three.js; fixed Node static-collision imports so
  the document stub runs before `common.js`. README and docs test counts match the current suite;
  `pyproject.toml` points at this project's docs and demo.

- Saved agent evaluations with browser history, v1/v2 JSON import, selectable baseline drivers
  and deltas restricted to matching experiment conditions. Stopped and ambiguous attempts are excluded.
- Arena incident timelines with the most recent recorded decision, observed state, selected
  manoeuvre, candidate rejection reasons, emergency brakes, fallbacks and termination events.
- Two new deterministic challenges: a car merging from parking and a person emerging from
  behind a mapped building. Suite version 2; Rain check version 2 fixes its initial pedestrian hold.

- Drive Lab welcome screen with scenic drives, AI demonstrations and six fixed driving challenges.
- Geometric perception overlay with visibility, hidden-object inspection and candidate rejection reasons.
- Recorded drive checkpoints with interpolated playback, incident seeking, manual takeovers,
  driver changes and revalidated alternate manoeuvres. Replay branches and modified challenges are labelled.
- Shareable PNG score cards, reproducible challenge links and manual-arrival reports.
- Extensible agent registry, cautious starter agent, safety-checked adapter loading and a local
  evaluation arena with versioned JSON exports.
- Static GitHub Pages demo with all eight bundled maps and browser-side routing; no server or key required.
- Quieter default telemetry, distinct city facade palettes and decorative city silhouettes.
- Shorter README, new demo media and guides for replay, adapters and Pages deployment.

- Movable 360° camera follows the selected vehicle with mouse/touch orbit, wheel/pinch zoom,
  camera buttons, keyboard rotation and recentering. Existing fixed camera views remain available.

- Six selectable vehicle models and paint colours, with distinct proportions, detailed wheels,
  glazing, mirrors, lighting and trim. Driven vehicle dimensions and handling feed physics,
  stopping distances, traffic gaps, collision checks and cameras.
- Tree trunks, signposts, signal poles, lamps, porches and hedges share scenery placement with
  collision geometry; collision feedback identifies the struck object.

- Eight bundled neighbourhoods across seven Canadian cities, including Mount Pleasant, Calgary
  Beltline, Ottawa Centretown and Québec City Saint-Roch. Searchable, filterable world explorer
  with loading states, retries and preserved keyboard focus.
- Mapped buildings block the driven car and candidate predictions with swept footprint checks.
  Route-aware stop memory fixes indefinite waits when the front bumper reaches a stop line
  before the rear axle reaches the controlled segment; off-route driving retains lane auditing.
- Darkness limits forward and peripheral sensing and feeds speed planning. Fixed, real-time
  and accelerated daylight clocks; traffic density, repeatable world seeds and visible pause.
- Bundled Three.js runtime removes CDN startup dependency. A larger local-server request queue
  handles cold asset bursts, and startup failures show an actionable retry instead of an endless spinner.

- Redesigned trip and drive-coach cards, central driving instruments, a live decision summary,
  Settings and keyboard help. Manual drivers now receive turn-by-turn route guidance.
- Scrollable HUD columns and a narrow-screen inspector entry point; keyboard-accessible brain
  buttons, accurate fallback/stop labels, reduced-motion support and opaque instruments.
  HUD text refreshes at most 10 times per second and skips unchanged DOM writes.

- Bundled city selection for Vancouver, Victoria, Toronto and Montréal, with reachable suggested
  drives from the current pose and selected-city routing, benchmarks and replay.
- Live drive scoring for manual and autopilot drives, with category breakdowns, grades, coaching,
  event timelines, JSON export and local history. Waiting and pauses carry no penalty.
- Instanced street-name and speed-limit signs, optional procedural driving audio, indicators,
  a horn, speed warnings, hood-view rain/wipers and optional camera motion.
- Visual interpolation and speed-sensitive keyboard steering. Distance-based scenery detail and
  lighter high-quality GPU budgets; stable ground depth, synchronized shadows and a fix for wet
  reflection texture feedback loops. Measured rendering comparisons are documented separately.

- Building footprints occlude the ego's observations, predictions, and emergency brake. Fog,
  rain, and snow shorten sensing range; signal phases outside sight are unknown. Speed planning
  and candidate filtering use visible stopping room, including blind bends.
- Traffic can reserve a vacant curb bay and park at low speed. Parked cars open animated
  street-side doors with matching collision shapes; traffic reacts to the panels.
- Pull-outs leave more room for approaching traffic. NPC path recovery preserves the moving
  body's position and velocity.
- Jev weighs progress, clearance, comfort, roadside activity, and driving style instead of being
  directed to copy the Rules target-speed preference. Mid-block crossings distinguish approach,
  hold, and clearing the car's path. Candidates report comfort and clearance estimates.
- Eleven committed decision cases are generated through the actual driver pipeline. The snapshot
  checker validates requests offline and checks model expectations when a key is available.
- Live Jev behavior remains unverified; historical benchmark numbers describe the earlier world.

## 0.2.0

A large realism and graphics update. The Rules benchmark (seed 1) still passes 12 of 12 drives in
dry, rain, fog, and snow.

### Graphics
- Time of day with the sun's real path over Vancouver, a dawn and dusk sky, stars, and a moon.
- Ambient occlusion, bloom, and antialiasing, with low, high, and ultra quality settings.
- After dark: street lights with light pools, headlights (real beams on the driven car), tail
  lights, and lit windows. Wet roads mirror the street.
- New trees (leafy crowns that sway and cast dappled shadows), rounder cars with better lights,
  jointed pedestrians and helmeted cyclists, porches, chimneys and hedges, raised curbs, and
  pedestrian signal heads. A hood camera.
- The North Shore mountains, English Bay, downtown, Stanley Park, and the city around the map.

### Simulation
- Signal timing plans from approach speeds (ITE yellow, clearance all-red, walk and flashing hand).
- Drivers with individual temperaments; traffic waits for a gap at two-way stops and backs off from
  nose-to-nose standoffs. Parked cars sometimes pull out.
- Pedestrians sometimes cross mid-block, react to cars that will not stop, and walk at different
  speeds; fewer are out at night.
- Power-limited acceleration, drag, and rolling resistance in the car model.
- The planner anticipates lower speed limits, approaches stops at the target speed, and no longer
  treats a passing oncoming car as the car ahead.

### Fixed
- Traffic could pull out of a two-way stop in front of oncoming cars.
- Two cars could wait for each other indefinitely.
- The chase camera could jump when frames were advanced by hand in headless runs.

### Project
- New Rules baseline run, a new README, and 11 new browser tests.

## 0.1.0

First release: the simulator, the Jev and Rules drivers, the decision panel, and the benchmark.
