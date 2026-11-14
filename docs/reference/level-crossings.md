# Level crossings

Level crossings (Alberta Use of Highway and Rules of the Road Regulation, AR 304/2002, s. 42): in a
free drive one heritage streetcar runs each map's track (`?trains=0` takes it off; only Old Strathcona,
Edmonton, has one, the High Level Bridge line). It runs at up to 25 km/h, stops 15 to 30 s at each
stop, waits 40 to 80 s at its terminus and turns back, and comes back 60 to 150 s after running off the
map's edge. It rings its gong on the way to each crossing, from 150 m out, and brakes (at up to
2.5 m/s^2) for anything in its way that its motorman can see. While it is coming, or on the
crossing, a driver crossing the track stops with its front 7 m back from the nearest rail (the law's
line is 5 m) and waits until it has passed, if it could stop there braking at up to 3.5 m/s^2 when it
first heard (within 250 m) or saw it. And whatever is coming, nobody stops on the tracks: a driver waits
at the same place while a vehicle past them, stopped or slower than 3 m/s, leaves less than its own
length and 1 m clear of the train's envelope (2.5 m either side of the track's centre). Traffic,
cyclists and the driven car alike; an emergency vehicle waits only for the train. Rules gets a
`stop_before_tracks` candidate and rejects going past that point (`crosses_in_front_of_train`,
`no_room_past_tracks`). Decision models and LLMs get `level_crossing`. The audit counts a failure to
yield to the train once per train at each crossing if the car, owing the stop, comes within 5 m of the nearest
rail at more than 1 m/s while it is approaching, or stands on the tracks slower than 1 m/s while it is;
the coaching score counts standing on the tracks for a second, once a visit ("Stopped on the tracks"),
with a tip. The HUD says "LEVEL CROSSING · STREETCAR COMING · STOP 5 M BACK" or "LEVEL CROSSING · NO
ROOM PAST THE TRACKS · WAIT SHORT OF THEM", and AI eyes outline the streetcar in amber. The seeded
benchmark has no trains; the room rule applies there as everywhere. See `static/js/sim/rail.js`.
