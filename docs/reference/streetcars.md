# Streetcars

Streetcars (Ontario Highway Traffic Act s. 166): in a free drive two streetcars run the map's
streetcar runs (`?streetcars=0` takes them off; only The Annex has any, the 511 on Bathurst Street),
placed and replaced as buses are. A streetcar keeps to the lane its track is laid in, never changing
lanes or pulling over, stops in it at each of its stops, and opens its doors while up to three
riders get off across the lane beside it to the curb and up to three walk out to it from the curb;
its doors never close on a rider in the street. At the end of its run it waits until the car is well
away or out of sight, and leaves. A driver going its way, behind it in its lane or in the lane beside
it on the curb side, stops 4 m behind its rear doors (the law's line is 2 m behind them; 4 m behind
it in its own lane) while they are open, if it could stop there braking at up to 3.5 m/s^2 when it first saw them open: traffic,
cyclists and the driven car alike. Rules gets a `stop_for_streetcar` candidate and rejects going past
that point (`passes_streetcar_doors`), and slows for a streetcar slowing for its stop. Decision models
and LLMs get `streetcar`. The audit counts a failure to yield once a stop if the car, owing it,
comes within 2 m of the rear doors at more than 1 m/s while they are open. The HUD says "STREETCAR · DOORS OPEN ·
STOP BEHIND THE DOORS", and AI eyes outline it in amber. The seeded benchmark and the other
challenges have none. See `static/js/sim/streetcar.js`.
