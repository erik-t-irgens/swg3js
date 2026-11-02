// A lair's site taken away by key (Map-maker II's twelfth wave; Map-maker I §8's `sitesRemoved`): `WildLife.openSites` leaves
// out a removed key and moves no other site (the laying is the one it was; only what a pass may stand is filtered); a zone
// keeping `wild` lays the world again round it; a landing that takes a standing site away puts its bodies down at once
// (`setRemovals(..., live)`), since `wanted` never drops a key that is no longer laid; and the world's next arrival starts
// with nothing taken away.
import assert from 'node:assert/strict';
import { WildLife, type WildManifest, type WildPack } from '../../../src/world/wildLife.ts';
import { wildAreasOf, zonesOf } from '../../../src/world/noSpawnZones.ts';
import type { SpawnArea } from '../../../src/world/mobiles/lairs.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const pack = (): WildPack => ({
  format: 2,
  planet: 'test_world',
  areas: [{ name: 'test_area', shape: 'circle', x: 0, z: 0, r: 2500, groups: ['g'], cap: 0 }],
  noSpawn: [{ name: 'test_town', shape: 'circle', x: 900, z: 900, r: 120, groups: [], cap: 0 }],
  statics: [],
  pools: {},
});
const manifest = (): WildManifest => ({
  format: 2,
  creatures: { test_one: { id: 'test_body', level: 5, hp: 100, hpMax: 100, damage: [3, 4], diet: '', kind: 'creature', aggressive: false, herd: true, pack: false, social: '' } },
  lairs: { test_lair: { kind: 'creature_lair', mobiles: [{ who: 'test_one', n: 3 }], boss: [], cap: 6, nest: null, building: 'none', people: false } },
  groups: { g: [{ lair: 'test_lair', weight: 1, count: 0, size: 20, limit: -1, minDiff: 1, maxDiff: 5 }] },
  nests: {},
  weaponGroups: {},
  camps: {},
  campModels: {},
});

type Private = { openSites(): readonly { key: string; x: number; z: number }[]; standing: Map<string, { nest?: { dispose(): void } | null; camp?: { dispose(): void } | null }> };

const k = new WildLife();
k.adopt(pack(), manifest());
const all = [...k.allSites];
const open0 = (k as unknown as Private).openSites();
ok(all.length > 50 && open0 === k.allSites, `with nothing taken away a pass may stand every site laid, the very list (${all.length})`);

// Two sites taken away by key.
const gone = new Set([all[5].key, all[17].key]);
k.setRemovals([], gone);
ok(k.allSites.length === all.length && k.allSites.every((s, i) => s.key === all[i].key), 'taking sites away by key lays no site differently: the laying is the one it was');
const open = (k as unknown as Private).openSites();
ok(open.length === all.length - 2 && !open.some((s) => gone.has(s.key)) && open.every((s) => all.some((a) => a.key === s.key && a.x === s.x && a.z === s.z)), 'a pass may stand every site but the two, each where it was');
ok(k.removalsReport().removedSites === 2 && k.removalsReport().removedStanding === 2, 'the console counts them');

// A landing that takes a standing site away puts its bodies down at once.
let disposed = 0;
const priv = k as unknown as Private;
priv.standing.set(all[30].key, { nest: { dispose: () => disposed++ }, camp: null });
priv.standing.set(all[31].key, { nest: { dispose: () => disposed++ }, camp: null });
const down = k.setRemovals([], new Set([all[30].key]), true);
ok(down === 1 && !priv.standing.has(all[30].key) && priv.standing.has(all[31].key) && disposed === 1, 'a landing that takes a standing site away puts it down at once, and leaves every other standing');

// A zone keeping `wild` lays the world again round it, live, and puts down what it keeps off.
const middle = all[40];
const zone: SpawnArea[] = wildAreasOf(zonesOf([{ id: 'z:clear', shape: { kind: 'circle', c: [middle.x, middle.z], r: 40 } }]));
priv.standing.set(middle.key, { nest: { dispose: () => disposed++ }, camp: null });
const zDown = k.setRemovals(zone, new Set(), true);
ok(zDown >= 1 && !priv.standing.has(middle.key) && !k.allSites.some((s) => s.key === middle.key), 'a zone landed lays the world again without the site under it and puts that site down');
ok(k.zoneKeptOff().length === 1 && k.zoneKeptOff()[0].keptOff >= 1, `the console says how many sites it keeps off (${k.zoneKeptOff()[0].keptOff})`);
ok(k.allSites.filter((s) => s.key !== middle.key).length === k.allSites.length && k.allSites.every((s) => all.some((a) => a.key === s.key && a.x === s.x && a.z === s.z)), 'and every site it lays is one it laid before, where it was');

// Unloaded, the next world starts with nothing taken away.
k.unload?.();
k.adopt(pack(), manifest());
ok(k.allSites.length === all.length && (k as unknown as Private).openSites() === k.allSites, 'the next arrival lays and opens every site again');

console.log(`\n${checks} checks passed`);
