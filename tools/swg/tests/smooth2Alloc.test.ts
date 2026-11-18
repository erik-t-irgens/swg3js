// Climbing II, Smoothness II (maker A): the round's own frames make nothing. `smooth2AllocOwn.ts`, twelve processes at once and
// every one asserted, measures the drop's clocks (item 1's drops' rule), the follow the chase camera is handed while climbing
// and the camera's letting out of a wall's pull-in (item 7), each at the
// harness's own constant (the camera's letting out measured alone: its frame round it is today's, which boxes a number now and
// then by the order its code was compiled in, with the letting out or without); and a timed hop's frames (item 1), which carry the move's own engine casts as every one-off's frames
// always have, held to no more than the same hops' frames under 'before' (four processes of those beside).
//
// Run: node tools/swg/tests/smooth2Alloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./smooth2AllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
interface Part {
  bytes: number;
  frames: number;
  clean: boolean;
}
interface Answer {
  hanging: boolean;
  hopsHanging: boolean;
  hopsMade: number;
  timedMoves: number;
  hop: Part;
  drop: Part;
  follow: Part;
  camMode: string;
  cam: Part;
}
const one = (hops: string, cam = 'eased') =>
  new Promise<Answer>((resolve, reject) => {
    const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, S2_HOPS: hops, S2_CAM: cam } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0 || !line.startsWith('{')) reject(new Error(`smooth2AllocOwn.ts exited ${code}: ${out}`));
      else resolve(JSON.parse(line) as Answer);
    });
  });
const PROCESSES = 12;
const all = await Promise.all([...Array.from({ length: PROCESSES }, () => one('timed')), ...Array.from({ length: 4 }, () => one('before'))]);
const answers = all.slice(0, PROCESSES);
const before = all.slice(PROCESSES, PROCESSES + 4);
const per = (p: Part) => p.bytes / p.frames;
ok(answers.every((a) => a.hanging && a.hopsHanging && a.hopsMade >= 90 && a.timedMoves === a.hopsMade), `in all ${PROCESSES} processes the body hangs and hops up a rung and down again by the keys, every hop timed (${answers.map((a) => a.timedMoves).join(', ')})`);
ok(before.every((a) => a.timedMoves === 0 && a.hopsMade >= 90), "and under 'before' the same hops, none timed");
ok(answers.every((a) => [a.drop, a.follow, a.cam].every((p) => p.clean)), `in all ${PROCESSES}, each window measured with no collection inside it`);
ok(answers.every((a) => per(a.drop) <= PER_FRAME), `the drop's clocks make nothing a frame (worst ${Math.max(...answers.map((a) => per(a.drop))).toFixed(3)} bytes)`);
ok(answers.every((a) => per(a.follow) <= PER_FRAME), `the climbing camera's follow makes nothing a frame (worst ${Math.max(...answers.map((a) => per(a.follow))).toFixed(3)} bytes)`);
ok(answers.every((a) => per(a.cam) <= PER_FRAME), `the camera's letting out of a wall's pull-in makes nothing a frame (worst ${Math.max(...answers.map((a) => per(a.cam))).toFixed(3)} bytes; the camera's own frame round it is today's)`);
const beforeHop = Math.max(...before.map((a) => per(a.hop)));
ok(answers.every((a) => a.hop.clean && per(a.hop) <= beforeHop + PER_FRAME), `a timed hop's frames make no more than the same hops' under 'before' (worst ${Math.max(...answers.map((a) => per(a.hop))).toFixed(1)} bytes a frame against ${beforeHop.toFixed(1)}: the move's own engine casts, which every one-off's frames carry)`);
console.log(`smooth2Alloc: ${checks} checks passed`);
