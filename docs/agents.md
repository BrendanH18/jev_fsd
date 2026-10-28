# Bring your own driving agent

The app has three kinds of driver, one button each in the HUD: **Rules** (deterministic code,
free), **Decision** (decision models: Jev, or any other model that answers typed questions with
probabilities) and **LLM** (any OpenAI-compatible chat model). Keys 1, 2 and 3 select Decision,
Rules and LLM.

Open `/arena` to evaluate Rules, Jev (when configured), the free cautious starter, your own
decision models and LLM endpoints, or your own agent on eight fixed challenges. The public demo uses `arena.html` and supports browser agents.
Select **Realtime** when comparing model latency or manual attempts; **Lockstep** waits for a
decision and measures the resulting choices. Changing clocks changes the experiment.

Copy `static/js/agents/cautious.js` to `static/js/agents/my-agent.js`. Change its default
definition's id and label, then open **Settings → Local agent module** and load
`/js/agents/my-agent.js`. On a project-hosted Pages site use `./js/agents/my-agent.js` instead.
The arena has the same loader. A loaded definition is scoped to that page; load it again in
another tab. Modules are trusted JavaScript, not sandboxed plugins.

```js
export default {
  id: "my-driver",
  label: "My driver",
  create: () => ({
    async decide(snap, eligible, request, signal) {
      // snap: the observed world; eligible: candidates that passed shared safety checks.
      // Each candidate includes id, law, steer, speed and sim (3-second prediction).
      const candidate = eligible.reduce((best, c) =>
        c.sim.progress_m > best.sim.progress_m ? c : best);
      return {
        motion: "drive", // "drive", "stop" or "reverse"
        candidateId: candidate.id,
        meta: { source: "my-driver", model: "my-driver",
          latency_ms: 0, input_tokens: 0, cost_usd: 0 }
      };
    }
  })
};
```

The harness rejects an invalid candidate or motion and falls back to Rules. The decision
timeout is 1.5 seconds even if an agent ignores the abort signal; stale results cannot execute.
The emergency brake and safety filtering remain shared. An agent can still choose a poor
eligible manoeuvre, and the simulator still audits collisions and violations.

For a remote model, the easiest route is a [decision model](#decision-models-jev-and-others) or an
[LLM endpoint](#llm-endpoints-test-your-own-model): no code, and the local server keeps the key. To write your own adapter instead, implement
`decide` using `request.state` and `request.questions`, with the supplied abort signal. Keep
provider keys behind a server endpoint, as `JevBrain`, `DecisionBrain` and `LlmBrain` do; GitHub Pages has no
private server or secret store. Return measured latency, token counts and cost in `meta`; set
`live_call: true` for a remote request. An agent factory should return a fresh instance for
each run. Stateful agent internals are not rewound by the simulator's replay recorder.

## Decision models: Jev and others

A decision model takes a state and typed questions and returns each answer with probabilities.
Jev introduced the protocol (TypeSafe's System One API, `POST /v1/systemone` with
`{model, state, questions}`), and other services now speak it with the same request and answer
shapes: OpenRouter's Decisions API (`POST /api/alpha/decisions`) serves Jev, Perplexity Decider,
Liquid d1, Microsoft Decision 1, GPT-6 Luna Decisions and others with one key, and llama.cpp
0.6.0 or later serves open models such as Kev 4B at `/v1/systemone`. Jev is the built-in decision
driver, `jev`; every other decision model you connect becomes its own driver, `decision:<name>`,
in the HUD's **Decision ▾** menu, **Settings → Active agent**, the challenge picker, replay
branches, the arena and the `/bench` brain list.

Every decision model receives exactly the state and questions Jev does (built by
`static/js/brain/state.js`): which manoeuvre to take among those that passed the safety filter,
whether to drive or stop when that is in question, and which route when there are several. So
a comparison between Jev and another decision model measures the model, not the prompt. These
drivers have been tested only against a local mock server, not against TypeSafe, OpenRouter or
llama.cpp.

### Connect a decision model in the app

Click **Decision** (or press 1) when no decision model is usable, or choose **Decision ▾ →
Connect a decision model…**. The **Connect a model** dialog opens on its **Decision models** tab:

- **TypeSafe** is the API option for Jev. Paste a TypeSafe key and save: the key is written to
  `.env` as `TYPESAFE_API_KEY`, the variable the built-in Jev driver reads, and Jev becomes
  available at once, without a restart. The model starts on the built-in driver's model
  (`jev-latest` unless `TYPESAFE_DEFAULT_MODEL` says otherwise). Choosing another version, such as
  `jev-preview`, saves it as a driver of its own (`decision:jev-preview`) on the same key, so the
  two can be compared.
- **OpenRouter** lists every model OpenRouter offers with the `decisions` output modality
  (`GET /api/v1/models?output_modalities=decisions`, which needs no key), with prices. The key is
  `OPENROUTER_API_KEY`, the same variable the LLM tab uses, so one key serves both pillars; saving
  it in either tab makes it available to both at once. OpenRouter reports each call's cost
  (`usage.cost`), which is counted instead of the listed price.
- **llama.cpp** points at `http://localhost:8080` and needs no key.
- **Other** takes the URL of any server that answers `POST {URL}/v1/systemone`. A key typed here
  is private to that endpoint (`JEV_FSD_DECISION_KEY_<NAME>_<hash>`) and is never sent to a new URL.

The key handling is the same as for LLMs below: `.env` must be gitignored and untracked, it is
written atomically and kept owner-only, and the key never comes back to the browser.

The built-in `jev` driver always calls TypeSafe directly, even when only an OpenRouter key is
saved. Replays, fixtures and saved benchmark runs that say `jev` then keep meaning TypeSafe's
API, its price and its latency. OpenRouter's Jev is one click away as its own driver instead
(`typesafe/jev-1.13` or `~typesafe/jev-latest` in the OpenRouter list).

The **Decision** button drives with the last decision model chosen, else Jev, else the first
usable one. Respan's Span-01 accepts only yes/no questions with plain-string criteria, so expect
it to refuse this app's choice questions; each refusal falls back to Rules.

### Configure decision models by hand

```sh
cp data/decision-endpoints.example.json data/decision-endpoints.json   # gitignored
```

```json
{"endpoints": [
  {"name": "pplx-decider", "label": "Perplexity Decider (OpenRouter)", "base_url": "https://openrouter.ai",
   "path": "/api/alpha/decisions", "check_path": "/api/v1/key", "model": "perplexity/pplx-decider-v1.1-27b",
   "api_key_env": "OPENROUTER_API_KEY", "price_per_mtok_input": 0.02},
  {"name": "kev-4b", "base_url": "http://localhost:8080", "model": "kev-4b", "timeout_s": 20, "rpm": 0}
]}
```

| Field | Default | Meaning |
|---|---|---|
| `name` | required | Driver id `decision:<name>`; lowercase letters, digits, `-`, `_` |
| `base_url`, `model` | required | The server root (without the path) and the model it expects |
| `path` | `/v1/systemone` | Where decisions are posted; `/api/alpha/decisions` for OpenRouter |
| `check_path` | `/v1/models` | A free GET for the status label; `/api/v1/key` for OpenRouter checks the key |
| `label`, `api_key_env`, `rpm` | | As for LLM endpoints |
| `price_per_mtok_input`, `price_per_mtok_output` | none | USD per million tokens, used when the reply has no `usage.cost` |
| `timeout_s` | `5` | Total server deadline for one decision (1–60); the browser waits 0.75 s more. There are no retries: a late decision is already stale |

`JEV_FSD_DECISION_ENDPOINTS` points at a different file. Restart after editing it by hand.

**Answers.** The server checks every answer against the question it was asked: it must be a
choice, and the choice one of the offered options. Probabilities outside 0–1, for options that
were not offered, or not numbers are dropped. A missing or unusable answer to the route question
is ignored: the car keeps the first route, which it already follows, and the question is not asked
again. Any other unusable answer is an
invalid reply: the browser falls back to Rules for that decision, and the call still counts with
its tokens and cost. HTTP errors are reported as they come: 401 or 403 (key rejected), 402
(OpenRouter: out of credits), 429 or 529 (rate limited or overloaded), 4xx validation errors
with the provider's message. The status label uses the endpoint's `check_path`: *unreachable*,
*key rejected* or *no key*, as for LLMs. Budget, rate limit, redirects, key scrubbing and the
total deadline work exactly as for LLM endpoints below.

## LLM endpoints: test your own model

The driver speaks the OpenAI Chat Completions protocol (`POST {base_url}/chat/completions`),
so it should work with servers that offer it: OpenAI, OpenRouter, Together, Groq, vLLM,
LM Studio, Ollama, Anthropic's OpenAI-compatible endpoint and others. It has been tested only
against a local mock server, not against any of these providers, so expect to adjust
`response_format`, `max_tokens` or `extra_body` for some of them. Each configured endpoint becomes its own driver,
`llm:<name>`, in **Settings → Active agent**, the challenge picker, replay branches, the
[arena](http://127.0.0.1:8322/arena) and the [`/bench`](http://127.0.0.1:8322/bench) brain list,
so several models can be compared side by side under identical conditions.

### Connect a model in the app

The quickest way: in the drive app, click **LLM** next to Rules and Decision (or **LLM ▾ → Connect a
model**, or **Settings → Connect a model** and its **LLMs** tab).

1. Pick a provider: OpenRouter, OpenAI, Groq, Ollama, LM Studio, or **Other** for any
   OpenAI-compatible URL.
2. Paste your API key (local servers need none). **Get a key** links to the provider's key page.
3. Choose a model. The list loads from the provider's `/models` (OpenRouter lists without a key,
   with prices); type to search, or type any model id.
4. **Save and drive.**

The server saves the key in `.env` under the provider's usual variable (`OPENROUTER_API_KEY`,
`OPENAI_API_KEY`, `GROQ_API_KEY`) and adds the endpoint to `data/llm-endpoints.json`, then reloads
without a restart. It refuses to write the key unless `.env` is gitignored and untracked, and keeps
the file owner-only. The key is never sent back to the browser; the dialog only shows whether one is
saved. A preset always uses its provider's URL, so a saved provider key only goes to that provider.
An **Other** endpoint's key gets a variable of its own (`JEV_FSD_LLM_KEY_<NAME>_<hash>`), and moving it to a
different URL needs the key again. If the variable is also set in the shell that started the
server, the shell value wins; the dialog says so.

With prices (filled in from OpenRouter's list, or typed), spend counts toward
`JEV_FSD_BUDGET_USD`. The **LLM** button drives with the last model chosen; the ▾ menu switches
models, and **Connect or manage models…** adds or removes them. Removing an endpoint keeps a
provider key in `.env` (other endpoints may use it) but deletes an **Other** endpoint's own key.
Options the dialog does not show, such as `extra_body`, survive saving the same model again.

### Configure by hand

Copy the template and keep the entries you want:

```sh
cp data/llm-endpoints.example.json data/llm-endpoints.json   # gitignored
```

Keys never go in that file. `api_key_env` names a variable in `.env` (or the environment), and
the server refuses an entry that contains an `api_key` field. An endpoint with a key must use
`https://` unless it is on this machine or your local network. Restart the server after editing
either file by hand (the dialog reloads by itself); the startup banner lists each endpoint and any configuration problems.

**OpenAI**

```json
{"endpoints": [
  {"name": "gpt-4o-mini", "label": "GPT-4o mini", "base_url": "https://api.openai.com/v1",
   "model": "gpt-4o-mini", "api_key_env": "OPENAI_API_KEY",
   "price_per_mtok_input": 0.15, "price_per_mtok_output": 0.60}
]}
```

Then add `OPENAI_API_KEY=sk-...` to `.env`. Reasoning models that reject `max_tokens` or
`temperature` can drop them and pass their own options:
`"max_tokens": null, "temperature": null, "extra_body": {"max_completion_tokens": 600, "reasoning_effort": "low"}`.

**OpenRouter**

```json
{"name": "llama-70b", "base_url": "https://openrouter.ai/api/v1",
 "model": "meta-llama/llama-3.3-70b-instruct", "api_key_env": "OPENROUTER_API_KEY",
 "response_format": "json_object"}
```

**Ollama** (`ollama pull llama3.2` first; no key)

```json
{"name": "ollama", "base_url": "http://localhost:11434/v1", "model": "llama3.2", "timeout_s": 20, "rpm": 0}
```

**LM Studio** (start the local server in LM Studio's Developer tab; no key)

```json
{"name": "lmstudio", "base_url": "http://localhost:1234/v1", "model": "qwen2.5-7b-instruct", "timeout_s": 20, "rpm": 0}
```

For a single endpoint you can skip the file and set `JEV_FSD_LLM_BASE_URL`,
`JEV_FSD_LLM_MODEL` and, if needed, `JEV_FSD_LLM_API_KEY` in `.env`; it appears as
`llm:default` (rename it with `JEV_FSD_LLM_NAME`). See `.env.example` for the price and timeout
variables. `JEV_FSD_LLM_ENDPOINTS` points at a different config file.

| Field | Default | Meaning |
|---|---|---|
| `name` | required | Driver id `llm:<name>`; lowercase letters, digits, `-`, `_` |
| `base_url`, `model` | required | The API root (up to `/v1`) and the model name it expects |
| `label` | `name` | Name shown in pickers and results |
| `api_key_env` | none | Variable holding the key; omit for local servers that need none |
| `price_per_mtok_input`, `price_per_mtok_output` | none | USD per million tokens; without them cost is reported as unknown ($0) and the budget cannot stop the endpoint |
| `timeout_s` | `10` | Total server deadline for one decision, covering the TCP connect, any proxy tunnel, the TLS handshake, the whole reply and any plain retry; only DNS lookup is outside it (1–60); the browser waits 0.75 s more |
| `response_format` | `json_schema` | `json_schema`, `json_object` or `none` |
| `max_tokens`, `temperature` | `400`, `0` | Sent when not `null` |
| `rpm` | shared | This endpoint's own calls-per-minute cap instead of the shared `JEV_FSD_RPM`; `0` = no rate limit at all |
| `extra_body` | `{}` | Extra request fields, e.g. `reasoning_effort`; cannot replace model or messages |

**Status.** Pickers label each endpoint: unlabelled when the server can reach it, or
*unreachable*, *key rejected* or *no key* (set the named variable). The server checks with
`GET {base_url}/models`, which costs nothing. An endpoint without its key stays listed but
cannot be selected. The public browser demo has no server, so LLM drivers are not offered there.

**What the model sees.** The prompt lives in one place, `static/js/brain/llm-prompt.js`; edit
it and reload the page. The system message explains the input and says *when* each kind of
manoeuvre is correct. The user message is the same decision state Jev receives, as compact JSON:
the driving style, the plain-language situation rules, observed speeds, gaps, signals, traffic
and pedestrians, the lanes on multi-lane streets (which lane the car and its route are in, the gaps
beside it, and how far it has to return or get into the lane for a turn), on a left turn at a signal or a stop sign the oncoming vehicle it must wait for (`intersection.oncoming`), at an all-way stop its place in the order (`intersection.priority`: whether it has stopped at the line, whether it is its turn, and who goes first), on a right turn at a red light whether it may turn on red (`intersection.right_on_red`: the full stop made, the way clear, and what it waits for), at a two-way stop or a junction without a sign or signal whether it must give way (`intersection.give_way`: whether the way is clear, whom it waits for, whether buildings hide the street it gives way to, and where it stops; `intersection.right_of_way` says which rule applies without a sign), on a right turn the cyclist on its right it must let go by first (`cyclist_on_right`: when the cyclist reaches the corner, how long the car needs to turn, and where it waits), an emergency vehicle with its siren on calling on it to give way (`emergency_vehicle`: an ambulance or a fire truck, where it comes from, how far away it is and when it reaches the car, whether the car can see it or only hear it, how far right to pull over and where to stop, `clear_junction_first` when that is past a junction, or `stuck_behind_car` when it should drive on ahead instead; the candidate is `pull_over`) and one it has let go by, which it keeps 150 m behind (`emergency_vehicle_ahead`), a bus ahead at its stop signalling to pull out into the car's lane that the car must let out (`bus_pulling_out`: its route, how far ahead it is, where the car stops 2 m behind it, and whether it is already moving out; the candidate is `yield_to_bus`), a vehicle in the next lane stopped at a marked crosswalk ahead that the car must not pass (`stopped_at_crosswalk`: how far ahead the crosswalk is and where the car stops, 3.5 m short of its centre, to look; the candidate is `stop_at_crosswalk`; once the car has stood still there for 2 s it is no longer held), a school bus ahead on its route, going its way or coming toward it, stopped with its red lights flashing (`school_bus`: whether it is coming toward the car, how far ahead it is and where the car stops, 5 m behind it or 10 m short of its front; the candidate is `stop_for_school_bus`; with its amber lights it is `about_to_stop`, and the car slows down, ready to), a school or playground zone in effect that the car is in or that starts within 80 m along its route (`speed_zone`: which kind, the school's name, its limit, when it is in effect, and where it starts and ends; `car.limit` is already the zone's inside it, and `car.target_speed` slows the car to it by the sign), where its route makes a U-turn at a dead end how far ahead it stops to turn round (`nav.turn_round_in_m`) and, once it is turning round with a three-point turn, which leg it is on (`turnaround`; the candidates are `stop_to_turn_round` and `turn_around`), the eligible candidates with their 3-second predictions
(`end_speed`, `vs_target`, `progress_m`, comfort, clearance, `outcome`), the definitions of `drive` and `stop`
when that question is asked, and the ids it may answer with. Computed targets such as
`car.target_speed` and each candidate's `vs_target` are handed over, so the model never needs
arithmetic. **Inspect JSON** shows the exact messages under *Questions*, the raw reply under
*Answers*, and **Copy as curl** reproduces the request with `$YOUR_KEY_VARIABLE`.

**What it must answer.** One JSON object, for example
`{"motion": "drive", "candidate": "keep_lane_target"}`. When the endpoint supports it, the
server requests structured output whose schema enumerates exactly the offered ids. An endpoint
that rejects `response_format` is called in plain mode from then on; the rejected decision is
retried without it only when more than 1.5 times the first attempt's duration remains of
`timeout_s`, and otherwise falls back to Rules.
Parsing is lenient about form (code fences, prose around the JSON, `<think>` blocks, key
spelling, case) and strict about content: the motion and candidate must be among the offered
values. The browser then re-checks the choice with `validAgentChoice`.

**Fallbacks.** The model only ever chooses among candidates that already passed the shared
safety filter; the controller and emergency brake still run underneath it. When the reply is
not usable, the call times out, the endpoint returns an HTTP error (429, 5xx, 401), the key is
missing or the budget is spent, Rules makes that decision instead, exactly as for Jev. The HUD
shows an amber `rules_fallback` tag with the reason, the fallback counter increases, and arena
timelines record a *fallback* event with the reason. A call whose reply was unusable (not JSON
inside, an unoffered id, a completion with no message or one nested too deeply to parse) still
counts as a call with its reported tokens and cost; a completion too deep to parse reports no
tokens. A usage count that is missing or not a finite number is recorded as 0 tokens, and the
answer is still used. Decisions with nothing to ask (one eligible manoeuvre and no stop
question) are made locally without a call.

**Cost and limits.** Every LLM call shares Jev's per-run budget (`JEV_FSD_BUDGET_USD`) and rate
limit (`JEV_FSD_RPM`). With prices set, the HUD, bench and arena report cost from the returned
token usage; without prices they report tokens and $0, so `JEV_FSD_BUDGET_USD` cannot stop that
endpoint and only the rate limit applies. A lockstep run makes several calls per simulated second, far
faster than real time, so a fast model can reach the shared 240-per-minute cap within a
minute; every call after that falls back with *Local rate limit* as the reason. Raise
`JEV_FSD_RPM`, or give the endpoint its own `rpm`. `rpm: 0` removes the rate limit for that
endpoint; the budget still applies, but only to spend it can price, so an unpriced endpoint
with `rpm: 0` has no limit at all. Use that for free local servers only. Each HTTP attempt,
including a plain retry, passes the budget and rate checks and counts toward the rate limit.
Use **Lockstep** to compare decision quality: the simulation
waits for each answer. **Realtime** includes latency, so a slow model drives on its previous
choice for longer. The decision deadline is the endpoint's `timeout_s`, not Jev's 1.5 s: one
deadline on the server for the TCP connect, any HTTPS proxy tunnel, the TLS handshake, the
headers, the whole body and any plain retry, after which the call fails as a timeout. Only DNS
resolution falls outside it; the system resolver's own timeout bounds that.

**Security.** The browser sends only the endpoint *name*, the prompt and the allowed ids; the
URL, model and key come from server configuration, so a page cannot redirect calls elsewhere.
The browser sees each endpoint's base URL with any credentials, query and fragment stripped;
keys and the choice of destination stay on the server. The routes use the same host, origin,
fetch-metadata and session-token checks as Jev. The configured key value is scrubbed (exact
match) from responses, traces and error messages, and redirects are refused rather than
forwarding the key. Prompts go to whichever provider you configure.

Evaluation exports include every result, per-challenge version, map-pack version, seed, weather,
time, vehicle, decision clock, time limit, simulation version and scoring version. A pass
requires arrival, zero collision/red-light/stop/yield incidents,
and less than one second off-road. Coaching scores are reported separately. Stopped and
timed-out evaluations are labelled and never become passes. These are local results; the app
does not upload them to a public leaderboard. Your browser's saved challenge attempts appear
below the results and label manual, mixed and replay-branch drives.

## Saved evaluations and comparisons

Evaluations save automatically to this browser, including completed attempts from a stopped
or failed suite. **View** reopens a saved run; **Export results** downloads the selected run
with its original timestamp. **Import JSON** validates a v1 or v2 export as data and saves it
locally without executing any agent. Up to ten runs fit within a 6 MB history budget (counted
as two bytes a character: room for a baseline and a new run of every challenge); older runs are
dropped first, the chosen baseline last. Storage failures leave the current run available for export. Imports
are limited to 5 MB. **Delete saved run** removes only the selected saved evaluation.

Choose **Compare against**, then a **Baseline driver**. Each current driver is compared with
that driver on matching challenges only. Versions, map, seed, weather, time, vehicle, clock
and time limit must match. Stopped attempts, duplicate matching baseline rows and missing
conditions do not produce deltas. Summary deltas use only matched pairs, so a partial suite
is never compared with a whole suite. Pass-rate changes are percentage points; latency in
summaries is the mean of individual runs' p50 values, not a pooled percentile. These imported
results are self-reported, with no server verification. Legacy v1 exports can be viewed,
but their missing simulation version and time limit prevent comparisons with v2 runs.

Click an agent's name in a result row to inspect its timeline. Audited collisions, red lights,
missed stops, failed yields, hard brakes, the off-road failure threshold, hazard triggers,
emergency brakes, fallbacks and termination events retain their simulation timestamps.
Arena hard-brake counts use the coaching model's events so the totals match the timeline.
Expand an event to see the most recent executed decision, its age, selected candidate,
eligible and rejected options, hazard flags and observed state. Other decisions retain a
compact choice record; full snapshots are kept around timeline events to bound storage use.
This temporal association does not establish causation. Recorded observation state does not
expose unseen hazards.
Older exports retain their scoring incidents but have no recorded decision context.
Traces retain at most 600 decisions and 1,000 events per attempt; truncation is labelled.
This is a decision log, not a saved 3D replay or a capture of custom-agent internals.

Run `node scripts/test_drive_lab.mjs` after changing an
agent or scenario, and `node scripts/test_llm_agent.mjs` plus `uv run python -m unittest
discover tests -p 'test_llm*.py'` after changing the LLM prompt, adapter, server proxy or setup dialog.
For decision models, run `node scripts/test_decision_agent.mjs` and `uv run python -m unittest
discover tests -p 'test_decision.py'`. For broader driving changes, also run the existing seeded city benchmark.
Run `node scripts/test_arena_history.mjs` after changing history, comparisons or trace formats.
These commands require Node 22 or newer. With a running app, run
`uv run --with playwright python scripts/test_arena_browser.py` for the complete arena workflow (CI runs it on every pull request); use `--url` for a
static demo and `--chromium` for an existing browser executable.
