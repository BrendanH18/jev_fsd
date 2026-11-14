# Black ice (`sim/black-ice.js`)

`World` option `ice` is on in free drives unless `?ice=0`, and in the **Bridges freeze first**
challenge (`ice: true`). With it off `World.ice` is an empty, disabled `BlackIce` whose constructor
only sets `ROAD.gripAt = null`: no random stream is created or drawn from, sensing adds no
`black_ice`, `black_ice_ahead`, `ice_caution` or `ice_limit_mps` field, no law gets an ice `slowTo`,
traffic computes nothing, the audit does not run and no metric key is added. Every `World` built
without ice clears the hook, so a world built after one with ice steps as before.

**The grip hook.** `ROAD` in `sim/vehicle.js` has a `gripAt` beside `mu`: null, or a function
`(x, y, spec)` giving the friction coefficient under a tyre there (null where it is `ROAD.mu`). Where
it is set, the dynamic model takes each axle's grip from it (the front axle `wheelbase` ahead of the
rear one), so `axleMu` and the friction circles of each axle follow the surface under it (braking on
ice with the rear axle on it and the front off it unloads the rear onto ice: it steps out); the
kinematic model below 3 m/s takes the slipperier axle's. Where it is null both axles get `ROAD.mu`
through the same expressions as before, with no extra arithmetic: the branch is taken once per
substep. `comfort()` still derives from the global `ROAD.mu`. `BlackIce` installs the hook while
it is enabled (and again each step, `refresh`, in case another world was built since); it returns
a patch's `mu` for road vehicles and null for streetcars and trains (`spec.kind`), which run on
steel. Because the driven car, every NPC and cyclist (BIKE), and every candidate's forward sim step
the one car model, all of them slide on the ice alike.

**Conditions.** `iceConditions(weather, clock)` favours ice in snow at any hour; in fog before 11:00
or from 18:00 (freezing fog); in rain before 9:00 or from 20:00; on a dry road before 9:00 or from
22:00 (frost after a clear night). Those three need the clock's `day` of the year in the cold
season (`isColdSeason`: 1 November to 31 March); a clock without a `day` (free drives, which keep
the sky's late-September sun) and no clock at all (the benchmark) favour ice only in snow. The
`World` keeps the clock's `day` with ice on, as it does with sun glare. `refresh` runs at the
start of every `stepWorld`: while conditions favour ice every placed patch lies on the road (`list`),
otherwise none, so changing the weather or the time mid-drive brings it or takes it away. A
challenge's `setList` fixes its own patches whatever the conditions.

**Placement.** From its own stream (`rng(seed * 2654435761 + 233)`), once: on each bridge span of
the map's `bridges` layer (one per two-way street, both directions sharing it), with chance 0.8, a
patch 25–70 m long somewhere along it; and, on streets (not service roads or roundabout rings) with
a stretch at least 20 m long in the shade of a building 20 m or taller (one whose footprint lies to
the south, within 50° of due south, within 2.5 times its height and 90 m: the low winter sun), with
chance 0.2, a patch 10–30 m long in it, none within 8 m of a street's ends. Each patch covers the
roadway kerb to kerb (the edge's `asphalt`) over its stretch (`patchOn`: `{ id, kind, name, edge,
from, to, mu, lo, hi, pts, cum, len, box, shape }`), with grip 0.10–0.15. A 25 m grid finds them
(`at`), and `onEdge` lists them by edge, the two-way twin included, for traffic. Saskatoon at seed 3
gets 4 patches on bridges and about 20 in the shade of downtown's towers. The recorder shares the
object between checkpoints.

**Speeds.** `safeSpeed(p)` is the speed from which the car could still stop within 40 m on the ice
braking at 70% of its grip: about 28 km/h on a glaze of 0.11, 29 km/h on 0.12. The driven car plans
to cross at 95% of that (`planSpeed`), reached 4 m before its front wheels get there at 60% of
`comfort().decel` (the `slowTo` curve of `sim/potholes.js`), and no faster round a bend on the ice
than keeps its sideways acceleration within 40% of the ice's grip (`bendSpeed`, from
`Route.curveSpeedAt`); on the ice it only eases toward it, 0.3 m/s a decision (`easeToward`), never
braking. Slower than that speed when the ice comes into sight, it speeds up no further than it, and
only by `easeToward` once its slowing window has begun, so it never reaches the ice still
accelerating. In icy conditions it keeps to 40 km/h across a
bridge (`CAUTION_MPS`), from its start to its end, slowing for it like a lower limit; spans of one
bridge less than 50 m apart along the route are one. Traffic does the same through `npcIce` (90% of
the safe speed, 40% of `comfort().decel`, 6 m early, looking 70 m ahead; locals know the bridge), no
faster round a bend on the ice than `bendSpeed` allows along its own path, and, short of an emergency
stop (braking harder than its driver's comfortable `b`), with its pedals and wheel through `gentleOnIce`
as the driven car's. On the ice `gentleOnIce` also keeps the wheel from asking more than 60% of the ice's
sideways grip (`STEER_LAT_SHARE`), so a lane change across a patch is taken wider.

**Sensing and candidates.** `iceSensing` finds where the route's line is on a patch (cached per
route and placement) and reports `black_ice` (the next patch seen), `black_ice_ahead` (all seen:
`starts_in_m`, `ends_in_m`, `length_m`, `mu`, `safe_mps`, `speed_mps`, `on_ice`, the `slow` window
in route arc length of the rear axle) and `ice_caution` (`kind`, `text`, the next bridge within
120 m, `{ name, starts_in_m, ends_in_m, on }`, and its `slow` window). A patch is seen 20 m ahead
by day and 40 m at night (`visibility.night` over 0.5), within the sight range. `iceLimit` caps
`snap.limit` with both, divided by the weather's speed factor so that the target speed is the ice's
own (`snap.ice_limit_mps`), and the target speed names it. Every lane law gets an ice `slowTo` entry
for each patch seen; `slow_for_ice` holds the target with each one 10 m earlier. Forward sims reject
`crosses_ice_too_fast` going onto a seen patch (one the car is not already on) more than 0.5 m/s
over its safe speed, and `brakes_on_ice` braking or accelerating harder than 60% of a patch's grip
(after the actuator's lag, 0.4 s) or slipping past 0.2 on one, above 2.5 m/s (`hard_brake`
excepted, the last resort). Rules gives `slow_for_ice` a bonus when a patch is seen; the cautious
agent takes it unless following a car. Models get `black_ice` and `ice_caution` fields, a situation
clause, outcome labels and a line in the system prompt.

**Gentle on the ice.** With black ice seen, every lane law is marked `ice`, and `applyLaw`
(`sim/controller.js`) passes its pedal and wheel through `gentleOnIce`: while an axle is on a patch the
pedals are held to 50% of the ice's grip either way (`GENTLE_SHARE`, under the forward sims' 60% and
the audit's 75%) and the wheel turns no faster than 0.15 rad/s (`ICE_STEER_RATE`: a quick turn of the
wheel slides the front tyres past their sliding angle, about 2° on ice, before the car can yaw);
from 0.6 s of travel before the front wheels reach it only speeding up is held back, for the pedals'
lag. The forward sims run the same law, so what they predict is what the car can do. Lane laws that
stop plan the stop at 70% of that (`iceStopDecel`), and `iceLimit` caps the speed wherever the way to a
stop lies over seen ice, so the car can stop as gently: short of the car ahead (4 m short of where
that car would stop, braking as hard as the road under it lets it), of the line ahead, of the
destination, and of where it stops to reverse into a parking space. A stop it could not make even at
the audit's 75% has been left too late, and is left to the rest of the planner. `hard_brake`, and the
shared emergency brake, are never eased: an emergency on the ice stays one.

**Audit.** `auditIce` counts, once a patch a crossing, the car going onto it more than 10 km/h over
its safe speed (`fast`), or, above 2.5 m/s on it, braking or accelerating harder than 75% of its
grip (`brake`, `accelerate`) or slipping past 0.2 (`skid`), as `ice_overspeed`, with an
`ice_overspeed` event. `World.iceSeen` is set once a patch is under the car or within 40 m ahead of
its front; only then do the metrics report `ice_overspeed`, which fails a drive ("crossed black ice
too fast, or braked or steered hard on it"). The drive score costs 20 safety points each, with an
incident, a coaching tip and a replay marker. Slides that end in a collision are already
collisions.

**Rendering.** `render/black-ice.js` (`IceView`) draws every patch on the road as one coplanar ground
strip on `LAYER.patch` (above the asphalt; it is transparent, so drawn after the opaque markings,
which show through it), a dark, near-mirror glaze (roughness 0.04) whose vertex alpha feathers out
over 1.6 m at its sides and its ragged ends and thins in streaks, so that it shows mostly as a sheen
where it catches the headlights or a low sun. It is hidden while no patch lies on the road and
rebuilt when the patches change. The HUD says BRIDGES FREEZE FIRST · 40 KM/H, BLACK ICE AHEAD · EASE
OFF TO 27 KM/H BEFORE IT and ON BLACK ICE · HOLD 27 KM/H · NO BRAKING OR SHARP STEERING, and AI eyes
lists the patch or the bridge.

**Bridges freeze first** (`bridges-freeze-first`, seed 55042, Saskatoon, Traffic Bridge, dry, dawn):
northbound from Nutana over the South Saskatchewan River: `e577` (the south approach), `e579`, the
deck `e572` (226 m, one lane each way, 50 km/h, on the bridges layer) and `e475` (3rd Avenue South)
to 9 m along it, short of the roundabout at Spadina Crescent. `lab/challenges/bridges-freeze-first.js` puts one
patch on the deck from 125 m to 212 m (grip 0.11), a local driver 30 m ahead of the car, both moving
at 11 m/s, and a car waiting at the roundabout's yield line (on `e473`) until the driven car has
stood still for 2 s or 45 s have passed. Rules and the cautious agent keep well back of the car
ahead, go onto the ice at about 20 km/h (safe 28 km/h), cross without braking and arrive; a car
holding 50 km/h goes onto it too fast.
Checks: `scripts/test_black_ice.mjs` (its `--write-snapshot` writes the live-model case
`data/snapshots/bridges_freeze_first.json`) and `tests/test_bridges.py`.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Black ice is opt-in, and is the one place grip varies.** `World` option `ice` (free drives, unless `?ice=0`; challenges with `ice: true`) places patches, from their own random stream, on the bridges layer's spans and on stretches shaded by tall buildings (`sim/black-ice.js`, `World.ice`), lying on the road only while `iceConditions` holds (snow; and fog, rain or a dry frosty night late at night and early in the morning, by `world.clock.hour`, only with a cold-season `world.clock.day`, which free drives' clock never has; refreshed each step) or a challenge placed them (`setList`). The car model reads local grip only through `ROAD.gripAt` (`sim/vehicle.js`: per axle in the dynamic model, the slipperier axle in the kinematic one), so the driven car, traffic, cyclists and every forward sim feel the ice alike; streetcars and trains do not. Every `World` sets the hook, null without ice, and with it null vehicle stepping must stay bit for bit as before: branch on it, never multiply by 1. `comfort()` stays global. With ice seen, lane laws are marked `ice` and `applyLaw` passes the pedals and wheel through `gentleOnIce` (and so do the forward sims); `hard_brake` and the shared emergency brake are never eased. Sensing (`black_ice` once seen, 20 m by day, 40 m at night; `ice_caution`, 40 km/h across a bridge), candidates (`slow_for_ice`, ice `slowTo` on every lane law, rejections `crosses_ice_too_fast` and `brakes_on_ice`), Rules, the cautious agent, traffic (`npcIce`) and the audit share `safeSpeed`, `easeToward` and `iceLimit`: slow on the dry road before it, only ease off on it. The audit's `ice_overspeed` reaches the metrics, and fails a drive, only once the car has come near a patch (`World.iceSeen`). With it off nothing is placed or computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way. `render/black-ice.js` is render-only.
