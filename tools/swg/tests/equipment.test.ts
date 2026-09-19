// The equipment (src/player/equipment.ts) against fakes: the order a piece goes on in (loaded hidden,
// the recipes settled, prepared, then shown with what it displaces in one step), the queue, reset and a
// character changing under an operation, no record (the creator), no wardrobe, a weapon prepared on every
// hold, the blade left as it was on a restore, the species packs' own pieces for a Wookiee, a destroy and a
// second use that wait their turn, several parts off in one step, and a peer's dress (look.ts dressPrepared).
// Plain node; the module is node-loadable (type-only imports apart from the rules and the item facts).
import assert from 'node:assert/strict';
import { Equipment, type EquipmentDeps } from '../../../src/player/equipment.ts';
import { dressPrepared } from '../../../src/player/look.ts';

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

function setup(opts: { species?: string; wardrobe?: Item[] | null; worn?: string[]; packParts?: string[]; record?: boolean; classId?: 'jedi' | 'bounty_hunter' } = {}): World {
  const log: string[] = [];
  const worn = new Map<string, boolean>();
  for (const w of opts.worn ?? []) worn.set(w, true);
  const packParts = opts.packParts ?? [];
  const wardrobe = opts.wardrobe === null ? null : { species: 'human', gender: 'male', items: opts.wardrobe ?? WARDROBE };
  const character = {
    manifest: { id: opts.species ?? 'human_male' },
    wardrobeDir: 'http://x/wardrobe/human_male/',
    packParts,
    customizer: {
      settled: () => {
        log.push('settled');
        return Promise.resolve();
      },
    },
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

console.log(`${checks} checks passed`);
