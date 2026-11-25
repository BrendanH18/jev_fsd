# Maps and map tooling

Offline import and migration workflows, cache recovery, and regression coverage for the bundled
Canadian maps and their browser geometry helpers.

1. Let the map importer build or repair prepared files in a strictly offline mode. Validated by: `tests/test_map_tools.py`.
2. Import a local XML extract directly while preserving any cached raw download. Validated by: `tests/test_map_tools.py`.
3. Reject explicit download refresh when the command also specifies an offline source. Validated by: `tests/test_map_tools.py`.
4. Share the parsed source across a pack and all of its rebuilt layers in one import. Validated by: `tests/test_map_tools.py`.
5. Reject provider error notices even when a caller parses raw XML directly. Validated by: `tests/test_map_tools.py`.
6. Identify the record and failed attribute when malformed OSM data prevents parsing. Validated by: `tests/test_map_tools.py`.
7. Reject geographic coordinates outside the valid latitude and longitude ranges. Validated by: `tests/test_map_tools.py`.
8. Reject unknown member types in relations consumed by the map pipeline. Validated by: `tests/test_map_tools.py`.
9. Accept an XML string beginning with a byte-order mark. Validated by: `tests/test_map_tools.py`.
10. Cover relation member order and default empty roles in the parser. Validated by: `tests/test_map_tools.py`.
11. Cover unresolved way references that are legal in a partial extract. Validated by: `tests/test_map_tools.py`.
12. Check that irrelevant relation types do not require a usable member list. Validated by: `tests/test_map_tools.py`.
13. Validate the bounding box before sending a download request. Validated by: `tests/test_map_tools.py`.
14. Reject timeouts that cannot bound an OSM download. Validated by: `tests/test_map_tools.py`.
15. Allow cached extracts larger than the provider's limit for new downloads. Validated by: `tests/test_map_tools.py`.
16. Cover fallback to the first Overpass mirror without a delay on a permanent main API error. Validated by: `tests/test_map_tools.py`.
17. Cover retry exhaustion across providers and the final error diagnostic. Validated by: `tests/test_map_tools.py`.
18. Check that a non-replacing JSON publication protects the earlier artifact and cleans up its temporary files. Validated by: `tests/test_map_tools.py`.
19. Rebuild current-version pack files whose required graph data is missing. Validated by: `tests/test_map_tools.py`.
20. Detect a valid pack copied into the cache slot for a different bounding box. Validated by: `tests/test_map_tools.py`.
21. Preserve a working pack when a replacement extract has no connected drivable streets. Validated by: `tests/test_map_tools.py`.
22. Skip an optional layer with a filename-specific diagnostic when its raw input is unusable. Validated by: `tests/test_map_tools.py`.
23. Detect damaged derived layers by their JSON payload and rebuild them from available source data. Validated by: `tests/test_map_tools.py`.
24. Fall back to a usable crossing layer when a newer crossing file is damaged. Validated by: `tests/test_map_tools.py`.
25. Keep older restriction layers usable while validating the optional red-turn array when present. Validated by: `tests/test_map_tools.py`.
26. Invalidate catalog metadata for an atomic pack replacement with the same file size and modification time. Validated by: `tests/test_maps.py`.
27. Keep the city catalog available when a single pack preview is unreadable. Validated by: `tests/test_maps.py`.
28. Suppress previews from packs whose internal version does not match the catalog format. Validated by: `tests/test_maps.py`.
29. Draw parallel roads in catalog previews while collapsing exact reverse twins. Validated by: `tests/test_maps.py`.
30. Cover mutation of a caller's catalog counts without modifying the cached metadata. Validated by: `tests/test_maps.py`.
31. Offer a source-preserving mode for in-place pack migrations. Validated by: `tests/test_map_tools.py`.
32. Stage migrated packs in a separate output directory and keep previews read-only. Validated by: `tests/test_map_tools.py`.
33. Change only the final pack version suffix when naming migration targets. Validated by: `tests/test_map_tools.py`.
34. Identify the malformed source file when a pack migration cannot proceed. Validated by: `tests/test_map_tools.py`.
35. Keep legacy inputs and roll back partial replacement files if pack publication fails. Validated by: `tests/test_map_tools.py`.
36. Document an offline workflow to stage and verify map files in isolation. Validated by: `tests/test_doc_links.py` and `tests/test_map_tools.py`.
37. Reuse each projected shape point when constructing road geometry and its OSM node positions. Validated by: `tests/test_osm.py`.
38. Index interior stop nodes by the edges they use while preserving the order in which signs are applied. Validated by: `tests/test_osm.py`.
39. Cover an undirected interior stop's attachment to the nearer downstream junction. Validated by: `tests/test_osm.py`.
40. Cover private access tags overridden only by explicit motor vehicle permission. Validated by: `tests/test_osm.py`.
41. Cover service-road opt-in without admitting driveways or parking aisles into the network. Validated by: `tests/test_osm.py`.
42. Cover exclusion of highway areas from the linear road graph. Validated by: `tests/test_osm.py`.
43. Check that a side-specific parking tag takes precedence over a both-sides tag. Validated by: `tests/test_osm.py`.
44. Check that nonparallel parking does not add a curbside lane. Validated by: `tests/test_osm.py`.
45. Cover the legacy parking tag syntax on explicitly permitted one-way curbs. Validated by: `tests/test_osm.py`.
46. Cover default exclusion of parking on one-way roads and roundabouts. Validated by: `tests/test_osm.py`.
47. Cover bike-route identification from designated use and network tags. Validated by: `tests/test_osm.py`.
48. Check that each bundled pack has the cache key derived from its preset coordinates. Validated by: `tests/test_map_data_quality.py`.
49. Verify the projected frame and extent for every committed pack. Validated by: `tests/test_map_data_quality.py`.
50. Verify recorded pack statistics against actual record counts. Validated by: `tests/test_map_data_quality.py`.
51. Check graph endpoint references and reject duplicate bundled identifiers. Validated by: `tests/test_map_data_quality.py`.
52. Verify both directions of reachability in every bundled road graph. Validated by: `tests/test_map_data_quality.py`.
53. Check serialized edge lengths against the projected polylines within rounding error. Validated by: `tests/test_map_data_quality.py`.
54. Verify that every stored road speed is strictly positive. Validated by: `tests/test_map_data_quality.py`.
55. Check that each bundled edge has its complete ordered set of lane records. Validated by: `tests/test_map_data_quality.py`.
56. Check that lane centers stay inside the stored asphalt span. Validated by: `tests/test_map_data_quality.py`.
57. Check that bundled curbside parking widths cannot be negative. Validated by: `tests/test_map_data_quality.py`.
58. Check that signal approaches enter the signal cluster from outside it. Validated by: `tests/test_map_data_quality.py`.
59. Verify that edge control references and signal approach lines agree. Validated by: `tests/test_map_data_quality.py`.
60. Verify that stop and yield records agree with the controls on their directed edges. Validated by: `tests/test_map_data_quality.py`.
61. Verify that every circulating edge is one-way and belongs to the correct roundabout. Validated by: `tests/test_map_data_quality.py`.
62. Check that bundled building footprints have finite coordinates and the expected winding for extrusion. Validated by: `tests/test_map_data_quality.py`.
63. Verify the published neighbourhood counts against the current packs. Validated by: `tests/test_map_data_quality.py`.
64. Verify that the documented pack filenames and bounds match the preset settings. Validated by: `tests/test_map_data_quality.py`.
65. Verify that named derived layers identify the same extract as the pack they accompany. Validated by: `tests/test_map_data_quality.py`.
66. Check that reserved lane indices are valid and unique per edge. Validated by: `tests/test_map_data_quality.py`.
67. Check that reserved lane permission lists contain only supported road users and always include buses. Validated by: `tests/test_map_data_quality.py`.
68. Detect duplicate contraflow records that would silently overwrite another record for the same edge. Validated by: `tests/test_map_data_quality.py`.
69. Verify that crossing coordinates and island flags are suitable for rendering. Validated by: `tests/test_map_data_quality.py`.
70. Check that mapped driveways have positive length and use radians for travel heading. Validated by: `tests/test_map_data_quality.py`.
71. Check that any bundled park marked closed has closed polygon rings. Validated by: `tests/test_map_data_quality.py`.
72. Verify the water flag on roadside spans against the areas on both sides. Validated by: `tests/test_map_data_quality.py`.
73. Verify rail endpoints use recognized continuation or terminus states. Validated by: `tests/test_map_data_quality.py`.
74. Check that train stops are ordered and lie on the track. Validated by: `tests/test_map_data_quality.py`.
75. Check that rail crossing references land on both a track and its intersecting roads. Validated by: `tests/test_map_data_quality.py`.
76. Verify scramble positions and detection source metadata against their signals. Validated by: `tests/test_map_data_quality.py`.
77. Check that each bundled route restriction names a connected movement. Validated by: `tests/test_map_data_quality.py`.
78. Verify that red-only rules stay outside the routing restriction list. Validated by: `tests/test_map_data_quality.py`.
79. Check that conditional restriction schedules fit the weekday and clock model. Validated by: `tests/test_map_data_quality.py`.
80. Verify that scheduled transit runs preserve a continuous chain of directed edges. Validated by: `tests/test_map_data_quality.py`.
81. Reconcile stored transit run lengths with their road segments. Validated by: `tests/test_map_data_quality.py`.
82. Check that transit stops resolve within their run and the global stop catalog in travel order. Validated by: `tests/test_map_data_quality.py`.
83. Detect duplicate school or playground zones and zones with no applicable street spans. Validated by: `tests/test_map_data_quality.py`.
84. Handle a lane join whose outgoing geometry is empty. Validated by: `scripts/test_map_helpers.mjs`.
85. Measure the outgoing lane polyline once during a join. Validated by: `scripts/test_map_helpers.mjs`.
86. Cover shared endpoint deduplication during very short lane joins. Validated by: `scripts/test_map_helpers.mjs`.
87. Cover the configured blend distance when joining parallel lane offsets. Validated by: `scripts/test_map_helpers.mjs`.
88. Return one hull vertex for coincident junction input points. Validated by: `scripts/test_map_helpers.mjs`.
89. Cover junction hulls with collinear inputs. Validated by: `scripts/test_map_helpers.mjs`.
90. Cover counter-clockwise junction hull winding without modifying input order. Validated by: `scripts/test_map_helpers.mjs`.
91. Keep inherited object properties from being treated as road class priorities. Validated by: `scripts/test_map_helpers.mjs`.
92. Give incomplete or unknown street classes the default sidewalk cross section. Validated by: `scripts/test_map_helpers.mjs`.
93. Check sidewalk placement on asymmetric asphalt. Validated by: `scripts/test_map_helpers.mjs`.
94. Cover interpolation by arc length through a bend and clamping at the ends. Validated by: `scripts/test_map_helpers.mjs`.
95. Cover heading selection at the vertex shared by two segments. Validated by: `scripts/test_map_helpers.mjs`.
96. Check that a stale projection hint triggers a full polyline search, including a hit near the window boundary. Validated by: `scripts/test_map_helpers.mjs`.
97. Prevent future duplicate lanes in spatial queries by testing a lane indexed across several cells. Validated by: `scripts/test_map_helpers.mjs`.
98. Cover nearest lane search when the only candidate has the opposite heading. Validated by: `scripts/test_map_helpers.mjs`.
99. Cover road distance beyond a lane endpoint so asphalt does not extend indefinitely. Validated by: `scripts/test_map_helpers.mjs`.
100. Cover street membership for a vehicle facing into the end of a road, including the overshoot limit. Validated by: `scripts/test_map_helpers.mjs`.
