import * as THREE from "three";
import { buildSnapshot } from "../brain/sensors.js";
import { isEmergency } from "../sim/emergency.js";
import { busSignalling } from "../sim/bus.js";
import { ZONE_NAMES, ZONE_HOURS, inEffect } from "../sim/speed-zones.js";
import { headingAt, pointAt } from "../map/mapdata.js";
import { hiderName } from "../sim/hidden-traffic.js";

// A debug view of geometric sensing, not a claim about a camera or learned perception model.
export class PerceptionView {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group); this.group.visible = false; this.last = -Infinity;
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }));
    this.group.add(this.lines);
    this.bounds = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false }));
    this.group.add(this.bounds);
  }
  setEnabled(on) { this.group.visible = on; this.last = -Infinity; }
  // `executing`: the manoeuvre the car is carrying out, so the snapshot sees it as the brain does
  // (going round a double-parked van, say)
  update(world, now, decision, executing = null) {
    if (!this.group.visible || now - this.last < 250) return null;
    this.last = now;
    const snap = buildSnapshot(world, executing), ego = world.ego, rays = [], rayColors = [], boxes = [], boxColors = [];
    const add = (target, colors, from, to, color) => { target.push(from[0], 0.14, -from[1], to[0], 0.14, -to[1]); colors.push(...color, ...color); };
    for (let i = 0; i < 64; i++) {
      const angle = ego.psi + i / 64 * Math.PI * 2;
      const range = world.visibility.rangeAt(ego, ego.x + Math.cos(angle) * 100, ego.y + Math.sin(angle) * 100);
      let lo = 0, hi = range;
      if (!world.visibility.canSee(ego, ego.x + Math.cos(angle) * range, ego.y + Math.sin(angle) * range)) {
        for (let n = 0; n < 7; n++) { const mid = (lo + hi) / 2;
          if (world.visibility.canSee(ego, ego.x + Math.cos(angle) * mid, ego.y + Math.sin(angle) * mid)) lo = mid; else hi = mid;
        }
      } else lo = range;
      const p = [ego.x + Math.cos(angle) * lo, ego.y + Math.sin(angle) * lo];
      add(rays, rayColors, [ego.x, ego.y], p, [0.18, 0.65, 0.64]);
    }
    const nearby = world.obstaclesNear(ego.x, ego.y, 80);
    let seen = 0, hidden = 0;
    for (const object of nearby) {
      const visible = world.sees(ego, object); visible ? seen++ : hidden++;
      const b = object.obb(), c = Math.cos(b.heading), s = Math.sin(b.heading);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [b.center[0] + c * x * b.halfLength - s * y * b.halfWidth, b.center[1] + s * x * b.halfLength + c * y * b.halfWidth]);
      // (an emergency vehicle with its siren on is heard whether or not it is seen: magenta)
      // (a bus signalling to pull out from its stop, seen: amber)
      // (a vehicle stopped at a crosswalk that the car must not pass, a school bus showing its
      // lights, a streetcar stopping or with its doors open, a train coming at a level crossing ahead,
      // the vehicle that leaves no room past a junction ahead, one stopped at the roadside with its
      // lights flashing, a work zone's closed stretch on the car's way, a van double-parked in the
      // car's lane, a snow plow at work, a cyclist the car can pass only through the oncoming lane, or a
      // school crossing guard, or a cyclist riding against the one-way the car waits or moves over for, or
      // the geese of a gaggle it slows or waits for, or a car tailgating it: amber too)
      const color = isEmergency(object) ? [1, 0.3, 0.9] : visible && (busSignalling(object) || object.id === snap.crosswalk_stop?.id || object.id === snap.school_bus?.id || object.id === snap.streetcar?.id || object.id === snap.level_crossing?.train?.id || object.id === snap.junction_box?.blocker.id || object.id === snap.roadside_stop?.id || object.id === snap.work_zone?.closure_id || object.id === snap.lane_closure?.closure_id || object.id === snap.lane_closure?.wait_for || object.id === snap.lane_closure?.let_in_for || object.id === snap.double_parked?.van_id || object.id === snap.snow_plow?.id || object.id === snap.cyclist_pass?.cyclist_id || object.id === snap.crossing_guard?.guard_id || object.id === snap.contraflow_cyclist?.cyclist_id || (snap.red_light_runner && object.id === snap.red_light_runner.id) || (snap.ball_in_road?.child_id && object.id === snap.ball_in_road.child_id) || (snap.geese_crossing && object.gaggle === snap.geese_crossing.id) || (snap.tailgater && object.id === snap.tailgater.id)) ? [1, 0.7, 0.15] : visible ? [0.34, 0.9, 0.66] : [0.96, 0.39, 0.42];
      for (let i = 0; i < 4; i++) add(boxes, boxColors, corners[i], corners[(i + 1) % 4], color);
    }
    // school and playground zones in effect nearby: their side of the street outlined in yellow-green
    for (const [edgeId, spans] of world.map.zoneSpans) {
      const e = world.map.edges.get(edgeId), scale = e.cum.at(-1) / Math.max(1e-6, e.length);
      for (const span of spans) {
        if (!inEffect(span.zone.kind, world.clock)) continue;
        const at = (s, d) => { const q = pointAt(e.pts, e.cum, s * scale), h = headingAt(e.pts, e.cum, s * scale); return [q[0] + Math.sin(h) * d, q[1] - Math.cos(h) * d]; };
        const mid = at((span.from + span.to) / 2, 0);
        if (Math.hypot(mid[0] - ego.x, mid[1] - ego.y) > 90 + (span.to - span.from) / 2) continue;
        for (const d of [0.4, e.asphalt[1] - 0.4]) {
          for (let s = span.from; s < span.to; s += 3) add(boxes, boxColors, at(s, d), at(Math.min(span.to, s + 3), d), [0.83, 0.93, 0.17]);
        }
      }
    }
    for (const [mesh, vertices, colors] of [[this.lines, rays, rayColors], [this.bounds, boxes, boxColors]]) {
      mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry();
      mesh.geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      mesh.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3)); mesh.geometry.computeBoundingSphere();
    }
    const reasons = { following_distance: "Leaves too little braking room", collision: "Predicted collision", visibility_stopping_distance: "Beyond stopping sight", passes_cyclist_too_close: "Too close to cyclist", passes_cyclist_without_room: "Cyclist: less than the passing distance", crosses_into_oncoming_traffic: "Oncoming traffic",
      off_road: "Leaves the road", runs_red: "Red light", fails_to_yield: "Must yield", runs_stop: "Missed stop", fails_to_yield_to_pedestrian: "Person crossing",
      fails_to_yield_to_oncoming: "Oncoming traffic", fails_to_yield_to_cyclist: "Cyclist on the right", fails_to_yield_to_emergency: "Emergency vehicle", fails_to_yield_to_bus: "Bus pulling out", passes_car_stopped_at_crosswalk: "Car stopped at crosswalk", passes_stopped_school_bus: "School bus stopped", passes_streetcar_doors: "Streetcar doors open", crosses_in_front_of_train: "Train coming", no_room_past_tracks: "No room past the tracks", blocks_junction: "No room past the junction", runs_flagger_stop: "Flagger showing STOP", passes_crossing_guard: "Crossing guard: STOP", fails_to_yield_to_contraflow_cyclist: "Cyclist against the one-way", passes_contraflow_cyclist_too_close: "Cyclist coming: less than the passing distance", enters_ahead_of_red_light_runner: "Car running the red", no_room_to_go_round: "Too close to pull out round the van", passes_plow_on_right: "Snow plow: never pass on the right", enters_unseen_junction: "Cannot see yet",
      passes_turn_round_point: "Turns round here", passes_reversing_vehicle_too_close: "Car backing out", hits_pothole_too_fast: "Pothole: too fast", splashes_pedestrian: "Puddle: would splash someone", passes_ball_gap_too_fast: "Ball in the road: a child may follow", drives_into_geese: "Geese crossing", brakes_hard_with_tailgater: "Tailgater: brakes too hard", crosses_ice_too_fast: "Black ice: too fast", brakes_on_ice: "Black ice: no hard braking or steering", enters_narrowing_out_of_turn: "Snowbanks: oncoming car's turn" };
    const e = snap.emergency;
    const emergency = e ? `${e.kind[0].toUpperCase()}${e.kind.slice(1)} ${e.from === "behind" ? "behind" : e.from === "ahead" ? "ahead" : `from the ${e.from}`}, ${Math.round(e.distance_m)} m${e.seen ? "" : ", heard not seen"}: ${e.lead ? "stuck behind the car, driving on ahead" : `pull over ${e.offset_m.toFixed(1)} m, stop in ${Math.max(0, Math.round(e.bumper_to_stop_m))} m${e.clearing ? " past the junction" : ""}`}` : null;
    const b = snap.bus;
    const bus = b ? `Bus${b.ref ? ` ${b.ref}` : ""} ${b.moving_out ? "pulling out" : "signalling to pull out"} ${Math.round(Math.max(0, b.gap_m))} m ahead: stop in ${Math.max(0, Math.round(b.bumper_to_stop_m))} m and let it out` : null;
    const w = snap.crosswalk_stop;
    const crosswalk = w ? `${w.kind[0].toUpperCase()}${w.kind.slice(1)} ${w.stopped ? "stopped" : "stopping"} at a crosswalk in the next lane, ${Math.round(Math.max(0, w.bumper_to_crosswalk_m))} m ahead: stop in ${Math.max(0, Math.round(w.bumper_to_stop_m))} m and look` : null;
    const k = snap.school_bus;
    const school = k ? `School bus ${k.relation === "behind" ? "ahead" : "coming the other way"}, ${Math.round(Math.max(0, k.gap_m))} m: ${k.lights === "red" ? `red lights flashing, stop in ${Math.max(0, Math.round(k.bumper_to_stop_m))} m` : "amber lights, about to stop"}` : null;
    const q = snap.streetcar;
    const streetcar = q ? `Streetcar${q.ref ? ` ${q.ref}` : ""} ${q.beside ? "in the next lane" : "ahead"}, ${Math.round(Math.max(0, q.gap_m))} m: ${q.doors ? `doors open, stop in ${Math.max(0, Math.round(q.bumper_to_stop_m))} m, behind them` : "stopping, its doors about to open"}` : null;
    const x = snap.level_crossing, xt = x?.train;
    const crossing = x ? `Level crossing, ${x.on_tracks ? "on the tracks: clear them" : `${Math.round(Math.max(0, x.to_rail_m))} m ahead`}${xt ? `: ${x.kind === "tram" ? "streetcar" : "train"} ${xt.on ? "on it" : `due in ${Math.round(xt.eta_s)} s`}${xt.seen ? "" : ", heard not seen"}` : ""}${x.wait ? `, ${x.wait === "train" ? "stop" : "no room past it, wait"} in ${Math.max(0, Math.round(x.bumper_to_stop_m))} m` : ""}` : null;
    const jb = snap.junction_box;
    const box = jb ? `No room past the junction ahead (${Math.round(Math.max(0, jb.room_m))} m of ${Math.round(jb.need_m)}): wait at the line${jb.bumper_to_stop_m > 0.5 ? ` in ${Math.round(jb.bumper_to_stop_m)} m` : ""}` : null;
    const wz = snap.work_zone;
    const workZone = wz ? `Work zone, ${wz.side === "closed" ? "the car's lane closed: round it through the other lane" : "one lane"}; flagger shows ${wz.paddle === "stop" ? "STOP" : "SLOW"}${wz.wait ? `, stop in ${Math.max(0, Math.round(wz.bumper_to_stop_m))} m` : `: ${Math.round(wz.limit_mps * 3.6)} km/h`}` : null;
    const lz = snap.lane_closure;
    const closure = lz ? `${lz.closed_lane === "right" ? "Right" : "Left"} lane closed, zipper merge${lz.merged ? "" : ` in ${Math.round(Math.max(0, lz.bumper_to_merge_m))} m`}: ${lz.side === "closed" ? (lz.let_in ? "car's turn, merge" : lz.wait ? `wait at the merge${lz.wait_for ? ` for ${lz.wait_for}` : ""}` : "merge in turn") : lz.let_in_for ? `let ${lz.let_in_for} in` : "take turns"}` : null;
    const dp = snap.double_parked;
    const van = dp ? `${dp.truck ? "Garbage truck" : "Double-parked van"} ${dp.gap_m > 0 ? `${Math.round(dp.gap_m)} m ahead` : "beside"}: ${dp.going_round ? "going round it" : dp.go ? `way round clear, go round at ${Math.round(dp.limit_mps * 3.6)} km/h` : dp.queued ? "wait in turn behind it" : `${dp.crew_in_road ? "crew in the road" : dp.way.oncoming ? "oncoming traffic" : "can't see far enough"}, wait${dp.bumper_to_stop_m > 0.5 ? ` in ${Math.round(dp.bumper_to_stop_m)} m` : ""}`}` : null;
    // cars parked at the kerb that hide the sidewalk (sim/blind-spot.js), with hidden hazards on
    const bs = snap.blind_spot;
    const blind = bs ? `Parked cars ${bs.from_m > 0 ? `${Math.round(bs.from_m)} m ahead` : "beside"} hide the sidewalk: ${Math.round(bs.limit_mps * 3.6)} km/h` : null;
    // a vehicle hiding a lane the car must give way to (sim/hidden-traffic.js), with hidden hazards on
    const ix = snap.intersection, hid = ix?.oncoming?.view?.hidden_by ?? (ix?.give_way?.go === false ? ix.give_way.hidden_by : null) ?? ix?.right_on_red?.wait_for?.hidden_by ?? null;
    const lane = hid ? `${ix.oncoming?.view ? "Oncoming lane" : ix.right_on_red?.wait_for?.hidden_by ? "Street to the left" : "Cross street"} hidden behind a ${hiderName(world, hid)}: wait until it can see` : null;
    const z = snap.speed_zone;
    const zone = z ? `${ZONE_NAMES[z.kind][0].toUpperCase()}${ZONE_NAMES[z.kind].slice(1)}${z.name ? ` (${z.name})` : ""}, ${ZONE_HOURS[z.kind]}: ${Math.round(z.limit_mps * 3.6)} km/h ${z.in_zone ? (z.ends_in_m !== null ? `for ${Math.round(z.ends_in_m)} m` : "here") : `from ${Math.round(Math.max(0, z.starts_in_m))} m ahead`}` : null;
    const r = snap.roadside_stop;
    const roadside = r ? `${r.name[0].toUpperCase()}${r.name.slice(1)} at the roadside, lights flashing, ${r.gap_m > 0 ? `${Math.round(r.gap_m)} m ahead` : "beside"}: pass at ${Math.round(r.limit_mps * 3.6)} km/h${r.in_adjacent_lane && r.other_lane ? ", move over" : ""}` : null;
    const sp = snap.snow_plow;
    const plow = sp ? `Snow plow ${sp.gap_m > 0 ? `${Math.round(sp.gap_m)} m ahead` : "beside"}${sp.lane === "same" ? "" : ` in the ${sp.lane} lane`}: ${sp.passing ? `passing on the left, back in ${sp.keep_back_m} m ahead` : !sp.holds ? "may pass on the left" : sp.lane === "left" ? `never pass on the right, stay ${sp.keep_back_m} m back` : `stay ${sp.keep_back_m} m back${sp.may_pass ? ", pass only on the left" : ""}`}` : null;
    // a cyclist ahead the car can pass only through the oncoming lane (sim/cyclist-pass.js)
    const cp = snap.cyclist_pass;
    const cyclist = cp ? `Cyclist ${cp.gap_m > 0 ? `${Math.round(cp.gap_m)} m ahead` : "beside"}: ${cp.going && cp.go ? `passing, ${cp.min_pass_m} m clear` : cp.go ? `way clear, pass ${cp.min_pass_m} m clear` : !cp.possible ? "can't pass here, stay behind" : cp.way?.oncoming ? "oncoming traffic, stay behind" : cp.way && !cp.way.sees_far_enough ? "can't see far enough, stay behind" : "stay behind"}` : null;
    // a speed hump or the like ahead (sim/traffic-calming.js), and a scramble crossing (sim/signals.js)
    const tc = snap.traffic_calming;
    const calm = tc ? `${tc.name[0].toUpperCase()}${tc.name.slice(1)} ${tc.over ? "under the car" : `${Math.round(Math.max(0, tc.starts_in_m))} m ahead`}: ${Math.round(tc.speed_mps * 3.6)} km/h` : null;
    const sc = snap.intersection?.scramble;
    const scramble = sc ? `Scramble crossing: ${sc.phase === "dont" ? `all-walk in ${Math.round(sc.walk_in_s)} s, no right turn on red` : "all-walk on, every light red"}` : null;
    // a school crossing guard at a crosswalk ahead (sim/crossing-guard.js)
    const cg = snap.crossing_guard;
    const guard = cg ? `Crossing guard ${Math.round(Math.max(0, cg.bumper_to_crosswalk_m))} m ahead: ${cg.wait ? `STOP${cg.in_road.length ? `, ${cg.in_road.length} in the road` : ""}, wait in ${Math.max(0, Math.round(cg.bumper_to_stop_m))} m` : cg.paddle === "up" || cg.in_road.length ? "STOP sign up, too close to stop" : cg.ready ? `${cg.waiting} waiting to cross, ready to stop` : "nobody crossing"}` : null;
    // a cyclist riding against a one-way street (sim/contraflow.js)
    const cf = snap.contraflow_cyclist;
    const contraflow = cf?.relation === "entering" ? "Contraflow street ahead, out of sight: creep and look both ways" : cf ? `Cyclist against the one-way ${Math.round(cf.gap_m)} m away: ${cf.wait ? `${cf.relation === "oncoming" ? "no room to pass, move over and" : "give way,"} wait${cf.bumper_to_stop_m > 0.5 ? ` in ${Math.round(cf.bumper_to_stop_m)} m` : ""}` : `keep right, ${cf.min_pass_m} m clear`}` : null;
    // a car running the red across the car's way as its light is green (sim/red-light-runner.js)
    const rr = snap.red_light_runner;
    const runner = rr ? `Car from the ${rr.from} ${rr.relation === "in_junction" ? "running the red in the junction" : "cannot stop for its red"}: ${rr.wait ? "wait at the line" : "too close to stop, keep clear"}` : null;
    // a car backing out of a driveway (sim/driveway-reversers.js)
    const rv = snap.reversing_vehicle;
    const reversing = rv ? `Car backing out ${Math.round(rv.gap_m)} m ahead: ${rv.wait ? `give it room${rv.bumper_to_stop_m > 0.5 ? `, stop in ${Math.round(rv.bumper_to_stop_m)} m` : ""}` : `slow to ${Math.round(rv.limit_mps * 3.6)} km/h`}` : null;
    // a pothole in the car's lane ahead (sim/potholes.js)
    const ph = snap.pothole;
    const pothole = ph ? `Pothole ${ph.starts_in_m > 0 ? `${Math.round(ph.starts_in_m)} m ahead` : "under the car"}${ph.room ? (ph.shift_m ? `: ease ${Math.abs(ph.shift_m).toFixed(1)} m ${ph.shift_m < 0 ? "left" : "right"} in the lane` : ": between the wheels") : `: no room, ${Math.round(ph.speed_mps * 3.6)} km/h over it`}` : null;
    // snowbanks: a stretch they narrow to one car, and a corner they hide (sim/snowbanks.js)
    const sn = snap.snowbank?.narrowing, sk = snap.snowbank?.corner;
    const snowbank = sn ? `One-car stretch between snowbanks ${sn.inside ? "here" : `${Math.max(0, Math.round(sn.gap_m))} m ahead`}: ${sn.wait ? `oncoming car's turn${sn.bumper_to_stop_m > 0.5 ? `, wait in ${Math.round(sn.bumper_to_stop_m)} m` : ", waiting"}` : sn.squeeze ? "squeeze past the oncoming car" : "car's turn"}`
      : sk ? `Snowbank hides the ${sk.side === "both" ? "corners" : `${sk.side} corner`} ${Math.round(sk.gap_m)} m ahead: creep to ${Math.round(sk.limit_mps * 3.6)} km/h` : null;
    // Canada geese by the road or crossing it (sim/geese.js)
    const gc = snap.geese_crossing;
    const geese = gc ? `${gc.geese} geese ${gc.phase === "about_to_cross" ? "by the road" : "crossing"} ${Math.round(gc.gap_m)} m ahead: ${gc.wait ? `wait for the last one${gc.bumper_to_stop_m > 0.5 ? `, stop in ${Math.round(gc.bumper_to_stop_m)} m` : ""}` : `slow to ${Math.round(gc.limit_mps * 3.6)} km/h`}` : null;
    const f = snap.following;
    const following = f?.policy ? `Following gap ${Math.round(f.gap_m)} m; target ${Math.round(f.policy.target_gap_m)} m for speed and grip` : null;
    // a ball rolled into the street ahead, a child maybe after it (sim/ball-chase.js)
    const bl = snap.ball_in_road;
    const ball = bl ? `Ball in the road ${Math.max(0, Math.round(bl.gap_m))} m ahead: ${bl.child === "in_road" ? "child after it, stop for them" : bl.child === "clear" ? "child back at the kerb" : bl.limit_mps != null ? `a child may follow, ${Math.round(bl.limit_mps * 3.6)} km/h` : "past it"}` : null;
    // a car tailgating the driven car, close behind it (sim/tailgaters.js): the rear-view cue
    const tg = snap.tailgater;
    const tailgater = tg ? `Tailgater ${Math.max(0, Math.round(tg.gap_m))} m behind (${tg.headway_s.toFixed(1)} s): ${tg.can_move_right ? "move right, let it by" : "twice the gap ahead, brake gently"}` : null;
    // black ice seen ahead or under the car, or a bridge coming up in icy weather (sim/black-ice.js)
    const bi = snap.black_ice, ib = snap.ice_caution?.bridge;
    const ice = bi ? `Black ice ${bi.on_ice ? "under the car: hold steady, no braking" : `${Math.round(bi.starts_in_m)} m ahead: ${Math.round(bi.speed_mps * 3.6)} km/h before it`}`
      : ib && ib.starts_in_m < 80 ? `Near freezing: bridge ${ib.on ? "here" : `in ${Math.round(ib.starts_in_m)} m`}, ${Math.round(snap.ice_caution.slow.mps * 3.6)} km/h` : null;
    // a puddle at the kerb with people beside it (sim/puddles.js)
    const pd = snap.puddle_splash;
    const puddle = pd ? `Puddle by the kerb ${pd.starts_in_m > 0 ? `${Math.round(pd.starts_in_m)} m ahead` : "under the car"}, ${pd.people === 1 ? "someone" : `${pd.people} people`} beside it: ${pd.room ? (pd.shift_m ? `ease ${Math.abs(pd.shift_m).toFixed(1)} m ${pd.shift_m < 0 ? "left" : "right"} in the lane` : "the wheels miss it") : `${Math.round(pd.speed_mps * 3.6)} km/h through it`}` : null;
    return { puddle, tailgater, seen, hidden, following, runner, ball, ice, emergency, bus, crosswalk, school, streetcar, crossing, box, workZone, closure, van, plow, calm, scramble, cyclist, guard, contraflow, reversing, pothole, geese, snowbank, blind, lane, zone, roadside, range: snap.visibility.range_m, safeSpeed: Math.min(snap.limit, snap.visibility.safe_speed_mps) * 3.6,
      rejected: decision?.candidates?.filter(c => !c.eligible).map(c => ({ id: c.id, reason: reasons[c.reject] || "Safety filter" })) || [] };
  }
}
