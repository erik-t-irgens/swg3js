// Climbing II, phase 6 (vaults and clambers): the round's digest. Its scenes (`climbVaultsBody.ts`: a walk, a run and a sprint at
// every obstacle, clamber and three braced lips, at 30, 60, 144 and 240 frames a second, every frame hashed) held three ways:
//  - every switch of the round at its other setting (`climbVaultsBefore`: `move.vault` 'off'): the scenes' trace is the rope chain
//    round's to the bit (`OFF_DIGEST`, recorded at 5333b88 with the same scenes before any of the round's code was written, the
//    sprint stood in by its speed alone, since the harness then had no vault to hand its pace to);
//  - at the shipped settings (`move.vault` 'sprint'): the walks' and the runs' traces are still 5333b88's (`PLAIN_DIGEST`: a walk and
//    a run into the same pieces stop as today), the sprints' at the faces too high for anything as well, and the whole trace is the
//    round's own (`AFTER_DIGEST`);
//  - every older round's chain of puts back reaches the round's (`climbRopeLookBefore`, which `climbPolesBefore` and every older
//    `*Before` call through, puts `move.vault` back to 'off').
//
// Run: node tools/swg/tests/climbVaultsAfter.test.ts
import assert from 'node:assert/strict';
import { vaultCourse } from './climbVaultsBody.ts';
import { CLIMB_VAULTS_BEFORE, climbRopeLookBefore, climbTwoBefore, climbVaultsBefore, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { MOVE_TUNE, resetMoveTune } from '../../../src/anim/moveTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The scenes' whole trace at 5333b88 (the rope chain round, before this round): recorded then, with the same scenes. */
const OFF_DIGEST = '1815423af59d9d7a88c422ff85b5a4324f3f9c7c2321cca44c24a184cb4fc1b8';
/** The walks' and the runs' alone at 5333b88. */
const PLAIN_DIGEST = 'c1387ce7ead950683f5bf29bb993da92a6ef9adf7d7cf9b7d285b7abbca6b084';
/** The sprints at the faces too high for anything at 5333b88 (each run's own trace): a sprint there still stops as today. */
const HIGH_AT_BASE: Readonly<Record<string, string>> = {
  'lip-braced-1.8@30:sprint': '4b7ae2974c0033d9',
  'lip-braced-1.8@60:sprint': 'a208c86bb0006a08',
  'lip-braced-1.8@144:sprint': '99ef0004eea2f1c0',
  'lip-braced-1.8@240:sprint': 'aafaf2eb7659607e',
  'lip-braced-2.4@30:sprint': '502756d3c31e6667',
  'lip-braced-2.4@60:sprint': 'f6672bfd6a6b65de',
  'lip-braced-2.4@144:sprint': '8b25d28d1c428ef0',
  'lip-braced-2.4@240:sprint': '853d58dd6deb93b3',
  'obstacle-1.3x0.3@30:sprint': '9e88b42d3ff4c5f9',
  'obstacle-1.3x0.3@60:sprint': '8ccee977022d5ddc',
  'obstacle-1.3x0.3@144:sprint': 'e93d8958854bec71',
  'obstacle-1.3x0.3@240:sprint': '058393e4cdd80129',
  'obstacle-1.3x0.8@30:sprint': 'c5c92db59104efa1',
  'obstacle-1.3x0.8@60:sprint': '4bb6901d9ef5b176',
  'obstacle-1.3x0.8@144:sprint': '13ee6adac0b2543f',
  'obstacle-1.3x0.8@240:sprint': 'eaf771b12921aa78',
  'obstacle-1.3x1.5@30:sprint': '8713b4d7db273a90',
  'obstacle-1.3x1.5@60:sprint': '2d4860f1ed1950e1',
  'obstacle-1.3x1.5@144:sprint': '1ab3f7aa6ab8f8ea',
  'obstacle-1.3x1.5@240:sprint': '9ddd3278c534b588',
};
/**
 * The round's own whole trace at the shipped settings: maker A's items 1 and 2, recorded again by maker B with items 3 and 4 and
 * the same (no piece of the course moves, and no body there is crouched, prone, kneeling, swimming or holding something to place;
 * those are `climbVaultsNever.test.ts`'s, each held to 'off' frame by frame), and recorded again by the review's round (the fixer's:
 * the capsule kept off the obstacle, raised onto its top or held at its face, moves every vault's frames; makers' was
 * 9ca0347a6d7f76d7b278827163a8f7faaa4ef7c2fc3a6acae45a1a9381d2eef6).
 */
const AFTER_DIGEST = '1ac59062eb938cfa9be8064134f00d32c0b6b300c558772aeb64ce8605a41257';

// ---- the other setting: the rope chain round's to the bit ----------------------------------------------------------------------
{
  resetMoveTune();
  resetClimbTune();
  ok(MOVE_TUNE.vault === 'sprint', "the round ships on: `move.vault` 'sprint' (the owner's \"great for when sprinting\")");
  ok(CLIMB_VAULTS_BEFORE['move.vault'] === 'off', "`CLIMB_VAULTS_BEFORE` names the round's other setting: `move.vault` 'off'");
  climbVaultsBefore();
  ok(MOVE_TUNE.vault === 'off', '`climbVaultsBefore` puts it there');
  const { runs, digest } = await vaultCourse();
  ok(runs.every((r) => r.counts.vaults + r.counts.dives + r.counts.clambers === 0), `under 'off' nothing vaults, dives or clambers in any of the ${runs.length} runs`);
  ok(digest === OFF_DIGEST, `under 'off' the scenes' trace is 5333b88's to the bit (${digest.slice(0, 16)}...)`);
}

// ---- the shipped settings: the walks and runs as today, the too high faces as today, the round's own trace -------------------------
{
  resetMoveTune();
  resetClimbTune();
  const { runs, digest, plain } = await vaultCourse();
  ok(plain === PLAIN_DIGEST, `a walk and a run into the same pieces (with 'sprint') stop as today: their traces are 5333b88's to the bit (${plain.slice(0, 16)}...)`);
  ok(runs.filter((r) => r.pace !== 'sprint').every((r) => r.counts.vaults + r.counts.dives + r.counts.clambers === 0), 'no walk and no run vaults, dives or clambers');
  const high = runs.filter((r) => HIGH_AT_BASE[r.key] !== undefined);
  ok(high.length === Object.keys(HIGH_AT_BASE).length && high.every((r) => r.trace === HIGH_AT_BASE[r.key]), `a sprint into a face too high (the 1.3 m obstacles, the 1.8 and 2.4 m braced lips) is today's to the bit (${high.length} runs)`);
  console.log(`note the round's trace at the shipped settings: ${digest}`);
  ok(digest === AFTER_DIGEST, `the round's own trace at the shipped settings holds (${digest.slice(0, 16)}...)`);
}

// ---- every older round's chain reaches this round's put back -----------------------------------------------------------------------
{
  resetMoveTune();
  resetClimbTune();
  climbRopeLookBefore();
  ok(MOVE_TUNE.vault === 'off', '`climbRopeLookBefore` (the rope chain round, whose base had no vault) puts the vault off first');
  resetMoveTune();
  climbTwoBefore();
  ok(MOVE_TUNE.vault === 'off', '`climbTwoBefore` (climbToday\'s and climbAfter\'s, through every round\'s chain) does too');
  resetMoveTune();
  resetClimbTune();
}
console.log(`climbVaultsAfter: ${checks} checks passed`);
