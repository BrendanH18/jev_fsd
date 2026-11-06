# Drive lab

The welcome screen offers a scenic manual drive, a challenge picker, and a free Rules drive.
The world pauses while the welcome screen is open. You can return through **Drive lab** in
the trip card. The default HUD emphasizes the road, navigation and instruments; **Telemetry**
expands the pilot decision and incident cards. **Settings** and keyboard help stay accessible.

## Forty-seven authored challenges

| Challenge | City | Situation |
|---|---|---|
| Brakes ahead | Vancouver, West 6th Avenue | Rain, a moving start and a lead car that brakes hard, pauses, then resumes. Leave room to slow safely |
| Make room | Vancouver, West 4th Avenue | An adjacent car merges into the following gap, then accelerates with traffic. Ease off and rebuild room |
| Dip your lights | Saskatoon, 13th Street East | Night with a streetlight outage: high on the empty stretch, dip for the approaching car and slower leader; `glare_seconds` fails above 0.8 s |
| The door zone | Vancouver, Kitsilano | A cyclist and a parked car's opening street-side door |
| Into the unknown | Victoria, Old Town | A signal-controlled junction with 28 m fog visibility |
| Rain check | Montréal, Le Plateau | A scripted crossing on a wet street after dark |
| Winter composure | Toronto, The Annex | A stop-controlled block with reduced snow grip |
| Joining the flow | Vancouver, Kitsilano | A parked car indicates, accepts a gap and merges using the normal NPC controller |
| Around the corner | Vancouver, Kitsilano | A scripted pedestrian crossing with a sight line obstructed by a mapped building |
| The unprotected left | Ottawa, Centretown | A left turn on a green; two oncoming cars 20 m apart, going straight through, reach the junction as the car does |
| Left on red | Calgary, Beltline | Stop fully on 14 Avenue SW, then turn left on red onto one-way 5 Street SW once pedestrians and two cars from the right are clear |
| Right on red | Calgary, Beltline | A right turn at a red light; two cars 20 m apart come from the left on their green and go straight on into the street the car turns into |
| Four-way stop | Toronto, The Annex | Straight on through an all-way stop; a hesitant driver from the right stops first, a second car queues behind it, and an oncoming car turns left |
| The blind corner | Vancouver, Mount Pleasant | Straight on through a two-way stop where a corner building hides the through road from the line; once the car has stopped, a car on the through road comes from the right, out of sight, and another from the left |
| The right hook | Vancouver, Kitsilano | A right turn off a bikeway, from a street with the right of way; a cyclist 15 m ahead rides the empty parking lane at 5.5 m/s, straight on past the corner, so it is on the car's right as the car slows to turn |
| Lights and sirens | Edmonton, Old Strathcona | Straight on along a two-way street with a parking lane, toward a junction without a sign; once the car is 45 m from it, an ambulance sets off 75 m behind it with its siren on, so the car must pull over and stop short of the junction |
| Pulling out | Vancouver, Kitsilano | Straight on along West 4th Avenue, in the curb lane, 100 m behind a bus standing at its stop with its doors open; once the car is 45 m from the bus, it shuts its doors and signals to pull out, and the car must let it go first (BC MVA s. 169.1) |
| The multiple threat | Vancouver, Kitsilano | Straight on along West Broadway in the lane beside the curb lane, 110 m before a marked crosswalk; a car stands at the crosswalk in the curb lane, hiding a person on it in front of it. Once the car is 45 m from the crosswalk they walk on across, out into its lane. The car must not pass the stopped car (BC MVA s. 179(3)): it stops beside it, looks, and gives way |
| Flashing reds | Vancouver, Kitsilano | Straight on along West 2nd Avenue, a two-way street with one lane each way; a school bus coming the other way stands 110 m ahead with its red lights flashing and its stop arm out. Once the car is 45 m from it, a child who has just got off walks forward past its front and crosses in front of it, into the car's lane. Traffic both ways must stop for it (BC MVA s. 149): the car stops 10 m short of the bus's front and waits until the child is across and the reds go off |
| School zone | Vancouver, Kitsilano | 9:00 on West 11th Avenue past Lord Tennyson Elementary: a 50 km/h street whose block is a school zone, in effect at 30 km/h (BC MVA s. 147). The car starts 4 m into the zone; 85 m on, a child waits at the curb between two parked cars, and once the car's front is 15 m from them they run straight across the street, without looking. At 30 km/h the car stops for them; at the street's 50 it cannot |
| Move over | Winnipeg, Exchange District | A tow truck stands at the curb on Princess Street (three lanes one way, 50 km/h) with its amber lights flashing, the car it is about to tow parked behind it and its operator between the two. The car starts in the curb lane, the one next to it, its front 76 m behind the truck. Once the car's front is 16 m from the operator they step out into the curb lane without looking, stand there 3 s and step back. Moving over (BC MVA Regulations s. 47.02) the car is a lane clear of them; staying in the curb lane at 40 km/h it can stop for them, at the street's 50 it cannot |
| Behind the doors | Toronto, The Annex | A 511 streetcar stands at its stop at Harbord on Bathurst Street (northbound) (two lanes each way, 40 km/h) in the inner lane, where its track is laid, with its doors open. The car starts in the curb lane beside it, 75 m behind it. A rider waits at the curb abreast of its rear doors; once the car's front is 10 m from them they walk out across the car's lane to the doors without looking, and get on. The car must stop at least 2 m behind the rear doors and wait while they are open (Ontario HTA s. 166) |
| Clear the tracks | Edmonton, Old Strathcona | 106 Street (southbound, one lane each way, 40 km/h) crosses the High Level Bridge Streetcar's track 57 m past 87 Avenue, with crossbucks alone. Past it, a car waits at 86 Avenue to turn left, its indicator on, with two more queued behind it, the last 2.5 m past the train's envelope: no room for the car past the tracks. The car comes down from 87 Avenue. Once its front is 30 m from the crossing, a heritage streetcar standing 100 m along the track, out of sight, sets off toward it ringing its gong; 4 s after it has passed by (or 30 s after it set off), the queue moves off. The car must wait short of the tracks for room, never stop on them, and stop at least 5 m back from the nearest rail while the streetcar comes (Alberta AR 304/2002 s. 42) |
| Keep the box clear | Montréal, Le Plateau | Avenue du Mont-Royal Est (eastbound, one lane each way, 30 km/h) meets Rue Saint-Denis (two lanes each way) at a signal. Past it, a car waits at Rue Rivard to turn left, its indicator on, with eight more queued behind it, the last 2.5 m past the far side of Saint-Denis: no room for the car beyond the junction. The car starts 60 m before the line; its light is green from 2.7 s to 21.4 s. 6 s after it turns red, the queue moves off, and the light is green again from 62.7 s. The car must wait at the line through the green, not enter the junction (Québec's Highway Safety Code) |
| Not your arrow | Winnipeg, Exchange District | Isabel Street (northbound, two lanes each way, 50 km/h) meets William Avenue at a signal whose advance shows as a green left arrow. The car starts in the right lane 95 m before the line, going straight on; its light is red. Two cars wait at the line in the left lane to turn left, and a third comes up behind them. At 25 s the left arrow comes on for 8 s, then 3 s of yellow arrow and 1 s of red, and they turn; the car's own light is green from 37 s. The car must wait for it: a green arrow lets traffic go only the way it points, so going straight on it is going on a red |
| Follow the flagger | Ottawa, Centretown | A road crew has closed the westbound lane of Queen Street (one lane each way, 40 km/h) for 24 m, with cones angled across it for 12 m before the work, leaving the eastbound lane for both directions in turn; a flagger stands on the sidewalk at each end of the zone, 100 m apart. The car starts from a standstill 65 m short of its stop line, where the flagger shows it STOP. Once the car is 45 m from the line, three cars set off from the far end, 12 m apart, through the one lane. Once the last of them is past its own line the flaggers turn both paddles to STOP until the one lane is clear, then SLOW for the car, at about 27 s. The car must wait at the line until then, and then go round the work through the other lane at 30 km/h; a driver who goes round on STOP meets the oncoming cars in the one lane |
| After midnight | Halifax | Morris Street at Barrington Street, 01:00: stop at flashing red, then cross only when the amber main street is clear |
| Lights out | Halifax, Downtown | A storm has cut the power to the signal where Barrington Street (northbound, one lane each way, 50 km/h) meets Morris Street, and its lights are dark for the whole drive (sim/outage.js), so the junction is an all-way stop. The car starts 70 m before the line. Once its front is 45 m from it, three cars set off: on Morris Street from the right, a hesitant driver 22 m from its line (it waits 3 s once it may go) and a second car 10 m behind it, both going straight on, and on Barrington Street opposite a car 55 m out that turns left. The first from the right and the oncoming car stop at their lines before the car does, and go first; the second from the right, which stops after it, waits for it. The car must stop at the line and go in turn: a driver who carries on as if its light were green misses the stop |
| Round the van | Toronto, The Annex | A delivery van is double-parked in the northbound lane of Brunswick Avenue (one lane each way, 30 km/h), beside four cars parked at the curb, its hazards flashing (sim/double-parked.js). The car starts from a standstill, its front 62 m short of the van. Once its front is 40 m from it, two cars, 14 m apart, come down the oncoming lane at the street's limit, the first from 70 m past the van's front: out of the car's sight at first, and in the way round just as it gets to the van. Going round straight away, the car would meet them there. Waiting a car length back (7 m) until both are by, it goes round at 20 km/h and arrives 45 m past the van, on the same block |
| Squeeze in | Vancouver, Kitsilano | One space is left at the right kerb of West 10th Avenue (one lane each way, 30 km/h), 6.8 m bumper to bumper; the rest of the block is lined with parked cars, 1.6 m apart, wherever one may park (sim/parallel-park.js). The car starts from a standstill, its front 90 m short of the space, and the route ends 25 m past it, so the space is the one near the destination; the drive parks there (`park`). A car waits 22 m behind the car; once the car's front is 45 m from the space it sets off at the street's limit, and comes up behind as the car slows, signals and stops alongside the car in front of the space. It keeps back the room the car reverses into until the car is in, then goes by. A pass needs the car parked within 30 cm of the kerb (`not parked` is a failure). Rules and the cautious agent pull up, wait for nothing (the car behind has stopped back), reverse in in three legs and park within 20 cm of the kerb |
| Between the cars | Vancouver, Kitsilano | Hidden hazards on (`hidden`, sim/hidden-hazards.js). A straight block of Stephens Street (one lane each way, 50 km/h, residential, no school or playground zone) has its right kerb lined with cars 1.6 m apart, wherever one may park, from 55 m before a child's line to 25 m past it; the child stands hidden between the two either side of it, 0.6 m in from their traffic side. The car starts from a standstill, its front 110 m short of the child's line, and the route ends 30 m past it. Once the car's front is 15 m from the line, the child steps out and walks across the street at 1.5 m/s without looking. Rules and the cautious agent keep to the blind-spot speed (32 km/h) beside the parked cars, see the child as they come out, at about 14 m, and stop short; at the street's 50, as Rules drives it without hidden hazards, the car cannot stop and hits them. |
| Blind left | Vancouver, Kitsilano | Hidden hazards on (`hidden`, sim/hidden-traffic.js). West 4th Avenue (two lanes each way, 50 km/h) at a signal where the car turns left on a plain green, opposite an approach with two lanes and a left turn of its own. A delivery van waits in the junction to turn left from that approach's leftmost lane, its front 5 m short of the centre, its indicator on. The car starts 70 m before its line. Once its front is 45 m from it, a car sets off 75 m before the opposite line in the lane beside the van at 45 km/h, going straight through: beyond what the car can see at first, then hidden behind the van. A second after it is 10 m past the junction's centre (or 30 s after it set off), the van turns. Rules and the cautious agent wait at the near edge of the cross street until they can see along the hidden lane, see the car as it comes out from behind the van, at about 28 m, and turn once the van has gone. Without hidden hazards the car sees it through the van and waits for it as for any oncoming car |
| Behind the plow | Winnipeg, Exchange District | Snow. William Avenue (two lanes each way, 50 km/h, straight for 500 m to a signal). A snow plow (sim/snow-plow.js) clears the left lane at 18 km/h, its blue and amber lamps flashing, its rear 20 m ahead of the car's front as the car starts from a standstill in the curb lane, 15 m along the street; the curb lane is empty to the destination, 330 m on and at least 60 m short of the signal, and the plow carries straight on. Passing the plow on the right (`passed plow on the right`) is a failure. Rules and the cautious agent stay 30 m behind it in the curb lane all the way (in falling snow the car may not pass it at all). With the same truck not known to be a plow, Rules draws level with it on its right 12 s in |
| Take turns | Calgary, Beltline | 14 Avenue SW (one-way, two lanes, 50 km/h). A road crew has closed the right lane (sim/lane-closure.js), its merge point 54.5 m along the block; seven cars stand queued in the left lane back from it, 7.5 m apart, and two wait at it in the right lane, 8 m apart. The car starts from a standstill in the right lane, its front 30 m short of the merge point, and the route ends 12 m short of the block's signal. One from each lane in turn, the order through the merge point is the first car in the left lane, the first in the right, the second in the left, the second in the right, the third in the left and then the car. Merging out of turn (`merged out of turn`) is a failure. Rules and the cautious agent wait at the merge point while the third car in the left lane goes, then merge |
| Give them room | Vancouver, Kitsilano | Passing cyclists on (`passCyclists`, sim/cyclist-pass.js). The West 10th Avenue bikeway (two-way, one lane each way, 30 km/h, parking both sides), westbound from Vine Street to Balsam Street, 172 m; both kerbs are lined with cars 1.6 m apart wherever one may park, so the cyclist rides out in the lane. The car starts from a standstill, its front 20 m along the block; a cyclist rides 14 m ahead of it at 15 km/h, straight on; and two cars, 12 m apart, come down the oncoming lane at the street's limit, the first 50 m ahead of the car, in sight from the start. The route ends 80 m along the next block. Passing the cyclist closer than the minimum passing distance (`passed a cyclist too close`), or into the oncoming cars (`failed to yield`), is a failure. Rules and the cautious agent stay behind the cyclist for about 6 s, until both oncoming cars are by, then start round it 7 s in through the oncoming lane, 1.25 m clear of it at closest, and are back in their lane ahead of it by 14.5 s. Without passing cyclists the car trails it along the block |
| Over the humps | Ottawa, Centretown | Traffic calming on (`calming`, sim/traffic-calming.js). Gloucester Street (one-way, one lane, 50 km/h, outside any school or playground zone): the car starts from a standstill 4 m along the block from Bank Street, with a clear run to a speed hump 85 m along it; it carries straight on over Kent Street to the next block and its own hump, 86 m along, and the route ends 50 m past that. Taking a hump with the front axle more than 10 km/h over its 30 km/h (`took a speed hump too fast`) is a failure. Rules and the cautious agent cross both at about 30 km/h; with calming off the car takes them at 50. |
| All walk | Victoria, Old Town | Scramble crossings on (`scrambles`, sim/signals.js). The signal at Government Street, Wharf Street and Humboldt Street, by the Empress, which OSM marks as a scramble crossing: its cycle ends with a 10 s all-walk and an 18 s flashing hand, every approach red. The car starts on Wharf Street 75 m short of the line, to turn right onto Government Street, and its light turns red as it arrives (at about 12 s), staying red through the all-walk (36 to 64 s). Two people stand at the corner opposite the one the car turns round, and on the walk cross diagonally to it, one at 1.3 m/s and one at 0.45 m/s, still crossing as the car's light turns green. Turning right on red (`red light`) is a failure. Rules and the cautious agent wait at the line, then let the slow walker reach the kerb before they turn; with the scramble off Rules turns right on red at once. |
| Collection day | Vancouver, Kitsilano | Garbage trucks (sim/collection-truck.js). West 5th Avenue (two-way, one lane each way, parking both sides): a garbage truck stands at a stop in the car's lane, cars parked at the kerb beside and behind it, and the car starts from a standstill 60 m short of its rear. Once the car's front is 38 m from the truck, one of its crew goes to the bins at the right kerb and one crosses behind it to the far kerb (once nothing moving would reach them within 4 s) and back, as two cars, 16 m apart, come down the oncoming lane at the street's limit, the first 75 m past the truck's front. The truck stays until the car is past it; the route ends 45 m past it. Passing a worker closer than 1.5 m (`passed a garbage crew worker too close`) and going round into an oncoming car (`failed to yield`) are failures. Rules and the cautious agent wait 10 m back until the worker is back and the cars are by, then go round at 20 km/h. |
| Stop for the guard | Montréal, morning | Rue Berri beside École Louis-Hippolyte-Lafontaine, 9:00. Guards on (`guards`): the car starts 95 m before a marked school-zone crosswalk. At 50 m the guard looks for a safe gap, raises the STOP paddle and walks three children across, then returns to the curb. Stop short and wait until the guard and every child are off the entire roadway. Passing the raised sign once a stop was possible (`guard_violations`) fails the drive. Route ends 50 m past the crosswalk. |
| Wait for the far curb | Ottawa, Centretown | Ontario PXO on Metcalfe Street (OSM node 2317854682). A slow walker crosses from the far/left sidewalk of this one-way street. The inner lane clears early; stay stopped until the person reaches the far curb across the whole roadway. Leaving early (`pxo_early_goes`) fails the drive. |
| Buses only | Vancouver, Mount Pleasant | Main Street at 8:00, bus lanes on (`busLanes`): the curb lane is bus-only from 7:00 to 9:30 on weekdays. The car keeps out of it, then moves into it in the last 50 m before the right turn onto East 4th Avenue. Driving more than 1 m in it outside that approach (`bus_lane_driving`) fails the drive. |
| No left turn | Toronto, Bathurst Street | Turn restrictions on (`restrictions`). OSM relation 124176 prohibits the shortest route’s left turn; navigation takes a legal detour. `illegal_turns` fails the drive once a restriction has applied. |
| Both ways | Montréal, Le Plateau | Contraflow cyclists on (`contraflow`, sim/contraflow.js). The car starts from a standstill on Rue Drolet (one-way), its front 45 m short of Rue Villeneuve Est, to turn right into it: one-way for cars, with a painted contraflow lane, at a junction without a sign. A cyclist rides out of Villeneuve toward the junction in that lane at 16 km/h, 65 m from it, from the car's right; it is hidden behind the corner building until the car is close. The street is too narrow to meet it with the minimum passing distance. The route ends 40 m along the next block of Villeneuve, past Avenue Henri-Julien. Cutting the cyclist off (`failed to yield`) or meeting it closer than the minimum passing distance (`contraflow_conflicts`) fails the drive. Rules and the cautious agent stop short of the junction about 8 s in, wait about 5 s while the cyclist comes out, then turn in; a car that does not see it runs into it. |

Suite version 2 adds the merge and obstructed crossing; the unprotected left, right on red, four-way stop, blind corner, right hook, lights and sirens, pulling out, the multiple threat, flashing reds, the school zone, move over, behind the doors, clear the tracks, keep the box clear, not your arrow, follow the flagger, lights out, round the van, squeeze in, between the cars, blind left, behind the plow, take turns, give them room, over the humps, all walk, collection day and both ways joined it later, at version 1. Each challenge separately versions
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

**Buses only** (`bus-lanes`, Mount Pleasant, Main Street, 08:00): keep out of the
active bus lane, then merge into it within 50 m of the final right turn. Rules and
the cautious starter share the lane restrictions and normal merge gap checks.
“No left turn” (`no-left-turn`, Toronto, Bathurst Street) follows a legal detour around a real OSM no-left-turn restriction. Turn restrictions are enabled only for this challenge and free drives; existing challenges keep their routes and scoring.

Overnight flashing operation is a simulation policy, not a claim about Halifax's actual signal
schedule. At flashing red, stop fully before the crosswalk and wait until safe; it is a two-way
stop, so the amber main street does not join an arrival-order queue. Amber means proceed cautiously
and yield to people and traffic already in the junction. See [BC Motor Vehicle Act s. 131(1), (3)](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96318_05#section131).

**Both ways** (`contraflow`, Montréal, Rue Drolet into Rue Villeneuve Est, seed 40042): give way to a
cyclist coming out of a one-way street in its contraflow lane before turning in. Contraflow cyclists
are on only for this challenge and free drives; the challenge places its one cyclist and no others.

## Paired amber-light lessons

**Room to stop** (`amber-stop`, seed 44042) and **Keep going safely** (`amber-clear`,
seed 45042) use the same unchanged West 4th Avenue signal at Maple Street in Kitsilano.
Both start already moving at 36 km/h, one second before amber. The first starts with its
front 65 m short of the stop line; the second, 23 m short. The route carries straight
through the junction and 100 m along the next block. Both local drivers stop and wait for
green when a safe stop is available, and continue cautiously on amber when it is not.
They do not speed up to catch the light. An obstruction still takes priority.

The decision uses grip, speed and braking response at the first visible amber observation;
it stays fixed for that amber phase and survives replay checkpoints. A manual driver who
ignores an available safe stop or accelerates to beat amber fails the amber audit. Entering
on red remains a red-light violation. The feature is enabled in these two lessons and in
free drives (`?amberlights=0` disables it); other challenges and seeded benchmarks retain
their previous behavior.

The legal basis for the BC lessons is [BC Motor Vehicle Act s.128(1)(a)](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96318_05#section128):
stop for amber unless the stop cannot be made safely. The stopping-distance calculation
is a conservative simulator policy, rather than a statutory distance or a claim about
every province's laws. Focused dry/snow and replay coverage lives in
`scripts/test_amber_challenges.mjs` and `scripts/test_amber_policy.mjs`.


## Space to react

Both lessons enable the shared following-distance policy. It accounts for road grip,
relative speed, decision time, actuator lag and brake response. These are conservative
simulator targets, not statutory following distances. AI eyes shows the actual and target
bumper gaps; model observations and event-linked decision records retain the same values.

In **Brakes ahead**, the leader on West 6th Avenue brakes after three seconds,
stands for four seconds, then resumes. The car need not come to a full stop if room remains
and the leader has moved off. In **Make room**, a car in the left lane of West 4th Avenue
moves into the driven car's lane over 3.5 seconds, then accelerates toward the speed limit.
Both use the ordinary vehicle physics and are repeatable after restoring a checkpoint.

Coaching grants five seconds to recover when a newly encountered leader moves sideways into an
existing gap. Continuing to follow below the target after that window lowers the safety
score; reacquiring the same leader does not reset the allowance. Moving into a short gap yourself earns no allowance. Collision checks and
emergency braking remain active throughout. Existing challenges leave the feature off.


## Fresh green

**Fresh green** (`fresh-green`, Edmonton, seed 48042) uses the unchanged signal at 106 Street NW
and Whyte Avenue NW (`sig3`). The car waits at the red on 106 Street NW, heading south, its front
1.5 m short of the line, three seconds before its green. A car on Whyte Avenue NW, coming from the
car's left in the near curb lane at 11 m/s (about the 40 km/h limit), is committed to running its
red: its front crosses its line a second after the car's light turns green. Both local drivers wait
at the line until it has cleared the junction, then carry on 100 m along 106 Street NW. A driver
who goes as soon as the light turns green enters ahead of it, is counted in
`fresh_green_conflicts`, and collides with it. Red-light runners are on only for this challenge
and free drives; the challenge places its one runner and no other traffic.
