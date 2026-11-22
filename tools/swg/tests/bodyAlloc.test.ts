// The sky's moons and planets make nothing a frame (the GPU port's pass 2, wave 4a, maker B): `bodyAllocOwn.ts` (a real
// `SkyBodies` over three cards, its frame with the cards placed by the sky's rule and every form switched through) run in twelve
// fresh processes, three at a time, each the least of three clean windows of 60,000 frames, every process asserted under 0.05
// bytes a frame with no collection in its window (`testing.md`). One copy of this suite at a time: it starts its own dozen.
//
// Run: node tools/swg/tests/bodyAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./bodyAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  bodies: number;
  air: number;
  baked: number;
}
const run = () =>
  new Promise<Answer>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file], { stdio: ['ignore', 'pipe', 'pipe'] });
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
// Twelve fresh processes, a few at a time (the owner's machine: never a dozen node processes at once).
const PROCESSES = 12;
const AT_ONCE = Math.max(1, Math.min(6, Number(process.env.SWG_ALLOC_AT_ONCE) || 3));
const all: Answer[] = [];
while (all.length < PROCESSES) all.push(...(await Promise.all(Array.from({ length: Math.min(AT_ONCE, PROCESSES - all.length) }, () => run()))));
ok(all.every((a) => a.bodies === 3 && a.air === 1 && a.baked === 1), 'each child stood three bodies, one of them a world with air whose tables were baked');
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const per = Math.max(0, a.made) / a.frames;
  ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of 12: the bodies' frame makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame)${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
}
console.log(`\nbodyAlloc: ${checks} checks passed`);
