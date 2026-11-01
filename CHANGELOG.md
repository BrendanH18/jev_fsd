# Changelog

## Unreleased

- Lane closures and the zipper merge (`static/js/sim/lane-closure.js`, `render/lane-closure.js`). A road
  crew closes the curb lane of a straight block with two lanes going its way, with cones angled across it
  from the merge point, its truck and flashing arrow board, two workers, a "right lane closed ahead" sign
  80 m back and a "take turns at merge" sign at the merge point, but no flagger. Manitoba's driver's
  handbook teaches the zipper merge, and the City of Winnipeg signs it at lane closures; Ontario cities
  and police ask for it too, and the Alberta Motor Association says merging late is right: use both lanes
  right up to the merge point, then take turns, one vehicle from each lane. Traffic and the driven car now
  do. Nobody changes lanes into or out of the closed lane from 80 m short of the merge point, and the
  closed lane's traffic moves across over a 30 m taper at the merge point and back once past the work.
  Within 25 m of the merge point, the one nearest it in the closed lane is at the merge. It is the closed
  lane's turn when the last vehicle through came from the open lane, or nobody in the open lane is coming
  within 40 m; then it is let in once the lane beside it is clear and whoever comes up behind can fall in
  behind it, and the first in the open lane stops short of it to let it in (7 m short of the merge point,
  and behind its rear). Otherwise it waits at the merge point. One that stands still 6 s on its turn
  loses it, so a car that does not go never holds the open lane up. Everyone keeps to 30 km/h from the
  merge point to the end.
- The driven car's sensing reports `lane_closure` (its lane, the merge point, whose turn it is, whether it
  has been let in, whether it waits and for whom, and in the open lane whom it lets in). The candidates
  `wait_to_merge` and `let_merge_in` stop for it; candidates that go through the merge point out of turn
  (`merges_out_of_turn`), past where the car lets someone in (`takes_merge_turn`), change lanes out of the
  closed lane before the merge point (`merges_early`) or into it (`into_closed_lane`) are rejected. In the
  closed lane every lane candidate carries the way across. Decision models and LLMs get `lane_closure`, a
  situation line, a motion criterion and a prompt line.
- The audit counts going through the merge point out of turn, once the car owed its wait there, as
  `merge_cut_ins`, which fails a drive (`merged out of turn`) once a closure has stood in it. Coaching
  counts cut-ins, not letting someone in (`merge_turns_taken`) and merging early (`early_merges`), with
  tips, only for drives a closure stood in, and the closure's 30 km/h as a work zone's. The HUD says
  "RIGHT LANE CLOSED AHEAD · STAY IN LANE TO THE MERGE · TAKE TURNS", "WAIT YOUR TURN · LET THE NEXT CAR GO
  FIRST", "YOUR TURN · MERGE NOW" and "LANE ENDS BESIDE YOU · LET ONE CAR IN · TAKE TURNS"; AI eyes
  outline the closure, and the car it waits for or lets in, in amber.
- In a free drive one closure at a time stands 150 to 450 m from the car, out of its sight, for 4 to 8
  minutes (`?closures=0` takes them off).
- New challenge, "Take turns" (Calgary, 14 Avenue SW, one-way, two lanes, 50 km/h): the right lane is
  closed, seven cars queue in the left lane back from the merge point and two wait at it in the right
  lane, ahead of the car. Rules and the cautious agent drive up the right lane, wait their turn and merge
  after the third car in the left lane, not straight after the second car in their own.
- New checks in `scripts/test_lane_closures.mjs`. The seeded benchmark and the other twenty-eight
  challenges have no lane closures and play out exactly as before.

- Snow plows (`static/js/sim/snow-plow.js`, `render/snow-plow.js`). While it snows, a city plow clears the
  main streets at 18 km/h, its blue and amber lamps flashing, its blade angled to throw the snow off to
  the right. Manitoba's Highway Traffic Act (in force in 2026) says to stay 30 m back from a plow with its
  blue warning lamps on where the limit is 80 km/h or less (100 m above that), and not to pass one where
  blowing snow hides the view ahead; the City of Winnipeg adds never to pass one on the right, the side
  the snow and debris are plowed to. The driven car now stays that far behind a plow in its lane, and
  behind one in the lane to its left as well, never drawing level with one on its right. It passes one
  only on the left, through a lane going its way, never across the centre line, and only when it can see
  its route ahead and as far as it ever does (so never in falling snow, fog, rain or after dark, from whichever lane), and
  moves back in only once it is the stay-back distance ahead of it. A plow signalling a left turn may be
  passed on the right. The 100 m is further than the car ever sees, so there it keeps back as far as it
  can see. Traffic keeps to the same rules, the stay-back distance included.
- The driven car's sensing reports `snow_plow` (its lane from the car, the gap, its speed, whether the car
  must stay back of it, may pass it on the left, or is passing it). The target speed keeps the car back,
  the lane options offer a pass only on the left and only when it may, and no lane change puts the car in
  front of one closer than the stay-back distance. Candidates that would take the car past a plow on its
  right (`passes_plow_on_right`) or close in on one inside the stay-back distance
  (`follows_plow_too_close`) are rejected. Decision models and LLMs get `snow_plow`, a situation line and
  a prompt line.
- The audit counts passing a plow on the right (`plow_right_passes`), which fails a drive (`passed plow
  on the right`) once a plow has worked in it, and notes moving back in front of one too soon. Coaching
  counts time too close behind one (`plow_close_s`), passes on the right and cut-ins, with tips, only for
  drives a plow worked in. The HUD says "SNOW PLOW AHEAD · STAY 30 M BACK", "SNOW PLOW · NEVER PASS ON THE
  RIGHT · STAY 30 M BACK", "SNOW PLOW · CAN'T SEE TO PASS · STAY 30 M BACK" and "PASSING THE SNOW PLOW · BACK IN ONLY 30 M AHEAD OF IT"; AI eyes outline the
  plow in amber.
- In a free drive in snow one plow at a time works the primary, secondary and tertiary streets, put down
  out of sight 150 to 450 m from the car and taken off once out of sight 500 m away (`?plows=0` takes them
  off).
- New challenge, "Behind the plow" (Winnipeg, William Avenue, two lanes each way, 50 km/h, snow): a plow
  clears the left lane 20 m ahead of the car, and the curb lane beside it is empty to the destination.
  Rules and the cautious agent stay 30 m behind it in the curb lane all the way; with the same truck not
  known to be a plow, Rules goes by it on the right.
- New checks in `scripts/test_snow_plows.mjs`. The seeded benchmark and the other twenty-seven challenges
  have no plows and play out exactly as before.

- Hidden traffic (`static/js/sim/hidden-traffic.js`). With the `World` option `hazards` (free drives,
  unless `?hazards=0`; challenges with `hidden: true`), road vehicles now hide other vehicles and cyclists
  from the driven car, as they already hid pedestrians: one is out of sight when every line from the car to
  its middle, nose and tail passes through the body of another road vehicle, one in traffic (not a cyclist)
  or one standing in the road (a double-parked van, a vehicle stopped at the roadside, a work zone's). Cars
  parked in a parking lane do not hide traffic (they still hide people): the car looks from its rear axle,
  and from there a street lined with them would hide all of its traffic. Sensing, candidate predictions and
  the emergency brake all go by what the car can see.
- Turning left, the car now waits until it can see along each oncoming lane, as driver's handbooks across
  Canada say to: a vehicle waiting to turn left from the other side of the junction can hide a car coming
  straight through in the lane beside it. It looks back along each lane from the junction, every 3 m, as
  far as traffic at that street's limit covers in the time it needs to turn, within what it can see at all;
  a vehicle it can see standing in a lane (queued, or waiting to turn) covers the rest of that lane, one
  coming along it does not. Until it can see far enough it waits short of that lane's path, but no further
  in than the near edge of the street it crosses, so that the vehicle waiting opposite has room to turn in
  front of it. Inside the junction once the light has changed, it clears the junction as before.
- Giving way at a two-way stop or a junction without a sign, a vehicle hiding the street it gives way to
  makes the car creep up to look, as a building does; stopped where it looks from, it waits up to 8 s for
  the vehicle to move before going once nothing it can see is coming. Turning right on red, a vehicle
  hiding the street to its left keeps it waiting, for the green if need be.
- The driven car's sensing reports `intersection.oncoming` with `view` (the vehicle hiding the lane and
  how far along it the car sees; `id` is null when the hidden lane alone holds it), `give_way.hidden_by`
  and `waiting_to_see`, and `right_on_red.wait_for.hidden_by`. Decision models and LLMs get
  `intersection.oncoming.lane_hidden_by` and `sees_lane_m`, situation lines and a prompt line. The audit
  marks a failure to yield to a vehicle the car could not see as it pulled out (`unseen`), and coaching
  counts those (`hidden_cutoffs`, with an incident and a tip, only with hidden hazards on). The HUD says
  "THE VAN HIDES THE ONCOMING LANE · WAIT UNTIL YOU CAN SEE", "THE CAR HIDES THE CROSS STREET · CREEP UP
  AND LOOK" and "… HIDES TRAFFIC FROM THE LEFT · WAIT"; the AI eyes panel says which lane is hidden.
- New challenge, "Blind left" (Kitsilano, West 4th Avenue, two lanes each way, 50 km/h): a left turn on a
  green, with a delivery van waiting in the junction opposite to turn left, its indicator on. Once the car
  is 45 m from its line, a car sets off 75 m before the opposite line in the lane beside the van, at
  45 km/h, straight through, hidden behind the van; a second after it is through, the van turns. Rules and
  the cautious agent wait at the edge of the cross street, see the car only as it comes out from behind the
  van (at about 28 m), and turn once the van has gone and they can see. Held only by what it could not
  see, Rules had the hidden car 2.2 s from the junction against the 4.4 s it needed to turn. Without hidden
  hazards the car sees through the van and waits for the car as for any.
- Saved arena runs take about a third of the space (`static/js/lab/trace.js`, schema
  `jev-agent-evaluation-v3`): a decision no event links to is kept as a compact choice record, without
  empty fields, and a run of the same choice one after another as its first record with `repeats` and
  `until_s`. Two runs of all twenty-seven challenges with Rules and the cautious agent now take 38.8% of
  the 9 MB cap (36.8% for the twenty-six before "Blind left", down from 98.2%). Results and the linked
  decision snapshots are unchanged; v1 and v2 exports still import, and the arena shows how many decisions
  a record stands for.
- New checks in `scripts/test_hidden_traffic.mjs`, `scripts/test_arena_history.mjs` and on the `/tests`
  page. The seeded benchmark and the twenty-five challenges without hidden hazards play out exactly as
  before.

- Hidden hazards (`static/js/sim/hidden-hazards.js`, `sim/blind-spot.js`). Cars parked at the kerb now hide the people behind
  them, as moving traffic already did: with the `World` option `hazards`, a vehicle standing at the kerb
  (a parked car, a van double-parked or stopped at the roadside) hides a pedestrian from the driven car when
  every line to them passes through it (sensing is in plan view, so a body hides whatever is behind it,
  whatever its height). Driver's handbooks across Canada say to watch for children stepping out from
  between parked cars and to drive at a speed you can stop from, and the car now does: beside a blind spot,
  a vehicle standing at the kerb ahead of it, parallel to it, within 2 m of its side, on a quiet street
  (residential, unclassified or a living street) or in a school or playground zone in effect, it keeps to
  the blind-spot speed, from which, 0.6 s after seeing someone step out 15 m ahead and braking at three
  quarters of the hardest the road allows, it stops 2 m short of them: 32 km/h on a dry road, 27 in rain,
  19 in snow. It slows to it gently by 20 m short of the first such vehicle (nobody steps out further ahead
  than 15 m) and keeps to it through gaps shorter than that; it looks 60 m ahead, and only vehicles it can
  see count.
- In a free drive (`?hazards=0` turns all of this off) someone now and then waits hidden between two cars
  parked along the car's side of a quiet street, 35 to 70 m ahead of it: a child more often than not, 20 to
  60 s into the drive and every 60 to 150 s after that, one at a time. Once the car's front is 15 m from
  their line they step out and walk across the street without looking, unless something else is on the
  street ahead of the car or coming the other way, in which case they stay put and go home unseen. Across
  the street they walk on along the far sidewalk with the crowd. The car only sees them as they come out
  from behind the cars. In 28 minutes of free-drive soaks on Kitsilano with 40 cars (two seeds dry, one in
  rain), ten people stepped out; Rules saw each of them at 13.9 to 14.8 m and stopped 4.8 to 10.2 m short,
  with no collisions.
- The driven car's sensing reports `blind_spot` (the side, how far ahead the parked cars start and end,
  the gap to them, why it counts, and the blind-spot speed), caps the limit and the target speed at it, and
  decides every 250 ms from 25 m short of one. Rules and every other driver keep to it through the limit;
  decision models and LLMs get `blind_spot`, a situation line and a prompt line. The coaching score counts
  time beside a blind spot faster than the blind-spot speed (`blind_spot_speeding_s`, once a street, in
  safety) with a coaching line and a tip, only for drives with hidden hazards. The HUD says "PARKED CARS
  HIDE THE SIDEWALK · 32 KM/H" and "CHILD STEPPING OUT FROM THE PARKED CARS · STOP" (or "PERSON").
- New challenge, "Between the cars" (Kitsilano, Stephens Street, 50 km/h): the car's side of the street
  is lined with parked cars 1.6 m apart, and a child stands hidden between two of them 110 m ahead. Once
  the car's front is 15 m from them they step out at 1.5 m/s. Rules and the cautious agent keep to
  32 km/h beside the parked cars, see the child at about 14 m, and stop 4 m short of them. Without hidden
  hazards, Rules is doing 49 km/h when they step out and hits them. Its two runs add 2.1% to the saved
  arena history, which with all twenty-six challenges takes 98.2% of the 9 MB cap. The seeded benchmark and
  the other twenty-five challenges have no hidden hazards, and play out exactly as before.
- New checks in `scripts/test_hidden_hazards.mjs` and on the `/tests` page.

- Parallel parking at the destination (`static/js/sim/parallel-park.js`). Near the end of a free drive the
  autopilot looks for an empty space in the parking lane on its right, before the destination and within
  60 m of it, that it can see and that is legal (BC Motor Vehicle Act s. 189(1) and s. 190(1)): not in a
  junction or on a crosswalk, nor within 6 m of the approach side of a crosswalk or of a stop line, nor in a
  bus stop zone, never on the block of a work zone or a double-parked van or on a street a level crossing is
  on. (Fire hydrants are not on the map, so the 5 m from a hydrant is not checked.) The space has to be long
  enough to reverse into in one go, which `vehicle.spec` decides: 6.6 m bumper to bumper for the compact,
  7.0 m for the sedan, 8.2 m for the pickup, about 1.55 car lengths. The car signals right from 40 m out,
  slows, and pulls up alongside the car in front of the space, its rear bumper level with that car's and
  0.6 m out from the parked cars (traffic coming up behind keeps back the room it will reverse into). Once
  nothing is behind it in that room or coming up the lane or the parking lane, it reverses in the way the
  handbooks teach: full lock toward the kerb, straight back, full lock the other way until parallel, the
  angle and the straight solved so that its front corner keeps 0.4 m from the car in front's, then straight
  forward to its spot, 0.9 m behind that car, its body 15 cm off the kerb. Each leg stops short of anything
  standing still (0.4 m), the wheels never touch the kerb (a bumper may reach over it), and the car stops
  and turns the wheel before each leg. Rules parks a sedan in a 7.3 m space in about 18 s from stopping.
  It gives the space up if it can no longer stop for it, if someone takes it, or after 30 s waiting there;
  with no space to be had it stops in its lane at the destination as before. Parked, the space stays the
  car's, and the next drive starts by pulling out the way it came in: back to where the S ended, signal
  left, wait until nothing is coming up the lane beside it within 25 m or 6 s, then out on full lock,
  straight, and back on the other lock into the lane. In a free drive the car parks wherever it can
  (`?park=0` stops it in its lane); the seeded benchmark and the other challenges never park and play out
  exactly as before.
- Traffic and cyclists coming up behind a car waiting to park hold back the room it reverses into until it
  is in; a driver stopped too close behind backs up out of it. The space's parking slots are reserved, so
  nobody else parks there.
- The driven car's sensing reports `parking` (the space, where it stops to reverse in and how far right of
  its lane's centre it pulls up there, what keeps it waiting, and the manoeuvre's leg). Rules gets
  `wait_to_park`, `park` and `pull_out` candidates, and rejects driving on past where it stops to reverse in
  (`passes_parking_space`); `stop_at_destination` is not offered while there is a space. Decision models and
  LLMs get `parking`, a situation line, a motion criterion and a prompt line. The cautious example agent
  parks too. The safety brake lets the car come within 0.3 m of what it parks beside, ignores oncoming
  traffic in its own lane while the car stands at an angle, and still watches behind it while it reverses.
- The audit counts a tyre on the kerb while parking or pulling out as a kerb strike, once a contact. The
  coaching score reports how the drive ended (`parking`: parked, how far from the kerb and how square, or
  stopped in lane), the kerb strikes, and tips; only drives that park report it. The HUD says "PARKING
  SPACE AHEAD · SIGNAL RIGHT · PULL UP ALONGSIDE THE CAR IN FRONT", "PARKING · CHECKING BEHIND · WAIT",
  "· CLEAR BEHIND · REVERSE IN", "· REVERSING IN", "PULLING OUT · TRAFFIC COMING · WAIT", "PULLING OUT",
  "PARKED" and "KERB STRIKE"; the drive report says "Parked at the destination" or "stopped in lane".
- New challenge, "Squeeze in" (Kitsilano, West 10th Avenue): one space left, 6.8 m long, between cars
  parked at the kerb, and a car comes up behind as the car slows for it. Rules and the cautious agent pull
  up alongside, keep the car behind back, reverse in and park within 30 cm of the kerb, which the
  challenge requires (`not parked` is a failure). Its runs are smaller than "Round the van"'s. The other
  twenty-four challenges play out exactly as before, and the evaluation engine version is unchanged.
- New checks in `scripts/test_parking_ego.mjs` and on the `/tests` page.

- Double-parked delivery vans (`static/js/sim/double-parked.js`, `render/delivery-van.js`). A high-roof
  cargo van stops in the travel lane of a straight block of a two-way street with one lane each way,
  beside the cars parked at the curb, its hazards flashing while its driver runs a parcel to a door. The
  only way past is round it through the oncoming lane, and, as every province's driver's handbook says,
  oncoming traffic has the right of way: a driver goes round only once it can see the way is clear for
  long enough to get round and back. Along the van's street the way round (a `detour`, as at a work zone)
  eases across from 18 m short of the van to just short of it, all the way into the oncoming lane, and
  back by 16 m past it; a driver waits with its front 7 m short of the van, back far enough to pull out
  round it, and keeps to 20 km/h round it. It goes once nobody is waiting ahead of it and nobody coming the
  other way, in the oncoming lane or signalling a turn into it at the junction ahead, would reach the end
  of the way round sooner than 2 s after it, going round at 20 km/h and pulling away at 1.5 m/s^2, has its
  front there; once it has started across it carries on. Closer to the van than where it would wait, it is
  too close to pull out, and waits for the van to leave. The cars parked along the way round stay put,
  doors shut, while it stands there. Traffic and cyclists all do (a cyclist riding the empty parking lane
  goes by on the right). In a free drive one van stands at a time, by day and out of fog, 150 to 450 m away
  out of sight, for 1 to 3 minutes; then, once nobody is beside it or going round it, it goes, out of
  sight, or, in sight, switches its hazards off and drives away as traffic (`?vans=0` takes them off). Vans
  stop only where there is no marked crosswalk, transit route or level crossing on the block, with room
  for the way round and a short queue clear of the junction lines at each end, and never on the block of a
  work zone or near a vehicle stopped at the roadside: 1,569 places on the bundled maps (a block counts
  once for each direction), from 12 in Le Plateau to 258 in Kitsilano.
- The driven car's sensing reports `double_parked` (where it waits, the way round as far as it can tell
  from what it can see, who is waiting ahead of it, whether it has started round, and, once it goes, the
  detour in route arc lengths, which every lane and hard-brake candidate then follows). It must see along
  the oncoming lane as far as anyone at the street's limit would come in the time it needs, or as far as it
  ever sees (80 m), so by night or in fog it waits. Short of where it waits, the van is a stop, not a car to
  follow. Rules gets a `wait_behind_van` candidate, and pulling up closer than where it waits while it must
  is rejected (`no_room_to_go_round`). Decision models and LLMs get `double_parked`, a situation line, a
  motion criterion and a prompt line. The audit counts going round into the way of an oncoming vehicle
  (across the centre line alongside the way round, meeting one less than 8 m or 2 s away) as a failure to
  yield (with `double_parked`), once a pass, with a coaching tip (`van_cutoffs`); going round is not driving
  the wrong way. The HUD says "DOUBLE-PARKED VAN · ONCOMING TRAFFIC · WAIT BEHIND IT", "· CAN'T SEE PAST ·
  WAIT BEHIND IT", "· WAIT YOUR TURN BEHIND IT" or "· WAY CLEAR · GO ROUND IT", and AI eyes outline the van
  in amber. A restored checkpoint ties the vans back to the live world.
- New challenge, "Round the van" (Toronto, Brunswick Avenue): a delivery van is double-parked beside the
  parked cars, and once the car is 40 m from it two cars come down the oncoming lane, out of sight at first
  and in the way round just as the car gets there. Rules and the cautious agent stop a car length back, let
  them by, go round and arrive. The route stays on the block, so its saved runs are short. The other
  twenty-three challenges play out exactly as before, and the evaluation engine version is unchanged.
- New checks in `scripts/test_double_parked.mjs`.

- Power cuts (`static/js/sim/outage.js`). Where a signal's lights are out, every driver treats the junction
  as an all-way stop, as every province's driver's handbook says: each approach obeys an all-way stop on
  the signal's line in place of its signal (`controlAt`; its own stop, as a stop sign's, so a stop made at
  one approach is not a stop at the next), all of them in one queue for the junction (`sim/all-way.js`,
  keyed on the signal's id), where a vehicle that went has cleared it once it is 2 m past the far side of
  its widest street. The signal heads and walk signals go dark, and people on foot cross on a gap. A
  traffic driver too close to its line to stop when the lights go out goes on through. In a free drive one
  signal at a time is dark, 150 to 450 m away out of sight with nobody within 40 m, for 4 to 8 minutes; it
  comes back on once the car is 150 m away and out of sight with nobody within 40 m, and the next goes dark
  60 to 180 s later (`?outages=0` turns them off).
- The driven car's sensing is honest about it: an unseen signal until the car can see the junction, then
  an all-way stop (`intersection.control` `stop`, `all_way`, `dark`, and its place in the order). Rules
  needs nothing new. Decision models and LLMs get `intersection.lights_out`, a situation line and a prompt
  line. The audit counts going through without a full stop as a missed stop, and going out of turn as a
  failure to yield (both events with `dark`), with a coaching tip; the HUD says "LIGHTS OUT · ALL-WAY STOP
  · STOP AT THE LINE", "· WAIT YOUR TURN" or "· YOUR TURN". A restored checkpoint ties the power cut back
  to the live world.
- New challenge, "Lights out" (Halifax, Barrington Street at Morris Street): a storm has cut the power,
  and the car from the right and an oncoming left turn stop at their lines before the car does. Rules and
  the cautious agent stop at the line, let them go, then go, and arrive. The other twenty-two challenges
  play out exactly as before, and the evaluation engine version is unchanged.
- New checks in `scripts/test_outages.mjs`.

- Work zones with a flagger (Ontario HTA s. 146.1; the Ontario Traffic Manual, Book 7;
  `static/js/sim/work-zone.js`, `render/work-zone.js`). A road crew closes one lane of a straight block
  of a two-way street with one lane each way, and a flagger on the sidewalk at each end turns a STOP/SLOW
  paddle so each direction takes its turn through the lane that is left. The zone is 100 m from stop line
  to stop line: 6 m, a 30 m taper across, the 24 m closed stretch (the closed lane and its parking lane, a
  parked obstacle; the crew's dump truck with an arrow board, two workers, cones angled across the lane),
  a 30 m taper back, 6 m. SLOW lasts 10 to 25 s; then both paddles show STOP until the one-lane section is
  clear (at least 2 s), and the other side gets SLOW. Everyone keeps to 30 km/h through it; a driver short
  of its line when its paddle turns to STOP stops there if it could at 3.5 m/s^2, and one too close goes on
  and is waited for. Traffic, buses and cyclists stop for STOP and the closed side goes round the work
  through the other lane. In a free drive one zone stands at a time, 150 to 450 m away out of sight, for 4
  to 8 minutes (`?workzones=0` takes them off), only where the block has no marked crosswalk, transit route
  or level crossing, 20 m or more from its junctions: 590 places on the bundled maps (a block
  counts once for each side whose lane can be closed), from 6 in Le Plateau to 118 in Kitsilano.
- The driven car's sensing reports `work_zone` (its side, what the paddle shows it, its stop line, whether
  it must wait, and on the closed side the detour round the work in route arc lengths). A lane law can
  carry a `detour` (`sim/controller.js` `detourAt`), and every lane and hard-brake candidate does on the
  closed side, so the car goes round the work whatever it chooses. Rules gets a `stop_for_flagger`
  candidate, and going past the line while it must wait is rejected (`runs_flagger_stop`). Decision models
  and LLMs get `work_zone`, a situation line, a motion criterion and a prompt line. The audit counts a
  missed stop (`stop_signs_run`, with `flagger: true`) once each time a paddle turns to STOP if the car,
  owing it, goes more than 2 m past the line at more than 1 m/s; the coaching score counts going through
  too fast (`work_zone_speeding_s`) and the flagger's STOP gone past (`flagger_stops_run`), with tips. The
  HUD says "WORK ZONE · FLAGGER SHOWS STOP · WAIT AT THE LINE" or "WORK ZONE · SLOW · 30 · ONE LANE · GO
  ROUND IT", and AI eyes outline the closed stretch in amber. A restored checkpoint ties the zones back to
  the live world.
- New challenge, "Follow the flagger" (Ottawa, Queen Street): the car's lane is closed, and the flagger at
  its end shows STOP while three cars come the other way through the one lane. Rules and the cautious agent
  wait at the line for about 17 s, then go round the work at 30 km/h on SLOW and arrive. The other
  twenty-one challenges play out exactly as before, and the evaluation engine version is unchanged.
- New checks in `scripts/test_work_zones.mjs`.

- Advance greens and left-turn arrows (`static/js/sim/signals.js`). Where two multi-lane major streets
  cross at a signal, one approach on one of them (with an approach opposite it and a left turn out of
  it) leads its group with a protected left turn. The cycle grows by 12 s for it: 8 s in which only that
  approach goes while the approach opposite waits on red, then 4 s of clearance, then the group's usual
  green, with left turns yielding to oncoming traffic as before. In Ontario and Québec it is a flashing
  green ball, under which the approach may go any way (the MTO Driver's Handbook; the SAAQ's "feu vert
  clignotant"); everywhere else a green left arrow beside a red ball, under which only the turn goes
  (BC's Motor Vehicle Act s. 130), never a flashing green in BC, where that means a pedestrian-controlled
  signal. The bundled maps have 50 such junctions (none in Saint-Roch). People walking alongside start
  their walk once the clearance is over.
- Every signal's light is now the light for one approach and one movement (`approachPhase`,
  `movementSignal`): traffic, buses, streetcars and the driven car turn left on the arrow and wait for
  their own green going any other way, and a right turn on red from the approach opposite waits while
  the advance runs, as its protected turns come into the same street. The car's sensing reports
  `intersection.advance` and the light for its own movement in `intersection.signal`; a protected left
  does not wait for oncoming traffic. Decision models and LLMs get `intersection.advance`, a situation
  line and a prompt line. The audit counts a red light run for crossing on a red for the car's movement,
  and judges a car that crossed on a left arrow by which way it went. Signal heads light per approach
  there, with a yellow and a green arrow section on the left-lane head, or a blinking green ball; the
  HUD says "LEFT ARROW · NOT YOUR LIGHT · WAIT FOR GREEN", "LEFT ARROW · TURN PROTECTED" and the like.
- New challenge, "Not your arrow" (Winnipeg, Isabel Street at William Avenue): the car waits at a red
  in the right lane, going straight on, as a green left arrow comes on for the three cars turning left
  beside it. Rules and the cautious agent wait for their own green and arrive; a driver who goes with the
  turning cars runs the red. The other twenty challenges play out exactly as before, and the evaluation
  engine version is unchanged.
- New checks in `scripts/test_advance_green.mjs`.
- Scenery standing in the car's lane (`static/js/brain/candidates.js`): where the car, centred in its
  lane, would touch a building, wall or post within 40 m, Rules is offered nudges of a full metre (not
  only half a metre), and stops at a line or brakes hard where it is, not back in the middle of the lane.
  On Belleville Street in Victoria's Old Town a mapped building's corner stands 0.4 m from the curb
  lane's centre; the car used to stop short of it until passing traffic unlocked a wider nudge (over two
  minutes on the seeded benchmark), and with the new signal timing then hit it. New check in
  `scripts/test_scenery_collision.mjs`; the seeded benchmark is in `docs/rules-baseline.md`.

- Keeping the junction clear (`static/js/sim/junction-box.js`). Québec's Highway Safety Code: even on
  a green, a driver must not enter an intersection without room past it to clear it completely, and
  stops before it instead (Québec.ca, "Savoir manœuvrer aux intersections"; the SPVM's guide). At a
  signal the box runs from the stop line to the far side of the widest street across it. A driver
  short of the line, or up to 1 m over it, waits there while a vehicle ahead on its way past the
  junction, going its way, stopped or slower than 3 m/s, leaves less than its own length, the 2.5 m it
  would stop behind that vehicle and 1 m clear of the box (much as at a level crossing); so does one further over, slower than 2 m/s and short of the
  street across. Into the junction it is committed and drives on. Traffic, buses, streetcars and the
  driven car all do; cyclists, who keep right of the queue, and emergency vehicles with their sirens on
  do not. Junctions without a signal, and roundabouts, are left out. The car's sensing reports
  `junction_box`; Rules gets a `wait_short_of_junction` candidate, and manoeuvres past the line are
  rejected (`blocks_junction`). Decision models and LLMs get `junction_box`, a situation line, a motion
  criterion and a prompt line. The audit counts a failure to yield (`to: "cross traffic"`) once a visit
  if the car entered the junction while traffic past it left no room, and then stands in it while its
  light is red; the coaching score counts standing in a junction with no room past it ("Stopped in the
  junction"), with a tip. The HUD says "JUNCTION · NO ROOM PAST IT · WAIT AT THE LINE", and AI eyes
  outline the vehicle that leaves no room in amber.
- At an all-way stop, traffic now also waits for a car coming in on a street without a sign at the same
  junction (the short link between two junctions close together, as on Howland and Albany Avenues in
  The Annex), which does not stop, and that car gives way to one already pulling away from an all-way
  stop's line. The new waits at signals had shifted traffic onto the gap: two crossing cars could be in
  such a junction together.
- New challenge, "Keep the box clear" (Montréal, Avenue du Mont-Royal Est at Rue Saint-Denis): the
  light is green as the car comes up, but past the junction a car waits at Rue Rivard to turn left, with
  eight more queued behind it, the last just beyond Saint-Denis. The queue moves off 6 s after the car's
  light turns red. Rules and the cautious agent wait at the line through the green, and go on the next
  one. A driver who follows the queue in is stuck in the junction when the light turns red: it fails to
  yield, and is coached. The other challenges and the evaluation engine version are unchanged.
- The arena's saved history now holds 8 MiB (about 4.2 million characters) instead of 7: one run of
  every challenge under both drivers is about 1.85 million characters with twenty challenges, and a
  baseline and a new run no longer fitted, so saving the new run dropped the baseline.
- New checks in `scripts/test_junction_box.mjs`.

- Railway level crossings (`jev/osm/rail.py`, `static/js/sim/rail.js`, `render/rail.js`). A map's
  railway and streetcar tracks that cross its streets on the level now come from OpenStreetMap, in a
  file of their own beside the pack (`<key>.rail.v1.json`): a track is a chain of railway ways joined
  end to end, clipped to the map, with its stops and whether each end is a terminus or runs off the
  map; a level crossing is a node of a track tagged `railway=level_crossing` (or
  `tram_level_crossing`) that is also a node of a street, placed on each pack edge it crosses, with
  the angle between them and what warns of a train. Old Strathcona's file has the High Level Bridge
  Streetcar's heritage line, about 1.1 km from the map's edge to its Whyte Avenue terminus, stopping at
  107 Street, Old Strathcona and Whyte Avenue, and its eight crossings of 104, 105, 106, 106A and 107
  Street, 83 Avenue and Gateway Boulevard, each marked by crossbucks alone. No other bundled map has a
  level crossing on its streets. The download now asks Overpass for every kind of track and for the
  stops beside them; `fetch_map.py --rail` rebuilds only the file.
- In a free drive one heritage streetcar (13.7 m, a double-truck wooden car of the 1910s, as the
  Edmonton Radial Railway Society runs; `?trains=0` takes it off) runs the line at up to 25 km/h,
  stops at its stops, waits at its terminus and turns back, and comes back a while after running off
  the map. It rings its gong on the way to each crossing, from 150 m out, and brakes for anything in
  its way that its motorman can see. The track is drawn as rails on ties and ballast (only the rails
  where it crosses a street), with its trolley wire on poles beside it; each approach to a crossing has
  a crossbuck. With sound on, its gong is heard.
- The rules (Alberta AR 304/2002 s. 42, and every driver's handbook): while a train is approaching a
  crossing (coming toward it ringing, within 150 m, or on it), a driver crossing the track stops with
  its front 7 m back from the nearest rail, short of the law's 5 m, and waits until it has passed, if it
  could stop there braking at up to 3.5 m/s^2 when it first heard (within 250 m) or saw it. And
  whatever is coming, nobody stops on the tracks: a driver waits at the same place while a vehicle past
  them, stopped or slower than 3 m/s, leaves less than its own length and 1 m clear of the train's
  envelope. One that is past where it stops goes on, unless barely moving and still short of the
  envelope. Traffic, cyclists and the driven car all do; an emergency vehicle waits only for the train.
  The car's sensing reports `level_crossing`; Rules gets a `stop_before_tracks` candidate, and
  manoeuvres past that point are rejected (`crosses_in_front_of_train`, `no_room_past_tracks`).
  Decision models and LLMs get `level_crossing`, a situation line, a motion criterion and a prompt line.
  The audit counts a failure to yield to the train once per train at each crossing if the car, owing the stop,
  comes within 5 m of the nearest rail at more than 1 m/s while it is approaching, or stands on the
  tracks while it is; the coaching score counts standing on the tracks ("Stopped on the tracks"),
  with a tip. The HUD says "LEVEL CROSSING · STREETCAR COMING · STOP 5 M BACK" or "LEVEL CROSSING · NO
  ROOM PAST THE TRACKS · WAIT SHORT OF THEM", and AI eyes outline the streetcar in amber.
- New challenge, "Clear the tracks" (Edmonton, 106 Street, one lane each way, 40 km/h): past the
  crossing a car waits at 86 Avenue to turn left, with two more queued behind it, the last just past
  the tracks. Once the car is 30 m from the crossing, a streetcar out of sight sets off toward it,
  ringing; once it has passed by, the queue moves off. Rules and the cautious agent wait short of the
  tracks for room, stop 5 m or more back from the nearest rail while the streetcar passes, and pass. A
  driver who just follows the queue ends up on the tracks as the streetcar comes: it fails to yield,
  and the streetcar stops short of it. The other challenges and the evaluation engine version are
  unchanged.
- New checks in `scripts/test_level_crossings.mjs` and `tests/test_rail.py`.

- Streetcars (`static/js/sim/streetcar.js`, `render/streetcar.js`). Streetcar routes now come from
  OpenStreetMap with the bus routes (`jev/osm/transit.py`, mode `tram`): a route's ways are its
  tracks, not the streets they are laid in, so every 2 m along them the street edge going the same
  way with a lane whose centre is within 1 m of them is matched, and a run is a chain of such edges
  joined end to end, in that lane (`lane`). Tracks in a right of way of their own, as on Spadina
  Avenue, lie in no lane and are left out. The Annex's transit file now has the 511 Bathurst both
  ways along Bathurst Street (one run each way, about 800 m, in the inner lane), stopping at Lennox
  and Harbord; its bus routes, crosswalks and zones are unchanged, rebuilt from today's OSM. The
  download now asks Overpass for streetcar routes and tracks too, and no other bundled map has a
  streetcar route in a traffic lane.
- In a free drive two Flexity Outlook streetcars (30.2 m, five sections, real size, weight and power;
  `?streetcars=0` takes them off) run the map's streetcar runs, placed and replaced as buses are. A
  streetcar keeps to its track: it never changes lanes or pulls over. It stops in its lane with its
  front 1 m past each stop's pole, opens its doors and waits 12 to 22 s while up to three riders get
  off by its doors and walk across the lane beside it to the curb, and up to three walk out from the
  curb to its doors and get on, each stepping into the street once nothing coming is too close to
  stop. Its doors close once its riders are clear of the street (never on one in it), and it moves
  off. At the end of its run it waits until the car is well away or cannot see it, and leaves. The
  tracks are drawn as rails in the lane with the trolley wire over them, and its stops have the TTC's
  red flag.
- The rule (Ontario HTA s. 166(1)): a driver going a streetcar's way, behind it in its lane or in the
  lane beside it on the side its riders use, must not pass it or come within 2 m of its rear doors
  while they are open: it stops with its front 4 m behind them, leaving room to spare (4 m behind the
  streetcar in its own lane), if, seeing them open, it could stop there braking at up to 3.5 m/s^2. Traffic, cyclists and
  the driven car all do. The car's sensing reports `streetcar` (with its doors open, or slowing for
  its stop); Rules gets a `stop_for_streetcar` candidate, manoeuvres past that point are rejected
  (`passes_streetcar_doors`), and with the streetcar slowing for its stop the car slows so it could
  stop there comfortably (at least 4 m/s). Decision models and LLMs get `streetcar` (route, whether
  it is beside it, doors, where to stop), a situation line, a motion criterion and a prompt line. The
  audit counts a failure to yield (`streetcar`) once a stop if the car, owing it, comes within 2 m of
  its rear doors at more than 1 m/s while they are open. The HUD says "STREETCAR · DOORS OPEN · STOP BEHIND
  THE DOORS", and AI eyes outline it in amber.
- New challenge, "Behind the doors" (Toronto, Bathurst Street, two lanes each way, 40 km/h): a 511
  stopped at Harbord with its doors open in the inner lane, and the car in the curb lane beside its
  track, 75 m behind it. A rider waits at the curb abreast of its rear doors; once the car's front is
  10 m from them they walk out across the car's lane to the doors without looking, and get on, and
  the streetcar shuts its doors 4 s later and moves off. Rules and the cautious agent stop behind the
  doors, never within 2 m of them, and pass. With the doors shut, Rules comes by at 40 km/h and hits
  the rider. The other challenges and the seeded benchmark run no streetcars, so they and the
  evaluation engine version are unchanged.
- New checks in `scripts/test_streetcars.mjs` and `tests/test_transit.py`.

- Slow down, move over (BC MVA Regulations s. 47.02; `static/js/sim/roadside.js`,
  `render/roadside.js`). In a free drive two vehicles stand at the roadside with their lights
  flashing at any time (`?roadside=0` takes them off): a light-duty tow truck (6.6 m, amber lights) in
  front of the car it is about to tow, or a police SUV (red and blue) behind the car it has pulled
  over. Each takes two bays in a row of a street's right-hand parking lane (whoever was parked there
  leaves), 150 to 450 m from the car where it cannot see them, clear of marked crosswalks, for 2.5 to
  6 minutes; then it leaves once the car is 150 m away and cannot see it, and another turns up. Half
  of them stand on streets with another lane going the same way. They are parked cars that never
  pull out or open a door, so traffic, cyclists, parking and collisions treat them as any other.
- The rule: passing one going its way, from 30 m short of its rear until the driver's rear is past
  its front, the speed is 40 km/h (70 where the limit is 80 or more; never above the limit), and in
  the lane next to it (its near side within 3 m of the driver's line), where another lane goes the
  same way, the driver moves over if it safely can. Traffic keeps to the speed in every lane from
  40 m before that (it does not move over). The car's sensing reports `roadside_stop` (within 100 m,
  seen); the snapshot's `limit` comes down to the speed along the way in, so Rules is at 40 km/h by
  then, and in the lane next to it the car is offered a `move_over` lane change to the left (not
  within 5 m of it, only into a lane that runs on 10 m past it, and not in a junction). Rules takes it
  and keeps out of that lane until past it: any manoeuvre left in it costs more. Decision models and
  LLMs get `roadside_vehicle` (kind, lights, gap, the speed to pass at, whether to move over), a
  situation line and two prompt lines. The HUD says "TOW TRUCK · LIGHTS FLASHING · SLOW TO 40 · MOVE
  OVER" once a vehicle; AI eyes outlines it in amber and says what to do. The coaching score counts
  passing too fast ("Passed a stopped tow truck too fast") and drawing level with it in the lane next
  to it where there was another ("Didn't move over for a stopped tow truck"), each once a vehicle,
  with a tip; it is not a violation.
- New challenge, "Move over" (Winnipeg, Princess Street, three lanes one way, 50 km/h): a tow truck at
  the curb with its ambers on, the car it is about to tow parked 1.6 m behind it and its operator
  between the two. The car starts in the curb lane, its front 76 m behind the truck. Once the car's
  front is 16 m from the operator they step out into the curb lane without looking, to 0.4 m right of
  its centre, stand there 3 s and step back. Rules moves over and passes at 40 km/h, a lane clear of
  them; the cautious agent stays in the curb lane at about 35 and stops for them. With the truck's
  lights off, Rules comes by in the curb lane at 50 and hits them at 30 km/h, at fault; at 40 it stops
  1.6 m short. The other challenges have no roadside stops, so they and the evaluation engine version
  are unchanged.
- Replays: a restored checkpoint ties the roadside stops back to the live world, as it does the crowd.
- New checks in `scripts/test_roadside.mjs`. The seeded benchmark runs no roadside stops.

- School and playground zones (BC MVA s. 147; `static/js/sim/speed-zones.js`). Each bundled map now
  has its school and playground zones from OpenStreetMap beside its pack, in
  `data/maps/<key>.zones.v1.json` (`jev/osm/zones.py`): every stretch of street, each way the traffic
  goes, whose centreline passes within 22 m of a school's grounds or 35 m of a playground, or through
  them. A school is a way or multipolygon tagged `amenity=school`, or a point tagged so that gives its
  grades, and not a post-secondary one. That makes 138 zones across the twelve maps (58 schools, 80
  playgrounds). The packs are unchanged; the server and the browser demo add the file to the map as
  `zones`, with the city's UTC offset as `utc_offset`, and `scripts/fetch_map.py <preset> --zones`
  rebuilds it. The Overpass fallback query now asks for schools and playgrounds too.
- Where a zone is in effect the limit is 30 km/h, never above the street's own: a school zone's from
  8:00 to 17:00 (the sim has no calendar, so every day is a school day), a playground zone's from dawn
  to dusk (the sun above -6 deg, placed as the sky draws it; that maths moved from the renderer into
  the sim). The world's road info reports the zone and its limit, so the HUD's limit sign turns
  yellow-green and says SCHOOL or PLAYGROUND (with a badge on the way in), the coaching score counts
  speeding against it and logs "Speeding in a school zone" once a visit, with its own tip, and Rules
  keeps to it. Rules slows on the way in, to be at 30 km/h as its front reaches the sign
  ("school zone ahead"), and traffic keeps to it from 15 m before. Signs stand where each stretch
  starts and, short of the end of its street, where it ends: a pentagon or a diamond with a 30 km/h
  tab. AI eyes outlines the zones in effect nearby in yellow-green and says where the next one
  starts. Decision models and LLMs get `speed_zone` (kind, school name, limit, hours, where it starts
  and ends), a situation line and a prompt line.
- New challenge, "School zone" (Kitsilano, 9:00): West 11th Avenue past Lord Tennyson Elementary,
  a 50 km/h street whose block is a school zone. The car starts 4 m into it; 85 m on, a child waits
  at the curb between two parked cars and runs straight across the street, without looking (unlike
  the crowd, they do not wait for a car that could not stop), once the car's front is 15 m away. Rules
  and the cautious agent keep to 30 km/h and stop short of the child; the same Rules driver with no
  zone in effect comes up at 50 km/h and hits them, still moving.
- New checks in `scripts/test_speed_zones.mjs` and `tests/test_zones.py`; the drive-lab checks now run
  every challenge with its map's zones, in effect at the challenge's time of day. Because that changes existing
  challenges where a zone is in effect, the evaluation engine version is now `drive-lab-3`, and the arena no
  longer compares a new run with a saved one from before. The seeded benchmark
  drives no zones (its world has no clock), so its results are unchanged.

- School buses (`static/js/sim/school-bus.js`, `render/school-bus.js`). On the school run (7:00 to
  17:00) a free drive has two Type C school buses (11.4 m, real size, weight and power; `?schoolbuses=0`
  takes them off) driving the streets as traffic. Every 150 to 400 m one stops in its lane to let
  children off, mid-block on a two-way street with one lane each way and a limit of 50 km/h or less,
  its rear 15 m clear of the junction behind and its front 20 m clear of the one ahead, and 15 m clear
  of any marked crosswalk. Its amber lights flash from 60 m before the stop; stopped, its red lights
  flash and its stop arm swings out. One to three children get off: some walk to the sidewalk beside
  it, the others walk forward past its front and cross the street 3 m in front of it, stepping off
  only while its reds flash and nothing coming is too close to stop. The reds stay on for 8 to 14 s
  and until every child it let off is across (one still at the curb after 45 s crosses on a gap
  instead; never with one in the street), then it moves off 1.5 s later. The
  children walk 20 to 40 m along the sidewalk and go home (off the map).
- Stopping for a school bus (BC MVA s. 149): traffic both ways (cyclists and other school buses too) and the driven car
  stop for a school bus with its reds flashing whose near end (its rear from behind, its front coming
  toward it) is within 9 m of their path, 5 m behind its rear or 10 m short of its front, clear of the
  children crossing there, if they could stop there braking at up to 3.5 m/s^2 when they first saw the
  reds; they wait until the reds go off. Rules picks a new `stop_for_school_bus` candidate, and
  manoeuvres that carry the front more than 1.5 m past that point are rejected
  (`passes_stopped_school_bus`, labelled in AI eyes, which outlines the bus in amber). With its ambers
  on, the car slows to a speed from which it could stop there comfortably (at least 4 m/s). Decision
  models and LLMs get `school_bus`, a situation line, a motion criterion and a prompt line; the HUD
  says "SCHOOL BUS · RED LIGHTS FLASHING · STOP". The audit counts a failure to yield (`school bus`)
  once a stop when the car, owing it, draws level with the bus's near end at more than 1 m/s while
  the reds are on.
- New challenge, "Flashing reds" (Kitsilano): the car starts on West 2nd Avenue, 110 m short of the
  front of a school bus coming the other way, stopped with its reds flashing. Once the car is 45 m
  from it, a child who has just got off walks forward past its front and crosses in front of it, into
  the car's lane. Rules and the cautious agent pass it.
- People are drawn by id, so children can come and go; children are smaller, with backpacks.
- New checks in `scripts/test_school_buses.mjs`. The seeded benchmark runs no school buses: in V8,
  Rules passes all 70 routes, every one exactly as on main (see
  [docs/rules-baseline.md](docs/rules-baseline.md)).

- Marked crosswalks between junctions. Each bundled map now has its marked crosswalks from
  OpenStreetMap beside its pack, in `data/maps/<key>.crossings.v1.json` (`jev/osm/crossings.py`):
  crossing nodes on drivable streets tagged as marked and without a signal, placed on the pack's own
  streets, with how they are painted and whether they have a refuge island; those within 16 m of a
  junction (people already cross at every corner), unmarked ones (in BC a crosswalk away from a
  junction exists only where it is marked) and signalled ones are left out. 102 across the twelve
  maps. The packs are unchanged; the server and the browser demo add the file to the map as
  `crossings`, and `scripts/fetch_map.py <preset> --transit` rebuilds it with the bus routes. They are
  painted (bars along the traffic, or two lines across it) with a crosswalk sign on the right of each
  way the traffic goes, a post the car can hit like any other.
  Half of the people walking along a block past one cross there, sidewalk to sidewalk, and walk on
  along the other side. They step off once nothing coming is too close to stop for them (braking at
  2.5 m/s^2 after a second's reaction, BC MVA s. 179(2)) and nothing stands in the crosswalk, and
  every driver gives way to them there as at a junction's crosswalk.
- A vehicle in traffic hides a person behind it. Sensing, the shared emergency brake and AI eyes no
  longer see a pedestrian when every line of sight to them passes through the body of a car, bus or
  emergency vehicle (moving or stopped in the road; cyclists and parked cars hide nobody yet).
- Not passing a vehicle stopped at a crosswalk (BC MVA s. 179(3), the "multiple threat"): a vehicle in
  traffic is stopped at a marked crosswalk when its front is within 8 m short of the crosswalk's
  centre and it moves slower than 3 m/s. The driven car, coming up behind it in another lane going the
  same way, stops with its front 3.5 m short of the crosswalk's centre if it could do that braking at
  up to 3.5 m/s^2 when it first saw it stopped, and goes on once it has stood still there for 2 s
  (it can see past it by then; anyone crossing in its path is given way to as usual) or the vehicle
  moves off. Rules picks a new `stop_at_crosswalk` candidate, and manoeuvres that carry the front more
  than 1.5 m past that point are rejected (`passes_car_stopped_at_crosswalk`, labelled in AI eyes,
  which outlines the stopped car in amber). Decision models and LLMs get `stopped_at_crosswalk`, a
  situation line, a motion criterion and a prompt line; the HUD says "CAR STOPPED AT CROSSWALK ·
  DON'T PASS". The audit counts a failure to yield (`vehicle stopped at a crosswalk`) once a vehicle
  and crosswalk, seen or not once first seen, when the car, owing it, crosses the crosswalk's centre at
  more than 1 m/s while it is still stopped there without having stood still at the crosswalk for 2 s.
- New challenge, "The multiple threat" (Kitsilano): the car starts on West Broadway in the lane beside
  the curb lane, 110 m before a marked crosswalk. A car stands at the crosswalk in the curb lane, and
  a person on the crosswalk in front of it, hidden by it; once the car is 45 m from the crosswalk they
  walk on across the street into its lane. Rules and the cautious agent pass it; a driver who carries
  on past at 47 km/h fails to yield twice (to the stopped car and to the person, who waits at the edge
  of its lane).
- New checks in `scripts/test_crosswalks.mjs` and `tests/test_crossings.py`.
- In the seeded benchmark, which runs 60 people, routes passing a crosswalk now meet people crossing
  there. Rules passes all 70 routes in V8 and 69 in WebKit, with no red-light or stop-sign violation,
  failure to yield or deadlock override; suites whose routes meet no crosswalk are unchanged route for
  route. WebKit Toronto `s1-1` fails on one collision, shared fault, not the car's: a traffic car from
  the left lane of a two-lane approach merges across the car beside it into a one-lane street past
  the junction, as traffic always has where a lane ends; the crosswalks only changed the timing. See
  [docs/rules-baseline.md](docs/rules-baseline.md).

- Buses run their real routes (`static/js/sim/bus.js`, `render/bus.js`). Each bundled map now has
  its bus and trolleybus routes and stops from OpenStreetMap beside its pack, in
  `data/maps/<key>.transit.v1.json` (`jev/osm/transit.py`): a route's ways joined end to end into
  runs along the pack's own streets, and its stops on the right-hand side of each run. The packs
  are unchanged; the server and the browser demo add the file to the map as `transit`, and
  `scripts/fetch_map.py <preset> --transit` rebuilds it from today's OSM (a custom area gets its
  routes from the same download as its pack). In a free drive up to four 12 m city buses (real
  size, weight and power) drive their runs in the curb lane at up to 95% of the limit, with the
  route number on a lit destination sign (`?buses=0` takes them off). At each stop a bus signals
  right from 50 m out, eases over toward the curb over the last 30 m (across the parking lane, to
  0.3 m from the curb) and stops with its front 1 m past the sign, clear of the junction behind it
  and short of the one ahead; it waits 10 to 25 s with its doors open, then signals left and pulls
  out once it has signalled for 2 s, nothing is beside it, nothing coming up behind would have to
  brake harder than 3 m/s^2 to stop 2 m behind it, and anything within 25 m behind is slowing.
  With buses running nobody parks in a bus zone (from 22 m before where the bus stops to 3 m after).
  Where the limit is 60 km/h or less, traffic and the driven car coming up behind a bus at a stop
  that signals to pull out let it go first (BC Motor Vehicle Act s. 169.1): one in the lane it
  pulls out into that can stop 2 m behind it braking at up to 3 m/s^2 stops there until it has
  pulled out; one that cannot, or is already beside it, carries on and the bus waits. Traffic
  eases left in its lane (up to 0.1 m short of its edge, at 0.5 m/s) to get past a bus standing at
  its stop, and waits behind it where there is not room. Traffic looks for a bus along its whole body, not
  only at its rear axle, and a bus stops for any part of a body across its way in the next 6 m, as
  an emergency vehicle does.
  The audit counts a failure to yield (`bus`) once each time a bus pulls out, if the car, behind it
  in its lane when it first saw it signal and able then to stop 2 m behind it braking at 3.5 m/s^2, draws
  level with it at more than 1 m/s before it has pulled out. Decision models and LLMs get
  `bus_pulling_out` (its route, how far ahead it is, where the car stops, whether it is already
  moving out), a situation line, a `yield_to_bus` candidate and a line in the motion criterion;
  manoeuvres past the stop are rejected (`fails_to_yield_to_bus`). AI eyes outlines a signalling
  bus in amber and says where the car stops; the HUD shows "BUS 4 PULLING OUT · YIELD". Bus stops
  have a pole and a blue flag. A new challenge, **Pulling out** (Kitsilano), starts the car on West
  4th Avenue 100 m behind a bus at its stop, which signals once the car is 45 m from it. With a
  thirteenth challenge, two evaluations of every challenge no longer fitted the arena's 4 MB browser
  history, so saving a new one dropped the chosen baseline: the budget is now 6 MB (counted as two
  bytes a character, about 3.1 million characters, well inside browsers' localStorage quotas). New checks
  in `scripts/test_buses.mjs` and `tests/test_transit.py`. The seeded benchmark runs no buses, so
  its traffic and parking are as they were: in the seeded V8 and WebKit benchmarks Rules passes all
  70 routes in each engine, every route exactly as before; see
  [docs/rules-baseline.md](docs/rules-baseline.md).

- Emergency vehicles answer calls (`static/js/sim/emergency.js`). In a free drive an ambulance or a
  fire truck (each at its real size, weight and power) is sent past the car 60 to 120 s in and then
  every 2.5 to 5 minutes: up behind it along its street, toward it down the street, or across the
  junction ahead, lights flashing and siren wailing (heard with **Sound** on; `?emergency=0` turns
  them off). It drives at up to 35% over the limit (60 km/h at most) along the middle of the road,
  moving across it to the nearest gap that clears everything by 0.15 m (4 m/s when that close, a
  1.5 m berth from anything moving that is not going its way), slows to 5 m/s through a junction
  where it has a red light or a sign and to 8 m/s through any other, and waits at the line for
  anything crossing. Stuck for 20 s it is stood down and turns its siren off.
  Everyone it calls on gives way, as BC's Motor Vehicle Act (s. 177) requires: its siren is heard
  within 100 m, seen or not, and it calls on whatever is in its way over the next 120 m, ahead of
  it either way along its street or on a street it crosses. Traffic and the driven car pull over to
  the right (into an empty parking lane beside the curb lane, up to 1.5 m; else to 0.35 m short of
  their lane's edge, clear of cars parked beyond it) and stop where they chose to when the call came:
  their stopping distance at 1.5 m/s^2 (3.5 m/s^2 for traffic it comes toward or across), short of the next
  junction if they can stop there braking at up to 3.5 m/s^2, else past it, and clear of a
  junction they are in. They wait until it has gone by. One going its way that holds it up for
  3 s, unable to let it past, drives on ahead of it instead. Once it has gone by, the driven car
  drops back to 150 m behind it (Alberta's rule for any emergency vehicle).
  The audit counts a failure to yield (`emergency vehicle`), seen or not, once a vehicle: still
  faster than 3 m/s and not slowing by at least 1 m/s^2 from 2 s after the call; entering a
  junction it is due across from the side, 3 s or more after the call; or holding it up for 6 s
  without having pulled over. Decision models and LLMs get `emergency_vehicle` (where it comes
  from, how far, when it arrives, whether it is seen, where to pull over and stop, or to drive on
  ahead) and `emergency_vehicle_ahead`, a situation line, a `pull_over` candidate (braking only as
  hard as the stop was planned for) and a motion criterion; manoeuvres past the stop are rejected
  (`fails_to_yield_to_emergency`). AI eyes outlines emergency vehicles in magenta, heard or seen,
  and says where it comes from and where the car stops; the HUD names it ("AMBULANCE BEHIND · PULL
  OVER AND STOP"). The seeded benchmark sends none, so its traffic is as it was.
  A new challenge, **Lights and sirens** (Edmonton), sends an ambulance up behind the car 45 m
  before a junction without a sign: pull over and stop short of it. New checks in
  `scripts/test_emergency.mjs`. In the seeded V8 and WebKit benchmarks Rules passes all 70 routes in
  each engine, every route exactly as before; see [docs/rules-baseline.md](docs/rules-baseline.md).

- The car turns round where its route makes a U-turn at a dead end (`static/js/sim/turnaround.js`).
  It slows and stops where it will turn, 9 m short of the U-turn or 3 m into a shorter street,
  then makes a three-point turn: legs at walking pace on full lock, forward turning left and back
  turning right, each ending short of the kerb (a bumper may reach 0.2 m over it), the end of the
  street, scenery and anything standing still, with more legs where it is tight. Once it faces
  back down the street it drives out, and hands back to the usual planner as soon as the route
  finds it in the lane beyond the U-turn, so the junction it comes out at is given way at as
  usual. It signals left throughout. Before, the car tried to follow the U-turn's line in one
  sweep, which no car can do on a street a few metres wide, stood still, and waited for deadlock
  recovery to creep it round: Toronto `s1-2` routes into Willcocks Common, a 10 m dead end, to
  turn back. Held up by traffic it waits with the turn intact; a turn that cannot move after 15
  legs, or stands still mid-leg for 5 s, is left to deadlock recovery.
  Decision models and LLMs get `nav.turn_round_in_m`, `turnaround` (whether it is under way, the
  leg and legs done), a situation line, two candidates (`stop_to_turn_round` and `turn_around`) and
  a line in the `drive` criterion (its legs back count as driving). Lane manoeuvres that would
  carry the car more than a metre past where it stops to turn round are rejected
  (`passes_turn_round_point`, labelled in AI eyes). New checks in `scripts/test_turnaround.mjs`:
  a 6.4 m dead end, the same facing each compass direction, and one between cars parked along
  both kerbs.

- Reversing is handled as reversing. The shared emergency brake looks behind the car while it
  backs up (and not ahead, which would hold up a leg back with a car just in front), braking in
  reverse pushes forward instead of speeding the car up backwards, and the audit puts backing
  into something down to the car. Turning round in a dead end off a junction ends the audit of
  the left turn the car made there for oncoming traffic: it comes back out as a new approach.

- A car two or more lanes from its route's lane keeps room for one lane change per lane before
  that lane ends, and a change toward the route's lane is always allowed. Before, it kept room for
  one change only, so starting two lanes over it could speed up, move one lane across, find no
  room left for the second, go back and stand still until deadlock recovery crept it over: Ottawa
  `s1-1` starts on Wellington Street two lanes left of its route's lane, 71 m before a right turn.
  A lane change also counts as over once the car is within 0.15 m of the new lane's centre, even
  short of the change's end, so one that stops there offers the next lane over.

- A deadlock event now says what the car was waiting on: how long it had stood still, the
  manoeuvre it last chose, how many candidates each rejection removed, the vehicle ahead, the
  control it was at, how many lanes it was from its route's lane and its next turn.

- In the seeded V8 and WebKit benchmarks Rules passes all 70 routes in each engine, as before,
  with no collision, red-light or stop-sign violation or failure to yield, and now **no deadlock
  override** (before: Toronto 4, Ottawa 3). Ottawa `s1-1` crosses its two lanes and arrives at
  175.4 s (175.3 s with the override). Toronto `s1-2` turns round in two legs and an exit by 54 s,
  then meets traffic at different times: 175.1 → 250.5 s in V8, behind a car that pulled out and
  at a red light, and 180.1 → 180.9 s in WebKit. Lane changes that end once across move three
  other routes by 5 s or more, all sooner (V8 Kitsilano dry `s1-4` and Winnipeg `s1-1`, WebKit
  Edmonton `s1-2`). See [docs/rules-baseline.md](docs/rules-baseline.md).

- Cyclists keep right. Where a street has a parking lane at least 1.5 m wide and nothing is
  parked in it to the end of the block (parking stops short of every corner), a cyclist rides in
  it, 2.6 m right of the traffic lane's centre, past cars queued or slowing at the corner, and
  carries on across the junction. It moves back into the traffic lane 20 m plus 2 s before the
  next parked car (once it is crossing the junction, for one on the next block), before a junction
  where it turns left or the next street has no parking lane, and only when no car in the lane is
  beside it or closing from behind; until then it waits in the parking lane, 6 m behind the parked
  car. It also takes an empty parking lane mid-block when it runs on for 60 m. Before, cyclists
  rode single file in the traffic lane, so a car never had one on its right. A cyclist now stops
  for any part of a body across its way, parked cars and open doors included, along the way it
  will actually ride (it lags the line it steers for), not only for one whose middle is in its
  path, so it no longer rides into the side of a car turning across it. A bicycle moves sideways
  only as it rolls forward; stopped within 6 m of something, the rider puts a foot down and
  shuffles it across, and round toward its way, into free space. In three simulated minutes of
  traffic on each of the twelve maps with three seeds, cyclists spend up to 16 % of their time in
  a parking lane (4.5 % on average), cars and cyclists touched 6 times against 7 before, and
  cyclists stand still 15 % longer, mostly waiting for a gap to move back into the lane.

- Turning right, the driven car yields to a cyclist on its right (a right hook): one clear of its
  lane line, going its way, that would reach the corner before the car could turn across its line
  of travel plus 1.5 s (0.75 s once the car is moving into the turn). It waits 1 m short of that
  line, or carries on once it can no longer stop short of it. A cyclist following the car in its
  lane is not waited for, nor one standing still beside it until it moves off. Traffic cars do the
  same from 50 m out, for a cyclist within 6 m to their right, judging their own time to the corner
  at no more than the 6 m/s they slow to for the turn.
  The audit counts turning across the line of a cyclist that rode on the car's right in the last
  3 s, due there within 2 s, as a failure to yield (`cyclist`), seen or not. Decision models and
  LLMs get `cyclist_on_right` (when the cyclist reaches the corner, how long the car needs, where it
  waits), a situation line, a `stop_for_cyclist` candidate and a motion criterion; manoeuvres past
  the wait point are rejected (`fails_to_yield_to_cyclist`, labelled in AI eyes).

- A traffic car gets into the lane for its next turn when that turn comes just past a short link
  going straight on inside the junction (a street under 20 m long). Before, it looked only at the
  end of the street it was on, so in Kitsilano, where West Broadway meets Yew Street through an
  8.6 m link, a car in the right lane turned left across the driven car turning beside it from the
  left lane (V8 Kitsilano fog `s1-4`, 133 s, once the cyclists above changed the traffic's timing).
  Kitsilano has 14 turns like it from streets with more than one lane.

- In the seeded V8 and WebKit benchmarks Rules passes all 70 routes in each engine, as before,
  with no collision, red-light or stop-sign violation or failure to yield, and the same seven
  deadlock overrides (Toronto 4, Ottawa 3). On Kitsilano `s1-7` in dry, fog and rain the car lets
  a cyclist on its right go by before turning. Across the 70 V8 routes it spends 179 s within
  20 m behind a cyclist, against 339 s before: Kitsilano snow `s1-7` arrives 70 s sooner, no
  longer following a cyclist at walking pace for 164 s. Other drives move both ways as traffic
  parks, pulls out and opens doors in different places; WebKit Edmonton `s1-2` reaches a signal as
  it turns red and arrives 62 s later. See [docs/rules-baseline.md](docs/rules-baseline.md).

- New challenge, **The right hook** (Vancouver, Kitsilano): a right turn off a bikeway from a
  street with the right of way, with a cyclist 15 m ahead in the empty parking lane at 5.5 m/s,
  going straight on past the corner. The car catches it up, and Rules waits about 6 s for it at
  the corner before turning behind it. New checks in `scripts/test_right_hook.mjs`.

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
  waited for anyone already in such a junction. Across the twelve maps, 1,586 approaches to
  junctions without a sign give way to the right and 395 to a larger road; 970 more have the right
  of way over a smaller road or a stop sign, and 595 approaches at 430 junctions are two-way
  stops. A node where a signal's approach shorter than 20 m starts is part of that signal's
  junction (a junction drawn as several nodes), not a junction of its own. Turning left from the road with the right of way, the car yields to oncoming traffic as
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

- A junction without a sign that asks nothing of the car (it has the right of way, or nothing it
  gives way to is coming and it can see) no longer hides the control after it, in sensing or the
  audit: a signal or stop sign just beyond is the one the car slows for, and crossing it is
  audited. Traffic giving way at such a junction counts any vehicle moving faster than 0.2 m/s,
  not only above 1 m/s.

- New challenge, **The blind corner** (Vancouver, Mount Pleasant): a two-way stop where a corner
  building hides the through road from the line. Once the car has made its stop, a car comes from
  the right, out of sight, and another from the left. New checks in `scripts/test_give_way.mjs`.

- The shared emergency brake keeps steering along the manoeuvre the car was following (a lane
  manoeuvre or `hard_brake`), as the `hard_brake` manoeuvre itself does. Before, it held the steering wheel where it was, so braking partway
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
  Winnipeg 36.65 → 33.65, Edmonton 31.15 → 28.5, Saskatoon 29.85 → 26.15 and Québec City
  28.2 → 26.55 (V8); Kitsilano moves
  by at most 0.5 km/h. Traffic giving way shifts other drives both ways: Kitsilano dry `s1-8` and
  fog `s1-4` arrive 36 s and 41 s sooner. The reruns use Node v24.19.0 / V8 and native WebKit on
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
