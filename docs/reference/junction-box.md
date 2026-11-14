# Keeping the junction clear

Keeping the junction clear (Québec's Highway Safety Code; Québec.ca, "Savoir manœuvrer aux
intersections"): even on a green, a driver must not enter a junction without room past it to clear it
completely. At a signal the box runs from the stop line to the far side of the widest street across
it. A driver short of the line, or up to 1 m over it, waits there while a vehicle ahead on its way past
the junction, going its way, stopped or slower than 3 m/s, leaves less than its own length, the 2.5 m
it would stop behind that vehicle and 1 m clear of the box; so does one further over, slower than 2 m/s and still short of the street across.
Into the junction it is committed. Traffic, buses and streetcars wait (at the line, 2 m back, as at any
line); cyclists, who keep right of the queue, and emergency vehicles with their sirens on do not.
Junctions without a signal, and roundabouts, are left out. The car's sensing reports `junction_box`
(it aims to stop 1 m short of the line, and a slow stop runs on to about the line); Rules gets a
`wait_short_of_junction` candidate and rejects going on past it (`blocks_junction`). Decision models
and LLMs get `junction_box`, a situation line, a motion criterion and a prompt line. The audit counts a
failure to yield (`to: "cross traffic"`, `blocking: true`) once a visit if the car, following its route,
entered the junction (its front past the near side of the street across) while traffic past it left no
room, and then stands in it slower than 1 m/s while its light is red; the coaching score counts standing
in a junction for a second with traffic past it leaving no room ("Stopped in the junction"), with a tip.
The HUD says "JUNCTION · NO ROOM PAST IT · WAIT AT THE LINE" while the light is not red, and AI eyes
outline the vehicle that leaves no room in amber. At an all-way stop, traffic also waits for a car
coming in on a street without a sign there (the short link between two junctions close together),
which does not stop, and that car gives way to one pulling away from an all-way stop's line. Both
reach the seeded benchmark (see [the Rules baseline](../rules-baseline.md)). See
`static/js/sim/junction-box.js`.
