// Candidate paths, the route, and the destination marker, drawn as flat ribbons on the road
// (1-pixel GL lines alias badly and vanish at a distance).

import * as THREE from "three";
import { GeoBuilder } from "./geo.js";
import { beamTexture } from "./textures.js";

const COLORS = { eligible: 0x57d27f, flagged: 0xffa53d, rejected: 0xff6b6b, chosen: 0xffe066, route: 0x4cc2ff };

// Transparent, unlit, depth-tested against cars and buildings; the ground layers never write depth,
// so these always sit on top of the road.
const overlayMat = (color, opacity) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

function overlayMesh(b, material, order) {
  const mesh = new THREE.Mesh(b.toGeometry(), material);
  mesh.renderOrder = order;
  return mesh;
}

export class Overlays {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.routeMesh = null;
    this.candidateMeshes = [];
    this.mats = {
      route: overlayMat(COLORS.route, 0.22),
      eligible: overlayMat(COLORS.eligible, 0.5),
      // (the open track's flagged manoeuvres: offered, though they failed a road-rule check)
      flagged: overlayMat(COLORS.flagged, 0.5),
      rejected: overlayMat(COLORS.rejected, 0.4),
      chosen: overlayMat(COLORS.chosen, 0.9),
    };
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.7, 2.2, 48).rotateX(-Math.PI / 2),
      overlayMat(COLORS.eligible, 0.9),
    );
    ring.position.y = 0.05;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 24, 32, 1, true).translate(0, 12, 0),
      new THREE.MeshBasicMaterial({
        map: beamTexture(),
        color: COLORS.eligible,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.marker.add(ring, beam);
    this.ring = ring;
    this.marker.visible = false;
    scene.add(this.marker);
    this.showCandidates = true;
  }

  setRoute(route) {
    if (this.route === route) return;
    this.route = route;
    if (this.routeMesh) {
      this.scene.remove(this.routeMesh);
      this.routeMesh.geometry.dispose();
      this.routeMesh = null;
    }
    if (!route) {
      this.marker.visible = false;
      return;
    }
    const ribbon = new GeoBuilder();
    ribbon.ribbon(route.pts, -0.175, 0.175, 0.04);
    if (!ribbon.empty) {
      this.routeMesh = overlayMesh(ribbon, this.mats.route, 1);
      this.scene.add(this.routeMesh);
    }
    const end = route.endPoint();
    this.marker.position.set(end[0], 0, -end[1]);
    this.marker.visible = true;
  }

  setCandidates(candidates, chosenId) {
    for (const m of this.candidateMeshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.candidateMeshes = [];
    if (!this.showCandidates || !candidates) return;
    const batches = new Map();
    for (const c of candidates) {
      if (!c.trace || c.trace.length < 2) continue;
      const status = c.id === chosenId ? "chosen" : c.flagged ? "flagged" : c.eligible ? "eligible" : "rejected";
      if (!batches.has(status)) batches.set(status, new GeoBuilder());
      const halfWidth = status === "chosen" ? 0.16 : 0.06;
      batches.get(status).ribbon(c.trace, -halfWidth, halfWidth, 0.04);
    }
    for (const [status, batch] of batches) {
      if (batch.empty) continue;
      const mesh = overlayMesh(batch, this.mats[status], status === "chosen" ? 3 : 2);
      this.group.add(mesh);
      this.candidateMeshes.push(mesh);
    }
  }

  tick(t) {
    if (this.marker.visible) this.ring.scale.setScalar(1 + 0.12 * Math.sin(t * 4));
  }
}
