// The far ground's selection a frame makes nothing (the horizon pass's first wave, DESIGN.md §3): `horizonAllocOwn.ts`, a
// walk, a turn and a climb to 2 km with the fog's cap moving, run in twelve processes at once, each asserted under 0.05
// bytes a frame with no collection; and (the third wave) the frame of a field keeping its composition window round the eye,
// which works out where the window would stand and asks nothing.
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
  window: { made: number; scavenges: number; asks: number };
  shape: { made: number; scavenges: number; finePatches: number; moves: number; cached: number; uploads: number; blocks: number; wholes: number };
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
  const w = a.window;
  ok(w.asks === 0 && w.scavenges === 0 && w.made < 0.05 * a.frames, `process ${i + 1} of 12: with the composition window kept round the eye, a frame that asks for none (${w.asks} asked) makes ${Math.max(0, w.made)} bytes over ${a.frames} frames (${(Math.max(0, w.made) / a.frames).toFixed(3)} a frame)`);
  // Wave 3b: the finer levels selected and the shape window moved over block edges, its blocks taken from the cache in the frame.
  const s = a.shape;
  // Its review: the probes through the sampler's own copy (by block number), and the card's uploads (blocks and whole windows
  // after a 3 km jump) through a stand-in renderer, ran in the window too.
  ok(s.finePatches > 50 && s.moves > 100 && s.cached > 1000 && s.blocks > 100 && s.wholes > 10 && s.uploads === s.blocks + s.wholes && s.scavenges === 0 && s.made < 0.05 * a.frames, `process ${i + 1} of 12: with the shape up close (${s.finePatches.toFixed(0)} 2 m patches a frame, the window moved ${s.moves} times, ${s.cached} blocks taken from the sampler's cache, ${s.blocks} block uploads and ${s.wholes} whole ones), a frame makes ${Math.max(0, s.made)} bytes over ${a.frames} frames (${(Math.max(0, s.made) / a.frames).toFixed(3)} a frame)`);
}
console.log(`\nhorizonAlloc: ${checks} checks passed`);
