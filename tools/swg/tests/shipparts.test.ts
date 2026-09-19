// What hangs on a ship and on what: the client data's carriers and nested wings, the chassis tables'
// stock parts, and the tree the converter writes from them (tools/swg/shipparts.mjs).
import assert from 'node:assert/strict';
import { parseClientData } from '../shipdata.mjs';
import { CHASSIS_ALIASES, chassisNameFor, modalLooks, parseLookCell, STOCK_LEFT_OUT, wingOpenSpeedFactorOf } from '../shipfit.mjs';
import { assembleShip, assemblyCounts, assemblyStatus, clientChildren, expandPart, hungSummary, partFamilyOf, SHIP_ASSEMBLY_FORMAT, slotBase, standInHidden, standInSlot } from '../shipparts.mjs';
import { buildShips } from '../ships.mjs';
import { parseIff } from '../iff.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const f32 = Math.fround;
const same = (a: readonly number[] | null | undefined, b: readonly number[]) => !!a && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

type Def = {
  kind: string; source?: string; file: string; parent?: number | null; hardpoint?: string | null; place?: number[] | null;
  turn?: { angle: number; time: number } | null; on?: string; slot?: string; sharedWith?: string[]; owner?: number; standInFor?: string;
  template?: string; appearance?: string; sound?: string | null;
};
type Child = { source: string; template?: string; appearance?: string; hardpoint: string | null; place: number[] | null; turn?: { angle: number; time: number }; sound?: string | null };

/** A fake archive: templates and appearances to models, templates to their client data's children. */
function world(spec: { models: Record<string, string[]>; children?: Record<string, Child[]>; templates?: Record<string, string> }) {
  const modelCalls: string[] = [];
  const deps = {
    childrenOf: (t: string) => spec.children?.[t] ?? [],
    model: (d: { template?: string; appearance?: string }) => {
      const key = d.appearance ?? d.template!;
      modelCalls.push(key);
      const hps = spec.models[key];
      if (!hps) return { skip: 'no appearance' };
      const file = `${key.replace(/^.*\//, '').replace(/^shared_/, '').replace(/\.\w+$/, '')}.glb`;
      return { file, hardpoints: hps, appearance: d.appearance ?? `appearance/${file.replace(/\.glb$/, '.apt')}` };
    },
    templateOf: (n: string) => spec.templates?.[n] ?? null,
  };
  return { deps, modelCalls };
}
const T = (n: string) => `object/tangible/ship/attachment/weapon/shared_${n}.iff`;
const treeOk = (defs: Def[]) => defs.every((d, i) => d.parent === null || (typeof d.parent === 'number' && d.parent < i));

// ---- 1. parseClientData: WING with PSOR or HARD, the carrier chunks, ONOF/VTHR/DSTR as before ----
{
  const wingData = (t: string, angle: number) => new W().str(t).f32(angle).f32(3).str('@@sound/wings_open_xwing.snd').bytes();
  const psor = new W().f32(1).f32(2).f32(3).f32(0).f32(0).f32(90).bytes();
  const floats17 = (a: number[]) => { const w = new W(); for (let i = 0; i < 17; i++) w.f32(a[i] ?? 0); return w; };
  const hobj = new W().str('appearance/ywing_turret_base_s01.apt').str('turret_base').bytes();
  const ihob = new W().str('appearance\\yt1300_turret_barrel.apt').str('turretbarrel1').f32(1.4).f32(4).f32(1.2).bytes();
  const chl2 = floats17([0, 1.33, -6.551]);
  const chl2Bytes = new Uint8Array([...new W().str('object/tangible/ship/attachment/wing/shared_hutt_heavy_wing_s01.iff').bytes(), ...chl2.bytes()]);
  const chldBytes = new Uint8Array([...new W().str('appearance/yt1300_engine_none.apt').bytes(), ...floats17([]).bytes()]);
  const cdf = parseClientData(parseIff(Buffer.from(encode(form('CLDF', form('0000',
    form('WING', chunk('DATA', wingData('object/tangible/ship/attachment/wing/shared_bwing_body.iff', -90)), chunk('PSOR', psor)),
    chunk('HOBJ', hobj),
    form('WING', chunk('DATA', wingData('object/tangible/ship/attachment/wing/shared_bwing_wing_l.iff', -90)), chunk('HARD', new W().str('wing_l1').bytes())),
    chunk('IHOB', ihob),
    form('ONOF', chunk('INFO', new W().i32(1).bytes()), chunk('APPR', new W().str('appearance/ywing_engine_s01_on.apt').bytes()), chunk('HARD', new W().str('engine1').bytes())),
    chunk('CHL2', chl2Bytes),
    form('VTHR', chunk('INFO', new W().f32(0.5).bytes()), chunk('HOBJ', new W().str('appearance/pt_smoke.prt').str('thrust1').bytes())),
    chunk('CHLD', chldBytes),
    form('DSTR', chunk('INFO', new W().str('clienteffect/ship_destroyed.cef').bytes())),
  ))))));
  ok(cdf.wings.length === 2 && same(cdf.wings[0].hinge, [1, 2, 3, 0, 0, 90]) && cdf.wings[0].hardpoint === null, 'a WING with PSOR gives its six floats and no hardpoint');
  ok(cdf.wings[1].hinge === null && cdf.wings[1].hardpoint === 'wing_l1' && cdf.wings[1].angle === -90 && cdf.wings[1].time === 3, 'a WING with HARD gives the hardpoint and no hinge, its turn read as before');
  ok(cdf.children.length === 4 && cdf.children.map((c: Child) => c.source).join() === 'HOBJ,IHOB,CHL2,CHLD', 'the carriers are read in file order, a VTHR\'s own HOBJ not among them');
  const [h, i, c2, cd] = cdf.children;
  ok(h.appearance === 'appearance/ywing_turret_base_s01.apt' && h.hardpoint === 'turret_base' && !('extra' in h), 'HOBJ: an appearance and a hardpoint');
  ok(i.appearance === 'appearance/yt1300_turret_barrel.apt' && i.hardpoint === 'turretbarrel1' && same(i.extra, [f32(1.4), 4, f32(1.2)]), 'IHOB: the path normalised, and its three trailing floats as `extra`');
  ok(c2.template === 'object/tangible/ship/attachment/wing/shared_hutt_heavy_wing_s01.iff' && same(c2.place, [0, f32(1.33), f32(-6.551), 0, 0, 0]) && c2.hardpoint === null && !('rest' in c2), 'CHL2: a template placed at its first three floats');
  ok(cd.appearance === 'appearance/yt1300_engine_none.apt' && same(cd.place, [0, 0, 0, 0, 0, 0]), 'CHLD: an appearance at its (zero) place');
  ok(cdf.onOff.length === 1 && cdf.onOff[0].hardpoint === 'engine1' && cdf.thrusters.length === 1 && cdf.thrusters[0].hardpoint === 'thrust1' && cdf.destroyed === 'clienteffect/ship_destroyed.cef', 'ONOF, VTHR and DSTR still read as before');
  const kids = clientChildren(cdf);
  ok(kids.map((k: Child) => k.source).join() === 'WING,WING,HOBJ,IHOB,CHL2,CHLD,ONOF', 'rule 1: wings first, then the carriers in file order, then the on/off appearances');
  ok(kids[0].turn!.angle === -90 && kids[0].sound === 'sound/wings_open_xwing.snd' && kids[1].place === null && kids[1].hardpoint === 'wing_l1', 'a wing child carries its turn, its sound, and its PSOR or HARD');
}

// ---- 2. the chassis tables ----
{
  const rows = new Set(['player_xwing', 'player_yt1300', 'player_corvette']);
  const has = (n: string) => rows.has(n);
  ok(chassisNameFor('player_xwing', has) === 'player_xwing', 'a chassis matches its template exactly');
  ok(chassisNameFor('player_yt1300_decorated_01', has) === 'player_yt1300', 'a decorated YT-1300 uses the YT-1300\'s chassis');
  ok(chassisNameFor('player_corellian_corvette', has) === 'player_corvette' && CHASSIS_ALIASES.player_corellian_corvette === 'player_corvette', 'the corvette goes by its alias');
  ok(chassisNameFor('player_unknown', has) === null && chassisNameFor('player_corellian_corvette', () => false) === null, 'no row, no chassis (the alias too must be in the table)');
  const two = parseLookCell('a:hp1, b:hp2');
  ok(two.length === 2 && two[0].attachment === 'a' && two[0].hardpoint === 'hp1' && two[1].attachment === 'b' && two[1].hardpoint === 'hp2', 'a looks cell gives its pairs');
  ok(parseLookCell('tie_engine_s01:')[0].hardpoint === '' && parseLookCell('tie_engine_s01')[0].hardpoint === '', 'an empty or absent hardpoint is the hull\'s origin');
  ok(parseLookCell('').length === 0 && parseLookCell(undefined).length === 0, 'an empty cell has no parts');
  const table = {
    columns: ['component', 'engine', 'weapon_0', 'modification_0', 'booster'],
    rows: [
      { component: 'e1', engine: 'x_engine_s01:engine1', weapon_0: 'g1:weapon1', modification_0: '', booster: '' },
      { component: 'e2', engine: 'x_engine_s02:engine1', weapon_0: 'g2:weapon1', modification_0: 'x_modification_s01:attach1', booster: '' },
      { component: 'e3', engine: 'x_engine_s02:engine1', weapon_0: 'g1:weapon1', modification_0: '', booster: '' },
      { component: 'e4', engine: 'x_engine_s01:engine1', weapon_0: 'g2:weapon1', modification_0: '', booster: '' },
    ],
  };
  const looks = modalLooks(table);
  ok(looks.map((l: { slot: string }) => l.slot).join() === 'engine,weapon_0', 'the stock look: every slot column but the modification one and the all-empty one, in column order');
  ok(looks[0].pairs[0].attachment === 'x_engine_s01' && looks[1].pairs[0].attachment === 'g1', 'a tie goes to the cell seen first');
  ok(STOCK_LEFT_OUT.test('modification_0') && !STOCK_LEFT_OUT.test('weapon_0'), 'the modification columns are the ones left out');
  const more = modalLooks({ columns: ['component', 'weapon_2'], rows: [{ weapon_2: 'b:w2_pos1, c:w2_neg1' }, { weapon_2: 'a:w' }, { weapon_2: 'b:w2_pos1, c:w2_neg1' }] });
  ok(more[0].pairs.length === 2 && more[0].pairs[1].hardpoint === 'w2_neg1', 'the most common cell wins, with every pair in it');
  ok(wingOpenSpeedFactorOf({ wing_open_speed_factor: f32(0.95) }) === 0.95 && wingOpenSpeedFactorOf({}) === 1 && wingOpenSpeedFactorOf({ wing_open_speed_factor: 0 }) === 1 && wingOpenSpeedFactorOf(undefined) === 1, 'the open-speed factor: the float to four places, 1 when absent');
}

// ---- 3. the B-wing: a wing whose own client data holds two HARD-hung foils ----
{
  const body = 'object/tangible/ship/attachment/wing/shared_bwing_body.iff';
  const foilL = 'object/tangible/ship/attachment/wing/shared_bwing_wing_l.iff';
  const foilR = 'object/tangible/ship/attachment/wing/shared_bwing_wing_r.iff';
  const { deps } = world({
    models: { [body]: ['engine1', 'weapon3', 'wing_l1', 'wing_r1'], [foilL]: ['weapon2l'], [foilR]: ['weapon2r1'], [T('bwing_engine_s01')]: ['engine_glow1'], [T('bwing_weapon1_s01')]: ['muzzle1'], [T('bwing_weapon2l_s01')]: ['muzzle1'], [T('bwing_weapon2r_s01')]: ['muzzle1'] },
    children: {
      [body]: [
        { source: 'WING', template: foilL, hardpoint: 'wing_l1', place: null, turn: { angle: -90, time: 3 } },
        { source: 'WING', template: foilR, hardpoint: 'wing_r1', place: null, turn: { angle: 90, time: 3 } },
      ],
    },
    templates: { bwing_engine_s01: T('bwing_engine_s01'), bwing_weapon1_s01: T('bwing_weapon1_s01'), bwing_weapon2l_s01: T('bwing_weapon2l_s01'), bwing_weapon2r_s01: T('bwing_weapon2r_s01') },
  });
  const r = assembleShip({ hardpoints: ['weapon1'] }, [{ source: 'WING', template: body, hardpoint: null, place: [0, 0, 0, 0, 0, 90], turn: { angle: -90, time: 3 }, sound: 'sound/wings_open_xwing.snd' }], [
    { slot: 'engine', attachment: 'bwing_engine_s01', hardpoint: 'engine1' },
    { slot: 'weapon_0', attachment: 'bwing_weapon1_s01', hardpoint: 'weapon1' },
    { slot: 'weapon_1', attachment: 'bwing_weapon2l_s01', hardpoint: 'weapon2l' },
    { slot: 'weapon_2', attachment: 'bwing_weapon2r_s01', hardpoint: 'weapon2r1' },
  ], deps);
  const a: Def[] = r.attachments;
  ok(a.map((d) => d.file).join() === 'bwing_body.glb,bwing_wing_l.glb,bwing_wing_r.glb,bwing_engine_s01.glb,bwing_weapon1_s01.glb,bwing_weapon2l_s01.glb,bwing_weapon2r_s01.glb', 'the B-wing hangs its body, the two foils, then the stock parts in column order');
  ok(a[0].kind === 'wing' && a[0].parent === null && a[0].hardpoint === null && same(a[0].place, [0, 0, 0, 0, 0, 90]) && a[0].turn!.angle === -90 && a[0].turn!.time === 3 && a[0].sound === 'sound/wings_open_xwing.snd', 'the body stands at its PSOR on the hull and turns -90 in 3 s');
  ok(a[1].parent === 0 && a[1].hardpoint === 'wing_l1' && a[1].place === null && a[1].turn!.angle === -90 && a[2].parent === 0 && a[2].hardpoint === 'wing_r1' && a[2].turn!.angle === 90, 'each foil hangs on the body\'s own hardpoint, with no place of its own');
  ok(a[3].kind === 'component' && a[3].slot === 'engine' && a[3].parent === 0 && a[3].hardpoint === 'engine1', 'the engine rides the body');
  ok(a[4].slot === 'weapon_0' && a[4].parent === null && a[5].slot === 'weapon_1' && a[5].parent === 1 && a[6].parent === 2, 'the nose gun is on the pod, each foil gun on its foil');
  ok(treeOk(a) && a.every((d) => d.parent !== undefined), 'every parent comes before its child, and none is undefined');
  ok(a.every((d) => d.template && d.appearance) && a.every((d) => d.owner === undefined), 'every def names its template and appearance; nothing here came from a component\'s own client data');
  const c = assemblyCounts(a);
  ok(c.hung === 7 && c.wings === 3 && c.nested === 2 && c.opening === 3 && c.parts === 4 && c.onWings === 3, 'counts: 7 hung, 3 wings (2 on a wing), 3 parts riding a wing');
  ok(hungSummary(a).startsWith('3 wings (2 on wings, 3 that open: -90° in 3 s, 90° in 3 s), 0 carriers, 0 on/off appearances, 4 parts (engine at engine1, weapon_0 at weapon1'), 'the log names the wings, their turns and the parts');
}

// ---- 4. a turret: the barrels are on the body, hung just before them, not on the base ----
{
  const base = T('yt1300_turret_base');
  const { deps } = world({
    models: { [base]: ['turretpitch1'], 'appearance/yt1300_turret_body.apt': ['turretbarrel1', 'turretbarrel2', 'turretcamera1'], 'appearance/yt1300_turret_barrel.apt': ['muzzle1'] },
    children: { [base]: [
      { source: 'IHOB', appearance: 'appearance/yt1300_turret_body.apt', hardpoint: 'turretpitch1', place: null },
      { source: 'IHOB', appearance: 'appearance/yt1300_turret_barrel.apt', hardpoint: 'turretbarrel1', place: null },
      { source: 'IHOB', appearance: 'appearance/yt1300_turret_barrel.apt', hardpoint: 'turretbarrel2', place: null },
    ] },
    templates: { yt1300_turret_base: base },
  });
  const a: Def[] = assembleShip({ hardpoints: ['turretyaw1'] }, [], [{ slot: 'weapon_0', attachment: 'yt1300_turret_base', hardpoint: 'turretyaw1' }], deps).attachments;
  ok(a.length === 4 && a[0].slot === 'weapon_0' && a[0].parent === null && a[0].hardpoint === 'turretyaw1', 'the turret base hangs on the hull\'s yaw hardpoint');
  ok(a[1].kind === 'carrier' && a[1].source === 'IHOB' && a[1].parent === 0 && a[1].hardpoint === 'turretpitch1', 'its body on the base');
  ok(a[2].parent === 1 && a[3].parent === 1 && a[2].hardpoint === 'turretbarrel1' && a[3].hardpoint === 'turretbarrel2', 'both barrels on the body, not on the base');
  ok(a[1].owner === 0 && a[2].owner === 0 && a[3].owner === 0, 'every node the base\'s client data produced names the base as its owner');
}

// ---- 5. on/off appearances: found on the ship as a whole, and the booster's ----
{
  const eng = T('ywing_engine_s01');
  const bst = T('ywing_booster_s01');
  const { deps } = world({
    models: { [eng]: ['engine_glow1'], [bst]: ['booster_glow1'], 'appearance/ywing_engine_s01_on.apt': [], 'appearance/ywing_booster_s01_on.apt': [], 'appearance/ywing_glow.apt': [] },
    children: {
      [eng]: [{ source: 'ONOF', appearance: 'appearance/ywing_engine_s01_on.apt', hardpoint: 'engine_on1', place: null }],
      [bst]: [{ source: 'ONOF', appearance: 'appearance/ywing_booster_s01_on.apt', hardpoint: 'booster_glow1', place: null }],
    },
    templates: { ywing_engine_s01: eng, ywing_booster_s01: bst },
  });
  const r = assembleShip({ hardpoints: ['engine1', 'booster1', 'engine_on1'] }, [{ source: 'ONOF', appearance: 'appearance/ywing_glow.apt', hardpoint: 'engine_glow1', place: null }], [
    { slot: 'engine', attachment: 'ywing_engine_s01', hardpoint: 'engine1' },
    { slot: 'booster', attachment: 'ywing_booster_s01', hardpoint: 'booster1' },
  ], deps);
  const a: Def[] = r.attachments;
  const engOn = a.find((d) => d.appearance === 'appearance/ywing_engine_s01_on.apt')!;
  const bstOn = a.find((d) => d.appearance === 'appearance/ywing_booster_s01_on.apt')!;
  const hullOn = a.find((d) => d.appearance === 'appearance/ywing_glow.apt')!;
  const engIdx = a.findIndex((d) => d.slot === 'engine');
  const bstIdx = a.findIndex((d) => d.slot === 'booster');
  ok(engOn.kind === 'engine' && engOn.parent === null && engOn.hardpoint === 'engine_on1' && engOn.on === 'engine', 'an engine part\'s ONOF on a hardpoint only the hull carries hangs on the hull');
  ok(r.notes.filter((n: string) => n.startsWith('(global)')).length === 1 && r.notes.some((n: string) => n.startsWith('(global) ONOF ywing_engine_s01_on.apt @engine_on1 -> hull')), 'and one (global) note says so');
  ok(engOn.owner === engIdx, 'its owner is the engine part whose client data listed it');
  ok(bstOn.on === 'booster' && bstOn.parent === bstIdx && bstOn.owner === bstIdx, 'the booster part\'s ONOF shows while boosting, on the booster, owned by it');
  ok(hullOn.parent === engIdx && hullOn.on === 'engine' && hullOn.owner === undefined, 'a hull-listed ONOF whose hardpoint only a part carries waits for it, hangs there, and has no owner');
  ok(treeOk(a), 'the tree stays in order with the late ONOF');
}

// ---- 6. duplicates ----
{
  const wing = 'object/tangible/ship/attachment/wing/shared_x_wing.iff';
  const gun = T('g');
  const eng = T('rebel_gunboat_engines_s01');
  const { deps } = world({
    models: { [wing]: ['weapon1_pos1'], 'appearance/x_gun.apt': ['muzzle1'], [gun]: ['muzzle1'], [eng]: [], 'appearance/rebel_gunboat_engines_s01.apt': [] },
    children: {
      [wing]: [
        { source: 'HOBJ', appearance: 'appearance/x_gun.apt', hardpoint: 'weapon1_pos1', place: null },
        { source: 'HOBJ', appearance: 'appearance/x_gun.apt', hardpoint: 'weapon1_pos1', place: null },
      ],
      [eng]: [{ source: 'ONOF', appearance: 'appearance/rebel_gunboat_engines_s01.apt', hardpoint: 'engine_on1', place: null }],
    },
    templates: { g: gun, rebel_gunboat_engines_s01: eng },
  });
  // The engine part's model is the same file as its own ONOF: the template resolves to that appearance.
  const sameFile = { ...deps, model: (d: { template?: string; appearance?: string }) => (d.template === eng ? { file: 'rebel_gunboat_engines_s01.glb', hardpoints: [], appearance: 'appearance/rebel_gunboat_engines_s01.apt' } : deps.model(d)) };
  const r = assembleShip({ hardpoints: ['weapon1', 'engine_on1'] }, [{ source: 'WING', template: wing, hardpoint: null, place: [0, 0, 0, 0, 0, 0], turn: { angle: -14, time: 3 } }], [
    { slot: 'engine', attachment: 'rebel_gunboat_engines_s01', hardpoint: 'engine_on1' },
    { slot: 'weapon_0', attachment: 'g', hardpoint: 'weapon1' },
    { slot: 'weapon_1', attachment: 'g', hardpoint: 'weapon1' },
  ], sameFile);
  const a: Def[] = r.attachments;
  ok(a.filter((d) => d.file === 'x_gun.glb').length === 1 && r.notes.filter((n: string) => n.startsWith('duplicate x_gun.glb')).length === 1, 'the same part twice on weapon1_pos1 hangs once, with one note');
  const guns = a.filter((d) => d.file === 'g.glb');
  ok(guns.length === 1 && guns[0].slot === 'weapon_0' && guns[0].sharedWith?.join() === 'weapon_1', 'two slots with the same gun on the same hardpoint: one def, the lower slot kept, the other in sharedWith');
  const engines = a.filter((d) => d.file === 'rebel_gunboat_engines_s01.glb');
  ok(engines.length === 1 && engines[0].kind === 'component' && engines[0].slot === 'engine', 'an engine part and its own ONOF on the same hardpoint: the stock part stays');
  ok(!r.notes.some((n: string) => n.startsWith('(global) ONOF rebel_gunboat_engines_s01')) && r.notes.some((n: string) => n.startsWith('duplicate rebel_gunboat_engines_s01.glb @engine_on1 left out')), 'an ONOF found on the ship but left out as a duplicate gets no (global) note, only the duplicate one');
  // The other order: a hull ONOF first, the stock part later on the same hardpoint with the same file.
  const r2 = assembleShip({ hardpoints: ['engine_on1'] }, [{ source: 'ONOF', appearance: 'appearance/rebel_gunboat_engines_s01.apt', hardpoint: 'engine_on1', place: null }], [{ slot: 'engine', attachment: 'rebel_gunboat_engines_s01', hardpoint: 'engine_on1' }], { ...sameFile, childrenOf: () => [] });
  ok(r2.attachments.length === 1 && r2.attachments[0].kind === 'component' && r2.attachments[0].slot === 'engine' && r2.attachments[0].on === undefined && r2.attachments[0].template === eng, 'an ONOF hung first becomes the stock part that duplicates it, so it is always shown');
}

// ---- 7. stand-ins, written with standInFor ----
{
  const eng = T('yt1300_engine_s01');
  const kids: Child[] = [{ source: 'CHLD', appearance: 'appearance/yt1300_engine_none.apt', hardpoint: null, place: [0, 0, 0, 0, 0, 0] }];
  const { deps } = world({ models: { 'appearance/yt1300_engine_none.apt': ['engine_on1'], [eng]: ['engine_on1'] }, templates: { yt1300_engine_s01: eng } });
  ok(standInSlot('appearance/yt1300_engine_none.apt') === 'engine' && standInSlot('appearance/x_booster_none') === 'booster' && standInSlot('appearance/yt1300_engine_s01.apt') === null, 'a _<slot>_none appearance stands in for its slot');
  ok(slotBase('weapon_0') === 'weapon' && slotBase('engine') === 'engine', 'a slot\'s base drops its index');
  ok(partFamilyOf('jedi_starfighter') === 'jedifighter' && partFamilyOf('advanced_xwing') === 'xwing' && partFamilyOf('tieinterceptor_imperial_guard') === 'tieinterceptor' && partFamilyOf('ywing_longprobe') === 'ywing', 'the old guess by name looks for the Jedi starfighter\'s parts as jedifighter_*');
  const filled = assembleShip({ hardpoints: [] }, kids, [{ slot: 'engine', attachment: 'yt1300_engine_s01', hardpoint: '' }], deps);
  const stand = filled.attachments.find((d: Def) => d.source === 'CHLD')!;
  ok(stand.standInFor === 'engine' && stand.kind === 'carrier' && stand.parent === null, 'the stand-in is written, with the slot it stands for');
  ok(standInHidden(stand, filled.attachments) && filled.notes.some((n: string) => n.startsWith('stand-in yt1300_engine_none.apt: not shown')), 'with the engine slot filled the game leaves it out, and the note says so');
  ok(assemblyCounts(filled.attachments).hung === 1 && assemblyCounts(filled.attachments).standIns === 1, 'a stand-in for a filled slot is not counted as hung');
  const engine = filled.attachments.find((d: Def) => d.slot === 'engine')!;
  ok(engine.parent === null && engine.hardpoint === null, 'a stock part with an empty hardpoint hangs at the hull\'s origin');
  const empty = assembleShip({ hardpoints: [] }, kids, [], deps);
  ok(empty.attachments.length === 1 && empty.attachments[0].standInFor === 'engine' && !standInHidden(empty.attachments[0], empty.attachments) && assemblyCounts(empty.attachments).hung === 1, 'with the slot empty the stand-in is shown and counted');
  // A filled stand-in carries nothing: a hull ONOF on a hardpoint only the stand-in and the engine share goes on the engine.
  const onof = assembleShip({ hardpoints: [] }, [...kids, { source: 'ONOF', appearance: 'appearance/yt1300_engine_on.apt', hardpoint: 'engine_on1', place: null }], [{ slot: 'engine', attachment: 'yt1300_engine_s01', hardpoint: '' }], world({ models: { 'appearance/yt1300_engine_none.apt': ['engine_on1'], [eng]: ['engine_on1'], 'appearance/yt1300_engine_on.apt': [] }, templates: { yt1300_engine_s01: eng } }).deps);
  const on = onof.attachments.find((d: Def) => d.source === 'ONOF')!;
  ok(onof.attachments[on.parent as number].slot === 'engine', 'a stand-in for a filled slot is never a carrier');
  // The stock engine has no model (as the TIE engines have none): the slot is not filled, the game shows
  // the stand-in, so the hull's ONOF hangs on it and it is counted.
  const noModel = assembleShip({ hardpoints: [] }, [...kids, { source: 'ONOF', appearance: 'appearance/yt1300_engine_on.apt', hardpoint: 'engine_on1', place: null }], [{ slot: 'engine', attachment: 'yt1300_engine_s01', hardpoint: '' }], world({ models: { 'appearance/yt1300_engine_none.apt': ['engine_on1'], 'appearance/yt1300_engine_on.apt': [] }, templates: { yt1300_engine_s01: eng } }).deps);
  const nm = noModel.attachments as Def[];
  ok(nm.length === 2 && !nm.some((d) => d.kind === 'component') && nm[1].source === 'ONOF' && nm[1].parent === 0 && !standInHidden(nm[0], nm) && assemblyCounts(nm).hung === 2, 'a stock part with no model fills nothing: the stand-in is shown and carries the ONOF, as status counts it');
  ok(noModel.notes.filter((n: string) => n.startsWith('chassis engine: yt1300_engine_s01')).length === 1, 'the part with no model is noted once');
  // The stock engine converts but nothing carries its hardpoint: it is left off, so the stand-in is shown
  // after all and takes the ONOF that waited for it.
  const leftOff = assembleShip({ hardpoints: [] }, [...kids, { source: 'ONOF', appearance: 'appearance/yt1300_engine_on.apt', hardpoint: 'engine_on1', place: null }], [{ slot: 'engine', attachment: 'yt1300_engine_s01', hardpoint: 'engine9' }], world({ models: { 'appearance/yt1300_engine_none.apt': ['engine_on1'], [eng]: ['engine_on1'], 'appearance/yt1300_engine_on.apt': [] }, templates: { yt1300_engine_s01: eng } }).deps);
  const lo = leftOff.attachments as Def[];
  ok(lo.length === 2 && lo[1].source === 'ONOF' && lo[1].parent === 0 && !standInHidden(lo[0], lo), 'a stock part left off for want of its hardpoint leaves its slot empty: the stand-in carries after all');
  ok(leftOff.notes.includes('the engine part was not hung: its stand-in is shown and carries') && leftOff.notes.includes('chassis engine: yt1300_engine_s01: hardpoint engine9 carried by nothing, left off'), 'and the notes say both');
  // The engine's hardpoint is on its own stand-in only: the engine stays off rather than hide what it hangs on.
  const onStand = assembleShip({ hardpoints: [] }, kids, [{ slot: 'engine', attachment: 'yt1300_engine_s01', hardpoint: 'engine_on1' }], world({ models: { 'appearance/yt1300_engine_none.apt': ['engine_on1'], [eng]: ['engine_on1'] }, templates: { yt1300_engine_s01: eng } }).deps);
  ok(onStand.attachments.length === 1 && onStand.attachments[0].standInFor === 'engine' && !standInHidden(onStand.attachments[0], onStand.attachments) && onStand.notes.includes('chassis engine: yt1300_engine_s01: hardpoint engine_on1 carried by nothing, left off'), 'a part is never hung on the stand-in for its own slot');
}

// ---- 8. rounds: a stock part on a later stock part; one nothing carries ----
{
  const eng = T('hutt_heavy_engine_s01');
  const bst = T('hutt_heavy_booster_s01');
  const gun = T('stray_gun');
  const { deps } = world({ models: { [eng]: ['booster1'], [bst]: [], [gun]: [] }, templates: { hutt_heavy_engine_s01: eng, hutt_heavy_booster_s01: bst, stray_gun: gun } });
  const r = assembleShip({ hardpoints: ['engine1'] }, [], [
    { slot: 'booster', attachment: 'hutt_heavy_booster_s01', hardpoint: 'booster1' },
    { slot: 'engine', attachment: 'hutt_heavy_engine_s01', hardpoint: 'engine1' },
    { slot: 'weapon_0', attachment: 'stray_gun', hardpoint: 'weapon9' },
    { slot: 'weapon_1', attachment: 'no_such_part', hardpoint: 'weapon1' },
  ], deps);
  const a: Def[] = r.attachments;
  ok(a.length === 2 && a[0].slot === 'engine' && a[1].slot === 'booster' && a[1].parent === 0, 'the booster waits for the engine part that carries its hardpoint, and hangs on it in the second round');
  ok(!a.some((d) => d.slot === 'weapon_0') && r.notes.some((n: string) => n === 'chassis weapon_0: stray_gun: hardpoint weapon9 carried by nothing, left off'), 'a part whose hardpoint nothing carries is noted and left off');
  ok(!a.some((d) => d.parent === null && d.hardpoint && d.hardpoint !== 'engine1'), 'nothing is put on the hull under a hardpoint the hull lacks');
  ok(r.notes.includes('chassis weapon_1: no_such_part has no template'), 'a looks-table part with no template is noted');
  ok(r.carried.includes('engine1') && r.carried.includes('booster1'), 'carried lists the hull\'s and the parts\' hardpoints');
}

// ---- 9. expandPart, model failures, depth ----
{
  const base = T('turret_base');
  const bst = T('x_booster_s01');
  const { deps, modelCalls } = world({
    models: { 'appearance/body.apt': ['turretbarrel1'], 'appearance/barrel.apt': [], 'appearance/bst_on.apt': [] },
    children: {
      [base]: [
        { source: 'IHOB', appearance: 'appearance/body.apt', hardpoint: 'turretpitch1', place: null },
        { source: 'IHOB', appearance: 'appearance/barrel.apt', hardpoint: 'turretbarrel1', place: null },
      ],
      [bst]: [{ source: 'ONOF', appearance: 'appearance/bst_on.apt', hardpoint: null, place: null }],
    },
  });
  const sub = expandPart(base, ['turretpitch1'], deps);
  ok(sub.attachments.length === 2 && sub.attachments[0].parent === null && sub.attachments[0].hardpoint === 'turretpitch1' && sub.attachments[1].parent === 0, 'expandPart: a part\'s subtree, parents relative to the part (null = the part)');
  ok(sub.attachments.every((d: Def) => d.owner === undefined), 'expandPart: the part itself is not in the list, so no owner is written');
  const on = expandPart(bst, [], deps, { slot: 'booster' });
  ok(on.attachments.length === 1 && on.attachments[0].on === 'booster' && on.attachments[0].parent === null, 'expandPart: a booster\'s own ONOF shows while boosting');
  // 9b. A child on a hardpoint only the rest of the ship carries (the V-wing engine's glow on the hull's
  // wing1, the Y-wing engine's "on" appearance on the hull's engine1): written by name, not left off.
  const veng = T('vwing_engine_s01');
  const pod = 'object/tangible/ship/attachment/wing/shared_x_pod.iff';
  const byName = world({
    models: { [veng]: ['engine_glow1'], 'appearance/vwing_engine_glow_01.apt': [], [pod]: ['pod_light1'], 'appearance/pod_light.apt': [] },
    children: {
      [veng]: [
        { source: 'ONOF', appearance: 'appearance/vwing_engine_glow_01.apt', hardpoint: 'wing1', place: null },
        { source: 'CHL2', template: pod, hardpoint: 'hull_pod1', place: [0, 1, 0, 0, 0, 0] },
      ],
      [pod]: [{ source: 'HOBJ', appearance: 'appearance/pod_light.apt', hardpoint: 'pod_light1', place: null }],
    },
  });
  const glow = expandPart(veng, ['engine_glow1'], byName.deps, { slot: 'engine' });
  const g: Def[] = glow.attachments;
  const glowDef = g.find((d) => d.appearance === 'appearance/vwing_engine_glow_01.apt')!;
  ok(!!glowDef && !('parent' in glowDef) && glowDef.parent === undefined && glowDef.hardpoint === 'wing1' && glowDef.on === 'engine' && glowDef.kind === 'engine' && glowDef.source === 'ONOF' && glowDef.place === null, 'expandPart: a child on a hardpoint the part lacks is written by name (no parent, its hardpoint kept, shown with the engine)');
  ok(!glow.notes.some((n: string) => n.includes('left off')) && glow.notes.includes('(global) ONOF vwing_engine_glow_01.apt @wing1 -> not on the part, hung by name'), 'expandPart: nothing is left off, and the note says it is hung by name');
  const podIdx = g.findIndex((d) => d.template === pod);
  const light = g.find((d) => d.appearance === 'appearance/pod_light.apt')!;
  ok(podIdx >= 0 && g[podIdx].parent === undefined && g[podIdx].hardpoint === 'hull_pod1' && same(g[podIdx].place, [0, 1, 0, 0, 0, 0]) && light.parent === podIdx && light.hardpoint === 'pod_light1', 'expandPart: a by-name child\'s own children hang on it as usual, after it in the list');
  ok(g.every((d, i) => d.parent === undefined || d.parent === null || (typeof d.parent === 'number' && d.parent < i)), 'expandPart: every numbered parent still comes before its child');
  // Given the ship's hardpoints, one nothing on the ship carries is left off (the TIE Aggressor's barrel).
  const known = expandPart(veng, ['engine_glow1'], byName.deps, { slot: 'engine', shipHardpoints: ['engine1', 'wing1'] });
  ok(known.attachments.length === 1 && known.attachments[0].hardpoint === 'wing1' && known.attachments[0].parent === undefined && known.notes.includes('CHL2 x_pod.iff: hardpoint hull_pod1 carried by nothing on the ship, left off'), 'expandPart with the ship\'s hardpoints: a child none of them carries is left off, the rest by name');
  // The part itself again (the rebel gunship's engine lists its own model as its ONOF on engine_on1).
  const gun = T('rebel_gunboat_engines_s01');
  const self = world({ models: { [gun]: [], 'appearance/rebel_gunboat_engines_s01.apt': [] }, children: { [gun]: [{ source: 'ONOF', appearance: 'appearance/rebel_gunboat_engines_s01.apt', hardpoint: 'engine_on1', place: null }] } });
  const selfDeps = { ...self.deps, model: (d: { template?: string; appearance?: string }) => (d.template === gun || d.appearance === 'appearance/rebel_gunboat_engines_s01.apt' ? { file: 'rebel_gunboat_engines_s01.glb', hardpoints: [], appearance: 'appearance/rebel_gunboat_engines_s01.apt' } : self.deps.model(d)) };
  const own = expandPart(gun, [], selfDeps, { slot: 'engine', hardpoint: 'engine_on1' });
  ok(own.attachments.length === 0 && own.notes.includes('duplicate rebel_gunboat_engines_s01.glb @engine_on1: the part itself, left out'), 'expandPart: a child that is the part\'s own model on the part\'s own hardpoint is the part itself, left out');
  const elsewhere = expandPart(gun, [], selfDeps, { slot: 'engine', hardpoint: 'engine2' });
  ok(elsewhere.attachments.length === 1 && elsewhere.attachments[0].parent === undefined && elsewhere.attachments[0].hardpoint === 'engine_on1', 'the same model hung where the part is not stays, by name');
  ok(expandPart(gun, [], selfDeps, { slot: 'engine' }).attachments.length === 0, 'with no hardpoint given for the part, its own model is the part itself wherever it names');
  // The whole ship knows the hull: the same engine under assembleShip hangs its glow on the hull by index.
  const whole = assembleShip({ hardpoints: ['engine1', 'wing1', 'hull_pod1'] }, [], [{ slot: 'engine', attachment: 'vwing_engine_s01', hardpoint: 'engine1' }], { ...byName.deps, templateOf: (n: string) => (n === 'vwing_engine_s01' ? veng : null) });
  const wg = whole.attachments.find((d: Def) => d.appearance === 'appearance/vwing_engine_glow_01.apt')!;
  ok(wg.parent === null && wg.hardpoint === 'wing1' && wg.owner === 0 && whole.attachments.every((d: Def) => d.parent !== undefined), 'assembleShip: the same child is on the hull by index, owned by the engine, and nothing is by name');
  // A failed model: noted, its client data never read.
  const broken = 'object/tangible/ship/attachment/wing/shared_broken.iff';
  let read = false;
  const r = assembleShip({ hardpoints: [] }, [{ source: 'WING', template: broken, hardpoint: null, place: null, turn: { angle: 10, time: 1 } }], [], { ...deps, childrenOf: (t: string) => { if (t === broken) read = true; return []; } });
  ok(r.attachments.length === 0 && !read && r.notes.some((n: string) => n.startsWith('WING wing/shared_broken.iff') || n.includes('broken.iff: no appearance')), 'a node whose model fails is noted, and its children are not expanded');
  // Depth: a chain of templates each listing the next goes four deep under the hull and no further.
  const chain: Record<string, Child[]> = {};
  const models: Record<string, string[]> = {};
  for (let i = 0; i < 8; i++) {
    models[`t${i}`] = [];
    chain[`t${i}`] = [{ source: 'CHL2', template: `t${i + 1}`, hardpoint: null, place: [0, 0, 1, 0, 0, 0] }];
  }
  const deep = assembleShip({ hardpoints: [] }, [{ source: 'CHL2', template: 't0', hardpoint: null, place: [0, 0, 1, 0, 0, 0] }], [], world({ models, children: chain }).deps);
  ok(deep.attachments.length === 5 && deep.attachments.every((d: Def, i: number) => d.parent === (i === 0 ? null : i - 1)), 'expansion stops at a depth of four: nodes to depth five, the fifth not expanded');
  ok(modelCalls.length > 0, 'the fake archive was consulted');
}

// ---- place rounding, the status and the ships log ----
{
  const { deps } = world({ models: { w: [] } });
  const r = assembleShip({ hardpoints: [] }, [{ source: 'WING', template: 'w', hardpoint: null, place: [f32(-2.277), f32(0.394), -0, 0, 0, f32(90)], turn: { angle: f32(-14), time: 3 } }], [], deps);
  const d: Def = r.attachments[0];
  ok(same(d.place, [-2.277, 0.394, 0, 0, 0, 90]) && !Object.is(d.place![2], -0) && d.turn!.angle === -14, 'places and turns are written to five places, with no -0');
  ok(SHIP_ASSEMBLY_FORMAT === 2, 'the assembly format is 2');
  const tree = { ships: [
    { id: 'a', chassis: 'player_a', attachments: [{ kind: 'wing', file: 'w.glb', parent: null, turn: { angle: -14, time: 3 } }, { kind: 'component', file: 'g.glb', slot: 'engine', parent: 0 }, { kind: 'carrier', file: 'n.glb', parent: null, standInFor: 'engine' }] },
    { id: 'b', chassis: null, attachments: [] },
    { id: 'c', attachments: [{ kind: 'wing', file: 'w.glb', angle: -14, hinge: [0, 0, 0, 0, 0, 0], time: 3 }] },
  ] };
  const st = assemblyStatus(tree);
  ok(st.hung === 3 && st.winged === 1 && st.old === 1, 'status: parts hung without the filled stand-in, ships with wings that open, and the one converted before (no chassis key)');
  const log: string[] = [];
  const built = buildShips(['object/ship/player/shared_player_xwing.iff', 'object/ship/player/shared_player_old.iff'], {
    convert: () => ({ model: 'm', file: 'm.glb', bounds: { min: [-1, 0, -1], max: [1, 1, 1] } }),
    extrasOf: (t: string) => (t.includes('xwing') ? { attachments: tree.ships[0].attachments, thrusters: [], contrails: [], cockpit: null, notes: [], chassis: 'player_xwing', wingOpenSpeedFactor: 0.95 } : { attachments: [], thrusters: [], contrails: [], cockpit: null, notes: [] }),
  }, { log: (m: string) => log.push(m) });
  const xw = built.ships.find((s: { id: string }) => s.id === 'xwing')!;
  const old = built.ships.find((s: { id: string }) => s.id === 'old')!;
  ok(xw.chassis === 'player_xwing' && xw.wingOpenSpeedFactor === 0.95 && !('chassis' in old), 'the manifest writes chassis and wingOpenSpeedFactor only for ships assembled as a tree');
  ok(log.some((l) => l.includes('1 wings (0 on wings, 1 that open: -14° in 3 s), 1 carriers, 0 on/off appearances, 1 parts (engine at the origin), 1 riding a wing, 1 stand-in for a filled slot')), 'the ships log counts wings, carriers, on/off appearances, parts and stand-ins');
}

console.log(`${checks} checks passed`);
