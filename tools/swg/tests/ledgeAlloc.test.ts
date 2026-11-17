// Wave 4's own frame makes nothing but what the engine's answers make, and asks for those as seldom as it says:
// `ledgeAllocOwn.ts` runs the ledges' sense on foot, the hang's step and the limbs' placement over a skeleton the game draws
// posed by the braced hang's clip, on the real Rapier, twelve processes at once and every one asserted: standing on the
// ground the sense asks nothing and makes nothing; in the air in the open, moving, it casts one ray a frame and makes that
// ray's bytes and nothing more; under 'before' it asks nothing; hanging still, the step and the hands' and feet's placement
// ask nothing and make nothing; shimmying back and forth along the lip they cast what following the lip along its own
// edge (now and then: a step of the rail every 0.1 m), the room for the capsule at its next place, the wall under the feet
// and the feet's rays ask (the fix round's: four a frame, where feeling ahead and under the hands and at the chest asked
// eight), each cast the engine's own bytes and nothing more.
//
// Run: node tools/swg/tests/ledgeAlloc.test.ts
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
const file = fileURLToPath(new URL('./ledgeAllocOwn.ts', import.meta.url));
/** The most one of the engine's answers is allowed to make, bytes: measured 300 (a miss) to 1,200 (a hit, its normal). */
const CAST_MOST = 1600;
/** A shimmy's frame asks at most this many: a step of the lip's rail where it is due (two to a dozen at a corner), the capsule's room (one to five), the wall under the feet, the two feet. */
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
  before: Part;
  still: Part;
  shimmy: Part;
  hanging: boolean;
  braced: boolean;
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
  ok(a.hanging && a.braced, `${tag}: the body hangs braced from the lip it jumped for`);
  ok(quiet(a.stand), `${tag}: standing on the ground the ledges ask the engine nothing and make ${a.stand.bytes} bytes over ${a.stand.frames} frames (${per(a.stand.bytes, a.stand.frames)} a frame)`);
  ok(engine(a.air) && a.air.casts === a.air.frames, `${tag}: in the air in the open, moving, they cast one ray a frame and made ${a.air.bytes} bytes over ${a.air.frames} frames, ${Math.round(a.air.bytes / Math.max(1, a.air.casts))} a cast: the engine's answers and nothing more`);
  ok(quiet(a.before), `${tag}: under 'before' they ask nothing and make ${a.before.bytes} bytes over ${a.before.frames} frames (${per(a.before.bytes, a.before.frames)} a frame)`);
  ok(quiet(a.still), `${tag}: hanging still, the step, the anchor and the hands' and feet's placement ask nothing and make ${a.still.bytes} bytes over ${a.still.frames} frames (${per(a.still.bytes, a.still.frames)} a frame)`);
  ok(engine(a.shimmy) && a.shimmy.casts > 0 && a.shimmy.casts <= SHIMMY_CASTS * a.shimmy.frames, `${tag}: shimmying back and forth they cast ${(a.shimmy.casts / a.shimmy.frames).toFixed(2)} rays a frame and made ${a.shimmy.bytes} bytes over ${a.shimmy.frames} frames, ${Math.round(a.shimmy.bytes / Math.max(1, a.shimmy.casts))} a cast: the engine's answers and nothing more`);
}
const a = all[0];
note(`the rays a frame: standing 0, in the open air 1, hanging still 0, shimmying ${(a.shimmy.casts / a.shimmy.frames).toFixed(2)} (about ${Math.round(a.shimmy.bytes / a.shimmy.frames)} bytes a frame, all of them the engine's)`);
console.log(`ledgeAlloc: ${checks} checks passed`);
