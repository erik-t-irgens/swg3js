// What draws from the air makes nothing a frame (the GPU port's pass 2, wave 1, maker B): `skyDrawAllocOwn.ts` (Tatooine's pair
// and the haze pass's prepare and render; the night floor went with wave 2's eye) run in twelve processes, two waves of six, each the least of
// three clean windows of 60,000 frames, every process asserted under 0.05 bytes a frame with no collection in its window (`testing.md`), at
// the pair's angle 0 and again beside the caster (pass 2, wave 6).
//
// Run: node tools/swg/tests/skyDrawAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./skyDrawAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  /** The same frames with the pair turned beside the caster (pass 2, wave 6). */
  besideMade: number;
  besideScavenges: number;
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
// Twelve fresh processes in two waves of six, the machine's cap on node processes at once (pass 2, wave 6, as wave 5's fixer
// ran `skyMotionAlloc`).
const all: Answer[] = [];
for (let wave = 0; wave < 2; wave++) all.push(...(await Promise.all(Array.from({ length: 6 }, () => run()))));
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const per = Math.max(0, a.made) / a.frames;
  ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of 12: the pair and the haze pass make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame)${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
  const perB = Math.max(0, a.besideMade) / a.frames;
  ok(a.besideScavenges === 0 && perB < 0.05, `process ${i + 1} of 12: and with the pair turned beside the caster (angle 90) ${Math.max(0, a.besideMade)} bytes (${perB.toFixed(3)} a frame)${a.besideScavenges ? `, ${a.besideScavenges} collections in the cleanest window` : ''}`);
}
console.log(`\nskyDrawAlloc: ${checks} checks passed`);
