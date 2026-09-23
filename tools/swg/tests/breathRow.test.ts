// The breath row: its arithmetic (src/ui/hudMath.ts), its place in the body block and what it writes
// to the page (src/ui/hud.ts), and the two sizes the stylesheet states again (src/ui/hud.css).
//
// There was no going under water in the game at all, so every number the row runs on is ours. What is
// pinned here is therefore not faithfulness to anything but the three promises the row was built on:
//
//   * it is there only while it is wanted, and a frame on dry land writes nothing at all;
//   * while it is up it writes only when the number it is showing has really moved;
//   * and it is the *first* row of the block, so that coming up moves nothing that is already on the
//     screen -- the block is anchored at the bottom and grows upward, so a row put in at the top
//     pushes only the class's name, while one put in at the bottom would shift both bars the moment
//     you went under.
//
// The display is driven against a stand-in for the DOM that counts every property written, exactly as
// `hudWrites.test.ts` does, because the sessions that work on this file cannot watch a profiler.
//
// Everything here is synthetic: a made-up class, made-up breath, nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUD_SIZES, barBand, breathRow, layout, makeBreathRow, makeLayout } from '../../../src/ui/hudMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------------------------
// The rule: when the row is wanted at all.
{
  const b = makeBreathRow();
  ok(breathRow(30, 30, b) === b, 'the answer is written into the caller\'s own struct, so asking allocates nothing');
  ok(!b.show, 'a full breath wants no row: on dry land there is nothing to say');
  breathRow(30 * HUD_SIZES.breathFull - 1e-6, 30, b);
  ok(b.show, 'and the row comes up the moment it is not full');
  breathRow(29.999, 30, b);
  ok(!b.show, 'a breath within a thousandth of full is full, so a pool that eases back to its top still lets the row go down');
  breathRow(0, 30, b);
  ok(b.show && b.share === 0, 'an empty breath is emphatically wanted: an empty bar, not no bar');
  breathRow(-5, 30, b);
  ok(b.show && b.share === 0, 'and one that has gone past empty is an empty bar too, never a negative length');
  breathRow(99, 30, b);
  ok(!b.show && b.share === 1, 'more breath than there is room for is simply full');

  breathRow(10, 0, b);
  ok(!b.show, 'a pool with no maximum is nothing known, so the row goes down rather than showing a bar at nought');
  breathRow(Number.NaN, 30, b);
  ok(!b.show, 'and so is a value that is not a number');
  breathRow(10, Number.NaN, b);
  ok(!b.show, 'or a maximum that is not one');
  breathRow(10, Number.POSITIVE_INFINITY, b);
  ok(!b.show, 'or a maximum with no end to it');
}

// ---------------------------------------------------------------------------------------------
// The band: the same one every other bar wears, so the colour means what it already meant.
{
  const b = makeBreathRow();
  const bandAt = (share: number) => breathRow(share * 30, 30, b).band;
  ok(bandAt(0.9) === 'good' && bandAt(0.5) === 'good', 'plenty of breath is the resting band');
  ok(bandAt(HUD_SIZES.bandWarn) === 'good', 'exactly a third is still the resting band');
  ok(bandAt(HUD_SIZES.bandWarn - 1e-9) === 'warn', 'a hair under a third is caution');
  ok(bandAt(HUD_SIZES.bandBad) === 'warn', 'exactly a sixth is still caution');
  ok(bandAt(HUD_SIZES.bandBad - 1e-9) === 'bad' && bandAt(0) === 'bad', 'under a sixth, and empty, is danger');
  let same = true;
  for (let i = 0; i <= 100; i++) if (breathRow(i / 100, 1, b).band !== barBand(i / 100)) same = false;
  ok(same, 'and it is the bar band itself over the whole range, not a second table that could drift from it');
}

// ---------------------------------------------------------------------------------------------
// The geometry: the three bars of the block, and the two numbers the stylesheet states again.
{
  ok(HUD_SIZES.breathBarW === HUD_SIZES.healthBarW && HUD_SIZES.breathBarW === HUD_SIZES.poolBarW, `all three bars of the body block are one width, so their ends line up (${HUD_SIZES.breathBarW})`);
  ok(HUD_SIZES.breathBarH > HUD_SIZES.poolBarH && HUD_SIZES.breathBarH < HUD_SIZES.healthBarH, `and breath's height sits between the class pool's and health's (${HUD_SIZES.poolBarH} < ${HUD_SIZES.breathBarH} < ${HUD_SIZES.healthBarH})`);
  ok(HUD_SIZES.breathFull > 0 && HUD_SIZES.breathFull < 1, 'the "full enough" mark is a share, not a length');

  // `hud.css` cannot read `HUD_SIZES`, so the row's two sizes live in two files; this is what keeps
  // them from drifting, the way `hudMath.test.ts` does for the blocks and `palette.test.ts` for the
  // colours. The sizes for the row above it are checked here too, since the three must agree.
  const css = readFileSync(new URL('../../../src/ui/hud.css', import.meta.url), 'utf8');
  const stated: [string, string, keyof typeof HUD_SIZES][] = [
    ['.hud-brow .hud-bar.breath', 'width', 'breathBarW'],
    ['.hud-brow .hud-bar.breath', 'height', 'breathBarH'],
    ['.hud-brow .hud-bar.hp', 'width', 'healthBarW'],
    ['.hud-brow .hud-bar.hp', 'height', 'healthBarH'],
    ['.hud-brow .hud-bar.pool', 'width', 'poolBarW'],
    ['.hud-brow .hud-bar.pool', 'height', 'poolBarH'],
  ];
  const drift: string[] = [];
  for (const [selector, prop, key] of stated) {
    const block = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    if (!block) {
      drift.push(`${selector} is not in hud.css`);
      continue;
    }
    const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:[^;]*?calc\\(\\s*([0-9.]+)px\\s*\\*\\s*var\\(--hud-scale\\)`).exec(block[1]);
    if (!m) {
      drift.push(`${selector} states no ${prop} on the HUD scale`);
      continue;
    }
    if (Number(m[1]) !== HUD_SIZES[key]) drift.push(`${selector} ${prop}: stylesheet ${m[1]}, table ${key}=${HUD_SIZES[key]}`);
  }
  ok(drift.length === 0, `every size hud.css states again for the three bars is the one in HUD_SIZES${drift.length ? `: ${drift.join('; ')}` : ''}`);

  // The row takes no colour of its own: it wears the bar's default fill until the display puts a band
  // on it, so there is nothing here that could become a nineteenth colour.
  const own = new RegExp('\\.hud-bar\\.breath[^{]*\\{[^}]*background', 'i').test(css);
  ok(!own, 'and the breath bar is given no fill colour of its own, so it cannot drift off the palette');
  ok(/\.hud-bar\.warn\s*>\s*\.fill/.test(css) && /\.hud-bar\.bad\s*>\s*\.fill/.test(css), 'the two bands it does wear are the stylesheet\'s own, shared with every other bar');
}

// ---------------------------------------------------------------------------------------------
// What the row costs the block's height, and what that still clears. This is arithmetic from the
// stylesheet's own numbers and not a measurement in a browser -- no session here can lay out a page --
// but it is the arithmetic the action bar's own placement was written against (the comment on
// `.hud-acts` in `hud.css`), so a row that broke it would be caught here rather than on the screen.
//
// From the stylesheet: `.bottom` stands 14 px off the floor and keeps a 6 px gap between the class
// name (an 11 px line), the bars and the ability cells, none of which scale; inside `.hud-body` each
// row is an 11 px line beside its bar at the HUD scale, 4 px apart. A row is therefore as tall as its
// line box, which is taller than any of the three bars -- so the breath row is exactly as tall as the
// health row, and the block grows by one row and one gap whatever height its bar is given.
{
  const L = makeLayout();
  const fixed = 14 + 13 + 6 + 6; // the floor, the class name, and `.bottom`'s two gaps: unscaled
  const lineH = 11 * 1.25; // an upper bound on an 11 px line box in the interface's own face
  const blockTop = (rows: number, s: number) => fixed + (rows * lineH + (rows - 1) * 4 + HUD_SIZES.slotSize) * s;
  const scales = [HUD_SIZES.scaleMin, 1, 1.25, HUD_SIZES.scaleMax];

  let clears = true;
  let shorter = true;
  let worst = '';
  for (const s of scales) {
    const top = blockTop(3, s);
    if (top >= HUD_SIZES.actionBottom * s) {
      clears = false;
      worst = `at ${s} the block reaches ${top.toFixed(0)} and the bar sits at ${(HUD_SIZES.actionBottom * s).toFixed(0)}`;
    }
    // The ship's condition block is the taller of the two and is what `actionBottom` was set by.
    layout(1280, 720, s, L);
    if (top >= 720 - L.condition.y) shorter = false;
  }
  ok(clears, `the body block with the breath row up still clears the action bar at every scale${worst ? `: ${worst}` : ''}`);
  ok(shorter, 'and is still the shorter of the two blocks the bar has to clear, so it changes no placement number');
  ok(blockTop(3, HUD_SIZES.scaleMax) < 240, `and it still fits the shortest window the layout is swept over, 240 px, at the largest scale (${blockTop(3, HUD_SIZES.scaleMax).toFixed(0)} px)`);
  const grew = blockTop(3, 1) - blockTop(2, 1);
  ok(grew > 0 && grew < HUD_SIZES.healthBarH * 2, `going under water makes the block ${grew.toFixed(1)} px taller at scale 1, which is one row and one gap`);
}

// ---------------------------------------------------------------------------------------------
// Where the row sits in the block. The stand-in below cannot answer this -- it never parses the
// markup -- so the markup is read as text, the way the page test reads the menu.
{
  const hud = readFileSync(new URL('../../../src/ui/hud.ts', import.meta.url), 'utf8');
  const body = hud.slice(hud.indexOf('<div class="hud-body">'), hud.indexOf('<div class="hud-kit">'));
  const breath = body.indexOf('breath-row');
  const health = body.indexOf('hp-row');
  const pool = body.indexOf('res-row');
  ok(breath > 0 && health > 0 && pool > 0, 'the body block holds all three rows');
  ok(breath < health && health < pool, 'and breath is the first of them, above health, so coming up moves nothing already on the screen');
  ok(/class="hud-brow breath-row" hidden/.test(body), 'the row is on the page hidden from the start, so a session that never goes near water never writes to it');
  ok(!/breath[^>]*ghost/.test(body), 'and it carries no ghost: breath drains, it does not arrive in blows');
}

// ---------------------------------------------------------------------------------------------
// What it writes. The stand-in for the page, as `hudWrites.test.ts` has it.
const count = { writes: 0 };

function styleBag(): Record<string, string> {
  const bag: Record<string, any> = {
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

function makeEl(): any {
  const found = new Map<string, any>();
  const el: any = {
    style: styleBag(),
    classList: {
      toggle() {
        count.writes++;
      },
    },
    setAttribute() {
      count.writes++;
    },
    appendChild() {
      count.writes++;
    },
    querySelector(sel: string) {
      let hit = found.get(sel);
      if (!hit) {
        hit = makeEl();
        found.set(sel, hit);
      }
      return hit;
    },
    querySelectorAll: () => [makeEl(), makeEl()],
    get firstElementChild() {
      return el.querySelector(':first-child');
    },
  };
  let text = '';
  let html = '';
  let cls = '';
  let hidden = false;
  Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => { count.writes++; text = String(v); } });
  Object.defineProperty(el, 'innerHTML', { get: () => html, set: (v) => { count.writes++; html = String(v); } });
  Object.defineProperty(el, 'className', { get: () => cls, set: (v) => { count.writes++; cls = String(v); } });
  Object.defineProperty(el, 'hidden', { get: () => hidden, set: (v) => { count.writes++; hidden = !!v; } });
  return el;
}

(globalThis as any).document = { createElement: () => makeEl() };

const { Hud, HUD_TUNE } = await import('../../../src/ui/hud.ts');

function writes(what: () => void): number {
  count.writes = 0;
  what();
  return count.writes;
}

const kit: any = {
  id: 'bounty_hunter',
  name: 'Bounty Hunter',
  slots: [],
  help: [],
  // The class this row was built for: the Bounty Hunter has no pool at all, which is why breath could
  // never have borrowed the one bar the display already had.
  resource: null,
  slotActive: () => false,
  slotCooldown: () => 0,
  charge: () => 0,
};

const hud = new Hud(makeEl());
hud.setKit(kit);
const air = { label: 'Breath', value: 30, max: 30 };
const frame = (breath: { label: string; value: number; max: number } | null | undefined) => hud.update(0.016, 1, 2, 3, kit, 100, 100, '12:00', '', false, breath);

// Two to settle the health bar and the clock, then the counting starts.
frame(null);
frame(null);

{
  ok(writes(() => { for (let i = 0; i < 120; i++) frame(null); }) === 0, 'a hundred and twenty frames on dry land write nothing at all');
  ok(writes(() => { for (let i = 0; i < 120; i++) frame(undefined); }) === 0, 'and so do a hundred and twenty from a caller that knows nothing about breath');
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(air); }) === 0, 'sixty frames with a full breath write nothing either: full is dry land as far as the row is concerned');
  ok(hud.report().breath === '', 'and the row reads as down');
}

{
  const made = writes(() => frame({ label: 'Breath', value: 29, max: 30 }));
  ok(made === 3, `the row coming up is the row itself, the bar and the number, and nothing more (wrote ${made})`);
  ok(hud.report().breath === 'Breath 29', `and it reads what it is showing (${hud.report().breath})`);
  ok(writes(() => { for (let i = 0; i < 60; i++) frame({ label: 'Breath', value: 29, max: 30 }); }) === 0, 'sixty frames with the breath standing still write nothing');
}

{
  // A step of the bar is one pixel of its own length (a breath of 30 over 160 steps is 0.1875 of it);
  // the number beside it is whole units. The three frames below start from a breath that sits exactly
  // on a step, so what is being measured is the guard and not where a rounding happens to fall.
  const px = HUD_TUNE.breathPixels;
  const onAStep = (30 * 154) / px; // 28.875, which is step 154 of 160 exactly
  frame({ label: 'Breath', value: onAStep, max: 30 });
  ok(writes(() => frame({ label: 'Breath', value: onAStep - 0.015, max: 30 })) === 0, 'a drain that has not crossed a pixel of the bar writes nothing at all');
  const bar = writes(() => frame({ label: 'Breath', value: (30 * 153.4) / px, max: 30 }));
  ok(bar === 1, `a pixel of the bar with the number unmoved is one write (wrote ${bar})`);
  // The number is a ceiling, as the health bar's own is and for its reason -- a thing that is still
  // there must never read nought -- so it moves when the air crosses a whole unit, not a half one.
  const both = writes(() => frame({ label: 'Breath', value: 27.6, max: 30 }));
  ok(both === 2, `and a pixel that takes the number with it is two (wrote ${both})`);
}

{
  // The bands, on the way down. Each is two class toggles, and there are at most two of them in a dive.
  frame({ label: 'Breath', value: 11, max: 30 });
  const warn = writes(() => frame({ label: 'Breath', value: 9.9, max: 30 }));
  ok(warn === 4, `going to caution is the two band classes, the bar and the number (wrote ${warn})`);
  frame({ label: 'Breath', value: 5.5, max: 30 });
  const bad = writes(() => frame({ label: 'Breath', value: 4.9, max: 30 }));
  ok(bad === 4, `and going to danger is the same four (wrote ${bad})`);
  ok(writes(() => { for (let i = 0; i < 40; i++) frame({ label: 'Breath', value: 4.9, max: 30 }); }) === 0, 'and holding there writes nothing more');
}

{
  const gone = writes(() => frame(air));
  ok(gone === 1, `breath back to full takes the row off the page with one write (wrote ${gone})`);
  ok(hud.report().breath === '', 'and it reads as down again');
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(air); }) === 0, 'sixty frames after it has gone write nothing');
  // What it held last time must not show for a frame the next time it comes up. This dive ended in
  // danger, so coming up again is the three writes of a first dive plus the two toggles that take the
  // danger band back off the bar it is still wearing under the hidden row.
  const again = writes(() => frame({ label: 'Breath', value: 29, max: 30 }));
  ok(again === 5, `and coming up a second time writes the bar, the number and the band afresh (wrote ${again})`);
  ok(hud.report().breath === 'Breath 29', 'showing this dive\'s numbers, not the last one\'s');
}

{
  // A pool the display cannot make sense of takes the row down rather than drawing a bar at nought.
  const off = writes(() => frame({ label: 'Breath', value: 10, max: 0 }));
  ok(off === 1, `a pool with no maximum takes the row down (wrote ${off})`);
  ok(writes(() => { for (let i = 0; i < 30; i++) frame({ label: 'Breath', value: 10, max: 0 }); }) === 0, 'and stays down, writing nothing');
}

{
  // The word beside the number is the caller's, so whoever holds the breath can call it what they like
  // and the row follows without being taught the word.
  frame({ label: 'Breath', value: 20, max: 30 });
  const renamed = writes(() => frame({ label: 'Air', value: 20, max: 30 }));
  ok(renamed === 1, `a change of the word alone is one write (wrote ${renamed})`);
  ok(hud.report().breath === 'Air 20', 'and the row says the new one');
}

{
  // The step is live, like every other one in the table.
  const before = HUD_TUNE.breathPixels;
  hud.tune({ breathPixels: 20 });
  ok(HUD_TUNE.breathPixels === 20, 'the breath step is one of the steps the console may try');
  ok(writes(() => frame({ label: 'Air', value: 20, max: 30 })) > 0, 'and what was drawn at the old step is written again at the new one');
  hud.tune({ breathPixels: before });
  frame({ label: 'Air', value: 20, max: 30 });
}

// ---------------------------------------------------------------------------------------------
// The whole of a dive, counted: what one trip under water costs the page from first breath to last.
{
  const seconds = 30;
  const hz = 60;
  let total = 0;
  count.writes = 0;
  for (let i = 0; i <= seconds * hz; i++) frame({ label: 'Breath', value: seconds - i / hz, max: seconds });
  total = count.writes;
  frame(air);
  // The bar's own steps, one a second for the number, the row coming up, and its two changes of band.
  const cap = HUD_TUNE.breathPixels + seconds + 3 + 4 + 4;
  ok(total <= cap, `a thirty second dive at sixty frames a second costs ${total} writes in all -- about six a second, against the ${seconds * hz} frames it took -- and cannot cost more than ${cap}`);
  ok(total > 0, 'and more than none, which is what a row that never wrote would report');
}

console.log(`\n${checks} checks passed`);
