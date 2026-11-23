# Road closures (`sim/road-closures.js`)

A whole block closed for an event, and the detour round it. `World` option `roadClosures` is on in
free drives unless `?roadclosures=0`, and in the **Road closed** challenge (`roadClosures: true`).
With it off `World.roadClosures` is a disabled `RoadClosures` with no random stream and an empty list,
and nothing reads it. In a free drive, from 25 s in (`CLOSURE_FIRST_S`), every 3 s while none stands
and 90 s after the last came down, the blocks of the route whose near junction lies 120–450 m ahead
(`AHEAD_MIN_M`, `AHEAD_MAX_M`), at least two edges on and at least 40 m long, are candidates: never a
roundabout ring, the drive's first edge or the destination's (either way), an edge on a transit run,
or a contraflow street. With one, a draw (chance 0.35, the feature's own stream, seeded
`seed * 2654435761 + 60042`) closes one of them, but only if the browser router still finds a way to
the destination avoiding it from the start of the street before it (turning off at that street's end), no board is in the car's sight, and no driver who keeps to a way of its
own (bus, streetcar, school bus, plow, garbage truck, train) has it on its way. It comes down once it
has stood 60 s and the car is 200 m from it with neither direction on its route.

`buildClosure` closes the block both ways (the edge and its reverse; one way on a one-way street).
At each end a barricade line crosses the whole asphalt, `PAST_KERB_M` (4.5 m) beyond the widest
cross street's asphalt (past its crosswalk), at least 5 m into the block and at most 30% of it, made
of boards up to 2.6 m wide and 0.5 m deep (`Barricade`, `kind: "barricade"`, static, in
`world.obstaclesNear`, so the forward sims treat one like scenery and hitting one is a collision at
the car's fault). Traffic on the block or committed to it (within 15 m of it with no other way) is
moved, from the feature's stream, to a lane at least 150 m from the car (`relocate`).

`closureAhead(world, way, front, look)` is the one test: the first barricade line across a closed
block along a way (`routeWay(route)` or `pathWay(path)`) that a front bumper has not passed, within
150 m. The car learns of a closure (`RoadClosures.known`) only once it sees a board
(`visibility.sees`: range, darkness, buildings), in the audit. Sensing then reports `road_closed`
(`street`, `distance_m`, `on_route`, `detour_planned`, and on the route `line_s_route`,
`stop_s_route`, `bumper_to_stop_m`): with no detour yet, the car stops at the stop line of the
approach before the block, or `HOLD_BACK_M` short of the cross street's asphalt, or, having run up
to 3 m past that (`OVERRUN_M`), where it is, or else 3 m short of the barricade; `desiredSpeed`
caps the target to stop there braking at 1.8 m/s² (`STOP_DECEL`). Once the route avoids it, the
nearest known barricade ahead within 90 m is reported with `detour_planned`. Candidates:
`stop_for_closure` (planned at `STOP_DECEL`); any manoeuvre but `hard_brake` whose front reaches
half a metre short of the barricade line is rejected `enters_closed_road` (checked before a
collision). Rules prefers `stop_for_closure` (−30) and stops within 1.5 m of the stop; the cautious
agent takes it and aims for zero within 12 m. The autopilot re-plans (`Autopilot.reroute`, at most
every 3 s) with `avoid: world.roadClosures.avoid()`, the edges of every closure the car has seen, on
every reroute while any is known; with no server (Node) the request falls back to `browserRoute`
with the same `avoid`. A lockstep evaluation waits for that request (`autopilot.detourRouting`), so
the detour comes at the same step every run. Models get `road_closed`, a situation clause, a motion
criterion and a system prompt line.

Routing: `jev/routing.py` `Router.routes(..., avoid=)` and `astar(..., avoid=)` never enter an
avoided edge (the start edge is where the car is) and drop avoided goal lanes; `/api/route` takes
`avoid`, a list of up to 200 edge ids. An empty or missing list gives exactly the routes as before.
`demo/routing.js` `browserRoute` takes `avoid` the same way. Mind both copies of the lane-join logic
and the sharp-turn rule: the detour's polyline is joined like any route.

Traffic: with the option on every driver's path carries `closures` (the World's state, so
checkpoints keep them together), and `NpcPath.extend` never appends a closed edge. `avoidClosure`
re-plans a way that runs through a closed block from the street the driver is on while it is more
than 12 m from its end; `closureHold` holds anyone still headed into one 2 m short of the barricade.

The audit (`auditRoadClosures`) learns what the car sees and watches its front against each
barricade line: crossing from outside to inside, within the street's width, counts as
`closure_entries` (event `closure_entry`). It reaches the metrics and fails a drive only once the
car has come up to a closure (`World.roadClosuresSeen`: seen, or crossed). The drive score costs 20
safety and 25 legality points each, with an incident, a tip and a replay marker; while a seen
closure is ahead the coach says to follow the detour. The road-test examiner files it under
observation. `render/road-closures.js` draws striped Type III barricades with flashing amber lamps,
ROAD CLOSED and DETOUR signs, kerb cones and festival tents on the block (render-only); the HUD says
ROAD CLOSED AHEAD · DETOUR. With the option off nothing is computed, no random number is drawn, and
the seeded benchmark and the other challenges play out and report exactly as before.

**Road closed** (`road-closed`, seed 60042, Halifax, dry afternoon): Spring Garden Road (two-way,
one lane each way) is closed between Queen Street and Birmingham Street (`e277`/`e278`). The car
starts at rest 20 m along `e489`, a block and a half before it, on a route down the closed block and
onto Birmingham Street (`e218`, 60 m along `e172`). It sees the barricade from about 80 m, after
about 9 s, re-plans, and turns onto Queen Street at its signal, then Clyde Street
(stop) back to Birmingham Street. Rules and the cautious agent arrive in about 58 and 60 s with no
entries, collisions or deadlocks. Checks: `scripts/test_road_closures.mjs` (its `--write-snapshot`
writes the live-model case `data/snapshots/road_closed.json`), `tests/test_routing.py` and
`tests/test_maps.py` for `avoid`.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Road closures are opt-in.** `World` option `roadClosures` (free drives, unless `?roadclosures=0`; challenges with `roadClosures: true`) now and then, from its own random stream, closes a whole block (both directions between two junctions) on the driven car's route ahead, out of its sight, with barricades across both ends (`sim/road-closures.js`, `World.roadClosures`); never the car's block, the drive's first or last, one on a transit run or a fixed-route vehicle's way, or one that leaves no route. Barricades are static obstacles in `world.obstaclesNear`. The car learns of one only once it sees a barricade (`RoadClosures.known`), then re-plans with `avoid` (the closed edges it knows), which `/api/route` (`jev/routing.py`) and `browserRoute` (`demo/routing.js`, also Node's fallback when there is no server) honour; an empty or missing `avoid` must leave every route exactly as before. Until a detour comes it stops short of the junction before the block. `closureAhead` is the one test, shared by sensing (`road_closed`), candidates (`stop_for_closure`, rejection `enters_closed_road`), Rules, the cautious agent, the model wording, traffic (`NpcPath.extend` never appends a closed edge; `avoidClosure`, `closureHold`) and the coach. A lockstep evaluation awaits `autopilot.detourRouting`; checkpoints drop it, and keep the closures and the re-planned route. The audit's `closure_entries` (the car's front crossing a barricade line onto the block) reaches the metrics, and fails a drive, only once the car has come up to a closure (`World.roadClosuresSeen`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
