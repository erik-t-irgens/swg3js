// The action bar: at most four things you can do here, each a key-cap and two or three words.
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

import { keyLabel } from './hud.ts';
import { fillActions, newPromptActions, PROMPT, type PromptAction, type PromptState } from './promptRules.ts';

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
}

/** One cell: a cap, a label, and what each of them is showing, so nothing is written twice. */
interface Cell {
  readonly el: HTMLElement;
  readonly cap: HTMLElement;
  readonly words: HTMLElement;
  /** The binding (or the bare key) the cap stands for, and the key code it resolved to last. */
  action: string;
  code: string;
  resolved: string;
  capText: string;
  label: string;
  live: boolean;
}

export class ActionBar {
  readonly root: HTMLElement;
  private readonly cells: Cell[] = [];
  /** The slots the rules fill: made once, here, and handed to the rules every time. */
  private readonly list: PromptAction[];
  /**
   * The two scratch arrays the one-key-one-cap rule needs, made once and written over every fill:
   * which filled slot each cell takes, and the key code each of them came to. Nothing is allocated.
   */
  private readonly keep: number[];
  private readonly seen: string[];
  private readonly stat: PromptStats = { shown: 0, writes: 0, changed: 0, rebinds: 0, styled: true };
  private bindings: Record<string, string[]> | null = null;
  /** True when the HUD stylesheet is not loaded, which is a fault worth reporting rather than papering over. */
  readonly styleless: boolean;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-acts';
    parent.appendChild(this.root);
    this.styleless = !styled(this.root);
    this.stat.styled = !this.styleless;
    const size = Math.max(1, Math.round(PROMPT.slots));
    this.list = newPromptActions(size);
    this.keep = new Array<number>(size).fill(0);
    this.seen = new Array<string>(size).fill('');
    for (let i = 0; i < size; i++) {
      const el = document.createElement('div');
      el.className = 'hud-act';
      el.hidden = true;
      const cap = document.createElement('span');
      cap.className = 'hud-cap';
      const words = document.createElement('span');
      words.className = 'label';
      el.appendChild(cap);
      el.appendChild(words);
      this.root.appendChild(el);
      // `resolved` starts at a code no key can have, so the first cap a cell shows is always written.
      this.cells.push({ el, cap, words, action: '', code: '', resolved: UNRESOLVED, capText: '', label: '', live: false });
    }
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
   * The bar for this state. Nothing is allocated: the rules fill the slots the bar already owns, the
   * codes go into the two arrays it already owns, and only a cell whose key or words have actually
   * moved is written.
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
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (i >= k) {
        this.retire(cell);
        continue;
      }
      const want = this.list[this.keep[i]];
      if (cell.action !== want.action || cell.code !== want.code) {
        cell.action = want.action;
        cell.code = want.code;
        // A new action starts with no resolved key, so the cap is written once here and then only
        // when the binding under it moves.
        cell.resolved = UNRESOLVED;
        this.stat.changed++;
      }
      this.writeCap(cell, this.seen[i]);
      if (cell.label !== want.label) {
        cell.label = want.label;
        this.write(cell.words, want.label);
        this.stat.changed++;
      }
      this.show(cell, true);
    }
    this.stat.shown = k;
  }

  /** Everything off at once: the world is being left, or the game is not simulating. */
  clear(): void {
    for (let i = 0; i < this.cells.length; i++) this.retire(this.cells[i]);
    this.stat.shown = 0;
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
   * out and written only when that code has moved - which is how a rebind reaches the bar with nothing
   * having to tell it. A move on a cell that was already standing for this action is a rebind and is
   * counted; the first code a cell's action ever resolves to is not.
   */
  private writeCap(cell: Cell, code: string): void {
    if (code === cell.resolved) return;
    const first = cell.resolved === UNRESOLVED;
    cell.resolved = code;
    if (!first) this.stat.rebinds++;
    const text = keyLabel(code);
    if (text === cell.capText) return;
    cell.capText = text;
    this.write(cell.cap, text);
  }

  private codeOf(action: string): string {
    const b = this.bindings;
    if (!b) return '';
    const codes = b[action];
    return codes && codes.length ? codes[0] : '';
  }

  /**
   * A cell off the bar. It is hidden and nothing else: what it was standing for is left on it, so a
   * cell that comes back with the same action and the same words writes nothing at all, and a key that
   * was rebound while the bar was down is seen to have moved and is counted as the rebind it is. (The
   * Controls page is inside the Escape menu, where the game is not simulating and the bar is down, so
   * every rebind the owner ever makes happens while the cells are hidden.) `labelAt` and `keyAt`
   * already answer nothing for a cell that is not live, so nothing else reads what is left behind.
   */
  private retire(cell: Cell): void {
    if (!cell.live) return;
    this.show(cell, false);
  }

  /** A cell goes off the screen by the attribute the stylesheet hides it with, not by being moved. */
  private show(cell: Cell, on: boolean): void {
    if (cell.live === on) return;
    cell.live = on;
    cell.el.hidden = !on;
    this.stat.writes++;
  }

  /**
   * Every write goes through here, so what the debug helper reports is what the DOM actually took.
   * What each element is showing is already remembered on the cell, so nothing is read back off the
   * page: an object that knows what it put somewhere never needs to ask for it again.
   */
  private write(el: HTMLElement, value: string): void {
    el.textContent = value;
    this.stat.writes++;
  }
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
