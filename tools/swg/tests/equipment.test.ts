// The equipment (src/player/equipment.ts) against fakes: the order a piece goes on in (loaded hidden,
// the recipes settled, prepared, then shown with what it displaces in one step), the queue, reset and a
// character changing under an operation, no record (the creator), no wardrobe, a weapon prepared on every
// hold, the blade left as it was on a restore, the species packs' own pieces for a Wookiee, a destroy and a
// second use that wait their turn, several parts off in one step, a peer's dress (look.ts dressPrepared), and
// a Sullustan's hair, which is no item however its id is spelt.
// Plain node; the module is node-loadable (type-only imports apart from the rules and the item facts).
import assert from 'node:assert/strict';
import { Equipment, HAIR_ELSEWHERE, ITEMS_TUNE, tuneItems, type EquipmentDeps } from '../../../src/player/equipment.ts';
import { dressPrepared } from '../../../src/player/look.ts';
import { ITEMS_MOST } from '../../../src/core/inventory.ts';
import { Trade } from '../../../src/net/trade.ts';
import { LEDGER_TUNING } from '../../../server/ledger.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

type Item = { id: string; kind: string; gender: string; template: string; parts: { name: string; file: string; triangles: number; occlusionLayer: number }[]; name?: string; slots?: string[][] | null; fit?: { block?: string[]; hide?: string[] } };
const part = (n: string) => [{ name: n, file: `${n}.glb`, triangles: 10, occlusionLayer: 2 }];
const item = (id: string, slots: string[][] | null, extra: Partial<Item> = {}): Item => ({ id, kind: 'wearables', gender: 'm', template: `object/tangible/wearables/x/shared_${id}.iff`, parts: part(id), name: id.replace(/_/g, ' '), slots, ...extra });

const JACKET = [['chest2', 'bicep_l', 'bicep_r', 'bracer_upper_l', 'bracer_upper_r', 'bracer_lower_l', 'bracer_lower_r']];
const PADAWAN = [['chest2', 'chest3_l', 'chest3_r', 'bicep_l', 'bicep_r', 'bracer_lower_l', 'bracer_lower_r', 'bracer_upper_l', 'bracer_upper_r', 'cloak', 'pants1', 'pants2', 'shoes']];
const WARDROBE: Item[] = [
  item('shirt_s03', [['chest1']]),
  item('jacket_s02', JACKET),
  item('pants_s04', [['pants1']]),
  item('shoes_s02', [['shoes']]),
  item('robe_jedi_padawan', PADAWAN),
  item('hat_s04', [['hat']]),
];

interface World {
  log: string[];
  deps: EquipmentDeps;
  eq: Equipment;
  worn: Map<string, boolean>;
  player: { equipped: { right: { id: string; class: string } | null; left: { id: string; class: string } | null }; saberOn: boolean };
  setRecord(r: unknown): void;
  setCharacter(c: unknown): void;
  prepareGate: { hold: Promise<void> | null };
}

function setup(opts: { species?: string; wardrobe?: Item[] | null; worn?: string[]; packParts?: string[]; record?: boolean; classId?: 'jedi' | 'bounty_hunter'; recipes?: Record<string, { name: string; default: number; kind?: 'palette' | 'index' }[]> } = {}): World {
  const log: string[] = [];
  const worn = new Map<string, boolean>();
  for (const w of opts.worn ?? []) worn.set(w, true);
  const packParts = opts.packParts ?? [];
  const wardrobe = opts.wardrobe === null ? null : { species: 'human', gender: 'male', items: opts.wardrobe ?? WARDROBE };
  // The recipes' variables by mesh, for a piece's colours: none unless a test hands some in.
  const recipes = opts.recipes ?? {};
  const values = new Map<string, number>();
  const character = {
    manifest: { id: opts.species ?? 'human_male', parts: [] as unknown[] },
    wardrobeDir: 'http://x/wardrobe/human_male/',
    packParts,
    customizer: {
      values,
      settled: () => {
        log.push('settled');
        return Promise.resolve();
      },
      setAll: (v: Record<string, number>) => {
        log.push(`setAll(${Object.entries(v).map(([k, x]) => `${k}=${x}`).join(',')})`);
        for (const [k, x] of Object.entries(v)) values.set(k, x);
      },
      variablesOn: (meshes: Set<string>) => [...meshes].flatMap((m) => (recipes[m] ?? []).map((d) => ({ key: `${m}|${d.name}`, name: d.name, private: true, mesh: m, default: d.default, kind: d.kind ?? 'palette' }))),
    },
    // A part's meshes are the catalogue's part names, as the converter writes them.
    meshesOf: (key: string) => wardrobe?.items.find((i) => i.id === key)?.parts.map((p) => p.name) ?? [key],
    status: () => [{ name: 'body', worn: true, body: true }, ...[...worn].map(([name, on]) => ({ name, worn: on, body: false }))],
    catalogue: async () => {
      if (!wardrobe) throw new Error('no wardrobe for this species');
      return wardrobe;
    },
    packPartOf: (id: string) => packParts.find((p) => p.replace(/_[mf]_l\d+$/, '') === id) ?? null,
    loadPiece: async (key: string) => {
      log.push(`loadPiece(${key})`);
      await tick();
      const known = packParts.includes(key) || !!wardrobe?.items.some((i) => i.id === key);
      if (!known) return { found: false, meshes: [] };
      if (!worn.has(key)) worn.set(key, false);
      return { found: true, meshes: [{ name: `${key}_mesh` }] };
    },
    putOn: (on: string[], off: string[]) => {
      log.push(`putOn([${on.join(',')}],[${off.join(',')}])`);
      for (const k of off) if (worn.has(k)) worn.set(k, false);
      for (const k of on) worn.set(k, true);
    },
  };
  const player = {
    classId: opts.classId ?? 'jedi',
    equipped: { right: null as { id: string; class: string } | null, left: null as { id: string; class: string } | null },
    saberOn: false,
    equip(def: { id: string; class: string }, _model: unknown, hand: 'right' | 'left') {
      log.push(`equip(${def.id},${hand})`);
      this.equipped[hand] = def;
      const blade = !['pistol', 'carbine', 'rifle', 'heavy'].includes(def.class);
      if (blade && this.classId === 'jedi' && !this.saberOn) this.saberOn = true;
      return blade ? 'jedi' : 'bounty_hunter';
    },
    unequip(hand: 'right' | 'left') {
      log.push(`unequip(${hand})`);
      this.equipped[hand] = null;
    },
    toggleSaber() {
      log.push('toggleSaber');
      this.saberOn = !this.saberOn;
    },
  };
  const weapons = {
    weapons: [
      { id: 'pistol_cdef', class: 'pistol', slots: [['hold_r']], name: 'CDEF Pistol' },
      { id: 'carbine_cdef', class: 'carbine', slots: [['hold_r', 'hold_l']] },
      { id: 'sword_lightsaber_training', class: 'lightsaber', slots: [['hold_r', 'hold_l']] },
      { id: 'baton_stun', class: 'sword1h', slots: [['hold_r']] },
    ],
    model: async (def: { id: string }) => {
      log.push(`model(${def.id})`);
      return { name: def.id };
    },
    iconUrl: () => null,
  };
  let record: Record<string, unknown> | null = opts.record === false ? null : { id: 'r1', name: 'Tester', species: opts.species ?? 'human_male', class: 'jedi', outfit: [...(opts.worn ?? [])], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0 };
  let current: unknown = character;
  const gate: { hold: Promise<void> | null } = { hold: null };
  const deps = {
    character: () => current,
    player,
    weaponsLoaded: async () => weapons,
    prepare: async (root: { name?: string }) => {
      log.push(`prepare(${root.name ?? '?'})`);
      if (gate.hold) await gate.hold;
      await tick();
    },
    record: () => record,
    persist: () => {
      log.push('persist');
    },
    changed: () => {},
    baseUrl: '/',
  } as unknown as EquipmentDeps;
  const eq = new Equipment(deps);
  return {
    log,
    deps,
    eq,
    worn,
    player: player as unknown as World['player'],
    setRecord: (r) => {
      record = r as Record<string, unknown> | null;
    },
    setCharacter: (c) => {
      current = c;
    },
    prepareGate: gate,
  };
}

// --- 1: two uses in a row run in order -----------------------------------------------------------
{
  const w = setup();
  const a = w.eq.use('wear', 'shirt_s03');
  const b = w.eq.use('wear', 'hat_s04');
  await Promise.all([a, b]);
  const putA = w.log.indexOf('putOn([shirt_s03],[])');
  const loadB = w.log.indexOf('loadPiece(hat_s04)');
  ok(putA >= 0 && loadB > putA, "the second use's loadPiece comes after the first's putOn");
}

// --- 2: the Padawan robe over a jacket: prepared before anything comes off -----------------------
{
  const w = setup({ worn: ['shirt_s03', 'jacket_s02', 'pants_s04', 'shoes_s02'] });
  await w.eq.itemContext();
  w.log.length = 0;
  const note = await w.eq.use('wear', 'robe_jedi_padawan');
  const order = w.log.filter((l) => !l.startsWith('persist'));
  ok(order[0] === 'loadPiece(robe_jedi_padawan)' && order[1] === 'settled' && order[2].startsWith('prepare(') && order[3].startsWith('putOn('), `load, settled, prepare, then putOn (${order.join(' ')})`);
  ok(order[3] === 'putOn([robe_jedi_padawan],[jacket_s02,pants_s04,shoes_s02])', 'the jacket, the trousers and the shoes come off in the same step as the robe goes on');
  ok(w.worn.get('shirt_s03') === true && w.worn.get('jacket_s02') === false, 'the shirt stays on');
  ok(/took off/.test(note.note), `the note names what came off (${note.note})`);
  const off = await w.eq.use('wear', 'robe_jedi_padawan');
  ok(w.worn.get('robe_jedi_padawan') === false && /off/.test(off.note), 'a second use takes it off');
}

// --- 3: load empties the hands and turns the blade off first; saves nothing before the migration ---
{
  const w = setup();
  w.player.equipped.right = { id: 'baton_stun', class: 'sword1h' };
  w.player.saberOn = true;
  const rec = { id: 'old', name: 'Old', species: 'human_male', class: 'jedi', outfit: ['shirt_s03'], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0 } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.load(rec as never);
  ok(w.log[0] === 'unequip(right)' && w.log[1] === 'unequip(left)' && w.log[2] === 'toggleSaber', 'both hands emptied and the blade off before anything else');
  const firstPersist = w.log.indexOf('persist');
  ok(firstPersist === w.log.length - 1, 'one save, after the migration');
  const items = rec.items as { id: string; kind: string }[];
  ok(rec.inv === 1 && items.some((o) => o.id === 'shirt_s03') && items.some((o) => o.id === 'sword_lightsaber_training'), 'the old record owns what it wears and the kit');
  ok(rec.held === undefined, "an old character does not suddenly hold the kit's weapon");
}

// --- 4: no record (the creator): dressing works, nothing is saved or given ------------------------
{
  const w = setup({ record: false });
  const note = await w.eq.wear('shirt_s03', { give: true });
  ok(w.log.some((l) => l.startsWith('putOn([shirt_s03]')), `wear still puts on (${note})`);
  ok(!w.log.includes('persist'), 'persist is never called');
  ok(w.eq.give('wear', 'hat_s04') === false, 'give returns false');
}

// --- 5: no wardrobe converted: load resolves, a pistol can be held, clothes cannot -----------------
{
  const w = setup({ wardrobe: null });
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'bounty_hunter', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0 } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.load(rec as never);
  ok(rec.inv === 1, 'load resolves and migrates');
  const kitIds = (rec.items as { id: string }[]).map((o) => o.id);
  ok(kitIds.includes('pistol_cdef') && !kitIds.includes('npe_shirt'), 'the kit is weapons only');
  const held = await w.eq.use('weapon', 'pistol_cdef');
  ok(w.player.equipped.right?.id === 'pistol_cdef' && held.wants === 'bounty_hunter', `a pistol can be held (${held.note})`);
  const note = await w.eq.wear('shirt_s03');
  ok(note === 'no wardrobe converted', `wear answers "no wardrobe converted" (${note})`);
}

// --- 6: reset while a wear waits on prepare ------------------------------------------------------
{
  const w = setup();
  let release!: () => void;
  w.prepareGate.hold = new Promise<void>((r) => (release = r));
  const pending = w.eq.wear('hat_s04');
  while (!w.log.some((l) => l.startsWith('prepare('))) await tick();
  w.eq.reset();
  release();
  const note = await pending;
  ok(note === 'dropped', 'the operation ends dropped');
  ok(!w.log.some((l) => l.startsWith('putOn(')), 'and never calls putOn');
  // A character swapped under it is the same.
  const w2 = setup();
  let release2!: () => void;
  w2.prepareGate.hold = new Promise<void>((r) => (release2 = r));
  const pending2 = w2.eq.wear('hat_s04');
  while (!w2.log.some((l) => l.startsWith('prepare('))) await tick();
  w2.setCharacter({ ...w2.deps.character() });
  release2();
  ok((await pending2) === 'dropped' && !w2.log.some((l) => l.startsWith('putOn(')), 'a character changed under it drops it too');
}

// --- 7: every hold prepares -----------------------------------------------------------------------
{
  const w = setup();
  const def = { id: 'baton_stun', class: 'sword1h', slots: [['hold_r']] } as never;
  await w.eq.hold(def, 'right');
  w.eq.stow('right');
  await w.eq.hold(def, 'right');
  ok(w.log.filter((l) => l === 'prepare(baton_stun)').length === 2, 'a second hold of the same weapon prepares again');
  const noPrep = setup();
  await noPrep.eq.hold(def, 'right', { prepare: false });
  ok(!noPrep.log.some((l) => l.startsWith('prepare(')), 'prepare: false skips it');
}

// --- 8: restoreHeld leaves the blade as it was -----------------------------------------------------
{
  const w = setup();
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, items: [], held: { right: 'sword_lightsaber_training', left: 'baton_stun' } } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.restoreHeld();
  ok(w.log.includes('equip(sword_lightsaber_training,right)') && w.player.equipped.left?.id === 'baton_stun', 'both saved hands are restored');
  ok(!w.player.saberOn, 'the blade the equip lit is off again');
  const held = rec.held as { right?: string; left?: string };
  ok(held.right === 'sword_lightsaber_training' && held.left === 'baton_stun', 'held survives the restore');
  const gone = setup();
  const rec2 = { ...rec, held: { right: 'not_a_weapon' } } as Record<string, unknown>;
  gone.setRecord(rec2);
  await gone.eq.restoreHeld();
  ok(!(rec2.held as { right?: string }).right, 'an id the rack lacks is dropped from held');
}

// --- 9: a Wookiee: the pack's own shirt, and a jacket the table blocks ------------------------------
{
  const wookieeWardrobe = [item('shirt_s03', [['chest1']], { fit: { block: ['wookiee_male'] } }), item('jacket_s02', JACKET, { fit: { block: ['wookiee_male'] } })];
  const w = setup({ species: 'wookiee_male', wardrobe: wookieeWardrobe, packParts: ['shirt_s03_m_l0', 'pants_s01_m_l0'] });
  await w.eq.use('wear', 'shirt_s03');
  ok(w.log.includes('putOn([shirt_s03_m_l0],[])'), "the Wookiee's shirt goes on as the pack's part");
  w.log.length = 0;
  const r = await w.eq.use('wear', 'jacket_s02');
  ok(r.note === 'Wookiees cannot wear this', `a blocked jacket is refused (${r.note})`);
  ok(!w.log.some((l) => l.startsWith('loadPiece(')), 'and nothing is loaded');
  const off = await w.eq.use('wear', 'shirt_s03');
  ok(w.worn.get('shirt_s03_m_l0') === false && /off/.test(off.note), 'a second double-click takes the pack shirt off');
  const forced = await w.eq.wear('jacket_s02', { force: true });
  ok(!/cannot/.test(forced) && w.worn.get('jacket_s02') === true, 'the give tab forces a blocked piece on');
}

// --- 10: a destroy asked while the same item is being put on waits for it, and sticks ----------------
{
  const w = setup();
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, items: [{ id: 'jacket_s02', kind: 'wear', got: 1 }] } as Record<string, unknown>;
  w.setRecord(rec);
  let release!: () => void;
  w.prepareGate.hold = new Promise<void>((r) => (release = r));
  const wearing = w.eq.use('wear', 'jacket_s02');
  while (!w.log.some((l) => l.startsWith('prepare('))) await tick();
  const destroying = w.eq.destroy('wear', 'jacket_s02');
  w.prepareGate.hold = null;
  release();
  const [on, gone] = await Promise.all([wearing, destroying]);
  const putOn = w.log.indexOf('putOn([jacket_s02],[])');
  const takenOff = w.log.indexOf('putOn([],[jacket_s02])');
  ok(putOn >= 0 && takenOff > putOn, `the put-on finishes first, then the destroy takes it off (${on.note}; ${gone})`);
  const items = rec.items as { id: string }[];
  ok(!items.some((o) => o.id === 'jacket_s02') && w.worn.get('jacket_s02') === false, "the jacket stays destroyed: the put-on's save did not give it back");
}

// --- 11: two quick uses of one item put it on and take it off again ---------------------------------
{
  const w = setup();
  const a = w.eq.use('wear', 'hat_s04');
  const b = w.eq.use('wear', 'hat_s04');
  const [first, second] = await Promise.all([a, b]);
  ok(w.log.indexOf('putOn([hat_s04],[])') >= 0 && w.log.indexOf('putOn([],[hat_s04])') > w.log.indexOf('putOn([hat_s04],[])'), `the second use takes off what the first put on (${first.note}; ${second.note})`);
  ok(w.worn.get('hat_s04') === false, 'the hat ends off');
  const g = setup();
  const x = g.eq.use('weapon', 'baton_stun');
  const y = g.eq.use('weapon', 'baton_stun');
  await Promise.all([x, y]);
  ok(g.player.equipped.right === null && g.log.filter((l) => l === 'equip(baton_stun,right)').length === 1, 'two quick uses of a weapon take it up once and put it away');
}

// --- 12: the give tab's "Take everything off" is one step and one save ---------------------------------
{
  const w = setup({ worn: ['shirt_s03', 'jacket_s02', 'hat_s04'] });
  await w.eq.itemContext();
  w.log.length = 0;
  w.eq.takeOffParts(['shirt_s03', 'jacket_s02', 'hat_s04']);
  ok(w.log.filter((l) => l.startsWith('putOn(')).length === 1 && w.log.includes('putOn([],[shirt_s03,jacket_s02,hat_s04])'), 'all three come off in one putOn');
  ok(w.log.filter((l) => l === 'persist').length === 1, 'and the record is saved once');
}

// --- 13: dressPrepared (a peer's change of clothes): only what was not on is prepared, then one step -----
{
  const run = async (alive: (log: string[]) => boolean) => {
    const log: string[] = [];
    const worn = new Map<string, boolean>([
      ['body', true],
      ['a', true],
      ['c', true],
    ]);
    const known = new Set(['a', 'b', 'c']);
    const fake = {
      status: () => [...worn].map(([name, on]) => ({ name, worn: on, body: name === 'body' })),
      loadPiece: async (key: string) => {
        log.push(`loadPiece(${key})`);
        await tick();
        if (!known.has(key)) return { found: false, meshes: [] };
        if (!worn.has(key)) worn.set(key, false);
        return { found: true, meshes: [{ name: `${key}_mesh` }] };
      },
      customizer: {
        settled: async () => {
          log.push('settled');
        },
      },
      putOn: (on: string[], off: string[]) => {
        log.push(`putOn([${on.join(',')}],[${off.join(',')}])`);
        for (const k of off) worn.set(k, false);
        for (const k of on) worn.set(k, true);
      },
    };
    const warned: string[] = [];
    const prepare = async (m: { name?: string }) => {
      log.push(`prepare(${m.name ?? '?'})`);
      await tick();
    };
    await dressPrepared(fake as never, ['a', 'b', 'zz'], '/', prepare as never, () => alive(log), (k) => warned.push(k));
    return { log, worn, warned };
  };
  const r = await run(() => true);
  ok(r.log.join(' ') === 'loadPiece(a) loadPiece(b) loadPiece(zz) settled prepare(b_mesh) putOn([a,b],[c])', `load each, settle, prepare only the new piece, then one putOn with the rest off (${r.log.join(' ')})`);
  ok(r.warned.join() === 'zz' && r.worn.get('b') === true && r.worn.get('c') === false && r.worn.get('a') === true, 'a piece the wardrobe lacks is warned and left out; the outfit is what is worn');
  const stopped = await run((log) => !log.some((l) => l.startsWith('prepare(')));
  ok(!stopped.log.some((l) => l.startsWith('putOn(')) && stopped.worn.get('c') === true && stopped.worn.get('b') === false, 'a look given up during the first prepare changes nothing worn');
}

// --- 14: a Sullustan's hair is never an item: not owned, not in the worn list, not put on from the backpack -----
{
  // The Sullustan's ids are `sul_hair_s<nn>_<f|m>`, which a hair test spelt `^hair_` took for garments.
  const hair = (id: string) => item(id, [['hair']], { kind: 'hair', template: `object/tangible/hair/sullustan/shared_${id}.iff` });
  const wardrobe = [...WARDROBE, hair('sul_hair_s01_f'), hair('sul_hair_s02_f')];
  const w = setup({ species: 'sullustan_female', wardrobe, worn: ['sul_hair_s01_f', 'shirt_s03'] });
  // A record from before, which owns the style it wore as an item: kept, never used.
  const rec = { id: 'r', name: 'R', species: 'sullustan_female', class: 'jedi', outfit: ['sul_hair_s01_f', 'shirt_s03'], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, items: [{ id: 'sul_hair_s02_f', kind: 'wear', got: 1 }] } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.itemContext();
  ok(w.eq.itemIdOf('sul_hair_s01_f') === null && w.eq.itemIdOf('shirt_s03') === 'shirt_s03', "a worn Sullustan style is no item, as no other style is; the shirt beside it is");
  ok(!('sul_hair_s01_f' in w.eq.snapshot().worn) && 'shirt_s03' in w.eq.snapshot().worn, 'the worn list the backpack and a trade read holds the shirt and not the hair');
  await w.eq.use('wear', 'hat_s04');
  const items = (rec.items as { id: string }[]).map((o) => o.id);
  ok(items.includes('shirt_s03') && items.includes('hat_s04') && !items.includes('sul_hair_s01_f'), `a save owns what is worn but the hair (${items.join(', ')})`);
  ok(items.includes('sul_hair_s02_f'), 'and the style an old record owned is kept: nothing an owned list holds is lost');
  w.log.length = 0;
  const used = await w.eq.use('wear', 'sul_hair_s02_f');
  const worn = await w.eq.wear('sul_hair_s02_f');
  ok(used.note === HAIR_ELSEWHERE && worn === HAIR_ELSEWHERE, `a style is neither used nor worn as an item (${used.note}; ${worn})`);
  ok(!w.log.some((l) => l.startsWith('loadPiece(') || l.startsWith('putOn(')) && w.worn.get('sul_hair_s01_f') === true && !w.worn.has('sul_hair_s02_f'), 'so nothing is loaded, the worn style stays on and no second goes on beside it');
  const off = await w.eq.use('wear', 'sul_hair_s01_f');
  ok(off.note === HAIR_ELSEWHERE && w.worn.get('sul_hair_s01_f') === true, 'nor is the worn one taken off as an item');
}

// --- 15: two of one shirt: which one is worn, switching, destroying exactly one ---------------------------------
{
  const w = setup();
  const told: string[] = [];
  (w.deps as { ledger?: unknown }).ledger = (what: string, item: { thing?: string }) => told.push(`${what}:${item.thing}`);
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1, items: [{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 'a1' }, { id: 'shirt_s03', kind: 'wear', got: 2, thing: 'a2' }] } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.itemContext();
  await w.eq.use('wear', 'shirt_s03', undefined, 'a2');
  ok(w.worn.get('shirt_s03') === true && (rec.wornThings as Record<string, string>)?.shirt_s03 === 'a2', 'the copy double-clicked is the one worn, and the record says which since it is not the oldest');
  ok(w.eq.inUse('a2') === 'worn' && w.eq.inUse('a1') === null, 'of two of one shirt only the copy on the body is in use: the other may be traded');
  ok(w.eq.snapshot().wornThing.shirt_s03 === 'a2', 'and the backpack is told which copy is on');
  w.log.length = 0;
  const swapped = await w.eq.use('wear', 'shirt_s03', undefined, 'a1');
  ok(!w.log.some((l) => l.startsWith('loadPiece(') || l.startsWith('putOn(')) && w.worn.get('shirt_s03') === true, `double-clicking the other copy switches which one is worn and takes nothing off (${swapped.note})`);
  ok(w.eq.inUse('a1') === 'worn' && w.eq.inUse('a2') === null && rec.wornThings === undefined, 'the oldest is worn now, which needs no line in the record');
  const gone = await w.eq.destroy('wear', 'shirt_s03', 'a2');
  ok(/destroyed/.test(gone) && (rec.items as { thing: string }[]).map((o) => o.thing).join() === 'a1', `destroying the other copy drops exactly that one (${gone})`);
  ok(w.worn.get('shirt_s03') === true && !w.log.some((l) => l === 'putOn([],[shirt_s03])'), 'and the copy worn stays on');
  ok(told.join() === 'drop:a2', `and the ledger is told that thing and no other (${told.join()})`);
  await w.eq.use('wear', 'shirt_s03', undefined, 'a1');
  ok(w.worn.get('shirt_s03') === false, 'double-clicking the copy worn takes it off, as ever');
}

// --- 16: a second copy, a thing from the server, and an old record collapsed once ----------------------------------
{
  const w = setup();
  const told: string[] = [];
  (w.deps as { ledger?: unknown }).ledger = (what: string, item: { id: string; thing?: string }) => told.push(`${what}:${item.id}:${item.thing}`);
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1, items: [{ id: 'hat_s04', kind: 'wear', got: 1, thing: 'h1' }] } as Record<string, unknown>;
  w.setRecord(rec);
  ok(w.eq.give('wear', 'hat_s04') === false, 'give still gives one of each: the kit and a job\'s reward are what they were');
  ok(w.eq.giveAnother('wear', 'hat_s04') === '', 'a second copy is given on asking');
  const hats = (rec.items as { id: string; thing: string }[]).filter((o) => o.id === 'hat_s04');
  ok(hats.length === 2 && hats[0].thing !== hats[1].thing, 'and it is a thing of its own, under a name of its own');
  ok(told.length === 1 && told[0] === `add:hat_s04:${hats[1].thing}`, 'told to the ledger by that name, so the server keeps it as a second row');
  (w.deps as { refuseAnother?: unknown }).refuseAnother = () => 'this server keeps one of each';
  ok(w.eq.giveAnother('wear', 'hat_s04') === 'this server keeps one of each' && (rec.items as unknown[]).length === 2, 'and refused, with the reason, where the server would fold it into the first');
  told.length = 0;
  ok((await w.eq.receive({ id: 'baton_stun', kind: 'weapon', got: 9, thing: 'srv.i7' })) === true, 'a thing the server wrote down on its own goes in the backpack');
  ok((rec.items as { thing: string }[]).some((o) => o.thing === 'srv.i7') && told.length === 0, 'under the name the server gave it, with nothing said back');
  ok((await w.eq.receive({ id: 'baton_stun', kind: 'weapon', got: 9, thing: 'srv.i7' })) === false && (rec.items as unknown[]).length === 3, 'and the same word again changes nothing');
  ok((await w.eq.receive({ id: 'hat_s04', kind: 'wear', got: 9, thing: hats[1].thing })) === false, 'nor does the answer to one this browser gave itself');
  ok((await w.eq.receive({ id: 'pistol_cdef', kind: 'weapon', got: 9, thing: 'srv.i7' })) === true && (rec.items as { id: string; thing: string }[]).filter((o) => o.thing === 'srv.i7').length === 1 && (rec.items as { id: string }[]).some((o) => o.id === 'pistol_cdef'), 'while a different thing under a name already taken is a thing of its own, under a name of its own');

  // An old record: the creator gave a kit shirt it was also dressed in twice, before things had names.
  const v = setup({ worn: ['shirt_s03'] });
  const old = { id: 'o', name: 'O', species: 'human_male', class: 'jedi', outfit: ['shirt_s03'], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, items: [{ id: 'shirt_s03', kind: 'wear', got: 1 }, { id: 'shirt_s03', kind: 'wear', got: 1 }, { id: 'hat_s04', kind: 'wear', got: 2 }] } as Record<string, unknown>;
  v.setRecord(old);
  await v.eq.load(old as never);
  const items = old.items as { id: string; thing?: string }[];
  ok(items.length === 2 && items.every((o) => !!o.thing) && old.named === 1, `loaded once, the duplicate is collapsed to one and every row is named (${items.map((o) => o.id).join(',')})`);
  ok(v.log.filter((l) => l === 'persist').length === 1, 'and saved once');
  v.log.length = 0;
  await v.eq.load(old as never);
  ok(!v.log.includes('persist') && (old.items as unknown[]).length === 2, 'a second load changes nothing and saves nothing');
}

// --- 17: a weapon: the copy in the hand comes back to the hand ----------------------------------------------------
{
  const w = setup();
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1, items: [{ id: 'baton_stun', kind: 'weapon', got: 1, thing: 'b1' }, { id: 'baton_stun', kind: 'weapon', got: 2, thing: 'b2' }], held: {} } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.use('weapon', 'baton_stun', undefined, 'b2');
  ok(w.player.equipped.right?.id === 'baton_stun' && (rec.heldThings as Record<string, string>)?.right === 'b2' && w.eq.inUse('b2') === 'right', 'the copy taken up is the one in the hand, and the record says which, by hand');
  w.eq.reset();
  await w.eq.restoreHeld();
  ok(w.eq.inUse('b2') === 'right' && (rec.heldThings as Record<string, string>)?.right === 'b2', 'and the same copy is back in the hand when the character is played again');
  await w.eq.use('weapon', 'baton_stun', undefined, 'b1');
  ok(w.eq.inUse('b1') === 'right' && rec.heldThings === undefined && w.player.equipped.right?.id === 'baton_stun' && w.player.equipped.left === null, 'double-clicking the other copy switches which one is held, and the oldest needs no line');
  await w.eq.use('weapon', 'baton_stun', undefined, 'b1');
  ok(w.player.equipped.right === null && rec.heldThings === undefined, 'and the one in hand double-clicked is put away');
}

// --- 17b: both hands, two of each weapon, and the newer copy in each: both come back -----------------------------
{
  // The first hand's hold saves, and a save keeps the choice only for what is in a hand at that moment, so
  // read as it went the left hand's choice would be gone before the left hand was filled. `restoreHeld`
  // reads both choices first; this is the case that shows whether it does.
  const w = setup();
  const rec = {
    id: 'r',
    name: 'R',
    species: 'human_male',
    class: 'jedi',
    outfit: [],
    appearance: { morphs: {}, values: {}, height: 0.5 },
    planet: 'tatooine',
    created: 0,
    played: 0,
    inv: 1,
    named: 1,
    items: [
      { id: 'baton_stun', kind: 'weapon', got: 1, thing: 'b1' },
      { id: 'baton_stun', kind: 'weapon', got: 2, thing: 'b2' },
      { id: 'sword_lightsaber_training', kind: 'weapon', got: 3, thing: 's1' },
      { id: 'sword_lightsaber_training', kind: 'weapon', got: 4, thing: 's2' },
    ],
    held: {},
  } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.use('weapon', 'baton_stun', 'right', 'b2');
  await w.eq.use('weapon', 'sword_lightsaber_training', 'left', 's2');
  const chosen = rec.heldThings as Record<string, string> | undefined;
  ok(w.player.equipped.right?.id === 'baton_stun' && w.player.equipped.left?.id === 'sword_lightsaber_training' && chosen?.right === 'b2' && chosen?.left === 's2', 'the newer copy of each is taken up, one in each hand, and the record says which');
  ok(w.eq.inUse('b2') === 'right' && w.eq.inUse('s2') === 'left' && w.eq.inUse('b1') === null && w.eq.inUse('s1') === null, 'and those are the copies in use');
  w.eq.reset();
  await w.eq.restoreHeld();
  ok(w.eq.inUse('b2') === 'right', 'played again, the right hand holds the same copy');
  ok(w.eq.inUse('s2') === 'left' && (rec.heldThings as Record<string, string> | undefined)?.left === 's2', "and so does the left, whose choice the right hand's save would have let go of");
}

// --- 17c: two copies of one hilt, one in each hand (the owner's call) ----------------------------------------------
{
  const w = setup();
  const told: string[] = [];
  (w.deps as { ledger?: unknown }).ledger = (what: string, item: { thing?: string }) => told.push(`${what}:${item.thing}`);
  const rec = {
    id: 'r',
    name: 'R',
    species: 'human_male',
    class: 'jedi',
    outfit: [],
    appearance: { morphs: {}, values: {}, height: 0.5 },
    planet: 'tatooine',
    created: 0,
    played: 0,
    inv: 1,
    named: 1,
    items: [
      { id: 'sword_lightsaber_training', kind: 'weapon', got: 1, thing: 's1' },
      { id: 'sword_lightsaber_training', kind: 'weapon', got: 2, thing: 's2' },
    ],
    held: {},
  } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.use('weapon', 'sword_lightsaber_training', undefined, 's1');
  await w.eq.use('weapon', 'sword_lightsaber_training', 'left', 's2');
  const e = w.player.equipped;
  ok(e.right?.id === 'sword_lightsaber_training' && e.left?.id === 'sword_lightsaber_training', 'the same hilt twice: one in each hand');
  const snap = w.eq.snapshot();
  ok(snap.heldThing.right === 's1' && snap.heldThing.left === 's2' && w.eq.inUse('s1') === 'right' && w.eq.inUse('s2') === 'left', 'each hand holds its own thing, and both are in use (neither can be traded)');
  ok(rec.heldThings === undefined && (rec.held as { right?: string; left?: string }).left === 'sword_lightsaber_training', 'the record keeps both hands, and needs no line for what the rule would take anyway');
  w.eq.reset();
  await w.eq.restoreHeld();
  ok(w.eq.inUse('s1') === 'right' && w.eq.inUse('s2') === 'left', 'played again, both copies come back, one in each hand');
  // The rack (no thing named) asks for the hilt in the left while the right holds one: the other copy goes.
  w.eq.stow('left');
  await w.eq.hold({ id: 'sword_lightsaber_training', class: 'lightsaber', slots: [['hold_r', 'hold_l']] } as never, 'left');
  ok(w.eq.inUse('s1') === 'right' && w.eq.inUse('s2') === 'left', 'taken up from the rack for the left hand, the copy not already in the right is the one that goes in');
  const gone = await w.eq.destroy('weapon', 'sword_lightsaber_training', 's2');
  ok(/destroyed/.test(gone) && e.right?.id === 'sword_lightsaber_training' && e.left === null && told.join() === 'drop:s2', `destroying the left's copy empties the left hand alone (${gone})`);
  // One copy cannot be in both hands: asked for the left, the right's own copy moves across.
  await w.eq.use('weapon', 'sword_lightsaber_training', 'left', 's1');
  ok(e.right === null && e.left?.id === 'sword_lightsaber_training' && w.eq.inUse('s1') === 'left', 'a single copy asked for the other hand moves across: it is never in both');
  await w.eq.hold({ id: 'sword_lightsaber_training', class: 'lightsaber', slots: [['hold_r', 'hold_l']] } as never, 'right');
  ok(e.left === null && e.right?.id === 'sword_lightsaber_training', 'and asked back for the right from the rack, with no second copy, it moves back');
}

// --- 17d: a list from the server takes one of two copies held: that hand lets go, the other keeps its own ------------
{
  const w = setup();
  const rec = {
    id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1,
    items: [
      { id: 'sword_lightsaber_training', kind: 'weapon', got: 1, thing: 's1' },
      { id: 'sword_lightsaber_training', kind: 'weapon', got: 2, thing: 's2' },
    ],
    held: {},
  } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.use('weapon', 'sword_lightsaber_training', undefined, 's1');
  await w.eq.use('weapon', 'sword_lightsaber_training', 'left', 's2');
  await w.eq.reconcile([{ id: 'sword_lightsaber_training', kind: 'weapon', got: 1, thing: 's1' }]);
  ok(w.player.equipped.right?.id === 'sword_lightsaber_training' && w.player.equipped.left === null && w.eq.inUse('s1') === 'right', 'the copy that went leaves its hand empty and the other stays in its own');
}

// --- 17e: one hilt saved in both hands with one copy left: the right takes it back, the left stays empty -------------
{
  // The second of two copies went while the character was away (traded from another browser, a server's
  // list). The record still names the hilt in both hands; taking the one copy left into the left as well
  // would move it out of the right, so the character would come back holding it in the wrong hand.
  const w = setup();
  const rec = {
    id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1,
    items: [{ id: 'sword_lightsaber_training', kind: 'weapon', got: 1, thing: 's1' }],
    held: { right: 'sword_lightsaber_training', left: 'sword_lightsaber_training' },
  } as Record<string, unknown>;
  w.setRecord(rec);
  w.eq.reset();
  await w.eq.restoreHeld();
  ok(w.player.equipped.right?.id === 'sword_lightsaber_training' && w.player.equipped.left === null && w.eq.inUse('s1') === 'right', 'the one copy left comes back to the right hand, and the left, whose copy went, stays empty');
  ok((rec.held as { right?: string; left?: string }).left === undefined && (rec.held as { right?: string }).right === 'sword_lightsaber_training', 'and the record lets the empty hand go');
}

// --- 18: a reward that arrives while an older list waits its turn stays in the backpack -----------------------------
{
  // The relay sends the settled list and then the reward it owed. The list's reconcile waits in the queue
  // behind a piece still going on; a reward written into the backpack at once was there before that older
  // list was laid over it, which read it as gone and took it out while the server held it.
  const w = setup();
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1, items: [{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 'wshirt_s03|1|a' }] } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.itemContext();
  const t = new Trade();
  t.authority = () => 'server';
  t.itemsVersion = () => 2;
  t.send = () => {};
  // main.ts's own wiring, with every answer kept so the check waits for the list as well as the reward.
  const lists: Promise<string>[] = [];
  t.onList = (items) => void lists.push(w.eq.reconcile(items as never));
  const came: Promise<boolean>[] = [];
  t.onAdded = (item) => void came.push(w.eq.receive(item as never));
  // A hat double-clicked a moment ago: its prepare is still running when the server's two words come.
  let release!: () => void;
  w.prepareGate.hold = new Promise<void>((r) => (release = r));
  const wearing = w.eq.wear('hat_s04');
  await new Promise((r) => setTimeout(r, 5));
  t.handle({ t: 'items', do: 'list', take: 'browser', rows: [{ id: 'i1', kind: 'wear', what: 'shirt_s03', got: 1, thing: 'wshirt_s03|1|a' }] });
  t.handle({ t: 'items', do: 'added', row: { id: 'i2', kind: 'weapon', what: 'baton_stun', got: 2, thing: 'loyw3v28.i2' } });
  release();
  w.prepareGate.hold = null;
  await wearing;
  await Promise.all([...lists, ...came]);
  ok(lists.length === 1 && came.length === 1, 'the list and the reward each reached the equipment');
  const things = (rec.items as { thing: string }[]).map((o) => o.thing);
  ok(things.includes('loyw3v28.i2') && things.includes('wshirt_s03|1|a'), `the reward the server owed is in the backpack once the queue has run, beside what the list held (${things.join(', ')})`);
  ok(t.list.some((r) => r.thing === 'loyw3v28.i2'), 'as it is in the rows this browser knows the server holds');
}

// --- 19: a second copy stops at what a server keeps for one character ----------------------------------------------
{
  ok(ITEMS_MOST === LEDGER_TUNING.items, `the backpack's cap is the server's own (${ITEMS_MOST} and ${LEDGER_TUNING.items})`);
  const w = setup();
  const full = Array.from({ length: ITEMS_MOST }, (_, i) => ({ id: 'hat_s04', kind: 'wear', got: i + 1, thing: `h|${i}` }));
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1, items: full.slice(0, ITEMS_MOST - 1) } as Record<string, unknown>;
  w.setRecord(rec);
  ok(w.eq.giveAnother('wear', 'hat_s04') === '' && (rec.items as unknown[]).length === ITEMS_MOST, 'one short of it, another goes in');
  const refused = w.eq.giveAnother('wear', 'hat_s04');
  ok(refused === `a character carries ${ITEMS_MOST} things` && (rec.items as unknown[]).length === ITEMS_MOST, `and at it, another is refused in words and nothing goes in (${refused})`);
}

// --- 20: a thing's colours: drawn before it shows, switched with the copy, set, saved and told once ---------------
{
  const was = { ...ITEMS_TUNE };
  tuneItems({ tintSettleMs: 15 });
  const SHIRT = [{ name: '/private/index_color_1', default: 11 }, { name: '/private/index_color_dye', default: 0 }];
  const w = setup({ recipes: { shirt_s03: SHIRT } });
  const sent: { thing: string; tint: Record<string, number> | null; at: number }[] = [];
  let live = true;
  const deps = w.deps as { noteTint?: unknown; tintsLive?: unknown; now?: unknown };
  deps.noteTint = (thing: string, tint: Record<string, number> | null, at: number) => {
    sent.push({ thing, tint, at });
    return true;
  };
  deps.tintsLive = () => live;
  deps.now = () => 1234;
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1, tints: 1, items: [{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 'a1', tint: { index_color_1: 5 }, tintAt: 10 }, { id: 'shirt_s03', kind: 'wear', got: 2, thing: 'a2' }] } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.use('wear', 'shirt_s03', undefined, 'a1');
  const order = w.log.filter((l) => l !== 'persist');
  ok(order.join(' ') === 'loadPiece(shirt_s03) setAll(shirt_s03|/private/index_color_1=5) settled prepare(shirt_s03_mesh) putOn([shirt_s03],[])', `the copy put on is drawn in its own colour before the settle the piece waits on to show (${order.join(' ')})`);
  w.log.length = 0;
  await w.eq.use('wear', 'shirt_s03', undefined, 'a2');
  ok(w.log.includes('setAll(shirt_s03|/private/index_color_1=11)') && !w.log.some((l) => l.startsWith('loadPiece(') || l.startsWith('putOn(')), `switching to the other copy, which has no colour, draws the piece back in the game's own and takes nothing off (${w.log.filter((l) => l.startsWith('setAll')).join(' ')})`);
  w.log.length = 0;
  await w.eq.use('wear', 'shirt_s03', undefined, 'a1');
  ok(w.log.includes('setAll(shirt_s03|/private/index_color_1=5)'), 'and switching back draws it in the first copy\'s colour again');
  w.log.length = 0;
  ok(w.eq.setTint('a1', { index_color_1: 7 }) === '', 'a colour set on the copy worn is taken');
  const a1 = (rec.items as { thing: string; tint?: Record<string, number>; tintAt?: number }[]).find((o) => o.thing === 'a1')!;
  ok(a1.tint?.index_color_1 === 7 && a1.tintAt === 1234 && w.log.includes('persist'), 'saved on the thing at once, stamped with the clock the server hands out');
  ok(w.log.includes('setAll(shirt_s03|/private/index_color_1=7)'), 'and drawn on the piece, since it is the copy worn');
  w.eq.setTint('a1', { index_color_1: 8 });
  w.eq.setTint('a1', { index_color_dye: -100 });
  ok(sent.length === 0, 'nothing goes to the server while the colour is still moving');
  await new Promise((r) => setTimeout(r, 60));
  ok(sent.length === 1 && sent[0].thing === 'a1' && JSON.stringify(sent[0].tint) === JSON.stringify({ index_color_1: 8, index_color_dye: -100 }) && sent[0].at === 1234, `once it has been still a moment, one word says the colours as they stand (${JSON.stringify(sent)})`);
  w.log.length = 0;
  w.eq.setTint('a2', { index_color_1: 3 });
  ok(!w.log.some((l) => l.startsWith('setAll(')), 'the copy not worn is coloured without the piece on the body changing');
  w.eq.setTint('a1', { index_color_1: null, index_color_dye: null });
  ok(a1.tint === undefined && a1.tintAt === 1234 && w.log.includes('setAll(shirt_s03|/private/index_color_1=11,shirt_s03|/private/index_color_dye=0)'), 'and every colour taken off puts the piece back to the game\'s own, the moment it is taken off still stamped');
  ok(w.eq.setTint('nope', { index_color_1: 1 }) === 'not owned', 'a thing not owned is refused in words');
  await new Promise((r) => setTimeout(r, 60));
  ok(sent.length === 3 && sent.some((s) => s.thing === 'a2') && sent.some((s) => s.thing === 'a1' && s.tint === null), `each thing changed is told once, a colour taken off as none (${sent.length} words)`);
  live = false;
  w.eq.setTint('a2', { index_color_1: 4 });
  await new Promise((r) => setTimeout(r, 60));
  ok(sent.length === 3 && (w.eq.tintReport().waiting.length === 0), 'with no server to keep colours nothing is sent and nothing is left waiting: the next list carries it');
  const report = w.eq.tintReport();
  ok(report.tinted.some((t) => t.thing === 'a2' && t.inUse === null) && report.worn.shirt_s03 === 'a1' && report.marked === 1, 'the console sees the coloured things, the copy worn and the mark');
  tuneItems(was);
}

// --- 21: a list from the server: newest wins, a colour kept here goes back up, the piece worn follows -------------
{
  const was = { ...ITEMS_TUNE };
  tuneItems({ tintSettleMs: 10 });
  const w = setup({ recipes: { shirt_s03: [{ name: '/private/index_color_1', default: 11 }] }, worn: ['shirt_s03'] });
  const sent: { thing: string; tint: Record<string, number> | null; at: number }[] = [];
  const deps = w.deps as { noteTint?: unknown; tintsLive?: unknown };
  deps.noteTint = (thing: string, tint: Record<string, number> | null, at: number) => {
    sent.push({ thing, tint, at });
    return true;
  };
  deps.tintsLive = () => true;
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: ['shirt_s03'], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1, tints: 1, items: [{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 'x', tint: { index_color_1: 4 }, tintAt: 500 }] } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.itemContext();
  // Set offline at 500; the server holds one from 400.
  await w.eq.reconcile([{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 'x', tint: { index_color_1: 2 }, tintAt: 400 }]);
  await new Promise((r) => setTimeout(r, 40));
  ok(sent.length === 1 && sent[0].thing === 'x' && sent[0].tint?.index_color_1 === 4 && sent[0].at === 500, 'a colour set while no server answered, newer than the server\'s, is kept and sent up after the list');
  // Somebody else's browser coloured it since, at 600: the server's wins and nothing goes back.
  w.log.length = 0;
  await w.eq.reconcile([{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 'x', tint: { index_color_1: 9 }, tintAt: 600 }]);
  await new Promise((r) => setTimeout(r, 40));
  const x = (rec.items as { thing: string; tint?: Record<string, number> }[])[0];
  ok(x.tint?.index_color_1 === 9 && sent.length === 1, 'an older one here is replaced by the server\'s, and nothing is said back');
  ok(w.log.includes('setAll(shirt_s03|/private/index_color_1=9)'), 'and the piece on the body is drawn in it');
  tuneItems(was);
}

// --- 22: a saved record's garment colours move onto its things, once, and the look is drawn from them ---------------
{
  const w = setup({ recipes: { shirt_s03: [{ name: '/private/index_color_1', default: 11 }, { name: '/private/index_color_2', default: 3 }] }, worn: ['shirt_s03'] });
  const rewrites: { was: { items?: { tint?: unknown }[] }; now: { items?: { tint?: unknown }[] } }[] = [];
  (w.deps as { rewritten?: unknown }).rewritten = (was: never, now: never) => rewrites.push({ was, now });
  // A jacket coloured long ago and since given away: its colour must not wait in the look for the next jacket.
  const values = { 'shirt_s03|/private/index_color_1': 33, 'hum_m_head_l0|/private/index_color_2': 6, index_color_skin: 2, 'hair|index_color_1': 4, 'jacket_s02|/private/index_color_1': 7 };
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: ['shirt_s03'], appearance: { morphs: {}, values: { ...values }, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1, items: [{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 't1' }] } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.load(rec as never);
  const t1 = (rec.items as { tint?: Record<string, number> }[])[0];
  ok(rec.tints === 1 && t1.tint?.index_color_1 === 33, 'loaded once, the shirt\'s colour is the thing\'s own and the record is marked');
  const look = (rec.appearance as { values: Record<string, number> }).values;
  ok(!('shirt_s03|/private/index_color_1' in look) && look.index_color_skin === 2 && look['hair|index_color_1'] === 4 && look['hum_m_head_l0|/private/index_color_2'] === 6, 'and it left the look, which keeps the body\'s and the hair\'s');
  ok(!('jacket_s02|/private/index_color_1' in look), 'and so did the colour of a jacket no longer owned, which a jacket given later would otherwise have come out in');
  ok(rewrites.length === 1 && !rewrites[0].was.items?.[0]?.tint && !!rewrites[0].now.items?.[0]?.tint, 'the session is told the record was only written again, with the record as it was');
  const drawn = await w.eq.tintLook(rec as never, w.deps.character() as never);
  ok(JSON.stringify(drawn) === JSON.stringify({ 'shirt_s03|/private/index_color_1': 33 }), `the record's look is drawn with the thing's colour laid over it, and nothing for what stays the game's own (${JSON.stringify(drawn)})`);
  w.log.length = 0;
  await w.eq.load(rec as never);
  ok(rewrites.length === 1 && !w.log.includes('persist'), 'a second load moves nothing and saves nothing');
}

// --- 22b: a piece given and put on in one step goes on in the game's own colours, not the last copy's ----------------
{
  // The give tab's wear gives the thing only once the piece is on, so while it goes on no copy is owned. A
  // copy coloured and destroyed earlier this session left its colour on the meshes, which the new one, with
  // no colour of its own, must not come out in.
  const w = setup({ recipes: { hat_s04: [{ name: '/private/index_color_1', default: 11 }] } });
  const rec = { id: 'r', name: 'R', species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1, tints: 1, items: [{ id: 'hat_s04', kind: 'wear', got: 1, thing: 'h1', tint: { index_color_1: 5 } }] } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.use('wear', 'hat_s04', undefined, 'h1');
  ok(w.log.includes('setAll(hat_s04|/private/index_color_1=5)'), 'the dyed hat goes on in its colour');
  await w.eq.destroy('wear', 'hat_s04', 'h1');
  w.log.length = 0;
  await w.eq.wear('hat_s04', { give: true, force: true });
  const given = (rec.items as { id: string; tint?: unknown }[]).filter((o) => o.id === 'hat_s04');
  ok(given.length === 1 && !given[0].tint && w.log.includes('setAll(hat_s04|/private/index_color_1=11)'), `given and put on in one step, the new hat, which has no colour, goes on in the game's own (${w.log.filter((l) => l.startsWith('setAll')).join(' ') || 'nothing set'})`);
  const set = w.log.indexOf('setAll(hat_s04|/private/index_color_1=11)');
  ok(set >= 0 && set < w.log.indexOf('settled'), 'and before the settle the piece waits on to show');
}

// --- 23: a Wookiee: a garment's copy of the fur colour follows the fur, never the thing -----------------------------
{
  // The game's own customizer and two recipes the shape of the Wookiee pack's: the body reads the fur as a shared
  // `index_color_1`, and the shirt reads a private `index_color_1` of its own -- which the customizer links to the
  // fur by name, hides on the appearance page, and sets whenever the fur is set. A thing's colours must agree with
  // that rule on every path, or the shirt changes colour depending on which path drew it last.
  const { Customizer } = await import('../../../src/player/customizer.ts');
  const PAL = 'palette/test.pal';
  const fill = { effect: null, passes: [{ alphaBlend: false, blendOp: 0, blendSrc: 0, blendDst: 0, alphaTest: false, alphaRefTag: null, alphaFunc: 0, writeMask: 15, tfactorTag: 'TFAC', stages: [{ colorOp: 2, colorArgs: [[0, 0, 0], [0, 0, 0], [5, 0, 0]], alphaOp: 2, alphaArgs: [[0, 0, 0], [0, 0, 0], [5, 0, 0]], result: 0, textureTag: 'NONE', coordSetTag: 'NONE' }] }], textures: {}, addresses: {}, coordSets: {}, tfactors: {}, alphaRefs: {}, choices: [], palettes: [] };
  const recipe = (mesh: string, material: string, variables: { name: string; private: boolean; default: number }[]) => ({
    mesh,
    material,
    kind: 'render',
    baseTag: 'MAIN',
    shader: null,
    slots: [{ tag: 'MAIN', file: `${mesh}.trt`, blueprint: { width: 4, height: 4, camera: 4, shaders: [fill], textures: [], vertexBuffers: [[[0, 0, 0xffffffff, 0, 0], [4, 0, 0xffffffff, 1, 0], [4, 4, 0xffffffff, 1, 1], [0, 4, 0xffffffff, 0, 1]]], uvSets: [1], indexBuffers: [], commands: [{ kind: 'draw', shader: 0, primitives: [{ kind: 'fan', vb: 0 }] }], prepare: [{ kind: 'palette', shader: 0, tag: 'TFAC', palette: PAL, variable: 0 }], variables: variables.map((v) => ({ ...v, kind: 'palette', palette: PAL })) } }],
  });
  const BODY = recipe('wke_m_body_l0', 'shader/wke_body.sht', [{ name: 'index_color_1', private: false, default: 0 }]);
  const SHIRT = recipe('shirt_s03', 'shader/shirt.sht', [
    { name: '/private/index_color_1', private: true, default: 2 },
    { name: '/private/index_color_dye', private: true, default: 0 },
  ]);
  const realFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) =>
    url === 'test://wookiee/customize.json' ? new Response(JSON.stringify({ images: 'customize/', recipes: [BODY, SHIRT], palettes: { [PAL]: [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]] } }), { headers: { 'content-type': 'application/json' } }) : new Response('', { status: 404 });
  const THREE = await import('three');
  const cz = new Customizer();
  const mats: Record<string, InstanceType<typeof THREE.MeshStandardMaterial>> = { 'shader/wke_body.sht': new THREE.MeshStandardMaterial(), 'shader/shirt.sht': new THREE.MeshStandardMaterial() };
  cz.materialsFor = (name: string) => (mats[name] ? [mats[name]] : []);
  ok(await cz.addSource('test://wookiee/'), "the Wookiee-shaped recipes join the game's own customizer");
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  const COPY = 'shirt_s03|/private/index_color_1';
  const DYE = 'shirt_s03|/private/index_color_dye';
  ok(cz.isLinked(COPY) && cz.followed(COPY)?.key === 'index_color_1' && !cz.isLinked(DYE), "the shirt's index_color_1 follows the fur, and its dye is its own");

  const w = setup({ worn: ['shirt_s03'], species: 'wookiee_male' });
  (w.deps.character() as { customizer: unknown }).customizer = cz;
  const rec = { id: 'r', name: 'Chewie', species: 'wookiee_male', class: 'jedi', outfit: ['shirt_s03'], appearance: { morphs: {}, values: { index_color_1: 1 }, height: 0.5 }, planet: 'kashyyyk', created: 0, played: 0, inv: 1, named: 1, tints: 1, items: [{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 't1' }] } as Record<string, unknown>;
  w.setRecord(rec);
  await w.eq.itemContext();
  // The fur set as play sets it: the customizer's link carries it onto the shirt's copy.
  cz.setAll({ index_color_1: 1 });
  await cz.settled();
  ok(cz.followedValue(COPY) === 1 && cz.values.get(COPY) === 1, "the fur set, the shirt's copy of it follows");
  // A list from the server, a species switch or play drawing the body from its things: the shirt has no colour
  // of its own, which must put its own colours back and leave the fur's copy on the fur.
  w.eq.colourWorn();
  ok(cz.values.get(COPY) === 1, `drawn from a thing with no colour, the shirt keeps the fur's colour rather than going to its own default (${cz.values.get(COPY)})`);
  // The fur changes, then the shirt is dyed: the copy follows the fur still, and the dye is the thing's.
  cz.setAll({ index_color_1: 0 });
  ok(w.eq.setTint('t1', { index_color_dye: -6 }) === '' && cz.values.get(COPY) === 0 && cz.values.get(DYE) === -6, `dyed, the shirt's dye is the thing's and its copy of the fur is still the fur's (${cz.values.get(COPY)}, ${cz.values.get(DYE)})`);
  // A shirt that came from a human carries an index_color_1 of its own: on a Wookiee the fur still wins, and the
  // thing keeps it for whoever wears it next.
  w.eq.setTint('t1', { index_color_1: 2 });
  const t1 = (rec.items as { thing: string; tint?: Record<string, number> }[])[0];
  ok(cz.values.get(COPY) === 0 && t1.tint?.index_color_1 === 2, "a colour the thing carries under that name is kept on the thing and not drawn over the fur's");
  // The select screen works the record out from its look, not from what the rig holds now (the last character's).
  cz.setAll({ index_color_1: 2 });
  const drawn = await w.eq.tintLook(rec as never, w.deps.character() as never);
  ok(drawn[COPY] === 1 && drawn[DYE] === -6, `worked out for the select screen, the shirt's copy takes the fur this record's look gives, and the dye is the thing's (${JSON.stringify(drawn)})`);
  // And a saved look's copy of the fur is the body's: moved onto no thing, and out of the look.
  const old = { id: 'o', name: 'Old', species: 'wookiee_male', class: 'jedi', outfit: ['shirt_s03'], appearance: { morphs: {}, values: { index_color_1: 1, [COPY]: 1, [DYE]: -9 }, height: 0.5 }, planet: 'kashyyyk', created: 0, played: 0, inv: 1, named: 1, items: [{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 'o1' }] } as Record<string, unknown>;
  w.setRecord(old);
  await w.eq.load(old as never);
  const o1 = (old.items as { tint?: Record<string, number> }[])[0];
  const kept = (old.appearance as { values: Record<string, number> }).values;
  ok(JSON.stringify(o1.tint) === JSON.stringify({ index_color_dye: -9 }) && !(COPY in kept) && !(DYE in kept) && kept.index_color_1 === 1, `moved onto its things, the shirt's dye is the thing's and its copy of the fur left the look with nowhere to go (${JSON.stringify(o1.tint)}; ${Object.keys(kept).join(', ')})`);
}

console.log(`${checks} checks passed`);
