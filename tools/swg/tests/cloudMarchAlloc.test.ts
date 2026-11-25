// The clouds' march makes nothing a frame (the GPU port's pass 3, wave 1, maker V): `cloudMarchAllocOwn.ts` (the pass's
// frame as the chain runs it, the feed's drift moving, the world's storm fade and the sheets' word; and with the switch off,
// the pass's `enabled` alone) run in twelve processes, two waves of six, each the least of three clean windows of 60,000
// frames, every process asserted under 0.05 bytes a frame with no collection in its window (`testing.md`). Run one copy at a
// time: it is its own dozen.
//
// Run: node tools/swg/tests/cloudMarchAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./cloudMarchAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  offMade: number;
  offScavenges: number;
  onMade: number;
  onScavenges: number;
  drew: boolean;
  /** Pass 3, wave 2 (maker T): what the fill-in did over the windows (`CLOUD_REUSE_STATS`). */
  reuse: { resolved: number; flightFrames: number; motionDrawn: number; flightEntered: number };
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
const word = (made: number, sc: number, frames: number): string => (sc ? `no clean window (${sc} collections in the cleanest)` : `${Math.max(0, made)} bytes over ${frames} frames (${(Math.max(0, made) / frames).toFixed(3)} a frame)`);
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  ok(a.drew, `process ${i + 1} of 12: the stand-in pass came to draw (its build answered, its noise baked a slab a frame)`);
  ok(a.offScavenges === 0 && Math.max(0, a.offMade) / a.frames < 0.05, `process ${i + 1} of 12: with the switch off the pass's frame makes ${word(a.offMade, a.offScavenges, a.frames)}`);
  ok(a.onScavenges === 0 && Math.max(0, a.onMade) / a.frames < 0.05, `process ${i + 1} of 12: drawing, the march's frame, the feed's drift, the fade and the sheets' word make ${word(a.onMade, a.onScavenges, a.frames)}`);
  // Pass 3, wave 2 (maker T): the windows walked the fill-in, flight mode in and out, and the motion the smoothing reads.
  ok(a.reuse.resolved > 0 && a.reuse.flightFrames > 0 && a.reuse.flightEntered > 1 && a.reuse.motionDrawn > 0, `process ${i + 1} of 12: the frames measured resolved the fill-in (${a.reuse.resolved}), flew in flight mode (${a.reuse.flightFrames}, entered ${a.reuse.flightEntered} times) and laid the clouds' motion (${a.reuse.motionDrawn})`);
}
console.log(`\ncloudMarchAlloc: ${checks} checks passed`);
