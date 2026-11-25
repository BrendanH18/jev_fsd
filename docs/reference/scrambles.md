# Scramble crossings

Scramble crossings (`static/js/sim/signals.js`, `World` option `scrambles`: on in free drives unless
`?scramble=0`, and in the "All walk" challenge). A layer beside each pack, `<key>.scrambles.v1.json`
(`jev/osm/scrambles.py`), marks a signal as a scramble crossing where a crossing node or footway within
30 m of it says so (`crossing:scramble=yes`, `crossing=scramble`, or a note or description naming a scramble,
an all-way walk or a Barnes dance), or where a footway tagged as a crossing runs diagonally across the
junction (within 6 m of its centre, at least 25 degrees off every approach). Of the bundled maps only
Victoria's has one, at Government Street, Wharf Street and Humboldt Street, by the Empress. `MapData` keeps a
second plan for it, `scramblePlan`: the usual one with an all-walk added after the last group's clearance, a
10 s walk and then a flashing hand long enough to cross the junction corner to corner at 1.2 m/s (at least
7 s), then 2 s of all-red, every approach red throughout. `planOf` uses it only while scrambles are on
(`setScrambles`, module state set by `new World()`, as the weather's grip is). The walk is exclusive: at a
scramble `pedPhase` gives every group the all-walk, so nobody walks alongside a green and turning traffic
has the crosswalks to itself; and, as Toronto signs its scrambles, there is no right turn on red there
(`isScramble`): not for the driven car (`intersection.right_on_red` is not offered; `intersection.scramble`
says whether the all-walk is on and for how long, or when it comes, and that there is no right on red), not
for traffic (`NpcFleet.rightOnRed`), and the audit counts one as running the red light (its event has
`scramble: true`), with a coaching tip. At a scramble a third of the people at a corner cross diagonally,
straight to the farthest corner, on the all-walk; drivers yield to them in the junction as to anyone
crossing. Decision models and LLMs get `intersection.scramble`, a situation line and a prompt line. The
diagonal crosswalks are painted, the walk signals all show the walk together, and the HUD says "SCRAMBLE
CROSSING · ALL WALK · EVERY LIGHT RED" and, at its red turning right, "SCRAMBLE CROSSING · NO RIGHT TURN ON
RED". With scrambles off every signal runs and every pedestrian walks exactly as before; the seeded
benchmark and the other challenges have it off.

The feature record owns the World option, red-turn ban, decision wording, HUD notice and replay
restore. The signal module still computes the all-walk plan and pedestrian phase.
See [the feature interface](../feature-interface.md#a-record).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Scramble crossings are opt-in.** `World` option `scrambles` (free drives, unless `?scramble=0`; challenges with `scrambles: true`) sets module state in `sim/signals.js` (`setScrambles`), like the weather's grip: `MapData` keeps a `scramblePlan` beside `plan` for each signal in the map's scrambles layer, and `planOf` picks it only while scrambles are on. A scramble's all-walk is exclusive (`pedPhase` gives every group the all-walk), people cross diagonally there, and there is no right turn on red (`isScramble`, in sensing, `NpcFleet.rightOnRed` and the audit). With it off every signal runs and every pedestrian walks exactly as before; keep it that way.
