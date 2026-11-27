// The diagonal crosswalks of scramble crossings (sim/signals.js), painted only where the world runs
// them: from each corner where people wait (the crowd's crosswalk ends, sim/pedestrians.js) straight
// across the junction to the farthest one, as continental bars 3 m long across the way they walk.
import * as THREE from "three";
import { GeoBuilder } from "./geo.js";
import { LAYER } from "./scene.js";
import { addGroundMesh, paintMaterial } from "./roads.js";

export function buildScrambleMarkings(map, crowd) {
  const group = new THREE.Group(),
    white = new GeoBuilder(),
    done = new Set();
  for (const id of map.scrambles || []) {
    const inter = map.intersections.get(id);
    if (!inter) continue;
    for (const node of map.junctionNodes(inter)) {
      const info = crowd?.legsAt?.get(node);
      // (only this signal's own junction: junctionNodes also names where its approaches start)
      if (!info || info.list.length < 3 || info.inter !== inter) continue;
      for (const here of info.list)
        for (const side of [1, -1]) {
          const from = here.ends[side];
          let far = null;
          for (const l of info.list)
            if (l !== here)
              for (const sd of [1, -1]) {
                const d = Math.hypot(l.ends[sd][0] - from[0], l.ends[sd][1] - from[1]);
                if (!far || d > far.d) far = { to: l.ends[sd], d };
              }
          if (!far) continue;
          const key = [from, far.to]
            .map((p) => p.map((v) => v.toFixed(1)).join(","))
            .sort()
            .join("|");
          if (done.has(key)) continue;
          done.add(key);
          const h = Math.atan2(far.to[1] - from[1], far.to[0] - from[0]),
            across = h + Math.PI / 2,
            fx = Math.cos(h),
            fy = Math.sin(h);
          for (let u = 1.2; u < far.d - 1.0; u += 1.2)
            white.rect(from[0] + fx * u, from[1] + fy * u, across, 3.0, 0.55);
        }
    }
  }
  if (!white.empty) addGroundMesh(group, white, paintMaterial(0xe6e6df), LAYER.marking);
  return group;
}

export const view = {
  mount: {
    order: 16,
    run({ scene, world, map }) {
      if (!world.scrambles || !map.scrambles.size) return null;
      scene.add(buildScrambleMarkings(map, world.crowd));
      return true;
    },
  },
};
