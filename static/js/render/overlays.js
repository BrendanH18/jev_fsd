// Candidate paths, the route line, and the destination marker.

import * as THREE from "three";

const COLORS = { eligible: 0x57d27f, rejected: 0xff6b6b, chosen: 0xffe066, route: 0x4cc2ff };

export class Overlays {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.routeLine = null;
    this.candidateLines = [];
    this.marker = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.25, 8, 32), new THREE.MeshBasicMaterial({ color: COLORS.eligible }));
    this.marker.rotation.x = Math.PI / 2;
    this.marker.visible = false;
    scene.add(this.marker);
    this.showCandidates = true;
  }

  setRoute(route) {
    if (this.routeLine) { this.scene.remove(this.routeLine); this.routeLine.geometry.dispose(); this.routeLine = null; }
    if (!route) { this.marker.visible = false; return; }
    const pts = route.pts.map(([x, y]) => new THREE.Vector3(x, 0.12, -y));
    this.routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COLORS.route }));
    this.scene.add(this.routeLine);
    const end = route.endPoint();
    this.marker.position.set(end[0], 0.3, -end[1]);
    this.marker.visible = true;
  }

  setCandidates(candidates, chosenId) {
    for (const l of this.candidateLines) { this.group.remove(l); l.geometry.dispose(); }
    this.candidateLines = [];
    if (!this.showCandidates || !candidates) return;
    const ordered = [...candidates].sort((a, b) => (a.id === chosenId) - (b.id === chosenId));
    for (const c of ordered) {
      if (!c.trace) continue;
      const chosen = c.id === chosenId;
      const color = chosen ? COLORS.chosen : c.eligible ? COLORS.eligible : COLORS.rejected;
      const z = chosen ? 0.3 : 0.2;
      const pts = c.trace.map(([x, y]) => new THREE.Vector3(x, z, -y));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: !chosen, opacity: chosen ? 1 : 0.55 }));
      this.group.add(line);
      this.candidateLines.push(line);
    }
  }

  tick(t) {
    if (this.marker.visible) this.marker.scale.setScalar(1 + 0.15 * Math.sin(t * 4));
  }
}
