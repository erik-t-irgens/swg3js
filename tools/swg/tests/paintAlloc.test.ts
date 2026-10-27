// The paint brush's hover frame makes nothing (Map-maker II, DESIGN.md §2.5, W2): `editorAllocOwn.ts paint`, the armed
// brush's frame handed to the tool and its two rings projected and drawn with the aim wandering, run in twelve processes at
// once, each asserted under 0.05 bytes a frame with no collection (a measure run alone can pass on the compiler's luck).
// And on the plants layer (the fourth wave, `paint plants`): its own radius and tune, a recipe chosen, twelve more.
//
// Run: node tools/swg/tests/paintAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const file = fileURLToPath(new URL('./editorAllocOwn.ts', import.meta.url));
const run = (plants: boolean) =>
  new Promise<{ frames: number; made: number; scavenges: number; ringShown: number; ring2Shown: number; armed: boolean; stroke: string | null; tiles: number; layer: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'paint', ...(plants ? ['plants'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
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
for (const plants of [false, true]) {
  const all = await Promise.all(Array.from({ length: 12 }, () => run(plants)));
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    ok(a.armed && a.stroke === null && a.tiles === 0 && a.ringShown > 0 && a.ring2Shown > 0 && a.scavenges === 0 && a.made < 0.05 * a.frames && a.layer === (plants ? 'plants' : 'family'), `${plants ? 'plants layer, ' : ''}process ${i + 1} of 12: the armed paint brush's hover frame and its two rings make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${(Math.max(0, a.made) / a.frames).toFixed(3)} a frame, ${a.scavenges} collections)`);
  }
}

console.log(`\npaintAlloc: ${checks} checks passed`);
