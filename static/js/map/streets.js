// A street's cross-section beyond its asphalt, shared by the renderer (which draws it) and the
// pedestrians (who walk on it). Lateral offsets are measured from the edge's centerline, right of
// travel positive, like the lanes.

export const GUTTER = 0.3;         // painted asphalt beyond the outermost lane
export const CURB = 0.22;
// boulevard (grass between curb and sidewalk) and sidewalk widths, m
export const STREET = {
  residential: [1.8, 1.5], living_street: [1.2, 1.5], tertiary: [1.2, 1.9], unclassified: [1.2, 1.6],
  secondary: [0.0, 2.6], primary: [0.0, 3.2],
};
export const streetOf = (e) => STREET[e.cls.replace("_link", "")] || [1.0, 1.8];

// Center of the sidewalk on the right (side = 1) or left (side = -1) of the edge.
export function sidewalkOffset(e, side) {
  const [blvd, walk] = streetOf(e);
  const reach = GUTTER + CURB + blvd + walk / 2;
  return side > 0 ? e.asphalt[1] + reach : e.asphalt[0] - reach;
}
