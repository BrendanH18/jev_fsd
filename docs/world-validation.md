# World expansion validation — 2026-09-30

Eight real OpenStreetMap neighbourhoods across seven Canadian cities are bundled. The new
maps are Mount Pleasant, Calgary Beltline, Ottawa Centretown and Québec City Saint-Roch.
See [map coverage and attribution](maps.md) for coordinates, provenance and pack statistics.

## Simulation changes

Building polygon exteriors block the driven car and candidate predictions. A spatial index
limits nearby queries, and sweeps sample at most 20 cm of corner travel before refining the
first contact. Contact stops the car at a safe pose and clears longitudinal, lateral and yaw
motion; sustained contact counts once. Courtyard holes, crash damage and impulse responses
are not modeled. Mapped buildings remain known geometry when moving hazards are hidden.

Route-control auditing now uses the same upcoming control as sensing when the car is within
4 m of its route and aligned within 60 degrees. Otherwise physical-lane controls apply.
This fixes a stop-memory deadlock where the front bumper reached the stop line while the
rear axle was still on an adjacent road segment, without auditing a remote or reversed route.

Darkness follows the renderer's local sun position. Full darkness caps forward low-beam
detection at 45 m and unlit peripheral detection at 22 m; twilight interpolates smoothly and
weather caps both. These are simulator assumptions, not measured headlight performance.
Individual street lamps do not extend sensing. The daylight clock uses simulation time and
pauses with the world; fixed, 1× and 60× rates are available.

## Checks

- 60 Python tests pass, including real map identity, three distinct reachable drives from
  three positions on every map, routing, server security and parallel asset downloads.
- 137 browser assertions pass: 99 simulation, 18 HUD and 20 explorer checks. Explorer tests
  cover accented search, focus preservation, current-map accessibility, loading errors,
  retries, request cancellation and queued close/reopen events.
- 88 WebGL renderer assertions pass using the locally bundled Three.js runtime, including
  wet rendering and quality transitions.
- 13 static collision and six route-control regressions pass. Static checks cover enclosing
  and concave polygons, reverse/rotation sweeps, sustained contact, resets, score caps,
  candidate rejection and agreement between prediction and execution.
- World-condition checks cover midnight wrap, pause/rate changes, bounded URL settings,
  rotating headlight sight, fog limits, building occlusion and the production speed target.
- 18 scoring tests, interpolation checks and 20 offline Jev requests pass. Generated
  realism fixtures match the pipeline. Live Jev was not exercised and no API spend was made.

The native preview was exercised in Calgary, Ottawa and Québec City. Search, city switching,
world restart with zero traffic and seed 42, and pause/daylight progression worked. Desktop
Explorer and settings screenshots were reviewed. At 390×844 the modal stayed within the
viewport with zero horizontal overflow; mobile screenshot capture timed out, so that check
was limited to DOM geometry. Keyboard driving remains required.

Cold module downloads exposed connection resets with the server's default request backlog.
The server now queues 128 connections, and the simulator successfully loaded all 15 local
Three.js modules. Startup module, map and WebGL failures also show an actionable retry.
The renderer is pinned to 0.183.0 with upstream license and verified archive integrity in
[`static/vendor/three/README.md`](../static/vendor/three/README.md).

## Seeded Rules comparison

Production `buildSuite`, `runScenario` and `stepWorld`, seed 1, 40 traffic cars, lockstep.
The baseline uses the repository's previous `HEAD` JavaScript against the same maps and routing
server. [Machine-readable comparison](validation/world-expansion-rules.json) records the commit,
summaries and per-route results. These small suites do not establish universal driver safety.

| Map and conditions | Before | After | Arrival after | Remaining failures |
|---|---:|---:|---:|---|
| Kitsilano, dry | 10/12 | 10/12 | 12/12 | Two existing shared/other-fault contacts |
| Kitsilano, fog | 10/12 | 10/12 | 12/12 | One other-fault contact; 1.4 s off-road on another route |
| Mount Pleasant, dry | 0/2 | 2/2 | 2/2 | None in this smoke suite |
| Calgary, dry | 1/2 before route-memory fix | 1/2 | 2/2 | One other-fault contact |
| Ottawa, dry | 2/2 before route-memory fix | 2/2 | 2/2 | None in this smoke suite |
| Québec City, dry | 2/2 before route-memory fix | 2/2 | 2/2 | None in this smoke suite |

Mount Pleasant also passed 2/2 in fog after the route-memory fix. Kitsilano retained zero
red-light, stop and yield violations and no at-fault collisions. No building collisions were
introduced on these routes. Dry mean speed changed from 22.03 to 22.55 km/h and fog mean speed
from 17.08 to 17.06 km/h; the changes do not establish a performance or safety improvement.
Rain, snow and night were not rerun as full seeded suites in this revision.

Run the commands in the README, then open `/tests` and run the renderer assertions from the
simulator console. `/bench` reproduces the seeded city suites without graphics.
