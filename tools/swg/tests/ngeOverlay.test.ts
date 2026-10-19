// The owner's local NGE overlay at run time (`src/world/ngeOverlay.ts`, `WildLife`, `StandingPeople`): SOE's own
// people for Kashyyyk and Mustafar laid over the world's own wildlife pack, **after** Core3's rows and the heralds,
// so that nobody else's name moves in any browser, and left out wherever a server holds the world unless the owner
// says otherwise. Every name here is TEST data; nothing of the copy is in this file.

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { NGE_OVERLAY_TUNE, emptyPack, mergeOverlay, nearArrival, ngeOverlay, overlayStands, picksFights, rowKeptOff, serverHoldsFor, standingList, whereOf } from '../../../src/world/ngeOverlay.ts';
import { WildLife, type WildDeps, type WildManifest, type WildPack } from '../../../src/world/wildLife.ts';
import { PEOPLE_TUNE, StandingPeople, patrolFor, postFor, sourceOfRow, type PeopleDeps, type PersonSpawn, type StandingRow } from '../../../src/world/standingPeople.ts';
import { LAIR_TUNE, gridSites } from '../../../src/world/mobiles/lairs.ts';
import type { Post } from '../../../src/world/mobiles/brain.ts';
import { NGE_FORMAT, ngeStatus } from '../ngepack.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ------------------------------------------------------------------------------------------- the packs
const row = (key: string, who: string, x: number, z: number, extra: Partial<StandingRow> = {}): StandingRow => ({ key, who, id: `${who}_body`, x, y: 0, z, heading: 0, cell: 0, respawn: 300, where: 'test_where', ...extra });

const core3Pack = (): WildPack => ({
  format: 2,
  planet: 'test_world',
  areas: [{ name: 'test_core3_area', shape: 'circle', x: 0, z: 0, r: 3000, groups: ['test_core3_group'], cap: 0 }],
  noSpawn: [{ name: 'test_core3_none', shape: 'circle', x: 9000, z: 9000, r: 5, groups: [], cap: 0 }],
  statics: [row('aaaaaaaaaaaa', 'test_core3_one', 5, 5), row('bbbbbbbbbbbb', 'test_core3_two', -10, 4), row('cccccccccccc', 'test_core3_three', 8, -6)],
  pools: { test_core3_pool: ['test_core3_one'] },
});
const core3Manifest = (): WildManifest => ({
  format: 2,
  creatures: { test_core3_one: { id: 'test_core3_one_body', level: 5, hp: 100, hpMax: 100, damage: [3, 4], diet: '', kind: 'npc', aggressive: false, herd: false, pack: false, social: '' } },
  lairs: { test_core3_lair: { kind: 'creature_lair', mobiles: [{ who: 'test_core3_one', n: 1 }], boss: [], cap: 6, nest: null, building: 'none', people: false } },
  groups: { test_core3_group: [{ lair: 'test_core3_lair', weight: 1, count: 0, size: 20, limit: -1, minDiff: 1, maxDiff: 5 }] },
  nests: {},
  weaponGroups: { test_core3_weapons: ['object/weapon/test_core3.iff'] },
  camps: {},
  campModels: {},
});
const overPack = (noSpawn: WildPack['noSpawn'] = [{ name: 'nge:test_small', shape: 'circle', x: 7000, z: 7000, r: 10, groups: [], cap: 0 }]): WildPack => ({
  format: 2,
  planet: 'test_zone',
  areas: [{ name: 'nge:test_spawn_one', shape: 'rect', x: -2000, z: -2000, x2: -1000, z2: -1000, groups: ['nge:test_spawn_one'], cap: 0 }],
  noSpawn,
  statics: [row('n00000000001', 'nge:test_creature', 3, 3, { src: 'nge', roam: 12 }), row('n00000000002', 'nge:test_creature', -3, 2, { src: 'nge', still: true, roam: 0 })],
  pools: { 'nge:test_pool': ['nge:test_creature'] },
});
const overManifest = (): WildManifest => ({
  format: 2,
  creatures: { 'nge:test_creature': { id: 'test_overlay_body', level: 40, hp: 500, hpMax: 500, damage: [20, 20], diet: '', kind: 'npc', aggressive: true, herd: false, pack: false, social: '', game: { level: 40, hp: 520, damage: 30, aggression: 'aggressive', ranged: null, attackable: true } } },
  lairs: { 'nge:test_lair': { kind: 'nge', mobiles: [{ who: 'nge:test_creature', n: 2 }], boss: [], cap: 2, nest: null, building: 'none', people: false } },
  groups: { 'nge:test_spawn_one': [{ lair: 'nge:test_lair', weight: 1, count: 0, size: 20, limit: -1, minDiff: 0, maxDiff: 0 }] },
  nests: {},
  weaponGroups: { 'nge:test_word': ['object/weapon/test_overlay.iff'] },
  camps: {},
  campModels: {},
});

// ------------------------------------------------------------------------------------------- the merge
{
  const p = core3Pack();
  const m = core3Manifest();
  const none = mergeOverlay(p, m, null, null);
  ok(none.pack === p && none.manifest === m && none.rows.length === 0, 'handed no overlay, the merge hands back exactly what it was given');
  const got = mergeOverlay(p, m, overPack(), overManifest());
  ok(got.pack!.areas.map((a) => a.name).join(',') === 'test_core3_area,nge:test_spawn_one' && got.pack!.noSpawn.map((a) => a.name).join(',') === 'test_core3_none,nge:test_small', "the overlay's areas and no-spawn places come after Core3's");
  ok(got.pack!.statics.length === 3 && got.rows.length === 2 && got.pack!.planet === 'test_world', "Core3's people stay the pack's own, the overlay's are handed back apart, and the world keeps its name");
  ok(!!got.manifest!.creatures.test_core3_one && !!got.manifest!.creatures['nge:test_creature'] && !!got.manifest!.lairs['nge:test_lair'] && !!got.manifest!.groups.test_core3_group && !!got.manifest!.weaponGroups!['nge:test_word'] && !!got.pack!.pools!['nge:test_pool'] && !!got.pack!.pools!.test_core3_pool, 'the creatures, lairs, groups, weapon groups and lists of both stand side by side');
  ok(p.areas.length === 1 && Object.keys(m.creatures).length === 1, "and Core3's own pack is left as it was");
  const stray = (bend: (o: { pack: WildPack; manifest: WildManifest }) => void): boolean => {
    const o = { pack: overPack(), manifest: overManifest() };
    bend(o);
    try {
      mergeOverlay(p, m, o.pack, o.manifest);
      return false;
    } catch {
      return true;
    }
  };
  ok(stray((o) => (o.manifest.creatures.test_plain = o.manifest.creatures['nge:test_creature'])), 'an overlay naming a creature without nge: is refused whole');
  ok(stray((o) => (o.pack.areas[0].name = 'test_area')) && stray((o) => (o.pack.areas[0].groups = ['test_group'])), 'and one naming an area or a group without it');
  ok(stray((o) => ((o.pack.statics[0] as StandingRow).who = 'test_core3_one')) && stray((o) => ((o.pack.statics[0] as StandingRow).draw = [['test_core3_pool', 1]])), "and one whose row would stand one of Core3's");
  ok(stray((o) => (o.manifest.lairs['nge:test_lair'].mobiles[0].who = 'test_core3_one')), "and one whose lair would stand one of Core3's");
  // The tables the merge spreads over Core3's own: a key there without the prefix would overwrite one of theirs.
  ok(stray((o) => (o.manifest.weaponGroups!.test_core3_weapons = ['object/weapon/test_overlay.iff'])) && stray((o) => (o.pack.pools!.test_core3_pool = ['nge:test_creature'])), "and one whose weapon group or list would stand in for one of Core3's of the same name");
  ok(stray((o) => (o.manifest.groups['nge:test_spawn_one'][0].lair = 'test_core3_lair')), "and one whose group's entry names one of Core3's lairs");
}

// ------------------------------------------------------------------------------------------- the wild side
{
  const a = new WildLife();
  const b = new WildLife();
  a.adopt(core3Pack(), core3Manifest());
  b.adopt(core3Pack(), core3Manifest(), null, null);
  ok(JSON.stringify(a.allSites) === JSON.stringify(b.allSites) && JSON.stringify(a.peopleRows()) === JSON.stringify(b.peopleRows()) && JSON.stringify(a.peopleCreatures()) === JSON.stringify(b.peopleCreatures()) && JSON.stringify(a.peopleExtras()) === JSON.stringify(b.peopleExtras()) && b.overlayRows().length === 0, 'with no overlay the wild world adopts to the very same thing');
  const c = new WildLife();
  const was = console.warn;
  console.warn = () => {};
  const bad = overManifest();
  bad.creatures.test_plain = bad.creatures['nge:test_creature'];
  c.adopt(core3Pack(), core3Manifest(), overPack(), bad);
  console.warn = was;
  ok(JSON.stringify(c.allSites) === JSON.stringify(a.allSites) && c.overlayRows().length === 0, 'and an overlay that is refused leaves the world exactly as Core3 stands it');

  // A Kashyyyk-shaped world: no Core3 pack at all, the overlay alone.
  const k = new WildLife();
  k.adopt(null, null, overPack(), overManifest());
  ok(k.ready && k.peopleExtras().world === 'test_zone' && k.overlayRows().length === 2 && !!k.peopleCreatures()?.['nge:test_creature'], "a world Core3 holds nothing of starts from an empty pack named for the overlay's world");
  ok(k.allSites.length > 0 && k.allSites.every((s) => s.area === 'nge:test_spawn_one') && k.bySource().sites.nge === k.allSites.length && k.bySource().sites.core3 === 0, `the grid lays its sites over the overlay's areas (${k.allSites.length}), counted as the overlay's`);
  const held = new WildLife();
  held.adopt(null, null, overPack([{ name: 'nge:test_all', shape: 'rect', x: -5000, z: -5000, x2: 5000, z2: 5000, groups: [], cap: 0 }]), overManifest());
  ok(held.allSites.length === 0, 'with a no-spawn region holding the areas whole kept, the grid lays nothing: which is why the converter drops it');
  const sites = gridSites('test_zone', overPack().areas, overPack().noSpawn, overManifest().groups);
  ok(sites.length === k.allSites.length, 'and gone, the game lays them by its own gridSites');
  ok(emptyPack('test_zone').format === 2 && emptyPack('test_zone').planet === 'test_zone', 'the empty pack is of the format the game reads');
  // A change to how sites are laid lays the world out again from the merged pack it holds: the overlay's people,
  // handed apart from it, stay.
  const laid = k.allSites.length;
  ok(k.retune({ cell: LAIR_TUNE.cell }).includes('cell') && k.overlayRows().length === 2 && k.allSites.length === laid, "laying the world out again keeps the overlay's people and lays the same sites");
}

// ------------------------------------------------------------------------------------------- the people
interface Body {
  dead: boolean;
  removed: boolean;
  pos: THREE.Vector3;
  how: PersonSpawn;
  post?: Post | null;
  homeX?: number;
  homeZ?: number;
  patrol?: unknown;
}
function game(): { deps: PeopleDeps; bodies: Body[] } {
  const bodies: Body[] = [];
  const deps: PeopleDeps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
    spawn: (_entry, at, how) => {
      const b: Body = { dead: false, removed: false, pos: new THREE.Vector3(at.x, at.y ?? 0, at.z), how };
      bodies.push(b);
      return b as never;
    },
    remove: (m) => {
      (m as unknown as Body).removed = true;
    },
    centre: () => ({ x: 0, z: 0 }),
    held: () => false,
  };
  return { deps, bodies };
}
/** Every row stood from a list, by its key: the name it is shared under. */
function names(list: readonly StandingRow[], world: string): Map<string, string> {
  const people = new StandingPeople();
  people.adopt(list, null, { world });
  const { deps, bodies } = game();
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  const out = new Map<string, string>();
  for (const b of bodies) {
    const r = list[b.how.index];
    out.set(r.key!, b.how.id);
  }
  return out;
}
{
  const own = core3Pack().statics as StandingRow[];
  const heralds = [row('dddddddddddd', 'test_herald', 2, -2, { from: 'herald', still: true, peaceful: true })];
  const over = overPack().statics as StandingRow[];
  const before = standingList(own, heralds, []);
  const after = standingList(own, heralds, over);
  ok(after.length === before.length + 2 && after.slice(0, before.length).every((r, i) => r === before[i]), "the overlay's people come after Core3's and the heralds', every one of those keeping its place");
  ok(standingList([], heralds, over).length === 2 && standingList([], heralds, []).length === 0, 'a world with no people of its own stands no herald, with the overlay or without it, as it always has');
  const was = names(before, 'test_world');
  const now = names(after, 'test_world');
  ok(was.size === 4 && [...was].every(([key, id]) => now.get(key) === id), "every Core3 row and herald is stood under the same stood: name with the overlay as without");
  ok(now.get('n00000000001') === 'stood:test_world:4' && now.get('n00000000002') === 'stood:test_world:5', "and the overlay's under the names after theirs");

  const k = new WildLife();
  k.adopt(null, null, overPack(), overManifest());
  const people = new StandingPeople();
  const list = standingList(k.peopleRows() as StandingRow[], [], k.overlayRows() as StandingRow[]);
  people.adopt(list, k.peopleCreatures() as never, k.peopleExtras());
  const { deps, bodies } = game();
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  ok(bodies.length === 2 && bodies.every((b) => b.how.id.startsWith('stood:test_zone:')) && !bodies.some((b) => b.how.id.startsWith('stood:here:')), "on a world Core3 holds nothing of, the overlay's rows are named stood:<the pack id>:<n>, never stood:here:");
  ok(bodies.every((b) => b.how.overrides?.level === 40 && b.how.overrides?.aggression === 'aggressive'), "and stood with their own creature's numbers out of the overlay's fleet half");
  const src = people.bySource();
  ok(src.rows.nge === 2 && src.up.nge === 2 && src.rows.core3 === 0, 'the console counts them as the overlay\'s');
  ok(sourceOfRow({ from: 'herald' }) === 'herald' && sourceOfRow({ ours: true }) === 'ours' && sourceOfRow({}) === 'core3' && sourceOfRow({ src: 'nge', from: 'herald' }) === 'nge', 'and every row by where it came from');

  // How far a row of the overlay steps about its spot.
  const roaming = bodies.find((b) => Math.abs(b.pos.x + 3) < 1e-6);
  ok(roaming?.post?.kind === 'near' && roaming.post.tune.postRadius === 12, "a row its spawner let loiter steps about within its spawner's radius");
  const still = bodies.find((b) => Math.abs(b.pos.x - 3) < 1e-6);
  ok(still?.post?.kind === 'still' && still.post.tune === PEOPLE_TUNE, 'one standing guard does not step at all');
  const t = postFor({ heading: 0, roam: 12 }).tune;
  ok(t.postEvery === PEOPLE_TUNE.postEvery && postFor({ heading: 0, roam: 12 }).tune === t, "how often it steps is the standing people's own, read live, and one radius is one tune");
  NGE_OVERLAY_TUNE.roamEvery = [1, 2];
  ok(t.postEvery[0] === 1 && t.postEvery[1] === 2, 'and the overlay\'s own, once the owner gives it one');
  NGE_OVERLAY_TUNE.roamEvery = null;
  ok(postFor({ heading: 0 }).tune === PEOPLE_TUNE && postFor({ heading: 0, roam: 0 }).tune === PEOPLE_TUNE, "a row with no radius of its own takes the standing people's post");

  // The overlay's patrollers walk their rounds, fighters and all: the server's patrol spawner walked them.
  const round = [{ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }];
  ok(patrolFor({ route: round, walks: true }, { x: 0, z: 0 }, 0) !== null && patrolFor({ route: round }, { x: 0, z: 0 }, 0) === null && patrolFor({ route: round, peaceful: true }, { x: 0, z: 0 }, 0) !== null, "a row marked a walker walks its round whatever it may be fought, where a town's combat walker stands at its post");
}

// ------------------------------------------------------------------- where the player comes in and back
{
  const home = { x: 0, z: 0 };
  ok(nearArrival(10, 10, home, 0, 64) && !nearArrival(70, 0, home, 0, 64) && nearArrival(70, 0, home, 10, 64) && !nearArrival(10, 10, null, 0, 64) && !nearArrival(10, 10, home, 0, 0), 'a place is near where the player comes in within the clear and its own reach, and never with no such place or a clear of nought');
  const r = { src: 'nge' as const, roam: 0, route: undefined };
  ok(rowKeptOff(r, { x: 30, z: 0 }, true, home, 64) && !rowKeptOff(r, { x: 30, z: 0 }, false, home, 64) && !rowKeptOff({ src: undefined }, { x: 30, z: 0 }, true, home, 64), "only one of the overlay's who picks a fight on sight is kept off; nobody else's row is touched");
  ok(rowKeptOff({ src: 'nge', roam: 20 }, { x: 80, z: 0 }, true, home, 64) && rowKeptOff({ src: 'nge', route: [{ x: 300, z: 0 }, { x: 5, z: 5 }] }, { x: 300, z: 0 }, true, home, 64), 'and one whose roam or round would bring it inside is kept off too');
  ok(picksFights({ game: { aggression: 'aggressive' } }) && !picksFights({ game: { aggression: 'defensive' }, aggressive: true }) && picksFights({ aggressive: true }) && !picksFights(null), "a creature picks fights by its own temper, else by its record's flag");

  // Stood: the overlay's fighter by the arrival is not; a passive one is; Core3's own is never touched.
  const calm = overManifest();
  calm.creatures['nge:test_calm'] = { ...calm.creatures['nge:test_creature'], aggressive: false, game: { ...calm.creatures['nge:test_creature'].game!, aggression: 'passive' } };
  const list: StandingRow[] = [
    row('aaaaaaaaaaaa', 'nge:test_creature', 5, 5),
    row('n00000000001', 'nge:test_creature', 3, 3, { src: 'nge' }),
    row('n00000000002', 'nge:test_calm', -3, 2, { src: 'nge' }),
    row('n00000000003', 'nge:test_creature', 80, 0, { src: 'nge' }),
  ];
  const stand = (arrival: { x: number; z: number } | null, clear: number) => {
    const kept = NGE_OVERLAY_TUNE.arrivalClear;
    NGE_OVERLAY_TUNE.arrivalClear = clear;
    try {
      const people = new StandingPeople();
      people.adopt(list, calm.creatures as never, { world: 'test_zone' });
      const g = game();
      g.deps.arrival = () => arrival;
      people.step(0, 0, new THREE.Vector3(0, 0, 0), g.deps, true);
      return { people, g, keys: g.bodies.filter((b) => !b.removed).map((b) => list[b.how.index].key).sort() };
    } finally {
      NGE_OVERLAY_TUNE.arrivalClear = kept;
    }
  };
  const near = stand(home, 64);
  ok(near.keys.join(',') === 'aaaaaaaaaaaa,n00000000002,n00000000003', `by the place the player comes in, the overlay's fighter is not stood, its passive one is, Core3's is, and the overlay's far one is (${near.keys.join(', ')})`);
  ok(stand(home, 0).keys.length === 4 && stand(null, 64).keys.length === 4, 'with a clear of nought, or no such place, everybody stands where the data puts them');
  // That place moved onto somebody of the overlay's already standing (a teleport): put down.
  const kept = NGE_OVERLAY_TUNE.arrivalClear;
  NGE_OVERLAY_TUNE.arrivalClear = 64;
  try {
    const people = new StandingPeople();
    people.adopt(list, calm.creatures as never, { world: 'test_zone' });
    const g = game();
    let arrival: { x: number; z: number } | null = { x: 5000, z: 5000 };
    g.deps.arrival = () => arrival;
    people.step(0, 0, new THREE.Vector3(0, 0, 0), g.deps, true);
    const fighter = g.bodies.find((b) => list[b.how.index].key === 'n00000000001');
    arrival = home;
    people.step(0, 0, new THREE.Vector3(0, 0, 0), g.deps, true);
    ok(!!fighter && fighter.removed && people.last.offArrival >= 1 && !g.bodies.some((b) => list[b.how.index].key === 'aaaaaaaaaaaa' && b.removed), "and one standing when that place moves onto it is put down, Core3's beside it left be");
  } finally {
    NGE_OVERLAY_TUNE.arrivalClear = kept;
  }

  // The wild side: the overlay's herds that pick a fight keep clear too, laid on a fine grid so there are some near.
  const area = { name: 'nge:test_spawn_one', shape: 'circle' as const, x: 0, z: 0, r: 400, groups: ['nge:test_spawn_one'], cap: 64 };
  const herds = (aggressive: boolean, clear: number) => {
    const m = overManifest();
    if (!aggressive) m.creatures['nge:test_creature'] = { ...m.creatures['nge:test_creature'], aggressive: false, game: { ...m.creatures['nge:test_creature'].game!, aggression: 'passive' } };
    const had = { cell: LAIR_TUNE.cell, gap: LAIR_TUNE.gap, live: LAIR_TUNE.liveLairs };
    const keptClear = NGE_OVERLAY_TUNE.arrivalClear;
    Object.assign(LAIR_TUNE, { cell: 50, gap: 0, liveLairs: 400 });
    NGE_OVERLAY_TUNE.arrivalClear = clear;
    try {
      const w = new WildLife();
      w.adopt(null, null, { ...overPack([]), areas: [area] }, m);
      const bodies: { x: number; z: number }[] = [];
      const deps: WildDeps = {
        catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
        spawn: (_e, at) => {
          const b = { x: at.x, z: at.z, dead: false, removed: false, pos: { x: at.x, y: 0, z: at.z } };
          bodies.push(b);
          return b as never;
        },
        remove: () => {},
        centre: () => ({ x: 0, z: 0 }),
        held: () => false,
        arrival: () => home,
      };
      w.step(1, 1, new THREE.Vector3(0, 0, 0), deps, true);
      return { bodies, w };
    } finally {
      Object.assign(LAIR_TUNE, { cell: had.cell, gap: had.gap, liveLairs: had.live });
      NGE_OVERLAY_TUNE.arrivalClear = keptClear;
    }
  };
  const fierce = herds(true, 64);
  const nearest = Math.min(...fierce.bodies.map((b) => Math.hypot(b.x, b.z)));
  ok(fierce.bodies.length > 0 && nearest >= 64 && fierce.w.last.offArrival > 0, `the overlay's herds that pick a fight stand clear of where the player comes in (nearest ${nearest.toFixed(1)} m, ${fierce.w.last.offArrival} sites kept off)`);
  const open = herds(true, 0);
  const tame = herds(false, 64);
  ok(Math.min(...open.bodies.map((b) => Math.hypot(b.x, b.z))) < 64 && Math.min(...tame.bodies.map((b) => Math.hypot(b.x, b.z))) < 64, 'and with a clear of nought, or herds that pick no fight, they stand there as the grid lays them');
}

// ------------------------------------------------------------------------------------------- where it stands
{
  ok(overlayStands('alone', false) && !overlayStands('alone', true), 'alone: stood where no server holds the world, and not where one does');
  ok(overlayStands('always', false) && overlayStands('always', true), 'always: stood on a server too');
  ok(!overlayStands('never', false) && !overlayStands('never', true), 'never: nowhere');
  ok(whereOf('0') === 'never' && whereOf('always') === 'always' && whereOf('alone') === 'alone' && whereOf('test_word') === null && whereOf(null) === null, "the stored switch reads '0' and 'always'");
  const line = (authority: string, mode = 'pending') => ({ authority, mode });
  ok(serverHoldsFor(line('server'), true, false, 0) === true && serverHoldsFor(line('local'), false, false, 0) === false, 'a server holding the claim holds the world; no line wanted, nobody does');
  ok(serverHoldsFor(line('local'), true, false, 1000) === null && serverHoldsFor(line('local'), true, false, 7000) === false, 'a line wanted and silent is waited on, and past the wait nobody holds it');
  ok(serverHoldsFor(line('local', 'relay'), true, false, 0) === true && serverHoldsFor(line('local'), false, true, 0) === true, 'the relay that came before is still a server others share, and a saved server connected only after this loading screen is taken as holding it');
}

// ------------------------------------------------------------------------------------------- the load
{
  const files: Record<string, unknown> = {};
  const was = globalThis.fetch;
  const log = console.log;
  const said: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const path = String(url).replace(/^.*assets-private\//, '');
    if (!(path in files)) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return new Response(JSON.stringify(files[path]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  console.log = (...a: unknown[]) => {
    const text = a.map(String).join(' ');
    if (text.startsWith('nge overlay')) said.push(text);
    else log(...a);
  };
  try {
    files['test_world/spawns.json'] = core3Pack();
    files['spawns/manifest.json'] = core3Manifest();
    ngeOverlay.forget();
    const plain = new WildLife();
    await plain.load('test_world');
    const direct = new WildLife();
    direct.adopt(core3Pack(), core3Manifest());
    ok(JSON.stringify(plain.allSites) === JSON.stringify(direct.allSites) && plain.overlayRows().length === 0 && !said.some((l) => l.includes('nge overlay')), 'with no overlay on this install a load reads exactly what it read before, and says nothing of it');

    files['nge/index.json'] = { format: NGE_FORMAT, local: true, source: 'nge', converted: 'test_now', zones: { test_zone: { rows: 2, areas: 1 } } };
    files['nge/spawns/test_zone.json'] = overPack();
    files['nge/spawns/manifest.json'] = overManifest();
    ngeOverlay.forget();
    const kept = NGE_OVERLAY_TUNE.where;
    NGE_OVERLAY_TUNE.where = 'alone';
    const alone = new WildLife();
    await alone.load('test_zone', '', { serverHolds: async () => false });
    ok(alone.overlayRows().length === 2 && alone.ready && ngeOverlay.last.left === '' && said.some((l) => /nge overlay: 2 people and 1 wild areas on test_zone/.test(l)), 'a world the index lists takes the overlay where no server holds it, and the load says so in one line');
    const held = new WildLife();
    await held.load('test_zone', '', { serverHolds: async () => true });
    ok(held.overlayRows().length === 0 && !held.ready && ngeOverlay.last.left === 'server' && said.some((l) => /a server holds test_zone/.test(l)), 'with a server holding it the overlay is left out, and the line says why');
    NGE_OVERLAY_TUNE.where = 'always';
    const always = new WildLife();
    await always.load('test_zone', '', { serverHolds: async () => true });
    ok(always.overlayRows().length === 2, "'always' stands it on a server too");
    NGE_OVERLAY_TUNE.where = 'never';
    const never = new WildLife();
    await never.load('test_zone', '', { serverHolds: async () => false });
    ok(never.overlayRows().length === 0 && ngeOverlay.last.left === 'off', "'never' stands it nowhere");
    NGE_OVERLAY_TUNE.where = 'alone';
    const other = new WildLife();
    await other.load('test_world', '', { serverHolds: async () => false });
    ok(JSON.stringify(other.allSites) === JSON.stringify(direct.allSites) && other.overlayRows().length === 0, 'and a world the index does not list loads as it did');
    // An index that does not say it is the local overlay's is no overlay at all.
    for (const bent of [{ local: undefined }, { source: 'test_other' }]) {
      files['nge/index.json'] = { format: NGE_FORMAT, local: true, source: 'nge', converted: 'test_now', zones: { test_zone: { rows: 2, areas: 1 } }, ...bent };
      ngeOverlay.forget();
      await ngeOverlay.fetchIndex('');
      ok(!ngeOverlay.present && !ngeOverlay.overlayFor('test_zone'), `an index ${'local' in bent ? 'that does not say it is local' : "whose source is not the overlay's"} is taken as none`);
    }
    NGE_OVERLAY_TUNE.where = kept;
  } finally {
    globalThis.fetch = was;
    console.log = log;
    ngeOverlay.forget();
  }
}

// ------------------------------------------------------------------------------------------- the wiring
// The game's own hand-overs, which every test above makes for itself: read as text, since the app does not load
// under node. Taken out, the overlay would stand on every server others share, and nothing above would notice.
{
  const text = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
  const main = text('src/main.ts');
  const world = text('src/world/world.ts');
  ok(/this\.world\.serverHoldsWorld = \(\) => this\.serverHoldsHere\(\);/.test(main) && /serverHoldsFor\(this\.net\.session, this\.net\.wanted, this\.relayAsked, performance\.now\(\) - began\)/.test(main), "the game hands the world whether a server holds it, by the props keeper's own line and wait");
  ok(/const kept = whereOf\(localStorage\.getItem\('swg\.nge'\)\);\s*if \(kept\) NGE_OVERLAY_TUNE\.where = kept;/.test(main) && /void ngeOverlay\.fetchIndex\(import\.meta\.env\.BASE_URL\);/.test(main), "the stored switch is read once at load, and the index asked for once a session");
  ok(/this\.world\.arrivalPoint = \(\) => this\.spawn;/.test(main), 'the game hands the world where the player comes in and back: the spot a respawn comes round at');
  ok(/await wildLife\.load\(this\.packId, import\.meta\.env\.BASE_URL, \{ serverHolds: this\.serverHoldsWorld \?\? undefined \}\);/.test(world), "the world's load asks it whether a server holds the world");
  ok((world.match(/arrival: \(\) => this\.arrivalPoint\?\.\(\) \?\? null,/g) ?? []).length === 2, 'and hands that place to the standing people and to the wild world alike');
  ok(/for \(const r of \[\.\.\.\(wildLife\.peopleRows\(\) as StandingRow\[\]\), \.\.\.\(wildLife\.overlayRows\(\) as StandingRow\[\]\)\]\)/.test(world), "and the overlay's posts join the things a race track's corridor is checked against");
}

// ------------------------------------------------------------------------------------------- status
{
  ok(ngeStatus(null, {}) === null, 'status says nothing of an overlay that is not there');
  const index = { format: NGE_FORMAT, converted: 'test', copy: { root: 'C:/test_copy' }, catalogue: { converted: 'test_cat' }, zones: { test_zone: { rows: 1, areas: 0, layout: 'test_a' } } };
  const stale = ngeStatus(index, { catalogue: 'test_cat', layouts: { test_zone: 'test_b' } })!;
  ok(/spawns .*--nge=C:\/test_copy/.test(stale.ask!.command) && /test_zone/.test(stale.ask!.why), 'and asks for spawns again with the copy the index recorded, naming what moved');
}

console.log(`\n${passed} checks passed`);
