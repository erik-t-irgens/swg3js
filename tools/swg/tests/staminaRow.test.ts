// The stamina bar (the speed classes: src/anim/): its place in the body block, its look (src/ui/hud.css against
// src/ui/hudMath.ts), and what it writes to the page (src/ui/hud.ts).
//
// Since the interface rewrite's first wave (19 November 2026) it is no row of its own: it is attached to the Force bar
// as Force is to health (laid over Force's outer edge, or inside health on the edge Force does not use), takes Force's
// place against health with no Force, carries no words, and is as thin as it was (`barLayout`, `barLayout.test` in
// `hudBars.test.ts`). What is pinned here is what it was built on:
//
//   * with the speed classes not in force it is not in the block at all, and the bars are placed without it;
//   * with them in force it keeps its place while it is down and is only made visible or not, so nothing moves each
//     time a sprint begins;
//   * a frame with the pool full and the bar down writes nothing, and while it is up it writes only when what it
//     shows has really moved.
//
// The display is driven against a stand-in for the DOM that counts every property written, as `breathRow.test.ts`
// and `hudWrites.test.ts` do. Everything here is synthetic: a made-up class and a made-up pool.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUD_SIZES, barLayout, makeBarLayout } from '../../../src/ui/hudMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------------------------------------
// The geometry, and the look.
{
  ok(HUD_SIZES.staminaBarH === 4 && HUD_SIZES.staminaBarH <= HUD_SIZES.poolBarH && HUD_SIZES.staminaBarH <= HUD_SIZES.healthBarH, `the stamina bar is as thin as it was, and the thinnest of the block with breath (${HUD_SIZES.staminaBarH})`);
  // Its place is the same whether it shows or not: the layout knows only whether the classes are in force.
  const a = makeBarLayout();
  const b = makeBarLayout();
  barLayout('middle', 'over', 'lower', true, true, a);
  barLayout('middle', 'over', 'lower', true, false, b);
  ok(a.stamina.on && !b.stamina.on && a.hp.x === b.hp.x && a.pool.w === b.pool.w, 'with the classes off it is out of the layout, and the bars it was attached to keep their length');

  const css = readFileSync(new URL('../../../src/ui/hud.css', import.meta.url), 'utf8');
  ok(/\.hud-bars > \.hud-bar\.off \{ opacity: 0; \}/.test(css) && /\.hud-bars > \.hud-bar\.gone \{ display: none; \}/.test(css), 'down, the bar is unseen and keeps its place (`off`); with the classes off it is out of the block (`gone`)');
  ok(!/\.hud-bars > \.hud-bar\.off\s*\{[^}]*display/.test(css), 'and `off` never takes it out of the block');
  ok(!new RegExp('\\.hud-bar\\.stamina[^{]*\\{[^}]*background', 'i').test(css) && /\.hud-bar\.good\s*>\s*\.fill/.test(css) && /\.hud-bar\.warn\s*>\s*\.fill/.test(css), 'the bar is given no fill colour of its own: it wears the stylesheet\'s `good` band at rest and `warn` while tired, both from the palette');
}

// ---------------------------------------------------------------------------------------------
// Where the bar sits in the markup: read as text, as the breath bar's is.
{
  const hud = readFileSync(new URL('../../../src/ui/hud.ts', import.meta.url), 'utf8');
  const box = hud.slice(hud.indexOf('<div class="hud-bars">'), hud.indexOf('<div class="hud-kit">'));
  const stamina = box.indexOf('hud-bar stamina');
  ok(stamina > box.indexOf('hud-bar hp') && stamina > box.indexOf('hud-bar pool') && box.indexOf('hud-bar hp') > 0, 'the bar comes after health and Force in the box, so it is drawn over the bar it is attached to');
  ok(/class="hud-bar stamina good off gone"/.test(box), 'on the page unseen and out of the block from the start, so a session with the classes off never writes to it');
  ok(!/stamina[^>]*ghost/.test(box.slice(stamina, box.indexOf('hud-bar breath'))) && !/val|Stamina/.test(box), 'it wears the resting band, carries no ghost and no words: stamina drains and comes back, and the bar is the reading');
}

// ---------------------------------------------------------------------------------------------
// What it writes. The stand-in for the page, as `breathRow.test.ts` has it, which also keeps each element's classes.
const count = { writes: 0 };
/** Every element the display asked the page for, by the selector it asked with (whichever element it asked). */
const asked = new Map<string, any>();

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
  const classes = new Set<string>();
  const el: any = {
    style: styleBag(),
    classes,
    classList: {
      toggle(name: string, force?: boolean) {
        count.writes++;
        const on = force === undefined ? !classes.has(name) : force;
        if (on) classes.add(name);
        else classes.delete(name);
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
        asked.set(sel, hit);
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

const { Hud } = await import('../../../src/ui/hud.ts');

function writes(what: () => void): number {
  count.writes = 0;
  what();
  return count.writes;
}

// Health goes away a while after it is full (`hudBars.test.ts` counts that write): held off here.
const lingerWas = HUD_SIZES.fullLinger;
HUD_SIZES.fullLinger = 1e9;
const kit: any = { id: 'jedi', name: 'Jedi', slots: [], help: [], resource: null, slotActive: () => false, slotCooldown: () => 0, charge: () => 0 };
const rootEl = makeEl();
const hud = new Hud(rootEl);
hud.setKit(kit);
// The elements the display found for the bar (the stand-in hands back one element a selector, so these are the very ones).
const bar = asked.get('.hud-bar.stamina');
const fill = asked.get('.hud-bar.stamina > .fill');
assert.ok(bar && fill, 'the display asked the page for the bar and its fill');
// (The stand-in parses no markup: the bar starts as the markup has it.)
bar.classes.add('off');
bar.classes.add('gone');
bar.classes.add('good');

const pool = { value: 100, tired: false };
const frame = (show: boolean, on: boolean) => {
  hud.setStamina(pool, 100, show, on);
  hud.update(0.016, 1, 2, 3, kit, 100, 100, '12:00', '', false, null);
};
/** The writes `what` made that are the bar's own, the bars' placing (counted by the display as by design) left out. */
function own(what: () => void): number {
  const d0 = hud.stats().byDesignNow;
  const all = writes(what);
  return all - (hud.stats().byDesignNow - d0);
}
frame(false, false);
frame(false, false);

{
  ok(writes(() => { for (let i = 0; i < 120; i++) frame(false, false); }) === 0 && hud.report().stamina === '' && bar.classes.has('gone'), 'with the speed classes not in force, a hundred and twenty frames write nothing and the bar is not in the block');
  pool.value = 40;
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(true, false); }) === 0 && bar.classes.has('gone') && bar.classes.has('off'), 'whatever the pool says meanwhile');
  pool.value = 100;
}

{
  const d0 = hud.stats().byDesignNow;
  const came = own(() => frame(false, true));
  ok(came === 1 && !bar.classes.has('gone') && bar.classes.has('off') && hud.report().stamina === 'down', `the classes coming into force put the bar in the block with one write of its own, still unseen (wrote ${came})`);
  ok(hud.stats().byDesignNow > d0, 'and the bars are placed again with it, by design (its box takes room under health)');
  ok(writes(() => { for (let i = 0; i < 120; i++) frame(false, true); }) === 0, 'and a hundred and twenty frames with the pool full and the bar down write nothing at all');
}

{
  pool.value = 99.2;
  const made = writes(() => frame(true, true));
  ok(made === 2 && !bar.classes.has('off') && !bar.classes.has('gone'), `the bar coming up is the bar shown and its fill, and nothing more: no number (wrote ${made})`);
  ok(hud.report().stamina === 'Stamina 99%' && fill.style.transform === `scaleX(${Math.round(0.992 * HUD_SIZES.staminaBarW) / HUD_SIZES.staminaBarW})`, `it reads what it shows, in steps of the long bar's pixels (${hud.report().stamina})`);
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(true, true); }) === 0, 'sixty frames with the pool standing still write nothing');
}

{
  // A step of the bar is one pixel of the long bar's length.
  const px = HUD_SIZES.staminaBarW;
  pool.value = (100 * 150) / px;
  frame(true, true);
  pool.value -= 0.2 * (100 / px);
  ok(writes(() => frame(true, true)) === 0, 'a drain that has not crossed a pixel of the bar writes nothing');
  pool.value = (100 * 149.4) / px;
  ok(writes(() => frame(true, true)) === 1, 'a pixel of the bar is one write');
  // A sprint, counted: twelve points a second at sixty frames a second.
  pool.value = 90;
  frame(true, true);
  count.writes = 0;
  for (let i = 1; i <= 300; i++) {
    pool.value = 90 - (12 * i) / 60;
    frame(true, true);
  }
  const total = count.writes;
  ok(total > 0 && total <= Math.ceil(0.6 * px) + 2, `five seconds of sprint at sixty frames a second cost ${total} writes in all, against the 300 frames they took: a pixel of the bar at a time`);
}

{
  pool.value = 0;
  pool.tired = true;
  const tired = writes(() => frame(true, true));
  ok(bar.classes.has('warn') && tired >= 1 && tired <= 2 && hud.report().stamina === 'Stamina 0% tired', `emptied, the bar wears the warning band (wrote ${tired})`);
  ok(writes(() => { for (let i = 0; i < 30; i++) frame(true, true); }) === 0, 'and holding there writes nothing more');
  pool.value = 30;
  pool.tired = false;
  frame(true, true);
  ok(!bar.classes.has('warn') && bar.classes.has('good'), 'rested, it is back in the resting band');
}

{
  pool.value = 100;
  frame(true, true);
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(true, true); }) === 0 && !bar.classes.has('off'), 'full again the bar stays up for its moment, writing nothing');
  const down = writes(() => frame(false, true));
  ok(down === 1 && bar.classes.has('off') && !bar.classes.has('gone') && hud.report().stamina === 'down', `and goes down with one write, keeping its place in the block (wrote ${down})`);
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(false, true); }) === 0, 'sixty frames after it has gone write nothing');
  // What it held last time must not show for a frame the next time it comes up.
  pool.value = 71.5;
  const again = writes(() => frame(true, true));
  ok(again === 2 && hud.report().stamina === 'Stamina 71%', `coming up a second time writes the bar afresh (wrote ${again}): this sprint's pool, not the last one's`);
}

{
  // The classes switched off while the bar is up: out of the block, and nothing more is written while they are off.
  const off = own(() => frame(true, false));
  ok(off === 2 && bar.classes.has('gone') && bar.classes.has('off') && hud.report().stamina === '', `the classes switched off take the bar out of the block (wrote ${off} of its own, and the bars placed again)`);
  pool.value = 10;
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(true, false); }) === 0, 'and it writes nothing while they are off, whatever the pool does');
  const on = own(() => frame(true, true));
  ok(on === 3 && !bar.classes.has('gone') && !bar.classes.has('off') && hud.report().stamina === 'Stamina 10%', `switched on again it is back in the block and up, showing the pool as it is now (wrote ${on} of its own)`);
}

HUD_SIZES.fullLinger = lingerWas;
console.log(`\n${checks} checks passed`);
