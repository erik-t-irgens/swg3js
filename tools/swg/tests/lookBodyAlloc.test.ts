// The look bodies' frame makes nothing (the GPU port's pass 2, wave 5, maker L): `lookBodyAllocOwn.ts` (a real `LookBodies` over
// four looks whose every layer the frame steps: clouds' own motion, storms played back, a scattered air, rings, a belt, a giant's
// banded depth, a moon inside its gas; a ground sky's card, an extra body of an applied system and two space planets) run in
// twelve fresh processes, three at a time, each the least of three clean windows of 60,000 frames, every process asserted under
// 0.05 bytes a frame with no collection in its window (`testing.md`). One copy of this suite at a time: it starts its own dozen.
//
// Run: node tools/swg/tests/lookBodyAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./lookBodyAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  bodies: number;
  drawn: number[];
  storms: number;
  air: string[];
}
const run = () =>
  new Promise<Answer>((resolve, reject) => {
    const env = { ...process.env };
    for (const k of ['LB_PLANS', 'LB_NODRAW', 'LB_NOSTORM', 'LB_NOMOTION', 'LB_NOAIR']) delete env[k];
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file], { stdio: ['ignore', 'pipe', 'pipe'], env });
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
const PROCESSES = 12;
const AT_ONCE = Math.max(1, Math.min(6, Number(process.env.SWG_ALLOC_AT_ONCE) || 3));
const all: Answer[] = [];
while (all.length < PROCESSES) all.push(...(await Promise.all(Array.from({ length: Math.min(AT_ONCE, PROCESSES - all.length) }, () => run()))));
ok(all.every((a) => a.bodies === 4), 'each child built the four looks (its stand-in renderer drawing nothing)');
ok(all.every((a) => a.air[0] === 'scattered'), "the living world's air scattered (its own form) at the High tier");
ok(all.every((a) => a.drawn.every((n) => n > 50_000)), 'every body drawn into its picture through the windows (its light moving, its look moving of itself)');
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const per = Math.max(0, a.made) / a.frames;
  ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of 12: the look bodies' frame and draws make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame)${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
}
console.log(`\nlookBodyAlloc: ${checks} checks passed`);
