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
| `1` / `2` / `3` | Select the decision model / Rules / the LLM (also available as buttons; ▾ picks the model) |
| `Q` / `E` | Toggle left / right indicators |
| `H` | Horn when sound is enabled |
| `C` or **View** | Cycle chase, 360°, hood, overhead, high chase and cinematic cameras |
| `O` or **Photo mode** | Freeze the world, hide the HUD, adjust the look and save a PNG |
| **360° view** or drag the driving view | Orbit freely around the car; follows it as you drive |
| Wheel / pinch / camera + − | Zoom the 360° view |
| Shift + arrow keys (view focused) | Rotate the 360° view without steering |
| **Recenter** | Return the 360° camera behind the car |
| `R` / `P` | Reset to the lane / pause |
| `?` or `/` | Toggle keyboard shortcuts |
| `Escape` | Leave photo mode, or close keyboard shortcuts or the decision inspector |
| **Explore cities** / **Explore drives** | Pick a city or suggested route |
| **Finish & review** / **History** | Review the current drive / saved drives |
| **Inspect JSON** | Open the decision inspector; on narrow screens, find it under **Settings** |
| **Settings** | Weather, time, graphics quality, wipers and camera motion |
| **Sound** | Toggle driving audio |

Use `Tab` to reach controls. The Rules / Decision / LLM group has one tab stop; arrow keys,
`Home` and `End` select a driver. Decision remains visible when no decision model is usable;
arrow keys skip it, and clicking it opens **Connect a model** on TypeSafe. Focused controls retain their normal keyboard behaviour; click the road view
to use WASD, Space or arrows for driving. Driving shortcuts are ignored in form fields and
open dialogs, and shortcuts with Ctrl, Cmd or Alt keep their normal browser behaviour.

Keyboard steering ramps gently and limits cornering demand at speed while retaining full lock
for low-speed manoeuvres. Vehicles, cyclists, pedestrians and the camera interpolate between
physics steps for smoother motion. Physics, sensing and scoring still use fixed-step state.

Hood view adds windshield trim, rain beads and two sweeping wipers, with optional acceleration
and cornering motion. Procedural audio provides motor, tire, road and rain sounds, indicator
clicks and a horn; it starts after enabling sound and fades while paused or hidden.
Manual indicators cancel after a completed turn or 12 seconds, and a speed warning highlights
speeding.
