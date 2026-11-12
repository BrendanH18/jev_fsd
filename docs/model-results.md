# Model results

The first live results for model drivers (ROADMAP Phase 2). Everything here was run on
11 November 2026 from commit `ce670cd` (the simulation, sensing, candidates and question wording
unchanged), Node 22.23.4, lockstep clock, each challenge's own authored seed, weather, time and
traffic. Every model drive below is committed as a recording under `data/recordings/` and replays
exactly with no key and no model call:

```sh
PORT=8331 uv run server.py
node --experimental-default-type=module scripts/arena_node.mjs --replay data/recordings/jev-arena-2026-11-11.json.gz --check 1
```

A recording replays exactly only on the JavaScript engine it was made on (here V8, through Node).
The per-drive results are in `data/results/2026-11-11/`.

## The 60 challenges and the 2 road tests

| Driver | Model | Passed | Model's own decisions | Rules fallbacks | Hard brakes | Emergency brakes | Driving time | Cost |
|---|---|---|---|---|---|---|---|---|
| Rules | none | 62 / 62 | n/a | n/a | 132 | 1 | 3,518 s | $0 |
| Cautious agent | none (browser agent) | 62 / 62 | 99.98% | 0 | 182 | 0 | 3,877 s | $0 |
| Jev | `jev-1.14.0` (asked as `jev-latest`) | 62 / 62 | 99.95% | 1 (a timeout) | 137 | 5 | 3,785 s | $1.26 |
| DeepSeek V4.1 Flash (LLM) | `deepseek/deepseek-v4.1-flash-1017`, reasoning off | **61 / 62** | 99.0% | 7 (timeouts) | 148 | 0 | 3,815 s | $2.55 |

"Model's own decisions" is `model_share` (ROADMAP 2.4), weighted by decisions; Jev answered
12,096 of its 12,102 decisions itself, 5 were answered locally and 1 fell back to Rules, so, as 2.4
predicted, the local share is near zero.
"Emergency brakes" are the shared emergency brake stepping in under the driver
(`safety_brakes`): twice in `right-on-red`, twice in `on-your-bumper` and once in `zipper` for Jev.
None of them led to a failure. Jev took 7.6% longer over the set than Rules, most of it in
`road-closed` (93 s longer) and `into-the-sun` (34 s longer); the recordings show each decision
for anyone who wants to see why.

**DeepSeek fails `double-parked`** (Toronto: a van stands double-parked in the car's lane): it
stopped behind the van and stayed there. It answered "stop, `keep_lane_stop`" to 577 of its 674
calls, though a lane change to the left (`left_1_target`) was among the safe options at least 55
times; it timed out at 180 s, and in the little it did move it also failed to yield once. Rules
finished in 33 s. Apart from that drive DeepSeek drove much as Jev did: 1% of its decisions were
answered locally (questions with one eligible answer, mostly the motion question), 7 fell back to
Rules when the provider took more than 10 s, and it never needed the emergency brake. Its median
call took 0.61 s (p95 1.30 s), with 6,187 input tokens (p95 6,991), at $0.00021 a decision as
billed: prompt caching brought it down from the $0.00031 of the pilot.

The other three drivers pass everything, so on pass or fail this set tells only DeepSeek apart, and
on one drive. That is the problem ROADMAP Phase 4 is for: every option offered to a driver has
already passed the safety filter.

### Other model drivers, one challenge each

These were pilots to price and check each driver before a full run, on `door-zone` (Kitsilano,
dry). Each passed, with every decision the model's own and no fallback.

| Driver | Model | Where | Decisions | Billed cost a decision | Latency p50 / p95 |
|---|---|---|---|---|---|
| `llm:deepseek` | `deepseek/deepseek-v4.1-flash-1017` | OpenRouter | 170 | $0.00031 | 0.64 / 1.43 s |
| `llm:luna` | `openai/gpt-6-luna` | OpenRouter | 165 | $0.00049 | 1.24 / 4.33 s |
| `decision:liquid-d1` | `liquid/d1-20260930` | OpenRouter Decisions API | 185 | $0.00005 | 0.48 / 0.64 s |
| `llm:granite` | `granite4.2:3b` | Ollama, this Mac | 240 (`dont-splash`, `left-on-red`) | $0 | about 1 s |

LLM prompt version (the hash of `SYSTEM_PROMPT` in `static/js/brain/llm-prompt.js`):
`971452a84ca8b571`. DeepSeek's full run is `data/recordings/deepseek-arena-2026-11-11.json.gz`
(1.2 MB), recorded in five shards on one server and merged; it replays exactly.

## The city suite

| Driver | Kitsilano, dry / fog / rain / snow | Other 11 maps, two routes each, dry | Runs |
|---|---|---|---|
| Rules | 12 / 12 / 12 / 12 | 22 / 22 | `data/runs/20261111-130206-rules` to `-130221-rules` |
| Cautious agent | 10 / 10 / 12 / 6 | 16 / 22 | `data/runs/20261111-172000-cautious` to `-172014-cautious` |

The cautious agent's failures: Kitsilano dry `s1-1` collision with a pedestrian and `s1-12` braked
hard with a tailgater close behind; fog `s1-1` timeout and `s1-8` failed to yield; snow `s1-2`,
`s1-6`, `s1-12` failed to yield, `s1-3` timeout, `s1-4` collision and failed to yield, `s1-10`
stuck; Edmonton and Montreal `s1-1` stuck, Québec City `s1-1` and Toronto `s1-2` timeouts,
Winnipeg `s1-1` failed to yield. Rules was tuned on this suite in Phase 1 and the cautious agent
was not, so read this as a measure of the suite, not of the agent alone.

**Jev has no city result yet.** A Jev run of Kitsilano dry was made and is not published, because
15% of its decisions fell back to Rules for reasons that had nothing to do with the model:

- 1,806 requests (15%) were refused before they left the server, because the question's
  instructions were longer than the 2,000 characters `jev/decide.py` allowed. City routes switch
  on many features at once, and each adds a situation clause; the longest vector question on
  Kitsilano city dry is 2,970 characters. Jev accepts 6,000 (checked live), so the limit is now
  6,000.
- 1,301 calls hit the server's own rate limit (`JEV_FSD_RPM`, 2,000 a minute), because three
  runs shared one server.

Both are fixed or avoidable now; the run needs repeating (about $1.40 of Jev calls).

## Live check of the saved cases (ROADMAP 2.1)

`uv run scripts/verify_jev.py`, 11 November 2026, model `jev-1.14.0`: **39 of 39 pass** (the 11
fixtures in `static/tests/fixtures/jev/` and the 28 cases in `data/snapshots/`), total $0.0039.
No wording needed fixing. Two are close calls between two acceptable answers:
`building_hidden_traffic` (keep_lane_stop 51%, hard_brake 49%) and `following_brake`
(keep_lane_stop 55%, hard_brake 45%).

| Case | Answer (top probability) | Input tokens |
|---|---|---|
| amber_clear | drive 83%, keep_lane_target 61% | 3,104 |
| amber_stop | stop_at_line 83% | 2,737 |
| bridges_freeze_first | drive 100%, slow_for_ice 98% | 3,250 |
| building_hidden_traffic | keep_lane_stop 51% | 1,036 |
| car_ahead | drive 99%, stop_at_line 87% | 2,163 |
| chasing_the_ball | slow_for_ball 90% | 2,317 |
| clear_road | keep_lane_faster 66% | 965 |
| crosswalk_approach | drive 70%, stop_for_pedestrian 87% | 2,442 |
| crosswalk_at | stop 100%, keep_lane_stop 100% | 1,419 |
| cyclist_ahead | drive 100%, keep_lane_target 51% | 3,535 |
| dont_splash | ease_round_puddle 99% | 3,516 |
| fog_unseen_traffic | keep_lane_cautious 60% | 2,425 |
| follow_the_officer | drive 63%, wait_for_officer 84% | 2,768 |
| following_brake | keep_lane_stop 55% | 1,266 |
| following_merge | drive 100%, keep_lane_target 83% | 2,555 |
| goose_crossing | drive 93%, wait_for_geese 96% | 3,219 |
| green_light | drive 100%, keep_lane_target 94% | 1,768 |
| into_the_sun | keep_lane_target 60% | 1,994 |
| left_on_red_clear | drive 92%, keep_lane_cautious 27% | 2,588 |
| left_on_red_traffic | stop 100%, keep_lane_stop 99% | 1,752 |
| mid_block_approach | drive 84%, stop_for_pedestrian 81% | 2,453 |
| mid_block_at | stop 100%, keep_lane_stop 99% | 1,432 |
| mid_block_cleared | keep_lane_cautious 73% | 2,491 |
| no_turn_on_red | stop 100%, keep_lane_stop 99% | 1,659 |
| on_your_bumper | let_tailgater_pass 99% | 2,223 |
| one_car_at_a_time | drive 93%, wait_for_oncoming_narrowing 95% | 3,608 |
| open_door | drive 99%, keep_lane_target 52% | 2,884 |
| parking_car | drive 99%, keep_lane_target 63% | 3,452 |
| pothole_season | ease_round_pothole 93% | 3,236 |
| pulling_out | drive 99%, keep_lane_target 59% | 3,453 |
| red_light | stop 100%, keep_lane_stop 98% | 1,493 |
| red_light_far | drive 100%, stop_at_line 94% | 1,287 |
| reverse_lights | drive 86%, yield_to_reversing 97% | 3,318 |
| road_closed | drive 96%, stop_for_closure 94% | 3,495 |
| room_to_park | drive 83%, wait_for_parker 93% | 3,708 |
| stop_sign_at_line | stop 100%, keep_lane_stop 99% | 1,550 |
| stop_sign_completed | drive 100%, keep_lane_target 98% | 1,872 |
| stop_sign_far | drive 100%, stop_at_line 81% | 1,317 |
| turn_ahead | keep_lane_target 90% | 1,460 |

## What a decision costs (ROADMAP 2.2)

| | Input tokens p50 / p95 / max | Latency p50 / p95 | Cost a decision, mean / max |
|---|---|---|---|
| Jev, plain road (`clear_road`) | 965 | 59 ms | $0.00004 |
| Jev, busiest saved case (`room_to_park`) | 3,708 | 76 ms | $0.00016 |
| Jev, 62 challenges and road tests | 2,372 / 3,696 / 4,810 | 69 / 105 ms | $0.00010 / $0.00020 |
| Jev, Kitsilano city dry | 3,391 / 4,478 / 5,225 | 77 / 121 ms | $0.00014 / $0.00022 |
| An LLM, any of them | 5,200 to 7,000 (the system prompt alone is about 5,000) | see above | see above |

Jev's price is $0.042 a million input tokens. The city suite, with every free-drive feature on, is
now the costliest place to drive: its median request is 43% larger than a challenge's.

**The ceiling.** A new situation clause, or new question wording, must keep:

- each question's instructions under **4,000 characters** on the city suite (today's longest is
  2,970; the server refuses anything over 6,000, and Jev's own limit is at least that);
- a Jev decision under **5,500 input tokens**, about $0.00023 (today's longest is 5,225);
- the LLM system prompt under **6,000 tokens** (about 5,000 today).

## Endpoints checked against real providers (ROADMAP 2.3)

| Kind | Provider | Model | Result |
|---|---|---|---|
| Decision model, hosted | TypeSafe, through `decision:<name>` | `jev-latest` (`jev-1.14.0`) | works; the same choices as the built-in `jev` driver on three saved cases |
| Decision model, hosted | OpenRouter Decisions API | `liquid/d1` | works; drove `door-zone` |
| Decision model, hosted | OpenRouter Decisions API | `perplexity/pplx-decider-v1.1-27b` | **gone**: HTTP 404, removed from the examples |
| LLM, hosted | OpenRouter | `openai/gpt-6-luna`, `openai/gpt-6.1-terra`, `deepseek/deepseek-v4.1-flash-1017` | work with the default `json_schema` format and reasoning turned down |
| LLM, local | Ollama 0.40.9 on an Apple-silicon Mac | `granite4.2:3b` | works once the context is raised and thinking is off (below) |

What needed changing:

- **Ollama's default context is 4,096 tokens**, smaller than the prompt; Ollama refuses the
  request with HTTP 400. Start it with `OLLAMA_CONTEXT_LENGTH=16384 ollama serve`.
- **Thinking models reply with nothing**: Granite 4.2 spent all 400 `max_tokens` thinking. Add
  `"extra_body": {"reasoning_effort": "none"}` (Ollama) or `{"reasoning": {"effort": "minimal"}}`
  (OpenAI models on OpenRouter).
- **The LLM driver ignored the provider's billed cost.** OpenRouter reports `usage.cost`; the
  decision-model driver used it, the LLM driver priced tokens at the configured list price. For
  DeepSeek V4.1 Flash the list in OpenRouter's model catalogue said $0.006 a million input tokens
  and the bill came to about $0.05: seven times the estimate, which the budget guard never saw. Both
  drivers now use `usage.cost` when it is reported (`reported_cost` in `jev/endpoints.py`).

llama.cpp has not been tried.

## Spend and what went wrong

The budget for this first comparison was $5 ([D2](../ROADMAP.md#open-decisions)). About **$5.79**
was spent: $3.16 with TypeSafe (live check $0.004, the 62 Jev drives $1.05, the 14 re-recorded
$0.45, the unpublished city run $1.66) and $2.63 with OpenRouter (smoke tests and pilots about
$0.25, the stopped DeepSeek and Luna runs the rest). The overrun came from the cost estimate
above; the runs were stopped as soon as the bill was checked. The budget was then raised for
DeepSeek's full run, which cost $2.57 more, with the server's count (now the billed cost) matching
OpenRouter's to within 2 cents: **about $8.36 in all** to date.

Two things to avoid next time:

- **Several runs against one server share its rate limit.** The first Jev challenge run overlapped
  the city run, and 14 of its drives lost 1,545 decisions to the server's own 429. Those 14 were
  recorded again on their own server; the published recording has them. Give each parallel run its
  own server, or raise `JEV_FSD_RPM`.
- **Recordings used to be written only at the end.** Stopping a run lost its finished drives.
  `arena_node.mjs` and `bench_node.mjs` now save after every drive.

## What is still open for 2.5

- Jev on the city suite, at least Kitsilano dry (about $1.40).
- An LLM on the city suite: DeepSeek on Kitsilano dry would cost about $2.10 (10,000 decisions).
- A second LLM over the 62 drives, if wanted: GPT-6 Luna about $5.50 at billed prices. A larger LLM
  such as GPT-6.1 Terra (about $0.0055 a decision) costs about $60 for the 62 drives, so it needs a
  smaller set or a bigger budget.
