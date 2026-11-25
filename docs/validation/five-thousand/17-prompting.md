# Browser model requests and prompt audits

The browser validates Jev and LLM requests, handles malformed replies and stale decisions, and gives offline tools for measuring prompt size, token usage and cache activity. The Jev question wording and LLM system prompts are preserved.

1. Reject a Jev-family request when its state is an array or null. Validated by: `scripts/test_5k_prompting_contract.mjs`.
2. Identify state serialization failures before starting a Jev-family HTTP request. Validated by: `scripts/test_5k_prompting_contract.mjs`.
3. Reject definitively oversized Jev state before the local server handles it. Validated by: `scripts/test_5k_prompting_contract.mjs`.
4. Require safe integer tick and epoch values on browser model requests. Validated by: `scripts/test_5k_prompting_contract.mjs`.
5. Reject a malformed question table at the model boundary. Validated by: `scripts/test_5k_prompting_contract.mjs`.
6. Prevent a model round trip when the request contains no questions. Validated by: `scripts/test_5k_prompting_contract.mjs`.
7. Identify unsupported question IDs before building the wire request. Validated by: `scripts/test_5k_prompting_contract.mjs`.
8. Require Jev-family questions to use the choice format. Validated by: `scripts/test_5k_prompting_contract.mjs`.
9. Reject malformed option dictionaries with the corresponding question ID. Validated by: `scripts/test_5k_prompting_contract.mjs`.
10. Name the question and actual count when its choice set is empty or exceeds the server limit. Validated by: `scripts/test_5k_prompting_contract.mjs`.
11. Detect missing, non-text or whitespace-only Jev instructions before dispatch. Validated by: `scripts/test_5k_prompting_contract.mjs`.
12. Enforce the Jev instruction ceiling in Unicode code points. Validated by: `scripts/test_5k_prompting_contract.mjs`.
13. Identify blank Jev choice identifiers before dispatch. Validated by: `scripts/test_5k_prompting_contract.mjs`.
14. Validate Jev choice descriptions against the server's text-or-null contract. Validated by: `scripts/test_5k_prompting_contract.mjs`.
15. Identify chat choice IDs that the endpoint's schema will refuse. Validated by: `scripts/test_5k_prompting_contract.mjs`.
16. Keep unsupported motion values out of the chat answer schema. Validated by: `scripts/test_5k_prompting_contract.mjs`.
17. Validate the motion descriptions and route summaries copied into the chat user message. Validated by: `scripts/test_5k_prompting_contract.mjs`.
18. Detect a malformed candidate observation table before generating a chat prompt. Validated by: `scripts/test_5k_prompting_contract.mjs`.
19. Identify a chat candidate whose prediction row is missing. Validated by: `scripts/test_5k_prompting_contract.mjs`.
20. Identify duplicate predictions for an offered manoeuvre. Validated by: `scripts/test_5k_prompting_contract.mjs`.
21. Refuse to offer a chat manoeuvre absent from the current eligible set. Validated by: `scripts/test_5k_prompting_contract.mjs`.
22. Give a dedicated diagnostic when chat state cannot be encoded as JSON. Validated by: `scripts/test_5k_prompting_contract.mjs`.
23. Check the combined chat message character limit before dispatch. Validated by: `scripts/test_5k_prompting_contract.mjs`.
24. Cache the character counts of the fixed system messages for chat preflight. Validated by: `scripts/test_5k_prompting_contract.mjs`.
25. Cap endpoint deadlines at the maximum supported server timeout plus the browser margin. Validated by: `scripts/test_5k_prompting_contract.mjs`.
26. Use a driver-specific fallback deadline when endpoint timeout metadata is invalid. Validated by: `scripts/test_5k_prompting_contract.mjs`.
27. Avoid dispatching a request that was already aborted. Validated by: `scripts/test_5k_prompting_contract.mjs`.
28. Ignore a returned answer if the model transport was cancelled during the call. Validated by: `scripts/test_5k_prompting_contract.mjs`.
29. Reject replies whose echoed tick or epoch belongs to a different decision. Validated by: `scripts/test_5k_prompting_contract.mjs`.
30. Surface a server-supplied rejection verdict even on a Jev response with choices. Validated by: `scripts/test_5k_prompting_contract.mjs`.
31. Give a clear error for a malformed rejection verdict. Validated by: `scripts/test_5k_prompting_contract.mjs`.
32. Bound model rejection details in the error shown to the driver. Validated by: `scripts/test_5k_prompting_contract.mjs`.
33. Use a server error message when a successful HTTP envelope lacks a model answer. Validated by: `scripts/test_5k_prompting_contract.mjs`.
34. Exclude malformed arrays from the browser's decision metadata. Validated by: `scripts/test_5k_prompting_contract.mjs`.
35. Require model answer envelopes supplied by the response itself. Validated by: `scripts/test_5k_prompting_contract.mjs`.
36. Reject inherited Jev answers and inherited choice fields. Validated by: `scripts/test_5k_prompting_contract.mjs`.
37. Reject incompatible explicit answer types in Jev replies. Validated by: `scripts/test_5k_prompting_contract.mjs`.
38. Reject out-of-range confidence without discarding the Jev choice. Validated by: `scripts/test_5k_prompting_contract.mjs`.
39. Remove probability entries referring to choices absent from the question. Validated by: `scripts/test_5k_prompting_contract.mjs`.
40. Remove non-numeric and out-of-range probability values before displaying decision diagnostics. Validated by: `scripts/test_5k_prompting_contract.mjs`.
41. Prevent a malformed local motion from becoming a Jev actuation value. Validated by: `scripts/test_5k_prompting_contract.mjs`.
42. Ignore inherited chat choices in the transport validator and direct LLM decision adapter. Validated by: `scripts/test_5k_prompting_contract.mjs`.
43. Truncate an LLM's optional reason at a Unicode character boundary. Validated by: `scripts/test_5k_prompting_contract.mjs`.
44. Reject non-text choices passed to the direct LLM decision adapter. Validated by: `scripts/test_5k_prompting_contract.mjs`.
45. Use own-property precedence for locally resolved chat answers. Validated by: `scripts/test_5k_prompting_contract.mjs`.
46. Keep existing browser agents when the endpoint list has a malformed envelope. Validated by: `scripts/test_5k_prompting_endpoint_status.mjs`.
47. Skip null or primitive endpoint list entries while still registering usable peers. Validated by: `scripts/test_5k_prompting_endpoint_status.mjs`.
48. Check endpoint names against the format accepted by the agent registry. Validated by: `scripts/test_5k_prompting_endpoint_status.mjs`.
49. Keep a known endpoint when the server returns an incomplete record for its ID. Validated by: `scripts/test_5k_prompting_endpoint_status.mjs`.
50. Detect disagreement between an endpoint's registry ID and its server name. Validated by: `scripts/test_5k_prompting_endpoint_status.mjs`.
51. Ignore non-text probe names before deriving a registry key. Validated by: `scripts/test_5k_prompting_endpoint_status.mjs`.
52. Ignore probe fields inherited from the response object's prototype. Validated by: `scripts/test_5k_prompting_endpoint_status.mjs`.
53. Detect an audit output alias through a symlinked parent before files exist. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
54. Refuse a dangling audit output symlink before it can refer to another artifact. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
55. Refuse audit output paths that refer to directories or other non-files. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
56. Return isolated audit snapshots so consumers cannot corrupt later reports. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
57. Group requests by the Jev questions or chat response fields they offered. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
58. Measure each request body's compact JSON wire size. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
59. Measure the compact JSON size of Jev's state separately from its instructions. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
60. Report a conservative state-size floor using the server's ASCII JSON convention. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
61. Count Jev states proven to exceed the server's size ceiling. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
62. Show how many questions are sent in each Jev-family call. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
63. Measure how much wire space the question section occupies. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
64. Report the number of visible traffic entries in Jev requests. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
65. Report how many candidate predictions Jev saw. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
66. Report how many route alternatives were included in Jev state. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
67. Report how many filter categories contributed to Jev's rejection summary. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
68. Report how many attempted manoeuvres the rejection counters represent. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
69. Measure the size of the pedestrian observation when present. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
70. Report per-question instruction size distributions. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
71. Distinguish the 4,000-character review target from the server's hard instruction ceiling. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
72. Report how many choices are offered per question and flag oversized sets. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
73. Measure the JSON footprint of the criterion dictionary separately from instructions. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
74. Measure criterion text and choice identifier lengths separately. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
75. Measure total chat prompt length and count requests over the server cap. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
76. Count chat messages against the server envelope limit. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
77. Distinguish system, user and assistant message size distributions. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
78. Count distinct system message prefixes without including prompt contents in the report. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
79. Measure the chat observations separately from policy context and choices. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
80. Report the size and number of situation clauses in chat user messages. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
81. Report how many candidate predictions chat received and their byte footprint. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
82. Measure the route and motion descriptions embedded in chat separately. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
83. Measure the answer schema that is embedded in the user message. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
84. Measure the answer schema sent separately for server-side response validation. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
85. Track the number of expected IDs by chat response field. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
86. Report the amount of driving-style text independently from situation clauses. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
87. Identify the largest requests by ordinal for each budgeted prompt dimension. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
88. Allow the largest-request report to be capped or suppressed. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
89. Identify unsupported request envelopes without abandoning an audit stream. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
90. Identify request envelopes that ambiguously contain both questions and messages. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
91. Identify invalid request coordinates in saved audit inputs. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
92. Count question requests whose observed state is missing. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
93. Check for absent or unexpected question IDs in offline request data. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
94. Identify questions that do not declare the expected choice type. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
95. Report missing instruction text separately from whitespace-only instructions. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
96. Identify absent criteria and identify criteria describing zero choices. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
97. Detect invalid criterion IDs or description types in offline request streams. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
98. Detect invalid chat message roles or content types. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
99. Report a chat prompt with no user text. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
100. Report a chat prompt with no system policy. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
101. Identify user messages that cannot be decoded as JSON. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
102. Identify decoded user messages that lack an observations object. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
103. Identify candidate rows that lack a usable manoeuvre ID. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
104. Identify duplicate candidate predictions in saved prompts. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
105. Identify leaked candidate predictions that were not offered. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
106. Identify offered chat candidates that are missing from the user message. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
107. Identify missing or inconsistent embedded answer schemas. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
108. Report chat requests without a usable expected-answer field table. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
109. Identify unexpected fields in a chat answer specification. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
110. Distinguish empty, duplicate and invalid chat option IDs. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
111. Catch invalid motion choices in the offline chat schema. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
112. Run the request audit directly against a saved JSONL file. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
113. Accept JSONL request bodies piped via standard input. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
114. Accept UTF-8 BOM and CRLF in exported JSONL streams. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
115. Identify a malformed JSONL line by number without printing its text. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
116. Make the request audit usable as a build gate for hard prompt limits. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
117. Make the request audit usable as a build gate for the narrower question target. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
118. Provide an optional audit gate for empty inputs or malformed requests. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
119. Distinguish OpenAI prompt totals from Anthropic's additive cache tokens. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
120. Use a valid alternate provider input field if the preferred field is malformed. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
121. Use server usage metadata when cache-adjusted provider input cannot be trusted. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
122. Reject token totals above JavaScript's safe integer range instead of rounding them. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
123. Break down measured input usage by provider trace or server metadata. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
124. Report provider usage objects that could not establish input totals. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
125. Report responses missing input usage independently from transport failures. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
126. Distinguish timeout and transport error outcomes in the token audit. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
127. Report calls cancelled by a change of autopilot epoch. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
128. Tag invalid or empty replies independently of their recorded token usage. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
129. Track calls that use exactly the target number of tokens. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
130. Expose the lower and upper tails of input usage with the minimum and p99. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
131. Report the output-token distribution separately from input tokens. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
132. Report Anthropic cache write usage and the calls that produced it. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
133. Report prompt cache reads and how often they are present. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
134. Read OpenAI cached input from prompt token details without adding it to the prompt total. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
135. Use compatible server cache counters when provider details are unavailable. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
136. Drop inconsistent cache breakdowns that exceed the recorded input total. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
137. Identify the highest-token call occurrences within drives and across the tape. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
138. Filter the audit by any number of explicit drive IDs. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
139. Reject requested drive IDs absent from the recording. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
140. Allow a total measured input-token budget for the selected drives. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
141. Gate audit completeness on responses with measurable usage. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
142. Measure usage directly from gzip content even if the file has been renamed. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
143. Accept a saved model recording on standard input. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
144. Show the recording path with read, archive or JSON errors. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
145. Compare token use against a second saved tape by drive identifier. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
146. Expose drive IDs exclusive to each side of a tape comparison. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
147. Show changes in call counts and usage coverage beside token deltas. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
148. Show per-drive changes in tail input usage and exceedance counts. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
149. Leave comparison deltas absent when measured input usage is unavailable. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
150. Limit standard input to one side of a tape comparison. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
151. Cover an instruction exactly at the server ceiling using a non-BMP character. Validated by: `scripts/test_5k_prompting_contract.mjs`.
152. Cover a Jev choice whose criterion intentionally has a null description. Validated by: `scripts/test_5k_prompting_contract.mjs`.
153. Verify decimal exponents do not inflate the conservative state-size estimate. Validated by: `scripts/test_5k_prompting_contract.mjs`.
154. Cover the ASCII escaping of the DEL code point. Validated by: `scripts/test_5k_prompting_contract.mjs`.
155. Cover a Jev state whose conservative encoded size is exactly the boundary. Validated by: `scripts/test_5k_prompting_contract.mjs`.
156. Cover cyclic Jev state without reaching the transport. Validated by: `scripts/test_5k_prompting_contract.mjs`.
157. Cover a guarded chat prompt whose content totals exactly the limit. Validated by: `scripts/test_5k_prompting_contract.mjs`.
158. Cover a chat option at the maximum permitted identifier length. Validated by: `scripts/test_5k_prompting_contract.mjs`.
159. Verify the open chat prompt preserves the system policy with null candidate rows. Validated by: `scripts/test_5k_prompting_contract.mjs`.
160. Verify a hosted decision call receives the original abort signal. Validated by: `scripts/test_5k_prompting_contract.mjs`.
161. Verify a non-matching reply echo retains cost metadata and the provider trace. Validated by: `scripts/test_5k_prompting_contract.mjs`.
162. Verify a deliberately empty server verdict keeps a valid answer usable. Validated by: `scripts/test_5k_prompting_contract.mjs`.
163. Verify model source labels come from the browser driver rather than provider metadata. Validated by: `scripts/test_5k_prompting_contract.mjs`.
164. Verify missing endpoint timing metadata keeps the default LLM timeout. Validated by: `scripts/test_5k_prompting_contract.mjs`.
165. Verify absent answer types remain compatible with legacy choice replies. Validated by: `scripts/test_5k_prompting_contract.mjs`.
166. Verify one and zero remain valid Jev probabilities. Validated by: `scripts/test_5k_prompting_contract.mjs`.
167. Verify sanitizing decision diagnostics leaves a frozen provider response untouched. Validated by: `scripts/test_5k_prompting_contract.mjs`.
168. Verify a route ID sharing a prototype name remains legal when explicitly offered. Validated by: `scripts/test_5k_prompting_contract.mjs`.
169. Verify an otherwise valid LLM answer ignores a numeric reason. Validated by: `scripts/test_5k_prompting_contract.mjs`.
170. Verify changing one provider's list cannot remove endpoints in the other driver family. Validated by: `scripts/test_5k_prompting_endpoint_status.mjs`.
171. Verify a malformed probe name with custom conversion code does not throw. Validated by: `scripts/test_5k_prompting_endpoint_status.mjs`.
172. Verify an absent unrelated artifact does not cause a false output-path collision. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
173. Verify equal-ranked prompt outliers preserve their original request order. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
174. Verify auditing two identical system messages counts one prefix. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
175. Verify threshold comparisons treat exactly 4,000 instruction characters as within target. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
176. Verify descriptions set to null do not count as text samples. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
177. Verify editing a previously returned outlier leaves the next report unchanged. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
178. Verify a strict request audit prints measured JSON even when its budget gate fails. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
179. Verify the server-limit gate passes a request above target but under the server cap. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
180. Verify an empty request stream fails when completeness is required. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
181. Verify request-audit line numbers include blank lines. Validated by: `scripts/test_5k_prompting_prompt_audit.mjs`.
182. Verify zero input tokens remain a measured call. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
183. Verify a cache write explicitly reported as zero remains a measured cache count. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
184. Verify out-of-range OpenAI cached input cannot inflate its total. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
185. Verify positive output usage can be audited on a response without input usage. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
186. Verify fractional output counts and boolean input counts are ignored. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
187. Verify a metadata-only response with a valid cache split is measured. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
188. Verify equal token outliers preserve the request occurrence order. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
189. Verify null responses remain accounted for without publishing their contents. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
190. Verify selecting a drive twice does not count it twice. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
191. Verify a drive with no model calls is still included when explicitly selected. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
192. Verify drive IDs that share object property names remain selectable. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
193. Verify primary and baseline-only selections are distinguishable when no IDs match. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
194. Verify exact total budget equality passes. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
195. Verify an exact per-call token target passes the threshold gate. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
196. Verify zero is a usable total input budget when a selected drive made no calls. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
197. Verify a missing baseline input is identified by its own filename. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
198. Verify compressed data works when passed to the token audit on standard input. Validated by: `scripts/test_5k_prompting_token_audit.mjs`.
199. Verify browser preflight failure executes Rules without counting a provider call. Validated by: `scripts/test_5k_prompting_contract.mjs`.
200. Verify fallback after a mismatched reply still counts the returned provider usage. Validated by: `scripts/test_5k_prompting_contract.mjs`.
