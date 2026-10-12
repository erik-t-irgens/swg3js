// The props players put down on a server's world: what the server will write, what it refuses, who may move
// or take one away, and what survives a restart.
//
// The last is the one this file exists for, as `homes.test.ts` exists for the houses: an id handed out twice
// would silently overwrite somebody else's chair, so this builds a real store in a temp folder, puts props
// down through the real `PropsKept`, takes the newest away, kills it, reads the world back off the disk and
// checks the next id is one the world has never used.
//
// Run: node tools/swg/tests/propsKept.test.ts

import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROPS_VERSION, PROP_SAYS, PROP_TUNING, PropsKept, applyProps, cleanPropMove, cleanPropPlace, cleanPropRemove, mayProp, propRefusal } from '../../../server/propsKept.mjs';
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

type Row = { id: string; owner: string; prop: string; x: number; y: number; z: number; q: number[]; inside?: boolean; at: number };
type Told = { to: number; msg: Record<string, unknown> };

const good = { prop: 'chair_s01', x: 10, y: 3.25, z: -20, q: [0, 0.38268, 0, 0.92388], inside: false };
const made = (over: Record<string, unknown> = {}) => ({ ...good, ...over });

// ---------------------------------------------------------------- what comes off the wire

{
  ok(PROPS_VERSION === 1, 'a server that keeps props says 1 in its hail');
  const c = cleanPropPlace(good)!;
  ok(!!c && c.prop === 'chair_s01' && c.y === 3.25, 'an ordinary placing word is taken, at the height the browser stood it');
  ok(Math.abs(Math.hypot(c.q[0], c.q[1], c.q[2], c.q[3]) - 1) < 1e-5, 'and its turn is made whole');
  const long = cleanPropPlace(made({ q: [0, 2, 0, 0] }))!;
  ok(!!long && Math.abs(long.q[1] - 1) < 1e-9, 'a turn sent twice as long is the same turn');
  ok(!cleanPropPlace(made({ q: [0, 0, 0, 0] })), 'a turn of no length is not a turn');
  ok(!cleanPropPlace(made({ q: [0, 0, 1] })) && !cleanPropPlace(made({ q: 'up' })) && !cleanPropPlace(made({ q: [0, 0, Number.NaN, 1] })), 'and nor is one that is not four numbers');
  ok(!cleanPropPlace(made({ prop: 42 })) && !cleanPropPlace(made({ prop: 'a chair' })) && !cleanPropPlace(made({ prop: '__proto__' })), "a prop id that is not one of the catalogue's shape is dropped, the language's own names with it");
  ok(!cleanPropPlace(made({ x: Number.NaN })) && !cleanPropPlace(made({ z: 1e9 })), 'a place that is not a number, or past any world, is dropped');
  ok(!cleanPropPlace(null) && !cleanPropPlace([good]) && !cleanPropPlace('chair'), 'and so is anything that is not an object at all');
  ok(cleanPropPlace(made({ inside: true }))!.inside === true && cleanPropPlace(made({ inside: 'yes' }))!.inside === false, 'whether it stands in a room is a yes only when it says true');
  ok(!!cleanPropMove({ id: 'p7', ...good }) && !cleanPropMove({ id: '__proto__', ...good }) && !cleanPropMove({ id: 'p7' }), 'a move names which one and where it goes, or is nothing');
  ok(!!cleanPropRemove({ id: 'p7' }) && !cleanPropRemove({ id: '' }) && !cleanPropRemove({ id: 'prototype' }) && !cleanPropRemove({}), 'a removal names which one, or is nothing');
}

{
  const w = { at: 0, lines: 0 };
  let taken = 0;
  for (let i = 0; i < PROP_TUNING.perSecond + 4; i++) if (mayProp(w, 1000, PROP_TUNING)) taken++;
  ok(taken === PROP_TUNING.perSecond, `a browser may send only so many words about props in a second (${PROP_TUNING.perSecond})`);
  ok(mayProp(w, 2500, PROP_TUNING), 'and the next second it may again');
}

{
  // Out where only space reaches: a prop may be put down in a space zone, and the made-up system of ours reaches
  // 125 km either way.
  ok(!!cleanPropPlace(made({ x: 200000, z: -125000 })) && !cleanPropPlace(made({ x: 2e6 })), 'a place 200 km out is a place; one past any world is not');
}

{
  // Nothing about a prop is refused in silence: a move or a removal has already taken its row down in the asking
  // browser, which stands it again only on hearing back, so the refusal names the row.
  const p = new PropsKept({ tuning: PROP_TUNING });
  ok(JSON.stringify(propRefusal({ t: 'moveProp', id: 'p7', x: 'far' }, 'x')) === JSON.stringify({ t: 'propNo', why: 'x', id: 'p7' }), 'a refused move names its row');
  ok(JSON.stringify(propRefusal({ t: 'removeProp', id: 'p8' }, 'x')) === JSON.stringify({ t: 'propNo', why: 'x', id: 'p8' }), 'and a refused removal');
  ok(!('id' in propRefusal({ t: 'placeProp', id: 'p9', prop: 'chair_s01' }, 'x')) && !('id' in propRefusal({ t: 'removeProp', id: '__proto__' }, 'x')) && !('id' in propRefusal({ t: 'moveProp', id: 42 }, 'x')) && !('id' in propRefusal(null, 'x')), 'a placing names none, and nor does a word whose id is not one this server could have handed out');
  const read = p.refuse(7, { t: 'moveProp', id: 'p3', x: Number.NaN }, PROP_SAYS.unread);
  ok(!read.ok && read.tell.length === 1 && (read.tell[0] as Told).to === 7 && (read.tell[0] as Told).msg.id === 'p3' && (read.tell[0] as Told).msg.why === PROP_SAYS.unread, 'a word the server cannot read is answered to its asker alone, naming its row');
  const w = { at: 0, lines: 0 };
  const answers: Told[][] = [];
  for (let i = 0; i < PROP_TUNING.perSecond + 3; i++) {
    const word = { t: 'placeProp', ...good };
    if (!mayProp(w, 5000, PROP_TUNING)) answers.push(p.tooFast(7, word, w).tell as Told[]);
  }
  ok(answers.length === 3 && answers[0].length === 1 && answers[1].length === 0 && answers[2].length === 0, 'placings past the window are refused once a window, in one word, since nothing of them stood anywhere');
  ok(answers[0][0].msg.why === PROP_SAYS.tooFast && !('id' in answers[0][0].msg), 'in words, naming no row');
  const moves: Told[][] = [];
  for (let i = 0; i < 3; i++) moves.push(p.tooFast(7, { t: 'removeProp', id: `p${i + 1}` }, w).tell as Told[]);
  ok(moves.every((m, i) => m.length === 1 && m[0].msg.id === `p${i + 1}`), 'while every removal or move past it is answered, each naming its own row');
  const theirs = p.place('c1', 7, 'tatooine', cleanPropPlace(good)!).id!;
  const notYours = p.move('c2', 8, 'tatooine', theirs, cleanPropMove({ id: theirs, ...good })!);
  ok((notYours.tell[0] as Told).msg.id === theirs && (p.remove('c2', 8, theirs).tell[0] as Told).msg.id === theirs, "and a move or removal refused by the rules names its row too");
}

// ---------------------------------------------------------------- putting one down

const kept = (tuning = PROP_TUNING) => {
  const log: Record<string, unknown>[] = [];
  let clock = 1000;
  const p = new PropsKept({ tuning, now: () => clock, write: (rec: Record<string, unknown>) => log.push(rec) });
  return { p, log, tick: (ms: number) => (clock += ms) };
};

{
  const { p, log } = kept();
  const out = p.place('c1', 7, 'tatooine', cleanPropPlace(good)!, [7, 8, 9]);
  ok(out.ok, 'the first prop on a world goes down');
  ok(log.length === 1 && log[0].t === 'prop', 'and is written down before anybody is told');
  ok(out.tell.length === 3 && out.tell.every((m: Told) => m.msg.t === 'propUp'), 'and everybody standing on that world is told, the one who placed it included, with the same word');
  const wire = (out.tell[0] as Told).msg.prop as Row;
  ok(/^p\d+$/.test(wire.id) && wire.owner === 'c1' && wire.prop === 'chair_s01', 'the server gives it its id and says whose it is and what');
  ok(!('world' in wire), 'the world is not sent back, since everyone hearing it is standing on it');
  ok(!('inside' in wire), 'nor a room it does not stand in');
  const near = p.place('c2', 8, 'tatooine', cleanPropPlace(made({ x: good.x + 0.1 }))!, [7, 8]);
  ok(near.ok, 'a second one touching the first goes down too: furniture may touch, and the server never judges a spot');
}

{
  const { p } = kept();
  ok(!p.place('', 7, 'tatooine', cleanPropPlace(good)!).ok, 'a browser with no character claimed owns nothing and puts nothing down');
  const refused = p.place('', 7, 'tatooine', cleanPropPlace(good)!);
  ok(refused.tell.length === 1 && (refused.tell[0] as Told).msg.t === 'propNo', 'and only the one who asked is told why');
  ok(!p.place('c1', 7, '', cleanPropPlace(good)!).ok && !p.place('c1', 7, 'w'.repeat(200), cleanPropPlace(good)!).ok, 'and nowhere, or somewhere no world is, has nowhere to put it');
  ok(p.place('c1', 7, '__proto__', cleanPropPlace(good)!).ok && p.forWorld('__proto__').length === 1, "a world named after one of the language's own names is a world like any other");
}

{
  // The caps: one character's on one world, the world's, and the server's.
  const tuning = { ...PROP_TUNING, mine: 3, world: 5, rows: 7 };
  const { p } = kept(tuning);
  for (let i = 0; i < 3; i++) p.place('c1', 7, 'tatooine', cleanPropPlace(made({ x: i }))!);
  const over = p.place('c1', 7, 'tatooine', cleanPropPlace(good)!);
  ok(!over.ok && over.why!.includes('3'), `one character may have only so many on one world, and is told so (${over.why})`);
  ok(p.place('c1', 7, 'naboo', cleanPropPlace(good)!).ok, 'and the cap is per world: the same character puts one down on another');
  p.place('c2', 8, 'tatooine', cleanPropPlace(good)!);
  p.place('c3', 9, 'tatooine', cleanPropPlace(good)!);
  const full = p.place('c4', 10, 'tatooine', cleanPropPlace(good)!);
  ok(!full.ok && full.why!.includes('world'), 'a world holds only so many, whoever puts them down');
  p.place('c4', 10, 'lok', cleanPropPlace(good)!);
  const server = p.place('c4', 10, 'dantooine', cleanPropPlace(good)!);
  ok(!server.ok && server.why!.includes('server'), 'and a server only so many altogether');
}

// ---------------------------------------------------------------- moving one, and taking one away

{
  const { p, log, tick } = kept();
  const id = p.place('c1', 7, 'tatooine', cleanPropPlace(good)!).id!;
  tick(500);
  const moved = p.move('c1', 7, 'tatooine', id, cleanPropMove({ id, ...made({ x: 50, inside: true }) })!, [7, 8]);
  ok(moved.ok && moved.tell.length === 2 && moved.tell.every((m: Told) => m.msg.t === 'propMoved'), 'the owner moves their own, and everybody on the world is told where it went');
  const row = (moved.tell[0] as Told).msg.prop as Row;
  ok(row.id === id && row.x === 50 && row.inside === true && row.at === 1500, 'under the same id, at its new place and its new moment');
  ok(log.length === 2 && log[1].t === 'prop' && (log[1].prop as Row).x === 50, 'and the move is written down as the row it is now');
  ok(p.forWorld('tatooine').length === 1, 'and it is still one prop');
  const back = p.move('c1', 7, 'tatooine', id, cleanPropMove({ id, ...made({ x: 51 }) })!);
  ok(back.ok && !('inside' in ((back.tell[0] as Told).msg.prop as Row)), 'moved out of the room again, it no longer says it stands in one');
  const theirs = p.move('c2', 8, 'tatooine', id, cleanPropMove({ id, ...good })!);
  ok(!theirs.ok && theirs.why!.includes('not yours') && (theirs.tell[0] as Told).msg.t === 'propNo', 'somebody else may not move it, and only they are told');
  ok(p.move('c2', 8, 'tatooine', id, cleanPropMove({ id, ...made({ x: 60 }) })!, [], true).ok, 'the admin may');
  const elsewhere = p.move('c1', 7, 'naboo', id, cleanPropMove({ id, ...good })!);
  ok(!elsewhere.ok && elsewhere.why!.includes('another world'), 'nor may it be moved from another world: a move is on the world it stands on');
  const gone = p.move('c1', 7, 'tatooine', 'p999', cleanPropMove({ id: 'p999', ...good })!);
  ok(gone.ok && (gone.tell[0] as Told).msg.t === 'propDown', 'one that is not there any more is not an error: the one who asked is told it is down');
}

{
  const { p, log } = kept();
  const id = p.place('c1', 7, 'tatooine', cleanPropPlace(good)!).id!;
  const theirs = p.remove('c2', 8, id, [7, 8]);
  ok(!theirs.ok && theirs.why!.includes('not yours'), 'somebody else may not take it away');
  ok(p.forWorld('tatooine').length === 1, 'and it is still standing');
  const mine = p.remove('c1', 7, id, [7, 8]);
  ok(mine.ok && mine.tell.length === 2 && mine.tell.every((m: Told) => m.msg.t === 'propDown'), 'the owner may, and everybody on the world is told');
  ok(log[log.length - 1].t === 'propGone' && p.forWorld('tatooine').length === 0, 'which is written down, and it is gone');
  const again = p.remove('c1', 7, id);
  ok(again.ok && again.tell.length === 1, 'pressing twice is not an error: it is a browser being careful');
  const adminId = p.place('c1', 7, 'tatooine', cleanPropPlace(good)!).id!;
  ok(p.remove('c9', 9, adminId, [], true).ok, 'and the admin may take anybody\'s away');
}

// ---------------------------------------------------------------- the record, and the replay

{
  const { p, log } = kept();
  p.place('c1', 7, 'tatooine', cleanPropPlace(good)!);
  const moved = p.place('c2', 8, 'naboo', cleanPropPlace(made({ x: 500 }))!).id!;
  p.move('c2', 8, 'naboo', moved, cleanPropMove({ id: moved, ...made({ x: 700, inside: true }) })!);
  const gone = p.place('c1', 7, 'tatooine', cleanPropPlace(made({ x: 90 }))!).id!;
  p.remove('c1', 7, gone);
  const replayed = emptyWorld(1);
  for (const rec of log) ok(applyChange(replayed, rec) === true, `the store understands a ${rec.t} record`);
  const back = new PropsKept({ tuning: PROP_TUNING });
  back.load(replayed);
  const same = (a: object[], b: object[]) => JSON.stringify(a) === JSON.stringify(b);
  ok(same(back.forWorld('tatooine'), p.forWorld('tatooine')) && same(back.forWorld('naboo'), p.forWorld('naboo')), 'a log replayed into a fresh PropsKept gives the same rows on the same worlds');
  ok((back.forWorld('naboo')[0] as Row).x === 700 && (back.forWorld('naboo')[0] as Row).inside === true, 'the move replayed is the row as it stands now');
  ok(Object.getPrototypeOf(replayed.props) === null, 'and the table the rows sit in has no prototype');
}

{
  const world = emptyWorld(1);
  ok(applyProps(world, { t: 'prop', id: '__proto__', prop: { owner: 'c1' } }) === false, "a record naming one of the language's own names is refused");
  ok(applyProps(world, { t: 'prop', id: 'p1' }) === false, 'and so is one with no prop in it');
  ok(applyProps(world, { t: 'nothingLikeThis', id: 'p1' }) === false, 'a record from a newer server is not understood, which is not an error');
  ok(applyProps(world, { t: 'propGone', id: 'p404' }) === true, 'and taking away one that is not there is fine');
}

// ---------------------------------------------------------------- a real restart, on a real disk

{
  // The trap: the newest prop is taken away, and the server stopped and started. Worked out from the rows
  // still in the file, the next id would be the one just dropped -- and a browser still holding the old
  // `propUp` would read the new prop as the old one. The counter is carried by the records themselves.
  const dir = mkdtempSync(join(tmpdir(), 'swg-props-'));
  try {
    const first = new Store({ dir, epoch: 1 });
    const p = new PropsKept({ tuning: PROP_TUNING, now: () => 1234, write: (rec: Record<string, unknown>) => first.change(rec) });
    p.load(first.data);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(p.place('c1', 7, 'tatooine', cleanPropPlace(made({ x: i * 3 }))!).id!);
    const newest = ids[ids.length - 1];
    p.remove('c1', 7, newest);
    // Stopped the hard way: no snapshot written, only the log, as a power cut leaves it.
    ok(!existsSync(join(dir, 'world.json')), 'the first server is stopped before it has written a snapshot, so the log is all there is');
    const crashed = first as unknown as { fd: number; timer: ReturnType<typeof setInterval> | null };
    if (crashed.timer) clearInterval(crashed.timer);
    closeSync(crashed.fd);

    const second = new Store({ dir, epoch: 1 });
    const back = new PropsKept({ tuning: PROP_TUNING, write: (rec: Record<string, unknown>) => second.change(rec) });
    back.load(second.data);
    ok(back.forWorld('tatooine').length === 3, 'the props survive the server being stopped and started, replayed off the log');
    ok(!back.rows.has(newest), 'and the newest, taken away before the stop, stays away');
    const row = back.rows.get(ids[0]) as Row;
    ok(row.owner === 'c1' && row.prop === 'chair_s01' && row.y === good.y && row.q.length === 4, 'with whose it is, what it is, how high it stands and how it is turned all intact');
    const fresh = back.place('c2', 8, 'tatooine', cleanPropPlace(good)!).id!;
    ok(!ids.includes(fresh), `the next one is under an id the world has never used, not the one just dropped (${fresh} after ${ids.join(', ')})`);
    // A clean stop this time: the snapshot is written and the log emptied.
    second.close();

    // And once more, from the snapshot alone with the log played out: still never repeated.
    const third = new Store({ dir, epoch: 1 });
    const again = new PropsKept({ tuning: PROP_TUNING });
    again.load(third.data);
    const later = again.place('c3', 9, 'tatooine', cleanPropPlace(good)!).id!;
    ok(!ids.includes(later) && later !== fresh, `and after a second restart the counter is still past every id it handed out (${later})`);
    const onDisk = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8'));
    ok(Number(onDisk.propSeq) > Number(newest.slice(1)), `the snapshot carries the counter past every id (${onDisk.propSeq})`);
    note(`world.json carries ${Object.keys(onDisk.props ?? {}).length} props and propSeq ${onDisk.propSeq}`);
    third.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} checks passed`);
