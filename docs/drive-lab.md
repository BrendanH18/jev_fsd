# Drive lab

The welcome screen offers a scenic manual drive, a challenge picker, and a free Rules drive.
The world pauses while the welcome screen is open. You can return through **Drive lab** in
the trip card. The default HUD emphasizes the road, navigation and instruments; **Telemetry**
expands the pilot decision and incident cards. **Settings** and keyboard help stay accessible.

## Sixteen authored challenges

| Challenge | City | Situation |
|---|---|---|
| The door zone | Vancouver, Kitsilano | A cyclist and a parked car's opening street-side door |
| Into the unknown | Victoria, Old Town | A signal-controlled junction with 28 m fog visibility |
| Rain check | Montréal, Le Plateau | A scripted crossing on a wet street after dark |
| Winter composure | Toronto, The Annex | A stop-controlled block with reduced snow grip |
| Joining the flow | Vancouver, Kitsilano | A parked car indicates, accepts a gap and merges using the normal NPC controller |
| Around the corner | Vancouver, Kitsilano | A scripted pedestrian crossing with a sight line obstructed by a mapped building |
| The unprotected left | Ottawa, Centretown | A left turn on a green; two oncoming cars 20 m apart, going straight through, reach the junction as the car does |
| Right on red | Calgary, Beltline | A right turn at a red light; two cars 20 m apart come from the left on their green and go straight on into the street the car turns into |
| Four-way stop | Toronto, The Annex | Straight on through an all-way stop; a hesitant driver from the right stops first, a second car queues behind it, and an oncoming car turns left |
| The blind corner | Vancouver, Mount Pleasant | Straight on through a two-way stop where a corner building hides the through road from the line; once the car has stopped, a car on the through road comes from the right, out of sight, and another from the left |
| The right hook | Vancouver, Kitsilano | A right turn off a bikeway, from a street with the right of way; a cyclist 15 m ahead rides the empty parking lane at 5.5 m/s, straight on past the corner, so it is on the car's right as the car slows to turn |
| Lights and sirens | Edmonton, Old Strathcona | Straight on along a two-way street with a parking lane, toward a junction without a sign; once the car is 45 m from it, an ambulance sets off 75 m behind it with its siren on, so the car must pull over and stop short of the junction |
| Pulling out | Vancouver, Kitsilano | Straight on along West 4th Avenue, in the curb lane, 100 m behind a bus standing at its stop with its doors open; once the car is 45 m from the bus, it shuts its doors and signals to pull out, and the car must let it go first (BC MVA s. 169.1) |
| The multiple threat | Vancouver, Kitsilano | Straight on along West Broadway in the lane beside the curb lane, 110 m before a marked crosswalk; a car stands at the crosswalk in the curb lane, hiding a person on it in front of it. Once the car is 45 m from the crosswalk they walk on across, out into its lane. The car must not pass the stopped car (BC MVA s. 179(3)): it stops beside it, looks, and gives way |
| Flashing reds | Vancouver, Kitsilano | Straight on along West 2nd Avenue, a two-way street with one lane each way; a school bus coming the other way stands 110 m ahead with its red lights flashing and its stop arm out. Once the car is 45 m from it, a child who has just got off walks forward past its front and crosses in front of it, into the car's lane. Traffic both ways must stop for it (BC MVA s. 149): the car stops 10 m short of the bus's front and waits until the child is across and the reds go off |
| School zone | Vancouver, Kitsilano | 9:00 on West 11th Avenue past Lord Tennyson Elementary: a 50 km/h street whose block is a school zone, in effect at 30 km/h (BC MVA s. 147). The car starts 4 m into the zone; 85 m on, a child waits at the curb between two parked cars, and once the car's front is CHILD_TRIGGER m from them they run straight across the street. At 30 km/h the car stops for them; at the street's 50 it cannot |

Suite version 2 adds the merge and obstructed crossing; the unprotected left, right on red, four-way stop, blind corner, right hook, lights and sirens, pulling out, the multiple threat, flashing reds and the school zone joined it later, at version 1. Each challenge separately versions
its map, seed, weather, time, vehicle, background traffic and route. The original door, fog
and snow challenges remain version 1; the rainy crossing is version 2 because its person
now correctly waits for the approach trigger rather than starting during setup.
The main simulator and agent arena use `setupChallenge` and the same step function. Authored
actors trigger from the approaching car's position; the crossing is scripted rather than
chosen by the normal crowd's gap acceptance. This isolates a repeatable hazard while allowing
the actor to react to the car. Environment controls are locked during a challenge. Changing
the destination, driver or vehicle makes a modified attempt; exported reports label it.

**Finish & review** and arrival reports offer **Save score card**, **Copy challenge link**,
**Try with Rules**, and **Review replay** for the currently recorded drive. A copied link
recreates conditions; it does not contain the original result or recording. Images include
the drive status, so unfinished drives do not claim arrival. Reports and arena results remain
local to the browser. Scores do not establish real-world driving ability.

## AI eyes

**AI eyes** draws the geometric sight region and obstacle footprints using the same building,
weather and darkness queries as sensing. Green boxes are visible; red boxes expose nearby
world objects that the driver cannot see. These red boxes are inspection information, not
additional model input. Candidate ribbons retain their existing colours: selected yellow,
eligible green, rejected red. The panel shows sight range, the sight-limited target, and
candidate rejection reasons. This is geometric simulation sensing, not a vision model.

## Recorded replay and branches

A rolling recorder retains the last 120 seconds of the active drive at 0.5-second checkpoints.
It copies car physics, traffic paths, pedestrians, doors, random streams, control memory,
scoring and daylight. Replay playback interpolates actor poses between checkpoints. Seeking
does not step physics, run decisions or alter the recorded scores.
Playback follows each checkpoint's recorded timestamp, including the final partial interval.
Pausing holds the displayed position; pressing **Play replay** at the end starts again from
the oldest retained checkpoint.

**Rewind** opens the timeline. **Before incident** seeks three seconds before the preceding
retained incident. **Take over here** starts manual control from the selected state; **Try this
driver** restarts the pilot there. **Try manoeuvre** revalidates the selected candidate against
the restored world, applies it briefly, then lets the existing driver continue. The shared
emergency brake remains active. Branching discards the old future and labels the result as
a replay branch. Return to drive restores the newest checkpoint. Saved history reports retain
their scores, but recordings exist only for the active drive and disappear on navigation.

Rewinding does not refund API calls: continuing or branching retains session spend. Jev and
other live agents may make new paid calls on a branch. Custom agent internals are not captured;
stateful adapters need their own reset/replay strategy. Rules uses only the restored world.

Each city now has a distinct procedural facade palette; non-Vancouver cities also have
stylized silhouettes outside the map. These are decorative city cues, not geographically
surveyed landmarks. Playable roads, building footprints and collision geometry retain OSM data.
