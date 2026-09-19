// The NPC ship converter's pure parts (tools/swg/npcships.mjs): type names, chassis rows, factions and
// taunt tables, the formation, taunt, hit and target tables read through the converter's own parsers
// from synthetic files, and the combat file built from fakes. When the owner's ships pack has a
// combat.json, its shape is checked too (skipped with a note otherwise).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCombat, chassisNameOf, combatCounts, combatLine, combatStatus, COMBAT_FORMAT, factionOf, formationOf, hitEffectsOf, hitSoundsOf, hullFxOf, NOT_LADDER, slotsOf,
  targetRowsOf, tauntsOf, tauntTableOf, typeParts, wordsOf,
} from '../npcships.mjs';
import { parseDatatable, parseStringTable } from '../datatable.mjs';
import { parseIff } from '../iff.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A datatable (DTII > 0001 > COLS, TYPE, ROWS) as the client writes one, for the converter's own parser.
function datatable(columns: string[], types: string[], rows: (string | number)[][]) {
  const cols = new W().i32(columns.length);
  for (const c of columns) cols.str(c);
  const type = new W();
  for (const t of types) type.str(t);
  const body = new W().i32(rows.length);
  rows.forEach((r) => r.forEach((v, i) => (types[i][0] === 'f' ? body.f32(Number(v)) : types[i][0] === 's' ? body.str(String(v)) : body.i32(Number(v)))));
  return parseDatatable(parseIff(Buffer.from(encode(form('DTII', form('0001', chunk('COLS', cols.bytes()), chunk('TYPE', type.bytes()), chunk('ROWS', body.bytes())))))));
}
// A string table (.stf, version 1) with its entries in the order given.
function stringTable(entries: [string, string][]) {
  const b: number[] = [];
  const u32 = (v: number) => b.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  u32(0xabcd);
  b.push(1);
  u32(entries.length + 1);
  u32(entries.length);
  entries.forEach(([, text], i) => {
    u32(i + 1);
    u32(0);
    u32(text.length);
    for (const ch of text) b.push(ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8);
  });
  entries.forEach(([name], i) => {
    u32(i + 1);
    u32(name.length);
    for (const ch of name) b.push(ch.charCodeAt(0));
  });
  return parseStringTable(Buffer.from(b));
}

// Type names.
const bs = typeParts('blacksun_light_s01_tier3');
ok(!!bs && bs.family === 'blacksun_light_s01' && bs.base === 'blacksun_light' && bs.style === 's01' && bs.tier === 3, "a styled type's family, base, style and tier");
ok(same(typeParts('tiefighter_tier1'), { family: 'tiefighter', base: 'tiefighter', style: null, tier: 1 }), 'an unstyled type is its own base');
ok(typeParts('xwing') === null && typeParts('x_tier6') === null && typeParts('x_tier0') === null, 'an untiered id and a tier outside 1 to 5 are not types');

// Chassis rows.
const rowNames = new Set(['blacksun_light_tier1', 'tiefighter_tier2', 'hutt_light_s01_tier1']);
ok(chassisNameOf('blacksun_light_s01_tier1', rowNames) === 'blacksun_light_tier1', 'a styled type reads the row without its style');
ok(chassisNameOf('tiefighter_tier2', rowNames) === 'tiefighter_tier2' && chassisNameOf('hutt_light_s01_tier1', rowNames) === 'hutt_light_s01_tier1', 'an exact row wins');
ok(chassisNameOf('tiefighter_tier3', rowNames) === null && chassisNameOf('blacksun_light_s02_tier4', rowNames) === null, 'no row: null');

// Factions and taunt tables.
ok(factionOf('tiefighter') === 'imperial' && factionOf('tieinterceptor_imperial_guard') === 'imperial', 'the TIEs are Imperial');
ok(factionOf('xwing') === 'rebel' && factionOf('arc170') === 'rebel', 'the lettered wings and the ARC-170 are Rebel');
ok(factionOf('blacksun_heavy_s02') === 'blacksun', 'Black Sun');
ok(factionOf('hutt_light_s01') === 'pirate' && factionOf('z95') === 'pirate' && factionOf('firespray') === 'pirate', 'Hutt hulls, the Z-95 and the Firespray are pirates');
ok(factionOf('jedi_starfighter') === 'neutral' && factionOf('grievous_starship') === 'neutral', 'the rest are neutral');
ok(tauntTableOf('pirate', 'hutt_light_s01', 1) === 'hutt_low' && tauntTableOf('pirate', 'z95', 3) === 'generic' && tauntTableOf('imperial', 'tiefighter', 4) === 'imperial', 'taunt tables by faction and tier');
ok(tauntTableOf('rebel', 'xwing', 2) === 'rebel_low' && tauntTableOf('neutral', 'jedi_starfighter', 5) === 'generic', 'tier 2 reads _low, the neutral read generic');
ok(NOT_LADDER.test('nova_orion_pirate_light') && NOT_LADDER.test('basic_tiefighter') && NOT_LADDER.test('prototype_z95') && NOT_LADDER.test('experimental_ship') && !NOT_LADDER.test('tiefighter'), 'the quest line, basic and prototype families are not the ladder');

// A formation table, read through the converter's datatable parser.
const arrowRows: number[][] = [[0, 0, 0, 0, 0], [25, 25, 25, 25, 25], [-25, 25, -25, -25, -35], [25, -25, -25, 25, -25]];
for (let i = 4; i < 20; i++) arrowRows.push([i * 10, i, -i * 5, i * 10, -i * 6]);
const arrowTable = datatable(['X', 'Y', 'Z', 'X2D', 'Z2D'], ['f', 'f', 'f', 'f', 'f'], arrowRows);
const arrow = formationOf(arrowTable.rows);
ok(arrow.space.length === 20 && arrow.flat.length === 20, 'twenty slots kept');
ok(same(arrow.space[0], [0, 0, 0]) && Object.is(arrow.space[0][0], 0), 'slot 0 is the leader at the origin (no negative zero)');
ok(same(arrow.space[1], [-25, 25, 25]) && arrow.space[1][2] > 0, "X is negated; the arrow's slot 1 is ahead of the leader");
ok(same(arrow.flat[2], [25, 0, -35]) && same(arrow.space[5], [-50, 5, -25]), 'flat is X2D, 0, Z2D, and rows stay in order');

// Taunts, listed out of order, read through the converter's string table parser.
const hutt = stringTable([['gothit2', 'Feeble, pilot.  Feeble!'], ['entercombat2', 'You are a nobody!'], ['death1', 'Nooooo!'], ['entercombat1', 'Fool! I work for the Hutts! We are everywhere!'], ['entercombat10', 'tenth'], ['hityou1', '%TU, you are done, %NU!'], ['other', 'x']]);
const t = tauntsOf(hutt);
ok(same(t.entercombat, ['Fool! I work for the Hutts! We are everywhere!', 'You are a nobody!', 'tenth']), 'entercombat lines in number order (10 after 2)');
ok(t.gothit.length === 1 && t.death[0] === 'Nooooo!' && t.hityou[0] === '%TU, you are done, %NU!', 'each event is grouped, tokens left in');
ok(same(Object.keys(tauntsOf(new Map())), ['entercombat', 'gothit', 'hityou', 'death']) && tauntsOf(new Map()).death.length === 0, 'an empty table has every event, empty');

// A chassis row's slots.
const slotNames = ['reactor', 'engine', 'shield_0', 'shield_1', 'weapon_0', 'weapon_1'];
const row = { name: 'tiefighter_tier1', hit_sound_group: 'tie', reactor: 'rct_0', reactor_hitweight: 10, reactor_targetable: 1, engine: 'eng_0', engine_hitweight: 12, engine_targetable: 1, shield_0: 'shd_0', shield_0_hitweight: 10, shield_0_targetable: 0, shield_1: '', shield_1_hitweight: 10, shield_1_targetable: 0, weapon_0: 'wpn_0, wpn_1', weapon_0_hitweight: 10, weapon_0_targetable: 0, weapon_1: '' };
const slots = slotsOf(row, slotNames);
ok(same(Object.keys(slots), ['reactor', 'engine', 'shield_0', 'weapon_0']), 'empty slot cells are skipped');
ok(slots.engine.hitweight === 12 && slots.engine.targetable === true && slots.shield_0.targetable === false, 'weights and targetable flags are read');
ok(same(slots.weapon_0.compat, ['wpn_0', 'wpn_1']), 'the compatibility list is split');

// The target table: the default row, and only rows that differ.
const target = targetRowsOf([
  { ship_chassis: 'awing', appearance: 'appearance/pt_ui_target_ship.prt', appearance_enemy: 'appearance/pt_ui_target_ship_enemy.prt', scale: 1 },
  { ship_chassis: 'default', appearance: 'appearance\\pt_ui_target_ship.prt', appearance_enemy: 'appearance/pt_ui_target_ship_enemy.prt', scale: 1, effect_hardpoint: '', activate_effect: 'clienteffect/ui_target_select_enable_01.cef', activate_effect_enemy: 'clienteffect/ui_target_select_enable_01.cef', deactivate_effect: 'clienteffect/trap_electric_01.cef', activate_sound: 'sound/ui_all_target_select.snd', deactivate_sound: 'sound/ui_all_target_deselect.snd', target_acquiring_sound: 'sound/ui_all_target_missile_acquire.snd', target_acquired_appearance: 'sound/ui_all_target_missile_locked.snd' },
  { ship_chassis: 'star_destroyer', appearance: 'appearance/pt_ui_target_capship.prt', appearance_enemy: 'appearance/pt_ui_target_ship_enemy.prt', scale: 4 },
], { particle: (p: string) => (p ? `particles/fx_${p.replace(/^.*\//, '').replace(/\.prt$/, '')}.json` : null), effect: (c: string) => (c ? `fx(${c})` : null) });
ok(target.friendly === 'particles/fx_pt_ui_target_ship.json' && target.enemy === 'particles/fx_pt_ui_target_ship_enemy.json', 'the default row is taken whatever its place, its appearances converted');
ok(target.activate === 'fx(clienteffect/ui_target_select_enable_01.cef)' && target.deactivate === 'fx(clienteffect/trap_electric_01.cef)', 'its effects go through the client effect');
ok(target.sounds.acquired === 'sound/ui_all_target_missile_locked.snd' && target.scale === 1 && target.hardpoint === '', 'the sounds, the scale and the hardpoint are read');
ok(same(Object.keys(target.overrides), ['star_destroyer']) && target.overrides.star_destroyer.scale === 4 && target.overrides.star_destroyer.friendly === 'particles/fx_pt_ui_target_capship.json' && !('enemy' in target.overrides.star_destroyer), 'only a row that differs is kept, with the fields that differ');
ok(targetRowsOf([]).friendly === null && targetRowsOf(null).scale === 1, 'no table: nothing to show, scale 1');

// Hit effects and sounds.
const hits = hitEffectsOf([
  { type: 'shield', hit_light: 'clienteffect/cbt_hit_ship_shield_lt.cef', hit_medium: 'clienteffect/cbt_hit_ship_shield_med.cef', hit_heavy: '', event_light: 'clienteffect/cbt_hit_ship_shield_event_lt.cef', event_medium: '', event_heavy: '' },
  { type: 'chassis', hit_light: 'clienteffect/missing.cef', hit_medium: '', hit_heavy: '', event_light: '', event_medium: '', event_heavy: '' },
  { type: 'cargo', hit_light: 'x.cef' },
], (c: string) => (/missing/.test(c) ? null : `fx(${c})`));
ok(same(Object.keys(hits), ['shield', 'chassis']), 'only the four layers are read');
ok(same(hits.shield.hit, ['fx(clienteffect/cbt_hit_ship_shield_lt.cef)', 'fx(clienteffect/cbt_hit_ship_shield_med.cef)', null]) && same(hits.shield.event, ['fx(clienteffect/cbt_hit_ship_shield_event_lt.cef)', null, null]), 'light, medium, heavy in order; an empty cell is null');
ok(hits.chassis.hit[0] === null, 'an effect that does not convert is null');
const sounds = hitSoundsOf([{ type: '', shield: 'sound/cbt_hit_shield.snd', armor: 'sound/a.snd', component: 'sound/c.snd', chassis: 'sound/h.snd' }, { type: 'tie', shield: 'sound\\t.snd', armor: '', component: '', chassis: '' }]);
ok(sounds[''].shield === 'sound/cbt_hit_shield.snd' && sounds.tie.shield === 'sound/t.snd' && sounds.tie.armor === '', 'hit sounds by group, the default group empty-named');

// A hull's damage bands and explosion.
const fx = hullFxOf({ destroyed: 'clienteffect/cbt_explode_xwing.cef', damage: [{ from: 0.25999999046325684, to: 0.25, hardpoint: null, position: [1.5, 0, -4.139999866485596], particle: 'appearance/pt_smoking_thruster_light.prt' }, { from: 0.5, to: 0.8, hardpoint: 'engine1', position: null, particle: 'appearance/missing.prt' }] }, { particle: (p: string) => (/missing/.test(p) ? null : `particles/fx_${p.replace(/^.*\//, '').replace(/\.prt$/, '')}.json`), effect: (c: string) => `fx(${c})` });
ok(fx.destroyed === 'fx(clienteffect/cbt_explode_xwing.cef)' && fx.damage.length === 1, 'the explosion converts; a band whose particle fails is left out');
ok(same(fx.damage[0], { from: 0.26, to: 0.25, hardpoint: null, position: [-1.5, 0, -4.14], particle: 'particles/fx_pt_smoking_thruster_light.json' }), 'a band keeps from and to as written, its position X negated');
ok(same(hullFxOf({}), { destroyed: null, damage: [] }), 'a hull without client data effects has none');
ok(wordsOf('tieinterceptor_imperial_guard') === 'Tieinterceptor Imperial Guard' && wordsOf('blacksun_light_s01') === 'Blacksun Light S01', 'words made from a family');

// The combat file from fakes.
const appearances: Record<string, string> = {
  'object/ship/player/shared_player_tiefighter.iff': 'appearance/tie_fighter.apt',
  'object/ship/player/shared_player_tiefighter_modified.iff': 'appearance\\TIE_fighter.apt',
  'object/ship/player/shared_player_blacksun_light_s01.iff': 'appearance/blacksun_light_s01.apt',
  'object/ship/player/shared_player_blacksun_light_s02.iff': 'appearance/blacksun_light_s02.apt',
  'object/ship/player/shared_player_xwing.iff': 'appearance/xwing.apt',
  'object/ship/shared_tiefighter_tier1.iff': 'appearance/tie_fighter.apt',
  'object/ship/shared_tiefighter_tier2.iff': 'appearance/tie_fighter.apt',
  'object/ship/shared_blacksun_light_s01_tier1.iff': 'appearance/blacksun_light_s01.apt',
  'object/ship/shared_blacksun_light_s02_tier1.iff': 'appearance/blacksun_light_s02.apt',
  'object/ship/shared_imperial_gunboat_tier1.iff': 'appearance/imperial_gunboat.apt',
  'object/ship/shared_nova_orion_pirate_light_tier1.iff': 'appearance/blacksun_light_s01.apt',
  'object/ship/shared_xwing_tier1.iff': 'appearance/xwing.apt',
  'object/ship/shared_escape_pod.iff': 'appearance/escape_pod.apt',
};
const chassisRows = new Map<string, Record<string, unknown>>([
  ['tiefighter_tier1', { ...row, name: 'tiefighter_tier1' }],
  ['tiefighter_tier2', { ...row, name: 'tiefighter_tier2' }],
  ['blacksun_light_tier1', { name: 'blacksun_light_tier1', hit_sound_group: '', reactor: 'rct_0', reactor_hitweight: 10, reactor_targetable: 1, engine: 'eng_0', engine_hitweight: 10, engine_targetable: 1 }],
  ['player_tiefighter', { name: 'player_tiefighter', hit_sound_group: 'tie', reactor: 'rct_0', reactor_hitweight: 10, reactor_targetable: 1 }],
]);
const names: Record<string, string> = { tiefighter_tier2: 'TIE Fighter', blacksun_light_s01_tier1: 'Kihraxz Light Fighter' };
const built = buildCombat({
  templates: Object.keys(appearances).filter((p) => p.startsWith('object/ship/shared_')),
  appearanceOf: (tpl: string) => appearances[tpl] ?? null,
  ships: [
    { id: 'tiefighter_modified', template: 'object/ship/player/shared_player_tiefighter_modified.iff', chassis: 'player_tiefighter' },
    { id: 'tiefighter', template: 'object/ship/player/shared_player_tiefighter.iff', chassis: 'player_tiefighter', fit: { chassis: 'player_tiefighter' }, destroyed: 'clienteffect/cbt_explode_tie.cef', damage: [] },
    { id: 'blacksun_light_s01', template: 'object/ship/player/shared_player_blacksun_light_s01.iff', chassis: 'player_blacksun_light_s01' },
    { id: 'blacksun_light_s02', template: 'object/ship/player/shared_player_blacksun_light_s02.iff', chassis: null },
    { id: 'xwing', template: 'object/ship/player/shared_player_xwing.iff', chassis: 'player_xwing' },
  ],
  chassisRows,
  slotNames,
  nameOf: (id: string) => names[id] ?? null,
  formations: { arrow: arrowTable.rows, claw: null, wall: [] },
  taunts: { hutt_low: hutt, imperial: new Map([['entercombat1', 'ATTENTION!  %TU, Lower your shields and prepare to be destroyed.']]), assassins: new Map() },
  hitEffectRows: [{ type: 'shield', hit_light: 'a.cef' }],
  hitSoundRows: [{ type: '', shield: 's.snd' }],
  targetRows: [{ ship_chassis: 'default', appearance: 'appearance/pt_ui_target_ship.prt', appearance_enemy: 'appearance/pt_ui_target_ship_enemy.prt', scale: 1 }],
  particle: (p: string) => (p ? `particles/fx_${p.replace(/^.*\//, '').replace(/\.prt$/, '')}.json` : null),
  effect: (c: string) => (c ? `fx(${c})` : null),
});
const f = built.file;
const byId = new Map(f.types.map((x: { id: string }) => [x.id, x]));
ok(f.version === COMBAT_FORMAT && COMBAT_FORMAT === 1, 'the file is version 1');
ok(byId.get('tiefighter_tier1')?.hull === 'tiefighter' && byId.get('tiefighter_tier2')?.hull === 'tiefighter', 'the hull whose id is the family wins over another with the same appearance (case and slashes aside)');
ok(byId.get('blacksun_light_s01_tier1')?.hull === 'blacksun_light_s01' && byId.get('blacksun_light_s02_tier1')?.hull === 'blacksun_light_s02', 'each style flies its own hull');
ok(byId.get('blacksun_light_s01_tier1')?.chassis === 'blacksun_light_tier1' && byId.get('blacksun_light_s02_tier1')?.chassis === 'blacksun_light_tier1', 'both styles read the style-dropped chassis');
ok(same(built.chassisWanted.get('blacksun_light_tier1'), ['blacksun_light_s01', 'blacksun_light_s02']) && same([...built.chassisWanted.keys()].sort(), ['blacksun_light_tier1', 'tiefighter_tier1', 'tiefighter_tier2']), "chassisWanted holds the chassis and every hull that flies it");
ok(!byId.has('nova_orion_pirate_light_tier1') && !f.skipped.some((s: { id: string }) => s.id.startsWith('nova_orion')), 'a not-ladder family is dropped, not listed as skipped');
ok(!byId.has('escape_pod'), 'an untiered template is passed over');
const gun = f.skipped.find((s: { id: string }) => s.id === 'imperial_gunboat_tier1');
ok(!!gun && gun.why === 'no garage hull shares appearance/imperial_gunboat.apt', 'a type no hull draws is skipped with the appearance named');
const xw = f.skipped.find((s: { id: string }) => s.id === 'xwing_tier1');
ok(!!xw && /^no chassis row/.test(xw.why) && !byId.has('xwing_tier1'), 'a type with no chassis row is skipped');
const tie = byId.get('tiefighter_tier1')!;
ok(tie.name === 'TIE Fighter' && tie.faction === 'imperial' && tie.taunts === 'imperial_low' && tie.template === 'object/ship/shared_tiefighter_tier1.iff' && tie.style === null && tie.base === 'tiefighter', 'a type carries its name, faction, taunt table and template');
ok(byId.get('tiefighter_tier2')!.name === 'TIE Fighter' && byId.get('blacksun_light_s02_tier1')!.name === 'Blacksun Light S02', "a missing name falls back to another tier's (here tier 1 takes tier 2's), else words");
ok(same(f.types.map((x: { id: string }) => x.id), ['blacksun_light_s01_tier1', 'blacksun_light_s02_tier1', 'tiefighter_tier1', 'tiefighter_tier2']), 'types sort by family then tier');
ok(same(Object.keys(f.chassis).sort(), ['blacksun_light_tier1', 'player_tiefighter', 'tiefighter_tier1', 'tiefighter_tier2']), "the wanted chassis and the rows the manifest's ships name, when the table has them");
ok(f.chassis.tiefighter_tier1.hitSounds === 'tie' && !('hitSounds' in f.chassis.blacksun_light_tier1) && f.chassis.tiefighter_tier1.slots.engine.hitweight === 12 && !('fit' in f.chassis.tiefighter_tier1), 'a chassis record has its slots and hit-sound group, and no fit yet');
ok(same(Object.keys(f.formations), ['arrow']) && f.formations.arrow.space.length === 20, 'a formation table with no rows is left out');
ok(same(Object.keys(f.taunts), ['imperial', 'hutt_low']) && f.taunts.imperial.entercombat[0].includes('%TU'), 'only the ten tables are written, and only those given');
ok(same(Object.keys(f.hulls), ['tiefighter_modified', 'tiefighter', 'blacksun_light_s01', 'blacksun_light_s02', 'xwing']) && f.hulls.tiefighter.destroyed === 'fx(clienteffect/cbt_explode_tie.cef)', "every manifest ship's effects are written");
ok(f.hitEffects.shield.hit[0] === 'fx(a.cef)' && f.hitSounds[''].shield === 's.snd' && f.target.friendly === 'particles/fx_pt_ui_target_ship.json', 'the hit and target tables go through the converters');
ok(same(f.counts, combatCounts(f)) && f.counts.types === 4 && f.counts.families === 3 && f.counts.hulls === 3 && f.counts.skipped === 2 && f.counts.fits === 0 && f.counts.target, 'the counts are the file\'s');
f.chassis.tiefighter_tier1.fit = { chassis: 'tiefighter_tier1', droid: 'computer', slots: [], paint: null };
ok(combatCounts(f).fits === 1, 'a fit filled in later is counted');
ok(combatLine(f) === 'combat: 4 NPC ship types in 3 families on 3 hulls (1 left out: no garage hull shares their appearance; 1 left out for other reasons), 1 tier fits, 1 formations, 2 taunt tables, 1 hit layers, target effects yes', 'the log line');
ok(JSON.parse(JSON.stringify(f)).types.length === 4, 'the file survives JSON');

// Status.
ok(combatStatus(null).stale && combatStatus(null).why === 'the ships pack has no combat.json (NPC ships and space combat)', 'no file: a to-do');
ok(combatStatus({ version: 0 }).stale && /version 0/.test(combatStatus({ version: 0 }).why!), 'another version: a to-do');
const st = combatStatus(f);
ok(!st.stale && st.clause === 'NPC ships: 4 types on 3 hulls, 1 tier fits', 'a current file: the clause and no to-do');
const unfitted = combatStatus({ ...f, chassis: { ...f.chassis, tiefighter_tier1: { ...f.chassis.tiefighter_tier1, fit: undefined } } });
ok(unfitted.stale && unfitted.clause === 'NPC ships: 4 types on 3 hulls, 0 tier fits' && /no tier fits/.test(unfitted.why!), 'types with no tier fit at all: a to-do, the clause kept');
ok(!combatStatus({ version: COMBAT_FORMAT, types: [], chassis: {} }).stale, 'no types and no fits: nothing to ask for');

// The owner's pack, when converted with combat.json.
const here = dirname(fileURLToPath(import.meta.url));
const packFile = join(here, '..', '..', '..', 'assets-private', 'ships', 'combat.json');
if (!existsSync(packFile)) console.log('skip the ships pack has no combat.json yet (the ships command writes it)');
else {
  const pack = JSON.parse(readFileSync(packFile, 'utf8'));
  ok(pack.version === COMBAT_FORMAT && Array.isArray(pack.types) && pack.types.length > 0, `the pack's combat.json has ${pack.types.length} types`);
  ok(pack.types.every((x: { chassis: string }) => !!pack.chassis[x.chassis]), "every type's chassis is written");
  const withFit = pack.types.filter((x: { chassis: string }) => pack.chassis[x.chassis].fit).length;
  const fitted = Object.values(pack.chassis).filter((c) => (c as { fit?: unknown }).fit).length;
  ok(withFit > 0 && pack.counts?.fits === fitted, `the tier fits are there and counted (${withFit} types fitted, ${fitted} tier chassis)`);
  ok(pack.types.every((x: { chassis: string }) => !pack.chassis[x.chassis].fit || pack.chassis[x.chassis].fit.paint === null), 'tier fits have no paint');
  ok(pack.formations.arrow?.space?.[1]?.[2] > 0, "the arrow's slot 1 is ahead of the leader");
}
console.log(`${checks} checks passed`);
