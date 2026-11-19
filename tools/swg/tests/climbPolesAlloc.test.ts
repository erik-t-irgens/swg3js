// Climbing II, phase 5 (poles): on a pole the climb's frame makes nothing (maker A's measure, `climbPolesAllocOwn.ts` 'climb', the
// slide down's frames among them), the jump off's flight makes nothing ('fly': the capsule swept each step, another pole looked
// for, the bars and the ledges asked, the figure led), the pole's hand-over to the rig makes nothing ('clips': no name built and no
// number handed across a call), and the hands and feet put on the pole by the limbs' solve make nothing ('limbs', maker A's foot
// solve among them). Twelve processes at once for each, every one asserted; each window measured 25 ms of wall time after the
// calls that compile it, as `ledgeAllocOwn` waits.
//
// Run: node tools/swg/tests/climbPolesAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./climbPolesAllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
const PROCESSES = 12;
interface Meas {
  bytes: number;
  frames: number;
  clean: boolean;
}
function one(part: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, POLE_PART: part } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0 || !line.startsWith('{')) reject(new Error(`climbPolesAllocOwn.ts ${part} exited ${code}: ${out}`));
      else resolve(JSON.parse(line) as Record<string, unknown>);
    });
  });
}
const per = (m: Meas) => m.bytes / m.frames;
const worst = (ms: Meas[]) => Math.max(...ms.map(per)).toFixed(4);

const climbs = await Promise.all(Array.from({ length: PROCESSES }, () => one('climb')));
const cm = climbs.map((a) => a.meas as Meas);
ok(climbs.every((a) => a.held && a.holding && (a.asks as number) > 0 && (a.slides as number) > 0) && cm.every((x) => x.clean), `in all ${PROCESSES} processes the body climbed the pole up and down and round it and slid down it now and then, its room asked of the stand-in (${Math.min(...climbs.map((a) => a.asks as number))} asks and more), every window clean`);
ok(cm.every((x) => per(x) <= PER_FRAME), `the climb's frame makes nothing, the slide's included (worst ${worst(cm)} bytes a frame over ${cm[0].frames} frames, in every one of ${PROCESSES} processes)`);
const flys = await Promise.all(Array.from({ length: PROCESSES }, () => one('fly')));
const fm = flys.map((a) => a.meas as Meas);
ok(flys.every((a) => a.flying && (a.casts as number) > 0 && (a.searches as number) > 0 && (a.bars as number) > 0 && (a.lips as number) > 0) && fm.every((x) => x.clean), `in all ${PROCESSES} processes the jump off flew the whole measure, its capsule swept, another pole looked for and the bars and the ledges asked each step, every window clean`);
ok(fm.every((x) => per(x) <= PER_FRAME), `the jump's flight makes nothing (worst ${worst(fm)} bytes a frame over ${fm[0].frames} frames, in every one of ${PROCESSES} processes)`);
const clips = await Promise.all(Array.from({ length: PROCESSES }, () => one('clips')));
const km = clips.map((a) => a.meas as Meas);
ok(clips.every((a) => (a.calls as number) > 0) && km.every((x) => x.clean), "the pole's hand-over drove the rig in every process, every window clean");
ok(km.every((x) => per(x) <= PER_FRAME), `the pole's hand-over makes nothing (worst ${worst(km)} bytes a frame, in every one of ${PROCESSES} processes)`);
const limbs = await Promise.all(Array.from({ length: PROCESSES }, () => one('limbs')));
const lm = limbs.map((a) => a.meas as Meas);
ok(limbs.every((a) => a.holding && (a.hands as number) > 0 && (a.feet as number) > 0) && lm.every((x) => x.clean), `the figure's hands and feet were put on the pole every frame in every process (its hands and its feet both), every window clean`);
ok(lm.every((x) => per(x) <= PER_FRAME), `the limbs' solve on the pole makes nothing, the feet's own included (worst ${worst(lm)} bytes a frame over ${lm[0].frames} frames, in every one of ${PROCESSES} processes)`);
console.log(`climbPolesAlloc: ${checks} checks passed`);
