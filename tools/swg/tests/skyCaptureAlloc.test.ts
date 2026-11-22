// The real sky's capture makes nothing a frame (the GPU port's pass 2, wave 2, maker B): `skyCaptureAllocOwn.ts` (the
// capture's step through its faces, its filters, its asks and the idle frames between, its copies placed and its lights
// copied) run in twelve fresh processes, each the least of three clean windows of 60,000 frames, every process asserted under
// 0.05 bytes a frame with no collection in its window (`testing.md`). The processes run five at a time, not twelve: the
// machine is shared while the suites run (the owner plays on it), and a fresh process is what the measure needs, not a crowd.
//
// Run: node tools/swg/tests/skyCaptureAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./skyCaptureAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  faces: number;
  filters: number;
  outright: number;
  byClock: number;
  byLight: number;
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
const AT_ONCE = 5;
const all: Answer[] = [];
while (all.length < PROCESSES) all.push(...(await Promise.all(Array.from({ length: Math.min(AT_ONCE, PROCESSES - all.length) }, () => run()))));
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const per = Math.max(0, a.made) / a.frames;
  ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of ${PROCESSES}: the capture's step makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame)${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
}
const a = all[0];
ok(a.faces > 0 && a.filters > 0 && a.outright > 0 && a.byClock > 0 && a.byLight > 0, `and every path ran: ${a.faces} faces, ${a.filters} filters, ${a.outright} asks taken at once, refreshes begun by the clock (${a.byClock}) and by the light (${a.byLight})`);
console.log(`\nskyCaptureAlloc: ${checks} checks passed`);
