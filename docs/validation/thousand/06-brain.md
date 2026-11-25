# Driving brain and prompting

This batch covers the browser decision pipeline, built-in agents, and model tapes. It validates malformed responses and recordings with offline fixtures and exercises the driving policies with targeted, deterministic scenarios.

1. Canonical request JSON encodes holes as null without using a custom array iterator. Validated by: `test_brain_tape_edges.mjs`.
2. Canonical request JSON omits symbol-valued object properties. Validated by: `test_brain_tape_edges.mjs`.
3. Canonical request JSON encodes boxed JSON primitives by value. Validated by: `test_brain_tape_edges.mjs`.
4. Canonical request JSON evaluates each enumerable getter once. Validated by: `test_brain_tape_edges.mjs`.
5. A recording key distinguishes an identical body sent to another API path. Validated by: `test_brain_tape_edges.mjs`.
6. A recording key distinguishes identical requests made by different driver IDs. Validated by: `test_brain_tape_edges.mjs`.
7. Recording headers store public endpoint identifiers without provider connection details. Validated by: `test_brain_tape_edges.mjs`.
8. Map checks skip fingerprinting for older recordings without a map hash. Validated by: `test_brain_tape_edges.mjs`.
9. A map mismatch fingerprints the loaded pack only once even when reporting its hash. Validated by: `test_brain_tape_edges.mjs`.
10. A published tape keeps its shape under stricter import validation. Validated by: `test_brain_tape_edges.mjs`.
11. Tape import rejects a malformed top-level table before replay. Validated by: `test_brain_tape_edges.mjs`.
12. Tape import identifies a drive with a malformed answer table. Validated by: `test_brain_tape_edges.mjs`.
13. Tape import identifies a request whose outcomes are not an array. Validated by: `test_brain_tape_edges.mjs`.
14. Tape import reports the position of an invalid result within repeated requests. Validated by: `test_brain_tape_edges.mjs`.
15. Tape import rejects outcomes with contradictory terminal states. Validated by: `test_brain_tape_edges.mjs`.
16. Tape import rejects errors without a replayable message. Validated by: `test_brain_tape_edges.mjs`.
17. Tape import rejects cancellation and timeout markers that are not true. Validated by: `test_brain_tape_edges.mjs`.
18. Tape import identifies a malformed stored drive result. Validated by: `test_brain_tape_edges.mjs`.
19. Tape import identifies a malformed stored route scenario. Validated by: `test_brain_tape_edges.mjs`.
20. Drive IDs that match object properties can be recorded and reloaded. Validated by: `test_brain_tape_edges.mjs`.
21. An explicitly recorded drive with zero calls is an exact replay. Validated by: `test_brain_tape_edges.mjs`.
22. A missing drive can never be reported as an exact replay. Validated by: `test_brain_tape_edges.mjs`.
23. Tape diagnostics identify the unused answers by request key without consuming them. Validated by: `test_brain_tape_edges.mjs`.
24. Concurrent identical tape requests replay their outcomes in invocation order. Validated by: `test_brain_tape_edges.mjs`.
25. Wrapping a model for one tape leaves the original transport reusable by other drives. Validated by: `test_brain_tape_edges.mjs`.
26. A wrapped transport still receives its original model instance. Validated by: `test_brain_tape_edges.mjs`.
27. A tape never dispatches the underlying transport when its signal has already aborted. Validated by: `test_brain_tape_edges.mjs`.
28. Successful tape requests release their abort listener before it can accumulate. Validated by: `test_brain_tape_edges.mjs`.
29. Replay reports drift immediately when a recorded cancellation has no replay signal. Validated by: `test_brain_tape_edges.mjs`.
30. Replay preserves a malformed null transport response for the driver's error handler. Validated by: `test_brain_tape_edges.mjs`.
31. Literal echo-marker strings without matching request or metadata fields survive replay. Validated by: `test_brain_tape_edges.mjs`.
32. Replay comparison leaves the caller's arena report and its start time untouched. Validated by: `test_brain_tape_edges.mjs`.
33. Jev keeps the locally resolved motion even if a reply supplies another value. Validated by: `test_brain_model_edges.mjs`.
34. Jev keeps the sole locally selected vector even if the model names another eligible vector. Validated by: `test_brain_model_edges.mjs`.
35. Jev reports a malformed answers envelope with its spend and provider trace attached. Validated by: `test_brain_model_edges.mjs`.
36. Jev requires a motion answer when motion was asked and preserves metadata on fallback. Validated by: `test_brain_model_edges.mjs`.
37. Jev rejects a motion value outside the current question's options. Validated by: `test_brain_model_edges.mjs`.
38. A malformed Jev vector enters the Rules manoeuvre fallback. Validated by: `test_brain_model_edges.mjs`.
39. Jev refuses a vector listed in the question when it is absent from the eligible set. Validated by: `test_brain_model_edges.mjs`.
40. Jev defers to the active route when a reply names a route outside the question. Validated by: `test_brain_model_edges.mjs`.
41. Jev defers to the default beam when a reply names a beam outside the question. Validated by: `test_brain_model_edges.mjs`.
42. Jev preserves provider confidence and probabilities on a valid choice. Validated by: `test_brain_model_edges.mjs`.
43. Jev ignores unsolicited optional route and headlight answers. Validated by: `test_brain_model_edges.mjs`.
44. Jev ignores inherited object names in a model's choice. Validated by: `test_brain_model_edges.mjs`.
45. LLM decisions reject malformed answer envelopes with a readable error and the original trace. Validated by: `test_brain_model_edges.mjs`.
46. LLM decisions honour a server invalid-output verdict even if the envelope contains an answer. Validated by: `test_brain_model_edges.mjs`.
47. LLM decisions reject missing required motion before the local default can mask it. Validated by: `test_brain_model_edges.mjs`.
48. LLM decisions reject a required manoeuvre outside the asked options. Validated by: `test_brain_model_edges.mjs`.
49. LLM decisions ignore unsolicited primary answers when the only question is about headlights. Validated by: `test_brain_model_edges.mjs`.
50. LLM decisions ignore invalid optional answers while still executing valid motion and vector choices. Validated by: `test_brain_model_edges.mjs`.
51. LLM decisions limit the provider reason retained in decision metadata. Validated by: `test_brain_model_edges.mjs`.
52. The LLM decision adapter preserves a locally chosen route in its applied result. Validated by: `test_brain_model_edges.mjs`.
53. Endpoint refresh retains the probe label through a stats-only update. Validated by: `test_brain_model_edges.mjs`.
54. An older probe finishing later cannot overwrite a newer endpoint status. Validated by: `test_brain_model_edges.mjs`.
55. An in-flight probe cannot restore the check status of a removed endpoint. Validated by: `test_brain_model_edges.mjs`.
56. A probe for an old model cannot label that endpoint after its model is replaced. Validated by: `test_brain_model_edges.mjs`.
57. Changing the configured key variable invalidates the prior reachability result. Validated by: `test_brain_model_edges.mjs`.
58. A stale ready status cannot make an endpoint available while it lacks its configured key. Validated by: `test_brain_model_edges.mjs`.
59. An unrecognised status value cannot replace an actionable endpoint probe result. Validated by: `test_brain_model_edges.mjs`.
60. Endpoint probes report a malformed response without losing the last known status. Validated by: `test_brain_model_edges.mjs`.
61. An endpoint definition cannot replace a built-in driver or a driver in the other pillar. Validated by: `test_brain_model_edges.mjs`.
62. Duplicate endpoint definitions are reconciled using the last entry. Validated by: `test_brain_model_edges.mjs`.
63. The autopilot skips inherited properties when selecting a driver. Validated by: `test_brain_model_edges.mjs`.
64. A valid frozen agent result can be applied without mutating the agent's metadata. Validated by: `test_brain_model_edges.mjs`.
65. A non-Error rejection is displayed as a fallback and leaves the request slot free. Validated by: `test_brain_model_edges.mjs`.
66. A malformed provider failure cannot corrupt accumulated spend or latency. Validated by: `test_brain_model_edges.mjs`.
67. Decision diagnostics identify the applied driver and fallback paths independently of provider metadata. Validated by: `test_brain_model_edges.mjs`.
68. A decision observer failure propagates without applying a second decision. Validated by: `test_brain_model_edges.mjs`.
69. Cautious ranks equally good manoeuvres in their original offer order. Validated by: `test_brain_policy_edges.mjs`.
70. Cautious selects an explicit pull-over without evaluating the unused ranking. Validated by: `test_brain_policy_edges.mjs`.
71. Cautious treats the shared speed target as stricter than its ordinary speed preference. Validated by: `test_brain_policy_edges.mjs`.
72. Cautious prefers the extra gap to small gains in short-term progress. Validated by: `test_brain_policy_edges.mjs`.
73. Cautious keeps driving during a pull-out whose prediction ends almost still. Validated by: `test_brain_policy_edges.mjs`.
74. Rules scores a lane change at the target speed of the new lane. Validated by: `test_brain_policy_edges.mjs`.
75. Rules uses the shared sensing speed when a snapshot has no precomputed target. Validated by: `test_brain_policy_edges.mjs`.
76. Rules still rolls to the line when a mandatory stop lies ahead. Validated by: `test_brain_policy_edges.mjs`.
77. Regression coverage verifies that Rules continues a clear three-point turn while at a stop line. Validated by: `test_brain_policy_edges.mjs`.
78. Rules prefers finishing a lane change to aborting an equally good prediction. Validated by: `test_brain_policy_edges.mjs`.
79. The shared speed target uses the closest applicable stop when hazards overlap. Validated by: `test_brain_policy_edges.mjs`.
80. A reversing lead vehicle never produces a negative target speed. Validated by: `test_brain_policy_edges.mjs`.
81. An all-way stop ceases holding the car once it has crossed the clearing distance. Validated by: `test_brain_policy_edges.mjs`.
82. Decision cadence ignores a roadside row of parked cars until an active hazard appears. Validated by: `test_brain_policy_edges.mjs`.
83. Only traffic ahead within the driving corridor triggers a motion question. Validated by: `test_brain_policy_edges.mjs`.
84. A single eligible manoeuvre resolves the vector question locally even when motion remains undecided. Validated by: `test_brain_policy_edges.mjs`.
85. A route whose ID matches an object property is offered safely in the route criteria. Validated by: `test_brain_policy_edges.mjs`.
86. The LLM prompt offers precisely the beam criteria supplied by the active headlight question. Validated by: `test_brain_policy_edges.mjs`.
87. The open-track LLM prompt keeps the candidate order and excludes unasked alternatives. Validated by: `test_brain_policy_edges.mjs`.
88. A rule flag remains enforceable as a collision even if an earlier road check won the rejection label. Validated by: `test_brain_policy_edges.mjs`.
89. A newly clear open-track prediction no longer carries a previous rule flag. Validated by: `test_brain_policy_edges.mjs`.
90. An unrecognised road-rule identifier is readable even if it names an object property. Validated by: `test_brain_policy_edges.mjs`.
91. The shared safety brake reports imminent following time and bumper gap. Validated by: `test_brain_policy_edges.mjs`.
92. The shared safety brake lets a moving car go when a close leader is pulling away. Validated by: `test_brain_policy_edges.mjs`.
93. The shared safety brake holds a stationary car without reporting a moving intervention. Validated by: `test_brain_policy_edges.mjs`.
94. The shared safety brake changes a near-still reverse hold into an intervention once moving. Validated by: `test_brain_policy_edges.mjs`.
95. The deadlock detector resets accumulated time when the car approaches its destination. Validated by: `test_brain_policy_edges.mjs`.
96. A clear blind-junction peek counts as progress only once the car is actually creeping. Validated by: `test_brain_policy_edges.mjs`.
97. A guarded resimulation removes flags left on reused candidates by the open track. Validated by: `test_brain_policy_edges.mjs`.
98. Rechecking an executing path reports the first visible obstacle without changing ego position or route hint. Validated by: `test_brain_policy_edges.mjs`.
99. Regression coverage verifies that decision state reports clearance only when measured. Validated by: `test_brain_policy_edges.mjs`.
100. Regression coverage verifies that a potentially moving obstacle keeps the destination active. Validated by: `test_brain_policy_edges.mjs`.
