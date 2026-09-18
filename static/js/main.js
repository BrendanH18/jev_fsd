// Bootstrap: load the map, build the scene, run the loop.

import { api, $ } from "./common.js";
import { MapData } from "./map/mapdata.js";
import { World } from "./sim/world.js";
import { SceneView } from "./render/scene.js";
import { buildRoads } from "./render/roads.js";
import { buildBuildings } from "./render/buildings.js";
import { createCarMesh, syncCar } from "./render/cars.js";
import { Minimap } from "./render/minimap.js";
import { Hud } from "./ui/hud.js";
import { Input } from "./ui/input.js";

const FIXED_DT = 1 / 60;
const loadingText = $("#loading-text");

async function boot() {
  loadingText.textContent = "Loading map…";
  const status = await api("/api/status");
  const pack = await api("/api/map");
  loadingText.textContent = `Building ${pack.edges.length} road segments…`;
  const map = new MapData(pack);
  const world = new World(map, { seed: 1 });
  const hud = new Hud();
  const view = new SceneView($("#view"), map.extent);
  const roads = buildRoads(map);
  view.scene.add(roads.group);
  view.scene.add(buildBuildings(map));
  const egoMesh = createCarMesh(0x2f7cff);
  view.scene.add(egoMesh);
  const minimap = new Minimap($("#minimap"), map, (pt) => setDestination(pt));
  hud.setMapNote(status.map.synthetic
    ? `Synthetic grid (map fetch failed: ${status.map.error})`
    : `OpenStreetMap · ${pack.edges.length} segments · ${pack.intersections.length} signals · ${pack.stops.length} stop signs`);

  const input = new Input({
    camera: () => hud.badge(`camera: ${view.toggleCamera()}`, "", 700),
    reset: () => world.resetToLane(),
    pause: () => { world.paused = !world.paused; hud.badge(world.paused ? "PAUSED" : "RESUMED", "", 700); },
  });

  async function setDestination(pt) {
    world.destination = pt;
    hud.badge("routing…", "", 600);
    // routing and autopilot arrive in the next milestone; for now just remember the click
  }

  $("#loading").hidden = true;
  hud.show();
  window.__jev = { world, map, view };  // for debugging in the console

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!world.paused) {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < 5) {
        world.stepManual(FIXED_DT, input);
        world.t += FIXED_DT;
        world.tick++;
        const road = world.roadInfo();
        world.audit(FIXED_DT, road);
        world._road = road;
        acc -= FIXED_DT;
        steps++;
      }
    }
    for (const inter of map.intersections.values()) roads.signals.set(inter.id, world.phase(inter.id));
    syncCar(egoMesh, world.ego, dt);
    view.updateCamera(world.ego, dt);
    view.render();
    minimap.draw({ ego: world.ego, npcs: world.npcs, route: world.route, destination: world.destination });
    hud.update({ ego: world.ego, road: world._road, nav: null, violations: world.violations, decision: null,
      totals: { tokens: 0, cost: 0 }, paused: world.paused });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  loadingText.textContent = `Failed to start: ${err.message}`;
});
