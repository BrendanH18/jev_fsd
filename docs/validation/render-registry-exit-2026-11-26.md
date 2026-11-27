# Feature rendering behind the registry (ROADMAP 3.10)

Each feature now declares what it draws in a `view` exported by its own render module, which its
record points at. The browser adapter (`static/js/render/feature-views.js`) and `static/js/main.js` no
longer name a registered feature. The HUD notices, event badges and sounds that `main.js` worded itself
are record fields. See [Views](../feature-interface.md#views-what-a-feature-draws).

**Verdict: identical.** Compared with `7209939a`, every scene graph, every HUD notice, both arena
drivers' results and both system prompts match. `scripts/test_feature_exit.mjs` checks Phase 3's exit
test mechanically; [what a new feature still touches](../feature-interface.md#how-close-a-new-feature-is-to-its-own-file-its-challenge-its-test-and-one-registration-line)
lists what is left.

## What was outside a record or the adapter

At `7209939a` the adapter mounted every feature by name, and these were written into shared files:

| Where | What it named |
|---|---|
| `render/feature-views.js` | 16 scene mounts (bus lanes, turn and red-turn signs, traffic calming, sun glare, contraflow, driveways, potholes, balls, geese, road closures, black ice, puddles, officers, snowbanks, crossovers, scrambles); 3 kinds of map scenery (bus stops, streetcar tracks, rail); 9 vehicle kinds; 4 parked-car flags and the officers' cruisers; contraflow riders and driveway cars as traffic outside the fleet; hump and pothole effects, with a streetcar exception; high beams on the driven car and on traffic; the tailgater's flash; reversing lamps; the crossing guard's sign; the id prefixes of people who come and go |
| `main.js` | Dark signal lamps in a power cut; the HUD notices for emergency vehicles, buses, school buses, streetcars, level crossings, destination parking, hidden hazards and hidden traffic; the siren and the level-crossing gong; the high-beam tell-tale; contraflow riders on the minimap; the badges for a missed flagger stop, a dark signal and a merge out of turn; the parking space a drive finished by hand counts as an arrival in |
| `render/roads.js` | Scramble crossing markings |
| `render/actor-motion.js` | Clearing a pothole jolt and a flagger's paddle turn on a rewind |
| `render/minimap.js` | The emergency and transit vehicle kinds |
| `render/atmosphere.js` | The solar position, imported from the sun glare module |
| `render/perception.js`, `ui/lab.js` | AI Eyes text and highlights for eleven features (left as it is, see below) |

## What moved

- **Views.** 32 render modules export a `view`; 32 records point at one. The adapter compiles them
  into ordered lists and mounts scenery, scene objects, vehicle kinds, traffic outside the fleet, parked
  meshes, effects on ordinary cars and the driven car, road effects, what people carry and transient
  people. Three render modules are new: `high-beams.js`, `parkers.js` and `hidden-hazards.js`.
  Scramble markings moved from `roads.js` to `scrambles.js`.
- **Notices.** Eight notices moved to their records at three new notice slots (`first`,
  `afterCrosswalk`, `parking`), which keep their order among the app's own. A record can list several
  notices (hidden hazards has two), and a notice's `read` is handed the fleet.
- **Sounds, lamps, badges, arrival.** `sound` (emergency: siren; trains: gong), `signalLamp` (power
  cuts), `eventBadge` (work zones, power cuts) and `eventBadges` (lane closures), and `manualArrival`
  (destination parking, with `manualParked` in `sim/parallel-park.js`).
- **Motion resets.** A renderer registers how to clear its own motion history on a mesh
  (`onMotionReset`), so `resetActorMotion` names neither potholes nor work zones.
- **Minimap.** A vehicle view says how its kind is marked (`minimap: "emergency"` or `"transit"`).
- **Solar position.** `solarAngles` and `dayOfYear` moved unchanged to `sim/solar.js`; the sun glare
  module re-exports them.
- **Challenges.** `setupChallenge` passes a registered World option a challenge sets under the
  feature's own key. No existing challenge sets one that way beyond those it already names, which the
  exit check asserts.

Render-only parts stay render-only. No simulation module changed behaviour: the records gained
presentation fields, `sim/parallel-park.js` gained a function only the HUD path calls, and the solar
formulas moved without change.

## Not moved

- **AI Eyes** (`render/perception.js`, `ui/lab.js`) still words emergency vehicles, buses, school buses,
  streetcars, level crossings, work zones, lane closures, snow plows, scrambles, passing cyclists and
  hidden hazards, and imports `sim/bus.js`, `sim/emergency.js` and `sim/hidden-traffic.js`. A new
  feature uses the perception hooks. The exit check freezes that import list.
- **`setupChallenge`** still lists 29 older features' options under their challenges' names.
- **`brain/brain.js`** keeps the parking planner that `main.js` clears on a new route.

## How it ran

Boat, one `default` sandbox (4 vCPUs), Node 22.23.5, Python 3.12.3. **After** is the sandbox's checkout
of this worktree. **Before** is `git archive 7209939ad2c4adacac371e8812c0c37ff327e853` unpacked into a
separate directory, with the after tree's `scripts/render_parity.mjs` and `scripts/registry_parity.mjs`
copied into its `scripts/`.

### Scene graphs

```sh
node --experimental-default-type=module scripts/render_parity.mjs capture "$out.json"   # in each tree
node --experimental-default-type=module scripts/render_parity.mjs compare before.json after.json
```

66 scenes: all 60 challenges and both road tests, each driven by Rules for six seconds and drawn ten
times a second through the adapter in the app's frame order, then a checkpoint restored from the
recorder and two replay frames drawn toward the next checkpoint; and four free drives with every
opt-in feature on (Kitsilano dry at 15:30, in rain at 23:00 and in snow at 08:00, and Toronto dry),
drawn the same way. A frame's digest covers the whole scene graph in order: each object's name, type,
child count, position, rotation, scale, visibility, shadow flags, render order and light intensity, its
geometry attributes, index and groups, its instance matrices and colours, and each material's type,
colours, emissive intensity, roughness, metalness, opacity, transparency, depth and polygon-offset
settings and canvas drawing trace.

| Capture | Before | After |
|---|---|---|
| 66 scenes, 4,158 frames (63 a scene, two of them replay frames) | 31,469 objects in the last frames; the free drives hold 4,947 to 6,002 each | identical: 66 of 66 scenes, every frame |
| SHA-256 of the capture file | `74105df5630bf3429ac4ad2b6bef8a036c66821ac8dc33a7d8e3bef2a33b84c2` | the same |

The 25 November check, `scripts/test_5k_render-actors_adapter.mjs --scene-digest` (three frames of one
mixed scene, one a replay frame), still passes with its sample unchanged.

### HUD notices

```sh
node --experimental-default-type=module scripts/render_parity.mjs notices
```

The same 66 scenes driven for 25 seconds. Ten times a second, the notices the records announce at the
three new slots are compared with the badges the frame loop of `7209939a` showed, whose code the script
keeps as `legacyNotices`: text, style and duration, in order. All 16,500 frames matched, with 26 badges
of 14 kinds shown: the ambulance call nine times (said again each second it lasts), a bus pulling out,
a school bus, a streetcar's doors, two level-crossing lines, two parking lines, seven parked-car lines,
a child stepping out and a van hiding the oncoming lane twice.

### Simulation results

One loopback server from the after tree (`PYTHONHASHSEED=0 PORT=8331 uv run --locked server.py`), since
maps and routing are unchanged. From each tree:

```sh
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" rules
node --experimental-default-type=module scripts/registry_parity.mjs arena "$out" cautious
node --experimental-default-type=module scripts/registry_parity.mjs prompt "$out"
node scripts/registry_parity.mjs compare "$before" "$after" --only arena-rules.json,arena-cautious.json,system-prompt.json
```

| Capture | Before | After |
|---|---|---|
| Every challenge and both road tests, Rules (results, traces, events, reports) | 62/62 pass | identical |
| The same with the cautious agent | 62/62 pass | identical |
| Guarded and open system prompts | | identical |

The comparison leaves out timings and run provenance. The seeded benchmark was not rerun: no physics,
traffic, planner or router code changed.

### Checks

All on Boat, on the final tree:

- `npm run lint`: clean.
- `scripts/test_feature_exit.mjs` (new, 11 checks, 0.6 s), `test_feature_registry.mjs`,
  `test_free_drive.mjs`, the five `test_5k_registry-*` and five `test_5k_render-*` checks,
  `test_model_recording.mjs`, `test_drive_lab.mjs`, `test_challenge_modules.mjs`, `test_ci_shard.mjs`,
  `test_open_track.mjs`, `test_simulation_errors.mjs` and the checks of the features whose records
  changed (hidden hazards, hidden traffic, level crossings, parking, sun glare, work zones, outages,
  lane closures, emergency, buses, school buses, streetcars, scrambles): 33 of 33 files passed.
- `scripts/build_jev_fixtures.mjs --check`: 0 stale fixtures.
- `scripts/build_demo.py`: built (it follows the records' lazy view imports).
- `scripts/test_browser_pages.py --group pages` in Playwright Chromium against the local server: passed,
  including 314 browser tests, 220 renderer tests and 53 driving-app control checks. This is the check
  that loads `main.js` and the adapter in a real page.

Not run: WebKit (`scripts/shot.swift`, on the Mac), and the other browser groups, which CI runs.
