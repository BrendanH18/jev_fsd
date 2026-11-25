# Lane closures and the zipper merge

Lane closures and the zipper merge (`static/js/sim/lane-closure.js`, `render/lane-closure.js`): a road
crew closes the curb lane of a straight block with two lanes going its way (one-way, or two each way),
with no flagger: orange cones angle across the closed lane over the 30 m taper from the merge point, line
it past the work and angle back after it, the crew's truck stands at the start of the work with its amber
light bar and an arrow board flashing left, two workers stand past it, a "right lane closed ahead" sign
stands 80 m before the merge point and a "take turns at merge" sign at it. The closed stretch (24 m, the
closed lane and any parking lane beside it) is a parked obstacle. Manitoba's driver's handbook (Manitoba
Public Insurance) teaches the zipper merge and the City of Winnipeg signs it at lane closures; Ontario
cities (Windsor, Brantford, Greater Sudbury) and police ask for it too, and the Alberta Motor Association
says merging late is right: use both lanes up to the merge point, then take turns, one vehicle from each
lane. So nobody changes lanes into or out of the closed lane from 80 m short of the merge point, and
everyone keeps to 30 km/h (never above the street's limit) from 5 m short of it to the end. Within 25 m
of the merge point, the vehicle in the closed lane nearest it is at the merge (further back a driver
drives on up its lane). It is the closed lane's turn when the last vehicle through the merge point came
from the open lane, or nobody in the open lane is coming within 40 m of it, and the open lane's otherwise.
On the closed lane's turn the one at the merge is let in once nobody in the open lane is beside it or just
ahead of where it joins, and whoever comes up behind it in the open lane can drop back to its speed short
of it braking at 2.5 m/s^2 with a 1.5 m plus 0.6 s headway (the driven car, closing on it at more than
2 m/s, 2 s more back: it has to be seen to let it in); until then it waits at the merge point if it can
stop there braking at 3.5 m/s^2. The first in the open lane lets it in, stopping 7 m short of the merge
point and 1.5 m behind its rear, if it can braking at 2.5 m/s^2 (one too close goes on through first),
and keeps behind it until it is across. A vehicle at the merge that stands still 6 s on its turn, let in
or stuck short of the merge point, loses the turn to the open lane until the next vehicle goes through.
The closed lane's traffic, cyclists and the driven car included, moves across into the open lane over the
taper and back into its own past the work. The driven car's sensing reports `lane_closure`: its lane
(`side`, the lane it came from past the merge point), the merge point, whether it is at the merge, whose
turn it is, whether it has been let in (`let_in`), whether it waits (`wait`, with `wait_for` the open
lane's vehicle that goes first) and, in the open lane, whom it lets in (`let_in_for`, only for the first in
that lane). In the closed lane every lane candidate carries the way across (a `detour`, as at a work zone);
`wait_to_merge` stops a metre short of the merge point and `let_merge_in` half a metre short of where it
lets someone in, and candidates that go through the merge point while the car waits (`merges_out_of_turn`)
or past where it lets someone in (`takes_merge_turn`), change lanes out of the closed lane short of the
merge point (`merges_early`) or into it (`into_closed_lane`) are rejected. Decision models and LLMs get
`lane_closure`, a situation line, a motion criterion and a prompt line. The audit counts going through the
merge point from the closed lane without being let in, once the car owed its wait there (at the merge, it
could stop braking at 3.5 m/s^2), as `merge_cut_ins`, which the metrics report and fail a drive on once a
closure has stood in it (`merged out of turn`); merging into the open lane more than 5 m short of the merge
point, and, first in the open lane and owing it, going 2 m past where it would let someone in at more than
1 m/s, are events for coaching. Coaching counts cut-ins, turns taken (`merge_turns_taken`) and early merges
(`early_merges`), with tips, for drives a closure stood in, and the closure's 30 km/h as a work zone's. The
HUD says "RIGHT LANE CLOSED AHEAD · STAY IN LANE TO THE MERGE · TAKE TURNS", "WAIT YOUR TURN · LET THE NEXT
CAR GO FIRST", "YOUR TURN · MERGE NOW", "LANE ENDS BESIDE YOU · LET ONE CAR IN · TAKE TURNS" or "RIGHT LANE
CLOSED AHEAD · TAKE TURNS AT THE MERGE", and AI eyes outline the closure, and the car it waits for or lets
in, in amber. In a free drive one closure at a time stands 150 to 450 m from the car, out of its sight,
for 4 to 8 minutes, on blocks with no marked crosswalk, bus or streetcar route or level crossing, its merge
point at least 40 m along the block and its end 20 m short of the junction (`?closures=0` takes them off).
Brantford allows an early merge in light traffic where it slows nobody; here everyone keeps its lane to
the merge point. Emergency vehicles are not routed round closures. The seeded benchmark and the other
challenges have none.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Lane closures are opt-in.** `World` option `closures` (free drives, unless `?closures=0`) puts up a lane closure with a zipper merge from its own random stream (`sim/lane-closure.js`); the "Take turns" challenge places one itself. The audit's `merge_cut_ins` reaches the metrics, and fails a drive, only once a closure has stood in it (`World.closuresSeen`), so the seeded benchmark and the other challenges report exactly as before; keep it that way. The driven car has no `id`: closures know it as `EGO_ID` ("ego").

The [lane-closure feature record](../../static/js/sim/features/lane-closure.js) installs and steps
the closure manager and supplies the approach restriction, zipper stop, traffic detour and audit.
The same record provides the model instructions, coaching and HUD notice.
