# Challenges

Sixty hand-built scenarios, each on a real street with its own authored seed, weather, time of day
and traffic, so every driver meets exactly the same situation. Open the drive lab and choose
**Challenges** to drive one yourself, or to set Rules, a decision model, an LLM or your own agent
loose on it. A challenge also opens directly with `?challenge=<id>` (add `&drive=rules` to watch
Rules drive it).

A pass means arriving with no collision, no red light or stop sign run, no failure to yield, and
less than a second off the road (and, in Squeeze in, parked within 30 cm of the kerb). A good
coaching score on its own doesn't count. How each driver did is in the
[results table](../README.md#results) and [docs/model-results.md](model-results.md).

| Challenge | Where | What it tests |
|---|---|---|
| **Fresh green** | Edmonton, afternoon | Your light turns green as a car on Whyte Avenue runs its red: look both ways and let it clear before you go |
| **Into the sun** | Calgary, October evening | Westbound into a low sun on 17 Avenue SW: slow to what you can see, and find the signal and the person crossing early |
| **Reverse lights** | Calgary, afternoon | A car backs out of a driveway between parked cars as you come along: slow down and give it room to finish |
| **Pothole season** | Montréal, rain | A run of water-filled potholes on Rue Saint-Denis: ease round the ones you can inside your lane, and slow for the one you can't |
| **Chasing the ball** | Vancouver, afternoon | A ball rolls out from between parked cars on West 7th Avenue: slow right down, because a child is about to run out after it |
| **Goose crossing** | Ottawa, afternoon | A family of Canada geese crosses Clemow Avenue between two parks, and one stops in your lane: wait for the last one |
| **Brakes ahead** | Vancouver, rain | The lead car brakes hard on West 6th Avenue: leave room for response and a wet-road stop |
| **Make room** | Vancouver, afternoon | A moving car merges into your gap on West 4th Avenue: ease off and rebuild space |
| **Room to stop** | Vancouver, afternoon | Amber appears on West 4th Avenue with room to stop safely: brake smoothly and wait for green |
| **Keep going safely** | Vancouver, afternoon | Amber appears too close for a safe stop: continue cautiously without accelerating to beat it |
| **The door zone** | Kitsilano, afternoon | A parked car's door opens beside a cyclist |
| **Into the unknown** | Victoria, fog | A junction you can't see across |
| **Rain check** | Montréal, rainy night | A pedestrian crossing in poor light |
| **Winter composure** | Toronto, snow | A full stop on slippery roads |
| **Joining the flow** | Kitsilano | A car pulling out of a parking spot |
| **Around the corner** | Kitsilano | Someone stepping out from behind a building |
| **The unprotected left** | Ottawa, afternoon | A left turn on a green with oncoming cars close together |
| **Left on red** | Calgary, afternoon | A full stop before turning from one-way 14 Avenue SW onto one-way 5 Street SW, yielding to two cars from the right |
| **Right on red** | Calgary, afternoon | A right turn at a red light, with cars coming from the left on their green |
| **Four-way stop** | Toronto, afternoon | Taking your turn at an all-way stop, with cars arriving just before and after you |
| **The blind corner** | Vancouver, afternoon | A two-way stop where a building hides the through road: stop, creep forward to look, and wait for both sides |
| **The right hook** | Vancouver, afternoon | A right turn off a bikeway, with a cyclist coming up in the empty parking lane on your right |
| **Lights and sirens** | Edmonton, afternoon | An ambulance coming up behind you just before a junction: pull over and stop, but not in the junction |
| **Pulling out** | Kitsilano, afternoon | A bus at its stop on West 4th Avenue signals to pull out as you come up behind it: let it go first |
| **The multiple threat** | Kitsilano, afternoon | A car has stopped at a marked crosswalk on West Broadway, in the lane beside yours: don't pass it, because it hides the person it stopped for |
| **Flashing reds** | Kitsilano, afternoon | A school bus coming the other way on West 2nd Avenue has stopped with its red lights flashing: stop, though your side of the road is clear, because a child crosses in front of it |
| **School zone** | Kitsilano, 9 am | West 11th Avenue past an elementary school: its limit is 50 km/h, but the school zone's is 30, and a child runs out between parked cars |
| **Move over** | Winnipeg, afternoon | A tow truck at the curb on Princess Street with its amber lights flashing, beside your lane: slow to 40 and move over, because its operator steps out into that lane |
| **Behind the doors** | Toronto, afternoon | A 511 streetcar at its stop on Bathurst Street with its doors open, in the lane beside yours: stop at least 2 m behind its rear doors, because its riders cross your lane to reach them |
| **Clear the tracks** | Edmonton, afternoon | 106 Street crosses the High Level Bridge Streetcar's tracks with crossbucks alone, and traffic is backed up from 86 Avenue to just past them: never stop on the tracks, and when the streetcar comes ringing, stop at least 5 m back from the nearest rail |
| **Keep the box clear** | Montréal, afternoon | Avenue du Mont-Royal Est meets Rue Saint-Denis at a green light, but traffic is backed up from Rue Rivard to just past the junction: even on a green, wait at the line until there is room for all of your car beyond it |
| **Not your arrow** | Winnipeg, afternoon | Going straight on Isabel Street at a red light, as a green left arrow comes on for the cars waiting to turn beside you: the arrow is for them, so wait for your own green |
| **Follow the flagger** | Ottawa, afternoon | A road crew has closed your lane on Queen Street, and the flagger at your end shows STOP while cars come the other way through the one lane left: wait at the line until the paddle turns to SLOW, then go round the work at 30 km/h |
| **Lights out** | Halifax, afternoon | A storm has knocked out the power, and the lights where Barrington Street meets Morris Street are dark: treat the junction as an all-way stop, and let the car from the right and an oncoming left turn, both there first, go before you |
| **Round the van** | Toronto, afternoon | A delivery van is double-parked in your lane on Brunswick Avenue, hazards flashing, and the only way past is the oncoming lane, where two cars are coming that you can't see yet: stop a car length back, let them by, then go round |
| **Squeeze in** | Vancouver, afternoon | One space is left on a block of West 10th Avenue lined with parked cars, 6.8 m long, and a car comes up behind as you slow for it: signal, pull up alongside the car in front, wait until it's clear behind, then reverse in and park within 30 cm of the kerb |
| **Between the cars** | Vancouver, afternoon | A quiet 50 km/h street in Kitsilano, lined with parked cars on your side, and a child hidden between two of them steps out when you're 15 m away: at about 30 km/h you stop short of them, at 50 you can't |
| **Blind left** | Vancouver, afternoon | A left turn on a green on West 4th Avenue, with a delivery van waiting in the junction opposite to turn left: the lane beside it is hidden behind it, and a car is coming straight through in it. Wait at the edge of the cross street until you can see that lane is clear |
| **Behind the plow** | Winnipeg, afternoon, snow | A city plow is clearing the left lane of William Avenue at 18 km/h, blue and amber lamps flashing, and the right lane beside it is wide open: stay 30 m behind it all the way, and never go by it on the right |
| **Take turns** | Calgary, afternoon | The right lane of 14 Avenue SW is closed for a road crew, the left lane is backed up to the cones, and two cars wait at the merge ahead of you: stay in your lane to the merge point, then take your turn, one car from each lane |
| **Give them room** | Vancouver, afternoon | A cyclist rides out in your lane on the West 10th Avenue bikeway, the kerbs lined with parked cars, one lane each way, and two cars are coming the other way: stay behind until they are by, then pass with at least 1 m and move back in well ahead |
| **Over the humps** | Ottawa, afternoon | Gloucester Street is a 50 km/h one-way with a speed hump across each block, and you set off with a clear run of 80 m to the first: slow to 30 km/h before each hump, cross at an even speed, and pick up again only once your rear wheels are over |
| **All walk** | Victoria, afternoon | You're turning right from Wharf Street onto Government Street, by the Empress, where the signal has a scramble crossing, and it turns red as you arrive: no right on red here, so wait through the all-walk, then let a slow walker finish the diagonal before you turn |
| **Collection day** | Vancouver, afternoon | A garbage truck stands in your lane on West 5th Avenue as one of its crew crosses behind it to the bins on the far side, and two cars come the other way: wait well back until the crew is back and the oncoming lane is clear, then go round slowly |
| **Stop for the guard** | Montréal, morning | A school crossing guard on Rue Berri raises the STOP paddle and walks three children across: stop short of the crosswalk and wait until the guard and every child are off the whole roadway |
| **Wait for the far curb** | Ottawa, afternoon | Metcalfe Street’s Ontario pedestrian crossover: stay stopped until everyone reaches the far curb across the whole roadway, even after your lane clears. |
| **Buses only** | Vancouver, morning | Main Street's curb lane is bus-only from 7:00 to 9:30 on weekdays, and you turn right at the end of the block: keep out of the bus lane, then move into it in the last 50 m before the turn |
| **No left turn** | Toronto, morning | A real OSM no-left-turn sign on Bathurst Street blocks the shortest way to the destination: take a legal detour around the block |
| **After midnight** | Halifax, 01:00 | Morris Street's signal flashes red overnight while Barrington Street's flashes amber: stop fully, then cross once the main street is clear |
| **Both ways** | Montréal, afternoon | Turning into Rue Villeneuve Est, one-way for cars but with a painted lane for cyclists riding the other way: let the cyclist coming out clear the junction first |
| **Dip your lights** | Saskatoon, night | The streetlights are out on 13th Street East: high beams on the empty stretch, dipped within 150 m of an oncoming car and 60 m of the car ahead |
| **Find your gap** | Halifax, afternoon | Yield to three circulating cars at the North Park roundabout, then take the third exit onto North Park Street |
| **Wait for green** | Toronto, afternoon | Harbord Street onto Spadina Avenue: obey the mapped no-turn-on-red sign even when the cross street is empty, then turn on green |
| **On your bumper** | Winnipeg, afternoon | A driver in a hurry sits half a second behind you on William Avenue: don't brake-check them, leave more room ahead, and move right to let them by |
| **Bridges freeze first** | Saskatoon, dawn | Black ice on the Traffic Bridge deck, nearly invisible on a dry road: ease off before the bridge and cross the ice steadily, with no braking or sharp steering on it |
| **One car at a time** | Montréal, snow | Snowbanks narrow Avenue Laval to one moving car: wait while an oncoming car comes through, then creep up to a corner where a high pile hides someone about to cross |
| **Don't splash** | Vancouver, rain | Puddles in the gutter of Main Street, with people waiting at a bus stop and walking beside them: ease left in your lane, or slow right down, so you don't drench anyone |
| **Room to park** | Vancouver, afternoon | The car ahead on Larch Street signals right and stops beside a gap in the parked cars: stop well back, leave it room to reverse in, and wait until it is in |
| **Road closed** | Halifax, afternoon | Spring Garden Road is closed for a street festival: see the barricade, take the detour round by Queen Street, and never drive past a ROAD CLOSED sign |
| **Follow the officer** | Toronto, afternoon | An officer directs traffic where Spadina Avenue meets Bloor Street West: stop when held even on your green, go when waved on even through a red |

Two **road tests** sit beside the challenges: a Class 5-style test in Kitsilano and a G2-style test
in Toronto's Annex, each a longer drive on a fixed route with an examiner's directions and sheet
(see the [README](../README.md#-take-on-the-challenges)).

How challenges are built and checked: [docs/project-reference.md](project-reference.md).
