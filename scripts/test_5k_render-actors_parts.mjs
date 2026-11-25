import assert from "node:assert/strict";
import { test } from "node:test";
import "./render_actor_test_support.mjs";

const THREE = await import("three");
const { createBusMesh } = await import("../static/js/render/bus.js");
const { createSchoolBusMesh } = await import("../static/js/render/school-bus.js");
const { createStreetcarMesh } = await import("../static/js/render/streetcar.js");
const { createTrainMesh } = await import("../static/js/render/rail.js");
const { createVanMesh } = await import("../static/js/render/delivery-van.js");
const { createTruckMesh } = await import("../static/js/render/collection-truck.js");
const { createPlowMesh } = await import("../static/js/render/snow-plow.js");
const { createEmergencyMesh } = await import("../static/js/render/emergency.js");
const { createRoadsideMesh } = await import("../static/js/render/roadside.js");
const { crewTruck } = await import("../static/js/render/work-zone.js");
const { retireActor } = await import("../static/js/render/actor-resources.js");
const { createBikeMesh, createCarMesh, buildParkedCars, createDoorMesh, hideParkedCar, restoreParkedCar } =
  await import("../static/js/render/cars.js");
const { CAR, BIKE } = await import("../static/js/sim/vehicle.js");

const vehicle = { id: "actor", x: 0, y: 0, psi: 0 };

const details = [
  [
    createBusMesh,
    "boarding-edge cab-mirror-stalk cab-mirror rear-mudflap rear-reflector side-marker radiator-grille rear-plate driver-wiper",
  ],
  [
    createSchoolBusMesh,
    "extension-mirror-stalk extension-mirror rear-door-outline upper-clearance-marker hood-marker boarding-step rear-emergency-door-handle rear-door-step swing-arm-housing front-plate",
  ],
  [
    createStreetcarMesh,
    "bellows-ribs platform-threshold cab-corner-post rear-visibility-marker low-side-reflector roof-vent-slats front-coupler-socket pantograph-insulator",
  ],
  [
    createTrainMesh,
    "clerestory-vent boarding-step platform-grab-rail front-fender-ribbing rear-marker-housing trolley-contact-shoe front-tow-coupler rear-coupler",
  ],
  [
    () => createVanMesh(vehicle),
    "cargo-door-hinges cab-door-grips cab-mirror-housing rear-bumper-reflectors rear-mudflaps slider-door-grip rear-door-release roof-brake-lamp rear-registration-plate",
  ],
  [
    () => createTruckMesh(vehicle),
    "rear-worker-step-surface hopper-control-panel tailgate-hinges packer-lower-rail rear-hopper-reflectors cab-access-step cab-grille rollaway-protection rear-camera",
  ],
  [
    () => createPlowMesh(vehicle),
    "blade-cutting-edge blade-edge-guides blade-end-grip headlamp-supports tailgate-chain-housing spreader-reflectors spreader-spinner dump-body-top-rail wing-pivot-bracket",
  ],
  [
    () => createEmergencyMesh("ambulance"),
    "patient-door-hinges rear-door-glass rear-clearance-markers side-door-grab-handles cab-mirror-housings rear-door-divider loading-step-grip rear-door-grip",
  ],
  [
    () => createEmergencyMesh("fire_truck"),
    "rear-step-grip cab-entry-tread pump-panel hose-outlet-caps roof-clearance-markers rear-reflector-strips bumper-recovery-eye",
  ],
  [
    () => createRoadsideMesh({ ...vehicle, kind: "tow_truck" }),
    "lift-marker-reflectors winch-fairlead toolbox-door toolbox-handle cab-access-step rear-warning-strip boom-warning-marker front-grille",
  ],
  [
    () => crewTruck().g,
    "dump-body-rail tailgate-latch rear-low-reflectors arrow-board-struts folded-traffic-board-housing grille front-step-bumper rear-plate",
  ],
];

test("each equipment part has vertex colors and nonzero geometry within its actor's bounds", () => {
  for (const [factory, names] of details) {
    const actor = factory();
    const byPart = new Map();
    actor.traverse((node) => {
      if (node.name !== "body-details") return;
      const { position, normal, color } = node.geometry.attributes;
      assert.equal(color.count, position.count);
      assert.equal(normal.count, position.count);
      for (const [name, ranges] of Object.entries(node.geometry.userData.parts)) {
        assert.equal(byPart.has(name), false, `${actor.name}: duplicate ${name}`);
        byPart.set(name, ranges.length);
        for (const { start, count } of ranges) {
          assert.ok(count > 0 && count % 3 === 0 && start + count <= position.count);
          const bounds = new THREE.Box3();
          for (let i = start; i < start + count; i++)
            bounds.expandByPoint(new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)));
          const size = bounds.getSize(new THREE.Vector3());
          assert.ok(
            [size.x, size.y, size.z].every((length) => Number.isFinite(length) && length > 0),
            name,
          );
          assert.ok(Math.abs(bounds.min.x) < 32 && Math.abs(bounds.max.x) < 32, name);
          assert.ok(bounds.min.y >= (name.startsWith("blade-") ? -0.6 : 0), name);
          assert.ok(bounds.max.y < 6 && Math.abs(bounds.max.z) < 2, name);
        }
      }
    });
    assert.equal([...byPart.keys()].sort().join(" "), names.split(" ").sort().join(" "), actor.name);
  }
});

test("details are batched and reused without retiring another actor's shared buffers", () => {
  const a = createBusMesh("a");
  const b = createBusMesh("b");
  const parts = a.getObjectByName("body-details");
  assert.equal(parts.geometry === b.getObjectByName("body-details").geometry, true);
  assert.equal(parts.material === b.getObjectByName("body-details").material, true);
  assert.equal(parts.castShadow, false);
  assert.equal(parts.receiveShadow, true);
  assert.equal(parts.material.vertexColors, true);
  let disposed = 0;
  parts.geometry.addEventListener("dispose", () => disposed++);
  retireActor(a);
  assert.equal(disposed, 0);
});

test("police roof lights and push bar stay on the SUV even with its ground light pool", () => {
  const cruiser = createRoadsideMesh({ ...vehicle, kind: "police" });
  const { body, spec } = cruiser.userData;
  const push = cruiser.getObjectByName("push-bar");
  const y = new THREE.Box3().setFromObject(body).max.y;
  const lamps = cruiser.userData.roadside.lenses.left;
  assert.ok(new THREE.Box3().setFromObject(lamps[0]).min.y > y);
  assert.ok(new THREE.Box3().setFromObject(push).max.x < spec.length - spec.rearOverhang + 0.4);
});

test("bicycle steering has its own front pivot and wheelbase", () => {
  const bike = createBikeMesh(0x105a89, "rider");
  const [rear, front] = bike.userData.wheels;
  assert.equal(front.pivot.position.x - rear.pivot.position.x, BIKE.wheelbase);
  assert.equal(front.steer && !rear.steer, true);
  assert.equal(front.wheel.getObjectByName("hub-and-spokes").geometry.attributes.position.count > 0, true);
  assert.ok(bike.getObjectByName("saddle").position.y > 0.7);
  assert.ok(bike.getObjectByName("bicycle-front-lamp").position.x > 0.9);
  assert.ok(bike.getObjectByName("bicycle-rear-reflector").position.x < bike.getObjectByName("saddle").position.x);
});

test("the same style survives parking and an open door uses the obstacle panel's dimensions", () => {
  const car = { ...vehicle, style: -1, color: 0x558877, curb: "right", spec: { ...CAR, width: 2 } };
  const moving = createCarMesh(car.color, car.id, car.style);
  const parked = buildParkedCars([car]);
  assert.equal(moving.userData.style, "pickup");
  assert.equal(
    parked.userData.instances.get(car)[0].mesh.geometry === moving.getObjectByName("bodywork").geometry,
    true,
  );
  const door = createDoorMesh(car, { spec: { length: 1.35, width: 0.1 } });
  const panel = door.userData.swing.children[0];
  assert.equal(panel.geometry.parameters.width, 1.35);
  assert.equal(panel.geometry.parameters.depth, 0.1);
  assert.equal(door.children[0].position.z, -1.015);
  assert.equal(parked.userData.count, 1);
  assert.equal(buildParkedCars([]).children.length, 0);
});

test("parked wheel LOD ignores a hidden nearby body but includes it when restored", () => {
  const camera = new THREE.PerspectiveCamera();
  const close = { ...vehicle, style: 1, color: 0xaaaaff };
  const remote = { ...close, id: "remote", x: 60 };
  const parked = buildParkedCars([close, remote]);
  const lod = parked.children[0];
  const instances = parked.userData.instances.get(close);
  lod.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  lod.update(camera);
  assert.equal(lod.wheels.geometry === lod.detailed, true);
  hideParkedCar(instances);
  lod.update(camera);
  assert.equal(lod.wheels.geometry === lod.simple, true);
  restoreParkedCar(instances);
  lod.update(camera);
  assert.equal(lod.wheels.geometry === lod.detailed, true);
});

test("garage cars place wheels, lights, camera and suspension from their own model dimensions", () => {
  const compact = createCarMesh(0x2f7cff, "ego", "compact");
  const pickup = createCarMesh(0xdd1144, "ego", "pickup");
  const u = pickup.userData;
  assert.equal(u.pivot.position.x, u.spec.wheelbase - u.spec.cgToFront);
  assert.equal(u.pivot.position.y, u.spec.cgHeight);
  assert.equal(u.wheels[0].pivot.position.z * 2, u.spec.track);
  assert.equal(u.wheels[0].pivot.position.x, u.spec.wheelbase);
  assert.equal(u.wheels[2].pivot.position.x, 0);
  assert.ok(Math.abs(u.headlampPosition.x - (u.spec.length - u.spec.rearOverhang)) < 0.05);
  assert.ok(u.hoodCamera.y > compact.userData.hoodCamera.y);
  assert.ok(u.height > compact.userData.height);
});

test("paint variants share model geometry while retaining their own colour", () => {
  const first = createCarMesh(0x117744, "first", "sport");
  const second = createCarMesh(0xbb1234, "second", "sport");
  const paint = first.getObjectByName("bodywork");
  assert.equal(paint.geometry === second.getObjectByName("bodywork").geometry, true);
  assert.equal(paint.material.color.getHex(), 0x117744);
  assert.equal(second.getObjectByName("bodywork").material.color.getHex(), 0xbb1234);
});

test("rail and road transit keep their own approach-facing destination and door layouts", () => {
  const bus = createBusMesh("bus", "14 Hastings");
  const tram = createStreetcarMesh("streetcar", "501 Queen");
  const readSign = (vehicle) =>
    vehicle.getObjectByName("destination").material.map.image.trace.find(([call]) => call === "fillText")[1];
  assert.equal(readSign(bus), "14 Hastings");
  assert.equal(readSign(tram), "501 Queen");
  assert.equal(tram.userData.doors.length, 8);
  const inside = tram.getObjectByName("doorway");
  inside.geometry.computeBoundingBox();
  assert.ok(inside.geometry.boundingBox.min.z > 0);
  const train = createTrainMesh();
  assert.ok(new THREE.Box3().setFromObject(train.getObjectByName("trolley-pole")).max.y > 4);
  assert.equal(train.getObjectByName("rear-markers").material.emissive.getHex(), 0xf72418);
});

test("emergency vehicle lamp colours identify the two response silhouettes", () => {
  const ambulance = createEmergencyMesh("ambulance");
  const fire = createEmergencyMesh("fire_truck");
  const colors = (a) =>
    new Set([...a.userData.lenses.left, ...a.userData.lenses.right].map((m) => m.material.color.getHex()));
  assert.equal(colors(ambulance).has(0x1a4dff), true);
  assert.equal(colors(fire).has(0x1a4dff), false);
  assert.equal(colors(fire).has(0xff1a1a), true);
  assert.equal(colors(fire).has(0xffffff), true);
  assert.ok(fire.userData.spec.length > ambulance.userData.spec.length);
});
