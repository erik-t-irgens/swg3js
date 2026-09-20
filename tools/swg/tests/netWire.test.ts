// Everything the server is told, through its checkers (server/wire.mjs): a good message, a missing
// field, a wrong type, an over-long name, an over-large list, a number that is not a number, and a
// word nobody knows. Plus the rooms that decide who hears what (server/rooms.mjs) and the world
// clock the hail carries (server/clock.mjs). Synthetic messages only.
import assert from 'node:assert/strict';
import { WIRE, cleanClaim, cleanEmote, cleanHello, cleanName, cleanNumber, cleanPing, cleanSettle, cleanState, cleanWord } from '../../../server/wire.mjs';
import { Rooms, roomKey, roomLabel } from '../../../server/rooms.mjs';
import { DAY_MS, WorldClock, dayFraction } from '../../../server/clock.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const hello = (extra: Record<string, unknown> = {}) => ({ t: 'hello', name: 'Han', species: 'human_male', class: 'jedi', planet: 'tatooine', ...extra });
const state = (extra: Record<string, unknown> = {}) => ({ t: 'state', p: [1, 2, 3], h: 0.5, s: 'run', v: 4, ...extra });
const claim = (extra: Record<string, unknown> = {}) => ({ t: 'claim', player: 'a'.repeat(16), proof: 'b'.repeat(64), character: 'char-1', name: 'Han', ...extra });

// --- 1: a hello ------------------------------------------------------------------------------------
{
  const clean = cleanHello(hello()) as Record<string, unknown>;
  ok(clean?.name === 'Han' && clean.planet === 'tatooine' && clean.zone === undefined, `1: who and where are kept (${JSON.stringify(clean)})`);
  ok(cleanHello(hello({ zone: 'space_tatooine' }))?.zone === 'space_tatooine', '1: a zone is kept when there is one');
  ok(cleanHello(hello({ class: 'bounty_hunter' }))?.class === 'bounty_hunter', '1: the other class is kept');
  ok(cleanHello(hello({ class: 'emperor' }))?.class === 'jedi', '1: a class nobody knows is a jedi');
  ok(cleanHello(hello({ name: 'x'.repeat(80) }))?.name.length === WIRE.name, '1: an over-long name is cut to length');
  ok(cleanHello(hello({ name: 'Han[0m' }))?.name === 'Han[0m', '1: control characters are taken out of a name');
  ok(cleanHello(hello({ name: '   ' }))?.name === 'someone', '1: a name of nothing but space is someone');
  ok(cleanHello(hello({ name: 42 }))?.name === 'someone', '1: a name that is not words is someone');
  ok(cleanHello(null) === undefined && cleanHello([1]) === undefined, '1: nothing, and a list, are not a hello');
}

// --- 2: a hello's look, hands and ship -------------------------------------------------------------
{
  const look = { morphs: { a: 1, b: 'x' }, values: { c: 2 }, height: 1.8, outfit: ['shirt_s03', 7] };
  const clean = cleanHello(hello({ look })) as { look: { morphs: Record<string, number>; outfit: string[] } };
  ok(clean.look.morphs.a === 1 && clean.look.morphs.b === undefined, '2: a shape number that is not a number is dropped');
  ok(clean.look.outfit.length === 2 && clean.look.outfit[1] === '7', '2: the outfit is kept as names');
  const many = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`m${i}`, i]));
  const big = cleanHello(hello({ look: { morphs: many, values: {}, height: 1, outfit: Array.from({ length: 200 }, () => 'a') } })) as { look: { morphs: Record<string, number>; outfit: string[] } };
  ok(Object.keys(big.look.morphs).length === WIRE.lookNumbers, `2: an over-large set of shape numbers is cut to ${WIRE.lookNumbers}`);
  ok(big.look.outfit.length === WIRE.outfit, `2: an over-long outfit is cut to ${WIRE.outfit}`);
  ok(cleanHello(hello({ look: { morphs: { a: 'x'.repeat(WIRE.look) }, values: {}, height: 1, outfit: [] } }))?.look === undefined, '2: a look too big to be one is dropped whole');
  const hands = cleanHello(hello({ held: { r: 'a_saber', l: 5 } })) as { held: { r: string; l?: string } };
  ok(hands.held.r === 'a_saber' && hands.held.l === undefined, '2: a weapon in hand is kept and a hand holding nonsense is empty');
  ok(cleanHello(hello({ held: {} }))?.held === undefined, '2: empty hands are not sent at all');
  const ship = cleanHello(hello({ ship: { id: 'xwing', fit: { components: { engine: 'a_part' }, paint: { 'a/b': 3 } } } })) as { ship: { id: string } };
  ok(ship.ship.id === 'xwing', '2: the ship is kept through the checker it already had');
  ok(cleanHello(hello({ ship: { id: '<script>' } }))?.ship === undefined, '2: a ship id that is not a name is dropped');
}

// --- 3: a state ------------------------------------------------------------------------------------
{
  const clean = cleanState(state()) as Record<string, unknown>;
  ok(JSON.stringify(clean) === JSON.stringify({ p: [1, 2, 3], h: 0.5, s: 'run', v: 4, m: false, sab: false }), `3: the place, heading, clip, speed and flags are kept (${JSON.stringify(clean)})`);
  ok(cleanState(state({ p: [1, 2] })) === undefined && cleanState(state({ p: [1, 2, Number.NaN] })) === undefined, '3: a place that is not three numbers is dropped whole');
  ok(cleanState(state({ h: 'north' }))?.h === 0, '3: a heading that is not a number is straight ahead');
  ok(cleanState(state({ s: 'x'.repeat(80) }))?.s.length === 32, '3: an over-long rig state is cut to length');
  ok(cleanState(state({ q: [0, 0, 0, 1] }))?.q?.length === 4 && cleanState(state({ q: [0, 0, 1] }))?.q === undefined, '3: a whole turn is four numbers or nothing');
  ok(cleanState(state({ j: 1 }))?.j === 1 && cleanState(state({ j: 2 }))?.j === undefined, '3: a jump is marked with a one and nothing else');
  ok(cleanState(state({ veh: { id: 'speeder', p: [0, 0, 0], q: [0, 0, 0, 1], role: 'ride' } }))?.veh?.id === 'speeder', '3: the vehicle goes through the checker it already had');
  const junk = cleanState(state({ health: 50, admin: true })) as Record<string, unknown>;
  ok(Object.keys(junk).join() === 'p,h,s,v,m,sab', `3: fields nobody knows are dropped (${Object.keys(junk).join()})`);
}

// --- 4: an emote -----------------------------------------------------------------------------------
{
  ok(cleanEmote({ clip: 'dance_18' }) === 'dance_18', '4: a clip name is kept');
  ok(cleanEmote({ clip: '' }) === '', '4: an empty clip is kept: it is how a dance ends');
  ok(cleanEmote({ clip: 'x'.repeat(80) })?.length === WIRE.clip, '4: an over-long clip name is cut to length');
  ok(cleanEmote({ clip: 5 }) === undefined && cleanEmote(null) === undefined, '4: a clip that is not words is dropped');
}

// --- 5: a claim ------------------------------------------------------------------------------------
{
  const clean = cleanClaim(claim()) as Record<string, unknown>;
  ok(clean?.player === 'a'.repeat(16) && clean.character === 'char-1' && clean.counter === 0, `5: the player, the character and a counter of none are kept (${JSON.stringify(clean)})`);
  ok(cleanClaim(claim({ key: 'c'.repeat(64) }))?.key === 'c'.repeat(64), '5: the verifier is kept on a first meeting');
  ok(cleanClaim(claim({ key: 'c'.repeat(63) }))?.key === undefined, '5: a verifier of the wrong length is dropped');
  ok(cleanClaim(claim({ word: 'd'.repeat(64) }))?.word === 'd'.repeat(64), '5: the join word\'s answer is kept');
  ok(cleanClaim(claim({ player: 'A'.repeat(16) })) === undefined, '5: a player id in capitals is not one of ours');
  ok(cleanClaim(claim({ player: 'a'.repeat(15) })) === undefined && cleanClaim(claim({ player: 'zzzz' })) === undefined, '5: a player id of the wrong length or with letters past f is refused');
  ok(cleanClaim(claim({ proof: 'b'.repeat(63) })) === undefined && cleanClaim(claim({ proof: 5 })) === undefined, '5: a claim with no proper proof is refused');
  ok(cleanClaim(claim({ character: '../../world' })) === undefined, '5: a character id that could be a path is refused');
  ok(cleanClaim(claim({ character: 'c'.repeat(WIRE.character + 1) })) === undefined, '5: an over-long character id is refused');
  ok(cleanClaim(claim({ counter: 7 }))?.counter === 7 && cleanClaim(claim({ counter: -3 }))?.counter === 0, '5: a change counter is kept and never goes below none');
  ok(cleanClaim(claim({ counter: 1e30 }))?.counter === WIRE.counter, '5: a counter beyond sense is clamped');
  ok(cleanClaim(claim({ counter: 'many' }))?.counter === 0, '5: a counter that is not a number is none');
  const about = cleanClaim(claim({ about: { species: 'rodian_male', class: 'bounty_hunter', planet: 'naboo', zone: '' } })) as { about: Record<string, string> };
  ok(about.about.species === 'rodian_male' && about.about.class === 'bounty_hunter' && about.about.zone === '', '5: the summary the merge compares is kept');
  ok(cleanClaim(claim({ about: 'all of it' }))?.about === undefined, '5: a summary that is not one is dropped');
  ok(cleanClaim({ t: 'claim' }) === undefined && cleanClaim(null) === undefined, '5: a claim with nothing in it is refused');
  // A character id is used as a key in the table the server keeps. These three are names that mean
  // something to every object in the language, so they are not allowed to be anybody's character.
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    ok(cleanClaim(claim({ character: bad })) === undefined, `5: a character called ${bad} is refused`);
  }
}

// --- 6: a ping and a settle ------------------------------------------------------------------------
{
  ok(cleanPing({ c: 1234 })?.c === 1234, '6: a ping carries the browser\'s own clock back');
  ok(cleanPing({ c: 'now' }) === undefined && cleanPing({}) === undefined, '6: a ping with no clock in it is dropped');
  ok(cleanSettle({ character: 'char-1', take: 'browser' })?.take === 'browser', '6: keeping the browser\'s copy is understood');
  ok(cleanSettle({ character: 'char-1', take: 'server' })?.take === 'server', '6: keeping the server\'s copy is understood');
  ok(cleanSettle({ character: 'char-1', take: 'both' }) === undefined, '6: a word nobody knows is dropped');
  ok(cleanSettle({ take: 'browser' }) === undefined, '6: a settle that names no character is dropped');
  ok(cleanSettle({ character: '__proto__', take: 'browser' }) === undefined, '6: and the names that are not allowed to be characters are refused here too');
}

// --- 7: the small checkers ------------------------------------------------------------------------
{
  ok(cleanName(undefined) === 'someone' && cleanName('Leia') === 'Leia', '7: a name is a name, or someone');
  ok(cleanWord(undefined, 'human_male') === 'human_male', '7: a missing word falls back');
  ok(cleanNumber('3.5') === 3.5 && cleanNumber(Number.POSITIVE_INFINITY) === 0 && cleanNumber({}) === 0, '7: a number is finite or it is none');
}

// --- 8: the rooms that decide who hears what --------------------------------------------------------
{
  const rooms = new Rooms();
  const tat = roomKey('tatooine', undefined);
  const space = roomKey('tatooine', 'space_tatooine');
  ok(tat !== space, '8: a planet and its own space are not the same world');
  ok(roomKey('tatooine', '') === roomKey('tatooine', undefined), '8: no zone and an empty zone are the same world, as the browser compares them');
  ok(roomLabel(space) === 'tatooine/space_tatooine' && roomLabel(tat) === 'tatooine', `8: a room reads plainly in a log line (${roomLabel(space)})`);
  ok(rooms.set(1, tat).from === null, '8: the first world a player is on follows nothing');
  rooms.set(2, tat);
  rooms.set(3, space);
  ok(rooms.members(tat).size === 2 && rooms.members(space).size === 1, '8: everyone is in their own world');
  ok(rooms.others(1).join() === '2', '8: who a player\'s news goes to leaves the player out');
  const move = rooms.set(1, space);
  ok(move.from === tat && move.to === space, '8: a travel says which world was left and which was come to');
  ok(rooms.members(tat).size === 1 && rooms.members(space).size === 2, '8: and the two worlds have moved them across');
  ok(rooms.keyOf(1) === space, '8: a player knows the world they are on');
  ok(rooms.leave(2) === tat && rooms.keyOf(2) === null, '8: leaving takes a player out of their world');
  ok(rooms.size === 1 && rooms.describe() === 'tatooine/space_tatooine 2', `8: an empty world is not kept (${rooms.describe()})`);
  ok(rooms.leave(99) === null && rooms.members('nowhere').size === 0, '8: a player who was never here leaves nothing behind');
}

// --- 9: the world clock ----------------------------------------------------------------------------
{
  ok(DAY_MS === 720000, '9: a day is the game\'s own 720 seconds');
  ok(dayFraction(0, 0) === 0 && Math.abs(dayFraction(DAY_MS / 2, 0) - 0.5) < 1e-9, '9: half a day in is noon');
  ok(dayFraction(DAY_MS * 3.25, 0) === 0.25, '9: the day comes round again');
  ok(Math.abs(dayFraction(0, DAY_MS / 4) - 0.25) < 1e-9, '9: a planet\'s own phase moves its day, so they are not all at noon together');
  ok(dayFraction(-DAY_MS / 4, 0) === 0.75, '9: a clock before the epoch still reads a time of day rather than a negative one');
  ok(dayFraction(Number.NaN, 0) === 0 && dayFraction(0, 0, 0) === 0, '9: a clock that is not a number reads midnight rather than throwing');
  let fake = 1000;
  const clock = new WorldClock({ epoch: 400, now: () => fake });
  ok(clock.now() === 1000 && clock.elapsed() === 600, '9: the clock reads what it is given and knows how old the world is');
  fake = DAY_MS / 2;
  ok(Math.abs(clock.dayFraction(0) - 0.5) < 1e-9, '9: and the time of day follows it');
  const hand = clock.hand();
  ok(hand.now === DAY_MS / 2 && hand.epoch === 400 && hand.dayMs === DAY_MS, `9: the hail carries the clock, the epoch and the length of a day (${JSON.stringify(hand)})`);
  ok(/clock .* world .* a day is 720 s/.test(clock.describe()), `9: and it says so plainly in the log (${clock.describe()})`);
}

console.log(`\n${checks} checks passed`);
