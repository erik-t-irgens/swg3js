// The far ground's selection a frame makes nothing (the horizon pass's first wave, DESIGN.md §3): `horizonAllocOwn.ts`, a
// walk, a turn and a climb to 2 km with the fog's cap moving, run in twelve processes at once, each asserted under 0.05
// bytes a frame with no collection.
//
// Run: node tools/swg/tests/horizonAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./horizonAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  patches: number;
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
const all = await Promise.all(Array.from({ length: 12 }, () => run()));
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  ok(a.patches > 100 && a.scavenges === 0 && a.made < 0.05 * a.frames, `process ${i + 1} of 12: a selection a frame (${a.patches.toFixed(0)} patches on average) makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${(Math.max(0, a.made) / a.frames).toFixed(3)} a frame)`);
}
console.log(`\nhorizonAlloc: ${checks} checks passed`);
