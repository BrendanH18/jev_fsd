# Advance greens and left-turn arrows

Advance greens and left-turn arrows (`static/js/sim/signals.js`): where two multi-lane major streets
(primary or secondary, two lanes or more in a direction) cross at a signal, one approach on one of them,
with an approach opposite it in its group and a left turn out of it, leads its group with a protected
left turn: the busiest (lanes × limit), then the first by edge id. The cycle grows by 12 s to fit it:
for the first 8 s of the group's green only that approach goes, and the approach opposite it (and any
other in its group) waits on red; then 4 s of clearance (a yellow arrow for 3 s and 1 s of red for the
turn), and the whole group has its usual green, left turns yielding to oncoming traffic as ever. In
Ontario and Québec it shows as a flashing green ball, under which the approach may go left, straight or
right (the MTO Driver's Handbook, "Traffic lights"; the SAAQ's "feu vert clignotant"), steady green
through the clearance; everywhere else as a green left arrow beside a red ball, under which only the
left turn goes (BC's Motor Vehicle Act s. 130), so in BC a flashing green never means an advance (it
means a pedestrian-controlled signal there). The province comes from a coarse outline of Ontario and
Québec judged at the map's centre. The people walking alongside that group start their walk once the
clearance is over. The bundled maps have 50 such junctions, none in Saint-Roch and 12 in Victoria's Old
Town. Each approach's light is now worked out for the way a vehicle goes (`approachPhase`,
`movementSignal`): traffic, buses, streetcars and the driven car turn left on the arrow and wait for
their green going any other way; a right turn on red from an approach held while the approach opposite
has its advance waits for it to end, as the protected turns come into the same street. The car's
sensing reports `intersection.signal` for its own movement and `intersection.advance` (`flashing_green`,
`left_arrow`, `left_arrow_yellow`, or `held` on the approach opposite, and whether its left turn is
`protected`); a protected left turn does not wait for oncoming traffic, held on red. Decision models
and LLMs get `intersection.advance`, a situation line and a prompt line. The audit counts a red light
run crossing the line on a red for the car's movement; crossing it on a left arrow it judges once the
car is 15 m from the junction's centre, counting anything but a left turn (or a right turn on red after
a full stop) as a red light run. Signal heads light each approach on its own at such a junction: a
left arrow's approach has two more sections, a yellow arrow and a green arrow, under the head over its
left lane, and a flashing green blinks. The HUD says "LEFT ARROW · NOT YOUR LIGHT · WAIT FOR GREEN",
"LEFT ARROW · TURN PROTECTED", "YELLOW ARROW · TURN ENDING · STOP IF YOU CAN", "ADVANCE GREEN · LEFT
TURN PROTECTED" or "ADVANCE GREEN · ONCOMING TRAFFIC HELD". This reaches the seeded benchmark (see
[the Rules baseline](../rules-baseline.md)).
