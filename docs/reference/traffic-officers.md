# Police officers directing traffic (`sim/traffic-officer.js`)

Every province's highway traffic act puts a police officer's directions above the signals (Ontario's
HTA s. 134, BC's Motor Vehicle Act s. 123, Québec's Highway Safety Code s. 309). `World` option
`officers` is on in free drives unless `?officers=0`, and in the **Follow the officer** challenge
(`officers: true`). The state (`createOfficers`) is a plain object on the World: whether officers come,
their own random stream (`rng(seed * 2654435761 + 57042)`), the officers standing now and when the next
may be looked for. From 30 s into a drive (`OFFICER_FIRST_S`), every 8 s while none stands and 90 s
after the last left, the nearest signal on the car's route 150 to 450 m ahead (`SPAWN_M`) that the car
cannot see, with nobody within 40 m of it, and that may have one (`officerSite`: three approaches or
more, no scramble plan, no streetcar run and no level crossing on its streets), gets an officer with
chance 0.35 (a draw only when there is such a junction). An officer stays 150 to 300 s, then leaves once
the car is 150 m away and out of sight with nobody within 40 m. `placeOfficer` puts one in the middle
of the box, facing the traffic it holds, and parks its cruiser (`POLICE_CAR`, `roadside` and `flashing`
for the renderer, but not in `world.roadside.vehicles`, so the move-over rule does not apply): in the
first free parking bay on the right of a street leading away from the junction, within 45 m, where
there is one (parked in `world.parked` like any car, so solid; whoever was parked there leaves, and the
bay is reserved), else up on the kerb beside one of them, out of the lanes (render-only).

The officer works in phases of their own (`phase` "A" or "B", the signal group waved, or "clear"): a
wave lasts at least 12 s (`GO_MIN_S`), then ends once someone waits on the held axis (a vehicle up to
60 m short of a held line, or someone on foot at the kerb to cross alongside it) and nobody on the
waved axis is too close to stop for the officer turning (`sim/amber.js` stopping distance plus 0.5 m),
or after 30 s (`GO_MAX_S`) with someone waiting. As it ends, everyone over a waved line already, or
moving and too close to stop, is waved on for that turn (`committed`, by id, the ego as `"ego"`).
Everyone is then held for at least 2 s (`CLEAR_S`) and until the box is empty: no vehicle's front,
middle or rear within `boxR` (the nearest stop line's distance from the centre, less 1.5 m) of the
centre, no one on foot crossing at the junction, and no vehicle waved on still short of its line (up to
15 s, `CLEAR_MAX_S`). Then the other axis is waved. A challenge can hold a wave to a time
(`holdUntil`). People on foot cross alongside the waved axis, starting only in the first 7 s of a wave
(`officerWalk`, used by `Crowd.mayCross` and `kerbConflict`).

`officerDirection(world, vehicle, edge)` is the one test: for a vehicle on an approach to a junction an
officer governs, "go" while its group is waved or it was waved on as the officer turned, else "stop";
null where no officer governs. While an officer stands there, `controlAt` (`sim/outage.js`) keeps the
junction a signal even in a power cut or overnight flashing, so nobody treats it as an all-way or
two-way stop; the lights themselves keep cycling (or stay dark) and are drawn as before. Traffic and
cyclists (`sim/npc.js`) stop at the line when held, on any light, and never give up waiting there
(`officerHeld`), and take no light, amber call, red-light run or turn on red at the junction when
waved; the box rule, left turns yielding to oncoming traffic and crosswalk yields apply as ever.
Contraflow cyclists take the officer's direction too. `World.light()` reports the officer's direction
as green or red, for the junction-box audit and HUD.

Sensing reports `traffic_officer` (and `intersection.officer`) once the car can see the officer within
80 m of the line: `direction`, `axis` (the group waved, or null in an all-stop), `approach_group`,
`phase` ("wave" or "all_stop"), `bumper_to_line_m`, `s_line_route`, `signal` (what the light shows,
"dark" in a power cut) and `against_light`. With it, the intersection has no amber observation, no
advance light, no right or left on red, no red-turn ban and no seconds to green, and no red-light
runner is sensed there; the stop target, `mustStop`, Rules' stop and the deadlock detector (`brain/safety.js`: held at
the line is a reason to wait, even on a green) all follow the officer. A deadlock creep (`brain/brain.js`
`creepForOfficer`) takes the officer's direction every step, even while no decision comes: held, it stops
at the line as `wait_for_officer` does; waved, it goes on. Candidates:
held, `wait_for_officer` (stop half a metre short of the line, never speeding up on the way, braking at no
more than `OFFICER_STOP_DECEL`, 2 m/s², and planning the stop `OFFICER_STOP_REACTION_S`, 0.4 s, plus the
car's pedal lag early, `officerStopLaw`, so that the lag never carries it on toward the line and the stop
never ends hard); waved,
`go_on_officer_wave` (on at the target speed); a prediction that crosses the line while held is
rejected `passes_officer_stop`. Rules prefers `wait_for_officer` (−12) and `go_on_officer_wave` (−1),
and gives `stop_at_line` no bonus under an officer, and while the car still rolls up to the line with
`wait_for_officer` eligible it leaves the stop to that law rather than braking hard in its last 1.5 m;
the cautious agent takes `wait_for_officer` when held, answering motion "drive" for it, since the law
stops at the line by itself (as for an amber stop or pulling over). Models get a `traffic_officer` field (`direction`, `wait_in_m`, `officer_waves`, `light_shows`,
`against_the_light`), a situation clause in place of the light's, the motion question's stop criterion
and a line in the system prompt. The HUD says OFFICER DIRECTING TRAFFIC · STOP or · GO, and the coach
says to stop even on a green, or to go even on a red.

The audit (`World.auditOfficer`): crossing the line of a junction an officer governs is judged by the
officer, not the light: while held it counts as `officer_violations` (event `officer_violation`), and
the red-light, amber, right-on-red, arrow and fresh-green checks are skipped there (a left turn waved
through is still checked against oncoming traffic). It reaches the metrics and fails a drive and a road
test (filed under right of way) only once the car has come within 60 m of the line of a junction an
officer governs and seen them (`World.officersSeen`). The drive score costs 35 legality points each
and caps the score at 69, with an incident, a coaching tip and a replay marker. With the option off
nothing is computed, no random number is drawn, and the seeded benchmark and the other challenges play
out and report exactly as before.

`render/traffic-officer.js` (`OfficerView`) draws each officer: a person in a hi-vis vest with two
reflective bands, a peaked cap and white gloves, turning (2.5 rad/s) to face the traffic held, the right
hand up, palm out, toward it, and the left arm out to the side, beckoning the waved traffic on, still
in an all-stop; and a cruiser up on the kerb with its lights flashing (one in a bay is a parked car,
drawn with the others and flashed by `syncRoadside`). Officers and cruisers are made and dropped by id,
so a restored checkpoint shows the right ones.

**Follow the officer** (`follow-the-officer`, seed 57042, Toronto, Spadina Avenue at Bloor Street West
in the Annex, dry afternoon): Spadina Avenue northbound (`e177`, then its approach `e344`, `sig7`, its
plan unchanged, group B) and on up Spadina Road (`e221`, `e218`, `e262`), 30 m along the last. The car
sets off 4 m along `e177` at 8 m/s, in the school zone there, about 80 m short of the line, 6 s into
its green, with the officer waving Bloor (group A) through against Bloor's red. The officer keeps Bloor
waved until 29 s after the start (`holdUntil`: the car's light red by then, Bloor's green), then holds
everyone and waves Spadina through, against its red. Bloor cars come along 2 and 6 s after the start
(through on their red) and 26 s after (held at their green once Spadina is waved). Rules and the
cautious agent stop at the line about 10 s in and wait on the green, go about 31 s in on the red, and
arrive about 15 s later. A driver who goes on while held gets `officer_violations` and fails. Checks:
`scripts/test_traffic_officers.mjs` (its `--write-snapshot` writes the live-model case
`data/snapshots/follow_the_officer.json`).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Police officers directing traffic are opt-in.** `World` option `officers` (free drives, unless `?officers=0`; challenges with `officers: true`) now and then, from its own random stream, puts an officer in the middle of a signalized junction 150–450 m ahead on the car's route, out of its sight and with nobody near, never at a scramble, streetcar line or level crossing (`officerSite`), with a cruiser parked in a bay at a corner (solid, in `world.parked`) or up on the kerb (render-only) (`sim/traffic-officer.js`, `World.officers`). The officer waves one signal group through and holds the other, switching only after a short all-stop once the box is empty; a driver too close to stop as they turn is waved on (`committed`, the driven car as `EGO_ID`). `officerDirection` is the one test, shared by sensing (`traffic_officer`), candidates (`wait_for_officer`, braking by `officerStopLaw`; `go_on_officer_wave`; rejection `passes_officer_stop`), Rules, the cautious agent, the deadlock creep (`creepForOfficer`, never over a held line), the model wording, traffic and cyclists (`sim/npc.js`, which never give up a held wait), contraflow cyclists and the audit; people on foot use `officerWalk`. While an officer stands there `controlAt` keeps the junction a signal (even dark or flashing) and the lights keep cycling: drivers obey the officer, sensing drops amber, turn-on-red, advance and runner fields, and the audit skips the red-light, amber, arrow and fresh-green checks there, counting crossing the line while held as `officer_violations`, which reaches the metrics, and fails a drive, only once the car has come up to an officer (`World.officersSeen`). With it off nothing is computed and no random stream is drawn, so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
