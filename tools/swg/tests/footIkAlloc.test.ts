// Wave 3's own frame makes nothing but what the engine's answers make, and asks for those as seldom as it says:
// `footIkAllocOwn.ts` runs the feet's placement, the stairs' sampler and the drawn body's ease over a skeleton the game
// draws on the real Rapier, twelve processes at once and every one asserted: standing still on flat ground casts nothing
// and makes nothing; walking over a staircase casts what the walk's moving feet and the sampler's lattice ask, each cast
// the engine's own bytes and nothing more; and with every rule at 'before' it asks nothing and makes nothing.
//
// Run: node tools/swg/tests/footIkAlloc.test.ts
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
const file = fileURLToPath(new URL('./footIkAllocOwn.ts', import.meta.url));
/** The most one of the engine's answers is allowed to make, bytes: measured 900 to 1,200 (its ray, its hit and its normal). */
const CAST_MOST = 1600;
interface Part {
  bytes: number;
  casts: number;
  frames: number;
  clean: boolean;
}
interface Answer {
  stand: Part;
  walk: Part;
  before: Part;
  metres: number;
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
  ok(a.stand.clean && a.stand.casts === 0 && a.stand.bytes < 0.05 * a.stand.frames, `${tag}: standing still on flat ground the feet and the sampler ask the engine nothing and make ${a.stand.bytes} bytes over ${a.stand.frames} frames (${per(a.stand.bytes, a.stand.frames)} a frame)`);
  ok(a.walk.clean && a.walk.casts > 0 && a.walk.bytes <= a.walk.casts * CAST_MOST + 0.05 * a.walk.frames, `${tag}: walking over a staircase they cast ${(a.walk.casts / a.walk.frames).toFixed(2)} rays a frame and made ${a.walk.bytes} bytes over ${a.walk.frames} frames, ${a.walk.casts ? Math.round(a.walk.bytes / a.walk.casts) : 0} a cast: the engine's answers and nothing more`);
  ok(a.before.clean && a.before.casts === 0 && a.before.bytes < 0.05 * a.before.frames, `${tag}: under 'before' they ask nothing and make ${a.before.bytes} bytes over ${a.before.frames} frames (${per(a.before.bytes, a.before.frames)} a frame)`);
}
const a = all[0];
note(`walking a figure in its rest pose over the staircase (its feet sliding with the body, the most a walk asks: a clip's planted foot held still asks none): ${(a.walk.casts / a.walk.frames).toFixed(2)} rays a frame at 60 frames a second, about ${Math.round((a.walk.bytes / a.walk.frames))} bytes a frame, all of them the engine's`);
console.log(`footIkAlloc: ${checks} checks passed`);
