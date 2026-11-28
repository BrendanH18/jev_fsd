import { flagText } from "../brain/tracks.js";
import * as THREE from "three";
import { buildSnapshot } from "../brain/sensors.js";
import { isEmergency } from "../sim/emergency.js";
import { busSignalling } from "../sim/bus.js";
import { ZONE_NAMES, ZONE_HOURS, inEffect } from "../sim/speed-zones.js";
import { headingAt, pointAt } from "../map/mapdata.js";
import { hiderName } from "../sim/hidden-traffic.js";
import { featurePerceptionRejection, hooks } from "../sim/features/index.js";

const PERCEPTION_LINES = hooks("perceptionLine");
const PERCEPTION_FOCUS = hooks("perceptionFocus");
const SIGHT_SAMPLES = 64;

function visibilityFootprint() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(3 * (SIGHT_SAMPLES + 1)), 3).setUsage(THREE.DynamicDrawUsage),
  );
  const indices = [],
    colors = [1, 1, 1, 0.07];
  for (let i = 0; i < SIGHT_SAMPLES; i++) {
    indices.push(0, i + 1, ((i + 1) % SIGHT_SAMPLES) + 1);
    colors.push(1, 1, 1, 0.27);
  }
  geometry.setIndex(indices);
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x64d9ce, vertexColors: true, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = -1; // below route ribbons and road-user outlines
  return mesh;
}

// A debug view of geometric sensing, not a claim about a camera or learned perception model.
export class PerceptionView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.group.visible = false;
    this.last = -Infinity;
    this.footprint = visibilityFootprint();
    this.group.add(this.footprint);
    this.bounds = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.group.add(this.bounds);
  }
  setEnabled(on) {
    this.group.visible = on;
    this.last = -Infinity;
  }
  // `executing`: the manoeuvre the car is carrying out, so the snapshot sees it as the brain does
  // (going round a double-parked van, say)
  update(world, now, decision, executing = null) {
    if (!this.group.visible || now - this.last < 250) return null;
    this.last = now;
    const snap = buildSnapshot(world, executing),
      ego = world.ego,
      boxes = [],
      boxColors = [];
    const addOutline = (from, to, color) => {
      boxes.push(from[0], 0.14, -from[1], to[0], 0.14, -to[1]);
      boxColors.push(...color, ...color);
    };
    const positions = this.footprint.geometry.attributes.position;
    this.footprint.position.set(ego.x, 0.08, -ego.y);
    for (let i = 0; i < SIGHT_SAMPLES; i++) {
      const angle = ego.psi + (i / SIGHT_SAMPLES) * Math.PI * 2,
        dx = Math.cos(angle),
        dy = Math.sin(angle);
      const range = world.visibility.rangeAt(ego, ego.x + dx * 100, ego.y + dy * 100);
      let lo = 0,
        hi = range;
      if (!world.visibility.canSee(ego, ego.x + dx * range, ego.y + dy * range)) {
        for (let n = 0; n < 7; n++) {
          const mid = (lo + hi) / 2;
          if (world.visibility.canSee(ego, ego.x + dx * mid, ego.y + dy * mid)) lo = mid;
          else hi = mid;
        }
      } else lo = range;
      positions.setXYZ(i + 1, dx * lo, 0, -dy * lo);
    }
    positions.needsUpdate = true;
    this.footprint.geometry.computeBoundingSphere();
    const nearby = world.obstaclesNear(ego.x, ego.y, 80);
    let seen = 0,
      hidden = 0;
    for (const object of nearby) {
      const visible = world.sees(ego, object);
      visible ? seen++ : hidden++;
      const b = object.obb(),
        c = Math.cos(b.heading),
        s = Math.sin(b.heading);
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) => [
        b.center[0] + c * x * b.halfLength - s * y * b.halfWidth,
        b.center[1] + s * x * b.halfLength + c * y * b.halfWidth,
      ]);
      // Sirens are heard even if the vehicle is occluded. Visible hazards are amber.
      const color = isEmergency(object)
        ? [1, 0.3, 0.9]
        : visible &&
            (busSignalling(object) ||
              object.id === snap.crosswalk_stop?.id ||
              object.id === snap.school_bus?.id ||
              object.id === snap.streetcar?.id ||
              object.id === snap.level_crossing?.train?.id ||
              object.id === snap.junction_box?.blocker.id ||
              object.id === snap.work_zone?.closure_id ||
              object.id === snap.lane_closure?.closure_id ||
              object.id === snap.lane_closure?.wait_for ||
              object.id === snap.lane_closure?.let_in_for ||
              object.id === snap.snow_plow?.id ||
              object.id === snap.cyclist_pass?.cyclist_id ||
              PERCEPTION_FOCUS.some((focus) => focus(snap, object)))
          ? [1, 0.7, 0.15]
          : visible
            ? [0.34, 0.9, 0.66]
            : [0.96, 0.39, 0.42];
      for (let i = 0; i < 4; i++) addOutline(corners[i], corners[(i + 1) % 4], color);
    }
    // school and playground zones in effect nearby: their side of the street outlined in yellow-green
    for (const [edgeId, spans] of world.map.zoneSpans) {
      const e = world.map.edges.get(edgeId),
        scale = e.cum.at(-1) / Math.max(1e-6, e.length);
      for (const span of spans) {
        if (!inEffect(span.zone.kind, world.clock)) continue;
        const at = (s, d) => {
          const q = pointAt(e.pts, e.cum, s * scale),
            h = headingAt(e.pts, e.cum, s * scale);
          return [q[0] + Math.sin(h) * d, q[1] - Math.cos(h) * d];
        };
        const mid = at((span.from + span.to) / 2, 0);
        if (Math.hypot(mid[0] - ego.x, mid[1] - ego.y) > 90 + (span.to - span.from) / 2) continue;
        for (const d of [0.4, e.asphalt[1] - 0.4]) {
          for (let s = span.from; s < span.to; s += 3)
            addOutline(at(s, d), at(Math.min(span.to, s + 3), d), [0.83, 0.93, 0.17]);
        }
      }
    }
    this.bounds.geometry.dispose();
    this.bounds.geometry = new THREE.BufferGeometry();
    this.bounds.geometry.setAttribute("position", new THREE.Float32BufferAttribute(boxes, 3));
    this.bounds.geometry.setAttribute("color", new THREE.Float32BufferAttribute(boxColors, 3));
    this.bounds.geometry.computeBoundingSphere();
    const reasons = {
      collision: "Predicted collision",
      visibility_stopping_distance: "Beyond stopping sight",
      passes_cyclist_too_close: "Too close to cyclist",
      passes_cyclist_without_room: "Cyclist: less than the passing distance",
      crosses_into_oncoming_traffic: "Oncoming traffic",
      off_road: "Leaves the road",
      runs_red: "Red light",
      fails_to_yield: "Must yield",
      runs_stop: "Missed stop",
      fails_to_yield_to_pedestrian: "Person crossing",
      fails_to_yield_to_oncoming: "Oncoming traffic",
      fails_to_yield_to_cyclist: "Cyclist on the right",
      fails_to_yield_to_emergency: "Emergency vehicle",
      fails_to_yield_to_bus: "Bus pulling out",
      passes_car_stopped_at_crosswalk: "Car stopped at crosswalk",
      passes_stopped_school_bus: "School bus stopped",
      passes_streetcar_doors: "Streetcar doors open",
      crosses_in_front_of_train: "Train coming",
      no_room_past_tracks: "No room past the tracks",
      blocks_junction: "No room past the junction",
      runs_flagger_stop: "Flagger showing STOP",
      passes_plow_on_right: "Snow plow: never pass on the right",
      enters_unseen_junction: "Cannot see yet",
      passes_turn_round_point: "Turns round here",
    };
    const e = snap.emergency;
    const emergency = e
      ? `${e.kind[0].toUpperCase()}${e.kind.slice(1)} ${e.from === "behind" ? "behind" : e.from === "ahead" ? "ahead" : `from the ${e.from}`}, ${Math.round(e.distance_m)} m${e.seen ? "" : ", heard not seen"}: ${e.lead ? "stuck behind the car, driving on ahead" : `pull over ${e.offset_m.toFixed(1)} m, stop in ${Math.max(0, Math.round(e.bumper_to_stop_m))} m${e.clearing ? " past the junction" : ""}`}`
      : null;
    const b = snap.bus;
    const bus = b
      ? `Bus${b.ref ? ` ${b.ref}` : ""} ${b.moving_out ? "pulling out" : "signalling to pull out"} ${Math.round(Math.max(0, b.gap_m))} m ahead: stop in ${Math.max(0, Math.round(b.bumper_to_stop_m))} m and let it out`
      : null;
    const w = snap.crosswalk_stop;
    const crosswalk = w
      ? `${w.kind[0].toUpperCase()}${w.kind.slice(1)} ${w.stopped ? "stopped" : "stopping"} at a crosswalk in the next lane, ${Math.round(Math.max(0, w.bumper_to_crosswalk_m))} m ahead: stop in ${Math.max(0, Math.round(w.bumper_to_stop_m))} m and look`
      : null;
    const k = snap.school_bus;
    const school = k
      ? `School bus ${k.relation === "behind" ? "ahead" : "coming the other way"}, ${Math.round(Math.max(0, k.gap_m))} m: ${k.lights === "red" ? `red lights flashing, stop in ${Math.max(0, Math.round(k.bumper_to_stop_m))} m` : "amber lights, about to stop"}`
      : null;
    const q = snap.streetcar;
    const streetcar = q
      ? `Streetcar${q.ref ? ` ${q.ref}` : ""} ${q.beside ? "in the next lane" : "ahead"}, ${Math.round(Math.max(0, q.gap_m))} m: ${q.doors ? `doors open, stop in ${Math.max(0, Math.round(q.bumper_to_stop_m))} m, behind them` : "stopping, its doors about to open"}`
      : null;
    const x = snap.level_crossing,
      xt = x?.train;
    const crossing = x
      ? `Level crossing, ${x.on_tracks ? "on the tracks: clear them" : `${Math.round(Math.max(0, x.to_rail_m))} m ahead`}${xt ? `: ${x.kind === "tram" ? "streetcar" : "train"} ${xt.on ? "on it" : `due in ${Math.round(xt.eta_s)} s`}${xt.seen ? "" : ", heard not seen"}` : ""}${x.wait ? `, ${x.wait === "train" ? "stop" : "no room past it, wait"} in ${Math.max(0, Math.round(x.bumper_to_stop_m))} m` : ""}`
      : null;
    const jb = snap.junction_box;
    const box = jb
      ? `No room past the junction ahead (${Math.round(Math.max(0, jb.room_m))} m of ${Math.round(jb.need_m)}): wait at the line${jb.bumper_to_stop_m > 0.5 ? ` in ${Math.round(jb.bumper_to_stop_m)} m` : ""}`
      : null;
    const wz = snap.work_zone;
    const workZone = wz
      ? `Work zone, ${wz.side === "closed" ? "the car's lane closed: round it through the other lane" : "one lane"}; flagger shows ${wz.paddle === "stop" ? "STOP" : "SLOW"}${wz.wait ? `, stop in ${Math.max(0, Math.round(wz.bumper_to_stop_m))} m` : `: ${Math.round(wz.limit_mps * 3.6)} km/h`}`
      : null;
    const lz = snap.lane_closure;
    const closure = lz
      ? `${lz.closed_lane === "right" ? "Right" : "Left"} lane closed, zipper merge${lz.merged ? "" : ` in ${Math.round(Math.max(0, lz.bumper_to_merge_m))} m`}: ${lz.side === "closed" ? (lz.let_in ? "car's turn, merge" : lz.wait ? `wait at the merge${lz.wait_for ? ` for ${lz.wait_for}` : ""}` : "merge in turn") : lz.let_in_for ? `let ${lz.let_in_for} in` : "take turns"}`
      : null;
    // cars parked at the kerb that hide the sidewalk (sim/blind-spot.js), with hidden hazards on
    const bs = snap.blind_spot;
    const blind = bs
      ? `Parked cars ${bs.from_m > 0 ? `${Math.round(bs.from_m)} m ahead` : "beside"} hide the sidewalk: ${Math.round(bs.limit_mps * 3.6)} km/h`
      : null;
    // a vehicle hiding a lane the car must give way to (sim/hidden-traffic.js), with hidden hazards on
    const ix = snap.intersection,
      hid =
        ix?.oncoming?.view?.hidden_by ??
        (ix?.give_way?.go === false ? ix.give_way.hidden_by : null) ??
        ix?.right_on_red?.wait_for?.hidden_by ??
        null;
    const lane = hid
      ? `${ix.oncoming?.view ? "Oncoming lane" : ix.right_on_red?.wait_for?.hidden_by ? "Street to the left" : "Cross street"} hidden behind a ${hiderName(world, hid)}: wait until it can see`
      : null;
    const z = snap.speed_zone;
    const zone = z
      ? `${ZONE_NAMES[z.kind][0].toUpperCase()}${ZONE_NAMES[z.kind].slice(1)}${z.name ? ` (${z.name})` : ""}, ${ZONE_HOURS[z.kind]}: ${Math.round(z.limit_mps * 3.6)} km/h ${z.in_zone ? (z.ends_in_m !== null ? `for ${Math.round(z.ends_in_m)} m` : "here") : `from ${Math.round(Math.max(0, z.starts_in_m))} m ahead`}`
      : null;
    const sp = snap.snow_plow;
    const plow = sp
      ? `Snow plow ${sp.gap_m > 0 ? `${Math.round(sp.gap_m)} m ahead` : "beside"}${sp.lane === "same" ? "" : ` in the ${sp.lane} lane`}: ${sp.passing ? `passing on the left, back in ${sp.keep_back_m} m ahead` : !sp.holds ? "may pass on the left" : sp.lane === "left" ? `never pass on the right, stay ${sp.keep_back_m} m back` : `stay ${sp.keep_back_m} m back${sp.may_pass ? ", pass only on the left" : ""}`}`
      : null;
    // a cyclist ahead the car can pass only through the oncoming lane (sim/cyclist-pass.js)
    const cp = snap.cyclist_pass;
    const cyclist = cp
      ? `Cyclist ${cp.gap_m > 0 ? `${Math.round(cp.gap_m)} m ahead` : "beside"}: ${cp.going && cp.go ? `passing, ${cp.min_pass_m} m clear` : cp.go ? `way clear, pass ${cp.min_pass_m} m clear` : !cp.possible ? "can't pass here, stay behind" : cp.way?.oncoming ? "oncoming traffic, stay behind" : cp.way && !cp.way.sees_far_enough ? "can't see far enough, stay behind" : "stay behind"}`
      : null;
    const sc = snap.intersection?.scramble;
    const scramble = sc
      ? `Scramble crossing: ${sc.phase === "dont" ? `all-walk in ${Math.round(sc.walk_in_s)} s, no right turn on red` : "all-walk on, every light red"}`
      : null;
    return {
      featureLines: PERCEPTION_LINES.map((describe) => describe(snap)).filter(Boolean),
      seen,
      hidden,
      emergency,
      bus,
      crosswalk,
      school,
      streetcar,
      crossing,
      box,
      workZone,
      closure,
      plow,
      scramble,
      cyclist,
      blind,
      lane,
      zone,
      range: snap.visibility.range_m,
      safeSpeed: Math.min(snap.limit, snap.visibility.safe_speed_mps) * 3.6,
      rejected:
        decision?.candidates
          // (and the open track's flagged ones, offered though they failed a road-rule check: brain/tracks.js)
          ?.filter((c) => !c.eligible || c.flagged)
          .map((c) => ({
            id: c.id,
            reason: c.flagged
              ? `Flagged: ${reasons[c.reject] || featurePerceptionRejection(c.reject) || flagText(c.reject)}`
              : reasons[c.reject] || featurePerceptionRejection(c.reject) || "Safety filter",
          })) || [],
    };
  }
}
