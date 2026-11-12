// Calgary city seed 2, s2-2: turning left from Royal Avenue SW (e564) into the link e560, the car
// passes the end of the slip lane e561, which comes into the same junction. Mid-turn nearestLane
// picks e561, and the audit took it for the car's approach, then counted e561 to e560 (only a right
// turn is allowed from e561) as a prohibited turn the car never made. The end of another approach
// into the junction the car is leaving is still the junction, not a new approach.
// node --experimental-default-type=module scripts/test_restriction_approach.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MapData, pointAt, headingAt } from '../static/js/map/mapdata.js';
import { auditRestrictions, turnBanned } from '../static/js/sim/turn-restrictions.js';

const key = 'a53c5bcf6438';
const pack = JSON.parse(fs.readFileSync(new URL(`../data/maps/${key}.v6.pack.json`, import.meta.url)));
pack.restrictions = JSON.parse(fs.readFileSync(new URL(`../data/maps/${key}.restrictions.v1.json`, import.meta.url)));
const map = new MapData(pack), clock = { hour: 15.5, weekday: 0 };
const observer = () => ({ map, clock, ego: {}, violations: {}, events: [] });
function pose(w, edge, s, lane = 0) {
  const l = map.lane(edge, lane), [x, y] = pointAt(l.pts, l.cum, s);
  Object.assign(w.ego, { x, y, psi: headingAt(l.pts, l.cum, s) });
  auditRestrictions(w);
}
const place = (w, x, y, psi) => { Object.assign(w.ego, { x, y, psi }); auditRestrictions(w); };

assert.equal(turnBanned(map, 'e564', 'e560', clock), false, 'Royal Avenue into the link is allowed');
assert.equal(turnBanned(map, 'e561', 'e560', clock), true, 'the slip lane may only turn right');
assert.equal(map.edges.get('e564').to, map.edges.get('e561').to, 'both come into the same junction');

// The car's poses through the turn in the city run (13.6 s to 14.0 s).
const turn = [[-474.9354732484336, -477.61318412815706, 0.6841467184124391],
  [-474.6292059601782, -477.3597916816273, 0.7663188093930451],
  [-474.36001073976615, -477.09485685994514, 0.8546123771644716],
  [-474.12280536870435, -476.81435393029983, 0.9434154577233481],
  [-473.91521971928427, -476.5184616382061, 1.0314954847398166]];
const w = observer();
pose(w, 'e564', 5);
pose(w, 'e564', 12);
assert.equal(w.restrictionEdge, 'e564');
const [x, y, psi] = turn[1];
assert.equal(map.nearestLane(x, y, psi, 8)?.lane.edge, 'e561', 'mid-turn the slip lane is nearest');
for (const p of turn) place(w, ...p);
assert.equal(w.restrictionEdge, 'e564', 'keep the approach while passing the slip lane\'s end');
pose(w, 'e560', 12);
pose(w, 'e560', 20);
assert.equal(w.restrictionEdge, 'e560');
assert.equal(w.violations.illegal_turns || 0, 0, 'a legal left is not the slip lane\'s banned turn');

// A car that really comes down the slip lane and turns left into the link is still counted.
const slip = observer();
pose(slip, 'e561', 20);
pose(slip, 'e561', 50);
pose(slip, 'e560', 12);
pose(slip, 'e560', 20);
assert.equal(slip.violations.illegal_turns, 1, 'the slip lane\'s left into the link is counted');
assert.equal(slip.events[0]?.from, 'e561');
assert.equal(slip.events[0]?.to, 'e560');

console.log('Restriction approach checks passed (passing another approach\'s end, a real slip-lane left)');
process.exit(0);
