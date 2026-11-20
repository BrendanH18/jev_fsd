# Snowbanks (`sim/snowbanks.js`)

`World` option `snowbanks` is on in free drives unless `?snowbanks=0`, and in the **One car at a
time** challenge (`snowbanks: true`). It builds only when the weather is snow as the World is made
(banks stay if the weather later changes; snow starting mid-drive adds none), from its own random
stream. A bank runs along every kerb of a street with a curb (residential, unclassified, living
street, tertiary, secondary, primary, trunk; not roundabout rings): each edge's right kerb, and a
one-way edge's left kerb too. It sits from 0.4 m out from the kerb face (`BANK_IN_M`) over the curb
to 80% of the way across the boulevard, 0.6–1.1 m high on quiet streets and 0.3–0.6 m on main
streets, lumpy every 2.5 m (`LUMP_M`). At each end of an edge at a junction, a corner pile runs
7–10 m back along the kerb from a cut 2 m past the corner's crosswalk middle (the widest street's
asphalt half plus 1.6 m from the node, as `sim/pedestrians.js` puts the crosswalks): 1.4–1.9 m high
on quiet streets (0.8–1.2 m on main ones), rising toward the corner. Banks are scenery, not
obstacles.

**Narrowings.** `narrowingSites` are the two-way residential blocks with one lane each way and a
parking lane at both kerbs, off transit routes and level crossings and without a marked crosswalk,
where cars park at both kerbs (as `sim/parking.js` places them) for at least 30 m, at least 20 m
from either junction (one per street, on its lower-id edge; Montréal has six, Ottawa about 50). The
stream makes 70% of them narrowings (`NARROW_P`), each a 40–100 m stretch `[a, b]` of the edge
(cum frame) within the site. There the bank fills the kerb side of the parking lane: the cars
parked at either kerb, and the spaces, stand `PUSH_M` (0.6 m) further out (`ParkedCars.move` keeps
the grid in step). A vehicle keeps its centre at most `keepAt` right of the centreline,
`SIDE_CLEAR_M` (0.5 m) clear of them: a car about 0.4 m left of its lane's centre, leaving two cars
coming opposite ways 0.5 m apart, so they could only squeeze past each other. The driven car moves
over through a `detour` (route arc lengths) on every lane law, easing in over 10 m before the
stretch and out over 8 m after it; traffic through `sbShift` (0.6 m/s), aiming where the stretch is
at its pursuit point and judging what is in its way by where it will be (cyclists move over only as
far as clears the parked cars). Everyone keeps to 20 km/h in the stretch (`NARROW_MPS`, slowing
gently toward it), and two that meet in it anyway squeeze past at 1.5 m/s.

**Taking turns.** `Snowbanks.claims(nw)` lists who is coming to or in each narrowing, once a tick:
the driven car along its route (the stretch's ends projected onto it, or by where it is on the
street off its route), traffic along its path (the ends projected onto the path, which rounds the
corners where its lanes join): `{ dir, gap }`, `gap` from the front to where the stretch starts its
way (below 0 once in). `step()` (before the traffic moves) records when each came within 30 m of its
end (`since`), latches one moving off within 8 m of it with its turn come (`go`), and drops the
turn of one that has stood free to go for 8 s (`stall`). `narrowingTurn` is the one test, shared by
sensing, the forward sims, traffic and the audit: a driver goes if it is in, latched, or could not
stop short of the stretch even braking hard; otherwise it waits WAIT_M (2 m) short of it for one
coming the other way that is in it, latched, or could not stop comfortably short of its end, and
then for one within 30 m of its end that got there first (on a tie, by id; not one standing queued
more than 12 m back). The driven car counts only what it can see; when it cannot see to the far end
it comes up to the stretch no faster than it could stop at its end from (`edgeSpeed`, 1.2 m/s at the
wait point). Sensing reports `snowbank.narrowing` (`length_m`, `gap_m`, `inside`, `priority`,
`reason`, `oncoming`, `wait`, `stop_s_route`, `bumper_to_stop_m`, `limit_mps`, `squeeze`,
`sees_through`, `detour`) and caps `snap.limit`; `desiredSpeed` stops at the wait point. The
`wait_for_oncoming_narrowing` candidate stops there; forward sims reject
`enters_narrowing_out_of_turn` for passing it by more than 1 m. Rules stops at the wait point and
prefers the candidate; the cautious agent takes it whenever the car must wait; the deadlock detector
leaves a car waiting there alone. Traffic (`snowbankYield` in `sim/npc.js`) holds at the same point
once it could stop there. Double-parked vans never stop on a narrowing.

**Corners.** A corner pile on a quiet street at least 1.3 m high (`HIDE_H`) is cut into 2 m boxes
in a 25 m grid. `blocksView(from, to)` says whether a line passes through one. `World.sees` hides
from the driven car a person, cyclist, goose or car (not a bus, truck, van, plow, streetcar or
train, nor anything parked) when every line to it (middle, nose and tail) does (`bankHidden`),
whatever `hazards` is. `giveWayAt` treats a pile like a building when looking along the streets it
gives way to, so the car creeps up to its peek point to look. Coming up to the junction at the end
of a quiet street, sensing reports `snowbank.corner` (`side`, `gap_m` to the crosswalk, `limit_mps`)
while a pile hides the crosswalk's end on either side, and caps `snap.limit` to slow gently to 2.5
m/s by 3 m short of the crosswalk (`cornerSpeed`).

The audit (`auditSnowbanks`) counts the driven car's front entering a stretch while one it could see
coming the other way had the way (`oncoming_inside`, `forced_to_stop` or `out_of_turn`), once each
time in, as `snowbank_conflicts`, reported (and failing a drive) only once the car has come within
40 m of a narrowing (`World.snowbanksSeen`). The drive score costs 20 legality points each, with an
incident, a coaching tip and a replay marker. Models get a `snowbank` field (`narrowing`:
`one_car_at_a_time`, `turn`, `oncoming`, `wait`, `wait_in_m`, `slow_to`; `corner_hidden`), situation
clauses, a stop criterion for the motion question and a line in the system prompt. The renderer
(`render/snowbanks.js`) draws every bank as one depth-tested mesh after the ground's markings: white
mounds, highest just kerb-side of their middle, lumpy, grey-brown with grit low on the street side
and icy here and there. The HUD says SNOWBANKS · ONE CAR AT A TIME with whose turn it is, and
SNOWBANK HIDES THE CORNER · CREEP UP AND LOOK.

**One car at a time** (`one-car-at-a-time`, seed 54042, Montréal, Avenue Laval in the Plateau,
falling snow, afternoon): the first site of the street driven the way whose far end has no stop
sign (toward Rue Marie-Anne Est), narrowed for 60 m starting 42 m plus the car's front from its
start (`snowbankSites`; the stream's own narrowings are replaced by it, and cars are parked along
both kerbs of it, pushed out). The car starts from a standstill 42 m short of the stretch. A car
coming the other way is already 8 m into it at 3.5 m/s; in the snow (40 m sight) the car sees it as
it comes up to its end and must wait there a few seconds. Past the stretch the street runs on to the
corner, where someone waiting behind the high pile on the right steps off to cross Avenue Laval,
without seeing the car either, once its front is 26 m short of the crosswalk. The route turns left
onto Rue Marie-Anne Est (Laval runs one way toward the corner beyond) and ends 25 m along it. Rules
arrives in about 75 s and the cautious agent in about 82 s, both waiting at the stretch, creeping up
to the corner and stopping for the person; a driver who keeps going at 3.5 m/s enters with the
oncoming car in the stretch (`snowbank_conflicts`). Checks: `scripts/test_snowbanks.mjs` (its
`--write-snapshot` writes the live-model case `data/snapshots/one_car_at_a_time.json`).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Snowbanks are opt-in.** `World` option `snowbanks` (free drives while it snows at the start, unless `?snowbanks=0`; challenges with `snowbanks: true`) lines the kerbs with banks from its own random stream, higher at the corners, and on two-way residential blocks with parking at both kerbs (`narrowingSites`) makes narrowings: the cars parked there (and their slots) stand `PUSH_M` out, everyone moves over toward the middle (`keepAt`; the ego through a `detour`, traffic through `sbShift`), and drivers take turns through the one-car stretch (`sim/snowbanks.js`). `narrowingTurn` is the one test, shared by sensing (`snowbank`), candidates (`wait_for_oncoming_narrowing`, rejection `enters_narrowing_out_of_turn`), traffic (`snowbankYield`) and the audit: whoever is in the stretch, committed (others judge comfortably, a driver itself braking hard) or latched has the way, then whoever came within `ZONE_M` of its end first; a stalled one loses its turn. A route starting or ending inside a narrowing must retain both ends beyond its truncated polyline, and spawning or resetting there uses the narrowed corridor. A pull-out waiting at the kerb has no claim; it checks `canPullOut` before joining the corridor. A latched approach still yields to a newly visible vehicle inside while it can stop. Traffic leader clearance uses the combined narrowing offset, including any move already made round a pothole. High corner piles hide people, cyclists and cars (not tall vehicles or anything parked) from the driven car through `World.sees` (`bankHidden`) and the side street from a car giving way (`blocksView` in `giveWayAt`), independent of `hazards`. The audit's `snowbank_conflicts` (going in while one it could see coming the other way had the way) reaches the metrics, and fails a drive, only once the car has come up to a narrowing (`World.snowbanksSeen`). With it off nothing is built or computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way. Its glue to the core is the registry record `sim/features/snowbanks.js` ([feature interface](../feature-interface.md)), never the core files: besides sensing, candidates, the forward-sim check, wording, prompt line, hold-still clause, audit and metric, it has hooks for the car's move toward the middle (`detour`), what the banks hide (`hides`, `blocksView`), putting the car down in a narrowing (`placeEgo`), the emergency pull-over's stop and the audit's usable right edge (`evStop`, `pullOverDetour`, `evKerb`), traffic's line, hold and ceiling (`trafficLane` at `"parkers"`, with `lineAt` and `kept` for what is in its way) and a parked car's wait to pull out (`trafficPullOut`).
