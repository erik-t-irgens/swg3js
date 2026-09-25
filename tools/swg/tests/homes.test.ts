// The buildings players put down: what the server will write, what it refuses, and what survives a
// restart.
//
// The interesting half is the last one. A house that came back as somebody else's, or under an id
// the server was about to hand out again, would be worse than a house that did not come back at
// all -- so this does not mirror the store, it builds a real one in a temp folder, puts houses down
// through the real `Homes`, kills it and reads the world back off the disk.
//
// Run: node tools/swg/tests/homes.test.ts

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOME_TUNING, Homes, applyHomes, cleanHome, cleanRemove, mayPlace } from '../../../server/homes.mjs';
import { Store, applyChange, emptyWorld } from '../../../server/store.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

const good = { model: 'a_house', x: 10, y: 3.5, z: -20, h: 1, r: 12 };
const made = (over: Record<string, unknown> = {}) => ({ ...good, ...over });

// ---------------------------------------------------------------- what comes off the wire

{
  ok(!!cleanHome(good), 'an ordinary placing word is taken');
  ok(cleanHome(good)!.y === 3.5, 'and keeps the height the browser measured, since the server has no ground of its own');
  ok(!cleanHome({ ...good, model: 42 }), 'a model that is not a string is dropped');
  ok(!cleanHome({ ...good, model: '__proto__' }), "and so is one of the language's own names");
  ok(!cleanHome({ ...good, model: 'a house' }), 'and so is one with a space in it, which no pack id has');
  ok(!cleanHome({ ...good, x: Number.NaN }), 'a place that is not a number is dropped');
  ok(!cleanHome({ ...good, x: 1e9 }), 'and so is one past any world');
  ok(!cleanHome({ ...good, h: 'north' }), 'a heading that is not a number is dropped');
  ok(!cleanHome(null) && !cleanHome([good]) && !cleanHome('house'), 'and so is anything that is not an object at all');
}

{
  // Two browsers that name the same heading a full turn apart must write the same number down, or
  // the same house placed twice reads as two different buildings.
  const a = cleanHome(made({ h: 0.5 }))!;
  const b = cleanHome(made({ h: 0.5 + Math.PI * 2 }))!;
  const c = cleanHome(made({ h: 0.5 - Math.PI * 4 }))!;
  ok(a.h === b.h && b.h === c.h, 'a heading is kept in one turn, however many the browser sent');
  ok(a.h >= 0 && a.h < Math.PI * 2, 'and is never negative');
}

{
  ok(cleanHome(made({ r: 10000 }))!.r === HOME_TUNING.clear, 'a browser cannot claim a square kilometre by asking for one');
  ok(cleanHome(made({ r: 0 }))!.r === HOME_TUNING.least, 'and one that asks for nothing still keeps something clear');
  ok(cleanHome(made({ r: undefined }))!.r === HOME_TUNING.least, 'as does one that asks for nothing at all');
}

{
  ok(!!cleanRemove({ id: 'h7' }), 'an ordinary removal word is taken');
  ok(!cleanRemove({ id: '__proto__' }) && !cleanRemove({ id: '' }) && !cleanRemove({}), 'and the ways it can be nonsense are not');
}

{
  const w = { at: 0, lines: 0 };
  let taken = 0;
  for (let i = 0; i < HOME_TUNING.perSecond + 4; i++) if (mayPlace(w, 1000, HOME_TUNING)) taken++;
  ok(taken === HOME_TUNING.perSecond, 'a browser may place only so many in a second');
  ok(mayPlace(w, 2500, HOME_TUNING), 'and the next second it may again');
}

// ---------------------------------------------------------------- putting one down

const homes = () => {
  const log: Record<string, unknown>[] = [];
  let clock = 1000;
  const h = new Homes({ tuning: HOME_TUNING, now: () => clock, write: (rec: Record<string, unknown>) => log.push(rec) });
  return { h, log, tick: (ms: number) => (clock += ms) };
};

{
  const { h, log } = homes();
  const out = h.place('c1', 7, 'tatooine', cleanHome(good)!, [7, 8, 9]);
  ok(out.ok, 'the first house on a world goes up');
  ok(log.length === 1 && log[0].t === 'home', 'and is written down before anybody is told');
  ok(out.tell.length === 3, 'and everybody standing on that world is told, the one who placed it included');
  ok(out.tell.every((m: { msg: { t: string } }) => m.msg.t === 'homeUp'), 'with the same word to each of them');
  const wire = (out.tell[0] as { msg: { home: Record<string, unknown> } }).msg.home;
  ok(typeof wire.id === 'string' && !!wire.id, 'the server gives it its id, which the browser never chooses');
  ok(wire.owner === 'c1', 'and says whose it is');
  ok(!('world' in wire), 'the world is not sent back, since everyone hearing it is standing on it');
}

{
  const { h } = homes();
  ok(!h.place('', 7, 'tatooine', cleanHome(good)!).ok, 'a browser with no character claimed owns nothing and builds nothing');
  ok(!h.place('c1', 7, '', cleanHome(good)!).ok, 'and a browser standing nowhere has nowhere to build');
}

{
  // A world key is not this file's to have an opinion about: it is whatever `rooms.mjs` made of a
  // browser's own planet, and the first cut of this had a pattern on it that refused every world
  // whose name has a space in it -- which is every world in the relay's own round trip below.
  const { h } = homes();
  for (const world of ['a world', 'tatooine:corellia_zone', 'space_tatooine', 'Naboo (live)', '__proto__']) {
    ok(h.place(`c-${world}`, 7, world, cleanHome(good)!).ok, `a world keyed "${world}" can be built on`);
  }
  ok(h.forWorld('__proto__').length === 1, "and a world named after one of the language's own names is a world like any other, since these are real Maps");
  ok(!h.place('c9', 7, 'w'.repeat(200), cleanHome(good)!).ok, 'but a key longer than any world has is refused');
}

{
  const { h } = homes();
  h.place('c1', 7, 'tatooine', cleanHome(good)!);
  const near = h.place('c2', 8, 'tatooine', cleanHome(made({ x: good.x + 4 }))!);
  ok(!near.ok && near.why!.includes('already standing'), 'a second house inside the first one is refused, in words');
  ok(near.tell.length === 1 && (near.tell[0] as { msg: { t: string } }).msg.t === 'homeNo', 'and only the one who asked is told');
  const far = h.place('c2', 8, 'tatooine', cleanHome(made({ x: good.x + good.r * 2 + HOME_TUNING.apart + 1 }))!);
  ok(far.ok, 'and one clear of it goes up');
}

{
  // The spacing counts both circles and the gap between them, so a big building keeps a small one
  // further off than another small one would.
  const { h } = homes();
  h.place('c1', 7, 'tatooine', cleanHome(made({ x: 0, r: HOME_TUNING.clear }))!);
  const d = HOME_TUNING.clear + HOME_TUNING.least + HOME_TUNING.apart;
  ok(!h.place('c2', 8, 'tatooine', cleanHome(made({ x: d - 1, r: HOME_TUNING.least }))!).ok, 'just inside the two circles is refused');
  ok(h.place('c2', 8, 'tatooine', cleanHome(made({ x: d + 1, r: HOME_TUNING.least }))!).ok, 'and just outside them is taken');
}

{
  const { h } = homes();
  // Far enough apart every time that only the cap can refuse them.
  for (let i = 0; i < HOME_TUNING.mine; i++) ok(h.place('c1', 7, 'tatooine', cleanHome(made({ x: i * 200 }))!).ok === true, i === 0 ? 'a character may build' : `and again (${i + 1})`);
  const over = h.place('c1', 7, 'tatooine', cleanHome(made({ x: 99999 }))!);
  ok(!over.ok && over.why!.includes('as many'), `but never more than ${HOME_TUNING.mine}, and is told so`);
  ok(h.place('c2', 8, 'tatooine', cleanHome(made({ x: 99999 }))!).ok, 'and the cap is one character\'s, not the world\'s');
}

{
  const { h } = homes();
  h.place('c1', 7, 'tatooine', cleanHome(good)!);
  ok(h.place('c1', 7, 'naboo', cleanHome(good)!).ok, 'the same spot on another world is another spot');
  ok(h.forWorld('tatooine').length === 1 && h.forWorld('naboo').length === 1, 'and each world knows only its own');
  ok(h.forWorld('lok').length === 0, 'a world with nothing built on it has nothing to send');
}

// ---------------------------------------------------------------- taking one down

{
  const { h, log } = homes();
  const id = h.place('c1', 7, 'tatooine', cleanHome(good)!).id!;
  const mine = h.remove('c1', 7, id, [7, 8]);
  ok(mine.ok, 'the owner may take their own down');
  ok(log.length === 2 && log[1].t === 'homeGone', 'which is written down too');
  ok(mine.tell.length === 2, 'and everybody on the world is told');
  ok(h.forWorld('tatooine').length === 0 && h.ownedBy('c1') === 0, 'and it is gone from the world and from their count');
}

{
  const { h } = homes();
  const id = h.place('c1', 7, 'tatooine', cleanHome(good)!).id!;
  const theirs = h.remove('c2', 8, id, [7, 8]);
  ok(!theirs.ok && theirs.why!.includes('not yours'), 'somebody else may not take it down');
  ok(h.forWorld('tatooine').length === 1, 'and it is still standing');
  ok(h.remove('c2', 8, id, [7, 8], true).ok, 'the admin may');
}

{
  const { h } = homes();
  const id = h.place('c1', 7, 'tatooine', cleanHome(good)!).id!;
  h.remove('c1', 7, id);
  const again = h.remove('c1', 7, id);
  ok(again.ok, 'pressing twice is not an error: it is a browser being careful');
  ok(again.tell.length === 1, 'and the one who pressed is told it is down, which is what they wanted to know');
}

{
  // A spot freed by a removal is free again, which is the one thing a stale index would break.
  const { h } = homes();
  const id = h.place('c1', 7, 'tatooine', cleanHome(good)!).id!;
  ok(!h.place('c2', 8, 'tatooine', cleanHome(good)!).ok, 'the spot is taken');
  h.remove('c1', 7, id);
  ok(h.place('c2', 8, 'tatooine', cleanHome(good)!).ok, 'and free again once it comes down');
}

// ---------------------------------------------------------------- the record, and the replay

{
  // The same function runs when a house goes up and when the log is replayed, so a world replayed
  // off the log and a world that was never restarted cannot be different.
  const { h, log } = homes();
  h.place('c1', 7, 'tatooine', cleanHome(good)!);
  h.place('c2', 8, 'naboo', cleanHome(made({ x: 500 }))!);
  const replayed = emptyWorld(1);
  for (const rec of log) ok(applyChange(replayed, rec) === true, `the store understands a ${rec.t} record`);
  ok(Object.keys(replayed.houses).length === 2, 'and both houses are in the world it built');
  const back = new Homes({ tuning: HOME_TUNING });
  back.load(replayed);
  ok(back.forWorld('tatooine').length === 1 && back.forWorld('naboo').length === 1, 'and a fresh Homes reading that world has them on the right ones');
  ok(back.ownedBy('c1') === 1 && back.ownedBy('c2') === 1, 'and knows whose each one is');
}

{
  // The trap this whole file exists for: an id handed out twice would silently overwrite somebody
  // else's house, and every restart would start at the same one.
  const { h, log } = homes();
  for (let i = 0; i < 4; i++) h.place('c1', 7, 'tatooine', cleanHome(made({ x: i * 200 }))!);
  const replayed = emptyWorld(1);
  for (const rec of log) applyChange(replayed, rec);
  const back = new Homes({ tuning: HOME_TUNING });
  back.load(replayed);
  const fresh = back.place('c2', 8, 'tatooine', cleanHome(made({ x: 5000 }))!);
  ok(fresh.ok, 'a house put down after a restart goes up');
  ok(!Object.prototype.hasOwnProperty.call(replayed.houses, fresh.id!), 'under an id the world has never used');
  ok(back.rows.size === 5, 'and nothing it read back was overwritten');
}

{
  const world = emptyWorld(1);
  ok(applyHomes(world, { t: 'home', id: '__proto__', home: { owner: 'c1' } }) === false, "a record naming one of the language's own names is refused");
  ok(applyHomes(world, { t: 'home', id: 'h1' }) === false, 'and so is one with no house in it');
  ok(applyHomes(world, { t: 'nothingLikeThis', id: 'h1' }) === false, 'a record from a newer server is not understood, which is not an error');
  ok(applyHomes(world, { t: 'homeGone', id: 'h404' }) === true, 'and taking away one that is not there is fine');
}

// ---------------------------------------------------------------- a real restart, on a real disk

{
  const dir = mkdtempSync(join(tmpdir(), 'swg-homes-'));
  try {
    const first = new Store({ dir, epoch: 1 });
    const h = new Homes({ tuning: HOME_TUNING, now: () => 1234, write: (rec: Record<string, unknown>) => first.change(rec) });
    h.load(first.data);
    const kept = h.place('c1', 7, 'tatooine', cleanHome(good)!).id!;
    const gone = h.place('c1', 7, 'tatooine', cleanHome(made({ x: 900 }))!).id!;
    h.remove('c1', 7, gone);
    first.flush?.();
    first.close?.();

    const second = new Store({ dir, epoch: 1 });
    const back = new Homes({ tuning: HOME_TUNING });
    back.load(second.data);
    ok(back.forWorld('tatooine').length === 1, 'a house survives the server being stopped and started');
    ok(back.rows.has(kept) && !back.rows.has(gone), 'and one taken down before the stop stays down');
    const row = back.rows.get(kept)!;
    ok(row.owner === 'c1' && row.model === good.model && row.y === good.y, 'with whose it is, what it is and how high it stands all intact');
    const onDisk = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8'));
    note(`world.json carries ${Object.keys(onDisk.houses ?? {}).length} house and is ${readFileSync(join(dir, 'world.json'), 'utf8').length} bytes`);
    second.close?.();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the relay itself
//
// Everything above is `homes.mjs` on its own. What it cannot see is the glue: that the handler is
// reached at all, that the world a browser is standing on is the one the house is filed under, that
// everybody on that world is told and nobody else is, and that somebody arriving afterwards is
// handed what is already built. That is thirty lines of relay and exactly where a typo lives, so it
// is run rather than argued about.
if (typeof WebSocket === 'undefined') {
  note('the relay round trip was skipped: this node has no WebSocket of its own');
} else {
  const { randomBytes } = await import('node:crypto');
  const { playerIdFor, proofFor, verifierFor } = await import('../../../server/identity.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'swg-homes-relay-'));
  const port = 18791;
  process.env.PORT = String(port);
  // Its world goes in the temp folder and never in `server/data`, which is somebody's real world.
  process.argv.push(`--data=${dir}`);
  await import('../../../server/relay.mjs');
  const settle = () => new Promise((r) => setTimeout(r, 120));

  /** A browser: its own key, a character of its own, and everything the server has said to it. */
  async function connect(name: string, character: string, planet: string) {
    const key = new Uint8Array(randomBytes(32));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: Record<string, unknown>[] = [];
    let nonce = '';
    await new Promise<void>((done, fail) => {
      ws.addEventListener('open', () => done());
      ws.addEventListener('error', () => fail(new Error(`${name} could not connect`)));
    });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String((e as MessageEvent).data)) as Record<string, unknown>;
      if (m.t === 'hail') nonce = String(m.nonce ?? '');
      got.push(m);
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    await settle();
    send({ t: 'claim', player: playerIdFor(key), key: verifierFor(key), proof: proofFor(verifierFor(key), nonce), character, name, counter: 0 });
    await settle();
    send({ t: 'hello', name, species: 'human_male', class: 'jedi', planet });
    await settle();
    return { got, send, close: () => ws.close(), last: (t: string) => [...got].reverse().find((m) => m.t === t) };
  }

  try {
    const a = await connect('Han', 'char-a', 'a world');
    const b = await connect('Chewie', 'char-b', 'a world');
    const far = await connect('Leia', 'char-c', 'another world');

    a.send({ t: 'placeHome', model: 'a_house', x: 30, y: 6.25, z: -40, h: 1, r: 14 });
    await settle();
    const up = a.last('homeUp') as { home: Record<string, unknown> } | undefined;
    ok(!!up, 'the browser that placed it is told it went up');
    ok(!!b.last('homeUp'), 'and so is everybody else standing on that world');
    ok(!far.last('homeUp'), 'and nobody on another world is told at all');
    const home = up!.home;
    ok(home.owner === 'char-a', "the server files it under the character, not the connection");
    ok(home.y === 6.25, 'and keeps the height the browser measured, to the centimetre');

    b.send({ t: 'placeHome', model: 'a_house', x: 34, y: 6.25, z: -40, h: 0, r: 14 });
    await settle();
    const no = b.last('homeNo') as { why: string } | undefined;
    ok(!!no && no.why.includes('already standing'), 'a second house inside the first is refused in words');
    ok(!a.last('homeNo'), 'and only the one who asked hears about it');

    b.send({ t: 'removeHome', id: String(home.id) });
    await settle();
    ok(!b.last('homeDown'), "somebody else's house does not come down for the asking");

    const late = await connect('Lando', 'char-d', 'a world');
    const list = late.last('homes') as { rows: Record<string, unknown>[] } | undefined;
    ok(!!list && list.rows.length === 1, 'a browser arriving later is handed what is already built');
    ok(String(list!.rows[0].id) === String(home.id), 'which is the same house, under the same id');
    ok(!(await connect('Wedge', 'char-e', 'a third world')).last('homes'), 'and a world with nothing built on it sends nothing at all');

    a.send({ t: 'removeHome', id: String(home.id) });
    await settle();
    ok(!!a.last('homeDown') && !!b.last('homeDown'), 'the owner takes it down and everybody on the world is told');

    a.close();
    b.close();
    far.close();
    late.close();
    await settle();
  } finally {
    // The relay owns the port and the store for the rest of this process; the folder is ours.
    setTimeout(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the server still has it open: a temp folder either way */
      }
      process.exit(0);
    }, 200);
  }
}

console.log(`\n${passed} checks passed`);
