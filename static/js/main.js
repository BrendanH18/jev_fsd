// Bootstrap: load the map, build the scene, wire the UI, run the loop.

import { api, $ } from "./common.js";
import { MapData } from "./map/mapdata.js";
import { Route } from "./map/route.js";
import { World } from "./sim/world.js";
import { SceneView } from "./render/scene.js";
import { buildRoads } from "./render/roads.js";
import { buildBuildings } from "./render/buildings.js";
import { buildTrees } from "./render/trees.js";
import { createCarMesh, syncCar, buildParkedCars, createBikeMesh, syncBike, addHeadlights, syncCarLights, hideParkedCar, createDoorMesh, syncDoor } from "./render/cars.js";
import { createPersonMesh, syncPerson } from "./render/people.js";
import { Minimap } from "./render/minimap.js";
import { Overlays } from "./render/overlays.js";
import { Hud } from "./ui/hud.js";
import { Input } from "./ui/input.js";
import { Panel } from "./ui/panel.js";
import { Autopilot } from "./brain/brain.js";
import { NpcFleet } from "./sim/npc.js";
import { stepWorld } from "./sim/step.js";
import { setupScenario } from "./bench/runner.js";
import { WeatherView } from "./render/weather.js";
import { setWeather } from "./sim/weather.js";
import { pedPhase } from "./sim/signals.js";
import { atmosphereFor, parseHour, TIME_PRESETS, lighting } from "./render/atmosphere.js";
import { buildSurroundings, tintSurroundings, inVancouver } from "./render/surroundings.js";
import { DriveScore, saveDrive } from "./sim/drive-score.js";
import { DriveReport } from "./ui/drive-report.js";
import { Explorer } from "./ui/explorer.js";
import { buildStreetSigns } from "./render/signs.js";
import { DriveAudio } from "./ui/drive-audio.js";
import { Cockpit } from "./ui/cockpit.js";
import { capturePose, interpolatePose } from "./sim/interpolate.js";

const FIXED_DT = 1 / 60;
const loadingText = $("#loading-text");

async function boot() {
  loadingText.textContent = "Loading map…";
  const params = new URLSearchParams(location.search);
  const mapQuery = params.get("bbox") || params.get("map") || "";
  const query = mapQuery ? `?bbox=${encodeURIComponent(mapQuery)}` : "";
  const status = await api(`/api/status${query}`);
  const pack = await api(`/api/map${query}`);
  loadingText.textContent = `Building ${pack.edges.length} road segments…`;
  const map = new MapData(pack);
  const replay = readReplay();
  const hud = new Hud();
  $("#current-city").textContent = status.map.synthetic ? "Practice grid" : status.map.label;
  const quality = params.get("quality") || localStorage.getItem("jev-fsd-quality") || "high";
  let hour = parseHour(params.get("time"));
  const view = new SceneView($("#view"), map.extent, { quality });
  hud.setQuality(view.quality);
  const roads = buildRoads(map);
  view.scene.add(roads.group);
  const signs = buildStreetSigns(map);
  view.addScenery(signs);
  const buildings = buildBuildings(map);
  view.scene.add(buildings);
  view.addScenery(buildTrees(map, roads, buildings.userData.index));
  view.scene.add(buildSurroundings(map));
  view.backdrop.visible = inVancouver(pack.origin);   // the North Shore mountains
  const egoMesh = createCarMesh(0x1f5fd6, "ego");
  addHeadlights(egoMesh);
  view.scene.add(egoMesh);
  const overlays = new Overlays(view.scene);
  let drive = null, arrivalPending = false, driveReport;
  const callbacks = {
    onDecision: (d) => { hud.recordDecision(d.meta); panel.set(d); overlays.setCandidates(d.candidates, d.chosenId); },
    onEvent: (ev) => {
      if (ev.type === "arrived") { arrivalPending = true; hud.badge("ARRIVED", "stop", 1500); hud.setAutopilot(false); overlays.setRoute(null); overlays.setCandidates(null); }
      else if (ev.type === "safety") hud.badge("SAFETY BRAKE", "safety", 700);
      else if (ev.type === "fallback") hud.badge(`fallback: ${ev.error}`, "safety", 1800);
      else if (ev.type === "reroute") { hud.badge(`re-routed (${ev.count} options)`, "", 1000); overlays.setRoute(world.route); }
      else if (ev.type === "deadlock") hud.badge("DEADLOCK: creeping", "safety", 1200);
      else if (ev.type === "error") hud.badge(ev.error, "", 1500);
    },
  };
  // A benchmark scenario opened with "watch" replays with the same start, route, and traffic seed.
  let world, fleet, autopilot;
  if (replay) {
    ({ world, fleet, autopilot } = setupScenario(map, replay.scenario, { brain: status.configured ? replay.brain : "rules", npcs: replay.npcs, weather: replay.weather || "dry", ...callbacks }));
  } else {
    // fewer people out on foot late in the evening and at night
    const pedestrians = hour >= 22 || hour < 6 ? 18 : hour >= 20 ? 36 : undefined;
    world = new World(map, { seed: 1, weather: params.get("weather") || "dry", pedestrians });
    fleet = new NpcFleet(world, { count: status.npcs, seed: 7 });
    autopilot = new Autopilot(world, callbacks);
  }
  view.addScenery(buildParkedCars(world.parked.list));
  const pedMeshes = world.crowd.list.map((p) => { const m = createPersonMesh(p.look); view.scene.add(m); return m; });
  const npcMeshes = new Map();
  const parkedMeshes = new Map();
  const doorMeshes = new Map();
  const previousCars = new Map(), previousPeople = [], previousEgo = {};
  // traffic changes as parked cars pull out and far-off cars leave: keep a mesh per vehicle
  const syncFleetMeshes = () => {
    const ids = new Set();
    for (const n of fleet.vehicles) {
      ids.add(n.id);
      if (npcMeshes.has(n.id)) continue;
      const m = n.kind === "bike" ? createBikeMesh(n.color, n.id) : createCarMesh(n.color, n.id, n.style ?? null);
      view.scene.add(m);
      npcMeshes.set(n.id, m);
    }
    for (const [id, m] of npcMeshes) if (!ids.has(id)) { view.scene.remove(m); npcMeshes.delete(id); previousCars.delete(id); }
    for (const car of world.parked.added.splice(0)) {
      const m = createCarMesh(car.color, car.id, car.style ?? null);
      syncCar(m, car);
      view.scene.add(m);
      parkedMeshes.set(car.id, m);
    }
    for (const car of world.parked.removed.splice(0)) {
      hideParkedCar(car);
      if (parkedMeshes.has(car.id)) { view.scene.remove(parkedMeshes.get(car.id)); parkedMeshes.delete(car.id); }
    }
    const doors = new Set();
    for (const door of world.parked.activeDoors) {
      doors.add(door.id);
      if (!doorMeshes.has(door.id)) { const m = createDoorMesh(door.owner); view.scene.add(m); doorMeshes.set(door.id, m); }
      syncDoor(doorMeshes.get(door.id), door);
    }
    for (const [id, m] of doorMeshes) if (!doors.has(id)) { view.scene.remove(m); m.traverse((o) => o.geometry?.dispose()); doorMeshes.delete(id); }
  };
  syncFleetMeshes();
  if (!status.configured) autopilot.setBrain("rules");
  hud.setBrain(autopilot.brainName);
  const panel = new Panel(autopilot, hud);
  panel.onShowCandidates = (on) => { overlays.showCandidates = on; if (!on) overlays.setCandidates(null); };
  const weatherView = new WeatherView(view);
  const applySky = () => { const a = atmosphereFor(hour, world.weather, { latitude: pack.origin.lat, longitude: pack.origin.lon, utcOffset: status.map.utc_offset ?? -7 }); view.setAtmosphere(a); tintSurroundings(a); };
  weatherView.apply(world.weather);
  applySky();
  hud.setWeather(world.weather);
  hud.setTime(nearestPreset(hour));
  hud.onWeatherChange((name) => { world.weather = setWeather(name).name; weatherView.apply(world.weather); applySky(); hud.badge(`weather: ${name}`, "", 800); });
  hud.onTimeChange((name) => { hour = parseHour(name); applySky(); hud.badge(`time: ${formatHour(hour)}`, "", 800); });
  hud.onQualityChange((name) => { localStorage.setItem("jev-fsd-quality", view.setQuality(name)); hud.badge(`graphics: ${view.quality}`, "", 800); });
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
  const audio = new DriveAudio($("#drive-sound"));
  const cockpit = new Cockpit();
  const switchCamera = () => { const mode = view.toggleCamera(); $("#camera-view").textContent = `View: ${mode}`; hud.badge(`camera: ${mode}`, "", 700); };
  $("#camera-view").addEventListener("click", switchCamera);
  $("#camera-motion").addEventListener("change", ev => { view.cameraMotion = ev.target.checked; });
  let manualSignal = null;
  function signal(side) {
    if (autopilot.enabled) return;
    world.ego.signal = world.ego.signal === side ? null : side;
    manualSignal = world.ego.signal ? { t: world.t, heading: world.ego.psi } : null;
  }
  const input = new Input({
    autopilot: toggleAutopilot,
    camera: switchCamera,
    signalLeft: () => signal("left"), signalRight: () => signal("right"), horn: () => audio.horn(),
    reset: () => { drive?.reset(); world.resetToLane(); autopilot.bumpEpoch(); autopilot.executing = null; },
    pause: () => { world.paused = !world.paused; hud.badge(world.paused ? "PAUSED" : "RESUMED", "", 700); },
    brain1: () => { hud.setBrain("jev"); hud.el.brain.dispatchEvent(new Event("change")); },
    brain2: () => { hud.setBrain("rules"); hud.el.brain.dispatchEvent(new Event("change")); },
  });

  let pausedBeforeReport = false;
  driveReport = new DriveReport({
    onFinish: () => finishDrive("finished"),
    onNewDrive: () => explorer.open(),
    onOpen: () => { pausedBeforeReport = world.paused; world.paused = true; },
    onClose: () => { world.paused = pausedBeforeReport; },
  });
  function startDrive(title, route = null) {
    if (drive && !drive.finished && drive.distance > 1) saveDrive(drive.finish("replaced"));
    drive = new DriveScore(world, { title, route, map: pack.synthetic ? "Practice grid" : status.map.label, driver: autopilot.enabled ? autopilot.brainName : "manual" });
    arrivalPending = false;
    driveReport.lastUpdate = -Infinity;
    driveReport.update(drive);
  }
  function finishDrive(reason) {
    if (!drive || drive.finished) return;
    if (autopilot.enabled) { autopilot.setEnabled(false); hud.setAutopilot(false); overlays.setCandidates(null); }
    const report = drive.finish(reason);
    const saved = saveDrive(report);
    driveReport.lastUpdate = -Infinity; driveReport.update(drive);
    driveReport.show(report, saved);
  }

  let pausedBeforeExplorer = false;
  const explorer = new Explorer({
    map: status.map,
    getStart: () => ({ x: world.ego.x, y: world.ego.y, heading: world.ego.psi }),
    onOpen: () => { pausedBeforeExplorer = world.paused; world.paused = true; },
    onClose: () => { world.paused = pausedBeforeExplorer; },
    onDrive: (d) => applyRoute(d.route, d.destination, d.title),
    onMap: (id) => {
      if (drive && !drive.finished && drive.distance > 1) saveDrive(drive.finish("map changed"));
      autopilot.setEnabled(false);
      const next = new URL(location.href);
      next.searchParams.delete("bbox"); next.searchParams.delete("replay");
      next.searchParams.set("map", id); next.searchParams.set("explore", "1");
      next.searchParams.set("weather", world.weather); next.searchParams.set("time", formatHour(hour));
      next.searchParams.set("quality", view.quality);
      location.assign(next);
    },
  });

  function applyRoute(data, pt, title) {
    world.destination = pt;
    world.route = new Route(data, map);
    overlays.setRoute(world.route);
    autopilot.bumpEpoch(); autopilot.executing = null;
    hud.badge(`route: ${world.route.summary}`, "", 2200);
    if (!autopilot.enabled) toggleAutopilot();
    startDrive(title || `Drive to ${map.nearestLane(...pt)?.lane.edgeRef.name || "your destination"}`, world.route);
  }

  async function setDestination(pt) {
    try {
      const res = await api("/api/route", { bbox: status.map.bbox.join(","), from: { x: world.ego.x, y: world.ego.y, heading: world.ego.psi }, to: { x: pt[0], y: pt[1] }, k: 1 });
      if (!res.routes.length) { hud.badge("no route to that point", "safety", 1500); return; }
      applyRoute(res.routes[0], res.routes[0].polyline.at(-1));
    } catch (err) {
      hud.badge(`routing failed: ${err.message}`, "safety", 2000);
    }
  }

  $("#loading").hidden = true;
  hud.show();
  if (replay) {
    overlays.setRoute(world.route);
    hud.setAutopilot(true);
    hud.badge(`REPLAY ${replay.scenario.id}: ${autopilot.brainName.toUpperCase()}`, "", 2200);
    startDrive(`Replay ${replay.scenario.id}`, world.route);
  }
  window.__jev = { world, map, view, autopilot, fleet, setDestination, overlays, signs, audio, cockpit, driveReport, explorer, get drive() { return drive; }, finishDrive, setTime: (h) => { hour = parseHour(h); applySky(); } };
  if (params.has("explore")) explorer.open();

  let last = performance.now();
  let acc = 0;
  let indicatorLit = false;
  function frame(now) {
    // never negative: headless runs advance the clock by hand, ahead of requestAnimationFrame
    const dt = Math.max(0, Math.min(0.25, (now - last) / 1000));
    last = now;
    if (!world.paused) {
      acc = Math.min(acc + dt, FIXED_DT * 5);
      let steps = 0;
      while (acc >= FIXED_DT && steps < 5) {
        if (input.anyDriving && (!drive || drive.finished)) startDrive("Free drive");
        if (autopilot.enabled && input.anyDriving) { toggleAutopilot(); }
        if (drive && !drive.finished && !arrivalPending) {
          const driver = autopilot.enabled ? autopilot.brainName : "manual";
          if (driver !== drive.driver) drive.driver = "mixed";
        }
        capturePose(world.ego, previousEgo);
        for (const car of fleet.vehicles) previousCars.set(car.id, capturePose(car, previousCars.get(car.id)));
        world.crowd.list.forEach((p, i) => { previousPeople[i] = capturePose(p, previousPeople[i]); });
        stepWorld({ world, fleet, autopilot, input }, FIXED_DT, world.t * 1000);
        drive?.record(world, world._road, FIXED_DT);
        if (arrivalPending) { arrivalPending = false; finishDrive("arrived"); }
        for (const ev of world.events) {
          if (ev.type === "collision") { hud.flash(); hud.badge("COLLISION", "", 1200); }
          else if (ev.type === "red_light") hud.badge("RAN A RED LIGHT", "", 1500);
          else if (ev.type === "stop_sign") hud.badge("RAN A STOP SIGN", "", 1500);
          else if (ev.type === "failed_to_yield") hud.badge(`FAILED TO YIELD TO ${ev.to.toUpperCase()}`, "", 1500);
        }
        acc -= FIXED_DT;
        steps++;
        if (world.paused) { acc = 0; break; }
      }
    }
    const alpha = world.paused ? 1 : acc / FIXED_DT;
    const renderEgo = Number.isFinite(previousEgo.x) ? interpolatePose(world.ego, previousEgo, alpha) : world.ego;
    for (const inter of map.intersections.values()) {
      roads.signals.set(inter.id, world.phase(inter.id));
      roads.signals.setPed(inter.id, { A: pedPhase(inter, "A", world.t), B: pedPhase(inter, "B", world.t) }, world.t);
    }
    syncFleetMeshes();
    if (manualSignal && !autopilot.enabled) {
      const turned = Math.abs(Math.atan2(Math.sin(world.ego.psi - manualSignal.heading), Math.cos(world.ego.psi - manualSignal.heading))) > 0.5;
      if (world.t - manualSignal.t > 12 || (turned && Math.abs(world.ego.delta) < 0.08)) { world.ego.signal = null; manualSignal = null; }
    }
    const lightsOn = syncCarLights(lighting.night.value, world.weather !== "dry");
    syncCar(egoMesh, renderEgo, dt, world.t, lightsOn);
    for (const n of fleet.vehicles) (n.kind === "bike" ? syncBike : syncCar)(npcMeshes.get(n.id), interpolatePose(n, previousCars.get(n.id), alpha), dt, world.t, lightsOn);
    world.crowd.list.forEach((p, i) => syncPerson(pedMeshes[i], interpolatePose(p, previousPeople[i], alpha), view.camera, world.weather === "rain"));
    overlays.tick(world.t);
    weatherView.update(dt);
    if (roads.streetLights.lights) roads.streetLights.lights.update(view.camera, dt);
    view.updateCamera(renderEgo, dt);
    view.render(dt);
    cockpit.update(view.mode, world.weather, world.t, $("#wipers").checked);
    audio.update(world.ego, world.weather, world.paused || document.hidden, view.mode === "hood");
    const blink = world.ego.signal && world.t % 0.8 < 0.45;
    if (blink && !indicatorLit && !world.paused) audio.tick();
    indicatorLit = blink;
    $("#left-indicator").classList.toggle("active", !!blink && world.ego.signal === "left");
    $("#right-indicator").classList.toggle("active", !!blink && world.ego.signal === "right");
    const speeding = Math.abs(world.ego.v) > (world._road?.limit || 13.9) + 1.4;
    $("#speed-warning").hidden = !speeding;
    $(".speed").classList.toggle("speeding", speeding);
    $("#drive-mode").textContent = world.paused ? "PAUSED" : autopilot.enabled ? `${autopilot.brainName.toUpperCase()} PILOT` : "MANUAL";
    minimap.draw({ ego: world.ego, npcs: fleet.vehicles, route: world.route, destination: world.destination });
    const snap = autopilot.enabled ? autopilot.snap : null;
    hud.update({ ego: world.ego, road: world._road, nav: snap ? snap.nav : null, violations: world.violations,
      decision: autopilot.lastDecision, totals: autopilot.totals, paused: world.paused });
    panel.render(now);
    driveReport.update(drive, now);
    if (!manual) requestAnimationFrame(frame);
  }
  // Headless screenshots run in a hidden page where requestAnimationFrame never fires; they advance
  // frames by hand through window.__jev.advance(seconds).
  let manual = false;
  window.__jev.advance = (seconds, fps = 30) => {
    manual = true;
    for (let t = 0; t < seconds; t += 1 / fps) frame(last + 1000 / fps);
    manual = false;
  };
  requestAnimationFrame(frame);
}

function nearestPreset(hour) {
  let best = "afternoon", d = Infinity;
  for (const [name, h] of Object.entries(TIME_PRESETS)) {
    const x = Math.abs(h - hour);
    if (x < d) { d = x; best = name; }
  }
  return best;
}

const formatHour = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

function readReplay() {
  if (!new URLSearchParams(location.search).has("replay")) return null;
  try { return JSON.parse(localStorage.getItem("jev-fsd-replay")); } catch { return null; }
}

boot().catch((err) => {
  console.error(err);
  loadingText.textContent = `Failed to start: ${err.message}`;
});
