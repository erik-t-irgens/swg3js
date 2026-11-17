// Climbing II, phase 2: its frame makes nothing but what the engine's answers make, under its new settings (the wave 4
// allocation suites, `ledgeAlloc.test.ts` and `wallAlloc.test.ts`, hold today's with every phase 2 switch at 'before'):
// `climbTwoAllocOwn.ts` runs the ledges' and the wall climb's sense on foot every frame and the hang's step shimmying back and
// forth across two steps along a lip, on the real Rapier, twelve processes at once and every one asserted: on foot with the use
// key up they ask the engine nothing and make nothing (walking into a wall or past a lip feels for nothing at all now); with
// it held, in the open, they cast a ray each (the lip's and the face's) and make those rays' bytes and nothing more; shimmying
// across the steps the rail's steps along the lip, the room for the capsule and the wall under the feet are asked, each cast
// the engine's own bytes and nothing more, and the steps are crossed (the lip held at both its heights).
//
// Run: node tools/swg/tests/climbTwoAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const file = fileURLToPath(new URL('./climbTwoAllocOwn.ts', import.meta.url));
/** The most one of the engine's answers is allowed to make, bytes (`ledgeAlloc.test.ts`'s: measured 300 a miss to 1,200 a hit). */
const CAST_MOST = 1600;
/** A shimmy's frame asks at most this many (`ledgeAlloc.test.ts`'s), a step along the lip found now and then among them. */
const SHIMMY_CASTS = 12;
interface Part {
  bytes: number;
  casts: number;
  frames: number;
  clean: boolean;
}
interface Answer {
  stand: Part;
  air: Part;
  standUse: Part;
  airUse: Part;
  shimmy: Part;
  hanging: boolean;
  top: number;
  heights: [number, number];
  holding: boolean;
}
const run = () =>
  new Promise<Answer>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      const line = out.trim().split('\n').pop() ?? '';
      if (code !== 0) {
        const lines = err.trim().split('\n');
        reject(new Error(`the allocation child exited ${code}: ${lines.find((l) => /Error/.test(l))?.trim() ?? lines.pop() ?? line}`));
        return;
      }
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`the allocation child printed nothing that reads: ${line || '(nothing)'}`));
      }
    });
  });
const all = await Promise.all(Array.from({ length: 12 }, () => run()));
const per = (made: number, frames: number) => (Math.max(0, made) / frames).toFixed(3);
const quiet = (a: Part) => a.clean && a.casts === 0 && a.bytes < 0.05 * a.frames;
const engine = (a: Part) => a.clean && a.bytes <= a.casts * CAST_MOST + 0.05 * a.frames;
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const tag = `process ${i + 1} of 12`;
  ok(quiet(a.stand), `${tag}: on the ground with the use key up, the ledges and the wall climb ask nothing and make ${a.stand.bytes} bytes over ${a.stand.frames} frames (${per(a.stand.bytes, a.stand.frames)} a frame)`);
  ok(quiet(a.air), `${tag}: in the air with it up, nothing and ${a.air.bytes} bytes over ${a.air.frames} frames (${per(a.air.bytes, a.air.frames)} a frame)`);
  ok(engine(a.standUse) && a.standUse.casts === 2 * a.standUse.frames, `${tag}: on the ground with it held, in the open, a ray each a frame (the lip's, the face's) and ${a.standUse.bytes} bytes over ${a.standUse.frames} frames, ${Math.round(a.standUse.bytes / Math.max(1, a.standUse.casts))} a cast: the engine's answers and nothing more`);
  ok(engine(a.airUse) && a.airUse.casts === 2 * a.airUse.frames, `${tag}: falling in the open with it held, the same two rays and ${Math.round(a.airUse.bytes / Math.max(1, a.airUse.casts))} bytes a cast`);
  ok(a.hanging && a.holding && Math.abs(a.top - 2.9) < 0.01 && a.heights[0] < 2.61 && a.heights[1] > 2.89, `${tag}: the body grabbed the raised block's lip (${a.top.toFixed(3)} m) and the lip it held stood at both heights as it shimmied (${a.heights.map((h) => h.toFixed(2)).join(' and ')} m)`);
  ok(engine(a.shimmy) && a.shimmy.casts > 0 && a.shimmy.casts <= SHIMMY_CASTS * a.shimmy.frames, `${tag}: shimmying back and forth across two steps they cast ${(a.shimmy.casts / a.shimmy.frames).toFixed(2)} rays a frame and made ${a.shimmy.bytes} bytes over ${a.shimmy.frames} frames, ${Math.round(a.shimmy.bytes / Math.max(1, a.shimmy.casts))} a cast: the engine's answers and nothing more`);
}
const a = all[0];
note(`the rays a frame: on foot with the use key up 0, held in the open 2, shimmying across steps ${(a.shimmy.casts / a.shimmy.frames).toFixed(2)} (about ${Math.round(a.shimmy.bytes / a.shimmy.frames)} bytes a frame, all of them the engine's)`);
console.log(`climbTwoAlloc: ${checks} checks passed`);
