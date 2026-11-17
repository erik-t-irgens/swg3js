// Climbing II, the feedback round: a grab under way under `climb.grabFree` 'share' asks every frame whether the hang takes the
// keys yet, and that asking makes nothing and asks the engine nothing: `climbFeedbackAllocOwn.ts` holds a grab under way on the
// real Rapier and measures its frame under 'whole' (today's) and under 'share' (the check every frame, nothing asked), twelve
// processes at once and every one asserted. The climb up's room tests are an event (a press of W), never a frame, and are not
// measured here.
//
// Run: node tools/swg/tests/climbFeedbackAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./climbFeedbackAllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
interface Part {
  bytes: number;
  casts: number;
  frames: number;
  clean: boolean;
}
interface Answer {
  grabbing: boolean;
  still: boolean;
  freed: number;
  whole: Part;
  share: Part;
}
const PROCESSES = 12;
const answers = await Promise.all(
  Array.from({ length: PROCESSES }, () =>
    new Promise<Answer>((resolve, reject) => {
      const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.on('close', (code) => {
        const line = out.trim().split(/\r?\n/).pop() ?? '';
        if (code !== 0 || !line.startsWith('{')) reject(new Error(`climbFeedbackAllocOwn.ts exited ${code}: ${out}`));
        else resolve(JSON.parse(line) as Answer);
      });
    }),
  ),
);
const per = (p: Part) => p.bytes / p.frames;
ok(answers.every((a) => a.grabbing && a.still && a.freed === 0), `in all ${PROCESSES} processes the grab is under way and stays so with nothing asked (none handed the hang the keys)`);
ok(answers.every((a) => a.whole.clean && a.share.clean), `in all ${PROCESSES}, each window measured with no collection inside it`);
ok(answers.every((a) => a.whole.casts === 0 && a.share.casts === 0), 'a grab under way asks the engine nothing, under either rule');
const worst = Math.max(...answers.map((a) => per(a.share)));
const worstWhole = Math.max(...answers.map((a) => per(a.whole)));
ok(answers.every((a) => per(a.whole) <= PER_FRAME), `today's grab frame makes nothing (worst ${worstWhole.toFixed(4)} bytes a frame over ${answers[0].whole.frames} frames)`);
ok(answers.every((a) => per(a.share) <= PER_FRAME), `under 'share' the share's check every frame makes nothing either (worst ${worst.toFixed(4)} bytes a frame over ${answers[0].share.frames} frames, in every one of ${PROCESSES} processes)`);
console.log(`climbFeedbackAlloc: ${checks} checks passed`);
