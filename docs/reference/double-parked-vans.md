# Double-parked delivery vans

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
van in amber. The bare benchmark has no delivery vans. The city preset uses the free-drive setup.

## Agent rules

The [feature record](../../static/js/sim/features/double-parked.js) takes the `vans` count and
builds `World.doubleParked`. With the count at zero, its state still accepts authored vans and
stopped garbage trucks. Both use the same sensing, bypass and audit hooks. The passing audit
increments the shared `failed_to_yield` counter. Keep the step after outages, and keep the traffic
departure handoff before plow dispatch and garbage collection.
