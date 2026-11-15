// The stamina row (the speed classes: src/anim/): its place in the body block, the sizes the stylesheet states again
// (src/ui/hud.css against src/ui/hudMath.ts), and what it writes to the page (src/ui/hud.ts).
//
// What is pinned here is what the row was built on:
//
//   * with the speed classes not in force it is not in the block at all, so the two bars above it stand where they
//     stood before the classes;
//   * with them in force it keeps its place while it is down and is only made visible or not, so the bars above do
//     not move each time a sprint begins;
//   * a frame with the pool full and the row down writes nothing, and while it is up it writes only when what it
//     shows has really moved;
//   * and the block with this row and the breath row both up still clears the action bar at every scale.
//
// The display is driven against a stand-in for the DOM that counts every property written, as `breathRow.test.ts`
// and `hudWrites.test.ts` do. Everything here is synthetic: a made-up class and a made-up pool.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUD_SIZES, layout, makeLayout } from '../../../src/ui/hudMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------------------------------------
// The geometry, and the numbers the stylesheet states again.
{
  ok(HUD_SIZES.staminaBarW === HUD_SIZES.healthBarW && HUD_SIZES.staminaBarW === HUD_SIZES.poolBarW, `the stamina bar is as wide as the two above it, so their ends line up (${HUD_SIZES.staminaBarW})`);
  ok(HUD_SIZES.staminaBarH < HUD_SIZES.poolBarH && HUD_SIZES.staminaBarH < HUD_SIZES.breathBarH && HUD_SIZES.staminaRowH >= HUD_SIZES.staminaBarH, `and the thinnest of the block (${HUD_SIZES.staminaBarH}), in a row no shorter than itself (${HUD_SIZES.staminaRowH})`);

  const css = readFileSync(new URL('../../../src/ui/hud.css', import.meta.url), 'utf8');
  const stated: [string, string, keyof typeof HUD_SIZES][] = [
    ['.hud-brow .hud-bar.stamina', 'width', 'staminaBarW'],
    ['.hud-brow .hud-bar.stamina', 'height', 'staminaBarH'],
    ['.hud-brow.stamina-row', 'height', 'staminaRowH'],
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
  ok(drift.length === 0, `every size hud.css states again for the stamina row is the one in HUD_SIZES${drift.length ? `: ${drift.join('; ')}` : ''}`);
  ok(/\.hud-brow\.off\s*\{\s*visibility:\s*hidden;\s*\}/.test(css) && /\.hud-brow\.gone\s*\{\s*display:\s*none;\s*\}/.test(css), 'down, the row is hidden and keeps its place (`off`); with the classes off it is out of the block (`gone`)');
  ok(!/\.hud-brow\.off\s*\{[^}]*display/.test(css), 'and `off` never takes it out of the block: a row that came and went under the two bars above would move both each time a sprint began');
  ok(!new RegExp('\\.hud-bar\\.stamina[^{]*\\{[^}]*background', 'i').test(css) && /\.hud-bar\.good\s*>\s*\.fill/.test(css) && /\.hud-bar\.warn\s*>\s*\.fill/.test(css), 'the bar is given no fill colour of its own: it wears the stylesheet\'s `good` band at rest and `warn` while tired, both from the palette');

  // What the row costs the block's height, by the arithmetic `breathRow.test.ts` uses for the breath row: the floor,
  // the class's name and `.bottom`'s two gaps unscaled; each of the other rows an 11 px line, 4 px apart; this row its
  // own height; the ability cells under them.
  const L = makeLayout();
  const fixed = 14 + 13 + 6 + 6;
  const lineH = 11 * 1.25;
  const blockTop = (lines: number, stamina: boolean, s: number) => fixed + (lines * lineH + (stamina ? HUD_SIZES.staminaRowH : 0) + (lines + (stamina ? 1 : 0) - 1) * 4 + HUD_SIZES.slotSize) * s;
  const scales = [HUD_SIZES.scaleMin, 1, 1.25, HUD_SIZES.scaleMax];
  let clears = true;
  let least = Infinity;
  let worst = '';
  for (const s of scales) {
    const top = blockTop(3, true, s);
    least = Math.min(least, HUD_SIZES.actionBottom * s - top);
    if (top >= HUD_SIZES.actionBottom * s) {
      clears = false;
      worst = `at ${s} the block reaches ${top.toFixed(1)} and the bar sits at ${(HUD_SIZES.actionBottom * s).toFixed(1)}`;
    }
  }
  ok(clears, `the body block with the breath row and the stamina row both up still clears the action bar at every scale (by ${least.toFixed(1)} px at the least)${worst ? `: ${worst}` : ''}`);
  // Without the breath row (every frame not spent under water) it is still the shorter of the two blocks the bar clears.
  let shorter = true;
  for (const s of scales) {
    layout(1280, 720, s, L);
    if (blockTop(2, true, s) >= 720 - L.condition.y) shorter = false;
  }
  ok(shorter, 'and out of the water it is still the shorter of the two blocks the bar has to clear (the ship\'s condition block is the other), so it changes no placement number');
  ok(blockTop(3, true, HUD_SIZES.scaleMax) < 240, `and still fits the shortest window the layout is swept over, 240 px, at the largest scale (${blockTop(3, true, HUD_SIZES.scaleMax).toFixed(0)} px)`);
  const grew = blockTop(2, true, 1) - blockTop(2, false, 1);
  ok(grew === HUD_SIZES.staminaRowH + 4, `with the classes in force the block is ${grew} px taller at scale 1 (the row and one gap), whether the row shows or not; with them off, not at all`);
  ok(blockTop(3, true, HUD_SIZES.scaleMin) < HUD_SIZES.actionBottom * HUD_SIZES.scaleMin && fixed + (4 * lineH + 3 * 4 + HUD_SIZES.slotSize) * HUD_SIZES.scaleMin >= HUD_SIZES.actionBottom * HUD_SIZES.scaleMin, 'which is why the row is held shorter than its number\'s line: as tall as the other rows it would reach the action bar at the smallest scale with the breath row up');
}

// ---------------------------------------------------------------------------------------------
// Where the row sits in the block: read as text, as the breath row's is.
{
  const hud = readFileSync(new URL('../../../src/ui/hud.ts', import.meta.url), 'utf8');
  const body = hud.slice(hud.indexOf('<div class="hud-body">'), hud.indexOf('<div class="hud-kit">'));
  const stamina = body.indexOf('stamina-row');
  ok(stamina > body.indexOf('hp-row') && stamina > body.indexOf('res-row') && body.indexOf('hp-row') > 0, 'the row is the last of the body block: the third bar, under health and the class pool');
  ok(/class="hud-brow stamina-row off gone"/.test(body), 'on the page hidden and out of the block from the start, so a session with the classes off never writes to it and its bars never move');
  ok(/class="hud-bar stamina good"/.test(body) && !/stamina[^>]*ghost/.test(body.slice(stamina)), 'its bar wears the resting band, and carries no ghost: stamina drains and comes back, it is not taken in blows');
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

const kit: any = { id: 'jedi', name: 'Jedi', slots: [], help: [], resource: null, slotActive: () => false, slotCooldown: () => 0, charge: () => 0 };
const rootEl = makeEl();
const hud = new Hud(rootEl);
hud.setKit(kit);
// The elements the display found for the row (the stand-in hands back one element a selector, so these are the very ones).
const row = asked.get('.stamina-row');
const bar = asked.get('.hud-bar.stamina');
const fill = asked.get('.hud-bar.stamina > .fill');
const val = asked.get('.stamina-val');
assert.ok(row && bar && fill && val, 'the display asked the page for the row, its bar, its fill and its number');
// (The stand-in parses no markup: the row starts as the markup has it.)
row.classes.add('off');
row.classes.add('gone');
bar.classes.add('good');

const pool = { value: 100, tired: false };
const frame = (show: boolean, on: boolean) => {
  hud.setStamina(pool, 100, show, on);
  hud.update(0.016, 1, 2, 3, kit, 100, 100, '12:00', '', false, null);
};
frame(false, false);
frame(false, false);

{
  ok(writes(() => { for (let i = 0; i < 120; i++) frame(false, false); }) === 0 && hud.report().stamina === '' && row.classes.has('gone'), 'with the speed classes not in force, a hundred and twenty frames write nothing and the row is not in the block: the display is as it was before them');
  pool.value = 40;
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(true, false); }) === 0 && row.classes.has('gone') && row.classes.has('off'), 'whatever the pool says meanwhile');
  pool.value = 100;
}

{
  const came = writes(() => frame(false, true));
  ok(came === 1 && !row.classes.has('gone') && row.classes.has('off') && hud.report().stamina === 'down', `the classes coming into force put the row in the block with one write, still unseen (wrote ${came})`);
  ok(writes(() => { for (let i = 0; i < 120; i++) frame(false, true); }) === 0, 'and a hundred and twenty frames with the pool full and the row down write nothing at all');
}

{
  pool.value = 99.2;
  const made = writes(() => frame(true, true));
  ok(made === 3 && !row.classes.has('off') && !row.classes.has('gone'), `the row coming up is the row itself, the bar and the number, and nothing more (wrote ${made})`);
  ok(hud.report().stamina === 'Stamina 100' && val.textContent === 'Stamina 100' && fill.style.transform === `scaleX(${Math.round(0.992 * HUD_SIZES.staminaBarW) / HUD_SIZES.staminaBarW})`, `it reads what it shows: the number a ceiling, as health's is, and the bar in steps of its own pixels (${hud.report().stamina})`);
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(true, true); }) === 0, 'sixty frames with the pool standing still write nothing');
}

{
  // A step of the bar is one pixel of its own length; the number beside it is whole points.
  const px = HUD_SIZES.staminaBarW;
  pool.value = (100 * 150) / px;
  frame(true, true);
  pool.value -= 0.2 * (100 / px);
  ok(writes(() => frame(true, true)) === 0, 'a drain that has not crossed a pixel of the bar or a whole point writes nothing');
  pool.value = (100 * 149.4) / px;
  const one = writes(() => frame(true, true));
  ok(one >= 1 && one <= 2, `a pixel of the bar is one write, two where it takes the number with it (wrote ${one})`);
  // A sprint, counted: twelve points a second at sixty frames a second.
  pool.value = 90;
  frame(true, true);
  let total = 0;
  count.writes = 0;
  for (let i = 1; i <= 300; i++) {
    pool.value = 90 - (12 * i) / 60;
    frame(true, true);
  }
  total = count.writes;
  ok(total > 0 && total <= Math.ceil(0.6 * px) + 60 + 2, `five seconds of sprint at sixty frames a second cost ${total} writes in all, against the 300 frames they took: a pixel of the bar and a point of the number at a time`);
}

{
  pool.value = 0;
  pool.tired = true;
  const tired = writes(() => frame(true, true));
  ok(bar.classes.has('warn') && tired >= 1 && tired <= 3 && hud.report().stamina === 'Stamina 0 tired', `emptied, the bar wears the warning band (wrote ${tired})`);
  ok(writes(() => { for (let i = 0; i < 30; i++) frame(true, true); }) === 0, 'and holding there writes nothing more');
  pool.value = 30;
  pool.tired = false;
  frame(true, true);
  ok(!bar.classes.has('warn') && bar.classes.has('good'), 'rested, it is back in the resting band');
}

{
  pool.value = 100;
  frame(true, true);
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(true, true); }) === 0 && !row.classes.has('off'), 'full again the row stays up for its moment, writing nothing');
  const down = writes(() => frame(false, true));
  ok(down === 1 && row.classes.has('off') && !row.classes.has('gone') && hud.report().stamina === 'down', `and goes down with one write, keeping its place in the block (wrote ${down})`);
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(false, true); }) === 0, 'sixty frames after it has gone write nothing');
  // What it held last time must not show for a frame the next time it comes up.
  pool.value = 71.5;
  const again = writes(() => frame(true, true));
  ok(again === 3 && hud.report().stamina === 'Stamina 72', `coming up a second time writes the bar and the number afresh (wrote ${again}): this sprint's numbers, not the last one's`);
}

{
  // The classes switched off while the row is up: out of the block, and nothing more is written while they are off.
  const off = writes(() => frame(true, false));
  ok(off === 2 && row.classes.has('gone') && row.classes.has('off') && hud.report().stamina === '', `the classes switched off take the row out of the block (wrote ${off})`);
  pool.value = 10;
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(true, false); }) === 0, 'and it writes nothing while they are off, whatever the pool does');
  const on = writes(() => frame(true, true));
  ok(on === 4 && !row.classes.has('gone') && !row.classes.has('off') && hud.report().stamina === 'Stamina 10', `switched on again it is back in the block and up, showing the pool as it is now (wrote ${on})`);
}

console.log(`\n${checks} checks passed`);
