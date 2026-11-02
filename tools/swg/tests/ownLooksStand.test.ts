// Map-maker II's thirteenth wave: a look of the owner's own worn. A placed person (the twelfth wave's people file) and a
// story cast member whose body is `own:<id>` stand in it: the person through the real `StandingPeople` and the cast member
// through the real `StoryStands`, each asking the real `MobileCatalogue` (loaded over a stand-in fetch with a looks file) for
// its body, as `World.standMobile` and the standing people's spawn do, and the look a stand-in builds for it is the look's
// own dress under its own cache key. A wearer of a look whose `from` is not here is skipped as a row with no body; a wearer of
// a look whose species pack is not here stands in the `from`'s body. A cast file and a story view name an `own:` body as
// they name any catalogue entry (`talkSet.ts`'s `CATALOGUE_ID`, `view.ts`'s `VIEW_BODY`), and the people file always did.
//
// Run: node tools/swg/tests/ownLooksStand.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { REPO } from './oldModules.ts';
import { MobileCatalogue } from '../../../src/world/mobiles/catalogue.ts';
import { lookCacheKey, looksMoved, wearersIn } from '../../../src/world/mobiles/ownLooks.ts';
import { looksFileText, readLookRow, type OwnLookRow } from '../../../src/world/editFiles/looksFile.ts';
import { placedStandingRow, readPersonRow, type PlacedPersonRow } from '../../../src/story/placedPeople.ts';
import { StandingPeople, placedHex, type PeopleDeps, type PersonSpawn, type StandingRow } from '../../../src/world/standingPeople.ts';
import { standingList } from '../../../src/world/ngeOverlay.ts';
import { StoryStands, type CastBody } from '../../../src/world/storyStands.ts';
import { loadSet } from '../../../src/story/set.ts';
import { cleanView, viewOf } from '../../../src/story/view.ts';
import { emptyBook } from '../../../src/story/book.ts';
import type { MobileCatalogueFile, MobileEntry } from '../../../src/world/mobiles/types.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

// ---- the catalogue with three looks: one worn whole, one whose species pack is not here, one whose from is not here ----
const realFile = join(REPO, 'assets-private', 'mobiles', 'catalogue.json');
const base = (): MobileEntry => ({
  id: 'dressed_fs_village_farmer',
  kind: 'dressed',
  folder: '',
  group: 'dressed/civilian',
  name: 'Fs village farmer',
  subtitle: null,
  flags: ['npc'],
  gender: 'm',
  appearance: null,
  species: 'human_male',
  pack: 'pack_human_male',
  variant: null,
  custom: { index_color_skin: 3 },
  morphs: {},
  outfit: [{ part: 'pants_s04_m_l0', item: 'pants_s04', wardrobe: 'wardrobe/human_male', values: { index_color_1: 62 } }],
  size: { collisionRadius: 0.5, collisionLength: 1.8, scale: [1, 1], cameraHeight: 1.7, stepHeight: 0.4, swimHeight: 1.2 },
  move: { run: 6, walk: 1.5, turnRun: 360, turnWalk: 180, accel: [3, 6] },
  stats: { source: 'fixture', sizeClass: 'medium', level: 10, hp: 500, damage: 30, reach: 2, aggression: 'passive', ranged: null, attackCooldown: 2, tags: [] } as unknown as MobileEntry['stats'],
  ready: true,
  outfitReady: true,
});
const text = existsSync(realFile) ? readFileSync(realFile, 'utf8') : JSON.stringify({ format: 1, entries: [base()], appearances: {}, packs: {} });
if (!existsSync(realFile)) note('no catalogue converted here: a fixture of one dressed entry stands in');
const file = JSON.parse(text) as MobileCatalogueFile;
const from = file.entries.find((e) => e.id === 'dressed_fs_village_farmer') ?? file.entries.find((e) => e.kind === 'dressed' && e.species === 'human_male' && e.ready)!;
const look = (o: Partial<OwnLookRow>): OwnLookRow =>
  readLookRow({ id: 'farmhand', from: from.id, species: 'human_male', morphs: { blend_muscle: 0.4 }, custom: { index_color_skin: 6 }, outfit: [{ part: 'jacket_s11_m_l0', item: 'jacket_s11', wardrobe: 'wardrobe/human_male', values: { index_color_1: 114 } }], name: 'Farmhand', ...o }) as OwnLookRow;
const rows = [look({}), look({ id: 'a-wookiee', species: 'wookiee_female' }), look({ id: 'lost', from: 'no_such_entry' })];
const served = new Map<string, string>([
  ['/s/assets-private/mobiles/catalogue.json', text],
  ['/s/placements/looks/all.json', looksFileText(rows)],
  ['/s/assets-private/characters/index.json', JSON.stringify({ species: [{ id: 'human_male' }, { id: 'human_female' }] })],
]);
(globalThis as unknown as Record<string, unknown>).fetch = async (url: string) => {
  const t = served.get(String(url));
  return t === undefined
    ? { ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => null, text: async () => '' }
    : { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => JSON.parse(t), text: async () => t };
};
const warn = console.warn;
const info = console.info;
console.warn = () => {};
console.info = () => {};
const cat = (await MobileCatalogue.load('/s/'))!;
console.warn = warn;
console.info = info;
const own = cat.byId('own:farmhand')!;
ok(!!own && own.own?.look === 'farmhand', 'the catalogue holds the look as a body');

/** A stand-in look, as the mobiles manager builds one: its cache key and the dress it stands in. */
const lookOf = (e: MobileEntry) => ({ key: lookCacheKey(e), species: e.species, outfit: e.outfit.map((p) => `${p.item}:${p.values.index_color_1 ?? '-'}`).join(','), custom: e.custom.index_color_skin });

// ---- a placed person in the look ----
{
  const W = 'tatooine';
  const person = (id: string, body: string, x: number): PlacedPersonRow => readPersonRow({ id, body, x, y: 0, z: 0, heading: 0 }) as PlacedPersonRow;
  ok(typeof readPersonRow({ id: 'p-1', body: 'own:farmhand', x: 0, y: 0, z: 0, heading: 0 }) !== 'string', "the people file takes an own: body as it takes any catalogue entry's");
  const placed = [person('farmhand-1', 'own:farmhand', 2), person('wookiee-1', 'own:a-wookiee', -2), person('lost-1', 'own:lost', 4)];
  const list = standingList([], [], [], [], placed.map(placedStandingRow) as unknown as StandingRow[]);
  const people = new StandingPeople();
  people.adopt(list, null, { world: W });
  const stood: { id: string; entry: MobileEntry; how: PersonSpawn }[] = [];
  const deps: PeopleDeps = {
    catalogue: () => cat as never,
    spawn: (e, at, how) => {
      stood.push({ id: how.id, entry: e as MobileEntry, how });
      return { removed: false, pos: new THREE.Vector3(at.x, at.y ?? 0, at.z), heading: at.heading ?? 0 } as never;
    },
    remove: () => {},
    centre: () => ({ x: 0, z: 0 }),
    held: () => false,
  };
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  const by = new Map(stood.map((s) => [s.id, s]));
  const fh = by.get(`stood:${W}:p${placedHex('farmhand-1')}`);
  ok(!!fh && Object.is(fh.entry, own), 'a placed person whose body is a look of the owner\'s own is stood in that look\'s entry');
  const l = lookOf(fh!.entry);
  ok(l.key === `look:own:farmhand@${own.own!.hash}` && l.outfit === 'jacket_s11:114' && l.custom === 6 && l.species === 'human_male', `and a stand-in look built for it wears the look's own dress, under its own key (${l.key}: ${l.outfit}, skin ${l.custom})`);
  const wk = by.get(`stood:${W}:p${placedHex('wookiee-1')}`);
  ok(!!wk && Object.is(wk.entry, cat.byId(from.id)), "a look whose species pack is not here is stood in its from's body");
  ok(!by.has(`stood:${W}:p${placedHex('lost-1')}`) && stood.length === 2, 'and one whose from is not here is skipped, as a row with no body is');
  // The look edited: the catalogue's entries made again, the people stood again, the new look under a new key.
  console.warn = () => {};
  cat.setOwnLooks([look({ outfit: [{ part: 'jacket_s11_m_l0', item: 'jacket_s11', wardrobe: 'wardrobe/human_male', values: { index_color_1: 7 } }] }), rows[1], rows[2]]);
  stood.length = 0;
  people.replacePlaced(placed.map(placedStandingRow) as unknown as StandingRow[], deps, null, W);
  people.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  const again = stood.find((s) => s.id === `stood:${W}:p${placedHex('farmhand-1')}`);
  ok(!!again && lookOf(again.entry).outfit === 'jacket_s11:7' && lookOf(again.entry).key !== l.key, 'stood again after the look is edited, in the edit, under a new key (never the last version from the cache)');
  cat.setOwnLooks(rows);
  console.warn = warn;
}

// ---- a story cast member in the look ----
{
  const head = { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' };
  const castFile = { path: 'cast/farmhand.jsonc', text: JSON.stringify({ id: 'farmhand', name: 'TEST FARMHAND', body: 'own:farmhand', world: 'tatooine', at: [3, 4], tree: 'talk/f' }) };
  const tree = { path: 'talk/f.jsonc', text: JSON.stringify({ format: 1, id: 'f', entry: [{ to: 'a' }], nodes: { a: { say: ['TEST'], end: true } } }) };
  const set = loadSet([head, castFile, tree]);
  ok(set.errors.length === 0 && set.set.cast['own:cast/farmhand']?.body === 'own:farmhand', `a cast file names an own: body as any catalogue entry (${set.errors.map((e) => e.message).join('; ')})`);
  const view = viewOf(emptyBook('c'), set.set, { now: 1, char: 'c', payer: 'browser' });
  const wire = cleanView(JSON.parse(JSON.stringify(view)));
  ok(view.cast[0]?.body === 'own:farmhand' && wire?.cast[0]?.body === 'own:farmhand', 'and the view carries it, across the wire too');
  const stands = new StoryStands();
  const stood: { id: string; entry: MobileEntry | undefined; body: CastBody | null }[] = [];
  const unstood: CastBody[] = [];
  const castDeps = {
    stand: (c: { id: string; body: string }) => {
      const entry = cat.byId(c.body);
      const body: (CastBody & { removed: boolean }) | null = entry ? { removed: false, label: 'x', rename(n: string) { this.label = n; } } : null;
      stood.push({ id: c.id, entry, body });
      return body;
    },
    unstand: (b: CastBody) => {
      unstood.push(b);
      (b as { removed: boolean }).removed = true;
    },
    roomFloor: () => 0,
    text: (n: unknown) => String(typeof n === 'string' ? n : 'TEST'),
  };
  stands.stepCast(wire!.cast, 'tatooine', 1, { x: 0, z: 0 }, 0, 0, 1000, castDeps);
  ok(stood.length === 1 && Object.is(stood[0].entry, cat.byId('own:farmhand')) && lookOf(stood[0].entry!).outfit === 'jacket_s11:114', 'the cast member is stood in the look, through the real StoryStands, as World.standMobile asks the catalogue');
  // The look edited under them: a landing's own rule (`looksMoved`, `wearersIn`, `StoryStands.takeDown`) takes them down,
  // and the next pass stands them again in the edit.
  const first = stood[0].body!;
  console.warn = () => {};
  const before = cat.ownBodies();
  cat.setOwnLooks([look({ outfit: [{ part: 'jacket_s11_m_l0', item: 'jacket_s11', wardrobe: 'wardrobe/human_male', values: { index_color_1: 7 } }] }), rows[1], rows[2]]);
  const moved = looksMoved(before, cat.ownBodies());
  const down = stands.takeDown(wearersIn(wire!.cast, moved), castDeps.unstand, 1);
  ok(moved.has('own:farmhand') && down === 1 && unstood.length === 1 && Object.is(unstood[0], first), 'a landing that moves the look takes the cast member wearing it down');
  stands.stepCast(wire!.cast, 'tatooine', 1, { x: 0, z: 0 }, 0, 0, 2000, castDeps);
  ok(stood.length === 2 && stood[1].id === stood[0].id && lookOf(stood[1].entry!).outfit === 'jacket_s11:7' && lookOf(stood[1].entry!).key !== lookOf(stood[0].entry!).key && Object.is(stands.bodyOf(stood[1].id), stood[1].body), 'and the next pass stands them again in the edit, under its new key');
  // A body the companion's keeper holds is no longer the cast's: a landing leaves it as it stands.
  const kept = stands.release(stood[1].id, 1);
  const before2 = cat.ownBodies();
  cat.setOwnLooks(rows);
  const downAgain = stands.takeDown(wearersIn(wire!.cast, looksMoved(before2, cat.ownBodies())), castDeps.unstand, 1);
  ok(!!kept && downAgain === 0 && unstood.length === 1, "and a body handed to the companion's keeper is left where it stands");
  // A landing that moves only the look's words takes nobody down.
  stands.stepCast(wire!.cast, 'tatooine', 1, { x: 0, z: 0 }, 0, 0, 3000, castDeps);
  const before3 = cat.ownBodies();
  cat.setOwnLooks([look({ name: 'Renamed' }), rows[1], rows[2]]);
  ok(stood.length === 3 && stands.takeDown(wearersIn(wire!.cast, looksMoved(before3, cat.ownBodies())), castDeps.unstand, 1) === 0 && unstood.length === 1 && !!stands.bodyOf(stood[2].id), 'and a landing that moved only words takes nobody down');
  cat.setOwnLooks(rows);
  console.warn = warn;
  const bad = loadSet([head, { ...castFile, text: JSON.stringify({ ...JSON.parse(castFile.text), body: 'own:Not An Id' }) }, tree]);
  ok(bad.errors.some((e) => /names the creature catalogue entry/.test(e.message)), 'an own: body that is no look id is refused as any body that is no entry is');
}

console.log(`\nownLooksStand: ${checks} checks passed`);
