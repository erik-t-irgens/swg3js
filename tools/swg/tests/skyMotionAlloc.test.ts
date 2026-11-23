// Skies in motion make nothing a frame (the GPU port's pass 2, wave 5, maker S): `skyMotionAllocOwn.ts` (three days following
// applied star systems: Yavin 4 through its eclipse and giantshine, Tatooine's pair, Rori under Naboo; a hand's write of the
// time and the fast key now and then; the bodies' numbers read as a frame reads them) run in twelve processes at once, each the
// least of three clean windows of 60,000 frames, every process asserted under 0.05 bytes a frame with no collection in its
// window (`testing.md`). One copy of this suite at a time: it starts its own dozen.
//
// Run: node tools/swg/tests/skyMotionAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./skyMotionAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  worlds: number;
  items: number[];
  eclipse: boolean;
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
// Twelve fresh processes in two waves of six, the machine's cap on node processes at once (the fixer of wave 5).
const all: Awaited<ReturnType<typeof run>>[] = [];
for (let wave = 0; wave < 2; wave++) all.push(...(await Promise.all(Array.from({ length: 6 }, () => run()))));
ok(all.every((a) => a.worlds === 3 && a.items.length === 3 && a.items.every((n) => n > 3) && a.eclipse && a.sum), 'each child ran three applied systems with their bodies, and read them back as numbers');
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const per = Math.max(0, a.made) / a.frames;
  ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of 12: three days following their systems make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame)${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
}
console.log(`\nskyMotionAlloc: ${checks} checks passed`);
