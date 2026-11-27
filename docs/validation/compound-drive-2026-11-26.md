# The compound drive — 2026-11-26 (ROADMAP 9.3)

## Admission on 27 November

At the Vine Street amber, the tailgater instructions now give a safe stop at the light priority
over letting the driver behind pass. The saved request has 2,354 question characters. In one live
call, `jev-1.14.0` selected `stop_at_line` at 96% and `ease_off_for_tailgater` received 3%. The call
used 2,772 input tokens, took 259 ms and cost $0.000116. Drive Lab lists **Rush hour on West 4th**
under **Compound drives**. Model evidence is limited to the saved decision.

## Initial validation on 26 November

**Result.** "Rush hour on West 4th" (`rush-hour`) is one drive of about 830 m through five
existing situations on West 4th Avenue in Kitsilano. The latitude script of 4.1 samples 167 of
Rules' decisions on it. At 3 of them a manoeuvre other than the emergency brake, which the safety
filter leaves on offer, leads to a failure within six seconds; at 7 more only the emergency brake
does. Over the sixty challenges the same script found 4 such decisions in 3,042. Rules and the
cautious agent both pass the drive on both tracks, so it does not yet separate the two built-in
drivers: what it adds is room for a driver to be wrong.

The one live model check found more than the built-in drivers did: at the amber with the tailgater
behind, Jev chose to ease off for the tailgater where a stop was expected (admission check 5, below).
The drive is built and measured but not yet admitted.

Measured on Boat, Node 22.23.5, on the tree this record was committed with (base `7209939a`).

## The design, and why

| Decision | Choice | Why |
|---|---|---|
| Challenge, road test or something else | A module in `lab/challenges/` listed apart, in `COMPOUND_DRIVES` | Suite `v1` pins the arena's `all` set by id: 60 challenges and two road tests. A 61st challenge or a third road test would label every later `--set all` run `custom`, in the middle of the repeated runs of 7.5. Listed apart, `CHALLENGES`, `ROAD_TESTS`, `--set all`, suite `v1`, every published row, `data/results.json` and the 60-challenge storage figure are untouched. `arena_node.mjs --set compound` runs it, labelled `custom`. |
| A suite `v2` now | No | A new numbered suite switches the Node writers and splits every comparison at the version. That is the owner's call, once the drive has model results. Nothing here stands in its way: add `data/suites/v2.json` beside `v1`. |
| Road-test machinery (examiner, parking, 56 ambient actors) | Not used | The examiner only adds remarks, and ambient traffic makes the situations a matter of chance. Every actor here is authored, so each driver meets the same five situations. |
| Map and street | Kitsilano, West 4th Avenue east from before Vine Street, left up Maple Street | Four of the sixty challenges are already on this street (the two amber lessons, "Pulling out", "Make room"), the signals are a block apart, and it has a bus stop, a signalled left across oncoming traffic and a two-way stop within 830 m. |
| Situations, in order | A tailgater closes up; the Vine Street light turns amber with the tailgater behind; a bus signals to pull out past Yew Street; an unprotected left at Maple Street across two oncoming cars; Maple's stop sign at West 3rd Avenue with through traffic | The order the street brings them. 4.1 found latitude in the amber lessons and in the tailgater lesson (emergency brake only). Putting the two together is where the ordinary latitude is: with a driver on its bumper the car may brake only gently, so braking early for a green that then turns amber leaves it too slow to clear and too close to stop. |
| Weather | Dry | In snow the same drive runs at 6.6 m/s, the amber falls 80 m from the line and the script found no decision with room to fail (200 points, 0). |

The drive turns on three existing World options (`tailgaters`, `amberLights`,
`followingDistance`) through `setupChallenge`'s own flags, sets the clock so the unchanged signal
plan turns the Vine Street light amber seven seconds after the start, and places its actors with
parts existing challenges use.

## What was tried first

1. **The tailgater kept behind as far as the bus.** Rules failed with
   `braked hard with a tailgater close behind`, and the cautious agent with that and a red light.
   The brake check was not a choice. When the signalling bus becomes the vehicle ahead
   (`snap.following`), `followingPolicy` (`sim/following.js`) asks for the leader's speed minus up to
   2 m/s whenever the gap is under its target. The leader is standing, and a tailgater doubles the
   target gap (`TAIL_ROOM`), to 87 m at 13.4 m/s with the bus 50 m ahead. The speed target fell
   from 13.9 to 0.4 m/s in one decision, every lane law took it as its ceiling, and the car braked
   at up to 6.5 m/s² with 45 m of room, which the tailgater audit counts as a brake check. A
   driver forced to 10.4 m/s beforehand failed the same way. **This looks like a defect in shared
   sensing, and it is reported here, not fixed**: the fix is in a core file, and it would change
   existing results. The drive avoids it: the tailgater turns right down Vine Street, so nothing
   stands ahead of the car while it is tailgated. The same collapse can be expected wherever a
   tailgated car comes up on standing traffic.
2. **The amber eight seconds in.** Rules was 30 m from the line and went on; the cautious agent
   had eased off before the amber and entered on red. The script found no ordinary manoeuvre that
   failed (11 points, all the emergency brake), because that failure needs a wrong choice held
   longer than the three seconds it forces. Seven seconds puts Rules 42 m from the line with a
   stopping distance of 40 m, where three seconds of a wrong choice is enough.
3. **Snow.** See the table above.

## The six admission checks

1. **What it teaches that no challenge does.** A decision made for one situation sets the terms of
   the next: with a tailgater behind, the car must decide once at the amber, because braking early
   for the green takes away both the stop and the clear.
2. **Feature interface, no core file.** No file under `static/js/sim/`, `static/js/brain/`,
   `static/js/bench/` or `static/js/map/` changed, and no World option was added. Changed outside the
   new module: the registry (`lab/challenges.js`), one `export` in `lab/challenges/bus-pulling-out.js`
   (`placeBus`), and scripts.
3. **`bare` and every existing challenge identical.** Before (clean `7209939a`) and after, in the
   same sandbox: `bench_node.mjs --map kitsilano --seed 1` (12 routes), and
   `arena_node.mjs --brain rules --set all` (62 drives, 62 passed, `suite_version: "v1"` both
   times). Every field of both reports compared, wall-clock and latency fields aside: the arena
   report is identical, and the bare report differs only in the run's `name` and `saved_at`.
4. **`city` still passes.** `bench_node.mjs --map kitsilano --seed 1 --features city`: 12 of 12
   before and after, identical apart from `name` and `saved_at`.
5. **One saved model case.** `data/snapshots/rush_hour.json`, written by
   `scripts/test_compound_drive.mjs --write-snapshot` from the production pipeline: the decision at
   the Vine Street amber, 42.2 m from the line at 12.5 m/s, with the tailgater 7.8 m behind
   (`brake_no_harder_than_mps2: 3`). Motion is answered locally; the vector question expects
   `stop_at_line`. `verify_jev.py --offline` reports it valid; its question instructions are 2,351
   characters (ceiling 4,000) and the whole request 6,155 characters, about 1,540 tokens at four
   characters a token (ceiling 5,500 input tokens).
   **Checked live, and Jev disagrees.** One call on `jev-1.14.0` (26 November, in its own
   `jev-fsd-live` sandbox, the owner's approval for this one case): 2,777 input tokens, 241 ms,
   $0.000117, inside the ceiling. Jev chose `ease_off_for_tailgater` (67%) over `stop_at_line` (30%)
   and `keep_lane_target` (3%). The instructions carry two clauses that pull apart when an amber and
   a tailgater coincide: the amber clause says "stop before the line and wait for green", and the
   tailgater clause says "ease off a little, gently (`ease_off_for_tailgater`, where it is offered)".
   Jev takes wording literally and followed the second. No existing challenge puts the two together,
   so this is the first thing the compound drive found about a model. The wording is unchanged here:
   a change needs its own fixtures and another live check. Until then the case fails a live
   `verify_jev.py` run, check 5 is not met, and the drive stays outside the library and every suite
   (ROADMAP 9.3).
   `uv run scripts/verify_jev.py data/snapshots/rush_hour.json`
6. **Arena storage.** Two saved runs with Rules and the cautious agent: about 275,100 bytes, 2.9% of the
   9 MB fallback cap, outside the 60-challenge run, which is unchanged
   (`scripts/test_drive_lab.mjs`: 7,386,758 bytes, 78.3%).

## Latitude

```sh
node --experimental-default-type=module scripts/driver_latitude.mjs --port 8404 --only rush-hour
node --experimental-default-type=module scripts/driver_latitude.mjs --port 8404 --only rush-hour --track open
node --experimental-default-type=module scripts/driver_latitude.mjs --port 8404 --only rush-hour --force 6 --horizon 9
```

| Run | Points | Room to fail | Other than the emergency brake |
|---|---|---|---|
| Guarded, a choice forced for 3 s, judged over 6 s (the 4.1 settings) | 167 | 10 | 3 |
| Open track, same settings | 167 | 10 | 3 |
| Guarded, forced for 6 s, judged over 9 s | 167 | 10 | 6 |
| For comparison, same day: `road-test-kitsilano` (1.7 km, ambient traffic) | 255 | 0 | 0 |
| For comparison: the sixty challenges (14 November) | 3,042 | 28 | 4 |

The null branch repeats the drive exactly in all three runs. All ten points are in the first ten
seconds, while the tailgater is behind:

| Time | Manoeuvre | Failure |
|---|---|---|
| 28.1 s | `right_1_hold` | braked hard with a tailgater close behind |
| 30.1 s | `stop_at_line` | red light |
| 30.1 s | `right_1_hold` | braked hard with a tailgater close behind |
| 31.1 s | `right_1_target` | braked hard with a tailgater close behind |
| 24.1 to 33.1 s, every point | `hard_brake` | braked hard with a tailgater close behind, six times with a collision |

`stop_at_line` at 30.1 s is the failure the drive was built round, and
`scripts/test_compound_drive.mjs` pins it: a driver who takes it from 6 to 9 s into the drive and
drives as Rules otherwise enters on red. The two `right_1_*` manoeuvres move a metre to the right
in the lane; why that ends in a brake check was not traced, so those two points may be the
following-distance defect above under another manoeuvre and not a judgment. Counted strictly, the
drive has **one** traced decision where an ordinary manoeuvre fails for a reason a driver can
judge, and two more the script counts.

Nothing after the tailgater leaves has room to fail: the bus, the left turn and the stop sign are
decided by the filter, as in their single challenges. The open track shows the same counts because
the script forces only what Rules is offered and Rules is offered the same list there.

The script gained three things for this: `--only` accepts a road test or a compound drive,
`--track open`, and an `ordinary_room_to_fail` count. Where the Rules drive itself fails it also
branches with nothing forced, so a failure Rules reaches anyway is not counted against the forced
choice (`rules_fails`, `avoidable`). Its counts for a passing drive are computed as before.

Per-point records: [compound-drive-2026-11-26.json](compound-drive-2026-11-26.json).

## Drivers

`arena_node.mjs --set compound`, one run each, lockstep:

| Driver | Track | Verdict | Time | Decisions | Flagged choices | Score |
|---|---|---|---|---|---|---|
| Rules | guarded | pass | 166.8 s | 577 | n/a | 67.3 (pace 35.8, comfort 66.2, margin 100) |
| Rules | open | pass | 166.8 s | 577 | 0 | 67.3 |
| Cautious agent | guarded | pass | 170.3 s | 591 | n/a | 59.0 (pace 35.1, comfort 41.8, margin 100) |
| Cautious agent | open | pass | 170.3 s | 591 | 0 | 59.0 |

Open-track drives match the guarded ones in every field but the track's own, as
`scripts/test_compound_drive.mjs` checks. No model has driven it.

## Limits

- One traced point of latitude is thin. The drive is a place where a driver can be wrong, not
  proof that it separates drivers; that needs model runs (7.5). It is not admitted until the saved
  case passes a live check (admission check 5).
- The cautious agent's red light in the eight-second variant shows the failure is reachable by a
  plausible policy, but that variant is not the one committed.
- The drive's timing rests on traffic paths: the tailgater's turn at Vine Street, the oncoming
  cars at Maple Street and West 3rd Avenue's through traffic. A change to lane joins or NPC paths
  can move its results, and its check pins them.
- At this point, the drive opened by link. The Drive Lab listing was added at admission.
