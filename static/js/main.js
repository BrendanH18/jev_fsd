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
import { WorldClock, formatClock, worldOptions } from "./sim/world-clock.js";
import { getVehicleModel, vehicleOptions, PAINT_COLORS } from "./sim/vehicle-models.js";
import { OrbitControls } from "./ui/orbit-controls.js";

const FIXED_DT = 1 / 60;
const loadingText = $("#loading-text");

export async function boot() {
  loadingText.textContent = "Loading map…";
  const params = new URLSearchParams(location.search);
  const replay = readReplay();
  const garage = vehicleOptions(replay ? new URLSearchParams() : params);
  const mapQuery = params.get("bbox") || params.get("map") || replay?.bbox?.join(",") || "";
  const query = mapQuery ? `?bbox=${encodeURIComponent(mapQuery)}` : "";
  const status = await api(`/api/status${query}`);
  const options = worldOptions(params, status.npcs);
  const pack = await api(`/api/map${query}`);
  loadingText.textContent = `Building ${pack.edges.length} road segments…`;
  const map = new MapData(pack);
  const hud = new Hud();
  $("#current-city").textContent = status.map.synthetic ? "Practice grid" : status.map.label;
  let savedQuality;
  try { savedQuality = localStorage.getItem("jev-fsd-quality"); } catch { /* preferences are optional */ }
  const quality = params.get("quality") || savedQuality || "high";
  let hour = parseHour(params.get("time"));
  const clock = new WorldClock(hour, options.clockRate);
  const view = new SceneView($("#view"), map.extent, { quality });
  hud.setQuality(view.quality);
  const roads = buildRoads(map);
  view.scene.add(roads.group);
  const signs = buildStreetSigns(map, { anisotropy: view.renderer.capabilities.getMaxAnisotropy() });
  view.addScenery(signs);
  const buildings = buildBuildings(map);
  view.scene.add(buildings);
  view.addScenery(buildTrees(map, roads, buildings.userData.index));
  view.scene.add(buildSurroundings(map));
  view.backdrop.visible = inVancouver(pack.origin);   // the North Shore mountains
  const egoMesh = createCarMesh(parseInt(garage.paint, 16), "ego", garage.vehicle.id);
  view.vehicleCamera = egoMesh.userData.hoodCamera;
  view.vehicleHeight = garage.vehicle.height;
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
      else if (ev.type === "error") hud.badge(ev.error, "safety", 1500);
    },
  };
  // A benchmark scenario opened with "watch" replays with the same start, route, and traffic seed.
  let world, fleet, autopilot;
  if (replay) {
    ({ world, fleet, autopilot } = setupScenario(map, replay.scenario, { brain: status.configured ? replay.brain : "rules", npcs: replay.npcs, weather: replay.weather || "dry", ...callbacks }));
  } else {
    // fewer people out on foot late in the evening and at night
    const pedestrians = hour >= 22 || hour < 6 ? 18 : hour >= 20 ? 36 : undefined;
    world = new World(map, { seed: options.seed, weather: params.get("weather") || "dry", pedestrians, vehicleSpec: garage.vehicle.spec });
    fleet = new NpcFleet(world, { count: options.traffic, seed: options.seed + 6 });
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
  world._road = world.roadInfo();
  if (!status.configured) autopilot.setBrain("rules");
  hud.setBrain(autopilot.brainName);
  const panel = new Panel(autopilot, hud);
  panel.onShowCandidates = (on) => { overlays.showCandidates = on; if (!on) overlays.setCandidates(null); };
  const weatherView = new WeatherView(view);
  const applySky = () => {
    const a = atmosphereFor(hour, world.weather, { latitude: pack.origin.lat, longitude: pack.origin.lon, utcOffset: status.map.utc_offset ?? -7 });
    view.setAtmosphere(a); tintSurroundings(a); world.visibility.setNight(a.night);
  };
  clock.update(world.t);
  function rememberConditions() {
    const next = new URL(location.href);
    next.searchParams.set("weather", world.weather);
    next.searchParams.set("time", formatClock(hour));
    next.searchParams.set("clock", String(clock.rate));
    history.replaceState(null, "", next);
  }
  weatherView.apply(world.weather);
  applySky();
  hud.setWeather(world.weather);
  hud.setTime(nearestPreset(hour));
  hud.onWeatherChange((name) => { world.weather = setWeather(name).name; weatherView.apply(world.weather); applySky(); autopilot.bumpEpoch(); rememberConditions(); hud.badge(`weather: ${name}`, "", 800); });
  function setHour(value) {
    clock.setHour(parseHour(value), world.t); hour = clock.hour;
    applySky(); hud.setTime(nearestPreset(hour)); autopilot.bumpEpoch(); rememberConditions();
  }
  hud.onTimeChange((name) => { setHour(name); hud.badge(`time: ${formatClock(hour)}`, "", 800); });
  $("#clock-rate").value = String(clock.rate);
  $("#clock-rate").addEventListener("change", ev => { clock.setRate(Number(ev.target.value), world.t); rememberConditions(); });
  const trafficSelect = $("#traffic-density");
  const trafficCount = replay ? fleet.vehicles.filter(n => n.kind !== "bike").length : options.traffic;
  if (![...trafficSelect.options].some(o => Number(o.value) === trafficCount)) {
    trafficSelect.add(new Option(`Custom · ${trafficCount}`, String(trafficCount)));
  }
  trafficSelect.value = String(trafficCount);
  $("#world-seed").value = String(replay ? replay.scenario.traffic_seed : options.seed);
  let selectedVehicle = garage.vehicle, selectedPaint = garage.paint;
  function updateGarage() {
    $("#vehicle-options").style.setProperty("--vehicle-paint", `#${selectedPaint}`);
    document.querySelectorAll("[data-vehicle]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.vehicle === selectedVehicle.id));
    });
    document.querySelectorAll("[data-paint]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.paint === selectedPaint));
    });
    const spec = selectedVehicle.spec;
    $("#vehicle-spec").textContent = `${selectedVehicle.name} · ${spec.length.toFixed(2)} × ${spec.width.toFixed(2)} m · ${spec.mass.toLocaleString()} kg · ${Math.round(spec.power / 1000)} kW at wheels · ${selectedVehicle.drive}`;
  }
  $("#vehicle-options").addEventListener("click", ev => {
    const button = ev.target.closest("[data-vehicle]");
    if (!button) return;
    selectedVehicle = getVehicleModel(button.dataset.vehicle); updateGarage();
  });
  $("#paint-options").addEventListener("click", ev => {
    const button = ev.target.closest("[data-paint]");
    if (!button || !PAINT_COLORS.includes(button.dataset.paint)) return;
    selectedPaint = button.dataset.paint; updateGarage();
  });
  updateGarage();
  $("#restart-world").addEventListener("click", () => {
    const seed = $("#world-seed");
    if (!seed.reportValidity()) return;
    if (drive && !drive.finished && drive.distance > 1) saveDrive(drive.finish("world restarted"));
    autopilot.setEnabled(false);
    const next = new URL(location.href);
    next.searchParams.delete("replay"); next.searchParams.delete("explore");
    next.searchParams.set("seed", seed.value); next.searchParams.set("traffic", trafficSelect.value);
    next.searchParams.set("car", selectedVehicle.id); next.searchParams.set("paint", selectedPaint);
    next.searchParams.set("time", formatClock(hour)); next.searchParams.set("weather", world.weather);
    next.searchParams.set("quality", view.quality); next.searchParams.set("clock", String(clock.rate));
    location.assign(next);
  });
  hud.onQualityChange((name) => {
    view.setQuality(name);
    hud.setQuality(view.quality);
    try { localStorage.setItem("jev-fsd-quality", view.quality); } catch { /* preferences are optional */ }
    hud.badge(`graphics: ${view.quality}`, "", 800);
  });
  const minimap = new Minimap($("#minimap"), map, (pt) => setDestination(pt));
  hud.setJevAvailable(status.configured);
  hud.setMapNote(status.map.synthetic
    ? `Synthetic grid (map fetch failed: ${status.map.error})`
    : `© OpenStreetMap contributors (ODbL) · ${pack.edges.length} roads · ${pack.intersections.length} signals · ${pack.stops.length} stops`,
  status.configured ? "" : "no API key, Jev unavailable");

  function toggleAutopilot() {
    if (!autopilot.enabled && !world.route) { hud.badge("set a destination first (click the minimap)", "", 1500); return; }
    autopilot.setEnabled(!autopilot.enabled);
    hud.setAutopilot(autopilot.enabled);
    hud.badge(autopilot.enabled ? `AUTOPILOT: ${autopilot.brainName.toUpperCase()}` : "MANUAL", "", 900);
    if (!autopilot.enabled) overlays.setCandidates(null);
  }
  hud.onAutopilotClick(toggleAutopilot);
  function selectBrain(name) {
    if (name === "jev" && !status.configured) { hud.badge("Jev needs TYPESAFE_API_KEY in .env on the server", "safety", 2200); hud.setBrain(autopilot.brainName); return; }
    if (name === autopilot.brainName) return;
    autopilot.setBrain(name);
    hud.setBrain(name);
    hud.badge(`brain: ${name === "jev" ? "Jev" : "Rules"}`, "", 800);
  }
  hud.onBrainChange(selectBrain);
  const audio = new DriveAudio($("#drive-sound"));
  const cockpit = new Cockpit();
  function cameraChanged() {
    const orbit = view.mode === "orbit";
    $("#camera-view").textContent = `View: ${orbit ? "360°" : view.mode}`;
    $("#camera-orbit").setAttribute("aria-pressed", String(orbit));
    $("#orbit-actions").hidden = !orbit; $("#camera-help").hidden = !orbit;
  }
  function enableOrbit() { if (view.mode !== "orbit") { view.setCamera("orbit"); cameraChanged(); } }
  const switchCamera = () => { view.toggleCamera(); cameraChanged(); hud.badge(`camera: ${view.mode === "orbit" ? "360°" : view.mode}`, "", 700); };
  $("#camera-view").addEventListener("click", switchCamera);
  $("#camera-orbit").addEventListener("click", () => { view.setCamera(view.mode === "orbit" ? "chase" : "orbit"); cameraChanged(); });
  const zoomCamera = delta => { enableOrbit(); view.orbit.zoom(delta, world.ego.spec); };
  $("#camera-zoom-out").addEventListener("click", () => zoomCamera(160));
  $("#camera-zoom-in").addEventListener("click", () => zoomCamera(-160));
  $("#camera-recenter").addEventListener("click", () => { view.orbit.reset(); });
  new OrbitControls($("#view"), {
    rotate: (dx, dy) => { enableOrbit(); view.orbit.rotate(dx, dy); },
    zoom: zoomCamera,
    pinch: scale => { enableOrbit(); view.orbit.setDistance(view.orbit.distance * scale, world.ego.spec); },
  });
  $("#camera-motion").addEventListener("change", ev => { view.cameraMotion = ev.target.checked; });
  let manualSignal = null;
  function togglePause() {
    world.paused = !world.paused;
    hud.badge(world.paused ? "PAUSED" : "RESUMED", "", 700);
  }
  $("#pause-world").addEventListener("click", togglePause);
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
    pause: togglePause,
    brain1: () => selectBrain("jev"),
    brain2: () => selectBrain("rules"),
    help: () => hud.toggleKeys(),
    escape: () => { hud.toggleKeys(false); panel.toggle(false); },
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
      next.searchParams.set("weather", world.weather); next.searchParams.set("time", formatClock(hour));
      next.searchParams.set("clock", String(clock.rate));
      next.searchParams.set("quality", view.quality);
      location.assign(next);
    },
  });

  function applyRoute(data, pt, title) {
    world.destination = pt;
    world.route = new Route(data, map, world.ego.spec);
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

  // Turn-by-turn guidance for manual drivers; the autopilot's own snapshot is used when it drives.
  let cachedNav = null, navRoute = null, navAt = -Infinity;
  function routeNav(now) {
    const route = world.route;
    if (!route) { navRoute = null; cachedNav = null; return null; }
    if (route === navRoute && now - navAt < 100) return cachedNav;
    navRoute = route; navAt = now;
    const p = route.project(world.ego.x, world.ego.y);
    if (p.distance > 25) return cachedNav = null;
    const remaining = route.remaining(p.s), next = route.turnsAfter(p.s)[0];
    return cachedNav = { next_turn: next ? next.dir : "none", exit: next?.exit ?? null, turn_in_m: next ? next.at_m - p.s : remaining,
      turn_street: next?.street || "", remaining_m: remaining, arrived: remaining < 3.5 };
  }

  $("#loading").hidden = true;
  hud.show();
  if (replay) {
    overlays.setRoute(world.route);
    hud.setAutopilot(true);
    hud.badge(`REPLAY ${replay.scenario.id}: ${autopilot.brainName.toUpperCase()}`, "", 2200);
    startDrive(`Replay ${replay.scenario.id}`, world.route);
  }
  window.__jev = { world, map, view, autopilot, fleet, setDestination, overlays, signs, audio, cockpit, clock, driveReport, explorer, egoMesh, vehicle: garage.vehicle, get drive() { return drive; }, finishDrive, setTime: setHour };
  if (params.has("explore")) explorer.open();

  let last = performance.now();
  let acc = 0;
  let indicatorLit = false;
  let lastConditions = "", skyAt = world.t;
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
          if (ev.type === "collision") { hud.flash(); hud.badge(`COLLISION · ${(ev.kind || "object").replace(/_/g, " ").toUpperCase()}`, "alert", 1500); }
          else if (ev.type === "red_light") hud.badge("RAN A RED LIGHT", "alert", 1500);
          else if (ev.type === "stop_sign") hud.badge("RAN A STOP SIGN", "alert", 1500);
          else if (ev.type === "failed_to_yield") hud.badge(`FAILED TO YIELD TO ${ev.to.toUpperCase()}`, "alert", 1500);
        }
        acc -= FIXED_DT;
        steps++;
        if (world.paused) { acc = 0; break; }
      }
    }
    hour = clock.update(world.t);
    if (world.t - skyAt >= 1) {
      if (clock.rate) applySky();
      skyAt = world.t;
    }
    const conditions = `${garage.vehicle.name} · ${formatClock(hour)} · ${world.weather[0].toUpperCase() + world.weather.slice(1)} · ${Math.round(world.visibility.range)} m sight`;
    if (conditions !== lastConditions) { $("#world-conditions").textContent = conditions; lastConditions = conditions; }
    const pauseButton = $("#pause-world");
    if (pauseButton.getAttribute("aria-pressed") !== String(world.paused)) {
      pauseButton.setAttribute("aria-pressed", String(world.paused)); pauseButton.textContent = world.paused ? "Resume" : "Pause";
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
    minimap.draw({ ego: world.ego, npcs: fleet.vehicles, route: world.route, destination: world.destination });
    const snap = autopilot.enabled ? autopilot.snap : null;
    hud.update({ ego: world.ego, road: world._road, nav: snap?.nav || routeNav(now), violations: world.violations,
      decision: autopilot.lastDecision, totals: autopilot.totals, paused: world.paused, autopilot: autopilot.enabled, hasRoute: !!world.route }, now);
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

function readReplay() {
  if (!new URLSearchParams(location.search).has("replay")) return null;
  try { return JSON.parse(localStorage.getItem("jev-fsd-replay")); } catch { return null; }
}
