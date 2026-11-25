# Rendering and visuals

This batch improves the browser renderer, cameras, weather, minimap, and feature cues. It adds
focused coverage for existing rendering behavior as well as the changes listed below. The
Chromium renderer suite runs through the browser page checks.

1. Lock the east-up-south transformation used by scene objects. Validated by: Chromium renderer regression suite.
2. Omit zero-area triangles from scenery geometry. Validated by: Chromium renderer regression suite.
3. Keep UVs on their vertices when reversing triangle winding. Validated by: Chromium renderer regression suite.
4. Use the requested polygon height for points with extra coordinates. Validated by: Chromium renderer regression suite.
5. Cover triangulation of concave scenery footprints. Validated by: Chromium renderer regression suite.
6. Keep ribbon width at duplicated polyline endpoints. Validated by: Chromium renderer regression suite.
7. Cover fractional ribbon clipping without resetting texture phase. Validated by: Chromium renderer regression suite.
8. Skip ribbons with an inverted clipping interval. Validated by: Chromium renderer regression suite.
9. Keep wall textures level as height changes. Validated by: Chromium renderer regression suite.
10. Keep an invalid zoom delta from corrupting the orbit rig. Validated by: Chromium renderer regression suite.
11. Give the orbit camera clearance around a long vehicle. Validated by: Chromium renderer regression suite.
12. Centre the orbit on vehicles with no rear overhang. Validated by: Chromium renderer regression suite.
13. Limit the roadside camera lead at high vehicle speeds. Validated by: Chromium renderer regression suite.
14. Hold the roadside composition through its minimum shot length. Validated by: Chromium renderer regression suite.
15. Cut as soon as a completed roadside pass reaches its minimum duration. Validated by: Chromium renderer regression suite.
16. Frame the bumper chase behind the rear axle. Validated by: Chromium renderer regression suite.
17. Aim the aerial shot at the middle of the vehicle cabin. Validated by: Chromium renderer regression suite.
18. Cover the aerial camera's angular speed independent of vehicle motion. Validated by: Chromium renderer regression suite.
19. Keep the roadside rig planted when the vehicle turns mid-shot. Validated by: Chromium renderer regression suite.
20. Centre the lead shot on the body of vehicles with no rear overhang. Validated by: Chromium renderer regression suite.
21. Place the profile view to the left of the actual vehicle heading. Validated by: Chromium renderer regression suite.
22. Give the narrow profile shot a tighter field of view than the bumper camera. Validated by: Chromium renderer regression suite.
23. Fall back to the chase rig when a camera name is unknown. Validated by: Chromium renderer regression suite.
24. Cover the hood rig's acceleration pitch and lateral roll. Validated by: Chromium renderer regression suite.
25. Clear stored hood movement when camera motion is disabled. Validated by: Chromium renderer regression suite.
26. Cover north-up alignment of the overhead camera. Validated by: Chromium renderer regression suite.
27. Snap directly to a distant camera when changing modes on a paused frame. Validated by: Chromium renderer regression suite.
28. Cover wet-road darkening and gloss without affecting roof roughness. Validated by: Chromium renderer regression suite.
29. Keep untagged surfaces out of weather recolouring. Validated by: Chromium renderer regression suite.
30. Populate the rain buffer before the next animation frame. Validated by: Chromium renderer regression suite.
31. Align streak lean with falling rain and its wind direction. Validated by: Chromium renderer regression suite.
32. Keep live rain particles and their phase when reapplying rain. Validated by: Chromium renderer regression suite.
33. Cover repeatable wet tint on materials shared by multiple meshes. Validated by: Chromium renderer regression suite.
34. Mark streaming rain and snow vertices as dynamic GPU data. Validated by: Chromium renderer regression suite.
35. Release obsolete weather particle resources on a weather change. Validated by: Chromium renderer regression suite.
36. Cover the plowed-road snow level relative to rooftop accumulation. Validated by: Chromium renderer regression suite.
37. Keep snowfall around elevated camera views. Validated by: Chromium renderer regression suite.
38. Recycle snow around the new viewing area after a camera jump. Validated by: Chromium renderer regression suite.
39. Keep shared flake textures alive when removing a snow particle system. Validated by: Chromium renderer regression suite.
40. Render fog without precipitation and with partial wet sheen. Validated by: Chromium renderer regression suite.
41. Use dry weather for names inherited from the JavaScript object prototype. Validated by: Chromium renderer regression suite.
42. Cover clean restoration of dry material colours and snow weights. Validated by: Chromium renderer regression suite.
43. Reproduce precipitation placement at a fixed camera and weather time. Validated by: Chromium renderer regression suite.
44. Cover the daytime to nighttime switch in sky and key-light levels. Validated by: Chromium renderer regression suite.
45. Cover the fog preset's cloud-deck suppression and stronger distance attenuation. Validated by: Chromium renderer regression suite.
46. Cover reversible minimap coordinates with north toward the top. Validated by: Chromium renderer regression suite.
47. Convert pointer positions at CSS scale to geographic destinations. Validated by: Chromium renderer regression suite.
48. Ignore destination clicks in the minimap's letterboxing. Validated by: Chromium renderer regression suite.
49. Ignore destination clicks while the minimap has no visible size. Validated by: Chromium renderer regression suite.
50. Distinguish the road network bounds from the minimap margin. Validated by: Chromium renderer regression suite.
51. Draw green groundcover for mapped gardens and parks. Validated by: Chromium renderer regression suite.
52. Draw mapped standing water in blue. Validated by: Chromium renderer regression suite.
53. Draw linear waterways independently of area polygons. Validated by: Chromium renderer regression suite.
54. Show mapped railway alignment as a dashed line. Validated by: Chromium renderer regression suite.
55. Keep major streets visible where residential roads overlap. Validated by: Chromium renderer regression suite.
56. Reuse the minimap route path while its points stay the same. Validated by: Chromium renderer regression suite.
57. Outline the route so it remains distinguishable from underlying lines. Validated by: Chromium renderer regression suite.
58. Mark the exact destination inside its target ring. Validated by: Chromium renderer regression suite.
59. Outline the ego arrow against bright roads and overlays. Validated by: Chromium renderer regression suite.
60. Drop the cached minimap path when clearing the route. Validated by: Chromium renderer regression suite.
61. Reuse unchanged 3D route geometry on repeated route updates. Validated by: Chromium renderer regression suite.
62. Cover route removal and its GPU geometry release. Validated by: Chromium renderer regression suite.
63. Show the endpoint without creating a mesh for a zero-length route. Validated by: Chromium renderer regression suite.
64. Batch candidate ribbons of the same status into one draw call. Validated by: Chromium renderer regression suite.
65. Cover distinct visual treatment for flagged and rejected paths. Validated by: Chromium renderer regression suite.
66. Cover selected candidate order and width when the selected path was flagged. Validated by: Chromium renderer regression suite.
67. Keep candidate overlays occluded by vehicles without writing their own depth. Validated by: Chromium renderer regression suite.
68. Cover releasing candidate buffers when their display is turned off. Validated by: Chromium renderer regression suite.
69. Cover hiding the playground ball before it emerges. Validated by: Chromium renderer regression suite.
70. Reflect accumulated spin when a rolling ball first appears during replay. Validated by: Chromium renderer regression suite.
71. Use round shading with sharp colour panels on the playground ball. Validated by: Chromium renderer regression suite.
72. Cover squashing a run-over ball against the ground. Validated by: Chromium renderer regression suite.
73. Restore the ball's round profile and roll angle on replay rewind. Validated by: Chromium renderer regression suite.
74. Cull a carried ball by its actual position in the child's hands. Validated by: Chromium renderer regression suite.
75. Cover retiring gone balls and their material resources. Validated by: Chromium renderer regression suite.
76. Cover feathered black-ice margins and a visible patch interior. Validated by: Chromium renderer regression suite.
77. Cover coplanar ice below road markings with depth testing. Validated by: Chromium renderer regression suite.
78. Hide stale black-ice geometry after its feature is disabled. Validated by: Chromium renderer regression suite.
79. Cover releasing replaced black-ice buffers after a patch version change. Validated by: Chromium renderer regression suite.
80. Keep closure barricades visible when the decorative tent edge is missing. Validated by: Chromium renderer regression suite.
81. Cover the visible on and off phases of closure lamps. Validated by: Chromium renderer regression suite.
82. Share reusable sign materials across successive road closures. Validated by: Chromium renderer regression suite.
83. Release each removed road closure geometry once despite shared cone parts. Validated by: Chromium renderer regression suite.
84. Cover puddle water resting above potholes and below road markings. Validated by: Chromium renderer regression suite.
85. Emit splash spray only from the wheels actually touching standing water. Validated by: Chromium renderer regression suite.
86. Carry spray in the vehicle's signed direction of motion when it reverses. Validated by: Chromium renderer regression suite.
87. Throw standing water toward the curb on roads with an opposing vehicle heading. Validated by: Chromium renderer regression suite.
88. Upload only active water droplets without writing transparent depth. Validated by: Chromium renderer regression suite.
89. Clear spray and pedestrian flinches from later times on a replay rewind. Validated by: Chromium renderer regression suite.
90. Skip crossover mesh creation on maps with no pedestrian crossovers. Validated by: Chromium renderer regression suite.
91. Orient fixed crossover signs toward the approaching lanes. Validated by: Chromium renderer regression suite.
92. Batch crossover bars as a coplanar road-marking mesh. Validated by: Chromium renderer regression suite.
93. Share synchronized warning light materials only on beacon-equipped crossovers. Validated by: Chromium renderer regression suite.
94. Cover crossover beacon flashing until a pedestrian clears the far curb. Validated by: Chromium renderer regression suite.
95. Skip the singular wet reflection when the camera lies on the ground plane. Validated by: Chromium renderer regression suite.
96. Reflect the world-space camera orientation of a parented rig. Validated by: Chromium renderer regression suite.
97. Clear the reflection sampler when disposing its current render target. Validated by: Chromium renderer regression suite.
98. Cover the ground layer preset on multi-material road geometry. Validated by: Chromium renderer regression suite.
99. Apply alpha-to-coverage to tagged entries on multi-material scenery. Validated by: Chromium renderer regression suite.
100. Keep only the detailed scenery level visible before the first LOD update. Validated by: Chromium renderer regression suite.
