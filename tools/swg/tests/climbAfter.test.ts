// Climbing II, phase 2: the course at the new controls' shipped settings, held. The harness (tools/swg/tests/climbCourseBody.ts)
// drives a body through every piece of the one layout at 30, 60, 144 and 240 frames a second, its scripts pressing the use key
// where `climb.grab` 'use' asks for it, and every frame of every run goes into one digest, recorded here as the phase left it;
// `climbToday.test.ts` holds the very same course with every phase 2 switch at 'before' to today's. A later change of the
// climbing that moves the course moves this digest in the same edit, and says why (the table of what moved is the phase's
// notes, `A:\swg3js\anim\CLIMB2-notes.md`).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { climbFeedbackBefore, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { COURSE_TWO_IDS } from '../../../src/anim/climbCourse.ts';
import { RATES, runCourse, summarize } from './climbCourseBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/**
 * The course at the shipped settings as phase 2 left it: maker A's items 1 to 5, then maker B's items 6 and 7 and the faults
 * mended (the corners' turn the same at every rate, the thin top hung from, the slope at the limit shimmied along, the reach
 * band swept over the frame), the scripts pressing E on the jump's own frame and looking back over a shoulder on the corridors.
 * Maker A's were digest 6b34ccf5b8a13654, summaries db4cb937cd6e4c18; maker B's 18c9faff402e8177, d5bdff3e864925d7. The
 * fixer's moved steps-0.6 alone (its step down past `stepMax` now the lip's end: A stops at 0.564 m on S2 at every rate, where
 * it went round the step's side 1.031 m, turned 48 to 58 degrees by rate, the hand 0.6 m off the lip); every other run's
 * summary and frames are as maker B left them.
 */
const AFTER = {
  digest: 'eaa1549e22024919081b6efb4b8fd1f26a1d68d1aa9c9b4c8d5ed4479db8cb22',
  summaries: 'a09f4da80846c2ce7be23bcdf9d4471cb3cec54b29ebb45db2c5e5b2f7126002',
};

resetClimbTune();
// The feedback round's switches at their other setting (the climbing as phase 2 shipped it, `12ae8ad`), and the course's pieces
// as phase 2 had them (the round adds a row of its own, `COURSE_TWO_IDS` leaves it out): the digests below are phase 2's.
climbFeedbackBefore();
const t0 = performance.now();
const { runs, digest } = await runCourse(COURSE_TWO_IDS);
const ms = performance.now() - t0;
const pieces = climbCourse({ pieces: COURSE_TWO_IDS }).pieces;
ok(runs.length === pieces.length * RATES.length, `the harness ran every piece (${pieces.length}) at every rate (${RATES.join(', ')}) at the shipped settings: ${runs.length} runs, ${runs.reduce((n, r) => n + r.frames, 0)} frames in ${(ms / 1000).toFixed(1)} s`);
const lines = runs.map(summarize);
const sumDigest = createHash('sha256').update(lines.join('\n')).digest('hex');
if (sumDigest !== AFTER.summaries || digest !== AFTER.digest) {
  for (const l of lines) console.log(`run  ${l}`);
  console.log(`now  digest ${digest} summaries ${sumDigest}`);
}
ok(sumDigest === AFTER.summaries, `the runs say what they said as phase 2 left them (their one-line summaries' digest ${sumDigest.slice(0, 16)})`);
ok(digest === AFTER.digest, `and every frame of them is as it was to the bit (the trace's digest ${digest.slice(0, 16)})`);
console.log(`climbAfter: ${checks} checks passed`);
