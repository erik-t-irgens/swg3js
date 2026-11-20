// The breath bar: its arithmetic (src/ui/hudMath.ts), its place in the body block and what it writes to the page
// (src/ui/hud.ts), and its look in the stylesheet (src/ui/hud.css).
//
// There was no going under water in the game at all, so every number the bar runs on is ours, and since the
// interface rewrite's first wave (19 November 2026) its look is the owner's: no words, thin like stamina, the accent's
// bright blue, on top of the top-most bar, and below 30% of a full breath it flashes white slowly in and out. What is
// pinned here is the promises it was built on:
//
//   * it is there only while it is wanted, and a frame on dry land writes nothing at all;
//   * while it is up it writes only when what it shows has really moved;
//   * and its place in the block is kept whether it shows or not, so it coming up moves nothing already on the screen.
//
// The display is driven against a stand-in for the DOM that counts every property written, exactly as
// `hudWrites.test.ts` does, because the sessions that work on this file cannot watch a profiler.
//
// Everything here is synthetic: a made-up class, made-up breath, nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUD_SIZES, barLayout, breathRow, layout, makeBarLayout, makeBreathRow, makeLayout } from '../../../src/ui/hudMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------------------------------------
// The rule: when the bar is wanted at all.
{
  const b = makeBreathRow();
  ok(breathRow(30, 30, b) === b, 'the answer is written into the caller\'s own struct, so asking allocates nothing');
  ok(!b.show, 'a full breath wants no bar: on dry land there is nothing to say');
  breathRow(30 * HUD_SIZES.breathFull - 1e-6, 30, b);
  ok(b.show, 'and the bar comes up the moment it is not full');
  breathRow(29.999, 30, b);
  ok(!b.show, 'a breath within a thousandth of full is full, so a pool that eases back to its top still lets the bar go down');
  breathRow(0, 30, b);
  ok(b.show && b.share === 0, 'an empty breath is emphatically wanted: an empty bar, not no bar');
  breathRow(-5, 30, b);
  ok(b.show && b.share === 0, 'and one that has gone past empty is an empty bar too, never a negative length');
  breathRow(99, 30, b);
  ok(!b.show && b.share === 1, 'more breath than there is room for is simply full');

  breathRow(10, 0, b);
  ok(!b.show, 'a pool with no maximum is nothing known, so the bar goes down rather than showing a bar at nought');
  breathRow(Number.NaN, 30, b);
  ok(!b.show, 'and so is a value that is not a number');
  breathRow(10, Number.NaN, b);
  ok(!b.show, 'or a maximum that is not one');
  breathRow(10, Number.POSITIVE_INFINITY, b);
  ok(!b.show, 'or a maximum with no end to it');
}

// ---------------------------------------------------------------------------------------------
// The flash: below 30% of a full breath (the owner's), a share of a full breath (the lead's reading of it).
{
  const b = makeBreathRow();
  const lowAt = (share: number) => breathRow(share * 30, 30, b).low;
  ok(HUD_SIZES.breathFlashBelow === 0.3, `the flash starts below ${HUD_SIZES.breathFlashBelow} of a full breath`);
  ok(!lowAt(0.9) && !lowAt(0.5) && !lowAt(HUD_SIZES.breathFlashBelow), 'plenty of breath, and exactly 30%, does not flash');
  ok(lowAt(HUD_SIZES.breathFlashBelow - 1e-6) && lowAt(0.1) && lowAt(0), 'a hair under it, and empty, flashes');
  breathRow(30, 30, b);
  ok(!b.low, 'and a bar that is down is never flashing');
}

// ---------------------------------------------------------------------------------------------
// The geometry and the look: thin like stamina, its place kept, the accent's blue and a flash to ink.
{
  ok(HUD_SIZES.breathBarH === HUD_SIZES.staminaBarH, `breath is thin like stamina (${HUD_SIZES.breathBarH})`);
  const L = makeBarLayout();
  let kept = true;
  for (const align of ['left', 'middle', 'right'] as const) {
    for (const look of ['over', 'inside'] as const) {
      for (const edge of ['lower', 'upper'] as const) {
        barLayout(align, look, edge, true, true, L);
        if (!L.breath.on || L.breath.h !== HUD_SIZES.breathBarH) kept = false;
      }
    }
  }
  ok(kept, 'its box is in the layout in every alignment and look, under water or not, so it coming up moves nothing');
  const css = readFileSync(new URL('../../../src/ui/hud.css', import.meta.url), 'utf8');
  const own = /\.hud-bar\.breath[^{]*\{[^}]*background/i.test(css);
  ok(!own, "the breath bar is given no fill colour of its own: it wears the bar's default, the accent's bright blue");
  ok(/\.hud-bar\.breath\.low\s*>\s*\.fill\s*\{\s*animation:\s*hud-breath-flash\s+var\(--hud-breath-flash, 1s\)\s+ease-in-out\s+infinite\s+alternate;/.test(css), 'low, it flashes: one animation, slowly in and out, started by one class');
  ok(/@keyframes hud-breath-flash \{\s*from \{ background-color: var\(--accent\); \}\s*to \{ background-color: var\(--ink\); \}\s*\}/.test(css), 'from the accent to ink (white, never pure white) and back');
}

// ---------------------------------------------------------------------------------------------
// What the block costs in height, and what that still clears: arithmetic from the stylesheet's own numbers, as the
// action bar's own placement was written against (the comment on `.hud-acts` in `hud.css`). In the middle the mark
// stands over the bars and the action bar under them, the tallest the block is; the bars' box is the layout's, the
// breath's place in it included, so going under water adds nothing.
{
  const L = makeLayout();
  const bars = makeBarLayout();
  barLayout('middle', 'over', 'upper', true, true, bars);
  const fixed = 14 + 6; // the floor, and `.bottom`'s gap: unscaled
  const blockTop = (s: number) => fixed + (HUD_SIZES.markSize + HUD_SIZES.markGap + bars.h + HUD_SIZES.slotSize) * s;
  const scales = [HUD_SIZES.scaleMin, 1, 1.25, HUD_SIZES.scaleMax];
  let clears = true;
  let shorter = true;
  let worst = '';
  for (const s of scales) {
    const top = blockTop(s);
    if (top >= HUD_SIZES.actionBottom * s) {
      clears = false;
      worst = `at ${s} the block reaches ${top.toFixed(0)} and the bar sits at ${(HUD_SIZES.actionBottom * s).toFixed(0)}`;
    }
    layout(1280, 720, s, L);
    if (top >= 720 - L.condition.y) shorter = false;
  }
  ok(clears, `the body block, breath's place and all, still clears the action bar at every scale${worst ? `: ${worst}` : ''}`);
  ok(shorter, 'and is still the shorter of the two blocks the bar has to clear, so it changes no placement number');
  ok(blockTop(HUD_SIZES.scaleMax) < 240, `and it still fits the shortest window the layout is swept over, 240 px, at the largest scale (${blockTop(HUD_SIZES.scaleMax).toFixed(0)} px)`);
}

// ---------------------------------------------------------------------------------------------
// Where the bar sits in the markup. The stand-in below cannot answer this -- it never parses the markup -- so the
// markup is read as text, the way the page test reads the menu.
{
  const hud = readFileSync(new URL('../../../src/ui/hud.ts', import.meta.url), 'utf8');
  const box = hud.slice(hud.indexOf('<div class="hud-bars">'), hud.indexOf('<div class="hud-kit">'));
  const at = (name: string) => box.indexOf(`hud-bar ${name}`);
  ok(at('hp') > 0 && at('pool') > at('hp') && at('stamina') > at('pool') && at('breath') > at('stamina'), 'breath is the last bar in the box, so it is drawn over the others');
  ok(/class="hud-bar breath off"/.test(box), 'on the page and unseen from the start, so a session that never goes near water never writes to it');
  ok(!/breath[^>]*ghost/.test(box) && !/val|Breath/.test(box), 'and it carries no ghost and no words: breath drains, and the bar is the reading');
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
  // The class this bar was built for: the Bounty Hunter has no pool at all, which is why breath could never have
  // borrowed the one bar the display already had.
  resource: null,
  slotActive: () => false,
  slotCooldown: () => 0,
  charge: () => 0,
};

// Health goes away a while after it is full (`hudBars.test.ts` counts that write): held off here, so the counts are
// breath's alone.
const lingerWas = HUD_SIZES.fullLinger;
HUD_SIZES.fullLinger = 1e9;
const hud = new Hud(makeEl());
hud.setKit(kit);
const air = { label: 'Breath', value: 30, max: 30 };
const frame = (breath: { label: string; value: number; max: number } | null | undefined) => hud.update(0.016, 1, 2, 3, kit, 100, 100, '12:00', '', false, breath);

// Two to settle the health bar and the kit's lack of a pool, then the counting starts.
frame(null);
frame(null);

{
  ok(writes(() => { for (let i = 0; i < 120; i++) frame(null); }) === 0, 'a hundred and twenty frames on dry land write nothing at all');
  ok(writes(() => { for (let i = 0; i < 120; i++) frame(undefined); }) === 0, 'and so do a hundred and twenty from a caller that knows nothing about breath');
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(air); }) === 0, 'sixty frames with a full breath write nothing either: full is dry land as far as the bar is concerned');
  ok(hud.report().breath === '', 'and the bar reads as down');
}

{
  const made = writes(() => frame({ label: 'Breath', value: 29, max: 30 }));
  ok(made === 2, `the bar coming up is the bar shown and its fill, and nothing more: no number (wrote ${made})`);
  ok(hud.report().breath === 'Breath 97%', `and it reads what it is showing, for the console (${hud.report().breath})`);
  ok(writes(() => { for (let i = 0; i < 60; i++) frame({ label: 'Breath', value: 29, max: 30 }); }) === 0, 'sixty frames with the breath standing still write nothing');
}

{
  // A step of the bar is one pixel of its own length; the frames below start from a breath that sits exactly on a
  // step, so what is being measured is the guard and not where a rounding happens to fall.
  const px = HUD_TUNE.breathPixels;
  const onAStep = (30 * 154) / px;
  frame({ label: 'Breath', value: onAStep, max: 30 });
  ok(writes(() => frame({ label: 'Breath', value: onAStep - 0.015, max: 30 })) === 0, 'a drain that has not crossed a pixel of the bar writes nothing at all');
  const bar = writes(() => frame({ label: 'Breath', value: (30 * 153.4) / px, max: 30 }));
  ok(bar === 1, `a pixel of the bar is one write (wrote ${bar})`);
  ok(writes(() => frame({ label: 'Breath', value: 27.6, max: 30 })) === 1, 'and a whole unit of air gone is still that one write: there is no number to follow it');
}

{
  // The flash, on the way down: one class, once.
  frame({ label: 'Breath', value: 9.1, max: 30 });
  const low = writes(() => frame({ label: 'Breath', value: 8.9, max: 30 }));
  ok(low === 2, `going under 30% is the flash's class and the bar (wrote ${low})`);
  ok(hud.report().breath === 'Breath 29% low', `and reads so (${hud.report().breath})`);
  frame({ label: 'Breath', value: 4.9, max: 30 });
  ok(writes(() => { for (let i = 0; i < 40; i++) frame({ label: 'Breath', value: 4.9, max: 30 }); }) === 0, 'and flashing there writes nothing more: the stylesheet runs the flash');
}

{
  const gone = writes(() => frame(air));
  ok(gone === 1, `breath back to full takes the bar off with one write (wrote ${gone})`);
  ok(hud.report().breath === '', 'and it reads as down again');
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(air); }) === 0, 'sixty frames after it has gone write nothing');
  // What it held last time must not show for a frame the next time it comes up. This dive ended flashing, so coming
  // up again is the two writes of a first dive and the flash taken off the bar it is still wearing.
  const again = writes(() => frame({ label: 'Breath', value: 29, max: 30 }));
  ok(again === 3, `and coming up a second time writes the bar and the flash afresh (wrote ${again})`);
  ok(hud.report().breath === 'Breath 97%', 'showing this dive\'s breath, not the last one\'s');
}

{
  // A pool the display cannot make sense of takes the bar down rather than drawing a bar at nought.
  const off = writes(() => frame({ label: 'Breath', value: 10, max: 0 }));
  ok(off === 1, `a pool with no maximum takes the bar down (wrote ${off})`);
  ok(writes(() => { for (let i = 0; i < 30; i++) frame({ label: 'Breath', value: 10, max: 0 }); }) === 0, 'and stays down, writing nothing');
}

{
  // The word the caller hands over is not drawn at all now, so a change of it alone writes nothing.
  frame({ label: 'Breath', value: 20, max: 30 });
  ok(writes(() => frame({ label: 'Air', value: 20, max: 30 })) === 0, 'a change of the caller\'s word alone writes nothing: the bar carries no words');
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
  frame(air);
  const seconds = 30;
  const hz = 60;
  count.writes = 0;
  for (let i = 0; i <= seconds * hz; i++) frame({ label: 'Breath', value: seconds - i / hz, max: seconds });
  const total = count.writes;
  frame(air);
  // The bar's own steps, the bar coming up, and the flash starting.
  const cap = HUD_TUNE.breathPixels + 2 + 1;
  ok(total <= cap, `a thirty second dive at sixty frames a second costs ${total} writes in all -- about five a second, against the ${seconds * hz} frames it took -- and cannot cost more than ${cap}`);
  ok(total > 0, 'and more than none, which is what a bar that never wrote would report');
}

HUD_SIZES.fullLinger = lingerWas;
console.log(`\n${checks} checks passed`);
