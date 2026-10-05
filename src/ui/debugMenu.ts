// The debug menu: every helper on `window.__debug` (and the window's own knobs, `__sharedDay` and
// the rest) in one window, with the README's words for each, an arguments box, and the answer shown
// folded under it with whatever the console said while it ran. The owner asked for all of the
// console's commands with a UI; the README's Debugging table is the one place a helper is described,
// so it is read here as data (`debugReadme.ts`) and never written a second time.
//
// The knobs are a group of their own at the top (`TUNING_HELPERS`), and a pinned call can be ticked to
// run again once the first world is up after a reload (`runAtStart`), which is the one way a knob's
// setting outlives the page: nothing a knob sets is saved by itself, and every call run that way is
// said on the message line, so nothing -- god mode, a server's day -- comes back silently.
//
// It keeps the display's habits. Nothing here runs in a frame, open or shut: the list is read off
// `__debug` when the window opens, the page is written when something is picked, typed or run, and
// the only timer is the one that writes the console lines and the clock while a call is being waited
// on, which stops when the call does. The README is fetched the first time the window opens, as a
// chunk of its own, so the game's own bundle does not carry it.
//
// It does not pause the game. Like the trade window it frees the mouse without joining
// `anyPanelOpen`, so the world goes on simulating and `__debug.perf()` measures with it open; a click
// on the world takes the pointer back and the window stands down. While one of its boxes has the
// keyboard the game's `Input` stands aside, as it does for every field, and nothing pressed inside the
// window is let through to the game's other listeners at all. That holds only while the keyboard stays
// in the window, and a clicked button is the thing with the keyboard: every redraw that could take the
// focused button out of the page (a Recent line run again, a line taken off, the list drawn again)
// goes through `keepFocus`, which puts the keyboard back on the window rather than leaving it on the
// page's body, where the game would take every key while the window was still up.

import { DEBUG_MENU_TUNE, OTHER_GROUP, bestMatch, callText, captureConsole, describeValue, evaluateArgs, filterGroups, groupHelpers, isThenable, keepsColumns, pushHistory, readStore, sameCall, setAtStart, startCalls, togglePin, toJsonText, writeStore, type CallRecord, type ConsoleLike, type ConsoleLine, type DebugStore, type HelperEntry, type ViewNode } from './debugModel.ts';
import { docKey, docsByHelper, firstArgs, inlineMarkdown, parseDebugTable, type DebugDoc, type DebugRow } from './debugReadme.ts';
import { keyLabel } from './hud.ts';
import { onBindingsChanged } from './hudPage.ts';

/** What the menu needs of the game. Everything is a function, so nothing here holds a stale copy. */
export interface DebugMenuDeps {
  /** The keys bound to the menu now (the Controls page's **Debug menu**). */
  keys: () => readonly string[];
  /** Whether the key may open it here: in the world, not travelling; over a panel or the map as well. */
  canOpen: () => boolean;
  /**
   * The menu wants the mouse, or gives it back. Giving it back is the game's to decide, not the
   * menu's: the menu may stand over a tab panel or the map (it is a tool for looking at them), and
   * shutting it there must leave the cursor with them rather than lock the pointer under them.
   */
  freeMouse: (free: boolean) => void;
  /** After Escape has shut it from a typed line: keep the game's keys standing aside this long. */
  holdKeys: (ms: number) => void;
}

/** One helper the list shows: where it hangs, and what the README says of it (undefined: nothing). */
interface Helper extends HelperEntry {
  doc: DebugDoc | undefined;
}

/** What the last call came to, for the console report. */
interface LastCall {
  call: string;
  ms: number;
  outcome: 'ok' | 'threw' | 'stopped' | 'refused';
}

const STORAGE_KEY = 'swg3js.debugMenu';
const STOPPED = Symbol('stopped');
const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (FIELD_TAGS.has(el.tagName) || el.isContentEditable);
}

function loadStore(): DebugStore {
  try {
    return readStore(localStorage.getItem(STORAGE_KEY));
  } catch {
    return readStore(null);
  }
}

function saveStore(s: DebugStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, writeStore(s));
  } catch {
    // No storage: the history and the pins last this session.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Every colour is one of the palette's eighteen names (`src/style.css`, `src/core/palette.ts`), as a
// name or as that name at an alpha, and never a value typed here: `hudPage.test.ts` reads this string
// out of the file and holds it to the same rule as the stylesheet. The window is sized in pixels and
// fills whatever it is dragged to (`src/ui/drag.ts` writes its width and height inline); the answer
// and the console lines take whatever height is left.
const DEBUG_MENU_CSS = `
.dbg-panel {
  position: absolute;
  right: 14px;
  top: 64px;
  width: min(880px, calc(100vw - 28px));
  height: min(640px, calc(100vh - 88px));
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--void) 90%, transparent);
  border: 1px solid var(--edge);
  border-radius: 8px;
  font: 500 12px/1.4 system-ui, sans-serif;
  color: var(--ink);
  pointer-events: auto;
  overflow: hidden;
}
.dbg-panel:focus { outline: none; }
.dbg-head { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--rule); flex: none; }
.dbg-head h3 { margin: 0; font-size: 14px; letter-spacing: 0.08em; color: var(--accent); }
.dbg-cap { font: 600 11px/1 ui-monospace, Menlo, Consolas, monospace; color: var(--muted); border: 1px solid var(--edge); border-radius: 3px; padding: 2px 5px; }
.dbg-find { flex: 1 1 auto; min-width: 80px; }
.dbg-panel input, .dbg-panel textarea {
  background: color-mix(in srgb, var(--void) 60%, transparent);
  color: var(--ink);
  border: 1px solid var(--edge);
  border-radius: 4px;
  padding: 4px 6px;
  font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace;
  box-sizing: border-box;
}
.dbg-panel input:focus, .dbg-panel textarea:focus { outline: none; border-color: var(--accent); }
.dbg-panel button {
  background: var(--plate);
  color: var(--ink);
  border: 1px solid var(--edge);
  border-radius: 3px;
  padding: 3px 8px;
  font: inherit;
  cursor: pointer;
}
.dbg-panel button:hover { border-color: var(--accent); }
.dbg-panel button:disabled { color: var(--muted); cursor: default; border-color: var(--rule); }
.dbg-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(160px, 28%) minmax(0, 1fr); }
.dbg-side { overflow-y: auto; border-right: 1px solid var(--rule); padding: 6px 4px 10px 8px; min-height: 0; }
.dbg-side h4 { margin: 8px 0 3px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--muted); text-transform: uppercase; }
.dbg-side h4:first-child { margin-top: 2px; }
.dbg-group > summary { cursor: pointer; list-style: none; margin: 6px 0 2px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--muted); text-transform: uppercase; }
.dbg-group > summary::-webkit-details-marker { display: none; }
.dbg-group > summary::before { content: '▸ '; }
.dbg-group[open] > summary::before { content: '▾ '; }
.dbg-group > summary span { font-weight: 400; }
.dbg-panel button.dbg-item {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  padding: 1px 6px;
  font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dbg-panel button.dbg-item:hover { border-color: var(--rule); }
.dbg-panel button.dbg-item.on { background: color-mix(in srgb, var(--pool) 35%, transparent); border-color: var(--edge); }
.dbg-panel button.dbg-item.nodoc { color: var(--muted); font-style: italic; }
.dbg-saved { display: flex; gap: 2px; align-items: stretch; }
.dbg-saved .dbg-item { flex: 1 1 auto; min-width: 0; }
.dbg-panel button.dbg-x { flex: none; background: transparent; border-color: transparent; color: var(--muted); padding: 0 5px; }
.dbg-panel button.dbg-x:hover { color: var(--bad); border-color: transparent; }
.dbg-panel button.dbg-start { flex: none; background: transparent; border-color: transparent; color: var(--muted); padding: 0 4px; }
.dbg-panel button.dbg-start:hover { color: var(--accent); border-color: transparent; }
.dbg-panel button.dbg-start.on { color: var(--good); }
.dbg-none { color: var(--muted); font-size: 11px; margin: 2px 6px; }
.dbg-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 0; padding: 8px 10px; overflow: hidden; }
.dbg-title { display: flex; align-items: baseline; gap: 8px; flex: none; }
.dbg-title b { font: 600 14px/1.3 ui-monospace, Menlo, Consolas, monospace; color: var(--accent); }
.dbg-title span { color: var(--muted); font-size: 11px; }
.dbg-doc { flex: 0 1 auto; max-height: 32%; min-height: 0; overflow-y: auto; padding-right: 4px; }
.dbg-doc p { margin: 0 0 6px; }
.dbg-doc p + p { border-top: 1px solid var(--rule); padding-top: 6px; }
.dbg-doc .dbg-usage { color: var(--muted); font-size: 11px; }
.dbg-doc code, .dbg-doc .dbg-usage code { font: 11px/1.4 ui-monospace, Menlo, Consolas, monospace; color: var(--shield); background: color-mix(in srgb, var(--plate) 60%, transparent); border-radius: 3px; padding: 0 3px; }
.dbg-ex { display: flex; flex-wrap: wrap; gap: 4px; flex: none; max-height: 5.2em; overflow-y: auto; }
.dbg-panel button.dbg-chip { font: 11px/1.35 ui-monospace, Menlo, Consolas, monospace; padding: 1px 6px; color: var(--shield); background: color-mix(in srgb, var(--plate) 60%, transparent); }
.dbg-callrow { display: flex; align-items: flex-start; gap: 5px; flex: none; }
.dbg-callrow .dbg-fn { font: 600 12px/26px ui-monospace, Menlo, Consolas, monospace; color: var(--accent); white-space: nowrap; }
.dbg-callrow .dbg-paren { font: 12px/26px ui-monospace, Menlo, Consolas, monospace; color: var(--muted); }
.dbg-args { flex: 1 1 auto; min-width: 60px; min-height: 26px; height: 26px; max-height: 160px; resize: vertical; }
.dbg-panel button.dbg-run { color: var(--accent); border-color: var(--accent); }
.dbg-panel button.dbg-pin.on { color: var(--component); border-color: var(--component); }
.dbg-status { flex: none; color: var(--muted); font-size: 11px; min-height: 1.4em; white-space: pre-wrap; }
.dbg-status.ok { color: var(--good); }
.dbg-status.bad { color: var(--bad); }
.dbg-status.warn { color: var(--warn); }
.dbg-out, .dbg-lines {
  font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace;
  background: color-mix(in srgb, var(--void) 55%, transparent);
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 6px 8px;
  overflow: auto;
  min-height: 0;
}
.dbg-out { flex: 3 1 60px; }
.dbg-lines { flex: 1 1 40px; max-height: 38%; }
.dbg-lines-head { flex: none; font-size: 11px; color: var(--muted); }
.dbg-out pre, .dbg-lines pre { margin: 0; font: inherit; white-space: pre-wrap; word-break: break-word; }
.dbg-row { white-space: pre-wrap; word-break: break-word; padding-left: 14px; }
.dbg-br > summary { cursor: pointer; list-style: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dbg-br > summary::-webkit-details-marker { display: none; }
.dbg-br > summary::before { content: '▸ '; color: var(--muted); }
.dbg-br[open] > summary::before { content: '▾ '; }
.dbg-br[open] > summary .dbg-p { display: none; }
.dbg-kids { padding-left: 14px; border-left: 1px solid var(--rule); margin-left: 4px; }
.dbg-k { color: var(--muted); }
.dbg-l { color: var(--accent); }
.dbg-p { color: var(--muted); }
.t-string { color: var(--good); }
.t-number { color: var(--component); }
.t-boolean { color: var(--accent); }
.t-nil { color: var(--muted); }
.t-fn { color: var(--hot); }
.t-special { color: var(--shield); }
.t-error { color: var(--bad); }
.dbg-line { white-space: pre-wrap; word-break: break-word; border-bottom: 1px solid color-mix(in srgb, var(--rule) 50%, transparent); padding: 1px 0; }
.dbg-line.l-fixed, .dbg-out pre.dbg-fixed { white-space: pre; word-break: normal; }
.dbg-line.l-warn { color: var(--warn); }
.dbg-line.l-error { color: var(--bad); }
.dbg-line.l-debug { color: var(--muted); }
.dbg-line.l-table { color: var(--shield); }
.dbg-empty { color: var(--muted); margin: auto; text-align: center; padding: 20px; }
`;

export class DebugMenu {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly capEl: HTMLElement;
  private readonly findEl: HTMLInputElement;
  private readonly pinsEl: HTMLElement;
  private readonly recentEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly docEl: HTMLElement;
  private readonly exEl: HTMLElement;
  private readonly fnEl: HTMLElement;
  private readonly argsEl: HTMLTextAreaElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly pinBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private readonly outEl: HTMLElement;
  private readonly linesHead: HTMLElement;
  private readonly linesEl: HTMLElement;
  private readonly callRow: HTMLElement;
  /** The README's table, once it has been read; null until the first opening has fetched it. */
  private rows: DebugRow[] | null = null;
  private docs: Map<string, DebugDoc> = new Map();
  private docsError = '';
  private docsLoading: Promise<void> | null = null;
  private helpers: Helper[] = [];
  private selected: Helper | null = null;
  private store: DebugStore;
  private busy = false;
  private stopWaiting: (() => void) | null = null;
  private flushTimer = 0;
  private startedAt = 0;
  /** The call being waited on, as the status line names it; '' when none is. */
  private runningCall = '';
  /** Said on the waiting line after a second run was asked for while one is waited on; '' otherwise. */
  private waitNote = '';
  /** Console lines heard during the call now running and not yet written, and how many were written or dropped. */
  private pending: ConsoleLine[] = [];
  private written = 0;
  private dropped = 0;
  private value: unknown = undefined;
  private hasValue = false;
  private last: LastCall | null = null;
  private runs = 0;
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly onPanelKey: (e: KeyboardEvent) => void;
  private readonly onLock: () => void;
  private readonly stopHearingKeys: () => void;
  /**
   * What the menu needs of the game. It is assigned in the body rather than written as a parameter
   * property, in keeping with the other panels, whose node tests run their files as they stand.
   */
  private readonly deps: DebugMenuDeps;

  constructor(parent: HTMLElement, deps: DebugMenuDeps) {
    this.deps = deps;
    this.store = loadStore();
    if (!document.getElementById('debug-menu-style')) {
      const style = document.createElement('style');
      style.id = 'debug-menu-style';
      style.textContent = DEBUG_MENU_CSS;
      document.head.appendChild(style);
    }
    this.root = el('div', 'dbg-root');
    parent.appendChild(this.root);
    this.panel = el('div', 'dbg-panel hidden');
    // Focusable, so a click on the window's own background keeps the keyboard inside it and Escape
    // there is the window's rather than the game's.
    this.panel.tabIndex = -1;
    this.root.appendChild(this.panel);

    const head = el('div', 'dbg-head');
    head.append(el('h3', '', 'Debug'));
    this.capEl = el('span', 'dbg-cap');
    this.capEl.title = 'the key that opens and shuts this window (the Controls page: Debug menu)';
    this.findEl = el('input', 'dbg-find');
    this.findEl.type = 'search';
    this.findEl.placeholder = 'find a helper by its name or by what it does';
    this.findEl.spellcheck = false;
    const close = el('button', 'dbg-close', '×');
    close.type = 'button';
    close.title = 'shut the window (Esc)';
    head.append(this.capEl, this.findEl, close);
    this.panel.append(head);

    const body = el('div', 'dbg-body');
    const side = el('div', 'dbg-side');
    side.append(el('h4', '', 'Pinned'));
    this.pinsEl = el('div', 'dbg-pins');
    side.append(this.pinsEl, el('h4', '', 'Recent'));
    this.recentEl = el('div', 'dbg-recent');
    side.append(this.recentEl);
    this.listEl = el('div', 'dbg-list');
    side.append(this.listEl);

    const main = el('div', 'dbg-main');
    this.titleEl = el('div', 'dbg-title');
    this.docEl = el('div', 'dbg-doc');
    this.exEl = el('div', 'dbg-ex');
    this.callRow = el('div', 'dbg-callrow');
    this.fnEl = el('span', 'dbg-fn');
    this.argsEl = el('textarea', 'dbg-args');
    this.argsEl.spellcheck = false;
    this.argsEl.rows = 1;
    this.argsEl.placeholder = 'arguments, as inside the brackets';
    this.argsEl.title = 'Enter runs it; Shift+Enter starts a new line';
    this.runBtn = el('button', 'dbg-run', 'Run');
    this.stopBtn = el('button', 'dbg-stop hidden', 'Stop waiting');
    this.stopBtn.title = 'stop waiting for the answer; the call itself runs on';
    this.pinBtn = el('button', 'dbg-pin', '☆');
    this.pinBtn.title = 'pin this call';
    this.copyBtn = el('button', 'dbg-copy', 'Copy');
    this.copyBtn.title = 'the answer as JSON, on the clipboard';
    for (const b of [this.runBtn, this.stopBtn, this.pinBtn, this.copyBtn, close]) b.type = 'button';
    this.callRow.append(this.fnEl, el('span', 'dbg-paren', '('), this.argsEl, el('span', 'dbg-paren', ')'), this.runBtn, this.stopBtn, this.pinBtn, this.copyBtn);
    this.statusEl = el('div', 'dbg-status');
    this.outEl = el('div', 'dbg-out');
    this.linesHead = el('div', 'dbg-lines-head hidden');
    this.linesEl = el('div', 'dbg-lines hidden');
    main.append(this.titleEl, this.docEl, this.exEl, this.callRow, this.statusEl, this.outEl, this.linesHead, this.linesEl);
    body.append(side, main);
    this.panel.append(body);

    close.addEventListener('click', () => this.hide());
    this.findEl.addEventListener('input', () => this.drawList());
    this.runBtn.addEventListener('click', () => void this.run());
    this.stopBtn.addEventListener('click', () => this.stopWaiting?.());
    this.pinBtn.addEventListener('click', () => this.pin());
    this.copyBtn.addEventListener('click', () => void this.copy());
    this.argsEl.addEventListener('input', () => this.drawPin());

    // Keys pressed inside the window are the window's: Escape shuts it, the menu's own key shuts it
    // (from a typed line only when it types nothing), and nothing else is let through to the game's
    // other listeners -- the chat line's Enter, the game's own bindings, the Escape that would open the menu.
    this.onPanelKey = (e) => this.panelKey(e);
    this.panel.addEventListener('keydown', this.onPanelKey);
    // Escape with the keyboard nowhere in particular (the page itself has it) still shuts this
    // window first. It is put on before the game's own Escape listener, so it is asked first.
    this.onKey = (e) => {
      if (e.code !== 'Escape' || e.repeat || !this.open) return;
      if (this.panel.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close(true);
    };
    window.addEventListener('keydown', this.onKey);
    // A click on the world asks for the pointer back: that means "I want to play", so the window
    // stands down and gives the keys back.
    this.onLock = () => {
      if (this.open && document.pointerLockElement) this.hide();
    };
    document.addEventListener('pointerlockchange', this.onLock);
    this.stopHearingKeys = onBindingsChanged(() => this.drawCap());
    this.drawCap();
    this.drawSaved();
    this.drawEmpty();
  }

  get open(): boolean {
    return !this.panel.classList.contains('hidden');
  }

  /** The key, pressed in the world: open when the game allows it, shut when open. */
  toggle(): void {
    if (this.open) this.hide();
    else if (this.deps.canOpen()) this.show();
  }

  show(): void {
    if (this.open) return;
    this.panel.classList.remove('hidden');
    this.deps.freeMouse(true);
    this.readHelpers();
    this.drawList();
    this.drawSaved();
    void this.loadDocs();
    if (!this.selected && this.store.last) {
      const h = this.find(this.store.last.helper, this.store.last.on);
      if (h) this.pick(h, false);
    }
    this.findEl.focus();
    this.findEl.select();
  }

  hide(): void {
    this.shut(true);
  }

  /** Shut, leaving the mouse to whatever is taking the screen (the select screen, on the way out). */
  standDown(): void {
    this.shut(false);
  }

  /** Shut by Escape: the mouse goes back, and the game's keys stand aside a moment longer. */
  private close(byEscape: boolean): void {
    if (!this.open) return;
    this.shut(true);
    if (byEscape) this.deps.holdKeys(DEBUG_MENU_TUNE.escapeHoldMs);
  }

  private shut(giveBackMouse: boolean): void {
    if (!this.open) return;
    if (this.panel.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.panel.classList.add('hidden');
    if (giveBackMouse) this.deps.freeMouse(false);
  }

  // ---- the README ----------------------------------------------------------------------------------

  /** Read the README's table, once, the first time the window opens. */
  private loadDocs(): Promise<void> {
    if (this.docsLoading) return this.docsLoading;
    this.docsLoading = import('../../README.md?raw')
      .then((m) => {
        this.rows = parseDebugTable(m.default);
        this.docs = docsByHelper(this.rows);
      })
      .catch((err) => {
        this.rows = [];
        this.docsError = err instanceof Error ? err.message : String(err);
      })
      .then(() => {
        // What each helper says is searchable now, and whatever is picked has its words -- and, if
        // nothing has been typed in its box yet, its first example.
        for (const h of this.helpers) this.attachDoc(h);
        this.drawList();
        if (this.selected) {
          if (!this.argsEl.value.trim()) this.argsEl.value = firstArgs(this.selected.doc);
          this.drawSelected();
        }
      });
    return this.docsLoading;
  }

  private attachDoc(h: Helper): void {
    h.doc = this.docs.get(docKey(h.name, h.on));
    h.haystack = h.doc ? h.doc.rows.map((r) => `${r.usage} ${r.description}`).join(' ').toLowerCase() : '';
  }

  // ---- the helpers ---------------------------------------------------------------------------------

  /** Every helper there is now, read off `__debug` and the window themselves. */
  private readHelpers(): void {
    const w = window as unknown as Record<string, unknown>;
    const dbg = (w.__debug ?? {}) as Record<string, unknown>;
    const out: Helper[] = [];
    for (const name of Object.keys(dbg)) if (typeof dbg[name] === 'function') out.push({ name, on: 'debug', haystack: '', doc: undefined });
    for (const name of Object.keys(w)) {
      if (!/^__[a-z][A-Za-z0-9]*$/.test(name) || name === '__debug') continue;
      if (typeof w[name] === 'function') out.push({ name, on: 'window', haystack: '', doc: undefined });
    }
    for (const h of out) this.attachDoc(h);
    this.helpers = out;
    // What was picked keeps its place when it is still there.
    if (this.selected) this.selected = this.find(this.selected.name, this.selected.on);
  }

  private find(name: string, on: 'debug' | 'window'): Helper | null {
    return this.helpers.find((h) => h.name === name && h.on === on) ?? null;
  }

  private lookup(h: Helper): { fn: unknown; self: unknown } {
    const w = window as unknown as Record<string, unknown>;
    if (h.on === 'window') return { fn: w[h.name], self: w };
    const dbg = w.__debug as Record<string, unknown> | undefined;
    return { fn: dbg?.[h.name], self: dbg };
  }

  /**
   * Redraw part of the window without losing the keyboard. A button that is clicked has the focus, and
   * drawing its list again takes that button out of the page, which leaves the focus on the page's
   * body: every key after it would reach the game while the window was still up, a digit firing a
   * slot and Enter opening the chat line. So when the keyboard was in the window before a redraw and
   * is not after it, it is put back on the window itself, whose own keys are the window's.
   */
  private keepFocus(redraw: () => void): void {
    const had = this.open && this.panel.contains(document.activeElement);
    redraw();
    if (had && !this.panel.contains(document.activeElement)) this.panel.focus({ preventScroll: true });
  }

  private drawList(): void {
    this.keepFocus(() => {
      const groups = filterGroups(groupHelpers(this.helpers), this.findEl.value) as { title: string; entries: Helper[] }[];
      const searching = !!this.findEl.value.trim();
      this.listEl.replaceChildren();
      if (!groups.length) {
        this.listEl.append(el('div', 'dbg-none', searching ? 'nothing answers that' : 'no helpers: __debug is not up yet'));
        return;
      }
      for (const g of groups) {
        const d = el('details', 'dbg-group');
        d.open = true;
        const s = el('summary', '', `${g.title} `);
        s.append(el('span', '', `${g.entries.length}`));
        d.append(s);
        for (const h of g.entries) d.append(this.itemButton(h));
        this.listEl.append(d);
      }
    });
  }

  private itemButton(h: Helper): HTMLButtonElement {
    const b = el('button', 'dbg-item', h.name);
    b.type = 'button';
    if (h === this.selected) b.classList.add('on');
    // Only once the README has been read is "no row" something to say.
    if (this.rows && !h.doc) {
      b.classList.add('nodoc');
      b.title = 'the README has no row for this one';
    } else if (h.doc) b.title = h.doc.rows[0]?.usage.replace(/`/g, '') ?? '';
    b.addEventListener('click', () => this.pick(h, true));
    return b;
  }

  /** Pick a helper: its words, its examples, and the box filled from the first of them. */
  private pick(h: Helper, focus: boolean, args?: string): void {
    this.selected = h;
    this.store.last = { helper: h.name, on: h.on, args: '' };
    saveStore(this.store);
    for (const b of this.listEl.querySelectorAll<HTMLButtonElement>('.dbg-item')) b.classList.toggle('on', b.textContent === h.name);
    this.argsEl.value = args ?? firstArgs(h.doc);
    this.drawSelected();
    if (focus) {
      this.argsEl.focus();
      this.argsEl.setSelectionRange(this.argsEl.value.length, this.argsEl.value.length);
    }
  }

  private drawSelected(): void {
    // The example chips are drawn again here, and one of them may be what was clicked last.
    this.keepFocus(() => this.drawSelectedNow());
  }

  private drawSelectedNow(): void {
    const h = this.selected;
    if (!h) {
      this.drawEmpty();
      return;
    }
    this.callRow.classList.remove('hidden');
    this.titleEl.replaceChildren(el('b', '', h.name), el('span', '', h.on === 'window' ? 'on the window' : 'on __debug'));
    this.fnEl.textContent = h.on === 'window' ? h.name : `__debug.${h.name}`;
    this.docEl.replaceChildren();
    if (!this.rows) this.docEl.append(el('p', 'dbg-usage', 'reading the README…'));
    else if (!h.doc) this.docEl.append(el('p', 'dbg-usage', this.docsError ? `the README could not be read (${this.docsError})` : 'the README has no row for this one yet'));
    else {
      for (const row of h.doc.rows) {
        const p = el('p');
        // The README's own words, escaped by `inlineMarkdown` before anything is made markup.
        p.innerHTML = inlineMarkdown(row.description);
        this.docEl.append(p);
      }
    }
    this.exEl.replaceChildren();
    for (const ex of h.doc?.examples ?? []) {
      const chip = el('button', 'dbg-chip', ex.code);
      chip.type = 'button';
      chip.title = ex.args === null ? 'named, not called, in the README' : 'put these arguments in the box';
      chip.addEventListener('click', () => {
        this.argsEl.value = ex.args ?? '';
        this.drawPin();
        this.argsEl.focus();
      });
      this.exEl.append(chip);
    }
    this.drawPin();
  }

  private drawEmpty(): void {
    this.titleEl.replaceChildren(el('span', '', 'Pick a helper on the left, or type to find one. Enter in the box runs it.'));
    this.docEl.replaceChildren();
    this.exEl.replaceChildren();
    this.callRow.classList.add('hidden');
  }

  private drawCap(): void {
    const code = this.deps.keys()[0] ?? '';
    const cap = keyLabel(code);
    if (this.capEl.textContent !== cap) this.capEl.textContent = cap;
  }

  // ---- the keys ------------------------------------------------------------------------------------

  private panelKey(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.close(true);
      return;
    }
    const typing = isField(e.target);
    // The menu's own key shuts it, except where it would type a character into a box.
    if (!e.repeat && this.deps.keys().includes(e.code) && (!typing || e.key.length !== 1)) {
      e.preventDefault();
      e.stopPropagation();
      this.hide();
      return;
    }
    if (e.target === this.argsEl && (e.code === 'Enter' || e.code === 'NumpadEnter') && !e.shiftKey) {
      e.preventDefault();
      void this.run();
    } else if (e.target === this.findEl && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
      e.preventDefault();
      const best = bestMatch(groupHelpers(this.helpers) as { title: string; entries: Helper[] }[], this.findEl.value);
      if (best) this.pick(best, true);
    } else if (e.target === this.findEl && e.code === 'ArrowDown') {
      e.preventDefault();
      this.listEl.querySelector<HTMLButtonElement>('.dbg-item')?.focus();
    }
    // Nothing pressed in here is the game's.
    e.stopPropagation();
  }

  // ---- the history and the pins --------------------------------------------------------------------

  private current(): CallRecord | null {
    const h = this.selected;
    return h ? { helper: h.name, on: h.on, args: this.argsEl.value } : null;
  }

  private drawPin(): void {
    const rec = this.current();
    const on = !!rec && this.store.pinned.some((p) => sameCall(p, rec));
    this.pinBtn.classList.toggle('on', on);
    this.pinBtn.textContent = on ? '★' : '☆';
    this.pinBtn.title = on ? 'unpin this call' : 'pin this call';
  }

  private pin(): void {
    const rec = this.current();
    if (!rec) return;
    this.store.pinned = togglePin(this.store.pinned, rec).list;
    saveStore(this.store);
    this.drawPin();
    this.drawSaved();
  }

  private drawSaved(): void {
    // A Recent or Pinned line, and its ×, are drawn again by their own click.
    this.keepFocus(() => this.drawSavedNow());
  }

  private drawSavedNow(): void {
    const line = (rec: CallRecord, remove: () => void, list: HTMLElement, tick?: () => void) => {
      const row = el('div', 'dbg-saved');
      const b = el('button', 'dbg-item', callText(rec));
      b.type = 'button';
      b.title = `${rec.on === 'window' ? '' : '__debug.'}${callText(rec)}: click to run it again`;
      b.addEventListener('click', () => this.rerun(rec));
      const x = el('button', 'dbg-x', '×');
      x.type = 'button';
      x.title = 'take it off the list';
      x.addEventListener('click', remove);
      // A pin's own tick: run it again at start, once the first world is up after a reload.
      if (tick) {
        const t = el('button', `dbg-start${rec.atStart ? ' on' : ''}`, rec.atStart ? '▶' : '▷');
        t.type = 'button';
        t.title = rec.atStart ? 'runs at start, once the first world is up after a reload: click to stop' : 'run this at start, once the first world is up after a reload (said on the message line as it runs)';
        t.addEventListener('click', tick);
        row.append(t);
      }
      row.append(b, x);
      list.append(row);
    };
    this.pinsEl.replaceChildren();
    if (!this.store.pinned.length) this.pinsEl.append(el('div', 'dbg-none', '☆ beside Run pins a call; ▷ beside a pin runs it at start'));
    for (const p of this.store.pinned) {
      line(
        p,
        () => {
          this.store.pinned = togglePin(this.store.pinned, p).list;
          saveStore(this.store);
          this.drawSaved();
          this.drawPin();
        },
        this.pinsEl,
        () => {
          this.store.pinned = setAtStart(this.store.pinned, p, !p.atStart);
          saveStore(this.store);
          this.drawSaved();
        },
      );
    }
    this.recentEl.replaceChildren();
    if (!this.store.history.length) this.recentEl.append(el('div', 'dbg-none', 'nothing run yet'));
    for (const h of this.store.history.slice(0, 12)) {
      line(h, () => {
        this.store.history = this.store.history.filter((x) => x !== h);
        saveStore(this.store);
        this.drawSaved();
      }, this.recentEl);
    }
  }

  /**
   * A kept call again, in one click: picked, filled and run. Not while another is being waited on:
   * picking it would put its name and arguments over a call that then never runs, and the answer of
   * the one still waited on would land under them.
   */
  private rerun(rec: CallRecord): void {
    if (this.busy) {
      this.refuseWhileBusy();
      return;
    }
    const h = this.find(rec.helper, rec.on);
    if (!h) {
      this.status(`${callText(rec)}: there is no ${rec.helper} on ${rec.on === 'window' ? 'the window' : '__debug'} now`, 'bad');
      return;
    }
    this.pick(h, false, rec.args);
    void this.run();
  }

  // ---- running a call ------------------------------------------------------------------------------

  private status(text: string, tone: '' | 'ok' | 'bad' | 'warn'): void {
    this.statusEl.textContent = text;
    this.statusEl.className = `dbg-status${tone ? ` ${tone}` : ''}`;
  }

  /** The line while a call is waited on: what, for how long, and anything asked of it meanwhile. */
  private writeWaiting(): void {
    const s = (performance.now() - this.startedAt) / 1000;
    this.status(`${this.runningCall} … waiting ${s.toFixed(0)} s; ${this.waitNote || 'the game runs on meanwhile'}`, this.waitNote ? 'warn' : '');
  }

  /** A second run asked for while one is waited on: said on the waiting line, which keeps saying it. */
  private refuseWhileBusy(): void {
    this.waitNote = 'it is still being waited on: let it finish, or Stop waiting, before running another';
    this.writeWaiting();
  }

  private setBusy(on: boolean): void {
    // The Run button is disabled, and the Stop button hidden, under the pointer that pressed it, and
    // a browser takes the keyboard off a control that can no longer be pressed and onto the page's
    // body: it is moved to the window first.
    const a = document.activeElement;
    if ((on && a === this.runBtn) || (!on && a === this.stopBtn)) this.panel.focus({ preventScroll: true });
    this.busy = on;
    this.runBtn.disabled = on;
    this.runBtn.textContent = on ? 'Running…' : 'Run';
    this.stopBtn.classList.add('hidden');
  }

  /**
   * Call the picked helper with what is in the box. The arguments are read first and a mistake in
   * them is said in words; a promise is waited on with a way to stop waiting, the console is listened
   * to for exactly as long as that takes and put back in a `finally`, and the answer is drawn once.
   */
  async run(): Promise<void> {
    const h = this.selected;
    if (!h) return;
    if (this.busy) {
      this.refuseWhileBusy();
      return;
    }
    const text = this.argsEl.value;
    const call = `${h.on === 'window' ? '' : '__debug.'}${h.name}(${text.trim()})`;
    const parsed = evaluateArgs(text);
    if (!parsed.ok) {
      this.last = { call, ms: 0, outcome: 'refused' };
      this.status(`${call}: ${parsed.error}`, 'bad');
      return;
    }
    const { fn, self } = this.lookup(h);
    if (typeof fn !== 'function') {
      this.last = { call, ms: 0, outcome: 'refused' };
      this.status(`${call}: there is no ${h.name} there now`, 'bad');
      return;
    }
    this.store.history = pushHistory(this.store.history, { helper: h.name, on: h.on, args: text }, Date.now());
    saveStore(this.store);
    this.drawSaved();
    this.runs++;
    this.setBusy(true);
    this.runningCall = call;
    this.waitNote = '';
    // The last answer's tree may hold the keyboard (a fold that was clicked open).
    this.keepFocus(() => {
      this.outEl.replaceChildren();
      this.linesEl.replaceChildren();
    });
    this.pending = [];
    this.written = 0;
    this.dropped = 0;
    this.hasValue = false;
    this.value = undefined;
    this.status(`${call} …`, '');
    let heard = 0;
    const stopListening = captureConsole(console as unknown as ConsoleLike, (line) => {
      if (heard++ < DEBUG_MENU_TUNE.consoleMax) this.pending.push(line);
      else this.dropped++;
    });
    this.startedAt = performance.now();
    let outcome: LastCall['outcome'] = 'ok';
    let value: unknown;
    try {
      const out = (fn as (...a: unknown[]) => unknown).apply(self, parsed.args);
      if (isThenable(out)) {
        // Waited on with a way out: the button settles the wait, never the call. Both ends are
        // handled, so a call that fails after nobody is waiting any more is not an unhandled one.
        this.stopBtn.classList.remove('hidden');
        this.flushSoon();
        const settled = Promise.resolve(out).then(
          (v) => ({ v }),
          (err: unknown) => ({ err }),
        );
        const stopped = new Promise<typeof STOPPED>((resolve) => {
          this.stopWaiting = () => resolve(STOPPED);
        });
        const r = await Promise.race([settled, stopped]);
        if (r === STOPPED) outcome = 'stopped';
        else if ('err' in r) {
          outcome = 'threw';
          value = r.err;
        } else value = r.v;
      } else value = out;
    } catch (err) {
      outcome = 'threw';
      value = err;
    } finally {
      stopListening();
      this.stopWaiting = null;
      if (this.flushTimer) window.clearTimeout(this.flushTimer);
      this.flushTimer = 0;
      this.runningCall = '';
      this.waitNote = '';
      this.setBusy(false);
    }
    const ms = performance.now() - this.startedAt;
    this.last = { call, ms: Math.round(ms), outcome };
    this.flushLines();
    const took = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
    if (outcome === 'stopped') {
      this.status(`${call}: stopped waiting after ${took}; the call itself runs on`, 'warn');
      return;
    }
    this.value = value;
    this.hasValue = true;
    this.status(`${call} · ${took}${outcome === 'threw' ? ' · threw' : ''}`, outcome === 'threw' ? 'bad' : 'ok');
    this.keepFocus(() => this.drawValue(value));
  }

  /** While a call is waited on: the clock and the lines, written a couple of times a second and no more. */
  private flushSoon(): void {
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = 0;
      if (!this.busy) return;
      this.writeWaiting();
      this.flushLines();
      this.flushSoon();
    }, DEBUG_MENU_TUNE.flushMs);
  }

  private flushLines(): void {
    if (this.pending.length) {
      const frag = document.createDocumentFragment();
      // A table, or a report of several lines, keeps its columns and scrolls sideways; a line of prose wraps.
      for (const line of this.pending) frag.append(el('div', `dbg-line l-${line.level}${keepsColumns(line.level, line.text) ? ' l-fixed' : ''}`, line.text));
      this.linesEl.append(frag);
      this.written += this.pending.length;
      this.pending = [];
    }
    const any = this.written > 0;
    this.linesHead.classList.toggle('hidden', !any);
    this.linesEl.classList.toggle('hidden', !any);
    if (any) this.linesHead.textContent = `printed while it ran: ${this.written} line${this.written === 1 ? '' : 's'}${this.dropped ? `, and ${this.dropped} more not kept` : ''}`;
  }

  /** The answer: a string as the text it is, anything else as a tree folded where it is large. */
  private drawValue(v: unknown): void {
    this.outEl.replaceChildren();
    if (typeof v === 'string') {
      this.outEl.append(el('pre', keepsColumns('log', v) ? 'dbg-fixed' : '', v.length > 200000 ? `${v.slice(0, 200000)}\n… (${v.length.toLocaleString('en')} characters)` : v));
      return;
    }
    if (v === undefined) {
      this.outEl.append(el('div', 'dbg-row t-nil', 'undefined (it answers nothing)'));
      return;
    }
    this.drawNode(describeValue(v), null, this.outEl);
  }

  private drawNode(node: ViewNode, key: string | null, into: HTMLElement): void {
    if (node.kind === 'leaf') {
      const row = el('div', 'dbg-row');
      if (key !== null) row.append(el('span', 'dbg-k', key), document.createTextNode(': '));
      row.append(el('span', `t-${node.tone}`, node.text));
      into.append(row);
      return;
    }
    const d = el('details', 'dbg-br');
    const s = el('summary');
    if (key !== null) s.append(el('span', 'dbg-k', key), document.createTextNode(': '));
    s.append(el('span', node.error ? 'dbg-l t-error' : 'dbg-l', node.label));
    if (node.preview) s.append(document.createTextNode(' '), el('span', 'dbg-p', node.preview));
    const kids = el('div', 'dbg-kids');
    d.append(s, kids);
    // A branch is written out only when it is first opened: a folded one costs nothing.
    let filled = false;
    const fill = () => {
      if (filled) return;
      filled = true;
      for (const e of node.entries()) this.drawNode(e.node, e.key, kids);
      if (!node.count) kids.append(el('div', 'dbg-row t-nil', 'empty'));
    };
    if (node.open) {
      d.open = true;
      fill();
    }
    d.addEventListener('toggle', () => {
      if (d.open) fill();
    });
    into.append(d);
  }

  private async copy(): Promise<void> {
    if (!this.hasValue) {
      this.status('nothing to copy yet: run something first', 'warn');
      return;
    }
    const text = typeof this.value === 'string' ? this.value : toJsonText(this.value);
    try {
      await navigator.clipboard.writeText(text);
      this.status(`copied, ${text.length.toLocaleString('en')} characters of JSON`, 'ok');
    } catch {
      // No clipboard (a page that is not focused, or a browser that says no): the text is put in
      // the answer's place, selected, for a Ctrl+C.
      this.keepFocus(() => this.outEl.replaceChildren(el('pre', keepsColumns('log', text) ? 'dbg-fixed' : '', text)));
      const range = document.createRange();
      range.selectNodeContents(this.outEl);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      this.status('the clipboard said no: the JSON is selected below for Ctrl+C', 'warn');
    }
  }

  // ---- the pins run at start -----------------------------------------------------------------------

  /** What the last run at start came to, call by call, for the console report; null before one has run. */
  private startRan: string[] | null = null;

  /**
   * Every pin ticked to run at start (`startCalls`), in the order pinned, once the first world is up after
   * a reload: each waited on before the next, for at most `DEBUG_MENU_TUNE.startWaitMs`, a call that throws
   * or names a helper that is no longer there said in words and stepped over, and the whole said on the
   * message line by `say` -- so a knob put back at start, god mode or a server's day among them, is never
   * put back silently. Nothing here runs in a frame; the menu need not be open. Answers what ran.
   */
  async runAtStart(say: (line: string) => void): Promise<string[]> {
    const calls = startCalls(this.store.pinned);
    if (!calls.length) {
      this.startRan = [];
      return [];
    }
    const done: string[] = [];
    for (const rec of calls) {
      const text = `${rec.on === 'window' ? '' : '__debug.'}${callText(rec)}`;
      const { fn, self } = this.lookup({ name: rec.helper, on: rec.on, haystack: '', doc: undefined });
      if (typeof fn !== 'function') {
        done.push(`${text}: there is no ${rec.helper} now`);
        continue;
      }
      const parsed = evaluateArgs(rec.args);
      if (!parsed.ok) {
        done.push(`${text}: ${parsed.error}`);
        continue;
      }
      try {
        const out = (fn as (...a: unknown[]) => unknown).apply(self, parsed.args);
        if (isThenable(out)) {
          let timer = 0;
          const late = new Promise<void>((resolve) => {
            timer = window.setTimeout(resolve, DEBUG_MENU_TUNE.startWaitMs);
          });
          // Both ends handled, so a call that fails after nobody is waiting is not an unhandled one.
          await Promise.race([Promise.resolve(out).then(() => undefined, () => undefined), late]);
          window.clearTimeout(timer);
        }
        done.push(text);
      } catch (err) {
        done.push(`${text} threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.startRan = done;
    say(`the debug menu ran at start: ${done.join('; ')}`);
    return done;
  }

  // ---- the console's own handle --------------------------------------------------------------------

  /**
   * `__debug.debugMenu({ … })`: open or shut it, pick a helper, fill the box, and run it, which is how
   * a tab with no keyboard works the menu. A run is waited on before the answer comes back. `pin` pins
   * the call in the box (or unpins it with false), `atStart` ticks that pin to run at start (or clears
   * the tick), and `start` runs every ticked pin now, as a reload would once its first world is up.
   */
  async drive(o: { open?: boolean; pick?: string; args?: string; run?: boolean; pin?: boolean; atStart?: boolean; start?: boolean } = {}, say: (line: string) => void = () => {}): Promise<void> {
    // The list and the README as they stand, so the report that follows is the whole of it.
    this.readHelpers();
    await this.loadDocs();
    if (this.open) this.drawList();
    if (o.open === true) this.show();
    if (o.open === false) this.hide();
    if (typeof o.pick === 'string') {
      const want = o.pick.replace(/^window\./, '');
      const h = this.find(want, want.startsWith('__') ? 'window' : 'debug');
      if (h) this.pick(h, false, o.args);
      else this.status(`there is no ${o.pick} to pick`, 'bad');
    } else if (typeof o.args === 'string') {
      this.argsEl.value = o.args;
      this.drawPin();
    }
    const rec = this.current();
    if (typeof o.pin === 'boolean' && rec) {
      const pinned = this.store.pinned.some((p) => sameCall(p, rec));
      if (pinned !== o.pin) this.store.pinned = togglePin(this.store.pinned, rec).list;
    }
    if (typeof o.atStart === 'boolean' && rec) this.store.pinned = setAtStart(this.store.pinned, rec, o.atStart);
    if (typeof o.pin === 'boolean' || typeof o.atStart === 'boolean') {
      saveStore(this.store);
      this.drawPin();
      this.drawSaved();
    }
    if (o.run) await this.run();
    if (o.start) await this.runAtStart(say);
  }

  /** What the menu holds, for `__debug.debugMenu()`. */
  report(): Record<string, unknown> {
    const groups = groupHelpers(this.helpers);
    const debugNames = new Set(this.helpers.filter((h) => h.on === 'debug').map((h) => h.name));
    const stale = this.rows ? [...this.docs.values()].filter((d) => d.on === 'debug' && !debugNames.has(d.helper)).map((d) => d.helper) : null;
    return {
      open: this.open,
      readme: this.rows ? { rows: this.rows.length, helpers: this.docs.size, error: this.docsError || null } : 'not read yet: it is read the first time the window opens',
      helpers: this.helpers.length,
      groups: groups.map((g) => `${g.title} (${g.entries.length})`),
      other: groups.find((g) => g.title === OTHER_GROUP)?.entries.map((h) => h.name) ?? [],
      undocumented: this.rows ? this.helpers.filter((h) => !h.doc).map((h) => h.name) : null,
      stale,
      picked: this.selected ? this.selected.name : null,
      args: this.argsEl.value,
      busy: this.busy,
      runs: this.runs,
      last: this.last,
      shown: this.hasValue ? (typeof this.value === 'object' && this.value !== null ? 'an object, drawn as a tree' : typeof this.value) : null,
      lines: this.written,
      pinned: this.store.pinned.map(callText),
      atStart: startCalls(this.store.pinned).map(callText),
      ranAtStart: this.startRan,
      recent: this.store.history.slice(0, 10).map(callText),
      key: keyLabel(this.deps.keys()[0] ?? ''),
    };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.panel.removeEventListener('keydown', this.onPanelKey);
    this.stopHearingKeys();
    this.stopWaiting?.();
    this.root.remove();
  }
}
