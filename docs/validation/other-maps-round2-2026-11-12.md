# The other maps, second round, 12 November 2026 (ROADMAP 1.8)

Starting tree: `dcfc663`. Final tree: `f5ffd31` plus the review fixes below. Node 22.23.4, Rules, lockstep, 40 traffic cars,
`scripts/bench_node.mjs --diagnostics 1`, one server for every job. No live model calls, no new
dependencies. Per-job results: [the JSON beside this note](other-maps-round2-2026-11-12.json).

## How the work was done

The open 1.8 failures were reproduced on `dcfc663`, then fixed in parallel on five branches, one per
group, each in its own worktree with its own server. Each branch passed its own jobs, Kitsilano city
dry and the bare suite alone:

| Branch | Fixed | Record |
|---|---|---|
| Victoria seed 2 and Kitsilano seed 3 | a pull-over scored from the wrong lane, a dead-end U-turn placed past the route's turn, a car behind the route's start counted alongside | [victoria-s2](victoria-s2-2026-11-12.md) |
| Review follow-ups | parked cars' jittered footprints, the bus-lane turn-in latch, a detour counted twice | [review-followups](review-followups-2026-11-12.md) |
| Calgary seed 2 | the restriction audit at a slip lane's end, a school bus committed to a corner it could not clear, pull-overs across lanes with too little room | [calgary-s2](calgary-s2-2026-11-12.md) |
| Toronto seed 2 | traffic turning from a lane it could not leave, a pull-over into a kerb space a pull-out still stood in, emergency vehicles and balls, a close-pass audit measured between bodies | [toronto-s2](toronto-s2-2026-11-12.md) |
| Kitsilano night | a traffic circle's joining traffic, a stop sign 48 m short of its junction, the parker hold-line creep in the emergency audit | [night](night-2026-11-12.md) |

Merged together they failed 12 routes that passed on `dcfc663`: every branch changes which traffic the
car meets, and the new meetings found older faults. A second round of three branches, from the merged
tree, fixed them:

| Branch | Fixed | Record |
|---|---|---|
| Emergency yields | a car stopped at its line treated as inside the junction, junction positions from summed edge lengths, the audit's line stop and queue re-capture, an oncoming vehicle predicted straight while still turning | [merged-emergency](merged-emergency-2026-11-12.md) |
| Pull-outs | an ambulance and a child waiting on each other, an angled car backing off into the car, a parker stuck at an angle, a plow stopped on a residential street | [merged-pullouts](merged-pullouts-2026-11-12.md) |
| Other stuck routes | waits at a narrow contraflow street's mouth, people held by a car that only grazes their path, a parking manoeuvre given up after one overshoot | [merged-stuck](merged-stuck-2026-11-12.md) |

Every fix has a focused Node check that fails without it.

A review of the merged code (GPT-6.1 Sol) found two faults, fixed with a check each: an oncoming
emergency vehicle was left out of the forward sims entirely, so one standing in the car's lane ahead was
not in the way (its body now stays where it is; only its straight-on forecast is dropped,
`test_emergency_line_stop.mjs`); and traffic counted a one-lane block before a short two-lane link as
room to change lanes for a turn (`test_npc_turn_lane.mjs`).

The PR's review bots found three more, each fixed with a check that fails without it: people walked
through the body of a car waiting at the kerb to pull out (it is walked round now, like any vehicle
standing just short of their way; `test_pedestrian_round.mjs`); a school bus avoiding a corner took the
first other way without checking it, so it could stall at a second blocked corner
(`test_school_bus_corner.mjs`); and the parking shuffle check read a list that does not exist, so its
"never touches a parked car" could not fail (`test_parking_shuffle.mjs`). Four smaller suggestions
(re-sorting turns after a U-turn moves, a rounding tolerance on the lanes a pull-over can cross, the
stuck timeout during a parker's blocked retries, and rolling the bus's corner check all the way to a
far corner) were tried together and broke Kitsilano city dry `s1-12` (a failure to yield on Balsam
Street) through the traffic they changed, so they were left out and are follow-ups.

## Results

All 41 jobs (172 routes) on the final tree: **166/172**, from 160/172 after the first round's merge
(166/172 before the review fixes too, with Victoria seed 2 `s2-1` failing instead of parking `s1-10`).
Only snow `s1-4` changed with the bots' fixes, failing as before.
"Start" is `dcfc663`, where it was run.

| Job | Start | Final |
|---|---|---|
| Kitsilano city dry | 12/12 | 12/12 |
| Kitsilano city fog | 12/12 | 12/12 |
| Kitsilano city rain | 12/12 | **11/12** (`s1-12`, new) |
| Kitsilano city snow | 12/12 | **11/12** (`s1-4`, new) |
| Other eleven maps, city dry, two routes each | 22/22 | **20/22** (Edmonton `s1-2`, Winnipeg `s1-1`, new) |
| Kitsilano bare | 12/12 | 12/12 |
| Toronto seed 2 | 0/2 | 2/2 |
| Calgary seed 2 | 0/2 | 2/2 |
| Victoria seed 2 | 0/2 | 2/2 |
| Kitsilano seed 3 | 2/2, 3 deadlock recoveries | 2/2, none |
| Kitsilano, Toronto, Calgary, Victoria seeds 2–3 otherwise | not run | 8/8 |
| Kitsilano 23:30 dry | 11/12 | 12/12 |
| Kitsilano 06:30 dry | 11/12 | **11/12** (`s1-4`, a different route) |
| Kitsilano 23:30 fog | 11/12 | 12/12 |
| Kitsilano parking | 12/12 | **11/12** (`s1-10`, new: not parked, Stephens Street) |
| Cover rows 0–12 | row 4 2/2 | 26/26 |

Every original 1.8 failure is fixed. Six routes fail, five of which passed at the start. They are
left open (ROADMAP 1.8):

- Kitsilano rain `s1-12`: a brake check at 149.3 s on Vine Street. A car closing from behind at a
  0.92 s headway is predicted to keep its speed, so every way of stopping for the sign ahead is
  rejected as a rear-end collision and the car falls back to a hard brake.
- Kitsilano snow `s1-4`: failures to yield to an emergency vehicle at 350.5 s (Balsam Street) and
  673.3 s (Arbutus Street).
- Edmonton `s1-2`: timeout on 81 Avenue NW.
- Winnipeg `s1-1`: failure to yield to an emergency vehicle at 85.3 s on Martha Street.
- Kitsilano 06:30 `s1-4`: failure to yield at 115.3 s on Vine Street.
- Kitsilano parking `s1-10`: arrives at 218.6 s on Stephens Street but does not park.

The weekly blocking city matrix (`.github/workflows/bench.yml`) runs Kitsilano rain and snow, so it
fails until the first two are fixed; city dry on every change passes.

## Bare suite

12/12. Ten routes change against `20261111-130222-rules`, so `20261112-190000-rules` replaces it:
traffic no longer turns from a lane it cannot leave (Toronto branch), and the car gives way at a
junction past a stop sign set 30 m or more short of it (night branch). `s1-2` takes 142.8 s instead
of 89.8 s, catching two red lights on West Broadway it used to make on green. Decisions 5,173 to
5,240, average speed 23.77 to 23.26 km/h, safety brakes 7 and 7, RMS jerk 2.97 to 3.15.

## Checks

All `scripts/test_*.mjs` pass under Node 22.23.4, run one at a time; `build_jev_fixtures.mjs --check`
reports 0 stale fixtures; 272 Python tests pass. The stub model recording was rewritten by the
Toronto branch for its traffic change and replays exactly on the final tree.
