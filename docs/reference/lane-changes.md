# Lane changes and turn lanes

On streets with more than one lane in its direction, the car can change lanes. A change into
the next lane is offered to pass a vehicle ahead that is stopped, is a cyclist, door or parking
car, or is at least 2.5 m/s slower than the car would drive. A pass needs at least 80 m of lane
beside the route, no stop line within 25 m and no queue at a junction just ahead. While the car is
outside its route's lane, a return is offered except in the 8 m before a stop line. A change needs
a gap in the target lane: 6 m plus 2 s of closing speed to the vehicle ahead and 6 m plus 2.5 s to
the one behind, and nothing alongside. The car signals and eases across over about 3.5 s of travel
(18–50 m), or more sharply (down to 12 m) to finish before the lane it is leaving ends; with less
room than that it waits. Any manoeuvre that would keep the car outside its route's lane too close to where that
lane ends is rejected. That point can be a turn, a junction where the lanes change, or the
destination. Without a gap the car slows in its lane and waits. Rules weighs a lane change and
time outside the route's lane as small costs, so it passes only for a clear gain and returns once
there is room. Abandoning a change already under way is offered but costs more, so Rules finishes
a change unless finishing it is no longer safe. Decision models and LLMs see the lanes and the gaps beside the car, and the
situation tells them when a change is on offer.

Before a turn the router takes the turn lane on the last block, so its route line slides across
the lanes at the junction before that block. The car does not follow that slide. From 150 m before
it, the turn lane counts as the route's lane, so the car signals and changes into it with the same
gap checks, then holds it while the route line moves across. It has to be in the lane before the
turn. A slow or stopped car in the turn lane within 150 m of the turn is treated as a queue: the car
doesn't pass it, and Rules doesn't drive past it in the next lane, because that lane's extra speed
gains nothing. This applies where the block before the turn continues the street straight on with
the same lanes; where the lane count or layout changes at that junction, the route line still
slides across inside it.
