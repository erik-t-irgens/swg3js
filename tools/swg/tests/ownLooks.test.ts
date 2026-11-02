// Map-maker II's thirteenth wave: the owner's own looks merged into the mobile catalogue (`src/world/mobiles/ownLooks.ts`,
// `catalogue.ts`). With no looks file the catalogue is c3d619d's to the object: its `catalogue.ts` and `catalogueIndex.ts`
// out of git, loaded beside today's over the same stand-in fetch, and every entry, its order, the spawner's tree, every
// lookup, find, readiness, model file and pack held equal, today's entries the file's very list by `Object.is`. With one, every
// look an `own:<id>` dressed entry after the converter's, in a group of its own, standing on its species in its own dress and
// taking its `from`'s size, move, stats, animation pack, flags and readiness by `Object.is`; a look whose `from` is missing or
// no dressed entry skipped and named, one whose species pack is not here skipped and its wearer stood in its `from`; the cache
// key a look is built under moving with its content and never with its words; and `buildLook` the very function it was, its
// dressing moved out into `dressLook` (which the dresser dresses its figure by) and called. Over the real catalogue where it
// is converted, else a fixture; where git cannot hand c3d619d over, held to answers and text recorded from it. And what a
// landing compares (`looksMoved` over `ownBodies`), and a looks file that could not be read is never no looks.
//
// Run: node tools/swg/tests/ownLooks.test.ts
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { oldTexts, REPO } from './oldModules.ts';
import { MobileCatalogue, readOwnLooks } from '../../../src/world/mobiles/catalogue.ts';
import { OWN_LOOKS_GROUP, groupTree, placeOf } from '../../../src/world/mobiles/catalogueIndex.ts';
import { lookCacheKey, looksMoved, mergeOwnLooks, ownLookEntry, wearersIn } from '../../../src/world/mobiles/ownLooks.ts';
import { createHash } from 'node:crypto';
import { lookHash, looksFileText, readLookRow, type OwnLookRow } from '../../../src/world/editFiles/looksFile.ts';
import type { MobileCatalogueFile, MobileEntry } from '../../../src/world/mobiles/types.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
const PRE_WAVE = 'c3d619d';

// ---- the catalogue: the real one, else a fixture of the same shape ----
const realFile = join(REPO, 'assets-private', 'mobiles', 'catalogue.json');
const fixture = (): MobileCatalogueFile => {
  const size = { collisionRadius: 0.5, collisionLength: 1.8, scale: [1, 1] as [number, number], cameraHeight: 1.7, stepHeight: 0.4, swimHeight: 1.2 };
  const move = { run: 6, walk: 1.5, turnRun: 360, turnWalk: 180, accel: [3, 6] as [number, number] };
  const stats = { source: 'fixture', sizeClass: 'medium', level: 10, hp: 500, damage: 30, reach: 2, aggression: 'passive', ranged: null, attackCooldown: 2, tags: [] };
  const dressed = (id: string, species: string, name: string): MobileEntry => ({ id, kind: 'dressed', folder: '', group: 'dressed/civilian', name, subtitle: null, flags: ['npc'], gender: /_female$/.test(species) ? 'f' : 'm', appearance: null, species, pack: `pack_${species}`, variant: null, custom: { index_color_skin: 3 }, morphs: {}, outfit: [{ part: 'jacket_s11_m_l0', item: 'jacket_s11', wardrobe: 'wardrobe/human_male', values: { index_color_1: 4 } }], size, move, stats: stats as MobileEntry['stats'], ready: true, outfitReady: true });
  return {
    format: 1,
    entries: [
      { id: 'kreetle', kind: 'creature', folder: '', group: 'creature/insect', name: 'Kreetle', subtitle: null, flags: [], gender: null, appearance: 'kreetle', species: null, pack: 'pack_bug', variant: null, custom: {}, morphs: {}, outfit: [], size, move, stats: stats as MobileEntry['stats'], ready: true, outfitReady: true },
      dressed('dressed_fs_village_farmer', 'human_male', 'Fs village farmer'),
      dressed('dressed_farmer_wife_of_tatooine', 'twilek_female', 'Farmer wife of tatooine'),
      dressed('dressed_myyydril_farmer_f_02', 'wookiee_female', 'Myyydril farmer (female 02)'),
    ],
    appearances: { kreetle: { id: 'kreetle', form: 'glb', file: 'mobiles/models/kreetle.glb', pack: 'pack_bug', joints: 10, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, sizeClass: 'small', riderPose: null, ready: true } },
    packs: {},
  } as unknown as MobileCatalogueFile;
};
const text = existsSync(realFile) ? readFileSync(realFile, 'utf8') : JSON.stringify(fixture());
if (!existsSync(realFile)) note('no catalogue converted here: a fixture of the same shape stands in');
const fileOf = () => JSON.parse(text) as MobileCatalogueFile;
const fileNow = fileOf();
const dressedIds = fileNow.entries.filter((e) => e.kind === 'dressed' && e.species && e.ready).map((e) => e.id);
const creature = fileNow.entries.find((e) => e.kind === 'creature')!;
const firstOf = (species: string) => fileNow.entries.find((e) => e.kind === 'dressed' && e.species === species && e.ready);

// ---- a stand-in fetch: the catalogue, the species index and the looks file each base is handed ----
const served = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.fetch = async (url: string) => {
  const t = served.get(String(url));
  return t === undefined
    ? { ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => null, text: async () => '' }
    : { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => JSON.parse(t), text: async () => t };
};
const serve = (base: string, looks: string | null, species: string[] | null = null) => {
  served.set(`${base}assets-private/mobiles/catalogue.json`, text);
  if (looks !== null) served.set(`${base}placements/looks/all.json`, looks);
  if (species) served.set(`${base}assets-private/characters/index.json`, JSON.stringify({ species: species.map((id) => ({ id })) }));
};
const quietly = <T>(fn: () => T): T => {
  const was = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = was;
  }
};
const quiet = <T>(fn: () => Promise<T>): Promise<T> => {
  const was = [console.info, console.warn];
  console.info = () => {};
  console.warn = () => {};
  return fn().finally(() => {
    [console.info, console.warn] = was;
  });
};

// ---- with no looks file: c3d619d's catalogue to the object ----
/** The finds the day-one asks of a catalogue. */
const FINDS = ['farmer', 'stormtrooper', 'Lava Flea', 'rancor', 'jawa', 'imperial officer', 'kreetle', 'x'];
type CatLike = { entries: readonly MobileEntry[]; groups(): unknown; byId(id: string): MobileEntry | undefined; ready(e: MobileEntry): unknown; modelFile(e: MobileEntry): unknown; packOf(e: MobileEntry): unknown; search(q: string): MobileEntry[]; resolve(q: string): MobileEntry | undefined };
/** Everything a catalogue answers over its file, as one text: every entry in its order, the tree, every lookup, readiness, model file and pack, every find and name. */
const answersOf = (c: CatLike) =>
  JSON.stringify([c.entries, c.groups(), c.entries.map((e) => [Object.is(c.byId(e.id), e), c.ready(e), c.modelFile(e), c.packOf(e)]), FINDS.map((q) => [c.search(q).map((e) => e.id), c.resolve(q)?.id ?? null]), c.byId('own:anything') ?? null]);
const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
/**
 * What c3d619d's own `catalogue.ts` and `catalogueIndex.ts` answer over the test's fixture (`answersOf`, hashed), recorded
 * from them: today's catalogue is held to it always, so where git cannot hand c3d619d over it is still held to the old one.
 */
const RECORDED_FIXTURE = '8b5636dcc0eb6587';
{
  const texts = oldTexts(['src/world/mobiles/catalogue.ts', 'src/world/mobiles/catalogueIndex.ts'], PRE_WAVE);
  serve('/now/', null);
  const now = (await quiet(() => MobileCatalogue.load('/now/')))!;
  ok(!!now && Object.is(now.entries, now.file.entries), `with no looks file today's entries are the file's very list (${now.entries.length})`);
  ok(now.ownEntries().length === 0 && now.ownRows.length === 0 && now.ownFile === null, 'and no look of the owner\'s own is there');
  ok((await readOwnLooks('/now/')) === null, 'a looks file answered missing is no file (never a fault)');
  // Over the fixture, always: today's answers are the ones recorded from c3d619d's.
  const fixtureText = JSON.stringify(fixture());
  served.set('/fix-now/assets-private/mobiles/catalogue.json', fixtureText);
  const fixNow = (await quiet(() => MobileCatalogue.load('/fix-now/')))!;
  ok(digest(answersOf(fixNow)) === RECORDED_FIXTURE, `over the fixture today's catalogue answers what ${PRE_WAVE}'s did, every entry, the tree, every lookup and find (${digest(answersOf(fixNow))})`);
  if (!texts) note(`git cannot hand ${PRE_WAVE} over here: the catalogue is held to the answers recorded from it over the fixture, and not compared over this machine's own`);
  else {
    const dir = mkdtempSync(join(tmpdir(), 'mm2-cat-'));
    try {
      const idx = join(dir, 'catalogueIndex.ts');
      writeFileSync(idx, texts.get('src/world/mobiles/catalogueIndex.ts')!.replace(/from '\.\/types'/g, `from '${pathToFileURL(join(REPO, 'src/world/mobiles/types.ts')).href}'`));
      const cat = texts
        .get('src/world/mobiles/catalogue.ts')!
        .replace(/from '\.\/types'/g, `from '${pathToFileURL(join(REPO, 'src/world/mobiles/types.ts')).href}'`)
        .replace(/from '\.\/catalogueIndex'/g, `from '${pathToFileURL(idx).href}'`)
        .replace('private constructor(readonly file: MobileCatalogueFile, readonly baseUrl: string) {', 'private constructor(file: MobileCatalogueFile, baseUrl: string) {\n    this.file = file;\n    this.baseUrl = baseUrl;');
      assert.ok(!/constructor\(readonly/.test(cat), 'the old constructor is written out');
      writeFileSync(join(dir, 'catalogue.ts'), cat);
      const oldMod = (await import(pathToFileURL(join(dir, 'catalogue.ts')).href)) as { MobileCatalogue: typeof MobileCatalogue };
      serve('/old/', null);
      const was = (await quiet(() => oldMod.MobileCatalogue.load('/old/')))!;
      ok(Object.is(was.entries, was.file.entries) && JSON.stringify(was.entries) === JSON.stringify(now.entries), `every entry and its order is ${PRE_WAVE}'s`);
      ok(JSON.stringify(was.groups()) === JSON.stringify(now.groups()), "the spawner's tree is its own");
      let lookups = 0;
      for (let i = 0; i < now.entries.length; i++) {
        const e = now.entries[i];
        assert.ok(Object.is(now.byId(e.id), now.entries[i]) && Object.is(was.byId(e.id), was.entries[i]), `byId ${e.id}`);
        assert.equal(JSON.stringify(now.ready(e)), JSON.stringify(was.ready(was.entries[i])), `ready ${e.id}`);
        assert.equal(now.modelFile(e), was.modelFile(was.entries[i]), `modelFile ${e.id}`);
        assert.equal(JSON.stringify(now.packOf(e)), JSON.stringify(was.packOf(was.entries[i])), `packOf ${e.id}`);
        lookups++;
      }
      ok(lookups === now.entries.length, `every entry's lookup, readiness, model file and pack is its own (${lookups})`);
      ok(FINDS.every((q) => JSON.stringify(now.search(q).map((e) => e.id)) === JSON.stringify(was.search(q).map((e) => e.id)) && now.resolve(q)?.id === was.resolve(q)?.id), `and every find and name it is asked (${FINDS.length})`);
      ok(now.byId('own:anything') === undefined && was.byId('own:anything') === undefined, 'a body no look stands for is nobody in both');
      served.set('/fix-old/assets-private/mobiles/catalogue.json', fixtureText);
      const fixOld = (await quiet(() => oldMod.MobileCatalogue.load('/fix-old/')))!;
      ok(digest(answersOf(fixOld)) === RECORDED_FIXTURE && answersOf(fixOld) === answersOf(fixNow), `and over the fixture ${PRE_WAVE}'s answers are the ones recorded from it, and today's (${digest(answersOf(fixOld))})`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ---- with a looks file ----
const from = firstOf('human_male') ?? fileNow.entries.find((e) => e.kind === 'dressed')!;
const look = (o: Partial<OwnLookRow> = {}): OwnLookRow =>
  readLookRow({ id: 'farmhand', from: from.id, species: from.species ?? 'human_male', morphs: { blend_muscle: 0.4 }, custom: { index_color_skin: 6 }, outfit: [{ part: 'jacket_s11_m_l0', item: 'jacket_s11', wardrobe: 'wardrobe/human_male', values: { index_color_1: 114 } }], name: 'Farmhand', ...o }) as OwnLookRow;
{
  const rows = [look(), look({ id: 'lost', from: 'no_such_entry' }), look({ id: 'beast', from: creature.id }), look({ id: 'a-wookiee', species: 'wookiee_female', name: undefined })];
  serve('/looks/', looksFileText(rows), [from.species ?? 'human_male', 'human_female']);
  const cat = (await quiet(() => MobileCatalogue.load('/looks/')))!;
  const own = cat.ownEntries();
  const n = fileNow.entries.length;
  ok(cat.entries.length === n + 1 && own.length === 1 && own[0].id === 'own:farmhand' && Object.is(cat.entries[n], own[0]), `the boot's merge puts each look after the converter's entries (${cat.entries.length} = ${n} + 1)`);
  ok(cat.entries.slice(0, n).every((e, i) => e.id === fileNow.entries[i].id) && Object.is(cat.entries[0], cat.file.entries[0]), "and leaves the converter's own in their order, the very objects");
  const fromHere = cat.byId(from.id)!;
  const e = own[0];
  ok(e.kind === 'dressed' && e.species === from.species && e.own?.look === 'farmhand' && e.own.from === from.id && e.own.hash === lookHash(look()), 'a look is a dressed entry of its species, marked the owner\'s own with its content\'s hash');
  ok(Object.is(e.size, fromHere.size) && Object.is(e.move, fromHere.move) && Object.is(e.stats, fromHere.stats) && e.pack === fromHere.pack && e.ready === fromHere.ready && JSON.stringify(e.flags) === JSON.stringify(fromHere.flags), "it takes its from's size, move, stats, animation pack, flags and readiness");
  ok(e.custom.index_color_skin === 6 && e.morphs.blend_muscle === 0.4 && e.outfit[0].values.index_color_1 === 114 && e.name === 'Farmhand', 'and stands in its own dress, colours and shape, under its own name');
  ok(placeOf(e).key === OWN_LOOKS_GROUP.key && placeOf(fromHere).key !== OWN_LOOKS_GROUP.key, "in a group of its own (the converter's entries keep theirs)");
  const groups = cat.groups();
  const dressedNode = groups.find((k) => k.key === 'dressed');
  ok(!!dressedNode && dressedNode.groups.some((x) => x.key === OWN_LOOKS_GROUP.key && x.label === OWN_LOOKS_GROUP.label && x.entries.some((y) => y.id === 'own:farmhand')), "the spawner's tree lists it under its group");
  ok(Object.is(cat.byId('own:farmhand'), e) && cat.search('Farmhand').some((x) => x.id === 'own:farmhand'), 'it is found by its body and by its name');
  const why = Object.fromEntries(cat.ownSkipped.map((s) => [s.id, s.why]));
  ok(/not in this machine's catalogue: nobody wearing it is stood/.test(why.lost ?? '') && /no dressed entry/.test(why.beast ?? ''), `a look whose from is missing, or no dressed entry, is skipped and named (${Object.keys(why).join(', ')})`);
  ok(cat.byId('own:lost') === undefined && cat.byId('own:beast') === undefined, 'and whoever wears it is skipped as a row with no body is');
  ok(/species pack, characters\/wookiee_female, is not converted here/.test(why['a-wookiee'] ?? '') && Object.is(cat.byId('own:a-wookiee'), fromHere) && cat.byId('own:a-wookiee') !== undefined, "a look whose species pack is not here is skipped, and its wearer stands in its from's body");
  ok(cat.ownFile?.rows === 4 && cat.ownFile.skipped.length === 0, 'what the boot read is kept for the console');
  // A landing: the look edited, then renamed alone, then the file emptied.
  const key = lookCacheKey(e);
  ok(key === `look:own:farmhand@${e.own!.hash}` && lookCacheKey(fromHere) === `look:${fromHere.id}`, `a look is cached under its body and its hash (${key}), every other entry as it always was`);
  cat.setOwnLooks([look({ outfit: [{ part: 'jacket_s11_m_l0', item: 'jacket_s11', wardrobe: 'wardrobe/human_male', values: { index_color_1: 115 } }] })]);
  const edited = cat.byId('own:farmhand')!;
  ok(lookCacheKey(edited) !== key, 'an edited look is cached under another key, so it is never served the last version');
  cat.setOwnLooks([look({ outfit: edited.outfit, name: 'Farmhand the second', note: 'words only' })]);
  ok(lookCacheKey(cat.byId('own:farmhand')!) === lookCacheKey(edited) && cat.byId('own:farmhand')!.name === 'Farmhand the second' && cat.byId('own:farmhand')!.description === 'words only', 'and a look whose words alone moved keeps its key');
  const ownGroup = cat.groups().find((k) => k.key === 'dressed')?.groups.find((x) => x.key === OWN_LOOKS_GROUP.key);
  ok(!!ownGroup && ownGroup.entries.some((y) => y.id === 'own:farmhand' && y.name === 'Farmhand the second'), "the spawner's tree, asked before the landing, lists the look as it stands after it (made again, never kept)");
  cat.setOwnLooks([]);
  ok(Object.is(cat.entries, cat.file.entries) && cat.byId('own:farmhand') === undefined && cat.ownEntries().length === 0, "a file emptied leaves the catalogue the file's very list again");
}

// ---- the merge alone ----
{
  const entries = fileNow.entries;
  const m = mergeOwnLooks(entries, []);
  ok(Object.is(m.entries, entries) && !m.own.length && !m.skipped.length && !m.standIns.size, 'a merge of no looks hands back the very list it was given');
  const one = mergeOwnLooks(entries, [look()], { species: () => true });
  ok(one.entries !== entries && one.entries.length === entries.length + 1 && one.own.length === 1, 'one look adds one entry');
  const src = look({ note: 'by the farm' });
  const made = ownLookEntry(src, from);
  made.outfit[0].values.index_color_1 = 1;
  made.custom.index_color_skin = 1;
  ok(src.outfit[0].values.index_color_1 === 114 && src.custom.index_color_skin === 6 && made.outfit !== src.outfit, "an entry's dress is a copy: nothing a reader of the catalogue does reaches the file's rows");
  const allSkipped = mergeOwnLooks(entries, [look({ id: 'gone', from: 'no_such_entry' })]);
  ok(Object.is(allSkipped.entries, entries) && allSkipped.skipped.length === 1, 'a merge whose every look is skipped hands back the very list too');
  const twilek = ownLookEntry(look({ species: 'twilek_female' }), { ...from, gender: 'm' });
  const man = ownLookEntry(look({ species: 'human_male' }), { ...from, gender: 'f' });
  ok(twilek.gender === 'f' && man.gender === 'm' && twilek.species === 'twilek_female', "a look's gender is its own species', whatever its from's is");
  ok(made.description === 'by the farm' && made.subtitle ===`${(from.species ?? 'human_male').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}, a look of your own`, 'its note is its description and its subtitle says whose it is');
  ok(dressedIds.length > 0, `there are dressed entries to take numbers from (${dressedIds.length})`);
}

// ---- `buildLook` is the very function it was, its dressing moved out and called ----
/** c3d619d's `buildLook`, the whole function as its file holds it (LF), hashed: recorded from it. */
const RECORDED_BUILD = '2fb42b66c6dc1af2';
{
  const read = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
  const now = read('src/world/mobiles/look.ts');
  const dressNow = read('src/world/mobiles/dressLook.ts');
  const buildOf = (s: string) => {
    const at = s.indexOf('export async function buildLook(');
    return at < 0 ? '' : s.slice(at, s.indexOf('\n}\n', at) + 3);
  };
  const head = '  for (const [name, v] of Object.entries(entry.morphs ?? {})) character.setMorph(name, v);\n';
  const tail = '    await cz.settled();\n  }\n';
  const dressingOf = (s: string) => (s.indexOf(head) < 0 ? '' : s.slice(s.indexOf(head), s.indexOf(tail, s.indexOf(head)) + tail.length));
  const call = '  const missing = await dressLook(character, entry, baseUrl);\n';
  // Today's buildLook with its one call put back as the lines it calls: c3d619d's whole buildLook, to the character.
  const rebuilt = buildOf(now).includes(call) ? buildOf(now).replace(call, dressingOf(dressNow)) : '';
  ok(dressingOf(dressNow).length > 600 && /const missing: string\[\] = \[\];/.test(dressingOf(dressNow)) && /\n  return missing;\n\}\n$/.test(dressNow.slice(dressNow.indexOf(tail))), "dressLook is buildLook's own dressing lines, its pieces short handed back");
  ok(digest(rebuilt) === RECORDED_BUILD && /if \(hold && sources\) shareLook\(hold, sources\);/.test(rebuilt), `today's buildLook with its dressing put back in place of its call is ${PRE_WAVE}'s whole buildLook, the share and everything after it included (${digest(rebuilt)})`);
  const t = oldTexts(['src/world/mobiles/look.ts'], PRE_WAVE);
  if (!t) note(`git cannot hand ${PRE_WAVE} over here: buildLook is held to the text recorded from it`);
  else {
    const was = t.get('src/world/mobiles/look.ts')!;
    ok(rebuilt === buildOf(was) && digest(buildOf(was)) === RECORDED_BUILD, `and ${PRE_WAVE}'s own buildLook is that text, the one recorded (${buildOf(was).split('\n').length} lines)`);
    ok(/return `look:\$\{entry\.id\}`;/.test(was) && /return lookCacheKey\(entry\);/.test(now), 'its cache key is the merged one, the only other line of the file that moved');
  }
}

// ---- what a landing compares, and the reads that could not be made ----
{
  const base = new Map([
    ['own:a', '11111111'],
    ['own:b', '22222222'],
    ['own:w', '>dressed_x'],
  ]);
  ok(looksMoved(base, new Map(base)).size === 0, 'a landing that moved nothing moves no body');
  ok([...looksMoved(base, new Map([...base, ['own:a', '33333333']]))].join() === 'own:a', 'an edited look moves its body');
  ok([...looksMoved(base, new Map([...base, ['own:c', '44444444']]))].join() === 'own:c', 'an added one moves its own');
  const less = new Map(base);
  less.delete('own:b');
  ok([...looksMoved(base, less)].join() === 'own:b', 'and one taken out moves its own');
  ok([...looksMoved(base, new Map([...base, ['own:w', '>dressed_y']]))].join() === 'own:w', "a look standing in another entry's body moves when that entry does");
  // The catalogue's own answer over its looks: a look renamed alone stands the same.
  served.set('/moved/assets-private/mobiles/catalogue.json', text);
  served.set('/moved/placements/looks/all.json', looksFileText([look(), look({ id: 'a-wookiee', species: 'wookiee_female' })]));
  served.set('/moved/assets-private/characters/index.json', JSON.stringify({ species: [{ id: from.species ?? 'human_male' }] }));
  const cat = (await quiet(() => MobileCatalogue.load('/moved/')))!;
  const before = cat.ownBodies();
  ok(before.get('own:farmhand') === lookHash(look()) && before.get('own:a-wookiee') === `>${from.id}`, `the catalogue answers every look's body, one in force by its hash and one standing in another's body by that body (${JSON.stringify([...before])})`);
  quietly(() => cat.setOwnLooks([look({ name: 'Farmhand renamed', note: 'words' }), look({ id: 'a-wookiee', species: 'wookiee_female' })]));
  ok(looksMoved(before, cat.ownBodies()).size === 0, 'a look whose words alone moved moves no body');
  ok([...wearersIn([{ id: 'cast_a', body: 'own:farmhand' }, { id: 'cast_b', body: 'dressed_x' }, { id: 'cast_c', body: 'own:a-wookiee' }], new Set(['own:farmhand', 'own:a-wookiee']))].join() === 'cast_a,cast_c', 'and those wearing a moved look are found by their body');
  // A read that could not be made is no file's absence: a server's fault and a fetch that throws are both unread.
  const was = g.fetch;
  g.fetch = async () => ({ ok: false, status: 500, headers: { get: () => 'text/plain' }, json: async () => null, text: async () => '' });
  ok((await readOwnLooks('/broken/')) === 'unread', 'a looks file answered with a fault is unread (never no looks)');
  g.fetch = async () => {
    throw new Error('the line went down');
  };
  ok((await readOwnLooks('/broken/')) === 'unread', 'and so is one whose fetch throws');
  g.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => null, text: async () => '<!doctype html>' });
  ok((await readOwnLooks('/broken/')) === null, "while the page handed back for a public file nobody wrote is no file, as a 404 is");
  g.fetch = was;
}

console.log(`\nownLooks: ${checks} checks passed`);
