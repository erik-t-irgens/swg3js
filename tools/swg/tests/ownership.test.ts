// Who thinks for a creature (server/ownership.mjs), and who may stand one at all
// (server/identity.mjs): the nearest player within the design's 180 m keeps it, it changes hands only
// when somebody else has been a quarter nearer for three seconds together, two players the same
// distance away never move it, a keeper that falls silent or goes to sleep loses everything it kept,
// and a creature that dies in the middle of being handed over is handed to nobody. Everything a
// browser can send goes through its checker first. Synthetic players only; no sockets and no clock
// but the one handed in, so every rule can be stepped by hand.
import assert from 'node:assert/strict';
import { OWN_TUNING, Ownership, cleanId, cleanKeep, cleanSpawn, maySpawn } from '../../../server/ownership.mjs';
import { adminFor, firstRegistered, isAdmin } from '../../../server/identity.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type Tell = { to: number; msg: any };
type Result = { ok: boolean; why?: string; tell: Tell[]; row?: any; ids?: string[]; world?: string };

/**
 * A server with its own clock and its own postbox: every grant the rule decides to send is kept
 * against the connection it was sent to, exactly as the relay would fan it out.
 */
function server(tuning: Record<string, number> = {}) {
  let t = 100000;
  const own = new Ownership({ now: () => t, tuning: { ...OWN_TUNING, ...tuning } });
  const inbox = new Map<number, any[]>();
  const post = (r: Result) => {
    for (const line of r.tell ?? []) inbox.set(line.to, [...(inbox.get(line.to) ?? []), line.msg]);
    return r;
  };
  return {
    own,
    /** Every grant a connection has been sent since the postbox was last emptied. */
    to: (session: number) => inbox.get(session) ?? [],
    /** Every id a connection has been told to take, in order, and every one it has been told to let go. */
    added: (session: number) => (inbox.get(session) ?? []).flatMap((m) => m.add ?? []),
    dropped: (session: number) => (inbox.get(session) ?? []).flatMap((m) => m.drop ?? []),
    clear: () => inbox.clear(),
    now: () => t,
    /** Move the clock on and work the keepers out, as the relay does twice a second. */
    wait(ms: number) {
      t += ms;
      post(own.tick() as Result);
    },
    /** Work them out without moving the clock. */
    tick: () => post(own.tick() as Result),
    /** Somebody is standing here. */
    at(session: number, x: number, y = 0, z = 0, world = 'tatooine ') {
      own.here(session, world, [x, y, z]);
    },
    do: (r: Result) => post(r),
  };
}

/** Stand one thing at the middle of a world, and hand back its id. */
function stand(s: ReturnType<typeof server>, world = 'tatooine ') {
  const made = s.do(s.own.spawn({ world, species: 'a_creature', at: [0, 0, 0], h: 0, seed: 7, by: 'admin' }) as Result);
  return String(made.row.id);
}

// --- 1: what a browser may send ------------------------------------------------------------------
{
  const add = cleanSpawn({ t: 'spawn', do: 'add', species: 'a_creature', at: [1, 2, 3], h: 0.5, seed: 9 });
  ok(add?.do === 'add' && add.species === 'a_creature' && add.at[2] === 3 && add.seed === 9, '1: standing one names what to stand, where, which way and what it rolls from');
  ok(cleanSpawn({ t: 'spawn', do: 'add', at: [1, 2, 3] }) === undefined, '1: with nothing to stand it is dropped');
  ok(cleanSpawn({ t: 'spawn', do: 'add', species: 'a_creature', at: [1, Number.NaN, 3] }) === undefined, '1: and a place that is not three numbers is dropped whole rather than stood at nowhere');
  const huge = cleanSpawn({ t: 'spawn', do: 'add', species: 'a_creature', at: [1e308, 0, 0] });
  ok(huge === undefined, '1: a place far bigger than any world is not a place');
  ok(cleanSpawn({ t: 'spawn', do: 'add', species: 'a_creature', at: [0, 0, 0], seed: -3 })?.seed === 0, '1: a seed that is not a number to roll from is no seed at all');
  ok(cleanSpawn({ t: 'spawn', do: 'remove', id: 'k4' })?.id === 'k4', '1: taking one down names it');
  ok(cleanSpawn({ t: 'spawn', do: 'remove' }) === undefined && cleanSpawn({ t: 'spawn', do: 'dead', id: '__proto__' }) === undefined, '1: with nothing named, or with a name that means something to every object, it is dropped');
  ok(cleanSpawn({ t: 'spawn', do: 'clear' })?.do === 'clear', '1: clearing carries nothing else');
  ok(cleanSpawn({ t: 'spawn', do: 'explode' }) === undefined && cleanSpawn(null) === undefined && cleanSpawn([1] as unknown as object) === undefined, '1: a word nobody knows, nothing at all and a list are not spawn messages');
  ok(cleanId('k12') === 'k12' && cleanId('a b') === '' && cleanId('x'.repeat(60)) === '', '1: an id is plain, short and nothing else');
  ok(cleanKeep({ t: 'keep', do: 'awake', a: 0 })?.a === 0 && cleanKeep({ t: 'keep', do: 'awake', a: 1 })?.a === 1, '1: a browser says it has been put to sleep, or woken');
  ok(cleanKeep({ t: 'keep', do: 'grant', add: ['k1'] }) === undefined, '1: and it cannot grant itself anything, whatever it sends');
  const window = { at: 0, lines: 0 };
  let through = 0;
  for (let i = 0; i < 20; i++) if (maySpawn(window, 5000)) through++;
  ok(through === OWN_TUNING['spawn.perSecond'], `1: one browser may send ${OWN_TUNING['spawn.perSecond']} spawn words in a second and the rest are dropped`);
  ok(maySpawn(window, 6000) === true, '1: and the next second starts the count again');
}

// --- 2: nothing keeps what it cannot see (the design's 180 m) ---------------------------------------
{
  const s = server();
  const id = stand(s);
  s.at(1, OWN_TUNING.range + 20);
  s.tick();
  ok(s.own.keeperOf(id) === 0, '2: a creature nobody is within 180 m of is kept by nobody, and nobody simulates it');
  s.at(1, 100);
  s.tick();
  ok(s.own.keeperOf(id) === 1 && s.added(1)[0] === id, '2: the one player in range keeps it, and is told so');
  s.clear();
  s.at(1, OWN_TUNING.range + 1);
  s.tick();
  ok(s.own.keeperOf(id) === 0 && s.dropped(1)[0] === id, '2: walking out of range takes it off them at once rather than leaving it behind');
  ok(s.own.keeps(1, id) === false, '2: and the server says so to anything that asks');
}

// --- 3: it changes hands only for somebody a quarter nearer, and only after three seconds ------------
{
  const s = server();
  const id = stand(s);
  s.at(1, 100);
  s.tick();
  ok(s.own.keeperOf(id) === 1, '3: the first player near it keeps it');
  s.clear();
  // A quarter nearer than 100 m is 75 m: 80 is nearer and is not enough.
  s.at(2, 80);
  s.wait(10000);
  ok(s.own.keeperOf(id) === 1 && s.added(2).length === 0, '3: somebody merely nearer never takes it, however long they stand there');
  s.at(2, 70);
  s.tick();
  ok(s.own.keeperOf(id) === 1, '3: a quarter nearer does not take it that instant either');
  s.wait(OWN_TUNING.steady - 500);
  ok(s.own.keeperOf(id) === 1, '3: nor a moment before the three seconds are up');
  s.wait(600);
  ok(s.own.keeperOf(id) === 2, '3: and does when they are');
  ok(s.dropped(1)[0] === id && s.added(2)[0] === id, '3: the one who had it is told to let go in the same breath the other is told to take it');
  ok(s.added(1).length === 0 && s.dropped(2).length === 0, '3: and nothing is ever granted twice or taken from somebody who never had it');
}

// --- 4: a challenger who falls back starts again ------------------------------------------------------
{
  const s = server();
  const id = stand(s);
  s.at(1, 100);
  s.tick();
  s.at(2, 70);
  s.wait(2000);
  ok(s.own.keeperOf(id) === 1, '4: two seconds a quarter nearer is not three');
  s.at(2, 90);
  s.wait(2000);
  s.at(2, 70);
  s.wait(2000);
  ok(s.own.keeperOf(id) === 1, '4: and a challenger who falls back and comes again starts their three seconds afresh');
  s.wait(3100);
  ok(s.own.keeperOf(id) === 2, '4: having stayed a quarter nearer for the whole three, it changes hands');
}

// --- 5: two players the same distance away never move it ----------------------------------------------
{
  const s = server();
  const id = stand(s);
  s.at(1, 60);
  s.at(2, -60);
  s.tick();
  const first = s.own.keeperOf(id);
  ok(first === 1 || first === 2, '5: one of two players either side of it keeps it');
  s.clear();
  for (let i = 0; i < 40; i++) s.wait(500);
  ok(s.own.keeperOf(id) === first, '5: and twenty seconds of standing exactly as far away each does not move it once');
  ok(s.to(1).length === 0 && s.to(2).length === 0, '5: nothing is sent to anybody while nothing changes');
}

// --- 6: a keeper that falls silent, or goes to sleep ---------------------------------------------------
{
  const s = server();
  const id = stand(s);
  s.at(1, 40);
  s.at(2, 120);
  s.tick();
  ok(s.own.keeperOf(id) === 1, '6: the nearer of the two keeps it');
  s.clear();
  // The nearer one says nothing at all from here; the far one goes on saying where it is.
  for (let i = 0; i < 4; i++) {
    s.wait(20000);
    s.at(2, 120);
  }
  ok(s.own.keeperOf(id) === 2, `6: a browser that has said nothing for ${Math.round(OWN_TUNING.silence / 1000)} s loses what it kept, and the far one has it`);
  ok(s.dropped(1)[0] === id, '6: and is told to let go, so nothing is left thinking for it twice');
  s.clear();
  s.at(1, 40);
  s.wait(500);
  ok(s.own.keeperOf(id) === 2, '6: a browser that comes back does not snatch it straight off whoever took it up');
  s.at(1, 40);
  s.wait(3100);
  ok(s.own.keeperOf(id) === 1, '6: it comes back to them under the same rule as anybody else, three seconds a quarter nearer');
  s.clear();
  s.do(s.own.awake(1, false) as Result);
  ok(s.own.keeperOf(id) === 2 && s.dropped(1)[0] === id, '6: and a tab that says it has been put to sleep loses it at once rather than a minute later');
  s.do(s.own.awake(1, true) as Result);
  ok(s.own.keeperOf(id) === 2, '6: waking up does not take it straight back: the one holding it is not a quarter further off');
}

// --- 7: a line that closes gives up everything it kept --------------------------------------------------
{
  const s = server();
  const a = stand(s);
  const b = stand(s);
  s.at(1, 10);
  s.at(2, 150);
  s.tick();
  ok(s.own.keeperOf(a) === 1 && s.own.keeperOf(b) === 1, '7: one player near two creatures keeps both');
  s.clear();
  s.do(s.own.gone(1) as Result);
  ok(s.own.keeperOf(a) === 2 && s.own.keeperOf(b) === 2, '7: a line closing hands everything it kept to whoever is left in range, at once');
  ok(s.own.listFor('tatooine ').length === 2, '7: and the creatures themselves stay: they belong to the world, not to whoever stood them');
}

// --- 8: a creature that dies while it is being handed over -----------------------------------------------
{
  const s = server();
  const id = stand(s);
  s.at(1, 100);
  s.tick();
  s.at(2, 60);
  s.wait(2000);
  ok(s.own.keeperOf(id) === 1, '8: the challenger is part way through its three seconds');
  s.clear();
  s.do(s.own.died(id) as Result);
  ok(s.own.keeperOf(id) === 0 && s.dropped(1)[0] === id, '8: a death in that moment takes the grant back from the one who had it');
  ok(s.added(2).length === 0, '8: and the one who was about to take it over never does');
  s.wait(10000);
  ok(s.own.keeperOf(id) === 0 && s.added(1).length === 0 && s.added(2).length === 0, '8: nothing picks a dead creature up again, however long anyone stands beside it');
  ok(s.own.alive(id) === false && s.own.listFor('tatooine ').length === 0, '8: it is not in the list a browser arriving is handed, so a death stays a death');
  ok((s.do(s.own.died(id) as Result)).ok === false, '8: and it cannot die twice');
}

// --- 9: the list is the server's ----------------------------------------------------------------------------
{
  const s = server();
  const a = stand(s);
  stand(s, 'naboo ');
  ok(s.own.listFor('tatooine ').length === 1 && s.own.listFor('naboo ').length === 1, '9: what stands on a world is that world\'s, and a browser is handed its own');
  const row = s.own.listFor('tatooine ')[0];
  ok(row.id === a && row.species === 'a_creature' && row.seed === 7 && row.at.length === 3, '9: each line carries what to stand, where and the seed every browser rolls its numbers from');
  const mine = s.do(s.own.spawn({ world: 'tatooine ', species: 'a_creature', at: [1, 0, 0], id: 'mine.1' }) as Result);
  ok(mine.row.id === 'mine.1', '9: an id the browser suggested is taken when it is free, so it knows its own again');
  const again = s.do(s.own.spawn({ world: 'tatooine ', species: 'a_creature', at: [2, 0, 0], id: 'mine.1' }) as Result);
  ok(again.ok === true && again.row.id !== 'mine.1', '9: and one that is taken is quietly given another rather than standing two things under one name');
  s.do(s.own.remove(a) as Result);
  ok(s.own.listFor('tatooine ').length === 2, '9: taking one down takes it out of the list');
  s.do(s.own.clearWorld('tatooine ') as Result);
  ok(s.own.listFor('tatooine ').length === 0 && s.own.listFor('naboo ').length === 1, '9: clearing a world clears that world and no other');
  const small = server({ world: 2 });
  stand(small);
  stand(small);
  ok((small.do(small.own.spawn({ world: 'tatooine ', species: 'a_creature', at: [0, 0, 0] }) as Result)).ok === false, '9: a world holds as many as it is allowed to and refuses the next with a reason');
}

// --- 10: a browser that has not said where it is keeps nothing ---------------------------------------------
{
  const s = server();
  const id = stand(s);
  s.own.here(1, 'tatooine ', null);
  s.tick();
  ok(s.own.keeperOf(id) === 0, '10: a browser that has arrived but not yet said where it stands is nowhere, and keeps nothing');
  s.at(1, 5);
  s.tick();
  ok(s.own.keeperOf(id) === 1, '10: its first state puts it on the world and it takes what is near it');
  s.clear();
  s.own.here(1, 'naboo ', null);
  s.tick();
  ok(s.own.keeperOf(id) === 0 && s.dropped(1)[0] === id, '10: and travelling to another world does not carry the place it was standing in the last one');
}

// --- 11: grants are batched, and cut into messages of a size ------------------------------------------------
{
  const s = server({ ids: 4 });
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(stand(s));
  s.at(1, 1);
  s.tick();
  ok(s.added(1).length === 10, '11: ten creatures at once are granted in one pass');
  ok(s.to(1).length === 3, '11: and go out in messages of a size rather than one message with a world in it');
  ok(s.to(1).every((m) => m.t === 'keep'), '11: every one of them is a grant and nothing else');
}

// --- 12: who may stand anything at all -----------------------------------------------------------------------
{
  const world = { players: { bbb: { first: 20 }, aaa: { first: 10 } }, settings: {} };
  ok(adminFor(world) === '', '12: a world that has written nobody down has no admin');
  ok(firstRegistered(world) === 'aaa', '12: the first player it ever registered is the one it falls back on');
  ok(firstRegistered({ players: {}, settings: {} }) === '', '12: and a world that has met nobody falls back on nobody');
  const named = { players: { aaa: { first: 10 } }, settings: { admin: 'aaa' } };
  ok(adminFor(named) === 'aaa' && isAdmin(named, 'aaa') === true && isAdmin(named, 'bbb') === false, '12: the one written down is the admin and nobody else is');
  ok(adminFor(named, 'bbb') === 'bbb' && isAdmin(named, 'bbb', 'bbb') === true && isAdmin(named, 'aaa', 'bbb') === false, '12: a name on the command line stands for the run over whatever is written down');
  ok(isAdmin(named, '', '') === false && isAdmin({ players: {}, settings: {} }, 'aaa') === false, '12: a browser that has not said who it is, and a world with no admin, are never admins');
  const tied = { players: { bbb: {}, aaa: {} }, settings: {} };
  ok(firstRegistered(tied) === firstRegistered({ players: { aaa: {}, bbb: {} }, settings: {} }), '12: two players with no stamp at all settle the same way every time the world is read back');
}

// --- 13: taking one down tells whoever was thinking for it -----------------------------------------
{
  const s = server();
  const a = stand(s);
  const b = stand(s);
  s.at(1, 5);
  s.tick();
  ok(s.own.keeperOf(a) === 1 && s.own.keeperOf(b) === 1, '13: one player beside two creatures keeps both');
  s.clear();
  s.do(s.own.remove(a) as Result);
  ok(s.dropped(1).includes(a), '13: an admin taking one down tells the browser that was thinking for it to let go, out of this module and not out of anything wrapped round it');
  s.clear();
  s.do(s.own.clearWorld('tatooine ') as Result);
  ok(s.dropped(1).includes(b), '13: and clearing a world tells it about every one it was keeping');
  ok(s.own.keptBy(1) === 0, '13: so nothing is left running a brain for something that is not there');
}

// --- 14: a kill that lands in the moment the creature changes hands -----------------------------------
{
  const s = server();
  const id = stand(s);
  s.at(1, 100);
  s.tick();
  ok(s.own.keeperOf(id) === 1, '14: the first player near it keeps it');
  s.at(2, 10);
  s.tick();
  s.wait(3100);
  ok(s.own.keeperOf(id) === 2, '14: and somebody a quarter nearer for three seconds takes it over');
  ok(s.own.mayKill(1, id) === true, '14: the browser that had it a moment ago may still say it died: it struck the blow and the grant crossed its word on the wire');
  ok(s.own.mayKill(3, id) === false, '14: a browser that never kept it may not say anything of the kind');
  ok(s.own.mayKill(2, id) === true, '14: and the one keeping it may, as it always could');
  s.wait(OWN_TUNING.grace + 1000);
  ok(s.own.mayKill(1, id) === false, '14: a long while later that word is no longer theirs to say');
  s.do(s.own.died(id) as Result);
  ok(s.own.alive(id) === false && s.own.listFor('tatooine ').length === 0, '14: so a kill in that moment lands rather than being lost, and the creature stays down');
  ok(s.own.mayKill(2, id) === false, '14: and nothing may kill it twice');
}

// --- 15: how much of a creature is left goes with the list ---------------------------------------------
{
  const s = server();
  const id = stand(s);
  ok(s.own.listFor('tatooine ')[0].hp === undefined, '15: a creature nobody has said anything about carries no share at all, which is not the same as a full one');
  s.at(1, 10);
  s.tick();
  ok(s.own.health(2, id, 0.5) === false, '15: a browser that does not keep it cannot say how much of it is left');
  ok(s.own.health(1, id, 0.4) === true && s.own.listFor('tatooine ')[0].hp === 0.4, '15: its keeper can, and the list a browser arriving is handed carries it, so nobody stands a fought creature up whole');
  s.own.health(1, id, 5);
  ok(s.own.listFor('tatooine ')[0].hp === 1, '15: a share is a share, whatever a browser on another build sends');
  s.own.health(1, id, Number.NaN);
  ok(s.own.listFor('tatooine ')[0].hp === 1, '15: and something that is not a number changes nothing');
}

console.log(`\n${checks} checks passed`);
