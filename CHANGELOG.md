# Changelog

## Unreleased

- School and playground zones (BC MVA s. 147; `static/js/sim/speed-zones.js`). Each bundled map now
  has its school and playground zones from OpenStreetMap beside its pack, in
  `data/maps/<key>.zones.v1.json` (`jev/osm/zones.py`): every stretch of street, each way the traffic
  goes, whose centreline passes within 22 m of a school's grounds or 35 m of a playground, or through
  them. A school is a way or multipolygon tagged `amenity=school`, or a point tagged so that gives its
  grades, and not a post-secondary one. That makes 138 zones across the twelve maps (58 schools, 80
  playgrounds). The packs are unchanged; the server and the browser demo add the file to the map as
  `zones`, with the city's UTC offset as `utc_offset`, and `scripts/fetch_map.py <preset> --zones`
  rebuilds it. The Overpass fallback query now asks for schools and playgrounds too.
- Where a zone is in effect the limit is 30 km/h, never above the street's own: a school zone's from
  8:00 to 17:00 (the sim has no calendar, so every day is a school day), a playground zone's from dawn
  to dusk (the sun above -6 deg, placed as the sky draws it; that maths moved from the renderer into
  the sim). The world's road info reports the zone and its limit, so the HUD's limit sign turns
  yellow-green and says SCHOOL or PLAYGROUND (with a badge on the way in), the coaching score counts
  speeding against it and logs "Speeding in a school zone" once a visit, with its own tip, and Rules
  keeps to it. Rules slows on the way in, to be at 30 km/h as its front reaches the sign
  ("school zone ahead"), and traffic keeps to it from 15 m before. Signs stand where each stretch
  starts and, short of the end of its street, where it ends: a pentagon or a diamond with a 30 km/h
  tab. AI eyes outlines the zones in effect nearby in yellow-green and says where the next one
  starts. Decision models and LLMs get `speed_zone` (kind, school name, limit, hours, where it starts
  and ends), a situation line and a prompt line.
- New challenge, "School zone" (Kitsilano, 9:00): West 11th Avenue past Lord Tennyson Elementary,
  a 50 km/h street whose block is a school zone. The car starts 4 m into it; 85 m on, a child waits
  at the curb between two parked cars and runs straight across the street once the car's front is
  18 m away. Rules and the cautious agent keep to 30 km/h and stop short of the child; the same Rules
  driver with no zone in effect reaches the child at 50 km/h and hits them.
- New checks in `scripts/test_speed_zones.mjs` and `tests/test_zones.py`; the drive-lab checks now run
  every challenge with its map's zones, in effect at the challenge's time of day. The seeded benchmark
  drives no zones (its world has no clock), so its results are unchanged.

- School buses (`static/js/sim/school-bus.js`, `render/school-bus.js`). On the school run (7:00 to
  17:00) a free drive has two Type C school buses (11.4 m, real size, weight and power; `?schoolbuses=0`
  takes them off) driving the streets as traffic. Every 150 to 400 m one stops in its lane to let
  children off, mid-block on a two-way street with one lane each way and a limit of 50 km/h or less,
  its rear 15 m clear of the junction behind and its front 20 m clear of the one ahead, and 15 m clear
  of any marked crosswalk. Its amber lights flash from 60 m before the stop; stopped, its red lights
  flash and its stop arm swings out. One to three children get off: some walk to the sidewalk beside
  it, the others walk forward past its front and cross the street 3 m in front of it, stepping off
  only while its reds flash and nothing coming is too close to stop. The reds stay on for 8 to 14 s
  and until every child it let off is across (one still at the curb after 45 s crosses on a gap
  instead; never with one in the street), then it moves off 1.5 s later. The
  children walk 20 to 40 m along the sidewalk and go home (off the map).
- Stopping for a school bus (BC MVA s. 149): traffic both ways (cyclists and other school buses too) and the driven car
  stop for a school bus with its reds flashing whose near end (its rear from behind, its front coming
  toward it) is within 9 m of their path, 5 m behind its rear or 10 m short of its front, clear of the
  children crossing there, if they could stop there braking at up to 3.5 m/s^2 when they first saw the
  reds; they wait until the reds go off. Rules picks a new `stop_for_school_bus` candidate, and
  manoeuvres that carry the front more than 1.5 m past that point are rejected
  (`passes_stopped_school_bus`, labelled in AI eyes, which outlines the bus in amber). With its ambers
  on, the car slows to a speed from which it could stop there comfortably (at least 4 m/s). Decision
  models and LLMs get `school_bus`, a situation line, a motion criterion and a prompt line; the HUD
  says "SCHOOL BUS · RED LIGHTS FLASHING · STOP". The audit counts a failure to yield (`school bus`)
  once a stop when the car, owing it, draws level with the bus's near end at more than 1 m/s while
  the reds are on.
- New challenge, "Flashing reds" (Kitsilano): the car starts on West 2nd Avenue, 110 m short of the
  front of a school bus coming the other way, stopped with its reds flashing. Once the car is 45 m
  from it, a child who has just got off walks forward past its front and crosses in front of it, into
  the car's lane. Rules and the cautious agent pass it.
- People are drawn by id, so children can come and go; children are smaller, with backpacks.
- New checks in `scripts/test_school_buses.mjs`. The seeded benchmark runs no school buses: in V8,
  Rules passes all 70 routes, every one exactly as on main (see
  [docs/rules-baseline.md](docs/rules-baseline.md)).

- Marked crosswalks between junctions. Each bundled map now has its marked crosswalks from
  OpenStreetMap beside its pack, in `data/maps/<key>.crossings.v1.json` (`jev/osm/crossings.py`):
  crossing nodes on drivable streets tagged as marked and without a signal, placed on the pack's own
  streets, with how they are painted and whether they have a refuge island; those within 16 m of a
  junction (people already cross at every corner), unmarked ones (in BC a crosswalk away from a
  junction exists only where it is marked) and signalled ones are left out. 102 across the twelve
  maps. The packs are unchanged; the server and the browser demo add the file to the map as
  `crossings`, and `scripts/fetch_map.py <preset> --transit` rebuilds it with the bus routes. They are
  painted (bars along the traffic, or two lines across it) with a crosswalk sign on the right of each
  way the traffic goes, a post the car can hit like any other.
  Half of the people walking along a block past one cross there, sidewalk to sidewalk, and walk on
  along the other side. They step off once nothing coming is too close to stop for them (braking at
  2.5 m/s^2 after a second's reaction, BC MVA s. 179(2)) and nothing stands in the crosswalk, and
  every driver gives way to them there as at a junction's crosswalk.
- A vehicle in traffic hides a person behind it. Sensing, the shared emergency brake and AI eyes no
  longer see a pedestrian when every line of sight to them passes through the body of a car, bus or
  emergency vehicle (moving or stopped in the road; cyclists and parked cars hide nobody yet).
- Not passing a vehicle stopped at a crosswalk (BC MVA s. 179(3), the "multiple threat"): a vehicle in
  traffic is stopped at a marked crosswalk when its front is within 8 m short of the crosswalk's
  centre and it moves slower than 3 m/s. The driven car, coming up behind it in another lane going the
  same way, stops with its front 3.5 m short of the crosswalk's centre if it could do that braking at
  up to 3.5 m/s^2 when it first saw it stopped, and goes on once it has stood still there for 2 s
  (it can see past it by then; anyone crossing in its path is given way to as usual) or the vehicle
  moves off. Rules picks a new `stop_at_crosswalk` candidate, and manoeuvres that carry the front more
  than 1.5 m past that point are rejected (`passes_car_stopped_at_crosswalk`, labelled in AI eyes,
  which outlines the stopped car in amber). Decision models and LLMs get `stopped_at_crosswalk`, a
  situation line, a motion criterion and a prompt line; the HUD says "CAR STOPPED AT CROSSWALK ·
  DON'T PASS". The audit counts a failure to yield (`vehicle stopped at a crosswalk`) once a vehicle
  and crosswalk, seen or not once first seen, when the car, owing it, crosses the crosswalk's centre at
  more than 1 m/s while it is still stopped there without having stood still at the crosswalk for 2 s.
- New challenge, "The multiple threat" (Kitsilano): the car starts on West Broadway in the lane beside
  the curb lane, 110 m before a marked crosswalk. A car stands at the crosswalk in the curb lane, and
  a person on the crosswalk in front of it, hidden by it; once the car is 45 m from the crosswalk they
  walk on across the street into its lane. Rules and the cautious agent pass it; a driver who carries
  on past at 47 km/h fails to yield twice (to the stopped car and to the person, who waits at the edge
  of its lane).
- New checks in `scripts/test_crosswalks.mjs` and `tests/test_crossings.py`.
- In the seeded benchmark, which runs 60 people, routes passing a crosswalk now meet people crossing
  there. Rules passes all 70 routes in V8 and 69 in WebKit, with no red-light or stop-sign violation,
  failure to yield or deadlock override; suites whose routes meet no crosswalk are unchanged route for
  route. WebKit Toronto `s1-1` fails on one collision, shared fault, not the car's: a traffic car from
  the left lane of a two-lane approach merges across the car beside it into a one-lane street past
  the junction, as traffic always has where a lane ends; the crosswalks only changed the timing. See
  [docs/rules-baseline.md](docs/rules-baseline.md).

- Buses run their real routes (`static/js/sim/bus.js`, `render/bus.js`). Each bundled map now has
  its bus and trolleybus routes and stops from OpenStreetMap beside its pack, in
  `data/maps/<key>.transit.v1.json` (`jev/osm/transit.py`): a route's ways joined end to end into
  runs along the pack's own streets, and its stops on the right-hand side of each run. The packs
  are unchanged; the server and the browser demo add the file to the map as `transit`, and
  `scripts/fetch_map.py <preset> --transit` rebuilds it from today's OSM (a custom area gets its
  routes from the same download as its pack). In a free drive up to four 12 m city buses (real
  size, weight and power) drive their runs in the curb lane at up to 95% of the limit, with the
  route number on a lit destination sign (`?buses=0` takes them off). At each stop a bus signals
  right from 50 m out, eases over toward the curb over the last 30 m (across the parking lane, to
  0.3 m from the curb) and stops with its front 1 m past the sign, clear of the junction behind it
  and short of the one ahead; it waits 10 to 25 s with its doors open, then signals left and pulls
  out once it has signalled for 2 s, nothing is beside it, nothing coming up behind would have to
  brake harder than 3 m/s^2 to stop 2 m behind it, and anything within 25 m behind is slowing.
  With buses running nobody parks in a bus zone (from 22 m before where the bus stops to 3 m after).
  Where the limit is 60 km/h or less, traffic and the driven car coming up behind a bus at a stop
  that signals to pull out let it go first (BC Motor Vehicle Act s. 169.1): one in the lane it
  pulls out into that can stop 2 m behind it braking at up to 3 m/s^2 stops there until it has
  pulled out; one that cannot, or is already beside it, carries on and the bus waits. Traffic
  eases left in its lane (up to 0.1 m short of its edge, at 0.5 m/s) to get past a bus standing at
  its stop, and waits behind it where there is not room. Traffic looks for a bus along its whole body, not
  only at its rear axle, and a bus stops for any part of a body across its way in the next 6 m, as
  an emergency vehicle does.
  The audit counts a failure to yield (`bus`) once each time a bus pulls out, if the car, behind it
  in its lane when it first saw it signal and able then to stop 2 m behind it braking at 3.5 m/s^2, draws
  level with it at more than 1 m/s before it has pulled out. Decision models and LLMs get
  `bus_pulling_out` (its route, how far ahead it is, where the car stops, whether it is already
  moving out), a situation line, a `yield_to_bus` candidate and a line in the motion criterion;
  manoeuvres past the stop are rejected (`fails_to_yield_to_bus`). AI eyes outlines a signalling
  bus in amber and says where the car stops; the HUD shows "BUS 4 PULLING OUT · YIELD". Bus stops
  have a pole and a blue flag. A new challenge, **Pulling out** (Kitsilano), starts the car on West
  4th Avenue 100 m behind a bus at its stop, which signals once the car is 45 m from it. With a
  thirteenth challenge, two evaluations of every challenge no longer fitted the arena's 4 MB browser
  history, so saving a new one dropped the chosen baseline: the budget is now 6 MB (counted as two
  bytes a character, about 3.1 million characters, well inside browsers' localStorage quotas). New checks
  in `scripts/test_buses.mjs` and `tests/test_transit.py`. The seeded benchmark runs no buses, so
  its traffic and parking are as they were: in the seeded V8 and WebKit benchmarks Rules passes all
  70 routes in each engine, every route exactly as before; see
  [docs/rules-baseline.md](docs/rules-baseline.md).

- Emergency vehicles answer calls (`static/js/sim/emergency.js`). In a free drive an ambulance or a
  fire truck (each at its real size, weight and power) is sent past the car 60 to 120 s in and then
  every 2.5 to 5 minutes: up behind it along its street, toward it down the street, or across the
  junction ahead, lights flashing and siren wailing (heard with **Sound** on; `?emergency=0` turns
  them off). It drives at up to 35% over the limit (60 km/h at most) along the middle of the road,
  moving across it to the nearest gap that clears everything by 0.15 m (4 m/s when that close, a
  1.5 m berth from anything moving that is not going its way), slows to 5 m/s through a junction
  where it has a red light or a sign and to 8 m/s through any other, and waits at the line for
  anything crossing. Stuck for 20 s it is stood down and turns its siren off.
  Everyone it calls on gives way, as BC's Motor Vehicle Act (s. 177) requires: its siren is heard
  within 100 m, seen or not, and it calls on whatever is in its way over the next 120 m, ahead of
  it either way along its street or on a street it crosses. Traffic and the driven car pull over to
  the right (into an empty parking lane beside the curb lane, up to 1.5 m; else to 0.35 m short of
  their lane's edge, clear of cars parked beyond it) and stop where they chose to when the call came:
  their stopping distance at 1.5 m/s^2 (3.5 m/s^2 for traffic it comes toward or across), short of the next
  junction if they can stop there braking at up to 3.5 m/s^2, else past it, and clear of a
  junction they are in. They wait until it has gone by. One going its way that holds it up for
  3 s, unable to let it past, drives on ahead of it instead. Once it has gone by, the driven car
  drops back to 150 m behind it (Alberta's rule for any emergency vehicle).
  The audit counts a failure to yield (`emergency vehicle`), seen or not, once a vehicle: still
  faster than 3 m/s and not slowing by at least 1 m/s^2 from 2 s after the call; entering a
  junction it is due across from the side, 3 s or more after the call; or holding it up for 6 s
  without having pulled over. Decision models and LLMs get `emergency_vehicle` (where it comes
  from, how far, when it arrives, whether it is seen, where to pull over and stop, or to drive on
  ahead) and `emergency_vehicle_ahead`, a situation line, a `pull_over` candidate (braking only as
  hard as the stop was planned for) and a motion criterion; manoeuvres past the stop are rejected
  (`fails_to_yield_to_emergency`). AI eyes outlines emergency vehicles in magenta, heard or seen,
  and says where it comes from and where the car stops; the HUD names it ("AMBULANCE BEHIND · PULL
  OVER AND STOP"). The seeded benchmark sends none, so its traffic is as it was.
  A new challenge, **Lights and sirens** (Edmonton), sends an ambulance up behind the car 45 m
  before a junction without a sign: pull over and stop short of it. New checks in
  `scripts/test_emergency.mjs`. In the seeded V8 and WebKit benchmarks Rules passes all 70 routes in
  each engine, every route exactly as before; see [docs/rules-baseline.md](docs/rules-baseline.md).

- The car turns round where its route makes a U-turn at a dead end (`static/js/sim/turnaround.js`).
  It slows and stops where it will turn, 9 m short of the U-turn or 3 m into a shorter street,
  then makes a three-point turn: legs at walking pace on full lock, forward turning left and back
  turning right, each ending short of the kerb (a bumper may reach 0.2 m over it), the end of the
  street, scenery and anything standing still, with more legs where it is tight. Once it faces
  back down the street it drives out, and hands back to the usual planner as soon as the route
  finds it in the lane beyond the U-turn, so the junction it comes out at is given way at as
  usual. It signals left throughout. Before, the car tried to follow the U-turn's line in one
  sweep, which no car can do on a street a few metres wide, stood still, and waited for deadlock
  recovery to creep it round: Toronto `s1-2` routes into Willcocks Common, a 10 m dead end, to
  turn back. Held up by traffic it waits with the turn intact; a turn that cannot move after 15
  legs, or stands still mid-leg for 5 s, is left to deadlock recovery.
  Decision models and LLMs get `nav.turn_round_in_m`, `turnaround` (whether it is under way, the
  leg and legs done), a situation line, two candidates (`stop_to_turn_round` and `turn_around`) and
  a line in the `drive` criterion (its legs back count as driving). Lane manoeuvres that would
  carry the car more than a metre past where it stops to turn round are rejected
  (`passes_turn_round_point`, labelled in AI eyes). New checks in `scripts/test_turnaround.mjs`:
  a 6.4 m dead end, the same facing each compass direction, and one between cars parked along
  both kerbs.

- Reversing is handled as reversing. The shared emergency brake looks behind the car while it
  backs up (and not ahead, which would hold up a leg back with a car just in front), braking in
  reverse pushes forward instead of speeding the car up backwards, and the audit puts backing
  into something down to the car. Turning round in a dead end off a junction ends the audit of
  the left turn the car made there for oncoming traffic: it comes back out as a new approach.

- A car two or more lanes from its route's lane keeps room for one lane change per lane before
  that lane ends, and a change toward the route's lane is always allowed. Before, it kept room for
  one change only, so starting two lanes over it could speed up, move one lane across, find no
  room left for the second, go back and stand still until deadlock recovery crept it over: Ottawa
  `s1-1` starts on Wellington Street two lanes left of its route's lane, 71 m before a right turn.
  A lane change also counts as over once the car is within 0.15 m of the new lane's centre, even
  short of the change's end, so one that stops there offers the next lane over.

- A deadlock event now says what the car was waiting on: how long it had stood still, the
  manoeuvre it last chose, how many candidates each rejection removed, the vehicle ahead, the
  control it was at, how many lanes it was from its route's lane and its next turn.

- In the seeded V8 and WebKit benchmarks Rules passes all 70 routes in each engine, as before,
  with no collision, red-light or stop-sign violation or failure to yield, and now **no deadlock
  override** (before: Toronto 4, Ottawa 3). Ottawa `s1-1` crosses its two lanes and arrives at
  175.4 s (175.3 s with the override). Toronto `s1-2` turns round in two legs and an exit by 54 s,
  then meets traffic at different times: 175.1 → 250.5 s in V8, behind a car that pulled out and
  at a red light, and 180.1 → 180.9 s in WebKit. Lane changes that end once across move three
  other routes by 5 s or more, all sooner (V8 Kitsilano dry `s1-4` and Winnipeg `s1-1`, WebKit
  Edmonton `s1-2`). See [docs/rules-baseline.md](docs/rules-baseline.md).

- Cyclists keep right. Where a street has a parking lane at least 1.5 m wide and nothing is
  parked in it to the end of the block (parking stops short of every corner), a cyclist rides in
  it, 2.6 m right of the traffic lane's centre, past cars queued or slowing at the corner, and
  carries on across the junction. It moves back into the traffic lane 20 m plus 2 s before the
  next parked car (once it is crossing the junction, for one on the next block), before a junction
  where it turns left or the next street has no parking lane, and only when no car in the lane is
  beside it or closing from behind; until then it waits in the parking lane, 6 m behind the parked
  car. It also takes an empty parking lane mid-block when it runs on for 60 m. Before, cyclists
  rode single file in the traffic lane, so a car never had one on its right. A cyclist now stops
  for any part of a body across its way, parked cars and open doors included, along the way it
  will actually ride (it lags the line it steers for), not only for one whose middle is in its
  path, so it no longer rides into the side of a car turning across it. A bicycle moves sideways
  only as it rolls forward; stopped within 6 m of something, the rider puts a foot down and
  shuffles it across, and round toward its way, into free space. In three simulated minutes of
  traffic on each of the twelve maps with three seeds, cyclists spend up to 16 % of their time in
  a parking lane (4.5 % on average), cars and cyclists touched 6 times against 7 before, and
  cyclists stand still 15 % longer, mostly waiting for a gap to move back into the lane.

- Turning right, the driven car yields to a cyclist on its right (a right hook): one clear of its
  lane line, going its way, that would reach the corner before the car could turn across its line
  of travel plus 1.5 s (0.75 s once the car is moving into the turn). It waits 1 m short of that
  line, or carries on once it can no longer stop short of it. A cyclist following the car in its
  lane is not waited for, nor one standing still beside it until it moves off. Traffic cars do the
  same from 50 m out, for a cyclist within 6 m to their right, judging their own time to the corner
  at no more than the 6 m/s they slow to for the turn.
  The audit counts turning across the line of a cyclist that rode on the car's right in the last
  3 s, due there within 2 s, as a failure to yield (`cyclist`), seen or not. Decision models and
  LLMs get `cyclist_on_right` (when the cyclist reaches the corner, how long the car needs, where it
  waits), a situation line, a `stop_for_cyclist` candidate and a motion criterion; manoeuvres past
  the wait point are rejected (`fails_to_yield_to_cyclist`, labelled in AI eyes).

- A traffic car gets into the lane for its next turn when that turn comes just past a short link
  going straight on inside the junction (a street under 20 m long). Before, it looked only at the
  end of the street it was on, so in Kitsilano, where West Broadway meets Yew Street through an
  8.6 m link, a car in the right lane turned left across the driven car turning beside it from the
  left lane (V8 Kitsilano fog `s1-4`, 133 s, once the cyclists above changed the traffic's timing).
  Kitsilano has 14 turns like it from streets with more than one lane.

- In the seeded V8 and WebKit benchmarks Rules passes all 70 routes in each engine, as before,
  with no collision, red-light or stop-sign violation or failure to yield, and the same seven
  deadlock overrides (Toronto 4, Ottawa 3). On Kitsilano `s1-7` in dry, fog and rain the car lets
  a cyclist on its right go by before turning. Across the 70 V8 routes it spends 179 s within
  20 m behind a cyclist, against 339 s before: Kitsilano snow `s1-7` arrives 70 s sooner, no
  longer following a cyclist at walking pace for 164 s. Other drives move both ways as traffic
  parks, pulls out and opens doors in different places; WebKit Edmonton `s1-2` reaches a signal as
  it turns red and arrives 62 s later. See [docs/rules-baseline.md](docs/rules-baseline.md).

- New challenge, **The right hook** (Vancouver, Kitsilano): a right turn off a bikeway from a
  street with the right of way, with a cyclist 15 m ahead in the empty parking lane at 5.5 m/s,
  going straight on past the corner. The car catches it up, and Rules waits about 6 s for it at
  the corner before turning behind it. New checks in `scripts/test_right_hook.mjs`.

- Junctions without a signal have a right of way, for traffic and the driven car alike
  (`static/js/sim/priority.js`). At a two-way stop, once its stop is made, the car gives way to
  traffic on the through road from both sides. Where streets meet with no sign at all, a smaller
  road gives way to a larger one (OpenStreetMap's primary and secondary roads, then tertiary, then
  the rest), and between streets of the same class traffic gives way to the right, as the law has
  it across Canada. The car waits for
  a vehicle with the right of way that would reach the junction before it has crossed it plus
  1.5 s (2 s from a stop), for anything moving across the junction, and for any vehicle due within
  2 s, whoever has the right of way. Before, the car gave way only at stop signs, to crossing
  traffic due within 4.5 s, and drove straight through junctions without a sign; traffic only
  waited for anyone already in such a junction. Across the twelve maps, 1,586 approaches to
  junctions without a sign give way to the right and 395 to a larger road; 970 more have the right
  of way over a smaller road or a stop sign, and 595 approaches at 430 junctions are two-way
  stops. A node where a signal's approach shorter than 20 m starts is part of that signal's
  junction (a junction drawn as several nodes), not a junction of its own. Turning left from the road with the right of way, the car yields to oncoming traffic as
  at a signal or a stop sign.

- Where a building hides a street it gives way to, the car slows so it can stop, then creeps
  forward at 1.5 m/s to look, as far as 0.3 m short of the crossing road's asphalt. It looks along
  each such street as far as traffic at that street's limit, slowed for the weather, covers in the
  time the car needs, within what it can see at all, so fog and darkness shorten the look rather
  than stall the car. Stopped where it looks from, it goes once nothing it can see is coming, even
  if a building still hides part of the street; the car remembers that stop until the next
  junction, so it does not inch forward in fits and starts. A creep that stands still for 12 s
  counts as a stall, and deadlock recovery takes over.

- The audit counts pulling out in front of a vehicle with the right of way, due at the junction
  within 2 s or already in it, as a failure to yield (`through traffic` or `traffic from the
  right`), seen or not, if it was on its way when the car crossed its line (a car that pulls out
  from the curb after that must give way itself). Before, a two-way stop was audited only for left turns across oncoming
  traffic, and a junction without a sign not at all. Decision models and LLMs get
  `intersection.give_way` (whether the way is clear, whom the car waits for, whether buildings hide
  the street and how far it sees, where it stops) and `intersection.right_of_way`, a situation
  line, two new candidates (`creep_to_look` and `wait_to_give_way`) and a motion criterion that
  allows holding still while giving way. Manoeuvres that would pass the point where the car must
  stop are rejected (`fails_to_yield`, or `enters_unseen_junction`, labelled in AI eyes).

- A junction without a sign that asks nothing of the car (it has the right of way, or nothing it
  gives way to is coming and it can see) no longer hides the control after it, in sensing or the
  audit: a signal or stop sign just beyond is the one the car slows for, and crossing it is
  audited. Traffic giving way at such a junction counts any vehicle moving faster than 0.2 m/s,
  not only above 1 m/s.

- New challenge, **The blind corner** (Vancouver, Mount Pleasant): a two-way stop where a corner
  building hides the through road from the line. Once the car has made its stop, a car comes from
  the right, out of sight, and another from the left. New checks in `scripts/test_give_way.mjs`.

- The shared emergency brake keeps steering along the manoeuvre the car was following (a lane
  manoeuvre or `hard_brake`), as the `hard_brake` manoeuvre itself does. Before, it held the steering wheel where it was, so braking partway
  round a bend, or through the jog where a route moves to another lane inside a junction, carried
  the car on round it toward what it was braking for. In WebKit, the changes above put a car
  waiting to turn left in Toronto (The Annex) beside such a jog as the car went through it
  (`s1-1`, 115.5 s): the brake fired for it with the car heading 25° off its lane, and the held
  wheel steered the car into it.

- A traffic car that changes lanes keeps its new lane on the streets ahead. Before, the lanes it
  had already planned for them stayed as they were, so a car that had moved to the right lane
  went back to the left one where its street joined the next, swinging 19° across the junction
  into whoever was beside it. In WebKit Kitsilano dry `s1-6`, leaving the signal at West Broadway
  and Larch Street side by side with the driven car, `car_10` did so into it.

- In the seeded V8 and WebKit benchmarks Rules passes all 70 routes in each engine, as before,
  with no collision, red-light or stop-sign violation or failure to yield, and the same seven
  deadlock overrides (Toronto 4, Ottawa 3). Drives slow where junctions without a sign are
  common, from looking at blind ones and giving way: Montréal 25.6 → 17.55 km/h (both engines),
  Winnipeg 36.65 → 33.65, Edmonton 31.15 → 28.5, Saskatoon 29.85 → 26.15 and Québec City
  28.2 → 26.55 (V8); Kitsilano moves
  by at most 0.5 km/h. Traffic giving way shifts other drives both ways: Kitsilano dry `s1-8` and
  fog `s1-4` arrive 36 s and 41 s sooner. The reruns use Node v24.19.0 / V8 and native WebKit on
  macOS 27.0.1. See [docs/rules-baseline.md](docs/rules-baseline.md).

- All-way stops have a turn order, for traffic and the driven car alike. Vehicles go in the order
  they stopped at their lines: a vehicle joins the order when it stops within 6 m of its line (or
  up to 6 m past it, after an overshoot). Two that stop within 1 s of each other go right before
  left, the one on the right first; from opposite sides a left turn (or U-turn) waits for the
  other. From opposite sides two vehicles that are not turning left go together, and so do two
  opposing left turns. A vehicle that has set off on its turn keeps the right of way until it is
  6 m past the junction's centre, so nobody it conflicts with sets off while it is crossing. If
  everyone waits for someone (four cars stopping together, each with one on its right), the first
  to stop goes. Before, traffic at an all-way stop went once nobody was crossing the junction, and
  the driven car ignored cross traffic standing still, so two cars that stopped together pulled out
  together. In three minutes of Toronto (The Annex) traffic alone, 120 cars, crossing cars were
  inside an all-way junction moving at the same time on 49 ticks before and on none after. The
  bundled maps have 270 all-way approaches at 111 junctions, most in Toronto (36 junctions), Ottawa
  (23), Mount Pleasant (13), Calgary (11) and Halifax (9). The driven car counts only vehicles it
  can see; the audit counts crossing the line out of turn as a failure to yield, seen or not.
  Without a route, the driver's turn indicator supplies the intended turn, so an opposing car
  waits for a manual left turn that stopped first.
  Decision models and LLMs get `intersection.priority` (whether the car has stopped at the line,
  whether it is its turn, whom it waits for and who goes first) and a situation line, the motion
  criteria allow holding still while it is not the car's turn, and manoeuvres that cross the line
  then are rejected (`fails_to_yield`). In both seeded V8 and WebKit benchmarks Rules passes
  all 70 routes (70 before in each engine): Kitsilano passes 48 of 48 across four weathers,
  and the city smoke suites 22 of 22.
  The initial implementation timed out on Toronto dry `s1-2` because a retained stop line behind
  the car suppressed deadlock recovery. An incomplete stop now holds the deadlock timer only
  until 3 m past its line; oncoming-traffic waits still hold it. In V8, the route arrives at 176.6 s
  (165.5 s before), with its four deadlock overrides restored; Ottawa's three are unchanged.
  WebKit also retains Toronto's four and Ottawa's three overrides; Toronto `s1-2` arrives at
  164.5 s (176.4 s before). No suite in either engine has a collision, red-light violation,
  stop-sign violation or failure to yield. The reruns use Node v24.19.0 / V8 and native WebKit
  on macOS 27.0.1. See [docs/rules-baseline.md](docs/rules-baseline.md).

- Turning left (or making a U-turn) at a stop sign, the driven car yields to oncoming traffic as at
  a signal, once its stop is made and it is its turn: it waits short of the oncoming lane for a
  vehicle that would arrive before it could clear, including one pulling away from its own stop.
  The audit counts turning in front of such a vehicle as a failure to yield. Decision models and
  LLMs get `intersection.turn` and `intersection.oncoming` at stop signs too.
  Straight and right departures do not trigger the stop-sign oncoming audit; manual left turns
  and U-turns are audited from the actual turn, including missing or misleading indicators.

- New challenge, **Four-way stop** (Toronto, The Annex): straight on through an all-way stop as a
  hesitant driver from the right stops first, a second car queues behind it and reaches the line
  only after the car has stopped, and an oncoming car arrives to turn left. New checks in
  `scripts/test_all_way_stop.mjs`.

- The driven car turns right on red. It is legal across Canada after a full stop, except on the
  island of Montréal, so it is allowed on every bundled map but Le Plateau (a map counts as on the
  island when its centre lies inside a coarse outline of it; `MapData.rightOnRed`). At a red light
  where its route turns right, from the curb lane, the car stops fully at the line (0.7 s within
  6 m of it, as at a stop sign), then turns once nothing it must yield to is in the way: traffic
  from the left that would reach the junction before the car's rear has passed its centre plus
  2 s (about 6 s from a stop), anything moving across the junction, a pedestrian on a crosswalk
  ahead or waiting at one whose walk signal comes on within 4 s, and a view along the street to
  its left that falls short of where that traffic would come from, up to the 80 m it can see in
  clear daylight (it looks for that traffic that far, not only within the 60 m other traffic is
  listed for). So fog, rain, snow, darkness and a building on the corner (about a third of
  signalled right turns across the maps) leave it waiting for the green: it does not creep forward
  to look. Once moving past the line it carries on. Traffic cars do the same after a full stop from
  the curb lane, accepting a gap 1.5 s longer than at a stop sign. The audit counts crossing a red
  light's line as legal only after a full stop, on a map that allows it, and if the car turns right,
  judged from the street it is on as routes judge their turns: going on past the junction's centre
  (15 m out) other than by a right turn runs the red at once, and a right turn holds once the car
  leaves the junction (30 m out) on the street it turned into or one that street leads on to, so a
  swerve or lane change on the way straight through does not count, nor does a sharp left or a
  U-turn. Otherwise it ran the red, with or without a route. Cutting off a vehicle from the left during the turn fails to
  yield (due at the junction within 2 s, or catching the car within 2 s down the street both are
  in). Decision models and LLMs get `intersection.turn` ("right") and `intersection.right_on_red`
  (`stop_completed`, `clear` and what it waits for), a situation line, and the motion criteria
  allow moving at a red only when both are true; the LLM system prompt says either turning or
  waiting is allowed. New challenge, **Right on red** (Calgary, Beltline): a red light where two
  cars come from the left 20 m apart on their green, going straight on into the street the car
  turns into. In the seeded V8 benchmark Rules reached a red light where its route turns right 20
  times and turned on red 3 times; 9 of the other 17 times it waited because it could not see far
  enough to its left. New checks in `scripts/test_right_on_red.mjs`.

- Turning left at a signal, the driven car now waits for an oncoming car pulling away from its own
  line on the green, and allows for an oncoming vehicle speeding up. Before, a vehicle under 1 m/s
  did not count and every arrival time assumed a steady speed, so in Edmonton `s1-2` (V8) the car
  turned as `car_30`, in view and signalling a right turn into the same street, set off from its
  line, and they collided in the street both turned into. A vehicle accelerating at more than
  0.3 m/s² now counts from 0.05 m/s, and is assumed to keep accelerating (at most 2.5 m/s²) up to
  its street's limit. It also no longer takes the left indicator of a car pulling out of a parking
  spot ahead, facing the junction, for an oncoming left turn. Without this, the changes above
  shifted Kitsilano dry `s1-8` (V8) so that the car turned left in front of `car_p6`, pulling out
  on the far side of the junction, and they collided in the street both turned into. With both
  changes, the seeded WebKit benchmark passes 70 of 70 routes, as before, and V8 70 of 70 (69
  before: Edmonton `s1-2` now passes); no suite has a collision, red light or failure to yield.
  Victoria `s1-1` is 76 s slower in V8, from an existing stall where a building outline reaches
  into the lane. See [docs/rules-baseline.md](docs/rules-baseline.md). Checks in
  `scripts/test_left_turn.mjs`.

- The driven car yields to oncoming traffic when it turns left (or makes a U-turn) at a signal.
  Before, it turned on a green whatever was coming the other way. It turns in front of an
  oncoming vehicle only if it would clear that vehicle's path 1.5 s before the vehicle gets
  there (0.75 s once it is moving through the turn). Otherwise it waits 1.5 m short of the
  innermost oncoming lane: at the line, or inside the junction if it is already in it. It goes
  once the gap is long enough or oncoming traffic stops for the light. It carries on through if
  it can no longer stop short of that lane. Only vehicles it can see count. An oncoming car
  signalling its own left turn from its leftmost lane near the junction, braking to stop short of
  the junction, or travelling the other way along the street the car turns into does not count. Decision models and LLMs get
  `intersection.turn` and `intersection.oncoming`, a situation line and a `stop_for_oncoming`
  candidate; manoeuvres that would cross that lane are rejected (`fails_to_yield_to_oncoming`).
  The audit counts a failure to yield when, past a signal's line, the car's front enters the path
  of an oncoming vehicle due at the junction within 2 s, seen or not. The path is the lanes that
  vehicle is following, so going straight on or turning right never counts. It applies to every
  drive, manual and free drives included, so the coaching score now penalises it. A car more than
  3 m past the line when the light changes clears the junction. Before, every manoeuvre was rejected as running the red, so it braked to a
  stop where it was. Nearer the line it still holds for the red. New challenge, **The unprotected
  left** (Ottawa, Centretown): a left turn on a green as two oncoming cars 20 m apart reach the
  junction. In the seeded WebKit benchmark Kitsilano passes 48 of 48 routes across four weathers
  (47 before; fog `s1-4`, a left turn on a green into an oncoming car, now passes) and the city
  smoke suites 22 of 22, and the four deadlock overrides in Kitsilano snow are gone. See
  [docs/rules-baseline.md](docs/rules-baseline.md). New checks in `scripts/test_left_turn.mjs`.

- Traffic no longer pulls out of a parking spot into the driven car. A car parked close behind
  another could not move off when its gap check passed: the car in front held it still while its
  merge ran out the clock, and it pulled out over three seconds later, with the driven car about
  10 m behind. A car pulling out now checks for a gap on every tick until it is actually moving,
  and with someone coming it goes back to waiting at the curb, indicator on; it stays a pull-out,
  signalling, until it moves, however long the car in front holds it. The driven car also counts
  as arrived when it has stopped on its route, in the route's lane, within 10 m of its destination,
  and every manoeuvre along that lane that would get it closer hits a parked car or static
  scenery; the arrival event names it (`blocked_by`). Traffic in the way, a red light, a parked car
  in another lane or a car off its route does not count. In the seeded WebKit benchmark Kitsilano passes 47 of 48 routes across four
  weathers (46 before) and the city smoke suites 22 of 22 (20 before): Kitsilano rain `s1-2` and
  `s1-5` and Calgary and Halifax `s1-1` pass, and Kitsilano fog `s1-4` newly fails, a left turn
  on a green into a car coming the other way, because Rules does not yield to oncoming traffic at
  a signal. See [docs/rules-baseline.md](docs/rules-baseline.md). New checks in
  `scripts/test_pull_out.mjs`.

- The driven car no longer crashes into lamp, sign and signal posts standing in its lane. On
  two-way streets with more lanes one way than the other (378 directed segments in eleven of the
  twelve maps, among them Belleville Street in Victoria, Bloor Street West, Gladstone Avenue and
  8 Street SW), the lanes sat either side of the mapped centreline but the asphalt was centred on it, so
  the outer lane on the wider side ran past the curb: the car drove over the curb line, counted as
  off-road there, and hit the curbside posts. Each side's asphalt now ends beyond its own lanes
  (map pack v6). The committed packs were upgraded in place by `scripts/migrate_packs.py`, without
  new OSM data, which also moved back 202 signal and 2 stop lines set back from those curbs.
  Separately, posts and trees no longer stand in any lane or on any asphalt: a slip road leaving
  at a shallow angle or a street continuing wider past a junction (Québec City's `sig3`) used to
  put some there. They move outward, a signal pole to the near side of the junction when the far
  side has no room, or are left out (4 of 1,127 signal poles, 27 lamp posts, 13 sign posts, 4
  trees). The deadlock creep now looks ahead first and does not drive into static scenery, and
  rechecks each second while it runs. In the seeded WebKit benchmark, `s1-1` passes in Ottawa,
  Québec City, Toronto and Victoria, Kitsilano passes 46 of 48 routes across four weathers (44
  before) and the city smoke suites 20 of 22 (16 before); Kitsilano rain `s1-2` and `s1-5` and
  Halifax `s1-1` newly fail. See [docs/rules-baseline.md](docs/rules-baseline.md). New checks in
  `scripts/test_scenery_collision.mjs`; `scripts/bench_node.mjs` runs the bench suites under Node.

- The driven car gets into the turn lane early. The router takes the left lane on the block before
  a left turn, so its route line used to slide the car across the lanes inside the junction before
  that block, without a signal or a gap check. That happens at 547 junctions across the twelve
  maps. Now, from 150 m before the route moves across, that lane counts as the route's lane: the car
  signals, changes into it with the gap checks lane changes already use, and holds it while the
  route line moves over (lane laws are measured against where the route was when they were chosen).
  Without a gap it slows and waits, and it must be across before the turn. A slow or stopped car in
  the turn lane within 150 m of the turn is treated as a queue and not passed, and Rules doesn't
  drive past such a queue in the next lane, because the extra speed there gains nothing. Decision
  models and LLMs are told the route moves to that lane for the turn and get a
  `change_*` candidate described as a change "for the turn ahead". Junctions where the lane count
  or layout changes still slide across as before. The public demo's browser router now picks each
  street's lane the way the server does (the left lane before a left turn, otherwise the right), so
  demo drives prepare for turns too; before, it moved into the turn lane only at the turn itself.
  More checks in `scripts/test_lane_change.mjs`.

- The driven car changes lanes. On streets with more than one lane in its direction, a
  `change_left_*` or `change_right_*` manoeuvre is offered to pass a stopped vehicle, cyclist,
  open door, parking car or traffic at least 2.5 m/s slower, and then to return to the route's
  lane. A change needs a gap in the target lane (6 m plus 2 s of closing speed ahead, 6 m plus
  2.5 s behind, nothing alongside), at least 80 m of lane beside the route for a pass, and no stop
  line within 25 m. The car signals and eases across over about 3.5 s (18–50 m), more sharply
  (down to 12 m) when the lane it is leaving is about to end. Manoeuvres that would leave it
  outside its route's lane too close to where that lane ends (a turn, a change in the lanes or the
  destination) are rejected, so without a gap it slows and waits. Stops, hard braking and the
  deadlock creep keep or return to the car's lane instead of steering for the route's. Rules
  counts a change and time outside the route's lane as small costs, and abandons a change under
  way only when finishing it is no longer safe. Decision models and LLMs get a `lanes` block (the
  car's lane, the route's lane, the gaps on either side and `return_within_m`) and a situation line
  when a pass or return is on offer; the LLM system prompt says when to choose one. Bench lane
  keeping is now measured from the centre of the lane the car is in or moving into, and runs
  report `lane_changes`. New check: `scripts/test_lane_change.mjs`.

- Decision models are the second of three driver pillars: **Rules | Decision ▾ | LLM ▾** in the
  HUD (keys `2`, `1`, `3`). A decision model answers typed questions with probabilities, as Jev
  does; besides the built-in Jev, any endpoint that speaks TypeSafe's System One protocol becomes a
  driver `decision:<name>`: OpenRouter's Decisions API (Perplexity Decider, Liquid d1, Microsoft
  Decision 1, Jev and others), llama.cpp 0.6.0+ for local open models, or any compatible server.
  Each gets exactly the state and questions Jev gets. **Connect a model** now has Decision models
  and LLMs tabs. On the Decision tab, a TypeSafe key is saved as `TYPESAFE_API_KEY` and turns Jev
  on without a restart (another Jev version, such as `jev-preview`, becomes its own driver);
  OpenRouter's decision catalog loads without a key, with prices, and its key is the same
  `OPENROUTER_API_KEY` the LLM tab uses, so saving it in either tab enables both. The server checks
  every answer against the offered options; unusable answers, HTTP errors (including OpenRouter's
  402 for exhausted credits), timeouts and an exhausted budget fall back to Rules, and calls that
  happened still count. Cost uses the provider's `usage.cost` when reported, else configured
  prices. Configure by hand in the gitignored `data/decision-endpoints.json` (template:
  `data/decision-endpoints.example.json`). Decision drivers appear in Settings, challenges, replay
  branches, the arena and `/bench`. The built-in `jev` driver still calls TypeSafe directly, so
  saved replays and runs keep their meaning. Tested only against a local mock server, not against
  TypeSafe, OpenRouter or llama.cpp. The pillar buttons now take the full width of the HUD panel,
  with the autopilot switch below them. LLM and decision endpoints share one transport
  (`jev/endpoints.py`): no redirects, one total deadline, key scrubbing and per-endpoint key
  snapshots.

- Bring your own LLM: an endpoint driver that speaks the OpenAI Chat Completions protocol, so it
  should work with OpenAI, OpenRouter, Groq, vLLM, LM Studio, Ollama and others; it has been
  tested only against a local mock server, not a real provider. **LLM** sits next to Rules and Jev
  (key `3`), with a ▾ menu to switch models. **Connect a model** sets one up in the app: pick a
  provider, paste a key, choose from the provider's model list (OpenRouter's includes prices) and
  save. The server writes the key to `.env` (only if it is gitignored and untracked) and the endpoint
  to `data/llm-endpoints.json`, then reloads; the key never returns to the browser, and a saved key is
  never sent to a URL other than its provider's. Or configure several by hand in the gitignored
  `data/llm-endpoints.json` (template: `data/llm-endpoints.example.json`) or one with
  `JEV_FSD_LLM_*` in `.env`; each becomes a selectable driver `llm:<name>` in Settings, challenges,
  replay branches, the arena and `/bench`, labelled ready, unreachable, key rejected or no key.
  Keys and the choice of destination stay on the server (the browser sees only a
  credential-stripped base URL), and the configured key value is scrubbed from responses, traces
  and errors. The model picks among safety-checked candidates only and falls back to Rules (with
  the reason in the HUD and arena timelines) on invalid output, timeouts, HTTP errors or an
  exhausted budget; unusable replies still count their calls, tokens and cost. `timeout_s` is one
  real deadline per decision, covering the TCP connect, any proxy tunnel, the TLS handshake, the
  whole reply and a plain retry when an endpoint rejects structured output; only DNS resolution is
  left to the system resolver.
  Calls share `JEV_FSD_BUDGET_USD` and `JEV_FSD_RPM`; optional per-endpoint prices give costs,
  otherwise tokens are reported with an unknown ($0) cost that the budget cannot stop, and
  `rpm: 0` removes the rate limit too. The prompt lives in `static/js/brain/llm-prompt.js`;
  Inspect JSON shows the messages, raw reply and a curl. No new dependencies.

- Graphics artifact fixes. Sun shadows filter without screen-space noise, removing the crawling dot
  pattern inside tree crowns and other partial shadows. Leaf shadows sway with the leaves, leaf
  cards keep their crown shading on both faces, and crown interiors read as shaded foliage instead
  of a dark ball. Leaf textures keep their colour and roughly their coverage at a distance, so far
  trees no longer thin out or darken. Clouds fade detail that is too fine to draw near the horizon, wet-road
  reflections smear smoothly instead of in blocks, and snowflakes are round and size-capped.
- The High preset renders the scene and wet-road reflection with 4x multisampling and
  alpha-to-coverage foliage edges. Frame-time cost has not been measured against a baseline.

- Four new bundled neighbourhoods: Downtown Halifax, Winnipeg's Exchange District, Old Strathcona
  in Edmonton and Downtown & Nutana in Saskatoon. Twelve neighbourhoods across eleven Canadian
  cities, each with its own facade palette and a stylized silhouette (Citadel Hill, a prairie
  glass spire, a river-valley truss bridge, a riverside château and arched bridge).
- Map processing skips roofed streets and raised skywalk footprints, joins roundabouts split
  across several OSM ways, and keeps large roundabout lanes on their mapped carriageway.

- Re-baselined the seeded Rules benchmark on the current code. Kitsilano ran in dry, fog,
  rain and snow, and seven other cities ran smoke suites. The new committed run is
  `data/runs/20261014-091959-rules.json`. In the eight seeded dry suites tested in WebKit,
  `bbc9012` and `62fe050` produced identical summaries and per-route results, excluding wall
  time. On `62fe050`, Kitsilano dry scored 11/12 in WebKit and 10/12 in Node 22.23.2 (V8); the
  numerical cause was not traced. See [docs/rules-baseline.md](docs/rules-baseline.md).

- CI runs every check on each pull request: Python tests, all Node checks, Jev fixture drift,
  offline Jev requests, and the `/tests`, renderer and arena suites in headless Chromium
  (`scripts/test_browser_pages.py`). The Pages demo builds only after they pass.
- Fixed the renderer assertions, which crashed after the cloud deck was added because the
  render-loop test double had no sky.

- Procedural, drifting cloud deck in the sky, lit from the sun's side with a silver rim near the
  sun. Coverage follows the weather (scattered when dry, overcast in rain and snow, hidden in fog);
  clouds take the sun's colour at dusk and the city's glow at night, and appear in reflections.
- Colour-grade pass on High and Ultra: contrast, saturation, a time-of-day tint, soft vignette and
  dithering that removes sky banding.
- Cinematic camera (`C`): automatic cuts between roadside, bumper, aerial, lead and side-profile shots.
- Photo mode (`O` or **Photo mode**): pause the world, hide the HUD, choose a camera, adjust exposure,
  contrast, saturation, vignette and time of day, and save the frame as a PNG.
- README rewritten as a friendlier introduction and quick-start guide.

- Replay playback follows recorded timestamps, preserves its position when paused,
  catches up after slow frames and restarts from the beginning after reaching the end.
- Held driving keys clear when focus enters forms or dialogs, or the tab becomes hidden;
  editable fields and focused controls retain their keyboard behaviour.
- Drive reports and history remain usable when the browser blocks access to local storage.

- Comment cleanup across simulation, brain and render modules: shorter headers, removed
  redundant labels, fixed a stale snow grip note, dropped a dead candidate stub and unused
  NPC stop-line local. Normalized Python section banners and aligned the stdlib User-Agent
  with 0.2.0. Tightened CSP after vendoring Three.js; fixed Node static-collision imports so
  the document stub runs before `common.js`. README and docs test counts match the current suite;
  `pyproject.toml` points at this project's docs and demo.

- Saved agent evaluations with browser history, v1/v2 JSON import, selectable baseline drivers
  and deltas restricted to matching experiment conditions. Stopped and ambiguous attempts are excluded.
- Arena incident timelines with the most recent recorded decision, observed state, selected
  manoeuvre, candidate rejection reasons, emergency brakes, fallbacks and termination events.
- Two new deterministic challenges: a car merging from parking and a person emerging from
  behind a mapped building. Suite version 2; Rain check version 2 fixes its initial pedestrian hold.

- Drive Lab welcome screen with scenic drives, AI demonstrations and six fixed driving challenges.
- Geometric perception overlay with visibility, hidden-object inspection and candidate rejection reasons.
- Recorded drive checkpoints with interpolated playback, incident seeking, manual takeovers,
  driver changes and revalidated alternate manoeuvres. Replay branches and modified challenges are labelled.
- Shareable PNG score cards, reproducible challenge links and manual-arrival reports.
- Extensible agent registry, cautious starter agent, safety-checked adapter loading and a local
  evaluation arena with versioned JSON exports.
- Static GitHub Pages demo with all eight bundled maps and browser-side routing; no server or key required.
- Quieter default telemetry, distinct city facade palettes and decorative city silhouettes.
- Shorter README, new demo media and guides for replay, adapters and Pages deployment.

- Movable 360° camera follows the selected vehicle with mouse/touch orbit, wheel/pinch zoom,
  camera buttons, keyboard rotation and recentering. Existing fixed camera views remain available.

- Six selectable vehicle models and paint colours, with distinct proportions, detailed wheels,
  glazing, mirrors, lighting and trim. Driven vehicle dimensions and handling feed physics,
  stopping distances, traffic gaps, collision checks and cameras.
- Tree trunks, signposts, signal poles, lamps, porches and hedges share scenery placement with
  collision geometry; collision feedback identifies the struck object.

- Eight bundled neighbourhoods across seven Canadian cities, including Mount Pleasant, Calgary
  Beltline, Ottawa Centretown and Québec City Saint-Roch. Searchable, filterable world explorer
  with loading states, retries and preserved keyboard focus.
- Mapped buildings block the driven car and candidate predictions with swept footprint checks.
  Route-aware stop memory fixes indefinite waits when the front bumper reaches a stop line
  before the rear axle reaches the controlled segment; off-route driving retains lane auditing.
- Darkness limits forward and peripheral sensing and feeds speed planning. Fixed, real-time
  and accelerated daylight clocks; traffic density, repeatable world seeds and visible pause.
- Bundled Three.js runtime removes CDN startup dependency. A larger local-server request queue
  handles cold asset bursts, and startup failures show an actionable retry instead of an endless spinner.

- Redesigned trip and drive-coach cards, central driving instruments, a live decision summary,
  Settings and keyboard help. Manual drivers now receive turn-by-turn route guidance.
- Scrollable HUD columns and a narrow-screen inspector entry point; keyboard-accessible brain
  buttons, accurate fallback/stop labels, reduced-motion support and opaque instruments.
  HUD text refreshes at most 10 times per second and skips unchanged DOM writes.

- Bundled city selection for Vancouver, Victoria, Toronto and Montréal, with reachable suggested
  drives from the current pose and selected-city routing, benchmarks and replay.
- Live drive scoring for manual and autopilot drives, with category breakdowns, grades, coaching,
  event timelines, JSON export and local history. Waiting and pauses carry no penalty.
- Instanced street-name and speed-limit signs, optional procedural driving audio, indicators,
  a horn, speed warnings, hood-view rain/wipers and optional camera motion.
- Visual interpolation and speed-sensitive keyboard steering. Distance-based scenery detail and
  lighter high-quality GPU budgets; stable ground depth, synchronized shadows and a fix for wet
  reflection texture feedback loops. Measured rendering comparisons are documented separately.

- Building footprints occlude the ego's observations, predictions, and emergency brake. Fog,
  rain, and snow shorten sensing range; signal phases outside sight are unknown. Speed planning
  and candidate filtering use visible stopping room, including blind bends.
- Traffic can reserve a vacant curb bay and park at low speed. Parked cars open animated
  street-side doors with matching collision shapes; traffic reacts to the panels.
- Pull-outs leave more room for approaching traffic. NPC path recovery preserves the moving
  body's position and velocity.
- Jev weighs progress, clearance, comfort, roadside activity, and driving style instead of being
  directed to copy the Rules target-speed preference. Mid-block crossings distinguish approach,
  hold, and clearing the car's path. Candidates report comfort and clearance estimates.
- Eleven committed decision cases are generated through the actual driver pipeline. The snapshot
  checker validates requests offline and checks model expectations when a key is available.
- Live Jev behavior remains unverified; historical benchmark numbers describe the earlier world.

## 0.2.0

A large realism and graphics update. The Rules benchmark (seed 1) still passes 12 of 12 drives in
dry, rain, fog, and snow.

### Graphics
- Time of day with the sun's real path over Vancouver, a dawn and dusk sky, stars, and a moon.
- Ambient occlusion, bloom, and antialiasing, with low, high, and ultra quality settings.
- After dark: street lights with light pools, headlights (real beams on the driven car), tail
  lights, and lit windows. Wet roads mirror the street.
- New trees (leafy crowns that sway and cast dappled shadows), rounder cars with better lights,
  jointed pedestrians and helmeted cyclists, porches, chimneys and hedges, raised curbs, and
  pedestrian signal heads. A hood camera.
- The North Shore mountains, English Bay, downtown, Stanley Park, and the city around the map.

### Simulation
- Signal timing plans from approach speeds (ITE yellow, clearance all-red, walk and flashing hand).
- Drivers with individual temperaments; traffic waits for a gap at two-way stops and backs off from
  nose-to-nose standoffs. Parked cars sometimes pull out.
- Pedestrians sometimes cross mid-block, react to cars that will not stop, and walk at different
  speeds; fewer are out at night.
- Power-limited acceleration, drag, and rolling resistance in the car model.
- The planner anticipates lower speed limits, approaches stops at the target speed, and no longer
  treats a passing oncoming car as the car ahead.

### Fixed
- Traffic could pull out of a two-way stop in front of oncoming cars.
- Two cars could wait for each other indefinitely.
- The chase camera could jump when frames were advanced by hand in headless runs.

### Project
- New Rules baseline run, a new README, and 11 new browser tests.

## 0.1.0

First release: the simulator, the Jev and Rules drivers, the decision panel, and the benchmark.
