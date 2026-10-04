// The interface's own glyphs (src/ui/hud.svg, src/ui/hudIcons.ts), the keys the ability cells show
// (src/ui/hud.ts), and the nameplate's two pure halves (src/ui/nameplate.ts).
//
// What is pinned here:
//
//   - the sheet and the list of glyphs agree exactly, both ways, so a glyph renamed in one file and
//     not the other fails a test rather than leaving an empty cell on the screen;
//   - every glyph is stroked and never filled, which is what lets one mark read at 10 px and at
//     40 px and take its colour from the cell it is in, and stays inside 3 to 21 of its 24 box;
//   - every ability and every gadget the game ships has a mark, and an ability nobody has thought of
//     yet still gets one;
//   - a cell shows the key that is bound, and follows a rebind;
//   - a point is put on the screen from a camera's own two matrices, with behind the camera called
//     behind; and the thing under the crosshair is the nearest inside the cone, never a dead one,
//     never the player.
//
// Everything here is synthetic: a stand-in for the page, a hand-made camera and made-up creatures.
// Nothing is read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- a stand-in for the page ---------------------------------------------------------------------
// Enough of an element for the display to build itself against and for a value to be read back.

function makeEl(): any {
  const found = new Map<string, any>();
  const kids: any[] = [];
  const classes = new Set<string>();
  const el: any = {
    style: { setProperty() {} } as Record<string, unknown>,
    classList: {
      toggle(name: string, force?: boolean) {
        const on = force === undefined ? !classes.has(name) : force;
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains: (name: string) => classes.has(name),
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    setAttribute() {},
    appendChild(kid: any) {
      kids.push(kid);
      return kid;
    },
    querySelector(sel: string) {
      let hit = found.get(sel);
      if (!hit) {
        hit = makeEl();
        found.set(sel, hit);
      }
      return hit;
    },
    querySelectorAll: () => [],
  };
  let text = '';
  let html = '';
  let cls = '';
  let hidden = false;
  Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => (text = String(v)) });
  Object.defineProperty(el, 'innerHTML', { get: () => html, set: (v) => (html = String(v)) });
  Object.defineProperty(el, 'className', { get: () => cls, set: (v) => (cls = String(v)) });
  Object.defineProperty(el, 'hidden', { get: () => hidden, set: (v) => (hidden = !!v) });
  return el;
}

// Every element the display builds, in the order it built it, so a cell's own markup can be read
// back: the display's root first, then a cell per ability, then the saber's.
const built: any[] = [];
(globalThis as any).document = {
  createElement: () => {
    const el = makeEl();
    built.push(el);
    return el;
  },
};

const { ICON_IDS, ICON_FALLBACK, glyphFor, handGlyph, iconKey, WING_GLYPHS } = await import('../../../src/ui/hudIcons.ts');
const { Hud, keyLabel, hudBindingsChanged } = await import('../../../src/ui/hud.ts');
const { pickPlate, projectPoint, healthShare, makeProjected, plateLabel, Nameplates } = await import('../../../src/ui/nameplate.ts');

// --- the sheet and the list ------------------------------------------------------------------------
const sheet = readFileSync(fileURLToPath(new URL('../../../src/ui/hud.svg', import.meta.url)), 'utf8');
const drawn = [...sheet.matchAll(/<symbol\s+id="([^"]+)"/g)].map((m) => m[1]);
{
  ok(drawn.length > 0, `the sheet holds ${drawn.length} glyphs`);
  const missing = ICON_IDS.filter((id) => !drawn.includes(id));
  ok(missing.length === 0, `every glyph the code names is drawn on the sheet${missing.length ? `: ${missing.join(', ')}` : ''}`);
  const extra = drawn.filter((id) => !(ICON_IDS as readonly string[]).includes(id));
  ok(extra.length === 0, `and every glyph on the sheet is named in the code${extra.length ? `: ${extra.join(', ')}` : ''}`);
  ok(new Set(drawn).size === drawn.length, 'no glyph is drawn twice');
  ok(drawn.every((id) => id.startsWith('ic-')), 'every glyph is named the same way');
}

// Every glyph is a stroke and never a fill, and every one is drawn at the same width.
{
  // The whole of each symbol element, so the file's own notes about itself are not read as one.
  const blocks = [...sheet.matchAll(/<symbol\s[^>]*>[\s\S]*?<\/symbol>/g)].map((m) => m[0]);
  ok(blocks.length === drawn.length, `every glyph is a symbol that closes (${blocks.length})`);
  const unstroked = blocks.filter((b) => !b.includes('stroke="currentColor"')).length;
  const filled = blocks.filter((b) => !b.includes('fill="none"')).length;
  const widths = new Set(blocks.map((b) => /stroke-width="([^"]+)"/.exec(b)?.[1] ?? ''));
  ok(unstroked === 0, 'every glyph takes its colour from the cell it is in');
  ok(filled === 0, 'and none of them is filled');
  ok(widths.size === 1 && !widths.has(''), `and all of them are drawn at one width (${[...widths][0]})`);
  const boxes = new Set(blocks.map((b) => /viewBox="([^"]+)"/.exec(b)?.[1] ?? ''));
  ok(boxes.size === 1 && [...boxes][0] === '0 0 24 24', 'and all of them on the same box');
  ok(!/<image\b/.test(sheet), 'and not one of them is a picture: every mark is drawn here');
}

// Every glyph stays inside 3 to 21 of its own box, which leaves room for the dark under-stroke: one that
// ran to the edge touched its neighbour at 28 px. Every element is walked as drawn -- a path's commands
// absolute and relative, its curves and arcs sampled along their length rather than judged by their
// control points, which may stand outside a curve that does not -- and every point it reaches is
// checked against the field.
{
  const FIELD_MIN = 3;
  const FIELD_MAX = 21;
  /** A path's `d`, as its commands and numbers; an arc's two flags are one character each, as SVG allows. */
  function tokens(d: string): (string | number)[] {
    const out: (string | number)[] = [];
    let i = 0;
    let cmd = '';
    let argIndex = 0;
    const num = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
    while (i < d.length) {
      const ch = d[i];
      if (/[\s,]/.test(ch)) {
        i++;
        continue;
      }
      if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
        out.push(ch);
        cmd = ch;
        argIndex = 0;
        i++;
        continue;
      }
      // An arc's large-arc and sweep flags (the fourth and fifth of its seven) are single digits.
      if ((cmd === 'a' || cmd === 'A') && (argIndex % 7 === 3 || argIndex % 7 === 4) && (ch === '0' || ch === '1')) {
        out.push(Number(ch));
        argIndex++;
        i++;
        continue;
      }
      const m = num.exec(d.slice(i));
      if (!m) throw new Error(`a path the test cannot read at "${d.slice(i, i + 12)}"`);
      out.push(Number(m[0]));
      argIndex++;
      i += m[0].length;
    }
    return out;
  }
  /** Every point a path reaches, its curves and arcs sampled. */
  function pathPoints(d: string): [number, number][] {
    const t = tokens(d);
    const pts: [number, number][] = [];
    let k = 0;
    let x = 0;
    let y = 0;
    let sx = 0;
    let sy = 0;
    let cmd = '';
    let lastCtrl: [number, number] | null = null;
    let lastQ: [number, number] | null = null;
    const n = () => t[k++] as number;
    const hasNum = () => k < t.length && typeof t[k] === 'number';
    const cubic = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      for (let s = 1; s <= 24; s++) {
        const u = s / 24;
        const a = (1 - u) ** 3;
        const b = 3 * (1 - u) ** 2 * u;
        const c = 3 * (1 - u) * u * u;
        const e = u ** 3;
        pts.push([a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3]);
      }
    };
    const arc = (x1: number, y1: number, rx: number, ry: number, phiDeg: number, fa: number, fs: number, x2: number, y2: number) => {
      rx = Math.abs(rx);
      ry = Math.abs(ry);
      if (!rx || !ry) {
        pts.push([x2, y2]);
        return;
      }
      const phi = (phiDeg * Math.PI) / 180;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const dx = (x1 - x2) / 2;
      const dy = (y1 - y2) / 2;
      const x1p = cp * dx + sp * dy;
      const y1p = -sp * dx + cp * dy;
      const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
      if (lam > 1) {
        rx *= Math.sqrt(lam);
        ry *= Math.sqrt(lam);
      }
      const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
      const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
      const coef = (fa !== fs ? 1 : -1) * Math.sqrt(Math.max(0, den ? num2 / den : 0));
      const cxp = (coef * rx * y1p) / ry;
      const cyp = (-coef * ry * x1p) / rx;
      const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
      const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
      const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
      let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
      if (!fs && dth > 0) dth -= 2 * Math.PI;
      else if (fs && dth < 0) dth += 2 * Math.PI;
      for (let s = 1; s <= 32; s++) {
        const th = th1 + (dth * s) / 32;
        pts.push([cx + rx * cp * Math.cos(th) - ry * sp * Math.sin(th), cy + rx * sp * Math.cos(th) + ry * cp * Math.sin(th)]);
      }
    };
    while (k < t.length) {
      if (typeof t[k] === 'string') cmd = t[k++] as string;
      else if (!cmd) throw new Error('a path that starts with a number');
      const rel = cmd === cmd.toLowerCase();
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      const C = cmd.toUpperCase();
      if (C === 'Z') {
        x = sx;
        y = sy;
        lastCtrl = lastQ = null;
        continue;
      }
      if (!hasNum()) throw new Error(`a ${cmd} with nothing after it`);
      if (C === 'M') {
        x = ox + n();
        y = oy + n();
        sx = x;
        sy = y;
        pts.push([x, y]);
        cmd = rel ? 'l' : 'L';
        lastCtrl = lastQ = null;
      } else if (C === 'L') {
        x = ox + n();
        y = oy + n();
        pts.push([x, y]);
        lastCtrl = lastQ = null;
      } else if (C === 'H') {
        x = ox + n();
        pts.push([x, y]);
        lastCtrl = lastQ = null;
      } else if (C === 'V') {
        y = oy + n();
        pts.push([x, y]);
        lastCtrl = lastQ = null;
      } else if (C === 'C' || C === 'S') {
        let x1: number;
        let y1: number;
        if (C === 'C') {
          x1 = ox + n();
          y1 = oy + n();
        } else {
          x1 = lastCtrl ? 2 * x - lastCtrl[0] : x;
          y1 = lastCtrl ? 2 * y - lastCtrl[1] : y;
        }
        const x2 = ox + n();
        const y2 = oy + n();
        const x3 = ox + n();
        const y3 = oy + n();
        cubic(x, y, x1, y1, x2, y2, x3, y3);
        lastCtrl = [x2, y2];
        lastQ = null;
        x = x3;
        y = y3;
      } else if (C === 'Q' || C === 'T') {
        let qx: number;
        let qy: number;
        if (C === 'Q') {
          qx = ox + n();
          qy = oy + n();
        } else {
          qx = lastQ ? 2 * x - lastQ[0] : x;
          qy = lastQ ? 2 * y - lastQ[1] : y;
        }
        const x3 = ox + n();
        const y3 = oy + n();
        cubic(x, y, x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x3 + (2 / 3) * (qx - x3), y3 + (2 / 3) * (qy - y3), x3, y3);
        lastQ = [qx, qy];
        lastCtrl = null;
        x = x3;
        y = y3;
      } else if (C === 'A') {
        const rx = n();
        const ry = n();
        const rot = n();
        const fa = n();
        const fs = n();
        const x2 = ox + n();
        const y2 = oy + n();
        arc(x, y, rx, ry, rot, fa, fs, x2, y2);
        x = x2;
        y = y2;
        lastCtrl = lastQ = null;
      } else throw new Error(`a path command the test does not know: ${cmd}`);
    }
    return pts;
  }
  const attr = (el: string, name: string) => Number(new RegExp(`\\s${name}="([^"]+)"`).exec(el)?.[1]);
  const blocks = [...sheet.matchAll(/<symbol\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g)];
  const outside: string[] = [];
  const unread: string[] = [];
  for (const [, id, body] of blocks) {
    let lo = Infinity;
    let hi = -Infinity;
    const take = (x: number, y: number) => {
      lo = Math.min(lo, x, y);
      hi = Math.max(hi, x, y);
    };
    for (const el of body.match(/<(?:path|circle|ellipse|rect|line|polyline|polygon)\b[^>]*>/g) ?? []) {
      const kind = /^<(\w+)/.exec(el)![1];
      try {
        if (kind === 'path') for (const [x, y] of pathPoints(/\sd="([^"]+)"/.exec(el)![1])) take(x, y);
        else if (kind === 'circle' || kind === 'ellipse') {
          const cx = attr(el, 'cx');
          const cy = attr(el, 'cy');
          const rx = kind === 'circle' ? attr(el, 'r') : attr(el, 'rx');
          const ry = kind === 'circle' ? rx : attr(el, 'ry');
          take(cx - rx, cy - ry);
          take(cx + rx, cy + ry);
        } else if (kind === 'rect') {
          take(attr(el, 'x'), attr(el, 'y'));
          take(attr(el, 'x') + attr(el, 'width'), attr(el, 'y') + attr(el, 'height'));
        } else if (kind === 'line') {
          take(attr(el, 'x1'), attr(el, 'y1'));
          take(attr(el, 'x2'), attr(el, 'y2'));
        } else {
          const nums = (/\spoints="([^"]+)"/.exec(el)?.[1] ?? '').trim().split(/[\s,]+/).map(Number);
          for (let i = 0; i + 1 < nums.length; i += 2) take(nums[i], nums[i + 1]);
        }
      } catch (e) {
        unread.push(`${id}: ${(e as Error).message}`);
      }
    }
    if (!Number.isFinite(lo) || lo < FIELD_MIN - 1e-6 || hi > FIELD_MAX + 1e-6) outside.push(`${id} (${lo.toFixed(2)} to ${hi.toFixed(2)})`);
  }
  ok(unread.length === 0, `every glyph's drawing could be walked${unread.length ? `: ${unread.join('; ')}` : ''}`);
  ok(outside.length === 0, `every glyph stays inside ${FIELD_MIN} to ${FIELD_MAX} of its box${outside.length ? `: ${outside.join(', ')}` : ''} (${blocks.length} glyphs)`);
}

// --- which mark stands for what ---------------------------------------------------------------------
{
  const powers = ['Force Jump', 'Force Speed', 'Force Push', 'Force Pull', 'Force Lightning', 'Force Drain', 'Force Grip', 'Force Repulse', 'Force Slow', 'Force Heal', 'Force Protect', 'Force Rage', 'Bare Hands'];
  const gadgets = ['Thermal Detonator', 'Fragmentation Grenade', 'Proton Grenade', 'Imperial Detonator', 'Cryoban Grenade', 'Glop Grenade', 'Poison Grenade', 'Bug Bomb', 'Trip Mine', 'Det Pack', 'Stim Pack', 'Bare Hands'];
  const bad = [...powers, ...gadgets].filter((n) => !drawn.includes(glyphFor(n)));
  ok(bad.length === 0, `every ability and gadget the game ships has a mark that is drawn${bad.length ? `: ${bad.join(', ')}` : ''}`);
  const marks = new Set(powers.map((n) => glyphFor(n)));
  ok(marks.size === powers.length, 'and no two Force powers wear the same one');
  ok(glyphFor('Force Speed') === glyphFor('force-speed'), 'a name is read by its letters, not its punctuation');
  ok(iconKey('Force  Speed!') === 'forcespeed', 'and a key is its letters and digits alone');
  ok(glyphFor('Some Power Nobody Has Written Yet') === ICON_FALLBACK, 'an ability nobody has thought of still gets a mark');
  ok(glyphFor('Wookiee Flame Thrower') === 'ic-flame', 'and one whose name says what it is gets the right one');
}

// What a hand is holding.
{
  ok(handGlyph('two_handed_saber', 'a blade') === 'ic-saber', 'a saber in a hand is a saber');
  ok(handGlyph('rifle', 'a gun') === 'ic-blaster', 'a rifle is a blaster');
  ok(handGlyph('carbine', null) === 'ic-blaster', 'so is a carbine');
  ok(handGlyph(null, null) === 'ic-hand', 'and an empty hand is an open hand');
  ok(drawn.includes(handGlyph('thrown', 'Thermal Detonator')), 'whatever it decides is a mark that is drawn');
  ok(WING_GLYPHS.filter((g) => g).every((g) => drawn.includes(g as string)), 'the four wing states have their marks too');
}

// --- the keys on the cells ---------------------------------------------------------------------------
{
  ok(keyLabel('KeyW') === 'W', 'a letter key is its letter');
  ok(keyLabel('Digit1') === '1', 'a number key is its number');
  ok(keyLabel('Mouse2') === 'RMB', 'a mouse button has a cap of its own');
  ok(keyLabel('ControlLeft') === 'Ctrl', 'and a modifier is short enough for a cap');
  ok(keyLabel('') === '—', 'an action with nothing bound to it says so');
  ok(keyLabel('NumpadAdd') === 'NAdd', 'a keypad key says which it is');
}

{
  const input = { bindings: { slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], saberToggle: ['KeyL'], forward: ['KeyW'], left: ['KeyA'], back: ['KeyS'], right: ['KeyD'], jump: ['Space'], walk: ['ShiftLeft'], mount: ['KeyE'], switchClass: ['KeyC'], fastForward: ['KeyT'], map: ['KeyM'], inventory: ['KeyI'], spawner: ['KeyB'], help: ['KeyH'], noclip: ['KeyN'] } as Record<string, string[]> };
  const kit: any = {
    id: 'jedi',
    name: 'Jedi',
    slots: [
      { key: '1', name: 'Force Jump', cost: '20' },
      { key: '2', name: 'Force Speed', cost: '6/s' },
    ],
    help: ['a line of the class own'],
    resource: { label: 'Force', value: 100, max: 100 },
    slotActive: () => false,
    slotCooldown: () => 0,
    charge: () => 0,
  };
  const hud = new Hud(makeEl());
  hud.setInput(input);
  hud.setKit(kit);
  ok(hud.report().keys === '1 2', `the cells show the keys that are bound (${hud.report().keys})`);
  input.bindings.slot2 = ['KeyF'];
  hudBindingsChanged();
  ok(hud.report().keys === '1 F', `and follow a rebind at once (${hud.report().keys})`);
  // A rebind nobody announced is taken up at the display's own tick, a quarter of a second, so the
  // cells are right whether or not whoever rebound remembered to say so.
  input.bindings.slot1 = ['Mouse1'];
  await new Promise((done) => setTimeout(done, 300));
  hud.update(0.016, 0, 0, 0, kit, 100, 100, '12:00', '', false);
  ok(hud.report().keys === 'MMB F', `but the next tick takes it up whether or not anyone said so (${hud.report().keys})`);
  ok(hud.report().icons === 0, 'with no page to fetch the sheet from, the glyph count is nothing and nothing throws');
  // The corner strip's letters come from the same bindings as the cells', not from its markup.
  const hint = () => (hud as any).root.querySelector('.hint').innerHTML as string;
  ok(hint().includes('<b>M</b> Map'), `the corner strip says the keys that are bound (${hint()})`);
  input.bindings.map = ['KeyJ'];
  hudBindingsChanged();
  ok(hint().includes('<b>J</b> Map') && !hint().includes('<b>M</b> Map'), `and follows a rebind with them (${hint()})`);
  // The saber cell's word is the blade's state; it used to be written once as "off" and left there.
  const saber = built[built.length - 1];
  ok(saber.querySelector('.cost').textContent === '', 'the saber cell keeps the word its own markup carries until the blade changes');
  hud.update(0.016, 0, 0, 0, kit, 100, 100, '12:00', '', true);
  ok(saber.querySelector('.cost').textContent === 'on', 'a lit blade says so');
  hud.update(0.016, 0, 0, 0, kit, 100, 100, '12:00', '', false);
  ok(saber.querySelector('.cost').textContent === 'off', 'and a blade put away says that');
}

// --- a loadout with a hole in it ---------------------------------------------------------------------
// Both classes drop an empty slot from the row rather than leaving a gap in it, so the third cell of
// a loadout whose first ability has been taken out is the fourth number key. A cell that counted its
// own place in the row said 1, 2, 3 and the key that fired it was 2, 3, 4.
{
  const input = { bindings: { slot1: ['Digit1'], slot2: ['KeyF'], slot3: ['Digit3'], slot4: ['KeyG'], saberToggle: ['KeyL'] } as Record<string, string[]> };
  const kit: any = {
    id: 'jedi',
    name: 'Jedi',
    slots: [
      { key: '2', name: 'Force Speed', cost: '6/s' },
      { key: '4', name: 'Force Lightning', cost: '40' },
    ],
    help: [],
    resource: { label: 'Force', value: 100, max: 100 },
    slotActive: () => false,
    slotCooldown: () => 0,
    charge: () => 0,
  };
  const hud = new Hud(makeEl());
  hud.setInput(input);
  hud.setKit(kit);
  ok(hud.report().keys === 'F G', `a cell takes the key of the slot its ability is in, not of its place in the row (${hud.report().keys})`);
  input.bindings.slot4 = ['Digit6'];
  hudBindingsChanged();
  ok(hud.report().keys === 'F 6', `and follows a rebind of that slot (${hud.report().keys})`);
}

// --- a point on the screen -----------------------------------------------------------------------------
// A camera looking down its own -Z from the middle of the world, upright, with a right angle of view.
const view = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
const proj = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.2, 0] };
const camera = { matrixWorldInverse: view, projectionMatrix: proj };
{
  const out = makeProjected();
  projectPoint(0, 0, -10, camera, 800, 600, out);
  ok(!out.behind && Math.round(out.x) === 400 && Math.round(out.y) === 300, `a point straight ahead lands in the middle (${Math.round(out.x)}, ${Math.round(out.y)})`);
  projectPoint(10, 0, -10, camera, 800, 600, out);
  ok(!out.behind && Math.round(out.x) === 800, 'a point out to the right lands at the right edge');
  projectPoint(0, 10, -10, camera, 800, 600, out);
  ok(!out.behind && Math.round(out.y) === 0, 'and a point above lands at the top, not the bottom');
  projectPoint(0, 0, 10, camera, 800, 600, out);
  ok(out.behind, 'a point behind the camera is called behind');
  const before = JSON.stringify(out);
  projectPoint(1, 2, -3, camera, 800, 600, out);
  ok(JSON.stringify(out) !== before, 'and the answer is filled into the object it was handed');
}

// --- what the crosshair is resting on ----------------------------------------------------------------
{
  const thing = (key: number, x: number, z: number, extra: Partial<Record<string, unknown>> = {}) => ({ key, label: `thing ${key}`, dead: false, pos: { x, y: 0, z }, halfHeight: 1, ...extra }) as any;
  const ahead = thing(2, 0, -5);
  const far = thing(3, 0, -30);
  const aside = thing(4, 20, -5);
  const dead = thing(5, 0, -3, { dead: true });
  const me = thing(1, 0, -2);
  const list = [ahead, far, aside, dead, me];
  const pick = (range = 40, cone = 3, exclude = 1) => pickPlate(list, 0, 1, 0, 0, 0, -1, range, cone, exclude);
  ok(pick() === ahead, 'the nearest living thing inside the cone is the one shown');
  ok(pick(4) === null, 'nothing beyond the range is shown');
  ok(pickPlate([aside, dead], 0, 1, 0, 0, 0, -1, 40, 3, 1) === null, 'nothing outside the cone, and never a dead one');
  ok(pickPlate([me], 0, 1, 0, 0, 0, -1, 40, 3, 1) === null, 'and never the player');
  ok(pickPlate(list, 0, 1, 0, 0, 0, -1, 40, 80, 1) === ahead, 'a wider cone still takes the nearest, not the straightest');
  ok(healthShare({ ...ahead, hp: 30, maxHp: 120 }) === 0.25, 'a health share is what it says');
  ok(Number.isNaN(healthShare(ahead)), 'and a creature that keeps no health of its own shows no bar');
  ok(plateLabel('Tusken Raider', 116) === 'Tusken Raider · 116', 'a thing with a level shows it after its name');
  ok(plateLabel('Tusken Raider', null) === 'Tusken Raider' && plateLabel('a crate', 0) === 'a crate' && plateLabel('x', NaN) === 'x', 'and one with none, or a level of nought, shows its name alone');
  ok(plateLabel('Jawa', 7.6) === 'Jawa · 8', 'as a whole number');
}

// --- the plate itself, drawn ---------------------------------------------------------------------
{
  // The plate is built against the page stand-in above and walked for real: a Tusken straight ahead of
  // the crosshair, carrying its level as a body the world stands does.
  const plates = new Nameplates(makeEl());
  const tusken = { key: 9, label: 'Tusken Raider', level: 116, dead: false, pos: { x: 0, y: 0, z: -5 }, halfHeight: 1, hp: 50, maxHp: 100 } as any;
  const pool = (plates as any).pool as { on: boolean; name: any }[];
  // Every write of the words is counted, on an element of the plate's own that counts them.
  let wrote = 0;
  let words = '';
  const counting = {
    get textContent() {
      return words;
    },
    set textContent(v: string) {
      words = String(v);
      wrote++;
    },
  };
  for (const p of pool) p.name = counting;
  plates.track(0.016, [tusken], 0, 1, 0, 0, 0, -1, camera, 800, 600, 1);
  const up = pool.find((p) => p.on);
  ok(!!up && words === 'Tusken Raider · 116' && wrote === 1, `the plate over what the crosshair rests on reads its name and its level (${words})`);
  plates.track(0.016, [tusken], 0, 1, 0, 0, 0, -1, camera, 800, 600, 1);
  ok(wrote === 1, 'and a second frame with the same name and level writes no words at all');
  tusken.level = 117;
  plates.track(0.016, [tusken], 0, 1, 0, 0, 0, -1, camera, 800, 600, 1);
  ok(wrote === 2 && words === 'Tusken Raider · 117', 'while a level that moves is written again');
  const crate = { key: 10, label: 'a crate', dead: false, pos: { x: 0, y: 0, z: -5 }, halfHeight: 1 } as any;
  plates.clear();
  plates.track(0.016, [crate], 0, 1, 0, 0, 0, -1, camera, 800, 600, 1);
  ok(words === 'a crate', 'and a thing with no level shows its name alone');
}

console.log(`\n${checks} checks passed`);
