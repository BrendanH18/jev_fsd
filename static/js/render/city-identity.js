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
};

// Decorative city silhouettes outside the playable map. Stylized cues, not surveyed landmarks.
export function buildCityIdentity(map, id) {
  const profile = CITY_STYLES[id], group = new THREE.Group();
  group.name = "stylized-city-silhouette";
  if (!profile?.skyline) return group;
  const [x0, , x1, y1] = map.extent;
  const material = new THREE.MeshStandardMaterial({ color: 0x6c838c, roughness: 0.82 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xb2ac9b, roughness: 0.92 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x55786e, roughness: 0.85 });
  const mesh = (geometry, x, y, z, mat = material) => { const m = new THREE.Mesh(geometry, mat); m.position.set(x, y, z); group.add(m); return m; };
  const cx = (x0 + x1) / 2, z = -y1 - 500;
  for (let i = 0; i < 18; i++) {
    const h = profile.skyline === "terraces" || profile.skyline === "roofs" || profile.skyline === "dome" ? 15 + (i * 13 % 25) : 30 + (i * 31 % 100);
    const x = cx + (i - 8.5) * 62;
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
  }
  group.userData.decorative = true;
  return group;
}
