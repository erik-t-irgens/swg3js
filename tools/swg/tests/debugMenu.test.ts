// The debug menu's window itself (src/ui/debugMenu.ts), driven against a stand-in for the page, and
// the four lines of main.ts that decide where the mouse goes when it shuts.
//
// What is pinned here is what a review found the window getting wrong with a real keyboard and mouse:
//
// - The keyboard stays in the window. A clicked button has the focus, and a Recent or Pinned line run
//   again, or taken off, is drawn again by its own click; a browser then leaves the focus on the page's
//   body, where the game takes every key with the window still up (a digit fires a slot, Enter opens
//   the chat line). The stand-in answers `activeElement` as a browser does: the body, once the focused
//   element has left the page.
// - A kept call clicked while another is waited on is refused in words, and neither picks nor fills
//   anything, rather than putting its name over a call that never runs.
// - A console table, and a report of several lines, are drawn without wrapping, so their columns stay
//   lined up.
// - Shutting it gives the mouse back through the game's own check (`handBackMouse`), so a panel or the
//   map it was opened over keeps the cursor instead of having the pointer locked under it.
// - A pin ticked to run at start runs once the first world is up, in the order pinned, each waited on, a
//   throw or a helper gone said and stepped over, and the whole said on the message line: never silently.
// - A helper with dials shows them as sliders: a slider moved sets its number through the dial on its
//   step, a number typed may go past the slider, the bar says what moved and the line that sets it again,
//   Reset and Pin at start do what they say, the keys stay the window's, and opening the window again
//   reads numbers the console moved meanwhile.
//
// Everything here is synthetic: made-up helpers on a made-up `__debug`, nothing read from the game.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- the stand-in for the page --------------------------------------------------------------------

type Listener = (e: FakeEvent) => void;

interface FakeEvent {
  type: string;
  target: FakeNode;
  code?: string;
  key?: string;
  shiftKey?: boolean;
  repeat?: boolean;
  stopped: boolean;
  stoppedNow: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

/** The element that has the focus, if it is still in the page; the body otherwise, as a browser answers. */
let focused: FakeNode | null = null;

class FakeNode {
  nodeType: number;
  nodeName: string;
  tagName: string;
  parent: FakeNode | null = null;
  kids: FakeNode[] = [];
  private text = '';
  private listeners = new Map<string, Listener[]>();
  private classes = new Set<string>();
  id = '';
  title = '';
  tabIndex = 0;
  type = '';
  placeholder = '';
  spellcheck = true;
  rows = 1;
  value = '';
  disabled = false;
  open = false;
  isContentEditable = false;
  html = '';
  constructor(tag: string, nodeType = 1) {
    this.nodeType = nodeType;
    this.nodeName = tag.toUpperCase();
    this.tagName = this.nodeName;
  }
  get className(): string {
    return [...this.classes].join(' ');
  }
  set className(v: string) {
    this.classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get classList() {
    const c = this.classes;
    return {
      add: (...n: string[]) => n.forEach((x) => c.add(x)),
      remove: (...n: string[]) => n.forEach((x) => c.delete(x)),
      toggle: (n: string, force?: boolean) => {
        const want = force === undefined ? !c.has(n) : force;
        if (want) c.add(n);
        else c.delete(n);
        return want;
      },
      contains: (n: string) => c.has(n),
    };
  }
  get textContent(): string {
    return this.nodeType === 3 ? this.text : this.kids.map((k) => k.textContent).join('');
  }
  set textContent(v: string) {
    if (this.nodeType === 3) {
      this.text = String(v);
      return;
    }
    this.replaceChildren();
    if (String(v)) this.append(String(v));
  }
  set innerHTML(v: string) {
    this.replaceChildren();
    this.html = String(v);
  }
  get innerHTML(): string {
    return this.html;
  }
  private adopt(n: FakeNode | string): FakeNode[] {
    if (typeof n === 'string') {
      const t = new FakeNode('#text', 3);
      t.text = n;
      return [t];
    }
    // A fragment gives up its children.
    if (n.nodeType === 11) {
      const moved = n.kids.slice();
      for (const k of moved) k.parent = null;
      n.kids = [];
      return moved;
    }
    return [n];
  }
  append(...nodes: (FakeNode | string)[]): void {
    for (const n of nodes) {
      for (const k of this.adopt(n)) {
        k.parent?.removeChild(k);
        k.parent = this;
        this.kids.push(k);
      }
    }
  }
  appendChild(n: FakeNode): FakeNode {
    this.append(n);
    return n;
  }
  removeChild(n: FakeNode): void {
    const i = this.kids.indexOf(n);
    if (i >= 0) this.kids.splice(i, 1);
    n.parent = null;
  }
  replaceChildren(...nodes: (FakeNode | string)[]): void {
    for (const k of this.kids) k.parent = null;
    this.kids = [];
    this.append(...nodes);
  }
  remove(): void {
    this.parent?.removeChild(this);
  }
  contains(n: unknown): boolean {
    for (let at = n as FakeNode | null; at; at = at.parent) if (at === this) return true;
    return false;
  }
  get isConnected(): boolean {
    return doc.body.contains(this);
  }
  focus(): void {
    if (this.isConnected) focused = this;
  }
  blur(): void {
    if (focused === this) focused = null;
  }
  select(): void {}
  setSelectionRange(): void {}
  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  /** Hand an event to this node's own listeners. */
  deliver(e: FakeEvent): void {
    for (const fn of [...(this.listeners.get(e.type) ?? [])]) {
      if (e.stoppedNow) return;
      fn(e);
    }
  }
  /** Every descendant carrying a class, in the page's order. */
  querySelectorAll(sel: string): FakeNode[] {
    const want = sel.replace(/^\./, '');
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => {
      for (const k of n.kids) {
        if (k.classes.has(want)) out.push(k);
        walk(k);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): FakeNode | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

const winListeners = new Map<string, Listener[]>();
const doc = {
  body: new FakeNode('body'),
  head: new FakeNode('head'),
  pointerLockElement: null as unknown,
  lockListeners: [] as (() => void)[],
  createElement: (tag: string) => new FakeNode(tag),
  createTextNode: (text: string) => {
    const t = new FakeNode('#text', 3);
    t.textContent = text;
    return t;
  },
  createDocumentFragment: () => new FakeNode('#document-fragment', 11),
  createRange: () => ({ selectNodeContents() {} }),
  getElementById: (id: string) => doc.head.kids.find((k) => k.id === id) ?? null,
  get activeElement(): FakeNode {
    return focused && focused.isConnected ? focused : doc.body;
  },
  addEventListener(type: string, fn: () => void) {
    if (type === 'pointerlockchange') doc.lockListeners.push(fn);
  },
  removeEventListener() {},
};

/** A key pressed wherever the keyboard is: up through the page, then to the window, as a browser sends it. */
function press(code: string, key = code.length === 1 ? code : code.replace(/^Key/, '').toLowerCase()): FakeEvent {
  const target = doc.activeElement;
  const e: FakeEvent = {
    type: 'keydown',
    target,
    code,
    key,
    shiftKey: false,
    repeat: false,
    stopped: false,
    stoppedNow: false,
    preventDefault() {},
    stopPropagation() {
      this.stopped = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
      this.stoppedNow = true;
    },
  };
  for (let at: FakeNode | null = target; at && !e.stopped; at = at.parent) at.deliver(e);
  if (!e.stopped) {
    for (const fn of [...(winListeners.get('keydown') ?? [])]) {
      if (e.stoppedNow) break;
      fn(e);
    }
  }
  return e;
}

/** A button clicked with the mouse: it takes the focus, as a pressed button does, then hears the click. */
function click(b: FakeNode): void {
  b.focus();
  const e = { type: 'click', target: b, stopped: false, stoppedNow: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} } as FakeEvent;
  for (let at: FakeNode | null = b; at; at = at.parent) at.deliver(e);
}

// Timers the test steps by hand.
let nowMs = 1000;
let timerId = 0;
const timers = new Map<number, { fn: () => void; at: number }>();
function pass(ms: number): void {
  nowMs += ms;
  for (const [id, t] of [...timers]) {
    if (t.at > nowMs) continue;
    timers.delete(id);
    t.fn();
  }
}

const g = globalThis as unknown as Record<string, unknown>;
g.document = doc;
g.performance = { now: () => nowMs };
const store = new Map<string, string>();
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) };
const win: Record<string, unknown> = {
  addEventListener(type: string, fn: Listener) {
    const list = winListeners.get(type) ?? [];
    list.push(fn);
    winListeners.set(type, list);
  },
  removeEventListener(type: string, fn: Listener) {
    const list = winListeners.get(type) ?? [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  },
  setTimeout: (fn: () => void, after = 0) => {
    timers.set(++timerId, { fn, at: nowMs + after });
    return timerId;
  },
  clearTimeout: (id: number) => void timers.delete(id),
  getSelection: () => null,
};
g.window = win;

// The game's own `Input`, as far as this test needs it: every key that reaches the window and is not
// typed into a field is a key the game takes.
const gameHeard: string[] = [];
(win.addEventListener as (t: string, f: Listener) => void)('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  gameHeard.push(e.code ?? '');
});

// The helpers the menu lists: one that answers at once, one that is waited on, one that prints a
// table and one that answers with a report of several lines.
let finishSlow: (v: unknown) => void = () => {};
const startOrder: string[] = [];
let finishSecond: () => void = () => {};
win.__debug = {
  quick: () => 42,
  slow: () =>
    new Promise((resolve) => {
      finishSlow = resolve;
    }),
  tabled: () => {
    console.table([{ id: 'a', n: 1 }, { id: 'b', n: 22 }]);
    console.info('one line of prose, which wraps as prose does');
    return 7;
  },
  report: () => 'perf: 120 frames of play\n  frame  p50 6.9  p95 8.1',
  // The pins run at start: one that answers at once, one that answers later, one that throws, one that is
  // gone by the time the start comes round, and one pinned but never ticked.
  first: (n: number) => void startOrder.push(`first ${n}`),
  second: () =>
    new Promise((resolve) => {
      startOrder.push('second began');
      finishSecond = () => {
        startOrder.push('second done');
        resolve(2);
      };
    }),
  boom: () => {
    startOrder.push('boom');
    throw new Error('kaboom');
  },
  vanish: () => void startOrder.push('vanish'),
  never: () => void startOrder.push('never'),
  // A helper with dials over a made-up table of its own.
  tuned: () => ({ ...tunedTable }),
};

const { DebugMenu } = await import('../../../src/ui/debugMenu.ts');
const { DEBUG_MENU_TUNE } = await import('../../../src/ui/debugModel.ts');
const { readDials } = await import('../../../src/ui/dials.ts');

/** The table the made-up dials move, and the set of them the menu is handed for `tuned`. */
const tunedTable = { a: 2, b: 'x' };
const tunedGroups = [
  {
    title: 'made up',
    note: 'a group of two made-up dials',
    dials: [
      { kind: 'number' as const, key: 'tune.a', label: 'A number', note: 'a made-up number with a range of ten', min: 0, max: 10, step: 0.5, unit: 'm', get: () => tunedTable.a, set: (v: number) => ((tunedTable.a = v), []) },
      { kind: 'choice' as const, key: 'tune.b', label: 'A choice', note: 'a made-up choice of two words', choices: ['x', 'y'] as const, get: () => tunedTable.b, set: (v: string) => ((tunedTable.b = v), [v === 'y' ? 'y takes effect at the next spawn' : '']).filter(Boolean) },
    ],
  },
];
const tunedSet = { helper: 'tuned', groups: tunedGroups, shipped: readDials(tunedGroups) };

const asked = { freed: 0, handedBack: 0, held: [] as number[] };
const parent = new FakeNode('div');
doc.body.append(parent);
const menu = new DebugMenu(parent as unknown as HTMLElement, {
  keys: () => ['Backquote'],
  canOpen: () => true,
  freeMouse: (free) => {
    if (free) asked.freed++;
    else asked.handedBack++;
  },
  holdKeys: (ms) => void asked.held.push(ms),
  dials: (helper) => (helper === 'tuned' ? tunedSet : null),
});
const root = menu.root as unknown as FakeNode;
const panel = root.querySelector('.dbg-panel')!;
const recent = () => panel.querySelector('.dbg-recent')!;
const recentLine = (text: string) => recent().querySelectorAll('.dbg-item').find((b) => b.textContent === text);
const status = () => panel.querySelector('.dbg-status')!.textContent;
const report = () => menu.report() as { picked: string | null; args: string; busy: boolean; runs: number };

// --- the keyboard stays in the window ----------------------------------------------------------------

{
  menu.show();
  ok(menu.open && asked.freed === 1, 'the window opens and asks for the mouse');
  ok(panel.contains(doc.activeElement), 'with the keyboard in it (its search box)');
  await menu.drive({ pick: 'quick', args: '', run: true });
  ok(report().runs === 1 && !!recentLine('quick()'), 'a call run is kept on the Recent list');

  // One click runs it again, and the Recent list is drawn again under the pointer that clicked it.
  const line = recentLine('quick()')!;
  click(line);
  ok(report().runs === 2, 'a Recent line clicked runs its call again');
  ok(!line.isConnected, 'and the line that was clicked has been drawn again, so the button that had the keyboard has left the page');
  ok(doc.activeElement !== doc.body && panel.contains(doc.activeElement), 'but the keyboard is still in the window, not on the page\'s body');
  const heardWas = gameHeard.length;
  press('KeyI');
  press('Digit1');
  press('Enter');
  ok(gameHeard.length === heardWas, `and a key pressed next is the window's, never the game's (the game heard ${gameHeard.length - heardWas})`);

  // The × beside a line takes it off, and draws the list again under itself.
  const row = recentLine('quick()')!.parent!;
  const x = row.querySelector('.dbg-x')!;
  click(x);
  ok(!recentLine('quick()') && panel.contains(doc.activeElement), 'a line taken off with its × leaves the keyboard in the window too');
  press('KeyB');
  ok(gameHeard.length === heardWas, 'so the spawner key pressed after it opens nothing');

  // A pinned line run again is the same list drawn the same way.
  await menu.drive({ pick: 'quick', args: '' });
  click(panel.querySelector('.dbg-pin')!);
  const pin = panel.querySelector('.dbg-pins')!.querySelectorAll('.dbg-item').find((b) => b.textContent === 'quick()')!;
  click(pin);
  ok(!pin.isConnected && panel.contains(doc.activeElement), 'and so does a Pinned line run again');

  // The Run button is disabled under the pointer that pressed it while a call is waited on, and a
  // browser takes the keyboard off a control that can no longer be pressed.
  const runBtn = panel.querySelector('.dbg-run')!;
  await menu.drive({ pick: 'slow', args: '' });
  click(runBtn);
  ok(report().busy && runBtn.disabled, 'Run on a call that answers later leaves the window waiting, its Run button disabled');
  ok(doc.activeElement !== runBtn && panel.contains(doc.activeElement), 'and the keyboard is moved off that button onto the window first');
  finishSlow('done');
  await new Promise((r) => setImmediate(r));
  ok(!report().busy && /slow\(\) · /.test(status()), `and the answer lands (${status()})`);
}

// --- a kept call is not run over one still waited on -------------------------------------------------------

{
  await menu.drive({ pick: 'quick', args: '' });
  await menu.drive({ run: true });
  await menu.drive({ pick: 'slow', args: '' });
  const waiting = menu.run();
  ok(report().busy, 'a call that answers later is being waited on');
  const runsWas = report().runs;
  click(recentLine('quick()')!);
  ok(report().picked === 'slow' && report().args === '', `a Recent line clicked meanwhile neither picks nor fills anything (still ${report().picked})`);
  ok(report().runs === runsWas, 'and runs nothing');
  ok(/still being waited on/.test(status()), `and says why, in words (${status()})`);
  pass(DEBUG_MENU_TUNE.flushMs + 1);
  ok(/still being waited on/.test(status()) && /waiting \d+ s/.test(status()), `the waiting line goes on saying it as the clock moves (${status()})`);
  finishSlow({ fine: true });
  await waiting;
  ok(!report().busy && !/still being waited on/.test(status()) && /slow\(\) · /.test(status()), `the answer lands under the call it answers, and the note goes with the wait (${status()})`);
  click(recentLine('quick()')!);
  ok(report().picked === 'quick' && report().runs === runsWas + 1, 'and once nothing is waited on, the line runs as it always did');

  // Run is disabled while a call is waited on; Enter in the arguments box is the other way to ask.
  await menu.drive({ pick: 'slow', args: '' });
  const again = menu.run();
  const runsNow = report().runs;
  ok(report().busy && !/still being waited on/.test(status()), 'a fresh wait says nothing of a refusal');
  panel.querySelector('.dbg-args')!.focus();
  press('Enter');
  ok(report().runs === runsNow && /still being waited on/.test(status()), `Enter in the box meanwhile is refused the same way, in words (${status()})`);
  finishSlow(1);
  await again;
}

// --- tables and reports keep their columns ----------------------------------------------------------

{
  const lines = () => panel.querySelector('.dbg-lines')!.querySelectorAll('.dbg-line');
  await menu.drive({ pick: 'tabled', args: '', run: true });
  const table = lines().find((l) => l.classList.contains('l-table'));
  const prose = lines().find((l) => l.classList.contains('l-info'));
  ok(!!table && table.classList.contains('l-fixed'), 'a console.table is drawn as a table that does not wrap');
  ok(!!prose && !prose.classList.contains('l-fixed'), 'and a line of prose beside it still wraps');
  await menu.drive({ pick: 'report', args: '', run: true });
  const answer = panel.querySelector('.dbg-out')!.kids[0];
  ok(answer.tagName === 'PRE' && answer.classList.contains('dbg-fixed'), 'an answer of several lines keeps its columns too');
  const sheet = doc.getElementById('debug-menu-style')!.textContent;
  const rule = /\.dbg-line\.l-fixed,\s*\.dbg-out pre\.dbg-fixed\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? '';
  ok(/white-space:\s*pre;/.test(rule) && /word-break:\s*normal/.test(rule), `and the stylesheet draws both unwrapped, so a wide row scrolls sideways (${rule.trim()})`);
  ok(sheet.indexOf('.dbg-line.l-fixed') > sheet.indexOf('.dbg-line {'), 'after the wrapping rule it overrides');
}

// --- the pins run at start ---------------------------------------------------------------------------------
//
// A pin ticked ▷ runs again once the first world is up after a reload, and the safety of it is that it is
// never silent: god mode or a server's day put back at start is said on the message line as it runs. So the
// run is driven here through the menu itself -- in the order pinned, each waited on, a throw and a helper
// gone said in words and stepped over, one pinned but not ticked left alone -- and the tick is clicked.
{
  await menu.drive({ pick: 'first', args: '1', pin: true, atStart: true });
  await menu.drive({ pick: 'second', args: '', pin: true, atStart: true });
  await menu.drive({ pick: 'boom', args: '', pin: true, atStart: true });
  await menu.drive({ pick: 'vanish', args: '', pin: true, atStart: true });
  await menu.drive({ pick: 'never', args: '', pin: true });
  const rep = () => menu.report() as { atStart: string[]; ranAtStart: string[] | null; pinned: string[] };
  ok(rep().atStart.join(' ') === 'first(1) second() boom() vanish()', `four pins are ticked to run at start, in the order pinned, and the fifth is only pinned (${rep().atStart.join(' ')})`);
  const kept = [...store.values()].find((v) => v.includes('"pinned"')) ?? '';
  ok((kept.match(/"atStart":true/g) ?? []).length === 4, 'and the ticks are kept with the pins, so a reload finds them');
  delete (win.__debug as Record<string, unknown>).vanish;
  const said: string[] = [];
  const running = menu.runAtStart((line) => void said.push(line));
  await new Promise((r) => setImmediate(r));
  ok(startOrder.join(', ') === 'first 1, second began', `they run in the order pinned, and one that answers later is waited on before the next begins (${startOrder.join(', ')})`);
  ok(said.length === 0, 'and nothing is said until the run is over');
  finishSecond();
  const ran = await running;
  ok(startOrder.join(', ') === 'first 1, second began, second done, boom', `the rest follow once it answers, and the one only pinned never runs (${startOrder.join(', ')})`);
  ok(ran.length === 4 && /threw: kaboom/.test(ran[2]) && /there is no vanish now/.test(ran[3]), `a throw and a helper that has gone are said in words and stepped over (${ran.join(' | ')})`);
  ok(said.length === 1 && ['__debug.first(1)', '__debug.second()', 'kaboom', 'vanish'].every((w) => said[0].includes(w)), `and the whole run is said once on the message line, naming every call: nothing is put back silently (${said[0]})`);
  ok(JSON.stringify(rep().ranAtStart) === JSON.stringify(ran), "the console's report says what the run came to");

  // The tick beside a pin, clicked: on, kept, and off again.
  const rowOf = (text: string) => panel.querySelector('.dbg-pins')!.querySelectorAll('.dbg-saved').find((r) => r.querySelector('.dbg-item')?.textContent === text);
  const tick = () => rowOf('never()')!.querySelector('.dbg-start')!;
  ok(!tick().classList.contains('on') && tick().textContent === '▷', 'a pin not ticked shows the open mark');
  click(tick());
  ok(tick().classList.contains('on') && tick().textContent === '▶' && rep().atStart.includes('never()'), 'clicked, it is ticked to run at start');
  ok(/"helper":"never"[^}]*"atStart":true/.test([...store.values()].find((v) => v.includes('"pinned"')) ?? ''), 'and the tick is saved at once');
  click(tick());
  ok(!tick().classList.contains('on') && !rep().atStart.includes('never()'), 'clicked again, it is not');
  ok(panel.contains(doc.activeElement), 'and the keyboard stays in the window through both');

  // Where main.ts runs them: once a page, after the first world's loading screen has lifted, on the message line.
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/await this\.loadingScreen\.hide\(\);[\s\S]{0,400}if \(!this\.ranAtStart\) \{\s*this\.ranAtStart = true;\s*void this\.debugMenu\.runAtStart\(\(line\) => this\.messages\.system\(line\)\);/.test(main), 'the game runs the ticked pins once a page, after the first loading screen lifts, and says them on the message line');
}

// --- the dials -----------------------------------------------------------------------------------------------
//
// A helper with dials shows them as sliders in place of the arguments box. Everything here goes through the
// window's own rows and buttons, with events delivered as a browser would deliver them.
{
  const fire = (n: FakeNode, type: string) => n.deliver({ type, target: n, stopped: false, stoppedNow: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} } as FakeEvent);
  const q = (cls: string) => panel.querySelector(`.${cls}`)!;
  const hidden = (cls: string) => q(cls).classList.contains('hidden');
  const dialRep = () => (menu.report() as { dials: { shown: string; moved: string[]; line: string | null } | null; atStart: string[] }).dials;

  await menu.drive({ pick: 'quick', args: '' });
  ok(!panel.querySelector('.dbg-mode') && hidden('dbg-dials') && hidden('dbg-dialbar') && !hidden('dbg-callrow'), 'a helper with no dials shows its arguments box and no sliders');
  ok((menu.report() as { dials: unknown }).dials === null, 'and the report says it has none');

  await menu.drive({ pick: 'tuned' });
  ok(!hidden('dbg-dials') && !hidden('dbg-dialbar') && hidden('dbg-callrow') && hidden('dbg-doc'), 'a helper with dials shows its sliders in place of the arguments box');
  ok(panel.querySelectorAll('dbg-dial').length === 2 && q('dbg-gnote').textContent === 'a group of two made-up dials', 'a row for each dial, under its group and its group\'s words');
  ok(q('dbg-dcount').textContent === 'as shipped' && (q('dbg-dresetall') as FakeNode).disabled && (q('dbg-dpin') as FakeNode).disabled, 'nothing has moved: the bar says so and its buttons wait');

  // The slider, moved: on its step, through the dial, the row and the bar written again.
  const range = q('dbg-range');
  const box = q('dbg-dv');
  range.value = '7.3';
  fire(range, 'input');
  ok(tunedTable.a === 7.5, `the slider sets its number through the dial, on its step (${tunedTable.a})`);
  ok(box.value === '7.5' && q('dbg-du').textContent === 'm', 'the box beside it shows the number, and its unit after it');
  const row = panel.querySelectorAll('dbg-dial')[0];
  ok(row.classList.contains('moved') && !q('dbg-dreset').classList.contains('off'), 'the row says it has moved, and its ↺ shows');
  ok(q('dbg-dcount').textContent === '1 moved' && q('dbg-dline').value === '__debug.tuned({ tune: { a: 7.5 } })', `the bar counts it and writes the line that sets it again (${q('dbg-dline').value})`);
  ok(/A number: 7\.5 m/.test(status()), `and the status line says what it is now (${status()})`);

  // A number typed: past the slider, as far as the dial's helper allows; and nonsense typed puts the box back.
  box.value = '12.25';
  fire(box, 'change');
  ok(tunedTable.a === 12.25 && box.value === '12.25', 'a number typed into the box may go past the slider, and is shown as it was set');
  box.value = 'twelve';
  fire(box, 'change');
  ok(tunedTable.a === 12.25 && box.value === '12.25', 'what is not a number sets nothing, and the box shows the number again');

  // A choice clicked; what its helper says is said.
  const y = panel.querySelectorAll('dbg-choice').find((b) => b.textContent === 'y')!;
  click(y);
  ok(tunedTable.b === 'y' && y.classList.contains('on'), 'a choice clicked is set, and lit');
  ok(/next spawn/.test(status()) && q('dbg-status').classList.contains('warn'), `and what the helper said of it is said (${status()})`);
  ok(JSON.stringify(dialRep()?.moved) === JSON.stringify(['tune.a 12.25 m', 'tune.b y']), `the console's report names what has moved (${dialRep()?.moved.join(', ')})`);

  // The keys stay the window's with a slider holding them, and the menu's own key shuts it from one.
  range.focus();
  const heardWas = gameHeard.length;
  press('KeyW');
  press('ArrowLeft');
  ok(gameHeard.length === heardWas, 'a key pressed on a slider is the window\'s, never the game\'s');

  // One row's ↺, then Reset all.
  click(panel.querySelectorAll('dbg-dreset')[1]);
  ok(tunedTable.b === 'x' && tunedTable.a === 12.25, 'a row\'s ↺ puts that dial back, and only it');
  click(q('dbg-dresetall'));
  ok(tunedTable.a === 2 && tunedTable.b === 'x' && q('dbg-dcount').textContent === 'as shipped' && q('dbg-dline').value === '', 'Reset all puts every dial back where it shipped');
  ok(panel.contains(doc.activeElement), 'and the keyboard stays in the window as its button is disabled under it');

  // Copy with no clipboard: the line is selected for Ctrl+C. Pin at start: pinned and ticked.
  range.value = '4';
  fire(range, 'input');
  await menu.drive({});
  click(q('dbg-dcopy'));
  await new Promise((r) => setImmediate(r));
  ok(/the clipboard said no/.test(status()) && doc.activeElement === q('dbg-dline'), `with no clipboard the line is selected for Ctrl+C (${status()})`);
  click(q('dbg-dpin'));
  ok((menu.report() as { atStart: string[] }).atStart.includes('tuned({ tune: { a: 4 } })'), 'Pin at start pins the line and ticks it to run at start');

  // Console, and back.
  const modes = () => panel.querySelectorAll('dbg-mode-b');
  click(modes().find((b) => b.textContent === 'Console')!);
  ok(hidden('dbg-dials') && !hidden('dbg-callrow') && dialRep()?.shown === 'console', 'Console shows the arguments box in place of the sliders');
  click(modes().find((b) => b.textContent === 'Sliders')!);
  ok(!hidden('dbg-dials') && hidden('dbg-callrow') && dialRep()?.shown === 'sliders', 'and Sliders shows them again');

  // The menu's key shuts the window from a slider; a number the console moves meanwhile is read on opening.
  q('dbg-range').focus();
  press('Backquote', '`');
  ok(!menu.open, 'the menu\'s own key shuts the window from a slider, which types nothing');
  tunedTable.a = 9;
  menu.show();
  ok(q('dbg-dv').value === '9.0' && q('dbg-range').value === '9', `opened again, the sliders read what the console moved while it was shut (${q('dbg-dv').value})`);

  // The console's own handle moves a dial as its slider would.
  await menu.drive({ dial: { key: 'tune.a', value: 3.2 } });
  ok(tunedTable.a === 3, `__debug.debugMenu({ dial }) moves a dial on its step, as the slider would (${tunedTable.a})`);
  await menu.drive({ resetDials: true });
  ok(tunedTable.a === 2, 'and { resetDials: true } is Reset all');
}

// --- shutting it -------------------------------------------------------------------------------------------

{
  const handedWas = asked.handedBack;
  panel.focus();
  press('Escape');
  ok(!menu.open, 'Escape shuts it');
  ok(asked.handedBack === handedWas + 1 && asked.held.at(-1) === DEBUG_MENU_TUNE.escapeHoldMs, "and gives the mouse back, holding the game's keys aside a moment");
}

// --- where the mouse goes, in main.ts ------------------------------------------------------------------------
//
// Node cannot load main.ts, so what it hands the window is read. The window may be opened over a tab
// panel or the map, since they are often what it is opened to look at; the mouse going back must
// therefore go through the game's own check rather than lock the pointer under whatever is still up.
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = (from: string) => {
    const at = main.indexOf(from);
    return at < 0 ? '' : main.slice(at, main.indexOf('\n    });', at));
  };
  const handBack = /freeMouse: \(free\) => \(free \? this\.freeMouse\(true\) : this\.handBackMouse\(\)\)/;
  ok(handBack.test(block('this.debugMenu = new DebugMenu(')), 'the debug menu gives the mouse back through handBackMouse, never straight to the pointer lock');
  // The group's roster is a tab of the map now: the map holds the mouse over it, so it is handed no way to
  // take the mouse or give it back, and it is not one of the windows that hold it without being a panel.
  const roster = block('const groupUi = new GroupUi(');
  ok(/canOpen: \(\) =>/.test(roster) && !/freeMouse/.test(roster), "the group's roster, a tab of the map, takes and gives back no mouse of its own");
  ok(/elseHasMouse: \(\) => this\.anyPanelOpen\(\) \|\| this\.map\.open \|\| this\.mouseHeldElsewhere\(\)/.test(block('const tradeUi = new TradeUi(')), 'the trade window counts the windows that hold the mouse without being panels before handing it back');
  // (And the world editor's Point mode, which `editorWiring.test.ts` holds.)
  ok(/this\.mouseHeldElsewhere = \(\) => tradeUi\.open \|\| this\.debugMenu\.open \|\| this\.talkNow !== null(?: \|\| !!this\.editor\?\.point)?;/.test(main), 'and the debug menu is one of them, and so is a conversation; the group roster no longer is');
  const hb = /private handBackMouse\(\): void \{\n\s*if \(this\.anyPanelOpen\(\) \|\| this\.map\.open \|\| this\.mouseHeldElsewhere\(\)\) return;\n\s*this\.freeMouse\(false\);/;
  ok(hb.test(main), 'handBackMouse leaves the mouse where it is while a panel, the map or one of those windows is up');
}

menu.dispose();
console.log(`\n${checks} checks passed`);
