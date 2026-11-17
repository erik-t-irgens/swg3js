// Climbing II, the smoothness round (maker A): hanging under `climb.hangKeys` 'cue', the way a held key asks is looked for once
// and kept, so a steady frame with a cue shown asks the engine nothing and makes nothing: `climbSmoothAllocOwn.ts` hangs a body
// on a rung (a shallow lip under `climb.shelves` 'grab') between one 1.25 m above (a hop: W's pull-up) and one 1.5 m below (the
// drop's cue: S), and measures still, W held, S held and still again, twelve processes at once and every one asserted. The
// look itself is an event (a key going down, the hang moved on), never a frame, and is not measured here.
//
// Run: node tools/swg/tests/climbSmoothAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./climbSmoothAllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
interface Part {
  bytes: number;
  casts: number;
  frames: number;
  clean: boolean;
  kind: number;
  cue: number;
}
interface Answer {
  hanging: boolean;
  holding: boolean;
  hop: number;
  drop: number;
  still: Part;
  up: Part;
  down: Part;
  back: Part;
  look: Part;
  looked: number;
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
        if (code !== 0 || !line.startsWith('{')) reject(new Error(`climbSmoothAllocOwn.ts exited ${code}: ${out}`));
        else resolve(JSON.parse(line) as Answer);
      });
    }),
  ),
);
const per = (p: Part) => p.bytes / p.frames;
const parts = (a: Answer) => [a.still, a.up, a.down, a.back];
ok(answers.every((a) => a.hanging && a.holding), `in all ${PROCESSES} processes the body hangs on the middle rung (reached by a hop's cue taken) and holds it throughout`);
ok(answers.every((a) => a.still.kind === 0 && a.up.kind === a.hop && a.up.cue === 1 && a.down.kind === a.drop && a.down.cue === 1 && a.back.kind === 0), 'still shows nothing, W held the hop\'s cue, S held the drop\'s, and still again nothing (each eased all the way in or out)');
ok(answers.every((a) => parts(a).every((p) => p.clean)), `in all ${PROCESSES}, each window measured with no collection inside it`);
ok(answers.every((a) => parts(a).every((p) => p.casts === 0)), 'a steady frame with or without a cue asks the engine nothing (the look was made once, as the key went down)');
for (const k of ['still', 'up', 'down', 'back'] as const) {
  const worst = Math.max(...answers.map((a) => per(a[k])));
  ok(answers.every((a) => per(a[k]) <= PER_FRAME), `${k}: the frame makes nothing (worst ${worst.toFixed(4)} bytes a frame over ${answers[0][k].frames} frames, in every one of ${PROCESSES} processes)`);
}
// The behind's cue: W held with the view turned back over the shoulder and to the wall again by turns. The way asked moves every
// two seconds, so the look is made again then (an event): the engine's answers and nothing more (`climbTwoAlloc`'s 1,600 a
// cast at the most), and the look-away really eased in.
const CAST_MOST = 1600;
ok(answers.every((a) => a.look.clean && a.look.casts > 0 && a.look.bytes <= a.look.casts * CAST_MOST + PER_FRAME * a.look.frames), `W held looking back and forward by turns: ${(answers[0].look.casts / answers[0].look.frames).toFixed(2)} casts a frame, at most ${Math.max(...answers.map((a) => Math.round(a.look.bytes / Math.max(1, a.look.casts))))} bytes a cast, the engine's answers and nothing more, in every one of ${PROCESSES} processes`);
ok(answers.every((a) => a.looked > 0.5), `the look-away eased in with W held looking back (at the least ${Math.min(...answers.map((a) => a.looked)).toFixed(2)} of the way) and the body still holds the rung after`);
console.log(`climbSmoothAlloc: ${checks} checks passed`);
