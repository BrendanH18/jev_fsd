# World rendering

World rendering now batches roads, bus lane paint and signs, prepares less unused scenery, and handles camera, weather, post-processing and minimap transitions more reliably. The checks cover the bundled Kitsilano map and renderer fixtures for geometry, signals, shader configuration and resource lifetime.

1. Reuse precomputed street normals and distances across asphalt, curbs, sidewalks and centre stripes. Validated by: scripts/test_5k_render-world_geometry.mjs.
2. Reuse prepared lane paths across successive dashes on multi-lane roads. Validated by: scripts/test_5k_render-world_geometry.mjs.
3. Find the first intersecting segment by distance when clipping ribbon spans. Validated by: scripts/test_5k_render-world_geometry.mjs.
4. Reuse segment lengths when accumulating the ribbon's distance coordinates. Validated by: scripts/test_5k_render-world_geometry.mjs.
5. Omit ribbons whose span falls entirely outside the line. Validated by: scripts/test_5k_render-world_geometry.mjs.
6. Reject non-finite ribbon offsets and elevations before generating vertices. Validated by: scripts/test_5k_render-world_geometry.mjs.
7. Reject invalid texture scales and clipping limits before generating ribbon UVs. Validated by: scripts/test_5k_render-world_geometry.mjs.
8. Omit a ribbon rather than bridging across a corrupt centreline. Validated by: scripts/test_5k_render-world_geometry.mjs.
9. Give uncoloured vertices in a tinted geometry batch a neutral white tint. Validated by: scripts/test_5k_render-world_geometry.mjs.
10. Skip triangles whose normals would corrupt the geometry buffer. Validated by: scripts/test_5k_render-world_geometry.mjs.
11. Reject corrupt polygon coordinates, heights and texture scales before filling a surface. Validated by: scripts/test_5k_render-world_geometry.mjs.
12. Bypass the general triangulator for three-point polygons. Validated by: scripts/test_5k_render-world_geometry.mjs.
13. Prevent negative rectangle dimensions from becoming unintended road markings. Validated by: scripts/test_5k_render-world_geometry.mjs.
14. Cull road sections independently in spatial chunks. Validated by: scripts/test_5k_render-world_geometry.mjs.
15. Reuse surface materials across independently culled road sections. Validated by: scripts/test_5k_render-world_geometry.mjs.
16. Defer construction of unused ground surface textures and materials. Validated by: scripts/test_5k_render-world_geometry.mjs.
17. Keep small roundabout islands from growing an inverted grass disk. Validated by: scripts/test_5k_render-world_geometry.mjs.
18. Skip mid-block crosswalks whose road edge has been removed. Validated by: scripts/test_5k_render-world_geometry.mjs.
19. Skip stale scramble IDs before resolving their junctions. Validated by: scripts/test_5k_render-world_geometry.mjs.
20. Reuse marking material construction for white, yellow and scramble paint. Validated by: scripts/test_5k_render-world_geometry.mjs.
21. Skip an empty scramble layer before allocating its paint material. Validated by: scripts/test_5k_render-world_geometry.mjs.
22. Reuse the heading basis across continental and scramble crosswalk bars. Validated by: scripts/test_5k_render-world_geometry.mjs.
23. Skip signal geometry and glow textures on signal-free maps. Validated by: scripts/test_5k_render-world_geometry.mjs.
24. Keep a pole-mounted signal head when no traffic lanes are present. Validated by: scripts/test_5k_render-world_geometry.mjs.
25. Reuse the same approach transform for all signal components and glow sprites. Validated by: scripts/test_5k_render-world_geometry.mjs.
26. Batch fixed signal and sign geometry through one common merge path. Validated by: scripts/test_5k_render-world_geometry.mjs.
27. Skip geometry and textures for absent categories of road signs. Validated by: scripts/test_5k_render-world_geometry.mjs.
28. Reuse the two yield-sign face templates across approaches. Validated by: scripts/test_5k_render-world_geometry.mjs.
29. Cache the rendered pedestrian signal aspect through repeated frame updates. Validated by: scripts/test_5k_render-world_geometry.mjs.
30. Represent vehicle signal aspects with bitmasks to avoid fresh lamp arrays every frame. Validated by: scripts/test_5k_render-world_geometry.mjs.
31. Keep baked road surfaces, signs and mast-arm local matrices out of per-frame updates. Validated by: scripts/test_5k_render-world_geometry.mjs.
32. Keep red bus lane surfacing below white road paint in the opaque draw order. Validated by: scripts/test_5k_render-world_geometry.mjs.
33. Follow curved bus lanes using one continuous batched surface per map. Validated by: scripts/test_5k_render-world_geometry.mjs.
34. Instance the bus lane word and diamond stencils. Validated by: scripts/test_5k_render-world_geometry.mjs.
35. Draw bus stencils with cut-out pixels at the road marking layer. Validated by: scripts/test_5k_render-world_geometry.mjs.
36. Skip bus stencil canvas and texture creation when no lane needs a stencil. Validated by: scripts/test_5k_render-world_geometry.mjs.
37. Accept packs with no bus lane layer. Validated by: scripts/test_5k_render-world_geometry.mjs.
38. Paginate the street-sign atlas without repainting labels repeated across chunks. Validated by: scripts/test_5k_render-world_geometry.mjs.
39. Skip the street-sign canvas on signless maps. Validated by: scripts/test_5k_render-world_geometry.mjs.
40. Share street sign pole geometry across all the map's batches. Validated by: scripts/test_5k_render-world_geometry.mjs.
41. Draw a blank back on speed limit plates. Validated by: scripts/test_5k_render-world_geometry.mjs.
42. Use a safe atlas filter setting when anisotropy is invalid. Validated by: scripts/test_5k_render-world_geometry.mjs.
43. Create street lamp geometry only for models present on the map. Validated by: scripts/test_5k_render-world_geometry.mjs.
44. Allocate at most one real light per lamp on sparse maps. Validated by: scripts/test_5k_render-world_geometry.mjs.
45. Keep the brightest nearby street lights using bounded selection instead of sorting the full map. Validated by: scripts/test_5k_render-world_geometry.mjs.
46. Rank street lights relative to the camera's world position when it has a parent. Validated by: scripts/test_5k_render-world_geometry.mjs.
47. Reselect real street lights immediately after a camera jump or a large direction change. Validated by: scripts/test_5k_render-world_geometry.mjs.
48. Suspend nearest-light selection during an outage and refresh it as soon as power returns. Validated by: scripts/test_5k_render-world_geometry.mjs.
49. Clear daytime point light intensity and reselect at dusk. Validated by: scripts/test_5k_render-world_geometry.mjs.
50. Reuse temporary placement vectors for street lamps and their light pools. Validated by: scripts/test_5k_render-world_geometry.mjs.
51. Fall back to the standard building palette when an override is empty. Validated by: scripts/test_5k_render-world_geometry.mjs.
52. Skip duplicate-point segments when generating roof parapets. Validated by: scripts/test_5k_render-world_geometry.mjs.
53. Create facade and roof materials only when a populated building batch uses them. Validated by: scripts/test_5k_render-world_geometry.mjs.
54. Share the default grass texture for hedges and islands while keeping the ground plane repeat local. Validated by: scripts/test_5k_render-world_geometry.mjs.
55. Give a building footprint index a usable cell width after an invalid override. Validated by: scripts/test_5k_render-world_geometry.mjs.
56. Omit malformed footprints from the scenery query grid. Validated by: scripts/test_5k_render-world_geometry.mjs.
57. Return cleanly for invalid footprint query coordinates or margins. Validated by: scripts/test_5k_render-world_geometry.mjs.
58. Search only the grid cells intersecting the actual footprint query. Validated by: scripts/test_5k_render-world_geometry.mjs.
59. Search occupied cells when a footprint query spans more ground than the index. Validated by: scripts/test_5k_render-world_geometry.mjs.
60. Use squared edge distance for footprint clearance and skip edge projections for containment-only queries. Validated by: scripts/test_5k_render-world_geometry.mjs.
61. Skip trees' geometry and textures on treeless maps. Validated by: scripts/test_5k_render-world_geometry.mjs.
62. Skip foliage textures and distant geometry for tree types absent from the map. Validated by: scripts/test_5k_render-world_geometry.mjs.
63. Generate tree geometry variants only when a chunk uses the variant. Validated by: scripts/test_5k_render-world_geometry.mjs.
64. Reuse vector and quaternion storage when composing tree instances. Validated by: scripts/test_5k_render-world_geometry.mjs.
65. Preserve the offsets of both scenery detail levels when centring an LOD. Validated by: scripts/test_5k_render-world_geometry.mjs.
66. Use a stable switch distance for invalid LOD range overrides. Validated by: scripts/test_5k_render-world_geometry.mjs.
67. Restore the detailed level's visibility when creating an LOD from hidden scenery. Validated by: scripts/test_5k_render-world_geometry.mjs.
68. Include odd cutout texture rows and columns through area-weighted mip filtering. Validated by: scripts/test_5k_render-world_geometry.mjs.
69. Choose transparent-texel colour from the corresponding coarse mip region on non-power-of-two textures. Validated by: scripts/test_5k_render-world_geometry.mjs.
70. Adjust mipmap alpha downward when reduction gives the cutout too much coverage. Validated by: scripts/test_5k_render-world_geometry.mjs.
71. Skip alpha rescaling when a mip level already has the correct coverage. Validated by: scripts/test_5k_render-world_geometry.mjs.
72. Look up sRGB byte conversions while generating cutout mipmaps. Validated by: scripts/test_5k_render-world_geometry.mjs.
73. Use a valid default anisotropy when a texture capability probe returns a non-finite value. Validated by: scripts/test_5k_render-world_geometry.mjs.
74. Reuse placement vectors and colours while instancing distant scenery. Validated by: scripts/test_5k_render-world_geometry.mjs.
75. Skip both sea sampling and sea buffers on an inland map. Validated by: scripts/test_5k_render-world_geometry.mjs.
76. Reuse the cached noise texture for distant water. Validated by: scripts/test_5k_render-world_geometry.mjs.
77. Use a valid fallback geography frame and disable Vancouver-specific layers for malformed origins. Validated by: scripts/test_5k_render-world_geometry.mjs.
78. Keep distant scenery instance matrices static after placement. Validated by: scripts/test_5k_render-world_geometry.mjs.
79. Distinguish real city style IDs from inherited properties. Validated by: scripts/test_5k_render-world_geometry.mjs.
80. Bake each skyline mesh's static placement after setting its rotation and scale. Validated by: scripts/test_5k_render-world_geometry.mjs.
81. Ignore corrupt orbit input on one axis while retaining input on the other. Validated by: scripts/test_5k_render-world_views.mjs.
82. Use a usable orbit distance when the vehicle length is invalid. Validated by: scripts/test_5k_render-world_views.mjs.
83. Use the default look height when an orbit height override is invalid. Validated by: scripts/test_5k_render-world_views.mjs.
84. Place a cinematic roadside camera ahead of a reversing car's actual motion. Validated by: scripts/test_5k_render-world_views.mjs.
85. End the roadside shot relative to its established direction of travel. Validated by: scripts/test_5k_render-world_views.mjs.
86. Keep non-finite frame durations out of the cinematic camera clock. Validated by: scripts/test_5k_render-world_views.mjs.
87. Use a stationary lead distance when the cinematic vehicle speed is invalid. Validated by: scripts/test_5k_render-world_views.mjs.
88. Prevent modification of the cinematic shot sequence through its public list. Validated by: scripts/test_5k_render-world_views.mjs.
89. Treat invalid frame deltas as zero for camera lag and the shader clock. Validated by: scripts/test_5k_render-world_views.mjs.
90. Keep invalid vehicle acceleration out of hood-camera pitch and roll. Validated by: scripts/test_5k_render-world_views.mjs.
91. Avoid rebuilding the projection matrix when the camera field of view stays the same. Validated by: scripts/test_5k_render-world_views.mjs.
92. Represent camera snaps explicitly so a valid origin pose is not a reset signal. Validated by: scripts/test_5k_render-world_views.mjs.
93. Reuse camera target vectors across frames. Validated by: scripts/test_5k_render-world_views.mjs.
94. Reuse vectors for sun shadow-map snapping. Validated by: scripts/test_5k_render-world_views.mjs.
95. Skip unchanged device pixel ratio and backing buffer dimensions on a quality switch. Validated by: scripts/test_5k_render-world_views.mjs.
96. Fall back to a working pixel ratio when device scale is invalid. Validated by: scripts/test_5k_render-world_views.mjs.
97. Release both shadow targets when changing shadow-map resolution. Validated by: scripts/test_5k_render-world_views.mjs.
98. Reapply bloom and grade settings at a quality switch without regenerating the atmosphere. Validated by: scripts/test_5k_render-world_views.mjs.
99. Rebuild an environment probe when its target is missing. Validated by: scripts/test_5k_render-world_views.mjs.
100. Limit extreme exposure offsets to finite values. Validated by: scripts/test_5k_render-world_views.mjs.
101. Ignore photo look keys inherited from the prototype. Validated by: scripts/test_5k_render-world_views.mjs.
102. Use a defined smoothstep direction at the sky horizon. Validated by: scripts/test_5k_render-world_views.mjs.
103. Skip sky noise samples for fully faded-out octaves. Validated by: scripts/test_5k_render-world_views.mjs.
104. Track each visible scenery LOD once and retire its registration when detached. Validated by: scripts/test_5k_render-world_views.mjs.
105. Update alpha-to-coverage on newly added scenery without traversing the entire city. Validated by: scripts/test_5k_render-world_views.mjs.
106. Skip empty material slots during the alpha-to-coverage pass. Validated by: scripts/test_5k_render-world_views.mjs.
107. Unregister disposed night-light materials so later dusk updates release them. Validated by: scripts/test_5k_render-world_views.mjs.
108. Replace duplicate night-light registrations on the same material property. Validated by: scripts/test_5k_render-world_views.mjs.
109. Use the default hour for invalid atmosphere and solar queries. Validated by: scripts/test_5k_render-world_views.mjs.
110. Keep prototype names out of the backdrop's weather tint. Validated by: scripts/test_5k_render-world_views.mjs.
111. Reuse the mountain ridge's peak data across all its samples. Validated by: scripts/test_5k_render-world_views.mjs.
112. Resize the minimap road cache, projection and route path together when its backing canvas changes. Validated by: scripts/test_5k_render-world_views.mjs.
113. Use the same rounded bounds for pointer and keyboard minimap picks. Validated by: scripts/test_5k_render-world_views.mjs.
114. Disable destination picking when the minimap has no drawable extent. Validated by: scripts/test_5k_render-world_views.mjs.
115. Dispose the minimap offscreen canvas and remove its pointer and clear-route listeners. Validated by: scripts/test_5k_render-world_views.mjs.
116. Draw holes in park and water polygons regardless of ring winding. Validated by: scripts/test_5k_render-world_views.mjs.
117. Draw a minimap for packs without a building list. Validated by: scripts/test_5k_render-world_views.mjs.
118. Keep minimap overlays inside the map rectangle. Validated by: scripts/test_5k_render-world_views.mjs.
119. Skip invalid destination and vehicle markers instead of breaking the minimap draw. Validated by: scripts/test_5k_render-world_views.mjs.
120. Keep coplanar route and candidate materials to one transparent geometry pass. Validated by: scripts/test_5k_render-world_views.mjs.
121. Keep the destination beacon hidden for invalid route endpoints. Validated by: scripts/test_5k_render-world_views.mjs.
122. Reuse unchanged candidate geometry until the selected path or candidate array changes. Validated by: scripts/test_5k_render-world_views.mjs.
123. Retain the last valid destination pulse on a malformed frame time. Validated by: scripts/test_5k_render-world_views.mjs.
124. Render both precipitation volumes around the camera's world-space position. Validated by: scripts/test_5k_render-world_views.mjs.
125. Skip uploads when precipitation is paused and the camera stays still. Validated by: scripts/test_5k_render-world_views.mjs.
126. Treat invalid precipitation deltas as zero while still following camera jumps. Validated by: scripts/test_5k_render-world_views.mjs.
127. Preserve material-specific fields when a simple colour material receives weather tint. Validated by: scripts/test_5k_render-world_views.mjs.
128. Ignore inherited weather surface names when assigning snow or wetness. Validated by: scripts/test_5k_render-world_views.mjs.
129. Ignore sparse entries in multi-material meshes during weather updates. Validated by: scripts/test_5k_render-world_views.mjs.
130. Keep one snow uniform and shader patch when an existing material is retagged. Validated by: scripts/test_5k_render-world_views.mjs.
131. Determine snow-facing normals after accounting for non-uniform instance scaling. Validated by: scripts/test_5k_render-world_views.mjs.
132. Preserve the material receiver and earlier shader cache keys when composing shader patches. Validated by: scripts/test_5k_render-world_views.mjs.
133. Request recompilation when retrofitting macro or reflection shading onto a material. Validated by: scripts/test_5k_render-world_views.mjs.
134. Retain zoom and view offsets in the wet reflection projection. Validated by: scripts/test_5k_render-world_views.mjs.
135. Skip an oblique reflection when its clip denominator cannot be used. Validated by: scripts/test_5k_render-world_views.mjs.
136. Restore the previous target, cube face and mip level after the wet reflection pass. Validated by: scripts/test_5k_render-world_views.mjs.
137. Publish a reflection texture and its projection together only after a successful draw. Validated by: scripts/test_5k_render-world_views.mjs.
138. Invalidate the wet reflection sampler when its target is resized or resampled. Validated by: scripts/test_5k_render-world_views.mjs.
139. Make reflection disposal idempotent and prevent use of the disposed render target. Validated by: scripts/test_5k_render-world_views.mjs.
140. Match the AO scene target's attachment to its depth-stencil texture format. Validated by: scripts/test_5k_render-world_views.mjs.
141. Free the two extra GTAO shader materials during AO teardown. Validated by: scripts/test_5k_render-world_views.mjs.
142. Avoid unused depth attachments for colour grading, AO compositing, tone mapping and SMAA. Validated by: scripts/test_5k_render-world_views.mjs.
143. Restore render target and clear settings if post-processing throws. Validated by: scripts/test_5k_render-world_views.mjs.
144. Normalize invalid post-processing dimensions without reallocating unchanged targets. Validated by: scripts/test_5k_render-world_views.mjs.
145. Release post-processing resources once and guard against rendering after teardown. Validated by: scripts/test_5k_render-world_views.mjs.
146. Hide additive streetlamp pools in daylight to avoid drawing transparent geometry at zero opacity. Validated by: scripts/test_5k_render-world_geometry.mjs.
147. Keep streetlamp heads indexed instead of expanding duplicate vertices. Validated by: scripts/test_5k_render-world_geometry.mjs.
148. Avoid updating baked building-chunk local matrices each pass. Validated by: scripts/test_5k_render-world_geometry.mjs.
149. Use a finite default distant haze for unknown weather keys. Validated by: scripts/test_5k_render-world_geometry.mjs.
150. Check that an exact segment start includes just the next interval. Validated by: scripts/test_5k_render-world_geometry.mjs.
151. Check world-aligned ribbon UVs against easting and northing. Validated by: scripts/test_5k_render-world_geometry.mjs.
152. Check that a backtracking polyline still emits finite ribbon joins. Validated by: scripts/test_5k_render-world_geometry.mjs.
153. Check that a straight ribbon emits exactly one upward-facing quad. Validated by: scripts/test_5k_render-world_geometry.mjs.
154. Check that a footprint interior query works in negative grid cells. Validated by: scripts/test_5k_render-world_geometry.mjs.
155. Check that a building footprint query distinguishing near and far points uses metric clearance. Validated by: scripts/test_5k_render-world_geometry.mjs.
156. Check that LOD distance includes the source chunk radius. Validated by: scripts/test_5k_render-world_geometry.mjs.
157. Check that a solid texture keeps its full-resolution sRGB bytes. Validated by: scripts/test_5k_render-world_geometry.mjs.
158. Check that a missing street light layer returns a map with no dynamic light pool. Validated by: scripts/test_5k_render-world_geometry.mjs.
159. Check Vancouver's reference origin against the city scenery bounds. Validated by: scripts/test_5k_render-world_geometry.mjs.
160. Check that distant filler houses still draw as instances for other cities. Validated by: scripts/test_5k_render-world_geometry.mjs.
161. Check that sign atlas pages use sRGB colour space. Validated by: scripts/test_5k_render-world_geometry.mjs.
162. Check that bus tint and stencils neither replace ground depth nor bypass depth testing. Validated by: scripts/test_5k_render-world_geometry.mjs.
163. Check that new signal glow sprites start unlit. Validated by: scripts/test_5k_render-world_geometry.mjs.
164. Check that a protected left keeps the through direction stopped while lighting the left arrow. Validated by: scripts/test_5k_render-world_geometry.mjs.
165. Check that a lit arrow does not tint the signal backing itself. Validated by: scripts/test_5k_render-world_geometry.mjs.
166. Check that the red ball and arrow lights activate the corresponding glow sprites. Validated by: scripts/test_5k_render-world_geometry.mjs.
167. Check that yellow arrow transitions light the arrow separate from the amber ball. Validated by: scripts/test_5k_render-world_geometry.mjs.
168. Check that an advance green blinks in the visual signal view. Validated by: scripts/test_5k_render-world_geometry.mjs.
169. Check that flashing red and flashing amber select the corresponding lamp. Validated by: scripts/test_5k_render-world_geometry.mjs.
170. Check that a dark junction turns off all signal glows even with a U-turn signal field in the phase object. Validated by: scripts/test_5k_render-world_geometry.mjs.
171. Check that the pedestrian walk and steady hand are mutually exclusive. Validated by: scripts/test_5k_render-world_geometry.mjs.
172. Check both phases of the flashing pedestrian clearance hand. Validated by: scripts/test_5k_render-world_geometry.mjs.
173. Check that Saskatoon's five stylized bridge arches reuse the same geometry. Validated by: scripts/test_5k_render-world_geometry.mjs.
174. Check that Saskatoon's bridge sits beyond the map boundary. Validated by: scripts/test_5k_render-world_geometry.mjs.
175. Check that Toronto's needle rises above the surrounding skyline blocks. Validated by: scripts/test_5k_render-world_geometry.mjs.
176. Check that skyline meshes are identified as decorative scenery. Validated by: scripts/test_5k_render-world_geometry.mjs.
177. Check that a mapped building roof participates in shadow casting and receiving. Validated by: scripts/test_5k_render-world_geometry.mjs.
178. Check that the visible building keeps a corresponding footprint in the render index. Validated by: scripts/test_5k_render-world_geometry.mjs.
179. Check that an unknown graphics quality chooses High. Validated by: scripts/test_5k_render-world_views.mjs.
180. Check that Low retains canvas antialiasing while omitting the post-processing and reflection passes. Validated by: scripts/test_5k_render-world_views.mjs.
181. Check that High limits post-process multisampling to the renderer's supported sample count. Validated by: scripts/test_5k_render-world_views.mjs.
182. Check that the wet reflection's multisampling tracks the active quality preset. Validated by: scripts/test_5k_render-world_views.mjs.
183. Check that Ultra runs AO at half the scene target's resolution. Validated by: scripts/test_5k_render-world_views.mjs.
184. Check that a newly created post stack copies the active night bloom amount. Validated by: scripts/test_5k_render-world_views.mjs.
185. Check that rebuilding a quality preset preserves the current colour grade. Validated by: scripts/test_5k_render-world_views.mjs.
186. Check photo-mode clamps for saturation, contrast and vignette. Validated by: scripts/test_5k_render-world_views.mjs.
187. Check that wet frames use the reflection shadow map for the main pass and restore the auto-update flag. Validated by: scripts/test_5k_render-world_views.mjs.
188. Check that scene LODs use the viewing camera once before the mirror and main passes. Validated by: scripts/test_5k_render-world_views.mjs.
189. Check that a throwing world composite restores shadow updates. Validated by: scripts/test_5k_render-world_views.mjs.
190. Check that the post stack grades after tone mapping and antialiases last. Validated by: scripts/test_5k_render-world_views.mjs.
191. Check that the screen dither cycle wraps after 64 frames. Validated by: scripts/test_5k_render-world_views.mjs.
192. Check that post grade uniforms read the tone-mapped target. Validated by: scripts/test_5k_render-world_views.mjs.
193. Check that a sub-degree sun change retains the cached environment probe. Validated by: scripts/test_5k_render-world_views.mjs.
194. Check that a weather transition publishes its new environment texture and releases the old one. Validated by: scripts/test_5k_render-world_views.mjs.
195. Check that sky fallback and distance fog take the same atmosphere colour. Validated by: scripts/test_5k_render-world_views.mjs.
196. Check that the renderer takes reflection environment intensity from the active atmosphere. Validated by: scripts/test_5k_render-world_views.mjs.
197. Check that the shadow lamp sits along the key-light direction at a fixed distance from its target. Validated by: scripts/test_5k_render-world_views.mjs.
198. Check horizontal and vertical shadow snapping in whole texel increments. Validated by: scripts/test_5k_render-world_views.mjs.
199. Check that the mountain backdrop draws before the road geometry. Validated by: scripts/test_5k_render-world_views.mjs.
200. Check that the mountain ridge tapers at the start of its arc. Validated by: scripts/test_5k_render-world_views.mjs.
