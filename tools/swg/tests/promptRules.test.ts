// The action bar's rules (src/ui/promptRules.ts): which few things the bottom of the screen offers in
// each place the player can stand. The long line these replace covered ten states and a jump's override
// on top of them, so every one of those is asked for here and checked to still offer the thing it used
// to say - the point of the test is that the short bar loses nothing you could press.
//
// It also pins the three rules that are ours: never more than the slots allow, never the same key twice
// with two different words, and never an allocation (the same array comes back filled).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/**
 * The bindings the game has, read out of the source rather than imported: `src/core/input.ts` declares
 * a class with a parameter property, which node will not strip. The names are what matter here - a
 * binding renamed there and not here leaves the bar with a cap it cannot resolve, and this is what
 * fails instead of the screen.
 */
const BINDINGS = (() => {
  const src = readFileSync(new URL('../../../src/core/input.ts', import.meta.url), 'utf8');
  const body = /export const DEFAULT_BINDINGS[^{]*\{([\s\S]*?)\n\};/.exec(src);
  assert.ok(body, 'the bindings table was found in src/core/input.ts');
  const names = new Set<string>();
  for (const m of body[1].matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)) names.add(m[1]);
  assert.ok(names.size > 20, `the bindings table parsed (${names.size} actions)`);
  return names;
})();

const { PROMPT, PROMPT_MAX_SLOTS, PROMPT_WORDS, fillActions, newPromptActions, newPromptState, resetPromptState, tunePrompt } = await import('../../../src/ui/promptRules.ts');

/** The numbers back as they were, so one block cannot colour the next. */
const DEFAULTS = { ...PROMPT };
const reset = () => Object.assign(PROMPT, DEFAULTS);

/** The slots the bar owns, made once here as the bar makes them once. */
const slots = newPromptActions();
const state = newPromptState();

/** A state built from nothing but the fields a case names; `live` is on unless it is asked to be off. */
const at = (fields: Partial<ReturnType<typeof newPromptState>>) => {
  resetPromptState(state);
  state.live = true;
  const v = state.vehicle;
  if (fields.vehicle) {
    Object.assign(v, fields.vehicle);
    delete fields.vehicle;
  }
  Object.assign(state, fields);
  state.vehicle = v;
  return state;
};

/** What the bar would show, as "key label" pairs, for reading in a failure. */
const show = (n: number) => slots.slice(0, n).map((a) => `${a.action || `[${a.code}]`} ${a.label}`);
/** The labels alone. */
const words = (n: number) => slots.slice(0, n).map((a) => a.label);
/** The bindings (and bare keys) the bar would put caps on. */
const keys = (n: number) => slots.slice(0, n).map((a) => a.action || `[${a.code}]`);

const fill = (s: ReturnType<typeof newPromptState>) => fillActions(s, slots);

// --- the ten states the long line covered ------------------------------------------------------------

{
  // Not simulating at all: a panel, the death card, the loading screen. The bar says nothing, which is
  // the same rule the overlay follows, and it is checked here because it is the one that would
  // otherwise leave a stale word under a death card.
  const n = fill(at({ live: false, near: 'mount' }));
  ok(n === 0, 'not simulating: the bar is empty');
  // Even mid-jump, which is the state most likely to be standing when a panel goes up.
  const jumping = fill(at({ live: false, jump: 'piloting', piloting: true }));
  ok(jumping === 0, 'not simulating in a jump: still empty');
}

{
  const n = fill(at({ noclip: true }));
  ok(n === 3, `noclip: three actions (${show(n).join(', ')})`);
  ok(keys(n).join() === 'noclip,noclipFaster,noclipSlower', 'noclip: off, faster and slower, in that order');
}

{
  // Seated in a ship in flight: the four the long line carried at once.
  const n = fill(at({ mounted: true, vehicle: { kind: 'ship', ship: true, airborne: true, canLand: true, powered: true, guns: true, cutKey: 'KeyJ' } }));
  ok(n === PROMPT.slots, `flying: the bar is full (${show(n).join(', ')})`);
  ok(words(n)[0] === PROMPT_WORDS.leave, 'flying: the way out comes first');
  ok(words(n).includes(PROMPT_WORDS.bringDown), 'flying: the way down is offered');
  ok(words(n).includes(PROMPT_WORDS.cutEngines), 'flying: the engine cut is offered');
  ok(keys(n).includes('[KeyJ]'), 'flying: the engine cut shows the bare key it is read from');
}

{
  // The same hull with wings and the ship menu on offer: five things want four slots, and the order
  // decides. The menu waits, because the wings have no other key and the menu is a keypress away in
  // every other state too.
  const n = fill(at({ mounted: true, shipMenu: 'here', vehicle: { kind: 'ship', ship: true, airborne: true, canLand: true, powered: true, wings: true, guns: true, cutKey: 'KeyJ' } }));
  ok(words(n).includes(PROMPT_WORDS.openWings), 'flying with wings: the wings are offered');
  ok(!words(n).includes(PROMPT_WORDS.shipMenu), 'flying with wings: the ship menu gives way to them');
  const open = fill(at({ mounted: true, vehicle: { kind: 'ship', ship: true, airborne: true, wings: true, wingsOpen: true, cutKey: 'KeyJ' } }));
  ok(words(open).includes(PROMPT_WORDS.closeWings), 'wings already open: the words turn round');
}

{
  // Reaching the height where space is open is news, and is the one time the menu comes before the
  // things you fly with.
  const n = fill(at({ mounted: true, shipMenu: 'altitude', vehicle: { kind: 'ship', ship: true, airborne: true, canLand: true, powered: true, wings: true, cutKey: 'KeyJ' } }));
  ok(words(n)[1] === PROMPT_WORDS.shipMenu, `at altitude: the ship menu stands second (${show(n).join(', ')})`);
}

{
  // Out in space there is no ground: the set-down is offered only while something is under the hull.
  const empty = fill(at({ mounted: true, vehicle: { kind: 'ship', ship: true, space: true, airborne: true, canLand: true, powered: true, cutKey: 'KeyJ' } }));
  ok(!words(empty).includes(PROMPT_WORDS.setDown), 'in space with nothing under it: no set-down');
  ok(!words(empty).includes(PROMPT_WORDS.bringDown), 'in space: nothing brings it down, there being no down');
  // The key that cuts the engines on a planet asks for a set-down out here. A bar of bound keys must
  // never name an action its key will not perform, so the engine cut is a planet's word alone.
  ok(!words(empty).includes(PROMPT_WORDS.cutEngines), 'in space the engine cut is not offered: that key sets down');
  const over = fill(at({ mounted: true, vehicle: { kind: 'ship', ship: true, space: true, airborne: true, canLand: true, setDownNear: true, powered: true, cutKey: 'KeyJ' } }));
  ok(words(over).includes(PROMPT_WORDS.setDown), 'in space over a surface: the set-down is offered');
  ok(keys(over).filter((k) => k === '[KeyJ]').length === 1, 'the set-down and the engine cut share a key, so only one of them is shown');
}

{
  const n = fill(at({ mounted: true, vehicle: { kind: 'ship', ship: true, landed: true, canLand: true } }));
  ok(words(n).join() === `${PROMPT_WORDS.leave},${PROMPT_WORDS.liftOff}`, `landed: leave and lift off (${show(n).join(', ')})`);
  const holding = fill(at({ mounted: true, vehicle: { kind: 'ship', ship: true, holding: true, canLand: true } }));
  ok(holding === 1 && words(holding)[0] === PROMPT_WORDS.leave, 'setting down: only the way out');
}

{
  // A speeder or a creature: neither is set down, cut or given wings.
  const n = fill(at({ mounted: true, vehicle: { kind: 'ground', hop: true, boost: true } }));
  ok(words(n).join() === `${PROMPT_WORDS.dismount},${PROMPT_WORDS.hop},${PROMPT_WORDS.boost}`, `a speeder: dismount, hop and boost (${show(n).join(', ')})`);
  const plain = fill(at({ mounted: true, vehicle: { kind: 'ground' } }));
  ok(plain === 1, 'a speeder with neither: the way off and nothing else');
}

{
  // A ship flown from its bridge on foot: the same hull, and the words for letting go of the controls.
  const n = fill(at({ piloting: true, vehicle: { kind: 'ship', ship: true, airborne: true, canLand: true, powered: true, cutKey: 'KeyJ' } }));
  ok(words(n)[0] === PROMPT_WORDS.letGo, `at the controls: the first action lets go of them (${show(n).join(', ')})`);
}

{
  const n = fill(at({ lift: true }));
  ok(n === 1 && words(n)[0] === PROMPT_WORDS.lift, 'in a lift shaft: the lift');
  const up = fill(at({ elevator: 'up' }));
  ok(words(up)[0] === PROMPT_WORDS.up, 'at an elevator going up');
  const down = fill(at({ elevator: 'down' }));
  ok(words(down)[0] === PROMPT_WORDS.down, 'at an elevator going down');
}

{
  const n = fill(at({ doorless: true }));
  ok(n === 1 && words(n)[0] === PROMPT_WORDS.inside, 'beside a building with no way in on foot: go inside');
}

{
  const n = fill(at({ shuttle: true }));
  ok(n === 1 && words(n)[0] === PROMPT_WORDS.shuttle, 'standing at a starport: the shuttle');
}

{
  // A port is a point forty metres wide; a lift shaft, an elevator and a doorway are underfoot. All
  // four want the same key, and the shuttle is deliberately the last of them to get it.
  for (const over of [{ lift: true }, { elevator: 'up' as const }, { doorless: true }]) {
    const n = fill(at({ shuttle: true, ...over }));
    ok(n === 1 && words(n)[0] !== PROMPT_WORDS.shuttle, `a ${Object.keys(over)[0]} at a starport keeps the key (${show(n).join(', ')})`);
  }
  // A speeder parked at the port does **not** take the key, the same way a doorway does not lose it
  // to one: the port is where you are standing. Pinned here because the game's own dispatch has to
  // agree with it, and a speeder is the likeliest thing to be parked at a starport.
  const withSpeeder = fill(at({ shuttle: true, near: 'mount' }));
  ok(withSpeeder === 1 && words(withSpeeder)[0] === PROMPT_WORDS.shuttle, `a speeder parked at the port: the shuttle keeps the key (${show(withSpeeder).join(', ')})`);
}

{
  // At one of the gates a world's zones are walked between. The cap says what happens and never
  // where it goes: a place name on a cap would be a label built outside the table below, which the
  // whole-bar check further down would catch, and where it leads is said on the message line.
  const n = fill(at({ gate: 'travel' }));
  ok(n === 1 && words(n)[0] === PROMPT_WORDS.gate, 'standing at a gate between two of a world zones: through it');
  const nowhere = fill(at({ gate: 'nowhere' }));
  ok(nowhere === 1 && words(nowhere)[0] === PROMPT_WORDS.gateNowhere, 'a gate the pack names nowhere for: the bar says so rather than saying nothing');
}

{
  // The gravity boots hold a surface out in space.
  const off = fill(at({ boots: true }));
  ok(words(off).join() === `${PROMPT_WORDS.bootsOff},${PROMPT_WORDS.letGoSurface}`, `on a surface: the boots come off, or you let go (${show(off).join(', ')})`);
  const reach = fill(at({ boots: true, bootsReach: true }));
  ok(words(reach)[0] === PROMPT_WORDS.climbIn, 'on a surface with a ship beside you: climb in');
}

{
  const out = fill(at({ aboard: true }));
  ok(out === 1 && words(out)[0] === PROMPT_WORDS.stepOut, 'aboard a ship: step out');
  const controls = fill(at({ aboard: true, atControls: true }));
  ok(words(controls)[0] === PROMPT_WORDS.takeControls, 'aboard, at the controls: take them');
}

{
  const drift = fill(at({ eva: true }));
  ok(words(drift).join() === `${PROMPT_WORDS.bootsOn},${PROMPT_WORDS.brake}`, `adrift: the boots and the brake (${show(drift).join(', ')})`);
  const beside = fill(at({ eva: true, near: 'board' }));
  ok(words(beside)[0] === PROMPT_WORDS.board, 'adrift beside a ship with room: board it');
  const speeder = fill(at({ eva: true, near: 'mount' }));
  ok(words(speeder)[0] === PROMPT_WORDS.mount, 'adrift beside a speeder: mount it');
  // On its back means nothing where there is no down, and the key mounts it just the same: the bar
  // must not offer the boots under a key that is about to put you in the seat.
  const upended = fill(at({ eva: true, near: 'flip' }));
  ok(words(upended)[0] === PROMPT_WORDS.mount, 'adrift beside a vehicle on its back: still mount, not the boots');
}

{
  const board = fill(at({ near: 'board' }));
  ok(board === 1 && words(board)[0] === PROMPT_WORDS.board, 'beside a ship with room: board');
  const mount = fill(at({ near: 'mount' }));
  ok(words(mount)[0] === PROMPT_WORDS.mount, 'beside a speeder: mount');
  const flip = fill(at({ near: 'flip' }));
  ok(words(flip)[0] === PROMPT_WORDS.flip, 'beside a speeder on its back: flip it upright');
}

// --- the jump's override ------------------------------------------------------------------------------

{
  // The tunnel takes the controls: only what the crew can do gets through, and nothing under it shows.
  const lift = fill(at({ jump: 'lift', lift: true, near: 'mount', shipMenu: 'here' }));
  ok(lift === 1 && words(lift)[0] === PROMPT_WORDS.lift, 'in a jump, in a lift: the lift, and nothing else');
  const flying = fill(at({ jump: 'piloting', piloting: true, shipMenu: 'here', vehicle: { kind: 'ship', ship: true, airborne: true } }));
  ok(flying === 1 && words(flying)[0] === PROMPT_WORDS.letGo, 'in a jump, at the controls: let go, and nothing else');
  const spot = fill(at({ jump: 'controls', aboard: true, atControls: true }));
  ok(spot === 1 && words(spot)[0] === PROMPT_WORDS.takeControls, 'in a jump, beside the controls: take them');
  const wait = fill(at({ jump: 'waiting', aboard: true, shipMenu: 'here' }));
  ok(wait === 0, 'in a jump with nothing to do: the bar is empty');
}

// --- two things at once -------------------------------------------------------------------------------

{
  // A lift shaft inside a ship: both want the same key. The one underfoot wins, exactly as the long
  // line decided it, and the way out is not offered under the same cap with other words.
  const n = fill(at({ lift: true, aboard: true }));
  ok(n === 1 && words(n)[0] === PROMPT_WORDS.lift, `a lift aboard a ship: the lift wins (${show(n).join(', ')})`);
  ok(!words(n).includes(PROMPT_WORDS.stepOut), 'a lift aboard a ship: the way out is not shown twice on one key');
}

{
  // A doorless building beside a speeder: the same key again, and the building is underfoot.
  const n = fill(at({ doorless: true, near: 'mount' }));
  ok(n === 1 && words(n)[0] === PROMPT_WORDS.inside, `a doorless building beside a speeder: the building wins (${show(n).join(', ')})`);
}

{
  // The gate is the last thing that key can mean, so anything else at all takes it. The gather
  // stands the gate down in these states too, but the rules must not depend on that: a state that
  // says both is filled here and the gate must not appear under a cap that is about to do something
  // else. That is `push`'s one-binding rule, said for the one action added after it.
  for (const [what, fields, want] of [
    ['a lift shaft', { lift: true }, PROMPT_WORDS.lift],
    ['an elevator', { elevator: 'up' as const }, PROMPT_WORDS.up],
    ['a building with no way in', { doorless: true }, PROMPT_WORDS.inside],
    ['a starport', { shuttle: true }, PROMPT_WORDS.shuttle],
    ['a speeder', { near: 'mount' as const }, PROMPT_WORDS.mount],
    ['a ship with a room', { near: 'board' as const }, PROMPT_WORDS.board],
    ['a ship aboard', { aboard: true }, PROMPT_WORDS.stepOut],
  ] as [string, Record<string, unknown>, string][]) {
    const n = fill(at({ gate: 'travel', ...fields }));
    ok(n === 1 && words(n)[0] === want, `a gate and ${what} at once: ${what} keeps the key (${show(n).join(', ')})`);
  }
  // The one thing beside a gate that has a key of its own.
  const menu = fill(at({ gate: 'travel', shipMenu: 'here' }));
  ok(words(menu).join() === `${PROMPT_WORDS.gate},${PROMPT_WORDS.shipMenu}`, `a gate with the ship menu on offer: both, on their own keys (${show(menu).join(', ')})`);
}

{
  // The boots and a lift shaft: two different keys, so both are shown.
  const n = fill(at({ lift: true, boots: true, bootsReach: false }));
  ok(n === 2 && words(n).join() === `${PROMPT_WORDS.lift},${PROMPT_WORDS.letGoSurface}`, `a lift with the boots on: both, on their own keys (${show(n).join(', ')})`);
}

{
  // On foot with the ship menu on offer: it takes the slot after whatever is underfoot.
  const n = fill(at({ near: 'board', shipMenu: 'here' }));
  ok(words(n).join() === `${PROMPT_WORDS.board},${PROMPT_WORDS.shipMenu}`, `beside a ship in space: board it or open the menu (${show(n).join(', ')})`);
}

// --- the three rules that are ours ---------------------------------------------------------------------

{
  // Everything at once. The bar never overruns its slots and never repeats a key.
  const n = fill(
    at({
      mounted: true,
      shipMenu: 'altitude',
      lift: true,
      doorless: true,
      near: 'board',
      vehicle: { kind: 'ship', ship: true, airborne: true, canLand: true, powered: true, wings: true, guns: true, cutKey: 'KeyJ' },
    }),
  );
  ok(n <= PROMPT.slots, `everything at once: at most ${PROMPT.slots} actions`);
  const seen = keys(n);
  ok(new Set(seen).size === seen.length, `everything at once: no key twice (${seen.join(', ')})`);
}

{
  // Nothing is built: the slots the bar owns are the slots that come back, every time.
  const before = slots.map((s) => s);
  fill(at({ mounted: true, vehicle: { kind: 'ship', ship: true, airborne: true, canLand: true, powered: true, cutKey: 'KeyJ' } }));
  fill(at({ near: 'board' }));
  ok(
    slots.every((s, i) => s === before[i]),
    'the same slot objects are filled every time, never new ones',
  );
}

{
  // Every action names a real binding, so a cap can always be resolved; the bare keys are key codes.
  const states = [
    at({ noclip: true }),
    at({ mounted: true, shipMenu: 'here', vehicle: { kind: 'ship', ship: true, airborne: true, canLand: true, powered: true, wings: true, guns: true, cutKey: 'KeyJ' } }),
    at({ mounted: true, vehicle: { kind: 'ground', hop: true, boost: true } }),
    at({ piloting: true, vehicle: { kind: 'ship', ship: true, landed: true } }),
    at({ lift: true }),
    at({ elevator: 'up' }),
    at({ doorless: true }),
    at({ gate: 'travel' }),
    at({ gate: 'nowhere' }),
    at({ boots: true, bootsReach: true }),
    at({ aboard: true, atControls: true }),
    at({ eva: true }),
    at({ near: 'flip' }),
    at({ jump: 'controls' }),
  ];
  let bad = '';
  let longest = 0;
  const words2 = new Set<string>(Object.values(PROMPT_WORDS));
  for (const s of states) {
    const n = fill(s);
    for (let i = 0; i < n; i++) {
      const a = slots[i];
      if (a.action && !BINDINGS.has(a.action)) bad = `${a.action} is not a binding`;
      if (!a.action && !/^[A-Za-z]/.test(a.code)) bad = `an action with neither a binding nor a key: ${a.label}`;
      if (!words2.has(a.label)) bad = `a label built somewhere other than the table: ${a.label}`;
      longest = Math.max(longest, a.label.length);
    }
  }
  ok(!bad, `every action names a binding the game has, and every label comes from the one table${bad ? `: ${bad}` : ''}`);
  ok(longest <= PROMPT.maxLabel, `the longest label is ${longest} characters, inside the ${PROMPT.maxLabel} the bar allows`);
}

{
  // The list above is written out by hand, which is the way that check can be passed by omission: a
  // field added to `PromptState` and not added there is a state its label rule never sees, and a
  // label built outside the table would go unnoticed for as long as nobody thought to add a row. So
  // the fields are read out of the source instead and every one of them is driven — alone, and in
  // every pair, which is what reaches an action offered only when two things are true at once.
  const src = readFileSync(new URL('../../../src/ui/promptRules.ts', import.meta.url), 'utf8');
  /** A named union's members, or the literals written inline on the field itself. */
  const literalsOf = (type: string): string[] => {
    const t = type.trim();
    const here = [...t.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    if (here.length) return here;
    const alias = new RegExp(`export type ${t} =([^;]+);`).exec(src);
    return alias ? [...alias[1].matchAll(/'([^']*)'/g)].map((m) => m[1]) : [];
  };
  /** Every field of an interface in the source, with the values worth trying for it. */
  const fieldsOf = (name: string, skip: string[]): [string, unknown[]][] => {
    const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(src);
    assert.ok(body, `the ${name} fields were found in the source`);
    const out: [string, unknown[]][] = [];
    for (const m of body[1].matchAll(/^ {2}([A-Za-z0-9_]+): ([^;]+);/gm)) {
      const [, key, type] = m;
      if (skip.includes(key)) continue;
      if (type.trim() === 'boolean') out.push([key, [true, false]]);
      else {
        const lits = literalsOf(type);
        if (lits.length) out.push([key, lits]);
      }
    }
    return out;
  };
  // `vehicle` is the nested struct and is swept on its own below; `live` false is the empty bar and
  // is checked at the top of this file; `kind` and `cutKey` are free strings the game always fills.
  const stateFields = fieldsOf('PromptState', ['vehicle', 'live']);
  const vehicleFields = fieldsOf('PromptVehicle', ['kind', 'cutKey']);
  ok(stateFields.length >= 15 && vehicleFields.length >= 10, `the state fields were read out of the source (${stateFields.length} on the state, ${vehicleFields.length} on the vehicle)`);
  ok(stateFields.some(([k]) => k === 'gate'), 'the gate between a world\'s zones is one of the fields the sweep found');

  const table = new Set<string>(Object.values(PROMPT_WORDS));
  let swept = 0;
  let fault = '';
  const drive = (fill: (s: ReturnType<typeof newPromptState>) => void) => {
    const s = at({});
    // A vehicle the game would really have: the bar is never handed a ship with no key to cut it by.
    Object.assign(s.vehicle, { kind: 'ship', ship: true, cutKey: 'KeyJ' });
    fill(s);
    const n = fillActions(s, slots);
    swept++;
    if (n > PROMPT.slots) fault ||= `more actions than slots: ${n}`;
    const seen: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = slots[i];
      const cap = a.action || `[${a.code}]`;
      if (seen.includes(cap)) fault ||= `one binding twice on the bar: ${cap}`;
      seen.push(cap);
      if (a.action && !BINDINGS.has(a.action)) fault ||= `${a.action} is not a binding`;
      if (!a.action && !/^[A-Za-z]/.test(a.code)) fault ||= `an action with neither a binding nor a key: ${a.label}`;
      if (!table.has(a.label)) fault ||= `a label built somewhere other than the table: ${JSON.stringify(a.label)}`;
      if (a.label.length > PROMPT.maxLabel) fault ||= `a label wider than the bar: ${a.label}`;
    }
  };
  for (const [key, values] of stateFields) for (const v of values) drive((s) => void ((s as unknown as Record<string, unknown>)[key] = v));
  for (const [k1, v1s] of stateFields) {
    for (const v1 of v1s) {
      for (const [k2, v2s] of stateFields) {
        if (k2 === k1) continue;
        for (const v2 of v2s) {
          drive((s) => {
            const r = s as unknown as Record<string, unknown>;
            r[k1] = v1;
            r[k2] = v2;
          });
        }
      }
    }
  }
  for (const [key, values] of vehicleFields) {
    for (const v of values) {
      drive((s) => void ((s.mounted = true), ((s.vehicle as unknown as Record<string, unknown>)[key] = v)));
      drive((s) => void ((s.piloting = true), ((s.vehicle as unknown as Record<string, unknown>)[key] = v)));
    }
  }
  ok(!fault, `every state the struct can be in fills the bar with the table's own words and one cap a key (${swept} states swept)${fault ? `: ${fault}` : ''}`);
}

{
  // The slot count is one number and the bar obeys it.
  tunePrompt({ slots: 2 });
  const n = fill(at({ mounted: true, shipMenu: 'here', vehicle: { kind: 'ship', ship: true, airborne: true, canLand: true, powered: true, wings: true, guns: true, cutKey: 'KeyJ' } }));
  ok(n === 2, 'the slot count is live: two asked for, two filled');
  reset();
  const back = fill(at({ mounted: true, shipMenu: 'here', vehicle: { kind: 'ship', ship: true, airborne: true, canLand: true, powered: true, wings: true, guns: true, cutKey: 'KeyJ' } }));
  ok(back === DEFAULTS.slots, 'and back to four when it is put back');
  // The cells are built once, so a number that would need more of them is clamped rather than taken
  // and quietly ignored: a knob that looks live and changes nothing is worse than no knob.
  tunePrompt({ slots: 9 });
  ok(PROMPT.slots === PROMPT_MAX_SLOTS, `asking for more slots than the bar has is clamped to ${PROMPT_MAX_SLOTS}`);
  reset();
}

// --- the bar itself (src/ui/prompt.ts) ------------------------------------------------------------
//
// The writer is driven against a stand-in for the page that counts every property written, so "handed
// the same state twice it writes nothing" is a measurement rather than a claim - the same way the
// rest of the display is held. The two things only this file can know are pinned here: that a rebind
// reaches the cap, and that two bindings on one key never arrive as one cap with two meanings.

{
  const dom = { writes: 0 };
  const makeEl = (): any => {
    const el: any = { children: [] as any[] };
    let text = '';
    let hidden = false;
    let cls = '';
    el.appendChild = (child: any) => el.children.push(child);
    Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => { dom.writes++; text = String(v); } });
    Object.defineProperty(el, 'hidden', { get: () => hidden, set: (v) => { dom.writes++; hidden = !!v; } });
    Object.defineProperty(el, 'className', { get: () => cls, set: (v) => { cls = String(v); } });
    return el;
  };
  // `hidden` is written once when a cell is built, before the bar can count anything; the count that
  // matters starts after construction.
  (globalThis as any).document = { createElement: () => makeEl() };

  const { ActionBar } = await import('../../../src/ui/prompt.ts');
  /** The keys the game ships with, as the bar reads them: the object is edited in place by a rebind. */
  const bound: Record<string, string[]> = { mount: ['KeyE'], ship: ['KeyP'], crouch: ['ControlLeft'], wings: ['KeyU'], forward: ['KeyW'], jump: ['Space'], brake: ['KeyQ'], target: ['Tab'], walk: ['ShiftLeft'] };
  const bar = new ActionBar(makeEl());
  bar.setBindings(bound);
  const stats = bar.debug();
  // Building the cells hides each one, which is a write the page takes before the bar has a counter
  // worth reading. Everything after this point is counted on both sides and must agree.
  const domAtStart = dom.writes;

  const beside = () => at({ near: 'board', shipMenu: 'here' });
  bar.set(beside());
  ok(bar.keyAt(0) === 'E' && bar.labelAt(0) === 'board', `the bar shows the key that is bound (${bar.keyAt(0)} ${bar.labelAt(0)})`);
  ok(bar.keyAt(1) === 'P' && bar.labelAt(1) === 'ship menu', `and the second cap too (${bar.keyAt(1)} ${bar.labelAt(1)})`);
  ok(stats.shown === 2, 'two actions beside a ship with the menu on offer');

  {
    const before = stats.writes;
    bar.set(beside());
    bar.set(beside());
    ok(stats.writes === before, 'handed the same state twice the bar writes nothing at all');
    ok(dom.writes - domAtStart === stats.writes, `every write the bar counted is one the page took (${dom.writes - domAtStart} against ${stats.writes})`);
  }

  {
    // The Controls page edits the bindings object in place. Nothing tells the bar.
    const before = stats.rebinds;
    bound.mount = ['KeyG'];
    bar.set(beside());
    ok(bar.keyAt(0) === 'G', `a rebind reaches the cap with nothing having to tell it (${bar.keyAt(0)})`);
    ok(stats.rebinds === before + 1, 'and is counted as a rebind');
    ok(bar.labelAt(0) === 'board', 'the words under a rebound cap do not change');
  }

  {
    // The rebinding is done in the Escape menu, where the game is not simulating and the bar is down.
    // A key that moved while it was down must still reach the cap, and still count.
    const before = stats.rebinds;
    bar.clear();
    ok(stats.shown === 0 && bar.keyAt(0) === '' && bar.labelAt(0) === '', 'a bar that is cleared says nothing at all');
    bound.mount = ['KeyH'];
    bar.set(beside());
    ok(bar.keyAt(0) === 'H', `a key rebound while the bar was down reaches the cap (${bar.keyAt(0)})`);
    ok(stats.rebinds === before + 1, 'and is counted, which is the one figure a rebind can be checked by');
  }

  {
    // A cell that goes down and comes back unchanged writes only the attribute that hides it.
    const before = stats.writes;
    bar.clear();
    bar.set(beside());
    ok(stats.writes === before + 4, `two cells down and up again is four writes and no more (${stats.writes - before})`);
  }

  {
    // Two different bindings on one key. The rules cannot see it - they have no bindings in them - so
    // the bar drops the second rather than showing one cap with two meanings.
    bound.ship = ['KeyH'];
    bar.set(beside());
    ok(stats.shown === 1, `two bindings on one key show one cap (${bar.keyAt(0)} ${bar.labelAt(0)}, ${stats.shown} shown)`);
    ok(bar.labelAt(0) === 'board' && bar.labelAt(1) === '', 'and it is the first of them that is kept');
    bound.ship = ['KeyP'];
    bound.mount = ['KeyE'];
  }

  {
    // The caps are spelled for a cap: the Controls page's own "Left Ctrl" does not belong on one.
    bar.set(at({ mounted: true, vehicle: { kind: 'ship', ship: true, airborne: true, canLand: true, powered: true, cutKey: 'KeyJ' } }));
    ok(bar.keyAt(1) === 'Ctrl', `a modifier is spelled as a cap, not as a keyboard diagram (${bar.keyAt(1)})`);
    ok(bar.keyAt(2) === 'J' && bar.labelAt(2) === PROMPT_WORDS.cutEngines, `the bare key the engine cut is read from shows as itself (${bar.keyAt(2)})`);
  }

  {
    // The death card, a panel, the loading screen. The bar must be empty on the frame it stops
    // simulating, which is the whole reason it is filled every frame rather than at its own rate.
    const state = at({ near: 'board' });
    state.live = false;
    bar.set(state);
    ok(stats.shown === 0 && bar.labelAt(0) === '', 'not simulating: the bar empties itself');
  }
}

console.log(`\n${checks} checks passed`);
