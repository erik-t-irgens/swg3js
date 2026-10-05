// The key bindings (src/core/input.ts): the defaults, what a player's saved bindings make of them, and what
// is kept. Three rules are pinned here. A key somebody chose for one action always wins over a default that
// later moved onto it (J went to the journal and O to the pick-up, and a player who had put an emote on J
// must not find J opening the journal as well), and the default has its key back once nobody's choice
// holds it, because only what the player chose is ever kept; keys two defaults share on purpose are left
// alone, on load and on the Controls page alike. And an action whose keys were taken off on purpose stays
// with none across a save and a load, where an empty list used to mean "the default", which handed a key
// straight back to the action it had just been taken from.
//
// The class itself is built against a stand-in page and storage, so the save and the load are the class's
// own and not a copy of them. Nothing here is read from the game's files.
import assert from 'node:assert/strict';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- a stand-in page and storage ----------------------------------------------------------------------

const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
const listeners = { add() {}, remove() {} };
g.window = { addEventListener: listeners.add, removeEventListener: listeners.remove, setTimeout: () => 0, clearTimeout: () => {} };
g.document = { addEventListener: listeners.add, removeEventListener: listeners.remove, pointerLockElement: null, exitPointerLock() {} };

const { DEFAULT_BINDINGS, Input, bindingsToKeep, chosenBindings, loadedBindings } = await import('../../../src/core/input.ts');
type Action = keyof typeof DEFAULT_BINDINGS;
const canvas = {} as HTMLCanvasElement;
const KEY = 'swg3js.bindings';

// --- a fresh profile -------------------------------------------------------------------------------------
{
  store.clear();
  const input = new Input(canvas);
  ok(input.bindings.journal.join() === 'KeyJ', 'a fresh profile has the journal on J');
  ok(input.bindings.takeProp.join() === 'KeyO', 'the pick-up on O');
  ok(input.bindings.group.join() === 'Period', 'and the Group tab on the full stop, a binding like any other');
  ok(input.bindings.waypoints.join() === 'KeyY' && input.bindings.map.join() === 'KeyM', 'Y and M as they were');
  // Every key a default shares with another default is shared on purpose; none of the three new ones is.
  const holders = (code: string) => (Object.keys(DEFAULT_BINDINGS) as Action[]).filter((a) => DEFAULT_BINDINGS[a].includes(code));
  ok(holders('KeyJ').join() === 'journal' && holders('KeyO').join() === 'takeProp' && holders('Period').join() === 'group', 'and J, O and the full stop are each one default action\'s alone');
  ok(Object.keys(bindingsToKeep(input.bindings)).length === 0 && !store.has(KEY), 'nothing is kept for a profile that changed nothing');
  ok(Object.keys(chosenBindings({ journal: ['KeyJ'], jump: ['KeyK'] })).join() === 'jump', 'a choice that is only the default is no choice: that action follows the defaults');
}

// --- a key somebody saved wins over a default that moved onto it ------------------------------------------
{
  const b = loadedBindings({ emote1: ['KeyJ'] });
  ok(b.emote1.join() === 'KeyJ', 'saved { emote1: [KeyJ] }: the emote keeps J');
  ok(!b.journal.includes('KeyJ') && b.journal.length === 0, 'and the journal, left on its default, does not take J as well: it has no key');
  ok(b.takeProp.join() === 'KeyO', 'the pick-up keeps O, which nobody saved');
  // A player who had moved the pick-up somewhere and the journal to O keeps both.
  const moved = loadedBindings({ takeProp: ['KeyK'], journal: ['KeyO'] });
  ok(moved.takeProp.join() === 'KeyK' && moved.journal.join() === 'KeyO', 'saved bindings stand exactly as saved');
  // One who had put the journal on O by hand keeps it there, and the pick-up's new default gives way.
  const onO = loadedBindings({ journal: ['KeyO'] });
  ok(onO.journal.join() === 'KeyO' && onO.takeProp.length === 0, 'a journal saved on O keeps O and the pick-up, on its default, gives O up');
  // A saved binding that kept its own default key leaves a default that shares it on purpose alone: the
  // placing keys borrow E and F, and adding a second key to the use key must not take E off placing.
  const shared = loadedBindings({ mount: ['KeyE', 'KeyG'] });
  ok(shared.placeRight.includes('KeyE'), 'a key two defaults share on purpose is left shared when one of them is saved with it');
  ok(!shared.emoteWheel.includes('KeyG'), 'while the key the player added to the use key is taken off the emote wheel, as the Controls page would have');
  // Rubbish in storage is ignored, entry by entry.
  const junk = loadedBindings(JSON.parse('{"nothing": ["KeyQ"], "jump": "Space", "crouch": [1, 2], "walk": [""], "__proto__": {"map": ["KeyX"]}}'));
  ok(junk.jump.join() === 'Space' && junk.crouch.join() === DEFAULT_BINDINGS.crouch.join() && junk.walk.join() === DEFAULT_BINDINGS.walk.join() && junk.map.join() === 'KeyM', 'an entry that is not an action with a list of key names is ignored');
  ok(loadedBindings(null).journal.join() === 'KeyJ' && loadedBindings([1]).journal.join() === 'KeyJ', 'and storage that is not a table at all reads as nothing saved');
}

// --- the same through the class, saved by one Input and read back by the next -----------------------------
{
  store.clear();
  store.set(KEY, JSON.stringify({ emote1: ['KeyJ'] }));
  const input = new Input(canvas);
  ok(input.bindings.emote1.join() === 'KeyJ' && input.bindings.journal.length === 0, 'built over a saved { emote1: [KeyJ] }, J is the emote\'s and the journal has none');
  store.set(KEY, '{not json');
  const bad = new Input(canvas);
  ok(bad.bindings.journal.join() === 'KeyJ', 'storage that does not parse leaves the defaults');
}

// --- an empty binding asked for is kept ----------------------------------------------------------------------
{
  store.clear();
  const input = new Input(canvas);
  input.bind('takeProp', [], { empty: 'none' });
  ok(input.bindings.takeProp.length === 0, "bind(a, [], { empty: 'none' }) leaves the action with no key");
  ok(JSON.parse(store.get(KEY) ?? '{}').takeProp?.length === 0, 'and keeps that as an empty list');
  const next = new Input(canvas);
  ok(next.bindings.takeProp.length === 0, 'which survives a save and a load: the action comes back with no key, not its default');
  ok(next.bindings.journal.join() === 'KeyJ', 'and nothing else moved');
  next.bind('takeProp', []);
  ok(next.bindings.takeProp.join() === 'KeyO', 'the plain bind(a, []) still restores the default, as __debug.bind says it does');
  ok(!store.has(KEY), 'and with everything back on its default, nothing is kept');
}

// --- an action the rule emptied is never written down as a choice ---------------------------------------------
// The journal, emptied on load because a saved emote holds J, is not something the player chose. Kept as an
// empty list the first time anything else was rebound, it read back as a choice of no key and the journal
// never had J again, even once the emote had moved off it.
{
  store.clear();
  store.set(KEY, JSON.stringify({ emote1: ['KeyJ'] }));
  const input = new Input(canvas);
  ok(input.bindings.journal.length === 0, 'over a saved { emote1: [KeyJ] } the journal starts with no key');
  input.bind('jump', ['KeyK']);
  const kept = JSON.parse(store.get(KEY) ?? '{}') as Record<string, string[]>;
  ok(kept.jump?.join() === 'KeyK' && kept.emote1?.join() === 'KeyJ' && !Object.hasOwn(kept, 'journal'), 'an unrelated rebind keeps the jump and the emote, and does not write the emptied journal down');
  input.assignKey('emote1', ['KeyH'], 'KeyH');
  ok(input.bindings.emote1.join() === 'KeyH' && input.bindings.journal.join() === 'KeyJ', 'the emote moved off J gives the journal J back at once');
  ok(!input.bindings.help.includes('KeyH'), 'while the help, on its default, gives H up to the emote that took it');
  const after = new Input(canvas);
  ok(after.bindings.journal.join() === 'KeyJ' && after.bindings.emote1.join() === 'KeyH' && !after.bindings.help.includes('KeyH'), 'and a reload gives back exactly that');
  input.assignKey('emote1', ['ArrowUp'], 'ArrowUp');
  ok(input.bindings.help.join() === 'KeyH', 'the emote back on its own key gives the help H back too: nobody chose to take it off');
}

// --- the Controls page takes a key from another action -------------------------------------------------------
// What `assign` in src/ui/menu.ts does when a key is pressed for one action and another already holds it
// (`Input.assignKey`): the key moves here rather than doing two things, and an action the player chose
// keys for is left with what it has left, nothing included. Two defaults that share a key on purpose keep
// sharing it when one of them is put back on it.
{
  store.clear();
  const input = new Input(canvas);
  input.assignKey('journal', ['KeyO'], 'KeyO');
  ok(input.bindings.journal.join() === 'KeyO' && !input.bindings.takeProp.includes('KeyO'), 'the journal put on O takes O off the pick-up');
  const after = new Input(canvas);
  ok(after.bindings.journal.join() === 'KeyO' && after.bindings.takeProp.length === 0, 'and after a reload one press of O still answers once');
  // A choice taken off: an action the player had chosen keys for keeps what is left of them, none included.
  input.assignKey('emote2', ['KeyX'], 'KeyX');
  ok(input.bindings.emote2.join() === 'KeyX' && input.bindings.crouch.join() === 'ControlLeft,ControlRight', 'X on an emote comes off the crouch, which keeps its other two');
  input.assignKey('jump', ['KeyX'], 'KeyX');
  ok(input.bindings.jump.join() === 'KeyX' && input.bindings.emote2.length === 0, 'and X taken on for the jump leaves the emote, which the player had chosen, with none');
  ok(new Input(canvas).bindings.emote2.length === 0, 'which it keeps across a reload');
  // Backspace on an action's last key.
  input.assignKey('help', [], null);
  ok(input.bindings.help.length === 0 && new Input(canvas).bindings.help.length === 0, "Backspace on an action's last key leaves it with none, for good");
  // Keys two defaults share on purpose.
  store.clear();
  const shared = new Input(canvas);
  shared.assignKey('block', ['KeyB'], 'KeyB');
  ok(shared.bindings.block.join() === 'KeyB' && shared.bindings.altAttack.join() === 'Mouse2', 'the block moved off right mouse leaves the other attack on it');
  shared.assignKey('block', ['Mouse2'], 'Mouse2');
  ok(shared.bindings.block.join() === 'Mouse2' && shared.bindings.altAttack.join() === 'Mouse2', 'and the block put back on right mouse shares it with the other attack again, as their defaults do');
  const reread = new Input(canvas);
  ok(reread.bindings.altAttack.join() === 'Mouse2' && reread.bindings.block.join() === 'Mouse2', 'across a reload too: the other attack is never left keyless');
  // The same when the other attack is one the player chose keys for, right mouse among them.
  shared.assignKey('altAttack', ['Mouse2', 'KeyG'], 'KeyG');
  shared.assignKey('block', ['Mouse2'], 'Mouse2');
  ok(shared.bindings.altAttack.join() === 'Mouse2,KeyG' && shared.bindings.block.join() === 'Mouse2', 'a chosen other attack keeps right mouse when the block is put on it: the two share it by default');
  ok(new Input(canvas).bindings.altAttack.join() === 'Mouse2,KeyG', 'and keeps it across a reload');
  shared.assignKey('placeRight', ['KeyE'], 'KeyE');
  ok(shared.bindings.mount.join() === 'KeyE', 'the placing key put back on E leaves the use key on E');
  // A key two defaults share, put on a third action, comes off both.
  shared.assignKey('emote3', ['Mouse2'], 'Mouse2');
  ok(shared.bindings.emote3.join() === 'Mouse2' && !shared.bindings.altAttack.includes('Mouse2') && !shared.bindings.block.includes('Mouse2'), 'right mouse put on an emote comes off both the other attack and the block');
  // The menu's own assign is that, and nothing of its own.
  const { readFileSync } = await import('node:fs');
  const menu = readFileSync(new URL('../../../src/ui/menu.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const assign = /private assign\(code: string \| null\): void \{([\s\S]*?)\n  \}/.exec(menu)?.[1] ?? '';
  ok(/this\.input\.assignKey\(c\.action, kept\.filter\(Boolean\), code\);/.test(assign) && !/this\.input\.bind\(/.test(assign), 'the Controls page rebinds through Input.assignKey and nothing else');
  ok(/group: 'Group \(map tab\)'/.test(menu) && /map: 'Map'/.test(menu), 'the Controls page names the Group tab\'s key, and the map is the map, not the galaxy map');
}

// --- the console's bind -------------------------------------------------------------------------------------
{
  store.clear();
  const input = new Input(canvas);
  let threw = '';
  try {
    input.bind('__proto__' as Action, ['KeyQ']);
  } catch (e) {
    threw = String(e);
  }
  ok(/no such action/.test(threw) && !store.has(KEY), 'a name that is not an action is refused and nothing is kept');
  input.bind('emote1', ['KeyJ']);
  ok(input.bindings.emote1.join() === 'KeyJ' && input.bindings.journal.length === 0, "the console's bind follows the same rule: J put on an emote is the emote's alone");
  input.bind('emote1', []);
  ok(input.bindings.emote1.join() === 'ArrowUp' && input.bindings.journal.join() === 'KeyJ' && !store.has(KEY), 'and bind(a, []) puts both back and keeps nothing');
  input.bind('jump', ['KeyK']);
  input.resetBindings();
  ok(input.bindings.jump.join() === 'Space' && !store.has(KEY), 'reset puts every default back and keeps nothing');
}

console.log(`\n${checks} checks passed`);
