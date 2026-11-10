// node --experimental-default-type=module scripts/test_restriction_exit.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MapData, pointAt, headingAt } from '../static/js/map/mapdata.js';
import { auditRestrictions, turnBanned } from '../static/js/sim/turn-restrictions.js';

const key = '623b012bc8b5';
const pack = JSON.parse(fs.readFileSync(new URL(`../data/maps/${key}.v6.pack.json`, import.meta.url)));
pack.restrictions = JSON.parse(fs.readFileSync(new URL(`../data/maps/${key}.restrictions.v1.json`, import.meta.url)));
const map = new MapData(pack), clock = { hour: 15.5, weekday: 0 };
const observer = () => ({ map, clock, ego: {}, violations: {}, events: [] });
function pose(w, edge, s, lane = 0) {
  const l = map.lane(edge, lane), [x, y] = pointAt(l.pts, l.cum, s);
  Object.assign(w.ego, { x, y, psi: headingAt(l.pts, l.cum, s) });
  auditRestrictions(w);
}

// City seed 1, s1-9: northbound Arbutus turning left onto West Broadway. The straight
// exit's lane starts beside the approach's end, so nearestLane picks it mid-turn.
const ban = map.restrictions.find(r => r.osm_relation === 21410132 && r.from === 'e354');
assert.equal(ban?.kind, 'no_straight_on');
assert.equal(turnBanned(map, 'e354', 'e618', clock), true);
assert.equal(turnBanned(map, 'e354', 'e616', clock), false);
for (const navigating of [false, true]) {
  const w = observer();
  if (navigating) w.route = { edges: ['e354', 'e616'] };
  pose(w, 'e354', 40);
  Object.assign(w.ego, { x: 507.9883673028091, y: -132.70506665428744, psi: 1.7113392796933402 });
  assert.equal(map.nearestLane(w.ego.x, w.ego.y, w.ego.psi, 8)?.lane.edge, 'e618');
  for (let i = 0; i < 30; i++) auditRestrictions(w);
  assert.equal(w.restrictionEdge, 'e354', 'retain the approach while the exit is ambiguous');
  pose(w, 'e616', 12, 1);
  assert.equal(w.restrictionEdge, 'e616');
  assert.equal(w.violations.illegal_turns || 0, 0, 'a legal left must not become a prohibited straight');
  assert.equal(w.restrictionsSeen, true);

  // The planned legal left must not excuse someone actually driving straight or making a U-turn.
  for (const exit of ['e618', 'e353']) {
    const actual = observer();
    if (navigating) actual.route = w.route;
    pose(actual, 'e354', 40);
    pose(actual, exit, 10);
    pose(actual, exit, 15);
    assert.equal(actual.violations.illegal_turns, 1, `count actual ${exit} exit once`);
    assert.equal(actual.events[0]?.from, 'e354');
    assert.equal(actual.events[0]?.to, exit);
  }
}

// A short link must confirm before its end, even when shorter than twice the exit margin.
map.restrictions.push({ from: 'e616', to: ['e604'], kind: 'no_straight_on' });
const short = observer();
pose(short, 'e616', 10, 1);
pose(short, 'e604', map.lane('e604', 1).length * 0.55, 1);
assert.equal(short.violations.illegal_turns, 1);
assert.equal(short.events[0]?.to, 'e604');

// A nearby lane pointing the wrong way is not evidence of an exit (nearestLane can fall back).
const misaligned = observer();
pose(misaligned, 'e354', 40);
const lane = map.lane('e618', 0), [x, y] = pointAt(lane.pts, lane.cum, 10);
const near = map.nearestLane(x, y, null, 8);
misaligned.map = { edges: map.edges, restrictions: map.restrictions, nearestLane: () => near };
Object.assign(misaligned.ego, { x, y, psi: headingAt(lane.pts, lane.cum, 10) + Math.PI / 2 });
auditRestrictions(misaligned);
assert.equal(misaligned.restrictionEdge, 'e354');
assert.equal(misaligned.violations.illegal_turns || 0, 0);

console.log('Restriction exit checks passed (legal left, actual bans, short link, ambiguous heading)');
process.exit(0);
