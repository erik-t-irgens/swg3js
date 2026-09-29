// Getting out of the way, and fighting as a fighter does (src/world/evade.ts and
// src/world/mobiles/tactics.ts): the pure halves a fighter and a person from the catalogue both run.
//
// Five things are pinned, and three of them are measurements rather than assertions.
//
// **The figures that are Jedi Academy's really are.** The roll's speed and length and the three jump
// heights are copied into `evade.ts` by value, so that it pulls in nothing; they are held here against
// `JKA` in `src/player/jkaMove.ts`, which is where the player's own come from.
//
// **The evade decision, clause by clause**, and then **its rate, measured**: a body aimed at for ten
// minutes, asked at a tenth of a second and again at half a second, and the evades counted per tier --
// which is how the compounding and the cooldown are checked together, and how the ladder is seen to
// be one.
//
// **Who jumps, how high, and when a ledge is worth it**, and the speed that really reaches a height.
//
// **The aim line** a body reads to know it is aimed at.
//
// **A person's own feet** (`GroundTactics`): the ring and the slide on their duty cycle, measured the
// same way; the low postures read out of a pack's own logical names; and a cover spot held and given
// up by the fighters' own rule, against a wall made of numbers.
//
// Synthetic throughout: every body, place, name and number below is written in this file or read out
// of the modules under test. Nothing comes from the game's archives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVADE_CLIPS, EVADE_TUNE, EvadeClock, JUMP_TUNE, ROLL_CLIPS, aimedAt, evadeChance, evadeKind, evadeShare, jumpAcross, jumpClipName, jumpHeight, jumpLevelFor, jumpSpeed, ledgeJump, rollDirection, rollVector, tuneEvade, tuneJump, type AimLine, type EvadeAsk, type LedgeAsk } from '../../../src/world/evade.ts';
import { JKA, UNIT } from '../../../src/player/jkaMove.ts';
import { GroundTactics, lowClipsFor, lowLoop, lowTransition } from '../../../src/world/mobiles/tactics.ts';
import { GROUND_STEP } from '../../../src/world/groundStep.ts';
import { COVER_TUNE, coverSearch, type CoverDeps } from '../../../src/world/cover.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

/** A plain repeatable generator, so the numbers below are the same on every machine. */
let seed = 0x2545f491;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

// --- 1: Jedi Academy's own figures ------------------------------------------------------------------

ok(near(EVADE_TUNE.rollSpeed, JKA.rollSpeed * UNIT) && near(EVADE_TUNE.rollTime, JKA.rollTime), `the roll is the player's own: ${EVADE_TUNE.rollSpeed.toFixed(2)} m/s for ${EVADE_TUNE.rollTime} s (${JKA.rollSpeed} units a second)`);
ok([1, 2, 3].every((l) => near(JUMP_TUNE.heights[l], JKA.forceJumpHeight[l - 1] * UNIT)), `and the jump heights are the plain jump and the first two Force Jump levels: ${JUMP_TUNE.heights.slice(1).map((h) => h.toFixed(2)).join(', ')} m`);
ok(JUMP_TUNE.heights[0] === 0 && jumpHeight(0) === 0, 'level 0 is no jump at all');
ok(EVADE_CLIPS.includes('BOTH_ROLL_L') && EVADE_CLIPS.includes('BOTH_FORCEJUMP1') && EVADE_CLIPS.includes('BOTH_LANDLEFT1'), 'what a person is lent is the four rolls and every jump, in-air and landing clip Jedi Academy names');

// --- 2: the decision, clause by clause ------------------------------------------------------------

{
  ok(evadeShare(0) === 0 && evadeShare(1) === 0, 'tier 0, the flat fighter, and tier 1, the least of the ladder, never evade');
  ok(evadeShare(2) === 0.1 && evadeShare(5) === 0.4 && evadeShare(9) === 0.4 && evadeShare(-3) === 0, 'the rest are the design’s shares a second, and a tier off the table takes its nearest end');
  ok(near(evadeChance(0.3, 1), 0.3) && evadeChance(0, 5) === 0 && evadeChance(1, 0.01) === 1, 'the chance over a second is the share itself, nought for nought and certain for one');
  // Compounded, not multiplied: ten steps of a tenth of a second are one step of a second.
  let miss = 1;
  for (let i = 0; i < 10; i++) miss *= 1 - evadeChance(0.3, 0.1);
  ok(near(1 - miss, evadeChance(0.3, 1), 1e-12), 'and ten tenths of a second come to exactly one second, which is what makes the rate the same however often a body is asked');

  const ask = (o: Partial<EvadeAsk> = {}): EvadeAsk => ({ tier: 5, aimed: true, since: 99, dt: 1, grounded: true, free: true, canRoll: true, jumpLevel: 0, ...o });
  ok(evadeKind(ask(), 0, 0.9) === 'roll', 'aimed at, on its feet, free and out of its cooldown, a body with no jump rolls');
  ok(evadeKind(ask({ aimed: false }), 0, 0) === null, 'nothing that is not aimed at');
  ok(evadeKind(ask({ grounded: false }), 0, 0) === null && evadeKind(ask({ free: false }), 0, 0) === null, 'nor in the air, nor staggered, swinging or lying down');
  ok(evadeKind(ask({ since: EVADE_TUNE.cooldown - 0.01 }), 0, 0) === null, `nor within ${EVADE_TUNE.cooldown} s of the last`);
  ok(evadeKind(ask({ dt: 1 }), 0.41, 0) === null && evadeKind(ask({ dt: 1 }), 0.39, 0.9) === 'roll', 'and only its tier’s share of the time');
  ok(evadeKind(ask({ tier: 1 }), 0, 0) === null, 'a tier-1 body never');
  // D9 is the roll only: as shipped, a body that can jump rolls like any other, and one that cannot be
  // drawn rolling does nothing at all, whatever its jump.
  ok(EVADE_TUNE.hopShare === 0, 'the hop as a dodge ships off: the owner took the roll only (D9)');
  ok(evadeKind(ask({ jumpLevel: 3 }), 0, 0) === 'roll' && evadeKind(ask({ jumpLevel: 1 }), 0, 0) === 'roll', 'so a body that can jump rolls, even on the lowest draw of the second number');
  ok(evadeKind(ask({ jumpLevel: 3, canRoll: false }), 0, 0) === null && evadeKind(ask({ canRoll: false }), 0, 0) === null, 'and one that cannot be drawn rolling does nothing, jump or no jump');
  // Kept behind the knob for a comparison: raised, that share of the evades are a hop.
  const hopTune = { ...EVADE_TUNE, share: [...EVADE_TUNE.share], hopShare: 0.35 };
  ok(evadeKind(ask({ jumpLevel: 1 }), 0, 0.34, hopTune) === 'hop' && evadeKind(ask({ jumpLevel: 1 }), 0, 0.36, hopTune) === 'roll', 'with the hop turned on by hand, a body that can jump hops that share of the time and rolls the rest');
  ok(evadeKind(ask({ jumpLevel: 0 }), 0, 0, hopTune) === 'roll', '... and one that cannot jump still only rolls');
}

// --- 3: the rate, measured ----------------------------------------------------------------------------

{
  const minutes = 10;
  const rates: number[] = [];
  console.log('\n  tier | share/s | evades/min at 0.1 s | at 0.5 s | shortest gap');
  for (let tier = 0; tier <= 5; tier++) {
    const counts: number[] = [];
    let shortest = Infinity;
    for (const step of [0.1, 0.5]) {
      const c = new EvadeClock();
      let n = 0;
      let last = -Infinity;
      for (let t = 0; t < minutes * 60; t += step) {
        if (c.due(t, tier, true, true, true, true, 0, rnd(), rnd())) {
          n++;
          shortest = Math.min(shortest, t - last);
          last = t;
        }
      }
      counts.push(n / minutes);
    }
    rates.push(counts[0]);
    console.log(`   ${tier}   |  ${evadeShare(tier).toFixed(2)}   |        ${counts[0].toFixed(1)}         |   ${counts[1].toFixed(1)}   |   ${Number.isFinite(shortest) ? shortest.toFixed(1) : '-'} s`);
    ok(shortest >= EVADE_TUNE.cooldown - 1e-9, `tier ${tier} never evades twice inside the cooldown`);
    if (tier >= 2) ok(Math.abs(counts[0] - counts[1]) <= 0.25 * Math.max(counts[0], counts[1]) + 0.3, `and asked ten times a second or twice, it evades about as often (${counts[0].toFixed(1)} and ${counts[1].toFixed(1)} a minute)`);
  }
  ok(rates[0] === 0 && rates[1] === 0, 'the bottom of the ladder never evades at all');
  for (let t = 3; t <= 5; t++) ok(rates[t] > rates[t - 1], `a tier-${t} body evades more often than a tier-${t - 1} one`);
  ok(rates[5] < 60 / EVADE_TUNE.cooldown, `and even the top is held under the cooldown's own ceiling (${rates[5].toFixed(1)} of ${(60 / EVADE_TUNE.cooldown).toFixed(0)} a minute)`);

  const c = new EvadeClock();
  c.struck(10, EVADE_TUNE.shotFrom - 0.5);
  ok(!c.shotLately(10), 'a blow from close by is not somebody shooting at it');
  c.struck(10, EVADE_TUNE.shotFrom + 5);
  ok(c.shotLately(10 + EVADE_TUNE.shotFor - 0.01) && !c.shotLately(10 + EVADE_TUNE.shotFor + 0.01), `a blow from afar counts as being aimed at for ${EVADE_TUNE.shotFor} s`);
}

// --- 4: which way, who jumps, how high ----------------------------------------------------------

{
  ok(rollDirection(1, 20) === 'L' && rollDirection(-1, 20) === 'R' && rollDirection(1, EVADE_TUNE.backInside - 0.1) === 'B', 'aside on the side it was given, and back when what it fights is on top of it');
  const v = { x: 0, z: 0 };
  rollVector('L', 0, v);
  ok(near(v.x, 1) && near(v.z, 0), 'facing +Z its left is +X: a turn to its left is positive in this game');
  rollVector('R', 0, v);
  ok(near(v.x, -1) && near(v.z, 0), 'and its right is -X');
  rollVector('B', Math.PI / 2, v);
  ok(near(v.x, -1, 1e-12) && near(v.z, 0, 1e-12), 'back is straight away from its facing');

  ok(jumpLevelFor(5, 'creature', true) === 0 && jumpLevelFor(5, 'droid', false) === 0, 'creatures and droids never jump, whatever their tier');
  ok(jumpLevelFor(2, 'person', false) === 0 && jumpLevelFor(3, 'person', false) === 1 && jumpLevelFor(5, 'person', false) === 1, 'a person hops from tier 3 up, and only hops');
  ok(jumpLevelFor(1, 'person', true) === 0 && jumpLevelFor(2, 'person', true) === 2 && jumpLevelFor(3, 'person', true) === 2 && jumpLevelFor(4, 'person', true) === 3 && jumpLevelFor(5, 'person', true) === 3, 'a lightsaber carrier Force-jumps to level 2 at tiers 2 and 3, and to level 3 at 4 and 5');
  ok(jumpLevelFor(0, 'person', true) === 0, 'and tier 0 is nobody that jumps');

  for (const g of [18, 20]) {
    const h = jumpHeight(2);
    const vUp = jumpSpeed(h, g);
    ok(near((vUp * vUp) / (2 * g), h, 1e-9), `the speed upward reaches exactly the height under ${g} m/s² (${vUp.toFixed(2)} m/s for ${h.toFixed(2)} m)`);
  }
  ok(jumpSpeed(0, 20) === 0 && jumpSpeed(1, 0) === 0, 'and no height or no gravity is no jump');
  const across = jumpAcross(1.5, jumpHeight(1), 20, 'top');
  ok(across < JUMP_TUNE.across && near(across * (jumpSpeed(jumpHeight(1), 20) / 20), 1.5, 1e-9), 'to a ledge it is over its mark as it tops out');
  // A leap to level ground comes down where it was aimed: flown out under the same gravity, step by
  // step, it lands on its mark and not on twice its mark, which is where top-out timing puts it.
  for (const [g, level, mark] of [
    [9.81, 2, 5],
    [9.81, 3, 5],
    [18, 3, 5],
    [20, 1, 1.2],
  ] as const) {
    const h = jumpHeight(level);
    const vUp = jumpSpeed(h, g);
    const vAcross = jumpAcross(mark, h, g, 'land');
    let x = 0;
    let y = 0;
    let vy = vUp;
    const dt = 1 / 600;
    while (vy > 0 || y > 0) {
      vy -= g * dt;
      y += vy * dt;
      x += vAcross * dt;
    }
    ok(vAcross < JUMP_TUNE.across && Math.abs(x - mark) < 0.05, `a leap of level ${level} under ${g} m/s² to a mark ${mark} m off comes down ${x.toFixed(2)} m off`);
  }
  ok(jumpAcross(1, jumpHeight(1), 20, 'top') < JUMP_TUNE.across && near(jumpAcross(1, jumpHeight(1), 20, 'land'), jumpAcross(1, jumpHeight(1), 20, 'top') / 2), 'which is half the speed of the same jump timed to the top');
  ok(jumpAcross(1000, jumpHeight(1), 20, 'top') === JUMP_TUNE.across && jumpAcross(1000, jumpHeight(1), 20, 'land') === JUMP_TUNE.across, 'and never faster than the cap');

  const ledge = (o: Partial<LedgeAsk> = {}): LedgeAsk => ({ rise: 1, flat: 2, level: 2, grounded: true, chasing: true, free: true, outdoors: true, since: 99, ...o });
  ok(near(ledgeJump(ledge()), 1 + JUMP_TUNE.ledgeOver), 'a ledge within the jump is jumped to its lip and a little over');
  ok(ledgeJump(ledge({ rise: JUMP_TUNE.ledgeMin - 0.01 })) === 0, 'a rise the feet climb anyway is not worth a jump');
  ok(ledgeJump(ledge({ rise: jumpHeight(2) + 0.01 })) === 0 && near(ledgeJump(ledge({ rise: jumpHeight(2) })), jumpHeight(2)), 'one higher than the jump is not tried, and one right at it is jumped exactly its height');
  ok(ledgeJump(ledge({ flat: JUMP_TUNE.ledgeReach + 0.1 })) === 0, 'nor one too far off across');
  ok(ledgeJump(ledge({ outdoors: false })) === 0 && ledgeJump(ledge({ chasing: false })) === 0 && ledgeJump(ledge({ since: 0 })) === 0 && ledgeJump(ledge({ level: 0 })) === 0, 'nor indoors, nor when not chasing, nor twice at once, nor by a body that does not jump');

  // The player's own order of names, off a rig that has only some of them.
  const rig = { has: (n: string): boolean => ['BOTH_JUMP1', 'BOTH_JUMPLEFT1', 'BOTH_FORCEJUMP1', 'BOTH_INAIR1', 'BOTH_LAND1'].includes(n) };
  ok(jumpClipName('JUMP', 'L', false, rig) === 'BOTH_JUMPLEFT1' && jumpClipName('JUMP', 'R', false, rig) === 'BOTH_JUMP1', 'a jump aside takes its own clip where the rig has one, else the plain jump');
  ok(jumpClipName('JUMP', 'F', true, rig) === 'BOTH_FORCEJUMP1' && jumpClipName('INAIR', 'F', true, rig) === 'BOTH_INAIR1', 'a Force jump its own, falling back on the plain one');
  ok(jumpClipName('LAND', 'B', true, { has: () => false }) === null, 'and a rig with none gives nothing');
  ok(ROLL_CLIPS.F === 'BOTH_ROLL_F' && ROLL_CLIPS.R === 'BOTH_ROLL_R', 'the rolls are Jedi Academy’s own four');
}

// --- 5: the aim line ---------------------------------------------------------------------------------

{
  const aim: AimLine = { on: true, x: 0, y: 1.6, z: 0, dx: 0, dy: 0, dz: 1 };
  ok(aimedAt(aim, 0, 1.6, 20), 'a body on the line is aimed at');
  ok(aimedAt(aim, EVADE_TUNE.aimRadius - 0.05, 1.6, 20) && !aimedAt(aim, EVADE_TUNE.aimRadius + 0.05, 1.6, 20), `within ${EVADE_TUNE.aimRadius} m of it and no further`);
  ok(!aimedAt(aim, 0, 1.6, -5), 'nothing behind the eye');
  ok(!aimedAt(aim, 0, 1.6, EVADE_TUNE.aimReach + 1), `nothing past ${EVADE_TUNE.aimReach} m`);
  ok(!aimedAt({ ...aim, on: false }, 0, 1.6, 20) && !aimedAt(null, 0, 1.6, 20), 'and nothing at all with the gun down or no aim handed over');
}

// --- 6: the knobs --------------------------------------------------------------------------------------

{
  const share = EVADE_TUNE.share;
  const was = [...share];
  tuneEvade({ share: [0, 0, 1, 1, 1, 1], cooldown: -3, hopShare: 4 });
  ok(EVADE_TUNE.share === share && share[2] === 1, 'the share table is written in place, so a body already standing hears it');
  ok(EVADE_TUNE.cooldown === 0 && EVADE_TUNE.hopShare === 1, 'a negative cooldown is floored and a share past one is one');
  tuneEvade({ share: was, cooldown: 4, hopShare: 0, rollSpeed: Number.NaN });
  ok(share.every((v, i) => v === was[i]) && Number.isFinite(EVADE_TUNE.rollSpeed) && EVADE_TUNE.hopShare === 0, 'and back, with anything that is not a number left alone');
  const heights = JUMP_TUNE.heights;
  tuneJump({ heights: [0, 1], hopFrom: 2 });
  ok(JUMP_TUNE.heights === heights && heights[1] === 1 && jumpLevelFor(2, 'person', false) === 1, 'the jump table likewise');
  tuneJump({ heights: [0, 32 * UNIT], hopFrom: 3 });
  ok(near(jumpHeight(1), 32 * UNIT) && jumpLevelFor(2, 'person', false) === 0, 'and back');
}

// --- 7: a person's own feet ---------------------------------------------------------------------------

{
  const tac = new GroundTactics(1);
  tac.setTier(0, 'person', false);
  ok(tac.skill === null && tac.jumpLevel === 0, 'tier 0 is no row at all and no jump: the mobile this game had');
  tac.setTier(3, 'person', true);
  ok(tac.skill !== null && tac.split && tac.jumpLevel === 2, 'tier 3 has earned the split, and a lightsaber jumps at its first Force level');
  ok(near(tac.slideLean, Math.asin(tac.skill!.strafe)), 'and slides no further off its gun than the angle whose sine is its strafe');
  tac.setTier(1, 'person', false);
  ok(!tac.split && tac.jumpLevel === 0, 'tier 1 has neither');

  // The slide on its duty cycle: a body on the ring round what it shoots, ten minutes at a tenth of a
  // second, and the share of that time its **feet** go sideways rather than standing their ground --
  // measured off where it is sent (`walkTo`), not off the timer the console reads, since a timer that
  // runs while the feet never move (or feet that move on every frame whatever the timer says) is
  // exactly the failure the duty cycle is there to prevent. The body stands on its own slot (a key
  // whose slot lies within a few hundredths of a radian of its bearing, well inside the band that
  // counts as there), so the ring pulls it nowhere and every sideways step is the slide's.
  let key = 2;
  while (Math.abs(((key * 0.6180339887498949) % 1) - 0.5) > 0.002) key++;
  const slotOff = Math.abs((((key * 0.6180339887498949) % 1) - 0.5) * 2 * GROUND_STEP.ringSpread);
  const slid: number[] = [];
  let timerAgrees = true;
  const ring = 20 * GROUND_STEP.standoff;
  ok(ring * slotOff < Math.max(1, ring * 0.15), `a body keyed ${key} stands on its own slot (${(ring * slotOff).toFixed(2)} m off it), so the ring asks nothing of its feet`);
  for (const tier of [1, 3, 5]) {
    const t = new GroundTactics(1);
    t.setTier(tier, 'person', false);
    let sliding = 0;
    let frames = 0;
    for (let s = 0; s < 600; s += 0.1) {
      frames++;
      const moved = t.stepStandoff(s, 0, ring, 0, 0, ring, key, true, false, 20, 3, rnd);
      // Outward is +z here, so sideways is along x: the component of the step across the ring's radius.
      const across = moved ? Math.abs(t.walkTo.x) : 0;
      const slides = across > 1e-6;
      if (slides) sliding++;
      if (slides !== t.status(s, 0, ring).sliding) timerAgrees = false;
    }
    slid.push(sliding / frames);
  }
  console.log(`\n  on its own ring, the share of the time a body's feet slide: tier 1 ${slid[0].toFixed(2)}, tier 3 ${slid[1].toFixed(2)}, tier 5 ${slid[2].toFixed(2)}`);
  ok(slid[0] === 0, 'a tier-1 body on its ring stands and shoots: its feet never slide');
  ok(slid[1] > 0 && slid[2] > slid[1], 'tier 3 slides some of the time and tier 5 more of it');
  const most = GROUND_STEP.slideFor / GROUND_STEP.flipEvery;
  ok(slid[2] < most + 0.05, `and even the top of the ladder stands its ground between slides, or it would never kneel: at most ${(most * 100).toFixed(0)}% of the time`);
  ok(timerAgrees, "and the console's `sliding` reads true on exactly the frames the feet went sideways");
  const t = new GroundTactics(1);
  t.setTier(5, 'person', false);
  ok(!t.stepStandoff(0, 5, 0, 0, 0, 5, 7, false, false, 20, 3, rnd), 'a body neither shooting nor chasing with a clear shot holds no ring at all');
  ok(t.stepStandoff(0, 3, 0, 0, 0, 3, 7, true, false, 20, 3, rnd) && !t.leanOnly, 'one right on top of what it fights backs off, and backing off is the one move that is not a slide');
  ok(Math.hypot(t.walkTo.x, t.walkTo.z) > 3, '... away from it');

  // A pack's own low postures, out of the humanoid table's own logical names.
  const logical: Record<string, string[]> = {
    loop_kneeling: ['k_idle'],
    loop_prone: ['p_idle', 'p_crawl'],
    loop_crouched: ['c_idle', 'c_walk'],
    loop_rifle_kneeling: ['rk_relaxed'],
    loop_rifle_kneeling_combat: ['rk_ready'],
    loop_rifle_kneeling_combat_aimed: ['rk_aim'],
    loop_rifle_combat_prone_aimed: ['rp_aim', 'p_crawl'],
    rifle_kneeling_fire_1: ['rk_fire1'],
    rifle_kneeling_fire_3: ['rk_fire3'],
    add_rifle_fire_1: ['r_recoil'],
    rifle_combat_prone_fire_1: ['rp_fire1'],
    trn_standing_to_kneeling: ['t_s_k'],
  };
  const clips = [{ name: 'c_walk', loop: true, frames: 30, fps: 30, duration: 1, speed: 0.9, names: ['loop_crouched'] }];
  const all = new Set(Object.values(logical).flat());
  const has = (n: string): boolean => all.has(n);
  const low = lowClipsFor({ logical, clips }, 'rifle', has)!;
  ok(!!low && low.crouch === 'c_idle' && low.crouchWalk === 'c_walk' && low.crouchSpeed === 0.9, 'the crouch is its idle and its walk, the walk at its own speed');
  ok(low.kneel.aim === 'rk_aim' && low.kneel.ready === 'rk_ready' && low.kneel.relaxed === 'rk_relaxed' && low.prone.aim === 'rp_aim', 'the kneel and prone loops are the rifle’s own, the idle and never the crawl');
  ok(low.fires.kneel.length === 2 && low.fires.kneel.includes('rk_fire1') && !low.fires.kneel.includes('r_recoil') && low.fires.prone[0] === 'rp_fire1', 'the shots are the whole-body kneeling and prone fires, never a recoil authored over a standing body');
  ok(low.canProne, 'a pack with a prone loop can lie a body down');
  ok(lowLoop(low, 'kneel', 'aim') === 'rk_aim' && lowLoop(low, 'prone', 'ready') === 'rp_aim' && lowLoop(low, 'crouch', 'aim') === 'c_idle' && lowLoop(low, 'stand', 'aim') === null, 'a posture stands in its stance’s own loop, else the nearest the pack has');
  ok(lowTransition({ logical }, 'stand', 'kneel', false, has) === 't_s_k' && lowTransition({ logical }, 'kneel', 'prone', false, has) === null, 'and goes down through the game’s own one-shot where the pack has it');
  ok(lowClipsFor({ logical: { loop_prone: ['p'] }, clips: [] }, 'rifle', () => true) === null, 'a pack without the kneel and the crouch cannot draw the low postures at all');
  // A pack whose only rifle shot is the additive recoil: the fire patterns do reach it for a kneel (the
  // fighters' own list names `add_rifle_fire_N` as its third choice), and it must still not be taken,
  // since it was authored over a standing body. The kneel and the prone then have no shots of their
  // own and the body falls back on the standing ones, as `Mobile.fight` does with an empty list.
  const recoilOnly: Record<string, string[]> = {
    loop_kneeling: ['k_idle'],
    loop_crouched: ['c_idle'],
    loop_rifle_kneeling_combat_aimed: ['rk_aim'],
    add_rifle_fire_1: ['r_recoil'],
    add_rifle_fire_2: ['r_recoil2'],
  };
  const recoilHas = (n: string): boolean => Object.values(recoilOnly).flat().includes(n);
  const noRecoil = lowClipsFor({ logical: recoilOnly, clips: [] }, 'rifle', recoilHas)!;
  ok(!!noRecoil && noRecoil.fires.kneel.length === 0 && noRecoil.fires.prone.length === 0, 'a pack whose only rifle shot is the standing recoil gives a kneeling or prone body no shot of its own rather than the recoil');
  // And a pack with no prone loop at all: the rule must never lay such a body down.
  ok(!noRecoil.canProne && noRecoil.prone.aim === null && noRecoil.prone.plain === null, 'a pack with no prone loop cannot lie a body down');
  ok(lowLoop(noRecoil, 'kneel', 'aim') === 'rk_aim' && lowLoop(noRecoil, 'prone', 'aim') === null, '... while its knee is drawn as the pack has it');

  // A cover spot, against a wall that is only numbers: a slab 1.6 m tall a metre and a half wide at z = 5.
  const wall = { x: 0, z: 5, radius: 0.8, topY: 1.6 };
  const deps: CoverDeps = {
    blockers: (_x, _z, _r, out) => {
      out[0].x = wall.x;
      out[0].z = wall.z;
      out[0].radius = wall.radius;
      out[0].topY = wall.topY;
      return 1;
    },
    // Anything crossing the slab's plane within its span below its top is stopped at the plane.
    hit: (ax, ay, az, bx, by, bz) => {
      if ((az - wall.z) * (bz - wall.z) > 0) return Infinity;
      const f = (wall.z - az) / (bz - az);
      const x = ax + (bx - ax) * f;
      const y = ay + (by - ay) * f;
      if (Math.abs(x - wall.x) > wall.radius || y > wall.topY) return Infinity;
      return Math.hypot(bx - ax, by - ay, bz - az) * f;
    },
    floor: () => 0,
  };
  coverSearch.forget();
  const tc = new GroundTactics(1);
  tc.setTier(5, 'person', false);
  // The threat is out past the slab; the body stands in the open to one side.
  const got = tc.stepCover(0, deps, 3, 0, 0, 1, 0, 0.9, 30, true, false);
  ok(got && tc.coverKind === 'hard' && tc.walkTo.z < wall.z, `a tier-5 person asked for cover takes the spot behind the slab from the threat (a ${tc.coverKind} one, ${Math.hypot(tc.walkTo.x - 3, tc.walkTo.z).toFixed(1)} m off)`);
  const sx = tc.coverX;
  const sz = tc.coverZ;
  ok(tc.stepCover(1, deps, sx, 0, sz, 1, 0, 0.9, 30, true, false) && tc.inSpot(sx, sz), 'standing in it, it holds it');
  let held = 1;
  for (let s = 1; s < 30 && tc.coverKind !== null; s += 0.25) {
    tc.stepCover(s, deps, sx, 0, sz, 1, 0, 0.9, 30, true, false);
    if (tc.coverKind !== null) held = s;
  }
  ok(held <= 1 + GROUND_STEP.hardFor + 0.5, `a spot it cannot shoot out of is a duck and not a position: given up after about ${GROUND_STEP.hardFor} s (${(held - 1).toFixed(2)} s)`);
  ok(!tc.stepCover(held + 2, deps, sx, 0, sz, 1, 0, 0.9, 30, true, false) && tc.coverKind === null, '... and it does not duck straight back into it while it rests');
  const unasked = new GroundTactics(1);
  unasked.setTier(5, 'person', false);
  ok(!unasked.stepCover(0, deps, 3, 0, 0, 1, 0, 0.9, 30, false, false) && unasked.coverKind === null, 'nothing is looked for unless the brain asks');
  const none = new GroundTactics(1);
  none.setTier(0, 'person', false);
  ok(!none.stepCover(0, deps, 3, 0, 0, 1, 0, 0.9, 30, true, false) && none.coverKind === null, 'and a body with no tier never looks at all');
  // Every search goes through the one shared searcher and is counted against its budget a step: a
  // step's worth of people asking at once, one more than the budget, and the last is turned away to ask
  // again next step, exactly as a fighter is.
  coverSearch.forget();
  const budget = COVER_TUNE.perStep;
  let took = 0;
  for (let i = 0; i <= budget; i++) {
    const g = new GroundTactics(1);
    g.setTier(5, 'person', false);
    if (g.stepCover(50, deps, 3, 0, 0, 1, 0, 0.9, 30, true, false)) took++;
  }
  const searched = coverSearch.status();
  ok(budget > 0 && searched.asked === budget + 1 && searched.deferred === 1 && took <= budget, `${budget + 1} people asking in one step: the shared searcher is asked ${searched.asked} times and turns ${searched.deferred} away (${took} took a spot)`);
  const later = new GroundTactics(1);
  later.setTier(5, 'person', false);
  ok(later.stepCover(50.1, deps, 3, 0, 0, 1, 0, 0.9, 30, true, false) && coverSearch.status().deferred === 1, '... and the next step it is heard');
}

// --- 8: the wiring, read as text ---------------------------------------------------------------------
//
// `mobile.ts` and `npcs.ts` are browser modules that drag the whole world in, so no body can be stood
// here; everything above is the rule, and what follows is that each body really asks it. Each line is a
// place where deleting one call left every other test green.

{
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mobile = src('world/mobiles/mobile.ts');
  const npcs = src('world/npcs.ts');
  /** A method's body, braces matched, from the first `{` after its signature. */
  const body = (text: string, signature: RegExp): string => {
    const m = signature.exec(text);
    assert.ok(m, `no ${signature} in the source`);
    let i = text.indexOf('{', m.index + m[0].length - 1);
    const start = i;
    let depth = 0;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) break;
    }
    return text.slice(start, i + 1);
  };
  const mobileFight = body(mobile, /private fight\(ctx: MobileContext, d: Decision \| null\): void \{/);
  // The brain says `cover` for a tiered person behind something, in place of `attack`.
  ok(/if \(!target \|\| !d \|\| \(d\.state !== 'attack' && d\.state !== 'cover'\)\) return;/.test(mobileFight) && !/d\.state !== 'attack'\) return;/.test(mobileFight), "a person shoots from `cover` as from `attack`: the brain's word for a tiered gunner behind something");
  ok(/this\.state === 'attack' \|\| this\.state === 'cover';/.test(body(mobile, /get busy\(\): boolean \{/)), '... and is never frozen off screen there, as it is not while it attacks');
  ok(/if \(skill && d\.attack === 'ranged' && !willFire\(skill, this\.aimErr\)\) return;/.test(mobileFight), "a tiered person's trigger waits for its gun inside its tier's cone, the fighters' own measure");
  const mobileAct = body(mobile, /private act\(dt: number, ctx: MobileContext, tier: LodTier\): void \{/);
  ok(/this\.aimErr = Math\.atan2\(Math\.sin\(want - this\.facing\), Math\.cos\(want - this\.facing\)\);\s*this\.facing \+= clamp\(this\.aimErr, -turn, turn\);/.test(mobileAct), '... measured before the gun turns, which is the turn still to make');
  ok(/t\.setTier\(override \?\? tierOfLevel\(this\.level\), 'person', !!this\.blade\);/.test(body(mobile, /applyFightTier\(override: number \| null = null\): void \{/)), "a person's tier is its own level's unless the console says otherwise");
  // The brain keeps a target on a ledge only for a body that says how far it jumps.
  ok(/jumpReach: this\.tactics && !this\.inside \? jumpHeight\(this\.tactics\.jumpLevel\) : 0,/.test(body(mobile, /private think\(ctx: MobileContext\): void \{/)), 'a person tells the brain how far up it jumps');
  ok(/jumpReach: this\.cell \? 0 : jumpHeight\(this\.jumpLevel\),/.test(npcs), '... and so does a fighter');
  ok(/this\.stepEvade\(ctx\);/.test(body(mobile, /private think\(ctx: MobileContext\): void \{/)) && /this\.stepEvade\(aim, now, d\);/.test(body(npcs, /private think\(foes: readonly Living\[\], now: number, aim: AimLine \| null\): void \{/)), 'both ask whether to evade once a thought');
  // Aimed at only while it has a fight: a person at its post looked at down a raised gun does not roll.
  ok(/\(this\.fighting\(\) && aimedAt\(ctx\.aim,/.test(body(mobile, /private stepEvade\(ctx: MobileContext\): void \{/)), "a person counts the player's aim only while it is fighting");
  ok(/\(!!t && !t\.dead && aimedAt\(aim,/.test(body(npcs, /private stepEvade\(aim: AimLine \| null, now: number, d: Decision\): void \{/)), '... and a fighter only while it has something to fight');
  // The roll is Jedi Academy's own, on the low shell, and it ends on its feet.
  for (const [who, text] of [
    ['a person', mobile],
    ['a fighter', npcs],
  ] as const) {
    const start = body(text, /private startRoll\(dir: RollDir\): (boolean|void) \{/);
    ok(/rollAt\.x \* EVADE_TUNE\.rollSpeed/.test(start) && /this\.rollLeft = EVADE_TUNE\.rollTime;/.test(start), `${who} rolls at Jedi Academy's own speed for its own length of time`);
    ok(/const low = this\.posture !== 'stand' \|\| this\.rollLeft > 0;/.test(body(text, /private reshape\(\): void \{/)), `${who} rolls on the low shell`);
    const step = body(text, /private stepTumble\(s?dt: number\): void \{/);
    ok(/const left = this\.rollLeft - s?dt;[\s\S]*?if \(left <= 0\) this\.endTumble\(\);\s*else this\.rollLeft = left;/.test(step) && !/this\.rollLeft -= /.test(text), `${who} ends its roll while it is still rolling, so the guarded end stands its shell up again and asks the cull`);
    ok(/if \(!this\.tumbling\) return;/.test(body(text, /private endTumble\(\): void \{/)), `... which is the guard that makes that order matter for ${who}`);
  }
  // A person's jump flies undamped and has its damping back when it lands.
  ok(/this\.body\.setLinearDamping\(0\);/.test(body(mobile, /private startJump\(height: number, dx: number, dz: number, across: number, dir: RollDir\): boolean \{/)) && /this\.body\.setLinearDamping\(BODY_DAMPING\);/.test(body(mobile, /private endTumble\(\): void \{/)) && /\.setLinearDamping\(BODY_DAMPING\)/.test(mobile), "a person's jump is thrown undamped, so it reaches the height it was thrown for, and lands with the body's own damping back");
  // A leap to level ground is timed to land on its mark; a ledge to top out over it.
  ok(/jumpAcross\(gap, height, this\.gravityNow\(\), 'top'\)/.test(mobile) && /jumpAcross\(gap - EVADE_TUNE\.leapFrom \* 0\.5, height, this\.gravityNow\(\), 'land'\)/.test(mobile), "a person's ledge jump tops out over the lip and its leap lands on its mark");
  ok(/jumpAcross\(gap, height, FIGHTER_BODY\.gravity, 'top'\)/.test(npcs) && /jumpAcross\(gap - EVADE_TUNE\.leapFrom \* 0\.5, height, FIGHTER_BODY\.gravity, 'land'\)/.test(npcs), "... and so do a fighter's");
}

console.log(`\n${checks} checks passed`);
