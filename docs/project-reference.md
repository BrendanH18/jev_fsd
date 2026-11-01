# Jev FSD

**Drive real Canadian streets, watch an AI choose its next move, and improve your driving score.**

Jev FSD is a local driving simulator built from [OpenStreetMap](https://www.openstreetmap.org/)
roads and buildings. Explore twelve neighbourhoods across eleven Canadian cities by hand, with the free
Rules driver, or with [TypeSafe AI's Jev](https://typesafe.ai/). The decision panel shows the
situation, available manoeuvres, model probabilities, latency and API cost.

Choose a suggested route, take the wheel, and review your drive for safety, road rules,
smoothness and control. Traffic parks and pulls out, car doors open, pedestrians cross, and
weather changes both visibility and grip. The driving HUD keeps turn guidance, speed, live
coaching and the pilot's latest decision visible while you drive.

![Rules driving in Kitsilano with the redesigned trip card, live drive coach, pilot decision card and speed instruments](drive-hud.jpg)

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
and the local server uses Python. The pinned Three.js runtime and all twelve map packs are bundled,
so driving with Rules needs no external network after installing the Python dependencies.

Try **Explore cities → Victoria → Neighbourhood cruise**. A suggested drive starts the selected
autopilot; `W A S D` takes over manually. You can also click a destination on the minimap or
start a free drive with the keyboard. Cycle **View** to hood view and enable **Sound** for driving
ambience. Open **Settings** to change weather, time and graphics, or press `?` for keyboard help.

To enable Jev, obtain a key from the [TypeSafe console](https://console.typesafe.ai), click
**Decision** (or press `1`), paste the key under **TypeSafe** and choose **Save and drive**. The
server saves it to `.env` as `TYPESAFE_API_KEY` and Jev is available at once. Or create the file
by hand:

```sh
cp .env.example .env
# Set TYPESAFE_API_KEY in .env, then restart the server.
```

The key stays on the server. Jev sends decision requests to TypeSafe; Rules driving, drive
scoring and the bundled maps need no API key.

## Explore twelve Canadian neighbourhoods

The city picker includes neighbourhood-sized extracts of real roads, one-way streets, lane
and speed-limit tags, traffic controls and buildings. All twelve processed map packs are bundled.
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
| Halifax | Downtown | [/?map=halifax](http://127.0.0.1:8322/?map=halifax) |
| Winnipeg | Exchange District | [/?map=winnipeg](http://127.0.0.1:8322/?map=winnipeg) |
| Edmonton | Old Strathcona | [/?map=edmonton](http://127.0.0.1:8322/?map=edmonton) |
| Saskatoon | Downtown & Nutana | [/?map=saskatoon](http://127.0.0.1:8322/?map=saskatoon) |

**Explore cities** offers three reachable drives from your current position: **Neighbourhood
cruise**, **City precision** and **The long way home**. The world pauses while choosing a route
or reading a drive report. Changing cities keeps your weather, time and graphics settings.
Routing, rerouting, benchmarks and 3D benchmark replays use the selected city's map.

The sun uses each city's latitude, longitude and late-September daylight-time offset.
Vancouver's mountains, water and landmark backdrop appear only on Vancouver maps. These packs
have no elevation data; building heights come from tags or procedural estimates.
See [map coverage, attribution and refresh instructions](maps.md).

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

See [the scoring formula, thresholds and report behaviour](drive-experience.md).

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

## Graphics and recent rendering fixes

![A rainy-night Rules drive in Kitsilano with the current HUD and lights reflected in the wet road](night-hud.jpg)

The sky draws a drifting procedural cloud deck. Each cloud is lit from the sun's side, with a
silver rim near the sun. Coverage follows the weather: scattered fair-weather cumulus when dry and
a continuous low deck in rain or snow; fog hides it. At dusk the clouds take the sun's colour, and
at night they reflect the city's glow. Wet roads and car paint reflect the same clouds through the
environment map.

On High and Ultra, a grade pass after tone mapping sets contrast, saturation, a time-of-day tint
(warm at golden hour, cool at night) and a soft vignette. It also adds a ±½-step dither that removes
8-bit banding in smooth sky gradients.

The **cinematic** camera cuts automatically between five shots: a roadside camera the car sweeps
past, a low bumper chase, a slow helicopter orbit, a tracking shot from ahead and a wheel-height
side profile. **Photo mode** (`O`) pauses the world and hides the HUD. You can frame the car with
the free, cinematic, chase or hood camera. Sliders set exposure (±2 EV), contrast, saturation,
vignette and time of day. **Save photo** downloads the rendered frame as a PNG at the canvas
resolution; the controls are never included. Leaving photo mode restores the previous camera,
the default look and the previous pause state.

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
profiling instructions](render-performance.md).

## Simulation and decision making

The car uses a dynamic bicycle model with saturating tire forces, weight transfer, power-limited
acceleration, actuator lag, drag and stability assistance. The same physical model runs traffic
cars and candidate predictions. Rain and snow reduce grip.

Traffic follows lanes, obeys signals, yields at junctions and crossings, changes lanes, reserves
curb parking, pulls in and waits for gaps before pulling out, looking again until it is moving. Parked cars can open a street-side
door for six seconds; the animated door has matching sensing, prediction and collision geometry.
Cyclists ride bike routes, keeping right: where a street's parking lane is empty to the end of the
block they ride in it, past cars queued at the corner, and move back into the traffic lane before
the next parked car once nothing is beside them. A car turning right, the driven car included,
waits for a cyclist coming up on its right (a right hook). Pedestrians cross at signals, at the
marked crosswalks between junctions (half of those walking past one cross there, stepping off once
nothing coming is too close to stop for them, BC MVA s. 179) or sometimes mid-block, and carry
umbrellas in rain. A vehicle in traffic hides a person behind it from the driver. Nobody may pass a
vehicle stopped at a crosswalk (BC MVA s. 179(3)): the driven car coming up beside one in another
lane stops 3.5 m short of the crosswalk's centre, if it could do that braking at up to 3.5 m/s^2
when it first saw it, and goes on once it has stood still there for 2 s (see
`static/js/sim/crosswalk.js` and [maps.md](maps.md#crosswalks)). In a free drive an ambulance or a fire truck
answers a call now and then, lights flashing and siren wailing (with **Sound** on), coming up
behind the car, toward it or across the junction ahead; everyone pulls over to the right, clear of
any junction, and stops until it has gone by (`?emergency=0` turns them off). Buses run their
real routes (up to four at a time, `?buses=0` takes them off) and stop at the routes' real stops:
they signal, pull in to the curb, wait 10 to 25 s with their doors open, signal left and pull out.
Where the limit is 60 km/h or less, traffic and the driven car coming up behind a bus at a stop
that is signalling to pull out let it go first (BC Motor Vehicle Act s. 169.1) when they can stop
2 m behind it braking at up to 3 m/s^2; nobody parks in a bus zone, and traffic eases left in its
lane to get past a bus standing at its stop. See `static/js/sim/bus.js` and
[maps.md](maps.md#bus-and-streetcar-routes) for where the routes come from. On the school run (7:00 to 17:00)
two school buses drive the streets (`?schoolbuses=0` takes them off) and every 150 to 400 m stop in
their lane, mid-block on a two-way street with one lane each way and a limit of 50 km/h or less, to
let one to three children off: ambers flashing as they slow, then reds and the stop arm. Some of
the children cross the street in front of the bus. Traffic both ways and the driven car stop for a
school bus with its reds flashing (BC Motor Vehicle Act s. 149), 5 m behind it or 10 m short of its
front, when they can stop there braking at up to 3.5 m/s^2, and wait until the reds go off; the bus
keeps them on until its children are across. See `static/js/sim/school-bus.js`.

School and playground zones (BC Motor Vehicle Act s. 147) come from each map's schools and
playgrounds in OpenStreetMap ([maps.md](maps.md#school-and-playground-zones)). Where one is in
effect the limit is 30 km/h, never more than the street's own: a school zone's from 8:00 to 17:00 (the
sim has no calendar, so every day is a school day), a playground zone's from dawn to dusk (while the
sun, as the sky draws it, is above -6 deg). The world's road info reports the zone's limit and the
zone, so the HUD's limit sign turns yellow-green and says SCHOOL or PLAYGROUND, the coaching score
counts speeding against it (and says so once a visit), and Rules keeps to it. Rules also slows on
the way in, to be at the zone's limit as its front reaches the sign, and traffic keeps to it from
15 m before. Signs stand where each stretch of zone starts and, short of the end of its street, where
it ends. AI eyes outlines the zones in effect nearby in yellow-green. The seeded benchmark drives no
zones (its world has no clock); a benchmark replayed in the app likewise. See
`static/js/sim/speed-zones.js`.

Slow down, move over (BC Motor Vehicle Act Regulations s. 47.02): in a free drive two vehicles stand
at the roadside with their lights flashing at any time (`?roadside=0` takes them off), each in two
bays of a street's right-hand parking lane, 150 to 450 m from the car and out of its sight, for 2.5
to 6 minutes, leaving once the car is well away: a tow truck (amber lights) in front of the car it is
about to tow, or a police car (red and blue) behind the car it has pulled over. They are parked cars
that never pull out or open a door, so traffic, cyclists and collisions treat them as such. Passing
one going its way, from 30 m short of its rear until past it, the limit is 40 km/h (70 where the
street's is 80 or more): traffic keeps to it in every lane from 40 m before that, and Rules keeps to
it from the way in, as the snapshot's `limit`. In the lane next to it, where another lane goes the
car's way, the car is offered a `move_over` lane change to the left (not within 5 m of it, and only
into a lane that runs on past it), and Rules takes it and stays out of that lane until past it, if
it safely can. The coaching score counts passing too fast and passing it in the lane next to it,
each once a vehicle, with a tip; the HUD says "TOW TRUCK · LIGHTS FLASHING · SLOW TO 40 · MOVE OVER",
and AI eyes outlines it in amber. The seeded benchmark and the other challenges have none. See
`static/js/sim/roadside.js`.

Streetcars (Ontario Highway Traffic Act s. 166): in a free drive two streetcars run the map's
streetcar runs (`?streetcars=0` takes them off; only The Annex has any, the 511 on Bathurst Street),
placed and replaced as buses are. A streetcar keeps to the lane its track is laid in, never changing
lanes or pulling over, stops in it at each of its stops, and opens its doors while up to three
riders get off across the lane beside it to the curb and up to three walk out to it from the curb;
its doors never close on a rider in the street. At the end of its run it waits until the car is well
away or out of sight, and leaves. A driver going its way, behind it in its lane or in the lane beside
it on the curb side, stops 4 m behind its rear doors (the law's line is 2 m behind them; 4 m behind
it in its own lane) while they are open, if it could stop there braking at up to 3.5 m/s^2 when it first saw them open: traffic,
cyclists and the driven car alike. Rules gets a `stop_for_streetcar` candidate and rejects going past
that point (`passes_streetcar_doors`), and slows for a streetcar slowing for its stop. Decision models
and LLMs get `streetcar`. The audit counts a failure to yield once a stop if the car, owing it,
comes within 2 m of the rear doors at more than 1 m/s while they are open. The HUD says "STREETCAR · DOORS OPEN ·
STOP BEHIND THE DOORS", and AI eyes outline it in amber. The seeded benchmark and the other
challenges have none. See `static/js/sim/streetcar.js`.

Level crossings (Alberta Use of Highway and Rules of the Road Regulation, AR 304/2002, s. 42): in a
free drive one heritage streetcar runs each map's track (`?trains=0` takes it off; only Old Strathcona,
Edmonton, has one, the High Level Bridge line). It runs at up to 25 km/h, stops 15 to 30 s at each
stop, waits 40 to 80 s at its terminus and turns back, and comes back 60 to 150 s after running off the
map's edge. It rings its gong on the way to each crossing, from 150 m out, and brakes (at up to
2.5 m/s^2) for anything in its way that its motorman can see. While it is coming, or on the
crossing, a driver crossing the track stops with its front 7 m back from the nearest rail (the law's
line is 5 m) and waits until it has passed, if it could stop there braking at up to 3.5 m/s^2 when it
first heard (within 250 m) or saw it. And whatever is coming, nobody stops on the tracks: a driver waits
at the same place while a vehicle past them, stopped or slower than 3 m/s, leaves less than its own
length and 1 m clear of the train's envelope (2.5 m either side of the track's centre). Traffic,
cyclists and the driven car alike; an emergency vehicle waits only for the train. Rules gets a
`stop_before_tracks` candidate and rejects going past that point (`crosses_in_front_of_train`,
`no_room_past_tracks`). Decision models and LLMs get `level_crossing`. The audit counts a failure to
yield to the train once per train at each crossing if the car, owing the stop, comes within 5 m of the nearest
rail at more than 1 m/s while it is approaching, or stands on the tracks slower than 1 m/s while it is;
the coaching score counts standing on the tracks for a second, once a visit ("Stopped on the tracks"),
with a tip. The HUD says "LEVEL CROSSING · STREETCAR COMING · STOP 5 M BACK" or "LEVEL CROSSING · NO
ROOM PAST THE TRACKS · WAIT SHORT OF THEM", and AI eyes outline the streetcar in amber. The seeded
benchmark has no trains; the room rule applies there as everywhere. See `static/js/sim/rail.js`.

Keeping the junction clear (Québec's Highway Safety Code; Québec.ca, "Savoir manœuvrer aux
intersections"): even on a green, a driver must not enter a junction without room past it to clear it
completely. At a signal the box runs from the stop line to the far side of the widest street across
it. A driver short of the line, or up to 1 m over it, waits there while a vehicle ahead on its way past
the junction, going its way, stopped or slower than 3 m/s, leaves less than its own length, the 2.5 m
it would stop behind that vehicle and 1 m clear of the box; so does one further over, slower than 2 m/s and still short of the street across.
Into the junction it is committed. Traffic, buses and streetcars wait (at the line, 2 m back, as at any
line); cyclists, who keep right of the queue, and emergency vehicles with their sirens on do not.
Junctions without a signal, and roundabouts, are left out. The car's sensing reports `junction_box`
(it aims to stop 1 m short of the line, and a slow stop runs on to about the line); Rules gets a
`wait_short_of_junction` candidate and rejects going on past it (`blocks_junction`). Decision models
and LLMs get `junction_box`, a situation line, a motion criterion and a prompt line. The audit counts a
failure to yield (`to: "cross traffic"`, `blocking: true`) once a visit if the car, following its route,
entered the junction (its front past the near side of the street across) while traffic past it left no
room, and then stands in it slower than 1 m/s while its light is red; the coaching score counts standing
in a junction for a second with traffic past it leaving no room ("Stopped in the junction"), with a tip.
The HUD says "JUNCTION · NO ROOM PAST IT · WAIT AT THE LINE" while the light is not red, and AI eyes
outline the vehicle that leaves no room in amber. At an all-way stop, traffic also waits for a car
coming in on a street without a sign there (the short link between two junctions close together),
which does not stop, and that car gives way to one pulling away from an all-way stop's line. Both
reach the seeded benchmark (see [the Rules baseline](rules-baseline.md)). See
`static/js/sim/junction-box.js`.

Advance greens and left-turn arrows (`static/js/sim/signals.js`): where two multi-lane major streets
(primary or secondary, two lanes or more in a direction) cross at a signal, one approach on one of them,
with an approach opposite it in its group and a left turn out of it, leads its group with a protected
left turn: the busiest (lanes × limit), then the first by edge id. The cycle grows by 12 s to fit it:
for the first 8 s of the group's green only that approach goes, and the approach opposite it (and any
other in its group) waits on red; then 4 s of clearance (a yellow arrow for 3 s and 1 s of red for the
turn), and the whole group has its usual green, left turns yielding to oncoming traffic as ever. In
Ontario and Québec it shows as a flashing green ball, under which the approach may go left, straight or
right (the MTO Driver's Handbook, "Traffic lights"; the SAAQ's "feu vert clignotant"), steady green
through the clearance; everywhere else as a green left arrow beside a red ball, under which only the
left turn goes (BC's Motor Vehicle Act s. 130), so in BC a flashing green never means an advance (it
means a pedestrian-controlled signal there). The province comes from a coarse outline of Ontario and
Québec judged at the map's centre. The people walking alongside that group start their walk once the
clearance is over. The bundled maps have 50 such junctions, none in Saint-Roch and 12 in Victoria's Old
Town. Each approach's light is now worked out for the way a vehicle goes (`approachPhase`,
`movementSignal`): traffic, buses, streetcars and the driven car turn left on the arrow and wait for
their green going any other way; a right turn on red from an approach held while the approach opposite
has its advance waits for it to end, as the protected turns come into the same street. The car's
sensing reports `intersection.signal` for its own movement and `intersection.advance` (`flashing_green`,
`left_arrow`, `left_arrow_yellow`, or `held` on the approach opposite, and whether its left turn is
`protected`); a protected left turn does not wait for oncoming traffic, held on red. Decision models
and LLMs get `intersection.advance`, a situation line and a prompt line. The audit counts a red light
run crossing the line on a red for the car's movement; crossing it on a left arrow it judges once the
car is 15 m from the junction's centre, counting anything but a left turn (or a right turn on red after
a full stop) as a red light run. Signal heads light each approach on its own at such a junction: a
left arrow's approach has two more sections, a yellow arrow and a green arrow, under the head over its
left lane, and a flashing green blinks. The HUD says "LEFT ARROW · NOT YOUR LIGHT · WAIT FOR GREEN",
"LEFT ARROW · TURN PROTECTED", "YELLOW ARROW · TURN ENDING · STOP IF YOU CAN", "ADVANCE GREEN · LEFT
TURN PROTECTED" or "ADVANCE GREEN · ONCOMING TRAFFIC HELD". This reaches the seeded benchmark (see
[the Rules baseline](rules-baseline.md)).

Where the car, centred in its lane, would touch static scenery within 40 m along its route (a building's
corner mapped over the curb lane, as on Belleville Street in Victoria), Rules is offered lateral nudges of
a full metre either way as well as half a metre, and `stop_at_line` and `hard_brake` keep the car's
current nudge (to the nearest half metre, at most a metre) instead of steering back to the lane's centre.

Work zones with a flagger (Ontario Highway Traffic Act s. 146.1; the Ontario Traffic Manual, Book 7;
`static/js/sim/work-zone.js`, `render/work-zone.js`): a road crew closes one lane of a straight block of a
two-way street with one lane each way, and two traffic control persons, one on the sidewalk at each end,
take turns letting each direction through the lane that is left with STOP/SLOW paddles. Along the closed
lane's street a zone runs 100 m: the closed side's stop line, 6 m to where its traffic starts moving
across, 30 m over which it does, 2 m, the closed stretch itself (24 m of the closed lane and its parking
lane, a parked obstacle, with the crew's truck, its arrow board, two workers and cones angled across the
lane for 12 m before it), 2 m, 30 m back, and 6 m on to the other side's stop line. The flaggers keep one
side on SLOW for at least 10 s, then turn both paddles to STOP once someone is waiting at the other end and
nobody more is coming within 40 m on this one, or after 25 s; both stay on STOP for at least 2 s and until
nothing is left in the one-lane section, then the other side gets SLOW. Everyone keeps to 30 km/h (never
above the street's limit) from their stop line to the end of the one-lane section. A driver short of its
line when its paddle turns to STOP stops there if it could, braking at up to 3.5 m/s^2; one too close goes
on through, and the flaggers wait for it. Traffic, buses and cyclists all do, and the closed side goes
round the closed stretch through the other lane; emergency vehicles are not routed round it. In a free
drive one zone stands at a time, 150 to 450 m from the car where it cannot see it, for 4 to 8 minutes, and
packs up once the car is 150 m away, out of sight, and nothing is in its one-lane section
(`?workzones=0` takes them off). Zones go only where there is no marked crosswalk, bus or streetcar route
or level crossing on the block, 20 m or more from a junction or its stop line; whoever is parked along the
zone leaves, and nobody parks there. The car's sensing reports `work_zone` once it can see the flagger at
its end: which side it is on, what the paddle shows it, its stop line, whether it must wait there, and, on
the closed side, the detour round the closed stretch in route arc lengths, which every lane and hard-brake
candidate then follows (`detour` in a lane law, `sim/controller.js` `detourAt`). Rules gets a
`stop_for_flagger` candidate and rejects going past the line while it must wait (`runs_flagger_stop`).
Decision models and LLMs get `work_zone`, a situation line, a motion criterion and a prompt line. The
audit counts a missed stop once each time a paddle turns to STOP if the car, owing it, goes more than 2 m
past the line at more than 1 m/s while it still shows STOP; the coaching score counts going through
faster than the zone's limit, with tips for both. The HUD says "WORK ZONE · FLAGGER SHOWS STOP · WAIT AT
THE LINE" or "WORK ZONE · SLOW · 30 · ONE LANE" (with "· GO ROUND IT" where the car's lane is closed), and
AI eyes outline the closed stretch in amber. The seeded benchmark and the other challenges have none.

Power cuts (`static/js/sim/outage.js`): where a signal's lights are out, every driver treats the
junction as an all-way stop (the MTO Driver's Handbook, ICBC's Learn to Drive Smart, and the other
provinces' handbooks). Each of its approaches then obeys an all-way stop in place of its signal
(`controlAt`): its own stop for that approach, as a stop sign's, on the signal's line, all of them in one
queue for the junction (`sim/all-way.js`, keyed on the signal's id), where a vehicle that went has cleared
the junction once it is 2 m past the far side of its widest street. Its signal heads and walk signals are
dark, and people on foot cross there on a gap, as where there is no signal. A traffic driver too close to
its line to stop there when the lights go out goes on through; traffic, buses and streetcars all obey it,
and emergency vehicles slow through it as through any junction they have no right of way at. In a free
drive one signal at a time is dark, 150 to 450 m from the car where it cannot see it, with nobody within
40 m, for 4 to 8 minutes; its lights come back on once the car is 150 m away, out of sight, and nobody is
within 40 m, and the next goes dark 60 to 180 s later (`?outages=0` turns them off). The car's sensing is
honest: until it can see the junction it reports an unseen signal, and once it can, an all-way stop
(`intersection.control` is `stop`, `all_way` true, with `dark` and its place in the order). Rules needs
nothing new. Decision models and LLMs get `intersection.lights_out`, a situation line and a prompt line.
The audit counts going through without a full stop as a missed stop, and going out of turn as a failure
to yield (both events with `dark`), with a coaching tip. The HUD says "LIGHTS OUT · ALL-WAY STOP · STOP AT
THE LINE", "· WAIT YOUR TURN" or "· YOUR TURN". The seeded benchmark and the other challenges have none.

Double-parked delivery vans (`static/js/sim/double-parked.js`, `render/delivery-van.js`): a high-roof
cargo van stops in the travel lane of a straight block of a two-way street with one lane each way, beside
the cars parked at the curb, its hazards flashing. The only way past is round it through the oncoming
lane, where oncoming traffic has the right of way (every province's driver's handbook). Along the van's
street the way round (a lane law's `detour`, as at a work zone) eases across from 18 m short of its rear
to 1 m short of it, all the way into the oncoming lane, stays there to 2 m past its front, and eases back
by 16 m past it. A driver waits with its front 7 m short of the van (traffic, which keeps its standstill
gap, about 2 m further back), and keeps to 20 km/h from there until it is back in its lane, slowing to
that at 1.5 m/s^2. It goes round once its front is within 30 m of the van, nobody waiting behind the van
is ahead of it, and the way is clear (`wayRound`): nobody coming the other way, along the street or coming
up to the junction ahead with its indicator (or none, going straight on) pointing into the oncoming lane,
would reach the end of the way round sooner than 2 s after the driver, going round at 20 km/h and pulling
away at 1.5 m/s^2, has its front there; one standing still beyond it, or already past, is no matter. Once
it has started across it carries on round. A traffic driver closer to the van than 1.5 m past where it
would wait is too close to pull out round it, and waits for the van to leave. The cars parked along the way round,
at either curb, stay put (no door opens, nobody pulls out) while the van is there. Traffic and cyclists all
do; a cyclist riding the empty parking lane goes by on the right; emergency vehicles are not routed round
it. In a free drive one van stands at a time, by day and out of fog, 150 to 450 m from the car where it
cannot see it, for 1 to 3 minutes; then, once nobody is beside it or going round it, it goes if the car
cannot see it and is 150 m away, or, in sight, switches its hazards off and drives away as traffic
(`?vans=0` takes them off). Vans stop only where there is no marked crosswalk, transit route or level
crossing on the block, with the way round and 15 m for a queue behind it at least 12 m from the junction
lines at each end, never on the block of a work zone or within 40 m of a vehicle stopped at the roadside.
The car's sensing reports `double_parked` once it can see the van, 80 m short of it or nearer: where it
waits, the way round as far as it can tell (it must see along the oncoming lane as far as anyone at the
street's limit would come in the time it needs, or as far as it ever sees, 80 m less 10, so by night or
in fog it waits), who waits ahead of it, whether it has started round (it is executing a law that goes
round and has moved across or past where it waits), and, once it goes, the detour, which every lane and
hard-brake candidate then follows. Short of where it waits the van is a stop, not a car to follow. Rules
gets a `wait_behind_van` candidate and rejects pulling up more than 1.5 m past where it waits while it
must (`no_room_to_go_round`). Decision models and LLMs get `double_parked`, a situation line, a motion
criterion and a prompt line. The audit counts going round into the way of an oncoming vehicle as a failure
to yield (`double_parked`): the car, going its street's way with its front alongside the way round and its
centre left of the centre line, meets one coming the other way on its side of the street, ahead of it,
less than 8 m front to front or 2 s away at the speed they close at; once a pass. The coaching score counts
it (`van_cutoffs`) with a tip, and going round is not driving the wrong way. The HUD says "DOUBLE-PARKED
VAN · ONCOMING TRAFFIC · WAIT BEHIND IT", "· CAN'T SEE PAST · WAIT BEHIND IT", "· WAIT YOUR TURN BEHIND
IT", "· WAY CLEAR · GO ROUND IT" or "· GOING ROUND · BACK INTO YOUR LANE PAST IT", and AI eyes outline the
van in amber. The seeded benchmark and the other challenges have none.

Parallel parking at the destination (`static/js/sim/parallel-park.js`, BC Motor Vehicle Act s. 189(1) and
s. 190(1)): in a free drive (`World` option `park`; `?park=0` turns it off) the autopilot looks for a space
in the parking lane on its right once the destination is within 150 m. A space is a stretch of the right
kerb that is legal (not in a junction or on its crosswalk, which sits 1.6 m past the widest street's
asphalt; not within 6 m of the approach side of a crosswalk, including a junction's, or of a stop line;
not in a bus stop zone; no parking on a street a level crossing is on; fire hydrants are not on the map),
straight, empty of anything standing still that reaches 0.2 m into the parking lane and of bays another
driver has reserved, on a route edge whose route lane is the curb lane, ending before the destination
and starting within 60 m of it, and long enough to reverse into in one go (`planSpace`): the car starts
alongside the car in front, its rear bumper level with that car's, 0.6 m out from the parking lane's line
(at most 0.6 m right of its lane's centre); its last arc swings its outer front corner round a point a
turning radius left of its rear axle, which must keep 0.4 m from the car in front's inner rear corner, and
its rear bumper must end 0.4 m clear of whatever is behind the space. For the compact that is 6.6 m bumper
to bumper, the sedan 7.0 m and the pickup 8.2 m. The car must see the middle and both ends of the space,
and be within 70 m of where it would park in it; it takes the one nearest the destination it can
still stop for at 2 m/s^2, reserves its bays, and gives it up if it could no longer stop there even at
3.5 m/s^2, if anything stands in it, or after 30 s standing where it starts without starting back. With
no space left that it could still stop for, it stops in its lane at the destination as before (the
`arrived` event says `parked: false`). It signals right from 40 m short of where it stops, slows at no more
than 1.2 m/s^2, and stops there (`wait_to_park`). Traffic and cyclists coming up behind it on its path,
from 30 m short of there until it is parked, treat the car as a leader that is the S's length plus 1.5 m
longer, so they stop back from the room it reverses into; a driver that has stopped inside that room and
is what the car waits for backs up out of it after 2 s (up to 7 m). The car waits there while anything
(not parked) is inside that room behind it, in the lane or the space, or is moving toward it from up to
15 m behind or 4 s away. Then it parks (`park`, a law of `kind: "park"`, World.parking): straight to
where the S starts if it stopped short of it or past it, full lock toward the kerb up to the angle
`solveS` gives (`in1`), straight back (`back`) until full lock the other way will bring it parallel at
the kerb (`in2`), then straight forward or back to its spot (`settle`): 0.9 m behind the car in front
where the space allows, its body 15 cm off the kerb. Legs go at 0.15 to 0.8 m/s, slowing for their end
at 0.6 m/s^2, and the car stops and turns the wheel to within 3 deg of its target before each one. A leg
ends early 0.4 m short of anything standing still, before a tyre would touch the kerb (a bumper may reach
0.25 m over it), or after 9 m; then the next leg squares the car up, gaining on the kerb where it can, or
moves it toward the kerb in another S, and after 12 legs it gives up (`stuck`, arriving with `parked:
false`, `stuck: true`). Parked within 2.5 deg of parallel and 8 cm of its lateral goal, it arrives
(`parked: true`, `kerb_m`, the right tyres' distance from the kerb, `angle_deg` and `within_kerb`, wheels
within 30 cm and within 4 deg of parallel). The space then stays the car's (World.parkedIn) until it has
moved 10 m away, and the next drive starts by pulling out of it (`pull_out`, the same law in `mode:
"out"`): straight back to where the S ended (`out_back`), signal left and wait (`out_wait`) until nothing
is coming up the lane beside it within 25 m or 6 s, or standing beside it, then full lock out (`out1`),
straight (`out2`) and full lock back (`out3`) until parallel in the lane, when the lane law takes over
(`done`). The safety brake lets the car come within 0.3 m of what it parks beside, ignores traffic going
the other way in its own lane while the car stands at an angle (the prediction still checks it), and
looks behind it on reversing legs. The car's sensing reports `parking` (the space and its length, where it
stops to reverse in and how far right it pulls up there, `wait_for`, and once under way the leg). Rules
gets `wait_to_park`, `park` and `pull_out` candidates, and rejects lane manoeuvres that would drive on more
than 1 m past where it stops while still moving (`passes_parking_space`); `stop_at_destination` is not
offered while there is a space, and arriving at the route's end does not stop the car before it parks.
Decision models and LLMs get `parking`, a situation line, a motion criterion (parking is driving, and the
destination is reached only once parked) and a prompt line. The audit counts a tyre more than 2 cm past the
asphalt's edge while the car parks or pulls out as a kerb strike (`kerb_strike`, once a contact), and the
coaching score reports `parking` (`parked`, with how far from the kerb and how square, `stopped in lane`
or `stuck partway in`) with the kerb strikes and tips, only for drives that park. The HUD says "PARKING
SPACE AHEAD · SIGNAL RIGHT · PULL UP ALONGSIDE THE CAR IN FRONT", "PARKING · CHECKING BEHIND · WAIT", "·
CLEAR BEHIND · REVERSE IN", "· REVERSING IN", "PULLING OUT · TRAFFIC COMING · WAIT", "· SIGNAL LEFT ·
CLEAR", "PULLING OUT", then "PARKED", "ARRIVED · STOPPED IN LANE" or "ARRIVED · STUCK PARTWAY IN". The seeded benchmark and the other
challenges never park.

Hidden hazards (`static/js/sim/hidden-hazards.js`, with the blind spot and its speed in `sim/blind-spot.js`,
which coaching imports without the DOM): with the `World` option `hazards` (free drives, unless
`?hazards=0`; challenges with `hidden: true`), a vehicle standing at the kerb (anything in `world.parked`: a
parked car, a van double-parked or stopped at the roadside) hides a pedestrian from the driven car when
every line from it to them, to their middle and 0.3 m either side, passes through it or a vehicle in
traffic (`World.sees`, sim/crosswalk.js `hiddenByTraffic` with `standing`). Sensing is in plan view: a body
hides whatever is behind it, whatever its height. A blind spot (`blindSpot`) is a vehicle standing at the
kerb ahead of the car's front (up to 60 m), within 30 deg of parallel to it, whose traffic side is no more
than 2 m from the car's side, on a quiet street (residential, unclassified or living street, by the edge it
is parked along) or anywhere in a school or playground zone in effect, that the car can see. Beside one the
car keeps to the blind-spot speed (`blindSpeed`): the speed from which, 0.6 s after someone steps out 15 m
ahead of its front and braking at 0.75 of `comfort().hardDecel`, it stops 2 m short of their line (32 km/h
dry, 27 in rain, 19 in snow), never above the limit. Nobody steps out further ahead than 15 m, so it slows
to it at 0.6 of the comfortable deceleration by the time its front is 20 m short of the first such vehicle
(`blindApproach`) and keeps to it until none is left within that distance. In a free drive (`StepOuts`,
`stepOuts: 1`) someone waits at a time, now and then (first after 20 to 60 s, then 60 to 150 s after each,
retrying every 3 s), hidden between two cars parked 0.9 to 3.5 m apart along the car's side of the quiet
street it is on, 35 to 70 m ahead of its front, 0.6 m in from their traffic side: a child 6 times in 10,
walking at 1.4 to 1.9 m/s (an adult at 1.3 to 1.8). Once the car, heading along the street, has its front
within 15 m of their line (and no nearer than 9 m), they step out across the street to just past the far
kerb without looking (`dart`), then walk on along the far sidewalk with the crowd, if no vehicle in traffic
or cyclist is on the street ahead of the car up to 45 m past their line; otherwise, or after 40 s, they
stay put and are taken off once out of sight. The car's sensing reports `blind_spot` (`side`, `from_m` and
`to_m` from its front, `gap_m`, `cars`, the `first` and its `edge`, `why` and `limit_mps`), caps the limit at
`blindApproach`, adds it to the target speed ("parked cars hide the sidewalk"), and flags "blind spot" for
250 ms decisions from 25 m short of it. Decision models and LLMs get `blind_spot`, a situation line and a
prompt line. The coaching score counts time within 15 m of a blind spot more than 5 km/h over the
blind-spot speed (`blind_spot_speeding_s`, deducted from safety; once a street side as an incident) with a
coaching line and a tip, reported only with hidden hazards on. The HUD says "PARKED CARS HIDE THE SIDEWALK
· 32 KM/H" once a street side, and "CHILD STEPPING OUT FROM THE PARKED CARS · STOP" (or "PERSON") when it
sees one. The seeded benchmark and the other challenges have none.

Hidden traffic (`static/js/sim/hidden-traffic.js`), with the same `hazards` option: a road vehicle or
cyclist moving in traffic (not a train, nothing standing) is out of the driven car's sight when every line
from the car to its middle, nose and tail passes through the body of another road vehicle, one in traffic
(not a cyclist) or one standing in the road (`standsInRoad`: a double-parked van, a vehicle stopped at the
roadside, a work zone's), within 90 m (`World.sees`, `hiddenVehicle`). Cars parked in a parking lane hide
people but not traffic: the car looks from its rear axle, and from there a street lined with parked cars
would hide all of its traffic. Everything that goes by `World.sees` (sensing, candidate predictions, the
emergency brake) follows. What the car can see along a lane it gives way to (`laneSight`): it looks back
along the lane from its end (the junction's centre), every 3 m from 6 m out, as far as it is asked to or
can see at all (`Visibility.rangeAt`), and the lane is in view up to the first point a vehicle's body hides;
a vehicle it can see standing in the lane (slower than 0.5 m/s, its front short of the lane's end) covers
the rest, one coming along it does not. Turning left (or round) at a signal, a stop sign or a junction
without either, while it may turn, the car checks every lane of each street into the junction heading
within 60 deg of straight at its approach, as far as traffic at that street's limit (slowed for the
weather) covers in the time it needs (`oncomingYield`, `oncomingView`). Where it cannot see that far it
yields as to a vehicle at the first hidden point (`intersection.oncoming` with `id` null and `view`:
`hidden_by`, `sight_m`, `lane`; with a vehicle it waits for too, that one's entry gets the `view`), waiting
short of that lane's path but no further in than the near edge of the street it crosses
(`sJunction - crossingHalfWidth`), or, already past that, where it can stop at the comfortable
deceleration; so a vehicle waiting to turn left opposite has room to turn in front of it. Inside the
junction once its light is no longer green it skips the check and clears the junction as before. Giving
way (`giveWayAt`), it also checks every lane of the streets with the right of way over it: one a vehicle
hides makes the view not clear (`hidden_by`), so it creeps up to look as past a building, and stopped
where it looks from it waits there up to 8 s (`waiting_to_see`, from `World.egoPeekAt`) before going once
nothing it can see is coming. Turning right on red (`rightOnRed`), a vehicle hiding a lane of a street from
its left is a `view` it waits for (`hidden_by`). Decision models and LLMs get
`intersection.oncoming.lane_hidden_by` and `sees_lane_m`, `give_way.view` naming the vehicle, situation
lines and a prompt line. The audit's failures to yield at a give-way junction or to oncoming or cross
traffic carry `unseen` when the vehicle was hidden from the car as it pulled out; the coaching score counts
those (`hidden_cutoffs`, an incident each, and a tip), reported only with hidden hazards on. The HUD says
"THE VAN HIDES THE ONCOMING LANE · WAIT UNTIL YOU CAN SEE", "THE CAR HIDES THE CROSS STREET · CREEP UP AND
LOOK" (or "· WAIT UNTIL YOU CAN SEE" once it has looked) and "THE CAR HIDES TRAFFIC FROM THE LEFT · WAIT",
naming the vehicle's kind.

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
2. **Proposes** up to 16 manoeuvres, including speed changes, small lateral shifts, lane changes and stops.
3. **Simulates** each manoeuvre three seconds ahead and rejects unsafe or illegal options.
4. **Chooses** among the survivors using Rules, a decision model (Jev or another) or an LLM.
5. **Executes** the chosen manoeuvre while the next decision is pending.

Jev answers typed multiple-choice questions with probabilities; other decision models
([agent guide](agents.md#decision-models-jev-and-others)) receive the same questions and answer
the same way. Rules scores the same candidate set locally. Both share sensing, safety filtering, physics and the controller. Jev reads
`driving_style`; Rules uses a fixed score. If Jev exceeds 1.5 seconds, returns an invalid choice
or errors, Rules handles that step and the fallback counter increases. Settled questions can
be answered locally without an API call.

On streets with more than one lane in its direction, the car can change lanes. A change into
the next lane is offered to pass a vehicle ahead that is stopped, is a cyclist, door or parking
car, or is at least 2.5 m/s slower than the car would drive. A pass needs at least 80 m of lane
beside the route, no stop line within 25 m and no queue at a junction just ahead. While the car is
outside its route's lane, a return is offered except in the 8 m before a stop line. A change needs
a gap in the target lane: 6 m plus 2 s of closing speed to the vehicle ahead and 6 m plus 2.5 s to
the one behind, and nothing alongside. The car signals and eases across over about 3.5 s of travel
(18–50 m), or more sharply (down to 12 m) to finish before the lane it is leaving ends; with less
room than that it waits. Any manoeuvre that would keep the car outside its route's lane too close to where that
lane ends is rejected. That point can be a turn, a junction where the lanes change, or the
destination. Without a gap the car slows in its lane and waits. Rules weighs a lane change and
time outside the route's lane as small costs, so it passes only for a clear gain and returns once
there is room. Abandoning a change already under way is offered but costs more, so Rules finishes
a change unless finishing it is no longer safe. Decision models and LLMs see the lanes and the gaps beside the car, and the
situation tells them when a change is on offer.

Before a turn the router takes the turn lane on the last block, so its route line slides across
the lanes at the junction before that block. The car does not follow that slide. From 150 m before
it, the turn lane counts as the route's lane, so the car signals and changes into it with the same
gap checks, then holds it while the route line moves across. It has to be in the lane before the
turn. A slow or stopped car in the turn lane within 150 m of the turn is treated as a queue: the car
doesn't pass it, and Rules doesn't drive past it in the next lane, because that lane's extra speed
gains nothing. This applies where the block before the turn continues the street straight on with
the same lanes; where the lane count or layout changes at that junction, the route line still
slides across inside it.

At an all-way stop, vehicles go in the order they stopped at their lines (`static/js/sim/all-way.js`),
for traffic and the driven car alike. A vehicle joins the order when it stops within 6 m of its
line. Two that stop within a second of each other go right before left: the one on the right goes
first, and from opposite sides a left turn waits for the other. From opposite sides, two vehicles
that are not turning left go together, and so do two opposing left turns. A vehicle that has set
off on its turn keeps the right of way until it is 6 m past the junction's centre. If everyone waits
for someone (four cars stopping together), the first to stop goes. The driven car senses only the
vehicles it can see, so it may go before a hidden one; the audit counts going out of turn as a
failure to yield whether or not the car could see who stopped first. Decision models and LLMs get
`intersection.priority` and a situation line. Turning left at a stop sign, once its stop is made and
it is its turn, the car yields to oncoming traffic as at a signal. The stop-sign oncoming audit
applies to left turns and U-turns; a straight or right departure is not an oncoming yield
violation. Without a route, the audit judges the actual turn rather than the indicator.

The decision inspector exposes requests, answers, confidence, timing and spend; decisions can
be saved or copied as `curl` commands. The emergency brake responds to imminent observed
collisions, not traffic-rule violations, so driving mistakes remain visible. It brakes at 8 m/s²
while still steering along the manoeuvre the car was following.

## Benchmarks and validation

![The benchmark page](bench.png)

Open [/bench](http://127.0.0.1:8322/bench), or use **Benchmark this city** in the explorer.
The benchmark runs seeded drives through the same simulation and autopilot without graphics.
**Lockstep** pauses while decisions are pending; **realtime** keeps the world moving so model
latency affects the drive. Runs save under `data/runs/`, support side-by-side comparison and
open as 3D replays on their recorded map.

A benchmark drive passes only if it arrives with no collision, red light, rolled stop or failed
yield, and less than one second off-road. A car arrives within 3.5 m of its destination, or
within 10 m, stopped on its route and in the route's lane, when every manoeuvre along that lane
that would get it closer hits a parked car or static scenery. It also reports comfort, lane keeping (measured from
the centre of the lane the car is in or moving into), lane changes, fault, safety
brakes, gaps, tokens, cost and latency. This pass criterion is separate from the live coach's
weighted score.

Recorded validation includes a 500 m Rules drive through Victoria in rain with no audited
collision, red-light, stop or yield violations and a score of 97. The
[2026-10-20 Rules baseline](rules-baseline.md) is the current seeded record. In WebKit, the
12-route Kitsilano suite passed 12/12 dry, 11/12 fog, 12/12 rain and 12/12 snow, and every route
arrived; all eleven two-route city smoke suites passed. In V8 every Kitsilano route passed and
Edmonton's smoke suite failed one route.
Results vary between JavaScript engines, so compare runs from the same browser. These are
individual recorded checks, not guarantees for every city or seed. Live Jev behaviour with the revised prompt has
not been validated; offline fixtures establish request consistency, not model judgment.

Detailed results: [Rules benchmark baseline](rules-baseline.md), [drive experience](drive-experience.md),
[realism validation](realism-validation.md) and [rendering validation](render-performance.md). Release history is in [CHANGELOG.md](../CHANGELOG.md).
The [world expansion validation](world-validation.md) records the new maps, physical building
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
`uv run scripts/fetch_map.py victoria --force`; see [map documentation](maps.md) for raw-cache handling.

| Environment setting | Default | Purpose |
|---|---|---|
| `TYPESAFE_API_KEY` | None | Enable Jev |
| `JEV_FSD_BUDGET_USD` | `1.00` | Cap live Jev, decision-model and LLM spend per server run; an endpoint without a price or reported cost counts as $0 |
| `JEV_FSD_RPM` | `240` | Cap live model calls per minute; an endpoint's own `rpm` replaces it (`0` = none) |
| `JEV_FSD_DECISION_ENDPOINTS` | `data/decision-endpoints.json` | Decision-model drivers ([agent guide](agents.md#decision-models-jev-and-others)) |
| `JEV_FSD_LLM_ENDPOINTS` | `data/llm-endpoints.json` | LLM endpoint drivers ([agent guide](agents.md#llm-endpoints-test-your-own-model)) |
| `JEV_FSD_LLM_BASE_URL`, `_MODEL`, `_API_KEY`, `_NAME` | None | One OpenAI-compatible endpoint without a config file (`llm:default`) |
| `JEV_FSD_LLM_PRICE_INPUT_PER_MTOK`, `_OUTPUT_PER_MTOK`, `_TIMEOUT_S` | None, None, `10` | Prices (USD per million tokens) and total per-decision deadline for that endpoint |
| `JEV_FSD_NPCS` | `40` | Set traffic-car count |
| `JEV_FSD_BBOX` | Kitsilano | Select a default area by bounding box or preset |
| `PORT` | `8322` | Set the server port |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | Set the model |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | Set the API endpoint |

## Privacy and limitations

The server binds to `127.0.0.1`, keeps the API key out of the browser and checks hosts, origins,
fetch metadata and session tokens. A per-run budget and rate limit guard live API spending; the budget counts an endpoint without prices or a reported cost as $0.
TypeSafe receives the decision state and questions shown in the inspector: distances, speeds,
street names and manoeuvre descriptions, without map coordinates. Other decision models receive
the same request, and LLM endpoint drivers the same information as a chat prompt, from whichever
provider you configure. Drive reports stay in this
browser's local storage unless you export them.

Map tags and procedural geometry limit realism. There is no road elevation or camber, and
visual body pitch and roll do not add a physical suspension model. Buildings, weather and darkness
determine sensing; a vehicle in traffic hides a pedestrian behind it, and so, with hidden hazards on, does one
standing at the kerb; with them on, road vehicles also hide other vehicles and cyclists (cars parked in a parking lane do not). Trees occlude nothing, and individual street lamps do not extend
detection range. Scenery collision checks use polygon exteriors and circular trunk/post cross-sections; courtyard holes and crash damage are not modeled. The driven car changes lanes only to pass and
then returns, and to get into the lane for a turn; two or more lanes from its route's lane, it keeps room for one lane change per lane. Where its route makes a U-turn at a dead end, it stops and turns round with a three-point turn (more legs where it is tight), letting its bumpers reach no more than 0.2 m over the kerb and keeping clear of parked cars and scenery; it does not turn round anywhere else, and the router uses U-turns only at dead ends. Where a street's lanes change at the junction
before a turn (a turn bay, say), the car still moves into the turn lane inside that junction. Turning left or making a U-turn at a signal, a stop sign or a junction without either, the car yields to the oncoming traffic it can see, waiting at the line or inside the junction, and it takes an oncoming car's left indicator at its word when that car is in its leftmost lane within 40 m of the junction (anywhere else, it may be a lane change; a car pulling out from the curb is waited for whatever it signals). It turns right on red after a full stop (except on the island of Montréal, judged from the map's centre against a coarse outline of the island), but only where it can see along the street to its left from the line: at a red light it does not creep forward to look, so at a corner a building hides it waits for the green, as it does in fog, rain, snow and after dark. Signs banning a right on red at a particular junction are not read from the map, and left turns on red from one one-way street onto another are not made. At a two-way stop, once its stop is made, the car gives way to traffic on the through road from both sides; at a junction without a sign or signal it gives way to traffic from the right, or to the larger road where a smaller one meets it (road classes from OpenStreetMap: primary and secondary, then tertiary, then the rest). OpenStreetMap misses some stop signs, so a few junctions that have one on the street are treated as having none, and a T-junction follows the same rules as a crossroads. Where a building hides a street it gives way to, the car slows, creeps forward to look and goes once stopped at the point it looks from (0.3 m short of the crossing road's asphalt) if nothing it can see is coming, even if a building still hides part of the street; in fog and after dark it looks only as far as it can see. Traffic gives way by the same rules but does not look: it knows where everyone is. The audit counts pulling out in front of a vehicle with the right of way that is due at the junction within 2 s as a failure to yield, seen or not, if it was already on its way when the car crossed its line. Traffic does not overtake cyclists, parking uses forward pull-ins, and pedestrians do not cross
against signals. Street-name and speed-limit posts block the car; their labels do not add sensing information. No post or trunk stands in a lane or on the asphalt: where map topology would put one there (a slip road leaving a main road at a shallow angle, or a street continuing wider past a junction), it moves outward, a signal pole to the stop line's curb if the far side has no room, and otherwise is left out (across the twelve maps: 4 of 1,127 signal poles, 27 of 13,358 lamp posts, 11 street-sign and 2 stop-sign posts, and 4 trees).
Low curbs remain traversable, and scenery beyond the playable map is decorative with simplified geography.

## Development

```sh
uv run python -m unittest discover tests
node --experimental-default-type=module scripts/test_drive_score.mjs
node --experimental-default-type=module scripts/test_drive_controls.mjs
node --experimental-default-type=module scripts/test_replay.mjs
node --experimental-default-type=module scripts/test_interpolate.mjs
node --experimental-default-type=module scripts/test_orbit_camera.mjs
node --experimental-default-type=module scripts/test_cinematic_photo.mjs
node --experimental-default-type=module scripts/test_static_collision.mjs
node --experimental-default-type=module scripts/test_scenery_collision.mjs
node --experimental-default-type=module scripts/test_route_controls.mjs
node --experimental-default-type=module scripts/test_world_conditions.mjs
node --experimental-default-type=module scripts/test_vehicle_models.mjs
node --experimental-default-type=module scripts/test_llm_agent.mjs
node --experimental-default-type=module scripts/test_decision_agent.mjs
node --experimental-default-type=module scripts/test_lane_change.mjs
node --experimental-default-type=module scripts/test_pull_out.mjs
node --experimental-default-type=module scripts/test_left_turn.mjs
node --experimental-default-type=module scripts/test_right_on_red.mjs
node --experimental-default-type=module scripts/test_all_way_stop.mjs
node --experimental-default-type=module scripts/test_give_way.mjs
node --experimental-default-type=module scripts/test_right_hook.mjs
node --experimental-default-type=module scripts/test_speed_zones.mjs
node --experimental-default-type=module scripts/test_roadside.mjs
node --experimental-default-type=module scripts/test_streetcars.mjs
node --experimental-default-type=module scripts/test_level_crossings.mjs
node --experimental-default-type=module scripts/test_junction_box.mjs
node --experimental-default-type=module scripts/test_advance_green.mjs
node --experimental-default-type=module scripts/test_work_zones.mjs
node --experimental-default-type=module scripts/test_outages.mjs
node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check
uv run scripts/verify_jev.py --offline
```

With a running app, `uv run --with playwright python scripts/test_browser_pages.py` runs the `/tests`
page, the renderer assertions and a check that the pilot controls fit the HUD panel in headless Chromium, and `scripts/test_arena_browser.py` runs the
arena workflow (install the browser once with `uv run --with playwright python -m playwright install chromium`).
CI runs all of the above on every pull request.

Open [/tests](http://127.0.0.1:8322/tests) for simulation and HUD checks. From the simulator's browser
console, run the WebGL renderer checks:

```js
const { runRenderTests } = await import('/tests/render-tests.js');
runRenderTests(); // Every result should have ok: true.
```

The documented validation covers 160 Python tests (68 for LLM endpoints and their setup against a local mock
OpenAI-compatible server, and 25 for decision-model endpoints and their setup against a local mock System One
server, both with temporary files; no real provider is tested), 146 browser assertions (99 simulation, 27 HUD and 20 explorer),
106 renderer assertions, one HUD layout check, 19 scoring tests, 13 building collision regressions, 17 scenery collision regressions,
22 vehicle model regressions, 15 LLM agent checks, 14 decision agent checks, six route-control regressions,
world-condition and interpolation checks, and 20 offline Jev requests.
Renderer checks include actual front/rear sign rasterization and wet frames across quality
transitions. HUD checks cover fallback and stop labels, the three pillar buttons and an unavailable
Decision button, keyboard driver selection, probability rows, telemetry reset and the 10 Hz update bound. See
[HUD validation and viewport-review limits](drive-experience.md#validation) and
[rendering performance](render-performance.md) for DOM measurements and GPU profiling.

Run a seeded Rules benchmark after changing physics, traffic, planning or routing. Rebuild
committed Jev cases with `scripts/build_jev_fixtures.mjs` after changing sensing or question
wording. Live verification (`uv run scripts/verify_jev.py`) requires an API key and spends
credits. The fixtures are generated by the real production pipeline.

| Path | Contents |
|---|---|
| `server.py`, `jev/` | Local server, TypeSafe client, decision-model and LLM endpoint proxies, spend guard, OSM processing and routing |
| `static/js/sim/` | Physics, traffic, collisions, signals, parking, pedestrians and sensing |
| `static/js/brain/` | Candidates, Jev questions, drivers (Rules, decision models, LLMs) and safety brake |
| `static/js/ui/` | City explorer, drive reports, cockpit and driving audio |
| `static/js/render/` | Three.js scene, scenery, lighting, signs, reflections and post-processing |
| `static/js/bench/` | Seeded suites, headless runs and metrics |
| `scripts/` | Map fetching, fixture generation, verification and headless tools |
| `data/`, `docs/` | Map packs, decisions, runs, screenshots and validation reports |

To add a driver, follow the [agent adapter guide](agents.md): implement
`decide(snap, eligible, request, signal)`, returning `{ motion, candidateId, meta }`, and
register its factory with `registerAgent` in `static/js/brain/registry.js` or load its module
through the simulator and arena. Before contributing, run the applicable tests and include
a baseline comparison when a change affects driving.

## Credits and license

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under the
  [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
- Rendering by [Three.js](https://threejs.org/) (MIT).
- Jev and TypeSafe are products of TypeSafe AI; this project is independent.
- Inspired by [JevPilot](https://github.com/standardagents/jevpilot).

Released under the [MIT License](../LICENSE).
