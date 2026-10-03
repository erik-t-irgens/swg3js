// Who thinks for a creature (server/ownership.mjs), and who may stand one at all
// (server/identity.mjs): the nearest player within the design's 180 m keeps it, it changes hands only
// when somebody else has been a quarter nearer for three seconds together, two players the same
// distance away never move it, a keeper that falls silent or goes to sleep loses everything it kept,
// and a creature that dies in the middle of being handed over is handed to nobody. Everything a
// browser can send goes through its checker first. The seen ones -- the lairs, nests and people every
// browser seeds for itself -- are held once whoever says it, only under their three kinds of name, kept
// only by a browser with a body for them, dead until their own respawn and then forgotten, and forgotten
// too once nobody keeps or sees them. Synthetic players only; no sockets and no clock but the one
// handed in, so every rule can be stepped by hand.
import assert from 'node:assert/strict';
import { OWN_TUNING, Ownership, SEEN_PREFIXES, cleanId, cleanKeep, cleanSpawn, cleanTemplate, mayBlow, maySee, maySpawn, seenId } from '../../../server/ownership.mjs';
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
    /** Move the clock on and work nothing out: a word arriving between two of the relay's passes. */
    skip(ms: number) {
      t += ms;
    },
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

// --- 16: what a browser may say about the ones it seeds for itself ---------------------------------------
{
  const seen = cleanSpawn({ t: 'spawn', do: 'seen', id: 'wild:tatooine:3:1', at: [1, 2, 3], r: 300 });
  ok(seen?.do === 'seen' && seen.id === 'wild:tatooine:3:1' && seen.at[1] === 2 && seen.r === 300, '16: saying one has been seen names it, where it stands and how long it stays down');
  ok(cleanSpawn({ t: 'spawn', do: 'seen', id: 'k4', at: [0, 0, 0] }) === undefined, '16: a name an admin\'s creature goes by is not one a browser may say it has seen');
  ok(cleanSpawn({ t: 'spawn', do: 'seen', id: 'travel:tatooine:1', at: [0, 0, 0] }) === undefined && cleanSpawn({ t: 'spawn', do: 'seen', id: 'ours:x', at: [0, 0, 0] }) === undefined, '16: nor is a ticket collector\'s or one of ours, which nobody may strike');
  ok(cleanSpawn({ t: 'spawn', do: 'seen', id: 'wild:', at: [0, 0, 0] }) === undefined, '16: and a bare prefix names nothing');
  ok(cleanSpawn({ t: 'spawn', do: 'seen', id: 'stood:naboo:2' }) === undefined, '16: one with nowhere to stand is dropped');
  ok(cleanSpawn({ t: 'spawn', do: 'seen', id: 'camp:naboo:2', at: [0, 0, 0], r: 1e12 })?.r === OWN_TUNING.respawnMax / 1000, '16: a respawn past an hour is an hour');
  ok(cleanSpawn({ t: 'spawn', do: 'seen', id: 'camp:naboo:2', at: [0, 0, 0], r: 'x' })?.r === 0, '16: and one that is not a number is none');
  ok(cleanSpawn({ t: 'spawn', do: 'unseen', id: 'wild:a' })?.do === 'unseen' && cleanSpawn({ t: 'spawn', do: 'taken', id: 'wild:a' })?.do === 'taken', '16: putting one down and walking off with one each name it');
  const dead = cleanSpawn({ t: 'spawn', do: 'dead', id: 'k3', by: [4, 4, 7, -1, 1.5, 'x', 0, 9, 10, 11, 12, 13, 14, 15, 16] });
  ok(JSON.stringify(dead?.by) === '[4,7,9,10,11,12,13,14]', `16: who struck it is a few relay ids, each once, and nothing else (${JSON.stringify(dead?.by)})`);
  ok(cleanSpawn({ t: 'spawn', do: 'dead', id: 'k3', by: 'everyone' })?.by === undefined, '16: and a list that is not one names nobody');
  ok(cleanSpawn({ t: 'spawn', do: 'add', species: 'a_creature', at: [0, 0, 0], weapon: 'object/weapon/ranged/rifle/rifle_e11.iff' })?.weapon === 'object/weapon/ranged/rifle/rifle_e11.iff', '16: an admin may put a weapon in a creature\'s hand as it is stood');
  ok(cleanSpawn({ t: 'spawn', do: 'add', species: 'a_creature', at: [0, 0, 0], weapon: '../../etc/passwd' })?.weapon === undefined && cleanSpawn({ t: 'spawn', do: 'add', species: 'a_creature', at: [0, 0, 0], weapon: 'a b' })?.weapon === undefined, '16: and a path that climbs out, or is not a path, is no weapon');
  ok(cleanTemplate(7) === '' && cleanTemplate('x'.repeat(200)) === '', '16: a weapon is a short string or nothing');
  ok(seenId('wild:a') && seenId('stood:a') && seenId('camp:a') && !seenId('travel:a') && !seenId('k1') && !seenId(7), '16: exactly three kinds of name are the seen ones');
  ok(SEEN_PREFIXES.length === 3, '16: and they are the lairs\', the people\'s and the nests\'');
  const window = { at: 0, lines: 0 };
  let through = 0;
  for (let i = 0; i < 40; i++) if (maySee(window, 5000)) through++;
  ok(through === OWN_TUNING['seen.perSecond'], `16: one browser may say it has seen ${OWN_TUNING['seen.perSecond']} in a second, apart from the spawn allowance`);
}

// --- 17: seen once, whoever says it, and never in the list a browser is handed ------------------------------
{
  const s = server();
  s.at(1, 10);
  s.at(2, 20);
  const first = s.do(s.own.sight(1, 'tatooine ', 'wild:t:1:0', [0, 0, 0], 60000) as Result & { created?: boolean });
  ok(first.ok && (first as { created?: boolean }).created === true, '17: the first browser to say it has stood one makes the record');
  ok(s.own.keeperOf('wild:t:1:0') === 1 && s.added(1)[0] === 'wild:t:1:0', '17: and, the only one with a body for it, keeps it at once');
  const second = s.do(s.own.sight(2, 'tatooine ', 'wild:t:1:0', [0, 0, 0], 60000) as Result & { created?: boolean });
  ok(second.ok && (second as { created?: boolean }).created !== true, '17: a second browser saying the same only joins it');
  ok(s.own.counts().seen === 1, '17: so there is one creature and not two');
  ok(s.added(2).length === 0, '17: and the second is not handed it while the first, nearer, has it');
  ok(s.own.listFor('tatooine ').length === 0, '17: a seen one is never in the list a browser arriving stands from: every browser stands its own');
  s.do(s.own.clearWorld('tatooine ') as Result);
  ok(s.own.alive('wild:t:1:0'), '17: and an admin clearing the world takes down what the admin stood, not the world\'s own lairs');
}

// --- 18: only the seeded kinds, and never a name an admin's creature has -----------------------------------
{
  const s = server();
  s.at(1, 0);
  ok(s.do(s.own.sight(1, 'tatooine ', 'travel:t:1', [0, 0, 0], 0) as Result).ok === false, '18: a ticket collector is never on the list');
  ok(s.do(s.own.sight(1, 'tatooine ', 'k1', [0, 0, 0], 0) as Result).ok === false, '18: nor is an admin\'s kind of name');
  ok(s.own.counts().seen === 0, '18: so neither made a record');
  const made = s.do(s.own.spawn({ world: 'tatooine ', species: 'a_creature', at: [0, 0, 0], id: 'stood:t:4' }) as Result);
  ok(made.row.id !== 'stood:t:4', '18: an admin asking for a seeded name is given another, so one name is never two creatures');
  s.do(s.own.sight(1, 'tatooine ', 'stood:t:5', [0, 0, 0], 0) as Result);
  s.clear();
  const elsewhere = s.do(s.own.sight(1, 'naboo ', 'stood:t:5', [0, 0, 0], 0) as Result);
  ok(elsewhere.ok === false && s.to(1).some((m) => m.t === 'spawn' && m.do === 'local' && m.id === 'stood:t:5'), '18: the same name said from another world is told to keep its body to itself');
}

// --- 19: only a browser with a body for it keeps it, however near anybody else is ---------------------------
{
  const s = server();
  s.at(1, 500);
  s.at(2, 1);
  s.do(s.own.sight(1, 'tatooine ', 'wild:t:2:0', [0, 0, 0], 0) as Result);
  s.tick();
  ok(s.own.keeperOf('wild:t:2:0') === 1, '19: a browser five hundred metres off that has a body for it keeps it, past the 180 m an admin\'s needs');
  s.wait(10000);
  ok(s.own.keeperOf('wild:t:2:0') === 1 && s.added(2).length === 0, '19: and a browser right beside it that never stood one is never handed it');
  s.do(s.own.sight(2, 'tatooine ', 'wild:t:2:0', [0, 0, 0], 0) as Result);
  s.wait(OWN_TUNING.steady + 600);
  ok(s.own.keeperOf('wild:t:2:0') === 2, '19: once it says it has one, it takes it over by the same quarter-nearer rule as anything else');
}

// --- 20: putting one down hands it on at once -----------------------------------------------------------------
{
  const s = server();
  s.at(1, 5);
  s.at(2, 50);
  s.do(s.own.sight(1, 'tatooine ', 'stood:t:9', [0, 0, 0], 0) as Result);
  s.do(s.own.sight(2, 'tatooine ', 'stood:t:9', [0, 0, 0], 0) as Result);
  ok(s.own.keeperOf('stood:t:9') === 1, '20: the nearer of two browsers with a body keeps it');
  s.clear();
  s.do(s.own.unsee(1, 'stood:t:9') as Result);
  ok(s.own.keeperOf('stood:t:9') === 2 && s.dropped(1).includes('stood:t:9') && s.added(2).includes('stood:t:9'), '20: the keeper putting its body down hands it to the other at once, with no three seconds');
  s.clear();
  s.at(1, 1);
  s.wait(10000);
  ok(s.own.keeperOf('stood:t:9') === 2, '20: and walking back beside it is not having a body for it again until it says so');
  s.do(s.own.gone(2) as Result);
  ok(s.own.keeperOf('stood:t:9') === 0, '20: the last body going takes the keeper with it');
}

// --- 20b: a browser that went to another world and came back has a body for none of what it left -----------------
{
  // Asked of the very case the rule is for: no line closing, no word put down -- it went to another world
  // (where it put every body of this one down with the world) and came back, and has said nothing since.
  const s = server();
  s.at(1, 5);
  s.at(2, 50);
  s.do(s.own.sight(1, 'tatooine ', 'stood:t:19', [0, 0, 0], 0) as Result);
  s.do(s.own.sight(2, 'tatooine ', 'stood:t:19', [0, 0, 0], 0) as Result);
  ok(s.own.keeperOf('stood:t:19') === 1, '20b: the nearer of two browsers with a body keeps it');
  s.at(2, 50, 0, 0, 'naboo ');
  s.tick();
  s.at(2, 50);
  s.tick();
  s.clear();
  s.do(s.own.unsee(1, 'stood:t:19') as Result);
  s.wait(OWN_TUNING.steady + 600);
  ok(s.own.keeperOf('stood:t:19') === 0 && !s.added(2).includes('stood:t:19'), '20b: so when the other puts its body down nobody keeps it, rather than a browser that has no body for it any more');
}

// --- 21: dead stays dead for its own respawn, and is then forgotten -------------------------------------------
{
  const s = server();
  s.at(1, 5);
  s.at(2, 6);
  s.do(s.own.sight(1, 'tatooine ', 'camp:t:3', [0, 0, 0], 30000) as Result);
  const end = s.do(s.own.died('camp:t:3') as Result) as Result & { back?: number };
  ok(end.ok && end.back === 30, `21: a seen one that dies is held down for the respawn it was seen with, and says so (${end.back} s)`);
  ok(s.own.alive('camp:t:3') === false && s.own.keeperOf('camp:t:3') === 0, '21: nobody keeps it while it is down');
  s.clear();
  s.do(s.own.sight(2, 'tatooine ', 'camp:t:3', [0, 0, 0], 30000) as Result);
  const told = s.to(2).find((m) => m.t === 'spawn' && m.do === 'gone');
  ok(told?.id === 'camp:t:3' && told.why === 'dead' && told.back >= 1 && told.back <= 30, '21: a browser saying it has stood it meanwhile is told it is dead, and for how much longer, so its copy goes down rather than up whole');
  ok(s.own.counts().seen === 0 && s.own.counts().seenDead === 1, '21: and the record stays one dead creature');
  s.wait(29000);
  ok(s.own.creatures.has('camp:t:3'), '21: a moment before its respawn is out it is still held');
  s.wait(1500);
  ok(!s.own.creatures.has('camp:t:3'), '21: and when it is out it is forgotten, telling nobody: everybody was told how long it would be');
  const again = s.do(s.own.sight(2, 'tatooine ', 'camp:t:3', [0, 0, 0], 30000) as Result) as Result & { created?: boolean };
  ok(again.created === true && s.own.alive('camp:t:3'), '21: so the next browser to stand it stands it whole, a fresh life');
}

// --- 22: one nobody keeps and nobody sees is forgotten ----------------------------------------------------------
{
  const s = server();
  s.at(1, 5);
  s.do(s.own.sight(1, 'tatooine ', 'wild:t:5:1', [0, 0, 0], 0) as Result);
  for (let i = 0; i < 8; i++) {
    s.at(1, 5);
    s.wait(20000);
  }
  ok(s.own.alive('wild:t:5:1') && s.own.keeperOf('wild:t:5:1') === 1, '22: one that is being kept is never forgotten, however long');
  s.do(s.own.unsee(1, 'wild:t:5:1') as Result);
  s.wait(OWN_TUNING.forget - 1000);
  ok(s.own.creatures.has('wild:t:5:1'), '22: put down by everybody, it is held a while, so a browser walking back stands it as it was left');
  s.wait(2000);
  ok(!s.own.creatures.has('wild:t:5:1'), `22: and after ${OWN_TUNING.forget / 1000} s with nobody keeping or seeing it, it is forgotten`);
}

// --- 23: walked off with a player --------------------------------------------------------------------------------
{
  const s = server();
  s.at(1, 5);
  s.do(s.own.sight(1, 'tatooine ', 'stood:t:11', [0, 0, 0], 60000) as Result);
  const end = s.own.taken('stood:t:11') as Result & { back?: number };
  ok(end.ok && end.back === 60 && s.own.alive('stood:t:11') === false, '23: a seen person who becomes a follower leaves their post empty for their own respawn');
  s.clear();
  s.do(s.own.sight(1, 'tatooine ', 'stood:t:11', [0, 0, 0], 60000) as Result);
  ok(s.to(1).some((m) => m.do === 'gone' && m.why === 'taken'), '23: and a browser standing their post again meanwhile is told they were taken, not killed');
  const admin = stand(s);
  ok(s.own.taken(admin).ok === true && s.own.listFor('tatooine ').length === 0, '23: an admin\'s one that walks off is simply gone from the list');
}

// --- 24: a world with no room left ---------------------------------------------------------------------------------
{
  const s = server({ seenPerWorld: 2 });
  s.at(1, 5);
  s.do(s.own.sight(1, 'tatooine ', 'wild:a:1', [0, 0, 0], 0) as Result);
  s.do(s.own.sight(1, 'tatooine ', 'wild:a:2', [0, 0, 0], 0) as Result);
  s.clear();
  const full = s.do(s.own.sight(1, 'tatooine ', 'wild:a:3', [0, 0, 0], 0) as Result);
  ok(full.ok === false && s.to(1).some((m) => m.do === 'local' && m.id === 'wild:a:3'), '24: past the world\'s share the browser is told to keep that body to itself, as every body was before');
  ok(s.do(s.own.sight(1, 'naboo ', 'wild:b:1', [0, 0, 0], 0) as Result).ok === true, '24: and the share is a world\'s, not the server\'s');
}

// --- 25: a weapon an admin put in a creature's hand goes with its row -------------------------------------------------
{
  const s = server();
  const made = s.do(s.own.spawn({ world: 'tatooine ', species: 'a_creature', at: [0, 0, 0], weapon: 'object/weapon/melee/sword/sword_01.iff' }) as Result);
  ok(made.row.weapon === 'object/weapon/melee/sword/sword_01.iff' && s.own.listFor('tatooine ')[0].weapon === made.row.weapon, '25: a creature stood with a weapon carries it in its row, so every browser arms it alike');
  const plain = s.do(s.own.spawn({ world: 'tatooine ', species: 'a_creature', at: [0, 0, 0] }) as Result);
  ok(plain.row.weapon === undefined, '25: and one stood with none says nothing about it');
}

// --- 26: a grant handed back is let go of on both sides --------------------------------------------------------
{
  const s = server();
  const id = stand(s);
  s.at(1, 10);
  s.tick();
  ok(s.own.keeperOf(id) === 1, '26: the one browser near it keeps it');
  s.clear();
  s.do(s.own.refuse(1, id) as Result);
  ok(s.own.keeperOf(id) === 0 && s.dropped(1).includes(id), '26: one that says it cannot keep it is told to let go, so it is not left holding a grant the server has taken back');
  for (let t = 0; t < 60000; t += 20000) {
    s.at(1, 10);
    s.wait(20000);
  }
  ok(s.added(1).length === 0, '26: and is not offered it again for a while');
  for (let t = 0; t < OWN_TUNING.refusal; t += 20000) {
    s.at(1, 10);
    s.wait(20000);
  }
  ok(s.own.keeperOf(id) === 1, '26: after which it is, as before');
}

// --- 27: a respawn that runs out between two passes -------------------------------------------------------------
{
  // Browsers stand their copy again the moment the wait they were told is out, which is the very moment a
  // word lands between two of the relay's passes. Answered from the old record, the fresh body was killed
  // on arrival and made to wait its whole respawn again.
  const s = server();
  s.at(1, 5);
  s.do(s.own.sight(1, 'tatooine ', 'wild:t:7:0', [0, 0, 0], 30000) as Result);
  s.tick();
  s.do(s.own.died('wild:t:7:0') as Result);
  s.tick();
  s.clear();
  s.skip(10000);
  s.do(s.own.sight(1, 'tatooine ', 'wild:t:7:0', [0, 0, 0], 30000) as Result);
  const still = s.to(1).find((m) => m.do === 'gone');
  ok(still?.why === 'dead' && still.fresh === 1 && still.back >= 19 && still.back <= 20, `27: inside its wait a browser saying it has stood one is told, alone, that it is still down and that this is about the body it has just stood (${JSON.stringify(still)})`);
  s.clear();
  s.skip(20000);
  const again = s.do(s.own.sight(1, 'tatooine ', 'wild:t:7:0', [0, 0, 0], 30000) as Result) as Result & { created?: boolean };
  ok(again.created === true && s.own.alive('wild:t:7:0') && !s.to(1).some((m) => m.do === 'gone'), '27: and the instant its wait is out, before any pass has forgotten it, the same word stands a fresh life rather than killing the new body');
  s.tick();
  ok(s.own.keeperOf('wild:t:7:0') === 1, '27: which is kept like any other');
}

// --- 28: a browser that handed one back and then stands a body for it is offered it again -------------------------
{
  const s = server();
  s.at(1, 5);
  s.do(s.own.sight(1, 'tatooine ', 'wild:t:8:0', [0, 0, 0], 0) as Result);
  s.tick();
  s.do(s.own.refuse(1, 'wild:t:8:0') as Result);
  ok(s.own.keeperOf('wild:t:8:0') === 0, '28: one this browser said it could not keep goes back');
  s.do(s.own.sight(1, 'tatooine ', 'wild:t:8:0', [0, 0, 0], 0) as Result);
  s.tick();
  ok(s.own.keeperOf('wild:t:8:0') === 1, '28: and saying it has a body for it again is no longer a refusal: it is offered it at once, not two minutes later with the creature frozen meanwhile');
}

// --- 29: a creature's blow on another player is held to what the server can see -----------------------------------
{
  const s = server();
  const id = stand(s);
  s.at(1, 10);
  s.at(2, 60);
  s.tick();
  ok(s.own.keeperOf(id) === 1, '29: the nearer browser keeps an admin\'s creature');
  ok(s.own.mayStrike(1, id, 2) === true, '29: its keeper may say it bit a player standing within reach of it');
  ok(s.own.mayStrike(2, id, 1) === false, '29: a browser that does not keep it may not');
  ok(s.own.mayStrike(1, id, 1) === false, '29: and nothing bites the browser that is saying so');
  ok(s.own.mayStrike(1, id, 2, [OWN_TUNING.strike + 80, 0, 0]) === false, `29: nor a player farther than ${OWN_TUNING.strike} m from where it was last said to stand`);
  s.at(3, 5, 0, 0, 'naboo ');
  ok(s.own.mayStrike(1, id, 3) === false && s.own.mayStrike(1, id, 9) === false, '29: nor a player on another world, nor one the server has never heard of');
  s.do(s.own.sight(1, 'tatooine ', 'wild:t:9:0', [0, 0, 0], 0) as Result);
  s.tick();
  ok(s.own.keeperOf('wild:t:9:0') === 1 && s.own.mayStrike(1, 'wild:t:9:0', 2) === false, '29: a seen one bites only a player whose own browser has stood that very creature, so none can be made up beside anybody');
  s.do(s.own.sight(2, 'tatooine ', 'wild:t:9:0', [0, 0, 0], 0) as Result);
  ok(s.own.mayStrike(1, 'wild:t:9:0', 2) === true, '29: and does, once it has');
  const w = { at: 0, lines: 0 };
  let passed = 0;
  for (let k = 0; k < 40; k++) if (mayBlow(w, 5000, OWN_TUNING)) passed++;
  ok(passed === OWN_TUNING['blow.perSecond'], `29: one browser passes on at most ${OWN_TUNING['blow.perSecond']} of them a second`);
  ok(mayBlow(w, 6000, OWN_TUNING), '29: and more the next');
}

console.log(`\n${checks} checks passed`);
