// The interface's own glyphs (src/ui/hud.svg, src/ui/hudIcons.ts), the keys the ability cells show
// (src/ui/hud.ts), and the nameplate's two pure halves (src/ui/nameplate.ts).
//
// What is pinned here:
//
//   - the sheet and the list of glyphs agree exactly, both ways, so a glyph renamed in one file and
//     not the other fails a test rather than leaving an empty cell on the screen;
//   - every glyph is stroked and never filled, which is what lets one mark read at 10 px and at
//     40 px and take its colour from the cell it is in;
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
const { pickPlate, projectPoint, healthShare, makeProjected } = await import('../../../src/ui/nameplate.ts');

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
}

console.log(`\n${checks} checks passed`);
