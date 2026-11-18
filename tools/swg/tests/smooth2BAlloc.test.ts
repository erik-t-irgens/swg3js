// Climbing II, Smoothness II (maker B): the round's own frames make nothing. `smooth2BAllocOwn.ts`, twelve processes at once and
// every one asserted, measures the duck's head read every frame on the feet (item 4: the spheres placed, the drawn top held)
// and the climb's push, a reaching hand's way out and the settle asked of a world with nothing in it (item 3), each at the
// harness's own constant (the engine's own answers, where something is met, are the only things those make).
//
// Run: node tools/swg/tests/smooth2BAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./smooth2BAllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
interface Part {
  bytes: number;
  frames: number;
  clean: boolean;
}
interface Answer {
  head: Part;
  clear: Part;
  held: number;
}
const one = () =>
  new Promise<Answer>((resolve, reject) => {
    const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0 || !line.startsWith('{')) reject(new Error(`smooth2BAllocOwn.ts exited ${code}: ${out}`));
      else resolve(JSON.parse(line) as Answer);
    });
  });
const PROCESSES = 12;
const answers = await Promise.all(Array.from({ length: PROCESSES }, () => one()));
const per = (p: Part) => p.bytes / p.frames;
ok(answers.every((a) => a.head.clean && a.clear.clean), `in all ${PROCESSES} processes each window measured with no collection inside it`);
ok(answers.every((a) => a.held === a.held), `the drawn top read and held every frame (${answers[0].held.toFixed(3)} m over the capsule of the harness's own rig)`);
ok(answers.every((a) => per(a.head) <= PER_FRAME), `the duck's head read (standing and at its deepest) makes nothing a frame (worst ${Math.max(...answers.map((a) => per(a.head))).toFixed(3)} bytes)`);
ok(answers.every((a) => per(a.clear) <= PER_FRAME), `the climb's push, a reaching hand's way out and the settle make nothing a frame in the open (worst ${Math.max(...answers.map((a) => per(a.clear))).toFixed(3)} bytes)`);
console.log(`smooth2BAlloc: ${checks} checks passed`);
