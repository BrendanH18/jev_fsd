# Maps and map tooling

Add a read-only audit for prepared map artifacts, harden imports and drive-lab fixtures, and document the evidence needed to select a Phase 6 map or provincial rule.

1. Add a read-only audit mode for prepared map directories. Validated by: `tests/test_5k_maps_audit.py`.
2. Audit all bundled presets in one command. Validated by: `tests/test_5k_maps_audit.py`.
3. Support auditing a single configured area, preset, or coordinate box. Validated by: `tests/test_5k_maps_audit.py`.
4. Apply selected sidecar flags to narrow audit scope while still checking the street pack. Validated by: `tests/test_5k_maps_audit.py`.
5. Require the rail layer on demand for sites that depend on it. Validated by: `tests/test_5k_maps_audit.py`.
6. Report an absent optional rail layer as omitted. Validated by: `tests/test_5k_maps_audit.py`.
7. Identify an absent required artifact by its expected filename. Validated by: `tests/test_5k_maps_audit.py`.
8. Flag the pending-layer marker from an interrupted import. Validated by: `tests/test_5k_maps_audit.py`.
9. Keep reporting layer shape errors when the street pack is unreadable. Validated by: `tests/test_5k_maps_audit.py`.
10. Identify a structurally readable crossing fallback after the preferred file fails. Validated by: `tests/test_5k_maps_audit.py`.
11. Fail an audit of an invalid shadowed file to expose corruption before it becomes active. Validated by: `tests/test_5k_maps_audit.py`.
12. Treat an unreadable or dangling artifact as invalid, including optional files. Validated by: `tests/test_5k_maps_audit.py`.
13. Provide a stable JSON report for CI and other offline consumers. Validated by: `tests/test_5k_maps_audit.py`.
14. Report serialized byte size and SHA-256 fingerprints from the same bytes that were inspected. Validated by: `tests/test_5k_maps_audit.py`.
15. Include record counts next to prepared artifact names. Validated by: `tests/test_5k_maps_audit.py`.
16. Show array indices and property names in audit diagnostics. Validated by: `tests/test_5k_maps_audit.py`.
17. Reject import actions combined with the read-only audit. Validated by: `tests/test_5k_maps_audit.py`.
18. Reject audit-specific flags unless audit mode is active. Validated by: `tests/test_5k_maps_audit.py`.
19. Reject a single explicit area together with all-preset mode. Validated by: `tests/test_5k_maps_audit.py`.
20. Diagnose an invalid staging or reference directory before scanning. Validated by: `tests/test_5k_maps_audit.py`.
21. Compare two audited map directories by exact prepared artifact bytes. Validated by: `tests/test_5k_maps_audit.py`.
22. Identify artifacts exclusive to either comparison directory. Validated by: `tests/test_5k_maps_audit.py`.
23. Provide the reference directory's own validation errors alongside comparison results. Validated by: `tests/test_5k_maps_audit.py`.
24. Require each prepared file's internal version to match its expected filename format. Validated by: `tests/test_5k_maps_audit.py`.
25. Flag named sidecars copied from another extract. Validated by: `tests/test_5k_maps_audit.py`.
26. Check the packed bounding box order and geographic range. Validated by: `tests/test_5k_maps_audit.py`.
27. Check that packed bounds identify the requested cache key. Validated by: `tests/test_5k_maps_audit.py`.
28. Require the pack name to identify the same extract as its filename. Validated by: `tests/test_5k_maps_audit.py`.
29. Require positive dimensions for the projected extent. Validated by: `tests/test_5k_maps_audit.py`.
30. Enforce latitude and longitude bounds in the stored projection origin. Validated by: `tests/test_5k_maps_audit.py`.
31. Reject non-object statistics and invalid statistical counters. Validated by: `tests/test_5k_maps_audit.py`.
32. Compare graph, control and building counters with the number of serialized records. Validated by: `tests/test_5k_maps_audit.py`.
33. Check that graph nodes provide finite two-axis coordinates. Validated by: `tests/test_5k_maps_audit.py`.
34. Detect ambiguous node and edge identifiers before diagnosing graph references. Validated by: `tests/test_5k_maps_audit.py`.
35. Report an unknown edge origin or destination with the member path. Validated by: `tests/test_5k_maps_audit.py`.
36. Require at least two finite polyline points on a road edge. Validated by: `tests/test_5k_maps_audit.py`.
37. Reject a road whose serialized travel length is zero or negative. Validated by: `tests/test_5k_maps_audit.py`.
38. Check positive per-lane width and total carriageway width. Validated by: `tests/test_5k_maps_audit.py`.
39. Reject a nonpositive speed limit in prepared road data. Validated by: `tests/test_5k_maps_audit.py`.
40. Require an integral positive edge lane count. Validated by: `tests/test_5k_maps_audit.py`.
41. Validate the serialized one-way and optional bicycle-route flags as booleans. Validated by: `tests/test_5k_maps_audit.py`.
42. Require road display names and road-class identifiers to be strings. Validated by: `tests/test_5k_maps_audit.py`.
43. Require an ordered pair of asphalt offsets. Validated by: `tests/test_5k_maps_audit.py`.
44. Reject malformed or negative curbside parking widths. Validated by: `tests/test_5k_maps_audit.py`.
45. Check lane offset count against the edge's declared lanes. Validated by: `tests/test_5k_maps_audit.py`.
46. Check declared lane count against the serialized lane records. Validated by: `tests/test_5k_maps_audit.py`.
47. Check the lane index against the parent edge's lane count. Validated by: `tests/test_5k_maps_audit.py`.
48. Detect repeated lane keys that would collide in lookups. Validated by: `tests/test_5k_maps_audit.py`.
49. Require usable polyline geometry on each individual lane. Validated by: `tests/test_5k_maps_audit.py`.
50. Reject a lane whose parent edge cannot be found. Validated by: `tests/test_5k_maps_audit.py`.
51. Restrict control type to signal, stop or yield. Validated by: `tests/test_5k_maps_audit.py`.
52. Check that a control ID resolves under its declared type. Validated by: `tests/test_5k_maps_audit.py`.
53. Check the edge control's station against the road length. Validated by: `tests/test_5k_maps_audit.py`.
54. Require phase group on signal controls. Validated by: `tests/test_5k_maps_audit.py`.
55. Require the all-way marker on stop controls. Validated by: `tests/test_5k_maps_audit.py`.
56. Require roundabout identity on yield controls. Validated by: `tests/test_5k_maps_audit.py`.
57. Validate signal position coordinates for rendering. Validated by: `tests/test_5k_maps_audit.py`.
58. Require at least two serialized approaches on a signal. Validated by: `tests/test_5k_maps_audit.py`.
59. Resolve each signal approach to an edge and check its stop-line station. Validated by: `tests/test_5k_maps_audit.py`.
60. Validate approach headings in signed degrees and group labels as A or B. Validated by: `tests/test_5k_maps_audit.py`.
61. Require a positive signal cycle and check the offset against the cycle. Validated by: `tests/test_5k_maps_audit.py`.
62. Resolve the graph vertex IDs in the signal cluster. Validated by: `tests/test_5k_maps_audit.py`.
63. Require valid coordinates and a boolean all-way marker on stop records. Validated by: `tests/test_5k_maps_audit.py`.
64. Check that stop and yield locations name the destination junction of their edge. Validated by: `tests/test_5k_maps_audit.py`.
65. Resolve each yield's roundabout ID. Validated by: `tests/test_5k_maps_audit.py`.
66. Require roundabout radii to increase from island to lane to outer curb. Validated by: `tests/test_5k_maps_audit.py`.
67. Validate the circulating direction as a boolean. Validated by: `tests/test_5k_maps_audit.py`.
68. Check each roundabout's listed edge and vertex IDs for dangling references. Validated by: `tests/test_5k_maps_audit.py`.
69. Verify that an edge tagged as circulating resolves to a roundabout and carries one one-way lane. Validated by: `tests/test_5k_maps_audit.py`.
70. Require at least three finite vertices on building footprints. Validated by: `tests/test_5k_maps_audit.py`.
71. Reject nonpositive building extrusion heights. Validated by: `tests/test_5k_maps_audit.py`.
72. Validate the bridge descriptor and display name fields. Validated by: `tests/test_5k_maps_audit.py`.
73. Require a bridge span to have a resolvable road and increasing stations within it. Validated by: `tests/test_5k_maps_audit.py`.
74. Limit reserved-lane eligibility lists to supported modes and require at least one mode. Validated by: `tests/test_5k_maps_audit.py`.
75. Require buses to appear in reserved-lane permissions. Validated by: `tests/test_5k_maps_audit.py`.
76. Reject duplicate permission modes in a reserved lane. Validated by: `tests/test_5k_maps_audit.py`.
77. Validate the reserved lane against the edge's lane count. Validated by: `tests/test_5k_maps_audit.py`.
78. Detect conflicting reserved-lane records for the same edge and lane. Validated by: `tests/test_5k_maps_audit.py`.
79. Accept an explicit null for an unrestricted reserved-lane schedule while checking timed windows when present. Validated by: `tests/test_5k_maps_audit.py`.
80. Reject a non-text raw conditional expression on a reserved lane. Validated by: `tests/test_5k_maps_audit.py`.
81. Validate weekdays and local clock bounds in sidecar schedules. Validated by: `tests/test_5k_maps_audit.py`.
82. Detect duplicate weekdays in reserved-lane windows. Validated by: `tests/test_5k_maps_audit.py`.
83. Restrict traffic-calming devices to the importer-supported device types. Validated by: `tests/test_5k_maps_audit.py`.
84. Require a finite site position for each traffic-calming device. Validated by: `tests/test_5k_maps_audit.py`.
85. Require at least one affected direction for a traffic-calming device. Validated by: `tests/test_5k_maps_audit.py`.
86. Validate travel stations for the affected directions of a traffic-calming device. Validated by: `tests/test_5k_maps_audit.py`.
87. Detect duplicate affected edges in a single traffic-calming device. Validated by: `tests/test_5k_maps_audit.py`.
88. Enforce the raised-table requirement for a calming device that doubles as a crossing. Validated by: `tests/test_5k_maps_audit.py`.
89. Validate contraflow type and side for cyclist placement. Validated by: `tests/test_5k_maps_audit.py`.
90. Require provenance tags and an OSM way ID in contraflow records. Validated by: `tests/test_5k_maps_audit.py`.
91. Validate contraflow street names consumed by map displays. Validated by: `tests/test_5k_maps_audit.py`.
92. Reject a contraflow record whose edge is absent or carries two-way traffic. Validated by: `tests/test_5k_maps_audit.py`.
93. Detect duplicate contraflow entries for one directed edge. Validated by: `tests/test_5k_maps_audit.py`.
94. Require supported crosswalk markings in prepared crossing records. Validated by: `tests/test_5k_maps_audit.py`.
95. Verify finite projected crosswalk coordinates and a valid road station. Validated by: `tests/test_5k_maps_audit.py`.
96. Validate island, pedestrian crossover and beacon flags as booleans. Validated by: `tests/test_5k_maps_audit.py`.
97. Require crossing v2 when a record has pedestrian crossover behavior. Validated by: `tests/test_5k_maps_audit.py`.
98. Require a beacon indicator for a pedestrian crossover and flag beacon indicators on ordinary crossings. Validated by: `tests/test_5k_maps_audit.py`.
99. Validate driveway source way IDs and street names. Validated by: `tests/test_5k_maps_audit.py`.
100. Validate driveway side for curb placement. Validated by: `tests/test_5k_maps_audit.py`.
101. Audit driveway heading in signed radians and require positive driveway length. Validated by: `tests/test_5k_maps_audit.py`.
102. Check a driveway's access position against the attached road. Validated by: `tests/test_5k_maps_audit.py`.
103. Restrict park and water area kinds to those produced by the importer. Validated by: `tests/test_5k_maps_audit.py`.
104. Validate display names for adjacent areas and their road spans. Validated by: `tests/test_5k_maps_audit.py`.
105. Verify that park rings and channel polylines contain enough finite points. Validated by: `tests/test_5k_maps_audit.py`.
106. Require geometry appropriate to a linear channel or polygonal area. Validated by: `tests/test_5k_maps_audit.py`.
107. Check that a park ring marked closed ends at its starting point. Validated by: `tests/test_5k_maps_audit.py`.
108. Check park-adjacent spans for positive length within their referenced roads. Validated by: `tests/test_5k_maps_audit.py`.
109. Require at least one adjacent area per park span and resolve both optional sides. Validated by: `tests/test_5k_maps_audit.py`.
110. Compare each park span's water flag with its referenced areas. Validated by: `tests/test_5k_maps_audit.py`.
111. Require a recognized railway kind and valid display metadata on each track. Validated by: `tests/test_5k_maps_audit.py`.
112. Require positive track length and two or more finite points. Validated by: `tests/test_5k_maps_audit.py`.
113. Require two recognized railway endpoint classifications. Validated by: `tests/test_5k_maps_audit.py`.
114. Validate rail stop IDs and display names. Validated by: `tests/test_5k_maps_audit.py`.
115. Detect duplicate stops on a track. Validated by: `tests/test_5k_maps_audit.py`.
116. Check rail stops against the track length and its station order. Validated by: `tests/test_5k_maps_audit.py`.
117. Resolve each level crossing to a track and check its track station. Validated by: `tests/test_5k_maps_audit.py`.
118. Validate the level crossing position and railway heading for rendering. Validated by: `tests/test_5k_maps_audit.py`.
119. Validate the crossing's light, gate and bell flags. Validated by: `tests/test_5k_maps_audit.py`.
120. Require a level crossing to have at least one affected road. Validated by: `tests/test_5k_maps_audit.py`.
121. Check level crossing road approach angles in degrees. Validated by: `tests/test_5k_maps_audit.py`.
122. Check the road station of each level crossing approach. Validated by: `tests/test_5k_maps_audit.py`.
123. Detect duplicate affected road edges in a level crossing. Validated by: `tests/test_5k_maps_audit.py`.
124. Keep red-only restriction kinds separate from routing restriction kinds. Validated by: `tests/test_5k_maps_audit.py`.
125. Require a restriction's original relation ID for tracing its source. Validated by: `tests/test_5k_maps_audit.py`.
126. Require at least one target for a turn restriction. Validated by: `tests/test_5k_maps_audit.py`.
127. Detect duplicate departure edges in a single restriction. Validated by: `tests/test_5k_maps_audit.py`.
128. Check that source and target restrictions resolve to adjacent directed edges. Validated by: `tests/test_5k_maps_audit.py`.
129. Reject conditional restrictions that also specify mutually exclusive baseline suppressions. Validated by: `tests/test_5k_maps_audit.py`.
130. Check weekday uniqueness in active and suppressed restriction schedules. Validated by: `tests/test_5k_maps_audit.py`.
131. Validate source IDs and reasons in the skipped restriction report. Validated by: `tests/test_5k_maps_audit.py`.
132. Validate the optional original clause on a skipped restriction. Validated by: `tests/test_5k_maps_audit.py`.
133. Require an identifiable signal for a scramble and prevent duplicate entries. Validated by: `tests/test_5k_maps_audit.py`.
134. Check a scramble's location against its named signal's coordinates. Validated by: `tests/test_5k_maps_audit.py`.
135. Require a supported scramble detection source. Validated by: `tests/test_5k_maps_audit.py`.
136. Check transit route modes against the OSM importer. Validated by: `tests/test_5k_maps_audit.py`.
137. Validate transit route references, names and optional colour metadata. Validated by: `tests/test_5k_maps_audit.py`.
138. Require each transit route to provide at least one run. Validated by: `tests/test_5k_maps_audit.py`.
139. Require each transit run to have a positive length and at least one road edge. Validated by: `tests/test_5k_maps_audit.py`.
140. Check directed connectivity across a transit run. Validated by: `tests/test_5k_maps_audit.py`.
141. Check the tram lane against the lane count on all run edges. Validated by: `tests/test_5k_maps_audit.py`.
142. Validate transit stop names and finite roadside positions. Validated by: `tests/test_5k_maps_audit.py`.
143. Require a transit run stop to resolve in the global stop catalog. Validated by: `tests/test_5k_maps_audit.py`.
144. Check each run stop's road against its own run and validate the stop station. Validated by: `tests/test_5k_maps_audit.py`.
145. Check transit stop order even if a run visits an edge more than once. Validated by: `tests/test_5k_maps_audit.py`.
146. Validate the school or playground classification and display names of zone sites. Validated by: `tests/test_5k_maps_audit.py`.
147. Require at least one applicable road span for each zone. Validated by: `tests/test_5k_maps_audit.py`.
148. Check zone span stations and referenced edges. Validated by: `tests/test_5k_maps_audit.py`.
149. Accept gzip-compressed local OSM XML files and identify truncated inputs by filename. Validated by: `tests/test_5k_maps_import.py`.
150. Reject blank OSM tag keys before interpreting records. Validated by: `tests/test_5k_maps_import.py`.
151. Report conflicting values for an OSM tag while accepting identical repeated tags. Validated by: `tests/test_5k_maps_import.py`.
152. Reject conflicting copies of the same raw node while allowing repeated identical records. Validated by: `tests/test_5k_maps_import.py`.
153. Use a default road speed when the converted value is zero or non-finite. Validated by: `tests/test_5k_maps_import.py`.
154. Bound malformed lane-count text before converting it to an integer. Validated by: `tests/test_5k_maps_import.py`.
155. Compute implicit two-way lane counts in integer arithmetic to avoid overflow. Validated by: `tests/test_5k_maps_import.py`.
156. Use level metadata and the seeded fallback in order when an explicit height overflows. Validated by: `tests/test_5k_maps_import.py`.
157. Reject duplicate keys at any depth in prepared JSON. Validated by: `tests/test_5k_maps_import.py`.
158. Disallow non-finite JSON values and overflowed JSON exponents when opening artifacts. Validated by: `tests/test_5k_maps_import.py`.
159. Preserve an existing file when new JSON contains a non-finite value. Validated by: `tests/test_5k_maps_import.py`.
160. Invalidate a derived cache entry clearly when it names a different map. Validated by: `tests/test_5k_maps_import.py`.
161. Invalidate cached packs with scalar records in the required arrays. Validated by: `tests/test_5k_maps_import.py`.
162. Check optional cached roundabout or yield arrays when present. Validated by: `tests/test_5k_maps_import.py`.
163. Rebuild a pack whose cached projected extent is malformed or reversed. Validated by: `tests/test_5k_maps_import.py`.
164. Rebuild a pack with invalid cached origin metadata. Validated by: `tests/test_5k_maps_import.py`.
165. Reject a cached pack with degenerate or out-of-bounds geographic coordinates. Validated by: `tests/test_5k_maps_import.py`.
166. Report the raw cache directory when an OSM download cannot prepare it. Validated by: `tests/test_5k_maps_import.py`.
167. Skip unchanged requests to an endpoint after a permanent HTTP error. Validated by: `tests/test_5k_maps_import.py`.
168. Include each attempted source once per distinct error in final OSM download diagnostics. Validated by: `tests/test_5k_maps_import.py`.
169. Reject duplicate edge identifiers before modifying a legacy pack. Validated by: `tests/test_5k_maps_import.py`.
170. Reject nonregular migration inputs before publication and roll back outputs after a serialization failure. Validated by: `tests/test_5k_maps_import.py`.
171. Reject legacy migration filenames missing a map identifier. Validated by: `tests/test_5k_maps_import.py`.
172. Include Québec City in the drive-lab map catalog. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
173. Prevent mutation of the drive-lab preset lookup. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
174. Reject unknown map names including inherited object properties. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
175. Separate prepared JSON loading from the MapData constructor for offline inspection. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
176. Give malformed UTF-8 in a drive-lab artifact a filename-specific error. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
177. Check that the drive-lab pack name agrees with the selected preset. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
178. Validate the pack and sidecar schema versions in the drive-lab fixture loader. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
179. Reject malformed collection records before passing a drive-lab pack into simulation. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
180. Reject an incorrectly named sidecar copied into a drive-lab fixture directory. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
181. Use the older crossing artifact after a corrupt preferred artifact and identify both files in a warning. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
182. Preserve both underlying errors if neither crossing artifact can be read. Validated by: `scripts/test_5k_maps_lab_loader.mjs` (0.04 s on Boat).
183. Record the independent signal evidence needed for a BC pedestrian-controlled flashing green. Validated by: `tests/test_doc_links.py`.
184. Specify the directed-junction and control-site evidence for BC's two-way left-on-red gap. Validated by: `tests/test_doc_links.py`.
185. Record entry and exit lane evidence for a potential multi-lane roundabout. Validated by: `tests/test_doc_links.py`.
186. Describe a comparison case that distinguishes bicycle signal timing from the presence of a bike lane. Validated by: `tests/test_doc_links.py`.
187. Identify the general-traffic control movement needed to evaluate a transit-only advance signal. Validated by: `tests/test_doc_links.py`.
188. Pair the signalized U-turn review with an existing dead-end U-turn control. Validated by: `tests/test_doc_links.py`.
189. Record what would qualify an Ontario crossover site beyond the currently reviewed boxes. Validated by: `tests/test_doc_links.py`.
190. Define evidence for school-zone calendars and beacon schedules. Validated by: `tests/test_doc_links.py`.
191. Specify when a move-over study needs both clear and blocked adjacent-lane cases. Validated by: `tests/test_doc_links.py`.
192. Describe the oncoming and following comparisons for a regional high-beam study. Validated by: `tests/test_doc_links.py`.
193. Record roadway and stop-bay evidence for comparing transit pull-out policies. Validated by: `tests/test_doc_links.py`.
194. Describe paired roadway and oncoming-traffic conditions for regional cyclist clearance. Validated by: `tests/test_doc_links.py`.
195. Account for adjacent-lane plow and blade occupancy in snow-plow site selection. Validated by: `tests/test_doc_links.py`.
196. Identify divided-road evidence for evaluating school bus rules. Validated by: `tests/test_doc_links.py`.
197. Specify approach-level display and schedule evidence for overnight flashing. Validated by: `tests/test_doc_links.py`.
198. Give an Atlantic layout candidate a concrete geometry comparison. Validated by: `tests/test_doc_links.py`.
199. Define a matched route and seed comparison for a northern seasonal visibility candidate. Validated by: `tests/test_doc_links.py`.
200. Document a read-only staging and byte-comparison command for prepared map proposals. Validated by: `tests/test_doc_links.py`.
