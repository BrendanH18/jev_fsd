# A ball, then a child (`sim/ball-chase.js`)

`World` option `balls` is on in free drives unless `?balls=0`, and in the **Chasing the ball**
challenge (`balls: true`). It is independent of `hazards`, which free drives also turn on. One ball
at a time, 20–60 s into a drive and 60–150 s after the last (retrying every 5 s), by day
(`visibility.night < 0.5`) and not in snow, `BallChase.spawn` looks along the residential (or living)
street the car is on for a gap of 0.9–3.5 m between two cars parked parallel at either kerb,
50–110 m ahead of its front and on its route; the ball waits there, 0.6 m in from the cars' traffic
side, until the car's front is 26–42 m short of the gap's line (`frontToGap`), then rolls out (all
from its own random stream). A ball that waits more than 60 s, or that the car has passed, goes.

The ball (radius 0.11 m) leaves the gap across the street at 3–4.5 m/s, with up to 0.5 m/s along
it. Rolling resistance slows it at 0.35 m/s²; at the asphalt's edge, or a parked car's side, it
bounces back keeping 45% of its speed that way (and 85% overall), and it comes to rest below
0.05 m/s. It is not an obstacle: nothing steers round or stops for the ball itself, and a vehicle
whose body passes over it squashes it flat (`burst`) where it is. 1–2 s after it rolls out, a child
(`kid_ball_<ball id>`, a `Pedestrian` with `child`, `dart` and `ballChase` set) comes out of the same
gap at 2.3–2.7 m/s (2.6–3.1 m/s crossing), without looking, on a crossing from the gap to beyond the
far kerb through the ball (so `crosswalkConflict` sees it for everyone), following the ball. Within
0.45 m of it they pick it up (0.8 s), then walk back to the gap at 1.5 m/s, looking, and on to the
sidewalk and home; the ball goes with them. The child is one of the crowd: in `obstaclesNear`,
hit as any pedestrian, drawn as any child.

Who has seen what is kept per ball: `seenBy` (driver id, or `"ego"`, to the time it first saw the
ball: `ballVisible`, in its line of sight and, with hazards on, not behind a parked car,
`ballHidden`) and `childSeenBy` (the driven car by `World.sees`, so parked cars hide the child with
hazards on; traffic by line of sight). For a driver that has seen the ball, the warning stands
(`warningStands`) from 0.3 s after it until the child it has seen is back at the kerb (or gone), or
8 s pass with no child seen (40 s at most). While it stands, `ballCover` gives the cover speed for
the gap's line ahead along the driver's line (`gapCrossing`, a segment across the street through
the gap): `coverSpeed(d)`, the speed from which, reacting within 0.75 s and braking at
`comfort().decel`, it stops 2 m short of the line, never below 1.5 m/s (on a dry road about 43 km/h
40 m out, 28 km/h at 20 m and 17 km/h at 10 m; in rain 35, 23 and 14). Sensing reports `ball_in_road` (`gap_m`, `stop_s_route`, `side`,
`ball`, `child`: `not_seen`/`in_road`/`clear`, `child_id`, `warning`, `limit_mps`,
`cover_left_s`) and caps `snap.limit`; `desiredSpeed` names it. The `slow_for_ball` candidate
aims at the cover speed for where the car will be at the end of the prediction; forward sims reject
`passes_ball_gap_too_fast` for crossing the gap's line faster than 1 m/s over the crawl while the
warning stands. Rules prefers `slow_for_ball` unless someone is crossing ahead; the cautious agent
takes it whenever it is eligible and no one is. Models get a `ball_in_road` field, a situation
clause saying when `slow_for_ball` is correct, and a line in the system prompt. Traffic
(`ballYield`) caps its speed at the cover speed for where it will be in a second (its IDM eases
off gently above a ceiling).

The audit (`auditBalls`) watches each ball the car has seen: from 1 s after it saw it, while the
warning stands and the gap's line is ahead, the car may go no faster than the higher of the cover
speed and the speed it would be down to braking at `comfort().decel` from then, by more than
1 m/s. Having gone faster, passing the gap's line with the warning still standing counts once per
ball as `ball_warnings_ignored`, reported (and failing a drive) only once a ball has rolled out
within 60 m of the car (`World.ballsSeen`). The drive score costs 25 safety points each, with an
incident, a coaching tip and a replay marker. The renderer (`render/ball-chase.js`) draws the
ball panelled in its colour and white, turning as it rolls, resting on the asphalt and
depth-tested; flattened once burst; and in front of the child who carries it. The HUD says BALL IN
THE ROAD · A CHILD MAY FOLLOW (with the cover speed), then CHILD CHASING THE BALL · STOP; AI eyes
outlines the child.

**Chasing the ball** (`chasing-the-ball`, seed 52042, Kitsilano, West 7th Avenue, dry afternoon,
hidden hazards on): the first block of the street that is a straight, two-way residential street
with one lane each way, a parking lane on the right, a limit of 40 km/h or more, no marked
crosswalk, school or playground zone or speed hump, and room to park all along (`ballSites`). Cars
line the right kerb 1.4 m apart from 55 m before the gap's line to 30 m past it, the gap itself
2.2 m, and the far kerb too. The car starts from a standstill 120 m short of the line; the ball
(red, 3.6 m/s, 0.25 m/s drift) rolls out in plain view once its front is 28 m short, and the
child follows 1.2 s later. Rules (at the blind-spot speed, 9 m/s, as it rolls out) slows, stops
about 2 m short for the child and goes on once they are back at the kerb; the cautious agent slows
enough that the child is across before it gets there. A driver who keeps to 50 km/h passes the gap
too fast (`ball_warnings_ignored`) and hits the child. Checks: `scripts/test_ball_chase.mjs` (its
`--write-snapshot` writes the live-model case `data/snapshots/chasing_the_ball.json`).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).
The core hooks live in `sim/features/balls.js` ([feature interface](../feature-interface.md)).

- **Balls rolling into the street are opt-in.** `World` option `balls` (free drives, unless `?balls=0`; challenges with `balls: true`) now and then, from its own random stream, by day and not in snow, rolls a ball out from a gap between cars parked at the kerb of a residential street on the car's way, and a child (`kid_ball_<ball id>`, a pedestrian with `child` and `ballChase` set, so in `world.obstaclesNear`) runs out after it from the same gap 1–2 s later, fetches it and goes home (`sim/ball-chase.js`, `World.balls`). The ball is not an obstacle; a vehicle that runs over it squashes it flat. It is independent of `hazards`: with hazards on, `World.sees` lets the parked cars hide the child (and `ballHidden` the ball while it is still between them); the ball out in the road is always in plain view. Everyone who sees the ball keeps to the cover speed (`coverSpeed`, from `comfort().decel`: stopping short of the gap's line, never below a crawl) until the child has come and gone back to the kerb, or 8 s pass with no child; `ballCover` is the one test, shared by sensing (`ball_in_road`, capping `snap.limit`), candidates (`slow_for_ball`, rejection `passes_ball_gap_too_fast`), traffic (`ballYield`) and the audit. The audit's `ball_warnings_ignored` reaches the metrics, and fails a drive, only once a ball has rolled out near the car (`World.ballsSeen`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
