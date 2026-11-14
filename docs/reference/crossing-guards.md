# School crossing guards

School crossing guards (`static/js/sim/crossing-guard.js`, `World` option `guards`: on in free drives
unless `?guards=0`, and in "Stop for the guard"). Posts stand at marked crosswalks between junctions
(`map.crosswalks`, `crowd.marked`) within a school-zone span on either direction's edge, while the zone
is in effect by `inEffect("school", world.clock)`. The current packs have sites on Rue Berri in Montréal
and Trollope Street in Halifax. Guards wait at the curb in hi-vis vests with round red STOP paddles.
Groups of one to four children arrive along the sidewalk every 25 to 70 s, from a separate seeded stream.
Once everyone is at the curb and approaching traffic can stop comfortably (1 s reaction plus braking
at the weather-dependent `comfort().decel`), the guard raises the paddle and walks to the middle at 1.2 m/s. The children cross;
only once every child is on the far sidewalk does the guard return and lower the paddle at the curb.
School hours ending never cuts short a crossing. Guards and children are pedestrians (`ped.guard`,
`ped.child`); the manager moves them until children finish crossing, when the crowd walks them home.
Collisions, visibility and rendering treat them as people; the vest and paddle are render-only.

The stop rule models Ontario HTA s.176 and the corresponding BC and Québec rule: traffic both ways,
including cyclists, stops before the crosswalk until the guard and every child are off the entire
roadway. The sim's front stop point is 5 m short of the crosswalk centre. A driver owes the stop if it
could brake at up to 3.5 m/s² when the sign rose (or on first approach for later arrivals); that decision
is retained for the whole crossing. Sensing reports `crossing_guard` within 80 m once the guard is in
view: paddle, phase, children waiting, people in the road, stop point and whether the car must wait.
A raised sign already seen remains binding when traffic temporarily hides the guard.
Rules and the cautious agent choose `stop_for_crossing_guard`; candidates passing the stop point by
more than 1.5 m are rejected (`passes_crossing_guard`), and deadlock recovery leaves a lawful wait alone.
State, motion criteria, situation text and the LLM prompt explain waiting for the whole roadway.
The audit counts proceeding more than 2 m past the stop point at over 1 m/s once owed, once per raising,
as `guard_violations` (`passed_crossing_guard` event). Metrics and coaching report it only after a guard
has stood out in the drive (`World.guardsSeen`); it fails the drive and costs legality points.
The HUD announces children waiting or "CROSSING GUARD · STOP · WAIT UNTIL EVERYONE IS ACROSS".
Replay checkpoints preserve the post, crowd identities, random stream and obligations, and reconnect
the manager to the restored world. With guards off no posts, arrivals, random draws, traffic checks or
audit computations run; metrics and coaching have no guard field. The focused check is
`node --experimental-default-type=module scripts/test_crossing_guards.mjs`.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **School crossing guards are opt-in.** `World` option `guards` (free drives, unless `?guards=0`; challenges with `guards: true`) staffs marked mid-block crosswalks in school zones while `inEffect` holds (`sim/crossing-guard.js`). Guards and children are pedestrians (`guard` / `child`); their manager moves them until children reach the far sidewalk. Everyone, cyclists too, stops for the raised STOP sign until the guard and every child are off the roadway. Stop obligations are captured when the sign rises and shared by sensing, traffic and audit. The audit's `guard_violations` reaches the metrics, and fails a drive, only once a guard has stood out in it (`World.guardsSeen`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
