# Drive lab

The welcome screen offers a scenic manual drive, a challenge picker, and a free Rules drive.
The world pauses while the welcome screen is open. You can return through **Drive lab** in
the trip card. The default HUD emphasizes the road, navigation and instruments; **Telemetry**
expands the pilot decision and incident cards. **Settings** and keyboard help stay accessible.

## Six authored challenges

| Challenge | City | Situation |
|---|---|---|
| The door zone | Vancouver, Kitsilano | A cyclist and a parked car's opening street-side door |
| Into the unknown | Victoria, Old Town | A signal-controlled junction with 28 m fog visibility |
| Rain check | Montréal, Le Plateau | A scripted crossing on a wet street after dark |
| Winter composure | Toronto, The Annex | A stop-controlled block with reduced snow grip |
| Joining the flow | Vancouver, Kitsilano | A parked car indicates, accepts a gap and merges using the normal NPC controller |
| Around the corner | Vancouver, Kitsilano | A scripted pedestrian crossing with a sight line obstructed by a mapped building |

Suite version 2 adds the merge and obstructed crossing. Each challenge separately versions
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
