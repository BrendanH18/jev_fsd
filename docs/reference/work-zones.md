# Work zones with a flagger

Work zones with a flagger (Ontario Highway Traffic Act s. 146.1; the Ontario Traffic Manual, Book 7;
`static/js/sim/work-zone.js`, `render/work-zone.js`): a road crew closes one lane of a straight block of a
two-way street with one lane each way, and two traffic control persons, one on the sidewalk at each end,
take turns letting each direction through the lane that is left with STOP/SLOW paddles. Along the closed
lane's street a zone runs 100 m: the closed side's stop line, 6 m to where its traffic starts moving
across, 30 m over which it does, 2 m, the closed stretch itself (24 m of the closed lane and its parking
lane, a parked obstacle, with the crew's truck, its arrow board, two workers and cones angled across the
lane for 12 m before it), 2 m, 30 m back, and 6 m on to the other side's stop line. The flaggers keep one
side on SLOW for at least 10 s, then turn both paddles to STOP once someone is waiting at the other end and
nobody more is coming within 40 m on this one, or after 25 s; both stay on STOP for at least 2 s and until
nothing is left in the one-lane section, then the other side gets SLOW. Everyone keeps to 30 km/h (never
above the street's limit) from their stop line to the end of the one-lane section. A driver short of its
line when its paddle turns to STOP stops there if it could, braking at up to 3.5 m/s^2; one too close goes
on through, and the flaggers wait for it. Traffic, buses and cyclists all do, and the closed side goes
round the closed stretch through the other lane; emergency vehicles are not routed round it. In a free
drive one zone stands at a time, 150 to 450 m from the car where it cannot see it, for 4 to 8 minutes, and
packs up once the car is 150 m away, out of sight, and nothing is in its one-lane section
(`?workzones=0` takes them off). Zones go only where there is no marked crosswalk, bus or streetcar route
or level crossing on the block, 20 m or more from a junction or its stop line; whoever is parked along the
zone leaves, and nobody parks there. The car's sensing reports `work_zone` once it can see the flagger at
its end: which side it is on, what the paddle shows it, its stop line, whether it must wait there, and, on
the closed side, the detour round the closed stretch in route arc lengths, which every lane and hard-brake
candidate then follows (`detour` in a lane law, `sim/controller.js` `detourAt`). Rules gets a
`stop_for_flagger` candidate and rejects going past the line while it must wait (`runs_flagger_stop`).
Decision models and LLMs get `work_zone`, a situation line, a motion criterion and a prompt line. The
audit counts a missed stop once each time a paddle turns to STOP if the car, owing it, goes more than 2 m
past the line at more than 1 m/s while it still shows STOP; the coaching score counts going through
faster than the zone's limit, with tips for both. The HUD says "WORK ZONE · FLAGGER SHOWS STOP · WAIT AT
THE LINE" or "WORK ZONE · SLOW · 30 · ONE LANE" (with "· GO ROUND IT" where the car's lane is closed), and
AI eyes outline the closed stretch in amber. The seeded benchmark and the other challenges have none.
