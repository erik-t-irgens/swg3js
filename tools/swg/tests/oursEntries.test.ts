// The entries of ours (tools/swg/oursEntries.mjs, manifests/ours-entries.json): the table's shape, each command that
// reads it, the marking as ours in every menu's own builder, and `status` asking for every command whose pack predates
// them.
//
// The committed table is held to SOE's final names list (every row's appearance a path the list carries) and scanned
// string by string: a row holds a path, a menu, a name of ours, a client arrangement and the bodies it fits, and
// nothing else. Every command's rules are then run over a miniature table of `test_*` rows written at run time and
// loaded through the hook (`SWG3JS_OURS`), as wave 3's tests write a tree of `test_*` names: the wardrobe's plan of what a
// folder takes (`oursWardrobePlan`, which the wardrobe command's loop runs), the customization command's builder, the
// props' builder and the mobiles planner (with a stand-in scan); the commands' hand-overs to those rules and their four
// stamp writes are pinned as text. The give screens, the hair grid, the props view and the NPC tab are asked how they
// mark a row of ours. `status` is run as a child over folders made here, through the names-list hook so the late stamp
// says applied (or final), twice: before this wave's marks and with them.
//
// Run: node tools/swg/tests/oursEntries.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINAL_NAMES_COLUMNS, SKU_TOCS, finalNamesKey, finalNamesList, sha256File } from '../finalnames.mjs';
import { OURS_FIELDS, OURS_HAIR_ARRANGEMENT, OURS_LEFT_OUT, OURS_MENUS, OURS_URL, loadOurs, oursAsk, oursClothesFor, oursFit, oursHairRow, oursId, oursKey, oursPassedOver, oursRows, oursStamp, oursWardrobePlan, parseOurs, rowFault } from '../oursEntries.mjs';
import { buildCustomization } from '../customization.mjs';
import { buildOursProps, OURS_PROP_GROUP, propCounts } from '../props.mjs';
import { planMobiles, wardrobeIndex } from '../mobiles.mjs';
import { TEST, writeToc, writeTre } from './tocWriter.ts';
import { buildWardrobeView, buildPropView, giveCellHtml, OURS_NOTE } from '../../../src/ui/giveModel.ts';
import { hairCells } from '../../../src/ui/hairGrid.ts';
import { hairOfSpecies } from '../../../src/core/inventory.ts';
import { placeOf, readinessOf } from '../../../src/world/mobiles/catalogueIndex.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ---------------------------------------------------------------------------------------------------------
// The committed table.
const text = readFileSync(OURS_URL, 'utf8');
const table = parseOurs(text) as { rows: Record<string, unknown>[]; key: string; broken?: string };
ok(!table.broken && table.rows.length > 0, `the committed table reads (${table.rows?.length ?? 0} rows, key ${table.key})${table.broken ? `: ${table.broken}` : ''}`);
ok(table.key === oursKey(text.replace(/\n/g, '\r\n')), 'a CRLF copy of the table keys the same');
const list = finalNamesList() as { rows: unknown[][]; broken?: string };
const lateSet = new Set((list.rows ?? []).filter((r) => r[0] === 'set').map((r) => String(r[2]).toLowerCase()));
ok(!list.broken && table.rows.every((r) => lateSet.has(String(r.appearance))), `every row's appearance is a path SOE's final names list carries (${table.rows.filter((r) => !lateSet.has(String(r.appearance))).map((r) => r.appearance).join(', ') || 'all'})`);
const leftOut = Object.keys(OURS_LEFT_OUT);
ok(leftOut.every((p) => lateSet.has(p)) && leftOut.every((p) => !table.rows.some((r) => r.appearance === p)), 'every appearance left out is a path the list carries and is no row');
ok(table.rows.length + leftOut.length === 66 && new Set([...table.rows.map((r) => r.appearance), ...leftOut]).size === 66, `the rows and those left out are the census's 66 late appearance files no template names, once each (${table.rows.length} + ${leftOut.length})`);
ok(OURS_MENUS.every((m) => oursRows(table, m).length > 0), `every menu has rows (${OURS_MENUS.map((m) => `${m} ${oursRows(table, m).length}`).join(', ')})`);
// Every string in the file: the note, or a field of a row, each of its own shape; never a string id or a template path.
{
  const strays: string[] = [];
  const raw = JSON.parse(text) as { note: unknown; rows: Record<string, unknown>[] };
  for (const k of Object.keys(raw)) if (!['format', 'note', 'rows'].includes(k)) strays.push(`top-level ${k}`);
  for (const r of raw.rows) {
    for (const [k, v] of Object.entries(r)) {
      if (!OURS_FIELDS.includes(k)) strays.push(`${String(r.appearance)}: field ${k}`);
      const values = Array.isArray(v) ? v : [v];
      for (const s of values) {
        if (typeof s !== 'string') strays.push(`${String(r.appearance)}: ${k} not a string`);
        else if (/^@|^[a-z0-9_/]+:[a-z0-9_]+$|^object\//i.test(s) && k !== 'appearance') strays.push(`${String(r.appearance)}: ${k} reads like a string id or a template (${s})`);
        else if (k === 'name' && /\.(iff|sat|apt|stf)\b/.test(s)) strays.push(`${String(r.appearance)}: its name names a file`);
      }
    }
    if (rowFault(r)) strays.push(String(rowFault(r)));
  }
  ok(!strays.length, `nothing but a path, a menu, a name of ours, a client arrangement and the bodies it fits (${strays.join('; ') || 'none'})`);
}
// The reader refuses what is not a row.
const base = { appearance: 'appearance/test_a.sat', menu: 'props', name: 'TEST a' };
const refuse = (rows: unknown[], why: RegExp, what: string) => {
  const r = parseOurs(JSON.stringify({ format: 1, rows })) as { broken?: string };
  ok(!!r.broken && why.test(r.broken), `${what} (${r.broken})`);
};
refuse([{ ...base, stringId: '@test:key' }], /no field/, 'a row with any other field is refused');
refuse([{ ...base, menu: 'garage' }], /menu/, 'a menu not one of the four is refused');
refuse([base, base], /twice/, 'an appearance twice is refused');
refuse([{ ...base, menu: 'clothes', fits: ['human_male'] }], /arrangement/, 'a garment with no arrangement is refused');
refuse([{ ...base, fits: ['human_male'] }], /fits nobody/, 'a prop that fits a body is refused');
refuse([{ ...base, menu: 'hair' }], /names the bodies/, 'a hairstyle that fits nobody is refused');
refuse([{ ...base, menu: 'hair', fits: ['appearance/x.sat'] }], /species id/, 'a hairstyle fitting a body path is refused');
refuse([{ ...base, menu: 'npc', fits: ['human_male'] }], /body appearance/, 'an NPC garment fitting a species id is refused');
refuse([{ ...base, appearance: 'object/tangible/test.iff' }], /appearance path/, 'a template where the appearance goes is refused');
refuse([base, { ...base, appearance: 'appearance/test_a.apt' }], /one entry/, 'two rows of one menu whose stems are one (one prop twice over) are refused; only a garment\'s two cuts share an id');
ok(!!(parseOurs('{') as { broken?: string }).broken && !!(parseOurs(JSON.stringify({ format: 2, rows: [] })) as { broken?: string }).broken, 'a table that is not JSON, or of another format, is no table');

// ---------------------------------------------------------------------------------------------------------
// The rules every command shares.
ok(oursId({ appearance: 'appearance/test_shirt_m.sat', menu: 'clothes' }) === 'ours_test_shirt' && oursId({ appearance: 'appearance/test_hair.sat', menu: 'hair' }) === 'hair_ours_test_hair' && oursId({ appearance: 'appearance/test_body.sat', menu: 'npc' }) === 'ours/test_body' && oursId({ appearance: 'appearance/test_fence.apt', menu: 'props' }) === 'ours_test_fence', 'an id of ours is never one a template could give: a garment ours_<stem> without its gender, a hairstyle hair_ours_, a body ours/, a prop ours_');

// The miniature table, written at run time and loaded through the hook.
const root = mkdtempSync(join(tmpdir(), 'swg3js-ours-'));
try {
  const mini = {
    format: 1,
    note: 'TEST',
    rows: [
      { appearance: 'appearance/test_shirt_m.sat', menu: 'clothes', name: 'TEST shirt', slot: 'abstract/slot/arrangement/wearables/shirt.iff', fits: ['human_male', 'bothan_male'] },
      { appearance: 'appearance/test_shirt_f.sat', menu: 'clothes', name: 'TEST shirt', slot: 'abstract/slot/arrangement/wearables/shirt.iff', fits: ['human_female'] },
      { appearance: 'appearance/test_mask.sat', menu: 'clothes', name: 'TEST mask', slot: 'abstract/slot/arrangement/wearables/mask_face.iff', fits: ['human_male', 'human_female'] },
      { appearance: 'appearance/test_beard_m.sat', menu: 'hair', name: 'TEST beard', fits: ['testkin_male'] },
      { appearance: 'appearance/test_gone.sat', menu: 'hair', name: 'TEST gone', fits: ['testkin_male'] },
      { appearance: 'appearance/test_body_s02.sat', menu: 'npc', name: 'TEST body' },
      { appearance: 'appearance/test_robe.sat', menu: 'npc', name: 'TEST robed', fits: ['appearance/test_body.sat'] },
      { appearance: 'appearance/test_nowhere.sat', menu: 'npc', name: 'TEST nowhere' },
      { appearance: 'appearance/test_fence.apt', menu: 'props', name: 'TEST fence' },
      { appearance: 'appearance/test_lost.apt', menu: 'props', name: 'TEST lost' },
      // A man's alone: no woman's cut, and no woman in its fits.
      { appearance: 'appearance/test_vest_m.sat', menu: 'clothes', name: 'TEST vest', slot: 'abstract/slot/arrangement/wearables/vest.iff', fits: ['human_male'] },
    ],
  };
  const miniFile = join(root, 'test_ours.json');
  writeFileSync(miniFile, JSON.stringify(mini, null, 1));
  const prev = process.env.SWG3JS_OURS;
  process.env.SWG3JS_OURS = miniFile;
  const t = loadOurs() as { rows: Record<string, unknown>[]; key: string; broken?: string };
  if (prev === undefined) delete process.env.SWG3JS_OURS;
  else process.env.SWG3JS_OURS = prev;
  ok(!t.broken && t.rows.length === mini.rows.length && t.key === oursKey(JSON.stringify(mini, null, 1)), 'the hook loads a miniature table of test_* rows in place of the committed one');
  const has = (p: string) => !/test_(gone|nowhere|lost)/.test(p);

  // The wardrobe's choice of rows for a folder: a row a gender's fits name, one an id, the folder's own cut first.
  const men = oursClothesFor(t, 'm');
  const women = oursClothesFor(t, 'f');
  ok(men.map((r) => r.appearance).join() === 'appearance/test_shirt_m.sat,appearance/test_mask.sat,appearance/test_vest_m.sat' && women.map((r) => r.appearance).join() === 'appearance/test_shirt_f.sat,appearance/test_mask.sat', "the wardrobe takes a garment of ours in a folder of a gender its fits name, the two cuts of one piece as one item with the folder's own cut, and a man's alone never in a woman's folder");
  const fit = oursFit(men[0], 'm', ['human_male', 'bothan_male', 'wookiee_male', 'human_female']);
  ok(JSON.stringify(fit) === JSON.stringify({ block: ['wookiee_male'] }) && oursFit(men[1], 'f', ['human_female']) === undefined, 'a garment of ours blocks the species of its gender its fits leave out, and nothing where none is left out');

  // What the wardrobe command stands of the table in a folder (`oursWardrobePlan`, which cli.mjs's wardrobe loop runs):
  // the garments, then the hairstyles of the folder's gender, each with the arrangement it takes and the fields that
  // mark its catalogue entry; one the mount has not got counted, never converted.
  const speciesOfGender = ['human_male', 'bothan_male', 'wookiee_male', 'testkin_male', 'human_female'];
  const planM = oursWardrobePlan(t, { gender: 'm', kinds: ['wearables', 'hair'], has, speciesOfGender });
  ok(planM.take.map((x: { kind: string; id: string }) => `${x.kind}:${x.id}`).join() === 'wearables:ours_test_shirt,wearables:ours_test_mask,wearables:ours_test_vest,hair:hair_ours_test_beard_m' && planM.missing === 1, `a man's folder takes his garments of ours, then the hairstyles a man's fits name, and counts the one the mount has not got (${planM.take.map((x: { id: string }) => x.id).join(', ')}; ${planM.missing} missing)`);
  const shirtM = planM.take.find((x: { id: string }) => x.id === 'ours_test_shirt');
  const beardM = planM.take.find((x: { id: string }) => x.id === 'hair_ours_test_beard_m');
  ok(shirtM.row.appearance === 'appearance/test_shirt_m.sat' && shirtM.name === 'TEST shirt' && shirtM.arrangement === 'abstract/slot/arrangement/wearables/shirt.iff' && JSON.stringify(shirtM.mark) === JSON.stringify({ ours: true, fit: { block: ['testkin_male', 'wookiee_male'] } }), "a garment of ours takes its folder's own cut, the arrangement its row names, and is marked ours, blocking the gender's bodies its fits leave out, with no fits of its own");
  ok(beardM.arrangement === OURS_HAIR_ARRANGEMENT && JSON.stringify(beardM.mark) === JSON.stringify({ ours: true, fit: { block: ['bothan_male', 'human_male', 'wookiee_male'] }, fits: ['testkin_male'] }), "a hairstyle of ours takes the hair arrangement and carries its fits, having no template folder to name its species by");
  const planF = oursWardrobePlan(t, { gender: 'f', kinds: ['wearables', 'hair'], has, speciesOfGender });
  ok(planF.take.map((x: { id: string }) => x.id).join() === 'ours_test_shirt,ours_test_mask' && planF.take[0].row.appearance === 'appearance/test_shirt_f.sat' && planF.missing === 0, "a woman's folder takes the woman's cut, nothing of a man's alone, and no hairstyle whose fits name only men");
  ok(oursWardrobePlan(t, { gender: 'm', kinds: ['wearables'], has, speciesOfGender }).take.every((x: { kind: string }) => x.kind === 'wearables') && oursWardrobePlan(t, { gender: 'm', kinds: ['hair'], has, speciesOfGender }).take.every((x: { kind: string }) => x.kind === 'hair'), "a run of the wearables alone takes no hairstyle of ours, and of the hair alone no garment");
  const matched = oursWardrobePlan(t, { gender: 'm', kinds: ['wearables', 'hair'], has, match: /mask/i, speciesOfGender });
  ok(matched.take.map((x: { id: string }) => x.id).join() === 'ours_test_mask' && matched.missing === 0, "a --match run takes only the rows of ours it matches, and counts none it did not ask for");
  ok(oursPassedOver(new Error('built for ithorian_m.skt')) && !oursPassedOver(new Error('no mesh survived')) && !oursPassedOver(new Error('appearance/x.sat not in archives')), 'a row of ours built for another skeleton is passed over quietly; any other failure is a failure');

  // The customization command: the hair rows of ours each species and gender's fits name, missing ones counted.
  const read = {
    // Two species: the one the hairstyles of ours fit, and one none of them does.
    table: (p: string) => (p.endsWith('customization_data.iff') ? { rows: ['testkin_male', 'otherkin_male'].map((s) => ({ SPECIES_GENDER: s, CUSTOMIZATION_GROUP: 'hair', CUSTOMIZATION_NAME: 'color_hair', TYPE: 'color', VARIABLES: 'index_color_1' })) } : p.endsWith('hair_assets_skill_mods.iff') ? { rows: [{ PLAYER_TEMPLATE: 'object/creature/player/shared_testkin_male.iff', SHARED_TEMPLATE: 'object/tangible/hair/testkin/shared_hair_testkin_male_s01.iff', AVAILABLE_AT_CREATION: 1, SKILL_MOD_VALUE: 0 }] } : null),
    strings: () => null,
    palette: () => null,
    has,
  };
  const built = buildCustomization(read, { ours: t }) as { file: { species: Record<string, { hair?: { id: string; ours?: boolean; creation: boolean; name?: string }[] }> }; counts: { ours: number; oursMissing: number } };
  const hair = built.file.species.testkin_male.hair ?? [];
  ok(hair.length === 2 && hair[0].id === 'hair_testkin_male_s01' && !hair[0].ours && hair[1].id === 'hair_ours_test_beard_m' && hair[1].ours === true && hair[1].creation === false && hair[1].name === 'TEST beard', "the creator table's hair list keeps the table's own rows and adds each hairstyle of ours after them, marked ours, never a creation style, named as the table names it");
  ok(built.counts.ours === 1 && built.counts.oursMissing === 1, 'a hairstyle of ours the archives have not got is left out and counted');
  ok(!!built.file.species.otherkin_male && !(built.file.species.otherkin_male.hair ?? []).some((h) => h.ours), 'a species no hairstyle of ours fits is given none of them');
  ok(JSON.stringify(oursHairRow(t.rows[3])) === JSON.stringify({ id: 'hair_ours_test_beard_m', ours: true, name: 'TEST beard', inArchives: true, creation: false }), 'a hair row of ours is its id, ours, its name, in the archives, never a creation style');

  // The props command: a prop of ours in a group of its own, named and marked; one the mount has not got counted.
  const pb = buildOursProps(oursRows(t, 'props'), { has, convert: () => ({ model: 'test_fence', file: 'test_fence.glb', bounds: { min: [-1, 0, -0.1], max: [1, 2, 0.1] }, icon: 'icons/test_fence.png' }) });
  ok(pb.props.length === 1 && pb.missing === 1 && pb.props[0].id === 'ours_test_fence' && pb.props[0].group === OURS_PROP_GROUP && pb.props[0].ours === true && pb.props[0].name === 'TEST fence' && pb.props[0].template === null, 'the props command stands a prop of ours in the group of ours, named and marked ours with no template; one the mount has not got is counted and left out');
  const pc = propCounts({ props: [...pb.props, { id: 'test_skel', model: 'test_skel', group: 'tangible/item' }], models: [{ id: 'test_skel', skeletal: 'idle' }] });
  ok(pc.ours === 1 && pc.skeletal === 1, 'the props counts say how many are ours and how many are drawn by a skeletal appearance stood still');

  // The mobiles planner: a body stands as its own appearance, a garment on its body as an appearance of its own.
  const scan = {
    scanTemplates: () => [],
    playerBodies: () => new Map(),
    scanAppearance: (_vfs: unknown, sat: string) => ({ id: sat.replace(/^.*\//, '').replace(/\.sat$/, ''), sat, skeletons: [{ file: 'appearance/skeleton/test.skt', attachTo: '', joints: 3 }], joints: 3, table: null, hierarchy: '', meshes: [], readable: [], bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1.8, 0.5] }, riderPose: null, missing: [] }),
    nameLookup: () => () => null,
    readTable: () => ({ names: new Map(), hierarchy: '' }),
    readAnimationHeader: () => null,
    meshInfo: () => null,
  };
  const vfs = { has: (p: string) => has(p) };
  const plan = planMobiles({ vfs, scan, io: null, options: {}, source: { key: 'test' }, ours: oursRows(t, 'npc') }) as { entries: { id: string; ours?: boolean; group: string; name: string; template: unknown; appearance: string }[]; appearances: Map<string, { sat: string; wear?: string[]; sig: string }>; ours: { taken: number; missing: number } };
  const body = plan.entries.find((e) => e.id === 'ours/test_body_s02');
  const robed = plan.entries.find((e) => e.id === 'ours/test_robe');
  ok(!!body && !!robed && body.ours === true && robed.ours === true && body.group === 'ours' && body.name === 'TEST body' && body.template === null, 'the mobiles planner stands each body of ours as an entry of ours, in the group of ours, named as the table names it, with no template');
  ok(body?.appearance === 'test_body_s02' && robed?.appearance === 'ours_test_robe' && plan.appearances.get('ours_test_robe')?.sat === 'appearance/test_body.sat' && plan.appearances.get('ours_test_robe')?.wear?.[0] === 'appearance/test_robe.sat' && !plan.appearances.get('test_body_s02')?.wear, "a body variant is its own appearance; a garment of ours is an appearance of its own on the body its fits name, wearing it, and no other appearance wears anything");
  ok(plan.ours.taken === 2 && plan.ours.missing === 1, 'a body of ours the mount has not got is counted and left out');
  // The wardrobe index never hands an entry of ours a mesh the game's own item wears.
  // Both orders: the real catalogue lists every entry of ours after every template's, and the entry of ours is the
  // shorter id, which the plain rule would otherwise prefer.
  const oursItem = { id: 'ours_x', ours: true, sat: 'appearance/x_m.sat', parts: [{ name: 'shared_l0' }] };
  const gameItem = { id: 'longer_game_item', sat: 'appearance/y.sat', parts: [{ name: 'shared_l0' }] };
  const oursFirst = wardrobeIndex({ items: [oursItem, gameItem] });
  const gameFirst = wardrobeIndex({ items: [gameItem, oursItem] });
  ok(oursFirst.get('shared_l0') === 'longer_game_item' && gameFirst.get('shared_l0') === 'longer_game_item', `an NPC's outfit wears the game's own item for a mesh an entry of ours also wears, whichever comes first (${oursFirst.get('shared_l0')}, ${gameFirst.get('shared_l0')})`);

  // The stamp and status's rule.
  ok(JSON.stringify(oursStamp(t, 3, 1)) === JSON.stringify({ key: t.key, taken: 3, missing: 1 }) && oursStamp({ broken: 'x', rows: [] }, 0, 0) === null, "a command stamps the table's key and how many it stood and left out");
  ok(oursAsk(null, { state: 'applied' }, t) !== null && oursAsk(null, { state: 'final' }, t) !== null && oursAsk({ key: 'older' }, { state: 'applied' }, t) !== null && oursAsk({ key: t.key }, { state: 'applied' }, t) === null && oursAsk(null, { state: 'none' }, t) === null && oursAsk(null, null, t) === null, "status asks a pack with no stamp or another table's only where its late stamp says SOE's final files were mounted, by the names list or by the install's own final indexes");

  // The menus mark a row of ours.
  const view = buildWardrobeView([{ id: 'ours_test_shirt', kind: 'wearables', gender: 'm', name: 'TEST shirt', icon: 'icons/ours_test_shirt.png', slots: [['chest1']], parts: [{}], ours: true }, { id: 'shirt_s01', kind: 'wearables', gender: 'm', name: 'Shirt', slots: [['chest1']], parts: [{}] }], { own: 'm', species: 'human_male', mixed: false, blocked: false, find: '', worn: new Set(), dir: 'w/', packPart: () => false });
  const cells = view.groups.flatMap((g) => g.cells);
  const oursCell = cells.find((c) => c.id === 'ours_test_shirt');
  const gameCell = cells.find((c) => c.id === 'shirt_s01');
  ok(!!oursCell?.ours && oursCell.note.includes(OURS_NOTE) && giveCellHtml(oursCell, { on: 'worn', selected: false }).includes('give-tag">ours<') && !gameCell?.ours && !giveCellHtml(gameCell!, { on: 'worn', selected: false }).includes('>ours<'), "the Clothes tab marks a garment of ours with the corner mark and the sentence, and the game's own with neither");
  const props = buildPropView([{ id: 'ours_test_fence', group: 'ours', name: 'TEST fence', ours: true }, { id: 'crate', group: 'tangible/furniture', name: 'Crate' }], { find: '', held: null, order: [{ id: 'ours', label: 'Ours' }, { id: 'tangible/furniture', label: 'Furniture' }], iconUrl: () => null });
  const pcells = props.groups.flatMap((g) => g.cells);
  ok(!!pcells.find((c) => c.id === 'ours_test_fence')?.ours && !pcells.find((c) => c.id === 'crate')?.ours && giveCellHtml(pcells.find((c) => c.id === 'ours_test_fence')!, { on: 'held', selected: false }).includes('>ours<'), 'the Props tab marks a prop of ours and not the game\'s own');
  const hairItems = [{ id: 'hair_testkin_male_s01', kind: 'hair', template: 'object/tangible/hair/testkin/shared_hair_testkin_male_s01.iff', parts: [{ file: 'a.glb' }] }, { id: 'hair_ours_test_beard_m', kind: 'hair', template: null, fits: ['testkin_male'], ours: true, name: 'TEST beard', parts: [{ file: 'b.glb' }] }];
  ok(hairOfSpecies(hairItems, 'testkin').length === 2 && hairOfSpecies(hairItems, 'otherkin').length === 0, 'a hairstyle of ours belongs to the species its fits name, having no template folder');
  const grid = hairCells({ species: { testkin_male: built.file.species.testkin_male } } as never, hairItems, 'testkin', 'male', null);
  const oursGroup = grid.groups.find((g) => g.id === 'ours');
  ok(!!oursGroup && oursGroup.cells.length === 1 && oursGroup.cells[0].label === 'TEST beard' && oursGroup.cells[0].ours === true && !grid.groups.find((g) => g.id === 'own')?.cells.some((c) => c.ours) && !grid.groups.find((g) => g.id === 'untabled'), "the hair grid lays the hairstyles of ours out in a group of their own, named as the table names them and marked, never among the game's own or the untabled");
  const npcEntry = { id: 'ours/test_body_s02', kind: 'creature', folder: 'ours', group: 'ours', ours: true, name: 'TEST body', subtitle: null, flags: [], gender: null, appearance: 'test_body_s02', species: null, pack: 'test-pack', variant: null, custom: {}, morphs: {}, ready: true } as never;
  ok(placeOf(npcEntry).key === 'ours' && /ours/i.test(placeOf(npcEntry).label), 'the NPC tab places a body of ours in the group of ours, whatever kind its table makes it');
  const file = { appearances: { test_body_s02: { id: 'test_body_s02', ready: true, pack: 'test-pack' } }, packs: { 'test-pack': { id: 'test-pack', ready: true } } } as never;
  ok(readinessOf(npcEntry, file, new Set()).ok && !readinessOf(npcEntry, { appearances: {}, packs: {} } as never, new Set()).ok, "a body of ours is ready by the NPC tab's own rule (`readinessOf`): its model and pack converted");

  // ---------------------------------------------------------------------------------------------------------
  // `status` over folders made here: the late stamp says applied through the names-list hook.
  const install = join(root, 'install');
  mkdirSync(install);
  const late = writeTre(join(install, 'test_late_00.tre'), [{ bytes: TEST('late file') }]);
  for (const s of SKU_TOCS) writeToc(join(install, s), ['test_late_00.tre'], s === 'sku0_client.toc' ? [{ name: 'appearance/a.msh', tree: 0, ...late[0] }] : []);
  const against = Object.fromEntries(SKU_TOCS.map((s) => [s, { size: statSync(join(install, s)).size, sha256: sha256File(join(install, s)) }]));
  const from = Object.fromEntries(SKU_TOCS.map((s) => [s, { size: 1, sha256: '0'.repeat(64) }]));
  const blob = TEST('later file');
  const listText = JSON.stringify({ format: 1, note: 'TEST', from, against, archives: ['test_late_00.tre'], columns: FINAL_NAMES_COLUMNS, rows: [['set', 'sku0', 'appearance/a.msh', 0, late[0].offset, blob.length, blob.length, 0, createHash('sha1').update(blob).digest('hex')]], facts: { 'test_late_00.tre': { size: statSync(join(install, 'test_late_00.tre')).size, sha256: sha256File(join(install, 'test_late_00.tre')) } } });
  const listFile = join(root, 'list.json');
  writeFileSync(listFile, listText);
  const stamp = { key: finalNamesKey(listText), state: 'applied', rows: 1, v: 1 };
  const packs = join(root, 'packs');
  const json = (rel: string, v: unknown) => {
    mkdirSync(join(packs, rel, '..'), { recursive: true });
    writeFileSync(join(packs, rel), JSON.stringify(v));
  };
  const current = { key: t.key, taken: 1, missing: 0 };
  json('wardrobe/human_male/wardrobe.json', { species: 'human_male', gender: 'm', items: [], materialFormat: 6, late: stamp });
  json('wardrobe/human_female/wardrobe.json', { species: 'human_female', gender: 'f', items: [], materialFormat: 6, late: stamp, ours: current });
  json('wardrobe/ithorian_male/wardrobe.json', { species: 'ithorian_male', gender: 'm', items: [], materialFormat: 6, late: { ...stamp, state: 'none' } });
  // Converted from an install whose own indexes are SOE's final ones: every row's appearance is there too.
  json('wardrobe/ithorian_female/wardrobe.json', { species: 'ithorian_female', gender: 'f', items: [], materialFormat: 6, late: { ...stamp, state: 'final' } });
  json('characters/customization.json', { format: 1, species: { wookiee_male: { groups: [], rows: [], hair: [{ id: 'hair_wookiee_male_s01' }] }, human_male: { rows: [{ name: 'color_eyes' }] } }, late: stamp, ours: { key: 'older0000000', taken: 0, missing: 0 } });
  json('mobiles/catalogue.json', { format: 1, materialFormat: 6, options: { source: { key: 'test', late: stamp } }, counts: {}, appearances: {}, packs: {}, wearables: {}, wardrobes: {}, entries: [], excluded: [], failed: [] });
  json('props/manifest.json', { version: 1, materialFormat: 6, props: [], models: [], skipped: [], late: stamp, ours: current });
  json('ships/manifest.json', { ships: [], skipped: [], models: [], materialFormat: 6, late: stamp });
  const status = () => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url)), 'status', packs, '--json', `--swg=${install}`], { encoding: 'utf8', maxBuffer: 64 * 1048576, env: { ...process.env, SWG: '', SWG3JS_FINAL_NAMES: listFile, SWG3JS_OURS: miniFile } });
    if (!run.stdout.trim()) console.log(run.stderr);
    const out = JSON.parse(run.stdout) as { steps: { command: string; args: string[]; reasons: string[] }[] };
    const why = (command: string, phrase: string, arg?: (args: string[]) => boolean) => out.steps.filter((s) => s.command === command && (!arg || arg(s.args))).some((s) => s.reasons.some((r) => r.includes(phrase)));
    const reasons = (command: string) => out.steps.filter((s) => s.command === command).flatMap((s) => s.reasons).join(' | ');
    const args = (command: string) => out.steps.filter((s) => s.command === command).map((s) => s.args.join(' ')).join(' | ');
    return { why, reasons, args };
  };
  {
    const { why, reasons, args } = status();
    ok(why('wardrobe', 'before the entries of ours') && /human_male/.test(reasons('wardrobe')) && !/human_female\/wardrobe\.json was converted before the entries/.test(reasons('wardrobe')) && !/ithorian_male\/wardrobe\.json was converted before the entries/.test(reasons('wardrobe')), `status asks a wardrobe stamped applied with no stamp of ours, not one with the table's own, and not one converted without SOE's final files (${reasons('wardrobe')})`);
    ok(/ithorian_female\/wardrobe\.json was converted before the entries of ours/.test(reasons('wardrobe')), `and asks one converted from an install whose own indexes are SOE's final ones (stamped final) as well (${reasons('wardrobe')})`);
    ok(why('customization', 'older table of entries of ours'), "status asks the creator's table stamped with another table's key");
    ok(why('mobiles', 'before the entries of ours', (a) => !a.includes('--skip-existing')), `status asks for the mobiles' plain run, which makes every unit again, where the catalogue was planned before the entries of ours (${args('mobiles')})`);
    ok(!why('props', 'entries of ours') && why('props', 'skeletal props'), `status asks nothing of ours of a props pack carrying the table's key, and asks for one written before the skeletal props (${reasons('props')})`);
    ok(why('ships', 'NPC-only hulls'), `status asks for the ships where the manifest was written before the NPC-only hulls (${reasons('ships')})`);
  }
  // Once each pack carries this wave's mark, nothing is asked for it again: a props pack with the skeletal props and no
  // stamp of ours is asked for the entries of ours alone, a ships pack with the NPC-only hulls is asked nothing of them,
  // and a catalogue planned with an earlier table is planned again (`--skip-existing`), never rebuilt whole.
  json('props/manifest.json', { version: 1, materialFormat: 6, skeletalFormat: 1, props: [], models: [], skipped: [], late: stamp });
  json('ships/manifest.json', { ships: [], skipped: [], models: [], materialFormat: 6, late: stamp, npcHulls: 1 });
  json('mobiles/catalogue.json', { format: 1, materialFormat: 6, options: { source: { key: 'test', late: stamp } }, counts: {}, appearances: {}, packs: {}, wearables: {}, wardrobes: {}, entries: [], excluded: [], failed: [], ours: { key: 'older0000000', taken: 0, missing: 0 } });
  {
    const { why, reasons, args } = status();
    ok(why('props', 'before the entries of ours') && !why('props', 'skeletal props'), `a props pack with the skeletal props and no stamp of ours is asked for the entries of ours and not the skeletal props (${reasons('props')})`);
    ok(!why('ships', 'NPC-only hulls'), `a ships pack written with the NPC-only hulls is not asked for them (${reasons('ships') || 'nothing asked'})`);
    ok(why('mobiles', 'older table of entries of ours', (a) => a.includes('--skip-existing')) && !why('mobiles', 'entries of ours', (a) => !a.includes('--skip-existing')), `a catalogue planned with an earlier table is planned again with --skip-existing, never rebuilt whole (${args('mobiles')})`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------------
// The hand-overs only the commands make, read as text: every check above runs the rules on inputs of its own, so a
// command that stopped calling them, or stopped writing its stamp, would leave every one of them passing while its pack
// lost its entries of ours, or `status` asked for it for ever (the checks of the packs on disk below are gated on that
// very stamp, so they would only say they were skipped).
{
  const cli = readFileSync(new URL('../cli.mjs', import.meta.url), 'utf8');
  const mob = readFileSync(new URL('../mobiles.mjs', import.meta.url), 'utf8');
  const pin = (src: string, re: RegExp, what: string) => ok(re.test(src), what);
  pin(cli, /const oursPlan = oursWardrobePlan\(ours, \{ gender, kinds, has, match, speciesOfGender \}\);\s*const sources = \[\.\.\.templates\.map\([^\n]*\.\.\.oursPlan\.take\.map\(/, "the wardrobe command takes the rows its plan names (oursWardrobePlan), after every template");
  pin(cli, /variables: customizationList\(vfs, info\), \.\.\.\(oursItem \? oursItem\.mark : \{\}\) \}\);/, 'and writes each with the fields its plan marks it with');
  pin(cli, /if \(oursItem && oursPassedOver\(err\)\) oursCount\.otherSkeleton\+\+;/, "and passes over one built for another skeleton by the plan's own rule");
  pin(cli, /const wardrobeOurs = wardrobePartial \? null : oursStamp\(ours, oursCount\.taken, oursCount\.missing\);[\s\S]{0,300}\.\.\.\(wardrobeOurs \? \{ ours: wardrobeOurs \} : \{\}\)/, "the wardrobe stamps the table's key into wardrobe.json, from a whole run only");
  pin(cli, /built = buildCustomization\(read, \{ ours \}\);/, 'the customization command hands the table to its builder');
  pin(cli, /const customOurs = oursStamp\(ours, counts\.ours, counts\.oursMissing\);\s*if \(customOurs\) file\.ours = customOurs;/, 'and stamps its key into customization.json');
  pin(cli, /const oursBuilt = P\.buildOursProps\(oursRows\(ours, 'props'\), \{ convert: \(row\) => fromResolved\(resolveAppearanceToMesh\(vfs, row\.appearance\)\), has: \(p\) => vfs\.has\(p\) \}\);/, 'the props command stands the rows of ours through the very path a template takes');
  pin(cli, /\.\.\.\(whole \? \{ ours: oursStamp\(ours, oursBuilt\.props\.length, oursBuilt\.missing\) \?\? undefined \} : \{\}\)/, 'and stamps its key into the props manifest, from a whole run only');
  pin(cli, /code: mobilesCodeStamp\(\),\s*core3Stats,\s*\/\/[^\n]*\n\s*ours: oursTable\(\),/, 'the mobiles command hands the table to its run');
  pin(mob, /if \(full && ours && !ours\.broken && ours\.key\) catalogue\.ours = \{ key: ours\.key, taken: plan\.ours\?\.taken \?\? 0, missing: plan\.ours\?\.missing \?\? 0 \};\s*io\.writeJsonAtomic\('mobiles\/catalogue\.json', catalogue, 0\);/, 'and the mobiles run stamps its key into the catalogue before it writes it, from a run not narrowed');
  const loop = cli.slice(cli.indexOf('function lateStatus('), cli.indexOf('function packStatus('));
  const asked = loop.indexOf('const why = oursAsk(f.json.ours ?? null, f.stamp, ours);');
  ok(asked > 0 && asked < loop.indexOf("if (f.stamp?.state !== 'applied') continue;") && loop.includes("if (why && entry.command === 'mobiles' && !f.json.ours) need(`mobiles <swg-dir> ${dir} --retail-only`"), "status asks for the entries of ours before the loop's applied-only named products, and the mobiles' plain run only of a catalogue never planned with a table of ours");
}

// ---------------------------------------------------------------------------------------------------------
// The packs on disk (`SWG3JS_PACKS`, else assets-private): each pack converted with the committed table stands every
// row of its menu the mount had, and no entry of ours offers again what a template's own entry already shows.
{
  const packs = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
  const read = (rel: string): Record<string, any> | null => {
    try {
      return JSON.parse(readFileSync(join(packs, rel), 'utf8'));
    } catch {
      return null;
    }
  };
  const withTable = (p: Record<string, any> | null) => p?.ours?.key === table.key;
  const index = read('characters/index.json') as { species?: { id?: string; wardrobe?: string }[] } | null;
  const folders = [...new Set((index?.species ?? []).map((s) => s.wardrobe).filter((w): w is string => !!w))];
  const wardrobes = folders.map((f) => ({ f, w: read(`wardrobe/${f}/wardrobe.json`) })).filter((x) => !!x.w);
  const stamped = wardrobes.filter((x) => withTable(x.w));
  if (!stamped.length) console.log(`note: no wardrobe on disk was converted with this table (${table.key}); the pack checks of the clothes and hair are skipped`);
  else {
    // A mesh list a template's own entry wears, in any folder (a hairstyle of one species may sit in another's folder).
    const meshes = (i: { parts?: { file?: string; name?: string }[] }) => (i.parts ?? []).map((p) => p.file ?? p.name ?? '').sort().join(',');
    const gameMeshes = new Map<string, string>();
    for (const { w } of wardrobes) for (const i of w!.items as { id: string; ours?: boolean; parts?: { file?: string }[] }[]) if (!i.ours && meshes(i)) gameMeshes.set(meshes(i), i.id);
    const twice: string[] = [];
    const missing: string[] = [];
    const unmarked: string[] = [];
    // The folder a species' hair and clothes are converted into, by the species index (a Bothan woman's is the human
    // woman's folder).
    const folderOf = new Map((index?.species ?? []).map((s) => [s.id ?? '', s.wardrobe ?? null]));
    for (const { f, w } of stamped) {
      const ids = new Set((w!.items as { id: string }[]).map((i) => i.id));
      // Every garment and hairstyle of ours whose fits name a species this folder is the wardrobe of.
      const mine = (r: Record<string, unknown>) => (r.fits as string[]).some((s) => folderOf.get(s) === f || s === f);
      for (const r of [...oursRows(table, 'clothes'), ...oursRows(table, 'hair')].filter(mine)) if (!ids.has(oursId(r)) && !Number(w!.ours?.missing ?? 0)) missing.push(`${f}: ${oursId(r)}`);
      for (const i of w!.items as { id: string; ours?: boolean; parts?: { file?: string }[] }[]) {
        if (i.ours && gameMeshes.has(meshes(i))) twice.push(`${f}: ${i.id} wears what ${gameMeshes.get(meshes(i))} wears`);
        // An id of ours (`ours_`, `hair_ours_`) never stands unmarked: a menu tells the game's from ours by the mark alone.
        if (/^(hair_)?ours_/.test(i.id) && i.ours !== true) unmarked.push(`${f}: ${i.id}`);
      }
    }
    const stood = stamped.reduce((n, x) => n + Number(x.w!.ours?.taken ?? 0), 0);
    ok(!twice.length, `no entry of ours in a wardrobe wears exactly the meshes a template's own entry wears (${stamped.length} folders${twice.length ? `; ${twice.slice(0, 6).join('; ')}` : ''})`);
    ok(!missing.length, `every garment and hairstyle of ours that fits a folder's bodies is in it, unless the folder counts what the mount had not got (${missing.slice(0, 6).join('; ') || `${stood} stood`})`);
    ok(!unmarked.length, `every entry of ours a wardrobe holds is marked ours (${stood} stood${unmarked.length ? `; unmarked: ${unmarked.slice(0, 6).join('; ')}` : ''})`);
  }
  const custom = read('characters/customization.json');
  if (!withTable(custom)) console.log("note: the creator's table on disk was not converted with this table; its check is skipped");
  else {
    const hair = Object.values(custom!.species as Record<string, { hair?: { id: string; ours?: boolean }[] }>).flatMap((e) => (e.hair ?? []).filter((h) => h.ours).map((h) => h.id));
    const want = oursRows(table, 'hair').map((r) => oursId(r));
    ok(want.every((id) => hair.includes(id)) || Number(custom!.ours?.missing ?? 0) > 0, `the creator's table carries every hairstyle of ours (${[...new Set(hair)].join(', ')})`);
  }
  const props = read('props/manifest.json');
  if (!withTable(props)) console.log('note: the props pack on disk was not converted with this table; its check is skipped');
  else {
    const have = new Set((props!.props as { id: string; ours?: boolean }[]).filter((p) => p.ours).map((p) => p.id));
    const want = oursRows(table, 'props').map((r) => oursId(r));
    ok(want.every((id) => have.has(id)) || Number(props!.ours?.missing ?? 0) > 0, `the props pack stands every prop of ours (${have.size} of ${want.length})`);
  }
  const catalogue = read('mobiles/catalogue.json');
  if (catalogue?.ours?.key !== table.key) console.log('note: the mobiles catalogue on disk was not planned with this table; its check is skipped');
  else {
    const have = new Set((catalogue!.entries as { id: string; ours?: boolean }[]).filter((e) => e.ours).map((e) => e.id));
    const want = oursRows(table, 'npc').map((r) => oursId(r));
    ok(want.every((id) => have.has(id)) || Number(catalogue!.ours?.missing ?? 0) > 0, `the NPC catalogue carries every body of ours (${have.size} of ${want.length})`);
  }
}

console.log(`\n${passed} checks passed`);
