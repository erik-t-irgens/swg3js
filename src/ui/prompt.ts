// The use prompt: at most four things you can do here, each a key-cap and two or three words, in one bar.
//
// The key on a cap is the key you have bound, looked up through the bindings and not written into the
// words, so a rebind shows on the bar without anything having to tell it. It notices a rebind by
// itself: the code behind each cap is remembered, and a cap is rewritten only when the binding under it
// has moved. There is no notification to subscribe to and nothing to forget to call.
//
// Which four are shown is `promptRules.ts`, which is pure and tested outside the browser. This file is
// only the writing, and it writes nothing it has already written: handed the same state twice it
// touches no element at all. It is meant to be filled a few times a second rather than every frame -
// the state behind it is what costs, not the words - but it is safe to call every frame, because
// nothing but a change reaches the DOM.
//
// It is also where the one rule the rules cannot keep is kept. They drop an action whose *binding* is
// already on the bar, which is all a module with no bindings in it can see; two different bindings the
// owner has put on one key look different there and would arrive as one cap with two meanings. Only
// this file knows what each binding resolved to, so the second of them is dropped here.
//
// Its look (the interface rewrite's second wave, item 8; `.hud-acts` in `hud.css`): one rounded see-through bar holding
// every action on offer side by side, the action bar's thin lines between them, the key in a soft cap. Nothing moves by a
// write per frame. The bar fades in and out by one class (`on`); each cell has two faces, so new words go into the face
// not showing and one class (`flip`) cross-fades the two; a cell with nothing to say is `none`, out of the row; and the
// bar's width eases to its row's own, told it by a `ResizeObserver` on the row, which runs after the browser has laid the
// row out and so measures nothing the browser has not already measured. Aboard and in vehicles it is quieter (`quiet`,
// `promptQuiet`); the lines' height and a blur behind it are the Interface page's switches (`setLook`).

import { keyLabel } from './hud.ts';
import { fillActions, newPromptActions, PROMPT, promptQuiet, type PromptAction, type PromptState } from './promptRules.ts';

/** A key code no keyboard can send, which is what a cap's remembered code starts at. */
const UNRESOLVED = ' ';

/** What the bar is doing, filled in place for the debug helper: never a new object. */
export interface PromptStats {
  /** Actions on the bar now. */
  shown: number;
  /** Every DOM write the bar has made since it was built; sample it a second apart for the rate. */
  writes: number;
  /** Times the words changed, and times a cap was rewritten because its binding had moved. */
  changed: number;
  rebinds: number;
  /** Whether the HUD stylesheet is in hand; false means the bar is being drawn unstyled. */
  styled: boolean;
  /** The bar up (faded in), and quieter (aboard or in a vehicle). */
  on: boolean;
  quiet: boolean;
  /** The bar's width as last told it, in CSS pixels; -1 before the row was ever measured (and always, outside a browser). */
  width: number;
}

/** One face of a cell: a cap and its words, and what each is showing, so nothing is written twice. */
interface Face {
  readonly cap: HTMLElement;
  readonly words: HTMLElement;
  capText: string;
  label: string;
}

/**
 * One cell: its two faces (`b` showing while it wears `flip`), the action it stands for, and what it says. `capText`
 * and `label` are what the cell says as the rules filled it, which `keyAt` and `labelAt` read; `live` is whether it is
 * on the bar now; `shown` whether it is in the row on the page (not `none`), which a bar fading out keeps as it was.
 */
interface Cell {
  readonly el: HTMLElement;
  readonly a: Face;
  readonly b: Face;
  flip: boolean;
  /** The binding (or the bare key) the cap stands for, and the key code it resolved to last. */
  action: string;
  code: string;
  resolved: string;
  capText: string;
  label: string;
  live: boolean;
  shown: boolean;
}

/** The smallest of `ResizeObserver`, as this file uses it: a page without one has a bar that keeps its own width. */
interface Sizer {
  observe(el: Element): void;
}

export class ActionBar {
  readonly root: HTMLElement;
  /** The row the cells stand in, at its own width; the bar's width eases to it. */
  private readonly row: HTMLElement;
  private readonly cells: Cell[] = [];
  /** The slots the rules fill: made once, here, and handed to the rules every time. */
  private readonly list: PromptAction[];
  /**
   * The two scratch arrays the one-key-one-cap rule needs, made once and written over every fill:
   * which filled slot each cell takes, and the key code each of them came to. Nothing is allocated.
   */
  private readonly keep: number[];
  private readonly seen: string[];
  private readonly stat: PromptStats = { shown: 0, writes: 0, changed: 0, rebinds: 0, styled: true, on: false, quiet: false, width: -1 };
  private bindings: Record<string, string[]> | null = null;
  /** The bar's classes as last written: up, quieter, the lines at full height, the blur. */
  private on = false;
  private quiet = false;
  private linesFull = false;
  private blur = false;
  /** True when the HUD stylesheet is not loaded, which is a fault worth reporting rather than papering over. */
  readonly styleless: boolean;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-acts';
    this.row = document.createElement('div');
    this.row.className = 'hud-acts-in';
    this.root.appendChild(this.row);
    parent.appendChild(this.root);
    this.styleless = !styled(this.root);
    this.stat.styled = !this.styleless;
    const size = Math.max(1, Math.round(PROMPT.slots));
    this.list = newPromptActions(size);
    this.keep = new Array<number>(size).fill(0);
    this.seen = new Array<string>(size).fill('');
    for (let i = 0; i < size; i++) {
      const el = document.createElement('div');
      el.className = 'hud-act none';
      const a = face('face a');
      const b = face('face b');
      el.appendChild(a.el);
      el.appendChild(b.el);
      this.row.appendChild(el);
      // `resolved` starts at a code no key can have, so the first cap a cell shows is always written.
      this.cells.push({ el, a: a.face, b: b.face, flip: false, action: '', code: '', resolved: UNRESOLVED, capText: '', label: '', live: false, shown: false });
    }
    // The bar's width follows its row's, told after the browser has laid the row out. Outside a browser there is no
    // observer, and the bar keeps the width its own content gives it.
    const RO = (globalThis as { ResizeObserver?: new (cb: () => void) => Sizer }).ResizeObserver;
    if (typeof RO === 'function') new RO(() => this.fit()).observe(this.row);
  }

  /** How many actions the bar can show: fixed when it was built. */
  get size(): number {
    return this.cells.length;
  }

  /**
   * The bindings the caps are read from. Handed over once, and kept by reference: the game edits that
   * object in place when a key is rebound, and the bar sees the new key on its next fill.
   */
  setBindings(bindings: Record<string, string[]> | null): void {
    this.bindings = bindings;
  }

  /**
   * The Interface page's two switches for this bar (item 8): the lines between actions at the bar's full height, as the
   * action bar's (`lines-full`), and the soft blur behind it (`blur`, off to begin with: blurring the world behind it
   * costs the graphics card a little every frame). One class each, written when it changes; not in a frame.
   */
  setLook(linesFull: boolean, blur: boolean): void {
    if (linesFull !== this.linesFull) {
      this.linesFull = linesFull;
      this.root.classList.toggle('lines-full', linesFull);
      this.stat.writes++;
    }
    if (blur !== this.blur) {
      this.blur = blur;
      this.root.classList.toggle('blur', blur);
      this.stat.writes++;
    }
  }

  /**
   * The bar for this state. Nothing is allocated: the rules fill the slots the bar already owns, the
   * codes go into the two arrays it already owns, and only a cell whose key or words have actually
   * moved is written. With nothing on offer the bar fades out with the words it had, so nothing jumps.
   */
  set(state: PromptState): void {
    const n = fillActions(state, this.list);
    // Which of the filled slots actually reach a cell. An action is dropped when an earlier one came
    // to the same key: the rules cannot see that, because two bindings on one key are two different
    // bindings to them. A code of nothing (a binding the owner has cleared, which shows as a dash) is
    // never a collision, or clearing one key would empty the whole bar.
    let k = 0;
    for (let i = 0; i < n && k < this.cells.length; i++) {
      const want = this.list[i];
      const code = want.action ? this.codeOf(want.action) : want.code;
      let twice = false;
      if (code) for (let j = 0; j < k; j++) if (this.seen[j] === code) twice = true;
      if (twice) continue;
      this.seen[k] = code;
      this.keep[k] = i;
      k++;
    }
    if (k === 0) {
      this.clear();
      return;
    }
    // Aboard and in vehicles the quieter bar: one class, eased by the stylesheet as the bar's own strength.
    const quiet = promptQuiet(state);
    if (quiet !== this.quiet) {
      this.quiet = quiet;
      this.root.classList.toggle('quiet', quiet);
      this.stat.writes++;
      this.stat.quiet = quiet;
    }
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (i >= k) {
        cell.live = false;
        this.hide(cell);
        continue;
      }
      const want = this.list[this.keep[i]];
      if (cell.action !== want.action || cell.code !== want.code) {
        cell.action = want.action;
        cell.code = want.code;
        // A new action starts with no resolved key, so the cap is worked out once here and then only
        // when the binding under it moves.
        cell.resolved = UNRESOLVED;
        this.stat.changed++;
      }
      this.resolve(cell, this.seen[i]);
      if (cell.label !== want.label) {
        cell.label = want.label;
        this.stat.changed++;
      }
      cell.live = true;
      this.present(cell);
    }
    this.stat.shown = k;
    // Up last, so the words a bar fading in shows are its new ones, written straight into the faces showing.
    if (!this.on) {
      this.on = true;
      this.root.classList.toggle('on', true);
      this.stat.writes++;
      this.stat.on = true;
    }
  }

  /**
   * Nothing to press: the world is being left, the game is not simulating, or nothing is on offer. The bar fades out
   * with the words it had (one class), and says nothing to `keyAt` or `labelAt` at once.
   */
  clear(): void {
    for (let i = 0; i < this.cells.length; i++) this.cells[i].live = false;
    this.stat.shown = 0;
    if (!this.on) return;
    this.on = false;
    this.root.classList.toggle('on', false);
    this.stat.writes++;
    this.stat.on = false;
  }

  /** What the bar is doing, in the object it always answers with. */
  debug(): PromptStats {
    return this.stat;
  }

  /** The words in a slot, for a test or the debug helper; empty past what is shown. */
  labelAt(i: number): string {
    const cell = this.cells[i];
    return cell && cell.live ? cell.label : '';
  }

  /** The key shown in a slot, as the cap spells it. */
  keyAt(i: number): string {
    const cell = this.cells[i];
    return cell && cell.live ? cell.capText : '';
  }

  // --- the writing ------------------------------------------------------------------------------------

  /**
   * The cap for a cell's action, given the code its binding came to on this fill. The name is worked
   * out only when that code has moved - which is how a rebind reaches the bar with nothing having to
   * tell it. A move on a cell that was already standing for this action is a rebind and is counted;
   * the first code a cell's action ever resolves to is not.
   */
  private resolve(cell: Cell, code: string): void {
    if (code === cell.resolved) return;
    const first = cell.resolved === UNRESOLVED;
    cell.resolved = code;
    if (!first) this.stat.rebinds++;
    cell.capText = keyLabel(code);
  }

  private codeOf(action: string): string {
    const b = this.bindings;
    if (!b) return '';
    const codes = b[action];
    return codes && codes.length ? codes[0] : '';
  }

  /**
   * A cell's words onto the page. The face showing already says them: nothing. The bar is up and the cell in its row: the
   * words go into the face not showing and the two cross-fade (`flip`), so a change never jumps. Otherwise nobody sees the
   * cell (the bar fading in, or the cell coming back into the row): straight into the face showing.
   */
  private present(cell: Cell): void {
    const showing = cell.flip ? cell.b : cell.a;
    if (cell.shown && showing.capText === cell.capText && showing.label === cell.label) return;
    if (this.on && cell.shown) {
      this.writeFace(cell.flip ? cell.a : cell.b, cell.capText, cell.label);
      cell.flip = !cell.flip;
      cell.el.classList.toggle('flip', cell.flip);
      this.stat.writes++;
      return;
    }
    this.writeFace(showing, cell.capText, cell.label);
    if (!cell.shown) {
      cell.shown = true;
      cell.el.classList.toggle('none', false);
      this.stat.writes++;
    }
  }

  /**
   * A cell out of the row (`none`): its face fades and it takes no room, and the bar's width eases without it. What it
   * stood for is left on it, so a cell that comes back with the same action and the same words writes only the class,
   * and a key that was rebound while the bar was down is seen to have moved and is counted as the rebind it is. (The
   * Controls page is inside the Escape menu, where the game is not simulating and the bar is down, so every rebind the
   * owner ever makes happens while the bar is down.)
   */
  private hide(cell: Cell): void {
    if (!cell.shown) return;
    cell.shown = false;
    cell.el.classList.toggle('none', true);
    this.stat.writes++;
  }

  /** One face's cap and words, each written only when it differs from what the face shows. */
  private writeFace(f: Face, cap: string, label: string): void {
    if (f.capText !== cap) {
      f.capText = cap;
      this.write(f.cap, cap);
    }
    if (f.label !== label) {
      f.label = label;
      this.write(f.words, label);
    }
  }

  /**
   * The bar's width, eased by the stylesheet to its row's: called by the observer after the browser has laid the row out
   * (so reading its width costs no layout of its own), and written only when it moved by a whole pixel.
   */
  private fit(): void {
    const w = Math.round(this.row.offsetWidth);
    if (!(w > 0) || w === this.stat.width) return;
    this.stat.width = w;
    this.root.style.setProperty('--hud-acts-w', `${w}px`);
    this.stat.writes++;
  }

  /**
   * Every write of words goes through here, so what the debug helper reports is what the DOM actually took.
   * What each element is showing is already remembered on the face, so nothing is read back off the
   * page: an object that knows what it put somewhere never needs to ask for it again.
   */
  private write(el: HTMLElement, value: string): void {
    el.textContent = value;
    this.stat.writes++;
  }
}

/** One face of a cell, built: a soft cap and the words beside it. */
function face(className: string): { el: HTMLElement; face: Face } {
  const el = document.createElement('span');
  el.className = className;
  const cap = document.createElement('span');
  cap.className = 'hud-cap';
  const words = document.createElement('span');
  words.className = 'label';
  el.appendChild(cap);
  el.appendChild(words);
  return { el, face: { cap, words, capText: '', label: '' } };
}

/**
 * Whether the HUD stylesheet has taken the bar in hand: it lays it out absolutely, and nothing else
 * does. There is no inline fallback behind this. `hud.css` is a static import of the game's own entry
 * point, so if it is missing the whole display is missing with it, and a second set of colours and a
 * second bottom edge kept here would only be a second home for values the design puts in one place -
 * and one that would drift from the stylesheet the first time the bar was moved. It is reported
 * instead, so a page that has somehow lost the stylesheet says so in `__debug.hud().actions.styled`.
 */
function styled(el: HTMLElement): boolean {
  try {
    const pos = getComputedStyle(el).position;
    return pos === 'absolute' || pos === 'fixed';
  } catch {
    return false;
  }
}
