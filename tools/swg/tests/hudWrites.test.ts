// What the head-up display writes to the page (src/ui/hud.ts), and the number slots behind it
// (src/combat/kit.ts, jedi.ts, bountyHunter.ts).
//
// The display is driven against a stand-in for the DOM that counts every property written and every
// property read back, so "a steady frame writes nothing" is a measurement rather than a claim. That
// matters because the only other way to know is to watch a profiler on a screen, and the sessions
// that work on this file cannot see one.
//
// What is pinned here: a frame in which nothing has changed writes nothing at all; a bar moves by a
// transform and never by a width; the prompt and the weather's word are compared against what was
// written and never read back off the element; the nearby line is written when its name changes and
// never on a clock; a rebuild of the slot row counts exactly as many
// writes as it makes; the invented steps take only the names they know; and each class keeps one
// slot array for its life, refilled when the loadout is set.
//
// Everything here is synthetic: a made-up kit and made-up numbers, nothing read from the game's files.
import assert from 'node:assert/strict';

// --- the stand-in for the page -------------------------------------------------------------------
// One counter for writes, one for each kind of read a guard might be tempted to make.
const count = { writes: 0, width: 0, transform: 0, readHtml: 0, readText: 0 };

function styleBag(): Record<string, string> {
  // A custom property is a write like any other: the ability cells' cooldown is one number on the
  // cell, so `setProperty` has to be here or the count would miss it.
  const bag: Record<string, any> = {
    setProperty(name: string, value: string) {
      count.writes++;
      bag[name] = String(value);
    },
  };
  return new Proxy(bag, {
    set(t, k, v) {
      count.writes++;
      if (k === 'width') count.width++;
      if (k === 'transform') count.transform++;
      t[String(k)] = String(v);
      return true;
    },
    get(t, k) {
      const v = t[String(k)];
      return v === undefined ? '' : v;
    },
  }) as Record<string, string>;
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
const { HUD_SIZES } = await import('../../../src/ui/hudMath.ts');
// Health and Force go away a while after they are full (the interface rewrite's first wave): that one write a bar is
// counted on its own in `hudBars.test.ts`, so the counts here are not left to where a frame's clock happens to fall.
const lingerWas = HUD_SIZES.fullLinger;
HUD_SIZES.fullLinger = 1e9;

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
// The bars: a transform, never a width, and no number beside them any more.
count.width = 0;
count.transform = 0;
{
  // The on-foot bars carry the ghost the rest of the interface's bars carry: a fall leaves it where
  // the bar was and the stylesheet walks it down, which is what makes the size of a blow legible.
  // So a fall costs three writes -- the ghost off its snap, the ghost's own value and the fill (the
  // number beside it went with the interface rewrite: the bar is the reading) -- and every frame
  // after it costs nothing, which is the half that matters.
  const made = writes(() => frame(99));
  ok(made === 3, `a point of health off is the ghost off its snap, the ghost and the bar, and no number (wrote ${made})`);
  ok(count.transform > 0, 'the bar moved by a transform');
  ok(count.width === 0, 'and never by a width');
  ok(writes(() => { for (let i = 0; i < 30; i++) frame(99); }) === 0, 'and holding there writes nothing more, the easing ghost included');
  // A fifth of a point moves the bar by a pixel of its own length; the ghost is already off its
  // snap, so this fall is the bar and the ghost and nothing else.
  ok(writes(() => frame(98.8)) === 2, 'a pixel of the bar is the bar and its ghost');
  ok(writes(() => frame(98.799)) === 0, 'a change under a pixel of the bar leaves both alone');
  // The ease ending puts the ghost back behind the fill: one class, and no value, because a fall
  // wrote the ghost to where the bar was going and it is already there.
  const settle = writes(() => { for (let i = 0; i < 45; i++) frame(98.799); });
  ok(settle === 1, `a ghost's ease ending writes once and no more (wrote ${settle})`);
  ok(writes(() => { for (let i = 0; i < 30; i++) frame(98.799); }) === 0, 'and the bar is steady again');
  kit.resource.value = 60;
  ok(writes(() => frame(98.799)) === 3, 'the class pool falling is its ghost off its snap, its ghost and its bar');
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
  // A cooldown (the interface rewrite's second wave, item 7) is one animation the stylesheet runs: the cell loses its
  // ready mark the moment it begins (the stylesheet darkens it whole), the fill starts once the share has been seen to
  // fall (its length, how far into it the share is, and the class that runs it), and ready is the mark back, the fill
  // off and the flash. The wedge drawn from a number written step by step is gone.
  kit.cd = 0.5;
  ok(writes(() => frame(98.799)) === 1, 'a cooldown beginning is the ready mark off the cell, and nothing else');
  kit.cd = 0.5004;
  ok(writes(() => frame(98.799)) === 0, 'a share that has not fallen starts nothing');
  kit.cd = 0.46;
  ok(writes(() => frame(98.799)) === 3, 'seen to fall, the fill starts: its length, how far into it, and the class that runs it');
  kit.cd = 0;
  ok(writes(() => frame(98.799)) === 3, 'and ready is the mark back, the fill off and the flash');
}

// ---------------------------------------------------------------------------------------------
// A whole cooldown at the kit's own pace, on a clock of the test's own (`performance.now` stood in): nothing is written
// between its start and its end, a pause of the game holds it without a write, a hitch that moves the kit's cooldown on
// past the page's is put back with one property, and a press darkens the cell and lets it go. Every write counted here is
// the cell's own.
{
  const realNow = performance.now;
  let t = 2000;
  Object.defineProperty(performance, 'now', { value: () => t, configurable: true, writable: true });
  try {
    const h3 = new Hud(makeEl());
    const k3 = testKit();
    let pressed = false;
    h3.setInput({ bindings: { slot1: ['Digit1'], slot2: ['Digit2'], saberToggle: ['KeyL'] }, pressedAction: (a: string) => pressed && a === 'slot1' });
    h3.setKit(k3);
    const cell = (h3 as any).slots[0];
    const own = { n: 0, names: new Set<string>(), props: {} as Record<string, string> };
    cell.root.classList = {
      toggle: (name: string, on?: boolean) => {
        own.n++;
        const want = on === undefined ? !own.names.has(name) : on;
        if (want) own.names.add(name);
        else own.names.delete(name);
        return want;
      },
      contains: (name: string) => own.names.has(name),
    };
    cell.root.style = { setProperty: (k: string, v: string) => { own.n++; own.props[k] = v; } };
    own.names.add('ready');
    const step = (ms = 16) => {
      t += ms;
      h3.update(ms / 1000, 1, 2, 3, k3, 100, 100, '12:00', '', false);
    };
    for (let i = 0; i < 30; i++) step();
    const per = 2; // the kit's whole share takes two seconds
    k3.cd = 1;
    own.n = 0;
    step();
    ok(own.n === 1 && !own.names.has('ready'), `a cooldown beginning darkens the cell with one class (${own.n})`);
    own.n = 0;
    k3.cd -= 0.016 / per;
    step();
    ok(own.n === 3 && own.names.has('cool') && Math.abs(Number(own.props['--cool-s']) - per) < 1e-6 && Math.abs(Number(own.props['--cool-at']) - 0.016) < 1e-6, `seen to fall, its fill starts at the kit's own pace, ${own.props['--cool-s']} s, already ${own.props['--cool-at']} s in (${own.n} writes)`);
    own.n = 0;
    for (let i = 0; i < 40; i++) {
      k3.cd -= 0.016 / per;
      step();
    }
    ok(own.n === 0, `running at the kit's pace it writes nothing at all (${own.n} in 40 frames)`);
    // The game stands still (a menu): the kit's cooldown holds, so does the page's (`paused` on the bar), and the time is
    // left out of the cell's model, so running on again writes nothing.
    h3.setLive(false);
    for (let i = 0; i < 60; i++) step();
    h3.setLive(true);
    for (let i = 0; i < 20; i++) {
      k3.cd -= 0.016 / per;
      step();
    }
    ok(own.n === 0 && (h3 as any).slotsEl !== undefined, `a pause of a second holds it, and running on afterwards writes nothing (${own.n})`);
    // A hitch: the kit's cooldown moves on by 0.4 s the page never saw. More than `coolSlack` apart, one property puts the
    // page's fill where the kit is.
    k3.cd -= 0.4 / per;
    step();
    ok(own.n === 1 && 'coolSlack' in HUD_TUNE, `a hitch past the slack is one property, the fill put where the kit is (${own.n})`);
    own.n = 0;
    for (let i = 0; i < 20; i++) {
      k3.cd -= 0.016 / per;
      step();
    }
    ok(own.n === 0, `and then it writes nothing again (${own.n})`);
    // Ready: the mark back, the fill off, the flash.
    k3.cd = 0;
    step();
    ok(own.n === 3 && own.names.has('ready') && !own.names.has('cool') && own.names.has('flash'), `ready, the mark back, the fill off and the flash (${own.n})`);
    // A press: darkened for `pressInSeconds`, then let go; read only while the game runs.
    own.n = 0;
    pressed = true;
    step();
    pressed = false;
    ok(own.n === 1 && own.names.has('pressed'), 'a press darkens its cell with one class');
    for (let i = 0; i < 10; i++) step();
    ok(own.n === 2 && !own.names.has('pressed'), `and lets it go a moment later with one more (${own.n})`);
    h3.setLive(false);
    pressed = true;
    step();
    pressed = false;
    ok(own.n === 2 && !own.names.has('pressed'), 'a key pressed while the game stands still (a menu) darkens nothing');
    h3.setLive(true);
    ok(/ready/.test(h3.report().kit), `and the console reads the bar in words (${h3.report().kit})`);
  } finally {
    Object.defineProperty(performance, 'now', { value: realNow, configurable: true, writable: true });
  }
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
  const word = writes(() => {
    hud.setWeather('Rain', false);
    hud.setWeather('Rain', false);
    hud.setWeather('Rain', false);
  });
  ok(word === 2, `the weather's word is written once, the word and its line coming up (wrote ${word})`);
  ok(writes(() => { hud.setWeather('Rain', true); hud.setWeather('Rain', true); }) === 1, 'held, the muted words after it are one class, once');
  ok(count.readText === 0, `and its element is never read back either (${count.readText} reads)`);
}

// ---------------------------------------------------------------------------------------------
// The nearby line, which has a line of its own at the foot of the corner now that the coordinates sit
// over the minimap: written when the name changes and at no other time, not on the clock that writes
// `/loc` four times a second; and `/loc` itself, which no longer carries the name. A display of its own,
// on a clock of the test's own (`performance.now` stood in for), so the four-times-a-second line comes
// exactly when the test says and never in the middle of a count; and its root kept, so what each line
// says can be read as well as how often it was written.
{
  let root: any = null;
  const parent = makeEl();
  parent.appendChild = (k: any) => {
    root = k;
    return k;
  };
  const realNow = performance.now;
  let t = realNow.call(performance);
  Object.defineProperty(performance, 'now', { value: () => t, configurable: true, writable: true });
  try {
    const h2 = new Hud(parent);
    h2.setKit(kit);
    const nearbyEl = root.querySelector('.hud-nearby');
    const locEl = root.querySelector('.loc');
    /** One frame, the clock held where it is unless told to move. */
    const step = (name: string, ms = 0) => {
      t += ms;
      h2.update(0.016, 1234.4, -5.6, 7.2, kit, 98.799, 100, '12:00', name, false);
    };
    // Settled first, the clock running: the first frames write the bars, the ghosts ease, the line clock fires.
    for (let i = 0; i < 120; i++) step('none', 16);
    step('none', 300);
    const quiet = writes(() => { for (let i = 0; i < 30; i++) step('none'); });
    ok(quiet === 0, `held still, the display writes nothing (${quiet})`);
    const before = h2.stats().writesNow;
    ok(writes(() => step('Bantha')) === 1 && nearbyEl.textContent === 'nearby: Bantha', `a new name nearby is one write, and the line says it (${nearbyEl.textContent})`);
    ok(h2.stats().writesNow - before === 1, "and the display counts it, which is the figure `__debug.hud()` reads");
    ok(writes(() => { for (let i = 0; i < 30; i++) step('Bantha'); }) === 0, 'and the same name again is none');
    // The line clock comes round with a name nearby: `/loc` is the place and nothing else.
    step('Bantha', 300);
    ok(locEl.textContent === '/loc 1234, -6, 7', `and the /loc line says where you are and carries no name (${locEl.textContent})`);
    const before2 = h2.stats().writesNow;
    ok(writes(() => step('')) === 1 && nearbyEl.textContent === '', 'and the plate over a head taking over empties the line with one write');
    ok(h2.stats().writesNow - before2 === 1, 'counted by the display as well');
  } finally {
    Object.defineProperty(performance, 'now', { value: realNow, configurable: true, writable: true });
  }
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

HUD_SIZES.fullLinger = lingerWas;

// The two classes themselves cannot be driven from node: `src/combat/jedi.ts` and
// `src/combat/bountyHunter.ts` use constructor parameter properties and extensionless imports, which
// node's type stripping refuses. Their side of this work -- one slot array per class, refilled by
// `setLoadout`, with the ability behind each slot beside it -- is held by the contract written on
// `Kit.slots` in `src/combat/kit.ts` and by the owner's check of the number keys.

console.log(`\n${checks} checks passed`);
