// A ship's fit at run time (src/vehicles/shipFit.ts) and on the wire (server/shipWire.mjs): resolving a
// saved fit against a hull, the parts it hangs, what changes between two fits, what each gun fires, the
// page's labels, and the limits a fit is packed to and the relay checks. Synthetic tables only.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DROID_SHOWN,
  DROID_SHOWN_BY_HULL,
  FIT_LIMITS,
  boltSlotOf,
  changedSlots,
  componentIndex,
  droidShown,
  droidSink,
  fitKey,
  gunWeapon,
  isDefaultPaint,
  lookOf,
  packFit,
  partsOf,
  patternLabel,
  resolveFit,
  samePaint,
  slotLabel,
  stockFit,
  type ComponentDef,
  type DroidDef,
  type FitDef,
  type ShipFit,
} from '../../../src/vehicles/shipFit.ts';
import { cleanShip } from '../../../server/shipWire.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- fixtures ---------------------------------------------------------------------------------------

const components: ComponentDef[] = [
  { name: 'eng_s01_a', type: 'engine', compat: 'eng_0', label: 'Engine A', template: 't/eng_a' }, // 0
  { name: 'eng_s01_b', type: 'engine', compat: 'eng_0', label: 'Engine B', template: 't/eng_b' }, // 1
  { name: 'eng_s02', type: 'engine', compat: 'eng_0', label: 'Engine C', template: 't/eng_c' }, // 2
  { name: 'eng_nomodel', type: 'engine', compat: 'eng_0', label: 'Engine D', template: 't/eng_d' }, // 3
  { name: 'wpn_red', type: 'weapon', compat: 'wpn_0', label: 'Red', template: 't/red', weapon: { projectile: 4, speed: 600, range: 512 } }, // 4
  { name: 'wpn_green', type: 'weapon', compat: 'wpn_0', label: 'Green', template: 't/green', weapon: { projectile: 2, speed: 600, range: 512 } }, // 5
  { name: 'wpn_launcher', type: 'weapon', compat: 'wpn_1', label: 'Launcher', template: 't/launch', weapon: { projectile: 9, speed: 350, range: 512, missile: 1 } }, // 6
  { name: 'cms_chaff', type: 'weapon', compat: 'cms_0', label: 'Chaff', template: 't/cms', weapon: { projectile: 0, speed: 0, range: 0, countermeasure: 1 } }, // 7
  { name: 'wpn_mining', type: 'weapon', compat: 'wpn_mining', label: 'Mining', template: 't/mining', weapon: { projectile: 5, speed: 400, range: 768, mining: 1 } }, // 8
  { name: 'rct_basic', type: 'reactor', compat: 'rct_0', label: 'Reactor', template: 't/rct' }, // 9
  { name: 'rct_test', type: 'reactor', compat: 'rct_0', label: 'Test', template: 't/rct_test' }, // 10
  { name: 'wpn_turret_base', type: 'weapon', compat: 'fixed_x', label: 'Base', template: 't/base', weapon: { projectile: 16, speed: 600, range: 512 } }, // 11
];
const index = componentIndex(components);

const def: FitDef = {
  chassis: 'player_testwing',
  openSpeedFactor: 0.95,
  droid: 'astromech',
  slots: [
    { slot: 'reactor', compat: ['rct_0'], looks: [], stock: 'rct_basic' },
    {
      slot: 'engine',
      compat: ['eng_0'],
      stock: 'eng_s01_a',
      looks: [
        { parts: [{ file: 'eng_pos_s01.glb', hardpoint: 'engine_pos1', template: 't/p1' }, { file: 'eng_neg_s01.glb', hardpoint: 'engine_neg1', template: 't/n1', children: [{ kind: 'engine', file: 'eng_on.glb', parent: null, hardpoint: 'engine_on1', place: null }] }], components: [0, 1] },
        { parts: [{ file: 'eng_pos_s02.glb', hardpoint: 'engine_pos1', template: 't/p2' }], components: [2] },
        { parts: [], components: [3], noModel: true },
      ],
    },
    { slot: 'weapon_0', compat: ['wpn_0'], stock: 'wpn_red', looks: [{ parts: [{ file: 'gun_s01.glb', hardpoint: 'weapon1_pos1', template: 't/g1' }], components: [4] }, { parts: [{ file: 'gun_s05.glb', hardpoint: 'weapon1_pos1', template: 't/g5' }], components: [5, 8] }] },
    { slot: 'weapon_1', compat: ['wpn_0'], stock: 'wpn_red', looks: [{ parts: [{ file: 'gun_s01.glb', hardpoint: 'weapon1_neg1', template: 't/g1' }], components: [4] }] },
    { slot: 'weapon_3', compat: ['wpn_1'], stock: 'wpn_launcher', looks: [] },
    { slot: 'weapon_4', compat: ['cms_0'], stock: 'cms_chaff', looks: [] },
    { slot: 'modification_0', compat: ['mod_testwing'], stock: null, looks: [] },
    { slot: 'weapon_8', compat: [], stock: 'wpn_turret_base', fixed: true, looks: [{ parts: [{ file: 'base.glb', hardpoint: 'turret8', template: 't/base' }], components: [11] }] },
  ],
  paint: {
    shaders: ['shader/testwing_main.sht'],
    variables: [
      { name: 'index_texture_1', kind: 'index', count: 8, fewest: 2, default: 0 },
      { name: 'index_color_1', kind: 'palette', palette: 'palette/starships_general.pal', size: 64, default: 40 },
      { name: 'index_color_2', kind: 'palette', palette: 'palette/starships_general.pal', size: 64, default: 13 },
    ],
  },
};
const computerDef: FitDef = { ...def, droid: 'computer' };
const droids: DroidDef[] = [
  { id: 'navicomputer_3', kind: 'computer', label: 'v3 Flight Computer', model: null },
  { id: 'r2', kind: 'astromech', label: 'R2 unit', model: 'mobiles/models/astromech_r2.glb', heads: { naboo_n1: 'ships/astromech_r2_n1ship_head.glb' } },
];

// --- 1: stock --------------------------------------------------------------------------------------
{
  const f = resolveFit(def, components, index, droids, null);
  ok(f.components.engine === 'eng_s01_a' && f.components.weapon_0 === 'wpn_red' && f.components.reactor === 'rct_basic', '1: every slot is stock with no saved fit');
  ok(f.looks.engine === 0 && f.looks.weapon_0 === 0 && f.looks.reactor === -1, '1: the looks come from the stock components (-1 where the slot shows none)');
  ok(f.components.modification_0 === null && f.looks.modification_0 === -1, '1: a slot whose stock is null is empty');
  ok(f.paint.index_texture_1 === 0 && f.paint.index_color_1 === 40 && f.paint.index_color_2 === 13 && !f.painted, '1: the paint is at its defaults and not painted');
  ok(f.droid === null, '1: no droid is stock');
  ok(JSON.stringify(stockFit()) === JSON.stringify({ components: {}, paint: {} }), '1: stockFit is empty');
}

// --- 2: components ---------------------------------------------------------------------------------
{
  const saved: ShipFit = { components: { engine: 'eng_s02', weapon_0: 'wpn_launcher', weapon_1: 'nope', reactor: 'rct_test', weapon_3: '', gone_slot: 'eng_s02', weapon_8: 'wpn_red' }, paint: {} };
  const f = resolveFit(def, components, index, droids, saved);
  ok(f.components.engine === 'eng_s02' && f.looks.engine === 1, '2: a saved compatible component is used, with its look');
  ok(f.components.weapon_0 === 'wpn_red' && f.notes.some((n) => n.startsWith('weapon_0: wpn_launcher does not fit')), '2: an incompatible one falls back to stock with a note');
  ok(f.components.weapon_1 === 'wpn_red' && f.notes.some((n) => n.startsWith('weapon_1: nope is not in the pack')), '2: an unknown one falls back to stock with a note');
  ok(f.components.reactor === 'rct_basic' && f.notes.some((n) => n.startsWith('reactor: rct_test is a test component')), '2: a hidden (test) one falls back to stock with a note');
  ok(f.components.weapon_3 === null && f.looks.weapon_3 === -1, "2: '' leaves the slot empty, look -1");
  ok(!('gone_slot' in f.components) && f.notes.some((n) => n.startsWith('gone_slot')), '2: a saved slot the hull lacks is dropped with a note');
  ok(f.components.weapon_8 === 'wpn_turret_base', '2: a saved value for a fixed slot is ignored');
  const noModel = resolveFit(def, components, index, droids, { components: { engine: 'eng_nomodel' }, paint: {} });
  ok(noModel.looks.engine === 2, '2: a component whose look has no model keeps that look index');
}

// --- 3: the droid ----------------------------------------------------------------------------------
{
  ok(resolveFit(def, components, index, droids, { components: {}, paint: {}, droid: 'r2' }).droid === 'r2', "3: 'r2' on an astromech hull is kept");
  ok(resolveFit(computerDef, components, index, droids, { components: {}, paint: {}, droid: 'r2' }).droid === null, "3: 'r2' on a computer hull gives none");
  ok(resolveFit(computerDef, components, index, droids, { components: {}, paint: {}, droid: 'navicomputer_3' }).droid === 'navicomputer_3', "3: 'navicomputer_3' on a computer hull is kept");
  ok(resolveFit(def, components, index, droids, { components: {}, paint: {}, droid: 'r9' }).droid === null, '3: an unknown droid gives none');
}

// --- 4: paint --------------------------------------------------------------------------------------
{
  const f = resolveFit(def, components, index, droids, { components: {}, paint: { index_texture_1: 99, index_color_1: 70, index_color_2: -3, bogus: 5 } });
  ok(f.paint.index_texture_1 === 7, '4: an index value 99 with count 8 clamps to 7');
  ok(f.paint.index_color_1 === 63, '4: a palette value 70 with size 64 clamps to 63');
  ok(f.paint.index_color_2 === 0, '4: a negative value clamps to 0');
  ok(!('bogus' in f.paint) && f.notes.some((n) => n.includes('bogus')), '4: an unknown variable is dropped');
  ok(f.painted, '4: any value off its default sets painted');
  const g = resolveFit(def, components, index, droids, { components: {}, paint: { index_color_1: 40.4 } });
  ok(g.paint.index_color_1 === 40 && !g.painted, '4: a fractional value rounds (40.4 is the default 40)');
  ok(isDefaultPaint(def, { index_color_1: 40 }) && !isDefaultPaint(def, { index_color_1: 41 }), '4: isDefaultPaint follows the defaults');
}

// --- 5: partsOf -----------------------------------------------------------------------------------
{
  const f = resolveFit(def, components, index, droids, null);
  const parts = partsOf(def, 'testwing', f, droids);
  ok(parts.map((p) => `${p.slot}:${p.path}`).join(' ') === 'engine:ships/eng_pos_s01.glb engine:ships/eng_neg_s01.glb weapon_0:ships/gun_s01.glb weapon_1:ships/gun_s01.glb weapon_8:ships/base.glb', '5: each filled slot\'s look parts as ships/<file>, fixed slots included, in slot order');
  ok(parts[1].children?.[0].file === 'ships/eng_on.glb' && parts[1].children?.[0].parent === null, "5: a part's children come with it, their files under ships/");
  const withDroid = partsOf(def, 'testwing', resolveFit(def, components, index, droids, { components: {}, paint: {}, droid: 'r2' }), droids);
  const last = withDroid[withDroid.length - 1];
  ok(last.slot === 'droid' && last.path === 'mobiles/models/astromech_r2.glb' && last.skinned === true && last.hardpoint === 'astromech', "5: the droid's skinned model comes last, at the astromech hardpoint");
  const n1 = partsOf(def, 'naboo_n1', resolveFit(def, components, index, droids, { components: {}, paint: {}, droid: 'r2' }), droids);
  ok(n1[n1.length - 1].path === 'ships/astromech_r2_n1ship_head.glb' && !n1[n1.length - 1].skinned, "5: on the N-1 it is the ship's own droid head, not skinned");
  const computer = partsOf(computerDef, 'testwing', resolveFit(computerDef, components, index, droids, { components: {}, paint: {}, droid: 'navicomputer_3' }), droids);
  ok(!computer.some((p) => p.slot === 'droid'), '5: a flight computer gives no part');
  const empty = partsOf(def, 'testwing', resolveFit(def, components, index, droids, { components: { engine: '', weapon_0: 'wpn_red' }, paint: {} }), droids);
  ok(!empty.some((p) => p.slot === 'engine'), '5: an empty slot gives nothing');
  const nm = partsOf(def, 'testwing', resolveFit(def, components, index, droids, { components: { engine: 'eng_nomodel' }, paint: {} }), droids);
  ok(!nm.some((p) => p.slot === 'engine'), '5: a component with no model on this hull gives nothing');
}

// --- 6: what changes ------------------------------------------------------------------------------
{
  const a = resolveFit(def, components, index, droids, null);
  const same = resolveFit(def, components, index, droids, { components: { engine: 'eng_s01_b' }, paint: {} });
  ok(changedSlots(def, a, same).length === 0, '6: a swap within the same look changes no parts');
  const other = resolveFit(def, components, index, droids, { components: { engine: 'eng_s02' }, paint: {} });
  ok(changedSlots(def, a, other).join() === 'engine', '6: a swap across looks names the slot');
  const droid = resolveFit(def, components, index, droids, { components: {}, paint: {}, droid: 'r2' });
  ok(changedSlots(def, a, droid).join() === 'droid', "6: a droid change names 'droid'");
  const painted = resolveFit(def, components, index, droids, { components: {}, paint: { index_color_1: 5 } });
  ok(samePaint(a, same) && !samePaint(a, painted) && changedSlots(def, a, painted).length === 0, '6: samePaint follows the values only');
  ok(lookOf(def, 'engine', 2) === 1 && lookOf(def, 'engine', 4) === -1 && lookOf(def, 'nothing', 0) === -1, '6: lookOf finds the look a component shows, else -1');
}

// --- 7: what a gun fires ---------------------------------------------------------------------------
{
  const f = resolveFit(def, components, index, droids, { components: { weapon_0: 'wpn_green' }, paint: {} });
  const fallback = boltSlotOf(components, index, f);
  const g0 = gunWeapon(components, index, f, 'weapon_0', fallback);
  ok(!!g0 && g0.name === 'wpn_green' && g0.projectile === 2 && g0.speed === 600 && g0.range === 512, '7: a blaster gives its projectile, speed and range');
  ok(gunWeapon(components, index, f, 'weapon_3', fallback) === null, '7: a missile launcher gives null');
  ok(gunWeapon(components, index, f, 'weapon_4', fallback) === null, '7: countermeasures give null');
  const emptied = resolveFit(def, components, index, droids, { components: { weapon_1: '' }, paint: {} });
  ok(gunWeapon(components, index, emptied, 'weapon_1', 'weapon_0') === null, '7: an empty slot gives null');
  ok(fallback === 'weapon_0' && gunWeapon(components, index, f, null, fallback)?.name === 'wpn_green', "7: a hull gun (slot null) takes the fallback slot's");
  ok(gunWeapon(components, index, f, 'engine', fallback)?.name === 'wpn_green', "7: a gun on a part of a slot that is not a weapon slot takes the fallback slot's");
}

// --- 8: labels ------------------------------------------------------------------------------------
{
  const v = def.paint!.variables[0];
  ok(patternLabel(v, 2) === 'Pattern 3 of 8 (some parts have 2)', '8: patternLabel says "some parts have 2" when fewest < count');
  ok(patternLabel({ ...v, fewest: 8 }, 2) === 'Pattern 3 of 8' && patternLabel({ ...v, fewest: undefined }, 0) === 'Pattern 1 of 8', '8: and not otherwise');
  const byName = (s: string) => slotLabel(def.slots.find((x) => x.slot === s)!);
  ok(byName('engine') === 'Engine' && byName('weapon_0') === 'Weapon 1' && byName('weapon_1') === 'Weapon 2', '8: slot labels: Engine, Weapon 1, Weapon 2');
  ok(byName('weapon_3') === 'Missile launcher' && byName('weapon_4') === 'Countermeasures' && byName('modification_0') === 'Modification 1', '8: Missile launcher, Countermeasures, Modification 1');
  ok(slotLabel({ slot: 'shield_1', compat: [], looks: [], stock: null }) === 'Shield 2' && slotLabel({ slot: 'droid_interface', compat: [], looks: [], stock: null }) === 'Droid interface' && slotLabel({ slot: 'armor_0', compat: [], looks: [], stock: null }) === 'Armour 1', '8: Shield 2, Droid interface, Armour 1');
}

// --- 9: packing and the wire ------------------------------------------------------------------------
{
  const many: Record<string, string> = {};
  for (let i = 0; i < 40; i++) many[`slot_${i}`] = 'eng_s02';
  const paint: Record<string, number> = {};
  for (let i = 0; i < 12; i++) paint[`index_${i}`] = i;
  const packed = packFit({ components: { ...many, 'bad key!': 'x', long: 'a'.repeat(80), bad_value: '<script>' } as Record<string, string>, paint: { ...paint, nan: Number.NaN, inf: Infinity }, droid: 'r2' });
  ok(Object.keys(packed.components).length === FIT_LIMITS.slots && Object.keys(packed.paint).length === FIT_LIMITS.paint && packed.droid === 'r2', '9: packFit keeps at most 24 components, 8 paint values and a droid');
  const junk = packFit({ components: { engine: 5 as unknown as string, 'Bad': 'x', ok_slot: 'fine' }, paint: { a: Number.NaN, b: 1.6, c: 999 }, droid: 'x'.repeat(40) });
  ok(JSON.stringify(junk) === JSON.stringify({ components: { ok_slot: 'fine' }, paint: { b: 2, c: 255 } }), `9: packFit drops non-string and over-long names and non-finite numbers, rounds and clamps (${JSON.stringify(junk)})`);
  const fit: ShipFit = packFit({ components: { engine: 'eng_s02', weapon_0: '' }, paint: { index_color_1: 20, index_texture_1: 2 }, droid: 'r2' });
  const wire = cleanShip({ id: 'xwing', fit });
  ok(JSON.stringify(wire) === JSON.stringify({ id: 'xwing', fit }), '9: cleanShip(packFit(x)) round-trips');
  ok(cleanShip({ id: 5, fit }) === undefined && cleanShip(null) === undefined && cleanShip({ id: 'x'.repeat(49), fit }) === undefined, '9: cleanShip rejects a number id, nothing, and an over-long id');
  const dirty = cleanShip({ id: 'xwing', fit: { components: { engine: '<script>', '<b>': 'eng_s02', weapon_0: 'wpn_red' }, paint: { index_color_1: 1e9, index_color_2: 3, index_texture_1: 2.5 }, droid: 'r'.repeat(40) } });
  ok(JSON.stringify(dirty) === JSON.stringify({ id: 'xwing', fit: { components: { weapon_0: 'wpn_red' }, paint: { index_color_2: 3 } } }), `9: cleanShip drops <script> names, 1e9 and fractional paint and a 40-character droid (${JSON.stringify(dirty)})`);
  const flood: Record<string, string> = {};
  for (let i = 0; i < 30; i++) flood[`s${i}`] = 'eng_s02';
  ok(Object.keys(cleanShip({ id: 'xwing', fit: { components: flood, paint: {} } })!.fit.components).length === 24, '9: cleanShip keeps at most 24 components');
}

// --- 10: fitKey -----------------------------------------------------------------------------------
{
  const a = resolveFit(def, components, index, droids, { components: { engine: 'eng_s02', weapon_0: 'wpn_green' }, paint: { index_color_1: 3, index_texture_1: 1 } });
  const b = resolveFit(def, components, index, droids, { components: { weapon_0: 'wpn_green', engine: 'eng_s02' }, paint: { index_texture_1: 1, index_color_1: 3 } });
  const reordered = { ...b, components: Object.fromEntries(Object.entries(b.components).reverse()), paint: Object.fromEntries(Object.entries(b.paint).reverse()) };
  ok(fitKey(a) === fitKey(reordered), '10: fitKey is the same for two fits that differ only in key order');
  const c = resolveFit(def, components, index, droids, { components: { engine: 'eng_s02', weapon_0: 'wpn_green' }, paint: { index_color_1: 4, index_texture_1: 1 } });
  const d = resolveFit(def, components, index, droids, { components: { engine: 'eng_s02', weapon_0: 'wpn_green' }, paint: { index_color_1: 3, index_texture_1: 1 }, droid: 'r2' });
  ok(fitKey(a) !== fitKey(c) && fitKey(a) !== fitKey(d), '10: fitKey differs when a value or the droid differs');
}

// --- 11: an astromech sunk in its socket ------------------------------------------------------------
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;
const pack = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets-private');
{
  ok(droidSink(0, 1.064, 1) === 0 && near(droidSink(0, 1.064, 0.35), 1.064 * 0.65, 1e-12) && near(droidSink(0, 1.064, 0), 1.064, 1e-12), '11: shown 1 leaves the droid standing, 0.35 sinks it 65% of its height, 0 sinks it whole');
  ok(near(droidSink(-0.2, 0.8, 0.5), 0.3, 1e-12), '11: a droid whose origin is not at its feet: its middle lands on the hardpoint at shown 0.5');
  ok(droidSink(0, 1, 1.5) === 0 && near(droidSink(0, 1, -1), 1, 1e-12) && droidSink(1, 1, 0.5) === 0 && droidSink(Number.NaN, 1, 0.5) === 0, '11: the share is kept within 0..1, and an empty or broken box sinks nothing');
  ok(droidShown('xwing') === DROID_SHOWN.share && droidShown('vwing') === DROID_SHOWN_BY_HULL.vwing && droidShown('jedi_starfighter') === DROID_SHOWN_BY_HULL.jedi_starfighter, '11: a hull without its own share takes the default');
  // The top share shows: the droid's top stands shown x height over the hardpoint.
  const h = 1.064;
  const top = h - droidSink(0, h, droidShown('xwing'));
  ok(near(top, droidShown('xwing') * h, 1e-12) && top > 0.3 && top < 0.45, `11: an R2 in an X-wing shows ${top.toFixed(2)} m over its socket, its dome and shoulders`);
}
{
  // With the packs: every hull with a socket keeps a sunk R2 or R4 inside its own box, and shows the share over the hardpoint.
  const ships = join(pack, 'ships', 'manifest.json');
  const r4 = join(pack, 'mobiles', 'models', 'astromech_r4.glb');
  if (!existsSync(ships) || !existsSync(r4)) console.log('skip the socket checks: no ships pack or no astromech models');
  else {
    const glb = (file: string) => {
      const b = readFileSync(file);
      return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as { nodes: { name?: string; extras?: { name?: string }; translation?: number[]; children?: number[]; mesh?: number }[]; meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { min?: number[]; max?: number[] }[] };
    };
    const span = (g: ReturnType<typeof glb>) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const m of g.meshes) for (const p of m.primitives) {
        const a = g.accessors[p.attributes.POSITION];
        if (a.min && a.max) {
          lo = Math.min(lo, a.min[1]);
          hi = Math.max(hi, a.max[1]);
        }
      }
      return [lo, hi] as [number, number];
    };
    const tallest = span(glb(r4));
    const list = (JSON.parse(readFileSync(ships, 'utf8')) as { ships: { id: string; file: string; fit?: { droid?: string } | null }[] }).ships.filter((s) => s.fit?.droid === 'astromech');
    ok(list.length === 8, `11: eight hulls take an astromech (${list.map((s) => s.id).join(', ')})`);
    const comps = join(pack, 'ships', 'components.json');
    const packDroids = existsSync(comps) ? ((JSON.parse(readFileSync(comps, 'utf8')) as { droids?: DroidDef[] }).droids ?? []).filter((d) => d.kind === 'astromech') : [];
    for (const s of list) {
      // A hull with the game's own head for every droid (the N-1) shows that head, which is never sunk.
      if (packDroids.length && packDroids.every((d) => d.heads?.[s.id])) {
        ok(true, `11: ${s.id} shows the game's own droid head for every droid: not sunk`);
        continue;
      }
      const g = glb(join(pack, 'ships', s.file));
      const node = g.nodes.find((n) => (n.extras?.name ?? n.name) === 'hp:astromech' || n.name === 'hpastromech');
      if (!node) {
        ok(false, `11: ${s.id} has hp:astromech`);
        continue;
      }
      // Hardpoints hang at the scene's root in these hulls (their parents carry no transform).
      const y = node.translation?.[1] ?? 0;
      const [hullLo] = span(g);
      const feet = y - droidSink(tallest[0], tallest[1], droidShown(s.id));
      ok(feet >= hullLo, `11: ${s.id}: a sunk R4's feet (${feet.toFixed(2)}) stay above the hull's bottom (${hullLo.toFixed(2)})`);
    }
  }
}

console.log(`shipFitRuntime: ${checks} checks passed`);
