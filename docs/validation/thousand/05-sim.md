# Simulation core

This batch hardens fixed-step physics, spatial queries, parked-car transitions and traffic controls. The inventory includes new regression coverage for independent simulation behaviours. Authored challenges can call `world.parked.openDoor(car, { duration: seconds })` to set a door event's duration.

1. Reject invalid vehicle step durations before mutating the integrator. Validated by: `test_sim_physics_boundaries.mjs`.
2. Leave the physical state untouched on a zero-duration vehicle step. Validated by: `test_sim_physics_boundaries.mjs`.
3. Fail a non-finite vehicle command before applying steering or throttle. Validated by: `test_sim_physics_boundaries.mjs`.
4. Detect a non-finite starting pose before integrating a vehicle. Validated by: `test_sim_physics_boundaries.mjs`.
5. Fall back to global road grip when a local surface returns invalid coefficients. Validated by: `test_sim_physics_boundaries.mjs`.
6. Add regression coverage to keep a true zero-grip patch distinct from missing surface data. Validated by: `test_sim_physics_boundaries.mjs`.
7. Add regression coverage to keep massless bicycles kinematic above the car's dynamic threshold. Validated by: `test_sim_physics_boundaries.mjs`.
8. Add regression coverage to clear residual yaw and lateral velocity when braking reaches a standstill. Validated by: `test_sim_physics_boundaries.mjs`.
9. Add regression coverage to allow explicit reverse from a stationary rear axle. Validated by: `test_sim_physics_boundaries.mjs`.
10. Add regression coverage to keep hard braking opposed to reverse motion. Validated by: `test_sim_physics_boundaries.mjs`.
11. Add regression coverage to bound pure-pursuit lookahead equally in forward and reverse. Validated by: `test_sim_physics_boundaries.mjs`.
12. Add regression coverage to bound lane-change length for crawling and highway approaches. Validated by: `test_sim_physics_boundaries.mjs`.
13. Add regression coverage to respect asymmetric pedal limits in the proportional speed controller. Validated by: `test_sim_physics_boundaries.mjs`.
14. Add regression coverage to report the active upcoming curve and its current braking speed ceiling. Validated by: `test_sim_physics_boundaries.mjs`.
15. Add regression coverage to stop sampling the curve profile at the route endpoint. Validated by: `test_sim_physics_boundaries.mjs`.
16. Add regression coverage to recover the lane centre through a route frame change without including the nudge. Validated by: `test_sim_physics_boundaries.mjs`.
17. Fall back to dry grip for inherited or non-string weather selectors. Validated by: `test_sim_physics_boundaries.mjs`.
18. Add regression coverage to keep the shared weather profile and physical grip in sync across preset changes. Validated by: `test_sim_physics_boundaries.mjs`.
19. Add regression coverage to reduce comfortable stopping speed with weather while keeping full dry emergency demand. Validated by: `test_sim_physics_boundaries.mjs`.
20. Parse trimmed named presets and negative decimal hours. Validated by: `test_sim_physics_boundaries.mjs`.
21. Reject malformed clock strings and inherited time preset names. Validated by: `test_sim_physics_boundaries.mjs`.
22. Add regression coverage to carry positive elapsed time through multiple days and a Sunday rollover. Validated by: `test_sim_physics_boundaries.mjs`.
23. Add regression coverage to ignore an invalid elapsed timestamp without moving the clock anchor. Validated by: `test_sim_physics_boundaries.mjs`.
24. Snap visualization away from an invalid interpolation sample. Validated by: `test_sim_physics_boundaries.mjs`.
25. Use a stable zero heading when capturing render-only actors without a valid heading. Validated by: `test_sim_physics_boundaries.mjs`.
26. Add regression coverage to snap a large in-place heading reset without rendering an artificial turn. Validated by: `test_sim_physics_boundaries.mjs`.
27. Reject invalid world steps before moving traffic or advancing its clock. Validated by: `test_sim_physics_boundaries.mjs`.
28. Stop a driver that writes a non-finite ego pose before the traffic step. Validated by: `test_sim_physics_boundaries.mjs`.
29. Carry current tyre slip into a vehicle clone and let its physics advance independently. Validated by: `test_sim_physics_boundaries.mjs`.
30. Fail a collision query whose close encounter has an invalid pose. Validated by: `test_sim_spatial_queries.mjs`.
31. Compute each box's heading axes once across all collision projections. Validated by: `test_sim_spatial_queries.mjs`.
32. Add regression coverage to preserve collision verdicts for swapped box order in angled encounters. Validated by: `test_sim_spatial_queries.mjs`.
33. Add regression coverage to treat tangent box bodies as contact and distinguish a positive gap. Validated by: `test_sim_spatial_queries.mjs`.
34. Add regression coverage to split collision clearance margins equally between two vehicle footprints. Validated by: `test_sim_spatial_queries.mjs`.
35. Add regression coverage to measure point clearance in the rotated box frame. Validated by: `test_sim_spatial_queries.mjs`.
36. Add regression coverage to separate diagonally offset vehicles whose world-axis bounding boxes overlap. Validated by: `test_sim_spatial_queries.mjs`.
37. Add regression coverage to apply scenery margins to the vehicle half-extents before a circle contact test. Validated by: `test_sim_spatial_queries.mjs`.
38. Add regression coverage to clip pedestrian sight segments to a rotated moving vehicle footprint. Validated by: `test_sim_spatial_queries.mjs`.
39. Build polygon bounds without spreading the vertices into call arguments. Validated by: `test_sim_spatial_queries.mjs`.
40. Ignore malformed polygon vertices when indexing sightline obstructions. Validated by: `test_sim_spatial_queries.mjs`.
41. Add regression coverage to visit static obstacle cells in coordinate order across zero even if the buildings were inserted in reverse. Validated by: `test_sim_spatial_queries.mjs`.
42. Avoid unbounded static grid iteration on non-finite or unsafe pose bounds. Validated by: `test_sim_spatial_queries.mjs`.
43. Add regression coverage to distinguish already-touching scenery from a sweep that first makes contact later. Validated by: `test_sim_spatial_queries.mjs`.
44. Add regression coverage to find visibility blockers across negative and positive spatial grid cells. Validated by: `test_sim_spatial_queries.mjs`.
45. Add regression coverage to treat a ray endpoint inside a building as an obstruction even without a wall crossing. Validated by: `test_sim_spatial_queries.mjs`.
46. Add regression coverage to leave low mapped objects out of the building sightline index. Validated by: `test_sim_spatial_queries.mjs`.
47. Fail closed on invalid sight coordinates without consulting the scene or glare hook. Validated by: `test_sim_spatial_queries.mjs`.
48. Add regression coverage to keep an observer's extended passing reach bounded by daytime weather and glare. Validated by: `test_sim_spatial_queries.mjs`.
49. Reject a sight target when the injected visibility range is not a number. Validated by: `test_sim_spatial_queries.mjs`.
50. Stop visibility sampling once an actor's centre is seen. Validated by: `test_sim_spatial_queries.mjs`.
51. Add regression coverage to retain nose-only and tail-only actor visibility around a building. Validated by: `test_sim_spatial_queries.mjs`.
52. Keep corridor probes independent of the ego's route hint. Validated by: `test_sim_spatial_queries.mjs`.
53. Add regression coverage to sort corridor matches by progress while preserving order at equal distances. Validated by: `test_sim_spatial_queries.mjs`.
54. Add regression coverage to measure corridor occupancy in the lane frame after a road-lane transition. Validated by: `test_sim_spatial_queries.mjs`.
55. Write explicit reservation spans without projecting the bay a second time. Validated by: `test_sim_parked_lifecycle.mjs`.
56. Add regression coverage to derive just the unspecified reservation endpoint from the owner's dimensions. Validated by: `test_sim_parked_lifecycle.mjs`.
57. Keep a duplicate parked-car add from creating a second obstacle or renderer event. Validated by: `test_sim_parked_lifecycle.mjs`.
58. Preserve a replacement bay occupant when removing the previous car. Validated by: `test_sim_parked_lifecycle.mjs`.
59. Keep the unrelated car in a cell when removing a car whose position was edited directly. Validated by: `test_sim_parked_lifecycle.mjs`.
60. Prune the abandoned cell when a parked car crosses the spatial grid boundary. Validated by: `test_sim_parked_lifecycle.mjs`.
61. Keep an attempted move of an unparked car from creating a ghost obstacle. Validated by: `test_sim_parked_lifecycle.mjs`.
62. Add regression coverage to keep neighbouring parked cars in the grid when one is moved to a new cell. Validated by: `test_sim_parked_lifecycle.mjs`.
63. Ignore negative or unbounded parked-car query radii safely. Validated by: `test_sim_parked_lifecycle.mjs`.
64. Add regression coverage to use a precise centre-distance cutoff for a parked car in an adjacent grid cell. Validated by: `test_sim_parked_lifecycle.mjs`.
65. Open no door when an authored parked-car lookup returns no owner. Validated by: `test_sim_parked_lifecycle.mjs`.
66. Place the street-side door hinge using the actual width of its owner. Validated by: `test_sim_parked_lifecycle.mjs`.
67. Update an open door's position immediately when its parked owner moves. Validated by: `test_sim_parked_lifecycle.mjs`.
68. Keep remaining doors in insertion order when the door sweep expires multiple owners. Validated by: `test_sim_parked_lifecycle.mjs`.
69. Add regression coverage to keep a closed street-side panel out of obstacle queries until it swings. Validated by: `test_sim_parked_lifecycle.mjs`.
70. Add regression coverage to protect an active door from losing its owner during the parked-to-traffic transition. Validated by: `test_sim_parked_lifecycle.mjs`.
71. Add regression coverage to mirror the door's streetward swing between left and right curbs. Validated by: `test_sim_parked_lifecycle.mjs`.
72. Add regression coverage to detect actual parked-body intrusion from a yawed pose on a straight curb. Validated by: `test_sim_parked_lifecycle.mjs`.
73. Add regression coverage to apply the same lane-intrusion test to a mirrored left-side parking bay. Validated by: `test_sim_parked_lifecycle.mjs`.
74. Allow authored door events to specify their own duration without changing ordinary door cycles. Validated by: `test_sim_parked_lifecycle.mjs`.
75. Fail closed if an approach's advance phase has a non-finite clock. Validated by: `test_sim_control_boundaries.mjs`.
76. Keep an unmapped approach red during overnight flashing. Validated by: `test_sim_control_boundaries.mjs`.
77. Skip overnight flash selection when any mapped approach edge is missing. Validated by: `test_sim_control_boundaries.mjs`.
78. Add regression coverage to preserve fixed signal timing for negative elapsed time and positive offsets. Validated by: `test_sim_control_boundaries.mjs`.
79. Expose red and amber flashes together without mixing in the normal cycle. Validated by: `test_sim_control_boundaries.mjs`.
80. Return no green countdown for an invalid signal group or elapsed timestamp. Validated by: `test_sim_control_boundaries.mjs`.
81. Choose the nearer of a left arrow and the following regular green after the signal wraps. Validated by: `test_sim_control_boundaries.mjs`.
82. Keep a zero or non-finite physics tick from counting as stop time. Validated by: `test_sim_control_boundaries.mjs`.
83. Add regression coverage to reset stop accumulation when a rolling driver interrupts the full stop. Validated by: `test_sim_control_boundaries.mjs`.
84. Add regression coverage to discard a completed stop after changing from a stop sign to a different signal. Validated by: `test_sim_control_boundaries.mjs`.
85. Preserve distinct outage stop identities when approaches share a source control object. Validated by: `test_sim_control_boundaries.mjs`.
86. Preserve distinct night flash stop identities when approaches share a source control object. Validated by: `test_sim_control_boundaries.mjs`.
87. Reject invalid outage durations before starting a power cut. Validated by: `test_sim_control_boundaries.mjs`.
88. Add regression coverage to return a flashing side street to its two-way stop after power is restored. Validated by: `test_sim_control_boundaries.mjs`.
89. Find an approach when a grouped signal includes a vertex with its own junction ID. Validated by: `test_sim_control_boundaries.mjs`.
90. Skip turn and route geometry work on roads without reserved bus lanes. Validated by: `test_sim_control_boundaries.mjs`.
91. Add regression coverage to continue a Sunday overnight bus reservation into Monday but end it at its exact boundary. Validated by: `test_sim_control_boundaries.mjs`.
92. Add regression coverage to translate a bicycle actor's kind to the reserved lane's permitted vehicle class. Validated by: `test_sim_control_boundaries.mjs`.
93. Add regression coverage to apply the inclusive reserved-bus-lane right-turn distance only to right turns. Validated by: `test_sim_control_boundaries.mjs`.
94. Add regression coverage to check a transit yielding gap in the target lane after applying the bus's curb shift. Validated by: `test_sim_control_boundaries.mjs`.
95. Add regression coverage to hold a transit bus at the curb until its full indicator interval has elapsed. Validated by: `test_sim_control_boundaries.mjs`.
96. Recognize only registered emergency vehicle kinds. Validated by: `test_sim_control_boundaries.mjs`.
97. Ignore a rail actor without a placed track state. Validated by: `test_sim_control_boundaries.mjs`.
98. Prioritize a train occupying the crossing over a zero-ETA approaching train. Validated by: `test_sim_control_boundaries.mjs`.
99. Choose a train's nearest eligible stop even when track stops are unsorted and travel is reversed. Validated by: `test_sim_control_boundaries.mjs`.
100. Add regression coverage to distinguish traffic inside an entry's passing envelope from a vehicle queueing at its own roundabout line. Validated by: `test_sim_control_boundaries.mjs`.
