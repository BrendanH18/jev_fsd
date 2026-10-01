# Jev FSD

**Drive real Canadian streets, watch an AI choose its next move, and improve your driving score.**

Jev FSD is a local driving simulator built from [OpenStreetMap](https://www.openstreetmap.org/)
roads and buildings. Explore eight neighbourhoods across seven Canadian cities by hand, with the free
Rules driver, or with [TypeSafe AI's Jev](https://typesafe.ai/). The decision panel shows the
situation, available manoeuvres, model probabilities, latency and API cost.

Choose a suggested route, take the wheel, and review your drive for safety, road rules,
smoothness and control. Traffic parks and pulls out, car doors open, pedestrians cross, and
weather changes both visibility and grip. The driving HUD keeps turn guidance, speed, live
coaching and the pilot's latest decision visible while you drive.

![Rules driving in Kitsilano with the redesigned trip card, live drive coach, pilot decision card and speed instruments](docs/drive-hud.jpg)

> This is a research and demo simulator, not a system for controlling a real vehicle. The project
> is independent and is not affiliated with or endorsed by TypeSafe AI.

## Quick start

Install [uv](https://docs.astral.sh/uv/) and use a desktop browser with WebGL. The app needs
Python 3.10 or newer; `uv` manages Python and the project dependency.

```sh
git clone https://github.com/BrendanH18/jev_fsd
cd jev_fsd
uv run server.py
```

Open [127.0.0.1:8322](http://127.0.0.1:8322). Without an API key, the app selects the free Rules
driver. There is no frontend build step; the simulation and renderer use JavaScript and Three.js,
and the local server uses Python. The pinned Three.js runtime and all eight map packs are bundled,
so driving with Rules needs no external network after installing the Python dependencies.

Try **Explore cities → Victoria → Neighbourhood cruise**. A suggested drive starts the selected
autopilot; `W A S D` takes over manually. You can also click a destination on the minimap or
start a free drive with the keyboard. Cycle **View** to hood view and enable **Sound** for driving
ambience. Open **Settings** to change weather, time and graphics, or press `?` for keyboard help.

To enable Jev, obtain a key from the [TypeSafe console](https://console.typesafe.ai) and create
a local environment file:

```sh
cp .env.example .env
# Set TYPESAFE_API_KEY in .env, then restart the server.
```

The key stays on the server. Jev sends decision requests to TypeSafe; Rules driving, drive
scoring and the bundled maps need no API key.

## Explore eight Canadian neighbourhoods

The city picker includes neighbourhood-sized extracts of real roads, one-way streets, lane
and speed-limit tags, traffic controls and buildings. All eight processed map packs are bundled.
Search by city or neighbourhood, and filter by region and road character. The explorer keeps
your search and keyboard focus while loading maps or finding routes, and offers retries on errors.

| City | Neighbourhood | Direct simulator URL |
|---|---|---|
| Vancouver | Kitsilano | [/?map=kitsilano](http://127.0.0.1:8322/?map=kitsilano) |
| Vancouver | Mount Pleasant | [/?map=mount_pleasant](http://127.0.0.1:8322/?map=mount_pleasant) |
| Victoria | Old Town | [/?map=victoria](http://127.0.0.1:8322/?map=victoria) |
| Toronto | The Annex | [/?map=toronto](http://127.0.0.1:8322/?map=toronto) |
| Montréal | Le Plateau | [/?map=montreal](http://127.0.0.1:8322/?map=montreal) |
| Calgary | Beltline | [/?map=calgary](http://127.0.0.1:8322/?map=calgary) |
| Ottawa | Centretown | [/?map=ottawa](http://127.0.0.1:8322/?map=ottawa) |
| Québec City | Saint-Roch | [/?map=quebec_city](http://127.0.0.1:8322/?map=quebec_city) |

**Explore cities** offers three reachable drives from your current position: **Neighbourhood
cruise**, **City precision** and **The long way home**. The world pauses while choosing a route
or reading a drive report. Changing cities keeps your weather, time and graphics settings.
Routing, rerouting, benchmarks and 3D benchmark replays use the selected city's map.

The sun uses each city's latitude, longitude and late-September daylight-time offset.
Vancouver's mountains, water and landmark backdrop appear only on Vancouver maps. These packs
have no elevation data; building heights come from tags or procedural estimates.
See [map coverage, attribution and refresh instructions](docs/maps.md).

**Settings** includes a six-car garage, six paint colours, traffic-car density, a repeatable world
seed and **Start new world**. Choose a city hatch, touring sedan, sport coupe, estate wagon,
trail SUV or utility pickup; start a new world to apply your selection. Each driven model has
its own dimensions, mass, wheel power, drive layout and centre of gravity. Collision checks,
stopping distances, candidate predictions and cameras use the selected vehicle. Vehicle names
and specifications describe generic simulated cars.
Changing density or seed restarts the world and saves a non-empty active drive. A quiet world
still has cyclists, pedestrians and curb activity. URL options include `?traffic=16&seed=42`.
The daylight clock can remain fixed, run in real time or advance one minute per simulated second
(`?clock=0`, `1` or `60`). Pausing also pauses daylight. The conditions strip shows local time,
weather and forward sight range, with a visible Pause/Resume button.

## Drive coach and reports

A live card scores each drive out of 100 and offers coaching as you go. Manual driving, Rules
and Jev use the same deterministic scoring model; scoring makes no model calls.

| Category | Weight | What it measures |
|---|---:|---|
| Safety | 40% | collisions, time to collision and following gaps |
| Road rules | 30% | red lights, missed stops, failed yields and speeding |
| Smoothness | 20% | harsh braking, hard cornering and high jerk |
| Control | 10% | time off-road, wrong-way driving and lane resets |

Arrival opens a report automatically. **Finish & review** ends a drive manually; **History**
shows the last 20 reports stored in this browser, and **Export JSON** saves a report with its
event timeline and scoring-model version. Starting a replacement route or changing cities
saves a non-empty drive without claiming arrival.

Grades require at least **100 m and 10 seconds**. Short sessions remain practice drives. A
collision caps the total at 59; a red light or failed yield caps it at 69. Waiting at lights,
pausing and driving slowly carry no penalty. Emergency braking can reduce smoothness even when
it is the safer choice. Scores use the full simulated world, including hazards the driver
could not see; use the seeded benchmark for controlled driver comparisons.

See [the scoring formula, thresholds and report behaviour](docs/drive-experience.md).

## Driving HUD

The redesigned HUD groups route guidance, driving instruments and pilot feedback:

| Area | What it shows |
|---|---|
| Left column | City and current street, next turn and distance, Rules/Jev buttons, autopilot switch, Settings and live drive coach |
| Instrument cluster | Speed in km/h, mapped speed limit, indicators and manual, pilot or paused mode |
| Right column | Minimap, latest pilot decision, candidate probabilities, latency, tokens, cost, fallbacks and incident counts |

The trip card gives turn-by-turn guidance during both manual and autopilot driving. Speed and
limit highlights use the same 5 km/h speeding grace as the drive coach.

The **Pilot decision** card displays candidate speeds in km/h and up to five probability rows,
keeping the executed candidate visible when it has a probability. Rules probabilities describe
a deterministic choice, not model confidence. Jev responses have a green label; Rules fallbacks
have an amber label and no model probabilities. Locally resolved choices may also have no
probabilities. Turning autopilot off clears the latest latency and token fields; cost and p50
remain session statistics.

At widths of 900 px or less, the decision and incident cards are hidden and **Inspect JSON**
is available under **Settings**. Short screens hide category bars and secondary telemetry;
the HUD columns scroll to keep settings and drive actions reachable. At very narrow widths,
the minimap and compact instruments sit below the left column. Driving still requires a
keyboard; there are no touch driving controls. HUD animations and transitions respect the
system's reduced-motion preference.

## Controls and driving feel

| Key or control | Action |
|---|---|
| Click the minimap | Set a destination and start autopilot |
| `W A S D` or arrows | Drive manually and take over from autopilot |
| `Space` | Brake hard |
| `J` | Toggle autopilot |
| `1` / `2` | Select Jev / Rules (also available as buttons) |
| `Q` / `E` | Toggle left / right indicators |
| `H` | Horn when sound is enabled |
| `C` or **View** | Cycle chase, 360°, hood, overhead and high chase cameras |
| **360° view** or drag the driving view | Orbit freely around the car; follows it as you drive |
| Wheel / pinch / camera + − | Zoom the 360° view |
| Shift + arrow keys (view focused) | Rotate the 360° view without steering |
| **Recenter** | Return the 360° camera behind the car |
| `R` / `P` | Reset to the lane / pause |
| `?` or `/` | Toggle keyboard shortcuts |
| `Escape` | Close keyboard shortcuts or the decision inspector |
| **Explore cities** / **Explore drives** | Pick a city or suggested route |
| **Finish & review** / **History** | Review the current drive / saved drives |
| **Inspect JSON** | Open the decision inspector; on narrow screens, find it under **Settings** |
| **Settings** | Weather, time, graphics quality, wipers and camera motion |
| **Sound** | Toggle driving audio |

Use `Tab` to reach controls. The Rules/Jev group has one tab stop; arrow keys, `Home` and `End`
select a driver. Jev remains visible when no API key is configured, and selecting it explains
how to enable it. Space and arrow keys operate focused buttons; click the road view to use
them for driving. Driving shortcuts are ignored in form fields and open dialogs, and shortcuts
with Ctrl, Cmd or Alt keep their normal browser behaviour.

Keyboard steering ramps gently and limits cornering demand at speed while retaining full lock
for low-speed manoeuvres. Vehicles, cyclists, pedestrians and the camera interpolate between
physics steps for smoother motion. Physics, sensing and scoring still use fixed-step state.

Hood view adds windshield trim, rain beads and two sweeping wipers, with optional acceleration
and cornering motion. Procedural audio provides motor, tire, road and rain sounds, indicator
clicks and a horn; it starts after enabling sound and fades while paused or hidden.
Manual indicators cancel after a completed turn or 12 seconds, and a speed warning highlights
speeding.

## Graphics and recent rendering fixes

![A rainy-night Rules drive in Kitsilano with the current HUD and lights reflected in the wet road](docs/night-hud.jpg)

Parked cars and trees use distance-based detail to reduce distant geometry. Nearby scenery
retains detailed meshes and shadows, while hysteresis prevents repeated detail switches around
the distance threshold. Static scenery transforms are computed once.

Road layers share a stable ground depth. Wet reflections no longer sample their own render
target, and reflection and main passes share the same shadow maps and scenery detail within
each frame. These changes address road flicker, inconsistent shadows and wet-rendering errors.

Street-name and speed-limit signs use correctly proportioned printed rectangles, bolder street
lettering, padded atlas cells and up to 8× anisotropic filtering. Text reads correctly from
both sides. The signs keep their shared 2048² atlas and batched meshes. Driving instruments,
the drive coach, incident panel and windshield trim are opaque, and persistent HUD panels
avoid backdrop blur, so green scenery cannot bleed through the opaque surfaces.

HUD text and statistics refresh at most 10 times per second and skip unchanged DOM writes.
The decision card rebuilds only when a decision or autopilot state changes. These changes
reduce DOM work while physics and pilot decisions keep their existing cadence.

| Preset | Rendering |
|---|---|
| Low | Direct rendering at 1× pixel ratio, 2048 shadows, no post-processing or wet reflections |
| High | 1× pixel ratio, 2048 shadows, bloom, SMAA and quarter-size wet reflections |
| Ultra | Up to 2× pixel ratio, 4096 shadows, ambient occlusion and half-size wet reflections |

High is the default. URL options also work, for example
[Victoria in rain at night](http://127.0.0.1:8322/?map=victoria&weather=rain&time=night&quality=high).
Time accepts presets or a clock value such as `?time=17:45`.

Measured GPU work fell in the recorded rendering comparisons, but the high preset also uses
fewer pixels and effects than the earlier version. Those measurements do not establish a
frame-rate guarantee or an equal-quality speedup. See [rendering measurements, tradeoffs and
profiling instructions](docs/render-performance.md).

## Simulation and decision making

The car uses a dynamic bicycle model with saturating tire forces, weight transfer, power-limited
acceleration, actuator lag, drag and stability assistance. The same physical model runs traffic
cars and candidate predictions. Rain and snow reduce grip.

Traffic follows lanes, obeys signals, yields at junctions and crossings, changes lanes, reserves
curb parking, pulls in and waits for gaps before pulling out. Parked cars can open a street-side
door for six seconds; the animated door has matching sensing, prediction and collision geometry.
Cyclists ride bike routes, and pedestrians cross at signals or sometimes mid-block and carry
umbrellas in rain.

Buildings, tree trunks, signposts, signal poles, street lamps, porches and hedges physically block
the driven car and candidate predictions. Rendering and collisions share deterministic scenery
placements. Swept checks stop the car before penetration and count contact once until it separates;
collision scoring applies. Trunk radii follow the model, while overhead crowns remain passable.
Stop-line auditing and the planner share route controls while the car follows its route, so a
completed stop is remembered even when the rear axle remains on an adjacent road segment.

Buildings block the driver's view of traffic, pedestrians and signals. Daylight detection range is
**80 m dry, 55 m rain, 40 m snow and 28 m fog**. Darkness reduces forward low-beam sight to
45 m and unlit peripheral sight to 22 m, with a smooth twilight transition; weather caps both.
These sight limits feed actual sensing and speed planning. Unseen signal phases are treated as unknown,
and planning limits speed to stopping within visible road. Predictions and the emergency brake
use observed hazards; collisions and violations are audited against the full world.

Every 250 ms of simulated time near hazards, or 650 ms on open road, the shared driving pipeline:

1. **Senses** the visible world and projects the car onto its route.
2. **Proposes** up to 16 manoeuvres, including speed changes, small lateral shifts and stops.
3. **Simulates** each manoeuvre three seconds ahead and rejects unsafe or illegal options.
4. **Chooses** among the survivors using Jev or Rules.
5. **Executes** the chosen manoeuvre while the next decision is pending.

Jev answers typed multiple-choice questions with probabilities. Rules scores the same candidate
set locally. Both share sensing, safety filtering, physics and the controller. Jev reads
`driving_style`; Rules uses a fixed score. If Jev exceeds 1.5 seconds, returns an invalid choice
or errors, Rules handles that step and the fallback counter increases. Settled questions can
be answered locally without an API call.

The decision inspector exposes requests, answers, confidence, timing and spend; decisions can
be saved or copied as `curl` commands. The emergency brake responds to imminent observed
collisions, not traffic-rule violations, so driving mistakes remain visible.

## Benchmarks and validation

![The benchmark page](docs/bench.png)

Open [/bench](http://127.0.0.1:8322/bench), or use **Benchmark this city** in the explorer.
The benchmark runs seeded drives through the same simulation and autopilot without graphics.
**Lockstep** pauses while decisions are pending; **realtime** keeps the world moving so model
latency affects the drive. Runs save under `data/runs/`, support side-by-side comparison and
open as 3D replays on their recorded map.

A benchmark drive passes only if it arrives with no collision, red light, rolled stop or failed
yield, and less than one second off-road. It also reports comfort, lane keeping, fault, safety
brakes, gaps, tokens, cost and latency. This pass criterion is separate from the live coach's
weighted score.

Recorded validation includes a 500 m Rules drive through Victoria in rain with no audited
collision, red-light, stop or yield violations and a score of 97. The historical 12-route
realism suite passed 10/12 routes in both dry weather and fog. These are individual recorded
checks, not guarantees for every city or seed. Live Jev behaviour with the revised prompt has
not been validated; offline fixtures establish request consistency, not model judgment.

Detailed results: [drive experience](docs/drive-experience.md), [realism validation](docs/realism-validation.md)
and [rendering validation](docs/render-performance.md). Release history is in [CHANGELOG.md](CHANGELOG.md).
The [world expansion validation](docs/world-validation.md) records the new maps, physical building
collisions, darkness, startup reliability and final seeded comparisons.

## Custom maps and configuration

Keep custom extracts neighbourhood-sized: roughly 1–2 km across and under 0.25 square degrees.
Use `?bbox=W,S,E,N`, a preset name, or a server default:

```sh
JEV_FSD_BBOX="-123.1120,49.2570,-123.0940,49.2680" uv run server.py
uv run scripts/fetch_map.py mount_pleasant
```

Custom maps download and cache under `data/maps/`. If fetching fails, the app displays a
synthetic practice grid and labels it. Refresh a bundled preset with
`uv run scripts/fetch_map.py victoria --force`; see [map documentation](docs/maps.md) for raw-cache handling.

| Environment setting | Default | Purpose |
|---|---|---|
| `TYPESAFE_API_KEY` | None | Enable Jev |
| `JEV_FSD_BUDGET_USD` | `1.00` | Cap live Jev spend per server run |
| `JEV_FSD_RPM` | `240` | Cap live Jev calls per minute |
| `JEV_FSD_NPCS` | `40` | Set traffic-car count |
| `JEV_FSD_BBOX` | Kitsilano | Select a default area by bounding box or preset |
| `PORT` | `8322` | Set the server port |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | Set the model |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | Set the API endpoint |

## Privacy and limitations

The server binds to `127.0.0.1`, keeps the API key out of the browser and checks hosts, origins,
fetch metadata and session tokens. A per-run budget and rate limit guard live API spending.
TypeSafe receives the decision state and questions shown in the inspector: distances, speeds,
street names and manoeuvre descriptions, without map coordinates. Drive reports stay in this
browser's local storage unless you export them.

Map tags and procedural geometry limit realism. There is no road elevation or camber, and
visual body pitch and roll do not add a physical suspension model. Buildings, weather and darkness
determine sensing; trees and vehicles do not occlude it, and individual street lamps do not extend
detection range. Scenery collision checks use polygon exteriors and circular trunk/post cross-sections; courtyard holes and crash damage are not modeled. The driven car makes small lateral shifts rather than full lane changes;
traffic does not overtake cyclists, parking uses forward pull-ins, and pedestrians do not cross
against signals. Street-name and speed-limit posts block the car; their labels do not add sensing information.
Low curbs remain traversable, and scenery beyond the playable map is decorative with simplified geography.

## Development

```sh
uv run python -m unittest discover tests
node --experimental-default-type=module scripts/test_drive_score.mjs
node --experimental-default-type=module scripts/test_interpolate.mjs
node --experimental-default-type=module scripts/test_orbit_camera.mjs
node --experimental-default-type=module scripts/test_static_collision.mjs
node --experimental-default-type=module scripts/test_scenery_collision.mjs
node --experimental-default-type=module scripts/test_route_controls.mjs
node --experimental-default-type=module scripts/test_world_conditions.mjs
node --experimental-default-type=module scripts/test_vehicle_models.mjs
node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check
uv run scripts/verify_jev.py --offline
```

Open [/tests](http://127.0.0.1:8322/tests) for simulation and HUD checks. From the simulator's browser
console, run the WebGL renderer checks:

```js
const { runRenderTests } = await import('/tests/render-tests.js');
runRenderTests(); // Every result should have ok: true.
```

The documented validation covers 58 Python tests, 137 browser assertions (99 simulation, 18 HUD and 20 explorer),
88 renderer assertions, 18 scoring tests, 13 building collision regressions, 11 scenery collision regressions,
22 vehicle model regressions, six route-control regressions,
world-condition and interpolation checks, and 20 offline Jev requests.
Renderer checks include actual front/rear sign rasterization and wet frames across quality
transitions. HUD checks cover fallback and stop labels, unavailable Jev, keyboard driver
selection, probability rows, telemetry reset and the 10 Hz update bound. See
[HUD validation and viewport-review limits](docs/drive-experience.md#validation) and
[rendering performance](docs/render-performance.md) for DOM measurements and GPU profiling.

Run a seeded Rules benchmark after changing physics, traffic, planning or routing. Rebuild
committed Jev cases with `scripts/build_jev_fixtures.mjs` after changing sensing or question
wording. Live verification (`uv run scripts/verify_jev.py`) requires an API key and spends
credits. The fixtures are generated by the real production pipeline.

| Path | Contents |
|---|---|
| `server.py`, `jev/` | Local server, TypeSafe client, spend guard, OSM processing and routing |
| `static/js/sim/` | Physics, traffic, collisions, signals, parking, pedestrians and sensing |
| `static/js/brain/` | Candidates, Jev questions, drivers and safety brake |
| `static/js/ui/` | City explorer, drive reports, cockpit and driving audio |
| `static/js/render/` | Three.js scene, scenery, lighting, signs, reflections and post-processing |
| `static/js/bench/` | Seeded suites, headless runs and metrics |
| `scripts/` | Map fetching, fixture generation, verification and headless tools |
| `data/`, `docs/` | Map packs, decisions, runs, screenshots and validation reports |

To add a driver, implement `decide(snap, eligible, request, signal)` in `static/js/brain/`,
returning `{ motion, candidateId, meta }`. Register it in `brain.js` and the simulator and
benchmark menus. Before contributing, run the applicable tests and include a baseline comparison
when a change affects driving.

## Credits and license

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under the
  [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
- Rendering by [Three.js](https://threejs.org/) (MIT).
- Jev and TypeSafe are products of TypeSafe AI; this project is independent.
- Inspired by [JevPilot](https://github.com/standardagents/jevpilot).

Released under the [MIT License](LICENSE).
