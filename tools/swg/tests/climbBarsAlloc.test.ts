// Climbing II, phase 3 (maker A): on a bar, the swing's frame makes nothing and asks the engine nothing while it swings in the
// open (`climbBarsAllocOwn.ts`: the swing's step on one of the physics' steps a frame with W held and with nothing held, and the
// figure's place for it), and the bar's hand-over to the rig makes nothing (`driveBarClips` on a stand-in rig, the clip's time
// moving every frame: no name built and no number handed across a call). Twelve processes at once for each, every one asserted.
// The fix round's: and a shimmy along the bar (A and D), its room asked again as the hands move on, makes nothing either.
//
// Run: node tools/swg/tests/climbBarsAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./climbBarsAllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
const PROCESSES = 12;
interface Meas {
  bytes: number;
  frames: number;
  casts: number;
  clean: boolean;
}
function one(part: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, BAR_PART: part } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0 || !line.startsWith('{')) reject(new Error(`climbBarsAllocOwn.ts ${part} exited ${code}: ${out}`));
      else resolve(JSON.parse(line) as Record<string, unknown>);
    });
  });
}
const per = (m: Meas) => m.bytes / m.frames;
const swings = await Promise.all(Array.from({ length: PROCESSES }, () => one('swing')));
ok(swings.every((a) => a.holding && a.held && (a.amp as number) > 40), `in all ${PROCESSES} processes the body is on the bar, swinging (pumped to ${Math.min(...swings.map((a) => a.amp as number)).toFixed(0)} degrees and more)`);
for (const k of ['pumped', 'still'] as const) {
  const m = swings.map((a) => a[k] as Meas);
  ok(m.every((x) => x.clean && x.casts === 0), `${k}: every window measured with no collection inside it, and the swing in the open asks the engine nothing (its room asked once, at the grab)`);
  ok(m.every((x) => per(x) <= PER_FRAME), `${k}: the swing's frame makes nothing (worst ${Math.max(...m.map(per)).toFixed(4)} bytes a frame over ${m[0].frames} frames, in every one of ${PROCESSES} processes)`);
}
// Maker B: the flight off a bar, a step a frame over open ground with no bar ahead: two engine asks a step (the swept capsule and
// the catch's box, the engine's own answers none) and nothing else made.
const flies = await Promise.all(Array.from({ length: PROCESSES }, () => one('fly')));
const fm = flies.map((a) => a.meas as Meas);
ok(flies.every((a) => a.flying && a.still) && fm.every((x) => x.clean && x.casts === 2 * x.frames), `in all ${PROCESSES} processes Space took the body into the flight off the bar, and every frame of it asked the engine twice (the swept capsule and the catch's box), every window clean`);
ok(fm.every((x) => per(x) <= PER_FRAME), `the flight's frame makes nothing (worst ${Math.max(...fm.map(per)).toFixed(4)} bytes a frame over ${fm[0].frames} frames, in every one of ${PROCESSES} processes)`);
// The review's: a shimmy along a bar (A and D in turn, hand over hand), its room asked again each time the hands have moved on a
// few hand widths, the asks answered by a stand-in that makes nothing: nothing made between them, nor for them.
const shims = await Promise.all(Array.from({ length: PROCESSES }, () => one('shimmy')));
const sm = shims.map((a) => a.meas as Meas);
ok(shims.every((a) => a.holding && a.held) && sm.every((x) => x.clean && x.casts > x.frames / 50), `in all ${PROCESSES} processes the hands moved along the bar, its room asked again as they went (${Math.min(...sm.map((x) => x.casts))} asks and more over ${sm[0].frames} frames), every window clean`);
ok(sm.every((x) => per(x) <= PER_FRAME), `the shimmy's frame makes nothing, its asks of the room included (worst ${Math.max(...sm.map(per)).toFixed(4)} bytes a frame over ${sm[0].frames} frames, in every one of ${PROCESSES} processes)`);
const clips = await Promise.all(Array.from({ length: PROCESSES }, () => one('clips')));
const cm = clips.map((a) => a.meas as Meas);
ok(clips.every((a) => (a.calls as number) > 0) && cm.every((x) => x.clean), `the bar's hand-over drove the rig in every process, every window clean`);
ok(cm.every((x) => per(x) <= PER_FRAME), `the bar's hand-over makes nothing (worst ${Math.max(...cm.map(per)).toFixed(4)} bytes a frame, in every one of ${PROCESSES} processes)`);
console.log(`climbBarsAlloc: ${checks} checks passed`);
