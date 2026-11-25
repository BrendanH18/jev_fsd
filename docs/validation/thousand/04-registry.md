# Feature registry

Scramble crossings, work zones with flaggers and power cuts now use feature records. The batch adds ordered hooks, validates registry declarations when they load, and compares complete benchmark and arena captures across the migration.

1. Register scramble crossings with their phase choice, model wording, HUD notice and coaching. Validated by: registry parity comparison and scripts/test_scrambles.mjs.
2. Allow a registered feature to retain a legacy URL parameter while keeping its World option key for benchmark subsets. Validated by: scripts/test_free_drive.mjs.
3. Share whole-phase red-turn bans across ego sensing, traffic and manual auditing. Validated by: scripts/test_scrambles.mjs.
4. Let a phase feature annotate a red-light audit event for its coaching rule. Validated by: scripts/test_scrambles.mjs.
5. Add an intersection snapshot slot after right-turn sensing so phase fields arrive in their established order. Validated by: scripts/test_scrambles.mjs and registry parity comparison.
6. Keep phase-plan guidance before reserved-lane guidance in the LLM prompt through a prompt slot. Validated by: registry parity comparison.
7. Restore the captured scramble plan on replay even after another World changed the active signal plan. Validated by: scripts/test_scrambles.mjs.
8. Register work zones with flaggers across the World, sensing, traffic, candidate, audit and model pipelines. Validated by: registry parity comparison and scripts/test_work_zones.mjs.
9. Let a registered feature steer NPC traffic through a temporary corridor with pursuit, leader projection, clearance and a stop point. Validated by: scripts/test_work_zones.mjs.
10. Expose a primary route detour to both ego following and candidate laws before other detour choices. Validated by: scripts/test_work_zones.mjs.
11. Add a speed-target slot before the zipper merge calculation so a flagger can impose its stop at the original precedence. Validated by: scripts/test_work_zones.mjs.
12. Add a stop-candidate slot ahead of the crossing guard and merge candidates. Validated by: scripts/test_feature_registry.mjs and registry parity comparison.
13. Place feature forward-simulation rejections between the junction-box and merge checks. Validated by: scripts/test_work_zones.mjs and scripts/test_open_track.mjs.
14. Give work-zone HUD notices an ordered stage ahead of merge notices. Validated by: scripts/test_feature_registry.mjs.
15. Dispatch work-zone audits before the junction hazards that followed them on the old audit path. Validated by: scripts/test_feature_registry.mjs and registry parity comparison.
16. Let a feature insert structured model fields ahead of the merge state. Validated by: scripts/test_work_zones.mjs and registry parity comparison.
17. Give feature hold-still criteria a slot ahead of crossing-guard and merge instructions. Validated by: scripts/test_feature_registry.mjs and scripts/test_work_zones.mjs.
18. Give flagger guidance a prompt slot between the track-crossing and zipper-merge instructions. Validated by: registry parity comparison.
19. Let a feature return an examiner failure at the established point before track failures. Validated by: scripts/test_feature_registry.mjs and scripts/test_road_test.mjs.
20. Let a feature explain a blocked cycling pass identically in the model state and situation text. Validated by: scripts/test_work_zones.mjs and registry parity comparison.
21. Let scoring obtain a feature's temporary lane passage before checking the zipper-merge passage. Validated by: scripts/test_work_zones.mjs and registry parity comparison.
22. Dispatch temporary-corridor speed scoring at its existing incident order with one count per site. Validated by: scripts/test_work_zones.mjs.
23. Give flagger and work-zone speed tips a coach stage before junction-blocking tips. Validated by: scripts/test_work_zones.mjs and registry parity comparison.
24. Register power cuts with their control, traffic, audit, messaging and replay behavior. Validated by: registry parity comparison and scripts/test_outages.mjs.
25. Dispatch control replacements in priority order so a directing officer can keep the original signal during an outage. Validated by: scripts/test_traffic_officers.mjs.
26. Share temporary signal state between the world light query and oncoming-queue prediction. Validated by: scripts/test_outages.mjs and registry parity comparison.
27. Let a signal feature supply a visible control replacement and its snapshot fields at sensing time. Validated by: scripts/test_outages.mjs.
28. Let a signal feature add identifying fields to missed-stop and all-way-yield audit events. Validated by: scripts/test_outages.mjs.
29. Let a feature release an NPC caught too close to stop after its stop memory observes the replacement. Validated by: scripts/test_outages.mjs.
30. Let a signal feature serialize extra model fields before intersection cross-traffic fields. Validated by: scripts/test_outages.mjs and registry parity comparison.
31. Add a situation-clause stage at the start of stop instructions for a replacement control. Validated by: scripts/test_outages.mjs and registry parity comparison.
32. Run signal outage steps after merge updates and before other pre-traffic feature updates. Validated by: scripts/test_feature_registry.mjs and registry parity comparison.
33. Give replacement all-way-stop guidance a prompt slot immediately after the ordinary all-way rule. Validated by: registry parity comparison.
34. Give outage coaching a tip stage after the blind-spot speed tip. Validated by: scripts/test_outages.mjs and registry parity comparison.
35. Capture full seed-1 benchmarks with selectable city maps and weather through the registry validation check. Validated by: registry parity comparison.
36. Capture every challenge and both road tests with full Rules and cautious traces through the same check. Validated by: registry parity comparison.
37. Capture the guarded and open system prompts and compare each byte for byte. Validated by: registry parity comparison.
38. Ignore measurement timings and benchmark source identifiers in migration comparisons while retaining simulated drive times and event contents. Validated by: scripts/test_feature_registry.mjs.
39. Reject a differential report that omitted any required bare, city, arena or prompt capture. Validated by: scripts/test_feature_registry.mjs.
40. Reject comparisons with different capture sets so an optional city run cannot disappear silently. Validated by: scripts/test_feature_registry.mjs.
41. Print field paths and expected and actual values for registry parity drift. Validated by: scripts/test_feature_registry.mjs.
42. Extend the core isolation check to catch direct references to the three newly migrated features. Validated by: scripts/test_feature_registry.mjs.
43. Reject non-object registry entries with a configuration error. Validated by: scripts/test_feature_registry.mjs.
44. Reject invalid option identifiers at registry load. Validated by: scripts/test_feature_registry.mjs.
45. Reject World option identifiers reserved by the object prototype. Validated by: scripts/test_feature_registry.mjs.
46. Validate overridden World property names before feature construction. Validated by: scripts/test_feature_registry.mjs.
47. Reject invalid field names for per-approach audit maps. Validated by: scripts/test_feature_registry.mjs.
48. Validate explicit URL flags before registering them. Validated by: scripts/test_feature_registry.mjs.
49. Reject placement counts that cannot represent an enabled counted feature. Validated by: scripts/test_feature_registry.mjs.
50. Check that a motion-question predicate can be called. Validated by: scripts/test_feature_registry.mjs.
51. Check that a parking-traffic predicate can be called. Validated by: scripts/test_feature_registry.mjs.
52. Require a boolean day-of-year clock declaration. Validated by: scripts/test_feature_registry.mjs.
53. Require a boolean UTC-offset clock declaration. Validated by: scripts/test_feature_registry.mjs.
54. Validate priority candidate IDs before building the retained candidate set. Validated by: scripts/test_feature_registry.mjs.
55. Require snapshot defaults to be a field map. Validated by: scripts/test_feature_registry.mjs.
56. Catch undefined snapshot defaults that would disappear from serialized state. Validated by: scripts/test_feature_registry.mjs.
57. Validate field names in snapshot default maps. Validated by: scripts/test_feature_registry.mjs.
58. Reject empty model wording for road-rule flags. Validated by: scripts/test_feature_registry.mjs.
59. Reject callable values in perception rejection text which expects a string. Validated by: scripts/test_feature_registry.mjs.
60. Require event badge entries to be either text or a text-producing function. Validated by: scripts/test_feature_registry.mjs.
61. Reject obstacle descriptors without the classifier used to find their actors. Validated by: scripts/test_feature_registry.mjs.
62. Validate whether a feature obstacle can be followed as traffic. Validated by: scripts/test_feature_registry.mjs.
63. Validate the fixed-obstacle flag used by collision prediction. Validated by: scripts/test_feature_registry.mjs.
64. Validate the pedestrian-like obstacle flag used by fault assignment. Validated by: scripts/test_feature_registry.mjs.
65. Validate the long-obstacle flag used by leader checks along its body. Validated by: scripts/test_feature_registry.mjs.
66. Verify an obstacle's prediction override is callable. Validated by: scripts/test_feature_registry.mjs.
67. Verify an obstacle's local visibility override is callable. Validated by: scripts/test_feature_registry.mjs.
68. Verify an obstacle's oncoming classifier is callable. Validated by: scripts/test_feature_registry.mjs.
69. Verify a parked-clearance override is callable. Validated by: scripts/test_feature_registry.mjs.
70. Verify an obstacle parking exclusion is callable. Validated by: scripts/test_feature_registry.mjs.
71. Reject empty literal labels for feature obstacles. Validated by: scripts/test_feature_registry.mjs.
72. Validate descriptor labels without invoking an accessor during circular module loading. Validated by: scripts/test_feature_registry.mjs.
73. Reject inherited object method names as unrecognized hook declarations and requests. Validated by: scripts/test_feature_registry.mjs.
74. Refuse registered hooks with no callable implementation. Validated by: scripts/test_feature_registry.mjs.
75. Refuse an explicitly empty hook slot instead of interpreting it as the default stage. Validated by: scripts/test_feature_registry.mjs.
76. Require an object declaration for prompt, metric and notice data slots. Validated by: scripts/test_feature_registry.mjs.
77. Validate the text supplied by each prompt declaration. Validated by: scripts/test_feature_registry.mjs.
78. Require a boolean inline flag for prompt formatting. Validated by: scripts/test_feature_registry.mjs.
79. Validate the field identifier of a feature's benchmark metric. Validated by: scripts/test_feature_registry.mjs.
80. Validate metric precision within the useful decimal range of JavaScript numbers. Validated by: scripts/test_feature_registry.mjs.
81. Reject nonfinite or negative benchmark failure thresholds. Validated by: scripts/test_feature_registry.mjs.
82. Validate threshold-trace event types before building the arena trace index. Validated by: scripts/test_feature_registry.mjs.
83. Validate world event types that become replay markers. Validated by: scripts/test_feature_registry.mjs.
84. Verify that a HUD notice can be read before registering it. Validated by: scripts/test_feature_registry.mjs.
85. Require integer HUD notice order within a stage. Validated by: scripts/test_feature_registry.mjs.
86. Refuse zero, negative or nonfinite HUD notice durations. Validated by: scripts/test_feature_registry.mjs.
87. Require HUD notice styles to be text or a callable style selector. Validated by: scripts/test_feature_registry.mjs.
88. Require a boolean HUD retention policy for disappearing notices. Validated by: scripts/test_feature_registry.mjs.
89. Validate that the coaching configuration is an object. Validated by: scripts/test_feature_registry.mjs.
90. Catch invalid coach initialization callbacks during registry load. Validated by: scripts/test_feature_registry.mjs.
91. Catch invalid coach observation callbacks during registry load. Validated by: scripts/test_feature_registry.mjs.
92. Catch invalid coach frame callbacks during registry load. Validated by: scripts/test_feature_registry.mjs.
93. Catch invalid coach direction-exemption predicates during registry load. Validated by: scripts/test_feature_registry.mjs.
94. Require coach seen flags to declare their World source flag. Validated by: scripts/test_feature_registry.mjs.
95. Require a callable coach event handler for each subscribed event. Validated by: scripts/test_feature_registry.mjs.
96. Share coach slot definitions between dispatch and validation so misspelled stages fail immediately. Validated by: scripts/test_feature_registry.mjs.
97. Validate score categories for post-score coaching deductions. Validated by: scripts/test_feature_registry.mjs.
98. Reject multiple registrations claiming the same free-drive URL flag. Validated by: scripts/test_feature_registry.mjs.
99. Reject a feature state, seen flag or audit map that would overwrite another registered World field. Validated by: scripts/test_feature_registry.mjs.
100. Reject duplicate benchmark metric names before assembling the metrics report. Validated by: scripts/test_feature_registry.mjs.
