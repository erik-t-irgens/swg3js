// Shots, hits, health and death across two browsers: the server's checkers
// (server/combatWire.mjs), the duels it holds, and the browser's own half of a fight
// (src/net/combatNet.ts), which is written with no three.js in it so it can be run here as it is.
//
// What is checked is what the owner's decisions say must be true: a shot fired on one screen exists
// on the other, it is flown there as a picture that hurts nothing, it is cut short where the one who
// fired it says it landed, a blade turning one away cancels exactly one shot and starts exactly one,
// health and death cross, damage between players is off until the server's switch or a duel says
// otherwise, and with no server nothing crosses at all. Synthetic messages only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMBAT_WIRE, Duels, cleanBlocked, cleanDied, cleanDuel, cleanEnd, cleanHealth, cleanHit, cleanShot, mayHurt } from '../../../server/combatWire.mjs';
import { COMBAT_TUNE, COMBAT_WORDS, CombatNet, shotKey, type ShotBolt, type WireShot } from '../../../src/net/combatNet.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const shot = (extra: Record<string, unknown> = {}) => ({ t: 'shot', n: 7, p: [1, 2, 3], d: [0, 0, 2], s: 58, l: 4, c: 0xff4a2a, z: 1, ...extra });

/** A bolt as the combat code hands one over: the numbers, and nothing of three.js. */
function bolt(o: Partial<ShotBolt> = {}): ShotBolt {
  return { pos: { x: 1, y: 2, z: 3 }, dir: { x: 0, y: 0, z: 1 }, speed: 58, life: 4, damage: 20, wire: 0, inert: false, source: { key: 1 }, color: 0xff4a2a, size: 1, frame: null, ...o };
}

/** A bolt flying in a hull's rooms: what stands for the hull's own frame is only ever read as "there is one". */
const IN_ROOMS = { matrix: 'the hull' } as unknown as object;

/** A fight with its own clock and a list of everything it tried to send. */
function fight(id = 1, { server = true, ff = false } = {}) {
  let clock = 0;
  const sent: Record<string, unknown>[] = [];
  const net = new CombatNet(() => clock);
  net.send = (msg) => sent.push(msg);
  net.authority = () => (server ? 'server' : 'me');
  net.selfId = () => id;
  net.friendlyFire = () => ff;
  // This browser's own shots are the ones whose shooter is key 1, as the player's own always is.
  net.isMine = (b) => (b.source?.key ?? 0) === 1;
  // The pack holds every effect: the browser that has fired this weapon before, which is the
  // ordinary case. Test 16 is the one that asks what happens when it has not.
  net.fxReady = () => true;
  return {
    net,
    sent,
    at(t: number) {
      clock = t;
    },
    of(t: string) {
      return sent.filter((m) => m.t === t);
    },
  };
}

// --- 1: a shot, checked ------------------------------------------------------------------------------
{
  const clean = cleanShot(shot()) as Record<string, unknown>;
  ok(!!clean && clean.n === 7 && clean.s === 58 && clean.l === 4, `1: a shot's number, speed and life are kept (${JSON.stringify(clean)})`);
  const d = clean.d as number[];
  ok(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-9, '1: the heading is made unit length, so nothing downstream has to');
  ok(cleanShot(shot({ p: [1, 2] })) === undefined && cleanShot(shot({ p: [1, 2, Number.NaN] })) === undefined, '1: a place that is not three numbers is dropped whole');
  ok(cleanShot(shot({ d: [0, 0, 0] })) === undefined, '1: a heading of nothing at all is not a shot');
  ok(cleanShot(shot({ p: [1e12, 0, 0] })) === undefined, '1: a place outside the world is dropped');
  ok((cleanShot(shot({ s: 1e9 })) as { s: number }).s === COMBAT_WIRE.speed, `1: an impossible speed is clamped to ${COMBAT_WIRE.speed}`);
  ok((cleanShot(shot({ l: 1e6 })) as { l: number }).l === COMBAT_WIRE.life, '1: a bolt that claims to live for ever is clamped');
  ok((cleanShot(shot({ z: 1e6 })) as { z: number }).z === COMBAT_WIRE.size, '1: an impossible size is clamped');
  ok((cleanShot(shot({ s: 'fast' })) as { s: number }).s === 0, '1: a speed that is not a number is nothing');
  ok(cleanShot(null) === undefined && cleanShot([1]) === undefined && cleanShot('bang') === undefined, '1: nothing, a list and a word are not a shot');
}

// --- 2: what a shot is drawn as, and where it is fired ------------------------------------------------
{
  const drawn = cleanShot(shot({ fx: 'appearance/pt_red.prt', rc: 19, hx: 'clienteffect/hit.cef', pk: 'weapons' })) as Record<string, unknown>;
  ok(drawn.fx === 'appearance/pt_red.prt' && drawn.rc === 19 && drawn.pk === 'weapons', `2: the game's own effect for the bolt is kept (${JSON.stringify(drawn)})`);
  ok((cleanShot(shot({ fx: 'a.prt', pk: 'nowhere' })) as { pk: string }).pk === 'ships', '2: a pack nobody knows is the ships pack');
  ok((cleanShot(shot({ fx: '../../etc/passwd' })) as { fx?: string }).fx === undefined, '2: a path that climbs out of the pack is dropped');
  ok((cleanShot(shot({ fx: '/etc/passwd' })) as { fx?: string }).fx === undefined, '2: and so is one that begins at the root');
  ok((cleanShot(shot({ fx: 'a'.repeat(400) })) as { fx?: string }).fx === undefined, '2: an over-long effect path is dropped');
  ok((cleanShot(shot({ fx: 'a.prt', rc: 1e9 })) as { rc: number }).rc === COMBAT_WIRE.tip, '2: a tip reaching for ever is clamped');
  ok((cleanShot(shot({ in: 4 })) as { in: number }).in === 4, '2: the hull a shot was fired inside is kept');
  ok((cleanShot(shot({ in: -2 })) as { in?: number }).in === undefined, '2: a hull that is not a connection is nobody’s');
  ok((cleanShot(shot({ g: 1e9 })) as { g: number }).g === COMBAT_WIRE.gravity, '2: an impossible fall is clamped');
  ok((cleanShot(shot({ g: 0 })) as { g?: number }).g === undefined, '2: a bolt that does not fall says nothing about falling');
}

// --- 3: the end, the hit, the block, the health and the death ------------------------------------------
{
  ok(JSON.stringify(cleanEnd({ n: 3, at: [1, 2, 3] })) === JSON.stringify({ n: 3, at: [1, 2, 3] }), '3: where a shot stopped is kept');
  ok(cleanEnd({ n: 3 }) === undefined, '3: an end with nowhere in it is not one');
  const hit = cleanHit({ to: 2, a: 20, at: [0, 1, 0], w: 'ship' }) as Record<string, unknown>;
  ok(hit.to === 2 && hit.a === 20 && hit.w === 'ship', `3: a hit names who, how much and what was struck (${JSON.stringify(hit)})`);
  ok(cleanHit({ to: 0, a: 20, at: [0, 0, 0] }) === undefined, '3: a hit against nobody is dropped');
  ok(cleanHit({ to: 2, a: 0, at: [0, 0, 0] }) === undefined, '3: a hit for nothing at all is dropped');
  ok((cleanHit({ to: 2, a: 1e12, at: [0, 0, 0] }) as { a: number }).a === COMBAT_WIRE.damage, '3: a blow claiming the world is clamped');
  ok((cleanHit({ to: 2, a: 5, at: [0, 0, 0], w: 'a\u0000b' }) as { w: string }).w === 'ab', '3: control characters are taken out of what was struck');
  ok(JSON.stringify(cleanBlocked({ of: 3, n: 9, at: [0, 0, 0] })) === JSON.stringify({ of: 3, n: 9, at: [0, 0, 0] }), '3: a block names whose shot, which, and where');
  ok(cleanBlocked({ n: 9, at: [0, 0, 0] }) === undefined, '3: a block that does not say whose shot it was is dropped');
  ok((cleanHealth({ hp: 2 }) as { hp: number }).hp === 1 && (cleanHealth({ hp: -5 }) as { hp: number }).hp === 0, '3: health is a share of the whole and stays inside it');
  ok((cleanHealth({ hp: 0, d: 1 }) as { d: number }).d === 1, '3: being down is carried');
  ok(cleanHealth({ hp: 'lots' }) === undefined, '3: health that is not a number is not health');
  ok(JSON.stringify(cleanDied({ by: 4 })) === JSON.stringify({ by: 4 }) && JSON.stringify(cleanDied({})) === '{}', '3: a death carries who struck the blow, or nobody');
  ok(cleanDuel({ do: 'ask', to: 2 })?.do === 'ask' && cleanDuel({ do: 'peace' }) === undefined, "3: the duel's own words, and no others");
}

// --- 4: who may hurt whom ------------------------------------------------------------------------------
{
  const duels = new Duels({ range: 128, now: () => 0 });
  ok(mayHurt(false, duels, 1, 2) === false, '4: with the switch off and no duel, one player cannot hurt another');
  ok(mayHurt(true, duels, 1, 2) === true, '4: with the switch on they can');
  ok(mayHurt(true, duels, 1, 1) === false, '4: nobody hurts themselves through this path');
  duels.ask(1, 2, 10);
  ok(mayHurt(false, duels, 1, 2) === false, '4: being asked for a duel is not being in one');
  duels.accept(2);
  ok(mayHurt(false, duels, 1, 2) === true && mayHurt(false, duels, 2, 1) === true, '4: a duel lets two players hurt each other with the switch off');
  ok(mayHurt(false, duels, 1, 3) === false, '4: and nobody else');
  duels.end(2);
  ok(mayHurt(false, duels, 1, 2) === false, '4: calling it off ends it for both');
}

// --- 5: the duels ---------------------------------------------------------------------------------------
{
  let clock = 0;
  const duels = new Duels({ range: 128, seconds: 60, now: () => clock });
  const refused = duels.ask(1, 2, 400);
  ok(refused.tell.length === 1 && refused.tell[0].to === 1 && (refused.tell[0].msg as { do: string }).do === 'refused', "5: asking from further than the client's own 128 m is refused, and only the asker is told");
  const asked = duels.ask(1, 2, 20);
  ok(asked.tell.length === 2 && asked.tell.some((l) => l.to === 2 && (l.msg as { do: string }).do === 'asked'), '5: an invitation to fight reaches the one asked');
  const declined = duels.decline(2);
  ok(declined.tell.some((l) => l.to === 1 && (l.msg as { do: string }).do === 'declined') && !declined.tell.some((l) => l.to !== 1 && l.to !== 2), '5: saying no is told to whoever asked, and to the two of them and nobody else');
  ok(duels.between(1, 2) === false, '5: and leaves no duel behind');
  // The two of them ask each other at the same moment: that is an agreement, not two waits.
  duels.ask(1, 2, 20);
  const crossed = duels.ask(2, 1, 20);
  ok(duels.between(1, 2) === true && crossed.tell.length === 2, '5: two people asking each other at once are simply fighting');
  const gone = duels.drop(2);
  ok(duels.between(1, 2) === false && gone.tell.length === 1 && gone.tell[0].to === 1, '5: a line closing ends its duels, and the one still there is told');
  duels.ask(1, 2, 20);
  duels.accept(2);
  clock = 61000;
  const lapsed = duels.tick();
  ok(duels.between(1, 2) === false && lapsed.tell.length === 2, '5: a duel nobody has said anything about for long enough ends itself');
  ok(JSON.stringify(duels.describe()) === JSON.stringify({ fighting: 0, asked: 0 }), '5: and nothing is left in the tables');
}

// --- 6: a shot crosses, and comes back as the same shot ---------------------------------------------------
{
  const a = fight(1);
  const b = fight(2);
  const flown: { shot: WireShot; key: number }[] = [];
  b.net.fly = (s, key) => {
    flown.push({ shot: s, key });
    return bolt({ inert: true, source: null });
  };
  const mine = bolt({ color: 0x3af06a, size: 1.5, projectile: { effect: 'a.prt', reach: 19, hit: 'b.cef', pack: 'weapons' } });
  a.net.fired(mine);
  ok(a.of('shot').length === 1, '6: a shot of this player’s goes out');
  ok(mine.wire !== 0, '6: and the bolt is marked with which shot it is');
  const wire = cleanShot(a.of('shot')[0]) as WireShot;
  ok(!!wire, '6: the server reads it');
  b.net.handle({ ...wire, t: 'shot', id: 1 });
  ok(flown.length === 1, '6: and the other browser flies a picture of it');
  const same = flown[0].shot;
  ok(same.s === 58 && same.l === 4 && same.c === 0x3af06a && same.z === 1.5, `6: at the same speed, life, colour and size (${JSON.stringify(same)})`);
  ok(same.fx === 'a.prt' && same.rc === 19 && same.hx === 'b.cef' && same.pk === 'weapons', '6: drawn as the game’s own effect for it');
  ok(Math.abs(same.p[0] - 1) < 1e-6 && Math.abs(same.d[2] - 1) < 1e-6, '6: from the same place along the same line');
  ok(flown[0].key === shotKey(1, wire.n), '6: and is known by whose shot it is and which');
}

// --- 7: a picture of a shot hurts nothing, and is cut short where the shooter says -------------------------
{
  const a = fight(1);
  const b = fight(2);
  let copy: ShotBolt | null = null;
  b.net.fly = () => (copy = bolt({ inert: true, damage: 0, source: null }));
  const cuts: number[][] = [];
  b.net.cut = (_bolt, x, y, z) => cuts.push([x, y, z]);
  a.net.fired(bolt());
  const wire = cleanShot(a.of('shot')[0]) as WireShot;
  b.net.handle({ ...wire, t: 'shot', id: 1 });
  ok(!!copy && copy!.inert === true && copy!.damage === 0, '7: the picture is inert and does no damage, so one trigger pull is never paid for twice');
  // The shooter's own bolt lands on a wall.
  a.net.ended(bolt({ wire: shotKey(1, wire.n) }), { x: 9, y: 1, z: 9 });
  const end = cleanEnd(a.of('end')[0]) as { n: number; at: number[] };
  ok(!!end && end.n === wire.n && end.at[0] === 9, `7: the shooter says where its bolt stopped (${JSON.stringify(end)})`);
  b.net.handle({ t: 'end', id: 1, ...end });
  ok(cuts.length === 1 && cuts[0][0] === 9 && cuts[0][2] === 9, '7: and the picture is cut short at that very point, so the mark is in one place on both screens');
  b.net.handle({ t: 'end', id: 1, ...end });
  ok(cuts.length === 1, '7: a word about a shot that has already gone does nothing');
  // A bolt that simply reached the end of its flight says nothing: it ends on its own everywhere.
  const missed = bolt({ wire: shotKey(1, 4242) });
  a.net.ended(missed, null);
  ok(a.of('end').length === 1, '7: a bolt that struck nothing is not worth a word');
}

// --- 8: a blade turns one away: one bolt in, one bolt out ---------------------------------------------------
{
  const b = fight(2);
  b.net.fly = () => bolt({ inert: true, source: null });
  b.net.handle({ ...(cleanShot(shot({ n: 5 })) as WireShot), t: 'shot', id: 1 });
  const copy = bolt({ wire: shotKey(1, 5), inert: true, source: null });
  const took = b.net.blockedHere(copy, 4, 1, 4);
  ok(took === true, '8: a blade takes a bolt that came off the wire over');
  const blocked = b.of('blocked');
  ok(blocked.length === 1, '8: exactly one word goes out about it');
  const read = cleanBlocked(blocked[0]) as { of: number; n: number };
  ok(read.of === 1 && read.n === 5, `8: naming whose shot it was and which (${JSON.stringify(read)})`);
  ok(b.net.blockedHere(bolt({ wire: 0 }), 0, 0, 0) === false, '8: a bolt that is nobody else’s is turned away the way it always was');
  ok(b.net.blockedHere(bolt({ wire: shotKey(2, 3) }), 0, 0, 0) === false, '8: and a player cannot block their own shot into a word');
  // The shooter hears it and stops its own real bolt at the blade.
  const a = fight(1);
  let cut = 0;
  a.net.cut = () => cut++;
  const real = bolt({ wire: shotKey(1, 5) });
  a.net.fly = () => real;
  a.net.handle({ ...(cleanShot(shot({ n: 5 })) as WireShot), t: 'shot', id: 1 });
  a.net.handle({ t: 'blocked', id: 2, of: 1, n: 5, at: [4, 1, 4] });
  ok(cut === 1, '8: the one real bolt stops where the blade met it');
}

// --- 9: being hurt, health and death -------------------------------------------------------------------------
{
  const me = fight(2, { ff: true });
  let hp = 1;
  let down = false;
  const taken: number[] = [];
  me.net.healthNow = () => ({ hp, down });
  me.net.onHurt = (amount, _x, _y, _z, from) => {
    taken.push(amount);
    hp = Math.max(0, hp - amount / 100);
    if (hp <= 0) down = true;
    void from;
  };
  me.net.handle({ t: 'hurt', id: 1, a: 35, at: [0, 0, 0] });
  ok(taken.length === 1 && taken[0] === 35, '9: the one hurt is the only place a number comes off');
  me.at(1);
  me.net.step(1);
  const health = cleanHealth(me.of('health')[0]) as { hp: number };
  ok(!!health && Math.abs(health.hp - 0.65) < 1e-6, `9: and their own health is what everybody else reads (${JSON.stringify(health)})`);
  me.at(2);
  me.net.step(1);
  ok(me.of('health').length === 1, '9: health that has not moved is not sent again');
  me.net.handle({ t: 'hurt', id: 1, a: 70, at: [0, 0, 0] });
  me.at(3);
  me.net.step(1);
  const died = cleanDied(me.of('died')[0]) as { by: number };
  ok(me.of('died').length === 1 && died.by === 1, '9: the one who fell says so, and says who struck the blow');
  ok((cleanHealth(me.of('health')[1]) as { d: number }).d === 1, '9: and goes over as down');
  me.at(4);
  me.net.step(1);
  ok(me.of('died').length === 1, '9: a death is announced once, not every time it is looked at');
  // Nothing hurt this player for a long while: the blow that killed them is nobody's.
  const later = fight(3, { ff: true });
  let hp2 = 1;
  later.net.healthNow = () => ({ hp: hp2, down: hp2 <= 0 });
  later.net.handle({ t: 'hurt', id: 1, a: 5, at: [0, 0, 0] });
  later.at(COMBAT_TUNE.blameSeconds + 5);
  hp2 = 0;
  later.net.step(1);
  ok(JSON.stringify(cleanDied(later.of('died')[0])) === '{}', '9: a fall long after the last blow names nobody');
}

// --- 10: who may be hurt, and the rate ------------------------------------------------------------------------
{
  const peaceful = fight(1);
  ok(peaceful.net.sendHit(2, 20, 0, 0, 0) === false && peaceful.of('hit').length === 0, '10: with the switch off and no duel, a hit is not even sent');
  peaceful.net.handle({ t: 'duel', do: 'on', id: 2 });
  ok(peaceful.net.duelWith(2) === true && peaceful.net.mayHurt(2) === true, '10: a duel is what lets them hurt each other');
  ok(peaceful.net.sendHit(2, 20, 0, 0, 0) === true && peaceful.of('hit').length === 1, '10: and the hit goes');
  ok(peaceful.net.sendHit(3, 20, 0, 0, 0) === false, '10: to the one they are fighting and to nobody else');
  ok(peaceful.net.sendHit(2, 0, 0, 0, 0) === false, '10: a blow for nothing is not a hit');
  peaceful.net.handle({ t: 'duel', do: 'off', id: 2 });
  ok(peaceful.net.mayHurt(2) === false, '10: and when it is over they are at peace again');
  const open = fight(1, { ff: true });
  ok(open.net.mayHurt(2) === true && open.net.mayHurt(1) === false, '10: with the switch on anybody but yourself may be hurt');
  // The rate: a held trigger cannot fill the line with bolts.
  const fast = fight(1);
  for (let i = 0; i < COMBAT_TUNE.shotsPerSecond + 20; i++) fast.net.fired(bolt());
  ok(fast.of('shot').length === COMBAT_TUNE.shotsPerSecond, `10: no more than ${COMBAT_TUNE.shotsPerSecond} shots cross in a second`);
  fast.at(1.5);
  fast.net.fired(bolt());
  ok(fast.of('shot').length === COMBAT_TUNE.shotsPerSecond + 1, '10: and the next second begins again');
}

// --- 11: whose shots cross, and the hull they were fired in ------------------------------------------------------
{
  const a = fight(1);
  a.net.fired(bolt({ source: { key: 55 } }));
  ok(a.of('shot').length === 0, '11: a creature’s or a fighter’s bolt is this browser’s own business and does not cross');
  a.net.fired(bolt({ inert: true }));
  ok(a.of('shot').length === 0, '11: and a picture of somebody else’s shot never goes round again');
  a.net.hullNow = () => 4;
  a.net.fired(bolt({ frame: IN_ROOMS }));
  ok((cleanShot(a.of('shot')[0]) as { in: number }).in === 4, '11: a shot fired in a hull’s rooms says whose hull');
  // A multi-crew ship is flown from its bridge, so its pilot stands in its rooms while its guns
  // fire in the world. Asked of the player rather than of the bolt, every one of those was named a
  // hull's and let alone on every other screen.
  a.net.fired(bolt());
  ok((cleanShot(a.of('shot')[1]) as { in?: number }).in === undefined, '11: while a bolt fired in the world names no hull, whatever room the one who fired it is standing in');
  const b = fight(2);
  let flew = 0;
  b.net.fly = () => {
    flew++;
    return bolt({ inert: true, source: null });
  };
  b.net.handle({ ...(cleanShot(shot({ in: 4 })) as WireShot), t: 'shot', id: 1 });
  ok(flew === 0, '11: and a browser standing somewhere else lets it alone rather than drawing it in the open air');
  b.net.hullNow = () => 4;
  b.net.handle({ ...(cleanShot(shot({ in: 4 })) as WireShot), t: 'shot', id: 1 });
  ok(flew === 1, '11: while one standing in the same hull flies it in the hull’s own frame');
  // As many pictures as there may be, and no more.
  const many = fight(2);
  many.net.fly = () => bolt({ inert: true, source: null });
  for (let i = 1; i <= COMBAT_TUNE.copies + 10; i++) many.net.handle({ ...(cleanShot(shot({ n: i })) as WireShot), t: 'shot', id: 1 });
  ok(many.net.debug().copies === COMBAT_TUNE.copies, `11: no more than ${COMBAT_TUNE.copies} pictures of other people's bolts are in the air at once`);
}

// --- 12: with no server, the whole thing is quiet ------------------------------------------------------------------
{
  const alone = fight(1, { server: false });
  let flew = 0;
  alone.net.fly = () => {
    flew++;
    return bolt();
  };
  const mine = bolt();
  alone.net.fired(mine);
  alone.net.ended(bolt({ wire: shotKey(1, 1) }), { x: 0, y: 0, z: 0 });
  alone.net.step(1);
  ok(alone.sent.length === 0 && mine.wire === 0, '12: with no server nothing is sent and no bolt is marked');
  ok(alone.net.sendHit(2, 20, 0, 0, 0) === false, '12: and nobody can be hurt');
  ok(alone.net.blockedHere(bolt({ wire: shotKey(2, 1) }), 0, 0, 0) === false, '12: a block is the local one it has always been');
  ok(alone.net.mayHurt(2) === false && alone.net.active === false, '12: the whole module says so');
  void flew;
}

// --- 13: a line that dropped leaves nothing behind ---------------------------------------------------------------------
{
  const me = fight(2);
  me.net.fly = () => bolt({ inert: true, source: null });
  me.net.handle({ ...(cleanShot(shot()) as WireShot), t: 'shot', id: 1 });
  me.net.handle({ t: 'duel', do: 'on', id: 1 });
  ok(me.net.debug().copies === 1 && me.net.duelWith(1), '13: there is a picture in the air and a duel on');
  me.net.clear();
  ok(me.net.debug().copies === 0 && !me.net.duelWith(1) && me.net.mayHurt(1) === false, '13: and after the line drops there is neither');
  let cut = 0;
  me.net.cut = () => cut++;
  me.net.handle({ t: 'end', id: 1, n: 7, at: [0, 0, 0] });
  ok(cut === 0, '13: a word about a bolt from the world that has gone moves nothing');
  ok(me.net.handle({ t: 'group', do: 'roster' }) === false, '13: and a word that is not this module’s is left for whoever owns it');
}

// --- 14: the words the socket has to hand over -----------------------------------------------------------------------
{
  // Nothing of this module is heard unless `src/net/net.ts` hands the word over, and that file is
  // nobody's this wave: the change to it travels as a snippet. So what is checked here is that the
  // two lists agree -- all of them handed over or none of them -- which catches the half-applied
  // merge that would leave, say, a shot crossing and its end going nowhere.
  const net = readFileSync(new URL('../../../src/net/net.ts', import.meta.url), 'utf8');
  const handed = COMBAT_WORDS.filter((word) => net.includes(`case '${word}':`));
  ok(handed.length === 0 || handed.length === COMBAT_WORDS.length, `14: the socket hands over all of this module's words or none of them (${handed.length}/${COMBAT_WORDS.length}: ${handed.join(', ') || 'none yet'})`);
  if (handed.length === 0) console.log("     -- none yet: the snippet for src/net/net.ts in the hand-off has not been applied, and until it is nothing of a fight crosses");
  const answers = COMBAT_WORDS.every((word) => new CombatNet(() => 0).handle({ t: word }) === true);
  ok(answers, '14: and the module answers for every word on that list');
  ok(new CombatNet(() => 0).handle({ t: 'chat', text: 'hello' }) === false, '14: and for no other, so the group and the fight can share one hand-over');
}

// --- 15: the blow a bolt carries, and the one that comes back off a blade -----------------------------------------------
{
  const a = fight(1);
  const b = fight(2);
  let copy: ShotBolt | null = null;
  b.net.fly = (s) => (copy = bolt({ inert: true, damage: s.a ?? 0, source: null }));
  a.net.fired(bolt({ damage: 37 }));
  const wire = cleanShot(a.of('shot')[0]) as WireShot;
  ok(wire.a === 37, `15: a shot carries what it would take (${JSON.stringify(wire.a)})`);
  b.net.handle({ ...wire, t: 'shot', id: 1 });
  ok(!!copy && copy!.damage === 37, '15: so the bolt a blade fires back in its place hits as hard as the one that came in');
  ok((cleanShot(shot({ a: 1e12 })) as { a: number }).a === COMBAT_WIRE.damage, '15: a blow claiming the world is clamped on the way through');
  ok((cleanShot(shot({ a: 0 })) as { a?: number }).a === undefined, '15: and a bolt that would take nothing says nothing');
  // A bouncing bolt bounces on every screen.
  const c = fight(3);
  c.net.fired(bolt({ bounces: 3 }));
  ok((cleanShot(c.of('shot')[0]) as { b: number }).b === 3, '15: the walls a bolt may still glance off cross with it');
  ok((cleanShot(shot({ b: 1e6 })) as { b: number }).b === COMBAT_WIRE.bounces, '15: and a bolt that would bounce for ever is clamped');
}

// --- 16: what a picture of a bolt is drawn as ----------------------------------------------------------------------------
{
  const me = fight(2);
  const flown: WireShot[] = [];
  me.net.fly = (s) => {
    flown.push(s);
    return bolt({ inert: true, source: null });
  };
  // A weapon nobody here has ever fired: the effect is not ready, so the first bolt is a plain one
  // and nothing is built in the middle of the frame it arrived on.
  const ready = new Set<string>();
  me.net.fxReady = (file, pack) => ready.has(`${pack}/${file}`);
  me.net.handle({ ...(cleanShot(shot({ n: 1, fx: 'a.prt', rc: 19, hx: 'b.cef', pk: 'weapons' })) as WireShot), t: 'shot', id: 1 });
  ok(flown[0].fx === undefined && me.net.debug().plain === 1, '16: a bolt whose effect this browser has never loaded is flown as a plain one, and says so');
  ready.add('weapons/a.prt');
  me.net.handle({ ...(cleanShot(shot({ n: 2, fx: 'a.prt', rc: 19, hx: 'b.cef', pk: 'weapons' })) as WireShot), t: 'shot', id: 1 });
  ok(flown[1].fx === 'a.prt' && flown[1].hx === undefined, '16: once it is ready the bolt is drawn as the game draws it, and the hit effect waits for its own turn');
  ready.add('weapons/b.cef');
  me.net.handle({ ...(cleanShot(shot({ n: 3, fx: 'a.prt', rc: 19, hx: 'b.cef', pk: 'weapons' })) as WireShot), t: 'shot', id: 1 });
  ok(flown[2].hx === 'b.cef' && me.net.debug().plain === 1, '16: and then the whole of it, with nothing more flown plain');
  // The colours: every new one costs two materials for the life of the page, so there is a cap.
  const many = fight(2);
  many.net.fly = () => bolt({ inert: true, source: null });
  const seen: number[] = [];
  many.net.fly = (s) => {
    seen.push(s.c);
    return bolt({ inert: true, source: null });
  };
  for (let i = 1; i <= COMBAT_TUNE.colours + 10; i++) many.net.handle({ ...(cleanShot(shot({ n: i, c: 0x100000 + i })) as WireShot), t: 'shot', id: 1 });
  ok(new Set(seen).size === COMBAT_TUNE.colours + 1, `16: no more than ${COMBAT_TUNE.colours} colours are ever taken off the wire, and the rest are drawn plain`);
  ok(many.net.debug().recoloured === 10, '16: and it says how many it turned back');
}

// --- 17: the duels leave nobody waiting ---------------------------------------------------------------------------------
{
  let clock = 0;
  const duels = new Duels({ range: 128, seconds: 60, now: () => clock });
  duels.ask(1, 2, 20);
  const second = duels.ask(3, 2, 20);
  ok(second.tell.length === 1 && (second.tell[0].msg as { do: string }).do === 'refused', '17: a second challenge does not quietly throw away the first');
  const declined = duels.decline(2);
  ok(declined.tell.length === 2 && declined.tell.some((l) => l.to === 2 && (l.msg as { do: string }).do === 'off'), '17: saying no tells the one who said it as well, so their own browser is not left holding a challenge');
  duels.ask(1, 2, 20);
  const gone = duels.drop(1);
  ok(gone.tell.length === 1 && gone.tell[0].to === 2 && (gone.tell[0].msg as { do: string }).do === 'off', '17: a line closing tells whoever it had asked for a duel, so they are not waiting on nobody');
  ok(duels.describe().asked === 0, '17: and the table is empty afterwards');
  // The one who was asked can then be asked again, which is what the message above is for.
  const fresh = duels.ask(3, 2, 20);
  ok(fresh.tell.length === 2, '17: and they can be asked again');
}

// --- 18: coming back, and somebody new arriving ---------------------------------------------------------------------------
{
  const me = fight(2, { ff: true });
  let hp = 1;
  let down = false;
  me.net.healthNow = () => ({ hp, down });
  hp = 0;
  down = true;
  me.at(1);
  me.net.step(1);
  ok(me.of('died').length === 1, '18: the one who fell says so');
  // The line drops and comes back while they are still lying there.
  me.net.clear();
  me.at(2);
  me.net.step(1);
  ok(me.of('died').length === 1, '18: and a line that dropped and came back does not announce the same death again with nobody to blame for it');
  ok(me.of('health').length >= 1 && (cleanHealth(me.of('health').at(-1) as Record<string, unknown>) as { d: number }).d === 1, '18: while their health goes out again, so the ones who just met them know');
  // Somebody new: health is said again at the next look, because nothing else they are told carries it.
  const said = me.of('health').length;
  me.at(3);
  me.net.step(1);
  ok(me.of('health').length === said, '18: health that has not moved is not sent');
  me.net.announceHealth();
  me.at(4);
  me.net.step(1);
  ok(me.of('health').length === said + 1, '18: until somebody arrives, and then everyone says it once so the newcomer does not read them all as whole');
}

console.log(`\n${checks} checks passed`);
