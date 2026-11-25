# Model backends

The model backends validate requests and provider replies, bound time and concurrent calls, improve cost accounting, and make endpoint setup clearer. The inventory includes 158 shipped changes and 42 regression checks. Provider tests use mocks or loopback fixtures.

1. Reject a non-object System One request before dispatch. Validated by: `DecisionRequests.test_non_object` in `tests/test_5k_models_protocol.py`.
2. Keep decision sequence numbers within the range that Python and JavaScript can echo exactly. Validated by: `DecisionRequests.test_safe_sequence` in `tests/test_5k_models_protocol.py`.
3. Bound the nesting of decision state before forwarding it to a provider. Validated by: `DecisionRequests.test_state` in `tests/test_5k_models_protocol.py`.
4. Require string keys in System One state objects instead of allowing JSON encoding to coerce them. Validated by: `DecisionRequests.test_state` in `tests/test_5k_models_protocol.py`.
5. Require actual JSON containers in decision state so tuples cannot silently become arrays. Validated by: `DecisionRequests.test_state` in `tests/test_5k_models_protocol.py`.
6. Reject invalid Unicode anywhere inside decision state. Validated by: `DecisionRequests.test_state` in `tests/test_5k_models_protocol.py`.
7. Report invalid Unicode in a question's instructions against that question. Validated by: `DecisionRequests.test_choice_fields` in `tests/test_5k_models_protocol.py`.
8. Bound criterion ID length and require IDs that can round-trip as UTF-8. Validated by: `DecisionRequests.test_choice_fields` in `tests/test_5k_models_protocol.py`.
9. Bound the length of each criterion's explanatory text and validate its Unicode. Validated by: `DecisionRequests.test_choice_fields` in `tests/test_5k_models_protocol.py`.
10. Apply an aggregate wire-size ceiling to the System One question block. Validated by: `DecisionRequests.test_choice_fields` in `tests/test_5k_models_protocol.py`.
11. Forward only the three System One choice fields instead of passing arbitrary question properties. Validated by: `DecisionRequests.test_question_allowlist` in `tests/test_5k_models_protocol.py`.
12. Restrict built-in Jev actuation to choices offered by the request while keeping the raw response available for inspection. Validated by: `DecisionRequests.test_builtin_answers` in `tests/test_5k_models_protocol.py`.
13. Reject a non-object language-model request before endpoint lookup. Validated by: `LanguageModelReplies.test_request_object` in `tests/test_5k_models_protocol.py`.
14. Apply a UTF-8 byte budget to LLM prompts as well as the existing character budget. Validated by: `LanguageModelReplies.test_request_bytes_and_unicode` in `tests/test_5k_models_protocol.py`.
15. Catch invalid message Unicode before the request leaves the app. Validated by: `LanguageModelReplies.test_request_bytes_and_unicode` in `tests/test_5k_models_protocol.py`.
16. Treat fractional provider token counts as malformed instead of rounding them down. Validated by: `UsageAndTypeSafe.test_fractional_usage` in `tests/test_5k_models_protocol.py`.
17. Accept prompt and completion token aliases when TypeSafe's primary accounting field is unavailable. Validated by: `UsageAndTypeSafe.test_aliases_and_zero` in `tests/test_5k_models_protocol.py`.
18. Use the requested Jev model ID when the provider reports a blank or non-string name. Validated by: `UsageAndTypeSafe.test_metadata_model_fallback` in `tests/test_5k_models_protocol.py`.
19. Bound the depth of SDK response data copied into a Jev trace. Validated by: `UsageAndTypeSafe.test_deep_provider_metadata` in `tests/test_5k_models_protocol.py`.
20. Reject invalid result costs before updating shared spend. Validated by: `UsageAndTypeSafe.test_invalid_cost_does_not_reduce_budget` in `tests/test_5k_models_protocol.py`.
21. Show how many seconds remain until a slot opens in the process rate limit. Validated by: `UsageAndTypeSafe.test_rate_limit_reports_next_slot` in `tests/test_5k_models_protocol.py`.
22. Normalize constructor-supplied TypeSafe keys the same way as keys updated in memory. Validated by: `UsageAndTypeSafe.test_constructor_normalizes_key_and_checks_timeout` in `tests/test_5k_models_protocol.py`.
23. Reject invalid TypeSafe timeouts during client construction. Validated by: `UsageAndTypeSafe.test_constructor_normalizes_key_and_checks_timeout` in `tests/test_5k_models_protocol.py`.
24. Redact the TypeSafe key from decision traces and provider exceptions. Validated by: `UsageAndTypeSafe.test_builtin_keeps_key_out_of_replies_and_failures` in `tests/test_5k_models_protocol.py`.
25. Use one model, key, URL and timeout snapshot for a TypeSafe call. Validated by: `TypeSafeContracts.test_connection_snapshot` in `tests/test_5k_models_contracts.py`.
26. Reject TypeSafe model catalogs with the wrong top-level shape. Validated by: `UsageAndTypeSafe.test_builtin_model_list_requires_object` in `tests/test_5k_models_protocol.py`.
27. Normalize and redact JSON returned by the TypeSafe catalog before exposing it. Validated by: `UsageAndTypeSafe.test_builtin_model_list_redacts_payload` in `tests/test_5k_models_protocol.py`.
28. Disable the SDK's automatic retries so a paid decision is attempted once. Validated by: `UsageAndTypeSafe.test_sdk_no_post_retries` in `tests/test_5k_models_protocol.py`.
29. Use the deadline-bound transport for built-in TypeSafe decisions made without the SDK. Validated by: `UsageAndTypeSafe.test_builtin_stdlib_deadline_and_no_post_retry` in `tests/test_5k_models_protocol.py`.
30. Refuse redirects during fallback TypeSafe catalog requests using the shared opener. Validated by: `TypeSafeContracts.test_fallback_catalog_transport` in `tests/test_5k_models_contracts.py`.
31. Attach a deadline watchdog to TypeSafe's fallback catalog read. Validated by: `TypeSafeContracts.test_fallback_catalog_transport` in `tests/test_5k_models_contracts.py`.
32. Honor HTTP-date Retry-After values when a free TypeSafe catalog request can be retried. Validated by: `UsageAndTypeSafe.test_retry_date_and_invalid_values` in `tests/test_5k_models_protocol.py`.
33. Cap catalog connection retry sleeps by the configured timeout. Validated by: `TypeSafeContracts.test_fallback_connect_backoff` in `tests/test_5k_models_contracts.py`.
34. Translate TypeSafe catalog read failures to client errors. Validated by: `TypeSafeContracts.test_fallback_read_failure` in `tests/test_5k_models_contracts.py`.
35. Explain that a TypeSafe HTTP 402 means the account has run out of credits. Validated by: `UsageAndTypeSafe.test_builtin_stdlib_deadline_and_no_post_retry` in `tests/test_5k_models_protocol.py`.
36. Explain TypeSafe overload when an upstream returns HTTP 529. Validated by: `UsageAndTypeSafe.test_provider_error_scrubs_before_excerpt` in `tests/test_5k_models_protocol.py`.
37. Keep non-finite and out-of-range TypeSafe confidence scores out of ranked displays. Validated by: `UsageAndTypeSafe.test_probability_helpers` in `tests/test_5k_models_protocol.py`.
38. Make a negative result limit return zero ranked answers. Validated by: `UsageAndTypeSafe.test_probability_helpers` in `tests/test_5k_models_protocol.py`.
39. Report a provider redirect without quoting its potentially sensitive destination. Validated by: `TransportContracts.test_redirect_diagnostic` in `tests/test_5k_models_contracts.py`.
40. Check elapsed wall time even if a watchdog timer was delayed by thread scheduling. Validated by: `TransportTests.test_elapsed_watchdog_is_late_even_if_timer_has_not_fired` in `tests/test_5k_models_endpoints.py`.
41. Distinguish an exhausted address list from an expired connect deadline. Validated by: `TransportTests.test_no_address_is_connection_error` in `tests/test_5k_models_endpoints.py`.
42. Validate provider credentials as visible ASCII before building authorization headers. Validated by: `TransportTests.test_headers` in `tests/test_5k_models_endpoints.py`.
43. Reject an oversized declared reply without reading its body into memory. Validated by: `TransportTests.test_read_limits_and_truncation` in `tests/test_5k_models_endpoints.py`.
44. Detect a provider response whose body ends before its declared length. Validated by: `TransportTests.test_read_limits_and_truncation` in `tests/test_5k_models_endpoints.py`.
45. Share bounded HTTP error reads and stream cleanup across decisions, model lists and TypeSafe's fallback. Validated by: `TransportContracts.test_error_stream_cleanup` in `tests/test_5k_models_contracts.py`.
46. Reject an outgoing provider payload that cannot be encoded as finite JSON. Validated by: `TransportTests.test_post_body_limits` in `tests/test_5k_models_endpoints.py`.
47. Put a hard default wire-size ceiling on provider POST bodies. Validated by: `TransportTests.test_post_body_limits` in `tests/test_5k_models_endpoints.py`.
48. Report invalid UTF-8 instead of replacing bytes in a provider decision. Validated by: `TransportTests.test_configured_http_bad_encoding` in `tests/test_5k_models_endpoints.py`.
49. Accept a UTF-8 BOM in a provider JSON response. Validated by: `TransportTests.test_configured_http_bom` in `tests/test_5k_models_endpoints.py`.
50. Redact provider keys before shortening a non-JSON response excerpt. Validated by: `TransportTests.test_non_json_excerpt_scrubs_before_limit` in `tests/test_5k_models_endpoints.py`.
51. Normalize non-finite numbers in HTTP error bodies. Validated by: `TransportTests.test_error_body_normalizes_numbers` in `tests/test_5k_models_endpoints.py`.
52. Keep integers exact when reading plain decimal integer configuration strings. Validated by: `ModelConfigurationTests.test_exact_integer` in `tests/test_5k_models_endpoints.py`.
53. Allow each configured endpoint to cap simultaneous requests with max_parallel and hold its slot until usage is recorded. Validated by: `tests/test_5k_models_endpoints.py`.
54. Apply a configurable wire-size limit before consuming endpoint call slots. Validated by: `ModelCallPolicyTests.test_size_limit_is_applied_before_quota` in `tests/test_5k_models_endpoints.py`.
55. Let operators set an independent status-probe timeout. Validated by: `TransportTests.test_check_timeout_and_cache` in `tests/test_5k_models_endpoints.py`.
56. Let operators shorten or disable status-probe caching. Validated by: `TransportTests.test_check_timeout_and_cache` in `tests/test_5k_models_endpoints.py`.
57. Put an endpoint on cooldown when the provider supplies Retry-After on overload. Validated by: `ModelCallPolicyTests.test_retry_after_blocks_only_that_endpoint` in `tests/test_5k_models_endpoints.py`.
58. Allow the cooldown to be capped or disabled for a configured endpoint. Validated by: `ModelCallPolicyTests.test_local_retry_after_can_be_disabled` in `tests/test_5k_models_endpoints.py`.
59. Show an invalid configured key as a status-probe error without starting a request. Validated by: `TransportTests.test_status_probe_invalid_key` in `tests/test_5k_models_endpoints.py`.
60. Coalesce overlapping unforced probes through the endpoint's status cache. Validated by: `TransportTests.test_probe_dedup` in `tests/test_5k_models_endpoints.py`.
61. Keep a probe started before registry reload from restoring a stale cache entry. Validated by: `TransportTests.test_probe_invalidation_in_flight` in `tests/test_5k_models_endpoints.py`.
62. Identify provider overload and rate limiting in the probe result. Validated by: `TransportTests.test_status_throttle_diagnostic` in `tests/test_5k_models_endpoints.py`.
63. Recognize a trailing dot on a localhost address. Validated by: `ModelConfigurationTests.test_local_host` in `tests/test_5k_models_endpoints.py`.
64. Keep wildcard and multicast addresses out of the local endpoint classification. Validated by: `ModelConfigurationTests.test_local_host` in `tests/test_5k_models_endpoints.py`.
65. Bound configured provider URL length. Validated by: `ModelConfigurationTests.test_base_configuration` in `tests/test_5k_models_endpoints.py`.
66. Reject unsupported characters before handing a base URL to the HTTP parser. Validated by: `ModelConfigurationTests.test_base_configuration` in `tests/test_5k_models_endpoints.py`.
67. Require printable endpoint labels and normalize their surrounding whitespace. Validated by: `ModelConfigurationTests.test_base_configuration` in `tests/test_5k_models_endpoints.py`.
68. Give an explicit maximum-length diagnostic for configured model IDs. Validated by: `ModelConfigurationTests.test_base_configuration` in `tests/test_5k_models_endpoints.py`.
69. Bound the size of an endpoints file for both registry loads and setup edits. Validated by: `SetupTests.test_config_bom_and_size` in `tests/test_5k_models_endpoints.py`.
70. Read endpoint configuration exported with a UTF-8 BOM. Validated by: `SetupTests.test_config_bom_and_size` in `tests/test_5k_models_endpoints.py`.
71. Report implausibly large list prices without letting them inflate the spend total. Validated by: `ModelConfigurationTests.test_price_cap_reported_without_disabling_model` in `tests/test_5k_models_endpoints.py`.
72. Serialize reloads so two config refreshes cannot publish over each other. Validated by: `RegistryContracts.test_reload_serializes_loads` in `tests/test_5k_models_contracts.py`.
73. Keep config problems and endpoint status from the same registry generation. Validated by: `RegistryContracts.test_consistent_status_snapshot` in `tests/test_5k_models_contracts.py`.
74. Reject single-dot segments in configured decision API paths. Validated by: `ModelConfigurationTests.test_api_path` in `tests/test_5k_models_endpoints.py`.
75. Reject negative and unreasonably large RPM settings rather than silently disabling or breaking the limit. Validated by: `ModelConfigurationTests.test_limits_from_both_configs` in `tests/test_5k_models_endpoints.py`.
76. Keep malformed structured values out of decision choice errors. Validated by: `DecisionRequests.test_non_string_choice_is_not_echoed` in `tests/test_5k_models_protocol.py`.
77. Validate configured System One answers independently of depth-based trace summarization. Validated by: `DecisionRequests.test_decision_trace_depth_does_not_change_answers` in `tests/test_5k_models_protocol.py`.
78. Use the requested decision model when the provider sends unusable model text. Validated by: `ReplyContracts.test_decision_result_metadata` in `tests/test_5k_models_contracts.py`.
79. Trim the optional provider name before attaching it to backend status. Validated by: `ReplyContracts.test_decision_result_metadata` in `tests/test_5k_models_contracts.py`.
80. Use one configured-price and reported-cost calculation across both endpoint kinds. Validated by: `ReplyContracts.test_shared_cost_estimate` in `tests/test_5k_models_contracts.py`.
81. Point users to the configured model and path on decision HTTP 404. Validated by: `ReplyContracts.test_decision_http_404` in `tests/test_5k_models_contracts.py`.
82. Report explicitly invalid LLM protocol names rather than treating false values as defaults. Validated by: `ModelConfigurationTests.test_llm_config_rejects_invalid_fields` in `tests/test_5k_models_endpoints.py`.
83. Report explicitly invalid response formats rather than treating empty values as defaults. Validated by: `ModelConfigurationTests.test_llm_config_rejects_invalid_fields` in `tests/test_5k_models_endpoints.py`.
84. Validate the Chat Completions temperature range before a request. Validated by: `ModelConfigurationTests.test_llm_config_rejects_invalid_fields` in `tests/test_5k_models_endpoints.py`.
85. Bound configured LLM output tokens to a positive supported range. Validated by: `ModelConfigurationTests.test_llm_config_rejects_invalid_fields` in `tests/test_5k_models_endpoints.py`.
86. Apply output token bounds to provider-specific extra-body overrides as well. Validated by: `ModelConfigurationTests.test_llm_config_rejects_invalid_fields` in `tests/test_5k_models_endpoints.py`.
87. Report non-finite JSON in LLM extra-body configuration. Validated by: `ModelConfigurationTests.test_llm_config_rejects_invalid_fields` in `tests/test_5k_models_endpoints.py`.
88. Bound the size and nesting of provider-specific body overlays. Validated by: `ModelConfigurationTests.test_llm_config_rejects_invalid_fields` in `tests/test_5k_models_endpoints.py`.
89. Allow OpenAI-compatible endpoints to use the max_completion_tokens field. Validated by: `ModelCallPolicyTests.test_openai_wire_options` in `tests/test_5k_models_endpoints.py`.
90. Allow OpenAI-compatible endpoints to render the system prompt with the developer role. Validated by: `ModelCallPolicyTests.test_openai_wire_options` in `tests/test_5k_models_endpoints.py`.
91. Avoid sending two token-cap fields when a custom extra body selects an override. Validated by: `ModelCallPolicyTests.test_token_alias_override_sends_only_selected_cap` in `tests/test_5k_models_endpoints.py`.
92. Allow a configured LLM endpoint to probe a custom status path. Validated by: `ModelCallPolicyTests.test_custom_probe_path` in `tests/test_5k_models_endpoints.py`.
93. Allow a schema request to fall back once to JSON object mode. Validated by: `ModelCallPolicyTests.test_json_object_fallback_and_status` in `tests/test_5k_models_endpoints.py`.
94. Allow an endpoint to disable response-format retries. Validated by: `ModelCallPolicyTests.test_can_disable_structured_retry` in `tests/test_5k_models_endpoints.py`.
95. Expose the configured response format alongside the current downgraded mode. Validated by: `ModelCallPolicyTests.test_json_object_fallback_and_status` in `tests/test_5k_models_endpoints.py`.
96. Keep an older failed retry from undoing another request's confirmed downgrade. Validated by: `CallContracts.test_confirmed_downgrade_survives_older_error` in `tests/test_5k_models_contracts.py`.
97. Report the elapsed time of all attempts behind an LLM decision. Validated by: `ModelCallPolicyTests.test_llm_latency_includes_format_retry` in `tests/test_5k_models_endpoints.py`.
98. Preserve the out-of-credits status on LLM requests. Validated by: `ModelCallPolicyTests.test_http_error_messages` in `tests/test_5k_models_endpoints.py`.
99. Explain which settings to check on LLM HTTP 404. Validated by: `ModelCallPolicyTests.test_http_error_messages` in `tests/test_5k_models_endpoints.py`.
100. Read provider detail fields when no OpenAI-style error field is available. Validated by: `ModelCallPolicyTests.test_http_error_messages` in `tests/test_5k_models_endpoints.py`.
101. Map LLM HTTP 529 to the overload and rate-limit path. Validated by: `ModelCallPolicyTests.test_retry_after_blocks_only_that_endpoint` in `tests/test_5k_models_endpoints.py`.
102. Make protocol and generation settings available to an environment-only LLM endpoint. Validated by: `ModelConfigurationTests.test_environment_config_fields` in `tests/test_5k_models_endpoints.py`.
103. Make concurrency, request-size and RPM controls available to environment-only LLM endpoints. Validated by: `ModelConfigurationTests.test_environment_config_fields` in `tests/test_5k_models_endpoints.py`.
104. Expose probe and cooldown settings to environment-only LLM endpoints. Validated by: `ModelConfigurationTests.test_environment_config_fields` in `tests/test_5k_models_endpoints.py`.
105. Make Anthropic's prompt cache lifetime configurable. Validated by: `ModelCallPolicyTests.test_anthropic_ttl_and_cache_opt_out` in `tests/test_5k_models_endpoints.py`.
106. Account for 1-hour cache writes at their own rate when Anthropic reports a split. Validated by: `ModelCallPolicyTests.test_cost_accounts_for_provider_split_cache_writes` in `tests/test_5k_models_endpoints.py`.
107. Recover the cache write count if Anthropic sends tier details without an aggregate. Validated by: `ModelCallPolicyTests.test_cost_accounts_for_provider_split_cache_writes` in `tests/test_5k_models_endpoints.py`.
108. Support a configurable cached prompt token price for compatible chat providers. Validated by: `ModelCallPolicyTests.test_cost_accounts_for_openai_prompt_cache` in `tests/test_5k_models_endpoints.py`.
109. Expose compatible providers' cache-read counts in decision metadata. Validated by: `ModelCallPolicyTests.test_cost_accounts_for_openai_prompt_cache` in `tests/test_5k_models_endpoints.py`.
110. Combine only genuine text parts in a Chat Completions message. Validated by: `LanguageModelReplies.test_reply_content_parts` in `tests/test_5k_models_protocol.py`.
111. Report unsupported scalar message content without converting it into candidate text. Validated by: `LanguageModelReplies.test_reply_wrong_content_type` in `tests/test_5k_models_protocol.py`.
112. Reject a completion stopped by its output token cap. Validated by: `LanguageModelReplies.test_openai_finish_reasons` in `tests/test_5k_models_protocol.py`.
113. Report content filtering as a refusal. Validated by: `LanguageModelReplies.test_openai_finish_reasons` in `tests/test_5k_models_protocol.py`.
114. Reject tool or function call completions when a driving choice is required. Validated by: `LanguageModelReplies.test_openai_finish_reasons` in `tests/test_5k_models_protocol.py`.
115. Honor explicit refusals even when the provider also sends text. Validated by: `LanguageModelReplies.test_explicit_refusal_wins_over_text` in `tests/test_5k_models_protocol.py`.
116. Recognize a Messages refusal even when the provider omits all content blocks. Validated by: `LanguageModelReplies.test_anthropic_empty_refusal` in `tests/test_5k_models_protocol.py`.
117. Reject Anthropic replies waiting for a tool call or a later turn. Validated by: `LanguageModelReplies.test_anthropic_requires_finished_decision` in `tests/test_5k_models_protocol.py`.
118. Reject oversize LLM replies instead of interpreting a truncated prefix. Validated by: `LanguageModelReplies.test_oversize_completion` in `tests/test_5k_models_protocol.py`.
119. Reject invalid Unicode in completion text. Validated by: `LanguageModelReplies.test_invalid_unicode_completion` in `tests/test_5k_models_protocol.py`.
120. Reject duplicate exact JSON keys in model decisions. Validated by: `LanguageModelReplies.test_json_no_array_or_duplicate` in `tests/test_5k_models_protocol.py`.
121. Avoid recovering an inner object from a broken outer answer. Validated by: `LanguageModelReplies.test_json_no_array_or_duplicate` in `tests/test_5k_models_protocol.py`.
122. Prefer the explicit JSON code block to example objects in preceding prose. Validated by: `LanguageModelReplies.test_fence_precedes_prose` in `tests/test_5k_models_protocol.py`.
123. Strip leading reasoning blocks without modifying literal markup inside an answer. Validated by: `LanguageModelReplies.test_literal_think_markup` in `tests/test_5k_models_protocol.py`.
124. Bound the depth of the extracted decision object. Validated by: `LanguageModelReplies.test_nested_decision_limit` in `tests/test_5k_models_protocol.py`.
125. Reject model fields that become ambiguous after name normalization. Validated by: `LanguageModelReplies.test_normalized_duplicate_field` in `tests/test_5k_models_protocol.py`.
126. Reject conflicting candidate aliases instead of picking one silently. Validated by: `LanguageModelReplies.test_alias_conflicts` in `tests/test_5k_models_protocol.py`.
127. Drop an ambiguous optional route even when other driving fields remain usable. Validated by: `LanguageModelReplies.test_alias_conflicts` in `tests/test_5k_models_protocol.py`.
128. Make case-insensitive choice matching reject ambiguity while preserving exact matches. Validated by: `LanguageModelReplies.test_case_collision_and_nonfinite_id` in `tests/test_5k_models_protocol.py`.
129. Keep non-finite numeric values from matching offered text IDs. Validated by: `LanguageModelReplies.test_case_collision_and_nonfinite_id` in `tests/test_5k_models_protocol.py`.
130. Count interpreted invalid LLM responses in endpoint diagnostics while keeping their spend recorded. Validated by: `LanguageModelReplies.test_interpreted_invalid_answer_is_counted` in `tests/test_5k_models_protocol.py`.
131. Scrub keys before truncating refusals and driving explanations. Validated by: `LanguageModelReplies.test_refusal_and_reason_excerpt_hide_long_key` in `tests/test_5k_models_protocol.py`.
132. Use max_completion_tokens for the OpenAI preset. Validated by: `SetupTests.test_presets_choose_compatible_parameters` in `tests/test_5k_models_endpoints.py`.
133. Default newer direct OpenAI models to the developer role. Validated by: `SetupTests.test_presets_choose_compatible_parameters` in `tests/test_5k_models_endpoints.py`.
134. Omit the sampling temperature for newer direct OpenAI defaults. Validated by: `SetupTests.test_presets_choose_compatible_parameters` in `tests/test_5k_models_endpoints.py`.
135. Use Groq's supported max_completion_tokens parameter for new setups. Validated by: `SetupTests.test_presets_choose_compatible_parameters` in `tests/test_5k_models_endpoints.py`.
136. Avoid supplying Gemini reasoning effort to models outside supported families. Validated by: `SetupTests.test_presets_choose_compatible_parameters` in `tests/test_5k_models_endpoints.py`.
137. Avoid supplying the Grok reasoning setting to incompatible model families. Validated by: `SetupTests.test_presets_choose_compatible_parameters` in `tests/test_5k_models_endpoints.py`.
138. Ask for a key before attempting a catalog request that requires authentication. Validated by: `SetupTests.test_catalog_requires_auth_before_network` in `tests/test_5k_models_endpoints.py`.
139. Report a missing catalog array with a manual-model-entry hint. Validated by: `SetupTests.test_catalog_shape` in `tests/test_5k_models_endpoints.py`.
140. Accept the alternate models array if a provider's data field is unusable. Validated by: `SetupTests.test_catalog_shape` in `tests/test_5k_models_endpoints.py`.
141. Filter OpenRouter chat catalogs by text output capability. Validated by: `SetupTests.test_catalog_text_and_decision_filter` in `tests/test_5k_models_endpoints.py`.
142. Exclude catalog IDs that would change during setup or cannot be saved as printable text. Validated by: `SetupTests.test_catalog_usable_ids` in `tests/test_5k_models_endpoints.py`.
143. Use a legitimate display name when the primary catalog name is blank or invalid. Validated by: `SetupTests.test_catalog_metadata_fallbacks` in `tests/test_5k_models_endpoints.py`.
144. Use a legitimate alternative context size when the primary catalog field is unusable. Validated by: `SetupTests.test_catalog_metadata_fallbacks` in `tests/test_5k_models_endpoints.py`.
145. Break case-insensitive model-picker sort ties deterministically. Validated by: `SetupTests.test_catalog_deterministic_case_order` in `tests/test_5k_models_endpoints.py`.
146. Explain that a provider's HTTP 429 refused catalog listing temporarily. Validated by: `SetupTests.test_catalog_http_diagnostics` in `tests/test_5k_models_endpoints.py`.
147. Offer manual model entry when a provider does not support listing. Validated by: `SetupTests.test_catalog_http_diagnostics` in `tests/test_5k_models_endpoints.py`.
148. Avoid changing a shared provider key if its endpoint file cannot be written. Validated by: `SetupTests.test_save_failure_does_not_write_key` in `tests/test_5k_models_endpoints.py`.
149. Restore the previous endpoint file if credential saving fails. Validated by: `SetupTests.test_failed_key_file_restores_previous_config` in `tests/test_5k_models_endpoints.py`.
150. Preserve an existing model's custom label on a same-model save. Validated by: `SetupTests.test_update_keeps_tuning_and_prices` in `tests/test_5k_models_endpoints.py`.
151. Preserve hand-edited timeouts when saving a model on the same server. Validated by: `SetupTests.test_update_keeps_tuning_and_prices` in `tests/test_5k_models_endpoints.py`.
152. Preserve existing same-model prices when omitted from setup while allowing explicit clearing. Validated by: `SetupTests.test_update_keeps_tuning_and_prices` in `tests/test_5k_models_endpoints.py`.
153. Remove shadowed definitions along with the selected endpoint so it cannot reappear. Validated by: `SetupTests.test_removal_clears_duplicate_definitions` in `tests/test_5k_models_endpoints.py`.
154. Report a missing removal selection before reading the endpoint file. Validated by: `SetupTests.test_removal_explicitly_names_missing_selection` in `tests/test_5k_models_endpoints.py`.
155. Show TypeSafe aliases without claiming they will always resolve to a specific release. Validated by: `SetupTests.test_typesafe_catalog_empty_result_and_auth_error` in `tests/test_5k_models_endpoints.py`.
156. Use a typed setup error for authentication rejection instead of matching error text. Validated by: `SetupTests.test_typesafe_catalog_empty_result_and_auth_error` in `tests/test_5k_models_endpoints.py`.
157. Support TypeSafe catalogs that identify a model with an id field. Validated by: `SetupTests.test_typesafe_model_id_and_selected_url` in `tests/test_5k_models_endpoints.py`.
158. Prevent built-in TypeSafe key setup from sending that key to an overridden service URL. Validated by: `SetupTests.test_typesafe_model_id_and_selected_url` in `tests/test_5k_models_endpoints.py`.
159. Cover the missing-TypeSafe-key path leaving the call quota untouched. Validated by: `TypeSafeContracts.test_missing_key_leaves_quota_untouched` in `tests/test_5k_models_contracts.py`.
160. Cover the key source and value after clearing an in-memory TypeSafe override. Validated by: `TypeSafeContracts.test_key_source_tracks_memory_override` in `tests/test_5k_models_contracts.py`.
161. Cover SDK reuse when the in-memory key is set to its current value. Validated by: `TypeSafeContracts.test_sdk_identity_unchanged_on_same_key` in `tests/test_5k_models_contracts.py`.
162. Cover SDK reconstruction when a model or timeout changes. Validated by: `TypeSafeContracts.test_sdk_identity_changes_on_model_and_timeout` in `tests/test_5k_models_contracts.py`.
163. Cover a rejected rate-limit check leaving the rolling window unchanged. Validated by: `TypeSafeContracts.test_rate_rejection_does_not_append_timestamp` in `tests/test_5k_models_contracts.py`.
164. Cover a budget rejection taking precedence over acquiring a rate slot. Validated by: `TypeSafeContracts.test_budget_rejection_does_not_consume_rate` in `tests/test_5k_models_contracts.py`.
165. Cover scalar confidence as the display fallback when a choice has no probability map. Validated by: `TypeSafeContracts.test_missing_probabilities_fall_back_to_confidence` in `tests/test_5k_models_contracts.py`.
166. Cover selecting the highest-ranked answers before applying the display limit. Validated by: `TypeSafeContracts.test_ranked_probabilities_sort_before_limiting` in `tests/test_5k_models_contracts.py`.
167. Cover preserving System One choice insertion order. Validated by: `TypeSafeContracts.test_choice_builder_keeps_option_order` in `tests/test_5k_models_contracts.py`.
168. Cover a System One boolean question with a description for just one option. Validated by: `TypeSafeContracts.test_boolean_builder_keeps_single_optional_description` in `tests/test_5k_models_contracts.py`.
169. Cover the authored order of System One score levels. Validated by: `TypeSafeContracts.test_score_builder_keeps_level_order` in `tests/test_5k_models_contracts.py`.
170. Cover omission of the criteria field on an unlabeled boolean question. Validated by: `TypeSafeContracts.test_noul_without_labels_omits_criteria` in `tests/test_5k_models_contracts.py`.
171. Cover keeping provider order for equal probabilities. Validated by: `TypeSafeContracts.test_ranked_probability_ties_keep_provider_order` in `tests/test_5k_models_contracts.py`.
172. Cover the no-stream HTTP error path selecting an empty body. Validated by: `TransportContracts.test_error_stream_absent` in `tests/test_5k_models_contracts.py`.
173. Cover a request whose deadline has passed leaving the network unopened. Validated by: `TransportContracts.test_deadline_before_contact` in `tests/test_5k_models_contracts.py`.
174. Cover accepting a provider body exactly at the read limit. Validated by: `TransportContracts.test_read_reply_exact_limit` in `tests/test_5k_models_contracts.py`.
175. Cover the configured call timeout remaining the ceiling on probe duration. Validated by: `TransportContracts.test_probe_timeout_cannot_exceed_call_timeout` in `tests/test_5k_models_contracts.py`.
176. Cover forcing a status refresh while a prior probe is still fresh. Validated by: `TransportContracts.test_poll_forces_a_refresh_inside_cache_window` in `tests/test_5k_models_contracts.py`.
177. Cover IPv6 endpoint display retaining the port and literal brackets. Validated by: `TransportContracts.test_public_ipv6_retains_brackets_and_port` in `tests/test_5k_models_contracts.py`.
178. Cover loopback literals and local-machine aliases in endpoint classification. Validated by: `TransportContracts.test_ip_local_aliases` in `tests/test_5k_models_contracts.py`.
179. Cover explicit JSON negotiation on provider GET and POST requests. Validated by: `TransportContracts.test_headers_have_explicit_json_negotiation` in `tests/test_5k_models_contracts.py`.
180. Cover binding the requested source address before connecting a watched socket. Validated by: `TransportContracts.test_single_address_connect_passes_source_address` in `tests/test_5k_models_contracts.py`.
181. Cover retaining the HTTP reason phrase when a provider supplies no error body. Validated by: `TransportContracts.test_transport_error_reason_without_body` in `tests/test_5k_models_contracts.py`.
182. Cover skipping the probe thread pool when no endpoints are configured. Validated by: `RegistryContracts.test_empty_registry_never_starts_executor` in `tests/test_5k_models_contracts.py`.
183. Cover the configured decision endpoint choices in the unknown-name diagnostic. Validated by: `RegistryContracts.test_unknown_name_mentions_configured_choices` in `tests/test_5k_models_contracts.py`.
184. Cover accepting a provider's choice reply when it omits the default type field. Validated by: `ReplyContracts.test_decision_missing_type_is_compatible` in `tests/test_5k_models_contracts.py`.
185. Cover filtering unsolicited answers from a configured System One response. Validated by: `ReplyContracts.test_decision_drops_unsolicited_answers` in `tests/test_5k_models_contracts.py`.
186. Cover valid route and headlight choices arriving together in a decision reply. Validated by: `ReplyContracts.test_decision_existing_response_for_valid_optional_fields` in `tests/test_5k_models_contracts.py`.
187. Cover both token directions in unpriced System One statistics. Validated by: `ReplyContracts.test_unpriced_usage_still_counts_by_direction` in `tests/test_5k_models_contracts.py`.
188. Cover interpreting a useful LLM beam answer in a headlight-only request. Validated by: `ReplyContracts.test_optional_headlights_need_no_llm_candidate` in `tests/test_5k_models_contracts.py`.
189. Cover ignoring unrequested LLM motion alongside a valid candidate. Validated by: `ReplyContracts.test_llm_does_not_copy_unsolicited_motion` in `tests/test_5k_models_contracts.py`.
190. Cover the decision explanation staying out of required schema fields. Validated by: `ReplyContracts.test_response_format_reason_field_is_not_required` in `tests/test_5k_models_contracts.py`.
191. Cover joining multiple Anthropic system messages in their original order. Validated by: `ReplyContracts.test_anthropic_moves_all_system_messages_in_original_order` in `tests/test_5k_models_contracts.py`.
192. Cover a thinking-only reply producing no actuation text. Validated by: `ReplyContracts.test_anthropic_thinking_only_has_no_answer` in `tests/test_5k_models_contracts.py`.
193. Cover keeping an explicitly null System One option description. Validated by: `ReplyContracts.test_null_option_descriptions_survive_validation` in `tests/test_5k_models_contracts.py`.
194. Cover default request sequencing when the browser omits tick and epoch. Validated by: `ReplyContracts.test_request_identity_defaults` in `tests/test_5k_models_contracts.py`.
195. Cover omitting the system block when there is no cacheable system prompt. Validated by: `ReplyContracts.test_no_system_message_means_no_anthropic_cache_block` in `tests/test_5k_models_contracts.py`.
196. Cover preserving the original provider reply while thinning its Anthropic trace. Validated by: `ReplyContracts.test_anthropic_trace_keeps_original_response` in `tests/test_5k_models_contracts.py`.
197. Cover limiting the JSON schema to the route field for route-only chat calls. Validated by: `ReplyContracts.test_structured_chat_schema_for_route_only` in `tests/test_5k_models_contracts.py`.
198. Cover a provider-reported zero cost overriding a nonzero list-price estimate. Validated by: `ReplyContracts.test_usage_cost_zero_stays_authoritative` in `tests/test_5k_models_contracts.py`.
199. Cover preserving reusable Anthropic body settings after building a structured payload. Validated by: `CallContracts.test_anthropic_override_merges_without_mutating_config` in `tests/test_5k_models_contracts.py`.
200. Cover rejecting an unknown provider before dispatching its model-list request. Validated by: `CallContracts.test_no_catalog_key_is_sent_to_unknown_provider` in `tests/test_5k_models_contracts.py`.
