// A space zone's frame on WebGPU makes nothing of this wave's (the GPU port's pass 2, wave 3, maker B): `spaceGpuAllocOwn.ts`
// with its part 'gpu' -- each nebula's middle less the eye written into its table, the sheets put back relative after a sort,
// a drawn bolt handed its ends less the eye, and the distant systems riding with the camera moved with it -- run in twelve
// fresh processes, each the least of three clean windows of 60,000 frames, every process under 0.05 bytes a frame with no
// collection in its window (`testing.md`), five at a time on a shared machine.
//
// The rest of the nebulae's frame (`Nebulae.update`'s uniforms, haze and strikes) is WebGL's own and is not held here: run
// with `SPACE_ALLOC_PART=webgl` it read 24 to 60 bytes a frame before this wave's lines and beside them (the uniforms' `value`
// written with fresh doubles each frame), which this suite leaves to a mend of its own.
//
// Run: node tools/swg/tests/spaceGpuAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./spaceGpuAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  moves: number;
  sheets: number;
}
const run = () =>
  new Promise<Answer>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SPACE_ALLOC_PART: 'gpu' } });
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
  ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of ${PROCESSES}: the frame makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame)${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
}
ok(all[0].moves > 0 && all[0].sheets > 0, `and every part ran: ${all[0].sheets} sheets, ${all[0].moves} moves of the riding systems`);
console.log(`\nspaceGpuAlloc: ${checks} checks passed`);
