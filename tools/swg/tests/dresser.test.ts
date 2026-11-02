// Map-maker II's thirteenth wave: the world editor's dresser (DESIGN.md §16). Two halves.
//
// **Its rules against the player's own** (`src/editor/dresser.ts`): a piece the appearance table blocks for the species is
// refused exactly where the player's own equipment refuses it (`fitFor`), in words, and the looks file's cleaner refuses it
// the same way where it is told the wardrobe's word; a piece the table hides takes its slots and draws nothing, so it is no
// piece of the look; a garment's colours are its own by bare name, as `tintFromValues` reads a thing's and `tintValues`
// writes them back over its meshes; the shape sliders and shared colours a look keeps are those that moved.
//
// **The player's pages through their new host interface** (`WardrobeFigure`, `AppearanceFigure`): c3d619d's `wardrobeUi.ts`
// and `appearanceUi.ts` out of git and today's, each built over a stand-in page (`standInPage.ts`) with the doll stood in
// for (no WebGL in node), handed the same figure, and put through the same recorded session -- every group opened, pieces
// put on and taken off by double-click and by the group's and the strip's buttons, through the game's own `onWear` and
// `onRemove` and without them; every shape slider and the height moved, every choice and scrub moved, every colour strip's
// picker opened and a swatch and its Default chip clicked, the hairstyles picked -- and every write the page made to the
// figure, every `onChange` and every `onItemColour`, in order, held equal by `Object.is`, with the page's markup at the end.
// Run over a figure of our own always, and over the human male's own pack, wardrobe, recipes and creator table where they
// are converted here; where git cannot hand c3d619d over, the figure of ours' sessions are held to hashes recorded from its
// own pages (`RECORDED`).
//
// **Its glue over stand-in figures**: a look's colours round the whole loop through the real customizer and the real
// `dressLook` (a body colour picked on the body's own mesh kept, a piece's own kept), a piece lent by another wardrobe folder
// read out of that folder (`DresserItems`), what is read off a figure (`figureStateOf`), the bare sliders read before the
// dressing (`dressFigure`), a pick refused or put on by the arrangement rule (`wearPick`) and a save's id and rules (`saveLook`).
//
// Run: node tools/swg/tests/dresser.test.ts
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Element0, StandInEvent, StandInPage, storage } from './standInPage.ts';
import { oldTexts, REPO } from './oldModules.ts';
import { fitFor, tintFromValues, tintValues, type ItemFit, type TintVariable } from '../../../src/core/inventory.ts';
import { DRESSER_TUNE, DresserItems, displacedBy, dressFigure, figureStateOf, fromFor, lookFromFigure, lookRow, lookRules, pickRefusal, recordFromEntry, sameLook, saveLook, tuneDresser, wardrobeRel, wearPick, wearRefusal, wearersOf, type DresserItem, type FigureState, type SaveAsk } from '../../../src/editor/dresser.ts';
import { readLookRow } from '../../../src/world/editFiles/looksFile.ts';
import { Customizer } from '../../../src/player/customizer.ts';
import { valueOf, type Recipe } from '../../../src/player/texrender.ts';
import { dressLook } from '../../../src/world/mobiles/dressLook.ts';
import { createHash } from 'node:crypto';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const PACKS = join(REPO, 'assets-private');
const PRE_WAVE = 'c3d619d';

// ---------------------------------------------------------------------------------------------------------------------
// The rules.
{
  const items: DresserItem[] = [
    { id: 'shirt_blocked', name: 'A shirt', parts: [{ name: 'shirt_blocked_m_l0' }], fit: { block: ['wookiee_male', 'ithorian_male'] } },
    { id: 'hat_hidden', name: 'A hat', parts: [{ name: 'hat_hidden_m_l0' }], fit: { hide: ['wookiee_male'] } },
    { id: 'boots', name: null, parts: [{ name: 'boots_m_l0' }], fit: null },
  ];
  const species = ['human_male', 'wookiee_male', 'ithorian_male', 'trandoshan_female'];
  let agree = 0;
  for (const it of items) for (const s of species) for (const own of [false, true]) {
    const said = wearRefusal(it, s, own);
    assert.equal(said !== null, fitFor(it.fit ?? undefined, s, own) === 'block', `${it.id} on ${s} (pack's own ${own})`);
    agree++;
  }
  ok(agree === items.length * species.length * 2, `the dresser refuses a piece exactly where the player's equipment does (fitFor's block), over ${agree} cases`);
  const said = wearRefusal(items[0], 'wookiee_male')!;
  ok(/A shirt is a piece a Wookiee male cannot wear \(the appearance table blocks it\)/.test(said), `and says why in words (“${said}”)`);
  ok(wearRefusal(items[1], 'wookiee_male') === null, 'a piece the table hides goes on (it takes its slots and draws nothing, as on the player)');
  ok(wearRefusal(items[0], 'wookiee_male', true) === null, "a piece the species pack itself carries is the pack's own and always goes on");
  // The cleaner told the wardrobe's word refuses the same piece in words; untold (the endpoint), it takes the row as it is.
  const row = { id: 'look', from: 'dressed_x', species: 'wookiee_male', outfit: [{ part: 'shirt_blocked_m_l0', item: 'shirt_blocked', wardrobe: 'wardrobe/human_male', values: {} }] };
  const byId = new Map(items.map((i) => [i.id, i]));
  const refused = readLookRow(row, [], lookRules('wookiee_male', (_w, id) => byId.get(id) ?? null));
  ok(typeof refused === 'string' && /cannot wear/.test(refused), `the looks file's cleaner refuses it where told the wardrobe's word (“${refused}”)`);
  ok(typeof readLookRow(row) !== 'string', 'and the endpoint, which reads no wardrobe, takes the row as it is');
  ok(typeof readLookRow({ ...row, species: 'human_male' }, [], lookRules('human_male', (_w, id) => byId.get(id) ?? null)) !== 'string', 'a species the table does not block takes it');

  // The human male's own wardrobe, where it is converted: a piece the table really blocks for a Wookiee.
  const file = join(PACKS, 'wardrobe', 'human_male', 'wardrobe.json');
  if (existsSync(file)) {
    const w = JSON.parse(readFileSync(file, 'utf8')) as { items: { id: string; name?: string | null; fit?: ItemFit; parts: { name: string }[] }[] };
    const blocked = w.items.filter((i) => i.fit?.block?.includes('wookiee_male'));
    const hidden = w.items.filter((i) => i.fit?.hide?.length);
    ok(blocked.length > 0 && blocked.every((i) => /cannot wear/.test(wearRefusal(i, 'wookiee_male') ?? '')), `every one of the wardrobe's ${blocked.length} pieces the table blocks for a Wookiee male is refused it`);
    ok(hidden.every((i) => i.fit!.hide!.every((s) => wearRefusal(i, s) === null || fitFor(i.fit, s) === 'block')), `and every one of its ${hidden.length} pieces a species wears unseen goes on that species`);
  } else note('no human male wardrobe converted here: the real blocked pieces are not read');
}

// What a piece put on takes off: the game's arrangement rule, as the player's equipment keeps it.
{
  const items = new Map<string, DresserItem>([
    ['shirt_a', { id: 'shirt_a', parts: [], slots: [['chest1']] }],
    ['shirt_b', { id: 'shirt_b', parts: [], slots: [['chest1']] }],
    ['jacket', { id: 'jacket', parts: [], slots: [['chest2']] }],
    ['robe', { id: 'robe', parts: [], slots: [['chest1', 'chest2', 'pants1']] }],
    ['ring', { id: 'ring', parts: [], slots: [['ring_l'], ['ring_r']] }],
    ['ring2', { id: 'ring2', parts: [], slots: [['ring_l'], ['ring_r']] }],
    ['ring3', { id: 'ring3', parts: [], slots: [['ring_l'], ['ring_r']] }],
  ]);
  const of = (id: string) => items.get(id) ?? null;
  const worn = [{ part: 'shirt_a_m_l0', id: 'shirt_a' }, { part: 'ring', id: 'ring' }];
  ok(displacedBy('jacket', worn, of).length === 0, 'a jacket goes on over a shirt (chest2 over chest1), as the player wears them');
  ok(displacedBy('shirt_b', worn, of).join() === 'shirt_a_m_l0', 'a second shirt takes the first off');
  ok(displacedBy('robe', [...worn, { part: 'jacket', id: 'jacket' }], of).join() === 'shirt_a_m_l0,jacket', 'a robe takes off everything holding its slots');
  ok(displacedBy('ring2', worn, of).length === 0 && displacedBy('ring3', [...worn, { part: 'ring2', id: 'ring2' }], of).join() === 'ring', "a ring takes the other hand while it is free, and displaces the first ring's hand once both are held");
  ok(displacedBy('shirt_a', worn, of).length === 0 && displacedBy('unknown', worn, of).length === 0, 'a piece already on, or one of no arrangement, takes nothing off');
}

// A figure's look: what moved, the colours by bare name, a piece a mesh, a hidden piece and the body left out.
{
  const base = (values: Record<string, number>): FigureState => ({
    species: 'human_male',
    morphs: { blend_fat_0: 0.2, blend_muscle: 0.4, blend_tall: 1.6 },
    rest: { blend_muscle: 0.4 },
    values,
    packValues: { index_color_hair: 4 },
    restOf: (k) => (k === 'index_age' ? 0 : undefined),
    parts: [
      { name: 'hum_m_body_l0', worn: true, body: true, meshNames: ['hum_m_body_l0'] },
      { name: 'jacket_s11', worn: true, body: false, meshNames: ['jacket_s11_m_l0', 'jacket_s11_m_l0_1'] },
      { name: 'hat_hidden', worn: true, body: false, meshNames: [] },
      { name: 'shirt_s03', worn: false, body: false, meshNames: ['shirt_s03_m_l0'] },
    ],
    itemOf: (id) => (id === 'jacket_s11' ? { id, parts: [{ name: 'jacket_s11_m_l0' }, { name: 'jacket_s11_lining_m_l0' }] } : id === 'hat_hidden' ? { id, parts: [{ name: 'hat_hidden_m_l0' }] } : null),
    wardrobe: 'wardrobe/human_male',
    follows: (k) => /index_color_follow/.test(k),
  });
  const values = {
    '/shared_owner/index_color_skin': 6,
    index_color_skin: 2,
    index_color_hair: 4,
    index_age: 0,
    index_color_eyes: 70000,
    'jacket_s11_m_l0|/private/index_color_1': 114,
    'jacket_s11_m_l0|index_color_1': 7,
    'jacket_s11_m_l0|index_color_2': 3,
    'jacket_s11_m_l0|index_color_follow': 9,
    'jacket_s11_lining_m_l0|/private/index_color_3': -5,
  };
  const look = lookFromFigure(base(values));
  ok(JSON.stringify(look.morphs) === JSON.stringify({ blend_fat_0: 0.2, blend_tall: 1 }), `a look keeps the sliders that moved off the bare body, held to nought..one (${JSON.stringify(look.morphs)})`);
  ok(JSON.stringify(look.custom) === JSON.stringify({ index_color_skin: 6, index_color_eyes: 65535 }), `and the shared colours that differ from the pack's own, by bare name, the full spelling winning (${JSON.stringify(look.custom)})`);
  // The same with the short spelling met first: the full spelling still wins.
  const reversed = Object.fromEntries(Object.entries(values).reverse());
  ok(lookFromFigure(base(reversed)).custom.index_color_skin === 6, 'whichever spelling is met first');
  ok(look.outfit.length === 2 && look.outfit.every((p) => p.item === 'jacket_s11' && p.wardrobe === 'wardrobe/human_male'), `an outfit piece a mesh of every worn piece that draws, the body and a piece worn unseen left out (${look.outfit.map((p) => p.part).join(', ')})`);
  const tint = tintFromValues(values, ['jacket_s11_m_l0', 'jacket_s11_lining_m_l0'], (k) => /index_color_follow/.test(k));
  ok(JSON.stringify(look.outfit[0].values) === JSON.stringify(tint) && JSON.stringify(look.outfit[1].values) === JSON.stringify(tint), `each piece's colours are the piece's own by bare name, as tintFromValues reads a thing's (${JSON.stringify(tint)})`);
  ok(!('index_color_follow' in look.outfit[0].values), "a key that follows the body's colour is the body's, never the piece's");
  const defs: TintVariable[] = [
    { key: 'jacket_s11_m_l0|/private/index_color_1', name: '/private/index_color_1', private: true, default: 0, kind: 'palette' },
    { key: 'jacket_s11_m_l0|/private/index_color_2', name: '/private/index_color_2', private: true, default: 0, kind: 'palette' },
  ];
  const back = tintValues(look.outfit[0].values, defs);
  ok(back['jacket_s11_m_l0|/private/index_color_1'] === 114 && back['jacket_s11_m_l0|/private/index_color_2'] === 3, 'and tintValues writes them back over the mesh by the very keys the player\'s piece is drawn with');
  // Filled out from the recipes: a colour the piece reads and nothing holds is written at its resting value, so the world's
  // dressing (which lays the shared colours over every private copy of the same name first) cannot leave a shared colour on it.
  const filled = lookFromFigure({
    ...base(values),
    defsOf: (meshes) => [
      { key: 'jacket_s11_m_l0|/private/index_color_1', name: '/private/index_color_1', private: true, default: 0 },
      { key: 'jacket_s11_m_l0|/private/index_color_4', name: '/private/index_color_4', private: true, default: 2 },
      { key: 'jacket_s11_m_l0|/private/index_color_follow', name: '/private/index_color_follow', private: true, default: 7 },
      { key: 'index_color_skin', name: '/shared_owner/index_color_skin', private: false, default: 1 },
    ].filter(() => meshes.includes('jacket_s11_m_l0')),
  });
  ok(filled.outfit[0].values.index_color_4 === 2 && filled.outfit[0].values.index_color_1 === 114 && !('index_color_follow' in filled.outfit[0].values) && !('index_color_skin' in filled.outfit[0].values), "a piece's colour nothing holds is written at its resting value; one held keeps its value; one that follows the body, and a shared one, stay the body's");
  // Nothing but the body: nothing worn, nothing moved, nothing coloured.
  const bare = lookFromFigure({ ...base({ index_color_hair: 4 }), morphs: { blend_muscle: 0.4 }, parts: [{ name: 'hum_m_body_l0', worn: true, body: true, meshNames: ['hum_m_body_l0'] }] });
  ok(!Object.keys(bare.morphs).length && !Object.keys(bare.custom).length && !bare.outfit.length, 'a bare body is a look of nothing');
}

// What a look starts from, which body it takes its numbers from, its row, its likeness and who wears it.
{
  const dressed = { id: 'dressed_a', kind: 'dressed', species: 'human_male', ready: true, morphs: { m: 0.5 }, custom: { c: 1 }, outfit: [{ part: 'p', item: 'i', wardrobe: 'wardrobe/human_male', values: { v: 2 } }] };
  const r = recordFromEntry(dressed)!;
  ok(r.from === 'dressed_a' && r.species === 'human_male' && r.outfit[0].values.v === 2, 'a dressed entry is started from as itself');
  r.outfit[0].values.v = 9;
  r.morphs.m = 1;
  ok(dressed.outfit[0].values.v === 2 && dressed.morphs.m === 0.5, "and copied: nothing the dresser does reaches the catalogue's own entry");
  ok(recordFromEntry({ ...dressed, kind: 'creature' }) === null && recordFromEntry({ ...dressed, species: null }) === null, 'a creature, or an entry with no species, is nothing to start from');
  ok(recordFromEntry({ ...dressed, id: 'own:x', own: { look: 'x', from: 'dressed_b' } })!.from === 'dressed_b', "one of the owner's own looks is started from as the entry it took its numbers from");
  const list = [
    { id: 'own:y', kind: 'dressed', species: 'human_male', own: { look: 'y', from: 'dressed_a' } },
    { id: 'dressed_wke', kind: 'dressed', species: 'wookiee_male', ready: false },
    { id: 'dressed_wke2', kind: 'dressed', species: 'wookiee_male' },
    dressed,
  ];
  ok(fromFor('human_male', 'dressed_a', list) === 'dressed_a', 'a look keeps its from while it is a dressed body of the same species');
  ok(fromFor('human_male', null, list) === 'dressed_a' && fromFor('human_male', 'own:y', list) === 'dressed_a', "a look with none takes the first dressed entry of its species, never a look of the owner's own ahead of it");
  ok(fromFor('wookiee_male', 'dressed_a', list) === 'dressed_wke2', "a species changed takes the first ready dressed entry of the species, never a look of the owner's own");
  ok(fromFor('bothan_female', 'dressed_a', list) === 'dressed_a', 'and keeps the one it has where the species has none');
  const row = lookRow('farmer', 'dressed_a', { species: 'human_male', morphs: {}, custom: {}, outfit: [] }, '  ', ' a note ');
  ok(!('name' in row) && row.note === 'a note' && lookRow('farmer', 'dressed_a', { species: 'human_male', morphs: {}, custom: {}, outfit: [] }, '  Old Farmer ', '').name === 'Old Farmer', 'a row writes its words only where there are any, trimmed');
  const a = { from: 'dressed_a', species: 'human_male', morphs: { m: 1 }, custom: { c: 1, d: 2 }, outfit: [{ part: 'p', item: 'i', wardrobe: 'wardrobe/human_male', values: { v: 1 } }] };
  ok(sameLook(a, { ...a, custom: { d: 2, c: 1 } }) && !sameLook(a, { ...a, outfit: [{ ...a.outfit[0], values: { v: 2 } }] }), 'two looks are the same by what they dress, whatever order a record was written in');
  const who = wearersOf('farmer', [{ id: 'p1', body: 'own:farmer', name: 'Old Ben' }, { id: 'p2', body: 'dressed_a' }], [{ id: 'TEST_cast', body: 'own:farmer' }]);
  ok(who.length === 2 && /Old Ben/.test(who[0]) && /TEST_cast/.test(who[1]), `who wears a look, placed here and in the story's cast (${who.join('; ')})`);
  ok(wardrobeRel('/assets-private/wardrobe/human_male/', '/') === 'wardrobe/human_male' && wardrobeRel('http://x/assets-private/mobiles/wearables/ewok/', '/') === 'mobiles/wearables/ewok' && wardrobeRel('/assets-private/characters/human_male/', '/') === null, "a figure's wardrobe folder is read off the URL it settled on, and nothing else is one");
  const was = { ...DRESSER_TUNE };
  const said = tuneDresser({ yaw: 99, dollHeight: 10, startHits: 7.6, species: 'Not a species' });
  ok(DRESSER_TUNE.yaw === Math.PI && DRESSER_TUNE.dollHeight === 120 && DRESSER_TUNE.startHits === 8 && DRESSER_TUNE.species === was.species && said.length === 3, `its numbers of feel are held to sense (${said.join(', ')})`);
  Object.assign(DRESSER_TUNE, was);
}

// ---------------------------------------------------------------------------------------------------------------------
// A look's colours round the whole loop, through the game's own customizer and its own dressing (`dressLook`): a look
// started from an entry, the eye colour picked on the body's own mesh (no shared colour carries it, as on every species),
// read off the figure (`figureStateOf`, `lookFromFigure`) and dressed again on a fresh body as the world dresses it. The
// recipes name their variables bare, as the converted packs' do (a shared write and a piece's own then meet on one key).
{
  const pal = 'palette/test_pal.pal';
  const recipe = (mesh: string, palettes: { variable: string; private: boolean; default: number }[]): Recipe =>
    ({ mesh, material: `${mesh}_mat`, kind: 'render', baseTag: 'MAIN', shader: { effect: null, passes: null, textures: {}, addresses: {}, coordSets: {}, tfactors: {}, choices: [], palettes: palettes.map((p) => ({ ...p, tag: 'MAIN', palette: pal })) }, slots: [] }) as unknown as Recipe;
  const file = {
    images: '',
    palettes: { [pal]: [[0, 0, 0, 255], [9, 9, 9, 255]] },
    recipes: [
      recipe('test_body_l0', [{ variable: 'index_color_skin', private: false, default: 0 }]),
      recipe('test_head_l0', [
        { variable: 'index_color_2', private: true, default: 0 },
        { variable: 'index_color_skin', private: true, default: 0 },
        { variable: 'index_color_lips', private: true, default: 1 },
      ]),
      recipe('jacket_m_l0', [
        { variable: 'index_color_1', private: true, default: 0 },
        { variable: 'index_color_2', private: true, default: 0 },
      ]),
    ],
  };
  const gl = globalThis as unknown as Record<string, unknown>;
  const wasFetch = gl.fetch;
  gl.fetch = async (url: string) =>
    /customize\.json$/.test(String(url)) ? { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => JSON.parse(JSON.stringify(file)) } : { ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => null };
  /** A body of the test's: the real customizer over the recipes above, its meshes active as it wears them. */
  const body = async (dir: string) => {
    const cz = new Customizer(async () => null);
    await cz.addSource(dir);
    const mats = new Set(['test_body_l0_mat', 'test_head_l0_mat']);
    cz.materialsFor = (name) => (mats.has(name) ? [{} as never] : []);
    cz.invalidate();
    let jacket = false;
    return {
      cz,
      fig: {
        manifest: { id: 'human_male', values: {} },
        customizer: cz,
        morphValues: () => ({}),
        variableValues: () => Object.fromEntries(cz.values),
        status: () => [
          { name: 'test_body_l0', worn: true, body: true, meshNames: ['test_body_l0'] },
          { name: 'test_head_l0', worn: true, body: true, meshNames: ['test_head_l0'] },
          ...(jacket ? [{ name: 'test_jacket', worn: true, body: false, meshNames: ['jacket_m_l0'] }] : []),
        ],
        setMorph: () => true,
        wearItemFrom: async () => {
          jacket = true;
          mats.add('jacket_m_l0_mat');
          cz.invalidate();
          return true;
        },
      },
    };
  };
  const eyes = (cz: Customizer) => valueOf(cz.values, 'index_color_2', 0, true, 'test_head_l0');
  const jacketCol = (cz: Customizer, v: string) => valueOf(cz.values, v, 0, true, 'jacket_m_l0');
  const items = new DresserItems('wardrobe/human_male', [{ id: 'test_jacket', parts: [{ name: 'jacket_m_l0' }] }]);
  const entry = { id: 'dressed_test', morphs: {}, custom: { index_color_skin: 1, index_color_2: 5 }, outfit: [{ part: 'jacket_m_l0', item: 'test_jacket', wardrobe: 'wardrobe/human_male', values: { index_color_1: 1 } }] };
  const a = await body('/one/');
  await dressLook(a.fig as never, entry, '/');
  ok(eyes(a.cz) === 5 && jacketCol(a.cz, 'index_color_2') === 5, 'the entry started from dresses the eyes by its bare colour (a shared write reaches every body mesh, and the jacket too)');
  // The appearance page's eye row writes the head's own key, as the creator's view names it.
  a.cz.set('test_head_l0|index_color_2', 3);
  const look = lookFromFigure(figureStateOf(a.fig, {}, items));
  ok(look.custom.index_color_2 === 3 && look.custom.index_color_skin === 1, `the eye colour picked on the body's own mesh is the look's, over the bare value it started from (${JSON.stringify(look.custom)})`);
  ok(look.outfit.length === 1 && look.outfit[0].values.index_color_1 === 1 && look.outfit[0].values.index_color_2 === 5, `and the jacket keeps every colour it is drawn in (${JSON.stringify(look.outfit[0]?.values)})`);
  const b = await body('/two/');
  await dressLook(b.fig as never, { id: 'own:test', ...look }, '/');
  ok(eyes(b.cz) === 3 && jacketCol(b.cz, 'index_color_2') === 5 && jacketCol(b.cz, 'index_color_1') === 1, `dressed again as the world dresses it, the eyes are the colour picked and the jacket the doll's (eyes ${eyes(b.cz)})`);
  ok(sameLook({ ...lookFromFigure(figureStateOf(b.fig, {}, items)), from: 'x' }, { ...look, from: 'x' }), 'and read off again it is the same look: opened again it reads as saved');
  // The eyes put back to their own colour: the look carries none, and the bare value it started from goes with it.
  b.cz.set('test_head_l0|index_color_2', 0);
  const rested = lookFromFigure(figureStateOf(b.fig, {}, items));
  ok(!('index_color_2' in rested.custom) && !('index_color_lips' in rested.custom), `a body colour at its own resting value is no colour of the look (${JSON.stringify(rested.custom)})`);
  const c = await body('/three/');
  await dressLook(c.fig as never, { id: 'own:test', ...rested }, '/');
  ok(eyes(c.cz) === 0 && jacketCol(c.cz, 'index_color_2') === 5, `and dressed again the eyes stand at their own colour, the jacket untouched (eyes ${eyes(c.cz)})`);
  gl.fetch = wasFetch;
}

// A piece one folder holds under an id the figure's own wardrobe holds too (the human female's robe on a man): read out of the
// folder it was put on from, its own meshes and colours, never the own wardrobe's cut of the same id.
{
  const own = [{ id: 'robe_s04', name: 'Robe', parts: [{ name: 'robe_s04_m_l0' }], fit: { block: ['human_male'] } as ItemFit }];
  const female = [{ id: 'robe_s04', name: 'Robe', parts: [{ name: 'robe_s04_f_l0' }], fit: null }, { id: 'veil', parts: [{ name: 'veil_f_l0' }] }];
  const items = new DresserItems('wardrobe/human_male', own);
  items.addFolder('wardrobe/human_female', female);
  items.notePiece({ item: 'robe_s04', part: 'robe_s04_f_l0', wardrobe: 'wardrobe/human_female' });
  items.notePiece({ item: 'nameless', part: 'veil_f_l0', wardrobe: 'wardrobe/human_female' });
  ok(items.itemOf('robe_s04')?.parts[0].name === 'robe_s04_f_l0' && items.folderOf('robe_s04') === 'wardrobe/human_female' && items.folderOf('veil') === 'wardrobe/human_female', "a worn id is read as the folder it was put on from (and a piece found by its part, under the id it goes on under)");
  const state = (it: DresserItems): FigureState => ({
    species: 'human_male',
    morphs: {},
    rest: {},
    values: { 'robe_s04_f_l0|/private/index_color_1': 9 },
    packValues: {},
    restOf: () => undefined,
    parts: [{ name: 'robe_s04', worn: true, body: false, meshNames: ['robe_s04_f_l0'] }],
    itemOf: (id) => it.itemOf(id),
    wardrobe: it.own,
    follows: () => false,
  });
  const look = lookFromFigure(state(items));
  ok(look.outfit.length === 1 && look.outfit[0].part === 'robe_s04_f_l0' && look.outfit[0].wardrobe === 'wardrobe/human_female' && look.outfit[0].values.index_color_1 === 9, `so the look writes that folder's piece in its own colours (${JSON.stringify(look.outfit)})`);
  const unnoted = lookFromFigure(state(new DresserItems('wardrobe/human_male', own)));
  ok(unnoted.outfit[0]?.part === 'robe_s04_m_l0' && !Object.keys(unnoted.outfit[0].values).length, 'where the folder is not noted the own cut is written, colourless (the fault the note mends)');
  // The cleaner reads each piece out of the folder the row names.
  const rules = lookRules('human_male', (w, id) => items.inFolder(w, id));
  ok(typeof readLookRow({ id: 'r', from: 'dressed_x', species: 'human_male', outfit: look.outfit }, [], rules) !== 'string', "the female cut, which the table lets a man wear, is saved");
  ok(typeof readLookRow({ id: 'r', from: 'dressed_x', species: 'human_male', outfit: [{ ...look.outfit[0], wardrobe: 'wardrobe/human_male', part: 'robe_s04_m_l0' }] }, [], rules) === 'string', 'while the own cut, which it blocks, is refused');
  ok(pickRefusal(items, 'human_male', 'robe_s04', false) === null && /cannot wear/.test(pickRefusal(new DresserItems('wardrobe/human_male', own), 'human_male', 'robe_s04', false) ?? ''), 'and a pick is refused by the piece that would really go on');
}

// The dresser's glue over a figure of the test's (`figureStateOf`, `dressFigure`, `wearPick`, `saveLook`).
{
  const vars = [
    { key: '/shared_owner/index_age', name: '/shared_owner/index_age', private: false, mesh: '', default: 2 },
    { key: 'jacket_m_l0|/private/index_color_follow', name: '/private/index_color_follow', private: true, mesh: 'jacket_m_l0', default: 0 },
  ];
  const fig = {
    manifest: { id: 'human_male', values: { index_color_hair: 4 } },
    customizer: { variables: () => vars, isLinked: (k: string) => /index_color_follow$/.test(k) },
    morphValues: () => ({ blend_muscle: 0.4, blend_fat: 0.7 }),
    variableValues: () => ({ index_color_hair: 4, index_age: 2, index_color_tattoo: 6, 'jacket_m_l0|/private/index_color_follow': 9, 'jacket_m_l0|/private/index_color_1': 3 }),
    status: () => [
      { name: 'hum_m_body_l0', worn: true, body: true, meshNames: ['hum_m_body_l0'] },
      { name: 'jacket', worn: true, body: false, meshNames: ['jacket_m_l0'] },
    ],
  };
  const items = new DresserItems('wardrobe/human_male', [{ id: 'jacket', parts: [{ name: 'jacket_m_l0' }] }]);
  const look = lookFromFigure(figureStateOf(fig, { blend_muscle: 0.4 }, items));
  ok(JSON.stringify(look.morphs) === '{"blend_fat":0.7}', `the sliders that stood so on the bare body are no part of the look (${JSON.stringify(look.morphs)})`);
  ok(JSON.stringify(look.custom) === '{"index_color_tattoo":6}', `a colour at the pack's own value, or at a shared colour's resting value, is none of it either (${JSON.stringify(look.custom)})`);
  ok(look.outfit[0]?.values.index_color_1 === 3 && !('index_color_follow' in look.outfit[0].values) && look.outfit[0].wardrobe === 'wardrobe/human_male', "a piece's copy of a body colour is the body's (the customizer's link), its own colour is the piece's");

  // Where the sliders stood bare is read before the look goes on.
  let m = 0;
  let settled = 0;
  const bare = { morphValues: () => ({ m }), customizer: { settled: async () => void settled++ } };
  const dressed = await dressFigure(bare, { any: 1 }, async () => {
    m = 0.7;
    return ['gone'];
  });
  ok(dressed.rest.m === 0 && dressed.missing.join() === 'gone' && settled === 0, 'a figure dressed keeps where its sliders stood bare (a look started with sliders of its own keeps them)');
  const plain = await dressFigure(bare, null, async () => ['never']);
  ok(plain.rest.m === 0.7 && !plain.missing.length && settled === 1, 'and a bare one has its colours drawn and nothing put on');

  // A pick on the Clothes page.
  const log: string[] = [];
  const said: string[] = [];
  const parts = new Map([['shirt', true]]);
  const pickFig = {
    manifest: { id: 'human_male' },
    status: () => [{ name: 'hum_m_body_l0', worn: true, body: true }, ...[...parts].map(([name, worn]) => ({ name, worn, body: false }))],
    packPartOf: () => null,
    remove: (k: string) => (log.push(`remove ${k}`), parts.set(k, false), true),
    wear: async () => false,
    wearItem: async (id: string) => (log.push(`wearItem ${id}`), parts.set(id, true), true),
  };
  const pickItems = new DresserItems('wardrobe/human_male', [
    { id: 'shirt', parts: [{ name: 'shirt_m_l0' }], slots: [['chest1']] },
    { id: 'shirt2', parts: [{ name: 'shirt2_m_l0' }], slots: [['chest1']] },
    { id: 'jacket', parts: [{ name: 'jacket_m_l0' }], slots: [['chest2']] },
    { id: 'boots', name: 'Boots', parts: [{ name: 'boots_m_l0' }], slots: [['shoes']], fit: { block: ['human_male'] } },
  ]);
  ok((await wearPick(pickFig, pickItems, 'boots', '/', (w) => said.push(w))) === false && /Boots is a piece a Human male cannot wear/.test(said[0] ?? '') && !log.length, `a blocked piece is refused in words and nothing is touched (“${said[0]}”)`);
  ok((await wearPick(pickFig, pickItems, 'jacket', '/', (w) => said.push(w))) && log.join() === 'wearItem jacket', 'a jacket goes on over the shirt');
  ok((await wearPick(pickFig, pickItems, 'shirt2', '/', (w) => said.push(w))) && log.slice(1).join() === 'remove shirt,wearItem shirt2' && pickItems.folderOf('shirt2') === 'wardrobe/human_male', "a second shirt takes the first off, by the game's arrangement rule, and is noted as the own wardrobe's");

  // Save: the id kept or minted, the species' rules handed in.
  const fromOf = (s: string) => (s === 'human_male' ? 'dressed_first' : null);
  const lookOf = { species: 'human_male', morphs: {}, custom: {}, outfit: [{ part: 'jacket_m_l0', item: 'jacket', wardrobe: 'wardrobe/human_male', values: {} }] };
  const ask = (o: Partial<SaveAsk>): SaveAsk => ({ asNew: false, record: { id: 'farmer-1', from: 'dressed_a', name: 'Farmer', note: '' }, look: lookOf, taken: new Set(['farmer-1']), fromOf, rules: {}, ...o });
  const kept = saveLook(ask({}));
  const fresh = saveLook(ask({ asNew: true }));
  const gone = saveLook(ask({ taken: new Set() }));
  ok(typeof kept !== 'string' && kept.id === 'farmer-1' && kept.keep && kept.from === 'dressed_a', 'Save writes over the look it was opened from while the file still holds it');
  ok(typeof fresh !== 'string' && fresh.id === 'farmer-2' && !fresh.keep && typeof gone !== 'string' && gone.id === 'farmer-1' && !gone.keep, 'Save as new mints a fresh id from its words, and so does a Save of a look the file no longer holds');
  const unnamed = saveLook(ask({ record: { id: null, from: null, name: '', note: '' }, taken: new Set() }));
  ok(typeof unnamed !== 'string' && unnamed.from === 'dressed_first' && /^human-male-\d+$/.test(unnamed.id), "a look with no from takes its species' first dressed entry's numbers, and with no name its species' words for an id");
  ok(saveLook(ask({ record: { id: null, from: null, name: 'x', note: '' }, look: { ...lookOf, species: 'bothan_female' } })) === 'no dressed entry of bothan female to take its size, moves and numbers from', 'and with none of its species it is not saved, in words');
  const blocked = saveLook(ask({ rules: lookRules('human_male', (w, id) => pickItems.inFolder(w, id)), look: { ...lookOf, outfit: [{ part: 'boots_m_l0', item: 'boots', wardrobe: 'wardrobe/human_male', values: {} }] } }));
  ok(typeof blocked === 'string' && /^not saved: boots is a piece human male cannot wear/.test(blocked), `a piece the species may not wear is refused at the save (“${blocked}”)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// The player's pages, c3d619d's and today's, through one recorded session each.

const page = new StandInPage();
page.install(storage());
const g = globalThis as unknown as Record<string, unknown>;
g.CSS = { escape: (s: string) => String(s).replace(/["\\]/g, '\\$&') };
g.HTMLCanvasElement = Element0;
g.HTMLDetailsElement = Element0;
// The picker sizes its blocks to the room it has: a laid-out page gives it some.
Object.defineProperty(Element0.prototype, 'clientWidth', { configurable: true, get: () => 400 });

/** The files a test fetches: the converted ones it is handed, every other a 404. */
const served = new Map<string, string>();
g.fetch = async (url: string) => {
  const key = String(url);
  const text = served.get(key);
  return text === undefined
    ? { ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => null, text: async () => '' }
    : { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => JSON.parse(text), text: async () => text };
};

const tmp = mkdtempSync(join(tmpdir(), 'mm2-dresser-'));
const STUB = join(tmp, 'characterPreviewStub.ts');
writeFileSync(
  STUB,
  `export class CharacterPreview {
  static effects = {};
  canvas = document.createElement('canvas');
  lastBuild = null;
  frames = 0;
  lastRender = 0;
  refresh(): void {}
  start(): void {}
  stop(): void {}
  dispose(): void {}
  reframe(): void {}
  setLight(): void {}
}
`,
);

/** A page's text made a module node can load: the doll stood in for, every other relative import at today's file. */
async function loadPage(text: string, file: string, tag: string): Promise<Record<string, unknown>> {
  const from = resolve(REPO, dirname(file));
  const ctor = 'constructor(parent: HTMLElement, private readonly onChange: () => void) {';
  const out = text
    .replace(/\r\n/g, '\n')
    .replace(ctor, 'constructor(parent: HTMLElement, onChange: () => void) {\n    this.onChange = onChange;')
    .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => {
      const abs = resolve(from, /\.[a-z]+$/.test(p) ? p : `${p}.ts`);
      return `from '${/characterPreview\.ts$/.test(abs) ? pathToFileURL(STUB).href : pathToFileURL(abs).href}'`;
    });
  assert.ok(!/private readonly onChange/.test(out.split('\n').find((l) => l.includes('constructor(parent')) ?? ''), `${tag}: the constructor is written out`);
  const at = join(tmp, `${tag}.ts`);
  writeFileSync(at, out);
  return (await import(pathToFileURL(at).href)) as Record<string, unknown>;
}

const today = (f: string) => readFileSync(join(REPO, f), 'utf8');
const old = oldTexts(['src/ui/wardrobeUi.ts', 'src/ui/appearanceUi.ts'], PRE_WAVE);
if (!old) note(`git cannot hand ${PRE_WAVE} over here: today's pages are held to the sessions recorded from its own`);

interface ItemSpec {
  id: string;
  kind: string;
  gender: string;
  template: string | null;
  name?: string | null;
  slots?: string[][] | null;
  fit?: ItemFit;
  parts: { name: string; file?: string; occlusionLayer?: number }[];
}
interface Spec {
  manifest: { id: string; gender?: string; parts: { name: string; body?: boolean; morphs?: string[] }[]; variables?: { name: string; private: boolean; kind: 'palette' | 'index'; default: number; colors?: number[][]; palette?: string; count?: number; meshes?: string[] }[]; values?: Record<string, number>; defaultWear?: string[] };
  items: ItemSpec[];
  worn: string[];
  wear: string[];
  species: string;
  gender: 'male' | 'female';
  dir: string;
  /** The base the pages are handed: the figure of ours has one nothing is served under, so its session reads no converted file. */
  base: string;
}

/** A figure of the spec's: what the pages read and every write they make, logged in order. */
function figure(spec: Spec, log: string[]) {
  const parts = new Map<string, { worn: boolean; body: boolean; meshNames: string[] }>();
  for (const p of spec.manifest.parts) if (p.body) parts.set(p.name, { worn: true, body: true, meshNames: [p.name] });
  for (const n of spec.worn) parts.set(n, { worn: true, body: false, meshNames: [n] });
  const itemById = new Map(spec.items.map((i) => [i.id, i]));
  const putOn = (id: string) => {
    const it = itemById.get(id);
    if (!it) return false;
    parts.set(id, { worn: true, body: false, meshNames: it.fit?.hide?.includes(spec.manifest.id) ? [] : it.parts.map((p) => p.name) });
    return true;
  };
  for (const id of spec.wear) putOn(id);
  const morphs: Record<string, number> = {};
  for (const p of spec.manifest.parts) for (const m of p.morphs ?? []) morphs[m] = 0;
  const values: Record<string, number> = {};
  let height = 0.5;
  let hair: string | null = null;
  const live = () => {
    const out: { key: string; name: string; private: boolean; mesh: string; default: number; kind: 'palette' | 'index'; palette?: string; count?: number; colors?: number[][] }[] = [];
    for (const v of spec.manifest.variables ?? []) {
      if (!v.private) out.push({ key: v.name, name: v.name, private: false, mesh: '', default: v.default, kind: v.kind, palette: v.palette, count: v.count, colors: v.colors });
      else for (const m of v.meshes ?? []) if ([...parts.values()].some((p) => p.worn && p.meshNames.includes(m))) out.push({ key: `${m}|${v.name}`, name: v.name, private: true, mesh: m, default: v.default, kind: v.kind, palette: v.palette, count: v.count, colors: v.colors });
    }
    return out;
  };
  return {
    group: {},
    manifest: spec.manifest,
    customizer: { variables: live, isLinked: (k: string) => /\|.*index_color_skin$/.test(k) },
    wardrobeDir: spec.dir,
    speciesName: spec.species,
    genderName: spec.gender,
    catalogue: async () => ({ species: spec.manifest.id, gender: spec.gender, items: spec.items }),
    packPartOf: (id: string) => spec.manifest.defaultWear?.find((p) => p.replace(/_[mf]_l\d+$/, '') === id) ?? null,
    status: () => [...parts].map(([name, p]) => ({ name, meshNames: p.meshNames, worn: p.worn, body: p.body, layer: p.body ? 0 : 1, triangles: 10, drawn: 10, fp: null })),
    remove: (name: string) => {
      log.push(`remove ${name}`);
      const p = parts.get(name);
      if (!p || !p.worn || p.body) return false;
      p.worn = false;
      return true;
    },
    wear: async (name: string) => {
      log.push(`wear ${name}`);
      const p = parts.get(name);
      if (!p || p.body) return false;
      p.worn = true;
      return true;
    },
    wearItem: async (id: string, base: string) => {
      log.push(`wearItem ${id} ${base}`);
      return putOn(id);
    },
    morphValues: () => ({ ...morphs }),
    setMorph: (name: string, v: number) => {
      log.push(`setMorph ${name} ${v}`);
      morphs[name] = v;
      return true;
    },
    get height() {
      return height;
    },
    setHeight: (t: number) => {
      log.push(`setHeight ${t}`);
      height = t;
    },
    variableValues: () => ({ ...values }),
    setVariable: (name: string, v: number) => {
      log.push(`setVariable ${name} ${v}`);
      values[name] = v;
      return 1;
    },
    canCustomize: (name: string) => live().some((x) => x.key === name || x.name === name),
    wornMeshes: () => new Set([...parts.values()].filter((p) => p.worn).flatMap((p) => p.meshNames)),
    hairWorn: () => hair,
    hairsWorn: () => (hair ? [hair] : []),
    wearHair: async (id: string | null, base: string) => {
      log.push(`wearHair ${id} ${base}`);
      if (hair) parts.delete(hair);
      hair = id;
      if (id) parts.set(id, { worn: true, body: false, meshNames: [`${id}_m_l0`] });
      return true;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};
const cellOf = (root: Element0, id: string) => root.querySelectorAll('.bp-cell[data-id]').find((c) => c.dataset.id === id) ?? null;

/** The wardrobe page's session, through the game's equipment (`hooks`) or straight onto the figure. */
async function wardrobeSession(M: Record<string, unknown>, spec: Spec, hooks: boolean): Promise<string[]> {
  const log: string[] = [];
  const parent = page.createElement('div');
  page.body.append(parent);
  const W = M.WardrobeUi as new (parent: unknown, onChange: () => void) => {
    root: Element0;
    onWear: ((id: string) => Promise<boolean>) | null;
    onRemove: ((parts: string[]) => string) | null;
    setBaseUrl(u: string): void;
    attach(c: unknown, base: string): Promise<void>;
    show(): void;
    hide(): void;
    state(): unknown;
  };
  const ui = new W(parent, () => log.push('change'));
  const fig = figure(spec, log);
  if (hooks) {
    ui.onWear = async (id) => {
      log.push(`onWear ${id}`);
      return fig.wearItem(id, spec.base);
    };
    ui.onRemove = (parts) => {
      log.push(`onRemove ${parts.join(',')}`);
      for (const p of parts) fig.remove(p);
      return '';
    };
  }
  ui.setBaseUrl(spec.base);
  await ui.attach(fig, spec.base);
  ui.show();
  for (const d of ui.root.querySelectorAll('details')) {
    d.open = true;
    page.fire(d, new StandInEvent('toggle'));
  }
  const ids = ui.root.querySelectorAll('.bp-cell[data-id]').map((c) => c.dataset.id!).slice(0, 8);
  log.push(`cells ${ids.join(',')}`);
  for (const id of [...ids, ids[0], ids[2]]) {
    const cell = cellOf(ui.root, id);
    if (!cell) {
      log.push(`no cell ${id}`);
      continue;
    }
    page.click(cell);
    page.fire(cell, new StandInEvent('dblclick'));
    await flush();
  }
  // A group's own "take off", the examine strip's button, and the strip that takes everything off.
  const off = ui.root.querySelector('button[data-act^="off:"]');
  if (off) {
    page.click(off);
    await flush();
  }
  const use = ui.root.querySelector('button[data-act="use"]');
  if (use) {
    page.click(use);
    await flush();
  }
  const strip = ui.root.querySelector('.strip');
  if (strip) {
    page.click(strip);
    await flush();
  }
  log.push(`state ${JSON.stringify(ui.state())}`);
  log.push(`markup ${ui.root.innerHTML}`);
  ui.hide();
  parent.remove();
  return log;
}

/** The appearance page's session: every slider, choice, scrub, strip, swatch and hairstyle. */
async function appearanceSession(M: Record<string, unknown>, spec: Spec): Promise<string[]> {
  const log: string[] = [];
  const parent = page.createElement('div');
  page.body.append(parent);
  const A = M.AppearanceUi as new (parent: unknown, onChange: () => void) => {
    root: Element0;
    onItemColour: ((part: string, bare: string, v: number | null) => void) | null;
    attach(c: unknown, base: string): void;
    show(): void;
    hide(): void;
    pickerState(): unknown;
  };
  const ui = new A(parent, () => log.push('change'));
  ui.onItemColour = (part, bare, v) => void log.push(`item ${part} ${bare} ${v}`);
  const fig = figure(spec, log);
  ui.attach(fig, spec.base);
  await flush();
  ui.show();
  const inputs = (sel: string) => ui.root.querySelectorAll(sel);
  for (let i = 0; i < inputs('input[data-hi]').length; i++) {
    const el = inputs('input[data-hi]')[i];
    page.enter(el, i % 2 ? '-0.4' : '0.3', ['input']);
    page.pass(200);
  }
  const height = ui.root.querySelector('input.height');
  if (height) page.enter(height, '0.62', ['input']);
  for (const sel of ['input[data-var]', 'input[data-row]', 'input[data-pick]']) {
    const n = Math.min(12, inputs(sel).length);
    for (let i = 0; i < n; i++) {
      const el = inputs(sel)[i];
      if (!el) continue;
      page.enter(el, String(Math.min(Number(el.max) || 1, 1 + (i % 3))), ['input']);
      page.pass(200);
      await flush();
    }
  }
  const strips = ui.root.querySelectorAll('canvas.dye-strip[data-pick]').map((c) => c.dataset.pick!);
  log.push(`strips ${strips.length}`);
  for (const id of strips.slice(0, 10)) {
    const s = ui.root.querySelectorAll('canvas.dye-strip[data-pick]').find((c) => c.dataset.pick === id);
    if (!s) continue;
    page.fire(s, new StandInEvent('click'));
    log.push(`picker ${JSON.stringify(ui.pickerState())}`);
    const grid = ui.root.querySelector('.dye-picker canvas.dye-grid');
    if (grid) {
      const r = grid.getBoundingClientRect();
      const e = new StandInEvent('click') as StandInEvent & { clientX: number; clientY: number };
      e.clientX = r.left + 1;
      e.clientY = r.top + 1;
      page.fire(grid, e);
    }
    const chip = ui.root.querySelector('.dye-picker .dye-chip');
    if (chip) page.fire(chip, new StandInEvent('click'));
    const tabs = ui.root.querySelectorAll('.dye-picker .dye-tab');
    if (tabs[1]) page.fire(tabs[1], new StandInEvent('click'));
    const close = ui.root.querySelector('.dye-picker .dye-close');
    if (close) page.fire(close, new StandInEvent('click'));
    await flush();
  }
  for (const id of ui.root.querySelectorAll('.hair-grid .bp-cell[data-id]').map((c) => c.dataset.id ?? '').slice(0, 3)) {
    const cell = ui.root.querySelectorAll('.hair-grid .bp-cell[data-id]').find((c) => (c.dataset.id ?? '') === id);
    if (!cell) continue;
    page.fire(cell, new StandInEvent('click'));
    await flush();
  }
  log.push(`markup ${ui.root.innerHTML}`);
  ui.hide();
  parent.remove();
  return log;
}

/** Two sessions' records held equal entry by entry, by `Object.is`. */
function same(a: string[], b: string[]): { ok: boolean; at: number } {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (!Object.is(a[i], b[i])) return { ok: false, at: i };
  return { ok: true, at: -1 };
}

const ours: Spec = {
  manifest: {
    id: 'human_male',
    gender: 'male',
    parts: [{ name: 'hum_m_body_l0', body: true, morphs: ['blend_fat_0', 'blend_fat_1', 'blend_muscle'] }],
    variables: [
      { name: '/shared_owner/index_color_skin', private: false, kind: 'palette', default: 0, colors: [[10, 9, 8], [40, 30, 20], [90, 70, 50]], palette: 'palette/human_skin.pal' },
      { name: '/shared_owner/index_age', private: false, kind: 'index', default: 0, count: 3 },
      { name: '/shared_owner/blend_muscle', private: false, kind: 'index', default: 0, count: 4 },
      { name: '/private/index_color_1', private: true, kind: 'palette', default: 0, colors: [[100, 0, 0], [0, 100, 0], [0, 0, 100]], palette: 'palette/wr_leather.pal', meshes: ['jacket_s11_m_l0'] },
      { name: '/private/index_color_2', private: true, kind: 'palette', default: 1, colors: [[1, 1, 1], [2, 2, 2]], palette: 'palette/wr_cloth.pal', meshes: ['jacket_s11_m_l0', 'jacket_s11_lining_m_l0'] },
      { name: '/private/index_texture_1', private: true, kind: 'index', default: 0, count: 3, meshes: ['pants_s01_m_l0'] },
    ],
    values: { '/shared_owner/index_color_skin': 1 },
    defaultWear: ['shirt_s03_m_l0'],
  },
  items: [
    { id: 'jacket_s11', kind: 'wearables', gender: 'm', template: 'object/tangible/wearables/jacket/shared_jacket_s11.iff', name: 'Jacket', slots: [['chest2']], parts: [{ name: 'jacket_s11_m_l0' }, { name: 'jacket_s11_lining_m_l0' }] },
    { id: 'shirt_s03', kind: 'wearables', gender: 'm', template: 'object/tangible/wearables/shirt/shared_shirt_s03.iff', name: 'Shirt', slots: [['chest1']], parts: [{ name: 'shirt_s03_m_l0' }] },
    { id: 'shirt_s04', kind: 'wearables', gender: 'm', template: 'object/tangible/wearables/shirt/shared_shirt_s04.iff', name: 'Other shirt', slots: [['chest1']], parts: [{ name: 'shirt_s04_m_l0' }] },
    { id: 'pants_s01', kind: 'wearables', gender: 'm', template: 'object/tangible/wearables/pants/shared_pants_s01.iff', name: 'Trousers', slots: [['pants1']], parts: [{ name: 'pants_s01_m_l0' }] },
    { id: 'hat_s01', kind: 'wearables', gender: 'm', template: 'object/tangible/wearables/hat/shared_hat_s01.iff', name: 'Hat', slots: [['hat']], fit: { hide: ['human_male'] }, parts: [{ name: 'hat_s01_m_l0' }] },
    { id: 'boots_s05', kind: 'wearables', gender: 'm', template: 'object/tangible/wearables/boots/shared_boots_s05.iff', name: 'Boots', slots: [['shoes']], fit: { block: ['human_male'] }, parts: [{ name: 'boots_s05_m_l0' }] },
    { id: 'hair_human_male_s01', kind: 'hair', gender: 'm', template: 'object/tangible/hair/human/shared_hair_human_male_s01.iff', name: null, parts: [{ name: 'hair_human_male_s01_m_l0' }] },
    { id: 'hair_human_male_s02', kind: 'hair', gender: 'm', template: 'object/tangible/hair/human/shared_hair_human_male_s02.iff', name: null, parts: [{ name: 'hair_human_male_s02_m_l0' }] },
  ],
  worn: ['shirt_s03_m_l0'],
  wear: ['jacket_s11'],
  species: 'human',
  gender: 'male',
  dir: '/assets-private/wardrobe/human_male/',
  base: '/ours/',
};

/** The human male's own pack, wardrobe, recipes and creator table, where they are converted here. */
function realSpec(): Spec | null {
  const parts = join(PACKS, 'characters', 'human_male', 'parts.json');
  const wardrobe = join(PACKS, 'wardrobe', 'human_male', 'wardrobe.json');
  if (!existsSync(parts) || !existsSync(wardrobe)) return null;
  const manifest = JSON.parse(readFileSync(parts, 'utf8')) as Spec['manifest'];
  const w = JSON.parse(readFileSync(wardrobe, 'utf8')) as { items: ItemSpec[] };
  for (const [url, file] of [
    ['/assets-private/characters/customization.json', join(PACKS, 'characters', 'customization.json')],
    ['/assets-private/wardrobe/human_male/customize.json', join(PACKS, 'wardrobe', 'human_male', 'customize.json')],
  ] as const)
    if (existsSync(file)) served.set(url, readFileSync(file, 'utf8'));
  const worn = (manifest.defaultWear ?? []).slice();
  const jacket = w.items.find((i) => i.id === 'jacket_s11') ?? w.items.find((i) => i.kind === 'wearables' && i.slots?.[0]?.includes('chest2'));
  return { manifest, items: w.items, worn, wear: jacket ? [jacket.id] : [], species: 'human', gender: 'male', dir: '/assets-private/wardrobe/human_male/', base: '/' };
}

/**
 * What c3d619d's own pages wrote over the figure of ours, recorded from c3d619d's `wardrobeUi.ts` and `appearanceUi.ts`
 * themselves (each session's every entry, in order, its markup at the end, hashed): today's pages are held to it always, so
 * where git cannot hand c3d619d over the replay still holds them to the old pages. A change to either page that moves what
 * a pick writes, or what it draws, fails here and must be looked at.
 */
const RECORDED: Record<string, string> = {
  'clothes, through the equipment': '7cc26b2bdf8e253c',
  'clothes, straight onto the figure': 'd957993ebee9e006',
  appearance: 'bd5973d0f7d05264',
};
const digest = (log: readonly string[]) => createHash('sha256').update(JSON.stringify(log)).digest('hex').slice(0, 16);

{
  const wNow = await loadPage(today('src/ui/wardrobeUi.ts'), 'src/ui/wardrobeUi.ts', 'wardrobe-now');
  const aNow = await loadPage(today('src/ui/appearanceUi.ts'), 'src/ui/appearanceUi.ts', 'appearance-now');
  const wOld = old ? await loadPage(old.get('src/ui/wardrobeUi.ts')!, 'src/ui/wardrobeUi.ts', 'wardrobe-old') : null;
  const aOld = old ? await loadPage(old.get('src/ui/appearanceUi.ts')!, 'src/ui/appearanceUi.ts', 'appearance-old') : null;
  const specs: [string, Spec][] = [['a figure of ours', ours]];
  // The figure of ours first, on a base nothing is served under: its sessions read no converted file, so what they write is
  // the same on every machine and can be recorded.
  for (const [name, spec] of specs) {
    for (const hooks of [true, false]) {
      const label = hooks ? 'clothes, through the equipment' : 'clothes, straight onto the figure';
      const a = wOld ? await wardrobeSession(wOld, spec, hooks) : null;
      const b = await wardrobeSession(wNow, spec, hooks);
      const writes = b.filter((x) => /^(onWear|onRemove|remove|wear|wearItem) /.test(x)).length;
      if (a) {
        const s = same(a, b);
        ok(s.ok && writes > 2, `${name}: the Clothes page ${hooks ? "through the game's equipment" : 'straight onto the figure'} writes what ${PRE_WAVE}'s wrote, every write and its markup by Object.is (${a.length} entries, ${writes} writes${s.ok ? '' : `; first differs at ${s.at}: ${String(a[s.at]).slice(0, 120)} / ${String(b[s.at]).slice(0, 120)}`})`);
        ok(digest(a) === RECORDED[label], `and ${PRE_WAVE}'s own session is the one recorded from it (${label}: ${digest(a)})`);
      }
      ok(digest(b) === RECORDED[label] && writes > 2, `${name}: today's Clothes page ${hooks ? "through the game's equipment" : 'straight onto the figure'} writes the session recorded from ${PRE_WAVE}'s (${digest(b)}, ${b.length} entries, ${writes} writes)`);
    }
    const a = aOld ? await appearanceSession(aOld, spec) : null;
    const b = await appearanceSession(aNow, spec);
    const writes = b.filter((x) => /^(setMorph|setHeight|setVariable|wearHair|item) /.test(x)).length;
    if (a) {
      const s = same(a, b);
      ok(s.ok && writes > 4, `${name}: the appearance page and its picker write what ${PRE_WAVE}'s wrote, every write and its markup by Object.is (${a.length} entries, ${writes} writes${s.ok ? '' : `; first differs at ${s.at}: ${String(a[s.at]).slice(0, 120)} / ${String(b[s.at]).slice(0, 120)}`})`);
      ok(digest(a) === RECORDED.appearance, `and ${PRE_WAVE}'s own session is the one recorded from it (appearance: ${digest(a)})`);
    }
    ok(digest(b) === RECORDED.appearance && writes > 4, `${name}: today's appearance page and its picker write the session recorded from ${PRE_WAVE}'s (${digest(b)}, ${b.length} entries, ${writes} writes)`);
    // The session reached every kind of write the page makes: a slider, the height, a colour, a garment's own colour, a
    // picker opened, a hairstyle.
    const kinds = ['setMorph', 'setHeight', 'setVariable', 'item', 'wearHair'].map((k) => [k, b.filter((x) => x.startsWith(`${k} `)).length] as const);
    const opened = b.filter((x) => /^picker \{"open":"/.test(x)).length;
    ok(kinds.every(([, n]) => n > 0) && opened > 0, `${name}: and the session reached every kind of write the page makes (${kinds.map(([k, n]) => `${k} ${n}`).join(', ')}, ${opened} pickers opened)`);
  }
  // The human male's own pack, wardrobe, recipes and creator table, where converted: c3d619d's pages beside today's.
  const real = realSpec();
  if (!real) note('no human male pack converted here: the replay runs over a figure of ours alone');
  else if (!wOld || !aOld) note(`git cannot hand ${PRE_WAVE} over here: the replay over the human male's own pack is not compared`);
  else {
    const name = "the human male's own pack, wardrobe and table";
    for (const hooks of [true, false]) {
      const a = await wardrobeSession(wOld, real, hooks);
      const b = await wardrobeSession(wNow, real, hooks);
      const s = same(a, b);
      const writes = a.filter((x) => /^(onWear|onRemove|remove|wear|wearItem) /.test(x)).length;
      ok(s.ok && writes > 2, `${name}: the Clothes page ${hooks ? "through the game's equipment" : 'straight onto the figure'} writes what ${PRE_WAVE}'s wrote, every write and its markup by Object.is (${a.length} entries, ${writes} writes${s.ok ? '' : `; first differs at ${s.at}: ${String(a[s.at]).slice(0, 120)} / ${String(b[s.at]).slice(0, 120)}`})`);
    }
    const a = await appearanceSession(aOld, real);
    const b = await appearanceSession(aNow, real);
    const s = same(a, b);
    const writes = a.filter((x) => /^(setMorph|setHeight|setVariable|wearHair|item) /.test(x)).length;
    ok(s.ok && writes > 4, `${name}: the appearance page and its picker write what ${PRE_WAVE}'s wrote, every write and its markup by Object.is (${a.length} entries, ${writes} writes${s.ok ? '' : `; first differs at ${s.at}: ${String(a[s.at]).slice(0, 120)} / ${String(b[s.at]).slice(0, 120)}`})`);
    const kinds = ['setMorph', 'setHeight', 'setVariable', 'item', 'wearHair'].map((k) => [k, a.filter((x) => x.startsWith(`${k} `)).length] as const);
    const opened = a.filter((x) => /^picker \{"open":"/.test(x)).length;
    ok(kinds.every(([, n]) => n > 0) && opened > 0, `${name}: and the session reached every kind of write the page makes (${kinds.map(([k, n]) => `${k} ${n}`).join(', ')}, ${opened} pickers opened)`);
  }
  // A page made for the dresser carries its own tabs, and nothing else of it differs (the same session over the dresser's strip).
  const parent = page.createElement('div');
  page.body.append(parent);
  const W = wNow.WardrobeUi as new (parent: unknown, onChange: () => void, tabs?: { id: string; label: string }[]) => { root: Element0 };
  const tabs = new W(parent, () => {}, [{ id: 'wardrobe', label: 'Clothes' }, { id: 'appearance', label: 'Shape and colours' }]).root.querySelectorAll('.inv-tabs button, [data-tab]');
  const A = aNow.AppearanceUi as new (parent: unknown, onChange: () => void, tabs?: { id: string; label: string }[]) => { root: Element0 };
  const atabs = new A(parent, () => {}, [{ id: 'wardrobe', label: 'Clothes' }, { id: 'appearance', label: 'Shape and colours' }]).root.querySelectorAll('.inv-tabs button, [data-tab]');
  ok(tabs.length === 2 && tabs.some((t) => /Shape and colours/.test(t.textContent)) && atabs.length === 2 && atabs.some((t) => /Clothes/.test(t.textContent)), `both pages made for the dresser draw the dresser's own two tabs and no other (${tabs.map((t) => t.textContent.trim()).join(', ')}; ${atabs.map((t) => t.textContent.trim()).join(', ')})`);
  parent.remove();
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\ndresser: ${checks} checks passed`);
