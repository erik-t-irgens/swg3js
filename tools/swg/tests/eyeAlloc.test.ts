// The eye's frame on the main thread makes nothing a frame (the GPU port's pass 2, wave 2, maker A): `eyeAllocOwn.ts` (the eye's
// mode, three's exposure and the buffer written where the card does not adapt, its inputs moving every frame and its modes
// crossed; and, from the sky and light fix round, the chain's eye pass and the demo's bloom drawn over a stand-in) run in twelve
// processes at once, each the least of three clean windows of 60,000 frames, every process asserted
// under 0.05 bytes a frame with no collection in its window (`testing.md`).
//
// Run: node tools/swg/tests/eyeAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./eyeAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
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
// (the fixer of pass 2, wave 6) two waves of six, so the suite keeps to six node processes at once; a quarter of each window's
// frames in space (`EYE_IN.space`, the space exposure's branch, the checker's finding that no measure reached it)
const all: Answer[] = [];
for (let wave = 0; wave < 2; wave++) all.push(...(await Promise.all(Array.from({ length: 6 }, () => run()))));
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  if (!Number.isFinite(a.made) || !Number.isFinite(a.scavenges)) {
    ok(false, `process ${i + 1} of 12: no clean window`);
    continue;
  }
  const per = Math.max(0, a.made) / a.frames;
  ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of 12: the eye's frame (on the ground and in space) makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame)${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
}
console.log(`\neyeAlloc: ${checks} checks passed`);
