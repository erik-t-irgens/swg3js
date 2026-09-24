// How low a fighter stands (src/world/fighterStance.ts's posture half, which src/world/npcs.ts
// runs), and whether going low really does anything.
//
// Six things are pinned here, and the fourth is the one the design could not answer from a hidden
// tab at all.
//
// **Being shot at does not stand a body up.** This is the property the posture exists for, and it
// is first because the rule failed it: `Npc.damage` sets a short stagger on every blow, a single
// bolt included, the rule read that stagger, and a fighter therefore went upright for exactly as
// long as anybody was shooting at it. The settle does not damp a thing like that -- it caps how
// often the answer may be acted on, never what the answer is -- so the loop `Npc.update` runs is
// run here, under fire, and what it used to do is measured beside what it does now rather than
// described.
//
// **The four words mean what the client's data says they mean.** A crouch is the pose a body
// *moves* low in and carries no action of any kind; a kneel is the pose it *fights* low in and has
// twelve fires of its own; neither a kneel nor a prone body moves a metre, because the kneel has no
// walk clip and a prone body has no route anywhere but back up. Those are three counts out of the
// archives, and here they are three branches driven against the very functions the game runs.
//
// **The capsule and the aim point move together.** They are two numbers in two different places and
// nothing but this file stops them drifting: moved apart, either a shot goes through a body it
// should have missed or a shooter aims over its head. Both come out of pure functions and the feet
// are measured to stay exactly on the ground in every posture.
//
// **A body that has gone low is really harder to hit -- and by exactly how much.** Not a mirror of
// the physics and not an assertion about a number: a real rapier world is built, the fighter's own
// capsule is put in it, reshaped by the very arithmetic `Npc.resize` reshapes one with, and then
// shot at with rays at a sweep of heights. What the test prints is the band of heights that a low
// body has left, which is the whole of the answer to "does prone work as cover", and it is measured
// rather than claimed.
//
// **The clip names are the player's.** The posture transitions and the per-posture shots are lifted
// out of `player.ts` so that a fighter and the player change posture and fire by the same names.
// This file reads `player.ts` as text and fails if either drifts, the way `fighterStance.test.ts`
// reads the player's own controller numbers.
//
// **And the word rides the brain's own decision**, defaulting to standing for every body in the
// world, so nothing of the wildlife's moved when the field was added.
//
// Synthetic throughout: every shape, height, clip name and angle below is written in this file, and
// nothing comes from the game's own archives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Physics, RAPIER } from '../../../src/core/physics.ts';
import {
  FIGHTER_BODY,
  POSTURE_TUNE,
  aimPointFor,
  capsuleDrop,
  capsuleDropFor,
  capsuleHalfFor,
  capsuleTopFor,
  firePatterns,
  paceInPosture,
  postureFor,
  postureTransitionNames,
  tuneFighterBody,
  tunePosture,
  type Posture,
  type PostureInput,
} from '../../../src/world/fighterStance.ts';
import { decide, type BrainSelf } from '../../../src/world/mobiles/brain.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const playerSrc = readFileSync(join(root, 'src', 'player', 'player.ts'), 'utf8');
const npcSrc = readFileSync(join(root, 'src', 'world', 'npcs.ts'), 'utf8');

// --- 1: the rule, branch by branch --------------------------------------------------------------
//
// A gunner holding its ground at range, which is the case the owner will see first, and then every
// way out of it.

/** A fighter shooting at something twelve metres off, at full health, standing still. */
const shooting = (over: Partial<PostureInput> = {}): PostureInput => ({
  grounded: true,
  gun: true,
  combat: true,
  shooting: true,
  gap: 12,
  hpRatio: 1,
  pace: 'stand',
  held: false,
  canProne: true,
  was: 'stand',
  ...over,
});

{
  ok(postureFor(shooting()) === 'kneel', 'a gunner holding its ground and firing at twelve metres goes down on one knee');
  ok(postureFor(shooting({ gap: 3 })) === 'stand', '... and shoots standing at three, where kneeling in somebody’s face would read as a bug');
  ok(postureFor(shooting({ gap: POSTURE_TUNE.kneelFrom })) === 'kneel', 'the near limit is taken the generous way: exactly at it, it kneels');
  ok(postureFor(shooting({ gap: Number.NaN })) === 'stand', 'and a distance that is not a number stands it up rather than kneeling it');

  ok(postureFor(shooting({ hpRatio: 0.4 })) === 'prone', 'hurt past half its health, and far enough off to have somewhere to shoot from, it lies down instead');
  ok(postureFor(shooting({ hpRatio: 0.4, gap: 7 })) === 'kneel', '... but not at seven metres, where a body that cannot back off is not in cover');
  ok(postureFor(shooting({ hpRatio: POSTURE_TUNE.proneUnder + 0.01 })) === 'kneel', 'a scratch is not a reason to lie down');
  ok(postureFor(shooting({ hpRatio: 0.4, canProne: false })) === 'kneel', 'and a rig with no prone loop to draw it with kneels instead: the posture is a 1.0 m shell and a 0.5 m aim point, not a pose, so a body that cannot lie down must not be laid down');

  ok(postureFor(shooting({ gun: false })) === 'stand', 'nothing with a blade ever goes low: it has to close to strike at all');
  ok(postureFor(shooting({ combat: false })) === 'stand', 'out of a fight it stands up');
  ok(postureFor(shooting({ grounded: false })) === 'stand', 'off its feet -- knocked, thrown, gripped -- it is not choosing a posture');
  ok(postureFor(shooting({ held: true })) === 'stand', 'and a body under a long walk never goes down at all, so the walk is what it always was');

  ok(postureFor(shooting({ pace: 'run' })) === 'stand', 'nobody runs low, and the game has no clip for it either');
  ok(postureFor(shooting({ pace: 'run', was: 'prone' })) === 'stand', '... so a body told to run gets up, whatever it was in');
}

{
  // **Being shot at must not stand a body up.** This is the property the whole posture is bought
  // for, and the rule failed it for a round: `Npc.damage` sets a short stagger on every blow, a
  // single bolt included, and `postureFor` read that stagger. The settle does not damp it -- it
  // caps how often the answer may be *acted on*, never what the answer is -- so under fire a
  // fighter merely alternated more slowly. It is pinned three ways here: as the shape of the rule,
  // as the wiring in `npcs.ts`, and as a run of the very loop `Npc.update` runs.
  const stanceSrc = readFileSync(join(root, 'src', 'world', 'fighterStance.ts'), 'utf8');
  // The rule's own body, not the whole file: `aimMode` reads a stagger beside it and is right to,
  // since the recoil and a stagger are both reasons to *hold* an aim where it stands.
  const ruleBody = stanceSrc.split('export function postureFor(')[1]?.split('\n}')[0] ?? 'stunned';
  ok(!/stunned/.test(ruleBody), 'no stagger of any kind is in the posture rule');
  ok(/o\.stunned/.test(stanceSrc.split('export function aimMode(')[1]?.split('\n}')[0] ?? ''), '... while the aim beside it still holds through one, which is the player’s own early return and is a different question');
  ok(!npcSrc.includes('postureAsk.stunned'), '... and `npcs.ts` does not offer it one');
  ok(npcSrc.includes('postureAsk.grounded = this.grounded;'), 'only being off its feet does, which is what a real knock, a throw and a Force grip all write');
  ok(/knock\(dir: THREE\.Vector3, power: number\)[\s\S]{0,700}this\.grounded = false;/.test(npcSrc), 'and a knock hard enough to matter really does write it, so nothing was lost by dropping the stagger');

  // The flinch a single bolt costs, read out of `damage` itself so this cannot pass against a
  // number that has moved.
  const flinch = Number(/this\.hp -= amount;\s*\n\s*this\.stunned = Math\.max\(this\.stunned, ([\d.]+)\);/.exec(npcSrc)?.[1] ?? Number.NaN);
  ok(Number.isFinite(flinch) && flinch > 0, `every blow still staggers this body for ${flinch} s -- the rule simply does not read it`);

  // Ten seconds of a firefight at 1/60, shot every 1.5 s, in `Npc.update`'s own order: the stagger
  // decays by the step, the blow refreshes it, then the posture is asked and the settle gates it.
  const firefight = (everySeconds: number, readsStagger: boolean): { upright: number; changes: number } => {
    const dt = 1 / 60;
    let stunned = 0;
    let held = 0;
    let was: Posture = 'stand';
    let upright = 0;
    let changes = 0;
    let nextShot = 0;
    for (let t = 0; t < 10; t += dt) {
      stunned = Math.max(0, stunned - dt);
      if (t >= nextShot) {
        stunned = Math.max(stunned, flinch);
        nextShot += everySeconds;
      }
      held = Math.max(0, held - dt);
      // The rule as it stands, and the rule as it stood, are the same call but for one term.
      const want = readsStagger && stunned > 0 ? 'stand' : postureFor(shooting({ was }));
      if (want !== was && held <= 0) {
        held = POSTURE_TUNE.settle;
        was = want;
        changes++;
      }
      if (was === 'stand') upright += dt;
    }
    return { upright: upright / 10, changes };
  };

  const under = firefight(1.5, false);
  ok(under.changes === 1 && under.upright < 0.05, `shot every 1.5 seconds it goes down once and stays down: upright ${(under.upright * 100).toFixed(0)}% of the fight, ${under.changes} change of posture`);
  const fast = firefight(0.2, false);
  ok(fast.changes === 1 && fast.upright < 0.05, `and under five shots a second it is still down: upright ${(fast.upright * 100).toFixed(0)}%, ${fast.changes} change`);

  // And what it used to do, measured rather than asserted, so the regression has a number beside it.
  const old = firefight(1.5, true);
  ok(old.upright > 0.3 && old.changes > 6, `whereas reading the stagger put it upright ${(old.upright * 100).toFixed(0)}% of the same fight with ${old.changes} changes of posture -- which is a body doing press-ups under fire`);
  const oldFast = firefight(0.2, true);
  ok(oldFast.upright > 0.9, `and at five shots a second, upright ${(oldFast.upright * 100).toFixed(0)}% of it: it never knelt again`);
}

{
  // Not shooting: the posture is kept rather than dropped, because the combat window is five
  // seconds long and a body that sprang up the frame its target died and knelt again a second later
  // would be doing press-ups.
  ok(postureFor(shooting({ shooting: false, was: 'kneel' })) === 'kneel', 'a fighter whose target has just died holds its firing position rather than springing up');
  ok(postureFor(shooting({ shooting: false, was: 'stand' })) === 'stand', 'and one that was standing stays standing');
  ok(postureFor(shooting({ shooting: false, was: 'kneel', pace: 'walk' })) === 'crouch', 'asked to walk, a low body stays low: the crouch is the game’s own moving low pose');
  ok(postureFor(shooting({ shooting: false, was: 'prone', pace: 'walk' })) === 'crouch', '... and one lying down gets up into it rather than crawling');
  ok(postureFor(shooting({ shooting: false, was: 'stand', pace: 'walk' })) === 'stand', 'a body that was upright does not duck merely because it is walking');
  ok(postureFor(shooting({ shooting: false, was: 'crouch', combat: false })) === 'stand', 'and the end of the fight brings it up wherever it was');
}

{
  // Every posture is reachable and no fifth word is: the rule is a total function of four values.
  const seen = new Set<Posture>();
  for (const gap of [2, 7, 12, 30]) {
    for (const hp of [1, 0.4]) {
      for (const pace of ['stand', 'walk', 'run'] as const) {
        for (const was of ['stand', 'crouch', 'kneel', 'prone'] as const) {
          for (const fire of [true, false]) seen.add(postureFor(shooting({ gap, hpRatio: hp, pace, was, shooting: fire })));
        }
      }
    }
  }
  ok(seen.size === 4 && seen.has('stand') && seen.has('crouch') && seen.has('kneel') && seen.has('prone'), 'all four postures are reachable from the rule and no fifth word ever comes out of it');
}

{
  tunePosture({ kneelFrom: 50 });
  ok(postureFor(shooting()) === 'stand', 'the knob really moves the rule: pushed out to fifty metres, nothing kneels at twelve');
  tunePosture({ kneelFrom: -4, proneUnder: -1, settle: -1 });
  ok(POSTURE_TUNE.kneelFrom === 0 && POSTURE_TUNE.proneUnder === 0 && POSTURE_TUNE.settle === 0, 'and nothing here goes negative');
  tunePosture({ settle: Number.NaN });
  ok(POSTURE_TUNE.settle === 0, 'a number that is not one is ignored rather than written');
  tunePosture({ kneelFrom: 6, proneUnder: 0.5, proneFrom: 10, settle: 0.6 });
  ok(POSTURE_TUNE.kneelFrom === 6 && POSTURE_TUNE.proneUnder === 0.5, 'the baked numbers go back');
  // Read out of `npcs.ts` rather than written here as a literal: `FIGHTER_TUNE` lives in a browser
  // module a node test cannot import (it reaches three), and against a hard-coded 0.25 raising the
  // nerve's own threshold would have made prone unreachable with every check still green -- which
  // is exactly what the note beside `proneUnder` claims this line stops.
  const fleeUnder = Number(/^\s*fleeUnder:\s*([\d.]+),/m.exec(npcSrc)?.[1] ?? Number.NaN);
  ok(Number.isFinite(fleeUnder), `the nerve's own threshold is read out of npcs.ts, and it is ${fleeUnder}`);
  ok(POSTURE_TUNE.proneUnder > fleeUnder, `and the prone threshold stands above it (${POSTURE_TUNE.proneUnder} > ${fleeUnder}), or a body would flee before it ever lay down`);
}

// --- 2: what a posture lets a body do -----------------------------------------------------------
//
// The client's own data, not a tuning choice: the crouch's clip set is an idle and a walk, the
// kneel's is an idle and no walk at all, and a prone body has no route anywhere in the hierarchy
// except back up through standing or kneeling.

{
  for (const pace of ['stand', 'walk', 'run'] as const) {
    ok(paceInPosture(pace, 'stand') === pace, `standing, a body goes at whatever pace the brain asked for (${pace})`);
    ok(paceInPosture(pace, 'kneel') === 'stand', `kneeling it does not move at all (asked for ${pace})`);
    ok(paceInPosture(pace, 'prone') === 'stand', `and lying down it does not move at all either (asked for ${pace})`);
  }
  ok(paceInPosture('walk', 'crouch') === 'walk', 'a crouch walks, which is the one thing it is for');
  ok(paceInPosture('run', 'crouch') === 'walk', '... and a crouch asked to run walks instead rather than sprinting on its haunches');
  ok(paceInPosture('stand', 'crouch') === 'stand', 'and stands still when it is asked to');

  // The two halves together are the answer to "what does a prone fighter do when it is sent
  // somewhere": it gets up first. There is no frame in which it is both prone and travelling.
  let posture: Posture = 'prone';
  let moved = 0;
  for (let i = 0; i < 4; i++) {
    const want = postureFor(shooting({ shooting: false, was: posture, pace: 'walk' }));
    if (paceInPosture('walk', posture) !== 'stand') moved++;
    posture = want;
  }
  ok(posture === 'crouch' && moved > 0, 'a prone body told to go somewhere stands into a crouch and only then walks');
  ok(moved === 3, '... and covers no ground at all on the frame it is still lying down (it moved on 3 of the 4 frames, the first being the one it got up on)');
}

// --- 3: the capsule and the aim point, and whether going low is worth anything -------------------

{
  ok(FIGHTER_BODY.standHalf === 0.45 && FIGHTER_BODY.radius === 0.35, "the standing shell is the player's 1.6 m");
  ok(playerSrc.includes('const CROUCH_HALF_HEIGHT = 0.15;') && FIGHTER_BODY.lowHalf === 0.15, "and the low one is the player's own crouch collider, 1.0 m");
  ok(near(capsuleTopFor('stand'), 1.6, 1e-12), 'a standing fighter is 1.6 m of shell');
  for (const p of ['crouch', 'kneel', 'prone'] as const) ok(near(capsuleTopFor(p), 1.0, 1e-12), `and one that is ${p === 'prone' ? 'lying down' : p === 'kneel' ? 'kneeling' : 'crouched'} is 1.0 m, one shape for all three in this first pass`);

  // The feet are the point it stands on, in every posture: the body never moves, only the collider
  // under it, so this is the invariant that says a kneeling fighter is not sunk into the floor.
  for (const p of ['stand', 'crouch', 'kneel', 'prone'] as const) {
    const half = capsuleHalfFor(p);
    const centreOverFeet = FIGHTER_BODY.halfHeight + capsuleDropFor(half);
    ok(near(centreOverFeet - half - FIGHTER_BODY.radius, 0, 1e-12), `${p}: the capsule's feet are exactly the point the body stands on`);
    ok(aimPointFor(p) * 0.9 < capsuleTopFor(p) && aimPointFor(p) * 0.9 > 0, `${p}: the point a fighter really shoots at (nine tenths of the middle) is inside the shell`);
  }
  // Standing, the two are deliberately *not* the same number and never have been: the aim point is
  // half the 1.8 m drawn body and the shell is the player's 1.6 m capsule. Low, they are the same,
  // because the low aim point is derived from the low shell rather than invented beside it -- which
  // is what keeps them from drifting when the knob moves.
  ok(near(aimPointFor('stand'), 0.9, 1e-12) && !near(aimPointFor('stand'), FIGHTER_BODY.radius + FIGHTER_BODY.standHalf, 1e-6), 'standing, the aim point is half the drawn body and is not the capsule’s middle, which it never was');
  for (const p of ['crouch', 'kneel', 'prone'] as const) ok(near(aimPointFor(p), FIGHTER_BODY.halfHeight + capsuleDropFor(capsuleHalfFor(p)), 1e-12), `${p}: the aim point is the middle of the very shell that is there to be hit`);
  ok(near(capsuleDropFor(FIGHTER_BODY.standHalf), capsuleDrop(), 1e-12), 'and the standing drop is the one the file already shipped, unchanged');

  // Moved apart they are wrong in one of two ways, which is why they are one call. Measured here
  // rather than asserted, so the sentence in the source is this file's arithmetic.
  ok(aimPointFor('stand') - aimPointFor('kneel') > 0.35, `aim at a standing body's middle and you miss a low one by ${(aimPointFor('stand') - aimPointFor('kneel')).toFixed(2)} m of height`);
  ok(capsuleTopFor('stand') - capsuleTopFor('kneel') > 0.5, `and leave the shell standing and a low body is still a ${capsuleTopFor('stand').toFixed(1)} m pillar`);

  tuneFighterBody({ lowHalf: 0 });
  ok(near(capsuleTopFor('prone'), 0.7, 1e-12) && near(aimPointFor('prone'), 0.35, 1e-12), 'the low shell is one live number: at nought it is a 0.7 m ball, the lowest the player’s own width allows, and the aim point follows it down');
  tuneFighterBody({ lowHalf: -5 });
  ok(FIGHTER_BODY.lowHalf === 0, 'and it never goes negative');
  tuneFighterBody({ lowHalf: 0.15 });
  ok(FIGHTER_BODY.lowHalf === 0.15, 'the shipped number goes back');
}

// --- 4: shot at, in a real physics world --------------------------------------------------------
//
// The question nobody could answer from a hidden tab: is a body that has gone down actually harder
// to hit? A bolt is a ray against the physics world and the struck collider is mapped back to a
// body, so this is exactly the test the game itself runs, one ray at a time.

const physics = await Physics.create();
const world = physics.world;

/** The fighter's own body, made the way `npcs.ts` makes one: the collider hangs under the kinematic body. */
const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, FIGHTER_BODY.halfHeight, 0));
const collider = world.createCollider(RAPIER.ColliderDesc.capsule(FIGHTER_BODY.standHalf, FIGHTER_BODY.radius).setTranslation(0, capsuleDrop(), 0), body);

/** `Npc.resize`, to the line: the shell for a posture, written on the parent and in the world. */
function shape(p: Posture): void {
  const half = capsuleHalfFor(p);
  collider.setHalfHeight(half);
  collider.setTranslationWrtParent({ x: 0, y: capsuleDropFor(half), z: 0 });
  collider.setTranslation({ x: 0, y: FIGHTER_BODY.radius + half, z: 0 });
  physics.step(1 / 60);
}

/** Whether a shot crossing at this height off the ground finds the body: one ray, ten metres out. */
function shotAt(height: number): boolean {
  const ray = new RAPIER.Ray({ x: 0, y: height, z: -10 }, { x: 0, y: 0, z: 1 });
  return world.castRay(ray, 20, true) !== null;
}

/** The heights, of a sweep from the ground to over a standing head, at which a shot finds it. */
function bandOf(p: Posture): { lowest: number; highest: number; hits: number; of: number } {
  shape(p);
  let lowest = Infinity;
  let highest = -Infinity;
  let hits = 0;
  let of = 0;
  for (let h = 0.05; h <= 2.0001; h += 0.05) {
    of++;
    if (!shotAt(h)) continue;
    hits++;
    lowest = Math.min(lowest, h);
    highest = Math.max(highest, h);
  }
  return { lowest, highest, hits, of };
}

{
  physics.step(1 / 60);
  const up = bandOf('stand');
  ok(near(up.highest, 1.6, 0.06) && near(up.lowest, 0.05, 0.06), `a standing fighter is shot from the ground to ${up.highest.toFixed(2)} m`);

  const down = bandOf('prone');
  ok(near(down.highest, 1.0, 0.06), `one that has gone down is shot only up to ${down.highest.toFixed(2)} m`);
  ok(down.hits < up.hits, `which is ${up.hits - down.hits} of the sweep's ${up.of} heights it no longer has to stand: a band ${(up.highest - down.highest).toFixed(2)} m deep, and every shot into it now passes over`);

  // The two ways of putting it that matter to the owner, and they are different questions.
  ok(shotAt(1.3) === false, 'a bolt crossing at a standing body’s chest goes clean over a body that has gone down');
  shape('stand');
  ok(shotAt(1.3) === true, '... and would have struck it a moment earlier, standing');

  shape('prone');
  ok(shotAt(aimPointFor('stand') * 0.9) === true, 'but a bolt aimed at a standing body’s own middle still finds a low one, because 0.81 m is inside a 1.0 m shell');
  ok(shotAt(aimPointFor('prone') * 0.9) === true, 'and a shooter that knows it went down hits it every time');

  // Which is the honest limit of the one-capsule first pass, and it is one live number away from
  // being otherwise. Measured, not asserted.
  tuneFighterBody({ lowHalf: 0 });
  shape('prone');
  const over = shotAt(aimPointFor('stand') * 0.9);
  ok(over === false, 'taken all the way down (`lowHalf` 0) a shot aimed at a standing body’s middle misses outright, which is the knob if prone-as-cover is wanted rather than prone-as-a-pose');
  tuneFighterBody({ lowHalf: 0.15 });

  // And the shell really does come back: a posture is not a one-way door.
  shape('stand');
  ok(shotAt(1.5) === true, 'standing up again puts the whole body back to be shot at');
}

// --- 5: the clip names are the player's ---------------------------------------------------------

{
  // The transitions, lifted from `Player.postureTransition`. The words first.
  ok(playerSrc.includes("was.prone ? 'prone' : was.kneel ? 'kneeling' : was.crouch ? 'crouched' : 'standing'"), "the player's four posture words are prone, kneeling, crouched and standing");
  ok(postureTransitionNames('stand', 'kneel', null, false, false).join() === 'trn_standing_to_kneeling', 'and a plain body uses exactly those, so the fighters ask for the clips the player asks for');

  const armed = postureTransitionNames('stand', 'kneel', 'rifle', true, false);
  ok(armed[0] === 'trn_rifle_combat_standing_aimed_to_rifle_combat_kneeling_aimed', 'a rifle held up and aimed asks for its own aimed transition first');
  ok(armed[1] === 'trn_rifle_combat_standing_aimed_to_rifle_combat_kneleing_aimed', '... then for the misspelling the archives themselves carry, which is the only way that clip is ever found');
  ok(playerSrc.includes('kneleing'), 'and the player asks for the same misspelling, so the two have not drifted');
  ok(armed[2] === 'trn_rifle_combat_standing_to_rifle_combat_kneeling' && armed[3] === 'trn_standing_to_kneeling', 'with the unaimed set and then the plain one behind it');
  ok(postureTransitionNames('prone', 'kneel', 'pistol', false, false)[0] === 'trn_pistol_combat_prone_to_pistol_combat_kneeling', 'an unaimed carry skips the aimed names altogether');
  ok(!postureTransitionNames('prone', 'kneel', 'pistol', false, false).includes('trn_pistol_combat_prone_aimed_to_pistol_combat_kneleing_aimed'), '... and the misspelling with them, since it is an aimed clip');

  ok(postureTransitionNames('kneel', 'kneel', 'rifle', true, false).length === 0, 'a posture that has not changed has no transition');
  ok(postureTransitionNames('stand', 'crouch', 'rifle', true, true).length === 0, 'and a crouch is refused while moving, exactly as the player refuses it: those clips only play standing still');
  ok(postureTransitionNames('stand', 'crouch', 'rifle', true, false).join() === 'trn_standing_to_crouched', 'standing still it plays, and never with a weapon’s name: the archives have no armed crouch transition');
  ok(playerSrc.includes("if ((from === 'crouched' || to === 'crouched') && (moving || this.jkaMode)) return;"), 'which is the player’s own refusal, read out of its file');
}

{
  // The shots. The archives' own kneeling set: twelve names, six a weapon, front-facing.
  const rig = [
    'pistol_combat_standing_fire_1',
    'pistol_combat_standing_fire_3',
    'pistol_combat_kneeling_fire_1',
    'pistol_combat_kneeling_fire_3',
    'pistol_combat_kneeling_fire_5',
    'pistol_combat_kneeling_fire_7',
    'pistol_kneeling_fire_9',
    'pistol_kneeling_fire_11',
    'pistol_combat_prone_aimed_fire_1',
    'pistol_combat_prone_aimed_fire_3',
    'add_pistol_fire_1',
    'rifle_kneeling_fire_1',
    'rifle_kneeling_fire_3',
    'rifle_kneeling_fire_5',
    'rifle_kneeling_fire_7',
    'rifle_kneeling_fire_9',
    'rifle_kneeling_fire_11',
    'add_rifle_fire_1',
  ];
  /** The very ladder `findGunPoses` walks: the first row of the list that matches anything wins. */
  const pick = (kind: 'pistol' | 'rifle', p: Posture, clips: string[]): string[] => {
    for (const pattern of firePatterns(kind, p)) {
      const found = clips.filter((c) => pattern.test(c));
      if (found.length) return found;
    }
    return [];
  };

  ok(pick('pistol', 'kneel', rig).length === 6, 'a kneeling pistol carrier draws from all six of the game’s own kneeling shots, not the same one every time');
  ok(pick('rifle', 'kneel', rig).length === 6, 'and a rifleman from its own six');
  ok(!pick('pistol', 'kneel', rig).some((c) => c.startsWith('add_')), 'with no additive recoil among them: a real posed clip exists, so nothing stands in for it');
  ok(pick('pistol', 'stand', rig).join() === 'pistol_combat_standing_fire_1,pistol_combat_standing_fire_3', 'standing it fires the standing shots');
  ok(pick('pistol', 'prone', rig).length === 2 && pick('pistol', 'prone', rig).every((c) => c.includes('prone')), 'lying down it fires the aimed prone shots, which are the ones that keep the off hand still');
  ok(pick('rifle', 'stand', rig).join() === 'add_rifle_fire_1', 'a rifle with no posed standing shot in the pack falls back on the additive recoil, exactly as it always has');

  // A pack converted before the direction selector's tag was read properly: none of the aimed or
  // kneeling names is in it at all. Nothing must throw, and a shot must still be played.
  const old = ['add_pistol_fire_1', 'add_pistol_fire_3', 'rifle_combat_standing_fire_1'];
  ok(pick('pistol', 'kneel', old).length === 2, 'on a pack converted before the tag fix a kneeling pistol falls through to the additive rather than firing nothing');
  ok(pick('pistol', 'prone', old).length === 2, 'and so does a prone one, through the last-resort row rather than by name');
  ok(pick('pistol', 'stand', []).length === 0, 'and a rig with no shots at all comes back empty rather than throwing');

  // Read out of the player's file, so the ladder cannot drift from the player's without failing.
  for (const literal of ['^${kind}_(combat_)?prone_aimed_fire_\\\\d+$', '^${kind}_(combat_)?${posture}(_aimed)?_fire_\\\\d+$', '^${kind}_kneeling_fire_\\\\d+$', '^add_${kind}_fire_\\\\d+$', '^(add_)?${kind}_(combat_)?(prone_|kneeling_|standing_)?fire_\\\\d+$']) {
    ok(playerSrc.includes(literal), `the player asks for ${literal.slice(0, 34)}… and so does a fighter`);
  }
  ok(firePatterns('rifle', 'prone')[0].source === '^rifle_(combat_)?prone_aimed_fire_\\d+$', 'and the first prone pattern is that literal with the weapon filled in');
  ok(firePatterns('pistol', 'kneel')[0].source === '^pistol_(combat_)?kneeling(_aimed)?_fire_\\d+$', 'as is the first kneeling one');
  ok(firePatterns('rifle', 'crouch').join() === firePatterns('rifle', 'stand').join(), 'a crouch has no shots of its own in the archives and asks for the standing row, which nothing ever reads because a crouched body does not fire');
}

// --- 6: the word rides the brain's decision, and the wildlife did not move -----------------------

{
  const self = (over: Partial<BrainSelf> = {}): BrainSelf => ({
    key: 2,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    homeX: 0,
    homeZ: 0,
    side: 'wild',
    aggression: 'aggressive',
    inside: false,
    big: false,
    reach: 2,
    ranged: 0,
    melee: true,
    halfHeight: 0.9,
    hpRatio: 1,
    state: 'idle',
    targetKey: null,
    stuck: 0,
    now: 100,
    wanderAt: 500,
    goal: null,
    until: 0,
    blockedSince: null,
    forgetKey: null,
    forgetUntil: 0,
    ...over,
  });
  ok(decide(self(), []).posture === 'stand', 'every decision carries a posture');
  ok(decide(self({ x: 70, targetKey: 1, state: 'chase' }), []).posture === 'stand', '... and it is standing on a body going home');
  ok(decide(self({ wanderAt: 50 }), []).posture === 'stand', '... and on one wandering');
  const brainSrc = readFileSync(join(root, 'src', 'world', 'mobiles', 'brain.ts'), 'utf8');
  ok(brainSrc.split('posture').length - 1 <= 12, 'and nothing in the shared brain decides one: the field is declared and defaulted and never written, so a bantha is bit for bit what it was');
  ok(!/d\.posture\s*=/.test(brainSrc), 'no rule in `decide` assigns it');
  ok(/d\.posture\s*=/.test(npcSrc), 'the fighters write their own answer onto it, which is where the cover rule will one day go instead');
}

// --- 7: what `npcs.ts` really does with all of it -----------------------------------------------
//
// The wiring this file cannot run, because `npcs.ts` is a browser module; read as text, the way the
// stance test pins the collision filters.

{
  ok(npcSrc.includes('this.collider.setHalfHeight(half);'), 'the collision capsule is really reshaped for the posture');
  ok(npcSrc.includes('this.collider.setTranslationWrtParent({ x: 0, y: capsuleDropFor(half, FIGHTER_BODY, this.bodyLift), z: 0 });'), '... on the parent, against this body’s own lift and not the live one, so moving `halfHeight` on the knob cannot sink a standing fighter’s feet through the floor');
  ok(npcSrc.includes("this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + FIGHTER_BODY.radius + half, z: this.pos.z });"), '... and in the world as well, which is what every bolt already in the air reads this frame');
  ok(npcSrc.includes('this.halfHeight = aimPointFor(this.posture);'), 'and the aim point moves in the same call, never in another');
  ok(npcSrc.includes('y: this.pos.y + this.bodyLift,'), 'the kinematic body itself is written from the standing lift, so a kneeling fighter is not dropped into the floor');
  ok(npcSrc.includes('pace = paceInPosture(pace, this.posture);'), 'the posture caps the pace, which is what stops a kneeling body walking and a prone one pathing');
  ok(npcSrc.includes("if (this.posture === 'crouch') return;"), 'a crouched fighter takes no action at all, which is the twelve crouch states’ own zero actions');
  ok(npcSrc.includes("if (this.posture !== 'stand' && d.attack === 'melee') return;"), 'and a low body does not swing: every clip a fighter swings is authored upright');
  ok(npcSrc.includes("postureAsk.held = !!this.errand && !this.errand.done;"), 'a body under a long walk is held upright, so the walk is untouched by this wave');
  ok(npcSrc.includes("rig.clipMatching(/^loop_crouched:speed0/)"), 'a fighter is given the game’s own crouch rather than Jedi Academy’s, per fighter, without touching the state table the player shares');
  ok(npcSrc.includes("rig.prefer('kneel', rig.clipMatching(new RegExp(`^loop_${kind}_kneeling`)) ?? null);"), 'and the blaster’s own kneel carry, exactly as the player asks for it');
  // Every one of them a **name** and never a pattern, which is the rule `findGunPoses` states and
  // the low path broke: `CharacterRig.setState` resolves a state's preference before its own change
  // test, so a pattern on a state a kneeling or crouching body sets every frame is an array
  // literal, two iterators and a regex test against each of a species rig's twelve hundred clips,
  // per low fighter per frame -- and it scans the whole table on a pack that has none of them.
  for (const line of npcSrc.split('\n')) {
    const call = /rig\.prefer\([^,]+,\s*([\s\S]*)\);/.exec(line);
    if (call) ok(!/^(\/|new RegExp)/.test(call[1].trim()), `no pattern is ever left on a rig state, only a name it was resolved to once: ${call[1].trim().slice(0, 42)}…`);
  }
  ok(/preferredClip\(state\)/.test(readFileSync(join(root, 'src', 'player', 'rig.ts'), 'utf8').split('setState(state: RigState')[1]?.slice(0, 900) ?? ''), 'which matters because `setState` really does resolve the preference on every call, before it asks whether anything changed');
  ok(npcSrc.includes('const speed = this.paceSpeed(pace);') && npcSrc.includes("if (this.posture === 'crouch') return Math.min(FIGHTER_TUNE.walk, this.crouchPace);"), 'a crouching body travels at its own clip’s pace and not the standing walk, which is the player’s own rule for keeping feet planted');
  ok(npcSrc.includes("const speed = this.paceSpeed(walking ? 'walk' : 'run') * own;"), '... and its clip is scaled to that very number, so the ground covered and the animation cannot disagree');
  ok(npcSrc.includes("this.canProne = !!rig.clipMatching(/^loop_[a-z_]*prone/);") && npcSrc.includes('postureAsk.canProne = this.canProne;'), 'and a rig with no prone loop is never laid down by the rule, since the prone states’ own last resort is the standing idle');
  ok(npcSrc.includes("rig.setState('kneel', 0, gun ?"), 'the kneel is posed with no speed at all: it is the still low pose and its clip set has no walk');
  ok(npcSrc.includes("}Idle` as RigState, 0);"), 'and prone never plays a moving variant, because there is no frame in which it is both prone and travelling');
  ok(npcSrc.includes('this.setPosture(\'stand\');') && npcSrc.indexOf("this.setPosture('stand');") < npcSrc.indexOf('this.physics.world.removeCollider'), 'a dying fighter is stood up before its collider goes, so a corpse is not shot at half a metre over the ground it lies on');
}

console.log(`${checks} checks passed`);
