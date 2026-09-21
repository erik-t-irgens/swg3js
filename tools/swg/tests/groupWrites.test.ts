// What the group's panel and the chat line write to the page (src/ui/groupUi.ts, src/ui/chatUi.ts).
//
// Both are driven against a stand-in for the DOM that counts every property written, so "a steady
// frame writes nothing" is a measurement rather than a claim. The sessions that work on these files
// cannot watch a profiler on a screen, so the count is the only honest way to know.
//
// What is pinned here: a bubble over a speaker standing still writes nothing after the frame that
// put it there; the loop that carries the bubbles stops itself when the last one goes, so a screen
// with nobody talking costs nothing at all; a pass of the group's slow step with nothing changed
// writes nothing; a chevron over a member who has not moved writes nothing; and with no server
// neither panel opens or writes at all.
//
// Everything here is synthetic: made-up players at made-up places, nothing read from the game's files.
import assert from 'node:assert/strict';

// --- the stand-in for the page ---------------------------------------------------------------------

const count = { writes: 0 };

function styleBag(): Record<string, string> {
  const bag: Record<string, unknown> = {
    setProperty(name: string, value: string) {
      count.writes++;
      bag[name] = String(value);
    },
  };
  return new Proxy(bag, {
    set(t, k, v) {
      count.writes++;
      (t as Record<string, string>)[String(k)] = String(v);
      return true;
    },
    get(t, k) {
      const v = (t as Record<string, string>)[String(k)];
      return v === undefined ? '' : v;
    },
  }) as unknown as Record<string, string>;
}

interface FakeEl {
  [key: string]: unknown;
}

/** Every input the panels made, so a key can be typed into the chat field as a browser would deliver it. */
const inputs: FakeEl[] = [];

/** An element: every write counted, and each selector answered with the same child every time. */
function makeEl(tag = 'div'): FakeEl {
  const found = new Map<string, FakeEl>();
  const classes = new Set<string>();
  const on = new Map<string, ((e: unknown) => void)[]>();
  const el: FakeEl = {
    tagName: tag.toUpperCase(),
    style: styleBag(),
    classList: {
      add(name: string) {
        if (classes.has(name)) return;
        classes.add(name);
        count.writes++;
      },
      remove(name: string) {
        if (!classes.has(name)) return;
        classes.delete(name);
        count.writes++;
      },
      toggle(name: string, force?: boolean) {
        const want = force === undefined ? !classes.has(name) : force;
        if (want === classes.has(name)) return;
        if (want) classes.add(name);
        else classes.delete(name);
        count.writes++;
      },
      contains: (name: string) => classes.has(name),
    },
    setAttribute() {
      count.writes++;
    },
    appendChild(child: FakeEl) {
      return child;
    },
    removeChild() {},
    remove() {},
    focus() {},
    blur() {},
    addEventListener(type: string, fn: (e: unknown) => void) {
      const list = on.get(type);
      if (list) list.push(fn);
      else on.set(type, [fn]);
    },
    removeEventListener() {},
    /** Deliver an event to this element, the way a browser delivers one to a field with the keyboard. */
    fire(type: string, e: unknown) {
      for (const fn of [...(on.get(type) ?? [])]) fn(e);
    },
    querySelector(sel: string) {
      let hit = found.get(sel);
      if (!hit) {
        hit = makeEl(sel === 'input' ? 'input' : 'div');
        found.set(sel, hit);
      }
      return hit;
    },
    querySelectorAll: () => [] as FakeEl[],
  };
  let text = '';
  let html = '';
  let cls = '';
  Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => { count.writes++; text = String(v); } });
  Object.defineProperty(el, 'innerHTML', { get: () => html, set: (v) => { count.writes++; html = String(v); } });
  Object.defineProperty(el, 'className', {
    get: () => cls,
    set: (v) => {
      count.writes++;
      cls = String(v);
      classes.clear();
      for (const part of cls.split(/\s+/)) if (part) classes.add(part);
    },
  });
  if (el.tagName === 'INPUT') inputs.push(el);
  return el;
}

// The head, so a panel's stylesheet goes in once; `getElementById` answers nothing the first time
// and the element after, which is what the guard in each panel is for.
const styles = new Map<string, FakeEl>();
const g = globalThis as unknown as Record<string, unknown>;
/** The handlers each panel hangs on the document, and what the pointer lock is on right now. */
const lockHandlers: (() => void)[] = [];
const doc = {
  createElement: (tag: string) => makeEl(tag),
  head: {
    appendChild(el: FakeEl) {
      const id = String(el.id ?? '');
      if (id) styles.set(id, el);
      return el;
    },
  },
  getElementById: (id: string) => styles.get(id) ?? null,
  pointerLockElement: null as unknown,
  addEventListener(type: string, fn: () => void) {
    if (type === 'pointerlockchange') lockHandlers.push(fn);
  },
  removeEventListener(type: string, fn: () => void) {
    const i = lockHandlers.indexOf(fn);
    if (i >= 0) lockHandlers.splice(i, 1);
  },
};
g.document = doc;

/** The pointer lock going to the game, or coming back: every panel listening is told, as a browser does. */
function setLock(on: boolean): void {
  doc.pointerLockElement = on ? ({} as unknown) : null;
  for (const fn of [...lockHandlers]) fn();
}

/** A clock and a frame queue the test steps by hand: nothing here waits on a real one. */
let nowMs = 1_000_000;
let nextFrame: (() => void) | null = null;
let rafId = 0;
const timers = new Map<number, { fn: () => void; every: number; at: number }>();
const once = new Map<number, { fn: () => void; at: number }>();
let timerId = 0;
/** Every keydown handler the panels have hung on the window, so the keys can be pressed for real. */
const keyHandlers: ((e: unknown) => void)[] = [];
g.performance = { now: () => nowMs };
g.requestAnimationFrame = (fn: () => void) => {
  nextFrame = fn;
  return ++rafId;
};
g.cancelAnimationFrame = () => {
  nextFrame = null;
};
g.window = {
  addEventListener(type: string, fn: (e: unknown) => void) {
    if (type === 'keydown') keyHandlers.push(fn);
  },
  removeEventListener(type: string, fn: (e: unknown) => void) {
    const i = keyHandlers.indexOf(fn);
    if (i >= 0) keyHandlers.splice(i, 1);
  },
  setInterval: (fn: () => void, every: number) => {
    timers.set(++timerId, { fn, every, at: nowMs + every });
    return timerId;
  },
  clearInterval: (id: number) => void timers.delete(id),
  setTimeout: (fn: () => void, after = 0) => {
    once.set(++timerId, { fn, at: nowMs + after });
    return timerId;
  },
  clearTimeout: (id: number) => void once.delete(id),
};

/** A key pressed in the world, stopping at whichever handler says it has taken it. */
function press(code: string, target: unknown = null): void {
  let stopped = false;
  const e = {
    code,
    target,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {
      stopped = true;
    },
  };
  for (const fn of [...keyHandlers]) {
    if (stopped) break;
    fn(e);
  }
}

/** Let time pass: every frame the game would draw, and every timer that comes due. */
function pass(ms: number, frames = 1): void {
  const step = ms / Math.max(1, frames);
  for (let i = 0; i < frames; i++) {
    nowMs += step;
    for (const t of timers.values()) {
      if (nowMs < t.at) continue;
      t.at = nowMs + t.every;
      t.fn();
    }
    for (const [id, t] of [...once]) {
      if (nowMs < t.at) continue;
      once.delete(id);
      t.fn();
    }
    const fn = nextFrame;
    nextFrame = null;
    fn?.();
  }
}

/** Run something and give back the writes it made. */
function writes(what: () => void): number {
  count.writes = 0;
  what();
  return count.writes;
}

const { Groups } = await import('../../../src/net/groups.ts');
const { GroupUi, GROUP_UI_TUNE, tuneGroupUi } = await import('../../../src/ui/groupUi.ts');
const { ChatUi, CHAT_TUNE, tuneChat } = await import('../../../src/ui/chatUi.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- a game to hang them on --------------------------------------------------------------------------

const places = new Map<number, [number, number, number]>();
let onScreen = true;
const groups = new Groups(() => nowMs / 1000);
let authority: 'me' | 'server' = 'server';
groups.authority = () => authority;
groups.selfId = () => 7;
groups.serverNow = () => nowMs;
groups.send = () => {};
groups.meAt = (out) => {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  return true;
};
groups.peerAt = (id, out) => {
  const p = places.get(id);
  if (!p) return false;
  out.x = p[0];
  out.y = p[1];
  out.z = p[2];
  return true;
};

const screen = { x: 640, y: 360 };
const project = (x: number, y: number, z: number, out: { x: number; y: number }) => {
  if (!onScreen) return false;
  void y;
  out.x = screen.x + x;
  out.y = screen.y + z;
  return true;
};

/** What the game was asked for: the keyboard standing aside, the mouse freed, the pointer asked back. */
const asked = { typing: false, relocks: 0, freed: 0, held: 0 };
let canOpen = true;

const parent = makeEl();
const chat = new ChatUi(parent as never, {
  groups,
  say: () => {},
  project,
  anchor: (id, out) => groups.peerAt(id, out),
  meAt: (out) => groups.meAt(out),
  canOpen: () => canOpen,
  typing: (on) => {
    asked.typing = on;
  },
  relock: () => {
    asked.relocks++;
  },
});
const panel = new GroupUi(parent as never, {
  groups,
  note: () => {},
  project,
  anchor: (id, out) => groups.peerAt(id, out),
  view: (eye, dir) => {
    eye.x = 0;
    eye.y = 1.6;
    eye.z = 0;
    dir.x = 0;
    dir.y = 0;
    dir.z = -1;
    return true;
  },
  peersHere: () => 0,
  canOpen: () => canOpen,
  freeMouse: (free) => {
    if (free) asked.freed++;
    else asked.held++;
  },
});

// --- the chat line's bubbles ---------------------------------------------------------------------------

{
  places.set(8, [0, 0, -10]);
  const first = writes(() => groups.handle({ t: 'chat', id: 8, from: 'Han', scope: 'say', text: 'over here' }));
  ok(first > 0, `a line said puts a bubble up, which writes (${first} writes)`);
  ok(chat.debug().running, 'and starts the loop that carries it');
  const put = writes(() => pass(16));
  ok(put > 0, `the frame that first places the bubble writes (${put} writes)`);
  const still = writes(() => pass(16 * 10, 10));
  ok(still === 0, `ten frames over a speaker standing still write nothing at all (${still} writes)`);
  const moved = writes(() => {
    places.set(8, [0, 0, -14]);
    pass(16);
  });
  ok(moved > 0, 'a speaker who has moved has their bubble moved with them');
  const gone = writes(() => {
    onScreen = false;
    pass(16);
  });
  ok(gone > 0, 'a speaker who goes off the screen has their bubble taken down');
  const stillGone = writes(() => pass(16 * 5, 5));
  ok(stillGone === 0, 'and nothing is written while they stay off it');
  onScreen = true;
  // The bubble's life runs out and the loop stops itself.
  pass(CHAT_TUNE.fade * 1000, 4);
  pass(8000, 40);
  ok(chat.debug().bubbles === 0, 'a bubble is taken down when its few seconds are up');
  ok(!chat.debug().running && nextFrame === null, 'and with the last one down the loop stops: a screen with nobody talking costs nothing');
  const quiet = writes(() => pass(1000, 60));
  ok(quiet === 0, `a second of frames with nothing being said writes nothing (${quiet} writes)`);
  ok(chat.debug().writes > 0, 'the line counts its own writes, so the console can read the rate');
}

// --- one bubble per speaker, and the pool is fixed ---------------------------------------------------------

{
  for (let i = 0; i < CHAT_TUNE.pool + 4; i++) {
    places.set(20 + i, [i, 0, -10]);
    groups.handle({ t: 'chat', id: 20 + i, from: `p${i}`, scope: 'say', text: `line ${i}` });
  }
  pass(16);
  ok(chat.debug().bubbles <= CHAT_TUNE.pool, `never more bubbles than the pool holds (${chat.debug().bubbles} of ${CHAT_TUNE.pool})`);
  pass(9000, 60);
  // With the pool empty, one speaker saying two things is one bubble and not two: a count against a
  // full pool could never have gone up, so it proved nothing.
  ok(chat.debug().bubbles === 0, 'and the pool empties again when they have all had their few seconds');
  places.set(30, [0, 0, -10]);
  groups.handle({ t: 'chat', id: 30, from: 'Chewie', scope: 'say', text: 'first' });
  pass(16);
  const before = chat.debug().bubbles;
  groups.handle({ t: 'chat', id: 30, from: 'Chewie', scope: 'say', text: 'second' });
  pass(16);
  ok(before === 1 && chat.debug().bubbles === 1, `a second line from one speaker replaces their first rather than stacking (${before} then ${chat.debug().bubbles})`);
  pass(9000, 60);
}

// --- the group's panel -----------------------------------------------------------------------------------

{
  const roster = (distance: number) => {
    places.set(8, [0, 0, -distance]);
    groups.handle({
      t: 'group',
      do: 'roster',
      id: 'g1',
      leader: 'm1',
      you: 'm1',
      members: [
        { m: 'm1', s: 7, name: 'You', planet: 'tatooine', zone: '', hp: null, leader: 1, here: 1 },
        { m: 'm2', s: 8, name: 'Han', planet: 'tatooine', zone: '', hp: null, leader: 0, here: 1 },
      ],
    });
  };
  const made = writes(() => roster(10));
  ok(made > 0, `a roster from the server writes the panel's rows (${made} writes)`);
  panel.show();
  pass(300);
  const steady = writes(() => pass(1000, 4));
  ok(steady === 0, `a second of the slow step with nobody moving writes nothing (${steady} writes)`);
  // Being in a group is not on its own a reason to run a loop every frame. Nobody here is past the
  // chevron distance, so there is nothing for a frame to carry and no frame should run at all.
  const framesWas = panel.debug().frames;
  pass(1000, 60);
  ok(panel.debug().frames === framesWas, `a second in a group with nobody far off runs no frames at all (${panel.debug().frames - framesWas})`);
  // The rate of that slow step is a live number, and a panel already running is armed again at it.
  const slow = panel.debug().ticks;
  pass(1000, 60);
  const atFour = panel.debug().ticks - slow;
  tuneGroupUi({ hz: 12 });
  const fast = panel.debug().ticks;
  pass(1000, 60);
  const atTwelve = panel.debug().ticks - fast;
  ok(atTwelve > atFour, `the step's rate can be moved from the console while the group stands (${atFour} a second, then ${atTwelve})`);
  tuneGroupUi({ hz: 4 });
  const walked = writes(() => {
    places.set(8, [0, 0, -25]);
    pass(500, 2);
  });
  ok(walked > 0, 'a member who has walked has their distance written, and only then');
  // The chevron: a member beyond the invented distance gets one, and it follows the camera.
  places.set(8, [0, 0, -100]);
  pass(500, 2);
  pass(16);
  ok(panel.debug().chevrons === 1, 'a member too far off to make out is given a chevron');
  const held = writes(() => pass(16 * 10, 10));
  ok(held === 0, `ten frames with that member standing still write nothing (${held} writes)`);
  places.set(8, [0, 0, -20]);
  pass(500, 2);
  pass(16);
  ok(panel.debug().chevrons === 0, 'and it goes when they are near enough to see');
  // The group ending takes the panel and the chevrons with it.
  groups.handle({ t: 'group', do: 'none', why: 'left' });
  pass(16);
  ok(!panel.open && panel.debug().chevrons === 0, 'the group ending shuts the panel and takes the chevrons away');
  const after = writes(() => pass(1000, 60));
  ok(after === 0, 'and with no group there is nothing to write at all');
}

// --- the keys, and the rule the wave turns on: with no server they do nothing --------------------------------

{
  authority = 'me';
  groups.clear();
  const quiet = writes(() => {
    press(GROUP_UI_TUNE.panelKey);
    press('Enter');
    pass(1000, 30);
  });
  ok(!groups.active, 'with no server the group is not active');
  ok(!panel.open && !chat.open, 'and neither key opens anything at all: a game played alone is the game it was');
  ok(quiet === 0, `nothing is written to the page either (${quiet} writes)`);
  ok(groups.type('hello there') !== '', 'a line typed says plainly that nobody heard it');
  authority = 'server';
}

// --- the keys with a server, and a field somewhere else keeping its own ----------------------------------------

{
  press('Enter', { tagName: 'INPUT' });
  press(GROUP_UI_TUNE.panelKey, { tagName: 'INPUT' });
  ok(!chat.open && !panel.open, 'a key pressed into a field somewhere else is never ours');
  const freedWas = asked.freed;
  const heldWas = asked.held;
  press(GROUP_UI_TUNE.panelKey);
  ok(panel.open && asked.freed === freedWas + 1, 'with a server the key opens the panel and asks for the mouse');
  press('Escape');
  ok(!panel.open && asked.held === heldWas + 1, 'Escape shuts it and gives the mouse back, before the game can open its menu');
  press('Enter');
  ok(chat.open && asked.typing, 'Enter opens the chat line and the game stands its own keys aside');
}

// --- Escape out of the chat line: the pointer asked back, the keys held for the moment after --------------------

{
  const field = inputs[0];
  const fire = field.fire as (type: string, e: unknown) => void;
  const relocksWas = asked.relocks;
  fire('keydown', { code: 'Escape', preventDefault() {}, stopPropagation() {} });
  ok(!chat.open, 'Escape shuts the chat line');
  ok(asked.relocks === relocksWas + 1, 'and asks for the pointer the browser took on that same press');
  ok(asked.typing, "the game's keys are still standing aside, so the lock change that follows opens no menu");
  pass(CHAT_TUNE.escapeHoldMs + 100, 4);
  ok(!asked.typing, 'and a moment later the game has its keys back');
}

// --- the panel standing down when the pointer goes back to the game ----------------------------------------------

{
  press(GROUP_UI_TUNE.panelKey);
  ok(panel.open, 'the panel is open again');
  const heldWas = asked.held;
  setLock(true);
  ok(!panel.open && asked.held === heldWas + 1, 'clicking the world takes the pointer back, and the panel stands down rather than freezing the player');
  setLock(false);
}

// --- and what that rule became when the moods arrived ------------------------------------------------
//
// A mood poses your own body and is saved on your own character, so the line is no longer only for
// saying things to people: it opens with no server as well, and `/mood` is the only way to a mood
// the game has. It opens alone only where there is one to set, which is why the line built at the
// top of this file -- which takes no `mood` hook -- stays shut above and says what it always said.
{
  authority = 'me';
  groups.clear();
  const alone = new ChatUi(makeEl() as never, { groups, say: () => {}, project, anchor: (id, out) => groups.peerAt(id, out), meAt: (out) => groups.meAt(out), canOpen: () => canOpen, typing: () => {}, mood: () => 'you are angry' });
  press('Enter');
  ok(alone.open, 'with a mood to set the line opens alone, because /mood is the only way to one');
  ok(!chat.open, 'and a line with no mood wired is still shut: what changed is the moods, not playing alone');
  alone.close();
  tuneChat({ aloneOpens: false });
  press('Enter');
  ok(!alone.open, 'and the switch puts the old rule straight back');
  tuneChat({ aloneOpens: true });
  authority = 'server';
}

console.log(`\n${checks} checks passed`);
