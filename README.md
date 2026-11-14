# Jev Drive Lab

**A driving test for AI models, on real Canadian streets, that you can also take yourself.**

[**▶ Play it in your browser**](https://brendanh18.github.io/jev_fsd/) — no install, no account, no API key.
[**See the results**](https://brendanh18.github.io/jev_fsd/results.html) of every driver tested so far.

![Jev Drive Lab on a tree-lined street in Kitsilano, Vancouver](docs/drive-lab.png)

- **Real streets.** Twelve neighbourhoods in eleven Canadian cities, built from OpenStreetMap: lanes,
  signals, stop signs, crosswalks, bus routes and bus lanes, streetcar tracks, speed humps and turn
  restrictions.
- **A busy city.** Traffic, cyclists and people on foot; buses, streetcars and school buses; ambulances
  to pull over for, snow plows, garbage trucks, road crews and police officers directing traffic;
  and the hazards drivers get wrong, from a child chasing a ball to black ice on a bridge.
- **60 challenges and 2 road tests.** Each a fixed situation on a real street, from an unprotected
  left in Ottawa to a scramble crossing in Victoria ([the full list](docs/challenges.md)).
- **Any driver, the same test.** Rules, decision models such as Jev, any OpenAI-compatible LLM, your
  own JavaScript agent, or you. Every driver shares the sensing, physics and safety checks, so the
  results differ only by the decisions made.
- **Every decision on the record.** Pause, rewind to the moment a door swung open, see what the driver
  could see, what it considered and why it rejected each alternative, then take over.
- **Repeatable.** Seeded routes, a lockstep clock, and model runs recorded so anyone can replay them
  without a key.

## Results

<!-- results:start -->
| Driver | Model | 60 challenges + 2 road tests | City suite, Kitsilano: dry · fog · rain · snow | City suite, 11 other maps (dry) | Own decisions | Cost of the challenges |
|---|---|---|---|---|---|---|
| Rules | none | 62/62 | 12/12 · 12/12 · 11/12 · 11/12 | 20/22 | n/a | $0 |
| Cautious agent | none | 62/62 | 10/12 · 10/12 · 12/12 · 6/12 | 17/22 | 99.98% | $0 |
| Jev | `jev-1.14.0` | 62/62 | not run | not run | 99.95% | $1.26 |
| DeepSeek V4.1 Flash | `deepseek/deepseek-v4.1-flash-1017` | **61/62** (failed `double-parked`) | not run | not run | 99.01% | $2.55 |

Built from the committed records (2026-11-11 to 2026-11-12) by `scripts/build_results.py`, which also writes [`data/results.json`](data/results.json) with each row's source files; the [leaderboard](https://brendanh18.github.io/jev_fsd/results.html) shows every run and drive. Each city cell is the newest committed run (suite seed 1, lockstep clock, 40 traffic cars); a driver's runs may come from different dates. "Own decisions" are the share of the challenge decisions the driver made itself, not answered locally or by a Rules fallback. Model drives are recorded under `data/recordings/` and replay without a key. Details, failures and costs: [model results](docs/model-results.md) and [Rules baseline](docs/rules-baseline.md).

One-challenge pilots: GPT-6 Luna (`openai/gpt-6-luna`) 1/1 (door-zone); Liquid d1 (`liquid/d1-20260930`) 1/1 (door-zone); Granite 4.2 3B (`granite4.2:3b`) 2/2 (dont-splash, left-on-red).
<!-- results:end -->

> This is a research simulator. It is not, and is not meant to become, software for controlling a
> real vehicle.

## What you can do

### 🚗 Drive real neighbourhoods

Twelve neighbourhoods across eleven Canadian cities ship with the project, so the app works offline
once its dependencies are installed:

| Neighbourhood | City | | Neighbourhood | City |
|---|---|---|---|---|
| Kitsilano | Vancouver | | The Annex | Toronto |
| Mount Pleasant | Vancouver | | Le Plateau | Montréal |
| Old Town | Victoria | | Centretown | Ottawa |
| Beltline | Calgary | | Saint-Roch | Québec City |
| Downtown | Halifax | | Exchange District | Winnipeg |
| Old Strathcona | Edmonton | | Downtown & Nutana | Saskatoon |

Each city has its own house colours and a stylized backdrop on the horizon: Citadel Hill in
Halifax, a needle tower in Toronto, a river-valley truss bridge in Edmonton, the North Shore
mountains behind Vancouver.

Pick from six vehicles, including a city hatch, a sport coupe and a utility pickup. Each one has
its own dimensions, mass, power and handling. Then choose a paint colour, the weather (dry, rain,
fog or snow) and any time of day. The sun follows each city's real latitude, and street lights come
on at dusk.

### 🏁 Take on the challenges

Sixty hand-built scenarios test the situations real drivers get wrong, from a fresh green with a
red-light runner coming to geese crossing between two parks in Ottawa. Each has its own street,
seed, weather, time and traffic. [See all sixty](docs/challenges.md).

Drive them yourself, or set Rules, a decision model, an LLM or your own agent loose on the same
seed and compare results. A pass means you arrived with no collision, no red light or stop sign
run, no failure to yield, and less than a second off the road (and, in Squeeze in, parked within 30 cm
of the kerb). A good coaching score on its own doesn't count.

The challenge library searches titles, cities, streets and lessons, with filters for city, skill,
weather and your practice progress. It remembers your unchanged manual attempts and clean arrivals
in this browser, separately from AI drives and the last 20 full drive reports. Retry an attempted
challenge or choose **Practise next** to keep working through the library. Modified setups and
replay takeovers do not count toward manual completion.
In **Squeeze in**, stop inside the space and select **Finish & review** to check your parking.
Challenge reports explain each reason a drive was not completed cleanly and show the authored
lesson alongside the coaching grade. Select a retained event to rewind up to three seconds before
it. Events outside the current recording stay readable and are labelled **Replay unavailable**.

**Road tests** sit beside the challenges: a Class 5-style test in Kitsilano and a G2-style test in
Toronto's Annex, each a longer drive on a fixed route with an examiner's directions in the HUD and
an examiner's sheet at the end. A dangerous action or violation fails; minor errors are demerits,
grouped by category, with rewind links. Any driver can take one, so you can see whether an AI would
be licensed; only your unchanged manual attempts are recorded, with your best result. These are
styled on provincial road tests, not affiliated with any licensing authority.

### 🧠 See through the AI's eyes

Turn on **AI eyes** to see what the driver actually perceives. It shows which hazards are
visible, which ones buildings are hiding, how far it can see in the fog, the trajectories it
predicts for other road users, and the reason each candidate manoeuvre was rejected.

![A recorded Rules drive with the perception overlay](docs/drive-demo.gif)

### ⏪ Rewind and try a different decision

The last two minutes of every drive are recorded. Scrub back, jump to the moment before an
incident, take over manually, switch to a different driver, or force one of the other manoeuvres
the AI considered. Then see how it plays out.

### 📸 Photo mode and the cinematic camera

Press **O** to freeze the world and step out of the car. The HUD disappears. You can orbit freely,
or let the cinematic director frame the shot, then adjust exposure, contrast, saturation, vignette
and even the time of day. **Save photo** downloads a clean PNG.

The **cinematic** camera (press **C** to cycle to it) works like a car film director. It cuts
between a roadside camera the car sweeps past, a low bumper chase, a slow helicopter orbit, a
tracking shot from ahead and a wheel-height side profile.

### 🤖 Three kinds of AI driver

The HUD has one button for each kind of driver, and keys `1`, `2` and `3` select them:

| Button | Key | What drives | Needs |
|---|---|---|---|
| **Rules** | `2` | Deterministic code that scores each safe manoeuvre | Nothing; free and offline |
| **Decision ▾** | `1` | A decision model: Jev, or another model that answers typed questions with probabilities | A key for a hosted model, or a local server |
| **LLM ▾** | `3` | Any chat model behind an OpenAI-compatible API | A key for a hosted model, or a local server |

The public browser demo runs Rules and your own browser agents. Decision models and LLMs need the
local app, whose server holds the keys.

**Decision models** answer typed questions with probabilities instead of writing text. Jev is the
built-in one. OpenRouter's Decisions API adds Perplexity Decider, Liquid d1, Microsoft Decision 1
and others, and llama.cpp runs open ones such as Kev 4B on your own computer. Click **Decision ▾ →
Connect a decision model…** and pick a provider:

- **TypeSafe**: paste a key and Jev turns on at once. Other Jev versions, such as `jev-preview`,
  can be added beside it for comparison.
- **OpenRouter**: the list of decision models and their prices loads without a key; paste a key
  to drive.
- **llama.cpp**: a server on this computer, no key.
- **Other**: any server that speaks the same protocol.

Every model other than the built-in Jev becomes a driver called `decision:<name>`, and each one
gets exactly the state and questions Jev gets, so comparisons are fair.

**LLMs** work through the OpenAI Chat Completions protocol, so OpenAI, OpenRouter, Groq, vLLM,
LM Studio, Ollama on your laptop and similar servers should all work. Click **LLM ▾ → Connect a
model**, pick a provider, paste a key and choose a model. Each one becomes a driver called
`llm:<name>`. The prompt is built from the same state Jev sees and lives in one file you can tweak.

Either way, the key is saved to `.env` on the local server and never reaches the browser, the
model drives straight away without a restart, and one OpenRouter key serves both kinds. The ▾
menus switch between your models, and each button drives with the last one you chose. You can
also list endpoints by hand in `data/decision-endpoints.json` and `data/llm-endpoints.json`
(templates are in `data/`). Every model picks among the same safety-checked manoeuvres; when an
answer is unusable, late or fails, Rules drives that step and the HUD says why. Both kinds of
endpoint were checked live on 11 November 2026: decision models on TypeSafe (Jev) and OpenRouter
(Liquid d1), LLMs on OpenRouter (GPT-6 Luna, GPT-6.1 Terra, DeepSeek V4.1 Flash) and on a local
Ollama (Granite 4.2 3B).
The [agent guide](docs/agents.md#decision-models-jev-and-others) has the details and copy-paste
examples.

### 🧪 Bring your own agent and compare

Write a small JavaScript module with a `decide()` function, load it in **Settings**, and it drives
under the same physics, sensing and safety checks as the built-in drivers. The
[arena](http://127.0.0.1:8322/arena) runs the fixed challenge suite for any mix of Rules, decision
models, LLMs and your own agents, and compares safety, comfort, latency and cost. It saves
evaluations and lets you diff a run against a previous baseline. [`/bench`](http://127.0.0.1:8322/bench)
runs a seeded suite of routes for one driver. See the [agent guide](docs/agents.md) for a starter
template.

## Quick start

The fastest way to try it is the [browser demo](https://brendanh18.github.io/jev_fsd/). To run it
locally with the full feature set, install [uv](https://docs.astral.sh/uv/) and run:

```sh
git clone https://github.com/BrendanH18/jev_fsd
cd jev_fsd
uv run server.py
```

Open **<http://127.0.0.1:8322>** in a desktop browser with WebGL. There is no frontend build step.
Python 3.10+ is all you need, and uv fetches a suitable version if you don't have one.

### Controls

| Key | Action | | Key | Action |
|---|---|---|---|---|
| `W A S D` / arrows | Drive (and take over from autopilot) | | `C` | Cycle cameras |
| `Space` | Brake hard | | `O` | Photo mode |
| `J` | Toggle autopilot | | Drag / scroll | Orbit and zoom the 360° camera |
| `Q` / `E` | Left / right indicator | | `P` | Pause |
| `H` | Horn (with sound on) | | `R` | Reset to the lane |
| `1` / `2` / `3` | Decision / Rules / LLM driver | | `?` | Show every shortcut |

Click the minimap to set a destination, or open **Explore cities** for suggested drives. If keys
stop responding after you use a menu, click the road view to give it focus again.

### Enabling the Jev model (optional)

The free **Rules** driver and the cautious starter agent work out of the box. **Jev** is a
decision model served by [TypeSafe](https://console.typesafe.ai). To try it, click **Decision**
(or press `1`): the **Connect a model** dialog opens on TypeSafe. Paste your key and choose
**Save and drive**; Jev is available at once, without a restart. Or set it by hand:

```sh
cp .env.example .env
# then set TYPESAFE_API_KEY=... in .env and restart the server
```

Your key stays on the local server and is never sent to the browser. A spend cap
(`JEV_FSD_BUDGET_USD`, $1 per run by default) and a request-rate cap (`JEV_FSD_RPM`) limit live
model calls. The spend cap counts the cost a provider reports for each call (`usage.cost`, which
OpenRouter sends), else the configured prices; a call with neither counts as $0, and an endpoint
with `rpm: 0` also skips the rate cap. This project is independent and not affiliated with TypeSafe AI.

## How the AI drives

Every driver, whether it's Rules, a decision model, an LLM or yours, goes through the same loop for every decision:

```mermaid
flowchart LR
    A[Sense<br/>what's visible] --> B[Propose<br/>candidate manoeuvres]
    B --> C[Simulate each<br/>3 s ahead]
    C --> D[Filter out unsafe<br/>or illegal options]
    D --> E[Driver chooses<br/>among survivors]
    E --> F[Controller +<br/>emergency brake]
```

Sensing is honest. Buildings block line of sight, fog and darkness shorten it, and traffic lights
you can't see are treated as unknown. Every driver shares the physics, the controller and the
emergency brake, so differences in results come from decision-making alone.

## Graphics

The renderer uses [Three.js](https://threejs.org) with no build step and a vendored runtime. In
**Settings → Graphics** you can choose:

- **Low**: direct rendering without post-processing, for older laptops.
- **High** (default): 4× multisampling with smooth leaf edges, SMAA, bloom, wet-road reflections
  and a cinematic colour grade.
- **Ultra**: adds ground-truth ambient occlusion, 4K shadow maps, sharper reflections and up to 2×
  pixel ratio (which supersamples in place of multisampling).

The sky is fully procedural. It has a physically placed sun and moon, stars, and a drifting cloud
deck lit from the sun's side. The clouds follow the weather, glow orange at dusk, pick up the
city's light at night, and show up in reflections on wet roads and car paint. Snow settles on
upward-facing surfaces, and rain darkens and polishes the asphalt. Tree shadows sway with the
leaves without crawling noise, and distant trees keep their colour and density.

## Development

```sh
uv run python -m unittest discover tests        # server, routing, maps, OSM pipeline, model endpoints
node scripts/test_drive_lab.mjs                 # drive lab and replay features
node scripts/test_arena_history.mjs             # saved evaluations and comparisons
node scripts/test_cinematic_photo.mjs           # cinematic camera and photo mode
node scripts/test_drive_score.mjs               # coaching score
node scripts/test_decision_agent.mjs            # decision-model drivers (registry, answers, fallback)
node scripts/test_llm_agent.mjs                 # LLM endpoint drivers (prompt, parsing, fallback)
node scripts/test_lane_change.mjs               # lane changes (gaps, lane ends, a pass, turn lanes)
node scripts/test_pull_out.mjs                  # pull-outs and a destination blocked by a parked car
node scripts/test_left_turn.mjs                 # left turns at a signal yield to oncoming traffic
node scripts/test_right_on_red.mjs              # right turns on red after a full stop, except in Montréal
node scripts/test_all_way_stop.mjs              # turn order at all-way stops, left turns at stop signs
node scripts/test_give_way.mjs                  # two-way stops, junctions without a sign, creeping forward to look
node scripts/test_right_hook.mjs                # cyclists in the parking lane, right turns that wait for them
node scripts/test_speed_zones.mjs               # school and playground zones, and the School zone challenge
node scripts/test_roadside.mjs                  # slowing down and moving over for vehicles stopped with lights flashing
node scripts/test_streetcars.mjs                # streetcars on their tracks, and stopping behind their open doors
node scripts/test_level_crossings.mjs           # level crossings: stopping for a train, and never on the tracks
node scripts/test_junction_box.mjs              # keeping a signal's junction clear: waiting at the line for room past it
node scripts/test_advance_green.mjs             # advance greens and left arrows: phases, who goes, sensing, the audit
node scripts/test_work_zones.mjs                # work zones with a flagger: the paddles' turns, traffic, the detour, the audit
node scripts/test_outages.mjs                   # power cuts: dark signals as all-way stops, traffic, sensing, the audit
python3 scripts/build_demo.py                   # build the static GitHub Pages demo
```

Every `scripts/test_*.mjs` file is a standalone Node check. Node 22 or newer runs them directly; CI passes `--experimental-default-type=module` too.
The [full reference](docs/project-reference.md#development) lists them all, along with the
Playwright browser checks. CI runs every check on every pull request: the Python tests, all Node
checks, the Jev fixture and offline request checks, and the browser, renderer and arena suites in
headless Chromium. It then builds the Pages demo and deploys it from `main`. CI runs on
[Namespace](https://namespace.so) runners, gives each Node check six minutes, and cancels a pull
request's older run when a new commit is pushed.

```
server.py          local HTTP server and API (stdlib only)
jev/               map fetching, OSM processing, routing, Jev client, decision-model and LLM proxies
static/js/sim/     physics, traffic, pedestrians, signals, scoring
static/js/brain/   sensing, candidate generation, safety filter, drivers
static/js/render/  Three.js scene, sky, weather, cars, buildings, cameras
static/js/ui/      HUD, Connect a model dialog, drive lab, photo mode
static/js/lab/     challenges, recorder, replay, arena
data/maps/         bundled neighbourhood map packs
data/*-endpoints.example.json   templates for your own decision-model and LLM endpoints
```

If you change physics, sensing or planning, run a seeded comparison on `/bench` before and after;
the committed Rules baseline is described in [docs/rules-baseline.md](docs/rules-baseline.md).
Contributions are welcome. Agents, new scenarios, accessibility fixes and neighbourhood details
are especially appreciated.

## Further reading

- [Drive lab, perception and replay](docs/drive-lab.md)
- [Decision models, LLMs and your own agent](docs/agents.md)
- [Scoring formula and driving details](docs/drive-experience.md)
- [Maps, attribution and custom extracts](docs/maps.md)
- [Rules benchmark baseline](docs/rules-baseline.md)
- [Rendering measurements](docs/render-performance.md)
- [Browser demo build and deployment](docs/browser-demo.md)
- [Full project reference](docs/project-reference.md)
- [Changelog](CHANGELOG.md)
- [Roadmap](ROADMAP.md)

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under
the [ODbL](https://opendatacommons.org/licenses/odbl/1-0/). Rendering by
[Three.js](https://threejs.org) (MIT). Inspired by
[JevPilot](https://github.com/standardagents/jevpilot).

Released under the [MIT License](LICENSE).
