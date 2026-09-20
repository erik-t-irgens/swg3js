// What the head-up display writes to the page (src/ui/hud.ts), and the number slots behind it
// (src/combat/kit.ts, jedi.ts, bountyHunter.ts).
//
// The display is driven against a stand-in for the DOM that counts every property written and every
// property read back, so "a steady frame writes nothing" is a measurement rather than a claim. That
// matters because the only other way to know is to watch a profiler on a screen, and the sessions
// that work on this file cannot see one.
//
// What is pinned here: a frame in which nothing has changed writes nothing at all; a bar moves by a
// transform and never by a width; the prompt and the weather note are compared against what was
// written and never read back off the element; a rebuild of the slot row counts exactly as many
// writes as it makes; the invented steps take only the names they know; and each class keeps one
// slot array for its life, refilled when the loadout is set.
//
// Everything here is synthetic: a made-up kit and made-up numbers, nothing read from the game's files.
import assert from 'node:assert/strict';

// --- the stand-in for the page -------------------------------------------------------------------
// One counter for writes, one for each kind of read a guard might be tempted to make.
const count = { writes: 0, width: 0, transform: 0, readHtml: 0, readText: 0 };

function styleBag(): Record<string, string> {
  const bag: Record<string, string> = {};
  return new Proxy(bag, {
    set(t, k, v) {
      count.writes++;
      if (k === 'width') count.width++;
      if (k === 'transform') count.transform++;
      t[String(k)] = String(v);
      return true;
    },
    get(t, k) {
      return t[String(k)] ?? '';
    },
  });
}

/** An element: every write counted, every element with its own cache of what a selector found. */
function makeEl(): any {
  const found = new Map<string, any>();
  const el: any = {
    style: styleBag(),
    classList: {
      toggle(_name: string, _force?: boolean) {
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
  Object.defineProperty(el, 'textContent', {
    get: () => {
      count.readText++;
      return text;
    },
    set: (v) => {
      count.writes++;
      text = String(v);
    },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => {
      count.readHtml++;
      return html;
    },
    set: (v) => {
      count.writes++;
      html = String(v);
    },
  });
  Object.defineProperty(el, 'className', {
    get: () => cls,
    set: (v) => {
      count.writes++;
      cls = String(v);
    },
  });
  Object.defineProperty(el, 'hidden', {
    get: () => hidden,
    set: (v) => {
      count.writes++;
      hidden = !!v;
    },
  });
  return el;
}

(globalThis as any).document = { createElement: () => makeEl() };

const { Hud, HUD_TUNE } = await import('../../../src/ui/hud.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
/** Run something and give back the writes it made. */
function writes(what: () => void): number {
  count.writes = 0;
  what();
  return count.writes;
}

/** A made-up class with two powers, one of which has a cooldown we move by hand. */
function testKit(): any {
  return {
    id: 'jedi',
    name: 'Jedi',
    slots: [
      { key: '1', name: 'Force jump', cost: '20' },
      { key: '2', name: 'Force speed', cost: '5/s' },
    ],
    help: [],
    resource: { label: 'Force', value: 100, max: 100 },
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

const kit = testKit();
const hud = new Hud(makeEl());
const frame = (hp = 100) => hud.update(0.016, 1, 2, 3, kit, hp, 100, '12:00', 'none', false);

// ---------------------------------------------------------------------------------------------
// A rebuild of the slot row is meant to write, and it says how much it wrote.
{
  const made = writes(() => hud.setKit(kit));
  ok(made > 0, `a rebuild of the slot row writes (${made} writes)`);
  ok(hud.stats().byDesignNow === made, `and counts every one of them, not an estimate (says ${hud.stats().byDesignNow})`);
}

// ---------------------------------------------------------------------------------------------
// A steady frame.
frame();
frame();
{
  const before = hud.stats().writesNow;
  const made = writes(() => {
    for (let i = 0; i < 60; i++) frame();
  });
  ok(made === 0, `sixty steady frames write nothing to the page (wrote ${made})`);
  ok(hud.stats().writesNow - before === 0, 'and the display agrees, which is the figure the console reads');
}

// ---------------------------------------------------------------------------------------------
// The bars: a transform, never a width, and the bar and its number guarded apart.
count.width = 0;
count.transform = 0;
{
  const made = writes(() => frame(99));
  ok(made === 2, `a point of health off is one bar write and one number write (wrote ${made})`);
  ok(count.transform > 0, 'the bar moved by a transform');
  ok(count.width === 0, 'and never by a width');
  ok(writes(() => { for (let i = 0; i < 30; i++) frame(99); }) === 0, 'and holding there writes nothing more');
  // A fifth of a point moves the bar by a pixel of its own length but leaves the number alone.
  ok(writes(() => frame(98.8)) === 1, 'the bar and its number are guarded apart');
  ok(writes(() => frame(98.799)) === 0, 'a change under a pixel of the bar leaves both alone');
  kit.resource.value = 60;
  ok(writes(() => frame(98.799)) === 2, 'the class pool falling is a bar write and a number write');
}

// ---------------------------------------------------------------------------------------------
// "Nothing written yet" is NaN, not -1: a health of exactly -1 is a number that must reach the page.
{
  const fresh = new Hud(makeEl());
  fresh.setKit(kit);
  const made = writes(() => fresh.update(0.016, 0, 0, 0, kit, -1, 100, '12:00', 'none', false));
  ok(made >= 2, `a health of exactly -1 is written on the first frame (wrote ${made})`);
}

// ---------------------------------------------------------------------------------------------
// The slot row: written on a change and on nothing else.
{
  ok(writes(() => { for (let i = 0; i < 10; i++) frame(98.799); }) === 0, 'a slot row that has not changed writes nothing');
  kit.lit = true;
  ok(writes(() => frame(98.799)) === 1, 'a power coming on lights its cell with one write');
  kit.cd = 0.5;
  ok(writes(() => frame(98.799)) === 1, 'a cooldown starting shades its cell with one write');
  kit.cd = 0.5004;
  ok(writes(() => frame(98.799)) === 0, 'and a change under the cooldown step writes nothing');
}

// ---------------------------------------------------------------------------------------------
// The two lines that used to be compared by reading the page back.
{
  count.readHtml = 0;
  const made = writes(() => {
    hud.setPrompt('E board');
    hud.setPrompt('E board');
    hud.setPrompt('E board');
  });
  ok(made === 1, `the prompt is written once for three of the same line (wrote ${made})`);
  ok(count.readHtml === 0, `and its element is never read back (${count.readHtml} reads)`);
  count.readText = 0;
  const note = writes(() => {
    hud.setWeatherNote('held');
    hud.setWeatherNote('held');
    hud.setWeatherNote('held');
  });
  ok(note === 2, `the weather note is written once, text and hidden (wrote ${note})`);
  ok(count.readText === 0, `and its element is never read back either (${count.readText} reads)`);
}

// ---------------------------------------------------------------------------------------------
// The mouse-free line and the hurt fade.
{
  ok(writes(() => { hud.setMouseFree(false); hud.setMouseFree(false); }) === 0, 'the mouse-free line is left alone while nothing changed');
  ok(writes(() => hud.setMouseFree(true)) === 2, 'and written when it does change');
  hud.hurt();
  for (let i = 0; i < 200; i++) frame(98.799);
  ok(writes(() => { for (let i = 0; i < 60; i++) frame(98.799); }) === 0, 'a hurt flash that has faded writes nothing more');
}

// ---------------------------------------------------------------------------------------------
// The console's two calls.
{
  const stats = hud.stats();
  ok(hud.stats() === stats, 'stats() hands back one object, filled in place');
  const before = HUD_TUNE.barPixels;
  const said: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => said.push(String(m));
  const reply = hud.tune({ barPixel: 1 } as any);
  console.warn = warn;
  ok(said.length === 1 && HUD_TUNE.barPixels === before, 'tune() says so when given a step it does not have, and changes nothing');
  ok(reply !== (HUD_TUNE as any), 'and hands back a copy rather than the table itself');
  ok(reply.barPixels === HUD_TUNE.barPixels, 'with the live values in it');
  hud.tune({ barPixels: 40 });
  ok(HUD_TUNE.barPixels === 40, 'a step it does have is taken');
  ok(writes(() => frame(98.799)) > 0, 'and what was drawn at the old step is written again at the new one');
  hud.tune({ barPixels: before });
}

// ---------------------------------------------------------------------------------------------
// The row walks the cells it built, not the class's array, so a loadout changed without the row
// being rebuilt cannot reach past the end of it: it used to throw.
{
  frame(98.799); // settle after the step above was put back
  kit.slots.push({ key: '3', name: 'Force heal', cost: '30' });
  ok(writes(() => frame(98.799)) === 0, 'a power added to the class without a rebuild leaves the row alone');
  kit.slots.length = 0;
  ok(writes(() => frame(98.799)) === 0, 'and a loadout emptied under it does not reach past the row either');
}

// The two classes themselves cannot be driven from node: `src/combat/jedi.ts` and
// `src/combat/bountyHunter.ts` use constructor parameter properties and extensionless imports, which
// node's type stripping refuses. Their side of this work -- one slot array per class, refilled by
// `setLoadout`, with the ability behind each slot beside it -- is held by the contract written on
// `Kit.slots` in `src/combat/kit.ts` and by the owner's check of the number keys.

console.log(`\n${checks} checks passed`);
