// The owner's no-spawn zones over the wildlife's laying (Map-maker II's twelfth wave; research5 §3.10's `zones`): a world
// with no zone lays the sites `gridSites` lays with the pack's `noSpawn` alone, site by site and field by field; a zone's
// sites are gone and every other site is the very site it was, but those a gap freed (none: the grid draws its cells by
// key, so nothing moves into a gap); the rim refuses a site whose bodies would stand inside, by a test that draws nothing
// from a cell's stream, so every site that survives keeps its seed, its lair and its levels; and `ZONE_TUNE.margin`
// 'middle' keeps off by the middle alone, as the pack's own no-spawn areas do.
//
// Day one: `gridSites` with no zone is cfa55f3's `gridSites`, out of git, site by site.
import assert from 'node:assert/strict';
import { LAIR_TUNE, ZONE_TUNE, gridSites, inside, touches, type GroupEntry, type LairSite, type SpawnArea } from '../../../src/world/mobiles/lairs.ts';
import { spawnAreaOf, wildAreasOf, zonesOf } from '../../../src/world/noSpawnZones.ts';
import { loadOld } from './oldModules.ts';
import type { RemovalRow } from '../../../src/story/removals.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const W = 'test_world';
const areas: SpawnArea[] = [{ name: 'test_area', shape: 'circle', x: 0, z: 0, r: 2500, groups: ['g'], cap: 0 }];
const noSpawn: SpawnArea[] = [{ name: 'test_town', shape: 'circle', x: 900, z: 900, r: 120, groups: [], cap: 0 }];
const groups: Record<string, GroupEntry[]> = {
  g: [
    { lair: 'small', weight: 3, count: 0, size: 10, limit: -1, minDiff: 1, maxDiff: 10 },
    { lair: 'big', weight: 1, count: 0, size: 40, limit: -1, minDiff: 5, maxDiff: 20 },
  ],
};
const fields = (s: LairSite) => JSON.stringify(s);
const plain = gridSites(W, areas, noSpawn, groups);
ok(plain.length > 50, `the test world lays ${plain.length} sites with the pack's own areas alone`);

// ---- day one ------------------------------------------------------------------------------------------------------------------
{
  const old = await loadOld<{ gridSites: typeof gridSites }>(['src/world/mobiles/lairs.ts'], 'src/world/mobiles/lairs.ts', 'cfa55f3');
  if (!old) console.log("note git cannot hand cfa55f3's lairs over: the day-one laying is not compared here");
  else {
    const then = old.gridSites(W, areas, noSpawn, groups);
    ok(then.length === plain.length && then.every((s, i) => fields(s) === fields(plain[i])), `with no zone the laying is cfa55f3's, site by site and field by field (${then.length})`);
  }
  ok(gridSites(W, areas, [...noSpawn], groups).every((s, i) => fields(s) === fields(plain[i])) && gridSites(W, areas, [...noSpawn, ...wildAreasOf([])], groups).length === plain.length, "and so with the zones' list empty");
}

// ---- a zone -------------------------------------------------------------------------------------------------------------------
const zoneRow = (id: string, shape: RemovalRow['shape'], keeps?: RemovalRow['keeps']): RemovalRow => ({ id, shape, ...(keeps ? { keeps } : {}) });
// A circle round the middle of one site that is laid, 30 m wide.
const target = plain[Math.floor(plain.length / 2)];
const zones = zonesOf([zoneRow('z:lair', { kind: 'circle', c: [target.x, target.z], r: 30 })]);
const zoned = gridSites(W, areas, [...noSpawn, ...wildAreasOf(zones)], groups);
const byKey = new Map(plain.map((s) => [s.key, s]));
const kept = new Map(zoned.map((s) => [s.key, s]));
ok(!kept.has(target.key), "the site under the zone is not laid");
ok(zoned.every((s) => byKey.has(s.key) && fields(byKey.get(s.key)!) === fields(s)), 'every site laid is the very site it was, seed, lair and levels: the zone draws nothing from a cell\'s stream');
const gone = plain.filter((s) => !kept.has(s.key));
const zone = wildAreasOf(zones)[0];
ok(gone.every((s) => inside(zone, s.x, s.z) || touches(zone, s.x, s.z, Math.max(0, s.size) / 2 + LAIR_TUNE.herdSpread)), `every site gone stood in the zone or reached into it with its bodies (${gone.length} gone)`);
ok(zoned.every((s) => !touches(zone, s.x, s.z, Math.max(0, s.size) / 2 + LAIR_TUNE.herdSpread)), 'and no site laid reaches into it');
// The margin by the middle alone.
ZONE_TUNE.margin = 'middle';
try {
  const middle = gridSites(W, areas, [...noSpawn, ...wildAreasOf(zones)], groups);
  ok(middle.length >= zoned.length && middle.every((s) => !inside(zone, s.x, s.z)) && !middle.some((s) => s.key === target.key), `'middle' keeps off by the middle alone: no site's middle inside, more kept at the rim (${middle.length} against ${zoned.length})`);
} finally {
  ZONE_TUNE.margin = 'spread';
}
// A zone beside a site, its middle outside and its bodies' reach inside: the rim refuses it, the middle keeps it.
{
  const s = plain[3];
  const beside = wildAreasOf(zonesOf([zoneRow('z:beside', { kind: 'circle', c: [s.x + 20, s.z], r: 10 })]));
  ok(!inside(beside[0], s.x, s.z) && touches(beside[0], s.x, s.z, Math.max(0, s.size) / 2 + LAIR_TUNE.herdSpread), 'a zone 20 m off a site: its middle outside, its herd reaching in');
  ok(!gridSites(W, areas, [...noSpawn, ...beside], groups).some((x) => x.key === s.key), "'spread' (the default) refuses the site whose bodies would stand inside");
  ZONE_TUNE.margin = 'middle';
  try {
    const m = gridSites(W, areas, [...noSpawn, ...beside], groups);
    ok(m.some((x) => x.key === s.key && fields(x) === fields(s)), "'middle' keeps it, the very site it was");
  } finally {
    ZONE_TUNE.margin = 'spread';
  }
}
// What it keeps.
const peopleOnly = zonesOf([zoneRow('z:p', { kind: 'circle', c: [target.x, target.z], r: 30 }, ['people'])]);
ok(wildAreasOf(peopleOnly).length === 0 && gridSites(W, areas, [...noSpawn, ...wildAreasOf(peopleOnly)], groups).length === plain.length, "a zone keeping only the people keeps no site off");
ok(spawnAreaOf(zones[0]).src === 'zone' && spawnAreaOf(zones[0]).groups.length === 0, 'a zone as the laying reads it is an area of its own kind, laying nothing');
// A rectangle the size of the world's middle: everything there gone, everything outside kept.
const rect = wildAreasOf(zonesOf([zoneRow('z:r', { kind: 'rect', min: [-500, -500], max: [500, 500] })]));
const rectSites = gridSites(W, areas, [...noSpawn, ...rect], groups);
ok(rectSites.every((s) => Math.abs(s.x) > 500 || Math.abs(s.z) > 500) && rectSites.length < plain.length, `a rectangle keeps every site off itself (${plain.length - rectSites.length} gone)`);

console.log(`\n${checks} checks passed`);
