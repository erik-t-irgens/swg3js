// A hull's customization as the converter reads it (tools/swg/shipfit.mjs): the chassis slots and the
// components each takes, grouped by the model they show; the stock pick; the droids; the paint
// shaders, their variables and the recipes written for them. Synthetic tables, no archives.
import assert from 'node:assert/strict';
import {
  buildDroids, buildSlots, chassisNameFor, compatClasses, componentKey, componentList, componentWeapon, CRAFT_TOKENS, droidHeadRows,
  fallbackLabel, fitStatus, fitSummary, groupLooks, HIDDEN_COMPONENT, hullTokens, isPaintShader, loadoutsLine, lookOfComponent,
  mergePaintVariables, mergeRecipes, modalLook, modalLooks, paintedMainImage, paintGlow, parseLookCell, pickStock, recipeImages, SHIP_FIT_FORMAT,
  SPECIAL_COMPONENT, STOCK_LEFT_OUT, stockPairs, stockWeapon, trimPaintShader, withPatternAlpha,
} from '../shipfit.mjs';
import { buildShips, shipLabelOf } from '../ships.mjs';
import { loadShader, renderContext } from '../texrender.mjs';
import { exportShader, ImageRegistry } from '../customize.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// --- 1. chassisNameFor, 12. componentKey -------------------------------------------------------------

{
  const rows = new Set(['player_xwing', 'player_yt1300', 'player_corvette']);
  const has = (n: string) => rows.has(n);
  ok(chassisNameFor('player_xwing', has) === 'player_xwing', 'a hull whose template name is a chassis row takes it');
  ok(chassisNameFor('player_yt1300_decorated_01', has) === 'player_yt1300', 'a decorated YT-1300 takes the plain one');
  ok(chassisNameFor('player_corellian_corvette', has) === 'player_corvette', 'the Corellian corvette is aliased to player_corvette');
  ok(chassisNameFor('player_unknown', has) === null, 'an unknown hull has none');
  ok(componentKey('armor_test.iff') === 'armor_test' && componentKey(' wpn_light_blaster ') === 'wpn_light_blaster', "a component's key drops '.iff' and spaces");
}

// --- 2. compatClasses, 3. parseLookCell, 4. groupLooks ----------------------------------------------------

{
  ok(eq(compatClasses('rct_0,rct_gunship'), ['rct_0', 'rct_gunship']), 'a chassis cell lists its classes');
  ok(eq(compatClasses(' wpn_0 , cms_0 '), ['wpn_0', 'cms_0']), 'the classes are trimmed');
  ok(eq(compatClasses('?rct_0'), ['rct_0']) && eq(compatClasses('RCT_0'), ['rct_0']), 'characters outside [a-z0-9_] are dropped (after lower-casing)');
  ok(eq(compatClasses(''), []) && eq(compatClasses(undefined), []), 'an empty cell is no slot');
  const two = parseLookCell('xwing_engine_pos_s01:engine_pos1,xwing_engine_neg_s01:engine_neg1');
  ok(two.length === 2 && two[1].attachment === 'xwing_engine_neg_s01' && two[1].hardpoint === 'engine_neg1', 'a look cell is its attachment:hardpoint pairs');
  ok(parseLookCell('tie_engine_s01:')[0].hardpoint === '' && parseLookCell('tie_engine_s01')[0].hardpoint === '', "an empty or absent hardpoint is '' (the hull's origin)");
  const rows = [
    { component: 'b', engine: 'e2:hp' },
    { component: 'a', engine: 'e1:hp' },
    { component: 'c.iff', engine: 'e2:hp' },
    { component: 'd', engine: '' },
    { component: 'z', engine: 'e3:hp' },
  ];
  const g = groupLooks(rows, 'engine');
  ok(g.length === 3 && g[0].cell === 'e2:hp' && eq(g[0].names, ['b', 'c']) && g[1].cell === 'e1:hp', 'identical cells group in first-seen order, their names in table order and keyed');
  const only = groupLooks(rows, 'engine', (n: string) => n !== 'z');
  ok(only.length === 2 && !only.some((l: { cell: string }) => l.cell === 'e3:hp'), 'accept filters names, and a cell only refused names show makes no look');
}

// --- 5. buildSlots, stockPairs ----------------------------------------------------------------------------

// ship_components.iff rows (hidden and duplicate names included), and the weapon table.
const componentRows = [
  { name: 'rct_kessel_mk1', component_type: 'reactor', compatibility: 'rct_0', shared_object_template: 'object/tangible/ship/components/reactor/shared_rct_kessel_mk1.iff' },
  { name: 'rct_seinar_mk1', component_type: 'reactor', compatibility: 'rct_0', shared_object_template: 'object\\tangible\\ship\\components\\reactor\\shared_rct_seinar_mk1.iff' },
  { name: 'eng_corellian_cruiser_grade_mk1', component_type: 'engine', compatibility: 'eng_0', shared_object_template: '' },
  { name: 'eng_incom_fusialthrust', component_type: 'engine', compatibility: 'eng_0', shared_object_template: '' },
  { name: 'eng_novaldex_eventhorizon', component_type: 'engine', compatibility: 'eng_0', shared_object_template: '' },
  { name: 'bst_generic', component_type: 'booster', compatibility: 'bst_0', shared_object_template: '' },
  { name: 'bst_xwing_booster_s01', component_type: 'booster', compatibility: 'bst_0', shared_object_template: '' },
  { name: 'wpn_incom_advanced_blaster', component_type: 'weapon', compatibility: 'wpn_0', shared_object_template: '' },
  { name: 'wpn_awing_blaster', component_type: 'weapon', compatibility: 'wpn_0', shared_object_template: '' },
  { name: 'wpn_light_blaster', component_type: 'weapon', compatibility: 'wpn_0', shared_object_template: '' },
  { name: 'wpn_mining_laser', component_type: 'weapon', compatibility: 'wpn_mining', shared_object_template: '' },
  { name: 'wpn_xwing_missile_s01', component_type: 'weapon', compatibility: 'wpn_1', shared_object_template: '' },
  { name: 'countermeasure_chaff', component_type: 'weapon', compatibility: 'cms_0', shared_object_template: '' },
  { name: 'weapon_test', component_type: 'weapon', compatibility: 'wpn_0', shared_object_template: '' },
  { name: 'armor_test.iff', component_type: 'armor', compatibility: 'arm_0', shared_object_template: '' },
  { name: 'armor_generic.iff', component_type: 'armor', compatibility: 'arm_0', shared_object_template: '' },
  { name: 'mod_xwing_modification_s01', component_type: 'modification', compatibility: 'mod_xwing', shared_object_template: '' },
  { name: 'wpn_star_destroyer_turret_med', component_type: 'weapon', compatibility: 'wpn_sd', shared_object_template: '' },
  { name: 'wpn_light_blaster', component_type: 'weapon', compatibility: 'wpn_0', shared_object_template: '' },
  { name: 'bdg_generic', component_type: 'bridge', compatibility: 'bdg_0', shared_object_template: '' },
];
const weaponRows: Record<string, Record<string, number | string>> = {
  wpn_incom_advanced_blaster: { name: 'wpn_incom_advanced_blaster', projectile_index: 4, range: 512, speed: 600, ammo_required: 0, missile: 0, countermeasure: 0, mining: 0, tractor: 0, beam: 0 },
  wpn_awing_blaster: { name: 'wpn_awing_blaster', projectile_index: 3, range: 512, speed: 600, ammo_required: 0, missile: 0, countermeasure: 0, mining: 0, tractor: 0, beam: 0 },
  wpn_light_blaster: { name: 'wpn_light_blaster', projectile_index: 4, range: 512, speed: 600, ammo_required: 0, missile: 0, countermeasure: 0, mining: 0, tractor: 0, beam: 0 },
  wpn_mining_laser: { name: 'wpn_mining_laser', projectile_index: 9, range: 256, speed: 400, ammo_required: 0, missile: 0, countermeasure: 0, mining: 1, tractor: 0, beam: 1 },
  wpn_xwing_missile_s01: { name: 'wpn_xwing_missile_s01', projectile_index: 20, range: 512, speed: 350, ammo_required: 1, missile: 1, countermeasure: 0, mining: 0, tractor: 0, beam: 0 },
  countermeasure_chaff: { name: 'countermeasure_chaff', projectile_index: 30, range: 0, speed: 0, ammo_required: 1, missile: 0, countermeasure: 1, mining: 0, tractor: 0, beam: 0 },
  weapon_test: { name: 'weapon_test', projectile_index: 1, range: 1, speed: 1, ammo_required: 0, missile: 0, countermeasure: 0, mining: 0, tractor: 0, beam: 0 },
};
const labels: Record<string, string> = { wpn_incom_advanced_blaster: 'Incom Advanced Blaster', wpn_awing_blaster: 'Standard A-Wing Blasters' };
const components = componentList(componentRows, { labelOf: (n: string) => labels[n] ?? null, weaponRow: (n: string) => weaponRows[n] ?? null });
const idx = (n: string) => components.findIndex((c: { name: string }) => c.name === n);

{
  ok(!components.some((c: { name: string }) => HIDDEN_COMPONENT.test(c.name)) && idx('armor_generic') >= 0 && idx('armor_test') < 0, 'components.json leaves out test components, and keys names without .iff');
  ok(components.filter((c: { name: string }) => c.name === 'wpn_light_blaster').length === 1, 'a name listed twice is one component');
  const inc = components[idx('wpn_incom_advanced_blaster')];
  ok(inc.label === 'Incom Advanced Blaster' && inc.type === 'weapon' && inc.compat === 'wpn_0' && eq(inc.weapon, { projectile: 4, speed: 600, range: 512 }), 'a gun carries its label, type, class and its bolt: projectile, speed and range');
  ok(eq(components[idx('wpn_xwing_missile_s01')].weapon, { projectile: 20, speed: 350, range: 512, missile: 1 }) && components[idx('countermeasure_chaff')].weapon.countermeasure === 1 && components[idx('wpn_mining_laser')].weapon.mining === 1 && components[idx('wpn_mining_laser')].weapon.beam === 1, "a missile, countermeasures and a mining beam say what they are");
  ok(components[idx('bdg_generic')].label === 'Bridge (generic)' && !('weapon' in components[idx('bdg_generic')]), 'a component with no string is named for its type and key; a component not in the weapon table has no weapon');
  ok(components[idx('rct_seinar_mk1')].template === 'object/tangible/ship/components/reactor/shared_rct_seinar_mk1.iff', 'the shared template is written with forward slashes');
  ok(componentWeapon(null) === null, 'no weapon row, no weapon');
}

const chassisRow: Record<string, string> = {
  name: 'player_xwing', reactor: 'rct_0', engine: 'eng_0', shield_0: '', booster: 'bst_0', droid_interface: 'ddi_0',
  modification_0: 'mod_xwing', weapon_0: 'wpn_0', weapon_1: 'wpn_0', weapon_2: '', weapon_3: 'wpn_1', weapon_4: 'cms_0', bridge: '',
};
const slotNames = ['reactor', 'engine', 'shield_0', 'booster', 'droid_interface', 'bridge', 'modification_0', 'weapon_0', 'weapon_1', 'weapon_2', 'weapon_3', 'weapon_4'];
// The looks table: its columns in its own order (booster before engine), a mining laser the gun slots refuse,
// a test gun, and a column the chassis row gives no class (a fixed part).
const hullTable = {
  columns: ['component', 'booster', 'engine', 'weapon_0', 'weapon_1', 'modification_0', 'weapon_9'],
  rows: [
    { component: 'eng_corellian_cruiser_grade_mk1', booster: '', engine: 'xwing_engine_pos_s01:engine_pos1,xwing_engine_neg_s01:engine_neg1', weapon_0: '', weapon_1: '', modification_0: '', weapon_9: '' },
    { component: 'eng_novaldex_eventhorizon', booster: '', engine: 'xwing_engine_pos_s02:engine_pos1,xwing_engine_neg_s02:engine_neg1', weapon_0: '', weapon_1: '', modification_0: '', weapon_9: '' },
    { component: 'eng_incom_fusialthrust', booster: '', engine: 'xwing_engine_pos_s01:engine_pos1,xwing_engine_neg_s01:engine_neg1', weapon_0: '', weapon_1: '', modification_0: '', weapon_9: '' },
    { component: 'bst_generic', booster: 'xwing_booster_pos_s01:booster_pos1', engine: '', weapon_0: '', weapon_1: '', modification_0: '', weapon_9: '' },
    { component: 'bst_xwing_booster_s01', booster: 'xwing_booster_pos_s01:booster_pos1', engine: '', weapon_0: '', weapon_1: '', modification_0: '', weapon_9: '' },
    { component: 'wpn_awing_blaster', booster: '', engine: '', weapon_0: 'xwing_weapon_s02:weapon1_pos1', weapon_1: 'xwing_weapon_s02:weapon1_neg1', modification_0: '', weapon_9: '' },
    { component: 'wpn_incom_advanced_blaster', booster: '', engine: '', weapon_0: 'xwing_weapon_s01:weapon1_pos1', weapon_1: 'xwing_weapon_s01:weapon1_neg1', modification_0: '', weapon_9: '' },
    { component: 'wpn_light_blaster', booster: '', engine: '', weapon_0: 'xwing_weapon_s01:weapon1_pos1', weapon_1: '', modification_0: '', weapon_9: '' },
    { component: 'weapon_test', booster: '', engine: '', weapon_0: 'xwing_weapon_s03:weapon1_pos1', weapon_1: 'xwing_weapon_s03:weapon1_neg1', modification_0: '', weapon_9: '' },
    { component: 'wpn_mining_laser', booster: '', engine: '', weapon_0: 'xwing_mining_s01:weapon1_pos1', weapon_1: '', modification_0: '', weapon_9: '' },
    { component: 'mod_xwing_modification_s01', booster: '', engine: '', weapon_0: '', weapon_1: '', modification_0: 'xwing_strake_s01:', weapon_9: '' },
    { component: 'wpn_star_destroyer_turret_med', booster: '', engine: '', weapon_0: '', weapon_1: '', modification_0: '', weapon_9: 'sd_turret_med_base:turret9' },
  ],
};
const slots = buildSlots(chassisRow, slotNames, hullTable, components);
const slotOf = (s: string) => slots.find((x: { slot: string }) => x.slot === s);

{
  ok(eq(slots.map((s: { slot: string }) => s.slot), ['reactor', 'engine', 'booster', 'droid_interface', 'modification_0', 'weapon_0', 'weapon_1', 'weapon_3', 'weapon_4', 'weapon_9']), 'the slots follow the chassis columns, empty cells are no slot, and the fixed column comes last');
  const engine = slotOf('engine');
  ok(engine.looks.length === 2 && eq(engine.looks[0].components, [idx('eng_corellian_cruiser_grade_mk1'), idx('eng_incom_fusialthrust')]) && eq(engine.looks[1].components, [idx('eng_novaldex_eventhorizon')]), 'identical cells group into one look, with the right component indices');
  ok(engine.looks[0].pairs.length === 2 && engine.looks[0].pairs[0].hardpoint === 'engine_pos1' && eq(engine.compat, ['eng_0']), 'a look keeps its pairs, and the slot its classes');
  const gun = slotOf('weapon_0');
  ok(!gun.looks.some((l: { components: number[] }) => l.components.includes(idx('wpn_mining_laser'))) && !gun.looks.some((l: { cell: string }) => /mining/.test(l.cell)), 'a component the table lists but the slot refuses (a mining laser in a wpn_0 slot) is in no look');
  ok(!gun.looks.some((l: { cell: string }) => /s03/.test(l.cell)), 'a test gun makes no look');
  ok(eq(slotOf('reactor').looks, []) && eq(slotOf('weapon_3').looks, []), 'a slot with no column in the looks table has no looks');
  const fixed = slotOf('weapon_9');
  ok(fixed.fixed === true && eq(fixed.compat, []) && fixed.looks.length === 1 && eq(fixed.looks[0].components, [idx('wpn_star_destroyer_turret_med')]), 'a looks column the chassis row lacks is a fixed slot with its one look');
  ok(buildSlots(chassisRow, slotNames, null, components).every((s: { looks: unknown[]; fixed?: boolean }) => !s.looks.length && !s.fixed), 'with no looks table every slot is listed with no looks and nothing is fixed');
  ok(modalLook(engine) === 0 && modalLook(slotOf('reactor')) === -1, 'the modal look is the one the most components show');
  ok(lookOfComponent(engine, idx('eng_novaldex_eventhorizon')) === 1 && lookOfComponent(engine, idx('rct_seinar_mk1')) === -1 && lookOfComponent(engine, -1) === -1, "a component's look on a slot, or -1");
}

// --- 6. pickStock (with the modification rule), 7. hullTokens ---------------------------------------------------

const projectileOf = (n: string) => weaponRows[n]?.projectile_index;
{
  const t = hullTokens('player_tieinterceptor_imperial_guard');
  ok(t.includes('tie') && t.includes('tieinterceptor') && !t.includes('player'), "hullTokens gives the chassis' own words, and tie when a word starts with it");
  ok(!hullTokens('player_blacksun_light_s01').includes('s01') && hullTokens('player_blacksun_light_s01').includes('blacksun'), 'style words are not hull words');
  ok(CRAFT_TOKENS.includes('xwing') && SPECIAL_COMPONENT.test('shd_generic') && SPECIAL_COMPONENT.test('eng_kessel_reward') && !SPECIAL_COMPONENT.test('wpn_incom_advanced_blaster'), 'the craft words and the special pattern');
  const xw = { tokens: hullTokens('player_xwing') };
  // One look whose only component is generic: taken (the Star Destroyer's shield towers).
  const shdComps = [...components, { name: 'shd_generic', compat: 'shd_0' }];
  ok(pickStock({ slot: 'shield_0', compat: ['shd_0'], looks: [{ components: [shdComps.length - 1] }] }, shdComps, { tokens: hullTokens('player_star_destroyer') }) === 'shd_generic', 'a one-look slot whose only component is generic takes it');
  // The corvette: the preferred gun has no cell, so the modal look's best-ranked, not the preferred one.
  const corv = [...components, { name: 'wpn_corvette_turret_reward', compat: 'wpn_0' }, { name: 'wpn_corvette_turret_sm_s01', compat: 'wpn_0' }];
  const corvProj = (n: string) => (/corvette/.test(n) ? 0 : projectileOf(n));
  ok(pickStock({ slot: 'weapon_0', compat: ['wpn_0'], looks: [{ components: [corv.length - 2, corv.length - 1] }] }, corv, { tokens: hullTokens('player_corvette'), preferName: 'wpn_light_blaster', preferProjectile: 4, weaponOf: corvProj }) === 'wpn_corvette_turret_sm_s01', "a weapon slot whose preferred gun has no cell takes the modal look's best-ranked component");
  const awingFirst = { slot: 'weapon_1', compat: ['wpn_0'], looks: [{ components: [idx('wpn_awing_blaster'), idx('wpn_incom_advanced_blaster')] }] };
  ok(pickStock(awingFirst, components, xw) === 'wpn_incom_advanced_blaster', 'a component naming another craft ranks after a plain one (A-wing blasters against the Incom blaster on the X-wing)');
  ok(pickStock(slotOf('booster'), components, xw) === 'bst_xwing_booster_s01', 'a hull-named component ranks first, ahead of a generic one earlier in the table');
  ok(pickStock(slotOf('weapon_0'), components, { ...xw, preferName: 'wpn_light_blaster', preferProjectile: 4, weaponOf: projectileOf }) === 'wpn_light_blaster', 'the preferred gun is taken when the modal look shows it');
  ok(pickStock(slotOf('weapon_0'), components, { ...xw, preferName: 'wpn_awing_blaster', preferProjectile: 3, weaponOf: projectileOf }) === 'wpn_incom_advanced_blaster', 'a preferred gun outside the modal look is not; the modal look is kept');
  const sameRank = { slot: 'weapon_1', compat: ['wpn_0'], looks: [{ components: [idx('wpn_light_blaster'), idx('wpn_incom_advanced_blaster')] }] };
  ok(pickStock(sameRank, components, { tokens: [], preferProjectile: 3, weaponOf: projectileOf }) === 'wpn_light_blaster' && pickStock({ ...sameRank, looks: [{ components: [idx('wpn_awing_blaster'), idx('wpn_light_blaster')] }] }, components, { tokens: ['awing', 'light'], preferProjectile: 4, weaponOf: projectileOf }) === 'wpn_light_blaster', "ties go to table order, and a gun firing the preferred projectile ranks ahead");
  ok(pickStock(slotOf('weapon_9'), components, xw) === 'wpn_star_destroyer_turret_med', 'a fixed slot takes its first component');
  ok(pickStock(slotOf('modification_0'), components, xw) === null && STOCK_LEFT_OUT.test('modification_0'), 'a modification slot has no stock part: it starts empty');
  const withTest = [...components, { name: 'weapon_test', compat: 'wpn_0' }];
  ok(pickStock({ slot: 'weapon_2', compat: ['wpn_0'], looks: [{ components: [withTest.length - 1] }] }, withTest, { tokens: ['test'] }) === null && pickStock({ slot: 'weapon_2', compat: ['wpn_0'], looks: [] }, withTest, { tokens: ['weapon', 'test'] }) !== 'weapon_test', 'a test name is never stock, whatever its rank');
  ok(pickStock(slotOf('reactor'), components, xw) === 'rct_seinar_mk1', 'a slot with no looks takes the best-ranked compatible component (a Kessel reward ranks last)');
  ok(pickStock(slotOf('droid_interface'), components, xw) === null, 'no compatible component gives null');
  ok(pickStock(slotOf('weapon_3'), components, xw) === 'wpn_xwing_missile_s01' && pickStock(slotOf('weapon_4'), components, xw) === 'countermeasure_chaff', 'the launcher and countermeasure slots take their only components');
}

{
  const xw = { tokens: hullTokens('player_xwing'), preferName: 'wpn_light_blaster', preferProjectile: 4, weaponOf: projectileOf };
  for (const s of slots) s.stock = pickStock(s, components, /^weapon_/.test(s.slot) ? xw : { tokens: xw.tokens });
  const pairs = stockPairs(slots, components, hullTable.columns);
  ok(eq(pairs.map((p: { slot: string }) => p.slot), ['booster', 'engine', 'engine', 'weapon_0', 'weapon_1', 'weapon_9']), "the stock parts come in the looks table's column order, a slot's pairs in cell order, the modification left out");
  ok(eq(pairs[1], { slot: 'engine', attachment: 'xwing_engine_pos_s01', hardpoint: 'engine_pos1' }) && pairs[3].attachment === 'xwing_weapon_s01' && pairs[4].attachment === 'xwing_weapon_s02', "each is the stock component's look (weapon_1's two one-gun looks tie, and the first seen wins)");
  // The stock look is the look the most compatible components show, which is the cell the most rows
  // show (the modification columns left out) on this table as on every retail hull.
  const w3 = modalLooks(hullTable).flatMap((l: { slot: string; pairs: { attachment: string; hardpoint: string }[] }) => l.pairs.map((p) => ({ slot: l.slot, ...p })));
  ok(eq(pairs, w3), 'the stock parts are the modal cells the assembly hung before');
  ok(stockPairs([{ slot: 'reactor', stock: 'rct_seinar_mk1', looks: [] }], components, hullTable.columns).length === 0, 'a stock component with no model on the hull hangs nothing');
  const fitted = { slots };
  ok(eq(stockWeapon(fitted, components), { name: 'wpn_light_blaster', projectile: 4, speed: 600, range: 512 }), 'the gun the ship fires is its first weapon slot\'s stock bolt');
  const launcherFirst = { slots: [{ slot: 'weapon_0', stock: 'wpn_xwing_missile_s01' }, { slot: 'weapon_1', stock: 'countermeasure_chaff' }, { slot: 'weapon_2', stock: 'wpn_mining_laser' }, { slot: 'weapon_3', stock: 'wpn_awing_blaster' }] };
  ok(stockWeapon(launcherFirst, components)?.name === 'wpn_awing_blaster', 'missiles, countermeasures and beams are passed over');
  ok(stockWeapon({ slots: [{ slot: 'engine', stock: 'eng_incom_fusialthrust' }] }, components) === null && stockWeapon(null, components) === null, 'no stock bolt, no weapon');
}

// --- 8. fallbackLabel -------------------------------------------------------------------------------------------

ok(fallbackLabel('wpn_corvette_turret_sm_s01', 'weapon') === 'Weapon (corvette turret sm s01)', "a component with no string: 'Weapon (corvette turret sm s01)'");
ok(fallbackLabel('ddi_basic', 'droid_interface') === 'Droid interface (basic)', 'the type is written in words');

// --- 9-11. Paint: isPaintShader, mergePaintVariables, trimPaintShader, paintGlow; recipes ---------------------------

// A fake archive with a four-pass effect (MAIN, then HUEB, then SPEC; CNRM and EMIS read by no stage)
// and customizable shaders built as the client's are.
const files = new Map<string, Buffer>();
const put = (p: string, b: Uint8Array) => files.set(p.toLowerCase(), Buffer.from(b));
const vfs = { has: (p: string) => files.has(p.toLowerCase().replace(/\\/g, '/')), read: (p: string) => files.get(p.toLowerCase().replace(/\\/g, '/'))!, list: () => [...files.keys()] };
const tag = (w: W, s: string) => { for (const ch of [...s].reverse()) w.u8(ch.charCodeAt(0)); return w; };
const stage = (tex: string) => form('STAG', chunk('0001', tag(tag(new W().u8(3).u8(0).u8(0).u8(0).u8(4).u8(0).u8(0).u8(1).u8(0).u8(0).u8(2).u8(0).u8(0).u8(4).u8(0).u8(0).u8(0).u8(0), tex), tex).u8(0).bytes()));
const passData = (blend: number) => tag(tag(tag(new W().i8(1).i8(0).i8(0).u8(1).u8(1).u8(1).i8(0).u8(blend).i8(0).i8(4).i8(5).u8(0), 'A000').i8(7).u8(15), 'TFAC'), 'TFA2').bytes();
const pass = (tex: string, blend = 0) => form('PASS', form('0009', chunk('DATA', passData(blend)), stage(tex)));
put('effect/h_color2w_specmap.eft', encode(form('EFCT', form('0001', form('IMPL', form('0000', pass('MAIN'), pass('HUEB', 1), pass('SPEC', 1)))))));
const txm = (slot: string, path: string) => form('TXM ', form('0001', chunk('DATA', tag(new W(), slot).u8(0).u8(0).u8(0).bytes()), chunk('NAME', new W().str(path).bytes())));
const sshtForm = (effect: string, textures: [string, string][]) => form('SSHT', form('0001', chunk('NAME', new W().str(effect).bytes()), form('TXMS', ...textures.map(([s, p]) => txm(s, p)))));
const tx1d = (slot: string, base: number, count: number, variable: string, def: number) => chunk('TX1D', tag(new W(), slot).i16(base).i16(count).str(variable).u8(0).i16(def).bytes());
const pal = (variable: string, slot: string, palette: string, def: number) => chunk('PAL ', tag(new W().str(variable).u8(0), slot).str(palette).i32(def).bytes());
function cshd(effect: string, patterns: number, defaults: { tex: number; c1: number; c2: number }, palette2 = 'palette/starships_general.pal', palette1 = 'palette/starships_general.pal') {
  const list: string[] = [];
  for (let i = 1; i <= patterns; i++) list.push(`texture/hull_s0${i}b.dds`);
  for (let i = 1; i <= patterns; i++) list.push(`texture/hull_s0${i}a.dds`);
  const txtrData = new W().i16(list.length);
  for (const f of list) txtrData.str(f);
  return encode(form('CSHD', form('0001',
    sshtForm(effect, [['CNRM', 'texture/hull_n.dds'], ['HUEB', 'texture/hull_s08b.dds'], ['MAIN', 'texture/hull_s08a.dds'], ['SPEC', 'texture/hull_spec.dds'], ['EMIS', 'texture/hull_emis.dds']]),
    form('TXTR', chunk('DATA', txtrData.bytes()), form('CUST', tx1d('HUEB', 0, patterns, 'index_texture_1', defaults.tex), tx1d('MAIN', patterns, patterns, 'index_texture_1', defaults.tex))),
    form('TFAC', pal('index_color_1', 'MAIN', palette1, defaults.c1), pal('index_color_2', 'HUEB', palette2, defaults.c2)),
  )));
}
put('shader/hull_main.sht', cshd('effect/h_color2w_specmap.eft', 8, { tex: 0, c1: 40, c2: 13 }));
put('shader/hull_wing.sht', cshd('effect/h_color2w_specmap.eft', 2, { tex: 1, c1: 7, c2: 13 }, 'palette/starships_trim.pal'));
put('shader/holo.sht', cshd('effect/h_color2w_specmap.eft', 2, { tex: 0, c1: 1, c2: 1 }, 'palette/hologram_blue.pal', 'palette/hologram_blue.pal'));
put('shader/no_effect.sht', cshd('effect/missing.eft', 2, { tex: 0, c1: 1, c2: 1 }));
put('shader/static.sht', encode(sshtForm('effect/h_color2w_specmap.eft', [['MAIN', 'texture/plain.dds']])));
const ctx = renderContext();
const load = (p: string) => loadShader(vfs, p, ctx);

{
  const hull = load('shader/hull_main.sht');
  ok(isPaintShader(hull), 'a customizable shader with starships palettes and a fixed-function effect is paint');
  ok(!isPaintShader(load('shader/holo.sht')), 'one that colours with a hologram palette is not');
  ok(!isPaintShader(load('shader/static.sht')), 'a shader without variables is not');
  ok(!isPaintShader(load('shader/no_effect.sht')) && !isPaintShader(null), 'nor is one without an effect the bake can run');

  const sizes: Record<string, number> = { 'palette/starships_general.pal': 64, 'palette/starships_trim.pal': 64 };
  const merged = mergePaintVariables([{ path: 'shader/hull_main.sht', variables: hull.variables }, { path: 'shader/hull_wing.sht', variables: load('shader/hull_wing.sht').variables }], (p: string) => sizes[p] ?? 0);
  const v = Object.fromEntries(merged.variables.map((x: { name: string }) => [x.name, x]));
  ok(eq(merged.variables.map((x: { name: string }) => x.name), ['index_texture_1', 'index_color_1', 'index_color_2']), 'one variable list for the hull, the pattern first and then the colours, each once');
  const swapped = mergePaintVariables([{ path: 'shader/yt.sht', variables: [
    { name: 'index_texture_1', kind: 'int', max: 4, default: 0 },
    { name: '/shared_owner/index_color_2', kind: 'palette', palette: 'palette/starships_general.pal', default: 3 },
    { name: 'index_color_10', kind: 'palette', palette: 'palette/starships_general.pal', default: 5 },
    { name: 'index_color_1', kind: 'palette', palette: 'palette/starships_general.pal', default: 2 },
    { name: 'index_texture_0', kind: 'int', max: 2, default: 0 },
  ] }], (p: string) => sizes[p] ?? 0);
  ok(eq(swapped.variables.map((x: { name: string }) => x.name), ['index_texture_0', 'index_texture_1', 'index_color_1', '/shared_owner/index_color_2', 'index_color_10']), "the order does not follow a shader's TFAC order (the YT-1300's names colour 2 first): patterns, then colours, by the name's last part, numbers as numbers");
  ok(eq(v.index_texture_1, { name: 'index_texture_1', kind: 'index', count: 8, fewest: 2, default: 0 }), 'pattern counts 8 and 2 merge to count 8, fewest 2, and the default is the first shader\'s');
  ok(eq(v.index_color_1, { name: 'index_color_1', kind: 'palette', palette: 'palette/starships_general.pal', size: 64, default: 40 }), 'a palette variable has its palette, its size and the first default');
  ok(v.index_color_2.palette === 'palette/starships_general.pal' && merged.notes.length === 1 && /starships_trim/.test(merged.notes[0]), 'a second palette for the same variable is kept out and noted');

  const glow = paintGlow({ emissive: { kind: 'mask', slot: 'EMIS', channel: 'a' }, mainSlot: 'MAIN' });
  ok(eq(glow, { maskTag: 'EMIS', channel: 'a', keepAlpha: true }), "a glow by another slot's mask keeps the texture's alpha in the lit image");
  ok(eq(paintGlow({ emissive: { kind: 'mask', slot: 'MAIN', channel: 'a' }, mainSlot: 'MAIN' }), { maskTag: 'MAIN', channel: 'a', keepAlpha: false }) && paintGlow({ emissive: { kind: 'full' } }) === null && paintGlow(null) === null, "a glow by the main's own alpha does not; an unlit or unglowing shader has no glow");

  const t = trimPaintShader(hull, { keep: [glow!.maskTag] });
  ok(!t.shader.textureFiles.has('CNRM') && !t.shader.textureFiles.has('MAIN') && !t.shader.textureFiles.has('HUEB'), "the trimmed shader drops CNRM (no stage reads it) and the static MAIN and HUEB (every choice replaces them)");
  ok(t.shader.textureFiles.get('SPEC') === 'texture/hull_spec.dds' && t.shader.textureFiles.get('EMIS') === 'texture/hull_emis.dds', "SPEC is kept, and the glow's mask although no fixed-function stage reads it");
  ok(!trimPaintShader(hull).shader.textureFiles.has('EMIS'), 'without the glow the mask goes too');
  ok(t.shader.textureChoices.length === 2 && hull.textureFiles.has('CNRM') && hull.textureFiles.get('MAIN') === 'texture/hull_s01a.dds', 'the choices stay, and the loaded shader is not changed (its MAIN is the default pattern)');
  ok(trimPaintShader(hull, { staticMain: 'texture/hull_s08a.dds' }).staticMain === 'texture/hull_s08a.dds' && trimPaintShader(hull).staticMain === null && trimPaintShader(load('shader/static.sht')).staticMain === 'texture/plain.dds', "staticMain is the static shader's own MAIN as given; without it, the MAIN no choice replaces");

  // What the recipe carries: the trimmed textures, every choice's files, and the palettes.
  const written: string[] = [];
  const registry = new ImageRegistry((id: string) => written.push(id));
  const img = () => ({ width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]) });
  const shader = exportShader(t.shader, registry, img);
  ok(eq(Object.keys(shader.textures).sort(), ['EMIS', 'SPEC']) && shader.choices.length === 2 && shader.choices[1].files.length === 8 && shader.palettes.length === 2, 'the exported recipe binds SPEC and the mask, and lists every pattern and palette');
  const recipe = { mesh: 'ship', material: 'shader/hull_main.sht', kind: 'bake', baseTag: 'MAIN', shader, slots: [], staticMain: registry.idFor('texture/hull_s08a.dds', img()), glow };
  const images = recipeImages([recipe]);
  ok(images.size === written.length && written.every((w) => images.has(w)), 'recipeImages names every image a recipe reads, the static main included');
  const other = { ...recipe, material: 'shader/hull_wing.sht' };
  const renewed = { ...recipe, staticMain: 'new.png' };
  const m = mergeRecipes([recipe, other], [renewed, { ...recipe, material: 'shader/new.sht' }]);
  ok(m.length === 3 && m[0] === renewed && m[1] === other && m[2].material === 'shader/new.sht', 'a --match run keeps the other materials, replaces the same one in place and adds the new');
}

// --- The paint bake as the ships command hands it to surfaceTexture: colour baked, alpha the pattern's ------------

{
  // The bake is opaque (its alpha is the first pass's); the chosen pattern's MAIN carries the gloss mask.
  const chosen = { width: 2, height: 1, rgba: new Uint8Array([10, 20, 30, 0, 40, 50, 60, 200]) };
  const baked = () => ({ width: 2, height: 1, rgba: new Uint8Array([100, 110, 120, 255, 130, 140, 150, 255]), hasAlpha: false });
  const w = withPatternAlpha(baked(), chosen);
  ok(eq([...w.rgba], [100, 110, 120, 0, 130, 140, 150, 200]) && !('hasAlpha' in w), "the bake keeps its colour and takes the chosen pattern's alpha, and says nothing of hasAlpha so the reader reads the pixels");
  ok(eq([...withPatternAlpha(baked(), { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]) }).rgba], [...baked().rgba]) && eq([...withPatternAlpha(baked(), null).rgba], [...baked().rgba]), 'a pattern of another size, or none, leaves the bake as it is');
  const paintShader = { effect: { passes: [{}] }, variables: [{ name: 'index_texture_1', kind: 'int', max: 2, default: 0 }], paletteFactors: [], textures: new Map([['MAIN', chosen]]), textureFiles: new Map([['MAIN', 'texture/hull_s01a.dds']]) };
  const bakes: string[] = [];
  const bake = (_s: unknown, tag: string) => { bakes.push(tag); return baked(); };
  const p = paintedMainImage(paintShader, 'shader/hull_main.sht', bake);
  ok(p?.path === 'texture/hull_s01a.dds#paint:shader/hull_main.sht' && eq([...p.rgba], [100, 110, 120, 0, 130, 140, 150, 200]) && bakes.join() === 'MAIN', "a paint shader's main is its MAIN bake, named for the chosen pattern and the shader, with the pattern's alpha (its gloss mask survives the bake)");
  ok(paintedMainImage({ ...paintShader, variables: [] }, 'shader/static.sht', bake) === null && paintedMainImage(null, 'shader/x.sht', bake) === null && paintedMainImage(paintShader, 'shader/hull_main.sht', () => null) === null && bakes.length === 1, 'a shader that is not paint is never baked, and a bake with nothing to bake gives no image');
}

// --- Droids -------------------------------------------------------------------------------------------------------

{
  const templates = ['object/ship/player/shared_player_xwing.iff', 'object/ship/player/shared_player_naboo_n1.iff'];
  const heads = droidHeadRows([
    { ship: 'shared_player_naboo_n1.iff', ground_appearance: 'appearance/astromech_r2.sat', space_appearance: 'appearance/astromech_r2_n1ship_head.apt' },
    { ship: 'object/ship/player/shared_player_naboo_n1.iff', ground_appearance: 'appearance\\astromech_r3.sat', space_appearance: 'appearance/astromech_r3_n1ship_head.apt' },
    { ship: 'shared_player_missing.iff', ground_appearance: 'appearance/astromech_r4.sat', space_appearance: 'appearance/astromech_r4_n1ship_head.apt' },
  ], templates, shipLabelOf);
  ok(eq(heads.get('appearance/astromech_r2.sat'), [{ ship: 'naboo_n1', appearance: 'appearance/astromech_r2_n1ship_head.apt' }]) && heads.has('appearance/astromech_r3.sat') && !heads.has('appearance/astromech_r4.sat'), "the override table's heads by ground appearance, for the ships in the pack, matched by file name");
  const appearances: Record<string, string> = {
    'object/intangible/pet/shared_r2_crafted.iff': 'appearance/astromech_r2.sat',
    'object/intangible/pet/shared_r2.iff': 'appearance/astromech_r2.sat',
    'object/intangible/pet/shared_r3.iff': 'appearance/astromech_r3.sat',
    'object/intangible/pet/shared_r2d2.iff': 'appearance/r2d2.sat',
  };
  const strings: Record<string, string> = { 'space/space_item:navicomputer_1_n': 'v1 Flight Computer', 'mob/creature_names:r2': 'an R2 unit', 'mob/creature_names:r3': 'an R3 unit' };
  const { droids, notes } = buildDroids([
    'object/intangible/ship/shared_navicomputer_1.iff', 'object/intangible/ship/shared_navicomputer_2.iff',
    'object/intangible/pet/shared_r2_crafted.iff', 'object/intangible/pet/shared_r2.iff', 'object/intangible/pet/shared_r3.iff', 'object/intangible/pet/shared_r2d2.iff',
  ], {
    appearanceOf: (t: string) => appearances[t] ?? null,
    localize: (id: string) => strings[id] ?? null,
    hasModel: (p: string) => /astromech_r[23]\.glb$/.test(p),
    headsFor: (app: string) => Object.fromEntries((heads.get(app) ?? []).map((h: { ship: string; appearance: string }) => [h.ship, `ships/${h.appearance.replace(/^.*\//, '').replace(/\.apt$/, '')}.glb`])),
  });
  ok(eq(droids.map((d: { id: string }) => d.id), ['navicomputer_1', 'navicomputer_2', 'r2', 'r3']), 'the flight computers, then each astromech once (the crafted and plain templates share an appearance)');
  ok(eq(droids[0], { id: 'navicomputer_1', kind: 'computer', label: 'v1 Flight Computer', model: null }) && droids[1].label === 'Flight computer (2)', 'a flight computer is named by its string and has no model');
  ok(eq(droids[2], { id: 'r2', kind: 'astromech', label: 'R2 unit', model: 'mobiles/models/astromech_r2.glb', heads: { naboo_n1: 'ships/astromech_r2_n1ship_head.glb' } }), 'an astromech is named without its article, drawn as the mobiles pack\'s model, with its N-1 head');
  ok(notes.length === 1 && /r2d2/.test(notes[0]) && /not in the pack/.test(notes[0]), 'a droid whose model the pack lacks is left out with a note (R2-D2)');
}

// --- The manifest, the log and status ------------------------------------------------------------------------------

{
  const fit = {
    chassis: 'player_xwing', openSpeedFactor: 0.95, droid: 'astromech',
    slots: [
      { slot: 'engine', compat: ['eng_0'], looks: [{ parts: [{ file: 'xwing_engine_pos_s01.glb', hardpoint: 'engine_pos1', template: 't' }], components: [2] }, { parts: [{ file: 'xwing_engine_pos_s02.glb', hardpoint: 'engine_pos1', template: 't' }], components: [4] }], stock: 'eng_corellian_cruiser_grade_mk1' },
      { slot: 'reactor', compat: ['rct_0'], looks: [], stock: 'rct_seinar_mk1' },
      { slot: 'weapon_9', compat: [], looks: [{ parts: [{ file: 'sd_turret_med_base.glb', hardpoint: 'turret9', template: 't' }], components: [16] }], stock: 'wpn_star_destroyer_turret_med', fixed: true },
    ],
    paint: { shaders: ['shader/hull_main.sht'], variables: [{ name: 'index_texture_1', kind: 'index', count: 8, fewest: 2, default: 0 }, { name: 'index_color_1', kind: 'palette', palette: 'p', size: 64, default: 40 }] },
  };
  ok(fitSummary(fit) === 'fit: 2 slots (1 with models, 2 looks), 1 fixed, astromech socket, paint 1 shader (index_texture_1 8/2, index_color_1)', `the log names the slots, looks, fixed parts, droid and paint (${fitSummary(fit)})`);
  ok(fitSummary(null) === 'no fit (no chassis tables)', 'a ship with no tables says so');
  const droids = [{ id: 'navicomputer_1', kind: 'computer' }, { id: 'r2', kind: 'astromech', heads: { naboo_n1: 'x' } }, { id: 'r3', kind: 'astromech', heads: { naboo_n1: 'y' } }];
  const line = loadoutsLine([fit, { ...fit, paint: null, slots: fit.slots.slice(0, 2) }, null], droids, { shaders: 3, images: 12, bytes: 4.2e6 });
  ok(line === 'loadouts: 2 ships (1 fixed slots), 3 part models; droids: 2 astromechs, 1 flight computers, 2 heads (naboo_n1); paint: 1 ships, 3 shaders, 12 images (4 MB)', `the closing line (${line})`);

  const log: string[] = [];
  const built = buildShips(['object/ship/player/shared_player_xwing.iff', 'object/ship/player/shared_player_yacht.iff'], {
    convert: (t: string) => ({ model: shipLabelOf(t), file: `${shipLabelOf(t)}.glb`, bounds: { min: [0, 0, 0], max: [1, 1, 1] } }),
    extrasOf: (t: string) => ({ attachments: [], thrusters: [], contrails: [], cockpit: null, notes: [], chassis: t.includes('xwing') ? 'player_xwing' : null, wingOpenSpeedFactor: 1, fit: t.includes('xwing') ? fit : null }),
    weaponOf: () => null,
  }, { log: (m: string) => log.push(m) });
  const xw = built.ships.find((s: { id: string }) => s.id === 'xwing')!;
  const yacht = built.ships.find((s: { id: string }) => s.id === 'yacht')!;
  ok(xw.fit === fit && !('fit' in yacht), 'buildShips copies the fit onto the ship, and writes none for a ship without one');
  ok(log.some((l) => l.startsWith('xwing:') && l.includes('fit: 2 slots')) && log.some((l) => l.startsWith('yacht:') && l.includes('no fit (no chassis tables)')), 'the log line names the fit');

  const manifest = { fitFormat: SHIP_FIT_FORMAT, ships: [{ chassis: 'player_xwing', fit }, { chassis: 'player_yt1300', fit: { ...fit, paint: null } }, { chassis: null }] };
  ok(eq(fitStatus(manifest, { droids }), { fitted: 2, painted: 1, astromechs: 2, old: 0 }), 'status counts the fitted, the painted and the astromechs; a ship without chassis tables is not old');
  ok(fitStatus({ ...manifest, ships: [...manifest.ships, { chassis: 'player_awing' }] }, null).old === 1, 'a ship with a chassis and no fit (kept by a --match run) is old');
  ok(fitStatus({ ships: manifest.ships }, { droids }).old === 3, 'a manifest without the fit format is old throughout');
}

console.log(`${checks} checks passed`);
