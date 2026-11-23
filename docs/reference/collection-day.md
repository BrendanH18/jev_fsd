# Collection day (garbage trucks)

Collection day (`static/js/sim/collection-truck.js`, `NpcFleet` option `collection`: on in free drives
unless `?collection=0`, from its own random stream; the "Collection day" challenge places a truck itself). The [feature record](../feature-interface.md) owns the fleet scheduler,
stop plan, crew audit and results metric, and restores the fleet references on rewind.
By day and out of fog, one garbage truck (a rear-loader, 9.6 m long and 2.5 m wide) works the quiet streets:
it is put down on a collection street 150 to 450 m from the car where the car cannot see it, and goes once
it has worked 4 to 8 minutes, or is 450 m away, out of the car's sight. A collection street is a quiet
(residential, unclassified or living) two-way street with one lane each way where a van could double-park
(`vanSites`: straight, no crosswalk, bus or streetcar route or level crossing, clear of the junctions at
each end), shortened for the truck's length. On one it drives at 15 km/h (30 km/h elsewhere), and every 24
to 42 m it slows to a stop in its lane (never by a van, a work zone, a lane closure or a vehicle at the
roadside), its hazards on and its beacons turning all the while. For the 8 to 14 s it stands there it is a
record in `world.doubleParked` (`placeTruck`, `truck: true`, named "garbage truck"), so everyone treats it
as a double-parked van (above): drivers wait with their front 10 m (`TRUCK_WAIT_M`) back of its rear, clear
of the crew, and go round through the oncoming lane at 20 km/h once that is clear; and also only once no
worker is out in the street (`crewInRoad`, in `wayRound`): left of the truck's left side short of the far
kerb, more than 1.2 m behind its rear in its lane, or across the street with the crossing back still to
make. The driven car counts only workers it can see. A worker (a pedestrian with `crew` set, in a hi-vis
vest) gets down from the rear step to the bins at the right kerb and back; at 45% of stops another crosses
behind the truck to the far kerb's bins and back, stepping into the street only once nothing moving would
reach them within 4 s. Each pauses 3 to 5 s at the bins and climbs back on. Once the crew is back and nobody
is beside the truck or going round it, it drives on. On a street with one lane each way nobody passes a
truck on the move: it is traffic, followed as any other. The driven car's sensing reports it as
`double_parked` with `truck` and `crew_in_road`; Rules waits behind it with `wait_behind_van`, and
decision models and LLMs get the truck's own situation line and a prompt line. The audit counts the car's
body, moving at more than 7 km/h, coming within 1.5 m of a worker as `crew_close_passes`, once a worker,
which the metrics report and fail a drive on (`passed a garbage crew worker too close`), only once a truck
has stopped to collect in the drive (`World.collectionSeen`); going round into the way of oncoming traffic
is a failure to yield, as for a van. Coaching counts close passes (`crew_close_passes`) with a tip. The HUD
says "GARBAGE TRUCK · CREW IN THE ROAD · WAIT BEHIND IT", "GARBAGE TRUCK · ONCOMING TRAFFIC · WAIT BEHIND
IT", "GARBAGE TRUCK · WAY CLEAR · GO ROUND IT" and "GARBAGE TRUCK · GOING ROUND · SLOWLY, BACK INTO YOUR
LANE PAST IT". Side-loading trucks with an arm and no crew in the street, trucks reversing into lanes,
and bins standing in the street are not modelled. The bare benchmark has collection disabled by default.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Garbage trucks are opt-in.** `NpcFleet` option `collection` (free drives, unless `?collection=0`) puts a truck to work on the quiet streets by day, from its own random stream (`sim/collection-truck.js`); the "Collection day" challenge places one itself. A truck standing at a stop is a record in `world.doubleParked` (`truck: true`) for as long as it stands there, so everyone treats it as a double-parked van, waiting `TRUCK_WAIT_M` back and going round only once no worker is in the street (`crewInRoad` in `wayRound`). Its crew are pedestrians with `crew` set. The audit's `crew_close_passes` reaches the metrics, and fails a drive, only once a truck has stopped to collect in it (`World.collectionSeen`), so the seeded benchmark and the other challenges report exactly as before; keep it that way.
