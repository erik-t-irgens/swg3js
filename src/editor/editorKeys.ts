// The world editor's keys: which actions are its own, which of the game's it mutes while it is on, and the two rules
// that keep a developer flying with W from losing the tab or a held key's sense (DESIGN.md §2.14).
//
// **Every key the editor uses is an action** (`DEFAULT_BINDINGS`, all in `DEV_ONLY_ACTIONS`): its own (F2, up and down,
// Tab, the slash, N, Pause), or one of the game's read in its own sense (the move keys fly, Shift is fast and Alt slow,
// R and F hold the hand, O picks a row up, Delete deletes, L moves the destination). Everything else that would fight,
// mount, open a panel the editor does not want or move the body is muted **by action** for the whole frame once the
// editor's block has read what it borrows (`EDITOR_MUTES`), never by key: a raw key read is never muted, so the editor
// reads raw keys only for its own Ctrl chords (W2) and mutes every action while Ctrl is held (`ctrlRule`). And no
// editor default holds Ctrl but the chords: W held with Ctrl closes the tab past anything a page can do.
//
// Pure: no DOM. Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum,
// no namespace, no constructor parameter properties.

import { DEFAULT_BINDINGS, type Action } from '../core/input.ts';

/** The world editor's own actions, every one in `DEV_ONLY_ACTIONS`. */
export const EDITOR_ACTIONS: readonly Action[] = ['editor', 'editorUp', 'editorDown', 'editorPoint', 'editorSearch', 'editorBody', 'editorHold'];

/**
 * What the editor reads of the game's own actions in their own sense, kept unmuted: the move keys fly, `walk` (Shift)
 * is fast, `freeLook` (Alt) is slow (read before the mutes, which take it), the speed keys step the speed, R and F hold
 * the hand, O, Delete and L, and the panels a developer still wants (the map, the backpack, the waypoints, the journal,
 * the group, the debug menu) and the day's fast-forward, useful for judging light.
 */
export const EDITOR_READS: readonly Action[] = ['forward', 'back', 'left', 'right', 'walk', 'freeLook', 'noclipFaster', 'noclipSlower', 'placeTurn', 'placeLift', 'takeProp', 'putAway', 'placeLayer', 'attack', 'map', 'inventory', 'waypoints', 'journal', 'group', 'debugMenu', 'fastForward'];

/**
 * What the editor mutes while it is on, for the whole frame after its block has read what it borrows (research5 §5.3,
 * and noclip's down): everything that fights, mounts, jumps, crouches, rolls, opens the ship's menu or the spawner,
 * swings the grapple, plays an emote or a slot, turns the torch or noclip, the wings, a race and a repair. 43 actions.
 * `attack` and `freeLook` are among them although the editor reads both (the click, slow flight): it reads them first.
 */
export const EDITOR_MUTES: readonly Action[] = [
  'jump',
  'crouch',
  'prone',
  'kneel',
  'attack',
  'altAttack',
  'altFire',
  'block',
  'saberThrow',
  'saberToggle',
  'saberStyle',
  'mount',
  'ship',
  'switchClass',
  'help',
  'spawner',
  'freeLook',
  'target',
  'noclip',
  'noclipDown',
  'flashlight',
  'grappleFire',
  'reelIn',
  'reelOut',
  'grappleBoost',
  'grappleHaul',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'slot5',
  'slot6',
  'emoteWheel',
  'emote1',
  'emote2',
  'emote3',
  'emote4',
  'brake',
  'rollLeft',
  'rollRight',
  'wings',
  'raceMode',
  'repair',
];

/** `EDITOR_MUTES` less the attack: what is muted while the old Props or Housing tab's hand holds something, whose click puts it down. */
const MUTES_OLD_HAND: readonly Action[] = EDITOR_MUTES.filter((a) => a !== 'attack');

/**
 * What the editor's key block mutes for the rest of the frame: `EDITOR_MUTES`, and while the old tabs' own hand holds
 * something (`oldHand`) the same less the attack, whose click is that hand's to put the thing down with (the old hand's
 * own block mutes the fight once it has read the click, as it does with no editor on). The editor's own click is read
 * only with the old hand empty.
 */
export function editorMutes(oldHand: boolean): readonly Action[] {
  return oldHand ? MUTES_OLD_HAND : EDITOR_MUTES;
}

/** Every action there is: what a held Ctrl mutes for the frame. */
export const ALL_ACTIONS: readonly Action[] = Object.keys(DEFAULT_BINDINGS) as Action[];

/** The raw codes Ctrl is held on. */
export const CTRL_CODES: readonly string[] = ['ControlLeft', 'ControlRight'];

/**
 * The Ctrl rule: while Ctrl is held every action is muted for the frame and only the editor's own chords are read (W2),
 * so D does not strafe the camera, X does not descend, V does not snap and Y does not open the Waypoints tab. Answers
 * the list to mute (empty with Ctrl up).
 */
export function ctrlRule(ctrlHeld: boolean): readonly Action[] {
  return ctrlHeld ? ALL_ACTIONS : NONE;
}
const NONE: readonly Action[] = [];

/**
 * The Shift rule (the owner's own two keys must not change sense under a key held to fly): Shift with R tips and rolls
 * only while no move key is held; with one held Shift is the fast flight and R turns. Answers whether this frame's
 * Shift+R is a tip. The next wave's (W2, the hand's turn): nothing of this wave reads it yet, and its test says so.
 */
export function shiftTips(shift: boolean, moving: boolean): boolean {
  return shift && !moving;
}

/** Whether a code is one of the editor's own defaults, for the key sheet and the test. */
export function editorDefaultCodes(): string[] {
  const out: string[] = [];
  for (const a of EDITOR_ACTIONS) for (const c of DEFAULT_BINDINGS[a]) out.push(c);
  return out;
}
