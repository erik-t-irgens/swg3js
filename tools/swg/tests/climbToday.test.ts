// Climbing II, phase 1: today's climbing on the test course, held. The harness (tools/swg/tests/climbCourseBody.ts) drives a
// body through every piece of the one layout (src/anim/climbCourse.ts) at 30, 60, 144 and 240 frames a second through the
// player's own movement, ledges and wall climb on the real Rapier, and every frame of every run goes into one digest, which
// is recorded here as it stood at `c88f890`: phase 2's switches at their 'before' settings must give it again to the bit.
// The digests come first, so a run that changes the climbing's files (phase 2's) is still held to them:
//  - every piece at every rate, and the digest of all of it, and of their one-line summaries;
//  - today's jump reaches, each rate's, on the layout's own braced lip on its floor slab (they differ by frame rate today:
//    held as they are; on the terrain with no slab under the body each running reach at 30 and 144 is a centimetre higher);
//  - day one, last: which files of the climbing, the movement or their harnesses have changed since `c88f890`, a note now.
//    Phase 1 held them unchanged; phase 2 must change them, and holds today's climbing instead by the digests above with
//    every one of its switches at its 'before' setting (`climbTwoBefore`), set here before anything runs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { climbCourse, TODAY_REACH } from '../../../src/anim/climbCourse.ts';
import { climbTwoBefore } from '../../../src/anim/climbTune.ts';
import { RATES, reachAt, runCourse, summarize } from './climbCourseBody.ts';
import { createHash } from 'node:crypto';
import { REPO } from './oldModules.ts';

// Climbing II, phase 2: every switch it adds at its 'before' setting, so the course is today's climbing.
climbTwoBefore();

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

/** The commit today's numbers were taken at, and what they were. */
const BASE = 'c88f890';
const TODAY = {
  reach: { stand: [3.1, 3.24, 3.25, 3.25], run: [3.1, 3.15, 3.25, 3.26] },
  digest: '76f8ccb2d791a9564815226196fa805378787f1693e3f63b11ce6d5d85025bf0',
  summaries: '7f372e35fd9dcf56a49b2d8435316be2266625c4b03f16642c67464885d60909',
};

// ---- 1. the whole course at every rate ---------------------------------------------------------------------------------------
{
  const t0 = performance.now();
  const { runs, digest } = await runCourse();
  const ms = performance.now() - t0;
  const pieces = climbCourse().pieces;
  ok(runs.length === pieces.length * RATES.length && pieces.every((p) => RATES.every((fps) => runs.some((r) => r.id === p.id && r.fps === fps && r.frames > 0))), `the harness ran every piece (${pieces.length}) at every rate (${RATES.join(', ')}): ${runs.length} runs, ${runs.reduce((n, r) => n + r.frames, 0)} frames in ${(ms / 1000).toFixed(1)} s`);
  const lines = runs.map(summarize);
  const sumDigest = createHash('sha256').update(lines.join('\n')).digest('hex');
  // What changed, said where it did: every run's own line when the summaries moved.
  if (sumDigest !== TODAY.summaries || digest !== TODAY.digest) {
    for (const l of lines) console.log(`run  ${l}`);
    console.log(`now  digest ${digest} summaries ${sumDigest}`);
  }
  ok(sumDigest === TODAY.summaries, `today's runs say what they said at ${BASE} (their one-line summaries' digest ${sumDigest.slice(0, 16)})`);
  ok(digest === TODAY.digest, `and every frame of them is today's to the bit (the trace's digest ${digest.slice(0, 16)})`);
}

// ---- 2. today's reaches -----------------------------------------------------------------------------------------------------
{
  const stand: number[] = [];
  const run: number[] = [];
  for (const fps of RATES) {
    stand.push(await reachAt('stand', fps));
    run.push(await reachAt('run', fps));
  }
  ok(JSON.stringify(stand) === JSON.stringify(TODAY.reach.stand) && JSON.stringify(run) === JSON.stringify(TODAY.reach.run), `today's jump reaches on the layout's braced lip on its floor slab, at ${RATES.join(', ')} fps: standing ${stand.join(', ')} m, running ${run.join(', ')} m (they differ by frame rate today)`);
  ok(TODAY_REACH.standing === stand[1] && TODAY_REACH.running === run[1], `the course's two reach lips are the 60 fps ones (${TODAY_REACH.standing}, ${TODAY_REACH.running})`);
}

// ---- 3. day one ---------------------------------------------------------------------------------------------------------------
{
  const files = [
    'src/player/ledge.ts', 'src/player/wallClimb.ts', 'src/player/brace.ts', 'src/player/player.ts', 'src/player/limbPlace.ts', 'src/player/stairSense.ts',
    'src/player/stepUp.ts', 'src/player/slopeRule.ts', 'src/player/jkaMove.ts', 'src/player/swimStep.ts', 'src/player/grapple.ts',
    'src/anim/climbTune.ts', 'src/anim/climbDials.ts', 'src/anim/ledgeClips.ts', 'src/anim/wallClips.ts', 'src/anim/locoTune.ts', 'src/anim/stairsRule.ts', 'src/anim/locoClass.ts',
    'src/core/physics.ts', 'src/core/input.ts',
    'tools/swg/tests/grappleBody.ts', 'tools/swg/tests/stairsWaveBody.ts', 'tools/swg/tests/wallScenes.ts', 'tools/swg/tests/wave4DayOne.test.ts',
  ];
  let changed: string[] | null = null;
  try {
    const out = execFileSync('git', ['diff', '--name-only', BASE, '--', ...files], { cwd: REPO, encoding: 'utf8' });
    changed = out.split(/\r?\n/).filter((l) => l.trim());
    const suites = execFileSync('git', ['diff', '--name-only', BASE, '--', 'tools/swg/tests'], { cwd: REPO, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter((l) => /\/(ledge|wall|stairs|stair|brace|wave4|grapple|slope|playerStepUp)[^/]*\.test\.ts$/.test(l));
    changed.push(...suites);
  } catch (e) {
    note(`git could not say what changed since ${BASE} (${(e as Error).message.split('\n')[0]}): day one not asked`);
  }
  // Phase 2 changes these files on purpose: what changed is said, and today's climbing is held by the digests above.
  if (changed) note(`day one: ${changed.length ? `changed since ${BASE}: ${changed.join(', ')}` : `nothing changed since ${BASE}`} (phase 2 holds today's climbing by the digests above, every switch at 'before')`);
}

console.log(`climbToday: ${checks} checks passed`);
