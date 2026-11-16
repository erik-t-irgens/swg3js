// The slope limit's own frame makes nothing but what the engine's answers make, and asks for those as seldom as it says
// (wave 2b's review round: before it, the floor ray was cast on every frame a body stood or walked, about 900 bytes of the
// engine's own a frame, 125 KB a second at 144 frames for every player on foot). `slopeAllocOwn.ts` replays the rule's
// two calls over walks the grapple's harness records on the real Rapier, twelve processes at once and every one asserted:
// standing on flat ground casts nothing and makes nothing; walking on it casts once each `PLANE_REACH` metres (and once
// where the replay wraps round); walking over rolling terrain casts as the ground under it turns, each cast the engine's
// own bytes and nothing more; and under the rule 'before' it makes nothing at all.
//
// Run: node tools/swg/tests/slopeAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLANE_REACH } from '../../../src/player/slopeRule.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const file = fileURLToPath(new URL('./slopeAllocOwn.ts', import.meta.url));
/** The most one of the engine's answers is allowed to make, bytes: measured 900 to 1,200 (its ray, its closure, its hit). */
const CAST_MOST = 1600;
interface Answer {
  standFrames: number;
  standBytes: number;
  standCasts: number;
  standClean: boolean;
  walkFrames: number;
  walkBytes: number;
  walkCasts: number;
  walkClean: boolean;
  walkMetres: number;
  walkPasses: number;
  rollFrames: number;
  rollBytes: number;
  rollCasts: number;
  rollClean: boolean;
  rollMetres: number;
  rollPasses: number;
  rollGrounded: number;
  beforeFrames: number;
  beforeBytes: number;
  beforeCasts: number;
  beforeClean: boolean;
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
  ok(a.standClean && a.standCasts === 0 && a.standBytes < 0.05 * a.standFrames, `${tag}: standing on flat ground the rule asks the engine nothing and makes ${a.standBytes} bytes over ${a.standFrames} frames (${per(a.standBytes, a.standFrames)} a frame)`);
  // One each `PLANE_REACH` metres, one where the replay wraps round, and one for the walk's start, whose first steps lift
  // the body off the floor by more than `PLANE_HOLD` (measured: six a pass of 50 m); against 480 a pass were it cast every frame.
  const walkMost = (Math.ceil(a.walkMetres / PLANE_REACH) + 3) * a.walkPasses;
  ok(a.walkClean && a.walkMetres > 40 && a.walkCasts <= walkMost && a.walkBytes <= a.walkCasts * CAST_MOST + 0.05 * a.walkFrames, `${tag}: walking ${a.walkMetres.toFixed(1)} m on flat ground, ${a.walkPasses} times over, it cast ${a.walkCasts} rays (${walkMost} at the most: one each ${PLANE_REACH} m, the replay's wrap and the walk's start) and made ${a.walkBytes} bytes, ${a.walkCasts ? Math.round(a.walkBytes / a.walkCasts) : 0} a cast`);
  ok(a.rollClean && a.rollGrounded > 400 && a.rollBytes <= a.rollCasts * CAST_MOST + 0.05 * a.rollFrames, `${tag}: walking ${a.rollMetres.toFixed(1)} m over rolling terrain it cast ${(a.rollCasts / a.rollPasses).toFixed(0)} rays a pass (${(a.rollCasts / a.rollPasses / a.rollMetres).toFixed(2)} a metre) and made ${a.rollBytes} bytes, ${a.rollCasts ? Math.round(a.rollBytes / a.rollCasts) : 0} a cast: the engine's answers and nothing more`);
  ok(a.beforeClean && a.beforeCasts === 0 && a.beforeBytes < 0.05 * a.beforeFrames, `${tag}: under the rule 'before' it asks nothing and makes ${a.beforeBytes} bytes over ${a.beforeFrames} frames (${per(a.beforeBytes, a.beforeFrames)} a frame)`);
}
const a = all[0];
note(`what the rule cost before this round: a floor ray every frame a body stood or walked, about ${Math.round(a.rollBytes / a.rollCasts)} bytes a frame of the engine's own; now ${per(a.walkBytes, a.walkFrames)} a frame walking on flat ground and ${per(a.rollBytes, a.rollFrames)} over rolling terrain at 60 frames a second`);
console.log(`slopeAlloc: ${checks} checks passed`);
