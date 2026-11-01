// The world editor's looks make nothing in a frame (Map-maker II's seventh wave, DESIGN.md §2.0 rule 7): `editorAllocOwn.ts
// looks`, the attachments' holder looking at its rows between looks, the handles laid out and the one under the cursor found,
// the marks drawn, then an attachment picked with R held and the mouse moving (its turn carried live by the holder), then
// C held with the mouse moving (its size carried in place, `resize`, never placed again), run in
// twelve processes at once, each asserted under 0.05 bytes a frame with no collection (a measure run alone can pass on the
// compiler's luck).
//
// Run: node tools/swg/tests/looksAlloc.test.ts
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
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  holdMade: number;
  holdScavenges: number;
  sizeMade: number;
  sizeScavenges: number;
  sizing: boolean;
  handles: number;
  placed: number;
  holding: boolean;
}
const run = () =>
  new Promise<Answer>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'looks'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  ok(a.handles === 12 && a.placed === 6 && a.scavenges === 0 && a.made < 0.05 * a.frames, `process ${i + 1} of 12: the holder's look and the handles' frame make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${(Math.max(0, a.made) / a.frames).toFixed(3)} a frame, ${a.scavenges} collections; ${a.handles} handles, ${a.placed} effects placed)`);
  ok(a.holding && a.holdScavenges === 0 && a.holdMade < 0.05 * a.frames, `process ${i + 1} of 12: R held on a picked attachment, its turn carried live, makes ${Math.max(0, a.holdMade)} bytes (${(Math.max(0, a.holdMade) / a.frames).toFixed(3)} a frame)`);
  ok(a.sizing && a.sizeScavenges === 0 && a.sizeMade < 0.05 * a.frames, `process ${i + 1} of 12: C held on a picked attachment, its size carried in place, makes ${Math.max(0, a.sizeMade)} bytes (${(Math.max(0, a.sizeMade) / a.frames).toFixed(3)} a frame)`);
}

console.log(`\nlooksAlloc: ${checks} checks passed`);
