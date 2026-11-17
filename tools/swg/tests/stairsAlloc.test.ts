// The stairs wave's own frame makes nothing but what the engine's answers make, and asks for those as seldom as it says:
// `stairsAllocOwn.ts` runs the classes with one step a stair, the sampler measuring the stairs and the feet with the hips
// steady, the stride, the clearance and the hold, over a skeleton the game draws on the real Rapier, twelve processes at
// once and every one asserted: standing still on flat ground casts nothing and makes nothing; walking up a staircase (the
// step's cycle playing) and up a 20 degree slope cast what the feet and the sampler ask, each cast the engine's own bytes
// and nothing more.
//
// Run: node tools/swg/tests/stairsAlloc.test.ts
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
const file = fileURLToPath(new URL('./stairsAllocOwn.ts', import.meta.url));
/** The most one of the engine's answers is allowed to make, bytes: measured 900 to 1,200 (its ray, its hit and its normal). */
const CAST_MOST = 1600;
interface Part {
  bytes: number;
  casts: number;
  frames: number;
  clean: boolean;
  stepped: boolean;
}
interface Answer {
  stand: Part;
  stairs: Part;
  slope: Part;
  classes: Part;
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
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const tag = `process ${i + 1} of 12`;
  ok(a.stand.clean && a.stand.casts === 0 && a.stand.bytes < 0.05 * a.stand.frames, `${tag}: standing still on flat ground the classes, the sampler and the feet ask the engine nothing and make ${a.stand.bytes} bytes over ${a.stand.frames} frames (${per(a.stand.bytes, a.stand.frames)} a frame)`);
  ok(a.stairs.clean && a.stairs.stepped && a.stairs.casts > 0 && a.stairs.bytes <= a.stairs.casts * CAST_MOST + 0.05 * a.stairs.frames, `${tag}: walking up a staircase one step a stair they cast ${(a.stairs.casts / a.stairs.frames).toFixed(2)} rays a frame and made ${a.stairs.bytes} bytes over ${a.stairs.frames} frames, ${a.stairs.casts ? Math.round(a.stairs.bytes / a.stairs.casts) : 0} a cast: the engine's answers and nothing more`);
  ok(a.slope.clean && a.slope.casts > 0 && a.slope.bytes <= a.slope.casts * CAST_MOST + 0.05 * a.slope.frames, `${tag}: walking up a 20 degree slope with the hips steady they cast ${(a.slope.casts / a.slope.frames).toFixed(2)} rays a frame and made ${a.slope.bytes} bytes over ${a.slope.frames} frames: the engine's answers and nothing more`);
  ok(a.classes.clean && a.classes.stepped && a.classes.bytes < 0.5 * a.classes.frames, `${tag}: the classes alone on measured stairs (up and down, at a walk and a jog, stepping) make at worst ${a.classes.bytes} bytes over ${a.classes.frames} frames (${per(a.classes.bytes, a.classes.frames)} a frame)`);
}
const a = all[0];
note(`walking up the staircase (the figure in its rest pose, the most a walk asks): ${(a.stairs.casts / a.stairs.frames).toFixed(2)} rays a frame at 60 frames a second, about ${Math.round(a.stairs.bytes / a.stairs.frames)} bytes a frame, all of them the engine's; up the slope ${(a.slope.casts / a.slope.frames).toFixed(2)} rays a frame`);
console.log(`stairsAlloc: ${checks} checks passed`);
