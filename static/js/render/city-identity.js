import * as THREE from "three";

export const CITY_STYLES = {
  kitsilano: { city: "Vancouver", accent: "#6ec7a1", houses: [0xc6d3c0, 0xddd2b7, 0xa6bdbe, 0xe5e1d1] },
  mount_pleasant: { city: "Vancouver", accent: "#e0a778", houses: [0xcab39e, 0xa9b9ae, 0xd6ccc0, 0xb18f78] },
  victoria: { city: "Victoria", accent: "#deb988", houses: [0xd9c9a9, 0xb7c1ad, 0xc6a591, 0xe0d8c7], skyline: "dome" },
  toronto: { city: "Toronto", accent: "#8cadde", houses: [0xad8270, 0xc3b1a1, 0xa69384, 0xd9c9b5], skyline: "needle" },
  montreal: { city: "Montréal", accent: "#c29be2", houses: [0xb7aea7, 0xb99583, 0xd7cbbd, 0x9b9390], skyline: "terraces" },
  calgary: { city: "Calgary", accent: "#dc927d", houses: [0xc6b89e, 0xd5cbbb, 0xb6aca3, 0xc9a18a], skyline: "towers" },
  ottawa: { city: "Ottawa", accent: "#8ebbc0", houses: [0xb69f86, 0xb1b8a4, 0xd2c4af, 0xc1a089], skyline: "spire" },
  quebec_city: { city: "Québec City", accent: "#c4b27f", houses: [0xd9cda9, 0xbfc1b3, 0xc8a98c, 0xe1d9c4], skyline: "roofs" },
  halifax: { city: "Halifax", accent: "#e3928a", houses: [0xc79a8e, 0xd8c79c, 0x9fb3bf, 0xe2dccd], skyline: "citadel" },
  winnipeg: { city: "Winnipeg", accent: "#d6c26f", houses: [0xa8775f, 0xc8b79a, 0x9a6a58, 0xd7cdb8], skyline: "prairie" },
  edmonton: { city: "Edmonton", accent: "#9cc77c", houses: [0xb5866c, 0xcfc4ad, 0xa9b19a, 0xd9cfbd], skyline: "valley" },
  saskatoon: { city: "Saskatoon", accent: "#9b93dc", houses: [0xc9b79a, 0xb7a08a, 0xd4cfc0, 0xa9b3b8], skyline: "bridges" },
};

// Height of the i-th of 18 background blocks: low roofs for historic towns, mid-rise for the
// prairie downtowns, towers for the big skylines.
function blockHeight(skyline, i) {
  if (["terraces", "roofs", "dome", "citadel"].includes(skyline)) return 15 + (i * 13 % 25);
  if (skyline === "prairie" || skyline === "bridges") return 18 + (i * 23 % 55);
  return 30 + (i * 31 % 100);
}

// Decorative city silhouettes outside the playable map. Stylized cues, not surveyed landmarks.
export function buildCityIdentity(map, id) {
  const profile = CITY_STYLES[id], group = new THREE.Group();
  group.name = "stylized-city-silhouette";
  if (!profile?.skyline) return group;
  const [x0, , x1, y1] = map.extent;
  const material = new THREE.MeshStandardMaterial({ color: 0x6c838c, roughness: 0.82 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xb2ac9b, roughness: 0.92 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x55786e, roughness: 0.85 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x6f8a5a, roughness: 0.95 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb4c0, roughness: 0.25, metalness: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4d5559, roughness: 0.7, metalness: 0.3 });
  const mesh = (geometry, x, y, z, mat = material) => { const m = new THREE.Mesh(geometry, mat); m.position.set(x, y, z); group.add(m); return m; };
  const cx = (x0 + x1) / 2, z = -y1 - 500;
  for (let i = 0; i < 18; i++) {
    const h = blockHeight(profile.skyline, i);
    const x = cx + (i - 8.5) * 62;
    if (profile.skyline === "citadel" && Math.abs(i - 8.5) < 3) continue;   // the hill stands clear of the town
    mesh(new THREE.BoxGeometry(35, h, 32), x, h / 2, z - Math.sin(i) * 60, profile.skyline === "terraces" ? stone : material);
    if (profile.skyline === "roofs") mesh(new THREE.ConeGeometry(26, 22, 4), x, h + 11, z - Math.sin(i) * 60, roof).rotation.y = Math.PI / 4;
  }
  if (profile.skyline === "needle") {
    mesh(new THREE.CylinderGeometry(3, 8, 180, 8), cx, 90, z + 40);
    mesh(new THREE.CylinderGeometry(18, 14, 12, 16), cx, 156, z + 40);
    mesh(new THREE.ConeGeometry(2, 35, 8), cx, 197, z + 40);
  } else if (profile.skyline === "dome") {
    mesh(new THREE.BoxGeometry(120, 25, 50), cx, 12.5, z + 40, stone);
    mesh(new THREE.SphereGeometry(23, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), cx, 25, z + 40, roof);
  } else if (profile.skyline === "spire") {
    mesh(new THREE.BoxGeometry(22, 75, 22), cx, 37.5, z + 40, stone);
    mesh(new THREE.ConeGeometry(18, 42, 4), cx, 96, z + 40, roof).rotation.y = Math.PI / 4;
  } else if (profile.skyline === "citadel") {
    // a grassy drumlin with a low star fort and a small clock tower on its slope
    mesh(new THREE.SphereGeometry(150, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), cx, 0, z + 60, grass).scale.y = 0.22;
    mesh(new THREE.CylinderGeometry(70, 76, 9, 5), cx, 35, z + 60, stone);
    mesh(new THREE.BoxGeometry(9, 22, 9), cx + 70, 33, z + 150, stone);
    mesh(new THREE.CylinderGeometry(4, 6, 8, 8), cx + 70, 48, z + 150, roof);
  } else if (profile.skyline === "prairie") {
    // a slender glass tower rising out of a low stone mass, alone over a flat skyline
    mesh(new THREE.BoxGeometry(110, 22, 60), cx + 180, 11, z + 60, stone).rotation.y = 0.35;
    mesh(new THREE.CylinderGeometry(2.5, 7, 100, 8), cx + 180, 72, z + 60, glass);
  } else if (profile.skyline === "valley") {
    // a long steel truss bridge on tall piers across the valley below the towers
    const span = 6 * 62 + 120, deck = 46;
    mesh(new THREE.BoxGeometry(span, 7, 9), cx, deck, z + 30, steel);
    for (let k = -3; k <= 3; k++) mesh(new THREE.BoxGeometry(5, deck, 6), cx + k * span / 7, deck / 2, z + 30, steel);
    mesh(new THREE.BoxGeometry(90, 30, 50), cx - 260, 15, z + 70, stone);
    mesh(new THREE.SphereGeometry(18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), cx - 260, 30, z + 70, roof);
  } else if (profile.skyline === "bridges") {
    // a riverside château hotel with steep copper roofs, and an arched bridge on the river
    mesh(new THREE.BoxGeometry(60, 34, 30), cx - 200, 17, z + 70, stone);
    for (const dx of [-22, 0, 22]) mesh(new THREE.ConeGeometry(dx ? 12 : 16, dx ? 22 : 30, 4), cx - 200 + dx, dx ? 45 : 49, z + 70, roof).rotation.y = Math.PI / 4;
    const arch = new THREE.TorusGeometry(40, 2.5, 6, 18, Math.PI);
    mesh(new THREE.BoxGeometry(5 * 80 + 20, 3, 12), cx + 120, 22, z + 20, stone);
    for (let k = -2; k <= 2; k++) mesh(arch, cx + 120 + k * 80, -18, z + 20, stone);
  }
  group.userData.decorative = true;
  return group;
}
