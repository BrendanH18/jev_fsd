# Puddles at the kerb (`sim/puddles.js`)

`World` option `puddles` is on in free drives unless `?puddles=0`, and in the **Don't splash**
challenge (`puddles: true`). With it off `World.puddles` is an empty, disabled `Puddles`: no random
stream is created or drawn from, sensing adds no `puddle_splash` field, no law gets a puddle
`slowTo`, traffic adds no `pdShift`, the audit does not run and no metric key is added.

**Placement.** `new Puddles(map, { enabled, seed })` walks the kerb lane (the rightmost, `lanes - 1`)
of every main (tertiary and up) and quiet street edge at least 30 m long, not roundabout rings, from
its own stream (`rng(seed * 2246822519 + 173)`): a corner puddle 6–14 m short of the junction the
lane runs into (55% of main streets, 30% of quiet ones; 0.9–1.9 m out from the kerb, 2–6 cm deep),
one over a catch basin every 45 m with a 30% chance (0.6–1.5 m, 2–5 cm), and long shallow ones, on
average one every 110 m of main street and 200 m of quiet street (0.4–1.0 m, 0.8–2 cm deep, 4–10 m
long); none within 2 m of another. Each record is a pothole-shaped ellipse, `{ id, edge, lane, s,
offset, a, b, depth, shape, x, y, heading, lane_w, puddle: true }`, its kerb-side edge against the
kerb face (`asphalt[1] + GUTTER` from the edge's centreline), so the wheel tests of
`sim/potholes.js` (`wheelRoom`, `wheelsCross`, `inPothole`, `crossesPothole`) serve for both. Where
a parking lane lies between the kerb lane and the kerb, no moving wheel reaches one. Mount Pleasant
gets about 780. `setList` replaces them (a challenge places its own); the recorder shares the
object between checkpoints.

**When they lie.** `puddlesLie(world)`: while `world.weather` is rain, and, once it has rained this
drive (`World.puddlesRained`, set by the audit and at construction), on through dry or fog until it
snows. While they lie, a pothole full of rain water (`sim/potholes.js`, with that option on) is
treated as a puddle too: the same splash test and speed, though the pothole module keeps its own
way round it and its own speed.

**Splash speed and reach.** `splashSpeed(h)` is 25 km/h for a 2 cm puddle, scaled by
`sqrt(0.02 / depth)` within 12–32 km/h (16 km/h at 5 cm). The water lands from 0.6 m inside the
puddle's kerb-side edge to 2.5 m beyond it, from 1 m behind the puddle to 3 m ahead: the kerb, and
the sidewalk of a street without a boulevard (a primary street's sidewalk centre is 2.1 m beyond
the asphalt), but not a residential sidewalk behind its 1.8 m boulevard. `splashRisk(world, h, eta,
seen)` is the one shared test: the pedestrians within that reach now (`eta` null), or, planning
ahead, who could be by the time a vehicle `eta` seconds away gets there (the zone grows by 1 m plus
1.6 m/s of walking along the street, at most 9 m, and 0.2 m across), among those `seen`. Empty means
the puddle is just water. Sensing, the forward sims (through sensing), traffic, the audit and the
renderer's flinch all use it.

**Sensing and candidates.** `puddlesAhead` reads the puddles (and water-filled potholes) in the car's
lane within 60 m (or the visibility range), projected along the route (cached per route), and keeps
those with someone the car can see within reach: `puddle_splash` is the next, `puddles_ahead` all,
each with `kind`, `people`, `person_ids`, `splash_mps`, `speed_mps` (90% of the splash speed times
the weather's speed factor), `room` and `shift_m` (`wheelRoom`, withdrawn when too close to make the
move), the `slow` window (60% of `comfort().decel`, below the speed 5 m before the front wheels get
there) and, for a puddle with room, the `detour` (`controller.detourAt`, as for potholes). Every one
without room caps `snap.limit` (`puddleLimit`) and the target speed names it ("puddle by the kerb:
people on the sidewalk"). The candidates add `ease_round_puddle` (the detour, at the target speed)
when there is room and no other detour is under way; every lane law whose lateral target would put a
wheel in one gets a `slowTo` entry (`lawSlows`). Forward sims sweep each tyre over them
(`simSplashes`) and reject `splashes_pedestrian` above the splash speed plus 0.3 m/s, `hard_brake`
excepted; when no other manoeuvre avoids it (someone stepped up too late), the splash rejection is
lifted rather than force a hard brake. Rules gives easing round a 1.5 bonus; the cautious agent takes
it when its end speed is near the target. Models get a `puddle` field, a situation clause, outcome
labels for `ease_round_puddle` and for laws that slow through one, and a line in the system prompt.

**Traffic.** `npcPuddle(world, n, front, base, busy)` reads the puddles (and water-filled potholes)
on the lanes of an NPC's path within 70 m that its wheels would go through where it keeps in the
lane, with someone within reach by the time it gets there: the first with room sets an in-lane
shift once its front wheels are 30 m short (eased at 0.6 m/s, `pdShift`, not while off the middle of
its lane for anything else: a lane change, work zone, lane closure, van, cyclist, pulling out, a
pothole or a bus stop), and every other one caps its desired speed at 85% of the splash speed, at
40% of `comfort().decel`. Cyclists and streetcars do neither. Traffic is kept polite in the sim:
nobody splashes on purpose. A traffic car that does go through fast (with nobody near, usually)
throws spray, which is render-only.

**Audit.** `auditPuddles` counts each pedestrian within reach (now, exactly) of a puddle or
water-filled pothole a wheel of the car is in, faster than its splash speed plus 2 km/h, as
`pedestrians_splashed`, once per person for each pass through it, with a `pedestrian_splashed` event (puddle,
person, km/h, splash km/h, depth). `World.puddlesSeen` is set once a puddle with someone within reach
is within 30 m ahead of the car's front, in or beside its lane; only then do the metrics report
`pedestrians_splashed`, which fails a drive ("splashed a pedestrian from a puddle"; the road-test
examiner files it under speed). `World.puddleWarn` names such a puddle while the car is heading
into it faster than its splash speed, for the coach. The drive score costs 20 legality points per
person, with an incident, a coaching tip and a replay marker.

**Rendering.** `render/puddles.js` draws every puddle as a coplanar ground fan of standing water on
`LAYER.patch + 0.7` (above the pothole holes, below the markings; `wetReflective`, gloss 2), shown
only while they lie. `PuddleView` throws droplets (one instanced mesh, at most 360) to the kerb side
from the right wheels of any vehicle (not cyclists) going through one faster than its splash speed,
and anyone within reach flinches away from the kerb for 1.2 s (render-only). The HUD says PUDDLE BY
THE KERB · PEOPLE ON THE SIDEWALK · EASE 0.3 M LEFT or · SLOW, AI eyes lists the next one, and the
coach says to ease left or slow down.

**Don't splash** (`dont-splash`, seed 59042, Vancouver, Mount Pleasant, Main Street, rain,
afternoon): northbound in the kerb lane (lane 2 of three each way, 3.5 m, 50 km/h, no parking lane)
along `e708` and `e666`. `lab/puddle-challenge.js` replaces the world's puddles with three: one by
the stop for the 8 and the 19 (46 m along `e708`, 1.3 m out from the kerb, 3 cm deep) where three
people wait at the kerb, one on the next block (40 m along `e666`, 2.0 m out, 5 cm; no room in the
lane) as someone walks up the sidewalk beside it, and a long shallow one further on with nobody
near. The car starts at 11 m/s. Rules and the cautious agent ease about 0.25 m left past the bus stop
at speed, go through the wide one at about 12.5 km/h, drive on through the empty one and arrive;
a car holding 40 km/h splashes three people. Checks: `scripts/test_puddles.mjs` (its
`--write-snapshot` writes the live-model case `data/snapshots/dont_splash.json`).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Puddles are opt-in.** `World` option `puddles` (free drives, unless `?puddles=0`; challenges with `puddles: true`) places puddles in the gutter of every kerb lane from their own random stream, more at junction corners and over catch basins, some reaching into the right wheel path (`sim/puddles.js`, `World.puddles`; a challenge replaces them with `setList`). They have the pothole shape, so the wheel tests in `sim/potholes.js` serve for both. They lie while it rains and, once it has rained (`World.puddlesRained`), until it snows (`puddlesLie`); while they lie a pothole full of water splashes like one, without changing pothole behaviour. `splashRisk` is the one test (who is within splash reach of a puddle, now or by the time a driver gets there), shared by sensing (`puddle_splash`, capping `snap.limit` for one with no room), candidates (`ease_round_puddle`, puddle `slowTo` on every lane law whose wheels would go through one, rejection `splashes_pedestrian`, lifted only when no manoeuvre avoids it), Rules, the cautious agent, the model wording, traffic (`npcPuddle`, `pdShift`), the audit and the renderer's flinch. Drivers ease left inside the lane or slow below `splashSpeed` (25 km/h at 2 cm, by depth) only when someone is within reach; a puddle with nobody near is just water. Grip never changes. The audit's `pedestrians_splashed` reaches the metrics, and fails a drive, only once the car has come up to a puddle with someone near (`World.puddlesSeen`). With it off nothing is placed or computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way. The spray and the flinch are render-only.
