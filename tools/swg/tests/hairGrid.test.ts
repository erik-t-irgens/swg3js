// The hairstyles as a grid of pictures (src/ui/hairGrid.ts): which groups, in which order, which styles in
// each, where the cell for no hair stands, what a cell reads, the style a new character starts in, the
// colour a new style carries over from the old, and the Sullustan's hair tab of ours.
//
// Run first over a small made-up table and wardrobe that have one of everything, then over every species
// converted on this machine with the table the `customization` command wrote and the wardrobe folders the
// `wardrobe` command wrote, with a real `Customizer` fed the wardrobe's customize.json for the colour
// carried. A machine without them says so and checks the made-up ones alone.
//
// Nothing here quotes the client's words: a label is checked against what the table carries.
//
// Run: node tools/swg/tests/hairGrid.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HAIR_TUNE, NO_HAIR, carryHairColour, defaultHair, hairCarryFor, hairCells, hairGender, hairStyleNumber, styleLabel, withOursHair, type HairItem } from '../../../src/ui/hairGrid.ts';
import { creatorView, type CreatorTable, type CreatorVariable } from '../../../src/ui/creatorModel.ts';
import { hairOfSpecies, isHairKey, migrateInventory } from '../../../src/core/inventory.ts';
import { giveCellHtml } from '../../../src/ui/giveModel.ts';
import { Customizer } from '../../../src/player/customizer.ts';
import { atBase, traceHash } from './atBase.ts';

/** The labels of the plain sweep below through `styleLabel` as it stood at the pass's base (`atBase`), for a checkout git cannot answer in. */
const STYLE_LABEL_BASE_HASH = '75c86f293074';
/** Today's grids over the made-up rows (`flatGrid`), which the base check shows are the base's less the drops the rule names, for a checkout git cannot answer in. */
const HAIR_CELLS_TRACE_HASH = 'e8b789558e6e';

/** A grid's cells in order as group, id and mesh (`hairGrid`'s own mesh key: the style's part files, sorted), no-hair left out, and whether no hair is offered. */
function flatGrid(g: { none: boolean; groups: { id: string; cells: { id: string }[] }[] }, items: readonly HairItem[]): { none: boolean; cells: { group: string; id: string; mesh: string }[] } {
  const meshOf = new Map(items.map((i) => [i.id, (i.parts ?? []).map((p) => p.file ?? p.name ?? '').sort().join(',')]));
  return { none: g.none, cells: g.groups.flatMap((x) => x.cells.filter((c) => c.id !== NO_HAIR).map((c) => ({ group: x.id, id: c.id, mesh: meshOf.get(c.id) ?? '' }))) };
}

/**
 * Whether today's grid is the base's less only cells of the other gender's group whose meshes an earlier cell the grid
 * keeps already shows (the dedupe SOE's final table asked for), with no cell added and the order kept; and which were
 * dropped.
 */
function againstBase(base: ReturnType<typeof flatGrid>, now: ReturnType<typeof flatGrid>): { ok: boolean; dropped: string[]; why: string } {
  const key = (c: { group: string; id: string }) => `${c.group}:${c.id}`;
  const kept = new Set(now.cells.map(key));
  const left = base.cells.filter((c) => kept.has(key(c)));
  if (base.none !== now.none) return { ok: false, dropped: [], why: 'no hair offered differently' };
  if (left.length !== now.cells.length || left.some((c, i) => key(c) !== key(now.cells[i]))) return { ok: false, dropped: [], why: 'a cell added or moved' };
  const dropped: string[] = [];
  for (let i = 0; i < base.cells.length; i++) {
    const c = base.cells[i];
    if (kept.has(key(c))) continue;
    if (c.group !== 'other') return { ok: false, dropped, why: `${key(c)} dropped from a group the dedupe never touches` };
    const twin = c.mesh && base.cells.slice(0, i).some((e) => kept.has(key(e)) && e.mesh === c.mesh);
    if (!twin) return { ok: false, dropped, why: `${c.id} dropped with no earlier cell showing its mesh` };
    dropped.push(c.id);
  }
  return { ok: true, dropped, why: '' };
}

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

// ---------------------------------------------------------------- the pieces

ok(hairGender('hair_human_female_s04') === 'female' && hairGender('hair_human_male_s04') === 'male' && hairGender('sul_hair_s03_f') === 'female' && hairGender('sul_hair_s03_m') === 'male', "a style's gender is read from its id, the Sullustan's from the letter at its end");
ok(hairStyleNumber('hair_twilek_female_s07') === 7 && hairStyleNumber('sul_hair_s18_m') === 18 && hairStyleNumber('hair_x') === null, "a style's number is the `_sNN` its id ends in");
ok(styleLabel('hair_zabrak_male_s12') === 'Style 12' && styleLabel('sul_hair_s02_f') === 'Style 2', 'a cell reads "Style N"');
ok(styleLabel('sul_beard_s03_m') === 'Beard 3' && styleLabel('hair_wookiee_male_beard_s10') === 'Beard 10' && styleLabel('sul_hair_s03_m') === 'Style 3', 'a beard reads "Beard N", so a Sullustan man\'s twelve beards no longer say what his first twelve styles say');
ok(isHairKey('hair_human_male_s01') && isHairKey('sul_hair_s01_f') && isHairKey('sul_beard_s12_m') && isHairKey('singing_mountain_clan_bangs_s01') && !isHairKey('shirt_s03') && !isHairKey('chair_s01'), "every hairstyle id is hair, the Sullustan's, their beards and the clan's bangs too, and nothing else is");
{
  // The day one (the pass's ground rule 7): every id the label of before read without a beard in it reads the same
  // now, held to the function as it stood at the pass's base, or where git cannot hand it over to a hash of its trace.
  const sweep: string[] = [];
  for (const sp of ['human', 'twilek', 'zabrak', 'rodian', 'bothan', 'trandoshan', 'wookiee', 'moncal']) for (const g of ['male', 'female']) for (let n = 1; n <= 72; n++) sweep.push(`hair_${sp}_${g}_s${String(n).padStart(2, '0')}`, `hair_${sp}_${g}_s${n}`);
  for (let n = 1; n <= 30; n++) for (const g of ['f', 'm']) sweep.push(`sul_hair_s${String(n).padStart(2, '0')}_${g}`);
  sweep.push('hair_x', 'hair_human_male', 'singing_mountain_clan_bangs_s01', 'hair_wookiee_dreds', 'npc_hum_m_hair_s43');
  const plain = sweep.filter((id) => !/beard/.test(id));
  const old = await atBase<{ styleLabel: (id: string) => string }>('src/ui/hairGrid.ts');
  if (old) ok(plain.every((id) => styleLabel(id) === old.styleLabel(id)), `every id the label of before read without a beard reads the same (${plain.length}, against the pass's base)`);
  else ok(traceHash(plain.map(styleLabel)) === STYLE_LABEL_BASE_HASH, `every id the label of before read without a beard reads the same (${plain.length}, against the base's trace hash: git could not hand the old file over)`);
}
{
  const rec = migrateInventory({ outfit: ['sul_hair_s01_f', 'hair_human_male_s02', 'shirt_s03'], items: [] }, [], (p) => p, 0);
  ok(rec.items!.map((o) => o.id).join() === 'shirt_s03', "bringing a record into the backpack leaves the Sullustan's hair out, as it does every other style");
}

// ---------------------------------------------------------------- a made-up table and wardrobe

const item = (id: string, species: string, file = `${id}_l0.glb`, icon: string | null = `icons/${id}.png`): HairItem => ({ id, kind: 'hair', template: `object/tangible/hair/${species}/shared_${id}.iff`, icon, parts: [{ file, name: file.replace(/\.glb$/, '') }] });
const ITEMS: HairItem[] = [
  item('hair_fox_female_s01', 'fox'),
  item('hair_fox_female_s03', 'fox'),
  item('hair_fox_female_s05', 'fox', undefined, null),
  item('hair_fox_female_s08', 'fox'),
  item('hair_fox_male_s02', 'fox'),
  item('hair_fox_male_s07', 'fox'),
  item('hair_newt_female_s01', 'newt'),
  item('hair_newt_female_s02', 'newt'),
  item('hair_newt_male_s01', 'newt'),
  // Two templates wearing one mesh, as the Sullustan's do.
  item('sul_hair_s01_f', 'sullustan', 'sul_hair_s01_f_l0.glb'),
  item('sul_hair_s01_m', 'sullustan', 'sul_hair_s01_f_l0.glb'),
  item('sul_hair_s02_f', 'sullustan', 'sul_hair_s02_f_l0.glb'),
  item('sul_hair_s02_m', 'sullustan', 'sul_hair_s02_f_l0.glb'),
  // Another species' style the fox must never be offered, and a clan's under a folder of its own.
  item('hair_owl_female_s01', 'owl'),
  item('hair_singing_mountain_clan_s01', 'singing_mountain_clan'),
  { id: 'shirt_s03', kind: 'wear', template: 'object/tangible/wearables/shirt/shared_shirt_s03.iff' },
];
const hairRow = (id: string, creation: boolean, inArchives = true) => ({ template: `object/tangible/hair/x/shared_${id}.iff`, id, inArchives, creation, skill: creation ? 1 : 4 });
const TABLE: CreatorTable = {
  format: 1,
  source: 'test',
  palettes: {},
  species: {
    // Deliberately not creation-first in the table, so a grid that kept the raw order is caught.
    fox_female: { bald: true, groups: [{ id: 'hair', label: 'g:hair', hair: true }], rows: [{ name: 'color_hair', label: 'r:hair', group: 'hair', type: 'color', variables: ['index_color_1'], onHair: true }], hair: [hairRow('hair_fox_female_s05', false), hairRow('hair_fox_female_s03', true), hairRow('hair_fox_female_s01', true), hairRow('hair_fox_female_s09', true, false)] },
    fox_male: { bald: true, groups: [{ id: 'hair', label: 'g:hair', hair: true }], rows: [], hair: [hairRow('hair_fox_male_s02', true)] },
    // An image designer's style first and a creation style the wardrobe lacks next, ahead of the creation style
    // a new one really starts in: a default that took the table's first row, or skipped the wardrobe test, is caught.
    newt_female: { bald: false, groups: [{ id: 'ridges', label: 'g:ridges', hair: true }], rows: [], hair: [hairRow('hair_newt_female_s01', false), hairRow('hair_newt_female_s09', true), hairRow('hair_newt_female_s02', true)] },
    newt_male: { bald: false, groups: [{ id: 'ridges', label: 'g:ridges', hair: true }], rows: [], hair: [hairRow('hair_newt_male_s01', true)] },
    sullustan_female: { groups: [{ id: 'body', label: 'g:body' }], rows: [], hair: [] },
    sullustan_male: { groups: [{ id: 'body', label: 'g:body' }], rows: [], hair: [] },
  },
};
const ids = (cells: { id: string }[]) => cells.map((c) => c.id).join();
{
  ok(hairOfSpecies(ITEMS, 'fox').length === 6 && !hairOfSpecies(ITEMS, 'fox').some((i) => /owl|clan/.test(i.id)), "a species' styles are its own folder's, both genders', and never another's or the clan's");
  const g = hairCells(TABLE, ITEMS, 'fox', 'female', 'hair_fox_male_s02', 'pack://wardrobe/');
  ok(g.fromTable && g.groups.map((x) => x.id).join() === 'own,other,untabled', 'the groups: this gender, the other, then what no row names');
  ok(ids(g.groups[0].cells) === `${NO_HAIR},hair_fox_female_s03,hair_fox_female_s01,hair_fox_female_s05`, "no hair leads a species that may go bald, then the creation styles in the table's order, then the image designer's, and a row the archives lack is skipped");
  ok(g.groups[0].cells.slice(1).map((c) => c.label).join() === 'Style 3,Style 1,Style 5', 'each reads "Style N"');
  ok(ids(g.groups[1].cells) === 'hair_fox_male_s02' && g.groups[1].cells[0].other && g.groups[1].cells[0].on && g.groups[1].cells[0].tag === 'worn', "the other gender's are offered, marked as the other's, and the worn one is marked worn");
  ok(ids(g.groups[2].cells) === 'hair_fox_female_s08,hair_fox_male_s07', "what no row of either gender names comes last, this gender's first");
  ok(!g.groups[0].cells[0].on && g.worn === 'hair_fox_male_s02', 'no hair is not marked while a style is on');
  ok(g.groups[0].cells[1].icon === 'pack://wardrobe/icons/hair_fox_female_s03.png' && g.groups[0].cells[1].picture === 'icon', "a cell's picture is the converter's, under the wardrobe folder");
  const blank = g.groups[0].cells.find((c) => c.id === 'hair_fox_female_s05')!;
  ok(blank.picture === 'blank' && blank.initials === '5', 'a style with no picture stands as its number');
  ok(/hair_fox_female_s03/.test(g.groups[0].cells[1].title) && /shared_hair_fox_female_s03\.iff/.test(g.groups[0].cells[1].title), 'the id and the template are in the tooltip');
  ok(g.styles === 6, 'six styles offered, no hair not counted');
  const html = giveCellHtml(g.groups[1].cells[0], { on: 'worn', selected: false });
  ok(/class="bp-cell worn/.test(html) && /<img src="pack:\/\/wardrobe\/icons\/hair_fox_male_s02\.png"/.test(html) && /data-id="hair_fox_male_s02"/.test(html), "a cell is the backpack's own markup, the worn one marked and its picture an <img>");
  const none = hairCells(TABLE, ITEMS, 'fox', 'female', null);
  ok(none.groups[0].cells[0].id === NO_HAIR && none.groups[0].cells[0].on && none.groups[0].cells[0].label === 'None', 'with nothing on, no hair is the worn cell');
}
{
  const g = hairCells(TABLE, ITEMS, 'newt', 'female', 'hair_newt_female_s01');
  ok(g.none && g.groups[0].cells[0].id === NO_HAIR && !g.groups[0].cells[0].on, "a species the game kept from going bald is offered no hair all the same, leading its own styles (the owner's call)");
  const bare = hairCells(TABLE, ITEMS, 'newt', 'female', null);
  ok(bare.none && bare.groups[0].cells[0].on, 'and with none on, no hair is the worn cell');
  ok(ids(g.groups[0].cells) === `${NO_HAIR},hair_newt_female_s02,hair_newt_female_s01`, "its own styles after it: the creation one ahead of the image designer's, the one the wardrobe lacks skipped");
  ok(defaultHair(TABLE, ITEMS, 'newt', 'female') === 'hair_newt_female_s02', "a new character of a species that may not go bald starts in the table's first creation style the wardrobe has, not the table's first row (an image designer's) nor a creation style the wardrobe lacks");
  ok(defaultHair(TABLE, ITEMS, 'fox', 'female') === null && defaultHair(null, ITEMS, 'newt', 'female') === null, 'one that may go bald starts in none, and without a table nothing is chosen');
}
{
  const g = hairCells(TABLE, ITEMS, 'sullustan', 'female', null);
  ok(g.groups.map((x) => x.id).join() === 'untabled' && ids(g.groups[0].cells) === `${NO_HAIR},sul_hair_s01_f,sul_hair_s02_f`, "the Sullustan's, which no row names, are one group of this gender's, each pair wearing one mesh offered once, with no hair leading");
  const m = hairCells(TABLE, ITEMS, 'sullustan', 'male', 'sul_hair_s02_m');
  ok(ids(m.groups[0].cells) === `${NO_HAIR},sul_hair_s01_m,sul_hair_s02_m` && m.groups[0].cells[2].on, "and a male's are the male templates");
}
{
  // SOE's final table gives both genders of a species each the other's styles on the very same meshes (the Wookiees'
  // and the Sullustans'), and a man his beards: the other gender's group leaves out a style whose meshes this gender's
  // already show, as the untabled one always did, and a beard reads "Beard N" beside the styles.
  const bird = (id: string, file: string) => item(id, 'bird', `${file}_l0.glb`);
  const items2 = [bird('hair_bird_female_s01', 'a'), bird('hair_bird_female_s02', 'b'), bird('hair_bird_male_s01', 'a'), bird('hair_bird_male_s02', 'c'), bird('hair_bird_male_beard_s01', 'd')];
  const table2: CreatorTable = {
    format: 1,
    source: 'test',
    palettes: {},
    species: {
      bird_female: { bald: true, groups: [{ id: 'hair', label: 'g:hair', hair: true }], rows: [], hair: [hairRow('hair_bird_female_s01', true), hairRow('hair_bird_female_s02', true)] },
      bird_male: { bald: true, groups: [{ id: 'hair', label: 'g:hair', hair: true }], rows: [], hair: [hairRow('hair_bird_male_s01', true), hairRow('hair_bird_male_s02', true), hairRow('hair_bird_male_beard_s01', false)] },
    },
  };
  const f = hairCells(table2, items2, 'bird', 'female', null);
  ok(ids(f.groups[1].cells) === 'hair_bird_male_s02,hair_bird_male_beard_s01', `a woman's grid offers the men's styles whose meshes hers do not show, the one on her own first style's mesh left out (${ids(f.groups[1].cells)})`);
  ok(f.groups[1].cells.map((c) => c.label).join() === 'Style 2,Beard 1', 'and the beard reads as a beard');
  const m = hairCells(table2, items2, 'bird', 'male', null);
  ok(ids(m.groups[0].cells) === `${NO_HAIR},hair_bird_male_s01,hair_bird_male_s02,hair_bird_male_beard_s01` && m.groups[0].cells.slice(1).map((c) => c.label).join() === 'Style 1,Style 2,Beard 1', "a man's own group: his styles, then his beard, no label said twice");
  ok(ids(m.groups[1].cells) === 'hair_bird_female_s02', "and the women's group holds only the style whose mesh none of his shows");
  const same = { ...table2, species: { bird_female: table2.species.bird_female, bird_male: { ...table2.species.bird_male, hair: [hairRow('hair_bird_male_s01', true)] } } };
  ok(hairCells(same, items2.slice(0, 3), 'bird', 'male', null).groups.map((x) => x.id).join() === 'own,other' && hairCells(same, [items2[0], items2[2]], 'bird', 'male', null).groups.map((x) => x.id).join() === 'own', 'a species whose genders wear every style on the same meshes has no other gender\'s group at all');

  // The day one (the pass's ground rule 7) over the made-up rows: today's grid is the base's, cell for cell and in its
  // order, less only cells of the other gender's group whose meshes an earlier cell of the grid already shows, and
  // nothing new; held to the function as it stood at the pass's base, or where git cannot hand it over to a hash of
  // today's trace, which the base check showed to be exactly that.
  const cases: [CreatorTable | null, HairItem[], string, 'female' | 'male'][] = [];
  for (const g of ['female', 'male'] as const) {
    cases.push([TABLE, ITEMS, 'fox', g], [TABLE, ITEMS, 'newt', g], [TABLE, ITEMS, 'sullustan', g], [table2, items2, 'bird', g], [null, ITEMS, 'fox', g]);
  }
  const old = await atBase<{ hairCells: typeof hairCells }>('src/ui/hairGrid.ts');
  const trace = cases.map(([t, it, sp, g]) => flatGrid(hairCells(t, it, sp, g, null), it));
  if (old) {
    const res = cases.map(([t, it, sp, g], i) => ({ what: `${sp} ${g}`, ...againstBase(flatGrid(old.hairCells(t, it, sp, g, null), it), trace[i]) }));
    const bad = res.filter((r) => !r.ok);
    const dropped = res.filter((r) => r.dropped.length).map((r) => `${r.what}: ${r.dropped.join(', ')}`);
    ok(!bad.length && dropped.join('; ') === 'bird female: hair_bird_male_s01; bird male: hair_bird_female_s01', `today's grid is the base's less the other gender's styles whose meshes an earlier cell shows, and nothing new (${cases.length} grids against the pass's base; dropped ${dropped.join('; ') || 'none'}${bad.length ? `; wrong: ${bad.map((r) => `${r.what}: ${r.why}`).join('; ')}` : ''}; trace ${traceHash(trace)})`);
  } else ok(traceHash(trace) === HAIR_CELLS_TRACE_HASH, `today's grid over the made-up rows is the base's less the drops the rule names (${cases.length} grids, against the trace hash: git could not hand the old file over)`);
}
{
  const g = hairCells(null, ITEMS, 'fox', 'male', 'hair_fox_female_s03');
  ok(!g.fromTable && g.groups.length === 1 && g.groups[0].id === 'styles' && g.groups[0].cells[0].id === NO_HAIR && g.groups[0].cells.length === 7, 'without a table: one group of every style of the species, both genders, with no hair leading, as before');
  ok(g.groups[0].cells.find((c) => c.id === 'hair_fox_female_s03')!.label === 's03' && g.groups[0].cells.find((c) => c.id === 'hair_fox_female_s03')!.on, "named as the list of before named them, the worn one marked");
  ok(hairCells(TABLE, ITEMS, 'owl_and_pussycat', 'female', null).groups.length === 0, 'a species with no styles has no grid');
}

// ---------------------------------------------------------------- the colour a new style carries

{
  const carried = carryHairColour({ 'm_s01_l0|index_color_1': 5, 'm_s01_l0|/private/index_color_2': 3 }, [{ key: 'm_s04_l0|index_color_1', name: 'index_color_1' }, { key: 'm_s04_l0|/private/index_color_2', name: '/private/index_color_2' }, { key: 'm_s04_l0|index_color_9', name: 'index_color_9' }], { 'hair|index_color_1': 7 });
  ok(carried['m_s04_l0|index_color_1'] === 7, 'the remembered hair colour comes first');
  ok(carried['m_s04_l0|/private/index_color_2'] === 3, "a colour nothing remembers is the old style's of the same bare name, whichever way either key is spelt");
  ok(!('m_s04_l0|index_color_9' in carried), 'and one the old style never had is left at its default');
  ok(carryHairColour({ 'm_s01_l0|index_color_1': 5 }, [{ key: 'm_s04_l0|index_color_1', name: 'index_color_1' }], {})['m_s04_l0|index_color_1'] === 5, "with nothing remembered, the old style's colour");
  ok(Object.keys(carryHairColour({}, [{ key: 'x|index_color_1', name: 'index_color_1' }], {})).length === 0, 'from none, with nothing remembered, nothing is carried');
}
{
  // What the game gathers from the character before the carry (`hairCarryFor`, which `App.hairColourFor`
  // calls): the remembered colours, the worn style's own, and the new style's private palette colours, its
  // only mesh loaded under the suffixed name a second material gives it.
  const parts = [
    { name: 'body', meshNames: ['body_l0'] },
    { name: 'hair_a', meshNames: ['a_l0'] },
    { name: 'hair_b', meshNames: ['b_l0_1'] },
  ];
  const values: [string, number][] = [
    ['a_l0|index_color_1', 5],
    ['hair|index_color_2', 8],
    ['body_l0|index_color_3', 99],
    ['index_color_3', 4],
  ];
  const variable = (key: string, name: string, mesh: string, priv = true, kind = 'palette') => ({ key, name, mesh, private: priv, kind });
  const vars = [
    variable('b_l0|index_color_1', 'index_color_1', 'b_l0'),
    variable('b_l0|index_color_2', 'index_color_2', 'b_l0'),
    variable('b_l0|index_color_3', 'index_color_3', 'b_l0'),
    variable('b_l0|blend_length', 'blend_length', 'b_l0', true, 'index'),
    variable('index_color_1', 'index_color_1', 'b_l0', false),
    variable('c_l0|index_color_1', 'index_color_1', 'c_l0'),
  ];
  const got = hairCarryFor(parts, ['hair_a'], 'hair_b', values, vars);
  ok(got['b_l0|index_color_1'] === 5, "the worn style's own colour reaches the new style's key of that name, its mesh found under the suffixed name");
  ok(got['b_l0|index_color_2'] === 8, 'the remembered colour reaches the new style');
  ok(!('b_l0|index_color_3' in got), "the body's colour of that name is not the hair's to carry");
  ok(Object.keys(got).join() === 'b_l0|index_color_1,b_l0|index_color_2', `nothing but the new style's own private palette colours is written (${Object.keys(got).join(', ')})`);
  ok(Object.keys(hairCarryFor(parts, ['hair_a'], 'hair_c', values, vars)).length === 0, 'a style with no part loaded takes nothing');
}

// ---------------------------------------------------------------- the Sullustan's hair tab of ours

{
  const entry = TABLE.species.sullustan_female;
  const withOurs = withOursHair(TABLE, entry, 'sullustan', true)!;
  ok(withOurs.groups.some((g) => g.hair && g.ours) && withOurs.rows.some((r) => r.ours && r.onHair && r.variables.join() === 'index_color_hair'), 'a species the table gives no hair tab, with styles, gets a hair tab of ours and a colour row of ours over its styles\' one variable');
  ok(withOurs.groups.find((g) => g.hair)!.label === TABLE.species.fox_female.groups[0].label && withOurs.rows.find((r) => r.ours)!.label === 'r:hair', "in the table's own words, borrowed from a species that has them");
  ok(withOursHair(TABLE, entry, 'sullustan', false) === entry && withOursHair(TABLE, TABLE.species.fox_female, 'fox', true) === TABLE.species.fox_female, 'none without styles, and none for a species that is not ours to give one');
  // A table that some day gives the Sullustan a hair tab of its own: ours must stand aside, or the page shows two.
  const own = { ...entry, groups: [...entry.groups, { id: 'hair', label: 'g:hair', hair: true }] };
  const kept = withOursHair(TABLE, own, 'sullustan', true);
  ok(kept === own && !kept!.groups.some((g) => g.ours) && !kept!.rows.some((r) => r.ours), 'and none for a species of ours whose table has a hair tab of its own');
  const v = (key: string, name: string, priv: boolean, mesh: string): CreatorVariable => ({ key, name, private: priv, mesh, default: 0, kind: 'palette', colors: [[1, 2, 3], [4, 5, 6]] });
  const view = creatorView(withOurs, { morphs: {}, variables: [v('sul_hair_s01_f_l0|index_color_hair', 'index_color_hair', true, 'sul_hair_s01_f_l0')], bodyMeshes: [], hairMeshes: ['sul_hair_s01_f_l0'], hasHairObjects: true })!;
  const hairGroup = view.groups.find((g) => g.id === 'hair')!;
  ok(!!hairGroup && hairGroup.ours === true && hairGroup.rows[0]?.ours === true, 'the page draws the tab and the row as ours');
  ok(hairGroup.rows[0].keys.join() === 'sul_hair_s01_f_l0|index_color_hair,hair|index_color_hair', "the row writes the worn style's colour and the remembered one, so the next style takes it");
  const bald = creatorView(withOurs, { morphs: {}, variables: [], bodyMeshes: [], hairMeshes: [], hasHairObjects: true })!;
  ok(bald.groups.some((g) => g.id === 'hair' && g.ours), 'bald, the tab stays for the grid');
}

// ---------------------------------------------------------------- the stylesheet

{
  const css = readFileSync(fileURLToPath(new URL('../../../src/style.css', import.meta.url)), 'utf8');
  const rule = /#appearance \.cat-grid\s*\{([^}]*)\}/.exec(css);
  const width = rule ? /repeat\(\s*auto-fill\s*,\s*var\(\s*--hair-cell\s*,\s*(\d+)px\s*\)\s*\)/.exec(rule[1]) : null;
  ok(!!width && Number(width[1]) === HAIR_TUNE.cell, `the appearance page's grid columns are HAIR_TUNE.cell wide (${width?.[1] ?? 'not found'} against ${HAIR_TUNE.cell})`);
  const declared = /--hair-cell:\s*(\d+)px\s*;/.exec(css);
  ok(!!declared && Number(declared[1]) === HAIR_TUNE.cell, `and so is the --hair-cell the stylesheet declares (${declared?.[1] ?? 'not declared'})`);
  const cell = /\n\.bp-cell\s*\{([^}]*)\}/.exec(css);
  const cellWidth = cell ? /(?:^|;)\s*width:\s*(\d+)px/.exec(cell[1]) : null;
  ok(!!cellWidth && Number(cellWidth[1]) === HAIR_TUNE.cell, `and that is the backpack's own cell (${cellWidth?.[1] ?? 'not found'})`);
}

// ---------------------------------------------------------------- every species converted on this machine

const ROOT = fileURLToPath(new URL('../../../assets-private/', import.meta.url));
const tableFile = `${ROOT}characters/customization.json`;
const indexFile = `${ROOT}characters/index.json`;
if (!existsSync(tableFile) || !existsSync(indexFile)) {
  note('no creator table or species index on this machine: the made-up ones alone were checked (run the customization and species commands)');
} else {
  const table = JSON.parse(readFileSync(tableFile, 'utf8')) as CreatorTable;
  const index = JSON.parse(readFileSync(indexFile, 'utf8')) as { species: { id: string; species: string; gender: string; wardrobe: string | null }[] };
  const wardrobes = new Map<string, { items: (HairItem & { variables?: { name: string; private: boolean; meshes?: string[] }[] })[] }>();
  const wardrobe = (w: string) => {
    if (!wardrobes.has(w)) wardrobes.set(w, JSON.parse(readFileSync(`${ROOT}wardrobe/${w}/wardrobe.json`, 'utf8')));
    return wardrobes.get(w)!;
  };
  const gridOf = (id: string, worn: string | null = null) => {
    const sp = index.species.find((s) => s.id === id)!;
    if (!sp.wardrobe || !existsSync(`${ROOT}wardrobe/${sp.wardrobe}/wardrobe.json`)) return null;
    return hairCells(table, wardrobe(sp.wardrobe).items, sp.species, sp.gender === 'female' ? 'female' : 'male', worn, 'pack://');
  };
  const counts: string[] = [];
  let checked = 0;
  for (const sp of index.species) {
    const g = gridOf(sp.id);
    if (!g) continue;
    checked++;
    const entry = table.species[sp.id];
    const own = g.groups.find((x) => x.id === 'own');
    counts.push(`${sp.id} ${g.groups.map((x) => `${x.id}:${x.cells.filter((c) => c.id !== NO_HAIR).length}`).join(' ') || 'no styles'}${g.none ? ' +none' : ''}`);
    if (!g.groups.length) continue;
    // The table's own order, creation styles first, the rows the archives lack skipped.
    const want = (entry?.hair ?? []).filter((h) => h.inArchives);
    const wantOrder = [...want.filter((h) => h.creation), ...want.filter((h) => !h.creation)].map((h) => h.id);
    ok((own ? own.cells.filter((c) => c.id !== NO_HAIR).map((c) => c.id) : []).join() === wantOrder.join(), `${sp.id}: this gender's styles are the table's, creation first (${wantOrder.length})`);
    ok(g.none && g.groups[0].cells[0].id === NO_HAIR, `${sp.id}: no hair is offered, leading the grid, whatever the table says (it says ${entry?.bald === false ? 'may not' : 'may'})`);
    ok(g.groups.every((x) => x.cells.every((c) => c.id === NO_HAIR || (/beard/.test(c.id) ? /^Beard \d+$/ : /^Style \d+$/).test(c.label))), `${sp.id}: every cell reads "Style N", a beard "Beard N"`);
    ok(g.groups.every((x) => x.cells.every((c) => c.id === NO_HAIR || c.picture === 'icon')), `${sp.id}: every style has its picture`);
    const seen = g.groups.flatMap((x) => x.cells.map((c) => c.id)).filter((x) => x !== NO_HAIR);
    ok(new Set(seen).size === seen.length, `${sp.id}: no style is offered twice`);
  }
  note(`grids: ${counts.join('; ')}`);
  ok(checked >= 18, `every species with a wardrobe was laid out (${checked})`);
  {
    // The day one over every species converted here: each grid is the base's less only the other gender's styles
    // whose meshes an earlier cell already shows, and nothing new. Measured on the owner's packs converted with SOE's
    // final files, that is each Wookiee gender's twelve and a Sullustan man's nineteen (the other gender's on the very
    // same meshes), nineteen of the thirty-nine men's styles a Sullustan woman was offered, four each way between the
    // Bothans (the other gender's styles on meshes their own rows already wear), and one of the Zabrak woman's (the
    // men's 25, on the mesh of the men's 21).
    const oldGrid = await atBase<{ hairCells: typeof hairCells }>('src/ui/hairGrid.ts');
    if (!oldGrid) note("git could not hand the pass's base over: the packs' grids are not held to it here");
    else {
      const wrong: string[] = [];
      const dropped: string[] = [];
      for (const sp of index.species) {
        if (!sp.wardrobe || !existsSync(`${ROOT}wardrobe/${sp.wardrobe}/wardrobe.json`)) continue;
        const items = wardrobe(sp.wardrobe).items;
        const gender = sp.gender === 'female' ? 'female' : 'male';
        const r = againstBase(flatGrid(oldGrid.hairCells(table, items, sp.species, gender, null), items), flatGrid(hairCells(table, items, sp.species, gender, null), items));
        if (!r.ok) wrong.push(`${sp.id}: ${r.why}`);
        if (r.dropped.length) dropped.push(`${sp.id} ${r.dropped.length}`);
      }
      ok(!wrong.length, `every species' grid is the base's less only the other gender's styles an earlier cell shows the mesh of, and nothing new (${wrong.length ? wrong.join('; ') : `dropped: ${dropped.join(', ') || 'none'}`})`);
    }
  }
  // SOE's final names list (the table's own `late` stamp says it was in the mount) brings SOE's final creator table,
  // measured on SOE complete's pilot conversion: one of the Trandoshan female's four untabled styles is a row of it,
  // the Bothan male has a second style no row names, the Sullustans have rows of their own (19 a woman's, 39 a man's
  // with his twelve beards), the Wookiees twelve styles each, and the human wardrobe five styles no row names. Each
  // Wookiee and Sullustan gender's rows wear the other's very meshes, so neither has an other gender's group.
  const lateState = (table as { late?: { state?: string } }).late?.state;
  const late = lateState === 'applied' || lateState === 'final';
  {
    const g = gridOf('human_female')!;
    // With SOE's final names list the human wardrobe also carries five styles no row of the table names, which come
    // after the men's in a group of their own; before it, there is no such group.
    const shape = g.groups.map((x) => x.id).join();
    ok(shape === (late ? 'own,other,untabled' : 'own,other') && g.groups[0].cells[0].id === NO_HAIR, `a human female: her styles with no hair leading, then the men's${late ? ', then the five no row names' : ''} (${g.groups.map((x) => `${x.id} ${x.cells.length}`).join(', ')})`);
    if (late) ok(g.groups[2].cells.length === 5, `and those are five (${g.groups[2]?.cells.length})`);
    ok(!g.groups[0].cells.some((c) => c.id === 'hair_human_female_s33'), 'the style the archives lack is not offered');
    ok(g.groups[1].cells.length === table.species.human_male.hair!.filter((h) => h.inArchives).length, "and every one of the men's");
  }
  for (const id of ['twilek_female', 'twilek_male', 'zabrak_female', 'zabrak_male', 'trandoshan_female', 'trandoshan_male']) {
    const g = gridOf(id)!;
    ok(g.none && g.groups[0].cells[0].id === NO_HAIR, `${id}, which the game kept from going bald, is offered no hair (the owner's call)`);
    const first = defaultHair(table, wardrobe(index.species.find((s) => s.id === id)!.wardrobe!).items, id.replace(/_(fe)?male$/, ''), id.endsWith('_female') ? 'female' : 'male');
    ok(!!first && first === table.species[id].hair!.find((h) => h.creation && h.inArchives)!.id, `and a new one starts in the table's first creation style (${first})`);
  }
  ok(defaultHair(table, wardrobe('human_male').items, 'human', 'male') === null, 'a new human starts in none');
  ok(gridOf('trandoshan_female')!.groups.find((x) => x.id === 'untabled')?.cells.length === (late ? 3 : 4), `the Trandoshan female's ${late ? 'three' : 'four'} styles no row names stand apart`);
  ok(ids(gridOf('bothan_male')!.groups.find((x) => x.id === 'untabled')?.cells ?? []) === (late ? 'hair_bothan_male_s12,hair_bothan_male_s26' : 'hair_bothan_male_s12'), `and the Bothan male's ${late ? 'two' : 'one'}`);
  for (const [id, end, count] of [['sullustan_female', '_f', 19], ['sullustan_male', '_m', 39]] as const) {
    const g = gridOf(id)!;
    const styles = g.groups.flatMap((x) => x.cells).filter((c) => c.id !== NO_HAIR);
    if (late) {
      const own = (g.groups.find((x) => x.id === 'own')?.cells ?? []).filter((c) => c.id !== NO_HAIR);
      // A man's rows wear every one of a woman's meshes, so his grid has no women's group; hers keeps the men's styles
      // her nineteen do not show (his beards and his styles 20 to 27).
      const other = g.groups.find((x) => x.id === 'other')?.cells ?? [];
      const shape = end === '_m' ? 'own' : 'own,other';
      ok(g.groups.map((x) => x.id).join() === shape && own.length === count && own.every((c) => c.id.endsWith(end)) && other.every((c) => c.id.endsWith('_m')), `${id}: the table's own ${count} styles, all ${end}, ${end === '_m' ? "and no women's group, every one of theirs wearing one of his meshes" : "then the men's her own meshes do not show"} (${g.groups.map((x) => `${x.id} ${x.cells.length}`).join(', ')})`);
      ok(own.filter((c) => /beard/.test(c.id)).every((c) => /^Beard \d+$/.test(c.label)) && new Set(own.map((c) => c.label)).size === own.length, `${id}: no two of them read alike, the beards reading as beards`);
    } else ok(g.groups.map((x) => x.id).join() === 'untabled' && styles.length === 18 && styles.every((c) => c.id.endsWith(end)), `${id}: eighteen styles, all ${end}, under "Not in the game's creator"`);
  }
  for (const id of ['ithorian_female', 'moncal_male', ...(late ? [] : ['wookiee_female'])]) ok((gridOf(id)?.groups.length ?? 0) === 0, `${id} has no styles, so no grid`);
  if (late) {
    ok(gridOf('wookiee_female')!.groups.find((x) => x.id === 'own')?.cells.filter((c) => c.id !== NO_HAIR).length === 12, 'a Wookiee woman has her twelve styles from the table');
    for (const id of ['wookiee_male', 'wookiee_female']) {
      const g = gridOf(id)!;
      ok(g.groups.map((x) => x.id).join() === 'own', `${id}: their own group alone, the other gender's twelve wearing the same meshes (${g.groups.map((x) => `${x.id} ${x.cells.length}`).join(', ')})`);
    }
  }

  // The colour carried, through the game's own customizer: a human male's first style coloured, his
  // fourth loaded beside it, and the keys the grid's carry writes are the ones the fourth's recipe reads.
  const humanDir = `${ROOT}wardrobe/human_male/`;
  if (existsSync(`${humanDir}customize.json`)) {
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      const p = url.replace(/^pack:\/\//, ROOT);
      if (!existsSync(p)) return new Response('', { status: 404 });
      return new Response(readFileSync(p), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
    };
    const file = JSON.parse(readFileSync(`${humanDir}customize.json`, 'utf8')) as { recipes: { mesh: string; material: string }[] };
    const items = wardrobe('human_male').items;
    const meshOf = (id: string) => items.find((i) => i.id === id)!.parts![0].name!;
    const [a, b] = [meshOf('hair_human_male_s01'), meshOf('hair_human_male_s04')];
    const mats = new Set(file.recipes.filter((r) => r.mesh === a || r.mesh === b).map((r) => r.material));
    const cz = new Customizer();
    await cz.addSource('pack://wardrobe/human_male/');
    cz.materialsFor = (name) => (mats.has(name) ? [{} as never] : []);
    cz.invalidate();
    const oldKey = cz.variables().find((x) => x.private && x.mesh === a && x.kind === 'palette')?.key;
    const newDefs = cz.variables().filter((x) => x.private && x.mesh === b && x.kind === 'palette');
    ok(!!oldKey && newDefs.length > 0, `both styles' own colours are live (${oldKey}; ${newDefs.map((d) => d.key).join(', ')})`);
    const carried = carryHairColour({ [oldKey!]: 9 }, newDefs, {});
    ok(newDefs.every((d) => carried[d.key] === 9) && newDefs.every((d) => cz.affects(d.key)), 'the fourth takes the first\'s colour under keys its own recipe reads');
    const remembered = carryHairColour({ [oldKey!]: 9 }, newDefs, { 'hair|index_color_1': 12 });
    ok(newDefs.every((d) => remembered[d.key] === 12), 'and the remembered colour over it');
    // The same through what the game really gathers (`hairCarryFor`): the customizer's own values and live
    // variables, and the parts as `Character.status` names them, the fourth's mesh under a suffixed name.
    const parts = [
      { name: 'hair_human_male_s01', meshNames: [a] },
      { name: 'hair_human_male_s04', meshNames: [`${b}_1`] },
    ];
    cz.values.set(oldKey!, 9);
    const gathered = hairCarryFor(parts, ['hair_human_male_s01'], 'hair_human_male_s04', cz.values, cz.variables());
    ok(newDefs.length > 0 && newDefs.every((d) => gathered[d.key] === 9) && Object.keys(gathered).length === newDefs.length, `gathered from the live customizer, the fourth takes the first's colour on its own keys (${JSON.stringify(gathered)})`);
    cz.values.set('hair|index_color_1', 12);
    const gatheredRemembered = hairCarryFor(parts, ['hair_human_male_s01'], 'hair_human_male_s04', cz.values, cz.variables());
    ok(newDefs.every((d) => gatheredRemembered[d.key] === 12), 'and the remembered colour the page writes over it');
    const twk = wardrobe('human_female').items.find((i) => i.id === 'hair_twilek_female_s01');
    ok(!!twk && (twk.variables ?? []).every((x) => !x.private), "a Twi'lek's lekku have no colour of their own to carry: they follow her skin");
  } else note('no human male wardrobe recipes: the carry through the customizer was not checked');
}

console.log(`\n${passed} checks passed`);
