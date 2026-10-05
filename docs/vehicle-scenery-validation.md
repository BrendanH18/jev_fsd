# Vehicle and scenery validation

The garage provides six generic vehicle models and six paints. Select them in Settings,
then use **Start new world**. `car=compact|sedan|sport|wagon|suv|pickup` and `paint=RRGGBB`
also select a vehicle on startup. Invalid choices fall back to the blue touring sedan.

Driven vehicle dimensions, mass, wheel power, centre of gravity and drive layout feed the
same physics used by forward predictions. Stop lines, queue gaps, pedestrian stopping marks,
route-end controls, scoring gaps and lane changes account for its actual bumpers. Visual
axles, track, headlight origins, contact shadow and hood camera follow that model.

Rendering and collision checks share deterministic placements for tree trunks, lamp bases,
street/stop/yield signposts, signal poles, porches, porch steps and supporting posts, and hedges.
Mapped building footprints remain solid. Circle cross-sections use exact OBB overlap,
analytic sweeps for translation and conservative advancement for rotation. Walls and exterior
polygons use sampled swept checks. A contact stops the car without penetration and counts
once until the car separates for a second. Reversing away after repeated throttle against
a post has a dedicated regression.

Validation completed:

- 60 Python tests and 137 browser simulation/HUD/explorer assertions.
- 88 renderer assertions, including six vehicle silhouettes, actual axle/track/body dimensions,
  finite geometry, lights, shadows and cameras, instanced parked LOD, real sign rasterization
  and wet WebGL frames across graphics settings.
- 22 vehicle regressions covering dimensions, clone state, powertrain differences, dry/wet
  stability, stopping/queue/pedestrian clearances, safety braking and route-end control positions.
- 13 building and 11 scenery collision regressions, six route-control regressions, 19 scoring
  tests, interpolation and world-condition checks, and 20 valid offline model requests.
- 24 real Kitsilano Rules drives: six vehicles, two seeded routes, dry/rain, 16 traffic cars.
  All arrived with no collisions, traffic violations or off-road time. Safety braking intervened
  21 times. The two routes total 1.22 km, with five signals, two stops and multiple turns.
- The broader sedan suite with 40 traffic cars retains 10/12 passes in both dry and fog,
  with all 24 routes arriving. Existing non-ego collisions and fog off-road time remain;
  this suite does not establish perfect driving. No scenery collisions occurred.

Seeded results are in [vehicle-scenery-rules.json](validation/vehicle-scenery-rules.json).
The six-model smoke routes do not exercise roundabouts. Traffic's numeric body styles retain
the common sedan physics footprint, while the garage's driven models have distinct dimensions.
Crash deformation, physical suspension, elevation and courtyard holes remain outside the model.
Overhead tree crowns, signal arms and porch roofs do not form ground-level blockers;
low curbs stay traversable and distant background scenery remains decorative.

Run the regression commands in the README. From a loaded simulator browser, run:

```js
const results = await import('/tests/render-tests.js').then(m => m.runRenderTests());
console.table(results.filter(r => !r.ok));
```
