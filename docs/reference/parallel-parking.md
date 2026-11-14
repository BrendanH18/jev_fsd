# Parallel parking at the destination

Parallel parking at the destination (`static/js/sim/parallel-park.js`, BC Motor Vehicle Act s. 189(1) and
s. 190(1)): in a free drive (`World` option `park`; `?park=0` turns it off) the autopilot looks for a space
in the parking lane on its right once the destination is within 150 m. A space is a stretch of the right
kerb that is legal (not in a junction or on its crosswalk, which sits 1.6 m past the widest street's
asphalt; not within 6 m of the approach side of a crosswalk, including a junction's, or of a stop line;
not in a bus stop zone; no parking on a street a level crossing is on; fire hydrants are not on the map),
straight, empty of anything standing still that reaches 0.2 m into the parking lane and of bays another
driver has reserved, on a route edge whose route lane is the curb lane, ending before the destination
and starting within 60 m of it, and long enough to reverse into in one go (`planSpace`): the car starts
alongside the car in front, its rear bumper level with that car's, 0.6 m out from the parking lane's line
(at most 0.6 m right of its lane's centre); its last arc swings its outer front corner round a point a
turning radius left of its rear axle, which must keep 0.4 m from the car in front's inner rear corner, and
its rear bumper must end 0.4 m clear of whatever is behind the space. For the compact that is 6.6 m bumper
to bumper, the sedan 7.0 m and the pickup 8.2 m. The car must see the middle and both ends of the space,
and be within 70 m of where it would park in it; it takes the one nearest the destination it can
still stop for at 2 m/s^2, reserves its bays, and gives it up if it could no longer stop there even at
3.5 m/s^2, if anything stands in it, or after 30 s standing where it starts without starting back. With
no space left that it could still stop for, it stops in its lane at the destination as before (the
`arrived` event says `parked: false`). It signals right from 40 m short of where it stops, slows at no more
than 1.2 m/s^2, and stops there (`wait_to_park`). Traffic and cyclists coming up behind it on its path,
from 30 m short of there until it is parked, treat the car as a leader that is the S's length plus 1.5 m
longer, so they stop back from the room it reverses into; a driver that has stopped inside that room and
is what the car waits for backs up out of it after 2 s (up to 7 m). The car waits there while anything
(not parked) is inside that room behind it, in the lane or the space, or is moving toward it from up to
15 m behind or 4 s away. Then it parks (`park`, a law of `kind: "park"`, World.parking): straight to
where the S starts if it stopped short of it or past it, full lock toward the kerb up to the angle
`solveS` gives (`in1`), straight back (`back`) until full lock the other way will bring it parallel at
the kerb (`in2`), then straight forward or back to its spot (`settle`): 0.9 m behind the car in front
where the space allows, its body 15 cm off the kerb. Legs go at 0.15 to 0.8 m/s, slowing for their end
at 0.6 m/s^2, and the car stops and turns the wheel to within 3 deg of its target before each one. A leg
ends early 0.4 m short of anything standing still, before a tyre would touch the kerb (a bumper may reach
0.25 m over it), or after 9 m; then the next leg squares the car up, gaining on the kerb where it can, or
moves it toward the kerb in another S, and after 12 legs it gives up (`stuck`, arriving with `parked:
false`, `stuck: true`). Parked within 2.5 deg of parallel and 8 cm of its lateral goal, it arrives
(`parked: true`, `kerb_m`, the right tyres' distance from the kerb, `angle_deg` and `within_kerb`, wheels
within 30 cm and within 4 deg of parallel). The space then stays the car's (World.parkedIn) until it has
moved 10 m away, and the next drive starts by pulling out of it (`pull_out`, the same law in `mode:
"out"`): straight back to where the S ended (`out_back`), signal left and wait (`out_wait`) until nothing
is coming up the lane beside it within 25 m or 6 s, or standing beside it, then full lock out (`out1`),
straight (`out2`) and full lock back (`out3`) until parallel in the lane, when the lane law takes over
(`done`). The safety brake lets the car come within 0.3 m of what it parks beside, ignores traffic going
the other way in its own lane while the car stands at an angle (the prediction still checks it), and
looks behind it on reversing legs. The car's sensing reports `parking` (the space and its length, where it
stops to reverse in and how far right it pulls up there, `wait_for`, and once under way the leg). Rules
gets `wait_to_park`, `park` and `pull_out` candidates, and rejects lane manoeuvres that would drive on more
than 1 m past where it stops while still moving (`passes_parking_space`); `stop_at_destination` is not
offered while there is a space, and arriving at the route's end does not stop the car before it parks.
Decision models and LLMs get `parking`, a situation line, a motion criterion (parking is driving, and the
destination is reached only once parked) and a prompt line. The audit counts a tyre more than 2 cm past the
asphalt's edge while the car parks or pulls out as a kerb strike (`kerb_strike`, once a contact), and the
coaching score reports `parking` (`parked`, with how far from the kerb and how square, `stopped in lane`
or `stuck partway in`) with the kerb strikes and tips, only for drives that park. The HUD says "PARKING
SPACE AHEAD · SIGNAL RIGHT · PULL UP ALONGSIDE THE CAR IN FRONT", "PARKING · CHECKING BEHIND · WAIT", "·
CLEAR BEHIND · REVERSE IN", "· REVERSING IN", "PULLING OUT · TRAFFIC COMING · WAIT", "· SIGNAL LEFT ·
CLEAR", "PULLING OUT", then "PARKED", "ARRIVED · STOPPED IN LANE" or "ARRIVED · STUCK PARTWAY IN". The seeded benchmark and the other
challenges never park.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Parking is opt-in.** `World` option `park` (free drives, unless `?park=0`; challenges with `park: true`) makes the autopilot parallel park at the destination and pull out again at the start of the next drive (`sim/parallel-park.js`, `World.park`/`parking`/`parkedIn`). The seeded benchmark and the other challenges never park, so every parking branch must leave the `parkAtGoal` false path exactly as it was. Traffic keeps back from a car parking ahead of it through `World.parkHold` (`sim/npc.js`).
