// What the clouds' model makes a frame (pass 3, wave 1, maker M): `cloudAllocOwn.ts` (the run's own frame with six layers, two
// regions, the shared clock a second a frame so the schedule's and the drift's steps turn inside the window, the level followed,
// the weather's own and held; and the map's upload of the frame's numbers into its uniforms) run in twelve processes, two waves
// of six, each the least of three clean windows of 60,000 frames, every process asserted under 0.05 bytes a frame with no
// collection in its window (`testing.md`), and again with a level held on this machine.
//
// Run: node tools/swg/tests/cloudAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./cloudAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  heldMade: number;
  heldScavenges: number;
  steps: number;
  count: number;
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
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const per = Math.max(0, a.made) / a.frames;
  ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of 12: the clouds' frame and the map's upload make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame), six layers packed${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
  const perH = Math.max(0, a.heldMade) / a.frames;
  ok(a.heldScavenges === 0 && perH < 0.05, `process ${i + 1} of 12: and with a level held ${Math.max(0, a.heldMade)} bytes (${perH.toFixed(3)} a frame)${a.heldScavenges ? `, ${a.heldScavenges} collections in the cleanest window` : ''}`);
}
console.log(`\ncloudAlloc: ${checks} checks passed`);
