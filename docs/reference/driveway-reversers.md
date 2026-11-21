# Driveway reversers (`sim/driveway-reversers.js`)

`jev/osm/driveways.py` builds `<key>.driveways.v1.json` beside unchanged packs from the raw OSM
ways tagged `highway=service` + `service=driveway`. A driveway end node counts when it lies on a
pack street's centreline or no more than 2 m outside its asphalt; ends within 8 m of an edge's end
(the junction's), at less than 35° to the street, or on a roundabout ring are left out, and a
second within 3 m on the same side is the same driveway. Each record keeps the edge, `s` along it,
the meeting point on the centreline (`x`, `y`), `side` (`right`/`left` of travel by the
`lateral > 0` convention; on two-way streets always the edge whose right it is on, so the near lane
is that edge's kerb lane), `heading` (from the street into the driveway) and `length`.
`uv run scripts/fetch_map.py <preset> --driveways` rebuilds only the layer; `server.py`,
`scripts/build_demo.py` and the Node tests load it with the others, and `MapData.driveways` lists
it. All twelve presets have layers (554 driveways: Ottawa 135, Calgary 128, Winnipeg 73, Mount
Pleasant 44, Halifax 37, Toronto 36, Kitsilano 34, Victoria 23, Edmonton 21, Saskatoon 14,
Montréal 7, Québec City 2).

`World` option `driveways` is on in free drives unless `?driveways=0`, and in the **Reverse
lights** challenge (`driveways: true`). One car at a time, 12–30 s into a drive and 30–70 s after
the last, a car is put nose-in in a driveway 110–200 m ahead along the route, on the side of the
lane the route keeps to, with nothing standing across its way out. It starts out once the car's
front is 50–105 m short of it (all from its own random stream). Its way out is a path for the rear
axle (`drivewayGeometry`): straight back from behind the sidewalk, then a quarter circle of 6 m
radius into the centre of the near lane, ending facing the traffic. It drives the shared car model
in reverse, steering by pure pursuit with its rear as the nose: `creep` across the sidewalk at
0.8 m/s with its reverse lamps on, `look` with the nearest corner of its body 0.8 m outside the
near lane for at least 0.8 s, `out` into the lane at 1.5 m/s once nothing it can see (or hear,
within 8 m) is coming along that lane within 12 m or 2.5 s, `pause` for 1–2 s with the lamps off,
then it hands over to `NpcFleet` as an ordinary car on its own random stream. It stops for
anything about to be in its way in the next second. With hidden hazards on, `World.sees` lets the
cars parked at the kerb hide it from the street (`reverserHidden`), and the same test hides the
street from it, so it may come out while the driven car is out of its sight. People on the
sidewalk walking toward it wait while it backs across. With the option on, the parked cars
standing across any driveway's way out are removed as the world is built and their slots stay
empty.

Sensing, the forward sims, traffic and the audit share `reverserConflict`: the boxes the car
backing out needs (its way into the lane while it creeps or looks, `coming`; its body now, half
way and at the end of its way while it backs in or pauses in the lane, `in_lane`) against a
vehicle's line along its lane, its way only. For `coming`, a driver slows to reach 4.5 m/s by
10 m short of the conflict (`cautionSpeed`); for `in_lane`, it stops 2.5 m short and waits until
the car has driven off. Sensing reports `reversing_vehicle` (`wait`, `stop_s_route`,
`bumper_to_stop_m`, `limit_mps`, `reverse_lights`, `min_pass_m`), caps `snap.limit`, and
`desiredSpeed` stops at the wait point. The `yield_to_reversing` candidate slows, or stops there;
forward sims predict the reversing car along its way out (`reverserBoxAt`) rather than at constant
velocity, and reject `passes_reversing_vehicle_too_close` for passing the wait point by more than
1 m or passing a car with its reverse lamps on within 1 m. Rules stops at the wait point and
prefers the yield candidate; the cautious agent takes it whenever the car must wait. Models get a
`reversing_vehicle` field, a situation clause, a stop criterion for the motion question and a line
in the system prompt. Traffic (`reverserYield`) caps its speed and holds at the same point once it
could still stop there.

The audit counts passing a car with its reverse lamps on with less than 0.9 m between the bodies
while moving, and coming within 1.5 m of one backing into the lane while still moving, each once
per car, as `reversing_conflicts`, reported (and failing a drive) only once a car has backed out
within 60 m of the driven car (`World.drivewaysSeen`). The drive score costs 20 safety points each,
with an incident, a coaching tip and a replay marker. The renderer draws a concrete apron with a
dropped kerb across the curb, boulevard and sidewalk at every mapped driveway (a ground layer
between the curb and the asphalt), and white reverse lamps on the car while `reverseLamps` is set
(render-only). The HUD says CAR BACKING OUT AHEAD, and CAR BACKING OUT · GIVE IT ROOM once the car
must stop.

**Reverse lights** (`reverse-lights`, seed 49042, Calgary, 13 Avenue SW, dry afternoon, hidden
hazards on): the first driveway on the right of a two-way residential block with one lane each way
and a parking lane (`drivewaySites`). Parked cars line both kerbs from 60 m before the driveway to
30 m past it, clear of its way out. The car starts from a standstill 110 m short of the driveway;
the car in the driveway, already across the sidewalk, starts backing out once the car's front is
70 m from it. It cannot see the car through the parked cars and comes out into the lane while the
car is about 30 m off. The route ends 30 m past the driveway. Rules and the cautious agent see it
as it comes out, stop about 9 m back, wait for it to drive off and follow it. A driver who keeps
going at 32 km/h squeezes past or hits it (`reversing_conflicts`). Checks:
`scripts/test_driveway_reversers.mjs` (its `--write-snapshots` writes the live-model case
`data/snapshots/reverse_lights.json`) and `tests/test_driveways.py`.

The hooks for world setup, sensing, planning, simulation, traffic and audit live in
`sim/features/driveways.js` ([feature interface](../feature-interface.md)).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Driveway reversers are opt-in.** `World` option `driveways` (free drives, unless `?driveways=0`; challenges with `driveways: true`) has a car parked nose-in in a driveway of the map's driveways layer near the car's route back out now and then, from its own random stream (`sim/driveway-reversers.js`, `World.driveways`): it creeps across the sidewalk, looks, backs into the near lane on the shared car model in reverse and hands over to `NpcFleet` as an ordinary car. Reversers are not in `world.npcs`: `world.obstaclesNear` adds them, `World.sees` lets parked cars hide them with hazards on, and sensing (`reversing_vehicle`), candidates (`yield_to_reversing`, `passes_reversing_vehicle_too_close`, forward sims predicting them along their way out with `reverserBoxAt`), traffic and the audit share the one conflict test `reverserConflict`. With the option on, parked cars across a driveway are removed when the world is built. The audit's `reversing_conflicts` reaches the metrics, and fails a drive, only once one has backed out near the car (`World.drivewaysSeen`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way. `reverseLamps` is render-only.
