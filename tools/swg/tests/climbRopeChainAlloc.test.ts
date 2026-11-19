// The rope chain round, maker A: the chains' frame makes nothing (`climbRopeChainAllocOwn.ts`): a free rope swinging and settling
// over a ground read every step ('free'), a rope a swing holds, its pin moving along the chain as the hands climb and come back, let
// go of and grabbed again now and then, the drawn hands handed in ('held'), and a rope lying on a floor a stand-in world answers making
// nothing, its near box met and every point's step and every lying point's substep met by a ray ('near'). Twelve processes at once
// for each, every one asserted; each window measured 25 ms of wall time after the calls that compile it, as `ledgeAllocOwn` waits.
// At 144 frames a second, so frames with no step and frames with one are both in every window.
//
// Run: node tools/swg/tests/climbRopeChainAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./climbRopeChainAllocOwn.ts', import.meta.url));
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
    const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, CHAIN_PART: part } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0 || !line.startsWith('{')) reject(new Error(`climbRopeChainAllocOwn.ts ${part} exited ${code}: ${out}`));
      else resolve(JSON.parse(line) as Record<string, unknown>);
    });
  });
}
const per = (m: Meas) => m.bytes / m.frames;
const worst = (ms: Meas[]) => Math.max(...ms.map(per)).toFixed(4);

const free = await Promise.all(Array.from({ length: PROCESSES }, () => one('free')));
const fm = free.map((a) => a.meas as Meas);
ok(free.every((a) => a.live && (a.steps as number) > 100000) && fm.every((x) => x.clean), `in all ${PROCESSES} processes the free rope's chain was stepped through the whole measure, every window clean`);
ok(fm.every((x) => per(x) <= PER_FRAME), `a free rope's frame makes nothing (worst ${worst(fm)} bytes a frame over ${fm[0].frames} frames, in every one of ${PROCESSES} processes)`);
const held = await Promise.all(Array.from({ length: PROCESSES }, () => one('held')));
const hm = held.map((a) => a.meas as Meas);
ok(held.every((a) => a.live && (a.steps as number) > 100000 && (a.swung as number) > 50000) && hm.every((x) => x.clean), `in all ${PROCESSES} processes the held rope's chain was stepped with its pin on the swing (each step on the swing's own record: ${Math.min(...held.map((a) => a.swung as number))} steps and more), let go of and grabbed again, every window clean`);
ok(hm.every((x) => per(x) <= PER_FRAME), `a held rope's frame makes nothing, its let-goes and grabs included (worst ${worst(hm)} bytes a frame, in every one of ${PROCESSES} processes)`);
const near = await Promise.all(Array.from({ length: PROCESSES }, () => one('near')));
const nm = near.map((a) => a.meas as Meas);
ok(near.every((a) => (a.rays as number) > 100000 && (a.hits as number) > 0 && (a.lying as number) > 0) && nm.every((x) => x.clean), `in all ${PROCESSES} processes the rope lay on the floor, its rays cast every step and met (${Math.min(...near.map((a) => a.hits as number))} hits and more), every window clean`);
ok(nm.every((x) => per(x) <= PER_FRAME), `a rope near something makes nothing of its own, its rays' asks and answers included (worst ${worst(nm)} bytes a frame, in every one of ${PROCESSES} processes)`);
// Maker B: the drawing (item 3) and another player on a rope (item 4), each frame's strip laid as the player lays it.
const dh = await Promise.all(Array.from({ length: PROCESSES }, () => one('drawHeld')));
const dhm = dh.map((a) => a.meas as Meas);
ok(dh.every((a) => a.live && (a.rings as number) > 1 && a.stripShown) && dhm.every((x) => x.clean), `in all ${PROCESSES} processes the held rope's strip was laid every frame through its curve for a moving camera (${dh[0].rings} rings), every window clean`);
ok(dhm.every((x) => per(x) <= PER_FRAME), `a held rope's frame drawn as a chain makes nothing, the curve and the strip included (worst ${worst(dhm)} bytes a frame, in every one of ${PROCESSES} processes)`);
const dn = await Promise.all(Array.from({ length: PROCESSES }, () => one('drawNear')));
const dnm = dn.map((a) => a.meas as Meas);
ok(dn.every((a) => (a.lifted as number) > 0 && a.stripShown) && dnm.every((x) => x.clean), `in all ${PROCESSES} processes the lying rope's strip was laid with its lying knots lifted (${dn[0].lifted}), every window clean`);
ok(dnm.every((x) => per(x) <= PER_FRAME), `a lying rope's frame drawn as a chain makes nothing (worst ${worst(dnm)} bytes a frame, in every one of ${PROCESSES} processes)`);
const pe = await Promise.all(Array.from({ length: PROCESSES }, () => one('peer')));
const pem = pe.map((a) => a.meas as Meas);
ok(pe.every((a) => a.pinWho === 2 && a.peersTaken && a.stripShown) && pem.every((x) => x.clean), `in all ${PROCESSES} processes a peer's hands pinned the rope through the real watcher of their ropes (\`hungInto\`), the strip laid and their ropes laid, every window clean`);
ok(pem.every((x) => per(x) <= PER_FRAME), `a rope another player hangs on makes nothing a frame, their hang handed in and their own line hidden included (worst ${worst(pem)} bytes a frame, in every one of ${PROCESSES} processes: ${pem.map((x) => per(x).toFixed(3)).join(' ')})`);
console.log(`climbRopeChainAlloc: ${checks} checks passed`);
