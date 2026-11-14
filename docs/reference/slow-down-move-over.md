# Slow down, move over

Slow down, move over (BC Motor Vehicle Act Regulations s. 47.02): in a free drive two vehicles stand
at the roadside with their lights flashing at any time (`?roadside=0` takes them off), each in two
bays of a street's right-hand parking lane, 150 to 450 m from the car and out of its sight, for 2.5
to 6 minutes, leaving once the car is well away: a tow truck (amber lights) in front of the car it is
about to tow, or a police car (red and blue) behind the car it has pulled over. They are parked cars
that never pull out or open a door, so traffic, cyclists and collisions treat them as such. Passing
one going its way, from 30 m short of its rear until past it, the limit is 40 km/h (70 where the
street's is 80 or more): traffic keeps to it in every lane from 40 m before that, and Rules keeps to
it from the way in, as the snapshot's `limit`. In the lane next to it, where another lane goes the
car's way, the car is offered a `move_over` lane change to the left (not within 5 m of it, and only
into a lane that runs on past it), and Rules takes it and stays out of that lane until past it, if
it safely can. The coaching score counts passing too fast and passing it in the lane next to it,
each once a vehicle, with a tip; the HUD says "TOW TRUCK · LIGHTS FLASHING · SLOW TO 40 · MOVE OVER",
and AI eyes outlines it in amber. The seeded benchmark and the other challenges have none. See
`static/js/sim/roadside.js`.
