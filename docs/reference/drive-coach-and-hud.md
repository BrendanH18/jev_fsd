# Drive coach, HUD and controls

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

See [the scoring formula, thresholds and report behaviour](../drive-experience.md).

## Driving HUD

The redesigned HUD groups route guidance, driving instruments and pilot feedback:

| Area | What it shows |
|---|---|
| Left column | City and current street, next turn and distance, Rules / Decision ▾ / LLM ▾ buttons, autopilot switch, Settings and live drive coach |
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
the minimap and compact instruments sit below the left column. On coarse-pointer (touch) screens
— or on a desktop with `?touch=1` (`?touch=0` hides them) — on-screen touch driving controls
appear along the bottom strip with the replay deck and HUD above them, and hide in photo mode.
HUD animations and transitions respect the system's reduced-motion preference.

## Controls and driving feel

The simulator accepts **keyboard**, **on-screen touch controls** (`static/js/ui/touch.js`) and
**gamepads** (`static/js/ui/gamepad.js`). All three feed the same manual-driving path
(`World.stepManual`, combined once per frame in `static/js/ui/input.js`), so the physics, sensing,
scoring and autopilot are identical; any driving input takes over from autopilot, and driving
inputs are ignored while a modal dialog is open. See [Gamepad and touch](../drive-experience.md#gamepad-and-touch)
for full control tables and validation notes.

| Key or control | Action |
|---|---|
| Click the minimap | Set a destination and start autopilot |
| `W A S D` or arrows | Drive manually and take over from autopilot |
| `Space` | Brake hard |
| `J` | Toggle autopilot |
| `1` / `2` / `3` | Select the decision model / Rules / the LLM (also available as buttons; ▾ picks the model) |
| `Q` / `E` | Toggle left / right indicators |
| `H` | Horn when sound is enabled |
| `C` or **View** | Cycle chase, 360°, hood, overhead, high chase and cinematic cameras |
| `O` or **Photo mode** | Freeze the world, hide the HUD, adjust the look and save a PNG |
| **360° view** or drag the driving view | Orbit freely around the car; follows it as you drive |
| Wheel / pinch / camera + − | Zoom the 360° view |
| Shift + arrow keys (view focused) | Rotate the 360° view without steering |
| **Recenter** | Return the 360° camera behind the car |
| `R` / `P` | Reset to the lane / pause or resume replay |
| `I` / `V` / `T` | Toggle the decision inspector, AI Eyes, or telemetry |
| `M` / `X` / `L` | Toggle sound, open Explorer, or open Drive Lab |
| `?` or `/` | Toggle keyboard shortcuts |
| `Escape` | Leave photo mode, or close keyboard shortcuts or the decision inspector |
| **Explore cities** / **Explore drives** | Pick a city or suggested route |
| **Finish & review** / **History** | Review the current drive / saved drives |
| **Inspect JSON** | Open the decision inspector; on narrow screens, find it under **Settings** |
| **Settings** | Environment (weather, time, graphics, daylight clock, traffic cars, world seed), garage (6 vehicles, 6 paint colours), wipers, camera motion, **Start new world**, and Driving agents (**Active agent**, **Connect a model**, **Local agent module**) |
| **Sound** | Toggle procedural driving audio |

**Touch controls** (`?touch=1` to show on desktop, `?touch=0` to hide): a slide-to-steer pad on
the left (full lock at 90 px drag, self-centring on release), independent **Brake** (reverses when
stopped) and **Go** pedals on the right for multi-touch driving, and a centre row of quick toggles
(**Auto**, ◀ / ▶ indicators, **View**, **Pause**, **Reset**, **Horn**, and **Hard brake**).
Controls dim while autopilot drives
and hand over to manual on touch.

**Gamepad** (Browser Gamepad API, standard Xbox/PlayStation layout; browsers expose a pad after its
first button press): left stick or D-pad ←→ steers (15% stick dead zone by default, adjustable in Settings), `RT` / D-pad ↑
accelerates, `LT` / D-pad ↓ brakes and reverses when stopped (pads without analog triggers use the
left stick vertically), `A` brakes hard, `B` sounds the horn, `X` cycles camera, `Y` toggles
autopilot, `LB` / `RB` toggle indicators, `View` resets to the lane, and `Menu` pauses.

**Settings and free-drive switches**

- **Environment:** weather (`Dry`, `Rain`, `Fog`, `Snow`), time of day (`Dawn` through `Night`),
  graphics quality (`Low`, `High`, `Ultra`), daylight clock (`Fixed time`, `Real time`,
  `1 min / second`), traffic car density (`0`, `16`, `40`, `80`), world seed and a **Random** seed button.
- **Your garage & view options:** six vehicles (City hatch, Touring sedan, Sport coupe, Estate
  wagon, Trail SUV, Utility pickup) and six paint colours, **Wipers**, **Camera motion**, narrow-screen
  **Inspect JSON**, and **Start new world** (applies vehicle, paint, traffic density and seed while
  keeping cyclists and pedestrians active).
- **Driving agents:** **Active agent** picker, **Connect a model** (on the local server) and
  **Local agent module** loader for custom JavaScript drivers.
- **Free-drive feature switches** let you choose features and apply them to a fresh world. Free drives
  enable the switches by default through `static/js/sim/free-drive.js`. Each also accepts a URL query
  flag (for example `?buses=0`, `?roadside=0`, `?hazards=0`, `?park=0`, `?ice=0`, `?snowbanks=0`,
  `?puddles=0`, `?officers=0`, `?calming=0`, `?restrictions=0`; each feature's flag is listed on
  its page under [Features](README.md#features)).

Use `Tab` to reach controls. The Rules / Decision / LLM group has one tab stop; arrow keys,
`Home` and `End` select a driver. Decision remains visible when no decision model is usable;
arrow keys skip it, and clicking it opens **Connect a model** on TypeSafe. Focused controls retain their normal keyboard behaviour; click the road view
to use WASD, Space or arrows for driving. Driving shortcuts are ignored in form fields and
open dialogs, and shortcuts with Ctrl, Cmd or Alt keep their normal browser behaviour.

Keyboard steering ramps gently and limits cornering demand at speed while retaining full lock
for low-speed manoeuvres; analog stick, trigger and touch inputs scale the same steering and pedal
demands continuously from 0 to 1. Vehicles, cyclists, pedestrians and the camera interpolate between
physics steps for smoother motion. Physics, sensing and scoring still use fixed-step state.

Hood view adds windshield trim, rain beads and two sweeping wipers, with optional acceleration
and cornering motion. Procedural audio (`static/js/ui/drive-audio.js`) synthesizes motor, road,
rain and tire sounds, indicator clicks, a horn, emergency sirens and streetcar gongs with no
downloaded audio files. It starts only after enabling **Sound**, runs at a fixed master gain
(0.4, smoothly ramped; there is no separate volume slider), and automatically fades to silence
whenever the world is paused or the browser tab moves into the background (`world.paused || document.hidden`).
Manual indicators cancel after a completed turn or 12 seconds, and a speed warning highlights
speeding.
