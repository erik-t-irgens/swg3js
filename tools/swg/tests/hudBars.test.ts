// The body block of the interface rewrite's first wave (19 November 2026, the owner's notes and answers): the bars with
// no words, where they stand against each other (`barLayout` in src/ui/hudMath.ts), how the stylesheet draws them
// (src/ui/hud.css), what the display writes for them and for the corner's three readouts (src/ui/hud.ts), the
// Interface page's six switches (src/ui/hudPage.ts, src/core/settings.ts), the debug menu's dials (src/ui/hudDials.ts),
// and, in twelve fresh processes at once, nothing made by a steady frame of the display.
//
// What is pinned, by the owner's words:
//   * health as thick as the Force bar was (6), 160 long; Force against it with no gap, laid over its edge (half over,
//     in front) or inside it (a pill along the edge, the half outside not drawn), on the lower or the upper edge; at the
//     sides 75% of the bar it is on, lined up with the outer end, in the middle 60%, centred; stamina to Force as Force
//     is to health, taking Force's place with no Force and keeping its own size; breath on top of the top-most bar;
//   * rounded at the end away from the screen's edge and flat at it, in the middle rounded at both, and the right a
//     mirror of the left;
//   * health muted down to 40%, the dark red at and below it, eased; a ripple of bright red below 30%;
//   * health and Force going 1.5 s after they are full, back the moment they drop, and nothing moving when one goes;
//   * the frame rate, the weather's word and the clock each a switch, written only when they change.
//
// Everything here is synthetic: stand-ins for the page, a made-up kit and made-up numbers. Run: node tools/swg/tests/hudBars.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HUD_SIZES, barLayout, makeBarLayout, tuneSizes, type BarBox, type BarLayout, type BlockAlign, type ForceEdge, type ForceLook } from '../../../src/ui/hudMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
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
function testKit(): Any {
  return {
    id: 'jedi',
    name: 'Jedi',
    slots: [{ key: '1', name: 'Force jump', cost: '20' }],
    resource: { label: 'Force', value: 100, max: 100 },
    slotActive: () => false,
    slotCooldown: () => 0,
    charge: () => 0,
  };
}

const { Hud } = await import('../../../src/ui/hud.ts');

// ---------------------------------------------------------------- 6 (child). a steady frame of the display, alone
if (ALLOC) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const parent = new El();
  const hud = new Hud(parent as Any);
  const kit = testKit();
  kit.resource.value = 61.5;
  // The action bar's cell cooling with its fill running (the second wave, item 7), and a source the presses are asked of
  // every frame: the cell's model of its fill is worked out each frame and must make nothing either.
  let cd = 0;
  kit.slotCooldown = () => cd;
  hud.setInput({ bindings: { slot1: ['Digit1'], saberToggle: ['KeyL'] }, pressedAction: () => false });
  hud.setKit(kit);
  hud.setReadouts(true, true, true);
  hud.setBlock('left', 'inside', 'upper');
  const pool = { value: 47.25, tired: false };
  const breath = { label: 'Breath', value: 7.5, max: 30 };
  // Health under 30% (the dark red and the ripple on), Force and stamina part spent, breath low and flashing: every bar
  // up and every look on, and the clock held still, so the quarter-second lines (whose words are made by design) do not
  // fall inside the window: what is measured is a frame with nothing to write.
  const step = () => {
    hud.setStamina(pool, 100, true, true);
    hud.setWeather('Downpour', true);
    hud.update(0.016, 1, 2, 3, kit, 25.5, 100, '12:00', 'Bantha', false, breath);
  };
  cd = 1;
  step();
  cd = 0.9935;
  step();
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
  console.log(JSON.stringify({ frame: best, writes: writes(step), filling: (hud as Any).slots[0].anim === true && (hud as Any).slots[0].ready === false }));
  process.exit(0);
}

// ---------------------------------------------------------------- 1. where the bars stand (`barLayout`)
const S = HUD_SIZES;
const L = makeBarLayout();
const ALIGNS: BlockAlign[] = ['left', 'middle', 'right'];
const LOOKS: ForceLook[] = ['over', 'inside'];
const EDGES: ForceEdge[] = ['lower', 'upper'];
/** What a box shows, top and bottom, its clipped half left out. */
const top = (b: BarBox) => (b.clipTop ? b.y + b.h / 2 : b.y);
const bottom = (b: BarBox) => (b.clipBottom ? b.y + b.h / 2 : b.y + b.h);
{
  ok(S.healthBarW === 160 && S.healthBarH === 6 && S.poolBarH === 6 && S.staminaBarH === 4 && S.breathBarH === 4, 'health 160 long and as thick as the Force bar was (6), Force 6, stamina and breath 4');
  ok(S.barSideShare === 0.75 && S.barMiddleShare === 0.6 && S.hpLow === 0.4 && S.hpRipple === 0.3 && S.fullLinger === 1.5 && S.breathFlashBelow === 0.3, "the owner's shares and times: 75% and 60%, 40% and 30%, 1.5 s, breath's 30%");
  const wrong: string[] = [];
  for (const align of ALIGNS) {
    for (const look of LOOKS) {
      for (const edge of EDGES) {
        for (const force of [true, false]) {
          for (const stamina of [true, false]) {
            barLayout(align, look, edge, force, stamina, L);
            const tag = `${align}/${look}/${edge}${force ? '' : '/no force'}${stamina ? '' : '/no stamina'}`;
            const share = align === 'middle' ? S.barMiddleShare : S.barSideShare;
            const lower = edge === 'lower';
            const { hp, pool, stamina: st, breath: br } = L;
            if (!(hp.on && hp.w === S.healthBarW && hp.h === S.healthBarH && hp.x === 0)) wrong.push(`${tag}: health`);
            if (pool.on !== force || st.on !== stamina || !br.on) wrong.push(`${tag}: which bars are in`);
            // Force: its middle on health's edge, so half of it lies over health (laid over) or shows (inside).
            if (force) {
              if (!near(pool.w, hp.w * share) || !near(pool.y + pool.h / 2, lower ? hp.y + hp.h : hp.y)) wrong.push(`${tag}: Force's length or its middle on the edge`);
              const clip = look === 'inside';
              if (pool.clipBottom !== (clip && lower) || pool.clipTop !== (clip && !lower)) wrong.push(`${tag}: Force's clipped half`);
            }
            // Stamina: a share of Force's length (its own size even with no Force).
            if (stamina) {
              if (!near(st.w, hp.w * share * share)) wrong.push(`${tag}: stamina's length`);
              if (look === 'over') {
                const on = force ? (lower ? pool.y + pool.h : pool.y) : lower ? hp.y + hp.h : hp.y;
                if (!near(st.y + st.h / 2, on) || st.clipTop || st.clipBottom) wrong.push(`${tag}: stamina on Force's outer edge (or health's with none)`);
              } else {
                const up = force ? lower : !lower;
                if (!near(st.y + st.h / 2, up ? hp.y : hp.y + hp.h) || st.clipTop !== up || st.clipBottom !== !up) wrong.push(`${tag}: stamina inside health on the edge Force does not use`);
              }
            }
            // Breath on top of the top-most bar.
            if (look === 'over') {
              let topmost: BarBox = hp;
              if (pool.on && pool.y < topmost.y) topmost = pool;
              if (st.on && st.y < topmost.y) topmost = st;
              if (!near(br.y + br.h / 2, topmost.y) || !near(br.w, topmost.w * share)) wrong.push(`${tag}: breath on the top-most bar`);
            } else if (!near(br.y + br.h, hp.y) || !near(br.w, hp.w * share)) wrong.push(`${tag}: breath against health's top`);
            // Rounded away from the screen's edge, flat at it; both in the middle; lined up with the outer end at the sides.
            for (const b of [hp, pool, st, br]) {
              if (!b.on) continue;
              if (b.roundL !== (align !== 'left') || b.roundR !== (align !== 'right')) wrong.push(`${tag}: an end's rounding`);
              const x = align === 'left' ? 0 : align === 'right' ? hp.w - b.w : (hp.w - b.w) / 2;
              if (!near(b.x, x)) wrong.push(`${tag}: a bar's place along`);
            }
            // The area holds every shown part, the highest at its top.
            let lo = Infinity;
            let hi = -Infinity;
            for (const b of [hp, pool, st, br]) {
              if (!b.on) continue;
              lo = Math.min(lo, top(b));
              hi = Math.max(hi, bottom(b));
            }
            if (!near(lo, 0) || !near(hi, L.h) || L.w !== hp.w) wrong.push(`${tag}: the area (${lo}..${hi} against ${L.h})`);
          }
        }
      }
    }
  }
  ok(wrong.length === 0, `in every alignment, look, edge, with and without Force and stamina, each bar stands where the owner's words put it (${wrong.slice(0, 6).join('; ') || 'all 48'})`);
  // The right is the left's mirror image.
  const a = makeBarLayout();
  const b = makeBarLayout();
  let mirrored = true;
  for (const look of LOOKS) {
    for (const edge of EDGES) {
      barLayout('left', look, edge, true, true, a);
      barLayout('right', look, edge, true, true, b);
      for (const k of ['hp', 'pool', 'stamina', 'breath'] as const) {
        const p = a[k];
        const q = b[k];
        if (!near(q.x, a.w - p.x - p.w) || q.y !== p.y || q.w !== p.w || q.roundL !== p.roundR || q.roundR !== p.roundL || q.clipTop !== p.clipTop) mirrored = false;
      }
    }
  }
  ok(mirrored, 'and the right is the left mirrored, bar for bar');
  // Laid over, Force is drawn in front of health and stamina in front of Force: the markup's order, read as text.
  const hud = readFileSync(new URL('../../../src/ui/hud.ts', import.meta.url), 'utf8');
  const box = hud.slice(hud.indexOf('<div class="hud-bars">'), hud.indexOf('<div class="hud-kit">'));
  const order = ['hp', 'pool', 'stamina', 'breath'].map((n) => box.indexOf(`"hud-bar ${n}`));
  ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'drawn health, Force, stamina, breath, each over the one before it');
  ok(!/Health|Force \$|class="val/.test(box), 'and none of them carries a word or a number');
  // The mark has its place in every alignment: the box before the bars in `.hud-top`, the action bar under both.
  const block = hud.slice(hud.indexOf('<div class="bottom">'), hud.indexOf('<div class="hud-kit">') + 30);
  ok(/<div class="hud-top">\s*<div class="hud-mark">[\s\S]*?<\/div>\s*<div class="hud-bars">/.test(block) && block.indexOf('hud-kit') > block.indexOf('hud-bars'), "the weapon mark's box stands before the bars in the block's top part, and the action bar comes after both");
  // A size moved live is taken at the next layout.
  const was = S.healthBarH;
  tuneSizes({ healthBarH: 10 });
  barLayout('middle', 'over', 'lower', true, true, L);
  ok(L.hp.h === 10 && near(L.pool.y + L.pool.h / 2, L.hp.y + 10), 'the health bar\'s thickness is a dial, and Force follows its edge');
  tuneSizes({ healthBarH: was });
}

// ---------------------------------------------------------------- 2. how the stylesheet draws them
{
  const css = readFileSync(new URL('../../../src/ui/hud.css', import.meta.url), 'utf8');
  const style = readFileSync(new URL('../../../src/style.css', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../../../src/ui/hud.ts', import.meta.url), 'utf8');
  // Every look the display tells the page (`LOOK_VARS`) falls back, in the stylesheet, on the table's start value.
  const looks = [...hud.matchAll(/\{ key: '(\w+)', name: '(--[\w-]+)', unit: '(\w*)' \}/g)].map((m) => ({ key: m[1], name: m[2], unit: m[3] }));
  // Nine for the bars and the block (the ripple's starting strength the wave's fixer's), seven for the weapon mark (item
  // 6): its opacity, its turn to a new stance, and a pair's two marks and the line between them, and four for the corner
  // (the frame rate's type and drop shadow, the weather's type); then the second wave's: two for the frame rate's own
  // place on the character list and the creator (item 9), fifteen for the action bar (item 7: its cells, mark, key,
  // corners and lines, the press's dark and its two eases, the cooldown's dark, the ready flash, a lit cell's glow) and
  // twenty-two for the use prompt (item 8: its strength, corners, gaps and padding, cap and ink, its fades, width and
  // cross-fade, its quieter self, the blur, the cap's size, side room, corners and type, the words' type and their gap
  // from the cap), each a dial: rule 1, a live dial for every size. The cap, the words and the lit glow's numbers were
  // written into the stylesheet with no slider until the wave's review (`capW` and `capH` moved nothing).
  ok(looks.length === 59, `the display tells the page fifty-nine of the table's looks (${looks.map((l) => l.name).join(' ')})`);
  const drift: string[] = [];
  for (const l of looks) {
    const uses = [...css.matchAll(new RegExp(`var\\(${l.name}, ([0-9.]+)${l.unit}\\)`, 'g'))].map((m) => Number(m[1]));
    if (!uses.length) drift.push(`${l.name} is not read`);
    for (const u of uses) if (u !== (S as Record<string, number>)[l.key]) drift.push(`${l.name} falls back on ${u}, the table starts ${l.key} at ${(S as Record<string, number>)[l.key]}`);
  }
  ok(drift.length === 0, `and the stylesheet falls back on each start value${drift.length ? `: ${drift.join('; ')}` : ''}`);
  ok(/\.hud-bars > \.hud-bar \{[^}]*left: calc\(var\(--bx, 0\) \* 1px \* var\(--hud-scale\)\);[^}]*top: calc\(var\(--by, 0\)[^}]*width: calc\(var\(--bw, 160\)[^}]*height: calc\(var\(--bh, 6\)/.test(css), "each bar stands at its layout's box, on the HUD scale");
  ok(/calc\(var\(--rl, 1\) \* var\(--bh, 6\) \* 0\.5px \* var\(--hud-scale\)\)\s*calc\(var\(--rr, 1\)/.test(css), 'rounded by half its thickness where its end is rounded, flat where not');
  ok(/\.hud-bar\.clip-top \{ clip-path: inset\(50% 0 0 0\); \}/.test(css) && /\.hud-bar\.clip-bottom \{ clip-path: inset\(0 0 50% 0\); \}/.test(css), 'the inside look draws half the pill, and only a bar that wears it is clipped');
  // Each body bar paints whole, in the markup's order: the shared bar's fill, ghost and marks carry z-indices, and with
  // no layer of the bar's own round them every bar's fill paints over every bar's background, so health's fill and
  // marks lay over the inside look's Force and showed through the laid-over Force's empty half (seen in the browser by
  // the wave's review, health at 95%). What only the browser shows is pinned as text.
  ok(/\.hud-bars > \.hud-bar \{\s*isolation: isolate;/.test(css) && /\.hud-bar > \.fill \{\s*z-index: 2;/.test(css), 'each bar in the block is a layer of its own, so the fill\'s own z-index stays inside it and Force and stamina are drawn in front of health whole');
  ok(/\.hud-bars \.hud-bar\.hp > \.fill \{\s*background: var\(--muted\);\s*transition: background-color var\(--hud-hp-ease, 0\.25s\) ease;\s*\}/.test(css) && /\.hud-bars \.hud-bar\.hp\.low > \.fill \{ background: var\(--health\); \}/.test(css), "health is the palette's muted, and its dark red when low, eased");
  ok(/\.hud-bar\.hp\.ripple \{ animation: hud-ripple var\(--hud-ripple, 1s\) ease-out infinite; \}/.test(css) && /@keyframes hud-ripple \{\s*from \{ box-shadow: 0 0 0 0 color-mix\(in srgb, var\(--bad\) calc\(var\(--hud-ripple-alpha, 0\.75\) \* 100%\), transparent\); \}/.test(css), 'and below its second share a ripple of the bright red spreads from it at its starting strength, one animation started by one class');
  ok(/\.hud-bars > \.hud-bar\.off \{ opacity: 0; \}/.test(css) && /opacity var\(--hud-bar-fade, 0\.2s\) linear/.test(css), 'a bar going away fades and keeps its place: nothing moves when one goes');
  ok(/#hud \.bottom\.align-left \{[^}]*transform: none;[^}]*\}/.test(css) && /#hud \.bottom\.align-right \{[^}]*right: calc\(var\(--hud-block-side, 14\)[^}]*\}/.test(css), 'the block stands at either side by one class, the middle as it always stood');
  ok(/\.bottom\.align-left \.hud-top \{ flex-direction: row; \}/.test(css) && /\.bottom\.align-right \.hud-top \{ flex-direction: row-reverse; \}/.test(css), 'at the sides the mark is at the screen\'s edge with the bars beside it, the right mirrored');
  ok(/\.bottom\.align-right \.hud-bars \.hud-bar > \.fill,\s*\.bottom\.align-right \.hud-bars \.hud-bar > \.ghost \{ transform-origin: right center; \}/.test(css), 'and at the right the bars fill from the screen\'s edge');
  ok(/\.hud-msgs\.right \{[^}]*left: auto;[^}]*right:/.test(css), 'with the block on the left the message line takes the bottom right');
  ok(/\.hud-fps \{[^}]*position: absolute;[^}]*top: 12px;[^}]*right: 12px;[^}]*font-size: calc\(var\(--hud-fps-size, 12\) \* 1px \* var\(--hud-scale\)\);[^}]*text-shadow: 0 calc\(var\(--hud-fps-shadow-y, 1\) \* 1px\) calc\(var\(--hud-fps-shadow-blur, 2\) \* 1px\) var\(--shade\);/.test(css) && !/\.hud-fps \{[^}]*(background|border)/.test(css), 'the frame rate alone at the top right, its type and its small drop shadow from the table, no box');
  ok(/\.hud-weather \{[^}]*height: calc\(13px \* var\(--hud-scale\)\);[^}]*line-height: calc\(13px \* var\(--hud-scale\)\);[^}]*font-size: calc\(var\(--hud-weather-size, 10\) \* 1px \* var\(--hud-scale\)\);/.test(css), "the weather's type from the table, in a line that keeps its own height whatever the type");
  ok(/\.hud-weather \.held \{ color: var\(--muted\); \}/.test(css) && /\.hud-clock \{[^}]*color: var\(--muted\);/.test(css), "the weather's held words and the clock in the palette's muted");
  ok(!/\.top-right\b/.test(style) && !/\.top-right\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'and the top-right box is gone from both stylesheets');
  ok(/\.hud-fps\.gone,\s*\.hud-weather\.gone,\s*\.hud-clock\.gone \{ display: none; \}/.test(css), 'each readout out of the page while its switch is off');
}

// ---------------------------------------------------------------- 3. what the display writes
{
  const parent = new El();
  const hud = new Hud(parent as Any);
  const root = parent.kids[0] as El;
  const kit = testKit();
  hud.setKit(kit);
  const hpBar = root.querySelector('.hud-bar.hp');
  const poolBar = root.querySelector('.hud-bar.pool');
  let hp = 100;
  /** The writes `what` made. The clock is held still below, so no quarter-second line (written by design) falls in. */
  const own = (what: () => void): number => writes(what);
  // The linger is kept on the frames' own `dt`, so the page's clock is held still: the quarter-second lines then come
  // once and not again, and every write counted here is the bars' own.
  const frame = (dt = 0.016) => {
    hud.update(dt, 1, 2, 3, kit, hp, 100, '12:00', '', false);
  };
  // Going away when full: the bar keeps its place, takes `off` once after the linger, and comes back the moment it drops.
  const linger = Math.ceil(S.fullLinger / 0.016);
  let wentAt = -1;
  for (let i = 0; i < linger + 10; i++) {
    const before = hpBar.names.has('off');
    frame();
    if (!before && hpBar.names.has('off') && wentAt < 0) wentAt = i;
  }
  ok(wentAt > 0 && Math.abs(wentAt * 0.016 - S.fullLinger) < 0.6 && hpBar.names.has('off') && poolBar.names.has('off'), `full, health and Force go ${S.fullLinger} s after (health went at frame ${wentAt}, about ${(wentAt * 0.016).toFixed(2)} s from its first frame, which began half a second in)`);
  ok(own(() => { for (let i = 0; i < 120; i++) frame(); }) === 0, 'and gone, a full bar writes nothing at all');
  hp = 90;
  const back = own(() => frame());
  ok(!hpBar.names.has('off') && poolBar.names.has('off') && back === 4, `a blow brings health back the moment it drops, Force left gone: the bar shown, its ghost off its snap, the ghost and the fill (wrote ${back})`);
  for (let i = 0; i < 200; i++) frame();
  ok(!hpBar.names.has('off'), 'and it stays while it is not full');
  hp = 100;
  for (let i = 0; i < linger + 5; i++) frame();
  ok(hpBar.names.has('off'), 'full again, it goes again');
  // The owner's switch of 20 November, "Keep the bars up when full": on, every bar of the block comes up full and stays
  // (stamina and breath with them) at one write each, and writes nothing more while it stays; off, they go again.
  const staminaBar = root.querySelector('.hud-bar.stamina');
  const breathBar = root.querySelector('.hud-bar.breath');
  const fullPool = { value: 100, tired: false };
  hud.setStamina(fullPool, 100, false, true);
  frame();
  ok(hpBar.names.has('off') && poolBar.names.has('off'), 'full, health and Force are down to begin with');
  hud.setBarsKept(true);
  hud.setStamina(fullPool, 100, false, true);
  hud.update(0.016, 1, 2, 3, kit, hp, 100, '12:00', '', false, { value: 30, max: 30 } as Any);
  ok(!hpBar.names.has('off') && !poolBar.names.has('off') && !staminaBar.names.has('off') && !breathBar.names.has('off'), 'kept up: health, Force, stamina and breath all stand, full');
  const keptFrame = () => {
    hud.setStamina(fullPool, 100, false, true);
    hud.update(0.016, 1, 2, 3, kit, hp, 100, '12:00', '', false, { value: 30, max: 30 } as Any);
  };
  for (let i = 0; i < linger + 10; i++) keptFrame();
  ok(!hpBar.names.has('off') && !poolBar.names.has('off') && !staminaBar.names.has('off') && !breathBar.names.has('off'), `and they stay well past the ${S.fullLinger} s linger`);
  ok(own(() => { for (let i = 0; i < 120; i++) keptFrame(); }) === 0, 'kept up and full, they write nothing at all');
  hud.setBarsKept(false);
  for (let i = 0; i < linger + 10; i++) keptFrame();
  ok(hpBar.names.has('off') && poolBar.names.has('off') && staminaBar.names.has('off') && breathBar.names.has('off'), 'the switch off, every full bar goes again');
  // Health's colour and ripple: one class each way at each share, and nothing between.
  hp = 41;
  frame();
  ok(!hpBar.names.has('low') && !hpBar.names.has('ripple'), 'at 41% health is still the muted colour');
  hp = 40;
  ok(own(() => frame()) >= 2 && hpBar.names.has('low') && !hpBar.names.has('ripple'), 'at 40% it takes the dark red (the threshold is a share of full health, at and below)');
  hp = 29.9;
  frame();
  ok(hpBar.names.has('ripple'), 'below 30% the ripple runs');
  // The blow's ghost walks down and is snapped back behind the fill (one write, `ghostSeconds` on): let it.
  for (let i = 0; i < Math.ceil(S.ghostSeconds / 0.016) + 2; i++) frame();
  ok(own(() => { for (let i = 0; i < 60; i++) frame(); }) === 0, 'and the ripple, an animation the stylesheet runs, writes nothing while it runs');
  hp = 80;
  frame();
  ok(!hpBar.names.has('low') && !hpBar.names.has('ripple'), 'healed, both come off');
  // The readouts: nothing while their switches are off, and each written only when it changes while they are on.
  const fps = root.querySelector('.hud-fps');
  const clockEl = root.querySelector('.hud-clock');
  const weather = root.querySelector('.hud-weather');
  fps.names.add('gone');
  clockEl.names.add('gone');
  weather.names.add('gone');
  let quiet = 0;
  count.writes = 0;
  for (let i = 0; i < 80; i++) {
    clock.now += 16;
    hud.update(0.016, 1, 2, 3, kit, 80, 100, i < 40 ? '12:00' : '12:01', '', false);
  }
  quiet = fps.textContent === '' && clockEl.textContent === '' ? 1 : 0;
  ok(quiet === 1, 'with the frame rate and the clock off neither is written, the minute turning or not');
  hud.setReadouts(true, true, true);
  ok(!fps.names.has('gone') && !clockEl.names.has('gone'), 'switched on, each is in the page');
  const before = hud.stats().byDesignNow;
  clock.now += 300;
  hud.update(0.016, 1, 2, 3, kit, 80, 100, '12:01', '', false);
  ok(/^\d+ fps$/.test(fps.textContent) && clockEl.textContent === '12:01' && hud.stats().byDesignNow > before, `and written on the next frame, by design (${fps.textContent}, ${clockEl.textContent})`);
  const n = writes(() => { for (let i = 0; i < 10; i++) hud.update(0.016, 1, 2, 3, kit, 80, 100, '12:01', '', false); });
  ok(n === 0, 'the clock not written again while its words have not changed, the frame rate not between its quarter seconds');
  hud.update(0.016, 1, 2, 3, kit, 80, 100, '12:02', '', false);
  ok(clockEl.textContent === '12:02', 'and the clock written when the minute turns');
  hud.setWeather('Rain', false);
  ok(!weather.names.has('gone') && root.querySelector('.hud-weather .word').textContent === 'Rain', 'the weather says its word, alone ("Rain", never "Weather: Rain")');
  hud.setReadouts(true, false, true);
  ok(weather.names.has('gone'), 'and its switch takes it off the page');
  hud.setReadouts(false, true, false);
  ok(fps.names.has('gone') && clockEl.names.has('gone') && !weather.names.has('gone'), 'every switch both ways');
  ok(root.querySelector('.hud-weather .held').textContent === ' · held', 'the held words are written once, and only shown while held');
  // The block: where it stands is one class, and the bars are placed at the layout's own numbers, at scale 1.
  ok(writes(() => hud.setBlock('middle', 'over', 'lower')) === 0, 'the switches as they stand write nothing');
  const bottomEl = root.querySelector('.bottom');
  hud.setBlock('left', 'inside', 'upper');
  ok(bottomEl.names.has('align-left') && !bottomEl.names.has('align-right'), 'on the left, the block wears its class');
  const expect: BarLayout = barLayout('left', 'inside', 'upper', true, false, makeBarLayout());
  const pool = root.querySelector('.hud-bar.pool');
  const st = root.querySelector('.hud-bar.stamina');
  ok(pool.style['--bx'] === `${expect.pool.x}` && pool.style['--by'] === `${expect.pool.y}` && pool.style['--bw'] === `${expect.pool.w}` && pool.style['--rl'] === '0' && pool.style['--rr'] === '1' && pool.names.has('clip-top'), `Force placed at the layout's own box, flat at the edge, its outer half not drawn (${pool.style['--bx']}, ${pool.style['--by']}, ${pool.style['--bw']})`);
  ok(root.querySelector('.hud-bars').style['--hud-bars-h'] === `${expect.h}`, `and the bars' box is the layout's own height (${expect.h})`);
  hud.setStamina({ value: 50, tired: false }, 100, true, true);
  const withStamina = barLayout('left', 'inside', 'upper', true, true, makeBarLayout());
  ok(st.style['--by'] === `${withStamina.stamina.y}` && st.names.has('clip-bottom'), 'the speed classes coming into force place stamina inside health on the edge Force does not use');
  hud.setBlock('right', 'over', 'lower');
  ok(bottomEl.names.has('align-right') && !bottomEl.names.has('align-left') && pool.style['--rl'] === '1' && pool.style['--rr'] === '0' && !pool.names.has('clip-top'), 'on the right, the mirror: rounded at the left, flat at the right, laid over');
  // The frames straight after the block moved, the first of them included: the move placed the bars, and no frame
  // places them again (the mark the move asked to be read again is the same mark, so it writes nothing either).
  const afterMove = writes(() => { for (let i = 0; i < 30; i++) frame(); });
  ok(afterMove === 0, `a frame does not place the bars, the first after the move included (${afterMove})`);
  const steady = writes(() => { for (let i = 0; i < 30; i++) { clock.now += 0; hud.setStamina({ value: 50, tired: false }, 100, true, true); hud.update(0.016, 1, 2, 3, kit, 80, 100, '12:02', '', false); } });
  ok(steady === 0, `and a steady frame of the whole block on the right writes nothing (${steady})`);
  // A kit with no Force: the bar out of the block and stamina in its place, its own size kept.
  const kitless = { ...testKit(), resource: null };
  hud.update(0.016, 1, 2, 3, kitless, 80, 100, '12:02', '', false);
  const noForce = barLayout('right', 'over', 'lower', false, true, makeBarLayout());
  ok(pool.names.has('gone') && st.style['--by'] === `${noForce.stamina.y}` && st.style['--bw'] === `${noForce.stamina.w}`, 'a kit with no Force takes its bar out, and stamina stands against health keeping its own size');
  // What the console reads, since the bars carry no words on the screen.
  const r = hud.report();
  ok(r.block === 'right over lower' && /^health 80% · no force · Stamina 50%/.test(r.bars), `the console reads the block and every bar (${r.block}; ${r.bars})`);
}

// ---------------------------------------------------------------- 4. the Interface page's switches, and the dials
{
  const { DEFAULT_SETTINGS, HUD_BLOCK_ALIGNS, HUD_FORCE_LOOKS, HUD_FORCE_EDGES } = await import('../../../src/core/settings.ts');
  const { INTERFACE } = await import('../../../src/ui/hudPage.ts');
  const knobs = INTERFACE.flatMap((gr) => gr.knobs);
  const D = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  ok(D.hudFps === false && D.hudWeather === true && D.hudClock === false, 'the frame rate and the clock start off, the weather starts on');
  ok(D.hudBlockAlign === 'middle' && D.hudForceLook === 'over' && D.hudForceEdge === 'lower', "the block starts in the middle, where it stood, and Force laid over health's lower edge, the closest to today's look");
  const choice = (key: string, offered: readonly string[]) => {
    const k = knobs.find((x) => x.key === key);
    return !!k && k.kind === 'choice' && k.choices!.map((c) => c.value).join() === offered.join() && offered.includes(D[key] as string);
  };
  ok(choice('hudBlockAlign', HUD_BLOCK_ALIGNS) && choice('hudForceLook', HUD_FORCE_LOOKS) && choice('hudForceEdge', HUD_FORCE_EDGES), 'each of the three is a choice on the Interface page offering exactly the words the game takes');
  ok(['hudFps', 'hudWeather', 'hudClock'].every((key) => knobs.find((x) => x.key === key)?.kind === 'toggle'), 'and the three readouts are switches on it');
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const apply = /private applyHudSettings\(\): void \{([\s\S]*?)\n  \}/.exec(main)?.[1] ?? '';
  ok(/this\.hud\.setReadouts\(S\.hudFps, S\.hudWeather, S\.hudClock\);/.test(apply) && /this\.hud\.setBlock\(align, oneOf\(S\.hudForceLook, HUD_FORCE_LOOKS, 'over'\), oneOf\(S\.hudForceEdge, HUD_FORCE_EDGES, 'lower'\)\);/.test(apply), 'the game hands the display the six switches whenever the settings are applied, a word nobody offers taken as the default');
  const change = /case 'hudTrackerInFlight':([\s\S]*?)this\.applyHudSettings\(\);/.exec(main)?.[1] ?? '';
  ok(['hudFps', 'hudWeather', 'hudClock', 'hudBlockAlign', 'hudForceLook', 'hudForceEdge'].every((k) => change.includes(`case '${k}':`)), 'and each of the six applies them the moment it is moved on the page');
  ok(/this\.hud\.update\(dt, locX, locAt\.y, locZ, this\.kit, player\.hp, player\.maxHp, this\.clockWords\(\),/.test(main) && !/this\.world\.day\.clock\(\), this\.nearbyName/.test(main), "the frame hands the clock's words kept, made again only when the minute turns");
  const { HUD_DIALS, HUD_DIALS_HOST } = await import('../../../src/ui/hudDials.ts');
  let applied = 0;
  HUD_DIALS_HOST.apply = () => void applied++;
  const dials = HUD_DIALS.groups.flatMap((gr) => gr.dials);
  const off: string[] = [];
  for (const d of dials) {
    if (d.kind !== 'number') continue;
    const key = d.key.replace(/^sizes\./, '');
    const start = (S as Record<string, number>)[key];
    if (start === undefined || start < d.min || start > d.max || HUD_DIALS.shipped.get(d.key) !== start) off.push(d.key);
    d.set(d.min);
    if ((S as Record<string, number>)[key] !== d.min) off.push(`${d.key} not set`);
    d.set(start);
  }
  ok(off.length === 0 && applied === dials.length * 2, `every dial (${dials.length}) is a number of the table, starts where the table does inside its range, and moves it through the same door as the console, the display applied again each time${off.length ? `: ${off.join(', ')}` : ''}`);
  ok(dials.some((d) => d.key === 'sizes.healthBarH') && dials.some((d) => d.key === 'sizes.fullLinger') && dials.some((d) => d.key === 'sizes.hpLow'), "the health bar's thickness, the linger and health's colour step are among them");
  // Every look the display tells the page (`LOOK_VARS`) is one of them: a size the stylesheet draws with no slider was
  // the wave's review's finding (the block's side inset, the corner's type and shadow, the ripple's starting strength).
  const hudText = readFileSync(new URL('../../../src/ui/hud.ts', import.meta.url), 'utf8');
  const told = [...hudText.matchAll(/\{ key: '(\w+)', name: '--[\w-]+', unit: '\w*' \}/g)].map((m) => m[1]);
  const unslid = told.filter((k) => !dials.some((d) => d.key === `sizes.${k}`));
  ok(told.length > 0 && unslid.length === 0, `and so is every look the display tells the page, ${told.length} of them${unslid.length ? `: not ${unslid.join(', ')}` : ''}`);
  HUD_DIALS_HOST.apply = null;
}

// ---------------------------------------------------------------- 5. nothing made by a steady frame, in twelve fresh processes at once
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
  ok(got.every((r) => r.writes === 0), 'the frame measured writes nothing to the page (every look on, every bar up)');
  ok(got.every((r) => (r as Any).filling === true), "and it is a frame with an action bar cell's cooldown fill running, the presses asked of every cell");
  ok(got.every((r) => Number.isFinite(r.frame) && r.frame < 0.5), `and makes nothing, in 12 of 12 processes (${got.map((r) => r.frame.toFixed(3)).join(' ')} B)`);
}

console.log(`\nhudBars: ${checks} checks passed`);
