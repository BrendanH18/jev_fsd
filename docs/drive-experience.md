# Drive coach and experience

Choose **Explore cities**, pick a city, then select one of three suggested routes. The simulator
pauses while the explorer or report is open and restores the previous pause state on closing.
The chosen driver starts the route. To take over, use `W A S D`; to return to autopilot, press `J`.
Manual input also starts a free-drive session when there is no active session.

The live card shows your distance, elapsed simulation time, four category scores and a coaching
message. Arrival opens a report automatically. **Finish & review** ends the current session;
**History** shows the last 20 reports saved in this browser. Starting another route saves a
non-empty active session as **replaced**. Changing cities saves it as **map changed**.
These statuses do not claim that the destination was reached. **Export JSON** saves the full
report, including the event timeline and scoring-model version.

## HUD and controls

The left column contains the trip card, Rules/Jev buttons, autopilot switch and drive coach.
The trip card gives distances and turn directions while driving manually as well as under
an autopilot. The centre cluster shows speed in km/h, the mapped maximum and the driving mode.
Speeding highlights the speed and limit using the same 5 km/h grace as scoring.

The right column shows the minimap, latest autopilot decision and cumulative incident counts.
Decision labels convert candidate speeds from m/s to km/h. Up to five probability rows are
shown, keeping the executed candidate visible when it has a probability. Rules probabilities
are deterministic choices, not model confidence. A green `jev` label identifies a model
response; an amber fallback label identifies a Rules substitute. Local resolution and failed
model vectors do not invent probabilities or claim that only one option passed safety checks.
Turning autopilot off clears the current decision's latency and token fields; cost and p50
remain cumulative/session statistics.

**Settings** contains weather, time, quality, wipers and camera motion. **?** or `/` toggles
keyboard help; `Escape` closes help and the JSON inspector. `1` selects Jev and `2` Rules.
The brain buttons also support arrow keys, Home and End, with one tab stop in the radio group.
Space and arrows retain their normal behaviour while a button is focused. Browser shortcuts
with Ctrl, Cmd or Alt do not trigger driving actions.

Below 900 px wide, the decision and incident cards are hidden and **Inspect JSON** moves into
Settings. Short screens hide category bars and secondary telemetry. HUD columns scroll when
necessary so settings and drive actions remain reachable. At very narrow widths the minimap
and compact instruments sit below the scrollable left column. Small-screen layout does not
add touch driving controls; driving still uses a keyboard. HUD transitions respect the system's
reduced-motion preference.

## Model v1

This is a deterministic simulation coaching model. It evaluates the same fixed-step state for
manual driving, Rules and Jev. It does not call a language model or spend API credits. It uses
the full world's audited violations and physical gaps, including objects the driver did not see.

Every category starts at 100 and is clamped to 0–100 after deductions:

| Category | Weight | Deductions |
|---|---:|---|
| Safety | 40% | 35 per collision, 15 additional per at-fault collision, 3 per second with TTC below 1.5 s, 0.6 per second with following gap below 1.2 s |
| Road rules | 30% | 35 per red light, 20 per missed stop, 25 per failed yield, 1.2 per speeding second |
| Smoothness | 20% | 3 per harsh-braking second, 1.5 per hard-cornering second, 0.8 per high-jerk second |
| Control | 10% | 5 per off-road second, 3 per wrong-way second, 15 per lane reset |

Speeding means more than 5 km/h over the mapped limit, with no rounding of the measured speed.
Harsh braking is below −3.5 m/s², hard cornering above 3 m/s² and high jerk above 5 m/s³.
Acceleration and following gaps are sampled at 10 Hz. A hard-braking event requires at least
0.2 seconds of sustained braking and counts once until braking subsides. Recorded timelines
are limited to 100 events so reports remain small.

The weighted total is rounded to an integer. Any collision caps it at 59; a red light or failed
yield caps it at 69. Grades require **at least 100 m and 10 seconds**: A ≥90, B ≥80, C ≥70,
D ≥60, E <60. Short sessions remain practice drives. There is no penalty for waiting, pausing,
driving slowly or API latency. An emergency stop can still reduce the smoothness score; a safer
drive takes priority over maximizing that category. Different routes and traffic conditions
create different demands, so use the seeded benchmark for controlled driver comparisons.

## Driving details

- `Q` / `E` toggle manual left/right indicators; they cancel after a completed turn or 12 s.
  Autopilot continues to indicate from its navigation plan. `H` plays a short horn when sound is on.
- **View** / `C` switches chase, hood, overhead and high chase cameras. Hood view displays the
  windshield frame, rain beads and wipers. **Settings → Wipers** disables the blades' automatic
  sweep in rain; **Camera motion** disables the subtle acceleration and cornering response of the hood camera.
- **Sound off/on** enables procedural motor, tire, road and rain sounds. Audio starts only after
  enabling it and fades when the world is paused or the page hidden. No audio assets download.
- Keyboard steering ramps at 0.8 rad/s and limits the angle at speed to a 3.2 m/s² cornering
  demand. Low-speed manoeuvres retain full lock; both direction keys together centre the wheel.
- Cars, bikes, pedestrians and the camera interpolate between physics poses for smooth drawing.
  Physics, sensing and scoring still use the actual fixed-step state. Teleports snap visually,
  and stalled rendering cannot accumulate an unbounded backlog of physics updates.
- Street names and mapped speed limits share a 2048² atlas and instanced boards/posts in 250 m
  chunks. The signs add no shadow casters. They are decorative; collision and sensing geometry
  continue to come from the simulation. Printed rectangles match each board's proportions,
  with larger bold street lettering, padded atlas cells and up to 8× anisotropic filtering.
  Lettering reads correctly from both sides. Windshield trim, driving instruments, the drive
  coach and incident panel are opaque so moving scenery cannot bleed through as green patches.
  Sun positioning uses each bundled city's latitude,
  longitude and September daylight-time offset; the season remains late September.

## Validation

The HUD checks in `static/tests/ui-tests.js` run automatically on `/tests`. They cover fallback
and stop wording, unavailable Jev, radio keyboard selection, probability rows, telemetry reset,
unchanged DOM reuse, the 10 Hz update bound and expiry of the rolling decision count. The
2026-09-30 design review also checked layouts at 1280 × 800, 950 × 600, 800 × 600, 640 × 480,
390 × 640 and 320 × 480, including expanded settings, scroll access to drive actions and the
narrow-screen inspector. A final adjustment moves the compact cluster to the top below 1080 px
and to the bottom below 760 px; this last breakpoint adjustment could not be visually repeated
after the shared preview disconnected. These are desktop Chromium viewport checks, not
physical-device tests.

`node --experimental-default-type=module scripts/test_drive_score.mjs` runs 18 focused scoring
tests, including violation caps, fresh-session baselines, pauses, duration, hard braking, manual
gaps, history corruption and blocked storage. `scripts/test_interpolate.mjs` checks interpolation
without changing simulation state, wrapped headings and teleport handling.

The browser suite passes 137 assertions (99 simulation, 18 HUD and 20 explorer) and the renderer suite 88, including
manual-steering, city-sun, sign proportions, atlas padding and actual front/rear sign rasterization.
The 60 Python tests include bundled-map,
selected-city routing, distinct reachable suggestions and fallback checks. Fixture checks remain
clean with 20 valid offline Jev requests.

A Rules neighbourhood drive through Victoria in rain completed 500 m in about 115 simulated
seconds with no collision, red-light, stop or yield violations and a score of 97. Its four hard
brakes reduced smoothness to 85, and the arrival opened a saved report automatically. This is a
single integration check, not a general driving-performance claim. High/ultra/high/low wet
frames also passed with zero GL errors with the new signs in the scene.
