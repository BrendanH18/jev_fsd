import assert from "node:assert/strict";
import { test } from "node:test";
import { CAR, Vehicle } from "../static/js/sim/vehicle.js";
globalThis.document = { querySelector: () => null };
const { ParkedCars, bayIntrusion, footprintIntrusion, reserveSlot } = await import("../static/js/sim/parking.js");

const newParking = (seed = 1) => new ParkedCars({}, { seed, density: 0 });
const carAt = (id, x = 0, y = 0, curb = "right", spec = CAR) =>
  Object.assign(new Vehicle(x, y, 0, 0, spec), { id, curb });
const tick = (parking, dt) => parking.step(dt, { ego: new Vehicle() });
const edge = {
  id: "e",
  pts: [
    [0, 0],
    [60, 0],
  ],
  cum: [0, 60],
  asphalt: [-6, 6],
  parking: [2, 2],
};
const map = { edges: new Map([[edge.id, edge]]) };
const slotAt = (x, y) => ({ x, y, edge: edge.id, occupant: null, reserved: null });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("Write explicit reservation spans without projecting the bay a second time", () => {
  const slot = slotAt(18, -5);
  const owner = { id: "closed" };
  const cacheOnly = {
    edges: new Map([
      [
        edge.id,
        {
          get pts() {
            return assert.fail("projected explicit span");
          },
        },
      ],
    ]),
  };
  const res = reserveSlot(cacheOnly, slot, owner, { sFrom: 12, sTo: 19 });
  assert.deepEqual([res.owner.id, res.sFrom, res.sTo], ["closed", 12, 19]);
});

test("Derive just the unspecified reservation endpoint from the owner's dimensions", () => {
  const owner = carAt("long", 0, 0, "right", { ...CAR, length: 9, rearOverhang: 2 });
  const res = reserveSlot(map, slotAt(20, -5), owner, { sFrom: 16 });
  assert.equal(res.sFrom, 16);
  assert.equal(res.sTo, 27.5);
});

test("Keep a duplicate parked-car add from creating a second obstacle or renderer event", () => {
  const parked = newParking();
  const car = carAt("duplicate");
  parked.add(car);
  parked.add(car);
  assert.equal(parked.near(0, 0, 10).length, 1);
  assert.equal(parked.list.length, 1);
  assert.equal(parked.added.length, 1);
});

test("Preserve a replacement bay occupant when removing the previous car", () => {
  const parked = newParking();
  const slot = slotAt(20, -5);
  const first = Object.assign(carAt("old"), { slot });
  const second = Object.assign(carAt("new"), { slot });
  parked.add(first);
  parked.add(second);
  assert.equal(parked.remove(first), true);
  assert.equal(slot.occupant?.id, "new");
});

test("Keep the unrelated car in a cell when removing a car whose position was edited directly", () => {
  const parked = newParking();
  const first = carAt("moving");
  const second = carAt("stationary", 40);
  parked.add(first);
  parked.add(second);
  first.x = second.x;
  assert.equal(parked.remove(first), true);
  assert.deepEqual(
    parked.near(40, 0, 10).map((c) => c.id),
    ["stationary"],
  );
  assert.equal(parked.grid.size, 1);
});

test("Prune the abandoned cell when a parked car crosses the spatial grid boundary", () => {
  const parked = newParking();
  const car = carAt("moved", -30);
  parked.add(car);
  parked.move(car, 50, 0);
  assert.equal(parked.grid.size, 1);
  assert.equal(parked.near(-30, 0, 10).length, 0);
  assert.equal(parked.near(50, 0, 10)[0]?.id, "moved");
});

test("Keep an attempted move of an unparked car from creating a ghost obstacle", () => {
  const parked = newParking();
  const car = carAt("unknown");
  parked.move(car, 40, 0);
  assert.equal(car.x, 0);
  assert.equal(parked.near(40, 0, 10).length, 0);
});

test("Keep neighbouring parked cars in the grid when one is moved to a new cell", () => {
  const parked = newParking();
  const car = carAt("moves", 0);
  parked.add(car);
  parked.add(carAt("stays", 10));
  parked.move(car, 100, 0);
  assert.deepEqual(
    parked.near(0, 0, 20).map((c) => c.id),
    ["stays"],
  );
});

test("Ignore negative or unbounded parked-car query radii safely", () => {
  const parked = newParking();
  parked.add(carAt("inside", 5));
  for (const r of [-10, Infinity, NaN]) assert.equal(parked.near(5, 0, r).length, 0);
  assert.equal(parked.near(Infinity, 0, 10).length, 0);
});

test("Use a precise centre-distance cutoff for a parked car in an adjacent grid cell", () => {
  const parked = newParking();
  const car = carAt("on-boundary", 0, 24);
  parked.add(car);
  const [x, y] = car.center;
  assert.equal(parked.near(x, y + 8, 8).length, 1);
  assert.equal(parked.near(x, y + 8, 7.99).length, 0);
});

test("Open no door when an authored parked-car lookup returns no owner", () => {
  const parked = newParking();
  assert.equal(parked.openDoor(undefined), null);
  assert.equal(parked.activeDoors.length, 0);
});

test("Place the street-side door hinge using the actual width of its owner", () => {
  const parked = newParking();
  const car = carAt("wide", 0, 0, "right", { ...CAR, width: 2.4 });
  parked.add(car);
  const door = parked.openDoor(car);
  close(door.y, 1.2);
});

test("Update an open door's position immediately when its parked owner moves", () => {
  const parked = newParking();
  const car = carAt("shifted");
  parked.add(car);
  const door = parked.openDoor(car);
  tick(parked, 1);
  const x = door.x,
    y = door.y;
  parked.move(car, 40, 2);
  close(door.x, x + 40);
  close(door.y, y + 2);
});

test("Keep remaining doors in insertion order when the door sweep expires multiple owners", () => {
  const parked = newParking();
  const cars = [0, 1, 2, 3].map((i) => carAt(`car-${i}`, i * 5));
  for (const car of cars) {
    parked.add(car);
    parked.openDoor(car);
  }
  cars[0].door.t = 5.9;
  cars[2].door.t = 5.9;
  tick(parked, 0.3);
  assert.deepEqual(
    parked.activeDoors.map((d) => d.owner.id),
    ["car-1", "car-3"],
  );
  assert.equal(cars[0].door, null);
  assert.equal(cars[2].door, null);
  assert.equal(cars[3].door.t, 0.3);
});

test("Keep a closed street-side panel out of obstacle queries until it swings", () => {
  const parked = newParking();
  const car = carAt("door");
  parked.add(car);
  const door = parked.openDoor(car);
  assert.equal(parked.doorsNear(door.x, door.y, 8).length, 0);
  tick(parked, 0.5);
  assert.deepEqual(
    parked.doorsNear(door.x, door.y, 8).map((d) => d.id),
    ["door_door"],
  );
});

test("Protect an active door from losing its owner during the parked-to-traffic transition", () => {
  const parked = newParking();
  const car = carAt("ready-to-leave");
  parked.add(car);
  parked.openDoor(car);
  assert.equal(parked.remove(car), false);
  assert.equal(parked.removed.length, 0);
  tick(parked, 6);
  assert.equal(parked.remove(car), true);
  assert.equal(parked.removed[0]?.id, "ready-to-leave");
});

test("Mirror the door's streetward swing between left and right curbs", () => {
  const parked = newParking();
  const right = carAt("right", 0, -5, "right");
  const left = carAt("left", 0, 5, "left");
  parked.add(right);
  parked.add(left);
  const r = parked.openDoor(right);
  const l = parked.openDoor(left);
  tick(parked, 1);
  close(r.psi, -l.psi);
  close(r.x, l.x);
  close(r.y, -l.y);
  assert.ok(r.y > right.y && l.y < left.y);
});

test("Detect actual parked-body intrusion from a yawed pose on a straight curb", () => {
  const spec = { ...CAR, width: 1.8, length: 4.4 };
  assert.ok(bayIntrusion(edge, 25, 5.1, spec) < 0);
  assert.ok(footprintIntrusion(edge, 25, -5.1, Math.PI / 6, true, spec) > 0.3);
});

test("Apply the same lane-intrusion test to a mirrored left-side parking bay", () => {
  const spec = { ...CAR, width: 2.0, length: 5.0 };
  const right = footprintIntrusion(edge, 25, -5, Math.PI / 5, true, spec);
  const left = footprintIntrusion(edge, 25, 5, -Math.PI / 5, false, spec);
  close(left, right);
  assert.ok(left > 0.3);
});

test("Allow authored door events to specify their own duration without changing ordinary door cycles", () => {
  const parked = newParking();
  const authored = carAt("authored");
  const ordinary = carAt("ordinary", 10);
  parked.add(authored);
  parked.add(ordinary);
  assert.throws(() => parked.openDoor(authored, { duration: NaN }), /duration/);
  parked.openDoor(authored, { duration: 3 });
  parked.openDoor(ordinary);
  tick(parked, 2.6);
  assert.ok(authored.door.angle < ordinary.door.angle);
  tick(parked, 0.5);
  assert.equal(authored.door, null);
  assert.equal(ordinary.door.t, 3.1);
});
