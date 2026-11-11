# City traffic collision investigation, 10 November 2026

Starting tree: `339e030`. Node 22.23.4, Kitsilano, Rules, seed 1, 40 traffic cars,
`features: city`, Monday 15:30. Runs use port 8381 and the production Node benchmark.
The original rain s1-10 and fog s1-7 results reproduced the supplied records exactly,
apart from wall-clock timing. The remaining original runs were instrumented through
the reported collision, then stopped. No routing, yielding, stuck-car recovery or
snow-deadlock behavior was deliberately changed.

## What the traces showed

- **Rain s1-10, car_39, 260.6 / 286.4 / 312.3 s.** An ordinary driver encounters
  a nose-to-nose standoff ahead and invokes `NpcFleet.backOff`. It reverses into the
  stationary driven car behind it at 1.5 m/s, then drives forward and repeats.
  `world.obstaclesNear` excludes the driven car; this controller never added it.
  `sim/npc.js` now includes the ego in its rear-clearance check.
- **Fog s1-7, school_bus_2, 51.2 s.** The stopped car's rear axle is outside the
  leader corridor while its angled body sticks into the bus's lane. At 49.98 s the
  bus travels at 8.2 m/s with no detected leader. Its six-metre body check only
  recognizes the car at 50.42 s, with 4.5 m remaining. Braking and actuator lag
  cannot stop the bus before contact at 4.7 m/s.
- **Snow s1-7, school_bus_1, 278.1 s.** A school bus turns right across the stopped
  car's position. Its lane-based body prediction assumes the long body already
  points along the lane tangent; the real bus front swings farther outside the
  turn. At 277.87 s it still accelerates with a different leader 26.2 m away,
  immediately before its front hits the car at 3.1 m/s.
- **Rain s1-7, fire_truck_2, 345.2 s.** A fire truck squeezes alongside the stopped
  car. Its desired lateral offset clears the car, but its actual pose and steering
  response lag that offset. When the span search finds no opening, the old caller
  falls back to the preferred road position, steering toward the occupied lane.
  The ideal lane footprint misses the real front's approach. It contacts the
  stationary car at 3 m/s. With no opening the truck now holds its present line,
  brakes for the obstructing spans, and retains the blocked-driver notification
  that asks a car ahead to drive on. For buses and emergency
  vehicles, `sim/npc.js` now predicts the swept footprint using a cloned shared
  vehicle model and the driver's pure-pursuit steering, starting at the real pose.
  Its lookahead includes actuator response and grip-dependent stopping distance.
  This supplements clearance against the driven car; the existing NPC-versus-NPC
  footprint checks remain in force unchanged.
- **Snow s1-12, car_p3, 301.7 s.** This is a pulled-out parked car, subsequently
  selected by the older `maybePark` parking-in routine, rather than the opt-in
  parallel parker. At 299.53 s `n.parking` is active, aiming for a bay 57.7 m ahead.
  `parkStep` bypasses ordinary following and only checks a 0.8-second swept
  envelope. It accelerates toward the stopped ego, then brakes too late on snow.
  With `followingDistance` enabled, `sim/npc.js` adds grip-dependent stopping
  distance to this envelope. The policy remains off in the bare preset.
- **Dry s1-4, ped_23, 330.7 s.** The pedestrian takes an ordinary unmarked crossing
  on Balsam Street. The driven car has stopped diagonally across part of it.
  `clearFor` ignores stationary vehicles and `threat` ignores anything below
  2 m/s, so the pedestrian walks into its body at 1.6 m/s. This is a pedestrian
  model bug independent of why the driven car is stuck. `sim/pedestrians.js` now
  waits before walking into a stopped vehicle's footprint and resumes once it
  clears. An already-overlapping person may leave rather than becoming trapped.

## Focused regressions

All checks use `node --experimental-default-type=module`, assert on primitives,
and end with `process.exit(0)`:

- `scripts/test_traffic_backoff.mjs`: occupied and clear reverse paths in dry,
  rain and snow.
- `scripts/test_traffic_body_sweep.mjs`: angled car outside the leader band,
  school-bus front swinging outside a right turn, fire-truck steering lag, and
  holding its line and notifying the driver ahead when no safe passing gap exists.
- `scripts/test_traffic_parking_clearance.mjs`: a parking-in driver approaches
  but stops behind the ego in dry, rain and snow.
- `scripts/test_pedestrian_stopped_car.mjs`: stopped ego and stopped NPC bodies,
  plus crossing resumption after the vehicle clears and boarding a rider's own
  streetcar through its door.

Each check failed against its original module and passed with the fix.

## City scenarios before and after

These are the production runner's result lines (collisions / at-fault collisions;
`off` is seconds off-road, `dl` is detected deadlocks). Every listed contact was
other-party fault. Collision removal alone does not make the remaining timeouts
or other audited failures pass.

```text
dry, before: s1-4 FAIL arrived=false t=357.6 coll=1/0 off=0 dl=0 safety=1 lc=1 ped_23:pedestrian@330.7
dry, after: s1-4 FAIL arrived=false t=357.6 coll=0/0 off=0 dl=0 safety=1 lc=1
fog, before: s1-7 FAIL arrived=true t=440.5 coll=1/0 off=0 dl=0 safety=3 lc=0 school_bus_2:school_bus@51.2
fog, after: s1-7 FAIL arrived=false t=497.2 coll=0/0 off=0 dl=0 safety=4 lc=0
rain, before: s1-7 FAIL arrived=false t=497.2 coll=1/0 off=0 dl=0 safety=1 lc=3 fire_truck_2:fire_truck@345.2
rain, after: s1-7 FAIL arrived=false t=497.2 coll=0/0 off=0 dl=0 safety=1 lc=3
rain, before: s1-10 FAIL arrived=false t=363.2 coll=3/0 off=0 dl=4 safety=0 lc=0 car_39:car@260.6 car_39:car@286.4 car_39:car@312.3
rain, after: s1-10 FAIL arrived=false t=363.2 coll=0/0 off=0 dl=0 safety=0 lc=0
snow, before: s1-7 FAIL arrived=false t=497.2 coll=1/0 off=0 dl=0 safety=1 lc=0 school_bus_1:school_bus@278.1
snow, after: s1-7 FAIL arrived=false t=497.2 coll=0/0 off=0 dl=0 safety=0 lc=0
snow, before: s1-12 FAIL arrived=false t=434.8 coll=1/0 off=0 dl=0 safety=0 lc=0 car_p3:car@301.7
snow, after: s1-12 FAIL arrived=false t=434.8 coll=0/0 off=0 dl=0 safety=0 lc=0
```

Remaining failures in the final runs:

- dry s1-4: timeout.
- fog s1-7: timeout, failed to yield.
- rain s1-7: timeout, failed to yield.
- rain s1-10: timeout, failed to yield, ignored a ball rolling into the street.
- snow s1-7: timeout, failed to yield.
- snow s1-12: timeout.

Fog s1-7 arrived in the original run despite its collision; with collision avoidance
it now times out and records a yielding failure. No routing, progress or yielding
fix is included here. No reported collision remains in these reruns. No full city
matrix or additional seeds were run.

The [machine-readable record](traffic-clearance-2026-11-10.json) contains the
before/after metrics and compact, primitive-only trace excerpts.

## Bare compatibility

The final dry bare suite passes 12/12. Its **entire config, aggregate summary and
all 12 complete result objects, including events, are field-for-field identical**
to the supplied `before-bare.json`, excluding only `wall_ms` and latency fields.
The normalized checksum and aggregate are saved in the JSON record.

An initial unconditional parking-envelope extension changed bare s1-7's arrival
from 209.1 to 214.2 s. Isolating the three shared changes identified parking-in as
the cause. Its longer stopping envelope now follows the existing opt-in
`followingDistance` policy, as ordinary motor traffic does. The city preset has
that policy on; bare keeps its original envelope. The reversing and pedestrian
fixes need no feature guard and preserve all bare results.

## Existing checks

All 19 Node scripts passed; each finished below 360 seconds. In addition to the
four focused checks, the existing checks were `test_school_buses`, `test_buses`,
`test_emergency`, `test_pull_out`, `test_parkers`, `test_parking_ego`,
`test_parking_reservations`, `test_crosswalks`, `test_right_hook`,
`test_vehicle_models`, `test_following_integration`, `test_streetcars`,
`test_collection_trucks`, `test_crossing_guards`, and `test_drive_lab`
(all under `scripts/`, with `.mjs`).

`test_drive_lab.mjs` passed 331 checks, including all 60 challenges with both
Rules and the cautious driver, in 65.57 seconds. The school-bus check passed all
19 cases and the streetcar check all 18, including normal passenger boarding.
The JSON record contains per-script exit codes and durations. `git diff --check`
also passed.
