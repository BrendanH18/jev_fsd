# Bus-only lanes

`jev/osm/bus_lanes.py` builds `<key>.buslanes.v1.json` from the raw ways;
`--buslanes` rebuilds only this layer without changing street packs. Lane lists,
counts, busway sides and conditional hours map onto existing directed edge/lane
indices. Weekday/time windows are minutes since midnight; unknown schedules are
retained and conservatively active. The day comes from the world clock's `weekday`
(Monday = 0, the default; `?weekday=` in free drives, and the app clock moves it on at
midnight), as for turn restrictions. No clock means inactive.

`World.busLanes` enables `sim/bus-lanes.js`, sensing `bus_lane`, route lane choice,
NPC lane choice and gap-checked lane changes, candidate filtering and both local
agents. Cars may enter a reserved lane in the final **50 m** before a right turn,
or during the actual curb parking/pull-out manoeuvre. Buses retain access;
explicit taxi/bicycle permissions are kept in the layer. The audit measures
`bus_lane_driving` in metres, in the lane the car is actually in, with or without a
route (the route only grants the right-turn approach); more than 1 m fails the drive (tolerance for lane
projection at joins). It is reported only after an active lane is encountered.
Red surfaces and BUS ONLY/diamond paint follow fixed ground render ordering.
No random stream is drawn with the option off. Focused check:
`node --experimental-default-type=module scripts/test_bus_lanes.mjs`.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Bus lanes are opt-in.** `World` option `busLanes` (free drives, unless `?buslanes=0`; challenges with `busLanes: true`) reserves the lanes of the map's buslanes layer while their hours apply (`sim/bus-lanes.js`, `bus_lane` in sensing, `Route.busLanePolicy`, `NpcPath.busLanePolicy`). Cars enter one only in the last `BUS_TURN_M` (50 m) before a right turn, or to park or pull out at the curb; buses use it. The audit's `bus_lane_driving` (metres, in the lane the car is actually in) reaches the metrics, and fails a drive, only once a bus lane has been in effect where the car was (`World.busLanesSeen`). Hours use `world.clock.hour` and `weekday` (Monday = 0, the default), as turn restrictions do; with no clock no lane is in effect. Where the policy keeps the car out of the route's own (curb) lane up to a street whose lanes do not carry on, `Route.busMerges` moves lane laws onto the next street with the polyline; a right turn into a reserved curb lane may leave it over a lane change's length (`turned_in_m`), at the speed latched when the car starts out of it (`World.busTurnIn`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
