// What a creature stood by hand is (src/world/spawnSeed.ts): the switch that keeps a planet's own
// wildlife off, the name every browser works out for itself rather than being told, and the rolls a
// record makes.
//
// The whole point of the module is that two browsers which have never spoken about a creature beyond
// its record stand the same creature, so almost everything here is the same question asked twice:
// the same record in, the same numbers out, in a different order, from a record rebuilt field by
// field, and with nothing of this machine's in any of it. The numbers themselves are pinned as
// literals as well -- a change to the generator that kept every record self-consistent but moved
// every creature would otherwise pass in silence, and it would be seen only as an evening where one
// player's banthas are all a little larger than another's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NOT_ADMIN,
  PendingSpawns,
  WAITING_FOR_CATALOGUE,
  WILDLIFE_KEY,
  WORLD_HOLDS_IT,
  armsRng,
  browserSwitches,
  decideStand,
  recordFits,
  recordFor,
  rngFor,
  roll,
  rollsFor,
  scaleFrom,
  seedFor,
  spawnArgsFor,
  spawnIdFor,
  spawnRefusal,
  wildlifeWanted,
  type SpawnRecord,
  type StandWhere,
} from '../../../src/world/spawnSeed.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// --- 1: the switch ----------------------------------------------------------------------------------
// Off is the answer to every question but the one word that turns it on, including the question asked
// by a browser that has no storage at all and by one whose storage throws.
{
  ok(wildlifeWanted({ get: () => null }) === false, '1: a browser that has never set it stands no wildlife');
  ok(wildlifeWanted({ get: () => '1' }) === true, '1: the switch on puts the planet’s own wildlife back');
  ok(wildlifeWanted({ get: () => '0' }) === false, '1: and anything else leaves it off');
  ok(wildlifeWanted({ get: () => 'true' }) === false, '1: including a word that looks like yes but is not the one');
  ok(
    wildlifeWanted({
      get: () => {
        throw new Error('no storage here');
      },
    }) === false,
    '1: a storage that throws (a private window, cleared data) is the same as one that says nothing',
  );
  // The default store is the guarded one; under node there is no localStorage at all, and asking must
  // answer rather than throw, since the world asks this on every arrival.
  ok(wildlifeWanted() === false, '1: with no storage of any kind the answer is still false');
  ok(browserSwitches().get(WILDLIFE_KEY) === null, '1: and the browser store answers nothing rather than throwing');
  ok(WILDLIFE_KEY === 'swg.wildlife', '1: the switch is the one name the summary and the world both use');
  // The world is the only place that asks, and it must ask before it looks at the catalogue: with the
  // switch off an arrival has to do exactly the work it did before and no more. These two are read
  // rather than run, and are the only two in this file that are: standing a planet up to watch an
  // arrival is the whole game, and there is nothing pure underneath that call to try instead.
  const world = src('../../../src/world/world.ts');
  ok(/wildlifeWanted\(\) && !this\.ambientFromCatalogue\(center\)/.test(world), '1: the world asks the switch first and short-circuits before the catalogue');
  ok(/this\.creatures\.spawnAround\(center\)/.test(world), '1: and the old path is still there to be turned back on');
}

// --- 2: the name ------------------------------------------------------------------------------------
{
  const a = spawnIdFor('tatooine', 'abc123', 1);
  ok(a === spawnIdFor('tatooine', 'abc123', 1), '2: the same world, player and count give the same name every time');
  ok(a !== spawnIdFor('tatooine', 'abc123', 2), '2: the next one they stand is a different name');
  ok(a !== spawnIdFor('naboo', 'abc123', 1), '2: the same count in another world is a different name');
  ok(a !== spawnIdFor('tatooine', 'def456', 1), '2: and two admins in one world can never name the same creature');
  ok(/^[0-9a-f]{12}$/.test(a), '2: a name is twelve hex characters, the same in every browser');
  ok(spawnIdFor('tatooine', 'abc123', 1.7) === a, '2: a counter that is not a whole number is taken as the whole one');
  // Pinned: a name is what other browsers will be told, so a change to how it is worked out is a
  // change every browser has to make together.
  ok(a === '8a8c4c37a5ad', `2: the name is worked out this exact way (${a})`);
}

// --- 3: the seed and its rolls ----------------------------------------------------------------------
{
  const id = spawnIdFor('tatooine', 'abc123', 1);
  const seed = seedFor(id);
  ok(seed === seedFor(id), '3: a name always gives the same seed');
  ok(seed >>> 0 === seed && Number.isInteger(seed), '3: and the seed is a whole unsigned number, which is what the wire carries');
  ok(seedFor(id) !== seedFor(spawnIdFor('tatooine', 'abc123', 2)), '3: two spawns have two seeds');

  const r = rollsFor(seed);
  const again = rollsFor(seed);
  ok(r.heading === again.heading && r.scale === again.scale && r.arms === again.arms && r.variant === again.variant && r.idle === again.idle, '3: the same seed rolls the same numbers');
  for (const [name, v] of Object.entries(r)) ok(v >= 0 && v < 1, `3: the ${name} roll is a number from 0 up to but not including 1`);
  const all = [r.heading, r.scale, r.arms, r.variant, r.idle];
  ok(new Set(all).size === all.length, '3: each roll is drawn from its own stream, so no two are the same number');
  // A roll added later must not move the ones already in use: each is its own stream, so the fifth
  // stream's number does not depend on anything the first four did.
  ok(roll(seed, 5) === r.idle, '3: a roll is a stream of the seed and nothing else');
  ok(roll(seed, 1) === r.heading && roll(seed, 2) === r.scale, '3: and the streams are read the same way every time');
  ok(rollsFor(seed + 1).heading !== r.heading, '3: a different seed rolls differently');

  // The stream of numbers (what the rack is walked with) is a stream, not the same number twice.
  const rng = rngFor(seed, 3);
  const first = [rng(), rng(), rng()];
  const rng2 = rngFor(seed, 3);
  const second = [rng2(), rng2(), rng2()];
  ok(first.every((v, i) => v === second[i]), '3: a stream started again from the same seed runs the same way');
  ok(new Set(first).size === 3, '3: and it is a run of different numbers, not one number over and over');
  ok(armsRng(seed)() === rngFor(seed, 3)(), '3: the arms stream is the one the rolls call arms');
  ok(rngFor(seed, 3)() === r.arms, '3: and its first number is that roll, so one reading cannot drift from the other');
}

// --- 4: the size out of the range -------------------------------------------------------------------
{
  ok(scaleFrom([1, 2], 0) === 1, '4: a roll of nought is the bottom of the range');
  ok(scaleFrom([1, 2], 0.5) === 1.5, '4: half way is half way');
  ok(Math.abs(scaleFrom([1, 2], 0.999) - 1.999) < 1e-9, '4: and the top of the range is never quite reached');
  ok(scaleFrom([2, 2], 0.7) === 2, '4: a range of one size is that size');
  ok(scaleFrom(undefined, 0.7) === 1, '4: a body with no size of its own is one');
  ok(scaleFrom([0, 0], 0.7) === 1, '4: so is one whose range is nothing at all');
  ok(scaleFrom([2, 1], 0.7) === 2, '4: a range the wrong way round does not shrink anything below its first number');
  ok(scaleFrom([1, Number.NaN], 0.7) === 1, '4: and a range with a number that is not a number gives the one that is');
  ok(scaleFrom([1, 2], 5) === 2 && scaleFrom([1, 2], -5) === 1, '4: a roll outside 0 to 1 is held inside it rather than throwing a creature out of its own range');
}

// --- 5: a record turned into what the manager stands -------------------------------------------------
{
  const rec = recordFor('tatooine', 'abc123', 7, 'some_creature', { x: 12.5, y: 3.25, z: -40, heading: 1.25 });
  ok(rec.id === spawnIdFor('tatooine', 'abc123', 7) && rec.seed === seedFor(rec.id), '5: a record made here carries the name and the seed that go together');
  ok(rec.world === 'tatooine' && rec.species === 'some_creature' && rec.inside === undefined, '5: and the world, what it is, and nothing about a building it is not in');

  const a = spawnArgsFor(rec);
  const b = spawnArgsFor({ seed: rec.seed, heading: rec.heading, z: rec.z, y: rec.y, x: rec.x, species: rec.species, world: rec.world, id: rec.id });
  ok(a.x === b.x && a.y === b.y && a.z === b.z && a.heading === b.heading && a.seed === b.seed, '5: the same record with its fields written in another order gives the same arguments');
  ok(a.rolls.scale === b.rolls.scale && a.rolls.arms === b.rolls.arms, '5: and the same rolls');
  ok(a.heading === 1.25, '5: a record that names a heading is stood facing that way');
  ok(a.y === 3.25 && a.inside === false, '5: with the height it carries, on the ground');

  const noY = spawnArgsFor({ id: rec.id, world: 'tatooine', species: 'x', x: 1, z: 2, heading: 0, seed: rec.seed });
  ok(noY.y === undefined, '5: a record with no height leaves the ground to answer, as a spawn by hand always has');

  const noHeading = spawnArgsFor({ id: rec.id, world: 'tatooine', species: 'x', x: 1, z: 2, heading: Number.NaN, seed: rec.seed });
  ok(noHeading.heading >= 0 && noHeading.heading < Math.PI * 2 && noHeading.heading === rollsFor(rec.seed).heading * Math.PI * 2, '5: a record with no heading of its own faces the way its own seed says, not the way this machine’s dice say');

  const noSeed = spawnArgsFor({ id: rec.id, world: 'tatooine', species: 'x', x: 1, z: 2, heading: 0, seed: Number.NaN });
  ok(noSeed.seed === seedFor(rec.id), '5: and a record whose seed did not survive the trip falls back on the one its name gives, which is the same in every browser');

  const inside = recordFor('naboo', 'abc123', 1, 'x', { x: 0, z: 0, heading: 0, inside: true });
  ok(inside.inside === true && spawnArgsFor(inside).inside === true, '5: one stood in a building’s rooms is stood in them again');
}

// --- 6: what arrives from somewhere else is data ------------------------------------------------------
{
  const good: SpawnRecord = recordFor('tatooine', 'abc123', 1, 'some_creature', { x: 1, y: 2, z: 3, heading: 0 });
  ok(recordFits(good, 'tatooine'), '6: a whole record for this world is stood');
  ok(!recordFits(good, 'naboo'), '6: a record for another world is not stood here');
  ok(!recordFits(null, 'tatooine') && !recordFits(undefined, 'tatooine'), '6: nothing at all is not a record');
  ok(!recordFits({ ...good, id: '' }, 'tatooine'), '6: a record with no name is refused');
  ok(!recordFits({ ...good, species: '' }, 'tatooine'), '6: so is one that does not say what it is');
  ok(!recordFits({ ...good, x: Number.NaN }, 'tatooine'), '6: a place that is not a number is refused');
  ok(!recordFits({ ...good, z: Infinity }, 'tatooine'), '6: and so is one that is not finite');
  ok(!recordFits({ ...good, y: Number.NaN }, 'tatooine'), '6: a height that is not a number is refused rather than dropping a creature through the world');
  ok(recordFits({ ...good, y: undefined }, 'tatooine'), '6: but no height at all is fine, since the ground answers');
  ok(!recordFits({ ...good, heading: Number.NaN }, 'tatooine'), '6: a heading that is not a number is refused');
  ok(!recordFits({ ...good, seed: Number.NaN }, 'tatooine'), '6: and a seed that is not a number is refused, since every browser would then roll its own creature');
  ok(!recordFits({ ...good, id: 12 as unknown as string }, 'tatooine'), '6: a name that is not words is refused');
}

// --- 7: what standing one record comes to --------------------------------------------------------------
// This is the decision `MobileManager.standRecord` makes before it builds anything, and it is run
// here rather than read: the rules below are the ones worth being sure of, and each of them would
// still pass a check that merely looked at the source while the code did the opposite.
{
  const rec = recordFor('tatooine', 'abc123', 1, 'some_creature', { x: 5, y: 1, z: -5, heading: 0.5 });
  const here: StandWhere = { world: 'tatooine', standing: false, catalogue: true, known: true };

  const stand = decideStand(rec, here);
  ok(stand.do === 'stand', '7: a whole record for this world, with the catalogue here, is stood');
  if (stand.do === 'stand') {
    ok(stand.args.id === rec.id && stand.args.species === rec.species, '7: from its own name and what it says it is');
    ok(stand.args.x === 5 && stand.args.z === -5 && stand.args.y === 1 && stand.args.heading === 0.5, '7: at its own place, facing its own way');
    ok(stand.args.seed === rec.seed, '7: and rolling from its own seed, so every browser stands the same creature');
  }

  // The same record arriving twice must never make two creatures: that is the whole of the rule, and
  // it is answered before anything else is even asked.
  const twice = decideStand(rec, { ...here, standing: true });
  ok(twice.do === 'already', '7: a record that is already standing answers the one already standing');
  ok(decideStand(rec, { ...here, standing: true, catalogue: false }).do === 'already', '7: and does so even with no catalogue, since the body is already up');

  // A spawn word for the world just left can arrive during or after a trip.
  const elsewhere = decideStand(rec, { ...here, world: 'naboo' });
  ok(elsewhere.do === 'refuse', '7: a record for another world is refused rather than stood at that world’s metres in this one');
  ok(elsewhere.do === 'refuse' && elsewhere.why.includes('tatooine') && elsewhere.why.includes('naboo'), '7: and says which world it belongs to and which one this is');

  // What arrives from elsewhere is data: the validator is on the path that stands one, not beside it.
  for (const [what, bad] of [
    ['a place that is not a number', { ...rec, x: Number.NaN }],
    ['a heading that is not a number', { ...rec, heading: Number.NaN }],
    ['a seed that is not a number', { ...rec, seed: Number.NaN }],
    ['no name at all', { ...rec, id: '' }],
    ['nothing saying what it is', { ...rec, species: '' }],
  ] as [string, SpawnRecord][]) {
    ok(decideStand(bad, here).do === 'refuse', `7: a record with ${what} is refused`);
  }

  // The commonest case of all: connected, arrived, sent the world's list, and the catalogue's one
  // fetch still in flight. Every one of those records must wait rather than be dropped.
  const waiting = decideStand(rec, { ...here, catalogue: false });
  ok(waiting.do === 'wait', '7: a record that arrives before the catalogue does waits for it');
  ok(waiting.do === 'wait' && waiting.why === WAITING_FOR_CATALOGUE, '7: and says so, rather than reading like a refusal');
  ok(decideStand({ ...rec, world: 'naboo' }, { ...here, catalogue: false }).do === 'refuse', '7: while one for another world is refused without waiting for anything');
  const unknown = decideStand(rec, { ...here, known: false });
  ok(unknown.do === 'refuse' && unknown.why.includes(rec.species), '7: a record naming something the catalogue has never heard of is refused by name');

  // The queue itself.
  const q = new PendingSpawns();
  ok(q.size === 0, '7: nothing waits to begin with');
  ok(q.add(rec, 'tatooine') && q.size === 1 && q.has(rec.id), '7: a record with nowhere to stand yet waits under its own name');
  ok(q.add(rec, 'tatooine') && q.size === 1, '7: the same record arriving twice while it waits is still one creature');
  const other = recordFor('tatooine', 'abc123', 2, 'some_creature', { x: 0, z: 0, heading: 0 });
  q.add(other, 'tatooine');
  ok(q.size === 2, '7: two records wait as two');
  ok(q.drop(other.id) && q.size === 1 && !q.has(other.id), '7: one taken down before it ever stood is forgotten rather than stood a moment later');
  ok(!q.drop('nothing-by-that-name'), '7: and dropping a name that was never there says so');
  const taken = q.take();
  ok(taken.length === 1 && taken[0].rec.id === rec.id && taken[0].world === 'tatooine', '7: what was waiting comes back with the world it was waiting for');
  ok(q.size === 0, '7: and nothing is left waiting twice');
  ok(!q.add({ ...rec, id: '' }, 'tatooine'), '7: a record with no name cannot wait, since the queue is kept by name');

  const small = new PendingSpawns(2);
  small.add(rec, 'tatooine');
  small.add(other, 'tatooine');
  ok(!small.add(recordFor('tatooine', 'abc123', 3, 'x', { x: 0, z: 0, heading: 0 }), 'tatooine'), '7: the queue has a bottom, so a server saying anything at all cannot fill this browser');
  ok(small.add(rec, 'tatooine') && small.size === 2, '7: while one already waiting is replaced however full it is');
  small.clear();
  ok(small.size === 0, '7: and a world unloading leaves nothing waiting for the next one');
}

// --- 8: who may stand one at all -----------------------------------------------------------------------
// The NPC tab's gate. It is a function of the three questions the world answers and of nothing else,
// so it is run here with each answer in turn rather than read out of the tab's source.
{
  const gate = (shared: boolean, may: boolean, why = 'you are not the admin') => ({ shared: () => shared, maySpawn: () => may, why: () => why });
  ok(spawnRefusal(undefined) === '', '8: with no server at all nothing about the tab changes');
  ok(spawnRefusal(null) === '', '8: nor with nothing where the world’s rules would be');
  ok(spawnRefusal(gate(false, false)) === '', '8: nor while the server is not holding the world’s creatures');
  ok(spawnRefusal(gate(true, true)) === '', '8: an admin on a shared world may stand one');
  ok(spawnRefusal(gate(true, false)) === 'you are not the admin', '8: anybody else is refused in the world’s own words');
  ok(spawnRefusal(gate(true, false, '')) === NOT_ADMIN, '8: and in plain words when the world offers none');
  // The answer moves while the tab is open -- connecting, or being made an admin -- so it is asked
  // every time rather than kept.
  let admin = false;
  const live = { shared: () => true, maySpawn: () => admin, why: () => 'not yet' };
  ok(spawnRefusal(live) === 'not yet', '8: a browser that is not an admin yet is refused');
  admin = true;
  ok(spawnRefusal(live) === '', '8: and is refused no longer the moment it becomes one, with nothing to redraw first');
  ok(WORLD_HOLDS_IT.length > 0 && WORLD_HOLDS_IT !== NOT_ADMIN, '8: a machine row that stands one of the world’s creatures has a word of its own');
}

console.log(`\n${checks} checks passed`);
