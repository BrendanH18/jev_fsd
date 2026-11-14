# Snow plows

Snow plows (`static/js/sim/snow-plow.js`, `render/snow-plow.js`): while it snows, a city plow (a
single-axle dump truck, 9.8 m with its blade, 2.6 m wide, a salt spreader on its box, the wing blade
folded up on its right) clears the main streets at 18 km/h whatever the weather, its blue and amber lamps
flashing in turn. Manitoba's Highway Traffic Act (in force in 2026) says to stay 30 m back from a plow
with its blue warning lamps on where the limit is 80 km/h or less, 100 m above that, and not to pass one
where blowing snow hides the view ahead or passing would get in the way of its work; the City of Winnipeg
adds never to pass one on the right, the side snow and debris are plowed to, and Ontario that a plow may
be passed only in a lane clear of every part of it (a wing can reach 3 m to its right). So the driven car
stays that far behind a plow going its way in its lane, and behind one in the lane to its left too: it
never draws level with one on its right. It passes one only on the left, through a lane going its way
(never across the centre line), and only seeing as far as it ever does (80 m: in falling snow, fog, rain
or after dark it stays behind, even one in the lane to its right) with nothing hiding its route ahead
within 60 m, and it moves back in front of it only
once its rear is the stay-back distance ahead of the plow's front. A plow signalling a left turn may be
passed on the right, as any vehicle turning left. The 100 m is further than the car ever sees, so there
it keeps back as far as it can see (about 75 m). Traffic keeps to the same rules (following the
stay-back distance behind one, never passing one on the right, holding back behind one in the lane to
its left, and in poor sight behind one in the lane to its right, passing on the left only with a clear
view, never changing lanes in front of one closer than the stay-back distance). The car's sensing reports
`snow_plow` for the nearest one it can see going its way in its lane or one beside it, from 60 m ahead
(or the stay-back distance, where further) until the car is the stay-back distance past it: its lane from the car, gap, speed, whether the car must
stay back of it (`holds`), may pass it on the left now (`may_pass`) or is passing it (`passing`). The
target speed keeps the car back: no faster than the plow at the stay-back distance, down to standing
still at a third of it, and beside one on its right it drops back behind it. The car's lane options
offer a pass round a plow only on the left and only when it may, the left lane's speed not held to the
plow's, and any lane change into the plow's lane in front of it needs the stay-back distance behind the
car. Candidates are rejected that take the car's front past the plow's rear while the car is right of
its lane (`passes_plow_on_right`), or that end closer to it than the stay-back distance and closer than
now, in its lane or one to its right (`follows_plow_too_close`). Decision models and LLMs get
`snow_plow`, a situation line and a prompt line. The audit counts passing one on the right (the car's
centre drawing level with the plow's in the lane to its right, the plow not turning left) as
`plow_right_passes`, once a pass, which the metrics report and fail a drive on once a plow has worked in
it (`passed plow on the right`), and notes moving back in front of one passed on the left less than the
stay-back distance (less 3 m) ahead of it. Coaching counts time moving closer than 20 m behind one it
must stay back of (`plow_close_s`), passes on the right and cut-ins, with tips, only for a drive a plow
worked in. The HUD says "SNOW PLOW AHEAD · STAY 30 M BACK", "SNOW PLOW · NEVER PASS ON THE RIGHT · STAY
30 M BACK", "SNOW PLOW · CAN'T SEE TO PASS · STAY 30 M BACK" or "PASSING THE SNOW PLOW · BACK IN ONLY 30 M
AHEAD OF IT", and AI eyes outline the plow in
amber. In a free drive one plow at a time works the primary, secondary and tertiary streets while it
snows, put down out of the car's sight 150 to 450 m away and taken off once out of sight 500 m away,
another coming 30 to 90 s later; when the snow stops no more come (`?plows=0` takes them off). The wing
blade is drawn but is not part of the plow's body in the sim, and an oncoming plow asks nothing of the
car. The seeded benchmark and the other challenges have none.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Snow plows are opt-in.** `NpcFleet` option `plows` (free drives, unless `?plows=0`) puts a plow on the main streets while it snows, from its own random stream (`sim/snow-plow.js`); the "Behind the plow" challenge places one itself. The audit's `plow_right_passes` reaches the metrics, and fails a drive, only once a plow has worked in it (`World.plowsSeen`), so the seeded benchmark and the other challenges report exactly as before; keep it that way.
