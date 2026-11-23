// Space's frame makes nothing (the GPU port's pass 2, wave 4b, maker C): `spaceAllocOwn.ts` (a real `SpaceRims` over Kessel's four
// planets, a real `SpaceVolumes` with its Maelstrom hung, the Nebulae row's rule) run in twelve fresh processes, three at a time,
// each the least of three clean windows of 60,000 frames, every process asserted under 0.05 bytes a frame with no collection in
// its window (`testing.md`). One copy of this suite at a time: it starts its own dozen.
//
// Run: node tools/swg/tests/spaceAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./spaceAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  rims: number;
  baked: number;
  volumes: number;
  occAgree: boolean;
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
const PROCESSES = 12;
const AT_ONCE = Math.max(1, Math.min(6, Number(process.env.SWG_ALLOC_AT_ONCE) || 3));
const all: Answer[] = [];
while (all.length < PROCESSES) all.push(...(await Promise.all(Array.from({ length: Math.min(AT_ONCE, PROCESSES - all.length) }, () => run()))));
ok(all.every((a) => a.rims === 1 && a.baked === 1 && a.volumes === 1), "each child stood Kessel's one planet with air (its tables baked) and its Maelstrom");
ok(all.every((a) => a.occAgree), "the frame's planets as the gas sees them are `occluderOf`'s rule (written out in the frame)");
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const per = Math.max(0, a.made) / a.frames;
  ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of 12: space's frame makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame)${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
}
console.log(`\nspaceAlloc: ${checks} checks passed`);
