# Simulation: car, traffic, buses and emergency vehicles

The car uses a dynamic bicycle model with saturating tire forces, weight transfer, power-limited
acceleration, actuator lag, drag and stability assistance. The same physical model runs traffic
cars and candidate predictions. Rain and snow reduce grip.

Traffic follows lanes, obeys signals, yields at junctions and crossings, changes lanes, reserves
curb parking, pulls in and waits for gaps before pulling out, looking again until it is moving. Parked cars can open a street-side
door for six seconds; the animated door has matching sensing, prediction and collision geometry.
Cyclists ride bike routes, keeping right: where a street's parking lane is empty to the end of the
block they ride in it, past cars queued at the corner, and move back into the traffic lane before
the next parked car once nothing is beside them. A car turning right, the driven car included,
waits for a cyclist coming up on its right (a right hook). Pedestrians cross at signals, at the
marked crosswalks between junctions (half of those walking past one cross there, stepping off once
nothing coming is too close to stop for them, BC MVA s. 179) or sometimes mid-block, and carry
umbrellas in rain. A vehicle in traffic hides a person behind it from the driver. Nobody may pass a
vehicle stopped at a crosswalk (BC MVA s. 179(3)): the driven car coming up beside one in another
lane stops 3.5 m short of the crosswalk's centre, if it could do that braking at up to 3.5 m/s^2
when it first saw it, and goes on once it has stood still there for 2 s (see
`static/js/sim/crosswalk.js` and [maps.md](../maps.md#crosswalks)). In a free drive an ambulance or a fire truck
answers a call now and then, lights flashing and siren wailing (with **Sound** on), coming up
behind the car, toward it or across the junction ahead; everyone pulls over to the right, clear of
any junction, and stops until it has gone by (`?emergency=0` turns them off). Buses run their
real routes (up to four at a time, `?buses=0` takes them off) and stop at the routes' real stops:
they signal, pull in to the curb, wait 10 to 25 s with their doors open, signal left and pull out.
Where the limit is 60 km/h or less, traffic and the driven car coming up behind a bus at a stop
that is signalling to pull out let it go first (BC Motor Vehicle Act s. 169.1) when they can stop
2 m behind it braking at up to 3 m/s^2; nobody parks in a bus zone, and traffic eases left in its
lane to get past a bus standing at its stop. See `static/js/sim/bus.js` and
[maps.md](../maps.md#bus-and-streetcar-routes) for where the routes come from. On the school run (7:00 to 17:00)
two school buses drive the streets (`?schoolbuses=0` takes them off) and every 150 to 400 m stop in
their lane, mid-block on a two-way street with one lane each way and a limit of 50 km/h or less, to
let one to three children off: ambers flashing as they slow, then reds and the stop arm. Some of
the children cross the street in front of the bus. Traffic both ways and the driven car stop for a
school bus with its reds flashing (BC Motor Vehicle Act s. 149), 5 m behind it or 10 m short of its
front, when they can stop there braking at up to 3.5 m/s^2, and wait until the reds go off; the bus
keeps them on until its children are across. See `static/js/sim/school-bus.js`.
