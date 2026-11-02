// A no-spawn zone drawn as an outline (Map-maker II's twelfth wave; research5 §3.10's `zoneOutline`): one shape test for the
// places of ours, the wildlife's laying and the people (`zoneShape.ts`'s `zoneAt` and `zoneTouches`), so an outline he drew
// as a no-build city is made no-spawn by the same outline: inside and outside of a concave outline by the crossing rule, its
// area, the rim's reach across its edges, a site laid inside it refused and one beside it kept, and the people's rows and
// the people of ours asked of it alike.
import assert from 'node:assert/strict';
import { LAIR_TUNE, gridSites, inside, areaSize, touches, type GroupEntry, type SpawnArea } from '../../../src/world/mobiles/lairs.ts';
import { ZoneSet, spawnAreaOf, zoneTouchesCircle, zonesOf } from '../../../src/world/noSpawnZones.ts';
import { ZoneList, zoneAt } from '../../../src/world/zoneShape.ts';
import type { RemovalRow } from '../../../src/story/removals.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// An L: (0,0) (100,0) (100,40) (40,40) (40,100) (0,100). Its notch (70, 70) is outside.
const L: [number, number][] = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]];
const row: RemovalRow = { id: 'z:l', shape: { kind: 'poly', pts: L } };
const zones = zonesOf([row]);
const area = spawnAreaOf(zones[0]);
ok(area.shape === 'poly' && area.pts?.length === 6 && area.src === 'zone', 'an outline zone is a poly area of its own kind');
ok(inside(area, 20, 20) && inside(area, 90, 20) && inside(area, 20, 90) && !inside(area, 70, 70) && !inside(area, -5, 50), 'inside its arms, outside its notch and beyond it');
ok(Math.abs(areaSize(area) - (100 * 40 + 40 * 60)) < 1e-6, `its area is the L's (${areaSize(area)} m²)`);
ok(touches(area, 70, 45, 6) && !touches(area, 70, 70, 6) && touches(area, 45, 70, 6), 'a circle touches it across an edge within its reach, and not across the notch from its middle');
ok(zoneTouchesCircle(zones[0], 70, 45, 6) && !zoneTouchesCircle(zones[0], 70, 70, 6), "and the console's own question asks it the same");
// The very test the places use.
const list = new ZoneList();
const xz = new Float64Array(L.flat());
list.addPoly(xz, 0);
let agree = 0;
for (let x = -10; x <= 110; x += 7) for (let z = -10; z <= 110; z += 7) if ((zoneAt(list, x, z, 0) >= 0) === inside(area, x, z)) agree++;
ok(agree === 18 * 18, `the laying's test is the places' own, at every point of a grid over it (${agree})`);

// Over a laying: sites inside refused, sites beside kept.
const areas: SpawnArea[] = [{ name: 'a', shape: 'circle', x: 50, z: 50, r: 1500, groups: ['g'], cap: 0 }];
const groups: Record<string, GroupEntry[]> = { g: [{ lair: 'x', weight: 1, count: 0, size: 10, limit: -1, minDiff: 1, maxDiff: 5 }] };
const plain = gridSites('test_world', areas, [], groups);
const big: [number, number][] = [[-300, -300], [300, -300], [300, -100], [-100, -100], [-100, 300], [-300, 300]];
const bigArea = spawnAreaOf(zonesOf([{ id: 'z:big', shape: { kind: 'poly', pts: big } }])[0]);
const laid = gridSites('test_world', areas, [bigArea], groups);
const keys = new Set(laid.map((s) => s.key));
const gone = plain.filter((s) => !keys.has(s.key));
// A site is refused where its own spread reaches in: half its size and the herd's spread (`LAIR_TUNE.herdSpread`, a dial, read).
ok(gone.length > 0 && gone.every((s) => touches(bigArea, s.x, s.z, Math.max(0, s.size) / 2 + LAIR_TUNE.herdSpread)) && laid.every((s) => !inside(bigArea, s.x, s.z)), `sites inside an outline are refused (${gone.length}), none laid inside it`);
ok(laid.some((s) => s.x > 0 && s.z > 0 && s.x < 300 && s.z < 300 && !inside(bigArea, s.x, s.z)), "and sites in its notch are kept");

// The people's rows and the people of ours.
const set = new ZoneSet(zones);
ok(set.rowZone({ x: 20, z: 20 }) === 0 && set.rowZone({ x: 70, z: 70 }) === -1 && set.rowZone({ x: 70, z: 70, roam: 31 }) === 0, "a person in an arm is zoned; one in the notch is not, unless their roam reaches in");
ok(set.oursZone(20, 90) === 0 && set.oursZone(70, 70) === -1, 'the people of ours are asked the same outline');

console.log(`\n${checks} checks passed`);
