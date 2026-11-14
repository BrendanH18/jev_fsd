# Speed humps, tables, cushions and bumps

Speed humps, tables, cushions and bumps (`static/js/sim/traffic-calming.js`, `World` option `calming`: on in
free drives unless `?calming=0`, and in the "Over the humps" challenge). A layer beside each pack,
`<key>.calming.v1.json` (`jev/osm/calming.py`), places every node tagged `traffic_calming` with `hump`,
`table`, `cushion` or `bump` on the pack street whose centreline passes within 4 m of it, on both edges of a
two-way street, merging two within 6 m on one street (a hump mapped once a lane); a table at a crossing is
a raised crosswalk. Devices tagged on a whole way (as Kitsilano's bikeways' `traffic_calming=yes`) and
islands, chokers and chicanes are left out. Each kind has the shape the Transportation Association of
Canada's traffic calming guide gives it: a hump a cosine rise 3.7 m long and 80 mm high, crossed at
30 km/h; a cushion the same, which a vehicle 2.3 m wide or more straddles; a table 6.7 m long with a flat
top of 3 m, crossed at 40 km/h; and a bump 0.9 m long, at 15 km/h. Routes keep them in route arc length
(`calmingMarks`, map/route.js). The driven car's sensing reports the next one along its route within 80 m
whose far side is ahead of its rear (`traffic_calming`); `snap.limit` and the target speed come down to its
speed (no faster than the weather allows anywhere else) by 8 m short of it, braking at 0.6 of the comfortable
rate, and stay there until its rear is over, so no manoeuvre goes faster. Traffic slows to 10% over each
device's speed by 6 m short of it, braking at 1 m/s^2, and keeps to that over it; cyclists ride over, and
wide vehicles straddle cushions. The audit counts the car's front axle crossing a device more than 10 km/h
over its speed as a hard hit (`hump_hits`), once a device a crossing; the metrics report it, and fail a
drive on it (`took a speed hump too fast`), only once the car has crossed a device (`World.calmingSeen`).
Coaching takes 8 points of smoothness a hit, with an incident and a tip. Decision models and LLMs get
`traffic_calming`, a situation line and a prompt line; the HUD says "SPEED HUMP AHEAD · SLOW TO 30 KM/H"
(or "TAKE IT AT", already slow enough) and then "SPEED HUMP · 30 KM/H" while over it. The devices are
drawn rising across the street with their white triangles, depth-tested after the ground's markings, and
the bodies of the car and of traffic rise and pitch over them, as the height under each axle has it
(render only: the sim's cars stay on the road). Traffic circles were there already: OSM maps them as
roundabouts. The seeded benchmark and the other challenges have it off.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Traffic calming is opt-in.** `World` option `calming` (free drives, unless `?calming=0`; challenges with `calming: true`) has traffic and the driven car slow for the speed humps, tables, cushions and bumps of the map's calming layer (`sim/traffic-calming.js`, `traffic_calming` in sensing, which also caps `snap.limit`), and draws them and the cars riding over them (`render/traffic-calming.js`). The audit's `hump_hits` reaches the metrics, and fails a drive, only once the car has crossed a device (`World.calmingSeen`), so the seeded benchmark and the other challenges play out and report exactly as before; keep it that way.
