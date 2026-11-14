# School and playground zones

School and playground zones (BC Motor Vehicle Act s. 147) come from each map's schools and
playgrounds in OpenStreetMap ([maps.md](../maps.md#school-and-playground-zones)). Where one is in
effect the limit is 30 km/h, never more than the street's own: a school zone's from 8:00 to 17:00 (the
sim has no calendar, so every day is a school day), a playground zone's from dawn to dusk (while the
sun, as the sky draws it, is above -6 deg). The world's road info reports the zone's limit and the
zone, so the HUD's limit sign turns yellow-green and says SCHOOL or PLAYGROUND, the coaching score
counts speeding against it (and says so once a visit), and Rules keeps to it. Rules also slows on
the way in, to be at the zone's limit as its front reaches the sign, and traffic keeps to it from
15 m before. Signs stand where each stretch of zone starts and, short of the end of its street, where
it ends. AI eyes outlines the zones in effect nearby in yellow-green. The seeded benchmark drives no
zones (its world has no clock); a benchmark replayed in the app likewise. See
`static/js/sim/speed-zones.js`.
