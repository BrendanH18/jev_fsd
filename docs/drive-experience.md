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

The left column contains the trip card, the Rules / Decision ▾ / LLM ▾ buttons, autopilot switch and drive coach.
The trip card gives distances and turn directions while driving manually as well as under
an autopilot. The centre cluster shows speed in km/h, the mapped maximum and the driving mode.
Speeding highlights the speed and limit using the same 5 km/h grace as scoring.

The right column shows the minimap, latest autopilot decision and cumulative incident counts.
Decision labels convert candidate speeds from m/s to km/h. Up to five probability rows are
shown, keeping the executed candidate visible when it has a probability. Rules probabilities
are deterministic choices, not model confidence. A green label (`jev`, `decision:<name>` or
`llm:<name>`) identifies a model response; an amber fallback label identifies a Rules substitute. Local resolution and failed
model vectors do not invent probabilities or claim that only one option passed safety checks.
Turning autopilot off clears the current decision's latency and token fields; cost and p50
remain cumulative/session statistics.

**Settings** contains weather, time, quality, wipers and camera motion. **?** or `/` toggles
keyboard help; `Escape` closes help and the JSON inspector. `1` selects the decision model, `2`
Rules and `3` the LLM.
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
- **View** / `C` switches chase, 360°, hood, overhead, high chase and cinematic cameras. The cinematic
  camera cuts between roadside, bumper, aerial, lead and side-profile shots. `O` opens photo mode. Hood view displays the
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
and stop wording, the Rules / Decision / LLM buttons (every decision model drives under Decision,
an unavailable one is skipped by the arrow keys, and the public demo hides its ▾ menu), radio
keyboard selection, probability rows, telemetry reset,
unchanged DOM reuse, the 10 Hz update bound and expiry of the rolling decision count. The
2026-09-30 design review also checked layouts at 1280 × 800, 950 × 600, 800 × 600, 640 × 480,
390 × 640 and 320 × 480, including expanded settings, scroll access to drive actions and the
narrow-screen inspector. A final adjustment moves the compact cluster to the top below 1080 px
and to the bottom below 760 px; this last breakpoint adjustment could not be visually repeated
after the shared preview disconnected. These are desktop Chromium viewport checks, not
physical-device tests.

`node --experimental-default-type=module scripts/test_drive_score.mjs` runs 19 focused scoring
tests, including violation caps, fresh-session baselines, pauses, duration, hard braking, manual
gaps, history corruption and blocked storage. `scripts/test_interpolate.mjs` checks interpolation
without changing simulation state, wrapped headings and teleport handling.

The browser suite passes 146 assertions (99 simulation, 27 HUD and 20 explorer) and the renderer suite 106, including
manual-steering, city-sun, sign proportions, atlas padding, actual front/rear sign rasterization,
the skyline silhouettes of every bundled city and the graphics artifact regressions.
A layout check on the simulator page confirms that the three pillar buttons, their menus and the
autopilot switch fit inside the 300 px HUD panel: the pillars take its full width on one line,
with the switch below them.
The 158 Python tests include bundled-map,
selected-city routing, distinct reachable suggestions and fallback checks. Fixture checks remain
clean with 20 valid offline Jev requests.

A Rules neighbourhood drive through Victoria in rain completed 500 m in about 115 simulated
seconds with no collision, red-light, stop or yield violations and a score of 97. Its four hard
brakes reduced smoothness to 85, and the arrival opened a saved report automatically. This is a
single integration check, not a general driving-performance claim. High/ultra/high/low wet
frames also passed with zero GL errors with the new signs in the scene.

### Dim your high beams

In free drives the car chooses its beam every decision cycle. On dark streets,
high beams give a longer forward view of pedestrians and cyclists. A blue HIGH
BEAM indicator appears on the HUD and the light reaches farther ahead. The car
dips for oncoming traffic within 150 m, when following within 60 m, on lit streets,
and in fog or snow. NPC cars dip too, and briefly flash if your lights glare them.
More than 0.8 seconds of glare fails a Lab drive and lowers the coaching score.
Use `?highbeams=0` to disable this feature. The simulator uses Ontario's distances;
see the provincial rule distinction and sources in [project reference](project-reference.md#high-beams-simhigh-beamsjs).


### Slow down into a low sun

On a clear day with the sun low ahead, glare washes out what lies towards it. The car sees less
far that way, signals and people ahead come into view later, and it slows to the speed it can
stop from within what it can see; traffic heading into the sun slows the same way. The HUD says
**SUN GLARE · SLOWING** while the car is above that speed, and the sky shows a flare and a warm
haze when you look into the sun. In a Lab drive, more than a second over the glare speed (by more
than 1 m/s, after a moment to react and slow) fails the drive and lowers the safety score; the
report records `glare_speeding_seconds` once glare has applied. Free drives keep the sky's
late-September sun, so glare comes at sunrise and sunset; use `?sunglare=0` to turn it off.
See [Into the sun](drive-lab.md#into-the-sun).

### Respond to amber

With amber decisions enabled, ignoring a safe amber stop or speeding up to beat it costs
25 road-rules points and caps the total at 69. The report records `amber_lights_run` only
once an amber has been observed. The replay marks the violation and the coach explains
whether to stop safely or continue cautiously without accelerating. Red-light entry is
still scored separately. See [the paired lessons](drive-lab.md#paired-amber-light-lessons).


### Leave space to react

Free drives and the **Brakes ahead** / **Make room** lessons use grip-aware following
room. The coach and AI eyes show the current bumper gap and the target for speed and
conditions. Rain and snow increase the target. A newly encountered car moving sideways into the gap
gets a five-second recovery window before close-following deductions begin, once per
leader per drive. The coach still warns immediately when a collision is approaching.

With this option on, `close_following_s` measures time more than one metre below the
shared target while moving above 2 m/s, outside that recovery window; `danger_s` does not
charge the same leader's temporary TTC deficit during recovery. Other hazards, collisions
and comfort penalties still count. Reports include `following_policy` and
`following_recovery_s`. The old scoring formula remains for drives with the option off.
Use `?followingdistance=0` to disable it in free drives.


### Look both ways on a fresh green

With red-light runners enabled, a car crossing your way now and then runs a late amber or a fresh
red. When your light turns green, check that cross traffic has stopped: the HUD says
"CAR RUNNING THE RED · WAIT" and AI eyes outlines the runner while one cannot stop or is already in
the junction. Entering on green ahead of one, after you could have stopped for it, costs 25 safety
points, caps the total at 69 and is recorded as `fresh_green_conflicts` once a runner has committed
near the car. A collision with a runner is still a collision. Use `?redrunners=0` to disable
runners in free drives. See [Fresh green](drive-lab.md#fresh-green).


### Cars backing out of driveways

In free drives (and the **Reverse lights** lesson) a car now and then backs out of a driveway ahead,
its white reverse lamps on; driveways are drawn as concrete aprons across the sidewalk. The HUD says
CAR BACKING OUT AHEAD while it backs out toward your lane, and CAR BACKING OUT · GIVE IT ROOM once it
is coming into it. Slow down for it and stop until it has driven off. Squeezing past one closer than
1 m, or not stopping for one already in the lane, counts as `reversing_conflicts`: 20 safety points
each, a replay marker and a coaching tip, reported only once a car has backed out near you. Use
`?driveways=0` to turn them off.

### Spring potholes

In free drives (and the **Pothole season** lesson) the streets have potholes, many more on the
busy main streets than on quiet ones, drawn as dark, ragged holes in broken asphalt. In rain or
snow they hold water and look like any puddle, so they come into sight later. Where the lane leaves
room, the car eases over inside it so both wheels miss the hole, and the HUD says POTHOLE · EASE
0.5 M RIGHT IN THE LANE; where it doesn't, the car slows to about 20 km/h (less for a deep one, and
in the wet) and the HUD says POTHOLE AHEAD · NO ROOM · SLOW TO 19 KM/H (a 7 cm hole on a dry road). Traffic does the same, and
cars jolt as a tyre drops into one. A wheel into one more than 5 km/h faster than its safe speed
counts as `pothole_hits`: 10 comfort points each, a replay marker and a coaching tip, reported only
once the car has come near a pothole. Use `?potholes=0` to take them off.

### A ball, then a child

In free drives (and the **Chasing the ball** lesson), now and then by day, a bright ball bounces out
from between the cars parked along a residential street ahead and rolls across, spinning, until it
stops against the far kerb. A child runs out after it a second or two later, from behind the parked
cars, fetches it and walks back to the kerb with it. The HUD says BALL IN THE ROAD · A CHILD MAY
FOLLOW with the speed to slow to, then CHILD CHASING THE BALL · STOP once the child is out, and AI
eyes outlines the child. Slow to a speed you can stop from short of where the ball came out, and
keep to it until the child is back at the kerb. Passing that gap faster, after time to react, counts
as `ball_warnings_ignored`: 25 safety points, a replay marker and a coaching tip, reported only once
a ball has rolled out near you. Use `?balls=0` to turn them off.

### Geese crossing the road

In free drives (and the **Goose crossing** lesson) a gaggle of Canada geese now and then gathers on
the grass beside a street that runs beside a park or water, by day and not in snow, and walks across
in loose single file as you come along: brown-grey bodies, black necks and white chinstraps, now and
then with yellow-grey goslings, waddling at walking pace and grazing on the grass either side. The
HUD says GEESE BY THE ROAD AHEAD while they come up to the kerb, and GEESE CROSSING · WAIT FOR THE
LAST ONE once they step off. Slow down, stop short of them, and wait until the last goose is off the
road; one may stop in your lane. Driving on within 2 m of a goose on the road, or hitting one,
counts as `wildlife_conflicts`: 20 safety points each, a replay marker and a coaching tip, reported
only once a gaggle has crossed near you. Hitting one is also a collision. Use `?geese=0` to turn them
off.

### Tailgaters

In free drives (and the **On your bumper** lesson) a car that comes up behind you in your lane now
and then closes right up, about half a second back, and stays there: it edges in and out, drifts
left in its lane to look past you, and flashes its headlights. The HUD says TAILGATER · MOVE RIGHT
AND LET THEM BY where another lane goes your way, and TAILGATER · LEAVE MORE ROOM AHEAD otherwise;
the coach says the same while it is there. Don't brake-check it and don't speed up to please it:
leave twice your usual gap ahead so you can brake early and gently, and let it by, moving right when
it's safe or easing off a little. It reacts to your brake lights late: it follows a gentle stop, but
brake hard with it close behind and it can run into you (its fault). Braking harder than 4 m/s² with
a tailgater behind, well beyond what anything ahead called for, counts as `brake_checks`: 20 safety
points each, a replay marker and a coaching tip, reported only once a tailgater has followed you. Use
`?tailgaters=0` to turn them off.


### Black ice

In free drives while it snows (and in the **Bridges freeze first** lesson, and any drive whose
clock has a winter date: freezing fog, rain, or a clear frosty night, late at night and early in
the morning), thin
patches of black ice lie on bridge decks and overpasses and on stretches of street in the shade of
tall buildings, while the rest of the road looks dry or damp. They are drawn as a faint, glossy
glaze that darkens the asphalt a little and catches your headlights at night and a low sun by day;
by day you will hardly see one until you are close. On the ice the tyres have about a tenth of their
grip, for every car, cyclist and the car you drive: brake or steer hard on it and the car slides.
The HUD says BRIDGES FREEZE FIRST · 40 KM/H coming up to a bridge, BLACK ICE AHEAD · EASE OFF TO
28 KM/H BEFORE IT once a patch is in sight, and ON BLACK ICE · HOLD 28 KM/H · NO BRAKING OR SHARP
STEERING on it. Going onto a patch more than 10 km/h faster than its safe speed, or braking,
accelerating or skidding on one, counts as `ice_overspeed`: 20 safety points each, a replay marker
and a coaching tip, reported only once you have come near black ice. Use `?ice=0` to take it off.

### Snowbanks

When it is snowing as a free drive starts (and in the **One car at a time** lesson), snowbanks line
the kerbs: white, lumpy and grey with grit on the street side, piled higher than a person at the
corners. On narrow two-way residential streets with parking on both sides the banks push the parked
cars out, and there is room for only one moving car at a time. Take turns: whoever is already in the
narrow stretch, or got to it first, goes first, and the other waits at its end. The HUD says
SNOWBANKS · ONE CAR AT A TIME and whose turn it is; keep to the middle when it is yours. At a corner
where the pile hides the sidewalk and the side street, the HUD says SNOWBANK HIDES THE CORNER · CREEP
UP AND LOOK: someone may step out from behind it. Going in while a car you could see coming the other
way had the way counts as `snowbank_conflicts`: 20 legality points, a replay marker and a coaching
tip, reported only once you have come up to a narrowed stretch. Use `?snowbanks=0` to turn them off.

### Road closures

In free drives (and the **Road closed** lesson) a block on your route ahead is now and then closed
for an event: striped barricades with flashing amber lamps across both ends, ROAD CLOSED and DETOUR
signs, and festival tents on the block. You find out only when you can see the barricades. The HUD
says ROAD CLOSED AHEAD · DETOUR, the route line and minimap switch to the detour as soon as it is
planned, and the coach says to follow it. Driving past a barricade onto the closed block counts as
`closure_entries`: 20 safety and 25 legality points, a replay marker and a coaching tip, reported
only once you have come up to a closure; driving into a barricade is a collision. Use
`?roadclosures=0` to turn them off.
