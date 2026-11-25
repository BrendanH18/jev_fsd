// Convert metres along the mapped centreline to the joined NPC path's frame.
// Short mapped edges use a one-metre denominator, as in traffic's control checks.
export function pathLine(edge, mappedLength, line) {
  return edge.sStart + (line / Math.max(1, mappedLength)) * (edge.sEnd - edge.sStart);
}

// Stable first match with one random draw, even when the chosen lane is the only candidate.
export function pickSpawnLane(lanes, totalLength, random) {
  let pick = random() * totalLength;
  for (const lane of lanes) {
    pick -= lane.length;
    if (pick <= 0) return lane;
  }
  return lanes[0];
}

// Common to the signed and unsigned crossing checks. An explicit zero headway is meaningful.
export function crossingGap(driver) {
  return driver ? 3.2 + driver.T * 1.7 : 5;
}

// Relative closing speeds are intentionally asymmetric. A driver leaves more time to a vehicle
// approaching from behind than to one it is itself catching.
export function laneChangeGap(ds, speed, otherSpeed) {
  return ds >= 0 ? 8 + Math.max(0, speed - otherSpeed) * 2 : 8 + Math.max(0, otherSpeed - speed) * 2.5;
}

// Axle-to-axle spacing occupied by the two actual bodies, in their order along the lane.
export function laneChangeBodyGap(ds, self, other) {
  return ds >= 0
    ? self.length - self.rearOverhang + other.rearOverhang
    : other.length - other.rearOverhang + self.rearOverhang;
}
