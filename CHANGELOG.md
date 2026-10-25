# Changelog

## Unreleased

- Junctions without a signal have a right of way, for traffic and the driven car alike
  (`static/js/sim/priority.js`). At a two-way stop, once its stop is made, the car gives way to
  traffic on the through road from both sides. Where streets meet with no sign at all, a smaller
  road gives way to a larger one (OpenStreetMap's primary and secondary roads, then tertiary, then
  the rest), and between streets of the same class traffic gives way to the right, as the law has
  it across Canada. The car waits for
  a vehicle with the right of way that would reach the junction before it has crossed it plus
  1.5 s (2 s from a stop), for anything moving across the junction, and for any vehicle due within
  2 s, whoever has the right of way. Before, the car gave way only at stop signs, to crossing
  traffic due within 4.5 s, and drove straight through junctions without a sign; traffic only
  waited for anyone already in such a junction. Across the twelve maps, 1,603 approaches to
  junctions without a sign give way to the right and 401 to a larger road; 981 more have the right
  of way over a smaller road or a stop sign, and 595 approaches at 430 junctions are two-way
  stops. Turning left from the road with the right of way, the car yields to oncoming traffic as
  at a signal or a stop sign.

- Where a building hides a street it gives way to, the car slows so it can stop, then creeps
  forward at 1.5 m/s to look, as far as 0.3 m short of the crossing road's asphalt. It looks along
  each such street as far as traffic at that street's limit, slowed for the weather, covers in the
  time the car needs, within what it can see at all, so fog and darkness shorten the look rather
  than stall the car. Stopped where it looks from, it goes once nothing it can see is coming, even
  if a building still hides part of the street; the car remembers that stop until the next
  junction, so it does not inch forward in fits and starts. A creep that stands still for 12 s
  counts as a stall, and deadlock recovery takes over.

- The audit counts pulling out in front of a vehicle with the right of way, due at the junction
  within 2 s or already in it, as a failure to yield (`through traffic` or `traffic from the
  right`), seen or not, if it was on its way when the car crossed its line (a car that pulls out
  from the curb after that must give way itself). Before, a two-way stop was audited only for left turns across oncoming
  traffic, and a junction without a sign not at all. Decision models and LLMs get
  `intersection.give_way` (whether the way is clear, whom the car waits for, whether buildings hide
  the street and how far it sees, where it stops) and `intersection.right_of_way`, a situation
  line, two new candidates (`creep_to_look` and `wait_to_give_way`) and a motion criterion that
  allows holding still while giving way. Manoeuvres that would pass the point where the car must
  stop are rejected (`fails_to_yield`, or `enters_unseen_junction`, labelled in AI eyes).

- New challenge, **The blind corner** (Vancouver, Mount Pleasant): a two-way stop where a corner
  building hides the through road from the line. Once the car has made its stop, a car comes from
  the right, out of sight, and another from the left. New checks in `scripts/test_give_way.mjs`.

- The shared emergency brake keeps steering along the manoeuvre the car was following, as the
  `hard_brake` manoeuvre does. Before, it held the steering wheel where it was, so braking partway
  round a bend, or through the jog where a route moves to another lane inside a junction, carried
  the car on round it toward what it was braking for. In WebKit, the changes above put a car
  waiting to turn left in Toronto (The Annex) beside such a jog as the car went through it
  (`s1-1`, 115.5 s): the brake fired for it with the car heading 25° off its lane, and the held
  wheel steered the car into it.

- A traffic car that changes lanes keeps its new lane on the streets ahead. Before, the lanes it
  had already planned for them stayed as they were, so a car that had moved to the right lane
  went back to the left one where its street joined the next, swinging 19° across the junction
  into whoever was beside it. In WebKit Kitsilano dry `s1-6`, leaving the signal at West Broadway
  and Larch Street side by side with the driven car, `car_10` did so into it.

- In the seeded V8 and WebKit benchmarks Rules passes all 70 routes in each engine, as before,
  with no collision, red-light or stop-sign violation or failure to yield, and the same seven
  deadlock overrides (Toronto 4, Ottawa 3). Drives slow where junctions without a sign are
  common, from looking at blind ones and giving way: Montréal 25.6 → 17.55 km/h (both engines),
  Winnipeg 36.65 → 33.75, Edmonton 31.15 → 28.5 and Saskatoon 29.85 → 25.7 (V8); Kitsilano moves
  by at most 0.5 km/h. Traffic giving way shifts other drives both ways: Kitsilano dry `s1-8` and
  fog `s1-4` arrive 36 s and 39 s sooner. The reruns use Node v24.19.0 / V8 and native WebKit on
  macOS 27.0.1. See [docs/rules-baseline.md](docs/rules-baseline.md).

- All-way stops have a turn order, for traffic and the driven car alike. Vehicles go in the order
  they stopped at their lines: a vehicle joins the order when it stops within 6 m of its line (or
  up to 6 m past it, after an overshoot). Two that stop within 1 s of each other go right before
  left, the one on the right first; from opposite sides a left turn (or U-turn) waits for the
  other. From opposite sides two vehicles that are not turning left go together, and so do two
  opposing left turns. A vehicle that has set off on its turn keeps the right of way until it is
  6 m past the junction's centre, so nobody it conflicts with sets off while it is crossing. If
  everyone waits for someone (four cars stopping together, each with one on its right), the first
  to stop goes. Before, traffic at an all-way stop went once nobody was crossing the junction, and
  the driven car ignored cross traffic standing still, so two cars that stopped together pulled out
  together. In three minutes of Toronto (The Annex) traffic alone, 120 cars, crossing cars were
  inside an all-way junction moving at the same time on 49 ticks before and on none after. The
  bundled maps have 270 all-way approaches at 111 junctions, most in Toronto (36 junctions), Ottawa
  (23), Mount Pleasant (13), Calgary (11) and Halifax (9). The driven car counts only vehicles it
  can see; the audit counts crossing the line out of turn as a failure to yield, seen or not.
  Without a route, the driver's turn indicator supplies the intended turn, so an opposing car
  waits for a manual left turn that stopped first.
  Decision models and LLMs get `intersection.priority` (whether the car has stopped at the line,
  whether it is its turn, whom it waits for and who goes first) and a situation line, the motion
  criteria allow holding still while it is not the car's turn, and manoeuvres that cross the line
  then are rejected (`fails_to_yield`). In both seeded V8 and WebKit benchmarks Rules passes
  all 70 routes (70 before in each engine): Kitsilano passes 48 of 48 across four weathers,
  and the city smoke suites 22 of 22.
  The initial implementation timed out on Toronto dry `s1-2` because a retained stop line behind
  the car suppressed deadlock recovery. An incomplete stop now holds the deadlock timer only
  until 3 m past its line; oncoming-traffic waits still hold it. In V8, the route arrives at 176.6 s
  (165.5 s before), with its four deadlock overrides restored; Ottawa's three are unchanged.
  WebKit also retains Toronto's four and Ottawa's three overrides; Toronto `s1-2` arrives at
  164.5 s (176.4 s before). No suite in either engine has a collision, red-light violation,
  stop-sign violation or failure to yield. The reruns use Node v24.19.0 / V8 and native WebKit
  on macOS 27.0.1. See [docs/rules-baseline.md](docs/rules-baseline.md).

- Turning left (or making a U-turn) at a stop sign, the driven car yields to oncoming traffic as at
  a signal, once its stop is made and it is its turn: it waits short of the oncoming lane for a
  vehicle that would arrive before it could clear, including one pulling away from its own stop.
  The audit counts turning in front of such a vehicle as a failure to yield. Decision models and
  LLMs get `intersection.turn` and `intersection.oncoming` at stop signs too.
  Straight and right departures do not trigger the stop-sign oncoming audit; manual left turns
  and U-turns are audited from the actual turn, including missing or misleading indicators.

- New challenge, **Four-way stop** (Toronto, The Annex): straight on through an all-way stop as a
  hesitant driver from the right stops first, a second car queues behind it and reaches the line
  only after the car has stopped, and an oncoming car arrives to turn left. New checks in
  `scripts/test_all_way_stop.mjs`.

- The driven car turns right on red. It is legal across Canada after a full stop, except on the
  island of Montréal, so it is allowed on every bundled map but Le Plateau (a map counts as on the
  island when its centre lies inside a coarse outline of it; `MapData.rightOnRed`). At a red light
  where its route turns right, from the curb lane, the car stops fully at the line (0.7 s within
  6 m of it, as at a stop sign), then turns once nothing it must yield to is in the way: traffic
  from the left that would reach the junction before the car's rear has passed its centre plus
  2 s (about 6 s from a stop), anything moving across the junction, a pedestrian on a crosswalk
  ahead or waiting at one whose walk signal comes on within 4 s, and a view along the street to
  its left that falls short of where that traffic would come from, up to the 80 m it can see in
  clear daylight (it looks for that traffic that far, not only within the 60 m other traffic is
  listed for). So fog, rain, snow, darkness and a building on the corner (about a third of
  signalled right turns across the maps) leave it waiting for the green: it does not creep forward
  to look. Once moving past the line it carries on. Traffic cars do the same after a full stop from
  the curb lane, accepting a gap 1.5 s longer than at a stop sign. The audit counts crossing a red
  light's line as legal only after a full stop, on a map that allows it, and if the car turns right,
  judged from the street it is on as routes judge their turns: going on past the junction's centre
  (15 m out) other than by a right turn runs the red at once, and a right turn holds once the car
  leaves the junction (30 m out) on the street it turned into or one that street leads on to, so a
  swerve or lane change on the way straight through does not count, nor does a sharp left or a
  U-turn. Otherwise it ran the red, with or without a route. Cutting off a vehicle from the left during the turn fails to
  yield (due at the junction within 2 s, or catching the car within 2 s down the street both are
  in). Decision models and LLMs get `intersection.turn` ("right") and `intersection.right_on_red`
  (`stop_completed`, `clear` and what it waits for), a situation line, and the motion criteria
  allow moving at a red only when both are true; the LLM system prompt says either turning or
  waiting is allowed. New challenge, **Right on red** (Calgary, Beltline): a red light where two
  cars come from the left 20 m apart on their green, going straight on into the street the car
  turns into. In the seeded V8 benchmark Rules reached a red light where its route turns right 20
  times and turned on red 3 times; 9 of the other 17 times it waited because it could not see far
  enough to its left. New checks in `scripts/test_right_on_red.mjs`.

- Turning left at a signal, the driven car now waits for an oncoming car pulling away from its own
  line on the green, and allows for an oncoming vehicle speeding up. Before, a vehicle under 1 m/s
  did not count and every arrival time assumed a steady speed, so in Edmonton `s1-2` (V8) the car
  turned as `car_30`, in view and signalling a right turn into the same street, set off from its
  line, and they collided in the street both turned into. A vehicle accelerating at more than
  0.3 m/s² now counts from 0.05 m/s, and is assumed to keep accelerating (at most 2.5 m/s²) up to
  its street's limit. It also no longer takes the left indicator of a car pulling out of a parking
  spot ahead, facing the junction, for an oncoming left turn. Without this, the changes above
  shifted Kitsilano dry `s1-8` (V8) so that the car turned left in front of `car_p6`, pulling out
  on the far side of the junction, and they collided in the street both turned into. With both
  changes, the seeded WebKit benchmark passes 70 of 70 routes, as before, and V8 70 of 70 (69
  before: Edmonton `s1-2` now passes); no suite has a collision, red light or failure to yield.
  Victoria `s1-1` is 76 s slower in V8, from an existing stall where a building outline reaches
  into the lane. See [docs/rules-baseline.md](docs/rules-baseline.md). Checks in
  `scripts/test_left_turn.mjs`.

- The driven car yields to oncoming traffic when it turns left (or makes a U-turn) at a signal.
  Before, it turned on a green whatever was coming the other way. It turns in front of an
  oncoming vehicle only if it would clear that vehicle's path 1.5 s before the vehicle gets
  there (0.75 s once it is moving through the turn). Otherwise it waits 1.5 m short of the
  innermost oncoming lane: at the line, or inside the junction if it is already in it. It goes
  once the gap is long enough or oncoming traffic stops for the light. It carries on through if
  it can no longer stop short of that lane. Only vehicles it can see count. An oncoming car
  signalling its own left turn from its leftmost lane near the junction, braking to stop short of
  the junction, or travelling the other way along the street the car turns into does not count. Decision models and LLMs get
  `intersection.turn` and `intersection.oncoming`, a situation line and a `stop_for_oncoming`
  candidate; manoeuvres that would cross that lane are rejected (`fails_to_yield_to_oncoming`).
  The audit counts a failure to yield when, past a signal's line, the car's front enters the path
  of an oncoming vehicle due at the junction within 2 s, seen or not. The path is the lanes that
  vehicle is following, so going straight on or turning right never counts. It applies to every
  drive, manual and free drives included, so the coaching score now penalises it. A car more than
  3 m past the line when the light changes clears the junction. Before, every manoeuvre was rejected as running the red, so it braked to a
  stop where it was. Nearer the line it still holds for the red. New challenge, **The unprotected
  left** (Ottawa, Centretown): a left turn on a green as two oncoming cars 20 m apart reach the
  junction. In the seeded WebKit benchmark Kitsilano passes 48 of 48 routes across four weathers
  (47 before; fog `s1-4`, a left turn on a green into an oncoming car, now passes) and the city
  smoke suites 22 of 22, and the four deadlock overrides in Kitsilano snow are gone. See
  [docs/rules-baseline.md](docs/rules-baseline.md). New checks in `scripts/test_left_turn.mjs`.

- Traffic no longer pulls out of a parking spot into the driven car. A car parked close behind
  another could not move off when its gap check passed: the car in front held it still while its
  merge ran out the clock, and it pulled out over three seconds later, with the driven car about
  10 m behind. A car pulling out now checks for a gap on every tick until it is actually moving,
  and with someone coming it goes back to waiting at the curb, indicator on; it stays a pull-out,
  signalling, until it moves, however long the car in front holds it. The driven car also counts
  as arrived when it has stopped on its route, in the route's lane, within 10 m of its destination,
  and every manoeuvre along that lane that would get it closer hits a parked car or static
  scenery; the arrival event names it (`blocked_by`). Traffic in the way, a red light, a parked car
  in another lane or a car off its route does not count. In the seeded WebKit benchmark Kitsilano passes 47 of 48 routes across four
  weathers (46 before) and the city smoke suites 22 of 22 (20 before): Kitsilano rain `s1-2` and
  `s1-5` and Calgary and Halifax `s1-1` pass, and Kitsilano fog `s1-4` newly fails, a left turn
  on a green into a car coming the other way, because Rules does not yield to oncoming traffic at
  a signal. See [docs/rules-baseline.md](docs/rules-baseline.md). New checks in
  `scripts/test_pull_out.mjs`.

- The driven car no longer crashes into lamp, sign and signal posts standing in its lane. On
  two-way streets with more lanes one way than the other (378 directed segments in eleven of the
  twelve maps, among them Belleville Street in Victoria, Bloor Street West, Gladstone Avenue and
  8 Street SW), the lanes sat either side of the mapped centreline but the asphalt was centred on it, so
  the outer lane on the wider side ran past the curb: the car drove over the curb line, counted as
  off-road there, and hit the curbside posts. Each side's asphalt now ends beyond its own lanes
  (map pack v6). The committed packs were upgraded in place by `scripts/migrate_packs.py`, without
  new OSM data, which also moved back 202 signal and 2 stop lines set back from those curbs.
  Separately, posts and trees no longer stand in any lane or on any asphalt: a slip road leaving
  at a shallow angle or a street continuing wider past a junction (Québec City's `sig3`) used to
  put some there. They move outward, a signal pole to the near side of the junction when the far
  side has no room, or are left out (4 of 1,127 signal poles, 27 lamp posts, 13 sign posts, 4
  trees). The deadlock creep now looks ahead first and does not drive into static scenery, and
  rechecks each second while it runs. In the seeded WebKit benchmark, `s1-1` passes in Ottawa,
  Québec City, Toronto and Victoria, Kitsilano passes 46 of 48 routes across four weathers (44
  before) and the city smoke suites 20 of 22 (16 before); Kitsilano rain `s1-2` and `s1-5` and
  Halifax `s1-1` newly fail. See [docs/rules-baseline.md](docs/rules-baseline.md). New checks in
  `scripts/test_scenery_collision.mjs`; `scripts/bench_node.mjs` runs the bench suites under Node.

- The driven car gets into the turn lane early. The router takes the left lane on the block before
  a left turn, so its route line used to slide the car across the lanes inside the junction before
  that block, without a signal or a gap check. That happens at 547 junctions across the twelve
  maps. Now, from 150 m before the route moves across, that lane counts as the route's lane: the car
  signals, changes into it with the gap checks lane changes already use, and holds it while the
  route line moves over (lane laws are measured against where the route was when they were chosen).
  Without a gap it slows and waits, and it must be across before the turn. A slow or stopped car in
  the turn lane within 150 m of the turn is treated as a queue and not passed, and Rules doesn't
  drive past such a queue in the next lane, because the extra speed there gains nothing. Decision
  models and LLMs are told the route moves to that lane for the turn and get a
  `change_*` candidate described as a change "for the turn ahead". Junctions where the lane count
  or layout changes still slide across as before. The public demo's browser router now picks each
  street's lane the way the server does (the left lane before a left turn, otherwise the right), so
  demo drives prepare for turns too; before, it moved into the turn lane only at the turn itself.
  More checks in `scripts/test_lane_change.mjs`.

- The driven car changes lanes. On streets with more than one lane in its direction, a
  `change_left_*` or `change_right_*` manoeuvre is offered to pass a stopped vehicle, cyclist,
  open door, parking car or traffic at least 2.5 m/s slower, and then to return to the route's
  lane. A change needs a gap in the target lane (6 m plus 2 s of closing speed ahead, 6 m plus
  2.5 s behind, nothing alongside), at least 80 m of lane beside the route for a pass, and no stop
  line within 25 m. The car signals and eases across over about 3.5 s (18–50 m), more sharply
  (down to 12 m) when the lane it is leaving is about to end. Manoeuvres that would leave it
  outside its route's lane too close to where that lane ends (a turn, a change in the lanes or the
  destination) are rejected, so without a gap it slows and waits. Stops, hard braking and the
  deadlock creep keep or return to the car's lane instead of steering for the route's. Rules
  counts a change and time outside the route's lane as small costs, and abandons a change under
  way only when finishing it is no longer safe. Decision models and LLMs get a `lanes` block (the
  car's lane, the route's lane, the gaps on either side and `return_within_m`) and a situation line
  when a pass or return is on offer; the LLM system prompt says when to choose one. Bench lane
  keeping is now measured from the centre of the lane the car is in or moving into, and runs
  report `lane_changes`. New check: `scripts/test_lane_change.mjs`.

- Decision models are the second of three driver pillars: **Rules | Decision ▾ | LLM ▾** in the
  HUD (keys `2`, `1`, `3`). A decision model answers typed questions with probabilities, as Jev
  does; besides the built-in Jev, any endpoint that speaks TypeSafe's System One protocol becomes a
  driver `decision:<name>`: OpenRouter's Decisions API (Perplexity Decider, Liquid d1, Microsoft
  Decision 1, Jev and others), llama.cpp 0.6.0+ for local open models, or any compatible server.
  Each gets exactly the state and questions Jev gets. **Connect a model** now has Decision models
  and LLMs tabs. On the Decision tab, a TypeSafe key is saved as `TYPESAFE_API_KEY` and turns Jev
  on without a restart (another Jev version, such as `jev-preview`, becomes its own driver);
  OpenRouter's decision catalog loads without a key, with prices, and its key is the same
  `OPENROUTER_API_KEY` the LLM tab uses, so saving it in either tab enables both. The server checks
  every answer against the offered options; unusable answers, HTTP errors (including OpenRouter's
  402 for exhausted credits), timeouts and an exhausted budget fall back to Rules, and calls that
  happened still count. Cost uses the provider's `usage.cost` when reported, else configured
  prices. Configure by hand in the gitignored `data/decision-endpoints.json` (template:
  `data/decision-endpoints.example.json`). Decision drivers appear in Settings, challenges, replay
  branches, the arena and `/bench`. The built-in `jev` driver still calls TypeSafe directly, so
  saved replays and runs keep their meaning. Tested only against a local mock server, not against
  TypeSafe, OpenRouter or llama.cpp. The pillar buttons now take the full width of the HUD panel,
  with the autopilot switch below them. LLM and decision endpoints share one transport
  (`jev/endpoints.py`): no redirects, one total deadline, key scrubbing and per-endpoint key
  snapshots.

- Bring your own LLM: an endpoint driver that speaks the OpenAI Chat Completions protocol, so it
  should work with OpenAI, OpenRouter, Groq, vLLM, LM Studio, Ollama and others; it has been
  tested only against a local mock server, not a real provider. **LLM** sits next to Rules and Jev
  (key `3`), with a ▾ menu to switch models. **Connect a model** sets one up in the app: pick a
  provider, paste a key, choose from the provider's model list (OpenRouter's includes prices) and
  save. The server writes the key to `.env` (only if it is gitignored and untracked) and the endpoint
  to `data/llm-endpoints.json`, then reloads; the key never returns to the browser, and a saved key is
  never sent to a URL other than its provider's. Or configure several by hand in the gitignored
  `data/llm-endpoints.json` (template: `data/llm-endpoints.example.json`) or one with
  `JEV_FSD_LLM_*` in `.env`; each becomes a selectable driver `llm:<name>` in Settings, challenges,
  replay branches, the arena and `/bench`, labelled ready, unreachable, key rejected or no key.
  Keys and the choice of destination stay on the server (the browser sees only a
  credential-stripped base URL), and the configured key value is scrubbed from responses, traces
  and errors. The model picks among safety-checked candidates only and falls back to Rules (with
  the reason in the HUD and arena timelines) on invalid output, timeouts, HTTP errors or an
  exhausted budget; unusable replies still count their calls, tokens and cost. `timeout_s` is one
  real deadline per decision, covering the TCP connect, any proxy tunnel, the TLS handshake, the
  whole reply and a plain retry when an endpoint rejects structured output; only DNS resolution is
  left to the system resolver.
  Calls share `JEV_FSD_BUDGET_USD` and `JEV_FSD_RPM`; optional per-endpoint prices give costs,
  otherwise tokens are reported with an unknown ($0) cost that the budget cannot stop, and
  `rpm: 0` removes the rate limit too. The prompt lives in `static/js/brain/llm-prompt.js`;
  Inspect JSON shows the messages, raw reply and a curl. No new dependencies.

- Graphics artifact fixes. Sun shadows filter without screen-space noise, removing the crawling dot
  pattern inside tree crowns and other partial shadows. Leaf shadows sway with the leaves, leaf
  cards keep their crown shading on both faces, and crown interiors read as shaded foliage instead
  of a dark ball. Leaf textures keep their colour and roughly their coverage at a distance, so far
  trees no longer thin out or darken. Clouds fade detail that is too fine to draw near the horizon, wet-road
  reflections smear smoothly instead of in blocks, and snowflakes are round and size-capped.
- The High preset renders the scene and wet-road reflection with 4x multisampling and
  alpha-to-coverage foliage edges. Frame-time cost has not been measured against a baseline.

- Four new bundled neighbourhoods: Downtown Halifax, Winnipeg's Exchange District, Old Strathcona
  in Edmonton and Downtown & Nutana in Saskatoon. Twelve neighbourhoods across eleven Canadian
  cities, each with its own facade palette and a stylized silhouette (Citadel Hill, a prairie
  glass spire, a river-valley truss bridge, a riverside château and arched bridge).
- Map processing skips roofed streets and raised skywalk footprints, joins roundabouts split
  across several OSM ways, and keeps large roundabout lanes on their mapped carriageway.

- Re-baselined the seeded Rules benchmark on the current code. Kitsilano ran in dry, fog,
  rain and snow, and seven other cities ran smoke suites. The new committed run is
  `data/runs/20261014-091959-rules.json`. In the eight seeded dry suites tested in WebKit,
  `bbc9012` and `62fe050` produced identical summaries and per-route results, excluding wall
  time. On `62fe050`, Kitsilano dry scored 11/12 in WebKit and 10/12 in Node 22.23.2 (V8); the
  numerical cause was not traced. See [docs/rules-baseline.md](docs/rules-baseline.md).

- CI runs every check on each pull request: Python tests, all Node checks, Jev fixture drift,
  offline Jev requests, and the `/tests`, renderer and arena suites in headless Chromium
  (`scripts/test_browser_pages.py`). The Pages demo builds only after they pass.
- Fixed the renderer assertions, which crashed after the cloud deck was added because the
  render-loop test double had no sky.

- Procedural, drifting cloud deck in the sky, lit from the sun's side with a silver rim near the
  sun. Coverage follows the weather (scattered when dry, overcast in rain and snow, hidden in fog);
  clouds take the sun's colour at dusk and the city's glow at night, and appear in reflections.
- Colour-grade pass on High and Ultra: contrast, saturation, a time-of-day tint, soft vignette and
  dithering that removes sky banding.
- Cinematic camera (`C`): automatic cuts between roadside, bumper, aerial, lead and side-profile shots.
- Photo mode (`O` or **Photo mode**): pause the world, hide the HUD, choose a camera, adjust exposure,
  contrast, saturation, vignette and time of day, and save the frame as a PNG.
- README rewritten as a friendlier introduction and quick-start guide.

- Replay playback follows recorded timestamps, preserves its position when paused,
  catches up after slow frames and restarts from the beginning after reaching the end.
- Held driving keys clear when focus enters forms or dialogs, or the tab becomes hidden;
  editable fields and focused controls retain their keyboard behaviour.
- Drive reports and history remain usable when the browser blocks access to local storage.

- Comment cleanup across simulation, brain and render modules: shorter headers, removed
  redundant labels, fixed a stale snow grip note, dropped a dead candidate stub and unused
  NPC stop-line local. Normalized Python section banners and aligned the stdlib User-Agent
  with 0.2.0. Tightened CSP after vendoring Three.js; fixed Node static-collision imports so
  the document stub runs before `common.js`. README and docs test counts match the current suite;
  `pyproject.toml` points at this project's docs and demo.

- Saved agent evaluations with browser history, v1/v2 JSON import, selectable baseline drivers
  and deltas restricted to matching experiment conditions. Stopped and ambiguous attempts are excluded.
- Arena incident timelines with the most recent recorded decision, observed state, selected
  manoeuvre, candidate rejection reasons, emergency brakes, fallbacks and termination events.
- Two new deterministic challenges: a car merging from parking and a person emerging from
  behind a mapped building. Suite version 2; Rain check version 2 fixes its initial pedestrian hold.

- Drive Lab welcome screen with scenic drives, AI demonstrations and six fixed driving challenges.
- Geometric perception overlay with visibility, hidden-object inspection and candidate rejection reasons.
- Recorded drive checkpoints with interpolated playback, incident seeking, manual takeovers,
  driver changes and revalidated alternate manoeuvres. Replay branches and modified challenges are labelled.
- Shareable PNG score cards, reproducible challenge links and manual-arrival reports.
- Extensible agent registry, cautious starter agent, safety-checked adapter loading and a local
  evaluation arena with versioned JSON exports.
- Static GitHub Pages demo with all eight bundled maps and browser-side routing; no server or key required.
- Quieter default telemetry, distinct city facade palettes and decorative city silhouettes.
- Shorter README, new demo media and guides for replay, adapters and Pages deployment.

- Movable 360° camera follows the selected vehicle with mouse/touch orbit, wheel/pinch zoom,
  camera buttons, keyboard rotation and recentering. Existing fixed camera views remain available.

- Six selectable vehicle models and paint colours, with distinct proportions, detailed wheels,
  glazing, mirrors, lighting and trim. Driven vehicle dimensions and handling feed physics,
  stopping distances, traffic gaps, collision checks and cameras.
- Tree trunks, signposts, signal poles, lamps, porches and hedges share scenery placement with
  collision geometry; collision feedback identifies the struck object.

- Eight bundled neighbourhoods across seven Canadian cities, including Mount Pleasant, Calgary
  Beltline, Ottawa Centretown and Québec City Saint-Roch. Searchable, filterable world explorer
  with loading states, retries and preserved keyboard focus.
- Mapped buildings block the driven car and candidate predictions with swept footprint checks.
  Route-aware stop memory fixes indefinite waits when the front bumper reaches a stop line
  before the rear axle reaches the controlled segment; off-route driving retains lane auditing.
- Darkness limits forward and peripheral sensing and feeds speed planning. Fixed, real-time
  and accelerated daylight clocks; traffic density, repeatable world seeds and visible pause.
- Bundled Three.js runtime removes CDN startup dependency. A larger local-server request queue
  handles cold asset bursts, and startup failures show an actionable retry instead of an endless spinner.

- Redesigned trip and drive-coach cards, central driving instruments, a live decision summary,
  Settings and keyboard help. Manual drivers now receive turn-by-turn route guidance.
- Scrollable HUD columns and a narrow-screen inspector entry point; keyboard-accessible brain
  buttons, accurate fallback/stop labels, reduced-motion support and opaque instruments.
  HUD text refreshes at most 10 times per second and skips unchanged DOM writes.

- Bundled city selection for Vancouver, Victoria, Toronto and Montréal, with reachable suggested
  drives from the current pose and selected-city routing, benchmarks and replay.
- Live drive scoring for manual and autopilot drives, with category breakdowns, grades, coaching,
  event timelines, JSON export and local history. Waiting and pauses carry no penalty.
- Instanced street-name and speed-limit signs, optional procedural driving audio, indicators,
  a horn, speed warnings, hood-view rain/wipers and optional camera motion.
- Visual interpolation and speed-sensitive keyboard steering. Distance-based scenery detail and
  lighter high-quality GPU budgets; stable ground depth, synchronized shadows and a fix for wet
  reflection texture feedback loops. Measured rendering comparisons are documented separately.

- Building footprints occlude the ego's observations, predictions, and emergency brake. Fog,
  rain, and snow shorten sensing range; signal phases outside sight are unknown. Speed planning
  and candidate filtering use visible stopping room, including blind bends.
- Traffic can reserve a vacant curb bay and park at low speed. Parked cars open animated
  street-side doors with matching collision shapes; traffic reacts to the panels.
- Pull-outs leave more room for approaching traffic. NPC path recovery preserves the moving
  body's position and velocity.
- Jev weighs progress, clearance, comfort, roadside activity, and driving style instead of being
  directed to copy the Rules target-speed preference. Mid-block crossings distinguish approach,
  hold, and clearing the car's path. Candidates report comfort and clearance estimates.
- Eleven committed decision cases are generated through the actual driver pipeline. The snapshot
  checker validates requests offline and checks model expectations when a key is available.
- Live Jev behavior remains unverified; historical benchmark numbers describe the earlier world.

## 0.2.0

A large realism and graphics update. The Rules benchmark (seed 1) still passes 12 of 12 drives in
dry, rain, fog, and snow.

### Graphics
- Time of day with the sun's real path over Vancouver, a dawn and dusk sky, stars, and a moon.
- Ambient occlusion, bloom, and antialiasing, with low, high, and ultra quality settings.
- After dark: street lights with light pools, headlights (real beams on the driven car), tail
  lights, and lit windows. Wet roads mirror the street.
- New trees (leafy crowns that sway and cast dappled shadows), rounder cars with better lights,
  jointed pedestrians and helmeted cyclists, porches, chimneys and hedges, raised curbs, and
  pedestrian signal heads. A hood camera.
- The North Shore mountains, English Bay, downtown, Stanley Park, and the city around the map.

### Simulation
- Signal timing plans from approach speeds (ITE yellow, clearance all-red, walk and flashing hand).
- Drivers with individual temperaments; traffic waits for a gap at two-way stops and backs off from
  nose-to-nose standoffs. Parked cars sometimes pull out.
- Pedestrians sometimes cross mid-block, react to cars that will not stop, and walk at different
  speeds; fewer are out at night.
- Power-limited acceleration, drag, and rolling resistance in the car model.
- The planner anticipates lower speed limits, approaches stops at the target speed, and no longer
  treats a passing oncoming car as the car ahead.

### Fixed
- Traffic could pull out of a two-way stop in front of oncoming cars.
- Two cars could wait for each other indefinitely.
- The chase camera could jump when frames were advanced by hand in headless runs.

### Project
- New Rules baseline run, a new README, and 11 new browser tests.

## 0.1.0

First release: the simulator, the Jev and Rules drivers, the decision panel, and the benchmark.
