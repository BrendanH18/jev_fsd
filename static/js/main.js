// Bootstrap: load the map, build the scene, wire the UI, run the loop.

import { api, $ } from "./common.js";
import { MapData } from "./map/mapdata.js";
import { Route } from "./map/route.js";
import { World } from "./sim/world.js";
import { SceneView } from "./render/scene.js";
import { buildRoads } from "./render/roads.js";
import { buildBuildings } from "./render/buildings.js";
import { createCarMesh, syncCar } from "./render/cars.js";
import { Minimap } from "./render/minimap.js";
import { Overlays } from "./render/overlays.js";
import { Hud } from "./ui/hud.js";
import { Input } from "./ui/input.js";
import { Panel } from "./ui/panel.js";
import { Autopilot } from "./brain/brain.js";
import { NpcFleet } from "./sim/npc.js";

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
  const overlays = new Overlays(view.scene);
  const fleet = new NpcFleet(world, { count: status.npcs, seed: 7 });
  const npcMeshes = new Map();
  for (const n of fleet.vehicles) { const m = createCarMesh(n.color); view.scene.add(m); npcMeshes.set(n.id, m); }

  const autopilot = new Autopilot(world, {
    onDecision: (d) => { hud.recordDecision(d.meta); panel.set(d); overlays.setCandidates(d.candidates, d.chosenId); },
    onEvent: (ev) => {
      if (ev.type === "arrived") { hud.badge("ARRIVED", "stop", 1500); hud.setAutopilot(false); overlays.setRoute(null); overlays.setCandidates(null); }
      else if (ev.type === "safety") hud.badge("SAFETY BRAKE", "safety", 700);
      else if (ev.type === "fallback") hud.badge(`fallback: ${ev.error}`, "safety", 1800);
      else if (ev.type === "reroute") { hud.badge(`re-routed (${ev.count} options)`, "", 1000); overlays.setRoute(world.route); }
      else if (ev.type === "deadlock") hud.badge("DEADLOCK: creeping", "safety", 1200);
      else if (ev.type === "error") hud.badge(ev.error, "", 1500);
    },
  });
  if (!status.configured) autopilot.setBrain("rules");
  hud.setBrain(autopilot.brainName);
  const panel = new Panel(autopilot, hud);
  panel.onShowCandidates = (on) => { overlays.showCandidates = on; if (!on) overlays.setCandidates(null); };
  const minimap = new Minimap($("#minimap"), map, (pt) => setDestination(pt));
  hud.setMapNote(status.map.synthetic
    ? `Synthetic grid (map fetch failed: ${status.map.error})`
    : `Map data © OpenStreetMap contributors (ODbL) · ${pack.edges.length} segments · ${pack.intersections.length} signals · ${pack.stops.length} stop signs${status.configured ? "" : " · no API key: Jev brain unavailable"}`);

  function toggleAutopilot() {
    if (!autopilot.enabled && !world.route) { hud.badge("set a destination first (click the minimap)", "", 1500); return; }
    autopilot.setEnabled(!autopilot.enabled);
    hud.setAutopilot(autopilot.enabled);
    hud.badge(autopilot.enabled ? `AUTOPILOT: ${autopilot.brainName.toUpperCase()}` : "MANUAL", "", 900);
    if (!autopilot.enabled) overlays.setCandidates(null);
  }
  hud.onAutopilotClick(toggleAutopilot);
  hud.onBrainChange((name) => {
    if (name === "jev" && !status.configured) { hud.badge("no TYPESAFE_API_KEY on the server", "safety", 1800); hud.setBrain("rules"); return; }
    autopilot.setBrain(name);
    hud.badge(`brain: ${name}`, "", 800);
  });
  const input = new Input({
    autopilot: toggleAutopilot,
    camera: () => hud.badge(`camera: ${view.toggleCamera()}`, "", 700),
    reset: () => { world.resetToLane(); autopilot.bumpEpoch(); autopilot.executing = null; },
    pause: () => { world.paused = !world.paused; hud.badge(world.paused ? "PAUSED" : "RESUMED", "", 700); },
    brain1: () => { hud.setBrain("jev"); hud.el.brain.dispatchEvent(new Event("change")); },
    brain2: () => { hud.setBrain("rules"); hud.el.brain.dispatchEvent(new Event("change")); },
  });

  async function setDestination(pt) {
    try {
      const res = await api("/api/route", { from: { x: world.ego.x, y: world.ego.y, heading: world.ego.psi }, to: { x: pt[0], y: pt[1] }, k: 1 });
      if (!res.routes.length) { hud.badge("no route to that point", "safety", 1500); return; }
      world.destination = pt;
      world.route = new Route(res.routes[0], map);
      overlays.setRoute(world.route);
      autopilot.bumpEpoch();
      autopilot.executing = null;
      hud.badge(`route: ${world.route.summary}`, "", 2200);
      if (!autopilot.enabled) toggleAutopilot();
    } catch (err) {
      hud.badge(`routing failed: ${err.message}`, "safety", 2000);
    }
  }

  $("#loading").hidden = true;
  hud.show();
  window.__jev = { world, map, view, autopilot, fleet, setDestination, overlays };

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!world.paused) {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < 5) {
        if (autopilot.enabled && input.anyDriving) { toggleAutopilot(); }
        if (autopilot.enabled) autopilot.step(FIXED_DT, performance.now());
        else world.stepManual(FIXED_DT, input);
        fleet.step(FIXED_DT);
        world.t += FIXED_DT;
        world.tick++;
        const road = world.roadInfo();
        world.audit(FIXED_DT, road);
        world._road = road;
        for (const ev of world.events) {
          if (ev.type === "collision") { hud.flash(); hud.badge("COLLISION", "", 1200); }
          else if (ev.type === "red_light") hud.badge("RAN A RED LIGHT", "", 1500);
          else if (ev.type === "stop_sign") hud.badge("RAN A STOP SIGN", "", 1500);
        }
        acc -= FIXED_DT;
        steps++;
      }
    }
    for (const inter of map.intersections.values()) roads.signals.set(inter.id, world.phase(inter.id));
    syncCar(egoMesh, world.ego, dt);
    for (const n of fleet.vehicles) syncCar(npcMeshes.get(n.id), n, dt);
    overlays.tick(world.t);
    view.updateCamera(world.ego, dt);
    view.render();
    minimap.draw({ ego: world.ego, npcs: fleet.vehicles, route: world.route, destination: world.destination });
    const snap = autopilot.enabled ? autopilot.snap : null;
    hud.update({ ego: world.ego, road: world._road, nav: snap ? snap.nav : null, violations: world.violations,
      decision: autopilot.lastDecision, totals: autopilot.totals, paused: world.paused });
    panel.render(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  loadingText.textContent = `Failed to start: ${err.message}`;
});
