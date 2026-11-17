// Climbing II's feedback round, the whole course (every piece but the extra rows, the round's own "climbs up short" row
// included) at the round's shipped settings, at 30, 60, 144 and 240 frames a second: the digest of its whole trace and of its
// one-line summaries, so the phases after it can hold their switches at their other setting to it. And the same course with
// the round's body switches (prone lying down, the duck: `MOVE_BEFORE`) at their other setting, which is maker A's climbing
// alone (items 1 and 2: the grab let go sooner, the climb up said and climbed short).
//
// What the body's switches moved: only lip-free-1.2 at 30, 60 and 240 (its slab's underside 1.2 m over the floor is ducked
// under, where today's capsule ran into it): 30 fps ends on the floor under the slab (y 0.04, where it ended on top at 1.197),
// 60 and 240 a few centimetres off where they ended (1.074 for 1.117, 0.943 for 0.936); 7 frames more in all. The 30 fps
// difference is today's own knife-edge, not the duck's fault (the review's fixing round, measured): today's running jump there
// lands on the top by the character controller's autostep at the jump's apex, and today's code alone, its place nudged 0.13 mm
// down at the jump frame, falls back under the plate the same way; the duck's shorter capsule on the jump frame moves the place
// by those 0.13 mm. Today's own ends there differ by frame rate as well (on the top at 30, perched on its edge at the rest).
//
// Run: node tools/swg/tests/climbFeedbackAfter.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { resetClimbTune } from '../../../src/anim/climbTune.ts';
import { moveBefore, resetMoveTune } from '../../../src/anim/moveTune.ts';
import { RATES, runCourse, summarize } from './climbCourseBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The round's shipped settings (both makers' items). */
const SHIPPED = {
  digest: '0bd3af6f8e1e42d4d8a9ffbb29b726780ffd68d46d0f9ff9442e4f799b8e8fb5',
  summaries: '4170715a5e7c36782bc49125e1897d3c308c4e9e7211f31367d9cfb5aa3584be',
  frames: 748417,
};
/** The body's switches at their other setting: maker A's climbing alone. */
const BODY_OFF = {
  digest: 'b5b508068c701bb9988449a8f197838a48dfa1e436e86595c20f72e3ca9fbef2',
  summaries: 'ca0b950d832a2bbb3fe4f66d7d0d32fab0aecfddf300ae97e9ba044a78ab09de',
  frames: 748410,
};

const pieces = climbCourse().pieces;
for (const [what, want, off] of [['at the round\'s shipped settings', SHIPPED, false], ['with prone and the duck at their other setting (maker A\'s climbing alone)', BODY_OFF, true]] as const) {
  resetClimbTune();
  resetMoveTune();
  if (off) moveBefore();
  const t0 = performance.now();
  const { runs, digest } = await runCourse();
  const ms = performance.now() - t0;
  const frames = runs.reduce((n, r) => n + r.frames, 0);
  ok(runs.length === pieces.length * RATES.length && frames === want.frames, `${what}: the harness ran every piece (${pieces.length}) at every rate: ${runs.length} runs, ${frames} frames in ${(ms / 1000).toFixed(1)} s`);
  const sum = createHash('sha256').update(runs.map(summarize).join('\n')).digest('hex');
  ok(sum === want.summaries, `... the runs say what they said (their summaries' digest ${sum.slice(0, 16)})`);
  ok(digest === want.digest, `... and every frame of them is as it was to the bit (the trace's digest ${digest.slice(0, 16)})`);
}
resetMoveTune();
resetClimbTune();
console.log(`climbFeedbackAfter: ${checks} checks passed`);
