// The browser's half of the buildings players put down: what it stands, what it does not stand
// twice, and what happens to a house that is taken down while it is still going up.
//
// The placing itself is asynchronous -- a model has to load and its programs have to be built -- and
// everything that can go wrong here goes wrong in that gap: the list arriving again while the first
// one is still in flight, a `homeDown` overtaking its own `homeUp`, a world leaving underneath it.
// So the world this hands the real `Homes` is one whose `place` can be held open on purpose.
//
// Run: node tools/swg/tests/homesBrowser.test.ts

import assert from 'node:assert/strict';
import { Homes, homeKey, type HomeRow } from '../../../src/net/homes.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const row = (id: string, over: Partial<HomeRow> = {}): HomeRow => ({ id, owner: 'c1', model: 'a_house', x: 10, y: 4, z: -20, h: 0.5, r: 12, at: 1, ...over });

/** A world that records what it was asked to do, and can hold a placing open. */
function world() {
  const placed: { model: string; key: string; y: number; x: number; z: number; yaw: number }[] = [];
  const removed: string[] = [];
  const said: string[] = [];
  const sent: Record<string, unknown>[] = [];
  let hold: (() => void) | null = null;
  let refuse = false;
  const deps = {
    place: async (model: string, o: { at: { x: number; z: number }; yaw: number; key: string; y: number }) => {
      placed.push({ model, key: o.key, y: o.y, x: o.at.x, z: o.at.z, yaw: o.yaw });
      if (hold) await new Promise<void>((done) => (hold = done));
      return refuse ? { ok: false, why: 'the ground would not take it' } : { ok: true, why: null };
    },
    unplace: (key: string) => {
      removed.push(key);
      return true;
    },
    say: (text: string) => said.push(text),
    send: (msg: Record<string, unknown>) => sent.push(msg),
  };
  const h = new Homes();
  h.attach(deps);
  return {
    h,
    placed,
    removed,
    said,
    sent,
    /** Hold the next placing open until `release` is called. */
    holdNext: () => {
      hold = () => {};
    },
    release: () => {
      const f = hold;
      hold = null;
      if (typeof f === 'function') f();
    },
    refuseNext: () => (refuse = true),
    allowNext: () => (refuse = false),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- standing them up

{
  const w = world();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1'), row('h2', { x: 500 })] });
  await settle();
  ok(w.placed.length === 2, 'the list a browser is handed on arriving is stood up');
  ok(w.placed[0].key === homeKey('h1'), 'each one under the id the server gave it');
  ok(w.placed[0].y === 4, "and at the server's own height, not one measured again here");
  ok(w.placed[0].yaw === 0.5 && w.placed[0].x === 10, 'and at its own place and turn');
  ok(w.h.report().standing === 2, 'and both are standing');
}

{
  const w = world();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  ok(w.placed.length === 1, 'a list arriving twice does not build the same house twice');
  w.h.word({ t: 'homeUp', home: row('h1') });
  await settle();
  ok(w.placed.length === 1, 'and neither does a homeUp for one already standing');
}

{
  // The race the whole of this is written for: the list arrives twice with the first placing still
  // in flight, which is exactly what a slow model load on a busy world looks like.
  const w = world();
  w.holdNext();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  ok(w.placed.length === 1, 'a house still going up is not started again');
  w.release();
  await settle();
  ok(w.h.report().standing === 1, 'and it is standing once it lands');
}

{
  const w = world();
  w.refuseNext();
  w.h.word({ t: 'homeUp', home: row('h1') });
  await settle();
  ok(w.h.report().standing === 0, 'a house the world would not stand is not counted as standing');
  w.h.word({ t: 'homeUp', home: row('h1') });
  await settle();
  ok(w.placed.length === 2, 'and the next word about it tries again rather than being swallowed');
}

{
  // The ordering this whole retry exists for: the browser says hello with its new planet **before**
  // the pack has loaded, so the server's list arrives at a world with no streamer in it and every
  // house is refused for having nowhere to go. Thrown away there, they would never come back.
  const w = world();
  w.refuseNext();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1'), row('h2', { x: 500 })] });
  await settle();
  ok(w.h.report().standing === 0, 'a list arriving before the world is loaded stands nothing');
  ok(w.h.report().rows.length === 2, 'but is kept, because it is what the server says is built there');
  w.allowNext();
  w.h.ready();
  await settle();
  ok(w.h.report().standing === 2, 'and the moment the world is ready they all go up');
  w.h.ready();
  await settle();
  ok(w.placed.length === 4, 'and asking again once they are standing builds nothing more');
}

// ---------------------------------------------------------------- taking them down

{
  const w = world();
  w.h.word({ t: 'homeUp', home: row('h1') });
  await settle();
  w.h.word({ t: 'homeDown', id: 'h1' });
  ok(w.removed.length === 1 && w.removed[0] === homeKey('h1'), 'one coming down is taken out of the world');
  ok(w.h.report().standing === 0, 'and is no longer standing');
  w.h.word({ t: 'homeDown', id: 'h1' });
  ok(w.removed.length === 1, 'and a second word about it does nothing at all');
}

{
  // A removal overtaking its own placing. Without the forget-first this leaves a house standing
  // with nothing left naming it, which nothing afterwards could ever take down.
  const w = world();
  w.holdNext();
  w.h.word({ t: 'homeUp', home: row('h1') });
  await settle();
  w.h.word({ t: 'homeDown', id: 'h1' });
  w.release();
  await settle();
  ok(w.h.report().standing === 0, 'a house taken down while it was going up does not end up standing');
  ok(w.removed.includes(homeKey('h1')), 'and is taken out of the world by the placing itself');
}

{
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1'), row('h2', { x: 500 })] });
  await settle();
  w.h.enter('naboo:');
  ok(w.h.report().standing === 0 && w.h.report().rows.length === 0, 'going to another world forgets every building on the one left behind');
  w.h.word({ t: 'homes', world: 'naboo', rows: [row('h1')] });
  await settle();
  ok(w.placed.length === 3, 'so the same id on the next world is stood up rather than skipped');
}

{
  // The one the server cannot help with: it sends the list only when a browser changes world, so
  // arriving back where you already were -- a respawn, a reload -- must not throw the list away.
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1'), row('h2', { x: 500 })] });
  await settle();
  ok(w.h.report().standing === 2, 'two houses are standing');
  w.h.enter('tatooine:');
  ok(w.h.report().standing === 0, 'a world reloading takes them down with it');
  ok(w.h.report().rows.length === 2, 'but what the server said is built there is kept, because it will not be said again');
  w.h.ready();
  await settle();
  ok(w.h.report().standing === 2, 'and they go back up when the world is ready');
  ok(w.placed.length === 4, 'each one built again, since the world it was built in is gone');
}

{
  // A world torn down and rebuilt while a house is still going up. The rows survive a reload into
  // the same world, so "is it still wanted" cannot answer this -- and if it were allowed to count
  // as standing, it would have been put into a world that no longer exists and nothing would ever
  // look at it again.
  const w = world();
  w.h.enter('tatooine:');
  w.holdNext();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  w.h.enter('tatooine:');
  w.release();
  await settle();
  ok(w.h.report().standing === 0, 'a house that landed in a world that has since gone is not standing');
  ok(w.removed.includes(homeKey('h1')), 'and is taken out of wherever it landed');
  w.h.ready();
  await settle();
  ok(w.h.report().standing === 1, 'and the next time the world is ready it goes up properly');
}

{
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  w.h.clear();
  ok(w.h.report().rows.length === 0, 'leaving for the select screen forgets everything, whatever world it was');
  w.h.enter('tatooine:');
  w.h.ready();
  await settle();
  ok(w.placed.length === 1, 'and coming back to the same world builds nothing until the server says so again');
}

// ---------------------------------------------------------------- what it says and what it sends

{
  const w = world();
  w.h.word({ t: 'homeNo', why: 'something is already standing there' });
  ok(w.said.length === 1 && w.said[0].includes('already standing'), "the server's refusal is said to the player in its own words");
  ok(w.h.report().refused === 1 && w.h.report().lastWhy.includes('already'), 'and counted, and kept for the console');
}

{
  const w = world();
  w.h.ask('a_house', { x: 3, z: 4 }, 1.25, 20, 7.5);
  ok(w.sent.length === 1 && w.sent[0].t === 'placeHome', 'asking for one sends a word and builds nothing');
  ok(w.placed.length === 0, 'the house goes up when the server answers and never before');
  ok(w.sent[0].y === 7.5 && w.sent[0].r === 20, 'and what goes up is the height and the room the browser measured');
  w.h.askDown('h9');
  ok(w.sent.length === 2 && w.sent[1].t === 'removeHome' && w.sent[1].id === 'h9', 'and taking one down is a word too');
  ok(w.removed.length === 0, 'which also does nothing here until the server answers');
}

{
  const w = world();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1', { x: 100 }), row('h2', { owner: 'c2', x: 0 }), row('h3', { x: 10 })] });
  await settle();
  const mine = w.h.mine('c1', { x: 0, z: 0 }).map((r) => r.id);
  ok(mine.length === 2 && !mine.includes('h2'), "only what this character owns is theirs to take down");
  ok(mine[0] === 'h3', 'and the nearest is first, which is what a bare removal takes');
}

{
  const w = world();
  w.h.word({ t: 'homes', world: 'tatooine', rows: 'not a list' as unknown as HomeRow[] });
  w.h.word({ t: 'homeUp' });
  w.h.word({ t: 'homeDown', id: '' });
  await settle();
  ok(w.placed.length === 0 && w.removed.length === 0, 'a word with nothing in it builds nothing and breaks nothing');
}

console.log(`\n${passed} checks passed`);
