// The row under the world while a building or a prop is being placed: what is in hand, which way it
// faces, how far it has been lifted, whether it may stand there, and the keys that move it.
//
// It is the only thing on the screen during a placement, because everything else about placing is
// the ghost itself: the outline on the ground says where, its colour says whether, and this says
// why not in words and names the keys.
//
// **The keys are the way in and the buttons are the second way.** While the game holds the pointer
// lock there is no cursor to click a button with, so a thing is turned by holding the turn key and
// moving the mouse and raised by holding the height key, and the line under the verdict says so in the
// keys that are bound now. The two buttons, **⟲ Turn** and **↕ Height**, each carry their key's cap and
// do the same for a pointer that is free (the lock lost to another window, or refused after an
// Escape): pressed and dragged up and down they turn or raise it by the pointer's own movement, which
// needs no lock, and a plain click steps it one notch of the grid (a right click the other way).
//
// A prop picked back up out of the world has a third way out beside putting it down and Escape:
// **Put away**, which throws it away for good (the Props tab is a catalogue, so there is nothing to
// hand back), where Escape puts it back exactly where it stood. The button is there only while what
// is in hand came out of the world, and carries the cap of the pick-up key, which does the same.
//
// It builds its own element and says what was pressed. It knows nothing about deeds, worlds or
// ghosts, so a test can drive it with no game at all. Every colour on it is one of the eighteen.

import { PLACE_HOLD_TUNE, type HoldKind } from '../world/placeHold.ts';

const PLACING_BAR_CSS = `
#placing-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 96px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0 18px; pointer-events: none; }
#placing-bar[hidden] { display: none; }
#placing-bar .row { display: flex; align-items: center; gap: 8px; pointer-events: auto; background: color-mix(in srgb, var(--plate) 70%, transparent); border: 1px solid var(--rule); border-radius: 4px; padding: 6px 10px; }
#placing-bar .what { font-size: 12px; letter-spacing: 0.04em; color: var(--ink); }
#placing-bar .why { font-size: 11px; letter-spacing: 0.03em; color: var(--muted); min-height: 1.2em; text-align: center; pointer-events: none; }
#placing-bar .why.bad { color: var(--bad); }
#placing-bar .why.good { color: var(--good); }
#placing-bar .why.note { color: var(--accent); }
#placing-bar .hint { font-size: 10px; letter-spacing: 0.04em; color: var(--muted); text-align: center; pointer-events: none; }
#placing-bar .lift, #placing-bar .turn { font-size: 11px; letter-spacing: 0.04em; color: var(--accent); min-width: 4.2em; text-align: center; }
#placing-bar button { font: inherit; font-size: 11px; letter-spacing: 0.05em; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 4px 9px; cursor: pointer; }
#placing-bar button:hover { color: var(--ink); border-color: var(--edge); }
#placing-bar button.hold { cursor: ns-resize; touch-action: none; }
#placing-bar button .cap { color: var(--ink); opacity: 0.75; }
#placing-bar button.go { color: var(--good); border-color: color-mix(in srgb, var(--good) 60%, transparent); }
#placing-bar button.go[disabled] { color: var(--muted); border-color: var(--rule); }
#placing-bar button.away { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 60%, transparent); }
#placing-bar button[disabled] { opacity: 0.45; cursor: default; }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = PLACING_BAR_CSS;
  document.head.appendChild(style);
}

/** What a key with nothing bound to it is called on the bar: the way to bind one. */
export const NO_KEY = 'no key: Esc → Controls';

/**
 * What the keys are called just now: the turn, the height and the key that gives a thing up. The bar
 * spells them; it never decides them. A key with nothing bound reads `NO_KEY`.
 */
export interface PlacingKeys {
  turn: string;
  lift: string;
  del: string;
}

/**
 * What the bar says, as one record the game keeps and writes into every frame: nothing in it is made
 * for a frame, and the bar turns the numbers into words only when the rounded value it shows changes.
 */
export interface PlacingView {
  name: string;
  ok: boolean;
  why: string | null;
  /** Something worth knowing about an allowed spot (a door over a step or a jump); never a refusal. */
  note: string | null;
  keys: PlacingKeys;
  /** Which way it faces, degrees: a building's turn, a prop's spin about up. */
  turn: number;
  /** How far a prop's own up stands off the world's, degrees; 0 for a building, which only spins. */
  tipped: number;
  /** How far it has been lifted or dropped, metres. */
  lift: number;
  /** The cap of the key that puts a picked-up prop away, or null when what is in hand did not come out of the world. */
  away: string | null;
  /** Whether the game holds the pointer, so a held key can move it; free, the hint says how to take it back. */
  locked: boolean;
  /** What a held key is doing to it now, or null. */
  holding: HoldKind | null;
  kind: 'house' | 'prop';
}

/** A view with nothing in it, for the game to keep and write into. */
export function placingView(): PlacingView {
  return { name: '', ok: false, why: null, note: null, keys: { turn: '', lift: '', del: '' }, turn: 0, tipped: 0, lift: 0, away: null, locked: true, holding: null, kind: 'house' };
}

/**
 * The line under the verdict: how to move it, in the keys bound now. While a key is held it says what
 * the mouse does; with the pointer free it says how to take it back, since no key can move anything
 * then (the game counts the mouse only while it holds the pointer).
 */
export function placingHint(v: PlacingView): string {
  if (!v.locked) return 'click the world to take the mouse back, or drag the ⟲ / ↕ buttons';
  const steps = `wheel: ${PLACE_HOLD_TUNE.gridTurn}° steps`;
  if (v.holding === 'turn') return v.kind === 'prop' ? `move the mouse to turn it · shift: tip and roll · ${steps}` : `move the mouse to turn it · ${steps}`;
  if (v.holding === 'tumble') return `up and down tip it, left and right roll it · ${steps}`;
  if (v.holding === 'lift') {
    const grid = v.kind === 'house' ? PLACE_HOLD_TUNE.gridLiftHouse : PLACE_HOLD_TUNE.gridLiftProp;
    return `move the mouse up or down · wheel: ${Math.round(grid * 100)} cm steps`;
  }
  return `hold ${v.keys.turn} ⟲ turn · hold ${v.keys.lift} ↕ height · wheel nearer / further · click put it down · ${letGoWords(v)}`;
}

/**
 * The end of the idle hint: how to let go of it. Escape gives up a deed or a prop taken fresh, and puts
 * one picked back up out of the world back where it stood; Delete gives up the first two and throws the
 * third away for good (the pick-up key does that too), so the two are never said as one for a thing
 * picked back up. A key with nothing bound is left out rather than spelled as the way to bind one.
 */
function letGoWords(v: PlacingView): string {
  const del = v.keys.del && v.keys.del !== NO_KEY ? v.keys.del : '';
  if (v.away === null) return del ? `Esc or ${del} give it up` : 'Esc give it up';
  const away = v.away && v.away !== NO_KEY && v.away !== del ? v.away : '';
  const keys = away && del ? `${away} or ${del}` : away || del;
  return keys ? `Esc put it back · ${keys} put it away` : 'Esc put it back';
}

export class PlacingBar {
  readonly root: HTMLElement;
  /**
   * One of the two buttons pressed (`which`, with whether shift was down) or let go (null). The game holds
   * the hold for as long as the button is down, as it does for a held key, and not only on the frames the
   * pointer moves: a slow drag has frames with no movement in them, and a hold started afresh on each of
   * those would round a slow hand's lift away every time.
   */
  onHold: (which: 'turn' | 'lift' | null, shift: boolean) => void = () => {};
  /** A drag on one of the two buttons with a free pointer: how far the pointer moved, as the mouse would. */
  onDrag: (which: 'turn' | 'lift', dx: number, dy: number, shift: boolean) => void = () => {};
  /** A plain click on one of the two buttons (+1), or a right click (-1): one notch of the grid. */
  onStep: (which: 'turn' | 'lift', dir: number) => void = () => {};
  onPlace: () => void = () => {};
  onCancel: () => void = () => {};
  /** A prop picked back up, thrown away rather than put back. */
  onPutAway: () => void = () => {};

  private readonly what: HTMLElement;
  private readonly why: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly lift: HTMLElement;
  private readonly turn: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly away: HTMLButtonElement;
  private readonly awayCap: HTMLElement;
  private readonly cancel: HTMLButtonElement;
  private readonly turnCap: HTMLElement;
  private readonly liftCap: HTMLElement;
  /**
   * What was last written, field by field and rounded as shown, so a frame that changes nothing writes
   * nothing and builds no string to find that out.
   */
  private readonly last = { open: false, name: '', ok: false, why: null as string | null, note: null as string | null, turnKey: '', liftKey: '', delKey: '', turn: Number.NaN, tipped: Number.NaN, lift: Number.NaN, away: null as string | null, locked: false, holding: null as HoldKind | null, kind: '' };
  /** How many times the page was written to, for `__debug.hud`'s own counting. */
  writes = 0;

  constructor(parent: HTMLElement) {
    installStyle();
    this.root = document.createElement('div');
    this.root.id = 'placing-bar';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="why"></div>
      <div class="hint"></div>
      <div class="row">
        <button class="hold hold-turn" title="hold and drag up or down to turn it; click for a notch, right click for one back">&#10226; Turn <span class="cap cap-turn"></span></button>
        <span class="turn"></span>
        <button class="hold hold-lift" title="hold and drag up or down to raise or lower it; click for a notch up, right click for one down">&#8597; Height <span class="cap cap-lift"></span></button>
        <span class="lift"></span>
        <span class="what"></span>
        <button class="go">Place</button>
        <button class="away" title="throw it away rather than put it back" hidden>Put away <span class="cap cap-away"></span></button>
        <button class="cancel">Cancel (Esc)</button>
      </div>`;
    parent.appendChild(this.root);
    this.what = this.root.querySelector('.what')!;
    this.why = this.root.querySelector('.why')!;
    this.hint = this.root.querySelector('.hint')!;
    this.lift = this.root.querySelector('.lift')!;
    this.turn = this.root.querySelector('.turn')!;
    this.go = this.root.querySelector('.go')!;
    this.away = this.root.querySelector('.away')!;
    this.awayCap = this.root.querySelector('.cap-away')!;
    this.cancel = this.root.querySelector('.cancel')!;
    this.turnCap = this.root.querySelector('.cap-turn')!;
    this.liftCap = this.root.querySelector('.cap-lift')!;
    this.wireHold(this.root.querySelector('.hold-turn')!, 'turn');
    this.wireHold(this.root.querySelector('.hold-lift')!, 'lift');
    this.go.addEventListener('click', () => this.onPlace());
    this.away.addEventListener('click', () => this.onPutAway());
    this.cancel.addEventListener('click', () => this.onCancel());
  }

  /**
   * One of the two press-and-drag buttons. The pointer is captured on the press, so a drag that leaves
   * the button keeps going, and its own `movementY` is what moves the thing -- which needs no pointer
   * lock, so this works exactly when the keys cannot. Movement is held back until it passes
   * `barClickPx`, so a click that wobbles a pixel is a click (a notch) and not a drag as well. The press
   * and the let-go are said too (`onHold`), so the hold lasts as long as the button is down.
   */
  private wireHold(btn: HTMLElement, which: 'turn' | 'lift'): void {
    let id = -1;
    let button = 0;
    let moved = 0;
    let heldX = 0;
    let heldY = 0;
    btn.addEventListener('pointerdown', (e) => {
      const ev = e as PointerEvent;
      id = ev.pointerId;
      button = ev.button;
      moved = 0;
      heldX = 0;
      heldY = 0;
      btn.setPointerCapture?.(ev.pointerId);
      ev.preventDefault();
      this.onHold(which, !!ev.shiftKey);
    });
    btn.addEventListener('pointermove', (e) => {
      const ev = e as PointerEvent;
      if (ev.pointerId !== id) return;
      const dx = ev.movementX || 0;
      const dy = ev.movementY || 0;
      if (!dx && !dy) return;
      const was = moved;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < PLACE_HOLD_TUNE.barClickPx) {
        heldX += dx;
        heldY += dy;
        return;
      }
      // The first movement past the threshold carries what was held back with it.
      if (was < PLACE_HOLD_TUNE.barClickPx) {
        this.onDrag(which, heldX + dx, heldY + dy, ev.shiftKey);
        return;
      }
      this.onDrag(which, dx, dy, ev.shiftKey);
    });
    const end = (e: Event) => {
      const ev = e as PointerEvent;
      if (ev.pointerId !== id) return;
      id = -1;
      if (e.type === 'pointerup' && moved < PLACE_HOLD_TUNE.barClickPx) this.onStep(which, button === 2 ? -1 : 1);
      this.onHold(null, false);
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('lostpointercapture', end);
    // A right click is a notch the other way, never the browser's own menu.
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /**
   * What the bar says now. Written only when something it shows has changed, because a placement moves
   * every frame the mouse does and the bar is on the page rather than on the overlay canvas: the turn
   * is compared to a tenth of a degree, the tip to a degree and the lift to the centimetre, which is
   * what each is shown to.
   *
   * `note` is shown in place of "it will stand there" beside an allowed spot, in the accent rather than
   * the green, because it is a warning and never a refusal. A refused spot shows only why.
   */
  show(v: PlacingView): void {
    const turn = Math.round(v.turn * 10);
    const tipped = Math.round(v.tipped);
    const lift = Math.round(v.lift * 100);
    const said = v.ok ? v.note : null;
    const l = this.last;
    if (
      l.open &&
      l.name === v.name &&
      l.ok === v.ok &&
      l.why === v.why &&
      l.note === said &&
      l.turnKey === v.keys.turn &&
      l.liftKey === v.keys.lift &&
      l.delKey === v.keys.del &&
      l.turn === turn &&
      l.tipped === tipped &&
      l.lift === lift &&
      l.away === v.away &&
      l.locked === v.locked &&
      l.holding === v.holding &&
      l.kind === v.kind
    ) {
      return;
    }
    l.open = true;
    l.name = v.name;
    l.ok = v.ok;
    l.why = v.why;
    l.note = said;
    l.turnKey = v.keys.turn;
    l.liftKey = v.keys.lift;
    l.delKey = v.keys.del;
    l.turn = turn;
    l.tipped = tipped;
    l.lift = lift;
    l.away = v.away;
    l.locked = v.locked;
    l.holding = v.holding;
    l.kind = v.kind;
    this.root.hidden = false;
    this.writes++;
    this.what.textContent = v.name;
    this.why.textContent = v.ok ? (said ?? (v.kind === 'prop' ? 'it will stand there' : 'the ground will take it')) : (v.why ?? 'not here');
    this.why.className = `why ${v.ok ? (said ? 'note' : 'good') : 'bad'}`;
    this.hint.textContent = placingHint(v);
    // Degrees to a tenth, and a prop's tip beside its spin once its up is off the world's.
    this.turn.textContent = `${(turn / 10).toFixed(1)}°${v.kind === 'prop' && tipped ? ` · tipped ${tipped}°` : ''}`;
    this.lift.textContent = lift === 0 ? 'on the ground' : `${lift > 0 ? '+' : ''}${(lift / 100).toFixed(2)} m`;
    this.turnCap.textContent = v.keys.turn;
    this.liftCap.textContent = v.keys.lift;
    this.go.disabled = !v.ok;
    this.away.hidden = v.away === null;
    this.awayCap.textContent = v.away ?? '';
    this.cancel.textContent = v.away === null ? 'Cancel (Esc)' : 'Put back (Esc)';
  }

  hide(): void {
    this.root.hidden = true;
    this.last.open = false;
  }
}
