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

const { DEFAULT_BINDINGS, FIGHT_ACTIONS, Input, bindingsToKeep, chosenBindings, loadedBindings } = await import('../../../src/core/input.ts');
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
  // placing keys borrow R and F, and adding a second key to the torch must not take F off placing.
  const shared = loadedBindings({ flashlight: ['KeyF', 'KeyG'] });
  ok(shared.placeLift.includes('KeyF'), 'a key two defaults share on purpose is left shared when one of them is saved with it');
  ok(!shared.emoteWheel.includes('KeyG'), 'while the key the player added to the torch is taken off the emote wheel, as the Controls page would have');
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
  shared.assignKey('placeTurn', ['KeyR'], 'KeyR');
  ok(shared.bindings.saberThrow.join() === 'KeyR', 'the placing turn put back on R leaves the saber throw on R');
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

// --- the placing keys, and the mutes that keep the fight out of a hand -------------------------------------
// Holding R turns a thing in hand and holding F raises it (the four step keys Q, E, R and F are gone); R is
// also the saber throw's and F the torch's, on purpose. While something is in hand the game mutes everything
// that fights by action, never by key -- R must still read as the placing turn while the throw is muted --
// and the frame the hand empties it mutes them until their keys are up. Raw reads are never muted.
{
  store.clear();
  ok(DEFAULT_BINDINGS.placeTurn.join() === 'KeyR' && DEFAULT_BINDINGS.placeLift.join() === 'KeyF', 'R holds the placing turn and F the placing height');
  ok(DEFAULT_BINDINGS.saberThrow.join() === 'KeyR' && DEFAULT_BINDINGS.flashlight.join() === 'KeyF', 'shared on purpose with the saber throw and the torch');
  ok(!Object.hasOwn(DEFAULT_BINDINGS, 'placeLeft') && !Object.hasOwn(DEFAULT_BINDINGS, 'placeUp'), 'the four step keys are gone');
  // A choice saved for one of the four old step keys names nothing now, and is dropped without a word.
  store.set(KEY, JSON.stringify({ placeLeft: ['KeyZ'], placeDown: ['KeyX'], jump: ['KeyK'] }));
  const old = new Input(canvas);
  ok(old.bindings.jump.join() === 'KeyK' && !Object.hasOwn(old.bindings, 'placeLeft') && old.bindings.placeTurn.join() === 'KeyR', 'a saved placeLeft is dropped silently, and the rest of what was saved stands');
  ok(old.bindings.prone.join() === 'KeyZ' && old.bindings.crouch.includes('KeyX'), 'and takes nothing off the keys it once named');

  // Driven through the class's own key handling, as the page's events would.
  store.clear();
  const handlers = new Map<string, (e: unknown) => void>();
  const prevWindow = g.window;
  g.window = { addEventListener: (t: string, f: (e: unknown) => void) => handlers.set(t, f), removeEventListener() {}, setTimeout: () => 0, clearTimeout: () => {} };
  const input = new Input(canvas);
  g.window = prevWindow;
  const down = (code: string) => handlers.get('keydown')!({ code, repeat: false, target: null, preventDefault() {} });
  const up = (code: string) => handlers.get('keyup')!({ code });

  down('KeyR');
  ok(input.held('placeTurn') && input.held('saberThrow') && input.pressedAction('saberThrow'), 'R down reads as both the placing turn and the throw');
  input.mute(FIGHT_ACTIONS);
  ok(input.held('placeTurn') && !input.held('saberThrow') && !input.pressedAction('saberThrow'), 'muted, the throw reads as neither held nor pressed, while the placing turn still reads as held');
  ok(input.isDown('KeyR') && input.justPressed('KeyR'), 'and the raw reads are not muted');
  input.endFrame();
  ok(input.held('saberThrow'), 'a mute for the frame ends with the frame');

  // muteUntilUp: held while any key of the action is down, let go once all are up.
  input.muteUntilUp(FIGHT_ACTIONS);
  input.endFrame();
  ok(!input.held('saberThrow'), 'muted until up, the throw stays muted across frames while R is still down');
  ok(input.held('placeTurn'), 'and the placing turn, never muted, still reads as held');
  ok(!input.muted('attack') && !input.muted('slot1'), 'while an action with no key down was let go of at the end of the frame it was muted in');
  up('KeyR');
  ok(input.muted('saberThrow'), 'let go of the key, the mute stands until the frame ends');
  input.endFrame();
  ok(!input.muted('saberThrow'), 'and is gone after it');
  down('KeyR');
  ok(input.held('saberThrow') && input.pressedAction('saberThrow'), 'a fresh press after that throws again');
  up('KeyR');
  input.endFrame();

  // Every key of an action has to be up: the slots are one key each, the attack is a mouse button.
  down('Digit1');
  input.muteUntilUp(FIGHT_ACTIONS);
  input.endFrame();
  ok(!input.pressedAction('slot1') && !input.held('slot1'), 'a power key still down when the hand emptied uses nothing');
  up('Digit1');
  input.endFrame();
  down('Digit1');
  ok(input.pressedAction('slot1'), 'and pressed again once let go, it does');
  up('Digit1');
  input.endFrame();
  // An action of two keys: the other trigger is the middle button and Q. Held by its second
  // key alone it stays muted, and with both down it stays muted until the last of them is up.
  ok(DEFAULT_BINDINGS.altFire.length === 2 && DEFAULT_BINDINGS.altFire[1] === 'KeyQ', 'the other trigger has two keys, Q the second');
  down('KeyQ');
  input.muteUntilUp(FIGHT_ACTIONS);
  input.endFrame();
  ok(!input.held('altFire') && input.muted('altFire'), 'held by its second key alone when the hand emptied, it stays muted');
  input.force('Mouse1', true);
  input.endFrame();
  up('KeyQ');
  input.endFrame();
  ok(input.muted('altFire') && !input.held('altFire'), 'with one of its two keys let go and the other still down, still muted');
  input.force('Mouse1', false);
  input.endFrame();
  ok(!input.muted('altFire'), 'and let go once the last of them is up');
  input.force('Mouse1', true);
  ok(input.held('altFire') && input.pressedAction('altFire'), 'after which it fires again');
  input.force('Mouse1', false);
  input.endFrame();

  // The kits' own slots and the style key, which both kits read every frame something is in hand.
  const { SLOT_ACTIONS } = await import('../../../src/combat/forcePowers.ts');
  ok((SLOT_ACTIONS as readonly string[]).every((a) => (FIGHT_ACTIONS as readonly string[]).includes(a)), 'everything that fights includes every slot the kits read');
  ok(['attack', 'altAttack', 'altFire', 'block', 'saberThrow', 'saberStyle'].every((a) => (FIGHT_ACTIONS as readonly string[]).includes(a)), 'and the triggers, the block, the throw and the saber style');
  ok(!(FIGHT_ACTIONS as readonly string[]).includes('placeTurn') && !(FIGHT_ACTIONS as readonly string[]).includes('placeLift') && !(FIGHT_ACTIONS as readonly string[]).includes('forward'), 'and never the placing keys or the walk');
  // The one fight action no kit reads: the grapple's fire, which a hand in use mutes as it mutes a shot.
  const beyond = (FIGHT_ACTIONS as readonly string[]).filter((a) => !(SLOT_ACTIONS as readonly string[]).includes(a) && !['attack', 'altAttack', 'altFire', 'block', 'saberThrow', 'saberStyle'].includes(a));
  ok(beyond.join() === 'grappleFire', `and one named exception beyond the kits' slots and triggers: ${beyond.join(', ')}`);
}

// --- the grapple's five actions (the design's §5.1) --------------------------------------------------------------
{
  store.clear();
  const holders = (code: string) => (Object.keys(DEFAULT_BINDINGS) as Action[]).filter((a) => DEFAULT_BINDINGS[a].includes(code));
  ok(holders('Mouse3').join() === 'grappleFire', 'Mouse 4 (the back side button) is the grapple\'s fire alone');
  ok(holders('ShiftLeft').join() === 'walk,reelIn' && holders('ShiftRight').join() === 'walk,reelIn', 'Shift is the walk\'s and the reel-in\'s');
  ok(holders('ControlLeft').join() === 'crouch' && holders('KeyX').join() === 'crouch,noclipDown,reelOut', 'Ctrl is the crouch\'s alone, and X the crouch\'s, noclip\'s down and the reel-out\'s');
  ok(holders('Space').join() === 'jump,grappleBoost', 'Space is the jump\'s and the boost\'s');
  ok(holders('KeyF').sort().join() === 'flashlight,grappleHaul,placeLift', 'F is the torch\'s, the placing height\'s and the haul\'s');
  const keys = Object.keys(DEFAULT_BINDINGS);
  const at = keys.indexOf('flashlight');
  ok(keys.slice(at + 1, at + 6).join() === 'grappleFire,reelIn,reelOut,grappleBoost,grappleHaul', 'listed together after the torch, so the Controls page shows them together');
  // The rebind cases: a key a player chose for something else wins over these defaults.
  const emote = loadedBindings({ emote1: ['ShiftLeft'] });
  ok(emote.emote1.join() === 'ShiftLeft' && emote.reelIn.join() === 'ShiftRight' && emote.walk.join() === 'ShiftRight', 'an emote put on Left Shift keeps it, and the reel-in (and the walk) keep Right Shift');
  const blocked = loadedBindings({ block: ['Mouse3'] });
  ok(blocked.block.join() === 'Mouse3' && blocked.grappleFire.length === 0, 'a block chosen on Mouse 4 keeps it, and the fire is left with no key');
  const walked = loadedBindings({ walk: ['CapsLock'] });
  ok(walked.walk.join() === 'CapsLock' && walked.reelIn.join() === 'ShiftLeft,ShiftRight', 'the walk moved to Caps Lock leaves the reel-in on Shift, which nobody chose');
  const xed = loadedBindings({ emote2: ['KeyX'] });
  ok(xed.emote2.join() === 'KeyX' && xed.reelOut.length === 0 && xed.noclipDown.length === 0 && xed.crouch.join() === 'ControlLeft,ControlRight', 'an emote put on X takes it off the reel-out, noclip\'s down and the crouch, which keeps Ctrl');
  // Whose choice emptied the fire: told only when it was somebody else's.
  store.set(KEY, JSON.stringify({ block: ['Mouse3'] }));
  const theirs = new Input(canvas);
  ok(theirs.bindings.grappleFire.length === 0 && !theirs.chose('grappleFire'), "with somebody's block on Mouse 4 the fire has no key and was not chosen empty (the game says so once)");
  store.clear();
  const mine = new Input(canvas);
  mine.assignKey('grappleFire', [], null);
  ok(mine.bindings.grappleFire.length === 0 && mine.chose('grappleFire'), 'taken off the fire on purpose (Backspace on the Controls page), it is chosen empty, and nothing is said');
  // The reel-in moved and put back shares Shift with the walk again.
  store.clear();
  const back = new Input(canvas);
  back.assignKey('reelIn', ['KeyV'], 'KeyV');
  ok(back.bindings.reelIn.join() === 'KeyV' && back.bindings.walk.join() === 'ShiftLeft,ShiftRight', 'the reel-in moved to V leaves the walk on Shift');
  back.assignKey('reelIn', ['ShiftLeft', 'ShiftRight'], 'ShiftLeft');
  ok(back.bindings.reelIn.join() === 'ShiftLeft,ShiftRight' && back.bindings.walk.join() === 'ShiftLeft,ShiftRight', 'and put back on Shift it shares it with the walk again, as their defaults do');
}

// --- Ctrl with a move key, kept from the browser while the pointer is locked ------------------------------------
{
  const { cancelsKey } = await import('../../../src/core/input.ts');
  const b = { ...DEFAULT_BINDINGS };
  ok(['KeyW', 'KeyS', 'KeyA', 'KeyD'].every((k) => cancelsKey(k, true, true, b)), 'Ctrl with W, S, A or D is cancelled while the pointer is locked');
  ok(!cancelsKey('KeyI', true, true, b) && !cancelsKey('KeyS', true, false, b) && !cancelsKey('KeyS', false, true, b), 'Ctrl with I, Ctrl with the pointer free and S with no Ctrl are not');
  const moved = { ...DEFAULT_BINDINGS, forward: ['KeyE'] };
  ok(cancelsKey('KeyE', true, true, moved) && !cancelsKey('KeyW', true, true, moved), 'a move key rebound to another code is followed: Ctrl with it is cancelled, and Ctrl with the old one is not');
}

// --- the placement editor's destination: the dev server's alone ----------------------------------------------
// L in hand moves where a thing is kept (`placeLayer`), borrowed from the saber's on and off as the placing keys
// borrow R and F: shared on purpose, so neither takes it off the other, and the Controls page of a release does
// not list it at all (nothing there reads it).
{
  store.clear();
  const { DEV_ONLY_ACTIONS, controlsActions } = await import('../../../src/core/input.ts');
  ok(DEFAULT_BINDINGS.placeLayer.join() === 'KeyL' && DEFAULT_BINDINGS.saberToggle.join() === 'KeyL', 'the editor\'s destination is on L, shared with the saber\'s on and off');
  ok(DEV_ONLY_ACTIONS.has('placeLayer') && !controlsActions(false).includes('placeLayer') && controlsActions(true).includes('placeLayer'), 'a release\'s Controls page leaves it out, and the dev server\'s lists it');
  ok(controlsActions(false).length === Object.keys(DEFAULT_BINDINGS).length - DEV_ONLY_ACTIONS.size && controlsActions(false).includes('saberToggle'), 'and leaves nothing else out');
  const shared = loadedBindings({ saberToggle: ['KeyL', 'KeyK'] });
  ok(shared.placeLayer.join() === 'KeyL', 'a saber key chosen with L kept leaves the destination on L: the two share it by default');
  const moved = loadedBindings({ emote1: ['KeyL'] });
  ok(moved.placeLayer.length === 0 && moved.saberToggle.length === 0, 'while L chosen for something else is taken off both, as any default gives way to a choice');
  const input = new Input(canvas);
  input.assignKey('saberToggle', ['KeyP'], 'KeyP');
  ok(input.bindings.placeLayer.join() === 'KeyL' && input.bindings.saberToggle.join() === 'KeyP', 'the saber moved off L on the Controls page leaves the destination on it');
  input.assignKey('saberToggle', ['KeyL'], 'KeyL');
  ok(input.bindings.placeLayer.join() === 'KeyL' && input.bindings.saberToggle.join() === 'KeyL', 'and put back on L shares it with the destination again, as their defaults do');
  ok(!(FIGHT_ACTIONS as readonly string[]).includes('placeLayer') && !(FIGHT_ACTIONS as readonly string[]).includes('saberToggle'), 'neither is muted with the fight while something is in hand, so L reads as the destination then');
  const main = (await import('node:fs')).readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  ok(/if \(!this\.map\.open && !this\.anyPanelOpen\(\) && !this\.placing && !this\.propPlacing\) \{\s*if \(input\.pressedAction\('saberToggle'\)/.test(main), 'and the saber\'s on and off is never read with something in hand');
  ok(/if \(import\.meta\.env\.DEV && \(this\.placing \|\| this\.propPlacing\) && input\.pressedAction\('placeLayer'\)\) this\.cycleDestination\(\);/.test(main), 'the destination is read only with something in hand, and only on the dev server');
  // The Controls page itself: it lists what `controlsActions` gives it for the build it is in, and the action's words
  // are the dev server's alone, so a release neither lists the action nor carries what it would say.
  const menu = (await import('node:fs')).readFileSync(new URL('../../../src/ui/menu.ts', import.meta.url), 'utf8');
  const keyRows = /private keyRows\(\): string \{([\s\S]*?)\n  \}/.exec(menu)?.[1] ?? '';
  ok(/return controlsActions\(import\.meta\.env\.DEV\)\s*\.map\(/.test(keyRows) && !/Object\.keys\(DEFAULT_BINDINGS\)/.test(keyRows), "the Controls page lists `controlsActions` for the build it is in, never the whole table");
  ok(/placeLayer: import\.meta\.env\.DEV \? '[^']+' : '',/.test(menu), "and the action's label is words on the dev server and none in a release");
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

// --- the racer pass's racing mode: on U with the wings, on purpose -------------------------------------------------
{
  store.clear();
  const holders = (code: string) => (Object.keys(DEFAULT_BINDINGS) as Action[]).filter((a) => DEFAULT_BINDINGS[a].includes(code));
  ok(DEFAULT_BINDINGS.raceMode.join() === 'KeyU' && holders('KeyU').sort().join() === 'raceMode,wings', 'racing mode is on U, shared on purpose with the wings (a bike reads the one, a ship the other)');
  const input = new Input(canvas);
  ok(input.bindings.raceMode.join() === 'KeyU' && input.bindings.wings.join() === 'KeyU', 'a fresh profile has both on U');
  input.assignKey('raceMode', ['KeyH'], 'KeyH');
  const after = new Input(canvas);
  ok(after.bindings.raceMode.join() === 'KeyH' && after.bindings.wings.join() === 'KeyU', 'racing mode rebound to H leaves the wings on U, across a reload');
  store.clear();
  const other = new Input(canvas);
  other.assignKey('wings', ['KeyK'], 'KeyK');
  ok(new Input(canvas).bindings.raceMode.join() === 'KeyU', 'and the wings rebound leave racing mode on U');
  store.clear();
  const emote = loadedBindings({ emote1: ['KeyU'] });
  ok(emote.emote1.join() === 'KeyU' && emote.raceMode.length === 0 && emote.wings.length === 0, 'a player who chose U for something else takes it from both');
  store.clear();
}

// --- the racer pass's repair: on R with the saber throw and the placing turn, on purpose ---------------------------
{
  store.clear();
  const holders = (code: string) => (Object.keys(DEFAULT_BINDINGS) as Action[]).filter((a) => DEFAULT_BINDINGS[a].includes(code));
  ok(DEFAULT_BINDINGS.repair.join() === 'KeyR' && holders('KeyR').sort().join() === 'placeTurn,repair,saberThrow', 'the repair is on R, shared on purpose with the saber throw and the placing turn (mounted, on foot, and in hand)');
  const input = new Input(canvas);
  ok(input.bindings.repair.join() === 'KeyR' && input.bindings.saberThrow.join() === 'KeyR' && input.bindings.placeTurn.join() === 'KeyR', 'a fresh profile has all three on R');
  input.assignKey('repair', ['KeyH'], 'KeyH');
  const after = new Input(canvas);
  ok(after.bindings.repair.join() === 'KeyH' && after.bindings.saberThrow.join() === 'KeyR' && after.bindings.placeTurn.join() === 'KeyR', 'the repair rebound to H leaves the throw and the turn on R, across a reload');
  store.clear();
  const chose = loadedBindings({ emote2: ['KeyR'] });
  ok(chose.emote2.join() === 'KeyR' && chose.repair.length === 0 && chose.saberThrow.length === 0 && chose.placeTurn.length === 0, 'a player who chose R for something else takes it from all three');
  store.clear();
}

console.log(`\n${checks} checks passed`);
