// Climbing II, phase 2, maker B's frame makes nothing but what the engine's answers make, under its new settings (the wave 4
// allocation suites hold today's with every phase 2 switch at 'before', `climbTwoAlloc.test.ts` maker A's controls):
// `climbTwoBAllocOwn.ts` runs the wall climb's step and its limbs with every hand and foot on its hold (up and down, sideways
// on the braced shimmy clips, diagonally), and the braced hang's step and limbs with the view turned away and back by turns
// (the look-away's leading hand, the trailing hand's anchor), over a skeleton the game draws on the real Rapier, twelve
// processes at once and every one asserted: each cast the engine's own bytes and nothing more.
//
// Run: node tools/swg/tests/climbTwoBAlloc.test.ts
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
const file = fileURLToPath(new URL('./climbTwoBAllocOwn.ts', import.meta.url));
/** The most one of the engine's answers is allowed to make, bytes (`ledgeAlloc.test.ts`'s: measured 300 a miss to 1,200 a hit). */
const CAST_MOST = 1600;
interface Part {
  bytes: number;
  casts: number;
  frames: number;
  clean: boolean;
}
interface Answer {
  upDown: Part;
  side: Part;
  diagonal: Part;
  look: Part;
  climbing: boolean;
  hanging: boolean;
  looked: boolean;
  holds: { taken: number; reaches: number };
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
const engine = (a: Part) => a.clean && a.bytes <= a.casts * CAST_MOST + 0.05 * a.frames;
const per = (a: Part) => `${a.bytes} bytes over ${a.frames} frames, ${(a.casts / a.frames).toFixed(2)} casts a frame, ${Math.round(a.bytes / Math.max(1, a.casts))} a cast`;
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const tag = `process ${i + 1} of 12`;
  ok(a.climbing && a.holds.taken > 0 && a.holds.reaches > 0, `${tag}: on the wall, its hands and feet taking holds (${a.holds.taken}) and reaching (${a.holds.reaches})`);
  ok(engine(a.upDown), `${tag}: climbing up and down on holds, ${per(a.upDown)}: the engine's answers and nothing more`);
  ok(engine(a.side), `${tag}: sideways on the shimmy clips, ${per(a.side)}`);
  ok(engine(a.diagonal), `${tag}: diagonally, ${per(a.diagonal)}`);
  ok(a.hanging && a.looked && engine(a.look), `${tag}: braced on a lip, looking away and back by turns, ${per(a.look)}`);
}
const a = all[0];
note(`a frame's rays: up and down ${(a.upDown.casts / a.upDown.frames).toFixed(2)}, sideways ${(a.side.casts / a.side.frames).toFixed(2)}, diagonally ${(a.diagonal.casts / a.diagonal.frames).toFixed(2)}, looking away ${(a.look.casts / a.look.frames).toFixed(2)}`);
console.log(`climbTwoBAlloc: ${checks} checks passed`);
