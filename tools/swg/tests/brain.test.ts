// A jumper's reach in the shared brain (src/world/mobiles/brain.ts): the one thing a jump changes in
// how a body decides.
//
// The brain gives up on a target that stays out of reach in height for `giveUp` seconds -- a body at
// the foot of a wall cannot fight somebody on top of it -- and a body that can jump now keeps one stood
// above it within its jump. Four things are pinned, because each is a way this could quietly be wrong.
//
// **A jumper keeps what a body without a jump gives up on**, run over the whole give-up rather than
// asked once, so the clock the rule keeps is what is measured.
//
// **Only upward.** A jump reaches a ledge; it does nothing about a pit, and a body drops off an edge
// with no jump at all, so a target far below is given up by both alike.
//
// **Only within its reach.** A target higher than the jump reaches is given up by a jumper too, and the
// reach is the jump level's own height (`jumpHeight` in `src/world/evade.ts`), measured feet to feet.
//
// **The brain and the jump agree.** Every height the brain keeps a target at only because of the jump
// is a height the ledge jump (`ledgeJump`) will really take, at every jump level: a target kept for a
// jump the body never makes is a chase at the foot of a wall until the stuck count gives it up, where
// before the jump it went home after `giveUp` seconds. The two are run over the same heights here
// rather than each checked against its own idea of the other.
//
// **A blow still wants the two level.** Kept is not struck: a body a few metres under somebody on a
// wall chases, it does not stand swinging at the air, and the jump up is the body's own to make.
//
// And the wildlife: a body that leaves `jumpReach` out decides exactly as it did before anybody could
// jump, which is every creature and droid in the game.
//
// Synthetic throughout: every body, place and height below is written in this file.
import assert from 'node:assert/strict';
import { BRAIN_TUNE, decide, withinJump, type BrainSelf, type BrainTarget, type Decision } from '../../../src/world/mobiles/brain.ts';
import { JUMP_TUNE, jumpHeight, ledgeJump } from '../../../src/world/evade.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A blade carrier after somebody who hurt it, home under its feet. */
function body(over: Partial<BrainSelf> = {}): BrainSelf {
  return {
    key: 2,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    homeX: 0,
    homeZ: 0,
    side: 'hostile',
    aggression: 'aggressive',
    inside: false,
    big: false,
    reach: 1.9,
    ranged: 0,
    melee: true,
    halfHeight: 0.9,
    hpRatio: 1,
    state: 'chase',
    targetKey: 1,
    stuck: 0,
    now: 100,
    wanderAt: 1e9,
    goal: null,
    until: 0,
    blockedSince: null,
    forgetKey: null,
    forgetUntil: 0,
    ...over,
  };
}

/** The player, stood `up` metres over the body's feet and `across` metres off. */
function foe(up: number, across = 2, attackedAt = 99.5): BrainTarget {
  return { key: 1, x: across, y: up, z: 0, halfHeight: 0.9, radius: 0.7, side: 'player', aggression: 'aggressive', dead: false, attackedMeAt: attackedAt, hasLine: false };
}

/**
 * Run the brain for `seconds` at a thought every `step`, feeding back what it keeps exactly as a body
 * does, with the grudge kept fresh (the player keeps shooting). Answers the last decision and whether
 * it ever went home.
 */
function run(self: BrainSelf, up: number, seconds: number, step = 0.25): { last: Decision; gaveUp: boolean } {
  let last: Decision | null = null;
  let gaveUp = false;
  const s = { ...self };
  for (let t = 0; t <= seconds; t += step) {
    s.now = 100 + t;
    const d = decide(s, [foe(up, 2, s.now - 0.1)], BRAIN_TUNE, () => 0.5);
    if (d.state === 'return' && d.forgetKey === 1) gaveUp = true;
    s.state = d.state;
    s.targetKey = d.targetKey;
    s.blockedSince = d.blockedSince;
    s.forgetKey = d.forgetKey;
    s.forgetUntil = d.forgetUntil;
    s.goal = d.goal;
    s.until = d.until;
    s.wanderAt = d.wanderAt;
    last = d;
  }
  return { last: last!, gaveUp };
}

/** How far over the body's feet a target of the same size may stand and still count as level. */
const level = BRAIN_TUNE.vertical + 0.9 + 0.9;
const hop = jumpHeight(1);
const first = jumpHeight(2);
const force = jumpHeight(3);

// --- 1: the reach, as a rule ------------------------------------------------------------------------

{
  // Past what counts as level and within the second Force level's reach.
  const up = (level + force) / 2;
  ok(force > level && hop < level && first < level, `the plain hop (${hop.toFixed(2)} m) and the first Force level (${first.toFixed(2)} m) reach no higher than what already counts as level (${level.toFixed(2)} m); the second (${force.toFixed(2)} m) does`);
  ok(!withinJump(body(), foe(up)), 'a body with no jump has no reach at all');
  ok(withinJump(body({ jumpReach: force }), foe(up)), `the second Force level keeps somebody stood ${up.toFixed(2)} m up`);
  ok(!withinJump(body({ jumpReach: hop }), foe(up)) && !withinJump(body({ jumpReach: first }), foe(up)), '... which neither a hop nor the first Force level can get up to');
  ok(withinJump(body({ jumpReach: force }), foe(force)) && !withinJump(body({ jumpReach: force }), foe(force + 0.01)), '... up to exactly the height it jumps, feet to feet, and no further');
  ok(!withinJump(body({ jumpReach: force }), foe(-(level + 1))), 'and a jump reaches nothing below: a body drops off an edge without one');
}

// --- 2: the brain and the ledge jump agree ------------------------------------------------------

{
  // Every level, every rise from the body's feet to well past the highest jump: a height kept only
  // because of the jump (kept by a jumper, given up by the same body without one) must be one the ledge
  // jump takes, from anywhere near enough across to be worth it, free, on its feet and out of doors.
  // Both sides are the real brain run over its whole give-up, so "kept" is what a body does.
  const seconds = BRAIN_TUNE.giveUp + 1;
  const keptBy = [0, 0, 0, 0];
  let disagree = 0;
  for (let up = 0; up <= 8; up += 0.02) {
    const walkerGivesUp = run(body(), up, seconds).gaveUp;
    if (!walkerGivesUp) continue;
    for (let lvl = 1; lvl < JUMP_TUNE.heights.length; lvl++) {
      if (run(body({ jumpReach: jumpHeight(lvl) }), up, seconds).gaveUp) continue;
      keptBy[lvl]++;
      const jumps = ledgeJump({ rise: up, flat: 2, level: lvl, grounded: true, chasing: true, free: true, outdoors: true, since: 99 });
      if (!(jumps > 0)) disagree++;
    }
  }
  ok(keptBy[1] === 0 && keptBy[2] === 0, 'a hop and the first Force level keep nothing a body without them gives up: every ledge they can get up onto already counts as level');
  ok(keptBy[3] > 0 && disagree === 0, `and every one of the ${keptBy[3]} heights (2 cm apart) the second Force level keeps for its jump is one the ledge jump really takes`);
}

// --- 3: over the whole give-up -------------------------------------------------------------------

{
  const up = (level + force) / 2;
  const seconds = BRAIN_TUNE.giveUp + 3;
  const walker = run(body(), up, seconds);
  const jumper = run(body({ jumpReach: force }), up, seconds);
  ok(walker.gaveUp && walker.last.targetKey === null, `a body that cannot jump gives up on somebody ${up.toFixed(2)} m up after its ${BRAIN_TUNE.giveUp} s, goes home and forgets them`);
  ok(!jumper.gaveUp && jumper.last.targetKey === 1, '... where a Force jumper that can get up there keeps them for the whole of it');
  ok(jumper.last.state === 'chase' && jumper.last.attack === null, 'and keeps them by chasing: kept is not struck, and a blow still wants the two level');
  ok(jumper.last.blockedSince === null, 'with no give-up clock running at all, since the height is not out of its reach');

  const hopper = run(body({ jumpReach: hop }), level + 0.5, seconds);
  ok(hopper.gaveUp, `a body that only hops gives up on somebody ${(level + 0.5).toFixed(2)} m up like any other, since no hop gets it there`);

  const high = run(body({ jumpReach: force }), force + 0.5, seconds);
  ok(high.gaveUp, 'somebody higher than the jump reaches is given up by a jumper too');

  const low = run(body({ jumpReach: force }), -(level + 1), seconds);
  ok(low.gaveUp, 'and somebody far below is given up by the best of jumpers, since a jump is only ever upward');
}

// --- 4: nothing else moves ----------------------------------------------------------------------

{
  // Level ground, a target in reach, and the same at the edge of level: a jump changes none of it.
  for (const up of [0, level * 0.5, -level * 0.5]) {
    const plain = decide(body(), [foe(up)], BRAIN_TUNE, () => 0.5);
    const jumper = decide(body({ jumpReach: force }), [foe(up)], BRAIN_TUNE, () => 0.5);
    ok(JSON.stringify(plain) === JSON.stringify(jumper), `within level (${up.toFixed(2)} m) a jumper decides field for field what a body without one does`);
  }
  // The wildlife leaves the field out entirely.
  const creature = body({ side: 'wild' });
  delete creature.jumpReach;
  const before = decide(creature, [foe(level + 0.5)], BRAIN_TUNE, () => 0.5);
  const zero = decide({ ...creature, jumpReach: 0 }, [foe(level + 0.5)], BRAIN_TUNE, () => 0.5);
  ok(JSON.stringify(before) === JSON.stringify(zero), 'and a body that says nothing about jumping is exactly a body whose jump reaches nothing');
}

console.log(`\n${checks} checks passed`);
