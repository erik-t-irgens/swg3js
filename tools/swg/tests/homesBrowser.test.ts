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
import { HOME_WORDS, Homes, homeKey, readHomeRow, routeHomeWord, type HomeRow } from '../../../src/net/homes.ts';

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
  // The next placing is held open (`holdNext`), and only it: the ones after it go straight up.
  let holding = false;
  const held: (() => void)[] = [];
  let refuse = false;
  // What the streamer has filed under each key as it stands, and every time a key was filed over a copy already
  // there -- which the real streamer does by overwriting its map, leaving a copy nothing can take down again.
  const filed = new Map<string, { x: number; z: number; yaw: number }>();
  let twice = 0;
  const deps = {
    place: async (model: string, o: { at: { x: number; z: number }; yaw: number; key: string; y: number }) => {
      placed.push({ model, key: o.key, y: o.y, x: o.at.x, z: o.at.z, yaw: o.yaw });
      if (holding) {
        holding = false;
        await new Promise<void>((done) => void held.push(done));
      }
      if (refuse) return { ok: false, why: 'the ground would not take it' };
      if (filed.has(o.key)) twice++;
      filed.set(o.key, { x: o.at.x, z: o.at.z, yaw: o.yaw });
      return { ok: true, why: null };
    },
    unplace: (key: string) => {
      removed.push(key);
      return filed.delete(key);
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
    filed,
    /** How many times a key was filed over a copy already standing under it: always nought. */
    twice: () => twice,
    /** Hold the next placing open until `release` is called. */
    holdNext: () => {
      holding = true;
    },
    /** Let the oldest placing held open land. */
    release: () => {
      holding = false;
      held.shift()?.();
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

// ---------------------------------------------------------------- this machine keeps the player's houses (W6)

{
  // The line was put down, or the far end keeps none: the server's houses come down here and are held, what
  // it says is still kept, and they stand again the moment the server keeps the player's houses again.
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1'), row('h2', { x: 500 })] });
  await settle();
  w.holdNext();
  w.h.word({ t: 'homeUp', home: row('h3', { x: 900 }) });
  await settle();
  w.h.takeDownAll();
  w.release();
  await settle();
  ok(w.h.report().standing === 0 && w.h.report().held, 'taken down, none of the server\'s stands here and they are held');
  ok(w.removed.includes(homeKey('h1')) && w.removed.includes(homeKey('h2')) && w.removed.includes(homeKey('h3')), 'every one comes down, one still going up included');
  w.h.word({ t: 'homeUp', home: row('h4', { x: 1500 }) });
  w.h.ready();
  await settle();
  ok(w.h.report().standing === 0 && w.h.report().rows.length === 4, 'and while held a word is kept and nothing stands, whoever asks');
  const before = w.placed.length;
  w.h.resume(false);
  await settle();
  ok(w.placed.length === before && !w.h.report().held, 'let go of at an arrival, nothing is stood until the world is ready');
  w.h.resume();
  await settle();
  ok(w.h.report().standing === 4, 'and the server keeps them again: every one it said stands');
  w.h.takeDownAll();
  w.h.clear();
  ok(!w.h.report().held, 'and the select screen lets go of the hold with everything else');
}

{
  // Taken down and stood again while one is still going up (a Disconnect and a Connect inside one model load):
  // the one on its way is the only placing of its key, and it stands as it lands rather than being lost.
  const w = world();
  w.h.enter('tatooine:');
  w.holdNext();
  w.h.word({ t: 'homeUp', home: row('h1') });
  await settle();
  w.h.takeDownAll();
  w.h.resume();
  await settle();
  ok(w.placed.length === 1, 'held and resumed while one is going up places nothing a second time');
  w.release();
  await settle();
  ok(w.h.report().standing === 1 && !w.removed.includes(homeKey('h1')), 'and the one on its way stands as it lands, since the server keeps them again');
}

{
  // A world come back to while a house is still going up into the one that went: the new world's own house under
  // the same key is never taken down by the old one landing.
  const w = world();
  w.h.enter('tatooine:');
  w.holdNext();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  w.h.enter('tatooine:');
  // The old placing is held; the new world's goes straight up.
  w.h.ready();
  await settle();
  ok(w.placed.length === 2 && w.h.report().standing === 1, "the world arriving again stands its own while the old one is still on its way");
  w.release();
  await settle();
  ok(w.h.report().standing === 1 && !w.removed.includes(homeKey('h1')), "and the old one landing takes nothing down here, where the new world's house stands under the same key");
}

// ---------------------------------------------------------------- a house moved (W7)

{
  ok((HOME_WORDS as readonly string[]).includes('homeMoved'), 'the words the socket hands over include the move');
  const w = world();
  const routed = ['homes', 'homeUp', 'homeMoved', 'homeDown', 'homeNo'].every((t) => routeHomeWord({ t, rows: [] }, w.h));
  ok(routed && !routeHomeWord({ t: 'props', rows: [] }, w.h) && !routeHomeWord(null, w.h), 'and the one router hands each of them over, and nothing else');
  ok(!readHomeRow({ id: 'h1', model: 'a_house', x: 'ten', y: 0, z: 0, h: 0 }) && !readHomeRow({ id: '', model: 'a_house', x: 1, y: 0, z: 0, h: 0 }) && !!readHomeRow(row('h1')), 'a row off the wire is read, and one that is not one is not');
}

{
  // Somebody else's house moved: the old one down, the new one up, under the one key, once.
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  w.h.word({ t: 'homeMoved', home: row('h1', { x: 300, h: 2 }) });
  await settle();
  ok(w.removed.filter((k) => k === homeKey('h1')).length === 1 && w.placed.length === 2, 'a house moved is taken down where it stood and stood where it went');
  ok(w.filed.size === 1 && w.filed.get(homeKey('h1'))!.x === 300 && w.filed.get(homeKey('h1'))!.yaw === 2 && w.twice() === 0, 'under its one key, filed once, where it stands now');
  ok(w.h.report().standing === 1 && w.h.rows.get('h1')!.x === 300, 'and it is standing, its row where it stands now');
  w.h.word({ t: 'homeMoved', home: row('h1', { x: 300, h: 2 }) });
  await settle();
  ok(w.placed.length === 2 && w.removed.length === 1, 'the same move said again moves nothing');
}

{
  // A move overtaking its own placing: the placing lands, sees the row has moved on, comes down, and hands over to a
  // stand at the new place. One house, filed once, where the server says it is.
  const w = world();
  w.h.enter('tatooine:');
  w.holdNext();
  w.h.word({ t: 'homeUp', home: row('h1') });
  await settle();
  w.h.word({ t: 'homeMoved', home: row('h1', { x: 300 }) });
  await settle();
  ok(w.placed.length === 1, 'a move while the house is still going up starts no second placing of its key');
  w.release();
  await settle();
  await settle();
  ok(w.filed.size === 1 && w.filed.get(homeKey('h1'))!.x === 300 && w.twice() === 0, 'it lands where it was put, comes down, and goes up where it went: one house under its key');
  ok(w.h.report().standing === 1 && w.placed.length === 2, 'standing, placed twice and never at once');
}

{
  // The same house said again while it goes up (a list handed over twice) is not taken for a move.
  const w = world();
  w.h.enter('tatooine:');
  w.holdNext();
  w.h.word({ t: 'homeUp', home: row('h1') });
  await settle();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  w.release();
  await settle();
  await settle();
  ok(w.placed.length === 1 && w.removed.length === 0 && w.h.report().standing === 1, 'the same house said twice while going up goes up once and stays');
}

{
  // The player's own house: picked up, it comes down here alone; put down, it is asked of the server and stays down
  // until the server answers; the answer stands it where it went.
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  w.h.hide('h1');
  ok(w.removed.includes(homeKey('h1')) && w.h.report().standing === 0 && w.h.isHidden('h1'), 'picked up, it comes down here');
  w.h.ready();
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  ok(w.placed.length === 1 && w.h.report().standing === 0, 'and nothing stands it again while it is in hand, not the world ready nor a list');
  w.h.askMove('h1', { x: 250, z: -30 }, 1.25, 16, 6.5);
  const sent = w.sent[w.sent.length - 1];
  ok(sent.t === 'moveHome' && sent.id === 'h1' && sent.x === 250 && sent.z === -30 && sent.h === 1.25 && sent.r === 16 && sent.y === 6.5, 'put down, the move is asked of the server with its new doorstep, heading, circle and height');
  ok(w.placed.length === 1 && w.h.isHidden('h1'), 'and nothing goes up here until the server answers');
  w.h.word({ t: 'homeMoved', home: row('h1', { x: 250, z: -30, h: 1.25, r: 16, y: 6.5 }) });
  await settle();
  ok(w.h.report().standing === 1 && !w.h.isHidden('h1') && w.filed.get(homeKey('h1'))!.x === 250 && w.twice() === 0, 'the answer stands it where it went, once');
}

{
  // A move refused names its house, which stands again where it stood; a refusal naming nothing puts nothing back.
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  w.h.hide('h1');
  w.h.askMove('h1', { x: 900, z: 0 }, 0, 12, 4);
  w.h.word({ t: 'homeNo', why: 'something is already standing there' });
  await settle();
  ok(w.h.report().standing === 0 && w.h.isHidden('h1'), 'a refusal naming no house leaves the move still asked');
  w.h.word({ t: 'homeNo', why: 'something is already standing there', id: 'h1' });
  await settle();
  ok(w.h.report().standing === 1 && w.filed.get(homeKey('h1'))!.x === 10 && !w.h.isHidden('h1'), 'one naming it stands it again where it stood');
  ok(w.said.some((s) => s.includes('already standing')), "and the server's words are said");
}

{
  // Escape and a travel: shown again stands it where it stood; let go of with nothing asked waits for the next stand.
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1'), row('h2', { x: 500 })] });
  await settle();
  w.h.hide('h1');
  w.h.show('h1');
  await settle();
  ok(w.h.report().standing === 2 && w.filed.get(homeKey('h1'))!.x === 10 && w.twice() === 0, 'put back, it stands where it stood');
  w.h.hide('h2');
  w.h.unhide('h2');
  await settle();
  ok(w.h.report().standing === 1 && !w.h.isHidden('h2'), 'let go of with nothing asked, it is not stood now');
  w.h.ready();
  await settle();
  ok(w.h.report().standing === 2, 'but with the rest the next time they are stood');
}

{
  // Moved by somebody else (the admin) while it is in its owner's hand: kept, not stood, and put back where it is now.
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  w.h.hide('h1');
  w.h.word({ t: 'homeMoved', home: row('h1', { x: 77 }) });
  await settle();
  ok(w.h.report().standing === 0 && w.h.rows.get('h1')!.x === 77, 'a move while it is in hand is kept and stands nothing');
  w.h.show('h1');
  await settle();
  ok(w.filed.get(homeKey('h1'))!.x === 77 && w.h.report().standing === 1, 'and put back, it stands where the server says it is');
}

{
  // A line that dropped with a move asked: the list handed over again has its answer, and stands it there.
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1')] });
  await settle();
  w.h.hide('h1');
  w.h.askMove('h1', { x: 60, z: 0 }, 0, 12, 4);
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1', { x: 60 })] });
  await settle();
  ok(w.h.report().standing === 1 && !w.h.isHidden('h1') && w.filed.get(homeKey('h1'))!.x === 60, 'a list after a dropped line answers a move still asked');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1', { x: 61 })] });
  await settle();
  ok(w.filed.get(homeKey('h1'))!.x === 61 && w.filed.size === 1 && w.twice() === 0, 'and a house the list has somewhere else is moved there, once');
}

{
  // Picked up while it is still going up: it lands, comes straight back down, and nothing of it stands.
  const w = world();
  w.h.enter('tatooine:');
  w.holdNext();
  w.h.word({ t: 'homeUp', home: row('h1') });
  await settle();
  w.h.hide('h1');
  w.release();
  await settle();
  ok(w.h.report().standing === 0 && w.filed.size === 0, 'a house picked up while it goes up comes back down as it lands');
  w.h.show('h1');
  await settle();
  ok(w.h.report().standing === 1 && w.filed.size === 1, 'and put back, it stands');
}

{
  // A change of keeper takes the server's houses down and holds them: one in hand stays down when they stand again.
  const w = world();
  w.h.enter('tatooine:');
  w.h.word({ t: 'homes', world: 'tatooine', rows: [row('h1'), row('h2', { x: 500 })] });
  await settle();
  w.h.hide('h1');
  w.h.takeDownAll();
  w.h.resume();
  await settle();
  ok(w.h.report().standing === 1 && w.h.isHidden('h1'), 'the houses stood again leave the one in hand down');
  w.h.enter('tatooine:');
  ok(!w.h.isHidden('h1'), 'and an arrival lets go of it, as a thing in hand is let go of before the world goes');
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
