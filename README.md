# Jev FSD

**An AI model drives a car through a real city, and you can watch every decision it makes.**

Jev FSD is a driving simulator built on real OpenStreetMap streets. Pick a destination and the car
drives there through traffic, stop signs, and traffic lights. The driver is
[Jev](https://typesafe.ai/), a "System One" model from TypeSafe AI: instead of writing text, it
answers typed multiple-choice questions with probabilities, in about a tenth of a second. A panel
shows exactly what the model was asked, what it answered, how sure it was, and what it cost.

![The autopilot on Balsam Street in Kitsilano, Vancouver: the route in blue, candidate maneuvers in green, the chosen one in yellow](docs/drive.jpg)

> **This is a research and demo project.** It is a simulation for exploring how a fast
> classification model can make driving decisions. It is not a self-driving system and must never
> be used to control a real vehicle. It is independent and not affiliated with TypeSafe AI.

## Highlights

- **Real streets.** Kitsilano, Vancouver, by default: streets, lanes, speed limits, one-way streets,
  traffic signals, stop signs, and buildings, straight from OpenStreetMap. Any neighbourhood works.
- **Two drivers, one car.** Switch between the Jev model and a hand-written Rules driver. Both drive
  the same car through the same pipeline, so you can compare them fairly.
- **Nothing hidden.** Every decision can be inspected, copied as a `curl` command, or saved. Collisions,
  red lights, rolled stop signs, and time off the road are counted on screen.
- **A benchmark.** A reproducible suite of drives scores any driver on safety, comfort, lane keeping,
  legality, and cost.
- **No build step.** A small Python server and a browser. Three.js loads from a CDN; there is no
  Node toolchain.

## Quick start

You need [uv](https://docs.astral.sh/uv/), which provides Python 3.10 or newer and the one
dependency, and a desktop browser with WebGL.

```sh
git clone https://github.com/BrendanH18/jev_fsd && cd jev_fsd
uv run server.py
```

Open http://127.0.0.1:8322 and click anywhere on the minimap. The car plans a route and drives
there.

**Without an API key** the app runs with the Rules driver, which needs no account and costs
nothing. **To let Jev drive**, request an API key at
[console.typesafe.ai](https://console.typesafe.ai) (Jev is in early access), then:

```sh
cp .env.example .env      # set TYPESAFE_API_KEY=... and restart the server
```

### Controls

| Key | Action |
|---|---|
| click the minimap | set a destination (the autopilot starts) |
| `J` | autopilot on / off |
| `W A S D` or arrow keys | drive yourself (this takes over from the autopilot) |
| `Space` | brake hard |
| `C` | switch camera: chase, top-down, high chase |
| `R` | put the car back on the nearest lane |
| `P` | pause |
| `1` / `2` | Jev driver / Rules driver |
| **JSON** button | open the decision panel |

The app has three pages: `/` (the simulator), `/bench` (the benchmark), and `/tests` (the
browser test suite).

## Jev mode and Rules mode

The two modes share almost everything. The same code senses the situation, proposes maneuvers,
simulates each one three seconds ahead, and throws out anything that would crash, leave the road,
run a red light, or roll a stop sign. Only then do the modes differ: they pick among the safe
maneuvers that are left.

| | Jev mode | Rules mode |
|---|---|---|
| Who chooses | the Jev model, via TypeSafe's API | about 40 lines of JavaScript (`static/js/brain/rules.js`) |
| How it chooses | reads a description of the situation and answers two questions with probabilities | adds up a fixed score for each maneuver and takes the lowest |
| Needs | an API key and a network connection | nothing |
| Time per decision | about 130 ms (the car keeps executing its last choice meanwhile) | effectively zero |
| Cost | about $0.00008 per decision, a few cents per drive | free |
| Repeatable | no, answers can vary and network timing varies | yes, the same inputs always give the same choice |
| Reads `driving_style` | yes, edit it in the panel and the driving changes | no |
| When several routes exist | Jev picks one | takes the first |

**Rules mode** is plain code. It stops when the car is at a red or yellow light, at a stop sign it
has not completed, when crossing traffic is moving after a stop, when a stopped car is less than
3 m ahead, or at the destination. Otherwise it scores every safe maneuver: distance covered,
distance from the lane center, heading error, and how far the final speed is from the target speed,
with bonuses for stopping at a required stop line or at the destination and penalties for hard
braking or getting close to other cars. It is the baseline Jev is compared against, and the
fallback when Jev cannot answer. It is not a fake Jev and never pretends to be one.

**Jev mode** sends the situation (the car, the route, the road, the next intersection, the car
ahead, nearby traffic, and the list of safe maneuvers with their predicted outcomes) to Jev as one
request with up to two questions: `motion` (keep driving or hold still right now?) and `vector`
(which maneuver for the next second?). Jev answers each with a probability for every option, and
the car executes the most likely one.

Two details keep Jev mode honest and cheap:

- **Settled questions are never sent.** `motion` is only asked when stopping could be right: near
  an intersection, close behind another car, with traffic just ahead, when the car is stuck, or near
  the destination. `vector` is only asked when two or more maneuvers survived simulation. Otherwise
  the answer is filled in locally at no cost.
- **Failures fall back to Rules and are counted.** If Jev takes longer than 1.5 s, returns an
  invalid choice, or the request fails, the Rules driver decides that one step, and the
  **fallbacks** counter goes up.

In both modes a local safety brake steps in for imminent collisions only. It never intervenes for
lights or signs, so a driver's mistakes stay visible.

## How a decision is made

Code owns the math and the physics; the model owns the judgment. Every 250 ms of simulated time near
anything interesting (an intersection, a car ahead, a turn), and every 650 ms on open road:

1. **Sense.** Project the car onto its route and compute the situation, including a
   `target_speed`: the speed limit, lowered for the car ahead, a required stop, the destination,
   and curves. The curve part looks 60 m ahead and picks the fastest speed from which the car can
   still slow comfortably for every bend.
2. **Propose.** Up to 16 maneuvers: stay in the lane at several speeds (never above the limit),
   shift half a meter or a meter left or right, roll up to the stop line, stop at the destination,
   or brake hard.
3. **Simulate.** Run each maneuver three seconds forward with the real car model against predicted
   traffic. Reject any that collide, leave the road, or cross a red light or an unfinished stop.
4. **Choose.** Jev or Rules picks among the survivors (see above).
5. **Execute.** The chosen maneuver keeps running until the next decision arrives, so the car never
   waits for the network.

### What Jev actually sees

A real decision saved from a drive (`data/snapshots/red_light.json`), shortened:

```json
{
  "driving_style": "cautious city driver: obeys limits, stops fully at stop signs, keeps a safe gap, ...",
  "car": {"speed": 0.7, "limit": 13.9, "target_speed": 0, "target_reason": "red light", "speed_vs_target": "above target"},
  "nav": {"next_turn": "left", "turn_in_m": 313.9, "remaining_m": 414, "turn_street": "Stephens Street"},
  "road": {"name": "West Broadway", "on_road": true, "lane_position": "centered"},
  "intersection": {"control": "signal", "signal": "red", "bumper_to_line_m": 5.9, "distance": "at", "entered": false},
  "candidates": [
    {"id": "keep_lane_hold", "steer": "hold lane",        "speed": "keep 0.7",   "vs_target": "above target", "progress_m": 2.1, "outcome": "clear"},
    {"id": "keep_lane_stop", "steer": "hold lane",        "speed": "stop",       "vs_target": "at target",    "progress_m": 0.4, "outcome": "clear"},
    {"id": "left_0.5_hold",  "steer": "shift 0.5 m left", "speed": "keep 0.7",   "vs_target": "above target", "progress_m": 2.1, "outcome": "clear"},
    {"id": "hard_brake",     "steer": "hold lane",        "speed": "brake hard", "vs_target": "at target",    "progress_m": 0.1, "outcome": "clear"}
  ],
  "rejected": {"runs_red": 3}
}
```

Three maneuvers that would have run the red light were removed by code before Jev saw anything.
The `motion` question, including the situation-specific sentence the code added:

> You are the driving policy of a car in city traffic. Obey traffic controls and drive as described
> in `driving_style`. The car is at the line and the signal is red: hold still until it turns green.
> Decide whether the car should keep moving or hold still right now.
>
> **drive**: Keep moving: cruising, slowing down, or rolling up to a stop line that is not reached
> yet all count as driving. Correct whenever the line, obstacle, or destination is still ahead.
> **stop**: Hold completely still right now. Correct only when the car is already at the line with
> a red light or a stop not yet completed, when the path directly ahead is blocked, or when the car
> has reached the destination.

Jev's live answer: `motion = stop` at 100% and `vector = keep_lane_stop` at 99%, in 100 ms, for
$0.00006. Twenty meters earlier, the same questions got `drive` at 100% and `stop_at_line` at 95%.

**Wording matters.** When the `stop` option was described as "a stop sign not yet completed", Jev
stopped 47 m before the sign and waited there. Describing *when* each option is correct fixed it.

## The simulation

- **The car.** A bicycle model with two properties real cars have: brakes and throttle respond with
  a short lag and cannot change instantly, and the tires have limited grip shared between braking
  and cornering (so a turn taken too fast drifts wide off the road). The same model drives every
  car and every prediction, so predictions match what really happens.
- **Traffic.** 40 cars follow their lanes, keep a safe gap, stop for red lights and stop signs,
  yield to oncoming cars when turning left and to crossing cars at uncontrolled junctions, and use
  their turn signals.
- **The map.** Stop lines sit just short of the crossing street, a little further back at signals
  to leave room for a crosswalk. Signal timing is invented (48-second cycles), because
  OpenStreetMap does not record it.
- **The scene.** Everything is generated in code, with no downloaded assets: sky and sun with
  moving shadows, textured roads, curbs, boulevards and sidewalks, lane markings and crosswalks,
  mast-arm traffic signals, stop signs, street lights, trees, and houses with windows and pitched
  roofs.

## Benchmark

![The benchmark page: twelve drives with pass rate, safety, comfort, and lane-keeping metrics](docs/bench.png)

Open http://127.0.0.1:8322/bench to score a driver on a fixed suite of drives. Use it to compare
Jev against Rules, or to check that a change made things better rather than just different.

- **Reproducible suite.** Start points, destinations, and traffic come from a seed. The same map and
  seed always produce the same drives.
- **Same code as the app.** Each drive runs without graphics but through the same world, traffic,
  and autopilot you watch in the simulator.
- **Two clocks.** *Lockstep* pauses the world while a decision is pending, which measures decision
  quality alone; with Rules the results are identical on every run. *Realtime* keeps the world
  moving during a request, as in the app, so model latency counts.
- **Save, compare, replay.** Runs are saved to `data/runs/`, any two can be compared side by side,
  and **watch** replays a drive in the 3D simulator.

A drive **passes** if it arrives with no collision, no red light run, no rolled stop sign, and less
than one second off the road. The page also reports whose fault each collision was, the closest gap
and shortest time to collision, safety-brake interventions, hard braking, jerk (how abruptly the
car changes acceleration), cornering force, distance from the lane center, speeding, decisions,
tokens, cost, and latency.

**Baseline (Rules, 12 drives, seed 1, 40 traffic cars):** 11 of 12 drives pass over 9.8 km, with
no collisions, no red lights run, no rolled stop signs, 1.9 s off the road in one drive, and an
average distance from the lane center of 0.34 m. The run is included as
`data/runs/20260923-185357-rules.json`; choose it under **compare with**.

A Jev benchmark of the same suite is about 4,700 decisions, roughly $0.40.

## Measured with Jev

One 755 m drive in Kitsilano with 40 traffic cars, one stop sign, and three traffic lights, recorded
on 2026-09-18 with an earlier version of the car model:

| | Jev |
|---|---|
| live decisions | 431 in 129 s |
| latency, median / 90th percentile | 130 ms / 199 ms |
| input tokens per decision | about 1,800 |
| cost of the drive | $0.033 (Jev charges for input tokens only) |
| collisions / stop signs missed | 0 / 0 |
| red lights | 1, entered as the light turned from yellow to red |

This is one drive on one route; the benchmark is the way to get comparable numbers.

## Your own neighbourhood

Set a bounding box (west, south, east, north, in degrees) and start the server:

```sh
JEV_FSD_BBOX="-123.1120,49.2570,-123.0940,49.2680" uv run server.py
uv run scripts/fetch_map.py mount_pleasant      # or build a map ahead of time (presets: kitsilano, mount_pleasant)
```

Keep it neighbourhood-sized: under 0.25 square degrees (the OpenStreetMap API limit) and roughly
1 to 2 km across for a smooth frame rate. The first run downloads the map and caches it in
`data/maps/`; the Kitsilano map is included, so the default works offline. If the download fails,
the app uses a synthetic street grid and says so.

### Configuration

All settings are optional and go in `.env` or the environment (see `.env.example`).

| Setting | Default | Meaning |
|---|---|---|
| `TYPESAFE_API_KEY` | none | enables Jev mode |
| `JEV_FSD_BUDGET_USD` | `1.00` | stop live Jev calls after this much spend in one server run |
| `JEV_FSD_RPM` | `240` | maximum live Jev calls per minute |
| `JEV_FSD_NPCS` | `40` | number of traffic cars |
| `JEV_FSD_BBOX` | Kitsilano | map area, as `W,S,E,N` or a preset name |
| `PORT` | `8322` | server port |
| `TYPESAFE_DEFAULT_MODEL`, `TYPESAFE_BASE_URL` | SDK defaults | model and API endpoint |

## Security and privacy

- **Your API key stays on the server.** The browser never receives it; decisions go through the
  local server, which forwards them to TypeSafe.
- **The server only listens on `127.0.0.1`,** and refuses requests from other websites (host
  allow-list, browser fetch metadata, origin checks, a per-session token, and JSON-only bodies), so
  a page you visit cannot drive it or spend your credits.
- **Spending is capped.** A per-run budget and a rate limit apply to live calls (see Configuration).
- **What is sent to TypeSafe:** the decision state and questions shown in the panel. That is
  distances, speeds, street names, and maneuver descriptions in the car's own frame, with no map
  coordinates and nothing about you.

## Limitations

- No pedestrians, cyclists, or parked cars; traffic cars never change lanes.
- One-way streets, turn restrictions, and lane counts are only as good as the OpenStreetMap tags.
  Roundabouts and complex junctions are handled crudely.
- The car model has no weight transfer, skidding, or yaw dynamics, and road grip is a single
  number (there is no weather yet).
- Known issues from the benchmark: one of the twelve baseline drives still leaves the road briefly;
  the Rules driver's speed changes are more abrupt than comfortable driving; one drive needs several
  safety-brake interventions.
- It runs locally only. There is no hosted version.

## Development

### Tests

```sh
uv run python -m unittest discover tests    # offline: geometry, road graph, traffic controls, routing, API
open http://127.0.0.1:8322/tests            # in the browser: car model, controller, collisions, candidates, state
open http://127.0.0.1:8322/bench            # the benchmark suite
uv run scripts/verify_jev.py                # live: saved decisions in data/snapshots/ against the real model
```

Snapshots are real decisions saved with the panel's **Save snapshot** button, each with an
expectation such as "at a red light, `motion` is `stop` with probability above 0.5". Run them after
changing any question wording, and run the benchmark after changing the car, traffic, planner, or
router.

### Headless runs (macOS)

`scripts/shot.swift` opens a page in an offscreen browser view, runs JavaScript, and saves a
screenshot. A page in a hidden window does not animate, so scripts advance the simulator with
`window.__jev.advance(seconds)`. The benchmark can be run the same way:

```sh
swift scripts/shot.swift http://127.0.0.1:8322/bench out.png 1 \
  "return JSON.stringify((await window.__bench.run({ brain: 'rules', count: 12, seed: 1 })).summary)" "" 4 900
```

### Adding another driver

Drivers live in `static/js/brain/`. A driver exposes
`decide(snap, eligible, request, signal)` and resolves to `{ motion, candidateId, meta }`, where
`motion` is `"drive"` or `"stop"`, `candidateId` is one of the eligible maneuvers, and `meta` holds
timing and cost. Register it in the `Autopilot` constructor in `brain.js` and add it to the driver
menus in `static/index.html` and `static/bench.html`. The benchmark will then score it like any
other.

### Project layout

```
server.py            local web server: pages, map, routing, the Jev proxy, benchmark storage
jev/                 Python: TypeSafe client and spend guard, request checks, settings
jev/osm/             OpenStreetMap download → road graph → traffic controls → buildings → map pack
jev/routing.py       route planning with turn penalties and smooth lane-to-lane joins
static/js/sim/       car model, controller, collisions, signals, traffic, world
static/js/brain/     sensing, maneuvers, the questions for Jev, the Rules and Jev drivers, safety brake
static/js/bench/     benchmark suite, headless runner, metrics
static/js/render/    3D scene: sky, streets, buildings, trees, cars, overlays, minimap
scripts/             map pre-builder, live snapshot checker, headless screenshots
data/                maps, saved decisions, benchmark runs
```

## Contributing

Issues and pull requests are welcome. Before opening a pull request, run the offline tests, the
browser tests, and a Rules benchmark (seed 1), and include the benchmark comparison against the
committed baseline if your change affects driving.

## Credits and license

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under
  the Open Database License (ODbL).
- 3D rendering by [Three.js](https://threejs.org/) (MIT).
- Jev and TypeSafe are products of TypeSafe AI. This project is independent and not affiliated with
  or endorsed by TypeSafe AI.
- Inspired by [JevPilot](https://github.com/standardagents/jevpilot).

Released under the [MIT License](LICENSE).
