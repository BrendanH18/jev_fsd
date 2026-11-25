// Opt-in diagnostics for a paused fleet. These checks inspect the same live state the
// simulator uses, without updating stop memories, pruning queues, or drawing from RNGs.
const EPS = 1e-6;
const finite = (...numbers) => numbers.every(Number.isFinite);
const nonnegative = (n) => Number.isFinite(n) && n >= 0;
const positive = (n) => Number.isFinite(n) && n > 0;
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const identity = (id) => (typeof id === "string" && id.length > 0) || Number.isSafeInteger(id);
const finitePoint = (p) => Array.isArray(p) && p.length === 2 && finite(...p);

const FLEET_CHECKS = [
  [
    "fleet_world_link",
    "A fleet detached from the world's obstacle and sensing list.",
    ({ fleet }) => fleet.world.npcs !== fleet.vehicles,
  ],
  [
    "fleet_map_link",
    "A fleet whose routing map differs from its world's map.",
    ({ fleet }) => fleet.map !== fleet.world.map,
  ],
  [
    "fleet_ego_member",
    "The driven car accidentally registered as background traffic.",
    ({ fleet }) => fleet.vehicles.includes(fleet.world.ego),
  ],
  [
    "fleet_duplicate_object",
    "The same vehicle inserted into the step list twice.",
    ({ fleet }) => new Set(fleet.vehicles).size !== fleet.vehicles.length,
  ],
  [
    "fleet_duplicate_id",
    "Duplicated vehicle IDs that would collide in replay and rendering.",
    ({ fleet }) =>
      new Set(fleet.vehicles.flatMap((n) => (identity(n?.id) ? [n.id] : []))).size !==
      fleet.vehicles.filter((n) => identity(n?.id)).length,
  ],
  [
    "fleet_clock",
    "A world time that cannot drive absolute traffic schedules.",
    ({ fleet }) => !nonnegative(fleet.world.t),
  ],
  ["fleet_tick", "A non-integer tick that would corrupt queue age.", ({ fleet }) => !count(fleet.world.tick)],
  [
    "fleet_car_target",
    "An invalid car population target before curb departure tries to rebalance it.",
    ({ fleet }) => !count(fleet.target),
  ],
  [
    "fleet_pull_sequence",
    "A corrupt pull-out sequence counter before it can produce unusable IDs.",
    ({ fleet }) => !count(fleet.pulled),
  ],
  [
    "fleet_pull_timer",
    "A non-finite pull-out countdown that can strand parked traffic.",
    ({ fleet }) => !Number.isFinite(fleet.nextPull),
  ],
  [
    "fleet_park_timer",
    "A non-finite curb-parking countdown that can disable parking attempts.",
    ({ fleet }) => !Number.isFinite(fleet.nextPark),
  ],
  [
    "fleet_emergency_timer",
    "A countdown that can suppress emergency dispatch indefinitely.",
    ({ fleet }) => !Number.isFinite(fleet.nextEmergency),
  ],
  ["fleet_bus_timer", "An invalid bus replenishment deadline.", ({ fleet }) => !nonnegative(fleet.nextBus)],
  [
    "fleet_tram_timer",
    "An invalid streetcar replenishment deadline.",
    ({ fleet }) => !nonnegative(fleet.nextStreetcar),
  ],
  [
    "fleet_school_timer",
    "An invalid school-bus replenishment deadline.",
    ({ fleet }) => !nonnegative(fleet.nextSchool),
  ],
  ["fleet_train_timer", "An invalid train recovery deadline.", ({ fleet }) => !nonnegative(fleet.nextTrain)],
  ["fleet_plow_timer", "An invalid plow replenishment deadline.", ({ fleet }) => !nonnegative(fleet.nextPlow)],
  ["fleet_bus_target", "An invalid bus population target.", ({ fleet }) => !count(fleet.busTarget)],
  ["fleet_tram_target", "An invalid streetcar population target.", ({ fleet }) => !count(fleet.streetcarTarget)],
  ["fleet_school_target", "An invalid school-bus population target.", ({ fleet }) => !count(fleet.schoolTarget)],
  ["fleet_train_target", "An invalid train population target.", ({ fleet }) => !count(fleet.trainTarget)],
  ["fleet_plow_target", "An invalid plow population target.", ({ fleet }) => !count(fleet.plowTarget)],
];

const ACTOR_CHECKS = [
  ["actor_identity", "Missing or malformed traffic identifiers.", ({ actor }) => !identity(actor.id)],
  ["actor_position", "A vehicle with an invalid rear-axle position.", ({ actor }) => !finite(actor.x, actor.y)],
  ["actor_heading", "A vehicle whose heading cannot form a collision box.", ({ actor }) => !Number.isFinite(actor.psi)],
  [
    "actor_speed",
    "A vehicle whose forward speed would poison approach estimates.",
    ({ actor }) => !Number.isFinite(actor.v),
  ],
  [
    "actor_lateral_speed",
    "A vehicle with invalid lateral speed in the tire model.",
    ({ actor }) => !Number.isFinite(actor.vy),
  ],
  ["actor_yaw_rate", "A vehicle with an invalid yaw rate.", ({ actor }) => !Number.isFinite(actor.r)],
  ["actor_steering", "A non-finite steering actuator state.", ({ actor }) => !Number.isFinite(actor.delta)],
  ["actor_pedal", "A non-finite acceleration actuator state.", ({ actor }) => !Number.isFinite(actor.a)],
  [
    "actor_signal",
    "An unsupported traffic indicator value.",
    ({ actor }) => actor.signal != null && !["left", "right"].includes(actor.signal),
  ],
  ["actor_spec", "Traffic missing the vehicle specification used in geometry.", ({ actor }) => !actor.spec],
  [
    "actor_length",
    "A vehicle length that cannot describe the body.",
    ({ actor }) => actor.spec && !positive(actor.spec.length),
  ],
  [
    "actor_width",
    "A vehicle width that cannot define lateral clearance.",
    ({ actor }) => actor.spec && !positive(actor.spec.width),
  ],
  [
    "actor_overhang",
    "A rear overhang that places the rear axle outside the usable body span.",
    ({ actor }) =>
      actor.spec && (!nonnegative(actor.spec.rearOverhang) || actor.spec.rearOverhang >= actor.spec.length),
  ],
  [
    "actor_wheelbase",
    "A path-following vehicle whose wheelbase cannot compute steering.",
    ({ actor }) => actor.path && actor.spec && !positive(actor.spec.wheelbase),
  ],
  [
    "actor_brake",
    "A path-following vehicle without a usable braking limit.",
    ({ actor }) => actor.path && actor.spec && !positive(actor.spec.maxBrake),
  ],
  ["actor_cap", "Invalid desired speed before IDM divides by it.", ({ actor }) => actor.path && !nonnegative(actor.v0)],
  [
    "actor_frozen",
    "An invalid freeze countdown that can immobilize a vehicle.",
    ({ actor }) => actor.frozen != null && !Number.isFinite(actor.frozen),
  ],
  [
    "actor_waiting",
    "A stopped-time counter that would break deadlock recovery.",
    ({ actor }) => actor.waiting != null && !nonnegative(actor.waiting),
  ],
  [
    "actor_ready",
    "A corrupt reaction timer that can bypass driver hesitation.",
    ({ actor }) => actor.ready != null && !nonnegative(actor.ready),
  ],
  [
    "actor_standoff",
    "A corrupt nose-to-nose wait timer.",
    ({ actor }) => actor.standoff != null && !nonnegative(actor.standoff),
  ],
  [
    "actor_hold",
    "A post-reverse hold that cannot expire.",
    ({ actor }) => actor.holdFor != null && !Number.isFinite(actor.holdFor),
  ],
  [
    "actor_park_wait",
    "A parking queue timer that can prevent a needed reverse.",
    ({ actor }) => actor.parkWait != null && !nonnegative(actor.parkWait),
  ],
  [
    "actor_path",
    "Missing road-path state while allowing track-only actors.",
    ({ actor }) => (!actor.path || typeof actor.path !== "object") && (!actor.rail || actor.path != null),
  ],
  ["actor_parked", "A parked vehicle that remains in the moving fleet.", ({ actor }) => actor.parked === true],
  [
    "actor_parking_conflict",
    "Simultaneous pull-in and pull-out states on one actor.",
    ({ actor }) => actor.parking && actor.pull,
  ],
  [
    "actor_lane_change_conflict",
    "A lane change still active when ordinary curb parking starts.",
    ({ actor }) => actor.parking && actor.lc,
  ],
];

const DRIVER_CHECKS = [
  [
    "driver_positive_accel",
    "A driver acceleration coefficient that would invalidate IDM.",
    ({ driver }) => !positive(driver.aMax),
  ],
  ["driver_comfort_brake", "An IDM braking parameter that would divide by zero.", ({ driver }) => !positive(driver.b)],
  ["driver_headway", "Negative or invalid driver time headway.", ({ driver }) => !nonnegative(driver.T)],
  [
    "driver_standstill_gap",
    "A driver gap that puts its standstill target inside the leader.",
    ({ driver }) => !nonnegative(driver.s0),
  ],
  [
    "driver_reaction",
    "A driver reaction interval that could make it wait forever.",
    ({ driver }) => driver.react != null && !nonnegative(driver.react),
  ],
  [
    "driver_lane_change_rate",
    "A corrupt driver passing rate that makes gap opportunities unusable.",
    ({ driver }) => !nonnegative(driver.lcRate),
  ],
];

const PATH_CHECKS = [
  [
    "path_map",
    "A path that would treat its lane and turn IDs in a different map.",
    ({ fleet, path }) => path.map !== fleet.map,
  ],
  [
    "path_points",
    "A path without enough points to project a rear axle.",
    ({ path }) => !Array.isArray(path.pts) || path.pts.length < 2,
  ],
  [
    "path_cumulative_size",
    "A cumulative distance table out of sync with the polyline size.",
    ({ path }) => !Array.isArray(path.cum) || path.cum.length !== path.pts?.length,
  ],
  ["path_cumulative_origin", "A distance table that did not rebase to zero.", ({ path }) => path.cum?.[0] !== 0],
  ["path_length", "A non-positive or non-finite NPC path length.", ({ path }) => !positive(path.length)],
  [
    "path_length_table",
    "A path length that differs from its terminal arc length.",
    ({ path }) =>
      Array.isArray(path.cum) &&
      path.cum.length === path.pts?.length &&
      Number.isFinite(path.length) &&
      path.cum.at(-1) !== path.length,
  ],
  [
    "path_progress",
    "Invalid rear-axle progress before seeking the next control.",
    ({ path }) => !Number.isFinite(path.s),
  ],
  [
    "path_progress_range",
    "Rear-axle progress outside the usable polyline span.",
    ({ path }) => Number.isFinite(path.s) && (path.s < -EPS || path.s > path.length + EPS),
  ],
  [
    "path_edges",
    "Absent edge spans while the geometry is still present.",
    ({ path }) => !Array.isArray(path.edges) || !path.edges.length,
  ],
  [
    "path_constraints_world",
    "Turn restrictions being evaluated against an abandoned world.",
    ({ fleet, path }) => path.constraintsWorld != null && path.constraintsWorld !== fleet.world,
  ],
  [
    "path_random",
    "Missing seeded successor selection before the next path extension.",
    ({ path }) => typeof path.random !== "function",
  ],
];

const POINT_CHECKS = [
  [
    "path_point_shape",
    "The malformed point in a joined traffic polyline.",
    ({ point }) => !Array.isArray(point) || point.length !== 2,
  ],
  [
    "path_point_coordinate",
    "A non-finite lane coordinate and its vertex index.",
    ({ point }) => Array.isArray(point) && point.length === 2 && !finite(...point),
  ],
  [
    "path_distance_sample",
    "The invalid sample in the path's cumulative distance table.",
    ({ distance }) => !nonnegative(distance),
  ],
  [
    "path_distance_order",
    "A backwards step in the table used by the path's binary search.",
    ({ path, index, distance }) => Number.isFinite(distance) && distance < path.cum?.[index - 1],
  ],
  [
    "path_distance_geometry",
    "The segment whose geometric length no longer matches the arc-length increment.",
    ({ path, point, index, distance }) =>
      index > 0 &&
      finitePoint(point) &&
      finitePoint(path.pts[index - 1]) &&
      finite(distance, path.cum?.[index - 1]) &&
      Math.abs(
        distance -
          path.cum[index - 1] -
          Math.hypot(point[0] - path.pts[index - 1][0], point[1] - path.pts[index - 1][1]),
      ) > EPS,
  ],
];

const EDGE_CHECKS = [
  ["path_edge_record", "An empty or malformed path edge record.", ({ edge }) => !edge || typeof edge !== "object"],
  ["path_edge_unmapped", "A path edge ID absent from the map.", ({ edge, mapped }) => edge && !mapped],
  [
    "path_edge_lane",
    "A path edge whose lane index is outside mapped bounds.",
    ({ edge, mapped }) => mapped && (!count(edge.lane) || edge.lane >= mapped.lanes),
  ],
  [
    "path_edge_lane_geometry",
    "A declared path lane for which the map has no polyline.",
    ({ fleet, edge, mapped }) =>
      mapped && count(edge.lane) && edge.lane < mapped.lanes && !fleet.map.lane(edge.id, edge.lane),
  ],
  [
    "path_edge_interval",
    "An edge interval with reversed or non-finite route coordinates.",
    ({ edge }) => edge && (!finite(edge.sStart, edge.sEnd) || edge.sEnd < edge.sStart - EPS),
  ],
  [
    "path_edge_order",
    "A break between adjacent path arc-length spans.",
    ({ edge, previous }) => edge && previous && Math.abs(edge.sStart - previous.sEnd) > EPS,
  ],
  [
    "path_edge_connection",
    "A disconnected road sequence even when the joined polyline appears continuous.",
    ({ mapped, previousMap }) => mapped && previousMap && previousMap.to !== mapped.from,
  ],
  [
    "path_edge_end",
    "A terminal road span that disagrees with the geometry endpoint.",
    ({ path, edge, index }) => edge && index === path.edges.length - 1 && Math.abs(edge.sEnd - path.length) > EPS,
  ],
  [
    "path_edge_destination",
    "A stale destination node that would query the wrong junction.",
    ({ edge, mapped }) => mapped && edge.to !== mapped.to,
  ],
  ["path_edge_limit", "A missing or nonpositive path speed limit.", ({ edge }) => edge && !positive(edge.limit)],
  [
    "path_edge_limit_mapped",
    "A path speed limit that has drifted from the mapped limit.",
    ({ edge, mapped }) => mapped && positive(edge.limit) && edge.limit !== mapped.limit,
  ],
  [
    "path_edge_control_presence",
    "A path edge that added or lost its mapped traffic control.",
    ({ edge, mapped }) => mapped && Boolean(edge.control) !== Boolean(mapped.control),
  ],
  [
    "path_edge_control_identity",
    "A control ID mismatch before a vehicle can consult another light or stop.",
    ({ edge, mapped }) => edge?.control && mapped?.control && edge.control.id !== mapped.control.id,
  ],
  [
    "path_edge_control_type",
    "An unsupported traffic control type in the path.",
    ({ edge }) => edge?.control && !["signal", "stop", "yield"].includes(edge.control.type),
  ],
  [
    "path_edge_control_point",
    "A control whose stop line cannot be projected.",
    ({ edge }) => edge?.control && !Number.isFinite(edge.control.s_line),
  ],
  [
    "path_edge_control_stale",
    "A stale stop line after a path edge's mapped control is edited.",
    ({ edge, mapped }) =>
      edge?.control &&
      mapped?.control &&
      Number.isFinite(edge.control.s_line) &&
      edge.control.s_line !== mapped.control.s_line,
  ],
];

const MANEUVER_CHECKS = [
  [
    "lane_change_direction",
    "A lane change without a signed left or right direction.",
    ({ change }) => change && ![-1, 1].includes(change.dir),
  ],
  [
    "lane_change_lane",
    "An out-of-range target lane in an active lane change.",
    ({ fleet, change }) => change && (!count(change.to) || change.to >= fleet.map.edges.get(change.edge)?.lanes),
  ],
  [
    "lane_change_edge",
    "A lane change anchored to an unmapped street.",
    ({ fleet, change }) => change && !fleet.map.edges.has(change.edge),
  ],
  [
    "lane_change_adjacency",
    "A lane change whose target is inconsistent with its signed direction and source lane.",
    ({ current, change }) =>
      change && current?.id === change.edge && count(change.to) && change.to - current.lane !== change.dir,
  ],
  [
    "lane_change_width",
    "A lane change with no usable lateral width.",
    ({ change }) => change && !positive(change.width),
  ],
  [
    "lane_change_duration",
    "A zero or invalid lane-change easing duration.",
    ({ change }) => change && !positive(change.T),
  ],
  [
    "lane_change_elapsed",
    "A lane change that cannot advance reliably from its current timer.",
    ({ change }) => change && !nonnegative(change.t),
  ],
  [
    "lane_change_cooldown",
    "A corrupt cooldown between lane changes.",
    ({ actor }) => actor.lcCooldown != null && !nonnegative(actor.lcCooldown),
  ],
  [
    "pull_offset",
    "A curb departure with an invalid lateral starting offset.",
    ({ pull }) => pull && !Number.isFinite(pull.lat),
  ],
  ["pull_duration", "A curb departure with an invalid merge duration.", ({ pull }) => pull && !positive(pull.T)],
  ["pull_elapsed", "A curb departure with invalid merge progress.", ({ pull }) => pull && !nonnegative(pull.t)],
  [
    "pull_wait",
    "A curb departure whose wait countdown can never expire.",
    ({ pull }) => pull && !Number.isFinite(pull.wait),
  ],
  [
    "backoff_distance",
    "A reverse maneuver whose remaining distance is unusable.",
    ({ backoff }) => backoff && !Number.isFinite(backoff.left),
  ],
  [
    "backoff_timer",
    "A reverse maneuver whose safety timeout cannot be measured.",
    ({ backoff }) => backoff && !nonnegative(backoff.t),
  ],
  [
    "parking_distance",
    "A curb-parking plan with an invalid longitudinal interval.",
    ({ parking }) => parking && (!finite(parking.start, parking.end) || parking.end < parking.start),
  ],
  [
    "parking_side",
    "A curb-parking plan whose target offset cannot be steered to.",
    ({ parking }) => parking && !Number.isFinite(parking.lat),
  ],
  [
    "parking_timer",
    "A curb-parking timeout that cannot be measured.",
    ({ parking }) => parking && !nonnegative(parking.t),
  ],
  [
    "parking_slot",
    "An ordinary parking maneuver detached from its indexed bay.",
    ({ fleet, parking }) => parking && !fleet.world.parked?.slots?.includes(parking.slot),
  ],
  [
    "parking_owner",
    "A parking maneuver that no longer owns its bay reservation.",
    ({ actor, parking }) => parking?.slot && parking.slot.reserved?.owner !== actor,
  ],
  [
    "parking_occupant",
    "A parking maneuver targeting an already occupied slot.",
    ({ parking }) => parking?.slot?.occupant,
  ],
];

const QUEUE_CHECKS = [
  [
    "stop_queue_key",
    "An all-way queue entry filed under the wrong vehicle object.",
    ({ actor, entry }) => entry.vehicle !== actor,
  ],
  [
    "stop_queue_junction",
    "An all-way stop queued at an unknown junction.",
    ({ fleet, entry }) => !fleet.map.nodes.has(entry.junction) && !fleet.map.intersections?.has(entry.junction),
  ],
  [
    "stop_queue_edge",
    "An all-way stop queued from a missing approach.",
    ({ fleet, entry }) => !fleet.map.edges.has(entry.edge),
  ],
  [
    "stop_queue_heading",
    "An approach heading that prevents an all-way stop tie-break.",
    ({ entry }) => !Number.isFinite(entry.heading),
  ],
  [
    "stop_queue_arrival",
    "An impossible stop arrival timestamp.",
    ({ fleet, entry }) => !nonnegative(entry.arrived) || entry.arrived > fleet.world.t,
  ],
  [
    "stop_queue_progress",
    "A non-finite stop-line observation in the all-way queue.",
    ({ entry }) => !Number.isFinite(entry.lastB),
  ],
  [
    "stop_queue_turn",
    "An all-way queue approach with an unusable planned turn.",
    ({ entry }) => !["left", "right", "straight", "uturn"].includes(entry.turn),
  ],
  [
    "stop_queue_tick",
    "An all-way entry refreshed on an impossible tick.",
    ({ fleet, entry }) => !count(entry.tick) || entry.tick > fleet.world.tick,
  ],
  [
    "stop_queue_departure",
    "A departure latch inconsistent with its arrival and the current clock.",
    ({ fleet, entry }) =>
      entry.going && (!nonnegative(entry.since) || entry.since < entry.arrived || entry.since > fleet.world.t),
  ],
];

const LEADER_CHECKS = [
  [
    "leader_gap",
    "An invalid finite-leader gap while permitting a legitimate overlap.",
    ({ leader }) => !Number.isFinite(leader.gap),
  ],
  [
    "leader_speed",
    "An invalid leader speed while permitting an oncoming projection.",
    ({ leader }) => !Number.isFinite(leader.v),
  ],
];

const MEMORY_CHECKS = [
  [
    "stop_memory_state",
    "A stop-memory state outside the stop-sign state machine.",
    ({ memory }) => !["approaching", "stopped", "completed"].includes(memory.state),
  ],
  [
    "stop_memory_time",
    "Corrupt elapsed stop time that can prevent stop completion.",
    ({ memory }) => !nonnegative(memory.stoppedFor),
  ],
  ["stop_memory_count", "A malformed counter of initiated stops.", ({ memory }) => !count(memory.stops)],
  [
    "stop_memory_control",
    "An active or completed stop with no control identity.",
    ({ memory }) => memory.state !== "approaching" && !identity(memory.controlId),
  ],
];

// Return stable issue codes with optional vehicle ID and path/vertex index. Keep references to
// World and Vehicle objects out of the report so it can be copied to a bug report as JSON.
export function inspectTraffic(fleet) {
  const issues = [];
  function check(rules, location, state) {
    for (const [code, message, violated] of rules) if (violated(state)) issues.push({ code, message, ...location });
  }

  check(FLEET_CHECKS, {}, { fleet });
  for (const [vehicle_index, actor] of fleet.vehicles.entries()) {
    const location = { vehicle_index, ...(identity(actor?.id) ? { vehicle_id: actor.id } : {}) };
    if (!actor || typeof actor !== "object") {
      issues.push({ code: "actor_record", message: "Vacant or malformed fleet entry.", ...location });
      continue;
    }
    check(ACTOR_CHECKS, location, { actor });
    if (actor.driver) check(DRIVER_CHECKS, location, { driver: actor.driver });
    if (actor.lead) check(LEADER_CHECKS, location, { leader: actor.lead });
    if (actor.stopMem) check(MEMORY_CHECKS, location, { memory: actor.stopMem });

    const path = actor.path;
    let current;
    if (path && typeof path === "object") {
      check(PATH_CHECKS, location, { fleet, actor, path });
      if (Array.isArray(path.pts))
        for (const [vertex_index, point] of path.pts.entries())
          check(
            POINT_CHECKS,
            { ...location, vertex_index },
            { path, point, index: vertex_index, distance: path.cum?.[vertex_index] },
          );
      if (Array.isArray(path.edges)) {
        for (const [edge_index, edge] of path.edges.entries()) {
          const previous = path.edges[edge_index - 1];
          check(
            EDGE_CHECKS,
            { ...location, edge_index },
            {
              fleet,
              path,
              edge,
              index: edge_index,
              mapped: fleet.map.edges.get(edge?.id),
              previous,
              previousMap: fleet.map.edges.get(previous?.id),
            },
          );
          if (!current && edge && path.s < edge.sEnd) current = edge;
        }
        current ??= path.edges.at(-1);
      }
    }
    check(MANEUVER_CHECKS, location, {
      fleet,
      actor,
      current,
      change: actor.lc,
      pull: actor.pull,
      backoff: actor.backoff,
      parking: actor.parking,
    });
  }

  for (const [actor, entry] of fleet.world.allWay?.entries ?? []) {
    const location = { ...(identity(actor?.id) ? { vehicle_id: actor.id } : {}), queue: true };
    if (entry && typeof entry === "object") check(QUEUE_CHECKS, location, { fleet, actor, entry });
    else issues.push({ code: "stop_queue_record", message: "Vacant or malformed queue entry.", ...location });
  }
  return { tick: fleet.world.tick, time_s: fleet.world.t, vehicle_count: fleet.vehicles.length, issues };
}
