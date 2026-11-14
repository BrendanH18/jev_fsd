# Passing cyclists with room

Passing cyclists with room (`static/js/sim/cyclist-pass.js`, `World` option `passCyclists`: on in free
drives unless `?cyclistpass=0`, and in the "Give them room" challenge). On a two-way street with one lane
each way, a cyclist riding in the travel lane leaves no room to pass within it, so going by means moving
into the oncoming lane. BC's minimum passing distance regulation (Motor Vehicle Act, 2024) asks for 1 m
where the limit is 50 km/h or less and 1.5 m above, as Québec's Highway Safety Code (s. 341) does, and
Ontario's Highway Traffic Act (s. 148(6.1)) asks for 1 m; every province's handbook adds that a driver
crosses the centre line to pass only when the oncoming lane is clear for long enough, and not approaching
a junction, a crosswalk or a level crossing. The pass (`planPass`, along the cyclist's street, the
driver's front) aims the driver's side the minimum passing distance plus 0.25 m from the cyclist's, which
on a 3.2 m lane puts the car's centre about on the centre line (never past the far side of the oncoming
lane: `no_room`). It eases over across 2.5 s of travel at the pass speed (at least 12 m) to be across by
`full`, where the driver's front is 2 m short of the cyclist's rear wheel, stays across until `back`, where
its rear is 5 m past the cyclist's front, and eases back in by `to`, passing at the cyclist's speed plus
20 km/h, up to the street's limit, pulling away at 1.5 m/s^2. Because the cyclist moves, the marks are
where the driver gets to them at that speed; the driven car works them out again at every decision from
where the cyclist is then, keeping only where it started over (and, once past the cyclist, all of them),
so they hold however fast it actually goes. A pass is not on when it would gain less than 2.5 m/s on the
cyclist (`too_fast`), would not be over 5 m short of the junction ahead (its stop line, or the near side
of the crossing street), 10 m short of a marked crosswalk or 30 m short of a level crossing, would go past
a work zone, a lane closure, a double-parked van, a school bus with its reds on or a streetcar standing on
the street, or would leave no room (6 m) to move back in behind whoever rides or drives ahead of the
cyclist. The way is clear (`wayClear`) when nobody coming the other way, along the street or coming up to
the junction ahead with its indicator (or none) pointing into the oncoming lane (as round a
double-parked van), would reach the end of the pass sooner than 2 s after the driver's front is there;
the driven car must also see along the oncoming lane as far as anyone at the street's limit would come in
that time, or to the end of the street. Looking along the street for this, by clear daylight, it sees
oncoming traffic out to 250 m (`PASS_SIGHT_M`, sim/visibility.js; buildings and, with hidden hazards on,
other vehicles still block the view), past the 80 m it sees everything else in; when what it must see
is further than it can see now, less 10 m, it cannot tell, and stays behind, so it always does by night
and in rain, snow or fog. Only the first
driver behind a cyclist passes it: one ahead of it, between it and the cyclist or passing it and not yet
5 m past the cyclist's front, makes it wait (`queuedBehind`). Once across a driver carries on; still
behind the cyclist, it falls back in behind it if the way stops being clear (traffic looks again 2 s
later). Traffic (sim/npc.js) decides once its front is within 25 m of the cyclist and it is where the
pass would start easing over, moves across at 0.2 m/s for every m/s it drives (0.6 to 1.4 m/s), and
keeps the cyclist as the one it follows until it is within 0.15 m of the minimum passing distance clear of
it; buses, school buses, streetcars, plows and cyclists do not pass. A cyclist riding the empty parking lane
leaves room in the lane, and is passed there as before. The driven car's sensing reports `cyclist_pass`
for the nearest cyclist it can see riding in its lane ahead within 50 m, or the one it is passing, until
it is past the end of the way round: the gap, the cyclist's speed, the minimum passing distance, whether a
pass is on and why not, the way, who is ahead of it, whether it is too close behind to pull out (less than
8 m to where it would be across: it drops back), whether it has started round (it is executing a law that
goes round and has moved across, or drawn level), whether it goes (`go`), the detour, and the speed to
stay 8 m behind at. While it cannot go, the cyclist is followed and the target speed stays 8 m behind it;
once it goes the cyclist is not followed, the car keeps to the pass speed, and only `pass_cyclist`
carries the detour (and `hard_brake`, once it has started round). Once it has started round, the only
candidates are carrying on round (`pass_cyclist`), dropping back in behind while still behind the cyclist
(`follow_cyclist`) and braking hard, so it never sits in the oncoming lane slower than the pass was worked
out for. Rules gets `pass_cyclist` (at the pass speed) and `follow_cyclist` (8 m
behind, in the lane): starting a pass costs 1.5, so the car passes only for a clear gain, and staying
behind one it cannot pass gains 1. The cautious agent takes `pass_cyclist` when it is offered. Candidates
are rejected that would pass a cyclist closer than the minimum passing distance
(`passes_cyclist_without_room`, in place of the metre of `passes_cyclist_too_close` that holds with the
option off), or that, going round a cyclist with the car's far side across the centre line, would meet a
vehicle coming the other way less than 8 m front to front or 2 s away (`crosses_into_oncoming_traffic`).
Decision models and LLMs get `cyclist_pass`, a situation line (in place of the plain "cyclist ahead"
one), a motion criterion and a prompt line. The audit counts passing a cyclist closer than the minimum
passing distance (the car's body going from wholly behind a cyclist going its way to wholly ahead of it,
less than the distance, less 0.1 m, from it while alongside) as `close_passes`, which the metrics report
and fail a drive on (`passed a cyclist too close`), and, passing one with its centre left of the centre
line, meeting an oncoming vehicle as round a double-parked van as a failure to yield (`cyclist_pass`),
both only with the option on. Coaching counts them (`close_passes`, `cyclist_cutoffs`) with tips, and
passing is not driving the wrong way. The HUD says "CYCLIST AHEAD · ONCOMING TRAFFIC · STAY BEHIND",
"CYCLIST AHEAD · CAN'T SEE FAR ENOUGH · STAY BEHIND", "CYCLIST AHEAD · WAIT YOUR TURN BEHIND", "CYCLIST
AHEAD · WAY CLEAR · PASS WITH 1 M" (or 1.5 M), "PASSING A CYCLIST · 1 M CLEAR · BACK IN WELL AHEAD OF
THEM" or, where a pass is not on, why ("CYCLIST AHEAD · JUNCTION AHEAD · STAY BEHIND", say), and AI eyes
outline the cyclist in amber. The seeded benchmark and the other challenges have it off.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Passing cyclists is opt-in.** `World` option `passCyclists` (free drives, unless `?cyclistpass=0`; challenges with `passCyclists: true`) has traffic and the driven car pass a cyclist riding in the lane of a two-way street with one lane each way through the oncoming lane, once it is clear, with the minimum passing distance (`sim/cyclist-pass.js`, `cyclist_pass` in sensing, `pass_cyclist`/`follow_cyclist`). With it off nothing is computed, candidates keep the 1 m `CYCLIST_CLEARANCE_M` rejection (`passes_cyclist_too_close`), and the audit's `close_passes` never reaches the metrics, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
