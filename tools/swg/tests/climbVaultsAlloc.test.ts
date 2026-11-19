// Climbing II, phase 6 (vaults and clambers, maker A's items 1 and 2): a sprint frame at an obstacle makes nothing (its face rays and
// the top kept, `climbVaultsAllocOwn.ts` 'sense'), nor one that reads the top anew every frame ('read'), nor a held vault's frame
// over a vault, a dive and a clamber ('step': the body on the clip's path, its lift and landing, the figure's offset), nor the vault's
// hand-over to the rig ('clips'). Twelve processes at once for each, every one asserted; each window measured 25 ms of wall time
// after the calls that compile it, as `ledgeAllocOwn` waits. A vault begun, and a clip begun or ended, are events, once a vault:
// what each makes is said as a note ('begin', 'clipEvents'), the options a clip's start hands the rig as every hand-over hands them.
//
// Run: node tools/swg/tests/climbVaultsAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./climbVaultsAllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
const PROCESSES = 12;
interface Meas {
  bytes: number;
  frames: number;
  clean: boolean;
}
function one(part: string, shape = 'vault'): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, VAULT_PART: part, VAULT_SHAPE: shape } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0 || !line.startsWith('{')) reject(new Error(`climbVaultsAllocOwn.ts ${part} ${shape} exited ${code}: ${out}`));
      else resolve(JSON.parse(line) as Record<string, unknown>);
    });
  });
}
const per = (m: Meas) => m.bytes / m.frames;
const worst = (ms: Meas[]) => Math.max(...ms.map(per)).toFixed(4);
const twelve = (part: string, shape?: string) => Promise.all(Array.from({ length: PROCESSES }, () => one(part, shape)));

const senses = await twelve('sense');
const sm = senses.map((a) => a.meas as Meas);
ok(senses.every((a) => a.verdict === 'waiting' && (a.rays as number) > 2 * (a.waits as number) - 1) && sm.every((x) => x.clean), `in all ${PROCESSES} processes the body sprinted at a face too far yet, both rays cast every frame and the top kept, every window clean`);
ok(sm.every((x) => per(x) <= PER_FRAME), `a sprint frame at an obstacle makes nothing (worst ${worst(sm)} bytes a frame over ${sm[0].frames} frames, in every one of ${PROCESSES} processes)`);
const reads = await twelve('read');
const rm = reads.map((a) => a.meas as Meas);
ok(reads.every((a) => a.verdict === 'waiting' && (a.rays as number) > 10 * (a.waits as number)) && rm.every((x) => x.clean), `the top read anew every frame (its march along the top and the far side's ray back, over ten rays a frame), every window clean`);
ok(rm.every((x) => per(x) <= PER_FRAME), `a frame reading the top anew makes nothing (worst ${worst(rm)} bytes a frame, in every one of ${PROCESSES} processes)`);
for (const [shape, kind] of [['vault', 'vault'], ['dive', 'dive'], ['clamber', 'clamber']] as const) {
  const steps = await twelve('step', shape);
  const tm = steps.map((a) => a.meas as Meas);
  ok(steps.every((a) => a.kind === kind && a.begun === 1 && a.waits === 1 && (a.held as number) > 400000 && a.ended === 0) && tm.every((x) => x.clean), `a ${kind} held through every measured frame (begun on the first frame of all, never ended) in every process, every window clean`);
  ok(tm.every((x) => per(x) <= PER_FRAME), `a held ${kind}'s frame makes nothing (worst ${worst(tm)} bytes a frame, in every one of ${PROCESSES} processes)`);
}
const clips = await twelve('clips');
const km = clips.map((a) => a.meas as Meas);
ok(clips.every((a) => (a.calls as number) > 0) && km.every((x) => x.clean), "the vault's hand-over drove the rig in every process, every window clean");
ok(km.every((x) => per(x) <= PER_FRAME), `the vault's hand-over makes nothing (worst ${worst(km)} bytes a frame, in every one of ${PROCESSES} processes)`);
// The events, once a vault: notes.
const begins = await Promise.all(Array.from({ length: 3 }, () => one('begin')));
const bb = begins.filter((a) => (a.meas as Meas).clean && (a.begun as number) > 0).map((a) => (a.meas as Meas).bytes / ((a.begun as number) / 4.0496));
console.log(`note a vault begun (its rays, its room and ground asked of the stand-in, its numbers set): about ${bb.length ? Math.round(Math.min(...bb)) : 'unmeasured'} bytes a begin (the cleanest of three processes), once a vault`);
const events = await Promise.all(Array.from({ length: 3 }, () => one('clipEvents')));
const ee = events.filter((a) => (a.meas as Meas).clean).map((a) => (a.meas as Meas).bytes / 125);
console.log(`note a clip begun and ended: about ${ee.length ? Math.round(Math.min(...ee)) : 'unmeasured'} bytes the pair (the options its start hands the rig's \`play\`, as every hand-over hands them), once a vault`);
console.log(`climbVaultsAlloc: ${checks} checks passed`);
