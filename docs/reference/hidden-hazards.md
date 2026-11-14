# Hidden hazards and hidden traffic

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
traffic carry `unseen` when another vehicle's body hid it from the car as it pulled out (`World.hiddenByVehicle`); the coaching score counts
those (`hidden_cutoffs`, an incident each, and a tip), reported only with hidden hazards on. The HUD says
"THE VAN HIDES THE ONCOMING LANE · WAIT UNTIL YOU CAN SEE", "THE CAR HIDES THE CROSS STREET · CREEP UP AND
LOOK" (or "· WAIT UNTIL YOU CAN SEE" once it has looked) and "THE CAR HIDES TRAFFIC FROM THE LEFT · WAIT",
naming the vehicle's kind.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Hidden hazards are opt-in.** `World` option `hazards` (free drives, unless `?hazards=0`; challenges with `hidden: true`) makes vehicles standing at the kerb hide pedestrians (`World.sees`), makes road vehicles hide other vehicles and cyclists, with the car waiting to see along the lanes it gives way to (`sim/hidden-traffic.js`), turns on the driven car's blind-spot speed (`blind_spot` in sensing, `sim/blind-spot.js`), and with `stepOuts` lets people step out from between parked cars. With it off nothing is computed and no random stream is drawn from, so the seeded benchmark and the other challenges play out exactly as before; keep it that way.
