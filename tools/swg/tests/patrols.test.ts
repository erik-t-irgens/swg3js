// The towns' walkers (src/world/patrols.ts): a round walked on the server's own clock -- the wait before
// the first step, the linger at a marked point and the pause at any other, the loop back to the first
// point -- the split between the walkers the server set going and the combat walkers it left at their
// posts, and a walker who is fought leaving its round and coming back to the very point it was making
// for. Every round here is drawn by hand; the clock and the dice are the test's own.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PATROL_TUNE, Patrol, keepPatrol, restDecision, stepPatrol, thinkWalking, walksRound, type PatrolPoint } from '../../../src/world/patrols.ts';
import { decide, type BrainSelf, type BrainTarget, type Decision } from '../../../src/world/mobiles/brain.ts';
import { PEOPLE_TUNE, patrolFor, standPlaceOf, type StandingRow } from '../../../src/world/standingPeople.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
/** Dice that always land in the middle, so every wait is the middle of its span. */
const half = (): number => 0.5;

const round: PatrolPoint[] = [
  { x: 0, y: 0, z: 0, linger: false },
  { x: 10, y: 0, z: 0, linger: true },
  { x: 10, y: 0, z: 10, linger: false },
];

// ---- 1: the server's own numbers -----------------------------------------------------------------
{
  ok(PATROL_TUNE.start[0] === 50 && PATROL_TUNE.start[1] === 70, 'a walker sets off fifty to seventy seconds after it is stood: the server’s ten to set it up and forty to sixty more (`setupMobilePatrol`)');
  ok(PATROL_TUNE.linger[0] === 30 && PATROL_TUNE.linger[1] === 60, 'it lingers thirty to sixty seconds at a point the town marked (`mobileDestinationReached`)');
  ok(PATROL_TUNE.pause === 5, '... and five at any other');
  ok(PATROL_TUNE.walks && !PATROL_TUNE.combat, 'every walker walks, and no combat walker does, as the server had it');
}

// ---- 2: the round, in order, with its waits ----------------------------------------------------------
{
  const p = new Patrol(round, 100, half);
  ok(near(p.waitUntil, 160), 'stood at 100, it waits the middle of its start: until 160');
  ok(!stepPatrol(p, 0, 0, 159.9, half) && p.to === -1, 'it stands at its first point until then');
  ok(stepPatrol(p, 0, 0, 160, half) && p.to === 1, '... and then walks to the second');
  ok(p.anchor === round[1], 'what it is making for is the point it walks to');
  ok(stepPatrol(p, 5, 0, 170, half), 'half way there it is still walking');
  ok(!stepPatrol(p, 9, 0, 172, half) && p.at === 1 && p.legs === 1, `within ${PATROL_TUNE.arrive} m of the point it has reached it`);
  ok(near(p.waitUntil, 172 + 45) && p.waits[p.waits.length - 1] === 45, 'a point marked for lingering is waited at thirty to sixty seconds: the middle, 45');
  ok(near(p.lastLeg, 12), '... and the leg took the twelve seconds it was walked in');
  ok(!stepPatrol(p, 10, 0, 216, half), 'it lingers');
  ok(stepPatrol(p, 10, 0, 217, half) && p.to === 2, '... and sets off for the third point when the wait is out');
  ok(stepPatrol(p, 10, 0, 218, half), 'at the point it left, it is walking the next leg');
  ok(!stepPatrol(p, 10, 9.5, 225, half) && p.at === 2 && near(p.waitUntil, 230), 'a point that is not marked is waited at five seconds');
  ok(stepPatrol(p, 10, 10, 230, half) && p.to === 0, 'after the last point it walks back to the first');
  ok(!stepPatrol(p, 0, 0, 240, half) && p.at === 0 && p.rounds === 1 && p.legs === 3, '... and that is one round, three legs');
  ok(near(p.waitUntil, 245), 'the first point is not marked, so five seconds there, and round again');
  ok(stepPatrol(p, 0, 0, 245, half) && p.to === 1, 'round again, in the same order');

  const one = new Patrol([round[0]], 0, half);
  ok(!stepPatrol(one, 0, 0, 1e6, half), 'a round of one point is no round, and never walks');
}

// ---- 2b: a leg that cannot be walked is given up ------------------------------------------------------
{
  const p = new Patrol(round, 0, half);
  stepPatrol(p, 0, 0, 60, half);
  ok(p.to === 1, 'walking to the second point');
  // Leaning on a wall two metres off the start: no headway at all.
  for (let t = 61; t < 60 + PATROL_TUNE.giveUp; t += 0.5) stepPatrol(p, 2, 0, t, half);
  ok(p.to === 1 && p.skipped === 0, `for ${PATROL_TUNE.giveUp} s it keeps trying`);
  ok(!stepPatrol(p, 2, 0, 61 + PATROL_TUNE.giveUp, half) && p.at === 1 && p.skipped === 1, '... and then, that long after the last metre it gained, the leg is given up and counts as walked, with that point’s own wait');
  // Headway resets the clock: a body a metre nearer every seventeen seconds never gives up.
  const q = new Patrol([round[0], { x: 100, y: 0, z: 0 }], 0, half);
  stepPatrol(q, 0, 0, 60, half);
  let x = 0;
  for (let t = 61; t < 60 + 3 * PATROL_TUNE.giveUp; t += 1) {
    x += 0.06;
    stepPatrol(q, x, 0, t, half);
  }
  ok(q.skipped === 0 && q.to === 1, 'a walker getting nearer, however slowly, is never given up on');
  // Held still (too far off to be moved) or away fighting, the clock does not run.
  const r = new Patrol(round, 0, half);
  stepPatrol(r, 0, 0, 60, half);
  for (let t = 61; t < 60 + 3 * PATROL_TUNE.giveUp; t += 0.5) stepPatrol(r, 0, 0, t, half, PATROL_TUNE, true);
  ok(r.skipped === 0 && r.to === 1, 'a walker held still by its level of detail is not given up on');
  stepPatrol(r, 0, 0, 500, half);
  ok(r.skipped === 0 && r.to === 1, '... nor one coming back to its round after a fight, the gap in the stepping being the fight');
}

// ---- 3: who walks --------------------------------------------------------------------------------------
{
  ok(walksRound(round, true, true), 'a walker the town made unattackable walks its round');
  ok(!walksRound(round, true, false), '... a combat walker stands at its post, as the server left it (`spawnPatrol` returns before setting its walk up)');
  ok(walksRound(round, true, false, { ...PATROL_TUNE, combat: true }), '... unless `combat` says otherwise');
  ok(!walksRound(round, false, true), 'a walker not stood at its first point (a script’s slip, stood at its own row) does not walk off six kilometres to it');
  ok(!walksRound([round[0]], true, true) && !walksRound(undefined, true, true), 'nor anything with fewer than two points');

  const row = { x: 1, y: 0, z: 1, cell: 0, room: null, route: round.map((q) => ({ ...q })), peaceful: true } as unknown as StandingRow;
  const st = standPlaceOf(row);
  ok(st.x === 0 && st.z === 0, 'a walker is stood at the first point of its round');
  const walker = patrolFor(row, st, 50, half);
  ok(!!walker && near(walker.waitUntil, 110), '... and made a walker there, its clock starting as it is stood');
  ok(patrolFor({ ...row, peaceful: undefined }, st, 50, half) === null, 'a combat walker is not');
  // A row whose round starts further off than a script could have meant is a slip: the body stands at
  // its own row, and a body not stood at its first point is no walker -- it would set off on a walk of
  // kilometres to reach it.
  const slip = { ...row, x: 6000, z: 6000 } as StandingRow;
  const slipSt = standPlaceOf(slip);
  ok(slipSt.x === 6000 && slipSt.z === 6000 && Math.hypot(round[0].x - slip.x, round[0].z - slip.z) > PEOPLE_TUNE.routeReach, `a row whose round starts more than ${PEOPLE_TUNE.routeReach} m off is stood at its own row`);
  ok(patrolFor(slip, slipSt, 50, half) === null, '... and is made no walker, since it was not stood at its first point');
}

// ---- 3b: the town's own walkers, which have no brain -----------------------------------------------
//
// Every walker the town sets going is one it made unattackable (section 3), and an unattackable body
// has no brain at all: it thinks through `thinkWalking` alone (`Mobile.thinkWalker`). So this, and not
// section 4, is the path every town walker really takes by default.
{
  const p = new Patrol(round, 0, half);
  let d: Decision | null = null;
  const at = { x: 0, z: 0, now: 0 };
  const think = (x: number, z: number, now: number): Decision => {
    at.x = x;
    at.z = z;
    at.now = now;
    d = thinkWalking(d, at, p, half);
    return d;
  };
  const first = think(0, 0, 10);
  ok(first.state === 'idle' && first.moveTo === null && first.pace === 'stand', 'stood, a walker stands at its first point, going nowhere');
  ok(think(0, 0, 60) === first, '... and keeps the one decision for its life, written over each thought');
  const going = think(0, 0, 60.5);
  ok(going.state === 'wander' && going.pace === 'walk' && going.moveTo === p.goal && p.goal.x === 10 && p.goal.z === 0, 'when its wait is out it walks to the second point of its round');
  ok(going.targetKey === null && going.attack === null && going.emote === null, '... after nobody, attacking nothing');
  ok(think(5, 0, 66).moveTo === p.goal && p.to === 1, 'half way, it is still walking there');
  const there = think(9.5, 0, 70);
  ok(there.state === 'idle' && there.moveTo === null && p.at === 1 && near(p.waitUntil, 70 + 45), 'at the point it stops and lingers, the point being marked for it');
  ok(think(10, 0, 116).moveTo === p.goal && p.to === 2 && p.goal.z === 10, '... and walks on to the third when the linger is out');
  // The switch, turned off in the middle of a leg, stands it where it is: the kept decision is put to
  // rest before the round is asked, or the last leg's point would be walked to for as long as it is kept.
  const stopped = thinkWalking(d, { x: 10, z: 3, now: 118 }, p, half, { ...PATROL_TUNE, walks: false });
  ok(stopped.moveTo === null && stopped.pace === 'stand' && stopped.state === 'idle', 'with the rounds switched off mid-leg, it stands where it is');
  const fresh = thinkWalking(null, { x: 0, z: 0, now: 0 }, new Patrol(round, 0, half), half);
  ok(fresh !== d && fresh.state === 'idle' && fresh.moveTo === null && restDecision().targetKey === null, 'a walker thinking for the first time is handed a decision of its own, at rest');
}

// ---- 4: a fight is the brain's, and after it the round goes on -----------------------------------
//
// Only a combat walker has a brain to fight with, and the town never sets one walking unless
// `PATROL_TUNE.combat` says so (section 3): this is that walker, and what `keepPatrol` does under the
// brain's own thinking. The town's own walkers are section 3b.
{
  const rest = (): Decision => ({
    state: 'idle', targetKey: null, moveTo: null, pace: 'stand', posture: 'stand', cover: false, face: null, attack: null, emote: null,
    wanderAt: 0, goal: null, until: 0, blockedSince: null, forgetKey: null, forgetUntil: 0, clearMemory: false,
  });
  const p = new Patrol(round, 0, half);
  stepPatrol(p, 0, 0, 60, half);
  ok(p.to === 1, 'a walker on its way to the second point');
  const d = rest();
  ok(keepPatrol(d, { x: 2, z: 0, now: 61 }, p, half) && d.state === 'wander' && d.pace === 'walk' && d.moveTo === p.goal && p.goal.x === 10, 'with nothing on its mind it walks to the point, at a walk');
  ok(d.wanderAt > 61 + 600, '... and the brain’s own wander is pushed out of the way');

  // Somebody attacks it: the brain chases, and the round keeps its hands off.
  const self: BrainSelf = {
    key: 5, x: 4, y: 0, z: 0, heading: 0, homeX: p.anchor.x, homeZ: p.anchor.z, side: 'civilian', aggression: 'defensive', inside: false,
    big: false, reach: 1.5, ranged: 0, melee: true, halfHeight: 0.9, hpRatio: 1, state: 'wander', targetKey: null, stuck: 0, now: 62,
    wanderAt: 0, goal: p.goal, until: 0, blockedSince: null, forgetKey: null, forgetUntil: 0,
  };
  const foe: BrainTarget = { key: 1, x: 4, y: 0, z: 8, halfHeight: 0.9, radius: 0.8, side: 'player', aggression: 'defensive', dead: false, attackedMeAt: 61.9, hasLine: false };
  const fight = decide(self, [foe], undefined, half);
  ok(fight.targetKey === 1, 'struck, it turns on whoever struck it');
  ok(!keepPatrol(fight, { x: 4, z: 0, now: 62 }, p, half) && fight.targetKey === 1 && fight.state !== 'wander', '... and the round leaves the fight alone');
  ok(p.to === 1, 'the round still remembers where it was going');

  // The fight is over (the foe gone): the brain has nothing on its mind, and the round takes it back
  // to the very point it was making for, from wherever the fight left it.
  const after = decide({ ...self, x: -3, z: 7, state: 'chase', targetKey: null }, [], undefined, half);
  ok(keepPatrol(after, { x: -3, z: 7, now: 90 }, p, half) && after.moveTo === p.goal && p.goal.x === 10 && p.goal.z === 0, 'after the fight it walks back to the point it was on its way to, and on round');
  // And a leash run home is the brain's, home being that same point.
  const leashed = decide({ ...self, x: 80, z: 0, homeX: p.anchor.x, homeZ: p.anchor.z }, [], undefined, half);
  ok(leashed.state === 'return' && leashed.moveTo?.x === 10 && !keepPatrol(leashed, { x: 80, z: 0, now: 91 }, p, half), 'chased past its leash, it runs home -- to the round’s point -- and the round waits for it');

  const off = new Patrol(round, 0, half);
  const d2 = rest();
  ok(!keepPatrol(d2, { x: 0, z: 0, now: 100 }, off, half, { ...PATROL_TUNE, walks: false }) && d2.state === 'idle' && d2.moveTo === null, 'with the switch off a walker stands at its first point');
}

// ---- 5: the wiring, read as text ---------------------------------------------------------------------
{
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mobile = src('world/mobiles/mobile.ts');
  const people = src('world/standingPeople.ts');
  const keep = mobile.indexOf('keepPatrol(d, self, this.patrol, Math.random, PATROL_TUNE, !this.tier?.move);');
  const home = mobile.indexOf('this.homeX = this.patrol.anchor.x;');
  const clamp = mobile.indexOf('if (this.inside) clampWander(d, this.homeX, this.homeZ');
  ok(keep > 0 && home > keep && clamp > home, 'a mobile keeps its round, then moves its home onto the round’s point, then clamps an indoor wander to that home -- in that order, or the clamp would pull the walk back to the last point');
  ok(/\(!this\.essential \|\| this\.patrol\)/.test(mobile) && /if \(this\.essential\) this\.thinkWalker\(\);/.test(mobile), 'a walker who is part of the furniture walks its round with no brain at all');
  ok(/private thinkWalker\(\): void \{[\s\S]{0,400}?const d = thinkWalking\(this\.walkerDecision, self, p, Math\.random, PATROL_TUNE, !this\.tier\?\.move\);\s*this\.walkerDecision = d;\s*this\.homeX = p\.anchor\.x;\s*this\.homeZ = p\.anchor\.z;\s*this\.goal = d\.goal;\s*this\.state = d\.state;\s*this\.decision = d;/.test(mobile), '... through `thinkWalking` (section 3b), keeping the decision it hands back, its home on the round’s point, and acting on it');
  ok(/self\.x = this\.pos\.x;\s*self\.z = this\.pos\.z;\s*self\.now = this\.now;\s*const d = thinkWalking/.test(mobile), '... asked from where the body really stands, on its own clock');
  ok(/m\.patrol = patrolFor\(r, st, now\);/.test(people), 'the standing people make each walker its round when it is stood');
}

console.log(`\n${checks} checks passed`);
