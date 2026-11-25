import assert from "node:assert/strict";
import { test } from "node:test";
import * as ev from "../static/js/sim/emergency.js";
import { AMBULANCE, CAR, Vehicle } from "../static/js/sim/vehicle.js";

const edge = {
  id: "e",
  from: "a",
  to: "b",
  length: 240,
  asphalt: [-8, 8],
  lanes: 2,
  lane_offsets: [-1.75, 1.75],
  lane_width: 3.5,
};
const path = {
  pts: [
    [0, 0],
    [240, 0],
  ],
  cum: [0, 240],
  s: 10,
  length: 240,
};
const at = (x, y = 0, psi = 0) => new Vehicle(x, y, psi, 0, CAR);
const rescue = (props = {}) =>
  Object.assign(new Vehicle(10, 0, 0, 5, AMBULANCE), { id: "ev", siren: true, path, ...props });

test("clip emergency path projections to both ends of the search window", () => {
  assert.equal(ev.closestOnPath(path, 10, -2, 20, 30)?.s, 20);
  assert.equal(ev.closestOnPath(path, 40, 2, 20, 30)?.s, 30);
});

test("retain the first segment in an exact distance tie", () => {
  const turn = {
    pts: [
      [0, 0],
      [100, 0],
      [100, 10],
      [0, 10],
    ],
    cum: [0, 100, 110, 210],
  };
  const hit = ev.closestOnPath(turn, 40, 5, 0, 210);
  assert.equal(hit?.s, 40);
  assert.equal(hit?.lateral, -5);
});

test("reject reversed projection windows and a non-finite query position", () => {
  assert.equal(ev.closestOnPath(path, 20, 0, 30, 20), null);
  assert.equal(ev.closestOnPath(path, Infinity, 0, 20, 30), null);
});

test("ignore a bad path segment and preserve a later valid projection", () => {
  const incomplete = { pts: [null, [40, 0], [80, 0]], cum: [0, 40, 80] };
  assert.equal(ev.closestOnPath(incomplete, 60, -3, 0, 80)?.lateral, 3);
  assert.equal(ev.closestOnPath({ ...path, cum: [] }, 60, -3, 0, 80), null);
});

test("watch for sirens at exactly the hearing radius", () => {
  const n = rescue();
  assert.equal(ev.emergencyCall(at(10 + ev.CALL_M), n)?.distance_m, ev.CALL_M);
  assert.equal(ev.emergencyCall(at(10 + ev.CALL_M + 0.01), n), null);
});

test("classify oncoming and perpendicular emergency vehicles in the driver's frame", () => {
  const n = rescue();
  assert.equal(ev.emergencyCall(at(40, 0, Math.PI), n)?.relation, "ahead");
  assert.equal(ev.emergencyCall(at(40, 0, Math.PI / 2), n)?.relation, "left");
  assert.equal(ev.emergencyCall(at(40, 0, -Math.PI / 2), n)?.relation, "right");
});

test("ignore a silent emergency vehicle even when it is in the call corridor", () => {
  assert.equal(ev.emergencyCall(at(40), rescue({ siren: false })), null);
});

test("filter an empty path of driver probes and skip individual missing probes", () => {
  const n = rescue();
  const ego = at(40, -2);
  assert.equal(ev.emergencyCall(ego, n, []), null);
  assert.equal(ev.emergencyCall(ego, n, [null, [50, 0]])?.relation, "behind");
});

test("reject siren calls with an invalid orientation or closing speed", () => {
  assert.equal(ev.emergencyCall(at(40, 0, Infinity), rescue()), null);
  assert.equal(ev.emergencyCall(at(40), rescue({ v: NaN })), null);
  assert.equal(ev.emergencyCall(at(NaN), rescue()), null);
  assert.equal(ev.emergencyCall(at(40), rescue({ spec: null })), null);
});

test("use the earliest call ETA and keep stable ordering when it ties", () => {
  const first = rescue({ v: 3 });
  const faster = rescue({ v: 9 });
  assert.equal(ev.nearestCall(at(55), [first, faster])?.ev === faster, true);
  first.v = faster.v;
  assert.equal(ev.nearestCall(at(55), [first, faster])?.ev === first, true);
});

test("stop looking for calls once the first zero ETA is found", () => {
  const immediate = rescue();
  const later = {
    get siren() {
      throw new Error("Unreachable call");
    },
  };
  assert.equal(ev.nearestCall(at(11), [immediate, later])?.ev === immediate, true);
});

test("do not authorise a lead when the blocker belongs to another vehicle", () => {
  const ego = at(40);
  const world = { ego, evCalls: new Map([["ev", {}]]) };
  const n = rescue({ blockedFor: 4, blockedBy: [at(50)] });
  assert.equal(ev.emergencyLead(world, n, true), false);
});

test("do not authorise driving on at the exact stuck-time threshold", () => {
  const ego = at(40);
  const world = { ego, evCalls: new Map([["ev", {}]]) };
  const n = rescue({ blockedFor: ev.EV_STUCK_S, blockedBy: [ego] });
  assert.equal(ev.emergencyLead(world, n, true), false);
  n.blockedFor += 0.01;
  assert.equal(ev.emergencyLead(world, n, true), true);
});

test("only a live call can grant a fresh lead", () => {
  const ego = at(40);
  const world = { ego, evCalls: new Map([["ev", {}]]) };
  const n = rescue({ siren: false, blockedFor: 5, blockedBy: [ego] });
  assert.equal(ev.emergencyLead(world, n, true), false);
  n.siren = true;
  assert.equal(ev.emergencyLead(world, n, true), true);
  n.siren = false;
  assert.equal(ev.emergencyLead(world, n, true), true);
});

test("do not create call records when checking an unauthorised lead", () => {
  const ego = at(40);
  const world = { ego, evCalls: new Map() };
  assert.equal(ev.emergencyLead(world, rescue({ blockedFor: 4, blockedBy: [ego] }), true), false);
  assert.equal(world.evCalls.size, 0);
});

test("never use invalid blockage time as proof of a lead", () => {
  const ego = at(40);
  assert.equal(ev.holdsUp({ blockedBy: [ego], blockedFor: Infinity }, ego, 3), false);
  assert.equal(ev.holdsUp({ blockedBy: new Set([ego]), blockedFor: 4 }, ego, 3), false);
});

test("do not latch a driver heading across the emergency vehicle", () => {
  const ego = at(40, 0, Math.PI / 2);
  assert.equal(ev.leadsEmergency(rescue({ blockedFor: 4, blockedBy: [ego] }), ego), false);
});

test("fall back to the lane centre when passing geometry is missing", () => {
  assert.equal(ev.evOffset({}, 0, AMBULANCE), 0);
  assert.equal(ev.evOffset({ ...edge, oneway: true, lane_width: NaN }, 0, AMBULANCE), 0);
});

test("reject malformed or reversed obstacle spans when threading a gap", () => {
  assert.equal(ev.threadGap(edge, 0, AMBULANCE, 0, [null]), null);
  assert.equal(ev.threadGap(edge, 0, AMBULANCE, 0, [[2, 1]]), null);
});

test("keep the preferred passing line when it already clears all the obstacles", () => {
  assert.equal(
    ev.threadGap(edge, 0, AMBULANCE, 0, [
      [2, 3],
      [-5, -3],
    ]),
    0,
  );
});

test("keep the first feasible side when room on both sides is equal", () => {
  const half = AMBULANCE.width / 2 + ev.EV_SQUEEZE_M;
  assert.equal(ev.threadGap(edge, 0, AMBULANCE, 0, [[-0.5, 0.5]]), -0.5 - half);
});

test("reject a gap that only fits by crossing the asphalt or travel-lane edge", () => {
  assert.equal(ev.threadGap(edge, 0, AMBULANCE, 0, [[-20, 20]]), null);
});

test("retain the ordinary pull-over margin when the kerb has no mapped asphalt", () => {
  const fallback = ev.pullOverOffset(edge, 1, CAR.width, false);
  assert.equal(ev.pullOverOffset({ ...edge, asphalt: null }, 1, CAR.width, true), fallback);
  assert.equal(ev.pullOverOffset(edge, 1, NaN, true), 0);
});

test("avoid pulling into a parking lane on a roundabout", () => {
  const curb = ev.pullOverOffset(edge, 1, CAR.width, false);
  assert.equal(ev.pullOverOffset({ ...edge, ring: true }, 1, CAR.width, true), curb);
  assert.equal(ev.pullOverOffset(edge, 1, CAR.width, true), ev.PULL_INTO_PARKING_M);
});

test("preserve a borrowed kerb query result when adding waiting traffic", () => {
  const parked = Object.freeze([at(0)]);
  const waiting = Object.assign(at(10), { pull: { moving: false } });
  const moving = Object.assign(at(10), { pull: { moving: true } });
  const world = { parked: { near: () => parked }, npcs: [parked[0], waiting, moving, waiting] };
  assert.equal(ev.kerbCars(world, 0, 0, 10).length, 2);
  assert.equal(parked.length, 1);
});

test("reject a non-finite kerb search centre and negative radius before searching", () => {
  const world = {
    parked: {
      near: () => {
        throw new Error("Unreachable kerb query");
      },
    },
  };
  assert.equal(ev.kerbCars(world, NaN, 0, 10).length, 0);
  assert.equal(ev.kerbCars(world, 0, 0, -1).length, 0);
});

test("ignore a left-side car when measuring emergency pull-over room", () => {
  const world = { parked: { near: () => [at(0, 4)] } };
  assert.equal(ev.parkedRoom(world, 0, 0, 0), Infinity);
});

test("return no right-side restriction when a kerb marker has no body", () => {
  const world = { parked: { near: () => [null, { x: 5, y: -4 }] } };
  assert.equal(ev.parkedRoom(world, 0, 0, 0), Infinity);
});

test("count distinct neighbouring roads while ignoring orphan edges and self loops", () => {
  const spur = { id: "spur", from: "a", to: "c" };
  const loop = { id: "loop", from: "a", to: "a" };
  const reverse = { id: "reverse", from: "b", to: "a" };
  const map = {
    edges: new Map([
      [edge.id, edge],
      [spur.id, spur],
      [loop.id, loop],
      [reverse.id, reverse],
    ]),
    inn: new Map([["a", [reverse.id, "missing", loop.id]]]),
    out: new Map([["a", [edge.id, spur.id, loop.id]]]),
  };
  assert.equal(ev.isJunction(map, "a"), false);
});

test("reject an invalid dispatch location or look distance before searching lanes", () => {
  const map = {
    nearestLane: () => {
      throw new Error("Unreachable lane lookup");
    },
  };
  for (const plan of [ev.planBehind, ev.planOncoming, ev.planCrossing]) {
    assert.equal(plan(map, 0, 0, 0, Infinity), null);
    assert.equal(plan(map, 0, 0, Infinity), null);
  }
});

test("ignore missing predecessor edges while dispatching behind a car", () => {
  const prev = { id: "prev", from: "z", to: "a", length: 120 };
  const map = {
    nearestLane: () => ({ lane: { edgeRef: edge }, s: 100 }),
    inn: new Map([["a", ["missing", prev.id]]]),
    edges: new Map([
      [edge.id, edge],
      [prev.id, prev],
    ]),
    turnAngle: () => 0,
  };
  const start = ev.planBehind(map, 100, 0, 0);
  assert.equal(start?.edge, prev.id);
  assert.equal(start?.s, 80);
});

test("decline an oncoming dispatch without a mapped reverse edge", () => {
  const map = {
    nearestLane: () => ({ lane: { edgeRef: edge }, s: 50 }),
    out: new Map([["b", ["missing"]]]),
    edges: new Map([[edge.id, edge]]),
  };
  assert.equal(ev.planOncoming(map, 50, 0, 0), null);
});
