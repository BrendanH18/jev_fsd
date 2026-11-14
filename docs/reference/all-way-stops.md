# All-way stops

At an all-way stop, vehicles go in the order they stopped at their lines (`static/js/sim/all-way.js`),
for traffic and the driven car alike. A vehicle joins the order when it stops within 6 m of its
line. Two that stop within a second of each other go right before left: the one on the right goes
first, and from opposite sides a left turn waits for the other. From opposite sides, two vehicles
that are not turning left go together, and so do two opposing left turns. A vehicle that has set
off on its turn keeps the right of way until it is 6 m past the junction's centre. If everyone waits
for someone (four cars stopping together), the first to stop goes. The driven car senses only the
vehicles it can see, so it may go before a hidden one; the audit counts going out of turn as a
failure to yield whether or not the car could see who stopped first. Decision models and LLMs get
`intersection.priority` and a situation line. Turning left at a stop sign, once its stop is made and
it is its turn, the car yields to oncoming traffic as at a signal. The stop-sign oncoming audit
applies to left turns and U-turns; a straight or right departure is not an oncoming yield
violation. Without a route, the audit judges the actual turn rather than the indicator.
