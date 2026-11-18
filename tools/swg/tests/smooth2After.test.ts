// Climbing II, Smoothness II, item 9: the whole course (every piece but the extra rows) driven again at the round's shipped
// settings, every switch of Smoothness II on (both makers' items), at 30, 60, 144 and 240 frames a second through the game's own
// movement and climbing (tools/swg/tests/climbCourseBody.ts on the real Rapier): the digest of its whole trace and of its one-line
// summaries, recorded here so later rounds can hold their switches at their other setting to it. With Smoothness II's switches
// at their other setting the same course is the feedback round's (`climbFeedbackAfter.test.ts`, which `climbSmoothBefore` puts
// back), so what moved the trace is these switches alone.
//
// Run: node tools/swg/tests/smooth2After.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { CLIMB_TUNE, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { MOVE_TUNE, resetMoveTune } from '../../../src/anim/moveTune.ts';
import { RATES, runCourse, summarize } from './climbCourseBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const SHIPPED = {
  digest: 'cb23818f37df1e47bf92e8d26a24bd453343022a549e72998cade0e0e72b8073',
  summaries: '167f51d98054de31f4ce4f1cd86b38512b147e2cd4ec07b52a69002d476edc5c',
  frames: 811554,
};
resetClimbTune();
resetMoveTune();
ok(CLIMB_TUNE.hopFlight === 'timed' && CLIMB_TUNE.transitions === 'blend' && CLIMB_TUNE.camera === 'eased' && CLIMB_TUNE.slopeHands === 'each' && CLIMB_TUNE.bodyClear === 'spheres' && CLIMB_TUNE.wallHands === 'grip' && CLIMB_TUNE.pushOff === 'jka' && MOVE_TUNE.duckHead === 'clear', "every switch of Smoothness II at its shipped setting");
const pieces = climbCourse().pieces;
const t0 = performance.now();
const { runs, digest } = await runCourse();
const ms = performance.now() - t0;
const frames = runs.reduce((n, r) => n + r.frames, 0);
const sum = createHash('sha256').update(runs.map(summarize).join('\n')).digest('hex');
console.log(`digest ${digest} summaries ${sum} frames ${frames}`);
ok(runs.length === pieces.length * RATES.length && frames === SHIPPED.frames, `the harness ran every piece (${pieces.length}) at every rate: ${runs.length} runs, ${frames} frames in ${(ms / 1000).toFixed(1)} s`);
ok(sum === SHIPPED.summaries, `... the runs say what they said (their summaries' digest ${sum.slice(0, 16)})`);
ok(digest === SHIPPED.digest, `... and every frame of them is as recorded to the bit (the trace's digest ${digest.slice(0, 16)})`);
resetMoveTune();
resetClimbTune();
console.log(`smooth2After: ${checks} checks passed`);