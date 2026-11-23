// The galaxy map's opened system makes nothing a frame (the GPU port's pass 2, wave 5, maker M): `galaxySystemAllocOwn.ts`
// (three systems opened on the map's own pool, one following maker S's motion, two the shared clock; the disc's fade and the
// system's frame as the map's draw calls them) run in twelve fresh processes, two waves of six (the machine's cap on a
// suite's processes), each the least of three clean windows of 60,000 frames, every process held under 0.05 bytes a frame
// with no collection in its window (`testing.md`). One copy of this suite at a time.
//
// Run: node tools/swg/tests/galaxySystemAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./galaxySystemAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  systems: number;
  bodies: number[];
  followed: boolean;
  clocked: boolean;
  sum: boolean;
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
const all: Answer[] = [];
for (let wave = 0; wave < 2; wave++) all.push(...(await Promise.all(Array.from({ length: 6 }, () => run()))));
ok(all.every((a) => a.systems === 3 && a.bodies.every((n) => n > 4) && a.followed && a.clocked && a.sum), "each child opened three systems, one on the ground's own time and two on the shared clock's");
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const per = Math.max(0, a.made) / a.frames;
  ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of 12: three opened systems make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame)${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
}
console.log(`\ngalaxySystemAlloc: ${checks} checks passed`);
