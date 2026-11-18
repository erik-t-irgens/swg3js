// Climbing II, the feedback round II (maker B, items 0d to 0f): a figure of the game's own rig hanging free from a ladder's rung,
// every frame the ledge's own step with a free ladder's climb cycle under way (the shimmy legs at its phase, the hips' sway fed by
// the body carried along a rung's way), the free cue's pull standing the figure up and its torso laid, the limbs handed over, laid
// and placed and the clean pose put back: nothing made (`climbFb2LedgeAllocOwn.ts`). And with the round's switches at their other
// settings the same frame lays nothing and makes nothing. And a free hop up begun from the cue (`FB2L_SCENE` 'hop', the review's
// finding): the carried lift's torso and the leg kick asked of the one clip in every frame, nothing made (the rig's track cache
// kept by the clip and the list; kept by the clip alone it rebuilt both every frame, about 10 KB). Twelve processes at once for
// each, every one asserted.
//
// Run: node tools/swg/tests/climbFb2LedgeAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./climbFb2LedgeAllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
const PROCESSES = 12;
interface Meas {
  bytes: number;
  frames: number;
  clean: boolean;
}
function one(mode: string, scene = ''): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, FB2L_MODE: mode, FB2L_SCENE: scene } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0 || !line.startsWith('{')) reject(new Error(`climbFb2LedgeAllocOwn.ts ${mode} exited ${code}: ${out}`));
      else resolve(JSON.parse(line) as Record<string, unknown>);
    });
  });
}
const per = (m: Meas) => m.bytes / m.frames;
for (const mode of ['shipped', 'before'] as const) {
  const runs = await Promise.all(Array.from({ length: PROCESSES }, () => one(mode)));
  const m = runs.map((a) => a.meas as Meas);
  if (mode === 'shipped') ok(runs.every((a) => a.hanging && (a.laid as number) >= m[0].frames), `in all ${PROCESSES} processes the figure hung free from the rung and every measured frame laid its legs and torso (${Math.min(...runs.map((a) => a.laid as number))} frames laid and more)`);
  else ok(runs.every((a) => a.hanging && a.laid === 0), `with the round's switches at their other settings, in all ${PROCESSES} processes the figure hung and nothing was laid`);
  ok(m.every((x) => x.clean), `${mode}: every window measured with no collection inside it`);
  ok(m.every((x) => per(x) <= PER_FRAME), `${mode}: the hang's frame makes nothing (worst ${Math.max(...m.map(per)).toFixed(4)} bytes a frame over ${m[0].frames} frames, in every one of ${PROCESSES} processes)`);
}
{
  const runs = await Promise.all(Array.from({ length: PROCESSES }, () => one('shipped', 'hop')));
  const m = runs.map((a) => a.meas as Meas);
  ok(runs.every((a) => a.hanging && a.hopped), `in all ${PROCESSES} processes the free cue's pull was held and Space began a free hop up carrying its lift`);
  ok(runs.every((a) => (a.carried as number) >= m[0].frames && (a.laid as number) >= m[0].frames), `every measured frame of the hop laid the carried lift's torso (${Math.min(...runs.map((a) => a.carried as number))} frames and more)`);
  ok(runs.every((a) => (a.kicks as number) >= m[0].frames), `and the leg kick of the same clip in the same frames (${Math.min(...runs.map((a) => a.kicks as number))} frames and more)`);
  ok(m.every((x) => x.clean), `hop: every window measured with no collection inside it`);
  ok(m.every((x) => per(x) <= PER_FRAME), `hop: the cued free hop up's frame makes nothing (worst ${Math.max(...m.map(per)).toFixed(4)} bytes a frame over ${m[0].frames} frames, in every one of ${PROCESSES} processes)`);
}
console.log(`climbFb2LedgeAlloc: ${checks} checks passed`);
