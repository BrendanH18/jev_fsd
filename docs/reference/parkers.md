# Traffic parallel parking (`sim/parkers.js`)

A car ahead that stops to parallel park. `World` option `parkers` is on in free drives unless
`?parkers=0`, and in the **Room to park** challenge (`parkers: true`). From 25 s into a drive, every
3 s while none is at it (90 s after one has parked, 30 s after one gave up), the ordinary traffic car
(not a cyclist, bus, school bus, train, plow, truck at work, emergency vehicle, car pulling out,
parking, running a light, passing a cyclist, tailgating or changing lanes, nor one that gave up
before; 5.5 m long at most) right ahead of the driven car in its lane, within 60 m and moving at
3 m/s or more, is looked at. `parkerPlan` finds it a space with the driven car's own code
(`sim/parallel-park.js`): `freeStretches` (the legal stretches of its street's right parking lane,
less what stands there and spaces others have reserved) and `planSpaceOn` (the driven car's
`planSpace` on the traffic car's own path, without the destination's checks): on its current edge, in
the lane beside the parking lane, not on the block of a work zone, a lane closure or a double-parked
van, its start 18–75 m ahead and at least what stopping at 1.8 m/s² needs, nothing in its way up to
there, and its whole S clear of anything standing (`sClear`, `parkRoom` every 0.25 m of it: the space's
own check covers the cars in front and behind, but on a narrow street the front swings out over the
far lane, into cars parked at the other kerb). Where its hold line also lies on the driven car's route (on it, not past its end), far enough
ahead for the driven car to stop at 2.0 m/s² and 8 m more, it becomes a parker with chance 0.35 (`PARKER_CHANCE`; a draw only
then, from the feature's own stream). One at a time.

`commitParker` keeps the plan on the car (`n.parker`), reserves the space's slots for it and puts its
right indicator on. The hold line is `hold` behind the rear bumper it will have where it stops to
start: the driven car's own `hold` (its reverse's length and 1.5 m, what traffic keeps back from the
driven car parking, `World.parkHold`) and 1.5 m more (`HOLD_MARGIN_M`); about 9 m for a compact car.
It drives up to its start (`parkerStop` in its driver's stop, easing up to 0.6 m right in its lane
over the last 20 m), stops alongside the car parked in front of the space, its rear bumper 0.5 m
behind that car's, and pauses 2 s (`PAUSE_S`), checking behind. Anyone in the room it really needs
(the hold, less the margin, across from its lane's far side to the kerb) or coming into it within
2.5 s keeps it waiting; with someone standing in that room for 12 s (`GIVE_UP_S`) it gives up and
drives on (also after 75 s before it has started back, or once it is 3 m past its start). Then
`planParking` and `stepParking` reverse it in, exactly as the driven car parks: legs at walking pace,
full lock toward the kerb, straight, full lock the other way, square and settle. While it reverses it
stops for anyone moving in that room and for anything standing within 1 m behind it (the driven car
included, which the shared manoeuvre's own clearance check leaves out). If the manoeuvre gets stuck (a
door opening beside it, say) it waits and starts again from where it stands every 1.5 s (`RETRY_S`); it
gives up only after 12 s of that, or blocked as long, while still within 12° of parallel and 0.8 m of
its start. Its reverse lamps (`reverseLamps`, drawn by
`render/driveway-reversers.js` `syncReverseLamps`, render-only) are lit while it backs up. Once in it
leaves the traffic (`world.npcs`) and is added to `world.parked`, in the nearest of its slots: a
parked car like any other, so `world.obstaclesNear` keeps returning it through the parked cars'
grid, and nothing follows it or counts it as moving traffic. (A challenge's parker stays put; one in
a free drive may later open a door or pull out like any parked car.)

`parkerConflict` is the one test: for a vehicle going along a path (its route, or an `NpcPath`), its
front bumper `front` along it and `lat` right of it, the nearest parker going its way (headings within
60°) whose hold line projects onto the path within 1.6 m of its line (`BAND_M`) and 90 m ahead, with
the vehicle's front still short of the parker's rear bumper (0.5 m slack): `{ parker, phase,
to_hold_m, gap_m, hold_m, line_s }`. Traffic and cyclists (`sim/npc.js`) stop at the hold line (it is
their leader there, with their standstill gap on top) and make no lane change while it applies, so
they neither creep into the room nor go round it, until it is in. Sensing reports `parking_ahead`
(`id`, `phase` "signalling", "stopped" or "reversing", `signal`, `reverse_lights`, `gap_m`, `hold_m`,
`bumper_to_stop_m`, `stop_s_route`, `wait`, `in_room`, and `stops_in_m` while it is still on its
way) for one the car can see; `desiredSpeed` stops at the hold line, and the parker stays the car's
leader as it swings into the space. The candidate `wait_for_parker` (stop at the hold line) is on
offer once the hold line is nearer than the queue behind the parker (until then the car follows it);
the forward sims reject `blocks_parking_car` for any manoeuvre but `hard_brake` that takes the front
more than 1 m past the hold line, which also rules out going round it. Rules stops at the hold line
and prefers `wait_for_parker` (−6); the cautious agent takes it while `wait` holds; the deadlock
detector leaves the car be while it waits there. Models get a `parking_ahead` field (`now`,
`room_it_needs_m`, `wait_in_m` or `in_its_room`), a situation clause, a stop criterion and a line in
the system prompt. The HUD says CAR PARKING AHEAD · WAIT (or · REVERSING IN · WAIT); the coach says to
stay well back and wait; AI eyes draws the parker amber, and the Lab panel lists it with the room it
needs and where the car waits.

The audit (`auditParkers`) counts, once per parker, the driven car's front more than 0.5 m past the
hold line while the parker is stopped to start or reversing (it blocks it, whether it drove in then
or had crept in behind it before), and going past the parker's front after having been behind it in
its lane while it is still at it, as `parking_conflicts` (event `parking_conflict`, reason
`blocked` or `passed`). It reaches the metrics and fails a drive (and a road test, under "space")
only once a parker has signalled ahead of the car (`World.parkersSeen`). The drive score costs 20
legality points each, with an incident, a coaching tip and a replay marker. A parker backing into the
stationary driven car is the parker's collision (`fault: "other"`). With the option off nothing is
computed, no random number is drawn, and the seeded benchmark and the other challenges play out and
report exactly as before.

**Room to park** (`room-to-park`, seed 58042, Kitsilano, Larch Street, dry afternoon): the first block
of Larch Street (`e103`, southbound from West 13th Avenue, 426 m, one lane each way, 50 km/h, parking at both kerbs) that is
straight with room to park all along it (`parkerSites`). Its right kerb is lined with parked cars,
1.3 m apart, from 70 m behind a gap of 8 m to 30 m past it, and cars line the far kerb too. The car
sets off at 30 km/h; the parker starts 18 m ahead of it at the same speed, 55 m short of its stop,
already signalling for the gap; the route ends 60 m past the gap. It stops about 11 s in, pauses and
reverses in, parked about 29 s in. Rules and the cautious agent stop at the hold line, about 9 m
behind it, wait, and then drive on (arriving at about 42 and 43 s). A driver who follows it close and
stops behind it blocks it: it gives up and drives on, and the drive fails (`parking_conflicts`).
Checks: `scripts/test_parkers.mjs` (its `--write-snapshot` writes the live-model case
`data/snapshots/room_to_park.json`).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Traffic parallel parking is opt-in.** `World` option `parkers` (free drives, unless `?parkers=0`; challenges with `parkers: true`) now and then, from its own random stream, makes the ordinary traffic car right ahead of the driven car in its lane a parker (`sim/parkers.js`, `World.parkers`) where its street's right parking lane has a free space: `freeStretches` and `planSpaceOn` plan it and `planParking`/`stepParking` drive it, the driven car's own parallel-park code on the shared car model (`planSpace`'s `anywhere` flag only skips the destination checks; the `parkAtGoal` path is untouched). It signals right, stops alongside the car in front of the space, pauses, reverses in, and then leaves `world.npcs` for `world.parked` (its slot taken), so `world.obstaclesNear` still returns it; blocked for `GIVE_UP_S` it gives up and drives on. `parkerConflict` is the one test, shared by sensing (`parking_ahead`), candidates (`wait_for_parker`, rejection `blocks_parking_car`), Rules, the cautious agent, the model wording, traffic and cyclists (`sim/npc.js`: they stop at its hold line, `hold` behind where its rear bumper stops, and change no lanes) and the audit. The audit's `parking_conflicts` (in its room while it is stopped to start or reversing, or going past it after being behind it) reaches the metrics, and fails a drive, only once a parker has signalled ahead of the car (`World.parkersSeen`). A parker backing into the stationary driven car is the parker's collision. With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
