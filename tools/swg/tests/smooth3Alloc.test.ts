// Climbing II, Smoothness III (maker A): an arc's hop and a drop's own move make no more a frame than Smoothness II's timed hop
// and its side hop down did on the same rungs (`smooth3AllocOwn.ts`, twelve processes at once at the shipped settings and four
// with this round's switches at their other setting, every one asserted): their frames carry the move's own engine casts as
// every one-off's always have, and nothing more of their own.
//
// Run: node tools/swg/tests/smooth3Alloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./smooth3AllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
interface Part {
  bytes: number;
  frames: number;
  clean: boolean;
}
interface Answer {
  mode: string;
  hanging: boolean;
  still: boolean;
  made: number;
  arcs: number;
  parts: number;
  hop: Part;
}
const one = (mode: string) =>
  new Promise<Answer>((resolve, reject) => {
    const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, S3_MODE: mode } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0 || !line.startsWith('{')) reject(new Error(`smooth3AllocOwn.ts exited ${code}: ${out}`));
      else resolve(JSON.parse(line) as Answer);
    });
  });
const PROCESSES = 12;
const all = await Promise.all([...Array.from({ length: PROCESSES }, () => one('arc')), ...Array.from({ length: 4 }, () => one('timed'))]);
const answers = all.slice(0, PROCESSES);
const before = all.slice(PROCESSES);
const per = (p: Part) => p.bytes / p.frames;
ok(answers.every((a) => a.hanging && a.still && a.made >= 38 && a.arcs === a.made && a.parts >= 18), `in all ${PROCESSES} processes the body hops up a rung on the arc and drops down again on its own two parts by the keys (moves ${answers.map((a) => a.made).join(', ')}; drops ${answers.map((a) => a.parts).join(', ')})`);
ok(before.every((a) => a.arcs === 0 && a.parts === 0 && a.made >= 38), "and with this round's switches at their other setting the same moves, Smoothness II's (no arc, no drop's two parts)");
// (The fixer's: the frames are the engine's casts, about 350 bytes, and a process now and then lands 15 to 40 bytes over its
// fellows by how its engine calls were compiled, whichever mode (measured: arc 344 in most processes, 362 to 383 in two of
// twelve; timed 358, once 371). Held as the worst of twelve against the worst of four, the check failed by two bytes on such a
// process with nothing changed. So the steady frame, the middle process of each mode, is held to the other's with the harness's
// own constant, where a number made a frame shows as 16 bytes; and every process within a tenth of the before's worst.)
const beforeHop = Math.max(...before.map((a) => per(a.hop)));
const middle = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const arcMid = middle(answers.map((a) => per(a.hop)));
const beforeMid = middle(before.map((a) => per(a.hop)));
ok(answers.every((a) => a.hop.clean) && arcMid <= beforeMid + PER_FRAME && answers.every((a) => per(a.hop) <= beforeHop * 1.1), `an arc's and a drop's frames make no more than Smoothness II's (the middle process ${arcMid.toFixed(2)} bytes a frame against ${beforeMid.toFixed(2)}; the worst ${Math.max(...answers.map((a) => per(a.hop))).toFixed(2)} against ${beforeHop.toFixed(2)}: the move's own engine casts, which every one-off's frames carry)`);
console.log(`smooth3Alloc: ${checks} checks passed`);
