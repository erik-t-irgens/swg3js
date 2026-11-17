// Wave 4, item B's own frame makes nothing but what the engine's answers make, and asks for those as seldom as it says:
// `wallAllocOwn.ts` runs the wall climb's sense on foot, its step and the limbs' placement, and the hands' bracing, over a
// skeleton the game draws posed by the up clip, on the real Rapier, twelve processes at once and every one asserted:
// walking free the climb asks nothing and makes nothing (its sense casts only while the move is cut short); under 'before'
// nothing; on the wall held still, the step and the hands' and feet's placement ask nothing and make nothing; climbing up
// and down, and sideways, they cast what holding the body off the face, its room, the lip or the ground and the hands' and
// feet's rays ask, each cast the engine's own bytes and nothing more; bracing, standing still asks nothing, running along a
// wall pressed into it casts the shoulders' three rays (and the limbs' none: the hands take no ray), drifting in space the
// surface's one, each the engine's bytes alone, and under 'before' nothing.
//
// Run: node tools/swg/tests/wallAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WALL_LOOK } from '../../../src/player/brace.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const file = fileURLToPath(new URL('./wallAllocOwn.ts', import.meta.url));
/** The most one of the engine's answers is allowed to make, bytes: measured 300 (a miss) to 1,200 (a hit, its normal). */
const CAST_MOST = 1600;
/** A climbing frame asks at most this many: the two spheres' rays, the room's shape, the lip's two to four (or the ground's one), the two hands', the two feet's. */
const CLIMB_CASTS = 11;
interface Part {
  bytes: number;
  casts: number;
  frames: number;
  clean: boolean;
}
interface Answer {
  free: Part;
  before: Part;
  still: Part;
  upDown: Part;
  side: Part;
  braceStill: Part;
  braceWall: Part;
  braceSpace: Part;
  braceOpen: Part;
  braceBefore: Part;
  climbing: boolean;
  y: number;
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
  ok(a.climbing, `${tag}: the body is on the wall it walked into (feet ${a.y.toFixed(2)} m up)`);
  ok(quiet(a.free), `${tag}: walking free the climb asks the engine nothing and makes ${a.free.bytes} bytes over ${a.free.frames} frames (${per(a.free.bytes, a.free.frames)} a frame)`);
  ok(quiet(a.before), `${tag}: under climb.wall 'before' it asks nothing and makes ${a.before.bytes} bytes over ${a.before.frames} frames`);
  ok(quiet(a.still), `${tag}: on the wall held still, the step and the hands' and feet's placement ask nothing and make ${a.still.bytes} bytes over ${a.still.frames} frames (${per(a.still.bytes, a.still.frames)} a frame)`);
  ok(engine(a.upDown) && a.upDown.casts > 0 && a.upDown.casts <= CLIMB_CASTS * a.upDown.frames, `${tag}: climbing up and down they cast ${(a.upDown.casts / a.upDown.frames).toFixed(2)} rays a frame and made ${a.upDown.bytes} bytes over ${a.upDown.frames} frames, ${Math.round(a.upDown.bytes / Math.max(1, a.upDown.casts))} a cast: the engine's answers and nothing more`);
  ok(engine(a.side) && a.side.casts > 0 && a.side.casts <= CLIMB_CASTS * a.side.frames, `${tag}: climbing sideways they cast ${(a.side.casts / a.side.frames).toFixed(2)} rays a frame and made ${a.side.bytes} bytes, the engine's answers and nothing more`);
  ok(quiet(a.braceStill), `${tag}: the bracing standing still asks nothing and makes ${a.braceStill.bytes} bytes over ${a.braceStill.frames} frames`);
  ok(engine(a.braceWall) && a.braceWall.casts === 3 * a.braceWall.frames, `${tag}: bracing along a wall it casts the shoulders' three rays a frame and made ${a.braceWall.bytes} bytes over ${a.braceWall.frames} frames, ${Math.round(a.braceWall.bytes / Math.max(1, a.braceWall.casts))} a cast: the engine's answers and nothing more`);
  ok(engine(a.braceSpace) && a.braceSpace.casts <= a.braceSpace.frames + 6, `${tag}: bracing adrift over a surface it casts ${(a.braceSpace.casts / a.braceSpace.frames).toFixed(2)} rays a frame and made ${a.braceSpace.bytes} bytes, the engine's answers and nothing more`);
  ok(quiet(a.braceBefore), `${tag}: under brace.rule 'before' the bracing asks nothing and makes ${a.braceBefore.bytes} bytes over ${a.braceBefore.frames} frames`);
  // Walking in the open with nothing within reach (the fix round's): three rays once every `WALL_LOOK` seconds, never a frame.
  ok(engine(a.braceOpen) && a.braceOpen.casts <= Math.ceil((a.braceOpen.frames / 60 / WALL_LOOK) + 1) * 3, `${tag}: bracing walking in the open it casts ${(a.braceOpen.casts / a.braceOpen.frames).toFixed(3)} rays a frame (three every ${WALL_LOOK} s) and made ${a.braceOpen.bytes} bytes over ${a.braceOpen.frames} frames, the engine's answers and nothing more`);
}
const a = all[0];
note(`the rays a frame: walking free 0, on the wall still 0, climbing up and down ${(a.upDown.casts / a.upDown.frames).toFixed(2)}, sideways ${(a.side.casts / a.side.frames).toFixed(2)}, bracing still 0, along a wall ${(a.braceWall.casts / a.braceWall.frames).toFixed(2)}, in the open ${(a.braceOpen.casts / a.braceOpen.frames).toFixed(3)}, adrift ${(a.braceSpace.casts / a.braceSpace.frames).toFixed(2)}`);
console.log(`wallAlloc: ${checks} checks passed`);
