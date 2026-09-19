// What an item is, for the backpack: names, descriptions, arrangements and the species table, read from synthetic files
// laid out as the client's are (tools/swg/items.mjs).
import assert from 'node:assert/strict';
import { W, chunk, encode, form, type Node } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import * as I from '../items.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const buf = (n: Node) => Buffer.from(encode(n));
const cstr = (...names: string[]) => {
  const w = new W();
  for (const n of names) w.str(n);
  return w.bytes();
};
// A template parameter chunk: the name, then the value's bytes.
const param = (name: string, value: number[]) => chunk('XXXX', new Uint8Array([...cstr(name), ...value]));
const bytesOf = (s: string) => [...s].map((c) => c.charCodeAt(0));
// A string id value: SINGLE, then a presence byte and the table, a presence byte and the key.
const stringIdValue = (table: string, key: string) => [1, 1, ...bytesOf(table), 0, 1, ...bytesOf(key), 0];
const stringValue = (s: string) => [1, ...bytesOf(s), 0];
const template = (type: string, base: string | null, shared: Node[], own: Node[] = []): Node =>
  form(type, ...(base ? [form('DERV', chunk('XXXX', cstr(base)))] : []), form('0000', chunk('PCNT', new W().i32(own.length).bytes()), ...own), form('SHOT', form('0010', chunk('PCNT', new W().i32(shared.length).bytes()), ...shared)));

// A string table as datatable.mjs reads it: magic, version, next id, count, the texts (UTF-16), then the names.
function stringTable(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const u32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    return b;
  };
  const names = Object.keys(entries);
  parts.push(u32(0xabcd), Buffer.from([1]), u32(names.length + 1), u32(names.length));
  names.forEach((n, i) => {
    const text = entries[n];
    parts.push(u32(i + 1), u32(0), u32(text.length), Buffer.from(text, 'utf16le'));
  });
  names.forEach((n, i) => parts.push(u32(i + 1), u32(n.length), Buffer.from(n, 'latin1')));
  return Buffer.concat(parts);
}

// A datatable (DTII > 0001 > COLS, TYPE, ROWS) of string columns.
function datatable(columns: string[], rows: string[][]): Buffer {
  const rowBytes = new W().i32(rows.length);
  for (const r of rows) for (const c of r) rowBytes.str(c);
  const cols = new W().i32(columns.length);
  for (const c of columns) cols.str(c);
  return buf(form('DTII', form('0001', chunk('COLS', cols.bytes()), chunk('TYPE', cstr(...columns.map(() => 's'))), chunk('ROWS', rowBytes.bytes()))));
}

const files = new Map<string, Buffer>();
const vfs = { has: (p: string) => files.has(p), read: (p: string) => files.get(p)! };

// 1. The arrangement: two alternatives, one alternative of several slots, a slot named twice.
const ringEither = buf(form('ARGD', form('0000', chunk('ARG ', cstr('ring_l')), chunk('ARG ', cstr('ring_r')))));
ok(JSON.stringify(I.parseArrangement(parseIff(ringEither))) === '[["ring_l"],["ring_r"]]', 'an either arrangement reads as two alternatives of one slot each');
const jacket = buf(form('ARGD', form('0000', chunk('ARG ', cstr('chest2', 'bicep_l', 'bicep_r', 'bracer_upper_l')))));
ok(JSON.stringify(I.parseArrangement(parseIff(jacket))) === '[["chest2","bicep_l","bicep_r","bracer_upper_l"]]', 'a jacket takes its slots together, in the file\'s order');
const costume = buf(form('ARGD', form('0000', chunk('ARG ', cstr('chest1', 'gloves', 'hat', 'gloves')))));
ok(JSON.stringify(I.parseArrangement(parseIff(costume))) === '[["chest1","gloves","hat"]]', 'a slot named twice in one alternative appears once');

// 2. The player's slots.
const slotDescriptor = buf(form('SLTD', form('0000', chunk('DATA', cstr('inventory', 'hat', 'chest1', 'hold_r')))));
ok(JSON.stringify(I.parseSlotDescriptor(parseIff(slotDescriptor))) === '["inventory","hat","chest1","hold_r"]', 'the slot descriptor reads its names');

// 3. Names and descriptions along the chain.
files.set('string/en/wearables_name.stf', stringTable({ shirt_x: 'Plain Shirt', shirt_y: 'Fallback Shirt', pauldron: 'Armor Right Pauldron\n', colours: '\\#ff0000Red\\#. Shirt' }));
files.set('string/en/wearables_detail.stf', stringTable({ shirt_x: 'A shirt.\n\nWear it.', shirt_crlf: 'Line one\r\nLine two' }));
files.set('abstract/slot/arrangement/wearables/shirt.iff', buf(form('ARGD', form('0000', chunk('ARG ', cstr('chest1'))))));
files.set('object/tangible/wearables/base/shared_base_shirt.iff', buf(template('STOT', 'object/tangible/wearables/base/shared_wearables_base.iff', [
  param('objectName', stringIdValue('wearables_name', '')),
  param('detailedDescription', stringIdValue('wearables_detail', '')),
  param('arrangementDescriptorFilename', stringValue('abstract/slot/arrangement/wearables/shirt.iff')),
])));
files.set('object/tangible/wearables/base/shared_wearables_base.iff', buf(template('STOT', null, [param('slotDescriptorFilename', stringValue('abstract/slot/descriptor/tangible.iff'))])));
files.set('object/tangible/wearables/shirt/shared_shirt_x.iff', buf(template('STOT', 'object/tangible/wearables/base/shared_base_shirt.iff', [
  param('objectName', stringIdValue('wearables_name', 'shirt_x')),
  param('detailedDescription', stringIdValue('wearables_detail', 'shirt_x')),
])));
files.set('object/tangible/wearables/shirt/shared_shirt_y.iff', buf(template('STOT', 'object/tangible/wearables/base/shared_base_shirt.iff', [])));
files.set('object/tangible/wearables/shirt/shared_shirt_z.iff', buf(template('STOT', 'object/tangible/wearables/base/shared_base_shirt.iff', [param('objectName', stringIdValue('static_item_n', 'shirt_z'))])));
files.set('object/tangible/wearables/shirt/shared_pauldron.iff', buf(template('STOT', 'object/tangible/wearables/base/shared_base_shirt.iff', [param('objectName', stringIdValue('wearables_name', 'pauldron'))])));
files.set('object/tangible/wearables/shirt/shared_colours.iff', buf(template('STOT', 'object/tangible/wearables/base/shared_base_shirt.iff', [
  param('objectName', stringIdValue('wearables_name', 'colours')),
  param('detailedDescription', stringIdValue('wearables_detail', 'shirt_crlf')),
])));
files.set('object/tangible/wearables/shirt/shared_bare.iff', buf(template('STOT', 'object/tangible/wearables/base/shared_wearables_base.iff', [])));

const caches = I.newItemCaches();
const x = I.itemText(vfs, 'object/tangible/wearables/shirt/shared_shirt_x.iff', 'shirt_x', caches);
ok(x.name === 'Plain Shirt', 'a leaf whose SHOT section sets objectName reads the table\'s text');
ok(x.description === 'A shirt.\n\nWear it.', 'a description keeps its paragraph break');
const y = I.itemText(vfs, 'object/tangible/wearables/shirt/shared_shirt_y.iff', 'shirt_y', caches);
ok(y.name === 'Fallback Shirt', 'a leaf that sets nothing inherits the base\'s table with an empty key and falls back to table:<id>');
ok(y.description === null, 'a description set nowhere is null');
const z = I.itemText(vfs, 'object/tangible/wearables/shirt/shared_shirt_z.iff', 'shirt_z', caches);
ok(z.name === null, 'a key in a table the client never had gives no name');
ok(I.itemText(vfs, 'object/tangible/wearables/shirt/shared_pauldron.iff', 'pauldron', caches).name === 'Armor Right Pauldron', 'a name with a trailing newline comes back trimmed');
const colours = I.itemText(vfs, 'object/tangible/wearables/shirt/shared_colours.iff', 'colours', caches);
ok(colours.name === 'Red Shirt' && colours.description === 'Line one\nLine two', 'colour codes are stripped and CRLF becomes LF');
ok(I.cleanText('   ') === null && I.cleanText(null) === null && I.cleanText(' a ') === 'a', 'cleanText: blank is null, the rest trimmed');

// 4. Slots follow DERV to the base's arrangement; a chain with none is null.
ok(JSON.stringify(I.itemSlots(vfs, 'object/tangible/wearables/shirt/shared_shirt_x.iff', caches)) === '[["chest1"]]', 'the arrangement is found on the base template and parsed');
ok(I.itemSlots(vfs, 'object/tangible/wearables/shirt/shared_bare.iff', caches) === null, 'a chain naming no arrangement has null slots');
ok(caches.arrangements.size === 1, 'each arrangement file is parsed once and cached');
const d = I.describeItem(vfs, 'object/tangible/wearables/shirt/shared_shirt_x.iff', 'shirt_x', caches);
ok(d.name === 'Plain Shirt' && d.description === 'A shirt.\n\nWear it.' && JSON.stringify(d.slots) === '[["chest1"]]', 'describeItem is the three together');
ok(I.setStringId(Buffer.from(stringIdValue('wearables_name', ''))) === null && I.setStringId(Buffer.from(stringIdValue('t', 'k')))?.key === 'k', 'a string id with an empty key is not set');

// 5. The table's columns and the species ids.
ok(I.columnSpecies("Female Twi'lek") === 'twilek_female', "Female Twi'lek is twilek_female");
ok(I.columnSpecies('Male MonCal') === 'moncal_male', 'Male MonCal is moncal_male');
ok(I.columnSpecies('Object Template Name') === null, 'the key column names no species');
const columns = ['Object Template Name', 'Male Human', 'Female Human', "Male Twi'lek", "Female Twi'lek", 'Male MonCal', 'Male Wookiee', 'Female Wookiee', 'Male Ithorian', 'Female Ithorian'];
ok(I.speciesColumn(columns, 'twilek_female') === "Female Twi'lek" && I.speciesColumn(columns, 'moncal_male') === 'Male MonCal' && I.speciesColumn(columns, 'bothan_male') === null, 'speciesColumn inverts columnSpecies over the table\'s columns');

// 6. One cell for the folder converting it.
const present = new Set(['appearance/bracelet_m_s02_l.sat', 'appearance/hat_s04_rod_m.sat', 'appearance/shirt_s03_m.sat', 'appearance/ith_robe_m.sat']);
const has = (p: string) => present.has(p);
const own = 'appearance/shirt_s03_m.sat';
let a = I.appearanceFor('appearance/ith_robe_m.sat', own, has);
ok(a.verdict === 'own' && a.sat === 'appearance/ith_robe_m.sat' && a.took, 'a present path wins and counts as taken');
a = I.appearanceFor('appearance\\shirt_s03_m.sat', own, has);
ok(a.verdict === 'own' && a.sat === own && !a.took, 'the template\'s own path is not counted as taken');
a = I.appearanceFor('appearance/missing_m.sat', own, has);
ok(a.verdict === 'default' && a.sat === own && a.missing === true && !a.took, 'a path the archives lack is default, marked missing');
a = I.appearanceFor('appearance/hat_s04_rod_m.satx', own, has);
ok(a.verdict === 'default' && a.missing === true && a.sat === own, 'a .satx typo is default, marked missing');
ok(I.appearanceFor(':block', own, has).verdict === 'block' && I.appearanceFor(':block', own, has).sat === own, ':block keeps the own appearance');
ok(I.appearanceFor(':hide', own, has).verdict === 'hide' && I.appearanceFor(':default', own, has).verdict === 'default', ':hide and :default read as themselves');
a = I.appearanceFor(undefined, own, has);
ok(a.verdict === 'default' && a.sat === own && !a.took && !a.missing, 'no row keeps the own appearance');
a = I.appearanceFor('appearance/bracelet_m_s02_l.sat', 'appearance/bracelet_f_s02_l.sat', has);
ok(a.verdict === 'own' && a.sat === 'appearance/bracelet_m_s02_l.sat' && a.took, 'the men\'s bracelet: the table\'s cell replaces the template\'s women\'s mesh');

// 7. The verdict for one gender's columns.
const row: Record<string, string> = {
  'Object Template Name': 'shared_shirt_s03',
  'Male Human': ':default', 'Female Human': ':block',
  "Male Twi'lek": 'appearance/shirt_s03_m.sat', "Female Twi'lek": 'appearance/hat_s04_rod_m.sat',
  'Male MonCal': 'appearance/missing_m.sat', 'Male Wookiee': ':block', 'Female Wookiee': ':hide',
  'Male Ithorian': 'appearance/ith_robe_m.sat', 'Female Ithorian': 'appearance/ith_robe_m.satx',
};
const male = I.fitFrom(row, 'm', own, has);
ok(JSON.stringify(male) === JSON.stringify({ block: ['wookiee_male'], own: { ithorian_male: 'appearance/ith_robe_m.sat' } }), 'only the male columns count; default, own-equal and missing paths drop out');
const female = I.fitFrom(row, 'female', own, has);
ok(JSON.stringify(female) === JSON.stringify({ block: ['human_female'], hide: ['wookiee_female'], own: { twilek_female: 'appearance/hat_s04_rod_m.sat' } }), 'the female columns: a .satx drops out, block and hide land in their lists');
ok(I.fitFrom({ 'Object Template Name': 'shared_x', 'Male Human': ':default', 'Male Wookiee': '' }, 'm', own, has) === undefined, 'every species wearing it as it is gives undefined');
ok(I.fitFrom(undefined, 'm', own, has) === undefined, 'no row gives undefined');
const sorted = I.fitFrom({ 'Male Wookiee': ':block', 'Male Human': ':block', 'Male Bothan': ':block' }, 'm', own, has);
ok(JSON.stringify(sorted?.block) === '["bothan_male","human_male","wookiee_male"]', 'the species lists are sorted');

// The table itself, read from a datatable.
files.set(I.APPEARANCE_TABLE, datatable(['Object Template Name', 'Male Human', 'Male Wookiee'], [['shared_shirt_s03', ':default', ':block'], ['shared_pants_s01', 'appearance/pants_s01_m.sat', ':hide']]));
const table = I.readAppearanceTable(vfs);
ok(table.size === 2 && table.get('shared_shirt_s03')?.['Male Wookiee'] === ':block' && table.get('shared_pants_s01')?.['Male Human'] === 'appearance/pants_s01_m.sat', 'the appearance table is keyed by shared_<id>');
ok(I.speciesColumn(Object.keys(table.get('shared_shirt_s03')!), 'wookiee_male') === 'Male Wookiee', 'a row\'s keys are the table\'s columns');
ok(I.readAppearanceTable({ has: () => false, read: () => Buffer.alloc(0) }).size === 0, 'an absent table is an empty map');

// 8. The status counts.
const st = I.itemPackStatus([
  { id: 'a', name: 'A', slots: [['chest1']], icon: 'icons/a.png', fit: { block: ['wookiee_male'] }, parts: [{}] },
  { id: 'b', name: null, slots: null, icon: null, parts: [] },
  { id: 'c', name: 'C', slots: [['hat']], icon: null, parts: [{}] },
]);
ok(st.items === 3 && st.named === 2 && st.slotted === 2 && st.iconed === 1 && st.fitted === 1 && st.unseen === 1 && !st.missingKeys, 'the counts: named, with slots, with icons, with species rules, worn unseen');
ok(I.itemPackStatus([{ id: 'old', parts: [{}] }, { id: 'new', slots: null, parts: [] }]).missingKeys === true, 'an entry without a slots key marks the pack as converted before items');
ok(I.itemPackStatus(undefined as unknown as unknown[]).items === 0, 'no list counts nothing');

// 9. The wardrobe command's choice per template, with a fake converter: which appearance is built, the fallback, worn
// unseen, failures and the "took" count.
const wearable = new Set(['appearance/shirt_s03_m.sat', 'appearance/ith_robe_m.sat', 'appearance/bracelet_m_s02_l.sat']);
const tried: string[] = [];
const wear = (path: string) => {
  tried.push(path);
  if (!wearable.has(path)) throw new Error(`no mesh survived in ${path}`);
  return { satPath: path };
};
const choose = (cell: string | undefined, templateSat: string, ownChoice = templateSat) => {
  tried.length = 0;
  return I.wardrobeChoice(cell, templateSat, ownChoice, has, wear);
};
let c = choose('appearance/ith_robe_m.sat', own);
ok(c.made?.satPath === 'appearance/ith_robe_m.sat' && c.took && !c.fellBack && !c.unseen && !c.error && c.verdict === 'own', 'a species\' own cut that converts is built, and counts as taken');
c = choose('appearance/hat_s04_rod_m.sat', own);
ok(c.made?.satPath === own && c.fellBack && !c.took && !c.error && JSON.stringify(tried) === JSON.stringify(['appearance/hat_s04_rod_m.sat', own]), 'a species\' own cut that will not convert falls back to the template\'s, not counted as taken');
c = choose(':default', own);
ok(c.made?.satPath === own && !c.took && !c.fellBack && tried.length === 1, ':default builds the template\'s appearance once');
c = choose('appearance/missing_m.sat', own);
ok(c.made?.satPath === own && c.missing && !c.took, 'a path the archives lack builds the template\'s and is marked missing');
c = choose(':hide', 'appearance/humanoid_only_m.sat');
ok(c.unseen && !c.made && !c.error && c.verdict === 'hide', ':hide with nothing buildable is worn unseen, not a failure');
c = choose(':hide', own);
ok(!!c.made && !c.unseen, ':hide with a mesh that converts is built (the humans\' folders)');
c = choose(':default', 'appearance/humanoid_only_m.sat');
ok(!c.made && !c.unseen && c.error instanceof Error && /humanoid_only/.test(c.error.message), 'nothing buildable without :hide is a failure carrying the error');
c = choose('appearance/hat_s04_rod_m.sat', 'appearance/humanoid_only_m.sat');
ok(!c.made && !c.unseen && /humanoid_only/.test(String(c.error?.message)) && !c.fellBack, 'an own cut and the template\'s both failing is a failure with the last error');
// The converter's wear() applies the gender swap itself: a template naming the women's mesh, swapped to the men's, is
// what the template alone gives, so building it is not counted as taken.
const swapped = (path: string) => wear(path.replace(/_f_s02_l\.sat$/, '_m_s02_l.sat'));
c = I.wardrobeChoice(undefined, 'appearance/bracelet_f_s02_l.sat', 'appearance/bracelet_m_s02_l.sat', has, swapped);
ok(c.made?.satPath === 'appearance/bracelet_m_s02_l.sat' && !c.took, 'what the template alone gives, after the gender swap, is not counted as taken');
c = I.wardrobeChoice('appearance/bracelet_m_s02_l.sat', 'appearance/bracelet_f_s02_l.sat', 'appearance/bracelet_f_s02_l.sat', has, wear);
ok(c.made?.satPath === 'appearance/bracelet_m_s02_l.sat' && c.took, 'the men\'s bracelet from the table counts as taken against the template\'s women\'s mesh');

// The fit written with the entry: the folder's own species wears the entry's sat, so it is never in fit.own (a cut
// that did not convert and was replaced by the template's, or a cell the gender swap turned to the other suffix).
const ithRow: Record<string, string> = { 'Object Template Name': 'shared_camo', 'Male Human': ':default', 'Male Ithorian': 'appearance/hat_s04_rod_m.sat', 'Male Wookiee': ':block' };
ok(JSON.stringify(I.fitFrom(ithRow, 'm', own, has)) === JSON.stringify({ block: ['wookiee_male'], own: { ithorian_male: 'appearance/hat_s04_rod_m.sat' } }), 'fitFrom alone records the folder\'s stripped cut as its own');
ok(JSON.stringify(I.wardrobeFit(ithRow, 'm', own, has, 'ithorian_male')) === JSON.stringify({ block: ['wookiee_male'] }), 'wardrobeFit leaves the folder\'s own species out of fit.own');
ok(JSON.stringify(I.wardrobeFit(ithRow, 'm', own, has, 'human_male')) === JSON.stringify(I.fitFrom(ithRow, 'm', own, has)), 'for another folder the Ithorian cut stays in fit.own');
ok(I.wardrobeFit({ 'Male Ithorian': 'appearance/hat_s04_rod_m.sat' }, 'm', own, has, 'ithorian_male') === undefined, 'a fit left empty by that is undefined, never {}');
const twoOwn = { 'Male Ithorian': 'appearance/hat_s04_rod_m.sat', "Male Twi'lek": 'appearance/ith_robe_m.sat', 'Male Wookiee': ':block' };
ok(JSON.stringify(I.wardrobeFit(twoOwn, 'm', own, has, 'ithorian_male')) === JSON.stringify({ block: ['wookiee_male'], own: { twilek_male: 'appearance/ith_robe_m.sat' } }), 'the other species\' own cuts and the block list stay');
const blockedSelf = { 'Male Human': ':block', 'Male Wookiee': ':hide' };
ok(JSON.stringify(I.wardrobeFit(blockedSelf, 'm', own, has, 'human_male')) === JSON.stringify({ block: ['human_male'], hide: ['wookiee_male'] }), 'the folder\'s own block or hide verdict is kept');

console.log(`${checks} checks passed`);
