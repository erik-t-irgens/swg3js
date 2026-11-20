// The weapon mark of the interface rewrite's first wave (item 6; 19 November 2026, the owner's notes and answers): which of
// our own marks stands for what the hands hold (`weaponMark` in src/ui/weaponMark.ts), the marks themselves on the sheet
// (src/ui/hud.svg), how the stylesheet stands a lightsaber at its stance and draws its blade in and out (src/ui/hud.css),
// what the display writes for it (src/ui/hud.ts), the Interface page's switch, the dials, the blade's own timing as the
// blade runs it (src/combat/saberBlade.ts), and, in twelve fresh processes at once, nothing made by a steady frame.
//
// What is pinned, by the owner's words:
//   * a lightsaber shows its stance, not its state: fast tilted 45 degrees to the right, medium 22.5, strong upright; a
//     double-bladed saber a double-bladed mark at 45; two sabers two marks crossed in an X, each at 45;
//   * a blaster shows its kind (pistol, carbine, rifle, heavy weapon); every other class and empty hands a mark of its
//     own; any other pair two small marks set diagonally, a muted slanted line between them;
//   * the mark's blade draws in and out with the real one at the saber's own timing, a switch that starts on; off, the
//     blade stands out whatever the real one does;
//   * slightly see-through, no name, and the two hand cells gone.
//
// Everything here is synthetic: stand-ins for the page, made-up kits and hands. Run: node tools/swg/tests/weaponMark.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HUD_SIZES } from '../../../src/ui/hudMath.ts';
import { MARK_KEYS, MARK_SYMBOLS, makeMarkIn, makeMarkOut, markHasBlade, markSvg, markWords, weaponMark, type MarkIn, type MarkKey } from '../../../src/ui/weaponMark.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const ALLOC = process.argv.includes('--alloc');

// ---------------------------------------------------------------- the stand-in page: every write counted
type Any = any;
const count = { writes: 0 };
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
class El {
  readonly style = styleOf();
  readonly kids: El[] = [];
  private readonly found = new Map<string, El>();
  readonly names = new Set<string>();
  private words = '';
  private html = '';
  private hiddenNow = false;
  readonly classList = {
    toggle: (name: string, on?: boolean) => {
      count.writes++;
      const want = on === undefined ? !this.names.has(name) : on;
      if (want) this.names.add(name);
      else this.names.delete(name);
      return want;
    },
    add: (...names: string[]) => {
      count.writes++;
      for (const x of names) this.names.add(x);
    },
    contains: (name: string) => this.names.has(name),
  };
  get textContent(): string {
    return this.words;
  }
  set textContent(v: string) {
    count.writes++;
    this.words = String(v);
  }
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(v: string) {
    count.writes++;
    this.html = String(v);
  }
  get className(): string {
    return [...this.names].join(' ');
  }
  set className(v: string) {
    count.writes++;
    this.names.clear();
    for (const x of String(v).split(/\s+/)) if (x) this.names.add(x);
  }
  get hidden(): boolean {
    return this.hiddenNow;
  }
  set hidden(v: boolean) {
    count.writes++;
    this.hiddenNow = !!v;
  }
  setAttribute(): void {
    count.writes++;
  }
  appendChild(k: El): El {
    this.kids.push(k);
    return k;
  }
  querySelector(sel: string): El {
    let hit = this.found.get(sel);
    if (!hit) {
      hit = new El();
      this.found.set(sel, hit);
    }
    return hit;
  }
}
const g = globalThis as unknown as Record<string, Any>;
const docRoot = new El();
g.document = { createElement: () => new El(), documentElement: docRoot };
const clock = { now: 100000 };
Object.defineProperty(performance, 'now', { value: () => clock.now, configurable: true, writable: true });
function writes(what: () => void): number {
  count.writes = 0;
  what();
  return count.writes;
}
function testKit(id = 'jedi'): Any {
  return {
    id,
    name: id,
    slots: [{ key: '1', name: 'Force jump', cost: '20' }],
    resource: { label: 'Force', value: 100, max: 100 },
    slotActive: () => false,
    slotCooldown: () => 0,
    charge: () => 0,
  };
}

const { Hud } = await import('../../../src/ui/hud.ts');

// ---------------------------------------------------------------- 7 (child). a steady frame of the display with a mark up
if (ALLOC) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const hud = new Hud(new El() as Any);
  const kit = testKit();
  hud.setKit(kit);
  // A pair (the stand-in saber and a knife in the left hand), the blade lit, the stance read off the source: the frame
  // compares two hands by identity, four words and a switch, and writes nothing.
  const source: Any = { equipped: { right: null, left: { class: 'knife' } }, fists: false, gunClass: 'rifle', saber: { style: 'fast' }, bladeSeconds: () => 0.25 };
  hud.setHandSource(source);
  const step = () => {
    hud.update(0.016, 1, 2, 3, kit, 80, 100, '12:00', '', true);
  };
  clock.now += 300;
  for (let w = 0; w < 10; w++) {
    for (let i = 0; i < 6000; i++) step();
    await turn();
  }
  let best = Number.NaN;
  let clean = 0;
  for (let tries = 0; tries < 12 && clean < 3; tries++) {
    for (let i = 0; i < 4000; i++) step();
    gc({ type: 'minor' });
    await turn();
    await turn();
    const c0 = collections;
    const b = young();
    for (let i = 0; i < 20000; i++) step();
    const a = young();
    await turn();
    await turn();
    if (collections === c0) {
      const per = (a - b) / 20000;
      best = clean === 0 ? per : Math.min(best, per);
      clean++;
    }
  }
  console.log(JSON.stringify({ frame: best, writes: writes(step), mark: hud.report().mark }));
  process.exit(0);
}

const S = HUD_SIZES;
const sheet = readFileSync(new URL('../../../src/ui/hud.svg', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../../src/ui/hud.css', import.meta.url), 'utf8');
const hudText = readFileSync(new URL('../../../src/ui/hud.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
const symbolsOnSheet = new Set([...sheet.matchAll(/<symbol\s+id="([^"]+)"/g)].map((m) => m[1]));

// ---------------------------------------------------------------- 1. which mark stands for what (`weaponMark`)
const ask = (o: Partial<MarkIn>) => {
  const m = makeMarkIn();
  Object.assign(m, { right: '', left: '', kit: 'jedi', bare: false, gun: 'rifle', style: 'medium' }, o);
  return { ...weaponMark(m, makeMarkOut()) };
};
{
  // A lightsaber's stance by its tilt, the stand-in saber and the rack's alike.
  const fast = ask({ style: 'fast' });
  const medium = ask({ style: 'medium' });
  const strong = ask({ style: 'strong' });
  ok(fast.a === 'saber' && fast.tiltA === 45 && medium.a === 'saber' && medium.tiltA === 22.5 && strong.a === 'saber' && strong.tiltA === 0 && !fast.b, "the Jedi's saber shows its stance: fast 45 to the right, medium 22.5, strong upright, one mark");
  const rack = (['fast', 'medium', 'strong'] as const).map((style) => ask({ right: 'lightsaber', style }));
  ok(rack.map((r) => `${r.a} ${r.tiltA}`).join() === 'saber 45,saber 22.5,saber 0', 'and so does a saber from the rack');
  ok(ask({ right: 'lightsaber2h', style: 'strong' }).tiltA === 0 && ask({ right: 'lightsaber2h', style: 'medium' }).tiltA === 22.5, 'and a two-handed one in the two stances it allows');
  const staff = ask({ right: 'lightsaberStaff', style: 'staff' });
  ok(staff.a === 'staff' && staff.tiltA === 45 && !staff.b, 'a double-bladed saber is the double-bladed mark at 45');
  ok(ask({ style: 'staff' }).a === 'staff', "and the stand-in fighting as the staff is that mark too (the game draws its second blade then)");
  const dual = ask({ right: 'lightsaber', left: 'lightsaber', style: 'dual' });
  ok(dual.a === 'dual' && dual.tiltA === 45 && dual.b === '', 'two sabers are one mark, crossed in an X, each at 45');
  ok(ask({ style: 'dual' }).a === 'dual' && ask({ right: 'lightsaber', style: 'dual' }).a === 'dual', "and the dual style with nothing in the left hand is the X too (the game puts its stand-in saber there)");
  ok(ask({ right: 'lightsaber', left: 'lightsaber2h', style: 'dual' }).a === 'dual', 'whatever grip each saber has');
  // A blaster's kind.
  const guns = (['pistol', 'carbine', 'rifle', 'heavy'] as const).map((right) => ask({ right, kit: 'bounty_hunter' }));
  ok(guns.map((r) => r.a).join() === 'pistol,carbine,rifle,heavy' && guns.every((r) => !r.b && r.tiltA === 0), 'a blaster shows its kind: pistol, carbine, rifle, heavy weapon, upright');
  ok(ask({ kit: 'bounty_hunter', gun: 'pistol' }).a === 'pistol' && ask({ kit: 'bounty_hunter', gun: 'heavy' }).a === 'heavy' && ask({ kit: 'bounty_hunter', gun: '' }).a === 'rifle', "the Bounty Hunter's stand-in blaster is the kind last held, the rifle before any");
  // Everything else.
  const others: [string, MarkKey][] = [['sword1h', 'sword'], ['knife', 'knife'], ['sword2h', 'sword2h'], ['polearm', 'polearm'], ['fist', 'fist'], ['thrown', 'thrown'], ['instrument', 'instrument'], ['entertainer', 'prop']];
  const wrong = others.filter(([right, key]) => ask({ right }).a !== key);
  ok(wrong.length === 0, `every other class a hand holds has a mark of its own (${others.map(([c, k]) => `${c} ${k}`).join(', ')})${wrong.length ? `: wrong ${wrong.join(' ')}` : ''}`);
  ok(ask({ kit: 'other' }).a === 'fists' && ask({ bare: true }).a === 'fists' && ask({ bare: true, right: 'pistol' }).a === 'fists', 'empty hands are the fists: a kit with no stand-in, and the bare-hands switch whatever is held');
  ok(ask({ right: 'something_new' }).a === 'held', "something held whose class nothing knows is the open hand, never nothing");
  // Pairs: the left hand takes any blade but the double-bladed saber.
  const { OFF_HAND_CLASSES } = await import('../../../src/core/inventory.ts');
  const offHand = [...OFF_HAND_CLASSES];
  ok(!offHand.includes('lightsaberStaff') && offHand.includes('knife'), `the left hand's classes as the backpack keeps them (${offHand.join(', ')})`);
  const sabers = new Set(['lightsaber', 'lightsaber2h']);
  const bad: string[] = [];
  for (const right of offHand) {
    for (const left of offHand) {
      const style = 'dual';
      const r = ask({ right, left, style });
      const want = sabers.has(right) && sabers.has(left) ? 'X' : 'pair';
      const got = r.a === 'dual' && !r.b ? 'X' : r.b ? 'pair' : 'one';
      if (want !== got) bad.push(`${right}+${left} ${got}`);
      if (got === 'pair' && (r.a === 'dual' || !MARK_KEYS.includes(r.b as Exclude<MarkKey, ''>))) bad.push(`${right}+${left} b=${r.b}`);
    }
  }
  ok(bad.length === 0, `every pair the hands can hold is two sabers crossed or two small marks (${offHand.length * offHand.length} pairs)${bad.length ? `: ${bad.join(', ')}` : ''}`);
  const sk = ask({ right: 'lightsaber', left: 'knife', style: 'dual' });
  ok(sk.a === 'saber' && sk.tiltA === 45 && sk.b === 'knife' && sk.lights, 'a saber and a knife: the saber at 45 (each half of the X) high, the knife low, and the blade still lights');
  const ss = ask({ right: 'sword1h', left: 'lightsaber', style: 'dual' });
  ok(ss.a === 'sword' && ss.b === 'saber' && ss.tiltB === 45 && !ss.lights, "a sword and a saber: the saber's blade stays in, as the game keeps it while a sword is in the right hand");
  ok(ask({ right: 'polearm', left: 'knife', style: 'staff' }).b === 'knife', 'and a left hand beside any right one is shown');
  ok(ask({}).lights && ask({ right: 'lightsaberStaff', style: 'staff' }).lights && !ask({ right: 'sword2h' }).lights && !ask({ bare: true }).lights, 'the blade can light with a saber or the stand-in in the right hand, never with another blade there or bare hands');
  // Distinct marks.
  const keys = MARK_KEYS.filter((k) => !markHasBlade(k));
  const syms = keys.map((k) => markSvg(k, false));
  ok(new Set(syms).size === keys.length, `no two of the ${keys.length} one-picture marks are the same picture`);
  ok(markWords(ask({ style: 'fast' }), true) === 'saber 45° lit' && markWords(sk, false) === 'saber 45° in / knife' && markWords(ask({ right: 'pistol' }), true) === 'pistol', "the console's words for it");
  // Live tilts: a dial moves the answer.
  const was = S.markTiltMedium;
  S.markTiltMedium = 30;
  ok(ask({ style: 'medium' }).tiltA === 30, 'a tilt moved at its dial is the next answer');
  S.markTiltMedium = was;
}

// ---------------------------------------------------------------- 2. the marks on the sheet, and how they are put together
{
  const missing = MARK_SYMBOLS.filter((id) => !symbolsOnSheet.has(id));
  ok(missing.length === 0, `every symbol a mark is drawn from is on the sheet (${MARK_SYMBOLS.length})${missing.length ? `: ${missing.join(', ')}` : ''}`);
  const used = new Set<string>();
  for (const k of MARK_KEYS) for (const m of [...markSvg(k, false).matchAll(/href="#([^"]+)"/g), ...markSvg(k, true).matchAll(/href="#([^"]+)"/g)]) used.add(m[1]);
  const off = [...used].filter((id) => !symbolsOnSheet.has(id));
  ok(off.length === 0 && used.size === MARK_SYMBOLS.length, `every mark's markup uses only the sheet's own symbols, and all of them (${used.size})`);
  ok(!/<image\b|<img\b|\.png|\.dds|ui_/.test(MARK_KEYS.map((k) => markSvg(k, false)).join('')), 'no picture of the game is used: every mark is ours');
  const saber = markSvg('saber', false);
  ok(/^<g class="tilt">.*<g class="blade">.*ic-mark-blade.*<\/g><\/g>$/.test(saber) && saber.indexOf('ic-mark-hilt') < saber.indexOf('class="blade"'), 'a lightsaber is its hilt and its blade in a group of its own, standing in its tilt');
  ok(markSvg('saber', true).includes('class="blade b2"') && !markSvg('saber', false).includes('b2'), "the left hand's saber draws its blade at the left hand's own timing");
  const dual = markSvg('dual', false);
  ok(/class="x1".*class="blade">.*class="x2".*class="blade b2"/.test(dual), 'the X is two sabers, one leaning each way, the second the left hand\'s');
  const staff = markSvg('staff', false);
  ok((staff.match(/class="blade staff"/g) ?? []).length === 2 && staff.includes('rotate(180 12 12)'), 'the double-bladed saber draws two blades, the lower the upper turned half round');
  ok(['pistol', 'rifle', 'sword', 'fists', 'held'].every((k) => /^<use href="#ic-[\w-]+"><\/use>$/.test(markSvg(k as MarkKey, false))), 'every other mark is one picture from the sheet');
  // The blade draws in toward its emitter: the stylesheet's origin is where the sheet's blade starts.
  const blade = /<symbol id="ic-mark-blade"[^>]*>\s*<path d="M(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)V/.exec(sheet);
  const staffBlade = /<symbol id="ic-mark-staff-blade"[^>]*>\s*<path d="M(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)V/.exec(sheet);
  ok(!!blade && new RegExp(`\\.hud-mark \\.blade \\{\\s*transform-origin: ${blade[1]}px ${blade[2]}px;`).test(css), `the blade draws in toward the point the sheet starts it at (${blade?.[1]}, ${blade?.[2]})`);
  ok(!!staffBlade && new RegExp(`\\.hud-mark \\.blade\\.staff \\{ transform-origin: ${staffBlade[1]}px ${staffBlade[2]}px; \\}`).test(css), `and the double-bladed one's toward its end of the hilt (${staffBlade?.[1]}, ${staffBlade?.[2]})`);
}

// ---------------------------------------------------------------- 3. how the stylesheet draws it
{
  ok(/\.hud-mark \{[^}]*color: var\(--ink\);[^}]*opacity: var\(--hud-mark-alpha, 0\.75\);/.test(css) && S.markAlpha === 0.75, "the mark is the palette's ink, slightly see-through");
  ok(/\.hud-mark \.tilt \{[^}]*transform: rotate\(calc\(var\(--mk-tilt, 0\) \* 1deg\)\);[^}]*transition: transform var\(--hud-mark-turn, 0\.15s\) ease-out;/.test(css), "a saber stands at its slot's tilt and eases to a new stance");
  ok(/\.hud-mark \.x1 \{ transform: rotate\(calc\(var\(--mk-tilt, 45\) \* -1deg\)\); \}/.test(css) && /\.hud-mark \.x2 \{ transform: rotate\(calc\(var\(--mk-tilt, 45\) \* 1deg\)\); \}/.test(css), 'the X leans its two sabers opposite ways by the one tilt');
  ok(/\.hud-mark \.blade \{[^}]*transform: scaleY\(0\);[^}]*transition: transform calc\(var\(--mk-close, 0\.32\) \* 1s\) linear;/.test(css) && /\.hud-mark\.lit \.blade \{\s*transform: none;\s*transition-duration: calc\(var\(--mk-open, 0\.32\) \* 1s\);/.test(css), "the blade is in without `lit` and out with it, going out at the blade's opening time and in at its closing time, linear as the blade runs");
  ok(/\.hud-mark \.blade\.b2 \{ transition-duration: calc\(var\(--mk-close2, 0\.32\) \* 1s\); \}/.test(css) && /\.hud-mark\.lit \.blade\.b2 \{ transition-duration: calc\(var\(--mk-open2, 0\.32\) \* 1s\); \}/.test(css), "and the left hand's at the left blade's own");
  ok(S.markBladeSeconds === 0.32, 'the default timing, where there is none to read, is the blade\'s own third of a second');
  ok(/\.hud-mark \.mk-b,\s*\.hud-mark \.mk-split \{ display: none; \}/.test(css) && /\.hud-mark\.pair \.mk-b,\s*\.hud-mark\.pair \.mk-split \{ display: inline; \}/.test(css), 'a pair is one class: the second mark and the line come up with it');
  ok(/\.hud-mark\.pair \.mk-a \{\s*transform: translate\([^}]*scale\(var\(--hud-mark-pair, 0\.333\)\);/.test(css) && /\.hud-mark\.pair \.mk-b \{\s*transform: translate\(calc\(24px - [^}]*scale\(var\(--hud-mark-pair, 0\.333\)\);/.test(css), 'each mark of a pair at a third of the box, one at the top left and one at the bottom right');
  ok(/\.hud-mark \.mk-split \{[^}]*stroke: var\(--muted\);[^}]*transform: rotate\(calc\(var\(--hud-mark-split-angle, 45\) \* -1deg\)\) scaleX\(var\(--hud-mark-split, 11\)\);/.test(css), 'with a muted line between them, slanted');
  // A pair fits: each small mark's drawn field (3 to 21 of its own box) stays clear of the line, and inside the box.
  const s = S.markPairScale;
  const at = S.markPairAt * 24;
  const half = 9 * s * Math.SQRT2; // the drawn field's corner, from its middle
  const toLine = Math.abs(at + at - 24) / Math.SQRT2; // the middle's distance from the line x + y = 24, through the box's middle
  ok(at - 9 * s >= 0 && toLine - half > 0, `a pair's two marks stand in the box and clear of the line between them (${(toLine - half).toFixed(2)} of 24 to spare)`);
  // Nothing of the old hand cells is left.
  ok(!/hud-hand/.test(hudText) && !/\.hud-hand/.test(css) && !/\.hud-hands/.test(css), 'the two hand cells, their picture and their name, are gone from the display and the stylesheet');
  ok(!/iconUrl|icon\(item/.test(hudText), "and the display reads no picture of the rack's for a hand");
}

// ---------------------------------------------------------------- 4. what the display writes
{
  const parent = new El();
  const hud = new Hud(parent as Any);
  const root = parent.kids[0] as El;
  const mark = root.querySelector('.hud-mark');
  const A = root.querySelector('.hud-mark .mk-a');
  const B = root.querySelector('.hud-mark .mk-b');
  const kit = testKit();
  hud.setKit(kit);
  const src: Any = { equipped: { right: null, left: null }, fists: false, gunClass: 'rifle', saber: { style: 'medium' } };
  let open = 0.25;
  src.bladeSeconds = (hand: string, closing: boolean) => (hand === 'left' ? 0.2 : closing ? 0.3 : open);
  hud.setHandSource(src);
  let saberOn = false;
  const frame = () => {
    clock.now += 16;
    hud.update(0.016, 0, 0, 0, kit, 80, 100, '12:00', '', saberOn);
  };
  frame();
  ok(A.innerHTML === markSvg('saber', false) && A.style['--mk-tilt'] === '22.5' && B.innerHTML === '' && !mark.names.has('pair') && !mark.names.has('lit'), "the Jedi's first frame draws one saber at the medium stance, its blade in");
  ok(mark.style['--mk-open'] === '0.25' && mark.style['--mk-close'] === '0.3' && mark.style['--mk-open2'] === '0.2' && mark.style['--mk-close2'] === '0.2', "with each hand's blade timing as the blade runs it");
  ok(writes(frame) === 0 && writes(frame) === 0, 'and a steady frame writes nothing');
  saberOn = true;
  // Three writes: the mark's one class, and the action bar's saber cell lighting and its word (the cell's own, which wave 2
  // takes the word off).
  ok(writes(frame) === 3 && mark.names.has('lit'), 'the saber lit: one class on the mark, and the stylesheet draws the blade out');
  ok(writes(frame) === 0, 'and nothing more while it stays lit');
  src.saber.style = 'fast';
  ok(writes(frame) === 1 && A.style['--mk-tilt'] === '45' && A.innerHTML === markSvg('saber', false), 'a new stance: one property, the saber turns to 45, its markup kept');
  src.saber.style = 'dual';
  const n = writes(frame);
  ok(A.innerHTML === markSvg('dual', false) && n === 1 && A.style['--mk-tilt'] === '45', `the dual style: the X written, its tilt the fast stance's already (${n} write)`);
  src.equipped.left = { class: 'knife' };
  frame();
  ok(mark.names.has('pair') && A.innerHTML === markSvg('saber', false) && B.innerHTML === markSvg('knife', true) && mark.names.has('lit'), 'a knife in the left hand: a pair, the saber high and the knife low, the blade still out');
  ok(hud.report().mark === 'saber 45° lit / knife', `the console reads it (${hud.report().mark})`);
  src.equipped.left = null;
  src.equipped.right = { class: 'sword1h' };
  src.saber.style = 'medium';
  frame();
  ok(A.innerHTML === markSvg('sword', false) && !mark.names.has('pair') && !mark.names.has('lit'), 'a sword: its own mark, no pair, and nothing lit while the saber is on (no blade in these hands)');
  const rackSaber = { class: 'lightsaber' };
  src.equipped.right = rackSaber;
  open = 0.1;
  frame();
  ok(mark.names.has('lit') && mark.style['--mk-open'] === '0.1', "a rack saber: lit again, at that saber's own opening time");
  src.bladeSeconds = undefined;
  frame();
  ok(mark.style['--mk-open'] === '0.1', 'a timing is read when the hands change, not each frame');
  src.equipped.right = { class: 'lightsaber2h' };
  frame();
  ok(mark.style['--mk-open'] === String(S.markBladeSeconds), 'and a source with no timing to give takes the default');
  // The switch: off, the blade stands out whatever the real one does.
  saberOn = false;
  frame();
  ok(!mark.names.has('lit'), 'the saber put away: the blade draws in');
  hud.setMarkBlade(false);
  ok(writes(frame) === 1 && mark.names.has('lit'), 'the switch off: the blade out at once, though the saber is away');
  saberOn = true;
  const markWrites = mark.names.has('lit');
  frame();
  ok(markWrites && mark.names.has('lit'), 'and the real blade changes nothing on the mark');
  hud.setMarkBlade(true);
  saberOn = false;
  frame();
  ok(!mark.names.has('lit'), 'back on, it follows the real one again');
  // Bare hands and a blaster's kind.
  src.fists = true;
  frame();
  ok(A.innerHTML === markSvg('fists', false) && hud.report().mark === 'fists', 'bare hands: the fists');
  src.fists = false;
  src.equipped.right = { class: 'pistol' };
  const gunKit = testKit('bounty_hunter');
  hud.update(0.016, 0, 0, 0, gunKit, 80, 100, '12:00', '', false);
  ok(A.innerHTML === markSvg('pistol', false) && A.style['--mk-tilt'] === '0', 'a pistol: its own mark, upright');
  // A tilt moved at its dial reaches the mark through the settings applied again (`setBlock`).
  src.equipped.right = { class: 'lightsaber' };
  frame();
  const was = S.markTiltMedium;
  S.markTiltMedium = 30;
  hud.setBlock('middle', 'over', 'lower');
  frame();
  ok(A.style['--mk-tilt'] === '30', 'a tilt moved at its dial is drawn on the next frame');
  S.markTiltMedium = was;
  hud.setBlock('middle', 'over', 'lower');
  frame();
  // Hidden and shown again: the mark is written afresh from what is true now.
  ok(hud.report().mark === 'saber 22.5° in', `the console's words (${hud.report().mark})`);
}

// ---------------------------------------------------------------- 5. the switch, the wiring and the dials
{
  const { DEFAULT_SETTINGS } = await import('../../../src/core/settings.ts');
  const { INTERFACE } = await import('../../../src/ui/hudPage.ts');
  const knob = INTERFACE.flatMap((gr) => gr.knobs).find((k) => k.key === 'hudMarkBlade');
  ok((DEFAULT_SETTINGS as Any).hudMarkBlade === true, 'the switch starts on (the owner\'s "Start on not off")');
  ok(!!knob && knob.kind === 'toggle' && INTERFACE.find((gr) => gr.knobs.includes(knob!))!.title === 'The bars and the action bar', 'and is a switch on the Interface page beside where the block stands');
  const apply = /private applyHudSettings\(\): void \{([\s\S]*?)\n  \}/.exec(main)?.[1] ?? '';
  ok(/this\.hud\.setMarkBlade\(S\.hudMarkBlade\);/.test(apply), 'the game hands the display the switch whenever the settings are applied');
  const change = /case 'hudTrackerInFlight':([\s\S]*?)this\.applyHudSettings\(\);/.exec(main)?.[1] ?? '';
  ok(change.includes("case 'hudMarkBlade':"), 'and the moment it is moved on the page');
  ok(/\['markBlade', 'hudMarkBlade'\]/.test(main) && /markBlade\?: boolean;/.test(main), 'and `__debug.hud({ markBlade })` sets it as the page does');
  ok(/this\.hud\.setHandSource\(this\.player\);/.test(main) && !/iconUrl\(item as WeaponDef\)/.test(main), 'the mark reads the player as it stands (its hands, the bare-hands switch, the stand-in blaster, the stance, the blade timing), and no picture of the rack');
  const player = readFileSync(new URL('../../../src/player/player.ts', import.meta.url), 'utf8');
  ok(/bladeSeconds\(hand: 'right' \| 'left', closing: boolean\): number \{\s*for \(const b of this\.blades\) if \(b\.hand === hand && !b\.snap\) return closing \? b\.blade\.closeSeconds : b\.blade\.openSeconds;/.test(player), "the player answers with that hand's own blade's timing");
  const { HUD_DIALS } = await import('../../../src/ui/hudDials.ts');
  const dials = HUD_DIALS.groups.flatMap((gr) => gr.dials).map((d) => d.key);
  const want = ['markAlpha', 'markTiltFast', 'markTiltMedium', 'markTiltStrong', 'markTiltStaff', 'markTiltDual', 'markTurnSeconds', 'markBladeSeconds', 'markPairScale', 'markPairAt', 'markSplitLength', 'markSplitWidth', 'markSplitAngle'];
  const lacking = want.filter((k) => !dials.includes(`sizes.${k}`));
  ok(lacking.length === 0, `every number of the mark is a dial in the debug menu (${want.length})${lacking.length ? `: missing ${lacking.join(', ')}` : ''}`);
}

// ---------------------------------------------------------------- 6. the blade's own timing, as the blade runs it
{
  const THREE = await import('three');
  const { SaberBlade } = await import('../../../src/combat/saberBlade.ts');
  const b = new SaberBlade();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const base = new THREE.Vector3(0, 1, 0);
  const tip = new THREE.Vector3(0, 2, 0);
  ok(b.openSeconds === 0.32 && b.closeSeconds === 0.32, `a blade with no file of its own comes out and goes back in a third of a second (${b.openSeconds}, ${b.closeSeconds})`);
  b.spec = { length: 1.1, width: 0.12, open: 1.5, close: 0.2 };
  ok(b.openSeconds === 0.32 && b.closeSeconds === 0.2, "a file's slow 1.5 is held to the third, a quicker one kept");
  const dt = 0.01;
  let steps = 0;
  for (; steps < 200 && b.ignition < 1; steps++) b.update(dt, base, tip, true, camera, 0);
  ok(Math.abs(steps * dt - b.openSeconds) < dt * 1.5, `and the blade itself comes fully out over that time (${(steps * dt).toFixed(2)} s)`);
  steps = 0;
  for (; steps < 200 && b.ignition > 0; steps++) b.update(dt, base, tip, false, camera, 0);
  ok(Math.abs(steps * dt - b.closeSeconds) < dt * 1.5, `and goes back over its own (${(steps * dt).toFixed(2)} s)`);
  b.reset();
}

// ---------------------------------------------------------------- 7. nothing made by a steady frame, in twelve fresh processes at once
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from({ length: 12 }, () =>
      new Promise<Record<string, Any> | string>((res) => {
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
  const got = runs as Record<string, Any>[];
  ok(got.every((r) => r.mark === 'saber 45° lit / knife'), `the frame measured has a pair up and the blade out (${got[0]?.mark})`);
  ok(got.every((r) => r.writes === 0), 'and writes nothing to the page');
  // A process none of whose windows was clean answers null (JSON's NaN): an allocation big enough collects in every window,
  // so it is said as such and never printed as a number (`Number(null)` would read 0.000 and hide it).
  ok(got.every((r) => Number.isFinite(r.frame) && r.frame < 0.5), `and makes nothing, in 12 of 12 processes (${got.map((r) => (typeof r.frame === 'number' ? r.frame.toFixed(3) : 'no clean window')).join(' ')} B)`);
}

console.log(`\nweaponMark: ${checks} checks passed`);
