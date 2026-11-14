# Spring potholes (`sim/potholes.js`)

`World` option `potholes` is on in free drives unless `?potholes=0`, and in the **Pothole season**
challenge (`potholes: true`). With it off `World.potholes` is an empty, disabled `Potholes`: no
random stream is created or drawn from, sensing adds no `pothole` field, no law gets a `slowTo`,
traffic adds no `phShift`, the audit does not run and no metric key is added.

**Placement.** `new Potholes(map, { enabled, seed })` walks every lane of every edge (not
roundabout rings, nor lanes under 40 m) from its own stream (`rng(seed * 2654435761 + 97)`): a
pothole on average every 70 m of lane on a main street (tertiary and up) and every 260 m on a
quiet one (residential, unclassified, living street), none on service roads, none within 12 m of a
lane's ends and none within 25 m of the last on the same lane. The Plateau gets about 270, 9.8 per
lane-km of main street and 3.6 of quiet street. Sizes: 60% small (0.4–0.7 m wide, 4–7 cm deep),
30% medium (0.7–1.1 m, 6–10 cm), 10% wide (1.2–1.7 m, 8–13 cm); 70% lie in a wheel path, the rest
anywhere across the lane, always inside it. Each record is `{ id, edge, lane, s, offset, a, b,
depth, shape, x, y, heading, lane_w }`, an ellipse `a` long and `b` wide (half-axes), `offset`
right of the lane's centre. `setList` replaces them (a challenge places its own) and rebuilds the
20 m grid (`near`) and the per-lane lists (`onLane`). Placement is all the world's potholes, so
traffic everywhere meets them; the recorder shares the object between checkpoints, as it never
changes once placed.

**Room.** `wheelRoom(dl, h, laneW, spec)` is the smallest move from the lane's centre (to the
nearest centimetre) that keeps both wheel paths (at ± `track / 2`) clear of the pothole by its
half-width plus a tyre's half-width (0.1 m) and a 0.15 m margin, without the body coming within
0.05 m of either lane line; ties go to the move that puts the hole between the wheels, and null
means there is none. In a 3.5 m lane a compact may move 0.81 m either way; a hole up to about
1.1 m wide in a wheel path can be got round, a wide one across the middle cannot.

**Speed.** `safeSpeed(h)` is 20 km/h for a 7 cm hole, scaled by `sqrt(0.07 / depth)` within
15–30 km/h (the blow at the far edge grows with speed squared and depth). The driven car plans to
cross at 95% of that, times the weather's speed factor (`planSpeed`), and slows at 60% of
`comfort().decel` to reach it 6 m before its front wheels get there (`slowCap`). Traffic plans at
90%, at 40% of `comfort().decel`, also 6 m early (its drivers ease off rather than follow a curve).

**Sensing and candidates.** Sensing sees potholes in the car's lane 70 m ahead, or 50 m in rain or
snow (a pothole full of water is a puddle like any other), within the visibility range.
`potholesAhead` projects the route's potholes (cached per route) into the frame of the car's lane:
`pothole` is the next, `potholes_ahead` all in sight, each with `room`, `shift_m`, `lateral_m`,
`speed_mps`, the `slow` window in route arc length of the rear axle and, with room, the `detour`
to ease round it (`controller.detourAt`): over `easeLength` (twice the street's limit in metres,
12–30 m) before the front wheels reach it, back after the rear wheels and the pursuit point are
past. Room is withdrawn when the car is too close to make the move. Every pothole without room
caps `snap.limit` (`potholeLimit`) and the target speed names it. The candidates add
`ease_round_pothole` (the detour, at the target speed) when there is room and no other detour is
under way; every lane law whose lateral target at a pothole (`lateralAt`) would put a wheel in it
gets a `slowTo` entry, which `applyLaw` honours like `stopAt`, so keeping the middle of the lane
slows for it. Forward sims sweep each tyre between steps (`crossesPothole`) over the potholes
ahead of the front wheels and reject `hits_pothole_too_fast` above the safe speed plus 0.5 m/s
(`hard_brake` excepted). Rules gives easing round a small bonus; the cautious agent takes it when
its end speed is near the target. Models get a `pothole` field, a situation clause, outcome labels
for `ease_round_pothole` and for laws that slow over one, and a line in the system prompt.

**Traffic.** `npcPothole` reads the potholes on the lanes of an NPC's path within 80 m: the first
it has room for sets an in-lane shift once its front wheels are 35 m short (eased at 0.6 m/s,
`phShift`, not while changing lanes, going round a work zone, lane closure, van or cyclist, or
pulling out), and every one without room caps its desired speed. Cyclists and streetcars do
neither.

**Audit.** `auditPotholes` counts a tyre going into a pothole more than 5 km/h over its safe speed
as `pothole_hits`, once a pothole a pass, with a `pothole_hit` event (km/h, safe km/h, depth).
`World.potholesSeen` is set once a pothole is within 30 m ahead of the car's front, in or beside
its lane; only then do the metrics report `pothole_hits`, which fails a drive ("hit a pothole too
fast"). The drive score costs 10 comfort points each, with an incident, a coaching tip and a
replay marker.

**Rendering.** `render/potholes.js` draws every pothole as two coplanar ground fans: a ragged rim
of lighter, crumbled asphalt on `LAYER.patch` (above the asphalt, below the markings) and the dark
hole just above it; both are seeded by the pothole's `shape`. In rain or snow the hole is a water
surface (`wetReflective`, gloss 1.6) close to the wet road's colour. `potholeJolt` heaves and
pitches a car's mesh for a few tenths of a second as a tyre drops in (render only). The HUD says
POTHOLE · EASE 0.6 M RIGHT IN THE LANE, POTHOLE · BETWEEN THE WHEELS, or POTHOLE AHEAD · NO ROOM ·
SLOW TO 19 KM/H, and AI eyes lists the next one.

**Pothole season** (`pothole-season`, seed 51042, Montréal, Rue Saint-Denis, rain): the block from
Avenue Duluth Est toward Rue Rachel Est (`e212`, 176 m, one lane each way, 3.5 m, 40 km/h, no
control along it). `lab/challenges/pothole-season.js` replaces the world's potholes with four in the car's
lane: 0.75 m right at 50 m (0.6 m wide, 6 cm), 0.6 m left at 90 m (0.6 m, 7 cm), a wide one across
the middle at 128 m (1.6 m, 10 cm; the hazard) and a small one in the middle at 152 m. Rules and the
cautious agent ease 0.55 m right and 0.4 m left round the first two, cross the wide one at about
14 km/h and arrive; a car holding 34 km/h hits three. Checks: `scripts/test_potholes.mjs` (its
`--write-snapshot` writes the live-model case `data/snapshots/pothole_season.json`).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Spring potholes are opt-in.** `World` option `potholes` (free drives, unless `?potholes=0`; challenges with `potholes: true`) places potholes on the map's lanes from their own random stream, many more on main streets than quiet ones, each inside its lane (`sim/potholes.js`, `World.potholes`; a challenge replaces them with `setList`). Drivers ease round one inside their lane where `wheelRoom` finds a move that clears both wheel paths without crossing a lane line (`ease_round_pothole`, a `detour`; traffic's `phShift`), and otherwise slow to `safeSpeed` (20 km/h for 7 cm, by depth, times the weather) by `comfort()` braking: sensing (`pothole`, capping `snap.limit`), every lane law whose wheels would cross one (`slowTo`, honoured by `applyLaw`), traffic (`npcPothole`) and the forward sims' rejection (`hits_pothole_too_fast`) share these rules. In rain or snow they hold water and are seen later. The audit's `pothole_hits` (a tyre in one more than 5 km/h over its safe speed) reaches the metrics, and fails a drive, only once the car has come near one (`World.potholesSeen`). With it off nothing is placed or computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way. `potholeJolt` is render-only.
