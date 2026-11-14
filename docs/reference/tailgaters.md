# Tailgaters (`sim/tailgaters.js`)

The first hazard behind the car rather than ahead of it. `World` option `tailgaters` is on in free
drives unless `?tailgaters=0`, and in the **On your bumper** challenge (`tailgaters: true`). From
20 s into a drive, every 2 s while none is active and 60 s after the last, the ordinary traffic car
(not a cyclist, bus, school bus, train, plow, truck at work, emergency vehicle, car pulling out or
parking, red-light runner, or car passing a cyclist) nearest behind the driven car in its lane,
within 50 m, both going at 6 m/s or more, becomes a tailgater with chance 0.3 (`TAIL_CHANCE`; a draw
only when there is such a car, from the feature's own stream). It stays an `NpcFleet` car on the
shared car model; `commitTailgater` layers a tailgating driver on it: IDM time gap 0.3 s
(`TAIL_T`, swinging ±20% over 7 s: edging in and out), standstill gap 1.2 m, a wish to go at 1.2 times
the limit (`TAIL_HURRY`, which is also its speed cap while it tailgates; following-distance traffic
policy does not apply to it), and the driven car's speed and brake lights seen 0.4 s late
(`TAIL_REACT_S`; the IDM sees that speed, and `tailgateBrake` judges how hard the car brakes over
0.2 s). Once it sees braking it brakes 1.0 m/s² harder than it sees, or as hard as stopping 1.2 m
behind the car needs if the car brakes on like that to a stop, up to the hardest the road allows
(6 m/s² dry). At 13 m/s it settles about 6–8 m back, 0.5–0.6 s. Every 11 s it drifts 0.5 m left
in its lane for 2.5 s, to look past the car; every 9 s it double-flashes its headlights
(`tailgaterFlash`, drawn by `render/tailgaters.js`, render-only); from the leftmost lane it never
changes lanes, so it never cuts by on the right (it may pass on the left from another lane). It
gives up once its rear is past the car's front, after 6 s not behind it in its lane, or after
120 s, and drives on as its own driver at up to 1.1 times the limit. So a car that brakes early and
gently is followed down to a stop (from 12 m/s braking at 2.5 m/s² it stops about 3 m behind);
braking at 7 m/s² from 13 m/s is a rear-end, which the collision audit puts on the follower
(`fault: "other"`).

`tailgaterThreat` is the one test: a vehicle behind the observer within 30 m, within 1.4 m of its
line and heading within 30° of it, going at 3 m/s or more, whose front bumper is less than 0.8 s
(`TAIL_THREAT_S`) of its own speed behind the observer's rear bumper. Ordinary traffic, with time
gaps from 0.8 s up and a standstill gap on top, settles outside it. `brakingNeed` is what the
situation ahead requires (m/s², and why): closing on whatever is in the car's path within 80 m (a
vehicle, parked car or door within the two half-widths plus 0.3 m of its line, a person or goose
within 1.8 m of its side: `(v − its speed along)²` over twice the gap less 2 m (1 m to a person),
or, while it brakes, the car's stopping distance against its own), a red light, an amber it can stop for (`sim/amber.js`
stopping distance) or a stop sign not yet stopped at, at the line, the route's bends at comfortable
cornering, and the destination.

Sensing reports `tailgater` (`id`, `gap_m`, `headway_s`, `speed`, `closing_mps`, `flashing`,
`need_mps2` and `need_for` from `brakingNeed`, `gentle_mps2` = max(3.0, need + 1.0), `room_factor`,
`lane_right`, and `can_move_right` once the lane options are known), from the vehicles it can see.
Tailgated, the car's following policy (`sim/following.js`, `followingPolicy(…, { scale: 2 })`, with
or without the `followingDistance` option) leaves twice the usual gap to the vehicle ahead, which
`desiredSpeed` and the `following_distance` rejection then hold it to. Candidates: on a street with
another lane going the car's way on the right, clear (`gap_ok`), with room for two lane changes and
not near a junction, the right side is offered as `let_pass`, the candidate `let_tailgater_pass`
(over to the right at the car's speed, never faster); with no lane to move into and a target speed
of 8 m/s or more near the limit, `ease_off_for_tailgater` (1.4 m/s below the target speed, gently);
and `stop_at_line` starts earlier, braking at 2.0 m/s² (`TAIL_STOP_DECEL`) instead of the
comfortable 2.5. The forward sims leave the tailgater out of their constant-velocity collision
prediction (it brakes too), and reject `brakes_hard_with_tailgater` for any manoeuvre but
`hard_brake` whose prediction brakes harder than `gentle_mps2`, or than the gentlest manoeuvre that
passes every other check plus 0.5 m/s², so that the gentlest is always kept. Rules prefers
`let_tailgater_pass` (−8) and `ease_off_for_tailgater` (−5); the cautious agent takes
`let_tailgater_pass` when it can move right (it already keeps below the limit). Models get a
`tailgater` field (`behind_m`, `headway_s`, `brake_no_harder_than_mps2`, `ahead_requires_mps2`,
`gap_ahead: "twice the usual"`, `move_right_to_let_it_pass` or `lane_to_the_right`), a situation
clause and a line in the system prompt. The HUD says TAILGATER · MOVE RIGHT AND LET THEM BY, or
TAILGATER · LEAVE MORE ROOM AHEAD (from `tailgaterThreat` when driving by hand); AI eyes draws the
tailgater amber and the Lab panel lists it (a rear proximity line: gap and headway behind).

The audit (`auditTailgaters`) follows each braking harder than 4.0 m/s² (`BRAKE_CHECK_DECEL`) from
3 m/s or more until it eases below 1.5 m/s²: once it has lasted 0.25 s, with a tailgater (the one
test) behind at any point of it, braking more than 2.5 m/s² above the most `brakingNeed` asked
during it is a brake check, counted once a braking as `brake_checks` (event `brake_check`, with the
tailgater, the braking, the need and why). It reaches the metrics and fails a drive only once a
tailgater has closed within the threat headway of the car (`World.tailgatersSeen`). The drive score
costs 20 safety points each, with an incident, a coaching tip and a replay marker, and while one is
close behind the coach says to leave more room ahead, brake early and gently and let them by. With
the option off nothing is computed, no random number is drawn, and the seeded benchmark and the
other challenges play out and report exactly as before.

**On your bumper** (`on-your-bumper`, seed 56042, Winnipeg, William Avenue in the Exchange District,
dry afternoon): `e481`, eastbound, straight for 504 m, two lanes each way, 50 km/h, up to its signal
at Isabel Street (`sig16`, its plan unchanged). The car sets off at 11 m/s in the left lane, 40 m
along, on a route in that lane on along William Avenue (`e343`) 60 m past the junction; a dark car in
a hurry starts 12 m behind it at the same speed and tailgates it from the start (it closes within
0.8 s about 6 s in). The right lane is empty. The car's light turns amber 28 s after the start, about
60 m short of the line at the limit. Rules and the cautious agent move into the right lane about 6
and 3 s in, the tailgater goes by on the left, and they stop gently at the red and go on at the
green. A driver who stays in the left lane and brakes hard is rear-ended (`brake_checks`, and the
collision is the tailgater's). Checks: `scripts/test_tailgaters.mjs` (its `--write-snapshot` writes
the live-model case `data/snapshots/on_your_bumper.json`).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Tailgaters are opt-in.** `World` option `tailgaters` (free drives, unless `?tailgaters=0`; challenges with `tailgaters: true`) now and then, from its own random stream, makes the ordinary traffic car nearest behind the driven car in its lane a tailgater (`sim/tailgaters.js`, `World.tailgaters`): an `NpcFleet` car with a tailgating driver layered on (`n.tailgate`: a 0.3 s IDM gap, up to 1.2 times the limit, the car's speed and brake lights seen `TAIL_REACT_S` late, then braking harder than it sees, `tailgateBrake`), never cutting by on the right. A brake check can rear-end it; the collision is the follower's. `tailgaterThreat` is the one test, shared by sensing (`tailgater`, which doubles the following policy's gap: `followingPolicy(…, { scale: 2 })`), candidates (`let_tailgater_pass`, `ease_off_for_tailgater`, a gentler `stop_at_line`, the rejection `brakes_hard_with_tailgater`; the forward sims leave the tailgater out of their collision prediction), Rules, the cautious agent, the model wording, the coach and the audit; `brakingNeed` defines what the situation ahead requires from the shared tests. The audit's `brake_checks` reaches the metrics, and fails a drive, only once a tailgater has followed the car (`World.tailgatersSeen`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way. The headlight flash is render-only.
