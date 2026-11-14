# Power cuts

Power cuts (`static/js/sim/outage.js`): where a signal's lights are out, every driver treats the
junction as an all-way stop (the MTO Driver's Handbook, ICBC's Learn to Drive Smart, and the other
provinces' handbooks). Each of its approaches then obeys an all-way stop in place of its signal
(`controlAt`): its own stop for that approach, as a stop sign's, on the signal's line, all of them in one
queue for the junction (`sim/all-way.js`, keyed on the signal's id), where a vehicle that went has cleared
the junction once it is 2 m past the far side of its widest street. Its signal heads and walk signals are
dark, and people on foot cross there on a gap, as where there is no signal. A traffic driver too close to
its line to stop there when the lights go out goes on through; traffic, buses and streetcars all obey it,
and emergency vehicles slow through it as through any junction they have no right of way at. In a free
drive one signal at a time is dark, 150 to 450 m from the car where it cannot see it, with nobody within
40 m, for 4 to 8 minutes; its lights come back on once the car is 150 m away, out of sight, and nobody is
within 40 m, and the next goes dark 60 to 180 s later (`?outages=0` turns them off). The car's sensing is
honest: until it can see the junction it reports an unseen signal, and once it can, an all-way stop
(`intersection.control` is `stop`, `all_way` true, with `dark` and its place in the order). Rules needs
nothing new. Decision models and LLMs get `intersection.lights_out`, a situation line and a prompt line.
The audit counts going through without a full stop as a missed stop, and going out of turn as a failure
to yield (both events with `dark`), with a coaching tip. The HUD says "LIGHTS OUT · ALL-WAY STOP · STOP AT
THE LINE", "· WAIT YOUR TURN" or "· YOUR TURN". The seeded benchmark and the other challenges have none.
