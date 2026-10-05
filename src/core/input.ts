/** Everything the player can do with a key or a mouse button. */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'prone'
  | 'kneel'
  | 'walk'
  | 'attack'
  | 'altAttack'
  | 'altFire'
  | 'block'
  | 'saberThrow'
  | 'saberToggle'
  | 'saberStyle'
  | 'mount'
  | 'ship'
  | 'switchClass'
  | 'map'
  | 'help'
  | 'inventory'
  | 'spawner'
  | 'freeLook'
  | 'target'
  | 'noclip'
  | 'noclipFaster'
  | 'noclipSlower'
  | 'flashlight'
  | 'fastForward'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'slot5'
  | 'slot6'
  | 'emoteWheel'
  | 'emote1'
  | 'emote2'
  | 'emote3'
  | 'emote4'
  | 'brake'
  | 'rollLeft'
  | 'rollRight'
  // A ship whose wings open: the pilot opens and closes them.
  | 'wings'
  // A building in hand: turning it and nudging it up or down. They have keys of their own rather
  // than borrowing the strafe keys, so that the player can walk while they place.
  | 'placeLeft'
  | 'placeRight'
  | 'placeUp'
  | 'placeDown'
  // A prop of yours standing near: pick it back up.
  | 'takeProp'
  // A prop in hand that was picked back up: throw it away rather than put it back.
  | 'putAway'
  // The debug menu: every `__debug` helper, run from a window.
  | 'debugMenu'
  // The map open on its Waypoints tab: every waypoint the character keeps, to mark, track, rename, colour and take away.
  | 'waypoints'
  // The journal: the jobs, what the character witnessed, the documents to read and the ISB's file.
  | 'journal'
  // The map open on its Group tab: who is with you, and the asking. Only while a server holds a group.
  | 'group';

/**
 * Default bindings, as KeyboardEvent codes and `Mouse<button>`. Crouch has X beside Ctrl
 * because on a Mac Ctrl with a click is a right click, which breaks the crouched attacks.
 */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyX'],
  prone: ['KeyZ'],
  kneel: ['KeyV'],
  walk: ['ShiftLeft', 'ShiftRight'],
  attack: ['Mouse0'],
  altAttack: ['Mouse2'],
  // A gun's other trigger (the charge, the rapid trigger, the mines, the homing rocket); Q on the ground, the brake adrift.
  altFire: ['Mouse1', 'KeyQ'],
  block: ['Mouse2'],
  saberThrow: ['KeyR'],
  saberToggle: ['KeyL'],
  saberStyle: ['KeyK'],
  mount: ['KeyE'],
  ship: ['KeyP'],
  switchClass: ['KeyC'],
  map: ['KeyM'],
  help: ['KeyH'],
  inventory: ['KeyI'],
  spawner: ['KeyB'],
  freeLook: ['AltLeft', 'AltRight'],
  target: ['Tab'],
  noclip: ['KeyN'],
  noclipFaster: ['Equal', 'NumpadAdd'],
  noclipSlower: ['Minus', 'NumpadSubtract'],
  flashlight: ['KeyF'],
  fastForward: ['KeyT'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  slot5: ['Digit5'],
  slot6: ['Digit6'],
  emoteWheel: ['KeyG'],
  emote1: ['ArrowUp'],
  emote2: ['ArrowRight'],
  emote3: ['ArrowDown'],
  emote4: ['ArrowLeft'],
  // Adrift in space on foot: the brake kills the drift, and the posture keys roll the body instead (there is no ground to lie on).
  brake: ['KeyQ'],
  rollLeft: ['KeyZ'],
  rollRight: ['KeyV'],
  wings: ['KeyU'],
  // A building in hand. Q and E are the other trigger and the use key, and R and F the saber throw
  // and the torch: none of the four can be reached with a deed out, so they are borrowed rather
  // than spent, and all four can be rebound from the Controls page like anything else.
  placeLeft: ['KeyQ'],
  placeRight: ['KeyE'],
  placeUp: ['KeyR'],
  placeDown: ['KeyF'],
  // Picking one of your own props back up. It is a key of its own rather than the use key, which is
  // already the doorway, the lift, the shuttle and the mount and would have to lose to all four. It is O,
  // which the ultra cruise reads as a key of its own at a ship's controls only, where the pick-up does
  // not answer: the two never answer one press. (It was J until the journal took J.)
  takeProp: ['KeyO'],
  // Throwing a prop in hand away. The pick-up key does the same while one is in hand; Delete is the
  // key anybody reaches for to get rid of something, and nothing else in the game uses it.
  putAway: ['Delete'],
  // The debug menu, on the key a console has always had in a game (Jedi Academy's own is there): the
  // one left of 1, which nothing else in this game uses. It types a character into a box, so inside
  // the menu's own boxes it is Escape that shuts it.
  debugMenu: ['Backquote'],
  // The map open on its Waypoints tab, on Y, as the story's design has it; pressed with that tab showing it
  // shuts the map.
  waypoints: ['KeyY'],
  // The journal, on J, where the owner asked for it. The engine cut reads J as a key of its own, and only
  // at a ship's controls, where the journal does not open: the two never answer one press.
  journal: ['KeyJ'],
  // The map open on its Group tab, on the full stop, which the group's panel held as a raw key of its own
  // before the roster became a tab of the map; now it is a binding like any other and shows on the
  // Controls page. With no server holding a group it does nothing at all.
  group: ['Period'],
};
const STORAGE_KEY = 'swg3js.bindings';

/**
 * What a player chose, out of what was saved or asked for: every entry that is an action with a list of key
 * names (an empty list included, a key taken off an action on purpose) and that is not simply that action's
 * own default. Anything else is ignored, entry by entry. A choice that is the default is no choice at all:
 * that action goes on following the defaults, so a later move of the defaults reaches it.
 */
export function chosenBindings(saved: unknown): Partial<Record<Action, string[]>> {
  const out: Partial<Record<Action, string[]>> = {};
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out;
  for (const [a, codes] of Object.entries(saved as Record<string, unknown>)) {
    if (!Object.hasOwn(DEFAULT_BINDINGS, a) || !Array.isArray(codes) || !codes.every((c) => typeof c === 'string' && c.length > 0)) continue;
    const list = codes.map(String);
    if (list.join() === DEFAULT_BINDINGS[a as Action].join()) continue;
    out[a as Action] = list;
  }
  return out;
}

/**
 * The bindings a player's choices make, laid over the defaults. What was chosen stands, an empty list
 * included. An action nobody chose follows the defaults, except that it loses any of its default keys that
 * a chosen binding of another action holds and that action's own default does not: a key somebody chose
 * always wins over a default that later moved onto it, so one press never answers twice. Such an action may
 * be left with no key at all, and the Controls page shows it blank; it is not a choice and is never kept as
 * one, so it has its key back the moment nobody's choice holds it. Keys two defaults share on purpose (the
 * placing keys borrow Q, E, R and F, and right mouse is both the other attack and the block) are left as
 * they are, because the chosen action held that key by default too.
 *
 * `saved` is read through `chosenBindings`, so anything in it that is not an action with a list of key
 * names is ignored.
 */
export function loadedBindings(saved: unknown): Record<Action, string[]> {
  const chosen = chosenBindings(saved);
  const out = {} as Record<Action, string[]>;
  for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) out[a] = [...(chosen[a] ?? DEFAULT_BINDINGS[a])];
  // The keys somebody chose that their action did not have by default.
  const taken = new Set<string>();
  for (const a of Object.keys(chosen) as Action[]) for (const code of out[a]) if (!DEFAULT_BINDINGS[a].includes(code)) taken.add(code);
  if (taken.size) {
    for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) {
      if (Object.hasOwn(chosen, a)) continue;
      out[a] = out[a].filter((code) => !taken.has(code));
    }
  }
  return out;
}

/**
 * What is kept in storage: the player's own choices and nothing else -- never an action the rule in
 * `loadedBindings` emptied, which written down would read back as a choice of no key and never have its
 * default again. Handed the whole table of bindings it keeps every action that is not on its default,
 * which is only right where no rule has emptied anything.
 */
export function bindingsToKeep(chosen: Readonly<Partial<Record<Action, readonly string[]>>>): Partial<Record<Action, string[]>> {
  const out: Partial<Record<Action, string[]>> = {};
  for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) {
    const codes = chosen[a];
    if (codes && codes.join() !== DEFAULT_BINDINGS[a].join()) out[a] = [...codes];
  }
  return out;
}

/**
 * Whether taking `code` for `action` must take it off `other` as well. Not when both have it by default:
 * those two share it on purpose and are never pressed in the same place (the alt attack and the block on
 * right mouse, the placing keys on Q, E, R and F), so a key put back on its own default stays shared with
 * the other default that has it.
 */
export function takesKeyFrom(action: Action, other: Action, code: string): boolean {
  if (other === action) return false;
  return !(DEFAULT_BINDINGS[action].includes(code) && DEFAULT_BINDINGS[other].includes(code));
}

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** Which codes each action listens to: the defaults with the player's choices over them (`loadedBindings`). */
  readonly bindings: Record<Action, string[]> = { ...DEFAULT_BINDINGS };
  /**
   * What the player chose, read from local storage and changed with `bind`: the only thing kept there. The
   * bindings are worked out from it again on every change, by the very rule a load uses, so what is pressed
   * now is what is pressed after a reload.
   */
  private chosen: Partial<Record<Action, string[]>> = {};
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** Set to true by the UI while an overlay wants the keyboard. */
  captured = false;
  /**
   * The canvas the pointer is locked to. Written out rather than as a parameter property, so that a node
   * test can import this file: node strips the types and nothing else.
   */
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.loadBindings();
    window.addEventListener('keydown', (e) => {
      // Typing a name into a field: the field keeps every key, the game sees none of them.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (['Space', 'Tab', 'KeyM', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    // The wheel zooms the view, unless a panel has the mouse: scrolling a menu is not a zoom.
    document.addEventListener('wheel', (e) => { if (!this.captured) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const code = `Mouse${e.button}`;
      this.down.add(code);
      this.pressed.add(code);
    });
    document.addEventListener('mouseup', (e) => this.down.delete(`Mouse${e.button}`));
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.down.clear();
    });
  }

  private wantLock = false;
  private lockRetry = 0;

  /**
   * Take the mouse. A browser refuses a lock asked for right after Escape released one (and
   * while the page is not the active document): the promise rejects rather than throwing, and
   * the ask is repeated a moment later while the game still wants it.
   */
  requestLock(): void {
    this.wantLock = true;
    if (this.locked) return;
    window.clearTimeout(this.lockRetry);
    let p: unknown;
    try {
      p = this.canvas.requestPointerLock?.();
    } catch {
      p = undefined;
    }
    (p as Promise<void> | undefined)?.catch(() => {
      this.lockRetry = window.setTimeout(() => {
        if (this.wantLock && !this.locked) this.requestLock();
      }, 1200);
    });
  }

  releaseLock(): void {
    this.wantLock = false;
    window.clearTimeout(this.lockRetry);
    if (this.locked) document.exitPointerLock();
  }

  /** Hold or release a key from script, for headless tests that cannot drive real key events at speed. */
  force(code: string, held: boolean): void {
    if (held) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else this.down.delete(code);
  }

  isDown(code: string): boolean {
    return !this.captured && this.down.has(code);
  }

  justPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Whether any key bound to the action is held. */
  held(action: Action): boolean {
    if (this.captured) return false;
    for (const code of this.bindings[action]) if (this.down.has(code)) return true;
    return false;
  }

  /** Whether any key bound to the action was pressed this frame. */
  pressedAction(action: Action): boolean {
    for (const code of this.bindings[action]) if (this.pressed.has(code)) return true;
    return false;
  }

  /** Take this frame's press of a key, so nothing later in the frame sees it (a dance's flourish keys over the kit's slots). */
  consumeKey(code: string): boolean {
    return this.pressed.delete(code);
  }

  /**
   * Take every press of this frame, so nothing later in it sees any: a conversation holds the player's
   * keys while the world goes on (`captured` already stops a held key reading as held). The mouse's
   * movement and the wheel are the camera's and are left alone.
   */
  dropPresses(): void {
    this.pressed.clear();
  }

  /**
   * Rebind an action to one or more codes (KeyboardEvent.code, or Mouse0, Mouse1, Mouse2). An empty list
   * restores the default, unless `empty: 'none'` is asked for, which leaves the action with no key at all
   * and keeps it that way: the Controls page taking a key off an action, which would otherwise hand the
   * action straight back the very key it was taking.
   */
  bind(action: Action, codes: string[], opts?: { empty?: 'default' | 'none' }): void {
    if (!Object.hasOwn(DEFAULT_BINDINGS, action)) throw new Error(`no such action: ${action}; actions are ${Object.keys(DEFAULT_BINDINGS).join(', ')}`);
    const want = codes.length || opts?.empty === 'none' ? [...new Set(codes)] : [...DEFAULT_BINDINGS[action]];
    const next = { ...this.chosen, [action]: want };
    this.chosen = chosenBindings(next);
    this.settle();
  }

  /**
   * The Controls page's rebind: `action` takes `codes`, and `code`, the key just pressed for it (null for
   * Backspace), moves here from every other action that holds it rather than doing two things. An action
   * the player chose keys for is left with what it has left, nothing included, and keeps that. An action on
   * its defaults is left alone: the rule every load uses takes the key off it while this choice holds it and
   * gives it back the moment nothing does, so the page never writes an emptied default down as a choice. A
   * key two defaults share on purpose stays shared (`takesKeyFrom`). An empty `codes` takes the action's
   * keys off for good, which is what Backspace on its last key means.
   */
  assignKey(action: Action, codes: string[], code: string | null): void {
    if (!Object.hasOwn(DEFAULT_BINDINGS, action)) throw new Error(`no such action: ${action}`);
    const next: Partial<Record<Action, string[]>> = { ...this.chosen };
    if (code) {
      for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) {
        const had = next[a];
        if (!had || !had.includes(code) || !takesKeyFrom(action, a, code)) continue;
        next[a] = had.filter((x) => x !== code);
      }
    }
    next[action] = [...new Set(codes)];
    this.chosen = chosenBindings(next);
    this.settle();
  }

  resetBindings(): void {
    this.chosen = {};
    this.settle();
  }

  /** The player's choices as they were kept, read once as the game starts. */
  private loadBindings(): void {
    try {
      this.chosen = chosenBindings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
    } catch {
      // Bad or missing storage: the defaults stand.
      this.chosen = {};
    }
    Object.assign(this.bindings, loadedBindings(this.chosen));
  }

  /** The bindings worked out again from the choices, by the load's own rule, and the choices kept. */
  private settle(): void {
    Object.assign(this.bindings, loadedBindings(this.chosen));
    try {
      const keep = bindingsToKeep(this.chosen);
      if (Object.keys(keep).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // No storage: the choices last this session.
    }
  }

  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
