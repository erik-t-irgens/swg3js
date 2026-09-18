// The run-time side of the creatures, droids and people: the keys that tell one living thing
// from another, whose side each is on, who picks a fight with whom, and picking one out of a
// crowd. Plain node over the pure modules, no browser API and no three.
import assert from 'node:assert/strict';
import { NOBODY, PLAYER_KEY, nextLivingKey } from '../../../src/combat/kit.ts';
import { hostileSides, nearestInCone, nearestTo, byKey, sideOf } from '../../../src/combat/targets.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const body = (x: number, y: number, z: number, extra: { dead?: boolean; key?: number } = {}) => ({
  pos: { x, y, z },
  halfHeight: 0.9,
  dead: extra.dead ?? false,
  key: extra.key ?? 0,
});

// --- 26: the keys ----------------------------------------------------------------------------
// The player is the one key that is a named constant, and nothing else may ever be given it:
// a caller that stores "who I am after" as a number must not read 0 as the player.
ok(PLAYER_KEY === 1, 'the player key is 1');
ok(NOBODY === 0, 'nobody is 0');
ok(!NOBODY, 'nobody is falsy, so `if (key)` reads as "is there anybody"');
{
  const keys: number[] = [];
  for (let i = 0; i < 500; i++) keys.push(nextLivingKey());
  ok(keys.every((k) => k !== NOBODY && k !== PLAYER_KEY), 'nextLivingKey never gives 0 or the player key');
  ok(keys.every((k) => k >= 2), 'every fresh key is 2 or more');
  ok(new Set(keys).size === keys.length, 'no key is handed out twice');
  ok(keys.every((k, i) => i === 0 || k > keys[i - 1]), 'keys only go up, so one is never reused while the page lives');
}
// A target that was dropped is null, never 0 and never 1: `byKey` reads both the same way.
{
  const list = [body(0, 0, 0, { key: PLAYER_KEY }), body(1, 0, 0, { key: 7 })];
  ok(byKey(list, null) === null, 'a dropped target (null) finds nobody');
  ok(byKey(list, NOBODY) === null, 'a dropped target stored as NOBODY finds nobody, not the player');
  ok(byKey(list, PLAYER_KEY) === list[0], 'the player key finds the player');
  ok(byKey(list, 7) === list[1], 'a living key finds its body');
  ok(byKey(list, 99) === null, 'an unknown key finds nobody');
}

// --- 33: sideOf ------------------------------------------------------------------------------
ok(sideOf({ id: 'stormtrooper', kind: 'npc' }) === 'imperial', 'an imperial id is imperial');
ok(sideOf({ id: 'imperial/scout_trooper', kind: 'npc' }) === 'imperial', 'an imperial folder is imperial');
ok(sideOf({ id: 'rebel_trooper', kind: 'npc' }) === 'rebel', 'a rebel id is rebel');
ok(sideOf({ id: 'alliance_pilot', kind: 'dressed' }) === 'rebel', 'an alliance id is rebel');
ok(sideOf({ id: 'rancor', kind: 'creature' }) === 'wild', 'a creature is wild');
ok(sideOf({ id: 'som/lava_flea', kind: 'special' }) === 'wild', 'a special is wild too');
ok(sideOf({ id: 'pirate_captain', kind: 'npc' }) === 'hostile', 'a hostile keyword in the id is hostile');
ok(sideOf({ id: 'some_person', kind: 'npc', group: 'npcs/thug' }) === 'hostile', 'a hostile keyword in the group is hostile');
ok(sideOf({ id: 'town_villager', kind: 'npc' }) === 'civilian', 'a civilian keyword is civilian');
ok(sideOf({ id: 'moisture_technician', kind: 'npc' }) === 'neutral', 'anything unrecognised is neutral');
ok(sideOf({ id: 'plain_person', kind: 'npc', stats: { tags: ['hostile'] } }) === 'hostile', "the converter's own hostile tag is read");
ok(sideOf({ id: 'plain_person', kind: 'npc', tags: ['civilian'] }) === 'civilian', 'a top-level civilian tag is read too');
// The faction is read before the kind, and the kind before the keywords: a creature carrying a
// hostile tag is still wild, but one whose id names a faction is not.
ok(sideOf({ id: 'wild_bantha', kind: 'creature', stats: { tags: ['hostile'] } }) === 'wild', 'a creature with a hostile tag is still wild');
ok(sideOf({ id: 'imperial_probot', kind: 'droid' }) === 'imperial', 'a droid on a faction takes the faction');

// --- 24 (the matrix targets.ts owns): who picks a fight ----------------------------------------
const who = (side: Parameters<typeof hostileSides>[0]['side'], aggression: Parameters<typeof hostileSides>[0]['aggression'] = 'aggressive') => ({ side, aggression });
ok(!hostileSides(who('wild', 'defensive'), who('player')), 'nothing but an aggressive one picks a fight');
ok(!hostileSides(who('wild'), who('neutral', 'passive')), 'nothing picks on a passive one (a hologram, a vendor)');
ok(hostileSides(who('fighter'), who('civilian')) && hostileSides(who('fighter'), who('player')) && hostileSides(who('fighter'), who('fighter')), 'a fighter fights every person that is not passive, other fighters included');
ok(!hostileSides(who('fighter'), who('wild')) && !hostileSides(who('fighter'), who('wild', 'defensive')), 'a fighter leaves the wildlife alone rather than walking off after a bantha');
ok(!hostileSides(who('fighter'), who('civilian', 'passive')), 'a fighter still leaves a passive person alone');
ok(hostileSides(who('wild'), who('player')) && hostileSides(who('wild'), who('imperial')) && !hostileSides(who('wild'), who('wild')), 'a wild predator takes people, not the herd');
ok(!hostileSides(who('hostile'), who('hostile')) && hostileSides(who('hostile'), who('civilian')), 'a hostile humanoid takes everything but other hostiles');
ok(!hostileSides(who('hostile'), who('wild', 'skittish')) && hostileSides(who('hostile'), who('wild')), 'a hostile humanoid takes a wild thing only when that one is aggressive too');
ok(hostileSides(who('imperial'), who('rebel')) && hostileSides(who('imperial'), who('player')) && !hostileSides(who('imperial'), who('civilian')), 'imperials take the player and rebels, not civilians');
ok(hostileSides(who('rebel'), who('imperial')) && !hostileSides(who('rebel'), who('player')), 'rebels take imperials and leave the player alone');
ok(hostileSides(who('civilian'), who('player')) && !hostileSides(who('civilian'), who('civilian')), 'anything else aggressive takes the player and the fighters only');

// --- 34: nearestInCone ------------------------------------------------------------------------
{
  const from = { x: 0, y: 0, z: 0 };
  const forward = { x: 0, y: 0, z: 1 };
  const ahead = body(0, 0, 10);
  const behind = body(0, 0, -5);
  const far = body(0, 0, 40);
  const side = body(10, 0, 1);
  const list = [behind, far, side, ahead];
  ok(nearestInCone(list, { from, forward, range: 30, cone: 0.5 }) === ahead, 'the one in the cone and in range is taken');
  ok(nearestInCone([behind], { from, forward, range: 30, cone: 0.5 }) === null, 'one behind is outside the cone');
  ok(nearestInCone([far], { from, forward, range: 30, cone: 0.5 }) === null, 'one past the range is not taken');
  ok(nearestInCone([side], { from, forward, range: 30, cone: 0.5 }) === null, 'one off to the side is outside the cone');
  ok(nearestInCone([side], { from, forward, range: 30, cone: -1 }) === side, 'a cone of -1 takes everything in range');
  // The nearest wins, and a dead body is passed over however near it is.
  const near = body(0, 0, 3);
  ok(nearestInCone([ahead, near], { from, forward, range: 30, cone: 0.5 }) === near, 'the nearest in the cone wins');
  near.dead = true;
  ok(nearestInCone([ahead, near], { from, forward, range: 30, cone: 0.5 }) === ahead, 'a dead body is passed over');
  // `need` narrows it to what the power can actually do something with.
  ok(nearestInCone([near, ahead], { from, forward, range: 30, cone: 0.5, need: (t) => t !== ahead }) === null, 'need passes over what it says no to');
  // Something on top of you is ahead of you whichever way you face.
  const onTop = body(0.2, 0, -0.2);
  ok(nearestInCone([onTop], { from, forward, range: 30, cone: 0.9 }) === null, 'without `near`, something at your back is out of the cone');
  ok(nearestInCone([onTop], { from, forward, range: 30, cone: 0.9, near: 0.5 }) === onTop, 'inside `near` the cone is not tested');
  // Measured to the middle rather than to the feet: a body below is nearer by its half-height
  // (feet 6.32 m away, middle 5.48), and at a range between the two only the middle counts.
  const below = body(0, -6, 2);
  ok(nearestInCone([below], { from, forward, range: 5.5, cone: -1 }) === null, 'measured at the feet it is out of range');
  ok(nearestInCone([below], { from, forward, range: 5.5, cone: -1, middle: true }) === below, 'measured at the middle it is in range');
}

// --- nearestTo --------------------------------------------------------------------------------
{
  const a = body(0, 0, 0);
  const b = body(4, 0, 0);
  const dead = body(1, 0, 0, { dead: true });
  ok(nearestTo([a, b, dead], { x: 5, y: 0, z: 0 }, 10) === b, 'the nearest to a point wins');
  ok(nearestTo([a, dead], { x: 1, y: 0, z: 0 }, 10) === a, 'a dead body is passed over');
  ok(nearestTo([b], { x: 0, y: 0, z: 0 }, 3) === null, 'past the range, nobody');
  ok(nearestTo([a, b], { x: 5, y: 0, z: 0 }, 10, (t) => t !== b) === a, 'need passes over what it says no to');
}

console.log(`${checks} checks passed`);
