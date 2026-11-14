# Low sun glare (`sim/sun-glare.js`)

`World` option `sunGlare` is on in free drives unless `?sunglare=0`, and in the **Into the sun**
challenge (`sunGlare: true`). With it off nothing in the module runs, `World.visibility.glare`
stays null, the clock keeps its `{ hour, sun_deg, weekday? }` shape, and no metric key is added;
nothing in the feature is random, so no stream is drawn from.

**The sun.** `sunOf(world)` takes the clock's `hour` and the pack's `origin` (lat/lon). With a
`day` of the year on the clock (a challenge's `date: "MM-DD"`, `dayOfYear`), it uses the NOAA
general solar position formulas: fractional year, equation of time, declination, true solar time
and hour angle, without refraction. The hour is local time at the clock's `utc_offset` (a
challenge's `utcOffset`); without one, local mean solar time at the map's longitude (offset
lon/15), up to an hour off a real time zone. Without a `day` (free drives), the sun is the one the
sky has always drawn: `sunAngles` in `sim/speed-zones.js` (late September, declination −1.5°, no
equation of time), at the city's catalogue offset, so the sky, street-light darkness and glare
agree. `render/atmosphere.js` draws a `day`'s sun (via `solarAngles`) only when the clock has one.
`scripts/test_sun_glare.mjs` checks solstice/equinox declinations, the equation of time's
extremes, solar-noon elevation and azimuth, and the equinox sunset at the equator.

**Glare.** `glareFor(world, vehicle)` applies with `weather.name === "dry"` (rain, fog and snow
come with an overcast sky), `visibility.night ≤ 0.5`, the sun 0–20° up, and the vehicle heading
within 30° of the sun's azimuth. Severity is the product of alignment (full within 10°, smooth to
0 at 30°) and lowness (full up to 10°, smooth to 0 at 20°). Sight drops from the weather's range by
65% of severity (at least 20 m), and the ceiling is the speed that stops within it after a 1 s
reaction at `comfort().decel`, 5 m short: the same rule as sensing's visibility speed. Buildings
do not shade the sun; the challenge's avenue runs straight at it.

**Shared policy.** The World installs `visibility.glare`, which limits only the driven car's
`rangeAt`/`reachAt` for points within 35° of the sun's bearing, so signals, pedestrians and
traffic ahead are observed later by sensing, prediction and the audit's sight checks. Sensing
reports `sun_glare` (`severity`, `sight_m`, `ceiling_mps`, the sun's azimuth and elevation, and how
far off the heading it is) and caps `snap.limit`; the target speed names "sun glare". Rules and
the cautious agent follow the capped target; model state includes `sun_glare` and a situation
clause tells Jev and LLM drivers to keep to the ceiling, leave room and expect unseen signals and
crossings. Traffic heading into the sun caps its desired speed at the same ceiling (cyclists
excepted). The memo in `egoGlare` keys on everything glare depends on, so checkpoints restore it.

**Audit.** `auditSunGlare` counts `glare_speeding_seconds`, the time more than 1 m/s over the
ceiling, after a 1 s reaction plus the time to slow from the current speed at comfort braking
whenever glare starts or the ceiling drops (`World.sunGlareCall`). `World.sunGlareSeen` gates the
metric; above 1 s it fails the drive ("too fast for sun glare"), costs 3 safety points a second,
adds a coaching tip and a `sun_glare` replay marker and trace event.

**Rendering.** `render/sun-glare.js` (only where the world has glare on) draws a flare and halo
on the sky's sun, lens ghosts and a warm veil, scaled by how directly the camera looks into a low
sun in clear weather and kept up by the car's glare severity. The HUD says **SUN GLARE ·
SLOWING** or the sight distance.

**Into the sun** uses Calgary's 17 Avenue SW westbound (`e267` → `e136`), 18:15 MDT on
8 October (`utcOffset: -6`): the sun is at about 6.1° and 253°, 17° off the avenue, severity 0.73,
42 m of sight and a 10.7 m/s ceiling. The coordinated signals start 25 s into their cycle, so
4 Street SW is red on arrival and 5 Street SW green; a pedestrian crosses `e273` mid-block from the
south curb. November was considered and rejected: at 51° N the low November sun is 25–35° south of
west. Checks: `scripts/test_sun_glare.mjs` (its `--write-snapshot` regenerates the live model case
`data/snapshots/into_the_sun.json`).

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Sun glare is opt-in.** `World` option `sunGlare` (free drives unless `?sunglare=0`; challenges with `sunGlare: true`) computes the sun from `world.clock` (`hour`, and `day` of the year and `utc_offset` only when the clock has them) and the pack's origin (`sim/sun-glare.js`). A clock without `day` keeps the sky's late-September sun (`sunAngles` in `sim/speed-zones.js`) so the sky, darkness and glare agree; the sky draws a challenge's date only when its clock has one. Glare applies on a clear, daylit road when the sun is 0–20° up and within 30° of a vehicle's heading. The World installs `visibility.glare`, which shortens only the driven car's sight towards the sun; sensing (`sun_glare`, capping `snap.limit`), traffic (a speed cap) and the audit share `glareFor`/`glareCeiling`, built on `comfort()`. `glare_speeding_seconds` reaches metrics and fails a drive above 1 s only after glare has applied (`World.sunGlareSeen`). With it off nothing is computed, nothing is random, the clock keeps its old shape, and the seeded benchmark and other challenges play out and report exactly as before; keep it that way.
