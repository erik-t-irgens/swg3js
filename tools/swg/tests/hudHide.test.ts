// The hide key (the GPU port's pass 1, wave 1, item 8, and item 9's help panel that gave it H): `hideHud` on H in the
// bindings, its Controls row, a saved choice for the old `help` dropped on load, the editor's gate; the interface's
// pieces skipping every write while hidden and closing their second of writes on time all the same (`rest`), so the
// counters the console reads say 0 for a hidden second; every "written when changed" record let go on the way back
// (`refresh`), so a bar that moved while hidden comes back where it is and an unchanged one is written afresh too, and every
// two-state record (a row up, a cell lit, a block standing) read back from the page, each held by a case where its truth
// turned while hidden, which a record turned over instead of read back fails (each such flip was tried and failed here); the
// game's wiring that does this, read as text since `main.ts` cannot be run in node; the stylesheet's rule, held to the
// list of what goes and what stays; and in twelve fresh processes at once, nothing allocated by a hidden frame's calls.
//
// Everything here is synthetic: stand-ins for the page, a made-up kit and made-up numbers. Nothing is read from the
// game's files. Run: node tools/swg/tests/hudHide.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = (rel: string) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- the stand-in page: every write counted
const count = { writes: 0 };
type Any = any;

/** A style: every property set and every custom property counted. */
function styleOf(): Record<string, string> {
  const bag: Record<string, Any> = {
    setProperty(name: string, value: string) {
      count.writes++;
      bag[name] = String(value);
    },
  };
  return new Proxy(bag, {
    set(t, k, v) {
      count.writes++;
      t[String(k)] = String(v);
      return true;
    },
    get(t, k) {
      const v = t[String(k)];
      return v === undefined ? '' : v;
    },
  }) as Record<string, string>;
}

/** A canvas's 2D context: anything asked of it does nothing and answers nothing. */
function context(): Any {
  return new Proxy(
    {},
    {
      get: (_t, k) => (k === 'canvas' ? null : () => undefined),
      set: () => true,
    },
  );
}

/** An element: its words, markup, classes, hidden and style, each write counted (`count`) and each one's own too (`n`). */
class El {
  n = 0;
  readonly style = styleOf();
  readonly kids: El[] = [];
  private readonly found = new Map<string, El>();
  private readonly names = new Set<string>();
  private words = '';
  private html = '';
  private hiddenNow = false;
  id = '';
  width = 0;
  height = 0;
  private write(): void {
    count.writes++;
    this.n++;
  }
  readonly classList = {
    toggle: (name: string, on?: boolean) => {
      this.write();
      const want = on === undefined ? !this.names.has(name) : on;
      if (want) this.names.add(name);
      else this.names.delete(name);
      return want;
    },
    add: (...names: string[]) => {
      this.write();
      for (const x of names) this.names.add(x);
    },
    remove: (...names: string[]) => {
      this.write();
      for (const x of names) this.names.delete(x);
    },
    contains: (name: string) => this.names.has(name),
  };
  get className(): string {
    return [...this.names].join(' ');
  }
  set className(v: string) {
    this.write();
    this.names.clear();
    for (const x of String(v).split(/\s+/)) if (x) this.names.add(x);
  }
  get textContent(): string {
    return this.words;
  }
  set textContent(v: string) {
    this.write();
    this.words = String(v);
  }
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(v: string) {
    this.write();
    this.html = String(v);
  }
  get hidden(): boolean {
    return this.hiddenNow;
  }
  set hidden(v: boolean) {
    this.write();
    this.hiddenNow = !!v;
  }
  setAttribute(): void {
    this.write();
  }
  appendChild(k: El): El {
    this.kids.push(k);
    return k;
  }
  append(...k: El[]): void {
    for (const x of k) this.kids.push(x);
  }
  prepend(k: El): void {
    this.kids.unshift(k);
  }
  insertBefore(k: El): El {
    this.kids.unshift(k);
    return k;
  }
  after(): void {}
  remove(): void {}
  get firstChild(): El | null {
    return this.kids[0] ?? null;
  }
  get firstElementChild(): El | null {
    return this.kids[0] ?? null;
  }
  querySelector(sel: string): El {
    let hit = this.found.get(sel);
    if (!hit) {
      hit = new El();
      this.found.set(sel, hit);
    }
    return hit;
  }
  querySelectorAll(): El[] {
    return [];
  }
  getContext(): Any {
    return context();
  }
  getBoundingClientRect() {
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, Any>;
g.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
g.window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
g.document = {
  createElement: () => new El(),
  head: new El(),
  documentElement: new El(),
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
  pointerLockElement: null,
  exitPointerLock() {},
};
// The clock every piece reads, stood in: whole milliseconds, moved only by the test.
const clock = { now: 100000 };
const realNow = performance.now.bind(performance);
const realDateNow = Date.now;
const standClock = (on: boolean) => {
  Object.defineProperty(performance, 'now', { value: on ? () => clock.now : realNow, configurable: true, writable: true });
  Date.now = on ? () => clock.now : realDateNow;
};

/** Writes made by `what`. */
function writes(what: () => void): number {
  count.writes = 0;
  what();
  return count.writes;
}

/** A made-up kit: two slots, a pool, a cooldown moved by hand. */
function testKit(): Any {
  return {
    id: 'jedi',
    name: 'Jedi',
    slots: [
      { key: '1', name: 'Force jump', cost: '20' },
      { key: '2', name: 'Force speed', cost: '5/s' },
    ],
    resource: { label: 'Force', value: 60, max: 100 },
    lit: false,
    cd: 0,
    slotActive(i: number) {
      return i === 1 && this.lit;
    },
    slotCooldown(i: number) {
      return i === 0 ? this.cd : 0;
    },
    charge: () => 0,
  };
}

const { DEFAULT_BINDINGS, DEV_ONLY_ACTIONS, Input, controlsActions, chosenBindings } = await import('../../../src/core/input.ts');
const { EDITOR_MUTES } = await import('../../../src/editor/editorKeys.ts');
const { Hud, HUD_HIDDEN_CLASS, Roster } = await import('../../../src/ui/hud.ts');
const { ShipHud, newFlightView, newTargetView } = await import('../../../src/ui/shipHud.ts');
const { Minimap } = await import('../../../src/ui/minimap.ts');
const { Tracker } = await import('../../../src/ui/tracker.ts');
const { CourseLabels } = await import('../../../src/ui/courseLabels.ts');
const THREE = await import('three');

// ---------------------------------------------------------------- 5 (child). what a hidden frame's calls allocate, alone
if (process.argv.includes('--alloc')) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const window_ = async (step: () => void, n: number): Promise<number> => {
    for (let tries = 0; tries < 6; tries++) {
      for (let i = 0; i < 4000; i++) step();
      gc({ type: 'minor' });
      await turn();
      await turn();
      const c0 = collections;
      const b = young();
      for (let i = 0; i < n; i++) step();
      const a = young();
      await turn();
      await turn();
      if (collections === c0) return (a - b) / n;
    }
    return NaN;
  };
  standClock(true);
  const kit = testKit();
  const hud = new Hud(new El() as Any);
  hud.setKit(kit);
  for (let i = 0; i < 30; i++) {
    clock.now += 16;
    hud.update(0.016, 1, 2, 3, kit, 80, 100, '12:00', '', false);
  }
  const roster = new Roster(new El() as Any);
  const ship = new ShipHud(new El() as Any);
  const out: Record<string, number> = {};
  // The clock moves by whole milliseconds, so the stand-in hands back a small integer and the measure is of the pieces'
  // own code: the browser's clock is the browser's.
  out.hud = await window_(() => {
    clock.now += 16;
    hud.rest();
  }, 20000);
  out.roster = await window_(() => {
    clock.now += 16;
    roster.rest();
  }, 20000);
  out.ship = await window_(() => {
    clock.now += 16;
    ship.rest();
  }, 20000);
  console.log(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------- 1. the key, its row, the old help's choice, the editor
{
  ok(DEFAULT_BINDINGS.hideHud.join() === 'KeyH', 'the hide key is H by default');
  ok(!Object.hasOwn(DEFAULT_BINDINGS, 'help'), 'and the help panel has no action any more');
  const keys = Object.keys(DEFAULT_BINDINGS);
  ok(keys.indexOf('hideHud') === keys.indexOf('map') + 1, "it stands in the table where the help did, after the map's");
  const onH = keys.filter((a) => (DEFAULT_BINDINGS as Record<string, string[]>)[a].includes('KeyH'));
  ok(onH.sort().join() === 'editorKeys,hideHud' && DEV_ONLY_ACTIONS.has('editorKeys' as Any) && !DEV_ONLY_ACTIONS.has('hideHud' as Any), "H is shared only with the world editor's key list, the dev server's alone");
  ok(controlsActions(false).includes('hideHud' as Any) && controlsActions(true).includes('hideHud' as Any), 'it has a row on the Controls page, in a release and on the dev server');
  const menu = text('src/ui/menu.ts');
  ok(/\n  hideHud: '[^']+',\n/.test(menu) && !/\n  help: '/.test(menu), "the Controls page's words for it, and none for the help any more");
  ok((EDITOR_MUTES as readonly string[]).includes('hideHud') && !(EDITOR_MUTES as readonly string[]).includes('help') && EDITOR_MUTES.length === 43, "the editor's mute list names the hide key where it named the help, and is still 43 actions");

  // A choice a player kept for the old help: dropped on load without a word, taking no key from anybody.
  store.clear();
  store.set('swg3js.bindings', JSON.stringify({ help: ['KeyQ'], map: ['KeyK'] }));
  const warned: string[] = [];
  const warn = console.warn;
  const error = console.error;
  console.warn = (m: unknown) => void warned.push(String(m));
  console.error = (m: unknown) => void warned.push(String(m));
  let input: Any = null;
  let threw: unknown = null;
  try {
    input = new Input({} as HTMLCanvasElement);
  } catch (e) {
    threw = e;
  } finally {
    console.warn = warn;
    console.error = error;
  }
  ok(!threw && warned.length === 0, 'a saved choice for the help is read without an error or a warning');
  ok(!Object.hasOwn(input.bindings, 'help') && input.bindings.map.join() === 'KeyK' && input.bindings.altFire.includes('KeyQ') && input.bindings.hideHud.join() === 'KeyH', 'and dropped: the other choice stands, Q stays the other trigger\'s and H the hide key\'s');
  ok(Object.keys(chosenBindings({ help: ['KeyH'] })).length === 0, 'a saved help on H is no choice either');
  input.bind('jump', ['KeyK']);
  const kept = JSON.parse(store.get('swg3js.bindings') ?? '{}');
  ok(!Object.hasOwn(kept, 'help') && kept.jump?.join() === 'KeyK', 'and the next save writes it out of storage for good');

  // Rebound like any other, across a reload; and the key it left is free.
  store.clear();
  const a = new Input({} as HTMLCanvasElement);
  a.assignKey('hideHud', ['F1'], 'F1');
  const b = new Input({} as HTMLCanvasElement);
  ok(a.bindings.hideHud.join() === 'F1' && b.bindings.hideHud.join() === 'F1', 'the Controls page rebinds it (F1 here), and a reload keeps that');
  b.force('KeyH', true);
  const onOld = b.pressedAction('hideHud');
  b.endFrame();
  b.force('KeyH', false);
  b.force('F1', true);
  const onNew = b.pressedAction('hideHud');
  b.endFrame();
  ok(!onOld && onNew, 'H then does nothing for it and F1 hides');
  b.mute(EDITOR_MUTES);
  b.force('F1', false);
  b.force('F1', true);
  ok(!b.pressedAction('hideHud'), "and the editor's mutes mute it too");
  store.clear();

  // The game's wiring of the key: read where the help was, never while the editor is on, and the editor coming on
  // shows the interface again (H is its key list there, so the hide key could not bring it back).
  const main = text('src/main.ts');
  ok(!/pressedAction\('help'\)|toggleHelp/.test(main), 'nothing reads the help action or opens the help block');
  ok(/if \(this\.editor\?\.on\) \{\n\s+if \(this\.hudHidden\) this\.setHudHidden\(false\);\n\s+\} else if \(input\.pressedAction\('hideHud'\)\) this\.setHudHidden\(!this\.hudHidden\);/.test(main), "the key is read only while the world editor is off, and the editor coming on shows the interface again");
  ok(main.indexOf("if (input.pressedAction('ship')) this.toggleShipMenu();") < main.indexOf("input.pressedAction('hideHud')") && main.indexOf("input.pressedAction('hideHud')") < main.indexOf("if (input.pressedAction('waypoints')"), "read in play's own key block, where the help was");
  ok(/private hudHidden = false;/.test(main) && !/hudHidden[^\n]*localStorage|localStorage[^\n]*hudHidden/.test(main), 'hidden is not kept across a reload');
}

// ---------------------------------------------------------------- 2. the pieces: nothing written while hidden, counters on time
standClock(true);
{
  const parent = new El();
  const hud = new Hud(parent as Any);
  const root = parent.kids[0] as El;
  // The stand-in reads no markup, so it plays the markup's part: the breath row starts `hidden`, the stamina row `off gone`.
  root.querySelector('.breath-row').hidden = true;
  root.querySelector('.stamina-row').classList.add('off', 'gone');
  const kit = testKit();
  hud.setKit(kit);
  let hp = 80;
  const frame = () => {
    clock.now += 16;
    hud.update(0.016, 1234, 5, -77, kit, hp, 100, '12:00', '', false);
  };
  for (let i = 0; i < 150; i++) frame();
  ok(hud.stats().byDesign > 0 && hud.stats().writes === 0, `shown and steady, the display's quarter-second lines write every second, by design, and nothing else (${hud.stats().byDesign} by design last second)`);
  // Hidden: `rest` in `update`'s place, for well over a second.
  const hidden = writes(() => {
    for (let i = 0; i < 140; i++) {
      clock.now += 16;
      hud.rest();
    }
  });
  const s = hud.stats();
  ok(hidden === 0, `hidden, the display writes nothing to the page over 2.2 s (${hidden})`);
  ok(s.writes === 0 && s.byDesign === 0 && s.writesNow === 0 && s.byDesignNow === 0, `and its own counters say so for the hidden second, the quarter-second lines included (writes ${s.writes}, by design ${s.byDesign})`);
  // While hidden the health falls and the pool fills; shown again, the first frame writes both where they are now,
  // and the ones that did not move are written afresh too.
  hp = 35;
  kit.resource.value = 100;
  const fill = root.querySelector('.hud-bar.hp > .fill');
  const hpText = root.querySelector('.hp-val');
  const fps = root.querySelector('.fps');
  const loc = root.querySelector('.loc');
  const clockEl = root.querySelector('.clock');
  const slot0 = root.querySelector('.hud-bar.pool > .fill');
  const before = { hp: hpText.n, fps: fps.n, loc: loc.n, clock: clockEl.n, fill: fill.n };
  hud.refresh();
  const back = writes(() => frame());
  ok(back > 6 && fill.style.transform === 'scaleX(0.35)' && hpText.textContent === 'Health 35', `shown again, the first frame writes the bar that moved while hidden where it is (${fill.style.transform}, ${hpText.textContent}; ${back} writes)`);
  ok(root.querySelector('.res-val').textContent === 'Force 100' && slot0.style.transform === 'scaleX(1)', 'and the pool that filled while hidden');
  ok(fps.n > before.fps && loc.n > before.loc && clockEl.n > before.clock && /^\d+ fps$/.test(fps.textContent) && fps.textContent !== '0 fps', `the quarter-second lines on that very frame, the frame rate a real one (${fps.textContent}, ${loc.textContent})`);
  for (let i = 0; i < 130; i++) frame();
  ok(hud.stats().writes === 0, `and then it is steady again: a whole second of nothing but the lines that are meant to be written (no ghost walking down after a blow it never showed: ${hud.stats().writes})`);
  // An unchanged value written afresh after a refresh: the record was let go, not only the moved ones.
  for (let i = 0; i < 120; i++) frame();
  const hpN = hpText.n;
  hud.refresh();
  frame();
  ok(hpText.n === hpN + 1 && hpText.textContent === 'Health 35', `with nothing moved, a refresh still has the next frame write every value afresh (the health line once more: ${hpText.n - hpN})`);
  const hpAfter = hpText.n;
  for (let i = 0; i < 10; i++) frame();
  ok(hpText.n === hpAfter, 'and the frames after write it no more, as before');
  // Two-state records whose truth changed while hidden: the breath row comes up (gone under water) and the pool goes
  // (another kit) while nothing is written; shown again, both are written as they now stand.
  const breathRow = root.querySelector('.breath-row');
  const resRow = root.querySelector('.res-row');
  ok(breathRow.hidden && !resRow.hidden, 'on dry land with a pool: no breath row, a pool row');
  for (let i = 0; i < 70; i++) {
    clock.now += 16;
    hud.rest();
  }
  const kitless = { ...testKit(), resource: null };
  hud.refresh();
  clock.now += 16;
  hud.update(0.016, 1234, 5, -77, kitless, hp, 100, '12:00', '', false, { label: 'Breath', value: 20, max: 30 });
  ok(!breathRow.hidden && resRow.hidden && root.querySelector('.breath-val').textContent === 'Breath 20', `under water and with no pool by the time it is shown again: the breath row up and the pool's row down on that frame (${root.querySelector('.breath-val').textContent})`);
  ok(HUD_HIDDEN_CLASS === 'ui-hidden', "the class `#ui` wears while hidden is not `hidden`, whose page rule is `display: none !important`");
}
{
  // The display's other two-state records, each truth turned while hidden: the stamina row's three (in force, up, tired), a
  // slot lit and a slot come ready, the blade's cell, the charge bar and a hand. Shown again, the first frame writes each as
  // it now stands. A record turned over on the way back, rather than read from the page, agrees with a truth that turned
  // while hidden and writes nothing, so each case here fails it.
  const parent = new El();
  const hud = new Hud(parent as Any);
  const root = parent.kids[0] as El;
  // The stand-in reads no markup: the rows the markup starts down are put down by hand.
  root.querySelector('.breath-row').hidden = true;
  root.querySelector('.stamina-row').classList.add('off', 'gone');
  root.querySelector('.charge').hidden = true;
  const kit = testKit();
  kit.cd = 0.5;
  let charge = 0;
  kit.charge = () => charge;
  hud.setKit(kit);
  const hands: Any = { equipped: { right: null, left: null }, icon: () => null };
  hud.setHandSource(hands);
  const pool = { value: 40, tired: false };
  const st = { show: false, on: false };
  let saberOn = false;
  const frame = () => {
    clock.now += 16;
    hud.setStamina(pool, 100, st.show, st.on);
    hud.update(0.016, 0, 0, 0, kit, 80, 100, '12:00', '', saberOn);
  };
  for (let i = 0; i < 80; i++) frame();
  const staminaRow = root.querySelector('.stamina-row');
  const staminaBar = root.querySelector('.hud-bar.stamina');
  const cells = root.querySelector('.slots').kids;
  const chargeEl = root.querySelector('.charge');
  const rightHand = root.querySelector('.hud-hand.right');
  ok(
    staminaRow.classList.contains('gone') && staminaRow.classList.contains('off') && !cells[0].classList.contains('ready') && !cells[1].classList.contains('active') && !cells[2].classList.contains('active') && chargeEl.hidden && rightHand.hidden,
    'shown and steady: no stamina row, the first slot cooling, the second not lit, the blade off, no charge, nothing in the hands',
  );
  for (let i = 0; i < 70; i++) {
    clock.now += 16;
    hud.rest();
  }
  // While hidden: the speed classes come into force with the pool up and tired, the second ability is lit, the first one's
  // cooldown runs out, the blade is lit, a shot is charging and the right hand takes a blaster.
  st.on = true;
  st.show = true;
  pool.tired = true;
  kit.lit = true;
  kit.cd = 0;
  saberOn = true;
  charge = 0.5;
  hands.equipped.right = { name: 'A test blaster', id: 'test_blaster', class: 'carbine' };
  hud.refresh();
  frame();
  const turned: [string, boolean][] = [
    ['the stamina row in force', !staminaRow.classList.contains('gone')],
    ['the stamina row up', !staminaRow.classList.contains('off')],
    ['the stamina bar tired', staminaBar.classList.contains('warn')],
    ['the second slot lit', cells[1].classList.contains('active')],
    ['the first slot ready', cells[0].classList.contains('ready')],
    ["the blade's cell lit", cells[2].classList.contains('active') && cells[2].querySelector('.cost').textContent === 'on'],
    ['the charge bar up', !chargeEl.hidden],
    ['the right hand shown with what it holds', !rightHand.hidden && root.querySelector('.hud-hand.right .name').textContent === 'A test blaster'],
  ];
  const missed = turned.filter(([, right]) => !right).map(([what]) => what);
  ok(missed.length === 0, `shown again, the first frame writes every two-state record that turned while hidden (${missed.join(', ') || 'all eight'})`);
  // And back the other way, hidden a second time: each turned off again while hidden is written off on the first frame.
  for (let i = 0; i < 70; i++) {
    clock.now += 16;
    hud.rest();
  }
  st.on = false;
  st.show = false;
  pool.tired = false;
  kit.lit = false;
  kit.cd = 0.5;
  saberOn = false;
  charge = 0;
  hands.equipped.right = null;
  hud.refresh();
  frame();
  const back: [string, boolean][] = [
    ['the stamina row out', staminaRow.classList.contains('gone')],
    ['the stamina row down', staminaRow.classList.contains('off')],
    ['the second slot unlit', !cells[1].classList.contains('active')],
    ['the first slot cooling', !cells[0].classList.contains('ready')],
    ["the blade's cell off", !cells[2].classList.contains('active') && cells[2].querySelector('.cost').textContent === 'off'],
    ['the charge bar down', chargeEl.hidden],
    ['the right hand empty', rightHand.hidden],
  ];
  const missedBack = back.filter(([, right]) => !right).map(([what]) => what);
  ok(missedBack.length === 0, `and turned back while hidden a second time, each is written back on the first frame (${missedBack.join(', ') || 'all seven'})`);
}
{
  // The roster down the side.
  const parent = new El();
  const roster = new Roster(parent as Any);
  const members: Any[] = [
    { id: 1, name: 'Ada', hp: 1, planet: 'tatooine', zone: '', distance: 0, leader: true, me: true, here: true },
    { id: 2, name: 'Bo', hp: 0.5, planet: 'tatooine', zone: '', distance: 40, leader: false, me: false, here: true },
  ];
  roster.source = () => members;
  for (let i = 0; i < 80; i++) {
    clock.now += 16;
    roster.update();
  }
  const hidden = writes(() => {
    for (let i = 0; i < 140; i++) {
      clock.now += 16;
      roster.rest();
    }
  });
  const st = roster.stats();
  ok(hidden === 0 && st.writes === 0 && st.writesNow === 0, `the roster, hidden, writes nothing and its second closes on time (${hidden}, ${st.writes})`);
  roster.refresh();
  const back = writes(() => roster.update());
  ok(back >= 6 && /Ada \(leader\) \(you\) 100%/.test(roster.report().lines) && /Bo 50% 40 m/.test(roster.report().lines), `shown again, every row is written afresh (${back} writes: ${roster.report().lines})`);
  ok(writes(() => roster.update()) === 0, 'and then nothing');
  // Each row's three marks, turned while hidden. First the lead passes to Bo and Bo's browser goes quiet; then the group's
  // order turns, so the row that was yours is Bo's and the next is yours.
  const rows = (roster as Any).rows as { root: El }[];
  const marks = (k: number) => ['leader', 'you', 'away'].filter((m) => rows[k].root.classList.contains(m)).join('+') || 'none';
  ok(marks(0) === 'leader+you' && marks(1) === 'none', `before: Ada's row leads and is yours, Bo's has no mark (${marks(0)}, ${marks(1)})`);
  const hideAWhile = () => {
    for (let i = 0; i < 70; i++) {
      clock.now += 16;
      roster.rest();
    }
  };
  hideAWhile();
  members[0].leader = false;
  members[1].leader = true;
  members[1].here = false;
  roster.refresh();
  roster.update();
  ok(marks(0) === 'you' && marks(1) === 'leader+away', `shown again, the lead and the quiet written as they now stand on that frame (${marks(0)}, ${marks(1)})`);
  hideAWhile();
  members.reverse();
  roster.refresh();
  roster.update();
  ok(marks(0) === 'leader+away' && marks(1) === 'you' && /^Bo/.test(roster.report().lines), `and with the order turned while hidden, each row's marks follow whom it now shows (${marks(0)}, ${marks(1)})`);
}
{
  // A ship's instruments.
  const parent = new El();
  const ship = new ShipHud(parent as Any);
  const view = newFlightView();
  view.speed = 50;
  for (let i = 0; i < 80; i++) {
    ship.setFlight(view);
    ship.update(0.016);
  }
  const hidden = writes(() => {
    for (let i = 0; i < 140; i++) {
      clock.now += 16;
      ship.rest();
    }
  });
  ok(hidden === 0 && ship.report().writes === 0, `a ship's instruments, hidden, write nothing and their second closes on time (${hidden}, ${ship.report().writes})`);
  view.speed = 100;
  ship.refresh();
  const back = writes(() => {
    ship.setFlight(view);
    ship.update(0.016);
  });
  ok(back >= 2, `shown again, the speed is written afresh, where the hull is now (${back} writes)`);
  ok(writes(() => { for (let i = 0; i < 30; i++) { ship.setFlight(view); ship.update(0.016); } }) === 0, 'and then nothing at a steady speed');
}
{
  // A ship's instruments' two-state records, each truth turned while hidden: hidden on foot, shown again at the controls
  // of a hull with a target, its shields and armour rows down (a race-driven hull's), no shields fitted (the dash), and two
  // parts, one low and burning, one down; then hidden again and shown on foot. A record turned over on the way back
  // agrees with each of these and writes nothing.
  const parent = new El();
  const ship = new ShipHud(parent as Any);
  const s = ship as Any;
  const view = newFlightView();
  view.speed = 30;
  const target = newTargetView();
  target.name = 'A test target';
  target.kind = 'fighter';
  target.range = 400;
  const status: Any = { shield: [0.5, 0.5], armour: [1, 1], hull: 0.8 };
  const max: Any = { shieldMax: [0, 0], armourMax: [100, 100] };
  const parts: Any[] = [
    { slot: 'engine', hp: 10, max: 100, down: false, burning: true },
    { slot: 'reactor', hp: 0, max: 100, down: true },
  ];
  let aboard = false;
  const frame = () => {
    clock.now += 16;
    if (aboard) {
      ship.setStatus(status, max, parts, true, false);
      ship.setFlight(view);
      ship.setTarget(target);
    } else {
      ship.setStatus(null);
      ship.setFlight(null);
      ship.setTarget(null);
    }
    ship.update(0.016);
  };
  const rest = () => {
    for (let i = 0; i < 70; i++) {
      clock.now += 16;
      ship.rest();
    }
  };
  for (let i = 0; i < 20; i++) frame();
  const state = (): [string, boolean][] => [
    ['the condition block', s.cond.style.display === 'flex'],
    ['the target block', s.targetEl.style.display === 'flex'],
    ['the speed', s.speedEl.style.display === 'block'],
    ['the first pip', s.pips[0].root.style.display === 'block'],
    ['the second pip', s.pips[1].root.style.display === 'block'],
    ['the first pip low', s.pips[0].root.classList.contains('low')],
    ['the first pip burning', s.pips[0].root.classList.contains('hot')],
    ['the second pip down', s.pips[1].root.classList.contains('down')],
    ['the shields and armour rows down', s.layerRows.every((r: El) => r.style.display === 'none')],
    ["the shields' dash", s.bars[0].root.classList.contains('none') && s.bars[1].root.classList.contains('none')],
  ];
  const on = (want: boolean) => state().filter(([, v]) => v !== want).map(([what]) => what);
  ok(on(false).length === 0, `on foot: none of the instruments stands (${on(false).join(', ') || 'none'})`);
  rest();
  aboard = true;
  ship.refresh();
  frame();
  ok(on(true).length === 0, `taken to the controls while hidden: shown again, the first frame stands each of them as the hull now is (${on(true).join(', ') || 'all ten'})`);
  rest();
  aboard = false;
  ship.refresh();
  frame();
  const blocks = state().slice(0, 3).filter(([, v]) => v).map(([what]) => what);
  ok(blocks.length === 0, `and off the ship while hidden again: the condition, the target and the speed go on the first frame (${blocks.join(', ') || 'all three gone'})`);
}
{
  // The minimap: no `update` while hidden; its second closes when it is read, so a hidden one reads 0.
  const hudRoot = new El();
  const panel = new El();
  const pic: Any = { image: { width: 1024, height: 1024 }, frame: { width: 16384, x: 0, z: 0 } };
  const mm = new Minimap(panel as Any, hudRoot as Any, () => pic);
  const v: Any = { wanted: true, pack: 'tatooine', x: 100, z: 200, heading: 0, range: 300, northUp: true, now: 1 };
  for (let i = 0; i < 20; i++) {
    clock.now += 16;
    v.now += 0.016;
    mm.update(v);
  }
  const drawn = mm.redraws;
  // Its second closes when it is read (the console's read): the first read after the interface went closes the second it was
  // shown in, and every whole second after that reads what the hidden minimap wrote, which is nothing.
  clock.now += 1100;
  void mm.writesLastSecond;
  clock.now += 1100;
  ok(mm.writesLastSecond === 0, 'the minimap, not updated while hidden, reads 0 writes for a hidden second');
  v.x = 900;
  v.now += 2;
  mm.refresh();
  const back = writes(() => mm.update(v));
  ok(mm.redraws === drawn + 1 && mm.locShown === '900, 200' && mm.showing && back === 1, `shown again, it is drawn and its pair written afresh, where you are now, and its standing left as the page already has it (${mm.locShown}; ${back} page write)`);
  v.now += 1;
  ok(writes(() => mm.update(v)) === 0 && mm.redraws === drawn + 1, 'and then nothing, standing still');
  // A two-state record whose truth changed while hidden: hidden on a planet, carried into space (where the minimap stands
  // aside), shown again. Seen in the browser with the first cut, which turned the record over and so wrote nothing.
  ok(mm.showing && !mm.root.hidden && hudRoot.classList.contains('minimap-on'), 'standing on the planet');
  v.wanted = false;
  mm.refresh();
  mm.update(v);
  ok(!mm.showing && mm.root.hidden && !hudRoot.classList.contains('minimap-on'), 'a world without a minimap reached while hidden: shown again, it is stood aside on that frame, not left over the starfield');
  v.wanted = true;
  mm.refresh();
  mm.update(v);
  ok(mm.showing && !mm.root.hidden && hudRoot.classList.contains('minimap-on'), 'and the other way, a planet reached while hidden: it stands up on that frame');
}
{
  // The jobs followed: stood aside with `show` false while hidden (one write), and written afresh on the way back.
  const parent = new El();
  const tr = new Tracker(parent as Any);
  tr.update(null, null, 0, true, 'Your jobs wait.', 1000);
  const shownNote = tr.root.hidden === false;
  const aside = writes(() => tr.update(null, null, 0, false, 'Your jobs wait.', 1100));
  const steady = writes(() => { for (let i = 0; i < 20; i++) tr.update(null, null, 0, false, 'Your jobs wait.', 1200 + i * 250); });
  ok(shownNote && aside === 1 && steady === 0 && tr.root.hidden && tr.writesLastSecond === 0, `the tracker stands aside with one write and then writes nothing (${aside}, ${steady})`);
  tr.refresh();
  const back = writes(() => tr.update(null, null, 0, true, 'Your jobs wait.', 9000));
  ok(!tr.root.hidden && back >= 2, `shown again, it stands up and its note is written afresh (${back} writes)`);
}
{
  // The jobs' two-state records, each truth turned while hidden: a step done (its line moves to the end and wears `done`), a
  // step given (a line comes up), a document handed over (its line comes up); then the story held (the note comes up). A
  // record turned over on the way back agrees with each of these and writes nothing.
  const parent = new El();
  const tr = new Tracker(parent as Any);
  const t = tr as Any;
  const view: Any = {
    quests: [{ id: 'job', state: 'active', at: 1, title: 'A test job', lines: [{ step: 's1', text: 'First', done: false }, { step: 's2', text: 'Second', done: false }] }],
    tracked: ['job'],
    waypoints: [],
    docs: [],
  };
  tr.update(view, null, 0, true, '', 1000);
  const lines = t.blocks[0].lines as { root: El; text: El }[];
  const read = (k: number) => (lines[k].root.hidden ? '-' : `${lines[k].text.textContent}${lines[k].root.classList.contains('done') ? ' (done)' : ''}`);
  const doc0 = t.docEls[0].root as El;
  ok(read(0) === 'First' && read(1) === 'Second' && read(2) === '-' && doc0.hidden && t.note.hidden, `before: two steps to do, no third line, no document, no note (${read(0)}, ${read(1)}, ${read(2)})`);
  tr.update(view, null, 0, false, '', 1100);
  view.quests[0].lines = [
    { step: 's1', text: 'First', done: true },
    { step: 's2', text: 'Second', done: false },
    { step: 's3', text: 'Third', done: false },
  ];
  view.docs = [{ id: 'letter', title: 'A test letter' }];
  view.quests.push({ id: 'job2', state: 'active', at: 2, title: 'A second test job', lines: [{ step: 't1', text: 'Begin', done: false }] });
  view.tracked.push('job2');
  const job2 = t.blocks[1] as { root: El; title: El };
  ok(job2.root.hidden, 'one job followed: the second block is down');
  tr.refresh();
  tr.update(view, null, 0, true, '', 9000);
  ok(read(0) === 'Second' && read(1) === 'Third' && read(2) === 'First (done)', `shown again, the first update writes the step done while hidden where it now stands and the step given (${read(0)}, ${read(1)}, ${read(2)})`);
  ok(!job2.root.hidden && job2.title.textContent === 'A second test job', `and the job taken and followed while hidden stands in its own block (${job2.root.hidden ? 'not shown' : job2.title.textContent})`);
  ok(!doc0.hidden && doc0.textContent === 'Read: A test letter', `and the document handed over while hidden (${doc0.hidden ? 'not shown' : doc0.textContent})`);
  tr.update(view, null, 0, false, '', 9100);
  tr.refresh();
  tr.update(view, null, 0, true, 'The story is held.', 20000);
  ok(!t.note.hidden && t.note.textContent === 'The story is held.' && doc0.hidden, 'and a story held while hidden: its note stands on the first update, the documents stood aside');
}
{
  // The climbing course's labels: each one's standing, turned while hidden by the camera turning away and back.
  const parent = new El();
  const labels = new CourseLabels(parent as Any, [{ x: 0, y: 0, z: -10, title: 'A test piece', what: 'Try it.' }]);
  const el = (labels as Any).items[0].el as El;
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const look = (yaw: number) => {
    cam.rotation.set(0, yaw, 0);
    cam.updateMatrixWorld(true);
  };
  look(0);
  labels.frame(cam);
  ok(el.style.display === 'block', 'a label in front of the camera stands');
  look(Math.PI);
  labels.refresh();
  labels.frame(cam);
  ok(el.style.display === 'none', 'the camera turned away while hidden: shown again, the label goes on the first frame');
  look(0);
  labels.refresh();
  labels.frame(cam);
  ok(el.style.display === 'block', 'and turned back while hidden: it stands on the first frame');
}
standClock(false);

// ---------------------------------------------------------------- 3. the game's wiring, as text
{
  const main = text('src/main.ts');
  const set = /private setHudHidden\(on: boolean\): void \{([\s\S]*?)\n  \}/.exec(main)?.[1] ?? '';
  ok(/this\.ui\.classList\.toggle\(HUD_HIDDEN_CLASS, on\);/.test(set) && /if \(on\) return;/.test(set), '`setHudHidden` puts the class on `#ui` and off it, and does the rest only on the way back');
  const refreshed = ['this.hud.refresh();', 'this.minimap.refresh();', 'this.shipHud.refresh();', 'this.roster.refresh();', 'this.tracker.refresh();', 'this.raceHud.refresh();', 'this.runBlockKey.tenths = Number.NaN;', 'this.courseLabels?.refresh();', 'this.plates.clear();', 'this.waypointHud.clear();', 'this.promptLive = false;'];
  const missing = refreshed.filter((r) => !set.includes(r));
  ok(missing.length === 0, `on the way back every piece's records are let go (${missing.join(' ') || 'all eleven'})`);
  ok(/const hudOff = this\.hudHidden;\n\s+if \(!simulate \|\| hudOff\) \{/.test(main), 'hidden, the bar of things to press and the plate go once, as on a frame that is not simulated');
  const frameGuards = [
    'if (!hudOff) this.hud.setPrompt(prompt);',
    'if (!hudOff) this.shipHud.setFlight(',
    'if (!hudOff) this.shipHud.setTarget(',
    'if (hudOff) this.shipHud.rest();\n      else this.shipHud.update(dt);',
    'if (hudOff) this.roster.rest();\n      else this.roster.update();',
    'if (hudOff) this.hud.rest();\n      else {',
    'if (!hudOff) this.stepMinimap();',
    'if (!hudOff) this.courseLabels?.frame(this.cam.camera);',
    'if (simulate && !hudOff && this.settings.hudNameplate && !this.editor?.on) {',
    'if (!this.hudHidden) this.hud.setWeatherNote(this.heldNote());',
    'if (!simulate || this.hudHidden || !o.begin()) {',
    "const show = S.hudTracker && this.inWorld && !this.dying && !this.hudHidden && (!flying || S.hudTrackerInFlight);",
  ];
  const off = frameGuards.filter((gd) => !main.includes(gd));
  ok(off.length === 0, `the frame writes none of the interface while hidden: the prompt, the flight display, the roster, the display, the minimap, the course's labels, the plate, the weather note, the overlay and the jobs followed (${off.join(' | ') || 'all twelve guarded'})`);
  ok(/if \(!hudOff\) \{\n\s+if \(raceCond\) this\.shipHud\.setStatus\(/.test(main), "and the ship's condition block");
  ok((main.match(/project: \(x, y, z, out\) => !this\.hudHidden && this\.projectToScreen\(x, y, z, out\),/g) ?? []).length === 2, 'the words over heads and the chevrons over far members stand down while hidden, through their own "out of view"');
  ok(main.match(/this\.hud\.update\(dt,/g)?.length === 1 && main.match(/this\.hud\.setPrompt\(prompt\)/g)?.length === 1 && main.match(/this\.roster\.update\(\)/g)?.length === 1, 'and the frame has no other call of those that would write them');
}

// ---------------------------------------------------------------- 4. the stylesheet's rule: what goes and what stays
{
  const css = text('src/ui/hud.css');
  const rule = /#ui\.ui-hidden > ((?::not\([^)]+\))+) \{\s*visibility: hidden !important;\s*\}/.exec(css);
  ok(!!rule, 'the rule hides the interface layer\'s children by `visibility`, as a conversation hides the rest');
  const kept = new Set([...(rule?.[1] ?? '').matchAll(/:not\(([^)]+)\)/g)].map((m) => m[1]));
  // What stays: what was opened to be used or replaces the world. Every root named here is a child of `#ui`.
  const stays = ['.overlay', '#loading', '#fade', '#death', '#talk', '#emote-wheel', '.dbg-root', '.trade-root', '#creator-bar', '#place-hint', '#place-bar', '.chat-root', '.group-root', '.ed-panel', '#editor-bar', '#edit-chip'];
  ok(stays.every((s) => kept.has(s)) && kept.size === stays.length, `the windows stay, and nothing else (${[...kept].join(' ')})`);
  // What goes: every root of the display that draws over the world, each by the class or id it is made with.
  const goes: [string, string, RegExp][] = [
    ['#hud', 'src/ui/hud.ts', /this\.root\.id = 'hud';/],
    ['#hud-overlay', 'src/ui/hudCanvas.ts', /this\.el\.id = 'hud-overlay';/],
    ['.hud-roster', 'src/ui/hud.ts', /this\.root\.className = 'hud-roster hidden';/],
    ['.hud-acts', 'src/ui/prompt.ts', /this\.root\.className = 'hud-acts';/],
    ['.hud-plates', 'src/ui/nameplate.ts', /div\(parent, 'hud-plates'\)/],
    ['.hud-wp-labels', 'src/ui/waypointHud.ts', /this\.root\.className = 'hud-wp-labels';/],
    ['.hud-msgs', 'src/ui/messages.ts', /this\.root\.className = 'hud-msgs';/],
    ['.hud-tracker', 'src/ui/tracker.ts', /this\.root\.className = 'hud-tracker';/],
    ['#ship-hud', 'src/ui/shipHud.ts', /this\.root\.id = 'ship-hud';/],
    ['.hud-race', 'src/ui/raceHud.ts', /this\.root\.className = 'hud-race';/],
    ['.course-labels', 'src/ui/courseLabels.ts', /this\.root\.className = 'course-labels';/],
    ['.fx-notice', 'src/ui/notice.ts', /this\.el\.className = 'fx-notice';/],
    ['#hyperspace-count', 'src/ui/hyperspaceUi.ts', /this\.countEl\.id = 'hyperspace-count';/],
    ['#placing-bar', 'src/ui/placingBar.ts', /this\.root\.id = 'placing-bar';/],
    ['#band-bar', 'src/ui/bandBar.ts', /this\.root\.id = 'band-bar';/],
  ];
  const wrong = goes.filter(([sel, file, made]) => kept.has(sel) || !made.test(text(file)));
  ok(wrong.length === 0, `every piece of the display goes: ${goes.map(([s]) => s).join(' ')} (${wrong.map(([s]) => s).join(' ') || 'none kept, each made as named'})`);
  ok(/#ui\.ui-hidden \.chat-bubbles,\n#ui\.ui-hidden \.group-marks \{\s*visibility: hidden !important;\s*\}/.test(css) && /this\.layer\.className = 'chat-bubbles';/.test(text('src/ui/chatUi.ts')) && /this\.marks\.className = 'group-marks';/.test(text('src/ui/groupUi.ts')), "inside two kept roots, the words over heads and the chevrons go on their own, while the chat line and a group's question stay");
  // And every window the game puts in `#ui` is one of the kept: each `overlay` panel by its class.
  const panels = ['appearanceUi', 'backpackUi', 'characterSelect', 'documentUi', 'forceUi', 'housingUi', 'hyperspaceUi', 'journalUi', 'liftMenu', 'mapUi', 'menu', 'npcUi', 'propsUi', 'shipEditUi', 'shipMenu', 'shuttleMenu', 'terminalUi', 'vehiclesUi', 'wardrobeUi', 'weaponsUi'];
  const notPanel = panels.filter((f) => !/this\.root\.className = 'overlay hidden';/.test(text(`src/ui/${f}.ts`)));
  ok(notPanel.length === 0, `the twenty panels each wear \`overlay\`, so each stays (${notPanel.join(' ') || 'all twenty'})`);
  const ids: [string, string, RegExp][] = [
    ['#loading', 'src/ui/loading.ts', /this\.root\.id = 'loading';/],
    ['#talk', 'src/ui/talkUi.ts', /this\.root\.id = 'talk';/],
    ['#emote-wheel', 'src/ui/emoteWheel.ts', /this\.root\.id = 'emote-wheel';/],
    ['.dbg-root', 'src/ui/debugMenu.ts', /this\.root = el\('div', 'dbg-root'\);/],
    ['.trade-root', 'src/ui/tradeUi.ts', /this\.root\.className = 'trade-root';/],
    ['#creator-bar', 'src/ui/creatorBar.ts', /this\.root\.id = 'creator-bar';/],
    ['#place-bar', 'src/ui/placeBar.ts', /this\.element\.id = 'place-bar';/],
    ['.chat-root', 'src/ui/chatUi.ts', /this\.root\.className = 'chat-root';/],
    ['.group-root', 'src/ui/groupUi.ts', /this\.root\.className = 'group-root';/],
    ['.ed-panel', 'src/ui/editorWindow.ts', /root\.className = 'ed-panel fly';/],
    ['#editor-bar', 'src/ui/editorBar.ts', /root\.id = 'editor-bar';/],
    ['#edit-chip', 'src/ui/editChip.ts', /this\.root\.id = 'edit-chip';/],
    ['#fade', 'src/main.ts', /this\.fade\.id = 'fade';/],
    ['#death', 'src/main.ts', /this\.death\.id = 'death';/],
  ];
  const lost = ids.filter(([, file, made]) => !made.test(text(file)));
  ok(lost.length === 0, `and each kept root is made under the name the rule keeps (${lost.map(([s]) => s).join(' ') || 'all fourteen'})`);
}

// ---------------------------------------------------------------- 5. nothing allocated by a hidden frame's calls, in twelve fresh processes at once
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from({ length: 12 }, () =>
      new Promise<Record<string, number> | string>((res) => {
        const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        ch.stdout.on('data', (b) => (out += b));
        ch.stderr.on('data', (b) => (err += b));
        ch.on('close', () => {
          try {
            res(JSON.parse(out.trim().split('\n').pop() ?? ''));
          } catch {
            res(`no answer: ${err.slice(0, 300)}`);
          }
        });
      }),
    ),
  );
  const bad = runs.filter((r) => typeof r === 'string');
  ok(bad.length === 0, `every process answered (${bad.join('; ')})`);
  const got = runs as Record<string, number>[];
  for (const k of ['hud', 'roster', 'ship']) {
    const v = got.map((r) => r[k]);
    ok(v.every((x) => Number.isFinite(x) && x < 0.5), `a hidden frame's ${k} call allocates nothing in 12 of 12 processes (${v.map((x) => x.toFixed(3)).join(' ')} B)`);
  }
}

console.log(`\nhudHide: ${checks} checks passed`);
