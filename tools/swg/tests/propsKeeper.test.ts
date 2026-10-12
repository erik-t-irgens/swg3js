// Who keeps a player's own things, and the browser's half of the props a server keeps.
//
// `keeperOf` is one pure function and the whole of the rule, so every case of it is here: a server that
// keeps them, a line that merely dropped, an arrival waiting to hear, the wait running out, the relay that
// came before, a line put down on purpose, a line that comes back to a far end that keeps nothing. So are the
// other decisions the game only calls (`keeperState`, `arrivalKeeper`, `switchSets`, `arrivalCircles`,
// `keptRefusal`, `keeperNews`), run by behaviour, and the asking measured to make nothing. Then `KeptProps`,
// the server's rows stood in this browser, against a world whose stand can be held open on purpose, since
// everything that can go wrong goes wrong in that gap; then this machine's own store taken down and stood
// again as the keeper changes, a change landing while a stand is on its way included; and last the wiring in
// `main.ts`, read out of the source: that the game calls those decisions, and calls them with what it should.
//
// Run: node --expose-gc tools/swg/tests/propsKeeper.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { constants as perfConstants, PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import { KEEPER_PENDING, KeptProps, PROPS_KEEPER_TUNE, SERVER_NOT_ANSWERING, arrivalCircles, arrivalHolds, arrivalKeeper, keeperNews, keeperOf, keeperState, keptDepsOf, keptKey, keptRefusal, keptThing, readKept, routePropWord, switchSets, type Keeper, type KeeperState, type KeptRow, type KeptSets } from '../../../src/net/propsKept.ts';
import { PlacedProps, type PlacedProp } from '../../../src/world/propsPlaced.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ---------------------------------------------------------------- who keeps them

{
  const s = (o: Partial<KeeperState> = {}): KeeperState => ({ serverHolds: false, wanted: false, answering: false, sinceArrivalMs: 0, ...o });
  const wait = PROPS_KEEPER_TUNE.waitMs;
  ok(keeperOf('pending', s({ serverHolds: true })) === 'server' && keeperOf('local', s({ serverHolds: true, wanted: true, answering: true })) === 'server', 'a server that took the claim and keeps them keeps them, whoever kept them before');
  ok(keeperOf('local', s()) === 'local' && keeperOf('pending', s()) === 'local', 'with no line wanted at all, this machine keeps them');
  ok(keeperOf('server', s({ wanted: true })) === 'server', 'a line that merely dropped and is wanted back leaves them the server\'s: they go on standing');
  ok(keeperOf('server', s({ wanted: true, sinceArrivalMs: wait * 10 })) === 'server', 'however long it takes to come back');
  ok(keeperOf('server', s({ wanted: true, answering: true })) === 'local', 'but a line that comes back to a far end that answers and keeps none of them (an older relay or server) gives them to this machine');
  ok(keeperOf('server', s({ wanted: false })) === 'local', 'a line put down on purpose (or the character taken over, or turned away) gives them to this machine');
  ok(keeperOf('pending', s({ wanted: true })) === 'pending', 'an arrival with an address wanted and nothing answering yet waits to hear');
  ok(keeperOf('pending', s({ wanted: true, sinceArrivalMs: wait - 1 })) === 'pending' && keeperOf('pending', s({ wanted: true, sinceArrivalMs: wait })) === 'local', `for ${wait} ms, and then this machine keeps them`);
  ok(keeperOf('pending', s({ wanted: true, answering: true })) === 'local', 'the relay that came before, or a server that keeps no props, answers at once: this machine');
  ok(keeperOf('local', s({ wanted: true })) === 'local', 'a connect asked for in the middle of a world never takes this machine\'s things down to wait: only an arrival waits');
  ok(keeperOf('pending', s({ wanted: true }), { waitMs: 0 }) === 'local', 'and the wait is the tune\'s, live');
  // Asked a few times a second from the frame: the state is the caller's, written in place, and the answer a constant.
  const kept = s({ wanted: true });
  const before = JSON.stringify(kept);
  for (let i = 0; i < 1000; i++) keeperOf('pending', kept);
  ok(JSON.stringify(kept) === before, 'asking changes nothing it is asked with');
}

// ---------------------------------------------------------------- what the keepers are asked with, and what a change does

{
  const out: KeeperState = { serverHolds: true, wanted: true, answering: true, sinceArrivalMs: 99 };
  const line = (authority: string, mode: string, propsVersion = 0) => ({ authority, mode, propsVersion });
  const ask = (l: ReturnType<typeof line>, props: boolean, wanted: boolean, toCome: boolean, since: number) => ({ ...keeperState(out, l, props, wanted, toCome, since) });
  ok(keeperState(out, line('me', 'off'), true, false, false, 5) === out, 'the state is written into the one it is handed, and that one handed back');
  ok(JSON.stringify(ask(line('server', 'server', 1), true, true, false, 5)) === JSON.stringify({ serverHolds: true, wanted: true, answering: true, sinceArrivalMs: 5 }), 'a server holding the claim whose hail says props keeps props');
  ok(!ask(line('server', 'server', 0), true, true, false, 5).serverHolds && ask(line('server', 'server', 0), false, true, false, 5).serverHolds, 'one whose hail says nothing of props keeps the houses and not the props');
  ok(!ask(line('me', 'server', 1), true, true, false, 5).serverHolds && !ask(line('me', 'server', 1), true, true, false, 5).answering, 'a hail heard and the claim not yet answered holds nothing and has not answered');
  ok(!ask(line('me', 'waiting'), true, true, false, 5).answering && !ask(line('me', 'off'), true, true, false, 5).answering, 'a line opening, or dropped, has not answered');
  ok(ask(line('me', 'relay'), true, true, false, 5).answering && !ask(line('me', 'relay'), true, true, false, 5).serverHolds, 'the relay that came before has answered, and holds nothing');
  ok(ask(line('me', 'off'), true, false, true, 3000).wanted && ask(line('me', 'off'), true, false, true, 3000).sinceArrivalMs === 0, "a session's first world with a server saved wants a line, and has waited no time until its connect is made");
  ok(ask(line('me', 'waiting'), true, true, false, 3000).sinceArrivalMs === 3000 && !ask(line('me', 'off'), true, false, false, 3000).wanted, 'otherwise the wait is the time since the arrival, and a line put down is not wanted');
  // The whole of it, as the frame asks it: a line dropped and coming back.
  const prev = (k: Keeper, l: ReturnType<typeof line>, props: boolean, wanted: boolean) => keeperOf(k, keeperState(out, l, props, wanted, false, 100));
  ok(prev('server', line('me', 'waiting'), true, true) === 'server' && prev('server', line('me', 'server', 1), true, true) === 'server' && prev('server', line('server', 'server', 1), true, true) === 'server', 'a drop and the same server answering again keeps them the server\'s the whole way');
  ok(prev('server', line('server', 'server', 0), true, true) === 'local' && prev('server', line('server', 'server', 0), false, true) === 'server', 'coming back to a server that keeps houses and not props: the props are this machine\'s, the houses still the server\'s');
  ok(prev('server', line('me', 'relay'), true, true) === 'local' && prev('server', line('me', 'relay'), false, true) === 'local', 'coming back to the relay that came before: both are this machine\'s');
  ok(prev('server', line('me', 'off'), true, false) === 'local', 'and the line put down: this machine\'s');
  ok(arrivalKeeper('server', keeperState(out, line('me', 'waiting'), true, true, false, 0)) === 'server', 'an arrival over a dropped line the server kept them on keeps them the server\'s');
  ok(arrivalKeeper('local', keeperState(out, line('me', 'off'), true, false, true, 0)) === 'pending', 'an arrival with a server saved and nothing answering yet waits to hear, whoever kept them before');
  ok(arrivalKeeper('local', keeperState(out, line('me', 'off'), true, false, false, 0)) === 'local' && arrivalKeeper('pending', keeperState(out, line('server', 'server', 1), true, true, false, 0)) === 'server', 'with none wanted it is this machine at once, and a server holding the claim at once');
}

{
  // A change of keeper: which set comes down and which goes up, in that order.
  const calls: string[] = [];
  const sets: KeptSets = { downServer: () => void calls.push('downServer'), downLocal: () => void calls.push('downLocal'), upServer: () => void calls.push('upServer'), upLocal: () => void calls.push('upLocal') };
  const run = (to: Keeper) => {
    calls.length = 0;
    switchSets(to, sets);
    return calls.join();
  };
  ok(run('server') === 'downLocal,upServer', "to the server: this machine's come down, then the server's go up, and nothing of the server's is taken down");
  ok(run('local') === 'downServer,upLocal', "to this machine: the server's come down, then this machine's go up");
  ok(run('pending') === 'downServer,downLocal', 'and to not known, which a change never is: neither stands');
  ok(arrivalHolds('local') && !arrivalHolds('server') && !arrivalHolds('pending'), "an arrival holds the server's houses down only once this machine is known to keep them");
  const circles = [{ x: 1, z: 2, r: 14 }];
  ok(arrivalCircles('local', circles) === circles && arrivalCircles('server', circles).length === 0 && arrivalCircles('pending', circles).length === 0, "this machine's houses keep plants off their ground at an arrival only while it is known to keep them, never while it waits to hear");
  ok(keptRefusal('pending', 'server') === KEEPER_PENDING && keptRefusal('server', 'me') === SERVER_NOT_ANSWERING && keptRefusal('server', 'server') === null && keptRefusal('local', 'me') === null, 'a change is refused while nobody knows who keeps them, or while the server that keeps them is not answering, and never otherwise');
  ok(keeperNews('pending', 'server', 'pending', 'server').length === 0, "an arrival's own answer says nothing");
  ok(keeperNews('server', 'local', 'server', 'local').join() === "no server keeps your props and houses now: what this machine keeps stands instead", 'a line put down says so once, for both');
  ok(keeperNews('local', 'server', 'server', 'server').join() === 'a server keeps your props here now: what this machine keeps waits for a game with no server', 'and a server taking the props over says so for the props alone');
}

// ---------------------------------------------------------------- the server's rows, stood here

const row = (id: string, over: Partial<KeptRow> = {}): KeptRow => ({ id, owner: 'c1', prop: 'chair_s01', x: 10, y: 4, z: -20, q: [0, 0, 0, 1], at: 1, ...over });

/** A world that records what it was asked to do, and can hold a stand open. */
function world() {
  const stood: PlacedProp[] = [];
  const cleared: string[] = [];
  const said: string[] = [];
  const sent: Record<string, unknown>[] = [];
  const holds: (() => void)[] = [];
  let holding = false;
  let refuse = false;
  const k = new KeptProps();
  k.attach({
    stand: async (r) => {
      stood.push(r);
      if (holding) await new Promise<void>((done) => holds.push(done));
      return !refuse;
    },
    clear: (thing) => void cleared.push(thing),
    say: (t) => void said.push(t),
    send: (m) => void sent.push(m),
  });
  return {
    k,
    stood,
    cleared,
    said,
    sent,
    hold: () => (holding = true),
    release: () => {
      holding = false;
      for (const f of holds.splice(0)) f();
    },
    /** Let the `i`th stand held so far land, and no other. */
    releaseAt: (i: number) => {
      const f = holds[i];
      holds[i] = () => undefined;
      f?.();
    },
    refuse: (on: boolean) => (refuse = on),
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

{
  ok(readKept(row('p1')) !== null && readKept({ ...row('p1'), q: [0, 0, 1] }) === null && readKept({ ...row('p1'), x: 'far' }) === null && readKept(null) === null, 'a row off the wire is checked, and one that is not a row is nothing');
  ok(keptThing('p7') === 's:p7' && keptKey('p7') === 'prop:s:p7', "a server's row is stood under the server's own id, a name nothing this browser mints can be");
}

{
  const w = world();
  w.k.enter('tatooine');
  w.k.word({ t: 'props', world: 'tatooine', rows: [row('p1'), row('p2', { x: 50 })] });
  await settle();
  ok(w.stood.length === 0 && w.k.rows.size === 2, 'a list that arrives while the world is still loading is kept, and nothing is stood');
  w.k.ready();
  await settle();
  ok(w.stood.length === 2 && w.k.report().standing === 2, 'and both stand once the world is in');
  ok(w.stood[0].thing === 's:p1' && w.stood[0].id === 'chair_s01' && w.stood[0].y === 4, 'each through the stand this machine\'s own use, under the server\'s id, at the server\'s height');
  w.k.word({ t: 'props', world: 'tatooine', rows: [row('p1'), row('p2', { x: 50 })] });
  await settle();
  ok(w.stood.length === 2 && w.cleared.length === 0, 'the same list again (a line come back) stands nothing twice and takes nothing down');
  w.k.word({ t: 'props', world: 'tatooine', rows: [row('p2', { x: 50 })] });
  await settle();
  ok(w.cleared.includes('s:p1') && !w.k.rows.has('p1'), 'a list that no longer names one: it was taken away while this browser was not listening, and it goes');
  w.k.word({ t: 'propMoved', prop: row('p2', { x: 60 }) });
  await settle();
  ok(w.cleared.includes('s:p2') && w.stood[w.stood.length - 1].x === 60 && w.k.report().standing === 1, 'one moved comes down where it was and up where it is, under the same key');
  w.k.word({ t: 'propDown', id: 'p2' });
  ok(w.k.report().standing === 0 && !w.k.rows.has('p2'), 'one taken away goes');
}

{
  // A move overtaking the stand still going up: one prop, standing once, at its new place.
  const w = world();
  w.k.enter('naboo');
  w.k.ready();
  w.hold();
  w.k.word({ t: 'propUp', prop: row('p9') });
  w.k.word({ t: 'propMoved', prop: row('p9', { x: 99 }) });
  w.release();
  await settle();
  await settle();
  ok(w.k.isStanding('p9') && w.stood[w.stood.length - 1].x === 99 && w.cleared.includes('s:p9'), 'a move that overtakes its own stand leaves one prop, standing at its new place');
  // And a removal overtaking a stand: nothing left standing.
  w.hold();
  w.k.word({ t: 'propUp', prop: row('p10') });
  w.k.word({ t: 'propDown', id: 'p10' });
  w.release();
  await settle();
  ok(!w.k.isStanding('p10') && w.cleared.includes('s:p10'), 'a removal that overtakes its own stand takes what went up straight back down');
}

{
  // The player's own, in hand: down here only, until the server says where it went.
  const w = world();
  w.k.enter('tatooine');
  w.k.ready();
  w.k.word({ t: 'props', world: 'tatooine', rows: [row('p1'), row('p2', { owner: 'c2', x: 11 })] });
  await settle();
  ok(w.k.mineNearest('c1', { x: 10, y: 4, z: -20 }, 6)?.id === 'p1' && w.k.mineNearest('c2', { x: 10, y: 4, z: -20 }, 6)?.id === 'p2', "the pick-up key finds a player's own and only their own");
  ok(w.k.mineNearest('c3', { x: 10, y: 4, z: -20 }, 6) === null && w.k.mineNearest('', { x: 10, y: 4, z: -20 }, 6) === null, 'and somebody with none, or nobody at all, finds nothing');
  w.k.hide('p1');
  ok(w.cleared.includes('s:p1') && !w.k.isStanding('p1') && w.k.rows.has('p1'), 'taken in hand it comes down here, and the row is still the server\'s');
  ok(w.k.mineNearest('c1', { x: 10, y: 4, z: -20 }, 6) === null, 'and is not to hand a second time');
  w.k.word({ t: 'props', world: 'tatooine', rows: [row('p1'), row('p2', { owner: 'c2', x: 11 })] });
  await settle();
  ok(!w.k.isStanding('p1'), 'a list arriving while it is in hand does not stand it under the hand');
  w.k.askMove('p1', { x: 30, y: 4, z: -20 }, [0, 0, 0, 1], true);
  ok(w.sent[w.sent.length - 1].t === 'moveProp' && w.sent[w.sent.length - 1].inside === true && !w.k.isStanding('p1'), 'put down, the move is asked of the server and nothing moves here before it answers');
  w.k.word({ t: 'propMoved', prop: row('p1', { x: 30, inside: true }) });
  await settle();
  ok(w.k.isStanding('p1') && w.stood[w.stood.length - 1].x === 30 && w.stood[w.stood.length - 1].inside === true, 'and when it answers it stands at its new place');
  // Refused: it stands again where it stood.
  w.k.hide('p1');
  w.k.askMove('p1', { x: 70, y: 4, z: -20 }, [0, 0, 0, 1], false);
  w.k.word({ t: 'propNo', why: 'that is not yours to move', id: 'p1' });
  await settle();
  ok(w.k.isStanding('p1') && w.stood[w.stood.length - 1].x === 30 && w.said.includes('that is not yours to move'), "refused, it stands again where the server has it, and the server's words are said");
  // Put back: shown again where it stood.
  w.k.hide('p1');
  w.k.show('p1');
  await settle();
  ok(w.k.isStanding('p1'), 'put back, it stands again where it stood');
  // Put away: asked, and gone when the server says so.
  w.k.hide('p1');
  w.k.askDown('p1');
  ok(w.sent[w.sent.length - 1].t === 'removeProp' && !w.k.isStanding('p1'), 'put away, its removal is asked of the server');
  w.k.word({ t: 'propDown', id: 'p1' });
  ok(!w.k.rows.has('p1') && w.k.hiddenIds().length === 0, 'and it is gone when the server answers');
  w.k.ask('chair_s01', { x: 1, y: 2, z: 3 }, [0, 0, 0, 1], false);
  ok(w.sent[w.sent.length - 1].t === 'placeProp' && w.sent[w.sent.length - 1].prop === 'chair_s01' && !('inside' in w.sent[w.sent.length - 1]), 'a new one is asked of the server with its catalogue id, its place and its turn');
}

{
  // This machine keeps them now: everything the server keeps comes down and is held, and its words are still kept.
  const w = world();
  w.k.enter('tatooine');
  w.k.ready();
  w.k.word({ t: 'props', world: 'tatooine', rows: [row('p1'), row('p2', { x: 50 })] });
  await settle();
  w.hold();
  w.k.word({ t: 'propUp', prop: row('p3', { x: 90 }) });
  w.k.takeDownAll();
  w.release();
  await settle();
  ok(w.k.report().standing === 0 && w.cleared.includes('s:p1') && w.cleared.includes('s:p2') && w.cleared.includes('s:p3'), 'taken down, every one comes down, one still going up included');
  w.k.word({ t: 'propUp', prop: row('p4', { x: 120 }) });
  await settle();
  ok(w.k.isHeld && w.k.rows.has('p4') && !w.k.isStanding('p4'), 'and while held, what the server says is kept and nothing stands');
  w.k.ready();
  await settle();
  ok(w.k.report().standing === 4, 'the server keeps them again: everything it said stands');
  // A respawn into the same world keeps the rows; a new world forgets them.
  w.k.enter('tatooine');
  ok(w.k.rows.size === 4 && w.k.report().standing === 0 && w.k.isHeld, 'an arrival back on the same world keeps the rows to stand again, and stands nothing until the world is in');
  w.k.enter('naboo');
  ok(w.k.rows.size === 0, 'a new world forgets the last one\'s');
}

{
  // Taken down and stood again while one is still going up (a Disconnect and a Connect inside one model load):
  // the one on its way is the only stand, and it stands as it lands.
  const w = world();
  w.k.enter('tatooine');
  w.k.ready();
  w.hold();
  w.k.word({ t: 'propUp', prop: row('p1') });
  await settle();
  w.k.takeDownAll();
  w.k.ready();
  await settle();
  ok(w.stood.length === 1, 'taken down and stood again while one is still going up starts no second stand under its key');
  w.release();
  await settle();
  ok(w.k.isStanding('p1') && w.cleared.length === 0, 'and the one on its way stands as it lands, since the rows want it again: neither filed twice nor lost');
}

{
  // An arrival while one is still going up, back to the same world: the new world's own stand of the same row is
  // never taken down by the old one landing, in whichever order the two land.
  for (const order of ['old first', 'new first']) {
    const w = world();
    w.k.enter('tatooine');
    w.k.ready();
    w.hold();
    w.k.word({ t: 'propUp', prop: row('p1') });
    await settle();
    w.k.enter('tatooine');
    w.k.ready();
    await settle();
    ok(w.stood.length === 2, `(${order}) the world arriving again stands its own, the old one still on its way into the world that went`);
    for (const i of order === 'old first' ? [0, 1] : [1, 0]) {
      w.releaseAt(i);
      await settle();
    }
    w.release();
    await settle();
    ok(w.k.isStanding('p1') && !w.cleared.includes('s:p1'), `(${order}) the old one landing takes nothing down here, where the new world's copy stands under the same key`);
  }
}

{
  // A refusal names the row a move or a removal was about, and only that one stands again.
  const w = world();
  w.k.enter('tatooine');
  w.k.ready();
  w.k.word({ t: 'props', world: 'tatooine', rows: [row('p1'), row('p2', { x: 50 })] });
  await settle();
  w.k.hide('p1');
  w.k.askMove('p1', { x: 30, y: 4, z: -20 }, [0, 0, 0, 1], false);
  w.k.askDown('p2');
  w.k.word({ t: 'propNo', why: 'that was more than the server takes in a second: wait a moment and try again', id: 'p2' });
  await settle();
  ok(w.k.isStanding('p2') && !w.k.isStanding('p1') && w.k.hiddenIds().join() === 'p1', 'a refusal naming its row stands that one again, and leaves the other still being asked about');
  w.k.word({ t: 'propNo', why: 'the server could not read that' });
  await settle();
  ok(!w.k.isStanding('p1') && w.k.hiddenIds().join() === 'p1' && w.said.includes('the server could not read that'), 'one naming no row is about a new prop: nothing stood here is put back, and the words are said');
}

{
  // The socket's words go to the kept props through the one router the game uses, and nothing else does.
  const w = world();
  w.k.enter('tatooine');
  w.k.ready();
  ok(routePropWord({ t: 'propUp', prop: row('p5') }, w.k) && w.k.rows.has('p5'), 'a prop word is handed to the kept props');
  ok(!routePropWord({ t: 'homeUp', home: {} }, w.k) && !routePropWord(null, w.k) && !routePropWord({ t: 'purse' }, w.k), 'and no other word is, nor nothing at all');
  const sent: Record<string, unknown>[] = [];
  const standings: string[] = [];
  const k = new KeptProps();
  k.attach(keptDepsOf(() => ({ stand: async (r: PlacedProp) => (standings.push(r.thing), true), clear: () => undefined }), () => undefined, { sendWord: (m) => void sent.push(m) }));
  k.enter('naboo');
  k.ready();
  k.ask('chair_s01', { x: 1, y: 2, z: 3 }, [0, 0, 0, 1], false);
  k.word({ t: 'propUp', prop: row('p6') });
  await settle();
  ok(sent.length === 1 && sent[0].t === 'placeProp' && standings.join() === 's:p6', "the game's own wiring sends through the socket and stands through this machine's own stand");
}

// ---------------------------------------------------------------- this machine's own, taken down and stood again

{
  const stood: string[] = [];
  const cleared: string[] = [];
  const deps = { stand: async (r: PlacedProp) => (stood.push(r.thing), true), clear: (t: string) => void cleared.push(t) };
  const rows = [
    { thing: 'a', id: 'chair_s01', x: 0, y: 0, z: 0, q: [0, 0, 0, 1] },
    { thing: 'b', id: 'chair_s01', x: 1, y: 0, z: 0, q: [0, 0, 0, 1] },
  ];
  const store = { get: () => JSON.stringify(rows) };
  const p = new PlacedProps();
  await p.enter('tatooine', store, deps, false);
  ok(p.all.length === 2 && p.standing === 0 && stood.length === 0 && !p.standingHere, 'with a server keeping the player\'s props, this machine\'s are read and nothing stands');
  const saves: number[] = [];
  const save = () => void saves.push(1);
  ok((await p.put('chair_s01', { x: 5, y: 0, z: 0 }, [0, 0, 0, 1], false, deps, save)) === null && saves.length === 0, 'and nothing new can be put down into this machine\'s keeping meanwhile');
  await p.standAll(deps);
  ok(p.standing === 2 && stood.join() === 'a,b' && p.standingHere, 'the keeper becomes this machine: every row stands');
  await p.standAll(deps);
  ok(stood.length === 2, 'and standing them again stands nothing twice');
  p.takeDownAll(deps);
  ok(p.standing === 0 && cleared.join() === 'a,b' && p.all.length === 2, 'a server takes them over: every one comes down, and every one is kept');
  // A stand still loading when everything is taken down lands nowhere.
  let land: (v: boolean) => void = () => undefined;
  const slow = { stand: () => new Promise<boolean>((r) => (land = r)), clear: (t: string) => void cleared.push(t) };
  const going = p.standAll(slow);
  p.takeDownAll(deps);
  land(true);
  await going;
  ok(p.standing === 0 && cleared.filter((t) => t === 'a').length === 2, 'one still loading when they are all taken down is put straight back down');
}

{
  // Taken down and stood again while one is still going up (a Disconnect and a Connect inside one model load):
  // the one on its way is the only stand under its key, and it stands as it lands.
  const stood: string[] = [];
  const cleared: string[] = [];
  const lands: ((v: boolean) => void)[] = [];
  const slow = {
    stand: (r: PlacedProp) => {
      stood.push(r.thing);
      return new Promise<boolean>((res) => void lands.push(res));
    },
    clear: (t: string) => void cleared.push(t),
  };
  const store = { get: () => JSON.stringify([{ thing: 'a', id: 'chair_s01', x: 0, y: 0, z: 0, q: [0, 0, 0, 1] }]) };
  const p = new PlacedProps();
  await p.enter('tatooine', store, slow, false);
  const first = p.standAll(slow);
  p.takeDownAll(slow);
  const second = p.standAll(slow);
  ok(stood.length === 1 && p.isGoing('a'), "taken down and stood again while one is still going up starts no second stand under its key, which would file the key twice");
  lands.shift()!(true);
  await first;
  await second;
  ok(p.standing === 1 && cleared.length === 0 && !p.isGoing('a'), 'and the one on its way stands as it lands, since the rows want it again: neither filed twice nor lost');
  ok((await p.restore(p.all[0], slow, () => undefined)) === true && stood.length === 1, 'a put-back of one already standing stands nothing more');

  // A world left and come back to while one is going up: the next visit's own stand is never taken down by the old
  // one landing, in whichever order the two land.
  for (const order of ['old first', 'new first']) {
    stood.length = 0;
    cleared.length = 0;
    lands.length = 0;
    const q = new PlacedProps();
    await q.enter('tatooine', store, slow, false);
    const old = q.standAll(slow);
    await q.enter('tatooine', store, slow, false);
    const fresh = q.standAll(slow);
    ok(stood.length === 2, `(${order}) the world arriving again stands its own, the old one still on its way into the world that went`);
    const [oldLand, newLand] = lands;
    for (const f of order === 'old first' ? [oldLand, newLand] : [newLand, oldLand]) {
      f(true);
      await settle();
    }
    await old;
    await fresh;
    ok(q.standing === 1 && !cleared.includes('a'), `(${order}) and the old one landing takes nothing down here, where the new world's copy stands under the same key`);
  }
}

// ---------------------------------------------------------------- asking makes nothing

{
  // Asked a few times a second from the frame whatever the game is doing, so what it is asked with is written in
  // place and the asking makes nothing: measured the way the rule reads, the young generation's use with no
  // collection in between, over a long run of the very calls the frame makes.
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) console.log('skip  run with --expose-gc to check that asking who keeps them makes nothing');
  else {
    const out: KeeperState = { serverHolds: false, wanted: false, answering: false, sinceArrivalMs: 0 };
    const lines = [
      { authority: 'server', mode: 'server', propsVersion: 1 },
      { authority: 'me', mode: 'waiting', propsVersion: 0 },
      { authority: 'me', mode: 'relay', propsVersion: 0 },
      { authority: 'me', mode: 'off', propsVersion: 0 },
    ];
    const prevs: Keeper[] = ['server', 'local', 'pending'];
    let tally = 0;
    const run = (i: number) => {
      const k = keeperOf(prevs[i % 3], keeperState(out, lines[i & 3], (i & 4) === 0, (i & 8) === 0, (i & 16) === 0, i));
      if (k === 'server') tally++;
    };
    for (let i = 0; i < 20000; i++) run(i);
    let scavenges = 0;
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
    });
    obs.observe({ entryTypes: ['gc'] });
    gc();
    await new Promise((r) => setImmediate(r));
    scavenges = 0;
    const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    const calls = 200000;
    const before = young();
    for (let i = 0; i < calls; i++) run(20000 + i);
    const after = young();
    await new Promise((r) => setImmediate(r));
    obs.disconnect();
    const perCall = Math.max(0, after - before) / calls;
    ok(scavenges === 0 && perCall < 1 && tally > 0, `${calls} askings of who keeps them make nothing: ${perCall.toFixed(3)} bytes an asking, ${scavenges} collections of the young generation`);
  }
}

// ---------------------------------------------------------------- the wiring, read out of the source

{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const bodyOf = (signature: string): string => {
    const at = main.indexOf(signature);
    if (at < 0) return '';
    let depth = 0;
    for (let i = main.indexOf('{', at + signature.length - 1); i < main.length; i++) {
      if (main[i] === '{') depth++;
      else if (main[i] === '}' && --depth === 0) return main.slice(at, i + 1);
    }
    return '';
  };
  const switchProps = bodyOf('private switchPropsKeeper(to: Keeper): void');
  const switchHomes = bodyOf('private switchHomesKeeper(to: Keeper): void');
  const steps = bodyOf('private stepKeepers(dt: number): void');
  const stateFor = bodyOf('private keeperStateFor(props: boolean): KeeperState');
  const arrival = bodyOf('private arrivalKeepers(): void');
  const setsOf = (name: string): string => {
    const at = main.indexOf(`private readonly ${name}: KeptSets = {`);
    return at < 0 ? '' : main.slice(at, main.indexOf('};', at) + 2);
  };
  const propSets = setsOf('propSets');
  const homeSets = setsOf('homeSets');
  ok(switchProps.length > 0 && !/enterPlaced|props\.release\(\)/.test(switchProps + propSets) && !/enterPlaced|props\.release\(\)/.test(bodyOf('private async standKeptProps(): Promise<void>')) && !/enterPlaced|props\.release\(\)/.test(bodyOf('private async standLocalProps(): Promise<void>')), 'a change of keeper never runs the arrival\'s enterPlaced and never frees the props pack every prop is drawn from');
  ok(/switchSets\(to, this\.propSets\);/.test(switchProps) && /switchSets\(to, this\.homeSets\);/.test(switchHomes) && !/takeDownAll|resume|standLocal|standKept/.test(switchProps + switchHomes), 'a change of keeper takes down and stands the two sets by the one rule (switchSets, run above), for props and houses alike');
  ok(/downServer: \(\) => keptProps\.takeDownAll\(\),/.test(propSets) && /downLocal: \(\) => placedProps\.takeDownAll\(this\.placedDeps\(\)\),/.test(propSets) && /upServer: \(\) => void this\.standKeptProps\(\),/.test(propSets) && /upLocal: \(\) => void this\.standLocalProps\(\),/.test(propSets), "the props' two sets are the server's kept props and this machine's own, each taken down and stood by its own call");
  ok(/downServer: \(\) => homes\.takeDownAll\(\),/.test(homeSets) && /downLocal: \(\) => this\.takeDownLocalHomes\(\),/.test(homeSets) && /upServer: \(\) => homes\.resume\(\),/.test(homeSets) && /upLocal: \(\) => void this\.standLocalHomes\(\),/.test(homeSets), "and the houses' the server's houses and this machine's");
  ok(/const props = keeperOf\(this\.propsKeeper, this\.keeperStateFor\(true\)\);/.test(steps) && /const houses = keeperOf\(this\.homesKeeper, this\.keeperStateFor\(false\)\);/.test(steps) && /if \(props !== this\.propsKeeper\) this\.switchPropsKeeper\(props\);/.test(steps) && /if \(houses !== this\.homesKeeper\) this\.switchHomesKeeper\(houses\);/.test(steps), 'the frame asks for both kinds by the rule, and switches whichever changed');
  ok(/return keeperState\(this\.keeperState, this\.net\.session, props, this\.net\.wanted, this\.relayAsked, performance\.now\(\) - this\.keeperSince\);/.test(stateFor), "what it asks with is the session's own word on the line, whether the socket wants one, a session's first connect still to come, and the time since the arrival (keeperState, run above)");
  const framePart = steps.slice(0, steps.indexOf('if (props === this.propsKeeper && houses === this.homesKeeper) return;'));
  ok(/PROPS_KEEPER_TUNE\.everyMs/.test(framePart) && !/new |\[|\{ |\.\.\.|=>|`/.test(framePart + stateFor), 'it is asked a few times a second from the frame, and everything the frame runs before a change makes nothing (measured above)');
  ok(/this\.stepKeepers\(rawDt\);/.test(main), 'by the frame itself');
  ok(/this\.propsKeeper = arrivalKeeper\(this\.propsKeeper, this\.keeperStateFor\(true\)\);/.test(arrival) && /this\.homesKeeper = arrivalKeeper\(this\.homesKeeper, this\.keeperStateFor\(false\)\);/.test(arrival) && /if \(arrivalHolds\(this\.homesKeeper\)\) homes\.takeDownAll\(\);\s*else homes\.resume\(false\);/.test(arrival), "an arrival's keepers come from who kept them by the rule, and the server's houses are held only once this machine keeps them");
  ok(/return keptRefusal\(keeper, this\.net\.session\.authority\);/.test(bodyOf('private keptRefusal(keeper: Keeper): string | null')), "the game's refusal is the rule's, read against the session's own word on the line");
  ok(/const homeCircles = arrivalCircles\(this\.homesKeeper, this\.localHomes\.circles\(\)\);/.test(main) && /k\.game\.push\(\.\.\.homeCircles\);/.test(main), "an arrival hands the ground this machine's houses' circles only as the rule says");
  ok(/this\.personalWorld = placesFor;\s*if \(this\.homesKeeper === 'local'\) void this\.standLocalHomes\(\);/.test(main), "and stands this machine's houses once the world is in, while this machine keeps them");
  const standHomes = bodyOf('private async standLocalHomes(): Promise<void>');
  ok(/if \(this\.localHomes\.isStanding\(row\.key\) \|\| this\.localHomes\.isPlacing\(row\.key\)\) continue;/.test(standHomes) && /const ticket = this\.localHomes\.beginPlace\(row\.key\);/.test(standHomes) && /if \(this\.localHomes\.land\(row\.key, ticket, placed, this\.homesKeeper === 'local'\) === 'down'\) this\.world\.unplaceBuilding\(row\.key\);/.test(standHomes), "this machine's houses are stood one placing a key at a time, each landing as LocalHomes.land says (run in localHomes.test.ts)");
  const enterPlaced = bodyOf('private async enterPlaced(pack: string): Promise<void>');
  ok(/placedProps\.enter\(pack, this\.placedStore\(\), this\.placedDeps\(\), this\.propsKeeper === 'local'\)/.test(enterPlaced) && /if \(this\.propsKeeper === 'server'\) keptProps\.ready\(\);/.test(enterPlaced), "and its props: this machine's stood while it keeps them, the server's while the server does");
  ok(/keptProps\.attach\(keptDepsOf\(\(\) => this\.placedDeps\(\), \(text\) => this\.messages\.system\(text\), this\.net\)\);/.test(main), "the kept props are wired to the game by the one builder the relay's round trip runs, through this machine's own stand and the socket");
  const handler = main.slice(main.indexOf('const homeWordWas = this.net.onWord;'), main.indexOf('this.net.session.onClaimed(() => purse.ask());'));
  ok(/this\.net\.onWord = \(msg\) => \{/.test(handler) && /homeWordWas\(msg\);/.test(handler) && /if \(routePropWord\(msg, keptProps\)\) \{/.test(handler), "and every prop word off the socket reaches them through the one router the relay's round trip runs");
  const drop = bodyOf('private async dropPlacingProp(): Promise<void>');
  ok(/const refusal = this\.keptRefusal\(keeper\);/.test(drop) && drop.indexOf('this.keptRefusal(keeper)') < drop.indexOf('p.from = HAND_FRESH;'), 'a drop while nobody knows who keeps them, or while their server is not answering, is refused before anything is let go of');
  ok(/if \(keeper === 'server'\) \{[\s\S]*?keptProps\.askMove\(from\.row\.id[\s\S]*?keptProps\.ask\(id/.test(drop) && drop.indexOf("if (keeper === 'server') {") < drop.indexOf('placedProps.put('), "with the server keeping them it is asked of the server, never put into this machine's store");
  const stop = bodyOf('private stopPlacingProp(how: LetGo = ');
  ok(/case 'server':[\s\S]*?keptProps\.show\(from\.row\.id\)[\s\S]*?keptProps\.askDown\(from\.row\.id\)[\s\S]*?keptProps\.unhide\(from\.row\.id\)/.test(stop) && !/case 'server':[\s\S]*?placedProps\.(restore|keepIn|put)[\s\S]*?case 'permanent'/.test(stop), "one of the server's let go of is shown again, asked away, or left to the server, and never written into this machine's store");
  const take = bodyOf('private async takeNearestProp(): Promise<string | null>');
  ok(/keeper === 'local' \? placedProps\.nearest\(/.test(take) && /keeper === 'server' \? keptProps\.mineNearest\(this\.net\.session\.character/.test(take), "the pick-up key takes the player's own from whoever keeps them now, and only that");
  ok(/const own = row \?\? kept;/.test(take) && /!own \|\| Math\.hypot\(fixed\.x - me\.x, fixed\.y - me\.y, fixed\.z - me\.z\) < Math\.hypot\(own\.x - me\.x, own\.y - me\.y, own\.z - me\.z\)/.test(take), 'and on the dev server the nearer of those and the permanent props, by one rule');
  const save = bodyOf('private async savePermanentProp(p: PropHand): Promise<void>');
  ok(/const unkept = p\.from\.kind === 'server' \? this\.keptRefusal\('server'\) : null;\s*if \(unkept\) return this\.editSay\(false, unkept\);/.test(save) && save.indexOf('if (unkept)') < save.indexOf('this.postPlacements('), "the dev server's editor saves one of yours a server keeps only while that server answers, before anything is written");
  ok(/if \(this\.keptRefusal\('server'\)\) \{\s*keptProps\.show\(from\.row\.id\);[\s\S]*?\} else keptProps\.askDown\(from\.row\.id\);/.test(save), 'and a line that dropped while the save was out leaves it standing where the server has it, in words, rather than asking a dead line to take it away');
}

console.log(`\n${passed} checks passed`);
