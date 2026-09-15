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
  | 'emoteWheel'
  | 'emote1'
  | 'emote2'
  | 'emote3'
  | 'emote4';

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
  emoteWheel: ['KeyG'],
  emote1: ['ArrowUp'],
  emote2: ['ArrowRight'],
  emote3: ['ArrowDown'],
  emote4: ['ArrowLeft'],
};
const STORAGE_KEY = 'swg3js.bindings';

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** Which codes each action listens to; changed with `bind`, kept in local storage. */
  readonly bindings: Record<Action, string[]> = { ...DEFAULT_BINDINGS };
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** Set to true by the UI while an overlay wants the keyboard. */
  captured = false;

  constructor(private canvas: HTMLCanvasElement) {
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
    document.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
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

  /** Rebind an action to one or more codes (KeyboardEvent.code, or Mouse0, Mouse1, Mouse2). An empty list restores the default. */
  bind(action: Action, codes: string[]): void {
    if (!(action in DEFAULT_BINDINGS)) throw new Error(`no such action: ${action}; actions are ${Object.keys(DEFAULT_BINDINGS).join(', ')}`);
    this.bindings[action] = codes.length ? [...codes] : [...DEFAULT_BINDINGS[action]];
    try {
      const changed = Object.fromEntries(Object.entries(this.bindings).filter(([a, c]) => c.join() !== DEFAULT_BINDINGS[a as Action].join()));
      if (Object.keys(changed).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // No storage: the binding lasts this session.
    }
  }

  resetBindings(): void {
    for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) this.bindings[a] = [...DEFAULT_BINDINGS[a]];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // No storage.
    }
  }

  private loadBindings(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<Action, string[]>>;
      for (const [a, codes] of Object.entries(saved)) if (a in DEFAULT_BINDINGS && Array.isArray(codes) && codes.length) this.bindings[a as Action] = codes.map(String);
    } catch {
      // Bad or missing storage: the defaults stand.
    }
  }

  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
