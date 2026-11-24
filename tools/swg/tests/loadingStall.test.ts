// A loading screen never hangs silently, and a lost graphics device is said on the screen (the GPU port's pass 2, wave 6:
// maker K's patch for the owner's Mac; this suite is the wave's fixer's, the checker's finding that nobody had seen the give-up
// and no test held it). Under node, the game's own code on stand-ins:
//   1. the loading screen (`src/ui/loading.ts`) on a stand-in page with its own clock: past `LOADING_TUNE.stallSayMs` with
//      neither its words nor its bar moving, its line says how long it has waited and on what, and the console says it at
//      that interval; a word or the bar moving starts the count again; a screen going stands still no more;
//   2. the bound on a settle (`src/ui/stillBound.ts`, `main.ts`' `App.stillBound`): a settle that answers is let be; one whose
//      screen stands still past `stepGiveUpMs` is given up on with words naming the wait, and finishes on its own;
//   3. a lost device (`src/ui/deviceLost.ts`): the words, and the overlay on a stand-in document with its Reload button
//      focused and working, shown once a page; `start.ts` hands three's loss to it after three's own word.
//
// Run: node tools/swg/tests/loadingStall.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => readFileSync(ROOT + p, 'utf8');

// ---------------------------------------------------------------- a stand-in page: elements, a clock, timers by hand
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
class El {
  tag: string;
  id = '';
  className = '';
  textContent: string | null = '';
  hidden = false;
  src = '';
  type = '';
  width = 1600;
  height = 900;
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: El[] = [];
  focused = false;
  listeners: Record<string, ((e: Any) => void)[]> = {};
  private kids = new Map<string, El>();
  classList = {
    set: new Set<string>(),
    add: (c: string) => this.classList.set.add(c),
    remove: (c: string) => this.classList.set.delete(c),
    contains: (c: string) => this.classList.set.has(c),
  };
  constructor(tag: string) {
    this.tag = tag;
  }
  set innerHTML(_html: string) {
    this.kids.clear();
  }
  querySelector(sel: string): El {
    let k = this.kids.get(sel);
    if (!k) {
      k = new El(sel);
      this.kids.set(sel, k);
    }
    return k;
  }
  appendChild(c: El): El {
    this.children.push(c);
    return c;
  }
  append(...cs: El[]): void {
    this.children.push(...cs);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  addEventListener(kind: string, f: (e: Any) => void): void {
    (this.listeners[kind] ??= []).push(f);
  }
  getContext(): null {
    return null;
  }
  focus(): void {
    this.focused = true;
  }
  click(): void {
    for (const f of this.listeners.click ?? []) f({});
  }
}
let clock = 1000;
const intervals: (() => void)[] = [];
const doc = { createElement: (t: string) => new El(t), body: new El('body'), pointerLockElement: null, exitPointerLock() {} };
const g = globalThis as Any;
g.document = doc;
g.window = { setInterval: (f: () => void) => intervals.push(f), clearInterval() {} };
g.requestAnimationFrame = () => 1;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
const warned: string[] = [];
const warnWas = console.warn;
console.warn = (...a: unknown[]) => void warned.push(a.map(String).join(' '));

const { LoadingScreen } = await import('../../../src/ui/loading.ts');
const { LOADING_TUNE } = await import('../../../src/world/loadingTune.ts');
const { stillBound } = await import('../../../src/ui/stillBound.ts');
const { lostWords, showDeviceLost } = await import('../../../src/ui/deviceLost.ts');

// ---------------------------------------------------------------- 1. the stall's words
{
  ok(LOADING_TUNE.stallSayMs === 15000 && LOADING_TUNE.stepGiveUpMs === 120000, 'the stall is said after 15 s and given up on after 120 s (the patch\'s bounds)');
  const parent = new El('ui');
  const screen = new LoadingScreen(parent as Any, '/');
  const what = (screen as Any).what as El;
  screen.show(null, 'Tatooine', 'the buildings and the props');
  const tick = (): void => {
    for (const f of intervals) f();
  };
  ok(intervals.length === 1 && what.textContent === 'the buildings and the props' && screen.stillMs() === 0, 'a screen shown says what it waits for, its watch on a once-a-second timer');
  clock += 14000;
  tick();
  ok(what.textContent === 'the buildings and the props' && warned.length === 0 && screen.stillMs() === 14000, 'under 15 s of standing still nothing more is said');
  clock += 2000;
  tick();
  ok(what.textContent === 'the buildings and the props, waiting 16 s', `past 15 s the line says how long: "${what.textContent}"`);
  ok(warned.length === 1 && warned[0] === 'loading: 0%, still waiting for the buildings and the props after 16 s', `and the console names the wait: "${warned[0]}"`);
  clock += 5000;
  tick();
  ok(what.textContent === 'the buildings and the props, waiting 21 s' && warned.length === 1, 'the line counts on each second; the console waits out its interval');
  clock += 10000;
  tick();
  ok(warned.length === 2 && warned[1].endsWith('after 31 s'), `the console says it again at the interval: "${warned[1]}"`);
  screen.setWhat("the people's shaders");
  ok(what.textContent === "the people's shaders" && screen.stillMs() === 0 && screen.waitingFor === "the people's shaders", 'new words start the count again');
  clock += 16000;
  tick();
  ok(what.textContent === "the people's shaders, waiting 16 s", 'and the next still stretch is said by its own words');
  screen.setProgress(0.4);
  ok(screen.stillMs() === 0, 'the bar moving starts the count again too');
  clock += 3000;
  screen.setProgress(0.4);
  ok(screen.stillMs() === 3000, 'the bar asked to stand where it stands is no move');
  (screen as Any).hiding = true;
  ok(screen.stillMs() === 0, 'a screen going stands still no more');
}

// ---------------------------------------------------------------- 2. the bound on a settle
{
  const keep = LOADING_TUNE.stepGiveUpMs;
  const said: string[] = [];
  const say = (l: string): void => void said.push(l);
  // a settle that answers is let be
  const quick = await stillBound(new Promise<void>((r) => setTimeout(r, 30)), { stillMs: () => 0, waitingFor: 'the effects' }, say);
  ok(quick === 'done' && said.length === 0, 'a settle that answers is let be, nothing said');
  // one whose screen stands still past the bound is given up on, with words naming the wait
  LOADING_TUNE.stepGiveUpMs = 1500;
  let finished = false;
  const slow = new Promise<void>((r) =>
    setTimeout(() => {
      finished = true;
      r();
    }, 3500),
  );
  let still = 0;
  const t0 = Date.now();
  const given = await stillBound(slow, { stillMs: () => (still += 1000), waitingFor: 'the effects' }, say);
  const took = Date.now() - t0;
  ok(given === 'given up' && !finished && took >= 900 && took < 3400, `a screen standing still past the bound is given up on (after ${took} ms of a 1.5 s bound read once a second), the settle not yet done`);
  ok(said.length === 1 && said[0] === 'loading: gave up waiting for the effects after 2 s with nothing moving; it finishes in play', `the words name the wait: "${said[0]}"`);
  await slow;
  ok(finished, 'and the settle finishes on its own after');
  LOADING_TUNE.stepGiveUpMs = keep;
  const main = read('src/main.ts');
  ok(/return await this\.stillBound\(this\.settle\(timeoutMs\)\);/.test(main) && /await stillBound\(work, this\.loadingScreen, \(line\) => \{\r?\n\s+console\.warn\(line\);\r?\n\s+this\.messages\.system\(line\);\r?\n\s+\}\);/.test(main), "the game's settle runs under the bound, its words to the console and the message line");
}

// ---------------------------------------------------------------- 3. a lost device
{
  const w = lostWords({ reason: 'unknown', message: 'A valid external Instance reference no longer exists.' });
  ok(w.title === 'The graphics device was lost' && w.why.includes('reason: unknown; A valid external Instance reference no longer exists.') && w.next.startsWith('Reload'), 'the words say what went, why the browser said, and the way back');
  const none = lostWords(null);
  ok(none.why.includes('reason: unknown; no message'), 'no record from the browser still says something');
  ok(lostWords({ message: 'x'.repeat(900) }).why.length < 450, "the browser's message is cut to 300 characters");
  let reloads = 0;
  const errs: string[] = [];
  const errWas = console.error;
  console.error = (...a: unknown[]) => void errs.push(a.map(String).join(' '));
  const root = showDeviceLost({ reason: 'unknown', message: 'gone' }, doc as Any, () => reloads++) as unknown as El;
  console.error = errWas;
  const box = root.children[0];
  const btn = box?.children[3];
  ok(root.attrs.role === 'alertdialog' && doc.body.children.includes(root) && /z-index:2147483000/.test((root.style as Any).cssText), 'the overlay stands over everything on the page');
  ok(!!btn && btn.textContent === 'Reload' && btn.focused, 'its Reload button is focused, so Enter reloads');
  btn.click();
  ok(reloads === 1, 'and the button reloads');
  ok(errs.length === 1 && errs[0].startsWith('graphics: the graphics device was lost'), 'the console is told once');
  ok(showDeviceLost({ reason: 'again' }, doc as Any, () => reloads++) === (root as Any) && doc.body.children.length === 1, 'a second loss changes nothing: one overlay a page');
  const start = read('src/core/gpu/start.ts');
  ok(/renderer\.onDeviceLost = \(info: Any\) => \{\r?\n\s+onLost\?\.\(info\);\r?\n\s+showDeviceLost\(info\);\r?\n\s+\};/.test(start), "three's loss reaches the screen after three's own word");
}

console.warn = warnWas;
console.log(`\nloadingStall: ${checks} checks passed`);
