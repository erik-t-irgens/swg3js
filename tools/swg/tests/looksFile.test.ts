// Map-maker II's thirteenth wave: the owner's own looks file (`public/placements/looks/all.json`,
// `src/world/editFiles/looksFile.ts`) and its kind in the batch (`placementEdits.ts`). The reader and the cleaner (an id, a
// dressed body to take numbers from, a species pack, a piece a mesh, a colour clamped as the customizer takes it, a shape
// slider as `setMorph` holds it, a piece the species' appearance table blocks refused in words where the wardrobe's word is
// given), the writer (one line a row, sorted, read back to the same rows), the content hash a look is cached and pictured
// under (its body and dress, never its words), `LOOKS_LIMITS`, the batch writing and refusing it as every edit file, and any
// committed looks file holding catalogue, wardrobe and palette ids only.
//
// Run: node tools/swg/tests/looksFile.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOOK_COLOUR_MIN, LOOKS_FILE_VERSION, LOOKS_LIMITS, OWN_LOOK_PREFIX, isLookId, lookHash, lookIdOfBody, lookMorph, lookValue, lookWithExtras, looksFileText, mintLookId, ownBodyOf, readLookRow, readLooksFile, sameLookRow, type OwnLookRow } from '../../../src/world/editFiles/looksFile.ts';
import { RAW_COLOUR_MIN } from '../../../src/player/texrender.ts';
import { applyPlacementOp, EDIT_KINDS, type PlacementCtx } from '../../../src/world/placementEdits.ts';
import { editFilePath } from '../../../src/story/placementPath.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const row = (o: Partial<OwnLookRow> & Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'farmhand-red',
  from: 'dressed_fs_village_farmer',
  species: 'human_male',
  morphs: { blend_muscle: 0.4 },
  custom: { index_color_skin: 6 },
  outfit: [{ part: 'jacket_s11_m_l0', item: 'jacket_s11', wardrobe: 'wardrobe/human_male', values: { index_color_1: 114 } }],
  name: 'Farmhand in red',
  at: 1_793_000_000_000,
  ...o,
});

// ---- the numbers, the ids, the bodies ----
{
  ok(LOOK_COLOUR_MIN === RAW_COLOUR_MIN, `a colour's least is a colour carried whole's least, as the customizer decodes it (${LOOK_COLOUR_MIN})`);
  ok(JSON.stringify(LOOKS_LIMITS) === JSON.stringify({ rows: 1024, outfit: 64, values: 64, custom: 128, morphs: 256, name: 80, note: 400, value: 65535 }), 'the reader\'s backstops are pinned (a build holding a file to others would cut it its own way)');
  ok(LOOKS_FILE_VERSION === 1 && OWN_LOOK_PREFIX === 'own:', 'the file is version 1 and a look is worn as own:<id>');
  ok(lookValue(3.6) === 4 && lookValue(70_000) === 65535 && lookValue(-2e7) === LOOK_COLOUR_MIN && lookValue(-123) === -123, 'a colour is a whole number from a colour carried whole\'s least to past every palette');
  ok(lookMorph(1.4) === 1 && lookMorph(-0.2) === 0 && lookMorph(0.25) === 0.25, 'a shape slider is held to nought..one, as setMorph holds it');
  ok(isLookId('a') && isLookId('farmhand-red_2') && !isLookId('-x') && !isLookId('Farmhand') && !isLookId('a'.repeat(65)) && !isLookId('a b'), 'an id is a-z, 0-9, _ and -, 64 at most, starting with a letter or a digit');
  ok(ownBodyOf('x') === 'own:x' && lookIdOfBody('own:x') === 'x' && lookIdOfBody('dressed_x') === null && lookIdOfBody('own:Bad Id') === null, 'a body names a look, or none');
  const taken = new Set(['farmhand-in-red-1']);
  ok(mintLookId('Farmhand in red', taken) === 'farmhand-in-red-2' && mintLookId('', new Set()) === 'look-1' && mintLookId('__', new Set()) === 'look-1' && /^[a-z0-9]/.test(mintLookId('-x', new Set())), 'a fresh id is made from the name, numbered past the ones taken');
}

// ---- the reader and the cleaner ----
{
  const r = readLookRow(row()) as OwnLookRow;
  ok(typeof r === 'object' && r.id === 'farmhand-red' && r.outfit[0].values.index_color_1 === 114 && r.name === 'Farmhand in red' && r.at === 1_793_000_000_000, 'a row reads as it is written');
  const clamped = readLookRow(row({ morphs: { a: 1.6, b: -1 }, custom: { c: 1e9, d: -1e9, e: 2.4 }, outfit: [{ part: 'p_m_l0', item: 'p', wardrobe: 'mobiles/wearables/ewok', values: { v: 3.5 } }] })) as OwnLookRow;
  ok(clamped.morphs.a === 1 && clamped.morphs.b === 0 && clamped.custom.c === 65535 && clamped.custom.d === LOOK_COLOUR_MIN && clamped.custom.e === 2 && clamped.outfit[0].values.v === 4, 'every colour clamped as the customizer takes it and every slider as setMorph holds it');
  const refuse: [string, Record<string, unknown>, RegExp][] = [
    ['no id', row({ id: 'Bad Id' }), /its id/],
    ['a from that is a look of ours', row({ from: 'own:other' }), /never a look of ours/],
    ['no species', row({ species: 'Human Male' }), /species pack/],
    ["a variable named for the language's own", row({ custom: JSON.parse('{"__proto__": 1}') }), /no variable's name/],
    ['a colour that is not a number', row({ custom: { a: 'red' } }), /not a number/],
    ['an outfit that is no list', row({ outfit: {} }), /list of pieces/],
    ['a piece with no part', row({ outfit: [{ item: 'x', wardrobe: 'wardrobe/human_male', values: {} }] }), /names no part/],
    ['a piece out of no wardrobe folder', row({ outfit: [{ part: 'x', item: 'x', wardrobe: '../etc', values: {} }] }), /no wardrobe folder/],
    ['a piece out of a species pack folder', row({ outfit: [{ part: 'x', item: 'x', wardrobe: 'characters/human_male', values: {} }] }), /no wardrobe folder/],
    ['too many pieces', row({ outfit: Array.from({ length: LOOKS_LIMITS.outfit + 1 }, (_, i) => ({ part: `p${i}`, item: 'x', wardrobe: 'wardrobe/human_male', values: {} })) }), /64 pieces at most/],
    ['too many colours', row({ custom: Object.fromEntries(Array.from({ length: LOOKS_LIMITS.custom + 1 }, (_, i) => [`c${i}`, 1])) }), /128 at most/],
    ['a name of control characters', row({ name: 'a\u0007b' }), /its name/],
    ['a name too long', row({ name: 'x'.repeat(LOOKS_LIMITS.name + 1) }), /its name/],
    ['a note too long', row({ note: 'x'.repeat(LOOKS_LIMITS.note + 1) }), /its note/],
    ['a negative time', row({ at: -1 }), /its at/],
  ];
  for (const [what, v, re] of refuse) {
    const got = readLookRow(v);
    ok(typeof got === 'string' && re.test(got), `${what} is refused in words (“${got}”)`);
  }
  // The species' own rule where the cleaner is told it.
  const rules = (word: 'ok' | 'block' | 'hide' | null) => ({ fitOf: () => word });
  const blocked = readLookRow(row({ species: 'wookiee_male' }), [], rules('block'));
  ok(typeof blocked === 'string' && /jacket_s11 is a piece wookiee male cannot wear \(the appearance table blocks it\)/.test(blocked), `a piece the appearance table blocks for the species is refused in words (“${blocked}”)`);
  ok(typeof readLookRow(row(), [], rules('hide')) !== 'string' && typeof readLookRow(row(), [], rules(null)) !== 'string' && typeof readLookRow(row(), [], rules('ok')) !== 'string', 'one it hides, one it allows and one it cannot find are taken');
  const unknown: string[] = [];
  readLookRow(row({ height: 0.6, outfit: [{ part: 'p', item: 'p', wardrobe: 'wardrobe/human_male', values: {}, tint: 1 }] }), unknown);
  ok(unknown.join(',') === 'farmhand-red.height,farmhand-red.outfit.0.tint', `a field this build does not read is named, never kept (${unknown.join(', ')})`);
}

// ---- the file: read, written, read back ----
{
  const a = readLookRow(row({ id: 'b-look', name: undefined, at: undefined })) as OwnLookRow;
  const b = readLookRow(row({ id: 'a-look', note: 'for the farm' })) as OwnLookRow;
  const text = looksFileText([a, b]);
  ok(text.startsWith('{\n  "version": 1,\n  "rows": [\n    { "id": "a-look", ') && text.split('\n').filter((l) => l.startsWith('    { ')).length === 2 && text.endsWith('\n  ]\n}\n'), 'the writer writes one line a row, sorted by id, the fields in one order');
  const back = readLooksFile(text);
  ok(!back.problem && back.rows.length === 2 && sameLookRow(back.rows[0], b) && sameLookRow(back.rows[1], a), 'and reads back to the same rows');
  ok(looksFileText([]) === '{\n  "version": 1,\n  "rows": []\n}\n', 'a file of no rows is the empty list');
  ok(readLooksFile('{ // a note\n "version": 1, "rows": [] }').problem === null, 'comments are read past (JSONC, as every placements file)');
  ok(/its version is not 1/.test(readLooksFile('{"version": 2, "rows": []}').problem ?? '') && /does not read/.test(readLooksFile('{').problem ?? '') && /no rows list/.test(readLooksFile('{"version": 1}').problem ?? ''), 'a file of another version, one that does not read and one with no rows are no looks, and say why');
  const twice = readLooksFile(looksFileText([a, a]));
  ok(twice.rows.length === 1 && twice.skipped.length === 1 && /second row/.test(twice.skipped[0].why), 'a second row under one id is skipped and named');
  const many = readLooksFile(looksFileText(Array.from({ length: LOOKS_LIMITS.rows + 2 }, (_, i) => ({ ...a, id: `l${String(i).padStart(5, '0')}` }))));
  ok(many.rows.length === LOOKS_LIMITS.rows && many.skipped.length === 2 && /past the 1024 rows/.test(many.skipped[0].why), 'a row past the backstop is skipped and named');
  const kept = lookWithExtras(a, { id: 'b-look', height: 0.6, species: 'x' });
  ok(kept.height === 0.6 && kept.species === 'human_male', 'a row written keeps what the row it replaces held that this build does not read, and nothing else of it');
}

// ---- the content hash ----
{
  const a = readLookRow(row()) as OwnLookRow;
  const h = lookHash(a);
  ok(/^[0-9a-f]{8}$/.test(h), `a look's hash is eight hex (${h})`);
  ok(lookHash({ ...a }) === h && lookHash(readLookRow(row({ name: 'Other', note: 'n', at: 5 })) as OwnLookRow) === h, 'its words and its time never move it');
  const two = { ...a, custom: { index_color_skin: 6, index_color_hair: 2 } };
  ok(lookHash({ ...a, morphs: { blend_muscle: 0.4 }, custom: { index_color_skin: 6 } }) === h && lookHash(two) === lookHash({ ...a, custom: { index_color_hair: 2, index_color_skin: 6 } }) && lookHash({ ...a, custom: { ...a.custom, z: 1 } }) !== h, 'the order a record was written in does not move it; a colour added does');
  ok(lookHash({ ...a, outfit: [{ ...a.outfit[0], values: { index_color_1: 115 } }] }) !== h && lookHash({ ...a, species: 'human_female' }) !== h && lookHash({ ...a, from: 'dressed_other' }) !== h, 'a piece\'s colour, the species and the body it takes numbers from each move it');
}

// ---- the batch ----
{
  const kind = EDIT_KINDS.looks;
  ok(!!kind && kind.group === null && kind.groundOnly === false && kind.most === LOOKS_LIMITS.rows, 'the looks are an edit file of their own, never the ground\'s alone, held to the same backstop');
  ok(editFilePath('looks', 'tatooine') === 'placements/looks/all.json' && editFilePath('looks', 'space_corellia') === 'placements/looks/all.json', 'one file every world shares (looks/all.json)');
  const worlds = new Map([['tatooine', 'ground'], ['space_tatooine', 'space'], ['dungeon1', 'copies']] as const);
  const ctx = (now = 1): PlacementCtx => ({ worlds, now, hash: (t: string) => String(t.length) });
  const look = row();
  const put = applyPlacementOp({ op: 'batch', world: 'tatooine', edits: [{ file: 'looks', put: look }] }, { story: null, world: null }, ctx(7));
  const text = put.writes[0]?.text ?? '';
  ok(put.status === 200 && put.writes.length === 1 && put.writes[0].layer === 'looks', 'a look is put into the looks file in one write');
  const read = readLooksFile(text);
  ok(read.rows.length === 1 && read.rows[0].id === 'farmhand-red' && read.rows[0].at === 7 && text === looksFileText(read.rows), "the file written is the writer's own text, the row stamped with the batch's moment");
  const copies = applyPlacementOp({ op: 'batch', world: 'dungeon1', edits: [{ file: 'looks', put: look }] }, { story: null, world: null }, ctx());
  const space = applyPlacementOp({ op: 'batch', world: 'space_tatooine', edits: [{ file: 'looks', put: look }] }, { story: null, world: null }, ctx());
  ok(copies.status === 200 && space.status === 200, 'and from the world of copies and a space zone alike (a look is every world\'s)');
  const bad = applyPlacementOp({ op: 'batch', world: 'tatooine', edits: [{ file: 'looks', put: row({ species: 'Nope' }) }] }, { story: null, world: null }, ctx());
  ok(bad.status === 400 && !bad.writes.length, 'a row the reader refuses is refused whole, nothing written');
  const changed = applyPlacementOp({ op: 'batch', world: 'tatooine', edits: [{ file: 'looks', put: row({ name: 'Renamed' }), was: { ...look, at: 99 } }] }, { story: null, world: null, looks: text }, ctx());
  ok(changed.status === 409 && !changed.writes.length, 'a write whose was differs from the file is refused by its id (an undo never writes over a look changed since)');
  const gone = applyPlacementOp({ op: 'batch', world: 'tatooine', edits: [{ file: 'looks', delete: 'farmhand-red' }] }, { story: null, world: null, looks: text }, ctx());
  ok(gone.status === 200 && gone.writes[0].text === null, 'the file goes with its last look');
}

// ---- a committed looks file: catalogue, wardrobe and palette ids only ----
{
  const file = join(REPO, 'public', editFilePath('looks', 'all'));
  if (!existsSync(file)) note('no looks file committed here: nothing more to read');
  else {
    const text = readFileSync(file, 'utf8');
    const read = readLooksFile(text);
    ok(!read.problem && !read.skipped.length && !read.unknown.length, `the committed looks file reads whole (${read.rows.length} looks)`);
    // Every string in it is one of a row's own fields' ids or its words: nothing of the game's carried.
    const raw = JSON.parse(text.replace(/\/\/[^\n]*/g, '')) as { rows: Record<string, unknown>[] };
    const strays: string[] = [];
    for (const r of raw.rows) {
      for (const [k, v] of Object.entries(r)) {
        if (['id', 'from', 'species', 'name', 'note'].includes(k) && typeof v === 'string') continue;
        if (k === 'at' && typeof v === 'number') continue;
        if ((k === 'morphs' || k === 'custom') && v && typeof v === 'object' && Object.values(v).every((x) => typeof x === 'number')) continue;
        if (k === 'outfit' && Array.isArray(v) && v.every((p) => p && Object.keys(p).every((pk) => ['part', 'item', 'wardrobe', 'values'].includes(pk)) && Object.values((p as { values: Record<string, unknown> }).values ?? {}).every((x) => typeof x === 'number'))) continue;
        strays.push(`${String(r.id)}.${k}`);
      }
    }
    ok(strays.length === 0, `it names catalogue, wardrobe and palette ids and the owner's own words only${strays.length ? `: ${strays.join(', ')}` : ''}`);
    const cat = join(REPO, 'assets-private', 'mobiles', 'catalogue.json');
    if (existsSync(cat)) {
      const ids = new Set((JSON.parse(readFileSync(cat, 'utf8')) as { entries: { id: string }[] }).entries.map((e) => e.id));
      const missing = read.rows.filter((r) => !ids.has(r.from)).map((r) => r.id);
      ok(missing.length === 0, `every look's from is a catalogue entry this install holds${missing.length ? `: not ${missing.join(', ')}` : ''}`);
    }
  }
}

console.log(`\nlooksFile: ${checks} checks passed`);
