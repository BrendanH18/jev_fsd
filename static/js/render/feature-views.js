// Rendering adapters live here so the simulation registry can also load in Node without Three.js.
import { BallView } from "./ball-chase.js";
import { IceView } from "./black-ice.js";
import { buildContraflow } from "./contraflow.js";
import { buildDriveways } from "./driveway-reversers.js";
import { GeeseView } from "./geese.js";
import { buildPotholes } from "./potholes.js";
import { buildPuddles, PuddleView } from "./puddles.js";
import { buildPxos } from "./pxo.js";
import { RoadClosureView } from "./road-closures.js";
import { buildSnowbanks } from "./snowbanks.js";
import { SunGlareView } from "./sun-glare.js";
import { buildCalming } from "./traffic-calming.js";
import { OfficerView } from "./traffic-officer.js";
import { buildRestrictions } from "./turn-restrictions.js";
import { egoGlare } from "../sim/sun-glare.js";

export function mountFeatureViews(view, world) {
  const { scene } = view;
  const { map } = world;
  if (world.restrictions || world.redTurnSigns) {
    scene.add(
      buildRestrictions(map, [
        ...(world.restrictions ? map.restrictions : []),
        ...(world.redTurnSigns ? map.redTurns : []),
      ]),
    );
  }
  if (world.calming) scene.add(buildCalming(map));
  const glare = world.sunGlare.enabled ? new SunGlareView(scene) : null;
  if (world.contraflow.enabled) scene.add(buildContraflow(map));
  if (world.driveways.enabled) scene.add(buildDriveways(map));
  if (world.potholes.enabled) scene.add(buildPotholes(world));
  const balls = world.balls?.enabled ? new BallView(scene) : null;
  const geese = world.geese.enabled ? new GeeseView(scene) : null;
  const roadClosures = world.roadClosures?.enabled ? new RoadClosureView(scene) : null;
  const ice = world.ice?.enabled ? new IceView(scene) : null;
  const puddleGroup = world.puddles?.enabled ? buildPuddles(world) : null;
  if (puddleGroup) scene.add(puddleGroup);
  const puddles = puddleGroup ? new PuddleView(scene, puddleGroup) : null;
  const officers = world.officers?.enabled ? new OfficerView(scene) : null;
  if (world.snowbanks?.geo.runs.length) scene.add(buildSnowbanks(world));
  const crossing = world.pxo ? buildPxos(world) : null;
  if (crossing) scene.add(crossing.group);
  return {
    balls,
    roadClosures,
    ice,
    puddles,
    updateSignals() {
      crossing?.update();
    },
    update(fleet, people, dt, lightsOn) {
      const { camera } = view;
      geese?.sync(world, world.t);
      roadClosures?.sync(world, world.t);
      ice?.sync(world);
      puddles?.update(world, [world.ego, ...fleet.vehicles], people, camera, dt);
      officers?.sync(world, dt, camera, lightsOn);
      if (glare) glare.update(camera, view.atmosphere, egoGlare(world)?.severity ?? 0);
      balls?.update(world, camera);
    },
  };
}
