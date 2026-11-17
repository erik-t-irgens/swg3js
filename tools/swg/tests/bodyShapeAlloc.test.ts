// Climbing II's feedback round, items 3 and 4: the body's shape on foot makes nothing a frame but the engine's own answers, and
// asks for those as seldom as it says: `bodyShapeAllocOwn.ts` steps `BodyShape` over a stand-in world whose queries answer with
// kept objects (so the bytes counted are the shape's own) in every frame the game steps on foot, twelve processes at once and
// every one asserted, and on the real Rapier counts what each frame asks: standing still nothing, walking in the open one box
// over the path once a quarter metre or so (its clear answer kept between), under a beam the box, the knee-height sweep and the columns, lying still nothing, lying while it turns the
// turn's own test (and its slide's).
//
// Run: node tools/swg/tests/bodyShapeAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./bodyShapeAllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
interface Part {
  bytes: number;
  asks: number;
  frames: number;
  clean: boolean;
}
interface Answer {
  still: Part;
  open: Part;
  under: Part;
  roofStill: Part;
  lyingStill: Part;
  lyingTurn: Part;
  realStill: number;
  realOpen: number;
  realUnder: number;
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
        if (code !== 0 || !line.startsWith('{')) reject(new Error(`bodyShapeAllocOwn.ts exited ${code}: ${out}`));
        else resolve(JSON.parse(line) as Answer);
      });
    }),
  ),
);
const per = (p: Part) => p.bytes / p.frames;
const parts = ['still', 'open', 'under', 'roofStill', 'lyingStill', 'lyingTurn'] as const;
ok(answers.every((a) => parts.every((k) => a[k].clean)), `in all ${PROCESSES} processes every window measured with no collection inside it`);
for (const k of parts) {
  const worst = Math.max(...answers.map((a) => per(a[k])));
  ok(answers.every((a) => per(a[k]) <= PER_FRAME), `${k}: the shape's own frame makes nothing (worst ${worst.toFixed(4)} bytes a frame over ${answers[0][k].frames} frames, in every one of ${PROCESSES} processes)`);
}
const a = answers[0];
const each = (p: Part) => p.asks / p.frames;
ok(answers.every((x) => each(x.still) === 0 && each(x.lyingStill) === 0), 'standing still and lying still the shape asks the engine nothing');
// The review of the round: once a frame was about 380 bytes a frame of the engine's own answers that today's walk never made.
ok(answers.every((x) => each(x.open) > 0 && each(x.open) < 0.1), `walking in the open it asks one box over the path once a quarter metre or so and keeps its clear answer between (${each(a.open).toFixed(3)} a frame at 2 cm a frame)`);
ok(answers.every((x) => each(x.under) >= 3 && each(x.roofStill) === 2), `under a beam the box, the sweep and the columns (${each(a.under)} a frame walking, ${each(a.roofStill)} ducked and still)`);
ok(answers.every((x) => each(x.lyingTurn) <= 2), `lying while it turns and is refused every frame, a share's test and its slide's at the most (${each(a.lyingTurn)} a frame: past a refusal the next turn starts from the smallest share)`);
ok(a.realStill === 0 && a.realOpen > 0 && a.realOpen <= 1 / 30 && a.realUnder >= 3, `on the real Rapier: ${a.realStill} a frame standing still, ${a.realOpen.toFixed(3)} walking in the open (the box once, its clear answer kept), ${a.realUnder} walking under a beam`);
console.log(`bodyShapeAlloc: ${checks} checks passed`);
